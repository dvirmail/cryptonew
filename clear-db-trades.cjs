const { Client } = require('pg');

async function clearAllTrades() {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'dvirturkenitch',
        user: 'postgres',
        password: 'postgres'
    });

    try {
        await client.connect();
        console.log('🔗 Connected to PostgreSQL database');

        // Check current count
        const countResult = await client.query('SELECT COUNT(*) as count FROM trades');
        console.log(`📊 Current trades in database: ${countResult.rows[0].count}`);

        if (countResult.rows[0].count > 0) {
            // Delete all trades
            const deleteResult = await client.query('DELETE FROM trades');
            console.log(`🗑️ Deleted ${deleteResult.rowCount} trades from database`);

            // Verify deletion
            const verifyResult = await client.query('SELECT COUNT(*) as count FROM trades');
            console.log(`✅ Remaining trades in database: ${verifyResult.rows[0].count}`);
        } else {
            console.log('✅ Database already clean - no trades to delete');
        }

    } catch (error) {
        console.error('❌ Error clearing trades from database:', error.message);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed');
    }
}

clearAllTrades();
