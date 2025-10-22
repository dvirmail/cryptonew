const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function testWalletUpdate() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Test updating the most recent wallet
        const walletId = '90702d5e-2138-4e4b-b386-3343d6d8755d';
        
        console.log('\n=== Before Update ===');
        const beforeUpdate = await client.query(`
            SELECT id, total_equity, available_balance, updated_date
            FROM live_wallet_states 
            WHERE id = $1
        `, [walletId]);
        
        console.log('Current wallet state:', beforeUpdate.rows[0]);

        // Update the wallet with test data
        console.log('\n=== Updating Wallet ===');
        const updateResult = await client.query(`
            UPDATE live_wallet_states 
            SET total_equity = $1, available_balance = $2, updated_date = NOW()
            WHERE id = $3
            RETURNING *
        `, ['24401.93594714', '24401.93594714', walletId]);
        
        console.log('Update result:', updateResult.rows[0]);

        // Check after update
        console.log('\n=== After Update ===');
        const afterUpdate = await client.query(`
            SELECT id, total_equity, available_balance, updated_date
            FROM live_wallet_states 
            WHERE id = $1
        `, [walletId]);
        
        console.log('Updated wallet state:', afterUpdate.rows[0]);

    } catch (error) {
        console.error('❌ Error testing wallet update:', error);
    } finally {
        await client.end();
    }
}

testWalletUpdate();
