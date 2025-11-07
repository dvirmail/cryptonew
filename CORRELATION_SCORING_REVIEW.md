# Correlation Scoring Review

## Overview
This document reviews all correlation scoring in the signal correlation system to ensure logical consistency and completeness.

---

## Current System Parameters

### Thresholds
- **High Correlation Threshold**: 0.8 (80%) - triggers penalties
- **Complementary Threshold**: -0.5 (50% negative) - triggers bonuses
- **Penalty Factor**: 15% of average correlation
- **Bonus Factor**: 20% of absolute correlation
- **Max Penalty**: 25%
- **Max Bonus**: 30%

### Calculation Logic
```javascript
// Penalty: averageCorrelation × 0.15 (capped at 0.25)
// Bonus: abs(correlation) × 0.2 for each complementary pair (capped at 0.30)
```

---

## Signal Type Categories

### 1. Momentum Oscillators
- RSI (oversold/overbought)
- Stochastic (oversold/overbought)
- Williams %R
- CCI (oversold/overbought)
- ROC (positive/negative)
- Awesome Oscillator (positive/negative)
- CMO (positive/negative)
- MFI (oversold/overbought)

### 2. Trend Indicators
- MACD (cross, divergence, histogram)
- EMA (cross, direction)
- SMA (cross, direction)
- MA200
- DEMA, TEMA, HMA, WMA
- PSAR
- ADX
- Ichimoku
- MA Ribbon

### 3. Volume Indicators
- Volume (spike, breakout, profile)
- OBV (increasing, decreasing, divergence)
- CMF (positive, negative, divergence)
- AD Line (increasing, decreasing, divergence)
- MFI (oversold/overbought)

### 4. Volatility Indicators
- Bollinger Bands (squeeze, breakout)
- ATR (expansion, contraction)
- BBW (narrow, expansion)
- Keltner Channels (squeeze, breakout)
- Donchian Channels (narrow, breakout)
- TTM Squeeze (squeeze, breakout)

### 5. Support/Resistance & Price Action
- Support/Resistance (touch, bounce, breakout, breakdown)
- Fibonacci (retracement levels, golden ratio)
- Pivot Points (traditional, fibonacci, woodie, camarilla, weekly)

### 6. Pattern Signals
- Candlestick Patterns (doji, hammer, shooting star, engulfing)
- Chart Patterns (head & shoulders, double top/bottom, triangle)

---

## Correlation Analysis by Category

### ✅ Momentum Oscillators - CORRECT

**High Correlations (0.80-0.90):**
- RSI ↔ Stochastic: **0.85** ✅ (both measure momentum exhaustion)
- RSI ↔ Williams %R: **0.80** ✅ (similar calculation methods)
- Stochastic ↔ Williams %R: **0.90** ✅ (very similar indicators)
- CCI ↔ RSI: **0.75** ✅ (moderate, different calculation but similar purpose)

**Complementary (Negative):**
- RSI Oversold ↔ RSI Overbought: **-0.90** ✅ (opposite states)
- Stochastic Oversold ↔ Stochastic Overbought: **-0.90** ✅ (opposite states)

**Assessment**: ✅ **CORRECT** - Values are logically consistent. High correlation between similar momentum oscillators, strong negative correlation between opposite states.

---

### ✅ Trend Indicators - CORRECT

**High Correlations (0.70-0.85):**
- MACD ↔ EMA: **0.70** ✅ (both trend-following)
- EMA ↔ MA200: **0.75** ✅ (both moving averages)
- EMA ↔ DEMA: **0.85** ✅ (DEMA is EMA-based)
- EMA ↔ TEMA: **0.80** ✅ (TEMA is EMA-based)
- MACD Cross ↔ EMA Cross: **0.75** ✅ (both cross signals)

**Moderate Correlations (0.50-0.69):**
- MACD ↔ PSAR: **0.50** ✅ (different trend methods)
- ADX ↔ Ichimoku: **0.60** ✅ (both trend strength)
- PSAR ↔ MA200: **0.65** ✅ (both trend-following)

