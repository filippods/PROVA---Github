// scripts.js - Script principale dell'applicazione
// Versione corretta con gestione errori migliorata e i18n

// ==================== VARIABILI GLOBALI ====================
// Usa namespace per evitare conflitti globali
window.IrrigationApp = window.IrrigationApp || {
    isLoadingPage: false,
    userData: {},
    programsData: {},
    currentPage: null,
    modulesLoaded: {},
    systemLogs: [],
    abortControllers: new Map(), // Per gestire richieste cancellabili
    _bottomNavClickHandler: null // Per event delegation del menu inferiore
};

// Mappa dei nomi di file ai percorsi dei moduli
const PAGE_CONFIG = {
    'manual.html': { module: 'js/modules/manual.js', initFn: 'initializeManualPage' },
    'create_program.html': { module: 'js/modules/create_program.js', initFn: 'initializeCreateProgramPage' },
    'modify_program.html': { module: 'js/modules/modify_program.js', initFn: 'initializeModifyProgramPage' },
    'view_programs.html': { module: 'js/modules/view_programs.js', initFn: 'initializeViewProgramsPage' },
    'settings.html': { module: 'js/modules/settings.js', initFn: 'initializeSettingsPage' }
};
const DEFAULT_PAGE = 'manual.html'; // Pagina di default
const DEFAULT_LANGUAGE = 'it'; // Lingua di default

// ==================== RILEVAMENTO PAGINA ====================
function detectCurrentPage() {
    const contentElement = document.getElementById('content');
    if (!contentElement) return window.IrrigationApp.currentPage || DEFAULT_PAGE;

    const pageContentWrapper = contentElement.querySelector('.page-content-wrapper');

    if (!pageContentWrapper || pageContentWrapper.childElementCount === 0 ||
        (pageContentWrapper.childElementCount === 1 &&
         pageContentWrapper.firstElementChild?.classList.contains('loading-indicator'))) {
        // If content is just a loading indicator, rely on the stored currentPage or default
        return window.IrrigationApp.currentPage || DEFAULT_PAGE;
    }

    // Check for specific container classes unique to each page
    if (pageContentWrapper.querySelector('.manual-page-container')) return 'manual.html';
    if (pageContentWrapper.querySelector('.settings-page-container')) return 'settings.html';
    if (pageContentWrapper.querySelector('.view-programs-container')) return 'view_programs.html';
    if (pageContentWrapper.querySelector('.create-program-container')) return 'create_program.html';
    if (pageContentWrapper.querySelector('.modify-program-container')) return 'modify_program.html';


    // Fallback if no specific container found, but content exists
    // This part might be less reliable if pages don't have unique top-level containers
    const pageIdentifiers = {
        '#zone-container': 'manual.html', // manual.html
        '#wifi-settings-card': 'settings.html', // settings.html
        '#programs-container': 'view_programs.html', // view_programs.html
        '#months-grid': 'create_program.html', // create_program.html
        '#months-list': 'modify_program.html' // modify_program.html
    };

    for (const [selector, page] of Object.entries(pageIdentifiers)) {
        if (pageContentWrapper.querySelector(selector)) return page;
    }
    
    console.warn("Tipo di pagina non identificato dal contenuto. Usando default:", window.IrrigationApp.currentPage || DEFAULT_PAGE);
    return window.IrrigationApp.currentPage || DEFAULT_PAGE;
}

// ==================== GESTIONE MODULI ====================
function loadModule(modulePath) {
    return new Promise((resolve, reject) => {
        if (!modulePath) {
            resolve();
            return;
        }

        if (window.IrrigationApp.modulesLoaded[modulePath]) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = `${modulePath}?v=${Date.now()}`;
        script.async = true;

        const timeout = setTimeout(() => {
            console.error(`Timeout caricamento modulo: ${modulePath}`);
            reject(new Error(`Timeout caricamento modulo: ${modulePath}`));
        }, 10000);

        script.onload = () => {
            clearTimeout(timeout);
            window.IrrigationApp.modulesLoaded[modulePath] = true;
            resolve();
        };

        script.onerror = (error) => {
            clearTimeout(timeout);
            console.error(`Errore script caricando ${modulePath}:`, error);
            reject(new Error(`Errore caricamento modulo ${modulePath}: ${error.message || error}`));
        };

        document.head.appendChild(script);
    });
}

