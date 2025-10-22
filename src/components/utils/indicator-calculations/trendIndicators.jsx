
/**
 * Trend-based technical indicators
 */
import { calculateEMA, calculateMA, calculateWMA, getTypicalPrice, calculateATRPoints } from './helpers';

/**
 * Calculates the Simple Moving Average (SMA).
 * @param {number[]} data - Array of numbers (e.g., closing prices).
 * @param {number} period - The number of periods to average.
 * @returns {number[]} An array of SMA values, padded with nulls at the beginning to match input data length.
 */
export function calculateSMA(data, period) {
    // DEBUG: Log input for SMA calculation
    // SMA calculation (reduced logging)
    const sma = new Array(data?.length || 0).fill(null);
    if (!data || data.length < period) {
        // Not enough data for SMA calculation
        return sma;
    }

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (i >= period) {
            sum -= data[i - period];
            sma[i] = sum / period;
        } else if (i === period - 1) {
            sma[i] = sum / period;
        }
    }
    // DEBUG: Log output
    // SMA calculation complete (reduced logging)
    return sma;
}

/**
 * Calculates the Relative Strength Index (RSI).
 * @param {number[]} data - Array of numbers (e.g., closing prices).
 * @param {number} period - The RSI period.
 * @returns {number[]} An array of RSI values, padded with nulls at the beginning to match input data length.
 */
export function calculateRSI(data, period) {
    // RSI requires at least period + 1 data points for the first calculation:
    // period for smoothing + 1 for initial price change (data[i] - data[i-1]).
    const rsiValues = new Array(data?.length || 0).fill(null);
    if (!data || data.length < period + 1) {
        return rsiValues;
    }

    let avgGain = 0;
    let avgLoss = 0;

    // Calculate initial average gain and loss over the first 'period' differences
    // These differences are from index 1 up to 'period' (total 'period' differences).
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) {
            avgGain += diff;
        } else {
            avgLoss += Math.abs(diff);
        }
    }
    avgGain /= period;
    avgLoss /= period;

    // Calculate the first RSI value at index 'period'
    // (since it's based on data[1] to data[period])
    if (avgLoss === 0) {
        rsiValues[period] = 100; // If no loss, RSI is 100
    } else {
        const rs = avgGain / avgLoss;
        rsiValues[period] = 100 - (100 / (1 + rs));
    }

    // Calculate subsequent RSI values using Wilder's smoothing
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        let currentGain = 0;
        let currentLoss = 0;

        if (diff > 0) {
            currentGain = diff;
        } else {
            currentLoss = Math.abs(diff);
        }

        // Wilder's smoothing formula
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

        if (avgLoss === 0) {
            rsiValues[i] = 100;
        } else {
            const rs = avgGain / avgLoss;
            rsiValues[i] = 100 - (100 / (1 + rs));
        }
    }

    return rsiValues;
}

/**
 * Calculates MACD (Moving Average Convergence Divergence) using pre-calculated EMAs.
 * @param {Array<number>} emaFast - Array of the fast EMA values.
 * @param {Array<number>} emaSlow - Array of the slow EMA values.
 * @param {number} signalPeriod - The period for the signal line EMA.
 * @returns {Array<object>} - Array of { macd, signal, histogram }.
 */
export const calculateMACD = (emaFast, emaSlow, signalPeriod = 9) => {
    if (!emaFast || !emaSlow || emaFast.length !== emaSlow.length || emaFast.length === 0) {
        return [];
    }

    // 1. Calculate the MACD Line (Fast EMA - Slow EMA)
    const macdLine = emaFast.map((fastVal, index) => {
        const slowVal = emaSlow[index];
        if (typeof fastVal === 'number' && typeof slowVal === 'number') {
            return fastVal - slowVal;
        }
        return null;
    });

    // 2. Calculate the Signal Line (EMA of the MACD Line)
    // We need to feed the EMA calculator the correct object structure it expects.
    const macdLineForEma = macdLine.map(value => ({ close: value }));
    const signalLineValues = calculateEMA(macdLineForEma, signalPeriod);

    // 3. Calculate the Histogram (MACD Line - Signal Line)
    const macdData = macdLine.map((macdVal, index) => {
        const signalVal = signalLineValues[index];
        if (typeof macdVal === 'number' && typeof signalVal === 'number') {
            const histogram = macdVal - signalVal;
            return { macd: macdVal, signal: signalVal, histogram: histogram };
        }
        return { macd: null, signal: null, histogram: null };
    });

    return macdData;
};

