# Position Save Debugging Guide

## A) Proxy Logs to Check

When positions aren't being saved, check the proxy logs (`proxy.log`) for these specific log messages:

### 1. **Entry Point Logs** (Frontend → Proxy)
Look for:
```
[PROXY] 💾 saveLivePositionToDB called for: {symbol, position_id, id, has_entry_fill_time_ms, ...}
```
- **If missing**: The frontend `LivePosition.create()` call is not reaching the proxy server
- **Check**: Network connectivity, API endpoint routing, CORS issues

### 2. **Database Save Success Logs**
Look for:
```
[PROXY] ✅ Saved position to DB: [SYMBOL] ([ID]...) status=[STATUS] mode=[MODE] in [TIME]ms
[PROXY] 📊 Insert result: rowCount=1, command=INSERT
[PROXY] 🔍 Entry quality fields saved: {...}
```
- **If present**: Position was successfully saved to database
- **If missing**: Check error logs below

### 3. **Database Error Logs**
Look for:
```
[PROXY] ❌ ERROR saving position to database: [ERROR]
[PROXY] ❌ Error details: {message, code, detail, hint, ...}
```

**Common Error Codes:**
- **`23505`**: Duplicate key error - position ID already exists
- **`23502`**: Not null constraint violation - required field missing
- **`42P01`**: Table does not exist - database schema issue
- **`42703`**: Column does not exist - **MISSING `entry_fill_time_ms` COLUMN**

### 4. **Frontend Logs** (Console)
Look for:
```
[PositionManager] 💾 Attempting to save position to database...
[PositionManager] 💾 positionData keys: [...]
[PositionManager] 💾 positionData summary: {...}
[PositionManager] ✅ LivePosition.create() completed successfully
```
- **If missing**: Code is not reaching `LivePosition.create()` call
- **Check**: Look for errors before this point in the console

### 5. **Verification Logs**
Look for:
```
[PROXY] ✅ Position immediately queryable after INSERT
[PROXY] ✅ Verified in DB: [SYMBOL] status=[STATUS] mode=[MODE]
[PROXY] ✅ Position found in main query pattern
```

## B) Why NULL Fields Are OK

### 1. **Distance to Support/Resistance: NOT AVAILABLE**

**Why it's NULL:**
- Support/resistance levels are calculated from historical price data (kline/candlestick patterns)
- The calculation requires:
  - Historical kline data for the symbol
  - Valid support/resistance detection algorithm
  - Data available in `signal.supportResistance` or `scannerService.state.indicators[symbol].supportresistance`

**When it's NULL:**
- No support/resistance data available in the signal
- Support/resistance detection hasn't run for this symbol yet
- Market conditions don't have clear support/resistance levels
- Insufficient historical data for calculation

**Is it OK?**
✅ **YES** - This is expected behavior:
- Not all market conditions have clear support/resistance
- Support/resistance detection is probabilistic and may not always identify levels
- The system gracefully handles missing data by setting fields to NULL
- Other metrics (day high/low, volume) still provide entry quality context

### 2. **Entry Momentum Score: NOT AVAILABLE**

**Why it's NULL:**
- Momentum score is calculated from the 24-hour price change percentage
- Requires: `priceCacheService.getTicker24hr(symbol)` to return valid data

**When it's NULL:**
- 24hr ticker data not available from Binance
- Price cache service not initialized
- Network error fetching ticker data
- Symbol doesn't have 24hr ticker data available

**Is it OK?**
✅ **YES** - This is acceptable:
- Momentum is a supplementary metric, not critical for position opening
- The system has other metrics (day high/low, volume) that provide entry context
- Market conditions can change rapidly, making 24hr momentum less relevant
- The system handles missing data gracefully

### 3. **What Fields ARE Working**

✅ **Working correctly:**
- `entry_relative_to_day_high_percent`: 87.03% (entry is near day high)
- `entry_relative_to_day_low_percent`: 12.97% (entry is near day low)
- `entry_volume_vs_average`: 0.67x (volume is 67% of average)
- `entry_near_support`: false (correctly identified)
- `entry_near_resistance`: false (correctly identified)
- `entry_fill_time_ms`: 4570ms (correctly captured)

## C) Next Steps

1. **Check if `entry_fill_time_ms` column exists in database:**
   ```sql
   \d live_positions
   ```
   Or:
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'live_positions' AND column_name = 'entry_fill_time_ms';
   ```

2. **If column is missing, add it:**
   ```sql
   ALTER TABLE live_positions 
   ADD COLUMN IF NOT EXISTS entry_fill_time_ms INTEGER;
   ```

3. **Monitor proxy logs when opening a new position:**
   ```bash
   tail -f proxy.log | grep -E "\[PROXY\]|saveLivePositionToDB|ERROR|Saved position"
   ```

4. **Check frontend console for:**
   - `[PositionManager] 💾 Attempting to save position to database...`
   - `[PositionManager] ✅ LivePosition.create() completed successfully`
   - Any error messages before/after these logs

