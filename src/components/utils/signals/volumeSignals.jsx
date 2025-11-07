
import { get, isNil, mean, std, isNumber } from 'lodash';
import { analyzeVolumeSpread, detectVolumeClimax, detectSmartMoneyFlow } from '../indicator-calculations/volumeIndicators';
import { detectAdvancedDivergence } from './divergenceUtils';

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
                strength: 90,
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
                strength: 90,
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
const findDivergence = (priceData, indicatorData, currentIndex, lookback, minPeakDistance, debugMode = false, onLog = null) => {
    // Ensure we have enough data for the lookback period
    const startIndex = Math.max(0, currentIndex - lookback);
    const priceSlice = priceData.slice(startIndex, currentIndex + 1);
    const indicatorSlice = indicatorData.slice(startIndex, currentIndex + 1);

    if (debugMode && onLog) {
        //onLog(`[OBV_DIVERGENCE] findDivergence called: currentIndex=${currentIndex}, lookback=${lookback}, minPeakDistance=${minPeakDistance}, startIndex=${startIndex}, priceSlice.length=${priceSlice.length}, indicatorSlice.length=${indicatorSlice.length}`, 'debug');
    }

    if (priceSlice.length < minPeakDistance * 2 + 1 || indicatorSlice.length < minPeakDistance * 2 + 1) {
        if (debugMode && onLog) {
            //onLog(`[OBV_DIVERGENCE] ❌ Early exit: insufficient data - priceSlice.length=${priceSlice.length}, indicatorSlice.length=${indicatorSlice.length}, required=${minPeakDistance * 2 + 1}`, 'debug');
        }
        return { type: null };
    }

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

    if (debugMode && onLog) {
        //onLog(`[OBV_DIVERGENCE] Pivot results: priceHighs=${priceHighs.length}, priceLows=${priceLows.length}, indicatorHighs=${indicatorHighs.length}, indicatorLows=${indicatorLows.length}`, 'debug');
        if (priceHighs.length >= 2) {
            //onLog(`[OBV_DIVERGENCE] Price highs: last=${priceHighs[priceHighs.length - 1].value.toFixed(2)} at origIdx=${priceHighs[priceHighs.length - 1].originalIndex}, prev=${priceHighs[priceHighs.length - 2].value.toFixed(2)} at origIdx=${priceHighs[priceHighs.length - 2].originalIndex}`, 'debug');
        }
        if (priceLows.length >= 2) {
            //onLog(`[OBV_DIVERGENCE] Price lows: last=${priceLows[priceLows.length - 1].value.toFixed(2)} at origIdx=${priceLows[priceLows.length - 1].originalIndex}, prev=${priceLows[priceLows.length - 2].value.toFixed(2)} at origIdx=${priceLows[priceLows.length - 2].originalIndex}`, 'debug');
        }
        if (indicatorHighs.length >= 2) {
            //onLog(`[OBV_DIVERGENCE] Indicator highs: last=${indicatorHighs[indicatorHighs.length - 1].value.toFixed(2)} at origIdx=${indicatorHighs[indicatorHighs.length - 1].originalIndex}, prev=${indicatorHighs[indicatorHighs.length - 2].value.toFixed(2)} at origIdx=${indicatorHighs[indicatorHighs.length - 2].originalIndex}`, 'debug');
        }
        if (indicatorLows.length >= 2) {
            //onLog(`[OBV_DIVERGENCE] Indicator lows: last=${indicatorLows[indicatorLows.length - 1].value.toFixed(2)} at origIdx=${indicatorLows[indicatorLows.length - 1].originalIndex}, prev=${indicatorLows[indicatorLows.length - 2].value.toFixed(2)} at origIdx=${indicatorLows[indicatorLows.length - 2].originalIndex}`, 'debug');
        }
    }

    // Bullish Divergence: Price makes a lower low (LL), Indicator makes a higher low (HL)
    // We look for recent significant troughs and find the best matching pair
    if (priceLows.length >= 2 && indicatorLows.length >= 2) {
        // Find the best matching pair of recent pivots
        // Try matching the most recent pivots first, then work backwards
        let bestMatch = null;
        const relaxedTolerance = lookback * 1.5;
        
        // Start from the most recent pivots and work backwards to find a valid pair
        for (let i = priceLows.length - 1; i >= 1; i--) {
            const lastPriceLow = priceLows[i];
            for (let j = i - 1; j >= 0; j--) {
                const prevPriceLow = priceLows[j];
                
                // Check if price made a lower low
                if (lastPriceLow.value >= prevPriceLow.value) continue;
                
                // Now find matching indicator pivots
                for (let k = indicatorLows.length - 1; k >= 1; k--) {
                    const lastIndicatorLow = indicatorLows[k];
                    for (let l = k - 1; l >= 0; l--) {
                        const prevIndicatorLow = indicatorLows[l];
                        
                        // Check if indicator made a higher low
                        if (lastIndicatorLow.value <= prevIndicatorLow.value) continue;
                        
                        // Check alignment
                        const lastPointsAligned = Math.abs(lastPriceLow.originalIndex - lastIndicatorLow.originalIndex) <= relaxedTolerance;
                        const prevPointsAligned = Math.abs(prevPriceLow.originalIndex - prevIndicatorLow.originalIndex) <= relaxedTolerance;
                        
                        if (lastPointsAligned && prevPointsAligned) {
                            // Found a valid pair - use the most recent valid match
                            bestMatch = {
                                lastPriceLow,
                                prevPriceLow,
                                lastIndicatorLow,
                                prevIndicatorLow
                            };
                            break;
                        }
                    }
                    if (bestMatch) break;
                }
                if (bestMatch) break;
            }
            if (bestMatch) break;
        }
        
        if (bestMatch) {
            if (debugMode && onLog) {
                //onLog(`[OBV_DIVERGENCE] ✅ Bullish divergence detected! Price: ${bestMatch.prevPriceLow.value.toFixed(2)} -> ${bestMatch.lastPriceLow.value.toFixed(2)} (LL), OBV: ${bestMatch.prevIndicatorLow.value.toFixed(2)} -> ${bestMatch.lastIndicatorLow.value.toFixed(2)} (HL)`, 'debug');
            }
            return { type: 'bullish' };
        } else if (debugMode && onLog) {
            // Fallback to original logic for logging
            const lastPriceLow = priceLows[priceLows.length - 1];
            const prevPriceLow = priceLows[priceLows.length - 2];
            const lastIndicatorLow = indicatorLows[indicatorLows.length - 1];
            const prevIndicatorLow = indicatorLows[indicatorLows.length - 2];
            const priceLL = lastPriceLow.value < prevPriceLow.value;
            const indicatorHL = lastIndicatorLow.value > prevIndicatorLow.value;
            const lastPointsAligned = Math.abs(lastPriceLow.originalIndex - lastIndicatorLow.originalIndex) <= relaxedTolerance;
            const prevPointsAligned = Math.abs(prevPriceLow.originalIndex - prevIndicatorLow.originalIndex) <= relaxedTolerance;
            //onLog(`[OBV_DIVERGENCE] ❌ Bullish divergence failed: priceLL=${priceLL} (last=${lastPriceLow.value.toFixed(2)} ${lastPriceLow.value < prevPriceLow.value ? '<' : '>='} prev=${prevPriceLow.value.toFixed(2)}), indicatorHL=${indicatorHL} (last=${lastIndicatorLow.value.toFixed(2)} ${lastIndicatorLow.value > prevIndicatorLow.value ? '>' : '<='} prev=${prevIndicatorLow.value.toFixed(2)}), lastPointsAligned=${lastPointsAligned}, prevPointsAligned=${prevPointsAligned}`, 'debug');
        }
    } else if (debugMode && onLog) {
        //onLog(`[OBV_DIVERGENCE] ❌ Bullish divergence: insufficient pivots - priceLows.length=${priceLows.length}, indicatorLows.length=${indicatorLows.length}`, 'debug');
    }

    // Bearish Divergence: Price makes a higher high (HH), Indicator makes a lower high (LH)
    // We look for recent significant peaks and find the best matching pair
    if (priceHighs.length >= 2 && indicatorHighs.length >= 2) {
        // Find the best matching pair of recent pivots
        // Try matching the most recent pivots first, then work backwards
        let bestMatch = null;
        const relaxedTolerance = lookback * 1.5;
        
        // Start from the most recent pivots and work backwards to find a valid pair
        for (let i = priceHighs.length - 1; i >= 1; i--) {
            const lastPriceHigh = priceHighs[i];
            for (let j = i - 1; j >= 0; j--) {
                const prevPriceHigh = priceHighs[j];
                
                // Check if price made a higher high
                if (lastPriceHigh.value <= prevPriceHigh.value) continue;
                
                // Now find matching indicator pivots
                for (let k = indicatorHighs.length - 1; k >= 1; k--) {
                    const lastIndicatorHigh = indicatorHighs[k];
                    for (let l = k - 1; l >= 0; l--) {
                        const prevIndicatorHigh = indicatorHighs[l];
                        
                        // Check if indicator made a lower high
                        if (lastIndicatorHigh.value >= prevIndicatorHigh.value) continue;
                        
                        // Check alignment
                        const lastPointsAligned = Math.abs(lastPriceHigh.originalIndex - lastIndicatorHigh.originalIndex) <= relaxedTolerance;
                        const prevPointsAligned = Math.abs(prevPriceHigh.originalIndex - prevIndicatorHigh.originalIndex) <= relaxedTolerance;
                        
                        if (lastPointsAligned && prevPointsAligned) {
                            // Found a valid pair - use the most recent valid match
                            bestMatch = {
                                lastPriceHigh,
                                prevPriceHigh,
                                lastIndicatorHigh,
                                prevIndicatorHigh
                            };
                            break;
                        }
                    }
                    if (bestMatch) break;
                }
                if (bestMatch) break;
            }
            if (bestMatch) break;
        }
        
        if (bestMatch) {
            if (debugMode && onLog) {
                //onLog(`[OBV_DIVERGENCE] ✅ Bearish divergence detected! Price: ${bestMatch.prevPriceHigh.value.toFixed(2)} -> ${bestMatch.lastPriceHigh.value.toFixed(2)} (HH), OBV: ${bestMatch.prevIndicatorHigh.value.toFixed(2)} -> ${bestMatch.lastIndicatorHigh.value.toFixed(2)} (LH)`, 'debug');
            }
            return { type: 'bearish' };
        } else if (debugMode && onLog) {
            // Fallback to original logic for logging
            const lastPriceHigh = priceHighs[priceHighs.length - 1];
            const prevPriceHigh = priceHighs[priceHighs.length - 2];
            const lastIndicatorHigh = indicatorHighs[indicatorHighs.length - 1];
            const prevIndicatorHigh = indicatorHighs[indicatorHighs.length - 2];
            const priceHH = lastPriceHigh.value > prevPriceHigh.value;
            const indicatorLH = lastIndicatorHigh.value < prevIndicatorHigh.value;
            const lastPointsAligned = Math.abs(lastPriceHigh.originalIndex - lastIndicatorHigh.originalIndex) <= relaxedTolerance;
            const prevPointsAligned = Math.abs(prevPriceHigh.originalIndex - prevIndicatorHigh.originalIndex) <= relaxedTolerance;
            //onLog(`[OBV_DIVERGENCE] ❌ Bearish divergence failed: priceHH=${priceHH} (last=${lastPriceHigh.value.toFixed(2)} ${lastPriceHigh.value > prevPriceHigh.value ? '>' : '<='} prev=${prevPriceHigh.value.toFixed(2)}), indicatorLH=${indicatorLH} (last=${lastIndicatorHigh.value.toFixed(2)} ${lastIndicatorHigh.value < prevIndicatorHigh.value ? '<' : '>='} prev=${prevIndicatorHigh.value.toFixed(2)}), lastPointsAligned=${lastPointsAligned}, prevPointsAligned=${prevPointsAligned}`, 'debug');
        }
    } else if (debugMode && onLog) {
        //onLog(`[OBV_DIVERGENCE] ❌ Bearish divergence: insufficient pivots - priceHighs.length=${priceHighs.length}, indicatorHighs.length=${indicatorHighs.length}`, 'debug');
    }

    if (debugMode && onLog) {
        //onLog(`[OBV_DIVERGENCE] ❌ No divergence found - returning {type: null}`, 'debug');
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

    // --- State-Based Signals (NEW) ---
    
    // 1. Volume Level State
    const volumeRatio = volume / avgVolume;
    if (volumeRatio > 2.0) {
        const strength = 60 + Math.min(30, (volumeRatio - 2.0) * 10);
        signals.push({
            type: 'volume',
            value: 'Very High Volume',
            strength: strength,
            isEvent: false,
            details: `Volume ${volumeRatio.toFixed(1)}x average - very high activity`,
            priority: 7,
            candle
        });
    } else if (volumeRatio > 1.5) {
        const strength = 45 + Math.min(20, (volumeRatio - 1.5) * 20);
        signals.push({
            type: 'volume',
            value: 'High Volume',
            strength: strength,
            isEvent: false,
            details: `Volume ${volumeRatio.toFixed(1)}x average - elevated activity`,
            priority: 6,
            candle
        });
    } else if (volumeRatio > 1.0) {
        const strength = 35 + Math.min(15, (volumeRatio - 1.0) * 20);
        signals.push({
            type: 'volume',
            value: 'Above Average Volume',
            strength: strength,
            isEvent: false,
            details: `Volume ${volumeRatio.toFixed(1)}x average - above normal`,
            priority: 5,
            candle
        });
    } else if (volumeRatio > 0.5) {
        const strength = 25 + Math.min(10, (volumeRatio - 0.5) * 20);
        signals.push({
            type: 'volume',
            value: 'Below Average Volume',
            strength: strength,
            isEvent: false,
            details: `Volume ${volumeRatio.toFixed(1)}x average - below normal`,
            priority: 4,
            candle
        });
    } else {
        signals.push({
            type: 'volume',
            value: 'Low Volume',
            strength: 20,
            isEvent: false,
            details: `Volume ${volumeRatio.toFixed(1)}x average - low activity`,
            priority: 3,
            candle
        });
    }
    
    // --- Event-Based Signals ---
    
    // Event: Volume Spike
    if (volume > avgVolume * spikeMultiplier) {
        const strength = 50 + Math.min(50, ((volume / avgVolume) - spikeMultiplier) * 20);
        signals.push({
            type: 'volume',
            value: 'Volume Spike',
            strength: strength,
            isEvent: true,
            details: `Volume ${volume.toFixed(0)} is ${ (volume / avgVolume).toFixed(1) }x average ${avgVolume.toFixed(0)}`,
            priority: 8,
            candle
        });
    }

    // --- Advanced Volume Analysis (VSA & Climax) ---
    
    // Volume Spread Analysis (VSA) - High priority signals
    if (indicators.data && index >= 30) {
        try {
            const vsaSignal = analyzeVolumeSpread(indicators.data, index, 30);
            if (vsaSignal) {
                signals.push({
                    type: 'volume',
                    value: vsaSignal.type, // "No Demand", "No Supply", "Effort vs Result", "Hidden Buying"
                    strength: vsaSignal.strength || 75,
                    isEvent: true,
                    details: vsaSignal.details || vsaSignal.type,
                    priority: 9,
                    candle
                });
            }
        } catch (error) {
            if (debugMode && onLog) {
                //onLog(`[VOLUME_VSA] Error: ${error.message}`, 'warning');
            }
        }
    }

    // Volume Climax Detection - Exhaustion signals
    if (indicators.data && index >= 50) {
        try {
            const climaxSignal = detectVolumeClimax(indicators.data, index, 50);
            if (climaxSignal) {
                signals.push({
                    type: 'volume',
                    value: climaxSignal.type, // "Buying Climax", "Selling Climax"
                    strength: 90, // Very high priority - exhaustion signals
                    isEvent: true,
                    details: climaxSignal.details || `${climaxSignal.type} detected`,
                    priority: 10,
                    candle
                });
            }
        } catch (error) {
            if (debugMode && onLog) {
                //onLog(`[VOLUME_CLIMAX] Error: ${error.message}`, 'warning');
            }
        }
    }

    // Smart Money Flow Detection
    if (indicators.data && index >= 20) {
        try {
            const smartMoneySignal = detectSmartMoneyFlow(indicators.data, index, 20);
            if (smartMoneySignal) {
                signals.push({
                    type: 'volume',
                    value: smartMoneySignal.type, // "Smart Money Accumulation", "Smart Money Distribution"
                    strength: 70,
                    isEvent: true,
                    details: smartMoneySignal.details || smartMoneySignal.type,
                    priority: 7,
                    candle
                });
            }
        } catch (error) {
            if (debugMode && onLog) {
                //onLog(`[VOLUME_SMART_MONEY] Error: ${error.message}`, 'warning');
            }
        }
    }

    return signals;
};


export const evaluateMfiCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const mfiSettings = signalSettings.mfi || {};

    // ✅ DIAGNOSTIC LOGGING: Log MFI evaluation entry
    const logMsg = `[MFI_EVAL] Evaluating MFI condition at index=${index}`;
    if (onLog && onLog !== (() => {})) {
        onLog(logMsg, 'debug');
    } else {
        console.log(logMsg);
    }

    // ✅ DIAGNOSTIC LOGGING: Check if MFI indicator exists
    const mfiArray = indicators.mfi;
    const hasMfiArray = !!mfiArray;
    const mfiArrayLength = mfiArray?.length || 0;
    const currentMfi = indicators.mfi?.[index];
    const prevMfi = indicators.mfi?.[index - 1];
    const overbought = mfiSettings.overbought || 80;
    const oversold = mfiSettings.oversold || 20;

    const diagnosticInfo = {
        hasMfiArray,
        mfiArrayLength,
        index,
        currentMfi: currentMfi !== undefined ? currentMfi : 'undefined',
        prevMfi: prevMfi !== undefined ? prevMfi : 'undefined',
        overbought,
        oversold,
        signalSettings: signalSettings.mfi || 'not provided',
        fullIndicatorsKeys: Object.keys(indicators || {})
    };

    const diagnosticMsg = `[MFI_EVAL] Diagnostic info: ${JSON.stringify(diagnosticInfo, null, 2)}`;
    if (onLog && onLog !== (() => {})) {
        onLog(diagnosticMsg, 'debug');
    } else {
        console.log(diagnosticMsg);
    }

    if (!indicators.mfi || index < 1) {
        const missingDataMsg = `[MFI_EVAL] ⚠️ Not enough data - hasMfiArray=${hasMfiArray}, index=${index}, mfiArrayLength=${mfiArrayLength}. Returning empty signals.`;
        if (onLog && onLog !== (() => {})) {
            onLog(missingDataMsg, 'warning');
        } else {
            console.warn(missingDataMsg);
        }
        return signals;
    }

    if (!isNumber(currentMfi) || !isNumber(prevMfi)) {
        const invalidDataMsg = `[MFI_EVAL] ⚠️ Invalid MFI values - currentMfi=${currentMfi !== undefined ? currentMfi : 'undefined'} (type: ${typeof currentMfi}), prevMfi=${prevMfi !== undefined ? prevMfi : 'undefined'} (type: ${typeof prevMfi}). Returning empty signals.`;
        if (onLog && onLog !== (() => {})) {
            onLog(invalidDataMsg, 'warning');
        } else {
            console.warn(invalidDataMsg);
        }
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
    const isOversoldExit = currentMfi > oversold && prevMfi <= oversold;
    if (isOversoldExit) {
        const signal = {
            type: 'mfi',
            value: 'Oversold Exit',
            strength: 85,
            details: `MFI exited oversold territory`,
            priority: 9,
            candle: index
        };
        signals.push(signal);
        const signalMsg = `[MFI_EVAL] ✅ Generated signal: ${signal.type}="${signal.value}", strength=${signal.strength}, isEvent=true. Current MFI=${currentMfi.toFixed(2)}, Prev MFI=${prevMfi.toFixed(2)}, Oversold=${oversold}`;
        if (onLog && onLog !== (() => {})) {
            onLog(signalMsg, 'debug');
        } else {
            console.log(signalMsg);
        }
    }

    // ✅ MFI Divergence Detection (Upgraded to use detectAdvancedDivergence)
    try {
        if (index >= 50 && indicators.data && indicators.mfi) {
            // Extract price data (close prices)
            const priceData = indicators.data.slice(0, index + 1).map(c => c.close);
            
            // Extract MFI data (filter out null/undefined values)
            const mfiRaw = indicators.mfi.slice(0, index + 1);
            const mfiValidIndices = [];
            const mfiData = [];
            
            // Align price and MFI data by filtering out invalid MFI values
            for (let i = 0; i < mfiRaw.length; i++) {
                if (isNumber(mfiRaw[i]) && !isNaN(mfiRaw[i])) {
                    mfiValidIndices.push(i);
                    mfiData.push(mfiRaw[i]);
                }
            }
            
            // Adjust price data to match valid MFI indices
            const alignedPriceData = mfiValidIndices.map(idx => priceData[idx]);
            
            // Adjust currentIndex to relative position in aligned arrays
            const alignedIndex = mfiData.length - 1;
            
            if (debugMode && onLog) {
                onLog(`[MFI_DIVERGENCE] Data alignment: originalIndex=${index}, priceData.length=${priceData.length}, mfiData.length=${mfiData.length}, alignedIndex=${alignedIndex}`, 'debug');
            }
            
            if (alignedPriceData.length >= 50 && mfiData.length >= 50 && mfiData.length === alignedPriceData.length && alignedIndex >= 50) {
                const divergence = detectAdvancedDivergence(
                    alignedPriceData,
                    mfiData,
                    alignedIndex,
                    {
                        lookbackPeriod: 50,
                        minPeakDistance: 5,
                        maxPeakDistance: 60,
                        pivotLookback: 5,
                        minPriceMove: 0.02, // 2% minimum price move
                        minOscillatorMove: 5, // MFI uses 0-100 range
                        debugMode: debugMode,
                        onLog: onLog
                    }
                );
                
                if (debugMode && onLog) {
                    onLog(`[MFI_DIVERGENCE] detectAdvancedDivergence result: ${divergence ? JSON.stringify({ type: divergence.type, strength: divergence.strength }) : 'null'}`, 'debug');
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
                    
                    if (signalValue) {
                        if (debugMode && onLog) {
                            onLog(`[MFI_DIVERGENCE] ✅ Adding signal: ${signalValue}`, 'debug');
                        }
                        signals.push({
                            type: 'mfi',
                            value: signalValue,
                            strength: Math.min(100, divergence.strength + 5),
                            details: divergence.description || `MFI ${divergence.type} divergence detected`,
                            priority: 10, // High priority for divergence signals
                            isEvent: true,
                            candle: index
                        });
                    }
                } else if (debugMode && onLog) {
                    onLog(`[MFI_DIVERGENCE] ❌ No divergence detected`, 'debug');
                }
            } else if (debugMode && onLog) {
                onLog(`[MFI_DIVERGENCE] ❌ Data length check failed: alignedPriceData.length=${alignedPriceData.length}, mfiData.length=${mfiData.length}, lengthsMatch=${mfiData.length === alignedPriceData.length}, alignedIndex=${alignedIndex}`, 'debug');
            }
        } else if (debugMode && onLog) {
            onLog(`[MFI_DIVERGENCE] ❌ Initial conditions failed: index>=50=${index >= 50}, hasData=${!!indicators.data}, hasMFI=${!!indicators.mfi}`, 'debug');
        }
    } catch (error) {
        // Silently fail - divergence detection is optional enhancement
        if (debugMode && onLog) {
            onLog(`[MFI_DIVERGENCE] ❌ Error: ${error.message}`, 'warning');
        }
    }

    const finalSignals = signals.map(s => ({ ...s, strength: applyRegimeAdjustment(s.strength, marketRegime, s.type) }));
    const uniqueSignals = getUniqueSignals(finalSignals);

    // ✅ DIAGNOSTIC LOGGING: Log final result
    const finalMsg = `[MFI_EVAL] Final result: Generated ${uniqueSignals.length} signal(s) (${signals.length} before uniqueness). Current MFI=${currentMfi.toFixed(2)}, Prev MFI=${prevMfi.toFixed(2)}, Oversold=${oversold}, Overbought=${overbought}. Signals: ${uniqueSignals.map(s => `"${s.value}"`).join(', ')}`;
    if (onLog && onLog !== (() => {})) {
        onLog(finalMsg, 'debug');
    } else {
        console.log(finalMsg);
    }

    return uniqueSignals;
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

    // 🔍 DEBUG: Log indicator availability
    if (debugMode && onLog) {
        //onLog(`[OBV_EVAL] Starting evaluation at index ${index}`, 'debug');
        //onLog(`[OBV_EVAL] Indicator check: hasOBV=${!!indicators.obv}, hasOBVSmaShort=${!!indicators.obvSmaShort}, hasOBVSmaLong=${!!indicators.obvSmaLong}`, 'debug');
        if (indicators.obv) {
            //onLog(`[OBV_EVAL] OBV length: ${indicators.obv.length}, value at index: ${indicators.obv[index]}`, 'debug');
        }
        if (indicators.obvSmaShort) {
            //onLog(`[OBV_EVAL] OBV SMA Short length: ${indicators.obvSmaShort.length}, value at index: ${indicators.obvSmaShort[index]}`, 'debug');
        }
        if (indicators.obvSmaLong) {
            //onLog(`[OBV_EVAL] OBV SMA Long length: ${indicators.obvSmaLong.length}, value at index: ${indicators.obvSmaLong[index]}`, 'debug');
        }
    }

    if (!indicators.obv || !indicators.obvSmaShort || !indicators.obvSmaLong) {
        if (debugMode && onLog) {
            //onLog(`[OBV_EVAL] ❌ Missing required indicators - returning empty signals`, 'warning');
        }
        return signals;
    }

    if (index < 1 || !indicators.obv[index] || !indicators.obvSmaShort[index] || !indicators.obvSmaLong[index]) {
        if (debugMode && onLog) {
            //onLog(`[OBV_EVAL] ❌ Invalid index or missing values at index ${index} - returning empty signals`, 'warning');
        }
        return signals;
    }

    const currentObv = indicators.obv[index];
    const currentShortSma = indicators.obvSmaShort[index];
    const currentLongSma = indicators.obvSmaLong[index];
    const prevShortSma = indicators.obvSmaShort[index - 1];
    const prevLongSma = indicators.obvSmaLong[index - 1];

    // --- State-Based Signals (NEW) ---
    
    // 1. OBV Position State
    if (currentShortSma > currentLongSma) {
        const distance = ((currentShortSma - currentLongSma) / Math.abs(currentLongSma || 1)) * 100;
        const strength = 40 + Math.min(30, distance * 10);
        signals.push({
            type: 'obv',
            value: 'OBV Above SMA',
            strength: strength,
            isEvent: false,
            details: `OBV short SMA (${currentShortSma.toFixed(2)}) above long SMA (${currentLongSma.toFixed(2)}) - accumulation`,
            priority: 6,
            candle: index
        });
    } else {
        const distance = ((currentLongSma - currentShortSma) / Math.abs(currentLongSma || 1)) * 100;
        const strength = 40 + Math.min(30, distance * 10);
        signals.push({
            type: 'obv',
            value: 'OBV Below SMA',
            strength: strength,
            isEvent: false,
            details: `OBV short SMA (${currentShortSma.toFixed(2)}) below long SMA (${currentLongSma.toFixed(2)}) - distribution`,
            priority: 6,
            candle: index
        });
    }

    // 2. OBV Trend State
    if (prevShortSma !== undefined && prevLongSma !== undefined) {
        const shortTrend = currentShortSma - prevShortSma;
        const longTrend = currentLongSma - prevLongSma;
        
        if (shortTrend > 0 && longTrend > 0) {
            signals.push({
                type: 'obv',
                value: 'OBV Rising',
                strength: 45,
                isEvent: false,
                details: `OBV SMAs both rising - accumulation trend`,
                priority: 5,
                candle: index
            });
        } else if (shortTrend < 0 && longTrend < 0) {
            signals.push({
                type: 'obv',
                value: 'OBV Falling',
                strength: 45,
                isEvent: false,
                details: `OBV SMAs both falling - distribution trend`,
                priority: 5,
                candle: index
            });
        }
    }

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
                value: 'OBV Bullish Crossover',
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
                value: 'OBV Bearish Crossover',
                isEvent: true,
                strength: 75,
                details: `OBV short SMA crossed below long SMA`,
                priority: 8,
                candle: index
            });
        }
    }

    // ✅ Phase 1: OBV Divergence Detection
    try {
        if (debugMode && onLog) {
            //onLog(`[OBV_DIVERGENCE] Starting detection at index ${index}`, 'debug');
            //onLog(`[OBV_DIVERGENCE] Conditions check: index>=50=${index >= 50}, hasData=${!!indicators.data}, hasOBV=${!!indicators.obv}`, 'debug');
        }
        
        if (index >= 50 && indicators.data && indicators.obv) {
            // Extract price data (close prices)
            const priceData = indicators.data.slice(0, index + 1).map(c => c.close);
            
            // Extract OBV data
            const obvData = indicators.obv.slice(0, index + 1).filter(v => v !== null && v !== undefined);
            
            if (debugMode && onLog) {
                //onLog(`[OBV_DIVERGENCE] Data check: priceData.length=${priceData.length}, obvData.length=${obvData.length}, lengthsMatch=${obvData.length === priceData.length}`, 'debug');
            }
            
            if (priceData.length >= 50 && obvData.length >= 50 && obvData.length === priceData.length) {
                // Use existing findDivergence helper
                // Note: findDivergence expects full candle objects and uses minPeakDistance (default 5)
                const divergenceResult = findDivergence(
                    indicators.data.slice(0, index + 1),
                    obvData,
                    index,
                    50,
                    5, // minPeakDistance
                    debugMode, // pass debugMode
                    onLog // pass onLog
                );
                
                if (debugMode && onLog) {
                    //onLog(`[OBV_DIVERGENCE] findDivergence result: ${divergenceResult ? JSON.stringify(divergenceResult) : 'null'}`, 'debug');
                    // Enhanced debug: Check why divergence wasn't found
                    if (!divergenceResult || !divergenceResult.type) {
                        //onLog(`[OBV_DIVERGENCE] ⚠️ Divergence not detected. This could mean: 1) No divergence pattern exists in current market data, 2) Algorithm requirements not met (need 2+ peaks/troughs with proper alignment)`, 'debug');
                    }
                }
                
                if (divergenceResult && divergenceResult.type) {
                    let signalValue = '';
                    if (divergenceResult.type === 'bullish') {
                        signalValue = 'OBV Bullish Divergence';
                    } else if (divergenceResult.type === 'bearish') {
                        signalValue = 'OBV Bearish Divergence';
                    }
                    
                    if (signalValue) {
                        if (debugMode && onLog) {
                            //onLog(`[OBV_DIVERGENCE] ✅ Adding signal: ${signalValue}`, 'debug');
                        }
                        signals.push({
                            type: 'OBV',
                            value: signalValue,
                            strength: 90,
                            details: `OBV ${divergenceResult.type} divergence detected`,
                            priority: 10,
                            isEvent: true,
                            candle: index
                        });
                    }
                } else if (debugMode && onLog) {
                    //onLog(`[OBV_DIVERGENCE] ❌ No divergence detected (result: ${divergenceResult ? 'has result but no type' : 'null'})`, 'debug');
                }
            } else if (debugMode && onLog) {
                //onLog(`[OBV_DIVERGENCE] ❌ Data length check failed: priceData.length=${priceData.length}, obvData.length=${obvData.length}, lengthsMatch=${obvData.length === priceData.length}`, 'debug');
            }
        } else if (debugMode && onLog) {
            //onLog(`[OBV_DIVERGENCE] ❌ Initial conditions failed: index>=50=${index >= 50}, hasData=${!!indicators.data}, hasOBV=${!!indicators.obv}`, 'debug');
        }
    } catch (error) {
        if (debugMode && onLog) {
            //onLog(`[OBV_DIVERGENCE] ❌ Error: ${error.message}`, 'warning');
            //onLog(`[OBV_DIVERGENCE] ❌ Stack: ${error.stack}`, 'warning');
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

    // --- State-Based Signals (NEW) ---
    
    // 1. CMF Level State
    if (currentCmf > 0.1) {
        const strength = 50 + Math.min(30, (currentCmf - 0.1) * 200);
        signals.push({
            type: 'cmf',
            value: 'Strong Positive CMF',
            strength: strength,
            isEvent: false,
            details: `CMF at ${currentCmf.toFixed(3)} - strong buying pressure`,
            priority: 7,
            candle
        });
    } else if (currentCmf > 0) {
        const strength = 35 + Math.min(20, currentCmf * 200);
        signals.push({
            type: 'cmf',
            value: 'Positive CMF',
            strength: strength,
            isEvent: false,
            details: `CMF at ${currentCmf.toFixed(3)} - buying pressure`,
            priority: 5,
            candle
        });
    } else if (currentCmf < -0.1) {
        const strength = 50 + Math.min(30, (Math.abs(currentCmf) - 0.1) * 200);
        signals.push({
            type: 'cmf',
            value: 'Strong Negative CMF',
            strength: strength,
            isEvent: false,
            details: `CMF at ${currentCmf.toFixed(3)} - strong selling pressure`,
            priority: 7,
            candle
        });
    } else if (currentCmf < 0) {
        const strength = 35 + Math.min(20, Math.abs(currentCmf) * 200);
        signals.push({
            type: 'cmf',
            value: 'Negative CMF',
            strength: strength,
            isEvent: false,
            details: `CMF at ${currentCmf.toFixed(3)} - selling pressure`,
            priority: 5,
            candle
        });
    } else {
        signals.push({
            type: 'cmf',
            value: 'Neutral CMF',
            strength: 25,
            isEvent: false,
            details: `CMF at ${currentCmf.toFixed(3)} - balanced flow`,
            priority: 3,
            candle
        });
    }
    
    // 2. CMF Direction State
    const cmfChange = currentCmf - prevCmf;
    if (Math.abs(cmfChange) > 0.05) {
        if (cmfChange > 0) {
            const strength = 40 + Math.min(25, Math.abs(cmfChange) * 400);
            signals.push({
                type: 'cmf',
                value: 'Rising CMF',
                strength: strength,
                isEvent: false,
                details: `CMF rising by ${cmfChange.toFixed(3)} - buying pressure increasing`,
                priority: 6,
                candle
            });
        } else {
            const strength = 40 + Math.min(25, Math.abs(cmfChange) * 400);
            signals.push({
                type: 'cmf',
                value: 'Falling CMF',
                strength: strength,
                isEvent: false,
                details: `CMF falling by ${Math.abs(cmfChange).toFixed(3)} - selling pressure increasing`,
                priority: 6,
                candle
            });
        }
    }

    // --- Event-Based Signals ---
    
    // Event: CMF crosses above zero (Bullish)
    if (prevCmf <= 0 && currentCmf > 0) {
        signals.push({
            type: 'cmf',
            value: 'Bullish Zero Cross',
            strength: 70,
            isEvent: true,
            details: `CMF crossed above zero: ${currentCmf.toFixed(3)}`,
            priority: 7,
            candle
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
            priority: 7,
            candle
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

    // --- State-Based Signals (NEW) ---
    
    // 1. ADL Position State
    const adlAboveSma = currentAdl > currentSma;
    const distanceFromSma = Math.abs(currentAdl - currentSma) / Math.abs(currentSma || 1);
    
    if (adlAboveSma) {
        const strength = 40 + Math.min(30, distanceFromSma * 1000);
        signals.push({
            type: 'adline',
            value: 'ADL Above SMA',
            strength: strength,
            isEvent: false,
            details: `ADL (${currentAdl.toFixed(2)}) is above SMA (${currentSma.toFixed(2)}) - accumulation`,
            priority: 6,
            candle
        });
    } else {
        const strength = 40 + Math.min(30, distanceFromSma * 1000);
        signals.push({
            type: 'adline',
            value: 'ADL Below SMA',
            strength: strength,
            isEvent: false,
            details: `ADL (${currentAdl.toFixed(2)}) is below SMA (${currentSma.toFixed(2)}) - distribution`,
            priority: 6,
            candle
        });
    }
    
    // 2. ADL Direction State
    const adlChange = currentAdl - prevAdl;
    const smaChange = currentSma - prevSma;
    
    if (Math.abs(adlChange) > Math.abs(currentSma) * 0.001) {
        if (adlChange > 0) {
            const strength = 35 + Math.min(25, Math.abs(adlChange) / Math.abs(currentSma || 1) * 10000);
            signals.push({
                type: 'adline',
                value: 'ADL Rising',
                strength: strength,
                isEvent: false,
                details: `ADL rising - accumulation accelerating`,
                priority: 5,
                candle
            });
        } else {
            const strength = 35 + Math.min(25, Math.abs(adlChange) / Math.abs(currentSma || 1) * 10000);
            signals.push({
                type: 'adline',
                value: 'ADL Falling',
                strength: strength,
                isEvent: false,
                details: `ADL falling - distribution accelerating`,
                priority: 5,
                candle
            });
        }
    }

    // --- Event-Based Signals ---
    
    // Event: ADL crosses above its SMA (Bullish)
    if (prevAdl <= prevSma && currentAdl > currentSma) {
        signals.push({
            type: 'adline',
            value: 'Bullish Crossover',
            strength: 65,
            isEvent: true,
            details: `ADL crossed above its SMA`,
            priority: 6,
            candle
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
            priority: 6,
            candle
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
