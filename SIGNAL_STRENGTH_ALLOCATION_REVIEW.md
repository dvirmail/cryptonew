# Signal Strength Allocation Review

## Executive Summary

This document reviews the strength allocation across all 34+ signal types in the application. Strength values range from 0-100, where higher values indicate stronger, more reliable signals.

**Key Findings:**
- **Total Signal Types**: 34+
- **Strength Range Used**: 0-100
- **Most Common Strength**: 85 (31 occurrences), 75 (23 occurrences), 70 (22 occurrences), 80 (20 occurrences)
- **Issues Found**: Several inconsistencies in strength allocation across similar signal types

---

## Strength Distribution Analysis

### High Strength Signals (80-100)
**Purpose**: Critical reversal/continuation signals, major breakouts, strong confirmations

| Strength | Signal Type | Signal Value | Notes |
|----------|-------------|--------------|-------|
| 90-95 | Divergences | Regular/Hidden Bullish/Bearish | Regime-adjusted, very reliable |
| 90 | Support/Resistance | Breakout/Breakdown | Major price action |
| 90 | Pivot Points | Breakout/Breakdown | Major price action |
| 88 | Divergences | Hidden Divergences | Slightly less reliable than regular |
| 85 | Divergences | Failure Swings | Strong reversal signals |
| 85 | Support/Resistance | Touch (Support/Resistance) | Price at key level |
| 85 | Fibonacci | At Golden Ratio (61.8%) | Critical retracement level |
| 85 | Pivot Points | Touch, Bounce, Rejection | Price interaction with pivot levels |
| 80 | Trend | MACD/EMA Crosses | Major trend changes |
| 80 | Support/Resistance | Bounce/Rejection | Price reaction at levels |
| 80 | Volatility | Band Walk Up/Down | Sustained trends |
| 80 | Volatility | Upper/Lower Breakout | Major volatility events |
| 80 | Pivot Points | Bullish/Bearish Cross | Cross events |
| 95 | Volatility | TTM Squeeze Release | Regime-adjusted, very strong |

### Medium-High Strength (60-79)
**Purpose**: Strong confirmations, important state changes

| Strength | Signal Type | Signal Value | Notes |
|----------|-------------|--------------|-------|
| 75 | Volatility | ATR Expansion | Event-based |
| 75 | Support/Resistance | Breakout/Breakdown (helper) | Internal helper |
| 70 | Support/Resistance | At Support/Resistance | Within 1% of level |
| 70 | Volatility | Bullish/Bearish Middle Cross | Channel crossovers |
| 65 | Volatility | Low Volatility | State-based |
| 60 | Volatility | BBW In Squeeze | Squeeze state |
| 60 | Pivot Points | At Pivot Point | Close to pivot |

### Medium Strength (40-59)
**Purpose**: Moderate confirmations, position-based signals

| Strength | Signal Type | Signal Value | Notes |
|----------|-------------|--------------|-------|
| 55 | Fibonacci | Healthy Retracement Zone | Common retracement levels |
| 50 | Trend | ADX Strong Trend | Dynamic (50-80 based on ADX value) |
| 45-70 | Trend | EMA/MACD States | Dynamic based on distance |
| 45 | Support/Resistance | High Level Density | Multiple levels detected |
| 45 | Volatility | Narrow Channel/Range | Tight volatility |
| 40 | Support/Resistance | Upper/Lower Range | Position in range |
| 40 | Fibonacci | Shallow/Deep Retracement | Near extremes |
| 40 | Pivot Points | Upper/Lower Pivot Range | Position in range |
| 40 | Pivot Points | High Pivot Density | Multiple pivots |

### Low-Medium Strength (25-39)
**Purpose**: Weak confirmations, informational signals

| Strength | Signal Type | Signal Value | Notes |
|----------|-------------|--------------|-------|
| 35 | Support/Resistance | Moderate Level Density | Some structure |
| 35 | Candlestick | Bullish/Bearish Momentum | Two consecutive candles |
| 35 | Volatility | Wide Channel/Range | High volatility state |
| 30 | Support/Resistance | Middle Range | Neutral position |
| 30 | Pivot Points | Middle Pivot Range | Neutral position |
| 30 | Trend | ADX Moderate Trend | ADX 20-25 |
| 30 | Volatility | Neutral Momentum | No clear direction |
| 25 | Divergences | Bearish/Bullish (SR helper) | Base contribution only |
| 25 | Support/Resistance | Low Level Density | Minimal structure |
| 25 | Pivot Points | Low Pivot Density | Minimal pivots |
| 25 | Trend | ADX Weak Trend | ADX < 20 |
| 25 | Volatility | No Squeeze | Negative signal |

### Low Strength (0-24)
**Purpose**: Fallback signals, no data conditions

| Strength | Signal Type | Signal Value | Notes |
|----------|-------------|--------------|-------|
| 20 | Pivot Points | No Pivot Data | Missing data fallback |
| 0 | Various | Neutral/No Signal | Some indicators use 0 for neutral |

---

## Issues & Inconsistencies Found

### 1. **Divergence Strength Inconsistency**
- **Regular Divergences**: 90 (momentum/trend), 90 (volatility), 85 (volume)
- **Hidden Divergences**: 88 (momentum/trend)
- **Issue**: Volume divergences are weaker (85) than momentum/volatility divergences (90), but should be equally important
- **Recommendation**: Standardize all divergences to 90 (regular) and 88 (hidden)

### 2. **Support/Resistance Proximity Signals**
- **"At Support/Resistance"** (within 1%): 70
- **"Touch"** (exact touch): 85
- **Issue**: Only 15-point difference between "very close" and "touch" seems insufficient
- **Recommendation**: Increase "Touch" to 90, or decrease "At" to 65

