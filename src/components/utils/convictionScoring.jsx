import { get } from 'lodash';

export const getRegimeMultiplier = (marketRegime, strategyRegime) => {
    if (!marketRegime?.regime || !strategyRegime) {
        return 1.0;
    }

    const currentRegime = marketRegime.regime.toLowerCase();
    const expectedRegime = strategyRegime.toLowerCase();
    const regimeConfidence = marketRegime.confidence || 0.5; // Default to 50% confidence if not provided
    
    let baseMultiplier = 1.0;
    
    if (currentRegime === expectedRegime) {
        // Perfect match - boost conviction
        baseMultiplier = 1.25; // +25% conviction boost
    } else if (
        (currentRegime === 'ranging' && (expectedRegime === 'uptrend' || expectedRegime === 'downtrend')) ||
        (expectedRegime === 'ranging' && (currentRegime === 'uptrend' || currentRegime === 'downtrend'))
    ) {
        // Partial compatibility - slight boost
        baseMultiplier = 1.1; // +10% conviction boost
    } else {
        // Regime mismatch - reduce conviction
        baseMultiplier = 0.8; // -20% conviction penalty
    }
    
    // NEW: Scale the multiplier effect by regime confidence
    // The idea: if confidence is low, reduce the impact of the regime multiplier
    // Formula: 1.0 + (baseMultiplier - 1.0) * regimeConfidence
    // This ensures:
    // - At 100% confidence: full multiplier effect
    // - At 0% confidence: no multiplier effect (returns to 1.0)
    // - At 50% confidence: half multiplier effect
    
    const confidenceScaledMultiplier = 1.0 + (baseMultiplier - 1.0) * regimeConfidence;
    
    return confidenceScaledMultiplier;
};

