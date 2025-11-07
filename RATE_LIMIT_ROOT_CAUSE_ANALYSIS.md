# Rate Limit Root Cause Analysis

## Why We Hit the Rate Limit

### Root Cause

The proxy server was **caching Binance error responses** (rate limit errors), causing the system to:
1. Receive rate limit error from Binance
2. Cache that error response for 5 minutes
3. Return the cached error on every subsequent request
4. Continue making requests (thinking cache was valid)
5. Eventually hit Binance rate limits

### The Problem Flow

```
Request 1: Binance → Rate limit error (-1003)
Proxy: Cache error response (5 minutes)
Request 2-100: Proxy → Return cached error
Client: Keep retrying (3 attempts × multiple services)
Result: Even more requests to Binance → Rate limit hit
```

### Why Exchange Info is Critical

Exchange info is **required** for:
- Symbol filtering (lot size, min/max quantities)
- Position size calculations
- Order validation
- Trading operations

**The scanner cannot run safely without exchange info.**

---

## Fixes Applied

### 1. ✅ Don't Cache Error Responses (proxy-server.cjs)

**Before:**
```javascript
// Cache the result (including errors!)
exchangeInfoCache = data;
exchangeInfoCacheTime = now;
```

**After:**
```javascript
// ✅ FIX: Only cache successful responses (not errors)
if (!data.code || data.code >= 0) {
  // Cache successful responses only
  exchangeInfoCache = data;
  exchangeInfoCacheTime = now;
} else {
  // Error response - don't cache
  console.error(`[PROXY] ❌ Error response not cached: code ${data.code}`);
}
```

### 2. ✅ Increased Cache Duration (proxy-server.cjs)

**Before:** 5 minutes
**After:** 30 minutes

**Rationale:**
- Exchange info changes infrequently
- Longer cache = fewer Binance API calls
- Reduces risk of hitting rate limits

### 3. ✅ Prevent Scanner from Running Without Exchange Info (AutoScannerService.jsx)

**Before:**
- Returned empty `{}` on rate limit
- Scanner would try to run without exchange info

**After:**
- Throws error on rate limit
- Blocks scanner initialization
- Clear error message with wait time

### 4. ✅ Better Rate Limit Handling

- Detects rate limit errors early
- Skips unnecessary retries during ban
- Shows clear wait time information
- Retries automatically when ban expires

---

## Prevention Strategies

### 1. **Proper Caching**
- ✅ Don't cache error responses
- ✅ Cache successful responses for 30 minutes
- ✅ Check cache before making Binance API calls

### 2. **Request Frequency**
- ✅ Only request exchange info once during initialization
- ✅ Use cached data for subsequent requests
- ✅ Don't retry during active rate limits

### 3. **Error Detection**
- ✅ Detect Binance error responses early
- ✅ Parse ban expiration timestamps
- ✅ Wait until ban expires before retrying

### 4. **System Design**
- ✅ Exchange info is required - fail fast if not available
- ✅ Clear error messages with actionable information
- ✅ Don't allow scanner to run in degraded mode

---

## Why This Happened

### The Caching Bug

The proxy was caching **all** responses, including error responses. This meant:

1. **First request:** Binance returns rate limit error
2. **Proxy caches error:** Stores `{code: -1003, msg: '...'}` for 5 minutes
3. **Subsequent requests:** Proxy returns cached error immediately
4. **Client retries:** Tries 3 times, each getting cached error
5. **Multiple services:** Each service requesting exchange info
6. **Result:** Many requests hitting Binance → Rate limit

### The Fix

Now:
1. **First request:** Binance returns rate limit error
2. **Proxy doesn't cache error:** Returns error but doesn't cache
3. **Next request:** Proxy makes fresh request to Binance
4. **If ban expired:** Gets fresh data
5. **If ban active:** Gets fresh error (but doesn't cache it)
6. **Result:** Fewer requests, proper error handling

---

## Current Status

✅ **Fixed:**
- Proxy no longer caches error responses
- Cache duration increased to 30 minutes
- Scanner blocked from running without exchange info
- Better rate limit detection and handling

✅ **Expected Behavior:**
- Exchange info cached for 30 minutes (successful responses only)
- Rate limit errors not cached (fresh check on each request)
- Scanner fails initialization if exchange info unavailable
- Clear error messages with wait times

---

## Recommendations

1. **Monitor Rate Limits:**
   - Track Binance API call frequency
   - Implement request rate limiting
   - Use WebSocket Streams for live data (as Binance suggests)

2. **Cache Management:**
   - Monitor cache hit rates
   - Adjust cache duration based on usage patterns
   - Consider per-trading-mode caching

3. **Error Handling:**
   - Implement exponential backoff for rate limits
   - Queue requests during rate limit bans
   - Show user-friendly wait time messages

4. **Alternative Solutions:**
   - Use Binance WebSocket Streams for real-time data
   - Implement request queuing/throttling
   - Consider using multiple API keys (if allowed)

