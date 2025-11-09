# Unrealized P&L Logic and LPM Impact Explanation

## Overview

The **Unrealized P&L** component measures the current profit/loss of your open positions. It's a key indicator of how well your active trades are performing and has a **30% weight** in the overall LPM (Leading Performance Momentum) score.

## What It Checks

### 1. **Position Selection**
- **Scope**: Only analyzes the **last 100 open positions** (most recent by entry timestamp)
- **Status Filter**: Only includes positions with status `'open'` or `'trailing'`
- **Purpose**: Matches the approach used for realized P&L (last 100 closed trades) for consistency

### 2. **Price Availability**
- **Requirement**: Each position must have a valid current price
- **Source**: Fetches prices from:
  - `state.currentPrices` (if available)
  - `scannerService.currentPrices` (fallback)
  - Batch price fetching via `PriceCacheService` for missing prices
- **Validation**: Price must be a positive number
- **Exclusion**: Positions without valid prices are excluded from calculation

### 3. **P&L Calculation Per Position**

For each position with a valid price:

```javascript
// For LONG positions:
unrealizedPnlUSDT = (currentPrice - entryPrice) × quantityCrypto

// For SHORT positions:
unrealizedPnlUSDT = (entryPrice - currentPrice) × quantityCrypto
```

**Example:**
- **LONG Position**: BTC/USDT
  - Entry Price: $50,000
  - Current Price: $52,000
  - Quantity: 0.1 BTC
  - Unrealized P&L = ($52,000 - $50,000) × 0.1 = **+$200**

- **SHORT Position**: ETH/USDT
  - Entry Price: $3,000
  - Current Price: $2,900
  - Quantity: 1.0 ETH
  - Unrealized P&L = ($3,000 - $2,900) × 1.0 = **+$100**

## How It Calculates the Component Score (0-100)

### Step 1: Aggregate Portfolio P&L

```javascript
totalUnrealizedPnlUSDT = Sum of all position unrealized P&L
totalInvestedCapital = Sum of all position entry_value_usdt
portfolioPnlPercent = (totalUnrealizedPnlUSDT / totalInvestedCapital) × 100
```

**What is Total Invested Capital?**

`totalInvestedCapital` is the **sum of `entry_value_usdt`** for all positions being analyzed.

**What is `entry_value_usdt`?**

For each position, `entry_value_usdt` represents the **USDT value of the position when it was opened**:

```javascript
entry_value_usdt = entry_price × quantity_crypto
```

**In simple terms:**
- **Total Invested Capital** = The total amount of USDT you initially invested in all open positions
- It's the sum of what each position was worth at entry time
- This is your "cost basis" or "principal" for calculating ROI

**Example:**
- Position 1: BTC/USDT - Entry: $50,000 × 0.1 BTC = **$5,000** `entry_value_usdt`
- Position 2: ETH/USDT - Entry: $3,000 × 1.0 ETH = **$3,000** `entry_value_usdt`
- Position 3: SOL/USDT - Entry: $100 × 20 SOL = **$2,000** `entry_value_usdt`
- **Total Invested Capital** = $5,000 + $3,000 + $2,000 = **$10,000**

**Portfolio P&L Calculation Example:**
- Total Unrealized P&L: +$500
- Total Invested Capital: $10,000
- Portfolio P&L % = ($500 / $10,000) × 100 = **+5%**

This means your open positions are currently showing a **5% profit** on your initial investment.

### Step 2: Apply Logarithmic Scaling

To prevent extreme values from causing wild swings:

```javascript
if (portfolioPnlPercent > 0) {
    logScaledPnl = log(1 + |portfolioPnlPercent|) × sign(portfolioPnlPercent)
} else {
    logScaledPnl = portfolioPnlPercent  // No log scaling for negative values
}
```

**Why?** Logarithmic scaling makes the score more stable:
- +10% → log(11) × 1 = **2.40**
- +20% → log(21) × 1 = **3.04** (not 2× the impact)
- +50% → log(51) × 1 = **3.93** (not 5× the impact)

### Step 3: Position Count Normalization

```javascript
positionCountFactor = min(1.0, positionsWithPrice / 3)
```

**Purpose**: Normalizes the impact based on how many positions are being analyzed:
- **1 position**: factor = 0.33 (reduced impact)
- **2 positions**: factor = 0.67 (moderate impact)
- **3+ positions**: factor = 1.0 (full impact)

**Why?** A single position's P&L shouldn't have the same weight as a portfolio of 10 positions.

### Step 4: Calculate Final Component Score

```javascript
unrealizedComponent = clamp(0, 100, 
    50 + (logScaledPnl × 5.0 × positionCountFactor)
)
```

**Base Score**: 50 (neutral)
**Scaling Factor**: 5.0 (conservative, reduced from 10.0 for stability)
**Range**: Clamped between 0 and 100

## Impact on LPM Score

The unrealized component contributes **30%** to the overall LPM score:

```javascript
LPM_Contribution = unrealizedComponent × 0.30
```

## Examples

### Example 1: Small Profit (3 positions)

**Scenario:**
- 3 open positions
- Total Unrealized P&L: +$150
- Total Invested Capital: $3,000
- Portfolio P&L %: +5%