### 3. **Breakout/Breakdown Strength**
- **Support/Resistance**: 90
- **Pivot Points**: 90
- **Volatility (Keltner/Donchian)**: 80-85
- **Issue**: All breakouts should have similar strength regardless of level type
- **Recommendation**: Standardize all breakouts to 90

### 4. **Pivot Point Signals**
- **At Pivot Point**: 60
- **Touch**: 85
- **Breakout/Breakdown**: 90
- **Bounce/Rejection**: 85
- **Issue**: "At Pivot Point" (60) is significantly weaker than similar proximity signals in Support/Resistance (70)
- **Recommendation**: Increase "At Pivot Point" to 70 for consistency

### 5. **Fibonacci Signals**
- **At Golden Ratio (61.8%)**: 85
- **Healthy Retracement Zone**: 55
- **Shallow/Deep Retracement**: 40
- **Issue**: 40 for shallow/deep retracement seems too low - these are still valid Fibonacci levels
- **Recommendation**: Increase "Shallow/Deep Retracement" to 50

### 6. **Volume Signals**
- **Very High Volume**: 60-90 (dynamic)
- **High Volume**: 50-70 (dynamic)
- **Volume Divergence**: 85
- **Issue**: Volume divergences (85) are weaker than other divergences (90), but volume confirmation is crucial
- **Recommendation**: Increase volume divergences to 90

### 7. **ADX Strength Calculation**
- **Strong Trend**: 50-80 (dynamic based on ADX value)
- **Moderate Trend**: 40
- **Weak Trend**: 25
- **Issue**: Dynamic calculation is good, but base values seem low. Strong trend should start higher
- **Recommendation**: Strong trend should start at 60 (not 50) when ADX = 25

### 8. **TTM Squeeze Release**
- **Strength**: 95 (after regime adjustment)
- **Issue**: Extremely high - may be appropriate for such a strong signal, but should be verified
- **Recommendation**: Verify backtest performance - if too many false positives, reduce to 90

### 9. **Candlestick Patterns**
- **Doji**: 60
- **Hammer/Shooting Star**: 75
- **Bullish/Bearish Engulfing**: 85
- **Morning/Evening Star**: 90
- **Issue**: Generally well-balanced, but Hammer (75) might be too strong compared to Doji (60)
- **Recommendation**: Consider reducing Hammer/Shooting Star to 70

### 10. **Level Density Signals**
- **High**: 45
- **Moderate**: 35
- **Low**: 25
- **Issue**: These represent structural information, but are quite weak. May not contribute meaningfully to combined strength
- **Recommendation**: Consider if these signals are necessary, or increase strength to 50/40/30

---

## Recommendations by Priority

### Priority 1: Critical Inconsistencies
1. **Standardize Divergence Strengths**: All regular divergences → 90, hidden → 88
2. **Standardize Breakout Strengths**: All breakouts → 90 regardless of level type
3. **Increase Volume Divergence**: 85 → 90
4. **Fix Pivot "At" Signal**: 60 → 70 for consistency with Support/Resistance

### Priority 2: Important Adjustments
5. **Increase Support/Resistance Touch**: 85 → 90 (more distinction from "At")
6. **Increase Fibonacci Shallow/Deep**: 40 → 50
7. **Increase ADX Strong Trend Base**: 50 → 60
8. **Review TTM Squeeze**: Verify 95 is appropriate (may reduce to 90)

### Priority 3: Fine-Tuning
9. **Review Level Density Signals**: Consider increasing or removing (50/40/30 or remove)
10. **Review Hammer/Shooting Star**: Consider reducing to 70
11. **Review "At" vs "Touch" Signals**: Ensure proper distinction (15-point difference is minimum)

---

## Signal Strength Hierarchy (Recommended)

```
100: Reserved for future use
95:  TTM Squeeze Release (verify performance)
90:  Regular Divergences, Breakouts/Breakdowns, Morning/Evening Star
88:  Hidden Divergences
85:  Failure Swings, Touch Signals, Bounce/Rejection, Bullish/Bearish Engulfing
80:  Cross Signals (MACD/EMA), Band Walks, Major Events
75:  Hammer/Shooting Star (consider reducing to 70), ATR Expansion
70:  At Support/Resistance, At Pivot Point
65:  Low Volatility, BBW In Squeeze
60:  Very High Volume (max), Strong Trend (base)
55:  Healthy Retracement Zone
50:  High Level Density, Moderate High Volume
45:  Moderate Trend, Moderate Volume
40:  Upper/Lower Range, Moderate Level Density, Shallow/Deep Retracement
35:  Middle Range, Moderate Momentum, Wide Channel
30:  Middle Pivot Range, Positive/Negative Momentum
25:  Low Level Density, Weak Trend, No Squeeze
20:  No Data Fallbacks
0:   Neutral/No Signal
```

---

## Notes

1. **Regime Adjustments**: Many signals use `applyRegimeAdjustment()` which can modify base strength by ±5 points based on market regime alignment
2. **Dynamic Strengths**: Some signals (EMA, MACD, Volume, ADX, ROC) calculate strength dynamically based on distance/ratio values
3. **Priority Field**: Signals also have a `priority` field (1-10) which may affect combination logic separately from strength
4. **Event vs State**: Signals are marked as `isEvent: true/false` which may affect how they're combined

---

## Testing Recommendations

After implementing these changes:
1. Run backtests on historical data and compare win rates
2. Monitor combined strength distributions - ensure most strategies fall in reasonable ranges (200-600)
3. Check signal frequency - too high/low strengths may cause signals to be ignored or dominate
4. Verify regime adjustments are working correctly with new base values

---

*Generated: $(date)*
*Reviewed: All signal files in `src/components/utils/signals/`*

