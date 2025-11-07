
import { get } from 'lodash';
import { applyRegimeAdjustment } from './divergenceUtils';

/**
 * =================================================================================
 * NEW: Generic Divergence Detection Utility
 * =================================================================================
 * This function identifies bullish and bearish divergences between price and an oscillator.
 * It can be used by any signal evaluation function as a confirmation layer.
 *
 * @param {Array} priceData - Array of candle objects ({high, low}).
 * @param {Array} indicatorData - Array of indicator values (e.g., RSI, MACD).
 * @param {number} index - The current candle index.
 * @param {Object} settings - Divergence-specific settings.
 * @returns {Object|null} - An object describing the divergence if found, otherwise null.
 */
const evaluateSRGeneralDivergence = (priceData, indicatorData, index, settings = {}) => {
    const lookback = settings.lookback || 20;
    const minSeparation = settings.minSeparation || 5; // Min bars between pivots

    if (index < lookback || !indicatorData || indicatorData.length <= index) {
        return null;
    }

    // Helper to find the last two significant pivots (lows for bullish, highs for bearish)
    const findPivots = (data, type) => {
        const pivots = [];
        for (let i = index - 1; i > index - lookback && i > 0; i--) {
            const isPivotLow = data[i].low < data[i - 1].low && data[i].low < data[i + 1].low;
            const isPivotHigh = data[i].high > data[i - 1].high && data[i].high > data[i + 1].high;

            if (type === 'low' && isPivotLow) {
                pivots.push({ value: data[i].low, index: i });
            } else if (type === 'high' && isPivotHigh) {
                pivots.push({ value: data[i].high, index: i });
            }
            if (pivots.length === 2) break;
        }
        return pivots;
    };
    
    // --- Bearish Divergence Check (Higher Highs in Price, Lower Highs in Indicator) ---
    const highPivots = findPivots(priceData, 'high');
    if (highPivots.length === 2 && (highPivots[0].index - highPivots[1].index >= minSeparation)) {
        const [recentPriceHigh, prevPriceHigh] = [priceData[index].high, highPivots[1].value];
        const [recentIndicatorHigh, prevIndicatorHigh] = [indicatorData[index], indicatorData[highPivots[1].index]];

        if (recentPriceHigh > prevPriceHigh && recentIndicatorHigh < prevIndicatorHigh) {
            return {
                type: 'bearish_divergence',
                strength: 25, // Base strength contribution for divergence
                details: `Bearish divergence detected between price and indicator over ${index - highPivots[1].index} bars.`
            };
        }
    }

    // --- Bullish Divergence Check (Lower Lows in Price, Higher Lows in Indicator) ---
    const lowPivots = findPivots(priceData, 'low');
    if (lowPivots.length === 2 && (lowPivots[0].index - lowPivots[1].index >= minSeparation)) {
        const [recentPriceLow, prevPriceLow] = [priceData[index].low, lowPivots[1].value];
        const [recentIndicatorLow, prevIndicatorLow] = [indicatorData[index], indicatorData[lowPivots[1].index]];
        
        if (recentPriceLow < prevPriceLow && recentIndicatorLow > prevIndicatorLow) {
            return {
                type: 'bullish_divergence',
                strength: 25,
                details: `Bullish divergence detected between price and indicator over ${index - lowPivots[1].index} bars.`
            };
        }
    }

    return null;
};


/**
 * Evaluates support and resistance conditions with stricter rules for significance.
 * This refined version focuses on confirmed bounces/rejections and breakouts with follow-through
 * to reduce the number of low-quality signals.
 *
 * @param {object} candle - The current candle data { open, high, low, close }.
 * @param {object} indicators - An object containing all indicator data, including 'supportresistance', 'rsi', 'atr'.
 * @param {number} index - The current candle's index in the data array.
 * @param {object} signalSettings - The strategy settings object.
 * @param {string} marketRegime - The current market regime (e.g., 'trending', 'ranging').
 * @param {function} onLog - A logging function.
 * @param {boolean} debugMode - Indicates if debug mode is active.
 * @returns {Array<object>} - An array of generated signal objects.
 */
