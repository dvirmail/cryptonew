# Market Volatility Calculation Explanation

## Overview

Market Volatility is calculated using two technical indicators:
1. **ADX (Average Directional Index)** - Measures trend strength
2. **BBW (Bollinger Band Width)** - Measures price volatility

The final volatility score (0-100) is a weighted combination of these two indicators.

---

## 1. Data Source

The ADX and BBW values are calculated during market regime detection and stored in:
```javascript
this.scannerService.state.marketVolatility = {
    adx: volatilityData.adx.adx || 25,  // Default: 25
    bbw: volatilityData.bbw || 0.1      // Default: 0.1
}
```

**Location**: `src/components/services/AutoScannerService.jsx` (lines 1840-1843) and `src/components/services/services/MarketRegimeService.jsx` (lines 305-308)

**Update Frequency**: Calculated during each scan cycle when market regime is detected.

---

## 2. ADX Score Calculation

**ADX (Average Directional Index)** measures trend strength:
- **Range**: Typically 0-100 (though values above 50 are rare)
- **Interpretation**:
  - ADX < 20: Weak trend (low volatility)
  - ADX 20-40: Moderate trend (medium volatility)
  - ADX > 40: Strong trend (high volatility)

**Scoring Formula** (from `PerformanceMetricsService.jsx` lines 353-357):

```javascript
let adxScore;
if (adx < 20) {
    // Low ADX: Linear scale from 0 to 50
    adxScore = (adx / 20) * 50;
} else if (adx >= 20 && adx <= 40) {
    // Medium ADX: Linear scale from 50 to 100
    adxScore = 50 + ((adx - 20) / 20) * 50;
} else {
    // High ADX (> 40): Decrease from 100 (very high ADX can indicate exhaustion)
    adxScore = 100 - ((adx - 40) / 60) * 50;
}
adxScore = Math.max(0, Math.min(100, adxScore)); // Clamp to 0-100
```

**Examples**:
- ADX = 10 → `adxScore = (10 / 20) * 50 = 25`
- ADX = 25 → `adxScore = 50 + ((25 - 20) / 20) * 50 = 50 + 12.5 = 62.5`
- ADX = 50 → `adxScore = 100 - ((50 - 40) / 60) * 50 = 100 - 8.33 = 91.67`

---

## 3. BBW Score Calculation

**BBW (Bollinger Band Width)** measures price volatility:
- **Range**: Typically 0-0.5 (as a percentage, e.g., 0.05 = 5%)
- **Interpretation**:
  - BBW < 0.02: Low volatility (narrow bands)
  - BBW 0.02-0.05: Medium volatility
  - BBW > 0.05: High volatility (wide bands)

**Scoring Formula** (from `PerformanceMetricsService.jsx` line 359):

```javascript
let bbwScore = Math.min(100, (bbw / 0.05) * 50);
bbwScore = Math.max(0, Math.min(100, bbwScore)); // Clamp to 0-100
```

**Explanation**:
- Uses `0.05` (5%) as the reference point for high volatility
- Scales linearly: `BBW = 0.05` → `bbwScore = 50`
- `BBW = 0.10` → `bbwScore = 100` (capped)
- `BBW = 0.025` → `bbwScore = 25`

**Examples**:
- BBW = 0.01 → `bbwScore = (0.01 / 0.05) * 50 = 10`
- BBW = 0.05 → `bbwScore = (0.05 / 0.05) * 50 = 50`
- BBW = 0.10 → `bbwScore = Math.min(100, (0.10 / 0.05) * 50) = 100` (capped)

---

## 4. Combined Volatility Score

The final volatility score is a **weighted average** of ADX and BBW scores:

```javascript
volatilityComponent = (adxScore * 0.4) + (bbwScore * 0.6);
```

**Weights**:
- **ADX**: 40% (0.4)
- **BBW**: 60% (0.6)

**BBW has more influence** because it directly measures price volatility, while ADX measures trend strength (which correlates with volatility but is not a direct measure).

---

## 5. Example Calculation

Given the values from your UI:
- **ADX**: 25.0
- **BBW**: 5.789 (this appears to be 0.05789, as BBW is typically a decimal)

### Step 1: Calculate ADX Score
```javascript
adx = 25.0
// ADX is between 20 and 40, so:
adxScore = 50 + ((25.0 - 20) / 20) * 50
         = 50 + (5 / 20) * 50
         = 50 + 12.5
         = 62.5
```

