
/**
 * Volume-based technical indicators
 */
import { calculateMA } from './helpers';

export const calculateVolumeMA = (klineData, period = 20) => {
  // DEBUG: Log input for Volume MA calculation
  // console.log(`[VOL_MA_CALC] Calculating Volume MA for period ${period} with ${klineData.length} data points.`);
  if (!klineData || klineData.length < period) {
    // console.log(`[VOL_MA_CALC] Not enough data for period ${period}.`);
    // The outline specified returning an array of nulls, even if original returned empty array.
    return new Array(klineData ? klineData.length : 0).fill(null);
  }
  
  const results = [];
  
  for (let i = 0; i < klineData.length; i++) {
    if (i < period - 1) {
      results.push(null);
      continue;
    }
    
    const slice = klineData.slice(i - period + 1, i + 1);
    const volumes = slice.map(k => k.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / period;
    results.push(avgVolume);
  }
  
  // DEBUG: Log output
  // console.log(`[VOL_MA_CALC]   • Last 5 Volume MA values for period ${period}:`, results.slice(-5).map(v => v ? v.toFixed(4) : null));
  return results;
};

/**
 * Calculates the Rate of Change (ROC) for volume data.
 * @param {Array<object>} data - Array of kline data, each object having a 'volume' property.
 * @param {number} period - The number of periods to look back.
 * @returns {Array<number|null>} An array of ROC values, or null for initial periods.
 */
export const calculateVolumeROC = (data, period = 14) => {
    if (!data || data.length < period) return [];

    const results = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period) {
            results.push(null); // Not enough data for the first 'period' entries
            continue;
        }

        const currentVolume = data[i].volume;
        const previousVolume = data[i - period].volume;

        if (previousVolume === 0) {
            // If previous volume is zero, ROC is undefined or extremely high.
            // Returning 0 or null is a common practice to avoid Infinity/NaN.
            // Using 0 as a neutral value here.
            results.push(0); 
        } else {
            results.push(((currentVolume - previousVolume) / previousVolume) * 100);
        }
    }
    return results;
};


export const calculateMFI = (klineData, period = 14) => {
  if (!klineData || klineData.length < period + 1) return [];
  
  const results = [];
  const typicalPrices = klineData.map(k => (k.high + k.low + k.close) / 3);
  const rawMoneyFlow = klineData.map((k, i) => typicalPrices[i] * k.volume);
  
  for (let i = 0; i < period; i++) {
    results.push(null);
  }

  for (let i = period; i < klineData.length; i++) {
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      if (j > 0) { 
        if (typicalPrices[j] > typicalPrices[j - 1]) {
          positiveFlow += rawMoneyFlow[j];
        } else if (typicalPrices[j] < typicalPrices[j - 1]) {
          negativeFlow += rawMoneyFlow[j];
        }
      }
    }
    
    let mfi = null;
    if (negativeFlow === 0) {
      mfi = 100;
    } else {
      const moneyRatio = positiveFlow / negativeFlow;
      mfi = 100 - (100 / (1 + moneyRatio));
    }
    results.push(mfi);
  }
  
  return results;
};

export const calculateOBV = (data) => {
    // [OBV_CALC_DEBUG] Log
    //console.log("[OBV_CALC_DEBUG] Log: You will now see this log in your console. If you see >>> INSIDE 'calculateOBV' function, it is 100% proof that the calculation function itself is being executed.");

    if (!data || data.length < 2) return [];
    
    const obv = [];
    let currentOBV = 0;
    
    for (let i = 0; i < data.length; i++) {
        const candle = data[i];
        
        if (!candle || typeof candle.close !== 'number' || typeof candle.volume !== 'number') {
            obv.push(currentOBV);
            continue;
        }
        
        if (i === 0) {
            currentOBV = candle.volume;
        } else {
            const prevCandle = data[i - 1];
            
            if (!prevCandle || typeof prevCandle.close !== 'number') {
                obv.push(currentOBV);
                continue;
            }
            
            if (candle.close > prevCandle.close) {
                currentOBV += candle.volume;
            } else if (candle.close < prevCandle.close) {
                currentOBV -= candle.volume;
            }
        }
        
        if (isNaN(currentOBV) || !isFinite(currentOBV)) {
            currentOBV = obv.length > 0 ? obv[obv.length - 1] : 0;
        }
        
        // [OBV_FINAL_CHECK] Logs
        //console.log(`[OBV_FINAL_CHECK] Index: ${i}, Prev Close: ${i > 0 ? data[i-1].close : 'N/A'}, Curr Close: ${candle.close}, Volume: ${candle.volume}, New OBV: ${currentOBV}`);
        
        obv.push(currentOBV);
    }
    
    return obv;
};

