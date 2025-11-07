# Realized P&L Calculation and Score Explanation

## Overview

The **Realized P&L** component in the Leading Performance Momentum (LPM) system measures the performance of your recently closed trades. It provides a forward-looking indicator of trading system health by analyzing the last 100 closed trades with recency weighting.

## Calculation Details

### 1. Data Source

- **Trades Analyzed**: Last 100 closed trades (trades with `exit_timestamp`)
- **Trading Mode Filter**: Only includes trades matching the current trading mode (testnet/live)
- **Required Fields**: 
  - `exit_timestamp` (must exist - trade must be closed)
  - `entry_value_usdt` (must be > 0 for percentage calculation)
  - `pnl_usdt` (realized profit/loss in USDT)
  - `pnl_percentage` (percentage gain/loss per trade)

### 2. Realized P&L Percentage Calculation

The percentage shown (e.g., `+1.2%`) is calculated as:

```
Realized P&L % = (Total Realized P&L / Total Entry Value) × 100
```

Where:
- **Total Realized P&L** = Sum of `pnl_usdt` from last 100 closed trades
- **Total Entry Value** = Sum of `entry_value_usdt` from those same trades

**Example:**
- Last 100 trades had total entry value of $5,000
- Total realized P&L = $60
- Realized P&L % = ($60 / $5,000) × 100 = **+1.2%**

This represents the **ROI (Return on Investment)** for the capital deployed in those 100 trades.

### 3. Score Calculation (0-100)

The score is calculated using a **weighted average** with **recency weighting**:

#### Step 1: Recency Weighting
More recent trades have higher weight. The weight decays exponentially over 24 hours:

```
recencyWeight = e^(-ageHours / 24)
```

Where `ageHours` is the time since the trade was closed.

#### Step 2: Weighted Average P&L Percentage
```
weightedAvgPnl = Σ(pnl_percentage × recencyWeight) / number_of_trades
```

#### Step 3: Win Rate Bonus
```
winRate = (winning_trades / total_trades) × 100
winRateBonus = (winRate - 50) × 0.2
```

#### Step 4: Final Score
```
pnlScore = 50 + (weightedAvgPnl × 4.0 × tradeCountFactor)
finalScore = pnlScore + winRateBonus
```

Where:
- `tradeCountFactor = min(1.0, tradeCount / 20)` - Normalizes by trade count
- Score is clamped between 0 and 100

**Score Interpretation:**
- **50**: Neutral (break-even performance)
- **> 50**: Positive momentum (profitable recent trades)
- **< 50**: Negative momentum (losing recent trades)
- **70+**: Strong positive momentum
- **30-**: Strong negative momentum

### 4. Weight in Final LPM Score

The Realized P&L component has a **23% weight** in the overall Leading Performance Momentum score, making it equal in importance to Unrealized P&L.

## Display Format

The widget displays:
- **Value**: `$0.66 (+1.2%)`
  - `$0.66` = Total realized P&L from last 100 closed trades
  - `+1.2%` = ROI percentage on capital deployed
- **Score**: `50 (23%)`
  - `50` = Calculated score (0-100)
  - `23%` = Weight in final LPM score

## Why This Matters

1. **Forward-Looking**: Recent performance is more predictive than old performance
2. **Recency Weighting**: Trades closed yesterday matter more than trades closed last month
3. **Win Rate Consideration**: Not just profit amount, but consistency (win rate) matters
4. **Capital Efficiency**: Shows ROI on actual capital deployed, not just absolute profit

## Example Scenarios

### Scenario 1: Strong Recent Performance
- Last 100 trades: $5,000 entry value, $100 profit (+2.0%)
- Recent trades (last 24h): Higher weight, mostly winners
- **Result**: Score ~65-75, showing strong positive momentum

### Scenario 2: Mixed Performance
- Last 100 trades: $5,000 entry value, $30 profit (+0.6%)
- Recent trades: Mix of winners and losers
- **Result**: Score ~50-55, showing neutral momentum

### Scenario 3: Poor Recent Performance
- Last 100 trades: $5,000 entry value, -$50 loss (-1.0%)
- Recent trades: Mostly losers
- **Result**: Score ~35-45, showing negative momentum

## Technical Notes

- **Minimum Trades**: Requires at least 5 closed trades to calculate score
- **Trade Count Normalization**: Scores are normalized by trade count to prevent bias from small sample sizes
- **Conservative Scaling**: Uses a scaling factor of 4.0 (reduced from 8.0) for more stable results
- **Data Freshness**: Only includes trades with valid `exit_timestamp` and `entry_value_usdt`

## Related Components

- **Unrealized P&L**: Measures current open positions (23% weight)
- **Market Regime**: Current market trend (15% weight)
- **Signal Quality**: Average strength of signals found (4% weight)
- **Final LPM Score**: Weighted combination of all components

