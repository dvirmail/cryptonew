# Backtest Combinations Analytics Enhancements

## Current State Analysis

### Existing Columns in `backtest_combinations`:
- Basic Info: `combination_name`, `coin`, `strategy_direction`, `timeframe`
- Performance: `success_rate`, `occurrences`, `avg_price_move`, `profit_factor`, `combined_strength`
- Risk Management: `stop_loss_percentage`, `take_profit_percentage`, `trailing_stop_percentage`
- Timing: `estimated_exit_time_minutes`
- Market Context: `dominant_market_regime`
- Configuration: `enable_trailing_take_profit`, `position_size_percentage`, `is_event_driven_strategy`
- Metadata: `signals` (JSONB), `created_date`, `updated_date`, `enabled`, `is_favorite`

### Gaps Identified:
Based on codebase analysis, these metrics are **calculated during backtesting** but **not stored** in the database:

1. **Regime-Specific Performance** - Success rates per market regime
2. **Drawdown Metrics** - Maximum and median drawdown
3. **Timing Statistics** - Time to peak, average exit time variance
4. **Risk-Adjusted Returns** - Sharpe ratio, Sortino ratio
5. **Win/Loss Analysis** - Average win vs average loss, win/loss ratio
6. **Consistency Metrics** - Consecutive wins/losses, recovery patterns
7. **Entry Quality** - Average entry quality scores at strategy entry points
8. **Market Condition Correlation** - Performance by volatility, F&G index, LPM

---

## Recommended New Columns

### Priority 1: Core Performance Analytics (HIGH VALUE)

#### 1. **Regime-Specific Performance** (JSONB)
```sql
regime_performance JSONB
-- Stores: { "uptrend": { "success_rate": 75.5, "occurrences": 45, "avg_price_move": 2.3 }, ... }
-- Enables: Strategy selection based on current market regime
```

#### 2. **Drawdown Metrics**
```sql
max_drawdown_percent NUMERIC(10,4)  -- Maximum drawdown during backtest
median_drawdown_percent NUMERIC(10,4)  -- Median drawdown across all occurrences
median_lowest_low_percent NUMERIC(10,4)  -- Historical support level analysis
-- Enables: Risk assessment and position sizing optimization
```

#### 3. **Win/Loss Analysis**
```sql
avg_win_percent NUMERIC(10,4)  -- Average profit on winning trades
avg_loss_percent NUMERIC(10,4)  -- Average loss on losing trades
win_loss_ratio NUMERIC(10,4)  -- Ratio of wins to losses
-- Enables: Understanding risk/reward profile
```

#### 4. **Profit Factor Verification**
```sql
profit_factor NUMERIC(10,4)  -- Ensure this is consistently saved
gross_profit_total NUMERIC(10,4)  -- Total gross profit
gross_loss_total NUMERIC(10,4)  -- Total gross loss
-- Enables: Profit factor validation and analysis
```

### Priority 2: Timing & Consistency Analytics (MEDIUM VALUE)

#### 5. **Timing Statistics**
```sql
avg_time_to_peak_minutes NUMERIC(10,2)  -- Average time to reach peak profit
median_exit_time_minutes NUMERIC(10,2)  -- Median actual exit time
exit_time_variance_minutes NUMERIC(10,2)  -- Standard deviation of exit times
-- Enables: Exit timing optimization
```

#### 6. **Consistency Metrics**
```sql
max_consecutive_wins INTEGER  -- Longest winning streak
max_consecutive_losses INTEGER  -- Longest losing streak
avg_trades_between_wins NUMERIC(5,2)  -- Recovery pattern
-- Enables: Strategy reliability assessment
```

### Priority 3: Advanced Analytics (NICE TO HAVE)

#### 7. **Risk-Adjusted Returns**
```sql
sharpe_ratio NUMERIC(10,4)  -- Risk-adjusted return metric
sortino_ratio NUMERIC(10,4)  -- Downside risk-adjusted return
calmar_ratio NUMERIC(10,4)  -- Return vs max drawdown
-- Enables: Professional portfolio analysis
```

#### 8. **Market Condition Correlation** (JSONB)
```sql
volatility_performance JSONB
-- Stores: Performance by volatility regime (low/medium/high)
-- Example: { "low": { "success_rate": 80, "occurrences": 20 }, ... }

fear_greed_performance JSONB
-- Stores: Performance by F&G classification
-- Example: { "Extreme Fear": { "success_rate": 85, ... }, ... }
```

#### 9. **Entry Quality Metrics**
```sql
avg_entry_quality_score NUMERIC(5,2)  -- Average entry quality at strategy triggers
avg_entry_momentum_score NUMERIC(5,2)  -- Average momentum at entry
avg_sr_proximity_percent NUMERIC(10,4)  -- Average distance to support/resistance
-- Enables: Entry optimization
```

#### 10. **Performance Attribution**
```sql
best_performing_symbol VARCHAR(50)  -- Symbol with highest success rate
worst_performing_symbol VARCHAR(50)  -- Symbol with lowest success rate
best_performing_timeframe VARCHAR(10)  -- If strategy tested on multiple timeframes
-- Enables: Strategy refinement
```

---

## Implementation Notes

### 1. **Regime Performance Storage**
- Store as JSONB for flexibility
- Structure: `{ "regime_name": { "success_rate": X, "occurrences": Y, "avg_price_move": Z, "profit_factor": W } }`
- Allows querying with JSONB operators

### 2. **Migration Strategy**
- Add columns with `DEFAULT NULL` to avoid breaking existing data
- Populate existing records with calculated values from `occurrenceDates` if available
- New backtests will populate these fields automatically

### 3. **Calculation Source**
- Most metrics are already calculated in `backtestProcessor.jsx`
- Need to ensure they're passed to `saveBacktestCombinationToDB`
- Update `SaveCombinationsButton.jsx` to include new fields

### 4. **Query Performance**
- Add indexes on frequently queried columns:
  - `profit_factor`
  - `max_drawdown_percent`
  - `win_loss_ratio`
  - `sharpe_ratio`

---

## Benefits

1. **Strategy Selection**: Choose strategies based on current market regime
2. **Risk Management**: Understand drawdown patterns before deploying
3. **Exit Optimization**: Use timing statistics to optimize exit parameters
4. **Portfolio Analysis**: Compare strategies using professional metrics (Sharpe, Sortino)
5. **Entry Quality**: Identify which entry conditions lead to best performance
6. **Market Correlation**: Understand when strategies work best (volatility, sentiment)

---

## Example Queries Enabled

```sql
-- Find best strategies for current downtrend market
SELECT * FROM backtest_combinations 
WHERE regime_performance->>'downtrend'->>'success_rate' > 70;

-- Find low-risk strategies (low drawdown)
SELECT * FROM backtest_combinations 
WHERE max_drawdown_percent < 5.0 AND success_rate > 60;

-- Find consistent strategies (high win/loss ratio)
SELECT * FROM backtest_combinations 
WHERE win_loss_ratio > 2.0 AND occurrences > 20;

-- Find best risk-adjusted returns
SELECT * FROM backtest_combinations 
WHERE sharpe_ratio > 1.5 
ORDER BY sharpe_ratio DESC;
```

