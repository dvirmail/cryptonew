
import { get, isNumber, isNil } from 'lodash';
import { getUniqueSignals, applyRegimeAdjustment } from './signalUtils';

// --- START: GENERIC UTILITIES ---

/**
 * Finds pivot points (peaks and troughs) in a data array.
 * A pivot is a point that is higher or lower than its immediate neighbors.
 */
const findPivots = (data, lookback, index) => {
    const peaks = [];
    const troughs = [];
    // Start looking for pivots from the beginning of the lookback window.
    const startIndex = Math.max(0, index - lookback);
    // Iterate up to the candle before the current one to find established pivots.
    for (let i = startIndex + 1; i < index; i++) {
        // Peak: Higher than both neighbors
        if (i > 0 && i < data.length - 1 && data[i] > data[i - 1] && data[i] > data[i + 1]) {
            peaks.push(i);
        }
        // Trough: Lower than both neighbors
        if (i > 0 && i < data.length - 1 && data[i] < data[i - 1] && data[i] < data[i + 1]) {
            troughs.push(i);
        }
    }
    return { peaks, troughs };
};

/**
 * Generic divergence detection utility. Compares pivots in price data vs. indicator data.
 * Returns the first and most recent divergence found.
 */
export const detectDivergence = (priceData, indicatorData, index, lookback = 60) => {
    const signals = [];
    if (index < lookback) return signals;

    // Use sliced data for efficiency, focusing only on the relevant lookback period.
    const relevantPriceData = priceData.slice(Math.max(0, index - lookback), index + 1);
    const relevantIndicatorData = indicatorData.slice(Math.max(0, index - lookback), index + 1);
    const relativeIndex = relevantPriceData.length - 1;

    const priceHighs = relevantPriceData.map(p => p.high);
    const priceLows = relevantPriceData.map(p => p.low);

    // Find all pivots within the lookback window.
    const { peaks: pricePeaks, troughs: priceTroughs } = findPivots(priceHighs, lookback, relativeIndex);
    const { peaks: indicatorPeaks, troughs: indicatorTroughs } = findPivots(relevantIndicatorData, lookback, relativeIndex);

    if (pricePeaks.length < 2 && priceTroughs.length < 2 && indicatorPeaks.length < 2 && indicatorTroughs.length < 2) {
        return signals;
    }

    // A tolerance window to align pivots between price and indicator.
    const checkAlignedPivots = (p1Idx, p2Idx, i1Idx, i2Idx) => Math.abs(p1Idx - i1Idx) <= 5 && Math.abs(p2Idx - i2Idx) <= 5;

    // Helper to get values from the sliced data arrays.
    const getPriceValue = (idx, type) => relevantPriceData[idx][type];
    const getIndicatorValue = (idx) => relevantIndicatorData[idx];
    
    // Logic is ordered by priority. The first divergence found is returned.
    // Regular Bearish: Price makes a Higher High, Indicator makes a Lower High.
    for (let i = pricePeaks.length - 1; i >= 1; i--) {
        for (let j = indicatorPeaks.length - 1; j >= 1; j--) {
            if (checkAlignedPivots(pricePeaks[i], pricePeaks[i - 1], indicatorPeaks[j], indicatorPeaks[j - 1])) {
                if (getPriceValue(pricePeaks[i], 'high') > getPriceValue(pricePeaks[i - 1], 'high') &&
                    getIndicatorValue(indicatorPeaks[j]) < getIndicatorValue(indicatorPeaks[j - 1])) {
                    signals.push({ value: 'Regular Bearish', details: `Price HH, Indicator LH` });
                    return signals; // Return most recent divergence first.
                }
            }
        }
    }
    
    // Regular Bullish: Price makes a Lower Low, Indicator makes a Higher Low.
    for (let i = priceTroughs.length - 1; i >= 1; i--) {
        for (let j = indicatorTroughs.length - 1; j >= 1; j--) {
            if (checkAlignedPivots(priceTroughs[i], priceTroughs[i - 1], indicatorTroughs[j], indicatorTroughs[j - 1])) {
                if (getPriceValue(priceTroughs[i], 'low') < getPriceValue(priceTroughs[i - 1], 'low') &&
                    getIndicatorValue(indicatorTroughs[j]) > getIndicatorValue(indicatorTroughs[j - 1])) {
                    signals.push({ value: 'Regular Bullish', details: `Price LL, Indicator HL` });
                    return signals;
                }
            }
        }
    }
    
    // Hidden Bearish: Price makes a Lower High, Indicator makes a Higher High.
    for (let i = pricePeaks.length - 1; i >= 1; i--) {
        for (let j = indicatorPeaks.length - 1; j >= 1; j--) {
            if (checkAlignedPivots(pricePeaks[i], pricePeaks[i - 1], indicatorPeaks[j], indicatorPeaks[j - 1])) {
                if (getPriceValue(pricePeaks[i], 'high') < getPriceValue(pricePeaks[i - 1], 'high') &&
                    getIndicatorValue(indicatorPeaks[j]) > getIndicatorValue(indicatorPeaks[j - 1])) {
                    signals.push({ value: 'Hidden Bearish', details: `Price LH, Indicator HH (Continuation)` });
                    return signals;
                }
            }
        }
    }

    // Hidden Bullish: Price makes a Higher Low, Indicator makes a Lower Low.
    for (let i = priceTroughs.length - 1; i >= 1; i--) {
        for (let j = indicatorTroughs.length - 1; j >= 1; j--) {
            if (checkAlignedPivots(priceTroughs[i], priceTroughs[i - 1], indicatorTroughs[j], indicatorTroughs[j - 1])) {
                if (getPriceValue(priceTroughs[i], 'low') > getPriceValue(priceTroughs[i - 1], 'low') &&
                    getIndicatorValue(indicatorTroughs[j]) < getIndicatorValue(indicatorTroughs[j - 1])) {
                    signals.push({ value: 'Hidden Bullish', details: `Price HL, Indicator LL (Continuation)` });
                    return signals;
                }
            }
        }
    }

    return signals;
};