/**
 * Calculates Triple Exponential Moving Average (TEMA).
 * Ensures the returned array is padded to match the input data length.
 */
export const calculateTEMA = (klineData, period = 10) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    const ema1 = calculateEMA(klineData, period);
    const ema2 = calculateEMA(ema1.map(v => ({ close: v })), period);
    const ema3 = calculateEMA(ema2.map(v => ({ close: v })), period);

    const tema = new Array(klineData.length).fill(null);
    for (let i = 0; i < klineData.length; i++) {
        if (ema1[i] !== null && ema2[i] !== null && ema3[i] !== null) {
            tema[i] = (3 * ema1[i]) - (3 * ema2[i]) + ema3[i];
        }
    }
    // console.log(`[DEV][Calc] calculateTEMA (p=${period}) finished. Input: ${klineData.length}, Output: ${tema.length}`);
    return tema;
};

/**
 * Calculates Double Exponential Moving Average (DEMA).
 * Ensures the returned array is padded to match the input data length.
 */
export const calculateDEMA = (klineData, period = 10) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    const ema1 = calculateEMA(klineData, period);
    const ema2 = calculateEMA(ema1.map(v => ({ close: v })), period);

    const dema = new Array(klineData.length).fill(null);
    for (let i = 0; i < klineData.length; i++) {
        if (ema1[i] !== null && ema2[i] !== null) {
            dema[i] = (2 * ema1[i]) - ema2[i];
        }
    }
    // console.log(`[DEV][Calc] calculateDEMA (p=${period}) finished. Input: ${klineData.length}, Output: ${dema.length}`);
    return dema;
};

/**
 * Calculates Hull Moving Average (HMA).
 * Ensures the returned array is padded to match the input data length.
 */
export const calculateHMA = (klineData, period = 10) => {
    // Definitive Fix: Ensure the function always returns a padded array of the correct length.
    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));

    const wmaHalf = calculateWMA(klineData, halfPeriod);
    const wmaFull = calculateWMA(klineData, period);

    const diff = wmaHalf.map((val, i) => {
        if (wmaFull[i] !== null && val !== null) {
            return (2 * val) - wmaFull[i];
        }
        return null;
    });

    const hma = calculateWMA(diff.map(v => ({ close: v })), sqrtPeriod);
    // console.log(`[DEV][Calc] calculateHMA (p=${period}) finished. Input: ${klineData.length}, Output: ${hma.length}`);
    return hma;
};


export const calculateMARibbon = (klineData, maPeriods = [5, 10, 20, 50, 100, 200]) => {
    const ribbon = {};
    const closes = klineData.map(c => c.close);
    
    maPeriods.forEach(period => {
        ribbon[`ma${period}`] = calculateSMA(closes, period);
    });

    return ribbon;
};

