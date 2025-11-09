# Dust Position Aggregation System - Implementation Plan

## Overview
This system will:
1. Detect dust positions at the start of each scan cycle
2. Skip sell attempts for dust positions
3. Track accumulated quantities per coin across cycles
4. Aggregate multiple dust positions of the same coin
5. Update database and UI to show aggregated positions with special status
6. Automatically sell when accumulated quantity reaches minimum

## Implementation Steps

### Step 1: Dust Detection at Scan Cycle Start
- Add function `detectAndAggregateDustPositions()` called at the beginning of `scanCycle()`
- Check all open positions for dust (below minQty or minNotional)
- Group dust positions by symbol

### Step 2: Dust Tracking System
- Create in-memory Map: `dustAccumulator` to track accumulated quantities per coin
- Structure: `Map<symbol, { totalQuantity, minQty, minNotional, positions: [] }>`
- Persist to database in a new table or extend `live_positions` with aggregation fields

### Step 3: Position Aggregation
- For each coin with multiple dust positions:
  - Create/update aggregated position record
  - Mark original positions as "aggregated" (status = "dust_aggregated")
  - Store aggregated position with:
    - Combined quantity
    - Status: "dust_pending" with note "Below nominal quantity, waiting for additional quantity"
    - Reference to original position IDs

### Step 4: Database Schema Updates
- Add columns to `live_positions`:
  - `is_aggregated` (BOOLEAN)
  - `aggregated_position_id` (VARCHAR) - reference to main aggregated position
  - `dust_status` (VARCHAR) - "dust_pending", "dust_ready", "dust_aggregated"
  - `accumulated_quantity` (NUMERIC) - for aggregated positions

### Step 5: Skip Sell Logic
- In `monitorAndClosePositions()`, check if position has `dust_status = 'dust_pending'`
- Skip sell attempt if status is dust_pending
- Only attempt sell when `dust_status = 'dust_ready'` (accumulated >= minQty)

### Step 6: Auto-Sell When Ready
- Each cycle, check accumulated quantity vs minQty/minNotional
- When threshold reached, change status to "dust_ready"
- Next cycle will attempt sell

## Status Values
- `dust_pending`: Below minimum, waiting for more quantity
- `dust_ready`: Accumulated quantity meets minimum, ready to sell
- `dust_aggregated`: Original position that was merged into aggregated position
- `open`: Normal position (not dust)