export const calculateCMF = (klineData, period = 20) => {
  if (!klineData || klineData.length < period) return [];
  
  const results = [];
  
  for (let i = 0; i < klineData.length; i++) {
    if (i < period - 1) {
      results.push(null);
      continue;
    }
    
    let volumeSum = 0;
    let cmfSum = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      const candle = klineData[j];
      let mfMultiplier = 0;
      if (candle.high !== candle.low) {
        mfMultiplier = ((candle.close - candle.low) - (candle.high - candle.close)) / (candle.high - candle.low);
      }
      
      const mfVolume = mfMultiplier * candle.volume;
      
      cmfSum += mfVolume;
      volumeSum += candle.volume;
    }
    
    let cmf = null;
    if (volumeSum !== 0) {
        cmf = cmfSum / volumeSum;
    } else {
        cmf = 0;
    }
    results.push(cmf);
  }
  
  return results;
};

export const calculateADL = (klineData) => {
  if (!klineData || klineData.length === 0) return [];
  
  const results = [];
  let adl = 0;

  if (klineData.length > 0) {
      const firstCandle = klineData[0];
      let firstMfMultiplier = 0;
      if (firstCandle.high !== firstCandle.low) {
        firstMfMultiplier = ((firstCandle.close - firstCandle.low) - (firstCandle.high - firstCandle.close)) / (firstCandle.high - firstCandle.low);
      }
      adl = firstMfMultiplier * firstCandle.volume;
      results.push(adl);
  }
  
  for (let i = 1; i < klineData.length; i++) {
    const candle = klineData[i];
    let mfMultiplier = 0;
    if (candle.high !== candle.low) {
      mfMultiplier = ((candle.close - candle.low) - (candle.high - candle.close)) / (candle.high - candle.low);
    }
    const mfVolume = mfMultiplier * candle.volume;
    
    adl = results[i-1] + mfVolume;
    results.push(adl);
  }
  
  return results;
};

/**
 * Detects smart money accumulation/distribution patterns
 * Identifies when large players are quietly building or unwinding positions
 */
export const detectSmartMoneyFlow = (priceData, currentIndex, lookback = 20) => {
  if (currentIndex < lookback) return null;

  const recentData = priceData.slice(currentIndex - lookback, currentIndex + 1);
  const totalVolume = recentData.reduce((sum, candle) => sum + candle.volume, 0);
  const avgVolume = totalVolume / recentData.length;

  // Calculate volume-weighted price movements
  let accumulationScore = 0;
  let distributionScore = 0;
  let smartMoneyVolume = 0;

  for (let i = 1; i < recentData.length; i++) {
    const candle = recentData[i];
    const prevCandle = recentData[i - 1];
    const priceChange = candle.close - prevCandle.close;
    const priceChangePercent = prevCandle.close !== 0 ? priceChange / prevCandle.close : 0; // Prevent division by zero
    const volumeRatio = avgVolume !== 0 ? candle.volume / avgVolume : 0; // Prevent division by zero

    // Smart money characteristics: high volume with modest price movement
    const isSmartMoney = volumeRatio > 1.3 && Math.abs(priceChangePercent) < 0.02;
    
    if (isSmartMoney) {
      smartMoneyVolume += candle.volume;
      
      // Accumulation: high volume on up closes with small wicks above
      const closePosition = (candle.high - candle.low) !== 0 ? (candle.close - candle.low) / (candle.high - candle.low) : 0.5; // Handle zero range
      if (priceChange > 0 && closePosition > 0.7) {
        accumulationScore += volumeRatio * priceChangePercent;
      }
      
      // Distribution: high volume on down closes with small wicks below
      if (priceChange < 0 && closePosition < 0.3) {
        distributionScore += volumeRatio * Math.abs(priceChangePercent);
      }
    }
  }

  const smartMoneyRatio = totalVolume !== 0 ? smartMoneyVolume / totalVolume : 0;
  
  if (smartMoneyRatio > 0.3) { // Significant smart money activity
    if (accumulationScore > distributionScore * 1.5) {
      return {
        type: 'Smart Money Accumulation',
        intensity: accumulationScore,
        smartMoneyRatio: smartMoneyRatio,
        details: `Smart money accumulation detected (${(smartMoneyRatio * 100).toFixed(1)}% of volume)`
      };
    } else if (distributionScore > accumulationScore * 1.5) {
      return {
        type: 'Smart Money Distribution',
        intensity: distributionScore,
        smartMoneyRatio: smartMoneyRatio,
        details: `Smart money distribution detected (${(smartMoneyRatio * 100).toFixed(1)}% of volume)`
      };
    }
  }

  return null;
};

