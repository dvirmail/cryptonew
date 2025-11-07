# Signal Lookup Logs Explanation

## Date: 2024
## Purpose: Explain what the TTM_SQUEEZE "NOT FOUND IN LOOKUP" logs mean

---

## Log Analysis

### Log Pattern:
```
[SIGNAL_LOOKUP] 📋 Processing object with 11 keys
[SIGNAL_LOOKUP] ❌❌❌ TTM_SQUEEZE NOT FOUND IN LOOKUP ❌❌❌
[SIGNAL_LOOKUP] Available keys: ['adx', 'atr', 'bbw', 'ema', 'sma', 'ma200', 'macd', 'rsi', 'obv', 'volume_sma', 'volume_roc']
```

---

## What These Logs Mean

### 1. **"Processing object with X keys"**

This means `createSignalLookup()` received an **object** (not an array) containing signal settings. The object has been pre-processed from strategy signals.

**Flow:**
1. Strategy has signals: `[{ type: 'RSI', value: '...' }, { type: 'TTMSqueeze', value: '...' }]`
2. Converted to object: `{ RSI: {...}, TTMSqueeze: {...} }`
3. Passed to `createSignalLookup({ RSI: {...}, TTMSqueeze: {...} })`

### 2. **"TTM_SQUEEZE NOT FOUND IN LOOKUP"**

This is **informational**, not an error. It means:

✅ **The strategies being evaluated don't use TTM Squeeze signals**

The available keys show what signals **ARE** being used:
- `adx`, `atr`, `bbw`, `ema`, `sma`, `ma200`, `macd`, `rsi`, `obv`, `volume_sma`, `volume_roc`

**This is expected behavior** when:
- Evaluating strategies that don't include TTM Squeeze
- Scanning multiple strategies, some with TTM Squeeze, some without
- Processing strategy groups where not all strategies use TTM Squeeze

---

## Why You See This Multiple Times

The logs appear multiple times because:

1. **Multiple Strategy Groups**: The scanner processes strategies in groups (by coin/timeframe)
2. **Different Strategies**: Each group may contain different strategies with different signal types
3. **Per-Evaluation Call**: `createSignalLookup` is called for each evaluation cycle

**Example:**
- Group 1 (BTC/USDT): Has strategies with RSI, MACD, ADX → **No TTM Squeeze** (log appears)
- Group 2 (ETH/USDT): Has strategies with RSI, TTM Squeeze → **TTM Squeeze found** (different log)
- Group 3 (BNB/USDT): Has strategies with ATR, OBV → **No TTM Squeeze** (log appears)

---

## Is This a Problem?

### ❌ **NO - This is NOT an error**

**Why it's safe:**
1. **Expected Behavior**: Not all strategies use all 34 signal types
2. **Performance Optimization**: Only calculates indicators that are actually needed
3. **Conditional Calculation**: TTM Squeeze indicator won't be calculated (saves CPU/memory)
4. **Graceful Handling**: The system continues normally without TTM Squeeze

### ✅ **This is GOOD Design**

The system:
- Only calculates what's needed
- Skips unnecessary indicators
- Processes each strategy group independently
- Handles missing signals gracefully

---

## When to Worry

**Only investigate if:**

1. ❌ **ALL strategies** that should have TTM Squeeze show this warning
   - Check: Do your strategies actually include `{ type: 'TTMSqueeze', ... }` signals?

2. ❌ **Signal extraction fails** to normalize TTM Squeeze
   - Check logs for: `[SIGNAL_EXTRACTION] ❌❌❌ TTM_SQUEEZE NOT FOUND IN EXTRACTION`

3. ❌ **Strategies with TTM Squeeze** consistently show "NOT FOUND"
   - This would indicate a normalization issue

---

## Expected Log Sequence (For Strategies WITH TTM Squeeze)

When a strategy **does** have TTM Squeeze, you should see:

```
[SIGNAL_EXTRACTION] 🔄 Normalizing "TTMSqueeze" → "ttm_squeeze" for strategy "..."
[SIGNAL_EXTRACTION] ✅✅✅ TTM_SQUEEZE FOUND IN EXTRACTION! ✅✅✅
[SIGNAL_LOOKUP] 🔄 Normalizing "TTMSqueeze" → "ttm_squeeze"
[SIGNAL_LOOKUP] ✅ Added object key: "TTMSqueeze" → "ttm_squeeze"
[SIGNAL_LOOKUP] ✅✅✅ TTM_SQUEEZE FOUND IN LOOKUP! ✅✅✅
[TTM_SQUEEZE_CALC] ✅✅✅ TTM_SQUEEZE SIGNAL DETECTED! Starting calculation...
```

---

## Expected Log Sequence (For Strategies WITHOUT TTM Squeeze)

When a strategy **doesn't** have TTM Squeeze (normal case):

```
[SIGNAL_LOOKUP] 📋 Processing object with X keys
[SIGNAL_LOOKUP] ❌❌❌ TTM_SQUEEZE NOT FOUND IN LOOKUP ❌❌❌
[SIGNAL_LOOKUP] Available keys: ['rsi', 'macd', 'atr', ...]
[TTM_SQUEEZE_CALC] (skipped - not needed)
```

**This is perfectly normal!**

---

## Summary

### What the logs show:
- **Strategy Group 1**: Uses 11 different signals (no TTM Squeeze)
- **Strategy Group 2**: Uses 3 different signals (no TTM Squeeze)

### Why this happens:
- Different strategies use different signal combinations
- Not every strategy needs all 34 signal types
- The system only calculates what's requested

### Is it safe?
✅ **YES** - This is expected, informational logging. The system works correctly.

### What to do?
**Nothing** - These logs are just showing which signals each strategy group uses. If you want TTM Squeeze to be calculated, make sure your strategies include TTM Squeeze signals in their configuration.

---

## Verification

To verify TTM Squeeze is working when it SHOULD be present:

1. Check if your test strategy (`TEST - All 34 Signals Comprehensive`) includes TTM Squeeze
2. Look for `[SIGNAL_EXTRACTION] ✅✅✅ TTM_SQUEEZE FOUND IN EXTRACTION!` logs
3. Check that the strategy is actually being evaluated (check strategy filtering logs)
4. Verify the strategy is included in the scanner (`includedInScanner: true`)

If all of the above are true but you still see "NOT FOUND", then investigate normalization. Otherwise, these logs are just showing that some strategy groups don't use TTM Squeeze, which is perfectly normal.

