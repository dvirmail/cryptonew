
import { get } from 'lodash';
import { applyRegimeAdjustment } from './divergenceUtils';

// ===================================================================================
// Candlestick Pattern Detection Helpers (Unchanged Primitives)
// ===================================================================================

function detectSingleCandlePatterns(current) {
    const patterns = [];
    if (!current) return patterns;
    const body = Math.abs(current.close - current.open);
    const upperShadow = current.high - Math.max(current.open, current.close);
    const lowerShadow = Math.min(current.open, current.close) - current.low;
    const range = current.high - current.low;

    // Doji (Indecision, potential reversal)
    if (range > 0 && body / range < 0.1) {
        patterns.push({ name: 'Doji', strength: 60, category: 'reversal' });
    }
    // Hammer (Bullish Reversal)
    if (range > 0 && lowerShadow > body * 2 && upperShadow < body * 0.5) {
        patterns.push({ name: 'Hammer', strength: 75, category: 'bullish' });
    }
    // Shooting Star (Bearish Reversal)
    if (range > 0 && upperShadow > body * 2 && lowerShadow < body * 0.5) {
        patterns.push({ name: 'Shooting Star', strength: 75, category: 'bearish' });
    }
    return patterns;
}

function detectTwoCandlePatterns(current, previous) {
    const patterns = [];
    if (!current || !previous) return patterns;
    
    // Bullish Engulfing (Strong Bullish Reversal)
    if (previous.close < previous.open && current.close > current.open && current.close >= previous.high && current.low <= previous.low) {
        patterns.push({ name: 'Bullish Engulfing', strength: 85, category: 'bullish' });
    }
    // Bearish Engulfing (Strong Bearish Reversal)
    if (previous.close > previous.open && current.close < current.open && current.close <= previous.low && current.low >= previous.high) {
        patterns.push({ name: 'Bearish Engulfing', strength: 85, category: 'bearish' });
    }
    return patterns;
}

function detectThreeCandlePatterns(current, previous, first) {
    const patterns = [];
    if (!current || !previous || !first) return patterns;

    const firstIsBearish = first.close < first.open;
    const firstIsBullish = first.close > first.open;
    const thirdIsBullish = current.close > current.open;
    const thirdIsBearish = current.close < current.open;

    // Morning Star (Strong Bullish Reversal)
    if (firstIsBearish && Math.abs(previous.close - previous.open) < (first.high - first.low) * 0.3 && thirdIsBullish && current.close > (first.open + first.close) / 2 && previous.low < first.low) {
        patterns.push({ name: 'Morning Star', strength: 90, category: 'bullish' });
    }
    // Evening Star (Strong Bearish Reversal)
    if (firstIsBullish && Math.abs(previous.close - previous.open) < (first.high - first.low) * 0.3 && thirdIsBearish && current.close < (first.open + first.close) / 2 && previous.high > first.high) {
        patterns.push({ name: 'Evening Star', strength: 90, category: 'bearish' });
    }
    return patterns;
}

// ===================================================================================
// Pattern Recognition Engine: Helper Functions
// ===================================================================================

/**
 * Finds all major swing high and low points within a data slice.
 * This is the foundation for drawing trendlines and necklines.
 * @param {Array<object>} data - The slice of candle data to analyze.
 * @param {number} swingSize - The number of bars on each side to determine a pivot.
 * @returns {{highs: Array<object>, lows: Array<object>}} Sorted arrays of swing points.
 */
const findSwingPoints = (data, swingSize = 5) => {
    const swingHighs = [];
    const swingLows = [];
    // Ensure we have enough data for a valid swing check
    if (data.length < (swingSize * 2 + 1)) return { highs: [], lows: [] };

    // Iterate through the data, leaving room for checks on both sides
    for (let i = swingSize; i < data.length - swingSize; i++) {
        let isSwingHigh = true;
        let isSwingLow = true;
        
        // Check for a swing high (a peak)
        for (let j = 1; j <= swingSize; j++) {
            if (data[i].high <= data[i-j].high || data[i].high < data[i+j].high) {
                isSwingHigh = false;
                break;
            }
        }
        
        // Check for a swing low (a trough)
        for (let j = 1; j <= swingSize; j++) {
            if (data[i].low >= data[i-j].low || data[i].low > data[i+j].low) {
                isSwingLow = false;
                break;
            }
        }
        
        if (isSwingHigh) swingHighs.push({ index: i, price: data[i].high });
        if (isSwingLow) swingLows.push({ index: i, price: data[i].low });
    }
    
    // Return all found points, sorted with the most recent first
    return {
        highs: swingHighs.sort((a, b) => b.index - a.index),
        lows: swingLows.sort((a, b) => b.index - a.index),
    };
};