export const calculateConvictionScore = (strategy, matchedSignals, indicators, klines, marketRegime, priceAtMatch) => {
    try {
        // DETAILED INPUT VALIDATION
        if (!strategy) {
            console.error('[CONVICTION_FAIL] FATAL: Missing strategy object.');
            return { score: 0, multiplier: 1, breakdown: { error: 'Missing strategy' } };
        }
        if (!matchedSignals || matchedSignals.length === 0) {
            // This case should not happen if called after a match, but as a safeguard:
            console.warn(`[CONVICTION_FAIL] For strategy ${strategy.combinationName}: matchedSignals array is null or empty.`);
            return { score: 0, multiplier: 1, breakdown: { error: 'No matched signals' } };
        }
        if (!indicators) {
            console.error(`[CONVICTION_FAIL] For strategy ${strategy.combinationName}: Missing indicators object.`);
            return { score: 0, multiplier: 1, breakdown: { error: 'Missing indicators' } };
        }
        if (!klines || klines.length === 0) {
            console.error(`[CONVICTION_FAIL] For strategy ${strategy.combinationName}: klines array is null or empty.`);
            return { score: 0, multiplier: 1, breakdown: { error: 'No kline data' } };
        }
        if (!marketRegime) {
             console.warn(`[CONVICTION_WARN] For strategy ${strategy.combinationName}: Missing marketRegime object. Proceeding with neutral assumption.`);
        }

        const latestIndex = klines.length - 2;
        if (latestIndex < 0) {
            console.warn(`[CONVICTION_FAIL] For strategy ${strategy.combinationName}: Not enough kline data for analysis (length: ${klines.length}).`);
            return { score: 0, multiplier: 1, breakdown: { error: 'Not enough kline data' } };
        }

        let totalScore = 0;
        const breakdown = {};
        let finalMultiplier = 1;

        // --- 1. Market Regime Factor (0-20 points, capped) ---
        let regimeFactor = 0;
        try {
            // Use the new getRegimeMultiplier function
            const regimeMultiplier = getRegimeMultiplier(marketRegime, strategy.dominantMarketRegime);
            
            // CRITICAL FIX: Cap at 20 points to prevent exceeding intended maximum
            regimeFactor = Math.min(20, 20 * regimeMultiplier);
            breakdown.marketRegime = { score: regimeFactor, details: `Regime: ${marketRegime?.regime}, Strategy Dominant: ${strategy.dominantMarketRegime}, Multiplier: ${regimeMultiplier.toFixed(2)}` };
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Market Regime Factor:', e.message);
            breakdown.marketRegime = { score: 0, error: e.message };
        }
        totalScore += regimeFactor;

        // --- 2. Signal Strength & Confluence Factor (0-60 points) ---
        // CRITICAL FIX: Increased from 40 to 50 base points, making signal strength the dominant factor (60% of total)
        let signalFactor = 0;
        try {
            const totalSignalStrength = matchedSignals.reduce((sum, s) => sum + (s.strength || 0), 0);
            const averageSignalStrength = matchedSignals.length > 0 ? totalSignalStrength / matchedSignals.length : 0;
            
            // Increased base from 40 to 50 points (60% of total possible score)
            signalFactor = (averageSignalStrength / 100) * 50;
            
            const confluenceBonus = Math.min(10, (matchedSignals.length - 1) * 5);
            signalFactor += confluenceBonus;
            
            breakdown.signalStrength = { score: signalFactor, details: `Avg Strength: ${averageSignalStrength.toFixed(2)}, Confluence Bonus: ${confluenceBonus}` };
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Signal Strength Factor:', e.message);
            breakdown.signalStrength = { score: 0, error: e.message };
        }
        totalScore += signalFactor;

        // --- 3. Volatility Factor (TTM Squeeze + ADX) (0-20 points) ---
        // CRITICAL FIX: Added squeeze duration and ADX consideration
        let volatilityFactor = 0;
        try {
            // Check both possible indicator names: squeeze and ttm_squeeze
            const squeezeData = indicators.squeeze || indicators.ttm_squeeze;
            
            if (squeezeData && squeezeData[latestIndex]) {
                const squeezeState = squeezeData[latestIndex];
                
                // Check for squeeze state (handle both field names)
                const isSqueezeActive = squeezeState.squeeze_on || squeezeState.isSqueeze;
                
                if (isSqueezeActive) {
                    // Base squeeze score: 10 points
                    let baseSqueezeScore = 10;
                    
                    // Squeeze duration bonus: +0 to +5 points
                    // Calculate duration by counting consecutive squeeze candles
                    let squeezeDuration = 0;
                    if (squeezeData && latestIndex > 0) {
                        for (let i = latestIndex; i >= 0; i--) {
                            const state = squeezeData[i];
                            if (state && (state.squeeze_on || state.isSqueeze)) {
                                squeezeDuration++;
                            } else {
                                break;
                            }
                        }
                    }
                    // Duration bonus: +1 point per 2 candles, max +5 points (10 candles)
                    const durationBonus = Math.min(5, Math.floor(squeezeDuration / 2));
                    baseSqueezeScore += durationBonus;
                    
                    // ADX bonus: +0 to +5 points (stronger trend = better for squeeze)
                    let adxBonus = 0;
                    let adxValue = null;
                    if (indicators.adx && indicators.adx[latestIndex] !== undefined) {
                        const adxData = indicators.adx[latestIndex];
                        // ADX is an object with { ADX, PDI, MDI } structure
                        adxValue = (typeof adxData === 'object' && adxData !== null) ? adxData.ADX : adxData;
                        // ADX > 25 indicates strong trend, reward with bonus
                        if (typeof adxValue === 'number' && adxValue > 25) {
                            adxBonus = Math.min(5, (adxValue - 25) / 5); // +1 point per 5 ADX above 25, max +5
                        }
                    }
                    
                    volatilityFactor = baseSqueezeScore + adxBonus;
                    breakdown.volatility = { 
                        score: volatilityFactor, 
                        details: `Squeeze active (${squeezeDuration} candles), ADX: ${(typeof adxValue === 'number' ? adxValue.toFixed(1) : 'N/A')}` 
                    };
                } else if (squeezeState.squeeze_off) {
                    volatilityFactor = 5;
                    breakdown.volatility = { score: 5, details: 'Squeeze just fired' };
                } else {
                    // No squeeze, but check ADX for trend strength
                    let adxScore = 0;
                    let adxValue = null;
                    if (indicators.adx && indicators.adx[latestIndex] !== undefined) {
                        const adxData = indicators.adx[latestIndex];
                        // ADX is an object with { ADX, PDI, MDI } structure
                        adxValue = (typeof adxData === 'object' && adxData !== null) ? adxData.ADX : adxData;
                        // ADX 20-25 = neutral (0 points), ADX > 25 = positive trend (+2 to +5 points)
                        if (typeof adxValue === 'number' && adxValue > 25) {
                            adxScore = Math.min(5, (adxValue - 25) / 5);
                        }
                    }
                    volatilityFactor = adxScore;
                    breakdown.volatility = { 
                        score: volatilityFactor, 
                        details: `No squeeze, ADX: ${(typeof adxValue === 'number' ? adxValue.toFixed(1) : 'N/A')}` 
                    };
                }
            } else {
                // Fallback: Use ADX if available
                let adxScore = 0;
                let adxValue = null;
                if (indicators.adx && indicators.adx[latestIndex] !== undefined) {
                    const adxData = indicators.adx[latestIndex];
                    // ADX is an object with { ADX, PDI, MDI } structure
                    adxValue = (typeof adxData === 'object' && adxData !== null) ? adxData.ADX : adxData;
                    if (typeof adxValue === 'number' && adxValue > 25) {
                        adxScore = Math.min(5, (adxValue - 25) / 5);
                    }
                }
                volatilityFactor = adxScore;
                breakdown.volatility = { 
                    score: volatilityFactor, 
                    details: `Squeeze indicator not available, ADX: ${(typeof adxValue === 'number' ? adxValue.toFixed(1) : 'N/A')}` 
                };
            }
        } catch (e) {
             console.error('[CONVICTION_ERROR] Failed to calculate Volatility Factor:', e.message);
             breakdown.volatility = { score: 0, error: e.message };
        }
        totalScore += volatilityFactor;

        // --- 4. Demo Performance Factor (-20 to +25 points) ---
        // CRITICAL FIX: Gradient scaling + recency weighting + win rate bonus
        let demoPerformanceFactor = 0;
        try {
            if (strategy.realTradeCount && strategy.realTradeCount >= 10) {
                const profitFactor = strategy.realProfitFactor || 0;
                
                // NEW: Gradient scaling instead of tiers
                // Linear scaling: PF 0.5 = -20, PF 1.0 = 0, PF 1.5 = +20
                // Formula: (PF - 1.0) * 40
                let basePFScore = (profitFactor - 1.0) * 40;
                basePFScore = Math.max(-20, Math.min(20, basePFScore)); // Clamp to -20 to +20
                
                // NEW: Recency weighting - prefer recent performance
                // If we have recent trade data, weight it more heavily
                // For now, use overall PF but apply recency bonus if trade count is high (more recent data)
                const tradeCount = strategy.realTradeCount || 0;
                const recencyWeight = Math.min(1.2, 1.0 + (Math.min(tradeCount, 50) / 250)); // +0 to +20% bonus for more trades
                basePFScore = basePFScore * recencyWeight;
                
                // NEW: Win rate bonus (+0 to +5 points)
                // Higher win rate = more consistent = better
                const winRate = strategy.success_rate || strategy.winRate || 50; // Default to 50% if not available
                const winRateBonus = (winRate - 50) * 0.1; // +0 to +5 points for 50-100% win rate
                const cappedWinRateBonus = Math.max(0, Math.min(5, winRateBonus));
                
                demoPerformanceFactor = basePFScore + cappedWinRateBonus;
                demoPerformanceFactor = Math.max(-20, Math.min(25, demoPerformanceFactor)); // Final clamp
                
                breakdown.demoPerformance = { 
                    score: demoPerformanceFactor, 
                    details: `Demo P/F: ${profitFactor.toFixed(2)}, Win Rate: ${winRate.toFixed(1)}%, Trades: ${tradeCount} (${(recencyWeight * 100).toFixed(0)}% recency weight)` 
                };
            } else {
                breakdown.demoPerformance = { score: 0, details: `Not enough demo trades (${strategy.realTradeCount || 0})` };
            }
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Demo Performance Factor:', e.message);
            breakdown.demoPerformance = { score: 0, error: e.message };
        }
        totalScore += demoPerformanceFactor;

        // Clamp total score to 0-100
        totalScore = Math.max(0, Math.min(100, totalScore));

        // CRITICAL FIX: Apply multiplier to the score itself, not just store it
        // The multiplier represents confidence boost for high-conviction trades
        // This allows scores above 100 to be meaningful (e.g., 90 * 1.5 = 135, clamped to 100)
        // But we'll apply it BEFORE clamping to preserve the boost effect
        let adjustedScore = totalScore;
        if (totalScore >= 80) {
            finalMultiplier = 1.5;
            adjustedScore = totalScore * 1.5; // Boost high-conviction trades
        } else if (totalScore >= 65) {
            finalMultiplier = 1.25;
            adjustedScore = totalScore * 1.25; // Small boost for medium-high conviction
        } else {
            finalMultiplier = 1.0;
            adjustedScore = totalScore; // No boost
        }
        
        // Clamp the adjusted score to 0-100
        adjustedScore = Math.max(0, Math.min(100, adjustedScore));
        
        return {
            score: Math.round(adjustedScore * 10) / 10, // Round to 1 decimal
            multiplier: finalMultiplier,
            breakdown,
            rawScore: totalScore, // Include raw score for debugging
        };

    } catch (error) {
        console.error(`[CONVICTION_FATAL] A critical error occurred in calculateConvictionScore for ${strategy?.combinationName}: ${error.message}`, error);
        return { score: 0, multiplier: 1, breakdown: { error: `Fatal: ${error.message}` } };
    }
};