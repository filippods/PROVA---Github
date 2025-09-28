// core.js - Versione con gestione overlay e banner centralizzata
console.log("Caricamento bundle core.js v3.0 - Overlay Centralizzato");

//  ==================== CONFIGURAZIONI GLOBALI ====================
// Namespace per evitare conflitti
window.IrrigationCore = window.IrrigationCore || {
    apiCache: new Map(),
    API_CACHE_TTL: 15000, // Aumentato a 15 secondi per meno richieste
    PROGRAM_STATUS_POLLING_INTERVAL: 5000, // 5 secondi per stato generale (ottimizzato)
    BANNER_UPDATE_INTERVAL: 5000, // 5 secondi per banner (allineato)
    IMMEDIATE_UPDATE_INTERVAL: 1000, // 1 secondo per aggiornamenti immediati (meno stress)
    activePollingTimers: new Set(),
    currentLanguage: 'it',
    translations: {},
    isTranslating: false,
    bannerUpdateTimer: null,
    bannerCountdownTimer: null,
    lastBannerState: null,
    programStartTime: null,
    currentZoneStartTime: null,
    zonesDurationMap: {},
    immediateUpdateActive: false, // Flag per aggiornamenti immediati
    immediateUpdateCount: 0, // Contatore per limitare aggiornamenti immediati
    overlayUpdateTimer: null, // Timer per aggiornamenti overlay
    currentProgramData: null // Cache per i dati del programma corrente
};

// ==================== UTILS.JS ====================
// Polyfill per crypto.randomUUID
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
    crypto.randomUUID = function() {
        if (typeof crypto.getRandomValues === 'function') {
            return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
            );
        } else {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    };
}

// Utility functions
const IrrigationUtils = {
    formatRecurrence(recurrence, interval_days) {
        const lang = window.IrrigationCore.currentLanguage || 'it';
        const t = IrrigationI18n.translate;

        if (!recurrence) return t('programs.frequencyNotSet', 'Non impostata');
        
        const recurrenceMap = {
            'daily': t('createProgram.recurrenceDaily', 'Ogni giorno'),
            'alternatingDays': t('createProgram.recurrenceAlternate', 'Giorni alterni'),
            'custom': t('createProgram.recurrenceCustom', 'Intervallo Personalizzato')
        };
        
        let baseText = recurrenceMap[recurrence] || recurrence;
        if (recurrence === 'custom' && interval_days) {
            baseText = t('createProgram.customIntervalLabelWithValue', `Ogni ${interval_days} giorn${interval_days === 1 ? 'o' : 'i'}`, { count: interval_days });
        }
        return baseText;
    },

    updateDateTime() {
        const dateElement = document.getElementById('date');
        const timeElement = document.getElementById('time');
        
        if (!dateElement || !timeElement) return;
        
        const now = new Date();
        const lang = window.IrrigationCore.currentLanguage || 'it';
        
        const bcp47Lang = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'it-IT';

        const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
        dateElement.textContent = now.toLocaleDateString(bcp47Lang, dateOptions);
        
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
        timeElement.textContent = now.toLocaleTimeString(bcp47Lang, timeOptions);
    },

    exists(path) {
        const parts = path.split('.');
        let current = window;
        
        for (const part of parts) {
            if (!current || typeof current[part] === 'undefined') {
                return false;
            }
            current = current[part];
        }
        
        return current !== undefined;
    },

    getFunction(path) {
        const parts = path.split('.');
        let current = window;
        
        for (const part of parts) {
            if (!current || typeof current[part] === 'undefined') {
                return null;
            }
            current = current[part];
        }
        
        return typeof current === 'function' ? current : null;
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

window.IrrigationUtils = IrrigationUtils;

// ==================== I18N.JS (Internationalization) ====================
const IrrigationI18n = {
    async setLanguage(lang) {
        if (!lang || typeof lang !== 'string' || lang.length !== 2) {
            console.warn(`Invalid language code: ${lang}. Defaulting to 'it'.`);
            lang = 'it';
        }
        window.IrrigationCore.currentLanguage = lang;
        document.documentElement.lang = lang;

        try {
            const response = await fetch(`/locales/${lang}.json?v=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Failed to load language file: ${lang}.json (Status: ${response.status})`);
            }
            window.IrrigationCore.translations = await response.json();
            console.log(`Language ${lang} loaded.`);
        } catch (error) {
            console.error(`Error loading language ${lang}:`, error);
            if (lang !== 'it') {
                console.warn("Falling back to Italian language.");
                return this.setLanguage('it');
            } else {
                window.IrrigationCore.translations = {};
            }
        }
        this.applyTranslations();
    },

    translate(key, fallbackText = '', replacements = {}) {
        let text = window.IrrigationCore.translations[key];
        if (text === undefined) {
            text = fallbackText || key;
        }

        for (const placeholder in replacements) {
            if (Object.hasOwnProperty.call(replacements, placeholder)) {
                const value = replacements[placeholder];
                text = text.replace(new RegExp(`{{${placeholder}}}`, 'g'), value);
            }
        }
        return text;
    },

    applyTranslations(container = document) {
        if (window.IrrigationCore.isTranslating) {
            return;
        }
        window.IrrigationCore.isTranslating = true;

        const elements = container.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.dataset.i18n;
            const fallback = el.textContent.trim() || el.getAttribute('placeholder') || el.getAttribute('title') || '';
            
            let replacements = {};
            if (el.dataset.i18nReplacements) {
                try {
                    replacements = JSON.parse(el.dataset.i18nReplacements);
                } catch (e) {
                    console.warn(`Invalid JSON in data-i18n-replacements for key ${key}:`, el.dataset.i18nReplacements, e);
                }
            }

            const translatedText = this.translate(key, fallback, replacements);

            if (el.hasAttribute('data-i18n-placeholder')) {
                el.placeholder = translatedText;
            } else if (el.hasAttribute('data-i18n-title')) {
                el.title = translatedText;
            } else if (el.tagName === 'INPUT' && el.type === 'submit' || el.tagName === 'BUTTON') {
                const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
                if (textNode) {
                    textNode.textContent = translatedText;
                } else if (el.querySelector('span')) {
                    const span = el.querySelector('span');
                    if(span && !span.querySelector('svg')) span.textContent = translatedText;
                } else {
                    el.textContent = translatedText;
                }
            }
            else {
                let textReplaced = false;
                for (let i = 0; i < el.childNodes.length; i++) {
                    const node = el.childNodes[i];
                    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
                        node.textContent = translatedText;
                        textReplaced = true;
                        break; 
                    }
                }
                if (!textReplaced) {
                    el.innerHTML = translatedText;
                }
            }
        });
        window.IrrigationCore.isTranslating = false;
    }
};
window.IrrigationI18n = IrrigationI18n;

