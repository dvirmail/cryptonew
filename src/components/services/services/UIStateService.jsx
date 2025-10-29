/**
 * UIStateService
 * 
 * Manages UI state, notifications, and UI-related operations.
 * This service handles subscriber notifications, state persistence, and UI state management.
 */

import { STORAGE_KEYS } from '../constants/storageKeys';

export class UIStateService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        this.notifyWalletSubscribers = scannerService.notifyWalletSubscribers.bind(scannerService);
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // UI state management
        this.subscribers = [];
        this.toast = null;
    }

    /**
     * Notifies all subscribers with the current state.
     */
    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.scannerService.state);
            } catch (error) {
                // Silent error handling for subscriber callbacks
            }
        });
    }

    /**
     * Registers a toast notification function.
     * @param {Function} toastFunction - Toast notification function.
     */
    registerToastNotifier(toastFunction) {
        this.toast = toastFunction;
    }

    /**
     * Saves scanner state to localStorage for persistence.
     */
    _saveStateToStorage() {
        try {
            if (typeof window === 'undefined') return;
            const stateToSave = {
                isRunning: this.scannerService.state.isRunning,
                tradingMode: this.scannerService.state.tradingMode,
                // NEW: persist market regime streak/state
                marketRegimeState: this.scannerService.state.marketRegime
                    ? {
                        regime: this.scannerService.state.marketRegime.regime,
                        confidence: this.scannerService.state.marketRegime.confidence,
                        isConfirmed: this.scannerService.state.marketRegime.isConfirmed,
                        consecutivePeriods: this.scannerService.state.marketRegime.consecutivePeriods,
                        confirmationThreshold: this.scannerService.state.marketRegime.confirmationThreshold,
                        regimeHistory: Array.isArray(this.scannerService.state.marketRegime.regimeHistory)
                            ? this.scannerService.state.marketRegime.regimeHistory.slice(-20) // cap history length
                            : []
                    }
                    : null,
                // NEW: persist scan cycle statistics
                scanCycleStats: {
                    totalScanCycles: this.scannerService.state.stats?.totalScanCycles || 0,
                    averageScanTimeMs: this.scannerService.state.stats?.averageScanTimeMs || 0,
                    lastScanTimeMs: this.scannerService.state.stats?.lastScanTimeMs || 0,
                    totalScans: this.scannerService.state.stats?.totalScans || 0 // ADDED: Persist totalScans
                }
            };
            localStorage.setItem(STORAGE_KEYS.scannerState, JSON.stringify(stateToSave));
        } catch (error) {
            console.error('[AutoScannerService] Failed to save scanner state to localStorage.', error);
        }
    }

    /**
     * Loads scanner state from localStorage.
     */
    _loadStateFromStorage() {
        try {
            if (typeof window === 'undefined') return;
            const savedStateJSON = localStorage.getItem(STORAGE_KEYS.scannerState);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                
                // Restore basic state
                if (savedState.isRunning !== undefined) {
                    this.scannerService.state.isRunning = savedState.isRunning;
                }
                if (savedState.tradingMode) {
                    this.scannerService.state.tradingMode = savedState.tradingMode;
                }

                // Restore market regime state
                if (savedState.marketRegimeState) {
                    this.scannerService.state.marketRegime = {
                        regime: savedState.marketRegimeState.regime || 'neutral',
                        confidence: savedState.marketRegimeState.confidence || 0.5,
                        isConfirmed: savedState.marketRegimeState.isConfirmed || false,
                        consecutivePeriods: savedState.marketRegimeState.consecutivePeriods || 0,
                        confirmationThreshold: savedState.marketRegimeState.confirmationThreshold || 3,
                        regimeHistory: Array.isArray(savedState.marketRegimeState.regimeHistory) 
                            ? savedState.marketRegimeState.regimeHistory 
                            : []
                    };
                }

                // Restore scan cycle statistics
                if (savedState.scanCycleStats) {
                    this.scannerService.state.stats.totalScanCycles = savedState.scanCycleStats.totalScanCycles || 0;
                    this.scannerService.state.stats.averageScanTimeMs = savedState.scanCycleStats.averageScanTimeMs || 0;
                    this.scannerService.state.stats.lastScanTimeMs = savedState.scanCycleStats.lastScanTimeMs || 0;
                    this.scannerService.state.stats.totalScans = savedState.scanCycleStats.totalScans || 0; // ADDED: Load totalScans
                }

                console.log('[AutoScannerService] Scanner state restored from localStorage.');
            }
        } catch (error) {
            console.error('[AutoScannerService] Failed to load scanner state from localStorage.', error);
        }
    }

    /**
     * Clears all activity logs.
     */
    clearLogs() {
        this.scannerService.state.logs.activity = [];
        console.log('[AutoScannerService] Logs cleared by user.');
    }

    /**
     * Forces a complete state reset of the scanner service.
     * This is a critical operation that clears all state and storage.
     */
    forceResetState() {
        console.log('[AutoScannerService] 🚨 [CRITICAL] Forcing a complete state reset of the scanner service.');
        this.scannerService.isHardResetting = true;

        this.scannerService.stop();

        // NEW: clear persisted storage entirely
        if (typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEYS.scannerState);
            localStorage.removeItem(`walletSummaryCache_testnet`);
            localStorage.removeItem(`walletSummaryCache_live`);
        }

        this.scannerService.state = {
            isInitialized: false,
            isInitializing: false,
            isRunning: false,
            isScanning: false,
            settings: null,
            activeStrategies: [],
            marketRegime: null,
            performanceMomentumScore: null,
            momentumBreakdown: null,
            signalGenerationHistory: [],
            marketVolatility: { adx: 25, bbw: 0.1 },
            logs: { activity: [], performance: [] },
            stats: {
                activeStrategies: 0,
                totalScans: 0,
                signalsFound: 0,
                tradesExecuted: 0,
                totalPnL: 0,
                averageSignalStrength: 0,
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            },
            lastScanTime: null,
            nextScanTime: null,
            recentTradesForMomentum: [],
            tradingMode: 'testnet',
            liveWalletState: null,
            exchangeInfo: null,
            leaderSessionId: null,
            fearAndGreedData: null,
            marketAlerts: [],
            newPositionsCount: 0,
            adjustedBalanceRiskFactor: 100,
            error: null,
            errorSource: null
        };

        // Reset all service states
        this.scannerService.performanceMetricsService.resetState();
        this.scannerService.marketRegimeService.resetState();
        this.scannerService.priceManagerService.resetState();
        this.scannerService.scanEngineService.resetState();
        this.scannerService.tradeArchivingService.resetState();

        this.scannerService.scanCycleTimes = [];
        this.scannerService.currentPrices = {};

        this.scannerService.isHardResetting = false;
        this.scannerService.notifySubscribers();
        console.log('[AutoScannerService] ✅ Complete state reset completed.');
    }

    /**
     * Initializes widget defaults for immediate UI display.
     */
    _initializeWidgetDefaults() {
        // Initialize Fear & Greed Index with default values for immediate display
        if (!this.scannerService.state.fearAndGreedData) {
            this.scannerService.state.fearAndGreedData = {
                value: 50, // Neutral value
                value_classification: "Neutral",
                timestamp: Date.now(),
                time_until_update: "Loading..."
            };
        }

        // Initialize Performance Momentum with default values for immediate display
        if (!this.scannerService.state.performanceMomentum) {
            this.scannerService.state.performanceMomentum = {
                score: 50, // Neutral score
                trend: "stable",
                timestamp: Date.now(),
                components: {
                    unrealized: 50,
                    realized: 50,
                    regime: 50,
                    volatility: 50,
                    opportunity: 50,
                    fearGreed: 50,
                    signalQuality: 50
                }
            };
        }

        // Notify subscribers to update UI with default values
        this.scannerService.notifySubscribers();
    }

    /**
     * Gets the current scanner state.
     * @returns {object} Current scanner state.
     */
    getState() {
        return { ...this.scannerService.state };
    }

    /**
     * Resets the UI state service.
     */
    resetState() {
        this.subscribers = [];
        this.toast = null;
        this.addLog('[UIStateService] State reset.', 'system');
    }
}

export default UIStateService;
