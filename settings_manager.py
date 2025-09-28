"""
Modulo per la gestione delle impostazioni utente.
Gestisce il caricamento, il salvataggio e il reset delle impostazioni con meccanismi
di protezione contro la corruzione dei dati e problemi di I/O.
"""
import ujson
import uos as os
import gc
import time
from utils import ensure_directory_exists, get_dirname
from cache_manager import get_cached, invalidate_cache

# Percorsi dei file
USER_SETTINGS_FILE = '/data/user_settings.json'
FACTORY_SETTINGS_FILE = '/data/factory_settings.json'
PROGRAM_FILE = '/data/program.json'

# Funzione per il logging che evita importazioni circolari
def _log_event(message, level="INFO"):
    """
    Registra un messaggio nel log senza causare importazioni circolari.
    
    Args:
        message: Messaggio da loggare
        level: Livello del log (INFO, WARNING, ERROR)
    """
    try:
        # Importazione locale per evitare dipendenze circolari
        from log_manager import log_event
        log_event(message, level)
    except ImportError:
        # Fallback di logging se l'importazione fallisce
        print(f"[{level}] {message}")

def create_default_settings():
    """
    Crea impostazioni predefinite con valori sicuri e ben documentati.
    
    Returns:
        dict: Dizionario delle impostazioni predefinite
    """
    return {
        'language': 'it',
        'safety_relay': {
            'pin': 13
        },
        'zones': [
            {'id': 0, 'status': 'show', 'pin': 14, 'name': 'Giardino'},
            {'id': 1, 'status': 'show', 'pin': 15, 'name': 'Terrazzo'},
            {'id': 2, 'status': 'show', 'pin': 16, 'name': 'Cancelletto'},
            {'id': 3, 'status': 'show', 'pin': 17, 'name': 'Zona 4'},
            {'id': 4, 'status': 'show', 'pin': 18, 'name': 'Zona 5'},
            {'id': 5, 'status': 'show', 'pin': 19, 'name': 'Zona 6'},
            {'id': 6, 'status': 'show', 'pin': 20, 'name': 'Zona 7'},
            {'id': 7, 'status': 'show', 'pin': 21, 'name': 'Zona 8'}
        ],
        'automatic_programs_enabled': True,
        'max_active_zones': 3,
        'wifi': {
            'ssid': '',
            'password': ''
        },
        'activation_delay': 5,
        'client_enabled': False,
        'ap': {
            'ssid': 'IrrigationSystem',
            'password': '12345678'
        },
        'max_zone_duration': 180
    }

