
import { queueEntityCall, apiQueue, queueFunctionCall, refreshMarketAlertCache, getMarketAlertCache, flushMarketAlertBuffer } from '@/components/utils/apiQueue';
import MarketRegimeDetector from '@/components/utils/MarketRegimeDetector';
import { getKlineData } from '@/api/functions';
import { SignalDetectionEngine } from './SignalDetectionEngine';
import { calculateAllIndicators }
    from '@/components/utils/indicatorManager';
import { Trade } from '@/api/entities';
import { purgeDemoData } from '@/api/functions';
import { getBinancePrices } from '@/api/functions';
import { getFearAndGreedIndex } from '@/api/functions';
import { archiveOldTrades } from '@/api/functions';
import { positionSizeValidator } from '../utils/positionSizeValidator';
import PositionManager from './PositionManager';
import { scannerSessionManager } from '@/api/functions';
import { liveTradingAPI } from '@/api/functions';
import { initializeWalletManagerService } from './WalletManagerService';
import HeartbeatService from "./HeartbeatService";
import SessionManagerService from "./SessionManagerService";
import TradeArchivingService from "./TradeArchivingService";
import { functions } from '@/api/localClient';
import { formatPrice, formatUSDT } from '@/components/utils/priceFormatter';
import { generateTradeId } from "@/components/utils/id";
// NOTE: updatePerformanceSnapshot removed - analytics now pull directly from Trade table
import { reconcileWalletState, walletReconciliation, purgeGhostPositions } from '@/api/functions';

// Import constants from centralized files
import { MOMENTUM_WEIGHTS, MOMENTUM_WEIGHTS_PERCENTS, MOMENTUM_INTERVALS, MOMENTUM_THRESHOLDS } from './constants/momentumWeights';
import { STORAGE_KEYS } from './constants/storageKeys';
import { SCANNER_DEFAULTS, DEFAULT_SCANNER_STATE, DEFAULT_WALLET_STATE, DEFAULT_MARKET_REGIME } from './constants/scannerDefaults';

// Import services from centralized files
import { PerformanceMetricsService } from './services/PerformanceMetricsService';
import { ConfigurationService } from './services/ConfigurationService';
import { StrategyManagerService } from './services/StrategyManagerService';
import { MarketRegimeService } from './services/MarketRegimeService';
import { PriceManagerService } from './services/PriceManagerService';
import { ScanEngineService } from './services/ScanEngineService';
import { WalletStateService } from './services/WalletStateService';
import { UIStateService } from './services/UIStateService';
import { LifecycleService } from './services/LifecycleService';
import { UtilityService } from './services/UtilityService';

/**
 * AutoScannerService - Main scanner service class
 * 
 * This is the central service that orchestrates all scanner operations including
 * strategy management, signal detection, position management, and performance tracking.
 */


class AutoScannerService {
    constructor() {
        if (AutoScannerService.instance) {
            return AutoScannerService.instance;
        }

        AutoScannerService.instance = this;

        this.state = {
            ...DEFAULT_SCANNER_STATE,
            tradingMode: SCANNER_DEFAULTS.tradingMode,
        };

        this.regimeCache = {
            regime: null,
            lastCalculated: null,
            cacheValidityHours: SCANNER_DEFAULTS.regimeCacheValidityHours
        };

        this.currentPrices = {};

        this.telegramSettings = {
            token: typeof window !== 'undefined' ? (window.TELEGRAM_BOT_TOKEN || '') : '',
            chat_id: typeof window !== 'undefined' ? (window.TELEGRAM_CHAT_ID || '') : ''
        };

        this.subscribers = [];
        this.scanInterval = null;
        this.countdownInterval = null;
        this.walletSubscribers = [];

        this.isHardResetting = false;
        this.sessionId = null;
        this.isNavigating = false;
        this.navigationTimeout = null;
        this._hasAutoStartedOnInit = false;
        this._isAutoStartBlocked = false; // NEW: allows UI to control auto-start timing
        this._persistedRunningFlag = false; // NEW: remember prior "running" without starting immediately
        this._openGuardAttached = false; // Flag to track if the guard has been attached

        // NOTE: Do NOT auto-start here based on persisted state. We'll start only after init completes.

        // Ensure tradingMode always has a valid default
        if (!this.state.tradingMode) {
            this.state.tradingMode = SCANNER_DEFAULTS.tradingMode;
        }

        this.backtestCache = new Map();
        this.backtestCacheTimestamps = new Map();

        // ✅ RATE LIMIT PREVENTION: Track exchange info loading state
        this._exchangeInfoLoading = false;
        this._exchangeInfoLoadPromise = null;
        this._exchangeInfoRetryInterval = null;
        this._exchangeInfoLastAttempt = 0;
        this._exchangeInfoMinInterval = 60000; // Minimum 1 minute between requests

        // Instance properties for _fetchFearAndGreedIndex to work within AutoScannerService
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedFetchInterval = SCANNER_DEFAULTS.fearGreedFetchInterval;
        this.fearAndGreedData = null; // AutoScannerService's own property, distinct from state.fearAndGreedData
        this.fearAndGreedFailureCount = 0;

        // NEW: Track scan cycle times for averaging
        this.scanCycleTimes = [];
        this.maxCycleTimeSamples = SCANNER_DEFAULTS.maxCycleTimeSamples;

        // Add: toggle to print to browser console (off by default)
        this.debugConsole = true;

        // NEW: Filter noisy console logs globally for known scanner tags (leave errors)
        if (typeof window !== 'undefined' && !window.__scannerConsoleFiltered) {
            window.__scannerConsoleFiltered = true;
            const origLog = console.log.bind(console);
            const origWarn = console.warn.bind(console);
            const bannedTags = [
                '[AutoScannerService]',
                '[AutoScanner]',
                '[POS_MON]',
                '[BATCH_OPEN]',
                '[BATCH_CLOSE]',
                '[RECONCILE]',
                '[PRICE_CONSOLIDATION]',
                '[SCAN_CYCLE]',
                '[HEARTBEAT]',
                '[GROUP_INDICATORS]',
                'EVALUATING_STRATEGY',
                'POSITION_CLOSING_DETECTION',
                '===== SCAN CYCLE',
                '⏱️ Scan cycle',
                '[PositionManager]',
                '[MONITOR]'
            ];

            console.log = (...args) => {
                try {
                    const first = args[0];
                    if (typeof first === 'string' && bannedTags.some(tag => first.includes(tag))) {
                        return; // suppress known scanner debug logs
                    }
                } catch (_) { }
                origLog(...args);
            };

            console.warn = (...args) => {
                try {
                    const first = args[0];
                    if (typeof first === 'string' && bannedTags.some(tag => first.includes(tag))) {
                        return; // suppress noisy warnings from scanner tags
                    }
                } catch (_) { }
                origWarn(...args);
            };
        }

        // CRITICAL: Initialize services in correct order
        // 0. Initialize price cache first
        this.initializePriceCache();
        
        // 1. HeartbeatService first (no dependencies)
        this.heartbeatService = new HeartbeatService({
            getSessionId: () => this.sessionId,
            isLeaderProvider: () => {
                return this.state.leaderSessionId === this.sessionId && this.state.isRunning;
            },
            onStatus: (payload) => {
                try {
                    const snap = {
                        message: payload?.message,
                        level: payload?.level || "system",
                        data: payload?.data ? true : false,
                        error: payload?.error ? (payload?.error?.message || String(payload.error)) : null,
                        ts: new Date().toISOString(),
                    };
                    if (payload?.error) {
                        console.error("[HEARTBEAT] ", snap);
                    }
                } catch (_) { }
                this.addLog(`[HEARTBEAT] ${payload.message}`, payload.level || "system");
            },
            intervalMs: 25000,
        });

        // Defensive: Ensure send method is properly bound
        if (this.heartbeatService && typeof this.heartbeatService.send === 'function') {
            this.heartbeatService.send = this.heartbeatService.send.bind(this.heartbeatService);
        }

        // Defensive: Wrap heartbeat console logging
        if (this.heartbeatService && !this.heartbeatService.__consoleWrapped) {
            this.heartbeatService.__consoleWrapped = true;
            const __origStart = this.heartbeatService.start.bind(this.heartbeatService);
            const __origStop = this.heartbeatService.stop.bind(this.heartbeatService);

            this.heartbeatService.start = (...args) => {
                return __origStart(...args);
            };
            this.heartbeatService.stop = (...args) => {
                return __origStop(...args);
            };
        }

        // 2. Then SessionManager (depends on heartbeatService existing)
        this.sessionManager = new SessionManagerService(this);

        // 3. Configuration and Strategy services
        this.configurationService = new ConfigurationService(this);
        this.strategyManager = new StrategyManagerService(this);

        // 4. CRITICAL: Initialize PositionManager BEFORE SignalDetectionEngine
        this.positionManager = new PositionManager(this);

        // 5. THEN initialize SignalDetectionEngine (which depends on PositionManager)
        this.signalDetectionEngine = new SignalDetectionEngine(this);

        // 6. Finally, other services
        this.walletManagerService = initializeWalletManagerService(this);
        this.performanceMetricsService = new PerformanceMetricsService(this);
        this.tradeArchivingService = new TradeArchivingService(this);

        // 7. Core scanner services
        this.marketRegimeService = new MarketRegimeService(this);
        this.priceManagerService = new PriceManagerService(this);
        this.scanEngineService = new ScanEngineService(this);

        // 8. Additional services
        this.walletStateService = new WalletStateService(this);
        this.uiStateService = new UIStateService(this);
        this.lifecycleService = new LifecycleService(this);
        this.utilityService = new UtilityService(this);

        // Load state from storage after services are instantiated
        this._loadStateFromStorage();

        // Setup navigation handlers after services are instantiated
        this._setupNavigationHandlers();

        // Attach the open guard after services are instantiated
        this.attachRegimeOpenGuard();

        // Initialize historical performance from existing trades
        this._initializeHistoricalPerformance();

        // DEBUG: Add global console command for testing
        if (typeof window !== 'undefined') {
            window.startScanner = async () => {
                console.log('[DEBUG] 🚀 Starting scanner via console command...');
                const result = await this.start();
                console.log('[DEBUG] 🎯 Scanner start result:', result);
                return result;
            };
            
            window.resetScannerState = () => {
                console.log('[DEBUG] 🔄 Resetting scanner state...');
                
                // First, show what's currently in localStorage
                const currentState = localStorage.getItem(STORAGE_KEYS.scannerState);
                console.log('[DEBUG] 🔍 Current localStorage state:', currentState ? JSON.parse(currentState) : 'null');
                
                this.state.isRunning = false;
                this.state.isScanning = false;
                this.state.isInitializing = false;
                this.state.leaderSessionId = null;
                this._persistedRunningFlag = false;
                this._isAutoStartBlocked = false;
                
                // CRITICAL: Also clear the persisted state from localStorage
                try {
                    localStorage.removeItem(STORAGE_KEYS.scannerState);
                    console.log('[DEBUG] 🗑️ Cleared scanner state from localStorage');
                    
                    // Verify it's cleared
                    const clearedState = localStorage.getItem(STORAGE_KEYS.scannerState);
                    console.log('[DEBUG] ✅ Verification - localStorage after clear:', clearedState);
                } catch (error) {
                    console.warn('[DEBUG] ⚠️ Failed to clear localStorage:', error);
                }
                
                this.notifySubscribers();
                console.log('[DEBUG] ✅ Scanner state reset - UI should now show Start button');
                console.log('[DEBUG] 💡 State will persist after refresh now');
            };
            
            window.stopScanner = async () => {
                console.log('[DEBUG] 🛑 Stopping scanner via console command...');
                const result = await this.stop();
                console.log('[DEBUG] 🎯 Scanner stop result:', result);
                return result;
            };
            
        }

        // Add this non-breaking guard right after you create/update momentumBreakdown:
        if (this.state && this.state.momentumBreakdown && !this.state.momentumBreakdown.weightsPercents) {
            this.state.momentumBreakdown.weightsPercents = MOMENTUM_WEIGHTS_PERCENTS;
        }

        // Also, if you expose a getter, ensure percents are present:
        if (this.getState) {
            const _origGetState = this.getState.bind(this);
            this.getState = () => {
                const s = _origGetState();
                if (s && s.momentumBreakdown && !s.momentumBreakdown.weightsPercents) {
                    s.momentumBreakdown.weightsPercents = MOMENTUM_WEIGHTS_PERCENTS;
                }
                return s;
            };
        }

        // ADDED: Monkey-patch direct MarketAlert.create/bulkCreate to buffer while scanning
        // so any legacy direct SDK usage won't hit DB during scan
        (async () => {
            try {
                const { MarketAlert } = await import('@/api/entities');
                if (!MarketAlert.__originalCreate) {
                    MarketAlert.__originalCreate = MarketAlert.create;
                    MarketAlert.create = async (payload) => {
                        if (this.state?.isScanning) {
                            const { addMarketAlertToBuffer } = await import('@/components/utils/apiQueue');
                            addMarketAlertToBuffer(payload);
                            this.addLog('[MarketAlert] Buffered create during scan cycle', 'system');
                            throw new Error('Entity creation failed');
                        }
                        return MarketAlert.__originalCreate(payload);
                    };
                }
                if (!MarketAlert.__originalBulkCreate) {
                    MarketAlert.bulkCreate = async (records) => {
                        if (this.state?.isScanning && Array.isArray(records)) {
                            const { addMarketAlertToBuffer } = await import('@/components/utils/apiQueue');
                            records.forEach((r) => addMarketAlertToBuffer(r));
                            this.addLog(`[MarketAlert] Buffered bulkCreate (${records.length}) during scan cycle', 'system`);
                            throw new Error('Entity creation failed');
                        }
                        return MarketAlert.__originalBulkCreate(records);
                    };
                }
            } catch (_e) {
                // ignore patch errors silently, e.g., if MarketAlert entity is not found or already patched by another instance
            }
        })();

        if (typeof window !== 'undefined') {
            // Ensure we always have a stable sessionId for this tab BEFORE any session calls
            try {
                const key = 'scanner_session_id';
                let sid = sessionStorage.getItem(key);
                if (!sid) {
                    sid = `session_${generateTradeId()}`;
                    sessionStorage.setItem(key, sid);
                }
                this.setSessionId(sid);
            } catch (_e) {
                throw new Error('Failed to generate session ID');
            }

            window.autoScannerService = this;
            window.scannerService = this; // Also expose as scannerService for compatibility
        }

        AutoScannerService.instance = this;
    }

