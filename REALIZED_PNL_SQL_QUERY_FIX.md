# Realized P&L SQL Query Fix

## The Problem

Your SQL query:
```sql
SELECT SUM(pnl_usdt) AS total_pnl
FROM (
    SELECT pnl_usdt
    FROM trades
    ORDER BY entry_timestamp DESC
    LIMIT 100
) t;
```

**Returns: 9.44**

But the widget shows: **$16.22**

## Why the Discrepancy?

The code uses different criteria:

1. **Orders by `exit_timestamp DESC`** (not `entry_timestamp`)
   - This gets the most recently **closed** trades, not most recently **opened** trades

2. **Filters by `trading_mode`**
   - Only includes trades matching current mode (testnet/live)

3. **Requires `exit_timestamp IS NOT NULL`**
   - Only includes closed trades

4. **Requires `entry_value_usdt > 0`**
   - Only includes trades with valid entry value

## Corrected SQL Query

To match what the code calculates, use:

```sql
SELECT SUM(pnl_usdt) AS total_pnl
FROM (
    SELECT pnl_usdt
    FROM trades
    WHERE exit_timestamp IS NOT NULL
      AND entry_price > 0
      AND quantity > 0
      AND trading_mode = 'testnet'  -- or 'live' depending on your mode
    ORDER BY exit_timestamp DESC
    LIMIT 100
) t;
```

**Note**: The code checks `entry_value_usdt > 0`, but this column doesn't exist in the database. The code calculates it as `entry_price * quantity`, so we filter by `entry_price > 0 AND quantity > 0` instead.

**Or if you want to see both modes:**

```sql
SELECT 
    trading_mode,
    SUM(pnl_usdt) AS total_pnl,
    COUNT(*) AS trade_count
FROM (
    SELECT 
        pnl_usdt,
        trading_mode
    FROM trades
    WHERE exit_timestamp IS NOT NULL
      AND entry_price > 0
      AND quantity > 0
    ORDER BY exit_timestamp DESC
    LIMIT 100
) t
GROUP BY trading_mode;
```

## Why the Difference?

The discrepancy between your SQL query ($14.42) and the UI widget ($26.57) is due to:

1. **In-Memory vs Database**: The code uses an in-memory `trades` array that may include:
   - Trades that were just closed but not yet saved to the database
   - Trades with updated P&L values that differ from the database
   - Trades added via `addRecentTrade()` that may have different values

2. **Your SQL query ($14.42)**: Queries the database directly, showing only trades that are:
   - Saved to the database
   - Have the exact P&L values stored in the database

3. **UI Widget ($26.57)**: Uses the in-memory `trades` array via `/api/trades`, which includes:
   - All trades in memory (including unsaved ones)
   - Updated P&L values that may differ from the database

## Solution

To match the UI widget's calculation, you would need to query the in-memory trades array, which is not directly accessible via SQL. However, you can:

1. **Restart the proxy server** to reload trades from the database (this will sync in-memory with database)
2. **Wait for trades to be saved** - newly closed trades are saved to the database, but there may be a brief delay
3. **Check for unsaved trades** - The in-memory array may contain trades that failed to save to the database

The SQL query is correct for what's in the database. The UI shows what's in memory, which may include additional trades or updated values.

The code's approach makes more sense for "Realized P&L" because:
- Realized P&L = profits from **closed** trades only
- Should be ordered by when they **closed**, not when they opened
- Should respect trading mode (testnet vs live are separate)

## Verification Query

To see what the code is actually using:

```sql
SELECT 
    COUNT(*) AS trade_count,
    SUM(pnl_usdt) AS total_pnl,
    SUM(entry_price * quantity) AS total_entry_value,
    (SUM(pnl_usdt) / NULLIF(SUM(entry_price * quantity), 0)) * 100 AS pnl_percentage
FROM (
    SELECT 
        pnl_usdt,
        entry_price,
        quantity
    FROM trades
    WHERE exit_timestamp IS NOT NULL
      AND entry_price > 0
      AND quantity > 0
      AND trading_mode = 'testnet'  -- Change to 'live' if needed
    ORDER BY exit_timestamp DESC
    LIMIT 100
) t;
```

**Note**: `entry_value_usdt` doesn't exist as a column. It's calculated as `entry_price * quantity`. The `NULLIF` prevents division by zero.

This should match the widget's `$16.22 (+0.2%)` display.

