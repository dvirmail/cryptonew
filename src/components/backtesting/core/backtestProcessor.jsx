
/**
 * Helper function to identify swing lows within a given price array
 * A swing low is a candle whose low is lower than N candles before and after it
 * @param {Array<Object>} klineData - Array of kline data (objects with OHLCV properties)
 * @param {number} startIndex - Starting index to look for swing lows
 * @param {number} endIndex - Ending index to look for swing lows  
 * @param {number} swingPeriod - Number of candles to look before/after for swing identification
 * @returns {Array<number>} Array of swing low prices
 */
// The identifySwingLows function is no longer used for median drawdown calculation and can be removed.
// If it's used elsewhere, it should be preserved. Assuming it's not and removing as per the changes.
/*
const identifySwingLows = (klineData, startIndex, endIndex, swingPeriod = 3) => {
  const swingLows = [];

  // Ensure we have enough data to identify swings
  const actualStart = Math.max(startIndex, swingPeriod);
  const actualEnd = Math.min(endIndex, klineData.length - 1 - swingPeriod);

  for (let i = actualStart; i <= actualEnd; i++) {
    const currentLow = klineData[i]?.low; // Access 'low' property
    if (typeof currentLow !== 'number' || isNaN(currentLow)) continue;

    let isSwingLow = true;

    // Check if current low is lower than surrounding candles
    for (let j = i - swingPeriod; j <= i + swingPeriod; j++) {
      if (j === i) continue; // Skip the current candle
      if (j < 0 || j >= klineData.length) continue; // Ensure index is within bounds

      const compareLow = klineData[j]?.low;
      if (typeof compareLow !== 'number' || isNaN(compareLow) || currentLow >= compareLow) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swingLows.push(currentLow);
    }
  }

  return swingLows;
};
*/

/**
 * Calculate median from an array of numbers
 * @param {Array<number>} numbers - Array of numeric values
 * @returns {number|null} Median value or null if array is empty
 */
const calculateMedian = (numbers) => {
  if (!numbers || numbers.length === 0) return null;

  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    // Even number of elements - average of two middle values
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    // Odd number of elements - middle value
    return sorted[mid];
  }
};

/**
 * Helper function to calculate performance metrics for a group of matches.
 * @param {Array<Object>} matches - Array of match objects.
 * @returns {{successfulMatches: Array<Object>, failedMatches: Array<Object>, totalGrossProfit: number, totalGrossLoss: number, successfulCount: number, failCount: number}} Performance metrics.
 */
const calculatePerformance = (matches) => {
  const successfulMatches = matches.filter(m => m.successful);
  const failedMatches = matches.filter(m => !m.successful);

  const successfulCount = successfulMatches.length;
  const failCount = failedMatches.length;

  const totalGrossProfit = matches.reduce((sum, m) => sum + (m.priceMove > 0 ? m.priceMove : 0), 0);
  const totalGrossLoss = matches.reduce((sum, m) => sum + (m.priceMove < 0 ? Math.abs(m.priceMove) : 0), 0);

  return { successfulMatches, failedMatches, totalGrossProfit, totalGrossLoss, successfulCount, failCount };
};

// Module-level variable to track regime performance logging (avoids flooding console)
let regimePerformanceLogCount = {};

// Calculate exit reason breakdown from backtest matches
function calculateBacktestExitReasonBreakdown(matches, takeProfitPercentage, stopLossPercentage) {
  const breakdown = {};
  const totalMatches = matches.length;
  
  if (totalMatches === 0) return null;
  
  matches.forEach(match => {
    // Infer exit reason from match data
    let exitReason = 'unknown';
    
    if (match.successful) {
      // Successful trade - likely take profit
      if (match.priceMove >= (takeProfitPercentage * 0.9)) { // Within 90% of TP
        exitReason = 'take_profit';
      } else {
        exitReason = 'timeout'; // Hit TP but not at full percentage (timeout)
      }
    } else {
      // Failed trade - likely stop loss
      if (Math.abs(match.priceMove) >= (stopLossPercentage * 0.9)) { // Within 90% of SL
        exitReason = 'stop_loss';
      } else {
        exitReason = 'timeout'; // Hit SL but not at full percentage (timeout)
      }
    }
    
    if (!breakdown[exitReason]) {
      breakdown[exitReason] = {
        count: 0,
        percentage: 0,
        avg_pnl: 0,
        total_pnl: 0
      };
    }
    
    breakdown[exitReason].count++;
    breakdown[exitReason].total_pnl += match.priceMove || 0;
  });
  
  // Calculate percentages and averages
  Object.keys(breakdown).forEach(reason => {
    breakdown[reason].percentage = (breakdown[reason].count / totalMatches) * 100;
    breakdown[reason].avg_pnl = breakdown[reason].total_pnl / breakdown[reason].count;
  });
  
  return breakdown;
}

