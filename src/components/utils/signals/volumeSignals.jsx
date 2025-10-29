
import { get, isNil, mean, std, isNumber } from 'lodash';

// --- Self-Contained Helpers (for completeness) ---

/**
 * Filters an array of signal objects to keep only the one with the highest strength for each unique 'value'.
 * @param {Array<object>} signals - Array of signal objects, each with 'value' and 'strength'.
 * @returns {Array<object>} - A filtered array of unique signals with the highest strength.
 */
const getUniqueSignals = (signals) => {
    if (!signals || signals.length === 0) return [];
    const signalMap = new Map();
    for (const signal of signals) {
        if (!signalMap.has(signal.value) || signal.strength > signalMap.get(signal.value).strength) {
            signalMap.set(signal.value, signal);
        }
    }
    return Array.from(signalMap.values());
};

/**
 * Adjusts a signal's strength based on the prevailing market regime.
 * @param {number} strength - The original strength of the signal.
 * @param {string} signalType - The type of signal (e.g., 'Bullish Divergence').
 * @param {object} regime - The market regime object (e.g., { trend: 'Uptrend' }).
 * @returns {number} - The adjusted strength.
 */
const applyRegimeAdjustment = (strength, signalType, regime) => {
    if (!regime || !regime.trend) return strength;
    const isBullishSignal = signalType.toLowerCase().includes('bullish') || signalType.toLowerCase().includes('above') || signalType.toLowerCase().includes('uptrend');
    const isBearishSignal = signalType.toLowerCase().includes('bearish') || signalType.toLowerCase().includes('below') || signalType.toLowerCase().includes('downtrend');

    if (regime.trend.includes('Uptrend') && isBullishSignal) return Math.min(100, strength + 5);
    if (regime.trend.includes('Downtrend') && isBearishSignal) return Math.min(100, strength + 5);
    if (regime.trend.includes('Uptrend') && isBearishSignal) return Math.max(0, strength - 5);
    if (regime.trend.includes('Downtrend') && isBullishSignal) return Math.max(0, strength - 5);
    return strength;
};

/**
 * A generalized, self-contained function to detect bullish and bearish divergences.
 * This is a crucial helper for upgrading MFI, OBV, and other volume oscillators.
 * @param {object} params - The parameters for divergence detection.
 * @returns {Array<object>} - An array of divergence signal objects.
 */
