"""
API handler per la gestione dei programmi di irrigazione.
VERSIONE IBRIDA - Mantiene tutte le funzioni originali con logica semplificata che funziona.
"""
from microdot import Response
import ujson
import uasyncio as asyncio
from log_manager import log_event

def json_response(data, status_code=200):
    """Helper per risposte JSON."""
    return Response(
        body=ujson.dumps(data),
        status_code=status_code,
        headers={'Content-Type': 'application/json'}
    )

# ===== API SEMPLICI (dalla versione che funzionava) =====

def get_programs(request):
    """API per ottenere i programmi."""
    try:
        from program_manager import load_programs
        programs = load_programs()
        return json_response(programs)
    except Exception as e:
        log_event(f"Errore get_programs: {e}", "ERROR")
        return json_response({}, 200)

def save_program_route(request):
    """API per salvare nuovo programma (logica semplificata)."""
    try:
        from program_manager import load_programs, save_programs, check_program_conflicts
        
        # Dati
        program_data = request.json
        if program_data is None:
            try:
                program_data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)

        # Validazioni base (dalla versione semplificata)
        if len(program_data.get('name', '')) > 16:
            return json_response({'success': False, 'error': 'Nome troppo lungo (max 16 caratteri)'}, 400)
        if not program_data.get('months'):
            return json_response({'success': False, 'error': 'Seleziona almeno un mese'}, 400)
        if not program_data.get('steps'):
            return json_response({'success': False, 'error': 'Seleziona almeno una zona'}, 400)

        programs = load_programs()

        # Verifica nome duplicato
        for existing_program in programs.values():
            if existing_program['name'] == program_data['name']:
                return json_response({'success': False, 'error': 'Nome programma già esistente'}, 400)

        # Verifica conflitti
        has_conflict, conflict_message = check_program_conflicts(program_data, programs)
        if has_conflict:
            return json_response({'success': False, 'error': conflict_message}, 400)

        # Genera ID e salva
        new_id = '1'
        if programs:
            new_id = str(max([int(pid) for pid in programs.keys()]) + 1)
        program_data['id'] = new_id
        programs[new_id] = program_data
        
        if save_programs(programs):
            log_event(f"Programma '{program_data['name']}' creato con ID {new_id}", "INFO")
            return json_response({'success': True, 'program_id': new_id})
        else:
            return json_response({'success': False, 'error': 'Errore salvataggio'}, 500)
            
    except Exception as e:
        log_event(f"Errore save_program: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def update_program_route(request):
    """API per aggiornare programma."""
    try:
        from program_manager import update_program
        
        updated_program_data = request.json
        if updated_program_data is None:
            try:
                updated_program_data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)
                
        program_id = updated_program_data.get('id')
        if program_id is None:
            return json_response({'success': False, 'error': 'ID programma mancante'}, 400)

        # Validazione nome
        if len(updated_program_data.get('name', '')) > 16:
            return json_response({'success': False, 'error': 'Nome troppo lungo (max 16 caratteri)'}, 400)

        success, error_msg = update_program(program_id, updated_program_data)
        if success:
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': error_msg}, 400)
            
    except Exception as e:
        log_event(f"Errore update_program: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def delete_program_route(request):
    """API per eliminare programma."""
    try:
        from program_manager import delete_program
        
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)
                
        program_id = data.get('id')
        if program_id is None:
            return json_response({'success': False, 'error': 'ID programma mancante'}, 400)

        if delete_program(program_id):
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': 'Programma non trovato'}, 404)
            
    except Exception as e:
        log_event(f"Errore delete_program: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

# ===== API START PROGRAM (logica dalla versione semplificata che funzionava) =====

async def start_program_route(request):
    """
    API per avviare programma manualmente.
    LOGICA DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    try:
        from program_manager import load_programs
        from program_execution import execute_program
        from program_state import load_program_state, program_running
        
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)
                
        program_id = str(data.get('program_id', ''))
        if not program_id:
            return json_response({'success': False, 'error': 'ID programma mancante'}, 400)

        # Carica programma
        programs = load_programs()
        program = programs.get(program_id)
        if not program:
            return json_response({'success': False, 'error': 'Programma non trovato'}, 404)

        # Verifica se già in esecuzione
        load_program_state()
        if program_running:
            return json_response({'success': False, 'error': 'Altro programma in esecuzione'}, 400)

        # DALLA VERSIONE SEMPLIFICATA: Esecuzione diretta in background
        log_event(f"Avvio manuale programma '{program.get('name', '')}'", "INFO")
        asyncio.create_task(_execute_program_simple(program))
        
        # Risposta immediata
        return json_response({'success': True, 'message': 'Programma avviato'})
        
    except Exception as e:
        log_event(f"Errore start_program: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

async def _execute_program_simple(program):
    """
    Esegue programma in background.
    DALLA VERSIONE SEMPLIFICATA CHE FUNZIONAVA.
    """
    try:
        from program_execution import execute_program
        result = await execute_program(program, manual=True)
        
        if result:
            log_event(f"Programma '{program.get('name', '')}' completato con successo", "INFO")
        else:
            log_event(f"Programma '{program.get('name', '')}' fallito o interrotto", "WARNING")
            
    except Exception as e:
        log_event(f"Errore esecuzione background: {e}", "ERROR")

# ===== API RESTANTI (dalla versione originale ma semplificate) =====

def stop_program_route(request):
    """API per fermare programma."""
    try:
        from program_execution import stop_program
        
        success = stop_program()
        return json_response({'success': success, 'message': 'Programma fermato' if success else 'Nessun programma da fermare'})
        
    except Exception as e:
        log_event(f"Errore stop_program: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def get_program_state(request):
    """API per stato programma."""
    try:
        from program_execution import get_program_state
        state = get_program_state()
        return json_response(state)
    except Exception as e:
        log_event(f"Errore get_program_state: {e}", "ERROR")
        return json_response({'program_running': False, 'current_program_id': None})

def toggle_program_automatic(request):
    """API per toggle automazione programma."""
    try:
        from program_manager import load_programs, save_programs
        
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)
                
        program_id = data.get('program_id')
        enable = data.get('enable', True)
        
        if not program_id:
            return json_response({'success': False, 'error': 'ID programma mancante'}, 400)
                
        programs = load_programs()
        if program_id not in programs:
            return json_response({'success': False, 'error': 'Programma non trovato'}, 404)
                
        programs[program_id]['automatic_enabled'] = enable
        
        if save_programs(programs):
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': 'Errore salvataggio'}, 500)
            
    except Exception as e:
        log_event(f"Errore toggle_program_automatic: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def toggle_automatic_programs(request):
    """API per toggle programmi automatici globale."""
    try:
        from settings_manager import load_user_settings, save_user_settings
        
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                data = {}
                
        enable = data.get('enable', False)
        
        settings = load_user_settings()
        settings['automatic_programs_enabled'] = enable
        
        if save_user_settings(settings):
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': 'Errore salvataggio impostazioni'}, 500)
            
    except Exception as e:
        log_event(f"Errore toggle_automatic_programs: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

# ===== WRAPPER PER COMPATIBILITÀ =====

# Mantiene la funzione execute_and_respond per compatibilità ma usa logica semplificata
async def execute_and_respond(program):
    """WRAPPER per compatibilità - delega alla versione semplificata."""
    await _execute_program_simple(program)

# NON implemento le validazioni complesse che causavano problemi:
# - Controlli ridondanti di stato che interferivano con l'esecuzione
# - Verifiche incrociate che creavano race conditions
# - Logiche di retry che rallentavano le API