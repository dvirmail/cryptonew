# Kline Cache Performance Fix - Implementation Summary

## Problem Identified

The scanner's strategy evaluation stage was getting progressively slower over time due to:

1. **Expired cache entries accumulating** in both proxy server and client-side caches
2. **No automatic cleanup** of expired entries - cleanup only happened when size thresholds were exceeded
3. **Slower cache lookups** as expired entries accumulated, requiring more checks

## Solution Implemented

### 1. Proxy Server Cache (`proxy-server.cjs`)

**Changes:**
- ✅ Added **cleanup at scan cycle start** - client triggers cleanup via API endpoint
- ✅ Added **periodic cleanup as fallback** every 2 minutes (less frequent since client triggers it)
- ✅ Added **on-access cleanup** - expired entries are removed when cache is checked
- ✅ Improved **size-based cleanup** - removes expired entries first before applying size limit
- ✅ Added `/api/cache/cleanup-kline` endpoint for on-demand cleanup

**Cache Details:**
- Duration: 2 minutes
- Cleanup trigger: At scan cycle start (via API call from client)
- Periodic cleanup: Every 2 minutes (fallback)
- Size limit: 1000 entries (keeps 500 most recent if exceeded)

### 2. Client-Side Cache (`src/api/localClient.js`)

**Changes:**
- ✅ Added **cleanup at scan cycle start** - called at beginning of `scanCycle()` and `scanForSignals()`
- ✅ Added **periodic cleanup as fallback** every 2 minutes (less frequent since we clean at scan cycle start)
- ✅ Added **on-access cleanup** - expired entries are removed when cache is checked
- ✅ Exported cleanup function for on-demand use

**Cache Details:**
- Duration: 5 seconds
- Cleanup trigger: At scan cycle start and before signal detection
- Periodic cleanup: Every 2 minutes (fallback)
- Size limit: 100 entries (removes expired entries when exceeded)

## Benefits

1. **Consistent Performance**: Cache lookups remain fast regardless of how long the app runs
2. **Reduced Memory Usage**: Expired entries are promptly removed, not accumulated
3. **Efficient Cleanup**: Cleanup happens exactly when needed (at scan cycle start) rather than on arbitrary intervals
4. **Proactive Cleanup**: Expired entries are removed at scan cycle start, on-access, and periodically as fallback
5. **Better Cache Hit Rate**: Cache contains only valid entries, improving hit rate
6. **No Unnecessary Overhead**: Cleanup only runs when scanner is active (at scan cycle start)

## Expected Impact

- **Strategy evaluation should maintain consistent speed** over time
- **Memory usage should remain stable** instead of growing
- **Cache lookups should be faster** with fewer entries to check
- **No performance degradation** over extended runtime periods

## Cleanup Strategy

**Primary Method (Most Efficient):**
- Cleanup triggered at the **start of each scan cycle** (`scanCycle()` in `ScanEngineService.jsx`)
- Also triggered at the **start of signal detection** (`scanForSignals()` in `SignalDetectionEngine.jsx`)
- This ensures cache is clean before fetching new kline data

**Fallback Method:**
- Periodic cleanup every 2 minutes (both client and server)
- Ensures cleanup happens even if scan cycles are infrequent

**On-Access Cleanup:**
- Expired entries are removed when cache is checked
- Prevents serving stale data

## Monitoring

You can monitor cache cleanup in the logs:
- Proxy server: `[PROXY] 🧹 Cleaned X expired kline cache entries (Y remaining)`
- Client-side: `[KLINE_CACHE] 🧹 Cleaned X expired cache entries (Y remaining)`
- Scan cycle: `🧹 Cleaned X expired kline cache entries at scan cycle start`

These logs appear when expired entries are cleaned during scan cycle start or periodic cleanup.

