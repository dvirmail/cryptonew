
/**
 * Volatility-based technical indicators
 */
import { calculateEMA } from './helpers'; // Modified: calculateATR is now defined in this file

// Helper function to calculate Simple Moving Average (SMA)
// This is needed because the updated calculateBollingerBands uses calculateMA.
export function calculateMA(klineData, period) {
    if (!klineData || klineData.length < period) {
        return new Array(klineData?.length || 0).fill(null);
    }

    const maValues = new Array(klineData.length).fill(null);
    const closes = klineData.map(c => c.close);

    for (let i = period - 1; i < klineData.length; i++) {
        const slice = closes.slice(i - period + 1, i + 1);
        maValues[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
    return maValues;
}

/**
 * Calculates Bollinger Bands.
 * Ensures the returned array of objects is padded to match the input data length.
 */
export const calculateBollingerBands = (data, period = 20, stdDev = 2) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    if (!data || data.length < period) {
        return new Array(data?.length || 0).fill(null);
    }
    
    // console.log(`[DEV][Calc] calculateBollingerBands called for ${data.length} candles.`);
    const results = new Array(data.length).fill(null);
    const sma = calculateMA(data, period); // Use the newly defined calculateMA helper

    for (let i = period - 1; i < data.length; i++) {
        let stdDevValue = 0;
        let sum = 0;
        
        // Calculate standard deviation for the current window
        // The loop calculates sum of squared differences from the SMA of the current window.
        for (let j = i - (period - 1); j <= i; j++) {
            // Ensure sma[i] is a valid number before using it in calculations
            if (typeof sma[i] === 'number') {
                sum += Math.pow(data[j].close - sma[i], 2);
            } else {
                // If SMA is null (shouldn't happen if `i` starts from `period - 1` and `calculateMA` is correct),
                // then we cannot calculate.
                stdDevValue = NaN; 
                break;
            }
        }

        if (!isNaN(stdDevValue)) { // Proceed only if stdDevValue is not NaN
            stdDevValue = Math.sqrt(sum / period);
            
            results[i] = {
                upper: sma[i] + (stdDevValue * stdDev),
                middle: sma[i],
                lower: sma[i] - (stdDevValue * stdDev),
            };
        }
    }

    // console.log(`[DEV][Calc] calculateBollingerBands finished. Valid results: ${results.filter(Boolean).length}.`);
    // if(results[19]) console.log(`[DEV][Calc] Sample Bollinger Bands at index 19: Upper=${results[19]?.upper?.toFixed(2)}, Middle=${results[19]?.middle?.toFixed(2)}, Lower=${results[19]?.lower?.toFixed(2)}`);
    return results;
};

/**
 * Calculates Bollinger Band Width (BBW).
 * Ensures the returned array is padded to match the input data length.
 */
export function calculateBBW(klines, period = 20, multiplier = 2) {
  if (!Array.isArray(klines) || klines.length < period) {
    return Array(klines?.length || 0).fill(null);
  }

  const closes = klines.map(k => k.close);
  const sma = calculateMA(klines, period); // Use existing calculateMA
  const results = Array(klines.length).fill(null);

  for (let i = period - 1; i < klines.length; i++) {
    if (sma[i] === null) {
        results[i] = null; // Ensure null if SMA is null
        continue;
    }

    // Calculate standard deviation for the period
    let sum = 0;
    // Iterate from (current index - period + 1) to current index
    for (let j = i - period + 1; j <= i; j++) {
      sum += Math.pow(closes[j] - sma[i], 2);
    }
    const stdDev = Math.sqrt(sum / period);
    
    // Upper and Lower Bollinger Bands
    const upperBand = sma[i] + (multiplier * stdDev);
    const lowerBand = sma[i] - (multiplier * stdDev);
    
    // Bollinger Band Width (normalized by price)
    // Check for sma[i] being non-zero to prevent division by zero
    const bbw = (sma[i] !== 0) ? ((upperBand - lowerBand) / sma[i]) * 100 : 0; // As percentage
    
    results[i] = bbw;
  }

  return results;
}

// FIXED: Created a robust, self-contained ATR calculation function to prevent 'undefined call' errors.
export const calculateATR = (klines, period = 14) => {
    if (!klines || klines.length < period) {
        return [];
    }

    const atrValues = [];
    let previousAtr = null;

    for (let i = 0; i < klines.length; i++) {
        const currentCandle = klines[i];
        
        // Safety check for malformed candle data
        if (!currentCandle || typeof currentCandle.high === 'undefined' || typeof currentCandle.low === 'undefined' || typeof currentCandle.close === 'undefined') {
            atrValues.push(null);
            continue;
        }
        
        const prevCandle = i > 0 ? klines[i - 1] : null;

        const high = parseFloat(currentCandle.high);
        const low = parseFloat(currentCandle.low);
        const close = parseFloat(currentCandle.close);
        // If prevCandle is null or its close is undefined, use high as a fallback for the first True Range calculation.
        const prevClose = prevCandle && typeof prevCandle.close !== 'undefined' ? parseFloat(prevCandle.close) : high;

        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        const trueRange = Math.max(tr1, tr2, tr3);

        if (i < period - 1) {
            atrValues.push(null); // Not enough data for initial ATR period
        } else if (i === period - 1) {
            // Calculate initial ATR as simple average of the first 'period' True Ranges
            let sumOfTr = 0;
            for (let j = 0; j < period; j++) {
                const c = klines[j];
                const pc = j > 0 ? klines[j - 1] : null;
                const h = parseFloat(c.high);
                const l = parseFloat(c.low);
                // If pc is null or its close is undefined, use h as a fallback for the first candle's prevClose
                const pCl = pc && typeof pc.close !== 'undefined' ? parseFloat(pc.close) : h;
                sumOfTr += Math.max(h - l, Math.abs(h - pCl), Math.abs(l - pCl));
            }
            previousAtr = sumOfTr / period;
            atrValues.push(previousAtr);
        } else {
            if (previousAtr !== null) {
                const currentAtr = ((previousAtr * (period - 1)) + trueRange) / period;
                atrValues.push(currentAtr);
                previousAtr = currentAtr;
            } else {
                // This case should not be reached with the corrected logic above
                atrValues.push(null);
            }
        }
    }
    return atrValues;
};

export const calculateKeltnerChannels = (data, period = 20, atrPeriod = 10, multiplier = 2) => {
    if (!data || data.length < Math.max(period, atrPeriod)) {
        return new Array(data?.length || 0).fill(null);
    }

    const ema = calculateEMA(data, period);
    const atr = calculateATR(data, atrPeriod);
    const results = [];

    for (let i = 0; i < data.length; i++) {
        if (ema[i] === null || atr[i] === null || typeof ema[i] !== 'number' || typeof atr[i] !== 'number') {
            results.push(null);
            continue;
        }

        const middle = ema[i];
        const offset = atr[i] * multiplier;
        const upper = middle + offset;
        const lower = middle - offset;

        const channelWidth = (middle && middle > 0) ? (((upper - lower) / middle) * 100) : 0;
        
        let breakout = 'none';
        if (data[i].close > upper) {
            breakout = 'bullish';
        } else if (data[i].close < lower) {
            breakout = 'bearish';
        }

        results.push({
            upper,
            middle,
            lower,
            channelWidth: channelWidth,
            breakout,
            atr: atr[i]
        });
    }

    return results;
};

export const calculateDonchian = (data, period = 20) => {
    const results = [];
    if (!data || data.length < period) return [];

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            results.push(null);
            continue;
        }
        
        const slice = data.slice(i - (period - 1), i + 1);
        const upper = Math.max(...slice.map(c => c.high));
        const lower = Math.min(...slice.map(c => c.low));
        const middle = (upper + lower) / 2;
        
        const width = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
        
        results.push({ upper, middle, lower, width });
    }
    return results;
};

