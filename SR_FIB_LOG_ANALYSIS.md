# Support/Resistance and Fibonacci Log Analysis

## Summary of Findings

### 1. **Support/Resistance (SR) Analysis**

#### ✅ What's Working:
- **Pivot Detection**: Successfully detected **4,032 raw pivot points** (2,027 support + 2,005 resistance)
- **Level Clustering**: Reduced to **112 merged levels** (57 support + 55 resistance) after clustering
- **Calculation Logic**: The `calculateSupportResistance` function is working correctly

#### ❌ Critical Issues:

**Problem 1: Limited Level Availability**
- **Only 24.9% of candles have support levels** (2,259/9,071)
- **Only 25.3% of candles have resistance levels** (2,294/9,071)
- **Only 8.5% of candles have BOTH** (773/9,071)
- **Result**: 75% of candles have **zero levels**, causing SR_EVAL to return "No Clear Levels"

**Root Cause:**
The lookback window filtering is too restrictive. Levels are only included if:
1. The pivot was detected within the `lookback` window (60-100 candles)
2. For early candles (before full lookback window), it checks `levelObj.index >= 0 && levelObj.index <= windowEnd`
3. For later candles, it checks `levelObj.index >= windowStart && levelObj.index <= windowEnd`

**Impact:**
- Early candles (indices 250-254) show 0 levels because detected pivots are outside their lookback window
- This is expected behavior but results in 75% of candles having no signals

**SR_EVAL Diagnostic Shows:**
```
supportLevels: 0 total (0 below price, 0 above)
resistanceLevels: 0 total (0 above price, 0 below)
totalLevels: 0 (Level Density requires >=1)
```

This confirms that even though levels exist in the calculation, they're not available for the specific candles being evaluated.

---

### 2. **Fibonacci (FIB) Analysis**

#### ✅ What's Working:
- **Data Coverage**: **99.4% valid Fibonacci data** (9,014/9,072 candles)
- **Swing Detection**: Successfully detecting swings (9 swings, 10 swings, 4 swings, etc.)
- **Calculation Logic**: The `calculateFibonacciRetracements` function is working

#### ❌ Critical Issues:

**Problem 1: Null Data at Early Indices**
- **Index 48 is null** (as warned in logs)
- **Start Index**: Calculation begins at `lookbackPeriod - 2` = 60 - 2 = **58**
- This means indices 0-57 are **intentionally null** (insufficient history)

**Problem 2: FIB_EVAL Getting No Data**
- Despite 99.4% valid data, FIB_EVAL logs show: `"No Fibonacci Data"`
- **Root Cause**: The Fibonacci data structure might not match what FIB_EVAL expects
- FIB_EVAL looks for levels in multiple formats:
  - `currentFib.levels?.[levelName]` 
  - `currentFib[levelName]`
  - `currentFib.levels?.[fib${levelName}]`
  - etc.

**Problem 3: Lookback Period Mismatch**
- Logs show: `Lookback period: 60`
- But default should be **100** (from `indicatorManager.jsx`)
- Something is overriding the default to 60
- This reduces the historical window for swing detection

---

## Key Statistics from Logs

### Support/Resistance:
```
Raw pivots: 4,032 total (2,027 support, 2,005 resistance)
Merged levels: 112 total (57 support, 55 resistance)
Candles with support: 2,259/9,071 (24.9%)
Candles with resistance: 2,294/9,071 (25.3%)
Candles with both: 773/9,071 (8.5%)
```

### Fibonacci:
```
Total candles: 9,072
Valid Fibonacci data: 9,014/9,072 (99.4%)
Lookback period: 60 (should be 100?)
Min swing percent: 1.5%
Sample[58]: hasLevels=true, swingType=none
Sample[48]: null (expected - before start index)
```

---

## Recommendations

### For Support/Resistance:

1. **Expand Lookback Window Filtering**
   - Consider including levels from ALL detected pivots (not just within lookback window)
   - Or increase the lookback period for level availability
   - Trade-off: More levels = more noise, but fewer "No Clear Levels" signals

2. **Improve Level Persistence**
   - Once a level is detected, consider keeping it active for longer (e.g., until price breaks significantly)
   - This would increase the percentage of candles with available levels

3. **Add Debug Logging to SR_EVAL**
   - Log when `currentLevels` is null vs when arrays are empty
   - This will help distinguish between "no calculation" vs "no levels in window"

### For Fibonacci:

1. **Fix Lookback Period**
   - Investigate why lookback is 60 instead of 100
   - Check if signal settings are overriding the default

2. **Verify Data Structure**
   - Add diagnostic logging to show the actual structure of `currentFib` at various indices
   - Verify that `levels` object exists and contains the expected keys

3. **Early Index Handling**
   - Consider using the most recent valid Fibonacci data for early indices
   - Or clearly document that indices < lookbackPeriod are expected to be null

---

## Expected Behavior vs Actual

### Expected:
- **SR**: Most candles should have at least 1-2 levels available (within price range)
- **FIB**: Levels should be available for all candles after index ~100

### Actual:
- **SR**: Only 25% of candles have levels, 75% return "No Clear Levels"
- **FIB**: 99.4% have data structure, but FIB_EVAL can't extract levels (structure mismatch?)

---

## Next Steps

1. **Immediate**: Add diagnostic logging to verify Fibonacci data structure
2. **Short-term**: Investigate why SR levels are only available for 25% of candles
3. **Medium-term**: Consider adjusting level persistence logic for both SR and FIB