// ==================== UI.JS ====================
const IrrigationUI = {
    showToast(messageKey, type = 'info', duration = 3000, replacements = {}) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const message = IrrigationI18n.translate(messageKey, messageKey, replacements);
        
        const existingToasts = container.querySelectorAll('.toast span');
        if (Array.from(existingToasts).some(span => span.textContent === message)) {
            return;
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            'success': '<path d="M9,20.42L2.79,14.21L4.21,12.79L9,17.58L19.79,6.79L21.21,8.21L9,20.42Z"/>',
            'error': '<path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>',
            'warning': '<path d="M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z"/>',
            'info': '<path d="M13,9H11V7H13M13,17H11V11H13M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2Z"/>'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    ${icons[type] || icons.info}
                </svg>
            </div>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        const timerId = setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => {
                if (container.contains(toast)) container.removeChild(toast);
            }, { once: true });
        }, duration);
        
        toast.addEventListener('click', () => {
            clearTimeout(timerId);
            toast.classList.remove('show');
            setTimeout(() => {
                if (container.contains(toast)) container.removeChild(toast);
            }, 300);
        });
    },

    addStyles(id, cssText) {
        if (document.getElementById(id)) return false;
        
        const style = document.createElement('style');
        style.id = id;
        style.textContent = cssText;
        document.head.appendChild(style);
        return true;
    }
};

window.IrrigationUI = IrrigationUI;

// ==================== API.JS ====================
const IrrigationAPI = {
    async apiCall(endpoint, method = 'GET', data = null, retryCount = 0, maxRetries = 2) {
        const cacheKey = method === 'GET' ? endpoint : null;
        
        if (cacheKey && window.IrrigationCore.apiCache.has(cacheKey)) {
            const cached = window.IrrigationCore.apiCache.get(cacheKey);
            if (Date.now() - cached.timestamp < window.IrrigationCore.API_CACHE_TTL) {
                return cached.data;
            }
        }
        
        const options = {
            method,
            headers: {}
        };
        
        if (data) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(endpoint, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            
            if (cacheKey) {
                window.IrrigationCore.apiCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now()
                });
            }
            
            return result;
        } catch (error) {
            console.error(`Errore API (${endpoint}):`, error);
            
            if (retryCount < maxRetries) {
                console.log(`Tentativo ${retryCount + 1}/${maxRetries} - ${endpoint}`);
                const delay = 500 * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.apiCall(endpoint, method, data, retryCount + 1, maxRetries);
            }
            
            throw error;
        }
    },

    invalidateCache(endpoint) {
        if (window.IrrigationCore.apiCache.has(endpoint)) {
            window.IrrigationCore.apiCache.delete(endpoint);
            console.log(`Cache invalidata per ${endpoint}`);
        }
    },

    async loadUserSettings() {
        try {
            return await this.apiCall('/data/user_settings.json');
        } catch (error) {
            console.error('Errore nel caricamento delle impostazioni utente:', error);
            IrrigationUI.showToast('toastMessages.errorLoadingSettings', 'error');
            return {};
        }
    },

    async loadPrograms() {
        try {
            return await this.apiCall('/data/program.json');
        } catch (error) {
            console.error('Errore nel caricamento dei programmi:', error);
            IrrigationUI.showToast('toastMessages.errorLoadingPrograms', 'error');
            return {};
        }
    },

    async getProgramState() {
        try {
            return await this.apiCall('/get_program_state');
        } catch (error) {
            console.error('Errore nel caricamento dello stato del programma:', error);
            return { program_running: false };
        }
    },

    async startProgram(programId) {
        try {
            const result = await this.apiCall('/start_program', 'POST', { program_id: programId });
            if (result.success) {
                IrrigationUI.showToast('toastMessages.programStarted', 'success');
                
                // Attiva aggiornamenti immediati per 30 secondi
                if (window.IrrigationStatus) {
                    window.IrrigationStatus.activateImmediateUpdates();
                }
            } else {
                IrrigationUI.showToast(result.error || 'toastMessages.errorStartingProgram', 'error');
            }
            return result;
        } catch (error) {
            console.error('Errore durante l\'avvio del programma:', error);
            IrrigationUI.showToast('toastMessages.networkError', 'error');
            return { success: false, error: 'Errore di rete' };
        }
    },

    async stopProgram() {
        IrrigationUI.showToast('toast.loading', 'info');
        
        const stopButtons = document.querySelectorAll('.banner-stop-btn, .global-stop-btn, .stop-program-button, .overlay-stop-button');
        stopButtons.forEach(btn => btn?.classList.add('loading'));
        
        try {
                        // ARRESTO TOTALE - Ferma programmi E tutte le zone
            const result = await this.apiCall('/emergency_stop_all', 'POST');
            
            stopButtons.forEach(btn => btn?.classList.remove('loading'));
            
            if (result.success) {
                                IrrigationUI.showToast('Arresto totale completato', 'success');
                                this.invalidateCache('/get_program_state');
                this.invalidateCache('/get_zones_status');
                
                // Forza aggiornamento immediato
                if (window.IrrigationStatus) {
                    window.IrrigationStatus.activateImmediateUpdates();
                }
                
                return result;
            } else {
                                IrrigationUI.showToast(result.error || 'Errore durante arresto totale', 'error');
                return result;
            }
        } catch (error) {
            stopButtons.forEach(btn => btn?.classList.remove('loading'));
                        console.error('Errore di rete durante arresto totale:', error);
            IrrigationUI.showToast('toastMessages.networkError', 'error');
            return { success: false, error: 'Errore di rete' };
        }
    }
};

window.IrrigationAPI = IrrigationAPI;