**Calculation:**
1. `portfolioPnlPercent = +5%`
2. `logScaledPnl = log(1 + 5) × 1 = log(6) = 1.79`
3. `positionCountFactor = min(1.0, 3/3) = 1.0`
4. `unrealizedComponent = 50 + (1.79 × 5.0 × 1.0) = 50 + 8.95 = 58.95 ≈ 59`
5. **LPM Contribution = 59 × 0.30 = 17.7 points**

**Impact**: Small profit increases LPM by ~9 points from the unrealized component.

---

### Example 2: Moderate Loss (5 positions)

**Scenario:**
- 5 open positions
- Total Unrealized P&L: -$200
- Total Invested Capital: $4,000
- Portfolio P&L %: -5%

**Calculation:**
1. `portfolioPnlPercent = -5%`
2. `logScaledPnl = -5%` (no log scaling for negative)
3. `positionCountFactor = min(1.0, 5/3) = 1.0`
4. `unrealizedComponent = 50 + (-5 × 5.0 × 1.0) = 50 - 25 = 25`
5. **LPM Contribution = 25 × 0.30 = 7.5 points**

**Impact**: Moderate loss reduces LPM by ~22.5 points from the unrealized component (from 50 to 25).

---

### Example 3: Large Profit (10 positions)

**Scenario:**
- 10 open positions
- Total Unrealized P&L: +$1,000
- Total Invested Capital: $5,000
- Portfolio P&L %: +20%

**Calculation:**
1. `portfolioPnlPercent = +20%`
2. `logScaledPnl = log(1 + 20) × 1 = log(21) = 3.04`
3. `positionCountFactor = min(1.0, 10/3) = 1.0`
4. `unrealizedComponent = 50 + (3.04 × 5.0 × 1.0) = 50 + 15.2 = 65.2 ≈ 65`
5. **LPM Contribution = 65 × 0.30 = 19.5 points**

**Impact**: Large profit increases LPM by ~15 points from the unrealized component.

---

### Example 4: Single Position (Limited Impact)

**Scenario:**
- 1 open position
- Total Unrealized P&L: +$100
- Total Invested Capital: $1,000
- Portfolio P&L %: +10%

**Calculation:**
1. `portfolioPnlPercent = +10%`
2. `logScaledPnl = log(1 + 10) × 1 = log(11) = 2.40`
3. `positionCountFactor = min(1.0, 1/3) = 0.33` ⚠️ **Reduced impact**
4. `unrealizedComponent = 50 + (2.40 × 5.0 × 0.33) = 50 + 3.96 = 53.96 ≈ 54`
5. **LPM Contribution = 54 × 0.30 = 16.2 points**

**Impact**: Single position has reduced impact (factor 0.33) to prevent one trade from dominating the score.

---

### Example 5: Severe Loss (8 positions)

**Scenario:**
- 8 open positions
- Total Unrealized P&L: -$800
- Total Invested Capital: $4,000
- Portfolio P&L %: -20%

**Calculation:**
1. `portfolioPnlPercent = -20%`
2. `logScaledPnl = -20%` (no log scaling for negative)
3. `positionCountFactor = min(1.0, 8/3) = 1.0`
4. `unrealizedComponent = 50 + (-20 × 5.0 × 1.0) = 50 - 100 = 0` (clamped)
5. **LPM Contribution = 0 × 0.30 = 0 points**

**Impact**: Severe loss reduces unrealized component to minimum (0), reducing LPM by 15 points from this component alone.

---

## Key Characteristics

### 1. **Asymmetric Scaling**
- **Positive P&L**: Uses logarithmic scaling (diminishing returns)
- **Negative P&L**: Linear scaling (full impact of losses)

**Why?** Losses should have immediate, full impact, while profits are scaled to prevent over-optimism.

### 2. **Position Count Normalization**
- Fewer positions (< 3) have reduced impact
- More positions (≥ 3) have full impact
- Prevents single positions from dominating the score

### 3. **Conservative Scaling Factor (5.0)**
- Reduced from 10.0 for stability
- Prevents wild swings in LPM score
- A 10% portfolio gain increases component by ~15 points (not 50)

### 4. **Last 100 Positions Only**
- Matches realized P&L approach (last 100 closed trades)
- Focuses on recent performance
- Prevents old positions from skewing results

## Impact Summary Table

| Portfolio P&L % | Positions | Component Score | LPM Contribution (30%) |
|----------------|------------|------------------|------------------------|
| +20% | 10 | 65 | +19.5 points |
| +10% | 5 | 62 | +18.6 points |
| +5% | 3 | 59 | +17.7 points |
| 0% | Any | 50 | +15.0 points (neutral) |
| -5% | 5 | 25 | +7.5 points |
| -10% | 5 | 0 | +0.0 points (minimum) |
| -20% | 8 | 0 | +0.0 points (minimum) |

## Relationship to Other LPM Components

The unrealized P&L component (30% weight) works alongside:
- **Realized P&L** (40% weight) - Past performance
- **Volatility** (10% weight) - Market conditions
- **Fear & Greed** (10% weight) - Market sentiment
- **Signal Quality** (10% weight) - Strategy strength

**Total**: 100% of LPM score

## Practical Implications

1. **High Unrealized Profit** → Higher LPM → More aggressive position sizing (higher EBR)
2. **High Unrealized Loss** → Lower LPM → More conservative position sizing (lower EBR)
3. **Few Positions** → Reduced impact (normalization factor)
4. **Many Positions** → Full impact (full normalization factor)

The system balances current performance (unrealized) with historical performance (realized) to determine overall trading momentum.

