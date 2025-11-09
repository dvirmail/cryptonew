-- Add dust aggregation fields to live_positions table
-- This enables tracking of dust positions and their aggregation status

-- Add dust status field
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS dust_status VARCHAR(50);
-- Values: 'dust_pending', 'dust_ready', 'dust_aggregated', NULL (normal position)

-- Add aggregated position reference
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS aggregated_position_id VARCHAR(255);
-- Reference to the main aggregated position ID (for positions that were merged)

-- Add accumulated quantity field (for aggregated positions)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS accumulated_quantity NUMERIC(20,8);
-- Total accumulated quantity for aggregated dust positions

-- Add aggregated position IDs (JSON array of original position IDs)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS aggregated_position_ids JSONB;
-- Array of position IDs that were aggregated into this position

-- Add note field for status messages
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS note TEXT;
-- Status message like "Below nominal quantity, waiting for additional quantity"

-- Create index on dust_status for faster queries
CREATE INDEX IF NOT EXISTS idx_live_positions_dust_status ON live_positions(dust_status) WHERE dust_status IS NOT NULL;

-- Create index on aggregated_position_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_live_positions_aggregated_position_id ON live_positions(aggregated_position_id) WHERE aggregated_position_id IS NOT NULL;

