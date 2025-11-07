/**
 * RegimeContextWeighting.jsx
 * 
 * Step 3: Market Regime Context Weighting
 * Adjusts signal strength based on current market regime (uptrend, downtrend, ranging)
 * 
 * Features:
 * - Regime-specific signal effectiveness weights
 * - Dynamic regime context adjustment
 * - Regime confidence weighting
 * - Historical regime performance tracking
 */

class RegimeContextWeighting {
    constructor() {
        this.regimeWeights = this.initializeRegimeWeights();
        this.regimeConfidenceThresholds = this.initializeConfidenceThresholds();
        this.historicalPerformance = this.initializeHistoricalPerformance();
        this.signalTypeMapping = this.initializeSignalTypeMapping();
    }

    /**
     * Initialize signal type mapping from simple names to descriptive names
     */
    initializeSignalTypeMapping() {
        return {
            'macd': 'MACD Cross',
            'rsi': 'RSI Oversold',
            'volume': 'Volume Breakout',
            'bollinger': 'Bollinger Bounce',
            'stochastic': 'Stochastic Oversold',
            'atr': 'ATR Breakout',
            'ema': 'EMA Cross',
            'sma': 'EMA Cross',
            'ma200': 'EMA Cross',
            'supportresistance': 'Support Bounce',
            'chartpattern': 'Resistance Break',
            'fibonacci': 'Support Bounce',
            'pivot': 'Support Bounce',
            'candlestick': 'Momentum Divergence',
            'ichimoku': 'EMA Cross',
            'williamsr': 'RSI Oversold',
            'mfi': 'Volume Breakout',
            'adx': 'ATR Breakout',
            'tema': 'EMA Cross',
            'dema': 'EMA Cross',
            'hma': 'EMA Cross',
            'wma': 'EMA Cross',
            'cci': 'RSI Oversold',
            'roc': 'Momentum Divergence',
            'awesomeoscillator': 'MACD Cross',
            'cmo': 'RSI Oversold',
            'obv': 'Volume Breakout',
            'cmf': 'Volume Breakout',
            'adline': 'Volume Breakout',
            'bbw': 'Bollinger Bounce',
            'ttm_squeeze': 'ATR Breakout',
            'keltner': 'Bollinger Bounce',
            'donchian': 'ATR Breakout',
            'maribbon': 'EMA Cross'
        };
    }

    /**
     * Initialize regime-specific signal effectiveness weights
     * Different signals perform better in different market conditions
     */
    initializeRegimeWeights() {
        return {
            // Uptrend regime weights
            uptrend: {
                'MACD Cross': 1.4,           // MACD works well in trending markets
                'RSI Oversold': 1.2,         // RSI bounces work in uptrends
                'Volume Breakout': 1.6,      // Volume confirms uptrends
                'Bollinger Bounce': 1.1,     // Mean reversion less effective in trends
                'Stochastic Oversold': 1.3,  // Momentum indicators work in trends
                'ATR Breakout': 1.5,         // Volatility breakouts confirm trends
                'EMA Cross': 1.4,            // Moving averages work in trends
                'Support Bounce': 1.2,        // Support holds better in uptrends
                'Resistance Break': 1.7,     // Breakouts are key in uptrends
                'Momentum Divergence': 1.1   // Divergence less reliable in strong trends
            },
            
            // Downtrend regime weights
            downtrend: {
                'MACD Cross': 1.3,           // MACD can catch trend reversals
                'RSI Oversold': 1.5,         // RSI oversold more reliable in downtrends
                'Volume Breakout': 1.4,      // Volume confirms downtrends
                'Bollinger Bounce': 1.2,     // Mean reversion more effective
                'Stochastic Oversold': 1.4,  // Momentum indicators work
                'ATR Breakout': 1.3,         // Volatility breakouts
                'EMA Cross': 1.2,            // Moving averages less reliable
                'Support Bounce': 0.8,        // Support often fails in downtrends
                'Resistance Break': 1.1,     // Breakouts less common
                'Momentum Divergence': 1.6   // Divergence very important in downtrends
            },
            
            // Ranging/sideways regime weights
            ranging: {
                'MACD Cross': 0.9,           // MACD gives false signals in ranges
                'RSI Oversold': 1.4,         // RSI works well in ranges
                'Volume Breakout': 1.2,      // Volume breakouts less reliable
                'Bollinger Bounce': 1.6,     // Mean reversion strategies excel
                'Stochastic Oversold': 1.5,  // Oscillators work well in ranges
                'ATR Breakout': 1.1,         // Volatility breakouts less common
                'EMA Cross': 0.8,            // Moving averages give false signals
                'Support Bounce': 1.7,        // Support/resistance key in ranges
                'Resistance Break': 1.3,     // Breakouts can be false
                'Momentum Divergence': 1.2   // Divergence less reliable in ranges
            },
            
            // Unknown/uncertain regime weights (conservative)
            unknown: {
                'MACD Cross': 1.0,           // Neutral weights
                'RSI Oversold': 1.0,
                'Volume Breakout': 1.0,
                'Bollinger Bounce': 1.0,
                'Stochastic Oversold': 1.0,
                'ATR Breakout': 1.0,
                'EMA Cross': 1.0,
                'Support Bounce': 1.0,
                'Resistance Break': 1.0,
                'Momentum Divergence': 1.0
            }
        };
    }