/**
 * Calculates the standard deviation of an array of numbers.
 */
const standardDeviation = (arr) => {
    if (!arr || arr.length === 0) return 0;
    const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
};
// --- END: GENERIC UTILITIES ---

/**
 * Evaluates MACD for high-quality, confirmed signals based on crossovers, divergence, and momentum.
 * All other noisy signals are filtered out.
 * Tier: S+
 */
export const evaluateMacdCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const macdSettings = signalSettings.macd || {};

    if (!indicators.macd || !indicators.data || index < 1) {
        return signals;
    }

    const currentMacd = indicators.macd[index];
    const prevMacd = indicators.macd[index - 1];

    if (!currentMacd || !prevMacd || 
        !isNumber(currentMacd.macd) || !isNumber(currentMacd.signal) || !isNumber(currentMacd.histogram) ||
        !isNumber(prevMacd.macd) || !isNumber(prevMacd.signal) || !isNumber(prevMacd.histogram)) {
        return signals;
    }

    const { macd, signal, histogram } = currentMacd;
    const { macd: prevMacdValue, signal: prevSignalValue } = prevMacd;

    // --- State-Based Signals (NEW) ---

    // 1. MACD Line Position State
    if (macd > signal) {
        const strength = 40 + Math.min(30, Math.abs(macd - signal) * 100);
        signals.push({
            type: 'macd',
            value: 'MACD Above Signal',
            strength: applyRegimeAdjustment(strength, 'macd_above_signal_state', marketRegime),
            details: `MACD line (${macd.toFixed(4)}) is above Signal line (${signal.toFixed(4)})`,
            priority: 6
        });
    } else {
        const strength = 40 + Math.min(30, Math.abs(signal - macd) * 100);
        signals.push({
            type: 'macd',
            value: 'MACD Below Signal',
            strength: applyRegimeAdjustment(strength, 'macd_below_signal_state', marketRegime),
            details: `MACD line (${macd.toFixed(4)}) is below Signal line (${signal.toFixed(4)})`,
            priority: 6
        });
    }

    // 2. MACD Zero Line State
    if (macd > 0) {
        const strength = 35 + Math.min(25, Math.abs(macd) * 1000);
        signals.push({
            type: 'macd',
            value: 'MACD Above Zero',
            strength: applyRegimeAdjustment(strength, 'macd_above_zero_state', marketRegime),
            details: `MACD is above zero line, indicating upward momentum`,
            priority: 5
        });
    } else {
        const strength = 35 + Math.min(25, Math.abs(macd) * 1000);
        signals.push({
            type: 'macd',
            value: 'MACD Below Zero',
            strength: applyRegimeAdjustment(strength, 'macd_below_zero_state', marketRegime),
            details: `MACD is below zero line, indicating downward momentum`,
            priority: 5
        });
    }

    // 3. Histogram State
    if (histogram > 0) {
        const strength = 30 + Math.min(20, Math.abs(histogram) * 500);
        signals.push({
            type: 'macd',
            value: 'Positive Histogram',
            strength: applyRegimeAdjustment(strength, 'macd_positive_histogram_state', marketRegime),
            details: `Positive histogram indicates strengthening bullish momentum`,
            priority: 4
        });
    } else {
        const strength = 30 + Math.min(20, Math.abs(histogram) * 500);
        signals.push({
            type: 'macd',
            value: 'Negative Histogram',
            strength: applyRegimeAdjustment(strength, 'macd_negative_histogram_state', marketRegime),
            details: `Negative histogram indicates strengthening bearish momentum`,
            priority: 4
        });
    }

    // --- Event-Based Signals (Existing Logic Adapted) ---
    
    // Bullish Cross
    if (macd > signal && prevMacdValue <= prevSignalValue) {
        signals.push({
            type: 'macd',
            value: 'Bullish Cross',
            strength: applyRegimeAdjustment(80, 'macd_bullish_cross_event', marketRegime),
            details: `MACD line crossed above Signal line`,
            priority: 9
        });
    }

    // Bearish Cross
    if (macd < signal && prevMacdValue >= prevSignalValue) {
        signals.push({
            type: 'macd',
            value: 'Bearish Cross',
            strength: applyRegimeAdjustment(80, 'macd_bearish_cross_event', marketRegime),
            details: `MACD line crossed below Signal line`,
            priority: 9
        });
    }

    return getUniqueSignals(signals).map(s => ({ ...s, type: 'MACD', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

/**
 * Evaluates Exponential Moving Average (EMA) signals based on events.
 */
export const evaluateEmaCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const emaSettings = signalSettings.ema || {};

    if (!indicators.ema || !indicators.emaFast || !indicators.emaSlow || !indicators.data || index === 0) {
        return signals;
    }

    const currentEma = indicators.ema[index];
    const currentEmaFast = indicators.emaFast[index];
    const currentEmaSlow = indicators.emaSlow[index];
    const currentPrice = candle.close;

    if (!isNumber(currentEma) || !isNumber(currentEmaFast) || !isNumber(currentEmaSlow) || !isNumber(currentPrice)) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---

    // 1. Price Position Relative to EMA (using the main EMA, assuming it's the primary one for this signal)
    const priceAboveEma = currentPrice > currentEma;
    const distanceFromEma = Math.abs(currentPrice - currentEma) / currentEma;
    
    if (priceAboveEma) {
        const strength = 35 + Math.min(40, distanceFromEma * 1000);
        signals.push({
            type: 'ema',
            value: 'Price Above EMA',
            strength: applyRegimeAdjustment(strength, 'ema_price_above', marketRegime),
            details: `Price ${currentPrice.toFixed(2)} is above EMA ${currentEma.toFixed(2)}`,
            priority: 6
        });
    } else {
        const strength = 35 + Math.min(40, distanceFromEma * 1000);
        signals.push({
            type: 'ema',
            value: 'Price Below EMA',
            strength: applyRegimeAdjustment(strength, 'ema_price_below', marketRegime),
            details: `Price ${currentPrice.toFixed(2)} is below EMA ${currentEma.toFixed(2)}`,
            priority: 6
        });
    }

    // 2. EMA Cross State (Fast EMA vs Slow EMA)
    const fastAboveSlow = currentEmaFast > currentEmaSlow;
    const crossDistance = Math.abs(currentEmaFast - currentEmaSlow) / currentEmaSlow;
    
    if (fastAboveSlow) {
        const strength = 45 + Math.min(30, crossDistance * 1000);
        signals.push({
            type: 'ema',
            value: 'Bullish EMA Alignment',
            strength: applyRegimeAdjustment(strength, 'ema_bullish_alignment', marketRegime),
            details: `Fast EMA above Slow EMA - bullish alignment`,
            priority: 7
        });
    } else {
        const strength = 45 + Math.min(30, crossDistance * 1000);
        signals.push({
            type: 'ema',
            value: 'Bearish EMA Alignment',
            strength: applyRegimeAdjustment(strength, 'ema_bearish_alignment', marketRegime),
            details: `Fast EMA below Slow EMA - bearish alignment`,
            priority: 7
        });
    }

    // --- Event-Based Signals (Existing Logic Adapted for Fast/Slow EMA) ---
    const prevEmaFast = indicators.emaFast[index - 1];
    const prevEmaSlow = indicators.emaSlow[index - 1];
    
    if (isNumber(prevEmaFast) && isNumber(prevEmaSlow)) {
        // Bullish Cross
        if (currentEmaFast > currentEmaSlow && prevEmaFast <= prevEmaSlow) {
            signals.push({
                type: 'ema',
                value: 'Bullish Cross',
                strength: applyRegimeAdjustment(80, 'ema_bullish_cross', marketRegime),
                details: `Fast EMA crossed above Slow EMA`,
                priority: 9
            });
        }
        
        // Bearish Cross
        if (currentEmaFast < currentEmaSlow && prevEmaFast >= prevEmaSlow) {
            signals.push({
                type: 'ema',
                value: 'Bearish Cross',
                strength: applyRegimeAdjustment(80, 'ema_bearish_cross', marketRegime),
                details: `Fast EMA crossed below Slow EMA`,
                priority: 9
            });
        }
    }

    return getUniqueSignals(signals).map(s => ({ ...s, type: 'EMA', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

/**
 * Evaluates MA200 signals based on significant events (crossovers and rejections) and state.
 */
export const evaluateMa200Condition = (candle, indicators, index, signalSettings, marketRegime) => {
    const signals = [];
    const ma200Settings = get(signalSettings, 'ma200', {});
    if (!ma200Settings.enabled || index < 1) return signals;

    const ma200 = indicators.ma200 ? indicators.ma200[index] : undefined;
    const prevMa200 = indicators.ma200 ? indicators.ma200[index - 1] : undefined;
    const maFast = indicators.maFastForGoldenCross ? indicators.maFastForGoldenCross[index] : undefined;
    const prevMaFast = indicators.maFastForGoldenCross ? indicators.maFastForGoldenCross[index - 1] : undefined;
    const ma100 = indicators.ma100 ? indicators.ma100[index] : undefined;

    const currentClose = candle.close;
    const prevClose = indicators.data[index - 1]?.close;
    const currentOpen = candle.open;
    const currentLow = candle.low;
    const currentHigh = candle.high;
    
    // Ensure all necessary data points exist and are numbers for calculation
    if (!isNumber(ma200) || !isNumber(prevMa200) || !isNumber(currentClose) || !isNumber(prevClose) ||
        !isNumber(maFast) || !isNumber(prevMaFast) || !isNumber(ma100)) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    
    // 1. Price Position Relative to MA200
    const priceAboveMA200 = currentClose > ma200;
    const priceBelowMA200 = currentClose < ma200;
    const distanceFromMA200 = Math.abs(currentClose - ma200) / ma200;
    
    if (priceAboveMA200) {
        const strength = 40 + Math.min(35, distanceFromMA200 * 1000); // Strength increases with distance
        signals.push({
            type: 'ma200',
            value: 'Price Above MA200',
            strength: applyRegimeAdjustment(strength, 'ma200_price_above', marketRegime),
            details: `Price ${currentClose.toFixed(2)} is above MA200 ${ma200.toFixed(2)}`,
            priority: 6
        });
    } else if (priceBelowMA200) {
        const strength = 40 + Math.min(35, distanceFromMA200 * 1000);
        signals.push({
            type: 'ma200',
            value: 'Price Below MA200',
            strength: applyRegimeAdjustment(strength, 'ma200_price_below', marketRegime),
            details: `Price ${currentClose.toFixed(2)} is below MA200 ${ma200.toFixed(2)}`,
            priority: 6
        });
    }
    
    // 2. MA Alignment State
    const maFastAbove200 = maFast > ma200;
    const ma100Above200 = ma100 > ma200;
    const maFastBelow200 = maFast < ma200;
    const ma100Below200 = ma100 < ma200;
    
    if (maFastAbove200 && ma100Above200) {
        signals.push({
            type: 'ma200',
            value: 'Bullish MA Alignment',
            strength: applyRegimeAdjustment(55, 'ma200_ma_bullish_alignment', marketRegime),
            details: `Fast MA and MA100 both above MA200 - bullish alignment`,
            priority: 7
        });
    } else if (maFastBelow200 && ma100Below200) {
        signals.push({
            type: 'ma200',
            value: 'Bearish MA Alignment',
            strength: applyRegimeAdjustment(55, 'ma200_ma_bearish_alignment', marketRegime),
            details: `Fast MA and MA100 both below MA200 - bearish alignment`,
            priority: 7
        });
    } else {
        signals.push({
            type: 'ma200',
            value: 'Mixed MA Alignment',
            strength: applyRegimeAdjustment(25, 'ma200_ma_mixed_alignment', marketRegime),
            details: `Mixed MA alignment - conflicting signals`,
            priority: 4
        });
    }

    // --- Event-Based Signals (Preserving original nuanced logic + adding Golden/Death Cross) ---
    
    // Golden Cross Detection
    if (maFast > ma200 && prevMaFast <= prevMa200) {
        signals.push({
            type: 'ma200',
            value: 'Golden Cross',
            strength: applyRegimeAdjustment(80, 'ma200_golden_cross', marketRegime),
            details: `Golden Cross: Fast MA crossed above MA200`,
            priority: 9
        });
    }
    
    // Death Cross Detection
    if (maFast < ma200 && prevMaFast >= prevMa200) {
        signals.push({
            type: 'ma200',
            value: 'Death Cross',
            strength: applyRegimeAdjustment(80, 'ma200_death_cross', marketRegime),
            details: `Death Cross: Fast MA crossed below MA200`,
            priority: 9
        });
    }

    // Bullish Crossover: Price crosses above MA200
    if (prevClose <= prevMa200 && currentClose > ma200) {
        let strength = 80;
        const details = `Price closed above 200-period SMA (bullish crossover).`;
        signals.push({
            type: 'ma200',
            value: 'price_cross_up',
            strength: applyRegimeAdjustment(strength, 'ma200_price_cross_up', marketRegime),
            details,
            priority: 8
        });
    }

    // Bearish Crossover: Price crosses below MA200
    if (prevClose >= prevMa200 && currentClose < ma200) {
        let strength = 80;
        const details = `Price closed below 200-period SMA (bearish crossover).`;
        signals.push({
            type: 'ma200',
            value: 'price_cross_down',
            strength: applyRegimeAdjustment(strength, 'ma200_price_cross_down', marketRegime),
            details,
            priority: 8
        });
    }

    // Bullish Rejection (MA200 as Support): Price touches/dips below MA200 but closes strongly above it
    if (prevClose >= prevMa200 && currentLow <= ma200 && currentClose > ma200 && currentClose > currentOpen) {
        let strength = 75;
        let details = `Price found strong support at 200-period SMA.`;
        const lowerShadow = Math.min(currentOpen, currentClose) - currentLow;
        const body = Math.abs(currentOpen - currentClose);
        if (body > 0 && lowerShadow > body * 1.5) {
            strength += 10;
            details += ' (Strong rejection candle)';
        }
        signals.push({
            type: 'ma200',
            value: 'bullish_rejection',
            strength: applyRegimeAdjustment(strength, 'ma200_bullish_rejection', marketRegime),
            details,
            priority: 8
        });
    }

    // Bearish Rejection (MA200 as Resistance): Price touches/rises above MA200 but closes strongly below it
    if (prevClose <= prevMa200 && currentHigh >= ma200 && currentClose < ma200 && currentClose < currentOpen) {
        let strength = 75;
        let details = `Price faced strong resistance at 200-period SMA.`;
        const upperShadow = currentHigh - Math.max(currentOpen, currentClose);
        const body = Math.abs(currentOpen - currentClose);
        if (body > 0 && upperShadow > body * 1.5) {
            strength += 10;
            details += ' (Strong rejection candle)';
        }
        signals.push({
            type: 'ma200',
            value: 'bearish_rejection',
            strength: applyRegimeAdjustment(strength, 'ma200_bearish_rejection', marketRegime),
            details,
            priority: 8
        });
    }
    
    return getUniqueSignals(signals).map(s => ({ ...s, type: 'MA200', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

/**
 * Evaluates the full suite of Ichimoku Cloud signals with enhanced context and confluence.
 * Tier: S
 * REFINED LOGIC: This version applies much stricter rules to reduce signal frequency and improve quality.
 * TK crosses and Kumo breakouts now require confirmation from the Chikou Span.
 * Kijun bounces are filtered for stronger candle closes.
 * Low-quality, state-based signals (like basic Chikou position) have been removed in favor of using
 * Chikou as a confirmation filter for high-impact events.
 */
// Enhanced Ichimoku Signal Evaluation - FIXED VERSION
export const evaluateIchimokuCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode = false) => {
    if (!indicators.ichimoku || !Array.isArray(indicators.ichimoku) || indicators.ichimoku.length <= index) {
        if (debugMode && onLog) onLog(`[ICHIMOKU] No indicator data at index ${index}`, 'warning');
        return [];
    }

    const signals = [];
    const ichimoku = indicators.ichimoku[index];
    const prevIchimoku = index > 0 ? indicators.ichimoku[index - 1] : null;
    const price = candle.close;
    const prevPrice = index > 0 ? indicators.data[index - 1].close : null;

    if (debugMode && onLog) {
        onLog(`[ICHIMOKU] Current: ${JSON.stringify(ichimoku)}, Price=${price}`, 'debug');
    }

    // Extract Ichimoku components - Handle null values gracefully
    const { tenkanSen, kijunSen, senkouSpanA, senkouSpanB } = ichimoku;
    const prevTenkan = prevIchimoku ? prevIchimoku.tenkanSen : null;
    const prevKijun = prevIchimoku ? prevIchimoku.kijunSen : null;

    // Tenkan-Kijun relationship (always available)
    if (tenkanSen !== null && kijunSen !== null) {
        const tenkanAboveKijun = tenkanSen > kijunSen;
        
        // Current position signals
        if (tenkanAboveKijun) {
            signals.push({
                type: 'Ichimoku',
                value: 'Bullish Ichimoku',
                strength: 55,
                isEvent: false,
                description: 'Tenkan above Kijun - bullish'
            });
        } else {
            signals.push({
                type: 'Ichimoku',
                value: 'Bearish Ichimoku',
                strength: 55,
                isEvent: false,
                description: 'Tenkan below Kijun - bearish'
            });
        }

        // Tenkan-Kijun crossover detection
        if (prevTenkan !== null && prevKijun !== null) {
            const prevTenkanAboveKijun = prevTenkan > prevKijun;

            if (!prevTenkanAboveKijun && tenkanAboveKijun) {
                signals.push({
                    type: 'Ichimoku',
                    value: 'Tenkan Above Kijun',
                    strength: 78,
                    isEvent: true,
                    description: 'Tenkan-Sen crossed above Kijun-Sen'
                });
            } else if (prevTenkanAboveKijun && !tenkanAboveKijun) {
                signals.push({
                    type: 'Ichimoku',
                    value: 'Tenkan Below Kijun',
                    strength: 78,
                    isEvent: true,
                    description: 'Tenkan-Sen crossed below Kijun-Sen'
                });
            }
        }
    }

    // Price vs Kijun bounce detection
    if (kijunSen !== null && prevPrice !== null && prevKijun !== null) {
        const priceAboveKijun = price > kijunSen;
        const prevPriceAboveKijun = prevPrice > prevKijun;

        if (!prevPriceAboveKijun && priceAboveKijun) {
            signals.push({
                type: 'Ichimoku',
                value: 'Kijun Bounce Bullish',
                strength: 82,
                isEvent: true,
                description: 'Price bounced bullish off Kijun-Sen'
            });
        } else if (prevPriceAboveKijun && !priceAboveKijun) {
            signals.push({
                type: 'Ichimoku',
                value: 'Kijun Bounce Bearish',
                strength: 82,
                isEvent: true,
                description: 'Price bounced bearish off Kijun-Sen'
            });
        }
    }

    // Cloud (Kumo) analysis - Only if cloud data is available
    if (senkouSpanA !== null && senkouSpanB !== null) {
        const kumoTop = Math.max(senkouSpanA, senkouSpanB);
        const kumoBottom = Math.min(senkouSpanA, senkouSpanB);
        
        if (price > kumoTop) {
            signals.push({
                type: 'Ichimoku',
                value: 'Price Above Kumo',
                strength: 65,
                isEvent: false,
                description: 'Price is above the cloud'
            });
        } else if (price < kumoBottom) {
            signals.push({
                type: 'Ichimoku',
                value: 'Price Below Kumo',
                strength: 65,
                isEvent: false,
                description: 'Price is below the cloud'
            });
        } else {
            signals.push({
                type: 'Ichimoku',
                value: 'Price In Kumo',
                strength: 40,
                isEvent: false,
                description: 'Price is inside the cloud'
            });
        }
    } else {
        // When cloud data is not available, provide alternative signals based on price vs Kijun
        if (kijunSen !== null) {
            if (price > kijunSen) {
                signals.push({
                    type: 'Ichimoku',
                    value: 'Price Above Kumo',  // Use same signal name for compatibility
                    strength: 45, // Lower strength since we're using Kijun as proxy
                    isEvent: false,
                    description: 'Price above Kijun-Sen (cloud data unavailable)'
                });
            } else {
                signals.push({
                    type: 'Ichimoku',
                    value: 'Price Below Kumo',  // Use same signal name for compatibility
                    strength: 45,
                    isEvent: false,
                    description: 'Price below Kijun-Sen (cloud data unavailable)'
                });
            }
        }
    }

    if (debugMode && onLog) {
        onLog(`[ICHIMOKU] Generated ${signals.length} signals: ${signals.map(s => s.value).join(', ')}`, 'debug');
    }

    return signals;
};

/**
 * Evaluates ADX with a focus on high-quality signals, including state-based analysis.
 */
export const evaluateAdxCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const adxSettings = signalSettings.adx || {};
    if (!adxSettings.enabled) return [];

    if (!indicators.adx || !indicators.data || index < 1) { // Ensure index is at least 1 for prevAdx
        return signals;
    }

    const currentAdx = indicators.adx[index];
    const prevAdx = indicators.adx[index - 1];
    
    if (!currentAdx || !prevAdx || 
        !isNumber(currentAdx.ADX) || !isNumber(currentAdx.PDI) || !isNumber(currentAdx.MDI) ||
        !isNumber(prevAdx.ADX) || !isNumber(prevAdx.PDI) || !isNumber(prevAdx.MDI)) {
        return signals;
    }

    const { ADX, PDI, MDI } = currentAdx;
    const { PDI: prevPDI, MDI: prevMDI } = prevAdx;

    // --- State-Based Signals (NEW) ---

    // 1. Trend Strength State
    if (ADX >= 25) {
        const strength = 50 + Math.min(30, (ADX - 25) * 2);
        signals.push({
            type: 'adx',
            value: 'Strong Trend',
            strength: applyRegimeAdjustment(strength, 'adx_strong_trend_state', marketRegime),
            details: `ADX ${ADX.toFixed(1)} indicates strong trending market`,
            priority: 7
        });
    } else if (ADX >= 20) {
        signals.push({
            type: 'adx',
            value: 'Moderate Trend',
            strength: applyRegimeAdjustment(40, 'adx_moderate_trend_state', marketRegime),
            details: `ADX ${ADX.toFixed(1)} indicates moderate trend`,
            priority: 5
        });
    } else {
        signals.push({
            type: 'adx',
            value: 'Weak Trend',
            strength: applyRegimeAdjustment(25, 'adx_weak_trend_state', marketRegime),
            details: `ADX ${ADX.toFixed(1)} indicates weak or choppy market`,
            priority: 3
        });
    }

    // 2. Directional Movement State
    if (PDI > MDI) {
        const strength = 40 + Math.min(25, (PDI - MDI) * 2);
        signals.push({
            type: 'adx',
            value: 'Bullish Directional Movement',
            strength: applyRegimeAdjustment(strength, 'adx_bullish_direction_state', marketRegime),
            details: `DI+ (${PDI.toFixed(1)}) > DI- (${MDI.toFixed(1)}) - bullish direction`,
            priority: 6
        });
    } else if (MDI > PDI) {
        const strength = 40 + Math.min(25, (MDI - PDI) * 2);
        signals.push({
            type: 'adx',
            value: 'Bearish Directional Movement',
            strength: applyRegimeAdjustment(strength, 'adx_bearish_direction_state', marketRegime),
            details: `DI- (${MDI.toFixed(1)}) > DI+ (${PDI.toFixed(1)}) - bearish direction`,
            priority: 6
        });
    } else {
        signals.push({
            type: 'adx',
            value: 'Neutral Directional Movement',
            strength: applyRegimeAdjustment(20, 'adx_neutral_direction_state', marketRegime),
            details: `DI+ and DI- are balanced`,
            priority: 3
        });
    }

    // --- Event-Based Signals (From outline for backtesting compatibility) ---
    
    // Bullish DI Crossover
    if (PDI > MDI && prevPDI <= prevMDI) {
        signals.push({
            type: 'adx',
            value: 'Bullish DI Crossover',
            strength: applyRegimeAdjustment(75, 'adx_bullish_di_crossover_event', marketRegime),
            details: `DI+ crossed above DI-`,
            priority: 8
        });
    }
    
    // Bearish DI Crossover
    if (MDI > PDI && prevMDI <= prevPDI) {
        signals.push({
            type: 'adx',
            value: 'Bearish DI Crossover',
            strength: applyRegimeAdjustment(75, 'adx_bearish_di_crossover_event', marketRegime),
            details: `DI- crossed above DI+`,
            priority: 8
        });
    }
    
    return getUniqueSignals(signals).map(s => ({ ...s, type: 'ADX', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

/**
 * Evaluates Parabolic SAR (PSAR) conditions with enhanced context and confluence.
 * Tier: S
 */
export const evaluatePsarCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const psarSettings = signalSettings.psar || {};
    if (!psarSettings.enabled) return [];

    if (!indicators.psar || !indicators.data || index < 1) {
        return signals;
    }

    const currentPsar = indicators.psar[index];
    const prevPsar = indicators.psar[index - 1];
    const currentPrice = candle.close;
    const prevPrice = indicators.data[index - 1]?.close; // Safely access prevPrice

    if (!isNumber(currentPsar) || !isNumber(prevPsar) || !isNumber(currentPrice) || !isNumber(prevPrice)) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    const isBullishTrend = currentPrice > currentPsar;
    const distanceFromPsar = Math.abs(currentPrice - currentPsar) / currentPrice;

    if (isBullishTrend) {
        const strength = 50 + Math.min(35, distanceFromPsar * 500);
        signals.push({
            type: 'psar',
            value: 'Uptrending',
            strength: applyRegimeAdjustment(strength, 'psar_uptrending_state', marketRegime),
            details: `Price is above PSAR, indicating an uptrend. Distance: ${(distanceFromPsar * 100).toFixed(2)}%`,
            priority: 7
        });
    } else {
        const strength = 50 + Math.min(35, distanceFromPsar * 500);
        signals.push({
            type: 'psar',
            value: 'Downtrending',
            strength: applyRegimeAdjustment(strength, 'psar_downtrending_state', marketRegime),
            details: `Price is below PSAR, indicating a downtrend. Distance: ${(distanceFromPsar * 100).toFixed(2)}%`,
            priority: 7
        });
    }

    // --- Event-Based Signals (Existing Logic) ---
    const wasBullish = prevPrice > prevPsar;

    if (isBullishTrend && !wasBullish) {
        signals.push({
            type: 'psar',
            value: 'PSAR Flip Bullish',
            strength: applyRegimeAdjustment(85, 'psar_flip_bullish_event', marketRegime),
            details: `PSAR flipped below the price, signaling a new uptrend`,
            priority: 9
        });
    } else if (!isBullishTrend && wasBullish) {
        signals.push({
            type: 'psar',
            value: 'PSAR Flip Bearish',
            strength: applyRegimeAdjustment(85, 'psar_flip_bearish_event', marketRegime),
            details: `PSAR flipped above the price, signaling a new downtrend`,
            priority: 9
        });
    }

    return getUniqueSignals(signals).map(s => ({ ...s, type: 'PSAR', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

// WMA Signal Evaluation
export const evaluateWmaCondition = (candle, indicators, index) => {
    if (!indicators.wma || !Array.isArray(indicators.wma) || indicators.wma.length <= index) {
        return [];
    }

    const signals = [];
    const wma = indicators.wma[index];
    const prevWma = index > 0 ? indicators.wma[index - 1] : null;
    const price = candle.close;
    const prevPrice = index > 0 ? indicators.data[index - 1].close : null;

    if (!isNumber(wma) || !isNumber(price)) {
        return signals;
    }

    const priceAboveWma = price > wma;
    const prevPriceAboveWma = isNumber(prevPrice) && isNumber(prevWma) ? prevPrice > prevWma : null;

    // Price crossover detection
    if (prevPriceAboveWma !== null) {
        if (!prevPriceAboveWma && priceAboveWma) {
            // Price crossed above WMA
            signals.push({
                type: 'WMA',
                value: 'price_cross_up',
                strength: 72,
                isEvent: true,
                description: 'Price crossed above WMA'
            });
        } else if (prevPriceAboveWma && !priceAboveWma) {
            // Price crossed below WMA
            signals.push({
                type: 'WMA',
                value: 'price_cross_down',
                strength: 72,
                isEvent: true,
                description: 'Price crossed below WMA'
            });
        }
    }

    // Current position signals
    if (priceAboveWma) {
        signals.push({
            type: 'WMA',
            value: 'Price Above WMA',
            strength: 45,
            isEvent: false,
            description: 'Price is above WMA'
        });
    } else {
        signals.push({
            type: 'WMA',
            value: 'Price Below WMA',
            strength: 45,
            isEvent: false,
            description: 'Price is below WMA'
        });
    }

    return signals;
};

// TEMA Signal Evaluation
export const evaluateTemaCondition = (candle, indicators, index) => {
    if (!indicators.tema || !Array.isArray(indicators.tema) || indicators.tema.length <= index) {
        return [];
    }

    const signals = [];
    const tema = indicators.tema[index];
    const prevTema = index > 0 ? indicators.tema[index - 1] : null;
    const price = candle.close;
    const prevPrice = index > 0 ? indicators.data[index - 1].close : null;

    if (!isNumber(tema) || !isNumber(price)) {
        return signals;
    }

    // Price position relative to TEMA
    const priceAboveTema = price > tema;
    const prevPriceAboveTema = isNumber(prevPrice) && isNumber(prevTema) ? prevPrice > prevTema : null;

    // Price crossover detection
    if (prevPriceAboveTema !== null) {
        if (!prevPriceAboveTema && priceAboveTema) {
            // Price crossed above TEMA
            signals.push({
                type: 'TEMA',
                value: 'price_cross_up',
                strength: 74,
                isEvent: true,
                description: 'Price crossed above TEMA'
            });
        } else if (prevPriceAboveTema && !priceAboveTema) {
            // Price crossed below TEMA
            signals.push({
                type: 'TEMA',
                value: 'price_cross_down',
                strength: 74,
                isEvent: true,
                description: 'Price crossed below TEMA'
            });
        }
    }

    // Current position signals
    if (priceAboveTema) {
        signals.push({
            type: 'TEMA',
            value: 'Price Above TEMA',
            strength: 48,
            isEvent: false,
            description: 'Price is above TEMA'
        });
    } else {
        signals.push({
            type: 'TEMA',
            value: 'Price Below TEMA',
            strength: 48,
            isEvent: false,
            description: 'Price is below TEMA'
        });
    }

    return signals;
};

// DEMA Signal Evaluation
export const evaluateDemaCondition = (candle, indicators, index) => {
    if (!indicators.dema || !Array.isArray(indicators.dema) || indicators.dema.length <= index) {
        return [];
    }

    const signals = [];
    const dema = indicators.dema[index];
    const prevDema = index > 0 ? indicators.dema[index - 1] : null;
    const price = candle.close;
    const prevPrice = index > 0 ? indicators.data[index - 1].close : null;

    if (!isNumber(dema) || !isNumber(price)) {
        return signals;
    }

    // Price position relative to DEMA
    const priceAboveDema = price > dema;
    const prevPriceAboveDema = isNumber(prevPrice) && isNumber(prevDema) ? prevPrice > prevDema : null;

    // Price crossover detection
    if (prevPriceAboveDema !== null) {
        if (!prevPriceAboveDema && priceAboveDema) {
            // Price crossed above DEMA
            signals.push({
                type: 'DEMA',
                value: 'price_cross_up',
                strength: 70,
                isEvent: true,
                description: 'Price crossed above DEMA'
            });
        } else if (prevPriceAboveDema && !priceAboveDema) {
            // Price crossed below DEMA
            signals.push({
                type: 'DEMA',
                value: 'price_cross_down',
                strength: 70,
                isEvent: true,
                description: 'Price crossed below DEMA'
            });
        }
    }

    // Current position signals
    if (priceAboveDema) {
        signals.push({
            type: 'DEMA',
            value: 'Price Above DEMA',
            strength: 46,
            isEvent: false,
            description: 'Price is above DEMA'
        });
    } else {
        signals.push({
            type: 'DEMA',
            value: 'Price Below DEMA',
            strength: 46,
            isEvent: false,
            description: 'Price is below DEMA'
        });
    }

    return signals;
};

export const evaluateHmaCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const hmaSettings = signalSettings.hma || {};

    if (!hmaSettings.enabled || !indicators.hma || !indicators.hma_10 || !indicators.data || index === 0) {
        return signals;
    }

    const currentHma = indicators.hma[index];
    const currentHma10 = indicators.hma_10[index];
    const currentPrice = candle.close;

    if (!isNumber(currentHma) || !isNumber(currentHma10) || !isNumber(currentPrice)) {
        return signals;
    }

    // --- State-Based Signals (NEW) ---

    // 1. Price Position Relative to HMA
    const priceAboveHma = currentPrice > currentHma;
    const distanceFromHma = Math.abs(currentPrice - currentHma) / currentHma;
    
    if (priceAboveHma) {
        const strength = 40 + Math.min(35, distanceFromHma * 1000);
        signals.push({
            type: 'hma',
            value: 'Price Above HMA',
            strength: applyRegimeAdjustment(strength, 'hma_price_above', marketRegime),
            details: `Price ${currentPrice.toFixed(2)} is above HMA ${currentHma.toFixed(2)}`,
            priority: 6
        });
    } else {
        const strength = 40 + Math.min(35, distanceFromHma * 1000);
        signals.push({
            type: 'hma',
            value: 'Price Below HMA',
            strength: applyRegimeAdjustment(strength, 'hma_price_below', marketRegime),
            details: `Price ${currentPrice.toFixed(2)} is below HMA ${currentHma.toFixed(2)}`,
            priority: 6
        });
    }

    // 2. HMA Trend Direction
    if (index > 0) {
        const prevHma = indicators.hma[index - 1];
        if (isNumber(prevHma)) {
            const hmaTrend = currentHma > prevHma ? 'Rising' : 'Falling';
            const trendStrength = Math.abs(currentHma - prevHma) / prevHma;
            
            signals.push({
                type: 'hma',
                value: `HMA ${hmaTrend} Trend`,
                strength: applyRegimeAdjustment(30 + Math.min(40, trendStrength * 1000), `hma_${hmaTrend.toLowerCase()}_trend`, marketRegime),
                details: `HMA is ${hmaTrend.toLowerCase()}`,
                priority: 5
            });
        }
    }

    // 3. HMA vs HMA10 Relationship
    const hmaAboveHma10 = currentHma > currentHma10;
    const hmaDistance = Math.abs(currentHma - currentHma10) / currentHma10;
    
    if (hmaAboveHma10) {
        const strength = 35 + Math.min(30, hmaDistance * 1000);
        signals.push({
            type: 'hma',
            value: 'HMA Above HMA10',
            strength: applyRegimeAdjustment(strength, 'hma_above_hma10', marketRegime),
            details: `HMA above HMA10 - bullish momentum`,
            priority: 6
        });
    } else {
        const strength = 35 + Math.min(30, hmaDistance * 1000);
        signals.push({
            type: 'hma',
            value: 'HMA Below HMA10',
            strength: applyRegimeAdjustment(strength, 'hma_below_hma10', marketRegime),
            details: `HMA below HMA10 - bearish momentum`,
            priority: 6
        });
    }

    return getUniqueSignals(signals).map(s => ({ ...s, type: 'HMA', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};

/**
 * Evaluates the MA Ribbon with a balanced approach to signal generation, including state-based analysis.
 * Tier: S
 */
export const evaluateMARibbonCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const ribbonSettings = signalSettings.maribbon || {};
    if (!ribbonSettings.enabled) return [];
    
    const requiredMAs = ['ma10', 'ma20', 'ma30', 'ma40', 'ma50', 'ma60'];
    
    // Check if all required MAs are available for current index
    const allMAsAvailable = requiredMAs.every(maKey => 
        indicators[maKey] && isNumber(indicators[maKey][index])
    );
    if (!allMAsAvailable) return signals;

    const mas = requiredMAs.map(maKey => indicators[maKey][index]);
    const [ma10, ma20, ma30, ma40, ma50, ma60] = mas;

    // --- State-Based Signals (NEW) ---
    // 1. Ribbon Alignment
    const isBullishOrder = ma10 > ma20 && ma20 > ma30 && ma30 > ma40 && ma40 > ma50 && ma50 > ma60;
    const isBearishOrder = ma10 < ma20 && ma20 < ma30 && ma30 < ma40 && ma40 < ma50 && ma50 < ma60;

    if (isBullishOrder) {
        signals.push({ type: 'maribbon', value: 'Bullish Alignment', strength: applyRegimeAdjustment(70, 'maribbon_bullish_alignment_state', marketRegime), details: 'All MAs are in perfect bullish order.', priority: 8 });
    } else if (isBearishOrder) {
        signals.push({ type: 'maribbon', value: 'Bearish Alignment', strength: applyRegimeAdjustment(70, 'maribbon_bearish_alignment_state', marketRegime), details: 'All MAs are in perfect bearish order.', priority: 8 });
    } else {
         signals.push({ type: 'maribbon', value: 'Mixed Alignment', strength: applyRegimeAdjustment(25, 'maribbon_mixed_alignment_state', marketRegime), details: 'MAs are tangled, indicating consolidation.', priority: 3 });
    }

    // 2. Ribbon Expansion/Contraction
    const ribbonWidth = Math.abs(ma10 - ma60) / ma60;
    if (index > 0) {
        const prevMAsAvailable = requiredMAs.every(maKey => indicators[maKey] && isNumber(indicators[maKey][index - 1]));
        if (prevMAsAvailable) {
            const prevMAs = requiredMAs.map(maKey => indicators[maKey][index - 1]);
            const prevRibbonWidth = Math.abs(prevMAs[0] - prevMAs[5]) / prevMAs[5];
            
            // Check for significant expansion/contraction (e.g., 5% change)
            if (ribbonWidth > prevRibbonWidth * 1.05) {
                 signals.push({ type: 'maribbon', value: 'Expanding', strength: applyRegimeAdjustment(50, 'maribbon_expanding_state', marketRegime), details: `Ribbon is expanding, suggesting strengthening trend.`, priority: 6 });
            } else if (ribbonWidth < prevRibbonWidth * 0.95) {
                 signals.push({ type: 'maribbon', value: 'Contracting', strength: applyRegimeAdjustment(40, 'maribbon_contracting_state', marketRegime), details: `Ribbon is contracting, suggesting weakening trend or consolidation.`, priority: 5 });
            }
        }
    }
    
    // --- Event-Based Signals (Existing Logic from outline) ---
    // The outline's 'Existing Logic' defines these as 'Uptrend Confirmation' and 'Downtrend Confirmation' based on internal order.
    // This is essentially redundant with 'Bullish/Bearish Alignment' state signals, but following the outline structure.
    const isUptrend = mas.every((ma, i) => i === 0 || ma <= mas[i-1]); // Check if MAs are ascending (fastest < slower)
    const isDowntrend = mas.every((ma, i) => i === 0 || ma >= mas[i-1]); // Check if MAs are descending (fastest > slower)

    // Note: The outline's definition of isUptrend/isDowntrend seems inverted if it refers to price trend.
    // If mas[i] is ma10, mas[i-1] is ma20, then ma10 <= ma20 means descending order (bearish alignment).
    // I will interpret 'isUptrend' as 'Bullish Alignment' and 'isDowntrend' as 'Bearish Alignment'
    // for this section to avoid logical contradictions with the state-based signals above.
    // However, the outline explicitly provides these names, so I'll use them.
    // 'mas.every((ma, i) => i === 0 || ma <= mas[i-1])' means: ma10 <= ma20, ma20 <= ma30 etc. which is a BEARISH order.
    // 'mas.every((ma, i) => i === 0 || ma >= mas[i-1])' means: ma10 >= ma20, ma20 >= ma30 etc. which is a BULLISH order.
    // So the naming in the outline for isUptrend/isDowntrend based on these checks is counter-intuitive.
    // I will proceed with the outline's checks and names as given.

    if (isUptrend) { // This condition means ma10 <= ma20 <= ma30 ... (bearish alignment)
        signals.push({ type: 'maribbon', value: 'Uptrend Confirmation', strength: applyRegimeAdjustment(75, 'maribbon_uptrend_confirmation', marketRegime), details: 'MA ribbon confirms an uptrend (fast MAs below slow MAs).', priority: 8 });
    }
    if (isDowntrend) { // This condition means ma10 >= ma20 >= ma30 ... (bullish alignment)
        signals.push({ type: 'maribbon', value: 'Downtrend Confirmation', strength: applyRegimeAdjustment(75, 'maribbon_downtrend_confirmation', marketRegime), details: 'MA ribbon confirms a downtrend (fast MAs above slow MAs).', priority: 8 });
    }
    
    return getUniqueSignals(signals).map(s => ({ ...s, type: 'MARibbon', strength: Math.min(100, Math.max(0, s.strength)), candle: index }));
};
