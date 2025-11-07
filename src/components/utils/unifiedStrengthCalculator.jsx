/**
 * Unified Signal Strength Calculator
 * 
 * This module provides a consistent strength calculation function used by both
 * the backtest engine and the autoscanner to ensure identical results.
 * 
 * Based on the backtest's AdvancedSignalStrengthCalculator logic.
 */

import { SIGNAL_WEIGHTS, CORE_SIGNAL_TYPES } from './signalSettings';
import { getRegimeMultiplier } from './regimeUtils';
import { SignalCorrelationDetector } from '@/components/backtesting/core/SignalCorrelationDetector.jsx';
import SignalWeightCalculator from '@/components/backtesting/core/SignalWeightCalculator.jsx';
import RegimeContextWeighting from '@/components/backtesting/core/RegimeContextWeighting.jsx';

// Singleton instances
let correlationDetectorInstance = null;
let signalWeightCalculatorInstance = null;
let regimeContextWeightingInstance = null;

function getCorrelationDetector() {
  if (!correlationDetectorInstance) {
    try {
      correlationDetectorInstance = new SignalCorrelationDetector();
    } catch (error) {
      console.error('[UNIFIED_CALCULATOR] Failed to create SignalCorrelationDetector:', error);
      throw error;
    }
  }
  return correlationDetectorInstance;
}

function getSignalWeightCalculator() {
  if (!signalWeightCalculatorInstance) {
    try {
      signalWeightCalculatorInstance = new SignalWeightCalculator();
    } catch (error) {
      console.error('[UNIFIED_CALCULATOR] Failed to create SignalWeightCalculator:', error);
      throw error;
    }
  }
  return signalWeightCalculatorInstance;
}

function getRegimeContextWeighting() {
  if (!regimeContextWeightingInstance) {
    try {
      regimeContextWeightingInstance = new RegimeContextWeighting();
    } catch (error) {
      console.error('[UNIFIED_CALCULATOR] Failed to create RegimeContextWeighting:', error);
      throw error;
    }
  }
  return regimeContextWeightingInstance;
}

/**
 * Calculate signal quality based on strength value
 * @param {number} strength - Signal strength (0-100)
 * @returns {number} Quality score (0-1)
 */
function calculateSignalQuality(strength) {
  if (strength >= 90) return 1.0;      // Excellent
  if (strength >= 75) return 0.95;     // Good
  if (strength >= 60) return 0.85;     // Fair
  if (strength >= 40) return 0.70;     // Poor
  return 0.50;                          // Very Poor
}

/**
 * Calculate synergy bonus for complementary signals
 * @param {Array} signals - Array of signal objects
 * @returns {number} Synergy bonus (0-0.3)
 */
