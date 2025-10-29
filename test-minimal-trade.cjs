// Use built-in fetch (Node.js 18+) or require node-fetch for older versions
const fetch = globalThis.fetch || require('node-fetch');

async function testMinimalTrade() {
    console.log('🧪 Testing minimal trade creation...\n');
    
    try {
        // Create a minimal trade with only required fields
        const minimalTrade = {
            symbol: 'BTC/USDT',
            side: 'BUY',
            quantity: 0.001,
            entry_price: 50000,
            exit_price: 51000,
            entry_timestamp: '2025-10-28T20:45:00.000Z',
            exit_timestamp: '2025-10-28T20:46:00.000Z',
            pnl_usdt: 1,
            pnl_percent: 2,
            trading_mode: 'testnet',
            strategy_name: 'Minimal Test',
            conviction_score: 50,
            market_regime: 'uptrend',
            created_date: '2025-10-28T20:45:00.000Z',
            updated_date: '2025-10-28T20:45:00.000Z'
        };
        
        console.log('📝 Creating minimal trade...');
        
        // Create the trade
        const response = await fetch('http://localhost:3003/api/trades', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(minimalTrade)
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Minimal trade created successfully!');
            console.log('🔍 Trade ID:', result.data.id);
            
            // Wait a moment for database save
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check database count
            console.log('\n🔍 Checking database count...');
        } else {
            console.log('❌ Failed to create minimal trade:', result.error);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testMinimalTrade();
