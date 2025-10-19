
import { queueEntityCall } from "@/components/utils/apiQueue";

export default class StrategyManagerService {
  constructor(scanner) {
    this.scanner = scanner;
  }

  async loadAndFilterStrategies(minCombinedStrengthOverride = null) {
    const s = this.scanner;
    s.addLog('[StrategyManagerService] Loading and filtering strategies...', 'info');

    const minimumCombinedStrength =
      minCombinedStrengthOverride !== null
        ? minCombinedStrengthOverride
        : (s.state.settings?.minimumCombinedStrength || 0);

    const strategiesList = await queueEntityCall('BacktestCombination', 'list');

    /*console.log('[POSITIONS_TIME_DEBUG] Raw strategies loaded from database:', {
        totalStrategies: strategiesList?.length || 0,
        sampleStrategy: strategiesList?.[0] ? {
            combinationName: strategiesList[0].combinationName,
            estimatedExitTimeMinutes_raw: strategiesList[0].estimatedExitTimeMinutes,
            estimatedExitTimeMinutes_type: typeof strategiesList[0].estimatedExitTimeMinutes
        } : null
    });*/

    let totalStrategies = strategiesList?.length || 0;
    let filteredOptedOut = 0;
    let filteredUnderperforming = 0;
    let filteredOther = 0;

    const eligibleStrategies = (strategiesList || [])
      .filter(match => {
        if (match.optedOutGlobally || match.optedOutForCoin) {
          filteredOptedOut++;
          return false;
        }

        if (!Array.isArray(match.signals) || match.signals.length === 0) {
          filteredOther++;
          return false;
        }

        if ((match.combinedStrength || 0) < minimumCombinedStrength) {
          filteredOther++;
          return false;
        }

        const hasEnoughTrades = (match.realTradeCount || 0) >= 5;
        const isUnderperforming =
          hasEnoughTrades &&
          ((match.realProfitFactor || 0) < 0.8 || (match.realSuccessRate || 0) < 25);

        if (isUnderperforming) {
          filteredUnderperforming++;
          return false;
        }

        if (!match.includedInScanner) {
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
          profitabilityScore =
            (realProfitFactor * 0.4) +
            (realSuccessRate * 0.003) +
            (backtestProfitFactor * 0.2) +
            (backtestSuccessRate * 0.001) +
            ((match.combinedStrength || 0) * 0.001);
        } else if (realTradeCount >= 5) {
          profitabilityScore =
            (realProfitFactor * 0.3) +
            (realSuccessRate * 0.002) +
            (backtestProfitFactor * 0.3) +
            (backtestSuccessRate * 0.002) +
            ((match.combinedStrength || 0) * 0.001);
        } else {
          profitabilityScore =
            (backtestProfitFactor * 0.4) +
            (backtestSuccessRate * 0.003) +
            ((match.combinedStrength || 0) * 0.002) +
            ((realTradeCount || 0) === 0 ? 0.5 : -0.2);
          if (!match.realTradeCount && match.combinedStrength > 0) {
            profitabilityScore += (match.combinedStrength / 1000);
          }
        }

        // CRITICAL: DO NOT CONVERT estimatedExitTimeMinutes HERE
        // Keep it in minutes as stored in the database
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

        /*console.log('[POSITIONS_TIME_DEBUG] Processed strategy:', {
            combinationName: processedStrategy.combinationName,
            estimatedExitTimeMinutes_database: match.estimatedExitTimeMinutes,
            estimatedExitTimeMinutes_processed: processedStrategy.estimatedExitTimeMinutes,
            estimatedExitTimeMinutes_type: typeof processedStrategy.estimatedExitTimeMinutes
        });*/

        return processedStrategy;
      })
      .sort((a, b) => b.profitabilityScore - a.profitabilityScore);

    // Mutate scanner state
    s.state.activeStrategies = eligibleStrategies;
    s.state.stats.activeStrategies = eligibleStrategies.length;

    const totalCombinedStrength = eligibleStrategies.reduce((acc, st) => acc + (st.combinedStrength || 0), 0);
    s.state.stats.averageSignalStrength =
      eligibleStrategies.length > 0 ? totalCombinedStrength / eligibleStrategies.length : 0;

    const activeCount = eligibleStrategies.length;
    s.addLog(
      `[StrategyManagerService] Strategy filtering complete: ${activeCount}/${totalStrategies} active (` +
      `${filteredOptedOut} opted-out, ${filteredUnderperforming} underperforming, ${filteredOther} other)`,
      'info'
    );

    if (eligibleStrategies.length > 0) {
      const topStrategy = eligibleStrategies[0];
      const avgScore = eligibleStrategies.reduce((sum, st) => sum + (st.profitabilityScore || 0), 0) / eligibleStrategies.length;
      const strategiesWithDemoTrades = eligibleStrategies.filter(st => (st.realTradeCount || 0) > 0).length;

      s.addLog(`📊 Strategy Prioritization Complete: ${eligibleStrategies.length} strategies loaded`, 'info');
      s.addLog(`📈 Top strategy: ${topStrategy.combinationName} (Score: ${(topStrategy.profitabilityScore || 0).toFixed(1)}, Avg: ${avgScore.toFixed(1)})`, 'info');
      s.addLog(`🎯 ${strategiesWithDemoTrades}/${eligibleStrategies.length} strategies have demo trading data`, 'info');
    } else {
      s.addLog(`📊 Strategy Prioritization Complete: No eligible strategies found`, 'warning');
    }

    s.notifySubscribers?.();
    return eligibleStrategies;
  }