    /**
     * Initialize confidence thresholds for regime detection
     */
    initializeConfidenceThresholds() {
        return {
            high: 0.8,      // High confidence in regime detection
            medium: 0.6,    // Medium confidence
            low: 0.4,       // Low confidence
            very_low: 0.2   // Very low confidence
        };
    }

    /**
     * Initialize historical performance tracking
     */
    initializeHistoricalPerformance() {
        return {
            uptrend: { totalSignals: 0, successfulSignals: 0, performance: 0.0 },
            downtrend: { totalSignals: 0, successfulSignals: 0, performance: 0.0 },
            ranging: { totalSignals: 0, successfulSignals: 0, performance: 0.0 },
            unknown: { totalSignals: 0, successfulSignals: 0, performance: 0.0 }
        };
    }

    /**
     * Calculate regime-adjusted signal weight
     * @param {string} signalType - Type of signal (e.g., 'MACD Cross')
     * @param {string} regime - Current market regime ('uptrend', 'downtrend', 'ranging', 'unknown')
     * @param {number} regimeConfidence - Confidence in regime detection (0-1)
     * @param {number} baseWeight - Base weight from signal importance
     * @returns {number} Regime-adjusted weight
     */
    calculateRegimeAdjustedWeight(signalType, regime, regimeConfidence, baseWeight) {
        // Get regime-specific weight
        const regimeWeight = this.regimeWeights[regime]?.[signalType] || 1.0;
        
        // Apply confidence scaling
        const confidenceMultiplier = this.calculateConfidenceMultiplier(regimeConfidence);
        
        // Calculate final weight
        const adjustedWeight = baseWeight * regimeWeight * confidenceMultiplier;
        
        // Apply performance-based adjustment
        const performanceMultiplier = this.getPerformanceMultiplier(regime);
        
        return adjustedWeight * performanceMultiplier;
    }

    /**
     * Calculate confidence multiplier based on regime confidence
     * @param {number} confidence - Regime confidence (0-1)
     * @returns {number} Confidence multiplier
     */
    calculateConfidenceMultiplier(confidence) {
        if (confidence >= this.regimeConfidenceThresholds.high) {
            return 1.2; // Boost signals when regime is highly confident
        } else if (confidence >= this.regimeConfidenceThresholds.medium) {
            return 1.1; // Slight boost for medium confidence
        } else if (confidence >= this.regimeConfidenceThresholds.low) {
            return 1.0; // No adjustment for low confidence
        } else {
            return 0.9; // Reduce signals when regime is uncertain
        }
    }

    /**
     * Get performance-based multiplier for regime
     * @param {string} regime - Market regime
     * @returns {number} Performance multiplier
     */
    getPerformanceMultiplier(regime) {
        const performance = this.historicalPerformance[regime]?.performance || 0.5;
        
        // Scale multiplier based on historical performance
        if (performance > 0.6) {
            return 1.1; // Boost if regime has been performing well
        } else if (performance < 0.4) {
            return 0.9; // Reduce if regime has been performing poorly
        } else {
            return 1.0; // Neutral if performance is average
        }
    }

    /**
     * Update historical performance for a regime
     * @param {string} regime - Market regime
     * @param {boolean} wasSuccessful - Whether the signal was successful
     */
    updateHistoricalPerformance(regime, wasSuccessful) {
        if (!regime) return; // Skip if regime is not provided
        
        // Normalize regime name
        const normalizedRegime = (regime || '').toLowerCase();
        const validRegimes = ['uptrend', 'downtrend', 'ranging', 'neutral', 'unknown'];
        const targetRegime = validRegimes.includes(normalizedRegime) ? normalizedRegime : 'unknown';
        
        if (this.historicalPerformance[targetRegime]) {
            this.historicalPerformance[targetRegime].totalSignals++;
            if (wasSuccessful) {
                this.historicalPerformance[targetRegime].successfulSignals++;
            }
            
            // Recalculate performance
            this.historicalPerformance[targetRegime].performance = 
                this.historicalPerformance[targetRegime].successfulSignals / 
                this.historicalPerformance[targetRegime].totalSignals;
        }
    }

