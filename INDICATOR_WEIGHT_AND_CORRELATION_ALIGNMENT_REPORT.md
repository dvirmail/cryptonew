# Indicator Weight and Correlation Alignment Report

## Executive Summary

This report analyzes the alignment of indicator weights and correlation calculations between the **Backtest Engine** and **Autoscanner** systems.

---

## ✅ GOOD NEWS: Systems Are Aligned

Both systems use the **same unified calculator** (`calculateUnifiedCombinedStrength`) which ensures consistency.

---

## 1. Indicator Weights Alignment

### Source of Truth
**File**: `src/components/utils/signalSettings.jsx`

Both backtest and autoscanner use the **same** `SIGNAL_WEIGHTS` object:

```javascript
export const SIGNAL_WEIGHTS = {
  // CORE SIGNALS (1.5-2.0)
  'macd': 1.8,
  'rsi': 1.8,
  'ichimoku': 1.7,
  'stochastic': 1.7,
  'ema': 1.6,
  'bollinger': 1.6,
  'ma200': 1.5,
  'atr': 1.5,
  
  // IMPORTANT SIGNALS (1.2-1.4)
  'psar': 1.2,
  'williamsr': 1.3,
  'mfi': 1.2,
  'adx': 1.2,
  'cci': 1.2,
  // ... etc
};
```

**Status**: ✅ **ALIGNED** - Single source of truth

---

## 2. Correlation System Alignment

### Both Systems Use Same Components

#### Backtest Engine
- **File**: `src/components/backtesting/core/AdvancedSignalStrengthCalculator.jsx`
- **Correlation Detector**: `SignalCorrelationDetector` (shared instance)
- **Calculator**: `calculateUnifiedCombinedStrength()` via wrapper

#### Autoscanner
- **File**: `src/components/utils/signalLogic.jsx`
- **Correlation Detector**: `SignalCorrelationDetector` (shared instance via `unifiedStrengthCalculator`)
- **Calculator**: `calculateUnifiedCombinedStrength()` directly

**Status**: ✅ **ALIGNED** - Both use same `SignalCorrelationDetector` instance

---

## 3. Correlation Threshold and Penalty

### Correlation Threshold
**File**: `src/components/backtesting/core/SignalCorrelationDetector.jsx`

**Current Implementation**:
- **Threshold**: 0.70 (70%) - signals with correlation ≥ 0.70 are considered highly correlated
- **Penalty Factor**: 10% of average correlation strength
- **Max Penalty**: 25% cap
- **Bonus Factor**: 20% of negative correlation (complementary signals)
- **Max Bonus**: 30% cap

**Example Calculation**:
```javascript
// Signals: [MACD, EMA, TEMA]
// Correlations detected:
// - MACD ↔ EMA: 0.70
// - MACD ↔ TEMA: 0.70
// - EMA ↔ TEMA: 0.80

Average correlation = (0.70 + 0.70 + 0.80) / 3 = 0.733
Penalty = 0.733 × 0.10 = 0.0733 (7.33%)
Final penalty = min(0.0733, 0.25) = 0.0733 (7.33%)
```

**Status**: ✅ **ALIGNED** - Same calculation for both systems

---

## 4. Signal Strength Calculation Flow

### Both Systems Follow Identical Flow

1. **Individual Signal Weighting**
   - Each signal: `baseStrength × SIGNAL_WEIGHTS[signalType]`
   - Regime adjustment applied via `SignalWeightCalculator`

2. **Base Weighted Strength**
   - Sum of all individual weighted strengths

3. **Correlation Adjustment**
   - Apply penalty: `baseWeightedStrength × (1 - correlationPenalty)`
   - Apply bonus: `baseWeightedStrength × (1 + correlationBonus)`
   - Net: `baseWeightedStrength × (1 - penalty + bonus)`

4. **Regime Context Bonus**
   - Applied via `RegimeContextWeighting`

5. **Quality Adjustment**
   - Applied based on signal quality scores

6. **Synergy & Diversity Bonuses**
   - Synergy: 0.1 per synergistic pair (max 0.3)
   - Diversity: 0.05 per unique type (max 0.2)

**Status**: ✅ **ALIGNED** - Same flow via `calculateUnifiedCombinedStrength()`

---

## 5. Indicator Weight by Category

### Core Signals (1.5-2.0)
| Indicator | Weight | Used In |
|-----------|--------|---------|
| MACD | 1.8 | Both |
| RSI | 1.8 | Both |
| Ichimoku | 1.7 | Both |
| Stochastic | 1.7 | Both |
| EMA | 1.6 | Both |
| Bollinger | 1.6 | Both |
| MA200 | 1.5 | Both |
| ATR | 1.5 | Both |

### Important Signals (1.2-1.4)
| Indicator | Weight | Used In |
|-----------|--------|---------|
| Williams %R | 1.3 | Both |
| PSAR | 1.2 | Both |
| MFI | 1.2 | Both |
| ADX | 1.2 | Both |
| CCI | 1.2 | Both |
| ROC | 1.2 | Both |
| Awesome Oscillator | 1.2 | Both |
| CMO | 1.2 | Both |
| OBV | 1.2 | Both |
| CMF | 1.2 | Both |
| AD Line | 1.2 | Both |

