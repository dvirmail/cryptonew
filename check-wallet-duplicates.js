const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function checkWalletDuplicates() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Check all wallet states
        console.log('\n=== All Wallet States ===');
        const allWallets = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, created_date, updated_date 
            FROM live_wallet_states 
            ORDER BY created_date DESC
        `);
        
        console.log(`Found ${allWallets.rows.length} wallet states:`);
        allWallets.rows.forEach((wallet, index) => {
            console.log(`${index + 1}. ID: ${wallet.id.substring(0, 8)}... | Mode: ${wallet.trading_mode} | Equity: ${wallet.total_equity} | Created: ${wallet.created_date}`);
        });

        // Check for duplicates by trading_mode
        console.log('\n=== Duplicate Analysis ===');
        const duplicates = await client.query(`
            SELECT trading_mode, COUNT(*) as count
            FROM live_wallet_states 
            GROUP BY trading_mode 
            HAVING COUNT(*) > 1
        `);
        
        if (duplicates.rows.length > 0) {
            console.log('Found duplicate trading modes:');
            duplicates.rows.forEach(row => {
                console.log(`- ${row.trading_mode}: ${row.count} records`);
            });
        } else {
            console.log('No duplicates found by trading_mode');
        }

        // Get the most recent wallet for testnet
        console.log('\n=== Most Recent Testnet Wallet ===');
        const latestTestnet = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, created_date, updated_date
            FROM live_wallet_states 
            WHERE trading_mode = 'testnet'
            ORDER BY created_date DESC 
            LIMIT 1
        `);
        
        if (latestTestnet.rows.length > 0) {
            const wallet = latestTestnet.rows[0];
            console.log(`Latest testnet wallet: ${wallet.id}`);
            console.log(`Equity: ${wallet.total_equity}`);
            console.log(`Available: ${wallet.available_balance}`);
            console.log(`Created: ${wallet.created_date}`);
            console.log(`Updated: ${wallet.updated_date}`);
        } else {
            console.log('No testnet wallet found');
        }

    } catch (error) {
        console.error('❌ Error checking wallet duplicates:', error);
    } finally {
        await client.end();
    }
}

checkWalletDuplicates();
