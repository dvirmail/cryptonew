const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hvazdukoq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2YXpkdWtvcSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzM1NTQ4NzQwLCJleHAiOjIwNTEzMDQ3NDB9.8bsjzy0oa';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGhostPositions() {
    console.log('🔍 Checking for ghost positions in database...');
    
    try {
        // Get all open positions
        const { data: positions, error } = await supabase
            .from('live_positions')
            .select('*')
            .eq('status', 'open')
            .order('created_date', { ascending: false });
            
        if (error) {
            console.error('❌ Error fetching positions:', error);
            return;
        }
        
        console.log(`📊 Found ${positions.length} open positions in database:`);
        
        positions.forEach((pos, index) => {
            console.log(`${index + 1}. ${pos.symbol} - ${pos.quantity_crypto} ${pos.base_asset} - Status: ${pos.status}`);
            console.log(`   ID: ${pos.id}`);
            console.log(`   Position ID: ${pos.position_id}`);
            console.log(`   Created: ${pos.created_date}`);
            console.log(`   Wallet ID: ${pos.wallet_id}`);
            console.log('---');
        });
        
        // Group by symbol
        const bySymbol = {};
        positions.forEach(pos => {
            if (!bySymbol[pos.symbol]) {
                bySymbol[pos.symbol] = [];
            }
            bySymbol[pos.symbol].push(pos);
        });
        
        console.log('\n📈 Positions by symbol:');
        Object.entries(bySymbol).forEach(([symbol, posList]) => {
            console.log(`${symbol}: ${posList.length} positions`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

checkGhostPositions();
