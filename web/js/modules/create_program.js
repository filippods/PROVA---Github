/**
 * create_program.js - Modulo per la creazione di nuovi programmi di irrigazione
 * Versione completamente riscritta - pulita e mantenibile
 * 
 * Funzionalità:
 * - Caricamento e gestione form di creazione programma
 * - Validazione dati in tempo reale
 * - Interfaccia moderna e responsive
 * - Integrazione con il sistema IrrigaSmart esistente
 */

// Stato del modulo
window.CreateProgramModule = {
    isInitialized: false,
    abortController: null,
    currentData: {
        zones: [],
        months: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    }
};

/**
 * Inizializza la pagina di creazione programma
 */
function initializeCreateProgramPage() {
    console.log('🚀 Inizializzazione pagina creazione programma');
    
    if (window.CreateProgramModule.isInitialized) {
        console.log('Pagina già inizializzata');
        return;
    }
    
    // Cleanup precedenti
    cleanup();
    
    // Applica traduzioni se disponibile
    if (window.IrrigationI18n?.applyTranslations) {
        window.IrrigationI18n.applyTranslations(document);
    }
    
    // Carica dati utente e inizializza interfaccia
    loadUserSettings()
        .then(initializeInterface)
        .catch(handleError)
        .finally(() => {
            window.CreateProgramModule.isInitialized = true;
        });
    
    // Setup form validation
    setupFormValidation();
    
    // Setup smart defaults
    setupSmartDefaults();
}

/**
 * Carica le impostazioni utente dal server
 */