const detectVolumeDivergence = ({
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
    const priceSlice = priceData.slice(currentIndex - lookback, currentIndex + 1);
    const indicatorSlice = indicatorData.slice(currentIndex - lookback, currentIndex + 1);

    const findPeaks = (data) => {
        const peaks = [];
        for (let i = peakThreshold; i < data.length - peakThreshold; i++) {
            const isPeak = data.slice(i - peakThreshold, i).every(v => v < data[i]) &&
                         data.slice(i + 1, i + 1 + peakThreshold).every(v => v < data[i]);
            if (isPeak) peaks.push({ index: i, value: data[i] });
        }
        return peaks;
    };

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

    if (priceHighs.length >= 2 && indicatorHighs.length >= 2) {
        const lastPriceHigh = priceHighs[priceHighs.length - 1];
        const prevPriceHigh = priceHighs[priceHighs.length - 2];
        const lastIndicatorHigh = indicatorHighs.find(p => p.index === lastPriceHigh.index);
        const prevIndicatorHigh = indicatorHighs.find(p => p.index === prevPriceHigh.index);

        if (lastIndicatorHigh && prevIndicatorHigh &&
            lastPriceHigh.value > prevPriceHigh.value &&
            lastIndicatorHigh.value < prevIndicatorHigh.value) {
            signals.push({
                value: `Bearish ${indicatorName} Divergence`,
                strength: 85,
                details: `Price made a higher high while ${indicatorName} made a lower high.`,
                indicatorValue1: prevIndicatorHigh.value, // For filtering, as used in CMF
                indicatorValue2: lastIndicatorHigh.value
            });
        }
    }

    if (priceLows.length >= 2 && indicatorLows.length >= 2) {
        const lastPriceLow = priceLows[priceLows.length - 1];
        const prevPriceLow = priceLows[priceLows.length - 2];
        const lastIndicatorLow = indicatorLows.find(t => t.index === lastPriceLow.index);
        const prevIndicatorLow = indicatorLows.find(t => t.index === prevPriceLow.index);

        if (lastIndicatorLow && prevIndicatorLow &&
            lastPriceLow.value < prevPriceLow.value &&
            lastIndicatorLow.value > prevIndicatorLow.value) {
            signals.push({
                value: `Bullish ${indicatorName} Divergence`,
                strength: 85,
                details: `Price made a lower low while ${indicatorName} made a higher low.`,
                indicatorValue1: prevIndicatorLow.value, // For filtering, as used in CMF
                indicatorValue2: lastIndicatorLow.value
            });
        }
    }
    return signals;
};

/**
 * Detects bullish or bearish divergence between price and an indicator over a lookback period.
 * This helper is specifically designed for the new OBV logic, looking for 'validated' divergences
 * by comparing the general trend of price highs/lows against indicator highs/lows.
 * @param {Array<object>} priceData - Array of price candles (with 'high', 'low', 'close').
 * @param {Array<number>} indicatorData - Array of indicator values.
 * @param {number} currentIndex - The current index in the data arrays.
 * @param {number} lookback - The number of periods to look back for divergence.
 * @param {number} minPeakDistance - Minimum distance around a point for it to be considered a peak/trough.
 * @returns {object} - { type: 'bullish' | 'bearish' | null }
 */
const findDivergence = (priceData, indicatorData, currentIndex, lookback, minPeakDistance) => {
    // Ensure we have enough data for the lookback period
    const startIndex = Math.max(0, currentIndex - lookback);
    const priceSlice = priceData.slice(startIndex, currentIndex + 1);
    const indicatorSlice = indicatorData.slice(startIndex, currentIndex + 1);

    if (priceSlice.length < minPeakDistance * 2 + 1 || indicatorSlice.length < minPeakDistance * 2 + 1) return { type: null };

    // Helper to find peaks (highs) in a data array
    const findLocalPeaks = (data, valueExtractor = val => val) => {
        const peaks = [];
        for (let i = minPeakDistance; i < data.length - minPeakDistance; i++) {
            const currentValue = valueExtractor(data[i]);
            const isPeak = data.slice(i - minPeakDistance, i).every(v => valueExtractor(v) < currentValue) &&
                           data.slice(i + 1, i + 1 + minPeakDistance).every(v => valueExtractor(v) < currentValue);
            if (isPeak) peaks.push({ index: i, value: currentValue, originalIndex: startIndex + i });
        }
        return peaks;
    };

    // Helper to find troughs (lows) in a data array
    const findLocalTroughs = (data, valueExtractor = val => val) => {
        const troughs = [];
        for (let i = minPeakDistance; i < data.length - minPeakDistance; i++) {
            const currentValue = valueExtractor(data[i]);
            const isTrough = data.slice(i - minPeakDistance, i).every(v => valueExtractor(v) > currentValue) &&
                             data.slice(i + 1, i + 1 + minPeakDistance).every(v => valueExtractor(v) > currentValue);
            if (isTrough) troughs.push({ index: i, value: currentValue, originalIndex: startIndex + i });
        }
        return troughs;
    };

    const priceHighs = findLocalPeaks(priceSlice, p => p.high);
    const priceLows = findLocalTroughs(priceSlice, p => p.low);
    const indicatorHighs = findLocalPeaks(indicatorSlice);
    const indicatorLows = findLocalTroughs(indicatorSlice);

    // Bullish Divergence: Price makes a lower low (LL), Indicator makes a higher low (HL)
    // We look for recent significant troughs.
    if (priceLows.length >= 2 && indicatorLows.length >= 2) {
        const lastPriceLow = priceLows[priceLows.length - 1];
        const prevPriceLow = priceLows[priceLows.length - 2];
        const lastIndicatorLow = indicatorLows[indicatorLows.length - 1];
        const prevIndicatorLow = indicatorLows[indicatorLows.length - 2];

        // Check for general alignment within the lookback period and valid LL/HL pattern
        if (lastPriceLow.value < prevPriceLow.value &&  // Price LL
            lastIndicatorLow.value > prevIndicatorLow.value && // Indicator HL
            Math.abs(lastPriceLow.originalIndex - lastIndicatorLow.originalIndex) <= lookback / 2 && // Last points are somewhat near
            Math.abs(prevPriceLow.originalIndex - prevIndicatorLow.originalIndex) <= lookback / 2 ) { // Previous points are somewhat near
            return { type: 'bullish' };
        }
    }

    // Bearish Divergence: Price makes a higher high (HH), Indicator makes a lower high (LH)
    // We look for recent significant peaks.
    if (priceHighs.length >= 2 && indicatorHighs.length >= 2) {
        const lastPriceHigh = priceHighs[priceHighs.length - 1];
        const prevPriceHigh = priceHighs[priceHighs.length - 2];
        const lastIndicatorHigh = indicatorHighs[indicatorHighs.length - 1];
        const prevIndicatorHigh = indicatorHighs[indicatorHighs.length - 2];

        // Check for general alignment within the lookback period and valid HH/LH pattern
        if (lastPriceHigh.value > prevPriceHigh.value && // Price HH
            lastIndicatorHigh.value < prevIndicatorHigh.value && // Indicator LH
            Math.abs(lastPriceHigh.originalIndex - lastIndicatorHigh.originalIndex) <= lookback / 2 && // Last points are somewhat near
            Math.abs(prevPriceHigh.originalIndex - prevIndicatorHigh.originalIndex) <= lookback / 2 ) { // Previous points are somewhat near
            return { type: 'bearish' };
        }
    }

    return { type: null };
};

/**
 * Tier: A
 */
export const evaluateVolumeCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const volumeSettings = signalSettings.volume || {};
    const volume = candle.volume;
    // FIX: Use volume_sma (with underscore) which is the actual indicator name
    const avgVolume = indicators.volume_sma ? indicators.volume_sma[index] : 0;
    const spikeMultiplier = volumeSettings.spikeMultiplier || 1.5;

    // Add diagnostic logging for Volume signal detection - more aggressive logging
    if (onLog && (index < 5 || index % 1000 === 0)) {
        onLog(`[VOLUME DEBUG] Candle ${index}: enabled=${volumeSettings.enabled}, volume=${volume}, avgVolume=${avgVolume}, spikeMultiplier=${spikeMultiplier}`, 'debug');
        onLog(`[VOLUME DEBUG] volume_sma exists: ${!!indicators.volume_sma}, isNumber(volume): ${isNumber(volume)}, isNumber(avgVolume): ${isNumber(avgVolume)}`, 'debug');
    }

    if (!isNumber(volume) || !isNumber(avgVolume) || avgVolume === 0) { // Added avgVolume === 0 check
        if (index % 1000 === 0 && onLog) {
            onLog(`[VOLUME DEBUG] Skipping volume evaluation: volume=${volume}, avgVolume=${avgVolume}, isNumber(volume)=${isNumber(volume)}, isNumber(avgVolume)=${isNumber(avgVolume)}`, 'debug');
        }
        return signals;
    }

    // Event: Volume Spike
    if (volume > avgVolume * spikeMultiplier) {
        const strength = 50 + Math.min(50, ((volume / avgVolume) - spikeMultiplier) * 20);
        signals.push({
            type: 'volume',
            value: 'Volume Spike',
            strength: strength,
            isEvent: true,
            details: `Volume ${volume.toFixed(0)} is ${ (volume / avgVolume).toFixed(1) }x average ${avgVolume.toFixed(0)}`,
            priority: 8
        });
    }

    return signals;
};


