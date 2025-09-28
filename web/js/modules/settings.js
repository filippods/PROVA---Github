// settings.js - Versione senza overlay/banner locali per programmi in esecuzione
window.SettingsPage = window.SettingsPage || {
    isLoading: false,
    settingsStatusInterval: null,
    wifiNetworks: [],
    settingsModified: {
        language: false, // Added for language
        wifi: false,
        zones: false,
        advanced: false
    },
    abortControllers: new Map(),

};

function initializeSettingsPage(userData) {
    console.log("Inizializzazione pagina impostazioni");
    
    // Cleanup precedente
    cleanupSettingsPage();
    
    // Aggiungi stili necessari
    addSettingsStyles();
    
    if (userData && Object.keys(userData).length > 0) {
        loadSettingsWithData(userData);
    } else {
        // Carica le impostazioni dal server
        const controller = new AbortController();
        window.SettingsPage.abortControllers.set('settings', controller);
        
        const promise = window.IrrigationAPI?.loadUserSettings
            ? window.IrrigationAPI.loadUserSettings()
            : fetch('/data/user_settings.json', { signal: controller.signal })
                .then(response => response.json());
        
        promise
            .then(data => {
                console.log("Dati impostazioni caricati dal server:", data);
                loadSettingsWithData(data);
            })
            .catch(error => {
                if (error.name === 'AbortError') return;
                console.error('Errore nel caricamento delle impostazioni:', error);
                showToastMessage('toastMessages.errorLoadingSettings', 'error');
            })
            .finally(() => window.SettingsPage.abortControllers.delete('settings'));
    }
    
    startConnectionStatusPolling();

    // Inizializza la nuova interfaccia WiFi
    initializeCoexistenceWifiInterface();

    window.addEventListener('pagehide', cleanupSettingsPage, { once: true });
    addChangeListeners();

    // Initialize language selector event listener
    const langSelector = document.getElementById('language-selector');
    if (langSelector) {
        langSelector.addEventListener('change', () => {
            window.SettingsPage.settingsModified.language = true;
        });
    }

    // Apply translations to static parts of settings.html
    if (window.IrrigationI18n) {
        window.IrrigationI18n.applyTranslations(document.getElementById('content'));
    }
}

function addSettingsStyles() {
    const ui = window.IrrigationUI;
    if (ui && ui.addStyles) {
        ui.addStyles('settings-styles', `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `);
    }
}

function cleanupSettingsPage() {
    stopConnectionStatusPolling();

    // Pulisci l'intervallo WiFi overview
    if (window.SettingsPage.wifiOverviewInterval) {
        clearInterval(window.SettingsPage.wifiOverviewInterval);
        window.SettingsPage.wifiOverviewInterval = null;
    }

    window.SettingsPage.abortControllers.forEach(controller => controller.abort());
    window.SettingsPage.abortControllers.clear();

    window.SettingsPage.settingsModified = {
        language: false,
        wifi: false,
        zones: false,
        advanced: false
    };


    window.removeEventListener('pagehide', cleanupSettingsPage);
}

function loadSettingsWithData(data) {
    console.log("Caricamento impostazioni con dati:", data);
    window.userData = data || {}; // Ensure window.userData is updated
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    const langSelector = document.getElementById('language-selector');
    if (langSelector) {
        langSelector.value = data.language || 'it';
    }

    const clientEnabled = data.client_enabled || false;
    const clientEnabledInput = document.getElementById('client-enabled');
    if (clientEnabledInput) {
        clientEnabledInput.value = clientEnabled ? 'true' : 'false';
    }
    selectWifiMode(clientEnabled ? 'client' : 'ap');
    
    if (data.wifi) {
        const wifiSsid = data.wifi.ssid || '';
        const wifiListSelect = document.getElementById('wifi-list');
        if (wifiListSelect) {
            let found = Array.from(wifiListSelect.options).some(opt => opt.value === wifiSsid);
            if (!found && wifiSsid) { // Add if not present and not empty
                 const option = document.createElement('option');
                 option.value = wifiSsid;
                 option.textContent = wifiSsid; // Display SSID, signal strength if available later
                 wifiListSelect.appendChild(option);
            }
            wifiListSelect.value = wifiSsid; // Set selected
        }
        const wifiPasswordInput = document.getElementById('wifi-password');
        if (wifiPasswordInput) {
            wifiPasswordInput.value = data.wifi.password || '';
        }
    }
    
    if (data.ap) {
        const apSsidInput = document.getElementById('ap-ssid');
        if (apSsidInput) apSsidInput.value = data.ap.ssid || 'IrrigationSystem';
        const apPasswordInput = document.getElementById('ap-password');
        if (apPasswordInput) apPasswordInput.value = data.ap.password || '12345678';
    }
    
    renderZonesSettings(data.zones || []);
    
    const maxActiveZonesInput = document.getElementById('max-active-zones');
    if (maxActiveZonesInput) maxActiveZonesInput.value = data.max_active_zones || 3;
    const activationDelayInput = document.getElementById('activation-delay');
    if (activationDelayInput) activationDelayInput.value = data.activation_delay !== undefined ? data.activation_delay : 0; // Ensure 0 is default if undefined
    const maxZoneDurationInput = document.getElementById('max-zone-duration');
    if (maxZoneDurationInput) maxZoneDurationInput.value = data.max_zone_duration || 180;
window.SettingsPage.settingsModified = { language: false, wifi: false, zones: false, advanced: false };
    // Apply translations after populating data
    if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(document.getElementById('content'));
}

