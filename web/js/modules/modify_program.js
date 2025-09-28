/**
 * modify_program.js - Modulo per la modifica di programmi esistenti
 * Versione completamente riscritta - pulita e mantenibile
 * 
 * Funzionalità:
 * - Caricamento dati programma esistente
 * - Rilevamento modifiche e avvisi
 * - Validazione e salvataggio modifiche
 * - Interfaccia moderna e responsive
 * - Integrazione con il sistema IrrigaSmart esistente
 */

// Stato del modulo
window.ModifyProgramModule = {
    isInitialized: false,
    abortController: null,
    programId: null,
    originalData: null,
    hasUnsavedChanges: false,
    currentData: {
        zones: [],
        months: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    }
};

/**
 * Inizializza la pagina di modifica programma
 */
function initializeModifyProgramPage() {
    console.log('🎨 Inizializzazione pagina modifica programma');
    
    if (window.ModifyProgramModule.isInitialized) {
        console.log('Pagina già inizializzata');
        return;
    }
    
    // Cleanup precedenti
    cleanup();
    
    // Verifica che ci sia un programma da modificare
    const programId = localStorage.getItem('editProgramId');
    if (!programId) {
        showToast('Nessun programma selezionato per la modifica', 'error');
        setTimeout(navigateToPrograms, 1500);
        return;
    }
    
    window.ModifyProgramModule.programId = programId;
    console.log('Modifica programma ID:', programId);
    
    // Applica traduzioni se disponibile
    if (window.IrrigationI18n?.applyTranslations) {
        window.IrrigationI18n.applyTranslations(document);
    }
    
    // Carica dati e inizializza interfaccia
    Promise.all([
        loadUserSettings(),
        loadProgramData(programId)
    ])
        .then(([userSettings, programData]) => initializeInterface(userSettings, programData))
        .catch(handleError)
        .finally(() => {
            window.ModifyProgramModule.isInitialized = true;
        });
    
    // Setup form validation e change detection
    setupFormValidation();
    setupChangeDetection();
}

/**
 * Carica le impostazioni utente dal server
 */
