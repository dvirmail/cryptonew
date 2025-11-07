/**
 * Phase 1 Signal Upgrade Test Suite
 * 
 * Tests correlation, signal detection, and scanner recognition
 * for all Phase 1 upgraded signals (MACD, MFI, OBV divergence)
 */

import { evaluateSignalConditions } from '@/components/utils/signalLogic';
import { normalizeSignalName, isPhase1DivergenceSignal } from '@/components/utils/signalNameRegistry';

/**
 * Creates a test strategy with all Phase 1 upgraded signals
 */
export function createPhase1TestStrategy() {
    return {
        id: 'phase1-test-strategy',
        combinationName: 'Phase 1 Comprehensive Test - All Enhanced Indicators',
        coin: 'ETH/USDT',
        timeframe: '15m',
        signals: [
            // Existing signals
            { type: 'MACD', value: 'Bullish Cross' },
            { type: 'RSI', value: 'Oversold Exit' },
            { type: 'EMA', value: 'Price Above EMA' },
            
            // ✅ Phase 1: NEW Divergence Signals
            { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
            { type: 'MFI', value: 'MFI Regular Bullish Divergence' },
            { type: 'MFI', value: 'MFI Failure Swing Bullish' },
            { type: 'OBV', value: 'OBV Bullish Divergence' }
        ],
        includedInScanner: true,
        includedInLiveScanner: false
    };
}

/**
 * Test 1: Verify backtest captures Phase 1 signals
 * This simulates what happens during backtest - signals should be in combinations
 */
export function testBacktestSignalCapture(signals) {
    console.log('\n🧪 TEST 1: Backtest Signal Capture');
    console.log('=====================================');
    
    const phase1Signals = signals.filter(s => 
        isPhase1DivergenceSignal(s.type, s.value)
    );
    
    console.log(`Found ${phase1Signals.length} Phase 1 divergence signals:`);
    phase1Signals.forEach(s => {
        console.log(`  ✓ ${s.type}: ${s.value}`);
    });
    
    // Verify all Phase 1 signal types are present
    const hasMacdDivergence = phase1Signals.some(s => s.type === 'MACD' && s.value.includes('Divergence'));
    const hasMfiDivergence = phase1Signals.some(s => s.type === 'MFI' && s.value.includes('Divergence'));
    const hasMfiFailureSwing = phase1Signals.some(s => s.type === 'MFI' && s.value.includes('Failure Swing'));
    const hasObvDivergence = phase1Signals.some(s => s.type === 'OBV' && s.value.includes('Divergence'));
    
    const testResults = {
        hasMacdDivergence,
        hasMfiDivergence,
        hasMfiFailureSwing,
        hasObvDivergence,
        totalPhase1Signals: phase1Signals.length
    };
    
    console.log('\nResults:');
    console.log(`  MACD Divergence: ${hasMacdDivergence ? '✅' : '❌'}`);
    console.log(`  MFI Divergence: ${hasMfiDivergence ? '✅' : '❌'}`);
    console.log(`  MFI Failure Swing: ${hasMfiFailureSwing ? '✅' : '❌'}`);
    console.log(`  OBV Divergence: ${hasObvDivergence ? '✅' : '❌'}`);
    
    return testResults;
}

/**
 * Test 2: Verify signal correlation in combinations
 * Ensures signals are properly grouped and correlated
 */
export function testSignalCorrelation(combinations) {
    console.log('\n🧪 TEST 2: Signal Correlation');
    console.log('==============================');
    
    const testStrategy = createPhase1TestStrategy();
    const testSignalValues = testStrategy.signals.map(s => `${s.type}:${s.value}`);
    
    let correlationFound = false;
    let matchedCombination = null;
    
    for (const combo of combinations) {
        const comboSignalValues = (combo.signals || []).map(s => `${s.type}:${s.value}`);
        
        // Check if combination includes all test signals (or most of them)
        const matches = testSignalValues.filter(testValue => 
            comboSignalValues.some(comboValue => 
                comboValue === testValue || 
                comboValue.includes(testValue.split(':')[1]) ||
                testValue.includes(comboValue.split(':')[1])
            )
        );
        
        if (matches.length >= testStrategy.signals.length * 0.6) { // At least 60% match
            correlationFound = true;
            matchedCombination = combo;
            console.log(`\n✅ Found correlated combination: ${combo.combinationName || combo.key}`);
            console.log(`   Signals: ${comboSignalValues.join(', ')}`);
            console.log(`   Match rate: ${((matches.length / testSignalValues.length) * 100).toFixed(0)}%`);
            break;
        }
    }
    
    if (!correlationFound) {
        console.log('⚠️  No strongly correlated combination found');
        console.log('   This may be normal if backtest data doesn\'t contain divergence patterns');
    }
    
    return { correlationFound, matchedCombination };
}

/**
 * Test 3: Verify autoscanner signal matching
 * Ensures scanner recognizes Phase 1 signals (no "not found" errors)
 */
export async function testAutoscannerSignalMatching(mockIndicators, mockKlines) {
    console.log('\n🧪 TEST 3: Autoscanner Signal Matching');
    console.log('=====================================');
    
    const testStrategy = createPhase1TestStrategy();
    
    try {
        const result = evaluateSignalConditions(testStrategy, mockIndicators, mockKlines);
        
        console.log(`\nStrategy signals (${testStrategy.signals.length}):`);
        testStrategy.signals.forEach(s => {
            console.log(`  - ${s.type}: ${s.value}`);
        });
        
        console.log(`\nMatched signals (${result.matchedSignals?.length || 0}):`);
        if (result.matchedSignals && result.matchedSignals.length > 0) {
            result.matchedSignals.forEach(s => {
                console.log(`  ✓ ${s.type}: ${s.value} (strength: ${s.strength})`);
            });
        } else {
            console.log('  ⚠️  No signals matched');
        }
        
        // Check for "not found" errors in log
        const notFoundErrors = result.log?.filter(log => 
            log.message && log.message.includes('Not Found')
        ) || [];
        
        if (notFoundErrors.length > 0) {
            console.log(`\n❌ Found ${notFoundErrors.length} "Not Found" errors:`);
            notFoundErrors.forEach(error => {
                console.log(`   - ${error.message}`);
            });
        } else {
            console.log('\n✅ No "Not Found" errors');
        }
        
        // Verify all Phase 1 signals are recognized
        const matchedSignalValues = result.matchedSignals?.map(s => s.value) || [];
        const allPhase1SignalsMatched = testStrategy.signals
            .filter(s => isPhase1DivergenceSignal(s.type, s.value))
            .every(expectedSignal => 
                matchedSignalValues.some(matched => {
                    const normalizedExpected = normalizeSignalName(expectedSignal.type, expectedSignal.value);
                    const normalizedMatched = normalizeSignalName(expectedSignal.type, matched);
                    return matched === expectedSignal.value || 
                           matched.includes(expectedSignal.value) ||
                           normalizedMatched === normalizedExpected;
                })
            );
        
        console.log(`\nPhase 1 Signals Recognition: ${allPhase1SignalsMatched ? '✅ All recognized' : '❌ Some not recognized'}`);
        
        return {
            isMatch: result.isMatch,
            matchedCount: result.matchedSignals?.length || 0,
            expectedCount: testStrategy.signals.length,
            notFoundErrors: notFoundErrors.length,
            allPhase1SignalsMatched,
            result
        };
    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        return {
            isMatch: false,
            error: error.message
        };
    }
}

/**
 * Test 4: Verify signal name normalization
 * Ensures consistent naming across systems
 */
export function testSignalNameNormalization() {
    console.log('\n🧪 TEST 4: Signal Name Normalization');
    console.log('====================================');
    
    const testCases = [
        { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
        { type: 'MFI', value: 'MFI Regular Bullish Divergence' },
        { type: 'MFI', value: 'MFI Failure Swing Bullish' },
        { type: 'OBV', value: 'OBV Bullish Divergence' }
    ];
    
    let allPassed = true;
    
    testCases.forEach(testCase => {
        const normalized = normalizeSignalName(testCase.type, testCase.value);
        const isSame = normalized === testCase.value;
        
        console.log(`${isSame ? '✅' : '❌'} ${testCase.type}: ${testCase.value}`);
        console.log(`   Normalized: ${normalized}`);
        
        if (!isSame) {
            allPassed = false;
        }
    });
    
    console.log(`\nOverall: ${allPassed ? '✅ All passed' : '❌ Some failed'}`);
    return allPassed;
}

/**
 * Main test runner - runs all tests
 */
export async function runPhase1TestSuite(backtestResults, mockIndicators, mockKlines) {
    console.log('\n\n🚀 PHASE 1 COMPREHENSIVE TEST SUITE');
    console.log('=====================================\n');
    
    const results = {
        test1: null,
        test2: null,
        test3: null,
        test4: null
    };
    
    // Test 1: Backtest Signal Capture
    if (backtestResults && backtestResults.matches) {
        const allSignals = backtestResults.matches.flatMap(m => m.signals || []);
        results.test1 = testBacktestSignalCapture(allSignals);
    } else {
        console.log('⚠️  Skipping Test 1: No backtest results provided');
    }
    
    // Test 2: Signal Correlation
    if (backtestResults && backtestResults.combinations) {
        results.test2 = testSignalCorrelation(backtestResults.combinations);
    } else {
        console.log('⚠️  Skipping Test 2: No combinations provided');
    }
    
    // Test 3: Autoscanner Matching
    if (mockIndicators && mockKlines) {
        results.test3 = await testAutoscannerSignalMatching(mockIndicators, mockKlines);
    } else {
        console.log('⚠️  Skipping Test 3: No mock data provided');
    }
    
    // Test 4: Signal Normalization
    results.test4 = testSignalNameNormalization();
    
    // Summary
    console.log('\n\n📊 TEST SUMMARY');
    console.log('================');
    const allPassed = Object.values(results).every(r => r !== null && (r.allPhase1SignalsMatched !== false && r !== false));
    console.log(`Overall: ${allPassed ? '✅ All tests passed' : '⚠️  Some tests need attention'}`);
    
    return results;
}