async function loadCoreModules() {
    try {
        await loadModule('js/core.js'); // core.js ora include i18n
        return true;
    } catch (error) {
        console.error("Errore critico caricamento core.js:", error);
        showCriticalError("Errore critico di sistema. Ricaricare la pagina.");
        return false;
    }
}

function showCriticalError(message) {
    const errorBar = document.createElement('div');
    errorBar.id = "critical-error-bar";
    errorBar.textContent = message; 
    errorBar.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; padding: 10px;
        background: darkred; color: white; text-align: center;
        z-index: 10000; font-family: sans-serif;
    `;
    if (!document.getElementById("critical-error-bar")) {
        document.body.prepend(errorBar);
    }
}

async function loadPageSpecificModule(pageName) {
    const pageConf = PAGE_CONFIG[pageName];
    if (!pageConf || !pageConf.module) return true;

    try {
        await loadModule(pageConf.module);
        return true;
    } catch (error) {
        const ui = window.IrrigationUI;
        const i18n = window.IrrigationI18n;
        // Ensure 'toastMessages.errorLoadingModule' is in your JSON files
        const errorMessage = i18n ? i18n.translate('toastMessages.errorLoadingModule', 'Errore caricamento modulo per {{pageName}}.', { pageName }) : `Errore caricamento modulo per ${pageName}.`;

        if (ui?.showToast) ui.showToast(errorMessage, 'error');
        else console.error(errorMessage, error);
        return false;
    }
}

// ==================== INIZIALIZZAZIONE APPLICAZIONE ====================
async function initializeApp() {
    console.log("Avvio IrrigationPRO...");
    setupGlobalErrorHandling();

    let coreModulesLoaded = false;
    for (let i = 0; i < 3 && !coreModulesLoaded; i++) {
        coreModulesLoaded = await loadCoreModules();
        if (!coreModulesLoaded) {
            console.warn(`Tentativo ${i + 1}/3 di caricamento core modules...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!coreModulesLoaded) {
        console.error("ERRORE CRITICO: Impossibile caricare i moduli core.");
        const contentElement = document.getElementById('content');
        if (contentElement) {
            contentElement.innerHTML = `
                <div class="page-content-wrapper" style="text-align:center; padding:50px;">
                    <h2>Errore di Caricamento</h2>
                    <p>Impossibile caricare i moduli del sistema.</p>
                    <button onclick="window.location.reload()" class="button primary" style="margin-top:20px;">
                        Ricarica Pagina
                    </button>
                </div>`;
        }
        return;
    }

    const utils = window.IrrigationUtils;
    const router = window.IrrigationRouter;
    const statusModule = window.IrrigationStatus;
    const i18n = window.IrrigationI18n; 

    await loadUserDataAndPrograms();

    const preferredLanguage = window.IrrigationApp.userData?.language || 'it';
    if (i18n && typeof i18n.setLanguage === 'function') {
        await i18n.setLanguage(preferredLanguage); 
    } else {
        console.error("Modulo IrrigationI18n non disponibile o setLanguage non è una funzione.");
        document.documentElement.lang = 'it'; 
    }

    const updateDateTimeFn = utils?.updateDateTime || updateDateTime; 
    updateDateTimeFn();
    setInterval(updateDateTimeFn, 1000);

    document.dispatchEvent(new CustomEvent('initialDataLoaded'));

    await new Promise(resolve => setTimeout(resolve, 50)); 

    let pageToInitialize = getInitialPage();
    window.IrrigationApp.currentPage = pageToInitialize;
    console.log(`Pagina da inizializzare: ${pageToInitialize}`);

    if (router?.loadPage) {
        const currentDOMPageType = detectCurrentPage();
        const contentWrapper = document.getElementById('content')?.querySelector('.page-content-wrapper');

        if (!contentWrapper || currentDOMPageType !== pageToInitialize ||
            contentWrapper.childElementCount === 0 ||
            (contentWrapper.childElementCount === 1 && contentWrapper.firstElementChild.classList.contains('loading-indicator'))) {
            await router.loadPage(pageToInitialize, null, true); 
        } else {
            console.log(`Contenuto per ${pageToInitialize} già presente, inizializzo modulo.`);
            if (await loadPageSpecificModule(pageToInitialize)) {
                initializeCurrentPage(pageToInitialize);
            }
        }
    } else {
        console.error("IrrigationRouter non disponibile per il caricamento pagina.");
        if (pageToInitialize === DEFAULT_PAGE && document.getElementById('content')) {
             if (await loadPageSpecificModule(DEFAULT_PAGE)) {
                initializeCurrentPage(DEFAULT_PAGE);
            }
        } else if (document.getElementById('content')) {
            const detectedPage = detectCurrentPage(); 
            if (await loadPageSpecificModule(detectedPage)) {
                initializeCurrentPage(detectedPage);
            }
        }
    }

    try {
        const startPollingFn = statusModule?.startProgramStatusPolling || startProgramStatusPolling; 
        if (typeof startPollingFn === 'function') {
            startPollingFn();
            console.log("Polling stato programma avviato.");
        } else {
            console.warn("Funzione di polling stato non disponibile.");
        }
    } catch (error) {
        console.error("Errore avvio polling stato:", error);
    }

    setupNavigationListeners();
    console.log("IrrigationPRO Inizializzato.");
}