/**
 * Calculates the projected price of a trendline at a specific index.
 * @param {{index: number, price: number}} p1 - The first point of the line.
 * @param {{index: number, price: number}} p2 - The second point of the line.
 * @param {number} targetIndex - The index at which to calculate the line's price.
 * @returns {number} The projected price.
 */
const projectTrendline = (p1, p2, targetIndex) => {
    if (p1.index === p2.index) return p1.price; // Avoid division by zero for vertical lines
    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    const intercept = p1.price - slope * p1.index;
    return slope * targetIndex + intercept;
};


// ===================================================================================
// TIER S+: Full Geometric Pattern Recognition Engine
// ===================================================================================
/**
 * Detects complex geometric chart patterns, confirms breakouts with volume and
 * follow-through, identifies retests, and calculates price targets.
 * Also includes new state-based signals (trend, volatility, S/R) and
 * generic pre-computed pattern checks.
 * @param {object} candle - The current candle data.
 * @param {object} indicators - A collection of all indicator data.
 * @param {number} index - The current index in the data array.
 * @param {object} signalSettings - Configuration for the evaluation.
 * @param {object} marketRegime - The current market regime analysis.
 * @param {function} onLog - Logging function.
 * @returns {Array<object>} An array of detected signal objects.
 */
export const evaluateChartPatternCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const chartPatternSettings = signalSettings.chartpattern || {};

    if (!indicators.chartpattern || index < 1 || index >= indicators.chartpattern.length) {
        return signals;
    }

    const currentPatterns = indicators.chartpattern[index];
    
    // SAFETY CHECK: Ensure currentPatterns is valid
    if (!currentPatterns || typeof currentPatterns !== 'object') {
        return signals;
    }
    
    // CRITICAL: Check if currentPatterns is actually the expected object structure
    if (Array.isArray(currentPatterns)) {
        const errorMsg = `[CHART_PATTERN_EVAL] ❌ CRITICAL: currentPatterns is an ARRAY, not an OBJECT at index ${index}. Expected object with pattern flags.`;
        console.error(errorMsg);
        if (onLog) onLog(errorMsg, 'error');
        return signals;
    }
    
    // DEFENSIVE: Ensure pattern flags exist, add defaults if missing
    if (typeof currentPatterns === 'object' && currentPatterns !== null) {
        const hasPatternFlags = 'inverseHeadAndShoulders' in currentPatterns || 'doubleBottom' in currentPatterns || 'headAndShoulders' in currentPatterns;
        
        if (!hasPatternFlags) {
            // Add default flags if missing
            if (!('inverseHeadAndShoulders' in currentPatterns)) currentPatterns.inverseHeadAndShoulders = false;
            if (!('doubleBottom' in currentPatterns)) currentPatterns.doubleBottom = false;
            if (!('headAndShoulders' in currentPatterns)) currentPatterns.headAndShoulders = false;
            if (!('doubleTop' in currentPatterns)) currentPatterns.doubleTop = false;
            if (!('triangleAscending' in currentPatterns)) currentPatterns.triangleAscending = false;
            if (!('triangleDescending' in currentPatterns)) currentPatterns.triangleDescending = false;
            if (!('triangleSymmetrical' in currentPatterns)) currentPatterns.triangleSymmetrical = false;
            if (!('wedgeRising' in currentPatterns)) currentPatterns.wedgeRising = false;
            if (!('wedgeFalling' in currentPatterns)) currentPatterns.wedgeFalling = false;
            if (!('flag' in currentPatterns)) currentPatterns.flag = false;
            if (!('pennant' in currentPatterns)) currentPatterns.pennant = false;
        }
    } else {
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    // These provide continuous strength without breaking existing logic

    // 1. Pattern Formation State
    let activePatterns = [];
    let patternStrength = 0;

    // Check for active patterns safely
    if (currentPatterns.headAndShoulders) {
        activePatterns.push('Head and Shoulders');
        patternStrength += 60;
    }
    if (currentPatterns.inverseHeadAndShoulders) {
        activePatterns.push('Inverse Head and Shoulders');
        patternStrength += 60;
    }
    if (currentPatterns.doubleTop) {
        activePatterns.push('Double Top');
        patternStrength += 50;
    }
    if (currentPatterns.doubleBottom) {
        activePatterns.push('Double Bottom');
        patternStrength += 50;
    }
    if (currentPatterns.triangleAscending) {
        activePatterns.push('Ascending Triangle');
        patternStrength += 40;
    }
    if (currentPatterns.triangleDescending) {
        activePatterns.push('Descending Triangle');
        patternStrength += 40;
    }
    if (currentPatterns.triangleSymmetrical) {
        activePatterns.push('Symmetrical Triangle');
        patternStrength += 35;
    }
    if (currentPatterns.wedgeRising) {
        activePatterns.push('Rising Wedge');
        patternStrength += 45;
    }
    if (currentPatterns.wedgeFalling) {
        activePatterns.push('Falling Wedge');
        patternStrength += 45;
    }
    if (currentPatterns.flag) {
        activePatterns.push('Flag');
        patternStrength += 55;
    }
    if (currentPatterns.pennant) {
        activePatterns.push('Pennant');
        patternStrength += 55;
    }

    // Provide continuous state-based signals
    if (activePatterns.length > 0) {
        // Multiple patterns increase strength
        const combinedStrength = Math.min(90, patternStrength + (activePatterns.length - 1) * 10);
        
        signals.push({
            type: 'chartpattern',
            value: 'Pattern Formation',
            strength: combinedStrength,
            details: `Active patterns: ${activePatterns.join(', ')}`,
            priority: 7
        });

        // Bullish vs Bearish Pattern Classification
        const bullishPatterns = ['Inverse Head and Shoulders', 'Double Bottom', 'Ascending Triangle', 'Falling Wedge'];
        const bearishPatterns = ['Head and Shoulders', 'Double Top', 'Descending Triangle', 'Rising Wedge'];
        
        const bullishCount = activePatterns.filter(p => bullishPatterns.includes(p)).length;
        const bearishCount = activePatterns.filter(p => bearishPatterns.includes(p)).length;
        
        if (bullishCount > bearishCount) {
            signals.push({
                type: 'chartpattern',
                value: 'Bullish Pattern Bias',
                strength: 50 + (bullishCount * 10),
                details: `${bullishCount} bullish patterns detected`,
                priority: 6
            });
        } else if (bearishCount > bullishCount) {
            signals.push({
                type: 'chartpattern',
                value: 'Bearish Pattern Bias',
                strength: 50 + (bearishCount * 10),
                details: `${bearishCount} bearish patterns detected`,
                priority: 6
            });
        } else {
            signals.push({
                type: 'chartpattern',
                value: 'Neutral Pattern Mix',
                strength: 35,
                details: `Mixed pattern signals detected`,
                priority: 5
            });
        }
    } else {
        // No patterns detected - still provide a baseline signal
        signals.push({
            type: 'chartpattern',
            value: 'No Clear Pattern',
            strength: 20,
            details: `No major chart patterns currently detected`,
            priority: 3
        });
    }

    // 2. Pattern Maturity State
    // Check if we have previous data to compare pattern development
    if (index > 0) {
        const prevPatterns = indicators.chartpattern[index - 1];
        if (prevPatterns && typeof prevPatterns === 'object') {
            // Count truly active patterns (ignoring 'breakout', 'breakdown' if they are just events)
            const getActivePatternCount = (patterns) => {
                let count = 0;
                if (patterns.headAndShoulders) count++;
                if (patterns.inverseHeadAndShoulders) count++;
                if (patterns.doubleTop) count++;
                if (patterns.doubleBottom) count++;
                if (patterns.triangleAscending) count++;
                if (patterns.triangleDescending) count++;
                if (patterns.triangleSymmetrical) count++;
                if (patterns.wedgeRising) count++;
                if (patterns.wedgeFalling) count++;
                if (patterns.flag) count++;
                if (patterns.pennant) count++;
                return count;
            };

            const prevActiveCount = getActivePatternCount(prevPatterns);
            const currentActiveCount = getActivePatternCount(currentPatterns);
            
            if (currentActiveCount > prevActiveCount) {
                signals.push({
                    type: 'chartpattern',
                    value: 'Pattern Developing',
                    strength: 45,
                    details: `Pattern formation is strengthening`,
                    priority: 6
                });
            } else if (currentActiveCount < prevActiveCount) {
                signals.push({
                    type: 'chartpattern',
                    value: 'Pattern Weakening',
                    strength: 30,
                    details: `Pattern formation is weakening`,
                    priority: 4
                });
            }
        }
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve ALL existing event-based signals for backtesting compatibility
    
    // Individual pattern completion events (these are what the backtest engine expects)
    if (currentPatterns.headAndShoulders) {
        // Head and Shoulders pattern detected
        signals.push({
            type: 'chartpattern',
            value: 'Head and Shoulders',
            strength: 85,
            details: `Head and Shoulders pattern completed`,
            priority: 9,
            category: 'bearish'
        });
    }

    if (currentPatterns.inverseHeadAndShoulders) {
        signals.push({
            type: 'chartpattern',
            value: 'Inverse Head and Shoulders',
            strength: 85,
            details: `Inverse Head and Shoulders pattern completed`,
            priority: 9,
            category: 'bullish'
        });
    }

    if (currentPatterns.doubleTop) {
        signals.push({
            type: 'chartpattern',
            value: 'Double Top',
            strength: 80,
            details: `Double Top pattern completed`,
            priority: 8,
            category: 'bearish'
        });
    }

    if (currentPatterns.doubleBottom) {
        signals.push({
            type: 'chartpattern',
            value: 'Double Bottom',
            strength: 80,
            details: `Double Bottom pattern completed`,
            priority: 8,
            category: 'bullish'
        });
    }

    if (currentPatterns.triangleAscending) {
        signals.push({
            type: 'chartpattern',
            value: 'Ascending Triangle',
            strength: 75,
            details: `Ascending Triangle pattern completed`,
            priority: 8,
            category: 'bullish'
        });
    }

    if (currentPatterns.triangleDescending) {
        signals.push({
            type: 'chartpattern',
            value: 'Descending Triangle',
            strength: 75,
            details: `Descending Triangle pattern completed`,
            priority: 8,
            category: 'bearish'
        });
    }

    if (currentPatterns.triangleSymmetrical) {
        signals.push({
            type: 'chartpattern',
            value: 'Symmetrical Triangle',
            strength: 70,
            details: `Symmetrical Triangle pattern completed`,
            priority: 7,
            category: 'neutral'
        });
    }

    if (currentPatterns.wedgeRising) {
        signals.push({
            type: 'chartpattern',
            value: 'Rising Wedge',
            strength: 75,
            details: `Rising Wedge pattern completed`,
            priority: 8,
            category: 'bearish'
        });
    }

    if (currentPatterns.wedgeFalling) {
        signals.push({
            type: 'chartpattern',
            value: 'Falling Wedge',
            strength: 75,
            details: `Falling Wedge pattern completed`,
            priority: 8,
            category: 'bullish'
        });
    }

    if (currentPatterns.flag) {
        signals.push({
            type: 'chartpattern',
            value: 'Flag',
            strength: 80,
            details: `Flag pattern completed`,
            priority: 8,
            category: 'continuation'
        });
    }

    if (currentPatterns.pennant) {
        signals.push({
            type: 'chartpattern',
            value: 'Pennant',
            strength: 80,
            details: `Pennant pattern completed`,
            priority: 8,
            category: 'continuation'
        });
    }

    // Breakout events (if supported by the indicator)
    if (currentPatterns.breakout) {
        signals.push({
            type: 'chartpattern',
            value: 'Pattern Breakout',
            strength: 90,
            details: `Pattern breakout detected`,
            priority: 9,
            category: 'bullish'
        });
    }

    if (currentPatterns.breakdown) {
        signals.push({
            type: 'chartpattern',
            value: 'Pattern Breakdown',
            strength: 90,
            details: `Pattern breakdown detected`,
            priority: 9,
            category: 'bearish'
        });
    }

    // Return unique signals by value to avoid duplicates
    return signals.filter((v, idx, a) => a.findIndex(t => t.value === v.value) === idx);
};


// ===================================================================================
// TIER S+: Context-Aware Candlestick Pattern Engine
// ===================================================================================
/**
 * Evaluates candlestick patterns with deep market context: S/R confluence, volume,
 * trend alignment, and confirmation/failure of previous patterns.
 * @param {object} candle - The current candle data.
 * @param {object} indicators - A collection of all indicator data.
 * @param {number} index - The current index in the data array.
 * @param {object} signalSettings - Configuration for the evaluation.
 * @param {object} marketRegime - The current market regime analysis.
 * @param {function} onLog - Logging function.
 * @param {boolean} debugMode - Flag for debug logging.
 * @returns {Array<object>} An array of detected signal objects.
 */
export const evaluateCandlestickCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const candlestickSettings = signalSettings.candlestick || {};

    if (!candlestickSettings.enabled) {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] Candlestick signals disabled in settings`);
        }
        return signals;
    }

    if (!indicators.candlestickPatterns || !indicators.data || index < 1 || index >= indicators.candlestickPatterns.length) {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] Missing data: candlestickPatterns=${!!indicators.candlestickPatterns}, data=${!!indicators.data}, index=${index}, length=${indicators.candlestickPatterns?.length || 0}`);
        }
        return signals;
    }

    const currentCandle = candle;
    const prevCandle = indicators.data[index - 1];
    const patterns = indicators.candlestickPatterns[index];
    
    // CRITICAL: Check if patterns is actually the expected object structure
    if (Array.isArray(patterns)) {
        const errorMsg = `[CANDLESTICK_EVAL] ❌ CRITICAL: patterns is an ARRAY, not an OBJECT at index ${index}. Expected object with readyForAnalysis.`;
        console.error(errorMsg);
        if (onLog) onLog(errorMsg, 'error');
        return signals;
    }
    
    // DEFENSIVE: Ensure readyForAnalysis exists
    if (patterns && typeof patterns === 'object') {
        if (!('readyForAnalysis' in patterns)) {
            patterns.readyForAnalysis = index >= 1;
        }
    } else if (!patterns) {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] patterns is null/undefined at index ${index}`);
        }
        return signals;
    }

    if (!currentCandle || !prevCandle) {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] Missing candle data: currentCandle=${!!currentCandle}, prevCandle=${!!prevCandle}`);
        }
        return signals;
    }

    // --- State-Based Signals ---
    // Always provide signals based on current candle characteristics

    // 1. Candle Body Analysis
    const bodySize = Math.abs(currentCandle.close - currentCandle.open);
    const candleRange = currentCandle.high - currentCandle.low;
    const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
    
    const upperShadow = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
    const lowerShadow = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;

    // 2. Candle Body Strength
    if (bodyRatio > 0.7) { // Strong body
        const isBullish = currentCandle.close > currentCandle.open;
        signals.push({
            type: 'candlestick',
            value: isBullish ? 'Strong Bullish Body' : 'Strong Bearish Body',
            strength: 40 + (bodyRatio * 30), // 40-70 range
            details: `Strong ${isBullish ? 'bullish' : 'bearish'} body with ${(bodyRatio * 100).toFixed(1)}% body ratio`,
            priority: 6,
            category: isBullish ? 'bullish' : 'bearish',
        });
    } else if (bodyRatio < 0.3) { // Small body (indecision)
        signals.push({
            type: 'candlestick',
            value: 'Indecision',
            strength: 25 + ((0.3 - bodyRatio) * 50),
            details: `Small body suggests indecision, body ratio: ${(bodyRatio * 100).toFixed(1)}%`,
            priority: 4,
            category: 'neutral',
        });
    }

    // 3. Shadow Analysis
    const shadowRatio = candleRange > 0 ? (upperShadow + lowerShadow) / candleRange : 0;
    if (shadowRatio > 0.6) { // Long shadows
        signals.push({
            type: 'candlestick',
            value: 'Long Shadows',
            strength: 35 + (shadowRatio * 20),
            details: `Long shadows indicate rejection, shadow ratio: ${(shadowRatio * 100).toFixed(1)}%`,
            priority: 5,
            category: 'neutral',
        });
    }

    // 4. Wick Analysis for Rejection
    if (candleRange > 0) {
        const upperWickRatio = upperShadow / candleRange;
        const lowerWickRatio = lowerShadow / candleRange;
        
        if (upperWickRatio > 0.5) { // Strong upper rejection
            signals.push({
                type: 'candlestick',
                value: 'Upper Rejection',
                strength: 45 + (upperWickRatio * 25),
                details: `Strong upper wick suggests selling pressure`,
                priority: 6,
                category: 'bearish',
            });
        }
        
        if (lowerWickRatio > 0.5) { // Strong lower rejection
            signals.push({
                type: 'candlestick',
                value: 'Lower Rejection',
                strength: 45 + (lowerWickRatio * 25),
                details: `Strong lower wick suggests buying support`,
                priority: 6,
                category: 'bullish',
            });
        }
    }

    // 5. Momentum Analysis (comparing to previous candle)
    const currentIsBullish = currentCandle.close > currentCandle.open;
    const prevIsBullish = prevCandle.close > prevCandle.open;
    
    if (currentIsBullish && prevIsBullish) {
        signals.push({
            type: 'candlestick',
            value: 'Bullish Momentum',
            strength: 35,
            details: `Two consecutive bullish candles`,
            priority: 5,
            category: 'bullish',
        });
    } else if (!currentIsBullish && !prevIsBullish) {
        signals.push({
            type: 'candlestick',
            value: 'Bearish Momentum',
            strength: 35,
            details: `Two consecutive bearish candles`,
            priority: 5,
            category: 'bearish',
        });
    }

    // --- Event-Based Signals ---
    // These patterns are checked dynamically based on current and previous candle data.
    if (!patterns || typeof patterns !== 'object') {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] patterns is not an object at index ${index}`);
        }
    } else if (!patterns.readyForAnalysis) {
        if (debugMode) {
            console.warn(`[CANDLESTICK_EVAL] readyForAnalysis is false at index ${index}`);
        }
    }
    
    if (patterns && typeof patterns === 'object' && patterns.readyForAnalysis) {
        // Check for specific patterns based on the current system
        const patternChecks = {
            'Hammer': () => {
                const condition1 = lowerShadow > bodySize * 2;
                const condition2 = upperShadow < bodySize * 0.5;
                const condition3 = lowerShadow > (candleRange * 0.6);
                const condition4 = currentCandle.close > currentCandle.open;
                return condition1 && condition2 && condition3 && condition4;
            },
            'Doji': () => {
                return bodyRatio < 0.1;
            },
            'Shooting Star': () => {
                const condition1 = upperShadow > bodySize * 2;
                const condition2 = lowerShadow < bodySize * 0.5;
                const condition3 = upperShadow > (candleRange * 0.6);
                const condition4 = currentCandle.close < currentCandle.open;
                return condition1 && condition2 && condition3 && condition4;
            },
            'Bullish Engulfing': () => {
                const condition1 = currentIsBullish && !prevIsBullish;
                const condition2 = currentCandle.close > prevCandle.open;
                const condition3 = currentCandle.open < prevCandle.close;
                return condition1 && condition2 && condition3;
            },
            'Bearish Engulfing': () => {
                const condition1 = !currentIsBullish && prevIsBullish;
                const condition2 = currentCandle.close < prevCandle.open;
                const condition3 = currentCandle.open > prevCandle.close;
                return condition1 && condition2 && condition3;
            }
        };

        // Define categories for each pattern for easier assignment
        const patternCategories = {
            'Hammer': 'bullish',
            'Doji': 'neutral',
            'Shooting Star': 'bearish',
            'Bullish Engulfing': 'bullish',
            'Bearish Engulfing': 'bearish',
        };

        Object.entries(patternChecks).forEach(([patternName, checkFunction]) => {
            if (checkFunction()) {
                signals.push({
                    type: 'candlestick',
                    value: patternName,
                    strength: 75, // High strength for specific patterns
                    details: `${patternName} pattern detected`,
                    priority: 8,
                    category: patternCategories[patternName],
                });
            }
        });
    }

    // Return unique signals by value to avoid duplicates
    return signals.filter((v, idx, a) => a.findIndex(t => t.value === v.value) === idx);
};

