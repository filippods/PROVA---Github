"""
Modulo per la gestione delle zone di irrigazione.
VERSIONE IBRIDA - Logica semplificata che funziona + funzioni originali come wrapper sicuri.
"""
import time
import machine
from machine import Pin
import uasyncio as asyncio
from settings_manager import load_user_settings
from log_manager import log_event
from cache_manager import get_cached, invalidate_cache

# Variabili globali semplificate (come nella versione che funzionava)
active_zones = {}      # {zone_id: {'start_time': time, 'duration': minutes, 'manual': bool, 'task': task}}
zone_pins = {}         # {zone_id: Pin object}
safety_relay = None    # Pin object per relè master
initialization_errors = []

# ===== PERSISTENZA STATO ZONE =====

ZONES_STATE_FILE = '/data/zones_state.json'

def _save_zones_state():
    """Salva lo stato corrente delle zone attive su file."""
    try:
        import ujson
        from utils import ensure_directory_exists, get_dirname
        
        # Prepara dati per serializzazione
        state_data = {}
        for zone_id, zone_data in active_zones.items():
            # Calcola tempo rimanente
            current_time = time.time()
            elapsed = current_time - zone_data['start_time']
            total_seconds = zone_data['duration'] * 60
            remaining_seconds = max(0, total_seconds - elapsed)
            
            # Salva solo se ha tempo rimanente
            if remaining_seconds > 5:  # Almeno 5 secondi rimasti
                state_data[str(zone_id)] = {
                    'remaining_minutes': remaining_seconds / 60,
                    'manual': zone_data.get('manual', True),
                    'original_duration': zone_data['duration']
                }
        
        # Salva su file
        ensure_directory_exists(get_dirname(ZONES_STATE_FILE))
        with open(ZONES_STATE_FILE, 'w') as f:
            ujson.dump(state_data, f)
            
        log_event(f"Stato zone salvato: {len(state_data)} zone attive", "DEBUG")
        return True
        
    except Exception as e:
        log_event(f"Errore salvataggio stato zone: {e}", "ERROR")
        return False

def _load_zones_state():
    """Carica e ripristina lo stato delle zone da file."""
    try:
        import ujson
        import uos as os
        
        # Verifica esistenza file
        try:
            os.stat(ZONES_STATE_FILE)
        except OSError:
            log_event("File stato zone non trovato, partenza pulita", "INFO")
            return False
            
        # Carica dati
        with open(ZONES_STATE_FILE, 'r') as f:
            state_data = ujson.load(f)
            
        if not isinstance(state_data, dict):
            log_event("Formato stato zone non valido", "WARNING")
            return False
            
        # Ripristina zone attive
        restored_count = 0
        for zone_id_str, zone_state in state_data.items():
            try:
                zone_id = int(zone_id_str)
                remaining_minutes = zone_state.get('remaining_minutes', 0)
                manual = zone_state.get('manual', True)
                
                # Verifica che la zona sia ancora valida
                if zone_id in zone_pins and remaining_minutes > 0.1:
                    # Riattiva la zona
                    if _restore_zone_state(zone_id, remaining_minutes, manual):
                        restored_count += 1
                        log_event(f"Zona {zone_id} ripristinata: {remaining_minutes:.1f} min rimanenti", "INFO")
                        
            except Exception as e:
                log_event(f"Errore ripristino zona {zone_id_str}: {e}", "ERROR")
                
        # Rimuovi file stato dopo il ripristino
        try:
            os.remove(ZONES_STATE_FILE)
        except:
            pass
            
        if restored_count > 0:
            log_event(f"Ripristinate {restored_count} zone attive dopo riavvio", "INFO")
            
        return restored_count > 0
        
    except Exception as e:
        log_event(f"Errore caricamento stato zone: {e}", "ERROR")
        return False

def _restore_zone_state(zone_id, remaining_minutes, manual):
    """Ripristina una singola zona allo stato precedente."""
    global active_zones
    
    try:
        # Attiva fisicamente la zona
        zone_pins[zone_id].value(0)  # Accendi
        
        # Attiva relè sicurezza se necessario
        if safety_relay and len(active_zones) == 0:
            safety_relay.value(0)
            
        # Crea timer per il tempo rimanente
        task = asyncio.create_task(_zone_timer_simple(zone_id, remaining_minutes))
        
        # Aggiorna active_zones
        active_zones[zone_id] = {
            'start_time': time.time(),
            'duration': remaining_minutes,
            'manual': manual,
            'task': task
        }
        
        return True
        
    except Exception as e:
        log_event(f"Errore fisico ripristino zona {zone_id}: {e}", "ERROR")
        return False

