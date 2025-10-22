
import { get, isNil, mean, min, max, std } from 'lodash';
import { applyRegimeAdjustment } from './divergenceUtils';

// Define default signal settings. This object is used to provide default values for signal parameters
// if they are not explicitly provided in the signalSettings object passed to evaluation functions.
const defaultSignalSettings = {
    bbw: {
        threshold: 2.0, // BBW threshold as percentage (2% is a reasonable squeeze threshold)
        period: 20 // Default period for Bollinger Bands Width calculation (if applicable for BBW itself)
    },
    // Other indicators might have their own default settings here.
};

/**
 * A generalized function to detect bullish and bearish divergences between price and any volatility indicator.
 * @param {object} params - The parameters for divergence detection.
 * @param {Array<object>} params.priceData - Array of candle objects {high, low, close}.
 * @param {Array<number>} params.indicatorData - Array of corresponding indicator values.
 * @param {number} params.currentIndex - The current index in the data array.
 * @param {string} params.indicatorName - The name of the indicator for signal details (e.g., 'ATR', 'BBW').
 * @param {object} [params.settings={}] - Configuration for the divergence check.
 * @param {number} [params.settings.lookback=30] - How many periods to look back.
 * @param {number} [params.settings.peakThreshold=3] - How many bars on each side to confirm a peak/trough.
 * @returns {Array<object>} - An array of divergence signal objects.
 */
const detectVolatilityDivergence = ({
    priceData,
    indicatorData,
    currentIndex,
    indicatorName,
    settings = {}
}) => {
    const lookback = settings.lookback || 30;
    const peakThreshold = settings.peakThreshold || 3;
    if (currentIndex < lookback) return [];

    const signals = [];
    // Ensure slices are within bounds and contain enough data for peak/trough detection
    const startIdx = Math.max(0, currentIndex - lookback);
    const endIdx = currentIndex + 1;

    const priceSlice = priceData.slice(startIdx, endIdx);
    const indicatorSlice = indicatorData.slice(startIdx, endIdx);

    // Adjust current index relative to the slice
    const relativeCurrentIndex = currentIndex - startIdx;


    // Helper to find peaks (local maxima)
    const findPeaks = (data) => {
        const peaks = [];
        for (let i = peakThreshold; i < data.length - peakThreshold; i++) {
            const isPeak = data.slice(i - peakThreshold, i).every(v => v < data[i]) &&
                         data.slice(i + 1, i + 1 + peakThreshold).every(v => v < data[i]);
            if (isPeak) peaks.push({ index: i, value: data[i] });
        }
        return peaks;
    };

    // Helper to find troughs (local minima)
    const findTroughs = (data) => {
        const troughs = [];
        for (let i = peakThreshold; i < data.length - peakThreshold; i++) {
            const isTrough = data.slice(i - peakThreshold, i).every(v => v > data[i]) &&
                           data.slice(i + 1, i + 1 + peakThreshold).every(v => v > data[i]);
            if (isTrough) troughs.push({ index: i, value: data[i] });
        }
        return troughs;
    };

    const priceHighs = findPeaks(priceSlice.map(p => p.high));
    const priceLows = findTroughs(priceSlice.map(p => p.low));
    const indicatorHighs = findPeaks(indicatorSlice);
    const indicatorLows = findTroughs(indicatorSlice);

    // Bearish Divergence: Higher High in Price, Lower High in Indicator
    // We only care about divergences ending at or very near the current index
    const relevantPriceHighs = priceHighs.filter(p => p.index >= relativeCurrentIndex - 5 && p.index <= relativeCurrentIndex);
    const relevantIndicatorHighs = indicatorHighs.filter(p => p.index >= relativeCurrentIndex - 5 && p.index <= relativeCurrentIndex);

    if (relevantPriceHighs.length >= 2 && relevantIndicatorHighs.length >= 2) {
        const lastPriceHigh = relevantPriceHighs[relevantPriceHighs.length - 1];
        const prevPriceHigh = relevantPriceHighs[relevantPriceHighs.length - 2];
        
        // Find indicator highs that align with price highs' indices
        const lastIndicatorHigh = relevantIndicatorHighs.find(p => p.index === lastPriceHigh.index);
        const prevIndicatorHigh = relevantIndicatorHighs.find(p => p.index === prevPriceHigh.index);

        if (lastIndicatorHigh && prevIndicatorHigh &&
            lastPriceHigh.value > prevPriceHigh.value && // Price made a higher high
            lastIndicatorHigh.value < prevIndicatorHigh.value) { // Indicator made a lower high
            signals.push({
                value: `Bearish ${indicatorName} Divergence`,
                strength: 90,
                details: `Price made a higher high while ${indicatorName} made a lower high.`
            });
        }
    }

    // Bullish Divergence: Lower Low in Price, Higher Low in Indicator
    const relevantPriceLows = priceLows.filter(p => p.index >= relativeCurrentIndex - 5 && p.index <= relativeCurrentIndex);
    const relevantIndicatorLows = indicatorLows.filter(p => p.index >= relativeCurrentIndex - 5 && p.index <= relativeCurrentIndex);

    if (relevantPriceLows.length >= 2 && relevantIndicatorLows.length >= 2) {
        const lastPriceLow = relevantPriceLows[relevantPriceLows.length - 1];
        const prevPriceLow = relevantPriceLows[relevantPriceLows.length - 2];

        // Find indicator lows that align with price lows' indices
        const lastIndicatorLow = relevantIndicatorLows.find(t => t.index === lastPriceLow.index);
        const prevIndicatorLow = relevantIndicatorLows.find(t => t.index === prevPriceLow.index);

        if (lastIndicatorLow && prevIndicatorLow &&
            lastPriceLow.value < prevPriceLow.value && // Price made a lower low
            lastIndicatorLow.value > prevIndicatorLow.value) { // Indicator made a higher low
            signals.push({
                value: `Bullish ${indicatorName} Divergence`,
                strength: 90,
                details: `Price made a lower low while ${indicatorName} made a higher low.`
            });
        }
    }

    return signals;
};


