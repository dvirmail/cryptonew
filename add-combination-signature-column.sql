-- ============================================
-- Add combination_signature column for duplicate detection
-- ============================================
-- This migration adds combination_signature column to properly detect duplicates
-- based on signals and timeframe, regardless of combination_name variations
-- ============================================

-- Add combination_signature column if it doesn't exist
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS combination_signature VARCHAR(500);
COMMENT ON COLUMN backtest_combinations.combination_signature IS 'Unique signature based on signals and timeframe for duplicate detection (format: TF:timeframe|signal1+!signal2+!)';

-- Create unique index on combination_signature (allows NULL for existing rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_combinations_signature 
ON backtest_combinations(combination_signature) 
WHERE combination_signature IS NOT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_backtest_combinations_signature_lookup 
ON backtest_combinations(combination_signature);

COMMENT ON INDEX idx_backtest_combinations_signature IS 'Unique constraint on combination_signature for duplicate detection';


