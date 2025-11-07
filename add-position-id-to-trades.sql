-- Add position_id column to trades table for duplicate detection
-- Migration: add-position-id-to-trades.sql
-- Description: Adds position_id column to trades table to enable duplicate detection by position ID

-- Add position_id column if it doesn't exist
ALTER TABLE trades ADD COLUMN IF NOT EXISTS position_id VARCHAR(100);

-- Add index on position_id for faster duplicate lookups
CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id);

-- Add comment to document the field
COMMENT ON COLUMN trades.position_id IS 'Reference to the original position ID (from live_positions.position_id) for duplicate detection';