    /**
     * Initialize price cache with common symbols
     */
    async initializePriceCache() {
        try {
            await functions.initializePriceCache();
        } catch (error) {
            console.error('[AutoScannerService] ❌ Failed to initialize price cache:', error);
        }
    }

    // Add guard attachment and check methods
    attachRegimeOpenGuard() {
        try {
            if (!this.positionManager || this._openGuardAttached) return;

            const originalOpenFn = this.positionManager.openPositionsBatch?.bind(this.positionManager);
            if (typeof originalOpenFn !== 'function') {
                console.warn('[AutoScannerService] Cannot attach regime open guard: positionManager.openPositionsBatch is not a function.');
                return;
            }

            this.positionManager.openPositionsBatch = async (...args) => {
                // Evaluate guard at call-time so latest state is used
                const isBlocked = this._isTradingBlockedByRegime();
                if (isBlocked) {
                    // Best-effort logging into scanner logs if available
                    const msg = 'Downtrend block active — skipping opening new positions due to user configuration.';
                    try {
                        if (typeof this.addLog === 'function') {
                            this.addLog(msg, 'trade_blocked', { reason: 'downtrend_config' });
                        } else {
                            console.warn('[AutoScannerService] trade_blocked:', msg);
                        }
                    } catch (_e) {
                        // swallow
                    }
                    // Return a neutral result so callers proceed gracefully without opening trades
                    const signals = Array.isArray(args?.[0]) ? args[0] : [];
                    return { opened: 0, failed: 0, skipped: signals.length, reason: 'downtrend_block_active' };
                }
                return await originalOpenFn(...args);
            };

            this._openGuardAttached = true;
            console.log('[AutoScannerService] ✅ Regime open guard attached to PositionManager.');
        } catch (e) {
            console.warn('[AutoScannerService] ⚠️ attachRegimeOpenGuard failed:', e?.message || e);
        }
    }

    _isTradingBlockedByRegime() {
        try {
            const settings = this.state?.settings;
            const regime = this.state?.marketRegime;
            const enabled = !!settings?.blockTradingInDowntrend;
            if (!enabled) return false;
            const regimeName = _getRegimeNameSafe(regime);
            return regimeName === 'downtrend';
        } catch (_e) {
            console.error('[AutoScannerService] Error in _isTradingBlockedByRegime:', _e);
            return false;
        }
    }

    // ADDED: Expose wallet re-initialization method for external use (e.g., TradingModal)
    async reinitializeWalletFromBinance() {
        return this.walletStateService.reinitializeWalletFromBinance();
    }

    _formatCurrency(value) {
        return this.walletStateService._formatCurrency(value);
    }

    _formatPrice(value) {
        return this.walletStateService._formatPrice(value);
    }

    _setupNavigationHandlers() {
        return this.utilityService._setupNavigationHandlers();
    }

    _handleNavigationStart() {
        return this.utilityService._handleNavigationStart();
    }

    _handleNavigationEnd() {
        return this.utilityService._handleNavigationEnd();
    }

    // NEW: allow UI to block or allow the internal persisted auto-start
    setAutoStartBlocked(flag) {
        return this.utilityService.setAutoStartBlocked(flag);
    }

    setSessionId(id) {
        if (!this.sessionId) {
            this.sessionId = id;
            console.log(`[AutoScannerService] [SESSION] Session ID set: ${id}`);
        }
    }

    subscribeToWalletUpdates(callback) {
        this.walletSubscribers.push(callback);
        return () => {
            this.walletSubscribers = this.walletSubscribers.filter(sub => sub !== callback);
        };
    }

    notifyWalletSubscribers() {
        this.walletSubscribers.forEach(callback => {
            try {
                callback();
            } catch (error) {
            }
        });
    }

    setTradingMode(mode) {
        if (mode !== 'testnet' && mode !== 'live') {
            console.error(`[AutoScannerService] ❌ Invalid trading mode: ${mode}. Must be 'testnet' or 'live'`);
            return;
        }

        const oldMode = this.state.tradingMode;
        if (oldMode === mode) {
            return;
        }

        this.state.tradingMode = mode;
        console.log(`[AutoScannerService] 🔄 Trading mode changed from ${oldMode.toUpperCase()} to ${mode.toUpperCase()}. Re-initializing wallet...`);

        this.state.isInitialized = false;
        this.initialize().then(() => {
            console.log(`[AutoScannerService] ✅ Successfully switched to ${mode.toUpperCase()} mode.`);
            this.notifyWalletSubscribers();
            this.notifySubscribers();
        }).catch(error => {
            console.error(`[AutoScannerService] ❌ Failed to switch to ${mode.toUpperCase()} mode: ${error.message}`);
        });

        if (this.positionManager) {
            this.positionManager.setTradingMode(mode);
            // Notify PositionManager of trading mode change to reload exchange info
            if (typeof this.positionManager.onTradingModeChange === 'function') {
                this.positionManager.onTradingModeChange(mode, oldMode);
            }
        }

        this.notifySubscribers();
    }

    getTradingMode() {
        return this.state.tradingMode;
    }

    isLiveMode() {
        return this.state.tradingMode === 'live';
    }

    isTestnetMode() {
        return this.state.tradingMode === 'testnet';
    }

    _stopRunningState(options = {}) {
        console.log('[AutoScannerService] 🛑 Auto Scanner transitioning to stopped state.');

        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }

        this.state.isRunning = false;
        this.state.isScanning = false;
        this.state.nextScanTime = null;
        this.state.leaderSessionId = null;

        this.heartbeatService.stop();
        this.sessionManager.stopMonitoring();

