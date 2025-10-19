import { get } from 'lodash';

/**
 * Breakout/Rejection Confirmation Utility
 * 
 * This module provides sophisticated confirmation analysis for support/resistance
 * breakouts and rejections, helping filter out false signals and enhance
 * the reliability of key level interactions.
 */

/**
 * Analyzes price action after a support/resistance level interaction
 * @param {number} levelPrice - The S/R level price that was tested
 * @param {string} levelType - 'support' or 'resistance'
 * @param {object} indicators - All technical indicators
 * @param {number} currentIndex - Current candle index
 * @param {object} settings - Signal settings with confirmation parameters
 * @returns {object} Confirmation analysis results
 */
export function analyzeBreakoutConfirmation(levelPrice, levelType, indicators, currentIndex, settings) {
    const data = get(indicators, 'data', []);
    const volumeSMA = get(indicators, 'volumeSMA', []);
    
    if (!data || data.length <= currentIndex) {
        return {
            type: 'insufficient_data',
            confirmed: false,
            strength: 0,
            description: 'Insufficient data for confirmation'
        };
    }

    const confirmationCandles = settings.confirmationCandles || 3;
    const breakoutMinDistance = settings.breakoutMinDistance || 0.008;
    const rejectionMaxDistance = settings.rejectionMaxDistance || 0.005;
    const volumeMultiplier = settings.volumeConfirmationMultiplier || 1.8;
    
    const currentCandle = data[currentIndex];
    const endIndex = Math.min(currentIndex + confirmationCandles, data.length - 1);
    
    // Analyze the next few candles for confirmation
    let confirmationData = {
        candles: [],
        avgVolume: 0,
        maxPrice: currentCandle.high,
        minPrice: currentCandle.low,
        strongVolumeCandles: 0,
        totalVolume: 0
    };

    // Collect confirmation candle data
    for (let i = currentIndex; i <= endIndex; i++) {
        const candle = data[i];
        const volume = candle ? candle.volume : 0;
        const volumeAvg = volumeSMA[i] || volumeSMA[currentIndex] || 0;
        
        if (candle) {
            confirmationData.candles.push({
                index: i,
                candle: candle,
                volume: volume,
                volumeAvg: volumeAvg,
                highVolumeRatio: volumeAvg > 0 ? volume / volumeAvg : 0
            });
            
            confirmationData.maxPrice = Math.max(confirmationData.maxPrice, candle.high);
            confirmationData.minPrice = Math.min(confirmationData.minPrice, candle.low);
            confirmationData.totalVolume += volume;
            
            if (volumeAvg > 0 && volume > volumeAvg * volumeMultiplier) {
                confirmationData.strongVolumeCandles++;
            }
        }
    }

    confirmationData.avgVolume = confirmationData.totalVolume / confirmationData.candles.length;

    // Determine breakout/rejection based on level type
    if (levelType === 'support') {
        return analyzeSupportBreakoutRejection(levelPrice, confirmationData, settings);
    } else if (levelType === 'resistance') {
        return analyzeResistanceBreakoutRejection(levelPrice, confirmationData, settings);
    }

    return {
        type: 'unknown_level_type',
        confirmed: false,
        strength: 0,
        description: 'Unknown level type'
    };
}

/**
 * Analyzes support level breakout/rejection confirmation
 */
