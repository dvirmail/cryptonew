
import { get } from 'lodash';
import { getRegimeMultiplier } from '../regimeUtils';
import { detectAdvancedDivergence } from './divergenceUtils';

// --- START: REUSABLE & NEW HELPER FUNCTIONS ---

/**
 * Helper function to check if a value is a valid number (not null, undefined, or NaN).
 * @param {*} value - The value to check.
 * @returns {boolean} - True if the value is a number and not NaN, false otherwise.
 */
const isNumber = (value) => typeof value === 'number' && !isNaN(value);

/**
 * Helper function to find recent peaks and troughs for divergence detection
 * within a provided (sliced) data array.
 * @param {Array<number>} data - The sliced array of values (price or indicator).
 * @returns {{peaks: Array<{index: number, value: number}>, troughs: Array<{index: number, value: number}>}}
 */
const findPeaksTroughs = (data) => {
    const peaks = [];
    const troughs = [];
    // Iterate from the beginning of the sliced array to find local peaks/troughs
    // data[i-1] and data[i+1] require i to be within 1 and data.length - 2
    for (let i = 1; i < data.length - 1; i++) {
        // Ensure data[i] and its neighbors are valid numbers
        if (!isNumber(data[i]) || !isNumber(data[i - 1]) || !isNumber(data[i + 1])) {
            continue;
        }

        // Check for peak (value is higher than immediate neighbors)
        if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
            peaks.push({ index: i, value: data[i] });
        }
        // Check for trough (value is lower than immediate neighbors)
        if (data[i] < data[i - 1] && data[i] < data[i + 1]) {
            troughs.push({ index: i, value: data[i] });
        }
    }
    // Return the last 2 peaks and last 2 troughs found
    return { peaks: peaks.slice(-2), troughs: troughs.slice(-2) };
};

/**
 * NEW: Generic Divergence Detection Helper Function
 * Detects Regular and Hidden Bullish/Bearish Divergence.
 * @param {string} indicatorName - Name of the indicator for signal details.
 * @param {Array<number>} priceHistory - Sliced history of closing prices.
 * @param {Array<number>} indicatorHistory - Sliced history of indicator values.
 * @param {string} marketRegime - The current market regime.
 * @returns {Array<object>} - An array of divergence signal objects.
 */
const detectDivergence = (indicatorName, priceHistory, indicatorHistory, marketRegime) => {
    const signals = [];
    const pricePoints = findPeaksTroughs(priceHistory);
    const indicatorPoints = findPeaksTroughs(indicatorHistory);

    // Regular Bullish Divergence (Price LL, Indicator HL)
    if (pricePoints.troughs.length >= 2 && indicatorPoints.troughs.length >= 2) {
        // Ensure the troughs roughly align chronologically for meaningful divergence
        const latestPriceTrough = pricePoints.troughs[1];
        const earlierPriceTrough = pricePoints.troughs[0];
        const latestIndicatorTrough = indicatorPoints.troughs[1];
        const earlierIndicatorTrough = indicatorPoints.troughs[0];

        // Check if the relative order of troughs is consistent enough
        // We look for the most recent trough in price and indicator, and their preceding trough.
        // The indices must be valid and chronologically ordered for the respective indicator/price.
        if (latestPriceTrough.index > earlierPriceTrough.index && latestIndicatorTrough.index > earlierIndicatorTrough.index) {
            // Further refinement: Ensure that the peaks/troughs are not too far apart in terms of index
            // For simplicity, we assume the `slice` ensures relevant points are considered.
            if (latestPriceTrough.value < earlierPriceTrough.value &&
                latestIndicatorTrough.value > earlierIndicatorTrough.value) {
                signals.push({
                    type: indicatorName, value: 'Regular Bullish Divergence',
                    details: `Regular bullish divergence detected.`, strength: 90 * getRegimeMultiplier(marketRegime, indicatorName.toLowerCase(), 'bullish'),
                    name: `${indicatorName} Regular Bullish Divergence`, candle: {}
                });
            }
        }
    }

    // Hidden Bullish Divergence (Price HL, Indicator LL)
    if (pricePoints.troughs.length >= 2 && indicatorPoints.troughs.length >= 2) {
        const latestPriceTrough = pricePoints.troughs[1];
        const earlierPriceTrough = pricePoints.troughs[0];
        const latestIndicatorTrough = indicatorPoints.troughs[1];
        const earlierIndicatorTrough = indicatorPoints.troughs[0];

        if (latestPriceTrough.index > earlierPriceTrough.index && latestIndicatorTrough.index > earlierIndicatorTrough.index) {
            if (latestPriceTrough.value > earlierPriceTrough.value &&
                latestIndicatorTrough.value < earlierIndicatorTrough.value) {
                signals.push({
                    type: indicatorName, value: 'Hidden Bullish Divergence',
                    details: `Hidden bullish divergence detected, trend continuation signal.`, strength: 88 * getRegimeMultiplier(marketRegime, indicatorName.toLowerCase(), 'bullish'),
                    name: `${indicatorName} Hidden Bullish Divergence`, candle: {}
                });
            }
        }
    }

    // Regular Bearish Divergence (Price HH, Indicator LH)
    if (pricePoints.peaks.length >= 2 && indicatorPoints.peaks.length >= 2) {
        const latestPricePeak = pricePoints.peaks[1];
        const earlierPricePeak = pricePoints.peaks[0];
        const latestIndicatorPeak = indicatorPoints.peaks[1];
        const earlierIndicatorPeak = indicatorPoints.peaks[0];

        if (latestPricePeak.index > earlierPricePeak.index && latestIndicatorPeak.index > earlierIndicatorPeak.index) {
            if (latestPricePeak.value > earlierPricePeak.value &&
                latestIndicatorPeak.value < earlierIndicatorPeak.value) {
                signals.push({
                    type: indicatorName, value: 'Regular Bearish Divergence',
                    details: `Regular bearish divergence detected.`, strength: 90 * getRegimeMultiplier(marketRegime, indicatorName.toLowerCase(), 'bearish'),
                    name: `${indicatorName} Regular Bearish Divergence`, candle: {}
                });
            }
        }
    }

    // Hidden Bearish Divergence (Price LH, Indicator HH)
    if (pricePoints.peaks.length >= 2 && indicatorPoints.peaks.length >= 2) {
        const latestPricePeak = pricePoints.peaks[1];
        const earlierPricePeak = pricePoints.peaks[0];
        const latestIndicatorPeak = indicatorPoints.peaks[1];
        const earlierIndicatorPeak = indicatorPoints.peaks[0];

        if (latestPricePeak.index > earlierPricePeak.index && latestIndicatorPeak.index > earlierIndicatorPeak.index) {
            if (latestPricePeak.value < earlierPricePeak.value &&
                latestIndicatorPeak.value > earlierIndicatorPeak.value) {
                signals.push({
                    type: indicatorName, value: 'Hidden Bearish Divergence',
                    details: `Hidden bearish divergence detected, trend continuation signal.`, strength: 88 * getRegimeMultiplier(marketRegime, indicatorName.toLowerCase(), 'bearish'),
                    name: `${indicatorName} Hidden Bearish Divergence`, candle: {}
                });
            }
        }
    }
    return signals;
};

/**
 * Detects RSI Failure Swings.
 * A failure swing typically indicates a strong reversal signal.
 * @param {Array} rsiData - Array of RSI values.
 * @param {number} index - The current candle index.
 * @param {object} settings - RSI settings for overbought/oversold levels.
 * @param {number} lookback - How many candles to look back for peaks/troughs.
 * @returns {object|null} - A signal object if a failure swing is found, otherwise null.
 */
const detectRsiFailureSwing = (rsiData, index, settings, lookback = 15) => {
    if (index < lookback || index < 3) return null; // Need at least 3 points for a swing

    const overbought = settings.overbought || 70;
    const oversold = settings.oversold || 30;
    const currentRsi = rsiData[index];

    if (currentRsi === null) return null;

    // Bearish Failure Swing (Top Failure Swing)
    // 1. RSI makes a peak above overbought (P1).
    // 2. RSI retraces below overbought.
    // 3. RSI rallies again but fails to make a new high (P2 < P1) and stays below overbought.
    // 4. RSI then drops and breaks below the recent low (L1) formed between P1 and P2.
    // This outline's logic is a slightly simplified version, focusing on breaking a prior support after an overbought peak.
    if (currentRsi < overbought) {
        let peak1RSI = -Infinity;
        let peak1Index = -1;
        let lowestBetweenPeaksIndex = -1;
        let lowestBetweenPeaksRSI = Infinity;

        // Find the most recent peak (P1) above 'overbought' within lookback
        for (let i = 1; i <= lookback && (index - i) >= 0; i++) {
            const tempRsi = rsiData[index - i];
            if (tempRsi === null) continue;

            if (tempRsi > overbought && tempRsi > (rsiData[index - i - 1] || -Infinity) && tempRsi > (rsiData[index - i + 1] || -Infinity)) {
                // Found a peak above overbought
                peak1RSI = tempRsi;
                peak1Index = index - i;
                break;
            }
            // Also track the lowest point after entering overbought, before the potential second peak
            if (peak1Index !== -1 && tempRsi < lowestBetweenPeaksRSI) {
                 lowestBetweenPeaksRSI = tempRsi;
                 lowestBetweenPeaksIndex = index - i;
            }
        }

        if (peak1Index !== -1 && lowestBetweenPeaksIndex !== -1 && lowestBetweenPeaksIndex < peak1Index) {
            // Now, from the current index back to the lowest point, check for a lower high (P2)
            // And current RSI breaks below the lowestBetweenPeaksRSI (L1)
            let hasLowerHigh = false;
            for (let i = 1; i <= (index - lowestBetweenPeaksIndex) && (index - i) >= lowestBetweenPeaksIndex; i++) {
                const rsiVal = rsiData[index - i];
                if (rsiVal === null) continue;

                if (rsiVal < peak1RSI && rsiVal > (rsiData[index - i - 1] || -Infinity) && rsiVal > (rsiData[index - i + 1] || -Infinity) && rsiVal < overbought) {
                    // Found a lower high (P2) below P1 and below overbought
                    hasLowerHigh = true;
                    break;
                }
            }
            if (hasLowerHigh && currentRsi < lowestBetweenPeaksRSI) {
                return { type: 'Bearish Failure Swing', strength: 85 };
            }
        }
    }

    // Bullish Failure Swing (Bottom Failure Swing)
    // 1. RSI makes a trough below oversold (T1).
    // 2. RSI retraces above oversold.
    // 3. RSI drops again but fails to make a new low (T2 > T1) and stays above oversold.
    // 4. RSI then rises and breaks above the recent high (H1) formed between T1 and T2.
    // This outline's logic is a slightly simplified version, focusing on breaking a prior resistance after an oversold trough.
    if (currentRsi > oversold) {
        let trough1RSI = Infinity;
        let trough1Index = -1;
        let highestBetweenTroughsIndex = -1;
        let highestBetweenTroughsRSI = -Infinity;

        // Find the most recent trough (T1) below 'oversold' within lookback
        for (let i = 1; i <= lookback && (index - i) >= 0; i++) {
            const tempRsi = rsiData[index - i];
            if (tempRsi === null) continue;

            if (tempRsi < oversold && tempRsi < (rsiData[index - i - 1] || Infinity) && tempRsi < (rsiData[index - i + 1] || Infinity)) {
                // Found a trough below oversold
                trough1RSI = tempRsi;
                trough1Index = index - i;
                break;
            }
            // Also track the highest point after entering oversold, before the potential second trough
            if (trough1Index !== -1 && tempRsi > highestBetweenTroughsRSI) {
                highestBetweenTroughsRSI = tempRsi;
                highestBetweenTroughsIndex = index - i;
            }
        }

        if (trough1Index !== -1 && highestBetweenTroughsIndex !== -1 && highestBetweenTroughsIndex < trough1Index) {
            // Now, from the current index back to the highest point, check for a higher low (T2)
            // And current RSI breaks above the highestBetweenTroughsRSI (H1)
            let hasHigherLow = false;
            for (let i = 1; i <= (index - highestBetweenTroughsIndex) && (index - i) >= highestBetweenTroughsIndex; i++) {
                const rsiVal = rsiData[index - i];
                if (rsiVal === null) continue;

                if (rsiVal > trough1RSI && rsiVal < (rsiData[index - i - 1] || Infinity) && rsiVal < (rsiData[index - i + 1] || Infinity) && rsiVal > oversold) {
                    // Found a higher low (T2) above T1 and above oversold
                    hasHigherLow = true;
                    break;
                }
            }
            if (hasHigherLow && currentRsi > highestBetweenTroughsRSI) {
                return { type: 'Bullish Failure Swing', strength: 85 };
            }
        }
    }

    return null;
};