/**
 * Detects volume climax patterns - exhaustion signals
 */
export const detectVolumeClimax = (priceData, currentIndex, lookback = 50) => {
  if (currentIndex < lookback) return null;

  const currentCandle = priceData[currentIndex];
  const recentVolumes = priceData.slice(currentIndex - lookback, currentIndex)
    .map(candle => candle.volume);
  
  if (recentVolumes.length === 0) return null; // Ensure there's data to calculate avg/max

  const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
  const maxVolume = Math.max(...recentVolumes);
  const currentVolume = currentCandle.volume;

  // Volume climax: exceptionally high volume (top 5% of recent period)
  const isVolumeClimax = avgVolume !== 0 && currentVolume > avgVolume * 3 && currentVolume >= maxVolume * 0.8;
  
  if (!isVolumeClimax) return null;

  const priceRange = currentCandle.high - currentCandle.low;
  
  const recentRanges = priceData.slice(currentIndex - lookback, currentIndex)
    .map(candle => candle.high - candle.low);

  const avgRange = recentRanges.length > 0 ? recentRanges.reduce((sum, range) => sum + range, 0) / recentRanges.length : 0;
  
  const isWideRange = avgRange !== 0 && priceRange > avgRange * 1.5;
  const closePosition = priceRange > 0 ? (currentCandle.close - currentCandle.low) / priceRange : 0.5;

  // Buying climax: high volume, wide range, poor close (closes in lower 1/3)
  if (isWideRange && closePosition < 0.33 && currentCandle.close > currentCandle.open) {
    return {
      type: 'Buying Climax',
      volumeMultiple: avgVolume !== 0 ? currentVolume / avgVolume : Infinity,
      details: `High volume buying climax with poor close - potential exhaustion`
    };
  }

  // Selling climax: high volume, wide range, strong close (closes in upper 2/3)
  if (isWideRange && closePosition > 0.67 && currentCandle.close < currentCandle.open) {
    return {
      type: 'Selling Climax',
      volumeMultiple: avgVolume !== 0 ? currentVolume / avgVolume : Infinity,
      details: `High volume selling climax with strong close - potential reversal`
    };
  }

  return null;
};

/**
 * Advanced Volume Spread Analysis (VSA)
 * Analyzes the relationship between volume, price spread, and closing position
 */
export const analyzeVolumeSpread = (priceData, currentIndex, lookback = 30) => {
  if (currentIndex < lookback) return null;

  const currentCandle = priceData[currentIndex];
  const recentData = priceData.slice(currentIndex - lookback, currentIndex);
  
  if (recentData.length === 0) return null; // Ensure there's data for averages

  const avgVolume = recentData.reduce((sum, candle) => sum + candle.volume, 0) / recentData.length;
  const avgSpread = recentData.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / recentData.length;
  
  const currentVolume = currentCandle.volume;
  const currentSpread = currentCandle.high - currentCandle.low;
  const closePosition = currentSpread > 0 ? (currentCandle.close - currentCandle.low) / currentSpread : 0.5;
  
  const volumeRatio = avgVolume !== 0 ? currentVolume / avgVolume : 0;
  const spreadRatio = avgSpread !== 0 ? currentSpread / avgSpread : 0;

  // No Demand (Bearish): High volume, wide spread, closes down
  if (volumeRatio > 1.5 && spreadRatio > 1.3 && closePosition < 0.3 && currentCandle.close < currentCandle.open) {
    return {
      type: 'No Demand',
      strength: 80,
      details: `High volume, wide spread down bar with poor close - selling pressure`
    };
  }

  // No Supply (Bullish): High volume, wide spread, closes up
  if (volumeRatio > 1.5 && spreadRatio > 1.3 && closePosition > 0.7 && currentCandle.close > currentCandle.open) {
    return {
      type: 'No Supply',
      strength: 80,
      details: `High volume, wide spread up bar with strong close - buying pressure`
    };
  }

  // Effort vs Result: High volume but narrow spread
  if (volumeRatio > 2.0 && spreadRatio < 0.7) {
    return {
      type: 'Effort vs Result',
      strength: 75,
      details: `High volume with narrow spread - potential absorption/distribution`
    };
  }

  // Hidden buying: Normal volume, wide spread up, good close
  if (volumeRatio < 1.2 && spreadRatio > 1.2 && closePosition > 0.8 && currentCandle.close > currentCandle.open) {
    return {
      type: 'Hidden Buying',
      strength: 70,
      details: `Wide spread up with normal volume - stealth accumulation`
    };
  }

  return null;
};

