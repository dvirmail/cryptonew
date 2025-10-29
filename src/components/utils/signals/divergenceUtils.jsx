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

    if (!priceData || !oscillatorData || currentIndex < lookbackPeriod) {
        return null;
    }

    const startIndex = Math.max(0, currentIndex - lookbackPeriod);
    const endIndex = currentIndex;

    // Find pivots in both price and oscillator
    const pricePivots = findPivots(priceData, startIndex, endIndex, pivotLookback);
    const oscillatorPivots = findPivots(oscillatorData, startIndex, endIndex, pivotLookback);

    // Analyze for different types of divergences
    const regularBullish = analyzeRegularBullishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove);
    const regularBearish = analyzeRegularBearishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove);
    const hiddenBullish = analyzeHiddenBullishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove);
    const hiddenBearish = analyzeHiddenBearishDivergence(pricePivots, oscillatorPivots, minPeakDistance, maxPeakDistance, minPriceMove, minOscillatorMove);

    // Return the strongest divergence found
    const divergences = [regularBullish, regularBearish, hiddenBullish, hiddenBearish].filter(d => d !== null);
    
    if (divergences.length === 0) {
        return null;
    }

    // Sort by strength and return the strongest
    return divergences.sort((a, b) => b.strength - a.strength)[0];
}

/**
 * Finds pivot points (local highs and lows) in the data
 */
function findPivots(data, startIndex, endIndex, pivotLookback) {
    const pivots = {
        highs: [],
        lows: []
    };

    for (let i = startIndex + pivotLookback; i <= endIndex - pivotLookback; i++) {
        const current = data[i];
        let isHigh = true;
        let isLow = true;

        // Check if current point is a local high
        for (let j = i - pivotLookback; j <= i + pivotLookback; j++) {
            if (j !== i && data[j] >= current) {
                isHigh = false;
                break;
            }
        }

        // Check if current point is a local low
        for (let j = i - pivotLookback; j <= i + pivotLookback; j++) {
            if (j !== i && data[j] <= current) {
                isLow = false;
                break;
            }
        }

        if (isHigh) {
            pivots.highs.push({ index: i, value: current });
        }
        if (isLow) {
            pivots.lows.push({ index: i, value: current });
        }
    }

    return pivots;
}

/**
 * Analyzes for Regular Bullish Divergence
 * Price makes lower low, oscillator makes higher low (REVERSAL signal)
 */
function analyzeRegularBullishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove) {
    const priceLows = pricePivots.lows;
    const oscillatorLows = oscillatorPivots.lows;

    if (priceLows.length < 2 || oscillatorLows.length < 2) {
        return null;
    }

    // Find the most recent two price lows
    const recentPriceLows = priceLows.slice(-2);
    const [firstPriceLow, secondPriceLow] = recentPriceLows;

    // Check if price made a lower low
    if (secondPriceLow.value >= firstPriceLow.value) {
        return null;
    }

    // Find corresponding oscillator lows within reasonable distance
    const firstOscLow = findNearestPivot(oscillatorLows, firstPriceLow.index, maxDistance);
    const secondOscLow = findNearestPivot(oscillatorLows, secondPriceLow.index, maxDistance);

    if (!firstOscLow || !secondOscLow) {
        return null;
    }

    // Check distance between pivots
    const distance = Math.abs(secondPriceLow.index - firstPriceLow.index);
    if (distance < minDistance || distance > maxDistance) {
        return null;
    }

    // Check if oscillator made a higher low
    if (secondOscLow.value <= firstOscLow.value) {
        return null;
    }

    // Validate minimum moves
    const priceMove = Math.abs(secondPriceLow.value - firstPriceLow.value) / firstPriceLow.value;
    const oscillatorMove = Math.abs(secondOscLow.value - firstOscLow.value);

    if (priceMove < minPriceMove || oscillatorMove < minOscillatorMove) {
        return null;
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

/**
 * Analyzes for Regular Bearish Divergence
 * Price makes higher high, oscillator makes lower high (REVERSAL signal)
 */
function analyzeRegularBearishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove) {
    const priceHighs = pricePivots.highs;
    const oscillatorHighs = oscillatorPivots.highs;

    if (priceHighs.length < 2 || oscillatorHighs.length < 2) {
        return null;
    }

    // Find the most recent two price highs
    const recentPriceHighs = priceHighs.slice(-2);
    const [firstPriceHigh, secondPriceHigh] = recentPriceHighs;

    // Check if price made a higher high
    if (secondPriceHigh.value <= firstPriceHigh.value) {
        return null;
    }

    // Find corresponding oscillator highs within reasonable distance
    const firstOscHigh = findNearestPivot(oscillatorHighs, firstPriceHigh.index, maxDistance);
    const secondOscHigh = findNearestPivot(oscillatorHighs, secondPriceHigh.index, maxDistance);

    if (!firstOscHigh || !secondOscHigh) {
        return null;
    }

    // Check distance between pivots
    const distance = Math.abs(secondPriceHigh.index - firstPriceHigh.index);
    if (distance < minDistance || distance > maxDistance) {
        return null;
    }

    // Check if oscillator made a lower high
    if (secondOscHigh.value >= firstOscHigh.value) {
        return null;
    }

    // Validate minimum moves
    const priceMove = Math.abs(secondPriceHigh.value - firstPriceHigh.value) / firstPriceHigh.value;
    const oscillatorMove = Math.abs(secondOscHigh.value - firstOscHigh.value);

    if (priceMove < minPriceMove || oscillatorMove < minOscillatorMove) {
        return null;
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

/**
 * Analyzes for Hidden Bullish Divergence
 * Price makes higher low, oscillator makes lower low (CONTINUATION signal)
 */
function analyzeHiddenBullishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove) {
    const priceLows = pricePivots.lows;
    const oscillatorLows = oscillatorPivots.lows;

    if (priceLows.length < 2 || oscillatorLows.length < 2) {
        return null;
    }

    // Find the most recent two price lows
    const recentPriceLows = priceLows.slice(-2);
    const [firstPriceLow, secondPriceLow] = recentPriceLows;

    // Check if price made a higher low (indicating uptrend continuation)
    if (secondPriceLow.value <= firstPriceLow.value) {
        return null;
    }

    // Find corresponding oscillator lows within reasonable distance
    const firstOscLow = findNearestPivot(oscillatorLows, firstPriceLow.index, maxDistance);
    const secondOscLow = findNearestPivot(oscillatorLows, secondPriceLow.index, maxDistance);

    if (!firstOscLow || !secondOscLow) {
        return null;
    }

    // Check distance between pivots
    const distance = Math.abs(secondPriceLow.index - firstPriceLow.index);
    if (distance < minDistance || distance > maxDistance) {
        return null;
    }

    // Check if oscillator made a lower low
    if (secondOscLow.value >= firstOscLow.value) {
        return null;
    }

    // Validate minimum moves
    const priceMove = Math.abs(secondPriceLow.value - firstPriceLow.value) / firstPriceLow.value;
    const oscillatorMove = Math.abs(secondOscLow.value - firstOscLow.value);

    if (priceMove < minPriceMove || oscillatorMove < minOscillatorMove) {
        return null;
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

/**
 * Analyzes for Hidden Bearish Divergence
 * Price makes lower high, oscillator makes higher high (CONTINUATION signal)
 */
function analyzeHiddenBearishDivergence(pricePivots, oscillatorPivots, minDistance, maxDistance, minPriceMove, minOscillatorMove) {
    const priceHighs = pricePivots.highs;
    const oscillatorHighs = oscillatorPivots.highs;

    if (priceHighs.length < 2 || oscillatorHighs.length < 2) {
        return null;
    }

    // Find the most recent two price highs
    const recentPriceHighs = priceHighs.slice(-2);
    const [firstPriceHigh, secondPriceHigh] = recentPriceHighs;

    // Check if price made a lower high (indicating downtrend continuation)
    if (secondPriceHigh.value >= firstPriceHigh.value) {
        return null;
    }

    // Find corresponding oscillator highs within reasonable distance
    const firstOscHigh = findNearestPivot(oscillatorHighs, firstPriceHigh.index, maxDistance);
    const secondOscHigh = findNearestPivot(oscillatorHighs, secondPriceHigh.index, maxDistance);

    if (!firstOscHigh || !secondOscHigh) {
        return null;
    }

    // Check distance between pivots
    const distance = Math.abs(secondPriceHigh.index - firstPriceHigh.index);
    if (distance < minDistance || distance > maxDistance) {
        return null;
    }

    // Check if oscillator made a higher high
    if (secondOscHigh.value <= firstOscHigh.value) {
        return null;
    }

    // Validate minimum moves
    const priceMove = Math.abs(secondPriceHigh.value - firstPriceHigh.value) / firstPriceHigh.value;
    const oscillatorMove = Math.abs(secondOscHigh.value - firstOscHigh.value);

    if (priceMove < minPriceMove || oscillatorMove < minOscillatorMove) {
        return null;
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