#!/usr/bin/env node

/**
 * Create Comprehensive Test Strategy - All 34 Signals
 * 
 * Creates a comprehensive test strategy with ALL 34 signal types
 * for testing in the scanner to confirm there are no errors.
 * 
 * Requirements:
 * - Downtrend regime
 * - Combined strength: 400
 * - Profit factor: 5
 * - All 34 signal types included
 */

const http = require('http');

// Comprehensive strategy with all 34 signal types
const testStrategy = {
    combinationName: 'TEST - All 34 Signals Comprehensive - Downtrend Regime',
    coin: 'BTC/USDT',
    strategyDirection: 'long',
    timeframe: '15m',
    successRate: 0,
    occurrences: 0,
    avgPriceMove: 0,
    takeProfitPercentage: 5,
    stopLossPercentage: 2,
    estimatedExitTimeMinutes: 240,
    enableTrailingTakeProfit: false,
    trailingStopPercentage: 0,
    positionSizePercentage: 1,
    dominantMarketRegime: 'downtrend',
    combinedStrength: 400,
    profitFactor: 5,
    is_event_driven_strategy: false,
    signals: [
        // ===================================================================
        // MOMENTUM INDICATORS (8 signals)
        // ===================================================================
        // RSI
        { type: 'RSI', value: 'RSI Above 50' },
        { type: 'RSI', value: 'Oversold Exit' },
        { type: 'RSI', value: 'RSI Regular Bullish Divergence' },
        
        // Stochastic
        { type: 'Stochastic', value: 'Bullish Cross' },
        { type: 'Stochastic', value: 'Stochastic Above 50' },
        { type: 'Stochastic', value: 'Stochastic Regular Bullish Divergence' },
        
        // Williams %R
        { type: 'WilliamsR', value: 'Oversold Exit' },
        { type: 'WilliamsR', value: 'Zero Line Cross' },
        { type: 'WilliamsR', value: 'WilliamsR Regular Bullish Divergence' },
        
        // CCI
        { type: 'CCI', value: 'Zero Line Cross' },
        { type: 'CCI', value: 'Oversold Exit' },
        { type: 'CCI', value: 'CCI Regular Bullish Divergence' },
        
        // ROC
        { type: 'ROC', value: 'Zero Line Cross' },
        { type: 'ROC', value: 'Positive ROC' },
        { type: 'ROC', value: 'ROC Regular Bullish Divergence' },
        
        // Awesome Oscillator
        { type: 'AwesomeOscillator', value: 'Zero Line Cross' },
        { type: 'AwesomeOscillator', value: 'Positive AO' },
        { type: 'AwesomeOscillator', value: 'AwesomeOscillator Regular Bullish Divergence' },
        
        // CMO
        { type: 'CMO', value: 'Zero Line Cross' },
        { type: 'CMO', value: 'Oversold Exit' },
        { type: 'CMO', value: 'CMO Regular Bullish Divergence' },
        
        // MFI
        { type: 'MFI', value: 'Oversold Exit' },
        { type: 'MFI', value: 'Rising MFI' },
        { type: 'MFI', value: 'MFI Regular Bullish Divergence' },
        
        // ===================================================================
        // TREND INDICATORS (7 signals)
        // ===================================================================
        // MACD
        { type: 'MACD', value: 'Bullish Cross' },
        { type: 'MACD', value: 'MACD Above Signal' },
        { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
        
        // EMA
        { type: 'EMA', value: 'Price Above EMA' },
        { type: 'EMA', value: 'Bullish Cross' },
        
        // MA200
        { type: 'MA200', value: 'Price Above MA200' },
        { type: 'MA200', value: 'price_cross_up' },
        
        // Ichimoku
        { type: 'Ichimoku', value: 'Price Above Kumo' },
        { type: 'Ichimoku', value: 'Tenkan-Kijun Cross' },
        
        // MA Ribbon
        { type: 'MARibbon', value: 'Bullish Alignment' },
        { type: 'MARibbon', value: 'Ribbon Cross' },
        
        // ADX
        { type: 'ADX', value: 'Strong Trend' },
        { type: 'ADX', value: 'ADX Rising' },
        
        // PSAR
        { type: 'PSAR', value: 'PSAR Flip' },
        
        // ===================================================================
        // VOLATILITY INDICATORS (6 signals)
        // ===================================================================
        // Bollinger Bands
        { type: 'Bollinger', value: 'Price Above Lower Band' },
        { type: 'Bollinger', value: 'Lower Band Bounce' },
        
        // ATR
        { type: 'ATR', value: 'ATR Expansion' },
        { type: 'ATR', value: 'ATR Above Average' },
        
        // BBW
        { type: 'BBW', value: 'Expansion' },
        { type: 'BBW', value: 'Expansion State' },
        
        // Keltner Channels
        { type: 'Keltner', value: 'Price Above Lower Channel' },
        { type: 'Keltner', value: 'Lower Channel Bounce' },
        
        // Donchian Channels
        { type: 'Donchian', value: 'Price Above Lower Channel' },
        { type: 'Donchian', value: 'Upper Channel Breakout' },
        
        // TTM Squeeze
        { type: 'TTMSqueeze', value: 'Squeeze Release' },
        { type: 'TTMSqueeze', value: 'Squeeze Released' },
        
        // ===================================================================
        // VOLUME INDICATORS (5 signals)
        // ===================================================================
        // Volume
        { type: 'volume', value: 'High Volume' },
        { type: 'volume', value: 'Volume Spike' },
        
        // OBV
        { type: 'OBV', value: 'OBV Above SMA' },
        { type: 'OBV', value: 'OBV Rising' },
        { type: 'OBV', value: 'OBV Regular Bullish Divergence' },
        
        // CMF
        { type: 'CMF', value: 'CMF Above Zero' },
        { type: 'CMF', value: 'CMF Zero Line Cross' },
        
        // A/D Line
        { type: 'ADLine', value: 'ADL Above SMA' },
        { type: 'ADLine', value: 'Bullish Crossover' },
        { type: 'ADLine', value: 'ADLine Regular Bullish Divergence' },
        
        // ===================================================================
        // SUPPORT & RESISTANCE INDICATORS (3 signals)
        // ===================================================================
        // Pivot Points
        { type: 'pivot', value: 'Above Pivot' },
        { type: 'pivot', value: 'Pivot Breakout' },
        
        // Fibonacci
        { type: 'fibonacci', value: 'Price Above Fibonacci Level' },
        { type: 'fibonacci', value: 'Fibonacci Bounce' },
        
        // Support/Resistance
        { type: 'supportResistance', value: 'Above Support' },
        { type: 'supportResistance', value: 'Support Bounce' },
        
        // ===================================================================
        // PATTERN INDICATORS (2 signals)
        // ===================================================================
        // Candlestick Patterns
        { type: 'candlestick', value: 'Bullish Engulfing' },
        { type: 'candlestick', value: 'Hammer' },
        
        // Chart Patterns
        { type: 'chartPattern', value: 'Double Bottom' },
        { type: 'chartPattern', value: 'Inverse Head and Shoulders' }
    ],
    createdDate: new Date().toISOString()
};

// Function to make HTTP POST request
function createStrategy() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(testStrategy);
        
        const options = {
            hostname: 'localhost',
            port: 3003,
            path: '/api/backtestCombinations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData);
                    if (res.statusCode === 200 && response.success) {
                        console.log('\n✅ Successfully created comprehensive test strategy!');
                        console.log(`   Name: ${testStrategy.combinationName}`);
                        console.log(`   ID: ${response.data.id}`);
                        console.log(`   Total Signals: ${testStrategy.signals.length}`);
                        console.log(`   Combined Strength: ${testStrategy.combinedStrength}`);
                        console.log(`   Profit Factor: ${testStrategy.profitFactor}`);
                        console.log(`   Regime: ${testStrategy.dominantMarketRegime}`);
                        console.log(`   Database saved: ${response.databaseSaved ? 'Yes ✅' : 'No ❌'}`);
                        
                        // Count signals by category
                        const momentum = testStrategy.signals.filter(s => 
                            ['RSI', 'Stochastic', 'WilliamsR', 'CCI', 'ROC', 'AwesomeOscillator', 'CMO', 'MFI'].includes(s.type)
                        ).length;
                        const trend = testStrategy.signals.filter(s => 
                            ['MACD', 'EMA', 'MA200', 'Ichimoku', 'MARibbon', 'ADX', 'PSAR'].includes(s.type)
                        ).length;
                        const volatility = testStrategy.signals.filter(s => 
                            ['Bollinger', 'ATR', 'BBW', 'Keltner', 'Donchian', 'TTMSqueeze'].includes(s.type)
                        ).length;
                        const volume = testStrategy.signals.filter(s => 
                            ['volume', 'OBV', 'CMF', 'ADLine'].includes(s.type)
                        ).length;
                        const supportResistance = testStrategy.signals.filter(s => 
                            ['pivot', 'fibonacci', 'supportResistance'].includes(s.type)
                        ).length;
                        const patterns = testStrategy.signals.filter(s => 
                            ['candlestick', 'chartPattern'].includes(s.type)
                        ).length;
                        
                        console.log('\n📊 Signal Breakdown:');
                        console.log(`   Momentum: ${momentum} signals`);
                        console.log(`   Trend: ${trend} signals`);
                        console.log(`   Volatility: ${volatility} signals`);
                        console.log(`   Volume: ${volume} signals`);
                        console.log(`   Support/Resistance: ${supportResistance} signals`);
                        console.log(`   Patterns: ${patterns} signals`);
                        
                        console.log('\n📋 Sample Signals:');
                        testStrategy.signals.slice(0, 10).forEach((signal, index) => {
                            console.log(`   ${index + 1}. ${signal.type}: ${signal.value}`);
                        });
                        console.log(`   ... and ${testStrategy.signals.length - 10} more`);
                        
                        resolve(response);
                    } else {
                        console.error('❌ Failed to create strategy');
                        console.error(`   Status: ${res.statusCode}`);
                        console.error(`   Response:`, response);
                        reject(new Error(`HTTP ${res.statusCode}: ${response.error || 'Unknown error'}`));
                    }
                } catch (error) {
                    console.error('❌ Error parsing response:', error);
                    console.error('   Raw response:', responseData);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

// Main execution
console.log('🚀 Creating Comprehensive Test Strategy with All 34 Signals...\n');
console.log(`   Strategy Name: ${testStrategy.combinationName}`);
console.log(`   Coin: ${testStrategy.coin}`);
console.log(`   Timeframe: ${testStrategy.timeframe}`);
console.log(`   Regime: ${testStrategy.dominantMarketRegime}`);
console.log(`   Combined Strength: ${testStrategy.combinedStrength}`);
console.log(`   Profit Factor: ${testStrategy.profitFactor}`);
console.log(`   Total Signals: ${testStrategy.signals.length}\n`);

createStrategy()
    .then(() => {
        console.log('\n✅ Script completed successfully!');
        console.log('💡 You can now test this strategy in the scanner to confirm there are no errors.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error.message);
        console.error('\n💡 Make sure the proxy server is running on localhost:3003');
        process.exit(1);
    });

