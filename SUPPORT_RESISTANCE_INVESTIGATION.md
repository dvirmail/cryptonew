# Support/Resistance Logic Investigation

## Overview

This document explains the comprehensive logging added to investigate why entries "near support" have a **21.9% win rate** (worst performance) while entries with "no key level" have a **52.9% win rate** (best performance).

## Problem Statement

From the trade quality analysis:
- **83% of trades** are marked as "near support"
- **"Near support" entries:** 21.9% win rate, -0.69% avg P&L
- **"No key level" entries:** 52.9% win rate, +0.15% avg P&L
- **"Near resistance" entries:** 22.4% win rate, -0.45% avg P&L

This is counterintuitive - entries near support should theoretically perform better, not worse.

## Logging Added

### 1. SR Calculation Logging (`supportresistanceindicators.jsx`)

**Location:** `src/components/utils/indicator-calculations/supportresistanceindicators.jsx`

**Log Tag:** `[SR_CALC]`

**What it logs:**
- Total number of raw pivots detected (support and resistance)
- Number of levels after clustering
- Percentage of candles that have support/resistance levels
- Sample of merged support/resistance levels
- Warning if too many levels are detected (>20) - may indicate weak/false levels

**Example log:**
```
[SR_CALC] 📊 Support/Resistance Calculation Summary: {
  klineDataLength: 100,
  lookback: 50,
  tolerance: 0.005,
  rawPivots: { support: 15, resistance: 12, total: 27 },
  afterClustering: { support: 8, resistance: 6, total: 14 },
  candlesWithLevels: {
    support: 95,
    resistance: 90,
    both: 85,
    percentWithSupport: "95.0%",
    percentWithResistance: "90.0%"
  },
  mergedSupportLevels: [1.234, 1.245, ...],
  mergedResistanceLevels: [1.256, 1.267, ...],
  note: "✅ Reasonable number of levels"
}
```

**What to look for:**
- **Too many levels (>20):** May indicate weak/false levels being detected
- **High percentage of candles with levels (>90%):** May indicate over-detection
- **Very few levels (<5):** May indicate under-detection

### 2. Entry Quality SR Data Source Logging (`PositionManager.jsx`)

**Location:** `src/components/services/PositionManager.jsx` - `_calculateEntryQuality` function

**Log Tag:** `[SR_ENTRY_QUALITY]`

**What it logs:**

#### a) SR Data Source Check
- Whether SR data exists in signal
- Whether SR data exists in indicators
- What keys are available in signal/indicators

**Example:**
```
[SR_ENTRY_QUALITY] 🔍 BTCUSDT - Checking SR Data Sources: {
  hasSignal: true,
  hasSignalSupportResistance: false,
  hasSignalSrData: false,
  srDataFromSignal: false,
  signalKeys: []
}
```

#### b) Indicators Check
- Whether scanner service has indicators
- Whether supportresistance exists in indicators
- Type and structure of supportresistance data

**Example:**
```
[SR_ENTRY_QUALITY] 🔍 BTCUSDT - Checking Indicators: {
  hasScannerService: true,
  hasState: true,
  hasCurrentIndicators: true,
  hasIndicators: true,
  hasSymbolIndicators: true,
  indicatorKeys: ["rsi", "macd", "supportresistance", ...],
  hasSupportResistance: true,
  supportResistanceType: "object",
  supportResistanceIsArray: true
}
```

#### c) SR Data Extraction
- When SR data is successfully extracted from indicators
- Number of support/resistance levels found
- Sample of levels

**Example:**
```
[SR_ENTRY_QUALITY] ✅ BTCUSDT - Extracted SR from indicators array: {
  arrayLength: 100,
  lastIndex: 99,
  supportCount: 8,
  resistanceCount: 6,
  supportSample: [1.234, 1.245, 1.256, ...],
  resistanceSample: [1.267, 1.278, 1.289, ...]
}
```

#### d) Initial SR Data
- Total number of support/resistance levels
- Sample of levels
- Entry price

**Example:**
```
[SR_ENTRY_QUALITY] 🔍 BTCUSDT - Initial SR Data: {
  entryPrice: 1.250,
  totalSupportLevels: 8,
  totalResistanceLevels: 6,
  supportSample: [1.234, 1.245, 1.256, ...],
  resistanceSample: [1.267, 1.278, 1.289, ...]
}
```

#### e) Filtered Levels
- How many support levels are below entry price
- How many resistance levels are above entry price
- All support/resistance levels (for debugging)

**Example:**
```
[SR_ENTRY_QUALITY] 🔍 BTCUSDT - Filtered Levels (below/above entry): {
  entryPrice: 1.250,
  supportLevelsBelow: 5,
  resistanceLevelsAbove: 4,
  supportLevelsSample: [1.234, 1.245, 1.256, ...],
  resistanceLevelsSample: [1.267, 1.278, 1.289, ...],
  allSupportLevels: [1.234, 1.245, ...],
  allResistanceLevels: [1.267, 1.278, ...]
}
```

#### f) Support Calculation
- Nearest support level
- Distance to support (as percentage)
- Whether entry is "near support" (within 2%)
- All support levels below entry

**Example:**
```
[SR_ENTRY_QUALITY] 📊 BTCUSDT - Support Calculation: {
  entryPrice: 1.250,
  nearestSupport: 1.245,
  distanceToSupportPercent: 0.40,
  threshold: 2.0,
  isNearSupport: true,
  distanceBelowThreshold: true,
  allSupportLevelsBelow: [1.234, 1.245, 1.256, ...],
  interpretation: "✅ ENTRY NEAR SUPPORT"
}
```