async function loadUserSettings() {
    if (window.ModifyProgramModule.abortController) {
        window.ModifyProgramModule.abortController.abort();
    }
    
    window.ModifyProgramModule.abortController = new AbortController();
    
    try {
        // Usa API esistente se disponibile
        if (window.IrrigationAPI?.loadUserSettings) {
            return await window.IrrigationAPI.loadUserSettings();
        }
        
        const response = await fetch('/data/user_settings.json', {
            signal: window.ModifyProgramModule.abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`Errore HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Caricamento impostazioni annullato');
            return null;
        }
        throw error;
    }
}

/**
 * Carica i dati del programma dal server
 */
async function loadProgramData(programId) {
    try {
        // Usa API esistente se disponibile
        if (window.IrrigationAPI?.loadPrograms) {
            const programs = await window.IrrigationAPI.loadPrograms();
            return programs[programId];
        }
        
        const response = await fetch('/data/program.json', {
            signal: window.ModifyProgramModule.abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`Errore HTTP ${response.status}: ${response.statusText}`);
        }
        
        const programs = await response.json();
        const program = programs[programId];
        
        if (!program) {
            throw new Error('Programma non trovato');
        }
        
        return program;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Caricamento programma annullato');
            return null;
        }
        throw error;
    }
}

/**
 * Inizializza l'interfaccia con i dati caricati
 */
function initializeInterface(userSettings, programData) {
    if (!userSettings || !programData) return;
    
    // Salva dati originali per rilevamento modifiche
    window.ModifyProgramModule.originalData = JSON.stringify(programData);
    
    // Salva zone per riferimento
    window.ModifyProgramModule.currentData.zones = userSettings.zones || [];
    
    // Mostra info programma nell'header
    showProgramInfo(programData);
    
    // Genera griglia mesi
    generateMonthsGrid();
    
    // Genera griglia zone
    generateZonesGrid(userSettings.zones);
    
    // Popola form con dati esistenti
    populateFormWithData(programData);
    
    console.log('✅ Interfaccia inizializzata con dati programma');
}

/**
 * Mostra informazioni programma nell'header
 */
function showProgramInfo(programData) {
    const programInfo = document.getElementById('program-info');
    const programNameSpan = document.getElementById('current-program-name');
    
    if (programInfo && programNameSpan) {
        programNameSpan.textContent = programData.name || `Programma ${window.ModifyProgramModule.programId}`;
        programInfo.style.display = 'block';
    }
}

/**
 * Genera la griglia dei mesi
 */
function generateMonthsGrid() {
    const container = document.getElementById('months-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    window.ModifyProgramModule.currentData.months.forEach((month, index) => {
        const monthCard = document.createElement('div');
        monthCard.className = 'month-card';
        monthCard.dataset.month = month;
        monthCard.textContent = month.substring(0, 3);
        monthCard.title = month;
        
        // Event listener per selezione
        monthCard.addEventListener('click', () => {
            monthCard.classList.toggle('selected');
            markAsModified();
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
    const container = document.getElementById('zone-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!zones || zones.length === 0) {
        container.innerHTML = '<div class="error-state">Nessuna zona configurata.</div>';
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
        markAsModified();
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
        durationInput.blur();
    }
    
    markAsModified();
    validateForm();
}

/**
 * Popola il form con i dati del programma esistente
 */
function populateFormWithData(programData) {
    console.log('🔧 Populating form with program data:', programData);
    
    // Nome programma
    const nameInput = document.getElementById('program-name');
    if (nameInput) {
        nameInput.value = programData.name || '';
        nameInput.dataset.originalValue = nameInput.value;
    }
    
    // Orario
    const timeInput = document.getElementById('start-time');
    if (timeInput) {
        timeInput.value = programData.activation_time || '';
        timeInput.dataset.originalValue = timeInput.value;
    }
    
    // Ricorrenza - mappa i valori dal database al form
    const recurrenceSelect = document.getElementById('recurrence');
    if (recurrenceSelect) {
        // Mappa valori dal database ai valori del form
        const recurrenceMapping = {
            'giornaliero': 'daily',
            'daily': 'daily',
            'giorni_alterni': 'alternatingDays', 
            'alternatingDays': 'alternatingDays',
            'personalizzato': 'custom',
            'custom': 'custom'
        };
        
        const mappedRecurrence = recurrenceMapping[programData.recurrence] || 'daily';
        recurrenceSelect.value = mappedRecurrence;
        recurrenceSelect.dataset.originalValue = recurrenceSelect.value;
        
        // Mostra/nascondi intervallo personalizzato
        toggleCustomInterval();
    }
    
    // Intervallo giorni personalizzato
    if (programData.recurrence === 'custom' && programData.interval_days) {
        const intervalInput = document.getElementById('custom-days-interval');
        if (intervalInput) {
            intervalInput.value = programData.interval_days;
            intervalInput.dataset.originalValue = intervalInput.value;
        }
    }
    
    // Mesi selezionati - aspetta che le card siano generate
    if (programData.months && programData.months.length > 0) {
        console.log('📅 Setting selected months:', programData.months);
        
        // Ritardo per assicurarsi che le card siano generate
        setTimeout(() => {
            programData.months.forEach(month => {
                // Prova sia il nome esatto che variazioni comuni
                const monthVariations = [
                    month,
                    month.toLowerCase(),
                    month.charAt(0).toUpperCase() + month.slice(1).toLowerCase()
                ];
                
                let monthCard = null;
                for (const variation of monthVariations) {
                    monthCard = document.querySelector(`[data-month="${variation}"]`);
                    if (monthCard) break;
                }
                
                if (monthCard) {
                    monthCard.classList.add('selected');
                    console.log(`✅ Selected month: ${month}`);
                } else {
                    console.warn(`⚠️ Month card not found for: ${month}`);
                    // Debug: mostra tutte le card disponibili
                    const allMonthCards = document.querySelectorAll('[data-month]');
                    console.log('Available month cards:', Array.from(allMonthCards).map(card => card.dataset.month));
                }
            });
        }, 200);
    }
    
    // Zone e durate - aspetta che le card siano generate
    if (programData.steps && programData.steps.length > 0) {
        console.log('🏠 Setting selected zones:', programData.steps);
        
        setTimeout(() => {
            programData.steps.forEach(step => {
                const zoneCard = document.querySelector(`[data-zone-id="${step.zone_id}"]`);
                const checkbox = document.getElementById(`zone-${step.zone_id}`);
                const durationInput = document.getElementById(`duration-${step.zone_id}`);
                
                if (zoneCard && checkbox && durationInput) {
                    checkbox.checked = true;
                    zoneCard.classList.add('selected');
                    durationInput.disabled = false;
                    durationInput.value = step.duration || 10;
                    durationInput.dataset.originalValue = durationInput.value;
                    console.log(`✅ Selected zone ${step.zone_id} with duration ${step.duration}`);
                } else {
                    console.warn(`⚠️ Zone elements not found for zone_id: ${step.zone_id}`);
                }
            });
        }, 300);
    }
    
    // Reset flag modifiche dopo caricamento
    setTimeout(() => {
        window.ModifyProgramModule.hasUnsavedChanges = false;
        hideUnsavedWarning();
        console.log('✅ Form popolato completamente');
    }, 500);
}

/**
 * Setup rilevamento modifiche
 */
function setupChangeDetection() {
    const form = document.querySelector('.page-wrapper');
    if (!form) return;
    
    // Monitora tutti gli input
    form.addEventListener('input', (e) => {
        if (e.target.matches('input, select, textarea')) {
            checkIfModified(e.target);
        }
    });
    
    form.addEventListener('change', (e) => {
        if (e.target.matches('input, select, textarea')) {
            checkIfModified(e.target);
        }
    });
}

/**
 * Verifica se un campo è stato modificato
 */
function checkIfModified(input) {
    const originalValue = input.dataset.originalValue || '';
    const currentValue = input.value;
    
    if (currentValue !== originalValue) {
        input.classList.add('modified');
        markAsModified();
    } else {
        input.classList.remove('modified');
    }
}

/**
 * Marca il form come modificato
 */
function markAsModified() {
    if (window.ModifyProgramModule.hasUnsavedChanges) return;
    
    window.ModifyProgramModule.hasUnsavedChanges = true;
    
    // Aggiorna UI
    const saveButton = document.getElementById('save-button');
    if (saveButton) {
        saveButton.classList.add('modified');
    }
    
    showUnsavedWarning();
    
    console.log('📝 Form marcato come modificato');
}

/**
 * Mostra warning modifiche non salvate
 */
function showUnsavedWarning() {
    const warning = document.getElementById('unsaved-warning');
    if (warning) {
        warning.classList.add('show');
    }
}

/**
 * Nasconde warning modifiche non salvate
 */
function hideUnsavedWarning() {
    const warning = document.getElementById('unsaved-warning');
    if (warning) {
        warning.classList.remove('show');
    }
}

/**
 * Setup validazione form
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
 * Valida durata input
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
    const timeInput = document.getElementById('start-time');
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
 * Raccoglie i dati del programma dal form
 */
function collectProgramData() {
    const recurrenceSelect = document.getElementById('recurrence');
    
    // Mappa valori dal form al database
    const recurrenceReverseMapping = {
        'daily': 'giornaliero',
        'alternatingDays': 'giorni_alterni',
        'custom': 'personalizzato'
    };
    
    const formRecurrence = recurrenceSelect?.value || 'daily';
    const dbRecurrence = recurrenceReverseMapping[formRecurrence] || 'giornaliero';
    
    const programData = {
        id: window.ModifyProgramModule.programId,
        name: document.getElementById('program-name').value.trim(),
        activation_time: document.getElementById('start-time').value,
        recurrence: dbRecurrence,
        months: [],
        steps: []
    };
    
    // Aggiungi intervallo personalizzato se necessario
    if (formRecurrence === 'custom') {
        programData.interval_days = parseInt(document.getElementById('custom-days-interval').value) || 3;
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
 * Salva le modifiche al programma
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
        
        // Invia al server - usa endpoint di update specifico
        const response = await fetch('/update_program', {
            method: 'PUT',
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
            showToast('Programma modificato con successo!', 'success');
            
            // Reset flag modifiche
            window.ModifyProgramModule.hasUnsavedChanges = false;
            hideUnsavedWarning();
            
            // Pulisci storage e naviga
            localStorage.removeItem('editProgramId');
            
            setTimeout(() => {
                navigateToPrograms();
            }, 1500);
        } else {
            throw new Error(result.error || 'Errore durante il salvataggio');
        }
        
    } catch (error) {
        console.error('Errore salvataggio modifiche:', error);
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
 * Annulla le modifiche e torna indietro
 */
function cancelEdit() {
    if (window.ModifyProgramModule.hasUnsavedChanges) {
        if (!confirm('Ci sono modifiche non salvate. Vuoi davvero annullare?')) {
            return;
        }
    }
    
    // Pulisci e naviga
    localStorage.removeItem('editProgramId');
    cleanup();
    navigateToPrograms();
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
    
    // Mostra errore nelle griglie
    const containers = ['months-list', 'zone-list'];
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<div class="error-state">Errore: ${error.message}</div>`;
        }
    });
    
    showToast(error.message || 'Errore durante il caricamento', 'error');
}

/**
 * Cleanup risorse
 */
function cleanup() {
    if (window.ModifyProgramModule.abortController) {
        window.ModifyProgramModule.abortController.abort();
        window.ModifyProgramModule.abortController = null;
    }
    
    window.ModifyProgramModule.isInitialized = false;
    window.ModifyProgramModule.hasUnsavedChanges = false;
    window.ModifyProgramModule.originalData = null;
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
            const intervalInput = document.getElementById('custom-days-interval');
            if (intervalInput) {
                intervalInput.focus();
            }
        } else {
            customDiv.classList.remove('show');
        }
    }
}

// Esporta funzioni globali
window.initializeModifyProgramPage = initializeModifyProgramPage;
window.saveProgram = saveProgram;
window.cancelEdit = cancelEdit;
window.toggleCustomInterval = toggleCustomInterval;

// Auto-inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.page-wrapper') && document.getElementById('zone-list')) {
        setTimeout(initializeModifyProgramPage, 100);
    }
});

// Cleanup su unload
window.addEventListener('beforeunload', cleanup);

// Warning per modifiche non salvate
window.addEventListener('beforeunload', (e) => {
    if (window.ModifyProgramModule.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});