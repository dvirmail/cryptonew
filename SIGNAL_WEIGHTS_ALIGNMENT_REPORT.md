# Signal Weights Alignment Report

## Overview
This document verifies that signal weights and strength calculations are consistent between the autoscanner and backtest engine.

## Signal Weight Configuration

### Base Signal Weights (from `signalSettings.jsx`)

| Signal Type | Weight | Category | Notes |
|------------|--------|----------|-------|
| **CORE SIGNALS (1.5-2.0)** | | | |
| MACD | 1.8 | Trend | Core signal |
| RSI | 1.8 | Momentum | Core signal |
| Ichimoku | 1.7 | Trend | Core signal |
| Stochastic | 1.7 | Momentum | Core signal |
| EMA | 1.6 | Trend | Core signal |
| Bollinger | 1.6 | Volatility | Core signal |
| MA200 | 1.5 | Trend | Core signal |
| ATR | 1.5 | Volatility | Core signal |
| **IMPORTANT SIGNALS (1.2-1.4)** | | | |
| PSAR | 1.2 | Trend | Important signal |
| WilliamsR | 1.3 | Momentum | Important signal |
| MFI | 1.2 | Volume | Important signal |
| ADX | 1.2 | Trend | Important signal |
| CCI | 1.2 | Momentum | Important signal |
| ROC | 1.2 | Momentum | Important signal |
| AwesomeOscillator | 1.2 | Momentum | Important signal |
| CMO | 1.2 | Momentum | Important signal |
| OBV | 1.2 | Volume | Important signal |
| CMF | 1.2 | Volume | Important signal |
| ADLine | 1.2 | Volume | Important signal |
| **CONFIRMATION SIGNALS (1.0-1.1)** | | | |
| BBW | 1.1 | Volatility | Confirmation signal |
| TTM_Squeeze | 1.1 | Volatility | Confirmation signal |
| Candlestick | 1.1 | Patterns | Confirmation signal |
| Keltner | 1.0 | Volatility | Confirmation signal |
| Donchian | 1.0 | Volatility | Confirmation signal |
| ChartPattern | 1.0 | Patterns | Confirmation signal |
| Pivot | 1.0 | Support/Resistance | Confirmation signal |
| Fibonacci | 1.0 | Support/Resistance | Confirmation signal |
| SupportResistance | 1.0 | Support/Resistance | Confirmation signal |
| MARibbon | 1.0 | Trend | Confirmation signal |
| **VOLUME CONFIRMATION (0.8-1.0)** | | | |
| Volume | 0.9 | Volume | Volume confirmation |

## Calculation Flow

### Unified Calculator (`unifiedStrengthCalculator.jsx`)
Both autoscanner and backtest use the same function: `calculateUnifiedCombinedStrength()`

### Calculation Steps:
1. **Base Weighted Strength**: `signal.strength * SIGNAL_WEIGHTS[signalType]`
2. **Regime Adjustment**: Applied via `SignalWeightCalculator` (advanced mode) or `getRegimeMultiplier()` (simple mode)
3. **Correlation Penalties/Bonuses**: Applied via `SignalCorrelationDetector`
4. **Regime Context Bonus**: Applied via `RegimeContextWeighting`
5. **Quality Adjustments**: Based on signal strength thresholds
6. **Synergy Bonus**: For complementary signal pairs
7. **Diversity Bonus**: For different signal types

## Configuration Consistency

### Autoscanner (`signalLogic.jsx`)
- Uses `calculateUnifiedCombinedStrength()` with:
  - `useAdvancedFeatures: true`
  - `useSimpleRegimeMultiplier: false`
  - `marketRegime`: Actual regime from market detection
  - `regimeConfidence`: Actual confidence value (0-1)

### Backtest (`BacktestingEngine.jsx`)
- Uses `calculateUnifiedCombinedStrength()` with:
  - `useAdvancedFeatures: true`
  - `useSimpleRegimeMultiplier: false`
  - `marketRegime`: Regime from backtest analysis
  - `regimeConfidence`: Confidence from regime detection

## Key Fixes Applied

1. **SignalWeightCalculator Alignment**: 
   - ✅ Now uses `SIGNAL_WEIGHTS` from `signalSettings.jsx` as base weights
   - ✅ Previously used mismatched pattern-specific weights (e.g., 'macd_cross' vs 'macd')

2. **Regime Confidence Alignment**:
   - ✅ Autoscanner now passes actual `marketRegime.confidence` instead of hardcoded 0.5
   - ✅ Backtest passes actual `regimeConfidence` from analysis

3. **Market Regime Alignment**:
   - ✅ Autoscanner passes actual `marketRegime.regime` instead of 'neutral'
   - ✅ Backtest passes actual regime from analysis

## Verification Checklist

- [x] Both systems use the same `SIGNAL_WEIGHTS` dictionary
- [x] Both systems use `calculateUnifiedCombinedStrength()` function
- [x] Both systems use `useAdvancedFeatures: true`
- [x] Both systems use `useSimpleRegimeMultiplier: false`
- [x] Both systems pass actual market regime (not hardcoded)
- [x] Both systems pass actual regime confidence (not hardcoded)
- [x] `SignalWeightCalculator` uses `SIGNAL_WEIGHTS` as base weights
- [x] Regime adjustments applied consistently via `RegimeContextWeighting`
- [x] Correlation penalties/bonuses applied consistently via `SignalCorrelationDetector`

## Conclusion

All signal weights and strength calculations are now aligned between the autoscanner and backtest engine. Both systems:
- Use the same base weights from `SIGNAL_WEIGHTS`
- Use the same unified calculation function
- Apply the same regime adjustments
- Apply the same correlation penalties/bonuses
- Use the same advanced features

The only difference is the source of market regime and confidence values, which is expected (autoscanner uses live detection, backtest uses historical analysis).

