# Backtest Duplicate and Correlation Handling

## Overview

The backtest system handles duplicate signals and high correlations through multiple mechanisms that affect both **combined strength calculation** and **filter passing criteria**.

---

## 1. Duplicate Signal Handling

### How Duplicates Are Identified

**In the backtest processor** (`backtestProcessor.jsx`):
- **Combination Key**: Signals are grouped by `combinationName` which is created from sorted signal values:
  ```javascript
  const combinationName = match.signals.map(s => s.value || s.type).sort().join(' + ');
  const combinationKey = `${match.coin}-${combinationName}`;
  ```
- **Same Signal Type with Different Values**: These are treated as **different combinations**:
  - `[RSI Oversold, RSI Above 50]` → Different combination
  - `[RSI Oversold, RSI Oversold]` → Same combination (duplicate)

### Duplicate Impact on Combined Strength

**At Match Level** (when `combinedStrength` is calculated):
- **No explicit duplicate filtering** - if a match has duplicate signals (e.g., two "RSI Oversold" signals), both contribute to strength
- Each signal's strength is added: `combinedStrength = sum(signal.strength)`
- **However**, correlation penalties will reduce the strength if signals are correlated

**At Combination Level** (when aggregating matches):
- Line 126 in `backtestProcessor.jsx`: `combination.combinedStrength += match.combinedStrength || 0;`
- This **sums** all match strengths for the same combination
- **This means**: If you have 10 matches of the same signal combination, the `averageCombinedStrength` will be calculated from all 10

### Duplicate Impact on Filter Passing

**`minOccurrences` Filter**:
- Duplicates **don't affect** the count - each match is counted as a separate occurrence
- If you have 10 matches with the same signal combination, `occurrences = 10`
- The filter checks: `regimeData.occurrences >= minOccurrences`

**Example**:
- Strategy: `[RSI Oversold, Stochastic Oversold]`
- 8 matches found in "uptrend" regime
- `minOccurrences = 5`
- **Result**: ✅ Passes (8 >= 5)

---

## 2. Correlation Handling

### How Correlations Are Detected

**Correlation Threshold**: `0.70` (70%)
- Signals with correlation ≥ 0.70 are considered "highly correlated"
- Correlations are detected using `SignalCorrelationDetector.detectCorrelations()`

**Example Correlations**:
- RSI ↔ Stochastic: `0.85` (85% correlated)
- RSI ↔ Williams %R: `0.80` (80% correlated)
- MACD ↔ EMA: `0.70` (70% correlated)
- EMA ↔ TEMA: `0.80` (80% correlated)

### Correlation Penalty Calculation

**Formula** (from `SignalCorrelationDetector.calculateCorrelationPenalty()`):
```javascript
1. Detect all correlations above threshold (≥ 0.70)
2. Calculate average correlation strength
3. Apply penalty: penalty = averageCorrelation × 0.10 (10% factor)
4. Cap at 25% maximum: penalty = min(0.25, penalty)
```

**Example**:
- Signals: `[RSI Oversold (75), Stochastic Oversold (75), Williams %R Oversold (75)]`
- Correlations detected:
  - RSI ↔ Stochastic: `0.85`
  - RSI ↔ Williams: `0.80`
  - Stochastic ↔ Williams: `0.90`
- Average correlation: `(0.85 + 0.80 + 0.90) / 3 = 0.85`
- Penalty: `0.85 × 0.10 = 0.085` (8.5%)
- **Strength reduction**: `baseStrength × (1 - 0.085) = baseStrength × 0.915`

### Correlation Bonus Calculation

**Formula** (from `SignalCorrelationDetector.calculateCorrelationBonus()`):
```javascript
1. Detect negative correlations (< -0.5) - these are complementary
2. Apply bonus: bonus = abs(correlation) × 0.20 (20% factor)
3. Cap at 30% maximum: bonus = min(0.30, totalBonus)
```

**Example**:
- Signals: `[RSI Oversold, RSI Overbought]` (negative correlation: -0.90)
- Bonus: `0.90 × 0.20 = 0.18` (18% bonus)
- **Strength increase**: `baseStrength × (1 + 0.18) = baseStrength × 1.18`

### How Correlation Affects Combined Strength