export const processMatches = (rawMatches, config, classifySignalType, historicalData = null) => {
  console.log(`[PROCESS_SUMMARY] 🔍 Processing ${rawMatches.length} raw matches with minOccurrences=${config.minOccurrences || 2}`);
  
  // Calculate average loss per losing trade from ALL matches for zero-loss PF calculation
  const allLosingTrades = rawMatches.filter(m => !m.successful && m.priceMove < 0);
  const totalLossFromAllTrades = allLosingTrades.reduce((sum, m) => sum + Math.abs(m.priceMove), 0);
  const avgLossPerLosingTrade = allLosingTrades.length > 0 
    ? totalLossFromAllTrades / allLosingTrades.length 
    : 1.0; // Fallback to 1% if no losing trades exist
  
  const combinations = new Map();
  const { minOccurrences = 2, timeWindow = '4h', timeframe = '4h' } = config;
  
  // DEBUG: Track strength distribution (minimal logging)
  const strengthStats = { total: 0, min: Infinity, max: -Infinity };

  // Calculate time window in candles for swing low identification (Note: This is no longer used for median drawdown directly)
  const timeWindowMinutes = getTimeframeInMinutes(timeWindow);
  const candleDurationMinutes = getTimeframeInMinutes(timeframe);
  const timeWindowInCandles = candleDurationMinutes > 0 ? Math.floor(timeWindowMinutes / candleDurationMinutes) : 20; // Default to 20 candles if calculation fails

  rawMatches.forEach((match) => {
    // DEBUG: Track strength distribution (no per-match logging)
    const matchStrength = match.combinedStrength || 0;
    strengthStats.total++;
    strengthStats.min = Math.min(strengthStats.min, matchStrength);
    strengthStats.max = Math.max(strengthStats.max, matchStrength);
    
    // Generate combination name from signals
    const combinationName = match.signals.map(s => s.value || s.type).sort().join(' + ');
    // Include coin in the key to ensure combinations are grouped per coin
    const combinationKey = `${match.coin}-${combinationName}`;

    if (!combinations.has(combinationKey)) {
      // Initialize new combination entry
      combinations.set(combinationKey, {
        signals: match.signals.map(s => ({
          ...s,
          isEvent: classifySignalType(s)
        })),
        matches: [], // ALL matches for this combination (for profit factor calculation)
        filteredMatches: [], // Only matches that passed minCombinedStrength (for filtering)
        combinedStrength: 0,
        coin: match.coin, // Preserve the coin information from the match
        combinationName: combinationName, // Store the original combination name
        marketRegimePerformance: {
          uptrend: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          downtrend: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          ranging: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          unknown: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 }
        }
      });
    }

    const combination = combinations.get(combinationKey);

    // Store ALL matches for profit factor calculation (regardless of minCombinedStrength)
    // NOTE: Currently, rawMatches are already filtered by minCombinedStrength in BacktestingEngine
    // This means we're only getting filtered matches. To use ALL occurrences, we'd need to
    // modify BacktestingEngine to collect all matches, not just filtered ones.
    combination.matches.push(match);
    combination.combinedStrength += match.combinedStrength || 0;

    // Tally regime-specific data
    const regime = match.marketRegime || 'unknown';
    if (!combination.marketRegimePerformance[regime]) {
      combination.marketRegimePerformance[regime] = { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 };
    }

    const regimePerf = combination.marketRegimePerformance[regime];
    regimePerf.occurrences++;
    if (match.successful) {
      regimePerf.successful++;
      regimePerf.grossProfit += match.priceMove || 0;
    } else {
      regimePerf.grossLoss += Math.abs(match.priceMove || 0);
    }
  });

  const processedCombinations = [];

  let processedCount = 0;
  let skippedCount = 0;
  let regimeStats = { total: 0, passed: 0, failed: 0 };

  for (const [combinationKey, comboData] of combinations.entries()) {
    processedCount++;

    if (comboData.matches.length < minOccurrences) {
      skippedCount++;
        // Skip combinations that don't meet minOccurrences
      continue; // Skip combinations that don't meet minOccurrences
    }

    // --- NEW: Regime-Specific Filtering Logic ---
    const regimePerf = comboData.marketRegimePerformance;
    const validRegimes = [];

    // Check each regime separately against the minimum occurrences threshold
    for (const regime in regimePerf) {
      const regimeData = regimePerf[regime];
      regimeStats.total++;
      
      if (regimeData.occurrences >= minOccurrences) {
        validRegimes.push({
          regime: regime,
          occurrences: regimeData.occurrences,
          successful: regimeData.successful,
          grossProfit: regimeData.grossProfit,
          grossLoss: regimeData.grossLoss
        });
        regimeStats.passed++;
      } else {
        regimeStats.failed++;
      }
    }

    // If no regimes pass the filter, skip this combination entirely
    if (validRegimes.length === 0) {
      skippedCount++;
      continue;
    }

    // Create separate strategy entries for each valid regime
    for (const validRegime of validRegimes) {
      const regimeSpecificName = `${comboData.combinationName} (${validRegime.regime.toUpperCase()})`;
      
      // Filter matches for this specific regime
      const regimeMatches = comboData.matches.filter(match => 
        (match.marketRegime || 'unknown') === validRegime.regime
      );

      // Removed verbose logging for individual regime matches

      // --- Calculate Regime-Specific Stats ---
      const regimeTotalOccurrences = regimeMatches.length;
      const { successfulMatches: regimeSuccessfulMatches, failedMatches: regimeFailedMatches, totalGrossProfit: regimeTotalGrossProfit, totalGrossLoss: regimeTotalGrossLoss, successfulCount: regimeSuccessfulCount, failCount: regimeFailCount } = calculatePerformance(regimeMatches);

      const regimeSuccessRate = regimeTotalOccurrences > 0 ? (regimeSuccessfulCount / regimeTotalOccurrences) * 100 : 0;
      
      // Log regime performance (sampled: first 3 strategies per regime, then every 100th)
      if (!regimePerformanceLogCount[validRegime.regime]) {
        regimePerformanceLogCount[validRegime.regime] = 0;
      }
      const logCount = regimePerformanceLogCount[validRegime.regime]++;
      const shouldLog = logCount < 3 || logCount % 100 === 0;
      
      if (shouldLog) {
        const profitFactor = regimeTotalGrossLoss > 0 ? (regimeTotalGrossProfit / regimeTotalGrossLoss).toFixed(2) : 'N/A';
        //console.log(`[REGIME_PERFORMANCE] [BACKTEST] Regime: ${validRegime.regime}, Occurrences: ${regimeTotalOccurrences}, Success: ${(regimeSuccessRate).toFixed(1)}% (${regimeSuccessfulCount}/${regimeTotalOccurrences}), Profit: ${regimeTotalGrossProfit.toFixed(2)}%, Loss: ${regimeTotalGrossLoss.toFixed(2)}%, PF: ${profitFactor}, Strategy: ${regimeSpecificName}`);
      }
      
      // INVESTIGATION: Analyze market regime distribution
      if (regimeSuccessRate >= 100.0 && regimeTotalOccurrences > 5) {
        
        // INVESTIGATION: Check market regime bias
        
        // INVESTIGATION: Analyze why 100% success rate
        const avgProfit = regimeSuccessfulMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeSuccessfulCount;
        const minProfit = Math.min(...regimeSuccessfulMatches.map(m => m.priceMove || 0));
        const maxProfit = Math.max(...regimeSuccessfulMatches.map(m => m.priceMove || 0));
        
        
        // INVESTIGATION: Validate calculation correctness
        const allTradesAfterCosts = regimeMatches.map(m => {
          const priceMoveAfterCosts = (m.priceMove || 0) - 0.25; // Apply 0.25% total costs
          return { ...m, priceMoveAfterCosts, isActuallyProfitable: priceMoveAfterCosts > 0 };
        });
        
        const actuallyProfitableCount = allTradesAfterCosts.filter(t => t.isActuallyProfitable).length;
        const calculationCorrectness = actuallyProfitableCount === regimeSuccessfulCount;
        
        
        if (!calculationCorrectness) {
          // Error logging removed to reduce console spam
        }
        
        // INVESTIGATION: Check if all trades are actually profitable
        const unprofitableTrades = allTradesAfterCosts.filter(t => !t.isActuallyProfitable);
        if (unprofitableTrades.length > 0) {
          // Warning logging removed to reduce console spam
        }
      }
      const regimeNetAveragePriceMove = regimeTotalOccurrences > 0 ? regimeMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeTotalOccurrences : 0;
      const regimeAverageCombinedStrength = regimeTotalOccurrences > 0 ? regimeMatches.reduce((sum, m) => sum + (m.combinedStrength || 0), 0) / regimeTotalOccurrences : 0;

      const regimeGrossProfit = regimeTotalGrossProfit;
      const regimeGrossLoss = regimeTotalGrossLoss;

      // FIXED: Use REAL data for profit factor calculation
      // For zero-loss strategies, use average loss from ALL losing trades in the backtest
      let regimeProfitFactor;
      if (regimeGrossLoss === 0) {
        // For zero loss strategies, use average loss from all losing trades in the backtest
        if (regimeGrossProfit > 0 && regimeSuccessfulCount === regimeTotalOccurrences) {
          // Use average loss from all losing trades (real data, not fixed value)
          const calculatedPF = regimeGrossProfit / (avgLossPerLosingTrade * regimeTotalOccurrences);
          regimeProfitFactor = calculatedPF; // No cap - show actual calculated value
          if (calculatedPF > 20.0) {
            // Log when PF is very high
            console.log(`[PF_ZERO_LOSS] Regime "${validRegime.regime}" strategy | PF: ${calculatedPF.toFixed(2)} | ${regimeTotalOccurrences} trades (all successful) | Using avg loss: ${avgLossPerLosingTrade.toFixed(2)}% from ${allLosingTrades.length} losing trades`);
          }
        } else {
          regimeProfitFactor = 1.0;
        }
    } else {
        // Actual PF for strategies with losses
        regimeProfitFactor = regimeGrossProfit / regimeGrossLoss;
        
        // INVESTIGATION: Track high profit factor calculations (reduced logging)
        if (regimeProfitFactor >= 15.0) {
          // High PF logging removed to reduce console spam
        }
      }

      // Calculate regime-specific metrics
      const regimeAverageGainOnSuccess = regimeSuccessfulCount > 0 ? regimeSuccessfulMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeSuccessfulCount : 0;
      const regimeWinLossRatio = regimeFailCount > 0 ? regimeSuccessfulCount / regimeFailCount : regimeSuccessfulCount;
      
      // NEW: Calculate win/loss analysis
      const regimeAvgWinPercent = regimeSuccessfulMatches.length > 0 
        ? regimeSuccessfulMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeSuccessfulMatches.length 
        : null;
      const regimeAvgLossPercent = regimeFailedMatches.length > 0 
        ? Math.abs(regimeFailedMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeFailedMatches.length)
        : null;

      // Calculate regime-specific drawdown
      const regimeDrawdownPercentages = regimeMatches
        .filter(matchData => typeof matchData.maxDrawdown === 'number' && !isNaN(matchData.maxDrawdown))
        .map(matchData => Math.abs(matchData.maxDrawdown));
      
      const regimeMedianDrawdownPercent = regimeDrawdownPercentages.length > 0 ? calculateMedian(regimeDrawdownPercentages) : null;
      const regimeMaxDrawdownPercent = regimeDrawdownPercentages.length > 0 ? Math.max(...regimeDrawdownPercentages) : null;

      // Calculate regime-specific timing statistics
      const regimeTimeToPeakValues = regimeMatches
      .filter(m => typeof m.timeToPeak === 'number' && m.timeToPeak > 0)
      .map(m => m.timeToPeak)
      .sort((a, b) => a - b);

      const regimeSuccessfulTimeToPeakValues = regimeSuccessfulMatches
      .filter(m => typeof m.timeToPeak === 'number' && m.timeToPeak > 0)
      .map(m => m.timeToPeak)
      .sort((a, b) => a - b);

    const calculatePercentile = (sortedArray, percentile) => {
      if (sortedArray.length === 0) return 0;
      const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
      return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
    };

      const regimeTimeToPeak50thPercentile = calculatePercentile(regimeTimeToPeakValues, 50);
      const regimeTimeToPeak75thPercentile = calculatePercentile(regimeTimeToPeakValues, 75);
      const regimeTimeToPeak80thPercentile = calculatePercentile(regimeTimeToPeakValues, 80);
      const regimeTimeToPeak85thPercentile = calculatePercentile(regimeTimeToPeakValues, 85);
      const regimeTimeToPeak95thPercentile = calculatePercentile(regimeTimeToPeakValues, 95);

      const regimeAvgTimeToPeak = regimeTimeToPeakValues.length > 0 ?
        regimeTimeToPeakValues.reduce((sum, val) => sum + val, 0) / regimeTimeToPeakValues.length : 0;

      const regimeAvgSuccessfulTimeToPeak = regimeSuccessfulTimeToPeakValues.length > 0 ?
        regimeSuccessfulTimeToPeakValues.reduce((sum, val) => sum + val, 0) / regimeSuccessfulTimeToPeakValues.length : 0;

      const regimeAvgWinDurationMinutes = regimeAvgSuccessfulTimeToPeak > 0 ? regimeAvgSuccessfulTimeToPeak / (60 * 1000) : 0;

      // NEW: Calculate timing statistics
      const regimeExitTimes = regimeMatches
        .filter(m => m.exitTime && typeof m.exitTime === 'number' && m.exitTime > 0)
        .map(m => m.exitTime / (60 * 1000)); // Convert to minutes
      
      const regimeMedianExitTimeMinutes = regimeExitTimes.length > 0 ? calculateMedian(regimeExitTimes) : null;
      
      // Calculate exit time variance (standard deviation)
      let regimeExitTimeVarianceMinutes = null;
      if (regimeExitTimes.length > 1) {
        const avgExitTime = regimeExitTimes.reduce((sum, t) => sum + t, 0) / regimeExitTimes.length;
        const variance = regimeExitTimes.reduce((sum, t) => sum + Math.pow(t - avgExitTime, 2), 0) / regimeExitTimes.length;
        regimeExitTimeVarianceMinutes = Math.sqrt(variance);
      }
      
      const regimeAvgTimeToPeakMinutes = regimeTimeToPeakValues.length > 0 
        ? regimeTimeToPeakValues.reduce((sum, t) => sum + t, 0) / regimeTimeToPeakValues.length 
        : null;

      // NEW: Calculate consecutive wins/losses
      let regimeMaxConsecutiveWins = 0;
      let regimeMaxConsecutiveLosses = 0;
      let currentStreak = 0;
      let currentType = null;
      
      // Sort matches by time to analyze streaks chronologically
      const sortedRegimeMatches = [...regimeMatches].sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
      
      for (const match of sortedRegimeMatches) {
        const isWin = match.successful;
        if (currentType === null) {
          currentType = isWin ? 'win' : 'loss';
          currentStreak = 1;
        } else if ((currentType === 'win' && isWin) || (currentType === 'loss' && !isWin)) {
          currentStreak++;
        } else {
          // Streak broken, update max
          if (currentType === 'win') {
            regimeMaxConsecutiveWins = Math.max(regimeMaxConsecutiveWins, currentStreak);
          } else {
            regimeMaxConsecutiveLosses = Math.max(regimeMaxConsecutiveLosses, currentStreak);
          }
          currentType = isWin ? 'win' : 'loss';
          currentStreak = 1;
        }
      }
      
      // Final streak check
      if (currentType === 'win') {
        regimeMaxConsecutiveWins = Math.max(regimeMaxConsecutiveWins, currentStreak);
      } else if (currentType === 'loss') {
        regimeMaxConsecutiveLosses = Math.max(regimeMaxConsecutiveLosses, currentStreak);
      }
      
      // NEW: Calculate average trades between wins
      let regimeAvgTradesBetweenWins = null;
      if (regimeSuccessfulMatches.length > 0 && regimeMatches.length > regimeSuccessfulMatches.length) {
        const winIndices = sortedRegimeMatches
          .map((m, idx) => m.successful ? idx : -1)
          .filter(idx => idx >= 0);
        
        if (winIndices.length > 1) {
          const gaps = [];
          for (let i = 1; i < winIndices.length; i++) {
            gaps.push(winIndices[i] - winIndices[i - 1] - 1);
          }
          regimeAvgTradesBetweenWins = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
        }
      }
      
      // NEW: Build regime performance object (detailed metrics per regime)
      // Calculate regime counts from comboData.matches
      const allRegimesInCombo = [...new Set(comboData.matches.map(m => m.marketRegime || 'unknown'))];
      const regimePerformanceDetailed = {};
      allRegimesInCombo.forEach(regime => {
        const regimeMatchesForPerf = comboData.matches.filter(m => (m.marketRegime || 'unknown') === regime);
        const regimeSuccessfulForPerf = regimeMatchesForPerf.filter(m => m.successful);
        const regimeGrossProfitForPerf = regimeSuccessfulForPerf.reduce((sum, m) => sum + (m.priceMove || 0), 0);
        const regimeGrossLossForPerf = Math.abs(regimeMatchesForPerf.filter(m => !m.successful).reduce((sum, m) => sum + (m.priceMove || 0), 0));
        const regimePFForPerf = regimeGrossLossForPerf > 0 ? Math.min(regimeGrossProfitForPerf / regimeGrossLossForPerf, 20.0) : 
          (regimeGrossProfitForPerf > 0 ? Math.min(regimeGrossProfitForPerf / 0.5, 20.0) : 1.0);
        
        regimePerformanceDetailed[regime] = {
          success_rate: regimeMatchesForPerf.length > 0 ? (regimeSuccessfulForPerf.length / regimeMatchesForPerf.length) * 100 : 0,
          occurrences: regimeMatchesForPerf.length,
          avg_price_move: regimeMatchesForPerf.length > 0 ? regimeMatchesForPerf.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeMatchesForPerf.length : 0,
          profit_factor: regimePFForPerf,
          gross_profit: regimeGrossProfitForPerf,
          gross_loss: regimeGrossLossForPerf
        };
      });

      // Calculate regime-specific profitability score
      const regimeProfitabilityScore = regimeSuccessRate * 0.4 + Math.min(regimeNetAveragePriceMove * 10, 100) * 0.3 + Math.min(regimeProfitFactor * 10, 100) * 0.3;

      // Calculate median lowest low during backtest (historical support analysis)
      const regimeHistoricalDrawdownPercentages = regimeMatches
        .filter(match => typeof match.maxDrawdown === 'number' && !isNaN(match.maxDrawdown))
        .map(match => Math.abs(match.maxDrawdown));
      
      const regimeMedianLowestLowDuringBacktest = regimeHistoricalDrawdownPercentages.length > 0 ? calculateMedian(regimeHistoricalDrawdownPercentages) : null;
      

      // Calculate if strategy is event-driven based on signals
      const isEventDrivenStrategy = classifyStrategyAsEventDriven(comboData.signals);

      // Create the regime-specific strategy entry
      const regimeStrategy = {
        combinationName: regimeSpecificName,
        signals: comboData.signals,
        matches: regimeMatches,
        occurrences: regimeTotalOccurrences,
        successfulCount: regimeSuccessfulCount,
        failCount: regimeFailCount,
        successRate: regimeSuccessRate,
        netAveragePriceMove: regimeNetAveragePriceMove,
        averageCombinedStrength: regimeAverageCombinedStrength,
        combinedStrength: regimeAverageCombinedStrength, // Use average for consistency - this is what gets saved to DB
        grossProfit: regimeGrossProfit,
        grossLoss: regimeGrossLoss,
        profitFactor: regimeProfitFactor,
        averageGainOnSuccess: regimeAverageGainOnSuccess,
        winLossRatio: regimeWinLossRatio,
        maxDrawdown: regimeMedianDrawdownPercent,
        timeToPeak50thPercentile: regimeTimeToPeak50thPercentile,
        timeToPeak75thPercentile: regimeTimeToPeak75thPercentile,
        timeToPeak80thPercentile: regimeTimeToPeak80thPercentile,
        timeToPeak85thPercentile: regimeTimeToPeak85thPercentile,
        timeToPeak95thPercentile: regimeTimeToPeak95thPercentile,
        avgTimeToPeak: regimeAvgTimeToPeak,
        avgSuccessfulTimeToPeak: regimeAvgSuccessfulTimeToPeak,
        avgWinDurationMinutes: regimeAvgWinDurationMinutes,
        profitabilityScore: regimeProfitabilityScore,
        marketRegime: validRegime.regime,
        dominantMarketRegime: validRegime.regime, // ✅ FIX: Also set dominantMarketRegime for consistency
        coin: comboData.coin, // Preserve the coin information from the combination data
        medianLowestLowDuringBacktest: regimeMedianLowestLowDuringBacktest, // Add historical support analysis
        isEventDrivenStrategy: isEventDrivenStrategy, // Classify strategy as event-based or state-based
        marketRegimePerformance: {
          [validRegime.regime]: {
            occurrences: validRegime.occurrences,
            successful: validRegime.successful,
            grossProfit: validRegime.grossProfit,
            grossLoss: validRegime.grossLoss
          }
        },
        // NEW: Add all analytics fields
        maxDrawdownPercent: regimeMaxDrawdownPercent,
        medianDrawdownPercent: regimeMedianDrawdownPercent,
        avgWinPercent: regimeAvgWinPercent,
        avgLossPercent: regimeAvgLossPercent,
        medianExitTimeMinutes: regimeMedianExitTimeMinutes,
        exitTimeVarianceMinutes: regimeExitTimeVarianceMinutes,
        avgTimeToPeakMinutes: regimeAvgTimeToPeakMinutes,
        maxConsecutiveWins: regimeMaxConsecutiveWins,
        maxConsecutiveLosses: regimeMaxConsecutiveLosses,
        avgTradesBetweenWins: regimeAvgTradesBetweenWins,
        regimePerformance: regimePerformanceDetailed,
        // NEW: Exit reason breakdown (use default TP/SL if not in config)
        backtestExitReasonBreakdown: calculateBacktestExitReasonBreakdown(
          regimeMatches,
          config?.takeProfitPercentage || 5.0,
          config?.stopLossPercentage || 2.0
        )
      };

      processedCombinations.push(regimeStrategy);
    }
  }

  // Sort by profitability score for better ranking
  processedCombinations.sort((a, b) => (b.profitabilityScore || 0) - (a.profitabilityScore || 0));
  
  // DEBUG: Log summary statistics only
  console.log(`[PROCESS_SUMMARY] 📊 Strength Range: Min=${strengthStats.min.toFixed(1)}, Max=${strengthStats.max.toFixed(1)}, Total matches=${strengthStats.total}`);
  console.log(`[PROCESS_SUMMARY] 📊 Processed ${processedCombinations.length} final strategies from ${combinations.size} unique combinations`);

  // Smart logging with summary statistics
  // Processing summary (reduced logging)

  // Show top strategy details if any found
  if (processedCombinations.length > 0) {
    const topStrategy = processedCombinations[0];
    console.log(`[BACKTEST_FILTER] 🏆 Top Strategy: "${topStrategy.combinationName}" | Occurrences: ${topStrategy.occurrences} | Success: ${topStrategy.successRate.toFixed(1)}% | Profit Factor: ${topStrategy.profitFactor.toFixed(2)}`);
  } else {
    console.log(`[BACKTEST_FILTER] ❌ No processed combinations found! This indicates a filtering issue.`);
  }

  // Final filtering analysis (reduced logging)
    
  // INVESTIGATION: Summary of potentially unrealistic results
  const highPFStrategies = processedCombinations.filter(c => c.profitFactor >= 40.0);
  const perfectSuccessStrategies = processedCombinations.filter(c => c.successRate >= 100.0);
  const zeroLossStrategies = processedCombinations.filter(c => c.grossLoss === 0);
  
  
  // INVESTIGATION: Analyze market regime distribution bias
  // Market regime distribution analysis logs removed to reduce console spam
  
  // Build regime performance data from processed combinations
  const regimePerformance = {};
  processedCombinations.forEach(combo => {
    const regime = combo.marketRegime || 'unknown';
    if (!regimePerformance[regime]) {
      regimePerformance[regime] = [];
    }
    regimePerformance[regime].push(combo);
  });
  
  // Count strategies by regime
  const regimeCounts = {};
  const regimeSuccessCounts = {};
  const regimePerfectCounts = {};
  
  Object.keys(regimePerformance).forEach(regime => {
    const regimeData = regimePerformance[regime];
    regimeCounts[regime] = regimeData.length;
    regimeSuccessCounts[regime] = regimeData.filter(combo => combo.successRate >= 50).length;
    regimePerfectCounts[regime] = regimeData.filter(combo => combo.successRate >= 100).length;
  });
  
  // Regime bias investigation logs removed to reduce console spam
  
  // INVESTIGATION: Check if UPTREND strategies exist at all
  const uptrendStrategies = Object.keys(regimePerformance.uptrend || {});
  const downtrendStrategies = Object.keys(regimePerformance.downtrend || {});
  const rangingStrategies = Object.keys(regimePerformance.ranging || {});
  
  // Strategy distribution logs removed to reduce console spam
  
  if (uptrendStrategies.length === 0) {
    // Warning logs removed to reduce console spam
  }
  
  if (downtrendStrategies.length > uptrendStrategies.length * 10) {
    // Warning logs removed to reduce console spam
  }
  
  // INVESTIGATION: Analyze underlying data distribution
  // Underlying data analysis logs removed to reduce console spam
  
  // Sample some matches to check regime distribution in raw data
  const sampleMatches = [];
  Object.values(regimePerformance).forEach(regimeData => {
    Object.values(regimeData).forEach(combo => {
      if (combo.matches && combo.matches.length > 0) {
        sampleMatches.push(...combo.matches.slice(0, 2)); // Take first 2 matches from each combo
      }
    });
  });
  
  if (sampleMatches.length > 0) {
    const regimeDistribution = {};
    sampleMatches.forEach(match => {
      const regime = match.marketRegime || 'unknown';
      regimeDistribution[regime] = (regimeDistribution[regime] || 0) + 1;
    });
    
    // Sample data regime distribution logs removed to reduce console spam
    
    // Check if the bias is in the raw data or in signal detection
    const totalSampleMatches = Object.values(regimeDistribution).reduce((sum, count) => sum + count, 0);
    const downtrendPercentage = ((regimeDistribution.downtrend || 0) / totalSampleMatches * 100).toFixed(1);
    const uptrendPercentage = ((regimeDistribution.uptrend || 0) / totalSampleMatches * 100).toFixed(1);
    
    // Data bias analysis logs removed to reduce console spam
  }

  return { processedCombinations, totalCombinationsTested: combinations.size };
};

