
/**
 * Momentum-based technical indicators
 */
import { calculateMA } from './helpers'; // New import for MA
// The old import { calculateRSI } from './helpers'; is removed as RSI is now defined locally.

// --- DEEP DIAGNOSTIC REWRITE ---
// --- DEFINITIVE AND CORRECT RE-IMPLEMENTATION of calculateStochastic ---
export const calculateStochastic = (klineData, kPeriod = 14, dPeriod = 3, smoothK = 3) => {
    const results = new Array(klineData.length).fill({ K: null, D: null });
    if (klineData.length < kPeriod) {
        return results;
    }

    // Helper for Simple Moving Average calculation (this is local to Stochastic, not affected by external MA)
    const sma = (data, period) => {
        const smaResults = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            const slice = data.slice(i - period + 1, i + 1);
            if (slice.some(v => v === null)) {
                smaResults[i] = null;
            } else {
                const sum = slice.reduce((a, b) => a + b, 0);
                smaResults[i] = sum / period;
            }
        }
        return smaResults;
    };

    // Step 1: Calculate Raw %K
    const rawKValues = [];
    for (let i = 0; i < klineData.length; i++) {
        if (i < kPeriod - 1) {
            rawKValues.push(null);
            continue;
        }
        const periodSlice = klineData.slice(i - kPeriod + 1, i + 1);
        const lowestLow = Math.min(...periodSlice.map(c => c.low));
        const highestHigh = Math.max(...periodSlice.map(c => c.high));
        const currentClose = klineData[i].close;

        if (highestHigh === lowestLow) {
            rawKValues.push(i > 0 && typeof rawKValues[i - 1] === 'number' ? rawKValues[i - 1] : 50);
        } else {
            const rawK = 100 * ((currentClose - lowestLow) / (highestHigh - lowestLow));
            rawKValues.push(rawK);
        }
    }

    // Step 2: Calculate Smoothed %K (the final K line)
    const percentK = sma(rawKValues, smoothK);

    // Step 3: Calculate %D (SMA of the final K line)
    const percentD = sma(percentK, dPeriod);

    // Step 4: Assemble the final results
    for (let i = 0; i < klineData.length; i++) {
        const kValue = percentK[i];
        const dValue = percentD[i];
        results[i] = {
            K: (typeof kValue === 'number' && !isNaN(kValue)) ? kValue : null,
            D: (typeof dValue === 'number' && !isNaN(dValue)) ? dValue : null,
        };
    }

    return results;
};


export function calculateWilliamsR(klineData, period = 14) {
    if (!klineData || klineData.length < period) {
        return Array(klineData ? klineData.length : 0).fill(null);
    }

    const results = new Array(klineData.length).fill(null);
    for (let i = period - 1; i < klineData.length; i++) {
        const lookback = klineData.slice(i - period + 1, i + 1);
        
        // FIX: Use object property access (.high, .low, .close) instead of array indices.
        const highestHigh = Math.max(...lookback.map(c => c.high));
        const lowestLow = Math.min(...lookback.map(c => c.low));
        const currentClose = klineData[i].close;

        if (highestHigh === lowestLow) {
            results[i] = -50; 
        } else {
            results[i] = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
        }
    }
    
    return results;
}

export const calculateCCI = (klineData, period = 20, constant = 0.015) => {
  if (!klineData || klineData.length < period) return Array(klineData ? klineData.length : 0).fill(null);
  
  const results = [];
  const typicalPrices = klineData.map(k => (k.high + k.low + k.close) / 3);
  
  for (let i = 0; i < klineData.length; i++) {
    if (i < period - 1) {
      results.push(null);
      continue;
    }
    
    const slice = typicalPrices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    
    let meanDeviation = 0;
    for (let j = 0; j < period; j++) {
        meanDeviation += Math.abs(slice[j] - sma);
    }
    meanDeviation /= period;
    
    let cci = null;
    if (meanDeviation !== 0) {
        cci = (typicalPrices[i] - sma) / (constant * meanDeviation);
    }
    results.push(cci);
  }
  
  return results;
};

export const calculateROC = (klineData, period = 12) => {
  if (!klineData || klineData.length < period + 1) {
    return Array(klineData ? klineData.length : 0).fill(null);
  }

  const results = [];

  for (let i = 0; i < klineData.length; i++) {
    if (i < period) {
      results.push(null);
      continue;
    }

    const currentPrice = klineData[i].close;
    const pastPrice = klineData[i - period].close;

    if (pastPrice === 0) {
      results.push(null);
      continue;
    }

    const roc = ((currentPrice - pastPrice) / pastPrice) * 100;
    results.push(roc);
  }

  return results;
};

