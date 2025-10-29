const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function cleanupTrades() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('✅ Connected to PostgreSQL database');

        // First, let's see what trade-related tables exist
        console.log('\n🔍 Checking for trade-related tables...');
        const tablesQuery = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%trade%' 
            OR table_name LIKE '%position%'
            OR table_name LIKE '%wallet%'
            ORDER BY table_name
        `);
        
        console.log('Found tables:', tablesQuery.rows.map(row => row.table_name));

        // Count records before deletion
        console.log('\n📊 Counting records before cleanup...');
        
        const countQueries = [
            { name: 'trades', query: 'SELECT COUNT(*) FROM trades' },
            { name: 'live_positions', query: 'SELECT COUNT(*) FROM live_positions' },
            { name: 'wallet_summaries', query: 'SELECT COUNT(*) FROM wallet_summaries' },
            { name: 'central_wallet_states', query: 'SELECT COUNT(*) FROM central_wallet_states' },
            { name: 'historical_performances', query: 'SELECT COUNT(*) FROM historical_performances' },
            { name: 'live_wallet_state', query: 'SELECT COUNT(*) FROM live_wallet_state' },
            { name: 'virtual_wallet_state', query: 'SELECT COUNT(*) FROM virtual_wallet_state' }
        ];

        for (const { name, query } of countQueries) {
            try {
                const result = await client.query(query);
                console.log(`- ${name}: ${result.rows[0].count} records`);
            } catch (error) {
                console.log(`- ${name}: Table doesn't exist or error - ${error.message}`);
            }
        }

        // Ask for confirmation
        console.log('\n⚠️  WARNING: This will delete ALL trade records and related data!');
        console.log('This action cannot be undone.');
        
        // For automated execution, we'll proceed (you can modify this if you want manual confirmation)
        console.log('\n🗑️  Proceeding with cleanup...');

        // Delete records from trade-related tables
        const deleteQueries = [
            { name: 'trades', query: 'DELETE FROM trades' },
            { name: 'live_positions', query: 'DELETE FROM live_positions' },
            { name: 'wallet_summaries', query: 'DELETE FROM wallet_summaries' },
            { name: 'central_wallet_states', query: 'DELETE FROM central_wallet_states' },
            { name: 'historical_performances', query: 'DELETE FROM historical_performances' },
            { name: 'live_wallet_state', query: 'DELETE FROM live_wallet_state' },
            { name: 'virtual_wallet_state', query: 'DELETE FROM virtual_wallet_state' }
        ];

        let totalDeleted = 0;
        for (const { name, query } of deleteQueries) {
            try {
                const result = await client.query(query);
                console.log(`✅ Deleted ${result.rowCount} records from ${name}`);
                totalDeleted += result.rowCount;
            } catch (error) {
                console.log(`⚠️  ${name}: ${error.message}`);
            }
        }

        // Reset auto-increment sequences
        console.log('\n🔄 Resetting auto-increment sequences...');
        const resetQueries = [
            'ALTER SEQUENCE trades_id_seq RESTART WITH 1',
            'ALTER SEQUENCE live_positions_id_seq RESTART WITH 1',
            'ALTER SEQUENCE wallet_summaries_id_seq RESTART WITH 1',
            'ALTER SEQUENCE central_wallet_states_id_seq RESTART WITH 1',
            'ALTER SEQUENCE historical_performances_id_seq RESTART WITH 1',
            'ALTER SEQUENCE live_wallet_state_id_seq RESTART WITH 1',
            'ALTER SEQUENCE virtual_wallet_state_id_seq RESTART WITH 1'
        ];

        for (const query of resetQueries) {
            try {
                await client.query(query);
                console.log(`✅ Reset sequence: ${query.split(' ')[2]}`);
            } catch (error) {
                console.log(`⚠️  Sequence reset failed: ${error.message}`);
            }
        }

        // Count records after deletion
        console.log('\n📊 Counting records after cleanup...');
        for (const { name, query } of countQueries) {
            try {
                const result = await client.query(query);
                console.log(`- ${name}: ${result.rows[0].count} records`);
            } catch (error) {
                console.log(`- ${name}: Table doesn't exist or error - ${error.message}`);
            }
        }

        console.log(`\n🎉 Cleanup completed! Total records deleted: ${totalDeleted}`);
        console.log('✅ All trade records have been removed from the database');

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await client.end();
    }
}

cleanupTrades();