**In AdvancedSignalStrengthCalculator** (`calculateFinalStrength()`):
```javascript
// Step 1: Base weighted strength (sum of all signal strengths)
baseStrength = sum(weightedStrengths)

// Step 2: Apply correlation penalty
correlationAdjusted = baseStrength × (1 - correlationPenalty)

// Step 3: Apply correlation bonus (if any)
// Note: Bonus is applied separately in the correlation report
```

**In signalLogic.jsx** (autoscanner - same logic):
```javascript
baseStrength = weightedSum + coreBonus + diversityBonus

// Apply correlation adjustment
correlationAdjustment = -(penalty × baseStrength) + (bonus × baseStrength)
finalStrength = baseStrength + correlationAdjustment
```

### Example: Correlation Impact

**Scenario 1: High Correlation (Reduces Strength)**
- Signals: `[MACD (85), EMA (80), TEMA (75)]`
- Base strength: `85 + 80 + 75 = 240`
- Correlations:
  - MACD ↔ EMA: `0.70`
  - MACD ↔ TEMA: `0.70`
  - EMA ↔ TEMA: `0.80`
- Average correlation: `0.733`
- Penalty: `0.733 × 0.10 = 0.0733` (7.33%)
- **Final strength**: `240 × (1 - 0.0733) = 222.4` ✅

**Scenario 2: Low Correlation (No Penalty)**
- Signals: `[RSI (75), Volume Spike (60), Bollinger (65)]`
- Base strength: `75 + 60 + 65 = 200`
- Correlations: None above 0.70 threshold
- Penalty: `0%`
- **Final strength**: `200` ✅

**Scenario 3: Complementary Signals (Bonus)**
- Signals: `[RSI Oversold (75), RSI Overbought (75)]` (negative correlation: -0.90)
- Base strength: `75 + 75 = 150`
- Bonus: `0.90 × 0.20 = 0.18` (18%)
- **Final strength**: `150 × (1 + 0.18) = 177` ✅

---

## 3. Impact on Filter Passing

### Combined Strength Filter

**Minimum Combined Strength Threshold**:
- Each match must have `combinedStrength >= minCombinedStrength` (typically 250)
- **Correlation reduces strength**, so highly correlated strategies may fail this filter
- **Example**:
  - Base strength: `300`
  - Correlation penalty: `10%`
  - Final strength: `270` ✅ Passes (270 >= 250)

### Occurrences Filter

**`minOccurrences` Filter**:
- **Correlation does NOT affect occurrence count** - it only affects strength
- If 10 matches pass the strength threshold, `occurrences = 10`
- **Example**:
  - Strategy has 8 matches with `combinedStrength >= 250`
  - `minOccurrences = 5`
  - **Result**: ✅ Passes (8 >= 5)

### Regime-Specific Filtering

**Each regime is filtered separately**:
- `regimePerf.occurrences >= minOccurrences` for each regime
- If a strategy has high correlation and lower strength, it may:
  - Pass in one regime (where strength is high enough)
  - Fail in another regime (where strength is too low)

---

## 4. Summary

### Duplicate Signals
- **Same signal type + value**: Treated as same combination (grouped together)
- **Different signal values**: Treated as different combinations
- **No explicit duplicate filtering** - duplicates contribute to strength (but correlation may reduce it)

### High Correlation
- **Reduces combined strength** by up to 25% (penalty factor: 10% of average correlation)
- **Does NOT affect occurrence count**
- **May cause strategies to fail** the `minCombinedStrength` threshold
- **Example**: Strategy with base strength 300 and 10% correlation penalty → 270 final strength (may fail if threshold is 275)

### Complementary Signals (Negative Correlation)
- **Increases combined strength** by up to 30% (bonus factor: 20% of absolute correlation)
- **Rewards diverse signal combinations**

### Filter Impact
1. **`minCombinedStrength`**: Correlation penalties can cause strategies to fail this threshold
2. **`minOccurrences`**: Correlation does NOT affect this - it's purely based on match count
3. **Regime filtering**: Each regime is evaluated separately with the same thresholds

---

## 5. Key Takeaways

1. **Duplicates are grouped** by combination name, but each match contributes to occurrence count
2. **Correlation reduces strength** but doesn't prevent matches from being counted
3. **High correlation strategies** may fail the strength threshold but still pass occurrence threshold if they have enough matches
4. **Both autoscanner and backtest** use the same correlation logic for consistency
5. **Correlation threshold is 0.70** (70%) with 10% penalty factor and 25% maximum penalty cap

