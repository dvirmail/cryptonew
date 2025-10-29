/**
 * Signal Weight Calculator
 * 
 * This module implements signal importance weighting based on:
 * - Signal type historical performance
 * - Signal quality assessment
 * - Market regime context
 * - Signal correlation detection
 * 
 * Replaces naive addition with sophisticated weighted calculation
 */

import SignalCorrelationDetector from './SignalCorrelationDetector.jsx';
import RegimeContextWeighting from './RegimeContextWeighting.jsx';

export class SignalWeightCalculator {
  constructor() {
    this.signalWeights = this.initializeSignalWeights();
    this.regimeWeights = this.initializeRegimeWeights();
    this.qualityThresholds = this.initializeQualityThresholds();
    this.correlationDetector = new SignalCorrelationDetector();
    this.regimeContextWeighting = new RegimeContextWeighting();
  }

  /**
   * Initialize signal importance weights based on historical performance
   * Higher weights = more important/predictive signals
   */
  initializeSignalWeights() {
    return {
      // Trend signals (high importance)
      'macd_cross': 1.8,
      'macd_divergence': 2.2,
      'ema_cross': 1.6,
      'sma_cross': 1.4,
      'trend_line_break': 2.0,
      'support_resistance': 1.9,
      
      // Momentum signals (medium-high importance)
      'rsi_oversold': 1.5,
      'rsi_overbought': 1.5,
      'stochastic_oversold': 1.3,
      'stochastic_overbought': 1.3,
      'williams_r': 1.2,
      'momentum': 1.4,
      
      // Volume signals (medium importance)
      'volume_spike': 1.6,
      'volume_breakout': 1.7,
      'obv_divergence': 1.8,
      'volume_profile': 1.5,
      
      // Volatility signals (medium importance)
      'bollinger_squeeze': 1.4,
      'bollinger_breakout': 1.6,
      'atr_expansion': 1.5,
      'volatility_breakout': 1.7,
      
      // Pattern signals (high importance)
      'head_shoulders': 2.1,
      'double_top': 1.9,
      'double_bottom': 1.9,
      'triangle': 1.7,
      'flag': 1.6,
      'pennant': 1.5,
      
      // Candlestick patterns (medium-high importance)
      'doji': 1.3,
      'hammer': 1.6,
      'shooting_star': 1.6,
      'engulfing': 1.8,
      'harami': 1.4,
      'morning_star': 1.9,
      'evening_star': 1.9,
      
      // Divergence signals (very high importance)
      'price_momentum_divergence': 2.3,
      'price_volume_divergence': 2.1,
      'rsi_divergence': 2.0,
      'macd_divergence': 2.2,
      
      // Support/Resistance signals (high importance)
      'support_bounce': 1.8,
      'resistance_rejection': 1.8,
      'breakout_confirmation': 2.0,
      'breakdown_confirmation': 2.0,
      
      // Market structure signals (medium-high importance)
      'higher_high': 1.5,
      'lower_low': 1.5,
      'trend_change': 2.1,
      'market_structure_break': 1.9,
      
      // Default weight for unknown signals
      'default': 1.0
    };
  }

  /**
   * Initialize market regime context weights
   * Different signals perform better in different market conditions
   */
  initializeRegimeWeights() {
    return {
      uptrend: {
        'macd_cross': 1.2,
        'ema_cross': 1.3,
        'rsi_oversold': 1.4,
        'support_bounce': 1.5,
        'volume_breakout': 1.3,
        'trend_line_break': 1.4
      },
      downtrend: {
        'macd_cross': 1.2,
        'ema_cross': 1.3,
        'rsi_overbought': 1.4,
        'resistance_rejection': 1.5,
        'volume_breakout': 1.3,
        'trend_line_break': 1.4
      },
      ranging: {
        'bollinger_squeeze': 1.4,
        'support_resistance': 1.6,
        'rsi_oversold': 1.3,
        'rsi_overbought': 1.3,
        'volume_spike': 1.2,
        'atr_expansion': 1.3
      },
      unknown: {
        // Default weights when regime is unknown
        'default': 1.0
      }
    };
  }

  /**
   * Initialize signal quality thresholds
   * Used to assess signal quality based on strength and context
   */
  initializeQualityThresholds() {
    return {
      excellent: { min: 80, weight: 1.3 },
      good: { min: 60, weight: 1.1 },
      average: { min: 40, weight: 1.0 },
      poor: { min: 20, weight: 0.8 },
      very_poor: { min: 0, weight: 0.6 }
    };
  }

  /**
   * Calculate weighted signal strength with regime context weighting
   * @param {Object} signal - Signal object with type, strength, etc.
   * @param {string} marketRegime - Current market regime
   * @param {number} regimeConfidence - Confidence in regime detection
   * @returns {number} Weighted signal strength
   */
  calculateWeightedStrength(signal, marketRegime = 'unknown', regimeConfidence = 0.5) {
    if (!signal || !signal.type) {
      return 0;
    }

    const baseStrength = signal.strength || 0;
    const signalType = signal.type.toLowerCase();
    
    // Get base signal weight
    const baseWeight = this.signalWeights[signalType] || this.signalWeights.default;
    
    // Get regime-specific weight using RegimeContextWeighting
    const regimeAdjustedWeight = this.regimeContextWeighting.calculateRegimeAdjustedWeight(
      signalType, 
      marketRegime, 
      regimeConfidence, 
      baseWeight
    );
    
    // Get quality-based weight
    const qualityWeight = this.getQualityWeight(baseStrength);
    
    // Calculate final weighted strength
    const weightedStrength = baseStrength * regimeAdjustedWeight * qualityWeight;
    
    return Math.max(0, weightedStrength);
  }

