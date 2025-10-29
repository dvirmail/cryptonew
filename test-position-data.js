// Test function to inspect database columns and data for positions
// Run this in the browser console to see what's stored in the database

window.testPositionData = async function() {
    console.log('🔍 Testing Position Data Storage...\n');
    
    try {
        // Test 1: Check live positions (open positions)
        console.log('📊 === LIVE POSITIONS (OPEN) ===');
        const livePositionsResponse = await fetch('http://localhost:3003/api/livePositions');
        const livePositions = await livePositionsResponse.json();
        
        if (livePositions.success && livePositions.data.length > 0) {
            console.log(`✅ Found ${livePositions.data.length} open positions`);
            console.log('📋 Columns available in live_positions table:');
            const samplePosition = livePositions.data[0];
            Object.keys(samplePosition).forEach(key => {
                const value = samplePosition[key];
                const type = typeof value;
                const isNull = value === null;
                console.log(`  • ${key}: ${type} ${isNull ? '(null)' : `= ${JSON.stringify(value)}`}`);
            });
            
            console.log('\n📄 Sample open position data:');
            console.log(JSON.stringify(samplePosition, null, 2));
        } else {
            console.log('❌ No open positions found');
        }
        
        console.log('\n' + '='.repeat(60) + '\n');
        
        // Test 2: Check trades (closed positions)
        console.log('📊 === TRADES (CLOSED POSITIONS) ===');
        const tradesResponse = await fetch('http://localhost:3003/api/trades?limit=5');
        const trades = await tradesResponse.json();
        
        if (trades.success && trades.data.length > 0) {
            console.log(`✅ Found ${trades.data.length} closed positions (trades)`);
            console.log('📋 Columns available in trades table:');
            const sampleTrade = trades.data[0];
            Object.keys(sampleTrade).forEach(key => {
                const value = sampleTrade[key];
                const type = typeof value;
                const isNull = value === null;
                console.log(`  • ${key}: ${type} ${isNull ? '(null)' : `= ${JSON.stringify(value)}`}`);
            });
            
            console.log('\n📄 Sample closed position data:');
            console.log(JSON.stringify(sampleTrade, null, 2));
        } else {
            console.log('❌ No closed positions (trades) found');
        }
        
        console.log('\n' + '='.repeat(60) + '\n');
        
        // Test 3: Compare analytics fields between open and closed positions
        console.log('🔬 === ANALYTICS FIELDS COMPARISON ===');
        
        const analyticsFields = [
            'conviction_score',
            'combined_strength', 
            'market_regime',
            'regime_confidence',
            'fear_greed_score',
            'fear_greed_classification',
            'lpm_score',
            'trigger_signals',
            'conviction_breakdown',
            'conviction_multiplier',
            'atr_value',
            'is_event_driven_strategy'
        ];
        
        console.log('📋 Analytics fields that should be present in both open and closed positions:');
        analyticsFields.forEach(field => {
            console.log(`  • ${field}`);
        });
        
        // Check which analytics fields are present in open positions
        if (livePositions.success && livePositions.data.length > 0) {
            const openPosition = livePositions.data[0];
            console.log('\n✅ Analytics fields present in OPEN positions:');
            analyticsFields.forEach(field => {
                const hasField = openPosition.hasOwnProperty(field);
                const value = openPosition[field];
                console.log(`  ${hasField ? '✅' : '❌'} ${field}: ${hasField ? (value !== null ? 'has data' : 'null') : 'missing'}`);
            });
        }
        
        // Check which analytics fields are present in closed positions
        if (trades.success && trades.data.length > 0) {
            const closedPosition = trades.data[0];
            console.log('\n✅ Analytics fields present in CLOSED positions:');
            analyticsFields.forEach(field => {
                const hasField = closedPosition.hasOwnProperty(field);
                const value = closedPosition[field];
                console.log(`  ${hasField ? '✅' : '❌'} ${field}: ${hasField ? (value !== null ? 'has data' : 'null') : 'missing'}`);
            });
        }
        
        console.log('\n' + '='.repeat(60) + '\n');
        
        // Test 4: Database schema check via direct query
        console.log('🗄️ === DATABASE SCHEMA CHECK ===');
        console.log('To check the actual database schema, run these SQL queries in your database:');
        console.log('\\d live_positions  -- Shows live_positions table structure');
        console.log('\\d trades         -- Shows trades table structure');
        console.log('SELECT COUNT(*) FROM live_positions;  -- Count open positions');
        console.log('SELECT COUNT(*) FROM trades;          -- Count closed positions');
        
        console.log('\n🎯 === SUMMARY ===');
        console.log('✅ Test completed successfully!');
        console.log('📊 Use this data to verify that:');
        console.log('  1. Open positions have all required analytics fields');
        console.log('  2. Closed positions preserve all analytics data from open positions');
        console.log('  3. Both tables have consistent field structures');
        
    } catch (error) {
        console.error('❌ Error testing position data:', error);
        console.log('💡 Make sure the proxy server is running on http://localhost:3003');
    }
};

// Additional helper function to test specific position by ID
window.testPositionById = async function(positionId) {
    console.log(`🔍 Testing position with ID: ${positionId}`);
    
    try {
        // Check if it's in live positions
        const liveResponse = await fetch(`http://localhost:3003/api/livePositions/${positionId}`);
        const liveData = await liveResponse.json();
        
        if (liveData.success) {
            console.log('✅ Found in LIVE positions:');
            console.log(JSON.stringify(liveData.data, null, 2));
        } else {
            console.log('❌ Not found in live positions');
        }
        
        // Check if it's in trades (closed)
        const tradesResponse = await fetch(`http://localhost:3003/api/trades?trade_id=${positionId}`);
        const tradesData = await tradesResponse.json();
        
        if (tradesData.success && tradesData.data.length > 0) {
            console.log('✅ Found in TRADES (closed):');
            console.log(JSON.stringify(tradesData.data[0], null, 2));
        } else {
            console.log('❌ Not found in trades');
        }
        
    } catch (error) {
        console.error('❌ Error testing position by ID:', error);
    }
};

// Helper function to compare two positions
window.comparePositions = function(openPos, closedPos) {
    console.log('🔬 Comparing open vs closed position data...');
    
    const analyticsFields = [
        'conviction_score', 'combined_strength', 'market_regime', 'regime_confidence',
        'fear_greed_score', 'fear_greed_classification', 'lpm_score', 'trigger_signals',
        'conviction_breakdown', 'conviction_multiplier', 'atr_value', 'is_event_driven_strategy'
    ];
    
    console.log('\n📊 Analytics fields comparison:');
    analyticsFields.forEach(field => {
        const openValue = openPos[field];
        const closedValue = closedPos[field];
        const match = JSON.stringify(openValue) === JSON.stringify(closedValue);
        console.log(`  ${match ? '✅' : '❌'} ${field}: ${match ? 'MATCH' : 'DIFFERENT'}`);
        if (!match) {
            console.log(`    Open:  ${JSON.stringify(openValue)}`);
            console.log(`    Closed: ${JSON.stringify(closedValue)}`);
        }
    });
};

console.log('🧪 Position data test functions loaded!');
console.log('📝 Available functions:');
console.log('  • testPositionData() - Test all position data and schema');
console.log('  • testPositionById(id) - Test specific position by ID');
console.log('  • comparePositions(openPos, closedPos) - Compare two positions');
console.log('\n🚀 Run testPositionData() to start testing!');