#### g) Resistance Calculation
- Nearest resistance level
- Distance to resistance (as percentage)
- Whether entry is "near resistance" (within 2%)
- All resistance levels above entry

**Example:**
```
[SR_ENTRY_QUALITY] 📊 BTCUSDT - Resistance Calculation: {
  entryPrice: 1.250,
  nearestResistance: 1.267,
  distanceToResistancePercent: 1.36,
  threshold: 2.0,
  isNearResistance: true,
  distanceBelowThreshold: true,
  allResistanceLevelsAbove: [1.267, 1.278, 1.289, ...],
  interpretation: "✅ ENTRY NEAR RESISTANCE"
}
```

#### h) Final Determination
- Final classification (NEAR SUPPORT, NEAR RESISTANCE, or NO KEY LEVEL)
- Historical performance note
- All calculated values

**Example:**
```
[SR_ENTRY_QUALITY] ✅ BTCUSDT - Final Entry Quality SR Determination: {
  entryPrice: 1.250,
  entryNearSupport: true,
  entryNearResistance: false,
  entryDistanceToSupportPercent: 0.40,
  entryDistanceToResistancePercent: null,
  classification: "NEAR SUPPORT",
  note: "⚠️ This entry is marked as 'near support' - historically 21.9% win rate"
}
```

## What to Investigate

### 1. **2% Threshold Issue**
- **Current threshold:** 2.0% (entry is "near support" if within 2% of support level)
- **Question:** Is 2% too wide? Many entries might be incorrectly classified as "near support"
- **Look for:** Entries with distance 1.5-2.0% - are these really "near support"?

### 2. **Too Many Support Levels**
- **Question:** Are too many weak/false support levels being detected?
- **Look for:** 
  - `[SR_CALC]` logs showing >20 support levels
  - `[SR_ENTRY_QUALITY]` logs showing many support levels below entry price
  - Are these levels actually significant?

### 3. **Support Levels in Downtrend**
- **Question:** In a downtrend, support levels are more likely to break. Are we entering near support in downtrend?
- **Look for:**
  - Market regime when entry is "near support"
  - Do entries near support in downtrend perform worse?

### 4. **Support Level Quality**
- **Question:** Are the detected support levels actually significant (multiple touches, volume, etc.)?
- **Look for:**
  - How many support levels are detected per symbol
  - Are levels clustered too closely together?
  - Are levels based on weak pivots (single candle)?

### 5. **Entry Timing**
- **Question:** Are we entering too early (before support holds) or too late (after support breaks)?
- **Look for:**
  - Distance to support when entry is "near support"
  - Are entries at 0.1% distance performing better than 1.9% distance?

### 6. **No Key Level Performance**
- **Question:** Why do entries with "no key level" perform best (52.9% win rate)?
- **Look for:**
  - Are these entries in different market conditions?
  - Are these entries with higher momentum?
  - Are these entries avoiding false support levels?

## Expected Findings

Based on the analysis, we expect to find:

1. **2% threshold is too wide** - Many entries are incorrectly classified as "near support" when they're actually 1.5-2.0% away, which is not really "near"

2. **Too many weak support levels** - The SR calculation is detecting too many levels, including weak ones that don't hold

3. **Support levels in downtrend** - Most entries are in downtrend, and support levels in downtrend are more likely to break

4. **False support levels** - Many detected "support" levels are not actually significant (single pivot, no volume confirmation, etc.)

5. **Entry timing** - Entries are happening too early (before support is confirmed) or too late (after support breaks)

## Recommendations (Based on Expected Findings)

### 1. **Reduce Threshold**
- Change from 2.0% to 0.5-1.0% for "near support"
- Only classify as "near support" if truly close to level

### 2. **Filter Support Levels**
- Only use support levels with multiple touches (>=2)
- Only use support levels with volume confirmation
- Only use support levels that are not too close together (minimum distance)

### 3. **Market Regime Filter**
- Don't enter "near support" in downtrend
- Only enter "near support" in uptrend or ranging markets

### 4. **Support Level Strength**
- Add strength scoring to support levels
- Only use "strong" support levels (multiple touches, volume, time-tested)

### 5. **Entry Timing**
- Wait for confirmation that support holds (bounce, volume)
- Don't enter immediately when price reaches support

### 6. **Disable Support/Resistance Filter**
- Consider disabling "near support" entries entirely
- Focus on "no key level" entries (52.9% win rate)

## How to Use the Logs

1. **Run the scanner** and wait for positions to open
2. **Check console logs** for `[SR_ENTRY_QUALITY]` and `[SR_CALC]` tags
3. **Look for patterns:**
   - How many support levels are detected?
   - What is the distance to support when entry is "near support"?
   - Are entries near support in downtrend?
   - Are support levels clustered too closely?
4. **Compare entries:**
   - Compare "near support" entries that win vs. lose
   - Compare "near support" vs. "no key level" entries
   - Look at market regime, momentum, distance to support

## Next Steps

1. **Collect logs** from several position openings
2. **Analyze patterns** in the logs
3. **Identify root cause** of poor "near support" performance
4. **Implement fixes** based on findings
5. **Test improvements** and verify win rate improvement

---

**Log Tags to Filter:**
- `[SR_CALC]` - Support/Resistance calculation
- `[SR_ENTRY_QUALITY]` - Entry quality SR determination

**Key Metrics to Monitor:**
- Number of support/resistance levels detected
- Distance to support when entry is "near support"
- Market regime when entry is "near support"
- Win rate by distance to support (0-0.5%, 0.5-1%, 1-1.5%, 1.5-2%)

