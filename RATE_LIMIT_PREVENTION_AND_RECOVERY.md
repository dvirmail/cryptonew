# Rate Limit Prevention and Recovery System

## Overview

This document describes the comprehensive rate limit prevention and recovery system implemented to:
1. **Prevent** hitting Binance rate limits
2. **Recover** automatically when rate limits are encountered

---

## Part A: Rate Limit Prevention

### 1. **Request Throttling (Client-Side)**

**Location:** `AutoScannerService.jsx`

**Implementation:**
- Minimum 1 minute between exchange info requests
- Tracks last attempt time (`_exchangeInfoLastAttempt`)
- Automatically waits if requests are too frequent

```javascript
const timeSinceLastAttempt = now - this._exchangeInfoLastAttempt;
if (timeSinceLastAttempt < this._exchangeInfoMinInterval && this._exchangeInfoLastAttempt > 0) {
    const waitTime = this._exchangeInfoMinInterval - timeSinceLastAttempt;
    await new Promise(resolve => setTimeout(resolve, waitTime));
}
```

**Benefits:**
- Prevents rapid-fire requests
- Reduces chance of hitting rate limits
- Works even if multiple services request exchange info

### 2. **Duplicate Request Prevention**

**Location:** `AutoScannerService.jsx`

**Implementation:**
- Tracks loading state (`_exchangeInfoLoading`)
- Reuses existing promise if request in progress
- Prevents concurrent duplicate requests

```javascript
if (this._exchangeInfoLoading && this._exchangeInfoLoadPromise) {
    console.log('Exchange info load already in progress, waiting for existing request...');
    return await this._exchangeInfoLoadPromise;
}
```

**Benefits:**
- Prevents multiple simultaneous requests
- Reduces load on Binance API
- Ensures only one request at a time

### 3. **Client-Side Caching**

**Location:** `AutoScannerService.jsx`

**Implementation:**
- Checks if exchange info already loaded
- Returns cached data immediately if available
- Avoids unnecessary API calls

```javascript
if (this.state.exchangeInfo && Object.keys(this.state.exchangeInfo).length > 0) {
    console.log('Using cached exchange info');
    return this.state.exchangeInfo;
}
```

**Benefits:**
- Instant response for cached data
- No API calls needed
- Works across page reloads (if state persisted)

### 4. **Proxy-Side Caching (30 Minutes)**

**Location:** `proxy-server.cjs`

**Implementation:**
- Caches successful responses for 30 minutes
- Returns cached data if available
- **Crucially:** Does NOT cache error responses

```javascript
const EXCHANGE_INFO_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

if (exchangeInfoCache && (now - exchangeInfoCacheTime) < EXCHANGE_INFO_CACHE_DURATION) {
    return res.json({ success: true, data: exchangeInfoCache, cached: true });
}
```

**Benefits:**
- Dramatically reduces Binance API calls
- 30-minute cache = only 48 requests per day maximum
- Shared across all clients (proxy-level caching)

### 5. **Proxy-Side Request Throttling**

**Location:** `proxy-server.cjs`

**Implementation:**
- Minimum 1 minute between requests to Binance
- Returns expired cache if available (rather than waiting)
- Waits if no cache available

```javascript
const EXCHANGE_INFO_MIN_INTERVAL = 60000; // 1 minute

if (timeSinceLastRequest < EXCHANGE_INFO_MIN_INTERVAL && exchangeInfoLastRequestTime > 0) {
    // Return expired cache if available
    if (exchangeInfoCache) {
        return res.json({ success: true, data: exchangeInfoCache, cached: true, expired: true });
    }
    // Otherwise wait
    await new Promise(resolve => setTimeout(resolve, waitTime));
}
```

**Benefits:**
- Prevents proxy from making too-frequent requests
- Works even if multiple clients request simultaneously
- Provides stale data rather than waiting (better UX)

### 6. **No Error Response Caching**

**Location:** `proxy-server.cjs`

**Implementation:**
- Detects Binance error responses (code < 0)
- Does NOT cache error responses
- Allows fresh checks on next request

```javascript
if (parsed.code && parsed.code < 0) {
    console.error('Binance returned error - NOT caching');
    resolve(parsed); // Return error but don't cache
    return;
}

// Only cache successful responses
if (!data.code || data.code >= 0) {
    exchangeInfoCache = data;
    exchangeInfoCacheTime = now;
}
```

**Benefits:**
- Prevents cached errors from blocking recovery
- Allows system to retry when ban expires
- Fresh error check on each request

