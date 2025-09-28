// view_programs.js - Versione con banner real-time
// Protezione contro caricamento multiplo del modulo
if (window.ViewProgramsPageModuleLoaded) {
    console.warn("Modulo view_programs.js già caricato, evito ridichiarazioni");
} else {
    window.ViewProgramsPageModuleLoaded = true;

// Namespace ottimizzato per gestione programmi ESP32S3
window.ViewProgramsPage = window.ViewProgramsPage || {
    statusInterval: null,
    programsData: {},
    zoneNameMap: {},
    lastKnownState: null,
    abortControllers: new Map(),
    zoneProgressData: {},
    
    // ==================== CONFIGURAZIONE POLLING INTELLIGENTE ====================
    // Intervalli ottimizzati per ESP32S3
    POLL_INTERVAL_IDLE: 5000,        // 12 secondi quando nessun programma attivo
    POLL_INTERVAL_ACTIVE: 2000,       // 3 secondi quando programma in esecuzione
    POLL_INTERVAL_CRITICAL: 1000,     // 1 secondo nei primi 30 secondi dopo avvio
    POLL_INTERVAL_BACKGROUND: 20000,  // 20 secondi quando tab in background
    
    // Gestione stato e ottimizzazioni
    criticalPollEnd: 0,               // Fine del polling critico
    lastServerSync: 0,                // Timestamp ultimo sync server
    isPollingActive: false,           // Flag per evitare polling sovrapposti
    backgroundMode: false,            // Flag modalità background
    syncTolerance: 2,                 // Tolleranza sincronizzazione
    lastProgramState: null,           // Cache stato precedente per rilevare cambiamenti
    uiUpdateMode: 'seconds',          // 'seconds' o 'minutes' per timer
    
    // Statistiche prestazioni
    pollCount: 0,
    errorCount: 0,
    lastError: null,
    avgResponseTime: 0,
    responseTimeHistory: []
};

// ==================== OTTIMIZZAZIONI ESP32S3 PER PROGRAMMI ====================

function optimizeProgramsForESP32S3() {
    /**
     * Applica ottimizzazioni specifiche per ESP32S3 nella gestione programmi.
     */
    // Ottimizza intervalli per ESP32S3
    window.ViewProgramsPage.POLL_INTERVAL_IDLE = 10000;      // 10 secondi idle
    window.ViewProgramsPage.POLL_INTERVAL_ACTIVE = 2500;     // 2.5 secondi attivo
    window.ViewProgramsPage.POLL_INTERVAL_CRITICAL = 800;    // 800ms critico
    window.ViewProgramsPage.POLL_INTERVAL_BACKGROUND = 15000; // 15 secondi background
    
    // Riduce tolleranza per maggiore precisione
    window.ViewProgramsPage.syncTolerance = 1;
    
    console.log("⚡ Ottimizzazioni ESP32S3 applicate per programmi");
}

function setProgramUIMode(mode) {
    /**
     * Configura modalità UI per timer dei programmi.
     * @param {string} mode - 'seconds' per MM:SS, 'minutes' per risparmio risorse
     */
    const validModes = ['seconds', 'minutes'];
    if (!validModes.includes(mode)) {
        console.warn(`Modalità UI programmi non valida: ${mode}. Usando 'seconds'.`);
        mode = 'seconds';
    }
    
    window.ViewProgramsPage.uiUpdateMode = mode;
    console.log(`🎨 Modalità UI programmi: ${mode}`);
    
    // Salva preferenza
    try {
        localStorage.setItem('irrigation_programs_ui_mode', mode);
    } catch (e) {
        // Ignore se localStorage non disponibile
    }
}

function detectOptimalProgramUIMode() {
    /**
     * Rileva modalità UI ottimale per la gestione programmi.
     */
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad/.test(userAgent);
    const isLowEndDevice = /android.*4\.|android.*5\.0/.test(userAgent);
    
    // Controlla preferenza salvata
    try {
        const savedMode = localStorage.getItem('irrigation_programs_ui_mode');
        if (savedMode && ['seconds', 'minutes'].includes(savedMode)) {
            return savedMode;
        }
    } catch (e) {
        // Ignore
    }
    
    // Auto-rilevamento
    if (isLowEndDevice) {
        console.log("🔍 Dispositivo low-end rilevato, modalità programmi 'minutes'");
        return 'minutes';
    } else if (isMobile) {
        console.log("🔍 Dispositivo mobile rilevato, modalità programmi 'seconds'");
        return 'seconds';
    } else {
        console.log("🔍 Dispositivo desktop rilevato, modalità programmi 'seconds'");
        return 'seconds';
    }
}

function initializeViewProgramsPage() {
    console.log("🚀 Inizializzazione pagina programmi - ESP32S3 Ottimizzata");
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    // Applica ottimizzazioni ESP32S3
    optimizeProgramsForESP32S3();
    
    // Rileva modalità UI ottimale
    const optimalMode = detectOptimalProgramUIMode();
    setProgramUIMode(optimalMode);
    
    // Assicurati che le funzioni di gestione progresso siano disponibili
    if (typeof saveZoneOriginalDuration !== 'function') {
        console.log("Aggiungendo funzioni di gestione progresso...");
        
        window.saveZoneOriginalDuration = function(zoneId, duration) {
            try {
                let savedZones = {};
                const savedData = localStorage.getItem('zoneOriginalData');
                if (savedData) {
                    savedZones = JSON.parse(savedData);
                }
                savedZones[zoneId] = {
                    originalDuration: duration * 60, 
                    startTimestamp: Date.now(),
                    totalSeconds: duration * 60
                };
                localStorage.setItem('zoneOriginalData', JSON.stringify(savedZones));
            } catch (e) { console.warn('Impossibile salvare dati originali zona:', e); }
        };

        window.updateZoneExecution = function(zoneId, remainingSeconds) {
            try {
                const savedData = localStorage.getItem('zoneOriginalData');
                if (!savedData) return;
                const savedZones = JSON.parse(savedData);
                if (!savedZones[zoneId]) return;
                savedZones[zoneId].lastRemainingSeconds = remainingSeconds;
                savedZones[zoneId].lastUpdateTime = Date.now();
                localStorage.setItem('zoneOriginalData', JSON.stringify(savedZones));
            } catch (e) { console.warn('Impossibile aggiornare stato zona:', e); }
        };

        window.getCorrectProgressPercentage = function(zoneId, currentRemainingSeconds) {
            try {
                const savedData = localStorage.getItem('zoneOriginalData');
                if (!savedData) return 0;
                const savedZones = JSON.parse(savedData);
                if (!savedZones[zoneId]) return 0;
                const originalData = savedZones[zoneId];
                const originalDuration = originalData.originalDuration;
                const elapsedSeconds = originalDuration - currentRemainingSeconds;
                const progressPercentage = Math.min(100, Math.max(0, (elapsedSeconds / originalDuration) * 100));
                return progressPercentage;
            } catch (e) { console.warn('Impossibile calcolare percentuale progresso:', e); return 0; }
        };

        window.clearZoneData = function(zoneId) {
            try {
                const savedData = localStorage.getItem('zoneOriginalData');
                if (!savedData) return;
                const savedZones = JSON.parse(savedData);
                if (savedZones[zoneId]) {
                    delete savedZones[zoneId];
                    localStorage.setItem('zoneOriginalData', JSON.stringify(savedZones));
                }
            } catch (e) { console.warn('Impossibile eliminare dati zona:', e); }
        };
    }
    
    cleanupViewProgramsPage();
    addViewProgramsStyles();
    loadUserSettingsAndPrograms();
    startProgramStatusPolling();
    
    window.addEventListener('pagehide', cleanupViewProgramsPage, { once: true });
    window.fetchProgramState = fetchProgramState;
    document.addEventListener('click', handleGlobalStopClick);
    
    if (window.IrrigationI18n) window.IrrigationI18n.applyTranslations(document.getElementById('content'));
}

function handleGlobalStopClick(e) {
    const stopSelectors = [
        '.global-stop-btn', '.banner-stop-btn', '.stop-program-button'
    ];
    
    if (stopSelectors.some(selector => e.target.closest(selector))) {
        e.preventDefault();
        e.stopPropagation();
        const api = window.IrrigationAPI;
        if (api && api.stopProgram) {
            api.stopProgram();
        }
    }
}

function addViewProgramsStyles() {
    const ui = window.IrrigationUI;
    if (ui && ui.addStyles) {
        ui.addStyles('view-programs-style', `
            .program-card, .add-program-card {
                transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
                position: relative;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0,0,0,0.08);
                border: 2px solid rgba(230,235,240,0.8);
                border-radius: 24px;
                display: flex;
                flex-direction: column;
                min-height: 450px;
            }
            
            .add-program-card {
                background: var(--color-surface-alt);
                border-style: dashed;
                border-color: var(--color-border-dark);
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--color-text-muted);
                min-height: 300px; 
            }
            .add-program-card:hover {
                border-color: var(--color-primary);
                color: var(--color-primary);
                transform: translateY(-8px);
                box-shadow: 0 12px 48px rgba(0,0,0,0.12);
            }
            .add-program-card svg {
                width: 64px;
                height: 64px;
                margin-bottom: 15px;
                fill: currentColor;
                transition: transform 0.3s ease;
            }
            .add-program-card:hover svg {
                transform: scale(1.1);
            }
            .add-program-card span {
                font-size: 18px;
                font-weight: 600;
            }

            .program-card:hover {
                transform: translateY(-8px);
                box-shadow: 0 12px 48px rgba(0,0,0,0.12);
            }
            
            .program-card.active-program {
                border: 3px solid #00cc66 !important;
                animation: pulse-green 2s infinite !important;
            }
            
            @keyframes pulse-green {
                0% { box-shadow: 0 0 0 0 rgba(0, 204, 102, 0.4); }
                50% { box-shadow: 0 0 20px 10px rgba(0, 204, 102, 0.2); }
                100% { box-shadow: 0 0 0 0 rgba(0, 204, 102, 0.4); }
            }
            
            .btn.loading {
                position: relative;
                color: transparent !important;
                pointer-events: none;
            }
            
            .btn.loading::after {
                content: "";
                position: absolute;
                width: 20px;
                height: 20px;
                top: 50%;
                left: 50%;
                margin-top: -10px;
                margin-left: -10px;
                border-radius: 50%;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .running-status-section {
                padding: 16px 24px;
                font-size: 14px;
                background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.04));
                border-bottom: 1px solid rgba(16, 185, 129, 0.2);
                animation: fadeInStatus 0.4s ease;
            }
            
            @keyframes fadeInStatus {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .progress-bar-container {
                height: 6px;
                background-color: rgba(16, 185, 129, 0.2);
                border-radius: 6px;
                overflow: hidden;
                margin-top: 8px;
            }
            
            .progress-bar {
                height: 100%;
                background: linear-gradient(90deg, var(--color-success), var(--color-success-dark));
                border-radius: 6px;
                transition: width 0.5s linear;
                box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
            }
            
            .info-grid {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 8px 16px;
                margin-bottom: 20px;
                padding: 16px;
                background: linear-gradient(135deg, #F7F9FB, #FFFFFF);
                border-radius: 16px;
                border: 1px solid rgba(230,235,240,0.5);
            }
            
            .btn {
                font-size: 14px;
                padding: 14px 20px;
                font-weight: 600;
                border-radius: 16px;
                transition: all 0.3s ease;
                letter-spacing: 0.5px;
            }
            
            .btn:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 24px rgba(16,185,129,0.4);
            }
            
            .month-tag,
            .zone-tag {
                padding: 8px 16px;
                border-radius: 30px;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.3;
                white-space: nowrap;
                transition: all 0.2s ease;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                letter-spacing: 0.2px;
                position: relative;
                overflow: hidden;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            
            .month-tag::before,
            .zone-tag::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(to bottom, rgba(255,255,255,0.2), rgba(255,255,255,0));
                z-index: 1;
                pointer-events: none;
            }
            
            .month-tag.active {
                background: var(--color-primary);
                color: white;
                box-shadow: 0 3px 10px rgba(var(--color-primary-rgb), 0.3);
                transform: translateY(-1px);
            }
            
            .month-tag.inactive {
                background-color: #F1F3F5;
                color: #7B8A9E;
                border: 1px solid #E2E8F0;
            }
            
            .zone-tag {
                background: var(--color-success);
                color: white;
                box-shadow: 0 3px 10px rgba(16, 185, 129, 0.25);
                border: none;
                padding: 8px 16px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            
            .zone-tag .duration {
                font-weight: 700;
                background: rgba(255,255,255,0.25);
                padding: 3px 8px;
                border-radius: 20px;
                font-size: 11px;
                margin-left: 4px;
            }
            
            .months-grid,
            .zones-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 16px;
            }
            

            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `);
    }
}

function cleanupViewProgramsPage() {
    console.log("Cleanup pagina visualizzazione programmi");
    stopProgramStatusPolling();
    window.ViewProgramsPage.abortControllers.forEach(controller => controller.abort());
    window.ViewProgramsPage.abortControllers.clear();
    document.removeEventListener('click', handleGlobalStopClick);
    window.removeEventListener('pagehide', cleanupViewProgramsPage);
    

}

function startProgramStatusPolling() {
    stopProgramStatusPolling();
    fetchProgramState();
    scheduleNextProgramPoll();
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function scheduleNextProgramPoll() {
    /**
     * Programma il prossimo polling basandosi sul contesto attuale.
     */
    const now = Date.now();
    const state = window.ViewProgramsPage.lastKnownState;
    let interval;
    
    // Determina intervallo basato sul contesto
    if (window.ViewProgramsPage.backgroundMode) {
        // Tab in background - polling molto rilassato
        interval = window.ViewProgramsPage.POLL_INTERVAL_BACKGROUND;
    } else if (now < window.ViewProgramsPage.criticalPollEnd) {
        // Polling critico nei primi 30 secondi dopo avvio programma
        interval = window.ViewProgramsPage.POLL_INTERVAL_CRITICAL;
    } else if (state?.program_running) {
        // Programma in esecuzione - polling frequente
        interval = window.ViewProgramsPage.POLL_INTERVAL_ACTIVE;
    } else {
        // Nessun programma attivo - polling rilassato
        interval = window.ViewProgramsPage.POLL_INTERVAL_IDLE;
    }
    
    window.ViewProgramsPage.statusInterval = setTimeout(() => {
        fetchProgramState();
        scheduleNextProgramPoll(); // Riprogramma in base al nuovo stato
    }, interval);
    
    const programStatus = state?.program_running ? 'ATTIVO' : 'IDLE';
    const bgStatus = window.ViewProgramsPage.backgroundMode ? ' (Background)' : '';
    console.log(`📊 Prossimo polling programmi in ${interval/1000}s - Stato: ${programStatus}${bgStatus}`);
}

function handleVisibilityChange() {
    /**
     * Gestisce intelligentemente il cambio di visibilità della pagina.
     */
    if (!window.ViewProgramsPage.statusInterval) return;
    
    const wasBackground = window.ViewProgramsPage.backgroundMode;
    window.ViewProgramsPage.backgroundMode = document.hidden;
    
    console.log(`👁️ Visibilità cambiata: ${document.hidden ? 'BACKGROUND' : 'FOREGROUND'}`);
    
    // Riavvia il polling con nuova configurazione
    stopProgramStatusPolling();
    
    if (!document.hidden && wasBackground) {
        // Tornando in foreground, forza un fetch immediato
        fetchProgramState();
    }
    
    scheduleNextProgramPoll();
}

function stopProgramStatusPolling() {
    if (window.ViewProgramsPage.statusInterval) {
        clearTimeout(window.ViewProgramsPage.statusInterval);
        clearInterval(window.ViewProgramsPage.statusInterval); // Backward compatibility
        window.ViewProgramsPage.statusInterval = null;
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
}

async function fetchProgramState() {
    // Evita polling sovrapposti
    if (window.ViewProgramsPage.isPollingActive) {
        console.log("⏭️ Polling programmi già in corso, saltato");
        return;
    }
    
    window.ViewProgramsPage.isPollingActive = true;
    window.ViewProgramsPage.pollCount++;
    
    const controller = new AbortController();
    window.ViewProgramsPage.abortControllers.set('program-state', controller);
    
    try {
        const startTime = Date.now();
        const response = await fetch('/get_program_state', { 
            signal: controller.signal,
            cache: 'no-cache' // Evita cache per dati real-time
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const state = await response.json();
        
        // Calcola statistiche prestazioni
        const responseTime = Date.now() - startTime;
        updatePerformanceStats(responseTime);
        window.ViewProgramsPage.lastServerSync = Date.now();
        
        if (state && typeof state === 'object') {
            const previousState = window.ViewProgramsPage.lastKnownState;
            const stateChanged = hasStateChanged(previousState, state);
            
            window.ViewProgramsPage.lastKnownState = state;
            window.ViewProgramsPage.lastProgramState = { ...state };
            
            // Log delle performance
            console.log(`📡 Sync programmi in ${responseTime}ms - Cambiamenti: ${stateChanged ? 'SÌ' : 'NO'}`);
            
            updateProgramsUI(state);
            
            if (state.program_running && state.current_program_id) {
                updateRunningProgramStatus(state);
                
                // Avvia polling critico solo se programma appena iniziato
                if (!previousState?.program_running) {
                    startCriticalProgramPolling();
                }
            } else {
                hideRunningStatus();
                // Reset polling critico quando programma si ferma
                window.ViewProgramsPage.criticalPollEnd = 0;
            }
        }
    } catch (error) {
        window.ViewProgramsPage.errorCount++;
        window.ViewProgramsPage.lastError = error;
        
        if (error.name !== 'AbortError') {
            console.error('❌ Errore nel recupero dello stato del programma:', error);
            // In caso di errore, rallenta il polling per non sovraccaricare
            window.ViewProgramsPage.criticalPollEnd = 0;
        }
    } finally {
        window.ViewProgramsPage.abortControllers.delete('program-state');
        window.ViewProgramsPage.isPollingActive = false;
    }
}

// ==================== FUNZIONI HELPER PRESTAZIONI ====================

function updatePerformanceStats(responseTime) {
    /**
     * Aggiorna statistiche delle prestazioni per monitoraggio.
     */
    const history = window.ViewProgramsPage.responseTimeHistory;
    history.push(responseTime);
    
    // Mantieni solo gli ultimi 20 tempi di risposta
    if (history.length > 20) {
        history.shift();
    }
    
    // Calcola tempo medio
    window.ViewProgramsPage.avgResponseTime = 
        history.reduce((sum, time) => sum + time, 0) / history.length;
}

function hasStateChanged(previousState, currentState) {
    /**
     * Controlla se lo stato del programma è effettivamente cambiato.
     */
    if (!previousState) return true;
    
    return (
        previousState.program_running !== currentState.program_running ||
        previousState.current_program_id !== currentState.current_program_id ||
        JSON.stringify(previousState.active_zone) !== JSON.stringify(currentState.active_zone)
    );
}

function startCriticalProgramPolling() {
    /**
     * Avvia polling critico per 30 secondi dopo l'avvio di un programma.
     */
    console.log("🚀 Avvio polling critico programmi per 30 secondi");
    window.ViewProgramsPage.criticalPollEnd = Date.now() + 30000;
}

// ==================== GESTIONE DISPLAY TIMER PROGRAMMI ====================

function updateProgramTimerDisplay(programId, zoneData) {
    /**
     * Aggiorna il display del timer per un programma in esecuzione.
     * @param {string} programId - ID del programma
     * @param {Object} zoneData - Dati della zona attiva
     */
    if (!zoneData || !zoneData.remaining_time) return;
    
    const timerElement = document.querySelector(`[data-program-id="${programId}"] .program-timer`);
    if (!timerElement) return;
    
    const remainingSeconds = zoneData.remaining_time;
    let displayText;
    
    if (window.ViewProgramsPage.uiUpdateMode === 'minutes') {
        // Modalità solo minuti
        const totalMinutes = Math.ceil(remainingSeconds / 60);
        displayText = `${totalMinutes}min rimanenti`;
    } else {
        // Modalità MM:SS completa
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        displayText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} rimanenti`;
    }
    
    // Aggiorna solo se diverso (ottimizzazione DOM)
    if (timerElement.textContent !== displayText) {
        timerElement.textContent = displayText;
    }
    
    // Aggiorna barra progresso se presente
    const progressBar = document.querySelector(`[data-program-id="${programId}"] .zone-progress-bar`);
    if (progressBar && zoneData.total_duration) {
        const progressPercentage = ((zoneData.total_duration - remainingSeconds) / zoneData.total_duration) * 100;
        progressBar.style.width = `${Math.min(100, Math.max(0, progressPercentage))}%`;
    }
}

async function loadUserSettingsAndPrograms() {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const programsContainer = document.getElementById('programs-container');
    if (programsContainer) {
        programsContainer.innerHTML = `<div class="loading">${t('general.loading', 'Caricamento programmi...')}</div>`;
    }
    const controllers = {
        settings: new AbortController(),
        programs: new AbortController(),
        state: new AbortController()
    };
    Object.entries(controllers).forEach(([key, controller]) => {
        window.ViewProgramsPage.abortControllers.set(key, controller);
    });
    try {
        const [settings, programs, state] = await Promise.all([
            fetch('/data/user_settings.json', { signal: controllers.settings.signal }).then(r => r.json()),
            fetch('/data/program.json', { signal: controllers.programs.signal }).then(r => r.json()),
            fetch('/get_program_state', { signal: controllers.state.signal }).then(r => r.json())
        ]);
        window.ViewProgramsPage.lastKnownState = state;
        window.ViewProgramsPage.zoneNameMap = {};
        if (settings.zones && Array.isArray(settings.zones)) {
            settings.zones.forEach(zone => {
                if (zone && zone.id !== undefined) {
                    window.ViewProgramsPage.zoneNameMap[zone.id] = zone.name || `${t('manual.zone','Zona')} ${zone.id + 1}`;
                }
            });
        }
        window.ViewProgramsPage.programsData = programs || {};
        renderProgramCards(programs || {}, state);
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Errore nel caricamento dei dati:', error);
            showToastMessage('toastMessages.errorLoadingPrograms', 'error');
            if (programsContainer) {
                programsContainer.innerHTML = `
                    <div class="empty-state">
                        <h3>${t('programs.emptyStateTitle', 'Errore nel caricamento dei programmi')}</h3>
                        <p>${error.message}</p>
                        <button class="btn primary" onclick="loadUserSettingsAndPrograms()">${t('general.retry', 'Riprova')}</button>
                    </div>
                `;
            }
        }
    } finally {
        Object.keys(controllers).forEach(key => {
            window.ViewProgramsPage.abortControllers.delete(key);
        });
    }
}

function renderProgramCards(programs, state) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const container = document.getElementById('programs-container');
    if (!container) return;
    
    container.innerHTML = '';

    const programIds = Object.keys(programs);
    
    programIds.forEach(programId => {
        const program = programs[programId];
        if (!program) return;
        const programCard = createProgramCard(program, programId, state);
        container.appendChild(programCard);
    });
    
    const addProgramCard = document.createElement('div');
    addProgramCard.className = 'add-program-card';
    addProgramCard.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
        </svg>
        <span data-i18n="programs.newProgram">${t('programs.newProgram','Nuovo Programma')}</span>
    `;
    addProgramCard.onclick = () => {
        const router = window.IrrigationRouter;
        if (router && router.loadPage) {
            router.loadPage('create_program.html');
        } else if (typeof window.loadPage === 'function') {
            window.loadPage('create_program.html');
        }
    };
    container.appendChild(addProgramCard);
    
    if (window.IrrigationI18n) window.IrrigationI18n.applyTranslations(container);

}

function createProgramCard(program, programId, state) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    if (program.id === undefined) program.id = programId;
    const isActive = state.program_running && state.current_program_id === String(programId);
    const monthsHtml = buildMonthsGrid(program.months || []);
    const zonesHtml = buildZonesGrid(program.steps || []);
    const isAutomatic = program.automatic_enabled !== false;
    const programCard = document.createElement('div');
    programCard.className = `program-card ${isActive ? 'active-program' : ''}`;
    programCard.setAttribute('data-program-id', programId);
    programCard.innerHTML = `
        <div class="program-card-header">
            <div class="program-title-section">
                <h3>${program.name || t('programs.unnamedProgram', 'Programma senza nome')}</h3>
            </div>
            ${isActive ? `<div class="active-indicator" data-i18n="programs.programRunning">${t('programs.programRunning','IN ESECUZIONE')}</div>` : ''}
        </div>
        ${isActive ? `<div class="running-status-section" id="running-status-${programId}"></div>` : ''}
        <div class="program-content">
            <div class="info-grid">
                <span class="info-label" data-i18n="programs.timeLabel">${t('programs.timeLabel','Orario:')}</span>
                <span class="info-value">${program.activation_time || t('programs.notSet', 'Non impostato')}</span>
                <span class="info-label" data-i18n="programs.frequencyLabel">${t('programs.frequencyLabel','Frequenza:')}</span>
                <span class="info-value">${formatRecurrence(program.recurrence, program.interval_days)}</span>
                <span class="info-label" data-i18n="programs.lastRunLabel">${t('programs.lastRunLabel','Ultima esecuzione:')}</span>
                <span class="info-value">${program.last_run_date || t('programs.neverRun','Mai eseguito')}</span>
            </div>
            <div class="tags-container">
                <h4 data-i18n="programs.activeMonthsLabel">${t('programs.activeMonthsLabel','MESI ATTIVI')}</h4>
                <div class="months-grid">${monthsHtml}</div>
            </div>
            <div class="tags-container">
                <h4 data-i18n="programs.zonesLabel">${t('programs.zonesLabel','ZONE')}</h4>
                <div class="zones-grid">${zonesHtml}</div>
            </div>
            <div class="auto-execution-row">
                <span class="auto-status-label" data-i18n="programs.autoExecutionLabel">${t('programs.autoExecutionLabel','Esecuzione automatica')}</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="auto-switch-${programId}" 
                           class="auto-program-toggle" 
                           data-program-id="${programId}" 
                           ${isAutomatic ? 'checked' : ''}
                           ${state.program_running ? 'disabled' : ''}
                           onchange="toggleProgramAutomatic('${programId}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="program-actions">
            <div class="action-button-group">
                ${isActive 
                    ? `<button class="btn btn-start disabled" disabled>
                        <span class="button-icon">▶</span> <span data-i18n="programs.programRunning">${t('programs.programRunning','In Esecuzione')}</span>
                       </button>`
                    : `<button class="btn btn-start" onclick="startProgram('${programId}')" ${state.program_running ? 'disabled' : ''}>
                        <span class="button-icon">▶</span> <span data-i18n="programs.startNowButton">${t('programs.startNowButton','Avvia Ora')}</span>
                       </button>`}
                <button class="btn btn-edit" onclick="editProgram('${programId}')" ${state.program_running ? 'disabled' : ''}>
                    <span class="button-icon">✏️</span> <span data-i18n="programs.editButton">${t('programs.editButton','Modifica')}</span>
                </button>
                <button class="btn btn-delete" onclick="deleteProgram('${programId}')" ${state.program_running ? 'disabled' : ''}>
                    <span class="button-icon">🗑️</span> <span data-i18n="programs.deleteButton">${t('programs.deleteButton','Elimina')}</span>
                </button>
            </div>
        </div>
    `;
    return programCard;
}

function updateProgramsUI(state) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const currentProgramId = state.current_program_id;
    const programRunning = state.program_running;
    document.querySelectorAll('.program-card').forEach(card => {
        const cardProgramId = card.getAttribute('data-program-id');
        const isActive = programRunning && String(cardProgramId) === String(currentProgramId);
        card.classList.toggle('active-program', isActive);
        let indicator = card.querySelector('.active-indicator');
        if (isActive && !indicator) {
            const header = card.querySelector('.program-card-header');
            if (header) {
                indicator = document.createElement('div');
                indicator.className = 'active-indicator';
                indicator.textContent = t('programs.programRunning','IN ESECUZIONE');
                header.appendChild(indicator);
            }
        } else if (!isActive && indicator) {
            indicator.remove();
        }
        const startBtn = card.querySelector('.btn-start');
        const startBtnText = startBtn?.querySelector('span:not(.button-icon)');
        
        if (startBtn && startBtnText) {
            if (isActive) {
                startBtn.classList.add('disabled');
                startBtn.disabled = true;
                startBtnText.textContent = t('programs.programRunning','In Esecuzione');
            } else if (programRunning) {
                startBtn.classList.add('disabled');
                startBtn.disabled = true;
                startBtnText.textContent = t('programs.programRunningOther','Altro programma attivo');
            } else {
                startBtn.classList.remove('disabled');
                startBtn.disabled = false;
                startBtnText.textContent = t('programs.startNowButton','Avvia Ora');
            }
        }
        
        const editBtn = card.querySelector('.btn-edit');
        const deleteBtn = card.querySelector('.btn-delete');
        const autoToggle = card.querySelector('.auto-program-toggle');
        
        if (editBtn) editBtn.disabled = programRunning;
        if (deleteBtn) deleteBtn.disabled = programRunning;
        if (autoToggle) autoToggle.disabled = programRunning;
    });
    

}

function updateRunningProgramStatus(state) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const activeCard = document.querySelector(`.program-card[data-program-id="${state.current_program_id}"]`);
    if (!activeCard) return;
    
    let statusSection = activeCard.querySelector('.running-status-section');
    if (!statusSection) {
        statusSection = document.createElement('div');
        statusSection.className = 'running-status-section';
        statusSection.id = `running-status-${state.current_program_id}`;
        const contentDiv = activeCard.querySelector('.program-content');
        if (contentDiv) activeCard.insertBefore(statusSection, contentDiv);
    }
    
    if (state.active_zone) {
        const zoneId = state.active_zone.id;
        const zoneName = state.active_zone.name || `${t('manual.zone','Zona')} ${zoneId + 1}`;
        const remainingSeconds = state.active_zone.remaining_time || 0;
        
        // ==================== TIMER ADATTIVO OTTIMIZZATO ====================
        let formattedTime;
        if (window.ViewProgramsPage.uiUpdateMode === 'minutes') {
            // Modalità solo minuti per risparmiare risorse
            const totalMinutes = Math.ceil(remainingSeconds / 60);
            formattedTime = `${totalMinutes}min`;
        } else {
            // Modalità MM:SS completa
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        let progressPercentage = 0;
        const program = window.ViewProgramsPage.programsData[state.current_program_id];
        
        if (program && program.steps) {
            const currentStep = program.steps.find(step => parseInt(step.zone_id) === parseInt(zoneId));
            if (currentStep && currentStep.duration) {
                try {
                    // Gestione cache dati zona ottimizzata
                    const savedData = localStorage.getItem('zoneOriginalData');
                    const savedZones = savedData ? JSON.parse(savedData) : {};
                    if (!savedZones[zoneId]) saveZoneOriginalDuration(zoneId, currentStep.duration);
                    else updateZoneExecution(zoneId, remainingSeconds);
                } catch (e) { console.warn('Errore gestione dati originali:', e); }
                
                // Calcolo progresso ottimizzato
                progressPercentage = getCorrectProgressPercentage(zoneId, remainingSeconds);
                if (progressPercentage === 0) {
                    const totalSeconds = currentStep.duration * 60;
                    const elapsedSeconds = totalSeconds - remainingSeconds;
                    progressPercentage = Math.min(100, Math.max(0, (elapsedSeconds / totalSeconds) * 100));
                }
            }
        }
        
        // ==================== RENDERING OTTIMIZZATO DOM ====================
        const currentHTML = statusSection.innerHTML;
        const newHTML = `
            <p><strong>${t('programs.activeZoneLabel','Zona attiva:')}</strong> ${zoneName}</p>
            <p style="display: flex; justify-content: space-between;">
                <span>${t('programs.remainingTimeLabel','Tempo rimanente:')}</span>
                <strong class="program-timer">${formattedTime}</strong>
            </p>
            <div class="progress-bar-container">
                <div class="progress-bar zone-progress-bar" style="width: ${progressPercentage.toFixed(1)}%;"></div>
            </div>
        `;
        
        // Aggiorna DOM solo se il contenuto è effettivamente cambiato (ottimizzazione)
        if (currentHTML !== newHTML) {
            statusSection.innerHTML = newHTML;
        }
        
        // Chiama la funzione di aggiornamento timer specifica per programmi
        updateProgramTimerDisplay(state.current_program_id, state.active_zone);
        
    } else {
        const loadingHTML = `<p>${t('general.loading','Inizializzazione...')}</p>`;
        if (statusSection.innerHTML !== loadingHTML) {
            statusSection.innerHTML = loadingHTML;
        }
    }
}

function hideRunningStatus() {
    document.querySelectorAll('.running-status-section').forEach(section => section.remove());
}

function showProgramActiveOverlay(state) {
    // Funzione disabilitata - overlay rimosso per richiesta utente
    return;
}

function hideProgramActiveOverlay() {
    // Funzione disabilitata - overlay rimosso per richiesta utente
    return;
}

function buildMonthsGrid(activeMonths) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    // Se non ci sono mesi attivi, mostra un messaggio
    if (!activeMonths || activeMonths.length === 0) {
        return `<div class="month-tag inactive">${t('programs.noActiveMonths', 'Nessun mese attivo')}</div>`;
    }
    
    // Mostra SOLO i mesi attivi del programma
    return activeMonths.map(month => {
        const monthKey = month.toLowerCase();
        const displayMonth = t(`months.${monthKey}`, month.substring(0, 3));
        return `<div class="month-tag active">${displayMonth}</div>`;
    }).join('');
}

function buildZonesGrid(steps) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    if (!steps || steps.length === 0) return `<div class="zone-tag">${t('programs.noZonesInProgram','Nessuna zona configurata')}</div>`;
    return steps.map(step => {
        if (!step || step.zone_id === undefined) return '';
        const zoneName = window.ViewProgramsPage.zoneNameMap[step.zone_id] || `${t('manual.zone','Zona')} ${step.zone_id + 1}`;
        return `<div class="zone-tag">${zoneName}<span class="duration">${step.duration || 0} ${t('manual.minutesUnit','min')}</span></div>`;
    }).join('');
}

function formatRecurrence(recurrence, interval_days) {
    const utils = window.IrrigationUtils;
    if (utils?.formatRecurrence) return utils.formatRecurrence(recurrence, interval_days);
    
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const map = {
        'daily': t('programs.recurrence.daily', 'Ogni giorno'),
        'alternatingDays': t('programs.recurrence.alternatingDays', 'Giorni alterni'),
        'custom': t('programs.recurrence.custom', `Ogni ${interval_days || 1} giorn${interval_days === 1 ? 'o' : 'i'}`)
    };
    return map[recurrence] || recurrence || t('programs.recurrence.notSet', 'Non impostata');
}

// FUNZIONE MODIFICATA PER IL BANNER IMMEDIATO
async function startProgram(programId) {
    const startBtn = document.querySelector(`.program-card[data-program-id="${programId}"] .btn-start`);
    if (startBtn) { startBtn.classList.add('loading'); startBtn.disabled = true; }
    showToastMessage('toastMessages.programStarting', 'info');
    const controller = new AbortController();
    window.ViewProgramsPage.abortControllers.set(`start-${programId}`, controller);
    try {
        const response = await fetch('/start_program', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({program_id: programId}), signal: controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (startBtn) startBtn.classList.remove('loading');
        if (data.success) {
            showToastMessage('toastMessages.programStarted', 'success');
            
            // IMPORTANTE: Forza aggiornamento immediato del banner
            if (window.IrrigationStatus && typeof window.IrrigationStatus.forceImmediateUpdate === 'function') {
                console.log("Forzando aggiornamento immediato del banner");
                setTimeout(() => {
                    window.IrrigationStatus.forceImmediateUpdate();
                }, 100);
            }
            
            fetchProgramState();
            startCriticalProgramPolling();
        } else {
            showToastMessage(data.error || 'toastMessages.errorStartingProgram', 'error');
            if (startBtn) startBtn.disabled = false;
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Errore avvio programma:', error);
        if (startBtn) { startBtn.classList.remove('loading'); startBtn.disabled = false; }
        showToastMessage('toastMessages.networkError', 'error');
    } finally {
        window.ViewProgramsPage.abortControllers.delete(`start-${programId}`);
    }
}

async function toggleProgramAutomatic(programId, enable) {
    const toggle = document.getElementById(`auto-switch-${programId}`);
    if (toggle) toggle.disabled = true;
    const controller = new AbortController();
    window.ViewProgramsPage.abortControllers.set(`toggle-${programId}`, controller);
    try {
        const response = await fetch('/toggle_program_automatic', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({program_id: programId, enable: enable}), signal: controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (toggle) toggle.disabled = false;
        if (data.success) {
            showToastMessage(enable ? 'toastMessages.programAutoEnabled' : 'toastMessages.programAutoDisabled', 'success');
            if (window.ViewProgramsPage.programsData[programId]) window.ViewProgramsPage.programsData[programId].automatic_enabled = enable;
        } else {
            showToastMessage(data.error || 'toastMessages.errorToggleAuto', 'error');
            if (toggle) toggle.checked = !enable;
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Errore rete:', error);
        if (toggle) { toggle.disabled = false; toggle.checked = !enable; }
    } finally {
        window.ViewProgramsPage.abortControllers.delete(`toggle-${programId}`);
    }
}

function editProgram(programId) {
    localStorage.setItem('editProgramId', programId);
    const router = window.IrrigationRouter;
    if (router?.loadPage) router.loadPage('modify_program.html');
}

async function deleteProgram(programId) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    if (!confirm(t('programs.confirmDelete','Sei sicuro di voler eliminare questo programma?'))) return;
    const programCard = document.querySelector(`.program-card[data-program-id="${programId}"]`);
    showToastMessage('toastMessages.deletingProgram', 'info');
    if (programCard) {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.8);display:flex;justify-content:center;align-items:center;z-index:100;border-radius:inherit;`;
        overlay.innerHTML = `<div class="loading">${t('general.deleting','Eliminazione...')}</div>`;
        programCard.style.position = 'relative';
        programCard.appendChild(overlay);
    }
    const controller = new AbortController();
    window.ViewProgramsPage.abortControllers.set(`delete-${programId}`, controller);
    try {
        const response = await fetch('/delete_program', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: programId}), signal: controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.success) {
            showToastMessage('toastMessages.programDeleted', 'success');
            if (programCard) {
                programCard.style.transition = 'all 0.5s ease';
                programCard.style.opacity = '0';
                programCard.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    programCard.remove();
                    const container = document.getElementById('programs-container');
                    if (container && !container.querySelector('.program-card')) {
                        if (container.children.length <= 1) {
                             loadUserSettingsAndPrograms();
                        }
                    }
                }, 500);
            } else {
                loadUserSettingsAndPrograms();
            }
        } else {
            showToastMessage(data.error || 'toastMessages.errorDeletingProgram', 'error');
            programCard?.querySelector('.loading-overlay')?.remove();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error("Errore eliminazione:", error);
        programCard?.querySelector('.loading-overlay')?.remove();
    } finally {
        window.ViewProgramsPage.abortControllers.delete(`delete-${programId}`);
    }
}

function showToastMessage(messageKey, type, replacements = {}) {
    const ui = window.IrrigationUI;
    if (ui?.showToast) {
        ui.showToast(messageKey, type, 3500, replacements);
    }
}

// ==================== MONITORAGGIO PRESTAZIONI PROGRAMMI ====================

function getProgramPerformanceStats() {
    /**
     * Restituisce statistiche delle prestazioni per debugging.
     */
    const now = Date.now();
    const timeSinceLastSync = now - window.ViewProgramsPage.lastServerSync;
    const state = window.ViewProgramsPage.lastKnownState;
    
    return {
        programRunning: state?.program_running || false,
        currentProgramId: state?.current_program_id || null,
        activeZone: state?.active_zone || null,
        uiMode: window.ViewProgramsPage.uiUpdateMode,
        backgroundMode: window.ViewProgramsPage.backgroundMode,
        criticalPollActive: now < window.ViewProgramsPage.criticalPollEnd,
        lastSyncAge: Math.round(timeSinceLastSync / 1000),
        pollCount: window.ViewProgramsPage.pollCount,
        errorCount: window.ViewProgramsPage.errorCount,
        avgResponseTime: Math.round(window.ViewProgramsPage.avgResponseTime),
        intervals: {
            idle: window.ViewProgramsPage.POLL_INTERVAL_IDLE / 1000,
            active: window.ViewProgramsPage.POLL_INTERVAL_ACTIVE / 1000,
            critical: window.ViewProgramsPage.POLL_INTERVAL_CRITICAL / 1000,
            background: window.ViewProgramsPage.POLL_INTERVAL_BACKGROUND / 1000
        }
    };
}

function logProgramPerformanceReport() {
    /**
     * Stampa report dettagliato delle prestazioni nel console.
     */
    const stats = getProgramPerformanceStats();
    console.group("📊 Report Prestazioni Programmi ESP32S3");
    console.log(`🎯 Programma attivo: ${stats.programRunning ? `ID ${stats.currentProgramId}` : 'NO'}`);
    console.log(`🌿 Zona attiva: ${stats.activeZone ? `Zona ${stats.activeZone.id}` : 'NESSUNA'}`);
    console.log(`🎨 Modalità UI: ${stats.uiMode}`);
    console.log(`👁️ Background: ${stats.backgroundMode ? 'SÌ' : 'NO'}`);
    console.log(`⚡ Polling critico: ${stats.criticalPollActive ? 'SÌ' : 'NO'}`);
    console.log(`⏱️ Ultimo sync: ${stats.lastSyncAge}s fa`);
    console.log(`📈 Polling: ${stats.pollCount} richieste, ${stats.errorCount} errori`);
    console.log(`🚀 Tempo medio risposta: ${stats.avgResponseTime}ms`);
    console.log(`📡 Intervalli: Idle=${stats.intervals.idle}s, Attivo=${stats.intervals.active}s, Critico=${stats.intervals.critical}s, Background=${stats.intervals.background}s`);
    console.groupEnd();
}

function resetProgramPerformanceStats() {
    /**
     * Reset delle statistiche per nuova sessione.
     */
    window.ViewProgramsPage.pollCount = 0;
    window.ViewProgramsPage.errorCount = 0;
    window.ViewProgramsPage.lastError = null;
    window.ViewProgramsPage.avgResponseTime = 0;
    window.ViewProgramsPage.responseTimeHistory = [];
    console.log("📊 Statistiche prestazioni programmi resettate");
}

// ==================== ESPOSIZIONI GLOBALI ====================

// Funzioni principali (con protezione ridichiarazioni)
if (!window.initializeViewProgramsPage) window.initializeViewProgramsPage = initializeViewProgramsPage;
if (!window.fetchProgramState) window.fetchProgramState = fetchProgramState;
if (!window.startProgram) window.startProgram = startProgram;
if (!window.toggleProgramAutomatic) window.toggleProgramAutomatic = toggleProgramAutomatic;
if (!window.editProgram) window.editProgram = editProgram;
if (!window.deleteProgram) window.deleteProgram = deleteProgram;

// Funzioni di configurazione e monitoraggio (con protezione ridichiarazioni)
if (!window.setProgramUIMode) window.setProgramUIMode = setProgramUIMode;
if (!window.getProgramPerformanceStats) window.getProgramPerformanceStats = getProgramPerformanceStats;
if (!window.logProgramPerformanceReport) window.logProgramPerformanceReport = logProgramPerformanceReport;
if (!window.resetProgramPerformanceStats) window.resetProgramPerformanceStats = resetProgramPerformanceStats;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeViewProgramsPage);
} else {
    initializeViewProgramsPage();
}

} // Fine protezione caricamento multiplo modulo