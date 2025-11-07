# Live Performance & Exit Reason Breakdown Implementation

## ✅ Implementation Complete

### **1. Database Schema Updates**

Added new columns to `backtest_combinations` table:

#### **Live Performance Fields:**
- `live_success_rate` - Success rate from live trading
- `live_occurrences` - Number of live trades
- `live_avg_price_move` - Average price move in live trading
- `live_profit_factor` - Profit factor from live trading
- `live_max_drawdown_percent` - Maximum drawdown in live trading
- `live_win_loss_ratio` - Win/loss ratio from live trading
- `live_gross_profit_total` - Total gross profit from live trading
- `live_gross_loss_total` - Total gross loss from live trading
- `performance_gap_percent` - Difference between backtest and live success rate
- `last_live_trade_date` - Date of most recent live trade

#### **Exit Reason Breakdown Fields:**
- `exit_reason_breakdown` (JSONB) - Breakdown from live trades
- `backtest_exit_reason_breakdown` (JSONB) - Breakdown from backtest matches

### **2. Proxy Server Functions**

#### **`calculateLivePerformanceForStrategy(strategyName)`**
- Aggregates live trading performance from `trades` table
- Calculates: success rate, profit factor, win/loss ratio, drawdown, etc.
- Filters by `strategy_name` and excludes `backtest` trading mode

#### **`calculateLiveExitReasonBreakdown(strategyName)`**
- Aggregates exit reasons from live trades
- Groups by `exit_reason` and calculates count, percentage, and avg P&L
- Returns JSONB structure: `{ "take_profit": { count, percentage, avg_pnl }, ... }`

#### **`calculateBacktestExitReasonBreakdown(matches, takeProfitPercentage, stopLossPercentage)`**
- Infers exit reasons from backtest matches
- Logic:
  - Successful + priceMove >= 90% of TP → `take_profit`
  - Successful + priceMove < 90% of TP → `timeout`
  - Failed + |priceMove| >= 90% of SL → `stop_loss`
  - Failed + |priceMove| < 90% of SL → `timeout`

### **3. Backtest Processor Updates**

#### **`calculateBacktestExitReasonBreakdown()` function**
- Added to `backtestProcessor.jsx`
- Calculates exit reason breakdown from backtest matches
- Uses TP/SL percentages from config (defaults: 5% TP, 2% SL)

#### **Updated `processBacktestResults()`**
- Now calculates `backtestExitReasonBreakdown` for each strategy
- Includes in return object

#### **Updated `processMatches()`**
- Adds `backtestExitReasonBreakdown` to `regimeStrategy` objects
- Uses config TP/SL percentages or defaults

### **4. Save Function Updates**

#### **`saveBacktestCombinationToDB()`**
- **Automatically calculates live performance** when saving strategies
- **Automatically calculates live exit reason breakdown**
- **Calculates performance gap** (live vs backtest success rate)
- Updates both new and existing strategies

### **5. Frontend Updates**

#### **`SaveCombinationsButton.jsx`**
- Passes `backtestExitReasonBreakdown` to proxy server
- Preserves exit reason breakdown data through save flow

---

## 📊 Data Structure

### **Exit Reason Breakdown Format:**

```json
{
  "take_profit": {
    "count": 45,
    "percentage": 75.0,
    "avg_pnl": 2.3
  },
  "stop_loss": {
    "count": 10,
    "percentage": 16.7,
    "avg_pnl": -1.8
  },
  "timeout": {
    "count": 3,
    "percentage": 5.0,
    "avg_pnl": 0.5
  },
  "trailing_stop_hit": {
    "count": 2,
    "percentage": 3.3,
    "avg_pnl": 1.2
  }
}
```

### **Live Performance Example:**

```
Backtest Success Rate: 70.0%
Live Success Rate: 65.5%
Performance Gap: -4.5% (live underperforming)
Live Occurrences: 20 trades
Live Profit Factor: 3.2
```

---

## 🔄 How It Works

### **The Complete Flow:**

#### **Step 1: Backtest & Save Strategy**
1. User runs a backtest
2. Backtest results are processed and `backtestExitReasonBreakdown` is calculated
3. Strategy is saved to database with:
   - ✅ Backtest performance data (success rate, profit factor, etc.)
   - ✅ Backtest exit reason breakdown
   - ❌ Live performance = `NULL` (no live trades yet)

#### **Step 2: Scanner Uses Strategy**
1. Scanner loads strategies from database
2. Scanner uses strategies to evaluate signals
3. When signals match, positions are opened
4. Positions are closed (TP/SL/timeout) and saved to `trades` table with `strategy_name`

#### **Step 3: Live Performance Gets Populated**
1. **Automatic Refresh:** When strategies are loaded (GET `/api/backtestCombinations`), live performance is refreshed asynchronously in the background
2. **Manual Refresh:** Call POST `/api/backtestCombinations/refresh-live-performance` to refresh all strategies
3. **On Save:** When a strategy is saved again, live performance is recalculated

### **Automatic Updates:**

- **When strategies are loaded:** Live performance is refreshed asynchronously (non-blocking)
- **When a strategy is saved:** Live performance is recalculated from the `trades` table
- **Manual refresh endpoint:** Available at `/api/backtestCombinations/refresh-live-performance`

### **Important Notes:**

- **New strategies** will have `NULL` live performance until they have live trades
- **Live performance is calculated from `trades` table** where `strategy_name` matches and `trading_mode != 'backtest'`
- **Performance gap** is only calculated when both backtest and live data exist

---

## 📈 Benefits

1. **Strategy Validation:** Compare backtest vs live performance
2. **Exit Optimization:** See which exit reasons are most common
3. **Parameter Tuning:** Adjust TP/SL based on exit reason breakdown
4. **Performance Tracking:** Monitor strategy health over time
5. **Data-Driven Decisions:** Make informed choices about strategy viability

---

## 🔍 Example Queries

```sql
-- Find strategies with large performance gaps (overfitting)
SELECT combination_name, success_rate, live_success_rate, performance_gap_percent
FROM backtest_combinations
WHERE performance_gap_percent < -10
ORDER BY performance_gap_percent ASC;

-- Find strategies with high take profit hit rate
SELECT combination_name, 
       exit_reason_breakdown->'take_profit'->>'percentage' as tp_percentage
FROM backtest_combinations
WHERE exit_reason_breakdown->'take_profit'->>'percentage'::numeric > 70
ORDER BY tp_percentage DESC;

-- Compare backtest vs live exit reasons
SELECT combination_name,
       backtest_exit_reason_breakdown->'take_profit'->>'percentage' as backtest_tp_pct,
       exit_reason_breakdown->'take_profit'->>'percentage' as live_tp_pct
FROM backtest_combinations
WHERE exit_reason_breakdown IS NOT NULL
  AND backtest_exit_reason_breakdown IS NOT NULL;
```

---

## ✅ Next Steps

The implementation is complete and ready to use. When you:
1. **Run a backtest** → Exit reason breakdown is calculated
2. **Save strategies** → Live performance is automatically calculated and saved
3. **View strategies** → You can see both backtest and live performance side-by-side

**Note:** Existing strategies will get live performance data the next time they are saved (or you can manually trigger a save to update them).

