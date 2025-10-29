// Use built-in fetch (Node.js 18+) or require node-fetch for older versions
const fetch = globalThis.fetch || require('node-fetch');

async function testManualClose() {
    console.log('🧪 Testing Manual Position Close...\n');
    
    try {
        // Get live positions
        console.log('📊 Fetching live positions...');
        const positionsResponse = await fetch('http://localhost:3003/api/livePositions');
        const positionsData = await positionsResponse.json();
        
        if (!positionsData.success || positionsData.data.length === 0) {
            console.log('❌ No live positions found');
            return;
        }
        
        const positions = positionsData.data;
        console.log(`📊 Found ${positions.length} live positions`);
        
        // Get the first XRP/USDT position
        const xrpPosition = positions.find(p => p.symbol === 'XRP/USDT');
        if (!xrpPosition) {
            console.log('❌ No XRP/USDT position found');
            return;
        }
        
        console.log(`🎯 Selected position: ${xrpPosition.symbol} (ID: ${xrpPosition.id})`);
        console.log(`   Entry Price: ${xrpPosition.entry_price}`);
        console.log(`   Quantity: ${xrpPosition.quantity_crypto}`);
        console.log(`   Strategy: ${xrpPosition.strategy_name}`);
        console.log(`   Analytics Fields:`);
        console.log(`     - fear_greed_score: ${xrpPosition.fear_greed_score}`);
        console.log(`     - fear_greed_classification: ${xrpPosition.fear_greed_classification}`);
        console.log(`     - lpm_score: ${xrpPosition.lpm_score}`);
        console.log(`     - conviction_score: ${xrpPosition.conviction_score}`);
        console.log(`     - market_regime: ${xrpPosition.market_regime}`);
        console.log(`     - regime_confidence: ${xrpPosition.regime_confidence}`);
        console.log(`     - atr_value: ${xrpPosition.atr_value}`);
        console.log(`     - combined_strength: ${xrpPosition.combined_strength}`);
        console.log(`     - conviction_breakdown: ${JSON.stringify(xrpPosition.conviction_breakdown)}`);
        console.log(`     - conviction_multiplier: ${xrpPosition.conviction_multiplier}`);
        console.log(`     - is_event_driven_strategy: ${xrpPosition.is_event_driven_strategy}`);
        console.log(`     - trigger_signals: ${JSON.stringify(xrpPosition.trigger_signals)}`);
        
        // Simulate manual close by calling the frontend's close function
        // We'll use a simple approach - delete the position and create a trade
        console.log('\n🔄 Simulating manual close...');
        
        // First, let's create a trade record manually to test the logging
        const exitPrice = parseFloat(xrpPosition.entry_price) + 0.01; // Small profit
        const tradeData = {
            trade_id: xrpPosition.position_id,
            strategy_name: xrpPosition.strategy_name,
            symbol: xrpPosition.symbol,
            direction: xrpPosition.direction,
            entry_price: parseFloat(xrpPosition.entry_price),
            exit_price: exitPrice,
            quantity_crypto: parseFloat(xrpPosition.quantity_crypto),
            entry_value_usdt: parseFloat(xrpPosition.entry_value_usdt),
            exit_value_usdt: parseFloat(xrpPosition.quantity_crypto) * exitPrice,
            pnl_usdt: parseFloat(xrpPosition.quantity_crypto) * (exitPrice - parseFloat(xrpPosition.entry_price)),
            pnl_percentage: ((exitPrice - parseFloat(xrpPosition.entry_price)) / parseFloat(xrpPosition.entry_price)) * 100,
            entry_timestamp: xrpPosition.entry_timestamp,
            exit_timestamp: new Date().toISOString(),
            duration_seconds: Math.floor((new Date() - new Date(xrpPosition.entry_timestamp)) / 1000),
            exit_reason: 'manual_test',
            exit_trend: 'profitable',
            leverage: 1,
            trading_mode: xrpPosition.trading_mode,
            // Analytics fields from live position
            fear_greed_score: xrpPosition.fear_greed_score,
            fear_greed_classification: xrpPosition.fear_greed_classification,
            lpm_score: xrpPosition.lpm_score,
            combined_strength: xrpPosition.combined_strength,
            conviction_score: xrpPosition.conviction_score,
            conviction_breakdown: xrpPosition.conviction_breakdown,
            conviction_multiplier: xrpPosition.conviction_multiplier,
            market_regime: xrpPosition.market_regime,
            regime_confidence: xrpPosition.regime_confidence,
            atr_value: xrpPosition.atr_value,
            is_event_driven_strategy: xrpPosition.is_event_driven_strategy,
            trigger_signals: xrpPosition.trigger_signals
        };
        
        console.log('\n📝 Creating trade with analytics data...');
        console.log('🔍 Trade data analytics fields:');
        console.log(`   - fear_greed_score: ${tradeData.fear_greed_score}`);
        console.log(`   - fear_greed_classification: ${tradeData.fear_greed_classification}`);
        console.log(`   - lpm_score: ${tradeData.lpm_score}`);
        console.log(`   - conviction_score: ${tradeData.conviction_score}`);
        console.log(`   - market_regime: ${tradeData.market_regime}`);
        console.log(`   - regime_confidence: ${tradeData.regime_confidence}`);
        console.log(`   - atr_value: ${tradeData.atr_value}`);
        console.log(`   - combined_strength: ${tradeData.combined_strength}`);
        console.log(`   - conviction_breakdown: ${JSON.stringify(tradeData.conviction_breakdown)}`);
        console.log(`   - conviction_multiplier: ${tradeData.conviction_multiplier}`);
        console.log(`   - is_event_driven_strategy: ${tradeData.is_event_driven_strategy}`);
        console.log(`   - trigger_signals: ${JSON.stringify(tradeData.trigger_signals)}`);
        
        // Create the trade
        const tradeResponse = await fetch('http://localhost:3003/api/trades', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tradeData)
        });
        
        const tradeResult = await tradeResponse.json();
        
        if (tradeResult.success) {
            console.log('✅ Trade created successfully!');
            console.log('🔍 Check the server logs for the analytics field logging...');
        } else {
            console.log('❌ Failed to create trade:', tradeResult.error);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testManualClose();
