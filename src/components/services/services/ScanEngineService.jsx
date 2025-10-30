/**
 * ScanEngineService
 * 
 * Manages the core scanning logic including scan cycles, strategy evaluation,
 * position monitoring, and cycle summaries. This service orchestrates the main
 * scanning workflow and coordinates with other services.
 */

import { SCANNER_DEFAULTS } from '../constants/scannerDefaults';
import { queueFunctionCall } from '@/components/utils/apiQueue';
import { reconcileWalletState, purgeGhostPositions } from '@/api/functions';

export class ScanEngineService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        
        // FIX: Use arrow function to preserve binding
        this.addLog = (message, type, data) => {
            return scannerService.addLog(message, type, data);
        };
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // Scan cycle tracking
        this.scanCycleTimes = [];
        this.maxCycleTimeSamples = SCANNER_DEFAULTS.maxCycleTimeSamples;
    }

    // Helper: get current wallet state (CentralWalletStateManager first, fallback to old system)
    _getCurrentWalletState() {
        return this.scannerService.walletManagerService?.getCurrentWalletState() || this._getCurrentWalletState();
    }

    /**
     * Main scan cycle method that orchestrates the entire scanning process.
     * This is the core method that runs the scanning workflow.
     */
    async scanCycle() {
        //console.log('🚀🚀🚀 SCAN CYCLE STARTING NOW 🚀🚀🚀');
        //console.log('[ScanEngineService] 🔍 ===== SCAN_CYCLE ENTRY =====');
        //console.log('[ScanEngineService] 🔍 scanCycle called at:', new Date().toISOString());
        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] STEP 0: scanCycle entry point reached');
        //console.log('[ScanEngineService] 🔍 Scanner state:', {
            //isRunning: this.scannerService.state.isRunning,
            //isScanning: this.scannerService.state.isScanning,
            //isInitialized: this.scannerService.state.isInitialized
        //});
        
        this.addLog('🚀 Scan cycle started', 'cycle');

        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] STEP 0.1: Checking scanner state conditions...');
        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] isRunning:', this.scannerService.state.isRunning);
        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] isHardResetting:', this.scannerService.isHardResetting);
        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] isScanning:', this.scannerService.state.isScanning);

        if (!this.scannerService.state.isRunning) {
            console.warn('[ScanEngineService] 🔍 [EXECUTION_TRACE] EARLY RETURN: Scanner is not running.');
            this.scannerService.state.isScanning = false;
            return;
        }

        if (this.scannerService.isHardResetting) {
            console.warn('[ScanEngineService] 🔍 [EXECUTION_TRACE] EARLY RETURN: Hard reset in progress.');
            this.scannerService.state.isScanning = false;
            return;
        }

        if (this.scannerService.state.isScanning) {
            console.warn('[ScanEngineService] 🔍 [EXECUTION_TRACE] EARLY RETURN: Scan already in progress.');
            return;
        }

        //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] STEP 0.2: All state checks passed, continuing...');


        this.scannerService.state.isScanning = true;
        // OPTIMIZATION: Reduce notification frequency during scan cycles
        // Only notify at critical points to prevent UI blocking
        this.scannerService.notifySubscribers(); // Notify UI that scanning has started

        const cycleStartTime = Date.now();
        let phaseTimings = {};

        this.scannerService.state.lastScanTime = Date.now();
        
        this.scannerService.state.stats.totalScans++; // Increment total scans for this tab instance
        
        this.scannerService.state.stats.lastScanStartTime = new Date().toISOString();
        
        this.scannerService.state.nextScanTime = null;
        
        this.scannerService.state.newPositionsCount = 0; // Reset new positions count for this cycle

        console.log(`[AutoScannerService] [SCAN_CYCLE] 🔄 Starting scan cycle #${this.scannerService.state.stats.totalScanCycles + 1}`);
        console.log(`[AutoScannerService] [SCAN_CYCLE] 🔍 Scanner state:`, {
            isRunning: this.scannerService.state.isRunning,
            isScanning: this.scannerService.state.isScanning,
            availableBalance: this.scannerService.state.walletSummary?.availableBalance,
            balanceInTrades: this.scannerService.state.walletSummary?.balanceInTrades,
            positionsCount: this.scannerService.positionManager.positions.length
        });

        console.log(`[AutoScannerService] 🔄 Starting new scan cycle #${this.scannerService.state.stats.totalScanCycles + 1}...`);
        // OPTIMIZATION: Removed redundant notifySubscribers() call

        
        let cycleStats = {
            combinationsEvaluated: 0,
            combinationsMatched: 0,
            positionsOpened: 0,
            positionsBlocked: [],
            marketRegime: this.scannerService.state.marketRegime ? { ...this.scannerService.state.marketRegime } : null,
            strategiesProcessed: 0,
            strategiesSkipped: 0,
            skipReasons: {},
            blockReasons: {}
        };

        try {
            // NEW: Pre-scan leadership check
            if (this.scannerService.state.isRunning) {
                const hasLeadership = await this.scannerService.sessionManager.verifyLeadership();
                if (!hasLeadership) {
                    console.warn('[AutoScannerService] ⚠️ Lost leadership during scan - another tab is now active. Stopping scanner.');
                    this.scannerService.stop();
                    return;
                }
            }

            await this.scannerService.positionManager.waitForWalletSave(60000);

            // PHASE 1: Market Regime Detection & F&G Index
            const regimeStartTime = Date.now();
            console.log('[AutoScannerService] 🌡️ Detecting market regime and fetching F&G Index...');
            const regimeData = await this.scannerService.marketRegimeService._detectMarketRegime();
            phaseTimings.regimeDetection = Date.now() - regimeStartTime;

            if (!regimeData) {
                console.error('[AutoScannerService] ❌ Failed to detect market regime, skipping cycle.');
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }

            const { regime, confidence } = regimeData;
            console.log(`[AutoScannerService] 📊 Market Regime: ${regime.toUpperCase()} (${confidence.toFixed(1)}% confidence)`);
            
            cycleStats.marketRegime = this.scannerService.state.marketRegime ? { ...this.scannerService.state.marketRegime } : null;

            
            if (confidence < this.scannerService.state.settings.minimumRegimeConfidence) {
                console.warn(`[ScanEngineService] ⚠️ Regime confidence ${confidence.toFixed(1)}% below threshold (${this.scannerService.state.settings.minimumRegimeConfidence}%). Skipping strategy evaluation.`);
                console.log('[ScanEngineService] 🔍 EARLY RETURN: Regime confidence too low, skipping entire scan cycle');
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }
            
            console.log('[ScanEngineService] 🔍 Regime confidence check passed, continuing with scan cycle...');

            // PHASE 2: Price Fetching
            const priceStartTime = Date.now();
            console.log('[ScanEngineService] 🔍 ===== PRICE_FETCHING_PHASE =====');
            console.log('[AutoScannerService] 💰 Fetching current prices for strategies and positions...');
            console.log('[ScanEngineService] 🔍 About to call _consolidatePrices...');
            await this.scannerService.priceManagerService._consolidatePrices();
            console.log('[ScanEngineService] 🔍 _consolidatePrices completed');
            phaseTimings.priceFetching = Date.now() - priceStartTime;
            console.log('[ScanEngineService] 🔍 Price fetching phase completed, moving to position monitoring...');

            // PHASE 3: Position Monitoring and Reconciliation
            const monitoringStartTime = Date.now();
            console.log('[ScanEngineService] 🔍 ===== POSITION_MONITORING_PHASE =====');
            console.log('[ScanEngineService] 🔍 About to call _monitorPositions...');
            console.log('[ScanEngineService] 🔍 Current prices object:', this.scannerService.priceManagerService.currentPrices);
            console.log('[ScanEngineService] 🔍 Price keys count:', Object.keys(this.scannerService.priceManagerService.currentPrices || {}).length);
            console.log('[ScanEngineService] 🔍 PositionManager exists:', !!this.scannerService.positionManager);
            console.log('[ScanEngineService] 🔍 Positions array exists:', !!this.scannerService.positionManager?.positions);
            console.log('[ScanEngineService] 🔍 Positions count:', this.scannerService.positionManager?.positions?.length || 0);
            console.log('[AutoScannerService] 👀 Monitoring open positions and reconciling...');
            
            try {
                console.log('[ScanEngineService] 🔍 CALLING _monitorPositions NOW...');
                await this._monitorPositions(cycleStats);
                console.log('[ScanEngineService] 🔍 _monitorPositions completed successfully');
            } catch (monitorError) {
                console.error('[ScanEngineService] ❌ ERROR in _monitorPositions:', monitorError);
                console.error('[ScanEngineService] ❌ Error stack:', monitorError.stack);
                throw monitorError;
            }
            
            phaseTimings.positionMonitoring = Date.now() - monitoringStartTime;

            console.log('[ScanEngineService] 🔍 Position monitoring phase completed, checking for hard reset...');
            
            if (this.scannerService.isHardResetting) {
                console.warn('[ScanEngineService] 🔍 Cycle aborted after position monitoring due to hard reset.');
                this.scannerService.state.isScanning = false;
                // OPTIMIZATION: Only notify at critical state changes
                this.scannerService.notifySubscribers();
                return;
            }
            
            console.log('[ScanEngineService] 🔍 No hard reset detected, continuing with scan cycle...');

            // NEW: Single summary check to avoid strategy evaluation when funds below minimum
            const availableUsdt = this.scannerService._getAvailableUsdt();
            const minTrade = this.scannerService.state?.settings?.minimumTradeValue || 10;

            if (availableUsdt < minTrade) {
                const formattedAvailableUsdt = this.scannerService._formatCurrency(availableUsdt);
                const formattedMinTrade = this.scannerService._formatCurrency(minTrade);
                this.addLog(
                    `[FUNDS] Free balance ${formattedAvailableUsdt} is below minimum trade size ${formattedMinTrade}. Skipping new position search this cycle.`,
                    'info'
                );

                // Continue with maintenance tasks but skip strategy evaluation
                // PHASE 6: Trade Archiving
                const archivingStartTime = Date.now();
                await this.scannerService._archiveOldTradesIfNeeded();
                // PHASE 7: Performance Snapshot & Wallet Update
                const snapshotStartTime = Date.now();
                await this.scannerService._updatePerformanceSnapshotIfNeeded(cycleStats);

                // Emit end-of-cycle summary before exiting this cycle early
                await this._logCycleSummary(cycleStats);

                // finalize (rest of scanCycle will handle timers/stats)
                return;
            }

            // NEW: Check max invest cap but don't block entire scan cycle
            const capUsdt = Number(this.scannerService.state?.settings?.maxBalanceInvestCapUSDT || 0);
            let maxCapReached = false;
            console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - Starting max cap check...');
            console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - Cap USDT:', capUsdt);
            
            if (capUsdt > 0) {
                const allocatedNow = this.scannerService._getBalanceAllocatedInTrades();
                console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - Allocated now:', allocatedNow);
                console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - Comparison:', allocatedNow, '>=', capUsdt);
                
                if (allocatedNow >= capUsdt) {
                    console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - MAX CAP REACHED!');
                    this.addLog(
                        `[FUNDS] Max invest cap reached: allocated ${this.scannerService._formatCurrency(allocatedNow)} ≥ cap ${this.scannerService._formatCurrency(capUsdt)}. Will skip opening new positions but continue monitoring existing positions.`,
                        'warning'
                    );
                    maxCapReached = true;
                } else {
                    console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - Cap not reached, continuing normally');
                }
            } else {
                console.log('[ScanEngineService] 🔍 MAX_CAP_CHECK - No cap set, continuing normally');
            }

            // PHASE 4: Strategy Loading
            const strategyLoadStartTime = Date.now();
            console.log('[AutoScannerService] 📋 Loading active strategies...');
            const strategies = await this._loadStrategies();
            console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} strategies`);
            phaseTimings.strategyLoading = Date.now() - strategyLoadStartTime;

            if (!strategies || strategies.length === 0) {
                console.warn('[AutoScannerService] ⚠️ No active strategies found');
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }
            console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} active strategies`);

            // PHASE 5: Strategy Evaluation & Signal Detection - OPTIMIZED
            const evaluationStartTime = Date.now();
            console.log('[AutoScannerService] 🔍 Evaluating strategies and detecting signals...');
            console.log('[AutoScannerService] 🔍 Evaluation inputs:', {
                strategiesCount: strategies.length,
                maxCapReached: maxCapReached,
                availableBalance: this._getCurrentWalletState().availableBalance,
                currentPricesCount: Object.keys(this.scannerService.priceManagerService.currentPrices).length
            });
            
            // OPTIMIZATION: Use requestIdleCallback for heavy computations to prevent UI blocking
            const scanResult = await new Promise((resolve) => {
                const performEvaluation = async () => {
                    try {
                        console.log('[AutoScannerService] 🔍 Starting strategy evaluation...');
                        const result = await this._evaluateStrategies(
                            strategies,
                            this._getCurrentWalletState(),
                            this.scannerService.state.settings,
                            this.scannerService.state.marketRegime,
                            this.scannerService.priceManagerService.currentPrices,
                            cycleStats,
                            maxCapReached
                        );
                        console.log('[AutoScannerService] 🔍 Strategy evaluation result:', result);
                        resolve(result);
                    } catch (error) {
                        console.error('[AutoScannerService] ❌ Strategy evaluation failed:', error);
                        resolve({ signalsFound: 0, tradesExecuted: 0, combinationsEvaluated: 0 });
                    }
                };

                // Use requestIdleCallback if available, otherwise execute immediately
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(performEvaluation, { timeout: 1000 });
                } else {
                    // Fallback for browsers without requestIdleCallback
                    setTimeout(performEvaluation, 0);
                }
            });
            
            phaseTimings.strategyEvaluation = Date.now() - evaluationStartTime;

            if (this.scannerService.isHardResetting) {
                console.warn('[AutoScannerService] Cycle aborted after signal detection.');
                this.scannerService.state.isScanning = false;
                // OPTIMIZATION: Only notify at critical state changes
                this.scannerService.notifySubscribers();
                return;
            }

            // PHASE 6: Trade Archiving
            const archivingStartTime = Date.now();
            console.log('[AutoScannerService] 📦 Archiving old trades...');
            await this.scannerService._archiveOldTradesIfNeeded();
            phaseTimings.tradeArchiving = Date.now() - archivingStartTime;

            // PHASE 7: Performance Snapshot & Wallet Update
            const snapshotStartTime = Date.now();
            console.log('[AutoScannerService] 📈 Updating performance metrics and wallet state...');
            await this.scannerService._updatePerformanceSnapshotIfNeeded(cycleStats);
            phaseTimings.performanceSnapshot = Date.now() - snapshotStartTime;

            const summaryMessage = `✅ Scan cycle complete: ${scanResult.signalsFound} signals found, ${scanResult.tradesExecuted} trades executed.`;
            console.log(`[AutoScannerService] ${summaryMessage}`);

            // Emit end-of-cycle summary logs (wallet snapshot, metrics, blocked reasons, etc.)
            await this._logCycleSummary(cycleStats);

        } catch (error) {
            const isCriticalError = error.message && (
                error.message.includes('database') ||
                error.message.includes('initialization') ||
                error.message.includes('configuration') ||
                (error.message.includes('network') && !error.message.includes('insufficient balance'))
            );

            if (isCriticalError) {
                console.error(`[AutoScannerService] 💥 CRITICAL ERROR in scan cycle: ${error.message}`, error);
                console.error(`[AutoScannerService] 🛑 STOPPING SCANNER due to critical error. Stack trace: ${error.stack}`);

                this.scannerService.stop();

                if (this.scannerService.toast) {
                    this.scannerService.toast({
                        title: "Scanner Stopped - Critical Error",
                        description: `Scanner has been stopped due to critical error: ${error.message}`,
                        variant: "destructive"
                    });
                }

                console.error(`[AutoScannerService] 🔴 Scanner has been STOPPED due to critical error. Please review the error and manually restart if needed.`);
            } else {
                console.warn(`[AutoScannerService] ⚠️ Non-critical error in scan cycle: ${error.message}. Scanner will continue.`, error);
            }
            this.scannerService.state.error = error.message;
            this.scannerService.state.errorSource = 'scanCycle';
        } finally {
            // Update stats
            const scanDuration = Date.now() - cycleStartTime;
            this.scannerService.state.stats.totalScanCycles++;
            this.scannerService.state.stats.lastScanTimeMs = scanDuration;

            // Update rolling average
            if (this.scannerService.state.stats.averageScanTimeMs === 0) {
                this.scannerService.state.stats.averageScanTimeMs = scanDuration;
            } else {
                this.scannerService.state.stats.averageScanTimeMs = (this.scannerService.state.stats.averageScanTimeMs * 0.8) + (scanDuration * 0.2);
            }

            console.log(`[AutoScannerService] ⏱️ Scan cycle completed in ${(scanDuration / 1000).toFixed(2)}s (avg: ${(this.scannerService.state.stats.averageScanTimeMs / 1000).toFixed(2)}s)`, { duration: scanDuration });

            // NEW: Persist updated stats to localStorage immediately after cycle completion
            this.scannerService._saveStateToStorage();

            this.scannerService.state.isScanning = false;

            // NEW: Notify subscribers immediately after stats update to ensure UI reflects changes
            this.scannerService.notifySubscribers();

            if (this.scannerService.state.isRunning) {
                try {
                    await this.scannerService.sessionManager.claimLeadership();
                } catch (heartbeatError) {
                    console.warn(`[AutoScannerService] ⚠️ Post-scan heartbeat failed: ${heartbeatError.message}`);
                }
            }

            console.log('[ScanEngineService] 🔍 ===== CHECKING IF SHOULD START COUNTDOWN =====');
            console.log('[ScanEngineService] 🔍 isRunning:', this.scannerService.state.isRunning);
            console.log('[ScanEngineService] 🔍 isHardResetting:', this.scannerService.isHardResetting);
            console.log('[ScanEngineService] 🔍 Should start countdown:', this.scannerService.state.isRunning && !this.scannerService.isHardResetting);
            
            if (this.scannerService.state.isRunning && !this.scannerService.isHardResetting) {
                console.log('[ScanEngineService] 🔍 CALLING _startCountdown() NOW...');
                this.scannerService._startCountdown();
                console.log('[ScanEngineService] 🔍 _startCountdown() completed');
            } else {
                console.log('[ScanEngineService] ⏸️ Not starting new countdown as scanner is stopped or resetting.');
                console.log('[ScanEngineService] ⏸️ Reason:', !this.scannerService.state.isRunning ? 'Scanner not running' : 'Scanner is hard resetting');
            }

            // Final notification at end of cycle
            this.scannerService.notifySubscribers();
            console.log('[AutoScannerService] ===== SCAN CYCLE COMPLETE =====');
            this.addLog('✅ Scan cycle completed successfully', 'cycle');
        }
    }

    /**
     * Helper method to load active strategies.
     * OPTIMIZED: Uses internal method for faster loading without external dependencies.
     * @returns {Array} List of active strategies.
     */
    async _loadStrategies() {
        console.log('[AutoScannerService] 📋 Loading strategies...');

        // OPTIMIZATION: Use internal method to avoid duplicate database calls
        const strategies = await this.scannerService.strategyManager._loadAndFilterStrategiesInternal();

        // CRITICAL FIX: Build activeStrategies map for PositionManager lookups
        const activeStrategiesMap = new Map();
        strategies.forEach(strategy => {
            if (strategy.combinationName) {
                activeStrategiesMap.set(strategy.combinationName, strategy);
            }
        });

        // CRITICAL: Ensure PositionManager has access to the activeStrategies map
        if (this.scannerService.positionManager) {
            this.scannerService.positionManager.activeStrategies = activeStrategiesMap;
            console.log(`[AutoScannerService] ✅ Updated PositionManager with ${activeStrategiesMap.size} strategies`);
        }

        // Fix: Ensure SignalDetectionEngine is updated with the latest strategies
        if (this.scannerService.signalDetectionEngine && typeof this.scannerService.signalDetectionEngine.updateStrategies === 'function') {
            this.scannerService.signalDetectionEngine.updateStrategies(strategies);
            console.log(`[AutoScannerService] ✅ Updated SignalDetectionEngine with ${strategies.length} strategies`);
        }

        console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} strategies`);

        return strategies;
    }

    /**
     * Helper method for position monitoring, reconciliation, and executing queued orders.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _monitorPositions(cycleStats) {
        console.log('[ScanEngineService] [MONITOR] 🔍 ===== _MONITOR_POSITIONS ENTRY =====');
        console.log('[ScanEngineService] [MONITOR] 🔍 _monitorPositions called with cycleStats:', !!cycleStats);
        console.log('[ScanEngineService] [MONITOR] 🔍 isHardResetting:', this.scannerService.isHardResetting);
        console.log('[ScanEngineService] [MONITOR] 🔍 scannerService exists:', !!this.scannerService);
        console.log('[ScanEngineService] [MONITOR] 🔍 About to check isHardResetting condition...');
        
        // TEMPORARY FIX: Force reset isHardResetting if it's stuck
        if (this.scannerService.isHardResetting) {
            console.log('[ScanEngineService] [MONITOR] 🔍 isHardResetting is true, but forcing it to false to allow position monitoring...');
            this.scannerService.isHardResetting = false;
            console.log('[ScanEngineService] [MONITOR] 🔍 isHardResetting reset to false, continuing with position monitoring...');
        }
        
        console.log('[ScanEngineService] [MONITOR] 🔍 About to call monitorAndClosePositions...');
        console.log('[ScanEngineService] [MONITOR] 🔍 Current prices available:', Object.keys(this.scannerService.priceManagerService.currentPrices || {}).length);
        console.log('[ScanEngineService] [MONITOR] 🔍 PositionManager available:', !!this.scannerService.positionManager);
        console.log('[ScanEngineService] [MONITOR] 🔍 Positions in memory:', this.scannerService.positionManager?.positions?.length || 0);
        
        console.log('[ScanEngineService] [MONITOR] 🔍 isHardResetting check passed, continuing with position monitoring...');

        console.log('[AutoScannerService] [MONITOR] 🔍 Monitoring open positions...');
        console.log('[AutoScannerService] [MONITOR] 🔍 Scanner state:', {
            isRunning: this.scannerService.state.isRunning,
            isScanning: this.scannerService.state.isScanning,
            positionsCount: this.scannerService.positionManager.positions.length
        });

        console.log('[ScanEngineService] [MONITOR] 🔍 About to call monitorAndClosePositions...');
        console.log('[ScanEngineService] [MONITOR] 🔍 Current prices available:', Object.keys(this.scannerService.priceManagerService.currentPrices || {}).length);
        console.log('[ScanEngineService] [MONITOR] 🔍 PositionManager available:', !!this.scannerService.positionManager);
        console.log('[ScanEngineService] [MONITOR] 🔍 Positions in memory:', this.scannerService.positionManager?.positions?.length || 0);
        console.log('[ScanEngineService] [MONITOR] 🔍 About to call positionManager.monitorAndClosePositions...');
        console.log('[ScanEngineService] [MONITOR] 🔍 Function exists:', typeof this.scannerService.positionManager.monitorAndClosePositions);
        
        let monitorResult;
        try {
            //console.log('[ScanEngineService] [MONITOR] 🔍 CALLING monitorAndClosePositions NOW...');
            //console.log('[ScanEngineService] [MONITOR] 🔍 Function exists:', typeof this.scannerService.positionManager.monitorAndClosePositions);
            //console.log('[ScanEngineService] [MONITOR] 🔍 PositionManager object:', !!this.scannerService.positionManager);
            //console.log('[ScanEngineService] [MONITOR] 🔍 PositionManager constructor:', this.scannerService.positionManager?.constructor?.name);
            //console.log('[ScanEngineService] [MONITOR] 🔍 About to call the function...');
            //console.log('[ScanEngineService] 🔍 [EXECUTION_TRACE] step_1: About to call monitorAndClosePositions');
            
            // Add a timeout to catch if the function hangs - increased to 90 seconds to allow executeBatchClose (60s) + buffer
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('monitorAndClosePositions timeout after 90 seconds')), 90000);
            });
            
            const monitorPromise = this.scannerService.positionManager.monitorAndClosePositions(this.scannerService.priceManagerService.currentPrices);
            
            const _step2_start = Date.now();
            monitorResult = await Promise.race([monitorPromise, timeoutPromise]);
            
            //console.log('[ScanEngineService] [MONITOR] 🔍 [EXECUTION_TRACE] step_2: monitorAndClosePositions completed successfully');
            //console.log('[ScanEngineService] [MONITOR] 🔍 monitorAndClosePositions result:', monitorResult);
            //console.log('[ScanEngineService] [MONITOR] 🔍 Result type:', typeof monitorResult);
            //console.log('[ScanEngineService] [MONITOR] 🔍 Result success:', monitorResult?.success);
        } catch (monitorError) {
            console.error('[ScanEngineService] [MONITOR] ❌ Error calling monitorAndClosePositions:', monitorError);
            console.error('[ScanEngineService] [MONITOR] ❌ Error type:', typeof monitorError);
            console.error('[ScanEngineService] [MONITOR] ❌ Error message:', monitorError?.message);
            console.error('[ScanEngineService] [MONITOR] ❌ Error stack:', monitorError.stack);
            console.error('[ScanEngineService] [MONITOR] ❌ PositionManager state:', {
                exists: !!this.scannerService.positionManager,
                positions: this.scannerService.positionManager?.positions?.length || 0,
                isMonitoring: this.scannerService.positionManager?.isMonitoring
            });
            throw monitorError;
        } finally {
            try {
                console.log('[ScanEngineService] [MONITOR] ✅ [EXECUTION_TRACE] step_2_final: monitorAndClosePositions finished');
            } catch (_) {}
        }

        if (monitorResult && monitorResult.tradesToCreate && monitorResult.tradesToCreate.length > 0) {
            console.log(`[AutoScannerService] [MONITOR] 💰 ${monitorResult.tradesToCreate.length} position(s) ready to close`);
        }

        // CRITICAL FIX: executeBatchOpen doesn't exist - positions are opened in _evaluateStrategies
        // Only refresh wallet if trades were closed (not opened here)
        const tradesWereClosed = (monitorResult?.tradesToCreate.length > 0);

        if (tradesWereClosed) {
            console.log('[AutoScannerService] [MONITOR] 🔄 Refreshing wallet state after trade execution...');

            try {
                // Step 1: Sync with Binance to get latest balances
                await this.scannerService.walletManagerService.initializeLiveWallet();

                // Step 2: Recalculate wallet summary with fresh data
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.priceManagerService.currentPrices
                );

                // Step 3: Persist to localStorage for immediate UI access
                await this.scannerService._persistLatestWalletSummary();

                // Step 4: Notifying UI components
                this.scannerService.notifyWalletSubscribers();

                console.log('[AutoScannerService] [MONITOR] ✅ Wallet state refreshed successfully');
            } catch (refreshError) {
                console.error('[AutoScannerService] ❌ Failed to refresh wallet after trades:', refreshError);
                console.warn(`[AutoScannerService] [MONITOR] ⚠️ Wallet refresh warning: ${refreshError.message}`);
            }
        }

        const currentWalletState = this.scannerService.walletManagerService?.getCurrentWalletState() || this._getCurrentWalletState();
        const usdtBalanceObject = (currentWalletState?.balances || []).find(b => b.asset === 'USDT');
        const availableUsdt = parseFloat(usdtBalanceObject?.free || '0');
        const lockedUsdt = parseFloat(usdtBalanceObject?.locked || '0');
        // CRITICAL FIX: Get actual open positions count from PositionManager's internal cache
        const walletPositionsCount = this.scannerService.positionManager.positions.length;

        console.log(`[AutoScannerService] 💰 Using ${this.scannerService.state.tradingMode.toUpperCase()} wallet state. USDT Balance: ${this.scannerService._formatCurrency(availableUsdt)} | Positions: ${walletPositionsCount}`);

        // Run full reconciliation every 5 scans
        if (this.scannerService.state.stats.totalScans % 5 === 0 && this.scannerService.state.stats.totalScans > 0) {
            console.log('[AutoScannerService] [RECONCILE] 🔄 Performing periodic reconciliation with Binance...');
            try {
                const reconcileResult = await this.scannerService.positionManager.reconcileWithBinance();
                if (reconcileResult.success && reconcileResult.summary) {
                    const s = reconcileResult.summary;
                    console.log(`[AutoScannerService] [RECONCILE] ✅ Sync complete: ${s.positionsRemaining} positions, ${s.ghostPositionsCleaned} ghosts cleaned, ${s.externalOrders || 0} external orders`);
                } else if (!reconcileResult.success) {
                    console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation failed: ${reconcileResult.error || 'Unknown issue'}. Continuing with scan cycle.`);
                } else {
                    console.log('[AutoScannerService] [RECONCILE] ℹ️ Reconciliation completed with no specific summary (likely no changes)');
                }
            } catch (reconcileError) {
                console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation error: ${reconcileError.message}`);
            }
        }

        if (this.scannerService.state.stats.totalScans % 10 === 0 && this.scannerService.state.stats.totalScans > 0) {
            //this.addLog('[RECONCILE] 🔄 Performing position data reconciliation...', 'system');
            const reconcileResult = await this.scannerService.positionManager.reconcilePositionData();
            if (reconcileResult.cleaned > 0) {
                //this.addLog(`[RECONCILE] ✅ Cleaned up ${reconcileResult.cleaned} stale position records.`, 'success');
            }
            if (reconcileResult.errors.length > 0) {
                console.log(`[AutoScannerService] [RECONCILE] ℹ️ Found ${reconcileResult.errors.length} position data issues`);
            }
        }

        // Run Fear & Greed Index update every 10 scans
        if (this.scannerService.state.stats.totalScans % 10 === 0 && this.scannerService.state.stats.totalScans > 0) {
            try {
                await this.scannerService._fetchFearAndGreedIndex();
                const fngData = this.scannerService.state.fearAndGreedData;
                if (fngData) {
                    console.log(`[AutoScannerService] [F&G_INDEX] ✅ Updated: ${fngData.value} (${fngData.value_classification})`);
                    this.addLog(`[F&G Index] ✅ Updated: ${fngData.value} (${fngData.value_classification})`, 'system');
                } else {
                    console.warn('[ScanEngineService] [F&G_INDEX] ⚠️ No F&G data after fetch');
                }
            } catch (fngError) {
                console.warn(`[AutoScannerService] [F&G_INDEX] ⚠️ Fear & Greed update failed: ${fngError.message}`);
                console.error('[ScanEngineService] [F&G_INDEX] ❌ Fear & Greed fetch error:', fngError);
            }
        }

        // Run wallet state reconciliation every 20 scans
        if (this.scannerService.state.stats.totalScans % 20 === 0 && this.scannerService.state.stats.totalScans > 0) {
            try {
                const walletReconcileResult = await queueFunctionCall(
                    'reconcileWalletState',
                    reconcileWalletState,
                    { mode: this.scannerService.state.tradingMode },
                    'normal',
                    null,
                    0,
                    30000
                );
                
                if (walletReconcileResult.success) {
                    const changes = walletReconcileResult.changes;
                    if (changes.trades_diff !== 0 || changes.pnl_diff !== 0) {
                        console.log(`[AutoScannerService] [WALLET_RECONCILE] ✅ Wallet state reconciled: ${changes.trades_diff} trades diff, ${changes.pnl_diff.toFixed(2)} PnL diff`);
                        this.addLog(`[WALLET_RECONCILE] ✅ Reconciled wallet state: ${changes.trades_diff} trades, ${changes.pnl_diff.toFixed(2)} PnL`, 'system');
                    } else {
                        console.log('[AutoScannerService] [WALLET_RECONCILE] ✅ Wallet state is consistent');
                    }
                } else {
                    console.warn(`[AutoScannerService] [WALLET_RECONCILE] ⚠️ Wallet reconciliation failed: ${walletReconcileResult.error || 'Unknown issue'}`);
                }
            } catch (walletReconcileError) {
                console.warn(`[AutoScannerService] [WALLET_RECONCILE] ⚠️ Wallet reconciliation error: ${walletReconcileError.message}`);
            }
        }

        // Monitor pending orders every 5 scans
        if (this.scannerService.state.stats.totalScans % 5 === 0 && this.scannerService.state.stats.totalScans > 0) {
            console.log('[AutoScannerService] [ORDER_MONITOR] 🔍 Checking pending orders...');
            try {
                // Initialize order monitoring if not already done
                this.scannerService.positionManager.initializeOrderMonitoring();
                
                if (this.scannerService.positionManager.pendingOrderManager) {
                    const orderStats = this.scannerService.positionManager.pendingOrderManager.getStatistics();
                    if (orderStats.pending.count > 0) {
                        console.log(`[AutoScannerService] [ORDER_MONITOR] 📊 Pending orders: ${orderStats.pending.count}, Failed: ${orderStats.failed.count}`);
                        this.addLog(`[ORDER_MONITOR] 📊 Monitoring ${orderStats.pending.count} pending orders, ${orderStats.failed.count} failed`, 'info');
                    }
                    
                    // Clean up old failed orders
                    this.scannerService.positionManager.pendingOrderManager.cleanupOldFailedOrders();
                } else {
                    console.log('[AutoScannerService] [ORDER_MONITOR] ⚠️ PendingOrderManager not initialized yet');
                }
                
            } catch (orderMonitorError) {
                console.warn(`[AutoScannerService] [ORDER_MONITOR] ⚠️ Order monitoring error: ${orderMonitorError.message}`);
            }
        }

        // Run ghost position purging every 15 scans (DISABLED for testnet to prevent false positives)
        if (this.scannerService.state.stats.totalScans % 15 === 0 && this.scannerService.state.stats.totalScans > 0) {
            if (this.scannerService.state.tradingMode === 'mainnet') {
                console.log('[AutoScannerService] [GHOST_PURGE] 🔄 Performing ghost position purging for mainnet...');
                try {
                    const ghostPurgeResult = await queueFunctionCall(
                        'purgeGhostPositions',
                        purgeGhostPositions,
                        { 
                            mode: this.scannerService.state.tradingMode,
                            walletId: null // Purge all wallets
                        },
                        'normal',
                        null,
                        0,
                        30000
                    );
                    
                    if (ghostPurgeResult.success) {
                        const summary = ghostPurgeResult.summary;
                        if (ghostPurgeResult.purged > 0) {
                            console.log(`[AutoScannerService] [GHOST_PURGE] ✅ Ghost purge complete: ${ghostPurgeResult.purged} positions purged`);
                            this.addLog(`[GHOST_PURGE] ✅ Purged ${ghostPurgeResult.purged} ghost positions`, 'system');
                        } else {
                            console.log('[AutoScannerService] [GHOST_PURGE] ✅ No ghost positions found');
                        }
                    } else {
                        console.warn(`[AutoScannerService] [GHOST_PURGE] ⚠️ Ghost purge failed: ${ghostPurgeResult.error || 'Unknown issue'}`);
                    }
                } catch (ghostPurgeError) {
                    console.warn(`[AutoScannerService] [GHOST_PURGE] ⚠️ Ghost purge error: ${ghostPurgeError.message}`);
                }
            } else {
                console.log('[AutoScannerService] [GHOST_PURGE] ⚠️ Ghost purging disabled for testnet mode to prevent false positives');
            }
        }

        // NOTE: monitorAndClosePositions is already called above (line 410) and handles executeBatchClose internally
        // No need for duplicate calls here
    }

    /**
     * Helper method to evaluate strategies and detect signals.
     * This method now delegates the core evaluation to StrategyManagerService.
     * @param {Array} strategies - List of active strategies.
     * @param {object} currentWalletState - The current wallet state.
     * @param {object} settings - Scanner settings.
     * @param {object} marketRegime - Current market regime data.
     * @param {object} currentPrices - Current market prices.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     * @returns {object} Scan result from signal detection ({ signalsFound, tradesExecuted }).
     */
    async _evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats, maxCapReached = false) {
        if (this.scannerService.isHardResetting) return { signalsFound: 0, tradesExecuted: 0 };

        // If max cap is reached, skip strategy evaluation but continue monitoring
        if (maxCapReached) {
            console.log('[AutoScannerService] [STRATEGY] 🚫 Max investment cap reached - skipping strategy evaluation but continuing position monitoring');
            return { signalsFound: 0, tradesExecuted: 0, combinationsEvaluated: 0 };
        }

        // No need for separate balance check here, it's handled at the beginning of scanCycle()
        // If execution reaches here, sufficient funds are presumed.

        console.log('[AutoScannerService] [STRATEGY] 🎯 Evaluating trading strategies...');
        console.log('[AutoScannerService] [STRATEGY] 🔍 Strategy evaluation inputs:', {
            strategiesCount: strategies.length,
            availableBalance: currentWalletState.availableBalance,
            currentPricesCount: Object.keys(currentPrices).length,
            maxCapReached: maxCapReached
        });

        // Check if strategies are empty (corresponds to coinsData check in outline)
        if (!strategies || strategies.length === 0) {
            console.warn('[AutoScannerService] [STRATEGY] ⚠️ No active strategies available for evaluation');
            return { signalsFound: 0, tradesExecuted: 0 }; // Consistent with old return
        }

        // Delegate to StrategyManagerService
        console.log('[AutoScannerService] [STRATEGY] 🔍 Delegating to StrategyManagerService...');
        const scanResult = await this.scannerService.strategyManager.evaluateStrategies(
            strategies,
            currentWalletState,
            settings,
            marketRegime,
            currentPrices,
            cycleStats
        );
        console.log('[AutoScannerService] [STRATEGY] 🔍 StrategyManagerService result:', scanResult);

        console.log('[AutoScannerService] [AutoScannerService] 📊 Strategy evaluation complete.', {
            signalsFound: scanResult.signalsFound,
            tradesExecuted: scanResult.tradesExecuted,
            newPositionsOpened: this.scannerService.state.newPositionsCount
        });

        // Update signal generation history (original logic)
        this.scannerService.state.signalGenerationHistory.push({
            timestamp: Date.now(),
            signalsFound: scanResult.signalsFound,
        });
        if (this.scannerService.state.signalGenerationHistory.length > SCANNER_DEFAULTS.maxSignalHistory) {
            this.scannerService.state.signalGenerationHistory.shift();
        }

        // Apply wallet refresh logic from outline based on newPositionsCount
        if (this.scannerService.state.newPositionsCount > 0) {
            console.log('[AutoScannerService] [STRATEGY] 🔄 Refreshing wallet state after opening positions...');
            try {
                // Step 1: Sync with Binance to get latest balances
                await this.scannerService.walletManagerService.initializeLiveWallet();

                // Step 2: Recalculate wallet summary with fresh data
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.priceManagerService.currentPrices
                );

                // Step 3: Persist to localStorage for immediate UI access
                await this.scannerService._persistLatestWalletSummary();

                // Step 4: Notifying UI components
                this.scannerService.notifyWalletSubscribers();

                console.log('[AutoScannerService] [STRATEGY] ✅ Wallet state refreshed successfully');
            } catch (refreshError) {
                console.error('[AutoScannerService] ❌ Failed to refresh wallet after opening positions:', refreshError);
                console.warn(`[AutoScannerService] [STRATEGY] ⚠️ Wallet refresh warning: ${refreshError.message}`);
            }
        }

        return scanResult; // Return original expected structure for scanCycle
    }

    /**
     * Logs a comprehensive cycle summary including performance metrics and wallet status.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _logCycleSummary(cycleStats) {
        if (!this.scannerService.state.isRunning) {
            return;
        }

        const signalsFound = cycleStats.combinationsMatched;
        const tradesExecuted = cycleStats.positionsOpened;
        const positionsClosed = cycleStats.positionsClosed || 0;

        // New blocked breakdown header
        const blockReasons = cycleStats.blockReasons || {};
        const skipReasons = cycleStats.skipReasons || {};
        // Derive robust counts from heterogeneous reason keys/values
        let combinedStrengthBelow = 0;
        let convictionBelowDynamic = 0;
        let balanceBelowLimit = 0;
        let insufficientRemainingCap = 0;
        let regimeMismatch = 0;
        let otherBlocks = 0;

        const sumVal = (v) => {
            if (typeof v === 'number') return v;
            if (typeof v === 'string') return Number(v) || 1;
            if (Array.isArray(v)) return v.length;
            if (v && typeof v === 'object') {
                if (typeof v.count === 'number') return v.count;
                if (Array.isArray(v.items)) return v.items.length;
                // Generic object: count its enumerable keys if any
                const keys = Object.keys(v);
                return keys.length > 0 ? keys.length : 1;
            }
            if (v === true) return 1;
            return 0;
        };

        const absorbReason = (reason, value) => {
            const count = sumVal(value);
            const r = String(reason || '').toLowerCase();
            if (r.includes('combined') && r.includes('strength')) combinedStrengthBelow += count;
            else if (r.includes('conviction')) convictionBelowDynamic += count;
            else if (r.includes('insufficient') || (r.includes('remaining') && r.includes('balance'))) insufficientRemainingCap += count;
            else if (r.includes('balance') && r.includes('limit')) balanceBelowLimit += count;
            else if (r.includes('regime') && r.includes('mismatch')) regimeMismatch += count;
            else otherBlocks += count;
        };

        for (const [reason, value] of Object.entries(blockReasons)) {
            absorbReason(reason, value);
        }
        // Many pre-evaluation rejections are logged as skipReasons; include them too
        for (const [reason, value] of Object.entries(skipReasons)) {
            absorbReason(reason, value);
        }

        const blockedTotal = combinedStrengthBelow + convictionBelowDynamic + balanceBelowLimit + insufficientRemainingCap + regimeMismatch + otherBlocks;

        // Debug once per session to verify blockReasons shape
        try {
            if (typeof window !== 'undefined' && !window.__blockedReasonsSampled) {
                window.__blockedReasonsSampled = true;
                console.log('[BLOCK_REASONS_SAMPLE]', { blockReasons, combinedStrengthBelow, convictionBelowDynamic, balanceBelowLimit, insufficientRemainingCap, regimeMismatch, otherBlocks });
            }
        } catch(_) {}
        const baseConv = this.scannerService.state?.settings?.minimumConvictionScore ?? 50;
        const lpmScore = Math.round(this.scannerService.state?.performanceMomentumScore ?? 0);
        const lpmAdj = Math.max(0, Math.round(lpmScore / 10)); // e.g., 66 -> +6
        const dynConv = baseConv + lpmAdj;

        {
            const mrNow = this.scannerService.state?.marketRegime?.regime || 'unknown';
            const maxCap = this.scannerService.state?.settings?.maxBalanceInvestCapUSDT ?? 'N/A';
        
            const lines = [
                '═══════════════════════════════════════════════════════',
                `${blockedTotal} strategies were blocked`,
                `${combinedStrengthBelow} strategies blocked: combined strength below threshold`,
                `${convictionBelowDynamic} strategies blocked: conviction score below dynamic threshold (${dynConv}: base ${baseConv} + LPM ${lpmAdj})`,
                `${balanceBelowLimit} strategies blocked: balance below limit of ${maxCap}`,
                `${insufficientRemainingCap} strategies blocked: not enough remaining balance to threshold`,
                `${regimeMismatch} strategies blocked: regime mismatch (market: ${mrNow})`,
                `${otherBlocks} strategies blocked: other reasons`,
                '═══════════════════════════════════════════════════════'
            ];
        
            // Log each line separately
            for (const line of lines) {
                this.addLog(line, 'cycle');
            }
        }
        

        // Strategy evaluation summary
        const totalProcessed = cycleStats.totalStrategiesProcessed ?? 0;
        const evaluated = cycleStats.strategiesEvaluated ?? 0;
        const skipped = cycleStats.strategiesSkipped ?? Math.max(0, totalProcessed - evaluated);
        this.addLog(`📊 Strategy evaluation summary: ${totalProcessed} strategies processed (${evaluated} evaluated, ${skipped} skipped).`, 'cycle');
        this.addLog(`✅ Scan cycle complete: ${signalsFound} signals found, ${tradesExecuted || 0} trades executed, ${positionsClosed} positions detected for closure.`, 'cycle');
        this.addLog('', 'cycle');

        // Wallet summary will be printed below, followed by avg strength and momentum lines
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        try {
            if (!this.scannerService.walletManagerService.walletSummary || !this._getCurrentWalletState() || !this.scannerService.walletManagerService.walletSummary.lastUpdated || (Date.now() - new Date(this.scannerService.walletManagerService.walletSummary.lastUpdated).getTime() > 10000)) {
                await this.scannerService.walletManagerService.initializeLiveWallet();
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.priceManagerService.currentPrices
                );
                await this.scannerService._persistLatestWalletSummary();
            } else {
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.priceManagerService.currentPrices
                );
                await this.scannerService._persistLatestWalletSummary();
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
                const minConvictionThreshold = this.scannerService.state.settings?.minimumCombinedStrength || 50;
                this.addLog(`🚫 ${convictionBlocks} strategies blocked: Conviction score below threshold (${minConvictionThreshold})`, 'warning');
            }

            const sizeBlocks = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) => reason.toLowerCase().includes('calculated position size') || reason.toLowerCase().includes('is below minimum'))
                .reduce((sum, [, count]) => sum + count, 0);

            if (sizeBlocks > 0) {
                const minTradeValue = this.scannerService.state.settings?.minimumTradeValue || 10;
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
        }

        if (cycleStats.positionsOpened > 0) {
            this.addLog(`🚀 New Positions Opened: ${cycleStats.positionsOpened}`, 'success');
        } else if (cycleStats.combinationsMatched > 0) {
            this.addLog(`✅ Strategies Matches Found: ${cycleStats.combinationsMatched}`, 'info');
        }

        // Extra diagnostics at end of summary
        const avgStrength = this.scannerService.state?.stats?.lastCycleAverageSignalStrength
            ?? this.scannerService.state?.stats?.averageSignalStrength
            ?? cycleStats.averageCombinedStrength
            ?? null;
        if (avgStrength !== null) {
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
            this.addLog(`Scanned strategies avg strength: ${Number(avgStrength).toFixed(2)}`, 'cycle');
        }
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        // Performance momentum recap
        const ebr = Math.round(this.scannerService.state?.adjustedBalanceRiskFactor ?? 0);
        const volLabel = this.scannerService.state?.marketVolatility?.label || 'normal';
        const momentum = Math.round(this.scannerService.state?.performanceMomentumScore ?? 0);
        const decay = Math.round(this.scannerService.state?.momentumDecay ?? 100);
        this.addLog(`[PERFORMANCE_MOMENTUM] 🚀 Enhanced momentum updated: ${momentum} | EBR: ${ebr}% (max: ${(this.scannerService.state?.settings?.maxBalancePercentRisk ?? 100)}%) | Volatility: ${volLabel} | Risk Mitigation: Normal | Decay: ${decay}%`, 'cycle');
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        this.addLog('──────────────────────────────────────────────', 'cycle');
    }

    /**
     * Logs wallet summary information.
     */
    _logWalletSummary() {
        let summary = this.scannerService.walletManagerService?.walletSummary;
        if (!summary) {
            // Fallback to central wallet state so the attachment-style lines still show
            const ws = this._getCurrentWalletState?.() || {};
            summary = {
                totalEquity: ws.total_equity || 0,
                totalBalance: ws.total_balance || ws.available_balance || 0,
                availableBalance: ws.available_balance || 0,
                balanceInTrades: ws.balance_in_trades || 0,
                totalTrades: ws.total_trades || 0,
                winRate: ws.win_rate || 0,
                profitFactor: ws.profit_factor || 0,
                totalRealizedPnl: ws.total_realized_pnl || 0
            };
            // Also inform once that we used fallback
            this.addLog('[WALLET] No wallet summary available', 'info', { level: 1 });
        }

        const positions = this.scannerService.positionManager?.positions || [];

        // Compute unrealized from current positions
        let unrealizedPnl = 0;
        for (const position of positions) {
            const symbol = position.symbol.replace('/', '');
            const currentPrice = this.scannerService.priceManagerService.currentPrices[symbol];
            if (currentPrice && position.entry_price) {
                const pnl = (currentPrice - position.entry_price) * position.quantity_crypto;
                unrealizedPnl += pnl;
            }
        }
        // Realized PnL and trade metrics: prefer summary, then central wallet state
        const ws = this._getCurrentWalletState?.() || {};
        const realizedPnl = (summary.totalRealizedPnl ?? ws.total_realized_pnl ?? 0);

        const tradesCount = summary.totalTrades ?? ws.total_trades_count ?? ws.total_trades ?? 0;
        const wins = summary.winningTrades ?? ws.winning_trades_count ?? 0;
        const losses = summary.losingTrades ?? ws.losing_trades_count ?? 0;
        const winRateCalc = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
        const profitFactorCalc = (() => {
            const gp = summary.totalGrossProfit ?? ws.total_gross_profit ?? 0;
            const gl = summary.total_gross_loss ?? ws.total_gross_loss ?? 0;
            return gl > 0 ? (gp / gl) : 0;
        })();

        const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const mode = this.scannerService.state?.tradingMode?.toUpperCase?.() || 'UNKNOWN';
        const totalEquity = summary.totalEquity || 0;
        const utilization = totalEquity > 0 ? ((summary.balanceInTrades || 0) / totalEquity) * 100 : 0;
        const winRate = (summary.winRate ?? winRateCalc ?? 0).toFixed(1);
        const profitFactor = (summary.profitFactor ?? profitFactorCalc ?? 0).toFixed(2);

        this.addLog(`[WALLET] Mode: ${mode} | Total Equity: ${fmt(totalEquity)}`, 'cycle');
        this.addLog(`[WALLET] Total Trades: ${tradesCount} | Win Rate: ${winRate}% | Profit Factor: ${profitFactor}`, 'cycle');
        this.addLog(`[WALLET] Open Positions: ${positions.length} | Portfolio Utilization: ${utilization.toFixed(1)}%`, 'cycle');
        this.addLog(`[WALLET] Unrealized P&L: ${fmt(unrealizedPnl)} | Realized P&L: ${fmt(realizedPnl)}`, 'cycle');
    }

    /**
     * Resets the scan engine state.
     */
    resetState() {
        this.scanCycleTimes = [];
        this.addLog('[ScanEngineService] State reset.', 'system');
    }

    /**
     * Permanently delete all Trade records from proxy (DB + file) and clear client caches.
     */
    async deleteAllTrades() {
        try {
            const base = this.scannerService?.state?.settings?.local_proxy_url || 'http://localhost:3003';
            this.addLog('──────────── 📦 PURGE TRADES ────────────', 'system');
            this.addLog('[TRADES] Deleting all trades from proxy…', 'warning');
            const resp = await fetch(`${base}/api/trades`, { method: 'DELETE' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data?.success === false) {
                throw new Error(data?.error || `HTTP ${resp.status}`);
            }
            this.addLog(`[TRADES] ✅ ${data?.message || 'All trades deleted.'}`, 'success');

            // Clear any client-side caches that may reflect trades
            try {
                const ws = this._getCurrentWalletState?.();
                if (ws) {
                    ws.total_trades_count = 0;
                    ws.winning_trades_count = 0;
                    ws.losing_trades_count = 0;
                    ws.total_gross_profit = 0;
                    ws.total_gross_loss = 0;
                    ws.total_realized_pnl = 0;
                    ws.last_updated_timestamp = new Date().toISOString();
                }
            } catch (_) {}

            try {
                // Ask wallet manager to recompute summary post-purge
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.priceManagerService.currentPrices
                );
                await this.scannerService._persistLatestWalletSummary();
            } catch (e) {
                this.addLog(`[TRADES] ⚠️ Wallet summary refresh failed after purge: ${e.message}`, 'warning');
            }

            // Trigger front-end performance history refresh if available
            try {
                if (typeof window !== 'undefined' && typeof window.forceWalletRefresh === 'function') {
                    await window.forceWalletRefresh();
                    this.addLog('[TRADES] 🔄 Forced wallet/performance refresh in UI', 'system');
                }
            } catch (_) {}
        } catch (err) {
            this.addLog(`[TRADES] ❌ Failed to delete all trades: ${err.message}`, 'error');
            throw err;
        }
    }

    /**
     * Deletes all HistoricalPerformance records for the given mode and forces a UI refresh.
     */
    async clearPerformanceHistory(mode = 'testnet') {
        try {
            const base = this.scannerService?.state?.settings?.local_proxy_url || 'http://localhost:3003';
            // 1) Fetch all daily/hourly records for mode
            const resp = await fetch(`${base}/api/entities/HistoricalPerformance/filter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            const list = await resp.json();
            const records = Array.isArray(list?.data) ? list.data : [];
            if (records.length === 0) {
                this.addLog('[PERF] No HistoricalPerformance records to delete', 'system');
            } else {
                const ids = records.map(r => r.id);
                const del = await fetch(`${base}/api/entities/HistoricalPerformance`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                const res = await del.json().catch(() => ({}));
                if (del.ok && res?.success !== false) {
                    this.addLog(`[PERF] ✅ Deleted ${ids.length} HistoricalPerformance records`, 'success');
                } else {
                    throw new Error(res?.error || `HTTP ${del.status}`);
                }
            }

            // 2) Force UI refresh so charts clear immediately
            try {
                if (typeof window !== 'undefined' && typeof window.forceWalletRefresh === 'function') {
                    await window.forceWalletRefresh();
                    this.addLog('[PERF] 🔄 Forced wallet/performance refresh in UI', 'system');
                }
            } catch (_) {}
        } catch (e) {
            this.addLog(`[PERF] ❌ Failed to clear performance history: ${e.message}`, 'error');
            throw e;
        }
    }
}

export default ScanEngineService;