export const evaluateMfiCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const mfiSettings = signalSettings.mfi || {};

    if (!indicators.mfi || index < 1) {
        return signals;
    }

    const currentMfi = indicators.mfi[index];
    const prevMfi = indicators.mfi[index - 1];
    const overbought = mfiSettings.overbought || 80;
    const oversold = mfiSettings.oversold || 20;

    if (!isNumber(currentMfi) || !isNumber(prevMfi)) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---

    // 1. MFI Level State
    if (currentMfi > overbought) {
        const strength = 50 + Math.min(30, (currentMfi - overbought) / 2);
        signals.push({
            type: 'mfi',
            value: 'Overbought',
            strength: strength,
            details: `MFI at ${currentMfi.toFixed(1)} - overbought condition`,
            priority: 7,
            candle: index
        });
    } else if (currentMfi < oversold) {
        const strength = 50 + Math.min(30, (oversold - currentMfi) / 2);
        signals.push({
            type: 'mfi',
            value: 'Oversold',
            strength: strength,
            details: `MFI at ${currentMfi.toFixed(1)} - oversold condition`,
            priority: 7,
            candle: index
        });
    } else if (currentMfi > 60) {
        const strength = 35 + Math.min(20, (currentMfi - 60) / 2);
        signals.push({
            type: 'mfi',
            value: 'High MFI',
            strength: strength,
            details: `MFI at ${currentMfi.toFixed(1)} - high money flow`,
            priority: 5,
            candle: index
        });
    } else if (currentMfi < 40) {
        const strength = 35 + Math.min(20, (40 - currentMfi) / 2);
        signals.push({
            type: 'mfi',
            value: 'Low MFI',
            strength: strength,
            details: `MFI at ${currentMfi.toFixed(1)} - low money flow`,
            priority: 5,
            candle: index
        });
    } else {
        signals.push({
            type: 'mfi',
            value: 'Neutral MFI',
            strength: 25,
            details: `MFI at ${currentMfi.toFixed(1)} - neutral money flow`,
            priority: 4,
            candle: index
        });
    }

    // 2. MFI Direction State
    const mfiChange = currentMfi - prevMfi;
    if (Math.abs(mfiChange) > 1) { // Significant change
        if (mfiChange > 0) {
            const strength = 40 + Math.min(25, Math.abs(mfiChange) * 2);
            signals.push({
                type: 'mfi',
                value: 'Rising MFI',
                strength: strength,
                details: `MFI rising by ${mfiChange.toFixed(1)} points`,
                priority: 6,
                candle: index
            });
        } else {
            const strength = 40 + Math.min(25, Math.abs(mfiChange) * 2);
            signals.push({
                type: 'mfi',
                value: 'Falling MFI',
                strength: strength,
                details: `MFI falling by ${Math.abs(mfiChange).toFixed(1)} points`,
                priority: 6,
                candle: index
            });
        }
    }

    // 3. MFI Momentum State
    if (index >= 2) {
        const mfi2Ago = indicators.mfi[index - 2];
        if (isNumber(mfi2Ago)) {
            const momentum = (currentMfi - mfi2Ago) / 2; // 2-period momentum
            
            if (momentum > 3) {
                signals.push({
                    type: 'mfi',
                    value: 'Strong Bullish Momentum',
                    strength: 60,
                    details: `MFI showing strong upward momentum`,
                    priority: 7,
                    candle: index
                });
            } else if (momentum < -3) {
                signals.push({
                    type: 'mfi',
                    value: 'Strong Bearish Momentum',
                    strength: 60,
                    details: `MFI showing strong downward momentum`,
                    priority: 7,
                    candle: index
                });
            }
        }
    }

    // --- Event-Based Signals (Existing Logic) ---

    // Overbought Exit Event
    if (currentMfi < overbought && prevMfi >= overbought) {
        signals.push({
            type: 'mfi',
            value: 'Overbought Exit',
            strength: 85,
            details: `MFI exited overbought territory`,
            priority: 9,
            candle: index
        });
    }

    // Oversold Exit Event
    if (currentMfi > oversold && prevMfi <= oversold) {
        signals.push({
            type: 'mfi',
            value: 'Oversold Exit',
            strength: 85,
            details: `MFI exited oversold territory`,
            priority: 9,
            candle: index
        });
    }

    // MFI Divergence Events (simplified)
    if (index >= 10 && indicators.data && indicators.data[index - 10]) {
        const priceChange = candle.close - indicators.data[index - 10].close;
        const mfiChange10 = currentMfi - indicators.mfi[index - 10];
        
        // Bullish Divergence
        if (priceChange < 0 && mfiChange10 > 0 && currentMfi < oversold) {
            signals.push({
                type: 'mfi',
                value: 'Bullish Divergence',
                strength: 80,
                details: `Price declining but MFI rising - bullish divergence`,
                priority: 8,
                candle: index
            });
        }

        // Bearish Divergence
        if (priceChange > 0 && mfiChange10 < 0 && currentMfi > overbought) {
            signals.push({
                type: 'mfi',
                value: 'Bearish Divergence',
                strength: 80,
                details: `Price rising but MFI falling - bearish divergence`,
                priority: 8,
                candle: index
            });
        }
    }

    const finalSignals = signals.map(s => ({ ...s, strength: applyRegimeAdjustment(s.strength, marketRegime, s.type) }));
    return getUniqueSignals(finalSignals);
};

