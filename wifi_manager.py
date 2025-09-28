"""
Modulo per la gestione della connettività WiFi.
Gestisce la modalità client e la modalità access point.
"""
import network
import ujson
import time
import gc
import uos as os
from settings_manager import load_user_settings, save_user_settings
from log_manager import log_event
from utils import ensure_directory_exists, get_dirname
import uasyncio as asyncio

# Costanti
WIFI_RETRY_INTERVAL = 600        # Tempo tra tentativi di riconnessione (secondi)
WIFI_RETRY_INITIAL_INTERVAL = 30 # Intervallo iniziale più breve (secondi)
AP_SSID_DEFAULT = "IrrigationSystem"
AP_PASSWORD_DEFAULT = "12345678"
WIFI_SCAN_FILE = '/data/wifi_scan.json'
MAX_MDNS_ATTEMPTS = 3            # Tentativi di configurazione mDNS

# Stato modulo
mdns_warning_shown = False     # Flag per evitare messaggi ripetuti
mdns_initialized = False       # Flag per tracciare lo stato di mDNS
_wifi_status = {
    "client_active": False,     # Stato interfaccia client
    "ap_active": False,         # Stato interfaccia AP
    "connected": False,         # Stato connessione client
    "last_attempt": 0           # Timestamp ultimo tentativo
}

def reset_wifi_module():
    """
    Disattiva e riattiva il modulo WiFi per forzare un reset completo.
    
    Returns:
        boolean: True se il reset è riuscito, False altrimenti
    """
    try:
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)
        
        log_event("Reset del modulo WiFi in corso...", "INFO")
        
        # Disattiva entrambe le interfacce
        wlan_sta.active(False)
        wlan_ap.active(False)
        
        # Attendi che il modulo si resetti
        time.sleep(1)
        
        # Riattiva solo l'interfaccia client
        wlan_sta.active(True)
        
        log_event("Reset del modulo WiFi completato", "INFO")
        return True
    except Exception as e:
        log_event(f"Errore durante il reset del modulo WiFi: {e}", "ERROR")
        return False

def save_wifi_scan_results(network_list):
    """
    Salva i risultati della scansione Wi-Fi nel file wifi_scan.json.
    
    Args:
        network_list: Lista di reti WiFi trovate
    """
    try:
        # Crea directory se necessario
        ensure_directory_exists(get_dirname(WIFI_SCAN_FILE))
            
        with open(WIFI_SCAN_FILE, 'w') as f:
            ujson.dump(network_list, f)
    except Exception as e:
        log_event(f"Errore salvataggio risultati scansione WiFi: {e}", "ERROR")

def clear_wifi_scan_file():
    """
    Cancella il file wifi_scan.json.
    """
    try:
        ensure_directory_exists(get_dirname(WIFI_SCAN_FILE))
        with open(WIFI_SCAN_FILE, 'w') as f:
            ujson.dump([], f)
    except (OSError, ValueError) as e:
        log_event(f"Errore creazione file wifi_scan vuoto: {e}", "WARNING")

def connect_to_wifi(ssid, password):
    """
    Tenta di connettersi a una rete WiFi in modalità client.
    
    Args:
        ssid: SSID della rete WiFi
        password: Password della rete WiFi
        
    Returns:
        boolean: True se la connessione è riuscita, False altrimenti
    """
    global _wifi_status
    
    wlan_sta = network.WLAN(network.STA_IF)
    log_event(f"Tentativo connessione a {ssid}", "INFO")

    try:
        # Attiva client e avvia connessione
        wlan_sta.active(True)
        _wifi_status["client_active"] = True
        _wifi_status["last_attempt"] = time.time()
        
        time.sleep(0.5)  # Breve attesa per attivazione
        wlan_sta.connect(ssid, password)
        
        # Attendi massimo 10 secondi
        for i in range(10):
            if wlan_sta.isconnected():
                ip = wlan_sta.ifconfig()[0]
                log_event(f"Connesso a {ssid} con IP {ip}", "INFO")

                # Mostra anche IP AP se attivo per facilite l'accesso
                try:
                    wlan_ap = network.WLAN(network.AP_IF)
                    if wlan_ap.active():
                        ap_ip = wlan_ap.ifconfig()[0]
                        log_event(f"Web interface disponibile su: Client {ip} | AP {ap_ip}", "INFO")
                except:
                    pass

                _wifi_status["connected"] = True
                return True
            
            time.sleep(1)
        
        # Connessione fallita
        log_event(f"Connessione a '{ssid}' fallita dopo 10 secondi", "WARNING")
        _wifi_status["connected"] = False
        return False
    except Exception as e:
        log_event(f"Errore durante connessione WiFi: {e}", "ERROR")
        _wifi_status["connected"] = False
        return False

