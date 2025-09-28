// manual.js - Versione senza overlay/banner locali per programmi in esecuzione
// Protezione contro caricamento multiplo del modulo
if (window.ManualPageModuleLoaded) {
    console.warn("Modulo manual.js già caricato, evito ridichiarazioni");
} else {
    window.ManualPageModuleLoaded = true;

// Namespace per evitare conflitti globali
window.ManualPage = window.ManualPage || {
    userSettings: {},
    maxZoneDuration: 180,
    maxActiveZones: 3,
    zoneStatusInterval: null,
    activeZones: new Map(),
    // Configurazione polling intelligente per ESP32S3
    POLL_INTERVAL_IDLE: 5000,     // 10 secondi quando nessuna zona attiva
    POLL_INTERVAL_ACTIVE: 2000,    // 3 secondi quando zone attive
    POLL_INTERVAL_CRITICAL: 1000,  // 1 secondo nei primi 30 secondi dopo attivazione
    localUpdateInterval: null,      // Timer locale per UI fluida
    abortControllers: new Map(),
    localTimerData: new Map(),      // Timer locali per ogni zona
    syncTolerance: 2,               // Tolleranza sincronizzazione ridotta
    lastServerSync: 0,              // Timestamp ultimo sync server
    uiUpdateMode: 'seconds',        // 'seconds' o 'minutes' - configurabile
    criticalPollEnd: 0,             // Fine del polling critico
    lastZoneStates: new Map(),      // Cache stati precedenti per ottimizzazione
    isPollingActive: false          // Flag per evitare polling sovrapposti
};

// ==================== CONFIGURAZIONE UI ADATTIVA ====================

function setUIUpdateMode(mode) {
    /**
     * Configura la modalità di aggiornamento UI per ottimizzare le prestazioni.
     * @param {string} mode - 'seconds' per aggiornamenti precisi, 'minutes' per risparmiare risorse
     */
    const validModes = ['seconds', 'minutes'];
    if (!validModes.includes(mode)) {
        console.warn(`Modalità UI non valida: ${mode}. Usando 'seconds'.`);
        mode = 'seconds';
    }
    
    const oldMode = window.ManualPage.uiUpdateMode;
    window.ManualPage.uiUpdateMode = mode;
    
    console.log(`🎨 Modalità UI aggiornata: ${oldMode} → ${mode}`);
    
    // Aggiorna immediatamente tutti i display visibili
    window.ManualPage.localTimerData.forEach((timer, zoneId) => {
        if (timer.isActive) {
            updateZoneDisplay(zoneId, Math.round(timer.remainingTime), timer.getProgress());
        }
    });
    
    // Salva preferenza in localStorage se disponibile
    try {
        localStorage.setItem('irrigation_ui_mode', mode);
    } catch (e) {
        // Ignore se localStorage non disponibile
    }
}

function detectOptimalUIMode() {
    /**
     * Rileva automaticamente la modalità UI ottimale basandosi sulle prestazioni del dispositivo.
     */
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad/.test(userAgent);
    const isLowEndDevice = /android.*4\.|android.*5\.0/.test(userAgent);
    
    // Cerca preferenza salvata
    try {
        const savedMode = localStorage.getItem('irrigation_ui_mode');
        if (savedMode && ['seconds', 'minutes'].includes(savedMode)) {
            return savedMode;
        }
    } catch (e) {
        // Ignore
    }
    
    // Auto-detect basato su device
    if (isLowEndDevice) {
        console.log("🔍 Rilevato dispositivo con prestazioni limitate, usando modalità 'minutes'");
        return 'minutes';
    } else if (isMobile) {
        console.log("🔍 Rilevato dispositivo mobile, usando modalità 'seconds' ottimizzata");
        return 'seconds';
    } else {
        console.log("🔍 Rilevato dispositivo desktop, usando modalità 'seconds' completa");
        return 'seconds';
    }
}

function optimizeForESP32S3() {
    /**
     * Applica ottimizzazioni specifiche per ESP32S3 per bilanciare prestazioni e accuratezza.
     */
    // Riduce la tolleranza di sincronizzazione per maggiore precisione
    window.ManualPage.syncTolerance = 1;
    
    // Ottimizza intervalli per ESP32S3 (buone prestazioni ma conservativo su network)
    window.ManualPage.POLL_INTERVAL_IDLE = 8000;      // 8 secondi quando idle
    window.ManualPage.POLL_INTERVAL_ACTIVE = 2500;    // 2.5 secondi con zone attive
    window.ManualPage.POLL_INTERVAL_CRITICAL = 800;   // 800ms periodo critico
    
    console.log("⚡ Ottimizzazioni ESP32S3 applicate - polling intelligente attivo");
}

// Timer locale per aggiornamenti fluidi
// Protezione contro ridichiarazioni multiple
if (!window.LocalZoneTimer) {
    window.LocalZoneTimer = class LocalZoneTimer {
    constructor(zoneId, totalDuration) {
        this.zoneId = zoneId;
        this.totalDuration = totalDuration;
        this.remainingTime = totalDuration;
        this.startDuration = totalDuration; // Durata iniziale impostata
        this.lastUpdate = Date.now();
        this.isActive = true;
    }
    
    update() {
        if (!this.isActive) return this.remainingTime;
        
        const now = Date.now();
        const elapsed = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;
        this.remainingTime = Math.max(0, this.remainingTime - elapsed);
        
        if (this.remainingTime <= 0) {
            this.isActive = false;
        }
        
        return Math.round(this.remainingTime);
    }
    
    syncWithServer(serverRemaining) {
        const difference = Math.abs(this.remainingTime - serverRemaining);
        
        // Solo sincronizza se la differenza è significativa
        if (difference > window.ManualPage.syncTolerance) {
            console.log(`Zona ${this.zoneId}: sincronizzazione (diff: ${difference}s)`);
            this.remainingTime = serverRemaining;
            this.lastUpdate = Date.now();
        }
    }
    
    getProgress() {
        const elapsed = this.startDuration - this.remainingTime;
        return (elapsed / this.startDuration) * 100;
    }
    };
}

function initializeManualPage(userData) {
    console.log("🚀 Inizializzazione pagina controllo manuale - ESP32S3 Ottimizzata");
    
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    cleanupManualPage();
    
    // Applica ottimizzazioni specifiche per ESP32S3
    optimizeForESP32S3();
    
    // Rileva e imposta modalità UI ottimale
    const optimalMode = detectOptimalUIMode();
    setUIUpdateMode(optimalMode);
    
    window.ManualPage.activeZones.clear();
    window.ManualPage.localTimerData.clear();
    window.ManualPage.lastZoneStates.clear();
    
    if (userData && Object.keys(userData).length > 0) {
        setupUserData(userData);
    } else {
        loadUserSettings();
    }
    
    addManualStyles();
    startStatusPolling();
    startLocalTimerUpdates();
    
    window.addEventListener('pagehide', cleanupManualPage, { once: true });
    
    if (window.IrrigationI18n) window.IrrigationI18n.applyTranslations(document.getElementById('content'));
}

function loadUserSettings() {
    const api = window.IrrigationAPI;
    const promise = api?.loadUserSettings 
        ? api.loadUserSettings()
        : fetch('/data/user_settings.json').then(response => response.json());
        
    promise
        .then(setupUserData)
        .catch(error => {
            console.error('Errore nel caricamento delle impostazioni utente:', error);
            showToastMessage('toastMessages.errorLoadingSettings', 'error');
        });
}

function setupUserData(data) {
    window.ManualPage.userSettings = data;
    window.ManualPage.maxActiveZones = data.max_active_zones || 3;
    window.ManualPage.maxZoneDuration = data.max_zone_duration || 180;
    renderZones(data.zones || []);
}

function addManualStyles() {
    const ui = window.IrrigationUI;
    if (ui && ui.addStyles) {
        ui.addStyles('manual-styles', `
            .zone-card {
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
                min-height: 520px; /* Altezza fissa per evitare ridimensionamenti */
            }
            
            .zone-card.active {
                background: #F0FDF4;
                border-color: var(--color-success);
            }
            
            /* Miglioramento indicatore di caricamento */
            .zone-card.loading {
                position: relative;
            }
            
            .zone-card.loading::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.9);
                z-index: 10;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(2px);
                border-radius: inherit;
            }
            
            .zone-card.loading::after {
                content: "";
                position: absolute;
                top: 50%;
                left: 50%;
                width: 40px;
                height: 40px;
                margin-left: -20px;
                margin-top: -20px;
                border: 4px solid rgba(99, 102, 241, 0.2);
                border-top: 4px solid var(--color-primary);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                z-index: 11;
            }
            
            /* Animazione per lo spinner */
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* Stile per i pulsanti durante il caricamento */
            .activation-button.loading {
                pointer-events: none;
                position: relative;
                color: transparent;
            }
            
            .activation-button.loading::before {
                content: "";
                position: absolute;
                top: 50%;
                left: 50%;
                width: 20px;
                height: 20px;
                margin-left: -10px;
                margin-top: -10px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top: 2px solid white;
                border-radius: 50%;
                animation: spin 0.6s linear infinite;
            }
        `);
    }
}

function startLocalTimerUpdates() {
    stopLocalTimerUpdates();
    
    window.ManualPage.localUpdateInterval = setInterval(() => {
        updateLocalTimers();
    }, 1000); // Ogni secondo
}

function stopLocalTimerUpdates() {
    if (window.ManualPage.localUpdateInterval) {
        clearInterval(window.ManualPage.localUpdateInterval);
        window.ManualPage.localUpdateInterval = null;
    }
}

function updateLocalTimers() {
    const now = Date.now();
    const timeSinceLastSync = now - window.ManualPage.lastServerSync;
    
    // Se è troppo tempo dall'ultimo sync server, riduci precisione locale
    const maxSyncGap = 15000; // 15 secondi
    const syncGapFactor = Math.min(timeSinceLastSync / maxSyncGap, 1);
    
    window.ManualPage.localTimerData.forEach((timer, zoneId) => {
        if (timer.isActive) {
            const remaining = timer.update();
            
            // Aggiorna UI con frequenza adattiva
            const shouldUpdateUI = window.ManualPage.uiUpdateMode === 'seconds' || 
                                 remaining % 30 === 0 || // Ogni 30 secondi in modalità minuti
                                 remaining <= 60;        // Sempre negli ultimi 60 secondi
            
            if (shouldUpdateUI) {
                updateZoneDisplay(zoneId, remaining, timer.getProgress());
            }
            
            if (remaining <= 0) {
                handleZoneComplete(zoneId);
            }
        }
    });
    
    // Log periodico dello stato per debug
    if (now % 30000 < 1000) { // Ogni 30 secondi circa
        console.log(`🔄 Timer locali: ${window.ManualPage.localTimerData.size} attivi, sync gap: ${Math.round(timeSinceLastSync/1000)}s`);
    }
}

function updateZoneDisplay(zoneId, remainingSeconds, progressPercentage) {
    const timerDisplay = document.getElementById(`timer-${zoneId}`);
    const progressCircle = document.getElementById(`progress-${zoneId}`);
    
    if (timerDisplay) {
        let displayText;
        
        if (window.ManualPage.uiUpdateMode === 'minutes') {
            // Modalità solo minuti - aggiornamento meno frequente
            const totalMinutes = Math.ceil(remainingSeconds / 60);
            displayText = `${totalMinutes}min`;
        } else {
            // Modalità MM:SS completa - aggiornamento secondo per secondo
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            displayText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Aggiorna solo se diverso (ottimizzazione DOM)
        if (timerDisplay.textContent !== displayText) {
            timerDisplay.textContent = displayText;
        }
    }
    
    if (progressCircle) {
        const radius = 80;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference * (1 - progressPercentage / 100);
        
        // Aggiorna solo se significativamente diverso (riduce re-painting)
        const currentOffset = parseFloat(progressCircle.style.strokeDashoffset) || circumference;
        if (Math.abs(currentOffset - offset) > 1) {
            progressCircle.style.strokeDashoffset = offset;
        }
    }
}

function handleZoneComplete(zoneId) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const zoneCard = document.getElementById(`zone-${zoneId}`);
    const activateBtn = zoneCard?.querySelector('.activation-button');
    
    window.ManualPage.localTimerData.delete(zoneId);
    
    if (zoneCard) zoneCard.classList.remove('active');
    if (activateBtn) {
        activateBtn.classList.add('activate');
        activateBtn.classList.remove('deactivate');
        activateBtn.querySelector('span').textContent = t('manual.startButton', 'AVVIA IRRIGAZIONE');
        activateBtn.disabled = false;
    }
    
    resetProgressBar(zoneId);
    
    // Richiedi aggiornamento stato dal server
    setTimeout(() => fetchZonesStatus(), 500);
}

function startStatusPolling() {
    stopStatusPolling();
    fetchZonesStatus();
    scheduleNextPoll();
}

function scheduleNextPoll() {
    const now = Date.now();
    let interval;
    
    // Determina intervallo basato sul contesto
    if (now < window.ManualPage.criticalPollEnd) {
        // Polling critico nei primi 30 secondi dopo attivazione
        interval = window.ManualPage.POLL_INTERVAL_CRITICAL;
    } else if (window.ManualPage.localTimerData.size > 0) {
        // Zone attive - polling più frequente
        interval = window.ManualPage.POLL_INTERVAL_ACTIVE;
    } else {
        // Nessuna zona attiva - polling rilassato
        interval = window.ManualPage.POLL_INTERVAL_IDLE;
    }
    
    window.ManualPage.zoneStatusInterval = setTimeout(() => {
        fetchZonesStatus();
        scheduleNextPoll(); // Riprogramma basandosi sul nuovo stato
    }, interval);
    
    console.log(`📊 Prossimo polling in ${interval/1000}s (zone attive: ${window.ManualPage.localTimerData.size})`);
}

function startAcceleratedPolling() {
    console.log("🚀 Avvio polling critico per 30 secondi");
    
    // Imposta periodo critico per 30 secondi
    window.ManualPage.criticalPollEnd = Date.now() + 30000;
    
    // Forza polling immediato e riavvia scheduling intelligente
    stopStatusPolling();
    fetchZonesStatus();
    scheduleNextPoll();
}

function stopStatusPolling() {
    if (window.ManualPage.zoneStatusInterval) {
        clearTimeout(window.ManualPage.zoneStatusInterval);
        clearInterval(window.ManualPage.zoneStatusInterval); // Backward compatibility
        window.ManualPage.zoneStatusInterval = null;
    }
}

function cleanupManualPage() {
    console.log("Cleanup pagina manuale");
    stopStatusPolling();
    stopLocalTimerUpdates();
    window.ManualPage.abortControllers.forEach(controller => controller.abort());
    window.ManualPage.abortControllers.clear();
    window.ManualPage.localTimerData.clear();
    window.removeEventListener('pagehide', cleanupManualPage);
}

function renderZones(zones) {
    const container = document.getElementById('zone-container');
    if (!container) return;
    
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const visibleZones = Array.isArray(zones) ? zones.filter(zone => zone && zone.status === "show") : [];
    
    if (visibleZones.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12,20A6,6 0 0,1 6,14C6,10 12,3.25 12,3.25C12,3.25 18,10 18,14A6,6 0 0,1 12,20Z"/>
                    </svg>
                </div>
                <h3 data-i18n="manual.noZonesConfigured">${t('manual.noZonesConfigured', 'Nessuna zona configurata')}</h3>
                <p data-i18n="manual.noZonesConfiguredHelp">${t('manual.noZonesConfiguredHelp', 'Configura le zone nelle impostazioni per poterle controllare manualmente.')}</p>
                <button class="button primary" onclick="IrrigationRouter.loadPage('settings.html')">
                    <span data-i18n="manual.goToSettings">${t('manual.goToSettings', 'Vai alle impostazioni')}</span>
                </button>
            </div>
        `;
        if (window.IrrigationI18n) window.IrrigationI18n.applyTranslations(container);
        return;
    }
    
    container.innerHTML = '';
    visibleZones.forEach(zone => {
        if (!zone || zone.id === undefined) return;
        const zoneCard = createZoneCard(zone);
        container.appendChild(zoneCard);
    });
    
    addZoneEventListeners();
    if (window.IrrigationI18n) window.IrrigationI18n.applyTranslations(container);
}

function createZoneCard(zone) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const zoneCard = document.createElement('div');
    zoneCard.className = 'zone-card';
    zoneCard.id = `zone-${zone.id}`;
    zoneCard.dataset.zoneId = zone.id;
    const zoneDisplayName = zone.name || `${t('manual.zone', 'Zona')} ${zone.id + 1}`;
    zoneCard.dataset.zoneName = zoneDisplayName;
    
    zoneCard.innerHTML = `
        <div class="zone-header">
            <h3 class="zone-title">${zoneDisplayName}</h3>
            <span class="zone-id">${t('manual.zone', 'Zona')} ${zone.id + 1}</span>
        </div>
        
        <div class="duration-control">
            <span class="duration-label" data-i18n="manual.durationLabel">${t('manual.durationLabel', 'DURATA IRRIGAZIONE')}</span>
            <div class="duration-input-group">
                <div class="duration-stepper">
                    <button class="stepper-btn" data-action="decrease">−</button>
                    <input type="number" 
                           class="duration-input" 
                           id="duration-value-${zone.id}"
                           min="1" 
                           max="${window.ManualPage.maxZoneDuration}"
                           step="1"
                           value="5">
                    <span class="duration-unit" data-i18n="manual.minutesUnit">${t('manual.minutesUnit', 'min')}</span>
                    <button class="stepper-btn" data-action="increase">+</button>
                </div>
            </div>
        </div>
        
        <div class="progress-container">
            <svg class="progress-ring" viewBox="0 0 180 180" width="180" height="180">
                <defs>
                    <linearGradient id="progressGradient${zone.id}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#10B981;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle class="progress-ring-bg" cx="90" cy="90" r="80" fill="none" stroke="#E5E7EB" stroke-width="8"></circle>
                <circle class="progress-ring-fill" id="progress-${zone.id}" cx="90" cy="90" r="80" fill="none" stroke="url(#progressGradient${zone.id})" stroke-width="8" stroke-linecap="round" stroke-dasharray="502.655" stroke-dashoffset="502.655" transform="rotate(-90 90 90)"></circle>
            </svg>
            <div class="progress-text">
                <span class="progress-time" id="timer-${zone.id}">00:00</span>
                <span class="progress-label" data-i18n="manual.remainingLabel">${t('manual.remainingLabel', 'RIMANENTI')}</span>
            </div>
        </div>
        
        <button class="activation-button activate" data-zone-id="${zone.id}">
            <svg class="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
            </svg>
            <span data-i18n="manual.startButton">${t('manual.startButton', 'AVVIA IRRIGAZIONE')}</span>
        </button>
    `;
    
    return zoneCard;
}

function roundToNearestStep(value, step = 5) {
    return Math.round(value / step) * step;
}

function addZoneEventListeners() {
    document.querySelectorAll('.stepper-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const zoneCard = this.closest('.zone-card');
            const zoneId = zoneCard.dataset.zoneId;
            const action = this.dataset.action;
            const durationInput = document.getElementById(`duration-value-${zoneId}`);
            if (!durationInput) return;
            
            let currentValue = parseInt(durationInput.value) || 5;
            
            if (action === 'increase') {
                // Arrotonda al multiplo di 5 superiore più vicino
                let rounded = roundToNearestStep(currentValue, 5);
                if (rounded <= currentValue) {
                    rounded += 5;
                }
                currentValue = Math.min(rounded, window.ManualPage.maxZoneDuration);
            } else if (action === 'decrease') {
                // Arrotonda al multiplo di 5 inferiore più vicino
                let rounded = roundToNearestStep(currentValue, 5);
                if (rounded >= currentValue) {
                    rounded -= 5;
                }
                currentValue = Math.max(rounded, 1);
                // Se il valore è inferiore a 5, imposta a 1
                if (currentValue < 5) {
                    currentValue = 1;
                }
            }
            
            durationInput.value = currentValue;
        });
    });
    
    document.querySelectorAll('.duration-input').forEach(input => {
        input.addEventListener('change', function() {
            let value = parseInt(this.value) || 5;
            value = Math.max(1, Math.min(value, window.ManualPage.maxZoneDuration));
            this.value = value;
        });
    });
    
    document.querySelectorAll('.activation-button').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const zoneId = parseInt(this.dataset.zoneId);
            const isActive = this.classList.contains('deactivate');
            if (isActive) {
                deactivateZone(zoneId);
            } else {
                const durationInput = document.getElementById(`duration-value-${zoneId}`);
                const duration = parseInt(durationInput?.value) || 5;
                if (duration >= 1 && duration <= window.ManualPage.maxZoneDuration) {
                    activateZone(zoneId, duration);
                } else {
                    showToastMessage('toastMessages.invalidZoneDurationRange', 'warning', { maxDuration: window.ManualPage.maxZoneDuration });
                }
            }
        });
    });
}

async function activateZone(zoneId, duration) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const zoneCard = document.getElementById(`zone-${zoneId}`);
    const activateBtn = zoneCard?.querySelector('.activation-button');
    const zoneName = zoneCard?.dataset.zoneName || `${t('manual.zone','Zona')} ${zoneId + 1}`;
    
    // Applicare stile di caricamento
    if (zoneCard) zoneCard.classList.add('loading');
    if (activateBtn) {
        activateBtn.classList.add('loading');
        activateBtn.disabled = true;
    }
    
    const controller = new AbortController();
    window.ManualPage.abortControllers.set(`activate-${zoneId}`, controller);
    
    try {
        const response = await fetch('/start_zone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zone_id: zoneId, duration: duration }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        // Rimuovere stile di caricamento
        if (zoneCard) zoneCard.classList.remove('loading');
        if (activateBtn) activateBtn.classList.remove('loading');
        
        if (data.success) {
            showToastMessage('toast.success', 'success');
            
            // Crea timer locale con durata iniziale memorizzata
            const timer = new window.LocalZoneTimer(zoneId, duration * 60);
            window.ManualPage.localTimerData.set(zoneId, timer);
            
            if (zoneCard) zoneCard.classList.add('active');
            if (activateBtn) {
                activateBtn.disabled = false;
                activateBtn.classList.remove('activate');
                activateBtn.classList.add('deactivate');
                activateBtn.querySelector('span').textContent = t('manual.stopButton', 'DISATTIVA ZONA');
            }
            
            startAcceleratedPolling();
        } else {
            showToastMessage(data.error || 'toastMessages.errorActivatingZone', 'error');
            if (activateBtn) activateBtn.disabled = false;
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Errore durante l\'attivazione della zona:', error);
            showToastMessage('toastMessages.networkError', 'error');
        }
        // Rimuovere stile di caricamento in caso di errore
        if (zoneCard) zoneCard.classList.remove('loading');
        if (activateBtn) {
            activateBtn.classList.remove('loading');
            activateBtn.disabled = false;
        }
    } finally {
        window.ManualPage.abortControllers.delete(`activate-${zoneId}`);
    }
}

async function deactivateZone(zoneId) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    const zoneCard = document.getElementById(`zone-${zoneId}`);
    const activateBtn = zoneCard?.querySelector('.activation-button');
    const zoneName = zoneCard?.dataset.zoneName || `${t('manual.zone','Zona')} ${zoneId + 1}`;
    
    // Applicare stile di caricamento
    if (zoneCard) zoneCard.classList.add('loading');
    if (activateBtn) {
        activateBtn.classList.add('loading');
        activateBtn.disabled = true;
    }
    
    const controller = new AbortController();
    window.ManualPage.abortControllers.set(`deactivate-${zoneId}`, controller);
    
    try {
        const response = await fetch('/stop_zone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zone_id: zoneId }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        // Rimuovere stile di caricamento
        if (zoneCard) zoneCard.classList.remove('loading');
        if (activateBtn) activateBtn.classList.remove('loading');
        
        if (data.success) {
            showToastMessage('toast.info', 'info');
            
            // Rimuovi timer locale
            window.ManualPage.localTimerData.delete(zoneId);
            
            if (zoneCard) zoneCard.classList.remove('active');
            if (activateBtn) {
                activateBtn.disabled = false;
                activateBtn.classList.add('activate');
                activateBtn.classList.remove('deactivate');
                activateBtn.querySelector('span').textContent = t('manual.startButton', 'AVVIA IRRIGAZIONE');
            }
            resetProgressBar(zoneId);
            startAcceleratedPolling();
        } else {
            showToastMessage(data.error || 'toastMessages.errorDeactivatingZone', 'error');
            if (activateBtn) activateBtn.disabled = false;
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Errore durante la disattivazione della zona:', error);
            showToastMessage('toastMessages.networkError', 'error');
        }
        // Rimuovere stile di caricamento in caso di errore
        if (zoneCard) zoneCard.classList.remove('loading');
        if (activateBtn) {
            activateBtn.classList.remove('loading');
            activateBtn.disabled = false;
        }
    } finally {
        window.ManualPage.abortControllers.delete(`deactivate-${zoneId}`);
    }
}

function resetProgressBar(zoneId) {
    const timerDisplay = document.getElementById(`timer-${zoneId}`);
    const progressCircle = document.getElementById(`progress-${zoneId}`);
    if (timerDisplay) timerDisplay.textContent = '00:00';
    if (progressCircle) {
        const radius = 80;
        const circumference = 2 * Math.PI * radius;
        progressCircle.style.strokeDashoffset = circumference;
    }
}

async function fetchZonesStatus() {
    // Evita polling sovrapposti
    if (window.ManualPage.isPollingActive) {
        console.log("⏭️ Polling già in corso, saltato");
        return;
    }
    
    window.ManualPage.isPollingActive = true;
    
    try {
        const controller = new AbortController();
        window.ManualPage.abortControllers.set('zones-status', controller);
        
        const startTime = Date.now();
        const response = await fetch('/get_zones_status', { 
            signal: controller.signal,
            cache: 'no-cache' // Evita cache per dati real-time
        });
        
        if (!response.ok) throw new Error('Errore nel caricamento dello stato delle zone');
        const responseData = await response.json();
        
        const fetchTime = Date.now() - startTime;
        window.ManualPage.lastServerSync = Date.now();
        
        // Estrai dati zone
        const zonesStatus = responseData.zones || responseData;
        
        // Log prestazioni
        console.log(`📡 Sync server completato in ${fetchTime}ms - ${zonesStatus.length} zone`);
        
        updateZonesUI(zonesStatus);
        
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('❌ Errore nel recupero dello stato delle zone:', error);
            // In caso di errore, rallenta il polling per non sovraccaricare
            window.ManualPage.criticalPollEnd = 0;
        }
    } finally {
        window.ManualPage.abortControllers.delete('zones-status');
        window.ManualPage.isPollingActive = false;
    }
}

function updateZonesUI(zonesStatus) {
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    // DEBUG: Log dei dati ricevuti dal server
    console.log('DEBUG updateZonesUI: dati ricevuti:', zonesStatus);
    if (Array.isArray(zonesStatus)) {
        const activeZones = zonesStatus.filter(z => z && z.active);
        console.log(`DEBUG updateZonesUI: ${zonesStatus.length} zone totali, ${activeZones.length} attive`);
        activeZones.forEach(z => {
            console.log(`DEBUG Zona ${z.id} attiva: remaining=${z.remaining_time}s, total=${z.total_duration}s, manual=${z.manual}`);
        });
    }
    
    if (!Array.isArray(zonesStatus)) {
        console.warn('DEBUG updateZonesUI: zonesStatus non è un array:', typeof zonesStatus);
        return;
    }
    
    zonesStatus.forEach(zone => {
        if (!zone || zone.id === undefined) return;
        const zoneId = zone.id;
        const zoneCard = document.getElementById(`zone-${zoneId}`);
        const activateBtn = zoneCard?.querySelector('.activation-button');
        const activateBtnSpan = activateBtn?.querySelector('span');

        if (!zoneCard || !activateBtn || !activateBtnSpan) return;
        
        if (zone.active) {
            zoneCard.classList.add('active');
            activateBtn.classList.remove('activate');
            activateBtn.classList.add('deactivate');
            activateBtnSpan.textContent = t('manual.stopButton', 'DISATTIVA ZONA');
            
            // Sincronizza con timer locale o crea nuovo timer
            let timer = window.ManualPage.localTimerData.get(zoneId);
            if (!timer && zone.remaining_time > 0) {
                // Calcola durata originale corretta per evitare reset della progress bar
                let totalDuration;
                
                if (zone.total_duration) {
                    // Il server fornisce la durata totale
                    totalDuration = zone.total_duration;
                    console.log(`DEBUG Zona ${zoneId}: usando total_duration dal server: ${totalDuration}s`);
                } else {
                    // Stima la durata totale basandosi sul valore dell'input utente o pattern comuni
                    const durationInput = document.getElementById(`duration-value-${zoneId}`);
                    const inputDuration = durationInput ? parseInt(durationInput.value) * 60 : null;
                    
                    if (inputDuration && inputDuration >= zone.remaining_time) {
                        // Usa la durata dall'input se è ragionevole
                        totalDuration = inputDuration;
                        console.log(`DEBUG Zona ${zoneId}: usando durata da input: ${totalDuration}s`);
                    } else {
                        // Stima intelligente basata su step comuni (1, 5, 10, 15, 20, 30, 45, 60 minuti)
                        const remainingMinutes = Math.ceil(zone.remaining_time / 60);
                        const commonDurations = [1, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];
                        totalDuration = (commonDurations.find(d => d >= remainingMinutes) || remainingMinutes + 5) * 60;
                        console.log(`DEBUG Zona ${zoneId}: stima durata: remaining=${remainingMinutes}min -> total=${totalDuration}s`);
                    }
                }
                
                timer = new window.LocalZoneTimer(zoneId, totalDuration);
                timer.remainingTime = zone.remaining_time;
                timer.startDuration = totalDuration;
                timer.lastUpdate = Date.now();
                window.ManualPage.localTimerData.set(zoneId, timer);
                
                // Aggiorna immediatamente la visualizzazione con il progresso corretto
                updateZoneDisplay(zoneId, timer.remainingTime, timer.getProgress());
                console.log(`DEBUG Zona ${zoneId}: timer creato - remaining=${timer.remainingTime}s, progress=${timer.getProgress().toFixed(1)}%`);
            } else if (timer) {
                // Sincronizza timer esistente
                const oldRemaining = timer.remainingTime;
                timer.syncWithServer(zone.remaining_time);
                console.log(`DEBUG Zona ${zoneId}: timer sincronizzato - old=${oldRemaining}s, new=${timer.remainingTime}s`);
            }
        } else {
            zoneCard.classList.remove('active');
            activateBtn.classList.add('activate');
            activateBtn.classList.remove('deactivate');
            activateBtnSpan.textContent = t('manual.startButton', 'AVVIA IRRIGAZIONE');
            
            // Rimuovi timer locale se zona non attiva
            if (window.ManualPage.localTimerData.has(zoneId)) {
                console.log(`DEBUG Zona ${zoneId}: timer rimosso (zona non attiva)`);
                window.ManualPage.localTimerData.delete(zoneId);
            }
            resetProgressBar(zoneId);
        }
    });
}

function showToastMessage(messageKey, type, replacements = {}) {
    const ui = window.IrrigationUI;
    if (ui?.showToast) {
        ui.showToast(messageKey, type, 3500, replacements);
    } else if (typeof showToast === 'function') {
        const fallbackMessage = messageKey.includes('.') ? messageKey.split('.').pop() : messageKey;
        showToast(fallbackMessage, type);
    }
}

// ==================== MONITORAGGIO PRESTAZIONI ====================

function getPerformanceStats() {
    /**
     * Restituisce statistiche delle prestazioni per debugging e ottimizzazione.
     */
    const now = Date.now();
    const timeSinceLastSync = now - window.ManualPage.lastServerSync;
    
    return {
        activeZones: window.ManualPage.localTimerData.size,
        uiMode: window.ManualPage.uiUpdateMode,
        lastSyncAge: Math.round(timeSinceLastSync / 1000),
        pollingActive: window.ManualPage.isPollingActive,
        criticalPollActive: now < window.ManualPage.criticalPollEnd,
        syncTolerance: window.ManualPage.syncTolerance,
        intervals: {
            idle: window.ManualPage.POLL_INTERVAL_IDLE / 1000,
            active: window.ManualPage.POLL_INTERVAL_ACTIVE / 1000,
            critical: window.ManualPage.POLL_INTERVAL_CRITICAL / 1000
        }
    };
}

function logPerformanceReport() {
    /**
     * Stampa un report dettagliato delle prestazioni nel console.
     */
    const stats = getPerformanceStats();
    console.group("📊 Report Prestazioni IrrigationPRO");
    console.log(`🎯 Zone attive: ${stats.activeZones}`);
    console.log(`🎨 Modalità UI: ${stats.uiMode}`);
    console.log(`⏱️ Ultimo sync: ${stats.lastSyncAge}s fa`);
    console.log(`🔄 Polling: ${stats.pollingActive ? 'IN CORSO' : 'IDLE'}`);
    console.log(`⚡ Critico: ${stats.criticalPollActive ? 'SÌ' : 'NO'}`);
    console.log(`📡 Intervalli: Idle=${stats.intervals.idle}s, Attivo=${stats.intervals.active}s, Critico=${stats.intervals.critical}s`);
    console.groupEnd();
}

// Esposizione globale delle funzioni per compatibilità (con protezione ridichiarazioni)
if (!window.initializeManualPage) window.initializeManualPage = initializeManualPage;
if (!window.fetchZonesStatus) window.fetchZonesStatus = fetchZonesStatus;
if (!window.setUIUpdateMode) window.setUIUpdateMode = setUIUpdateMode;
if (!window.getPerformanceStats) window.getPerformanceStats = getPerformanceStats;
if (!window.logPerformanceReport) window.logPerformanceReport = logPerformanceReport;

// Auto-inizializzazione se DOM pronto e userData disponibili
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('zone-container')) {
            const userData = window.IrrigationApp?.userData || window.userData;
            initializeManualPage(userData);
        }
    });
} else {
    if (document.getElementById('zone-container')) {
        const userData = window.IrrigationApp?.userData || window.userData;
        initializeManualPage(userData);
    }
}

} // Fine protezione caricamento multiplo modulo