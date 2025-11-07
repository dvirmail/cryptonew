# Live Performance Flow Explanation

## 📋 The Complete Process

### **Phase 1: Backtest & Initial Save**

```
1. User runs backtest
   ↓
2. Backtest matches are processed
   ↓
3. Exit reason breakdown calculated from backtest matches
   ↓
4. Strategy saved to database:
   ✅ Backtest data: success_rate, profit_factor, etc.
   ✅ Backtest exit reason breakdown
   ❌ Live performance: NULL (no live trades yet)
```

### **Phase 2: Scanner Uses Strategy**

```
1. Scanner loads strategies from database
   ↓
2. Scanner evaluates signals using strategies
   ↓
3. When signals match → Position opened
   ↓
4. Position closed (TP/SL/timeout) → Trade saved to `trades` table
   ↓
5. `trades` table now contains:
   - strategy_name: "Strategy Name"
   - exit_reason: "take_profit" | "stop_loss" | "timeout" | etc.
   - pnl_percent: 2.5
   - trading_mode: "demo" | "live" (NOT "backtest")
```

### **Phase 3: Live Performance Gets Populated**

#### **Option A: Automatic (When Trade is Closed) ⭐ PRIMARY METHOD**

```
1. Position is closed (TP/SL/timeout)
   ↓
2. Trade saved to database via saveTradeToDB()
   ↓
3. updateStrategyLivePerformance() runs asynchronously (non-blocking)
   ↓
4. Strategy's live performance is immediately updated:
   - Query trades table WHERE strategy_name = X AND trading_mode != 'backtest'
   - Calculate live performance metrics
   - Calculate live exit reason breakdown
   - Update backtest_combinations table
   ↓
5. Strategy now has up-to-date live performance
```

#### **Option B: Automatic (When Strategies Are Loaded)**

```
1. Frontend calls GET /api/backtestCombinations
   ↓
2. loadBacktestCombinationsFromDB() loads strategies
   ↓
3. refreshAllStrategiesLivePerformance() runs asynchronously (non-blocking)
   ↓
4. For each strategy:
   - Query trades table WHERE strategy_name = X AND trading_mode != 'backtest'
   - Calculate live performance metrics
   - Calculate live exit reason breakdown
   - Update database
   ↓
5. Next time strategies are loaded, live performance is included
```

#### **Option C: Manual Refresh**

```
1. Call POST /api/backtestCombinations/refresh-live-performance
   ↓
2. refreshAllStrategiesLivePerformance() runs
   ↓
3. All strategies get updated with latest live performance
```

#### **Option D: On Strategy Save**

```
1. User saves strategy (e.g., after editing)
   ↓
2. saveBacktestCombinationToDB() is called
   ↓
3. Live performance is calculated and saved
   ↓
4. Strategy updated with latest live performance
```

---

## 🔍 Key Points

### **1. New Strategies Start with NULL Live Performance**

When a strategy is first saved after a backtest:
- ✅ Backtest data is populated
- ❌ Live performance fields are `NULL` (no live trades yet)
- This is **expected and correct**

### **2. Live Performance Requires Live Trades**

Live performance is calculated from the `trades` table:
- Filters by `strategy_name` matching the combination name
- Excludes `trading_mode = 'backtest'`
- Only includes trades with `exit_timestamp IS NOT NULL`

### **3. Automatic Refresh is Non-Blocking**

When strategies are loaded:
- Strategies are returned immediately (with existing live performance data)
- Live performance refresh runs **asynchronously in the background**
- Next load will have updated data

### **4. Performance Gap Calculation**

Performance gap = `live_success_rate - backtest_success_rate`

- **Positive gap:** Live is performing better than backtest
- **Negative gap:** Live is underperforming (possible overfitting)
- **NULL:** No live trades yet or no backtest data

---

## 📊 Example Timeline

### **Day 1: Backtest**
```
10:00 AM - User runs backtest
10:05 AM - Strategy "Strategy A" saved:
  - success_rate: 70%
  - live_success_rate: NULL
  - live_occurrences: NULL
```

### **Day 2-5: Scanner Uses Strategy**
```
Day 2, 2:00 PM - Strategy A opens position #1
Day 2, 4:00 PM - Position #1 closed (take_profit) → Trade saved
Day 3, 10:00 AM - Strategy A opens position #2
Day 3, 11:00 AM - Position #2 closed (stop_loss) → Trade saved
...
Day 5, 3:00 PM - Strategy A has 10 live trades
```

### **Day 2-5: Live Performance Updated Automatically**
```
Day 2, 4:00 PM - Position #1 closed (take_profit)
              → Trade saved to database
              → updateStrategyLivePerformance("Strategy A") runs automatically
              → Strategy A updated:
                - live_success_rate: 100% (1 win / 1 trade)
                - live_occurrences: 1
                - exit_reason_breakdown: { "take_profit": { count: 1, percentage: 100 } }

Day 3, 11:00 AM - Position #2 closed (stop_loss)
              → Trade saved to database
              → updateStrategyLivePerformance("Strategy A") runs automatically
              → Strategy A updated:
                - live_success_rate: 50% (1 win / 2 trades)
                - live_occurrences: 2
                - exit_reason_breakdown: {
                    "take_profit": { count: 1, percentage: 50 },
                    "stop_loss": { count: 1, percentage: 50 }
                  }

... (continues for each trade)

Day 5, 3:00 PM - Position #10 closed
              → Trade saved to database
              → updateStrategyLivePerformance("Strategy A") runs automatically
              → Strategy A updated:
                - live_success_rate: 60% (6 wins / 10 trades)
                - live_occurrences: 10
                - performance_gap_percent: -10% (60% - 70%)
                - exit_reason_breakdown: {
                    "take_profit": { count: 6, percentage: 60 },
                    "stop_loss": { count: 4, percentage: 40 }
                  }
```

---

## 🛠️ Manual Operations

### **Refresh All Strategies**

```bash
curl -X POST http://localhost:3003/api/backtestCombinations/refresh-live-performance
```

### **Check Live Performance in Database**

```sql
SELECT 
  combination_name,
  success_rate as backtest_sr,
  live_success_rate,
  performance_gap_percent,
  live_occurrences,
  exit_reason_breakdown
FROM backtest_combinations
WHERE live_occurrences > 0
ORDER BY performance_gap_percent ASC;
```

---

## ✅ Summary

1. **Backtest → Save:** Strategy saved with backtest data, live performance = NULL
2. **Scanner → Trades:** Scanner uses strategy, creates live trades
3. **Auto Update on Trade Close:** ⭐ **Live performance updated immediately when each trade is closed**
4. **Auto Refresh on Load:** Live performance also refreshed when strategies are loaded (backup)
5. **View Results:** See backtest vs live comparison in database/UI

**The system automatically keeps live performance up-to-date in real-time as trades are closed!**

### **Update Triggers (in priority order):**

1. **⭐ When trade is closed** - Immediate update (primary method)
2. When strategies are loaded - Background refresh (backup)
3. When strategy is saved - Recalculation
4. Manual refresh endpoint - On-demand update

