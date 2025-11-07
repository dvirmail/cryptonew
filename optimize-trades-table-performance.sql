-- Performance Optimization Script for Trades Table (2M+ rows)
-- Run this to ensure optimal performance as your trades table grows

-- ============================================
-- CRITICAL INDEXES FOR COMMON QUERIES
-- ============================================

-- 1. Composite index for most common query pattern: trading_mode + exit_timestamp (used by snapshot generation)
CREATE INDEX IF NOT EXISTS idx_trades_mode_exit_timestamp 
ON trades(trading_mode, exit_timestamp) 
WHERE exit_timestamp IS NOT NULL;

-- 2. Index for sorting by exit_timestamp (used by chart and wallet provider)
CREATE INDEX IF NOT EXISTS idx_trades_exit_timestamp_desc 
ON trades(exit_timestamp DESC) 
WHERE exit_timestamp IS NOT NULL;

-- 3. Composite index for mode + exit_timestamp range queries (snapshot backfill)
CREATE INDEX IF NOT EXISTS idx_trades_mode_exit_range 
ON trades(trading_mode, exit_timestamp DESC) 
WHERE exit_timestamp IS NOT NULL;

-- 4. Index on created_date for listing/archiving operations
CREATE INDEX IF NOT EXISTS idx_trades_created_date_desc 
ON trades(created_date DESC);

-- 5. Composite index for created_by queries (if used)
CREATE INDEX IF NOT EXISTS idx_trades_mode_created_date 
ON trades(trading_mode, created_date DESC);

-- ============================================
-- PARTIAL INDEXES FOR NULL SAFETY
-- ============================================

-- Index for trades with valid exit data (most analytics queries need this)
CREATE INDEX IF NOT EXISTS idx_trades_valid_exits 
ON trades(trading_mode, exit_timestamp, pnl_usdt) 
WHERE exit_timestamp IS NOT NULL AND pnl_usdt IS NOT NULL;

-- ============================================
-- TABLE STATISTICS & MAINTENANCE
-- ============================================

-- Update table statistics for query planner (run periodically)
ANALYZE trades;

-- ============================================
-- PARTITIONING RECOMMENDATION (Optional, for 5M+ rows)
-- ============================================
-- If you expect 5M+ rows, consider partitioning by trading_mode or date:
-- 
-- CREATE TABLE trades_testnet PARTITION OF trades FOR VALUES IN ('testnet');
-- CREATE TABLE trades_live PARTITION OF trades FOR VALUES IN ('live');
--
-- Or by date range:
-- CREATE TABLE trades_2025_01 PARTITION OF trades FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- ============================================
-- QUERY PERFORMANCE MONITORING
-- ============================================
-- To check if indexes are being used:
-- EXPLAIN ANALYZE SELECT * FROM trades WHERE trading_mode = 'testnet' AND exit_timestamp >= '2025-01-01' ORDER BY exit_timestamp DESC LIMIT 100;

COMMENT ON INDEX idx_trades_mode_exit_timestamp IS 'Critical index for snapshot generation queries';
COMMENT ON INDEX idx_trades_exit_timestamp_desc IS 'Critical index for chart data and wallet provider queries';
COMMENT ON INDEX idx_trades_mode_exit_range IS 'Critical index for backfill and range queries';

