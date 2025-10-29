/**
 * Advanced Calculator Test Runner
 * Run this in the browser console to test the calculator
 */

// Import the test strategy
import { COMPREHENSIVE_TEST_STRATEGY, runComprehensiveCalculatorTest, testIndividualSignalValidation } from './ComprehensiveTestStrategy.jsx';

/**
 * Quick test function for browser console
 */
function quickCalculatorTest() {
  console.log('🚀 [QUICK_TEST] Starting Advanced Calculator quick test...');
  
  // Reset logging flag
  if (typeof window !== 'undefined') {
    window._advancedCalculatorLoggedFirstStrategy = false;
  }
  
  // Test with a simple signal set
  const testSignals = [
    { type: "macd", strength: 85 },
    { type: "rsi", strength: 70 },
    { type: "ema", strength: 60 },
    { type: "bollinger", strength: 65 }
  ];
  
  console.log('📊 [QUICK_TEST] Test signals:', testSignals);
  console.log('📊 [QUICK_TEST] Market regime: uptrend');
  console.log('📊 [QUICK_TEST] Regime confidence: 0.8');
  console.log('📊 [QUICK_TEST] Market context: { marketVolatility: 0.005, trendStrength: 0.002, volumeProfile: 0.5 }');
  
  console.log('✅ [QUICK_TEST] Test data prepared. Run a backtest to see the calculator in action!');
  return testSignals;
}

/**
 * Test all signal types individually
 */
function testAllSignalTypes() {
  console.log('🧪 [SIGNAL_TYPES_TEST] Testing all signal types...');
  
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
  
  console.log('📊 [SIGNAL_TYPES_TEST] Generated test signals for all types:', testSignals);
  console.log('📊 [SIGNAL_TYPES_TEST] Total signal types:', testSignals.length);
  
  return testSignals;
}

/**
 * Create a test strategy with all signals
 */
function createTestStrategyWithAllSignals() {
  console.log('🏗️ [TEST_STRATEGY] Creating test strategy with all signal types...');
  
  const allSignals = testAllSignalTypes();
  
  const testStrategy = {
    name: "All Signals Test Strategy",
    description: "Test strategy containing all available signal types",
    coin: "BTCUSDT",
    timeframe: "15m",
    signals: allSignals,
    minCombinedStrength: 50,
    requiredSignals: 5,
    maxSignals: allSignals.length
  };
  
  console.log('📋 [TEST_STRATEGY] Test strategy created:', testStrategy);
  console.log('📋 [TEST_STRATEGY] Strategy contains', testStrategy.signals.length, 'signals');
  
  return testStrategy;
}

// Export functions for global access
if (typeof window !== 'undefined') {
  window.quickCalculatorTest = quickCalculatorTest;
  window.testAllSignalTypes = testAllSignalTypes;
  window.createTestStrategyWithAllSignals = createTestStrategyWithAllSignals;
  
  console.log('🧪 [TEST_RUNNER] Test functions loaded! Available functions:');
  console.log('   - quickCalculatorTest()');
  console.log('   - testAllSignalTypes()');
  console.log('   - createTestStrategyWithAllSignals()');
  console.log('   - runComprehensiveCalculatorTest()');
  console.log('   - testIndividualSignalValidation()');
}
