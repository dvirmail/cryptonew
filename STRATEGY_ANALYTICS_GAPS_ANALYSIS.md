# Strategy Analytics Gaps Analysis

## Current State Assessment

### ✅ **Well-Covered Analytics (Priority 1 & 2 - Implemented)**

Your current data includes excellent backtest performance metrics:

1. **Core Performance:**
   - `regime_performance` (JSONB) - Performance by market regime ✅
   - `max_drawdown_percent`, `median_drawdown_percent` - Risk metrics ✅
   - `avg_win_percent`, `avg_loss_percent`, `win_loss_ratio` - Win/loss analysis ✅
   - `gross_profit_total`, `gross_loss_total`, `profit_factor` - Profitability ✅

2. **Timing & Consistency:**
   - `avg_time_to_peak_minutes`, `median_exit_time_minutes` - Timing stats ✅
   - `max_consecutive_wins`, `max_consecutive_losses` - Consistency ✅
   - `avg_trades_between_wins` - Recovery patterns ✅

### ❌ **Missing Analytics (Priority 3 - Not Implemented)**

These fields exist in the schema but are **not being populated**:

1. **Risk-Adjusted Returns:**
   - `sharpe_ratio` - Risk-adjusted return (professional metric)
   - `sortino_ratio` - Downside risk-adjusted return
   - `calmar_ratio` - Return vs max drawdown

2. **Market Condition Correlation:**
   - `volatility_performance` (JSONB) - Performance by volatility regime
   - `fear_greed_performance` (JSONB) - Performance by F&G classification

3. **Entry Quality:**
   - `avg_entry_quality_score` - Average entry quality at triggers
   - `avg_entry_momentum_score` - Average momentum at entry
   - `avg_sr_proximity_percent` - Average distance to S/R

4. **Performance Attribution:**
   - `best_performing_symbol` - Best symbol for strategy
   - `worst_performing_symbol` - Worst symbol for strategy
   - `best_performing_timeframe` - Best timeframe (if multi-timeframe)

---

## 🚨 **Critical Missing Analytics (Not in Schema)**

### 1. **Live vs Backtest Performance Comparison**

**Problem:** No way to compare how strategies perform in live trading vs backtest.

**Impact:** 
- Can't identify strategies that overfit to backtest data
- Can't track which strategies translate well to live trading
- Can't adjust expectations based on real-world performance

**Recommended Fields:**
```sql
-- Live trading performance (aggregated from trades table)
live_success_rate NUMERIC(5,2),
live_occurrences INTEGER,
live_avg_price_move NUMERIC(10,4),
live_profit_factor NUMERIC(10,4),
live_max_drawdown_percent NUMERIC(10,4),
live_win_loss_ratio NUMERIC(10,4),
performance_gap_percent NUMERIC(5,2), -- Backtest vs Live difference
last_live_trade_date TIMESTAMP
```

**Use Cases:**
- Identify strategies with large backtest/live gaps
- Track which strategies are performing better/worse than expected
- Auto-disable strategies that consistently underperform

---

### 2. **Recent Performance Trends**

**Problem:** No tracking of whether strategy performance is improving or degrading over time.

**Impact:**
- Can't detect strategy degradation
- Can't identify if market conditions have changed
- Can't make data-driven decisions about strategy viability

**Recommended Fields:**
```sql
-- Performance trends (calculated from recent trades)
recent_30d_success_rate NUMERIC(5,2),
recent_30d_profit_factor NUMERIC(10,4),
recent_30d_occurrences INTEGER,
performance_trend VARCHAR(20), -- 'improving', 'degrading', 'stable'
trend_slope NUMERIC(10,4) -- Rate of change
```

**Use Cases:**
- Auto-disable degrading strategies
- Identify strategies that are improving
- Alert when performance drops significantly

---

### 3. **Signal Strength Distribution**

**Problem:** Only average combined strength is stored, not the distribution.

**Impact:**
- Can't understand strength variability
- Can't identify if strategy triggers at consistent strength levels
- Can't optimize minimum strength thresholds

**Recommended Fields:**
```sql
-- Signal strength statistics
min_combined_strength NUMERIC(10,2),
max_combined_strength NUMERIC(10,2),
avg_combined_strength NUMERIC(10,2), -- Already exists
stddev_combined_strength NUMERIC(10,2),
strength_consistency_score NUMERIC(5,2) -- Lower stddev = higher consistency
```

**Use Cases:**
- Filter strategies with consistent strength
- Identify strategies with high variability
- Optimize strength thresholds

---

### 4. **Exit Reason Breakdown**

**Problem:** No breakdown of how trades exit (TP vs SL vs timeout vs trailing stop).

**Impact:**
- Can't optimize exit parameters
- Can't understand if TP/SL are set correctly
- Can't identify if timeout is too short/long

