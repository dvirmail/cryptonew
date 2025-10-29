const fetch = globalThis.fetch || require('node-fetch');

async function testBacktestDatabaseStorage() {
    console.log('🧪 Testing Backtest Database Storage...\n');
    
    try {
        // Test data for a backtest combination
        const testCombination = {
            combinationName: 'Test MACD + EMA Strategy',
            coin: 'BTCUSDT',
            strategyDirection: 'long',
            timeframe: '1h',
            successRate: 75.5,
            occurrences: 25,
            avgPriceMove: 2.5,
            takeProfitPercentage: 5.0,
            stopLossPercentage: 2.0,
            estimatedExitTimeMinutes: 240,
            enableTrailingTakeProfit: true,
            trailingStopPercentage: 1.0,
            positionSizePercentage: 1.0,
            dominantMarketRegime: 'uptrend',
            signals: [
                {
                    type: 'MACD',
                    value: 'MACD Above Signal',
                    strength: 70
                },
                {
                    type: 'EMA',
                    value: 'Price Above EMA 20',
                    strength: 65
                }
            ]
        };
        
        console.log('📊 Test combination data:', JSON.stringify(testCombination, null, 2));
        
        // Test single combination creation
        console.log('\n🔍 Testing single combination creation...');
        const singleResponse = await fetch('http://localhost:3001/api/backtestCombinations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testCombination)
        });
        
        const singleResult = await singleResponse.json();
        console.log('✅ Single creation result:', singleResult);
        
        // Test bulk creation
        console.log('\n🔍 Testing bulk combination creation...');
        const bulkCombinations = [
            {
                ...testCombination,
                combinationName: 'Test RSI + Bollinger Strategy',
                coin: 'ETHUSDT',
                signals: [
                    {
                        type: 'RSI',
                        value: 'RSI Oversold',
                        strength: 80
                    },
                    {
                        type: 'BOLLINGER',
                        value: 'Price Near Lower Band',
                        strength: 75
                    }
                ]
            },
            {
                ...testCombination,
                combinationName: 'Test Volume + MACD Strategy',
                coin: 'ADAUSDT',
                signals: [
                    {
                        type: 'VOLUME',
                        value: 'High Volume',
                        strength: 60
                    },
                    {
                        type: 'MACD',
                        value: 'MACD Bullish Cross',
                        strength: 70
                    }
                ]
            }
        ];
        
        const bulkResponse = await fetch('http://localhost:3001/api/backtestCombinations/bulkCreate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bulkCombinations)
        });
        
        const bulkResult = await bulkResponse.json();
        console.log('✅ Bulk creation result:', bulkResult);
        
        // Verify data in database
        console.log('\n🔍 Verifying data in PostgreSQL database...');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
            const { stdout } = await execAsync('psql -U dvirturkenitch -d dvirturkenitch -c "SELECT combination_name, coin, success_rate, occurrences, signals FROM backtest_combinations WHERE combination_name LIKE \'Test%\' ORDER BY created_date DESC LIMIT 5;"');
            console.log('📊 Database verification:');
            console.log(stdout);
        } catch (dbError) {
            console.error('❌ Database verification failed:', dbError.message);
        }
        
        console.log('\n✅ Backtest database storage test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Error details:', error);
    }
}

// Run the test
testBacktestDatabaseStorage();
