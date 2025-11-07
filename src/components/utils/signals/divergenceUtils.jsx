import { get } from 'lodash';
import { getRegimeMultiplier } from '../regimeUtils';

/**
 * Advanced Divergence Detection Utility
 * 
 * This module provides sophisticated divergence analysis that distinguishes between
 * regular (reversal) and hidden (continuation) divergences across all momentum oscillators.
 */

/**
 * Detects and categorizes divergences between price and oscillator
 * @param {Array} priceData - Array of price values (typically close prices)
 * @param {Array} oscillatorData - Array of oscillator values
 * @param {number} currentIndex - Current candle index
 * @param {object} settings - Divergence detection settings
 * @returns {object} Divergence analysis results
 */
export function detectAdvancedDivergence(priceData, oscillatorData, currentIndex, settings = {}) {
    const lookbackPeriod = settings.lookbackPeriod || 50;
    const minPeakDistance = settings.minPeakDistance || 5;
    const maxPeakDistance = settings.maxPeakDistance || 60;
    const pivotLookback = settings.pivotLookback || 5;
    const minPriceMove = settings.minPriceMove || 0.02; // 2% minimum price move
    const minOscillatorMove = settings.minOscillatorMove || 5; // Minimum oscillator move
    const debugMode = settings.debugMode || false;
    const onLog = settings.onLog || null;

    if (!priceData || !oscillatorData || currentIndex < lookbackPeriod) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] ❌ Early exit: priceData=${!!priceData}, oscillatorData=${!!oscillatorData}, currentIndex=${currentIndex}, lookbackPeriod=${lookbackPeriod}`, 'debug');
        }
        return null;
    }

    const startIndex = Math.max(0, currentIndex - lookbackPeriod);
    const endIndex = currentIndex;

    // Only log failures

    // Find pivots in both price and oscillator
    // Use smaller pivotLookback for oscillators (3) since they're smoother than price data
    const oscillatorPivotLookback = Math.max(2, Math.floor(pivotLookback * 0.6)); // 60% of price lookback, minimum 2
    const pricePivots = findPivots(priceData, startIndex, endIndex, pivotLookback, debugMode, onLog, 'price');
    const oscillatorPivots = findPivots(oscillatorData, startIndex, endIndex, oscillatorPivotLookback, debugMode, onLog, 'oscillator');

    if (debugMode && onLog) {
        //onLog(`[MFI_PIVOT_DEBUG] Pivot results: priceHighs=${pricePivots.highs.length}, priceLows=${pricePivots.lows.length}, oscillatorHighs=${oscillatorPivots.highs.length}, oscillatorLows=${oscillatorPivots.lows.length}`, 'debug');
        if (pricePivots.highs.length < 2 && oscillatorPivots.highs.length < 2) {
            //onLog(`[MFI_PIVOT_DEBUG] ⚠️ Not enough highs found for bearish divergence (need 2+)`, 'debug');
        }
        if (pricePivots.lows.length < 2 && oscillatorPivots.lows.length < 2) {
            //onLog(`[MFI_PIVOT_DEBUG] ⚠️ Not enough lows found for bullish divergence (need 2+)`, 'debug');
        }
    }

    // Analyze for different types of divergences
    const regularBullish = analyzeRegularBullishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove, debugMode, onLog);
    const regularBearish = analyzeRegularBearishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove, debugMode, onLog);
    const hiddenBullish = analyzeHiddenBullishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove, debugMode, onLog);
    const hiddenBearish = analyzeHiddenBearishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove, debugMode, onLog);

    if (debugMode && onLog) {
        //onLog(`[MFI_PIVOT_DEBUG] Divergence analysis results: regularBullish=${!!regularBullish}, regularBearish=${!!regularBearish}, hiddenBullish=${!!hiddenBullish}, hiddenBearish=${!!hiddenBearish}`, 'debug');
    }

    // Return the strongest divergence found
    const divergences = [regularBullish, regularBearish, hiddenBullish, hiddenBearish].filter(d => d !== null);
    
    if (divergences.length === 0) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] ❌ No divergences found after analysis`, 'debug');
        }
        return null;
    }

    // Sort by strength and return the strongest
    return divergences.sort((a, b) => b.strength - a.strength)[0];
}

/**
 * Finds pivot points (local highs and lows) in the data
 */
