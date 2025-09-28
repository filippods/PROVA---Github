"""
Test finale per verificare la risoluzione dell'errore 'local variable referenced before assignment'
"""

def test_all_imports():
    """Test che tutti gli import necessari siano disponibili."""
    print("=== TEST IMPORT COMPLETI ===")
    
    try:
        print("1. Test import main...")
        import main
        print("   ✓ main importato")
        
        print("2. Test funzione stop_previous_instances...")
        result = main.stop_previous_instances()
        print(f"   ✓ stop_previous_instances completato: {result}")
        
        print("3. Test import log_event...")
        from log_manager import log_event
        log_event("Test import completato", "INFO")
        print("   ✓ log_event funzionante")
        
        print("4. Test altri import critici...")
        import machine, time, uasyncio as asyncio
        print("   ✓ machine, time, asyncio disponibili")
        
        print("=== TUTTI GLI IMPORT OK ===")
        print("Il sistema dovrebbe ora avviarsi senza errori!")
        return True
        
    except Exception as e:
        print(f"✗ ERRORE: {e}")
        import sys
        sys.print_exception(e)
        return False

def simulate_start_sequence():
    """Simula l'inizio della sequenza start() senza eseguire il main()."""
    print("=== SIMULAZIONE START SEQUENCE ===")
    
    try:
        # Simula gli import che vengono fatti in start()
        print("1. Import moduli...")
        import machine
        import time
        import uasyncio as asyncio
        from log_manager import log_event
        print("   ✓ Tutti gli import completati")
        
        # Simula la chiamata a stop_previous_instances
        print("2. Pulizia istanze precedenti...")
        from main import stop_previous_instances
        result = stop_previous_instances()
        print(f"   ✓ Pulizia completata: {result}")
        
        # Simula la chiamata a log_event che prima falliva
        print("3. Test log_event che prima falliva...")
        log_event("Pulizia istanze precedenti completata", "INFO")
        print("   ✓ log_event funziona correttamente")
        
        print("=== SIMULAZIONE COMPLETATA CON SUCCESSO ===")
        print("Il boot sequence dovrebbe ora funzionare!")
        return True
        
    except Exception as e:
        print(f"✗ ERRORE NELLA SIMULAZIONE: {e}")
        import sys
        sys.print_exception(e)
        return False

# Esegui i test
if __name__ == '__main__':
    print("Eseguendo test degli import...")
    test_all_imports()
    print("\nEseguendo simulazione start sequence...")
    simulate_start_sequence()