/**
 * Helper function to calculate dominant market regime
 * @param {Array<string>} regimes - An array of market regime strings.
 * @returns {{dominantRegime: string|null, distribution: object}} - The dominant regime and a count of all regimes.
 */
const calculateDominantRegime = (regimes) => {
  if (!regimes || regimes.length === 0) return {
    dominantRegime: null,
    distribution: {}
  };

  const regimeCount = {};
  regimes.forEach(regime => {
    if (regime) {
      regimeCount[regime] = (regimeCount[regime] || 0) + 1;
    }
  });

  let dominantRegime = null;
  let maxCount = 0;

  for (const [regime, count] of Object.entries(regimeCount)) {
    if (count > maxCount) {
      maxCount = count;
      dominantRegime = regime;
    }
  }

  return {
    dominantRegime,
    distribution: regimeCount
  };
};

export const filterMatchesByBestCombination = (rawMatches, processedCombos) => {
  // Create statsMap with both full names (with regime suffix) and base names (without suffix)
  // This allows matching regardless of whether the combination name has a regime suffix
  const statsMap = new Map();
  processedCombos.forEach(c => {
    // Store by full name (e.g., "Signal1 + Signal2 (UPTREND)")
    statsMap.set(c.combinationName, c);
    // Also store by base name (e.g., "Signal1 + Signal2") for matching
    const baseName = c.combinationName.replace(/\s+\([^)]+\)$/, '');
    if (baseName !== c.combinationName) {
      // If base name exists and is different, store it too (keep the best one if multiple regimes exist)
      if (!statsMap.has(baseName) || (c.profitabilityScore || 0) > (statsMap.get(baseName).profitabilityScore || 0)) {
        statsMap.set(baseName, c);
      }
    }
  });
  
  const matchesByTime = new Map();

  const FILTER_BATCH_SIZE = 2000;

  for (let batchStart = 0; batchStart < rawMatches.length; batchStart += FILTER_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + FILTER_BATCH_SIZE, rawMatches.length); // Define batchEnd
    const batch = rawMatches.slice(batchStart, batchEnd);

    for (const match of batch) {
      const comboName = match.signals.map(s => s.value || s.type).sort().join(' + ');
      if (!matchesByTime.has(match.time)) {
        matchesByTime.set(match.time, []);
      }
      matchesByTime.get(match.time).push({ ...match,
        combinationName: comboName
      });
    }

    if (batchStart % (FILTER_BATCH_SIZE * 5) === 0) {
      setTimeout(() => {}, 0);
    }
  }

  const bestMatches = [];
  let processedGroups = 0;
  let matchesWithStats = 0;
  let matchesWithoutStats = 0;

  for (const group of matchesByTime.values()) {
    processedGroups++;

    if (group.length === 1) {
      // Check if this single match has stats
      const stats = statsMap.get(group[0].combinationName) || 
                    statsMap.get(group[0].combinationName.replace(/\s+\([^)]+\)$/, ''));
      if (stats) {
        matchesWithStats++;
        bestMatches.push(group[0]);
      } else {
        matchesWithoutStats++;
        // Don't include matches without stats - they can't be properly evaluated
      }
      continue;
    }

    group.sort((a, b) => {
      // Look up stats - try exact match first, then base name
      let statsA = statsMap.get(a.combinationName);
      if (!statsA) {
        // Try base name if exact match failed
        const baseNameA = a.combinationName.replace(/\s+\([^)]+\)$/, '');
        statsA = statsMap.get(baseNameA);
      }
      
      let statsB = statsMap.get(b.combinationName);
      if (!statsB) {
        // Try base name if exact match failed
        const baseNameB = b.combinationName.replace(/\s+\([^)]+\)$/, '');
        statsB = statsMap.get(baseNameB);
      }

      // If either match has no stats, prioritize the one with stats
      if (!statsA && !statsB) return 0; // Both missing stats, treat as equal
      if (!statsA) return 1; // A has no stats, B wins
      if (!statsB) return -1; // B has no stats, A wins

      // Handle Infinity for profitFactor during comparison
      const pfA = statsA.profitFactor === Infinity ? Number.MAX_VALUE : statsA.profitFactor;
      const pfB = statsB.profitFactor === Infinity ? Number.MAX_VALUE : statsB.profitFactor;

      if (pfB !== pfA) {
        return pfB - pfA;
      }
      if (statsA.maxDrawdown !== statsB.maxDrawdown) {
        return statsA.maxDrawdown - statsB.maxDrawdown;
      }
      return statsB.successRate - statsA.successRate;
    });

    // Only include the best match if it has valid stats
    const bestMatch = group[0];
    const bestStats = statsMap.get(bestMatch.combinationName) || 
                      statsMap.get(bestMatch.combinationName.replace(/\s+\([^)]+\)$/, ''));
    if (bestStats) {
      matchesWithStats++;
      bestMatches.push(bestMatch);
    } else {
      matchesWithoutStats++;
      // Don't include matches without stats - they can't be properly evaluated
    }
  }

  console.log('[FILTER_BEST_DEBUG] 📊 filterMatchesByBestCombination summary:');
  console.log('[FILTER_BEST_DEBUG]   - Total time groups processed:', processedGroups);
  console.log('[FILTER_BEST_DEBUG]   - Matches with valid stats:', matchesWithStats);
  console.log('[FILTER_BEST_DEBUG]   - Matches without stats (excluded):', matchesWithoutStats);
  console.log('[FILTER_BEST_DEBUG]   - Final best matches:', bestMatches.length);

  matchesByTime.clear();
  statsMap.clear();

  return bestMatches;
};

