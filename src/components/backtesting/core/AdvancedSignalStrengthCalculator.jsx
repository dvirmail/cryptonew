/**
 * Advanced Signal Strength Calculator
 * Step 4: Comprehensive scoring system integrating all improvements
 * 
 * This calculator combines:
 * - Signal importance weighting (Step 1)
 * - Correlation detection (Step 2) 
 * - Market regime context (Step 3)
 * - Signal quality assessment
 * - Synergy bonuses
 * - Performance-based learning
 */

import { SignalWeightCalculator } from './SignalWeightCalculator.jsx';
import { SignalCorrelationDetector } from './SignalCorrelationDetector.jsx';
import RegimeContextWeighting from './RegimeContextWeighting.jsx';

export class AdvancedSignalStrengthCalculator {
  constructor() {
    this.signalWeightCalculator = new SignalWeightCalculator();
    this.correlationDetector = new SignalCorrelationDetector();
    this.regimeContextWeighting = new RegimeContextWeighting();
    
    // Performance tracking for learning
    this.performanceHistory = new Map();
    this.signalQualityMetrics = new Map();
    
    // GLOBAL logging flag - shared across all instances to prevent repeated logging
    if (typeof window !== 'undefined' && !window._advancedCalculatorLoggedFirstStrategy) {
      window._advancedCalculatorLoggedFirstStrategy = false;
    }
    
    // Expose reset function globally for debugging
    if (typeof window !== 'undefined') {
      window.resetAdvancedCalculatorLogging = () => {
        window._advancedCalculatorLoggedFirstStrategy = false;
        console.log('[ADVANCED_CALCULATOR] 🔄 Logging flag reset - next calculation will be logged');
      };
      
      // Create global instance for testing
      if (!window.advancedCalculatorInstance) {
        window.advancedCalculatorInstance = this;
        console.log('[ADVANCED_CALCULATOR] 🌐 Global instance created for testing');
      }
      
      // Expose test functions for debugging
      window.testAdvancedCalculator = () => {
        console.log('🧪 [ADVANCED_CALCULATOR] Testing calculator with sample signals...');
        
        const testSignals = [
          { type: "macd", strength: 85 },
          { type: "rsi", strength: 70 },
          { type: "ema", strength: 60 },
          { type: "bollinger", strength: 65 },
          { type: "atr", strength: 50 }
        ];
        
        const testRegime = "uptrend";
        const testConfidence = 0.8;
        const testContext = { marketVolatility: 0.005, trendStrength: 0.002, volumeProfile: 0.5 };
        
        console.log('📊 [ADVANCED_CALCULATOR] Test inputs:', {
          signals: testSignals,
          regime: testRegime,
          confidence: testConfidence,
          context: testContext
        });
        
        // Reset logging to see detailed calculation
        window._advancedCalculatorLoggedFirstStrategy = false;
        
        const result = window.advancedCalculatorInstance.calculateAdvancedCombinedStrength(testSignals, testRegime, testConfidence, testContext);
        
        console.log('🎯 [ADVANCED_CALCULATOR] Test result:', result);
        return result;
      };
      
      window.testAdvancedCalculatorWithAllSignals = () => {
        console.log('🧪 [ADVANCED_CALCULATOR] Testing calculator with ALL signal types...');
        
        const allSignalTypes = [
          "macd", "rsi", "ichimoku", "stochastic", "ema", "bollinger", "ma200", "atr",
          "psar", "williamsr", "mfi", "adx", "tema", "dema", "hma", "wma", "cci", "roc",
          "awesomeoscillator", "cmo", "obv", "cmf", "adline", "bbw", "ttm_squeeze",
          "candlestick", "keltner", "donchian", "chartpattern", "pivot", "fibonacci",
          "supportresistance", "maribbon", "volume"
        ];
        
        const testSignals = allSignalTypes.map(type => ({
          type,
          strength: Math.floor(Math.random() * 100) // Random strength 0-100
        }));
        
        console.log('📊 [ADVANCED_CALCULATOR] Testing with', testSignals.length, 'signal types');
        
        // Reset logging to see detailed calculation
        window._advancedCalculatorLoggedFirstStrategy = false;
        
        const result = window.advancedCalculatorInstance.calculateAdvancedCombinedStrength(testSignals, "uptrend", 0.8, {});
        
        console.log('🎯 [ADVANCED_CALCULATOR] All signals test result:', result);
        return result;
      };
    }
    
    // Advanced configuration
    this.config = {
      // Quality thresholds
      highQualityThreshold: 0.8,
      mediumQualityThreshold: 0.6,
      lowQualityThreshold: 0.4,
      
      // Synergy bonuses
      complementarySignalBonus: 0.15,
      diverseSignalBonus: 0.10,
      regimeAlignmentBonus: 0.20,
      
      // Performance learning
      learningRate: 0.1,
      minSamplesForLearning: 10,
      
      // Advanced penalties
      overCorrelationPenalty: 0.25,
      lowQualityPenalty: 0.30,
      regimeMismatchPenalty: 0.20
    };
  }