function findPivots(data, startIndex, endIndex, pivotLookback, debugMode = false, onLog = null, label = 'data') {
    const pivots = {
        highs: [],
        lows: []
    };

    if (debugMode && onLog) {
        //onLog(`[MFI_PIVOT_DEBUG] [${label}] Scanning for pivots: startIndex=${startIndex + pivotLookback}, endIndex=${endIndex - pivotLookback}, range=${(endIndex - pivotLookback) - (startIndex + pivotLookback)}, data.length=${data.length}`, 'debug');
    }

    let checkedPoints = 0;
    let highCandidates = 0;
    let lowCandidates = 0;

    for (let i = startIndex + pivotLookback; i <= endIndex - pivotLookback; i++) {
        const current = data[i];
        
        if (current === null || current === undefined || typeof current !== 'number' || isNaN(current)) {
            continue;
        }
        
        checkedPoints++;
        let isHigh = true;
        let isLow = true;
        let higherCount = 0;
        let lowerCount = 0;
        const isOscillator = label === 'oscillator';

        // Check if current point is a local high
        // For oscillators, allow up to 1-2 equal/higher values nearby (smoother data)
        for (let j = i - pivotLookback; j <= i + pivotLookback; j++) {
            if (j !== i && j >= 0 && j < data.length) {
                if (data[j] > current) {
                    isHigh = false;
                    break;
                } else if (data[j] === current) {
                    higherCount++;
                }
            }
        }
        // For oscillators: allow pivot if only 1-2 equal values (flat plateau at peak)
        if (isOscillator && isHigh && higherCount > 2) {
            isHigh = false;
        }

        // Check if current point is a local low
        // For oscillators, allow up to 1-2 equal/lower values nearby (smoother data)
        for (let j = i - pivotLookback; j <= i + pivotLookback; j++) {
            if (j !== i && j >= 0 && j < data.length) {
                if (data[j] < current) {
                    isLow = false;
                    break;
                } else if (data[j] === current) {
                    lowerCount++;
                }
            }
        }
        // For oscillators: allow pivot if only 1-2 equal values (flat plateau at bottom)
        if (isOscillator && isLow && lowerCount > 2) {
            isLow = false;
        }

        if (isHigh) {
            pivots.highs.push({ index: i, value: current });
            highCandidates++;
        }
        if (isLow) {
            pivots.lows.push({ index: i, value: current });
            lowCandidates++;
        }
    }

    // Only log if no pivots found (failure case)
    if (debugMode && onLog && pivots.highs.length === 0 && pivots.lows.length === 0) {
        //onLog(`[MFI_PIVOT_DEBUG] [${label}] ⚠️ No pivots found! This might indicate: 1) Data too flat/smooth, 2) pivotLookback=${pivotLookback} too strict, 3) Data range too small`, 'debug');
    }

    return pivots;
}

/**
 * Analyzes for Regular Bullish Divergence
 * Price makes lower low, oscillator makes higher low (REVERSAL signal)
 */
function analyzeRegularBullishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove, debugMode = false, onLog = null) {
    const priceLows = pricePivots.lows;
    const oscillatorLows = oscillatorPivots.lows;

    if (priceLows.length < 2 || oscillatorLows.length < 2) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] Regular Bullish: Not enough pivots - priceLows=${priceLows.length}, oscillatorLows=${oscillatorLows.length} (need 2+)`, 'debug');
        }
        return null;
    }

    // Search through all price pivot pairs (starting from most recent)
    for (let i = priceLows.length - 1; i >= 1; i--) {
        const secondPriceLow = priceLows[i];
        for (let j = i - 1; j >= 0; j--) {
            const firstPriceLow = priceLows[j];
            
            // Check if price made a lower low
            if (secondPriceLow.value >= firstPriceLow.value) continue;
            
            // Find corresponding oscillator lows within reasonable distance
            const firstOscLow = findNearestPivot(oscillatorLows, firstPriceLow.index, maxDistance);
            let secondOscLow = findNearestPivot(oscillatorLows, secondPriceLow.index, maxDistance);
            
            // CRITICAL FIX: If both oscillator pivots are the same, find a different one for secondOscLow
            if (firstOscLow && secondOscLow && firstOscLow.index === secondOscLow.index) {
                secondOscLow = oscillatorLows.find(p => 
                    p.index !== firstOscLow.index && 
                    Math.abs(p.index - secondPriceLow.index) <= maxDistance
                ) || null;
            }
            
            if (!firstOscLow || !secondOscLow) continue;
            
            // Check distance between pivots
            const distance = Math.abs(secondPriceLow.index - firstPriceLow.index);
            if (distance < minDistance || distance > maxDistance) continue;
            
            // Check if oscillator made a higher low
            if (secondOscLow.value <= firstOscLow.value) continue;
            
            // Validate minimum moves
            const priceMove = Math.abs(secondPriceLow.value - firstPriceLow.value) / firstPriceLow.value;
            const oscillatorMove = Math.abs(secondOscLow.value - firstOscLow.value);
            
            // Relaxed: Allow smaller price moves if oscillator move is strong
            let priceMoveRelaxed = minPriceMove;
            if (oscillatorMove >= minOscillatorMove * 6) {
                priceMoveRelaxed = minPriceMove * 0.10;
            } else if (oscillatorMove >= minOscillatorMove * 3) {
                priceMoveRelaxed = minPriceMove * 0.12;
            } else if (oscillatorMove >= minOscillatorMove * 2) {
                priceMoveRelaxed = minPriceMove * 0.25;
            }
            
            const tolerance = priceMoveRelaxed * 0.02;
            if (priceMove < (priceMoveRelaxed - tolerance) || oscillatorMove < minOscillatorMove) continue;
            
            // Found valid divergence - return it (most recent match)
            if (debugMode && onLog) {
                //onLog(`[MFI_PIVOT_DEBUG] Regular Bullish: ✅ Divergence detected! Price: ${firstPriceLow.value.toFixed(2)} -> ${secondPriceLow.value.toFixed(2)} (LL), MFI: ${firstOscLow.value.toFixed(2)} -> ${secondOscLow.value.toFixed(2)} (HL)`, 'debug');
            }
            
            return {
                type: 'Regular Bullish Divergence',
                direction: 'bullish',
                category: 'reversal',
                strength: calculateDivergenceStrength(priceMove, oscillatorMove, distance, 'regular_bullish'),
                confidence: calculateDivergenceConfidence(priceMove, oscillatorMove, distance),
                description: 'Price lower low, oscillator higher low - potential upward reversal',
                pricePivots: [firstPriceLow, secondPriceLow],
                oscillatorPivots: [firstOscLow, secondOscLow]
            };
        }
    }
    
    return null;
}

/**
 * Analyzes for Regular Bearish Divergence
 * Price makes higher high, oscillator makes lower high (REVERSAL signal)
 */
function analyzeRegularBearishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove, debugMode = false, onLog = null) {
    const priceHighs = pricePivots.highs;
    const oscillatorHighs = oscillatorPivots.highs;

    if (priceHighs.length < 2 || oscillatorHighs.length < 2) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] Regular Bearish: Not enough pivots - priceHighs=${priceHighs.length}, oscillatorHighs=${oscillatorHighs.length} (need 2+)`, 'debug');
        }
        return null;
    }

    // Search through all price pivot pairs (starting from most recent)
    for (let i = priceHighs.length - 1; i >= 1; i--) {
        const secondPriceHigh = priceHighs[i];
        for (let j = i - 1; j >= 0; j--) {
            const firstPriceHigh = priceHighs[j];
            
            // Check if price made a higher high
            if (secondPriceHigh.value <= firstPriceHigh.value) continue;
            
            // Find corresponding oscillator highs within reasonable distance
            const firstOscHigh = findNearestPivot(oscillatorHighs, firstPriceHigh.index, maxDistance);
            let secondOscHigh = findNearestPivot(oscillatorHighs, secondPriceHigh.index, maxDistance);
            
            // CRITICAL FIX: If both oscillator pivots are the same, find a different one for secondOscHigh
            if (firstOscHigh && secondOscHigh && firstOscHigh.index === secondOscHigh.index) {
                secondOscHigh = oscillatorHighs.find(p => 
                    p.index !== firstOscHigh.index && 
                    Math.abs(p.index - secondPriceHigh.index) <= maxDistance
                ) || null;
            }
            
            if (!firstOscHigh || !secondOscHigh) continue;
            
            // Check distance between pivots
            const distance = Math.abs(secondPriceHigh.index - firstPriceHigh.index);
            if (distance < minDistance || distance > maxDistance) continue;
            
            // Check if oscillator made a lower high
            if (secondOscHigh.value >= firstOscHigh.value) continue;
            
            // Validate minimum moves
            const priceMove = Math.abs(secondPriceHigh.value - firstPriceHigh.value) / firstPriceHigh.value;
            const oscillatorMove = Math.abs(secondOscHigh.value - firstOscHigh.value);
            
            // Relaxed: Allow smaller price moves if oscillator move is strong
            let priceMoveRelaxed = minPriceMove;
            if (oscillatorMove >= minOscillatorMove * 6) {
                priceMoveRelaxed = minPriceMove * 0.10;
            } else if (oscillatorMove >= minOscillatorMove * 3) {
                priceMoveRelaxed = minPriceMove * 0.12;
            } else if (oscillatorMove >= minOscillatorMove * 2) {
                priceMoveRelaxed = minPriceMove * 0.25;
            }
            
            const tolerance = priceMoveRelaxed * 0.02;
            if (priceMove < (priceMoveRelaxed - tolerance) || oscillatorMove < minOscillatorMove) continue;
            
            // Found valid divergence - return it (most recent match)
            if (debugMode && onLog) {
                //onLog(`[MFI_PIVOT_DEBUG] Regular Bearish: ✅ Divergence detected! Price: ${firstPriceHigh.value.toFixed(2)} -> ${secondPriceHigh.value.toFixed(2)} (HH), MFI: ${firstOscHigh.value.toFixed(2)} -> ${secondOscHigh.value.toFixed(2)} (LH)`, 'debug');
            }
            
            return {
                type: 'Regular Bearish Divergence',
                direction: 'bearish',
                category: 'reversal',
                strength: calculateDivergenceStrength(priceMove, oscillatorMove, distance, 'regular_bearish'),
                confidence: calculateDivergenceConfidence(priceMove, oscillatorMove, distance),
                description: 'Price higher high, oscillator lower high - potential downward reversal',
                pricePivots: [firstPriceHigh, secondPriceHigh],
                oscillatorPivots: [firstOscHigh, secondOscHigh]
            };
        }
    }
    
    return null;
}

