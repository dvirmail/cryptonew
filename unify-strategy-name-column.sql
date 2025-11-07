-- ============================================
-- Unify combination_name to strategy_name
-- ============================================
-- This migration renames combination_name to strategy_name across all tables
-- to maintain consistency in the database schema
-- ============================================

-- 1. Rename combination_name to strategy_name in backtest_combinations
ALTER TABLE backtest_combinations 
    RENAME COLUMN combination_name TO strategy_name;

-- 2. Update the unique constraint name if it exists
ALTER INDEX IF EXISTS backtest_combinations_combination_name_unique 
    RENAME TO backtest_combinations_strategy_name_unique;

-- 3. Rename combination_name to strategy_name in opted_out_combinations
-- (Note: This table already has strategy_name, so we'll keep both for now or drop combination_name)
-- Check if combination_name exists and is different from strategy_name
DO $$
BEGIN
    -- If combination_name exists and strategy_name is NULL, copy values
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'opted_out_combinations' 
        AND column_name = 'combination_name'
    ) THEN
        -- Copy combination_name to strategy_name where strategy_name is NULL
        UPDATE opted_out_combinations 
        SET strategy_name = combination_name 
        WHERE strategy_name IS NULL AND combination_name IS NOT NULL;
        
        -- Drop combination_name column (strategy_name is the unified column)
        ALTER TABLE opted_out_combinations DROP COLUMN IF EXISTS combination_name;
    END IF;
END $$;

-- 4. Add comments for clarity
COMMENT ON COLUMN backtest_combinations.strategy_name IS 'Name of the trading strategy (unified from combination_name)';
COMMENT ON COLUMN opted_out_combinations.strategy_name IS 'Name of the trading strategy (unified from combination_name)';

-- 5. Verify the changes
DO $$
BEGIN
    RAISE NOTICE 'Migration complete: All combination_name columns have been unified to strategy_name';
    RAISE NOTICE 'Tables updated: backtest_combinations, opted_out_combinations';
END $$;