def _validate_settings_structure(settings):
    """
    Valida e corregge la struttura delle impostazioni.
    
    Args:
        settings: Dizionario delle impostazioni da validare
        
    Returns:
        dict: Impostazioni validate e corrette
    """
    if not isinstance(settings, dict):
        _log_event("Impostazioni non sono un dizionario, uso valori predefiniti", "WARNING")
        return create_default_settings()
    
    # Assicura campi essenziali
    defaults = create_default_settings()
    validated_settings = {}
    
    # Copia tutti i campi validi dalle impostazioni esistenti
    for key, default_value in defaults.items():
        if key in settings:
            if isinstance(default_value, dict) and isinstance(settings[key], dict):
                # Merge ricorsivo per dizionari
                validated_settings[key] = default_value.copy()
                validated_settings[key].update(settings[key])
            else:
                validated_settings[key] = settings[key]
        else:
            validated_settings[key] = default_value
    
    # Validazioni specifiche
    
    # Valida language
    if 'language' not in validated_settings or not validated_settings['language']:
        validated_settings['language'] = 'it'
    
    # Valida safety_relay
    if 'safety_relay' not in validated_settings or not isinstance(validated_settings['safety_relay'], dict):
        validated_settings['safety_relay'] = {'pin': 13}
    elif 'pin' not in validated_settings['safety_relay']:
        validated_settings['safety_relay']['pin'] = 13
    
    # Valida zones
    if 'zones' not in validated_settings or not isinstance(validated_settings['zones'], list):
        validated_settings['zones'] = defaults['zones']
    else:
        # Valida ogni zona
        valid_zones = []
        for zone in validated_settings['zones']:
            if isinstance(zone, dict) and 'id' in zone and 'pin' in zone:
                # Assicura campi essenziali
                zone_copy = {
                    'id': zone['id'],
                    'pin': zone['pin'],
                    'status': zone.get('status', 'show'),
                    'name': zone.get('name', f'Zona {zone["id"] + 1}')
                }
                valid_zones.append(zone_copy)
        
        if not valid_zones:
            validated_settings['zones'] = defaults['zones']
        else:
            validated_settings['zones'] = valid_zones
    
    # Valida max_active_zones
    if 'max_active_zones' not in validated_settings or not isinstance(validated_settings['max_active_zones'], int):
        validated_settings['max_active_zones'] = 3
    elif validated_settings['max_active_zones'] < 1:
        validated_settings['max_active_zones'] = 1
    elif validated_settings['max_active_zones'] > 8:
        validated_settings['max_active_zones'] = 8
    
    # Valida max_zone_duration
    if 'max_zone_duration' not in validated_settings or not isinstance(validated_settings['max_zone_duration'], int):
        validated_settings['max_zone_duration'] = 180
    elif validated_settings['max_zone_duration'] < 1:
        validated_settings['max_zone_duration'] = 1
    elif validated_settings['max_zone_duration'] > 1440:  # Max 24 ore
        validated_settings['max_zone_duration'] = 1440
    
    # Valida activation_delay
    if 'activation_delay' not in validated_settings or not isinstance(validated_settings['activation_delay'], (int, float)):
        validated_settings['activation_delay'] = 5
    elif validated_settings['activation_delay'] < -300:  # Min -5 minuti
        validated_settings['activation_delay'] = -300
    elif validated_settings['activation_delay'] > 300:   # Max 5 minuti
        validated_settings['activation_delay'] = 300
    
    # Valida wifi settings
    if 'wifi' not in validated_settings or not isinstance(validated_settings['wifi'], dict):
        validated_settings['wifi'] = {'ssid': '', 'password': ''}
    else:
        if 'ssid' not in validated_settings['wifi']:
            validated_settings['wifi']['ssid'] = ''
        if 'password' not in validated_settings['wifi']:
            validated_settings['wifi']['password'] = ''
    
    # Valida ap settings
    if 'ap' not in validated_settings or not isinstance(validated_settings['ap'], dict):
        validated_settings['ap'] = {'ssid': 'IrrigationSystem', 'password': '12345678'}
    else:
        if 'ssid' not in validated_settings['ap']:
            validated_settings['ap']['ssid'] = 'IrrigationSystem'
        if 'password' not in validated_settings['ap']:
            validated_settings['ap']['password'] = '12345678'
    
    # Valida automatic_programs_enabled
    if 'automatic_programs_enabled' not in validated_settings:
        validated_settings['automatic_programs_enabled'] = True
    elif not isinstance(validated_settings['automatic_programs_enabled'], bool):
        validated_settings['automatic_programs_enabled'] = bool(validated_settings['automatic_programs_enabled'])
    
    # Valida client_enabled
    if 'client_enabled' not in validated_settings:
        validated_settings['client_enabled'] = False
    elif not isinstance(validated_settings['client_enabled'], bool):
        validated_settings['client_enabled'] = bool(validated_settings['client_enabled'])
    
    return validated_settings

def _save_settings_atomic(settings, file_path):
    """
    Salva le impostazioni in modo atomico usando un file temporaneo.
    
    Args:
        settings: Impostazioni da salvare
        file_path: Percorso del file di destinazione
        
    Returns:
        boolean: True se il salvataggio è riuscito, False altrimenti
    """
    if not isinstance(settings, dict):
        _log_event(f"Tentativo di salvare impostazioni non valide per {file_path}", "ERROR")
        return False
    
    try:
        # Assicura che la directory esista
        if not ensure_directory_exists(get_dirname(file_path)):
            _log_event(f"Impossibile creare/verificare la directory per {file_path}", "ERROR")
            return False
        
        # Valida le impostazioni prima del salvataggio
        validated_settings = _validate_settings_structure(settings)
        
        # Salvataggio atomico con file temporaneo
        temp_file = file_path + '.tmp'
        
        with open(temp_file, 'w') as f:
            ujson.dump(validated_settings, f)
            f.flush()
        
        # Rinomina atomicamente
        os.rename(temp_file, file_path)
        
        # Invalida cache solo se stiamo salvando USER_SETTINGS_FILE
        if file_path == USER_SETTINGS_FILE:
            invalidate_cache('settings')
        
        _log_event(f"Impostazioni salvate con successo in {file_path}", "INFO")
        return True
        
    except OSError as e:
        _log_event(f"Errore I/O durante salvataggio {file_path}: {e}", "ERROR")
        # Tenta di pulire il file temporaneo
        try:
            os.remove(temp_file)
        except:
            pass
        return False
    except Exception as e:
        _log_event(f"Errore generico durante salvataggio {file_path}: {e}", "ERROR")
        return False