**Assessment**: ✅ **CORRECT** - Values are logically consistent. Similar trend indicators have high correlation, different methods have moderate correlation.

---

### ✅ Volume Indicators - CORRECT

**High Correlations (0.70-0.85):**
- OBV ↔ CMF: **0.75** ✅ (both cumulative volume-based)
- OBV ↔ AD Line: **0.80** ✅ (both advance/decline based)
- CMF ↔ AD Line: **0.70** ✅ (both volume flow)

**Complementary (Negative):**
- OBV Increasing ↔ OBV Decreasing: **-0.85** ✅ (opposite states)
- CMF Positive ↔ CMF Negative: **-0.80** ✅ (opposite states)

**Assessment**: ✅ **CORRECT** - Values are logically consistent. Volume indicators that measure similar things have high correlation.

---

### ✅ Volatility Indicators - CORRECT

**High Correlations (0.70-0.85):**
- Bollinger ↔ ATR: **0.80** ✅ (both measure volatility)
- Bollinger ↔ BBW: **0.85** ✅ (BBW is derived from Bollinger)
- Bollinger ↔ TTM Squeeze: **0.80** ✅ (both detect compression)
- ATR ↔ BBW: **0.75** ✅ (both volatility measures)

**Complementary (Negative):**
- ATR Expansion ↔ ATR Contraction: **-0.80** ✅ (opposite states)
- BBW Narrow ↔ BBW Expansion: **-0.85** ✅ (opposite states)
- TTM Squeeze ↔ TTM Breakout: **-0.85** ✅ (opposite states)

**Assessment**: ✅ **CORRECT** - Values are logically consistent. Volatility indicators that measure similar aspects have high correlation.

---

### ⚠️ Cross-Category Correlations - NEEDS REVIEW

**Momentum ↔ Trend (0.20):**
- RSI ↔ MACD: **0.20** ✅ (different categories, low correlation)
- Stochastic ↔ EMA: **0.20** ✅ (different categories, low correlation)
- RSI ↔ MA200: **0.20** ✅ (different categories, low correlation)

**Momentum ↔ Volume (0.20-0.30):**
- RSI ↔ Volume: **0.20** ✅ (different categories, low correlation)
- MFI ↔ Volume: **0.30** ✅ (MFI is volume-weighted momentum, slightly higher)

**Volume ↔ Trend (0.20):**
- OBV ↔ EMA: **0.20** ✅ (different categories, low correlation)
- Volume ↔ MACD: **0.20** ✅ (different categories, low correlation)

**Volatility ↔ Everything (0.20):**
- Bollinger ↔ RSI: **0.20** ✅ (different categories, low correlation)
- ATR ↔ MACD: **0.20** ✅ (different categories, low correlation)

**Assessment**: ✅ **CORRECT** - Cross-category correlations are appropriately low (0.20), indicating independent signals.

---

### ❌ MISSING: Support/Resistance Correlations

**Issue**: Support/Resistance signals have **NO correlations defined** in the matrix.

**Signal Types**:
- `supportresistance` (type)
- Values: "Support Touch", "Resistance Touch", "At Support", "At Resistance", "Support Breakout", "Resistance Breakdown", etc.

**Expected Correlations**:

1. **Support/Resistance ↔ Fibonacci**:
   - Should have **HIGH correlation (0.70-0.80)**
   - Both identify price levels
   - Fibonacci levels often coincide with S/R levels
   - **Missing**: `supportresistance` ↔ `fibonacci`

2. **Support/Resistance ↔ Pivot Points**:
   - Should have **HIGH correlation (0.75-0.85)**
   - Pivot points are calculated S/R levels
   - Many pivot signals overlap with S/R signals
   - **Missing**: `supportresistance` ↔ `pivot`

3. **Support/Resistance ↔ Trend Indicators**:
   - Should have **MODERATE correlation (0.40-0.60)**
   - Trend lines often act as S/R
   - EMA/MA200 can act as dynamic S/R
   - **Missing**: `supportresistance` ↔ `ema`, `macd`, `ma200`

