"""
API handler per le funzioni WiFi.
"""
from microdot import Response
import ujson
import time
from log_manager import log_event

def json_response(data, status_code=200):
    """
    Helper per creare risposte JSON standardizzate.
    """
    return Response(
        body=ujson.dumps(data),
        status_code=status_code,
        headers={'Content-Type': 'application/json'}
    )

def get_wifi_scan_results(request):
    """API per ottenere i risultati della scansione WiFi."""
    try:
        from file_cache import file_exists
        from wifi_manager import WIFI_SCAN_FILE, safe_wifi_scan
        
        # Verifica se esistono risultati salvati
        if file_exists(WIFI_SCAN_FILE):
            try:
                with open(WIFI_SCAN_FILE, 'r') as f:
                    networks = ujson.load(f)
                
                # Verifica che i dati siano validi e non vuoti
                if isinstance(networks, list) and len(networks) > 0:
                    log_event(f"Risultati scansione caricati: {len(networks)} reti", "DEBUG")
                    return json_response({
                        "networks": networks,
                        "count": len(networks),
                        "source": "cache"
                    })
                else:
                    log_event("File scansione vuoto o non valido, eseguo nuova scansione", "INFO")
            except Exception as e:
                log_event(f"Errore lettura file scansione: {e}, eseguo nuova scansione", "WARNING")
        
        # Se non ci sono risultati salvati validi, esegui scansione sicura
        log_event("Esecuzione scansione WiFi sicura", "INFO")
        networks = safe_wifi_scan()
        
        # Rimuovi campo rssi se presente (per compatibilità)
        clean_networks = []
        for network in networks:
            clean_network = {
                "ssid": network["ssid"],
                "signal": network["signal"]
            }
            clean_networks.append(clean_network)
        
        # Salva i risultati per future richieste
        if clean_networks:
            try:
                from wifi_manager import save_wifi_scan_results
                save_wifi_scan_results(clean_networks)
                log_event(f"Nuova scansione salvata: {len(clean_networks)} reti", "INFO")
            except Exception as e:
                log_event(f"Errore salvataggio scansione: {e}", "WARNING")
        
        return json_response({
            "networks": clean_networks,
            "count": len(clean_networks),
            "source": "live_scan"
        })
        
    except Exception as e:
        log_event(f"Errore get_wifi_scan_results: {e}", "ERROR")
        return json_response({
            "networks": [],
            "count": 0,
            "source": "error",
            "error": str(e)
        }, 200)


