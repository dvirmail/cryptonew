# Scanner Slowdown and BONK Sell Error Analysis

## Issue 1: Scanner Slowdown After Extended Inactivity

### Symptoms
- After leaving app unattended, scan cycles extend significantly (300+ seconds vs 145 seconds)
- Strategies start evaluating one-by-one instead of in batches
- After refresh, scan time returns to normal (~145 seconds)
- "No heartbeat for 10+ minutes" message appears

### Root Cause

**Primary Issue: `requestIdleCallback` Throttling**

When a browser tab is inactive, browsers throttle `requestIdleCallback` to save resources. The callback may not fire for minutes or even indefinitely. This causes:

1. **Strategy evaluation delay**: The `requestIdleCallback` wrapper in `ScanEngineService.jsx` waits for the browser to be "idle", but when the tab is inactive, this never happens
2. **Sequential processing**: Even though strategies are grouped and should process in parallel via `Promise.allSettled`, browser throttling causes them to execute sequentially
3. **State accumulation**: Over time, cached indicators, prices, and other state accumulate, causing memory pressure and slower execution

**Code Location:**
- `src/components/services/services/ScanEngineService.jsx` lines 388-451
- Uses `requestIdleCallback` with a 2-second timeout fallback
- When tab is inactive, `requestIdleCallback` may not fire for 10+ minutes

### Solution

1. **Remove `requestIdleCallback` for strategy evaluation**: Strategy evaluation is a background operation that doesn't need to wait for UI idle time
2. **Ensure parallel processing**: Strategies are already grouped and processed via `Promise.allSettled`, but we need to ensure this always happens regardless of tab visibility
3. **Add state cleanup**: Periodically clear stale cached data (indicators, prices) to prevent memory accumulation

## Issue 2: BONK Selling Error

### Symptoms
- Error when selling BONK (price: $0.00001241)
- Similar to previous BONK buying issue
- System may not handle very small prices correctly

### Root Cause

**Precision Issues with Very Small Prices:**

1. **Notional calculation**: `notional = requestedQty * currentPrice` for BONK:
   - Example: `1000000 * 0.00001241 = 12.41` (should pass minNotional)
   - But floating-point precision errors may cause `notional < minNotional` check to fail

2. **Quantity formatting**: `_formatQuantityString` handles scientific notation, but very small step sizes (e.g., `1e-8`) may cause formatting issues

3. **Dust detection**: The dust detection logic uses epsilon values (`1e-12`, `1e-8`) that may not be appropriate for very small prices

**Code Location:**
- `src/components/services/PositionManager.jsx` lines 3400-3528
- Dust detection logic at lines 3404-3405:
  ```javascript
  const belowLot = minQty && requestedQty < minQty - 1e-12;
  const belowNotional = minNotional && notional < (minNotional - 1e-8);
  ```

### Solution

1. **Improve precision handling**: Use relative epsilon instead of absolute epsilon for very small prices
2. **Enhanced quantity formatting**: Ensure `_formatQuantityString` correctly handles very small step sizes
3. **Better dust detection**: For very small prices, use percentage-based thresholds instead of absolute values

## Implementation Plan

### Fix 1: Remove `requestIdleCallback` for Strategy Evaluation

**File**: `src/components/services/services/ScanEngineService.jsx`
- Remove `requestIdleCallback` wrapper
- Execute strategy evaluation immediately
- This ensures strategies always process in parallel batches, regardless of tab visibility

### Fix 2: Improve BONK Sell Order Precision Handling

**File**: `src/components/services/PositionManager.jsx`
- Update dust detection to use relative epsilon for very small prices
- Ensure `_formatQuantityString` correctly formats very small quantities
- Add special handling for very low-priced coins (price < 0.001)

### Fix 3: Add State Cleanup (Optional - Future Enhancement)

**File**: `src/components/services/AutoScannerService.jsx`
- Periodically clear stale cached indicators and prices
- Limit cache size to prevent memory accumulation