**Recommended Fields:**
```sql
-- Exit reason statistics (calculated from trades)
exit_reason_breakdown JSONB
-- Example: {
--   "take_profit": { "count": 45, "percentage": 75.0, "avg_pnl": 2.3 },
--   "stop_loss": { "count": 10, "percentage": 16.7, "avg_pnl": -1.8 },
--   "timeout": { "count": 3, "percentage": 5.0, "avg_pnl": 0.5 },
--   "trailing_stop": { "count": 2, "percentage": 3.3, "avg_pnl": 1.2 }
-- }
```

**Use Cases:**
- Optimize TP/SL percentages
- Adjust timeout durations
- Fine-tune trailing stop parameters

---

### 5. **Time-Based Performance**

**Problem:** No performance breakdown by time of day, day of week, or month.

**Impact:**
- Can't identify best trading times
- Can't schedule strategies for optimal times
- Can't understand market hour effects

**Recommended Fields:**
```sql
-- Time-based performance (JSONB)
time_performance JSONB
-- Example: {
--   "hour_of_day": { "0-6": { "success_rate": 65, "occurrences": 20 }, ... },
--   "day_of_week": { "Monday": { "success_rate": 70, "occurrences": 15 }, ... },
--   "month": { "January": { "success_rate": 68, "occurrences": 45 }, ... }
-- }
```

**Use Cases:**
- Schedule strategies for best-performing hours
- Avoid trading during low-performance periods
- Understand seasonal patterns

---

### 6. **Market Condition Performance (Enhanced)**

**Problem:** Only regime performance is tracked, not volatility/F&G breakdowns.

**Impact:**
- Can't optimize for specific market conditions
- Can't understand strategy sensitivity to volatility
- Can't leverage F&G Index for strategy selection

**Recommended Implementation:**
- Populate existing `volatility_performance` and `fear_greed_performance` fields
- Calculate from backtest matches with volatility/F&G data

---

## 📊 **Recommended Implementation Priority**

### **High Priority (Immediate Value):**

1. **Live vs Backtest Performance** ⭐⭐⭐
   - Critical for strategy validation
   - Enables auto-disable of underperforming strategies
   - **Implementation:** Aggregate from `trades` table by `strategy_name`

2. **Exit Reason Breakdown** ⭐⭐⭐
   - Directly actionable for parameter optimization
   - **Implementation:** Aggregate from `trades.exit_reason` field

3. **Signal Strength Distribution** ⭐⭐
   - Helps optimize strength thresholds
   - **Implementation:** Calculate min/max/stddev from backtest matches

### **Medium Priority (Nice to Have):**

4. **Recent Performance Trends** ⭐⭐
   - Useful for strategy lifecycle management
   - **Implementation:** Time-windowed aggregation from `trades` table

5. **Risk-Adjusted Returns** ⭐⭐
   - Professional metrics (Sharpe, Sortino, Calmar)
   - **Implementation:** Calculate from existing backtest data

6. **Market Condition Performance** ⭐
   - Populate existing `volatility_performance` and `fear_greed_performance` fields
   - **Implementation:** Aggregate from backtest matches with market context

### **Low Priority (Future Enhancement):**

7. **Time-Based Performance** ⭐
   - Useful but less critical
   - **Implementation:** Aggregate from backtest matches with timestamps

8. **Entry Quality Metrics** ⭐
   - Populate existing entry quality fields
   - **Implementation:** Calculate from backtest matches with entry quality data

---

## 🔧 **Implementation Approach**

### **Option 1: Database Columns (Recommended for High Priority)**
- Add new columns to `backtest_combinations` table
- Calculate and populate during backtest save
- Update from `trades` table periodically for live performance

### **Option 2: JSONB Fields (Recommended for Complex Data)**
- Use JSONB for nested/structured data (exit reasons, time performance)
- More flexible, easier to extend
- Can query with JSONB operators

### **Option 3: Separate Analytics Table**
- Create `strategy_analytics` table
- Link to `backtest_combinations` via foreign key
- Allows more complex analytics without bloating main table

---

## 💡 **Quick Wins**

1. **Calculate Live Performance** (1-2 hours)
   - Aggregate from `trades` table
   - Update `backtest_combinations` with live metrics
   - Add comparison logic

2. **Exit Reason Breakdown** (1 hour)
   - Aggregate from `trades.exit_reason`
   - Store as JSONB in `backtest_combinations`

3. **Signal Strength Distribution** (30 minutes)
   - Calculate min/max/stddev from backtest matches
   - Add to save process

---

## 📈 **Expected Benefits**

1. **Strategy Validation:** Identify overfitted strategies early
2. **Parameter Optimization:** Data-driven TP/SL/timeout adjustments
3. **Risk Management:** Better understanding of strategy consistency
4. **Performance Tracking:** Monitor strategy health over time
5. **Market Adaptation:** Optimize for current market conditions