---

## Part B: Rate Limit Recovery

### 1. **Background Retry Mechanism**

**Location:** `AutoScannerService.jsx`

**Implementation:**
- Detects rate limit errors (`error.isRateLimit`)
- Starts background interval that checks when ban expires
- Automatically retries when ban expires
- Restarts retry process if still rate limited

```javascript
_startExchangeInfoBackgroundRetry(rateLimitError) {
    const waitTime = rateLimitError.waitTime || 60000;
    const banUntil = rateLimitError.banUntil || (Date.now() + waitTime);
    const retryInterval = Math.min(waitTime, 60000); // Check every minute

    this._exchangeInfoRetryInterval = setInterval(async () => {
        if (Date.now() >= banUntil) {
            // Ban expired - try to load
            const exchangeInfo = await this._loadExchangeInfo();
            if (exchangeInfo) {
                this.state.exchangeInfo = exchangeInfo;
                // Notify subscribers and reinitialize PositionManager
            }
        }
    }, retryInterval);
}
```

**Benefits:**
- Automatic recovery without user intervention
- Continues working once ban expires
- Handles extended bans gracefully

### 2. **Degraded Mode Initialization**

**Location:** `LifecycleService.jsx`

**Implementation:**
- Catches rate limit errors during initialization
- Allows scanner to initialize WITHOUT exchange info
- Starts background retry process
- Logs warnings about degraded mode

```javascript
try {
    exchangeInfo = await this._loadExchangeInfo();
} catch (error) {
    if (error.isRateLimit) {
        // Allow initialization to continue
        console.warn('Scanner will continue in degraded mode');
        // Background retry already started by _loadExchangeInfo
    } else {
        throw error; // Other errors still block
    }
}
```

**Benefits:**
- Scanner can start even if rate limited
- Background retry will load exchange info when available
- User doesn't have to wait for ban to expire

### 3. **PositionManager Graceful Handling**

**Location:** `LifecycleService.jsx`

**Implementation:**
- Catches PositionManager initialization errors
- Allows initialization to continue if exchange info missing
- Logs warnings but doesn't block

```javascript
try {
    await this.scannerService.positionManager.initialize();
} catch (positionError) {
    if (!this.scannerService.state.exchangeInfo) {
        console.warn('PositionManager initialization deferred - waiting for exchange info');
        // Continue initialization
    } else {
        throw positionError; // Other errors still block
    }
}
```

**Benefits:**
- Scanner can start without PositionManager fully initialized
- PositionManager will work once exchange info loads
- Non-blocking initialization

### 4. **Automatic PositionManager Reinitialization**

**Location:** `AutoScannerService.jsx` (in background retry)

**Implementation:**
- When exchange info loads successfully after ban
- Automatically reinitializes PositionManager
- Ensures full functionality restored

```javascript
if (exchangeInfo && Object.keys(exchangeInfo).length > 0) {
    this.state.exchangeInfo = exchangeInfo;
    
    // Reinitialize PositionManager if scanner is running
    if (this.state.isRunning) {
        if (this.positionManager && typeof this.positionManager.initialize === 'function') {
            await this.positionManager.initialize();
        }
    }
}
```

**Benefits:**
- Full functionality restored automatically
- No manual intervention needed
- Seamless transition from degraded to full mode

---

## Summary

### Prevention Measures:
1. ✅ Client-side request throttling (1 min minimum)
2. ✅ Duplicate request prevention
3. ✅ Client-side caching
4. ✅ Proxy-side caching (30 minutes)
5. ✅ Proxy-side request throttling
6. ✅ No error response caching

### Recovery Measures:
1. ✅ Background retry mechanism
2. ✅ Degraded mode initialization
3. ✅ PositionManager graceful handling
4. ✅ Automatic reinitialization

### Expected Behavior:

**Normal Operation:**
- Exchange info cached for 30 minutes
- Maximum 1 request per minute to Binance
- Shared cache across all clients
- No duplicate requests

**Rate Limit Encountered:**
- Background retry starts immediately
- Scanner initializes in degraded mode
- Checks every minute for ban expiration
- Automatically loads exchange info when ban expires
- Full functionality restored automatically

**Result:**
- **Prevention:** Dramatically reduced API calls (max 48/day with 30-min cache)
- **Recovery:** Automatic recovery without user intervention
- **UX:** Scanner can start even if rate limited, upgrades automatically when ban expires

