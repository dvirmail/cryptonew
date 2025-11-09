-- Prevent Duplicate Trades - Database Constraints
-- This script adds unique constraints to prevent duplicate trades at the database level
-- Run this to ensure data integrity

-- ============================================
-- 1. UNIQUE CONSTRAINT ON position_id
-- ============================================
-- Most reliable: Each position should only have ONE trade record
-- This prevents the same position from creating multiple trade records

-- First, clean up any existing duplicates by position_id (keep the earliest one)
DO $$
DECLARE
    dup_record RECORD;
BEGIN
    FOR dup_record IN
        SELECT position_id, MIN(id) as keep_id, COUNT(*) as dup_count
        FROM trades
        WHERE position_id IS NOT NULL
        GROUP BY position_id
        HAVING COUNT(*) > 1
    LOOP
        -- Delete duplicates, keeping the one with the earliest exit_timestamp (or earliest id if exit_timestamp is null)
        DELETE FROM trades
        WHERE position_id = dup_record.position_id
          AND id != dup_record.keep_id
          AND id IN (
              SELECT id FROM trades
              WHERE position_id = dup_record.position_id
              ORDER BY 
                  CASE WHEN exit_timestamp IS NOT NULL THEN exit_timestamp ELSE '1970-01-01'::timestamp END,
                  id
              OFFSET 1
          );
        
        RAISE NOTICE 'Removed % duplicate(s) for position_id: %', dup_record.dup_count - 1, dup_record.position_id;
    END LOOP;
END $$;

-- Add unique constraint on position_id (where it's not null)
-- This prevents future duplicates at the database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unique_position_id 
ON trades(position_id) 
WHERE position_id IS NOT NULL;

-- ============================================
-- 2. UNIQUE CONSTRAINT ON TRADE CHARACTERISTICS
-- ============================================
-- Fallback: Prevent duplicates based on trade characteristics
-- This catches cases where position_id might be missing or null

-- First, clean up any existing duplicates by characteristics
DO $$
DECLARE
    dup_record RECORD;
BEGIN
    FOR dup_record IN
        SELECT 
            symbol,
            COALESCE(strategy_name, '') as strategy_name,
            entry_price,
            exit_price,
            quantity,
            DATE_TRUNC('second', entry_timestamp) as entry_timestamp_rounded,
            trading_mode,
            MIN(id) as keep_id,
            COUNT(*) as dup_count
        FROM trades
        WHERE exit_timestamp IS NOT NULL
          AND entry_price > 0
          AND quantity > 0
        GROUP BY 
            symbol,
            COALESCE(strategy_name, ''),
            entry_price,
            exit_price,
            quantity,
            DATE_TRUNC('second', entry_timestamp),
            trading_mode
        HAVING COUNT(*) > 1
    LOOP
        -- Delete duplicates, keeping the one with the earliest exit_timestamp
        DELETE FROM trades
        WHERE symbol = dup_record.symbol
          AND COALESCE(strategy_name, '') = dup_record.strategy_name
          AND ABS(entry_price - dup_record.entry_price) < 0.0001
          AND ABS(exit_price - dup_record.exit_price) < 0.0001
          AND ABS(quantity - dup_record.quantity) < 0.000001
          AND DATE_TRUNC('second', entry_timestamp) = dup_record.entry_timestamp_rounded
          AND trading_mode = dup_record.trading_mode
          AND exit_timestamp IS NOT NULL
          AND id != dup_record.keep_id
          AND id IN (
              SELECT id FROM trades
              WHERE symbol = dup_record.symbol
                AND COALESCE(strategy_name, '') = dup_record.strategy_name
                AND ABS(entry_price - dup_record.entry_price) < 0.0001
                AND ABS(exit_price - dup_record.exit_price) < 0.0001
                AND ABS(quantity - dup_record.quantity) < 0.000001
                AND DATE_TRUNC('second', entry_timestamp) = dup_record.entry_timestamp_rounded
                AND trading_mode = dup_record.trading_mode
                AND exit_timestamp IS NOT NULL
              ORDER BY exit_timestamp ASC, id ASC
              OFFSET 1
          );
        
        RAISE NOTICE 'Removed % duplicate(s) for trade: % | % | % | % | % | %', 
            dup_record.dup_count - 1,
            dup_record.symbol,
            dup_record.strategy_name,
            dup_record.entry_price,
            dup_record.exit_price,
            dup_record.entry_timestamp_rounded,
            dup_record.trading_mode;
    END LOOP;
END $$;

-- Add unique constraint on trade characteristics (partial index for closed trades only)
-- This prevents future duplicates based on trade characteristics
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unique_characteristics
ON trades(
    symbol,
    COALESCE(strategy_name, ''),
    entry_price,
    exit_price,
    quantity,
    DATE_TRUNC('second', entry_timestamp),
    trading_mode
)
WHERE exit_timestamp IS NOT NULL 
  AND entry_price > 0 
  AND quantity > 0;

-- ============================================
-- 3. VERIFICATION QUERIES
-- ============================================

-- Check for remaining duplicates by position_id
SELECT 
    position_id,
    COUNT(*) as duplicate_count,
    ARRAY_AGG(id ORDER BY exit_timestamp ASC NULLS LAST, id ASC) as trade_ids
FROM trades
WHERE position_id IS NOT NULL
GROUP BY position_id
HAVING COUNT(*) > 1;

-- Check for remaining duplicates by characteristics
SELECT 
    symbol,
    COALESCE(strategy_name, '') as strategy_name,
    entry_price,
    exit_price,
    quantity,
    DATE_TRUNC('second', entry_timestamp) as entry_timestamp_rounded,
    trading_mode,
    COUNT(*) as duplicate_count,
    ARRAY_AGG(id ORDER BY exit_timestamp ASC, id ASC) as trade_ids
FROM trades
WHERE exit_timestamp IS NOT NULL
  AND entry_price > 0
  AND quantity > 0
GROUP BY 
    symbol,
    COALESCE(strategy_name, ''),
    entry_price,
    exit_price,
    quantity,
    DATE_TRUNC('second', entry_timestamp),
    trading_mode
HAVING COUNT(*) > 1;

-- ============================================
-- 4. SUMMARY
-- ============================================
-- After running this script:
-- 1. All existing duplicates will be removed (keeping the earliest trade in each group)
-- 2. Unique constraints will prevent future duplicates at the database level
-- 3. The application's duplicate detection (in saveTradeToDB) will still work as a first line of defense
-- 4. If a duplicate is attempted, PostgreSQL will raise an error instead of silently creating it

