"""
Modulo per l'esecuzione dei programmi di irrigazione.
VERSIONE IBRIDA - Logica semplificata che funziona + funzioni originali come wrapper sicuri.
"""
import time
import uasyncio as asyncio
from log_manager import log_event
from program_state import program_running, current_program_id, save_program_state, load_program_state
from zone_manager import start_zone, stop_zone, stop_all_zones, get_active_zones_count, has_active_manual_zones, get_zones_status
from settings_manager import load_user_settings

# ===== FUNZIONE PRINCIPALE (dalla versione semplificata che funzionava) =====

async def execute_program(program, manual=False):
    """
    Esegue un programma di irrigazione.
    LOGICA DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA: Delega tutto alle zone, gestisce solo la sequenza.
    """
    if not isinstance(program, dict):
        log_event("Programma non valido", "ERROR")
        return False
    
    # Variabili globali
    global program_running, current_program_id
    
    program_id = str(program.get('id', '0'))
    program_name = program.get('name', 'Senza nome')
    steps = program.get('steps', [])
    
    if not steps:
        log_event(f"Programma '{program_name}' senza step", "ERROR")
        return False
    
    # Controlla se un altro programma è in esecuzione
    load_program_state()
    if program_running and current_program_id != program_id:
        log_event(f"Altro programma ({current_program_id}) già in esecuzione", "WARNING")
        return False
    
    # Ferma zone manuali se necessario (SEMPLICE - dalla versione che funzionava)
    if has_active_manual_zones():
        log_event("Fermando zone manuali per programma", "INFO")
        if not stop_all_zones(only_manual=True):
            log_event("Errore fermando zone manuali", "ERROR")
            return False
        await asyncio.sleep(0.5)  # Pausa per completare spegnimento
    
    # Imposta stato programma
    program_running = True
    current_program_id = program_id
    save_program_state()
    
    log_event(f"Avvio programma '{program_name}' con {len(steps)} step", "INFO")
    
    try:
        # Carica impostazioni per delay (SEMPLICE)
        settings = load_user_settings()
        activation_delay = settings.get('activation_delay', 0) if settings else 0
        
        for i, step in enumerate(steps):
            # Controlla se programma interrotto
            load_program_state()
            if not program_running:
                log_event("Programma interrotto dall'utente", "INFO")
                return False
            
            # Valida step
            if not isinstance(step, dict):
                log_event(f"Step {i+1} non valido", "WARNING")
                continue
            
            zone_id = step.get('zone_id')
            duration = step.get('duration', 1)
            
            if zone_id is None or duration <= 0:
                log_event(f"Step {i+1} parametri non validi", "WARNING")
                continue
            
            log_event(f"Step {i+1}/{len(steps)}: Zona {zone_id} per {duration} min", "INFO")
            
            # GESTIONE DELAY SEMPLIFICATA (dalla versione che funzionava)
            if i > 0:  # Non per il primo step
                if activation_delay > 0:
                    # Delay positivo: aspetta
                    log_event(f"Attesa delay {activation_delay}s", "DEBUG")
                    await _wait_with_check(activation_delay)
                # Se delay negativo o zero, procede subito
            
            # ATTIVA LA ZONA (delega tutto - dalla versione che funzionava)
            success = start_zone(zone_id, duration, manual=False)
            if not success:
                log_event(f"Errore attivazione zona {zone_id}", "ERROR")
                continue
            
            # CALCOLA ATTESA PER PROSSIMO STEP (SEMPLIFICATO)
            if i < len(steps) - 1:  # Non per l'ultimo step
                if activation_delay >= 0:
                    # Nessun overlap: aspetta che la zona finisca
                    wait_time = duration * 60
                else:
                    # Overlap: aspetta meno del tempo totale
                    overlap = abs(activation_delay)
                    wait_time = max(0, duration * 60 - overlap)
                
                if wait_time > 0:
                    log_event(f"Attesa {wait_time}s per prossimo step", "DEBUG")
                    await _wait_with_check(wait_time)
        
        # ATTESA COMPLETAMENTO ULTIMO STEP (SEMPLIFICATO)
        if steps:
            last_duration = steps[-1].get('duration', 0)
            if last_duration > 0:
                log_event(f"Attesa completamento ultimo step ({last_duration} min)", "INFO")
                await _wait_with_check(last_duration * 60)
        
        # Aggiorna data ultima esecuzione
        try:
            from program_manager import update_last_run_date
            update_last_run_date(program_id)
        except Exception as e:
            log_event(f"Errore aggiornamento data: {e}", "WARNING")
        
        log_event(f"Programma '{program_name}' completato con successo", "INFO")
        return True
        
    except Exception as e:
        log_event(f"Errore critico programma '{program_name}': {e}", "ERROR")
        import sys
        sys.print_exception(e)
        return False
    finally:
        # Reset stato programma (SEMPLICE)
        program_running = False
        current_program_id = None
        save_program_state()
        log_event(f"Stato programma '{program_name}' resettato", "INFO")