/**
 * Enhanced On-Balance Volume with divergence detection
 */
export const calculateOBVWithDivergence = (priceData, obvData, currentIndex, lookback = 20) => {
  if (!obvData || currentIndex < lookback || priceData.length <= currentIndex) return null;

  const recentPrices = priceData.slice(currentIndex - lookback, currentIndex + 1);
  const recentOBV = obvData.slice(currentIndex - lookback, currentIndex + 1);

  if (recentPrices.length < 2 || recentOBV.length < 2) return null;

  // Find recent highs and lows
  const priceHighs = [];
  const priceLows = [];
  const obvHighs = [];
  const obvLows = [];

  for (let i = 1; i < recentPrices.length - 1; i++) {
    const price = recentPrices[i].close;
    const prevPrice = recentPrices[i - 1].close;
    const nextPrice = recentPrices[i + 1].close;
    const obv = recentOBV[i];
    const prevOBV = recentOBV[i - 1];
    const nextOBV = recentOBV[i + 1];

    // Price and OBV highs (peak detection)
    if (price > prevPrice && price >= nextPrice) { // Use >= for nextPrice to catch plateaus as peaks
      priceHighs.push({ index: i, value: price });
    }
    if (obv > prevOBV && obv >= nextOBV) {
      obvHighs.push({ index: i, value: obv });
    }

    // Price and OBV lows (trough detection)
    if (price < prevPrice && price <= nextPrice) { // Use <= for nextPrice to catch plateaus as troughs
      priceLows.push({ index: i, value: price });
    }
    if (obv < prevOBV && obv <= nextOBV) {
      obvLows.push({ index: i, value: obv });
    }
  }

  // Check for bearish divergence (price making higher highs, OBV making lower highs)
  if (priceHighs.length >= 2 && obvHighs.length >= 2) {
    const latestPriceHigh = priceHighs[priceHighs.length - 1];
    const prevPriceHigh = priceHighs[priceHighs.length - 2];
    const latestOBVHigh = obvHighs[obvHighs.length - 1];
    const prevOBVHigh = obvHighs[obvHighs.length - 2];

    // Ensure highs are distinct and in the correct order for divergence
    if (latestPriceHigh.value > prevPriceHigh.value && latestOBVHigh.value < prevOBVHigh.value &&
        latestPriceHigh.index > prevPriceHigh.index && latestOBVHigh.index > prevOBVHigh.index) {
      return {
        type: 'OBV Bearish Divergence',
        strength: 85,
        details: `Price making higher highs while OBV makes lower highs - volume not confirming`
      };
    }
  }

  // Check for bullish divergence (price making lower lows, OBV making higher lows)
  if (priceLows.length >= 2 && obvLows.length >= 2) {
    const latestPriceLow = priceLows[priceLows.length - 1];
    const prevPriceLow = priceLows[priceLows.length - 2];
    const latestOBVLow = obvLows[obvLows.length - 1];
    const prevOBVLow = obvLows[obvLows.length - 2];

    // Ensure lows are distinct and in the correct order for divergence
    if (latestPriceLow.value < prevPriceLow.value && latestOBVLow.value > prevOBVLow.value &&
        latestPriceLow.index > prevPriceLow.index && latestOBVLow.index > prevOBVLow.index) {
      return {
        type: 'OBV Bullish Divergence',
        strength: 85,
        details: `Price making lower lows while OBV makes higher lows - underlying buying pressure`
      };
    }
  }

  return null;
};