### Confirmation Signals (1.0-1.1)
| Indicator | Weight | Used In |
|-----------|--------|---------|
| BBW | 1.1 | Both |
| TTM Squeeze | 1.1 | Both |
| Candlestick | 1.1 | Both |
| Keltner | 1.0 | Both |
| Donchian | 1.0 | Both |
| Chart Pattern | 1.0 | Both |
| Pivot | 1.0 | Both |
| Fibonacci | 1.0 | Both |
| Support/Resistance | 1.0 | Both |
| MA Ribbon | 1.0 | Both |

### Volume Signals (0.8-1.0)
| Indicator | Weight | Used In |
|-----------|--------|---------|
| Volume | 0.9 | Both |

**Status**: ✅ **ALIGNED** - All indicators use same weights

---

## 6. Correlation Matrix

### High Correlation Pairs (≥ 0.70)

**Momentum Indicators**:
- RSI ↔ Stochastic: **0.85**
- RSI ↔ Williams %R: **0.80**
- Stochastic ↔ Williams %R: **0.90**
- CCI ↔ ROC: **0.75**

**Trend Indicators**:
- MACD ↔ EMA: **0.70**
- EMA ↔ TEMA: **0.80**
- EMA ↔ DEMA: **0.85**
- MA200 ↔ EMA: **0.75**
- Ichimoku ↔ EMA: **0.65** (below threshold)

**Volume Indicators**:
- OBV ↔ CMF: **0.75**
- OBV ↔ AD Line: **0.80**
- CMF ↔ AD Line: **0.70**

**Status**: ✅ **ALIGNED** - Same correlation matrix used by both systems

---

## 7. Potential Issues Found

### ⚠️ None - Systems Are Fully Aligned

Both systems:
1. Use `SIGNAL_WEIGHTS` from `signalSettings.jsx`
2. Use `SignalCorrelationDetector` with same threshold (0.70)
3. Use same penalty factor (10%)
4. Use same bonus factor (20%)
5. Use `calculateUnifiedCombinedStrength()` for consistency

---

## 8. Verification Steps

### How to Verify Alignment

1. **Check Signal Weights**:
   ```javascript
   import { SIGNAL_WEIGHTS } from './signalSettings';
   console.log('MACD weight:', SIGNAL_WEIGHTS.macd); // Should be 1.8
   ```

2. **Check Correlation Threshold**:
   ```javascript
   // In SignalCorrelationDetector.jsx line ~2335
   const penalty = averageCorrelationStrength * 0.10; // 10% factor
   ```

3. **Check Unified Calculator**:
   ```javascript
   // Both backtest and autoscanner call:
   calculateUnifiedCombinedStrength(signals, {
     marketRegime: regime,
     regimeConfidence: confidence,
     useAdvancedFeatures: true,
     useSimpleRegimeMultiplier: false
   });
   ```

---

## 9. Recommendations

### ✅ No Changes Needed

The systems are **fully aligned**. Both use:
- Same indicator weights (`SIGNAL_WEIGHTS`)
- Same correlation detector (`SignalCorrelationDetector`)
- Same calculation flow (`calculateUnifiedCombinedStrength`)
- Same correlation threshold (0.70)
- Same penalty/bonus factors (10%/20%)

### Future Maintenance

1. **Single Source of Truth**: ✅ Already implemented
   - All weights in `signalSettings.jsx`
   - All correlation logic in `SignalCorrelationDetector.jsx`
   - All strength calculation in `unifiedStrengthCalculator.jsx`

2. **Testing**: Consider adding unit tests to verify:
   - Same weights are used in both systems
   - Same correlation calculations produce same results
   - Same final strength for identical signal combinations

---

## 10. Conclusion

**Status**: ✅ **FULLY ALIGNED**

Both the Backtest Engine and Autoscanner use:
- **Same indicator weights** from `SIGNAL_WEIGHTS`
- **Same correlation detector** with identical threshold and penalty factors
- **Same unified calculator** ensuring consistent strength calculations

**No discrepancies found. Systems are properly aligned.**

---

## Appendix: Key Files

### Weight Definitions
- `src/components/utils/signalSettings.jsx` - `SIGNAL_WEIGHTS` object

### Correlation Logic
- `src/components/backtesting/core/SignalCorrelationDetector.jsx` - Correlation detection and penalty/bonus calculation

### Strength Calculation
- `src/components/utils/unifiedStrengthCalculator.jsx` - Unified calculator used by both systems
- `src/components/backtesting/core/AdvancedSignalStrengthCalculator.jsx` - Backtest wrapper
- `src/components/utils/signalLogic.jsx` - Autoscanner wrapper

### Weight Application
- `src/components/backtesting/core/SignalWeightCalculator.jsx` - Advanced weight calculation with regime context

---

**Report Generated**: 2025-11-04
**Status**: ✅ Systems Aligned - No Action Required