  /**
   * Calculate advanced combined strength with all improvements
   * @param {Array} signals - Array of signal objects
   * @param {string} marketRegime - Current market regime
   * @param {number} regimeConfidence - Confidence in regime detection
   * @param {Object} marketContext - Additional market context
   * @returns {Object} Advanced strength calculation result
   */
  calculateAdvancedCombinedStrength(signals, marketRegime = 'unknown', regimeConfidence = 0.5, marketContext = {}) {
    if (!signals || !Array.isArray(signals) || signals.length === 0) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Invalid signals input:', signals);
      return {
        totalStrength: 0,
        breakdown: {},
        qualityScore: 0,
        recommendations: []
      };
    }

    // COMPREHENSIVE ERROR CHECKING: Validate all signal values
    signals.forEach((signal, index) => {
      if (!signal) {
        console.error(`❌ [ADVANCED_CALCULATOR] ERROR: Signal ${index} is null or undefined`);
        return;
      }
      
      if (signal.type === null || signal.type === undefined) {
        console.error(`❌ [ADVANCED_CALCULATOR] ERROR: Signal ${index} type is null/undefined:`, signal);
      }
      
      if (signal.strength === null || signal.strength === undefined) {
        console.error(`❌ [ADVANCED_CALCULATOR] ERROR: Signal ${index} strength is null/undefined:`, signal);
      }
      
      if (typeof signal.strength !== 'number' || isNaN(signal.strength)) {
        console.error(`❌ [ADVANCED_CALCULATOR] ERROR: Signal ${index} strength is not a valid number:`, signal.strength);
      }
      
      if (signal.strength < 0 || signal.strength > 100) {
        console.error(`❌ [ADVANCED_CALCULATOR] ERROR: Signal ${index} strength is out of range (0-100):`, signal.strength);
      }
    });

