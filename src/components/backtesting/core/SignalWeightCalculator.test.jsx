/**
 * Signal Weight Calculator Tests
 * 
 * Tests for the new signal weight calculation system
 */

import SignalWeightCalculator from './SignalWeightCalculator';

describe('SignalWeightCalculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new SignalWeightCalculator();
  });

  describe('Signal Importance Weighting', () => {
    test('should assign higher weights to important signals', () => {
      const macdSignal = { type: 'macd_cross', strength: 70 };
      const volumeSignal = { type: 'volume_spike', strength: 70 };
      
      const macdWeight = calculator.calculateWeightedStrength(macdSignal);
      const volumeWeight = calculator.calculateWeightedStrength(volumeSignal);
      
      // MACD cross should have higher weight than volume spike
      expect(macdWeight).toBeGreaterThan(volumeWeight);
    });

    test('should handle unknown signal types with default weight', () => {
      const unknownSignal = { type: 'unknown_signal', strength: 50 };
      const weight = calculator.calculateWeightedStrength(unknownSignal);
      
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBe(50); // Should use default weight of 1.0
    });
  });

  describe('Market Regime Context', () => {
    test('should apply regime-specific weights', () => {
      const rsiSignal = { type: 'rsi_oversold', strength: 60 };
      
      const uptrendWeight = calculator.calculateWeightedStrength(rsiSignal, 'uptrend', 0.8);
      const downtrendWeight = calculator.calculateWeightedStrength(rsiSignal, 'downtrend', 0.8);
      
      // RSI oversold should be more important in uptrend
      expect(uptrendWeight).toBeGreaterThan(downtrendWeight);
    });

    test('should apply regime confidence adjustment', () => {
      const signal = { type: 'macd_cross', strength: 70 };
      
      const highConfidence = calculator.calculateWeightedStrength(signal, 'uptrend', 0.9);
      const lowConfidence = calculator.calculateWeightedStrength(signal, 'uptrend', 0.3);
      
      // Higher confidence should result in higher weighted strength
      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });
  });

  describe('Signal Quality Assessment', () => {
    test('should apply quality-based weights', () => {
      const excellentSignal = { type: 'macd_cross', strength: 85 };
      const poorSignal = { type: 'macd_cross', strength: 15 };
      
      const excellentWeight = calculator.calculateWeightedStrength(excellentSignal);
      const poorWeight = calculator.calculateWeightedStrength(poorSignal);
      
      // Excellent quality should have higher weight
      expect(excellentWeight).toBeGreaterThan(poorWeight);
    });
  });

  describe('Combined Strength Calculation', () => {
    test('should calculate combined strength with synergy bonus', () => {
      const signals = [
        { type: 'macd_cross', strength: 70 },
        { type: 'ema_cross', strength: 65 }
      ];
      
      const combinedStrength = calculator.calculateCombinedStrength(signals, 'uptrend', 0.8);
      
      // Should be greater than simple sum due to synergy bonus
      const simpleSum = signals.reduce((sum, s) => sum + s.strength, 0);
      expect(combinedStrength).toBeGreaterThan(simpleSum);
    });

    test('should apply diversity bonus for different signal types', () => {
      const diverseSignals = [
        { type: 'macd_cross', strength: 70 },
        { type: 'rsi_oversold', strength: 60 },
        { type: 'volume_spike', strength: 55 }
      ];
      
      const redundantSignals = [
        { type: 'rsi_oversold', strength: 70 },
        { type: 'stochastic_oversold', strength: 60 },
        { type: 'williams_r', strength: 55 }
      ];
      
      const diverseStrength = calculator.calculateCombinedStrength(diverseSignals, 'uptrend', 0.8);
      const redundantStrength = calculator.calculateCombinedStrength(redundantSignals, 'uptrend', 0.8);
      
      // Diverse signals should have higher combined strength
      expect(diverseStrength).toBeGreaterThan(redundantStrength);
    });
  });

  describe('Signal Importance Ranking', () => {
    test('should rank signals by importance', () => {
      const signals = [
        { type: 'volume_spike', strength: 80 },
        { type: 'macd_divergence', strength: 60 },
        { type: 'rsi_oversold', strength: 70 }
      ];
      
      const rankedSignals = calculator.getSignalImportanceRanking(signals);
      
      // MACD divergence should be ranked highest (most important)
      expect(rankedSignals[0].type).toBe('macd_divergence');
      expect(rankedSignals[0].importance).toBeGreaterThan(rankedSignals[1].importance);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty signal array', () => {
      const combinedStrength = calculator.calculateCombinedStrength([], 'uptrend', 0.8);
      expect(combinedStrength).toBe(0);
    });

    test('should handle signals without type', () => {
      const invalidSignal = { strength: 50 };
      const weight = calculator.calculateWeightedStrength(invalidSignal);
      expect(weight).toBe(0);
    });

    test('should handle signals without strength', () => {
      const signal = { type: 'macd_cross' };
      const weight = calculator.calculateWeightedStrength(signal);
      expect(weight).toBe(0);
    });
  });
});

export default SignalWeightCalculator;
