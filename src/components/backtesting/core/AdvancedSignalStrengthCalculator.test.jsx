/**
 * Test file for AdvancedSignalStrengthCalculator
 * Tests the comprehensive scoring system with all improvements
 */

import { AdvancedSignalStrengthCalculator } from './AdvancedSignalStrengthCalculator.jsx';

describe('AdvancedSignalStrengthCalculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new AdvancedSignalStrengthCalculator();
  });

  describe('calculateAdvancedCombinedStrength', () => {
    it('should return zero strength for empty signals array', () => {
      const result = calculator.calculateAdvancedCombinedStrength([]);
      
      expect(result.totalStrength).toBe(0);
      expect(result.breakdown).toEqual({});
      expect(result.qualityScore).toBe(0);
      expect(result.recommendations).toEqual([]);
    });

    it('should calculate strength for single signal', () => {
      const signals = [
        {
          type: 'macd_cross',
          strength: 50,
          direction: 'long'
        }
      ];

      const result = calculator.calculateAdvancedCombinedStrength(signals, 'uptrend', 0.8);
      
      expect(result.totalStrength).toBeGreaterThan(0);
      expect(result.breakdown).toHaveProperty('baseWeightedStrength');
      expect(result.breakdown).toHaveProperty('correlationAdjustment');
      expect(result.breakdown).toHaveProperty('regimeAdjustment');
      expect(result.breakdown).toHaveProperty('qualityAdjustment');
      expect(result.breakdown).toHaveProperty('synergyBonus');
      expect(result.breakdown).toHaveProperty('learningAdjustment');
    });

    it('should calculate strength for multiple signals', () => {
      const signals = [
        {
          type: 'macd_cross',
          strength: 50,
          direction: 'long'
        },
        {
          type: 'rsi_oversold',
          strength: 40,
          direction: 'long'
        },
        {
          type: 'volume_breakout',
          strength: 60,
          direction: 'long'
        }
      ];

      const result = calculator.calculateAdvancedCombinedStrength(signals, 'uptrend', 0.8);
      
      expect(result.totalStrength).toBeGreaterThan(0);
      expect(result.signalAnalysis).toHaveProperty('correlation');
      expect(result.signalAnalysis).toHaveProperty('regime');
      expect(result.signalAnalysis).toHaveProperty('quality');
    });

    it('should generate recommendations for low quality signals', () => {
      const signals = [
        {
          type: 'low_quality_signal',
          strength: 10,
          direction: 'long'
        }
      ];

      const result = calculator.calculateAdvancedCombinedStrength(signals, 'uptrend', 0.8);
      
      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('calculateSignalQuality', () => {
    it('should calculate quality score for signal', () => {
      const signal = {
        type: 'macd_cross',
        strength: 50
      };

      const quality = calculator.calculateSignalQuality(signal, {});
      
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });

    it('should return default quality for unknown signal type', () => {
      const signal = {
        type: 'unknown_signal',
        strength: 30
      };

      const quality = calculator.calculateSignalQuality(signal, {});
      
      expect(quality).toBe(0.5); // Default medium quality
    });
  });

  describe('calculateAdvancedSynergyBonuses', () => {
    it('should calculate synergy bonuses for complementary signals', () => {
      const signals = [
        {
          type: 'macd_cross',
          strength: 50,
          direction: 'long'
        },
        {
          type: 'rsi_oversold',
          strength: 40,
          direction: 'long'
        }
      ];

      const bonuses = calculator.calculateAdvancedSynergyBonuses(signals, 'uptrend');
      
      expect(bonuses).toHaveProperty('complementary');
      expect(bonuses).toHaveProperty('diverse');
      expect(bonuses).toHaveProperty('regimeAligned');
      expect(bonuses).toHaveProperty('total');
      expect(bonuses.total).toBeGreaterThanOrEqual(0);
    });

    it('should calculate diversity bonus for different signal types', () => {
      const signals = [
        { type: 'macd_cross', strength: 50 },
        { type: 'rsi_oversold', strength: 40 },
        { type: 'volume_breakout', strength: 60 }
      ];

      const bonuses = calculator.calculateAdvancedSynergyBonuses(signals, 'uptrend');
      
      expect(bonuses.diverse).toBeGreaterThan(0);
    });
  });

  describe('applyPerformanceLearning', () => {
    it('should apply learning adjustments for known signal types', () => {
      const signals = [
        {
          type: 'macd_cross',
          strength: 50,
          direction: 'long'
        }
      ];

      const adjustments = calculator.applyPerformanceLearning(signals, 'uptrend');
      
      expect(adjustments).toHaveProperty('signalTypeAdjustments');
      expect(adjustments).toHaveProperty('regimeAdjustments');
      expect(adjustments).toHaveProperty('totalAdjustment');
    });
  });

  describe('generateRecommendations', () => {
    it('should generate recommendations for high correlation', () => {
      const signals = [
        { type: 'macd_cross', strength: 50 },
        { type: 'macd_cross', strength: 45 } // Same type - high correlation
      ];

      const correlationAnalysis = { penalty: 0.2 };
      const regimeAnalysis = { confidence: 0.8, multiplier: 1.0 };
      const qualityScores = [0.8, 0.8];
      const finalStrength = { total: 150 };

      const recommendations = calculator.generateRecommendations(
        signals,
        correlationAnalysis,
        regimeAnalysis,
        qualityScores,
        finalStrength
      );
      
      expect(recommendations).toBeInstanceOf(Array);
      expect(recommendations.some(rec => rec.type === 'correlation')).toBe(true);
    });

    it('should generate recommendations for low regime confidence', () => {
      const signals = [{ type: 'macd_cross', strength: 50 }];
      const correlationAnalysis = { penalty: 0.05 };
      const regimeAnalysis = { confidence: 0.4, multiplier: 0.8 };
      const qualityScores = [0.8];
      const finalStrength = { total: 150 };

      const recommendations = calculator.generateRecommendations(
        signals,
        correlationAnalysis,
        regimeAnalysis,
        qualityScores,
        finalStrength
      );
      
      expect(recommendations.some(rec => rec.type === 'regime')).toBe(true);
    });

    it('should generate recommendations for low strength', () => {
      const signals = [{ type: 'macd_cross', strength: 50 }];
      const correlationAnalysis = { penalty: 0.05 };
      const regimeAnalysis = { confidence: 0.8, multiplier: 1.0 };
      const qualityScores = [0.8];
      const finalStrength = { total: 80 }; // Low strength

      const recommendations = calculator.generateRecommendations(
        signals,
        correlationAnalysis,
        regimeAnalysis,
        qualityScores,
        finalStrength
      );
      
      expect(recommendations.some(rec => rec.type === 'strength')).toBe(true);
    });
  });

  describe('updatePerformanceHistory', () => {
    it('should update performance history for new signal type', () => {
      calculator.updatePerformanceHistory('macd_cross', true, 'uptrend');
      
      const performance = calculator.performanceHistory.get('macd_cross');
      expect(performance).toBeDefined();
      expect(performance.totalCount).toBe(1);
      expect(performance.successCount).toBe(1);
      expect(performance.recentSuccessRate).toBe(1.0);
    });

    it('should update performance history for existing signal type', () => {
      calculator.updatePerformanceHistory('macd_cross', true, 'uptrend');
      calculator.updatePerformanceHistory('macd_cross', false, 'downtrend');
      
      const performance = calculator.performanceHistory.get('macd_cross');
      expect(performance.totalCount).toBe(2);
      expect(performance.successCount).toBe(1);
      expect(performance.recentSuccessRate).toBe(0.5);
    });
  });
});
