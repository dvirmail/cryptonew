// Test script to trigger a real manual close through PositionManager
const fetch = globalThis.fetch || require('node-fetch');

async function testRealManualClose() {
    console.log('🧪 Testing Real Manual Position Close...\n');
    
    try {
        // First, get a live position
        console.log('📊 Fetching live positions...');
        const positionsResponse = await fetch('http://localhost:3003/api/livePositions');
        const positionsData = await positionsResponse.json();
        
        if (!positionsData.success || positionsData.data.length === 0) {
            console.log('❌ No live positions found');
            return;
        }
        
        const positions = positionsData.data;
        console.log(`📊 Found ${positions.length} live positions`);
        
        // Select the first position
        const positionToClose = positions[0];
        console.log(`🎯 Selected position: ${positionToClose.symbol} (ID: ${positionToClose.id})`);
        console.log(`   Entry Price: ${positionToClose.entry_price}`);
        console.log(`   Quantity: ${positionToClose.quantity}`);
        console.log(`   Strategy: ${positionToClose.strategy_name}`);
        
        // Check analytics fields in the live position
        console.log('   Analytics Fields:');
        console.log(`     - fear_greed_score: ${positionToClose.fear_greed_score}`);
        console.log(`     - fear_greed_classification: ${positionToClose.fear_greed_classification}`);
        console.log(`     - lpm_score: ${positionToClose.lpm_score}`);
        console.log(`     - conviction_score: ${positionToClose.conviction_score}`);
        console.log(`     - market_regime: ${positionToClose.market_regime}`);
        console.log(`     - regime_confidence: ${positionToClose.regime_confidence}`);
        console.log(`     - atr_value: ${positionToClose.atr_value}`);
        console.log(`     - combined_strength: ${positionToClose.combined_strength}`);
        console.log(`     - conviction_breakdown: ${JSON.stringify(positionToClose.conviction_breakdown)}`);
        console.log(`     - conviction_multiplier: ${positionToClose.conviction_multiplier}`);
        console.log(`     - is_event_driven_strategy: ${positionToClose.is_event_driven_strategy}`);
        console.log(`     - trigger_signals: ${JSON.stringify(positionToClose.trigger_signals)}`);
        
        console.log('\n🔄 Calling manual close API...');
        
        // Call the manual close API endpoint
        const closeResponse = await fetch(`http://localhost:3003/api/livePositions/${positionToClose.id}/close`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPrice: positionToClose.current_price || positionToClose.entry_price,
                exitReason: 'manual_close_test'
            })
        });
        
        const closeResult = await closeResponse.json();
        
        if (closeResult.success) {
            console.log('✅ Manual close successful!');
            console.log('🔍 Check the server logs for the PositionManager debug output...');
        } else {
            console.log('❌ Manual close failed:', closeResult.error);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testRealManualClose();
