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

        // --- 1. Market Regime Factor ---
        let regimeFactor = 0;
        try {
            // Use the new getRegimeMultiplier function
            const regimeMultiplier = getRegimeMultiplier(marketRegime, strategy.dominantMarketRegime);
            
            regimeFactor = 25 * regimeMultiplier; // Max 25 points, scaled by multiplier
            breakdown.marketRegime = { score: regimeFactor, details: `Regime: ${marketRegime?.regime}, Strategy Dominant: ${strategy.dominantMarketRegime}, Multiplier: ${regimeMultiplier.toFixed(2)}` };
            //console.log(`[CONVICTION_INTERNAL] Market Regime Factor calculated: ${regimeFactor.toFixed(2)}`);
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Market Regime Factor:', e.message);
            breakdown.marketRegime = { score: 0, error: e.message };
        }
        totalScore += regimeFactor;

        // --- 2. Signal Strength & Confluence Factor ---
        let signalFactor = 0;
        try {
            const totalSignalStrength = matchedSignals.reduce((sum, s) => sum + (s.strength || 0), 0);
            const averageSignalStrength = matchedSignals.length > 0 ? totalSignalStrength / matchedSignals.length : 0;
            signalFactor = (averageSignalStrength / 100) * 40;
            
            const confluenceBonus = Math.min(10, (matchedSignals.length - 1) * 5);
            signalFactor += confluenceBonus;
            
            breakdown.signalStrength = { score: signalFactor, details: `Avg Strength: ${averageSignalStrength.toFixed(2)}, Confluence Bonus: ${confluenceBonus}` };
            //console.log(`[CONVICTION_INTERNAL] Signal Strength Factor calculated: ${signalFactor.toFixed(2)}`);
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Signal Strength Factor:', e.message);
            breakdown.signalStrength = { score: 0, error: e.message };
        }
        totalScore += signalFactor;

        // --- 3. Volatility Factor (TTM Squeeze) ---
        let volatilityFactor = 0;
        try {
            if (indicators.squeeze && indicators.squeeze[latestIndex]) {
                const squeezeState = indicators.squeeze[latestIndex];
                if (squeezeState.squeeze_on) {
                    volatilityFactor = 15;
                    breakdown.volatility = { score: 15, details: 'In a squeeze (High potential energy)' };
                } else if (squeezeState.squeeze_off) {
                    volatilityFactor = 5;
                    breakdown.volatility = { score: 5, details: 'Squeeze just fired' };
                }
            } else {
                 breakdown.volatility = { score: 0, details: 'Squeeze indicator not available' };
            }
            //console.log(`[CONVICTION_INTERNAL] Volatility Factor calculated: ${volatilityFactor.toFixed(2)}`);
        } catch (e) {
             console.error('[CONVICTION_ERROR] Failed to calculate Volatility Factor:', e.message);
             breakdown.volatility = { score: 0, error: e.message };
        }
        totalScore += volatilityFactor;

        // --- 4. Demo Performance Factor ---
        let demoPerformanceFactor = 0;
        try {
            if (strategy.realTradeCount && strategy.realTradeCount >= 10) {
                const profitFactor = strategy.realProfitFactor || 0;
                if (profitFactor > 1.2) {
                    demoPerformanceFactor = 20;
                } else if (profitFactor > 1.0) {
                    demoPerformanceFactor = 10;
                } else {
                    demoPerformanceFactor = -10;
                }
                breakdown.demoPerformance = { score: demoPerformanceFactor, details: `Demo P/F: ${profitFactor.toFixed(2)} with ${strategy.realTradeCount} trades` };
            } else {
                breakdown.demoPerformance = { score: 0, details: `Not enough demo trades (${strategy.realTradeCount || 0})` };
            }
            //console.log(`[CONVICTION_INTERNAL] Demo Performance Factor calculated: ${demoPerformanceFactor.toFixed(2)}`);
        } catch (e) {
            console.error('[CONVICTION_ERROR] Failed to calculate Demo Performance Factor:', e.message);
            breakdown.demoPerformance = { score: 0, error: e.message };
        }
        totalScore += demoPerformanceFactor;

        totalScore = Math.max(0, Math.min(100, totalScore));

        if (totalScore >= 80) {
            finalMultiplier = 1.5;
        } else if (totalScore >= 65) {
            finalMultiplier = 1.25;
        } else {
            finalMultiplier = 1.0;
        }
        
        //console.log(`[CONVICTION_INTERNAL] Final score: ${totalScore.toFixed(2)}, Multiplier: ${finalMultiplier}`);
        
        return {
            score: totalScore,
            multiplier: finalMultiplier,
            breakdown,
        };

    } catch (error) {
        console.error(`[CONVICTION_FATAL] A critical error occurred in calculateConvictionScore for ${strategy?.combinationName}: ${error.message}`, error);
        return { score: 0, multiplier: 1, breakdown: { error: `Fatal: ${error.message}` } };
    }
};