/**
 * ConfigurationService
 * 
 * Manages the loading, updating, and persistence of scanner configuration settings.
 * This class is designed to be instantiated by AutoScannerService and interact with its state.
 */

import { queueEntityCall } from '@/components/utils/apiQueue';
import { SCANNER_DEFAULTS } from '../constants/scannerDefaults';

export class ConfigurationService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        this.toast = scannerService.toast;
    }

    /**
     * Loads the scanner configuration settings from the database and updates the AutoScannerService's state.
     */
    async loadConfiguration() {
        this.addLog('[ConfigurationService] Loading scanner configuration...', 'info');
        const settingsList = await queueEntityCall('ScanSettings', 'list');
        const rawSettings = settingsList[0] || { 
            id: 'default', 
            settings: { 
                scanFrequency: SCANNER_DEFAULTS.scanFrequency, 
                minimumCombinedStrength: SCANNER_DEFAULTS.minimumCombinedStrength, 
                minimumRegimeConfidence: SCANNER_DEFAULTS.minimumRegimeConfidence, 
                minimumTradeValue: SCANNER_DEFAULTS.minimumTradeValue, 
                maxPositions: SCANNER_DEFAULTS.maxPositions, 
                local_proxy_url: SCANNER_DEFAULTS.localProxyUrl 
            } 
        };
        
        // Extract settings from the database structure
        const loadedSettings = rawSettings.settings || rawSettings;

        // Ensure local_proxy_url is initialized with default value
        if (!loadedSettings.local_proxy_url) {
            loadedSettings.local_proxy_url = SCANNER_DEFAULTS.localProxyUrl;
        }
        // Ensure ID is present for upsert operations
        if (!loadedSettings.id) {
            loadedSettings.id = 'default';
        }

        // Ensure maxBalancePercentRisk is initialized
        if (typeof loadedSettings.maxBalancePercentRisk !== 'number' || loadedSettings.maxBalancePercentRisk <= 0) {
            loadedSettings.maxBalancePercentRisk = SCANNER_DEFAULTS.maxBalancePercentRisk;
        }
        // NEW: Ensure absolute invest cap default
        if (typeof loadedSettings.maxBalanceInvestCapUSDT !== 'number' || loadedSettings.maxBalanceInvestCapUSDT < 0) {
            loadedSettings.maxBalanceInvestCapUSDT = SCANNER_DEFAULTS.maxBalanceInvestCapUSDT;
        }
        // NEW: Ensure blockTradingInDowntrend is initialized
        if (typeof loadedSettings.blockTradingInDowntrend !== 'boolean') {
            loadedSettings.blockTradingInDowntrend = SCANNER_DEFAULTS.blockTradingInDowntrend;
        }


        // Directly update the AutoScannerService's state
        this.scannerService.state.settings = loadedSettings;
        this.addLog('[ConfigurationService] Configuration loaded.', 'info');
    }

    /**
     * Updates the scanner settings, persists them to the database, and triggers related actions
     * like strategy re-filtering if critical settings like minimumCombinedStrength are changed.
     * @param {object} newSettings - An object containing the new settings to apply.
     */
    async updateSettings(newSettings) {
        this.addLog('[ConfigurationService] Updating scanner settings...', 'system', newSettings);
        try {
            const oldSettings = { ...this.scannerService.state.settings }; // Clone for comparison

            // Update local state first
            this.scannerService.state.settings = { ...this.scannerService.state.settings, ...newSettings };

            // Persist to database using direct API calls to avoid queue hanging
            console.log('[ConfigurationService] Fetching existing settings...');
            try {
                const listResponse = await fetch('http://localhost:3003/api/scanSettings');
                const listResult = await listResponse.json();
                const existingSettings = listResult.success ? listResult.data : [];
                console.log('[ConfigurationService] Existing settings:');
                console.log(existingSettings);
                
                if (existingSettings && existingSettings.length > 0) {
                    console.log('[ConfigurationService] Updating existing settings with ID:');
                    console.log(existingSettings[0].id);
                    const updateResponse = await fetch(`http://localhost:3003/api/scanSettings/${existingSettings[0].id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(this.scannerService.state.settings)
                    });
                    const updateResult = await updateResponse.json();
                    console.log('[ConfigurationService] Update result:');
                    console.log(updateResult);
                    
                    if (!updateResult.success) {
                        throw new Error(`API update failed: ${updateResult.error || 'Unknown error'}`);
                    }
                } else {
                    console.log('[ConfigurationService] No existing settings found, creating new settings...');
                    const createResponse = await fetch('http://localhost:3003/api/scanSettings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(this.scannerService.state.settings)
                    });
                    const createResult = await createResponse.json();
                    console.log('[ConfigurationService] Create result:');
                    console.log(createResult);
                    
                    if (!createResult.success) {
                        throw new Error(`API create failed: ${createResult.error || 'Unknown error'}`);
                    }
                }
                
                console.log('[ConfigurationService] ✅ Database operations completed successfully');
            } catch (error) {
                console.error('[ConfigurationService] Error with direct API calls:', error);
                throw error;
            }

            // After settings are updated, re-attach/ensure the guard is active.
            // This is crucial if blockTradingInDowntrend is changed.
            if (this.scannerService.attachRegimeOpenGuard) {
                this.scannerService.attachRegimeOpenGuard();
            }


            if (newSettings.minimumCombinedStrength !== undefined &&
                newSettings.minimumCombinedStrength !== oldSettings.minimumCombinedStrength) {
                this.addLog(`[ConfigurationService] Minimum combined strength changed to ${newSettings.minimumCombinedStrength}. Re-filtering strategies...`, 'system');
                // Delegate strategy re-filtering to StrategyManagerService via AutoScannerService
                await this.scannerService.strategyManager._loadAndFilterStrategiesInternal(newSettings.minimumCombinedStrength);
            }

            if (newSettings.minimumRegimeConfidence !== undefined &&
                newSettings.minimumRegimeConfidence !== oldSettings.minimumRegimeConfidence) {
                this.addLog(`[ConfigurationService] Minimum regime confidence threshold changed to ${newSettings.minimumRegimeConfidence}%. This will affect strategy evaluation in future scan cycles.`, 'system');
            }

            if (newSettings.minimumTradeValue !== undefined && newSettings.minimumTradeValue !== oldSettings.minimumTradeValue) {
                this.addLog(`[ConfigurationService] Minimum trade value changed to ${newSettings.minimumTradeValue} USDT.`, 'system');
            }

            if (newSettings.maxPositions !== undefined && newSettings.maxPositions !== oldSettings.maxPositions) {
                this.addLog(`[ConfigurationService] Max positions per strategy changed to ${newSettings.maxPositions}.`, 'system');
            }

            if (newSettings.maxBalancePercentRisk !== undefined && newSettings.maxBalancePercentRisk !== oldSettings.maxBalancePercentRisk) {
                this.addLog(`[ConfigurationService] Max balance percent risk changed to ${newSettings.maxBalancePercentRisk}%.`, 'system');
            }
            // NEW: Log absolute cap changes
            if (newSettings.maxBalanceInvestCapUSDT !== undefined &&
                newSettings.maxBalanceInvestCapUSDT !== oldSettings.maxBalanceInvestCapUSDT) {
                this.addLog(`[ConfigurationService] Max balance invest cap changed to $${newSettings.maxBalanceInvestCapUSDT}.`, 'system');
            }
            // NEW: Log blockTradingInDowntrend changes
            if (newSettings.blockTradingInDowntrend !== undefined &&
                newSettings.blockTradingInDowntrend !== oldSettings.blockTradingInDowntrend) {
                this.addLog(`[ConfigurationService] Block trading in downtrend set to ${newSettings.blockTradingInDowntrend ? 'ENABLED' : 'DISABLED'}.`, 'system');
            }


            this.addLog('[ConfigurationService] Scanner settings updated successfully.', 'success');
            this.scannerService.notifySubscribers(); // Notify UI of settings change

            if (this.toast) {
                this.toast({
                    title: "Settings Updated",
                    description: "Scanner configuration has been successfully updated."
                });
            }

        } catch (error) {
            this.addLog(`[ConfigurationService] Failed to update settings: ${error.message}`, 'error', error);
            if (this.toast) {
                this.toast({
                    title: "Settings Update Failed",
                    description: `Failed to update settings: ${error.message}`,
                    variant: "destructive"
                });
            }
            throw error;
        }
    }
}

export default ConfigurationService;
