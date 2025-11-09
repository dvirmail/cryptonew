# Trailing Stop Logs Explanation

## Overview
The trailing stop system protects profits by automatically moving the stop loss price upward as the position price increases. The logs show the system checking each position during monitoring cycles.

## Log Types Explained

### 1. `⏳ Not activated for THETA/USDT: profit=0.00% < threshold=2.01% (TP%=4.02%)`

**Meaning**: The trailing stop is **not yet activated** because the position hasn't reached the activation threshold.

**How it works**:
- **Current Profit**: `0.00%` - The position is currently at break-even or in a small loss
- **Activation Threshold**: `2.01%` - This is **50% of the Take Profit target** (4.02% × 0.5 = 2.01%)
- **Take Profit (TP%)**: `4.02%` - The target profit percentage for this position

**Activation Rule**:
```javascript
activationThreshold = takeProfitPercent × 0.5  // 50% of TP target
shouldActivate = profitPercent >= activationThreshold
```

**Example**:
- If TP is 4.02%, activation threshold is 2.01%
- Position needs to be **at least 2.01% in profit** before trailing activates
- Currently at 0.00%, so it's waiting for more profit

**Why repeated?**: This log appears multiple times because the system checks the position during each monitoring cycle (every few seconds). The position hasn't moved enough to activate trailing yet.

---

### 2. `🚫 Disabled for ARB/USDT`

**Meaning**: Trailing stop is **disabled** for this position.

**Possible reasons**:
1. **`enableTrailingTakeProfit = false`** - Trailing stop feature is not enabled for this position
2. Position was created without trailing stop enabled
3. User settings disabled trailing stops globally

**What happens**: The system will **not** activate or update trailing stops for this position, even if it becomes profitable.

**Note**: You also see `[MONITOR] ⏰ TIME EXIT for ARBUSDT` - This position was closed due to time limit (0.96h elapsed, limit: 0.95h), not trailing stop.

---

## Trailing Stop Activation Logic

### Step 1: Check Activation Threshold
```javascript
profitPercent = ((currentPrice - entryPrice) / entryPrice) × 100
takeProfitPercent = ((takeProfitPrice - entryPrice) / entryPrice) × 100
activationThreshold = takeProfitPercent × 0.5  // 50% of TP
```

### Step 2: Activate When Threshold Reached
- When `profitPercent >= activationThreshold`:
  - ✅ Trailing stop activates
  - Sets `trailing_stop_price = currentPrice × (1 - 0.02)` (2% below current)
  - Sets `is_trailing = true`
  - Sets `status = 'trailing'`

### Step 3: Update as Price Rises
- As price increases, `trailing_peak_price` is updated
- Trailing stop moves up: `trailing_stop_price = peak_price × (1 - 0.02)`
- Trailing stop **only moves up**, never down

### Step 4: Trigger on Price Drop
- If `currentPrice <= trailing_stop_price`, position is closed

---

## Example Scenarios

### Scenario 1: THETA/USDT (Not Activated)
```
Entry Price: $0.483
Current Price: $0.483 (0.00% profit)
Take Profit: $0.503 (4.02% profit)
Activation Threshold: 2.01% profit = $0.493

Status: ⏳ Waiting for price to reach $0.493 (2.01% profit)
```

### Scenario 2: Position with Trailing Enabled
```
Entry Price: $10.00
Current Price: $10.30 (3.00% profit)
Take Profit: $10.50 (5.00% profit)
Activation Threshold: 2.50% profit = $10.25

Status: ✅ Trailing activated at $10.30
Trailing Stop: $10.30 × 0.98 = $10.09 (2% below peak)
```

### Scenario 3: Trailing Stop Moving Up
```
Peak Price: $10.50
Trailing Stop: $10.29 (2% below peak)

Price drops to $10.30: Still safe (above trailing stop)
Price drops to $10.28: 🎯 Trailing stop triggered! Position closed
```

---

## Why Multiple Logs?

The logs appear multiple times because:
1. **Monitoring Frequency**: The system checks positions every few seconds during scan cycles
2. **No State Change**: If the position hasn't changed (still at 0.00% profit), the same log repeats
3. **Normal Behavior**: This is expected - the system continuously monitors all positions

---

## Summary

| Log | Meaning | Action Needed |
|-----|---------|---------------|
| `⏳ Not activated` | Waiting for profit to reach 50% of TP target | None - system is working correctly |
| `🚫 Disabled` | Trailing stop is turned off for this position | Enable trailing stop if desired |
| `✅ Activated` | Trailing stop is now active and protecting profits | None - system is working correctly |
| `📈 Updated` | Trailing stop moved up as price increased | None - system is working correctly |
| `🎯 Triggered` | Price dropped below trailing stop - position closed | None - system executed correctly |

---

## Configuration

The trailing stop behavior is controlled by:
- **`enableTrailingTakeProfit`**: Enable/disable trailing stop per position
- **`take_profit_price`**: Determines the activation threshold (50% of TP)
- **Trailing Buffer**: Fixed at 2% (hardcoded in `_updateTrailingStopAndPriceTracking`)

To change the activation threshold, modify line 4713 in `PositionManager.jsx`:
```javascript
const activationThreshold = (takeProfitPercent * 0.5); // Change 0.5 to adjust threshold
```

