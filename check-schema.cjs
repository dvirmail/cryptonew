const { Client } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function checkSchema() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Check wallet_summaries table structure
        console.log('\n=== Wallet Summaries Schema ===');
        const summariesSchema = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'wallet_summaries'
            ORDER BY ordinal_position
        `);
        
        console.log('wallet_summaries columns:');
        summariesSchema.rows.forEach(row => {
            console.log(`- ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });

        // Check if there are any records
        console.log('\n=== Wallet Summaries Data ===');
        const summaries = await client.query(`
            SELECT * FROM wallet_summaries LIMIT 5
        `);
        
        console.log(`Found ${summaries.rows.length} wallet summaries`);
        if (summaries.rows.length > 0) {
            console.log('Sample record:', summaries.rows[0]);
        }

    } catch (error) {
        console.error('❌ Error checking schema:', error);
    } finally {
        await client.end();
    }
}

checkSchema();
