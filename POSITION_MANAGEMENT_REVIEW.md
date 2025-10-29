# Position Management System - Comprehensive Review

## 📊 Database Schema

### `live_positions` Table
Stores all open positions with comprehensive analytics data:

**Core Fields:**
- `id` (UUID): Primary key, database record ID
- `position_id` (VARCHAR): Application-generated position ID (e.g., `pos_1761737107392_ybgga658f`)
- `symbol` (VARCHAR): Trading pair (e.g., `XRP/USDT`)
- `side` (VARCHAR): BUY/SELL
- `direction` (VARCHAR): long/short
- `quantity` / `quantity_crypto` (NUMERIC): Position size in crypto units
- `entry_price` (NUMERIC): Entry price
- `current_price` (NUMERIC): Latest market price
- `entry_value_usdt` (NUMERIC): Position value at entry
- `unrealized_pnl` (NUMERIC): Current unrealized P&L
- `status` (VARCHAR): open/trailing/closed
- `wallet_id` (VARCHAR): Wallet identifier
- `trading_mode` (VARCHAR): testnet/live

**Risk Management Fields:**
- `stop_loss_price` (NUMERIC): Stop loss trigger price
- `take_profit_price` (NUMERIC): Take profit target
- `is_trailing` (BOOLEAN): Whether trailing stop is enabled
- `trailing_stop_price` (NUMERIC): Current trailing stop price
- `trailing_peak_price` (NUMERIC): Highest price reached (for trailing stop calculation)
- `peak_price` (NUMERIC): Peak price tracking
- `trough_price` (NUMERIC): Trough price tracking
- `time_exit_hours` (NUMERIC): Maximum position age before forced close

**Analytics Fields:**
- `strategy_name` (VARCHAR): Strategy that opened the position
- `trigger_signals` (JSONB): Array of signals that triggered entry
- `combined_strength` (NUMERIC): Combined signal strength score
- `conviction_score` (INTEGER): Overall conviction score (0-100)
- `conviction_breakdown` (JSONB): Detailed conviction components (volatility, marketRegime, signalStrength, demoPerformance)
- `conviction_multiplier` (NUMERIC): Multiplier applied to position size
- `conviction_details` (JSONB): Additional conviction metadata
- `market_regime` (VARCHAR): uptrend/downtrend/sideways
- `regime_confidence` (NUMERIC): Confidence in regime classification (0-100)
- `atr_value` (NUMERIC): Average True Range at entry
- `is_event_driven_strategy` (BOOLEAN): Whether strategy is event-driven
- `fear_greed_score` (INTEGER): Fear & Greed Index (0-100)
- `fear_greed_classification` (VARCHAR): Fear/Greed/Neutral classification
- `lpm_score` (NUMERIC): Performance Momentum Score (0-100)

**Binance Integration Fields:**
- `binance_order_id` (VARCHAR): Binance order ID
- `binance_executed_price` (NUMERIC): Actual execution price from Binance
- `binance_executed_quantity` (NUMERIC): Actual executed quantity
- `entry_timestamp` (TIMESTAMP): Entry time
- `last_updated_timestamp` (TIMESTAMP): Last update time
- `last_price_update` (TIMESTAMP): Last price refresh time

### `trades` Table
Stores closed positions (all fields from `live_positions` plus exit data):

**Additional Exit Fields:**
- `trade_id` (VARCHAR): Trade identifier (usually same as `position_id`)
- `exit_price` (NUMERIC): Exit execution price
- `exit_value_usdt` (NUMERIC): Exit value in USDT
- `pnl_usdt` (NUMERIC): Realized P&L in USDT
- `pnl_percentage` (NUMERIC): Percentage gain/loss
- `exit_timestamp` (TIMESTAMP): Exit time
- `duration_seconds` (INTEGER): Position duration
- `exit_reason` (VARCHAR): timeout/stop_loss/take_profit/trailing_stop_hit/force_close
- `total_fees_usdt` (NUMERIC): Total trading fees

---

## 🔄 Position Monitoring Logic

### Monitoring Flow (`monitorAndClosePositions`)
Called during each scan cycle to check all open positions for exit conditions.

**Monitoring Order (Priority-based):**
1. **Force Close Stuck Positions** (Safety Net)
   - **Trigger**: Position age > `maxPositionAgeHours` (default: 24 hours)
   - **Action**: Force close with reason `timeout`
   - **Priority**: Highest (safety net to prevent positions stuck forever)

2. **Time-based Exit** (Strategy-specific)
   - **Trigger**: `time_exit_hours` elapsed since entry
   - **Calculation**: `timeElapsedHours >= time_exit_hours`
   - **Action**: Close with reason `timeout`
   - **Note**: Each strategy can have custom time exit based on backtest results

3. **Take Profit** (Before Stop Loss - Good Practice)
   - **Trigger**: `currentPrice >= take_profit_price` (for long)
   - **Trigger**: `currentPrice <= take_profit_price` (for short)
   - **Action**: Close with reason `take_profit`
   - **Note**: Only checked if position doesn't have trailing take profit enabled