function addChangeListeners() {
    const langSelector = document.getElementById('language-selector');
    if (langSelector) {
        langSelector.addEventListener('change', () => window.SettingsPage.settingsModified.language = true);
    }

    ['client-enabled', 'wifi-list', 'wifi-password', 'ap-ssid', 'ap-password'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => window.SettingsPage.settingsModified.wifi = true);
            if (element.type === 'text' || element.type === 'password' || element.type === 'hidden') { // include hidden for client-enabled
                element.addEventListener('input', () => window.SettingsPage.settingsModified.wifi = true);
            }
        }
    });
    
    ['max-active-zones', 'activation-delay', 'max-zone-duration'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => window.SettingsPage.settingsModified.advanced = true);
            if (element.type === 'number') {
                element.addEventListener('input', () => window.SettingsPage.settingsModified.advanced = true);
            }
        }
    });


}

function renderZonesSettings(zones) {
    const zonesGrid = document.getElementById('zones-grid');
    if (!zonesGrid) return;
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    zonesGrid.innerHTML = ''; // Clear previous content, including any hardcoded loading message
    
    if (!zones || !Array.isArray(zones) || zones.length === 0) {
        zonesGrid.innerHTML = `<p style="text-align:center; grid-column: 1/-1;" data-i18n="settings.zones.noZonesConfigured">${t('settings.zones.noZonesConfigured','Nessuna zona configurata')}</p>`;
        if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(zonesGrid);
        return;
    }
    
    const defaultZones = Array.from({length: 8}, (_, i) => ({
        id: i,
        status: 'show',
        pin: 14 + i, // Default pin assignment
        name: `${t('manual.zone','Zona')} ${i + 1}`
    }));
    
    let combinedZones = defaultZones.map(defaultZone => {
        const userZone = zones.find(z => z.id === defaultZone.id);
        return userZone ? {...defaultZone, ...userZone} : defaultZone;
    });
    
    combinedZones.forEach(zone => {
        if (!zone || zone.id === undefined) return;
        
        const zoneCard = document.createElement('div');
        zoneCard.className = 'zone-card-setting';
        zoneCard.dataset.zoneId = zone.id;
        const zoneLabel = `${t('manual.zone','Zona')} ${zone.id + 1}`;
        
        zoneCard.innerHTML = `
            <h4>${zoneLabel}</h4>
            <div class="input-group">
                <label for="zone-name-${zone.id}" data-i18n="settings.zones.zoneNameLabel">${t('settings.zones.zoneNameLabel','Nome:')}</label>
                <input type="text" id="zone-name-${zone.id}" class="input-control zone-name-input" 
                       value="${zone.name || zoneLabel}" maxlength="16" 
                       placeholder="${t('settings.zones.zoneNamePlaceholder','Nome zona')}" data-zone-id="${zone.id}">
            </div>
            <div class="input-group">
                <div class="input-row" style="justify-content: space-between;">
                    <label for="zone-status-${zone.id}" data-i18n="settings.zones.zoneVisibleLabel">${t('settings.zones.zoneVisibleLabel','Visibile:')}</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="zone-status-${zone.id}" class="zone-status-toggle" 
                               ${zone.status === 'show' ? 'checked' : ''} data-zone-id="${zone.id}">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
        `;
        
        zonesGrid.appendChild(zoneCard);
        
        const nameInput = zoneCard.querySelector('.zone-name-input');
        const statusToggle = zoneCard.querySelector('.zone-status-toggle');
        
        if (nameInput) {
            nameInput.addEventListener('input', () => window.SettingsPage.settingsModified.zones = true);
        }
        if (statusToggle) {
            statusToggle.addEventListener('change', () => window.SettingsPage.settingsModified.zones = true);
        }
    });
    if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(zonesGrid);
}

function selectWifiMode(mode) {
    console.log("Selezione modalità WiFi:", mode);
    const clientDesc = document.getElementById('client-mode-desc');
    const apDesc = document.getElementById('ap-mode-desc');
    if (clientDesc && apDesc) {
        clientDesc.classList.toggle('active', mode === 'client');
        apDesc.classList.toggle('active', mode === 'ap');
    }
    const clientSettings = document.getElementById('wifi-client-settings');
    const apSettings = document.getElementById('wifi-ap-settings');
    if (clientSettings && apSettings) {
        clientSettings.style.display = (mode === 'client') ? 'block' : 'none';
        apSettings.style.display = (mode === 'ap') ? 'block' : 'none';
    }
    const clientEnabledInput = document.getElementById('client-enabled');
    if (clientEnabledInput) {
        clientEnabledInput.value = (mode === 'client') ? 'true' : 'false';
    }
    window.SettingsPage.settingsModified.wifi = true;
}

