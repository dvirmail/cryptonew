import { get } from 'lodash';
import { calculateMA } from '../indicator-calculations/helpers';

/**
 * Adaptive Thresholds Utility
 * 
 * This module provides dynamic overbought/oversold thresholds by calculating
 * Bollinger Bands on oscillators themselves, making thresholds adaptive to
 * current market volatility and trend conditions.
 */

/**
 * Calculates adaptive Bollinger Bands for an oscillator
 * @param {Array} oscillatorData - Array of oscillator values
 * @param {number} period - Period for moving average calculation
 * @param {number} stdDevMultiplier - Standard deviation multiplier for bands
 * @returns {object} Bollinger Bands data for the oscillator
 */
export function calculateOscillatorBollingerBands(oscillatorData, period = 20, stdDevMultiplier = 2.0) {
    if (!oscillatorData || oscillatorData.length < period) {
        return null;
    }

    const result = {
        middle: [],
        upper: [],
        lower: [],
        bandwidth: []
    };

    for (let i = 0; i < oscillatorData.length; i++) {
        if (i < period - 1) {
            result.middle.push(null);
            result.upper.push(null);
            result.lower.push(null);
            result.bandwidth.push(null);
            continue;
        }

        // Calculate simple moving average
        const slice = oscillatorData.slice(i - period + 1, i + 1);
        const sma = slice.reduce((sum, val) => sum + (val || 0), 0) / slice.length;

        // Calculate standard deviation
        const variance = slice.reduce((sum, val) => {
            const diff = (val || 0) - sma;
            return sum + (diff * diff);
        }, 0) / slice.length;
        const stdDev = Math.sqrt(variance);

        // Calculate bands
        const upperBand = sma + (stdDev * stdDevMultiplier);
        const lowerBand = sma - (stdDev * stdDevMultiplier);
        const bandwidth = upperBand - lowerBand;

        result.middle.push(sma);
        result.upper.push(upperBand);
        result.lower.push(lowerBand);
        result.bandwidth.push(bandwidth);
    }

    return result;
}

/**
 * Gets adaptive thresholds for an oscillator at a specific index
 * @param {Array} oscillatorData - Array of oscillator values
 * @param {number} index - Current index
 * @param {object} settings - Threshold settings
 * @returns {object} Adaptive threshold levels
 */
export function getAdaptiveThresholds(oscillatorData, index, settings = {}) {
    const period = settings.adaptivePeriod || 20;
    const stdDevMultiplier = settings.adaptiveStdDevMultiplier || 2.0;
    const staticFallback = settings.staticFallback !== false; // Default true
    const minBandwidth = settings.minBandwidth || 5; // Minimum bandwidth to prevent over-sensitivity

    // Calculate Bollinger Bands on the oscillator
    const bands = calculateOscillatorBollingerBands(oscillatorData, period, stdDevMultiplier);
    
    if (!bands || !bands.upper[index] || !bands.lower[index]) {
        if (staticFallback) {
            // Fallback to static thresholds
            return {
                overbought: settings.staticOverbought || 70,
                oversold: settings.staticOversold || 30,
                middle: settings.staticMiddle || 50,
                adaptive: false,
                bandwidth: null,
                thresholdType: 'static_fallback'
            };
        }
        return null;
    }

    const currentBandwidth = bands.bandwidth[index];
    
    // Prevent over-sensitivity in low volatility environments
    if (currentBandwidth < minBandwidth) {
        const expansion = minBandwidth / currentBandwidth;
        const middle = bands.middle[index];
        const halfBandwidth = minBandwidth / 2;
        
        return {
            overbought: middle + halfBandwidth,
            oversold: middle - halfBandwidth,
            middle: middle,
            adaptive: true,
            bandwidth: minBandwidth,
            thresholdType: 'minimum_bandwidth_adjusted',
            expansion: expansion
        };
    }

    return {
        overbought: bands.upper[index],
        oversold: bands.lower[index],
        middle: bands.middle[index],
        adaptive: true,
        bandwidth: currentBandwidth,
        thresholdType: 'fully_adaptive',
        rawBands: {
            upper: bands.upper[index],
            lower: bands.lower[index],
            middle: bands.middle[index]
        }
    };
}

