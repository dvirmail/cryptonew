-- 006_add_scanner_flags_to_backtest_combinations.sql
-- Ensure backtest_combinations table has includedInScanner and includedInLiveScanner columns
-- This migration is idempotent - safe to run multiple times

-- Check if backtest_combinations table exists, if not, it will be created by Base44/Supabase
-- We just ensure the columns exist

-- Add includedInScanner column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'backtest_combinations' 
        AND column_name = 'includedInScanner'
    ) THEN
        ALTER TABLE backtest_combinations 
        ADD COLUMN "includedInScanner" BOOLEAN DEFAULT false;
        
        RAISE NOTICE 'Added includedInScanner column to backtest_combinations';
    ELSE
        RAISE NOTICE 'includedInScanner column already exists in backtest_combinations';
    END IF;
END $$;

-- Add includedInLiveScanner column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'backtest_combinations' 
        AND column_name = 'includedInLiveScanner'
    ) THEN
        ALTER TABLE backtest_combinations 
        ADD COLUMN "includedInLiveScanner" BOOLEAN DEFAULT false;
        
        RAISE NOTICE 'Added includedInLiveScanner column to backtest_combinations';
    ELSE
        RAISE NOTICE 'includedInLiveScanner column already exists in backtest_combinations';
    END IF;
END $$;

-- Create indexes for better query performance (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_backtest_combinations_includedInScanner 
ON backtest_combinations("includedInScanner") 
WHERE "includedInScanner" = true;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_includedInLiveScanner 
ON backtest_combinations("includedInLiveScanner") 
WHERE "includedInLiveScanner" = true;

-- Add comment to document the columns
COMMENT ON COLUMN backtest_combinations."includedInScanner" IS 'Flag indicating if strategy is enabled for demo/testnet scanner';
COMMENT ON COLUMN backtest_combinations."includedInLiveScanner" IS 'Flag indicating if strategy is enabled for live/production scanner';

