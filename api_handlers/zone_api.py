"""
API handler per la gestione delle zone di irrigazione.
VERSIONE IBRIDA - Mantiene tutte le diagnostiche originali con logica semplificata che funziona.
"""
from microdot import Response
import ujson
from log_manager import log_event
from settings_manager import load_user_settings

def json_response(data, status_code=200):
    """Helper per risposte JSON."""
    return Response(
        body=ujson.dumps(data),
        status_code=status_code,
        headers={'Content-Type': 'application/json'}
    )

# ===== API STATO ZONE (mantiene diagnostiche originali) =====

def get_zones_status_endpoint(request):
    """API per stato delle zone con diagnostica completa."""
    try:
        from zone_manager import get_zones_status, get_initialization_status
        
        zones_status = get_zones_status()
        init_status = get_initialization_status()
        
        response_data = {
            'zones': zones_status if isinstance(zones_status, list) else [],
            'diagnostics': {
                'zones_initialized': init_status.get('zones_initialized', 0),
                'safety_relay_ok': init_status.get('safety_relay_initialized', False),
                'total_errors': init_status.get('total_errors', 0),
                'available_zones': init_status.get('available_zones', [])
            }
        }
        
        if init_status.get('total_errors', 0) > 0:
            response_data['diagnostics']['errors'] = init_status.get('errors', [])
        
        return json_response(response_data)
        
    except Exception as e:
        log_event(f"Errore get_zones_status_endpoint: {e}", "ERROR")
        return json_response({
            'zones': [],
            'diagnostics': {
                'zones_initialized': 0,
                'safety_relay_ok': False,
                'total_errors': 1,
                'errors': [f"Errore sistema: {str(e)}"],
                'available_zones': []
            }
        }, 200)

def get_zones(request):
    """API per lista zone configurate."""
    try:
        settings = load_user_settings()
        if not settings or not isinstance(settings, dict):
            return json_response({'error': 'Impostazioni non disponibili'}, 500)
            
        zones = settings.get('zones', [])
        if not isinstance(zones, list):
            zones = []
        
        # Aggiungi info disponibilità
        try:
            from zone_manager import get_initialization_status
            init_status = get_initialization_status()
            available_zones = set(init_status.get('available_zones', []))
            
            for zone in zones:
                if isinstance(zone, dict) and 'id' in zone:
                    zone['available'] = zone['id'] in available_zones
        except Exception:
            pass  # Non critico
        
        return json_response(zones)
        
    except Exception as e:
        log_event(f"Errore get_zones: {e}", "ERROR")
        return json_response({'error': str(e)}, 500)

# ===== API START ZONE (logica semplificata che funziona) =====

def handle_start_zone(request):
    """
    API per avviare zona.
    LOGICA SEMPLIFICATA CHE FUNZIONA - Delega tutto a zone_manager.
    """
    try:
        from zone_manager import start_zone, get_initialization_status
        
        # Dati
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'error': 'Dati JSON non validi', 'success': False}, 400)

        if not isinstance(data, dict):
            return json_response({'error': 'Formato dati non valido', 'success': False}, 400)

        zone_id = data.get('zone_id')
        duration = data.get('duration')

        if zone_id is None or duration is None:
            return json_response({'error': 'Parametri mancanti (zone_id e duration)', 'success': False}, 400)

        # Validazione SEMPLICE
        try:
            zone_id = int(zone_id)
            duration = int(duration)
        except (ValueError, TypeError):
            return json_response({'error': 'Parametri devono essere numeri', 'success': False}, 400)

        # Verifica disponibilità zona
        init_status = get_initialization_status()
        available_zones = init_status.get('available_zones', [])
        
        if zone_id not in available_zones:
            return json_response({
                'error': f"Zona {zone_id} non disponibile",
                'success': False,
                'diagnostics': {'available_zones': available_zones}
            }, 400)

        # Validazione durata SEMPLICE
        settings = load_user_settings()
        max_duration = settings.get('max_zone_duration', 180) if settings and isinstance(settings, dict) else 180
        
        if duration <= 0:
            return json_response({'error': f'Durata non valida: {duration}', 'success': False}, 400)
        elif duration > max_duration:
            return json_response({'error': f'Durata troppo lunga: {duration} > {max_duration} minuti', 'success': False}, 400)

        # DELEGA TUTTO A start_zone (dalla versione che funzionava)
        result = start_zone(zone_id, duration, manual=True)
        
        if result:
            log_event(f"Zona {zone_id} avviata manualmente per {duration} minuti via API", "INFO")
            return json_response({
                "success": True,
                "message": f"Zona {zone_id} avviata per {duration} minuti"
            })
        else:
            return json_response({
                'error': f"Errore nell'avvio della zona {zone_id}",
                'success': False
            }, 500)
            
    except Exception as e:
        log_event(f"Errore handle_start_zone: {e}", "ERROR")
        return json_response({'error': f'Errore interno: {str(e)}', 'success': False}, 500)

# ===== API STOP ZONE (logica semplificata che funziona) =====