4. **Stop Loss**
   - **Trigger**: `currentPrice <= stop_loss_price` (for long)
   - **Trigger**: `currentPrice >= stop_loss_price` (for short)
   - **Action**: Close with reason `stop_loss`
   - **Note**: Only checked if position is NOT trailing

5. **Trailing Stop Logic** (`_updateTrailingStopAndPriceTracking`)
   - Updates `peak_price` and `trough_price` on each cycle
   - Calculates new `trailing_stop_price` based on peak
   - **Trigger**: When `currentPrice` crosses `trailing_stop_price`
   - **Action**: Close with reason `trailing_stop_hit`

**Monitoring Process:**
```javascript
for each position:
  1. Fetch current price from price cache
  2. Check force close (max age)
  3. Check time exit (strategy-specific)
  4. Check take profit
  5. Check stop loss
  6. Update trailing stop tracking
  7. Check trailing stop trigger
  8. If any condition met → create trade record + add to close list
  9. If trailing stop updated → persist position updates
```

---

## 🧹 Dust Management System

### Purpose
Prevents attempting to trade quantities below Binance's minimum lot size and notional value thresholds.

### Dust Detection Logic (`_executeBinanceMarketSellOrder`)

**Step 1: Get Exchange Info**
- Fetches `LOT_SIZE` and `MIN_NOTIONAL` filters from Binance exchange info
- `minQty`: Minimum quantity allowed for the symbol
- `stepSize`: Precision step for quantity rounding
- `minNotional`: Minimum trade value in USDT (typically $5-10)

**Step 2: Calculate Requested Quantity**
```javascript
// Normal context (opening):
requestedQty = Math.min(positionQty, freeBalance)

// Closing context:
if (isClosingContext && positionQty > 0 && positionQty >= minQty) {
    requestedQty = positionQty  // Always try to close with actual position size
}
requestedQty = roundDownToStepSize(requestedQty, stepSize)
```

**Step 3: Dust Threshold Checks**
```javascript
belowLot = (requestedQty < minQty - 1e-12)
belowNotional = (notional < minNotional - 1e-8)
```

**Step 4: Dust Prevention Logic (3 Conditions)**

**Condition 1: Closing Context Override**
- **When**: `isClosingContext && positionMeetsMinimums`
- **Action**: Use `positionQty` for Binance close attempt (real close, not virtual)
- **Purpose**: Don't block legitimate position closes even if `freeBalance = 0`
- **Logic**: Position already meets minimums, so attempt real Binance close

**Condition 2: User Has Enough to Sell "ALL"**
- **When**: `freeRounded >= minQty && freeNotional >= minNotional && requestedQty < minQty`
- **Action**: Override `requestedQty = freeRounded` (use all available balance)
- **Purpose**: If user has enough free balance to meet minimums, use it all
- **Logic**: Sell all available balance to avoid leaving dust

**Condition 3: TRUE DUST (Block Trade)**
- **When**: None of the above conditions met
- **Action**: 
  1. Add to `dustLedger` (in-memory tracking)
  2. Log dust block
  3. Trigger reconciliation
  4. Return `{ success: false, dust: true, skipped: true }`
- **Purpose**: Prevent invalid Binance API calls

### Dust Ledger System
- **Storage**: In-memory `Map<symbol:mode, dustInfo>`
- **Purpose**: Track dust instances across scan cycles
- **Keys**: `"testnet:XRPUSDT"` format
- **Data**: `{ symbol, baseAsset, mode, qty, minQty, minNotional, stepSize, price, updatedAt }`

### Dust Conversion
- **Function**: `attemptDustConvert(tradingMode, proxyUrl)`
- **Purpose**: Convert small balances (< minQty) to BNB on Binance
- **When**: Attempted when insufficient balance error occurs
- **API**: POST `/api/binance/dustConvert`

---

## 📏 Position Sizing Logic

### Position Sizing Methods
Located in `src/components/utils/dynamicPositionSizing.jsx`

**1. Fixed Sizing** (`calculateFixedSize`)
```javascript
// Base calculation
rawPositionValueUSDT = defaultSize * lpmMultiplier
rawQuantityCrypto = rawPositionValueUSDT / currentPrice

// LPM Integration
lpmMultiplier = 0.5 + (lpmScore / 100) * 1.0  // Range: 0.5x to 1.5x
cappedLpmMultiplier = Math.min(Math.max(lpmMultiplier, 0.5), 1.5)

// Cap by available balance
cappedPositionValueUSDT = Math.min(rawPositionValueUSDT, balance)
cappedQuantityCrypto = cappedPositionValueUSDT / currentPrice

// Apply exchange filters (minQty, stepSize, minNotional)
// Final quantity = validated and rounded
```

**2. Volatility-Adjusted Sizing** (`calculateVolatilityAdjustedSize`)
```javascript
// Base position value with LPM
basePositionValueUSDT = basePositionSize * lpmMultiplier

// Dollar risk per trade
dollarRiskPerTrade = basePositionValueUSDT

// Stop loss distance
stopLossDistance = atr * stopLossAtrMultiplier

// Quantity calculation
rawQuantityCrypto = dollarRiskPerTrade / stopLossDistance

// Position value
positionValueUSDT = rawQuantityCrypto * currentPrice

// Apply conviction adjustment and exchange filters
```

