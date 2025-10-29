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
        
        this.addLog('🚀 Scan cycle started', 'cycle');

        if (!this.scannerService.state.isRunning) {
            console.warn('[AutoScannerService] Scan cycle aborted: Scanner is not running.');
            this.scannerService.state.isScanning = false;
            return;
        }

        if (this.scannerService.isHardResetting) {
            console.warn('[AutoScannerService] Scan cycle aborted due to hard reset.');
            this.scannerService.state.isScanning = false;
            return;
        }

        if (this.scannerService.state.isScanning) {
            console.warn('[AutoScannerService] ⚠️ Scan already in progress, skipping this cycle.');
            return;
        }


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
                console.warn(`[AutoScannerService] ⚠️ Regime confidence ${confidence.toFixed(1)}% below threshold (${this.scannerService.state.settings.minimumRegimeConfidence}%). Skipping strategy evaluation.`);
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }

            // PHASE 2: Price Fetching
            const priceStartTime = Date.now();
            console.log('[AutoScannerService] 💰 Fetching current prices for strategies and positions...');
            await this.scannerService.priceManagerService._consolidatePrices();
            phaseTimings.priceFetching = Date.now() - priceStartTime;

            // PHASE 3: Position Monitoring and Reconciliation
            const monitoringStartTime = Date.now();
            console.log('[AutoScannerService] 👀 Monitoring open positions and reconciling...');
            await this._monitorPositions(cycleStats);
            phaseTimings.positionMonitoring = Date.now() - monitoringStartTime;

            if (this.scannerService.isHardResetting) {
                console.warn('[AutoScannerService] Cycle aborted after position monitoring.');
                this.scannerService.state.isScanning = false;
                // OPTIMIZATION: Only notify at critical state changes
                this.scannerService.notifySubscribers();
                return;
            }

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
            if (capUsdt > 0) {
                const allocatedNow = this.scannerService._getBalanceAllocatedInTrades();
                if (allocatedNow >= capUsdt) {
                    this.addLog(
                        `[FUNDS] Max invest cap reached: allocated ${this.scannerService._formatCurrency(allocatedNow)} ≥ cap ${this.scannerService._formatCurrency(capUsdt)}. Will skip opening new positions but continue monitoring existing positions.`,
                        'warning'
                    );
                    maxCapReached = true;
                }
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

            if (this.scannerService.state.isRunning && !this.scannerService.isHardResetting) {
                this.scannerService._startCountdown();
            } else {
                console.log('[AutoScannerService] Not starting new countdown as scanner is stopped or resetting.');
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
        if (this.scannerService.isHardResetting) return;

        console.log('[AutoScannerService] [MONITOR] 🔍 Monitoring open positions...');
        console.log('[AutoScannerService] [MONITOR] 🔍 Scanner state:', {
            isRunning: this.scannerService.state.isRunning,
            isScanning: this.scannerService.state.isScanning,
            positionsCount: this.scannerService.positionManager.positions.length
        });

        console.log('[AutoScannerService] [MONITOR] 🔍 About to call monitorAndClosePositions...');
        const monitorResult = await this.scannerService.positionManager.monitorAndClosePositions(this.scannerService.priceManagerService.currentPrices);
        console.log('[AutoScannerService] [MONITOR] 🔍 monitorAndClosePositions result:', monitorResult);

        if (monitorResult.tradesToCreate.length > 0) {
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
        this.addLog(`✅ Scan cycle complete: ${signalsFound} signals found, ${tradesExecuted || 0} trades executed.`, 'cycle');
        this.addLog('', 'cycle');

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        if (this.scannerService.state.momentumBreakdown) {
            const { signalQuality, fearAndGreed, opportunityRate, volatility, regime, unrealized, realized } = this.scannerService.state.momentumBreakdown;

            this.addLog(`• Unrealized P&L: ${unrealized.score.toFixed(0)} (Wt: ${(unrealized.weight * 100).toFixed(0)}%)`, 'cycle');
            this.addLog(`• Realized P&L: ${realized.score.toFixed(0)} (Wt: ${(realized.weight * 100).toFixed(0)}%)`, 'cycle');

            const marketRegime = this.scannerService.state.marketRegime?.regime || 'unknown';
            const regimeConfidence = (this.scannerService.state.marketRegime?.confidence * 100)?.toFixed(0) || 'N/A';
            this.addLog(`• Market Regime: ${regime.score.toFixed(0)} (Wt: ${(regime.weight * 100).toFixed(0)}%) (${marketRegime} (${regimeConfidence}%))`, 'cycle');

            const adxValue = this.scannerService.state.marketVolatility.adx?.toFixed(1) || 'N/A';
            const bbwValue = (this.scannerService.state.marketVolatility.bbw * 100)?.toFixed(1) || 'N/A';
            this.addLog(`• Market Volatility: ${volatility.score.toFixed(0)} (Wt: ${(volatility.weight * 100).toFixed(0)}%) (ADX: ${adxValue}, BBW: ${bbwValue}%)`, 'cycle');

            const recentSignalCount = this.scannerService.state.signalGenerationHistory.slice(-1)[0]?.signalsFound || 0;
            this.addLog(`• Opportunity Rate: ${opportunityRate.score.toFixed(0)} (Wt: ${(opportunityRate.weight * 100).toFixed(0)}%) (${recentSignalCount} recent signals)`, 'cycle');

            const fearGreedValue = this.scannerService.state.fearAndGreedData?.value || 'N/A';
            const fearGreedClassification = this.scannerService.state.fearAndGreedData?.value_classification || 'N/A';
            this.addLog(`• Fear & Greed: ${fearAndGreed.score.toFixed(0)} (Wt: ${(fearAndGreed.weight * 100).toFixed(0)}%) (F&G: ${fearGreedValue} (${fearGreedClassification}))`, 'cycle');

            // Only log Signal Quality if its weight is not 0
            if (signalQuality.weight > 0) {
                const avgStrength = this.scannerService.state.stats?.averageSignalStrength || 0;
                this.addLog(`• Signal Quality: ${signalQuality.score.toFixed(0)} (Wt: ${(signalQuality.weight * 100).toFixed(0)}%) (${avgStrength.toFixed(0)} avg strength)`, 'cycle');
            }

        } else {
            this.addLog(`• Performance metrics: Awaiting initial calculation...`, 'cycle');
        }

        const performanceMomentumScore = this.scannerService.state.performanceMomentumScore;
        if (typeof performanceMomentumScore === 'number') {
            this.addLog(`📊 Performance Momentum Score: ${performanceMomentumScore.toFixed(0)}`, 'cycle');
        } else {
            this.addLog(`📊 Performance Momentum Score: Awaiting initial calculation...`, 'cycle');
        }
        if (typeof this.scannerService.state.adjustedBalanceRiskFactor === 'number') {
            this.addLog(`📈 Adjusted Balance Risk Factor: ${this.scannerService.state.adjustedBalanceRiskFactor.toFixed(0)}% (Max configured: ${this.scannerService.state.settings?.maxBalancePercentRisk || 100}%)`, 'cycle');
        }

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

    /**
     * Logs wallet summary information.
     */
    _logWalletSummary() {
        if (!this.scannerService.walletManagerService?.walletSummary) {
            this.addLog('[WALLET] No wallet summary available', 'info', { level: 1 });
            return;
        }

        const summary = this.scannerService.walletManagerService.walletSummary;
        const positions = this.scannerService.positionManager?.positions || [];

        let unrealizedPnl = 0;
        for (const position of positions) {
            const symbol = position.symbol.replace('/', '');
            const currentPrice = this.scannerService.priceManagerService.currentPrices[symbol];
            if (currentPrice && position.entry_price) {
                const pnl = (currentPrice - position.entry_price) * position.quantity_crypto;
                unrealizedPnl += pnl;
            }
        }

        const realizedPnl = summary.totalRealizedPnl || 0;

        const formatCurrencyWithSign = (value) => {
            const sign = value >= 0 ? '+' : '';
            return `${sign}$${value.toFixed(2)}`;
        };

        this.addLog(`💰 Total Balance: ${formatCurrencyWithSign(summary.totalBalance)}`, 'cycle');
        this.addLog(`💵 Available: ${formatCurrencyWithSign(summary.availableBalance)}`, 'cycle');
        this.addLog(`🔒 In Trades: ${formatCurrencyWithSign(summary.balanceInTrades)}`, 'cycle');
        this.addLog(`📈 Realized P&L: ${formatCurrencyWithSign(realizedPnl)}`, 'cycle');
        this.addLog(`📊 Unrealized P&L: ${formatCurrencyWithSign(unrealizedPnl)}`, 'cycle');
        this.addLog(`🎯 Total Equity: ${formatCurrencyWithSign(summary.totalEquity)}`, 'cycle');
        this.addLog(`📋 Open Positions: ${positions.length}`, 'cycle');
        this.addLog(`🏆 Win Rate: ${(summary.winRate || 0).toFixed(1)}%`, 'cycle');
        this.addLog(`📊 Total Trades: ${summary.totalTrades || 0}`, 'cycle');
    }

    /**
     * Resets the scan engine state.
     */
    resetState() {
        this.scanCycleTimes = [];
        this.addLog('[ScanEngineService] State reset.', 'system');
    }
}

export default ScanEngineService;
