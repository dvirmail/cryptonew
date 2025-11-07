# Opportunity Rate Calculation and LPM Contribution

## Overview

The **Opportunity Rate** component in the Leading Performance Momentum (LPM) system measures the rate at which your trading system is finding new trading opportunities. It indicates how "target-rich" the current market environment is for your strategies.

## Calculation Method

### Data Source

- **Source**: `signalGenerationHistory` - A rolling history of scan cycles
- **Metric Tracked**: `signalsFound` (now represents all strategies evaluated, not just executed trades)
- **History Length**: Last 5 scan cycles (or fewer if less history available)

### Calculation Formula

#### Case 1: More than 5 cycles of history
```javascript
// Average signals from last 5 cycles
const recentSlice = history.slice(-5);
const totalRecentSignals = recentSlice.reduce((sum, s) => sum + (s.signalsFound || 0), 0);
const avgRecentSignals = totalRecentSignals / recentSlice.length;

// Score calculation: Multiply by 5, cap at 100
opportunityRateComponent = Math.min(100, avgRecentSignals * 5);
```

#### Case 2: Less than 5 cycles of history
```javascript
// Use most recent cycle only
opportunityRateComponent = Math.min(100, history[history.length - 1].signalsFound * 5);
```

#### Case 3: No history available
```javascript
// Default to neutral score
opportunityRateComponent = 50;
```

### Score Interpretation

- **Score Range**: 0-100
- **50**: Neutral (baseline)
- **> 50**: Above-average opportunity rate (more signals being found)
- **< 50**: Below-average opportunity rate (fewer signals)
- **100**: Maximum (20+ signals per cycle on average)

### Scaling Factor

The **multiplier of 5** means:
- **10 signals/cycle** → Score: 50 (neutral)
- **20 signals/cycle** → Score: 100 (maximum)
- **5 signals/cycle** → Score: 25 (low)
- **0 signals/cycle** → Score: 0 (very low)

**Formula**: `Score = min(100, signalsPerCycle × 5)`

## Contribution to LPM

### Weight: 15%

The Opportunity Rate contributes **15%** to the final Leading Performance Momentum score.

**Current Configuration** (from `momentumWeights.js`):
```javascript
opportunityRate: 0.15  // 15% weight
```

### Impact on Final Score

**Example Calculation**:
- Opportunity Rate Score: 50
- Weight: 0.15 (15%)
- Contribution to LPM: `50 × 0.15 = 7.5 points`

If Opportunity Rate were 100 (maximum):
- Contribution: `100 × 0.15 = 15 points`

If Opportunity Rate were 0:
- Contribution: `0 × 0.15 = 0 points`

### Weight Comparison

| Component | Weight | Contribution at Score 50 |
|-----------|--------|-------------------------|
| Unrealized P&L | 23% | 11.5 points |
| Realized P&L | 23% | 11.5 points |
| Market Regime | 15% | 7.5 points |
| **Opportunity Rate** | **15%** | **7.5 points** |
| Market Volatility | 10% | 5.0 points |
| Fear & Greed | 10% | 5.0 points |
| Signal Quality | 4% | 2.0 points |

## Why It Matters

1. **Market Environment Indicator**: High opportunity rate = many strategies finding signals = favorable trading conditions
2. **System Health**: Low opportunity rate might indicate:
   - Market conditions not matching strategy criteria
   - Strategies too restrictive
   - Market regime changes affecting signal generation
3. **Forward-Looking**: Unlike P&L (past performance), this indicates current/future potential

## Current Issue (Being Fixed)

**Problem**: Showing "0 recent signals" even though hundreds of strategies are being evaluated.

**Root Cause**: 
- `signalGenerationHistory` was tracking only executed trades (`signalsFound`)
- Should track all evaluated strategies (`strategiesEvaluated`)

**Fix Applied**:
- `combinationsMatched` now set to `strategiesEvaluated`
- `signalGenerationHistory` now tracks all evaluated strategies
- After next scan cycle, should show actual evaluated count (e.g., "719 recent signals")

## Example Scenarios

### Scenario 1: High Opportunity Rate
- Last 5 cycles: 20, 18, 22, 19, 21 signals
- Average: 20 signals/cycle
- **Score**: `20 × 5 = 100` (maximum)
- **LPM Contribution**: `100 × 0.15 = 15 points`

### Scenario 2: Moderate Opportunity Rate
- Last 5 cycles: 10, 12, 8, 11, 9 signals
- Average: 10 signals/cycle
- **Score**: `10 × 5 = 50` (neutral)
- **LPM Contribution**: `50 × 0.15 = 7.5 points`

### Scenario 3: Low Opportunity Rate
- Last 5 cycles: 2, 3, 1, 2, 1 signals
- Average: 1.8 signals/cycle
- **Score**: `1.8 × 5 = 9` (low)
- **LPM Contribution**: `9 × 0.15 = 1.35 points`

## Technical Details

### Update Frequency
- Calculated every 30 seconds (as part of `calculatePerformanceMomentum()`)
- Uses rolling window of last 5 scan cycles
- Automatically updates as new cycles complete

### Data Persistence
- `signalGenerationHistory` stored in scanner state
- Maximum history: 50 cycles (configurable via `SCANNER_DEFAULTS.maxSignalHistory`)
- Oldest entries automatically removed when limit reached

### Display Format
- **Score**: 0-100 (shown as integer)
- **Weight**: 15% (shown in UI)
- **Details**: "N recent signals" (where N is the most recent cycle's signal count)

## Relationship to Other Components

- **Signal Quality**: Both measure signal-related metrics, but:
  - **Opportunity Rate**: Quantity of signals (how many)
  - **Signal Quality**: Strength of signals (how strong)
- **Market Regime**: High opportunity rate often correlates with favorable market regimes
- **Unrealized P&L**: More opportunities can lead to more positions, affecting unrealized P&L

## Optimization Tips

1. **Monitor Trends**: Watch if opportunity rate is increasing/decreasing over time
2. **Regime Correlation**: Check if opportunity rate drops during certain market regimes
3. **Strategy Tuning**: If consistently low, consider adjusting strategy parameters
4. **Market Conditions**: High opportunity rate + high signal quality = ideal trading conditions

