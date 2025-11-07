-- ============================================
-- Add Entry and Exit Fill Time Fields
-- ============================================
-- Adds order execution timing metrics to track fill performance
-- 
-- entry_fill_time_ms: Time in milliseconds for order to fill at entry
-- exit_fill_time_ms: Time in milliseconds for order to fill at exit
-- ============================================

-- Add to live_positions table
ALTER TABLE live_positions 
ADD COLUMN IF NOT EXISTS entry_fill_time_ms INTEGER;

COMMENT ON COLUMN live_positions.entry_fill_time_ms IS 'Time in milliseconds for the entry order to fill (order submission to execution)';

-- Add to trades table
ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS entry_fill_time_ms INTEGER;

COMMENT ON COLUMN trades.entry_fill_time_ms IS 'Time in milliseconds for the entry order to fill (order submission to execution)';

ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS exit_fill_time_ms INTEGER;

COMMENT ON COLUMN trades.exit_fill_time_ms IS 'Time in milliseconds for the exit order to fill (order submission to execution)';

-- Add indexes for performance (if needed for analytics queries)
CREATE INDEX IF NOT EXISTS idx_live_positions_entry_fill_time_ms 
ON live_positions(entry_fill_time_ms) 
WHERE entry_fill_time_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_entry_fill_time_ms 
ON trades(entry_fill_time_ms) 
WHERE entry_fill_time_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_exit_fill_time_ms 
ON trades(exit_fill_time_ms) 
WHERE exit_fill_time_ms IS NOT NULL;

-- Verify columns were added
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'live_positions' AND column_name = 'entry_fill_time_ms'
    ) THEN
        RAISE NOTICE '✅ entry_fill_time_ms column added to live_positions';
    ELSE
        RAISE EXCEPTION '❌ Failed to add entry_fill_time_ms to live_positions';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trades' AND column_name = 'entry_fill_time_ms'
    ) THEN
        RAISE NOTICE '✅ entry_fill_time_ms column added to trades';
    ELSE
        RAISE EXCEPTION '❌ Failed to add entry_fill_time_ms to trades';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trades' AND column_name = 'exit_fill_time_ms'
    ) THEN
        RAISE NOTICE '✅ exit_fill_time_ms column added to trades';
    ELSE
        RAISE EXCEPTION '❌ Failed to add exit_fill_time_ms to trades';
    END IF;
END $$;