// --- REWRITTEN for correctness and robustness ---
export const calculateADX = (klineData, period = 14) => {
    // A valid ADX value requires at least (2 * period - 1) data points for the smoothing calculations.
    // We check for 2 * period for a safe buffer.
    if (!klineData || klineData.length < 2 * period) {
        console.warn(`[calculateADX] Insufficient data. Need at least ${2 * period} candles, but received ${klineData?.length || 0}. Returning nulls.`);
        return Array(klineData?.length || 0).fill({ ADX: null, PDI: null, MDI: null });
    }

    const trs = [];
    const plusDMs = [];
    const minusDMs = [];

    // Step 1: Calculate True Range (TR) and Directional Movements (+DM, -DM)
    for (let i = 1; i < klineData.length; i++) {
        const high = klineData[i].high;
        const low = klineData[i].low;
        const prevHigh = klineData[i - 1].high;
        const prevLow = klineData[i - 1].low;
        const prevClose = klineData[i - 1].close;

        // Calculate True Range
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trs.push(tr);

        // Calculate Directional Movement
        const upMove = high - prevHigh;
        const downMove = prevLow - low;
        
        let plusDM = 0;
        let minusDM = 0;

        // Use 'else if' to ensure +DM and -DM are mutually exclusive.
        // A candle can have upward OR downward movement, but not both.
        if (upMove > downMove && upMove > 0) {
            plusDM = upMove;
        } else if (downMove > upMove && downMove > 0) {
            minusDM = downMove;
        }
        
        plusDMs.push(plusDM);
        minusDMs.push(minusDM);
    }
    
    /**
     * Helper function for Wilder's Smoothing (also known as a modified or running moving average).
     * @param {Array<number>} data - The array of numbers to smooth.
     * @param {number} length - The smoothing period.
     * @returns {Array<number|null>} The smoothed data array.
     */
    const wildersSmooth = (data, length) => {
        const smoothed = Array(data.length).fill(null);
        if (data.length < length) {
            return smoothed; 
        }

        // The first smoothed value is just a simple average of the first 'length' data points.
        let sum = 0;
        for (let i = 0; i < length; i++) {
            sum += data[i];
        }
        // This first valid value corresponds to the 'length'-th element of the input data array.
        smoothed[length - 1] = sum / length;
        
        // Subsequent values are calculated using the Wilder's smoothing formula.
        for (let i = length; i < data.length; i++) {
            smoothed[i] = (smoothed[i - 1] * (length - 1) + data[i]) / length;
        }
        return smoothed;
    };

    // Step 2: Smooth the TR, +DM, and -DM values
    const smoothedTR = wildersSmooth(trs, period);
    const smoothedPlusDM = wildersSmooth(plusDMs, period);
    const smoothedMinusDM = wildersSmooth(minusDMs, period);

    const plusDIs = [];
    const minusDIs = [];
    const dxs = [];

    // Step 3: Calculate Directional Indicators (+DI, -DI) and the Directional Index (DX)
    // These values are calculated starting from the first point where smoothed data is available.
    for (let i = period - 1; i < smoothedTR.length; i++) {
        // Check for null to prevent errors if smoothing failed
        if (smoothedTR[i] === null || smoothedPlusDM[i] === null || smoothedMinusDM[i] === null) {
            plusDIs.push(null);
            minusDIs.push(null);
            dxs.push(null);
            continue;
        }

        const pdi = smoothedTR[i] > 0 ? (smoothedPlusDM[i] / smoothedTR[i]) * 100 : 0;
        const mdi = smoothedTR[i] > 0 ? (smoothedMinusDM[i] / smoothedTR[i]) * 100 : 0;
        plusDIs.push(pdi);
        minusDIs.push(mdi);
        
        const diSum = pdi + mdi;
        const dx = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100;
        dxs.push(dx);
    }

    // Step 4: Smooth the DX values to get the final ADX
    const adxValues = wildersSmooth(dxs.filter(d => d !== null), period);

    // Step 5: Align all calculated indicator values with the original klineData array
    const results = [];
    for(let i = 0; i < klineData.length; i++) {
        const adxResult = { ADX: null, PDI: null, MDI: null };

        // PDI and MDI are valid from klineData index `period` onwards.
        // The first calculated DI corresponds to the `period`-th TR/DM value, which comes from klineData[period].
        const diIndex = i - period;
        if (diIndex >= 0 && diIndex < plusDIs.length) {
            adxResult.PDI = plusDIs[diIndex];
            adxResult.MDI = minusDIs[diIndex];
        }

        // ADX is valid from klineData index `2 * period - 1` onwards.
        // This is because it requires 'period' DX values, and the first DX value requires 'period' candles.
        const adxIndex = i - (2 * period - 1);
        if (adxIndex >= 0 && adxIndex < adxValues.length) {
            adxResult.ADX = adxValues[adxIndex];
        }
        
        results.push(adxResult);
    }
    
    return results;
};

