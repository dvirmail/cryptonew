-- Add analytics fields to trades table for better performance analytics
-- Migration: 005_add_analytics_fields_to_trades.sql
-- Description: Adds missing analytics fields to trades table to match live_positions

-- Add Fear & Greed Index fields to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fear_greed_score INTEGER;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fear_greed_classification VARCHAR(50);

-- Add LPM (Performance Momentum) score field to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS lpm_score DECIMAL(5,2);

-- Add other missing analytics fields that should be stored
ALTER TABLE trades ADD COLUMN IF NOT EXISTS combined_strength DECIMAL(10,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS conviction_breakdown JSONB;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS conviction_multiplier DECIMAL(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_regime VARCHAR(50);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS regime_confidence DECIMAL(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS atr_value DECIMAL(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_event_driven_strategy BOOLEAN DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS trigger_signals JSONB;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS trading_mode VARCHAR(50);

-- Add indexes for better query performance on analytics fields
CREATE INDEX IF NOT EXISTS idx_trades_fear_greed_score ON trades(fear_greed_score);
CREATE INDEX IF NOT EXISTS idx_trades_lpm_score ON trades(lpm_score);
CREATE INDEX IF NOT EXISTS idx_trades_market_regime ON trades(market_regime);
CREATE INDEX IF NOT EXISTS idx_trades_conviction_score ON trades(conviction_score);
CREATE INDEX IF NOT EXISTS idx_trades_combined_strength ON trades(combined_strength);
CREATE INDEX IF NOT EXISTS idx_trades_trading_mode ON trades(trading_mode);

-- Add comments to document the new fields
COMMENT ON COLUMN trades.fear_greed_score IS 'Fear & Greed Index score (0-100) at time of position opening';
COMMENT ON COLUMN trades.fear_greed_classification IS 'Fear & Greed Index classification (Extreme Fear, Fear, Neutral, Greed, Extreme Greed)';
COMMENT ON COLUMN trades.lpm_score IS 'Performance Momentum Score (0-100) at time of position opening';
COMMENT ON COLUMN trades.combined_strength IS 'Combined signal strength that triggered the position';
COMMENT ON COLUMN trades.conviction_breakdown IS 'Detailed breakdown of conviction score components';
COMMENT ON COLUMN trades.conviction_multiplier IS 'Conviction multiplier applied to the position';
COMMENT ON COLUMN trades.market_regime IS 'Market regime classification (uptrend, downtrend, sideways, etc.)';
COMMENT ON COLUMN trades.regime_confidence IS 'Confidence level of market regime classification (0-100)';
COMMENT ON COLUMN trades.atr_value IS 'Average True Range value at time of position opening';
COMMENT ON COLUMN trades.is_event_driven_strategy IS 'Whether the strategy is event-driven';
COMMENT ON COLUMN trades.trigger_signals IS 'Array of all signals that triggered this position';
COMMENT ON COLUMN trades.trading_mode IS 'Trading mode (testnet, live) when position was opened';
