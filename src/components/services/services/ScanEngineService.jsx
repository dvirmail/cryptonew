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
import { getKlineData } from '@/api/functions';
import { calculateAllIndicators } from '@/components/utils/indicatorManager';

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
        // Get from wallet manager service, or fallback to scanner service's wallet state
        return this.scannerService.walletManagerService?.getCurrentWalletState() || 
               this.scannerService._getCurrentWalletState?.() || 
               {};
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

        // Clean expired kline cache entries at the start of each scan cycle
        try {
          // Clean client-side cache
          const { cleanupExpiredKlineResponseCache } = await import('@/api/localClient');
          const cleanedCount = cleanupExpiredKlineResponseCache();
          
          // Clean server-side cache via API call (non-blocking)
          const proxyUrl = this.scannerService.state.settings?.local_proxy_url || 'http://localhost:3003';
          fetch(`${proxyUrl}/api/cache/cleanup-kline`).catch(() => {
            // Silently fail - server cleanup is not critical
          });
          
          if (cleanedCount > 0) {
            this.addLog(`🧹 Cleaned ${cleanedCount} expired kline cache entries at scan cycle start`, 'info');
          }
        } catch (error) {
          // Silently fail - cache cleanup is not critical
          console.warn('[ScanEngineService] Failed to clean kline cache:', error);
        }

        // console.log(`[AutoScannerService] [SCAN_CYCLE] 🔄 Starting scan cycle #${this.scannerService.state.stats.totalScanCycles + 1}`);
        // console.log(`[AutoScannerService] [SCAN_CYCLE] 🔍 Scanner state:`, {
        //     isRunning: this.scannerService.state.isRunning,
        //     isScanning: this.scannerService.state.isScanning,
        //     availableBalance: this.scannerService.state.walletSummary?.availableBalance,
        //     balanceInTrades: this.scannerService.state.walletSummary?.balanceInTrades,
        //     positionsCount: this.scannerService.positionManager.positions.length
        // });

        // console.log(`[AutoScannerService] 🔄 Starting new scan cycle #${this.scannerService.state.stats.totalScanCycles + 1}...`);
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
            // Track pre-scan operations
            const preScanStartTime = Date.now();
            
            // console.log('[ScanEngineService] 🔍 [PHASE] Starting pre-scan checks...');
            // NEW: Pre-scan leadership check
            if (this.scannerService.state.isRunning) {
                // console.log('[ScanEngineService] 🔍 [PHASE] Checking leadership...');
                const leadershipStartTime = Date.now();
                const hasLeadership = await this.scannerService.sessionManager.verifyLeadership();
                phaseTimings.leadershipCheck = Date.now() - leadershipStartTime;
                // console.log('[ScanEngineService] 🔍 [PHASE] Leadership check complete, hasLeadership:', hasLeadership);
                if (!hasLeadership) {
                    console.warn('[AutoScannerService] ⚠️ Lost leadership during scan - another tab is now active. Stopping scanner.');
                    this.scannerService.stop();
                    return;
                }
            }

            // console.log('[ScanEngineService] 🔍 [PHASE] Waiting for wallet save...');
            const walletSaveStartTime = Date.now();
            await this.scannerService.positionManager.waitForWalletSave(60000);
            phaseTimings.walletSaveWait = Date.now() - walletSaveStartTime;
            // console.log('[ScanEngineService] 🔍 [PHASE] Wallet save wait complete');
            
            phaseTimings.preScan = Date.now() - preScanStartTime;

            // PHASE 1: Market Regime Detection & F&G Index
            const regimeStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 1] Market Regime Detection START`);
            const regimeData = await this.scannerService.marketRegimeService._detectMarketRegime();
            phaseTimings.regimeDetection = Date.now() - regimeStartTime;
            phaseTimings.marketRegime = phaseTimings.regimeDetection; // Alias for consistency
            console.log(`[ScanEngineService] ⏱️ [PHASE 1] Market Regime Detection END: ${phaseTimings.regimeDetection}ms (${(phaseTimings.regimeDetection/1000).toFixed(2)}s)`);

            if (!regimeData) {
                console.error('[AutoScannerService] ❌ Failed to detect market regime, skipping cycle.');
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }

            const { regime, confidence } = regimeData;
            // console.log(`[AutoScannerService] 📊 Market Regime: ${regime.toUpperCase()} (${confidence.toFixed(1)}% confidence)`);
            
            cycleStats.marketRegime = this.scannerService.state.marketRegime ? { ...this.scannerService.state.marketRegime } : null;

            
            if (confidence < this.scannerService.state.settings.minimumRegimeConfidence) {
                console.warn(`[ScanEngineService] ⚠️ Regime confidence ${confidence.toFixed(1)}% below threshold (${this.scannerService.state.settings.minimumRegimeConfidence}%). Skipping strategy evaluation.`);
                // console.log('[ScanEngineService] 🔍 EARLY RETURN: Regime confidence too low, skipping entire scan cycle');
                this.scannerService.state.isScanning = false;
                this.scannerService.notifySubscribers();
                return;
            }

            // PHASE 2: Price Fetching
            const priceStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 2] Price Fetching START`);
            try {
                if (this.scannerService.priceManagerService) {
                    await this.scannerService.priceManagerService._consolidatePrices();
                }
            } catch (priceError) {
                console.error('[ScanEngineService] ❌ Error in _consolidatePrices:', priceError);
            }
            phaseTimings.priceFetching = Date.now() - priceStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 2] Price Fetching END: ${phaseTimings.priceFetching}ms (${(phaseTimings.priceFetching/1000).toFixed(2)}s)`);

            // PHASE 2.5: Dust Detection and Aggregation (before position monitoring)
            const dustDetectionStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 2.5] Dust Detection & Aggregation START`);
            try {
                await this.scannerService.positionManager.detectAndAggregateDustPositions();
            } catch (dustError) {
                console.error('[ScanEngineService] ❌ Error in dust detection:', dustError);
            }
            phaseTimings.dustDetection = Date.now() - dustDetectionStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 2.5] Dust Detection & Aggregation END: ${phaseTimings.dustDetection}ms (${(phaseTimings.dustDetection/1000).toFixed(2)}s)`);

            // PHASE 3: Position Monitoring and Reconciliation
            const monitoringStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 3] Position Monitoring START`);
            
            try {
                // console.log('[ScanEngineService] 🔍 [PHASE 3] About to call _monitorPositions...');
                // console.log('[ScanEngineService] 🔍 [PHASE 3] _monitorPositions function exists:', typeof this._monitorPositions);
                // console.log('[ScanEngineService] 🔍 [PHASE 3] cycleStats:', !!cycleStats);
                // console.log('[ScanEngineService] 🔍 [PHASE 3] Calling _monitorPositions now...');
                
                // Wrap in immediate try-catch to catch synchronous errors
                let monitorPromise;
                const phase3StartTime = Date.now();
                // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] STARTING _monitorPositions CALL (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                
                // Track promise state (moved outside try block so timeout can access it)
                let promiseResolved = false;
                let promiseRejected = false;
                let promiseResult = null;
                let promiseError = null;
                
                try {
                    // Test: Log the function itself
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] _monitorPositions function:', this._monitorPositions);
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] _monitorPositions.toString():', this._monitorPositions.toString().substring(0, 200));
                    
                    // Force immediate execution test
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] CALLING _monitorPositions NOW (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    const testResult = this._monitorPositions(cycleStats);
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] FUNCTION CALL RETURNED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] Function call returned:', typeof testResult);
                    monitorPromise = testResult;
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] _monitorPositions promise created, type:', typeof monitorPromise);
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] Promise is Promise:', monitorPromise instanceof Promise);
                    
                    // Track promise state
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] PROMISE CREATED, ADDING THEN/CATCH HANDLERS (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    
                    monitorPromise.then(result => {
                        promiseResolved = true;
                        promiseResult = result;
                        // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ✅ PROMISE RESOLVED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                        // console.log('[ScanEngineService] 🔍 [PHASE 3] Promise resolved with result:', result);
                    }).catch(error => {
                        promiseRejected = true;
                        promiseError = error;
                        // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ❌ PROMISE REJECTED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                        console.error('[ScanEngineService] 🔍 [PHASE 3] Promise rejected with error:', error);
                    });
                    
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] THEN/CATCH HANDLERS ADDED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    
                } catch (syncError) {
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ❌ SYNCHRONOUS ERROR (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    console.error('[ScanEngineService] ❌ SYNCHRONOUS ERROR calling _monitorPositions:', syncError);
                    console.error('[ScanEngineService] ❌ Sync error stack:', syncError.stack);
                    throw syncError;
                }
                
                // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ABOUT TO AWAIT PROMISE (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                // console.log('[ScanEngineService] 🔍 [PHASE 3] About to await promise...');
                
                // Add timeout wrapper to detect if promise never resolves
                // CRITICAL: This timeout must be LONGER than monitorAndClosePositions timeout (300s)
                // monitorAndClosePositions can take up to 300s (position loop 120s + batch close 60s + overhead)
                // Set to 360s (6 minutes) to allow monitorAndClosePositions to complete + safety margin
                let timeoutId;
                const awaitTimeout = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        const elapsed = Date.now() - phase3StartTime;
                        console.warn(`[ScanEngineService] 🔍 [PHASE 3] ⏱️ WARNING: _monitorPositions taking longer than 360 seconds (${(elapsed/1000).toFixed(1)}s elapsed)`);
                        console.warn(`[ScanEngineService] 🔍 [PHASE 3] Promise state - resolved: ${promiseResolved}, rejected: ${promiseRejected}`);
                        console.warn(`[ScanEngineService] 🔍 [PHASE 3] This may indicate a hang in monitorAndClosePositions or kline data fetching`);
                        reject(new Error(`_monitorPositions promise timeout after ${(elapsed/1000).toFixed(1)}s - function may be hanging`));
                    }, 360000); // 360 seconds = 6 minutes
                });
                
                try {
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ENTERING Promise.race (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    const raceResult = await Promise.race([monitorPromise, awaitTimeout]);
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] Promise.race COMPLETED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    
                    // Clear timeout if promise resolved before timeout
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] TIMEOUT CLEARED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    }
                    // console.log('[ScanEngineService] 🔍 [PHASE 3] Position monitoring complete');
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ✅✅✅ COMPLETE (${Date.now() - phase3StartTime}ms) ✅✅✅`);
                } catch (timeoutError) {
                    // console.error(`[ScanEngineService] 🔴🔴🔴 [PHASE 3] ❌ CATCH BLOCK ENTERED (${Date.now() - phase3StartTime}ms) 🔴🔴🔴`);
                    // Clear timeout on error
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    if (timeoutError.message.includes('timeout')) {
                        const elapsed = Date.now() - phase3StartTime;
                        console.error(`[ScanEngineService] 🔍 [PHASE 3] ❌ Promise timeout after ${(elapsed/1000).toFixed(1)}s - _monitorPositions may be hanging`);
                        console.error(`[ScanEngineService] 🔍 [PHASE 3] Promise state at timeout - resolved: ${promiseResolved}, rejected: ${promiseRejected}`);
                        console.error(`[ScanEngineService] 🔍 [PHASE 3] If promiseResolved=false, the function is likely hanging inside monitorAndClosePositions`);
                        console.error(`[ScanEngineService] 🔍 [PHASE 3] Check PositionManager logs for position loop timeout or kline data fetch issues`);
                        // Continue anyway to see if it eventually resolves (but log that we're waiting)
                        console.warn(`[ScanEngineService] 🔍 [PHASE 3] Continuing to wait for promise to complete...`);
                        try {
                            await monitorPromise;
                            console.warn(`[ScanEngineService] 🔍 [PHASE 3] ✅ Promise eventually resolved after ${((Date.now() - phase3StartTime)/1000).toFixed(1)}s`);
                        } catch (finalError) {
                            console.error(`[ScanEngineService] 🔍 [PHASE 3] ❌ Promise failed after timeout (${((Date.now() - phase3StartTime)/1000).toFixed(1)}s):`, finalError);
                            throw finalError;
                        }
                    } else {
                        throw timeoutError;
                    }
                }
            } catch (monitorError) {
                console.error('[ScanEngineService] ❌ ERROR in _monitorPositions:', monitorError);
                console.error('[ScanEngineService] ❌ ERROR stack:', monitorError.stack);
                throw monitorError;
            }
            
            phaseTimings.positionMonitoring = Date.now() - monitoringStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 3] Position Monitoring END: ${phaseTimings.positionMonitoring}ms (${(phaseTimings.positionMonitoring/1000).toFixed(2)}s)`);
            
            if (this.scannerService.isHardResetting) {
                this.scannerService.state.isScanning = false;
                // OPTIMIZATION: Only notify at critical state changes
                this.scannerService.notifySubscribers();
                return;
            }

            // NEW: Single summary check to avoid strategy evaluation when funds below minimum
            // Commented out to reduce console flooding
            // console.log('[ScanEngineService] 🔍 [PHASE] Checking available funds...');
            const availableUsdt = this.scannerService._getAvailableUsdt();
            const minTrade = this.scannerService.state?.settings?.minimumTradeValue || 10;
            // console.log('[ScanEngineService] 🔍 [PHASE] Available USDT:', availableUsdt, 'Min trade:', minTrade);

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
                    // Store in cycleStats for logging in wallet summary
                    cycleStats.maxCapReached = true;
                    cycleStats.maxCapAllocated = allocatedNow;
                    cycleStats.maxCapLimit = capUsdt;
                }
            }

            // PHASE 4: Strategy Loading
            const strategyLoadStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 4] Strategy Loading START`);
            let strategies = await this._loadStrategies() || [];
            phaseTimings.strategyLoading = Date.now() - strategyLoadStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 4] Strategy Loading END: ${phaseTimings.strategyLoading}ms (${(phaseTimings.strategyLoading/1000).toFixed(2)}s) - Loaded ${strategies.length} strategies`);

            if (!strategies || strategies.length === 0) {
                console.warn('[AutoScannerService] ⚠️ No active strategies found - continuing cycle for position monitoring only');
                this.addLog('⚠️ No active strategies found. Skipping strategy evaluation but continuing position monitoring.', 'warning');
                // Continue with empty strategies array - position monitoring will still run
                strategies = [];
            } else {
                console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} active strategies`);
            }

            // PHASE 5: Strategy Evaluation & Signal Detection - OPTIMIZED
            // CRITICAL FIX: Removed requestIdleCallback wrapper - it causes delays when tab is inactive
            // Strategy evaluation is a background operation that should execute immediately
            // This ensures strategies always process in parallel batches, regardless of tab visibility
            const evaluationStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 5] Strategy Evaluation START (${strategies.length} strategies)`);
            
            // Execute strategy evaluation immediately (no requestIdleCallback delay)
            const scanResult = await this._evaluateStrategies(
                            strategies,
                            this._getCurrentWalletState(),
                            this.scannerService.state.settings,
                            this.scannerService.state.marketRegime,
                            this.scannerService.priceManagerService.currentPrices,
                            cycleStats,
                            maxCapReached
                        );
            
            phaseTimings.strategyEvaluation = Date.now() - evaluationStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 5] Strategy Evaluation END: ${phaseTimings.strategyEvaluation}ms (${(phaseTimings.strategyEvaluation/1000).toFixed(2)}s) - ${scanResult.signalsFound} signals, ${scanResult.tradesExecuted} trades`);

            if (this.scannerService.isHardResetting) {
                console.warn('[AutoScannerService] Cycle aborted after signal detection.');
                this.scannerService.state.isScanning = false;
                // OPTIMIZATION: Only notify at critical state changes
                this.scannerService.notifySubscribers();
                return;
            }

            // PHASE 6: Trade Archiving
            const archivingStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 6] Trade Archiving START`);
            await this.scannerService._archiveOldTradesIfNeeded();
            phaseTimings.tradeArchiving = Date.now() - archivingStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 6] Trade Archiving END: ${phaseTimings.tradeArchiving}ms (${(phaseTimings.tradeArchiving/1000).toFixed(2)}s)`);

            // PHASE 7: Performance Snapshot & Wallet Update
            const snapshotStartTime = Date.now();
            console.log(`[ScanEngineService] ⏱️ [PHASE 7] Performance Snapshot START`);
            await this.scannerService._updatePerformanceSnapshotIfNeeded(cycleStats);
            phaseTimings.performanceSnapshot = Date.now() - snapshotStartTime;
            console.log(`[ScanEngineService] ⏱️ [PHASE 7] Performance Snapshot END: ${phaseTimings.performanceSnapshot}ms (${(phaseTimings.performanceSnapshot/1000).toFixed(2)}s)`);

            const summaryMessage = `✅ Scan cycle complete: ${scanResult.signalsFound} signals found, ${scanResult.tradesExecuted} trades executed.`;
            console.log(`[AutoScannerService] ${summaryMessage}`);

            // Emit end-of-cycle summary logs (wallet snapshot, metrics, blocked reasons, etc.)
            const logSummaryStartTime = Date.now();
            await this._logCycleSummary(cycleStats);
            phaseTimings.logSummary = Date.now() - logSummaryStartTime;

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
            // Track operations in finally block
            const finallyStartTime = Date.now();
            const phasesEndTime = finallyStartTime;
            
            // Check tab visibility (browser throttling detection)
            const isTabVisible = typeof document !== 'undefined' && !document.hidden;
            const visibilityWarning = !isTabVisible ? ' ⚠️ TAB INACTIVE (browser throttling may affect timing)' : '';
            
            // Update stats
            const scanDuration = Date.now() - cycleStartTime;
            const trackedPhaseTime = (phaseTimings.preScan || 0) +
                                    (phaseTimings.marketRegime || 0) + 
                                    (phaseTimings.priceFetching || 0) + 
                                    (phaseTimings.dustDetection || 0) +
                                    (phaseTimings.positionMonitoring || 0) + 
                                    (phaseTimings.strategyLoading || 0) + 
                                    (phaseTimings.strategyEvaluation || 0) + 
                                    (phaseTimings.tradeArchiving || 0) + 
                                    (phaseTimings.performanceSnapshot || 0) +
                                    (phaseTimings.logSummary || 0);
            
            console.log(`[ScanEngineService] ⏱️ ========== SCAN CYCLE END ========== Total: ${scanDuration}ms (${(scanDuration/1000).toFixed(2)}s)${visibilityWarning}`);
            console.log(`[ScanEngineService] ⏱️ Phase Breakdown:`);
            if (phaseTimings.preScan > 0) {
                console.log(`[ScanEngineService] ⏱️   - Pre-Scan (leadership + wallet save): ${phaseTimings.preScan}ms (${(phaseTimings.preScan/1000).toFixed(2)}s)`);
                if (phaseTimings.leadershipCheck > 0) {
                    console.log(`[ScanEngineService] ⏱️     └─ Leadership Check: ${phaseTimings.leadershipCheck}ms`);
                }
                if (phaseTimings.walletSaveWait > 0) {
                    console.log(`[ScanEngineService] ⏱️     └─ Wallet Save Wait: ${phaseTimings.walletSaveWait}ms`);
                }
            }
            console.log(`[ScanEngineService] ⏱️   - Market Regime: ${phaseTimings.marketRegime || 0}ms (${((phaseTimings.marketRegime || 0)/1000).toFixed(2)}s)`);
            console.log(`[ScanEngineService] ⏱️   - Price Fetching: ${phaseTimings.priceFetching || 0}ms (${((phaseTimings.priceFetching || 0)/1000).toFixed(2)}s)`);
            if (phaseTimings.dustDetection > 0) {
                console.log(`[ScanEngineService] ⏱️   - Dust Detection & Aggregation: ${phaseTimings.dustDetection}ms (${(phaseTimings.dustDetection/1000).toFixed(2)}s)`);
            }
            console.log(`[ScanEngineService] ⏱️   - Position Monitoring: ${phaseTimings.positionMonitoring || 0}ms (${((phaseTimings.positionMonitoring || 0)/1000).toFixed(2)}s)`);
            console.log(`[ScanEngineService] ⏱️   - Strategy Loading: ${phaseTimings.strategyLoading || 0}ms (${((phaseTimings.strategyLoading || 0)/1000).toFixed(2)}s)`);
            console.log(`[ScanEngineService] ⏱️   - Strategy Evaluation: ${phaseTimings.strategyEvaluation || 0}ms (${((phaseTimings.strategyEvaluation || 0)/1000).toFixed(2)}s)`);
            console.log(`[ScanEngineService] ⏱️   - Trade Archiving: ${phaseTimings.tradeArchiving || 0}ms (${((phaseTimings.tradeArchiving || 0)/1000).toFixed(2)}s)`);
            console.log(`[ScanEngineService] ⏱️   - Performance Snapshot: ${phaseTimings.performanceSnapshot || 0}ms (${((phaseTimings.performanceSnapshot || 0)/1000).toFixed(2)}s)`);
            if (phaseTimings.logSummary > 0) {
                console.log(`[ScanEngineService] ⏱️   - Log Summary: ${phaseTimings.logSummary}ms (${(phaseTimings.logSummary/1000).toFixed(2)}s)`);
            }
            
            const otherTime = scanDuration - trackedPhaseTime;
            const otherTimePercent = scanDuration > 0 ? ((otherTime / scanDuration) * 100).toFixed(1) : 0;
            
            if (otherTime > 10000) { // Warn if overhead > 10 seconds
                console.warn(`[ScanEngineService] ⚠️ Large Other/Overhead detected: ${otherTime}ms (${(otherTime/1000).toFixed(2)}s, ${otherTimePercent}%)`);
                if (!isTabVisible) {
                    console.warn(`[ScanEngineService] ⚠️ Tab is INACTIVE - browser throttling likely causing delays`);
                }
                console.warn(`[ScanEngineService] ⚠️ This may indicate: browser throttling, async operations, or missing phase tracking`);
            }
            
            console.log(`[ScanEngineService] ⏱️   - Other/Overhead: ${otherTime}ms (${(otherTime/1000).toFixed(2)}s, ${otherTimePercent}%)${visibilityWarning}`);
            
            // Track finally block operations
            const statsUpdateStart = Date.now();
            this.scannerService.state.stats.totalScanCycles++;
            this.scannerService.state.stats.lastScanTimeMs = scanDuration;

            // Update rolling average
            if (this.scannerService.state.stats.averageScanTimeMs === 0) {
                this.scannerService.state.stats.averageScanTimeMs = scanDuration;
            } else {
                this.scannerService.state.stats.averageScanTimeMs = (this.scannerService.state.stats.averageScanTimeMs * 0.8) + (scanDuration * 0.2);
            }
            const statsUpdateTime = Date.now() - statsUpdateStart;

            console.log(`[AutoScannerService] ⏱️ Scan cycle completed in ${(scanDuration / 1000).toFixed(2)}s (avg: ${(this.scannerService.state.stats.averageScanTimeMs / 1000).toFixed(2)}s)`, { duration: scanDuration });

            // Track storage save
            const storageStart = Date.now();
            this.scannerService._saveStateToStorage();
            const storageTime = Date.now() - storageStart;

            this.scannerService.state.isScanning = false;

            // Track notifications
            const notifyStart = Date.now();
            this.scannerService.notifySubscribers();
            const notifyTime = Date.now() - notifyStart;

            // Track heartbeat
            let heartbeatTime = 0;
            if (this.scannerService.state.isRunning) {
                try {
                    const heartbeatStart = Date.now();
                    await this.scannerService.sessionManager.claimLeadership();
                    heartbeatTime = Date.now() - heartbeatStart;
                } catch (heartbeatError) {
                    console.warn(`[AutoScannerService] ⚠️ Post-scan heartbeat failed: ${heartbeatError.message}`);
                }
            }

            // Track countdown start
            const countdownStart = Date.now();
            if (this.scannerService.state.isRunning && !this.scannerService.isHardResetting) {
                this.scannerService.lifecycleService._startCountdown();
            } else {
                console.log('[ScanEngineService] ⏸️ Not starting new countdown as scanner is stopped or resetting.');
                console.log('[ScanEngineService] ⏸️ Reason:', !this.scannerService.state.isRunning ? 'Scanner not running' : 'Scanner is hard resetting');
            }
            const countdownTime = Date.now() - countdownStart;

            // Final notification
            this.scannerService.notifySubscribers();
            
            const finallyBlockTime = Date.now() - finallyStartTime;
            if (finallyBlockTime > 1000) {
                console.log(`[ScanEngineService] ⏱️ Finally block operations: ${finallyBlockTime}ms (stats: ${statsUpdateTime}ms, storage: ${storageTime}ms, notify: ${notifyTime}ms, heartbeat: ${heartbeatTime}ms, countdown: ${countdownTime}ms)`);
            }
            
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
        // Commented out to reduce console flooding
        // console.log('[ScanEngineService] 🔍 [_loadStrategies] Starting strategy load...');
        // console.log('[AutoScannerService] 📋 Loading strategies...');

        try {
            // console.log('[ScanEngineService] 🔍 [_loadStrategies] Calling strategyManager._loadAndFilterStrategiesInternal...');
        // OPTIMIZATION: Use internal method to avoid duplicate database calls
        const strategies = await this.scannerService.strategyManager._loadAndFilterStrategiesInternal();
            // console.log('[ScanEngineService] 🔍 [_loadStrategies] Strategy load complete, got', strategies?.length || 0, 'strategies');

        // CRITICAL FIX: Build activeStrategies map for PositionManager lookups
            // console.log('[ScanEngineService] 🔍 [_loadStrategies] Building activeStrategies map...');
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
        } catch (error) {
            console.error('[ScanEngineService] 🔍 [_loadStrategies] ERROR loading strategies:', error);
            throw error;
        }
    }

    /**
     * Helper method for position monitoring, reconciliation, and executing queued orders.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _monitorPositions(cycleStats) {
        const _monitorStartTime = Date.now();
        const functionId = `_monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[ScanEngineService] ⏱️ [_monitorPositions] START ${new Date().toISOString()}`);
        
        // CRITICAL: Force async continuation to ensure promise resolves
        await new Promise(resolve => {
            // Use setTimeout with 0 delay to force async continuation
            setTimeout(() => {
                resolve();
            }, 0);
        });
        
        // CRITICAL: Wrap entire function in try-catch to catch any synchronous errors
        let tryBlockEntered = false;
        try {
            tryBlockEntered = true;
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Try block entered (${Date.now() - _monitorStartTime}ms)`);
            
            const _step1_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 1: Accessing scannerService (${Date.now() - _monitorStartTime}ms)`);
            const scannerService = this.scannerService;
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 1 complete: scannerService accessed (${Date.now() - _step1_start}ms)`);
            
            const _step2_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 2: Accessing positionManager (${Date.now() - _monitorStartTime}ms)`);
            const positionManager = scannerService.positionManager;
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 2 complete: positionManager accessed (${Date.now() - _step2_start}ms)`);
            
            const _step3_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 3: Accessing priceManagerService (${Date.now() - _monitorStartTime}ms)`);
            const priceManagerService = scannerService.priceManagerService;
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 3 complete: priceManagerService accessed (${Date.now() - _step3_start}ms)`);
            
            const _step4_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 4: Validating services (${Date.now() - _monitorStartTime}ms)`);
            if (!scannerService || !positionManager || !priceManagerService) {
                console.error('[ScanEngineService] [MONITOR] ❌ CRITICAL: Required services not available');
                throw new Error('Required services not available for position monitoring');
            }
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 4 complete: Services validated (${Date.now() - _step4_start}ms)`);
            
            const _step5_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 5: Checking isHardResetting (${Date.now() - _monitorStartTime}ms)`);
            // Check if hard reset is in progress
            if (scannerService.isHardResetting) {
                console.log('[ScanEngineService] [MONITOR] ⏸️ Scanner is hard resetting, skipping position monitoring');
                return { signalsFound: 0, tradesExecuted: 0, combinationsEvaluated: 0 };
            }
            console.log(`[ScanEngineService] [MONITOR] [${functionId}] Step 5 complete: isHardResetting check passed (${Date.now() - _step5_start}ms)`);
        
        // FIX: Preload indicators for symbols with open positions that aren't being scanned
        // This ensures ATR is available for position monitoring even if no strategies are active for that symbol
            const _step6_start = Date.now();
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO LOG Step 6 (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
            // console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 6: Starting indicator preload check (${Date.now() - _monitorStartTime}ms since start)`);
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO ENTER Step 6 TRY BLOCK (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
        try {
                const _step6a_start = Date.now();
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] INSIDE Step 6 TRY BLOCK (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 6a: Getting open positions (${Date.now() - _monitorStartTime}ms since start)`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO ACCESS positionManager.positions (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                const openPositions = positionManager.positions.filter(pos => pos.status === 'open' || pos.status === 'trailing');
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] positionManager.positions.filter COMPLETE (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] openPositions.length: ${openPositions.length} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO LOG Step 6a complete (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 6a complete: Found ${openPositions.length} open positions (${Date.now() - _step6a_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER Step 6a complete log (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO CHECK openPositions.length > 0 (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
            
            if (openPositions.length > 0) {
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] openPositions.length > 0 is TRUE (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] INSIDE if BLOCK, BEFORE FIRST console.log (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    // console.log('[ScanEngineService] [MONITOR] 🔍 Has open positions, checking indicators...');
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER FIRST console.log (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // Initialize indicators object if it doesn't exist
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] BEFORE SECOND console.log (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    // console.log('[ScanEngineService] [MONITOR] 🔍 Checking indicators state...');
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER SECOND console.log, BEFORE ACCESSING scannerService.state (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO ACCESS scannerService.state (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                const stateAccess = scannerService.state;
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] scannerService.state ACCESSED (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO ACCESS scannerService.state.indicators (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    if (!scannerService.state.indicators) {
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] INSIDE if (!indicators) - indicators is falsy (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        // console.log('[ScanEngineService] [MONITOR] 🔍 Initializing indicators object...');
                        scannerService.state.indicators = {};
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER ASSIGNING indicators = {} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    } else {
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] INSIDE if (!indicators) - indicators EXISTS (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    }
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER if (!indicators) BLOCK (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    // console.log('[ScanEngineService] [MONITOR] 🔍 Indicators state ready');
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER 'Indicators state ready' LOG (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO BUILD symbolsNeedingIndicators Map (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // Get symbols that need indicators (use Map to avoid duplicates by symbol)
                const symbolsNeedingIndicators = new Map();
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] symbolsNeedingIndicators Map CREATED, ABOUT TO ITERATE openPositions (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] openPositions.length: ${openPositions.length} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                
                let positionIterationCount = 0;
                openPositions.forEach(pos => {
                    positionIterationCount++;
                    // if (positionIterationCount <= 5 || positionIterationCount % 10 === 0) {
                    //     console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] Processing position ${positionIterationCount}/${openPositions.length}: ${pos.symbol} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    // }
                    if (pos.symbol) {
                        const symbolNoSlash = pos.symbol.replace('/', '');
                        // Check if indicators already exist
                            if (!scannerService.state.indicators[symbolNoSlash] || 
                                !scannerService.state.indicators[symbolNoSlash].atr ||
                                (Array.isArray(scannerService.state.indicators[symbolNoSlash].atr) && 
                                 scannerService.state.indicators[symbolNoSlash].atr.length === 0)) {
                            // Use symbol as key to avoid duplicates, store timeframe
                            symbolsNeedingIndicators.set(symbolNoSlash, pos.timeframe || '15m');
                        }
                    }
                });
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER forEach, symbolsNeedingIndicators.size: ${symbolsNeedingIndicators.size} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO CHECK symbolsNeedingIndicators.size > 0 (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                if (symbolsNeedingIndicators.size > 0) {
                    // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] symbolsNeedingIndicators.size > 0 is TRUE (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        const _step6b_start = Date.now();
                    
                    // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO CREATE preloadPromises (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    const preloadPromises = Array.from(symbolsNeedingIndicators.entries()).map(([symbolNoSlash, timeframe], index) => {
                            const _promiseStartTime = Date.now();
                            const _promiseId = `${functionId}_promise_${index}_${symbolNoSlash}`;
                            // console.log(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] [PROXY] Starting API call for ${symbolNoSlash} (${timeframe})...`);
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] CREATING PROMISE for ${symbolNoSlash} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] CALLING getKlineData for ${symbolNoSlash} (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        
                        // Wrap getKlineData with a timeout to prevent hanging (30 seconds per symbol)
                        // Use priority=1 for position monitoring (high priority)
                        const klineDataPromise = getKlineData({
                            symbols: [symbolNoSlash],
                            interval: timeframe,
                            limit: 100,
                            priority: 1 // High priority for position monitoring
                        });
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] getKlineData PROMISE CREATED (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => {
                                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] ⏱️ TIMEOUT for getKlineData(${symbolNoSlash}) after 30s (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                                reject(new Error(`getKlineData timeout for ${symbolNoSlash} after 30 seconds`));
                            }, 30000);
                        });
                        
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] CREATING Promise.race (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        return Promise.race([klineDataPromise, timeoutPromise])
                        .then(response => {
                            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] Promise.race RESOLVED for ${symbolNoSlash} (${Date.now() - _monitorStartTime}ms, promise took ${Date.now() - _promiseStartTime}ms) 🔴🔴🔴`);
                            if (response?.success && response?.data?.[symbolNoSlash]?.success && response?.data?.[symbolNoSlash]?.data) {
                                const klineData = response.data[symbolNoSlash].data.map(kline => ({
                                    timestamp: Array.isArray(kline) ? kline[0] : kline.timestamp || kline.time,
                                    open: parseFloat(Array.isArray(kline) ? kline[1] : kline.open),
                                    high: parseFloat(Array.isArray(kline) ? kline[2] : kline.high),
                                    low: parseFloat(Array.isArray(kline) ? kline[3] : kline.low),
                                    close: parseFloat(Array.isArray(kline) ? kline[4] : kline.close),
                                    volume: parseFloat(Array.isArray(kline) ? kline[5] : kline.volume)
                                }));

                                if (klineData.length >= 50) {
                                    const indicatorSettings = {
                                        atr: { enabled: true, period: 14 },
                                        volume_sma: { enabled: true, period: 20 },
                                        obv: { enabled: true }
                                    };

                                        const allIndicators = calculateAllIndicators(klineData, indicatorSettings, scannerService.addLog.bind(scannerService));
                                    
                                        scannerService.state.indicators[symbolNoSlash] = allIndicators;
                                    
                                    console.log(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] ✅ Calculated and stored indicators for ${symbolNoSlash} (${timeframe})`);
                                    return { symbol: symbolNoSlash, success: true };
                                }
                            }
                            return { symbol: symbolNoSlash, success: false, error: 'Insufficient kline data' };
                        })
                        .catch(error => {
                            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${_promiseId}] Promise.race REJECTED for ${symbolNoSlash} (${Date.now() - _monitorStartTime}ms, promise took ${Date.now() - _promiseStartTime}ms) - ${error.message} 🔴🔴🔴`);
                            console.warn(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] ⚠️ Failed to preload indicators for ${symbolNoSlash}: ${error.message}`);
                            return { symbol: symbolNoSlash, success: false, error: error.message };
                        });
                    });
                    
                    // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ALL ${preloadPromises.length} PROMISES CREATED (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        const _step6c_start = Date.now();
                        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO AWAIT Promise.allSettled (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                        // console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 6c: Waiting for ${preloadPromises.length} preload promises (${Date.now() - _monitorStartTime}ms since start)`);
                    const preloadResults = await Promise.allSettled(preloadPromises);
                    const successful = preloadResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
                    const failed = preloadResults.length - successful;
                    
                    if (successful > 0) {
                        console.log(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] ✅ Successfully preloaded indicators for ${successful} symbol${successful !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);
                    }
                    } else {
                    // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] symbolsNeedingIndicators.size > 0 is FALSE (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                    // console.log(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] No symbols need indicator preloading`);
                }
            } else {
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] openPositions.length > 0 is FALSE (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.log(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] No open positions, skipping indicator preload`);
            }
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] ABOUT TO LOG Step 6 complete (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
                // console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 6 complete: Indicator preload check finished (${Date.now() - _step6_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
                // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER Step 6 complete log (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
        } catch (preloadError) {
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] CATCH BLOCK IN Step 6 (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
            console.warn(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] ⚠️ Error during indicator preloading: ${preloadError.message}`);
                console.error(`[ScanEngineService] [MONITOR] [INDICATOR_PRELOAD] ⚠️ Preload error stack:`, preloadError.stack);
            // Continue with monitoring even if preload fails
        }
        
        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] AFTER Step 6 TRY-CATCH BLOCK (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
        // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] BEFORE Step 7 (${Date.now() - _monitorStartTime}ms) 🔴🔴🔴`);
        const _step7_start = Date.now();
        console.log(`[ScanEngineService] ⏱️ [_monitorPositions] Step 7: monitorAndClosePositions START (${Date.now() - _monitorStartTime}ms since start)`);
        let monitorResult;
        try {
                console.log('[ScanEngineService] [MONITOR] 🔍 Function exists:', typeof positionManager.monitorAndClosePositions);
                console.log('[ScanEngineService] [MONITOR] 🔍 PositionManager object:', !!positionManager);
                console.log('[ScanEngineService] [MONITOR] 🔍 About to call the function...');
            
            // Add a timeout to catch if the function hangs
            // Timeout breakdown:
            // - Position loop: up to 120 seconds
            // - executeBatchClose: up to 60 seconds
            // - Reconciliation and other operations: buffer
            // - Safety margin for network delays, processing overhead
            // Total: 600 seconds (10 minutes) to handle large position counts (94+ positions)
            // Note: With 94 positions, even with optimizations, monitoring can take 5-8 minutes
                const positionCount = positionManager?.positions?.length || 0;
                const timeoutSeconds = positionCount > 50 ? 600 : 300; // Increase timeout for large position counts
                console.log(`[ScanEngineService] [MONITOR] 🔍 Setting up ${timeoutSeconds}s timeout for monitorAndClosePositions (${positionCount} positions)...`);
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        console.error(`[ScanEngineService] [MONITOR] ⏱️ TIMEOUT: monitorAndClosePositions exceeded ${timeoutSeconds} seconds!`);
                        console.error(`[ScanEngineService] [MONITOR] ⏱️ This indicates the function is taking longer than expected. Check logs for bottlenecks.`);
                        console.error(`[ScanEngineService] [MONITOR] ⏱️ Position count: ${positionCount}, isMonitoring: ${positionManager?.isMonitoring}`);
                        reject(new Error(`monitorAndClosePositions timeout after ${timeoutSeconds} seconds`));
                    }, timeoutSeconds * 1000);
                });
                
                const currentPrices = priceManagerService.currentPrices;
                const monitorPromise = positionManager.monitorAndClosePositions(currentPrices);
            try {
            monitorResult = await Promise.race([monitorPromise, timeoutPromise]);
                // Clear timeout if promise resolved before timeout
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                const step7Duration = Date.now() - _step7_start;
                console.log(`[ScanEngineService] ⏱️ [_monitorPositions] Step 7: monitorAndClosePositions END: ${step7Duration}ms (${(step7Duration/1000).toFixed(2)}s)`);
            } catch (raceError) {
                // Clear timeout on error
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                
                // CRITICAL FIX: Ensure isMonitoring flag is cleared even on timeout
                // This prevents the function from being permanently blocked
                if (positionManager && typeof positionManager.isMonitoring !== 'undefined') {
                    const wasMonitoring = positionManager.isMonitoring;
                    positionManager.isMonitoring = false;
                    if (wasMonitoring) {
                        console.warn(`[ScanEngineService] [MONITOR] 🔓 Force-cleared isMonitoring flag after timeout`);
                    }
                }
                
                throw raceError;
            }
            
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
                    exists: !!scannerService.positionManager,
                    positions: scannerService.positionManager?.positions?.length || 0,
                    isMonitoring: scannerService.positionManager?.isMonitoring
            });
            
            // CRITICAL FIX: Ensure isMonitoring flag is cleared even on outer error
            // This prevents the function from being permanently blocked
            if (scannerService.positionManager && typeof scannerService.positionManager.isMonitoring !== 'undefined') {
                const wasMonitoring = scannerService.positionManager.isMonitoring;
                scannerService.positionManager.isMonitoring = false;
                if (wasMonitoring) {
                    console.warn(`[ScanEngineService] [MONITOR] 🔓 Force-cleared isMonitoring flag after outer error`);
                }
            }
            
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
                const _step8_start = Date.now();

                try {
                    await scannerService.walletManagerService.initializeLiveWallet();
                    await scannerService.walletManagerService.updateWalletSummary(
                        this._getCurrentWalletState(),
                        scannerService.priceManagerService.currentPrices
                    );
                    await scannerService._persistLatestWalletSummary();
                    scannerService.notifyWalletSubscribers();
            } catch (refreshError) {
                console.error('[AutoScannerService] ❌ Failed to refresh wallet after trades:', refreshError);
                console.warn(`[AutoScannerService] [MONITOR] ⚠️ Wallet refresh warning: ${refreshError.message}`);
            }
        }

            const currentWalletState = scannerService.walletManagerService?.getCurrentWalletState() || this._getCurrentWalletState();
        const usdtBalanceObject = (currentWalletState?.balances || []).find(b => b.asset === 'USDT');
        const availableUsdt = parseFloat(usdtBalanceObject?.free || '0');
        const lockedUsdt = parseFloat(usdtBalanceObject?.locked || '0');
        // CRITICAL FIX: Get actual open positions count from PositionManager's internal cache
            const walletPositionsCount = scannerService.positionManager.positions.length;

            console.log(`[AutoScannerService] 💰 Using ${scannerService.state.tradingMode.toUpperCase()} wallet state. USDT Balance: ${scannerService._formatCurrency(availableUsdt)} | Positions: ${walletPositionsCount}`);

        // Run full reconciliation every 5 scans
        if (scannerService.state.stats.totalScans % 5 === 0 && scannerService.state.stats.totalScans > 0) {
            const _step9_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 9: Performing periodic reconciliation (${Date.now() - _monitorStartTime}ms since start)`);
            try {
                const reconcileResult = await scannerService.positionManager.reconcileWithBinance();
                if (reconcileResult.success && reconcileResult.summary) {
                    const s = reconcileResult.summary;
                    console.log(`[AutoScannerService] [RECONCILE] ✅ Sync complete: ${s.positionsRemaining} positions, ${s.ghostPositionsCleaned} ghosts cleaned, ${s.externalOrders || 0} external orders`);
                } else if (!reconcileResult.success) {
                    console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation failed: ${reconcileResult.error || 'Unknown issue'}. Continuing with scan cycle.`);
                } else {
                    console.log('[AutoScannerService] [RECONCILE] ℹ️ Reconciliation completed with no specific summary (likely no changes)');
                }
                console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 9 complete: Reconciliation finished (${Date.now() - _step9_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
            } catch (reconcileError) {
                console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation error: ${reconcileError.message}`);
            }
        }

        if (scannerService.state.stats.totalScans % 10 === 0 && scannerService.state.stats.totalScans > 0) {
            const _step10_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 10: Performing position data reconciliation (${Date.now() - _monitorStartTime}ms since start)`);
            const reconcileResult = await scannerService.positionManager.reconcilePositionData();
            if (reconcileResult.cleaned > 0) {
                //this.addLog(`[RECONCILE] ✅ Cleaned up ${reconcileResult.cleaned} stale position records.`, 'success');
            }
            if (reconcileResult.errors.length > 0) {
                console.log(`[AutoScannerService] [RECONCILE] ℹ️ Found ${reconcileResult.errors.length} position data issues`);
            }
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 10 complete: Position data reconciliation finished (${Date.now() - _step10_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
        }

        // Run Fear & Greed Index update every 10 scans
        if (scannerService.state.stats.totalScans % 10 === 0 && scannerService.state.stats.totalScans > 0) {
            const _step11_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 11: Fetching Fear & Greed Index (${Date.now() - _monitorStartTime}ms since start)`);
            try {
                await scannerService._fetchFearAndGreedIndex();
                const fngData = scannerService.state.fearAndGreedData;
                if (fngData) {
                    console.log(`[AutoScannerService] [F&G_INDEX] ✅ Updated: ${fngData.value} (${fngData.value_classification})`);
                    this.addLog(`[F&G Index] ✅ Updated: ${fngData.value} (${fngData.value_classification})`, 'system');
                } else {
                    console.warn('[ScanEngineService] [F&G_INDEX] ⚠️ No F&G data after fetch');
                }
                console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 11 complete: Fear & Greed Index fetched (${Date.now() - _step11_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
            } catch (fngError) {
                console.warn(`[AutoScannerService] [F&G_INDEX] ⚠️ Fear & Greed update failed: ${fngError.message}`);
                console.error('[ScanEngineService] [F&G_INDEX] ❌ Fear & Greed fetch error:', fngError);
            }
        }

        // Run wallet state reconciliation every 20 scans
        if (scannerService.state.stats.totalScans % 20 === 0 && scannerService.state.stats.totalScans > 0) {
            const _step12_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 12: Running wallet state reconciliation (${Date.now() - _monitorStartTime}ms since start)`);
            try {
                const walletReconcileResult = await queueFunctionCall(
                    'reconcileWalletState',
                    reconcileWalletState,
                    { mode: scannerService.state.tradingMode },
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
                console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 12 complete: Wallet state reconciliation finished (${Date.now() - _step12_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
            } catch (walletReconcileError) {
                console.warn(`[AutoScannerService] [WALLET_RECONCILE] ⚠️ Wallet reconciliation error: ${walletReconcileError.message}`);
            }
        }

        // Monitor pending orders every 5 scans
        if (scannerService.state.stats.totalScans % 5 === 0 && scannerService.state.stats.totalScans > 0) {
            const _step13_start = Date.now();
            console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 13: Checking pending orders (${Date.now() - _monitorStartTime}ms since start)`);
            try {
                // Initialize order monitoring if not already done
                scannerService.positionManager.initializeOrderMonitoring();
                
                if (scannerService.positionManager.pendingOrderManager) {
                    const orderStats = scannerService.positionManager.pendingOrderManager.getStatistics();
                    if (orderStats.pending.count > 0) {
                        console.log(`[AutoScannerService] [ORDER_MONITOR] 📊 Pending orders: ${orderStats.pending.count}, Failed: ${orderStats.failed.count}`);
                        this.addLog(`[ORDER_MONITOR] 📊 Monitoring ${orderStats.pending.count} pending orders, ${orderStats.failed.count} failed`, 'info');
                    }
                    
                    // Clean up old failed orders
                    scannerService.positionManager.pendingOrderManager.cleanupOldFailedOrders();
                } else {
                    console.log('[AutoScannerService] [ORDER_MONITOR] ⚠️ PendingOrderManager not initialized yet');
                }
                console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 13 complete: Order monitoring finished (${Date.now() - _step13_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
            } catch (orderMonitorError) {
                console.warn(`[AutoScannerService] [ORDER_MONITOR] ⚠️ Order monitoring error: ${orderMonitorError.message}`);
            }
        }

        // Run ghost position purging every 15 scans (DISABLED for testnet to prevent false positives)
        if (scannerService.state.stats.totalScans % 15 === 0 && scannerService.state.stats.totalScans > 0) {
            if (scannerService.state.tradingMode === 'mainnet') {
                const _step14_start = Date.now();
                console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 14: Performing ghost position purging (${Date.now() - _monitorStartTime}ms since start)`);
                try {
                    const ghostPurgeResult = await queueFunctionCall(
                        'purgeGhostPositions',
                        purgeGhostPositions,
                        { 
                            mode: scannerService.state.tradingMode,
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
                    console.log(`[ScanEngineService] [MONITOR] [TIMING] Step 14 complete: Ghost position purging finished (${Date.now() - _step14_start}ms, ${Date.now() - _monitorStartTime}ms total)`);
                } catch (ghostPurgeError) {
                    console.warn(`[AutoScannerService] [GHOST_PURGE] ⚠️ Ghost purge error: ${ghostPurgeError.message}`);
                }
            } else {
                console.log('[AutoScannerService] [GHOST_PURGE] ⚠️ Ghost purging disabled for testnet mode to prevent false positives');
            }
        }

        // NOTE: monitorAndClosePositions is already called above (line 410) and handles executeBatchClose internally
        // No need for duplicate calls here
        
        const _totalTime = Date.now() - _monitorStartTime;
        console.log(`[ScanEngineService] ⏱️ [_monitorPositions] END: Total ${_totalTime}ms (${(_totalTime/1000).toFixed(2)}s)`);
        return monitorResult;
        } catch (functionError) {
            const errorTime = Date.now() - _monitorStartTime;
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] CATCH BLOCK ENTERED (tryBlockEntered: ${tryBlockEntered}, ${errorTime}ms) 🔴🔴🔴`);
            console.error('[ScanEngineService] [MONITOR] ❌ CRITICAL ERROR in _monitorPositions function body:', functionError);
            console.error('[ScanEngineService] [MONITOR] ❌ Error stack:', functionError.stack);
            console.error('[ScanEngineService] [MONITOR] ❌ Error message:', functionError.message);
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] RETURNING ERROR RESULT (${errorTime}ms) 🔴🔴🔴`);
            // Return empty result to allow scan cycle to continue
            return { signalsFound: 0, tradesExecuted: 0, combinationsEvaluated: 0 };
        } finally {
            const finallyTime = Date.now() - _monitorStartTime;
            // console.error(`[ScanEngineService] [MONITOR] 🔴🔴🔴 [${functionId}] FINALLY BLOCK ENTERED (${finallyTime}ms) 🔴🔴🔴`);
        }
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

        // CRITICAL FIX: Set combinationsMatched to strategiesEvaluated (all strategies evaluated)
        // This represents all strategy evaluations, not just matched/executed ones
        cycleStats.combinationsMatched = cycleStats.strategiesEvaluated || scanResult.signalsFound || 0;
        
        // CRITICAL FIX: Calculate and store lastCycleAverageSignalStrength for Signal Quality
        // This uses the actual signal strength from matched signals in this cycle
        if (cycleStats.signalsFound > 0 && cycleStats.totalCombinedStrength > 0) {
            const cycleAvgStrength = cycleStats.totalCombinedStrength / cycleStats.signalsFound;
            this.scannerService.state.stats.lastCycleAverageSignalStrength = cycleAvgStrength;
        } else if (cycleStats.strategiesEvaluated > 0) {
            // If no signals matched but strategies were evaluated, use average from active strategies
            // This ensures Signal Quality shows data even when no trades executed
            const activeAvgStrength = this.scannerService.state.stats?.averageSignalStrength || 0;
            if (activeAvgStrength > 0) {
                this.scannerService.state.stats.lastCycleAverageSignalStrength = activeAvgStrength;
            }
        }
        
        // CRITICAL FIX: Update signal generation history with ALL strategies evaluated
        // Use strategiesEvaluated (all strategies processed) instead of signalsFound (only matched trades)
        // This ensures Opportunity Score and Signal Quality reflect actual system activity
        const signalsEvaluated = cycleStats.combinationsMatched;
        this.scannerService.state.signalGenerationHistory.push({
            timestamp: Date.now(),
            signalsFound: signalsEvaluated, // Now tracks all evaluated strategies, not just executed
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
            if (count <= 0) return; // Skip zero or invalid counts
            
            const r = String(reason || '').toLowerCase();
            
            // Combined strength - check for both words or variations
            if ((r.includes('combined') && r.includes('strength')) || 
                r.includes('strength below minimum') ||
                r.includes('strength below threshold')) {
                combinedStrengthBelow += count;
            }
            // Conviction score - check for conviction keyword
            // Match: "conviction", "conviction score", "below dynamic threshold" with conviction context
            else if (r.includes('conviction') || 
                     r.includes('conviction score') ||
                     (r.includes('below') && r.includes('threshold') && r.includes('conviction'))) {
                convictionBelowDynamic += count;
            }
            // Insufficient remaining balance/cap - check for remaining balance or cap
            // Match: "insufficient remaining", "not enough remaining", "remaining balance", "remaining cap", etc.
            else if (r.includes('insufficient remaining') || 
                     r.includes('not enough remaining') ||
                     (r.includes('remaining') && (r.includes('balance') || r.includes('cap') || r.includes('threshold'))) ||
                     (r.includes('remaining') && r.includes('to threshold'))) {
                insufficientRemainingCap += count;
            }
            // Balance below limit - check for balance and limit together
            // Match: "balance below limit", "below limit of", "balance" + "limit", etc.
            else if ((r.includes('balance') && r.includes('limit')) ||
                     r.includes('balance below limit') ||
                     r.includes('below limit of') ||
                     (r.includes('balance') && r.includes('below') && r.includes('limit'))) {
                balanceBelowLimit += count;
            }
            // Regime mismatch - check for regime and mismatch or "doesn't match"
            else if ((r.includes('regime') && (r.includes('mismatch') || r.includes("doesn't match") || r.includes('does not match'))) ||
                     r.includes('regime mismatch') ||
                     (r.includes('strategy regime') && r.includes('market regime'))) {
                regimeMismatch += count;
            }
            // All other reasons
            else {
                otherBlocks += count;
            }
        };

        // Process blockReasons first
        for (const [reason, value] of Object.entries(blockReasons)) {
            absorbReason(reason, value);
        }
        // Many pre-evaluation rejections are logged as skipReasons; include them too
        // Pre-evaluation blocks should be counted in the breakdown
        for (const [reason, value] of Object.entries(skipReasons)) {
            const r = String(reason || '').toLowerCase();
            // Process skipReasons that are actually blocking reasons (not just data issues)
            // Include: regime mismatches, balance issues, combined strength, conviction, max positions, coin issues, etc.
            // Exclude: data issues like "Insufficient kline data", "price not available", etc.
            if (r.includes('regime') || 
                r.includes('balance') || 
                r.includes('combined') || 
                r.includes('strength') ||
                r.includes('conviction') || 
                r.includes('insufficient') || 
                r.includes('remaining') ||
                r.includes('cap') ||
                r.includes('max positions') ||
                r.includes('limit') ||
                (r.includes('coin') && (r.includes('not found') || r.includes('not trading'))) ||
                r.includes('post-evaluation')) {
                absorbReason(reason, value);
            }
        }

        const blockedTotal = combinedStrengthBelow + convictionBelowDynamic + balanceBelowLimit + insufficientRemainingCap + regimeMismatch + otherBlocks;

        // Debug logging to verify blockReasons shape and counts
        try {
            if (typeof window !== 'undefined' && !window.__blockedReasonsSampled) {
                window.__blockedReasonsSampled = true;
                //console.log('[BLOCK_REASONS_DEBUG] blockReasons:', blockReasons);
                //console.log('[BLOCK_REASONS_DEBUG] skipReasons:', skipReasons);
                /*console.log('[BLOCK_REASONS_DEBUG] Counts:', {
                    combinedStrengthBelow,
                    convictionBelowDynamic,
                    balanceBelowLimit,
                    insufficientRemainingCap,
                    regimeMismatch,
                    otherBlocks,
                    blockedTotal
                });*/
                
                // Log sample of reasons that went to "otherBlocks" to help identify patterns
                const otherReasonsSample = [];
                const allReasons = { ...blockReasons, ...skipReasons };
                for (const [reason, value] of Object.entries(allReasons)) {
                    const r = String(reason || '').toLowerCase();
                    // Check if this reason would NOT match any specific category
                    const isOther = !(
                        (r.includes('combined') && r.includes('strength')) ||
                        r.includes('conviction') ||
                        (r.includes('remaining') && (r.includes('balance') || r.includes('cap') || r.includes('threshold'))) ||
                        (r.includes('balance') && r.includes('limit')) ||
                        (r.includes('regime') && (r.includes('mismatch') || r.includes("doesn't match")))
                    );
                    if (isOther && otherReasonsSample.length < 10) {
                        otherReasonsSample.push({ reason, count: sumVal(value) });
                    }
                }
                if (otherReasonsSample.length > 0) {
                    console.log('[BLOCK_REASONS_DEBUG] Sample reasons categorized as "other":', otherReasonsSample);
                }
            }
        } catch(_) {}
        
        // Additional debug: Calculate what should be counted from skipReasons
        const countedSkipReasons = Object.entries(skipReasons).filter(([reason]) => {
            const r = String(reason || '').toLowerCase();
            return r.includes('regime') || 
                r.includes('balance') || 
                r.includes('combined') || 
                r.includes('strength') ||
                r.includes('conviction') || 
                r.includes('insufficient') || 
                r.includes('remaining') ||
                r.includes('cap') ||
                r.includes('max positions') ||
                r.includes('limit') ||
                (r.includes('coin') && (r.includes('not found') || r.includes('not trading'))) ||
                r.includes('post-evaluation');
        });
        const countedSkipTotal = countedSkipReasons.reduce((sum, [, value]) => sum + sumVal(value), 0);
        const rawBlockTotal = Object.values(blockReasons).reduce((sum, v) => sum + sumVal(v), 0);
        const expectedTotal = rawBlockTotal + countedSkipTotal;
        
        // Only warn if there's a significant mismatch (allow small rounding differences)
        if (Math.abs(blockedTotal - expectedTotal) > 5 && blockedTotal > 0) {
            console.warn('[BLOCK_REASONS_MISMATCH]', {
                blockedTotal,
                rawBlockTotal,
                countedSkipTotal,
                expectedTotal,
                difference: blockedTotal - expectedTotal,
                blockReasons,
                skipReasons: Object.fromEntries(countedSkipReasons)
            });
        }
        // CRITICAL FIX: Use the same dynamic conviction calculation as SignalDetectionEngine
        // This ensures consistency between the actual filtering and the logging
        const baseConv = this.scannerService.state?.settings?.minimumConvictionScore ?? 50;
        const lpmScore = Number(this.scannerService.state?.performanceMomentumScore ?? 0);
        
        // Use the same logic as computeDynamicConvictionThreshold in SignalDetectionEngine.jsx
        const NEUTRAL_LPM_SCORE = 50;
        const LPM_ADJUSTMENT_FACTOR = 0.5;
        
        let dynConv = baseConv;
        if (Number.isFinite(lpmScore) && Number.isFinite(baseConv)) {
            const deviation = lpmScore - NEUTRAL_LPM_SCORE; // Range: -50 to +50
            const adjustment = deviation * LPM_ADJUSTMENT_FACTOR; // Range: -25 to +25
            const dynamic = baseConv - adjustment; // Higher LPM = lower conviction needed
            // CRITICAL FIX: Clamp between 0 and 100 (allows going below base when LPM is high)
            dynConv = Math.min(100, Math.max(0, dynamic));
        }
        
        const lpmAdj = Number.isFinite(lpmScore) ? (dynConv - baseConv) : 0;

        {
            const mrNow = this.scannerService.state?.marketRegime?.regime || 'unknown';
            const maxCap = this.scannerService.state?.settings?.maxBalanceInvestCapUSDT ?? 'N/A';
        
            const lines = [
                '═══════════════════════════════════════════════════════',
                `${blockedTotal} strategies were blocked`,
                `${combinedStrengthBelow} strategies blocked: combined strength below threshold`,
                `${convictionBelowDynamic} strategies blocked: conviction score below dynamic threshold (${dynConv.toFixed(1)}: base ${baseConv} + LPM adjustment ${lpmAdj > 0 ? '+' : ''}${lpmAdj.toFixed(1)}, LPM: ${Number.isFinite(lpmScore) ? lpmScore.toFixed(1) : 'N/A'})`,
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

        // Log max cap blocking status if applicable
        if (cycleStats.maxCapReached) {
            const allocated = this.scannerService._formatCurrency(cycleStats.maxCapAllocated || this.scannerService._getBalanceAllocatedInTrades());
            const cap = this.scannerService._formatCurrency(cycleStats.maxCapLimit || this.scannerService.state?.settings?.maxBalanceInvestCapUSDT || 0);
            this.addLog(`🚫 All position opening is blocked due to exceeding max cap (Allocated: ${allocated} ≥ Cap: ${cap}). Position monitoring continues.`, 'warning');
        }

        await this._logWalletSummary();

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
    async _logWalletSummary() {
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
        // Realized PnL and trade metrics: prefer summary, then central wallet state, then compute from trades
        const ws = this._getCurrentWalletState?.() || {};
        
        // CRITICAL FIX: Always prefer central wallet state for trade statistics (it's the source of truth)
        // Parse values as numbers to handle string conversions
        const realizedPnl = Number(summary.totalRealizedPnl ?? ws.total_realized_pnl ?? 0);
        const tradesCount = Number(summary.totalTrades ?? ws.total_trades_count ?? ws.total_trades ?? 0);
        const wins = Number(summary.winningTrades ?? ws.winning_trades_count ?? 0);
        const losses = Number(summary.losingTrades ?? ws.losing_trades_count ?? 0);
        const totalGrossProfit = Number(summary.totalGrossProfit ?? ws.total_gross_profit ?? 0);
        const totalGrossLoss = Number(summary.total_gross_loss ?? ws.total_gross_loss ?? 0);
        
        // CRITICAL FIX: Always compute win rate and profit factor from trades if wins/losses are missing
        // OR if we have trades but wins+losses don't match tradesCount (invalid state)
        let finalTradesCount = tradesCount;
        let finalWins = wins;
        let finalLosses = losses;
        let finalRealizedPnl = realizedPnl;
        let finalGrossProfit = totalGrossProfit;
        let finalGrossLoss = totalGrossLoss;
        
        // Fetch trades if:
        // 1. tradesCount is 0/missing/NaN, OR
        // 2. tradesCount > 0 but (wins + losses) === 0 (impossible - can't have trades with no wins/losses)
        // 3. tradesCount > 0 but wins/losses sum doesn't match tradesCount (data inconsistency)
        const hasTradesButNoWinsLosses = tradesCount > 0 && wins === 0 && losses === 0;
        const winsLossesMismatch = tradesCount > 0 && (wins + losses) !== tradesCount && (wins + losses) > 0;
        const needsComputation = !tradesCount || tradesCount === 0 || isNaN(tradesCount) || 
                                hasTradesButNoWinsLosses || winsLossesMismatch;
        
        if (needsComputation) {
            try {
                const { queueEntityCall } = await import('@/components/utils/apiQueue');
                const tradingMode = this.scannerService.state?.tradingMode || 'testnet';
                const allTrades = await queueEntityCall('Trade', 'filter', { trading_mode: tradingMode }, '-exit_timestamp', 10000).catch(() => []);
                
                if (allTrades && allTrades.length > 0) {
                    let computedTrades = 0;
                    let computedWins = 0;
                    let computedLosses = 0;
                    let computedPnl = 0;
                    let computedProfit = 0;
                    let computedLoss = 0;
                    
                    allTrades.forEach(trade => {
                        if (trade.exit_timestamp) { // Only count closed trades
                            computedTrades++;
                            const pnl = Number(trade.pnl_usdt || 0);
                            computedPnl += pnl;
                            
                            if (pnl > 0) {
                                computedWins++;
                                computedProfit += pnl;
                            } else if (pnl < 0) {
                                computedLosses++;
                                computedLoss += Math.abs(pnl);
                            }
                        }
                    });
                    
                    // CRITICAL: Always use computed values when we fetch from trades (source of truth)
                    if (computedTrades > 0) {
                        finalTradesCount = computedTrades;
                        finalWins = computedWins;
                        finalLosses = computedLosses;
                        finalRealizedPnl = computedPnl; // Keep sign (can be negative)
                        finalGrossProfit = computedProfit;
                        finalGrossLoss = computedLoss;
                    }
                    
                    // Trade stats computed
                }
            } catch (error) {
                console.warn('[ScanEngineService] ⚠️ Failed to compute trade stats from trades:', error.message);
            }
        }
        
        // CRITICAL: Calculate win rate and profit factor from final values
        const winRateCalc = (finalWins + finalLosses) > 0 ? (finalWins / (finalWins + finalLosses)) * 100 : 0;
        const profitFactorCalc = finalGrossLoss > 0 ? (finalGrossProfit / finalGrossLoss) : (finalGrossProfit > 0 ? Infinity : 0);
        
        // Win rate and profit factor calculated

        const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const mode = this.scannerService.state?.tradingMode?.toUpperCase?.() || 'UNKNOWN';
        const totalEquity = Number(summary.totalEquity ?? ws.total_equity ?? 0);
        const balanceInTrades = Number(summary.balanceInTrades ?? ws.balance_in_trades ?? 0);
        const utilization = totalEquity > 0 ? ((balanceInTrades / totalEquity) * 100) : 0;
        
        // CRITICAL FIX: Always use calculated values (computed from actual trades or wallet state)
        // These are the source of truth
        const winRate = Number(winRateCalc || 0).toFixed(1);
        const profitFactor = profitFactorCalc === Infinity ? '∞' : Number(profitFactorCalc || 0).toFixed(2);

        this.addLog(`[WALLET] Mode: ${mode} | Total Equity: ${fmt(totalEquity)}`, 'cycle');
        this.addLog(`[WALLET] Total Trades: ${finalTradesCount} | Win Rate: ${winRate}% | Profit Factor: ${profitFactor}`, 'cycle');
        this.addLog(`[WALLET] Open Positions: ${positions.length} | Portfolio Utilization: ${utilization.toFixed(1)}%`, 'cycle');
        this.addLog(`[WALLET] Unrealized P&L: ${fmt(unrealizedPnl)} | Realized P&L: ${fmt(finalRealizedPnl)}`, 'cycle');
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