function analyzeSupportBreakoutRejection(supportPrice, confirmationData, settings) {
    const breakoutMinDistance = settings.breakoutMinDistance || 0.008;
    const rejectionMaxDistance = settings.rejectionMaxDistance || 0.005;
    const confirmedBreakoutBonus = settings.confirmedBreakoutBonus || 25;
    const confirmedRejectionBonus = settings.confirmedRejectionBonus || 20;
    const falseBreakoutPenalty = settings.falseBreakoutPenalty || -20;

    const lowestLow = confirmationData.minPrice;
    const highestHigh = confirmationData.maxPrice;
    const strongVolumeRatio = confirmationData.strongVolumeCandles / confirmationData.candles.length;

    // Check for support breakdown (bearish breakout)
    const breakdownDistance = supportPrice - lowestLow;
    const breakdownPercentage = breakdownDistance / supportPrice;

    if (breakdownPercentage >= breakoutMinDistance) {
        // Potential breakdown - check for confirmation
        const lastCandles = confirmationData.candles.slice(-2); // Last 2 candles
        const mostCandlesBelow = confirmationData.candles.filter(c => c.candle.close < supportPrice).length;
        const confirmationRatio = mostCandlesBelow / confirmationData.candles.length;

        if (confirmationRatio >= 0.6 && strongVolumeRatio >= 0.3) {
            return {
                type: 'confirmed_breakdown',
                confirmed: true,
                strength: confirmedBreakoutBonus,
                description: `Confirmed Support Breakdown (${(breakdownPercentage * 100).toFixed(2)}% break with ${(strongVolumeRatio * 100).toFixed(0)}% high volume candles)`,
                breakoutDistance: breakdownDistance,
                volumeConfirmation: true
            };
        } else if (confirmationRatio >= 0.4) {
            return {
                type: 'partial_breakdown',
                confirmed: false,
                strength: Math.floor(confirmedBreakoutBonus * 0.6),
                description: `Partial Support Breakdown (${(breakdownPercentage * 100).toFixed(2)}% break, weak confirmation)`,
                breakoutDistance: breakdownDistance,
                volumeConfirmation: false
            };
        } else {
            // False breakdown - price came back above support
            return {
                type: 'false_breakdown',
                confirmed: false,
                strength: falseBreakoutPenalty,
                description: `False Support Breakdown (${(breakdownPercentage * 100).toFixed(2)}% break failed, price recovered)`,
                breakoutDistance: breakdownDistance,
                volumeConfirmation: false
            };
        }
    }

    // Check for support hold/rejection (bullish)
    const rejectionDistance = Math.abs(supportPrice - lowestLow);
    const rejectionPercentage = rejectionDistance / supportPrice;

    if (rejectionPercentage <= rejectionMaxDistance) {
        // Price stayed near support - check for bullish rejection
        const lastCandles = confirmationData.candles.slice(-2);
        const bounceStrength = highestHigh - lowestLow;
        const bouncePercentage = bounceStrength / supportPrice;
        
        const mostCandlesAbove = confirmationData.candles.filter(c => c.candle.close >= supportPrice).length;
        const holdRatio = mostCandlesAbove / confirmationData.candles.length;

        if (holdRatio >= 0.6 && bouncePercentage >= 0.005) {
            let strength = confirmedRejectionBonus;
            let description = `Confirmed Support Hold`;

            // Bonus for strong bounce
            if (bouncePercentage >= 0.02) {
                strength += 8;
                description += ` with Strong Bounce (${(bouncePercentage * 100).toFixed(2)}%)`;
            } else if (bouncePercentage >= 0.01) {
                strength += 4;
                description += ` with Moderate Bounce (${(bouncePercentage * 100).toFixed(2)}%)`;
            }

            // Volume confirmation bonus
            if (strongVolumeRatio >= 0.3) {
                strength += 5;
                description += ` (Volume Confirmed)`;
            }

            return {
                type: 'confirmed_support_hold',
                confirmed: true,
                strength: strength,
                description: description,
                bounceStrength: bounceStrength,
                volumeConfirmation: strongVolumeRatio >= 0.3
            };
        } else {
            return {
                type: 'weak_support_test',
                confirmed: false,
                strength: Math.floor(confirmedRejectionBonus * 0.4),
                description: `Weak Support Test (${(rejectionPercentage * 100).toFixed(2)}% from level, minimal bounce)`,
                bounceStrength: bounceStrength,
                volumeConfirmation: false
            };
        }
    }

    // No clear breakout or rejection
    return {
        type: 'inconclusive',
        confirmed: false,
        strength: 0,
        description: 'Inconclusive support interaction',
        bounceStrength: 0,
        volumeConfirmation: false
    };
}

/**
 * Analyzes resistance level breakout/rejection confirmation
 */