def start_access_point(ssid=None, password=None):
    """
    Avvia l'access point.
    
    Args:
        ssid: SSID dell'access point (opzionale)
        password: Password dell'access point (opzionale)
        
    Returns:
        boolean: True se l'access point è stato avviato, False altrimenti
    """
    global _wifi_status
    
    try:
        settings = load_user_settings()

        # Usa parametri o configurazione salvata
        ap_config = settings.get('ap', {})
        ssid = ssid or ap_config.get('ssid', AP_SSID_DEFAULT)
        password = password or ap_config.get('password', AP_PASSWORD_DEFAULT)

        wlan_ap = network.WLAN(network.AP_IF)
        wlan_ap.active(True)
        _wifi_status["ap_active"] = True

        # Validazione e configurazione AP
        # Validazione SSID
        if not ssid or len(ssid.strip()) == 0:
            log_event("SSID Access Point vuoto, uso default", "WARNING")
            ssid = AP_SSID_DEFAULT

        # Validazione password e determinazione modalità auth
        if password and len(password) >= 8:
            auth_mode = "WPA2"
            try:
                wlan_ap.config(essid=ssid, password=password, authmode=3)
                log_event(f"Access Point configurato: {ssid} (WPA2)", "INFO")
            except OSError as e:
                log_event(f"Errore configurazione AP WPA2: {e}, provo modalità aperta", "WARNING")
                try:
                    wlan_ap.config(essid=ssid)
                    auth_mode = "Aperto (fallback)"
                except OSError as e2:
                    log_event(f"Errore critico configurazione AP: {e2}", "ERROR")
                    return False
        else:
            # Password troppo corta o mancante
            if password and len(password) < 8:
                log_event(f"Password AP troppo corta ({len(password)} caratteri), modalità aperta", "WARNING")
            auth_mode = "Aperto"
            try:
                wlan_ap.config(essid=ssid)
            except OSError as e:
                log_event(f"Errore configurazione AP aperto: {e}", "ERROR")
                return False

        log_event(f"Access Point attivato: {ssid} ({auth_mode})", "INFO")
        return True
    except Exception as e:
        log_event(f"Errore attivazione Access Point: {e}", "ERROR")
        _wifi_status["ap_active"] = False
        try:
            wlan_ap.active(False)
        except (OSError, AttributeError) as e:
            log_event(f"Errore disattivazione AP: {e}", "WARNING")
        return False

def setup_mdns(hostname="irrigation"):
    """
    Configura mDNS per l'accesso tramite hostname.local.
    
    Args:
        hostname: Nome host da utilizzare (default: "irrigation")
        
    Returns:
        boolean: True se l'inizializzazione è riuscita, False altrimenti
    """
    global mdns_warning_shown, mdns_initialized
    
    # Se mDNS è già inizializzato, non riprovare
    if mdns_initialized:
        return True
        
    # Implementazioni mDNS in ordine di preferenza
    mdns_methods = [
        lambda: __try_esp_idf_mdns(hostname),
        lambda: __try_network_mdns(hostname),
        lambda: __try_socket_mdns(hostname),
        lambda: __try_micropython_mdns(hostname)
    ]
    
    # Prova ogni implementazione
    for method in mdns_methods:
        try:
            if method():
                mdns_initialized = True
                return True
        except (OSError, AttributeError, ImportError):
            # Ridotto logging per evitare spam in console
            pass
            
    # Se nessun metodo funziona
    if not mdns_warning_shown:
        log_event("Nessun modulo mDNS disponibile, accesso tramite IP", "WARNING")
        mdns_warning_shown = True
            
    return False


