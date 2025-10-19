
/**
 * Core calculation helpers for technical indicators
 * These are the foundational functions used by all indicator types
 */

/**
 * Calculates the Exponential Moving Average (EMA) for a given period.
 * Ensures the returned array is padded to match the input data length.
 */
export const calculateEMA = (klineData, period = 12) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    if (!klineData || klineData.length < period) {
        return new Array(klineData?.length || 0).fill(null);
    }
  
    const results = new Array(klineData.length).fill(null);
    const multiplier = 2 / (period + 1);
    let ema = null;
    
    // Calculate initial EMA as the SMA of the first 'period' values
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += klineData[i].close;
    }
    ema = sum / period;
    results[period - 1] = ema;

    // Calculate subsequent EMAs
    for (let i = period; i < klineData.length; i++) {
        ema = (klineData[i].close - ema) * multiplier + ema;
        results[i] = ema;
    }
  
    return results;
};

/**
 * Calculates the Simple Moving Average (MA) for a given period.
 * Ensures the returned array is padded to match the input data length.
 */
export const calculateMA = (klineData, period) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    if (!klineData || klineData.length < period) {
        return new Array(klineData?.length || 0).fill(null);
    }

    const results = new Array(klineData.length).fill(null);
    let sum = 0;

    for (let i = 0; i < klineData.length; i++) {
        sum += klineData[i].close;
        if (i >= period) { // If we have enough data for a full window
            sum -= klineData[i - period].close; // Remove the oldest value
            results[i] = sum / period;
        } else if (i === period - 1) { // This is the first full window
            results[i] = sum / period;
        }
    }
    
    return results;
};

/**
 * Calculates the Weighted Moving Average (WMA) for a given period.
 */
export const calculateWMA = (klineData, period = 20) => { // Retaining period = 20 default to prevent runtime errors if not supplied
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    if (!klineData || klineData.length < period) {
        return new Array(klineData?.length || 0).fill(null);
    }
    
    const results = new Array(klineData.length).fill(null);
    const weightSum = period * (period + 1) / 2;

    for (let i = period - 1; i < klineData.length; i++) {
        let weightedSum = 0;
        for (let j = 0; j < period; j++) {
            weightedSum += klineData[i - j].close * (period - j);
        }
        results[i] = weightedSum / weightSum;
    }
    
    return results;
};

export const calculateRSI = (klineData, period = 14) => {
  if (!klineData || klineData.length < period + 1) return [];
  
  const results = [];
  const gains = [];
  const losses = [];
  
  // Calculate price changes
  for (let i = 1; i < klineData.length; i++) {
    const change = klineData[i].close - klineData[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate initial average gain/loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for(let i = 0; i < period; i++) {
      results.push(null);
  }

  if (avgLoss === 0) {
      results.push(100);
  } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      results.push(rsi);
  }

  for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;

      if (avgLoss === 0) {
          results.push(100);
      } else {
          const rs = avgGain / avgLoss;
          const rsi = 100 - (100 / (1 + rs));
          results.push(rsi);
      }
  }
  
  return results;
};

export const calculateATR = (klineData, period = 14) => {
    if (!klineData || klineData.length < period) {
        return new Array(klineData.length).fill(null);
    }

    const results = [];
    const trueRanges = [];

    for (let i = 0; i < klineData.length; i++) {
        const current = klineData[i];
        const prevClose = i > 0 ? klineData[i - 1].close : current.open; // Use current.open if no previous close (first bar)
        const tr = Math.max(current.high - current.low, Math.abs(current.high - prevClose), Math.abs(current.low - prevClose));
        trueRanges.push(tr);
    }
    
    for(let i = 0; i < period - 1; i++) {
        results.push(null);
    }

    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += trueRanges[i];
    }
    let atr = sum / period;
    results.push(atr);

    for (let i = period; i < klineData.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
        results.push(atr);
    }

    return results;
};

// Helper function for MACD calculation specifically for value arrays
export const calculateEMAFromValues = (values, period) => {
    if (!values || values.length === 0) {
        return [];
    }

    const results = new Array(values.length).fill(null);
    const multiplier = 2 / (period + 1);
    let ema = null;
    let sum = 0;
    let count = 0;
    let firstValidValueIndex = -1;

    for (let i = 0; i < values.length; i++) {
        const value = values[i];

        if (value === null) {
            ema = null;
            sum = 0;
            count = 0;
            firstValidValueIndex = -1;
            results[i] = null;
            continue;
        }

        if (ema === null) {
            if (firstValidValueIndex === -1) {
                firstValidValueIndex = i;
            }
            sum += value;
            count++;

            if (count === period) {
                ema = sum / period;
            }
            results[i] = ema;
        } else {
            ema = (value - ema) * multiplier + ema;
            results[i] = ema;
        }
    }
    return results;
};