/**
 * Helper function to detect Bollinger Band squeeze.
 * A squeeze is indicated when the BBW is at a low point relative to its recent history.
 * @param {Array<number>} bbwData - Array of Bollinger Band Width values.
 * @param {number} currentIndex - The current index in the data array.
 * @param {number} lookbackPeriod - The number of periods to look back for comparison.
 * @param {number} [squeezeThresholdPercentile=10] - The percentile threshold to consider a squeeze.
 * @returns {boolean} - True if a squeeze is detected, false otherwise.
 */
const isSqueeze = (bbwData, currentIndex, lookbackPeriod = 50, squeezeThresholdPercentile = 10) => {
    if (!bbwData || !Array.isArray(bbwData) || currentIndex < lookbackPeriod) return false;

    const currentBBW = bbwData[currentIndex];
    if (typeof currentBBW !== 'number' || isNaN(currentBBW)) return false;

    // Get historical BBW data for percentile calculation
    const historySlice = bbwData.slice(Math.max(0, currentIndex - lookbackPeriod), currentIndex);
    const filteredHistory = historySlice.filter(v => typeof v === 'number' && !isNaN(v));

    if (filteredHistory.length < lookbackPeriod * 0.8) return false; // Not enough data

    const sortedHistory = [...filteredHistory].sort((a, b) => a - b);
    const position = sortedHistory.findIndex(v => v >= currentBBW);

    if (position === -1) { // Current BBW is greater than all historical values in the slice
        return false;
    }

    const percentile = (position / (sortedHistory.length - 1)) * 100;
    return percentile < squeezeThresholdPercentile;
};


/**
 * Detects if the price is "walking" along a Bollinger Band (sustained trend).
 * @param {Array} data - Historical price data.
 * @param {Array} bollinger - Bollinger Bands data.
 * @param {number} currentIndex - Current index.
 * @param {object} settings - Bollinger settings.
 * @returns {object|null} - Signal object if band walk is detected, null otherwise.
 */