/**
 * Analyzes threshold breach context for enhanced signal interpretation
 * @param {number} currentValue - Current oscillator value
 * @param {number} previousValue - Previous oscillator value
 * @param {object} thresholds - Current adaptive thresholds
 * @param {object} previousThresholds - Previous adaptive thresholds
 * @returns {object} Breach analysis results
 */
export function analyzeThresholdBreach(currentValue, previousValue, thresholds, previousThresholds) {
    if (!thresholds || currentValue === undefined || previousValue === undefined) {
        return null;
    }

    const result = {
        breachType: null,
        strength: 0,
        context: {},
        isAdaptive: thresholds.adaptive
    };

    // Check for overbought breach
    if (currentValue > thresholds.overbought && previousValue <= (previousThresholds?.overbought || thresholds.overbought)) {
        result.breachType = 'overbought_entry';
        result.strength = calculateBreachStrength(currentValue, thresholds.overbought, thresholds.bandwidth);
        
        // Enhanced context for adaptive thresholds
        if (thresholds.adaptive) {
            result.context = {
                thresholdLevel: thresholds.overbought,
                bandwidth: thresholds.bandwidth,
                thresholdType: thresholds.thresholdType,
                volatilityContext: classifyVolatilityContext(thresholds.bandwidth),
                exceedance: currentValue - thresholds.overbought
            };
        }
    }
    
    // Check for oversold breach
    else if (currentValue < thresholds.oversold && previousValue >= (previousThresholds?.oversold || thresholds.oversold)) {
        result.breachType = 'oversold_entry';
        result.strength = calculateBreachStrength(thresholds.oversold, currentValue, thresholds.bandwidth);
        
        // Enhanced context for adaptive thresholds
        if (thresholds.adaptive) {
            result.context = {
                thresholdLevel: thresholds.oversold,
                bandwidth: thresholds.bandwidth,
                thresholdType: thresholds.thresholdType,
                volatilityContext: classifyVolatilityContext(thresholds.bandwidth),
                exceedance: thresholds.oversold - currentValue
            };
        }
    }
    
    // Check for exits from extreme zones
    else if (previousValue > (previousThresholds?.overbought || thresholds.overbought) && currentValue <= thresholds.overbought) {
        result.breachType = 'overbought_exit';
        result.strength = calculateExitStrength(previousValue, currentValue, thresholds.overbought);
    }
    
    else if (previousValue < (previousThresholds?.oversold || thresholds.oversold) && currentValue >= thresholds.oversold) {
        result.breachType = 'oversold_exit';
        result.strength = calculateExitStrength(currentValue, previousValue, thresholds.oversold);
    }

    return result.breachType ? result : null;
}

/**
 * Calculates breach strength based on exceedance and volatility context
 */
function calculateBreachStrength(value1, value2, bandwidth) {
    const exceedance = Math.abs(value1 - value2);
    let baseStrength = 70;
    
    // Adjust strength based on exceedance relative to bandwidth
    if (bandwidth && bandwidth > 0) {
        const exceedanceRatio = exceedance / (bandwidth * 0.1); // 10% of bandwidth as baseline
        baseStrength += Math.min(exceedanceRatio * 5, 20); // Max 20 point bonus
    } else {
        // For static thresholds, use absolute exceedance
        baseStrength += Math.min(exceedance * 0.5, 15); // Max 15 point bonus
    }
    
    return Math.min(Math.max(baseStrength, 60), 95);
}

/**
 * Calculates exit strength based on the speed and magnitude of the exit
 */
function calculateExitStrength(currentValue, previousValue, thresholdLevel) {
    const exitSpeed = Math.abs(currentValue - previousValue);
    const distanceFromThreshold = Math.abs(currentValue - thresholdLevel);
    
    let baseStrength = 65;
    baseStrength += Math.min(exitSpeed * 0.3, 10); // Speed bonus
    baseStrength += Math.min(distanceFromThreshold * 0.2, 10); // Distance bonus
    
    return Math.min(Math.max(baseStrength, 55), 85);
}

