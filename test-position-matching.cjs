const fetch = globalThis.fetch || require('node-fetch');

async function testPositionMatching() {
    try {
        console.log('🔍 Testing position ID matching...');
        
        // Get positions from API
        const response = await fetch('http://localhost:3003/api/livePositions');
        const data = await response.json();
        
        if (data.length > 0) {
            const firstPos = data[0];
            console.log('🔍 First position from API:');
            console.log({
                id: firstPos.id,
                position_id: firstPos.position_id,
                symbol: firstPos.symbol
            });
            
            // Test the position ID matching logic
            const testPositionId = firstPos.id; // Database UUID
            const testPositionId2 = firstPos.position_id; // Custom position ID
            
            console.log('🔍 Testing position ID matching:');
            console.log(`Database UUID: ${testPositionId}`);
            console.log(`Custom Position ID: ${testPositionId2}`);
            console.log(`Is UUID: ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testPositionId)}`);
            console.log(`Is UUID: ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testPositionId2)}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testPositionMatching();