const detectBandWalk = (data, bollinger, currentIndex, settings = {}) => {
    const walkPeriod = settings.walkPeriod || 5;
    if (currentIndex < walkPeriod - 1 || !data || !bollinger) return null;

    let upperWalkCount = 0;
    let lowerWalkCount = 0;

    for (let i = 0; i < walkPeriod; i++) {
        const index = currentIndex - i;
        const candle = data[index];
        const bb = bollinger[index];

        if (!candle || !bb) continue;

        // Check if close is at or above middle band and at or below upper band (with small buffer)
        if (candle.close >= bb.middle && candle.close <= bb.upper * 1.005) { // 0.5% buffer
            upperWalkCount++;
        }

        // Check if close is at or below middle band and at or above lower band (with small buffer)
        if (candle.close <= bb.middle && candle.close >= bb.lower * 0.995) { // 0.5% buffer
            lowerWalkCount++;
        }
    }

    // Require a significant majority of periods to be 'walking'
    const requiredWalks = Math.floor(walkPeriod * 0.8);

    if (upperWalkCount >= requiredWalks) {
        return { value: 'Band Walk Up', strength: 80, details: `Sustained upward trend over ${walkPeriod} periods` };
    }

    if (lowerWalkCount >= requiredWalks) {
        return { value: 'Band Walk Down', strength: 80, details: `Sustained downward trend over ${walkPeriod} periods` };
    }

    return null;
};

/**
 * Helper to check for volume confirmation during breakouts.
 * @param {object} candle - The current candle.
 * @param {object} indicators - All indicators.
 * @param {number} currentIndex - The current index.
 * @param {object} settings - Signal settings.
 * @returns {boolean} - True if volume confirmation is met, false otherwise.
 */
const hasVolumeConfirmation = (candle, indicators, currentIndex, settings) => {
    const volume = get(candle, 'volume');
    const volumeSMA = get(indicators, `volumeSMA[${currentIndex}]`);
    if (isNil(volume) || isNil(volumeSMA)) return false;
    return volume > volumeSMA * (settings.volumeMultiplier || 1.5);
};

export const evaluateBollingerCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const bbSettings = signalSettings.bollinger || {};
    const bbArray = indicators.bollinger;
    const bbwArray = indicators.bbw;

    const lookback = bbSettings.bandWalkLookback || 5; // Define lookback early for the initial check

    if (!bbArray || !bbArray[index] || !bbwArray || bbwArray[index] === undefined || index < lookback) {
        return [];
    }

    // These are kept as they might be useful for other potential events,
    // though not directly used in the current band walk logic as updated.
    const { upper, middle, lower } = bbArray[index];
    const currentPrice = candle.close;
    const bbw = bbwArray[index];

    // --- State-Based Signals (REMOVED FOR ACCURATE COUNTING) ---
    // The logic that always returned a signal on every candle has been removed
    // to fix the inflated occurrence counts. Only specific events are now reported.

    // --- Event-Based Signals ---

    // Event: Bollinger Band Walk
    const bandWalkTouches = bbSettings.bandWalkTouches || 3;
    let touchesUpper = 0;
    let touchesLower = 0;

    for (let i = 0; i < lookback; i++) {
        const pastIndex = index - i;
        const pastCandle = indicators.data[pastIndex];
        const pastBB = indicators.bollinger[pastIndex];

        // Ensure valid data for past candles and BB
        if (!pastCandle || isNil(pastCandle.close) || !pastBB || isNil(pastBB.upper) || isNil(pastBB.lower)) {
            continue;
        }

        const pastPrice = pastCandle.close;
        const pastUpper = pastBB.upper;
        const pastLower = pastBB.lower;

        // Check if close is at or above the upper band (no buffer)
        if (pastPrice >= pastUpper) {
            touchesUpper++;
        }
        // Check if close is at or below the lower band (no buffer)
        if (pastPrice <= pastLower) {
            touchesLower++;
        }
    }

    if (touchesUpper >= bandWalkTouches) {
        const strength = 60 + Math.min(40, (touchesUpper / lookback) * 40);
        signals.push({
            type: 'bollinger',
            value: 'Upper Band Walk',
            strength: strength,
            isEvent: true,
            details: `Price walking upper Bollinger Band for ${touchesUpper} of last ${lookback} candles.`,
            priority: 7
        });
    }

    if (touchesLower >= bandWalkTouches) {
        const strength = 60 + Math.min(40, (touchesLower / lookback) * 40);
        signals.push({
            type: 'bollinger',
            value: 'Lower Band Walk',
            strength: strength,
            isEvent: true,
            details: `Price walking lower Bollinger Band for ${touchesLower} of last ${lookback} candles.`,
            priority: 7
        });
    }

    // Final processing to ensure no duplicate signal values are returned from this function
    const finalSignals = [];
    const seen = new Set();
    signals.forEach(signal => {
        if (!seen.has(signal.value)) {
            seen.add(signal.value);
            finalSignals.push({ ...signal, candle: index }); // 'type' is already included in pushed signals
        }
    });

    return finalSignals;
};