/**
 * Detects MFI Failure Swings. (Logic is very similar to RSI failure swings)
 * @param {Array} mfiData - Array of MFI values.
 * @param {number} index - The current candle index.
 * @param {object} settings - MFI settings for overbought/oversold levels.
 * @param {number} lookback - How many candles to look back.
 * @returns {object|null}
*/
const detectMfiFailureSwing = (mfiData, index, settings, lookback = 15) => {
    // Need at least 3 points for peak/trough detection (current, prev, next)
    if (index < lookback || index < 2) return null;

    const overbought = settings.overbought || 80;
    const oversold = settings.oversold || 20;

    // Bearish Failure Swing: Lower high in overbought territory
    let recentPeakIndex = -1;
    let recentPeakValue = -Infinity;

    // Find the most recent peak above overbought
    for(let i = index - 1; i >= Math.max(0, index - lookback); i--) {
        if (mfiData[i] === null) continue;
        const prevMfi = (i > 0) ? mfiData[i-1] : -Infinity;
        const nextMfi = (i < index) ? mfiData[i+1] : -Infinity;
        if (mfiData[i] > overbought && mfiData[i] > prevMfi && mfiData[i] > nextMfi) {
            recentPeakIndex = i;
            recentPeakValue = mfiData[i];
            break;
        }
    }

    if (recentPeakIndex !== -1) {
        let earlierPeakIndex = -1;
        let earlierPeakValue = -Infinity;
        // Find an earlier peak above overbought
        for(let i = recentPeakIndex - 1; i >= Math.max(0, index - lookback); i--) {
             if (mfiData[i] === null) continue;
            const prevMfi = (i > 0) ? mfiData[i-1] : -Infinity;
            const nextMfi = (i < recentPeakIndex) ? mfiData[i+1] : -Infinity;
            if (mfiData[i] > overbought && mfiData[i] > prevMfi && mfiData[i] > nextMfi) {
                // For a failure swing, we're looking for an earlier peak that was higher
                if (mfiData[i] > earlierPeakValue) {
                    earlierPeakIndex = i;
                    earlierPeakValue = mfiData[i];
                }
            }
        }
        // If a valid earlier peak is found AND the recent peak is lower
        if (earlierPeakIndex !== -1 && recentPeakValue < earlierPeakValue) {
            return { type: 'Bearish Failure Swing', strength: 85 };
        }
    }


    // Bullish Failure Swing: Higher low in oversold territory
    let recentTroughIndex = -1;
    let recentTroughValue = Infinity;

    // Find the most recent trough below oversold
    for(let i = index - 1; i >= Math.max(0, index - lookback); i--) {
        if (mfiData[i] === null) continue;
        const prevMfi = (i > 0) ? mfiData[i-1] : Infinity;
        const nextMfi = (i < index) ? mfiData[i+1] : Infinity;
        if (mfiData[i] < oversold && mfiData[i] < prevMfi && mfiData[i] < nextMfi) {
            recentTroughIndex = i;
            recentTroughValue = mfiData[i];
            break;
        }
    }

    if (recentTroughIndex !== -1) {
        let earlierTroughIndex = -1;
        let earlierTroughValue = Infinity;
        // Find an earlier trough below oversold
        for(let i = recentTroughIndex - 1; i >= Math.max(0, index - lookback); i--) {
            if (mfiData[i] === null) continue;
            const prevMfi = (i > 0) ? mfiData[i-1] : Infinity;
            const nextMfi = (i < recentTroughIndex) ? mfiData[i+1] : Infinity;
            if (mfiData[i] < oversold && mfiData[i] < prevMfi && mfiData[i] < nextMfi) {
                // For a failure swing, we're looking for an earlier trough that was lower
                if (mfiData[i] < earlierTroughValue) {
                    earlierTroughIndex = i;
                    earlierTroughValue = mfiData[i];
                }
            }
        }
        // If a valid earlier trough is found AND the recent trough is higher
        if (earlierTroughIndex !== -1 && recentTroughValue > earlierTroughValue) {
            return { type: 'Bullish Failure Swing', strength: 85 };
        }
    }

    return null;
}

/**
 * Detects Awesome Oscillator Twin Peaks pattern.
 * A very strong reversal signal.
 * @param {Array<number>} aoData - Array of Awesome Oscillator values.
 * @param {number} index - The current candle index.
 * @param {number} lookback - How many candles to look back for the pattern.
 * @returns {object|null} - A signal object if the pattern is found, otherwise null.
 */
const detectAwesomeOscillatorTwinPeaks = (aoData, index, lookback = 60) => {
    if (index < 2 || index < lookback || aoData.length < 3) return null; // Need at least 3 bars for a peak/trough (prev, current, next)

    const currentAo = aoData[index];
    const prevAo = aoData[index - 1];

    const isValidNumber = (val) => typeof val === 'number' && !isNaN(val);

    // Bullish Twin Peaks: Signal triggers on zero cross UP after the pattern
    if (isValidNumber(currentAo) && isValidNumber(prevAo) && currentAo > 0 && prevAo <= 0) {
        let peak2_index = -1;
        let peak2_value = 0;
        // Search for Peak 2 (most recent trough BELOW ZERO)
        // Loop backwards from `index - 1`
        for (let i = index - 1; i >= Math.max(0, index - lookback); i--) {
            // Ensure i-1, i, i+1 are valid indices and values are numbers
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

            // A trough is when current is lower than both neighbors
            if (aoData[i] < 0 && aoData[i] < aoData[i - 1] && aoData[i] < aoData[i + 1]) {
                peak2_index = i;
                peak2_value = aoData[i];
                break; // Found the most recent qualifying trough
            }
        }
        if (peak2_index === -1) return null;

        // Search for Trough (intervening peak BELOW ZERO) between P2 and P1
        let trough_index = -1;
        for (let i = peak2_index - 1; i >= Math.max(0, index - lookback); i--) {
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

            // A peak is when current is higher than both neighbors
            if (aoData[i] < 0 && aoData[i] > aoData[i - 1] && aoData[i] > aoData[i + 1]) {
                trough_index = i;
                break; // Found the most recent qualifying peak
            }
        }
        if (trough_index === -1) return null;

        // Search for Peak 1 (earlier trough BELOW ZERO) before Trough
        let peak1_index = -1;
        let peak1_value = 0;
        for (let i = trough_index - 1; i >= Math.max(0, index - lookback); i--) {
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

            if (aoData[i] < 0 && aoData[i] < aoData[i - 1] && aoData[i] < aoData[i + 1]) {
                peak1_index = i;
                peak1_value = aoData[i];
                break; // Found the most recent qualifying trough
            }
        }
        if (peak1_index === -1) return null;

        // Condition: Second peak (trough, as it's below zero) is higher (less negative) than the first. Both are negative.
        // And ensure correct chronological order: P1 -> Trough -> P2 -> Zero Cross
        if (peak2_value > peak1_value && trough_index > peak1_index && peak2_index > trough_index) {
            return { type: 'Bullish Twin Peaks', strength: 85 };
        }
    }

    // Bearish Twin Peaks: Signal triggers on zero cross DOWN after the pattern
    if (isValidNumber(currentAo) && isValidNumber(prevAo) && currentAo < 0 && prevAo >= 0) {
        let peak2_index = -1;
        let peak2_value = 0;
        // Search for Peak 2 (most recent peak ABOVE ZERO)
        for (let i = index - 1; i >= Math.max(0, index - lookback); i--) {
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

            if (aoData[i] > 0 && aoData[i] > aoData[i - 1] && aoData[i] > aoData[i + 1]) {
                peak2_index = i;
                peak2_value = aoData[i];
                break;
            }
        }
        if (peak2_index === -1) return null;

        // Search for Trough (intervening trough ABOVE ZERO)
        let trough_index = -1;
        for (let i = peak2_index - 1; i >= Math.max(0, index - lookback); i--) {
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

            if (aoData[i] > 0 && aoData[i] < aoData[i - 1] && aoData[i] < aoData[i + 1]) {
                trough_index = i;
                break;
            }
        }
        if (trough_index === -1) return null;

        // Search for Peak 1 (earlier peak ABOVE ZERO)
        let peak1_index = -1;
        let peak1_value = 0;
        for (let i = trough_index - 1; i >= Math.max(0, index - lookback); i--) {
            if (i <= 0 || i >= aoData.length - 1 || !isValidNumber(aoData[i]) || !isValidNumber(aoData[i-1]) || !isValidNumber(aoData[i+1])) continue;

             if (aoData[i] > 0 && aoData[i] > aoData[i - 1] && aoData[i] > aoData[i + 1]) {
                peak1_index = i;
                peak1_value = aoData[i];
                break;
            }
        }
        if (peak1_index === -1) return null;

        // Condition: Second peak is lower than the first. Both are positive.
        // And ensure correct chronological order: P1 -> Trough -> P2 -> Zero Cross
        if (peak2_value < peak1_value && trough_index > peak1_index && peak2_index > trough_index) {
            return { type: 'Bearish Twin Peaks', strength: 85 };
        }
    }

    return null;
};


/**
 * NEW: Helper function to detect the Awesome Oscillator Saucer pattern.
 * @param {Array<number>} aoHistory - A slice of the last 3 AO values (t-2, t-1, t).
 * @returns {string|null} - 'bullish' or 'bearish' if a saucer is detected, otherwise null.
 */
const detectAoSaucer = (aoHistory) => {
    if (aoHistory.length < 3) return null;
    const [ao2, ao1, ao0] = aoHistory; // ao2 = t-2, ao1 = t-1, ao0 = t (current)

    // Ensure all values are numbers
    if (typeof ao0 !== 'number' || isNaN(ao0) ||
        typeof ao1 !== 'number' || isNaN(ao1) ||
        typeof ao2 !== 'number' || isNaN(ao2)) {
        return null;
    }

    // Bullish Saucer (Below zero, then crosses up)
    // Pattern: t-2 is negative, t-1 is negative, t is positive (zero cross up).
    // And, t-1 is less negative (higher value) than t-2, forming a saucer shape.
    if (ao2 < 0 && ao1 < 0 && ao0 > 0 && ao1 > ao2) {
        return 'bullish';
    }

    // Bearish Saucer (Above zero, then crosses down)
    // Pattern: t-2 is positive, t-1 is positive, t is negative (zero cross down).
    // And, t-1 is less positive (lower value) than t-2, forming a saucer shape.
    if (ao2 > 0 && ao1 > 0 && ao0 < 0 && ao1 < ao2) {
        return 'bearish';
    }

    return null;
};

/**
 * Helper function to find regular divergence (reversal pattern) for MFI.
 * @param {Array<object>} priceData - Array of price candles, or just close prices.
 * @param {Array<number>} indicatorData - Array of indicator values.
 * @param {number} currentIndex - The current index in the main data arrays.
 * @param {number} lookback - The number of periods to look back for divergence.
 * @returns {{type: 'bullish'|'bearish'|null}} - Type of divergence if found, otherwise null.
 */