def safe_wifi_scan():
    """
    Esegue una scansione WiFi sicura mantenendo l'AP sempre attivo.
    Strategia: mantiene entrambe le interfacce attive per evitare disruzioni.

    Returns:
        list: Lista delle reti WiFi trovate, vuota in caso di errore
    """
    try:
        import network
        import time

        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)

        # Verifica stato delle interfacce
        ap_is_active = wlan_ap.active()
        sta_was_active = wlan_sta.active()

        log_event(f"Scansione WiFi - AP: {'attivo' if ap_is_active else 'inattivo'}, STA: {'attivo' if sta_was_active else 'inattivo'}", "INFO")

        # STRATEGIA MIGLIORATA: Assicura sempre coesistenza
        # Attiva l'interfaccia client se non è attiva
        if not sta_was_active:
            log_event("Attivazione interfaccia client per scansione sicura", "INFO")
            wlan_sta.active(True)
            time.sleep(2)  # Tempo di stabilizzazione più lungo

        # Se AP non è attivo ma dovrebbe essere, riattivalo
        if not ap_is_active:
            log_event("Riattivazione Access Point per mantenere connettività", "WARNING")
            start_access_point()
            time.sleep(1)
        
        # Esegui scansione WiFi
        log_event("Esecuzione scansione reti...", "INFO")
        networks = wlan_sta.scan()
        
        # Elabora risultati
        network_list = []
        seen_ssids = set()
        
        for net in networks:
            try:
                ssid = net[0].decode('utf-8').strip()
                rssi = net[3]
                
                if ssid and ssid not in seen_ssids:
                    seen_ssids.add(ssid)
                    
                    # Determina qualità segnale
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
                    
            except (UnicodeDecodeError, IndexError, AttributeError) as e:
                log_event(f"Errore elaborazione rete WiFi: {e}", "DEBUG")
                continue
                
        # Ordina per intensità segnale
        network_list.sort(key=lambda x: x["rssi"], reverse=True)
        
        # GESTIONE POST-SCANSIONE MIGLIORATA
        # Verifica che entrambe le interfacce siano ancora attive
        post_scan_ap = wlan_ap.active()
        post_scan_sta = wlan_sta.active()

        if ap_is_active and not post_scan_ap:
            # Se l'AP si è disconnesso durante la scansione, riattivalo immediatamente
            log_event("CRITICO: AP disattivato durante scansione, riattivazione immediata", "ERROR")
            try:
                start_access_point()
                log_event("Access Point riattivato con successo dopo scansione", "INFO")
            except Exception as e:
                log_event(f"ERRORE CRITICO riattivazione Access Point: {e}", "ERROR")

        # Mantieni sempre la coesistenza: NON disattivare mai l'interfaccia client
        log_event(f"Scansione completata: {len(network_list)} reti trovate - AP: {'attivo' if post_scan_ap else 'inattivo'}, Client: {'attivo' if post_scan_sta else 'inattivo'}", "INFO")
            
        return network_list
            
    except Exception as e:
        log_event(f"Errore scansione WiFi sicura: {e}", "ERROR")
        
        # In caso di errore, assicurati che l'AP rimanga attivo
        try:
            import network
            wlan_ap = network.WLAN(network.AP_IF)
            if not wlan_ap.active():
                start_access_point()
                log_event("AP riattivato dopo errore scansione", "WARNING")
        except (OSError, AttributeError) as recovery_error:
            log_event(f"Errore riattivazione AP dopo errore scansione: {recovery_error}", "ERROR")
            
        return []


def get_interface_status():
    """
    Ottiene lo stato attuale delle interfacce WiFi.
    
    Returns:
        dict: Dizionario con lo stato delle interfacce WiFi
    """
    try:
        import network
        
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)
        
        status = {
            "client": {
                "active": wlan_sta.active(),
                "connected": wlan_sta.isconnected(),
                "ip": None,
                "ssid": None
            },
            "ap": {
                "active": wlan_ap.active(),
                "ip": None,
                "ssid": None
            }
        }
        
        # Informazioni client se connesso
        if wlan_sta.isconnected():
            try:
                status["client"]["ip"] = wlan_sta.ifconfig()[0]
                status["client"]["ssid"] = wlan_sta.config('essid')
            except (OSError, AttributeError, IndexError) as e:
                log_event(f"Errore lettura configurazione client: {e}", "DEBUG")
        
        # Informazioni AP se attivo
        if wlan_ap.active():
            try:
                status["ap"]["ip"] = wlan_ap.ifconfig()[0]
                status["ap"]["ssid"] = wlan_ap.config('essid')
            except (OSError, AttributeError, IndexError) as e:
                log_event(f"Errore lettura configurazione AP: {e}", "DEBUG")
                
        return status
        
    except Exception as e:
        log_event(f"Errore get_interface_status: {e}", "ERROR")
        return {
            "client": {"active": False, "connected": False, "ip": None, "ssid": None},
            "ap": {"active": False, "ip": None, "ssid": None}
        }