// ==================== ROUTER.JS ====================
const IrrigationRouter = {
    isLoadingPage: false,

    async loadPage(pageName, callback, isInitialLoad = false) {
        if (this.isLoadingPage) return;
        this.isLoadingPage = true;

        // Rimuovi tutti gli overlay locali quando si cambia pagina
        this.removeLocalOverlays();
        
        this.updateActiveMenuItem(pageName);
        window.IrrigationApp = window.IrrigationApp || {};
        window.IrrigationApp.currentPage = pageName;
        
        if (!isInitialLoad) {
            const pageBase = pageName.replace('.html', '');
            window.history.pushState(null, '', '#' + pageBase);
            
            try {
                localStorage.setItem('currentPage', pageName);
            } catch (e) {
                console.warn("Errore salvataggio pagina in localStorage:", e);
            }
        }
        
        const contentElement = document.getElementById('content');
        if (!contentElement) {
            this.isLoadingPage = false;
            return;
        }
        
        contentElement.innerHTML = `<div class="page-content-wrapper"><div class="loading-indicator"></div></div>`;
        
        try {
            const response = await fetch(`${pageName}?v=${Date.now()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const html = await response.text();
            contentElement.innerHTML = html;
            
            if (window.IrrigationCore) {
                window.IrrigationCore.activePollingTimers.forEach(timer => clearInterval(timer));
                window.IrrigationCore.activePollingTimers.clear();
            }
            
            await IrrigationI18n.applyTranslations(contentElement);
            
            await IrrigationRouter.loadPageModule(pageName);
            IrrigationRouter.initializePage(pageName);
            
            // Controlla lo stato del programma per il banner e overlay
            if (window.IrrigationStatus) {
                window.IrrigationStatus.checkProgramStatus();
            }
            
            if (callback) callback();
            
        } catch (error) {
            console.error('Errore nel caricamento della pagina:', error);
            contentElement.innerHTML = `
                <div class="page-content-wrapper">
                    <div style="text-align:center;padding:30px;">
                        <h2>${IrrigationI18n.translate('general.error', 'Errore')}</h2>
                        <p>Impossibile caricare la pagina ${pageName}</p>
                        <button onclick="window.location.reload()" class="button primary">
                            Ricarica pagina
                        </button>
                    </div>
                </div>
            `;
            IrrigationUI.showToast(`Errore nel caricamento di ${pageName}`, 'error');
        } finally {
            this.isLoadingPage = false;
        }
    },

    removeLocalOverlays() {
        // Rimuovi tutti gli overlay locali che possono essere stati creati dai singoli moduli
        const overlayIds = [
            'manual-page-overlay', 
            'program-active-overlay', 
            'settings-overlay',
            'factory-reset-overlay',
            'factory-reset-final-overlay',
            'restart-overlay',
            'firmware-update-confirm-overlay'
        ];
        
        overlayIds.forEach(id => {
            const element = document.getElementById(id);
            if (element && element !== document.getElementById('global-program-overlay')) {
                element.remove();
            }
        });

        // Rimuovi anche overlay con classi specifiche (ma non quello globale)
        document.querySelectorAll('.manual-page-overlay, .settings-overlay, .program-active-overlay').forEach(el => {
            if (el.id !== 'global-program-overlay') {
                el.remove();
            }
        });
    },

    async loadPageModule(pageName) {
        const moduleMap = {
            'manual.html': 'js/modules/manual.js',
            'create_program.html': 'js/modules/create_program.js',
            'modify_program.html': 'js/modules/modify_program.js',
            'view_programs.html': 'js/modules/view_programs.js',
            'settings.html': 'js/modules/settings.js'
        };
        
        const modulePath = moduleMap[pageName];
        if (!modulePath) return;
        
        try {
            const script = document.createElement('script');
            script.src = `${modulePath}?v=${Date.now()}`;
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (error) {
            console.error(`Errore caricamento modulo ${modulePath}:`, error);
        }
    },

    initializePage(pageName) {
        const initFunctions = {
            'manual.html': 'initializeManualPage',
            'create_program.html': 'initializeCreateProgramPage',
            'modify_program.html': 'initializeModifyProgramPage',
            'view_programs.html': 'initializeViewProgramsPage',
            'settings.html': 'initializeSettingsPage',
        };
        
        const fnName = initFunctions[pageName];
        if (fnName && typeof window[fnName] === 'function') {
            window[fnName](window.IrrigationApp?.userData);
        } else {
            console.warn(`Funzione di inizializzazione ${fnName} non trovata per ${pageName}`);
        }
    },

    updateActiveMenuItem(pageName) {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-page') === pageName);
        });
    },

    getCurrentPage() {
        return window.IrrigationApp?.currentPage;
    }
};

window.IrrigationRouter = IrrigationRouter;

// ==================== ZONES.JS ====================
const IrrigationZones = {
    generateZonesGrid(zones, containerId, onCheckboxChange = null) {
        const zonesGrid = document.getElementById(containerId);
        if (!zonesGrid) {
            console.error(`Elemento ${containerId} non trovato`);
            return;
        }
        
        zonesGrid.innerHTML = '';
        
        const visibleZones = zones?.filter(zone => zone?.status === 'show') || [];
        
        if (visibleZones.length === 0) {
            zonesGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align:center; padding:20px;">
                    <p data-i18n="settings.zones.noZonesConfigured">Nessuna zona disponibile.</p>
                    <button onclick="IrrigationRouter.loadPage('settings.html')" class="button secondary" data-i18n="manual.goToSettings">
                        Configura Zone
                    </button>
                </div>
            `;
            IrrigationI18n.applyTranslations(zonesGrid);
            return;
        }
        
        visibleZones.forEach(zone => {
            if (!zone || zone.id === undefined) return;
            
            const zoneItem = document.createElement('div');
            zoneItem.className = 'zone-item';
            zoneItem.dataset.zoneId = zone.id;
            
            zoneItem.innerHTML = `
                <div class="zone-header">
                    <input type="checkbox" class="zone-checkbox" id="zone-${zone.id}" data-zone-id="${zone.id}">
                    <label for="zone-${zone.id}" class="zone-name">${zone.name || IrrigationI18n.translate('manual.zone', 'Zona ') + (zone.id + 1)}</label>
                </div>
                <div class="zone-duration-control">
                    <label for="duration-${zone.id}" data-i18n="createProgram.durationLabel">Durata (minuti)</label>
                    <input type="number" class="zone-duration" id="duration-${zone.id}" 
                        min="1" max="180" placeholder="${IrrigationI18n.translate('createProgram.durationPlaceholder', 'Durata')}" 
                        data-zone-id="${zone.id}" disabled value="10">
                </div>
            `;
            
            zonesGrid.appendChild(zoneItem);
            
            const checkbox = zoneItem.querySelector('.zone-checkbox');
            const durationInput = zoneItem.querySelector('.zone-duration');
            
            checkbox.addEventListener('change', () => {
                durationInput.disabled = !checkbox.checked;
                zoneItem.classList.toggle('selected', checkbox.checked);
                
                if (checkbox.checked) durationInput.focus();
                
                if (onCheckboxChange) {
                    onCheckboxChange(parseInt(checkbox.dataset.zoneId), checkbox.checked, durationInput);
                }
            });
        });
        IrrigationI18n.applyTranslations(zonesGrid);
    },

    generateMonthsGrid(containerId, clickHandler = null) {
        const monthsGrid = document.getElementById(containerId);
        if (!monthsGrid) {
            console.error(`Elemento ${containerId} non trovato`);
            return;
        }
        
        monthsGrid.innerHTML = '';
        
        const months = [
            'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 
            'Maggio', 'Giugno', 'Luglio', 'Agosto', 
            'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
        ];
        
        months.forEach(month => {
            const monthItem = document.createElement('div');
            monthItem.className = 'month-item';
            monthItem.textContent = IrrigationI18n.translate(`months.${month.toLowerCase()}`, month.substring(0,3));
            monthItem.dataset.month = month;
            
            if (clickHandler) {
                monthItem.addEventListener('click', () => clickHandler(month, monthItem));
            } else {
                monthItem.addEventListener('click', () => {
                    monthItem.classList.toggle('selected');
                });
            }
            
            monthsGrid.appendChild(monthItem);
        });
    },

    async fetchZonesStatus() {
        try {
            return await IrrigationAPI.apiCall('/get_zones_status');
        } catch (error) {
            console.error('Errore nel recupero dello stato delle zone:', error);
            return [];
        }
    }
};

window.IrrigationZones = IrrigationZones;

// ==================== PROGRAM-COMMON.JS ====================
const IrrigationProgram = {
    validateProgramData(data, saveButton = null) {
        const resetButton = () => {
            if (saveButton) {
                saveButton.classList.remove('loading');
                saveButton.disabled = false;
            }
        };
        
        if (!data.name?.trim()) {
            IrrigationUI.showToast('toastMessages.fillRequiredFields', 'error');
            resetButton();
            return false;
        }
        
        if (!data.activation_time) {
            IrrigationUI.showToast('toastMessages.fillRequiredFields', 'error');
            resetButton();
            return false;
        }
        
        if (data.recurrence === 'custom') {
            if (!data.interval_days || data.interval_days < 1) {
                IrrigationUI.showToast('toastMessages.fillRequiredFields', 'error');
                resetButton();
                return false;
            }
        }
        
        if (!data.months?.length) {
            IrrigationUI.showToast('toastMessages.selectMonth', 'error');
            resetButton();
            return false;
        }
        
        if (!data.steps?.length) {
            IrrigationUI.showToast('toastMessages.selectZone', 'error');
            resetButton();
            return false;
        }
        
        for (const step of data.steps) {
            if (!step.duration || step.duration < 1) {
                const zoneDisplayName = IrrigationI18n.translate(`manual.zone`, `Zona`) + ` ${step.zone_id + 1}`;
                IrrigationUI.showToast('toastMessages.invalidDuration', 'error', { zoneName: zoneDisplayName });
                resetButton();
                return false;
            }
        }
        
        return true;
    },

    collectProgramData(programId = null) {
        const programName = document.getElementById('program-name')?.value.trim();
        const activationTime = document.getElementById('activation-time')?.value || 
                            document.getElementById('start-time')?.value;
        const recurrence = document.getElementById('recurrence')?.value;
        let intervalDays = null;
        
        if (recurrence === 'custom') {
            intervalDays = parseInt(document.getElementById('interval-days')?.value || 
                                 document.getElementById('custom-days-interval')?.value);
        }
        
        const selectedMonths = Array.from(document.querySelectorAll('.month-item.selected'))
            .map(item => item.dataset.month);
        
        const steps = [];
        document.querySelectorAll('.zone-checkbox:checked').forEach(checkbox => {
            const zoneId = parseInt(checkbox.dataset.zoneId);
            const durationInput = document.getElementById(`duration-${zoneId}`);
            const duration = parseInt(durationInput?.value || 10);
            
            steps.push({ zone_id: zoneId, duration: duration });
        });
        
        const program = {
            name: programName,
            activation_time: activationTime,
            recurrence: recurrence,
            months: selectedMonths,
            steps: steps
        };
        
        if (programId) program.id = programId;
        
        if (recurrence === 'custom' && !isNaN(intervalDays)) {
            program.interval_days = intervalDays;
        }
        
        return program;
    },

    async loadProgramData(programId) {
        try {
            const programs = await IrrigationAPI.loadPrograms();
            
            if (!programs || typeof programs !== 'object') {
                throw new Error('Formato programmi non valido');
            }
            
            const program = programs[programId];
            if (!program) throw new Error('Programma non trovato');
            
            return program;
        } catch (error) {
            console.error('Errore nel caricamento del programma:', error);
            IrrigationUI.showToast(error.message || 'toastMessages.programNotFound', 'error');
            return null;
        }
    },

    populateProgramForm(program) {
        if (!program) return false;
        
        document.getElementById('program-name')?.setAttribute('value', program.name || '');
        
        const timeInput = document.getElementById('activation-time') || document.getElementById('start-time');
        if (timeInput) timeInput.value = program.activation_time || '';
        
        const recurrenceSelect = document.getElementById('recurrence');
        if (recurrenceSelect) recurrenceSelect.value = program.recurrence || 'daily';

        if (program.recurrence === 'custom') {
            const daysContainer = document.getElementById('days-container') || document.getElementById('custom-days');
            if (daysContainer) {
                daysContainer.classList.add('visible');
            }
            
            const intervalInput = document.getElementById('interval-days') || document.getElementById('custom-days-interval');
            if (intervalInput) intervalInput.value = program.interval_days || 3;
        } else {
            const daysContainer = document.getElementById('days-container') || document.getElementById('custom-days');
            if (daysContainer) {
                 daysContainer.classList.remove('visible');
            }
        }
        
        if (program.months?.length) {
            document.querySelectorAll('.month-item').forEach(item => {
                item.classList.toggle('selected', program.months.includes(item.dataset.month));
            });
        }
        
        if (program.steps?.length) {
            program.steps.forEach(step => {
                if (!step || step.zone_id === undefined) return;
                
                const checkbox = document.getElementById(`zone-${step.zone_id}`);
                const durationInput = document.getElementById(`duration-${step.zone_id}`);
                
                if (checkbox && durationInput) {
                    checkbox.checked = true;
                    durationInput.disabled = false;
                    durationInput.value = step.duration || 10;
                    
                    const zoneItem = checkbox.closest('.zone-item');
                    if (zoneItem) zoneItem.classList.add('selected');
                }
            });
        }
        
        if (typeof window.toggleCustomDays === 'function') {
            window.toggleCustomDays();
        } else if (typeof window.toggleDaysSelection === 'function') {
            window.toggleDaysSelection();
        }

        return true;
    }
};

window.IrrigationProgram = IrrigationProgram;

// ==================== STATUS.JS - SISTEMA CENTRALIZZATO CON OVERLAY ====================
const IrrigationStatus = {
    programStatusInterval: null,
    bannerRealtimeInterval: null,
    lastProgramState: null,
    isInitialCheck: true, // NUOVO: Flag per il controllo iniziale
    lastServerUpdateTime: null,
    localTimerData: {
        currentRemaining: null,
        lastLocalUpdate: null,
        zoneId: null,
        totalDuration: null
    },
    syncTolerance: 4, // Aumentata tolleranza per ridurre risincronizzazioni
    immediateUpdateTimeout: null,

    // NUOVO: Sistema di aggiornamenti immediati
    activateImmediateUpdates() {
        console.log("🚀 Attivazione aggiornamenti immediati per 30 secondi");
        
        if (this.immediateUpdateTimeout) {
            clearTimeout(this.immediateUpdateTimeout);
        }
        
        window.IrrigationCore.immediateUpdateActive = true;
        window.IrrigationCore.immediateUpdateCount = 0;
        
        this.forceImmediateUpdate();
        this.startImmediatePolling();
        
        this.immediateUpdateTimeout = setTimeout(() => {
            this.deactivateImmediateUpdates();
        }, 30000);
    },

    startImmediatePolling() {
        this.stopProgramStatusPolling();
        
        this.programStatusInterval = setInterval(() => {
            this.checkProgramStatus();
            window.IrrigationCore.immediateUpdateCount++;
            
            if (window.IrrigationCore.immediateUpdateCount > 150) {
                this.deactivateImmediateUpdates();
            }
        }, window.IrrigationCore.IMMEDIATE_UPDATE_INTERVAL);
        
        if (window.IrrigationCore) {
            window.IrrigationCore.activePollingTimers.add(this.programStatusInterval);
        }
        
        console.log("📊 Polling immediato attivato (200ms)");
    },

    deactivateImmediateUpdates() {
        console.log("⏱️ Disattivazione aggiornamenti immediati");
        
        window.IrrigationCore.immediateUpdateActive = false;
        window.IrrigationCore.immediateUpdateCount = 0;
        
        if (this.immediateUpdateTimeout) {
            clearTimeout(this.immediateUpdateTimeout);
            this.immediateUpdateTimeout = null;
        }
        
        this.startProgramStatusPolling();
    },

    forceImmediateUpdate() {
        console.log("🔄 Aggiornamento immediato del banner e overlay richiesto");
        
        IrrigationAPI.invalidateCache('/get_program_state');
        this.checkProgramStatus();
        
        setTimeout(() => {
            this.checkProgramStatus();
        }, 500);
    },

    checkProgramStatus() {
        IrrigationAPI.getProgramState()
            .then(state => {
                const previousState = this.lastProgramState;
                const previousZoneId = previousState?.active_zone?.id;
                const newZoneId = state?.active_zone?.id;
                
                this.lastProgramState = state;
                this.lastServerUpdateTime = Date.now();
                
                const programJustStarted = !previousState?.program_running && state?.program_running;
                const programJustStopped = previousState?.program_running && !state?.program_running;
                const zoneChanged = previousZoneId !== newZoneId && state?.program_running;
                
                if (programJustStarted) {
                    console.log("✅ Nuovo programma avviato - mostro banner e overlay");
                    this.resetLocalTimer();
                    this.invalidateProgramDataCache(); // Invalida cache per caricare dati freschi
                    this.startBannerRealtimeUpdates();
                    this.startOverlayRealtimeUpdates();
                    this.showBannerImmediate(state);
                    this.showOverlayImmediate(state);
                }
                // NUOVO: Gestione ripristino iniziale dopo ricarica pagina
                else if (this.isInitialCheck && state?.program_running && state.current_program_id) {
                    console.log("🔄 Ripristino stato iniziale - programma già in esecuzione");
                    this.resetLocalTimer();
                    this.invalidateProgramDataCache();
                    this.startBannerRealtimeUpdates();
                    this.startOverlayRealtimeUpdates();
                    this.showBannerImmediate(state);
                    this.showOverlayImmediate(state);
                } 
                else if (zoneChanged) {
                    console.log("🔄 Cambio zona - reset timer locale");
                    this.resetLocalTimer();
                }
                else if (programJustStopped) {
                    console.log("⏹️ Programma fermato - nascondo banner e overlay");
                    this.stopBannerRealtimeUpdates();
                    this.stopOverlayRealtimeUpdates();
                    this.resetLocalTimer();
                    this.invalidateProgramDataCache(); // Pulisce i dati del programma
                    this.hideOverlay();
                }
                
                if (state?.program_running && state?.active_zone) {
                    this.syncLocalTimer(state.active_zone);
                }
                
                this.updateProgramStatusBanner(state);
                this.updateOverlay(state);
                this.notifyPagesOfStateChange(state);
                
                // Imposta il flag di controllo iniziale a false dopo il primo check
                if (this.isInitialCheck) {
                    this.isInitialCheck = false;
                }
                
                document.dispatchEvent(new CustomEvent('programStatusChanged', { detail: state }));
            })
            .catch(error => console.error('Errore nel controllo stato programma:', error));
    },

    // ==================== GESTIONE OVERLAY CENTRALIZZATA ====================
    
    showOverlayImmediate(state) {
        const overlay = document.getElementById('global-program-overlay');
        if (!overlay) return;
        
        console.log("📱 Mostrando overlay immediatamente");
        
        if (typeof window.showGlobalOverlay === 'function') {
            window.showGlobalOverlay();
        } else {
            overlay.classList.add('visible');
            document.body.classList.add('program-running');
        }
        
        this.loadProgramDataForOverlay(state.current_program_id);
        this.updateOverlayContent(state);
    },

    hideOverlay() {
        const overlay = document.getElementById('global-program-overlay');
        if (!overlay) return;
        
        console.log("📱 Nascondendo overlay");
        
        if (typeof window.hideGlobalOverlay === 'function') {
            window.hideGlobalOverlay();
        } else {
            overlay.classList.remove('visible');
            document.body.classList.remove('program-running');
            
            const stopButton = document.getElementById('overlay-stop-button');
            if (stopButton) {
                stopButton.classList.remove('loading');
            }
        }
        
        window.IrrigationCore.currentProgramData = null;
    },

    startOverlayRealtimeUpdates() {
        this.stopOverlayRealtimeUpdates();
        
        window.IrrigationCore.overlayUpdateTimer = setInterval(() => {
            this.updateOverlayRealtime();
        }, 5000); // Aggiornamento ogni 5 secondi per ridurre peso
        
        console.log("🔄 Aggiornamenti real-time overlay avviati (5s)");
    },

    stopOverlayRealtimeUpdates() {
        if (window.IrrigationCore.overlayUpdateTimer) {
            clearInterval(window.IrrigationCore.overlayUpdateTimer);
            window.IrrigationCore.overlayUpdateTimer = null;
            console.log("⏹️ Fermati aggiornamenti real-time overlay");
        }
    },

    updateOverlay(state) {
        const overlay = document.getElementById('global-program-overlay');
        if (!overlay) return;
        
        if (state?.program_running && state.current_program_id) {
            if (!overlay.classList.contains('visible')) {
                this.showOverlayImmediate(state);
            } else {
                this.updateOverlayContent(state);
            }
        } else {
            if (overlay.classList.contains('visible')) {
                this.hideOverlay();
            }
        }
    },

    updateOverlayContent(state) {
        if (typeof window.updateOverlayContent === 'function') {
            window.updateOverlayContent(state);
        } else {
            // Fallback se la funzione in main.html non è disponibile
            this.updateOverlayContentFallback(state);
        }
    },

    updateOverlayContentFallback(state) {
        const t = IrrigationI18n.translate;
        
        // Aggiorna nome programma
        const programNameEl = document.getElementById('overlay-program-name');
        if (programNameEl && state.current_program_id) {
            if (window.IrrigationCore.currentProgramData) {
                programNameEl.textContent = window.IrrigationCore.currentProgramData.name || t('programs.unnamedProgram', 'Programma');
            } else {
                programNameEl.textContent = t('overlay.loadingProgram', 'Caricamento...');
                this.loadProgramDataForOverlay(state.current_program_id);
            }
        }
        
        // Aggiorna informazioni zona attiva
        this.updateOverlayZoneInfo(state);
        
        // Aggiorna progresso complessivo
        this.updateOverlayProgress(state);
    },

    updateOverlayRealtime() {
        if (!this.lastProgramState?.program_running || !this.lastProgramState?.active_zone) {
            return;
        }
        
        // Ottimizzazione: aggiorna solo se ci sono dati timer locali validi
        if (this.localTimerData.zoneId !== this.lastProgramState.active_zone.id || 
            this.localTimerData.currentRemaining === null) {
            return;
        }
        
        const now = Date.now();
        const timeSinceLastLocal = (now - this.localTimerData.lastLocalUpdate) / 1000;
        
        // Evita aggiornamenti troppo frequenti (max ogni 4 secondi per coerenza con timer 5s)
        if (timeSinceLastLocal < 4) {
            return;
        }
        
        // Aggiorna timer locale
        this.localTimerData.currentRemaining = Math.max(0, this.localTimerData.currentRemaining - timeSinceLastLocal);
        this.localTimerData.lastLocalUpdate = now;
        
        const currentRemaining = Math.round(this.localTimerData.currentRemaining);
        
        // Verifica fine zona
        if (currentRemaining <= 0) {
            console.log("⏰ Tempo zona scaduto nell'overlay, richiedo aggiornamento stato");
            this.resetLocalTimer();
            setTimeout(() => {
                this.checkProgramStatus();
            }, 1000);
            return;
        }
        
        // Aggiorna overlay con dati ottimizzati
        if (typeof window.updateOverlayContent === 'function') {
            const updatedState = {
                ...this.lastProgramState,
                active_zone: {
                    ...this.lastProgramState.active_zone,
                    remaining_time: currentRemaining
                }
            };
            
            window.updateOverlayContent(updatedState);
        }
    },

    updateOverlayZoneInfo(state) {
        const zoneNameEl = document.getElementById('overlay-zone-name');
        const zoneTimerEl = document.getElementById('overlay-zone-timer');
        
        if (state.active_zone && zoneNameEl && zoneTimerEl) {
            const t = IrrigationI18n.translate;
            const zoneName = state.active_zone.name || t('manual.zone', 'Zona ') + (state.active_zone.id + 1);
            zoneNameEl.textContent = zoneName;
            
            const remainingSeconds = state.active_zone.remaining_time || 0;
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            zoneTimerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else if (zoneNameEl && zoneTimerEl) {
            const t = IrrigationI18n.translate;
            zoneNameEl.textContent = t('overlay.initializing', 'Inizializzazione...');
            zoneTimerEl.textContent = '--:--';
        }
    },

    updateOverlayZoneTimer(remainingSeconds) {
        const zoneTimerEl = document.getElementById('overlay-zone-timer');
        if (zoneTimerEl) {
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            zoneTimerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    },

    updateOverlayProgress(state) {
        const progressBarEl = document.getElementById('overlay-progress-bar');
        const progressTextEl = document.getElementById('overlay-progress-text');
        
        if (!progressBarEl || !progressTextEl || !state.active_zone) return;
        
        let progressPercentage = 0;
        
        if (state.active_zone.remaining_time !== undefined && state.active_zone.total_duration) {
            const elapsed = state.active_zone.total_duration - state.active_zone.remaining_time;
            progressPercentage = Math.min(100, Math.max(0, (elapsed / state.active_zone.total_duration) * 100));
        } else if (state.active_zone.remaining_time !== undefined && window.IrrigationCore.currentProgramData) {
            const program = window.IrrigationCore.currentProgramData;
            if (program?.steps) {
                const currentStep = program.steps.find(step => 
                    parseInt(step.zone_id) === parseInt(state.active_zone.id)
                );
                if (currentStep?.duration) {
                    const totalSeconds = currentStep.duration * 60;
                    const elapsed = totalSeconds - state.active_zone.remaining_time;
                    progressPercentage = Math.min(100, Math.max(0, (elapsed / totalSeconds) * 100));
                }
            }
        }
        
        progressBarEl.style.width = `${progressPercentage.toFixed(1)}%`;
        progressTextEl.textContent = `${Math.round(progressPercentage)}%`;
    },

    updateOverlayProgressBar(remainingSeconds) {
        const progressBarEl = document.getElementById('overlay-progress-bar');
        const progressTextEl = document.getElementById('overlay-progress-text');
        
        if (!progressBarEl || !progressTextEl) return;
        
        if (this.localTimerData.totalDuration > 0) {
            const elapsedSeconds = this.localTimerData.totalDuration - remainingSeconds;
            const progressPercentage = (elapsedSeconds / this.localTimerData.totalDuration) * 100;
            const clampedProgress = Math.max(0, Math.min(100, progressPercentage));
            
            progressBarEl.style.width = `${clampedProgress.toFixed(1)}%`;
            progressTextEl.textContent = `${Math.round(clampedProgress)}%`;
        }
    },

    async loadProgramDataForOverlay(programId) {
        try {
            // Verifica se abbiamo già i dati del programma corrente
            if (!window.IrrigationCore.currentProgramData || window.IrrigationCore.currentProgramData.id !== programId) {
                console.log("📥 Caricamento dati programma per overlay:", programId);
                
                const programs = await IrrigationAPI.loadPrograms();
                if (programs && programs[programId]) {
                    window.IrrigationCore.currentProgramData = programs[programId];
                    
                    // Salva anche nell'app globale per compatibilità
                    if (!window.IrrigationApp.programsData) {
                        window.IrrigationApp.programsData = {};
                    }
                    window.IrrigationApp.programsData[programId] = programs[programId];
                    
                    console.log("✅ Dati programma caricati:", window.IrrigationCore.currentProgramData.name || 'Senza nome');
                    
                    // Aggiorna immediatamente l'overlay se è visibile
                    const overlay = document.getElementById('global-program-overlay');
                    if (overlay?.classList.contains('visible') && this.lastProgramState) {
                        if (typeof window.updateOverlayContent === 'function') {
                            window.updateOverlayContent(this.lastProgramState);
                        }
                    }
                } else {
                    console.error("Programma non trovato:", programId);
                }
            }
        } catch (error) {
            console.error('Errore caricamento dati programma per overlay:', error);
        }
    },

    // Funzione per invalidare i dati del programma in cache
    invalidateProgramDataCache() {
        console.log("🗑️ Invalidazione cache dati programma");
        window.IrrigationCore.currentProgramData = null;
        IrrigationAPI.invalidateCache('/get_programs');
    },

    // Funzione di diagnostica per monitorare la qualità della sincronizzazione
    getSyncQuality() {
        if (!this.localTimerData.syncCount || !this.localTimerData.lastServerSync) {
            return "excellent";
        }
        
        const timeSinceLastSync = (Date.now() - this.localTimerData.lastServerSync) / 1000;
        const syncRate = this.localTimerData.syncCount / Math.max(1, timeSinceLastSync / 60); // sync per minuto
        
        if (syncRate < 0.5) return "excellent";
        if (syncRate < 1.5) return "good"; 
        if (syncRate < 3) return "fair";
        return "poor";
    },

    // ==================== GESTIONE BANNER (mantenuta) ====================
    
    showBannerImmediate(state) {
        // Banner disabilitato per richiesta utente
        return;
    },

    resetLocalTimer() {
        this.localTimerData = {
            currentRemaining: null,
            lastLocalUpdate: null,
            zoneId: null,
            totalDuration: null,
            lastServerSync: null,
            syncCount: 0
        };
        console.log("🔄 Timer locale resettato completamente");
    },

    syncLocalTimer(activeZone) {
        const serverRemaining = activeZone.remaining_time;
        const zoneId = activeZone.id;
        
        // Inizializzazione per nuova zona o primo avvio
        if (this.localTimerData.zoneId !== zoneId || this.localTimerData.currentRemaining === null) {
            console.log("🔄 Inizializzazione timer locale per zona:", zoneId);
            this.localTimerData = {
                currentRemaining: serverRemaining,
                lastLocalUpdate: Date.now(),
                zoneId: zoneId,
                totalDuration: this.calculateZoneTotalDuration(zoneId, activeZone),
                lastServerSync: Date.now(),
                syncCount: 0
            };
            return;
        }
        
        const now = Date.now();
        const timeSinceLastLocal = (now - this.localTimerData.lastLocalUpdate) / 1000;
        const timeSinceLastSync = (now - this.localTimerData.lastServerSync) / 1000;
        
        // Aggiorna il timer locale
        this.localTimerData.currentRemaining = Math.max(0, this.localTimerData.currentRemaining - timeSinceLastLocal);
        this.localTimerData.lastLocalUpdate = now;
        
        const difference = Math.abs(serverRemaining - this.localTimerData.currentRemaining);
        
        // Sincronizzazione intelligente basata su tolleranza dinamica
        let dynamicTolerance = this.syncTolerance;
        
        // Aumenta tolleranza per sincronizzazioni frequenti (evita ping-pong, adattato a 5s)
        if (timeSinceLastSync < 20 && this.localTimerData.syncCount > 2) {
            dynamicTolerance = Math.max(6, this.syncTolerance * 1.5);
        }
        
        if (difference > dynamicTolerance) {
            // Sincronizzazione graduale per piccole differenze, reset per grandi
            if (difference <= dynamicTolerance * 2) {
                // Correzione graduale (70% server, 30% locale)
                const correctedRemaining = (serverRemaining * 0.7) + (this.localTimerData.currentRemaining * 0.3);
                this.localTimerData.currentRemaining = Math.max(0, correctedRemaining);
                console.log(`⚡ Correzione graduale: differenza ${difference.toFixed(1)}s → ${Math.abs(serverRemaining - correctedRemaining).toFixed(1)}s`);
            } else {
                // Reset completo per grandi differenze
                this.localTimerData.currentRemaining = serverRemaining;
                console.log(`🔧 Reset timer: differenza eccessiva di ${difference.toFixed(1)} secondi`);
            }
            
            this.localTimerData.lastServerSync = now;
            this.localTimerData.syncCount = (this.localTimerData.syncCount || 0) + 1;
        } else {
            // Reset contatore sync se non ci sono problemi (adattato ai nuovi intervalli)
            if (timeSinceLastSync > 60) {
                this.localTimerData.syncCount = 0;
            }
            
            // Log qualità sincronizzazione ogni 120 secondi (solo se necessario, ridotto carico log)
            if (timeSinceLastSync > 120 && this.localTimerData.syncCount > 0) {
                const quality = this.getSyncQuality();
                if (quality === "fair" || quality === "poor") {
                    console.log(`📊 Qualità sincronizzazione: ${quality} (${this.localTimerData.syncCount} sync in ${Math.round(timeSinceLastSync)}s)`);
                }
                this.localTimerData.syncCount = 0;
                this.localTimerData.lastServerSync = now;
            }
        }
    },

    startBannerRealtimeUpdates() {
        // Banner disabilitato per richiesta utente
        return;
    },

    stopBannerRealtimeUpdates() {
        if (this.bannerRealtimeInterval) {
            clearInterval(this.bannerRealtimeInterval);
            if (window.IrrigationCore) {
                window.IrrigationCore.activePollingTimers.delete(this.bannerRealtimeInterval);
            }
            this.bannerRealtimeInterval = null;
            console.log("⏹️ Fermati aggiornamenti real-time del banner");
        }
    },

    updateBannerRealtime() {
        // Banner disabilitato per richiesta utente
        return;
    },

    updateBannerDisplay(remainingSeconds, zoneId, zoneName) {
        // Banner disabilitato per richiesta utente
        return;
    },

    calculateZoneTotalDuration(zoneId, activeZone = null) {
        if (activeZone && activeZone.total_duration_seconds) {
            return activeZone.total_duration_seconds;
        }
        
        if (window.IrrigationApp?.programsData && this.lastProgramState?.current_program_id) {
            const program = window.IrrigationApp.programsData[this.lastProgramState.current_program_id];
            if (program?.steps) {
                const step = program.steps.find(s => String(s.zone_id) === String(zoneId));
                if (step?.duration) {
                    return step.duration * 60;
                }
            }
        }
        
        return this.lastProgramState?.active_zone?.remaining_time || 600;
    },

    updateProgramStatusBanner(state) {
        // Banner disabilitato per richiesta utente
        return;
    },

    updateActiveZoneInfo(state) {
        // Banner disabilitato per richiesta utente
        return;
    },

    notifyPagesOfStateChange(state) {
        const pageName = IrrigationRouter.getCurrentPage();
        
        if (pageName === 'manual.html' && typeof window.handleProgramState === 'function') {
            window.handleProgramState(state);
        }

        if (pageName === 'view_programs.html' && typeof window.updateProgramsUI === 'function') {
            window.updateProgramsUI(state);
        }

        if (pageName === 'settings.html' && typeof window.handleProgramState === 'function') {
            window.handleProgramState(state);
        }
    },

    startProgramStatusPolling() {
        console.log("📡 Avvio polling stato programma (globale)");
        
        this.stopProgramStatusPolling();
        this.checkProgramStatus();
        
        const interval = window.IrrigationCore.immediateUpdateActive 
            ? window.IrrigationCore.IMMEDIATE_UPDATE_INTERVAL 
            : window.IrrigationCore.PROGRAM_STATUS_POLLING_INTERVAL;
        
        this.programStatusInterval = setInterval(() => {
            this.checkProgramStatus();
        }, interval);
        
        if (window.IrrigationCore) {
            window.IrrigationCore.activePollingTimers.add(this.programStatusInterval);
        }
    },

    stopProgramStatusPolling() {
        if (this.programStatusInterval) {
            clearInterval(this.programStatusInterval);
            if (window.IrrigationCore) {
                window.IrrigationCore.activePollingTimers.delete(this.programStatusInterval);
            }
            this.programStatusInterval = null;
        }
        
        this.stopBannerRealtimeUpdates();
        this.stopOverlayRealtimeUpdates();
    },

    getLastState() {
        return this.lastProgramState;
    }
};

// Bind delle funzioni per mantenere il contesto
IrrigationStatus.startProgramStatusPolling = IrrigationStatus.startProgramStatusPolling.bind(IrrigationStatus);
IrrigationStatus.stopProgramStatusPolling = IrrigationStatus.stopProgramStatusPolling.bind(IrrigationStatus);
IrrigationStatus.checkProgramStatus = IrrigationStatus.checkProgramStatus.bind(IrrigationStatus);
IrrigationStatus.forceImmediateUpdate = IrrigationStatus.forceImmediateUpdate.bind(IrrigationStatus);
IrrigationStatus.activateImmediateUpdates = IrrigationStatus.activateImmediateUpdates.bind(IrrigationStatus);

window.IrrigationStatus = IrrigationStatus;

// ==================== ESPORTAZIONE FINALE ====================
console.log("Bundle core.js v3.0 caricato con successo - Overlay e Banner Centralizzati!");