# Performance Analysis: System Behavior at 1 Million Rows

## Executive Summary

At **1 million rows** in the `trades` table, the system will experience significant performance degradation in several areas:
- **RAM Usage**: ~2-4 GB for in-memory data structures
- **Database Query Time**: 5-30+ seconds for full table scans
- **Frontend Load Time**: 10-60+ seconds for initial data fetch
- **CPU Usage**: High during query execution and data processing

---

## 1. RAM (Memory) Impact

### Current Memory Usage Patterns

#### Server-Side (proxy-server.cjs)

**Trades Loading (`loadTradesFromDB`):**
```javascript
// Line 580: Loads ALL trades without LIMIT
SELECT * FROM trades WHERE ... ORDER BY exit_timestamp DESC
```

**Estimated Memory per Trade:**
- Average trade record: ~2-5 KB (87 fields including analytics)
- 1,000,000 trades × 3 KB average = **~3 GB RAM**
- Plus JavaScript object overhead: **~4-5 GB total**

**Backtest Combinations Loading:**
```javascript
// Line 5331: Loads ALL combinations without LIMIT
SELECT * FROM backtest_combinations ORDER BY created_date DESC
```

**Estimated Memory:**
- 1,700 combinations × 5 KB = ~8.5 MB (negligible)
- But if this grows to 10,000+ combinations: **~50 MB**

**Total Server RAM Usage:**
- **Current (100K rows)**: ~500 MB - 1 GB
- **At 1M rows**: **~4-5 GB** (just for trades data)
- **Recommended RAM**: **8-16 GB minimum**

### Client-Side (Browser)

**Frontend Memory:**
- React state management: ~2-3x overhead
- 1M trades in browser: **~6-9 GB RAM** (if all loaded)
- **Current limit**: 100 trades in TradeHistory (good)
- **BacktestCombinations**: 10,000 limit = **~50 MB** (acceptable)

**Browser Crashes:**
- Most browsers limit tab memory to 2-4 GB
- Loading 1M trades will **crash the browser tab**

---

## 2. CPU Impact

### Database Query Processing

**Full Table Scans (No Index Usage):**
```sql
-- This query scans ALL 1M rows
SELECT * FROM trades WHERE exit_timestamp IS NOT NULL ORDER BY exit_timestamp DESC
```

**CPU Impact:**
- **PostgreSQL CPU**: 50-100% during query execution
- **Query Time**: 5-30 seconds (depending on indexes)
- **I/O Wait**: High disk read operations

**Index Usage (With Proper Indexes):**
```sql
-- With idx_trades_exit_timestamp_desc index
-- Query time: 0.5-2 seconds
-- CPU: 20-40%
```

### Application CPU

**Data Processing:**
- JSON parsing: 1-5 seconds for 1M records
- Data transformation: 2-10 seconds
- Memory allocation: High CPU during object creation

**Total CPU Impact:**
- **During query execution**: 80-100% (single core)
- **During data processing**: 50-80% (single core)
- **Multi-core systems**: Better, but PostgreSQL is single-threaded per query

---

## 3. PostgreSQL Database Performance

### Query Performance Analysis

#### Current Problematic Queries

**1. Full Trades Load (Line 580 in proxy-server.cjs):**
```sql
SELECT * FROM trades WHERE ... ORDER BY exit_timestamp DESC
-- No LIMIT clause
-- Scans entire table
-- Estimated time at 1M rows: 10-30 seconds
```

**2. Backtest Combinations Load (Line 5331):**
```sql
SELECT * FROM backtest_combinations ORDER BY created_date DESC
-- No LIMIT clause
-- Estimated time at 1M rows: N/A (only 1,700 rows currently)
```

**3. Trade History Query (TradeHistory.jsx:148):**
```sql
SELECT * FROM trades WHERE exit_timestamp IS NOT NULL 
ORDER BY exit_timestamp DESC LIMIT 100
-- GOOD: Has LIMIT
-- Estimated time: 0.1-0.5 seconds (with index)
```

### Index Analysis

**Existing Indexes (from optimize-trades-table-performance.sql):**
- ✅ `idx_trades_mode_exit_timestamp` - Composite index
- ✅ `idx_trades_exit_timestamp_desc` - For sorting
- ✅ `idx_trades_mode_exit_range` - Range queries
- ✅ `idx_trades_created_date_desc` - Listing operations
- ✅ `idx_trades_valid_exits` - Partial index

**Index Effectiveness:**
- **With indexes**: Query time: 0.5-2 seconds
- **Without indexes**: Query time: 10-30+ seconds
- **Index size**: ~200-500 MB for 1M rows

### Database Connection Pool

**Current Configuration:**
- Default PostgreSQL connection pool: 10-20 connections
- **At 1M rows**: May need 20-50 connections for concurrent queries

**Connection Overhead:**
- Each connection: ~2-5 MB RAM
- 50 connections: ~100-250 MB

