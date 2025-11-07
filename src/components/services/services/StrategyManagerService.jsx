/**
 * StrategyManagerService
 * 
 * Manages the loading, filtering, and state of active trading strategies.
 * This class is designed to be instantiated by AutoScannerService and interact with its state.
 */

import { queueEntityCall } from '@/components/utils/apiQueue';

export class StrategyManagerService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        this.toast = scannerService.toast;
        // Reference to AutoScannerService's state for updates
        this.state = scannerService.state;
    }

    /**
     * Internal method to load and filter strategies based on various criteria including current settings.
     * Updates scannerService.state.activeStrategies and related stats.
     * @param {number|null} minCombinedStrengthOverride - Optional override for the minimum combined strength setting.
     * @returns {Array} An array of eligible strategies.
     */
    async _loadAndFilterStrategiesInternal(minCombinedStrengthOverride = null) {
        // Commented out to reduce console flooding
        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] Starting...');
        this.addLog('[StrategyManagerService] Loading and filtering strategies (internal)...', 'info');

        const minimumCombinedStrength = minCombinedStrengthOverride !== null
            ? minCombinedStrengthOverride
            : (this.state.settings?.minimumCombinedStrength || 0);
        
        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] minimumCombinedStrength:', minimumCombinedStrength);
        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] Calling queueEntityCall...');
        
        const strategiesList = await queueEntityCall('BacktestCombination', 'list');
        
        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] queueEntityCall complete, got', strategiesList?.length || 0, 'strategies');

        let totalStrategies = strategiesList?.length || 0;
        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] Total strategies from DB:', totalStrategies);
        
        let filteredOptedOut = 0;
        let filteredUnderperforming = 0;
        let filteredNoSignals = 0;
        let filteredLowStrength = 0;
        let filteredNotIncluded = 0;
        let filteredOther = 0;

        // console.log('[StrategyManagerService] 🔍 [_loadAndFilterStrategiesInternal] Starting filter process...');
        this.addLog(`[StrategyManagerService] Filtering ${totalStrategies} strategies with minimumCombinedStrength=${minimumCombinedStrength}`, 'info');

        const eligibleStrategies = (strategiesList || [])
            .filter(match => {
                if (match.optedOutGlobally || match.optedOutForCoin) {
                    filteredOptedOut++;
                    return false;
                }

                if (!Array.isArray(match.signals) || match.signals.length === 0) {
                    filteredNoSignals++;
                    filteredOther++;
                    return false;
                }

                // Apply minimum combined strength filter
                const combinedStrength = match.combinedStrength || 0;
                if (combinedStrength < minimumCombinedStrength) {
                    filteredLowStrength++;
                    filteredOther++;
                    return false;
                }

                const hasEnoughTrades = (match.realTradeCount || 0) >= 5;
                const isUnderperforming = hasEnoughTrades &&
                    ((match.realProfitFactor || 0) < 0.8 || (match.realSuccessRate || 0) < 25);

                if (isUnderperforming) {
                    filteredUnderperforming++;
                    return false;
                }

                if (!match.includedInScanner) {
                    filteredNotIncluded++;
                    filteredOther++;
                    return false;
                }

                return true;
            })
            .map(match => {
                const realTradeCount = match.realTradeCount || 0;
                const realProfitFactor = match.realProfitFactor || 0;
                const realSuccessRate = match.realSuccessRate || 0;
                const backtestProfitFactor = match.profitFactor || 0;
                const backtestSuccessRate = match.successRate || 0;

                let profitabilityScore = 0;

                if (realTradeCount >= 10) {
                    profitabilityScore = (realProfitFactor * 0.4) + (realSuccessRate * 0.003) +
                        (backtestProfitFactor * 0.2) + (backtestSuccessRate * 0.001) +
                        ((match.combinedStrength || 0) * 0.001);
                } else if (realTradeCount >= 5) {
                    profitabilityScore = (realProfitFactor * 0.3) + (realSuccessRate * 0.002) +
                        (backtestProfitFactor * 0.3) + (backtestSuccessRate * 0.002) +
                        ((match.combinedStrength || 0) * 0.001);
                } else {
                    profitabilityScore = (backtestProfitFactor * 0.4) + (backtestSuccessRate * 0.003) +
                        ((match.combinedStrength || 0) * 0.002) +
                        ((realTradeCount || 0) === 0 ? 0.5 : -0.2);
                    if (!match.realTradeCount && match.combinedStrength > 0) {
                        profitabilityScore += (match.combinedStrength / 1000);
                    }
                }

                const processedStrategy = {
                    ...match,
                    id: match.id,
                    coin: match.coin,
                    timeframe: match.timeframe,
                    signals: match.signals || [],
                    combinationName: match.combinationName || `${match.coin}-Strategy`,
                    combinedStrength: match.combinedStrength || 0,
                    minCoreSignalStrength: match.minCoreSignalStrength || 80,
                    strategyDirection: match.strategyDirection || 'long',
                    takeProfitAtrMultiplier: match.takeProfitAtrMultiplier || 3,
                    stopLossAtrMultiplier: match.stopLossAtrMultiplier || 2.5,
                    estimatedExitTimeMinutes: match.estimatedExitTimeMinutes || null, // Keep in MINUTES
                    enableTrailingTakeProfit: match.enableTrailingTakeProfit !== false,
                    profitabilityScore: profitabilityScore,
                    realTradeCount: realTradeCount
                };

                return processedStrategy;
            })
            .sort((a, b) => b.profitabilityScore - a.profitabilityScore);

        this.state.activeStrategies = eligibleStrategies; // Update scanner service state
        this.state.stats.activeStrategies = eligibleStrategies.length;

        const totalCombinedStrength = eligibleStrategies.reduce((acc, s) => acc + (s.combinedStrength || 0), 0);
        this.state.stats.averageSignalStrength = eligibleStrategies.length > 0
            ? totalCombinedStrength / eligibleStrategies.length
            : 0;

        const activeCount = eligibleStrategies.length;
        this.addLog(`[StrategyManagerService] Strategy filtering complete: ${activeCount}/${totalStrategies} active`, 'info');
        if (filteredOptedOut > 0) {
            this.addLog(`  └─ Opted-out: ${filteredOptedOut}`, 'info');
        }
        if (filteredUnderperforming > 0) {
            this.addLog(`  └─ Underperforming: ${filteredUnderperforming}`, 'info');
        }
        if (filteredNoSignals > 0) {
            this.addLog(`  └─ No signals/empty signals: ${filteredNoSignals}`, 'info');
        }
        if (filteredLowStrength > 0) {
            this.addLog(`  └─ Low combined strength (< ${minimumCombinedStrength}): ${filteredLowStrength}`, 'info');
        }
        if (filteredNotIncluded > 0) {
            this.addLog(`  └─ Not included in scanner (includedInScanner=false): ${filteredNotIncluded}`, 'info');
        }
        if (activeCount === 0 && totalStrategies > 0) {
            this.addLog(`⚠️ All ${totalStrategies} strategies filtered out. Check scanner settings and strategy configuration.`, 'warning');
        }

        if (eligibleStrategies.length > 0) {
            const topStrategy = eligibleStrategies[0];
            const avgScore = eligibleStrategies.reduce((sum, s) => sum + (s.profitabilityScore || 0), 0) / eligibleStrategies.length;
            const strategiesWithDemoTrades = eligibleStrategies.filter(s => (s.realTradeCount || 0) > 0).length;

            this.addLog(`📊 Strategy Prioritization Complete: ${eligibleStrategies.length} strategies loaded`, 'info');
            this.addLog(`📈 Top strategy: ${topStrategy.combinationName} (Score: ${(topStrategy.profitabilityScore || 0).toFixed(1)}, Avg: ${avgScore.toFixed(1)})`, 'info');
            this.addLog(`🎯 ${strategiesWithDemoTrades}/${eligibleStrategies.length} strategies have demo trading data`, 'info');
        } else {
            this.addLog(`📊 Strategy Prioritization Complete: No eligible strategies found`, 'warning');
        }

        this.scannerService.notifySubscribers();
        return eligibleStrategies; // Return the filtered strategies
    }

    /**
     * Public method to load and filter strategies, typically called by AutoScannerService.
     * @param {string} tradingMode - The current trading mode ('testnet' or 'live').
     * @returns {Array} An array of eligible strategies.
     */
    async loadActiveStrategies(tradingMode) {
        // The tradingMode parameter could be used here if 'BacktestCombination' entity filtering
        // needed to be specific to tradingMode, but currently, it lists all.
        return this._loadAndFilterStrategiesInternal();
    }

    /**
     * Refreshes the list of active strategies, typically after new backtest results or settings changes.
     */
    async refreshStrategies() {
        this.addLog('[StrategyManagerService] Refreshing strategy list due to new backtest results or tradingMode...', 'info');

        try {
            const oldCount = this.scannerService.state.activeStrategies?.length || 0;
            const newStrategies = await this.loadActiveStrategies(this.scannerService.getTradingMode()); // Use the new public method
            
            // CRITICAL: Update scanner state with new strategies
            this.scannerService.state.activeStrategies = newStrategies;
            
            // Update PositionManager and SignalDetectionEngine with new strategies
            if (this.scannerService.positionManager) {
                const activeStrategiesMap = new Map();
                newStrategies.forEach(strategy => {
                    if (strategy.combinationName) {
                        activeStrategiesMap.set(strategy.combinationName, strategy);
                    }
                });
                this.scannerService.positionManager.activeStrategies = activeStrategiesMap;
                console.log(`[StrategyManagerService] ✅ Updated PositionManager with ${activeStrategiesMap.size} strategies`);
            }
            
            if (this.scannerService.signalDetectionEngine && typeof this.scannerService.signalDetectionEngine.updateStrategies === 'function') {
                this.scannerService.signalDetectionEngine.updateStrategies(newStrategies);
                console.log(`[StrategyManagerService] ✅ Updated SignalDetectionEngine with ${newStrategies.length} strategies`);
            }
            
            const newCount = newStrategies.length;
            const countChange = newCount - oldCount;
            const changeText = countChange > 0 ? `+${countChange}` : countChange.toString();

            this.addLog(`✅ Strategy list refreshed: ${newCount} strategies (${changeText} from before)`, 'success');
            
            // Notify subscribers of state change
            this.scannerService.notifySubscribers();

            if (this.toast) {
                this.toast({
                    title: "Strategy List Updated",
                    description: `Scanner now has ${newCount} strategies (${changeText})`,
                    variant: "default"
                });
            }

        } catch (error) {
            this.addLog(`❌ Failed to refresh strategies: ${error.message}`, 'error', error);
        }
    }

    /**
     * Evaluates active strategies and detects signals, delegating to SignalDetectionEngine.
     * This method also manages the `newPositionsCount` in the scanner's state.
     * @param {Array} strategies - List of active strategies.
     * @param {object} currentWalletState - The current wallet state.
     * @param {object} settings - Scanner settings.
     * @param {object} marketRegime - Current market regime data.
     * @param {object} currentPrices - Current market prices.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     * @returns {object} Scan result from signal detection, including signalsFound and tradesExecuted.
     */
    async evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {
        // Reset newPositionsCount for this evaluation cycle
        this.scannerService.state.newPositionsCount = 0;

        const scanResult = await this.scannerService.signalDetectionEngine.scanForSignals(
            strategies,
            currentWalletState,
            settings,
            marketRegime,
            currentPrices,
            cycleStats
        );

        // Assuming scanForSignals (via PositionManager) updates cycleStats.positionsOpened,
        // we can use it to reflect newPositionsCount.
        // Or, more directly, assume scanResult includes tradesExecuted which represents new positions.
        this.scannerService.state.newPositionsCount = scanResult.tradesExecuted;

        return scanResult; // { signalsFound, tradesExecuted }
    }
}

// Add lightweight helpers near the top-level of this file (outside the class) if not present
function _getRegimeNameSafe(regime) {
    if (!regime || typeof regime !== 'object') return null;
    const candidates = [regime.name, regime.regime, regime.phase, regime.trend, regime.state, regime.type];
    const found = candidates.find((v) => typeof v === 'string' && v.length > 0);
    return found ? String(found).toLowerCase() : null;
}

export default StrategyManagerService;
