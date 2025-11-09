# Dust Position Aggregation System - Implementation Summary

## ✅ Implementation Complete

The dust position aggregation system has been successfully implemented. This system automatically detects, aggregates, and manages dust positions (positions below minimum tradeable quantity/notional value).

## Features Implemented

### 1. **Dust Detection at Scan Cycle Start** ✅
- Added `detectAndAggregateDustPositions()` function in `PositionManager.jsx`
- Called automatically at the beginning of each scan cycle (Phase 2.5)
- Checks all open positions for dust (below `minQty` or `minNotional`)

### 2. **Position Aggregation** ✅
- Multiple dust positions of the same coin are automatically aggregated
- Creates a single aggregated position record in the database
- Original positions are marked as `dust_aggregated` and removed from active monitoring
- Aggregated position shows combined quantity and status

### 3. **Accumulated Quantity Tracking** ✅
- In-memory `dustAccumulator` Map tracks accumulated quantities per coin
- Each cycle updates the accumulated quantity
- When accumulated quantity reaches minimum (`minQty` and `minNotional`), status changes to `dust_ready`

### 4. **Skip Sell Attempts for Dust** ✅
- Positions with `dust_status = 'dust_pending'` are skipped in `monitorAndClosePositions()`
- Positions with `dust_status = 'dust_aggregated'` are also skipped
- Only positions with `dust_status = 'dust_ready'` or normal `open` status are processed for selling

### 5. **Database Schema Updates** ✅
- Created SQL migration file: `add-dust-aggregation-fields.sql`
- New columns added to `live_positions` table:
  - `dust_status` (VARCHAR): 'dust_pending', 'dust_ready', 'dust_aggregated', or NULL
  - `aggregated_position_id` (VARCHAR): Reference to main aggregated position
  - `accumulated_quantity` (NUMERIC): Total accumulated quantity for aggregated positions
  - `aggregated_position_ids` (JSONB): Array of original position IDs
  - `note` (TEXT): Status message like "Below nominal quantity, waiting for additional quantity"
- Indexes created for performance

### 6. **Status Messages** ✅
- Positions show clear status messages:
  - `dust_pending`: "Below nominal quantity, waiting for additional quantity"
  - `dust_ready`: "Accumulated quantity ready to sell"
  - `dust_aggregated`: "Aggregated into dust position"

## How It Works

### Step 1: Detection (Each Scan Cycle)
1. At the start of each scan cycle, `detectAndAggregateDustPositions()` is called
2. All open positions are checked against `minQty` and `minNotional` thresholds
3. Dust positions are identified and grouped by symbol

### Step 2: Aggregation
1. For each coin with dust positions:
   - Calculate total accumulated quantity
   - Check if accumulated quantity meets minimums
   - Create or update aggregated position record
   - Mark original positions as `dust_aggregated`

### Step 3: Tracking
1. `dustAccumulator` Map tracks:
   - Total accumulated quantity per coin
   - Minimum requirements (`minQty`, `minNotional`)
   - Current status (`dust_pending` or `dust_ready`)

### Step 4: Auto-Sell When Ready
1. When accumulated quantity reaches minimums:
   - Status changes from `dust_pending` to `dust_ready`
   - Position status changes to `open`
   - Next scan cycle will attempt to sell the position

### Step 5: Skip Dust in Monitoring
1. In `monitorAndClosePositions()`, positions with:
   - `dust_status = 'dust_pending'` → Skipped (waiting for more quantity)
   - `dust_status = 'dust_aggregated'` → Skipped (already merged)
   - `dust_status = 'dust_ready'` or normal `open` → Processed normally

## Database Migration

**File**: `add-dust-aggregation-fields.sql`

Run this SQL file to add the necessary columns to your `live_positions` table:

```bash
psql -d your_database -f add-dust-aggregation-fields.sql
```

Or execute the SQL directly in your database client.

## Status Values

| Status | Description | Action |
|--------|-------------|--------|
| `dust_pending` | Below minimum, waiting for more quantity | Skipped in monitoring |
| `dust_ready` | Accumulated quantity meets minimums | Ready to sell (next cycle) |
| `dust_aggregated` | Original position merged into aggregated position | Skipped in monitoring |
| `open` (normal) | Normal position, not dust | Processed normally |

## Example Flow

### Scenario: 3 BONK positions, each below minimum

1. **Cycle 1**:
   - Detects 3 BONK positions, each 0.0001 BONK (below minQty of 1.0)
   - Creates aggregated position: `dust_agg_BONKUSDT_testnet`
   - Total accumulated: 0.0003 BONK
   - Status: `dust_pending` (still below minimum)
   - Note: "Below nominal quantity, waiting for additional quantity"

2. **Cycle 2** (more BONK received):
   - Detects additional BONK quantity
   - Updates aggregated position: Total now 1.5 BONK
   - Status: `dust_ready` (meets minimums)
   - Note: "Accumulated quantity ready to sell"

3. **Cycle 3**:
   - Position monitoring processes the aggregated position
   - Attempts to sell 1.5 BONK
   - Position closed successfully

## UI Updates Needed

The UI should be updated to:
1. Display aggregated positions with special styling
2. Show the `note` field in the status column
3. Display accumulated quantity for dust positions
4. Show which original positions were aggregated (from `aggregated_position_ids`)

## Files Modified

1. **`src/components/services/PositionManager.jsx`**:
   - Added `detectAndAggregateDustPositions()` method
   - Added dust filtering logic in `monitorAndClosePositions()`
   - Added `dustAccumulator` Map for tracking

2. **`src/components/services/services/ScanEngineService.jsx`**:
   - Added Phase 2.5: Dust Detection & Aggregation
   - Integrated into scan cycle timing

3. **`add-dust-aggregation-fields.sql`** (NEW):
   - Database migration for dust aggregation fields

## Next Steps

1. **Run Database Migration**: Execute `add-dust-aggregation-fields.sql` to add the new columns
2. **Test the System**: Monitor logs to see dust detection and aggregation in action
3. **Update UI**: Modify the positions table to show dust status and notes
4. **Monitor Performance**: Check that dust detection doesn't significantly impact scan cycle time

## Logging

The system logs:
- `[PositionManager] 🧹 Starting dust detection and aggregation...`
- `[PositionManager] 🧹 {symbol}: {count} dust position(s), total: {quantity} (needs {minQty} min, {minNotional} USDT min)`
- `[PositionManager] ✅ {symbol}: Accumulated quantity ({quantity}) meets minimums. Ready to sell.`
- `[PositionManager] ✅ Dust detection complete: {detected} detected, {aggregated} aggregated, {ready} ready to sell`

## Benefits

1. **Automatic Management**: No manual intervention needed for dust positions
2. **Efficient Aggregation**: Multiple small positions combined into one sellable position
3. **Clear Status**: Easy to see which positions are waiting for more quantity
4. **Auto-Sell**: Automatically sells when accumulated quantity reaches minimum
5. **Database Persistence**: All aggregation data stored in database for recovery