function calculateSynergyBonus(signals) {
  const signalTypes = signals.map(s => s.type?.toLowerCase()).filter(Boolean);
  
  // Define synergistic signal pairs
  const synergisticPairs = [
    ['macd', 'ema'],
    ['rsi', 'stochastic'],
    ['volume', 'bollinger'],
    ['supportresistance', 'rsi'],
    ['fibonacci', 'rsi'],
    ['macd', 'volume']
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
 * @returns {number} Diversity bonus (0-0.2)
 */
function calculateDiversityBonus(signals) {
  const signalTypes = signals.map(s => s.type?.toLowerCase()).filter(Boolean);
  const uniqueTypes = new Set(signalTypes);
  
  // Bonus: 0.05 per unique type, max 0.2
  return Math.min(0.2, uniqueTypes.size * 0.05);
}

/**
 * Unified strength calculation function
 * 
 * @param {Array} signals - Array of signal objects with {type, strength, value, isEvent, etc.}
 * @param {Object} options - Calculation options
 * @param {string} options.marketRegime - Current market regime ('uptrend', 'downtrend', 'ranging', 'neutral')
 * @param {number} options.regimeConfidence - Confidence in regime detection (0-1), default 0.5
 * @param {Object} options.marketContext - Additional market context (optional)
 * @param {boolean} options.useAdvancedFeatures - Enable advanced features (quality, synergy, learning), default true
 * @param {boolean} options.useSimpleRegimeMultiplier - Use simple regime multiplier instead of advanced, default false
 * @returns {Object} Calculation result with totalStrength and breakdown
 */
export function calculateUnifiedCombinedStrength(signals, options = {}) {
  // Validate inputs
  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return {
      totalStrength: 0,
      breakdown: {
        baseWeightedStrength: 0,
        correlationAdjustment: 0,
        regimeAdjustment: 0,
        qualityAdjustment: 0,
        synergyBonus: 0,
        learningAdjustment: 0
      },
      qualityScore: 0
    };
  }

  const {
    marketRegime = 'neutral',
    regimeConfidence = 0.5,
    marketContext = {},
    useAdvancedFeatures = true,
    useSimpleRegimeMultiplier = false
  } = options;

  // Step 1: Calculate individual weighted strengths
  const weightedStrengths = signals.map(signal => {
    if (!signal || !signal.type || typeof signal.strength !== 'number') {
      return 0;
    }

    const signalType = signal.type.toLowerCase();
    const baseWeight = SIGNAL_WEIGHTS[signalType] || 1.0;
    const baseStrength = signal.strength || 0;

    if (useSimpleRegimeMultiplier) {
      // Simple regime multiplier (from regimeUtils)
      const regimeMultiplier = getRegimeMultiplier(marketRegime, signalType, signal.category);
      return baseStrength * baseWeight * regimeMultiplier;
    } else {
      // Advanced regime weighting (from SignalWeightCalculator)
      const signalWeightCalculator = getSignalWeightCalculator();
      return signalWeightCalculator.calculateWeightedStrength(signal, marketRegime, regimeConfidence);
    }
  });

  // Step 2: Calculate base weighted strength
  const baseWeightedStrength = weightedStrengths.reduce((sum, strength) => sum + strength, 0);

  // Step 3: Apply correlation penalties and bonuses
  const correlationDetector = getCorrelationDetector();
  
  // Determine context from options or auto-detect
  const context = options.context || (typeof window !== 'undefined' && 
    (window.location?.pathname?.includes('backtest') || 
     window.location?.pathname?.includes('backtesting')) 
    ? 'BACKTEST' 
    : 'SCANNER');
  
  const correlationReport = correlationDetector.getCorrelationReport(signals, context);
  const correlationPenalty = correlationReport.penalty || 0;
  const correlationBonus = correlationReport.bonus || 0;

  // Apply correlation adjustment
  const correlationAdjusted = baseWeightedStrength * (1 - correlationPenalty + correlationBonus);
  const correlationAdjustment = correlationAdjusted - baseWeightedStrength;

  // Step 4: Apply regime context bonus (if using advanced features)
  let regimeAdjustment = 0;
  let regimeAdjusted = correlationAdjusted;

  if (!useSimpleRegimeMultiplier) {
    const regimeContextWeighting = getRegimeContextWeighting();
    const regimeContextBonus = regimeContextWeighting.calculateRegimeContextBonus(
      signals,
      marketRegime,
      regimeConfidence
    ) || 0;

    regimeAdjusted = correlationAdjusted * (1 + regimeContextBonus);
    regimeAdjustment = regimeAdjusted - correlationAdjusted;
  }

  // Step 5: Apply quality adjustments (if using advanced features)
  let qualityAdjustment = 0;
  let qualityAdjusted = regimeAdjusted;
  let averageQualityScore = 0.85; // Default quality score

  if (useAdvancedFeatures) {
    const qualityScores = signals.map(signal => calculateSignalQuality(signal.strength || 0));
    averageQualityScore = qualityScores.reduce((sum, q) => sum + q, 0) / qualityScores.length;
    const qualityMultiplier = 0.5 + (averageQualityScore * 0.5); // Scale from 0.5 to 1.0
    qualityAdjusted = regimeAdjusted * qualityMultiplier;
    qualityAdjustment = qualityAdjusted - regimeAdjusted;
  }

  // Step 6: Apply synergy bonuses (if using advanced features)
  let synergyBonus = 0;
  let synergyAdjusted = qualityAdjusted;

  if (useAdvancedFeatures) {
    const synergyBonusMultiplier = calculateSynergyBonus(signals);
    const diversityBonusMultiplier = calculateDiversityBonus(signals);
    const totalSynergyMultiplier = 1 + synergyBonusMultiplier + diversityBonusMultiplier;
    
    synergyAdjusted = qualityAdjusted * totalSynergyMultiplier;
    synergyBonus = synergyAdjusted - qualityAdjusted;
  }

  // Step 7: Apply learning adjustments (if using advanced features and marketContext)
  // For now, we'll skip learning adjustments as they require historical data
  // This can be added later if needed
  let learningAdjustment = 0;
  const finalStrength = synergyAdjusted + learningAdjustment;

  return {
    totalStrength: Math.max(0, finalStrength),
    breakdown: {
      baseWeightedStrength: baseWeightedStrength,
      correlationAdjustment: correlationAdjustment,
      regimeAdjustment: regimeAdjustment,
      qualityAdjustment: qualityAdjustment,
      synergyBonus: synergyBonus,
      learningAdjustment: learningAdjustment
    },
    qualityScore: averageQualityScore,
    correlationReport: correlationReport
  };
}

// Export getter for external use
export { getRegimeContextWeighting };

/**
 * Initialize historical performance from existing trades
 * Call this on app startup to load historical data
 */
export async function initializeHistoricalPerformanceFromTrades() {
  try {
    // Import Trade entity to fetch trades
    const { Trade } = await import('@/api/entities');
    
    // Fetch all completed trades (with exit_timestamp)
    const trades = await Trade.filter({
      exit_timestamp: { $ne: null }
    }, '-exit_timestamp', 10000); // Get up to 10,000 most recent trades
    
    if (!trades || trades.length === 0) {
      console.log('[UNIFIED_CALCULATOR] No completed trades found for historical performance');
      return;
    }

    // Get regime context weighting instance
    const regimeWeighting = getRegimeContextWeighting();
    
    // Load historical performance
    regimeWeighting.loadHistoricalPerformanceFromTrades(trades);
    
    console.log(`[UNIFIED_CALCULATOR] ✅ Historical performance initialized from ${trades.length} trades`);
  } catch (error) {
    console.error('[UNIFIED_CALCULATOR] Failed to initialize historical performance:', error);
    // Don't throw - allow app to continue without historical data
  }
}