# ===== FUNZIONI HELPER (dalla versione semplificata che funzionava) =====

async def _wait_with_check(seconds):
    """
    Aspetta con controlli periodici per interruzione programma.
    DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    remaining = seconds
    while remaining > 0:
        # Aspetta max 5 secondi per volta
        chunk = min(5, remaining)
        await asyncio.sleep(chunk)
        remaining -= chunk
        
        # Controlla se programma interrotto
        load_program_state()
        if not program_running:
            log_event("Attesa interrotta - programma fermato", "DEBUG")
            break

# ===== FUNZIONI ORIGINALI (mantenute per compatibilità) =====

def stop_program():
    """
    Ferma il programma in esecuzione.
    LOGICA SEMPLIFICATA ma mantiene struttura originale.
    """
    global program_running, current_program_id
    
    load_program_state()
    
    if not program_running:
        log_event("Nessun programma da fermare", "INFO")
        return False
    
    prog_id = current_program_id or "sconosciuto"
    log_event(f"Fermando programma {prog_id}", "INFO")
    
    # Reset stato
    program_running = False
    current_program_id = None
    save_program_state()
    
    # Ferma zone del programma (non manuali) - SEMPLIFICATO
    try:
        from zone_manager import active_zones
        program_zones = [zid for zid, data in active_zones.items() 
                        if not data.get('manual', False)]
        
        if program_zones:
            log_event(f"Fermando {len(program_zones)} zone del programma", "INFO")
            for zone_id in program_zones:
                stop_zone(zone_id)
        
    except Exception as e:
        log_event(f"Errore fermando zone programma: {e}", "ERROR")
    
    log_event(f"Programma {prog_id} fermato", "INFO")
    return True

def reset_program_state():
    """Reset completo stato programma (dalla versione originale)."""
    global program_running, current_program_id
    
    log_event("Reset stato programma", "INFO")
    
    # Ferma tutte le zone
    try:
        stop_all_zones()
    except Exception as e:
        log_event(f"Errore fermando zone in reset: {e}", "ERROR")
    
    # Reset stato
    program_running = False
    current_program_id = None
    save_program_state()
    
    log_event("Reset completato", "INFO")

def get_program_state():
    """
    Ottiene stato corrente del programma con zona attiva.
    MANTIENE LOGICA ORIGINALE ma semplificata.
    """
    load_program_state()
    
    state = {
        'program_running': program_running,
        'current_program_id': current_program_id,
        'active_zone': None
    }
    
    # Se programma in esecuzione, trova zona attiva del programma
    if program_running and current_program_id:
        try:
            zones = get_zones_status()
            for zone in zones:
                if (zone.get('active', False) and 
                    not zone.get('manual', False) and 
                    zone.get('remaining_time', 0) > 0):
                    
                    # Aggiungi durata totale se disponibile
                    if zone.get('total_duration', 0) > 0:
                        zone['total_duration_seconds'] = zone['total_duration']
                    
                    state['active_zone'] = zone
                    break
                    
        except Exception as e:
            log_event(f"Errore recupero zona attiva: {e}", "WARNING")
    
    return state

# ===== WRAPPER PER COMPATIBILITÀ (NON reinserisce problemi) =====

# Le seguenti funzioni erano nella versione originale ma causavano problemi.
# Le implemento come stub/wrapper che non reintroducono i conflitti di timing.

# NON implemento:
# - Gestione complessa dell'overlap che causava cancellazioni premature
# - Loop di attesa complessi con controlli ridondanti
# - Verifiche di stato che creavano race conditions
# - Doppia gestione del timing che interferiva con i timer delle zone

# Tutte le funzioni che potrebbero essere chiamate dal codice esistente
# sono presenti, ma usano la logica semplificata che funziona.