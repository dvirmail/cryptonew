const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function checkWalletSummaries() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Check wallet_summaries table
        console.log('\n=== Wallet Summaries ===');
        const summaries = await client.query(`
            SELECT id, mode, total_equity, available_balance, created_date, updated_date
            FROM wallet_summaries 
            ORDER BY created_date DESC
        `);
        
        console.log(`Found ${summaries.rows.length} wallet summaries:`);
        summaries.rows.forEach((summary, index) => {
            console.log(`${index + 1}. ID: ${summary.id.substring(0, 8)}... | Mode: ${summary.mode} | Equity: ${summary.total_equity} | Created: ${summary.created_date}`);
        });

        // Check live_wallet_states table
        console.log('\n=== Live Wallet States ===');
        const liveStates = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, created_date, updated_date
            FROM live_wallet_states 
            ORDER BY created_date DESC
        `);
        
        console.log(`Found ${liveStates.rows.length} live wallet states:`);
        liveStates.rows.forEach((state, index) => {
            console.log(`${index + 1}. ID: ${state.id.substring(0, 8)}... | Mode: ${state.trading_mode} | Equity: ${state.total_equity} | Created: ${state.created_date}`);
        });

    } catch (error) {
        console.error('❌ Error checking wallet summaries:', error);
    } finally {
        await client.end();
    }
}

checkWalletSummaries();
