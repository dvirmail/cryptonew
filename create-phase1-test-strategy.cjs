/**
 * Create Phase 1 Test Strategy
 * 
 * Creates a comprehensive test strategy with all Phase 1 upgraded indicators
 * and saves it to the backtest_combinations table in the database
 */

const http = require('http');

const testStrategy = {
    combinationName: 'Phase 1 Comprehensive Test - All Enhanced Indicators',
    coin: 'ETH/USDT',
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
    dominantMarketRegime: null,
    is_event_driven_strategy: false,
    signals: [
        // Existing core signals
        { type: 'MACD', value: 'Bullish Cross' },
        { type: 'MACD', value: 'MACD Above Signal' },
        { type: 'RSI', value: 'Oversold Exit' },
        { type: 'RSI', value: 'RSI Above 50' },
        { type: 'EMA', value: 'Price Above EMA' },
        { type: 'MA200', value: 'price_cross_up' },
        { type: 'Ichimoku', value: 'Price Above Kumo' },
        { type: 'Stochastic', value: 'Stochastic Oversold Exit' },
        { type: 'Bollinger', value: 'Price Above Lower Band' },
        { type: 'ATR', value: 'ATR Expansion' },
        
        // ✅ Phase 1: NEW MACD Divergence Signals
        { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
        { type: 'MACD', value: 'MACD Histogram Regular Bearish Divergence' },
        { type: 'MACD', value: 'MACD Histogram Hidden Bullish Divergence' },
        { type: 'MACD', value: 'MACD Histogram Hidden Bearish Divergence' },
        
        // ✅ Phase 1: NEW MFI Divergence Signals
        { type: 'MFI', value: 'MFI Regular Bullish Divergence' },
        { type: 'MFI', value: 'MFI Regular Bearish Divergence' },
        { type: 'MFI', value: 'MFI Hidden Bullish Divergence' },
        { type: 'MFI', value: 'MFI Hidden Bearish Divergence' },
        { type: 'MFI', value: 'MFI Failure Swing Bullish' },
        { type: 'MFI', value: 'MFI Failure Swing Bearish' },
        
        // ✅ Phase 1: NEW OBV Divergence Signals
        { type: 'OBV', value: 'OBV Bullish Divergence' },
        { type: 'OBV', value: 'OBV Bearish Divergence' },
        
        // Additional volume and momentum signals for comprehensive coverage
        { type: 'ADX', value: 'Bullish Directional Movement' },
        { type: 'PSAR', value: 'Uptrending' }
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
                        console.log('✅ Successfully created test strategy!');
                        console.log(`   Name: ${testStrategy.combinationName}`);
                        console.log(`   ID: ${response.data.id}`);
                        console.log(`   Signals: ${testStrategy.signals.length}`);
                        console.log(`   Database saved: ${response.databaseSaved ? 'Yes' : 'No'}`);
                        console.log('\n📊 Strategy signals:');
                        testStrategy.signals.forEach((signal, index) => {
                            console.log(`   ${index + 1}. ${signal.type}: ${signal.value}`);
                        });
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
console.log('🚀 Creating Phase 1 Test Strategy...\n');
console.log(`   Strategy Name: ${testStrategy.combinationName}`);
console.log(`   Coin: ${testStrategy.coin}`);
console.log(`   Timeframe: ${testStrategy.timeframe}`);
console.log(`   Total Signals: ${testStrategy.signals.length}`);
console.log(`   Phase 1 Signals: ${testStrategy.signals.filter(s => 
    s.value.includes('Divergence') || s.value.includes('Failure Swing')
).length}\n`);

createStrategy()
    .then(() => {
        console.log('\n✅ Script completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error.message);
        console.error('\n💡 Make sure the proxy server is running on localhost:3003');
        process.exit(1);
    });

