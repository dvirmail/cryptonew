// Use built-in fetch (Node.js 18+) or require node-fetch for older versions
const fetch = globalThis.fetch || require('node-fetch');

async function testSaveTradeToDB() {
    console.log('🧪 Testing saveTradeToDB function...\n');
    
    try {
        // Create a simple trade to test
        const testTrade = {
            trade_id: 'test_save_debug_456',
            strategy_name: 'Save Test',
            symbol: 'BTC/USDT',
            direction: 'long',
            entry_price: 50000,
            exit_price: 51000,
            quantity_crypto: 0.001,
            entry_value_usdt: 50,
            exit_value_usdt: 51,
            pnl_usdt: 1,
            pnl_percentage: 2,
            entry_timestamp: '2025-10-28T20:45:00.000Z',
            exit_timestamp: '2025-10-28T20:46:00.000Z',
            duration_seconds: 60,
            exit_reason: 'save_test',
            exit_trend: 'profitable',
            leverage: 1,
            trading_mode: 'testnet',
            // Analytics fields
            fear_greed_score: 65,
            fear_greed_classification: 'Greed',
            lpm_score: 0.75,
            combined_strength: 85.50,
            conviction_score: 80,
            conviction_breakdown: '{"sentiment": 10, "technical": 40, "fundamental": 30}',
            conviction_multiplier: 1.20,
            market_regime: 'uptrend',
            regime_confidence: 0.80,
            atr_value: 0.05000000,
            is_event_driven_strategy: false,
            trigger_signals: '[{"type": "MACD", "value": "Bullish", "strength": 70}]'
        };
        
        console.log('📝 Creating trade with analytics data...');
        console.log('🔍 Trade analytics fields:');
        console.log(`   - fear_greed_score: ${testTrade.fear_greed_score}`);
        console.log(`   - fear_greed_classification: ${testTrade.fear_greed_classification}`);
        console.log(`   - lpm_score: ${testTrade.lpm_score}`);
        console.log(`   - conviction_score: ${testTrade.conviction_score}`);
        console.log(`   - market_regime: ${testTrade.market_regime}`);
        
        // Create the trade
        const response = await fetch('http://localhost:3003/api/trades', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testTrade)
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Trade created successfully!');
            console.log('🔍 Trade ID:', result.data.id);
            
            // Wait a moment for database save
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if it's in the database
            console.log('\n🔍 Checking database...');
            const dbCheck = await fetch('http://localhost:3003/api/trades');
            const dbResult = await dbCheck.json();
            
            const savedTrade = dbResult.data.find(t => t.trade_id === 'test_save_debug_456');
            if (savedTrade) {
                console.log('✅ Trade found in API response!');
                console.log('🔍 Analytics fields in API response:');
                console.log(`   - fear_greed_score: ${savedTrade.fear_greed_score}`);
                console.log(`   - fear_greed_classification: ${savedTrade.fear_greed_classification}`);
                console.log(`   - lpm_score: ${savedTrade.lpm_score}`);
            } else {
                console.log('❌ Trade not found in API response');
            }
        } else {
            console.log('❌ Failed to create trade:', result.error);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testSaveTradeToDB();
