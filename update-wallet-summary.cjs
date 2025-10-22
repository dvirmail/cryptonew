const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function updateWalletSummary() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Get the latest LiveWalletState
        console.log('\n=== Getting latest LiveWalletState ===');
        const liveState = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, total_realized_pnl, unrealized_pnl
            FROM live_wallet_states 
            WHERE trading_mode = 'testnet'
            ORDER BY created_date DESC 
            LIMIT 1
        `);
        
        if (liveState.rows.length === 0) {
            console.log('No LiveWalletState found');
            return;
        }
        
        const liveWallet = liveState.rows[0];
        console.log('Latest LiveWalletState:', liveWallet);

        // Update the WalletSummary with the same values
        console.log('\n=== Updating WalletSummary ===');
        const updateResult = await client.query(`
            UPDATE wallet_summaries 
            SET total_equity = $1, 
                available_balance = $2, 
                total_realized_pnl = $3, 
                unrealized_pnl = $4,
                updated_date = NOW()
            WHERE trading_mode = 'testnet'
            RETURNING *
        `, [
            liveWallet.total_equity,
            liveWallet.available_balance,
            liveWallet.total_realized_pnl,
            liveWallet.unrealized_pnl
        ]);
        
        console.log('Updated WalletSummary:', updateResult.rows[0]);

        // Verify the update
        console.log('\n=== Verifying update ===');
        const verifyResult = await client.query(`
            SELECT id, trading_mode, total_equity, available_balance, total_realized_pnl, unrealized_pnl
            FROM wallet_summaries 
            WHERE trading_mode = 'testnet'
        `);
        
        console.log('Updated WalletSummary:', verifyResult.rows[0]);

    } catch (error) {
        console.error('❌ Error updating wallet summary:', error);
    } finally {
        await client.end();
    }
}

updateWalletSummary();
