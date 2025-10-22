const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function cleanupDuplicates() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Keep only the most recent wallet for each trading_mode
        console.log('\n=== Cleaning up duplicates ===');
        
        const deleteResult = await client.query(`
            DELETE FROM live_wallet_states 
            WHERE id NOT IN (
                SELECT DISTINCT ON (trading_mode) id
                FROM live_wallet_states 
                ORDER BY trading_mode, created_date DESC
            )
        `);
        
        console.log(`Deleted ${deleteResult.rowCount} duplicate wallet states`);

        // Check remaining wallets
        console.log('\n=== Remaining wallets ===');
        const remainingWallets = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, created_date
            FROM live_wallet_states 
            ORDER BY created_date DESC
        `);
        
        console.log(`Found ${remainingWallets.rows.length} wallet states:`);
        remainingWallets.rows.forEach((wallet, index) => {
            console.log(`${index + 1}. ID: ${wallet.id.substring(0, 8)}... | Mode: ${wallet.trading_mode} | Equity: ${wallet.total_equity} | Created: ${wallet.created_date}`);
        });

    } catch (error) {
        console.error('❌ Error cleaning up duplicates:', error);
    } finally {
        await client.end();
    }
}

cleanupDuplicates();