const getTimeframeInMinutes = (timeframe) => {
  if (!timeframe) return 0;
  const value = parseInt(String(timeframe).replace(/\D/g, ''), 10);
  const unit = String(timeframe).replace(/[0-9]/g, '');
  switch (unit) {
    case 'm':
      return value;
    case 'h':
      return value * 60;
    case 'd':
      return value * 60 * 24;
    case 'w':
      return value * 60 * 24 * 7;
    default:
      return 0;
  }
};

/**
 * Processes raw signal combinations to calculate their future outcomes.
 * This logic was extracted from BacktestingEngine.
 * @param {Array} rawMatches - The array of raw signal combinations from the engine.
 * @param {Array} historicalData - The full kline data for the asset.
 * @param {Object} config - Configuration object.
 * @param {number} config.minPriceMove - The target gain percentage.
 * @param {string} config.timeWindow - The future window to check for the price move (e.g., '4h').
 * @param {string} config.timeframe - The candle timeframe (e.g., '15m').
 * @param {string} [config.strategyDirection='long'] - The direction of the strategy ('long' or 'short').
 * @returns {Array} An array of fully processed matches with outcome details.
 */
export const calculateMatchOutcomes = (rawMatches, historicalData, config) => {
  if (!rawMatches || rawMatches.length === 0 || !historicalData || historicalData.length === 0) {
    return [];
  }

  const {
    minPriceMove,
    timeWindow,
    timeframe,
    strategyDirection = 'long' // Default to 'long' if not specified
  } = config;

  const timeWindowInMinutes = getTimeframeInMinutes(timeWindow);
  const candleDurationInMinutes = getTimeframeInMinutes(timeframe);

  if (candleDurationInMinutes === 0) {
    console.error("[calculateMatchOutcomes] Invalid candle timeframe, cannot calculate window.");
    return [];
  }

  const timeWindowInCandles = Math.floor(timeWindowInMinutes / candleDurationInMinutes);

  return rawMatches.map(match => {
    const startIndex = match.candleIndex;
    const entryCandle = historicalData[startIndex];
    if (!entryCandle) return null;

    const entryPrice = entryCandle.close;
    const endIndex = Math.min(startIndex + timeWindowInCandles, historicalData.length - 1);

    let gainAchieved = false;
    let timeToPeak = null;
    let peakPriceTime = entryCandle.time;
    let maxDrawdown = 0; // Initialize maxDrawdown for this specific match (as negative percentage)
    let finalPriceMoveRaw; // This will hold the raw P&L percentage, positive for gain, negative for loss, before direction adjustment/commission

    // Loop to check if Take Profit is hit
    for (let j = startIndex + 1; j <= endIndex; j++) {
      const futureCandle = historicalData[j];
      if (!futureCandle) continue;

      // Calculate drawdown from entry price, ensuring it's always a negative value for the trade
      let currentDrawdownForMatch = 0;
      if (strategyDirection === 'short') {
          // For short, drawdown is when price moves UP from entry
          currentDrawdownForMatch = ((futureCandle.high - entryPrice) / entryPrice) * 100;
          // If current adverse excursion (positive) is worse than current maxDrawdown magnitude
          if (-currentDrawdownForMatch < maxDrawdown) {
              maxDrawdown = -currentDrawdownForMatch; // Store as negative value representing % loss
          }
      } else { // Long strategy
          // For long, drawdown is when price moves DOWN from entry
          currentDrawdownForMatch = ((futureCandle.low - entryPrice) / entryPrice) * 100;
          if (currentDrawdownForMatch < maxDrawdown) {
              maxDrawdown = currentDrawdownForMatch;
          }
      }

      // Check if take-profit is hit based on strategy direction
      if (strategyDirection === 'short') {
          // For short: success if price drops by minPriceMove (or more)
          // minPriceMove is assumed to be a positive magnitude (e.g., 5 for 5% drop target)
          const currentPriceLowPercentageChange = ((futureCandle.low - entryPrice) / entryPrice) * 100;
          if (currentPriceLowPercentageChange <= -minPriceMove) { // Price dropped enough (e.g., -5% or less)
              gainAchieved = true;
              timeToPeak = futureCandle.time - entryCandle.time;
              peakPriceTime = futureCandle.time;
              finalPriceMoveRaw = Math.abs(currentPriceLowPercentageChange); // Use actual price movement, not target
              break; // Exit the loop as the trade is considered closed
          }
      } else { // Long strategy
          // For long: success if price rises by minPriceMove (or more)
          const currentPriceHighPercentageChange = ((futureCandle.high - entryPrice) / entryPrice) * 100;
          if (currentPriceHighPercentageChange >= minPriceMove) { // Price rose enough (e.g., 5% or more)
              gainAchieved = true;
              timeToPeak = futureCandle.time - entryCandle.time;
              peakPriceTime = futureCandle.time;
              finalPriceMoveRaw = currentPriceHighPercentageChange; // Use actual price movement, not target
              break; // Exit the loop as the trade is considered closed
          }
      }
    }

    // If take-profit was NOT hit, calculate outcome at the end of the time window
    if (!gainAchieved) {
        const finalCandle = historicalData[endIndex];
        if (finalCandle) {
            // Calculate raw P&L percentage for timed-out trades based on closing price
            finalPriceMoveRaw = ((finalCandle.close - entryPrice) / entryPrice) * 100;
        } else {
            finalPriceMoveRaw = 0; // Fallback if data is missing
        }
        // timeToPeak remains null for timed-out trades
    }

    // Apply strategy direction adjustment to the raw price move
    let finalPriceMove = finalPriceMoveRaw;
    if (strategyDirection === 'short') {
        // If it's a short, invert the raw P&L:
        // A positive finalPriceMoveRaw means price went UP (loss for short). So, make it negative.
        // A negative finalPriceMoveRaw means price went DOWN (gain for short). So, make it positive.
        finalPriceMove = -finalPriceMove;
    }

    // Apply realistic trading costs
    const TRADING_FEE_PERCENT = 0.1; // 0.1% per trade (Binance spot)
    const SLIPPAGE_PERCENT = 0.05; // 0.05% slippage
    const TOTAL_COST_PERCENT = (TRADING_FEE_PERCENT * 2) + SLIPPAGE_PERCENT; // 0.25% total cost
    finalPriceMove = finalPriceMove - TOTAL_COST_PERCENT;


    // FIXED: More realistic success determination
    // A trade is successful if:
    // 1. It hit the target AND the final P&L is positive after commission, OR
    // 2. It didn't hit target but still ended up profitable after commission
    const isActuallyProfitable = finalPriceMove > 0;
    const isSuccessful = gainAchieved && isActuallyProfitable;
    
    // Trade analysis (reduced logging)

    return {
      ...match, // This includes all original match properties including marketRegime
      coin: match.coin,
      timeframe: timeframe,
      time: entryCandle.time,
      price: entryPrice, // Renamed from 'entryPrice' to 'price'
      successful: isSuccessful, // True only if target was hit AND trade was profitable
      priceMove: finalPriceMove, // This is the realistic P&L after commission
      timeToPeak: timeToPeak,
      peakPriceTime: peakPriceTime,
      maxDrawdown: maxDrawdown,
      exitTime: timeToPeak
      // marketRegime is preserved from the original match via ...match spread
    };
  }).filter(match => match !== null);
};

