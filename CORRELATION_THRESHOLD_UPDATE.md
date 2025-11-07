# Correlation Threshold Update

## Changes Made

### 1. Lowered Correlation Threshold
- **Before**: 0.8 (80%)
- **After**: 0.65 (65%)
- **Rationale**: Capture moderate correlations that should still be penalized

### 2. Added Sampled Logging
- Logs first 3 correlation checks with full details
- Then logs every 100th check to avoid flooding console
- Shows all checked pairs and their correlations
- Displays penalty/bonus calculations when applicable

### 3. Updated Default Parameters
- `filterCorrelatedSignals` default `maxCorrelation` updated from 0.8 to 0.65

---

## Impact

### Signals Now Penalized (Previously Ignored)

| Signal Pair | Correlation | Penalty Applied? |
|-------------|-------------|-----------------|
| MACD ↔ EMA | 0.70 | ✅ Yes (~10.5%) |
| MACD ↔ MA200 | 0.65 | ✅ Yes (~9.75%) |
| EMA ↔ MA200 | 0.75 | ✅ Yes (~11.25%) |
| CCI ↔ RSI | 0.75 | ✅ Yes (~11.25%) |
| Support/Resistance ↔ Fibonacci | 0.75 | ✅ Yes (~11.25%) |
| Pivot ↔ Fibonacci | 0.70 | ✅ Yes (~10.5%) |

### Signals Still Penalized (High Correlation)

| Signal Pair | Correlation | Penalty Applied? |
|-------------|-------------|-----------------|
| RSI ↔ Stochastic | 0.85 | ✅ Yes (~12.75%) |
| Stochastic ↔ Williams %R | 0.90 | ✅ Yes (~13.50%) |
| EMA ↔ DEMA | 0.85 | ✅ Yes (~12.75%) |

---

## Logging Examples

### Initial Checks (First 3)
```
[CORRELATION] Initial check #1: Found 1 correlation(s) above threshold (0.65): MACD ↔ EMA: 0.700
[CORRELATION] All checked pairs: MACD ↔ EMA: 0.700 ⚠️
[CORRELATION_PENALTY] 1 correlation(s) found. Average: 0.700, Penalty: 10.50%
```

### Sampled Checks (Every 100th)
```
[CORRELATION] Check #100: Found 2 correlation(s) above threshold (0.65): MACD ↔ EMA: 0.700, EMA ↔ MA200: 0.750
[CORRELATION] (Suppressed 99 correlation checks since last log)
[CORRELATION_PENALTY] 2 correlation(s) found. Average: 0.725, Penalty: 10.88%
```

### No Correlations Found
```
[CORRELATION] Initial check #2: No correlations found above threshold (0.65). Checked pairs: RSI ↔ Volume: 0.200, MACD ↔ Bollinger: 0.200
```

---

## Testing

To test correlation detection in console:
```javascript
// Test specific correlation
window.testCorrelation('MACD', 'EMA')
// Output: MACD ↔ EMA: 0.700

// Test all correlations
window.testCorrelations()
```

---

## Version
- **File**: `SignalCorrelationDetector.jsx`
- **Version**: 2.2.0
- **Date**: 2025-01-27