/**
 * Tier: B
 */
export const evaluateAtrCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const atrSettings = signalSettings.atr || {};
    
    if (!indicators.atr || !indicators.atrSma || !indicators.atr[index] || !indicators.atrSma[index] || index < 1) {
        return signals;
    }
    
    const currentAtr = indicators.atr[index];
    const atrSma = indicators.atrSma[index];
    const prevAtr = indicators.atr[index - 1];
    const prevAtrSma = indicators.atrSma[index - 1];
    const multiplier = atrSettings.multiplier || 1.5;
    
    // Event: ATR spike (high volatility)
    if (currentAtr > atrSma * multiplier && prevAtr <= prevAtrSma * multiplier) {
        signals.push({
            type: 'atr',
            value: 'High Volatility',
            strength: 75,
            isEvent: true,
            details: `ATR spiked to ${currentAtr.toFixed(4)} (${(currentAtr/atrSma).toFixed(1)}x average)`,
            priority: 7
        });
    }
    
    // Event: ATR compression (low volatility)
    if (currentAtr < atrSma * 0.7 && prevAtr >= prevAtrSma * 0.7) {
        signals.push({
            type: 'atr',
            value: 'Low Volatility',
            strength: 65,
            isEvent: true,
            details: `ATR compressed to ${currentAtr.toFixed(4)} (${(currentAtr/atrSma).toFixed(1)}x average)`,
            priority: 6
        });
    }
    
    return signals;
};


/**
 * Tier: B
 */
export function evaluateBbwCondition(candle, indicators, index, signalSettings, marketRegime, onLog = () => {}) {
    const signals = [];
    const settings = { ...defaultSignalSettings.bbw, ...signalSettings.bbw };

    const currentBbw = indicators.bbw?.[index];
    const prevBbw = indicators.bbw?.[index - 1];

    if (currentBbw === undefined || prevBbw === undefined) {
        return signals; // Not enough data, skip silently.
    }

    // Squeeze Start Condition: A transition from above the threshold to below it.
    const isSqueezeStart = currentBbw < settings.threshold && prevBbw >= settings.threshold;
    if (isSqueezeStart) {
        const strength = 75;
        signals.push({ type: 'bbw', value: `squeeze_start`, strength: strength, isEvent: true });
    }

    // Squeeze Release Condition: A transition from below the threshold to above it.
    const isSqueezeRelease = currentBbw > settings.threshold && prevBbw <= settings.threshold;
    if (isSqueezeRelease) {
        const strength = 80;
        signals.push({ type: 'bbw', value: 'squeeze_release', strength: strength, isEvent: true });
    }
    
    // In Squeeze State: The current value is below the threshold.
    const isInSqueeze = currentBbw < settings.threshold;
    if (isInSqueeze) {
        signals.push({ type: 'bbw', value: 'in_squeeze', strength: 60, isEvent: false });
    }
    
    return signals;
}

