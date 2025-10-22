-- Fix missing updated_date columns in database schema
-- Add updated_date column to live_wallet_states table
ALTER TABLE live_wallet_states ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add updated_date column to wallet_summaries table  
ALTER TABLE wallet_summaries ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add updated_date column to opted_out_combinations table
ALTER TABLE opted_out_combinations ADD COLUMN IF NOT EXISTS updated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create triggers to automatically update updated_date on row changes
CREATE OR REPLACE FUNCTION update_updated_date_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_date = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for live_wallet_states
DROP TRIGGER IF EXISTS update_live_wallet_states_updated_date ON live_wallet_states;
CREATE TRIGGER update_live_wallet_states_updated_date
    BEFORE UPDATE ON live_wallet_states
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_date_column();

-- Create triggers for wallet_summaries
DROP TRIGGER IF EXISTS update_wallet_summaries_updated_date ON wallet_summaries;
CREATE TRIGGER update_wallet_summaries_updated_date
    BEFORE UPDATE ON wallet_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_date_column();

-- Create triggers for opted_out_combinations
DROP TRIGGER IF EXISTS update_opted_out_combinations_updated_date ON opted_out_combinations;
CREATE TRIGGER update_opted_out_combinations_updated_date
    BEFORE UPDATE ON opted_out_combinations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_date_column();