/**
 * Volume Profile analysis for key levels
 */
export const calculateVolumeProfile = (priceData, currentIndex, lookback = 100, bins = 20) => {
  if (currentIndex < lookback || !priceData || priceData.length === 0) return null;

  const recentData = priceData.slice(currentIndex - lookback, currentIndex + 1);
  
  if (recentData.length === 0) return null;

  const highestPrice = Math.max(...recentData.map(candle => candle.high));
  const lowestPrice = Math.min(...recentData.map(candle => candle.low));
  
  if (highestPrice === lowestPrice) { // Avoid division by zero if all prices are the same
      return {
          poc: { priceLevel: highestPrice, volume: recentData.reduce((sum, c) => sum + c.volume, 0), binIndex: 0 },
          significantLevels: [],
          volumeProfile: [{ priceLevel: highestPrice, volume: recentData.reduce((sum, c) => sum + c.volume, 0), binIndex: 0 }]
      };
  }

  const priceRange = highestPrice - lowestPrice;
  const binSize = priceRange / bins;

  // Initialize volume profile bins
  const volumeProfile = new Array(bins).fill(0).map((_, i) => ({
    priceLevel: lowestPrice + (i * binSize) + (binSize / 2), // Midpoint of the bin
    volume: 0,
    binIndex: i
  }));

  // Distribute volume across price levels
  recentData.forEach(candle => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    let binIndex = Math.floor((typicalPrice - lowestPrice) / binSize);
    
    // Ensure binIndex is within bounds
    binIndex = Math.min(bins - 1, Math.max(0, binIndex));
    
    volumeProfile[binIndex].volume += candle.volume;
  });

  // Find Point of Control (POC) - highest volume level
  const poc = volumeProfile.reduce((max, current) => 
    current.volume > max.volume ? current : max, { volume: -1 } // Initialize with a lower volume to ensure first item is picked if no other volume
  );

  // Find significant volume levels (above average)
  const totalVolumeInProfile = volumeProfile.reduce((sum, level) => sum + level.volume, 0);
  const avgVolumePerBin = bins > 0 ? totalVolumeInProfile / bins : 0;
  
  const significantLevels = volumeProfile.filter(level => level.volume > avgVolumePerBin * 1.5);

  return {
    poc: poc,
    significantLevels: significantLevels,
    volumeProfile: volumeProfile
  };
};

// =============================================
// NEW: Volume State Evaluation Functions
// =============================================

/**
 * Helper function to calculate the percentile rank of a value in a dataset.
 * @param {Array<number>} dataArray The dataset of historical values.
 * @param {number} value The value to rank.
 * @returns {number} The percentile rank (0-100).
 */
const getPercentileRank = (dataArray, value) => {
    // Filter out non-numeric values to ensure accurate sorting and calculation
    const numericData = dataArray.filter(d => typeof d === 'number' && !isNaN(d));

    if (!numericData || numericData.length === 0) return 50; // Default to neutral if no valid data
    
    const sorted = [...numericData].sort((a, b) => a - b);
    const count = sorted.length;
    let lesserCount = 0;
    for (let i = 0; i < count; i++) {
        if (sorted[i] < value) {
            lesserCount++;
        } else {
            // Optimization: if values are equal, count them as "not less than", then break
            // to avoid counting greater values.
            break; 
        }
    }
    // Calculate percentile. Add 0.5 to count for values equal to 'value'
    // This gives a more accurate "less than or equal to" percentile, or just strictly "less than"
    // The current implementation is strictly "less than", which is fine for relative ranking.
    return (lesserCount / count) * 100;
};


/**
 * Determines if volume is low, normal, or a spike relative to its moving average.
 * @param {Array<number>} volumes - Array of raw volume data.
 * @param {Array<number>} volumeSMAs - Array of volume SMA data, typically calculated by calculateVolumeMA.
 * @param {number} lookbackPeriod - How far back to look for historical context for percentile calculation.
 * @returns {Array<{state: string, percentile: number, ratio: number}>} An array of objects describing the relative volume state for each period.
 */
