# Complete Signal Strength Allocation Table

**Last Updated**: After implementing Priority 1 & 2 fixes

## Signal Strength Hierarchy

| Strength | Category | Signal Type | Signal Value | Notes |
|----------|----------|-------------|--------------|-------|
| **90-95** | **Critical Events** |
| 95 | Volatility | TTM Squeeze | Squeeze Release (Bullish/Bearish) | Regime-adjusted |
| 90 | Divergence | All Types | Regular Bullish/Bearish Divergence | Standardized across all indicators |
| 90 | Divergence | Volume | OBV Regular/Hidden Divergence | Fixed: was 85 |
| 90 | Support/Resistance | Support/Resistance | Breakout/Breakdown | Standardized |
| 90 | Support/Resistance | Support/Resistance | Support Touch / Resistance Touch | Fixed: was 85 |
| 90 | Pivot | Pivot Points | Breakout/Breakdown (R1/S1/R2/S2/R3/S3) | Standardized |
| 90 | Volatility | Keltner | Upper Breakout / Lower Breakdown | Fixed: was 80 |
| 90 | Volatility | Donchian | Upper Breakout / Lower Breakdown | Fixed: was 85 |
| 90 | Pattern | Chart Pattern | Pattern Breakout / Breakdown | |
| 88 | Divergence | All Types | Hidden Bullish/Bearish Divergence | Standardized |
| **85-89** | **Strong Events** |
| 85 | Momentum | RSI/MFI | Failure Swing (Bullish/Bearish) | |
| 85 | Momentum | Awesome Oscillator | Twin Peaks / Saucer | |
| 85 | Support/Resistance | Fibonacci | At Golden Ratio (61.8%) | |
| 85 | Pivot | Pivot Points | Touch / Bounce / Rejection | |
| 85 | Momentum | ROC | Threshold Break (Bullish/Bearish) | |
| 85 | Volume | MFI | Overbought/Oversold Exit | |
| 82 | Trend | Ichimoku | Kijun Bounce (Bullish/Bearish) | |
| 80-85 | **Major Crosses & Events** |
| 80 | Trend | MACD | Bullish Cross / Bearish Cross | |
| 80 | Trend | EMA | Bullish Cross / Bearish Cross | |
| 80 | Trend | MA200 | Death Cross / Golden Cross | |
| 80 | Support/Resistance | Support/Resistance | Support Bounce / Resistance Rejection | |
| 80 | Pivot | Pivot Points | Bullish Cross / Bearish Cross | |
| 80 | Momentum | Awesome Oscillator | Bearish/Bullish Zero Cross | |
| 80 | Momentum | ROC | Extreme Momentum / Peak/Trough Reversal | |
| 80 | Volatility | Bollinger | Band Walk Up / Down | |
| 80 | Pattern | Chart Pattern | Double Top/Bottom / Flag / Pennant | |
| 80 | Volume | MFI | Bearish/Bullish Divergence | |
| 78 | Trend | Ichimoku | Tenkan Above/Below Kijun | |
| 75-79 | **Moderate-Strong Events** |
| 75 | Momentum | RSI | Overbought/Oversold Entry | |
| 75 | Momentum | Stochastic | Overbought/Oversold Entry / Cross | |
| 75 | Momentum | Williams %R | Overbought/Oversold Entry | |
| 75 | Momentum | MFI | Overbought/Oversold Entry | |
| 75 | Momentum | ROC | Bearish/Bullish Zero Cross | |
| 75 | Trend | MA200 | Bullish/Bearish Rejection | |
| 75 | Volatility | ATR | ATR Expansion | Event-based |
| 75 | Volume | OBV | Bullish/Bearish Crossover | |
| 75 | Pattern | Chart Pattern | Ascending/Descending Triangle / Wedge | |
| 74 | Trend | TEMA | price_cross_up / price_cross_down | |
| 72 | Trend | WMA | price_cross_up / price_cross_down | |
| 70-74 | **Strong State/Events** |
| 70 | Support/Resistance | Support/Resistance | At Support / At Resistance | Within 1% |
| 70 | Pivot | Pivot Points | At Pivot Point | Fixed: was 60 |
| 70 | Momentum | RSI | Overbought/Oversold Exit | |
| 70 | Momentum | Stochastic | Overbought/Oversold Entry/Exit | |
| 70 | Momentum | Williams %R | Overbought/Oversold Exit | |
| 70 | Trend | DEMA | price_cross_up / price_cross_down | |
| 70 | Volume | CMF | Bullish/Bearish Zero Cross | |
| 70 | Volatility | Keltner/Donchian | Bullish/Bearish Middle Cross | |
| 70 | Pattern | Chart Pattern | Symmetrical Triangle | |
| 65-69 | **Moderate Events** |
| 65 | Trend | Ichimoku | Price Above/Below Kumo | |
| 65 | Volatility | ATR | Low Volatility | Event-based |
| 65 | Volume | ADL | Bullish/Bearish Crossover | |
| 60-64 | **Moderate State** |
| 60 | Volatility | BBW | In Squeeze | |
| 60 | Momentum | MFI | Strong Bullish/Bearish Momentum | |
| 60 | Trend | ADX | Strong Trend | Fixed: base now 60 (was 50), dynamic 60-90 |
| 60 | Volatility | Bollinger | Upper Band Walk | |
| 55-59 | **Moderate-Low State** |
| 55 | Trend | Ichimoku | Bullish/Bearish Ichimoku | |
| 55 | Support/Resistance | Fibonacci | Healthy Retracement Zone | |
| 55 | Momentum | Pattern | Doji | |
| 50-54 | **Low-Moderate State** |
| 50 | Momentum | CCI | Overbought State | |
| 50 | Momentum | CMO | Overbought | |
| 50 | Volume | MFI | Overbought | |
| 50 | Volume | CMF | Positive CMF | |
| 50 | Trend | PSAR | Uptrending/Downtrending | |
| 50 | Momentum | Awesome Oscillator | Consecutive Green/Red | |
| 50 | Pattern | Chart Pattern | Bullish/Bearish Pattern Bias | |
| 45-49 | **Low State** |
| 45 | Support/Resistance | Support/Resistance | High Level Density | |
| 45 | Momentum | Awesome Oscillator | Strong Bullish Momentum | |
| 45 | Momentum | Pattern | Hammer / Shooting Star | Consider reducing to 70 |
| 45 | Trend | WMA | Price Above/Below WMA | |
| 45 | Trend | EMA | Bullish EMA Alignment | Dynamic |
| 45 | Volume | OBV | OBV Falling / Rising | |
| 45 | Volatility | Keltner/Donchian | Narrow Channel/Range | |
| 45 | Pattern | Chart Pattern | Pattern Developing | |
| 40-44 | **Low State** |
| 40 | Support/Resistance | Support/Resistance | Upper/Lower Range | |
| 40 | Support/Resistance | Fibonacci | Shallow/Deep Retracement | Fixed: was 40, now 50 |
| 40 | Pivot | Pivot Points | Upper/Lower Pivot Range / High Density | |
| 40 | Trend | Ichimoku | Price In Kumo | |
| 40 | Trend | MA200 | Price Above MA200 | |
| 40 | Trend | ADX | Bullish/Bearish Directional Movement / Weak Trend | |
| 40 | Trend | MACD | MACD Above Signal | |
| 40 | Trend | EMA | Price Above EMA | Dynamic |
| 40 | Volume | ADL | ADL Above SMA | |
| 40 | Volume | CMF | Rising CMF | |
| 40 | Momentum | CMO | Rising CMO / Bullish Zone | |
| 40 | Momentum | ROC | Accelerating | |
| 35-39 | **Very Low State** |
| 35 | Support/Resistance | Support/Resistance | Moderate Level Density / Middle Range | |
| 35 | Trend | MACD | MACD Above Zero / Below Signal | |
| 35 | Trend | EMA | Price Below EMA | Dynamic |
| 35 | Pattern | Candlestick | Bullish/Bearish Momentum / Long Shadows | |
| 35 | Volume | CMF | Strong Negative/Positive CMF | |
| 35 | Volume | OBV | OBV Above SMA | |
| 35 | Momentum | Awesome Oscillator | Rising AO | |
| 35 | Momentum | CMO | Oversold | |
| 35 | Volume | MFI | High MFI / Oversold | |
| 35 | Volume | ADL | ADL Rising | |
| 35 | Volatility | Keltner/Donchian | Wide Channel/Range | |
| 35 | Pattern | Chart Pattern | Neutral Pattern Mix | |
| 30-34 | **Minimal State** |
| 30 | Support/Resistance | Support/Resistance | Middle Range | |
| 30 | Pivot | Pivot Points | Middle Pivot Range / Moderate Density | |
| 30 | Trend | MACD | MACD Below Zero / Positive Histogram | |
| 30 | Momentum | ROC | Positive/Negative Momentum | |
| 30 | Momentum | CCI | Oversold State | |
| 30 | Volatility | TTM Squeeze | Neutral Momentum | |
| 25-29 | **Very Minimal / No Signal** |
| 25 | Support/Resistance | Support/Resistance | Low Level Density / Near Support/Resistance | |
| 25 | Pivot | Pivot Points | Low Pivot Density | |
| 25 | Momentum | Divergence (Helper) | Bearish/Bullish Divergence (SR helper) | Base contribution only |
| 25 | Momentum | CMO | Neutral Zone | |
| 25 | Volume | CMF | Neutral CMF | |
| 25 | Volume | MFI | Neutral MFI | |
| 25 | Volatility | TTM Squeeze | No Squeeze | |
| 25 | Pattern | Candlestick | Indecision | |
| 25 | Pattern | Chart Pattern | Pattern Weakening | |
| 20-24 | **No Data / Fallback** |
| 20 | Pivot | Pivot Points | No Pivot Data | Fallback |
| 20 | Volume | Volume | Low Volume | |
| 20 | Pattern | Chart Pattern | No Clear Pattern | |
| 0 | **Neutral / No Signal** |
| 0 | Various | Various | Neutral/No Signal states | Some indicators use 0 |