export function calculateAwesomeOscillator(klineData, fastPeriod = 5, slowPeriod = 34) {
    if (!klineData || klineData.length < slowPeriod) {
        return Array(klineData ? klineData.length : 0).fill(null);
    }

    // FIX: Use object property access (.high, .low) to calculate median price.
    const medianPrices = klineData.map(c => (c.high + c.low) / 2);
    
    // Helper to calculate SMA for Awesome Oscillator (local to AO, not affected by external MA)
    const calculateSMA = (data, period) => {
        const sma = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                sma.push(null);
            } else {
                const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
                sma.push(sum / period);
            }
        }
        return sma;
    };

    const fastMA = calculateSMA(medianPrices, fastPeriod);
    const slowMA = calculateSMA(medianPrices, slowPeriod);

    const ao = new Array(klineData.length).fill(null);
    for (let i = slowPeriod - 1; i < klineData.length; i++) {
        if(fastMA[i] !== null && slowMA[i] !== null) {
            ao[i] = fastMA[i] - slowMA[i];
        }
    }
    
    return ao;
}

/**
 * Calculates Relative Strength Index (RSI).
 * @param {Array<number>} closePrices - Array of closing prices.
 * @param {number} period - The time period for RSI calculation.
 * @returns {Array<number|null>} Array of RSI values.
 */
export const calculateRSI = (closePrices, period = 14) => {
    if (!closePrices || closePrices.length < period + 1) { // Changed condition to period + 1 as the first change needs two points
        return new Array(closePrices ? closePrices.length : 0).fill(null);
    }

    const rsiValues = new Array(closePrices.length).fill(null);
    let avgGain = 0;
    let avgLoss = 0;

    // Calculate initial average gain/loss over the first 'period' changes
    for (let i = 1; i <= period; i++) {
        const change = closePrices[i] - closePrices[i - 1];
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss -= change;
        }
    }
    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss === 0 ? (avgGain > 0 ? Infinity : 0) : avgGain / avgLoss; // Handle avgLoss === 0 properly
    rsiValues[period] = 100 - (100 / (1 + rs));

    // Calculate subsequent RSI values using Wilder's smoothing
    for (let i = period + 1; i < closePrices.length; i++) {
        const change = closePrices[i] - closePrices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rs = avgLoss === 0 ? (avgGain > 0 ? Infinity : 0) : avgGain / avgLoss; // Handle avgLoss === 0 properly
        rsiValues[i] = 100 - (100 / (1 + rs));
    }

    return rsiValues;
};


/**
 * Calculates Chande Momentum Oscillator (CMO).
 * @param {Array<number>} closePrices - Array of closing prices.
 * @param {number} period - The time period for CMO calculation.
 * @returns {Array<number|null>} Array of CMO values.
 */
export const calculateCMO = (closePrices, period = 14) => {
    if (!closePrices || closePrices.length < period + 1) { // Adjusted for period + 1 as first change needs 2 points
        return new Array(closePrices ? closePrices.length : 0).fill(null);
    }

    const cmoValues = new Array(closePrices.length).fill(null);
    for (let i = 0; i < closePrices.length; i++) {
        if (i < period) { // CMO needs 'period' prior values for changes
            cmoValues[i] = null;
            continue;
        }

        let sumGains = 0;
        let sumLosses = 0;
        // The loop for calculating sumGains and sumLosses should cover the 'period' changes.
        // If current index is `i`, the changes are from `closePrices[i-period]` to `closePrices[i]`.
        // This means `period` number of changes.
        for (let j = i - period + 1; j <= i; j++) {
            const diff = closePrices[j] - closePrices[j - 1]; // Change from previous point
            if (diff > 0) {
                sumGains += diff;
            } else {
                sumLosses += Math.abs(diff);
            }
        }
        if (sumGains + sumLosses === 0) {
            cmoValues[i] = 0; // Or null, depending on specific CMO convention for no movement
        } else {
            cmoValues[i] = 100 * ((sumGains - sumLosses) / (sumGains + sumLosses));
        }
    }
    return cmoValues;
};

// The old `calculateMA` helper function and `export { calculateRSI };` are removed
// as per the new import for MA and local definition for RSI.
