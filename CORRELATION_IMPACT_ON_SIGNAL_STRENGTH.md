# How Correlation Impacts Signal Strength

## Overview

The correlation system adjusts **combined signal strength** (not individual signal strengths) to prevent double-counting highly correlated signals and reward complementary signals. This happens **after** individual signal strengths are calculated.

---

## How It Works

### Step 1: Calculate Individual Signal Strengths
Each signal has its base strength (e.g., RSI Oversold = 75, MACD Cross = 80)

### Step 2: Calculate Weighted Strengths
Each signal is multiplied by its importance weight (from `SIGNAL_WEIGHTS`):
```javascript
weightedStrength = baseStrength × signalWeight × regimeMultiplier
```

### Step 3: Sum Initial Combined Strength
```javascript
totalWeightedStrength = sum of all weightedStrengths
```

### Step 4: Apply Correlation Adjustments
```javascript
correlationAdjustedStrength = totalWeightedStrength × (1 - correlationPenalty + correlationBonus)
```

### Step 5: Apply Other Bonuses
```javascript
finalStrength = correlationAdjustedStrength × (1 + synergyBonus) × (1 + diversityBonus) × (1 + regimeBonus)
```

---

## Correlation Penalty System

### When Penalties Apply

**Correlation Threshold**: Signals with correlation ≥ **0.8** (80%) are considered highly correlated and receive penalties.

### Penalty Calculation

```javascript
// 1. Detect all correlations between signals
correlations = detectCorrelations(signals)

// 2. Calculate average correlation strength
averageCorrelation = sum(abs(correlation)) / correlations.length

// 3. Apply penalty factor (15% of average correlation)
penalty = averageCorrelation × 0.15

// 4. Cap at 25% maximum
penalty = min(penalty, 0.25)
```

### Example: High Correlation Penalty

**Scenario**: RSI Oversold (75) + Stochastic Oversold (75) + Williams %R Oversold (75)

**Correlations Detected**:
- RSI ↔ Stochastic: **0.85** (85%)
- RSI ↔ Williams: **0.80** (80%)
- Stochastic ↔ Williams: **0.90** (90%)

**Penalty Calculation**:
```
Average correlation = (0.85 + 0.80 + 0.90) / 3 = 0.85
Penalty = 0.85 × 0.15 = 0.1275 (12.75%)
```

**Strength Impact**:
```
Base combined strength = 75 + 75 + 75 = 225
After penalty = 225 × (1 - 0.1275) = 225 × 0.8725 = 196.3
Reduction = 28.7 points (12.75%)
```

---

## Correlation Bonus System

### When Bonuses Apply

**Complementary Threshold**: Signals with correlation ≤ **-0.5** (strong negative correlation) are considered complementary and receive bonuses.

### Bonus Calculation

```javascript
// 1. Detect negative correlations
for (correlation of correlations) {
  if (correlation < -0.5) {
    bonus += abs(correlation) × 0.2  // 20% of correlation strength
  }
}

// 2. Cap at 30% maximum
bonus = min(totalBonus, 0.3)
```

### Example: Complementary Signal Bonus

**Scenario**: RSI Oversold (75) + MACD Bullish Cross (80)

**Complementary Signals**:
- RSI Oversold ↔ RSI Overbought: **-0.90** (strong negative)
- MACD Bullish ↔ MACD Bearish: **-0.85** (strong negative)

**Bonus Calculation**:
```
Bonus = 0.90 × 0.2 + 0.85 × 0.2 = 0.18 + 0.17 = 0.35
Capped at 30% = 0.30
```

**Strength Impact**:
```
Base combined strength = 75 + 80 = 155
After bonus = 155 × (1 + 0.30) = 155 × 1.30 = 201.5
Increase = 46.5 points (30%)
```

---

## Correlation Matrix Examples

### Highly Correlated Signal Groups