def handle_stop_zone(request):
    """
    API per fermare zona.
    LOGICA SEMPLIFICATA CHE FUNZIONA - Delega tutto a zone_manager.
    """
    try:
        from zone_manager import stop_zone, get_initialization_status
        
        # Dati
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except:
                return json_response({'error': 'Dati JSON non validi', 'success': False}, 400)

        if not isinstance(data, dict):
            return json_response({'error': 'Formato dati non valido', 'success': False}, 400)

        zone_id = data.get('zone_id')
        if zone_id is None:
            return json_response({'error': 'Parametro zone_id mancante', 'success': False}, 400)

        # Validazione
        try:
            zone_id = int(zone_id)
        except (ValueError, TypeError):
            return json_response({'error': 'zone_id deve essere un numero', 'success': False}, 400)

        # Verifica disponibilità
        init_status = get_initialization_status()
        available_zones = init_status.get('available_zones', [])
        
        if zone_id not in available_zones:
            return json_response({
                'error': f"Zona {zone_id} non disponibile",
                'success': False
            }, 400)

        # DELEGA TUTTO A stop_zone (dalla versione che funzionava)
        result = stop_zone(zone_id)
        
        if result:
            log_event(f"Zona {zone_id} fermata manualmente via API", "INFO")
            return json_response({
                "success": True,
                "message": f"Zona {zone_id} fermata"
            })
        else:
            return json_response({
                'error': f"Errore nel fermare zona {zone_id}",
                'success': False
            }, 500)
            
    except Exception as e:
        log_event(f"Errore handle_stop_zone: {e}", "ERROR")
        return json_response({'error': f'Errore interno: {str(e)}', 'success': False}, 500)

# ===== API DIAGNOSTICA (mantiene tutte le funzionalità originali) =====

def get_zone_diagnostics(request):
    """API per diagnostica zone completa con info ESP32-S3 (dalla versione originale)."""
    try:
        from zone_manager import get_initialization_status, get_active_zones_count, get_manual_zones_count
        
        init_status = get_initialization_status()
        settings = load_user_settings()
        
        # Test pin configurati (dalla versione originale)
        pin_test_results = {}
        user_pins = [14, 13, 12, 11, 10, 9, 46, 3, 15]
        
        for pin in user_pins:
            try:
                from machine import Pin
                test_pin = Pin(pin, Pin.OUT)
                test_pin.value(1)
                pin_test_results[pin] = "OK"
            except Exception as e:
                error_msg = str(e)
                if "in use" in error_msg.lower():
                    pin_test_results[pin] = "IN_USE"
                elif "invalid" in error_msg.lower() or "not exist" in error_msg.lower():
                    pin_test_results[pin] = "INVALID"
                else:
                    pin_test_results[pin] = "ERROR"
        
        # Info zone attive
        active_zones_info = {
            'total_active': get_active_zones_count(),
            'manual_active': get_manual_zones_count(),
            'program_active': get_active_zones_count() - get_manual_zones_count()
        }
        
        # Info impostazioni
        settings_info = {
            'max_active_zones': 1,
            'max_zone_duration': 180,
            'configured_zones': 0
        }
        
        if settings and isinstance(settings, dict):
            settings_info.update({
                'max_active_zones': settings.get('max_active_zones', 1),
                'max_zone_duration': settings.get('max_zone_duration', 180),
                'configured_zones': len(settings.get('zones', []))
            })
        
        # Diagnostica completa (dalla versione originale)
        diagnostics = {
            'initialization': init_status,
            'active_zones': active_zones_info,
            'settings': settings_info,
            'pin_availability': pin_test_results,
            'recommendations': {
                'working_pins': [pin for pin, status in pin_test_results.items() if status == "OK"],
                'current_config_status': {
                    'zone_pins': [14, 13, 12, 11, 10, 9, 46, 3],
                    'safety_relay_pin': 15,
                    'strapping_pins_used': [46, 3],
                    'pin_status': {pin: pin_test_results.get(pin, "UNTESTED") for pin in [14, 13, 12, 11, 10, 9, 46, 3, 15]}
                },
                'suggested_config': {
                    'zones': [
                        {"id": 0, "pin": 14, "name": "Zone 1", "status": pin_test_results.get(14, "UNTESTED")},
                        {"id": 1, "pin": 13, "name": "Zone 2", "status": pin_test_results.get(13, "UNTESTED")},
                        {"id": 2, "pin": 12, "name": "Zone 3", "status": pin_test_results.get(12, "UNTESTED")},
                        {"id": 3, "pin": 11, "name": "Zone 4", "status": pin_test_results.get(11, "UNTESTED")},
                        {"id": 4, "pin": 10, "name": "Zone 5", "status": pin_test_results.get(10, "UNTESTED")},
                        {"id": 5, "pin": 9, "name": "Zone 6", "status": pin_test_results.get(9, "UNTESTED")},
                        {"id": 6, "pin": 46, "name": "Zone 7", "status": pin_test_results.get(46, "UNTESTED"), "warning": "Strapping pin"},
                        {"id": 7, "pin": 3, "name": "Zone 8", "status": pin_test_results.get(3, "UNTESTED"), "warning": "Strapping pin"}
                    ],
                    'safety_relay': {"pin": 15, "status": pin_test_results.get(15, "UNTESTED")}
                },
                'esp32_s3_advice': {
                    'preferred_pins': [14, 13, 12, 11, 10, 9],
                    'safety_relay_pin': 15,
                    'avoid_pins': [19, 20, 45],
                    'caution_pins': [3, 46],
                    'notes': "Usa pin 14-13-12-11-10-9 per le zone, pin 15 per relè sicurezza. Evita pin USB (19,20) e flash (45)."
                }
            }
        }
        
        return json_response(diagnostics)
        
    except Exception as e:
        log_event(f"Errore get_zone_diagnostics: {e}", "ERROR")
        return json_response({'error': str(e)}, 500)

# NON implemento controlli ridondanti che causavano problemi:
# - Verifica stato programma duplicata (delega a zone_manager)
# - Controlli complessi di zone già attive (delega a zone_manager) 
# - Validazioni sovrapposte che creavano race conditions
# - Verifiche incrociate che interferivano con l'esecuzione

# TUTTE le validazioni essenziali sono mantenute ma semplificate