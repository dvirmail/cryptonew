/**
 * LifecycleService
 * 
 * Manages scanner lifecycle operations including initialization, starting, stopping,
 * and restarting. This service handles the core lifecycle management of the scanner.
 */

import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { getExchangeInfo } from '@/api/functions';

export class LifecycleService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // Lifecycle state
        this.countdownInterval = null;
    }

    /**
     * Initializes the scanner with all required components.
     * @returns {boolean} True if initialization successful, false otherwise.
     */
    async initialize() {
        if (this.scannerService.state.isInitializing) {
            console.warn('[AutoScannerService] Initialization already in progress.');
            return false;
        }

        if (this.scannerService.state.isInitialized && !this.scannerService._persistedRunningFlag && !this.scannerService._isAutoStartBlocked) {
            console.log('[AutoScannerService] Already initialized. Skipping re-initialization.');
            return true;
        }

        this.scannerService.state.isInitializing = true;
        const initStartTime = Date.now();
        console.log(`[AutoScannerService] 🚀 Initializing scanner in ${this.scannerService.state.tradingMode.toUpperCase()} mode...`);
        this.scannerService.notifySubscribers();

        try {
            // OPTIMIZATION: Load configuration, exchange info, and strategies in parallel
            console.log('[AutoScannerService] ⚡ Loading core components in parallel...');
            const [configResult, exchangeInfo, strategies] = await Promise.all([
                this.scannerService.configurationService.loadConfiguration(),
                this._loadExchangeInfo(),
                this.scannerService.scanEngineService._loadStrategies().catch(err => {
                    console.warn('[AutoScannerService] ⚠️ Strategy loading failed (non-critical):', err.message);
                    return [];
                })
            ]);
            this.scannerService.state.exchangeInfo = exchangeInfo;
            console.log(`[AutoScannerService] ✅ Core components loaded in ${Date.now() - initStartTime}ms`);

            // OPTIMIZATION: Initialize wallet in parallel with position loading
            console.log(`[AutoScannerService] 🔄 Syncing ${this.scannerService.state.tradingMode.toUpperCase()} wallet with Binance API...`);

            try {
                await this.scannerService.walletManagerService.initializeLiveWallet();
                console.log(`[AutoScannerService] ✅ Successfully synced ${this.scannerService.state.tradingMode.toUpperCase()} wallet with Binance`);
            } catch (binanceError) {
                console.error(`[AutoScannerService] ❌ Failed to sync with Binance: ${binanceError.message}`);
                console.warn(`[AutoScannerService] 📂 Attempting to load existing wallet state from database as fallback...`);

                const existingWallets = await queueEntityCall('CentralWalletState', 'filter', { trading_mode: this.scannerService.state.tradingMode });

                if (existingWallets && existingWallets.length > 1) {
                    console.warn(`[AutoScannerService] 🧹 Found ${existingWallets.length} duplicate ${this.scannerService.state.tradingMode.toUpperCase()} wallets. Using the most recent one.`);
                    existingWallets.sort((a, b) => new Date(b.last_updated_timestamp || 0) - new Date(a.last_updated_timestamp || 0));
                }

                if (existingWallets && existingWallets.length > 0) {
                    // Legacy wallet state assignment - now handled by CentralWalletStateManager
                    // this.scannerService.state.liveWalletState = existingWallets[0];
                    // if (!Array.isArray(this.scannerService.state.liveWalletState.positions)) {
                    //     this.scannerService.state.liveWalletState.positions = [];
                    // }
                    console.log(`[AutoScannerService] ✅ Found existing ${this.scannerService.state.tradingMode.toUpperCase()} wallet state in database (handled by CentralWalletStateManager)`);
                } else {
                    console.log(`[AutoScannerService] ℹ️ No existing wallet state found for ${this.scannerService.state.tradingMode} mode - will be created by CentralWalletStateManager`);
                }
            }

            // Initialize session management
            this.scannerService.sessionManager.startMonitoring();

            // Initialize widget defaults for immediate UI display
            this.scannerService.uiStateService._initializeWidgetDefaults();

            // Step: Initialize PositionManager with exchange info, then load managed positions
            this.scannerService.addLog(`[PositionManager] 🔧 Initializing PositionManager with exchange info...`, 'system');
            
            // Initialize PositionManager (loads exchange info and creates symbol filters)
            await this.scannerService.positionManager.initialize();
            
            // CRITICAL: Ensure wallet state exists before loading managed state
            let currentWalletState = this.scannerService._getCurrentWalletState();
            if (!currentWalletState) {
                this.scannerService.addLog('[AutoScannerService] ⚠️ No wallet state available, waiting for CentralWalletStateManager to initialize...', 'warning');
                
                // Wait for wallet state to be available (with timeout)
                let attempts = 0;
                const maxAttempts = 10;
                while (!currentWalletState && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
                    currentWalletState = this.scannerService._getCurrentWalletState();
                    attempts++;
                }
                
                if (!currentWalletState) {
                    throw new Error('CentralWalletStateManager failed to initialize within timeout');
                }
                
                this.scannerService.addLog(`[AutoScannerService] ✅ Wallet state available after ${attempts * 100}ms`, 'success');
            }
            
            // OPTIMIZATION: Load positions and momentum trades in parallel (strategies already loaded)
            console.log('[AutoScannerService] 📋 Loading positions and momentum trades in parallel...');
            
            const [positionResult, momentumTrades] = await Promise.all([
                this.scannerService.positionManager.loadManagedState(currentWalletState),
                this.scannerService.performanceMetricsService.loadInitialMomentumTrades().catch(err => {
                    console.warn('[AutoScannerService] ⚠️ Momentum trades loading failed (non-critical):', err.message);
                    return [];
                })
            ]);
            
            console.log(`[AutoScannerService] ✅ Loaded ${this.scannerService.positionManager.positions.length} open positions and momentum trades`);

            // Ensure the guard is attached after PositionManager is fully set up
            this.scannerService.attachRegimeOpenGuard();

            // Step: Load active strategies
            this.scannerService.addLog(`[StrategyManager] 🔧 Loading active strategies...`, 'system');
            await this.scannerService.scanEngineService._loadStrategies();
            console.log(`[AutoScannerService] ✅ Loaded ${this.scannerService.state.activeStrategies?.length || 0} active strategies`);

            // Step: Consolidate prices for all relevant symbols
            this.scannerService.addLog(`[PriceManager] 🔧 Consolidating prices...`, 'system');
            await this.scannerService._consolidatePrices();
            console.log(`[AutoScannerService] ✅ Consolidated prices for ${Object.keys(this.scannerService.currentPrices || {}).length} symbols`);

            // Step: Update wallet summary
            this.scannerService.addLog(`[WalletManager] 🔧 Updating wallet summary...`, 'system');
            await this.scannerService.walletManagerService.updateWalletSummary();
            console.log(`[AutoScannerService] ✅ Wallet summary updated`);

            // Step: Calculate market regime
            this.scannerService.addLog(`[MarketRegime] 🔧 Calculating market regime...`, 'system');
            await this.scannerService._getCachedOrCalculateRegime(true);
            console.log(`[AutoScannerService] ✅ Market regime calculated: ${this.scannerService.state.marketRegime?.regime || 'unknown'}`);

            // Step: Ensure Fear & Greed data is fetched
            this.scannerService.addLog(`[FearGreed] 🔧 Fetching Fear & Greed Index...`, 'system');
            try {
                await this.scannerService._fetchFearAndGreedIndex();
                console.log(`[AutoScannerService] ✅ Fear & Greed Index fetched: ${this.scannerService.state.fearAndGreedData?.value || 'N/A'}`);
            } catch (error) {
                console.warn(`[AutoScannerService] ⚠️ Fear & Greed fetch failed: ${error.message}`);
                console.error('[LifecycleService] ❌ Fear & Greed fetch error:', error);
            }

            // Step: Calculate performance momentum
            this.scannerService.addLog(`[PerformanceMetrics] 🔧 Calculating performance momentum...`, 'system');
            await this.scannerService.performanceMetricsService.calculatePerformanceMomentum();
            console.log(`[AutoScannerService] ✅ Performance momentum calculated: ${this.scannerService.state.performanceMomentumScore || 0}`);

            // Step: Persist latest wallet summary
            this.scannerService.addLog(`[WalletManager] 🔧 Persisting wallet summary...`, 'system');
            await this.scannerService._persistLatestWalletSummary();
            console.log(`[AutoScannerService] ✅ Wallet summary persisted`);

            // OPTIMIZATION: Mark as initialized early for UI responsiveness
            this.scannerService.state.isInitialized = true;
            this.scannerService.state.isInitializing = false;
            this.scannerService.notifySubscribers();

            console.log(`[AutoScannerService] ✅ Scanner initialization completed in ${Date.now() - initStartTime}ms`);

            // Auto-start logic (if needed and not blocked)
            console.log('[AutoScannerService] 🔍 AUTO-START DEBUG:');
            console.log('[AutoScannerService] 🔍 _persistedRunningFlag:', this.scannerService._persistedRunningFlag);
            console.log('[AutoScannerService] 🔍 isNavigating:', this.scannerService.isNavigating);
            console.log('[AutoScannerService] 🔍 _isAutoStartBlocked:', this.scannerService._isAutoStartBlocked);
            
            if (this.scannerService._persistedRunningFlag && !this.scannerService.isNavigating && !this.scannerService._isAutoStartBlocked) {
                // OPTIMIZATION: Wallet already initialized above, no need to re-initialize
                console.log('[AutoScannerService] 🚀 Auto-starting scanner (persisted flag)...');
                await this.start();
                this.scannerService._persistedRunningFlag = false; // Reset after attempt to start
            } else if (!this.scannerService.isNavigating && !this.scannerService._isAutoStartBlocked) {
                // ALWAYS auto-start on app startup (unless blocked or navigating)
                console.log('[AutoScannerService] 🚀 Auto-starting scanner on app startup...');
                await this.start();
            } else {
                console.log('[AutoScannerService] ❌ Auto-start BLOCKED - conditions not met');
            }

            return true;
        } catch (error) {
            console.error(`[AutoScannerService] ❌ Initialization failed: ${error.message}`, error);
            this.scannerService.state.isInitialized = false; // Ensure state is not initialized on failure
            this.scannerService.state.isInitializing = false;
            this.scannerService.notifySubscribers();
            throw error;
        }
    }

    /**
     * Starts the scanner and claims leadership.
     * @returns {boolean} True if started successfully, false otherwise.
     */
    async start() {
        console.log('[LifecycleService] 🚀 Starting scanner via SessionManager...');
        console.log('[LifecycleService] 🔍 sessionManager exists:', !!this.scannerService.sessionManager);
        console.log('[LifecycleService] 🔍 sessionManager.start exists:', !!this.scannerService.sessionManager?.start);
        
        try {
            // Call SessionManager directly - no need for AutoScannerService.start() wrapper
            const result = await this.scannerService.sessionManager.start();
            if (result) {
                console.log('[LifecycleService] ✅ Scanner started successfully');
            } else {
                console.warn('[LifecycleService] ⚠️ Scanner start failed or leadership not claimed.');
            }
            return result;
        } catch (error) {
            console.error('[LifecycleService] ❌ Error starting scanner:', error);
            return false;
        }
    }

    /**
     * Stops the scanner and releases leadership.
     * @returns {boolean} True if stopped successfully, false otherwise.
     */
    async stop() {
        console.log('[LifecycleService] 🛑 Stopping scanner via SessionManager...');
        const result = await this.scannerService.sessionManager.stop();
        if (result) {
            console.log('[LifecycleService] ✅ Scanner stopped successfully');
        } else {
            console.warn('[LifecycleService] ⚠️ Scanner stop failed.');
        }
        return result;
    }

    /**
     * Forces stop and releases leadership immediately.
     * @returns {boolean} True if force stop successful, false otherwise.
     */
    forceStop() {
        console.log('[AutoScannerService] Initiating force stop and leadership release...');
        return this.scannerService.sessionManager.forceStop();
    }

    /**
     * Restarts the scanner with clean state.
     * @returns {Promise<boolean>} True if restart successful, false otherwise.
     */
    restart() {
        console.log('[AutoScannerService] 🔄 Restarting scanner...');

        try {
            this.scannerService.stop();

            return new Promise(resolve => setTimeout(async () => {
                this.scannerService.state.stats.totalScans = 0;
                this.scannerService.state.stats.totalScanCycles = 0; // Reset total scan cycles on restart
                this.scannerService.scanEngineService.scanCycleTimes = []; // Reset cycle times on restart

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
            }, 1000));
        } catch (error) {
            console.error(`[AutoScannerService] ❌ Error during scanner restart: ${error.message}`, error);
            return Promise.resolve(false);
        }
    }

    /**
     * Starts the scan loop by executing the first scan cycle.
     */
    async _startScanLoop() {
        
        try {
            await this.scannerService.scanEngineService.scanCycle();
        } catch (e) {
            console.error(`[LifecycleService] ❌ Initial scan failed: ${e.message}`, e);
            console.error('[LifecycleService] ❌ Full error details:', e);
        }
    }

    /**
     * Starts the countdown timer for the next scan cycle.
     */
    _startCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        if (!this.scannerService.state.isRunning || this.scannerService.state.isScanning) {
            return;
        }

        const scanFrequency = this.scannerService.state.settings?.scanFrequency || 60000;
        this.scannerService.state.nextScanTime = Date.now() + scanFrequency;

        console.log(`[AutoScannerService] ⏰ Next scan in ${Math.round(scanFrequency / 1000)} seconds...`);

        this.scannerService.notifySubscribers();

        this.countdownInterval = setInterval(() => {
            if (!this.scannerService.state.isRunning || this.scannerService.state.isScanning) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.scannerService.state.nextScanTime = null;

                this.scannerService.notifySubscribers();
                return;
            }

            if (this.scannerService.state.nextScanTime && Date.now() >= this.scannerService.state.nextScanTime) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.scannerService.state.nextScanTime = null;

                this.scannerService.scanEngineService.scanCycle().catch(e => {
                    console.error(`[AutoScannerService] Scan cycle error: ${e.message}`, e);
                });
                return;
            }

            this.scannerService.notifySubscribers();
        }, 1000);
    }

    /**
     * Loads exchange information for trading operations.
     * @returns {object} Exchange information object.
     */
    async _loadExchangeInfo() {
        // Delegate to AutoScannerService's robust implementation
        return await this.scannerService._loadExchangeInfo();
    }

    /**
     * Gets exchange information.
     * @returns {object} Exchange information object.
     */
    getExchangeInfo() {
        return this.scannerService.state.exchangeInfo;
    }

    /**
     * Resets the lifecycle service state.
     */
    resetState() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        this.addLog('[LifecycleService] State reset.', 'system');
    }
}

export default LifecycleService;
