# Correlation Impact on Strategy Count

## Problem

After lowering the correlation threshold from 0.8 to 0.65, the backtest is finding **fewer strategies**.

## Root Cause

### Before (Threshold = 0.8)

- **MACD ↔ EMA** (0.70 correlation): **No penalty** (below 0.8 threshold)
- **EMA ↔ MA200** (0.75 correlation): **No penalty** (below 0.8 threshold)
- Strategies with these combinations kept their full strength

**Example:**
```
MACD (40) + EMA (45) = 85 base strength
No penalty applied
Final strength: 85 (or higher with bonuses)
```

### After (Threshold = 0.65)

- **MACD ↔ EMA** (0.70 correlation): **~10.5% penalty** (above 0.65 threshold)
- **EMA ↔ MA200** (0.75 correlation): **~11.25% penalty** (above 0.65 threshold)
- Strategies with these combinations lose strength due to penalties

**Example:**
```
MACD (40) + EMA (45) = 85 base strength
Correlation penalty: 10.5% (0.70 × 0.15)
Adjusted strength: 85 × (1 - 0.105) = 76.1
Final strength: 76.1 (or slightly higher with bonuses)
```

### Impact on Strategy Filtering

If `minCombinedStrength` is set to **150**:
- **Before**: Strategy with strength 85 + bonuses = 95-100 → **Passes** (if threshold is lower) or **Fails** (if threshold is 150)
- **After**: Strategy with strength 76.1 + bonuses = 85-90 → **Fails** (below 150)

**Result**: More strategies fall below the `minCombinedStrength` threshold and are filtered out.

---

## Solutions

### Option 1: Adjust Correlation Threshold (Recommended)

**Current**: 0.65
**Recommended**: 0.70

**Rationale**:
- Still captures moderate-high correlations (0.70+)
- Allows moderate correlations (0.65-0.69) to pass without penalty
- Balances between accuracy and strategy count

**Impact**:
- MACD ↔ EMA (0.70): **Still penalized** (~10.5%)
- EMA ↔ MA200 (0.75): **Still penalized** (~11.25%)
- MACD ↔ MA200 (0.65): **No penalty** (below 0.70 threshold)

### Option 2: Reduce Penalty Factor

**Current**: 15% of average correlation
**Recommended**: 10% of average correlation

**Rationale**:
- Still penalizes correlated signals
- But reduces the impact on strategy count
- Maintains the benefit of correlation detection

**Impact**:
- MACD ↔ EMA (0.70): Penalty drops from 10.5% to **7.0%**
- EMA ↔ MA200 (0.75): Penalty drops from 11.25% to **7.5%**

### Option 3: Lower minCombinedStrength Threshold

**Current**: 150 (default)
**Recommended**: Adjust based on your needs

**Rationale**:
- If penalties are reducing strength, lower the threshold
- But this might allow weaker strategies through

**Not Recommended**: This masks the issue rather than fixing it.

### Option 4: Hybrid Approach (Best)

1. **Set threshold to 0.70** (captures moderate-high correlations)
2. **Reduce penalty factor to 10%** (less aggressive)
3. **Keep minCombinedStrength at 150** (maintains quality)

**Result**: 
- Still penalizes correlated signals
- But reduces strategy loss
- Maintains quality standards

---

## Recommendation

**Implement Option 4 (Hybrid Approach)**:

1. **Threshold**: 0.70 (instead of 0.65)
2. **Penalty Factor**: 10% (instead of 15%)
3. **Keep minCombinedStrength**: 150 (or adjust based on your needs)

This will:
- ✅ Still penalize highly correlated signals (0.70+)
- ✅ Reduce the impact on strategy count
- ✅ Maintain correlation detection benefits
- ✅ Balance accuracy with strategy diversity

---

## Expected Results

### With Threshold = 0.70 and Penalty = 10%

**MACD ↔ EMA** (0.70):
- Penalty: 7.0% (instead of 10.5%)
- Strength reduction: Less severe

**EMA ↔ MA200** (0.75):
- Penalty: 7.5% (instead of 11.25%)
- Strength reduction: Less severe

**MACD ↔ MA200** (0.65):
- Penalty: 0% (below 0.70 threshold)
- No impact

**Result**: More strategies will pass the `minCombinedStrength` threshold while still penalizing correlated signals.

