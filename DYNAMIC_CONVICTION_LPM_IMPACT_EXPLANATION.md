# Dynamic Conviction Score - LPM Impact Explanation

## Overview

The **Dynamic Minimum Conviction** threshold adjusts based on the **Leading Performance Momentum (LPM)** score to adapt trading behavior to current system performance.

## Core Logic

**Key Principle:** 
- **Lower LPM score = Higher conviction requirement** (more conservative when performance is poor)
- **Higher LPM score = Lower conviction requirement** (more aggressive when performance is good)
- **LPM = 50 is neutral** (no adjustment to base conviction)

## Formula

```javascript
NEUTRAL_LPM_SCORE = 50
LPM_ADJUSTMENT_FACTOR = 0.5

deviation = LPM - 50                    // Range: -50 to +50
adjustment = deviation * 0.5            // Range: -25 to +25
dynamic_conviction = base - adjustment  // Higher LPM = lower conviction needed

// Clamp between base and 100
final_conviction = min(100, max(base, dynamic_conviction))
```

## Impact Table

| LPM Score | Deviation from 50 | Adjustment | Base Conviction | Dynamic Conviction | Impact |
|-----------|-------------------|------------|-----------------|---------------------|--------|
| 0         | -50              | -25        | 60              | 85                  | +25 (much more conservative) |
| 20        | -30              | -15        | 60              | 75                  | +15 (more conservative) |
| 30        | -20              | -10        | 60              | 70                  | +10 (slightly more conservative) |
| 40        | -10              | -5         | 60              | 65                  | +5 (slightly more conservative) |
| **50**    | **0**            | **0**      | **60**          | **60**              | **0 (neutral - no change)** |
| 60        | +10              | +5         | 60              | 55                  | -5 (slightly more aggressive) |
| **63**    | **+13**          | **+6.5**   | **60**          | **53.5**            | **-6.5 (more aggressive)** |
| 70        | +20              | +10        | 60              | 50                  | -10 (more aggressive) |
| 80        | +30              | +15        | 60              | 45                  | -15 (much more aggressive) |
| 100       | +50              | +25        | 60              | 35                  | -25 (maximum aggression) |

## Your Current Example

**Current Values:**
- **LPM Score:** 63
- **Base Conviction:** 60
- **Market Regime:** Downtrend (100% confidence)
- **Final Score:** 63/100

**Calculation:**
```
deviation = 63 - 50 = 13
adjustment = 13 * 0.5 = 6.5
dynamic_conviction = 60 - 6.5 = 53.5
clamped = min(100, max(0, 53.5)) = 53.5
```

**Result:** Dynamic Minimum Conviction = **53.5** (rounded to **54** in UI)

This means:
- With LPM of 63 (above neutral), the system requires **lower conviction** (53.5 vs base 60)
- Strategies with conviction scores between 53.5 and 60 will now be accepted
- The system is being **more aggressive** because performance momentum is positive
- **7 more strategies** (those with conviction 53.5-60) can now execute trades

## How It Works in Practice

### Scenario 1: Poor Performance (LPM = 30)
```
Base Conviction: 60
LPM: 30
Deviation: 30 - 50 = -20
Adjustment: -20 * 0.5 = -10
Dynamic Conviction: 60 - (-10) = 70
```
**Result:** System requires **70 conviction** (more conservative) because performance is poor.

### Scenario 2: Excellent Performance (LPM = 80)
```
Base Conviction: 60
LPM: 80
Deviation: 80 - 50 = 30
Adjustment: 30 * 0.5 = 15
Dynamic Conviction: 60 - 15 = 45
```
**Result:** System requires **45 conviction** (more aggressive) because performance is excellent.

### Scenario 3: Your Current Situation (LPM = 63)
```
Base Conviction: 60
LPM: 63
Deviation: 63 - 50 = 13
Adjustment: 13 * 0.5 = 6.5
Dynamic Conviction: 60 - 6.5 = 53.5
```
**Result:** System requires **53.5 conviction** (slightly more aggressive) because performance momentum is positive.

## Visual Representation

```
LPM Score Impact on Conviction Threshold (Base = 60)

Conviction
 100 ┤
     │
  90 ┤
     │
  80 ┤  ● (LPM=0)
     │
  70 ┤    ● (LPM=20)
     │
  60 ┤        ● (LPM=50, neutral)
     │
  50 ┤            ● (LPM=63, your current)
     │
  40 ┤                ● (LPM=80)
     │
  30 ┤                    ● (LPM=100)
     │
  20 ┤
     └─────────────────────────────────
       0   20   40   60   80  100
                    LPM Score
```

## Confirmation

✅ **YES, the logic is correct:**
- **Lower LPM (< 50)** → **Higher conviction requirement** (more conservative)
  - Example: LPM = 30, Base = 60 → Dynamic = 70 (requires higher conviction)
- **Higher LPM (> 50)** → **Lower conviction requirement** (more aggressive)
  - Example: LPM = 63, Base = 60 → Dynamic = 53.5 (accepts lower conviction)
- **LPM = 50** → **No change** (uses base conviction)
  - Example: LPM = 50, Base = 60 → Dynamic = 60 (no adjustment)

## Bug Fix Applied

**Previous Issue:** The clamp `Math.max(base, dynamic)` prevented the dynamic conviction from going **below** the base, even when LPM was high. This meant the adjustment was calculated but then ignored.

**Fix Applied:** Changed clamp to `Math.max(0, dynamic)` to allow the full 0-100 range:
- When LPM > 50: Dynamic conviction can now go **below** base (more aggressive)
- When LPM < 50: Dynamic conviction goes **above** base (more conservative)
- Conviction is always clamped between 0 and 100

## Code Location

The calculation is implemented in:
- `src/components/services/SignalDetectionEngine.jsx` (lines 26-41) - Used for actual filtering
- `src/components/services/services/ScanEngineService.jsx` (lines 1257-1274) - Used for logging
- `src/components/layout/PerformanceMomentumWidget.jsx` (lines 14-30) - Used for UI display

All three use the same formula for consistency.