/**
 * Evaluates On-Balance Volume (OBV) conditions, focusing on significant trend shifts and divergences.
 * This function uses a "golden cross / death cross" of two OBV SMAs and classic price-volume
 * divergence to generate high-conviction, low-noise signals.
 * Tier: A
 */
export const evaluateObvCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const obvSettings = signalSettings.obv || {};

    if (!indicators.obv || !indicators.obvSmaShort || !indicators.obvSmaLong) {
        return signals;
    }

    if (index < 1 || !indicators.obv[index] || !indicators.obvSmaShort[index] || !indicators.obvSmaLong[index]) {
        return signals;
    }

    const currentObv = indicators.obv[index];
    const currentShortSma = indicators.obvSmaShort[index];
    const currentLongSma = indicators.obvSmaLong[index];
    const prevShortSma = indicators.obvSmaShort[index - 1];
    const prevLongSma = indicators.obvSmaLong[index - 1];

    // --- State-Based Signals (REMOVED FOR ACCURATE COUNTING) ---

    // --- Event-Based Signals ---

    // Check for SMA crossover events only
    if (prevShortSma !== undefined && prevLongSma !== undefined) {
        const wasBelow = prevShortSma <= prevLongSma;
        const isAbove = currentShortSma > currentLongSma;
        const wasAbove = prevShortSma >= prevLongSma;
        const isBelow = currentShortSma < currentLongSma;

        // Bullish crossover: short SMA crosses above long SMA
        if (wasBelow && isAbove) {
            signals.push({
                type: 'obv',
                value: 'OBV Trend Cross Bullish',
                isEvent: true,
                strength: 75,
                details: `OBV short SMA crossed above long SMA`,
                priority: 8,
                candle: index
            });
        }

        // Bearish crossover: short SMA crosses below long SMA
        if (wasAbove && isBelow) {
            signals.push({
                type: 'obv',
                value: 'OBV Trend Cross Bearish',
                isEvent: true,
                strength: 75,
                details: `OBV short SMA crossed below long SMA`,
                priority: 8,
                candle: index
            });
        }
    }

    const finalSignals = signals.map(s => ({ ...s, strength: applyRegimeAdjustment(s.strength, marketRegime, s.type) }));
    return getUniqueSignals(finalSignals);
};