    // Validate market regime parameters
    if (marketRegime === null || marketRegime === undefined) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Market regime is null/undefined');
    }
    
    if (regimeConfidence === null || regimeConfidence === undefined) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Regime confidence is null/undefined');
    }
    
    if (typeof regimeConfidence !== 'number' || isNaN(regimeConfidence)) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Regime confidence is not a valid number:', regimeConfidence);
    }
    
    if (regimeConfidence < 0 || regimeConfidence > 1) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Regime confidence is out of range (0-1):', regimeConfidence);
    }

    // Validate market context
    if (marketContext === null || marketContext === undefined) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: Market context is null/undefined');
    }

    // DETAILED LOGGING: Log the first strategy calculation (GLOBAL flag)
    const isFirstStrategy = !window._advancedCalculatorLoggedFirstStrategy;
    if (isFirstStrategy) {
      console.log('🚀 [ADVANCED_CALCULATOR] ===== FIRST STRATEGY DETAILED CALCULATION =====');
      console.log('📊 [ADVANCED_CALCULATOR] Input signals:', signals.map(s => ({ type: s.type, strength: s.strength })));
      console.log('📊 [ADVANCED_CALCULATOR] Market regime:', marketRegime, 'Confidence:', regimeConfidence);
      console.log('📊 [ADVANCED_CALCULATOR] Market context:', marketContext);
      window._advancedCalculatorLoggedFirstStrategy = true;
    }

    // Step 1: Calculate individual weighted strengths
    const weightedStrengths = signals.map(signal => {
      try {
        const result = this.signalWeightCalculator.calculateWeightedStrength(signal, marketRegime, regimeConfidence);
        if (result === null || result === undefined || isNaN(result)) {
          console.error('❌ [ADVANCED_CALCULATOR] ERROR: SignalWeightCalculator returned invalid result:', result, 'for signal:', signal);
        }
        return result;
      } catch (error) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: SignalWeightCalculator failed:', error, 'for signal:', signal);
        return 0;
      }
    });

    if (isFirstStrategy) {
      console.log('🔢 [ADVANCED_CALCULATOR] Step 1 - Individual weighted strengths:');
      weightedStrengths.forEach((strength, i) => {
        console.log(`   Signal ${i+1} (${signals[i].type}): Original=${signals[i].strength} → Weighted=${strength}`);
      });
    }

    // Step 2: Apply correlation analysis
    let correlationAnalysis;
    try {
      correlationAnalysis = this.correlationDetector.getCorrelationReport(signals);
      if (!correlationAnalysis || correlationAnalysis.penalty === null || correlationAnalysis.penalty === undefined || 
          correlationAnalysis.bonus === null || correlationAnalysis.bonus === undefined) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: CorrelationDetector returned invalid result:', correlationAnalysis);
        correlationAnalysis = { penalty: 0, bonus: 0 };
      }
    } catch (error) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: CorrelationDetector failed:', error);
      correlationAnalysis = { penalty: 0, bonus: 0 };
    }
    
    if (isFirstStrategy) {
      console.log('🔗 [ADVANCED_CALCULATOR] Step 2 - Correlation analysis:');
      console.log('   Correlation penalty:', correlationAnalysis.penalty);
      console.log('   Correlation bonus:', correlationAnalysis.bonus);
      console.log('   Net correlation impact:', correlationAnalysis.penalty - correlationAnalysis.bonus);
    }
    
    // Step 3: Apply regime context weighting
    let regimeAnalysis;
    try {
      // console.log('[regime_debug] 🔍 Starting regime context calculation...');
      
      regimeAnalysis = this.regimeContextWeighting.calculateRegimeContextBonus(signals, marketRegime, regimeConfidence);
      
      // console.log('[regime_debug] 📈 RegimeContextWeighting result:', regimeAnalysis);
      
      if (regimeAnalysis === null || regimeAnalysis === undefined || isNaN(regimeAnalysis)) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: RegimeContextWeighting returned invalid result:', regimeAnalysis);
        regimeAnalysis = 0;
      }
    } catch (error) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: RegimeContextWeighting failed:', error);
      console.error('[regime_debug] 🚨 RegimeContextWeighting error details:', error.stack);
      regimeAnalysis = 0;
    }

    if (isFirstStrategy) {
      console.log('📈 [ADVANCED_CALCULATOR] Step 3 - Regime context weighting:');
      console.log('   Regime bonus:', regimeAnalysis);
      console.log('   Regime diversity bonus:', 0); // This method doesn't calculate diversity bonus
      console.log('   Total regime impact:', regimeAnalysis);
    }
    
    // Step 4: Calculate signal quality scores
    const qualityScores = signals.map(signal => {
      try {
        const result = this.calculateSignalQuality(signal, marketContext);
        if (result === null || result === undefined || isNaN(result)) {
          console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateSignalQuality returned invalid result:', result, 'for signal:', signal);
        }
        return result;
      } catch (error) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateSignalQuality failed:', error, 'for signal:', signal);
        return 0.5; // Default quality score
      }
    });
    
    if (isFirstStrategy) {
      console.log('⭐ [ADVANCED_CALCULATOR] Step 4 - Signal quality scores:');
      qualityScores.forEach((score, i) => {
        console.log(`   Signal ${i+1} (${signals[i].type}): Quality=${score}`);
      });
    }
    
    // Step 5: Calculate synergy bonuses
    let synergyBonuses;
    try {
      synergyBonuses = this.calculateAdvancedSynergyBonuses(signals, marketRegime);
      if (!synergyBonuses || synergyBonuses.total === null || synergyBonuses.total === undefined || 
          synergyBonuses.diverse === null || synergyBonuses.diverse === undefined) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateAdvancedSynergyBonuses returned invalid result:', synergyBonuses);
        synergyBonuses = { total: 0, diverse: 0 };
      }
    } catch (error) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateAdvancedSynergyBonuses failed:', error);
      synergyBonuses = { total: 0, diverse: 0 };
    }
    
    if (isFirstStrategy) {
      console.log('🤝 [ADVANCED_CALCULATOR] Step 5 - Synergy bonuses:');
      console.log('   Synergy bonus:', synergyBonuses.total);
      console.log('   Diversity bonus:', synergyBonuses.diverse);
      console.log('   Total synergy impact:', synergyBonuses.total);
    }
    
    // Step 6: Apply performance-based learning adjustments
    let learningAdjustments;
    try {
      learningAdjustments = this.applyPerformanceLearning(signals, marketRegime);
      if (!learningAdjustments || learningAdjustments.totalAdjustment === null || learningAdjustments.totalAdjustment === undefined) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: applyPerformanceLearning returned invalid result:', learningAdjustments);
        learningAdjustments = { 
          signalTypeAdjustments: {}, 
          regimeAdjustments: {}, 
          totalAdjustment: 0 
        };
      }
    } catch (error) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: applyPerformanceLearning failed:', error);
      learningAdjustments = { 
        signalTypeAdjustments: {}, 
        regimeAdjustments: {}, 
        totalAdjustment: 0 
      };
    }
    
    if (isFirstStrategy) {
      console.log('🧠 [ADVANCED_CALCULATOR] Step 6 - Learning adjustments:');
      console.log('   Signal type adjustments:', learningAdjustments.signalTypeAdjustments);
      console.log('   Regime adjustments:', learningAdjustments.regimeAdjustments);
      console.log('   Total learning impact:', learningAdjustments.totalAdjustment);
    }
    
    // Step 7: Calculate final strength with all factors
    let finalStrength;
    try {
      finalStrength = this.calculateFinalStrength(
        weightedStrengths,
        correlationAnalysis,
        regimeAnalysis,
        qualityScores,
        synergyBonuses,
        learningAdjustments
      );
      
      if (!finalStrength || finalStrength.total === null || finalStrength.total === undefined || isNaN(finalStrength.total)) {
        console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateFinalStrength returned invalid result:', finalStrength);
        finalStrength = {
          base: 0,
          correlation: 0,
          regime: 0,
          quality: 0,
          synergy: 0,
          learning: 0,
          total: 0
        };
      }
    } catch (error) {
      console.error('❌ [ADVANCED_CALCULATOR] ERROR: calculateFinalStrength failed:', error);
      finalStrength = {
        base: 0,
        correlation: 0,
        regime: 0,
        quality: 0,
        synergy: 0,
        learning: 0,
        total: 0
      };
    }

    if (isFirstStrategy) {
      console.log('🎯 [ADVANCED_CALCULATOR] Step 7 - Final strength calculation:');
      console.log('   Base weighted strength:', finalStrength.base);
      console.log('   Correlation adjustment:', finalStrength.correlation);
      console.log('   Regime adjustment:', finalStrength.regime);
      console.log('   Quality adjustment:', finalStrength.quality);
      console.log('   Synergy bonus:', finalStrength.synergy);
      console.log('   Learning adjustment:', finalStrength.learning);
      console.log('   🏆 FINAL TOTAL STRENGTH:', finalStrength.total);
      console.log('🚀 [ADVANCED_CALCULATOR] ===== END FIRST STRATEGY CALCULATION =====');
    }

    // Step 8: Generate recommendations
    const recommendations = this.generateRecommendations(
      signals,
      correlationAnalysis,
      regimeAnalysis,
      qualityScores,
      finalStrength
    );

    return {
      totalStrength: finalStrength.total,
      breakdown: {
        baseWeightedStrength: finalStrength.base,
        correlationAdjustment: finalStrength.correlation,
        regimeAdjustment: finalStrength.regime,
        qualityAdjustment: finalStrength.quality,
        synergyBonus: finalStrength.synergy,
        learningAdjustment: finalStrength.learning
      },
      qualityScore: finalStrength.quality,
      recommendations: recommendations,
      signalAnalysis: {
        correlation: correlationAnalysis,
        regime: regimeAnalysis,
        quality: qualityScores
      }
    };
  }

  /**
   * Calculate signal quality based on multiple factors
   * @param {Object} signal - Signal object
   * @param {Object} marketContext - Market context
   * @returns {number} Quality score (0-1)
   */
  calculateSignalQuality(signal, marketContext = {}) {
    let qualityScore = 0;
    let factors = 0;

    // Factor 1: Signal strength relative to historical performance
    const historicalPerformance = this.getHistoricalPerformance(signal.type);
    if (historicalPerformance) {
      const strengthRatio = signal.strength / historicalPerformance.averageStrength;
      qualityScore += Math.min(strengthRatio, 1.0) * 0.3;
      factors += 0.3;
    }

    // Factor 2: Signal consistency
    const consistency = this.calculateSignalConsistency(signal);
    qualityScore += consistency * 0.25;
    factors += 0.25;

    // Factor 3: Market context alignment
    const contextAlignment = this.calculateContextAlignment(signal, marketContext);
    qualityScore += contextAlignment * 0.25;
    factors += 0.25;

    // Factor 4: Recent performance
    const recentPerformance = this.getRecentPerformance(signal.type);
    if (recentPerformance) {
      qualityScore += recentPerformance * 0.2;
      factors += 0.2;
    }

    return factors > 0 ? qualityScore / factors : 0.5; // Default to medium quality
  }

  /**
   * Calculate advanced synergy bonuses
   * @param {Array} signals - Array of signals
   * @param {string} marketRegime - Current market regime
   * @returns {Object} Synergy bonus calculations
   */
  calculateAdvancedSynergyBonuses(signals, marketRegime) {
    const bonuses = {
      complementary: 0,
      diverse: 0,
      regimeAligned: 0,
      total: 0
    };

    // Complementary signal bonus
    const complementaryPairs = this.findComplementarySignalPairs(signals);
    bonuses.complementary = complementaryPairs.length * this.config.complementarySignalBonus;

    // Diversity bonus
    const signalTypes = new Set(signals.map(s => s.type));
    const diversityRatio = signalTypes.size / signals.length;
    bonuses.diverse = diversityRatio * this.config.diverseSignalBonus;

    // Regime alignment bonus
    const regimeAlignedSignals = signals.filter(signal => 
      this.isSignalRegimeAligned(signal, marketRegime)
    );
    bonuses.regimeAligned = (regimeAlignedSignals.length / signals.length) * this.config.regimeAlignmentBonus;

    bonuses.total = bonuses.complementary + bonuses.diverse + bonuses.regimeAligned;
    return bonuses;
  }

  /**
   * Apply performance-based learning adjustments
   * @param {Array} signals - Array of signals
   * @param {string} marketRegime - Current market regime
   * @returns {Object} Learning adjustments
   */
  applyPerformanceLearning(signals, marketRegime) {
    const adjustments = {
      signalTypeAdjustments: {},
      regimeAdjustments: {},
      totalAdjustment: 0
    };

    // Learn from signal type performance
    signals.forEach(signal => {
      const performance = this.getSignalTypePerformance(signal.type, marketRegime);
      if (performance && performance.sampleCount >= this.config.minSamplesForLearning) {
        const adjustment = (performance.successRate - 0.5) * this.config.learningRate;
        adjustments.signalTypeAdjustments[signal.type] = adjustment;
      }
    });

    // Learn from regime performance
    const regimePerformance = this.getRegimePerformance(marketRegime);
    if (regimePerformance && regimePerformance.sampleCount >= this.config.minSamplesForLearning) {
      adjustments.regimeAdjustments[marketRegime] = 
        (regimePerformance.successRate - 0.5) * this.config.learningRate;
    }

    // Calculate total adjustment
    const signalAdjustments = Object.values(adjustments.signalTypeAdjustments);
    const regimeAdjustments = Object.values(adjustments.regimeAdjustments);
    
    adjustments.totalAdjustment = 
      (signalAdjustments.reduce((sum, adj) => sum + adj, 0) / signals.length) +
      (regimeAdjustments.reduce((sum, adj) => sum + adj, 0));

    return adjustments;
  }

  /**
   * Calculate final strength with all factors
   * @param {Array} weightedStrengths - Individual weighted strengths
   * @param {Object} correlationAnalysis - Correlation analysis results
   * @param {Object} regimeAnalysis - Regime analysis results
   * @param {Array} qualityScores - Signal quality scores
   * @param {Object} synergyBonuses - Synergy bonus calculations
   * @param {Object} learningAdjustments - Learning adjustments
   * @returns {Object} Final strength calculation
   */
  calculateFinalStrength(weightedStrengths, correlationAnalysis, regimeAnalysis, qualityScores, synergyBonuses, learningAdjustments) {
    // Base weighted strength
    const baseStrength = weightedStrengths.reduce((sum, strength) => sum + strength, 0);

    // Apply correlation penalty
    const correlationPenalty = correlationAnalysis.penalty || 0;
    const correlationAdjusted = baseStrength * (1 - correlationPenalty);

    // Apply regime context adjustment
    // FIXED: regimeAnalysis is a number (bonus), not an object with multiplier
    const regimeMultiplier = 1.0 + (regimeAnalysis || 0); // Convert bonus to multiplier
    const regimeAdjusted = correlationAdjusted * regimeMultiplier;


    // Apply quality adjustments
    const averageQuality = qualityScores.reduce((sum, quality) => sum + quality, 0) / qualityScores.length;
    const qualityMultiplier = 0.5 + (averageQuality * 0.5); // Scale from 0.5 to 1.0
    const qualityAdjusted = regimeAdjusted * qualityMultiplier;

    // Apply synergy bonuses
    const synergyAdjusted = qualityAdjusted * (1 + synergyBonuses.total);

    // Apply learning adjustments
    const finalStrength = synergyAdjusted * (1 + learningAdjustments.totalAdjustment);

    return {
      base: baseStrength,
      correlation: correlationAdjusted - baseStrength,
      regime: regimeAdjusted - correlationAdjusted,
      quality: qualityAdjusted - regimeAdjusted,
      synergy: synergyAdjusted - qualityAdjusted,
      learning: finalStrength - synergyAdjusted,
      total: finalStrength
    };
  }

  /**
   * Generate recommendations based on analysis
   * @param {Array} signals - Array of signals
   * @param {Object} correlationAnalysis - Correlation analysis
   * @param {Object} regimeAnalysis - Regime analysis
   * @param {Array} qualityScores - Quality scores
   * @param {Object} finalStrength - Final strength calculation
   * @returns {Array} Recommendations
   */
  generateRecommendations(signals, correlationAnalysis, regimeAnalysis, qualityScores, finalStrength) {
    const recommendations = [];

    // Correlation recommendations
    if (correlationAnalysis.penalty > 0.1) {
      recommendations.push({
        type: 'correlation',
        message: `High correlation detected (${(correlationAnalysis.penalty * 100).toFixed(1)}% penalty). Consider diversifying signal types.`,
        priority: 'medium'
      });
    }

    // Regime recommendations
    if (regimeAnalysis.confidence < 0.6) {
      recommendations.push({
        type: 'regime',
        message: `Low regime confidence (${(regimeAnalysis.confidence * 100).toFixed(1)}%). Consider waiting for clearer market direction.`,
        priority: 'high'
      });
    }

    // Quality recommendations
    const lowQualitySignals = qualityScores.filter(score => score < this.config.lowQualityThreshold);
    if (lowQualitySignals.length > 0) {
      recommendations.push({
        type: 'quality',
        message: `${lowQualitySignals.length} signals have low quality scores. Consider filtering or improving signal conditions.`,
        priority: 'medium'
      });
    }

    // Strength recommendations
    if (finalStrength.total < 100) {
      recommendations.push({
        type: 'strength',
        message: `Combined strength (${finalStrength.total.toFixed(1)}) is below recommended threshold. Consider additional signals or better conditions.`,
        priority: 'high'
      });
    }

    return recommendations;
  }

  // Helper methods for performance tracking and learning
  getHistoricalPerformance(signalType) {
    return this.performanceHistory.get(signalType) || null;
  }

  getRecentPerformance(signalType) {
    const performance = this.performanceHistory.get(signalType);
    return performance ? performance.recentSuccessRate : null;
  }

  calculateSignalConsistency(signal) {
    // Simplified consistency calculation
    // In a real implementation, this would analyze historical consistency
    return 0.7; // Default medium consistency
  }

  calculateContextAlignment(signal, marketContext) {
    // Simplified context alignment
    // In a real implementation, this would analyze market context alignment
    return 0.8; // Default good alignment
  }

  findComplementarySignalPairs(signals) {
    // Simplified complementary pair detection
    // In a real implementation, this would use more sophisticated logic
    const pairs = [];
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        if (this.areSignalsComplementary(signals[i], signals[j])) {
          pairs.push([signals[i], signals[j]]);
        }
      }
    }
    return pairs;
  }

  areSignalsComplementary(signal1, signal2) {
    // Simplified complementary detection
    // In a real implementation, this would use more sophisticated logic
    const complementaryTypes = {
      'macd_cross': ['rsi_oversold', 'volume_breakout'],
      'rsi_oversold': ['macd_cross', 'bollinger_bounce'],
      'volume_breakout': ['macd_cross', 'resistance_break']
    };
    
    return complementaryTypes[signal1.type]?.includes(signal2.type) || false;
  }

  isSignalRegimeAligned(signal, marketRegime) {
    // Simplified regime alignment check
    // In a real implementation, this would use more sophisticated logic
    const regimeAlignments = {
      'uptrend': ['macd_cross', 'volume_breakout', 'resistance_break'],
      'downtrend': ['rsi_oversold', 'momentum_divergence'],
      'ranging': ['bollinger_bounce', 'support_bounce']
    };
    
    return regimeAlignments[marketRegime]?.includes(signal.type) || false;
  }

  getSignalTypePerformance(signalType, marketRegime) {
    // Simplified performance lookup
    // In a real implementation, this would use actual performance data
    return {
      successRate: 0.6,
      sampleCount: 15
    };
  }

  getRegimePerformance(marketRegime) {
    // Simplified regime performance lookup
    // In a real implementation, this would use actual performance data
    return {
      successRate: 0.65,
      sampleCount: 20
    };
  }

  /**
   * Update performance history with new results
   * @param {string} signalType - Type of signal
   * @param {boolean} success - Whether the signal was successful
   * @param {string} marketRegime - Market regime at the time
   */
  updatePerformanceHistory(signalType, success, marketRegime) {
    if (!this.performanceHistory.has(signalType)) {
      this.performanceHistory.set(signalType, {
        totalCount: 0,
        successCount: 0,
        recentSuccessRate: 0,
        averageStrength: 0,
        regimePerformance: {}
      });
    }

    const performance = this.performanceHistory.get(signalType);
    performance.totalCount++;
    if (success) performance.successCount++;
    performance.recentSuccessRate = performance.successCount / performance.totalCount;

    // Update regime-specific performance
    if (!performance.regimePerformance[marketRegime]) {
      performance.regimePerformance[marketRegime] = { count: 0, success: 0 };
    }
    performance.regimePerformance[marketRegime].count++;
    if (success) performance.regimePerformance[marketRegime].success++;
  }

  /**
   * Test function to debug regime calculation
   */
  testRegimeCalculation() {
    console.log('🧪 [REGIME_TEST] Starting regime calculation test...');
    
    // Create sample signals
    const sampleSignals = [
      { type: 'rsi', strength: 75, name: 'RSI Oversold' },
      { type: 'macd', strength: 80, name: 'MACD Bullish' },
      { type: 'ema', strength: 70, name: 'EMA Trend' }
    ];
    
    const testRegimes = ['uptrend', 'downtrend', 'ranging', 'unknown'];
    
    testRegimes.forEach(regime => {
      console.log(`\n🔍 [REGIME_TEST] Testing regime: ${regime}`);
      
      // Test 1: Check regime weights
      console.log('📊 [REGIME_TEST] Regime weights:', this.regimeContextWeighting.regimeWeights[regime]);
      
      // Test 2: Check signal type mapping
      sampleSignals.forEach(signal => {
        const mappedType = this.regimeContextWeighting.signalTypeMapping[signal.type];
        console.log(`🗺️ [REGIME_TEST] Signal mapping: ${signal.type} -> ${mappedType}`);
        
        // Test 3: Check effectiveness
        const effectiveness = this.regimeContextWeighting.getRegimeEffectiveness(signal.type, regime);
        console.log(`📈 [REGIME_TEST] Effectiveness for ${signal.type} in ${regime}: ${effectiveness}`);
      });
      
      // Test 4: Calculate regime context bonus
      const regimeBonus = this.regimeContextWeighting.calculateRegimeContextBonus(sampleSignals, regime, 0.75);
      console.log(`💰 [REGIME_TEST] Regime bonus for ${regime}: ${regimeBonus}`);
      
      // Test 5: Full advanced calculation
      const result = this.calculateAdvancedCombinedStrength(sampleSignals, regime, 0.75);
      console.log(`🎯 [REGIME_TEST] Full calculation result for ${regime}:`, {
        totalStrength: result.totalStrength,
        regimeAdjustment: result.breakdown?.regimeAdjustment !== undefined ? result.breakdown.regimeAdjustment : 'N/A',
        regimeAnalysis: result.signalAnalysis?.regime !== undefined ? result.signalAnalysis.regime : 'N/A',
        regimeBonus: result.signalAnalysis?.regime !== undefined ? result.signalAnalysis.regime : 'N/A',
        fullBreakdown: result.breakdown,
        fullSignalAnalysis: result.signalAnalysis
      });
    });
    
    console.log('\n✅ [REGIME_TEST] Test completed!');
  }
}

// Global test function for browser console
window.testRegimeCalculation = () => {
  console.log('🧪 [REGIME_TEST] Creating AdvancedSignalStrengthCalculator instance...');
  const calculator = new AdvancedSignalStrengthCalculator();
  calculator.testRegimeCalculation();
};