// --- DEFINITIVE AND CORRECT RE-IMPLEMENTATION of calculatePSAR ---
export const calculatePSAR = (klineData, afStart = 0.02, afIncrement = 0.02, afMax = 0.2) => {
    const results = new Array(klineData.length).fill(null);
    if (klineData.length < 2) {
        return results;
    }

    let psar, isRising, extremePoint, af;

    // Initialize based on the first two candles
    // The direction is determined by comparing the closing prices of the first two candles.
    // PSAR for first candle is often not defined or set to current low/high.
    // For the second candle, PSAR is initialized.
    // Extreme point is the high/low of the second candle, depending on initial trend.
    if (klineData[1].close > klineData[0].close) {
        isRising = true;
        psar = klineData[0].low; // Initial PSAR for an uptrend is the prior low
        extremePoint = klineData[1].high; // Initial EP for an uptrend is current high
    } else {
        isRising = false;
        psar = klineData[0].high; // Initial PSAR for a downtrend is the prior high
        extremePoint = klineData[1].low; // Initial EP for a downtrend is current low
    }
    af = afStart;
    results[1] = psar; // PSAR is calculated starting from the second candle

    for (let i = 2; i < klineData.length; i++) {
        const prevPsar = psar;
        const currentHigh = klineData[i].high;
        const currentLow = klineData[i].low;

        // Calculate the next potential PSAR value
        let nextPsar;
        if (isRising) {
            nextPsar = prevPsar + af * (extremePoint - prevPsar);
            // In an uptrend, PSAR cannot be higher than the low of the current or previous period.
            // Some implementations use only (i-1).low, some use (i-1).low and (i).low.
            // Using (i-1).low and (i-2).low (or just prior low) is more common to prevent SAR from crossing price prematurely.
            // This ensures PSAR is always below current price in an uptrend (or above in a downtrend)
            if (klineData[i - 1].low < nextPsar) nextPsar = klineData[i - 1].low;
            if (i > 1 && klineData[i - 2].low < nextPsar) nextPsar = klineData[i - 2].low; // Ensure index is valid
        } else { // isFalling
            nextPsar = prevPsar - af * (prevPsar - extremePoint);
            // In a downtrend, PSAR cannot be lower than the high of the current or previous period.
            if (klineData[i - 1].high > nextPsar) nextPsar = klineData[i - 1].high;
            if (i > 1 && klineData[i - 2].high > nextPsar) nextPsar = klineData[i - 2].high; // Ensure index is valid
        }

        let trendReversed = false;
        // Check for trend reversal:
        // Uptrend reverses if current low falls below current PSAR
        if (isRising && currentLow < nextPsar) {
            isRising = false;
            trendReversed = true;
        } 
        // Downtrend reverses if current high rises above current PSAR
        else if (!isRising && currentHigh > nextPsar) {
            isRising = true;
            trendReversed = true;
        }
        
        if (trendReversed) {
            psar = extremePoint; // On reversal, PSAR is the last extreme point (high for new downtrend, low for new uptrend)
            af = afStart; // Reset acceleration factor
            extremePoint = isRising ? currentHigh : currentLow; // New extreme point is current high/low
        } else {
            psar = nextPsar; // No reversal, use the calculated value
            // Update extreme point and acceleration factor if a new high/low is made
            if (isRising && currentHigh > extremePoint) {
                extremePoint = currentHigh;
                af = Math.min(afMax, af + afIncrement);
            } else if (!isRising && currentLow < extremePoint) {
                extremePoint = currentLow;
                af = Math.min(afMax, af + afIncrement);
            }
        }
        
        results[i] = psar;
    }
    return results;
};

