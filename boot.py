"""
File di boot per ESP32 - garantisce l'avvio automatico di main.py
Questo file viene eseguito automaticamente all'accensione dell'ESP32
"""

# Configurazione di base all'avvio
print("=== IRRIGASMART BOOT ===")
print("Avvio automatico del sistema...")

try:
    # Ottimizzazione iniziale della memoria
    import gc
    gc.collect()
    print(f"Memoria libera all'avvio: {gc.mem_free()} bytes")
    
    # Configurazione base del sistema
    try:
        import machine
        print(f"Frequenza CPU: {machine.freq()/1000000} MHz")
    except:
        pass
    
    # AVVIO AUTOMATICO DEL MAIN
    print("Avvio del programma principale...")
    
    # Importa e avvia main.py
    try:
        import main
        main.start()
    except Exception as e:
        print(f"ERRORE nell'avvio del main: {e}")
        print("Tentativo di riavvio in 5 secondi...")
        
        # In caso di errore, riavvia dopo 5 secondi
        import time
        time.sleep(5)
        machine.reset()

except Exception as e:
    print(f"ERRORE CRITICO nel boot: {e}")
    print("Riavvio automatico in 10 secondi...")
    
    try:
        import time, machine
        time.sleep(10)
        machine.reset()
    except:
        pass

print("=== FINE BOOT ===")
