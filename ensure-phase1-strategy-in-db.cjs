/**
 * Ensure Phase 1 Test Strategy is in Database
 * 
 * Verifies the Phase 1 test strategy exists in the database,
 * and saves it if it's missing.
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
        
        // Additional volume and momentum signals
        { type: 'ADX', value: 'Bullish Directional Movement' },
        { type: 'PSAR', value: 'Uptrending' }
    ],
    createdDate: new Date().toISOString()
};

// Function to make HTTP POST request
function saveStrategy() {
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
                    resolve({ statusCode: res.statusCode, response });
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${responseData.substring(0, 200)}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

// Main execution
console.log('🔍 Ensuring Phase 1 Test Strategy is in database...\n');
console.log(`   Strategy: ${testStrategy.combinationName}`);
console.log(`   Signals: ${testStrategy.signals.length} (${testStrategy.signals.filter(s => 
    s.value.includes('Divergence') || s.value.includes('Failure Swing')
).length} Phase 1 signals)\n`);

saveStrategy()
    .then(({ statusCode, response }) => {
        if (statusCode === 200 && response.success) {
            console.log('✅ Strategy API call successful!');
            console.log(`   File storage: ✅ Saved`);
            console.log(`   Database: ${response.databaseSaved ? '✅ Saved' : '⚠️  Failed to save to database'}`);
            
            if (!response.databaseSaved) {
                console.log('\n⚠️  Database save failed. Possible reasons:');
                console.log('   1. Database client not initialized');
                console.log('   2. Database connection error');
                console.log('   3. Check proxy server logs for details');
                console.log('\n💡 The strategy was saved to file storage and can be synced later.');
            } else {
                console.log('\n✅ Strategy successfully saved to both file storage and database!');
            }
            
            console.log(`\n📊 Strategy details:`);
            console.log(`   ID: ${response.data.id}`);
            console.log(`   Name: ${response.data.combinationName || testStrategy.combinationName}`);
            console.log(`   Coin: ${testStrategy.coin}`);
            console.log(`   Timeframe: ${testStrategy.timeframe}`);
            console.log(`   Total Signals: ${testStrategy.signals.length}`);
            
            process.exit(response.databaseSaved ? 0 : 1);
        } else {
            console.error('❌ Failed to save strategy');
            console.error(`   Status: ${statusCode}`);
            console.error(`   Response:`, JSON.stringify(response, null, 2));
            process.exit(1);
        }
    })
    .catch((error) => {
        console.error('\n❌ Error:', error.message);
        console.error('\n💡 Make sure the proxy server is running on localhost:3003');
        process.exit(1);
    });