const findDivergence = (priceData, indicatorData, currentIndex, lookback) => {
    if (currentIndex < lookback) return { type: null };

    // Map priceData to close prices, handling potential nulls/undefineds
    const priceHistory = priceData.slice(currentIndex - lookback, currentIndex + 1).map(c => c?.close);
    const indicatorHistory = indicatorData.slice(currentIndex - lookback, currentIndex + 1);

    const pricePoints = findPeaksTroughs(priceHistory);
    const indicatorPoints = findPeaksTroughs(indicatorHistory);

    // Regular Bullish Divergence (Price LL, Indicator HL)
    if (pricePoints.troughs.length >= 2 && indicatorPoints.troughs.length >= 2) {
        const latestPriceTrough = pricePoints.troughs[1];
        const earlierPriceTrough = pricePoints.troughs[0];
        const latestIndicatorTrough = indicatorPoints.troughs[1];
        const earlierIndicatorTrough = indicatorPoints.troughs[0];

        // Ensure chronological order of troughs
        if (latestPriceTrough.index > earlierPriceTrough.index && latestIndicatorTrough.index > earlierIndicatorTrough.index) {
            if (latestPriceTrough.value < earlierPriceTrough.value &&
                latestIndicatorTrough.value > earlierIndicatorTrough.value) {
                return { type: 'bullish' };
            }
        }
    }

    // Regular Bearish Divergence (Price HH, Indicator LH)
    if (pricePoints.peaks.length >= 2 && indicatorPoints.peaks.length >= 2) {
        const latestPricePeak = pricePoints.peaks[1];
        const earlierPricePeak = pricePoints.peaks[0];
        const latestIndicatorPeak = indicatorPoints.peaks[1];
        const earlierIndicatorPeak = indicatorPoints.peaks[0];

        // Ensure chronological order of peaks
        if (latestPricePeak.index > earlierPricePeak.index && latestIndicatorPeak.index > earlierIndicatorPeak.index) {
            if (latestPricePeak.value > earlierPricePeak.value &&
                latestIndicatorPeak.value < earlierIndicatorPeak.value) {
                return { type: 'bearish' };
            }
        }
    }
    return { type: null }; // No regular divergence found
};

/**
 * Filters an array of signal objects to remove duplicates.
 * A signal is considered a duplicate if its type, value, and details are the same.
 * @param {Array<object>} signals - An array of signal objects.
 * @returns {Array<object>} - An array containing only unique signals.
 */