async function loadUserSettings() {
    // Cancella richieste precedenti
    if (window.CreateProgramModule.abortController) {
        window.CreateProgramModule.abortController.abort();
    }
    
    window.CreateProgramModule.abortController = new AbortController();
    
    try {
        // Usa API esistente se disponibile, altrimenti fetch diretto
        if (window.IrrigationAPI?.loadUserSettings) {
            return await window.IrrigationAPI.loadUserSettings();
        }
        
        const response = await fetch('/data/user_settings.json', {
            signal: window.CreateProgramModule.abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`Errore HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Caricamento annullato');
            return null;
        }
        throw error;
    }
}

/**
 * Inizializza l'interfaccia con i dati caricati
 */
function initializeInterface(userSettings) {
    if (!userSettings) return;
    
    // Salva zone per riferimento
    window.CreateProgramModule.currentData.zones = userSettings.zones || [];
    
    // Genera griglia mesi
    generateMonthsGrid();
    
    // Genera griglia zone
    generateZonesGrid(userSettings.zones);
    
    console.log('✅ Interfaccia inizializzata con successo');
}

/**
 * Genera la griglia dei mesi
 */
function generateMonthsGrid() {
    const container = document.getElementById('months-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    window.CreateProgramModule.currentData.months.forEach((month, index) => {
        const monthCard = document.createElement('div');
        monthCard.className = 'month-card';
        monthCard.dataset.month = month;
        monthCard.textContent = month.substring(0, 3);
        monthCard.title = month;
        
        // Event listener per selezione
        monthCard.addEventListener('click', () => {
            monthCard.classList.toggle('selected');
            validateForm();
        });
        
        container.appendChild(monthCard);
        
        // Animazione staggered
        setTimeout(() => {
            monthCard.style.opacity = '1';
            monthCard.style.transform = 'translateY(0)';
        }, index * 50);
    });
}

/**
 * Genera la griglia delle zone
 */
function generateZonesGrid(zones) {
    const container = document.getElementById('zones-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!zones || zones.length === 0) {
        container.innerHTML = '<div class="error-state">Nessuna zona configurata. Vai alle impostazioni per configurare le zone.</div>';
        return;
    }
    
    // Filtra solo zone attive
    const activeZones = zones.filter(zone => zone.status === 'show');
    
    if (activeZones.length === 0) {
        container.innerHTML = '<div class="error-state">Nessuna zona attiva trovata.</div>';
        return;
    }
    
    activeZones.forEach((zone, index) => {
        const zoneCard = createZoneCard(zone, index);
        container.appendChild(zoneCard);
        
        // Animazione staggered
        setTimeout(() => {
            zoneCard.style.opacity = '1';
            zoneCard.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

/**
 * Crea una singola card zona
 */
function createZoneCard(zone, index) {
    const zoneCard = document.createElement('div');
    zoneCard.className = 'zone-card';
    zoneCard.dataset.zoneId = zone.id;
    zoneCard.style.opacity = '0';
    zoneCard.style.transform = 'translateY(20px)';
    
    zoneCard.innerHTML = `
        <h3 class="zone-title">${zone.name || `Zona ${zone.id + 1}`}</h3>
        <div class="zone-duration-group">
            <label class="zone-duration-label" for="duration-${zone.id}">Durata irrigazione</label>
            <input type="number" 
                   class="zone-duration-input" 
                   id="duration-${zone.id}" 
                   min="1" 
                   max="180" 
                   placeholder="10" 
                   disabled>
            <input type="checkbox" 
                   class="zone-checkbox" 
                   id="zone-${zone.id}" 
                   data-zone-id="${zone.id}">
        </div>
    `;
    
    // Setup event listeners
    setupZoneCardEvents(zoneCard, zone);
    
    return zoneCard;
}

/**
 * Setup eventi per una zone card
 */
function setupZoneCardEvents(zoneCard, zone) {
    const checkbox = zoneCard.querySelector('.zone-checkbox');
    const durationInput = zoneCard.querySelector('.zone-duration-input');
    
    // Click sulla card (escludendo input quando abilitato)
    zoneCard.addEventListener('click', (e) => {
        if (e.target === durationInput && !durationInput.disabled) {
            return; // Permetti interazione diretta con input
        }
        
        toggleZoneSelection(zoneCard, checkbox, durationInput);
    });
    
    // Gestione input durata
    durationInput.addEventListener('input', () => {
        validateDurationInput(durationInput);
        validateForm();
    });
    
    durationInput.addEventListener('focus', () => {
        durationInput.select();
    });
    
    durationInput.addEventListener('blur', () => {
        if (!durationInput.value && checkbox.checked) {
            durationInput.value = '10';
        }
    });
}

/**
 * Toggle selezione zona
 */
function toggleZoneSelection(zoneCard, checkbox, durationInput) {
    const isSelected = checkbox.checked;
    
    // Toggle stato
    checkbox.checked = !isSelected;
    zoneCard.classList.toggle('selected', !isSelected);
    durationInput.disabled = isSelected;
    
    if (!isSelected) {
        // Zona selezionata
        if (!durationInput.value) {
            durationInput.value = '10';
        }
        setTimeout(() => durationInput.focus(), 100);
    } else {
        // Zona deselezionata
        durationInput.value = '';
        durationInput.blur();
    }
    
    validateForm();
}

/**
 * Valida input durata
 */
function validateDurationInput(input) {
    const value = parseInt(input.value);
    
    input.classList.remove('error', 'success');
    
    if (isNaN(value) || value < 1) {
        input.classList.add('error');
    } else if (value > 180) {
        input.value = '180';
        input.classList.add('success');
    } else {
        input.classList.add('success');
    }
}

/**
 * Setup validazione form in tempo reale
 */
function setupFormValidation() {
    const form = document.querySelector('.page-wrapper');
    if (!form) return;
    
    // Validazione su input/change
    form.addEventListener('input', debounce(validateForm, 300));
    form.addEventListener('change', validateForm);
    
    // Validazione nome programma
    const nameInput = document.getElementById('program-name');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            validateProgramName(nameInput);
            validateForm();
        });
    }
}

/**
 * Valida nome programma
 */
function validateProgramName(input) {
    const value = input.value.trim();
    
    input.classList.remove('error', 'success');
    
    if (!value) {
        input.classList.add('error');
        return false;
    } else if (value.length > 16) {
        input.value = value.substring(0, 16);
        input.classList.add('error');
        return false;
    } else {
        input.classList.add('success');
        return true;
    }
}

/**
 * Valida l'intero form
 */
function validateForm() {
    const saveButton = document.getElementById('save-button');
    if (!saveButton) return;
    
    const isValid = (
        validateProgramName(document.getElementById('program-name')) &&
        validateTime() &&
        validateMonths() &&
        validateZones()
    );
    
    saveButton.disabled = !isValid;
    saveButton.style.opacity = isValid ? '1' : '0.5';
}

/**
 * Valida orario
 */
function validateTime() {
    const timeInput = document.getElementById('activation-time');
    return timeInput && timeInput.value;
}

/**
 * Valida selezione mesi
 */
function validateMonths() {
    return document.querySelectorAll('.month-card.selected').length > 0;
}

/**
 * Valida selezione zone
 */
function validateZones() {
    const selectedZones = document.querySelectorAll('.zone-checkbox:checked');
    if (selectedZones.length === 0) return false;
    
    // Verifica che tutte le zone selezionate abbiano durata valida
    for (const checkbox of selectedZones) {
        const zoneId = checkbox.dataset.zoneId;
        const durationInput = document.getElementById(`duration-${zoneId}`);
        const duration = parseInt(durationInput?.value);
        
        if (isNaN(duration) || duration < 1 || duration > 180) {
            return false;
        }
    }
    
    return true;
}

/**
 * Setup valori di default intelligenti
 */
function setupSmartDefaults() {
    // Imposta orario di default
    const timeInput = document.getElementById('activation-time');
    if (timeInput && !timeInput.value) {
        const now = new Date();
        const hour = now.getHours() < 6 ? 6 : (now.getHours() < 18 ? 18 : 6);
        timeInput.value = `${hour.toString().padStart(2, '0')}:00`;
    }
}

/**
 * Raccoglie i dati del programma dal form
 */
function collectProgramData() {
    const recurrenceSelect = document.getElementById('recurrence');
    
    // Mappa valori dal form al database per coerenza
    const recurrenceMapping = {
        'daily': 'giornaliero',
        'alternatingDays': 'giorni_alterni', 
        'custom': 'personalizzato'
    };
    
    const formRecurrence = recurrenceSelect?.value || 'daily';
    const dbRecurrence = recurrenceMapping[formRecurrence] || 'giornaliero';
    
    const programData = {
        name: document.getElementById('program-name').value.trim(),
        activation_time: document.getElementById('activation-time').value,
        recurrence: dbRecurrence,
        months: [],
        steps: []
    };
    
    // Aggiungi intervallo personalizzato se necessario
    if (formRecurrence === 'custom') {
        programData.interval_days = parseInt(document.getElementById('interval-days').value) || 3;
    }
    
    // Raccogli mesi selezionati
    document.querySelectorAll('.month-card.selected').forEach(monthCard => {
        programData.months.push(monthCard.dataset.month);
    });
    
    // Raccogli zone selezionate e durate
    document.querySelectorAll('.zone-checkbox:checked').forEach(checkbox => {
        const zoneId = parseInt(checkbox.dataset.zoneId);
        const durationInput = document.getElementById(`duration-${zoneId}`);
        const duration = parseInt(durationInput.value);
        
        if (!isNaN(duration) && duration >= 1 && duration <= 180) {
            programData.steps.push({
                zone_id: zoneId,
                duration: duration
            });
        }
    });
    
    console.log('📋 Collected program data:', programData);
    return programData;
}

/**
 * Salva il programma
 */
async function saveProgram() {
    const saveButton = document.getElementById('save-button');
    if (!saveButton || saveButton.disabled) return;
    
    // UI feedback
    saveButton.classList.add('loading');
    saveButton.disabled = true;
    
    try {
        // Raccogli e valida dati
        const programData = collectProgramData();
        const validationResult = validateProgramData(programData);
        
        if (!validationResult.isValid) {
            throw new Error(validationResult.error);
        }
        
        // Invia al server
        const response = await fetch('/save_program', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(programData)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Errore HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Programma creato con successo!', 'success');
            
            // Naviga alla pagina programmi dopo breve delay
            setTimeout(() => {
                navigateToPrograms();
            }, 1500);
        } else {
            throw new Error(result.error || 'Errore durante il salvataggio');
        }
        
    } catch (error) {
        console.error('Errore salvataggio programma:', error);
        showToast(error.message || 'Errore durante il salvataggio', 'error');
    } finally {
        // Reset UI
        saveButton.classList.remove('loading');
        saveButton.disabled = false;
    }
}

/**
 * Valida i dati del programma
 */
function validateProgramData(data) {
    if (!data.name || data.name.length === 0) {
        return { isValid: false, error: 'Nome programma obbligatorio' };
    }
    
    if (data.name.length > 16) {
        return { isValid: false, error: 'Nome programma troppo lungo (max 16 caratteri)' };
    }
    
    if (!data.activation_time) {
        return { isValid: false, error: 'Orario di attivazione obbligatorio' };
    }
    
    if (data.months.length === 0) {
        return { isValid: false, error: 'Seleziona almeno un mese' };
    }
    
    if (data.steps.length === 0) {
        return { isValid: false, error: 'Seleziona almeno una zona' };
    }
    
    // Verifica durate zone
    for (const step of data.steps) {
        if (!step.duration || step.duration < 1 || step.duration > 180) {
            return { isValid: false, error: `Durata non valida per zona ${step.zone_id + 1}` };
        }
    }
    
    return { isValid: true };
}

/**
 * Torna alla pagina precedente
 */
function goBack() {
    if (hasUnsavedChanges()) {
        if (!confirm('Ci sono modifiche non salvate. Vuoi davvero uscire?')) {
            return;
        }
    }
    
    navigateToPrograms();
}

/**
 * Verifica se ci sono modifiche non salvate
 */
function hasUnsavedChanges() {
    const name = document.getElementById('program-name')?.value;
    const time = document.getElementById('activation-time')?.value;
    const selectedMonths = document.querySelectorAll('.month-card.selected').length;
    const selectedZones = document.querySelectorAll('.zone-checkbox:checked').length;
    
    return !!(name || time || selectedMonths > 0 || selectedZones > 0);
}

/**
 * Naviga alla pagina programmi
 */
function navigateToPrograms() {
    if (window.IrrigationRouter?.loadPage) {
        window.IrrigationRouter.loadPage('view_programs.html');
    } else {
        window.location.href = 'view_programs.html';
    }
}

/**
 * Mostra toast notification
 */
function showToast(message, type = 'info') {
    if (window.IrrigationUI?.showToast) {
        window.IrrigationUI.showToast(message, type, 3000);
    } else {
        // Fallback: alert semplice
        alert(`${type.toUpperCase()}: ${message}`);
    }
}

/**
 * Gestisce errori durante l'inizializzazione
 */
function handleError(error) {
    console.error('Errore durante inizializzazione:', error);
    
    // Mostra errore nella griglia zone
    const zonesGrid = document.getElementById('zones-grid');
    if (zonesGrid) {
        zonesGrid.innerHTML = `<div class="error-state">Errore caricamento: ${error.message}</div>`;
    }
    
    showToast(error.message || 'Errore durante il caricamento', 'error');
}

/**
 * Cleanup risorse
 */
function cleanup() {
    if (window.CreateProgramModule.abortController) {
        window.CreateProgramModule.abortController.abort();
        window.CreateProgramModule.abortController = null;
    }
    
    window.CreateProgramModule.isInitialized = false;
}

/**
 * Utility: debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Toggle intervallo personalizzato
 * Chiamata dall'HTML
 */
function toggleCustomInterval() {
    const select = document.getElementById('recurrence');
    const customDiv = document.getElementById('custom-interval');
    
    if (select && customDiv) {
        if (select.value === 'custom') {
            customDiv.classList.add('show');
            const intervalInput = document.getElementById('interval-days');
            if (intervalInput) {
                intervalInput.focus();
            }
        } else {
            customDiv.classList.remove('show');
        }
    }
}

// Esporta funzioni globali
window.initializeCreateProgramPage = initializeCreateProgramPage;
window.saveProgram = saveProgram;
window.goBack = goBack;
window.toggleCustomInterval = toggleCustomInterval;

// Auto-inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.page-wrapper') && document.getElementById('zones-grid')) {
        setTimeout(initializeCreateProgramPage, 100);
    }
});

// Cleanup su unload
window.addEventListener('beforeunload', cleanup);