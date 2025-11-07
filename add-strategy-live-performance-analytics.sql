-- ============================================
-- Strategy Live Performance & Exit Reason Analytics
-- ============================================
-- This migration adds fields to track live trading performance vs backtest
-- and exit reason breakdown for strategy optimization.
-- ============================================

-- ============================================
-- Live vs Backtest Performance Fields
-- ============================================

-- Live trading performance metrics (aggregated from trades table)
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_success_rate NUMERIC(5,2);
COMMENT ON COLUMN backtest_combinations.live_success_rate IS 'Live trading success rate (calculated from trades table)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_occurrences INTEGER;
COMMENT ON COLUMN backtest_combinations.live_occurrences IS 'Number of live trades for this strategy';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_avg_price_move NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_avg_price_move IS 'Average price move percentage in live trading';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_profit_factor NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_profit_factor IS 'Profit factor from live trading (gross profit / gross loss)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_max_drawdown_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_max_drawdown_percent IS 'Maximum drawdown percentage in live trading';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_win_loss_ratio NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_win_loss_ratio IS 'Win/loss ratio from live trading';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_gross_profit_total NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_gross_profit_total IS 'Total gross profit from live trading';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS live_gross_loss_total NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.live_gross_loss_total IS 'Total gross loss from live trading';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS performance_gap_percent NUMERIC(5,2);
COMMENT ON COLUMN backtest_combinations.performance_gap_percent IS 'Difference between backtest and live success rate (positive = live better, negative = live worse)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS last_live_trade_date TIMESTAMP;
COMMENT ON COLUMN backtest_combinations.last_live_trade_date IS 'Date of most recent live trade for this strategy';

-- ============================================
-- Exit Reason Breakdown Fields
-- ============================================

-- Exit reason breakdown (JSONB for flexibility)
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS exit_reason_breakdown JSONB;
COMMENT ON COLUMN backtest_combinations.exit_reason_breakdown IS 'Breakdown of exit reasons: { "take_profit": { "count": 45, "percentage": 75.0, "avg_pnl": 2.3 }, ... }';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS backtest_exit_reason_breakdown JSONB;
COMMENT ON COLUMN backtest_combinations.backtest_exit_reason_breakdown IS 'Exit reason breakdown from backtest matches (for comparison)';

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_live_success_rate 
ON backtest_combinations(live_success_rate) 
WHERE live_success_rate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_performance_gap 
ON backtest_combinations(performance_gap_percent) 
WHERE performance_gap_percent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_last_live_trade 
ON backtest_combinations(last_live_trade_date) 
WHERE last_live_trade_date IS NOT NULL;

-- GIN index for JSONB exit reason breakdown
CREATE INDEX IF NOT EXISTS idx_backtest_combinations_exit_reason_breakdown 
ON backtest_combinations USING GIN(exit_reason_breakdown) 
WHERE exit_reason_breakdown IS NOT NULL;

-- ============================================
-- VERIFICATION
-- ============================================

DO $$ 
BEGIN
    RAISE NOTICE '✅ Strategy live performance analytics columns added successfully';
    RAISE NOTICE '📊 New columns:';
    RAISE NOTICE '   - Live performance: success_rate, occurrences, avg_price_move, profit_factor, etc.';
    RAISE NOTICE '   - Performance gap: comparison between backtest and live';
    RAISE NOTICE '   - Exit reason breakdown: from both live trades and backtest';
    RAISE NOTICE '📈 Indexes created for optimal query performance';
END $$;