4. **Support/Resistance ↔ Momentum**:
   - Should have **LOW correlation (0.20-0.30)**
   - Different categories
   - **Missing**: `supportresistance` ↔ `rsi`, `stochastic`

---

### ❌ MISSING: Fibonacci Correlations

**Issue**: Fibonacci signals have **NO correlations defined** in the matrix.

**Signal Types**:
- `fibonacci` (type)
- Values: "At 23.6% Level", "At 38.2% Level", "At 50% Level", "At 61.8% Level", "At 78.6% Level", etc.

**Expected Correlations**:

1. **Fibonacci ↔ Support/Resistance**:
   - Should have **HIGH correlation (0.70-0.80)**
   - Both identify price levels
   - **Missing**: `fibonacci` ↔ `supportresistance`

2. **Fibonacci ↔ Pivot Points**:
   - Should have **MODERATE-HIGH correlation (0.65-0.75)**
   - Fibonacci pivot points are calculated
   - **Missing**: `fibonacci` ↔ `pivot`

3. **Fibonacci ↔ Trend Indicators**:
   - Should have **MODERATE correlation (0.40-0.60)**
   - Fibonacci retracements relate to trend
   - **Missing**: `fibonacci` ↔ `ema`, `macd`

4. **Fibonacci ↔ Momentum**:
   - Should have **LOW correlation (0.20-0.30)**
   - Different categories
   - **Missing**: `fibonacci` ↔ `rsi`, `stochastic`

---

### ❌ MISSING: Pivot Point Correlations

**Issue**: Pivot point signals have **NO correlations defined** in the matrix.

**Signal Types**:
- `pivot` (type)
- Values: "At Pivot Point", "Pivot Touch", "Pivot Breakout", "Pivot Breakdown", "R1 Breakout", "S1 Breakdown", etc.

**Expected Correlations**:

1. **Pivot ↔ Support/Resistance**:
   - Should have **HIGH correlation (0.75-0.85)**
   - Pivot points ARE calculated S/R levels
   - **Missing**: `pivot` ↔ `supportresistance`

2. **Pivot ↔ Fibonacci**:
   - Should have **MODERATE-HIGH correlation (0.65-0.75)**
   - Fibonacci pivot points exist
   - **Missing**: `pivot` ↔ `fibonacci`

3. **Pivot ↔ Trend Indicators**:
   - Should have **MODERATE correlation (0.40-0.60)**
   - Pivot points relate to trend
   - **Missing**: `pivot` ↔ `ema`, `macd`, `ma200`

4. **Pivot ↔ Momentum**:
   - Should have **LOW correlation (0.20-0.30)**
   - Different categories
   - **Missing**: `pivot` ↔ `rsi`, `stochastic`

---

### ⚠️ Pattern Signals - INCOMPLETE

**Current State**:
- Candlestick patterns have minimal correlations (0.25-0.50)
- Chart patterns have minimal correlations (0.20-0.50)

**Issues**:

1. **Candlestick ↔ Momentum**:
   - Current: **NOT DEFINED**
   - Should have **MODERATE correlation (0.40-0.60)**
   - Reversal patterns (hammer, shooting star) correlate with momentum extremes
   - **Missing**: `hammer` ↔ `rsi_oversold`, `shooting_star` ↔ `rsi_overbought`

2. **Candlestick ↔ Support/Resistance**:
   - Current: **NOT DEFINED**
   - Should have **MODERATE correlation (0.50-0.70)**
   - Patterns often form at S/R levels
   - **Missing**: `hammer` ↔ `supportresistance`, `shooting_star` ↔ `supportresistance`

3. **Chart Patterns ↔ Trend**:
   - Current: **NOT DEFINED**
   - Should have **MODERATE correlation (0.40-0.60)**
   - Patterns relate to trend continuation/reversal
   - **Missing**: `head_shoulders` ↔ `macd`, `double_top` ↔ `ema`

---

## Issues Found

### 1. ❌ Missing Correlations for Support/Resistance
- **Severity**: HIGH
- **Impact**: S/R signals are not penalized when combined with Fibonacci/Pivot, leading to double-counting
- **Fix**: Add correlations for `supportresistance` type