/**
 * Detects changes in the volatility regime using Bollinger Band Width (BBW).
 * Identifies when market transitions from low to high volatility (and vice versa).
 */
export const detectVolatilityRegimeChange = (bbwValues, currentIndex, lookback = 50) => {
  // Ensure enough data points for lookback and current index
  if (!bbwValues || currentIndex < lookback || currentIndex >= bbwValues.length) return null;
  
  const recentBBW = bbwValues.slice(currentIndex - lookback, currentIndex + 1);
  const currentBBW = bbwValues[currentIndex];

  // Calculate average and standard deviation, treating nulls as 0 for this calculation
  const averageBBW = recentBBW.reduce((sum, val) => sum + (val || 0), 0) / recentBBW.length;
  const stdDevBBW = Math.sqrt(recentBBW.reduce((sum, val) => sum + Math.pow((val || 0) - averageBBW, 2), 0) / recentBBW.length);

  // Define thresholds for expansion and contraction
  const upperThreshold = averageBBW + (1.5 * stdDevBBW);
  const lowerThreshold = averageBBW - (1.0 * stdDevBBW);

  // Get previous BBW value, defaulting to 0 if null/undefined
  const prevBBW = bbwValues[currentIndex - 1] || 0;

  // Volatility Expansion: Crossing from below to above the upper threshold
  if (prevBBW <= upperThreshold && currentBBW > upperThreshold) {
    return { 
      type: 'Expansion', 
      details: `Volatility expanded significantly above its ${lookback}-period average.`,
      intensity: (currentBBW - upperThreshold) / averageBBW // How much above the threshold, relative to average
    };
  }
  
  // Volatility Contraction: Crossing from above to below the lower threshold
  if (prevBBW >= lowerThreshold && currentBBW < lowerThreshold) {
    return { 
      type: 'Contraction', 
      details: `Volatility contracted significantly below its ${lookback}-period average.`,
      intensity: (lowerThreshold - currentBBW) / averageBBW // How much below the threshold, relative to average
    };
  }

  return null;
};