/**
 * Classifies volatility context based on bandwidth
 */
function classifyVolatilityContext(bandwidth) {
    if (!bandwidth) return 'unknown';
    
    if (bandwidth < 10) return 'low_volatility';
    if (bandwidth < 25) return 'normal_volatility';
    if (bandwidth < 40) return 'high_volatility';
    return 'extreme_volatility';
}

/**
 * Generates human-readable description for adaptive threshold signals
 */
export function generateAdaptiveSignalDescription(breachAnalysis, oscillatorName) {
    if (!breachAnalysis || !breachAnalysis.context) {
        return null;
    }

    const { breachType, context } = breachAnalysis;
    const { volatilityContext, thresholdType, exceedance } = context;
    
    let description = `${oscillatorName} `;
    
    switch (breachType) {
        case 'overbought_entry':
            description += `reached adaptive overbought level (${context.thresholdLevel.toFixed(1)}) `;
            break;
        case 'oversold_entry':
            description += `reached adaptive oversold level (${context.thresholdLevel.toFixed(1)}) `;
            break;
        case 'overbought_exit':
            description += `exited overbought zone `;
            break;
        case 'oversold_exit':
            description += `exited oversold zone `;
            break;
    }
    
    // Add volatility context
    switch (volatilityContext) {
        case 'low_volatility':
            description += 'in low volatility environment';
            break;
        case 'high_volatility':
            description += 'in high volatility environment';
            break;
        case 'extreme_volatility':
            description += 'in extreme volatility environment';
            break;
        default:
            description += 'with adaptive thresholds';
    }
    
    if (exceedance && exceedance > 2) {
        description += ` (exceeded by ${exceedance.toFixed(1)})`;
    }
    
    return description;
}

/**
 * Compares adaptive vs static threshold effectiveness
 */
export function compareThresholdEffectiveness(oscillatorData, staticSettings, adaptiveSettings, lookbackPeriod = 100) {
    if (!oscillatorData || oscillatorData.length < lookbackPeriod) {
        return null;
    }
    
    const startIndex = oscillatorData.length - lookbackPeriod;
    let adaptiveSignals = 0;
    let staticSignals = 0;
    let adaptiveAdvantage = 0;
    
    for (let i = startIndex; i < oscillatorData.length - 1; i++) {
        const adaptiveThresholds = getAdaptiveThresholds(oscillatorData, i, adaptiveSettings);
        const currentValue = oscillatorData[i];
        const nextValue = oscillatorData[i + 1];
        
        // Count adaptive signals
        if (adaptiveThresholds && (currentValue > adaptiveThresholds.overbought || currentValue < adaptiveThresholds.oversold)) {
            adaptiveSignals++;
        }
        
        // Count static signals
        if (currentValue > staticSettings.overbought || currentValue < staticSettings.oversold) {
            staticSignals++;
        }
        
        // Measure adaptive advantage (simplified)
        if (adaptiveThresholds && adaptiveThresholds.adaptive) {
            const staticWouldSignal = (currentValue > staticSettings.overbought || currentValue < staticSettings.oversold);
            const adaptiveSignals = (currentValue > adaptiveThresholds.overbought || currentValue < adaptiveThresholds.oversold);
            
            if (adaptiveSignals && !staticWouldSignal) {
                adaptiveAdvantage++; // Adaptive caught a signal static missed
            } else if (!adaptiveSignals && staticWouldSignal) {
                adaptiveAdvantage--; // Static would have signaled but adaptive filtered it out
            }
        }
    }
    
    return {
        adaptiveSignalCount: adaptiveSignals,
        staticSignalCount: staticSignals,
        adaptiveAdvantage: adaptiveAdvantage,
        adaptiveEfficiencyRatio: adaptiveSignals > 0 ? adaptiveAdvantage / adaptiveSignals : 0,
        recommendation: adaptiveAdvantage > 0 ? 'adaptive' : 'static'
    };
}