  async refreshStrategies() {
    const s = this.scanner;
    s.addLog('[StrategyManager] Refreshing strategies due to config change or trading mode update...', 'info');
    try {
      const oldCount = s.state.activeStrategies?.length || 0;
      await this.loadAndFilterStrategies();
      const newCount = s.state.activeStrategies.length;
      const countChange = newCount - oldCount;
      const changeText = countChange > 0 ? `+${countChange}` : countChange.toString();

      s.addLog(`✅ Strategy list refreshed: ${newCount} strategies (${changeText} from before)`, 'success');

      if (s.toast) {
        s.toast({
          title: "Strategy List Updated",
          description: `Scanner now has ${newCount} strategies (${changeText})`,
          variant: "default",
        });
      }
      return true;
    } catch (error) {
      s.addLog(`❌ Failed to refresh strategies: ${error.message}`, 'error', error);
      return false;
    }
  }

  // Implementation of the outlined changes:
  // This method assumes 'this.scanner' has a 'getState' method and a 'signalDetectionEngine' property,
  // as implied by the outline's original 'this.scannerService' and 'this.signalDetectionEngine' references.
  // It also assumes 'context' will contain 'strategies', 'symbols', and 'settings' when called.
  async evaluateStrategies(context) {
    // Get current momentum score from scanner service state
    // We're aliasing 'this.scanner' to 'scannerService' for consistency with the outline's naming convention,
    // assuming 'this.scanner' is the service object handling state.
    const scannerService = this.scanner; 
    const momentum =
      scannerService?.getState ? scannerService.getState()?.performanceMomentumScore : undefined;

    // The outline implies 'strategies', 'symbols', and 'settings' are resolved
    // earlier in the `evaluateStrategies` method. We'll extract them from `context`.
    const { strategies, symbols, settings } = context;

    // When invoking the signal detection engine, pass the momentum score via options.
    // We're assuming 'this.scanner' (our 'scannerService') has a 'signalDetectionEngine' property.
    if (!scannerService.signalDetectionEngine) {
        throw new Error("SignalDetectionEngine not found on the scanner service. Cannot evaluate strategies.");
    }
    
    const results = await scannerService.signalDetectionEngine.scanForSignals(
      { strategies, symbols, settings, ...context },
      { performanceMomentumScore: momentum }
    );

    return results;
  }
}
