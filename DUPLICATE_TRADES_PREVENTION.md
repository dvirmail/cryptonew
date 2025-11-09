# Preventing Duplicate Trades in Database

## Problem

The application was using deduplication logic to filter out duplicate trades when calculating P&L. However, this created a discrepancy between:
- **SQL Query Results**: 3,611 trades, $352.42 PNL (no deduplication)
- **Application Results**: 3,111 trades, $294.58 PNL (with deduplication)

The solution is to **prevent duplicates at the database level** instead of filtering them out in the application.

## Current Protection (Already in Place)

### 1. Application-Level Duplicate Detection
The `saveTradeToDB()` function in `proxy-server.cjs` already checks for duplicates:

- **Check 1**: By `position_id` (most reliable)
  - Each position should only create one trade record
  - If a trade with the same `position_id` exists, the insert is skipped

- **Check 2**: By trade characteristics (fallback)
  - Checks: `symbol`, `strategy_name`, `entry_price`, `exit_price`, `quantity`, `entry_timestamp` (within 2 seconds), `trading_mode`
  - If a matching trade exists, the insert is skipped

### 2. Database-Level Protection (ON CONFLICT)
The INSERT statement uses `ON CONFLICT (id) DO UPDATE`, which means:
- If a trade with the same `id` is inserted, it updates the existing record instead of creating a duplicate

## New Protection (Database Constraints)

### Step 1: Find Existing Duplicates

Run the diagnostic script to identify duplicates:

```bash
node find-duplicate-trades.cjs [trading_mode]
```

This will show:
- Duplicates by `position_id`
- Duplicates by trade characteristics
- Summary of how many duplicates exist

### Step 2: Clean Up and Add Constraints

Run the SQL script to:
1. **Remove existing duplicates** (keeps the earliest trade in each group)
2. **Add unique constraints** to prevent future duplicates

```bash
psql -U postgres -d your_database -f prevent-duplicate-trades.sql
```

Or execute the SQL directly in your database client.

### What the SQL Script Does

1. **Cleans up duplicates by `position_id`**:
   - Finds all trades with the same `position_id`
   - Keeps the one with the earliest `exit_timestamp` (or earliest `id` if `exit_timestamp` is null)
   - Deletes the rest

2. **Cleans up duplicates by characteristics**:
   - Finds trades with identical: `symbol`, `strategy_name`, `entry_price`, `exit_price`, `quantity`, `entry_timestamp` (rounded to second), `trading_mode`
   - Keeps the one with the earliest `exit_timestamp`
   - Deletes the rest

3. **Adds unique constraints**:
   - **Unique index on `position_id`** (where not null): Prevents multiple trades for the same position
   - **Unique index on trade characteristics**: Prevents duplicate trades based on trade details

## How It Works

### Before (Application-Level Deduplication)
```
Trade Created → Application Checks → If Duplicate, Skip → Database Insert
                                    ↓
                            (500 trades filtered out)
```

### After (Database-Level Constraints)
```
Trade Created → Application Checks → Database Insert → If Duplicate, PostgreSQL Error
                                    ↓
                            (Prevented at database level)
```

## Benefits

1. **Data Integrity**: Database enforces uniqueness, not just the application
2. **Consistency**: SQL queries and application queries return the same results
3. **Performance**: Database-level constraints are faster than application-level checks
4. **Reliability**: Even if application logic has bugs, database prevents duplicates

## Verification

After running the scripts, verify no duplicates exist:

```sql
-- Check for duplicates by position_id
SELECT position_id, COUNT(*) 
FROM trades 
WHERE position_id IS NOT NULL 
GROUP BY position_id 
HAVING COUNT(*) > 1;

-- Check for duplicates by characteristics
SELECT symbol, strategy_name, entry_price, exit_price, quantity, 
       DATE_TRUNC('second', entry_timestamp), trading_mode, COUNT(*) 
FROM trades 
WHERE exit_timestamp IS NOT NULL 
  AND entry_price > 0 
  AND quantity > 0
GROUP BY symbol, strategy_name, entry_price, exit_price, quantity, 
         DATE_TRUNC('second', entry_timestamp), trading_mode
HAVING COUNT(*) > 1;
```

Both queries should return **0 rows**.

## Existing Endpoint

There's already an endpoint to remove duplicates:

```bash
POST http://localhost:3003/api/trades/remove-duplicates
```

This uses similar logic but doesn't add the unique constraints. The SQL script is more comprehensive.

## Summary

1. ✅ **Application-level checks** (already in place) - First line of defense
2. ✅ **Database unique constraints** (new) - Final line of defense
3. ✅ **Cleanup script** (new) - Removes existing duplicates
4. ✅ **Diagnostic script** (new) - Identifies duplicates before cleanup

This multi-layered approach ensures no duplicate trades can exist in the database.