// --- Keltner Channel (KC) Helper Functions ---
const getUniqueSignals = (signals) => {
    const seen = new Set();
    return signals.filter(s => {
        if (!s || !s.value) return false;
        const key = `${s.value}|${s.details || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/**
 * Tier: B
 */
export const evaluateKeltnerCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const keltnerSettings = signalSettings.keltner || {};
    
    if (!indicators.keltner || !indicators.keltner[index] || index < 1) {
        return signals;
    }
    
    const currentKeltner = indicators.keltner[index];
    const prevKeltner = indicators.keltner[index - 1];
    const currentPrice = candle.close;
    const prevPrice = indicators.data?.[index - 1]?.close; // Safely access prevPrice
    
    if (!currentKeltner || !prevKeltner || isNil(prevPrice)) { // Added prevPrice check
        return signals;
    }
    
    const { upper, middle, lower } = currentKeltner;
    const { upper: prevUpper, middle: prevMiddle, lower: prevLower } = prevKeltner;
    
    // Event: Price breaks above upper Keltner Channel
    if (prevPrice <= prevUpper && currentPrice > upper) {
        signals.push({
            type: 'keltner',
            value: 'Upper Breakout',
            strength: 80,
            isEvent: true,
            details: `Price broke above upper Keltner Channel: ${currentPrice.toFixed(4)} > ${upper.toFixed(4)}`,
            priority: 8
        });
    }
    
    // Event: Price breaks below lower Keltner Channel
    if (prevPrice >= prevLower && currentPrice < lower) {
        signals.push({
            type: 'keltner',
            value: 'Lower Breakdown',
            strength: 80,
            isEvent: true,
            details: `Price broke below lower Keltner Channel: ${currentPrice.toFixed(4)} < ${lower.toFixed(4)}`,
            priority: 8
        });
    }
    
    // Event: Price crosses above middle line (bullish)
    if (prevPrice <= prevMiddle && currentPrice > middle) {
        signals.push({
            type: 'keltner',
            value: 'Bullish Middle Cross',
            strength: 70,
            isEvent: true,
            details: `Price crossed above Keltner middle line: ${currentPrice.toFixed(4)} > ${middle.toFixed(4)}`,
            priority: 7
        });
    }
    
    // Event: Price crosses below middle line (bearish)
    if (prevPrice >= prevMiddle && currentPrice < middle) {
        signals.push({
            type: 'keltner',
            value: 'Bearish Middle Cross',
            strength: 70,
            isEvent: true,
            details: `Price crossed below Keltner middle line: ${currentPrice.toFixed(4)} < ${middle.toFixed(4)}`, // Corrected typo here, was lower.toFixed(4)
            priority: 7
        });
    }
    
    return signals;
};

/**
 * Tier: C
 */
export const evaluateDonchianCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const donchianSettings = signalSettings.donchian || {};
    
    if (!indicators.donchian || !indicators.donchian[index] || !indicators.donchian[index - 1] || index < 1) {
        return signals;
    }
    
    const currentDonchian = indicators.donchian[index];
    const prevDonchian = indicators.donchian[index - 1];
    const currentPrice = candle.close;
    const prevPrice = indicators.data[index - 1].close;
    
    if (!currentDonchian || !prevDonchian) {
        return signals;
    }
    
    const { upper, middle, lower } = currentDonchian;
    const { upper: prevUpper, middle: prevMiddle, lower: prevLower } = prevDonchian;
    
    // Event: Price breaks above upper Donchian Channel (New High)
    if (prevPrice <= prevUpper && currentPrice > upper) {
        signals.push({
            type: 'donchian',
            value: 'Upper Breakout',
            strength: 85,
            isEvent: true,
            details: `Price broke above Donchian upper band: ${currentPrice.toFixed(4)} > ${upper.toFixed(4)}`,
            priority: 9
        });
    }
    
    // Event: Price breaks below lower Donchian Channel (New Low)
    if (prevPrice >= prevLower && currentPrice < lower) {
        signals.push({
            type: 'donchian',
            value: 'Lower Breakdown',
            strength: 85,
            isEvent: true,
            details: `Price broke below Donchian lower band: ${currentPrice.toFixed(4)} < ${lower.toFixed(4)}`,
            priority: 9
        });
    }
    
    // Event: Price crosses above middle line (bullish momentum)
    if (prevPrice <= prevMiddle && currentPrice > middle) {
        signals.push({
            type: 'donchian',
            value: 'Bullish Middle Cross',
            strength: 70,
            isEvent: true,
            details: `Price crossed above Donchian middle line: ${currentPrice.toFixed(4)} > ${middle.toFixed(4)}`,
            priority: 7
        });
    }
    
    // Event: Price crosses below middle line (bearish momentum)
    if (prevPrice >= prevMiddle && currentPrice < middle) {
        signals.push({
            type: 'donchian',
            value: 'Bearish Middle Cross',
            strength: 70,
            isEvent: true,
            details: `Price crossed below Donchian middle line: ${currentPrice.toFixed(4)} < ${middle.toFixed(4)}`,
            priority: 7
        });
    }
    
    return signals;
};

/**
 * Evaluates TTM Squeeze conditions, identifying high-probability breakouts.
 * This function triggers a signal on the confirmed *release* of a volatility squeeze,
 * ensuring the squeeze has persisted for a minimum duration and using a smoothed
 * momentum indicator to confirm the direction of the breakout.
 * Tier: A
 */
export const evaluateTtmSqueeze = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const ttmSettings = signalSettings.ttm_squeeze;
    
    // CRITICAL DEBUG: Log every 1000th candle to see if function is being called
    if (onLog && index % 1000 === 0) {
        onLog(`[TTM_SQUEEZE DEBUG] Function called for candle ${index}`, 'debug');
        if (indicators.ttm_squeeze && indicators.ttm_squeeze[index] !== undefined) {
            onLog(`[TTM_SQUEEZE DEBUG] TTM_Squeeze value: ${JSON.stringify(indicators.ttm_squeeze[index])}`, 'debug');
        }
    }
    
    if (!ttmSettings || !ttmSettings.enabled) return signals;

    const squeezeData = indicators.ttm_squeeze;
    if (!squeezeData || index < ttmSettings.minSqueezeDuration) {
        if (onLog && index % 1000 === 0) {
            onLog(`[TTM_SQUEEZE DEBUG] Skipping: squeezeData=${!!squeezeData}, index=${index}, minDuration=${ttmSettings.minSqueezeDuration}`, 'debug');
        }
        return signals;
    }

    const squeezeState = squeezeData[index];
    const prevSqueezeState = squeezeData[index - 1];

    if (!squeezeState || !prevSqueezeState) {
        if (onLog && index % 1000 === 0) {
            onLog(`[TTM_SQUEEZE DEBUG] Missing data: squeezeState=${!!squeezeState}, prevSqueezeState=${!!prevSqueezeState}`, 'debug');
        }
        return signals;
    }

    let squeezeDuration = 0;
    if (prevSqueezeState.isSqueeze) {
        for (let i = index - 1; i >= 0; i--) {
            if (squeezeData[i]?.isSqueeze) {
                squeezeDuration++;
            } else {
                break;
            }
        }
    }

    // DIAGNOSTIC LOGGING
    if (onLog && debugMode && indicators.data && index > indicators.data.length - 50) { // Added indicators.data check for safety
        onLog(`[TTM EVAL DEBUG] i:${index} | Squeezed: ${squeezeState.isSqueeze} | Prev Squeezed: ${prevSqueezeState.isSqueeze} | Duration: ${squeezeDuration} | Momentum: ${squeezeState.momentum.toFixed(4)}`, 'debug');
    }
    
    // CRITICAL DEBUG: Log TTM_Squeeze values every 1000th candle
    if (onLog && index % 1000 === 0) {
        onLog(`[TTM_SQUEEZE DEBUG] Current: isSqueeze=${squeezeState.isSqueeze}, momentum=${squeezeState.momentum}`, 'debug');
        onLog(`[TTM_SQUEEZE DEBUG] Previous: isSqueeze=${prevSqueezeState.isSqueeze}, momentum=${prevSqueezeState.momentum}`, 'debug');
        onLog(`[TTM_SQUEEZE DEBUG] Squeeze duration: ${squeezeDuration}, minDuration: ${ttmSettings.minSqueezeDuration}`, 'debug');
    }

    // Signal fires on the FIRST candle the squeeze is released
    if (!squeezeState.isSqueeze && prevSqueezeState.isSqueeze) {
        if (squeezeDuration >= ttmSettings.minSqueezeDuration) {
            const momentum = squeezeState.momentum;
            // Bullish Release: Momentum is positive
            if (momentum > 0) {
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release Bullish',
                    details: `Squeeze released after ${squeezeDuration} candles with bullish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze')
                });
            }
            // Bearish Release: Momentum is negative
            else if (momentum < 0) {
                 signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release Bearish',
                    details: `Squeeze released after ${squeezeDuration} candles with bearish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze')
                });
            }
        }
    }

    return signals;
};