export const calculateIchimoku = (klineData, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52, chikouLag = 26) => {
    const results = [];
    if (!klineData || klineData.length < Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod)) {
        return new Array(klineData?.length || 0).fill(null);
    }

    const getHighLow = (data, start, end) => {
        // Ensure indices are within bounds
        const actualStart = Math.max(0, start);
        const actualEnd = Math.min(data.length, end); // slice end is exclusive

        if (actualStart >= actualEnd) { // No valid data range
            return { high: -Infinity, low: Infinity };
        }

        const slice = data.slice(actualStart, actualEnd);
        let high = -Infinity;
        let low = Infinity;

        for (const d of slice) {
            if (d && typeof d.high === 'number' && typeof d.low === 'number') {
                if (d.high > high) high = d.high;
                if (d.low < low) low = d.low;
            }
        }
        return { high, low };
    };

    // First pass: Calculate non-displaced components
    const intermediateResults = [];
    for (let i = 0; i < klineData.length; i++) {
        // Tenkan-sen (Conversion Line)
        const tenkanHighLow = getHighLow(klineData, i - tenkanPeriod + 1, i + 1);
        const tenkanSen = (isFinite(tenkanHighLow.high) && isFinite(tenkanHighLow.low)) ? (tenkanHighLow.high + tenkanHighLow.low) / 2 : null;

        // Kijun-sen (Base Line)
        const kijunHighLow = getHighLow(klineData, i - kijunPeriod + 1, i + 1);
        const kijunSen = (isFinite(kijunHighLow.high) && isFinite(kijunHighLow.low)) ? (kijunHighLow.high + kijunHighLow.low) / 2 : null;

        // Senkou Span A (Leading Span A) - Based on current Tenkan/Kijun
        const senkouSpanA = (tenkanSen !== null && kijunSen !== null) ? (tenkanSen + kijunSen) / 2 : null;

        // Senkou Span B (Leading Span B) - Based on highest high/lowest low over senkouBPeriod ending at current point
        const senkouBHighLow = getHighLow(klineData, i - senkouBPeriod + 1, i + 1);
        const senkouSpanB = (isFinite(senkouBHighLow.high) && isFinite(senkouBHighLow.low)) ? (senkouBHighLow.high + senkouBHighLow.low) / 2 : null;

        // Chikou Span (Lagging Span) - Current closing price (will be shifted backwards later)
        const chikouSpan = klineData[i].close;

        intermediateResults.push({
            tenkanSen: tenkanSen,
            kijunSen: kijunSen,
            senkouSpanA: senkouSpanA,
            senkouSpanB: senkouSpanB,
            chikouSpan: chikouSpan,
        });
    }
    
     // Second pass: Displace Senkou spans and Chikou span for final results
    for (let i = 0; i < intermediateResults.length; i++) {
        const val = intermediateResults[i];

        // Senkou Span A and B are shifted 'chikouLag' periods into the future
        const displacedA = intermediateResults[i + chikouLag]?.senkouSpanA ?? null;
        const displacedB = intermediateResults[i + chikouLag]?.senkouSpanB ?? null;
        
        // Chikou Span is shifted 'chikouLag' periods into the past
        const displacedChikou = intermediateResults[i - chikouLag]?.chikouSpan ?? null;
        
        results.push({
            tenkanSen: val.tenkanSen,
            kijunSen: val.kijunSen,
            senkouSpanA: displacedA,
            senkouSpanB: displacedB,
            chikouSpan: val.chikouSpan, // This is the non-displaced close for current candle
            displacedChikou: displacedChikou // This is the actual displaced chikou for plotting/logic
        });
    }

    return results;
};

// Kaufman's Adaptive Moving Average (KAMA)
export const calculateKAMA = (klineData, period = 14, fastSC = 2, slowSC = 30) => {
    if (!klineData || klineData.length < period) return [];
    
    const results = new Array(klineData.length).fill(null);
    const closes = klineData.map(c => parseFloat(c.close));
    
    // Calculate efficiency ratio
    const efficiencyRatios = [];
    for (let i = period; i < closes.length; i++) {
        const change = Math.abs(closes[i] - closes[i - period]);
        let volatility = 0;
        for (let j = 0; j < period; j++) {
            volatility += Math.abs(closes[i - j] - closes[i - j - 1]);
        }
        efficiencyRatios.push(change / volatility);
    }
    
    // Calculate KAMA
    let kama = null;
    for (let i = period; i < closes.length; i++) {
        const er = efficiencyRatios[i - period];
        const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
        
        if (kama === null) {
            kama = closes[i];
        } else {
            kama = kama + sc * (closes[i] - kama);
        }
        results[i] = kama;
    }
    
    return results;
};

// Trend Exhaustion Detection
export const detectTrendExhaustion = (klineData, lookback = 5) => {
    if (!klineData || klineData.length < lookback + 1) return [];
    
    const results = new Array(klineData.length).fill(null);
    const closes = klineData.map(c => parseFloat(c.close));
    
    for (let i = lookback; i < closes.length; i++) {
        const currentClose = closes[i];
        const previousCloses = closes.slice(i - lookback, i);
        
        // Check for divergence between price and momentum
        const priceChange = currentClose - previousCloses[0];
        const avgPrice = previousCloses.reduce((sum, price) => sum + price, 0) / lookback;
        const momentum = currentClose - avgPrice;
        
        // Simple exhaustion detection: if price is making new highs but momentum is decreasing
        const isExhausted = Math.abs(priceChange) > 0 && Math.abs(momentum) < Math.abs(priceChange) * 0.5;
        
        results[i] = isExhausted ? 1 : 0;
    }
    
    return results;
};