### 2. ❌ Missing Correlations for Fibonacci
- **Severity**: HIGH
- **Impact**: Fibonacci signals are not penalized when combined with S/R/Pivot, leading to double-counting
- **Fix**: Add correlations for `fibonacci` type

### 3. ❌ Missing Correlations for Pivot Points
- **Severity**: HIGH
- **Impact**: Pivot signals are not penalized when combined with S/R/Fibonacci, leading to double-counting
- **Fix**: Add correlations for `pivot` type

### 4. ⚠️ Incomplete Pattern Correlations
- **Severity**: MEDIUM
- **Impact**: Pattern signals may not be properly correlated with other signals
- **Fix**: Add correlations for candlestick and chart patterns

### 5. ✅ Existing Correlations Are Logically Sound
- Momentum oscillators: ✅ Correct
- Trend indicators: ✅ Correct
- Volume indicators: ✅ Correct
- Volatility indicators: ✅ Correct
- Cross-category correlations: ✅ Correct

---

## Recommended Fixes

### Priority 1: Add Support/Resistance Correlations

```javascript
'supportresistance': {
  'fibonacci': 0.75,  // High: both identify price levels
  'pivot': 0.80,     // High: pivot points are S/R levels
  'ema': 0.50,       // Moderate: EMA can act as dynamic S/R
  'ma200': 0.55,     // Moderate: MA200 often acts as S/R
  'macd': 0.45,      // Moderate: MACD relates to trend/S/R
  'trend_line_break': 0.70,  // High: trend lines are S/R
  'rsi': 0.25,       // Low: different categories
  'stochastic': 0.25,  // Low: different categories
  'volume': 0.30,    // Low: volume confirms S/R but different
  'bollinger': 0.35  // Low: bands can act as S/R but different
}
```

### Priority 2: Add Fibonacci Correlations

```javascript
'fibonacci': {
  'supportresistance': 0.75,  // High: both identify price levels
  'pivot': 0.70,              // Moderate-High: Fibonacci pivots exist
  'ema': 0.50,                // Moderate: retracements relate to trend
  'ma200': 0.55,              // Moderate: retracements relate to trend
  'macd': 0.45,               // Moderate: relates to trend
  'trend_line_break': 0.65,   // Moderate-High: retracements relate to trend
  'rsi': 0.25,                // Low: different categories
  'stochastic': 0.25,         // Low: different categories
  'volume': 0.30,             // Low: different categories
  'bollinger': 0.30           // Low: different categories
}
```

### Priority 3: Add Pivot Point Correlations

```javascript
'pivot': {
  'supportresistance': 0.80,  // High: pivot points ARE S/R levels
  'fibonacci': 0.70,           // Moderate-High: Fibonacci pivots exist
  'ema': 0.50,                 // Moderate: relates to trend
  'ma200': 0.55,               // Moderate: relates to trend
  'macd': 0.45,                // Moderate: relates to trend
  'trend_line_break': 0.65,   // Moderate-High: relates to trend
  'rsi': 0.25,                 // Low: different categories
  'stochastic': 0.25,          // Low: different categories
  'volume': 0.30,              // Low: different categories
  'bollinger': 0.30            // Low: different categories
}
```

### Priority 4: Add Pattern Correlations

