
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


export const processMatches = (rawMatches, config, classifySignalType, historicalData = null) => {
  const combinations = new Map();
  const { minOccurrences = 2, timeWindow = '4h', timeframe = '4h' } = config;

  // Calculate time window in candles for swing low identification (Note: This is no longer used for median drawdown directly)
  const timeWindowMinutes = getTimeframeInMinutes(timeWindow);
  const candleDurationMinutes = getTimeframeInMinutes(timeframe);
  const timeWindowInCandles = candleDurationMinutes > 0 ? Math.floor(timeWindowMinutes / candleDurationMinutes) : 20; // Default to 20 candles if calculation fails

  rawMatches.forEach(match => {
    // Generate combination name from signals
    const combinationName = match.signals.map(s => s.value || s.type).sort().join(' + ');

    if (!combinations.has(combinationName)) {
      // Initialize new combination entry
      combinations.set(combinationName, {
        signals: match.signals.map(s => ({
          ...s,
          isEvent: classifySignalType(s)
        })),
        matches: [],
        combinedStrength: 0,
        marketRegimePerformance: {
          uptrend: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          downtrend: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          ranging: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 },
          unknown: { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 }
        }
      });
    }

    const combination = combinations.get(combinationName);

    // Store the full match object
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

  for (const [regimeAwareCombinationName, comboData] of combinations.entries()) {
    const combinationName = regimeAwareCombinationName;

    if (comboData.matches.length < minOccurrences) {
      continue; // Skip combinations that don't meet minOccurrences
    }

    // --- Dominant Regime Filtering Logic ---
    const regimePerf = comboData.marketRegimePerformance;
    let dominantRegime = 'unknown';
    let dominantRegimeOccurrences = 0;

    // Find the dominant regime by occurrence count
    for (const regime in regimePerf) {
      if (regimePerf[regime].occurrences > dominantRegimeOccurrences) {
        dominantRegimeOccurrences = regimePerf[regime].occurrences;
        dominantRegime = regime;
      }
    }

    // Apply the filter: The dominant regime's occurrences must meet the minimum threshold.
    if (dominantRegimeOccurrences < minOccurrences) {
      // Log for debugging to understand why a strategy was skipped.
      //console.log(
        //`[DOMINANT_REGIME_FILTER] Skipping "${combinationName}". ` +
        //`Dominant regime ('${dominantRegime}') has only ${dominantRegimeOccurrences} occurrences, ` +
        //`which is less than the required minOccurrences of ${minOccurrences}. ` +
        //`(Total occurrences: ${comboData.matches.length})`
      //);
      continue; // Skip this combination as it's not robust enough in its primary regime.
    }
    // --- End of New Filtering Logic ---

    // --- Calculate Overall Stats for the Combination (derived from comboData.matches) ---
    const totalOccurrences = comboData.matches.length;
    // CRITICAL FIX: Restore the performance calculation to define successfulCount, etc.
    const { successfulMatches, failedMatches, totalGrossProfit, totalGrossLoss, successfulCount, failCount } = calculatePerformance(comboData.matches);

    const successRate = totalOccurrences > 0 ? (successfulCount / totalOccurrences) * 100 : 0;
    const netAveragePriceMove = totalOccurrences > 0 ? comboData.matches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / totalOccurrences : 0;
    const averageCombinedStrength = totalOccurrences > 0 ? comboData.combinedStrength / totalOccurrences : 0;

    const grossProfit = totalGrossProfit;
    const grossLoss = totalGrossLoss;

    // Robust profit factor calculation to handle no-loss scenarios gracefully
    let profitFactor;
    if (grossLoss === 0) {
      // Use successfulCount which is now correctly defined
      profitFactor = (grossProfit > 0 && successfulCount === totalOccurrences) ? 999.99 : 1.0;
    } else {
      profitFactor = Math.min(grossProfit / grossLoss, 999.99); // Calculate and cap
    }

    // Use successfulCount which is now correctly defined
    const averageGainOnSuccess = successfulCount > 0 ? successfulMatches.reduce((sum, m) => sum + (m.priceMove || 0), 0) / successfulCount : 0;
    const winLossRatio = failCount > 0 ? successfulCount / failCount : successfulCount;

    // Calculate overall max drawdown (the lowest of all individual match drawdowns)
    const overallMaxDrawdown = comboData.matches.reduce((min, m) => Math.min(min, m.maxDrawdown || 0), 0);

    // --- FIXED: Calculate Median Drawdown Percentage Correctly ---
    const drawdownPercentages = [];
    comboData.matches.forEach(matchData => {
        // matchData.maxDrawdown is already the deepest percentage drawdown (negative value)
        // We want a positive percentage representing the magnitude of the drawdown.
        if (typeof matchData.maxDrawdown === 'number' && !isNaN(matchData.maxDrawdown)) {
            drawdownPercentages.push(Math.abs(matchData.maxDrawdown));
        }
    });

    const medianHistoricalDrawdownPercent = drawdownPercentages.length > 0 ? calculateMedian(drawdownPercentages) : null;
    
    // --- ENHANCED LOGGING ---
    if (regimeAwareCombinationName.includes("Fierce Avalanche of ETHUSDT-MACDEM")) {
        console.log(`[MEDIAN_DEBUG] Strategy: ${regimeAwareCombinationName}`);
        console.log(`[MEDIAN_DEBUG] All individual drawdown % values:`, drawdownPercentages);
        console.log(`[MEDIAN_DEBUG] Calculated median drawdown %:`, medianHistoricalDrawdownPercent);
    }
    // --- End of Modification ---

    // Calculate timing statistics
    const timeToPeakValues = comboData.matches
      .filter(m => typeof m.timeToPeak === 'number' && m.timeToPeak > 0)
      .map(m => m.timeToPeak)
      .sort((a, b) => a - b);

    const successfulTimeToPeakValues = successfulMatches
      .filter(m => typeof m.timeToPeak === 'number' && m.timeToPeak > 0)
      .map(m => m.timeToPeak)
      .sort((a, b) => a - b);

    // Calculate percentiles for time to peak
    const calculatePercentile = (sortedArray, percentile) => {
      if (sortedArray.length === 0) return 0;
      const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
      return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
    };

    const timeToPeak50thPercentile = calculatePercentile(timeToPeakValues, 50);
    const timeToPeak75thPercentile = calculatePercentile(timeToPeakValues, 75);
    const timeToPeak80thPercentile = calculatePercentile(timeToPeakValues, 80);
    const timeToPeak85thPercentile = calculatePercentile(timeToPeakValues, 85);
    const timeToPeak95thPercentile = calculatePercentile(timeToPeakValues, 95);

    // Calculate average time to peak for all matches and successful matches only
    const avgTimeToPeak = timeToPeakValues.length > 0 ?
      timeToPeakValues.reduce((sum, val) => sum + val, 0) / timeToPeakValues.length : 0;

    const avgSuccessfulTimeToPeak = successfulTimeToPeakValues.length > 0 ?
      successfulTimeToPeakValues.reduce((sum, val) => sum + val, 0) / successfulTimeToPeakValues.length : 0;

    // Convert to minutes for avgWinDurationMinutes
    const avgWinDurationMinutes = avgSuccessfulTimeToPeak > 0 ? avgSuccessfulTimeToPeak / (60 * 1000) : 0;


    // Collect gains, losses, maxDrawdowns for distributions
    const gains = successfulMatches.map(m => m.priceMove);
    const losses = failedMatches.map(m => m.priceMove);
    const maxDrawdowns = comboData.matches.filter(m => typeof m.maxDrawdown === 'number').map(m => m.maxDrawdown);

    // Calculate dominant market regime and distribution for this combination
    const marketRegimesForDominant = comboData.matches.map(m => m.marketRegime);
    const regimeAnalysis = calculateDominantRegime(marketRegimesForDominant);

    const profitabilityScore = successRate * 0.4 + Math.min(netAveragePriceMove * 10, 100) * 0.3 + Math.min(profitFactor * 10, 100) * 0.3;

    // Calculate average individual signal strengths (retained from original logic)
    let averageSignalStrengths = [];
    if (comboData.matches.length > 0) {
      const signalStrengthSums = new Map();
      const signalCounts = new Map();

      comboData.matches.forEach(match => {
        if (match.signals && Array.isArray(match.signals)) {
          match.signals.forEach(s => {
            const key = s.type;
            signalStrengthSums.set(key, (signalStrengthSums.get(key) || 0) + (s.strength || 0));
            signalCounts.set(key, (signalCounts.get(key) || 0) + 1);
          });
        }
      });

      // Use the initial signals for this combination to ensure all signal types are represented
      averageSignalStrengths = comboData.signals.map(originalSignal => {
        const avgStrength = signalStrengthSums.has(originalSignal.type) ?
          signalStrengthSums.get(originalSignal.type) / signalCounts.get(originalSignal.type) : 0;
        return {
          ...originalSignal,
          averageStrength: Math.round(avgStrength * 100) / 100 // Round to 2 decimal places
        };
      });
    } else {
      averageSignalStrengths = comboData.signals.map(signal => ({
        ...signal,
        averageStrength: 0
      }));
    }

    // Directly pass the raw, un-averaged regime data. Averages will be calculated in the UI.
    const finalRegimePerformance = {};
    for (const regimeName in comboData.marketRegimePerformance) {
      const data = comboData.marketRegimePerformance[regimeName];
      if (data.occurrences > 0) {
        finalRegimePerformance[regimeName] = {
          occurrences: data.occurrences,
          successful: data.successful,
          grossProfit: data.grossProfit,
          grossLoss: data.grossLoss,
        };
      }
    }

    processedCombinations.push({
      combinationName: regimeAwareCombinationName,
      signals: averageSignalStrengths, // Use the calculated average individual strengths
      signalCount: comboData.signals.length,
      coin: comboData.matches[0]?.coin, // Take from first match
      timeframe: comboData.matches[0]?.timeframe, // Take from first match
      occurrences: totalOccurrences,
      successCount: successfulCount,
      failCount: failCount,
      successRate,
      netAveragePriceMove,
      combinedStrength: averageCombinedStrength, // Kept existing variable name
      averageGainOnSuccess,
      winLossRatio,
      maxDrawdown: Math.abs(overallMaxDrawdown), // Return as positive value
      profitFactor, // Now uses the improved calculation
      avgWinDurationMinutes, // Add timing data
      avgTimeToPeak, // Add timing data
      timeToPeak50thPercentile, // Add timing data
      timeToPeak75thPercentile, // Add timing data
      timeToPeak80thPercentile, // Add timing data
      timeToPeak85thPercentile, // Add timing data
      timeToPeak95thPercentile, // Add timing data
      profitabilityScore,
      // Pass a limited set of matches to avoid excessive memory usage in final output
      matches: comboData.matches.slice(0, 100), // Keep matches limited
      dominantMarketRegime: regimeAnalysis?.dominantRegime || null, // This will be uptrend/downtrend/ranging
      marketRegimeDistribution: regimeAnalysis?.distribution || null,
      gains: gains,
      losses: losses,
      timeToPeakValues: timeToPeakValues.slice(0, 50), // Limit to save memory
      maxDrawdowns: maxDrawdowns,
      // Add regime-specific statistics (changed name from statsByRegime)
      marketRegimePerformance: finalRegimePerformance, // Changed property name and value as per outline
      // MODIFIED: Save the new percentage value to the existing field
      medianLowestLowDuringBacktest: medianHistoricalDrawdownPercent,
      recommendedTradingStrategy: `Based on ${totalOccurrences} occurrences with a ${successRate.toFixed(1)}% success rate, this strategy seems viable.`,
    });
  }

  // Sort by profitability score for better ranking
  processedCombinations.sort((a, b) => (b.profitabilityScore || 0) - (a.profitabilityScore || 0));

  // DEBUG: Add a single, controlled log for the top strategy to verify calculation
  if (processedCombinations.length > 0) {
    const topStrategy = processedCombinations[0];
    //console.log(
      //`[PROCESSOR_DEBUG] Top Strategy: "${topStrategy.combinationName}" | Occurrences: ${topStrategy.occurrences} | Success: ${topStrategy.successRate.toFixed(1)}% | Median Drawdown: ${topStrategy.medianLowestLowDuringBacktest ? topStrategy.medianLowestLowDuringBacktest.toFixed(2) + '%' : 'N/A'}`
    //);
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
  const statsMap = new Map(processedCombos.map(c => [c.combinationName, c]));
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

  for (const group of matchesByTime.values()) {
    processedGroups++;

    if (group.length === 1) {
      bestMatches.push(group[0]);
      continue;
    }

    group.sort((a, b) => {
      const statsA = statsMap.get(a.combinationName);
      const statsB = statsMap.get(b.combinationName);

      if (!statsA || !statsB) return 0;

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

    bestMatches.push(group[0]);
  }

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
              finalPriceMoveRaw = minPriceMove; // A 5% drop for a short is a 5% gain
              break; // Exit the loop as the trade is considered closed
          }
      } else { // Long strategy
          // For long: success if price rises by minPriceMove (or more)
          const currentPriceHighPercentageChange = ((futureCandle.high - entryPrice) / entryPrice) * 100;
          if (currentPriceHighPercentageChange >= minPriceMove) { // Price rose enough (e.g., 5% or more)
              gainAchieved = true;
              timeToPeak = futureCandle.time - entryCandle.time;
              peakPriceTime = futureCandle.time;
              finalPriceMoveRaw = minPriceMove;
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

    // Apply trading commission (0.1% per leg = 0.2% total for round trip)
    const COMMISSION_IMPACT = 0.2; // 0.2% total round-trip commission
    finalPriceMove = finalPriceMove - COMMISSION_IMPACT;


    return {
      ...match, // This includes all original match properties including marketRegime
      coin: match.coin,
      timeframe: timeframe,
      time: entryCandle.time,
      price: entryPrice, // Renamed from 'entryPrice' to 'price'
      successful: gainAchieved, // True ONLY if target was hit
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

  const grouped = groupMatchesBySignals(matches);

  const processedCombinations = Object.entries(grouped).map(([key, matchGroup]) => {
    const firstMatch = matchGroup[0];
    const successfulCount = matchGroup.filter(m => m.successful).length;
    const successRate = (successfulCount / matchGroup.length) * 100;
    const avgPriceMove = matchGroup.reduce((sum, m) => sum + m.priceMove, 0) / matchGroup.length;

    const grossProfit = matchGroup.filter(m => m.successful).reduce((sum, m) => sum + m.priceMove, 0);
    const grossLoss = Math.abs(matchGroup.filter(m => !m.successful).reduce((sum, m) => sum + m.priceMove, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 1);

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
    // --- END REGIME CALCULATION ---

    const estimatedExitTimeMinutes = calculateEstimatedExitTime(matchGroup);

    return {
      key,
      signals: firstMatch.signals,
      signalCount: firstMatch.signals.length,
      combinedStrength: firstMatch.combinedStrength,
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
      dominantMarketRegime, // This is now correctly 'uptrend', 'downtrend', or 'ranging'
      marketRegimeDistribution: regimeCounts, // This will also contain specific counts
      estimatedExitTimeMinutes,
    };
  });

  const profitableCombinations = processedCombinations.filter(c => c.successRate >= 50 && c.occurrences > 1).sort((a, b) => b.profitFactor - a.profitFactor);
  const unprofitableCombinations = processedCombinations.filter(c => c.successRate < 50 || c.occurrences <= 1);

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
