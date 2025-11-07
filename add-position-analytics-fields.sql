-- Add new analytics fields to live_positions table for position opening data
-- These fields capture the state of the market and system when a position was opened

-- Stop Loss and Take Profit prices (ensure they exist)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS stop_loss_price NUMERIC(20,8);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS take_profit_price NUMERIC(20,8);

-- Volatility at position opening (from ATR percentile or market volatility)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS volatility_at_open NUMERIC(5,2);
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS volatility_label_at_open VARCHAR(50);

-- Regime impact on signal strength (from unified strength calculator)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS regime_impact_on_strength NUMERIC(10,4);

-- Correlation impact on signal strength (from unified strength calculator)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS correlation_impact_on_strength NUMERIC(10,4);

-- Effective balance risk when position was opened (EBR - 0-100)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS effective_balance_risk_at_open NUMERIC(5,2);

-- Bitcoin price when position was opened
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS btc_price_at_open NUMERIC(20,8);

-- Calculated exit time (entry_timestamp + time_exit_hours)
ALTER TABLE live_positions ADD COLUMN IF NOT EXISTS exit_time TIMESTAMP WITH TIME ZONE;

-- Add same fields to trades table for historical analysis
ALTER TABLE trades ADD COLUMN IF NOT EXISTS stop_loss_price NUMERIC(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS take_profit_price NUMERIC(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volatility_at_open NUMERIC(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volatility_label_at_open VARCHAR(50);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS regime_impact_on_strength NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS correlation_impact_on_strength NUMERIC(10,4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS effective_balance_risk_at_open NUMERIC(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS btc_price_at_open NUMERIC(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_time TIMESTAMP WITH TIME ZONE;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_live_positions_volatility_at_open ON live_positions(volatility_at_open);
CREATE INDEX IF NOT EXISTS idx_live_positions_btc_price_at_open ON live_positions(btc_price_at_open);
CREATE INDEX IF NOT EXISTS idx_trades_volatility_at_open ON trades(volatility_at_open);
CREATE INDEX IF NOT EXISTS idx_trades_btc_price_at_open ON trades(btc_price_at_open);
CREATE INDEX IF NOT EXISTS idx_live_positions_exit_time ON live_positions(exit_time);
CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_time);

-- Add comments to document the new fields
COMMENT ON COLUMN live_positions.stop_loss_price IS 'Stop loss price set when position was opened';
COMMENT ON COLUMN live_positions.take_profit_price IS 'Take profit price set when position was opened';
COMMENT ON COLUMN live_positions.volatility_at_open IS 'Volatility score (0-100) at time of position opening, calculated from ADX/BBW or ATR percentile';
COMMENT ON COLUMN live_positions.volatility_label_at_open IS 'Volatility label (LOW/MEDIUM/HIGH) at time of position opening';
COMMENT ON COLUMN live_positions.regime_impact_on_strength IS 'Regime adjustment impact on combined signal strength (from unified calculator)';
COMMENT ON COLUMN live_positions.correlation_impact_on_strength IS 'Correlation adjustment impact on combined signal strength (from unified calculator)';
COMMENT ON COLUMN live_positions.effective_balance_risk_at_open IS 'Effective balance risk factor (EBR 0-100) at time of position opening';
COMMENT ON COLUMN live_positions.btc_price_at_open IS 'Bitcoin (BTC) price in USDT at time of position opening';
COMMENT ON COLUMN live_positions.exit_time IS 'Calculated exit timestamp (entry_timestamp + time_exit_hours) when position should be closed by time';

COMMENT ON COLUMN trades.stop_loss_price IS 'Stop loss price set when position was opened';
COMMENT ON COLUMN trades.take_profit_price IS 'Take profit price set when position was opened';
COMMENT ON COLUMN trades.volatility_at_open IS 'Volatility score (0-100) at time of position opening';
COMMENT ON COLUMN trades.volatility_label_at_open IS 'Volatility label (LOW/MEDIUM/HIGH) at time of position opening';
COMMENT ON COLUMN trades.regime_impact_on_strength IS 'Regime adjustment impact on combined signal strength';
COMMENT ON COLUMN trades.correlation_impact_on_strength IS 'Correlation adjustment impact on combined signal strength';
COMMENT ON COLUMN trades.effective_balance_risk_at_open IS 'Effective balance risk factor (EBR 0-100) at time of position opening';
COMMENT ON COLUMN trades.btc_price_at_open IS 'Bitcoin (BTC) price in USDT at time of position opening';
COMMENT ON COLUMN trades.exit_time IS 'Calculated exit timestamp (entry_timestamp + time_exit_hours) when position should be closed by time';