def scan_wifi(request):
    """API per avviare una scansione WiFi sicura senza disconnettere l'AP."""
    try:
        log_event("Avvio scansione Wi-Fi sicura", "INFO")

        # Importazioni lazy
        import network
        import time
        from wifi_manager import clear_wifi_scan_file, save_wifi_scan_results, ensure_coexistence_mode

        # Cancella vecchi dati scansione
        clear_wifi_scan_file()

        # Verifica e assicura coesistenza delle interfacce PRIMA della scansione
        coexistence_result = ensure_coexistence_mode()
        log_event(f"Coesistenza assicurata: {coexistence_result}", "INFO")

        # Verifica stato attuale delle interfacce
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)

        ap_is_active = wlan_ap.active()
        sta_is_active = wlan_sta.active()

        log_event(f"Stato interfacce prima scansione - AP: {'attivo' if ap_is_active else 'inattivo'}, Client: {'attivo' if sta_is_active else 'inattivo'}", "INFO")

        # Assicurati che entrambe le interfacce siano attive per coesistenza
        if not sta_is_active:
            log_event("Attivazione interfaccia client per scansione sicura", "INFO")
            wlan_sta.active(True)
            time.sleep(2)  # Tempo di stabilizzazione più lungo

        if not ap_is_active:
            log_event("Riattivazione Access Point per mantenere connettività", "WARNING")
            from wifi_manager import start_access_point
            start_access_point()
        
        try:
            # Verifica finale che entrambe le interfacce siano pronte
            final_ap_status = wlan_ap.active()
            final_sta_status = wlan_sta.active()

            if not final_sta_status:
                raise Exception("Impossibile attivare interfaccia client per scansione")

            log_event(f"Interfacce pronte per scansione - AP: {final_ap_status}, Client: {final_sta_status}", "INFO")

            # Esegui la scansione delle reti WiFi
            log_event("Esecuzione scansione reti WiFi...", "INFO")
            networks = wlan_sta.scan()
            network_list = []

            # Elabora risultati della scansione
            seen_ssids = set()
            for net in networks:
                try:
                    ssid = net[0].decode('utf-8').strip()
                    rssi = net[3]
                    
                    # Evita duplicati e SSID vuoti
                    if ssid and ssid not in seen_ssids:
                        seen_ssids.add(ssid)
                        
                        # Calcola la qualità del segnale
                        if rssi > -60:
                            signal_quality = "Buono"
                        elif rssi > -80:
                            signal_quality = "Sufficiente"
                        else:
                            signal_quality = "Scarso"
                            
                        network_list.append({
                            "ssid": ssid, 
                            "signal": signal_quality,
                            "rssi": rssi
                        })
                        
                except Exception as e:
                    # Gestisci reti con encoding problematico
                    log_event(f"Errore elaborazione rete WiFi: {e}", "DEBUG")
                    continue

            # Ordina le reti per intensità del segnale
            network_list.sort(key=lambda x: x["rssi"], reverse=True)
            
            # Rimuovi il campo rssi dalle risposte finali
            clean_networks = []
            for network in network_list:
                clean_networks.append({
                    "ssid": network["ssid"],
                    "signal": network["signal"]
                })

        finally:
            # GESTIONE POST-SCANSIONE MIGLIORATA
            # Verifica che entrambe le interfacce siano ancora attive
            post_scan_ap = wlan_ap.active()
            post_scan_sta = wlan_sta.active()

            log_event(f"Stato post-scansione - AP: {post_scan_ap}, Client: {post_scan_sta}", "INFO")

            # Se l'AP si è disconnesso durante la scansione, riattivalo immediatamente
            if ap_is_active and not post_scan_ap:
                log_event("CRITICO: AP disattivato durante scansione, riattivazione immediata", "ERROR")
                try:
                    from wifi_manager import start_access_point
                    start_access_point()
                    log_event("Access Point riattivato con successo", "INFO")
                except Exception as e:
                    log_event(f"ERRORE CRITICO riattivazione Access Point: {e}", "ERROR")

            # Mantieni sempre la coesistenza dopo la scansione
            if ap_is_active:
                log_event("Mantengo coesistenza AP/Client dopo scansione", "INFO")
                # NON disattivare mai l'interfaccia client se l'AP è attivo

        # Salva risultati della scansione
        save_wifi_scan_results(clean_networks)
        log_event(f"Scansione Wi-Fi completata con successo: {len(clean_networks)} reti trovate", "INFO")

        # Verifica finale delle interfacce
        final_ap_active = wlan_ap.active()
        final_sta_active = wlan_sta.active()

        return json_response({
            "networks": clean_networks,
            "count": len(clean_networks),
            "status": "success",
            "coexistence_maintained": final_ap_active and final_sta_active,
            "ap_maintained": final_ap_active,
            "scan_interface_active": final_sta_active,
            "message": f"Scansione completata. AP: {'attivo' if final_ap_active else 'inattivo'}, Client: {'attivo' if final_sta_active else 'inattivo'}"
        })

    except Exception as e:
        log_event(f"Errore durante scansione WiFi: {e}", "ERROR")
        
        # In caso di errore, assicurati che l'AP rimanga attivo
        try:
            import network
            wlan_ap = network.WLAN(network.AP_IF)
            if not wlan_ap.active():
                from wifi_manager import start_access_point
                start_access_point()
                log_event("Access Point riattivato dopo errore di scansione", "INFO")
        except Exception as recovery_error:
            log_event(f"Errore nel ripristino AP dopo errore scansione: {recovery_error}", "ERROR")
        
        return json_response({
            "networks": [],
            "count": 0,
            "status": "error",
            "error": str(e)
        }, 500)



