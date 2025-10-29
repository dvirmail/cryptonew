/**
 * RegimeContextWeighting.test.jsx
 * 
 * Test file for Step 3: Market Regime Context Weighting
 * Tests regime-specific signal effectiveness and context bonuses
 */

import RegimeContextWeighting from './RegimeContextWeighting.jsx';

// Test Step 3: Market Regime Context Weighting
console.log('🧪 Testing Step 3: Market Regime Context Weighting');

const regimeWeighting = new RegimeContextWeighting();

// Test 1: Regime-specific signal effectiveness
console.log('\n📊 Test 1: Regime-specific signal effectiveness');

const testSignals = [
  { type: 'MACD Cross', strength: 70 },
  { type: 'RSI Oversold', strength: 60 },
  { type: 'Volume Breakout', strength: 80 },
  { type: 'Bollinger Bounce', strength: 50 }
];

const regimes = ['uptrend', 'downtrend', 'ranging', 'unknown'];

regimes.forEach(regime => {
  console.log(`\n🔍 Testing regime: ${regime}`);
  
  testSignals.forEach(signal => {
    const effectiveness = regimeWeighting.getRegimeEffectiveness(signal.type, regime);
    console.log(`  ${signal.type}: ${effectiveness.toFixed(2)}x effectiveness`);
  });
});

// Test 2: Regime context bonus calculation
console.log('\n📈 Test 2: Regime context bonus calculation');

const testSignalCombination = [
  { type: 'MACD Cross', strength: 70 },
  { type: 'Volume Breakout', strength: 80 },
  { type: 'RSI Oversold', strength: 60 }
];

regimes.forEach(regime => {
  const contextBonus = regimeWeighting.calculateRegimeContextBonus(
    testSignalCombination, 
    regime, 
    0.8 // High confidence
  );
  console.log(`${regime} regime context bonus: ${(contextBonus * 100).toFixed(1)}%`);
});

// Test 3: Regime diversity bonus
console.log('\n🌐 Test 3: Regime diversity bonus');

const diverseSignals = [
  { type: 'MACD Cross', strength: 70 },
  { type: 'Bollinger Bounce', strength: 50 },
  { type: 'Support Bounce', strength: 60 }
];

const diversityBonus = regimeWeighting.calculateRegimeDiversityBonus(diverseSignals);
console.log(`Regime diversity bonus: ${(diversityBonus * 100).toFixed(1)}%`);

// Test 4: Regime recommendations
console.log('\n💡 Test 4: Regime recommendations');

regimes.forEach(regime => {
  const recommendations = regimeWeighting.getRegimeRecommendations(regime);
  console.log(`\n${regime.toUpperCase()} regime recommendations:`);
  recommendations.forEach((rec, index) => {
    console.log(`  ${index + 1}. ${rec.signalType}: ${rec.weight.toFixed(2)}x effectiveness`);
  });
});

// Test 5: Performance tracking
console.log('\n📊 Test 5: Performance tracking');

// Simulate some performance updates
regimeWeighting.updateHistoricalPerformance('uptrend', true);
regimeWeighting.updateHistoricalPerformance('uptrend', true);
regimeWeighting.updateHistoricalPerformance('uptrend', false);
regimeWeighting.updateHistoricalPerformance('downtrend', true);
regimeWeighting.updateHistoricalPerformance('downtrend', false);

console.log('Historical performance after updates:');
Object.entries(regimeWeighting.historicalPerformance).forEach(([regime, perf]) => {
  console.log(`  ${regime}: ${perf.successfulSignals}/${perf.totalSignals} (${(perf.performance * 100).toFixed(1)}%)`);
});

console.log('\n✅ Step 3: Market Regime Context Weighting tests completed!');
console.log('🎯 Key Features Tested:');
console.log('  ✓ Regime-specific signal effectiveness weights');
console.log('  ✓ Regime context bonus calculation');
console.log('  ✓ Regime diversity bonus');
console.log('  ✓ Regime recommendations');
console.log('  ✓ Historical performance tracking');