```javascript
// Candlestick patterns
'hammer': {
  'rsi_oversold': 0.50,        // Moderate: reversal at oversold
  'stochastic_oversold': 0.45, // Moderate: reversal at oversold
  'supportresistance': 0.60,   // Moderate-High: patterns form at S/R
  'fibonacci': 0.55,           // Moderate: patterns form at Fib levels
  'pivot': 0.50,               // Moderate: patterns form at pivots
  'shooting_star': -0.40,      // Negative: opposite pattern
  'doji': 0.30                 // Low: both are reversal patterns
},
'shooting_star': {
  'rsi_overbought': 0.50,      // Moderate: reversal at overbought
  'stochastic_overbought': 0.45, // Moderate: reversal at overbought
  'supportresistance': 0.60,    // Moderate-High: patterns form at S/R
  'fibonacci': 0.55,           // Moderate: patterns form at Fib levels
  'pivot': 0.50,                // Moderate: patterns form at pivots
  'hammer': -0.40,              // Negative: opposite pattern
  'doji': 0.30                  // Low: both are reversal patterns
},

// Chart patterns
'head_shoulders': {
  'macd': 0.50,                // Moderate: relates to trend reversal
  'ema': 0.45,                 // Moderate: relates to trend
  'supportresistance': 0.60,    // Moderate-High: patterns form at S/R
  'double_top': 0.40,          // Low: similar patterns
  'double_bottom': -0.30       // Negative: opposite pattern
},
'double_top': {
  'macd': 0.50,                // Moderate: relates to trend reversal
  'ema': 0.45,                 // Moderate: relates to trend
  'supportresistance': 0.60,    // Moderate-High: patterns form at S/R
  'head_shoulders': 0.40,      // Low: similar patterns
  'double_bottom': -0.50       // Negative: opposite pattern
}
```

---

## Issues Found - Duplicate Object Keys

### ⚠️ CRITICAL: Duplicate Object Keys Overwriting Each Other

**Problem**: Several signal types have duplicate entries in the correlation matrix object. In JavaScript, duplicate keys result in the last definition overwriting previous ones.

**Affected Signals**:
- `volume_spike` (appears at lines 698 and 754)
- `volume_breakout` (appears at lines 716 and 774)
- `volume_profile` (appears at lines 734 and 794)
- `volatility_breakout` (appears at lines 816 and 836)

**Impact**: 
- The first definition (momentum correlations) is **completely lost**
- Only the second definition (trend correlations) remains
- This means volume signals have NO momentum correlations defined

**Fix Required**: Merge duplicate entries into single definitions that include all correlations.

**Example Fix**:
```javascript
// BEFORE (WRONG - second overwrites first):
'volume_spike': {
  'rsi_oversold': 0.20,  // This is LOST
  ...
},
'volume_spike': {  // This overwrites the above
  'ema': 0.20,
  ...
}

// AFTER (CORRECT):
'volume_spike': {
  'rsi_oversold': 0.20,  // Momentum correlations
  'ema': 0.20,            // Trend correlations
  ...
}
```

---

## Summary

### ✅ What's Working
- Momentum oscillator correlations are correct
- Trend indicator correlations are correct
- Volatility indicator correlations are correct
- Cross-category correlations are appropriately low
- **Support/Resistance, Fibonacci, and Pivot correlations have been added** ✅

### ❌ What Needs Fixing
1. **Duplicate object keys** ✅ **FIXED** - Merged duplicate volume and volatility signal definitions
2. **Incomplete pattern correlations** (MEDIUM priority) - Some pattern correlations added, but may need more

### ✅ What's Been Fixed
1. **Missing Support/Resistance correlations** ✅ - Added with high correlations to Fibonacci/Pivot
2. **Missing Fibonacci correlations** ✅ - Added with high correlations to S/R/Pivot
3. **Missing Pivot point correlations** ✅ - Added with high correlations to S/R/Fibonacci
4. **Pattern correlations enhanced** ✅ - Added correlations for candlestick and chart patterns

### 📊 Impact of Missing Correlations

**Current Behavior**:
- Combining Support/Resistance + Fibonacci + Pivot = **NO PENALTY**
- These signals are essentially measuring the same thing (price levels)
- This leads to **double-counting** and artificially inflated combined strength

**Expected Behavior**:
- Combining Support/Resistance + Fibonacci + Pivot = **12-15% PENALTY**
- This correctly reflects that these signals are highly correlated

---

## Next Steps

1. ✅ Review correlation matrix (this document)
2. ⏳ Add missing correlations for Support/Resistance, Fibonacci, and Pivot
3. ⏳ Add incomplete pattern correlations
4. ⏳ Test correlation detection with sample signal combinations
5. ⏳ Verify penalty calculations are working correctly