const getUniqueSignals = (signals) => {
    const uniqueMap = new Map();
    signals.forEach(signal => {
        // Create a unique key for each signal based on its type, value, and details
        // Assuming 'type' and 'value' and 'details' combined are unique enough for a single candle
        const key = `${signal.type}-${signal.value}-${signal.details}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, signal);
        }
    });
    return Array.from(uniqueMap.values());
};

// Helper function for RSI dynamic strength calculation
const calculateRsiStrength = (rsiValue, effectiveOversold, effectiveOverbought, volume, avgVolume, spikeMultiplier) => {
    let baseStrength = 70;
    let depthBonus = 0;

    if (rsiValue < effectiveOversold) {
        // The deeper into oversold, the stronger the signal
        depthBonus = Math.min(25, (effectiveOversold - rsiValue) * 1.5);
    } else if (rsiValue > effectiveOverbought) {
        // The deeper into overbought, the stronger the signal
        depthBonus = Math.min(25, (rsiValue - effectiveOverbought) * 1.5);
    }

    let finalStrength = baseStrength + depthBonus;

    // Add conviction bonus for volume confirmation
    if (volume > avgVolume * spikeMultiplier) {
        finalStrength += 10; // Volume confirmation bonus
    }

    return Math.min(100, finalStrength); // Cap strength at 100
};

/**
 * Helper function to adjust base strength based on market regime.
 * @param {number} baseStrength - The initial strength value.
 * @param {string} marketRegime - The current market regime.
 * @param {string} indicatorType - The type of indicator (e.g., 'roc', 'rsi').
 * @param {string} signalDirection - The direction of the signal ('bullish' or 'bearish').
 * @returns {number} - The adjusted strength.
 */
const applyRegimeAdjustment = (baseStrength, marketRegime, indicatorType, signalDirection) => {
    return baseStrength * getRegimeMultiplier(marketRegime, indicatorType, signalDirection);
};

/**
 * Helper function to detect all 4 types of divergence for logging purposes specifically.
 * This function is used by evaluateRsiEnhanced based on the outline's debug requirements.
 * @param {Array<object>} priceCandles - The full price history array.
 * @param {Array<number>} indicatorHistory - The full indicator history array.
 * @param {number} lookback - The number of periods to look back for divergence.
 * @param {function} logger - A logging function.
 * @returns {{regularBullish: boolean, regularBearish: boolean, hiddenBullish: boolean, hiddenBearish: boolean}}
 */
const _findRsiDivergencesForLogging = (priceCandles, indicatorHistory, lookback, logger) => {
    // Ensure we have enough data to slice
    if (priceCandles.length < lookback || indicatorHistory.length < lookback) {
        logger(`Insufficient data for divergence check. Required lookback ${lookback}. Price length: ${priceCandles.length}, Indicator length: ${indicatorHistory.length}`, 'debug');
        return { regularBullish: false, regularBearish: false, hiddenBullish: false, hiddenBearish: false };
    }

    const relevantPriceHistory = priceCandles.slice(priceCandles.length - lookback);
    const relevantIndicatorHistory = indicatorHistory.slice(indicatorHistory.length - lookback);

    const pricePoints = findPeaksTroughs(relevantPriceHistory.map(c => c?.close));
    const indicatorPoints = findPeaksTroughs(relevantIndicatorHistory);

    let regularBullish = false;
    let regularBearish = false;
    let hiddenBullish = false;
    let hiddenBearish = false;

    // Regular Bullish Divergence (Price LL, Indicator HL)
    if (pricePoints.troughs.length >= 2 && indicatorPoints.troughs.length >= 2) {
        const latestPriceTrough = pricePoints.troughs[1];
        const earlierPriceTrough = pricePoints.troughs[0];
        const latestIndicatorTrough = indicatorPoints.troughs[1];
        const earlierIndicatorTrough = indicatorPoints.troughs[0];

        if (latestPriceTrough.index > earlierPriceTrough.index && latestIndicatorTrough.index > earlierIndicatorTrough.index) {
            if (latestPriceTrough.value < earlierPriceTrough.value && latestIndicatorTrough.value > earlierIndicatorTrough.value) {
                regularBullish = true;
                logger(`Regular Bullish Divergence detected: Price LL (${earlierPriceTrough.value?.toFixed(2)} -> ${latestPriceTrough.value?.toFixed(2)}), Indicator HL (${earlierIndicatorTrough.value?.toFixed(2)} -> ${latestIndicatorTrough.value?.toFixed(2)})`, 'debug');
            }
        }
    }

    // Hidden Bullish Divergence (Price HL, Indicator LL)
    if (pricePoints.troughs.length >= 2 && indicatorPoints.troughs.length >= 2) {
        const latestPriceTrough = pricePoints.troughs[1];
        const earlierPriceTrough = pricePoints.troughs[0];
        const latestIndicatorTrough = indicatorPoints.troughs[1];
        const earlierIndicatorTrough = indicatorPoints.troughs[0];

        if (latestPriceTrough.index > earlierPriceTrough.index && latestIndicatorTrough.index > earlierIndicatorTrough.index) {
            if (latestPriceTrough.value > earlierPriceTrough.value && latestIndicatorTrough.value < earlierIndicatorTrough.value) {
                hiddenBullish = true;
                logger(`Hidden Bullish Divergence detected: Price HL (${earlierPriceTrough.value?.toFixed(2)} -> ${latestPriceTrough.value?.toFixed(2)}), Indicator LL (${earlierIndicatorTrough.value?.toFixed(2)} -> ${latestIndicatorTrough.value?.toFixed(2)})`, 'debug');
            }
        }
    }

    // Regular Bearish Divergence (Price HH, Indicator LH)
    if (pricePoints.peaks.length >= 2 && indicatorPoints.peaks.length >= 2) {
        const latestPricePeak = pricePoints.peaks[1];
        const earlierPricePeak = pricePoints.peaks[0];
        const latestIndicatorPeak = indicatorPoints.peaks[1];
        const earlierIndicatorPeak = indicatorPoints.peaks[0];

        if (latestPricePeak.index > earlierPricePeak.index && latestIndicatorPeak.index > earlierIndicatorPeak.index) {
            if (latestPricePeak.value > earlierPricePeak.value && latestIndicatorPeak.value < earlierIndicatorPeak.value) {
                regularBearish = true;
                logger(`Regular Bearish Divergence detected: Price HH (${earlierPricePeak.value?.toFixed(2)} -> ${latestPricePeak.value?.toFixed(2)}), Indicator LH (${earlierIndicatorPeak.value?.toFixed(2)} -> ${latestIndicatorPeak.value?.toFixed(2)})`, 'debug');
            }
        }
    }

    // Hidden Bearish Divergence (Price LH, Indicator HH)
    if (pricePoints.peaks.length >= 2 && indicatorPoints.peaks.length >= 2) {
        const latestPricePeak = pricePoints.peaks[1];
        const earlierPricePeak = pricePoints.peaks[0];
        const latestIndicatorPeak = indicatorPoints.peaks[1];
        const earlierIndicatorPeak = indicatorPoints.peaks[0];

        if (latestPricePeak.index > earlierPricePeak.index && latestIndicatorPeak.index > earlierIndicatorPeak.index) {
            if (latestPricePeak.value < earlierPricePeak.value && latestIndicatorPeak.value > earlierIndicatorPeak.value) {
                hiddenBearish = true;
                logger(`Hidden Bearish Divergence detected: Price LH (${earlierPricePeak.value?.toFixed(2)} -> ${latestPricePeak.value?.toFixed(2)}), Indicator HH (${earlierIndicatorPeak.value?.toFixed(2)} -> ${latestIndicatorPeak.value?.toFixed(2)})`, 'debug');
            }
        }
    }

    return { regularBullish, regularBearish, hiddenBullish, hiddenBearish };
};

/**
 * Enhanced RSI evaluation with event-based signals only
 */
export const evaluateRsiEnhanced = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const rsiSettings = signalSettings.rsi || {};
    
    if (!indicators.rsi || indicators.rsi.length <= index || index < 1) {
        return signals;
    }
    
    const currentRsi = indicators.rsi[index];
    const prevRsi = indicators.rsi[index - 1];
    const overbought = rsiSettings.overbought || 70;
    const oversold = rsiSettings.oversold || 30;

    if (!isNumber(currentRsi) || !isNumber(prevRsi)) {
        return signals;
    }
    
    // --- Event-Based Signals Only ---
    
    // Entry into oversold zone
    if (prevRsi > oversold && currentRsi <= oversold) {
        signals.push({
            type: 'RSI',
            value: 'Oversold Entry',
            strength: 75,
            isEvent: true,
            details: `RSI entered oversold zone: ${currentRsi.toFixed(2)}`,
            priority: 8,
            candle // Added candle
        });
    }
    
    // Exit from oversold zone
    if (prevRsi <= oversold && currentRsi > oversold) {
        signals.push({
            type: 'RSI',
            value: 'Oversold Exit',
            strength: 70,
            isEvent: true,
            details: `RSI exited oversold zone: ${currentRsi.toFixed(2)}`,
            priority: 7,
            candle // Added candle
        });
    }
    
    // Entry into overbought zone
    if (prevRsi < overbought && currentRsi >= overbought) {
        signals.push({
            type: 'RSI',
            value: 'Overbought Entry',
            strength: 75,
            isEvent: true,
            details: `RSI entered overbought zone: ${currentRsi.toFixed(2)}`,
            priority: 8,
            candle // Added candle
        });
    }
    
    // Exit from overbought zone
    if (prevRsi >= overbought && currentRsi < overbought) {
        signals.push({
            type: 'RSI',
            value: 'Overbought Exit',
            strength: 70,
            isEvent: true,
            details: `RSI exited overbought zone: ${currentRsi.toFixed(2)}`,
            priority: 7,
            candle // Added candle
        });
    }
    
    // --- State-Based Signals (for strategies requiring state conditions) ---
    
    // "RSI Above 50" - State signal indicating bullish momentum
    if (currentRsi > 50) {
        signals.push({
            type: 'RSI',
            value: 'RSI Above 50',
            strength: Math.min(70, 50 + (currentRsi - 50) * 0.8), // Scale from 50 to 70 based on how far above 50
            isEvent: false,
            details: `RSI is above 50 (current: ${currentRsi.toFixed(2)})`,
            priority: 6,
            candle
        });
    }
    
    // "RSI Below 50" - State signal indicating bearish momentum
    if (currentRsi < 50) {
        signals.push({
            type: 'RSI',
            value: 'RSI Below 50',
            strength: Math.min(70, 50 + (50 - currentRsi) * 0.8), // Scale from 50 to 70 based on how far below 50
            isEvent: false,
            details: `RSI is below 50 (current: ${currentRsi.toFixed(2)})`,
            priority: 6,
            candle
        });
    }
    
    return signals;
};

/**
 * Enhanced Stochastic evaluation with event-based signals only
 */
export const evaluateStochasticCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    // CRITICAL: Log function entry ALWAYS
    const logCheck = (msg) => {
        if (onLog) {
            onLog(msg, 'debug');
        } else {
            console.log(msg);
        }
    };
    
    //logCheck(`[STOCHASTIC_EVAL] ===== FUNCTION CALLED ===== index=${index}, debugMode=${debugMode}, hasCandle=${!!candle}, hasIndicators=${!!indicators}, hasSignalSettings=${!!signalSettings}, hasOnLog=${!!onLog}`);
    
    const signals = [];
    const stochSettings = signalSettings.stochastic || {};
    
    // Check indicator availability
    //logCheck(`[STOCHASTIC_EVAL] Indicator check: stochastic=${!!indicators.stochastic}, stochastic.length=${indicators.stochastic?.length}, index=${index}, index < 1=${index < 1}, length <= index=${indicators.stochastic?.length <= index}`);
    
    if (!indicators.stochastic || indicators.stochastic.length <= index || index < 1) {
        const reason = !indicators.stochastic ? 'stochastic indicator missing' : 
                      indicators.stochastic.length <= index ? `stochastic.length (${indicators.stochastic.length}) <= index (${index})` :
                      'index < 1';
        //logCheck(`[STOCHASTIC_EVAL] ❌ EARLY EXIT - ${reason}`);
        return signals;
    }
    
    const currentStoch = indicators.stochastic[index];
    const prevStoch = indicators.stochastic[index - 1];
    const overbought = stochSettings.overbought || 80;
    const oversold = stochSettings.oversold || 20;
    
    //logCheck(`[STOCHASTIC_EVAL] Data check: currentStoch=${!!currentStoch}, prevStoch=${!!prevStoch}, currentStoch.K=${currentStoch?.K} (type=${typeof currentStoch?.K}), currentStoch.D=${currentStoch?.D} (type=${typeof currentStoch?.D}), prevStoch.K=${prevStoch?.K} (type=${typeof prevStoch?.K}), prevStoch.D=${prevStoch?.D} (type=${typeof prevStoch?.D})`);
    //logCheck(`[STOCHASTIC_EVAL] Settings: overbought=${overbought}, oversold=${oversold}`);
    
    if (!currentStoch || !prevStoch || typeof currentStoch.K !== 'number' || typeof currentStoch.D !== 'number' || typeof prevStoch.K !== 'number' || typeof prevStoch.D !== 'number') {
        const reason = !currentStoch ? 'currentStoch missing' :
                      !prevStoch ? 'prevStoch missing' :
                      typeof currentStoch.K !== 'number' ? 'currentStoch.K is not a number' :
                      typeof currentStoch.D !== 'number' ? 'currentStoch.D is not a number' :
                      typeof prevStoch.K !== 'number' ? 'prevStoch.K is not a number' :
                      'prevStoch.D is not a number';
        //logCheck(`[STOCHASTIC_EVAL] ❌ EARLY EXIT - Invalid data: ${reason}`);
        return signals;
    }
    
    const currentK = currentStoch.K;
    const currentD = currentStoch.D;
    const prevK = prevStoch.K;
    const prevD = prevStoch.D;
    
    //logCheck(`[STOCHASTIC_EVAL] Values: currentK=${currentK}, currentD=${currentD}, prevK=${prevK}, prevD=${prevD}`);
    
    // --- Event-Based Signals Only ---
    
    // Bullish crossover: %K crosses above %D
    //logCheck(`[STOCHASTIC_EVAL] Checking bullish cross: prevK (${prevK}) <= prevD (${prevD}) = ${prevK <= prevD}, currentK (${currentK}) > currentD (${currentD}) = ${currentK > currentD}`);
    if (prevK <= prevD && currentK > currentD) {
        signals.push({
            type: 'Stochastic',
            value: 'Bullish Cross',
            strength: 75,
            isEvent: true,
            details: `%K crossed above %D: K=${currentK.toFixed(2)}, D=${currentD.toFixed(2)}`,
            priority: 8,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Bullish Cross" signal ADDED`);
    }
    
    // Bearish crossover: %K crosses below %D
    //logCheck(`[STOCHASTIC_EVAL] Checking bearish cross: prevK (${prevK}) >= prevD (${prevD}) = ${prevK >= prevD}, currentK (${currentK}) < currentD (${currentD}) = ${currentK < currentD}`);
    if (prevK >= prevD && currentK < currentD) {
        signals.push({
            type: 'Stochastic',
            value: 'Bearish Cross',
            strength: 75,
            isEvent: true,
            details: `%K crossed below %D: K=${currentK.toFixed(2)}, D=${currentD.toFixed(2)}`,
            priority: 8,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Bearish Cross" signal ADDED`);
    }
    
    // Entry into oversold zone
    //logCheck(`[STOCHASTIC_EVAL] Checking oversold entry: prevK (${prevK}) > oversold (${oversold}) = ${prevK > oversold}, currentK (${currentK}) <= oversold (${oversold}) = ${currentK <= oversold}`);
    if (prevK > oversold && currentK <= oversold) {
        signals.push({
            type: 'Stochastic',
            value: 'Oversold Entry',
            strength: 70,
            isEvent: true,
            details: `Stochastic entered oversold zone: ${currentK.toFixed(2)}`,
            priority: 7,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Oversold Entry" signal ADDED`);
    }
    
    // Exit from oversold zone (Oversold Exit)
    //logCheck(`[STOCHASTIC_EVAL] Checking oversold exit: prevK (${prevK}) <= oversold (${oversold}) = ${prevK <= oversold}, currentK (${currentK}) > oversold (${oversold}) = ${currentK > oversold}`);
    if (prevK <= oversold && currentK > oversold) {
        signals.push({
            type: 'Stochastic',
            value: 'Oversold Exit',
            strength: 70,
            isEvent: true,
            details: `Stochastic exited oversold zone: ${currentK.toFixed(2)}`,
            priority: 7,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Oversold Exit" signal ADDED`);
    }
    
    // Entry into overbought zone
    //logCheck(`[STOCHASTIC_EVAL] Checking overbought entry: prevK (${prevK}) < overbought (${overbought}) = ${prevK < overbought}, currentK (${currentK}) >= overbought (${overbought}) = ${currentK >= overbought}`);
    if (prevK < overbought && currentK >= overbought) {
        signals.push({
            type: 'Stochastic',
            value: 'Overbought Entry',
            strength: 70,
            isEvent: true,
            details: `Stochastic entered overbought zone: ${currentK.toFixed(2)}`,
            priority: 7,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Overbought Entry" signal ADDED`);
    }
    
    // Exit from overbought zone (Overbought Exit)
    //logCheck(`[STOCHASTIC_EVAL] Checking overbought exit: prevK (${prevK}) >= overbought (${overbought}) = ${prevK >= overbought}, currentK (${currentK}) < overbought (${overbought}) = ${currentK < overbought}`);
    if (prevK >= overbought && currentK < overbought) {
        signals.push({
            type: 'Stochastic',
            value: 'Overbought Exit',
            strength: 70,
            isEvent: true,
            details: `Stochastic exited overbought zone: ${currentK.toFixed(2)}`,
            priority: 7,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ "Overbought Exit" signal ADDED`);
    }
    
    // --- State-Based Signals (for strategies requiring state conditions) ---
    // These provide signals based on current position, not just transitions
    
    // "Oversold Exit" - State signal: K is currently above oversold (indicating recovery from oversold)
    // This helps strategies that want to catch recovery moves even if the exact exit moment was missed
    //logCheck(`[STOCHASTIC_EVAL] Checking state-based oversold exit: currentK (${currentK}) > oversold (${oversold}) = ${currentK > oversold}`);
    if (currentK > oversold) {
        // Strength scales from 60 to 75 based on how far above oversold
        const distanceFromOversold = currentK - oversold;
        const strength = 60 + Math.min(15, (distanceFromOversold / oversold) * 30); // Scale from 60-75
        signals.push({
            type: 'Stochastic',
            value: 'Oversold Exit',
            strength: strength,
            isEvent: false, // State signal, not event
            details: `Stochastic K (${currentK.toFixed(2)}) is above oversold zone (${oversold}), indicating recovery`,
            priority: 6,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ State-based "Oversold Exit" signal ADDED (strength=${strength.toFixed(2)})`);
    }
    
    // "Oversold Entry" - State signal: K is currently in oversold zone
    //logCheck(`[STOCHASTIC_EVAL] Checking state-based oversold entry: currentK (${currentK}) <= oversold (${oversold}) = ${currentK <= oversold}`);
    if (currentK <= oversold) {
        // Strength scales from 60 to 75 based on how deep in oversold
        const depthInOversold = oversold - currentK;
        const strength = 60 + Math.min(15, (depthInOversold / oversold) * 30); // Scale from 60-75
        signals.push({
            type: 'Stochastic',
            value: 'Oversold Entry',
            strength: strength,
            isEvent: false, // State signal
            details: `Stochastic K (${currentK.toFixed(2)}) is in oversold zone (<=${oversold})`,
            priority: 6,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ State-based "Oversold Entry" signal ADDED (strength=${strength.toFixed(2)})`);
    }
    
    // "Overbought Exit" - State signal: K is currently below overbought (indicating pullback from overbought)
    //logCheck(`[STOCHASTIC_EVAL] Checking state-based overbought exit: currentK (${currentK}) < overbought (${overbought}) = ${currentK < overbought}`);
    if (currentK < overbought) {
        // Strength scales from 60 to 75 based on how far below overbought
        const distanceFromOverbought = overbought - currentK;
        const strength = 60 + Math.min(15, (distanceFromOverbought / overbought) * 30); // Scale from 60-75
        signals.push({
            type: 'Stochastic',
            value: 'Overbought Exit',
            strength: strength,
            isEvent: false, // State signal
            details: `Stochastic K (${currentK.toFixed(2)}) is below overbought zone (${overbought}), indicating pullback`,
            priority: 6,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ State-based "Overbought Exit" signal ADDED (strength=${strength.toFixed(2)})`);
    }
    
    // "Overbought Entry" - State signal: K is currently in overbought zone
    //logCheck(`[STOCHASTIC_EVAL] Checking state-based overbought entry: currentK (${currentK}) >= overbought (${overbought}) = ${currentK >= overbought}`);
    if (currentK >= overbought) {
        // Strength scales from 60 to 75 based on how deep in overbought
        const depthInOverbought = currentK - overbought;
        const strength = 60 + Math.min(15, (depthInOverbought / overbought) * 30); // Scale from 60-75
        signals.push({
            type: 'Stochastic',
            value: 'Overbought Entry',
            strength: strength,
            isEvent: false, // State signal
            details: `Stochastic K (${currentK.toFixed(2)}) is in overbought zone (>=${overbought})`,
            priority: 6,
            candle
        });
        //logCheck(`[STOCHASTIC_EVAL] ✅ State-based "Overbought Entry" signal ADDED (strength=${strength.toFixed(2)})`);
    }
    
    //logCheck(`[STOCHASTIC_EVAL] ===== RETURNING ===== signals.length=${signals.length}`);
    signals.forEach((sig, idx) => {
        //logCheck(`[STOCHASTIC_EVAL] Signal[${idx}]: value="${sig.value}", strength=${sig.strength}, isEvent=${sig.isEvent}`);
    });
    //logCheck(`[STOCHASTIC_EVAL] ===== FUNCTION EXIT =====`);
    
    return signals;
};

/**
 * Enhanced Williams %R evaluation with event-based signals only
 */
export const evaluateWilliamsRCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const williamsSettings = signalSettings.williamsr || {};
    
    if (!indicators.williamsr || indicators.williamsr.length <= index || index < 1) { // Changed condition to match new outline structure requirements
        return signals;
    }
    
    const currentWilliams = indicators.williamsr[index];
    const prevWilliams = indicators.williamsr[index - 1];
    const overbought = williamsSettings.overbought || -20;
    const oversold = williamsSettings.oversold || -80;
    
    if (!isNumber(currentWilliams) || !isNumber(prevWilliams)) { // Added check for valid numbers
        return signals;
    }

    // --- Event-Based Signals ---
    
    // Entry into oversold zone
    if (prevWilliams > oversold && currentWilliams <= oversold) {
        signals.push({
            type: 'williamsr',
            value: 'Oversold Entry',
            strength: 75,
            isEvent: true,
            details: `Williams %R entered oversold zone: ${currentWilliams.toFixed(2)}`,
            priority: 8,
            candle // Added candle
        });
    }
    
    // Exit from oversold zone
    if (prevWilliams <= oversold && currentWilliams > oversold) {
        signals.push({
            type: 'williamsr',
            value: 'Oversold Exit',
            strength: 70,
            isEvent: true,
            details: `Williams %R exited oversold zone: ${currentWilliams.toFixed(2)}`,
            priority: 7,
            candle // Added candle
        });
    }
    
    // Entry into overbought zone
    if (prevWilliams < overbought && currentWilliams >= overbought) {
        signals.push({
            type: 'williamsr',
            value: 'Overbought Entry',
            strength: 75,
            isEvent: true,
            details: `Williams %R entered overbought zone: ${currentWilliams.toFixed(2)}`,
            priority: 8,
            candle // Added candle
        });
    }
    
    // Exit from overbought zone
    if (prevWilliams >= overbought && currentWilliams < overbought) {
        signals.push({
            type: 'williamsr',
            value: 'Overbought Exit',
            strength: 70,
            isEvent: true,
            details: `Williams %R exited overbought zone: ${currentWilliams.toFixed(2)}`,
            priority: 7,
            candle // Added candle
        });
    }
    
    // --- State-Based Signals (NEW) ---
    
    // "Oversold Exit" - State signal: %R is currently above oversold (indicating recovery)
    if (currentWilliams > oversold) {
        const distanceFromOversold = currentWilliams - oversold;
        const strength = 60 + Math.min(15, (distanceFromOversold / Math.abs(oversold)) * 30);
        signals.push({
            type: 'williamsr',
            value: 'Oversold Exit',
            strength: strength,
            isEvent: false,
            details: `Williams %R (${currentWilliams.toFixed(2)}) is above oversold zone (${oversold}), indicating recovery`,
            priority: 6,
            candle
        });
    }
    
    // "Oversold Entry" - State signal: %R is currently in oversold zone
    if (currentWilliams <= oversold) {
        const depthInOversold = oversold - currentWilliams;
        const strength = 60 + Math.min(15, (depthInOversold / Math.abs(oversold)) * 30);
        signals.push({
            type: 'williamsr',
            value: 'Oversold Entry',
            strength: strength,
            isEvent: false,
            details: `Williams %R (${currentWilliams.toFixed(2)}) is in oversold zone (<=${oversold})`,
            priority: 6,
            candle
        });
    }
    
    // "Overbought Exit" - State signal: %R is currently below overbought (indicating pullback)
    if (currentWilliams < overbought) {
        const distanceFromOverbought = overbought - currentWilliams;
        const strength = 60 + Math.min(15, (distanceFromOverbought / Math.abs(overbought)) * 30);
        signals.push({
            type: 'williamsr',
            value: 'Overbought Exit',
            strength: strength,
            isEvent: false,
            details: `Williams %R (${currentWilliams.toFixed(2)}) is below overbought zone (${overbought}), indicating pullback`,
            priority: 6,
            candle
        });
    }
    
    // "Overbought Entry" - State signal: %R is currently in overbought zone
    if (currentWilliams >= overbought) {
        const depthInOverbought = currentWilliams - overbought;
        const strength = 60 + Math.min(15, (depthInOverbought / Math.abs(overbought)) * 30);
        signals.push({
            type: 'williamsr',
            value: 'Overbought Entry',
            strength: strength,
            isEvent: false,
            details: `Williams %R (${currentWilliams.toFixed(2)}) is in overbought zone (>=${overbought})`,
            priority: 6,
            candle
        });
    }
    
    return signals;
};

export const evaluateCciCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const cciSettings = signalSettings.cci || {};

    if (!cciSettings.enabled) return signals;

    if (!indicators.cci || indicators.cci.length <= index) {
        return signals;
    }

    const currentCci = indicators.cci[index];
    if (!isNumber(currentCci)) {
        return signals;
    }

    const overbought = cciSettings.overbought || 100;
    const oversold = cciSettings.oversold || -100;
    
    // --- State-Based Signals ---

    // 1. CCI Zone Analysis
    if (currentCci > overbought) {
        const strength = 50 + Math.min(40, (currentCci - overbought) / 10);
        signals.push({
            type: 'CCI',
            value: 'Overbought State',
            strength: Math.min(100, strength),
            details: `CCI ${currentCci.toFixed(2)} is in overbought territory (>${overbought})`,
            priority: 7,
            candle
        });
    } else if (currentCci < oversold) {
        const strength = 50 + Math.min(40, (oversold - currentCci) / 10);
        signals.push({
            type: 'CCI',
            value: 'Oversold State',
            strength: Math.min(100, strength),
            details: `CCI ${currentCci.toFixed(2)} is in oversold territory (<${oversold})`,
            priority: 7,
            candle
        });
    } else {
        // Neutral zone
        const distanceFromZero = Math.abs(currentCci);
        const strength = 25 + Math.min(25, distanceFromZero / 4);
        signals.push({
            type: 'CCI',
            value: 'Neutral State',
            strength: Math.min(100, strength),
            details: `CCI ${currentCci.toFixed(2)} is in neutral territory`,
            priority: 4,
            candle
        });
    }

    // 2. CCI Momentum
    if (index > 0) {
        const prevCci = indicators.cci[index - 1];
        if (isNumber(prevCci)) {
            const cciChange = currentCci - prevCci;
            const momentum = cciChange > 0 ? 'Rising' : 'Falling';
            const momentumStrength = Math.abs(cciChange);
            
            signals.push({
                type: 'CCI',
                value: `${momentum} Momentum`,
                strength: Math.min(100, 30 + Math.min(35, momentumStrength / 2)),
                details: `CCI momentum is ${momentum.toLowerCase()}`,
                priority: 5,
                candle
            });
        }
    }

    // --- Event-Based Signals ---
    if (index > 0) {
        const prevCci = indicators.cci[index - 1];
        if (isNumber(prevCci)) {
            // Zero Line Cross
            if (currentCci > 0 && prevCci <= 0) {
                signals.push({
                    type: 'CCI',
                    value: 'Bullish Zero Cross',
                    strength: applyRegimeAdjustment(75, marketRegime, 'cci', 'bullish'),
                    details: `CCI crossed above zero line`,
                    priority: 8,
                    name: "CCI Bullish Zero Cross",
                    candle
                });
            } else if (currentCci < 0 && prevCci >= 0) {
                signals.push({
                    type: 'CCI',
                    value: 'Bearish Zero Cross',
                    strength: applyRegimeAdjustment(75, marketRegime, 'cci', 'bearish'),
                    details: `CCI crossed below zero line`,
                    priority: 8,
                    name: "CCI Bearish Zero Cross",
                    candle
                });
            }
            
            // Overbought/Oversold Exits
            if (currentCci < overbought && prevCci >= overbought) {
                signals.push({
                    type: 'CCI',
                    value: 'Overbought Exit',
                    strength: applyRegimeAdjustment(70, marketRegime, 'cci', 'bearish'),
                    details: `CCI exited overbought territory`,
                    priority: 8,
                    name: "CCI Bearish Exit",
                    candle
                });
            } else if (currentCci > oversold && prevCci <= oversold) {
                signals.push({
                    type: 'CCI',
                    value: 'Oversold Exit',
                    strength: applyRegimeAdjustment(70, marketRegime, 'cci', 'bullish'),
                    details: `CCI exited oversold territory`,
                    priority: 8,
                    name: "CCI Bullish Exit",
                    candle
                });
            }
        }
    }

    return signals;
};

export const evaluateRocCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const rocSettings = signalSettings.roc || {};

    if (!indicators.roc || index < 1) {
        return signals;
    }

    const currentRoc = indicators.roc[index];
    const prevRoc = indicators.roc[index - 1];
    const rocThreshold = rocSettings.threshold || 5;

    if (currentRoc === undefined || prevRoc === undefined) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---

    // 1. ROC Level State
    if (currentRoc > rocThreshold) {
        const strength = 45 + Math.min(35, (currentRoc - rocThreshold) * 2);
        signals.push({
            type: 'roc',
            value: 'Strong Upward Momentum',
            strength: strength,
            details: `ROC at ${currentRoc.toFixed(2)}% - strong upward momentum`,
            priority: 7,
            candle
        });
    } else if (currentRoc < -rocThreshold) {
        const strength = 45 + Math.min(35, (Math.abs(currentRoc) - rocThreshold) * 2);
        signals.push({
            type: 'roc',
            value: 'Strong Downward Momentum',
            strength: strength,
            details: `ROC at ${currentRoc.toFixed(2)}% - strong downward momentum`,
            priority: 7,
            candle
        });
    } else if (currentRoc > 0) {
        const strength = 30 + Math.min(20, currentRoc * 3);
        signals.push({
            type: 'roc',
            value: 'Positive Momentum',
            strength: strength,
            details: `ROC at ${currentRoc.toFixed(2)}% - positive momentum`,
            priority: 5,
            candle
        });
    } else if (currentRoc < 0) {
        const strength = 30 + Math.min(20, Math.abs(currentRoc) * 3);
        signals.push({
            type: 'roc',
            value: 'Negative Momentum',
            strength: strength,
            details: `ROC at ${currentRoc.toFixed(2)}% - negative momentum`,
            priority: 5,
            candle
        });
    } else {
        signals.push({
            type: 'roc',
            value: 'Neutral Momentum',
            strength: 20,
            details: `ROC at ${currentRoc.toFixed(2)}% - neutral momentum`,
            priority: 3,
            candle
        });
    }

    // 2. ROC Direction State
    const rocChange = currentRoc - prevRoc;
    if (Math.abs(rocChange) > 1) { // Significant change
        if (rocChange > 0) {
            const strength = 40 + Math.min(25, Math.abs(rocChange) * 5);
            signals.push({
                type: 'roc',
                value: 'Accelerating',
                strength: strength,
                details: `ROC increasing by ${rocChange.toFixed(2)}% - accelerating`,
                priority: 6,
                candle
            });
        } else {
            const strength = 40 + Math.min(25, Math.abs(rocChange) * 5);
            signals.push({
                type: 'roc',
                value: 'Decelerating',
                strength: strength,
                details: `ROC decreasing by ${Math.abs(rocChange).toFixed(2)}% - decelerating`,
                priority: 6,
                candle
            });
        }
    }

    // 3. ROC Extreme State
    if (currentRoc > 20) {
        signals.push({
            type: 'roc',
            value: 'Extreme Bullish Momentum',
            strength: 80,
            details: `ROC at ${currentRoc.toFixed(2)}% - extreme bullish momentum`,
            priority: 8,
            candle
        });
    } else if (currentRoc < -20) {
        signals.push({
            type: 'roc',
            value: 'Extreme Bearish Momentum',
            strength: 80,
            details: `ROC at ${currentRoc.toFixed(2)}% - extreme bearish momentum`,
            priority: 8,
            candle
        });
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve existing event detection for backtesting

    // Zero Line Cross Events
    if (currentRoc > 0 && prevRoc <= 0) {
        signals.push({
            type: 'roc',
            value: 'Bullish Zero Cross',
            strength: 75,
            details: `ROC crossed above zero line`,
            priority: 8,
            candle
        });
    }

    if (currentRoc < 0 && prevRoc >= 0) {
        signals.push({
            type: 'roc',
            value: 'Bearish Zero Cross',
            strength: 75,
            details: `ROC crossed below zero line`,
            priority: 8,
            candle
        });
    }

    // Threshold Break Events
    if (currentRoc > rocThreshold && prevRoc <= rocThreshold) {
        signals.push({
            type: 'roc',
            value: 'Bullish Threshold Break',
            strength: 85,
            details: `ROC broke above ${rocThreshold}% threshold`,
            priority: 9,
            candle
        });
    }

    if (currentRoc < -rocThreshold && prevRoc >= -rocThreshold) {
        signals.push({
            type: 'roc',
            value: 'Bearish Threshold Break',
            strength: 85,
            details: `ROC broke below -${rocThreshold}% threshold`,
            priority: 9,
            candle
        });
    }

    // Momentum Reversal Events
    if (index >= 2) {
        const roc2Ago = indicators.roc[index - 2];
        if (roc2Ago !== undefined) {
            // Peak Momentum Reversal
            if (prevRoc > currentRoc && prevRoc > roc2Ago && prevRoc > 10) {
                signals.push({
                    type: 'roc',
                    value: 'Peak Momentum Reversal',
                    strength: 80,
                    details: `ROC momentum peaked and reversing from high levels`,
                    priority: 9,
                    candle
                });
            }

            // Trough Momentum Reversal
            if (prevRoc < currentRoc && prevRoc < roc2Ago && prevRoc < -10) {
                signals.push({
                    type: 'roc',
                    value: 'Trough Momentum Reversal',
                    strength: 80,
                    details: `ROC momentum troughed and reversing from low levels`,
                    priority: 9,
                    candle
                });
            }
        }
    }

    return signals;
};

export const evaluateAwesomeOscillatorCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const aoSettings = signalSettings.awesomeOscillator || {};

    if (!indicators.awesomeoscillator || index < 2) {
        return signals;
    }

    const currentAo = indicators.awesomeoscillator[index];
    const prevAo = indicators.awesomeoscillator[index - 1];
    const ao2Ago = indicators.awesomeoscillator[index - 2];

    if (currentAo === undefined || prevAo === undefined || ao2Ago === undefined) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---

    // 1. AO Level State
    if (currentAo > 0) {
        const strength = 40 + Math.min(30, Math.abs(currentAo) * 1000);
        signals.push({
            type: 'awesomeOscillator',
            value: 'Bullish Zone',
            strength: strength,
            details: `AO at ${currentAo.toFixed(4)} - above zero line (bullish)`,
            priority: 6,
            candle
        });
    } else {
        const strength = 40 + Math.min(30, Math.abs(currentAo) * 1000);
        signals.push({
            type: 'awesomeOscillator',
            value: 'Bearish Zone',
            strength: strength,
            details: `AO at ${currentAo.toFixed(4)} - below zero line (bearish)`,
            priority: 6,
            candle
        });
    }

    // 2. AO Direction State
    const aoChange = currentAo - prevAo;
    if (Math.abs(aoChange) > 0.001) { // Significant change
        if (aoChange > 0) {
            const strength = 35 + Math.min(25, Math.abs(aoChange) * 5000);
            signals.push({
                type: 'awesomeOscillator',
                value: 'Rising AO',
                strength: strength,
                details: `AO rising - momentum increasing`,
                priority: 5,
                candle
            });
        } else {
            const strength = 35 + Math.min(25, Math.abs(aoChange) * 5000);
            signals.push({
                type: 'awesomeOscillator',
                value: 'Falling AO',
                strength: strength,
                details: `AO falling - momentum decreasing`,
                priority: 5,
                candle
            });
        }
    }

    // 3. AO Momentum State
    const momentum = (currentAo - ao2Ago) / 2; // 2-period momentum
    if (Math.abs(momentum) > 0.002) {
        if (momentum > 0) {
            const strength = 45 + Math.min(25, Math.abs(momentum) * 3000);
            signals.push({
                type: 'awesomeOscillator',
                value: 'Strong Bullish Momentum',
                strength: strength,
                details: `AO showing strong upward momentum`,
                priority: 7,
                candle
            });
        } else {
            const strength = 45 + Math.min(25, Math.abs(momentum) * 3000);
            signals.push({
                type: 'awesomeOscillator',
                value: 'Strong Bearish Momentum',
                strength: strength,
                details: `AO showing strong downward momentum`,
                priority: 7,
                candle
            });
        }
    }

    // 4. AO Color State (based on bar-to-bar changes)
    const isGreen = currentAo > prevAo;
    const wasGreen = prevAo > ao2Ago;
    
    if (isGreen && wasGreen) {
        signals.push({
            type: 'awesomeOscillator',
            value: 'Consecutive Green',
            strength: 50,
            details: `AO showing consecutive green bars - building momentum`,
            priority: 6,
            candle
        });
    } else if (!isGreen && !wasGreen) {
        signals.push({
            type: 'awesomeOscillator',
            value: 'Consecutive Red',
            strength: 50,
            details: `AO showing consecutive red bars - weakening momentum`,
            priority: 6,
            candle
        });
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve existing event detection for backtesting

    // Zero Line Cross Events
    if (currentAo > 0 && prevAo <= 0) {
        signals.push({
            type: 'awesomeOscillator',
            value: 'Bullish Zero Cross',
            strength: 80,
            details: `AO crossed above zero line`,
            priority: 8,
            candle
        });
    }

    if (currentAo < 0 && prevAo >= 0) {
        signals.push({
            type: 'awesomeOscillator',
            value: 'Bearish Zero Cross',
            strength: 80,
            details: `AO crossed below zero line`,
            priority: 8,
            candle
        });
    }

    // Saucer Signal (Twin Peaks)
    if (index >= 4) {
        const ao3Ago = indicators.awesomeoscillator[index - 3];
        const ao4Ago = indicators.awesomeoscillator[index - 4];
        
        if (ao3Ago !== undefined && ao4Ago !== undefined) {
            // Bullish Saucer
            if (currentAo < 0 && prevAo < 0 && ao2Ago < 0 && 
                currentAo > prevAo && prevAo < ao2Ago && ao2Ago < ao3Ago) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bullish Saucer',
                    strength: 85,
                    details: `AO formed bullish saucer pattern`,
                    priority: 9,
                    candle
                });
            }

            // Bearish Saucer
            if (currentAo > 0 && prevAo > 0 && ao2Ago > 0 && 
                currentAo < prevAo && prevAo > ao2Ago && ao2Ago > ao3Ago) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bearish Saucer',
                    strength: 85,
                    details: `AO formed bearish saucer pattern`,
                    priority: 9,
                    candle
                });
            }
        }
    }

    // Twin Peaks Signal
    if (index >= 5) {
        const ao3Ago = indicators.awesomeoscillator[index - 3];
        const ao4Ago = indicators.awesomeoscillator[index - 4];
        const ao5Ago = indicators.awesomeoscillator[index - 5];
        
        if (ao3Ago !== undefined && ao4Ago !== undefined && ao5Ago !== undefined) {
            // Bullish Twin Peaks
            if (currentAo > 0 && ao2Ago > 0 && ao4Ago > 0 && 
                currentAo > ao2Ago && ao2Ago < prevAo && prevAo < ao3Ago && ao3Ago < ao4Ago) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bullish Twin Peaks',
                    strength: 90,
                    details: `AO formed bullish twin peaks pattern`,
                    priority: 9,
                    candle
                });
            }

            // Bearish Twin Peaks
            if (currentAo < 0 && ao2Ago < 0 && ao4Ago < 0 && 
                currentAo < ao2Ago && ao2Ago > prevAo && prevAo > ao3Ago && ao3Ago > ao4Ago) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bearish Twin Peaks',
                    strength: 90,
                    details: `AO formed bearish twin peaks pattern`,
                    priority: 9,
                    candle
                });
            }
        }
    }

    // Divergence Events (simplified)
    if (index >= 10) {
        if (indicators.data[index - 10] && indicators.awesomeoscillator[index - 10] !== undefined) {
            const priceChange = candle.close - indicators.data[index - 10].close;
            const aoChange10 = currentAo - indicators.awesomeoscillator[index - 10];
            
            // Bullish Divergence
            if (priceChange < 0 && aoChange10 > 0.005 && currentAo < 0) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bullish Divergence',
                    strength: 85,
                    details: `Price declining but AO rising - bullish divergence`,
                    priority: 9,
                    candle
                });
            }

            // Bearish Divergence
            if (priceChange > 0 && aoChange10 < -0.005 && currentAo > 0) {
                signals.push({
                    type: 'awesomeOscillator',
                    value: 'Bearish Divergence',
                    strength: 85,
                    details: `Price rising but AO falling - bearish divergence`,
                    priority: 9,
                    candle
                });
            }
        }
    }

    return signals;
};