export const evaluateRelativeVolumeStates = (volumes, volumeSMAs, lookbackPeriod = 100) => {
    const results = [];
    if (!volumes || !volumeSMAs || volumes.length !== volumeSMAs.length) {
        return [];
    }

    for (let i = 0; i < volumes.length; i++) {
        // Need at least lookbackPeriod historical data points for meaningful percentile calculation
        // and a valid SMA value for the current period.
        if (i < lookbackPeriod || volumeSMAs[i] === null || volumeSMAs[i] === undefined || volumeSMAs[i] <= 0) {
            results.push({ state: 'insufficient_data', percentile: 50, ratio: 0 });
            continue;
        }

        const currentRatio = volumes[i] / volumeSMAs[i];
        
        // Collect historical ratios within the lookback window
        const historicalRatios = [];
        for (let j = Math.max(0, i - lookbackPeriod); j < i; j++) {
            if (volumeSMAs[j] !== null && volumeSMAs[j] !== undefined && volumeSMAs[j] > 0) {
                historicalRatios.push(volumes[j] / volumeSMAs[j]);
            }
        }

        // If historical data is scarce after filtering, default to neutral
        if (historicalRatios.length === 0) {
            results.push({ state: 'insufficient_data', percentile: 50, ratio: currentRatio });
            continue;
        }

        const percentile = getPercentileRank(historicalRatios, currentRatio);
        
        let state = 'normal';
        if (percentile >= 95) state = 'spike';
        else if (percentile >= 80) state = 'high';
        else if (percentile < 10) state = 'very_low';
        else if (percentile < 30) state = 'low';

        results.push({ state, percentile, ratio: currentRatio });
    }
    
    // Log the last state for debugging purposes
    //console.log(`[VOL_STATE_DEBUG] evaluateRelativeVolumeStates processed ${volumes.length} candles. Sample last state:`, results[results.length -1]);
    return results;
};

/**
 * Analyzes the trend of OBV to identify accumulation/distribution phases.
 * @param {Array<number>} obvValues - Array of OBV data, typically calculated by calculateOBV.
 * @param {number} lookbackPeriod - How far back to look for historical context for percentile calculation.
 * @param {number} trendPeriod - The period to calculate the OBV slope over (e.g., 20 for 20-period slope).
 * @returns {Array<{state: string, percentile: number, slope: number}>} An array of objects describing the OBV trend state.
 */
export const evaluateOBVTrendStates = (obvValues, lookbackPeriod = 100, trendPeriod = 20) => {
    const results = [];
    if (!obvValues || obvValues.length < trendPeriod) {
        return [];
    }

    // Calculate slopes for OBV over the trendPeriod
    const slopes = [];
    for(let i = 0; i < obvValues.length; i++) {
        if (i < trendPeriod || obvValues[i] === null || obvValues[i] === undefined || 
            obvValues[i - trendPeriod] === null || obvValues[i - trendPeriod] === undefined) {
            slopes.push(null); // Not enough data for the slope calculation
        } else {
            const slope = (obvValues[i] - obvValues[i - trendPeriod]) / trendPeriod;
            slopes.push(slope);
        }
    }

    for (let i = 0; i < obvValues.length; i++) {
        // Need enough historical slope data for percentile calculation
        if (i < lookbackPeriod || slopes[i] === null) {
            results.push({ state: 'insufficient_data', percentile: 50, slope: slopes[i] || 0 });
            continue;
        }

        const currentSlope = slopes[i];
        // Collect historical slopes within the lookback window, filtering out nulls
        const historicalSlopes = slopes.slice(Math.max(0, i - lookbackPeriod), i).filter(s => s !== null && s !== undefined && !isNaN(s));
        
        // If historical data is scarce after filtering, default to neutral
        if (historicalSlopes.length === 0) {
          results.push({ state: 'insufficient_data', percentile: 50, slope: currentSlope });
          continue;
        }

        const percentile = getPercentileRank(historicalSlopes, currentSlope);

        let state = 'neutral_obv';
        if (percentile >= 90) state = 'strong_accumulation'; // High positive slope
        else if (percentile >= 60) state = 'accumulation';    // Moderate positive slope
        else if (percentile < 10) state = 'strong_distribution'; // High negative slope
        else if (percentile < 40) state = 'distribution';      // Moderate negative slope

        results.push({ state, percentile, slope: currentSlope });
    }

    // Log the last state for debugging purposes
    //console.log(`[VOL_STATE_DEBUG] evaluateOBVTrendStates processed ${obvValues.length} candles. Sample last state:`, results[results.length -1]);
    return results;
};

