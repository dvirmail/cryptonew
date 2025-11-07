-- ============================================
-- Trade Analytics Enhancement Migration
-- Adds 23 new fields for comprehensive trade performance analysis
-- ============================================
-- 
-- Priority 1: Critical fields for exit optimization
-- Priority 2: High-value fields for timing and quality analysis
-- Priority 3: Nice-to-have fields for advanced analytics
--
-- See TRADE_ANALYTICS_RECOMMENDATIONS.md for detailed explanation
-- ============================================

-- ============================================
-- PRIORITY 1: Market Conditions at Exit
-- ============================================
-- These fields mirror the entry-side metrics to enable comparison
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_regime_at_exit VARCHAR(20);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS regime_confidence_at_exit NUMERIC(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fear_greed_score_at_exit INTEGER;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fear_greed_classification_at_exit VARCHAR(50);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volatility_at_exit NUMERIC(5,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volatility_label_at_exit VARCHAR(50);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS btc_price_at_exit NUMERIC(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS lpm_score_at_exit NUMERIC(5,2);

-- ============================================
-- PRIORITY 1: Price Movement Metrics (MFE/MAE)
-- ============================================
-- Critical for understanding trade quality and exit optimization
ALTER TABLE trades ADD COLUMN IF NOT EXISTS max_favorable_excursion NUMERIC(20,8); -- MFE: Highest price reached
ALTER TABLE trades ADD COLUMN IF NOT EXISTS max_adverse_excursion NUMERIC(20,8); -- MAE: Lowest price reached
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_profit_usdt NUMERIC(20,8); -- Maximum profit reached
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_loss_usdt NUMERIC(20,8); -- Maximum loss reached
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_profit_percent NUMERIC(10,4); -- Peak profit percentage
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_loss_percent NUMERIC(10,4); -- Peak loss percentage
ALTER TABLE trades ADD COLUMN IF NOT EXISTS price_movement_percent NUMERIC(10,4); -- Total price movement %

-- ============================================
-- PRIORITY 1: Exit Quality Metrics
-- ============================================
-- Critical for understanding if exit was optimal
ALTER TABLE trades ADD COLUMN IF NOT EXISTS distance_to_sl_at_exit NUMERIC(10,4); -- Distance to SL when closed (%)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS distance_to_tp_at_exit NUMERIC(10,4); -- Distance to TP when closed (%)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sl_hit_boolean BOOLEAN; -- Did SL trigger?
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp_hit_boolean BOOLEAN; -- Did TP trigger?
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_vs_planned_exit_time_minutes INTEGER; -- How early/late vs planned exit

-- ============================================
-- PRIORITY 2: Slippage Tracking
-- ============================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS slippage_entry NUMERIC(10,4); -- Entry slippage (%)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS slippage_exit NUMERIC(10,4); -- Exit slippage (%)

-- ============================================
-- PRIORITY 2: Trade Lifecycle Metrics
-- ============================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS time_in_profit_hours NUMERIC(10,4); -- Time spent profitable
ALTER TABLE trades ADD COLUMN IF NOT EXISTS time_in_loss_hours NUMERIC(10,4); -- Time spent at loss
ALTER TABLE trades ADD COLUMN IF NOT EXISTS time_at_peak_profit TIMESTAMP WITH TIME ZONE; -- When peak profit occurred
ALTER TABLE trades ADD COLUMN IF NOT EXISTS time_at_max_loss TIMESTAMP WITH TIME ZONE; -- When max loss occurred
ALTER TABLE trades ADD COLUMN IF NOT EXISTS regime_changes_during_trade INTEGER; -- Count of regime changes

-- ============================================
-- PRIORITY 3: Order Execution Metrics
-- ============================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_order_type VARCHAR(20); -- market/limit
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_order_type VARCHAR(20); -- market/limit
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_order_id VARCHAR(255); -- Binance order ID
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_order_id VARCHAR(255); -- Binance order ID
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_fill_time_ms INTEGER; -- Time to fill entry order
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_fill_time_ms INTEGER; -- Time to fill exit order

-- ============================================
-- PRIORITY 3: Strategy Context Metrics
-- ============================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_win_rate_at_entry NUMERIC(5,2); -- Strategy win rate when trade opened
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_occurrences_at_entry INTEGER; -- Strategy occurrences when trade opened
ALTER TABLE trades ADD COLUMN IF NOT EXISTS similar_trades_count INTEGER; -- Count of similar trades (same strategy/symbol)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS consecutive_wins_before INTEGER; -- Consecutive wins before this trade
ALTER TABLE trades ADD COLUMN IF NOT EXISTS consecutive_losses_before INTEGER; -- Consecutive losses before this trade

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_trades_market_regime_at_exit ON trades(market_regime_at_exit);
CREATE INDEX IF NOT EXISTS idx_trades_volatility_at_exit ON trades(volatility_at_exit);
CREATE INDEX IF NOT EXISTS idx_trades_peak_profit_usdt ON trades(peak_profit_usdt);
CREATE INDEX IF NOT EXISTS idx_trades_sl_hit_boolean ON trades(sl_hit_boolean);
CREATE INDEX IF NOT EXISTS idx_trades_tp_hit_boolean ON trades(tp_hit_boolean);
CREATE INDEX IF NOT EXISTS idx_trades_exit_vs_planned_time ON trades(exit_vs_planned_exit_time_minutes);
CREATE INDEX IF NOT EXISTS idx_trades_slippage_entry ON trades(slippage_entry);
CREATE INDEX IF NOT EXISTS idx_trades_slippage_exit ON trades(slippage_exit);

-- ============================================
-- Column Comments for Documentation
-- ============================================
COMMENT ON COLUMN trades.market_regime_at_exit IS 'Market regime at position exit (downtrend/uptrend/ranging)';
COMMENT ON COLUMN trades.regime_confidence_at_exit IS 'Confidence in regime detection at exit (0-100)';
COMMENT ON COLUMN trades.fear_greed_score_at_exit IS 'Fear & Greed Index score at exit (0-100)';
COMMENT ON COLUMN trades.fear_greed_classification_at_exit IS 'Fear & Greed classification at exit (Extreme Fear/Neutral/Extreme Greed)';
COMMENT ON COLUMN trades.volatility_at_exit IS 'Volatility score at exit (0-100)';
COMMENT ON COLUMN trades.volatility_label_at_exit IS 'Volatility label at exit (LOW/MEDIUM/HIGH)';
COMMENT ON COLUMN trades.btc_price_at_exit IS 'Bitcoin price at position exit';
COMMENT ON COLUMN trades.lpm_score_at_exit IS 'Leading Performance Momentum score at exit';
COMMENT ON COLUMN trades.max_favorable_excursion IS 'Highest price reached during trade (MFE) - for long positions';
COMMENT ON COLUMN trades.max_adverse_excursion IS 'Lowest price reached during trade (MAE) - for long positions';
COMMENT ON COLUMN trades.peak_profit_usdt IS 'Maximum profit reached during trade in USDT';
COMMENT ON COLUMN trades.peak_loss_usdt IS 'Maximum loss reached during trade in USDT';
COMMENT ON COLUMN trades.peak_profit_percent IS 'Maximum profit reached during trade as percentage';
COMMENT ON COLUMN trades.peak_loss_percent IS 'Maximum loss reached during trade as percentage';
COMMENT ON COLUMN trades.price_movement_percent IS 'Total price movement percentage from entry to exit';
COMMENT ON COLUMN trades.distance_to_sl_at_exit IS 'Distance to stop loss when position closed (% of entry price)';
COMMENT ON COLUMN trades.distance_to_tp_at_exit IS 'Distance to take profit when position closed (% of entry price)';
COMMENT ON COLUMN trades.sl_hit_boolean IS 'True if stop loss was triggered (exit_reason = stop_loss)';
COMMENT ON COLUMN trades.tp_hit_boolean IS 'True if take profit was triggered (exit_reason = take_profit)';
COMMENT ON COLUMN trades.exit_vs_planned_exit_time_minutes IS 'Difference between actual exit time and planned exit time (exit_time) in minutes. Negative = early exit, Positive = late exit';
COMMENT ON COLUMN trades.slippage_entry IS 'Entry slippage as percentage of expected price: ((actual - expected) / expected) * 100';
COMMENT ON COLUMN trades.slippage_exit IS 'Exit slippage as percentage of expected price: ((actual - expected) / expected) * 100';
COMMENT ON COLUMN trades.time_in_profit_hours IS 'Total time position was in profit (hours)';
COMMENT ON COLUMN trades.time_in_loss_hours IS 'Total time position was at loss (hours)';
COMMENT ON COLUMN trades.time_at_peak_profit IS 'Timestamp when peak profit was reached';
COMMENT ON COLUMN trades.time_at_max_loss IS 'Timestamp when maximum loss was reached';
COMMENT ON COLUMN trades.regime_changes_during_trade IS 'Number of times market regime changed during trade lifecycle';
COMMENT ON COLUMN trades.entry_order_type IS 'Order type used for entry (market/limit)';
COMMENT ON COLUMN trades.exit_order_type IS 'Order type used for exit (market/limit)';
COMMENT ON COLUMN trades.entry_order_id IS 'Binance order ID for entry order';
COMMENT ON COLUMN trades.exit_order_id IS 'Binance order ID for exit order';
COMMENT ON COLUMN trades.entry_fill_time_ms IS 'Time taken to fill entry order in milliseconds';
COMMENT ON COLUMN trades.exit_fill_time_ms IS 'Time taken to fill exit order in milliseconds';
COMMENT ON COLUMN trades.strategy_win_rate_at_entry IS 'Strategy win rate when this trade was opened';
COMMENT ON COLUMN trades.strategy_occurrences_at_entry IS 'Number of backtest occurrences for strategy when trade opened';
COMMENT ON COLUMN trades.similar_trades_count IS 'Count of similar trades (same strategy/symbol) executed before this trade';
COMMENT ON COLUMN trades.consecutive_wins_before IS 'Number of consecutive wins before this trade';
COMMENT ON COLUMN trades.consecutive_losses_before IS 'Number of consecutive losses before this trade';