    /**
     * Load historical performance from existing trades
     * @param {Array} trades - Array of trade objects with market_regime and pnl_usdt
     */
    loadHistoricalPerformanceFromTrades(trades) {
        if (!trades || !Array.isArray(trades) || trades.length === 0) {
            //console.log('[RegimeContextWeighting] No trades provided for historical performance loading');
            return;
        }

        //console.log(`[RegimeContextWeighting] Loading historical performance from ${trades.length} trades...`);

        // Reset historical performance
        this.historicalPerformance = this.initializeHistoricalPerformance();

        // Process each trade
        let processedCount = 0;
        for (const trade of trades) {
            if (!trade.market_regime || trade.pnl_usdt === undefined || trade.pnl_usdt === null) {
                continue; // Skip trades without regime or P&L data
            }

            const normalizedRegime = (trade.market_regime || '').toLowerCase();
            const validRegimes = ['uptrend', 'downtrend', 'ranging', 'neutral', 'unknown'];
            const regime = validRegimes.includes(normalizedRegime) ? normalizedRegime : 'unknown';

            const wasSuccessful = Number(trade.pnl_usdt) > 0;
            
            this.updateHistoricalPerformance(regime, wasSuccessful);
            processedCount++;
        }

        // Log summary
        //console.log(`[RegimeContextWeighting] ✅ Loaded historical performance from ${processedCount} trades:`);
        Object.entries(this.historicalPerformance).forEach(([regime, perf]) => {
            if (perf.totalSignals > 0) {
                //console.log(`[RegimeContextWeighting]   ${regime}: ${perf.successfulSignals}/${perf.totalSignals} (${(perf.performance * 100).toFixed(1)}%)`);
            }
        });
    }

    /**
     * Get regime-specific signal effectiveness
     * @param {string} signalType - Type of signal
     * @param {string} regime - Market regime
     * @returns {number} Effectiveness multiplier
     */
    getRegimeEffectiveness(signalType, regime) {
        if (!signalType || !regime) {
            return 1.0;
        }
        
        // Normalize signal type to lowercase for mapping lookup
        const normalizedType = signalType.toLowerCase();
        
        // Map simple signal type to descriptive name
        const mappedSignalType = this.signalTypeMapping[normalizedType] || this.signalTypeMapping[signalType] || signalType;
        
        // Get effectiveness from regime weights
        const effectiveness = this.regimeWeights[regime]?.[mappedSignalType] || 1.0;
        
        return effectiveness;
    }

    /**
     * Calculate regime context bonus for signal combinations
     * @param {Array} signals - Array of signals
     * @param {string} regime - Market regime
     * @param {number} regimeConfidence - Regime confidence
     * @returns {number} Regime context bonus
     */
    calculateRegimeContextBonus(signals, regime, regimeConfidence) {
        // console.log('[regime_debug] 🎯 RegimeContextWeighting.calculateRegimeContextBonus called');
        
        if (!signals || signals.length === 0) {
            // console.log('[regime_debug] ⚠️ No signals provided, returning 0');
            return 0;
        }
        
        // Calculate average regime effectiveness for the signal combination
        const effectivenessScores = signals.map(signal => {
            const effectiveness = this.getRegimeEffectiveness(signal.type || signal.name, regime);
            return effectiveness;
        });
        
        const averageEffectiveness = effectivenessScores.reduce((sum, score) => sum + score, 0) / effectivenessScores.length;
        // console.log('[regime_debug] 📊 Average effectiveness:', averageEffectiveness);
        
        // Apply confidence scaling
        const confidenceMultiplier = this.calculateConfidenceMultiplier(regimeConfidence);
        // console.log('[regime_debug] 🎯 Confidence multiplier:', confidenceMultiplier);
        
        // Calculate bonus (higher effectiveness = higher bonus)
        const baseBonus = (averageEffectiveness - 1.0) * 0.1; // 10% bonus per effectiveness point above 1.0
        const confidenceBonus = baseBonus * confidenceMultiplier;
        
        // Log regime performance once per session (sampled)
        if (!this._loggedRegimePerformance) {
            const signalTypes = signals.map(s => s.type || s.name).filter(Boolean).join(', ');
            const performance = this.historicalPerformance[regime]?.performance || 0.5;
            const totalSignals = this.historicalPerformance[regime]?.totalSignals || 0;
            const successfulSignals = this.historicalPerformance[regime]?.successfulSignals || 0;
            
            //console.log(`[REGIME_PERFORMANCE] Regime: ${regime}, Confidence: ${(regimeConfidence * 100).toFixed(1)}%, Effectiveness: ${averageEffectiveness.toFixed(2)}, Bonus: ${(confidenceBonus * 100).toFixed(2)}%, Historical: ${(performance * 100).toFixed(1)}% (${successfulSignals}/${totalSignals}), Signals: ${signalTypes}`);
            this._loggedRegimePerformance = true;
        }
        
        return Math.max(0, confidenceBonus);
    }