---

## Summary of Changes Implemented

### ✅ Priority 1 Fixes (Critical Inconsistencies)
1. **Volume Divergences**: 85 → 90 (standardized with other divergences)
2. **Breakout Strengths**: 
   - Keltner: 80 → 90
   - Donchian: 85 → 90
   - (Support/Resistance & Pivot already at 90)
3. **Pivot "At Pivot Point"**: 60 → 70 (consistent with Support/Resistance "At" signals)

### ✅ Priority 2 Fixes (Important Adjustments)
4. **Support/Resistance Touch**: 85 → 90 (more distinction from "At" signals)
5. **Fibonacci Shallow/Deep Retracement**: 40 → 50
6. **ADX Strong Trend Base**: 50 → 60 (now 60-90 dynamic range)

---

## Strength Allocation Principles

### Tier 1: Critical Events (90-95)
- Divergences (regular)
- Major breakouts/breakdowns
- Touch events at key levels
- TTM Squeeze releases (regime-adjusted)

### Tier 2: Strong Events (85-89)
- Hidden divergences
- Failure swings
- Bounce/rejection events
- Golden Ratio Fibonacci levels

### Tier 3: Major Crosses (80-84)
- MACD/EMA crosses
- Pivot crosses
- MA200 crosses
- Pattern breakouts

### Tier 4: Moderate Events (70-79)
- Oscillator entries/exits
- Proximity signals ("At" levels)
- Middle band crosses
- Moderate pattern formations

### Tier 5: State Signals (50-69)
- Position-based signals
- Trend strength indicators
- Moderate volatility states
- General momentum

### Tier 6: Low State (35-49)
- Range position signals
- Weak confirmations
- Developing patterns
- Neutral states

### Tier 7: Minimal/No Signal (0-34)
- Very weak confirmations
- No data fallbacks
- Neutral/indecision states

---

## Notes

1. **Dynamic Strengths**: Some signals calculate strength dynamically based on distance/ratio:
   - EMA/MACD: Based on distance from level
   - Volume: Based on volume ratio (60-90 range)
   - ADX: Based on ADX value (60-90 range)
   - ROC: Based on ROC value (45-80 range)

2. **Regime Adjustments**: Many signals use `applyRegimeAdjustment()` which can modify base strength by ±5 points based on market regime alignment

3. **Priority Field**: Signals also have a `priority` field (1-10) which affects combination logic separately from strength

4. **Event vs State**: Signals are marked as `isEvent: true/false` which affects how they're combined

---

*Total Signals: 200+ unique signal values across 34+ signal types*

