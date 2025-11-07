-- ============================================
-- Entry Quality Analytics Migration
-- Adds fields to capture entry quality metrics for better success/failure analysis
-- ============================================

-- Entry Quality Context Fields
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_near_support BOOLEAN;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_near_resistance BOOLEAN;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_distance_to_support_percent NUMERIC(10,4);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_distance_to_resistance_percent NUMERIC(10,4);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_momentum_score NUMERIC(5,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_relative_to_day_high_percent NUMERIC(10,4);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_relative_to_day_low_percent NUMERIC(10,4);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_volume_vs_average NUMERIC(10,4);

-- Add same fields to trades table for historical analysis
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_near_support BOOLEAN;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_near_resistance BOOLEAN;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_distance_to_support_percent NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_distance_to_resistance_percent NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_momentum_score NUMERIC(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_relative_to_day_high_percent NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_relative_to_day_low_percent NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_volume_vs_average NUMERIC(10,4);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_live_positions_entry_near_support ON live_positions(entry_near_support);
CREATE INDEX IF NOT EXISTS idx_live_positions_entry_momentum_score ON live_positions(entry_momentum_score);
CREATE INDEX IF NOT EXISTS idx_trades_entry_near_support ON trades(entry_near_support);
CREATE INDEX IF NOT EXISTS idx_trades_entry_momentum_score ON trades(entry_momentum_score);

-- Add comments to document the new fields
COMMENT ON COLUMN live_positions.entry_near_support IS 'Entry price within 2% of nearest support level';
COMMENT ON COLUMN live_positions.entry_near_resistance IS 'Entry price within 2% of nearest resistance level';
COMMENT ON COLUMN live_positions.entry_distance_to_support_percent IS 'Distance from entry price to nearest support level (% of entry price)';
COMMENT ON COLUMN live_positions.entry_distance_to_resistance_percent IS 'Distance from entry price to nearest resistance level (% of entry price)';
COMMENT ON COLUMN live_positions.entry_momentum_score IS 'Momentum score at entry (0-100) based on price velocity over last 5 candles';
COMMENT ON COLUMN live_positions.entry_relative_to_day_high_percent IS 'Entry price as % of day high (0-100)';
COMMENT ON COLUMN live_positions.entry_relative_to_day_low_percent IS 'Entry price as % of day low (0-100)';
COMMENT ON COLUMN live_positions.entry_volume_vs_average IS 'Entry volume / 20-period average volume ratio';

COMMENT ON COLUMN trades.entry_near_support IS 'Entry price within 2% of nearest support level';
COMMENT ON COLUMN trades.entry_near_resistance IS 'Entry price within 2% of nearest resistance level';
COMMENT ON COLUMN trades.entry_distance_to_support_percent IS 'Distance from entry price to nearest support level (% of entry price)';
COMMENT ON COLUMN trades.entry_distance_to_resistance_percent IS 'Distance from entry price to nearest resistance level (% of entry price)';
COMMENT ON COLUMN trades.entry_momentum_score IS 'Momentum score at entry (0-100) based on price velocity over last 5 candles';
COMMENT ON COLUMN trades.entry_relative_to_day_high_percent IS 'Entry price as % of day high (0-100)';
COMMENT ON COLUMN trades.entry_relative_to_day_low_percent IS 'Entry price as % of day low (0-100)';
COMMENT ON COLUMN trades.entry_volume_vs_average IS 'Entry volume / 20-period average volume ratio';

