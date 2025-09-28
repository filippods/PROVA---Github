"""
API handler per le funzioni di sistema.
"""
from microdot import Response
import ujson
import uasyncio as asyncio
import machine
# import gc # gc non è più usato direttamente qui dopo la rimozione di get_server_stats
import time
from log_manager import log_event
from utils import format_datetime

def json_response(data, status_code=200):
    """
    Helper per creare risposte JSON standardizzate.
    """
    return Response(
        body=ujson.dumps(data),
        status_code=status_code,
        headers={'Content-Type': 'application/json'}
    )

# La funzione get_system_logs è stata rimossa.
# Il download dei log è gestito direttamente da web_server.py tramite send_file.

# La funzione clear_system_logs è stata rimossa.
# La funzionalità di cancellazione log è stata eliminata.

def restart_system_route(request):
    """API per riavviare il sistema."""
    try:
        from zone_manager import stop_all_zones
        # Ferma tutte le zone per sicurezza
        stop_all_zones()
        
        log_event("Riavvio sistema richiesto", "INFO")
        
        # Ritardo per consentire l'invio della risposta
        asyncio.create_task(_delayed_reset(2))
        return json_response({'success': True, 'message': 'Sistema in riavvio'})
    except Exception as e:
        log_event("Errore restart_system: {}".format(e), "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

async def _delayed_reset(delay_seconds):
    """Esegue un reset del sistema dopo un ritardo specificato."""
    await asyncio.sleep(delay_seconds)
    machine.reset()

def reset_settings_route(request):
    """API per ripristinare le impostazioni predefinite."""
    try:
        from settings_manager import reset_user_settings
        success = reset_user_settings()
        
        if success:
            log_event("Impostazioni resettate", "INFO")
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': 'Errore reset impostazioni'}, 500)
    except Exception as e:
        log_event("Errore reset_settings: {}".format(e), "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def reset_factory_data_route(request):
    """API per ripristinare le impostazioni e i dati di fabbrica."""
    try:
        from settings_manager import reset_factory_data
        from file_cache import clear_cache # Assumendo che file_cache sia ancora usato
        
        success = reset_factory_data()
        
        # Invalida tutte le cache se file_cache è disponibile
        if hasattr(clear_cache, '__call__'):
            clear_cache()
        
        if success:
            log_event("Reset dati di fabbrica completato", "INFO")
            return json_response({'success': True})
        else:
            return json_response({'success': False, 'error': 'Errore reset dati'}, 500)
    except Exception as e:
        log_event("Errore reset_factory_data: {}".format(e), "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def emergency_stop_all_route(request):
    """API per arresto totale immediato di zone e programmi."""
    try:
        from zone_manager import stop_all_zones
        from program_execution import stop_program
        
        log_event("ARRESTO TOTALE richiesto", "WARNING")
        
        # Ferma tutti i programmi in esecuzione
        stop_program()
        
        # Ferma tutte le zone (manuali e programmate)
        stop_all_zones(only_manual=False, save_state=True)
        
        log_event("ARRESTO TOTALE completato", "WARNING")
        return json_response({'success': True, 'message': 'Arresto totale completato'})
        
    except Exception as e:
        log_event("Errore emergency_stop_all: {}".format(e), "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def download_system_logs_route(request):
    """API per scaricare i log di sistema come file."""
    try:
        from log_manager import get_logs
        
        # Ottieni tutti i log
        logs = get_logs()
        
        if not logs:
            return json_response({'success': False, 'error': 'Nessun log disponibile'}, 404)
        
        # Crea contenuto del file log
        log_content = []
        log_content.append("=== LOG DI SISTEMA IRRIGASMART ===")
        # Fix: usa time.localtime() per MicroPython
        current_time = time.localtime()
        log_content.append("Generato: {}".format(format_datetime(current_time, 'full')))
        log_content.append("Totale eventi: {}".format(len(logs)))
        log_content.append("=" * 50)
        log_content.append("")
        
        # Categorizza e formatta i log
        for log_entry in logs:
            date = log_entry.get('date', 'N/A')
            time_str = log_entry.get('time', 'N/A')
            level = log_entry.get('level', 'INFO')
            message = log_entry.get('message', 'N/A')
            
            # Formatta l'entry del log
            formatted_entry = "[{} {}] [{}] {}".format(date, time_str, level, message)
            log_content.append(formatted_entry)
        
        # Crea la response con il file di download
        log_text = '\n'.join(log_content)
        
        log_event("Log di sistema scaricati", "INFO")
        
        return Response(
            body=log_text,
            status_code=200,
            headers={
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': 'attachment; filename="irrigasmart_logs_{}.txt"'.format(format_datetime(current_time, 'filename'))
            }
        )
        
    except Exception as e:
        log_event("Errore download_system_logs: {}".format(e), "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

# La funzione get_server_stats è stata rimossa.
# La diagnostica server è stata eliminata.
# La funzione get_network_interfaces è stata spostata direttamente in web_server.py per evitare problemi di import.