def _cleanup_zones_state_file():
    """Rimuove il file di stato se esiste."""
    try:
        import uos as os
        try:
            os.stat(ZONES_STATE_FILE)
            os.remove(ZONES_STATE_FILE)
        except OSError:
            # File non esiste, nulla da rimuovere
            pass
    except:
        pass

def shutdown_zones():
    """
    Spegne tutte le zone e pulisce il file di stato.
    Da chiamare durante lo shutdown pulito del sistema.
    """
    log_event("Shutdown zone manager - spegnimento tutte le zone", "INFO")
    
    # Ferma tutte le zone senza salvare stato (è uno shutdown)
    stop_all_zones(save_state=False)
    
    # Pulisci file di stato
    _cleanup_zones_state_file()
    
    log_event("Shutdown zone manager completato", "INFO")

_settings_cache = None
_cache_time = 0

def _get_settings():
    """Carica impostazioni con cache semplice (dalla versione che funzionava)."""
    global _settings_cache, _cache_time
    now = time.time()
    if _settings_cache is None or (now - _cache_time) > 30:
        _settings_cache = load_user_settings()
        _cache_time = now
    return _settings_cache

# ===== FUNZIONI WRAPPER PER COMPATIBILITÀ (senza reinserire problemi) =====

def _load_settings_for_zones():
    """Wrapper per compatibilità con codice esistente."""
    return _get_settings()

def _validate_pin_number(pin_number, zone_id=None):
    """Validazione pin semplificata per ESP32-S3."""
    if not isinstance(pin_number, int):
        return False
    if pin_number < 0 or pin_number > 48:
        return False
    # Solo pin critici da evitare
    if pin_number in {19, 20, 45}:
        return False
    # Avviso per strapping pins ma permetti uso
    if pin_number in {0, 3, 46} and zone_id is not None:
        log_event(f"INFO: Pin {pin_number} (zona {zone_id}) è uno strapping pin ma funziona normalmente", "INFO")
    return True

def _test_pin_availability(pin_number):
    """Test pin semplificato."""
    try:
        test_pin = Pin(pin_number, Pin.OUT)
        test_pin.value(1)
        test_pin.value(0)
        test_pin.value(1)
        return True, None
    except Exception as e:
        return False, str(e)

# ===== INIZIALIZZAZIONE (semplificata dalla versione che funzionava) =====

def initialize_pins():
    """
    Inizializza i pin delle zone in modo semplice e robusto (dalla versione che funzionava).
    Ora include ripristino dello stato delle zone attive prima del riavvio.
    """
    global zone_pins, safety_relay, initialization_errors
    
    zone_pins.clear()
    safety_relay = None
    initialization_errors.clear()
    
    log_event("Inizializzazione pin zone", "INFO")
    
    settings = _get_settings()
    if not settings or not settings.get('zones'):
        log_event("Nessuna zona configurata", "ERROR")
        return False
    
    zones_ok = 0
    
    # Inizializza pin zone (logica semplice)
    for zone in settings['zones']:
        if not isinstance(zone, dict) or zone.get('status') != 'show':
            continue
            
        zone_id = zone.get('id')
        pin_num = zone.get('pin')
        zone_name = zone.get('name', f'Zona {zone_id + 1}')
        
        if zone_id is None or pin_num is None:
            continue
        
        if not _validate_pin_number(pin_num, zone_id):
            error = f"{zone_name} (Pin {pin_num}): Pin non utilizzabile"
            initialization_errors.append(error)
            log_event(error, "ERROR")
            continue
        
        try:
            pin = Pin(pin_num, Pin.OUT)
            pin.value(1)  # Spento (logica inversa)
            zone_pins[zone_id] = pin
            zones_ok += 1
            log_event(f"{zone_name} (ID:{zone_id}) -> Pin {pin_num} OK", "INFO")
        except Exception as e:
            error = f"{zone_name} (Pin {pin_num}): {str(e)}"
            initialization_errors.append(error)
            log_event(error, "ERROR")
    
    # Inizializza relè sicurezza (logica semplice)
    safety_pin = settings.get('safety_relay', {}).get('pin')
    if safety_pin is not None and _validate_pin_number(safety_pin):
        try:
            safety_relay = Pin(safety_pin, Pin.OUT)
            safety_relay.value(1)  # Spento
            log_event(f"Relè sicurezza Pin {safety_pin} OK", "INFO")
        except Exception as e:
            error = f"Relè sicurezza Pin {safety_pin}: {str(e)}"
            initialization_errors.append(error)
            log_event(error, "ERROR")
    
    log_event(f"Inizializzazione completata: {zones_ok} zone attive", "INFO")
    
    # NOVITÀ: Ripristina stato zone precedenti al riavvio
    if zones_ok > 0:
        try:
            _load_zones_state()
        except Exception as e:
            log_event(f"Errore ripristino stato zone: {e}", "WARNING")
    
    return zones_ok > 0