| Signal Group | Correlation | Penalty Impact |
|--------------|-------------|----------------|
| **Momentum Oscillators** | | |
| RSI ↔ Stochastic | 0.85 | 12.75% penalty |
| RSI ↔ Williams %R | 0.80 | 12.00% penalty |
| Stochastic ↔ Williams %R | 0.90 | 13.50% penalty |
| **Trend Indicators** | | |
| MACD ↔ EMA | 0.75 | 11.25% penalty |
| EMA ↔ MA200 | 0.65 | 9.75% penalty |
| MACD ↔ SMA | 0.70 | 10.50% penalty |
| **Volume Indicators** | | |
| OBV ↔ CMF | 0.70 | 10.50% penalty |
| MFI ↔ RSI | 0.70 | 10.50% penalty |

### Complementary Signal Pairs

| Signal Pair | Correlation | Bonus Impact |
|-------------|-------------|--------------|
| RSI Oversold ↔ RSI Overbought | -0.90 | 18% bonus |
| Stochastic Oversold ↔ Stochastic Overbought | -0.90 | 18% bonus |
| MACD Bullish ↔ MACD Bearish | -0.85 | 17% bonus |
| Awesome Oscillator Positive ↔ Negative | -0.85 | 17% bonus |

---

## Real-World Examples

### Example 1: Over-Correlated Combination (High Penalty)

**Signals**:
- RSI Oversold: **75** strength
- Stochastic Oversold: **75** strength  
- Williams %R Oversold: **80** strength
- CCI Oversold: **70** strength

**Correlations**:
- RSI ↔ Stochastic: 0.85
- RSI ↔ Williams: 0.80
- Stochastic ↔ Williams: 0.90
- RSI ↔ CCI: 0.75
- Stochastic ↔ CCI: 0.70

**Calculation**:
```
Base strength = 75 + 75 + 80 + 70 = 300
Average correlation = (0.85 + 0.80 + 0.90 + 0.75 + 0.70) / 5 = 0.80
Penalty = 0.80 × 0.15 = 0.12 (12%)
Adjusted strength = 300 × (1 - 0.12) = 264
Loss = 36 points (12%)
```

**Result**: All 4 signals measure the same thing (momentum exhaustion), so they get penalized.

---

### Example 2: Well-Diversified Combination (No Penalty)

**Signals**:
- MACD Bullish Cross: **80** strength
- Support Touch: **90** strength
- Volume Spike: **60** strength
- Fibonacci At Golden Ratio: **85** strength

**Correlations**:
- MACD ↔ Support: 0.45 (low correlation)
- MACD ↔ Volume: 0.30 (low correlation)
- MACD ↔ Fibonacci: 0.40 (low correlation)
- All correlations < 0.8 threshold

**Calculation**:
```
Base strength = 80 + 90 + 60 + 85 = 315
Penalty = 0 (no correlations ≥ 0.8)
Adjusted strength = 315 × (1 - 0) = 315
No loss
```

**Result**: Diverse signals from different categories get no penalty.

---

### Example 3: Complementary Signals (Bonus)

**Signals**:
- RSI Oversold: **75** strength
- MACD Bullish Cross: **80** strength
- Support Bounce: **80** strength

**Correlations**:
- RSI Oversold ↔ MACD Bullish: 0.50 (low correlation)
- RSI Oversold ↔ Support Bounce: 0.60 (moderate, but < 0.8)
- MACD Bullish ↔ Support Bounce: 0.55 (moderate, but < 0.8)

**Complementary Elements**:
- RSI Oversold (bullish) + MACD Bullish Cross (bullish) = **complementary confirmation**

**Calculation**:
```
Base strength = 75 + 80 + 80 = 235
Penalty = 0 (no high correlations)
Bonus = 0 (no strong negative correlations, but synergy bonus may apply)
Adjusted strength = 235
```

**Result**: Different types of bullish signals confirm each other without penalty.

---

## Impact on Signal Strength Tiers