// Helper function to classify signal type if not already present
const defaultClassifySignalType = (signal) => {
  if (!signal || !signal.type || (signal.value === undefined && signal.value === null)) { // Check for null/undefined value
    return false; // Default to state if we can't determine
  }

  const signalType = signal.type.toLowerCase();
  const signalValue = String(signal.value).toLowerCase(); // Ensure value is a string for .includes

  // Event-based signals (discrete triggers)
  const eventKeywords = [
    'cross', 'crossover', 'entry', 'exit', 'breakout', 'breakdown',
    'reversal', 'flip', 'squeeze', 'expansion', 'bounce', 'rejection',
    'bullish_cross', 'bearish_cross', 'oversold_entry', 'oversold_exit',
    'overbought_entry', 'overbought_exit', 'bullish_divergence',
    'bearish_divergence', 'pattern_complete', 'trend_change', 'signal_triggered'
  ];

  // Check if the signal value contains event keywords
  const isEventByValue = eventKeywords.some(keyword => signalValue.includes(keyword));

  // Candlestick patterns are always events
  if (signalType.includes('candlestick') || signalType.includes('cdl_')) {
    return true;
  }

  return isEventByValue;
};

// Keep the old function for backward compatibility
export const classifySignalType = defaultClassifySignalType;

/**
 * Classifies a strategy/combination as event-driven or state-based based on its signals
 * A strategy is event-driven if more than 50% of its signals are event-based
 * @param {Array} signals - Array of signal objects with optional isEvent property
 * @returns {boolean} True if strategy is event-driven, false if state-based
 */
