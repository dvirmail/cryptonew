-- ============================================
-- Backtest Combinations Analytics Enhancements
-- ============================================
-- This migration adds comprehensive analytics columns to backtest_combinations
-- for improved strategy selection, risk assessment, and performance analysis.
--
-- Priority 1: Core Performance Analytics (HIGH VALUE)
-- Priority 2: Timing & Consistency Analytics (MEDIUM VALUE)
-- Priority 3: Advanced Analytics (NICE TO HAVE)
-- ============================================

-- ============================================
-- PRIORITY 1: Core Performance Analytics
-- ============================================

-- Regime-specific performance (stores success rates per market regime)
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS regime_performance JSONB;
COMMENT ON COLUMN backtest_combinations.regime_performance IS 'Performance metrics per market regime: { "uptrend": { "success_rate": 75.5, "occurrences": 45, "avg_price_move": 2.3, "profit_factor": 3.2 }, ... }';

-- Drawdown metrics
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS max_drawdown_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.max_drawdown_percent IS 'Maximum drawdown percentage during backtest occurrences';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS median_drawdown_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.median_drawdown_percent IS 'Median drawdown percentage across all occurrences';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS median_lowest_low_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.median_lowest_low_percent IS 'Median lowest low percentage (historical support analysis)';

-- Win/Loss analysis
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_win_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.avg_win_percent IS 'Average profit percentage on winning trades';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_loss_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.avg_loss_percent IS 'Average loss percentage on losing trades';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS win_loss_ratio NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.win_loss_ratio IS 'Ratio of average win to average loss';

-- Profit factor verification (ensure it's consistently saved)
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS profit_factor NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.profit_factor IS 'Profit factor: gross profit / gross loss (capped at 20.0 for realism)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS gross_profit_total NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.gross_profit_total IS 'Total gross profit from all winning trades';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS gross_loss_total NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.gross_loss_total IS 'Total gross loss from all losing trades';

-- ============================================
-- PRIORITY 2: Timing & Consistency Analytics
-- ============================================

-- Timing statistics
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_time_to_peak_minutes NUMERIC(10,2);
COMMENT ON COLUMN backtest_combinations.avg_time_to_peak_minutes IS 'Average time (minutes) to reach peak profit during trades';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS median_exit_time_minutes NUMERIC(10,2);
COMMENT ON COLUMN backtest_combinations.median_exit_time_minutes IS 'Median actual exit time (minutes) across all occurrences';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS exit_time_variance_minutes NUMERIC(10,2);
COMMENT ON COLUMN backtest_combinations.exit_time_variance_minutes IS 'Standard deviation of exit times (consistency measure)';

-- Consistency metrics
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS max_consecutive_wins INTEGER;
COMMENT ON COLUMN backtest_combinations.max_consecutive_wins IS 'Longest winning streak during backtest';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS max_consecutive_losses INTEGER;
COMMENT ON COLUMN backtest_combinations.max_consecutive_losses IS 'Longest losing streak during backtest';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_trades_between_wins NUMERIC(5,2);
COMMENT ON COLUMN backtest_combinations.avg_trades_between_wins IS 'Average number of trades between wins (recovery pattern)';

-- ============================================
-- PRIORITY 3: Advanced Analytics (NICE TO HAVE)
-- ============================================

-- Risk-adjusted returns
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS sharpe_ratio NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.sharpe_ratio IS 'Sharpe ratio: risk-adjusted return metric (higher is better, >1 is good)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS sortino_ratio NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.sortino_ratio IS 'Sortino ratio: downside risk-adjusted return (focuses on negative volatility)';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS calmar_ratio NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.calmar_ratio IS 'Calmar ratio: return vs max drawdown (annualized return / max drawdown)';

-- Market condition correlation
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS volatility_performance JSONB;
COMMENT ON COLUMN backtest_combinations.volatility_performance IS 'Performance by volatility regime: { "low": { "success_rate": 80, "occurrences": 20 }, ... }';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS fear_greed_performance JSONB;
COMMENT ON COLUMN backtest_combinations.fear_greed_performance IS 'Performance by Fear & Greed classification: { "Extreme Fear": { "success_rate": 85, ... }, ... }';

-- Entry quality metrics
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_entry_quality_score NUMERIC(5,2);
COMMENT ON COLUMN backtest_combinations.avg_entry_quality_score IS 'Average entry quality score (0-100) at strategy trigger points';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_entry_momentum_score NUMERIC(5,2);
COMMENT ON COLUMN backtest_combinations.avg_entry_momentum_score IS 'Average momentum score (0-100) at entry';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS avg_sr_proximity_percent NUMERIC(10,4);
COMMENT ON COLUMN backtest_combinations.avg_sr_proximity_percent IS 'Average distance to support/resistance at entry (percentage)';

-- Performance attribution
ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS best_performing_symbol VARCHAR(50);
COMMENT ON COLUMN backtest_combinations.best_performing_symbol IS 'Symbol with highest success rate for this strategy';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS worst_performing_symbol VARCHAR(50);
COMMENT ON COLUMN backtest_combinations.worst_performing_symbol IS 'Symbol with lowest success rate for this strategy';

ALTER TABLE backtest_combinations ADD COLUMN IF NOT EXISTS best_performing_timeframe VARCHAR(10);
COMMENT ON COLUMN backtest_combinations.best_performing_timeframe IS 'Best performing timeframe if strategy tested on multiple timeframes';

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_backtest_combinations_profit_factor 
ON backtest_combinations(profit_factor) 
WHERE profit_factor IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_max_drawdown 
ON backtest_combinations(max_drawdown_percent) 
WHERE max_drawdown_percent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_win_loss_ratio 
ON backtest_combinations(win_loss_ratio) 
WHERE win_loss_ratio IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_sharpe_ratio 
ON backtest_combinations(sharpe_ratio) 
WHERE sharpe_ratio IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_success_rate 
ON backtest_combinations(success_rate) 
WHERE success_rate IS NOT NULL;

-- GIN index for JSONB columns (enables efficient JSON queries)
CREATE INDEX IF NOT EXISTS idx_backtest_combinations_regime_performance 
ON backtest_combinations USING GIN(regime_performance) 
WHERE regime_performance IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_combinations_volatility_performance 
ON backtest_combinations USING GIN(volatility_performance) 
WHERE volatility_performance IS NOT NULL;

-- ============================================
-- VERIFICATION
-- ============================================

DO $$ 
BEGIN
    RAISE NOTICE '✅ Backtest combinations analytics columns added successfully';
    RAISE NOTICE '📊 New columns:';
    RAISE NOTICE '   - Priority 1: regime_performance, drawdown metrics, win/loss analysis, profit factor';
    RAISE NOTICE '   - Priority 2: timing statistics, consistency metrics';
    RAISE NOTICE '   - Priority 3: risk-adjusted returns, market correlation, entry quality';
    RAISE NOTICE '📈 Indexes created for optimal query performance';
END $$;