function analyzeResistanceBreakoutRejection(resistancePrice, confirmationData, settings) {
    const breakoutMinDistance = settings.breakoutMinDistance || 0.008;
    const rejectionMaxDistance = settings.rejectionMaxDistance || 0.005;
    const confirmedBreakoutBonus = settings.confirmedBreakoutBonus || 25;
    const confirmedRejectionBonus = settings.confirmedRejectionBonus || 20;
    const falseBreakoutPenalty = settings.falseBreakoutPenalty || -20;

    const lowestLow = confirmationData.minPrice;
    const highestHigh = confirmationData.maxPrice;
    const strongVolumeRatio = confirmationData.strongVolumeCandles / confirmationData.candles.length;

    // Check for resistance breakout (bullish breakout)
    const breakoutDistance = highestHigh - resistancePrice;
    const breakoutPercentage = breakoutDistance / resistancePrice;

    if (breakoutPercentage >= breakoutMinDistance) {
        // Potential breakout - check for confirmation
        const mostCandlesAbove = confirmationData.candles.filter(c => c.candle.close > resistancePrice).length;
        const confirmationRatio = mostCandlesAbove / confirmationData.candles.length;

        if (confirmationRatio >= 0.6 && strongVolumeRatio >= 0.3) {
            return {
                type: 'confirmed_breakout',
                confirmed: true,
                strength: confirmedBreakoutBonus,
                description: `Confirmed Resistance Breakout (${(breakoutPercentage * 100).toFixed(2)}% break with ${(strongVolumeRatio * 100).toFixed(0)}% high volume candles)`,
                breakoutDistance: breakoutDistance,
                volumeConfirmation: true
            };
        } else if (confirmationRatio >= 0.4) {
            return {
                type: 'partial_breakout',
                confirmed: false,
                strength: Math.floor(confirmedBreakoutBonus * 0.6),
                description: `Partial Resistance Breakout (${(breakoutPercentage * 100).toFixed(2)}% break, weak confirmation)`,
                breakoutDistance: breakoutDistance,
                volumeConfirmation: false
            };
        } else {
            // False breakout - price came back below resistance
            return {
                type: 'false_breakout',
                confirmed: false,
                strength: falseBreakoutPenalty,
                description: `False Resistance Breakout (${(breakoutPercentage * 100).toFixed(2)}% break failed, price pulled back)`,
                breakoutDistance: breakoutDistance,
                volumeConfirmation: false
            };
        }
    }

    // Check for resistance rejection (bearish)
    const rejectionDistance = Math.abs(resistancePrice - highestHigh);
    const rejectionPercentage = rejectionDistance / resistancePrice;

    if (rejectionPercentage <= rejectionMaxDistance) {
        // Price was rejected at resistance - check for bearish confirmation
        const selloffStrength = highestHigh - lowestLow;
        const selloffPercentage = selloffStrength / resistancePrice;
        
        const mostCandlesBelow = confirmationData.candles.filter(c => c.candle.close <= resistancePrice).length;
        const rejectionRatio = mostCandlesBelow / confirmationData.candles.length;

        if (rejectionRatio >= 0.6 && selloffPercentage >= 0.005) {
            let strength = confirmedRejectionBonus;
            let description = `Confirmed Resistance Rejection`;

            // Bonus for strong selloff
            if (selloffPercentage >= 0.02) {
                strength += 8;
                description += ` with Strong Selloff (${(selloffPercentage * 100).toFixed(2)}%)`;
            } else if (selloffPercentage >= 0.01) {
                strength += 4;
                description += ` with Moderate Selloff (${(selloffPercentage * 100).toFixed(2)}%)`;
            }

            // Volume confirmation bonus
            if (strongVolumeRatio >= 0.3) {
                strength += 5;
                description += ` (Volume Confirmed)`;
            }

            return {
                type: 'confirmed_resistance_rejection',
                confirmed: true,
                strength: strength,
                description: description,
                selloffStrength: selloffStrength,
                volumeConfirmation: strongVolumeRatio >= 0.3
            };
        } else {
            return {
                type: 'weak_resistance_test',
                confirmed: false,
                strength: Math.floor(confirmedRejectionBonus * 0.4),
                description: `Weak Resistance Test (${(rejectionPercentage * 100).toFixed(2)}% from level, minimal selloff)`,
                selloffStrength: selloffStrength,
                volumeConfirmation: false
            };
        }
    }

    // No clear breakout or rejection
    return {
        type: 'inconclusive',
        confirmed: false,
        strength: 0,
        description: 'Inconclusive resistance interaction',
        selloffStrength: 0,
        volumeConfirmation: false
    };
}

/**
 * Checks if we have enough future data to perform confirmation analysis
 * @param {object} indicators - All technical indicators
 * @param {number} currentIndex - Current candle index
 * @param {number} requiredCandles - Number of future candles needed
 * @returns {boolean} Whether we have sufficient data
 */
export function hasSufficientConfirmationData(indicators, currentIndex, requiredCandles = 3) {
    const data = get(indicators, 'data', []);
    return data.length > currentIndex + requiredCandles;
}

/**
 * Applies confirmation analysis results to enhance signal strength
 * @param {number} baseStrength - Original signal strength
 * @param {object} confirmationResult - Result from analyzeBreakoutConfirmation
 * @returns {object} Enhanced signal with confirmation information
 */
export function applyConfirmationBonus(baseStrength, confirmationResult) {
    if (!confirmationResult || confirmationResult.type === 'insufficient_data') {
        return {
            strength: baseStrength,
            confirmationType: 'pending',
            confirmationBonus: 0,
            confirmed: false,
            finalStrength: baseStrength,
            description: ''
        };
    }

    const confirmationBonus = confirmationResult.strength || 0;
    const finalStrength = Math.max(0, Math.min(baseStrength + confirmationBonus, 100));

    return {
        strength: baseStrength,
        confirmationType: confirmationResult.type,
        confirmationBonus: confirmationBonus,
        confirmed: confirmationResult.confirmed,
        finalStrength: finalStrength,
        description: confirmationResult.description || '',
        volumeConfirmation: confirmationResult.volumeConfirmation || false
    };
}