# ===== FUNZIONI STATO (dalla versione che funzionava) =====

def get_zones_status():
    """Restituisce lo stato di tutte le zone configurate (logica semplificata)."""
    settings = _get_settings()
    if not settings:
        return []
    
    zones_status = []
    current_time = time.time()
    
    for zone in settings.get('zones', []):
        if not isinstance(zone, dict) or zone.get('status') != 'show':
            continue
            
        zone_id = zone.get('id')
        if zone_id is None:
            continue
        
        # Stato base
        status = {
            'id': zone_id,
            'name': zone.get('name', f'Zona {zone_id + 1}'),
            'pin': zone.get('pin', 0),
            'available': zone_id in zone_pins,
            'active': zone_id in active_zones,
            'remaining_time': 0,
            'total_duration': 0,
            'manual': False
        }
        
        # Se attiva, calcola tempo rimanente
        if zone_id in active_zones:
            zone_data = active_zones[zone_id]
            elapsed = current_time - zone_data['start_time']
            total_seconds = zone_data['duration'] * 60
            remaining = max(0, total_seconds - elapsed)
            
            status.update({
                'remaining_time': int(remaining),
                'total_duration': int(total_seconds),
                'manual': zone_data.get('manual', False)
            })
        
        zones_status.append(status)
    
    return zones_status

def get_active_zones_count():
    """Conta zone attive."""
    return len([zid for zid in active_zones if zid in zone_pins])

def get_manual_zones_count():
    """Conta zone manuali attive."""
    return len([zid for zid, data in active_zones.items() 
               if zid in zone_pins and data.get('manual', False)])

def has_active_manual_zones():
    """Verifica se ci sono zone manuali attive."""
    return get_manual_zones_count() > 0

def get_initialization_status():
    """Stato inizializzazione per diagnostica (wrapper semplificato)."""
    return {
        'zones_initialized': len(zone_pins),
        'safety_relay_initialized': safety_relay is not None,
        'total_errors': len(initialization_errors),
        'errors': initialization_errors.copy(),
        'available_zones': list(zone_pins.keys()),
        'esp32_s3_info': {
            'user_configured_pins': [14, 13, 12, 11, 10, 9, 46, 3, 15],
            'working_user_pins': list(range(48)),
            'strapping_pins_in_use': [46, 3],
            'psram_warning': "Pin 35-37 evitati se PSRAM ottale presente",
            'usb_warning': "Pin 19-20 riservati per USB",
            'strapping_warning': "Pin 3,46 sono strapping pins - usa con cautela"
        }
    }

# ===== FUNZIONI CORE (dalla versione semplificata che funzionava) =====