### How Correlation Affects Each Strength Tier

| Strength Tier | Base Range | After 12% Penalty | After 30% Bonus |
|---------------|------------|-------------------|-----------------|
| **Tier 1 (90-95)** | 90-95 | 79-84 | 117-124 |
| **Tier 2 (85-89)** | 85-89 | 75-78 | 111-116 |
| **Tier 3 (80-84)** | 80-84 | 70-74 | 104-109 |
| **Tier 4 (70-79)** | 70-79 | 62-70 | 91-103 |
| **Tier 5 (50-69)** | 50-69 | 44-61 | 65-90 |

### Key Insights

1. **High-strength signals (90+) are more resilient** to penalties
   - 90 strength → 12% penalty = 79 (still Tier 4)
   - 50 strength → 12% penalty = 44 (drops to Tier 6)

2. **Combinations with penalties still need strong base signals**
   - Weak signals (30-40) + penalty = 26-35 (may not meet thresholds)

3. **Bonuses can push signals into higher tiers**
   - 80 strength → 30% bonus = 104 (enters Tier 1 range)

---

## Correlation vs. Signal Strength Relationship

### Scenario A: Strong Signals + High Correlation

**Signals**: 
- MACD Cross (80) + EMA Cross (80) + MA200 Cross (75)
- Correlation: 0.75 average

**Result**:
```
Base: 235
Penalty: 11.25% (0.75 × 0.15)
Adjusted: 208.6
Still strong enough to meet thresholds
```

### Scenario B: Weak Signals + High Correlation

**Signals**:
- RSI Oversold (75) + Stochastic Oversold (75) + Williams %R (75)
- Correlation: 0.85 average

**Result**:
```
Base: 225
Penalty: 12.75% (0.85 × 0.15)
Adjusted: 196.3
May fall below minimum threshold (e.g., 200)
```

### Scenario C: Strong Signals + Low Correlation

**Signals**:
- MACD Cross (80) + Support Breakout (90) + Fibonacci Golden Ratio (85)
- Correlation: 0.40 average (< 0.8 threshold)

**Result**:
```
Base: 255
Penalty: 0%
Adjusted: 255
Full strength maintained
```

---

## Best Practices

### ✅ DO: Combine Diverse Signal Types
- **Momentum** (RSI) + **Trend** (MACD) + **Support/Resistance** (Fibonacci) + **Volume** (Volume Spike)
- Result: Low correlation, no penalties, full strength

### ❌ DON'T: Stack Correlated Indicators
- **Momentum** (RSI) + **Momentum** (Stochastic) + **Momentum** (Williams %R)
- Result: High correlation, 12-13% penalty, reduced strength

### ✅ DO: Combine Complementary Signals
- **Bullish** (RSI Oversold) + **Bullish** (MACD Cross) + **Bullish** (Support Bounce)
- Result: Different categories, complementary confirmation, possible synergy bonus

---

## Summary

1. **Correlation Penalties** (0-25%):
   - Applied when signals have ≥80% correlation
   - Calculation: `averageCorrelation × 15%`
   - Reduces combined strength to prevent double-counting

2. **Correlation Bonuses** (0-30%):
   - Applied when signals have ≤-50% correlation (complementary)
   - Calculation: `abs(correlation) × 20%`
   - Rewards diverse, complementary signals

3. **Impact on Strategy Selection**:
   - Strategies with high correlation penalties may fall below minimum thresholds
   - Strategies with bonuses may exceed thresholds more easily
   - Well-diversified strategies maintain full strength

4. **Relationship to Signal Strengths**:
   - Base signal strengths (the values we just fixed) are **not** affected
   - Only the **combined strength** is adjusted
   - Strong base signals (90+) are more resilient to penalties
   - Weak base signals (30-40) are more vulnerable to penalties

---

*The correlation system ensures that strategies with diverse, independent signals are favored over strategies that double-count the same information.*

