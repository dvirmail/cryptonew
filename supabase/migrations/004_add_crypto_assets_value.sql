-- 004_add_crypto_assets_value.sql
-- Add crypto_assets_value column to central_wallet_state table

-- Add crypto_assets_value column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'central_wallet_state' 
        AND column_name = 'crypto_assets_value'
    ) THEN
        ALTER TABLE central_wallet_state 
        ADD COLUMN crypto_assets_value DECIMAL(20,8) DEFAULT 0;
        
        -- Update existing records to have crypto_assets_value = 0
        UPDATE central_wallet_state 
        SET crypto_assets_value = 0 
        WHERE crypto_assets_value IS NULL;
    END IF;
END $$;