  /**
   * Get regime-specific weight for a signal type
   * @param {string} signalType - Type of signal
   * @param {string} marketRegime - Current market regime
   * @returns {number} Regime-specific weight
   */
  getRegimeWeight(signalType, marketRegime) {
    const regimeWeights = this.regimeWeights[marketRegime] || this.regimeWeights.unknown;
    return regimeWeights[signalType] || regimeWeights.default || 1.0;
  }

  /**
   * Get quality-based weight for signal strength
   * @param {number} strength - Signal strength value
   * @returns {number} Quality-based weight
   */
  getQualityWeight(strength) {
    for (const [quality, config] of Object.entries(this.qualityThresholds)) {
      if (strength >= config.min) {
        return config.weight;
      }
    }
    return this.qualityThresholds.very_poor.weight;
  }

  /**
   * Calculate combined strength for a signal combination with regime context
   * @param {Array} signals - Array of signal objects
   * @param {string} marketRegime - Current market regime
   * @param {number} regimeConfidence - Confidence in regime detection
   * @returns {number} Combined weighted strength
   */
  calculateCombinedStrength(signals, marketRegime = 'unknown', regimeConfidence = 0.5) {
    if (!signals || !Array.isArray(signals) || signals.length === 0) {
      return 0;
    }

    // Calculate individual weighted strengths
    const weightedStrengths = signals.map(signal => 
      this.calculateWeightedStrength(signal, marketRegime, regimeConfidence)
    );

    // Apply correlation penalties and bonuses
    const correlationPenalty = this.correlationDetector.calculateCorrelationPenalty(signals);
    const correlationBonus = this.correlationDetector.calculateCorrelationBonus(signals);
    
    // Apply synergy bonuses for complementary signals
    const synergyBonus = this.calculateSynergyBonus(signals);
    
    // Apply diversity bonus for different signal types
    const diversityBonus = this.calculateDiversityBonus(signals);

    // Apply regime context bonus
    const regimeContextBonus = this.regimeContextWeighting.calculateRegimeContextBonus(
      signals, 
      marketRegime, 
      regimeConfidence
    );

    // Apply regime diversity bonus
    const regimeDiversityBonus = this.regimeContextWeighting.calculateRegimeDiversityBonus(signals);

    // Sum weighted strengths with bonuses and penalties
    const totalWeightedStrength = weightedStrengths.reduce((sum, strength) => sum + strength, 0);
    
    // Apply correlation adjustments
    const correlationAdjustedStrength = totalWeightedStrength * (1 - correlationPenalty + correlationBonus);
    
    // Apply all bonuses
    const finalStrength = correlationAdjustedStrength * 
      (1 + synergyBonus) * 
      (1 + diversityBonus) * 
      (1 + regimeContextBonus) * 
      (1 + regimeDiversityBonus);
    
    return finalStrength;
  }

  /**
   * Calculate synergy bonus for complementary signals
   * @param {Array} signals - Array of signal objects
   * @returns {number} Synergy bonus multiplier
   */
  calculateSynergyBonus(signals) {
    const signalTypes = signals.map(s => s.type?.toLowerCase()).filter(Boolean);
    
    // Define synergistic signal pairs
    const synergisticPairs = [
      ['macd_cross', 'ema_cross'],
      ['rsi_oversold', 'stochastic_oversold'],
      ['volume_spike', 'bollinger_breakout'],
      ['support_bounce', 'rsi_oversold'],
      ['resistance_rejection', 'rsi_overbought'],
      ['trend_line_break', 'volume_breakout']
    ];

    let synergyCount = 0;
    for (const pair of synergisticPairs) {
      if (signalTypes.includes(pair[0]) && signalTypes.includes(pair[1])) {
        synergyCount++;
      }
    }

    // Bonus: 0.1 per synergistic pair, max 0.3
    return Math.min(0.3, synergyCount * 0.1);
  }

  /**
   * Calculate diversity bonus for different signal types
   * @param {Array} signals - Array of signal objects
   * @returns {number} Diversity bonus multiplier
   */
  calculateDiversityBonus(signals) {
    const signalTypes = signals.map(s => s.type?.toLowerCase()).filter(Boolean);
    const uniqueTypes = new Set(signalTypes);
    
    // Bonus for having different types of signals
    const diversityRatio = uniqueTypes.size / signalTypes.length;
    
    // Bonus: 0.05 per unique type, max 0.2
    return Math.min(0.2, uniqueTypes.size * 0.05);
  }

  /**
   * Get signal importance ranking
   * @param {Array} signals - Array of signal objects
   * @returns {Array} Signals sorted by importance
   */
  getSignalImportanceRanking(signals) {
    return signals
      .map(signal => ({
        ...signal,
        importance: this.signalWeights[signal.type?.toLowerCase()] || this.signalWeights.default
      }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Update signal weights based on performance data
   * @param {Object} performanceData - Performance data for signal types
   */
  updateWeightsFromPerformance(performanceData) {
    // This would be implemented to learn from backtest results
    // For now, it's a placeholder for future enhancement
    console.log('Signal weight learning not yet implemented');
  }
}

export default SignalWeightCalculator;