/**
 * Identifies divergences between price (klines) and OBV.
 * This is a simplified implementation looking for basic divergences by finding
 * the highest/lowest points in recent history.
 * @param {Array<object>} klines - Array of kline data {high, low, close}.
 * @param {Array<number>} obvValues - Array of OBV data.
 * @param {number} lookbackPeriod - How far back to look for pivots and divergence.
 * @returns {Array<{state: string}>} An array of objects describing the divergence state for each period.
 */
export const evaluateOBVDivergence = (klines, obvValues, lookbackPeriod = 30) => {
    const results = [];
    if (!klines || !obvValues || klines.length !== obvValues.length) return [];

    /**
     * Helper to find the index of the highest/lowest valid number within a specified slice.
     * It searches backward from the end of the slice for a given `lookback` length.
     * @param {Array<number>} data - The array slice to search within.
     * @param {number} searchLookback - The number of elements from the end of `data` to search.
     * @param {'max'|'min'} compare - Type of pivot to find.
     * @returns {number} The index of the pivot within the `data` array, or -1 if not found.
     */
    const findPivot = (data, searchLookback, compare) => {
        let pivotIndex = -1;
        // Initialize pivotValue based on compare type to ensure correct initial comparison
        let pivotValue = compare === 'max' ? -Infinity : Infinity;

        // Iterate backwards from the end of the specified searchLookback window
        for (let i = data.length - 1; i >= Math.max(0, data.length - searchLookback); i--) {
            const currentValue = data[i];
            // Ensure data[i] is a valid number before comparison
            if (typeof currentValue !== 'number' || isNaN(currentValue)) {
                continue;
            }

            if (compare === 'max') {
                if (currentValue >= pivotValue) { // Use >= to capture the latest peak in case of plateaus
                    pivotValue = currentValue;
                    pivotIndex = i;
                }
            } else { // compare === 'min'
                if (currentValue <= pivotValue) { // Use <= to capture the latest trough in case of plateaus
                    pivotValue = currentValue;
                    pivotIndex = i;
                }
            }
        }
        return pivotIndex;
    };

    for (let i = 0; i < klines.length; i++) {
        // Need sufficient data for at least two pivots to be potentially found within the lookback.
        // A minimum of lookbackPeriod * 2 periods ensures space for two distinct pivots.
        if (i < lookbackPeriod * 2) { 
            results.push({ state: 'no_divergence' });
            continue;
        }

        // Create slices representing all historical data up to current 'i'
        // The findPivot function will then apply its 'lookback' parameter to these slices.
        const priceHighsSlice = klines.slice(0, i + 1).map(k => k.high);
        const priceLowsSlice = klines.slice(0, i + 1).map(k => k.low);
        const obvSliceCurrent = obvValues.slice(0, i + 1);

        let divergenceState = 'no_divergence';

        // --- Check for Bearish Divergence (Price Higher High, OBV Lower High) ---
        // Find the latest high within the current lookback period of the priceHighsSlice
        const lastPriceHighIdx = findPivot(priceHighsSlice, lookbackPeriod, 'max');
        let prevPriceHighIdx = -1;

        if (lastPriceHighIdx !== -1) {
            // Find the previous high in the data that comes *before* the latest high.
            // The search window for this previous high is the entire slice up to lastPriceHighIdx.
            // The `lookbackPeriod` for `findPivot` here means "search within the last `lookbackPeriod` of this sub-slice"
            // or "search the entire sub-slice if it's shorter". Using `lastPriceHighIdx` as searchLookback makes it search the whole prior history.
            prevPriceHighIdx = findPivot(priceHighsSlice.slice(0, lastPriceHighIdx), lastPriceHighIdx, 'max');
        }
        
        if (lastPriceHighIdx !== -1 && prevPriceHighIdx !== -1) {
            const latestPriceHighValue = priceHighsSlice[lastPriceHighIdx];
            const prevPriceHighValue = priceHighsSlice[prevPriceHighIdx];
            const latestOBVValueAtPriceHigh = obvSliceCurrent[lastPriceHighIdx];
            const prevOBVValueAtPriceHigh = obvSliceCurrent[prevPriceHighIdx];

            // Ensure values are valid numbers before comparing for divergence
            if (typeof latestPriceHighValue === 'number' && typeof prevPriceHighValue === 'number' &&
                typeof latestOBVValueAtPriceHigh === 'number' && typeof prevOBVValueAtPriceHigh === 'number') {

                // Price is making a higher high AND OBV is making a lower high
                if (latestPriceHighValue > prevPriceHighValue && latestOBVValueAtPriceHigh < prevOBVValueAtPriceHigh) {
                    divergenceState = 'bearish_divergence';
                }
            }
        }

        // --- Check for Bullish Divergence (Price Lower Low, OBV Higher Low) ---
        // Only check if no bearish divergence was found for this period
        if (divergenceState === 'no_divergence') {
            const lastPriceLowIdx = findPivot(priceLowsSlice, lookbackPeriod, 'min');
            let prevPriceLowIdx = -1;

            if (lastPriceLowIdx !== -1) {
                // Find the previous low in the data that comes *before* the latest low
                prevPriceLowIdx = findPivot(priceLowsSlice.slice(0, lastPriceLowIdx), lastPriceLowIdx, 'min');
            }

            if (lastPriceLowIdx !== -1 && prevPriceLowIdx !== -1) {
                const latestPriceLowValue = priceLowsSlice[lastPriceLowIdx];
                const prevPriceLowValue = priceLowsSlice[prevPriceLowIdx];
                const latestOBVValueAtPriceLow = obvSliceCurrent[lastPriceLowIdx];
                const prevOBVValueAtPriceLow = obvSliceCurrent[prevPriceLowIdx];
                
                // Ensure values are valid numbers before comparing for divergence
                if (typeof latestPriceLowValue === 'number' && typeof prevPriceLowValue === 'number' &&
                    typeof latestOBVValueAtPriceLow === 'number' && typeof prevOBVValueAtPriceLow === 'number') {

                    // Price is making a lower low AND OBV is making a higher low
                    if (latestPriceLowValue < prevPriceLowValue && latestOBVValueAtPriceLow > prevOBVValueAtPriceLow) {
                        divergenceState = 'bullish_divergence';
                    }
                }
            }
        }
        
        results.push({ state: divergenceState });
    }

    // Log the last state for debugging purposes
    //console.log(`[VOL_STATE_DEBUG] evaluateOBVDivergence processed ${klines.length} candles. Sample last state:`, results[results.length -1]);
    return results;
};