/**
 * Evaluates Chande Momentum Oscillator (CMO) conditions using a refined, event-driven approach.
 * This logic targets high-conviction events like exits from extreme zones, confirmed zero-line
 * crosses, and validated divergences to significantly reduce noise and improve signal quality.
 * Tier: B
 */
export const evaluateCmoCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const cmoSettings = signalSettings.cmo;
    if (!cmoSettings || !cmoSettings.enabled || index < 1) return signals;

    const cmoData = indicators.cmo;
    const priceData = indicators.data;
    const value = get(cmoData, index);
    const prevValue = get(cmoData, index - 1);

    if (!isNumber(value) || !isNumber(prevValue)) return signals;

    const {
        overbought = 50, // Common default for CMO (-100 to +100 range)
        oversold = -50, // Common default for CMO
        zeroLineConfirmation = 3, // Default lookback for zero cross confirmation
        divergenceLookback = 50 // Default lookback for divergence
    } = cmoSettings;

    // --- State-Based Signals (NEW) ---
    
    // 1. CMO Level State
    if (value > overbought) {
        const strength = 50 + Math.min(30, (value - overbought) / 2);
        signals.push({
            type: 'cmo',
            value: 'Overbought',
            strength: strength,
            isEvent: false,
            details: `CMO at ${value.toFixed(1)} - overbought condition`,
            priority: 7,
            candle
        });
    } else if (value < oversold) {
        const strength = 50 + Math.min(30, (oversold - value) / 2);
        signals.push({
            type: 'cmo',
            value: 'Oversold',
            strength: strength,
            isEvent: false,
            details: `CMO at ${value.toFixed(1)} - oversold condition`,
            priority: 7,
            candle
        });
    } else if (value > 25) {
        const strength = 35 + Math.min(20, (value - 25) / 2);
        signals.push({
            type: 'cmo',
            value: 'Bullish Zone',
            strength: strength,
            isEvent: false,
            details: `CMO at ${value.toFixed(1)} - bullish momentum`,
            priority: 5,
            candle
        });
    } else if (value < -25) {
        const strength = 35 + Math.min(20, (Math.abs(value) - 25) / 2);
        signals.push({
            type: 'cmo',
            value: 'Bearish Zone',
            strength: strength,
            isEvent: false,
            details: `CMO at ${value.toFixed(1)} - bearish momentum`,
            priority: 5,
            candle
        });
    } else {
        signals.push({
            type: 'cmo',
            value: 'Neutral Zone',
            strength: 25,
            isEvent: false,
            details: `CMO at ${value.toFixed(1)} - neutral momentum`,
            priority: 3,
            candle
        });
    }
    
    // 2. CMO Direction State
    const cmoChange = value - prevValue;
    if (Math.abs(cmoChange) > 5) {
        if (cmoChange > 0) {
            const strength = 40 + Math.min(25, Math.abs(cmoChange) * 0.5);
            signals.push({
                type: 'cmo',
                value: 'Rising CMO',
                strength: strength,
                isEvent: false,
                details: `CMO rising by ${cmoChange.toFixed(1)} - momentum increasing`,
                priority: 6,
                candle
            });
        } else {
            const strength = 40 + Math.min(25, Math.abs(cmoChange) * 0.5);
            signals.push({
                type: 'cmo',
                value: 'Falling CMO',
                strength: strength,
                isEvent: false,
                details: `CMO falling by ${Math.abs(cmoChange).toFixed(1)} - momentum decreasing`,
                priority: 6,
                candle
            });
        }
    }

    // --- Event-Based Signals ---

    // 1. Overbought/Oversold Exit Signals (Confirmation of Reversal)
    // Bullish signal: CMO exits the oversold zone, moving up.
    if (value > oversold && prevValue <= oversold) {
        signals.push({
            type: 'cmo', value: 'Oversold Exit',
            details: `CMO crossed above ${oversold}`,
            strength: applyRegimeAdjustment(75, marketRegime, 'cmo', 'bullish'),
            name: "CMO Bullish Exit",
            isEvent: true,
            candle
        });
    }
    // Bearish signal: CMO exits the overbought zone, moving down.
    if (value < overbought && prevValue >= overbought) {
        signals.push({
            type: 'cmo', value: 'Overbought Exit',
            details: `CMO crossed below ${overbought}`,
            strength: applyRegimeAdjustment(75, marketRegime, 'cmo', 'bearish'),
            name: "CMO Bearish Exit",
            isEvent: true,
            candle
        });
    }

    // 2. Confirmed Zero-Line Cross (Shift in Momentum)
    if (index >= zeroLineConfirmation) {
        // Bullish Cross: From negative to positive with confirmation.
        if (value > 0 && prevValue <= 0) {
            const historySlice = cmoData.slice(Math.max(0, index - zeroLineConfirmation), index);
            const wasConsistentlyNegative = historySlice.every(v => isNumber(v) && v <= 0);
            if (wasConsistentlyNegative) {
                signals.push({
                    type: 'cmo', value: 'Zero-Line Cross Bullish',
                    details: 'Confirmed cross above zero from negative territory.',
                    strength: applyRegimeAdjustment(70, marketRegime, 'cmo', 'bullish'),
                    name: "CMO Zero-Line Cross Bullish",
                    candle
                });
            }
        }
        // Bearish Cross: From positive to negative with confirmation.
        if (value < 0 && prevValue >= 0) {
            const historySlice = cmoData.slice(Math.max(0, index - zeroLineConfirmation), index);
            const wasConsistentlyPositive = historySlice.every(v => isNumber(v) && v >= 0);
            if (wasConsistentlyPositive) {
                signals.push({
                    type: 'cmo', value: 'Zero-Line Cross Bearish',
                    details: 'Confirmed cross below zero from positive territory.',
                    strength: applyRegimeAdjustment(70, marketRegime, 'cmo', 'bearish'),
                    name: "CMO Zero-Line Cross Bearish",
                    candle
                });
            }
        }
    }

    // 3. Validated Divergence (Highest Conviction Signal)
    if (index >= divergenceLookback && priceData.length > index && cmoData.length > index) {
        const divergence = findDivergence(priceData, cmoData, index, divergenceLookback);

        // Bullish Divergence: Must be confirmed by the CMO being in oversold territory (with a small buffer).
        if (divergence.type === 'bullish' && value < oversold + 10) { // Add a small buffer for the zone
            signals.push({
                type: 'cmo', value: 'Bullish Divergence',
                details: `Bullish divergence detected over ${divergenceLookback} periods while CMO is oversold.`,
                strength: applyRegimeAdjustment(90, marketRegime, 'cmo', 'bullish'),
                name: "CMO Bullish Divergence",
                candle
            });
        }

        // Bearish Divergence: Must be confirmed by the CMO being in overbought territory (with a small buffer).
        if (divergence.type === 'bearish' && value > overbought - 10) { // Add a small buffer for the zone
            signals.push({
                type: 'cmo', value: 'Bearish Divergence',
                details: `Bearish divergence detected over ${divergenceLookback} periods while CMO is overbought.`,
                strength: applyRegimeAdjustment(90, marketRegime, 'cmo', 'bearish'),
                name: "CMO Bearish Divergence",
                candle
            });
        }
    }

    return signals;
};