---

## 4. Network & I/O Impact

### Data Transfer

**Server to Client:**
- 1M trades × 3 KB = **~3 GB data transfer**
- **Transfer time**: 30-120 seconds (depending on network)
- **Bandwidth**: 25-100 Mbps required

**Current Optimizations:**
- ✅ TradeHistory limits to 100 trades (~300 KB)
- ⚠️ BacktestCombinations: 10,000 limit (~50 MB) - acceptable

### Disk I/O

**PostgreSQL:**
- **Read operations**: 500-2000 IOPS for 1M row scan
- **Write operations**: Normal (inserts/updates)
- **Disk space**: ~5-10 GB for 1M trades (with indexes)

**File Storage (storage/*.json):**
- Current: ~100-500 MB
- At 1M rows: **~3-5 GB** (if still using file storage)

---

## 5. Specific Performance Bottlenecks

### Critical Issues

**1. Server Startup (`loadTradesFromDB`):**
```javascript
// Line 536-643: Loads ALL trades on startup
// Problem: No pagination, no LIMIT
// Impact: 10-30 second startup time at 1M rows
```

**2. Memory Exhaustion:**
- Server RAM: 4-5 GB just for trades
- Browser RAM: 6-9 GB if all trades loaded
- **Risk**: Server crashes, browser tab crashes

**3. Query Timeout:**
- Current timeout: 10 minutes (apiQueue.jsx:600000ms)
- At 1M rows: Queries may timeout before completion

**4. Real-time Updates:**
- Each scan cycle may query trades table
- Performance degradation during active scanning

---

## 6. Recommendations for 1M+ Rows

### Immediate Fixes (Required)

**1. Add LIMIT to `loadTradesFromDB`:**
```javascript
// proxy-server.cjs line 580
const query = `
    SELECT * FROM trades 
    WHERE ${nullChecks}${priceCheckClause}
    ORDER BY exit_timestamp DESC NULLS LAST
    LIMIT 10000  -- Load only recent trades
`;
```

**2. Implement Pagination:**
```javascript
// Add pagination support
async function loadTradesFromDB(limit = 10000, offset = 0) {
    const query = `
        SELECT * FROM trades 
        WHERE ${nullChecks}${priceCheckClause}
        ORDER BY exit_timestamp DESC NULLS LAST
        LIMIT $1 OFFSET $2
    `;
    // ...
}
```

**3. Use Cursor-Based Pagination:**
```javascript
// More efficient than OFFSET for large datasets
// Use WHERE exit_timestamp < $lastTimestamp
```

**4. Implement Data Archiving:**
```sql
-- Archive old trades (> 1 year) to separate table
CREATE TABLE trades_archive AS 
SELECT * FROM trades WHERE exit_timestamp < NOW() - INTERVAL '1 year';

-- Delete archived trades from main table
DELETE FROM trades WHERE exit_timestamp < NOW() - INTERVAL '1 year';
```

### Database Optimizations

**1. Table Partitioning (5M+ rows):**
```sql
-- Partition by trading_mode or date
CREATE TABLE trades_live PARTITION OF trades 
FOR VALUES IN ('live');

CREATE TABLE trades_testnet PARTITION OF trades 
FOR VALUES IN ('testnet');
```

**2. Materialized Views for Analytics:**
```sql
-- Pre-compute aggregations
CREATE MATERIALIZED VIEW trades_daily_stats AS
SELECT 
    DATE(exit_timestamp) as date,
    trading_mode,
    COUNT(*) as trade_count,
    SUM(pnl_usdt) as total_pnl,
    AVG(pnl_percent) as avg_pnl_percent
FROM trades
WHERE exit_timestamp IS NOT NULL
GROUP BY DATE(exit_timestamp), trading_mode;

-- Refresh periodically
REFRESH MATERIALIZED VIEW trades_daily_stats;
```

**3. Connection Pooling:**
```javascript
// Increase connection pool size
const pool = new Pool({
    max: 50,  // Increase from default 10
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
```

### Application Optimizations

**1. Lazy Loading:**
```javascript
// Load trades on-demand, not on startup
// Only load when TradeHistory page is accessed
```

**2. Virtual Scrolling (Frontend):**
```javascript
// Use react-window or react-virtualized
// Render only visible rows (50-100 at a time)
```

**3. Data Caching:**
```javascript
// Cache frequently accessed data
// Use Redis or in-memory cache with TTL
const cache = new Map();
cache.set('recent_trades', trades, { ttl: 60000 }); // 1 minute
```

**4. Background Processing:**
```javascript
// Move heavy queries to background workers
// Use worker threads or separate process
```

### Infrastructure Recommendations

**1. Database Server:**
- **RAM**: 16-32 GB (for PostgreSQL shared_buffers)
- **CPU**: 4-8 cores (PostgreSQL can use multiple cores for parallel queries)
- **Storage**: SSD with 10,000+ IOPS
- **PostgreSQL version**: 14+ (better parallel query support)

**2. Application Server:**
- **RAM**: 8-16 GB
- **CPU**: 4+ cores
- **Node.js**: Use cluster mode for multi-core utilization

**3. Monitoring:**
```sql
-- Enable query logging for slow queries
SET log_min_duration_statement = 1000;  -- Log queries > 1 second

-- Monitor table size
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename = 'trades';
```

---

## 7. Performance Benchmarks (Estimated)

### Current System (100K rows)
- **Server startup**: 2-5 seconds
- **TradeHistory load**: 0.5-1 second
- **RAM usage**: 500 MB - 1 GB
- **Query time**: 0.5-2 seconds

### At 1M Rows (Without Optimizations)
- **Server startup**: 30-60 seconds ⚠️
- **TradeHistory load**: 0.5-1 second ✅ (has LIMIT)
- **RAM usage**: 4-5 GB ⚠️
- **Query time**: 10-30 seconds ⚠️
- **Browser crash**: Likely if all trades loaded ⚠️

### At 1M Rows (With Optimizations)
- **Server startup**: 2-5 seconds ✅
- **TradeHistory load**: 0.5-1 second ✅
- **RAM usage**: 1-2 GB ✅
- **Query time**: 0.5-2 seconds ✅
- **Browser stability**: Good ✅

---

## 8. Migration Path

### Phase 1: Immediate (Before 500K rows)
1. ✅ Add LIMIT to `loadTradesFromDB` (10,000 recent trades)
2. ✅ Verify all indexes are created
3. ✅ Add pagination to TradeHistory
4. ✅ Monitor query performance

### Phase 2: Short-term (500K - 1M rows)
1. Implement data archiving (move old trades to archive table)
2. Add materialized views for analytics
3. Implement lazy loading for trades
4. Add query result caching

### Phase 3: Long-term (1M+ rows)
1. Implement table partitioning
2. Move to dedicated database server
3. Implement read replicas for analytics
4. Consider time-series database (TimescaleDB) for trade data

---

## 9. Code Changes Required

### Priority 1: Critical (Do Immediately)

**File: `proxy-server.cjs`**
- Line 580: Add `LIMIT 10000` to trades query
- Line 5331: Verify backtest_combinations query has reasonable limit

**File: `src/pages/TradeHistory.jsx`**
- Already has LIMIT 100 ✅
- Consider adding virtual scrolling for better UX

**File: `src/api/localClient.js`**
- Line 149: Default limit is 10,000 (acceptable)
- Verify all list() calls use reasonable limits

### Priority 2: Important (Before 500K rows)

**File: `proxy-server.cjs`**
- Add pagination support to all list endpoints
- Implement cursor-based pagination
- Add data archiving endpoint

**File: `src/components/services/PerformanceMetricsService.jsx`**
- Use materialized views or cached aggregations
- Avoid full table scans for analytics

### Priority 3: Optimization (Before 1M rows)

**Database:**
- Implement table partitioning
- Create materialized views
- Set up query monitoring

**Application:**
- Implement Redis caching layer
- Add background job processing
- Optimize React rendering with virtual scrolling

---

## 10. Monitoring & Alerts

### Key Metrics to Monitor

1. **Query Performance:**
   ```sql
   -- Find slow queries
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   WHERE mean_exec_time > 1000  -- > 1 second
   ORDER BY mean_exec_time DESC;
   ```

2. **Table Size:**
   ```sql
   SELECT pg_size_pretty(pg_total_relation_size('trades'));
   ```

3. **Index Usage:**
   ```sql
   -- Check if indexes are being used
   SELECT schemaname, tablename, indexname, idx_scan
   FROM pg_stat_user_indexes
   WHERE tablename = 'trades'
   ORDER BY idx_scan;
   ```

4. **Memory Usage:**
   - Monitor Node.js heap size
   - Monitor PostgreSQL shared_buffers usage
   - Monitor system RAM usage

### Alert Thresholds

- **Query time > 5 seconds**: Warning
- **Query time > 10 seconds**: Critical
- **RAM usage > 80%**: Warning
- **RAM usage > 90%**: Critical
- **Table size > 5 GB**: Consider archiving

---

## Conclusion

At **1 million rows**, the system will experience significant performance degradation **without optimizations**. The most critical issues are:

1. **Full table scans** loading all trades into memory
2. **No pagination** for large datasets
3. **Memory exhaustion** on both server and client
4. **Slow query performance** without proper indexing

**Recommended actions:**
1. ✅ **Immediately**: Add LIMIT to `loadTradesFromDB` (10,000 rows)
2. ✅ **Short-term**: Implement pagination and data archiving
3. ✅ **Long-term**: Consider partitioning and materialized views

With proper optimizations, the system can handle 1M+ rows efficiently with minimal performance impact.

