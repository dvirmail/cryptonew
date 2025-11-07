/**
 * UNIFIED ATR FUNCTION - Single robust implementation for all subscribers
 * 
 * This function consolidates all ATR calculation logic from:
 * - indicatorManager.jsx (main implementation with debugging)
 * - helpers.jsx (consolidated implementation)
 * - volatilityIndicators.jsx (volatility-focused implementation)
 * 
 * Features:
 * - Universal data format support (array and object klines)
 * - Robust data validation and corruption filtering
 * - Wilder's smoothing method for consistency
 * - Optional debugging and logging
 * - Performance optimized for large datasets
 * - Graceful error handling
 */

/**
 * Calculates Average True Range (ATR) using Wilder's smoothing method
 * @param {Array} klineData - Array of kline data (array or object format)
 * @param {number} period - ATR calculation period (default: 14)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.debug - Enable debug logging (default: false)
 * @param {boolean} options.validateData - Enable data validation (default: true)
 * @returns {Array<number|null>} Array of ATR values, padded with nulls for insufficient data
 */
export const calculateATR = (klineData, period = 14, options = {}) => {
  const { debug = false, validateData = true } = options;
  
  // Enhanced logging for investigation
  const inputLength = klineData ? klineData.length : 0;
  if (debug || inputLength > 200) { // Log if debug enabled or large dataset (likely scanner scenario)
    /*console.log(`[ATR_CALC_INVESTIGATION] Starting ATR calculation:`, {
      klineDataLength: inputLength,
      period: period,
      debug: debug,
      validateData: validateData,
      expectedATRLength: inputLength >= period ? (inputLength - period + 1) : 0
    });*/
  }
  
  // Input validation
  if (!klineData || klineData.length < period) {
    return Array(klineData ? klineData.length : 0).fill(null);
  }


  const trueRanges = [];
  let maxReasonablePrice = 0;
  
  // First pass: find reasonable price range for data validation
  for (let i = 0; i < klineData.length; i++) {
    const high = parseFloat(Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high);
    const low = parseFloat(Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low);
    
    if (!isNaN(high) && !isNaN(low) && high > 0 && low > 0) {
      maxReasonablePrice = Math.max(maxReasonablePrice, high);
    }
  }
  
  
  // Set validation thresholds - More lenient for crypto volatility
  const priceThreshold = maxReasonablePrice * 10;
  const maxReasonableGap = maxReasonablePrice * 0.5; // Max 50% gap (more lenient for crypto)
  const maxReasonableTrueRange = maxReasonablePrice * 1.0; // Max 100% of highest price (much more lenient)

  // Calculate True Ranges with validation
  for (let i = 0; i < klineData.length; i++) {
    // Universal data access for both array and object formats
    const high = parseFloat(Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high);
    const low = parseFloat(Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low);
    const previousClose = i > 0 ? parseFloat(Array.isArray(klineData[i - 1]) ? klineData[i - 1][4] : klineData[i - 1].close) : null;


    // Check for NaN values which would break the calculation
    if (isNaN(high) || isNaN(low) || (i > 0 && previousClose !== null && isNaN(previousClose))) {
      trueRanges.push(0);
      continue;
    }

    // Data validation (if enabled)
    if (validateData) {
      // Filter out corrupted price data
      if (high > priceThreshold || low > priceThreshold || high <= 0 || low <= 0) {
        trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
        continue;
      }

      // Check for extreme price gaps
      if (previousClose !== null) {
        const priceGapUp = Math.abs(high - previousClose);
        const priceGapDown = Math.abs(low - previousClose);
        
        if (priceGapUp > maxReasonableGap || priceGapDown > maxReasonableGap) {
          trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
          continue;
        }
      }
    }

    // Calculate True Range components
    const tr1 = high - low;
    const tr2 = previousClose !== null ? Math.abs(high - previousClose) : 0;
    const tr3 = previousClose !== null ? Math.abs(low - previousClose) : 0;

    const trueRange = Math.max(tr1, tr2, tr3);
    
    
    // Additional validation for extreme True Range values
    if (validateData && trueRange > maxReasonableTrueRange) {
      if (debug) {
        console.warn(`[ATR_UNIFIED] ⚠️ EXTREME True Range detected at candle ${i}:`, {
          trueRange: trueRange,
          high: high,
          low: low,
          previousClose: previousClose,
          tr1: tr1,
          tr2: tr2,
          tr3: tr3,
          candle: klineData[i],
          impact: "This indicates potentially corrupted price data - ATR will not be capped"
        });
      }
      trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
      continue;
    }
    
    trueRanges.push(trueRange);
  }

  // Enhanced logging after trueRanges calculation
  if (debug || inputLength > 200) {
    /*console.log(`[ATR_CALC_INVESTIGATION] True Ranges calculated:`, {
      trueRangesLength: trueRanges.length,
      klineDataLength: klineData.length,
      match: trueRanges.length === klineData.length,
      difference: klineData.length - trueRanges.length,
      period: period,
      expectedATRCount: trueRanges.length >= period ? (trueRanges.length - period + 1) : 0
    });*/
  }

  const atrValues = [];
  if (trueRanges.length < period) {
    return Array(klineData.length).fill(null);
  }

  // Calculate initial ATR (Simple Moving Average of first 'period' True Ranges)
  let sumFirstTR = 0;
  for (let i = 0; i < period; i++) {
    sumFirstTR += trueRanges[i];
  }
  const firstATR = sumFirstTR / period;
  atrValues.push(firstATR);

  if (debug || inputLength > 200) {
    /*console.log(`[ATR_CALC_INVESTIGATION] First ATR calculated:`, {
      firstATR: firstATR,
      atrValuesLength: atrValues.length,
      correspondsToKlineIndex: period - 1, // First ATR corresponds to kline index period-1
      remainingIterations: trueRanges.length - period
    });*/
  }

  // Calculate subsequent ATR values using Wilder's smoothing method
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = atrValues[atrValues.length - 1];
    const currentTR = trueRanges[i];
    const currentATR = (prevATR * (period - 1) + currentTR) / period;
    
    // Additional validation: Cap ATR at a reasonable percentage of current price
    // This prevents ATR from becoming unrealistically high due to data issues
    const currentPrice = parseFloat(Array.isArray(klineData[i]) ? klineData[i][4] : klineData[i].close);
    const maxReasonableATR = currentPrice * 0.1; // Cap ATR at 10% of current price
    const finalATR = Math.min(currentATR, maxReasonableATR);
    
    atrValues.push(finalATR);

    // Debug logging for extreme ATR values (only if they were actually extreme before capping)
    // Use relative threshold: ATR > 5% of current price is considered extreme
    const extremeThreshold = currentPrice * 0.05; // 5% of current price
    if (debug && currentATR > extremeThreshold) {
      console.warn(`[ATR_UNIFIED] ⚠️ EXTREME ATR calculated at position ${i}:`, {
        originalATR: currentATR,
        cappedATR: finalATR,
        prevATR: prevATR,
        currentTR: currentTR,
        trueRange: trueRanges[i],
        period: period,
        currentPrice: currentPrice,
        maxReasonableATR: maxReasonableATR,
        calculation: `(${prevATR} * ${period - 1} + ${currentTR}) / ${period} = ${currentATR}`,
        currentATRChange: currentATR - prevATR,
        currentATRChangePercent: ((currentATR - prevATR) / prevATR * 100).toFixed(2) + '%',
        wasCapped: currentATR > maxReasonableATR,
        extremeThreshold: extremeThreshold,
        atrAsPercentOfPrice: ((currentATR / currentPrice) * 100).toFixed(2) + '%'
      });
    }

    
  }

  // Enhanced logging before return
  if (debug || inputLength > 200) {
    const finalATR = atrValues[atrValues.length - 1];
    const lastKlineIndex = trueRanges.length - 1; // Last kline index
    const lastAtrIndex = atrValues.length - 1; // Last ATR index in array
    
    /*console.log(`[ATR_CALC_INVESTIGATION] ATR calculation complete:`, {
      klineDataLength: klineData.length,
      trueRangesLength: trueRanges.length,
      atrValuesLength: atrValues.length,
      period: period,
      lastKlineIndex: lastKlineIndex,
      lastAtrIndex: lastAtrIndex,
      mappingNote: `atrValues[${lastAtrIndex}] corresponds to kline[${lastKlineIndex}]`,
      evaluationIndexIfUsing: `klines.length - 2 = ${klineData.length - 2}`,
      willAccessIndex: klineData.length - 2,
      willHaveATR: (klineData.length - 2) >= (period - 1) && (klineData.length - 2) <= lastKlineIndex,
      actualAtrIndexForEvaluation: (klineData.length - 2) >= (period - 1) ? ((klineData.length - 2) - (period - 1)) : -1,
      gap: (klineData.length - 2) - lastKlineIndex,
      finalATR: finalATR
    });*/
    
    // Show sample mapping
    if (atrValues.length > 0) {
      const sampleIndices = [
        { atrIndex: 0, klineIndex: period - 1 },
        { atrIndex: Math.floor(atrValues.length / 2), klineIndex: period - 1 + Math.floor(atrValues.length / 2) },
        { atrIndex: lastAtrIndex, klineIndex: lastKlineIndex }
      ];
      /*console.log(`[ATR_CALC_INVESTIGATION] Sample index mapping:`, sampleIndices.map(m => 
        `atrValues[${m.atrIndex}] ↔ kline[${m.klineIndex}]`
      ).join(', '));*/
    }
  }

  const finalATR = atrValues[atrValues.length - 1];

  // CRITICAL FIX: Pad the array to match klineData length
  // ATR values start at index (period - 1) in the kline data
  // We need to pad with nulls at the beginning to align indices
  const paddedATR = new Array(klineData.length).fill(null);
  for (let i = 0; i < atrValues.length; i++) {
    const klineIndex = (period - 1) + i;
    if (klineIndex < klineData.length) {
      paddedATR[klineIndex] = atrValues[i];
    }
  }

  return paddedATR;
};

/**
 * Legacy wrapper for backward compatibility
 * Maintains the same interface as the original functions
 */
export const calculateATRLegacy = (klineData, period = 14) => {
  return calculateATR(klineData, period, { debug: false, validateData: true });
};

/**
 * Debug-enabled wrapper for troubleshooting
 */
export const calculateATRDebug = (klineData, period = 14) => {
  return calculateATR(klineData, period, { debug: true, validateData: true });
};

/**
 * Fast wrapper for performance-critical calculations
 */
export const calculateATRFast = (klineData, period = 14) => {
  return calculateATR(klineData, period, { debug: false, validateData: false });
};
