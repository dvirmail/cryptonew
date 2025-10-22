const { Client } = require('pg');

async function fixSchema() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'dvirturkenitch',
    // No user/password as specified
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');

    // Add missing updated_date columns
    console.log('Adding updated_date column to live_wallet_states...');
    await client.query(`
      ALTER TABLE live_wallet_states 
      ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    `);

    console.log('Adding updated_date column to wallet_summaries...');
    await client.query(`
      ALTER TABLE wallet_summaries 
      ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    `);

    console.log('Adding updated_date column to opted_out_combinations...');
    await client.query(`
      ALTER TABLE opted_out_combinations 
      ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    `);

    // Create function for updating updated_date
    console.log('Creating update function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_date_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_date = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Create triggers
    console.log('Creating triggers...');
    
    // Live wallet states trigger
    await client.query(`
      DROP TRIGGER IF EXISTS update_live_wallet_states_updated_date ON live_wallet_states
    `);
    await client.query(`
      CREATE TRIGGER update_live_wallet_states_updated_date
          BEFORE UPDATE ON live_wallet_states
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_date_column()
    `);

    // Wallet summaries trigger
    await client.query(`
      DROP TRIGGER IF EXISTS update_wallet_summaries_updated_date ON wallet_summaries
    `);
    await client.query(`
      CREATE TRIGGER update_wallet_summaries_updated_date
          BEFORE UPDATE ON wallet_summaries
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_date_column()
    `);

    // Opted out combinations trigger
    await client.query(`
      DROP TRIGGER IF EXISTS update_opted_out_combinations_updated_date ON opted_out_combinations
    `);
    await client.query(`
      CREATE TRIGGER update_opted_out_combinations_updated_date
          BEFORE UPDATE ON opted_out_combinations
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_date_column()
    `);

    console.log('✅ Database schema fixed successfully!');
    
  } catch (error) {
    console.error('❌ Error fixing schema:', error);
  } finally {
    await client.end();
  }
}

fixSchema();