async function scanWifiNetworks() {
    const scanButton = document.getElementById('scan-wifi-button');
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);

    // Feedback immediato all'utente
    showToastMessage('toastMessages.wifiScanStarting', 'info');

    if (scanButton) {
        scanButton.classList.add('loading');
        scanButton.disabled = true;
        // Cambia il testo del pulsante per dare feedback
        const originalText = scanButton.textContent;
        scanButton.innerHTML = '<span>Scansione...</span>';
    }

    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('scan', controller);

    try {
        console.log("Avvio scansione WiFi...");

        const response = await (window.IrrigationAPI?.apiCall
            ? window.IrrigationAPI.apiCall('/scan_wifi')
            : fetch('/scan_wifi', { signal: controller.signal }).then(res => res.json()));

        console.log("Risposta scansione WiFi:", response);

        // Gestisci diversi formati di risposta
        let networks = [];
        if (response && response.networks) {
            networks = response.networks;
        } else if (Array.isArray(response)) {
            networks = response;
        }

        window.SettingsPage.wifiNetworks = networks;
        displayWifiNetworks(networks);

        // Feedback di successo
        if (networks.length > 0) {
            showToastMessage('toastMessages.wifiScanCompleted', 'success', 3500, { count: networks.length });

            // Mostra informazioni aggiuntive se disponibili
            if (response.coexistence_maintained !== undefined) {
                console.log(`Coesistenza WiFi mantenuta: ${response.coexistence_maintained}`);
            }
            if (response.message) {
                console.log(`Messaggio server: ${response.message}`);
            }
        } else {
            showToastMessage('toastMessages.wifiScanNoResults', 'warning');
        }

    } catch (error) {
        if (error.name === 'AbortError') return;

        console.error('Errore durante la scansione WiFi:', error);

        // Feedback di errore più dettagliato
        let errorMessage = 'Errore durante la scansione WiFi';
        if (error.message) {
            errorMessage += `: ${error.message}`;
        }

        showToastMessage(errorMessage, 'error');

        // Prova a caricare i risultati cached se disponibili
        try {
            const cachedResponse = await (window.IrrigationAPI?.apiCall
                ? window.IrrigationAPI.apiCall('/get_wifi_scan_results')
                : fetch('/get_wifi_scan_results').then(res => res.json()));

            if (cachedResponse && cachedResponse.networks && cachedResponse.networks.length > 0) {
                console.log("Caricamento risultati cached...");
                displayWifiNetworks(cachedResponse.networks);
                showToastMessage('toastMessages.wifiScanCachedResults', 'info');
            }
        } catch (cacheError) {
            console.warn("Impossibile caricare risultati cached:", cacheError);
        }

    } finally {
        window.SettingsPage.abortControllers.delete('scan');
        if (scanButton) {
            scanButton.classList.remove('loading');
            scanButton.disabled = false;
            // Ripristina il testo originale del pulsante
            scanButton.innerHTML = '<svg class="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9Z"/></svg><span data-i18n="settings.wifi.scanButton">Scansiona</span>';
        }
    }
}

function displayWifiNetworks(networks) {
    const wifiList = document.getElementById('wifi-list');
    const networksContainer = document.getElementById('wifi-networks-container');
    if (!wifiList || !networksContainer) return;
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);

    wifiList.innerHTML = ''; // Clear previous options

    console.log("Visualizzazione reti WiFi:", networks);

    if (!networks || !Array.isArray(networks) || networks.length === 0) {
        const emptyMessage = `${t('settings.wifi.noNetworksFound','Nessuna rete trovata')}`;
        wifiList.innerHTML = `<option value="">${emptyMessage}</option>`;
        networksContainer.style.display = 'none';
        console.log("Nessuna rete WiFi da visualizzare");
        return;
    }
    
    networks.forEach(network => {
        if (!network || !network.ssid) return;
        const option = document.createElement('option');
        option.value = network.ssid;
        option.textContent = `${network.ssid} (${network.signal || t('settings.wifi.unknownSignal','Segnale sconosciuto')})`;
        wifiList.appendChild(option);
    });
    
    networksContainer.innerHTML = networks
        .filter(network => network && network.ssid)
        .map(network => `
            <div class="wifi-network">
                <span class="wifi-name">${network.ssid}</span>
                <span class="wifi-signal">${network.signal || t('settings.wifi.unknownSignal','Segnale sconosciuto')}</span>
            </div>
        `).join('');
    
    document.querySelectorAll('.wifi-network').forEach(el => {
        el.addEventListener('click', () => {
            const ssid = el.querySelector('.wifi-name').textContent;
            wifiList.value = ssid;
            document.querySelectorAll('.wifi-network').forEach(n => n.classList.remove('selected'));
            el.classList.add('selected');
            const wifiPassword = document.getElementById('wifi-password');
            if (wifiPassword) wifiPassword.focus();
            window.SettingsPage.settingsModified.wifi = true;
        });
    });
    networksContainer.style.display = 'block';
}

