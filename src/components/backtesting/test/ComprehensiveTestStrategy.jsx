/**
 * Comprehensive Test Strategy for Advanced Calculator Validation
 * This strategy includes ALL available signal types to test the calculator thoroughly
 */

export const COMPREHENSIVE_TEST_STRATEGY = {
  name: "Comprehensive Test Strategy - All Signals",
  description: "Test strategy containing all available signal types to validate Advanced Calculator",
  coin: "BTCUSDT",
  timeframe: "15m",
  
  // Include ALL signal types with various strength values
  signals: [
    // Core Signals (High weights)
    { type: "macd", strength: 85, condition: "above_signal" },
    { type: "rsi", strength: 70, condition: "oversold" },
    { type: "ichimoku", strength: 80, condition: "bullish" },
    { type: "stochastic", strength: 75, condition: "oversold" },
    { type: "ema", strength: 60, condition: "above" },
    { type: "bollinger", strength: 65, condition: "lower_touch" },
    { type: "ma200", strength: 55, condition: "above" },
    { type: "atr", strength: 50, condition: "high_volatility" },
    
    // Important Signals (Medium weights)
    { type: "psar", strength: 45, condition: "bullish" },
    { type: "williamsr", strength: 40, condition: "oversold" },
    { type: "mfi", strength: 35, condition: "oversold" },
    { type: "adx", strength: 30, condition: "strong_trend" },
    { type: "tema", strength: 25, condition: "above" },
    { type: "dema", strength: 20, condition: "above" },
    { type: "hma", strength: 15, condition: "above" },
    { type: "wma", strength: 10, condition: "above" },
    { type: "cci", strength: 5, condition: "oversold" },
    { type: "roc", strength: 0, condition: "positive" },
    { type: "awesomeoscillator", strength: 90, condition: "positive" },
    { type: "cmo", strength: 95, condition: "positive" },
    { type: "obv", strength: 100, condition: "increasing" },
    { type: "cmf", strength: 85, condition: "positive" },
    { type: "adline", strength: 80, condition: "increasing" },
    
    // Confirmation Signals (Lower weights)
    { type: "bbw", strength: 75, condition: "narrow" },
    { type: "ttm_squeeze", strength: 70, condition: "squeeze" },
    { type: "candlestick", strength: 65, condition: "bullish" },
    { type: "keltner", strength: 60, condition: "upper_touch" },
    { type: "donchian", strength: 55, condition: "breakout" },
    { type: "chartpattern", strength: 50, condition: "bullish" },
    { type: "pivot", strength: 45, condition: "above" },
    { type: "fibonacci", strength: 40, condition: "retracement" },
    { type: "supportresistance", strength: 35, condition: "breakout" },
    { type: "maribbon", strength: 30, condition: "bullish" },
    
    // Volume Signals
    { type: "volume", strength: 25, condition: "high" }
  ],
  
  // Test different market regimes
  marketRegimes: ["uptrend", "downtrend", "sideways", "unknown"],
  
  // Test different confidence levels
  regimeConfidences: [0.1, 0.3, 0.5, 0.7, 0.9],
  
  // Test different market contexts
  marketContexts: [
    { marketVolatility: 0.001, trendStrength: 0.0005, volumeProfile: 0.3 },
    { marketVolatility: 0.005, trendStrength: 0.002, volumeProfile: 0.5 },
    { marketVolatility: 0.01, trendStrength: 0.005, volumeProfile: 0.8 },
    { marketVolatility: 0.02, trendStrength: 0.01, volumeProfile: 1.0 }
  ]
};

/**
 * Test function to run comprehensive calculator validation
 */
export function runComprehensiveCalculatorTest() {
  console.log('🧪 [COMPREHENSIVE_TEST] Starting Advanced Calculator validation...');
  
  // Reset the global logging flag to see detailed calculations
  if (typeof window !== 'undefined') {
    window._advancedCalculatorLoggedFirstStrategy = false;
  }
  
  // Import the calculator
  const { AdvancedSignalStrengthCalculator } = require('../core/AdvancedSignalStrengthCalculator.jsx');
  const calculator = new AdvancedSignalStrengthCalculator();
  
  const testResults = [];
  
  // Test all combinations
  COMPREHENSIVE_TEST_STRATEGY.marketRegimes.forEach(regime => {
    COMPREHENSIVE_TEST_STRATEGY.regimeConfidences.forEach(confidence => {
      COMPREHENSIVE_TEST_STRATEGY.marketContexts.forEach(context => {
        console.log(`🧪 [COMPREHENSIVE_TEST] Testing regime: ${regime}, confidence: ${confidence}, context:`, context);
        
        try {
          const result = calculator.calculateAdvancedCombinedStrength(
            COMPREHENSIVE_TEST_STRATEGY.signals,
            regime,
            confidence,
            context
          );
          
          testResults.push({
            regime,
            confidence,
            context,
            result,
            success: true
          });
          
          console.log(`✅ [COMPREHENSIVE_TEST] Test passed - Total strength: ${result.totalStrength}`);
          
        } catch (error) {
          console.error(`❌ [COMPREHENSIVE_TEST] Test failed:`, error);
          testResults.push({
            regime,
            confidence,
            context,
            error: error.message,
            success: false
          });
        }
      });
    });
  });
  
  // Summary
  const successCount = testResults.filter(r => r.success).length;
  const totalCount = testResults.length;
  
  console.log(`🧪 [COMPREHENSIVE_TEST] Test Summary:`);
  console.log(`   Total tests: ${totalCount}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${totalCount - successCount}`);
  console.log(`   Success rate: ${((successCount / totalCount) * 100).toFixed(2)}%`);
  
  // Log failed tests
  const failedTests = testResults.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.error(`❌ [COMPREHENSIVE_TEST] Failed tests:`, failedTests);
  }
  
  return testResults;
}

/**
 * Test individual signal validation
 */
export function testIndividualSignalValidation() {
  console.log('🧪 [SIGNAL_VALIDATION_TEST] Testing individual signal validation...');
  
  const { AdvancedSignalStrengthCalculator } = require('../core/AdvancedSignalStrengthCalculator.jsx');
  const calculator = new AdvancedSignalStrengthCalculator();
  
  // Test invalid signals
  const invalidSignals = [
    null,
    undefined,
    [],
    [{ type: null, strength: 50 }],
    [{ type: "macd", strength: null }],
    [{ type: "macd", strength: undefined }],
    [{ type: "macd", strength: "invalid" }],
    [{ type: "macd", strength: -10 }],
    [{ type: "macd", strength: 150 }],
    [{ type: "macd", strength: NaN }]
  ];
  
  invalidSignals.forEach((signals, index) => {
    console.log(`🧪 [SIGNAL_VALIDATION_TEST] Testing invalid signal set ${index + 1}:`, signals);
    
    try {
      const result = calculator.calculateAdvancedCombinedStrength(signals, "uptrend", 0.8, {});
      console.log(`   Result:`, result);
    } catch (error) {
      console.log(`   Expected error caught:`, error.message);
    }
  });
}

// Export for global access
if (typeof window !== 'undefined') {
  window.runComprehensiveCalculatorTest = runComprehensiveCalculatorTest;
  window.testIndividualSignalValidation = testIndividualSignalValidation;
  window.COMPREHENSIVE_TEST_STRATEGY = COMPREHENSIVE_TEST_STRATEGY;
}
