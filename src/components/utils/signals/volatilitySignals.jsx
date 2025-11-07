
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
    
    // --- "Lower Band Bounce" signal (Event-based: price touches lower band and bounces) ---
    const prevCandle = index > 0 ? indicators.data[index - 1] : null;
    const prevBB = index > 0 ? indicators.bollinger[index - 1] : null;
    const prevPrice = prevCandle?.close;
    const prevLower = prevBB?.lower;
    
    // Check if price bounced off lower band (was at or below lower, now above)
    const wasAtLower = prevPrice !== undefined && prevLower !== undefined && prevPrice <= prevLower;
    const isNowAboveLower = currentPrice > lower;
    const isLowerBandBounce = wasAtLower && isNowAboveLower;
    
    if (isLowerBandBounce) {
        const bounceStrength = 75; // Event-based signals are stronger
        const bounceSignal = {
            type: 'bollinger',
            value: 'Lower Band Bounce',
            strength: bounceStrength,
            isEvent: true,
            details: `Price bounced from lower band: ${prevPrice?.toFixed(2)} → ${currentPrice.toFixed(2)}`,
            priority: 8
        };
        signals.push(bounceSignal);
    }
    
    // --- "Lower Band Breakdown" signal (Event-based: price crosses below lower band) ---
    const wasAboveLower = prevPrice !== undefined && prevLower !== undefined && prevPrice > prevLower;
    const isNowBelowLower = currentPrice <= lower;
    const isLowerBandBreakdown = wasAboveLower && isNowBelowLower;
    
    if (isLowerBandBreakdown) {
        const breakdownStrength = 75; // Event-based signals are stronger
        const breakdownSignal = {
            type: 'bollinger',
            value: 'Lower Band Breakdown',
            strength: breakdownStrength,
            isEvent: true,
            details: `Price broke down through lower band: ${prevPrice?.toFixed(2)} → ${currentPrice.toFixed(2)}`,
            priority: 8
        };
        signals.push(breakdownSignal);
    }
    
    // --- "Price Above Lower Band" signal (State-based: price is currently above lower band) ---
    const isAboveLower = currentPrice > lower;
    
    if (isAboveLower) {
        const strengthValue = 60 + Math.min(20, ((currentPrice - lower) / (upper - lower)) * 20);
        const signalObj = {
            type: 'bollinger',
            value: 'Price Above Lower Band',
            strength: strengthValue,
            isEvent: false,
            details: `Price ${currentPrice.toFixed(2)} is above lower band ${lower.toFixed(2)}`,
            priority: 6
        };
        signals.push(signalObj);
    }
    
    // --- "Price Below Lower Band" signal (State-based: price is currently below lower band) ---
    const isBelowLower = currentPrice < lower;
    
    if (isBelowLower) {
        // Strength scales with how far below (deeper = more bearish = lower strength for bullish strategies, but still valid signal)
        const distanceBelow = lower - currentPrice;
        const bandWidth = upper - lower;
        const strengthValue = 60 + Math.min(20, (distanceBelow / bandWidth) * 20);
        const signalObj = {
            type: 'bollinger',
            value: 'Price Below Lower Band',
            strength: strengthValue,
            isEvent: false,
            details: `Price ${currentPrice.toFixed(2)} is below lower band ${lower.toFixed(2)}`,
            priority: 6
        };
        signals.push(signalObj);
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
    
    if (debugMode && onLog) {
        //onLog(`[ATR_EVAL] Starting evaluation at kline index ${index}`, 'debug');
    }
    
    // Check if ATR arrays exist
    if (!indicators.atr || !indicators.atrSma) {
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ❌ ATR arrays missing - atr=${!!indicators.atr}, atrSma=${!!indicators.atrSma}`, 'debug');
        }
        return signals;
    }
    
    // CRITICAL: ATR arrays are indexed differently than klines!
    // ATR calculation starts at kline index (period - 1)
    // So: atrValues[0] corresponds to kline[period - 1]
    //     atrValues[i] corresponds to kline[(period - 1) + i]
    // Therefore: atrIndex = klineIndex - (period - 1)
    const period = atrSettings.period || 14;
    const atrStartOffset = period - 1; // First ATR at kline index (period - 1)
    const atrIndex = index - atrStartOffset;
    
    if (debugMode && onLog) {
        const atrLength = indicators.atr?.length || 0;
        const atrSmaLength = indicators.atrSma?.length || 0;
        //onLog(`[ATR_EVAL] Index mapping: klineIndex=${index}, period=${period}, atrStartOffset=${atrStartOffset}, calculatedAtrIndex=${atrIndex}`, 'debug');
        //onLog(`[ATR_EVAL] Array lengths: atr.length=${atrLength}, atrSma.length=${atrSmaLength}`, 'debug');
    }
    
    // Validate calculated ATR index
    if (atrIndex < 0 || atrIndex >= indicators.atr.length || atrIndex >= indicators.atrSma.length) {
        
        // Fallback: use last valid index
        const lastValidAtrIndex = Math.min(
            (indicators.atr.length - 1),
            (indicators.atrSma.length - 1)
        );
        
        if (lastValidAtrIndex < 1) {
            if (debugMode && onLog) {
                //onLog(`[ATR_EVAL] ❌ No valid ATR data available`, 'debug');
            }
            return signals;
        }
        
        const fallbackAtrIndex = lastValidAtrIndex;
        const fallbackKlineIndex = fallbackAtrIndex + atrStartOffset;
        
        // Use fallback index
        const currentAtr = indicators.atr[fallbackAtrIndex];
        const atrSma = indicators.atrSma[fallbackAtrIndex];
        const prevAtr = fallbackAtrIndex > 0 ? indicators.atr[fallbackAtrIndex - 1] : null;
        const prevAtrSma = fallbackAtrIndex > 0 ? indicators.atrSma[fallbackAtrIndex - 1] : null;
        
        if (currentAtr === null || currentAtr === undefined || 
            atrSma === null || atrSma === undefined ||
            prevAtr === null || prevAtr === undefined ||
            prevAtrSma === null || prevAtrSma === undefined) {
            if (debugMode && onLog) {
                //onLog(`[ATR_EVAL] ❌ Fallback ATR values are null/undefined`, 'debug');
            }
            return signals;
        }
        
        // Continue with fallback values (code below will handle them)
        const multiplier = atrSettings.multiplier || 1.5;
        
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ATR values (FALLBACK): current=${currentAtr.toFixed(4)}, prev=${prevAtr.toFixed(4)}, atrSma=${atrSma.toFixed(4)}, prevAtrSma=${prevAtrSma.toFixed(4)}`, 'debug');
        }
        
        // Check for "ATR Expansion" signal
        const isExpansion = currentAtr > atrSma * multiplier && prevAtr <= prevAtrSma * multiplier;
        
        if (isExpansion) {
            signals.push({
                type: 'atr',
                value: 'ATR Expansion',
                strength: 75,
                isEvent: true,
                details: `ATR spiked to ${currentAtr.toFixed(4)} (${(currentAtr/atrSma).toFixed(1)}x average) [FALLBACK]`,
                priority: 7
            });
        }
        
        // Add state-based signals even in fallback mode
        const atrRatio = currentAtr / atrSma;
        if (atrRatio > 1.0) {
            const strength = Math.min(80, 60 + Math.min(20, (atrRatio - 1.0) * 20));
            signals.push({
                type: 'atr',
                value: 'ATR Above Average',
                strength: strength,
                isEvent: false,
                details: `ATR (${currentAtr.toFixed(4)}) is ${atrRatio.toFixed(2)}x above average (${atrSma.toFixed(4)}) [FALLBACK]`,
                priority: 6,
                candle
            });
        } else {
            const strength = Math.min(75, 60 + Math.min(15, (1.0 - atrRatio) * 30));
            signals.push({
                type: 'atr',
                value: 'ATR Below Average',
                strength: strength,
                isEvent: false,
                details: `ATR (${currentAtr.toFixed(4)}) is ${atrRatio.toFixed(2)}x below/at average (${atrSma.toFixed(4)}) [FALLBACK]`,
                priority: 6,
                candle
            });
        }
        
        return signals; // Return with fallback signals
    }
    
    // Ensure we can access previous value (ATR index must be >= 1)
    if (atrIndex < 1) {
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ❌ ATR index ${atrIndex} < 1 (cannot access previous value)`, 'debug');
        }
        return signals;
    }
    
    // Use correct mapped indices
    const currentAtr = indicators.atr[atrIndex];
    const atrSma = indicators.atrSma[atrIndex];
    const prevAtr = indicators.atr[atrIndex - 1];
    const prevAtrSma = indicators.atrSma[atrIndex - 1];
    
    // Final validation
    if (currentAtr === null || currentAtr === undefined || 
        atrSma === null || atrSma === undefined ||
        prevAtr === null || prevAtr === undefined ||
        prevAtrSma === null || prevAtrSma === undefined) {
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ❌ Null/undefined ATR values at atrIndex=${atrIndex} (klineIndex=${index}) - currentAtr=${currentAtr}, atrSma=${atrSma}, prevAtr=${prevAtr}, prevAtrSma=${prevAtrSma}`, 'debug');
        }
        return signals;
    }
    const multiplier = atrSettings.multiplier || 1.5;
    
    if (debugMode && onLog) {
        //onLog(`[ATR_EVAL] ATR values (klineIndex=${index} → atrIndex=${atrIndex}): current=${currentAtr.toFixed(4)}, prev=${prevAtr.toFixed(4)}, atrSma=${atrSma.toFixed(4)}, prevAtrSma=${prevAtrSma.toFixed(4)}, multiplier=${multiplier}`, 'debug');
    }
    
    // Check for "ATR Expansion" signal (expected by strategy)
    // This is typically when ATR spikes above its SMA
    const isExpansion = currentAtr > atrSma * multiplier && prevAtr <= prevAtrSma * multiplier;
    if (debugMode && onLog) {
        //onLog(`[ATR_EVAL] Expansion check: currentAtr > atrSma*multiplier? ${currentAtr.toFixed(4)} > ${(atrSma * multiplier).toFixed(4)} = ${currentAtr > atrSma * multiplier}, prevAtr <= prevAtrSma*multiplier? ${prevAtr.toFixed(4)} <= ${(prevAtrSma * multiplier).toFixed(4)} = ${prevAtr <= prevAtrSma * multiplier}`, 'debug');
    }
    
    // Event: ATR spike (high volatility) - this matches "ATR Expansion"
    if (isExpansion) {
        signals.push({
            type: 'atr',
            value: 'ATR Expansion',
            strength: 75,
            isEvent: true,
            details: `ATR spiked to ${currentAtr.toFixed(4)} (${(currentAtr/atrSma).toFixed(1)}x average)`,
            priority: 7
        });
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ✅ ATR Expansion detected`, 'debug');
        }
    } else {
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ❌ ATR Expansion not detected - currentAtr=${currentAtr.toFixed(4)}, threshold=${(atrSma * multiplier).toFixed(4)}, ratio=${(currentAtr / atrSma).toFixed(2)}x`, 'debug');
        }
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
    
    // State-based signals (always provide a signal based on current ATR position)
    // These help strategies that want state conditions rather than just events
    
    // "ATR Above Average" - State signal: ATR is currently above its SMA (indicating higher volatility)
    const atrRatio = currentAtr / atrSma;
    if (atrRatio > 1.0) {
        // Strength scales from 60 to 80 based on how far above average (1.0x to 2.0x+)
        const strength = Math.min(80, 60 + Math.min(20, (atrRatio - 1.0) * 20)); // Scale from 60-80
        signals.push({
            type: 'atr',
            value: 'ATR Above Average',
            strength: strength,
            isEvent: false, // State signal
            details: `ATR (${currentAtr.toFixed(4)}) is ${atrRatio.toFixed(2)}x above average (${atrSma.toFixed(4)})`,
            priority: 6,
            candle
        });
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ✅ State-based "ATR Above Average" signal ADDED (strength=${strength.toFixed(2)}, ratio=${atrRatio.toFixed(2)}x)`, 'debug');
        }
    }
    
    // "ATR Below Average" - State signal: ATR is currently below its SMA (indicating lower volatility)
    if (atrRatio <= 1.0) {
        // Strength scales from 60 to 75 based on how far below average (0.5x to 1.0x)
        const strength = Math.min(75, 60 + Math.min(15, (1.0 - atrRatio) * 30)); // Scale from 60-75
        signals.push({
            type: 'atr',
            value: 'ATR Below Average',
            strength: strength,
            isEvent: false, // State signal
            details: `ATR (${currentAtr.toFixed(4)}) is ${atrRatio.toFixed(2)}x below/at average (${atrSma.toFixed(4)})`,
            priority: 6,
            candle
        });
        if (debugMode && onLog) {
            //onLog(`[ATR_EVAL] ✅ State-based "ATR Below Average" signal ADDED (strength=${strength.toFixed(2)}, ratio=${atrRatio.toFixed(2)}x)`, 'debug');
        }
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
        const signal = { type: 'bbw', value: `squeeze_start`, strength: strength, isEvent: true };
        signals.push(signal);
    }

    // Squeeze Release Condition: A transition from below the threshold to above it.
    const isSqueezeRelease = currentBbw > settings.threshold && prevBbw <= settings.threshold;
    if (isSqueezeRelease) {
        const strength = 80;
        const signal = { type: 'bbw', value: 'squeeze_release', strength: strength, isEvent: true };
        signals.push(signal);
    }
    
    // Volatility Expansion: Significant increase in BBW (even if not from a squeeze)
    // This catches cases where BBW increases substantially but was already above threshold
    const bbwIncrease = currentBbw - prevBbw;
    const bbwIncreasePercent = prevBbw > 0 ? (bbwIncrease / prevBbw) * 100 : 0;
    const isVolatilityExpansion = currentBbw > settings.threshold && 
                                   bbwIncreasePercent > 15 && // At least 15% increase
                                   bbwIncrease > 0.5; // At least 0.5% absolute increase
    
    if (isVolatilityExpansion && !isSqueezeRelease) {
        // Only generate if we didn't already generate squeeze_release
        const strength = 70; // Slightly lower than squeeze_release since it's not a true squeeze release
        const signal = { type: 'bbw', value: 'squeeze_release', strength: strength, isEvent: true };
        signals.push(signal);
    }
    
    // In Squeeze State: The current value is below the threshold.
    const isInSqueeze = currentBbw < settings.threshold;
    if (isInSqueeze) {
        const signal = { type: 'bbw', value: 'in_squeeze', strength: 60, isEvent: false };
        signals.push(signal);
    }
    
    // Expansion State: BBW is above threshold (volatility is expanded)
    // This is a state-based signal that indicates volatility is currently expanded
    const isExpansionState = currentBbw > settings.threshold;
    if (isExpansionState) {
        const signal1 = { type: 'bbw', value: 'Expansion State', strength: 65, isEvent: false };
        signals.push(signal1);
        
        // Also generate "Expansion" as an alias (state-based signal)
        const signal2 = { type: 'bbw', value: 'Expansion', strength: 65, isEvent: false };
        signals.push(signal2);
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
    
    // DEBUG: Log entry and initial conditions
    if (debugMode && onLog) {
        //onLog(`[KELTNER_EVAL] Starting evaluation: index=${index}, hasKeltner=${!!indicators.keltner}, keltnerLength=${indicators.keltner?.length || 0}, keltner[index]=${!!indicators.keltner?.[index]}, keltner[index-1]=${!!indicators.keltner?.[index - 1]}`, 'debug');
        if (indicators.keltner && indicators.keltner.length > 0) {
            // Log actual values and types for debugging
            const keltnerAtIndex = indicators.keltner[index];
            const keltnerAtPrevIndex = indicators.keltner[index - 1];
            //onLog(`[KELTNER_EVAL] Raw values: keltner[${index}]=${keltnerAtIndex} (type=${typeof keltnerAtIndex}), keltner[${index-1}]=${keltnerAtPrevIndex} (type=${typeof keltnerAtPrevIndex})`, 'debug');
            if (keltnerAtIndex === null || keltnerAtIndex === undefined) {
                // Check what the last valid index is
                let lastValidIndex = -1;
                let lastValidValue = null;
                for (let i = index; i >= 0; i--) {
                    if (indicators.keltner[i] && typeof indicators.keltner[i] === 'object') {
                        lastValidIndex = i;
                        lastValidValue = indicators.keltner[i];
                        break;
                    }
                }
                //onLog(`[KELTNER_EVAL] Last valid Keltner found at index ${lastValidIndex}: ${lastValidValue ? JSON.stringify({upper: lastValidValue.upper, middle: lastValidValue.middle, lower: lastValidValue.lower}) : 'none'}`, 'debug');
            }
        }
    }
    
    // Find the last valid Keltner value if current index is null
    let currentKeltner = indicators.keltner?.[index];
    let prevKeltner = indicators.keltner?.[index - 1];
    
    // FALLBACK: If current is null, search backwards for last valid value
    if (!currentKeltner && indicators.keltner) {
        for (let i = index; i >= 0; i--) {
            if (indicators.keltner[i] && typeof indicators.keltner[i] === 'object') {
                currentKeltner = indicators.keltner[i];
                if (debugMode && onLog) {
                    onLog(`[KELTNER_EVAL] ⚠️ Using fallback: currentKeltner at index ${i} instead of ${index}`, 'debug');
                }
                break;
            }
        }
    }
    
    // FALLBACK: If prev is null, search backwards from index-1
    if (!prevKeltner && indicators.keltner) {
        for (let i = index - 1; i >= 0; i--) {
            if (indicators.keltner[i] && typeof indicators.keltner[i] === 'object') {
                prevKeltner = indicators.keltner[i];
                if (debugMode && onLog) {
                    onLog(`[KELTNER_EVAL] ⚠️ Using fallback: prevKeltner at index ${i} instead of ${index - 1}`, 'debug');
                }
                break;
            }
        }
    }
    
    if (!indicators.keltner || !currentKeltner || !prevKeltner || index < 1) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ❌ Early exit - Missing data: hasKeltner=${!!indicators.keltner}, currentKeltner=${!!currentKeltner}, prevKeltner=${!!prevKeltner}, index=${index}, index<1=${index < 1}`, 'debug');
            if (indicators.keltner) {
                // Count valid vs null values for debugging
                let validCount = 0;
                let nullCount = 0;
                for (let i = 0; i < Math.min(indicators.keltner.length, index + 5); i++) {
                    if (indicators.keltner[i] && typeof indicators.keltner[i] === 'object') {
                        validCount++;
                    } else {
                        nullCount++;
                    }
                }
                //onLog(`[KELTNER_EVAL] Data quality: ${validCount} valid, ${nullCount} null in first ${Math.min(indicators.keltner.length, index + 5)} elements`, 'debug');
            }
        }
        return signals;
    }
    const currentPrice = candle.close;
    const prevPrice = indicators.data?.[index - 1]?.close; // Safely access prevPrice
    
    if (!currentKeltner || !prevKeltner || isNil(prevPrice)) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ❌ Early exit - Invalid data: currentKeltner=${!!currentKeltner}, prevKeltner=${!!prevKeltner}, prevPrice=${prevPrice} (isNil=${isNil(prevPrice)}), currentKeltnerType=${typeof currentKeltner}, prevKeltnerType=${typeof prevKeltner}`, 'debug');
            if (currentKeltner) {
                //onLog(`[KELTNER_EVAL] currentKeltner keys: ${Object.keys(currentKeltner).join(', ')}`, 'debug');
            }
            if (prevKeltner) {
                //onLog(`[KELTNER_EVAL] prevKeltner keys: ${Object.keys(prevKeltner).join(', ')}`, 'debug');
            }
        }
        return signals;
    }
    
    const { upper, middle, lower } = currentKeltner;
    const { upper: prevUpper, middle: prevMiddle, lower: prevLower } = prevKeltner;
    
    // DEBUG: Log extracted values
    if (debugMode && onLog) {
        //onLog(`[KELTNER_EVAL] Data extracted: currentPrice=${currentPrice}, upper=${upper}, middle=${middle}, lower=${lower}`, 'debug');
        //onLog(`[KELTNER_EVAL] Previous: prevPrice=${prevPrice}, prevUpper=${prevUpper}, prevMiddle=${prevMiddle}, prevLower=${prevLower}`, 'debug');
    }
    
    // --- State-Based Signals (NEW) ---
    
    // 1. Price Position Relative to Keltner Bands
    if (currentPrice > upper) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Price Above Upper Band: ${currentPrice} > ${upper}`, 'debug');
        }
        const distanceFromUpper = (currentPrice - upper) / upper;
        const strength = 60 + Math.min(25, distanceFromUpper * 500);
        signals.push({
            type: 'keltner',
            value: 'Price Above Upper Band',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is above upper Keltner band (${upper.toFixed(4)}) - strong uptrend`,
            priority: 7,
            candle
        });
    } else if (currentPrice < lower) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Price Below Lower Band: ${currentPrice} < ${lower}`, 'debug');
        }
        const distanceFromLower = (lower - currentPrice) / lower;
        const strength = 60 + Math.min(25, distanceFromLower * 500);
        signals.push({
            type: 'keltner',
            value: 'Price Below Lower Band',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is below lower Keltner band (${lower.toFixed(4)}) - strong downtrend`,
            priority: 7,
            candle
        });
    } else if (currentPrice > middle) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Price Above Middle: ${currentPrice} > ${middle}`, 'debug');
        }
        const distanceFromMiddle = (currentPrice - middle) / middle;
        const strength = 40 + Math.min(20, distanceFromMiddle * 400);
        signals.push({
            type: 'keltner',
            value: 'Price Above Middle',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is above middle line (${middle.toFixed(4)}) - bullish`,
            priority: 6,
            candle
        });
    } else {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Price Below Middle: ${currentPrice} <= ${middle}`, 'debug');
        }
        const distanceFromMiddle = (middle - currentPrice) / middle;
        const strength = 40 + Math.min(20, distanceFromMiddle * 400);
        signals.push({
            type: 'keltner',
            value: 'Price Below Middle',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is below middle line (${middle.toFixed(4)}) - bearish`,
            priority: 6,
            candle
        });
    }
    
    // 2. Keltner Channel Width State
    const channelWidth = (upper - lower) / middle;
    if (debugMode && onLog) {
        //onLog(`[KELTNER_EVAL] Channel width calculation: upper=${upper}, lower=${lower}, middle=${middle}, channelWidth=${channelWidth} (${(channelWidth * 100).toFixed(2)}%)`, 'debug');
    }
    if (channelWidth > 0.03) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Wide Channel: ${(channelWidth * 100).toFixed(2)}% > 3%`, 'debug');
        }
        signals.push({
            type: 'keltner',
            value: 'Wide Channel',
            strength: 35,
            isEvent: false,
            details: `Keltner channel is wide (${(channelWidth * 100).toFixed(2)}%) - high volatility`,
            priority: 4,
            candle
        });
    } else if (channelWidth < 0.01) {
        if (debugMode && onLog) {
            //onLog(`[KELTNER_EVAL] ✅ Narrow Channel: ${(channelWidth * 100).toFixed(2)}% < 1%`, 'debug');
        }
        signals.push({
            type: 'keltner',
            value: 'Narrow Channel',
            strength: 45,
            isEvent: false,
            details: `Keltner channel is narrow (${(channelWidth * 100).toFixed(2)}%) - low volatility, potential squeeze`,
            priority: 5,
            candle
        });
    } else if (debugMode && onLog) {
        //onLog(`[KELTNER_EVAL] Channel width is normal: ${(channelWidth * 100).toFixed(2)}% (between 1% and 3%)`, 'debug');
    }
    
    // --- Event-Based Signals ---
    
    // Event: Price breaks above upper Keltner Channel
    if (prevPrice <= prevUpper && currentPrice > upper) {
        signals.push({
            type: 'keltner',
            value: 'Upper Breakout',
            strength: 90,
            isEvent: true,
            details: `Price broke above upper Keltner Channel: ${currentPrice.toFixed(4)} > ${upper.toFixed(4)}`,
            priority: 8,
            candle
        });
    }
    
    // Event: Price breaks below lower Keltner Channel
    if (prevPrice >= prevLower && currentPrice < lower) {
        signals.push({
            type: 'keltner',
            value: 'Lower Breakdown',
            strength: 90,
            isEvent: true,
            details: `Price broke below lower Keltner Channel: ${currentPrice.toFixed(4)} < ${lower.toFixed(4)}`,
            priority: 8,
            candle
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
            priority: 7,
            candle
        });
    }
    
    // Event: Price crosses below middle line (bearish)
    if (prevPrice >= prevMiddle && currentPrice < middle) {
        signals.push({
            type: 'keltner',
            value: 'Bearish Middle Cross',
            strength: 70,
            isEvent: true,
            details: `Price crossed below Keltner middle line: ${currentPrice.toFixed(4)} < ${middle.toFixed(4)}`,
            priority: 7,
            candle
        });
    }
    
    if (debugMode && onLog) {
        //onLog(`[KELTNER_EVAL] Final result: ${signals.length} signals generated`, 'debug');
        if (signals.length > 0) {
            signals.forEach((sig, idx) => {
                //onLog(`[KELTNER_EVAL] Signal[${idx}]: value="${sig.value}", strength=${sig.strength}, isEvent=${sig.isEvent}`, 'debug');
            });
        } else {
            onLog(`[KELTNER_EVAL] ⚠️ No signals generated - this will cause "Not Found"`, 'debug');
        }
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
    
    // --- State-Based Signals (NEW) ---
    
    // 1. Price Position Relative to Donchian Bands
    if (currentPrice > upper) {
        const distanceFromUpper = (currentPrice - upper) / upper;
        const strength = 65 + Math.min(25, distanceFromUpper * 500);
        signals.push({
            type: 'donchian',
            value: 'Price Above Upper Band',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is above Donchian upper band (${upper.toFixed(4)}) - new high`,
            priority: 8,
            candle
        });
    } else if (currentPrice < lower) {
        const distanceFromLower = (lower - currentPrice) / lower;
        const strength = 65 + Math.min(25, distanceFromLower * 500);
        signals.push({
            type: 'donchian',
            value: 'Price Below Lower Band',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is below Donchian lower band (${lower.toFixed(4)}) - new low`,
            priority: 8,
            candle
        });
    } else if (currentPrice > middle) {
        const distanceFromMiddle = (currentPrice - middle) / middle;
        const strength = 40 + Math.min(25, distanceFromMiddle * 400);
        signals.push({
            type: 'donchian',
            value: 'Price Above Middle',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is above middle line (${middle.toFixed(4)}) - bullish`,
            priority: 6,
            candle
        });
    } else {
        const distanceFromMiddle = (middle - currentPrice) / middle;
        const strength = 40 + Math.min(25, distanceFromMiddle * 400);
        signals.push({
            type: 'donchian',
            value: 'Price Below Middle',
            strength: strength,
            isEvent: false,
            details: `Price (${currentPrice.toFixed(4)}) is below middle line (${middle.toFixed(4)}) - bearish`,
            priority: 6,
            candle
        });
    }
    
    // 2. Donchian Channel Width State
    const channelWidth = (upper - lower) / middle;
    if (channelWidth > 0.05) {
        signals.push({
            type: 'donchian',
            value: 'Wide Range',
            strength: 35,
            isEvent: false,
            details: `Donchian channel is wide (${(channelWidth * 100).toFixed(2)}%) - high volatility`,
            priority: 4,
            candle
        });
    } else if (channelWidth < 0.015) {
        signals.push({
            type: 'donchian',
            value: 'Narrow Range',
            strength: 45,
            isEvent: false,
            details: `Donchian channel is narrow (${(channelWidth * 100).toFixed(2)}%) - consolidation`,
            priority: 5,
            candle
        });
    }
    
    // --- Event-Based Signals ---
    
    // Event: Price breaks above upper Donchian Channel (New High)
    if (prevPrice <= prevUpper && currentPrice > upper) {
        signals.push({
            type: 'donchian',
            value: 'Upper Breakout',
            strength: 90,
            isEvent: true,
            details: `Price broke above Donchian upper band: ${currentPrice.toFixed(4)} > ${upper.toFixed(4)}`,
            priority: 9,
            candle
        });
    }
    
    // Event: Price breaks below lower Donchian Channel (New Low)
    if (prevPrice >= prevLower && currentPrice < lower) {
        signals.push({
            type: 'donchian',
            value: 'Lower Breakdown',
            strength: 90,
            isEvent: true,
            details: `Price broke below Donchian lower band: ${currentPrice.toFixed(4)} < ${lower.toFixed(4)}`,
            priority: 9,
            candle
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
            priority: 7,
            candle
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
            priority: 7,
            candle
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
    
    // ALWAYS log entry for debugging TTM Squeeze issues
    //console.log(`[TTM_SQUEEZE_EVAL] 🔍 Starting evaluation at index ${index}`);
    //console.log(`[TTM_SQUEEZE_EVAL] Has ttmSettings:`, !!ttmSettings, `Enabled:`, ttmSettings?.enabled);
    //console.log(`[TTM_SQUEEZE_EVAL] Has indicators.ttm_squeeze:`, !!indicators.ttm_squeeze);
    //console.log(`[TTM_SQUEEZE_EVAL] ttm_squeeze length:`, indicators.ttm_squeeze?.length || 0);
    //console.log(`[TTM_SQUEEZE_EVAL] index ${index} validity:`, index >= 0 && index < (indicators.ttm_squeeze?.length || 0));
    
    // DEBUG: Log entry and initial conditions
    if (debugMode && onLog) {
        //onLog(`[TTM_SQUEEZE_EVAL] Starting evaluation: index=${index}, hasTtmSqueeze=${!!indicators.ttm_squeeze}, ttmSqueezeLength=${indicators.ttm_squeeze?.length || 0}, ttmSqueeze[index]=${!!indicators.ttm_squeeze?.[index]}, ttmSqueeze[index-1]=${!!indicators.ttm_squeeze?.[index - 1]}`, 'debug');
        if (indicators.ttm_squeeze && indicators.ttm_squeeze.length > 0) {
            // Log actual values and types for debugging
            const ttmAtIndex = indicators.ttm_squeeze[index];
            const ttmAtPrevIndex = indicators.ttm_squeeze[index - 1];
            //onLog(`[TTM_SQUEEZE_EVAL] Raw values: ttm_squeeze[${index}]=${ttmAtIndex ? JSON.stringify(ttmAtIndex) : 'null'} (type=${typeof ttmAtIndex}), ttm_squeeze[${index-1}]=${ttmAtPrevIndex ? JSON.stringify(ttmAtPrevIndex) : 'null'} (type=${typeof ttmAtPrevIndex})`, 'debug');
            if (ttmAtIndex === null || ttmAtIndex === undefined) {
                // Check what the last valid index is
                let lastValidIndex = -1;
                let lastValidValue = null;
                for (let i = index; i >= 0; i--) {
                    if (indicators.ttm_squeeze[i] && typeof indicators.ttm_squeeze[i] === 'object') {
                        lastValidIndex = i;
                        lastValidValue = indicators.ttm_squeeze[i];
                        break;
                    }
                }
                //onLog(`[TTM_SQUEEZE_EVAL] Last valid TTM Squeeze found at index ${lastValidIndex}: ${lastValidValue ? JSON.stringify(lastValidValue) : 'none'}`, 'debug');
            }
        }
        // Check dependencies
        //onLog(`[TTM_SQUEEZE_EVAL] Dependencies: hasBollinger=${!!indicators.bollinger}, hasKeltner=${!!indicators.keltner}, hasAwesomeOscillator=${!!indicators.awesomeoscillator}`, 'debug');
        if (indicators.bollinger && index < indicators.bollinger.length) {
            //onLog(`[TTM_SQUEEZE_EVAL] Bollinger[${index}]: ${indicators.bollinger[index] ? JSON.stringify({upper: indicators.bollinger[index].upper, lower: indicators.bollinger[index].lower}) : 'null'}`, 'debug');
        }
        if (indicators.keltner && index < indicators.keltner.length) {
            //onLog(`[TTM_SQUEEZE_EVAL] Keltner[${index}]: ${indicators.keltner[index] ? JSON.stringify({upper: indicators.keltner[index].upper, lower: indicators.keltner[index].lower}) : 'null'}`, 'debug');
        }
        if (indicators.awesomeoscillator && index < indicators.awesomeoscillator.length) {
            //onLog(`[TTM_SQUEEZE_EVAL] AwesomeOscillator[${index}]: ${indicators.awesomeoscillator[index]}`, 'debug');
        }
    }
    
    if (!ttmSettings || !ttmSettings.enabled) {
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ❌ Early exit - Settings: hasTtmSettings=${!!ttmSettings}, enabled=${ttmSettings?.enabled}`, 'debug');
        }
        return signals;
    }

    const squeezeData = indicators.ttm_squeeze;
    if (!squeezeData || index < ttmSettings.minSqueezeDuration) {
        return signals;
    }

    const squeezeState = squeezeData[index];
    const prevSqueezeState = squeezeData[index - 1];

    if (!squeezeState || !prevSqueezeState) {
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

    // DEBUG: Log extracted data
    if (debugMode && onLog) {
        //onLog(`[TTM_SQUEEZE_EVAL] Data extracted: isSqueeze=${squeezeState.isSqueeze}, momentum=${squeezeState.momentum}, prevIsSqueeze=${prevSqueezeState.isSqueeze}, prevMomentum=${prevSqueezeState.momentum}, squeezeDuration=${squeezeDuration}`, 'debug');
    }

    // --- State-Based Signals (NEW) ---
    
    // 1. TTM Squeeze State
    if (squeezeState.isSqueeze) {
        const strength = 50 + Math.min(30, Math.min(squeezeDuration, 20) * 1.5);
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ✅ In Squeeze: duration=${squeezeDuration}, strength=${strength}`, 'debug');
        }
        signals.push({
            type: 'ttm_squeeze',
            value: 'In Squeeze',
            strength: strength,
            isEvent: false,
            details: `TTM Squeeze active for ${squeezeDuration} candles - low volatility, potential breakout`,
            priority: 6,
            candle
        });
    } else {
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ✅ No Squeeze: isSqueeze=false`, 'debug');
        }
        signals.push({
            type: 'ttm_squeeze',
            value: 'No Squeeze',
            strength: 25,
            isEvent: false,
            details: `TTM Squeeze not active - normal volatility`,
            priority: 3,
            candle
        });
    }
    
    // 2. TTM Momentum State
    const momentum = squeezeState.momentum;
    if (momentum > 0.1) {
        const strength = 45 + Math.min(25, Math.abs(momentum) * 100);
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ✅ Bullish Momentum: ${momentum.toFixed(4)}, strength=${strength}`, 'debug');
        }
        signals.push({
            type: 'ttm_squeeze',
            value: 'Bullish Momentum',
            strength: strength,
            isEvent: false,
            details: `TTM momentum is bullish (${momentum.toFixed(4)})`,
            priority: 6,
            candle
        });
    } else if (momentum < -0.1) {
        const strength = 45 + Math.min(25, Math.abs(momentum) * 100);
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ✅ Bearish Momentum: ${momentum.toFixed(4)}, strength=${strength}`, 'debug');
        }
        signals.push({
            type: 'ttm_squeeze',
            value: 'Bearish Momentum',
            strength: strength,
            isEvent: false,
            details: `TTM momentum is bearish (${momentum.toFixed(4)})`,
            priority: 6,
            candle
        });
    } else {
        if (debugMode && onLog) {
            //onLog(`[TTM_SQUEEZE_EVAL] ✅ Neutral Momentum: ${momentum.toFixed(4)}`, 'debug');
        }
        signals.push({
            type: 'ttm_squeeze',
            value: 'Neutral Momentum',
            strength: 30,
            isEvent: false,
            details: `TTM momentum is neutral (${momentum.toFixed(4)})`,
            priority: 4,
            candle
        });
    }

    // --- Event-Based Signals ---
    
    // Signal fires on the FIRST candle the squeeze is released
    if (!squeezeState.isSqueeze && prevSqueezeState.isSqueeze) {
        if (squeezeDuration >= ttmSettings.minSqueezeDuration) {
            // Bullish Release: Momentum is positive
            if (momentum > 0) {
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release Bullish',
                    details: `Squeeze released after ${squeezeDuration} candles with bullish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
                // Also add aliases for backward compatibility with strategy signals
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release',  // Alias for "Squeeze Release Bullish"
                    details: `Squeeze released after ${squeezeDuration} candles with bullish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Released',  // Alias for "Squeeze Release Bullish"
                    details: `Squeeze released after ${squeezeDuration} candles with bullish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
            }
            // Bearish Release: Momentum is negative
            else if (momentum < 0) {
                 signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release Bearish',
                    details: `Squeeze released after ${squeezeDuration} candles with bearish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
                // Also add aliases for backward compatibility with strategy signals
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Release',  // Alias for "Squeeze Release Bearish"
                    details: `Squeeze released after ${squeezeDuration} candles with bearish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
                signals.push({
                    type: 'ttm_squeeze',
                    value: 'Squeeze Released',  // Alias for "Squeeze Release Bearish"
                    details: `Squeeze released after ${squeezeDuration} candles with bearish momentum.`,
                    strength: applyRegimeAdjustment(95, marketRegime, 'ttm_squeeze'),
                    isEvent: true,
                    priority: 9,
                    candle
                });
            }
        }
    }

    // Log only if no signals generated (potential issue)
    if (signals.length === 0 && debugMode && onLog) {
        onLog(`[TTM_SQUEEZE_EVAL] ⚠️ No signals generated at index ${index}`, 'warning');
    }

    if (debugMode && onLog) {
        //onLog(`[TTM_SQUEEZE_EVAL] Final result: ${signals.length} signals generated`, 'debug');
        if (signals.length > 0) {
            signals.forEach((sig, idx) => {
                //onLog(`[TTM_SQUEEZE_EVAL] Signal[${idx}]: value="${sig.value}", strength=${sig.strength}, isEvent=${sig.isEvent}`, 'debug');
            });
        } else {
            onLog(`[TTM_SQUEEZE_EVAL] ⚠️ No signals generated - this will cause "Not Found"`, 'debug');
        }
    }

    return signals;
};