async function emergencyLoadPage(pageName) {
    console.warn("Caricamento di emergenza per:", pageName);
    const contentElement = document.getElementById('content');
    if (!contentElement) return;

    try {
        const response = await fetch(pageName);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        contentElement.innerHTML = await response.text();

        if (window.IrrigationI18n && typeof window.IrrigationI18n.applyTranslations === 'function') {
            await window.IrrigationI18n.applyTranslations(contentElement);
        }

        await loadPageSpecificModule(pageName);
        initializeCurrentPage(pageName);
    } catch (error) {
        console.error("Errore caricamento di emergenza:", error);
        const i18n = window.IrrigationI18n;
        // Ensure 'general.errorLoadingPage' and 'general.reload' are in JSON files
        const errorMsg = i18n ? i18n.translate('general.errorLoadingPage', 'Errore Caricamento Pagina') : 'Errore Caricamento Pagina';
        const reloadMsg = i18n ? i18n.translate('general.reload', 'Ricarica') : 'Ricarica';
        contentElement.innerHTML = `
            <div class="page-content-wrapper" style="text-align:center; padding:50px;">
                <h2>${errorMsg}</h2><p>Impossibile caricare ${pageName}</p>
                <button onclick="window.location.reload()" class="button primary">${reloadMsg}</button>
            </div>`;
    }
}

function getInitialPage() {
    const hashPage = window.location.hash.substring(1);
    if (hashPage && PAGE_CONFIG[hashPage + '.html']) return hashPage + '.html';
    try {
        const storedPage = localStorage.getItem('currentPage');
        if (storedPage && PAGE_CONFIG[storedPage]) return storedPage;
    } catch (e) { /* Ignora */ }
    return window.IrrigationApp.currentPage || DEFAULT_PAGE;
}

function initializeCurrentPage(pageName) {
    console.log(`Inizializzazione logica per pagina: ${pageName}`);
    cancelPendingRequests();

    const pageConf = PAGE_CONFIG[pageName];
    const ui = window.IrrigationUI;
    const i18n = window.IrrigationI18n;

    const updateMenuFn = window.IrrigationRouter?.updateActiveMenuItem || updateActiveMenuItem;
    updateMenuFn(pageName);

    if (pageConf?.initFn && typeof window[pageConf.initFn] === 'function') {
        try {
            window[pageConf.initFn](window.IrrigationApp.userData, window.IrrigationApp.programsData);
        } catch (e) {
            console.error(`Errore inizializzazione ${pageName}:`, e);
            const errorMsgKey = 'toastMessages.errorInitializingPage'; // Ensure this key is in JSON
            const fallbackErrorMsg = `Errore inizializzazione ${pageName}.`;
            const errorMessage = i18n ? i18n.translate(errorMsgKey, fallbackErrorMsg, { pageName }) : fallbackErrorMsg;
            if (ui?.showToast) ui.showToast(errorMessage, 'error');
        }
    } else {
        console.warn(`Funzione init ${pageConf?.initFn || 'N/A'} non trovata per ${pageName}`);
    }

    try {
        const checkStatusFn = window.IrrigationStatus?.checkProgramStatus || checkProgramStatus; 
        if (typeof checkStatusFn === 'function') checkStatusFn();
    } catch (error) {
        console.error("Errore controllo stato programma:", error);
    }
    document.dispatchEvent(new CustomEvent('pageInitialized', { detail: { pageName } }));
}

