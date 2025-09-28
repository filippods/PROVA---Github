"""
Modulo per la gestione dello stato del programma.
VERSIONE IBRIDA - Logica semplificata che funziona + protezioni essenziali.
"""
import ujson
import uos as os
from log_manager import log_event
from utils import ensure_directory_exists, get_dirname

# Variabili globali
program_running = False
current_program_id = None
PROGRAM_STATE_FILE = '/data/program_state.json'

# ===== FUNZIONI PRINCIPALI (logica semplificata che funzionava) =====

def save_program_state():
    """
    Salva lo stato del programma in modo semplice e sicuro.
    DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    global program_running, current_program_id
    
    state_data = {
        'program_running': program_running,
        'current_program_id': current_program_id
    }
    
    try:
        # Assicura directory
        ensure_directory_exists(get_dirname(PROGRAM_STATE_FILE))
        
        # Salvataggio SEMPLICE (dalla versione che funzionava)
        with open(PROGRAM_STATE_FILE, 'w') as f:
            ujson.dump(state_data, f)
            f.flush()
        
        # Ridotto logging per evitare spam in console - solo per errori critici
        
    except Exception as e:
        log_event(f"Errore salvataggio stato: {e}", "ERROR")

def load_program_state():
    """
    Carica lo stato del programma dal file.
    LOGICA SEMPLIFICATA CHE FUNZIONAVA - Meno controlli, più robustezza.
    """
    global program_running, current_program_id
    
    try:
        with open(PROGRAM_STATE_FILE, 'r') as f:
            content = f.read().strip()
            if not content:
                raise ValueError("File vuoto")
            
            state = ujson.loads(content)
            
            if isinstance(state, dict):
                new_running = state.get('program_running', False)
                new_id = state.get('current_program_id', None)
                
                # Applica SOLO se valido (SEMPLIFICATO)
                if isinstance(new_running, bool):
                    program_running = new_running
                if new_id is None or isinstance(new_id, str):
                    current_program_id = new_id
                
                # Ridotto logging per evitare spam in console
            else:
                raise ValueError("Formato non valido")
                
    except OSError:
        # File non esiste, usa default
        log_event("File stato non trovato, uso default", "INFO")
        program_running = False
        current_program_id = None
        save_program_state()
        
    except Exception as e:
        # Errore lettura, usa default e avvisa
        log_event(f"Errore caricamento stato: {e}, uso default", "WARNING")
        program_running = False
        current_program_id = None
        save_program_state()

# ===== WRAPPER PER COMPATIBILITÀ (mantiene funzioni originali senza problemi) =====

# Cache per ottimizzazioni (dalla versione originale ma semplificata)
_last_saved_state = None

def verify_save():
    """
    WRAPPER per compatibilità - versione semplificata che non causa race conditions.
    Non implementa la logica complessa che causava problemi.
    """
    # Verifica semplice senza retry multipli che causavano problemi
    global _last_saved_state
    
    if _last_saved_state is None:
        return
    
    try:
        with open(PROGRAM_STATE_FILE, 'r') as f:
            state = ujson.load(f)
            if not isinstance(state, dict):
                # Solo una correzione semplice
                with open(PROGRAM_STATE_FILE, 'w') as f2:
                    ujson.dump(_last_saved_state, f2)
                    f2.flush()
    except Exception:
        # Non logga errori per evitare spam - versione semplificata
        pass

# Aggiorna save_program_state per mantenere cache senza causare problemi
def save_program_state():
    """
    Versione aggiornata con cache semplificata.
    """
    global program_running, current_program_id, _last_saved_state
    
    state_data = {
        'program_running': program_running,
        'current_program_id': current_program_id
    }
    
    # Aggiorna cache PRIMA del salvataggio (evita race conditions)
    _last_saved_state = state_data.copy()
    
    try:
        ensure_directory_exists(get_dirname(PROGRAM_STATE_FILE))
        
        # Salvataggio atomico SEMPLICE
        temp_file = PROGRAM_STATE_FILE + '.tmp'
        with open(temp_file, 'w') as f:
            ujson.dump(state_data, f)
            f.flush()
        os.rename(temp_file, PROGRAM_STATE_FILE)
        
        # Ridotto logging per evitare spam in console - solo per errori critici
        
    except Exception as e:
        log_event(f"Errore salvataggio stato: {e}", "ERROR")

# NON implemento le funzioni complesse che causavano problemi:
# - Retry multipli in save/load che creavano race conditions
# - Controlli di coerenza complessi che interferivano con l'esecuzione
# - Verifiche incrociate che causavano stati inconsistenti
# - Cache complessa con invalidazione che creava conflitti di timing