/**
 * Enhanced Bollinger Band Squeeze detection with multiple confirmation levels
 */
export const detectBollingerSqueeze = (bbwValues, keltnerData, currentIndex, lookback = 120) => {
  if (!bbwValues || currentIndex < lookback || currentIndex >= bbwValues.length) return null;
  
  const recentBbw = bbwValues.slice(currentIndex - lookback, currentIndex + 1);
  const currentBBW = bbwValues[currentIndex];

  // Filter out null/undefined values before finding the minimum
  const validRecentBbw = recentBbw.filter(val => typeof val === 'number' && !isNaN(val));
  if (validRecentBbw.length === 0) return null; // No valid BBW values in the lookback period

  const lowestBbw = Math.min(...validRecentBbw);
  
  // Define squeeze intensity levels
  const isTightSqueeze = currentBBW <= lowestBbw * 1.05; // Within 5% of lowest
  const isModerateSqueze = currentBBW <= lowestBbw * 1.15; // Within 15% of lowest
  
  // Additional confirmation: Bollinger Bands inside Keltner Channels
  // This part assumes BB data is also available or can be calculated/passed
  let keltnerConfirmation = false;
  if (keltnerData && keltnerData[currentIndex]) {
    const keltner = keltnerData[currentIndex];
    // This `bollinger` object would typically come from `calculateBollingerBands` output
    // and would need to be passed into this function or calculated here.
    // For now, this part is illustrative and not fully implemented based on current function signature.
    // The previous implementation had a placeholder, keeping it illustrative as `bollinger` is not provided to this function.
    const bollinger = { upper: 0, lower: 0 }; 
    // Example logic if bollinger data was available:
    // if (keltner && bollinger && keltner.upper > bollinger.upper && keltner.lower < bollinger.lower) {
    //   keltnerConfirmation = true;
    // }
  }
  
  if (isTightSqueeze) {
    return {
      type: 'Tight Squeeze',
      intensity: 'high',
      details: `BBW at ${((currentBBW / lowestBbw - 1) * 100).toFixed(1)}% above recent low`,
      duration: calculateSqueezeDuration(bbwValues, currentIndex, lowestBbw * 1.1) // Threshold slightly above lowest
    };
  } else if (isModerateSqueze) {
    return {
      type: 'Moderate Squeeze',
      intensity: 'medium',
      details: `BBW at ${((currentBBW / lowestBbw - 1) * 100).toFixed(1)}% above recent low`,
      duration: calculateSqueezeDuration(bbwValues, currentIndex, lowestBbw * 1.2) // Threshold slightly above lowest
    };
  }
  
  return null;
};