/**
 * Analyzes for Hidden Bullish Divergence
 * Price makes higher low, oscillator makes lower low (CONTINUATION signal)
 */
function analyzeHiddenBullishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove, debugMode = false, onLog = null) {
    const priceLows = pricePivots.lows;
    const oscillatorLows = oscillatorPivots.lows;

    if (priceLows.length < 2 || oscillatorLows.length < 2) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] Hidden Bullish: Not enough pivots - priceLows=${priceLows.length}, oscillatorLows=${oscillatorLows.length} (need 2+)`, 'debug');
        }
        return null;
    }

    // Search through all price pivot pairs (starting from most recent)
    for (let i = priceLows.length - 1; i >= 1; i--) {
        const secondPriceLow = priceLows[i];
        for (let j = i - 1; j >= 0; j--) {
            const firstPriceLow = priceLows[j];
            
            // Check if price made a higher low (indicating uptrend continuation)
            if (secondPriceLow.value <= firstPriceLow.value) continue;
            
            // Find corresponding oscillator lows within reasonable distance
            const firstOscLow = findNearestPivot(oscillatorLows, firstPriceLow.index, maxDistance);
            let secondOscLow = findNearestPivot(oscillatorLows, secondPriceLow.index, maxDistance);
            
            // CRITICAL FIX: If both oscillator pivots are the same, find a different one for secondOscLow
            if (firstOscLow && secondOscLow && firstOscLow.index === secondOscLow.index) {
                secondOscLow = oscillatorLows.find(p => 
                    p.index !== firstOscLow.index && 
                    Math.abs(p.index - secondPriceLow.index) <= maxDistance
                ) || null;
            }
            
            if (!firstOscLow || !secondOscLow) continue;
            
            // Check distance between pivots
            const distance = Math.abs(secondPriceLow.index - firstPriceLow.index);
            if (distance < minDistance || distance > maxDistance) continue;
            
            // Check if oscillator made a lower low
            if (secondOscLow.value >= firstOscLow.value) continue;
            
            // Validate minimum moves
            const priceMove = Math.abs(secondPriceLow.value - firstPriceLow.value) / firstPriceLow.value;
            const oscillatorMove = Math.abs(secondOscLow.value - firstOscLow.value);
            
            // Relaxed: Allow smaller price moves if oscillator move is strong
            let priceMoveRelaxed = minPriceMove;
            if (oscillatorMove >= minOscillatorMove * 6) {
                priceMoveRelaxed = minPriceMove * 0.10;
            } else if (oscillatorMove >= minOscillatorMove * 3) {
                priceMoveRelaxed = minPriceMove * 0.12;
            } else if (oscillatorMove >= minOscillatorMove * 2) {
                priceMoveRelaxed = minPriceMove * 0.25;
            }
            
            const tolerance = priceMoveRelaxed * 0.02;
            if (priceMove < (priceMoveRelaxed - tolerance) || oscillatorMove < minOscillatorMove) continue;
            
            // Found valid divergence - return it (most recent match)
            if (debugMode && onLog) {
                //onLog(`[MFI_PIVOT_DEBUG] Hidden Bullish: ✅ Divergence detected! Price: ${firstPriceLow.value.toFixed(2)} -> ${secondPriceLow.value.toFixed(2)} (HL), MFI: ${firstOscLow.value.toFixed(2)} -> ${secondOscLow.value.toFixed(2)} (LL)`, 'debug');
            }
            
            return {
                type: 'Hidden Bullish Divergence',
                direction: 'bullish',
                category: 'continuation',
                strength: calculateDivergenceStrength(priceMove, oscillatorMove, distance, 'hidden_bullish'),
                confidence: calculateDivergenceConfidence(priceMove, oscillatorMove, distance),
                description: 'Price higher low, oscillator lower low - uptrend continuation',
                pricePivots: [firstPriceLow, secondPriceLow],
                oscillatorPivots: [firstOscLow, secondOscLow]
            };
        }
    }
    
    return null;
}

/**
 * Analyzes for Hidden Bearish Divergence
 * Price makes lower high, oscillator makes higher high (CONTINUATION signal)
 */
function analyzeHiddenBearishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove, debugMode = false, onLog = null) {
    const priceHighs = pricePivots.highs;
    const oscillatorHighs = oscillatorPivots.highs;

    if (priceHighs.length < 2 || oscillatorHighs.length < 2) {
        if (debugMode && onLog) {
            //onLog(`[MFI_PIVOT_DEBUG] Hidden Bearish: Not enough pivots - priceHighs=${priceHighs.length}, oscillatorHighs=${oscillatorHighs.length} (need 2+)`, 'debug');
        }
        return null;
    }

    // Search through all price pivot pairs (starting from most recent)
    for (let i = priceHighs.length - 1; i >= 1; i--) {
        const secondPriceHigh = priceHighs[i];
        for (let j = i - 1; j >= 0; j--) {
            const firstPriceHigh = priceHighs[j];
            
            // Check if price made a lower high (indicating downtrend continuation)
            if (secondPriceHigh.value >= firstPriceHigh.value) continue;
            
            // Find corresponding oscillator highs within reasonable distance
            const firstOscHigh = findNearestPivot(oscillatorHighs, firstPriceHigh.index, maxDistance);
            let secondOscHigh = findNearestPivot(oscillatorHighs, secondPriceHigh.index, maxDistance);
            
            // CRITICAL FIX: If both oscillator pivots are the same, find a different one for secondOscHigh
            if (firstOscHigh && secondOscHigh && firstOscHigh.index === secondOscHigh.index) {
                secondOscHigh = oscillatorHighs.find(p => 
                    p.index !== firstOscHigh.index && 
                    Math.abs(p.index - secondPriceHigh.index) <= maxDistance
                ) || null;
            }
            
            if (!firstOscHigh || !secondOscHigh) continue;
            
            // Check distance between pivots
            const distance = Math.abs(secondPriceHigh.index - firstPriceHigh.index);
            if (distance < minDistance || distance > maxDistance) continue;
            
            // Check if oscillator made a higher high
            if (secondOscHigh.value <= firstOscHigh.value) continue;
            
            // Validate minimum moves
            const priceMove = Math.abs(secondPriceHigh.value - firstPriceHigh.value) / firstPriceHigh.value;
            const oscillatorMove = Math.abs(secondOscHigh.value - firstOscHigh.value);
            
            // Relaxed: Allow smaller price moves if oscillator move is strong
            let priceMoveRelaxed = minPriceMove;
            if (oscillatorMove >= minOscillatorMove * 6) {
                priceMoveRelaxed = minPriceMove * 0.10;
            } else if (oscillatorMove >= minOscillatorMove * 3) {
                priceMoveRelaxed = minPriceMove * 0.12;
            } else if (oscillatorMove >= minOscillatorMove * 2) {
                priceMoveRelaxed = minPriceMove * 0.25;
            }
            
            const tolerance = priceMoveRelaxed * 0.02;
            if (priceMove < (priceMoveRelaxed - tolerance) || oscillatorMove < minOscillatorMove) continue;
            
            // Found valid divergence - return it (most recent match)
            if (debugMode && onLog) {
                //onLog(`[MFI_PIVOT_DEBUG] Hidden Bearish: ✅ Divergence detected! Price: ${firstPriceHigh.value.toFixed(2)} -> ${secondPriceHigh.value.toFixed(2)} (LH), MFI: ${firstOscHigh.value.toFixed(2)} -> ${secondOscHigh.value.toFixed(2)} (HH)`, 'debug');
            }
            
            return {
                type: 'Hidden Bearish Divergence',
                direction: 'bearish',
                category: 'continuation',
                strength: calculateDivergenceStrength(priceMove, oscillatorMove, distance, 'hidden_bearish'),
                confidence: calculateDivergenceConfidence(priceMove, oscillatorMove, distance),
                description: 'Price lower high, oscillator higher high - downtrend continuation',
                pricePivots: [firstPriceHigh, secondPriceHigh],
                oscillatorPivots: [firstOscHigh, secondOscHigh]
            };
        }
    }
    
    return null;
}

/**
 * Finds the nearest pivot to a given index within maximum distance
 */
function findNearestPivot(pivots, targetIndex, maxDistance) {
    let nearest = null;
    let minDistance = Infinity;

    for (const pivot of pivots) {
        const distance = Math.abs(pivot.index - targetIndex);
        if (distance <= maxDistance && distance < minDistance) {
            minDistance = distance;
            nearest = pivot;
        }
    }

    return nearest;
}

/**
 * Calculates divergence strength based on price move, oscillator move, and distance
 */
function calculateDivergenceStrength(priceMove, oscillatorMove, distance, divergenceType) {
    let baseStrength = 75; // Base strength for divergences

    // Adjust based on divergence type
    switch (divergenceType) {
        case 'regular_bullish':
        case 'regular_bearish':
            baseStrength = 80; // Regular divergences are stronger reversal signals
            break;
        case 'hidden_bullish':
        case 'hidden_bearish':
            baseStrength = 75; // Hidden divergences are strong continuation signals
            break;
    }

    // Strengthen based on magnitude of moves
    const priceMoveBonus = Math.min(priceMove * 200, 15); // Max 15 bonus for large price moves
    const oscillatorMoveBonus = Math.min(oscillatorMove * 0.5, 10); // Max 10 bonus for large oscillator moves

    // Adjust based on distance between pivots
    const distanceMultiplier = distance > 30 ? 1.1 : distance < 10 ? 0.9 : 1.0;

    const finalStrength = (baseStrength + priceMoveBonus + oscillatorMoveBonus) * distanceMultiplier;
    return Math.min(Math.max(finalStrength, 50), 100); // Clamp between 50-100
}

/**
 * Calculates divergence confidence based on various factors
 */
function calculateDivergenceConfidence(priceMove, oscillatorMove, distance) {
    let confidence = 0.7; // Base confidence

    // Higher confidence for larger moves
    if (priceMove > 0.05) confidence += 0.1; // 5%+ price move
    if (oscillatorMove > 10) confidence += 0.1; // Large oscillator move

    // Optimal distance range
    if (distance >= 15 && distance <= 40) confidence += 0.1;

    return Math.min(confidence, 1.0);
}

/**
 * Helper function for regime adjustment (used in other files)
 */
export function applyRegimeAdjustment(baseStrength, marketRegime, signalType) {
    if (!marketRegime || typeof marketRegime !== 'string') {
        return baseStrength;
    }

    // Get regime multiplier based on market regime and signal type
    const regimeMultiplier = getRegimeMultiplier(marketRegime, signalType);
    return Math.min(baseStrength * regimeMultiplier, 100);
}