function setupNavigationListeners() {
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) return;

    if (window.IrrigationApp._bottomNavClickHandler) {
        bottomNav.removeEventListener('click', window.IrrigationApp._bottomNavClickHandler);
    }

    window.IrrigationApp._bottomNavClickHandler = function(event) {
        const navItem = event.target.closest('.bottom-nav-item[data-page]');
        if (navItem) {
            event.preventDefault();
            const targetPage = navItem.getAttribute('data-page');
            const router = window.IrrigationRouter;

            if (targetPage && router?.loadPage) {
                router.loadPage(targetPage);
            } else if (targetPage && typeof window.loadPage === 'function') { 
                window.loadPage(targetPage);
            }
        }
    };
    bottomNav.addEventListener('click', window.IrrigationApp._bottomNavClickHandler);

    document.removeEventListener('click', handleGlobalStopClick); 
    document.addEventListener('click', handleGlobalStopClick);
}

function handleGlobalStopClick(e) {
    const stopSelectors = [
        '.banner-stop-btn', '.global-stop-btn', '.stop-all-button',
        '.header-action-icon.stop-all-icon',
        '#dashboard-stop-all-btn', '.stop-program-button'
    ];

    if (stopSelectors.some(selector => e.target.closest(selector))) {
        e.preventDefault();
        e.stopPropagation();
        const api = window.IrrigationAPI;
        if (api && typeof api.stopProgram === 'function') {
            api.stopProgram();
        }
        else console.error("Funzione stop programma non trovata.");
    }
}

function setupGlobalErrorHandling() {
    window.removeEventListener('error', handleGlobalError); 
    window.addEventListener('error', handleGlobalError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection); 
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    document.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'IMG') e.preventDefault();
    });
}

function handleGlobalError(event) {
    console.error('Errore JS Globale:', {
        message: event.message, source: event.filename,
        lineno: event.lineno, colno: event.colno, error: event.error
    });
    if (event.message?.includes('Critical')) { 
        const toastFn = window.IrrigationUI?.showToast || showToast; 
        if (toastFn) toastFn('toastMessages.unexpectedError', 'error'); // Ensure key in JSON
    }
}

function handleUnhandledRejection(event) {
    console.error('Promise rejection non gestita:', event.reason);
}

async function loadUserDataAndPrograms() {
    const api = window.IrrigationAPI;
    const toastFn = window.IrrigationUI?.showToast || showToast; 
    try {
        const [settingsResponse, programsResponse] = await Promise.allSettled([
            api?.loadUserSettings ? api.loadUserSettings() : fetchWithAbort('/data/user_settings.json'),
            api?.loadPrograms ? api.loadPrograms() : fetchWithAbort('/data/program.json')
        ]);

        if (settingsResponse.status === 'fulfilled' && settingsResponse.value) {
            window.IrrigationApp.userData = settingsResponse.value;
        } else {
            window.IrrigationApp.userData = {}; 
            console.error('Errore caricamento dati utente:', settingsResponse.reason);
            if (toastFn) toastFn('toastMessages.errorLoadingSettings', 'error'); 
        }

        if (programsResponse.status === 'fulfilled' && programsResponse.value) {
            window.IrrigationApp.programsData = programsResponse.value;
        } else {
            window.IrrigationApp.programsData = {}; 
            console.error('Errore caricamento programmi:', programsResponse.reason);
            if (toastFn) toastFn('toastMessages.errorLoadingPrograms', 'error'); 
        }

        window.userData = window.IrrigationApp.userData;
        window.programsData = window.IrrigationApp.programsData;



    } catch (error) { 
        console.error('Errore imprevisto in loadUserDataAndPrograms:', error);
        if (toastFn) toastFn('toastMessages.criticalDataError', 'error'); // Ensure key in JSON
        window.IrrigationApp.userData = {};
        window.IrrigationApp.programsData = {};
    }
}

async function fetchWithAbort(url, options = {}) {
    const controller = new AbortController();
    const key = url + JSON.stringify(options); 

    if (window.IrrigationApp.abortControllers.has(key)) {
        window.IrrigationApp.abortControllers.get(key).abort();
    }
    window.IrrigationApp.abortControllers.set(key, controller);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        window.IrrigationApp.abortControllers.delete(key);
    }
}

function cancelPendingRequests() {
    window.IrrigationApp.abortControllers.forEach(controller => controller.abort());
    window.IrrigationApp.abortControllers.clear();
}

// Funzioni di fallback se core.js non le ha ancora inizializzate globalmente
function updateDateTime() {
    if (window.IrrigationUtils?.updateDateTime) window.IrrigationUtils.updateDateTime();
    else console.warn("updateDateTime: IrrigationUtils non disponibile.");
}