def start_zone(zone_id, duration_minutes, manual=True):
    """
    Attiva una zona per una durata specifica.
    LOGICA DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    global active_zones, zone_pins, safety_relay
    
    try:
        zone_id = int(zone_id)
        duration_minutes = int(duration_minutes)
    except (ValueError, TypeError):
        log_event(f"Parametri non validi: zone_id={zone_id}, duration={duration_minutes}", "ERROR")
        return False
    
    # Verifica pin disponibile
    if zone_id not in zone_pins:
        log_event(f"Zona {zone_id} non disponibile", "ERROR")
        return False
    
    # Valida durata
    settings = _get_settings()
    max_duration = settings.get('max_zone_duration', 180) if settings else 180
    if duration_minutes <= 0 or duration_minutes > max_duration:
        log_event(f"Durata non valida: {duration_minutes} min (max: {max_duration})", "ERROR")
        return False
    
    # SOLO per zone manuali, controllo programma semplice
    if manual:
        try:
            from program_state import program_running, load_program_state
            load_program_state()
            if program_running:
                log_event(f"Zona {zone_id} manuale bloccata: programma in esecuzione", "WARNING")
                return False
        except Exception:
            pass  # Se non riesce a controllare, procede
    
    # Controllo limite zone manuali
    if manual:
        max_active = settings.get('max_active_zones', 3) if settings else 3
        current_manual = get_manual_zones_count()
        if current_manual >= max_active and zone_id not in active_zones:
            log_event(f"Limite zone manuali raggiunto: {current_manual}/{max_active}", "WARNING")
            return False
    
    # Ferma eventuale zona già attiva (semplice)
    if zone_id in active_zones:
        stop_zone(zone_id)
    
    # Attiva relè sicurezza se prima zona
    if safety_relay and len(active_zones) == 0:
        try:
            safety_relay.value(0)  # Accendi
            log_event("Relè sicurezza attivato", "DEBUG")
        except Exception as e:
            log_event(f"Errore relè sicurezza: {e}", "ERROR")
            return False
    
    # Attiva zona
    try:
        zone_pins[zone_id].value(0)  # Accendi (logica inversa)
        log_event(f"Zona {zone_id} attivata per {duration_minutes} min ({'manuale' if manual else 'programma'})", "INFO")
    except Exception as e:
        log_event(f"Errore attivazione zona {zone_id}: {e}", "ERROR")
        return False
    
    # Crea timer SEMPLICE (dalla versione che funzionava)
    try:
        task = asyncio.create_task(_zone_timer_simple(zone_id, duration_minutes))
        active_zones[zone_id] = {
            'start_time': time.time(),
            'duration': duration_minutes,
            'manual': manual,
            'task': task
        }
        
        # NOVITÀ: Salva stato zone dopo attivazione
        _save_zones_state()
        
        return True
    except Exception as e:
        log_event(f"Errore timer zona {zone_id}: {e}", "ERROR")
        # Spegni zona se timer fallisce
        try:
            zone_pins[zone_id].value(1)
        except:
            pass
        return False


async def _zone_timer_simple(zone_id, duration_minutes):
    """
    Timer interno della zona - DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    try:
        total_seconds = duration_minutes * 60
        log_event(f"Timer zona {zone_id}: {duration_minutes} minuti", "DEBUG")
        
        # SLEEP ATOMICO - LA PARTE CHE FUNZIONAVA
        await asyncio.sleep(total_seconds)
        
        # Spegni automaticamente
        log_event(f"Timer zona {zone_id} scaduto - spegnimento automatico", "INFO")
        _stop_zone_internal(zone_id)
        
    except asyncio.CancelledError:
        log_event(f"Timer zona {zone_id} cancellato", "DEBUG")
        raise
    except Exception as e:
        log_event(f"Errore timer zona {zone_id}: {e}", "ERROR")
        _stop_zone_internal(zone_id)

def _stop_zone_internal(zone_id):
    """Ferma una zona internamente (dalla versione semplificata)."""
    global active_zones, zone_pins, safety_relay
    
    if zone_id not in zone_pins:
        return
    
    # Spegni pin
    try:
        zone_pins[zone_id].value(1)  # Spento (logica inversa)
        log_event(f"Zona {zone_id} spenta", "DEBUG")
    except Exception as e:
        log_event(f"Errore spegnimento zona {zone_id}: {e}", "ERROR")
    
    # Rimuovi da zone attive
    was_last = len(active_zones) == 1 and zone_id in active_zones
    if zone_id in active_zones:
        del active_zones[zone_id]
    
    # Spegni relè sicurezza se era ultima zona
    if safety_relay and was_last and len(active_zones) == 0:
        try:
            safety_relay.value(1)  # Spento
            log_event("Relè sicurezza disattivato", "DEBUG")
        except Exception as e:
            log_event(f"Errore spegnimento relè sicurezza: {e}", "ERROR")
    
    # NOVITÀ: Salva stato zone dopo spegnimento
    _save_zones_state()