/**
 * Tier: B
 */
export const evaluateCmfCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    if (isNil(indicators.cmf) || isNil(indicators.cmf[index]) || index < 1 || isNil(indicators.cmf[index - 1])) {
        return signals;
    }

    const currentCmf = indicators.cmf[index];
    const prevCmf = indicators.cmf[index - 1];

    // Event: CMF crosses above zero (Bullish)
    if (prevCmf <= 0 && currentCmf > 0) {
        signals.push({
            type: 'cmf',
            value: 'Bullish Zero Cross',
            strength: 70,
            isEvent: true,
            details: `CMF crossed above zero: ${currentCmf.toFixed(3)}`,
            priority: 7
        });
    }

    // Event: CMF crosses below zero (Bearish)
    if (prevCmf >= 0 && currentCmf < 0) {
        signals.push({
            type: 'cmf',
            value: 'Bearish Zero Cross',
            strength: 70,
            isEvent: true,
            details: `CMF crossed below zero: ${currentCmf.toFixed(3)}`,
            priority: 7
        });
    }
    
    return signals;
};

/**
 * Tier: C
 */
export const evaluateAdLineCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    if (isNil(indicators.adline) || isNil(indicators.adlSma) ||
        isNil(indicators.adline[index]) || isNil(indicators.adlSma[index]) ||
        index < 1 || isNil(indicators.adline[index - 1]) || isNil(indicators.adlSma[index - 1])) {
        return signals;
    }

    const currentAdl = indicators.adline[index];
    const currentSma = indicators.adlSma[index];
    const prevAdl = indicators.adline[index - 1];
    const prevSma = indicators.adlSma[index - 1];

    // Event: ADL crosses above its SMA (Bullish)
    if (prevAdl <= prevSma && currentAdl > currentSma) {
        signals.push({
            type: 'adline',
            value: 'Bullish Crossover',
            strength: 65,
            isEvent: true,
            details: `ADL crossed above its SMA`,
            priority: 6
        });
    }

    // Event: ADL crosses below its SMA (Bearish)
    if (prevAdl >= prevSma && currentAdl < currentSma) {
        signals.push({
            type: 'adline',
            value: 'Bearish Crossover',
            strength: 65,
            isEvent: true,
            details: `ADL crossed below its SMA`,
            priority: 6
        });
    }
    
    return signals;
};

// Helper function needed for divergence, can be placed in the same file
const findHighLow = (dataSlice) => {
    let high = -Infinity;
    let low = Infinity;
    dataSlice.forEach(d => {
        if (d.high > high) high = d.high;
        if (d.low < low) low = d.low;
    });
    return { high, low };
};
