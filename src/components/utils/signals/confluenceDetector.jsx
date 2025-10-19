import { get } from 'lodash';

/**
 * Confluence Detection Utility
 * 
 * This module provides sophisticated confluence detection between different
 * support/resistance levels and technical indicators to enhance signal reliability.
 */

/**
 * Detects confluence between a price level and various technical indicators
 * @param {number} targetPrice - The price level to check for confluence
 * @param {object} candle - Current candle data
 * @param {object} indicators - All technical indicators
 * @param {number} index - Current candle index
 * @param {object} settings - Signal settings
 * @param {number} confluenceRadius - Price radius to search for confluence (as decimal, e.g., 0.01 = 1%)
 * @returns {object} Confluence detection results
 */
export function detectConfluence(targetPrice, candle, indicators, index, settings, confluenceRadius = 0.01) {
    const confluences = [];
    const tolerance = targetPrice * confluenceRadius;
    
    // 1. Check Moving Average Confluence
    const movingAverageConfluence = checkMovingAverageConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...movingAverageConfluence);

    // 2. Check Bollinger Bands Confluence
    const bollingerConfluence = checkBollingerBandsConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...bollingerConfluence);

    // 3. Check Keltner Channel Confluence
    const keltnerConfluence = checkKeltnerChannelConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...keltnerConfluence);

    // 4. Check PSAR Confluence
    const psarConfluence = checkPSARConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...psarConfluence);

    // 5. Check Ichimoku Cloud Confluence
    const ichimokuConfluence = checkIchimokuConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...ichimokuConfluence);

    // 6. Check Previous High/Low Confluence
    const swingConfluence = checkSwingHighLowConfluence(
        targetPrice, indicators, index, tolerance
    );
    confluences.push(...swingConfluence);

    // 7. Check Round Number Confluence
    const roundNumberConfluence = checkRoundNumberConfluence(
        targetPrice, tolerance
    );
    confluences.push(...roundNumberConfluence);

    return {
        confluences,
        count: confluences.length,
        totalStrengthBonus: confluences.reduce((sum, conf) => sum + conf.strengthBonus, 0),
        description: confluences.map(conf => conf.description).join(', ')
    };
}

/**
 * Checks for confluence with moving averages
 */
function checkMovingAverageConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    
    // Check MA200
    const ma200 = get(indicators, ['ma200', index]);
    if (ma200 && Math.abs(targetPrice - ma200) <= tolerance) {
        confluences.push({
            type: 'MA200',
            price: ma200,
            strengthBonus: 15,
            description: 'MA200 Confluence'
        });
    }

    // Check EMA
    const ema = get(indicators, ['ema', index]);
    if (ema && Math.abs(targetPrice - ema) <= tolerance) {
        confluences.push({
            type: 'EMA',
            price: ema,
            strengthBonus: 10,
            description: 'EMA Confluence'
        });
    }

    // Check TEMA
    const tema = get(indicators, ['tema', index]);
    if (tema && Math.abs(targetPrice - tema) <= tolerance) {
        confluences.push({
            type: 'TEMA',
            price: tema,
            strengthBonus: 8,
            description: 'TEMA Confluence'
        });
    }

    // Check HMA
    const hma = get(indicators, ['hma', index]);
    if (hma && Math.abs(targetPrice - hma) <= tolerance) {
        confluences.push({
            type: 'HMA',
            price: hma,
            strengthBonus: 8,
            description: 'HMA Confluence'
        });
    }

    return confluences;
}

/**
 * Checks for confluence with Bollinger Bands
 */
function checkBollingerBandsConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    const bollinger = get(indicators, ['bollinger', index]);
    
    if (bollinger) {
        // Upper Band
        if (Math.abs(targetPrice - bollinger.upper) <= tolerance) {
            confluences.push({
                type: 'Bollinger_Upper',
                price: bollinger.upper,
                strengthBonus: 12,
                description: 'Bollinger Upper Band'
            });
        }
        
        // Lower Band
        if (Math.abs(targetPrice - bollinger.lower) <= tolerance) {
            confluences.push({
                type: 'Bollinger_Lower',
                price: bollinger.lower,
                strengthBonus: 12,
                description: 'Bollinger Lower Band'
            });
        }
        
        // Middle Band
        if (Math.abs(targetPrice - bollinger.middle) <= tolerance) {
            confluences.push({
                type: 'Bollinger_Middle',
                price: bollinger.middle,
                strengthBonus: 8,
                description: 'Bollinger Middle Band'
            });
        }
    }
    
    return confluences;
}

/**
 * Checks for confluence with Keltner Channels
 */
function checkKeltnerChannelConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    const keltner = get(indicators, ['keltner', index]);
    
    if (keltner) {
        // Upper Channel
        if (Math.abs(targetPrice - keltner.upper) <= tolerance) {
            confluences.push({
                type: 'Keltner_Upper',
                price: keltner.upper,
                strengthBonus: 10,
                description: 'Keltner Upper Channel'
            });
        }
        
        // Lower Channel
        if (Math.abs(targetPrice - keltner.lower) <= tolerance) {
            confluences.push({
                type: 'Keltner_Lower',
                price: keltner.lower,
                strengthBonus: 10,
                description: 'Keltner Lower Channel'
            });
        }
        
        // Middle Line
        if (Math.abs(targetPrice - keltner.middle) <= tolerance) {
            confluences.push({
                type: 'Keltner_Middle',
                price: keltner.middle,
                strengthBonus: 6,
                description: 'Keltner Middle Line'
            });
        }
    }
    
    return confluences;
}

/**
 * Checks for confluence with PSAR
 */
function checkPSARConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    const psar = get(indicators, ['psar', index]);
    
    if (psar && Math.abs(targetPrice - psar) <= tolerance) {
        confluences.push({
            type: 'PSAR',
            price: psar,
            strengthBonus: 10,
            description: 'PSAR Level'
        });
    }
    
    return confluences;
}

/**
 * Checks for confluence with Ichimoku Cloud
 */
function checkIchimokuConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    const ichimoku = get(indicators, ['ichimoku', index]);
    
    if (ichimoku) {
        // Tenkan-sen
        if (ichimoku.tenkanSen && Math.abs(targetPrice - ichimoku.tenkanSen) <= tolerance) {
            confluences.push({
                type: 'Ichimoku_Tenkan',
                price: ichimoku.tenkanSen,
                strengthBonus: 8,
                description: 'Ichimoku Tenkan-sen'
            });
        }
        
        // Kijun-sen
        if (ichimoku.kijunSen && Math.abs(targetPrice - ichimoku.kijunSen) <= tolerance) {
            confluences.push({
                type: 'Ichimoku_Kijun',
                price: ichimoku.kijunSen,
                strengthBonus: 10,
                description: 'Ichimoku Kijun-sen'
            });
        }
        
        // Senkou Span A
        if (ichimoku.senkouSpanA && Math.abs(targetPrice - ichimoku.senkouSpanA) <= tolerance) {
            confluences.push({
                type: 'Ichimoku_SpanA',
                price: ichimoku.senkouSpanA,
                strengthBonus: 12,
                description: 'Ichimoku Senkou Span A'
            });
        }
        
        // Senkou Span B
        if (ichimoku.senkouSpanB && Math.abs(targetPrice - ichimoku.senkouSpanB) <= tolerance) {
            confluences.push({
                type: 'Ichimoku_SpanB',
                price: ichimoku.senkouSpanB,
                strengthBonus: 12,
                description: 'Ichimoku Senkou Span B'
            });
        }
    }
    
    return confluences;
}

/**
 * Checks for confluence with recent swing highs/lows
 */