def _load_settings_uncached():
    """
    Carica le impostazioni dal disco senza usare la cache.
    Funzione helper per get_cached.
    
    Returns:
        dict: Dizionario delle impostazioni validate
    """
    try:
        # Tenta di leggere il file delle impostazioni utente
        try:
            with open(USER_SETTINGS_FILE, 'r') as f:
                file_content = f.read().strip()
                
                if not file_content:
                    raise ValueError("File impostazioni vuoto")
                
                try:
                    settings = ujson.loads(file_content)
                except ValueError as json_error:
                    _log_event(f"Errore parsing JSON in {USER_SETTINGS_FILE}: {json_error}", "ERROR")
                    _log_event(f"Contenuto file: {file_content[:200]}...", "DEBUG")
                    raise json_error
                
                if not isinstance(settings, dict):
                    raise ValueError("Il file non contiene un oggetto JSON valido")
                
                # Valida e correggi la struttura
                validated_settings = _validate_settings_structure(settings)
                
                # Se le impostazioni sono state corrette, risalva il file
                if validated_settings != settings:
                    _log_event("Impostazioni corrette automaticamente, salvataggio in corso", "INFO")
                    _save_settings_atomic(validated_settings, USER_SETTINGS_FILE)
                
                return validated_settings
                
        except OSError as file_error:
            _log_event(f"File {USER_SETTINGS_FILE} non trovato o non leggibile: {file_error}", "INFO")
            raise file_error
            
    except (OSError, ValueError) as e:
        # File non trovato, danneggiato, o JSON non valido
        _log_event(f"Caricamento impostazioni utente fallito: {e}, creazione impostazioni predefinite", "WARNING")
        
        # Crea backup del file corrotto se esiste
        try:
            backup_name = f"{USER_SETTINGS_FILE}.corrupted.{int(time.time())}"
            os.rename(USER_SETTINGS_FILE, backup_name)
            _log_event(f"File corrotto salvato come backup: {backup_name}", "INFO")
        except:
            pass
        
        # Crea e salva impostazioni predefinite
        default_settings = create_default_settings()
        if _save_settings_atomic(default_settings, USER_SETTINGS_FILE):
            _log_event("Impostazioni predefinite create e salvate", "INFO")
        else:
            _log_event("Errore nella creazione delle impostazioni predefinite", "ERROR")
        
        return default_settings
    
    except Exception as e:
        _log_event(f"Errore critico nel caricamento impostazioni: {e}", "ERROR")
        # Ritorna impostazioni predefinite come fallback finale
        return create_default_settings()

def load_user_settings(force_reload=False):
    """
    Carica le impostazioni utente dal file JSON con supporto alla cache.
    Se il file non esiste o è corrotto, viene creato con valori predefiniti.
    
    Args:
        force_reload: Se True, ignora la cache e forza la rilettura dal disco
        
    Returns:
        dict: Dizionario delle impostazioni validate
    """
    if force_reload:
        invalidate_cache('settings')
    
    try:
        settings = get_cached('settings', _load_settings_uncached, ttl=60)
        
        # Doppia validazione per sicurezza
        if not isinstance(settings, dict):
            _log_event("Cache corrotta, forzo ricaricamento", "WARNING")
            invalidate_cache('settings')
            settings = _load_settings_uncached()
        
        # Assicura che language sia sempre presente
        if 'language' not in settings:
            settings['language'] = 'it'
            _save_settings_atomic(settings, USER_SETTINGS_FILE)
        
        return settings
        
    except Exception as e:
        _log_event(f"Errore fatale nel caricamento impostazioni: {e}", "ERROR")
        return create_default_settings()

def save_user_settings(settings):
    """
    Salva le impostazioni utente in un file JSON in modo atomico con validazione completa.
    
    Args:
        settings: Dizionario delle impostazioni da salvare
        
    Returns:
        boolean: True se il salvataggio è riuscito, False altrimenti
    """
    if not isinstance(settings, dict):
        _log_event("Tentativo di salvare impostazioni non valide (non un dizionario)", "ERROR")
        return False
    
    try:
        # Carica impostazioni correnti come base
        current_settings = load_user_settings(force_reload=True)
        
        if not current_settings or not isinstance(current_settings, dict):
            _log_event("Impostazioni correnti non valide, uso predefinite come base", "WARNING")
            current_settings = create_default_settings()
        
        # Merge delle nuove impostazioni con quelle esistenti
        for key, value in settings.items():
            if isinstance(value, dict) and key in current_settings and isinstance(current_settings.get(key), dict):
                # Merge ricorsivo per dizionari
                current_settings[key].update(value)
            else:
                current_settings[key] = value
        
        # Assicura che language sia sempre presente
        if 'language' not in current_settings:
            current_settings['language'] = 'it'
            _log_event("Campo 'language' mancante, aggiunto default 'it'", "INFO")
        
        # Salva con validazione
        result = _save_settings_atomic(current_settings, USER_SETTINGS_FILE)
        
        if result:
            _log_event("Impostazioni utente salvate e validate con successo", "INFO")
        else:
            _log_event("Fallimento salvataggio impostazioni utente", "ERROR")
        
        # Pulizia memoria
        gc.collect()
        
        return result
        
    except Exception as e:
        _log_event(f"Errore durante il salvataggio impostazioni: {e}", "ERROR")
        return False