def ensure_coexistence_mode():
    """
    Assicura che entrambe le interfacce WiFi siano attive per la coesistenza.
    Questa funzione è utile per mantenere la stabilità durante le scansioni.
    
    Returns:
        dict: Stato delle interfacce dopo l'operazione
    """
    try:
        import network
        
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)
        
        # Stato iniziale
        initial_status = {
            "sta_was_active": wlan_sta.active(),
            "ap_was_active": wlan_ap.active()
        }
        
        changes_made = []
        
        # Assicurati che l'interfaccia client sia attiva
        if not wlan_sta.active():
            wlan_sta.active(True)
            changes_made.append("Client attivato")
            log_event("Interfaccia client attivata per coesistenza", "INFO")
        
        # Assicurati che l'AP sia attivo (se configurato)
        if not wlan_ap.active():
            try:
                start_access_point()
                changes_made.append("AP riattivato")
                log_event("Access Point riattivato per coesistenza", "INFO")
            except Exception as e:
                log_event(f"Errore riattivazione AP: {e}", "WARNING")
        
        # Stato finale
        final_status = {
            "sta_active": wlan_sta.active(),
            "ap_active": wlan_ap.active(),
            "sta_connected": wlan_sta.isconnected(),
            "changes_made": changes_made
        }
        
        if changes_made:
            log_event(f"Coesistenza aggiornata: {', '.join(changes_made)}", "INFO")
        else:
            log_event("Coesistenza WiFi già attiva", "DEBUG")
        
        return final_status
        
    except Exception as e:
        log_event(f"Errore ensure_coexistence_mode: {e}", "ERROR")
        return {
            "sta_active": False,
            "ap_active": False,
            "sta_connected": False,
            "changes_made": [],
            "error": str(e)
        }

def get_coexistence_status():
    """
    Ottiene informazioni dettagliate sullo stato di coesistenza WiFi.
    
    Returns:
        dict: Informazioni complete sullo stato delle interfacce
    """
    try:
        import network
        
        wlan_sta = network.WLAN(network.STA_IF)
        wlan_ap = network.WLAN(network.AP_IF)
        
        status = {
            "coexistence_active": wlan_sta.active() and wlan_ap.active(),
            "client": {
                "active": wlan_sta.active(),
                "connected": wlan_sta.isconnected(),
                "ip": None,
                "ssid": None
            },
            "ap": {
                "active": wlan_ap.active(),
                "ip": None,
                "ssid": None,
                "clients_connected": 0
            },
            "scan_ready": wlan_sta.active()  # Indica se è possibile fare scansioni
        }
        
        # Dettagli interfaccia client
        if wlan_sta.isconnected():
            try:
                status["client"]["ip"] = wlan_sta.ifconfig()[0]
                status["client"]["ssid"] = wlan_sta.config('essid')
            except (OSError, AttributeError, IndexError) as e:
                log_event(f"Errore lettura dettagli client in coesistenza: {e}", "DEBUG")
        
        # Dettagli interfaccia AP
        if wlan_ap.active():
            try:
                status["ap"]["ip"] = wlan_ap.ifconfig()[0]
                status["ap"]["ssid"] = wlan_ap.config('essid')
                # Nota: il numero di client connessi non è sempre disponibile su tutti i firmware
            except (OSError, AttributeError, IndexError) as e:
                log_event(f"Errore lettura dettagli AP in coesistenza: {e}", "DEBUG")
        
        return status
        
    except Exception as e:
        log_event(f"Errore get_coexistence_status: {e}", "ERROR")
        return {
            "coexistence_active": False,
            "client": {"active": False, "connected": False, "ip": None, "ssid": None},
            "ap": {"active": False, "ip": None, "ssid": None, "clients_connected": 0},
            "scan_ready": False,
            "error": str(e)
        }# Implementazioni mDNS - semplificate e condensate
def __try_esp_idf_mdns(hostname):
    try:
        import esp
        if hasattr(esp, 'mdns_init'):
            esp.mdns_init()
            esp.mdns_add_service(hostname, "_http", "_tcp", 80)
            log_event(f"mDNS attivo: {hostname}.local (ESP-IDF)", "INFO")
            return True
    except (ImportError, AttributeError, OSError):
        # Ridotto logging per evitare spam in console
        pass
    return False