def stop_zone(zone_id):
    """Ferma una zona manualmente (dalla versione semplificata)."""
    try:
        zone_id = int(zone_id)
    except (ValueError, TypeError):
        log_event(f"ID zona non valido: {zone_id}", "ERROR")
        return False
    
    if zone_id not in active_zones:
        log_event(f"Zona {zone_id} non attiva", "INFO")
        return True
    
    # Cancella timer se esiste
    zone_data = active_zones.get(zone_id)
    if zone_data and 'task' in zone_data:
        try:
            task = zone_data['task']
            if task and not task.cancelled():
                task.cancel()
        except Exception as e:
            log_event(f"Errore cancellazione timer zona {zone_id}: {e}", "WARNING")
    
    # Spegni zona
    _stop_zone_internal(zone_id)
    log_event(f"Zona {zone_id} fermata manualmente", "INFO")
    return True

def stop_all_zones(only_manual=False, save_state=True):
    """Ferma tutte le zone o solo quelle manuali (dalla versione semplificata)."""
    global active_zones
    
    # Identifica zone da fermare
    zones_to_stop = []
    for zone_id, zone_data in list(active_zones.items()):
        if only_manual:
            if zone_data.get('manual', False):
                zones_to_stop.append(zone_id)
        else:
            zones_to_stop.append(zone_id)
    
    if not zones_to_stop:
        return True
    
    log_event(f"Fermando {len(zones_to_stop)} zone {'manuali' if only_manual else ''}", "INFO")
    
    success = True
    for zone_id in zones_to_stop:
        if not _stop_zone_direct(zone_id, save_state):
            success = False
    
    return success

def _stop_zone_direct(zone_id, save_state=True):
    """
    Ferma una zona direttamente con controllo del salvataggio stato.
    """
    global active_zones
    
    if zone_id not in active_zones:
        return True
    
    # Cancella il task se esiste
    zone_data = active_zones.get(zone_id)
    if zone_data and 'task' in zone_data:
        try:
            zone_data['task'].cancel()
        except:
            pass
    
    # Ferma fisicamente la zona
    _stop_zone_internal_no_save(zone_id)
    
    # Salva stato solo se richiesto
    if save_state:
        _save_zones_state()
    
    log_event(f"Zona {zone_id} fermata {'con' if save_state else 'senza'} salvataggio stato", "DEBUG")
    return True

def _stop_zone_internal_no_save(zone_id):
    """Ferma una zona internamente senza salvare lo stato."""
    global active_zones, zone_pins, safety_relay
    
    if zone_id not in zone_pins:
        return
    
    # Spegni pin
    try:
        zone_pins[zone_id].value(1)  # Spento (logica inversa)
        log_event(f"Zona {zone_id} spenta", "DEBUG")
    except Exception as e:
        log_event(f"Errore spegnimento zona {zone_id}: {e}", "ERROR")
    
    # Rimuovi da zone attive
    was_last = len(active_zones) == 1 and zone_id in active_zones
    if zone_id in active_zones:
        del active_zones[zone_id]
    
    # Spegni relè sicurezza se era ultima zona
    if safety_relay and was_last and len(active_zones) == 0:
        try:
            safety_relay.value(1)  # Spento
            log_event("Relè sicurezza disattivato", "DEBUG")
        except Exception as e:
            log_event(f"Errore spegnimento relè sicurezza: {e}", "ERROR")

# ===== FUNZIONI WRAPPER PER COMPATIBILITÀ (senza reinserire problemi) =====

# Queste sono le funzioni che erano nei file originali ma causavano problemi
# Le implemento come wrapper sicuri che non interferiscono

async def _zone_timer(zone_id, duration):
    """
    WRAPPER per compatibilità - delega al timer semplice che funziona.
    NON USA la logica complessa originale che causava problemi.
    """
    await _zone_timer_simple(zone_id, duration)

async def _safe_stop_zone(zone_id):
    """WRAPPER per compatibilità - delega alla funzione interna."""
    _stop_zone_internal(zone_id)

# Non implemento le funzioni complesse che causavano race conditions:
# - verify_save() complessa
# - loop con controlli nel timer 
# - gestione overlap complessa
# - controlli di stato ridondanti