def clear_wifi_scan(request):
    """API per cancellare il file di scansione WiFi."""
    try:
        from wifi_manager import clear_wifi_scan_file
        clear_wifi_scan_file()
        return json_response({'success': True})
    except Exception as e:
        log_event(f"Errore clear_wifi_scan: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def get_connection_status(request):
    """API per ottenere lo stato dettagliato della connessione WiFi."""
    try:
        from wifi_manager import get_interface_status
        
        # Ottieni stato completo delle interfacce
        status = get_interface_status()
        
        # Determina modalità principale e costruisci risposta con supporto coesistenza
        client_connected = status['client']['connected']
        ap_active = status['ap']['active']
        client_active = status['client']['active']

        if client_connected and ap_active:
            # MODALITÀ COESISTENZA: Client connesso + AP attivo
            response_data = {
                'mode': 'coexistence',
                'primary_ip': status['client']['ip'],
                'ap_ip': status['ap']['ip'],
                'ssid': status['client']['ssid'],
                'ap_ssid': status['ap']['ssid'],
                'connected': True,
                'coexistence_active': True,
                'interfaces': {
                    'client': status['client'],
                    'ap': status['ap']
                }
            }
            log_event("Stato connessione: Modalità coesistenza (Client + AP)", "DEBUG")

        elif client_connected:
            # Solo client connesso
            response_data = {
                'mode': 'client',
                'ip': status['client']['ip'],
                'ssid': status['client']['ssid'],
                'connected': True,
                'coexistence_active': False,
                'interfaces': {
                    'client': status['client'],
                    'ap': status['ap']
                }
            }
            log_event("Stato connessione: Solo client connesso", "DEBUG")

        elif ap_active:
            # Solo AP attivo
            response_data = {
                'mode': 'AP',
                'ip': status['ap']['ip'],
                'ssid': status['ap']['ssid'],
                'connected': True,
                'coexistence_active': False,
                'scan_ready': client_active,  # Indica se può fare scansioni
                'interfaces': {
                    'client': status['client'],
                    'ap': status['ap']
                }
            }
            log_event("Stato connessione: Solo Access Point attivo", "DEBUG")
            
        elif status['client']['active']:
            # Client attivo ma non connesso
            response_data = {
                'mode': 'client_disconnected',
                'ip': 'N/A',
                'ssid': 'Non connesso',
                'connected': False,
                'interfaces': {
                    'client': status['client'],
                    'ap': status['ap']
                }
            }
            log_event("Stato connessione: Client attivo ma disconnesso", "DEBUG")
            
        else:
            # Nessuna interfaccia attiva
            response_data = {
                'mode': 'none',
                'ip': 'N/A',
                'ssid': 'N/A',
                'connected': False,
                'interfaces': {
                    'client': status['client'],
                    'ap': status['ap']
                }
            }
            log_event("Stato connessione: Nessuna interfaccia attiva", "WARNING")

        return json_response(response_data)
        
    except Exception as e:
        log_event(f"Errore get_connection_status: {e}", "ERROR")
        
        # Fallback per risposta di base
        return json_response({
            'mode': 'unknown',
            'ip': 'N/A',
            'ssid': 'N/A',
            'connected': False,
            'error': 'Impossibile determinare stato connessione'
        }, 200)


def activate_ap(request):
    """API per attivare l'access point."""
    try:
        from wifi_manager import start_access_point
        start_access_point()  # Attiva l'AP con le impostazioni salvate
        log_event("Access Point attivato", "INFO")
        return json_response({'success': True})
    except Exception as e:
        log_event(f"Errore activate_ap: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def connect_wifi_route(request):
    """API per connettersi a una rete WiFi gestendo la transizione da AP a Client."""
    try:
        import network
        import time
        from settings_manager import load_user_settings, save_user_settings
        from wifi_manager import get_interface_status
        
        # Estrai e valida dati
        data = request.json
        if data is None:
            try:
                data = ujson.loads(request.body.decode('utf-8'))
            except (ValueError, UnicodeDecodeError) as e:
                log_event(f"Errore decodifica JSON richiesta WiFi: {e}", "WARNING")
                return json_response({'success': False, 'error': 'Dati JSON non validi'}, 400)

        ssid = data.get('ssid')
        password = data.get('password')

        # Validazione SSID
        if not ssid or not isinstance(ssid, str) or len(ssid.strip()) == 0:
            return json_response({'success': False, 'error': 'SSID valido richiesto'}, 400)

        # Validazione password
        if not password or not isinstance(password, str):
            return json_response({'success': False, 'error': 'Password richiesta'}, 400)

        # Trim degli spazi per sicurezza
        ssid = ssid.strip()

        if len(ssid) > 32:  # SSID WiFi max length
            return json_response({'success': False, 'error': 'SSID troppo lungo (max 32 caratteri)'}, 400)

        log_event(f"Tentativo connessione a '{ssid}'", "INFO")
        
        # Memorizza stato iniziale delle interfacce
        initial_status = get_interface_status()
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)
        
        # Prepara interfaccia client per connessione
        if not wlan_sta.active():
            wlan_sta.active(True)
            time.sleep(1)  # Attesa per attivazione interfaccia
        
        # Disconnetti da eventuale rete precedente
        if wlan_sta.isconnected():
            log_event("Disconnessione da rete precedente", "INFO")
            wlan_sta.disconnect()
            # Attendi disconnessione
            for _ in range(5):
                if not wlan_sta.isconnected():
                    break
                time.sleep(1)
        
        # Tenta connessione alla nuova rete
        log_event(f"Connessione a '{ssid}' in corso...", "INFO")
        wlan_sta.connect(ssid, password)

        # Attesa connessione con timeout esteso
        connected = False
        connection_timeout = 20  # 20 secondi per la connessione
        
        for attempt in range(connection_timeout):
            if wlan_sta.isconnected():
                connected = True
                break
            
            # Log del progresso ogni 5 secondi
            if attempt > 0 and attempt % 5 == 0:
                log_event(f"Connessione in corso... tentativo {attempt}/{connection_timeout}", "INFO")
                
            time.sleep(1)

        if connected:
            # Connessione riuscita
            ip = wlan_sta.ifconfig()[0]
            log_event(f"Connesso a '{ssid}' con IP: {ip}", "INFO")

            # Salva impostazioni WiFi
            settings = load_user_settings()
            if not isinstance(settings, dict):
                settings = {}
                
            settings['wifi'] = {'ssid': ssid, 'password': password}
            settings['client_enabled'] = True
            
            try:
                save_user_settings(settings)
                log_event("Impostazioni WiFi salvate", "INFO")
            except Exception as e:
                log_event(f"Avviso: impossibile salvare impostazioni: {e}", "WARNING")

            # COESISTENZA: Mantieni AP attivo anche con client connesso
            ap_was_active = initial_status['ap']['active']

            # Attendi stabilizzazione connessione
            time.sleep(3)

            # Verifica che la connessione client sia stabile
            if wlan_sta.isconnected():
                # MANTIENI COESISTENZA: NON disattivare l'AP
                if ap_was_active and wlan_ap.active():
                    log_event("Modalità coesistenza: Client connesso, AP rimane attivo per gestione locale", "INFO")
                elif ap_was_active and not wlan_ap.active():
                    # Se AP si è disconnesso, riattivalo
                    try:
                        from wifi_manager import start_access_point
                        start_access_point()
                        log_event("AP riattivato per mantenere coesistenza", "INFO")
                    except Exception as e:
                        log_event(f"Errore riattivazione AP per coesistenza: {e}", "WARNING")
                else:
                    log_event("Client connesso in modalità coesistenza", "INFO")
            else:
                log_event("Connessione client instabile, mantengo AP attivo", "WARNING")

            return json_response({
                'success': True, 
                'ip': ip, 
                'mode': 'client',
                'ssid': ssid,
                'message': 'Connessione WiFi completata con successo'
            })
            
        else:
            # Connessione fallita
            log_event(f"Connessione a '{ssid}' fallita dopo {connection_timeout} secondi", "ERROR")
            
            # Ripristina AP se era attivo prima del tentativo
            if initial_status['ap']['active'] and not wlan_ap.active():
                try:
                    from wifi_manager import start_access_point
                    start_access_point()
                    log_event("Access Point ripristinato dopo connessione fallita", "INFO")
                except Exception as e:
                    log_event(f"Errore ripristino AP: {e}", "ERROR")
            
            return json_response({
                'success': False, 
                'error': 'Connessione fallita - verifica SSID e password',
                'details': f'Timeout di connessione dopo {connection_timeout} secondi'
            }, 500)
            
    except Exception as e:
        log_event(f"Errore connect_wifi: {e}", "ERROR")
        
        # In caso di errore, assicurati che ci sia almeno una modalità attiva
        try:
            import network
            wlan_ap = network.WLAN(network.AP_IF)
            if not wlan_ap.active():
                from wifi_manager import start_access_point
                start_access_point()
                log_event("AP di emergenza attivato dopo errore", "INFO")
        except Exception:
            pass
            
        return json_response({
            'success': False, 
            'error': 'Errore interno durante connessione',
            'details': str(e)
        }, 500)


def disconnect_wifi(request):
    """API per disconnettere il client WiFi."""
    try:
        import network
        
        wlan_sta = network.WLAN(network.STA_IF)
        if wlan_sta.isconnected():
            wlan_sta.disconnect()
            wlan_sta.active(False)
            log_event("WiFi client disconnesso", "INFO")
        
        return json_response({'success': True})
    except Exception as e:
        log_event(f"Errore disconnect_wifi: {e}", "ERROR")
        return json_response({'success': False, 'error': str(e)}, 500)

def get_coexistence_status_api(request):
    """API per ottenere lo stato di coesistenza WiFi."""
    try:
        from wifi_manager import get_coexistence_status
        
        status = get_coexistence_status()
        
        return json_response({
            "coexistence": status,
            "recommendation": _get_coexistence_recommendation(status)
        })
        
    except Exception as e:
        log_event(f"Errore get_coexistence_status_api: {e}", "ERROR")
        return json_response({
            "error": str(e),
            "coexistence": None
        }, 500)

def ensure_coexistence_api(request):
    """API per forzare la modalità di coesistenza WiFi."""
    try:
        from wifi_manager import ensure_coexistence_mode
        
        result = ensure_coexistence_mode()
        
        return json_response({
            "success": True,
            "result": result,
            "message": "Modalità coesistenza verificata e aggiornata"
        })
        
    except Exception as e:
        log_event(f"Errore ensure_coexistence_api: {e}", "ERROR")
        return json_response({
            "success": False,
            "error": str(e)
        }, 500)

def _get_coexistence_recommendation(status):
    """
    Fornisce raccomandazioni basate sullo stato di coesistenza.
    
    Args:
        status: Stato di coesistenza da get_coexistence_status()
        
    Returns:
        str: Raccomandazione per l'utente
    """
    if status.get("error"):
        return "Errore nel sistema WiFi - riavvio consigliato"
    
    if status.get("coexistence_active"):
        if status["client"]["connected"]:
            return "Ottimale: Client connesso e AP attivo per gestione locale"
        else:
            return "Buono: Coesistenza attiva, pronto per scansioni e connessioni"
    
    if status["ap"]["active"] and not status["client"]["active"]:
        return "Limitato: Solo AP attivo - scansioni WiFi potrebbero causare disconnessioni"
    
    if status["client"]["active"] and not status["ap"]["active"]:
        return "Attenzione: Solo client attivo - nessun accesso locale possibile"
    
    return "Problematico: Nessuna interfaccia attiva"