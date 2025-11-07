/**
 * Phase 1 Test Runner
 * 
 * This script runs comprehensive tests for Phase 1 signal upgrades
 * Usage in browser console:
 *   window.runPhase1Tests()
 *   OR
 *   import { runPhase1Tests } from '@/components/backtesting/test/runPhase1Tests';
 */

import { 
    createPhase1TestStrategy,
    runPhase1TestSuite 
} from './Phase1TestSuite.jsx';

/**
 * Creates mock indicator data for testing
 */
function createMockIndicators() {
    // Create 100 candles of mock data
    const candles = 100;
    const basePrice = 3800;
    
    const data = [];
    const macd = [];
    const mfi = [];
    const obv = [];
    
    for (let i = 0; i < candles; i++) {
        // Mock price data
        const price = basePrice + Math.sin(i / 10) * 100 + (Math.random() * 50 - 25);
        data.push({
            open: price,
            high: price + Math.random() * 20,
            low: price - Math.random() * 20,
            close: price + (Math.random() * 10 - 5),
            volume: 1000 + Math.random() * 500,
            time: Date.now() - (candles - i) * 15 * 60 * 1000 // 15 min candles
        });
        
        // Mock MACD with histogram
        const macdValue = Math.sin(i / 15) * 0.5;
        const signalValue = macdValue - 0.1;
        macd.push({
            macd: macdValue,
            signal: signalValue,
            histogram: macdValue - signalValue
        });
        
        // Mock MFI (0-100 range)
        mfi.push(50 + Math.sin(i / 8) * 30 + (Math.random() * 20 - 10));
        
        // Mock OBV (cumulative)
        const prevObv = i > 0 ? obv[i - 1] : 1000000;
        const volumeChange = data[i].close > (i > 0 ? data[i-1].close : price) ? data[i].volume : -data[i].volume;
        obv.push(prevObv + volumeChange);
    }
    
    return {
        data,
        macd,
        mfi,
        obv,
        rsi: mfi.map(() => 50 + Math.random() * 20 - 10), // Mock RSI
        ema: data.map(c => c.close) // Mock EMA
    };
}

/**
 * Main test runner
 */
export async function runPhase1Tests() {
    console.log('🚀 Starting Phase 1 Test Suite...\n');
    
    try {
        // Create mock data
        const mockIndicators = createMockIndicators();
        const mockKlines = mockIndicators.data;
        
        // Create test strategy
        const testStrategy = createPhase1TestStrategy();
        console.log('✅ Created test strategy:', testStrategy.combinationName);
        console.log(`   Signals: ${testStrategy.signals.length}`);
        testStrategy.signals.forEach(s => {
            console.log(`     - ${s.type}: ${s.value}`);
        });
        
        // For backtest results, we'd need actual backtest output
        // For now, create minimal structure
        const mockBacktestResults = {
            matches: [],
            combinations: []
        };
        
        // Run test suite
        const results = await runPhase1TestSuite(
            mockBacktestResults,
            mockIndicators,
            mockKlines
        );
        
        console.log('\n✅ Test suite completed');
        return results;
    } catch (error) {
        console.error('❌ Test suite failed:', error);
        throw error;
    }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
    window.runPhase1Tests = runPhase1Tests;
    window.createPhase1TestStrategy = createPhase1TestStrategy;
    console.log('✅ Phase 1 test functions loaded. Use: window.runPhase1Tests()');
}

