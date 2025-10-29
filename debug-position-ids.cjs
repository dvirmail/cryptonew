const fetch = globalThis.fetch || require('node-fetch');

async function debugPositionIds() {
    try {
        console.log('🔍 Fetching positions from API...');
        const response = await fetch('http://localhost:3003/api/livePositions');
        const data = await response.json();
        
        console.log(`📊 Found ${data.length} positions`);
        
        if (data.length > 0) {
            console.log('🔍 First position details:');
            const firstPos = data[0];
            console.log({
                id: firstPos.id,
                position_id: firstPos.position_id,
                db_record_id: firstPos.db_record_id,
                symbol: firstPos.symbol,
                status: firstPos.status
            });
            
            console.log('🔍 All position IDs:');
            data.forEach((pos, index) => {
                console.log(`${index + 1}. ID: ${pos.id}, Position_ID: ${pos.position_id}, Symbol: ${pos.symbol}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

debugPositionIds();