        this._saveStateToStorage();
        this.notifySubscribers();
    }

    // DEPRECATE legacy immediate open; route via batch for safety/back-compat
    async _openPosition(combination, currentPrice, convictionScore, convictionDetails, cycleStats) {
        console.log('[AutoScannerService] [DEPRECATION] _openPosition called; routing via batch openPositionsBatch.');
        const res = await this.positionManager.openPositionsBatch([{ combination, currentPrice, convictionScore, convictionDetails }]);
        if (cycleStats && res?.opened) {
            cycleStats.positionsOpened = (cycleStats.positionsOpened || 0) + res.opened;
        }
        return (res?.opened || 0) > 0;
    }

    registerPriceUpdateCallback(callback) {
        this.priceUpdateCallback = callback;
        if (this.priceUpdateCallback && Object.keys(this.currentPrices).length > 0) {
            this.priceUpdateCallback(this.currentPrices);
        }
    }

    unregisterPriceUpdateCallback(callback) {
        if (this.priceUpdateCallback === callback) {
            this.priceUpdateCallback = null;
        }
    }

    // Helper: get current wallet state (CentralWalletStateManager only)
    _getCurrentWalletState() {
        return this.walletManagerService?.getCurrentWalletState();
    }

    // NEW: compute current balance allocated across open/trailing positions (current value basis)
    _getBalanceAllocatedInTrades() {
        const currentWalletState = this._getCurrentWalletState();
        const positions = (currentWalletState?.positions || []).filter(
            p => p && (p.status === 'open' || p.status === 'trailing')
        );
        let allocated = 0;
        for (const pos of positions) {
            const qty = Number(pos.quantity_crypto);
            const symbol = (pos.symbol || '').replace('/', '');
            const livePrice = Number(this.currentPrices?.[symbol]);

            // Use current market value instead of entry value for cap calculation
            if (Number.isFinite(qty) && qty > 0 && Number.isFinite(livePrice) && livePrice > 0) {
                allocated += qty * livePrice;
            } else {
                // Fallback to entry value if current price not available
                const entryValue = Number(pos.entry_value_usdt);
                if (Number.isFinite(entryValue) && entryValue > 0) {
                    allocated += entryValue;
                }
            }
        }
        return Number(allocated.toFixed(2));
    }

    _isRegimeCacheValid() {
        if (!this.regimeCache.lastCalculated || !this.regimeCache.regime) {
            return false;
        }

        const cacheAgeMs = Date.now() - this.regimeCache.lastCalculated;
        const cacheValidityMs = this.regimeCache.cacheValidityHours * 60 * 60 * 1000;

        return cacheAgeMs < cacheValidityMs;
    }

    async _getCachedOrCalculateRegime(forceCalculate = false) {
        const isCacheValid = this._isRegimeCacheValid();

        if (!forceCalculate && isCacheValid) {
            const cacheAgeMinutes = Math.round((Date.now() - this.regimeCache.lastCalculated) / (1000 * 60));
            console.log(`[AutoScannerService] [Regime] Using cached regime: ${this.regimeCache.regime.regime.toUpperCase()} (${(this.regimeCache.regime.confidence * 100).toFixed(1)}%) - Cache age: ${cacheAgeMinutes}min`);
            return this.regimeCache.regime;
        }

        try {
            await this._updateMarketRegime();

            this.regimeCache.regime = { ...this.state.marketRegime };
            this.regimeCache.lastCalculated = Date.now();

            const confidencePercent = (this.regimeCache.regime.confidence * 100).toFixed(1);
            console.log(`[AutoScannerService] [Regime] ✅ Fresh regime calculated and cached: ${this.regimeCache.regime.regime.toUpperCase()} (${confidencePercent}%)`);

            return this.regimeCache.regime;
        } catch (error) {
            console.error(`[AutoScannerService] [Regime] ❌ Failed to calculate regime: ${error.message}`);
            console.error(`[AutoScannerService] [Regime] ❌ Failed to calculate regime: ${error.message}`, 'error');
            return this.regimeCache.regime || { regime: 'neutral', confidence: 0.5 };
        }
    }

    async resetWalletAndRestart() {
        const modeText = this.isLiveMode() ? 'LIVE ACCOUNT' : 'TESTNET ACCOUNT';

        console.log(`[AutoScannerService] 🚨 ${modeText} RESET INITIATED. ${this.isLiveMode() ? 'Closing all live positions' : 'Closing all testnet positions'} for a clean slate.`);

        if (this.isHardResetting) {
            console.warn('[AutoScannerService] Reset already in progress. Aborting new request.');
            return;
        }
        this.isHardResetting = true;

        try {
            if (this.state.isRunning) {
                this.stop();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`[AutoScannerService] 🔥 Clearing local state and database records for ${modeText}...`);

            // Step 1: Purge all LivePosition records
            console.log(`[AutoScannerService] [RESET] Purging all LivePosition records for ${this.state.tradingMode.toUpperCase()} mode...`);

            try {
                const purgeResponse = await queueFunctionCall(
                    'purgeAllPositions',
                    { mode: this.state.tradingMode },
                    'critical',
                    null,
                    0,
                    60000
                );

                if (purgeResponse?.data?.success) {
                    console.log(`[AutoScannerService] [RESET] ✅ Purged ${purgeResponse.data.deletedCount} LivePosition records for ${this.state.tradingMode.toUpperCase()} mode.`);
                } else {
                    console.warn(`[AutoScannerService] [RESET] ⚠️ LivePosition purge had issues: ${purgeResponse?.data?.error || 'Unknown error'}. Continuing with reset.`);
                }
            } catch (purgeError) {
                console.error('[AutoScannerService] ❌ Error purging positions:', purgeError);
                console.warn(`[AutoScannerService] [RESET] ⚠️ Failed to purge LivePositions: ${purgeError.message}. Continuing with reset.`);
            }

            // Step 2: Regular wallet reset (clears trades, wallet state, etc.)
            const purgeResult = await this.walletManagerService.resetWalletData(this.getTradingMode());

            if (purgeResult?.success) {
                console.log(`[AutoScannerService] ✅ Server-side managed data cleared for ${this.state.tradingMode.toUpperCase()} mode. Wallets: ${purgeResult.walletsDeleted}, Trades: ${purgeResult.tradesDeleted}`);
            } else {
                console.warn(`[AutoScannerService] ⚠️ Could not clear server-side data: ${purgeResult?.error?.message || 'Unknown error'}. Continuing with reset.`);
            }

            // Step 3: Clear API queue cache
            apiQueue.clearCache();

            // Step 4: Reinitialize wallet from Binance
            await this.walletManagerService.initializeLiveWallet();

            // Step 5: Reset stats and state
            this.state.stats = {
                activeStrategies: this.state.activeStrategies.length,
                totalScans: 0, signalsFound: 0, tradesExecuted: 0, totalPnL: 0, successRate: 0,
                averageSignalStrength: 0,
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            };
            this.scanCycleTimes = [];
            this.state.logs.activity = [];
            this.performanceMetricsService.resetState();
            this.tradeArchivingService.resetState();
            this.currentPrices = {};
            this.state.momentumBreakdown = null;
            this.state.signalGenerationHistory = [];
            this.state.marketVolatility = { adx: 25, bbw: 0.1 };
            this.state.fearAndGreedData = null;
            this.state.marketAlerts = [];
            this.state.newPositionsCount = 0; // Reset new positions count
            this.state.adjustedBalanceRiskFactor = 100; // Reset adjusted risk factor

            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 🔄 ${modeText} RESET COMPLETED`);
            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 💰 ${modeText} refreshed from Binance (Wallet ID: ${this._getCurrentWalletState()?.id}).`);
            console.log('[AutoScannerService] Scanner is ready for a fresh start with clean position tracking.');
            console.log('════════════════════════════════════════════════════════════');

            await this.walletManagerService.updateWalletSummary(this._getCurrentWalletState(), this.currentPrices);
            this.notifyWalletSubscribers();
            this.notifySubscribers();

            console.log(`[AutoScannerService] 🚀 Restarting scanner in ${this.state.tradingMode.toUpperCase()} mode...`);
            await this.start();

            if (this.toast) {
                this.toast({
                    title: `${modeText} Reset Complete`,
                    description: `${modeText} has been re-synced with Binance. Scanner is now active with clean position tracking.`
                });
            }
        } catch (error) {
            console.error('[AutoScannerService] ❌ resetWalletAndRestart error:', error);
            console.error('[AutoScannerService] Error stack:', error.stack);
            console.error(`[AutoScannerService] ❌ CRITICAL FAILURE during ${modeText.toLowerCase()} reset: ${error.message}`);
            if (this.toast) {
                this.toast({
                    title: "Reset Failed",
                    description: `Failed to reset ${modeText.toLowerCase()}: ${error.message}`,
                    variant: "destructive"
                });
            }
        } finally {
            this.isHardResetting = false;
        }
    }

    subscribe(callback) {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== callback);
        };
    }

    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
            }
        });
    }

    registerToastNotifier(toastFunction) {
        this.toast = toastFunction;
    }

    _saveStateToStorage() {
        try {
            if (typeof window === 'undefined') return;
            const stateToSave = {
                isRunning: this.state.isRunning,
                tradingMode: this.state.tradingMode,
                // NEW: persist market regime streak/state
                marketRegimeState: this.state.marketRegime
                    ? {
                        regime: this.state.marketRegime.regime,
                        confidence: this.state.marketRegime.confidence,
                        isConfirmed: this.state.marketRegime.isConfirmed,
                        consecutivePeriods: this.state.marketRegime.consecutivePeriods,
                        confirmationThreshold: this.state.marketRegime.confirmationThreshold,
                        regimeHistory: Array.isArray(this.state.marketRegime.regimeHistory)
                            ? this.state.marketRegime.regimeHistory.slice(-20) // cap history length
                            : []
                    }
                    : null,
                // NEW: persist scan cycle statistics
                scanCycleStats: {
                    totalScanCycles: this.state.stats?.totalScanCycles || 0,
                    averageScanTimeMs: this.state.stats?.averageScanTimeMs || 0,
                    lastScanTimeMs: this.state.stats?.lastScanTimeMs || 0,
                    totalScans: this.state.stats?.totalScans || 0 // ADDED: Persist totalScans
                }
            };
            localStorage.setItem(STORAGE_KEYS.scannerState, JSON.stringify(stateToSave));
        } catch (error) {
            console.error('[AutoScannerService] Failed to save scanner state to localStorage.', error);
        }
    }

    /**
     * Initialize historical performance from existing trades
     * Loads historical regime performance data on startup
     */
    async _initializeHistoricalPerformance() {
        try {
            // Import the initialization function
            const { initializeHistoricalPerformanceFromTrades } = await import('@/components/utils/unifiedStrengthCalculator');
            
            // Initialize historical performance (non-blocking, don't wait)
            initializeHistoricalPerformanceFromTrades().catch(error => {
                console.warn('[AutoScannerService] ⚠️ Failed to initialize historical performance:', error.message);
                // Don't throw - allow scanner to continue without historical data
            });
        } catch (error) {
            console.warn('[AutoScannerService] ⚠️ Failed to import historical performance initializer:', error.message);
            // Don't throw - allow scanner to continue
        }
    }

    _loadStateFromStorage() {
        try {
            if (typeof window === 'undefined') return;
            const savedStateJSON = localStorage.getItem(STORAGE_KEYS.scannerState);
            console.log('[AutoScannerService] 🔍 Loading state from storage:', {
                hasSavedState: !!savedStateJSON,
                savedStateContent: savedStateJSON ? JSON.parse(savedStateJSON) : null
            });
            
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                if (typeof savedState.isRunning === 'boolean') {
                    // NEW: Keep a flag instead of flipping state.isRunning now.
                    this._persistedRunningFlag = savedState.isRunning;
                    console.log('[AutoScannerService] 🔍 Set persisted running flag:', this._persistedRunningFlag);
                    if (this._persistedRunningFlag) {
                        console.log('[AutoScannerService] Loaded persisted state: Scanner was marked RUNNING in previous session.');
                    }
                } else {
                    console.log('[AutoScannerService] 🔍 No isRunning flag in saved state, _persistedRunningFlag remains:', this._persistedRunningFlag);
                }
                if (savedState.tradingMode === 'testnet' || savedState.tradingMode === 'live') {
                    this.state.tradingMode = savedState.tradingMode;
                    console.log(`[AutoScannerService] Loaded persisted state: Trading mode set to ${this.state.tradingMode.toUpperCase()}.`);
                } else if (savedState.tradingMode === 'demo') {
                    this.state.tradingMode = 'testnet';
                    console.log(`[AutoScannerService] Migrated persisted state: Demo mode converted to TESTNET mode.`);
                }

                // NEW: restore market regime state (streak)
                if (savedState.marketRegimeState) {
                    this.state.marketRegime = {
                        regime: savedState.marketRegimeState.regime || 'neutral',
                        confidence: typeof savedState.marketRegimeState.confidence === 'number'
                            ? savedState.marketRegimeState.confidence
                            : 0.5,
                        isConfirmed: !!savedState.marketRegimeState.isConfirmed,
                        consecutivePeriods: savedState.marketRegimeState.consecutivePeriods || 0,
                        confirmationThreshold: savedState.marketRegimeState.confirmationThreshold || 3,
                        regimeHistory: Array.isArray(savedState.marketRegimeState.regimeHistory)
                            ? savedState.marketRegimeState.regimeHistory
                            : []
                    };
                    // seed cache to avoid showing "awaiting" right on reload
                    this.regimeCache.regime = { ...this.state.marketRegime };
                    this.regimeCache.lastCalculated = Date.now();
                    console.log('[AutoScannerService] [Regime] Restored regime streak from previous session.');
                }

                // NEW: restore scan cycle statistics
                if (savedState.scanCycleStats) {
                    this.state.stats.totalScanCycles = savedState.scanCycleStats.totalScanCycles || 0;
                    this.state.stats.averageScanTimeMs = savedState.scanCycleStats.averageScanTimeMs || 0;
                    this.state.stats.lastScanTimeMs = savedState.scanCycleStats.lastScanTimeMs || 0;
                    this.state.stats.totalScans = savedState.scanCycleStats.totalScans || 0; // ADDED: Load totalScans
                    if (this.state.stats.totalScanCycles > 0) {
                        console.log(`[AutoScannerService] [CycleStats] Restored ${this.state.stats.totalScanCycles} scan cycles (${this.state.stats.totalScans} scans) from previous session (avg: ${(this.state.stats.averageScanTimeMs / 1000).toFixed(2)}s)`);
                    }
                }
            }
        } catch (error) {
            console.error('[AutoScannerService] Failed to load scanner state to localStorage.', error);
        }
    }

    addLog(message, type = 'info', data = null) {
        let msg = typeof message === 'string' ? message.replace(/\$undefined/g, '$0.00') : message;

        // Determine console method based on type
        let consoleMethod = console.log;
        let prefix = '[AutoScanner] ';
        if (type === 'error') {
            consoleMethod = console.error;
            prefix += 'ERROR: ';
        } else if (type === 'warning' || type === 'warn') {
            consoleMethod = console.warn;
            prefix += 'WARN: ';
        } else if (type === 'success' || type === 'start') {
            prefix += 'INFO: ';
        } else if (type === 'system' || type === 'info') {
            prefix += 'INFO: ';
        } else if (type === 'cycle') {
            prefix += 'CYCLE: ';
        } else if (type === 'regime_info') {
            prefix += 'REGIME_INFO: ';
        } else if (type === 'regime_confidence_filter') {
            prefix += 'REGIME_FILTER: ';
        } else if (type === 'trade_blocked') { // NEW: Handle trade_blocked type
            consoleMethod = console.warn;
            prefix += 'TRADE_BLOCKED: ';
        }
        else if (type === 'scan') {
            prefix += 'SCAN: ';
        } else {
            prefix += `${type.toUpperCase()}: `;
        }

        // CHANGED: do not spam browser console unless explicitly enabled or for errors
        if (this.debugConsole || type === 'error' || type === 'trade_blocked') {
            if (data) {
                consoleMethod(`${prefix}${msg}`, data);
            } else {
                consoleMethod(`${prefix}${msg}`);
            }
        }

        let sanitizedData = null;

        if (data && typeof data === 'object') {
            sanitizedData = {};

            const safeProps = ['strategy', 'level', 'error', 'symbol', 'strength', 'conviction_score', 'combined_strength', 'settings', 'keys', 'reason']; // Added 'reason'
            safeProps.forEach(prop => {
                if (data[prop] !== undefined) {
                    if (typeof data[prop] === 'string' || typeof data[prop] === 'number' || typeof data[prop] === 'boolean') {
                        sanitizedData[prop] = data[prop];
                    } else if (prop === 'settings' && Array.isArray(data[prop])) {
                        sanitizedData[prop] = data[prop].map(s => ({ type: s.type, enabled: s.enabled, period: s.period }));
                    } else if (prop === 'keys' && Array.isArray(data[prop])) {
                        sanitizedData[prop] = data[prop];
                    }
                }
            });

            if (data.strategy && typeof data.strategy === 'object' && data.strategy.combinationName) {
                sanitizedData.strategy = data.strategy.combinationName;
            }

            if (Object.keys(sanitizedData).length === 0) {
                sanitizedData = null;
            }
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            message: msg,
            type,
            data: sanitizedData
        };

        this.state.logs.activity.unshift(logEntry);

        if (this.state.logs.activity.length > 1000) {
            this.state.logs.activity = this.state.logs.activity.slice(0, 1000);
        }

        // Safe call to notifySubscribers - only call if uiStateService exists
        if (this.uiStateService) {
            this.notifySubscribers();
        }
    }

    clearLogs() {
        this.state.logs.activity = [];
        console.log('[AutoScannerService] Logs cleared by user.');
    }

    forceResetState() {
        console.log('[AutoScannerService] 🚨 [CRITICAL] Forcing a complete state reset of the scanner service.');
        this.isHardResetting = true;

        this.stop();

        // NEW: clear persisted storage entirely
        if (typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEYS.scannerState);
            localStorage.removeItem(`walletSummaryCache_testnet`);
            localStorage.removeItem(`walletSummaryCache_live`);
        }

        this.state = {
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
            exchangeInfo: null,
            leaderSessionId: null,
            fearAndGreedData: null,
            marketAlerts: [],
            newPositionsCount: 0,
            adjustedBalanceRiskFactor: 100,
        };

        this.currentPrices = {};
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;
        this._persistedRunningFlag = false; // Reset this too on hard reset
        this._isAutoStartBlocked = false; // Reset this too on hard reset
        this.scanCycleTimes = []; // Reset scan cycle times on hard reset
        
        // OPTIMIZATION: Performance throttling to prevent excessive computations
        this._lastHeavyComputationTime = 0;
        this._heavyComputationThrottleMs = 100; // Minimum 100ms between heavy computations
        this._openGuardAttached = false; // Reset the guard flag

        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.scanInterval = null;
        this.countdownInterval = null;

        this.sessionManager.stopMonitoring();
        this.heartbeatService.stop();
        this.performanceMetricsService.resetState();
        // UPDATED: Reset TradeArchivingService state
        this.tradeArchivingService.resetState();

        this._loadStateFromStorage();

        console.log('[AutoScannerService] ✅ Scanner service state has been fully reset.');
        this.notifySubscribers();
        this.notifyWalletSubscribers();

        setTimeout(() => {
            this.isHardResetting = false;
        }, 500);
    }


    async initialize() {
        if (!this.lifecycleService) {
            console.error('[AutoScannerService] ❌ lifecycleService is not initialized!');
            return false;
        }

        if (!this.lifecycleService.initialize) {
            console.error('[AutoScannerService] ❌ lifecycleService.initialize method is not available!');
            return false;
        }
        
        const result = await this.lifecycleService.initialize();
        return result;
    }


    _initializeWidgetDefaults() {
        // Initialize Fear & Greed Index with default values for immediate display
        if (!this.state.fearAndGreedData) {
            this.state.fearAndGreedData = {
                value: 50, // Neutral value
                value_classification: "Neutral",
                timestamp: Date.now(),
                time_until_update: "Loading..."
            };
        }

        // Initialize Performance Momentum with default values for immediate display
        if (!this.state.performanceMomentum) {
            this.state.performanceMomentum = {
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
        this.notifySubscribers();
    }

    async start() {
        console.warn('[AutoScannerService] ⚠️ DEPRECATED: Use LifecycleService.start() instead of AutoScannerService.start()');
        // console.log('[AutoScannerService] start() called');
        // console.log('[AutoScannerService] Attempting to start scanner and claim leadership...');
        const result = await this.sessionManager.start();
        if (result) {
            // console.log('[AutoScannerService] Scanner started successfully');
        } else {
            console.warn('[AutoScannerService] Scanner start failed or leadership not claimed.');
        }
        return result;
    }

    async stop() {
        console.log('[AutoScannerService] stop() called');
        console.log('[AutoScannerService] Attempting to stop scanner and release leadership...');
        const result = await this.sessionManager.stop();
        if (result) {
            console.log('[AutoScannerService] Scanner stopped successfully');
        } else {
            console.warn('[AutoScannerService] Scanner stop failed.');
        }
        return result;
    }

    forceStop() {
        console.log('[AutoScannerService] Initiating force stop and leadership release...');
        return this.sessionManager.forceStop();
    }

    restart() {
        console.log('[AutoScannerService] 🔄 Restarting scanner...');

        try {
            this.stop();

            return new Promise(resolve => setTimeout(async () => {
                this.state.stats.totalScans = 0;
                this.state.stats.totalScanCycles = 0; // Reset total scan cycles on restart
                this.scanCycleTimes = []; // Reset cycle times on restart

                const initResult = await this.initialize();
                if (!initResult) {
                    console.error('[AutoScannerService] ❌ Failed to initialize scanner during restart.');
                    resolve(false);
                    return;
                }

                const startResult = await this.start();

                if (startResult) {
                    console.log('[AutoScannerService] ✅ Scanner restarted successfully.');
                } else {
                    console.error('[AutoScannerService] ❌ Failed to start scanner after initialization during restart.');
                }
                resolve(startResult);
            }, 500));
        } catch (error) {
            console.error(`[AutoScannerService] ❌ Error during scanner restart: ${error.message}`, error);
            return Promise.resolve(false);
        }
    }

    // REMOVED: Duplicate countdown implementation - now delegated to LifecycleService

    async _fetchFearAndGreedIndex() { // Marked async to allow await
        const now = Date.now();
        
        console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Starting Fear & Greed Index fetch...');
        console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Time since last fetch:', now - this.lastFearAndGreedFetch, 'ms');
        console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Fetch interval:', this.fearAndGreedFetchInterval, 'ms');
        
        if (now - this.lastFearAndGreedFetch < this.fearAndGreedFetchInterval) {
            console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Skipping fetch - too soon since last fetch');
            return;
        }
        this.lastFearAndGreedFetch = now;

        try {
            console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Calling getFearAndGreedIndex directly (bypassing queue)...');
            const response = await getFearAndGreedIndex();
            console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Direct call response:', response);
            
            if (response.data && response.data.data && response.data.data.length > 0) {
                const fngData = response.data.data[0];
                console.log('[AutoScannerService] [_fetchFearAndGreedIndex] Successfully fetched F&G data:', fngData);
                
                // Store in both locations for compatibility
                this.fearAndGreedData = fngData;
                this.state.fearAndGreedData = fngData;

                if (this.fearAndGreedFailureCount > 0) {
                    this.fearAndGreedFailureCount = 0;
                }

                // Notify subscribers of state change
                this.notifySubscribers();
            } else {
                console.error('[AutoScannerService] [_fetchFearAndGreedIndex] Invalid response structure:', response);
                throw new Error('Invalid response structure from Fear & Greed API');
            }
        } catch (error) {
            console.error('[AutoScannerService] [_fetchFearAndGreedIndex] Error details:', error);
            console.error('[AutoScannerService] [_fetchFearAndGreedIndex] Error stack:', error.stack);
            
            this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;

            if (this.fearAndGreedFailureCount === 1) {
                console.warn('[AutoScannerService] [F&G Index] ⚠️ Unable to fetch Fear & Greed Index - continuing without it');
            } else if (this.fearAndGreedFailureCount === 5) {
                console.warn('[AutoScannerService] [F&G Index] ⚠️ Multiple F&G fetch failures - will retry silently');
            }

            throw new Error('Failed to fetch Fear & Greed Index');

            // Notify subscribers of state change
            this.notifySubscribers();
        }
    }


    // REPLACED: Legacy method removed from AutoScannerService.
    // All monitoring/closing is handled by PositionManager.monitorAndClosePositions.
    monitorAndClosePositions() {
        console.log('[AutoScannerService] [DEPRECATION] monitorAndClosePositions in AutoScannerService is deprecated; handled by PositionManager.monitorAndClosePositions.');
        return;
    }

    // REPLACED: Legacy method removed from AutoScannerService.
    // Trailing stop updates are handled by PositionManager.
    _updateTrailingStops(prices) {
        console.log('[AutoScannerService] [DEPRECATION] _updateTrailingStops in AutoScannerService is deprecated; handled by PositionManager.');
        return;
    }

    /**
     * Helper method to detect market regime and fetch F&G index.
     * @returns {object|null} An object containing regime and confidence, or null on failure.
     */
    async _detectMarketRegime() {
        if (this.isHardResetting) return null;

        try {
            const cachedRegime = await this._getCachedOrCalculateRegime(); // This updates this.state.marketRegime
            await this._fetchFearAndGreedIndex(); // This updates this.state.fearAndGreedData

            if (this.state.marketRegime) {
                return {
                    regime: this.state.marketRegime.regime,
                    confidence: Math.max(0, Math.min(100, this.state.marketRegime.confidence * 100)) // Return as percentage, clamped
                };
            }
            return null;
        } catch (error) {
            console.error(`[AutoScannerService] [Regime Detection] ❌ Failed to determine market regime or F&G: ${error.message}`, error);
            return null;
        }
    }

    // REMOVED: Legacy _consolidatePrices implementation - now delegated to priceManagerService

    /**
     * Helper method to load active strategies.
     * OPTIMIZED: Uses internal method for faster loading without external dependencies.
     * @returns {Array} List of active strategies.
     */
    async _loadStrategies() {
        console.log('[AutoScannerService] 📋 Loading strategies...');

        // OPTIMIZATION: Use internal method to avoid duplicate database calls
        const strategies = await this.strategyManager._loadAndFilterStrategiesInternal();

        // CRITICAL FIX: Build activeStrategies map for PositionManager lookups
        const activeStrategiesMap = new Map();
        strategies.forEach(strategy => {
            if (strategy.combinationName) {
                activeStrategiesMap.set(strategy.combinationName, strategy);
            }
        });

        // CRITICAL: Ensure PositionManager has access to the activeStrategies map
        if (this.positionManager) {
            this.positionManager.activeStrategies = activeStrategiesMap;
            console.log(`[AutoScannerService] ✅ Updated PositionManager with ${activeStrategiesMap.size} strategies`);
        }

        // Fix: Ensure SignalDetectionEngine is updated with the latest strategies
        if (this.signalDetectionEngine && typeof this.signalDetectionEngine.updateStrategies === 'function') {
            this.signalDetectionEngine.updateStrategies(strategies);
            console.log(`[AutoScannerService] ✅ Updated SignalDetectionEngine with ${strategies.length} strategies`);
        }

        console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} strategies`);

        return strategies;
    }

    // REMOVED: Legacy _monitorPositions implementation - now delegated to scanEngineService


    // REMOVED: Legacy _evaluateStrategies implementation - now delegated to scanEngineService


    /**
     * Helper method to run the trade archiving process.
     */
    async _archiveOldTradesIfNeeded() {
        if (this.isHardResetting) return;
        await this.tradeArchivingService.runArchivingProcess();
    }

    /**
     * Helper method to update performance snapshots, wallet state, and log summaries.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _updatePerformanceSnapshotIfNeeded(cycleStats) {
        console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded CALLED =====');
        console.log('[AutoScannerService] Current trading mode:', this.state.tradingMode);

        if (this.isHardResetting) {
            console.log('[AutoScannerService] _updatePerformanceSnapshotIfNeeded skipped due to hard reset.');
            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETE =====');
            return;
        }

        try {
            // 1. Update wallet summary
            console.log('[AutoScannerService] Updating wallet summary...');
            console.log('[AutoScannerService] Current wallet state before update:', {
                id: this._getCurrentWalletState()?.id,
                total_realized_pnl: this._getCurrentWalletState()?.total_realized_pnl,
                total_trades_count: this._getCurrentWalletState()?.total_trades_count
            });

            await this.walletManagerService.updateWalletSummary(
                this._getCurrentWalletState(),
                this.currentPrices || {}
            );

            console.log('[AutoScannerService] Wallet summary updated');
            console.log('[AutoScannerService] Current wallet state after update:', {
                id: this._getCurrentWalletState()?.id,
                total_realized_pnl: this._getCurrentWalletState()?.total_realized_pnl,
                total_trades_count: this._getCurrentWalletState()?.total_trades_count
            });

            // 2. NOTE: HistoricalPerformance snapshots removed - all analytics now pull directly from Trade table
            
            console.log('[AutoScannerService] Calculating performance momentum...');
            await this.performanceMetricsService.calculatePerformanceMomentum();

            console.log('[AutoScannerService] Persisting wallet changes...');
            await this.positionManager.persistWalletChangesAndWait();

            console.log('[AutoScannerService] Updating wallet summary again after persist...');
            await this.walletManagerService.updateWalletSummary(this._getCurrentWalletState(), this.currentPrices);

            // 3. Notify WalletProvider
            console.log('[AutoScannerService] Notifying wallet subscribers...');
            if (typeof this.notifyWalletSubscribers === 'function') {
                this.notifyWalletSubscribers();
            } else {
                console.warn('[AutoScannerService] ⚠️ notifyWalletSubscribers callback not registered');
            }

            console.log('[AutoScannerService] Persisting latest wallet summary...');
            await this._persistLatestWalletSummary();

            // Flush market alerts
            try {
                console.log('[AutoScannerService] Flushing market alert buffer...');
                const flushRes = await flushMarketAlertBuffer();
                if (flushRes?.created > 0) {
                    this.addLog(`[MarketAlert] Flushed ${flushRes.created} buffered alert(s)`, 'info');
                }
                console.log('[AutoScannerService] Market alert buffer flushed, result:', flushRes);
            } catch (e) {
                this.addLog(`[MarketAlert] ⚠️ Failed to flush alerts: ${e.message}`, 'warning');
            }

            // Report on trade archiving
            const lastArchivingReport = this.tradeArchivingService.getLastArchivingReport();
            if (lastArchivingReport) {
                this.addLog('──────────── 📦 ARCHIVING SUMMARY ────────────', 'cycle-end');
                const r = lastArchivingReport;
                if (r.success) {
                    this.addLog(`[ARCHIVING] ${r.message}`, 'info');
                    if (r.performance) {
                        const { totalMs = 0, fetchMs = 0, identifyMs = 0, deleteMs = 0 } = r.performance || {};
                        this.addLog(`[ARCHIVING_PERF] Total: ${totalMs.toFixed(0)}ms | Fetch: ${fetchMs.toFixed(0)}ms | Identify: ${identifyMs.toFixed(0)}ms | Delete: ${deleteMs.toFixed(0)}ms`, 'info');
                    }
                    if (typeof r.remainingCount === 'number') {
                        this.addLog(`[ARCHIVING] Remaining trades (approx): ${r.remainingCount} | More to process: ${r.moreToProcess ? 'Yes' : 'No'}`, 'info');
                    }
                } else {
                    this.addLog(`[ARCHIVING] ❌ ${r.error || 'Archiving failed.'}`, 'error');
                    if (r.performance) {
                        const { totalMs = 0, fetchMs = 0, identifyMs = 0, deleteMs = 0 } = r.performance || {};
                        this.addLog(`[ARCHIVING_PERF] Total: ${totalMs.toFixed(0)}ms | Fetch: ${fetchMs.toFixed(0)}ms | Identify: ${identifyMs.toFixed(0)}ms | Delete: ${deleteMs.toFixed(0)}ms`, 'error');
                    }
                }
                this.addLog('──────────────────────────────────────────────', 'cycle-end');
            }

            // Refresh market alert cache
            try {
                console.log('[AutoScannerService] Refreshing market alert cache...');
                await refreshMarketAlertCache({ limit: 10, timeoutMs: 10000 });
                this.state.marketAlerts = getMarketAlertCache();
                this.addLog(`[MarketAlerts] Cache refreshed. ${this.state.marketAlerts.length} alerts loaded.`, 'info');
            } catch (e) {
                this.addLog(`[MarketAlerts] ⚠️ Failed to refresh alerts: ${e.message}`, 'warning');
            }

            // Update price callback
            if (this.priceUpdateCallback && Object.keys(this.currentPrices).length > 0) {
                console.log('[AutoScannerService] Calling priceUpdateCallback...');
                this.priceUpdateCallback(this.currentPrices);
            } else {
                console.log('[AutoScannerService] priceUpdateCallback not set or no current prices.');
            }

            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETED SUCCESSFULLY =====');

        } catch (error) {
            console.error('[AutoScannerService] ❌ Error in _updatePerformanceSnapshotIfNeeded:', error);
            console.error('[AutoScannerService] Error stack:', error.stack);
            this.addLog(`Error updating performance snapshot: ${error.message}`, 'error', error);
            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETED WITH ERROR =====');
            throw error;
        }
    }


    _updateCurrentPrices(pricesData) {
        if (pricesData && typeof pricesData === 'object') {
            this.currentPrices = pricesData;
        }
    }

    async _sendTelegramNotification(type, data) {
        if (!this.telegramSettings.token || !this.telegramSettings.chat_id) {
            console.warn('[AutoScannerService] Telegram notification skipped: Bot token or chat ID not configured.');
            return;
        }

        let message = '';
        switch (type) {
            case 'TRADE_CLOSED':
                message = `📈 *Trade Closed!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `P&L: ${data.pnl >= 0 ? '✅' : '❌'} $${data.pnl.toFixed(2)} (${data.pnlPercentage.toFixed(2)}%)%0A` +
                    `Exit Reason: ${data.exitReason.replace(/_/g, ' ')}%0A` +
                    `Duration: ${data.duration} mins`;
                break;
            case 'TRADE_OPENED':
                message = `✅ *Trade Opened!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `Entry Price: $${data.entry_price.toFixed(4)}%0A` +
                    `Size: $${data.entry_value_usdt.toFixed(2)} USDT%0A` +
                    `Conviction: ${data.conviction_score.toFixed(1)}`;
                break;
            default:
                message = `*AutoScanner Update:* ${JSON.stringify(data)}`;
                break;
        }

        const url = `https://api.telegram.org/bot${this.telegramSettings.token}/sendMessage`;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.telegramSettings.chat_id,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });
            console.log(`[AutoScannerService] Telegram notification sent successfully.`);
        } catch (error) {
            console.error(`[AutoScannerService] Failed to send Telegram notification: ${error.message}`);
        }
    }

    getWalletStateHistory() {
        return this.positionManager ? this.positionManager.getWalletStateHistory() : [];
    }

    async _logCycleSummary(cycleStats) {
        if (!this.state.isRunning) {
            return;
        }

        const signalsFound = cycleStats.combinationsMatched;
        const tradesExecuted = cycleStats.positionsOpened;
        this.addLog(`✅ Scan cycle complete: ${signalsFound} signals found, ${tradesExecuted || 0} trades executed.`, 'cycle');
        this.addLog('', 'cycle');

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        if (this.state.momentumBreakdown) {
            const { signalQuality, fearAndGreed, opportunityRate, volatility, regime, unrealized, realized } = this.state.momentumBreakdown;

            this.addLog(`• Unrealized P&L: ${unrealized.score.toFixed(0)} (Wt: ${(unrealized.weight * 100).toFixed(0)}%)`, 'cycle');
            this.addLog(`• Realized P&L: ${realized.score.toFixed(0)} (Wt: ${(realized.weight * 100).toFixed(0)}%)`, 'cycle');

            const marketRegime = this.state.marketRegime?.regime || 'unknown';
            const regimeConfidence = (this.state.marketRegime?.confidence * 100)?.toFixed(0) || 'N/A';
            this.addLog(`• Market Regime: ${regime.score.toFixed(0)} (Wt: ${(regime.weight * 100).toFixed(0)}%) (${marketRegime} (${regimeConfidence}%))`, 'cycle');

            const adxValue = this.state.marketVolatility.adx?.toFixed(1) || 'N/A';
            const bbwValue = (this.state.marketVolatility.bbw * 100)?.toFixed(1) || 'N/A';
            this.addLog(`• Market Volatility: ${volatility.score.toFixed(0)} (Wt: ${(volatility.weight * 100).toFixed(0)}%) (ADX: ${adxValue}, BBW: ${bbwValue}%)`, 'cycle');

            const recentSignalCount = this.state.signalGenerationHistory.slice(-1)[0]?.signalsFound || 0;
            this.addLog(`• Opportunity Rate: ${opportunityRate.score.toFixed(0)} (Wt: ${(opportunityRate.weight * 100).toFixed(0)}%) (${recentSignalCount} recent signals)`, 'cycle');

            const fearGreedValue = this.state.fearAndGreedData?.value || 'N/A';
            const fearGreedClassification = this.state.fearAndGreedData?.value_classification || 'N/A';
            this.addLog(`• Fear & Greed: ${fearAndGreed.score.toFixed(0)} (Wt: ${(fearAndGreed.weight * 100).toFixed(0)}%) (F&G: ${fearGreedValue} (${fearGreedClassification}))`, 'cycle');

            // Only log Signal Quality if its weight is not 0
            if (signalQuality.weight > 0) {
                const avgStrength = this.state.stats?.averageSignalStrength || 0;
                this.addLog(`• Signal Quality: ${signalQuality.score.toFixed(0)} (Wt: ${(signalQuality.weight * 100).toFixed(0)}%) (${avgStrength.toFixed(0)} avg strength)`, 'cycle');
            }

        } else {
            this.addLog(`• Performance metrics: Awaiting initial calculation...`, 'cycle');
        }

        const performanceMomentumScore = this.state.performanceMomentumScore;
        if (typeof performanceMomentumScore === 'number') {
            this.addLog(`📊 Performance Momentum Score: ${performanceMomentumScore.toFixed(0)}`, 'cycle');
        } else {
            this.addLog(`📊 Performance Momentum Score: Awaiting initial calculation...`, 'cycle');
        }
        if (typeof this.state.adjustedBalanceRiskFactor === 'number') {
            this.addLog(`📈 Adjusted Balance Risk Factor: ${this.state.adjustedBalanceRiskFactor.toFixed(0)}% (Max configured: ${this.state.settings?.maxBalancePercentRisk || 100}%)`, 'cycle');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        try {
            if (!this.walletManagerService.walletSummary || !this._getCurrentWalletState() || !this.walletManagerService.walletSummary.lastUpdated || (Date.now() - new Date(this.walletManagerService.walletSummary.lastUpdated).getTime() > 10000)) {
                await this.walletManagerService.initializeLiveWallet();
                await this.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.currentPrices
                );
                await this._persistLatestWalletSummary();
            } else {
                await this.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.currentPrices
                );
                await this._persistLatestWalletSummary();
            }
        } catch (walletError) {
            this.addLog(`[WALLET] ⚠️ Wallet refresh failed for logging: ${walletError.message}`, 'warning');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
        this.addLog('🏦 WALLET SUMMARY', 'cycle');
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        this._logWalletSummary();

        const totalBlocked = Object.values(cycleStats.blockReasons || {}).reduce((sum, count) => sum + count, 0);

        if (totalBlocked > 0) {
            const convictionBlocks = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) => reason.toLowerCase().includes('conviction'))
                .reduce((sum, [, count]) => sum + count, 0);

            if (convictionBlocks > 0) {
                const minConvictionThreshold = this.state.settings?.minimumCombinedStrength || 50;
                this.addLog(`🚫 ${convictionBlocks} strategies blocked: Conviction score below threshold (${minConvictionThreshold})`, 'warning');
            }

            const sizeBlocks = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) => reason.toLowerCase().includes('calculated position size') || reason.toLowerCase().includes('is below minimum'))
                .reduce((sum, [, count]) => sum + count, 0);

            if (sizeBlocks > 0) {
                const minTradeValue = this.state.settings?.minimumTradeValue || 10;
                this.addLog(`🚫 ${sizeBlocks} strategies blocked: Calculated position size below minimum ($${minTradeValue})`, 'warning');
            }

            const otherBlockReasons = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) =>
                    !reason.toLowerCase().includes('conviction') &&
                    !reason.toLowerCase().includes('calculated position size') &&
                    !reason.toLowerCase().includes('is below minimum')
                );

            if (otherBlockReasons.length > 0) {
                const otherBlocksCount = otherBlockReasons.reduce((sum, [, count]) => sum + count, 0);
                if (otherBlocksCount > 0) {
                    this.addLog(`🚫 ${otherBlocksCount} strategies blocked for other reasons`, 'warning');
                }
            }
        } else {
            this.addLog(`🚫 Positions Blocked: 0`, 'info');
        }

        if (cycleStats.positionsOpened > 0) {
            this.addLog(`🚀 New Positions Opened: ${cycleStats.positionsOpened}`, 'success');
        } else if (cycleStats.combinationsMatched > 0) {
            this.addLog(`✅ Strategies Matches Found: ${cycleStats.combinationsMatched}`, 'info');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
        this.addLog('', 'system');
    }

    _logWalletSummary() {
        if (!this.walletManagerService?.walletSummary) {
            this.addLog('[WALLET] No wallet summary available', 'info', { level: 1 });
            return;
        }

        const summary = this.walletManagerService.walletSummary;
        const positions = this.positionManager?.positions || [];

        let unrealizedPnl = 0;
        for (const position of positions) {
            const symbol = position.symbol.replace('/', '');
            const currentPrice = this.currentPrices[symbol];
            if (currentPrice && position.entry_price) {
                const pnl = (currentPrice - position.entry_price) * position.quantity_crypto;
                unrealizedPnl += pnl;
            }
        }

        const realizedPnl = summary.totalRealizedPnl || 0;

        const formatCurrencyWithSign = (value) => {
            const absValue = Math.abs(value);
            const formatted = `$${absValue.toFixed(2)}`;
            if (value < 0) {
                return `-${formatted}`;
            } else if (value > 0) {
                return `+${formatted}`;
            }
            return formatted;
        };

        this.addLog(
            `[WALLET] Unrealized P&L: ${formatCurrencyWithSign(unrealizedPnl)} | Realized P&L: ${formatCurrencyWithSign(realizedPnl)}`,
            'info',
            { level: 1 }
        );

        this.addLog(
            `[WALLET] Open Positions: ${positions.length} | Portfolio Utilization: ${(summary.portfolioUtilization || 0).toFixed(1)}%`,
            'info',
            { level: 1 }
        );

        this.addLog(
            `[WALLET] Total Trades: ${summary.totalTradesCount || 0} | Win Rate: ${(summary.winRate || 0).toFixed(1)}% | Profit Factor: ${(summary.profitFactor || 0).toFixed(2)}`,
            'info',
            { level: 1 }
        );

        const modeText = this.state?.tradingMode?.toUpperCase() || 'UNKNOWN';
        this.addLog(`[WALLET] Mode: ${modeText} | Total Equity: ${this._formatCurrency(summary.totalEquity || 0)}`, 'cycle');
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
    }

    // DELEGATED: updateSettings now calls ConfigurationService.updateSettings
    async updateSettings(newSettings) {
        return this.configurationService.updateSettings(newSettings);
    }

    // DELEGATED: refreshStrategies now calls StrategyManagerService.refreshStrategies
    async refreshStrategies() {
        return this.strategyManager.refreshStrategies();
    }

    async _updateMarketRegime() {
        try {
            const symbol = 'BTCUSDT'; // Use Binance format (no slash)
            const timeframe = '4h';
            const klineLimit = 300;

            // NEW: Direct call to bypass API queue for better batching
            const response = await getKlineData({ symbols: [symbol], interval: timeframe, limit: klineLimit });

            const responseData = response.data;

            if (!responseData || typeof responseData !== 'object') {
                throw new Error('Invalid response data format from getKlineData');
            }

            const symbolData = responseData[symbol];
            if (!symbolData || symbolData.error) {
                throw new Error(`No valid data for ${symbol}: ${symbolData?.error || 'No data'}`);
            }

            const klineDataResponse = symbolData.data;

            if (!Array.isArray(klineDataResponse) || klineDataResponse.length < 50) {
                throw new Error(`Insufficient kline data: ${klineDataResponse?.length || 0} candles`);
            }

            const transformedKlines = klineDataResponse.map((kline, index) => {
                let transformed;
                if (Array.isArray(kline)) {
                    transformed = {
                        timestamp: kline[0],
                        open: parseFloat(kline[1]),
                        high: parseFloat(kline[2]),
                        low: parseFloat(kline[3]),
                        close: parseFloat(kline[4]),
                        volume: parseFloat(kline[5])
                    };
                } else if (kline && typeof kline === 'object') {
                    transformed = {
                        timestamp: kline.timestamp || kline.time || kline.openTime,
                        open: parseFloat(kline.open || kline.o),
                        high: parseFloat(kline.h || kline.high),
                        low: parseFloat(kline.l || kline.low),
                        close: parseFloat(kline.c || kline.close),
                        volume: parseFloat(kline.v || kline.volume)
                    };
                }

                const hasValidData = transformed &&
                    !isNaN(transformed.open) && !isNaN(transformed.high) &&
                    !isNaN(transformed.low) && !isNaN(transformed.close) &&
                    transformed.open > 0 && transformed.high > 0 &&
                    !isNaN(transformed.volume) &&
                    transformed.low > 0 && transformed.close > 0;

                return hasValidData ? transformed : null;
            }).filter(kline => kline !== null);

            if (transformedKlines.length < 50) {
                throw new Error(`Insufficient valid kline data after filtering: ${transformedKlines.length} candles`);
            }

            const coreRegimeSignalSettings = [
                { type: 'adx', enabled: true },
                { type: 'atr', enabled: true, period: 14 },
                { type: 'bbw', enabled: true },
                { type: 'ema', enabled: true },
                { type: 'sma', enabled: true, period: 20 },
                { type: 'ma200', enabled: true },
                { type: 'macd', enabled: true },
                { type: 'rsi', enabled: true },
                { type: 'obv', enabled: true },
                { type: 'volume_sma', enabled: true },
                { type: 'volume_roc', enabled: true }
            ];

            const fullIndicators = calculateAllIndicators(transformedKlines, coreRegimeSignalSettings, this.addLog.bind(this));

            const essentialIndicators = ['atr', 'adx', 'bbw', 'ema'];

            const smaAlternatives = ['sma', 'ma200', 'ma100', 'ma50'];
            const hasSma = smaAlternatives.some(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);

            if (!hasSma) {
                essentialIndicators.push('sma');
            }

            const calculatedIndicatorNames = Object.keys(fullIndicators).filter(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);
            const actuallyMissingIndicators = essentialIndicators.filter(ind => !calculatedIndicatorNames.includes(ind.split(' ')[0]));

            if (actuallyMissingIndicators.length > 0) {
                this.addLog(`[Regime] ⚠️ Missing essential indicators: ${actuallyMissingIndicators.join(', ')}`, 'warning');
            }

            const detector = new MarketRegimeDetector(transformedKlines, fullIndicators, true, this.addLog.bind(this));

            // NEW: seed detector with previously saved streak/history (if available)
            if (this.state.marketRegime && (Array.isArray(this.state.marketRegime.regimeHistory) || typeof this.state.marketRegime.consecutivePeriods === 'number')) {
                detector.restoreState({
                    regimeHistory: Array.isArray(this.state.marketRegime.regimeHistory) ? this.state.marketRegime.regimeHistory : [],
                    consecutivePeriods: typeof this.state.marketRegime.consecutivePeriods === 'number' ? this.state.marketRegime.consecutivePeriods : 0,
                    lastRegimeDetected: this.state.marketRegime.regime || null
                });
            }

            const regimeResult = detector.getRegime();
            const volatilityData = detector.getVolatilityData();

            // FIXED: Use confidencePct (percentage) instead of confidence (decimal)
            const resolvedConfidencePct = (typeof regimeResult.confidencePct === 'number'
                ? regimeResult.confidencePct
                : (typeof regimeResult.confidence === 'number' ? regimeResult.confidence * 100 : 50));


            this.state.marketRegime = {
                regime: regimeResult.regime,
                confidence: Math.max(0, Math.min(1, resolvedConfidencePct / 100)),
                isConfirmed: Boolean(regimeResult.isConfirmed),
                // ADDED: Include confirmation tracking data
                consecutivePeriods: regimeResult.consecutivePeriods || 0,
                confirmationThreshold: regimeResult.confirmationThreshold || 3,
                regimeHistory: regimeResult.regimeHistory || []
            };

            this.state.marketVolatility = {
                adx: volatilityData.adx.adx || 25,
                bbw: volatilityData.bbw || 0.1
            };

            // Persist the updated regime state so streak survives reloads
            this._saveStateToStorage();

            const userMinimum = this.state.settings?.minimumRegimeConfidence || 60;
            const wouldBlock = (this.state.marketRegime.confidence * 100) < userMinimum;

            // ADDED: Enhanced regime calculation logging with confirmation details
            const confidenceText = `${(this.state.marketRegime.confidence * 100).toFixed(1)}%`;
            const confirmationStatus = this.state.marketRegime.isConfirmed ? 'CONFIRMED' : 'DEVELOPING';
            const streakText = `${this.state.marketRegime.consecutivePeriods}/${this.state.marketRegime.confirmationThreshold}`;
            
            // Log regime performance (sampled: log every regime update, but only once per unique regime+confidence combination)
            const regimeKey = `${regimeResult.regime}_${Math.round(resolvedConfidencePct)}`;
            if (!this._regimePerformanceLogged) {
              this._regimePerformanceLogged = new Set();
            }
            if (!this._regimePerformanceLogged.has(regimeKey)) {
              this._regimePerformanceLogged.add(regimeKey);
              const volatilityInfo = `ADX: ${volatilityData.adx.adx?.toFixed(2) || 'N/A'}, BBW: ${volatilityData.bbw?.toFixed(4) || 'N/A'}`;
              //console.log(`[REGIME_PERFORMANCE] [SCANNER] Regime: ${regimeResult.regime}, Confidence: ${confidenceText}, Status: ${confirmationStatus}, Streak: ${streakText}, ${volatilityInfo}`);
            }

            this.addLog(`[REGIME_CALCULATION] 🎯 ${regimeResult.regime.toUpperCase()} detected with ${confidenceText} confidence`, 'info');
            this.addLog(`[REGIME_CALCULATION] 📊 Status: ${confirmationStatus} (${streakText} consecutive periods)`, 'info');

            if (this.state.marketRegime.regimeHistory?.length > 1) {
                const recentHistory = this.state.marketRegime.regimeHistory
                    .slice(-4) // Show last 4 periods
                    .map(h => h.regime.toUpperCase())
                    .join(' → ');
                this.addLog(`[REGIME_CALCULATION] 📈 Recent history: ${recentHistory}`, 'info');
            }

            if (wouldBlock) {
                this.addLog(`[REGIME_CALCULATION] ⚠️  BLOCKING: Strategies will be skipped due to low regime confidence`, 'warning');
            } else {
                this.addLog(`[REGIME_CALCULATION] ✅ ALLOWING: Regime confidence meets user threshold`, 'info');
            }

        } catch (error) {
            this.addLog(`[Regime] ❌ Could not update market regime: ${error.message}`, 'error', error);
            this.state.marketRegime = {
                regime: 'neutral',
                confidence: 0.5,
                isConfirmed: false,
                consecutivePeriods: 0,
                confirmationThreshold: 3,
                regimeHistory: []
            };
            this.addLog('[Regime] Falling back to NEUTRAL market regime due to error.', 'warning');
            throw error; // Propagate error
        }
    }

    // NEW: helper to persist the most recent WalletSummary for the current mode
    async _persistLatestWalletSummary() {
        try {
            if (typeof window === 'undefined') return;
            const mode = this.state?.tradingMode || 'testnet';
            const latest = await queueEntityCall('WalletSummary', 'filter', { mode }, '-lastUpdated', 1);
            if (Array.isArray(latest) && latest.length > 0) {
                const snapshot = latest[0];
                localStorage.setItem(`walletSummaryCache_${mode}`, JSON.stringify(snapshot));
                try {
                    window.__walletSummaryCache = snapshot;
                } catch (_e) {
                    // ignore, not critical
                }
            }
        } catch (_e) {
            // silent fail - not critical to block scanner
        }
    }

    getState() {
        return { ...this.state };
    }

    // ===== DELEGATION METHODS =====
    // These methods delegate to the appropriate services

    // Wallet State Service Delegations
    async reinitializeWalletFromBinance() {
        return this.walletStateService.reinitializeWalletFromBinance();
    }

    _getAvailableUsdt() {
        return this.walletStateService._getAvailableUsdt();
    }

    _getBalanceAllocatedInTrades() {
        return this.walletStateService._getBalanceAllocatedInTrades();
    }

    async resetWalletAndRestart() {
        return this.walletStateService.resetWalletAndRestart();
    }

    async _persistLatestWalletSummary() {
        return this.walletStateService._persistLatestWalletSummary();
    }

    getWalletStateHistory() {
        return this.walletStateService.getWalletStateHistory();
    }

    // UI State Service Delegations
    // REMOVED: notifySubscribers delegation - use AutoScannerService's own subscribers
    // notifySubscribers() {
    //     return this.uiStateService.notifySubscribers();
    // }

    registerToastNotifier(toastFunction) {
        return this.uiStateService.registerToastNotifier(toastFunction);
    }

    _saveStateToStorage() {
        return this.uiStateService._saveStateToStorage();
    }

    _loadStateFromStorage() {
        return this.uiStateService._loadStateFromStorage();
    }

    clearLogs() {
        return this.uiStateService.clearLogs();
    }

    forceResetState() {
        return this.uiStateService.forceResetState();
    }

    _initializeWidgetDefaults() {
        return this.uiStateService._initializeWidgetDefaults();
    }

    getState() {
        return this.uiStateService.getState();
    }

    // Lifecycle Service Delegations
    async initialize() {
        return this.lifecycleService.initialize();
    }

    async start() {
        return this.lifecycleService.start();
    }

    async stop() {
        return this.lifecycleService.stop();
    }

    forceStop() {
        return this.lifecycleService.forceStop();
    }

    restart() {
        return this.lifecycleService.restart();
    }

    _startScanLoop() {
        return this.lifecycleService._startScanLoop();
    }

    _startCountdown() {
        return this.lifecycleService._startCountdown();
    }

    async _loadExchangeInfo() {
        // ✅ RATE LIMIT PREVENTION: Prevent duplicate/concurrent requests
        if (this._exchangeInfoLoading && this._exchangeInfoLoadPromise) {
            console.log('[AutoScannerService] [EXCHANGE_INFO] ⏳ Exchange info load already in progress, waiting for existing request...');
            return await this._exchangeInfoLoadPromise;
        }

        // ✅ RATE LIMIT PREVENTION: Throttle requests (minimum 1 minute between requests)
        const now = Date.now();
        const timeSinceLastAttempt = now - this._exchangeInfoLastAttempt;
        if (timeSinceLastAttempt < this._exchangeInfoMinInterval && this._exchangeInfoLastAttempt > 0) {
            const waitTime = this._exchangeInfoMinInterval - timeSinceLastAttempt;
            const waitSeconds = Math.ceil(waitTime / 1000);
            console.log(`[AutoScannerService] [EXCHANGE_INFO] ⏳ Throttling request - last attempt was ${Math.round(timeSinceLastAttempt / 1000)}s ago. Waiting ${waitSeconds}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this._exchangeInfoLastAttempt = Date.now();

        // ✅ RATE LIMIT PREVENTION: Check cache first (if we have cached data, use it)
        if (this.state.exchangeInfo && Object.keys(this.state.exchangeInfo).length > 0) {
            console.log('[AutoScannerService] [EXCHANGE_INFO] ✅ Using cached exchange info');
            return this.state.exchangeInfo;
        }

        // Mark as loading and create promise
        this._exchangeInfoLoading = true;
        this._exchangeInfoLoadPromise = this._loadExchangeInfoInternal().finally(() => {
            this._exchangeInfoLoading = false;
            this._exchangeInfoLoadPromise = null;
        });

        return await this._exchangeInfoLoadPromise;
    }

    async _loadExchangeInfoInternal() {
        // Use the robust implementation instead of delegating to LifecycleService
        console.log('[AutoScannerService] [EXCHANGE_INFO] 📋 _loadExchangeInfoInternal() called');
        const MAX_RETRIES = 3;
        let attempt = 0;
        let lastError = null;

        while (attempt < MAX_RETRIES) {
            attempt++;
            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Attempt ${attempt}/${MAX_RETRIES} to load exchange info`);

            try {
                let proxyUrl = this.state.settings?.local_proxy_url;
                console.log(`[AutoScannerService] [EXCHANGE_INFO] Proxy URL from settings: ${proxyUrl || 'NOT SET'}`);

                if (!proxyUrl) {
                    // Use default proxy URL
                    proxyUrl = "http://localhost:3003";
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] Using default proxy URL: ${proxyUrl}`);
                }

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 🌐 Fetching exchange info directly from proxy: ${proxyUrl}/api/binance/exchangeInfo`);

                // Call proxy endpoint directly to avoid double-wrapping issues
                const httpResponse = await fetch(`${proxyUrl}/api/binance/exchangeInfo?tradingMode=${this.state.tradingMode}`);
                
                if (!httpResponse.ok) {
                    throw new Error(`HTTP ${httpResponse.status}: ${httpResponse.statusText}`);
                }
                
                const responseData = await httpResponse.json();
                
                // ✅ FIX: Log the raw response first to understand the structure
                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Raw responseData:`, {
                    keys: Object.keys(responseData || {}),
                    hasSuccess: 'success' in (responseData || {}),
                    hasData: 'data' in (responseData || {}),
                    hasError: 'error' in (responseData || {}),
                    successValue: responseData?.success,
                    dataType: typeof responseData?.data,
                    dataKeys: responseData?.data ? Object.keys(responseData.data) : 'no data',
                    sample: JSON.stringify(responseData).substring(0, 200)
                });

                // ✅ FIX: Handle error responses from proxy
                if (responseData?.success === false || responseData?.error) {
                    const errorMsg = responseData?.error || responseData?.message || 'Unknown error from proxy';
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Proxy returned error:`, errorMsg);
                    throw new Error(`Proxy error: ${errorMsg}`);
                }

                // ✅ FIX: Check if Binance returned an error (even though proxy says success: true)
                // Binance errors have structure: {code: -1003, msg: '...'}
                if (responseData?.data && typeof responseData.data === 'object' && 'code' in responseData.data && 'msg' in responseData.data) {
                    const binanceCode = responseData.data.code;
                    const binanceMsg = responseData.data.msg;
                    
                    // Rate limit errors (code -1003, -1005, etc.)
                    if (binanceCode === -1003 || binanceCode === -1005) {
                        const banUntilMatch = binanceMsg.match(/until (\d+)/);
                        const banUntil = banUntilMatch ? parseInt(banUntilMatch[1]) : null;
                        const banUntilDate = banUntil ? new Date(banUntil) : null;
                        const now = Date.now();
                        const waitTime = banUntil ? Math.max(0, banUntil - now) : 60000; // Default 1 minute if can't parse
                        
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] ⚠️ Binance rate limit error (code ${binanceCode}):`, binanceMsg);
                        
                        if (banUntilDate) {
                            const waitMinutes = Math.ceil(waitTime / 60000);
                            const waitSeconds = Math.ceil(waitTime / 1000);
                            
                            // ✅ FIX: If ban has expired (waitTime <= 0), retry once more
                            if (waitTime <= 0) {
                                console.warn(`[AutoScannerService] [EXCHANGE_INFO] ⚠️ Rate limit ban appears to have expired (was until ${banUntilDate.toISOString()}). Retrying...`);
                                // Continue to next retry attempt (don't throw yet)
                                throw new Error('Rate limit ban expired, retrying...');
                            }
                            
                            console.error(`[AutoScannerService] [EXCHANGE_INFO] ⏳ IP banned until ${banUntilDate.toISOString()} (${waitMinutes} minutes, ${waitSeconds} seconds)`);
                            
                            // ✅ FIX: Create a special error that indicates we should skip retries
                            const rateLimitError = new Error(`Binance rate limit exceeded. IP banned until ${banUntilDate.toISOString()}. Please wait ${waitMinutes} minutes or use WebSocket Streams.`);
                            rateLimitError.isRateLimit = true;
                            rateLimitError.banUntil = banUntil;
                            rateLimitError.waitTime = waitTime;
                            throw rateLimitError;
                        } else {
                            // Can't parse ban time, wait a bit and retry
                            console.warn(`[AutoScannerService] [EXCHANGE_INFO] ⚠️ Could not parse ban duration from message. Waiting 1 minute before retry.`);
                            const rateLimitError = new Error(`Binance rate limit exceeded: ${binanceMsg}`);
                            rateLimitError.isRateLimit = true;
                            rateLimitError.waitTime = 60000; // 1 minute default
                            throw rateLimitError;
                        }
                    } else {
                        // Other Binance errors
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Binance API error (code ${binanceCode}):`, binanceMsg);
                        throw new Error(`Binance API error (${binanceCode}): ${binanceMsg}`);
                    }
                }

                // Proxy returns: { success: true, data: { timezone: "...", serverTime: ..., symbols: [...] } }
                // OR: { success: true, data: { ...nested structure... } }
                const response = {
                    success: responseData.success,
                    data: responseData.data
                };

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Processed response:`, {
                    success: response?.success,
                    hasData: !!response?.data,
                    dataType: typeof response?.data,
                    dataKeys: response?.data ? Object.keys(response.data) : 'no data',
                    dataKeysDetailed: response?.data ? Object.keys(response.data).map(k => ({
                        key: k,
                        type: typeof response.data[k],
                        isArray: Array.isArray(response.data[k]),
                        arrayLength: Array.isArray(response.data[k]) ? response.data[k].length : 'N/A'
                    })) : 'no data',
                    hasSymbols: Array.isArray(response?.data?.symbols),
                    symbolsCount: Array.isArray(response?.data?.symbols) ? response.data.symbols.length : 0
                });

                // ✅ FIX: Check if response is actually successful
                if (!responseData?.success && !responseData?.data) {
                    const errorMsg = responseData?.error || responseData?.message || 'Invalid response structure from proxy';
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Response not successful:`, { responseData, errorMsg });
                    throw new Error(errorMsg);
                }

                // Handle multiple response formats:
                // 1. Direct proxy response: {success: true, data: {timezone: "...", symbols: [...]}}
                // 2. Double-wrapped response: {success: true, data: {success: true, data: {symbols: [...]}}}
                // 3. Error response: {success: false, error: "..."}
                let exchangeInfoData = response.data;
                
                // Check if we have double-wrapping: {success: true, data: {success: true, data: {...}}}
                if (exchangeInfoData?.data && Array.isArray(exchangeInfoData.data.symbols)) {
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Detected double-wrapped response, unwrapping...`);
                    exchangeInfoData = exchangeInfoData.data;
                }
                
                // Also check if response.data itself is the exchange info (direct Binance response)
                // Binance returns: {timezone: "...", serverTime: ..., symbols: [...]}
                if (Array.isArray(exchangeInfoData?.symbols)) {
                    // This is the correct structure, proceed
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ Found symbols array at exchangeInfoData.symbols`);
                } else if (exchangeInfoData && typeof exchangeInfoData === 'object') {
                    // ✅ FIX: Log what keys we actually have
                    const keys = Object.keys(exchangeInfoData);
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔍 Checking nested structure for symbols...`);
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 exchangeInfoData keys (${keys.length}):`, keys);
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 exchangeInfoData values:`, keys.reduce((acc, k) => {
                        const val = exchangeInfoData[k];
                        if (Array.isArray(val)) {
                            acc[k] = `Array(${val.length})`;
                        } else if (typeof val === 'object' && val !== null) {
                            acc[k] = `Object(${Object.keys(val).length} keys: ${Object.keys(val).slice(0, 5).join(', ')})`;
                        } else {
                            acc[k] = String(val).substring(0, 50);
                        }
                        return acc;
                    }, {}));
                    
                    // ✅ FIX: Check if one of the keys contains symbols
                    for (const key of keys) {
                        const value = exchangeInfoData[key];
                        if (Array.isArray(value) && value.length > 0 && value[0]?.symbol) {
                            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols array at exchangeInfoData.${key}`);
                            // Reconstruct exchangeInfoData with symbols at root
                            exchangeInfoData = { ...exchangeInfoData, symbols: value };
                            break;
                        } else if (typeof value === 'object' && value !== null && Array.isArray(value.symbols)) {
                            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at exchangeInfoData.${key}.symbols`);
                            exchangeInfoData = value;
                            break;
                        }
                    }
                    
                    // Check if symbols might be at root level of response
                    if (!Array.isArray(exchangeInfoData?.symbols) && Array.isArray(response.symbols)) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at response root level`);
                        exchangeInfoData = response;
                    }
                }

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Exchange info data:`, exchangeInfoData);
                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Exchange info data.symbols:`, exchangeInfoData?.symbols);
                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Is symbols array:`, Array.isArray(exchangeInfoData?.symbols));
                
                if (!exchangeInfoData || !Array.isArray(exchangeInfoData.symbols)) {
                    // ✅ FIX: Try multiple fallback paths with better logging
                    let foundSymbols = false;
                    
                    // Try response.data.data.symbols (double-wrapped)
                    if (response?.data?.data?.symbols && Array.isArray(response.data.data.symbols)) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at response.data.data level`);
                        exchangeInfoData = response.data.data;
                        foundSymbols = true;
                    }
                    // Try response.symbols (root level)
                    else if (response?.symbols && Array.isArray(response.symbols)) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at response root level`);
                        exchangeInfoData = response;
                        foundSymbols = true;
                    }
                    // Try responseData.data.symbols (direct from raw response)
                    else if (responseData?.data?.symbols && Array.isArray(responseData.data.symbols)) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at responseData.data level`);
                        exchangeInfoData = responseData.data;
                        foundSymbols = true;
                    }
                    // Try responseData.symbols (raw response root)
                    else if (responseData?.symbols && Array.isArray(responseData.symbols)) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Found symbols at responseData root level`);
                        exchangeInfoData = responseData;
                        foundSymbols = true;
                    }
                    
                    if (!foundSymbols) {
                        // ✅ FIX: Enhanced error logging with actual keys and values
                        const exchangeInfoDataKeys = exchangeInfoData ? Object.keys(exchangeInfoData) : [];
                        const exchangeInfoDataValues = {};
                        if (exchangeInfoData) {
                            exchangeInfoDataKeys.forEach(key => {
                                const value = exchangeInfoData[key];
                                if (Array.isArray(value)) {
                                    exchangeInfoDataValues[key] = `Array(${value.length})`;
                                } else if (typeof value === 'object' && value !== null) {
                                    exchangeInfoDataValues[key] = `Object(${Object.keys(value).length} keys)`;
                    } else {
                                    exchangeInfoDataValues[key] = String(value).substring(0, 100);
                                }
                            });
                        }
                        
                        const diagnosticInfo = {
                            hasExchangeInfoData: !!exchangeInfoData,
                            exchangeInfoDataType: typeof exchangeInfoData,
                            exchangeInfoDataKeys: exchangeInfoDataKeys,
                            exchangeInfoDataValues: exchangeInfoDataValues,
                            hasSymbols: !!exchangeInfoData?.symbols,
                            symbolsType: typeof exchangeInfoData?.symbols,
                            symbolsIsArray: Array.isArray(exchangeInfoData?.symbols),
                            responseKeys: Object.keys(response || {}),
                            responseDataKeys: Object.keys(responseData || {}),
                            responseHasData: !!response?.data,
                            responseDataHasData: !!responseData?.data,
                            responseDataDataKeys: responseData?.data ? Object.keys(responseData.data) : 'no responseData.data',
                            responseDataDataHasSymbols: Array.isArray(responseData?.data?.symbols),
                            fullResponseSample: JSON.stringify(responseData).substring(0, 2000),
                            fullExchangeInfoDataSample: JSON.stringify(exchangeInfoData).substring(0, 2000)
                        };
                        
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Invalid exchange info structure - symbols array not found:`, diagnosticInfo);
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] 🔍 ExchangeInfoData keys are:`, exchangeInfoDataKeys);
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] 🔍 ExchangeInfoData values:`, exchangeInfoDataValues);
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] 🔍 Full responseData:`, responseData);
                        console.error(`[AutoScannerService] [EXCHANGE_INFO] 🔍 Full exchangeInfoData:`, exchangeInfoData);
                        
                        throw new Error(`Invalid exchange info structure: symbols array not found. ExchangeInfoData has keys: ${exchangeInfoDataKeys.join(', ')}. Check proxy response format.`);
                    }
                }
                
                // Final validation
                if (!exchangeInfoData || !Array.isArray(exchangeInfoData.symbols)) {
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Final validation failed after all unwrapping attempts`);
                    throw new Error('Invalid exchange info structure - symbols array not found after unwrapping');
                }

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Exchange info structure:`, {
                    hasSymbols: !!exchangeInfoData.symbols,
                    symbolCount: exchangeInfoData.symbols.length,
                    sampleSymbol: exchangeInfoData.symbols[0]?.symbol
                });

                // Transform the array of symbols into a map for easier lookup (preserving original structure)
                const infoMap = exchangeInfoData.symbols.reduce((acc, symbol) => {
                    acc[symbol.symbol] = {
                        status: symbol.status,
                        filters: symbol.filters.reduce((filterAcc, filter) => {
                            filterAcc[filter.filterType] = filter;
                            return filterAcc;
                        }, {})
                    };
                    return acc;
                }, {});

                console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ Successfully loaded and mapped exchange info for ${Object.keys(infoMap).length} symbols`);

                return infoMap; // Return the processed map

            } catch (error) {
                lastError = error;
                console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Attempt ${attempt} failed:`, error.message);
                
                // ✅ FIX: For rate limit errors, start background retry process
                if (error.isRateLimit) {
                    const waitTime = error.waitTime || 60000;
                    const waitMinutes = Math.ceil(waitTime / 60000);
                    
                    if (waitTime <= 0) {
                        // Ban expired, try one more time immediately
                        console.warn(`[AutoScannerService] [EXCHANGE_INFO] ⚠️ Rate limit ban expired. Retrying immediately...`);
                        attempt--; // Decrement so we can retry
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                        continue;
                    }
                    
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ⛔ Rate limit detected - will wait ${waitMinutes} minutes.`);
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Starting background retry process...`);
                    
                    // ✅ Start background retry mechanism
                    this._startExchangeInfoBackgroundRetry(error);
                    
                    // Throw error to prevent initialization from completing
                    throw error;
                }
                
                // For non-rate-limit errors, retry with exponential backoff
                if (attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] ⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // If all retries failed, throw the last error
        console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ All ${MAX_RETRIES} attempts failed`);
        
        // ✅ FIX: Scanner cannot run without exchange info - throw error to prevent initialization
        if (lastError) {
            console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Scanner initialization BLOCKED: Exchange info is required for scanner operation.`);
            throw lastError;
        }
        
        throw new Error('Failed to load exchange info after all retries. Scanner cannot run without exchange info.');
    }

    /**
     * ✅ BACKGROUND RETRY: Start a background process to retry exchange info loading
     * This allows the scanner to continue working once the rate limit ban expires
     */
    _startExchangeInfoBackgroundRetry(rateLimitError) {
        // Clear any existing retry interval
        if (this._exchangeInfoRetryInterval) {
            clearInterval(this._exchangeInfoRetryInterval);
        }

        const waitTime = rateLimitError.waitTime || 60000;
        const banUntil = rateLimitError.banUntil || (Date.now() + waitTime);
        const retryInterval = Math.min(waitTime, 60000); // Check every minute or when ban expires, whichever is sooner

        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Background retry started. Will check every ${Math.ceil(retryInterval / 1000)}s until ban expires at ${new Date(banUntil).toISOString()}`);

        this._exchangeInfoRetryInterval = setInterval(async () => {
            const now = Date.now();
            
            // Check if ban has expired
            if (now >= banUntil) {
                console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ Rate limit ban expired. Attempting to load exchange info...`);
                
                try {
                    // Clear retry interval
                    clearInterval(this._exchangeInfoRetryInterval);
                    this._exchangeInfoRetryInterval = null;
                    
                    // Reset loading state to allow new request
                    this._exchangeInfoLoading = false;
                    this._exchangeInfoLoadPromise = null;
                    
                    // Attempt to load exchange info
                    const exchangeInfo = await this._loadExchangeInfo();
                    
                    if (exchangeInfo && Object.keys(exchangeInfo).length > 0) {
                        this.state.exchangeInfo = exchangeInfo;
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ Exchange info loaded successfully after rate limit ban expired!`);
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Scanner can now continue with full functionality.`);
                        
                        // Notify subscribers that exchange info is now available
                        this.notifySubscribers();
                        
                        // If scanner is running but wasn't initialized properly, try to complete initialization
                        if (this.state.isRunning && !this.state.exchangeInfo) {
                            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Attempting to complete scanner initialization...`);
                            // PositionManager might need to reinitialize with exchange info
                            if (this.positionManager && typeof this.positionManager.initialize === 'function') {
                                try {
                                    await this.positionManager.initialize();
                                    console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ PositionManager reinitialized with exchange info`);
                                } catch (err) {
                                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Failed to reinitialize PositionManager:`, err);
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Background retry failed:`, error.message);
                    
                    // If still rate limited, restart the retry process
                    if (error.isRateLimit) {
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] ⚠️ Still rate limited, restarting background retry...`);
                        this._startExchangeInfoBackgroundRetry(error);
                    } else {
                        // For other errors, retry after a delay
                        console.log(`[AutoScannerService] [EXCHANGE_INFO] ⏳ Retrying in 60 seconds...`);
                        setTimeout(() => {
                            this._exchangeInfoRetryInterval = null;
                            this._startExchangeInfoBackgroundRetry({ waitTime: 60000, banUntil: Date.now() + 60000 });
                        }, 60000);
                    }
                }
            } else {
                const remainingTime = banUntil - now;
                const remainingMinutes = Math.ceil(remainingTime / 60000);
                if (remainingMinutes % 5 === 0 || remainingMinutes <= 1) {
                    // Log every 5 minutes or in the last minute
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] ⏳ Waiting for rate limit ban to expire... ${remainingMinutes} minute(s) remaining`);
                }
            }
        }, retryInterval);
    }

    /**
     * ✅ Stop background retry process (cleanup)
     */
    _stopExchangeInfoBackgroundRetry() {
        if (this._exchangeInfoRetryInterval) {
            clearInterval(this._exchangeInfoRetryInterval);
            this._exchangeInfoRetryInterval = null;
            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🛑 Background retry stopped`);
        }
    }

    getExchangeInfo() {
        // If exchange info is not loaded, try to load it
        if (!this.state.exchangeInfo || Object.keys(this.state.exchangeInfo).length === 0) {
            console.log('[AutoScannerService] [EXCHANGE_INFO] ⚠️ Exchange info not loaded, attempting to load...');
            this._loadExchangeInfo().then(exchangeInfo => {
                this.state.exchangeInfo = exchangeInfo;
                console.log('[AutoScannerService] [EXCHANGE_INFO] ✅ Exchange info loaded on demand');
            }).catch(error => {
                console.error('[AutoScannerService] [EXCHANGE_INFO] ❌ Failed to load exchange info on demand:', error);
            });
        }
        return this.state.exchangeInfo;
    }

    // Utility Service Delegations
    getTradingMode() {
        // Safe call - return default if utilityService doesn't exist yet
        if (this.utilityService) {
            return this.utilityService.getTradingMode();
        }
        // Fallback to state.tradingMode if utilityService not ready
        return this.state?.tradingMode || 'testnet';
    }

    isLiveMode() {
        // Safe call - return default if utilityService doesn't exist yet
        if (this.utilityService) {
            return this.utilityService.isLiveMode();
        }
        // Fallback to checking state.tradingMode if utilityService not ready
        return this.state?.tradingMode === 'live';
    }

    isTestnetMode() {
        // Safe call - return default if utilityService doesn't exist yet
        if (this.utilityService) {
            return this.utilityService.isTestnetMode();
        }
        // Fallback to checking state.tradingMode if utilityService not ready
        return this.state?.tradingMode === 'testnet';
    }

    async _startRunningState() {
        if (!this.utilityService) {
            console.error('[AutoScannerService] ❌ ERROR: utilityService is undefined!');
            return;
        }
        return await this.utilityService._startRunningState();
    }

    _stopRunningState(options = {}) {
        return this.utilityService._stopRunningState(options);
    }

    async _sendTelegramNotification(type, data) {
        return this.utilityService._sendTelegramNotification(type, data);
    }

    _isTradingBlockedByRegime() {
        return this.utilityService._isTradingBlockedByRegime();
    }

    // Market Regime Service Delegations
    _isRegimeCacheValid() {
        return this.marketRegimeService._isRegimeCacheValid();
    }

    async _getCachedOrCalculateRegime(forceCalculate = false) {
        return this.marketRegimeService._getCachedOrCalculateRegime(forceCalculate);
    }

    async _detectMarketRegime() {
        return this.marketRegimeService._detectMarketRegime();
    }

    async _fetchFearAndGreedIndex() {
        return this.marketRegimeService._fetchFearAndGreedIndex();
    }

    async _updateMarketRegime() {
        return this.marketRegimeService._updateMarketRegime();
    }

    // Price Manager Service Delegations
    async _consolidatePrices() {
        return this.priceManagerService._consolidatePrices();
    }

    _updateCurrentPrices(pricesData) {
        return this.priceManagerService._updateCurrentPrices(pricesData);
    }

    // Scan Engine Service Delegations
    async _loadStrategies() {
        return this.scanEngineService._loadStrategies();
    }

    async _monitorPositions(cycleStats) {
        return this.scanEngineService._monitorPositions(cycleStats);
    }

    async _evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {
        return this.scanEngineService._evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats);
    }

    async _logCycleSummary(cycleStats) {
        return this.scanEngineService._logCycleSummary(cycleStats);
    }

    _logWalletSummary() {
        return this.scanEngineService._logWalletSummary();
    }

    // Configuration Service Delegations
    async updateSettings(newSettings) {
        return this.configurationService.updateSettings(newSettings);
    }

    async refreshStrategies() {
        return this.strategyManager.refreshStrategies();
    }
}