export const classifyStrategyAsEventDriven = (signals) => {
  if (!signals || signals.length === 0) {
    return false; // Default to state-based if no signals
  }

  // Count event-based signals
  // Use isEvent property if available, otherwise classify the signal
  const eventSignalsCount = signals.filter(signal => {
    // If signal already has isEvent property, use it
    if (signal.isEvent !== undefined) {
      return signal.isEvent === true;
    }
    // Otherwise, classify it
    return classifySignalType(signal);
  }).length;

  // Strategy is event-driven if more than 50% of signals are event-based
  return eventSignalsCount > signals.length / 2;
};


const groupMatchesBySignals = (matches) => {
  const grouped = {};
  matches.forEach(match => {
    // Generate combination name from signals, similar to processMatches
    const combinationName = match.signals.map(s => s.value || s.type).sort().join(' + ');
    if (!grouped[combinationName]) {
      grouped[combinationName] = [];
    }
    grouped[combinationName].push(match);
  });
  return grouped;
};


export const processBacktestResults = (matches, onLog) => {
  if (!matches || matches.length === 0) {
    return {
      totalOccurrences: 0,
      profitableCombinations: [],
      unprofitableCombinations: [],
    };
  }

  // Calculate average loss per losing trade from ALL matches in the backtest
  // This provides a realistic baseline for zero-loss strategies using actual market data
  const allLosingTrades = matches.filter(m => !m.successful && m.priceMove < 0);
  const totalLossFromAllTrades = allLosingTrades.reduce((sum, m) => sum + Math.abs(m.priceMove), 0);
  const avgLossPerLosingTrade = allLosingTrades.length > 0 
    ? totalLossFromAllTrades / allLosingTrades.length 
    : 1.0; // Fallback to 1% if no losing trades exist (shouldn't happen in real backtest)
  
  console.log(`[PF_CALC] 📊 Using real data for zero-loss PF calculation:`);
  console.log(`[PF_CALC]   - Total losing trades in backtest: ${allLosingTrades.length}`);
  console.log(`[PF_CALC]   - Average loss per losing trade: ${avgLossPerLosingTrade.toFixed(2)}%`);
  console.log(`[PF_CALC]   - This will be used for zero-loss strategies instead of fixed value`);

  const grouped = groupMatchesBySignals(matches);

  const processedCombinations = Object.entries(grouped).map(([key, matchGroup]) => {
    const firstMatch = matchGroup[0];
    
    // ⚠️ IMPORTANT: Profit factor calculation uses ONLY matches that passed minCombinedStrength filter
    // 
    // Current behavior:
    // - BacktestingEngine filters matches by minCombinedStrength BEFORE adding to allMatches (line 205)
    // - Only filtered matches are passed to processMatches as rawMatches
    // - Profit factor is calculated using matchGroup, which only contains filtered matches
    //
    // To use ALL occurrences (including those below minCombinedStrength):
    // 1. Modify BacktestingEngine to collect ALL matches (not just filtered ones)
    // 2. Pass both filtered and unfiltered matches to processMatches
    // 3. Use unfiltered matches for profit factor calculation, filtered for display/filtering
    
    const successfulCount = matchGroup.filter(m => m.successful).length;
    const successRate = (successfulCount / matchGroup.length) * 100;
    const avgPriceMove = matchGroup.reduce((sum, m) => sum + m.priceMove, 0) / matchGroup.length;

    // Profit factor uses ALL matches in matchGroup (currently only filtered matches)
    const grossProfit = matchGroup.filter(m => m.successful).reduce((sum, m) => sum + m.priceMove, 0);
    const grossLoss = Math.abs(matchGroup.filter(m => !m.successful).reduce((sum, m) => sum + m.priceMove, 0));
    
    // FIXED: Use REAL data for profit factor calculation
    // For zero-loss strategies, use average loss from ALL losing trades in the backtest
    // This is more accurate than a fixed value and reflects actual market conditions
    let profitFactor;
    if (grossLoss > 0) {
      profitFactor = grossProfit / grossLoss; // Actual PF for strategies with losses
    } else if (grossProfit > 0) {
      // For zero-loss strategies, use average loss from all losing trades in the backtest
      // This provides a realistic baseline using actual market data
      const avgProfitPerTrade = grossProfit / matchGroup.length;
      // Calculate PF as if there was one loss trade with the average loss from the backtest
      // Formula: PF = grossProfit / (avgLossPerLosingTrade * number_of_trades)
      // This simulates what the PF would be if one trade had the average loss
      profitFactor = grossProfit / (avgLossPerLosingTrade * matchGroup.length);
      
      // Log when PF is very high (but don't cap it - show actual calculated value)
      if (profitFactor > 20.0) {
        console.log(`[PF_ZERO_LOSS] Strategy "${firstMatch.signals.map(s => s.type).join(' + ')}" | PF: ${profitFactor.toFixed(2)} | ${matchGroup.length} trades (all successful) | Avg profit: ${avgProfitPerTrade.toFixed(2)}% | Using avg loss: ${avgLossPerLosingTrade.toFixed(2)}% from ${allLosingTrades.length} losing trades`);
      }
    } else {
      profitFactor = 1.0;
    }
    

    // --- CORRECTED REGIME CALCULATION ---
    // This logic now correctly processes specific regimes without consolidation.
    const regimeCounts = matchGroup.reduce((acc, match) => {
      // Use the specific regime name (uptrend, downtrend, ranging) directly
      const regime = match.marketRegime || 'unknown';
      acc[regime] = (acc[regime] || 0) + 1;
      return acc;
    }, {});

    const dominantMarketRegime = Object.keys(regimeCounts).length > 0 ?
      Object.keys(regimeCounts).reduce((a, b) => (regimeCounts[a] > regimeCounts[b] ? a : b)) :
      'unknown';
    
    // DEBUG: Log regime calculation for each strategy
    // Regime debug logs removed to reduce console spam
    // --- END REGIME CALCULATION ---

    const estimatedExitTimeMinutes = calculateEstimatedExitTime(matchGroup);

    // Calculate median lowest low during backtest (historical support analysis)
    const drawdownPercentages = matchGroup
      .filter(match => typeof match.maxDrawdown === 'number' && !isNaN(match.maxDrawdown))
      .map(match => Math.abs(match.maxDrawdown));
    
    const medianLowestLowDuringBacktest = drawdownPercentages.length > 0 ? calculateMedian(drawdownPercentages) : null;
    
    // NEW: Calculate max drawdown (maximum drawdown across all occurrences)
    const maxDrawdownPercent = drawdownPercentages.length > 0 ? Math.max(...drawdownPercentages) : null;
    
    // NEW: Calculate median drawdown
    const medianDrawdownPercent = drawdownPercentages.length > 0 ? calculateMedian(drawdownPercentages) : null;
    
    // NEW: Calculate win/loss analysis
    const successfulMatches = matchGroup.filter(m => m.successful);
    const failedMatches = matchGroup.filter(m => !m.successful);
    const avgWinPercent = successfulMatches.length > 0 
      ? successfulMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / successfulMatches.length 
      : null;
    const avgLossPercent = failedMatches.length > 0 
      ? Math.abs(failedMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / failedMatches.length)
      : null;
    const winLossRatio = avgLossPercent > 0 && avgWinPercent > 0 ? avgWinPercent / avgLossPercent : null;
    
    // NEW: Calculate timing statistics
    const exitTimes = matchGroup
      .filter(m => m.exitTime && typeof m.exitTime === 'number' && m.exitTime > 0)
      .map(m => m.exitTime / (60 * 1000)); // Convert to minutes
    
    const medianExitTimeMinutes = exitTimes.length > 0 ? calculateMedian(exitTimes) : null;
    
    // Calculate exit time variance (standard deviation)
    let exitTimeVarianceMinutes = null;
    if (exitTimes.length > 1) {
      const avgExitTime = exitTimes.reduce((sum, t) => sum + t, 0) / exitTimes.length;
      const variance = exitTimes.reduce((sum, t) => sum + Math.pow(t - avgExitTime, 2), 0) / exitTimes.length;
      exitTimeVarianceMinutes = Math.sqrt(variance);
    }
    
    // NEW: Calculate time to peak statistics
    const timeToPeakValues = matchGroup
      .filter(m => m.timeToPeak && typeof m.timeToPeak === 'number' && m.timeToPeak > 0)
      .map(m => m.timeToPeak / (60 * 1000)); // Convert to minutes
    
    const avgTimeToPeakMinutes = timeToPeakValues.length > 0 
      ? timeToPeakValues.reduce((sum, t) => sum + t, 0) / timeToPeakValues.length 
      : null;
    
    // NEW: Calculate consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentStreak = 0;
    let currentType = null;
    
    // Sort matches by time to analyze streaks chronologically
    const sortedMatches = [...matchGroup].sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
    
    for (const match of sortedMatches) {
      const isWin = match.successful;
      if (currentType === null) {
        currentType = isWin ? 'win' : 'loss';
        currentStreak = 1;
      } else if ((currentType === 'win' && isWin) || (currentType === 'loss' && !isWin)) {
        currentStreak++;
      } else {
        // Streak broken, update max
        if (currentType === 'win') {
          maxConsecutiveWins = Math.max(maxConsecutiveWins, currentStreak);
        } else {
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
        }
        currentType = isWin ? 'win' : 'loss';
        currentStreak = 1;
      }
    }
    
    // Final streak check
    if (currentType === 'win') {
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentStreak);
    } else {
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
    }
    
    // NEW: Calculate average trades between wins
    let avgTradesBetweenWins = null;
    if (successfulMatches.length > 0 && matchGroup.length > successfulMatches.length) {
      const winIndices = sortedMatches
        .map((m, idx) => m.successful ? idx : -1)
        .filter(idx => idx >= 0);
      
      if (winIndices.length > 1) {
        const gaps = [];
        for (let i = 1; i < winIndices.length; i++) {
          gaps.push(winIndices[i] - winIndices[i - 1] - 1);
        }
        avgTradesBetweenWins = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
      }
    }
    
    // NEW: Build regime performance object (detailed metrics per regime)
    const regimePerformance = {};
    Object.keys(regimeCounts).forEach(regime => {
      const regimeMatches = matchGroup.filter(m => (m.marketRegime || 'unknown') === regime);
      const regimeSuccessful = regimeMatches.filter(m => m.successful);
      const regimeGrossProfit = regimeSuccessful.reduce((sum, m) => sum + (m.priceMove || 0), 0);
      const regimeGrossLoss = Math.abs(regimeMatches.filter(m => !m.successful).reduce((sum, m) => sum + (m.priceMove || 0), 0));
      const regimePF = regimeGrossLoss > 0 ? Math.min(regimeGrossProfit / regimeGrossLoss, 20.0) : 
        (regimeGrossProfit > 0 ? Math.min(regimeGrossProfit / 0.5, 20.0) : 1.0);
      
      regimePerformance[regime] = {
        success_rate: regimeMatches.length > 0 ? (regimeSuccessful.length / regimeMatches.length) * 100 : 0,
        occurrences: regimeMatches.length,
        avg_price_move: regimeMatches.length > 0 ? regimeMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / regimeMatches.length : 0,
        profit_factor: regimePF,
        gross_profit: regimeGrossProfit,
        gross_loss: regimeGrossLoss
      };
    });

    // Calculate average combined strength across all matches (not just first match)
    // This represents the typical strength of this strategy
    const avgCombinedStrength = matchGroup.length > 0
      ? matchGroup.reduce((sum, m) => sum + (m.combinedStrength || 0), 0) / matchGroup.length
      : (firstMatch.combinedStrength || 0);
    
    // DEBUG: Log if combinedStrength seems incorrect (should be >= minCombinedStrength if filter was applied)
    if (matchGroup.length > 0 && avgCombinedStrength < 600) {
      const firstMatchStrength = firstMatch.combinedStrength || 0;
      const minStrength = Math.min(...matchGroup.map(m => m.combinedStrength || 0));
      const maxStrength = Math.max(...matchGroup.map(m => m.combinedStrength || 0));
      console.warn(`[processBacktestResults] ⚠️ Low combinedStrength detected:`, {
        avgCombinedStrength: avgCombinedStrength.toFixed(2),
        firstMatchStrength: firstMatchStrength.toFixed(2),
        minStrength: minStrength.toFixed(2),
        maxStrength: maxStrength.toFixed(2),
        matchCount: matchGroup.length,
        combinationName: firstMatch.signals?.map(s => s.type).join(' + ') || 'unknown',
        note: 'If minCombinedStrength filter was 600, all matches should have strength >= 600'
      });
    }
    
    // Calculate exit reason breakdown from backtest matches
    // Use default TP/SL percentages if not available in config
    const takeProfitPercentage = config?.takeProfitPercentage || 5.0;
    const stopLossPercentage = config?.stopLossPercentage || 2.0;
    
    const backtestExitReasonBreakdown = calculateBacktestExitReasonBreakdown(
      matchGroup,
      takeProfitPercentage,
      stopLossPercentage
    );
    
    return {
      key,
      coin: firstMatch.coin, // Preserve the coin information from the first match
      signals: firstMatch.signals,
      signalCount: firstMatch.signals.length,
      combinedStrength: avgCombinedStrength, // Use average, not first match's strength
      occurrences: matchGroup.length,
      occurrenceDates: matchGroup.map(m => ({
        date: m.time, // Changed from m.date to m.time as per calculateMatchOutcomes output
        price: m.price,
        priceMove: m.priceMove,
        successful: m.successful,
        exitTime: m.exitTime,
        marketRegime: m.marketRegime,
      })),
      successRate,
      avgPriceMove,
      profitFactor,
      grossProfit, // NEW: Total gross profit
      grossLoss, // NEW: Total gross loss
      dominantMarketRegime, // This is now correctly 'uptrend', 'downtrend', or 'ranging'
      marketRegimeDistribution: regimeCounts, // This will also contain specific counts
      regimePerformance, // NEW: Detailed regime performance metrics
      estimatedExitTimeMinutes,
      medianLowestLowDuringBacktest, // Add historical support analysis
      // NEW: Additional analytics fields
      maxDrawdownPercent,
      medianDrawdownPercent,
      avgWinPercent,
      avgLossPercent,
      winLossRatio,
      medianExitTimeMinutes,
      exitTimeVarianceMinutes,
      avgTimeToPeakMinutes,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      avgTradesBetweenWins,
      // NEW: Exit reason breakdown
      backtestExitReasonBreakdown
    };
  });

  const profitableCombinations = processedCombinations.filter(c => c.successRate >= 50 && c.occurrences > 1).sort((a, b) => b.profitFactor - a.profitFactor);
  const unprofitableCombinations = processedCombinations.filter(c => c.successRate < 50 || c.occurrences <= 1);

  // INVESTIGATION: Summary of high-performing strategies with calculation validation
  const highPFStrategies = profitableCombinations.filter(c => c.profitFactor >= 15.0);
  const perfectSuccessStrategies = profitableCombinations.filter(c => c.successRate >= 100.0);
  const zeroLossStrategies = profitableCombinations.filter(c => c.grossLoss === 0);
  

  return {
    totalOccurrences: matches.length,
    profitableCombinations,
    unprofitableCombinations,
  };
};

function calculateEstimatedExitTime(matches) {
  // This function's implementation was not provided in the outline.
  // Returning 0 as a placeholder for now.
  // In a real scenario, this would involve calculating the average or median timeToPeak/exitTime
  // from the successful matches, converting it to minutes.
  if (!matches || matches.length === 0) return 0;

  const successfulExitTimes = matches
    .filter(m => m.successful && typeof m.exitTime === 'number' && m.exitTime > 0)
    .map(m => m.exitTime);

  if (successfulExitTimes.length === 0) return 0;

  // Calculate average exit time in milliseconds, then convert to minutes
  const sumExitTimes = successfulExitTimes.reduce((sum, time) => sum + time, 0);
  const averageExitTimeMs = sumExitTimes / successfulExitTimes.length;

  return averageExitTimeMs / (60 * 1000); // Convert milliseconds to minutes
}