function checkSwingHighLowConfluence(targetPrice, indicators, index, tolerance) {
    const confluences = [];
    const data = get(indicators, 'data', []);
    
    if (data.length === 0) return confluences;
    
    // Look back for swing highs/lows in the last 50 candles
    const lookbackPeriod = Math.min(50, index);
    const startIndex = Math.max(0, index - lookbackPeriod);
    
    for (let i = startIndex + 1; i < index - 1; i++) {
        const current = data[i];
        const prev = data[i - 1];
        const next = data[i + 1];
        
        if (!current || !prev || !next) continue;
        
        // Check for swing high
        if (current.high > prev.high && current.high > next.high) {
            if (Math.abs(targetPrice - current.high) <= tolerance) {
                confluences.push({
                    type: 'Swing_High',
                    price: current.high,
                    strengthBonus: 12,
                    description: 'Recent Swing High'
                });
                break; // Only add one swing high confluence
            }
        }
        
        // Check for swing low
        if (current.low < prev.low && current.low < next.low) {
            if (Math.abs(targetPrice - current.low) <= tolerance) {
                confluences.push({
                    type: 'Swing_Low',
                    price: current.low,
                    strengthBonus: 12,
                    description: 'Recent Swing Low'
                });
                break; // Only add one swing low confluence
            }
        }
    }
    
    return confluences;
}

/**
 * Checks for confluence with round numbers
 */
function checkRoundNumberConfluence(targetPrice, tolerance) {
    const confluences = [];
    
    // Define round number levels based on price magnitude
    let roundLevels = [];
    
    if (targetPrice >= 100000) {
        // For very high prices (like BTC), check 10,000 intervals
        roundLevels = [
            Math.floor(targetPrice / 10000) * 10000,
            Math.ceil(targetPrice / 10000) * 10000
        ];
    } else if (targetPrice >= 10000) {
        // For high prices, check 1,000 intervals
        roundLevels = [
            Math.floor(targetPrice / 1000) * 1000,
            Math.ceil(targetPrice / 1000) * 1000
        ];
    } else if (targetPrice >= 1000) {
        // For medium prices, check 100 intervals
        roundLevels = [
            Math.floor(targetPrice / 100) * 100,
            Math.ceil(targetPrice / 100) * 100
        ];
    } else if (targetPrice >= 100) {
        // For lower prices, check 10 intervals
        roundLevels = [
            Math.floor(targetPrice / 10) * 10,
            Math.ceil(targetPrice / 10) * 10
        ];
    } else {
        // For very low prices, check 1 intervals
        roundLevels = [
            Math.floor(targetPrice),
            Math.ceil(targetPrice)
        ];
    }
    
    // Check each round level
    for (const level of roundLevels) {
        if (level !== targetPrice && Math.abs(targetPrice - level) <= tolerance) {
            confluences.push({
                type: 'Round_Number',
                price: level,
                strengthBonus: 8,
                description: `Round Number (${level})`
            });
            break; // Only add one round number confluence
        }
    }
    
    return confluences;
}

/**
 * Applies confluence bonus to a base signal strength
 * @param {number} baseStrength - Original signal strength
 * @param {object} confluenceResult - Result from detectConfluence
 * @param {object} settings - Signal settings with confluence parameters
 * @returns {object} Enhanced signal with confluence information
 */
export function applyConfluenceBonus(baseStrength, confluenceResult, settings) {
    const minStrength = settings.minConfluenceStrength || 70;
    const maxBonus = settings.maxConfluenceBonus || 30;
    const bonusPerConfluence = settings.confluenceBonus || 10;
    
    // Only apply confluence bonus if base strength meets minimum threshold
    if (baseStrength < minStrength) {
        return {
            strength: baseStrength,
            confluenceCount: 0,
            confluenceBonus: 0,
            confluenceDescription: '',
            finalStrength: baseStrength
        };
    }
    
    // Calculate total bonus (capped at maximum)
    const totalBonus = Math.min(
        confluenceResult.count * bonusPerConfluence,
        maxBonus
    );
    
    const finalStrength = Math.min(baseStrength + totalBonus, 100);
    
    return {
        strength: baseStrength,
        confluenceCount: confluenceResult.count,
        confluenceBonus: totalBonus,
        confluenceDescription: confluenceResult.description,
        finalStrength: finalStrength
    };
}