let instance = null;
export const getAutoScannerService = () => {
    if (typeof window !== 'undefined' && window.autoScannerService) {
        return window.autoScannerService;
    }

    if (!instance) {
        instance = new AutoScannerService();
    }
    return instance;
};

// Global debugging functions
if (typeof window !== 'undefined') {
    window.debugScannerServiceState = () => {
        console.log('🔍 [SCANNER_STATE_DEBUG] Checking scanner service state...');
        
        try {
            // Check if we can access the scanner service
            const scannerService = window.autoScannerService || window.scannerService || window.getAutoScannerService?.();
            
            if (scannerService) {
                const currentState = scannerService.getState();
                console.log('📊 [SCANNER_STATE_DEBUG] Current scanner state:', currentState);
                
                console.log('🎯 [SCANNER_STATE_DEBUG] Market regime data:', {
                    marketRegime: currentState.marketRegime,
                    marketRegimeState: currentState.marketRegimeState,
                    hasMarketRegime: !!currentState.marketRegime,
                    hasMarketRegimeState: !!currentState.marketRegimeState
                });
                
                if (currentState.marketRegime) {
                    console.log('✅ [SCANNER_STATE_DEBUG] marketRegime found:', {
                        regime: currentState.marketRegime.regime,
                        confidence: currentState.marketRegime.confidence,
                        confidencePct: (currentState.marketRegime.confidence * 100).toFixed(1) + '%',
                        isConfirmed: currentState.marketRegime.isConfirmed
                    });
                } else {
                    console.log('❌ [SCANNER_STATE_DEBUG] No marketRegime in scanner state');
                }
                
                if (currentState.marketRegimeState) {
                    console.log('✅ [SCANNER_STATE_DEBUG] marketRegimeState found:', {
                        regime: currentState.marketRegimeState.regime,
                        confidence: currentState.marketRegimeState.confidence,
                        confidencePct: (currentState.marketRegimeState.confidence * 100).toFixed(1) + '%',
                        isConfirmed: currentState.marketRegimeState.isConfirmed
                    });
                } else {
                    console.log('❌ [SCANNER_STATE_DEBUG] No marketRegimeState in scanner state');
                }
                
            } else {
                console.log('❌ [SCANNER_STATE_DEBUG] Scanner service not available');
                console.log('🔍 [SCANNER_STATE_DEBUG] Available window objects:', Object.keys(window).filter(key => key.includes('scanner') || key.includes('Scanner')));
            }
            
        } catch (error) {
            console.error('❌ [SCANNER_STATE_DEBUG] Error:', error);
        }
    };

    window.forceRefreshRegimeWidget = () => {
        console.log('🔄 [REGIME_WIDGET_REFRESH] Forcing regime widget refresh...');
        
        try {
            const scannerService = window.autoScannerService || window.scannerService || window.getAutoScannerService?.();
            
            if (scannerService) {
                console.log('📊 [REGIME_WIDGET_REFRESH] Current state before refresh:', scannerService.getState().marketRegime);
                
                // Force a regime calculation
                scannerService._updateMarketRegime().then(() => {
                    console.log('✅ [REGIME_WIDGET_REFRESH] Regime updated, new state:', scannerService.getState().marketRegime);
                    
                    // Notify subscribers
                    scannerService.notifySubscribers();
                    console.log('📢 [REGIME_WIDGET_REFRESH] Subscribers notified');
                    
                }).catch(error => {
                    console.error('❌ [REGIME_WIDGET_REFRESH] Error updating regime:', error);
                });
                
            } else {
                console.log('❌ [REGIME_WIDGET_REFRESH] Scanner service not available');
            }
            
        } catch (error) {
            console.error('❌ [REGIME_WIDGET_REFRESH] Error:', error);
        }
    };

    window.testRegimeWidget = () => {
        console.log('🧪 [REGIME_WIDGET_TEST] Testing regime widget data access...');
        
        try {
            const scannerService = window.autoScannerService || window.scannerService || window.getAutoScannerService?.();
            
            if (scannerService) {
                const currentState = scannerService.getState();
                console.log('📊 [REGIME_WIDGET_TEST] Current scanner state:', currentState);
                
                console.log('🎯 [REGIME_WIDGET_TEST] Market regime data for widget:', {
                    marketRegime: currentState.marketRegime,
                    hasMarketRegime: !!currentState.marketRegime,
                    regime: currentState.marketRegime?.regime,
                    confidence: currentState.marketRegime?.confidence,
                    confidencePct: currentState.marketRegime?.confidence ? (currentState.marketRegime.confidence * 100).toFixed(1) + '%' : 'N/A',
                    isConfirmed: currentState.marketRegime?.isConfirmed
                });
                
                // Test what the widget would receive
                if (currentState.marketRegime) {
                    const { regime, confidence, isConfirmed } = currentState.marketRegime;
                    const confidencePercent = Math.round((confidence ?? 0) * 100);
                    
                    console.log('🎨 [REGIME_WIDGET_TEST] Widget would display:', {
                        regime: regime,
                        confidencePercent: confidencePercent,
                        isConfirmed: Boolean(isConfirmed),
                        shouldShowAsUnknown: !regime || regime === 'unknown'
                    });
                    
                    if (!regime || regime === 'unknown') {
                        console.log('❌ [REGIME_WIDGET_TEST] Widget would show as unknown!');
                    } else {
                        console.log('✅ [REGIME_WIDGET_TEST] Widget should show:', `${confidencePercent}% ${regime}`);
                    }
                } else {
                    console.log('❌ [REGIME_WIDGET_TEST] No marketRegime data available for widget');
                }
                
            } else {
                console.log('❌ [REGIME_WIDGET_TEST] Scanner service not available');
            }
            
        } catch (error) {
            console.error('❌ [REGIME_WIDGET_TEST] Error:', error);
        }
    };
}

export default AutoScannerService;