def __try_network_mdns(hostname):
    try:
        import network
        if hasattr(network, 'mDNS'):
            network.mDNS.init(hostname)
            log_event(f"mDNS attivo: {hostname}.local (network)", "INFO")
            return True
    except (ImportError, AttributeError, OSError):
        # Ridotto logging per evitare spam in console
        pass
    return False

def __try_socket_mdns(hostname):
    try:
        import mdns.mdns as mdns_mod
        mdns_server = mdns_mod.MDNS(hostname)
        mdns_server.start()
        log_event(f"mDNS attivo: {hostname}.local (socket)", "INFO")
        return True
    except (ImportError, AttributeError, OSError):
        # Ridotto logging per evitare spam in console
        pass
    return False

def __try_micropython_mdns(hostname):
    try:
        import mdns
        mdns.start(hostname)
        log_event(f"mDNS attivo: {hostname}.local (micropython-mdns)", "INFO")
        return True
    except (ImportError, AttributeError, OSError):
        # Ridotto logging per evitare spam in console
        pass
    return False

def initialize_network():
    """
    Inizializza la rete WiFi con strategia di coesistenza AP/Client.
    Mantiene entrambe le interfacce attive per evitare disruzioni durante scansioni.
    
    Returns:
        boolean: True se l'inizializzazione è riuscita, False altrimenti
    """
    global _wifi_status
    
    gc.collect()  # Libera memoria
    settings = load_user_settings()
    if not isinstance(settings, dict):
        log_event("Errore: impostazioni non disponibili", "ERROR")
        return False

    client_enabled = settings.get('client_enabled', False)
    success = False

    if client_enabled:
        # Configura modalità client
        ssid = settings.get('wifi', {}).get('ssid')
        password = settings.get('wifi', {}).get('password')

        if ssid and password:
            # Tenta connessione
            success = connect_to_wifi(ssid, password)
            if success:
                log_event("Modalità client attivata", "INFO")
                
                # STRATEGIA COESISTENZA: Mantieni anche il client attivo per future scansioni
                # L'AP verrà gestito dal task di monitoraggio
                
                # Configura mDNS
                setup_mdns()
                return True
            else:
                log_event("Connessione client fallita, attivo AP con client disponibile", "WARNING")
                # Mantieni il client attivo per future scansioni anche se la connessione è fallita
        else:
            log_event("SSID o password mancanti", "WARNING")
            # Attiva il client comunque per permettere scansioni
            try:
                import network
                wlan_sta = network.WLAN(network.STA_IF)
                if not wlan_sta.active():
                    wlan_sta.active(True)
                    log_event("Interfaccia client attivata per scansioni future", "INFO")
            except Exception as e:
                log_event(f"Errore attivazione interfaccia client: {e}", "WARNING")

    # Avvia AP (sempre, anche se client è connesso per permettere gestione locale)
    ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
    ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
    ap_success = start_access_point(ap_ssid, ap_password)

    if ap_success:
        log_event("Access Point attivato", "INFO")

        # STRATEGIA COESISTENZA: Attiva sempre l'interfaccia client per scansioni future
        try:
            import network
            wlan_sta = network.WLAN(network.STA_IF)
            if not wlan_sta.active():
                wlan_sta.active(True)
                log_event("Interfaccia client attivata in modalità coesistenza per scansioni", "INFO")
                time.sleep(1)  # Stabilizzazione
        except Exception as e:
            log_event(f"Avviso: impossibile attivare interfaccia client: {e}", "WARNING")

        # Imposta mDNS in modalità AP
        setup_mdns()

        # Verifica finale dello stato di coesistenza
        final_status = ensure_coexistence_mode()
        log_event(f"Stato finale coesistenza: {final_status}", "INFO")

    return ap_success or success