### Step 2: Calculate BBW Score
```javascript
bbw = 0.05789  // Assuming BBW is stored as 0.05789 (not 5.789)
bbwScore = Math.min(100, (0.05789 / 0.05) * 50)
         = Math.min(100, 1.1578 * 50)
         = Math.min(100, 57.89)
         = 57.89
```

**Note**: If BBW is stored as `5.789` (percentage format), the calculation would be:
```javascript
bbw = 5.789 / 100 = 0.05789  // Convert percentage to decimal
bbwScore = (0.05789 / 0.05) * 50 = 57.89
```

### Step 3: Calculate Combined Score
```javascript
volatilityComponent = (62.5 * 0.4) + (57.89 * 0.6)
                    = 25.0 + 34.734
                    = 59.734
                    ≈ 60 (rounded)
```

**However**, your UI shows **85**, which suggests either:
1. The BBW value is different than expected
2. The calculation uses a different formula
3. The values shown in the UI are raw values, not the calculated score

---

## 6. Display in UI

The volatility score is displayed in the Performance Momentum widget with:
- **Score**: The final `volatilityComponent` (0-100), rounded
- **Details**: `"ADX: 25.0, BBW: 5.789"` (raw values)
- **Weight**: 10% contribution to overall Performance Momentum score

**Location**: `src/components/services/services/PerformanceMetricsService.jsx` (line 494)

---

## 7. Code Locations

### Calculation
- **File**: `src/components/services/services/PerformanceMetricsService.jsx`
- **Lines**: 349-363
- **Function**: `calculatePerformanceMomentum()`

### Data Source
- **File**: `src/components/services/AutoScannerService.jsx`
- **Lines**: 1840-1843
- **File**: `src/components/services/services/MarketRegimeService.jsx`
- **Lines**: 305-308

### Indicator Calculation
- **BBW**: `src/components/utils/indicator-calculations/volatilityIndicators.jsx` (lines 77-112)
- **ADX**: Calculated in `MarketRegimeDetector.jsx`

---

## 8. Potential Issues

### BBW Value Format
The UI shows `BBW: 5.789`, which could be:
1. **Percentage format** (5.789%) = 0.05789 decimal
2. **Decimal format** (0.05789) displayed as 5.789

**Current calculation assumes decimal format** (0.05789). If BBW is stored as a percentage (5.789), the calculation needs adjustment:

```javascript
// If BBW is percentage (5.789), convert to decimal first
const bbwDecimal = bbw / 100;  // 5.789 / 100 = 0.05789
let bbwScore = Math.min(100, (bbwDecimal / 0.05) * 50);
```

### ADX Score Formula
The current formula decreases the score for ADX > 40:
```javascript
else adxScore = 100 - ((adx - 40) / 60) * 50;
```

This means:
- ADX = 40 → `adxScore = 100`
- ADX = 50 → `adxScore = 100 - 8.33 = 91.67`
- ADX = 100 → `adxScore = 100 - 50 = 50`

**This may not be the intended behavior** if very high ADX values should indicate very high volatility.

---

## 9. Recommendations

1. **Verify BBW format**: Check if BBW is stored as decimal (0.05789) or percentage (5.789)
2. **Review ADX formula**: Consider if ADX > 40 should continue increasing the score
3. **Add logging**: Log intermediate values (adxScore, bbwScore) to debug discrepancies
4. **Document thresholds**: Clearly document what ADX/BBW values indicate low/medium/high volatility

---

## 10. Quick Reference

| ADX Value | ADX Score | Interpretation |
|-----------|-----------|----------------|
| 0-20      | 0-50      | Low volatility (weak trend) |
| 20-40     | 50-100    | Medium to high volatility (moderate to strong trend) |
| >40       | 100→50    | Very high volatility (very strong trend, may indicate exhaustion) |

| BBW Value | BBW Score | Interpretation |
|-----------|-----------|----------------|
| 0-0.02    | 0-20      | Low volatility (narrow bands) |
| 0.02-0.05 | 20-50     | Medium volatility |
| >0.05     | 50-100    | High volatility (wide bands) |

**Final Score**: `(ADX Score × 0.4) + (BBW Score × 0.6)`