/**
 * Identifies rapid increases or decreases in volume changes (ROC).
 * @param {Array<number|null>} volumeROCs - Array of Volume Rate-of-Change data, typically calculated by calculateVolumeROC.
 * @param {number} lookbackPeriod - How far back to look for historical context for percentile calculation.
 * @returns {Array<{state: string, percentile: number}>} An array of objects describing the volume ROC state.
 */
export const evaluateVolumeRocStates = (volumeROCs, lookbackPeriod = 100) => {
    const results = [];
    if (!volumeROCs) return [];

    for (let i = 0; i < volumeROCs.length; i++) {
        // Ensure enough historical data and the current ROC value is valid
        if (i < lookbackPeriod || volumeROCs[i] === null || volumeROCs[i] === undefined || isNaN(volumeROCs[i])) {
            results.push({ state: 'insufficient_data', percentile: 50 });
            continue;
        }

        const currentRoc = volumeROCs[i];
        // Collect historical ROC values within the lookback window, filtering out invalid entries
        const historicalRocs = volumeROCs.slice(Math.max(0, i - lookbackPeriod), i).filter(r => r !== null && r !== undefined && !isNaN(r));
        
        // If historical data is scarce after filtering, default to neutral
        if (historicalRocs.length === 0) {
            results.push({ state: 'insufficient_data', percentile: 50 });
            continue;
        }

        const percentile = getPercentileRank(historicalRocs, currentRoc);

        let state = 'normal_roc';
        if (percentile >= 95) state = 'volume_explosion';      // Extremely high ROC, indicating a sudden surge
        else if (percentile >= 70) state = 'increasing_interest'; // High ROC, indicating growing interest
        else if (percentile < 5) state = 'extreme_drought';     // Extremely low or negative ROC, indicating very little activity
        else if (percentile < 30) state = 'drying_up';         // Low or negative ROC, indicating declining interest
        
        results.push({ state, percentile });
    }
    
    // Log the last state for debugging purposes
    //console.log(`[VOL_STATE_DEBUG] evaluateVolumeRocStates processed ${volumeROCs.length} candles. Sample last state:`, results[results.length -1]);
    return results;
};