async def retry_client_connection():
    """
    Task asincrono per riconnessione periodica WiFi.
    """
    last_attempt_time = 0
    reconnection_tries = 0
    ap_failover_activated = False
    
    while True:
        try:
            current_time = time.time()
            wlan_sta = network.WLAN(network.STA_IF)
            wlan_ap = network.WLAN(network.AP_IF)
            settings = load_user_settings()
            
            client_enabled = settings.get('client_enabled', False)

            if client_enabled:
                # Modalità client abilitata
                if not wlan_sta.isconnected():
                    # Determina intervallo di riconnessione
                    retry_interval = WIFI_RETRY_INTERVAL if ap_failover_activated else WIFI_RETRY_INITIAL_INTERVAL
                    time_since_last = current_time - last_attempt_time
                    
                    if time_since_last >= retry_interval:
                        # Tenta riconnessione
                        log_event(f"Tentativo riconnessione WiFi (#{reconnection_tries + 1})", "INFO")
                        
                        ssid = settings.get('wifi', {}).get('ssid')
                        password = settings.get('wifi', {}).get('password')
                        
                        if ssid and password:
                            last_attempt_time = current_time
                            reconnection_tries += 1
                            
                            # Assicurati che il client sia attivo
                            if not wlan_sta.active():
                                wlan_sta.active(True)
                                await asyncio.sleep(1)
                                
                            # Tenta connessione
                            wlan_sta.connect(ssid, password)
                            
                            # Attendi fino a 10 secondi
                            connected = False
                            for _ in range(10):
                                if wlan_sta.isconnected():
                                    connected = True
                                    break
                                await asyncio.sleep(1)
                                
                            if connected:
                                # Connessione riuscita
                                log_event(f"Riconnessione a '{ssid}' riuscita", "INFO")
                                reconnection_tries = 0
                                ap_failover_activated = False

                                # MANTIENI COESISTENZA: NON disattivare l'AP anche se client è connesso
                                # Questo permette gestione locale e scansioni WiFi continue
                                if wlan_ap.active():
                                    log_event("Modalità coesistenza: AP rimane attivo con client connesso", "INFO")
                                else:
                                    # Se AP non è attivo, riattivalo per coesistenza
                                    ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
                                    ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
                                    start_access_point(ap_ssid, ap_password)
                                    log_event("AP riattivato per modalità coesistenza", "INFO")

                                # Configura mDNS
                                setup_mdns()
                            else:
                                # Connessione fallita, attiva AP come fallback
                                if not ap_failover_activated:
                                    log_event(f"Fallback: attivazione AP", "WARNING")
                                    
                                    # Attiva AP
                                    if not wlan_ap.active():
                                        ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
                                        ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
                                        start_access_point(ap_ssid, ap_password)
                                    
                                    ap_failover_activated = True
                        else:
                            log_event("SSID o password mancanti", "ERROR")
                            
                            # Attiva AP come unica opzione
                            if not wlan_ap.active():
                                ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
                                ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
                                start_access_point(ap_ssid, ap_password)
                                ap_failover_activated = True
                    else:
                        # Non è ancora il momento di riprovare
                        await asyncio.sleep(1)
                else:
                    # Client connesso
                    if reconnection_tries > 0:
                        log_event("Connessione WiFi client stabile", "INFO")
                        reconnection_tries = 0

                    # COESISTENZA: Mantieni sempre l'AP attivo per gestione locale
                    if not wlan_ap.active():
                        # Se AP non è attivo, riattivalo per coesistenza
                        ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
                        ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
                        start_access_point(ap_ssid, ap_password)
                        log_event("AP riattivato per coesistenza durante client connesso", "INFO")

                    ap_failover_activated = False  # Reset flag but keep AP active

                    # Configura mDNS
                    setup_mdns()

                    # Controllo periodico
                    await asyncio.sleep(30)
            else:
                # Modalità client disabilitata: mantieni comunque interfaccia per scansioni
                # NON disattivare l'interfaccia client perché impedisce le scansioni WiFi
                if not wlan_sta.active():
                    wlan_sta.active(True)
                    log_event("Interfaccia client attivata per permettere scansioni WiFi", "INFO")

                # Disconnetti da eventuali reti se connesso
                if wlan_sta.isconnected():
                    log_event("Disconnessione da rete WiFi (modalità client disabilitata)", "INFO")
                    wlan_sta.disconnect()

                reconnection_tries = 0
                ap_failover_activated = False

                # Assicura AP attivo
                if not wlan_ap.active():
                    ap_ssid = settings.get('ap', {}).get('ssid', AP_SSID_DEFAULT)
                    ap_password = settings.get('ap', {}).get('password', AP_PASSWORD_DEFAULT)
                    start_access_point(ap_ssid, ap_password)

                # Configura mDNS
                setup_mdns()

                # Controllo periodico
                await asyncio.sleep(30)
        
        except Exception as e:
            log_event(f"Errore gestione connessione WiFi: {e}", "ERROR")
            await asyncio.sleep(5)