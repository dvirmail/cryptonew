/**
 * Correlation Test Script
 * 
 * Run this script in the browser console to test all signal correlations
 * Usage: Copy and paste this entire script into the browser console
 */

// Import the SignalCorrelationDetector
import { SignalCorrelationDetector } from './src/components/backtesting/core/SignalCorrelationDetector.jsx';

// Create correlation detector instance
const correlationDetector = new SignalCorrelationDetector();

// Run comprehensive correlation test
console.log('🚀 Starting Correlation Test...');
console.log('=====================================');

const testResults = correlationDetector.testAllCorrelations();

console.log('\n🎯 Test Complete!');
console.log('=====================================');

// Additional quick tests for common signal combinations
console.log('\n🔍 Quick Tests for Common Signal Types:');

// Test generic signal types (as they appear in actual signal evaluation)
const genericSignalTests = [
  ['RSI', 'stochastic'],
  ['CCI', 'rsi_oversold'],
  ['roc', 'awesomeoscillator'],
  ['cmo', 'mfi'],
  ['volume', 'obv'],
  ['bollinger', 'atr'],
  ['macd', 'ema']
];

genericSignalTests.forEach(([signal1, signal2]) => {
  const correlation = correlationDetector.calculateCorrelation(signal1, signal2);
  console.log(`${signal1} ↔ ${signal2}: ${correlation !== 0 ? correlation.toFixed(3) : 'NO CORRELATION'}`);
});

// Test signal combinations as they would appear in real trading
console.log('\n📊 Real Trading Signal Combination Tests:');

const realSignalCombinations = [
  // High correlation momentum combination
  [
    { type: 'RSI', strength: 75, value: 'Oversold Entry' },
    { type: 'stochastic', strength: 80, value: 'Oversold Entry' },
    { type: 'williamsr', strength: 70, value: 'Oversold Entry' }
  ],
  
  // Mixed momentum combination
  [
    { type: 'RSI', strength: 75, value: 'Oversold Entry' },
    { type: 'CCI', strength: 80, value: 'Oversold State' },
    { type: 'roc', strength: 70, value: 'Strong Upward Momentum' }
  ],
  
  // Cross-category combination (should have low correlation)
  [
    { type: 'RSI', strength: 75, value: 'Oversold Entry' },
    { type: 'volume', strength: 60, value: 'High Volume' },
    { type: 'bollinger', strength: 65, value: 'Lower Touch' }
  ]
];

realSignalCombinations.forEach((signals, index) => {
  console.log(`\nCombination ${index + 1}:`);
  signals.forEach(signal => {
    console.log(`  ${signal.type}: ${signal.value} (${signal.strength})`);
  });
  
  const report = correlationDetector.getCorrelationReport(signals);
  console.log(`  Correlations: ${report.correlationCount}`);
  console.log(`  Penalty: ${(report.penalty * 100).toFixed(1)}%`);
  console.log(`  Bonus: ${(report.bonus * 100).toFixed(1)}%`);
  console.log(`  Diversity: ${report.diversityScore.toFixed(3)}`);
  
  if (report.correlations.length > 0) {
    report.correlations.forEach(corr => {
      console.log(`    ${corr.signal1} ↔ ${corr.signal2}: ${corr.correlation.toFixed(3)}`);
    });
  }
});

console.log('\n✅ All correlation tests completed!');
console.log('Check the results above for any missing correlations or unexpected values.');