**3. Main Position Sizing Function** (`calculatePositionSize`)
```javascript
// Strategy settings
- useWinStrategySize: Whether to use winning strategy size
- defaultPositionSize: Base size in USDT (default: 100)
- basePositionSize: Base for LPM system (default: 100)
- riskPerTrade: Risk percentage (default: 2%)
- minimumTradeValue: Minimum position size (default: 10 USDT)
- maxBalancePercentRisk: Max % of balance to risk (default: 100%)
- maxBalanceInvestCapUSDT: Hard cap in USDT (optional)

// EBR (Expected Balance Risk) Integration
effectiveRiskPerTrade = adjustedBalanceRiskFactor 
    ? (maxBalancePercentRisk * (adjustedBalanceRiskFactor / 100))
    : riskPerTrade

// Select sizing method based on:
1. Strategy settings (fixed vs volatility-adjusted)
2. ATR availability
3. Stop loss configuration
```

### Sizing Validation (`positionSizeValidator.jsx`)
- Validates against exchange filters
- Applies lot size rounding
- Checks minimum notional
- Validates maximum quantity
- Returns formatted quantity string for Binance API

---

## 🚫 Blockers and Prevention Mechanisms

### 1. Dust Prevention Blocker
**Location**: `PositionManager._executeBinanceMarketSellOrder`
**Block Condition**: 
```javascript
freeRounded < minQty OR freeNotional < minNotional
AND NOT (isClosingContext && positionMeetsMinimums)
```
**Action**: Returns `{ success: false, dust: true, skipped: true }`

### 2. Max Balance Investment Cap
**Location**: `ScanEngineService._evaluateStrategies`
**Block Condition**: 
```javascript
balanceInTrades >= maxBalanceInvestCapUSDT
```
**Action**: 
- Sets `maxCapReached = true` flag
- **Does NOT block monitoring** (positions still monitored for closure)
- **Only blocks opening new positions**

### 3. Maximum Position Age (Force Close)
**Location**: `PositionManager.monitorAndClosePositions`
**Block Condition**: 
```javascript
positionAgeHours > maxPositionAgeHours  // Default: 24 hours
```
**Action**: Force closes position with reason `timeout`

### 4. Minimum Conviction Score
**Location**: `dynamicPositionSizing.calculateFixedSize`
**Block Condition**: 
```javascript
convictionScore < minimumConvictionScore  // Default: 50
```
**Action**: Returns `{ error: "Conviction score below minimum" }`

### 5. Insufficient Balance Error Handling
**Location**: `PositionManager._executeBinanceMarketSellOrder` (error handling)
**Block Condition**: Binance returns `-2010` or "insufficient balance"
**Action**: 
1. Check Binance order history for matching SELL orders (30 min window)
2. If match found → Use that order as "already executed"
3. If no match → Retry with balance refresh
4. If retry fails → Treat as error

### 6. Duplicate Prevention
**Location**: `PositionManager.executeBatchClose`
**Prevention**: 
```javascript
if (this.processedTradeIds.has(positionTradeId)) {
    continue  // Skip already processed position
}
```

### 7. Price Availability Check
**Location**: `PositionManager.monitorAndClosePositions`
**Block Condition**: 
```javascript
!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0
```
**Action**: Skips position monitoring for that cycle

### 8. Exchange Info Validation
**Location**: `PositionManager._executeBinanceMarketSellOrder`
**Block Condition**: Missing exchange info or filters
**Action**: Throws error, prevents trade execution

---

## 🔧 Key Configuration Parameters

### Position Monitoring
- `maxPositionAgeHours`: 24 (force close after this age)
- Time exit: Strategy-specific from backtest results

### Dust Management
- `minQty`: From Binance exchange info (symbol-specific)
- `minNotional`: From Binance exchange info (typically $5-10)
- `stepSize`: From Binance exchange info (precision step)
- Tolerance: `1e-12` for minQty, `1e-8` for minNotional

### Position Sizing
- `defaultPositionSize`: 100 USDT (base position size)
- `basePositionSize`: 100 USDT (for LPM system)
- `riskPerTrade`: 2% (default risk per trade)
- `minimumTradeValue`: 10 USDT
- `maxBalancePercentRisk`: 100%
- `minimumConvictionScore`: 50

### LPM Integration
- LPM Score Range: 0-100
- LPM Multiplier Range: 0.5x to 1.5x
- Formula: `0.5 + (lpmScore / 100) * 1.0`

---

## 📝 Summary

**Position Monitoring**: Priority-based exit condition checking with force close safety net

**Dust Management**: Multi-condition logic preventing trades below Binance minimums, with special handling for closing positions

**Position Sizing**: LPM-integrated sizing with fixed and volatility-adjusted methods, validated against exchange filters

**Blockers**: 8 different prevention mechanisms ensuring safe and valid trades

**Closing Context**: Special handling to ensure positions can be closed even when `freeBalance = 0`, with order history verification