/**
 * Tier: B
 */
export const evaluateMfiCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const mfiSettings = signalSettings.mfi || {};

    if (!indicators.mfi || indicators.mfi.length <= index || index < 1) {
        return signals;
    }

    const currentMfi = indicators.mfi[index];
    const prevMfi = indicators.mfi[index - 1];
    const overbought = mfiSettings.overbought || 80;
    const oversold = mfiSettings.oversold || 20;

    if (!isNumber(currentMfi) || !isNumber(prevMfi)) {
        return signals;
    }

    // Event: Entry into oversold zone
    if (prevMfi > oversold && currentMfi <= oversold) {
        signals.push({
            type: 'mfi',
            value: 'MFI Oversold Entry',
            strength: 75,
            isEvent: true,
            details: `MFI entered oversold zone: ${currentMfi.toFixed(2)}`,
            priority: 8,
            candle
        });
    }

    // Event: Exit from oversold zone
    if (prevMfi <= oversold && currentMfi > oversold) {
        signals.push({
            type: 'mfi',
            value: 'MFI Oversold Exit',
            strength: 70,
            isEvent: true,
            details: `MFI exited oversold zone: ${currentMfi.toFixed(2)}`,
            priority: 7,
            candle
        });
    }

    // Event: Entry into overbought zone
    if (prevMfi < overbought && currentMfi >= overbought) {
        signals.push({
            type: 'mfi',
            value: 'MFI Overbought Entry',
            strength: 75,
            isEvent: true,
            details: `MFI entered overbought zone: ${currentMfi.toFixed(2)}`,
            priority: 8,
            candle
        });
    }

    // Event: Exit from overbought zone
    if (prevMfi >= overbought && currentMfi < overbought) {
        signals.push({
            type: 'mfi',
            value: 'MFI Overbought Exit',
            strength: 70,
            isEvent: true,
            details: `MFI exited overbought zone: ${currentMfi.toFixed(2)}`,
            priority: 7,
            candle
        });
    }

    // --- State-Based Signals (for strategies requiring state conditions) ---
    
    // "MFI Oversold Exit" - State signal: MFI is currently above oversold (indicating recovery)
    if (currentMfi > oversold) {
        const distanceFromOversold = currentMfi - oversold;
        const strength = 60 + Math.min(15, (distanceFromOversold / (100 - oversold)) * 30);
        signals.push({
            type: 'mfi',
            value: 'MFI Oversold Exit',
            strength: strength,
            isEvent: false,
            details: `MFI (${currentMfi.toFixed(2)}) is above oversold zone (${oversold}), indicating recovery`,
            priority: 6,
            candle
        });
    }
    
    // "MFI Oversold Entry" - State signal: MFI is currently in oversold zone
    if (currentMfi <= oversold) {
        const depthInOversold = oversold - currentMfi;
        const strength = 60 + Math.min(15, (depthInOversold / oversold) * 30);
        signals.push({
            type: 'mfi',
            value: 'MFI Oversold Entry',
            strength: strength,
            isEvent: false,
            details: `MFI (${currentMfi.toFixed(2)}) is in oversold zone (<=${oversold})`,
            priority: 6,
            candle
        });
    }
    
    // "MFI Overbought Exit" - State signal: MFI is currently below overbought (indicating pullback)
    if (currentMfi < overbought) {
        const distanceFromOverbought = overbought - currentMfi;
        const strength = 60 + Math.min(15, (distanceFromOverbought / (100 - overbought)) * 30);
        signals.push({
            type: 'mfi',
            value: 'MFI Overbought Exit',
            strength: strength,
            isEvent: false,
            details: `MFI (${currentMfi.toFixed(2)}) is below overbought zone (${overbought}), indicating pullback`,
            priority: 6,
            candle
        });
    }
    
    // "MFI Overbought Entry" - State signal: MFI is currently in overbought zone
    if (currentMfi >= overbought) {
        const depthInOverbought = currentMfi - overbought;
        const strength = 60 + Math.min(15, (depthInOverbought / (100 - overbought)) * 30);
        signals.push({
            type: 'mfi',
            value: 'MFI Overbought Entry',
            strength: strength,
            isEvent: false,
            details: `MFI (${currentMfi.toFixed(2)}) is in overbought zone (>=${overbought})`,
            priority: 6,
            candle
        });
    }

    // ✅ Phase 1: MFI Advanced Divergence Detection
    try {
        if (debugMode && onLog) {
            //onLog(`[MFI_DIVERGENCE] Starting detection at index ${index}`, 'debug');
            //onLog(`[MFI_DIVERGENCE] Conditions check: index>=50=${index >= 50}, hasData=${!!indicators.data}, hasMFI=${!!indicators.mfi}`, 'debug');
        }
        
        if (index >= 50 && indicators.data && indicators.mfi) {
            // Extract MFI data (filter out nulls/undefined)
            const mfiRaw = indicators.mfi.slice(0, index + 1);
            const mfiValidIndices = [];
            const mfiData = [];
            
            // Find valid MFI values and their corresponding indices
            for (let i = 0; i < mfiRaw.length; i++) {
                if (isNumber(mfiRaw[i])) {
                    mfiValidIndices.push(i);
                    mfiData.push(mfiRaw[i]);
                }
            }
            
            // Align price data to match MFI data (use only indices where MFI is valid)
            const priceData = mfiValidIndices.map(i => {
                const candle = indicators.data[i];
                return candle ? candle.close : null;
            }).filter(v => v !== null);
            
            // Adjust currentIndex to relative position in aligned arrays
            const mfiDataLength = mfiData.length;
            const alignedIndex = mfiDataLength - 1; // Current index in aligned arrays
            
            if (debugMode && onLog) {
                //onLog(`[MFI_DIVERGENCE] Data alignment: originalIndex=${index}, mfiRaw.length=${mfiRaw.length}, validIndices=${mfiValidIndices.length}, priceData.length=${priceData.length}, mfiData.length=${mfiData.length}, alignedIndex=${alignedIndex}`, 'debug');
                if (priceData.length > 0 && mfiData.length > 0) {
                    //onLog(`[MFI_DIVERGENCE] Sample data: last 3 prices=${priceData.slice(-3).map(p => p.toFixed(2)).join(', ')}, last 3 MFI=${mfiData.slice(-3).map(m => m.toFixed(2)).join(', ')}`, 'debug');
                }
            }
            
            if (priceData.length >= 50 && mfiData.length >= 50 && mfiData.length === priceData.length && alignedIndex >= 50) {
                const divergence = detectAdvancedDivergence(
                    priceData,
                    mfiData,
                    alignedIndex,
                    {
                        lookbackPeriod: 50,
                        minPeakDistance: 5,
                        maxPeakDistance: 60,
                        pivotLookback: 5,
                        minPriceMove: 0.02,
                        minOscillatorMove: 5, // MFI uses 0-100 range
                        debugMode: debugMode,
                        onLog: onLog
                    }
                );
                
                if (debugMode && onLog) {
                    //onLog(`[MFI_DIVERGENCE] detectAdvancedDivergence result: ${divergence ? JSON.stringify({ type: divergence.type, strength: divergence.strength }) : 'null'}`, 'debug');
                }
                
                if (divergence) {
                    // Map divergence type to canonical signal value
                    // Note: detectAdvancedDivergence returns type like "Regular Bullish Divergence" (with spaces)
                    let signalValue = '';
                    if (divergence.type === 'Regular Bullish Divergence' || divergence.type?.includes('Regular Bullish')) {
                        signalValue = 'MFI Regular Bullish Divergence';
                    } else if (divergence.type === 'Regular Bearish Divergence' || divergence.type?.includes('Regular Bearish')) {
                        signalValue = 'MFI Regular Bearish Divergence';
                    } else if (divergence.type === 'Hidden Bullish Divergence' || divergence.type?.includes('Hidden Bullish')) {
                        signalValue = 'MFI Hidden Bullish Divergence';
                    } else if (divergence.type === 'Hidden Bearish Divergence' || divergence.type?.includes('Hidden Bearish')) {
                        signalValue = 'MFI Hidden Bearish Divergence';
                    }
                    
                    if (debugMode && onLog && !signalValue) {
                        //onLog(`[MFI_DIVERGENCE] ⚠️ Divergence found but no signalValue mapped. Divergence.type="${divergence.type}"`, 'warning');
                    }
                    
                    if (signalValue) {
                        if (debugMode && onLog) {
                            //onLog(`[MFI_DIVERGENCE] ✅ Adding signal: ${signalValue}`, 'debug');
                        }
                        signals.push({
                            type: 'MFI',
                            value: signalValue,
                            strength: Math.min(100, divergence.strength + 5),
                            details: divergence.description || `MFI ${divergence.type} divergence detected`,
                            priority: 10,
                            isEvent: true,
                            candle: index
                        });
                    }
                } else if (debugMode && onLog) {
                    //onLog(`[MFI_DIVERGENCE] ❌ No divergence detected`, 'debug');
                }
            } else if (debugMode && onLog) {
                //onLog(`[MFI_DIVERGENCE] ❌ Data length check failed: priceData.length=${priceData.length}, mfiData.length=${mfiData.length}, lengthsMatch=${mfiData.length === priceData.length}`, 'debug');
            }
        } else if (debugMode && onLog) {
            //onLog(`[MFI_DIVERGENCE] ❌ Initial conditions failed: index>=50=${index >= 50}, hasData=${!!indicators.data}, hasMFI=${!!indicators.mfi}`, 'debug');
        }
    } catch (error) {
        if (debugMode && onLog) {
            //onLog(`[MFI_DIVERGENCE] ❌ Error: ${error.message}`, 'warning');
            //onLog(`[MFI_DIVERGENCE] ❌ Stack: ${error.stack}`, 'warning');
        }
    }

    // ✅ Phase 1: MFI Failure Swing Detection
    try {
        if (debugMode && onLog) {
            //onLog(`[MFI_FAILURE_SWING] Starting detection at index ${index}`, 'debug');
        }
        
        if (index >= 20 && indicators.mfi) {
            const mfiHistory = indicators.mfi.slice(Math.max(0, index - 20), index + 1);
            const validMfi = mfiHistory.filter(v => isNumber(v) && v >= 0 && v <= 100);
            
            if (debugMode && onLog) {
                //onLog(`[MFI_FAILURE_SWING] Data check: index=${index}, mfiHistory.length=${mfiHistory.length}, validMfi.length=${validMfi.length}, oversold=${oversold}, overbought=${overbought}`, 'debug');
                if (validMfi.length > 0) {
                    //onLog(`[MFI_FAILURE_SWING] Recent MFI values: ${validMfi.slice(-5).map(v => v.toFixed(2)).join(', ')}`, 'debug');
                }
            }
            
            if (validMfi.length >= 10) {
                // Bullish Failure Swing: MFI falls below 20, then rises above 20, but doesn't exceed 80, then falls below 20 again
                // Bearish Failure Swing: MFI rises above 80, then falls below 80, but doesn't go below 20, then rises above 80 again
                
                // Find oversold/overbought zones
                let oversoldEntry = -1;
                let oversoldExit = -1;
                let overboughtEntry = -1;
                let overboughtExit = -1;
                
                const oversoldThreshold = oversold; // Use from settings
                const overboughtThreshold = overbought; // Use from settings
                
                if (debugMode && onLog) {
                    //onLog(`[MFI_FAILURE_SWING] Thresholds: oversold=${oversoldThreshold}, overbought=${overboughtThreshold}`, 'debug');
                }
                
                for (let i = 1; i < validMfi.length; i++) {
                    // Oversold entry
                    if (validMfi[i-1] > oversoldThreshold && validMfi[i] <= oversoldThreshold && oversoldEntry === -1) {
                        oversoldEntry = i;
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] Oversold entry at i=${i}: ${validMfi[i-1].toFixed(2)} → ${validMfi[i].toFixed(2)}`, 'debug');
                        }
                    }
                    // Oversold exit
                    if (validMfi[i-1] <= oversoldThreshold && validMfi[i] > oversoldThreshold && oversoldEntry !== -1 && oversoldExit === -1) {
                        oversoldExit = i;
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] Oversold exit at i=${i}: ${validMfi[i-1].toFixed(2)} → ${validMfi[i].toFixed(2)}`, 'debug');
                        }
                    }
                    // Overbought entry
                    if (validMfi[i-1] < overboughtThreshold && validMfi[i] >= overboughtThreshold && overboughtEntry === -1) {
                        overboughtEntry = i;
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] Overbought entry at i=${i}: ${validMfi[i-1].toFixed(2)} → ${validMfi[i].toFixed(2)}`, 'debug');
                        }
                    }
                    // Overbought exit
                    if (validMfi[i-1] >= overboughtThreshold && validMfi[i] < overboughtThreshold && overboughtEntry !== -1 && overboughtExit === -1) {
                        overboughtExit = i;
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] Overbought exit at i=${i}: ${validMfi[i-1].toFixed(2)} → ${validMfi[i].toFixed(2)}`, 'debug');
                        }
                    }
                }
                
                if (debugMode && onLog) {
                    //onLog(`[MFI_FAILURE_SWING] Zone analysis: oversoldEntry=${oversoldEntry}, oversoldExit=${oversoldExit}, overboughtEntry=${overboughtEntry}, overboughtExit=${overboughtExit}`, 'debug');
                }
                
                // Bullish Failure Swing: Oversold -> Exit -> Stay below 80 -> Oversold again
                if (oversoldEntry !== -1 && oversoldExit !== -1 && oversoldExit < validMfi.length - 2) {
                    const afterExit = validMfi.slice(oversoldExit);
                    const maxAfterExit = Math.max(...afterExit);
                    
                    if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] Bullish check: oversoldEntry=${oversoldEntry}, oversoldExit=${oversoldExit}, maxAfterExit=${maxAfterExit.toFixed(2)}, overboughtThreshold=${overboughtThreshold}`, 'debug');
                    }
                    
                    // Check if there's a second oversold entry after the exit
                    let secondOversold = -1;
                    for (let i = oversoldExit + 1; i < validMfi.length; i++) {
                        if (validMfi[i-1] > oversoldThreshold && validMfi[i] <= oversoldThreshold) {
                            secondOversold = i;
                            break;
                        }
                    }
                    
                    if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] Bullish check: secondOversold=${secondOversold !== -1 ? secondOversold : 'not found'}, maxAfterExit < overboughtThreshold? ${maxAfterExit < overboughtThreshold}`, 'debug');
                    }
                    
                    if (secondOversold !== -1 && maxAfterExit < overboughtThreshold) {
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] ✅ Bullish Failure Swing detected!`, 'debug');
                        }
                        signals.push({
                            type: 'MFI',
                            value: 'MFI Failure Swing Bullish',
                            strength: 85,
                            details: 'MFI bullish failure swing detected (oversold -> exit -> second oversold without reaching overbought)',
                            priority: 10,
                            isEvent: true,
                            candle: index
                        });
                    } else if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] ❌ Bullish Failure Swing not detected: secondOversold=${secondOversold !== -1 ? 'found' : 'not found'}, maxAfterExit=${maxAfterExit.toFixed(2)} >= ${overboughtThreshold}? ${maxAfterExit >= overboughtThreshold}`, 'debug');
                    }
                } else if (debugMode && onLog) {
                    //onLog(`[MFI_FAILURE_SWING] ❌ Bullish Failure Swing conditions not met: oversoldEntry=${oversoldEntry !== -1}, oversoldExit=${oversoldExit !== -1}, oversoldExit < validMfi.length-2? ${oversoldExit !== -1 && oversoldExit < validMfi.length - 2}`, 'debug');
                }
                
                // Bearish Failure Swing: Overbought -> Exit -> Stay above 20 -> Overbought again
                if (overboughtEntry !== -1 && overboughtExit !== -1 && overboughtExit < validMfi.length - 2) {
                    const afterExit = validMfi.slice(overboughtExit);
                    const minAfterExit = Math.min(...afterExit);
                    
                    if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] Bearish check: overboughtEntry=${overboughtEntry}, overboughtExit=${overboughtExit}, minAfterExit=${minAfterExit.toFixed(2)}, oversoldThreshold=${oversoldThreshold}`, 'debug');
                    }
                    
                    // Check if there's a second overbought entry after the exit
                    let secondOverbought = -1;
                    for (let i = overboughtExit + 1; i < validMfi.length; i++) {
                        if (validMfi[i-1] < overboughtThreshold && validMfi[i] >= overboughtThreshold) {
                            secondOverbought = i;
                            break;
                        }
                    }
                    
                    if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] Bearish check: secondOverbought=${secondOverbought !== -1 ? secondOverbought : 'not found'}, minAfterExit > oversoldThreshold? ${minAfterExit > oversoldThreshold}`, 'debug');
                    }
                    
                    if (secondOverbought !== -1 && minAfterExit > oversoldThreshold) {
                        if (debugMode && onLog) {
                            //onLog(`[MFI_FAILURE_SWING] ✅ Bearish Failure Swing detected!`, 'debug');
                        }
                        signals.push({
                            type: 'MFI',
                            value: 'MFI Failure Swing Bearish',
                            strength: 85,
                            details: 'MFI bearish failure swing detected (overbought -> exit -> second overbought without reaching oversold)',
                            priority: 10,
                            isEvent: true,
                            candle: index
                        });
                    } else if (debugMode && onLog) {
                        //onLog(`[MFI_FAILURE_SWING] ❌ Bearish Failure Swing not detected: secondOverbought=${secondOverbought !== -1 ? 'found' : 'not found'}, minAfterExit=${minAfterExit.toFixed(2)} <= ${oversoldThreshold}? ${minAfterExit <= oversoldThreshold}`, 'debug');
                    }
                } else if (debugMode && onLog) {
                    //onLog(`[MFI_FAILURE_SWING] ❌ Bearish Failure Swing conditions not met: overboughtEntry=${overboughtEntry !== -1}, overboughtExit=${overboughtExit !== -1}, overboughtExit < validMfi.length-2? ${overboughtExit !== -1 && overboughtExit < validMfi.length - 2}`, 'debug');
                }
            }
        }
    } catch (error) {
        if (debugMode && onLog) {
            //onLog(`[MFI_FAILURE_SWING] ❌ Error: ${error.message}`, 'warning');
            //onLog(`[MFI_FAILURE_SWING] ❌ Stack: ${error.stack}`, 'warning');
        }
    }

    return signals.map(s => ({ ...s, type: 'MFI', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};
