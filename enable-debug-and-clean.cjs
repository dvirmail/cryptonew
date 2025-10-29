const fetch = require('node-fetch');

async function enableDebugAndClean() {
    console.log('🔧 Enabling debug logs and cleaning ghost positions...');
    
    try {
        // Enable debug logs via localStorage
        const enableDebugResponse = await fetch('http://localhost:3003/api/enable-debug-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                DEBUG_API_QUEUE: true,
                DEBUG_TRADE_LOGS: true
            })
        });
        
        if (enableDebugResponse.ok) {
            console.log('✅ Debug logs enabled');
        } else {
            console.log('⚠️ Could not enable debug logs via API');
        }
        
        // Get current positions
        const positionsResponse = await fetch('http://localhost:3003/api/livePositions');
        const positionsData = await positionsResponse.json();
        
        console.log(`📊 Found ${positionsData.data.length} positions in database`);
        
        // Delete all positions (they are ghost positions)
        console.log('🧹 Deleting all ghost positions...');
        
        for (const position of positionsData.data) {
            try {
                const deleteResponse = await fetch(`http://localhost:3003/api/livePositions/${position.id}`, {
                    method: 'DELETE'
                });
                
                if (deleteResponse.ok) {
                    console.log(`✅ Deleted position ${position.id} (${position.symbol})`);
                } else {
                    console.log(`❌ Failed to delete position ${position.id}`);
                }
            } catch (error) {
                console.log(`❌ Error deleting position ${position.id}:`, error.message);
            }
        }
        
        // Verify cleanup
        const verifyResponse = await fetch('http://localhost:3003/api/livePositions');
        const verifyData = await verifyResponse.json();
        
        console.log(`🎯 Cleanup complete! Remaining positions: ${verifyData.data.length}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

enableDebugAndClean();