/**
 * Calculates how long the squeeze has been active
 */
const calculateSqueezeDuration = (bbwValues, currentIndex, threshold) => {
  let duration = 0;
  for (let i = currentIndex; i >= 0; i--) {
    // Check if the value is a number and within the threshold
    if (typeof bbwValues[i] === 'number' && bbwValues[i] <= threshold) {
      duration++;
    } else {
      break; // Stop counting if the condition is broken
    }
  }
  return duration;
};

/**
 * Detects confirmed breakouts from Bollinger Band squeezes
 */
export const detectSqueezeBreakout = (priceData, bollingerData, bbwValues, currentIndex, volumeData) => {
  // Ensure enough data points for current and previous candles/bands
  if (!priceData || !bollingerData || !bbwValues || !volumeData || currentIndex < 2 || 
      currentIndex >= priceData.length || currentIndex >= bollingerData.length || // Adjusted for new BB structure (length check on array of objects)
      currentIndex >= bbwValues.length || currentIndex >= volumeData.length) {
    return null;
  }
  
  const currentCandle = priceData[currentIndex];
  const prevCandle = priceData[currentIndex - 1];
  
  // Access bands from the new bollingerData structure { upper, middle, lower }
  // bollingerData is now an array of objects: [{upper: X, middle: Y, lower: Z}, ...]
  const currentBB = bollingerData[currentIndex];
  const prevBB = bollingerData[currentIndex - 1];
  
  // Check for nulls or invalid objects in the band data
  if (currentBB === null || prevBB === null ||
      typeof currentBB.upper !== 'number' || typeof currentBB.lower !== 'number' ||
      typeof prevBB.upper !== 'number' || typeof prevBB.lower !== 'number') {
      return null;
  }
  
  // Check if we were in a squeeze state recently
  // Find the lowest BBW in a broader recent period (e.g., 20 periods)
  const recentBbwForMin = bbwValues.slice(Math.max(0, currentIndex - 20), currentIndex);
  const validRecentBbw = recentBbwForMin.filter(val => typeof val === 'number' && !isNaN(val));
  if (validRecentBbw.length === 0) return null;

  const lowestBbwInPeriod = Math.min(...validRecentBbw);

  // Check if any of the last few (e.g., 5) BBW values indicate a squeeze
  const wasInSqueeze = bbwValues.slice(Math.max(0, currentIndex - 5), currentIndex)
    .some(bbw => typeof bbw === 'number' && !isNaN(bbw) && bbw <= lowestBbwInPeriod * 1.1); // Within 10% of lowest BBW
  
  if (!wasInSqueeze) return null;
  
  // Check for volume confirmation (average volume over lookback period)
  const volLookbackPeriod = Math.min(20, currentIndex); // Don't go beyond available data
  const recentVolumes = volumeData.slice(Math.max(0, currentIndex - volLookbackPeriod), currentIndex);
  
  const totalVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0);
  const avgVolume = recentVolumes.length > 0 ? totalVolume / recentVolumes.length : 0;
  
  // Check if current candle's volume is significantly higher than average
  const volumeConfirmed = avgVolume > 0 && currentCandle.volume > avgVolume * 1.5;
  
  // Bullish breakout confirmation: Close breaks above upper BB and previous was below/at
  if (currentCandle.close > currentBB.upper && prevCandle.close <= prevBB.upper) {
    return {
      type: 'Bullish Breakout',
      strength: volumeConfirmed ? 90 : 75, // Higher strength with volume confirmation
      details: `Price broke above upper BB at ${currentBB.upper.toFixed(2)}${volumeConfirmed ? ' with volume confirmation' : ''}`,
      volumeConfirmed
    };
  }
  
  // Bearish breakout confirmation: Close breaks below lower BB and previous was above/at
  if (currentCandle.close < currentBB.lower && prevCandle.close >= prevBB.lower) {
    return {
      type: 'Bearish Breakout',
      strength: volumeConfirmed ? 90 : 75, // Higher strength with volume confirmation
      details: `Price broke below lower BB at ${currentBB.lower.toFixed(2)}${volumeConfirmed ? ' with volume confirmation' : ''}`,
      volumeConfirmed
    };
  }
  
  return null;
};

