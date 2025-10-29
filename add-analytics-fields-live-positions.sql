-- Add analytics fields to live_positions table to match the data being stored
-- This ensures open positions have all the same analytics data as closed positions

-- Add analytics fields to live_positions table
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS strategy_name VARCHAR(100);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS direction VARCHAR(10);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS quantity_crypto NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS entry_value_usdt NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open';
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS stop_loss_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS take_profit_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS is_trailing BOOLEAN DEFAULT false;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS trailing_stop_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS trailing_peak_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS peak_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS trough_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS time_exit_hours NUMERIC(10,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS wallet_id VARCHAR(100);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS last_updated_timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS last_price_update TIMESTAMP WITH TIME ZONE;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS binance_order_id VARCHAR(100);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS binance_executed_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS binance_executed_quantity NUMERIC(20,8);

-- Add analytics fields that match trades table
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS trigger_signals JSONB;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS combined_strength NUMERIC(10,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS conviction_score INTEGER;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS conviction_breakdown JSONB;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS conviction_multiplier NUMERIC(5,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS market_regime VARCHAR(50);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS regime_confidence NUMERIC(5,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS atr_value NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS is_event_driven_strategy BOOLEAN DEFAULT false;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS fear_greed_score INTEGER;
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS fear_greed_classification VARCHAR(50);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS lpm_score NUMERIC(5,2);

-- Add indexes for better query performance on analytics fields
CREATE INDEX IF NOT EXISTS idx_live_positions_strategy_name ON live_positions(strategy_name);
CREATE INDEX IF NOT EXISTS idx_live_positions_status ON live_positions(status);
CREATE INDEX IF NOT EXISTS idx_live_positions_conviction_score ON live_positions(conviction_score);
CREATE INDEX IF NOT EXISTS idx_live_positions_combined_strength ON live_positions(combined_strength);
CREATE INDEX IF NOT EXISTS idx_live_positions_market_regime ON live_positions(market_regime);
CREATE INDEX IF NOT EXISTS idx_live_positions_fear_greed_score ON live_positions(fear_greed_score);
CREATE INDEX IF NOT EXISTS idx_live_positions_lpm_score ON live_positions(lpm_score);

-- Add comments to document the new fields
COMMENT ON COLUMN live_positions.strategy_name IS 'Name of the trading strategy that opened this position';
COMMENT ON COLUMN live_positions.direction IS 'Direction of the position (long/short)';
COMMENT ON COLUMN live_positions.quantity_crypto IS 'Quantity of cryptocurrency in the position';
COMMENT ON COLUMN live_positions.entry_value_usdt IS 'Entry value of the position in USDT';
COMMENT ON COLUMN live_positions.status IS 'Current status of the position (open/trailing/closed)';
COMMENT ON COLUMN live_positions.fear_greed_score IS 'Fear & Greed Index score (0-100) at time of position opening';
COMMENT ON COLUMN live_positions.fear_greed_classification IS 'Fear & Greed Index classification (Extreme Fear, Fear, Neutral, Greed, Extreme Greed)';
COMMENT ON COLUMN live_positions.lpm_score IS 'LPM (Performance Momentum) score at time of position opening';
COMMENT ON COLUMN live_positions.market_regime IS 'Market regime classification at time of position opening';
COMMENT ON COLUMN live_positions.regime_confidence IS 'Confidence level of the market regime classification';
COMMENT ON COLUMN live_positions.combined_strength IS 'Combined strength score of all signals that triggered this position';
COMMENT ON COLUMN live_positions.conviction_score IS 'Conviction score for this position';
COMMENT ON COLUMN live_positions.trigger_signals IS 'JSON array of signals that triggered this position';