async function saveLanguageSetting() {
    if (!window.SettingsPage.settingsModified.language) {
        showToastMessage('toastMessages.noChangesToSave', 'info');
        return;
    }
    const saveButton = document.getElementById('save-language-button');
    if (saveButton) {
        saveButton.classList.add('loading');
        saveButton.disabled = true;
    }
    try {
        const selectedLanguage = document.getElementById('language-selector')?.value;
        if (!selectedLanguage) {
            showToastMessage('toastMessages.selectValidLanguage', 'error'); // Ensure this key is in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        await saveSettings({ language: selectedLanguage });
        window.SettingsPage.settingsModified.language = false;
        showToastMessage('toastMessages.languageSaved', 'success');
        // Reload page to apply new language after a short delay
        setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
        console.error('Errore salvataggio lingua:', error);
        showToastMessage('toastMessages.errorSavingLanguage', 'error'); // Ensure this key is in JSON
    } finally {
        if (saveButton) {
            saveButton.classList.remove('loading');
            saveButton.disabled = false;
        }
    }
}

async function saveWifiSettings() {
    if (!window.SettingsPage.settingsModified.wifi) {
        showToastMessage('toastMessages.noChangesToSave', 'info');
        return;
    }
    const saveButton = document.getElementById('save-wifi-button');
    if (saveButton) {
        saveButton.classList.add('loading');
        saveButton.disabled = true;
    }
    try {
        const clientEnabledInput = document.getElementById('client-enabled');
        const isClientMode = clientEnabledInput?.value === 'true';
        const wifiSsid = document.getElementById('wifi-list')?.value || '';
        const wifiPassword = document.getElementById('wifi-password')?.value || '';
        const apSsid = document.getElementById('ap-ssid')?.value || '';
        const apPassword = document.getElementById('ap-password')?.value || '';
        
        if (!apSsid) {
            showToastMessage('toastMessages.apSsidRequired', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        if (apPassword && apPassword.length < 8) {
            showToastMessage('toastMessages.apPasswordLength', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        if (isClientMode && (!wifiSsid || !wifiPassword)) {
            showToastMessage('toastMessages.clientSsidPasswordRequired', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        
        const wifiSettings = {
            client_enabled: isClientMode,
            wifi: { ssid: wifiSsid, password: wifiPassword },
            ap: { ssid: apSsid, password: apPassword }
        };
        await saveSettings(wifiSettings);
        window.SettingsPage.settingsModified.wifi = false;
        showToastMessage('toastMessages.settingsSaved', 'success'); // Generic save
        setTimeout(fetchConnectionStatus, 2000);
    } catch (error) {
        console.error('Errore salvataggio WiFi:', error);
        showToastMessage('toastMessages.wifiSaveError', 'error');
    } finally {
        if (saveButton) {
            saveButton.classList.remove('loading');
            saveButton.disabled = false;
        }
    }
}

async function saveZonesSettings() {
    if (!window.SettingsPage.settingsModified.zones) {
        showToastMessage('toastMessages.noChangesToSave', 'info');
        return;
    }
    const saveButton = document.getElementById('save-zones-button');
    if (saveButton) {
        saveButton.classList.add('loading');
        saveButton.disabled = true;
    }
    try {
        const zones = [];
        const zoneCards = document.querySelectorAll('.zone-card-setting');
        zoneCards.forEach(card => {
            const zoneId = parseInt(card.dataset.zoneId);
            const nameInput = card.querySelector('.zone-name-input');
            const statusToggle = card.querySelector('.zone-status-toggle');
            if (nameInput && statusToggle) {
                const name = nameInput.value.trim();
                const status = statusToggle.checked ? 'show' : 'hide';
                const currentZone = window.userData?.zones?.find(z => z.id === zoneId);
                const pin = currentZone?.pin !== undefined ? currentZone.pin : 14 + zoneId; // Preserve pin
                zones.push({ id: zoneId, name, pin, status });
            }
        });
        if (zones.length === 0 && zoneCards.length > 0) { // Check if parsing failed but cards exist
            showToastMessage('toastMessages.zoneSaveError', 'error');
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        await saveSettings({ zones });
        window.SettingsPage.settingsModified.zones = false;
        showToastMessage('toastMessages.settingsSaved', 'success');
    } catch (error) {
        console.error('Errore salvataggio zone:', error);
        showToastMessage('toastMessages.zoneSaveError', 'error');
    } finally {
        if (saveButton) {
            saveButton.classList.remove('loading');
            saveButton.disabled = false;
        }
    }
}

async function saveAdvancedSettings() {
    if (!window.SettingsPage.settingsModified.advanced) {
        showToastMessage('toastMessages.noChangesToSave', 'info');
        return;
    }
    const saveButton = document.getElementById('save-advanced-button');
    if (saveButton) {
        saveButton.classList.add('loading');
        saveButton.disabled = true;
    }
    try {
        const maxActiveZones = parseInt(document.getElementById('max-active-zones')?.value) || 3;
        const activationDelay = parseInt(document.getElementById('activation-delay')?.value) || 0;
        const maxZoneDuration = parseInt(document.getElementById('max-zone-duration')?.value) || 180;
if (maxActiveZones < 1 || maxActiveZones > 8) {
            showToastMessage('toastMessages.maxActiveZonesRange', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        if (activationDelay < -300 || activationDelay > 300) { 
            showToastMessage('toastMessages.activationDelayRange', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
        if (maxZoneDuration < 1) {
            showToastMessage('toastMessages.minZoneDuration', 'error'); // Ensure key in JSON
            if (saveButton) { saveButton.classList.remove('loading'); saveButton.disabled = false; }
            return;
        }
const advancedSettings = {
            max_active_zones: maxActiveZones,
            activation_delay: activationDelay,
            max_zone_duration: maxZoneDuration,
automatic_programs_enabled: window.userData?.automatic_programs_enabled !== undefined ? window.userData.automatic_programs_enabled : true
        };
        await saveSettings(advancedSettings);
        window.SettingsPage.settingsModified.advanced = false;
        showToastMessage('toastMessages.settingsSaved', 'success');
    } catch (error) {
        console.error('Errore salvataggio avanzate:', error);
        showToastMessage('toastMessages.advancedSaveError', 'error');
    } finally {
        if (saveButton) {
            saveButton.classList.remove('loading');
            saveButton.disabled = false;
        }
    }
}

async function saveSettings(settingsToSave) {
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('save', controller);
    try {
        const currentSettings = window.userData || {};
        const newSettings = { ...currentSettings, ...settingsToSave };
        const response = await (window.IrrigationAPI?.apiCall
            ? window.IrrigationAPI.apiCall('/save_user_settings', 'POST', newSettings)
            : fetch('/save_user_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings),
                signal: controller.signal
            }).then(res => res.json()));
        if (response.success || response.ok) {
            Object.assign(window.userData, newSettings); // Update global userData
        } else {
            throw new Error(response.error || 'Salvataggio fallito');
        }
    } finally {
        window.SettingsPage.abortControllers.delete('save');
    }
}

function startConnectionStatusPolling() {
    stopConnectionStatusPolling();
    fetchConnectionStatus();
    window.SettingsPage.settingsStatusInterval = setInterval(fetchConnectionStatus, 10000);
}

function stopConnectionStatusPolling() {
    if (window.SettingsPage.settingsStatusInterval) {
        clearInterval(window.SettingsPage.settingsStatusInterval);
        window.SettingsPage.settingsStatusInterval = null;
    }
}

async function fetchConnectionStatus() {
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('status', controller);
    try {
        const response = await (window.IrrigationAPI?.apiCall
            ? window.IrrigationAPI.apiCall('/get_connection_status')
            : fetch('/get_connection_status', { signal: controller.signal }).then(res => res.json()));
        updateConnectionStatus(response);
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Errore:', error);
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
            statusElement.innerHTML = `
                <div style="padding:10px;background-color:#ffebee;border-radius:6px;text-align:center;">
                    <p style="color:#c62828;margin:0;">${t('settings.wifi.errorFetchingStatus','Errore nel recupero stato connessione')}</p>
                </div>
            `;
        }
    } finally {
        window.SettingsPage.abortControllers.delete('status');
    }
}

function updateConnectionStatus(data) {
    const statusElement = document.getElementById('connection-status');
    if (!statusElement) return;
    const t = window.IrrigationI18n?.translate || ((key, fallback) => fallback || key);
    
    let statusHTML = '';

    if (data.mode === 'coexistence') {
        // MODALITÀ COESISTENZA: Client + AP
        statusElement.className = 'connection-status status-coexistence';
        statusHTML = `
            <h4>🔗 Modalità Coesistenza Attiva</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px;">
                <div style="padding: 10px; background: #e8f5e8; border-radius: 6px;">
                    <strong>📡 Client WiFi</strong>
                    <p style="margin: 5px 0;"><strong>SSID:</strong> ${data.ssid}</p>
                    <p style="margin: 5px 0;"><strong>IP:</strong> ${data.primary_ip}</p>
                </div>
                <div style="padding: 10px; background: #e8f4fd; border-radius: 6px;">
                    <strong>📶 Access Point</strong>
                    <p style="margin: 5px 0;"><strong>SSID:</strong> ${data.ap_ssid}</p>
                    <p style="margin: 5px 0;"><strong>IP:</strong> ${data.ap_ip}</p>
                </div>
            </div>
            <p style="font-size:12px;color:#666;margin-top:10px;">✅ Connesso a Internet + Gestione locale attiva</p>
        `;
    } else if (data.mode === 'client') {
        statusElement.className = 'connection-status status-client';
        statusHTML = `
            <h4 data-i18n="settings.wifi.statusClientTitle">${t('settings.wifi.statusClientTitle','Connesso come Client Wi-Fi')}</h4>
            <p><strong>${t('settings.wifi.statusSsid','SSID:')}</strong> ${data.ssid}</p>
            <p><strong>${t('settings.wifi.statusIp','Indirizzo IP:')}</strong> ${data.ip}</p>
        `;
    } else if (data.mode === 'AP') {
        statusElement.className = 'connection-status status-ap';
        const scanReady = data.scan_ready ? '✅ Scansioni WiFi disponibili' : '⚠️ Scansioni WiFi limitate';
        statusHTML = `
            <h4 data-i18n="settings.wifi.statusAPTitle">${t('settings.wifi.statusAPTitle','Modalità Access Point attiva')}</h4>
            <p><strong>${t('settings.wifi.statusSsid','SSID:')}</strong> ${data.ssid}</p>
            <p><strong>${t('settings.wifi.statusIp','Indirizzo IP:')}</strong> ${data.ip}</p>
            <p style="font-size:12px;color:#666;" data-i18n="settings.wifi.statusAPInfo">${t('settings.wifi.statusAPInfo','I dispositivi possono connettersi a questa rete.')}</p>
            <p style="font-size:12px;color:#888;">${scanReady}</p>
        `;
    } else {
        statusElement.className = 'connection-status status-offline';
        statusHTML = `
            <h4 data-i18n="settings.wifi.statusOfflineTitle">${t('settings.wifi.statusOfflineTitle','Nessuna connessione attiva')}</h4>
            <p style="font-size:12px;" data-i18n="settings.wifi.statusOfflineInfo">${t('settings.wifi.statusOfflineInfo','Configura le impostazioni Wi-Fi per connettere il dispositivo.')}</p>
        `;
    }
    statusElement.innerHTML = statusHTML;
    // No need to call applyTranslations here as we are constructing the HTML with translated strings.
}

function confirmRestartSystem() {
    const overlay = document.getElementById('restart-overlay');
    if (overlay) {
        if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(overlay); // Translate dialog before showing
        overlay.classList.add('active');
    }
}

function closeRestartDialog() { 
    const overlay = document.getElementById('restart-overlay');
    if (overlay) overlay.classList.remove('active');
}

function confirmFactoryReset() {
    const overlay = document.getElementById('factory-reset-overlay');
    if (overlay) {
        if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(overlay);
        overlay.classList.add('active');
    }
}

function closeFactoryResetDialog() { 
    const overlay = document.getElementById('factory-reset-overlay');
    if (overlay) overlay.classList.remove('active');
}

function confirmFactoryResetFinal() {
    closeFactoryResetDialog();
    const overlay = document.getElementById('factory-reset-final-overlay');
    if (overlay) {
        if(window.IrrigationI18n) window.IrrigationI18n.applyTranslations(overlay);
        overlay.classList.add('active');
    }
}

function closeFactoryResetFinalDialog() { 
    const overlay = document.getElementById('factory-reset-final-overlay');
    if (overlay) overlay.classList.remove('active');
}

function closeConfirmDialog(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.classList.remove('active');
}

async function restartSystem() {
    const restartButton = document.getElementById('restart-button');
    if (restartButton) {
        restartButton.classList.add('loading');
        restartButton.disabled = true;
    }
    closeRestartDialog();
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('restart', controller);
    try {
        const response = await (window.IrrigationAPI?.apiCall
            ? window.IrrigationAPI.apiCall('/restart_system', 'POST')
            : fetch('/restart_system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal }).then(res => res.json()));
        if (response.success || response.ok) {
            showToastMessage('toastMessages.systemRestarting', 'info');
            let countDown = 30;
            const countdownInterval = setInterval(() => {
                if (--countDown <= 0) {
                    clearInterval(countdownInterval);
                    window.location.reload();
                } else {
                    showToastMessage('toastMessages.systemRestartingCountdown', 'info', { countDown: countDown });
                }
            }, 1000);
        } else {
            throw new Error(response.error || 'Riavvio fallito');
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Errore:', error);
        showToastMessage('toastMessages.networkError', 'error');
        if (restartButton) {
            restartButton.classList.remove('loading');
            restartButton.disabled = false;
        }
    } finally {
        window.SettingsPage.abortControllers.delete('restart');
    }
}

async function executeFactoryReset() {
    const factoryResetButton = document.getElementById('factory-reset-button');
    if (factoryResetButton) {
        factoryResetButton.classList.add('loading');
        factoryResetButton.disabled = true;
    }
    closeFactoryResetFinalDialog();
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('reset', controller);
    try {
        const response = await (window.IrrigationAPI?.apiCall
            ? window.IrrigationAPI.apiCall('/reset_factory_data', 'POST')
            : fetch('/reset_factory_data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal }).then(res => res.json()));
        if (response.success || response.ok) {
            showToastMessage('toastMessages.factoryResetComplete', 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            throw new Error(response.error || 'Reset fallito');
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Errore:', error);
        showToastMessage('toastMessages.networkError', 'error');
        if (factoryResetButton) {
            factoryResetButton.classList.remove('loading');
            factoryResetButton.disabled = false;
        }
    } finally {
        window.SettingsPage.abortControllers.delete('reset');
    }
}

async function downloadSystemLogs() {
    const downloadButton = document.getElementById('download-logs-button');
    if (downloadButton) {
        downloadButton.classList.add('loading');
        downloadButton.disabled = true;
    }
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('download-logs', controller);
    try {
        // Chiamata al nuovo endpoint per il download dei log
        const response = await fetch('/download_system_logs', { signal: controller.signal });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Errore HTTP: ${response.status}`);
        }
        
        // Ottieni il contenuto del file
        const logContent = await response.text();
        
        // Crea e scarica il file
        const blob = new Blob([logContent], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Estrai il nome del file dall'header Content-Disposition se presente
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = 'irrigasmart_logs.txt';
        if (contentDisposition) {
            const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (fileNameMatch) {
                fileName = fileNameMatch[1];
            }
        }
        
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToastMessage('toastMessages.downloadLogsStarted', 'success');
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Errore durante il download dei log:', error);
            showToastMessage('toastMessages.errorDownloadingLogs', 'error');
        }
    } finally {
        window.SettingsPage.abortControllers.delete('download-logs');
        if (downloadButton) {
            downloadButton.classList.remove('loading');
            downloadButton.disabled = false;
        }
    }
}

function showToastMessage(messageKey, type, replacements = {}) {
    const ui = window.IrrigationUI;
    if (ui?.showToast) {
        ui.showToast(messageKey, type, 3500, replacements);
    } else {
        const fallbackMessage = messageKey.includes('.') ? messageKey.split('.').pop() : messageKey;
        console.log(`Toast (${type}): ${fallbackMessage}`);
    }
}

function proceedToFinalReset() { confirmFactoryResetFinal(); }
function performFactoryReset() { executeFactoryReset(); }

// === NEW COEXISTENCE WIFI INTERFACE FUNCTIONS ===

function initializeCoexistenceWifiInterface() {
    // Aggiorna immediatamente l'overview WiFi
    updateWifiOverview();

    // Imposta un polling periodico per mantenere aggiornato lo stato
    if (window.SettingsPage.wifiOverviewInterval) {
        clearInterval(window.SettingsPage.wifiOverviewInterval);
    }

    window.SettingsPage.wifiOverviewInterval = setInterval(() => {
        updateWifiOverview();
    }, 15000); // Aggiorna ogni 15 secondi

    // Espandi la sezione client di default se non è connesso
    setTimeout(() => {
        const clientStatus = document.querySelector('#client-status .status-indicator');
        if (clientStatus && clientStatus.classList.contains('disconnected')) {
            toggleConfigSection('client-config');
        }
    }, 1000);
}

function toggleConfigSection(sectionId) {
    const content = document.getElementById(sectionId);
    const header = content.previousElementSibling;
    const isExpanded = content.classList.contains('expanded');

    if (isExpanded) {
        content.classList.remove('expanded');
        content.style.display = 'none';
        header.setAttribute('aria-expanded', 'false');
    } else {
        content.classList.add('expanded');
        content.style.display = 'block';
        header.setAttribute('aria-expanded', 'true');
    }
}

function updateWifiOverview() {
    // Aggiorna lo stato delle interfacce WiFi
    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('wifi-overview', controller);

    fetch('/api/network_interfaces', { signal: controller.signal })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.interfaces) {
                updateClientOverview(data.interfaces.client);
                updateApOverview(data.interfaces.ap);
            }
        })
        .catch(error => {
            if (error.name !== 'AbortError') {
                console.error('Errore aggiornamento overview WiFi:', error);
            }
        })
        .finally(() => {
            window.SettingsPage.abortControllers.delete('wifi-overview');
        });
}

function updateClientOverview(clientData) {
    const statusIndicator = document.querySelector('#client-status .status-indicator');
    const statusLabel = document.querySelector('#client-status .status-label');
    const networkElement = document.getElementById('client-network');
    const ipElement = document.getElementById('client-ip');
    const disconnectBtn = document.getElementById('disconnect-wifi-button');
    const connectBtn = document.getElementById('connect-wifi-button');

    if (clientData && clientData.active && clientData.connected) {
        // Connesso
        statusIndicator.className = 'status-indicator connected';
        statusLabel.textContent = 'Connesso';
        networkElement.textContent = getCurrentWifiNetwork() || 'Sconosciuta';
        ipElement.textContent = clientData.ip || '-';

        if (disconnectBtn) {
            disconnectBtn.style.display = 'inline-block';
        }
        if (connectBtn) {
            connectBtn.textContent = 'Riconnetti';
        }
    } else {
        // Disconnesso
        statusIndicator.className = 'status-indicator disconnected';
        statusLabel.textContent = 'Disconnesso';
        networkElement.textContent = '-';
        ipElement.textContent = '-';

        if (disconnectBtn) {
            disconnectBtn.style.display = 'none';
        }
        if (connectBtn) {
            connectBtn.textContent = 'Connetti';
        }
    }
}

function updateApOverview(apData) {
    const statusIndicator = document.querySelector('#ap-status .status-indicator');
    const statusLabel = document.querySelector('#ap-status .status-label');
    const ssidElement = document.getElementById('ap-ssid-display');
    const ipElement = document.getElementById('ap-ip');

    if (apData && apData.active) {
        statusIndicator.className = 'status-indicator active';
        statusLabel.textContent = 'Attivo';
        ipElement.textContent = apData.ip || '192.168.1.4';
    } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusLabel.textContent = 'Inattivo';
        ipElement.textContent = '-';
    }
}

function getCurrentWifiNetwork() {
    const wifiSelect = document.getElementById('wifi-list');
    return wifiSelect?.value || null;
}

function connectWifi() {
    const networkSelect = document.getElementById('wifi-list');
    const passwordInput = document.getElementById('wifi-password');
    const connectBtn = document.getElementById('connect-wifi-button');
    const statusDiv = document.getElementById('connection-status');

    const ssid = networkSelect?.value;
    const password = passwordInput?.value;

    if (!ssid) {
        showToastMessage('toastMessages.selectNetwork', 'warning');
        return;
    }

    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.classList.add('loading');
        connectBtn.textContent = 'Connessione...';
    }

    if (statusDiv) {
        statusDiv.style.display = 'flex';
        statusDiv.querySelector('.status-message').textContent = 'Connessione in corso...';
    }

    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('wifi-connect', controller);

    const formData = new FormData();
    formData.append('ssid', ssid);
    formData.append('password', password);

    fetch('/connect_wifi', {
        method: 'POST',
        body: formData,
        signal: controller.signal
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastMessage('toastMessages.wifiConnected', 'success');

            // Pulisci la password
            if (passwordInput) {
                passwordInput.value = '';
            }

            // Aggiorna overview dopo un breve delay
            setTimeout(() => {
                updateWifiOverview();
            }, 2000);
        } else {
            showToastMessage('toastMessages.wifiConnectionFailed', 'error');
        }
    })
    .catch(error => {
        if (error.name !== 'AbortError') {
            console.error('Errore connessione WiFi:', error);
            showToastMessage('toastMessages.wifiConnectionError', 'error');
        }
    })
    .finally(() => {
        window.SettingsPage.abortControllers.delete('wifi-connect');

        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.classList.remove('loading');
            connectBtn.textContent = 'Connetti';
        }

        if (statusDiv) {
            statusDiv.style.display = 'none';
        }
    });
}

function disconnectWifi() {
    const disconnectBtn = document.getElementById('disconnect-wifi-button');
    const statusDiv = document.getElementById('connection-status');

    if (disconnectBtn) {
        disconnectBtn.disabled = true;
        disconnectBtn.classList.add('loading');
    }

    if (statusDiv) {
        statusDiv.style.display = 'flex';
        statusDiv.querySelector('.status-message').textContent = 'Disconnessione...';
    }

    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('wifi-disconnect', controller);

    fetch('/disconnect_wifi', {
        method: 'POST',
        signal: controller.signal
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastMessage('toastMessages.wifiDisconnected', 'success');
            updateWifiOverview();
        } else {
            showToastMessage('toastMessages.wifiDisconnectionFailed', 'error');
        }
    })
    .catch(error => {
        if (error.name !== 'AbortError') {
            console.error('Errore disconnessione WiFi:', error);
            showToastMessage('toastMessages.wifiDisconnectionError', 'error');
        }
    })
    .finally(() => {
        window.SettingsPage.abortControllers.delete('wifi-disconnect');

        if (disconnectBtn) {
            disconnectBtn.disabled = false;
            disconnectBtn.classList.remove('loading');
        }

        if (statusDiv) {
            statusDiv.style.display = 'none';
        }
    });
}

function saveApSettings() {
    const ssidInput = document.getElementById('ap-ssid');
    const passwordInput = document.getElementById('ap-password');
    const saveBtn = document.getElementById('save-ap-button');

    const ssid = ssidInput?.value?.trim();
    const password = passwordInput?.value;

    if (!ssid) {
        showToastMessage('toastMessages.apSsidRequired', 'warning');
        return;
    }

    if (password && password.length < 8) {
        showToastMessage('toastMessages.apPasswordTooShort', 'warning');
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.add('loading');
    }

    // Prepara i dati da salvare
    const settingsData = {
        wifi: {
            ap_ssid: ssid,
            ap_password: password
        }
    };

    const controller = new AbortController();
    window.SettingsPage.abortControllers.set('save-ap', controller);

    fetch('/save_user_settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settingsData),
        signal: controller.signal
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastMessage('toastMessages.apSettingsSaved', 'success');

            // Aggiorna l'overview AP
            setTimeout(() => {
                updateWifiOverview();
            }, 1000);
        } else {
            showToastMessage('toastMessages.apSettingsSaveFailed', 'error');
        }
    })
    .catch(error => {
        if (error.name !== 'AbortError') {
            console.error('Errore salvataggio impostazioni AP:', error);
            showToastMessage('toastMessages.apSettingsSaveError', 'error');
        }
    })
    .finally(() => {
        window.SettingsPage.abortControllers.delete('save-ap');

        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.remove('loading');
        }
    });
}

// Override delle funzioni esistenti per compatibilità
function selectWifiMode(mode) {
    // Non più necessario in modalità coesistenza
    console.log('WiFi mode selection not needed in coexistence mode');
}

// Export delle nuove funzioni
window.toggleConfigSection = toggleConfigSection;
window.connectWifi = connectWifi;
window.disconnectWifi = disconnectWifi;
window.saveApSettings = saveApSettings;
window.updateWifiOverview = updateWifiOverview;

// Export delle funzioni esistenti per compatibilità
window.initializeSettingsPage = initializeSettingsPage;
window.selectWifiMode = selectWifiMode;
window.scanWifiNetworks = scanWifiNetworks;
window.saveLanguageSetting = saveLanguageSetting;

window.saveWifiSettings = saveWifiSettings;
window.saveZonesSettings = saveZonesSettings;
window.saveAdvancedSettings = saveAdvancedSettings;
window.startConnectionStatusPolling = startConnectionStatusPolling;
window.stopConnectionStatusPolling = stopConnectionStatusPolling;
window.fetchConnectionStatus = fetchConnectionStatus;
window.confirmRestartSystem = confirmRestartSystem;
window.closeRestartDialog = closeRestartDialog;
window.confirmFactoryReset = confirmFactoryReset;
window.closeFactoryResetDialog = closeFactoryResetDialog;
window.confirmFactoryResetFinal = confirmFactoryResetFinal;
window.closeFactoryResetFinalDialog = closeFactoryResetFinalDialog;
window.restartSystem = restartSystem;
window.executeFactoryReset = executeFactoryReset;
window.closeConfirmDialog = closeConfirmDialog;
window.proceedToFinalReset = proceedToFinalReset;
window.performFactoryReset = performFactoryReset;
window.downloadSystemLogs = downloadSystemLogs; 


document.addEventListener('DOMContentLoaded', () => {
    if (window.IrrigationApp?.currentPage === 'settings.html' || 
        (window.location.hash === '#settings' && !window.IrrigationApp?.currentPage)) {
        const userData = window.IrrigationApp?.userData || window.userData;
        initializeSettingsPage(userData);
    }
});