/**
 * Advanced volatility clustering detection
 * Identifies when volatility patterns suggest upcoming significant moves
 */
export const detectVolatilityClustering = (atrValues, currentIndex, lookback = 30) => {
  // Ensure enough data points for lookback and current index
  if (!atrValues || currentIndex < lookback || currentIndex >= atrValues.length) return null;
  
  const recentATR = atrValues.slice(currentIndex - lookback, currentIndex + 1);
  // Calculate average ATR, treating nulls as 0 for this calculation
  const averageATR = recentATR.reduce((sum, val) => sum + (val || 0), 0) / recentATR.length;
  const currentATR = atrValues[currentIndex];

  // If averageATR is zero or currentATR is null/invalid, cannot calculate meaningful clustering
  if (averageATR === 0 || typeof currentATR !== 'number' || isNaN(currentATR)) return null;

  // Detect clusters of high volatility
  const highVolCount = recentATR.filter(atr => typeof atr === 'number' && atr > averageATR * 1.3).length;
  // Detect clusters of low volatility
  const lowVolCount = recentATR.filter(atr => typeof atr === 'number' && atr < averageATR * 0.7).length;
  
  // High volatility clustering: Many high volatility periods and current is also high
  if (highVolCount >= lookback * 0.3 && currentATR > averageATR * 1.2) {
    return {
      type: 'High Volatility Cluster',
      details: `${highVolCount} high volatility periods in last ${lookback} candles`,
      intensity: currentATR / averageATR // How much higher is current ATR relative to average
    };
  }
  
  // Low volatility clustering (compression before expansion): Many low volatility periods and current is also low
  if (lowVolCount >= lookback * 0.4 && currentATR < averageATR * 0.8) {
    return {
      type: 'Low Volatility Cluster',
      details: `${lowVolCount} low volatility periods in last ${lookback} candles - potential compression`,
      intensity: averageATR / currentATR // How much lower is current ATR relative to average (inverse ratio)
    };
  }
  
  return null;
};

// NEW: Calculate normalized ATR as percentage of price
export function calculateNormalizedATR(atrArray, priceData) {
    /* console.log('[ATR_NORM_DEBUG] calculateNormalizedATR called with:', {
        atrArrayLength: atrArray?.length,
        atrSample: atrArray?.slice(-2),
        priceDataLength: priceData?.length,
        priceDataSample: priceData?.slice(-2)
    }); */

    if (!atrArray || !Array.isArray(atrArray) || atrArray.length === 0) {
        // console.log('[ATR_NORM_DEBUG] Invalid atrArray:', atrArray);
        return [];
    }
    
    if (!priceData || !Array.isArray(priceData) || priceData.length === 0) {
        // console.log('[ATR_NORM_DEBUG] Invalid priceData:', priceData);
        return [];
    }

    return atrArray.map((atr, index) => {
        if (typeof atr !== 'number' || atr <= 0) {
            // console.log(`[ATR_NORM_DEBUG] Invalid ATR at index ${index}:`, atr);
            return null;
        }

        // FIXED: Handle both array and object formats for priceData
        let closePrice;
        if (index < priceData.length) {
            const priceEntry = priceData[index];
            if (Array.isArray(priceEntry)) {
                // Handle array format: [timestamp, open, high, low, close, volume]
                closePrice = parseFloat(priceEntry[4]);
            } else if (priceEntry && typeof priceEntry === 'object') {
                // Handle object format: {timestamp, open, high, low, close, volume}
                closePrice = parseFloat(priceEntry.close);
            } else {
                // console.log(`[ATR_NORM_DEBUG] Unrecognized priceEntry format at index ${index}:`, priceEntry);
                return null;
            }
        } else {
            // console.log(`[ATR_NORM_DEBUG] Price data missing for index ${index}`);
            return null;
        }

        if (typeof closePrice !== 'number' || closePrice <= 0 || !isFinite(closePrice)) {
            // console.log(`[ATR_NORM_DEBUG] Invalid close price at index ${index}:`, closePrice);
            return null;
        }

        // Calculate normalized ATR as percentage of price
        const normalizedAtr = (atr / closePrice) * 100;
        
        if (index === atrArray.length - 1) {
            // console.log(`[ATR_NORM_DEBUG] Final calculation - ATR: ${atr}, ClosePrice: ${closePrice}, NormalizedATR: ${normalizedAtr.toFixed(4)}%`);
        }

        return normalizedAtr;
    });
}