def reset_user_settings():
    """
    Resetta le impostazioni utente ai valori predefiniti.
    
    Returns:
        boolean: True se il reset è riuscito, False altrimenti
    """
    try:
        _log_event("Avvio reset impostazioni utente", "INFO")
        
        # Crea backup delle impostazioni correnti se esistono
        try:
            backup_name = f"{USER_SETTINGS_FILE}.backup.{int(time.time())}"
            os.rename(USER_SETTINGS_FILE, backup_name)
            _log_event(f"Backup impostazioni creato: {backup_name}", "INFO")
        except OSError:
            # File non esiste, normale durante primo avvio
            pass
        except Exception as e:
            _log_event(f"Impossibile creare backup: {e}", "WARNING")
        
        # Crea e salva impostazioni predefinite
        default_settings = create_default_settings()
        success = _save_settings_atomic(default_settings, USER_SETTINGS_FILE)
        
        if success:
            _log_event("Reset impostazioni utente completato con successo", "INFO")
        else:
            _log_event("Fallimento reset impostazioni utente", "ERROR")
        
        return success
        
    except Exception as e:
        _log_event(f"Errore durante reset impostazioni utente: {e}", "ERROR")
        return False

def reset_factory_data():
    """
    Resetta tutti i dati ai valori di fabbrica.
    Resetta impostazioni utente, programmi e stato del programma.
    
    Returns:
        boolean: True se il reset è riuscito, False altrimenti
    """
    try:
        _log_event("Avvio reset completo dati di fabbrica", "INFO")
        
        # Lista delle operazioni di reset
        operations = [
            {
                'name': 'Impostazioni utente', 
                'func': reset_user_settings,
                'critical': True
            },
            {
                'name': 'File programmi', 
                'func': lambda: _save_settings_atomic({}, PROGRAM_FILE),
                'critical': True
            },
            {
                'name': 'Stato programma', 
                'func': lambda: _save_settings_atomic(
                    {'program_running': False, 'current_program_id': None}, 
                    '/data/program_state.json'
                ),
                'critical': True
            }
        ]
        
        # Esegui tutte le operazioni
        results = []
        critical_failures = 0
        
        for op in operations:
            try:
                _log_event(f"Eseguendo reset: {op['name']}", "INFO")
                success = op['func']()
                results.append((op['name'], success))
                
                if success:
                    _log_event(f"Reset {op['name']} completato", "INFO")
                else:
                    _log_event(f"Reset {op['name']} fallito", "WARNING")
                    if op.get('critical', False):
                        critical_failures += 1
                        
            except Exception as e:
                _log_event(f"Errore durante reset {op['name']}: {e}", "ERROR")
                results.append((op['name'], False))
                if op.get('critical', False):
                    critical_failures += 1
        
        # Determina il successo complessivo
        total_operations = len(operations)
        successful_operations = sum(1 for _, success in results if success)
        
        # Considera successo se almeno le operazioni critiche sono riuscite
        overall_success = critical_failures == 0
        
        if overall_success:
            if successful_operations == total_operations:
                _log_event("Reset completo dati di fabbrica completato con successo", "INFO")
            else:
                _log_event(f"Reset dati di fabbrica parzialmente completato: {successful_operations}/{total_operations} operazioni riuscite", "WARNING")
        else:
            _log_event(f"Reset dati di fabbrica fallito: {critical_failures} operazioni critiche fallite", "ERROR")
        
        # Pulizia memoria finale
        gc.collect()
        
        return overall_success
        
    except Exception as e:
        _log_event(f"Errore catastrofico durante reset dati di fabbrica: {e}", "ERROR")
        return False

def get_settings_info():
    """
    Restituisce informazioni di debug sulle impostazioni.
    
    Returns:
        dict: Informazioni di debug
    """
    try:
        info = {
            'file_exists': False,
            'file_size': 0,
            'settings_valid': False,
            'cache_active': False,
            'last_error': None
        }
        
        # Verifica file
        try:
            stat = os.stat(USER_SETTINGS_FILE)
            info['file_exists'] = True
            info['file_size'] = stat[6]  # Size in MicroPython stat
        except OSError:
            pass
        
        # Verifica validità impostazioni
        try:
            settings = load_user_settings()
            info['settings_valid'] = isinstance(settings, dict) and 'language' in settings
        except Exception as e:
            info['last_error'] = str(e)
        
        # Verifica cache
        try:
            cached_settings = get_cached('settings', lambda: None, ttl=0)
            info['cache_active'] = cached_settings is not None
        except:
            pass
        
        return info
        
    except Exception as e:
        return {'error': str(e)}