    /**
     * Get regime-specific signal recommendations
     * @param {string} regime - Market regime
     * @returns {Array} Array of recommended signal types
     */
    getRegimeRecommendations(regime) {
        const regimeWeights = this.regimeWeights[regime] || {};
        
        // Sort signals by effectiveness in this regime
        const sortedSignals = Object.entries(regimeWeights)
            .sort(([,a], [,b]) => b - a)
            .map(([signalType, weight]) => ({ signalType, weight }));
        
        return sortedSignals.slice(0, 5); // Top 5 most effective signals
    }

    /**
     * Calculate regime diversity bonus
     * Rewards signal combinations that work well across different regimes
     * @param {Array} signals - Array of signals
     * @returns {number} Diversity bonus
     */
    calculateRegimeDiversityBonus(signals) {
        if (!signals || signals.length === 0) return 0;
        
        const regimes = ['uptrend', 'downtrend', 'ranging'];
        let totalEffectiveness = 0;
        
        // Calculate effectiveness across all regimes
        for (const regime of regimes) {
            const regimeEffectiveness = signals.reduce((sum, signal) => {
                const effectiveness = this.getRegimeEffectiveness(signal.type || signal.name, regime);
                return sum + effectiveness;
            }, 0) / signals.length;
            
            totalEffectiveness += regimeEffectiveness;
        }
        
        // Diversity bonus based on how well signals work across regimes
        const averageEffectiveness = totalEffectiveness / regimes.length;
        const diversityBonus = (averageEffectiveness - 1.0) * 0.05; // 5% bonus per effectiveness point
        
        return Math.max(0, diversityBonus);
    }

    /**
     * Test function to debug regime context weighting
     */
    testRegimeContextWeighting() {
        console.log('🧪 [REGIME_CONTEXT_TEST] Starting RegimeContextWeighting test...');
        
        // Test 1: Check regime weights structure
        console.log('📊 [REGIME_CONTEXT_TEST] Regime weights structure:');
        Object.keys(this.regimeWeights).forEach(regime => {
            console.log(`  ${regime}:`, this.regimeWeights[regime]);
        });
        
        // Test 2: Check signal type mapping
        console.log('\n🗺️ [REGIME_CONTEXT_TEST] Signal type mapping:');
        Object.keys(this.signalTypeMapping).forEach(signalType => {
            console.log(`  ${signalType} -> ${this.signalTypeMapping[signalType]}`);
        });
        
        // Test 3: Test effectiveness calculation
        console.log('\n📈 [REGIME_CONTEXT_TEST] Testing effectiveness calculation:');
        const testSignals = ['rsi', 'macd', 'ema', 'bollinger', 'volume'];
        const testRegimes = ['uptrend', 'downtrend', 'ranging', 'unknown'];
        
        testSignals.forEach(signalType => {
            console.log(`\n  Signal: ${signalType}`);
            testRegimes.forEach(regime => {
                const effectiveness = this.getRegimeEffectiveness(signalType, regime);
                console.log(`    ${regime}: ${effectiveness}`);
            });
        });
        
        // Test 4: Test regime context bonus calculation
        console.log('\n💰 [REGIME_CONTEXT_TEST] Testing regime context bonus:');
        const sampleSignals = [
            { type: 'rsi', strength: 75 },
            { type: 'macd', strength: 80 },
            { type: 'ema', strength: 70 }
        ];
        
        testRegimes.forEach(regime => {
            const bonus = this.calculateRegimeContextBonus(sampleSignals, regime, 0.75);
            console.log(`  ${regime} (75% confidence): ${bonus}`);
        });
        
        console.log('\n✅ [REGIME_CONTEXT_TEST] Test completed!');
    }
}

// Global test function for browser console
window.testRegimeContextWeighting = () => {
    console.log('🧪 [REGIME_CONTEXT_TEST] Creating RegimeContextWeighting instance...');
    const weighting = new RegimeContextWeighting();
    weighting.testRegimeContextWeighting();
};

export default RegimeContextWeighting;