// NEW: Dynamic volatility state evaluator
export function evaluateVolatilityStates(values, lookbackPeriod = 100) {
  if (!Array.isArray(values) || values.length === 0) {
    return Array(values?.length || 0).fill({ state: 'unknown', percentile: 0 });
  }

  const results = Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null || values[i] === undefined || isNaN(values[i])) {
      results[i] = { state: 'unknown', percentile: 0 };
      continue;
    }

    // Determine the lookback window
    const startIndex = Math.max(0, i - lookbackPeriod + 1);
    const endIndex = i + 1;
    
    // Get historical values for comparison (exclude nulls, undefined, NaNs)
    const historicalValues = values.slice(startIndex, endIndex)
      .filter(val => typeof val === 'number' && !isNaN(val))
      .sort((a, b) => a - b);

    if (historicalValues.length < 20) { // Need minimum data for reliable percentiles
      results[i] = { state: 'unknown', percentile: 0 };
      continue;
    }

    const currentValue = values[i];
    
    // Calculate percentile rank of current value
    let rank = 0;
    for (const histVal of historicalValues) {
      if (currentValue > histVal) rank++;
    }
    const percentile = (rank / historicalValues.length) * 100;

    // Define dynamic states based on percentiles
    let state = 'medium';
    if (percentile <= 20) {
      state = 'low';
    } else if (percentile >= 80) {
      state = 'high';
    }

    results[i] = { state, percentile: Math.round(percentile) };
  }

  return results;
}

// NEW: Specialized function for BBW states (with squeeze detection)
export function evaluateBBWStates(bbwValues, lookbackPeriod = 100) {
  if (!Array.isArray(bbwValues) || bbwValues.length === 0) {
    return Array(bbwValues?.length || 0).fill({ state: 'unknown', percentile: 0 });
  }

  const results = Array(bbwValues.length).fill(null);

  for (let i = 0; i < bbwValues.length; i++) {
    if (bbwValues[i] === null || bbwValues[i] === undefined || isNaN(bbwValues[i])) {
      results[i] = { state: 'unknown', percentile: 0 };
      continue;
    }

    // Determine the lookback window
    const startIndex = Math.max(0, i - lookbackPeriod + 1);
    const endIndex = i + 1;
    
    // Get historical BBW values for comparison (exclude nulls, undefined, NaNs)
    const historicalValues = bbwValues.slice(startIndex, endIndex)
      .filter(val => typeof val === 'number' && !isNaN(val))
      .sort((a, b) => a - b);

    if (historicalValues.length < 20) { // Need minimum data for reliable percentiles
      results[i] = { state: 'unknown', percentile: 0 };
      continue;
    }

    const currentValue = bbwValues[i];
    
    // Calculate percentile rank of current value
    let rank = 0;
    for (const histVal of historicalValues) {
      if (currentValue > histVal) rank++;
    }
    const percentile = (rank / historicalValues.length) * 100;

    // Define BBW-specific states based on percentiles
    let state = 'normal';
    if (percentile <= 15) {
      state = 'contracting'; // Tight squeeze - potential breakout setup
    } else if (percentile <= 35) {
      state = 'low';
    } else if (percentile >= 85) {
      state = 'expanding'; // High volatility expansion
    } else if (percentile >= 65) {
      state = 'high';
    }

    results[i] = { state, percentile: Math.round(percentile) };
  }

  return results;
}

// Calculate standard deviation
export const calculateStandardDeviation = (values, period = 20) => {
  if (!values || values.length < period) return [];
  
  const results = [];
  
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, val) => sum + val, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    results.push(stdDev);
  }
  
  return results;
};
