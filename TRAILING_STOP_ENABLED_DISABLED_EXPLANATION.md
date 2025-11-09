# What Determines If Trailing Stop Is Disabled?

## Quick Answer

Trailing stop is **enabled by default** unless the strategy (BacktestCombination) explicitly has `enableTrailingTakeProfit: false`.

---

## The Decision Logic

### When Opening a Position (Line 7291 in PositionManager.jsx)

```javascript
enableTrailingTakeProfit: (combination?.enableTrailingTakeProfit !== false)
```

**This means:**
- ✅ **Enabled** if `combination.enableTrailingTakeProfit` is:
  - `true`
  - `undefined` (not set)
  - `null`
  - Any value except `false`
  
- ❌ **Disabled** if `combination.enableTrailingTakeProfit` is:
  - Explicitly `false`

**Default Behavior**: Trailing stop is **enabled by default** unless explicitly disabled.

---

## Where `enableTrailingTakeProfit` Is Set

### 1. **Strategy Creation (BacktestCombination)**

#### A. From Backtesting Page (`Backtesting.jsx` line 1062)
```javascript
enableTrailingTakeProfit: false,  // ❌ DISABLED by default
```
**When**: Strategies saved directly from backtesting results
**Default**: **Disabled** (`false`)

#### B. From Save Combinations Button (`SaveCombinationsButton.jsx` line 547)
```javascript
enableTrailingTakeProfit: true,  // ✅ ENABLED by default
```
**When**: Strategies saved from the "Save Top Performers" dialog
**Default**: **Enabled** (`true`)

### 2. **User Can Edit It**

#### Edit Strategy Dialog (`EditStrategyDialog.jsx`)
- Users can enable/disable trailing stop per strategy
- Checkbox: "Enable Trailing Take Profit"
- Saved to database when strategy is updated

**Location**: 
- Stats page → Click on strategy → Edit button
- Or Backtest Database page → Edit strategy

---

## How to Check Current Status

### For a Position:
1. Check the position's `enableTrailingTakeProfit` field
2. If `false` → Trailing is disabled
3. If `true` or `undefined` → Trailing is enabled

### For a Strategy:
1. Check the `BacktestCombination.enableTrailingTakeProfit` field in database
2. Query: `SELECT enable_trailing_take_profit FROM backtest_combinations WHERE id = '...'`

---

## Why Positions Show "🚫 Disabled"

A position shows `[TRAILING] 🚫 Disabled for ARB/USDT` when:

1. **The strategy that opened it has `enableTrailingTakeProfit: false`**
   - Most likely: Strategy was saved from Backtesting page (defaults to `false`)
   - Or: User manually disabled it in Edit Strategy Dialog

2. **The position was created before trailing stop feature was added**
   - Old positions may have `undefined` or `null` → defaults to enabled
   - But if strategy has `false`, it will be disabled

3. **The position was manually created without trailing stop**
   - Some manual position creation paths set `enableTrailingTakeProfit: false`

---

## How to Enable Trailing Stop

### Option 1: Edit the Strategy (Recommended)
1. Go to **Stats** page or **Backtest Database** page
2. Find the strategy that opened the position
3. Click **Edit** button
4. Check the **"Enable Trailing Take Profit"** checkbox
5. Click **Save**

**Result**: All **new positions** opened by this strategy will have trailing stop enabled.

**Note**: This won't affect existing positions - only new ones opened after the change.

### Option 2: Update Existing Position (Manual)
1. Find the position in the database
2. Update `enable_trailing_take_profit = true` in `live_positions` table
3. Or use the API: `PUT /api/entities/LivePosition/{id}` with `enableTrailingTakeProfit: true`

---

## Code Flow

```
1. Strategy Created/Updated
   ↓
   BacktestCombination.enableTrailingTakeProfit stored in database
   ↓
2. Position Opened
   ↓
   PositionManager._executeBinanceMarketBuyOrder()
   ↓
   enableTrailingTakeProfit: (combination?.enableTrailingTakeProfit !== false)
   ↓
3. Position Monitoring
   ↓
   _updateTrailingStopAndPriceTracking()
   ↓
   if (!updatedPosition.enableTrailingTakeProfit) {
       log: "🚫 Disabled for {symbol}"
   }
```

---

## Summary Table

| Source | Default Value | Can User Change? |
|--------|---------------|------------------|
| **Backtesting Page** (direct save) | `false` (disabled) | ✅ Yes (Edit Strategy) |
| **Save Combinations Button** | `true` (enabled) | ✅ Yes (Edit Strategy) |
| **Edit Strategy Dialog** | User's choice | ✅ Yes |
| **Position Creation Logic** | `(combination?.enableTrailingTakeProfit !== false)` | ❌ No (inherits from strategy) |

---

## Key Takeaway

**Trailing stop is controlled by the strategy (BacktestCombination), not the position.**

- Each strategy has an `enableTrailingTakeProfit` field
- When a position is opened, it inherits this setting from the strategy
- To enable trailing stop for future positions, edit the strategy
- The default is **enabled** unless the strategy explicitly sets it to `false`

---

## Common Scenarios

### Scenario 1: All Positions Show "🚫 Disabled"
**Cause**: Strategies were saved from Backtesting page (defaults to `false`)
**Solution**: Edit each strategy and enable trailing stop, OR change the default in `Backtesting.jsx` line 1062

### Scenario 2: Some Positions Enabled, Some Disabled
**Cause**: Different strategies have different settings
**Solution**: Check which strategy opened each position, edit strategies individually

### Scenario 3: New Positions Still Disabled After Enabling Strategy
**Cause**: Strategy wasn't saved properly, or position was opened before strategy update
**Solution**: Verify strategy has `enableTrailingTakeProfit: true` in database, then open new position

