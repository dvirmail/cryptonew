-- Add missing columns to trades table
-- Run this SQL script to add the missing columns

-- CRITICAL: Add position_id column (VARCHAR) - Required for duplicate detection
ALTER TABLE trades ADD COLUMN IF NOT EXISTS position_id VARCHAR(255);

-- Add duration_seconds column (INTEGER)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- Add duration_hours column (DECIMAL for decimal hours)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(10,4);

-- Add exit_reason column (VARCHAR)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(50);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id);
CREATE INDEX IF NOT EXISTS idx_trades_duration_seconds ON trades(duration_seconds);
CREATE INDEX IF NOT EXISTS idx_trades_duration_hours ON trades(duration_hours);
CREATE INDEX IF NOT EXISTS idx_trades_exit_reason ON trades(exit_reason);

-- Add comments to document the new fields
COMMENT ON COLUMN trades.position_id IS 'Position ID from live_positions table - used for duplicate detection';
COMMENT ON COLUMN trades.duration_seconds IS 'Position duration in seconds (for backwards compatibility)';
COMMENT ON COLUMN trades.duration_hours IS 'Position duration in hours (decimal, e.g., 1.5 = 1 hour 30 minutes)';
COMMENT ON COLUMN trades.exit_reason IS 'Reason for position exit (timeout, stop_loss, take_profit, trailing_stop_hit, manual_close, etc.)';