export const evaluateSupportResistanceCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const srSettings = signalSettings.supportresistance || {};

    // DEBUG: Log entry and initial conditions
    if (debugMode && onLog) {
        //onLog(`[SR_EVAL] Starting evaluation: index=${index}, hasSupportResistance=${!!indicators.supportresistance}, srLength=${indicators.supportresistance?.length || 0}, sr[index]=${!!indicators.supportresistance?.[index]}, index<1=${index < 1}`, 'debug');
        if (indicators.supportresistance && indicators.supportresistance.length > 0) {
            const srAtIndex = indicators.supportresistance[index];
            //onLog(`[SR_EVAL] Raw value at index ${index}: ${srAtIndex ? JSON.stringify(srAtIndex) : 'null'} (type=${typeof srAtIndex}, isNull=${srAtIndex === null}, isUndefined=${srAtIndex === undefined}, isEmpty=${srAtIndex !== null && srAtIndex !== undefined && typeof srAtIndex === 'object' && Object.keys(srAtIndex).length === 0})`, 'debug');
            
            // Check data quality across the array
            let validCount = 0;
            let nullCount = 0;
            let emptyCount = 0;
            for (let i = Math.max(0, index - 5); i < Math.min(indicators.supportresistance.length, index + 5); i++) {
                const val = indicators.supportresistance[i];
                if (val === null || val === undefined) {
                    nullCount++;
                } else if (typeof val === 'object' && (!val.support || val.support.length === 0) && (!val.resistance || val.resistance.length === 0)) {
                    emptyCount++;
                } else if (typeof val === 'object') {
                    validCount++;
                }
            }
            //onLog(`[SR_EVAL] Data quality near index ${index} (±5): ${validCount} valid, ${nullCount} null, ${emptyCount} empty`, 'debug');
            
            if (srAtIndex === null || srAtIndex === undefined) {
                // Check what the last valid index is
                let lastValidIndex = -1;
                let lastValidValue = null;
                for (let i = index; i >= 0; i--) {
                    if (indicators.supportresistance[i] && typeof indicators.supportresistance[i] === 'object') {
                        const val = indicators.supportresistance[i];
                        // Check if it has meaningful data
                        if ((val.support && val.support.length > 0) || (val.resistance && val.resistance.length > 0)) {
                            lastValidIndex = i;
                            lastValidValue = val;
                            break;
                        }
                    }
                }
                //onLog(`[SR_EVAL] Last valid Support/Resistance found at index ${lastValidIndex}: ${lastValidValue ? JSON.stringify(lastValidValue) : 'none'}`, 'debug');
                
                // Also check forward to see when valid data starts
                let nextValidIndex = -1;
                for (let i = index + 1; i < Math.min(indicators.supportresistance.length, index + 10); i++) {
                    if (indicators.supportresistance[i] && typeof indicators.supportresistance[i] === 'object') {
                        const val = indicators.supportresistance[i];
                        if ((val.support && val.support.length > 0) || (val.resistance && val.resistance.length > 0)) {
                            nextValidIndex = i;
                            break;
                        }
                    }
                }
                if (nextValidIndex >= 0) {
                    //onLog(`[SR_EVAL] Next valid Support/Resistance found at index ${nextValidIndex}`, 'debug');
                }
            }
        }
    }

    if (!indicators.supportresistance || index < 1) {
        if (debugMode && onLog) {
            //onLog(`[SR_EVAL] ❌ Early exit - Data/Index: hasSupportResistance=${!!indicators.supportresistance}, index=${index}, index<1=${index < 1}`, 'debug');
            if (indicators.supportresistance) {
                let validCount = 0;
                let nullCount = 0;
                for (let i = 0; i < Math.min(indicators.supportresistance.length, index + 5); i++) {
                    if (indicators.supportresistance[i] && typeof indicators.supportresistance[i] === 'object') {
                        validCount++;
                    } else {
                        nullCount++;
                    }
                }
                //onLog(`[SR_EVAL] Data quality: ${validCount} valid, ${nullCount} null in first ${Math.min(indicators.supportresistance.length, index + 5)} elements`, 'debug');
            }
        }
        return signals;
    }

    const currentLevels = indicators.supportresistance[index];
    const currentPrice = candle.close;
    const prevPrice = indicators.data[index - 1]?.close;

    // SAFETY CHECK: Ensure currentLevels is valid
    if (!currentLevels || typeof currentLevels !== 'object') {
        // Return empty array - invalid data structure, no signals possible
        // No fallback needed - empty arrays are handled fine by signal matching
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    // These provide continuous strength without breaking existing logic

    // 1. Price Position Relative to Levels
    let nearestSupport = null;
    let nearestResistance = null;
    let supportDistance = Infinity;
    let resistanceDistance = Infinity;

    // Safely extract support levels
    const supportLevels = [];
    if (currentLevels.support) {
        if (Array.isArray(currentLevels.support)) {
            supportLevels.push(...currentLevels.support);
        } else if (typeof currentLevels.support === 'number') {
            supportLevels.push(currentLevels.support);
        }
    }

    // Safely extract resistance levels
    const resistanceLevels = [];
    if (currentLevels.resistance) {
        if (Array.isArray(currentLevels.resistance)) {
            resistanceLevels.push(...currentLevels.resistance);
        } else if (typeof currentLevels.resistance === 'number') {
            resistanceLevels.push(currentLevels.resistance);
        }
    }

    // DEBUG: Log extracted levels
    if (debugMode && onLog) {
        //onLog(`[SR_EVAL] Extracted levels: supportLevels=${supportLevels.length} [${supportLevels.slice(0, 5).map(l => l?.toFixed(2)).join(', ')}${supportLevels.length > 5 ? '...' : ''}], resistanceLevels=${resistanceLevels.length} [${resistanceLevels.slice(0, 5).map(l => l?.toFixed(2)).join(', ')}${resistanceLevels.length > 5 ? '...' : ''}]`, 'debug');
        //onLog(`[SR_EVAL] currentLevels keys: ${Object.keys(currentLevels).join(', ')}`, 'debug');
        if (currentLevels.support !== undefined) {
            //onLog(`[SR_EVAL] currentLevels.support type: ${typeof currentLevels.support}, isArray: ${Array.isArray(currentLevels.support)}, value: ${JSON.stringify(currentLevels.support)}`, 'debug');
        }
        if (currentLevels.resistance !== undefined) {
            //onLog(`[SR_EVAL] currentLevels.resistance type: ${typeof currentLevels.resistance}, isArray: ${Array.isArray(currentLevels.resistance)}, value: ${JSON.stringify(currentLevels.resistance)}`, 'debug');
        }
    }

    // Find nearest support level (must be BELOW current price)
    for (const level of supportLevels) {
        if (typeof level === 'number' && level < currentPrice) {
            const distance = Math.abs(currentPrice - level);
            if (distance < supportDistance) {
                supportDistance = distance;
                nearestSupport = level;
            }
        }
    }

    // Find nearest resistance level (must be ABOVE current price)
    for (const level of resistanceLevels) {
        if (typeof level === 'number' && level > currentPrice) {
            const distance = Math.abs(level - currentPrice);
            if (distance < resistanceDistance) {
                resistanceDistance = distance;
                nearestResistance = level;
            }
        }
    }


    // DEBUG: Log nearest levels found
    if (debugMode && onLog) {
        //onLog(`[SR_EVAL] Nearest levels: nearestSupport=${nearestSupport ? nearestSupport.toFixed(2) : 'null'}, supportDistance=${supportDistance !== Infinity ? supportDistance.toFixed(2) : 'Infinity'}, nearestResistance=${nearestResistance ? nearestResistance.toFixed(2) : 'null'}, resistanceDistance=${resistanceDistance !== Infinity ? resistanceDistance.toFixed(2) : 'Infinity'}`, 'debug');
    }

    // 2. Distance-Based Strength Signals
    // const priceThreshold = currentPrice * 0.02; // 2% threshold for "near" levels (not used directly in new logic)

    if (nearestSupport !== null) {
        const supportProximity = supportDistance / currentPrice;
        if (supportProximity < 0.01) { // Very close to support (within 1%)
            signals.push({
                type: 'supportresistance',
                value: 'At Support',
                strength: 70,
                details: `Price is very close to support level at ${nearestSupport.toFixed(2)}`,
                priority: 8
            });
        } else if (supportProximity < 0.03) { // Near support (within 3%)
            const strength = 50 + Math.min(20, (0.03 - supportProximity) * 1000);
            signals.push({
                type: 'supportresistance',
                value: 'Near Support',
                strength: strength,
                details: `Price approaching support level at ${nearestSupport.toFixed(2)}`,
                priority: 6
            });
        } else {
            // Always generate a signal if we have a nearest support, even if it's far
            const strength = 25 + Math.min(15, (1 / supportProximity) * 5);
            signals.push({
                type: 'supportresistance',
                value: 'Above Support',
                strength: strength,
                details: `Price above support level at ${nearestSupport.toFixed(2)}`,
                priority: 4
            });
        }
    }

        if (nearestResistance !== null) {
            const resistanceProximity = resistanceDistance / currentPrice;
        if (resistanceProximity < 0.01) { // Very close to resistance (within 1%)
            signals.push({
                type: 'supportresistance',
                value: 'At Resistance',
                strength: 70,
                details: `Price is very close to resistance level at ${nearestResistance.toFixed(2)}`,
                priority: 8
            });
        } else if (resistanceProximity < 0.03) { // Near resistance (within 3%)
            const strength = 50 + Math.min(20, (0.03 - resistanceProximity) * 1000);
            signals.push({
                type: 'supportresistance',
                value: 'Near Resistance',
                strength: strength,
                details: `Price approaching resistance level at ${nearestResistance.toFixed(2)}`,
                priority: 6
            });
        } else {
            // Always generate a signal if we have a nearest resistance, even if it's far
            const strength = 25 + Math.min(15, (1 / resistanceProximity) * 5);
            signals.push({
                type: 'supportresistance',
                value: 'Below Resistance',
                strength: strength,
                details: `Price below resistance level at ${nearestResistance.toFixed(2)}`,
                priority: 4
            });
        }
    }

    // 3. Level Density State
    const totalLevels = supportLevels.length + resistanceLevels.length;
    if (totalLevels >= 4) {
        signals.push({
            type: 'supportresistance',
            value: 'High Level Density',
            strength: 45,
            details: `${totalLevels} significant levels detected - high structure`,
            priority: 5
        });
    } else if (totalLevels >= 2) {
        signals.push({
            type: 'supportresistance',
            value: 'Moderate Level Density',
            strength: 35,
            details: `${totalLevels} significant levels detected`,
            priority: 4
        });
    } else if (totalLevels >= 1) {
        signals.push({
            type: 'supportresistance',
            value: 'Low Level Density',
            strength: 25,
            details: `${totalLevels} significant level detected`,
            priority: 3
        });
    }

    // 4. Price Action Relative to Levels
    if (prevPrice && nearestSupport !== null && nearestResistance !== null && nearestResistance > nearestSupport) {
        const priceRange = nearestResistance - nearestSupport;
        if (priceRange > 0) { // Avoid division by zero
            const pricePosition = (currentPrice - nearestSupport) / priceRange;
            
            if (pricePosition > 0.8) {
                signals.push({
                    type: 'supportresistance',
                    value: 'Upper Range',
                    strength: 40,
                    details: `Price in upper ${((1 - pricePosition) * 100).toFixed(0)}% of range`,
                    priority: 5
                });
            } else if (pricePosition < 0.2) {
                signals.push({
                    type: 'supportresistance',
                    value: 'Lower Range',
                    strength: 40,
                    details: `Price in lower ${(pricePosition * 100).toFixed(0)}% of range`,
                    priority: 5
                });
            } else {
                signals.push({
                    type: 'supportresistance',
                    value: 'Middle Range',
                    strength: 30,
                    details: `Price in middle of support/resistance range`,
                    priority: 4
                });
            }
        }
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve ALL existing event-based signals for backtesting compatibility

    // Support/Resistance Touch Events
    if (nearestSupport !== null && Math.abs(currentPrice - nearestSupport) / currentPrice < 0.005) {
        signals.push({
            type: 'supportresistance',
            value: 'Support Touch',
            strength: 90,
            details: `Price touched support level at ${nearestSupport.toFixed(2)}`,
            priority: 9
        });
    }

    if (nearestResistance !== null && Math.abs(currentPrice - nearestResistance) / currentPrice < 0.005) {
        signals.push({
            type: 'supportresistance',
            value: 'Resistance Touch',
            strength: 90,
            details: `Price touched resistance level at ${nearestResistance.toFixed(2)}`,
            priority: 9
        });
    }

    // Breakout/Breakdown Events
    if (prevPrice !== undefined && nearestResistance !== null && currentPrice > nearestResistance && prevPrice <= nearestResistance) {
        signals.push({
            type: 'supportresistance',
            value: 'Resistance Breakout',
            strength: 90,
            details: `Price broke above resistance level at ${nearestResistance.toFixed(2)}`,
            priority: 9
        });
    }

    if (prevPrice !== undefined && nearestSupport !== null && currentPrice < nearestSupport && prevPrice >= nearestSupport) {
        signals.push({
            type: 'supportresistance',
            value: 'Support Breakdown',
            strength: 90,
            details: `Price broke below support level at ${nearestSupport.toFixed(2)}`,
            priority: 9
        });
    }

    // Bounce Events
    if (prevPrice !== undefined && nearestSupport !== null && 
        prevPrice < nearestSupport * 1.01 && prevPrice > nearestSupport * 0.99 && 
        currentPrice > prevPrice) {
        signals.push({
            type: 'supportresistance',
            value: 'Support Bounce',
            strength: 80,
            details: `Price bounced off support level at ${nearestSupport.toFixed(2)}`,
            priority: 8
        });
    }

    if (prevPrice !== undefined && nearestResistance !== null && 
        prevPrice > nearestResistance * 0.99 && prevPrice < nearestResistance * 1.01 && 
        currentPrice < prevPrice) {
        signals.push({
            type: 'supportresistance',
            value: 'Resistance Rejection',
            strength: 80,
            details: `Price rejected at resistance level at ${nearestResistance.toFixed(2)}`,
            priority: 8
        });
    }

    // No fallback signal - return empty array if no levels detected
    // This is intentional: empty arrays are handled fine by the signal matching logic,
    // and fallback signals (strength 20) add noise without providing value
    // Strategies require specific signal values to match, so "No Clear Levels" never matches anyway
    if (signals.length === 0) {
        // Always check for bugs (this is critical)
        if (debugMode && onLog && totalLevels >= 1) {
            onLog(`[SR_EVAL] ⚠️ BUG DETECTED: totalLevels=${totalLevels} (should trigger Level Density signal) but signals.length=0!`, 'error');
            onLog(`[SR_EVAL] This indicates a code logic error - Level Density check should have fired!`, 'error');
        }
        // Return empty array - no fallback signal needed
    }

    return signals;
};

/**
 * Analyzes current price interaction with pivot points using a proximity-first approach.
 * @param {Array<object>} pivotData - The full array of pivot points.
 * @param {Array<object>} priceData - The full klineData array.
 * @param {number} currentIndex - The index of the current candle in priceData.
 * @returns {Array<object>|null} An array of significant interaction objects or null.
 */
export const analyzePivotInteraction = (pivotData, priceData, currentIndex) => {
    if (!pivotData || !priceData || currentIndex < 1) return null;

    const currentCandle = priceData[currentIndex];
    const prevCandle = priceData[currentIndex - 1];
    const currentPivots = pivotData[currentIndex];

    if (!currentPivots) return null;

    // --- Step 1: Flatten all available pivot levels into a single list with metadata ---
    const allLevels = [];
    const pivotTypes = ['traditional', 'fibonacci', 'woodie', 'camarilla', 'weekly'];

    pivotTypes.forEach(pivotType => {
        if (currentPivots[pivotType]) {
            Object.entries(currentPivots[pivotType]).forEach(([level, price]) => {
                if (typeof price === 'number' && !isNaN(price)) {
                    allLevels.push({
                        price,
                        levelName: `${pivotType}_${level}`,
                        isResistance: level.startsWith('r') || level.startsWith('h'), // Heuristic for resistance
                        isSupport: level.startsWith('s') || level.startsWith('l'),     // Heuristic for support
                        priority: 1 // Base priority
                    });
                }
            });
        }
    });

    // Add high-priority confluence zones
    if (currentPivots.confluence && currentPivots.confluence.length > 0) {
        currentPivots.confluence.forEach(confluence => {
            if (typeof confluence.price === 'number' && !isNaN(confluence.price)) {
                allLevels.push({
                    price: confluence.price,
                    levelName: `confluence_${confluence.strength}`,
                    // Confluence can be both, determination happens at interaction
                    isResistance: true, 
                    isSupport: true,
                    priority: confluence.strength, // Use confluence strength as priority
                    isHighPriority: true,
                    types: confluence.types,
                });
            }
        });
    }

    if (allLevels.length === 0) return null;

    // --- Step 2: Filter by Proximity - Find the CLOSEST levels bracketing the price ---
    const resistanceLevels = allLevels.filter(p => p.isResistance && p.price > currentCandle.close);
    const supportLevels = allLevels.filter(p => p.isSupport && p.price < currentCandle.close);
    
    // Sort to find the nearest ones
    resistanceLevels.sort((a, b) => a.price - b.price);
    supportLevels.sort((a, b) => b.price - a.price);

    // We are only interested in the levels price is *actually* interacting with.
    // These are typically the first support below and first resistance above.
    const relevantLevels = new Set();
    if (resistanceLevels.length > 0) relevantLevels.add(resistanceLevels[0]);
    if (supportLevels.length > 0) relevantLevels.add(supportLevels[0]);

    // Also consider levels that the candle wick might have pierced
    const wickPiercedLevels = allLevels.filter(p => 
        p.price >= currentCandle.low && p.price <= currentCandle.high
    );
    wickPiercedLevels.forEach(level => relevantLevels.add(level));
    
    if (relevantLevels.size === 0) return null;

    // --- Step 3: Test ONLY the relevant levels for interactions ---
    const interactions = [];
    for (const level of relevantLevels) {
        const interaction = checkPivotLevelInteraction(currentCandle, prevCandle, level.price, level.levelName, currentIndex);
        if (interaction) {
            interactions.push({
                ...interaction,
                pivotType: level.levelName.split('_')[0],
                level: level.levelName,
                price: level.price,
                isHighPriority: level.isHighPriority || false,
                types: level.types,
            });
        }
    }

    // --- Step 4: Prioritize and return the single most important interaction ---
    // This prevents one candle from creating multiple signals. Confluence wins.
    if (interactions.length > 1) {
        interactions.sort((a, b) => (b.isHighPriority ? 1 : 0) - (a.isHighPriority ? 1 : 0) || b.strength - a.strength);
        return [interactions[0]]; // Return only the highest priority/strength signal
    }

    return interactions.length > 0 ? interactions : null;
};

/**
 * Checks if price is interacting with a specific pivot level. (Slightly Refined)
 * @param {object} currentCandle - The current candle data.
 * @param {object} prevCandle - The previous candle data.
 * @param {number} pivotPrice - The price of the pivot level.
 * @param {string} levelName - The name of the pivot level (e.g., 'traditional_r1', 'confluence_3').
 * @param {number} index - The current index (for debugging).
 * @returns {object|null} An interaction object if detected, otherwise null.
 */
const checkPivotLevelInteraction = (currentCandle, prevCandle, pivotPrice, levelName, currentIndex) => {
    const { high, low, open, close } = currentCandle;
    const tolerance = Math.max(pivotPrice * 0.0005, (high - low) * 0.05); // 0.05% of price or 5% of candle range

    // Breakout: Must come from below and close decisively above
    const isBreakout = prevCandle.close < pivotPrice && close > pivotPrice + tolerance;
    if (isBreakout) {
        return { type: 'breakout', direction: 'bullish', strength: 75, details: `Bullish breakout of ${levelName}` };
    }

    // Breakdown: Must come from above and close decisively below
    const isBreakdown = prevCandle.close > pivotPrice && close < pivotPrice - tolerance;
    if (isBreakdown) {
        return { type: 'breakdown', direction: 'bearish', strength: 75, details: `Bearish breakdown of ${levelName}` };
    }

    // Bullish Bounce: Wick must touch the level, and it must close clearly above it.
    const isBullishBounce = low <= pivotPrice + tolerance && close > pivotPrice + tolerance && close > open;
    if (isBullishBounce) {
        const lowerShadow = Math.min(open, close) - low;
        const body = Math.abs(open - close);
        let strength = 65;
        if (body > 0 && lowerShadow > body * 1.5) strength += 10; // Hammer-like candle
        return { type: 'bounce', direction: 'bullish', strength, details: `Bullish bounce from ${levelName}` };
    }

    // Bearish Rejection: Wick must touch the level, and it must close clearly below it.
    const isBearishRejection = high >= pivotPrice - tolerance && close < pivotPrice - tolerance && close < open;
    if (isBearishRejection) {
        const upperShadow = high - Math.max(open, close);
        const body = Math.abs(open - close);
        let strength = 65;
        if (body > 0 && upperShadow > body * 1.5) strength += 10; // Shooting star-like candle
        return { type: 'rejection', direction: 'bearish', strength, details: `Bearish rejection from ${levelName}` };
    }

    return null; // No significant interaction detected
};

/**
 * REFACTORED: Evaluates Fibonacci Retracement and Extension levels from multiple significant swing points
 * to find powerful confluence zones. Generates signals only on clear, confirmed reactions (bounces, rejections, or decisive breaks).
 */
export const evaluateFibonacciCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const fibSettings = signalSettings.fibonacci || {};

    // DEBUG: Log entry and initial conditions
    if (debugMode && onLog) {
        //onLog(`[FIB_EVAL] Starting evaluation: index=${index}, hasFibonacci=${!!indicators.fibonacci}, fibLength=${indicators.fibonacci?.length || 0}, fib[index]=${!!indicators.fibonacci?.[index]}, index<1=${index < 1}`, 'debug');
        if (indicators.fibonacci && indicators.fibonacci.length > 0) {
            const fibAtIndex = indicators.fibonacci[index];
            //onLog(`[FIB_EVAL] Raw value at index ${index}: ${fibAtIndex ? JSON.stringify(fibAtIndex) : 'null'} (type=${typeof fibAtIndex}, isNull=${fibAtIndex === null}, isUndefined=${fibAtIndex === undefined}, isEmpty=${fibAtIndex !== null && fibAtIndex !== undefined && typeof fibAtIndex === 'object' && Object.keys(fibAtIndex).length === 0})`, 'debug');
            
            // Check data quality across the array
            let validCount = 0;
            let nullCount = 0;
            let emptyCount = 0;
            for (let i = Math.max(0, index - 5); i < Math.min(indicators.fibonacci.length, index + 5); i++) {
                const val = indicators.fibonacci[i];
                if (val === null || val === undefined) {
                    nullCount++;
                } else if (typeof val === 'object' && Object.keys(val).length === 0) {
                    emptyCount++;
                } else if (typeof val === 'object') {
                    validCount++;
                }
            }
            //onLog(`[FIB_EVAL] Data quality near index ${index} (±5): ${validCount} valid, ${nullCount} null, ${emptyCount} empty`, 'debug');
            
            if (fibAtIndex === null || fibAtIndex === undefined) {
                // Check what the last valid index is
                let lastValidIndex = -1;
                let lastValidValue = null;
                for (let i = index; i >= 0; i--) {
                    if (indicators.fibonacci[i] && typeof indicators.fibonacci[i] === 'object') {
                        const val = indicators.fibonacci[i];
                        // Check if it has meaningful data
                        if (Object.keys(val).length > 0) {
                            lastValidIndex = i;
                            lastValidValue = val;
                            break;
                        }
                    }
                }
                //onLog(`[FIB_EVAL] Last valid Fibonacci found at index ${lastValidIndex}: ${lastValidValue ? JSON.stringify(lastValidValue) : 'none'}`, 'debug');
                
                // Also check forward to see when valid data starts
                let nextValidIndex = -1;
                for (let i = index + 1; i < Math.min(indicators.fibonacci.length, index + 10); i++) {
                    if (indicators.fibonacci[i] && typeof indicators.fibonacci[i] === 'object') {
                        const val = indicators.fibonacci[i];
                        if (Object.keys(val).length > 0) {
                            nextValidIndex = i;
                            break;
                        }
                    }
                }
                if (nextValidIndex >= 0) {
                    //onLog(`[FIB_EVAL] Next valid Fibonacci found at index ${nextValidIndex}`, 'debug');
                }
            }
        }
    }

    if (!indicators.fibonacci || index < 1) {
        if (debugMode && onLog) {
            //onLog(`[FIB_EVAL] ❌ Early exit - Data/Index: hasFibonacci=${!!indicators.fibonacci}, index=${index}, index<1=${index < 1}`, 'debug');
        }
        return signals;
    }

    const currentFib = indicators.fibonacci[index];
    const currentPrice = candle.close;
    const prevPrice = indicators.data[index - 1]?.close;

    // SAFETY CHECK: Ensure currentFib is valid
    if (!currentFib || typeof currentFib !== 'object') {
        // Return empty array - invalid data structure, no signals possible
        // No fallback needed - empty arrays are handled fine by signal matching
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    // These provide continuous strength without breaking existing logic

    // 1. Extract Fibonacci Levels Safely
    const fibLevels = [];
    const levelNames = ['0', '236', '382', '500', '618', '786', '1000'];
    
    let foundLevelsCount = 0;
    for (const levelName of levelNames) {
        // Check multiple possible key formats
        // Priority: direct key (0, 236, etc.) -> fib{levelName} -> level_{levelName} -> fib_{levelName}
        const level = currentFib.levels?.[levelName] || 
                     currentFib[levelName] || 
                     currentFib.levels?.[`fib${levelName}`] ||
                     currentFib.levels?.[`fib_${levelName}`] ||
                     currentFib[`fib${levelName}`] || 
                     currentFib[`level_${levelName}`] || 
                     currentFib[`fib_${levelName}`];
        
        if (level && typeof level === 'number') {
            foundLevelsCount++;
            fibLevels.push({
                value: level,
                name: levelName === '0' ? '0%' : levelName === '1000' ? '100%' : `${(parseInt(levelName) / 10).toFixed(1)}%`,
                key: levelName,
                importance: levelName === '500' || levelName === '618' ? 'high' : levelName === '382' || levelName === '786' ? 'medium' : 'low'
            });
        }
    }

    // Sort levels by value
    fibLevels.sort((a, b) => a.value - b.value);

    if (fibLevels.length === 0) {
        if (debugMode && onLog) {
            //onLog(`[FIB_EVAL] ❌ No valid Fibonacci levels extracted. Returning "No Valid Levels" signal. currentFib structure: ${JSON.stringify(currentFib)}`, 'debug');
        }
        // Return empty array - no valid levels extracted
        // No fallback needed - empty arrays are handled fine by signal matching
        return signals;
    }

    // 2. Find Current Fibonacci Zone
    let currentZone = null;
    let nearestLevel = null;
    let nearestDistance = Infinity;

    // Find which zone price is in and nearest level
    for (let i = 0; i < fibLevels.length; i++) {
        const level = fibLevels[i];
        const distance = Math.abs(currentPrice - level.value);
        
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestLevel = level;
        }

        // Determine zone (price must be BETWEEN two levels)
        if (i < fibLevels.length - 1) {
            const nextLevel = fibLevels[i + 1];
            if (currentPrice >= level.value && currentPrice <= nextLevel.value) {
                currentZone = {
                    lower: level,
                    upper: nextLevel,
                    position: (currentPrice - level.value) / (nextLevel.value - level.value)
                };
                break;
            }
        }
    }


    // 3. Zone-Based Signals
    if (currentZone) {
        const zoneStrength = currentZone.lower.importance === 'high' || currentZone.upper.importance === 'high' ? 60 :
                           currentZone.lower.importance === 'medium' || currentZone.upper.importance === 'medium' ? 45 : 35;

        signals.push({
            type: 'fibonacci',
            value: `In ${currentZone.lower.name}-${currentZone.upper.name} Zone`,
            strength: zoneStrength,
            details: `Price trading in ${currentZone.lower.name} to ${currentZone.upper.name} Fibonacci zone`,
            priority: currentZone.lower.importance === 'high' || currentZone.upper.importance === 'high' ? 7 : 5
        });

        // Zone position strength
        if (currentZone.position < 0.2 || currentZone.position > 0.8) {
            const edgeStrength = 40 + Math.min(20, Math.abs(0.5 - currentZone.position) * 80);
            signals.push({
                type: 'fibonacci',
                value: currentZone.position < 0.2 ? 'Near Zone Low' : 'Near Zone High',
                strength: edgeStrength,
                details: `Price near ${currentZone.position < 0.2 ? 'bottom' : 'top'} of Fibonacci zone`,
                priority: 6
            });
        }
    }

    // 4. Level Proximity Signals - Generate signals for ALL nearby levels, even if price is outside zones
    // Check proximity to all levels, not just the nearest one
    // Use a more lenient threshold for "At" signals (1% instead of 0.5%) to match strategy expectations
    // This ensures signals are generated even when currentZone is null (price outside all zones)
    let proximitySignalsGenerated = 0;
    for (const level of fibLevels) {
        const distance = Math.abs(currentPrice - level.value);
        const proximityRatio = distance / currentPrice;
        
        // Use 1% threshold for all Fibonacci levels to match strategy expectations
        // This ensures "At X% Level" signals are generated when price is within 1% of any level
        const atThreshold = 0.01; // 1% for all levels (was 0.5% which was too strict)
        
        if (proximityRatio < atThreshold) { // Very close to level
            const strength = level.importance === 'high' ? 80 : level.importance === 'medium' ? 70 : 60;
            signals.push({
                type: 'fibonacci',
                value: `At ${level.name} Level`,
                strength: strength,
                details: `Price very close to ${level.name} Fibonacci level at ${level.value.toFixed(2)}`,
                priority: level.importance === 'high' ? 9 : 8,
                isEvent: false
            });
            proximitySignalsGenerated++;
        } else if (proximityRatio < 0.02) { // Near level (within 2%)
            const baseStrength = level.importance === 'high' ? 55 : level.importance === 'medium' ? 45 : 35;
            const strength = baseStrength + Math.min(15, (0.02 - proximityRatio) * 1500);
            signals.push({
                type: 'fibonacci',
                value: `Near ${level.name} Level`,
                strength: strength,
                details: `Price approaching ${level.name} Fibonacci level at ${level.value.toFixed(2)}`,
                priority: level.importance === 'high' ? 7 : 6,
                isEvent: false
            });
            proximitySignalsGenerated++;
        }
    }
    
    // Keep track of nearest level for event-based signals below
    if (nearestLevel) {
        // Nearest level already processed above, no need to duplicate
    }

    // 5. Golden Ratio Proximity (61.8% level) - Keep as additional signal, not replacement
    // The "At 61.8% Level" signal above should already be generated if price is within 0.5% or 2%
    // This is just an additional high-priority signal for the golden ratio
    const goldenLevel = fibLevels.find(level => level.key === '618');
    if (goldenLevel) {
        const goldenDistance = Math.abs(currentPrice - goldenLevel.value) / currentPrice;
        if (goldenDistance < 0.01) { // Within 1% of golden ratio
            // Check if we already have "At 61.8% Level" signal to avoid duplication
            const alreadyHas618Signal = signals.some(sig => sig.value === 'At 61.8% Level' || sig.value === 'Near 61.8% Level');
            if (!alreadyHas618Signal) {
                signals.push({
                    type: 'fibonacci',
                    value: 'At Golden Ratio',
                    strength: 85,
                    details: `Price at critical 61.8% Golden Ratio level`,
                    priority: 9
                });
            }
        }
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve existing event detection for backtesting

    if (prevPrice && nearestLevel) {
        const prevDistance = Math.abs(prevPrice - nearestLevel.value);
        const currentDistance = Math.abs(currentPrice - nearestLevel.value);
        
        // Level Touch Event
        if (currentDistance < prevDistance && currentDistance / currentPrice < 0.003) {
            const strength = nearestLevel.importance === 'high' ? 90 : nearestLevel.importance === 'medium' ? 80 : 70;
            signals.push({
                type: 'fibonacci',
                value: `${nearestLevel.name} Level Touch`,
                strength: strength,
                details: `Price touched ${nearestLevel.name} Fibonacci level`,
                priority: 9
            });
        }

        // Level Break Events
        const levelThreshold = nearestLevel.value;
        if (currentPrice > levelThreshold && prevPrice <= levelThreshold) {
            const strength = nearestLevel.importance === 'high' ? 85 : nearestLevel.importance === 'medium' ? 75 : 65;
            signals.push({
                type: 'fibonacci',
                value: `${nearestLevel.name} Level Break Up`,
                strength: strength,
                details: `Price broke above ${nearestLevel.name} Fibonacci level`,
                priority: 8
            });
        } else if (currentPrice < levelThreshold && prevPrice >= levelThreshold) {
            const strength = nearestLevel.importance === 'high' ? 85 : nearestLevel.importance === 'medium' ? 75 : 65;
            signals.push({
                type: 'fibonacci',
                value: `${nearestLevel.name} Level Break Down`,
                strength: strength,
                details: `Price broke below ${nearestLevel.name} Fibonacci level`,
                priority: 8
            });
        }
    }

    // 6. Retracement Depth Analysis
    if (fibLevels.length >= 3) {
        // Assuming fibLevels are sorted, 0% and 100% are typically the first and last
        const lowLevel = fibLevels.find(l => l.key === '0');
        const highLevel = fibLevels.find(l => l.key === '1000');
        
        if (lowLevel && highLevel) {
            const range = highLevel.value - lowLevel.value;
            
            if (range > 0) {
                // Calculate current price's position within the 0-100% range
                const retracementDepth = (currentPrice - lowLevel.value) / range;
                
                // Adjust for potential inverse Fibonacci (100% at top, 0% at bottom)
                // This logic assumes 0% is always the starting point for retracement calculation.
                // If the market is going up, 0% is the low, 100% is the high. Retracements are from high back to low.
                // If the market is going down, 0% is the high, 100% is the low. Retracements are from low back to high.
                // The provided fibLevels are sorted by value, so lowLevel.value is truly the lowest and highLevel.value is the highest.
                // For a retracement, we typically look at a move and then a pullback.
                // Let's assume the fib levels are calculated from a swing low to a swing high (0% at low, 100% at high).
                // In this case, a retracement means price pulling back *down* from the 100% level.
                // Or, from a swing high to a swing low (0% at high, 100% at low).
                // For this signal, let's simplify and consider the distance between min and max fib levels.
                // A "healthy retracement" usually means the 38.2%, 50%, or 61.8% level.
                // The current `retracementDepth` is (currentPrice - min_fib_level) / (max_fib_level - min_fib_level).
                // If fibs are drawn from swing low to swing high:
                //   0% = swing low, 100% = swing high.
                //   Retracement (pullback) means price is moving from 100% towards 0%.
                //   So, currentPrice should be decreasing.
                // If fibs are drawn from swing high to swing low:
                //   0% = swing high, 100% = swing low.
                //   Retracement (pullback) means price is moving from 100% towards 0%.
                //   So, currentPrice should be increasing.

                // This section of the old code was removed/replaced, this re-introduces a simplified version.
                // This "retracement depth" signal is more about how far price has moved through the entire fib range,
                // rather than a specific retracement from a prior swing.
                // We'll use the 'key' values to infer the actual retracement percentage from the 0/100 swing.
                
                // Find the highest and lowest _actual_ fib levels, assuming they represent the 0% and 100% mark for the *current* fib tool drawing.
                const fib0 = fibLevels.find(l => l.key === '0');
                const fib1000 = fibLevels.find(l => l.key === '1000');

                if (fib0 && fib1000 && fib0.value !== fib1000.value) {
                    const fibRange = Math.abs(fib1000.value - fib0.value);
                    let normalizedCurrentPrice;
                    if (fib1000.value > fib0.value) { // Uptrend, 0% at bottom, 100% at top
                        normalizedCurrentPrice = (currentPrice - fib0.value) / fibRange;
                    } else { // Downtrend, 0% at top, 100% at bottom
                        normalizedCurrentPrice = (fib0.value - currentPrice) / fibRange;
                    }

                    // For retracement, we want to know how far price has pulled back from the "end" of the impulse.
                    // If 0% is start and 100% is end, a pullback means moving *back* towards 0%.
                    // The standard retracement levels are usually 38.2, 50, 61.8 from the 100% mark.
                    // So, if 0% is low, 100% is high, 38.2% retracement means price is at (high - (high-low)*0.382)
                    // This corresponds to a normalizedCurrentPrice of (1 - 0.382) = 0.618.
                    // Thus, a healthy retracement is typically when normalizedCurrentPrice is between ~0.382 and ~0.618 (relative to the full impulse).
                    // Or, if it's drawn high to low, then 38.2% retracement means normalizedCurrentPrice is 0.382.
                    // This is complex because 'currentFib' simply gives the levels, not how they were drawn.
                    // Let's stick to the interpretation of how far the price is *into* the 0-100 range.
                    // A price near 38.2%, 50%, or 61.8% of the range.
                    
                    if (normalizedCurrentPrice >= 0.3 && normalizedCurrentPrice <= 0.7) { // Between 30% and 70% of the full fib range
                        signals.push({
                            type: 'fibonacci',
                            value: 'Healthy Retracement Zone',
                            strength: 55,
                            details: `Price in common Fibonacci retracement zone (${(normalizedCurrentPrice * 100).toFixed(1)}%)`,
                            priority: 6
                        });
                    } else if (normalizedCurrentPrice < 0.2 || normalizedCurrentPrice > 0.8) {
                         signals.push({
                            type: 'fibonacci',
                            value: 'Shallow/Deep Retracement',
                            strength: 50,
                            details: `Price near extremes of Fibonacci retracement range (${(normalizedCurrentPrice * 100).toFixed(1)}%)`,
                            priority: 5
                        });
                    }
                }
            }
        }
    }

    // Fallback signal if no zones were processed AND no proximity signals were generated
    // If proximity signals were generated (even when price is outside zones), we don't need fallback
    if (signals.length === 0) {
            // Try one more time: generate a signal based on nearest level distance if reasonable
            // Use a more lenient threshold (5%) for fallback when price is outside all zones
            // This ensures we generate signals when price is reasonably close to Fibonacci levels
            if (nearestLevel && nearestDistance < Infinity) {
                const proximityRatio = nearestDistance / currentPrice;
                if (proximityRatio < 0.05) { // Within 5% of nearest level (increased from 3%)
                    // Scale strength based on distance: closer = stronger signal
                    const baseStrength = 40;
                    const distanceStrength = Math.max(25, baseStrength - (proximityRatio * 400)); // 40 at 0%, 25 at 3.75%+
                    signals.push({
                        type: 'fibonacci',
                        value: `Near ${nearestLevel.name} Level`,
                        strength: Math.round(distanceStrength),
                        details: `Price near ${nearestLevel.name} Fibonacci level (distance: ${(proximityRatio * 100).toFixed(2)}%)`,
                        priority: proximityRatio < 0.03 ? 6 : 5 // Higher priority if within 3%
                    });
                }
            }
        
        // No fallback signal - return empty array if no signals generated
        // This is intentional: empty arrays are handled fine by the signal matching logic,
        // and fallback signals (strength 20) add noise without providing value
        // Strategies require specific signal values to match, so "No Fibonacci Data" never matches anyway
        if (signals.length === 0) {
            // Return empty array - no fallback signal needed
        }
    }

    return signals;
};

/**
 * REFACTORED: Evaluates pivot point signals by requiring mandatory confirmation for all interactions.
 * - Breakouts/Breakdowns MUST have a volume spike.
 * - Bounces/Rejections MUST have candlestick or divergence confirmation.
 */
export const evaluatePivotCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    const pivotSettings = signalSettings.pivot || {};

    // Add debug logs
    if (debugMode && onLog) {
        //onLog(`[PIVOT_EVAL] Starting evaluation: index=${index}, hasPivots=${!!indicators.pivots}, pivotsType=${typeof indicators.pivots}, isArray=${Array.isArray(indicators.pivots)}`, 'debug');
        if (indicators.pivots) {
            //onLog(`[PIVOT_EVAL] Pivots array length=${indicators.pivots.length}, index validity=${index >= 0 && index < indicators.pivots.length}`, 'debug');
        }
    }

    if (!indicators.pivots || index < 1) {
        if (debugMode && onLog) {
            onLog(`[PIVOT_EVAL] ⚠️ Early exit: hasPivots=${!!indicators.pivots}, index=${index}`, 'debug');
        }
        return signals;
    }

    const currentPivots = indicators.pivots[index];
    const currentPrice = candle.close;
    const prevPrice = indicators.data[index - 1]?.close;

    // Add detailed logging
    if (debugMode && onLog) {
        //onLog(`[PIVOT_EVAL] Index ${index}: currentPivots isNull=${currentPivots === null}, isUndefined=${currentPivots === undefined}, type=${typeof currentPivots}, isObject=${typeof currentPivots === 'object' && currentPivots !== null}`, 'debug');
        if (currentPivots && typeof currentPivots === 'object') {
            //onLog(`[PIVOT_EVAL] Index ${index}: currentPivots keys=${Object.keys(currentPivots).join(', ')}`, 'debug');
            if (currentPivots.traditional) {
               // onLog(`[PIVOT_EVAL] Index ${index}: traditional.pivot=${currentPivots.traditional.pivot?.toFixed(2) || 'null'}, traditional.s1=${currentPivots.traditional.s1?.toFixed(2) || 'null'}, traditional.r1=${currentPivots.traditional.r1?.toFixed(2) || 'null'}`, 'debug');
            }
        }
    }

    // SAFETY CHECK: Ensure currentPivots is valid
    if (!currentPivots || typeof currentPivots !== 'object') {
        if (debugMode && onLog) {
            onLog(`[PIVOT_EVAL] ⚠️ No valid pivot data at index ${index}: currentPivots=${currentPivots}, type=${typeof currentPivots}`, 'debug');
        }
        // Still provide a baseline signal even if no pivots calculated
        signals.push({
            type: 'pivot',
            value: 'No Pivot Data',
            strength: 20,
            details: `No pivot point data available`,
            priority: 3
        });
        return signals;
    }

    // --- State-Based Signals (NEW) ---
    // These provide continuous strength without breaking existing logic

    // 1. Price Position Relative to Pivot Point
    // NOTE: The calculatePivotPoints returns nested structure: currentPivots.traditional.pivot, not currentPivots.pivot
    // Try to find pivot in nested structure first
    let pivot = currentPivots.pivot || currentPivots.pp;
    if (!pivot && currentPivots.traditional) {
        pivot = currentPivots.traditional.pivot;
    }
    if (!pivot && currentPivots.woodie) {
        pivot = currentPivots.woodie.pivot;
    }
    
    if (debugMode && onLog) {
        //onLog(`[PIVOT_EVAL] Index ${index}: Looking for pivot value. Found: pivot=${pivot?.toFixed(2) || 'null'}, hasTraditional=${!!currentPivots.traditional}, hasWoodie=${!!currentPivots.woodie}`, 'debug');
    }
    
    if (pivot && typeof pivot === 'number') {
        const pivotDistance = Math.abs(currentPrice - pivot) / currentPrice;
        
        // Always generate position relative to pivot (Above/Below), regardless of distance
        // This allows strategies to match both "At Pivot Point" AND "Above Pivot" simultaneously
        if (currentPrice > pivot) {
            const aboveStrength = pivotDistance < 0.005 
                ? 70  // When very close, still generate "Above Pivot" but with same strength as "At Pivot Point"
                : 35 + Math.min(25, (1 / pivotDistance) * 0.05);
            signals.push({
                type: 'pivot',
                value: 'Above Pivot',
                strength: aboveStrength,
                details: `Price above pivot point at ${pivot.toFixed(2)}`,
                priority: 5
            });
            
            // Also generate "At Pivot Point" if very close
            if (pivotDistance < 0.005) {
                signals.push({
                    type: 'pivot',
                    value: 'At Pivot Point',
                    strength: 70,
                    details: `Price very close to pivot point at ${pivot.toFixed(2)}`,
                    priority: 7
                });
            }
        } else {
            const belowStrength = pivotDistance < 0.005
                ? 70  // When very close, still generate "Below Pivot" but with same strength as "At Pivot Point"
                : 35 + Math.min(25, (1 / pivotDistance) * 0.05);
            signals.push({
                type: 'pivot',
                value: 'Below Pivot',
                strength: belowStrength,
                details: `Price below pivot point at ${pivot.toFixed(2)}`,
                priority: 5
            });
            
            // Also generate "At Pivot Point" if very close
            if (pivotDistance < 0.005) {
                signals.push({
                    type: 'pivot',
                    value: 'At Pivot Point',
                    strength: 70,
                    details: `Price very close to pivot point at ${pivot.toFixed(2)}`,
                    priority: 7
                });
            }
        }
    }

    // 2. Support/Resistance Level Proximity
    const levels = [];
    
    // Safely extract all pivot levels - check nested structure first
    // Traditional pivot levels
    const traditional = currentPivots.traditional || {};
    if (traditional.s1 && typeof traditional.s1 === 'number') levels.push({ level: traditional.s1, type: 'S1' });
    if (traditional.s2 && typeof traditional.s2 === 'number') levels.push({ level: traditional.s2, type: 'S2' });
    if (traditional.s3 && typeof traditional.s3 === 'number') levels.push({ level: traditional.s3, type: 'S3' });
    if (traditional.r1 && typeof traditional.r1 === 'number') levels.push({ level: traditional.r1, type: 'R1' });
    if (traditional.r2 && typeof traditional.r2 === 'number') levels.push({ level: traditional.r2, type: 'R2' });
    if (traditional.r3 && typeof traditional.r3 === 'number') levels.push({ level: traditional.r3, type: 'R3' });
    
    // Fallback to flat structure if nested not found
    if (levels.length === 0) {
        if (currentPivots.s1 && typeof currentPivots.s1 === 'number') levels.push({ level: currentPivots.s1, type: 'S1' });
        if (currentPivots.s2 && typeof currentPivots.s2 === 'number') levels.push({ level: currentPivots.s2, type: 'S2' });
        if (currentPivots.s3 && typeof currentPivots.s3 === 'number') levels.push({ level: currentPivots.s3, type: 'S3' });
        if (currentPivots.r1 && typeof currentPivots.r1 === 'number') levels.push({ level: currentPivots.r1, type: 'R1' });
        if (currentPivots.r2 && typeof currentPivots.r2 === 'number') levels.push({ level: currentPivots.r2, type: 'R2' });
        if (currentPivots.r3 && typeof currentPivots.r3 === 'number') levels.push({ level: currentPivots.r3, type: 'R3' });
    }
    
    if (debugMode && onLog) {
        //onLog(`[PIVOT_EVAL] Index ${index}: Extracted ${levels.length} levels: ${levels.map(l => `${l.type}=${l.level.toFixed(2)}`).join(', ') || 'none'}`, 'debug');
    }

    // Generate signals for ALL nearby levels (within 3%), not just the nearest one
    // This allows strategies to match multiple pivot signals simultaneously (e.g., "Near R1" AND "Near R3")
    const nearbyLevels = [];
    
    for (const levelData of levels) {
        const distance = Math.abs(currentPrice - levelData.level);
        const proximityRatio = distance / currentPrice;
        
        if (proximityRatio < 0.03) { // Within 3% of this level
            nearbyLevels.push({
                ...levelData,
                distance,
                proximityRatio
            });
        }
    }
    
    // Sort by distance (nearest first) to prioritize closer levels
    nearbyLevels.sort((a, b) => a.distance - b.distance);
    
    // Generate signals for all nearby levels
    for (const levelData of nearbyLevels) {
        const { type, level, proximityRatio } = levelData;
        
        if (proximityRatio < 0.01) { // Very close (within 1%)
            // Generate both "At" and "Near" signals
            const atStrength = 65 + Math.min(25, (0.01 - proximityRatio) * 5000);
            signals.push({
                type: 'pivot',
                value: `At ${type}`,
                strength: atStrength,
                details: `Price very close to ${type} level at ${level.toFixed(2)}`,
                priority: 8
            });
            
            // Also generate "Near" signal with slightly lower strength
            const nearStrength = 60 + Math.min(15, (0.01 - proximityRatio) * 3000);
            signals.push({
                type: 'pivot',
                value: `Near ${type}`,
                strength: nearStrength,
                details: `Price approaching ${type} level at ${level.toFixed(2)}`,
                priority: 6
            });
        } else { // Near but not very close (1-3%)
            const strength = 45 + Math.min(20, (0.03 - proximityRatio) * 1000);
            signals.push({
                type: 'pivot',
                value: `Near ${type}`,
                strength: strength,
                details: `Price approaching ${type} level at ${level.toFixed(2)}`,
                priority: 6
            });
        }
    }
    
    // If no nearby levels, generate "Away from" signal for the nearest level
    if (nearbyLevels.length === 0 && levels.length > 0) {
        let nearestLevel = null;
        let nearestDistance = Infinity;
        
        for (const levelData of levels) {
            const distance = Math.abs(currentPrice - levelData.level);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestLevel = levelData;
            }
        }
        
        if (nearestLevel) {
            const proximityRatio = nearestDistance / currentPrice;
            const strength = 25 + Math.min(15, (1 / proximityRatio) * 0.1);
            signals.push({
                type: 'pivot',
                value: `Away from ${nearestLevel.type}`,
                strength: strength,
                details: `Price away from ${nearestLevel.type} level at ${nearestLevel.level.toFixed(2)}`,
                priority: 4
            });
        }
    }

    // 3. Pivot Range Analysis
    const supportLevels = levels.filter(l => l.type.startsWith('S')).map(l => l.level);
    const resistanceLevels = levels.filter(l => l.type.startsWith('R')).map(l => l.level);
    
    if (supportLevels.length > 0 && resistanceLevels.length > 0) {
        const nearestSupport = Math.max(...supportLevels.filter(l => l < currentPrice));
        const nearestResistance = Math.min(...resistanceLevels.filter(l => l > currentPrice));
        
        if (nearestSupport && nearestResistance) {
            const rangeSize = nearestResistance - nearestSupport;
            const pricePosition = (currentPrice - nearestSupport) / rangeSize;
            
            if (pricePosition > 0.8) {
                signals.push({
                    type: 'pivot',
                    value: 'Upper Pivot Range',
                    strength: 40,
                    details: `Price in upper ${((1 - pricePosition) * 100).toFixed(0)}% of pivot range`,
                    priority: 5
                });
            } else if (pricePosition < 0.2) {
                signals.push({
                    type: 'pivot',
                    value: 'Lower Pivot Range',
                    strength: 40,
                    details: `Price in lower ${(pricePosition * 100).toFixed(0)}% of pivot range`,
                    priority: 5
                });
            } else {
                signals.push({
                    type: 'pivot',
                    value: 'Middle Pivot Range',
                    strength: 30,
                    details: `Price in middle of pivot range`,
                    priority: 4
                });
            }
        }
    }

    // 4. Level Density State
    const totalLevels = levels.length;
    if (totalLevels >= 5) {
        signals.push({
            type: 'pivot',
            value: 'High Pivot Density',
            strength: 40,
            details: `${totalLevels} pivot levels calculated - strong structure`,
            priority: 5
        });
    } else if (totalLevels >= 3) {
        signals.push({
            type: 'pivot',
            value: 'Moderate Pivot Density',
            strength: 30,
            details: `${totalLevels} pivot levels calculated`,
            priority: 4
        });
    } else if (totalLevels >= 1) {
        signals.push({
            type: 'pivot',
            value: 'Low Pivot Density',
            strength: 25,
            details: `${totalLevels} pivot levels calculated`,
            priority: 3
        });
    }

    // --- Event-Based Signals (Existing Logic) ---
    // Preserve ALL existing event-based signals for backtesting compatibility

    // Calculate nearestLevel for event-based signals (use first from nearbyLevels if available, or find from all levels)
    let nearestLevel = null;
    if (nearbyLevels.length > 0) {
        nearestLevel = nearbyLevels[0]; // Already sorted by distance, nearest first
    } else if (levels.length > 0) {
        // Find nearest level from all levels
        let nearestDistance = Infinity;
        for (const levelData of levels) {
            const distance = Math.abs(currentPrice - levelData.level);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestLevel = levelData;
            }
        }
    }

    // Pivot Level Touch Events
    if (nearestLevel && Math.abs(currentPrice - nearestLevel.level) / currentPrice < 0.005) {
        signals.push({
            type: 'pivot',
            value: `${nearestLevel.type} Touch`,
            strength: 85,
            details: `Price touched ${nearestLevel.type} level at ${nearestLevel.level.toFixed(2)}`,
            priority: 9
        });
    }

    // Pivot Point Cross Events
    if (pivot && prevPrice && typeof pivot === 'number') {
        if (currentPrice > pivot && prevPrice <= pivot) {
            signals.push({
                type: 'pivot',
                value: 'Pivot Bullish Cross',
                strength: 80,
                details: `Price crossed above pivot point at ${pivot.toFixed(2)}`,
                priority: 8
            });
        } else if (currentPrice < pivot && prevPrice >= pivot) {
            signals.push({
                type: 'pivot',
                value: 'Pivot Bearish Cross',
                strength: 80,
                details: `Price crossed below pivot point at ${pivot.toFixed(2)}`,
                priority: 8
            });
        }
    }

    // Support/Resistance Level Break Events
    for (const levelData of levels) {
        if (prevPrice && typeof levelData.level === 'number') {
            const isSupport = levelData.type.startsWith('S');
            const isResistance = levelData.type.startsWith('R');
            
            if (isResistance && currentPrice > levelData.level && prevPrice <= levelData.level) {
                signals.push({
                    type: 'pivot',
                    value: `${levelData.type} Breakout`,
                    strength: 90,
                    details: `Price broke above ${levelData.type} level at ${levelData.level.toFixed(2)}`,
                    priority: 9
                });
            } else if (isSupport && currentPrice < levelData.level && prevPrice >= levelData.level) {
                signals.push({
                    type: 'pivot',
                    value: `${levelData.type} Breakdown`,
                    strength: 90,
                    details: `Price broke below ${levelData.type} level at ${levelData.level.toFixed(2)}`,
                    priority: 9
                });
            }
        }
    }

    // Bounce Events
    for (const levelData of levels) {
        if (prevPrice && typeof levelData.level === 'number') {
            const isSupport = levelData.type.startsWith('S');
            const isResistance = levelData.type.startsWith('R');
            
            if (isSupport && 
                prevPrice < levelData.level * 1.01 && prevPrice > levelData.level * 0.99 && 
                currentPrice > prevPrice) {
                signals.push({
                    type: 'pivot',
                    value: `${levelData.type} Bounce`,
                    strength: 85,
                    details: `Price bounced off ${levelData.type} level at ${levelData.level.toFixed(2)}`,
                    priority: 8
                });
            } else if (isResistance && 
                       prevPrice > levelData.level * 0.99 && prevPrice < levelData.level * 1.01 && 
                       currentPrice < prevPrice) {
                signals.push({
                    type: 'pivot',
                    value: `${levelData.type} Rejection`,
                    strength: 85,
                    details: `Price rejected at ${levelData.type} level at ${levelData.level.toFixed(2)}`,
                    priority: 8
                });
            }
        }
    }

    // Fallback signal if no levels were processed
    if (signals.length === 0) {
        signals.push({
            type: 'pivot',
            value: 'No Pivot Data',
            strength: 20,
            details: `No pivot point data available`,
            priority: 3
        });
    }

    return signals;
};