function updateActiveMenuItem(pageName) {
    if (window.IrrigationRouter?.updateActiveMenuItem) window.IrrigationRouter.updateActiveMenuItem(pageName);
    else { 
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-page') === pageName);
        });
    }
}

function showToast(messageKey, type = 'info', duration = 3500, replacements = {}) {
    const i18n = window.IrrigationI18n;
    const message = i18n ? i18n.translate(messageKey, messageKey, replacements) : messageKey;

    const container = document.getElementById('toast-container');
    if (!container) return;
    if (Array.from(container.querySelectorAll('.toast span')).some(span => span.textContent === message)) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconSvg = type === 'success' ? '✔️' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span class="toast-icon" style="margin-right:10px;">${iconSvg}</span><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    const timerId = setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => container.contains(toast) && container.removeChild(toast), { once: true });
    }, duration);
    toast.addEventListener('click', () => {
        clearTimeout(timerId);
        toast.classList.remove('show');
        setTimeout(() => container.contains(toast) && container.removeChild(toast), 300);
    }, { once: true });
}

function checkProgramStatus() {
    if (window.IrrigationStatus?.checkProgramStatus) window.IrrigationStatus.checkProgramStatus();
    else console.warn("checkProgramStatus: IrrigationStatus non disponibile.");
}

function startProgramStatusPolling() {
    if (window.IrrigationStatus?.startProgramStatusPolling) window.IrrigationStatus.startProgramStatusPolling();
    else console.warn("startProgramStatusPolling: IrrigationStatus non disponibile.");
}

async function stopProgram() {
    if (window.IrrigationAPI?.stopProgram) return window.IrrigationAPI.stopProgram();

    console.warn("Fallback stopProgram: IrrigationAPI non definito. Uso fetch diretto.");
    try {
        const response = await fetch('/stop_program', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const toastFn = window.IrrigationUI?.showToast || showToast;
        if (data.success) {
            if (toastFn) toastFn('toastMessages.programStopped', 'success'); 
            checkProgramStatus();
        } else {
            if (toastFn) toastFn(data.error || 'toastMessages.errorStoppingProgram', 'error'); 
        }
        return data;
    } catch (error) {
        console.error('Errore di rete in fallback stopProgram:', error);
        const toastFn = window.IrrigationUI?.showToast || showToast;
        if (toastFn) toastFn('toastMessages.networkError', 'error'); 
        return { success: false, error: error.message };
    }
}

window.loadPage = function(pageName, callback) {
    console.log("window.loadPage chiamato per:", pageName);
    const router = window.IrrigationRouter;
    if (router?.loadPage) router.loadPage(pageName, callback);
    else if (typeof window.emergencyLoadPage === 'function') { 
        window.emergencyLoadPage(pageName).then(() => callback && callback());
    } else { 
        console.error("loadPage: Nessun metodo disponibile per caricare:", pageName);
        const contentElement = document.getElementById('content');
        const i18n = window.IrrigationI18n;
        // Ensure 'general.loading', 'general.error', 'general.reload' are in JSON files
        const loadingMsg = i18n ? i18n.translate('general.loading', 'Caricamento...') : 'Caricamento...';
        const errorMsg = i18n ? i18n.translate('general.error', 'Errore') : 'Errore';
        const reloadMsg = i18n ? i18n.translate('general.reload', 'Ricarica') : 'Ricarica';

        if (contentElement) {
            contentElement.innerHTML = `<div class="page-content-wrapper"><div class="loading-indicator"></div></div>`;
            fetch(pageName).then(response => response.text()).then(html => {
                contentElement.innerHTML = html;
                if (window.IrrigationI18n && typeof window.IrrigationI18n.applyTranslations === 'function') {
                     window.IrrigationI18n.applyTranslations(contentElement);
                }
                if (callback) callback();
            }).catch(error => {
                contentElement.innerHTML = `<div class="page-content-wrapper" style="text-align:center; padding:50px;"><h2>${errorMsg}</h2><p>Impossibile caricare ${pageName}</p><button onclick="window.location.reload()" class="button primary">${reloadMsg}</button></div>`;
            });
        }
    }
};

window.emergencyLoadPage = emergencyLoadPage;
window.showToast = showToast; 
window.updateDateTime = updateDateTime; 
window.checkProgramStatus = checkProgramStatus; 
window.startProgramStatusPolling = startProgramStatusPolling; 
window.stopProgram = stopProgram; 
window.stopAllPrograms = window.stopProgram; 

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}