
/**
 * Enhanced API Queue with Improved Circuit Breaker and Rate Limiting
 */

// Add lightweight debug helper (toggle with window.DEBUG_API_QUEUE=true or localStorage.debug_api_queue=1)
const DEBUG_APIQ = {
  enabled() {
    try {
      if (typeof window !== 'undefined') {
        if (window.DEBUG_API_QUEUE === true) return true;
        const v = localStorage.getItem('debug_api_queue');
        return v === '1' || v === 'true';
      }
    } catch (_e) {}
    // DEFAULT ON for debugging position closing issues
    return true;
  },
  log(tag, payload) {
    if (!this.enabled()) return;
    const ts = new Date().toISOString();
    if (payload !== undefined) {
      //try { console.log(`[API_QUEUE] ${ts} ${tag}`, payload); } catch { console.log(`[API_QUEUE] ${ts} ${tag}`); }
    } else {
      console.log(`[API_QUEUE] ${ts} ${tag}`);
    }
  }
};

// NEW: Trade debug helper (toggle with window.DEBUG_TRADE_LOGS=true or localStorage.debug_trade=1)
const DEBUG_TRADE = {
  enabled() {
    try {
      if (typeof window !== 'undefined') {
        if (window.DEBUG_TRADE_LOGS === true) return true;
        const v = localStorage.getItem('debug_trade');
        return v === '1' || v === 'true';
      }
    } catch (_e) {}
    // DEFAULT ON for debugging position closing issues
    return true;
  },
  log(tag, payload) {
    if (!this.enabled()) return;
    const ts = new Date().toISOString();
    try {
    } catch {
    }
  }
};

// Ensure debug logs are ALWAYS enabled (no need to toggle flags)
// CHANGED: remove forced enable to respect toggles and keep logs quiet by default
try {
  // removed forced enable: use DEBUG_APIQ.enabled() and DEBUG_TRADE.enabled() toggles
} catch (_e) { /* no-op */ }

// Small safe args preview for logs
function getSafeArgsPreview(args) {
  try {
    const a = Array.isArray(args) ? args : [];
    const preview = a.map((v) => {
      if (v && typeof v === 'object') {
        const keys = Object.keys(v);
        const pick = {};
        for (const k of keys.slice(0, 10)) pick[k] = v[k];
        return pick;
      }
      return v;
    });
    return preview;
  } catch (_e) {
    return '[unavailable]';
  }
}

// Add import for ID generator
import { generateTradeId } from "@/components/utils/id";

// ADDED: In-memory MarketAlert buffer (will be flushed once per scan cycle)
const marketAlertBuffer = [];
export const addMarketAlertToBuffer = (alert) => {
  if (alert && typeof alert === 'object') {
    marketAlertBuffer.push(alert);
    DEBUG_APIQ.log('[MARKET_ALERT_BUFFER_ADD]', { size: marketAlertBuffer.length });
  }
};
export const getMarketAlertBufferSize = () => marketAlertBuffer.length;
export const flushMarketAlertBuffer = async () => {
  if (marketAlertBuffer.length === 0) {
    DEBUG_APIQ.log('[MARKET_ALERT_BUFFER_FLUSH_SKIPPED]', { size: 0 });
    return { created: 0 };
  }
  const { MarketAlert } = await import("@/api/entities");
  const batch = marketAlertBuffer.splice(0, marketAlertBuffer.length);
  try {
    // Prefer bulk create; fall back to per-record if needed
    if (MarketAlert.bulkCreate) {
      await MarketAlert.bulkCreate(batch);
    } else {
      for (const rec of batch) {
        await MarketAlert.create(rec);
      }
    }

    // Trim to 10 newest for safety (mirrors queueEntityCall behavior)
    const latest = await MarketAlert.list("-created_date", 50);
    if (Array.isArray(latest) && latest.length > 10) {
      const toDelete = latest.slice(10);
      for (const rec of toDelete) {
        try {
          await MarketAlert.delete(rec.id);
        } catch (_e) {}
      }
      DEBUG_APIQ.log('[MARKET_ALERT_BUFFER_TRIM]', { deleted: toDelete.length });
    }

    // Update in-memory cache after flush
    marketAlertCache.items = Array.isArray(latest) ? latest.slice(0, 10) : [];
    marketAlertCache.lastFetched = Date.now();
    try {
      if (typeof window !== "undefined") {
        window.__marketAlertCache = { ...marketAlertCache, refreshedAt: new Date(marketAlertCache.lastFetched).toISOString() };
      }
    } catch (_e) {}

    DEBUG_APIQ.log('[MARKET_ALERT_BUFFER_FLUSHED]', { created: batch.length, remainingBuffer: marketAlertBuffer.length });
    return { created: batch.length };
  } catch (error) {
    DEBUG_APIQ.log('[MARKET_ALERT_BUFFER_FLUSH_ERROR]', { error: error?.message || String(error) });
    // Re-queue the batch back into buffer in case of failure
    batch.forEach((rec) => marketAlertBuffer.push(rec));
    throw error;
  }
};

// ADDED: Lightweight in-memory cache for MarketAlert (top 10)
const marketAlertCache = {
  items: [],
  lastFetched: 0
};

export const getMarketAlertCache = () => {
  return Array.isArray(marketAlertCache.items) ? marketAlertCache.items : [];
};

export async function refreshMarketAlertCache({ limit = 10, timeoutMs = 30000 } = {}) {
  DEBUG_APIQ.log('[REFRESH_MARKET_ALERT_CACHE_START]', { limit, timeoutMs });
  try {
    // Use apiQueue to run a single controlled fetch
    const result = await apiQueue.enqueue(
      async () => {
        const { MarketAlert } = await import("@/api/entities");
        // Fetch slightly more than 'limit' to ensure we have enough to slice, in case of race conditions
        const latest = await MarketAlert.list("-created_date", Math.max(10, limit + 5));
        return Array.isArray(latest) ? latest.slice(0, 10) : [];
      },
      "MarketAlert.refreshCache",
      0, // no cache in apiQueue; we manage our own cache below
      "low", // Priority low for this background refresh
      { timeoutMs }
    );
    marketAlertCache.items = Array.isArray(result) ? result.slice(0, 10) : [];
    marketAlertCache.lastFetched = Date.now();

    // Mirror to window for debugging/visibility if available
    try {
      if (typeof window !== "undefined") {
        window.__marketAlertCache = { ...marketAlertCache, refreshedAt: new Date(marketAlertCache.lastFetched).toISOString() };
        DEBUG_APIQ.log('[REFRESH_MARKET_ALERT_CACHE_WINDOW_DEBUG]', { itemsCount: marketAlertCache.items.length });
      }
    } catch (_e) { /* ignore error if window not available */ }
    DEBUG_APIQ.log('[REFRESH_MARKET_ALERT_CACHE_SUCCESS]', { itemsCount: marketAlertCache.items.length });
    return marketAlertCache.items;
  } catch (error) {
    DEBUG_APIQ.log('[REFRESH_MARKET_ALERT_CACHE_FAIL]', { error: error.message });
    // If refresh fails, return current cache to prevent further errors
    return getMarketAlertCache();
  }
}

// ADDED: Track already-deleted and pending-deletion LivePosition IDs to avoid repeated calls
const deletedLivePositionIds = new Set();
const pendingLivePositionDeletes = new Set();

const isLivePositionDeleted = (id) => {
  if (!id) return false;
  return deletedLivePositionIds.has(String(id));
};

const markLivePositionDeleted = (id) => {
  if (!id) return;
  const key = String(id);
  deletedLivePositionIds.add(key);
  pendingLivePositionDeletes.delete(key);
  DEBUG_APIQ.log('[LIVE_POSITION_DELETED_MARKED]', { id: key, deletedCount: deletedLivePositionIds.size });
  try {
    if (typeof window !== 'undefined') {
      // Expose for diagnostics if needed
      window.__deletedLivePositions = Array.from(deletedLivePositionIds);
    }
  } catch (_e) {}
};

// Helper: resolve local proxy url from scanner settings or default
const resolveLocalProxyUrl = () => {
  try {
    if (typeof window !== 'undefined') {
      // Prefer explicit service accessor if exposed
      const svc = window.autoScannerService || window.scannerService || null;
      const state = svc && typeof svc.getState === 'function' ? svc.getState() : null;
      const urlFromState = state?.settings?.local_proxy_url;
      if (urlFromState && typeof urlFromState === 'string') return urlFromState;
    }
  } catch (_e) {}
  // Default fallback
  return 'http://localhost:3001';
};

// Helper: attempt dust conversion via local proxy
async function attemptDustConvert(tradingMode, explicitProxyUrl) {
  const proxyUrl = explicitProxyUrl || resolveLocalProxyUrl();
  const mode = (tradingMode === 'live') ? 'live' : 'testnet';

  const payload = { tradingMode: mode };
  const url = `${proxyUrl.replace(/\/+$/, '')}/api/binance/dustConvert`;

  DEBUG_APIQ.log('[DUST_CONVERT_ATTEMPT]', { url, mode });

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    const ok = !!data?.success && resp.ok;

    DEBUG_APIQ.log('[DUST_CONVERT_RESULT]', { ok, status: resp.status, data });

    return { ok, data, status: resp.status };
  } catch (error) {
    DEBUG_APIQ.log('[DUST_CONVERT_ERROR]', { message: error?.message || String(error) });
    return { ok: false, error };
  }
}

export const retryProfiles = {
    critical: {
        retries: 5, // INCREASED from 3
        network_error: 4, // INCREASED from 2
        server_error: 3, // INCREASED from 2
        baseDelayMs: 2000, // INCREASED from 1000
        backoffMultiplier: 2.5 // INCREASED from 2
    },
    normal: {
        retries: 3,
        network_error: 2,
        server_error: 2,
        baseDelayMs: 1000,
        backoffMultiplier: 2
    },
    low: {
        retries: 2,
        network_error: 1,
        server_error: 1,
        baseDelayMs: 500,
        backoffMultiplier: 1.5
    }
};

class ApiQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.requestDelay = 100; // REDUCED: Default delay from 1000ms to 100ms for faster processing
    this.maxRetries = 5;
    this.maxNetworkRetries = 15;
    
    this.rateLimitCount = 0;
    this.isCircuitOpen = false;
    this.lastRateLimitTime = null;
    this.circuitResetTime = 120000;
    this.maxRateLimitsBeforeCircuitOpen = 5;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5;
    
    this.setupPeriodicCleanup();

    // NEW: boot log
    DEBUG_APIQ.log('[INIT]', {
      requestDelay: this.requestDelay,
      maxRetries: this.maxRetries,
      maxNetworkRetries: this.maxNetworkRetries,
      circuitResetTime: this.circuitResetTime,
      maxRateLimitsBeforeCircuitOpen: this.maxRateLimitsBeforeCircuitOpen,
      maxConsecutiveErrors: this.maxConsecutiveErrors
    });
  }

  setupPeriodicCleanup() {
    setInterval(() => {
      this.aggressiveCacheCleanup();
    }, 300000);
  }

  aggressiveCacheCleanup() {
    const now = Date.now();
    const maxCacheAge = 180000;
    let cleanedCount = 0;
    
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > maxCacheAge) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
        cleanedCount++;
      }
    }
    
    if (this.cache.size > 100) {
      const sortedEntries = Array.from(this.cacheTimestamps.entries())
        .sort((a, b) => a[1] - b[1]);
      
      const entriesToRemove = sortedEntries.slice(0, this.cache.size - 50);
      entriesToRemove.forEach(([key]) => {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
        cleanedCount++;
      });
    }
    
    if (cleanedCount > 0) {
      DEBUG_APIQ.log('[CACHE_CLEANUP]', { cleanedCount, cacheSize: this.cache.size });
    }
  }

  checkCircuitBreaker() {
    if (this.rateLimitCount >= this.maxRateLimitsBeforeCircuitOpen || 
        this.consecutiveErrors >= this.maxConsecutiveErrors) {
      if (!this.isCircuitOpen) {
        DEBUG_APIQ.log('[CIRCUIT_OPEN]', {
          rateLimitCount: this.rateLimitCount,
          consecutiveErrors: this.consecutiveErrors
        });
      }
      this.isCircuitOpen = true;
      this.lastRateLimitTime = Date.now();
      
      if (typeof window !== 'undefined' && window.scannerService) {
        window.scannerService.pause();
      }
      
      return true;
    }
    return false;
  }

  shouldResetCircuit() {
    if (this.isCircuitOpen && this.lastRateLimitTime) {
      const timeSinceLastRateLimit = Date.now() - this.lastRateLimitTime;
      if (timeSinceLastRateLimit > this.circuitResetTime) {
        DEBUG_APIQ.log('[CIRCUIT_RESET]', {
          rateLimitCount: this.rateLimitCount,
          consecutiveErrors: this.consecutiveErrors,
          prevDelay: this.requestDelay
        });
        this.isCircuitOpen = false;
        this.rateLimitCount = 0;
        this.consecutiveErrors = 0;
        this.requestDelay = 100; // Reset to new default delay
        return true;
      }
    }
    return false;
  }

  async enqueue(requestFn, cacheKey = null, cacheDuration = 60000, priority = 'normal', timeoutOptions = null) {
    return new Promise((resolve, reject) => {
      let timeoutMs = null;
      let retryProfile = null;

      if (timeoutOptions && typeof timeoutOptions === 'object') {
        retryProfile = timeoutOptions.retryProfile || null;
        timeoutMs = typeof timeoutOptions.timeoutMs === 'number' ? timeoutOptions.timeoutMs : null;
      } else if (typeof timeoutOptions === 'number') {
        timeoutMs = timeoutOptions; // Backward compatibility for old calls passing just timeoutMs
      }

      if (this.isCircuitOpen && !this.shouldResetCircuit()) {
        if (priority !== 'critical') {
          DEBUG_APIQ.log('[ENQUEUE_BLOCKED_CIRCUIT]', { cacheKey, priority });
          reject(new Error('Circuit breaker is open - system in recovery mode'));
          return;
        }
      }

      if (cacheKey && this.isValidCache(cacheKey, cacheDuration)) {
        DEBUG_APIQ.log('[CACHE_HIT]', { cacheKey, cacheDuration });
        resolve(this.cache.get(cacheKey));
        return;
      }

      let requestTimeout;
      if (timeoutMs !== null) {
        requestTimeout = timeoutMs;
      } else if (priority === 'critical') {
        requestTimeout = 300000;
      } else if (cacheKey && typeof cacheKey === 'string' && (cacheKey.includes('BacktestCombination') || cacheKey.includes('updateStrategyStats'))) {
        requestTimeout = 180000;
      } else {
        requestTimeout = 120000;
      }

      const request = {
        requestFn,
        cacheKey,
        cacheDuration,
        resolve,
        reject,
        retries: 0,
        priority,
        timestamp: Date.now(),
        timeoutMs: requestTimeout,
        retryProfile // NEW
      };

      DEBUG_APIQ.log('[ENQUEUE]', {
        cacheKey,
        priority,
        timeoutMs: requestTimeout,
        cacheDuration,
        queueLengthBefore: this.queue.length,
        isCircuitOpen: this.isCircuitOpen,
        hasRetryProfile: !!retryProfile
      });

      if (priority === 'critical') {
        this.queue.unshift(request);
      } else {
        this.queue.push(request);
      }

      if (this.queue.length > 500) {
        let dropped = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority !== 'critical') {
                const oldRequest = this.queue.splice(i, 1)[0];
                DEBUG_APIQ.log('[QUEUE_OVERFLOW_DROP]', { droppedCacheKey: oldRequest.cacheKey, priority: oldRequest.priority });
                oldRequest.reject(new Error('Queue overflow - non-critical request dropped'));
                dropped = true;
                break;
            }
        }
        if (!dropped) {
            console.warn("CRITICAL QUEUE OVERFLOW: Too many critical requests, unable to drop any. System may become unstable.");
        }
      }

      this.processQueue();
    });
  }

  isValidCache(key, duration) {
    if (duration === 0) return false;
    if (!this.cache.has(key) || !this.cacheTimestamps.has(key)) {
      return false;
    }
    return Date.now() - this.cacheTimestamps.get(key) < duration;
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.shouldResetCircuit();

    if (this.isCircuitOpen) {
      DEBUG_APIQ.log('[PROCESS_CIRCUIT_OPEN_FILTER]', { before: this.queue.length });
      this.queue = this.queue.filter(req => req.priority === 'critical');
      DEBUG_APIQ.log('[PROCESS_CIRCUIT_OPEN_REMAIN]', { after: this.queue.length });
      if (this.queue.length === 0) {
        return;
      }
    }

    this.isProcessing = true;
    DEBUG_APIQ.log('[PROCESS_START]', { queueLength: this.queue.length });

    while (this.queue.length > 0) {
      const request = this.queue.shift();
      const requestAge = Date.now() - request.timestamp;

      if (requestAge > request.timeoutMs) {
        DEBUG_APIQ.log('[REQUEST_EXPIRED_BEFORE_EXEC]', { cacheKey: request.cacheKey, priority: request.priority, waitedMs: requestAge, timeoutMs: request.timeoutMs });
        request.reject(new Error(`Request expired after ${Math.round(requestAge/1000)}s (timeout: ${Math.round(request.timeoutMs/1000)}s)`));
        continue;
      }
      
      const execStart = Date.now();
      DEBUG_APIQ.log('[DEQUEUE]', { cacheKey: request.cacheKey, priority: request.priority, waitedMs: requestAge, timeoutMs: request.timeoutMs });

      try {
        const result = await this.executeWithRetry(request);
        
        if (request.cacheKey && request.cacheDuration > 0) {
          this.cache.set(request.cacheKey, result);
          this.cacheTimestamps.set(request.cacheKey, Date.now());
        }
        
        request.resolve(result);
        const execMs = Date.now() - execStart;
        DEBUG_APIQ.log('[REQUEST_OK]', { cacheKey: request.cacheKey, priority: request.priority, execMs, queueRemaining: this.queue.length });
        
        this.consecutiveErrors = 0;
        
        if (this.rateLimitCount > 0) {
          this.rateLimitCount = Math.max(0, this.rateLimitCount - 0.5);
        }
        
        const delay = this.isCircuitOpen ? this.requestDelay * 2 : this.requestDelay;
        await this.delay(delay);
        
      } catch (error) {
        const execMs = Date.now() - execStart;
        this.consecutiveErrors++;
        DEBUG_APIQ.log('[REQUEST_FAIL]', { cacheKey: request.cacheKey, priority: request.priority, execMs, error: (error && error.message) || String(error), consecutiveErrors: this.consecutiveErrors });
        request.reject(error);
        
        const lowerCaseError = (error.message || '').toLowerCase();
        if (lowerCaseError.includes('rate limit') || lowerCaseError.includes('500') || lowerCaseError.includes('internal server error')) {
          this.rateLimitCount++;
          this.lastRateLimitTime = Date.now();
          this.checkCircuitBreaker();
          DEBUG_APIQ.log('[RATE_LIMIT_OR_SERVER]', { rateLimitCount: this.rateLimitCount, lastRateLimitTime: this.lastRateLimitTime });
        }
        
        // This delay is after a failure *before* any retries. executeWithRetry handles internal retries.
        // This delay is just to cool down the queue processing if a request failed and wasn't retried or exhausted retries.
        await this.delay(Math.min(this.requestDelay * 2, 10000));
      }
    }

    this.isProcessing = false;
    DEBUG_APIQ.log('[PROCESS_DONE]', { queueLength: this.queue.length, rateLimitCount: this.rateLimitCount, consecutiveErrors: this.consecutiveErrors });
  }

  async executeWithRetry(request) {
    let lastError;
    // this.maxNetworkRetries serves as a global hard cap for any attempt to retry.
    // Individual retry profiles or categories will set their own effective max attempts.
    // Default to the request's priority profile if available, otherwise use global maxRetries
    const defaultProfile = retryProfiles[request.priority] || retryProfiles.normal;
    const globalMaxAttempts = defaultProfile.retries; 

    for (let attempt = 0; attempt <= globalMaxAttempts; attempt++) {
      try {
        DEBUG_APIQ.log('[EXEC_ATTEMPT]', { attempt: attempt + 1, cacheKey: request.cacheKey, priority: request.priority });
        const result = await request.requestFn();
        DEBUG_APIQ.log('[EXEC_SUCCESS]', { attempt: attempt + 1, cacheKey: request.cacheKey });
        return result;
      } catch (error) {
        lastError = error;
        
        // ADDED: Enhanced logging for liveTradingAPI failures
        if (request.cacheKey && typeof request.cacheKey === 'string' && request.cacheKey.includes('liveTradingAPI')) {
          DEBUG_APIQ.log('[LIVE_TRADING_API_CALL_FAILED]', {
            attempt: attempt + 1,
            cacheKey: request.cacheKey,
            errorMessage: error.message,
            errorStack: error.stack,
            fullError: error,
            priority: request.priority
          });
        }
        
        const lowerCaseError = (error.message || '').toLowerCase();
        
        // ENHANCED: Add more specific Binance rate limit error codes/messages
        const isRateLimit = lowerCaseError.includes('429') || lowerCaseError.includes('rate limit') || lowerCaseError.includes('too many orders') || lowerCaseError.includes('-1015');
        const isServerError = lowerCaseError.includes('500') || lowerCaseError.includes('internal server error') || lowerCaseError.includes('502') || lowerCaseError.includes('503') || lowerCaseError.includes('504') || lowerCaseError.includes('service unavailable');
        const isNetworkError = lowerCaseError.includes('network') || lowerCaseError.includes('fetch') || lowerCaseError.includes('timeout') || lowerCaseError.includes('econnreset') || lowerCaseError.includes('connection') || lowerCaseError.includes('cors') || lowerCaseError.includes('proxy'); // ADDED proxy for reconciliation
        const isNonRetriableError = lowerCaseError.includes('400') || lowerCaseError.includes('401') || lowerCaseError.includes('403') || lowerCaseError.includes('404');

        let category = 'other';
        if (isRateLimit) category = 'rate_limit';
        else if (isServerError) category = 'server_error';
        else if (isNetworkError) category = 'network_error';
        else if (isNonRetriableError) category = 'non_retriable';

        DEBUG_APIQ.log('[EXEC_FAIL]', { attempt: attempt + 1, category, message: error.message, cacheKey: request.cacheKey });

        if (isNonRetriableError) {
          DEBUG_APIQ.log('[EXEC_GIVEUP_NON_RETRIABLE]', { cacheKey: request.cacheKey });
          throw error;
        }

        // NEW: allow per-request retry overrides
        // Merge the default profile for the request's priority with any specific overrides
        let profile = { 
          ...defaultProfile, 
          ...(request.retryProfile || {}) 
        }; // Ensure profile is an object for safe property access

        let currentMaxRetryAttempts;
        // Check for specific category overrides first, then general `retries`
        if (profile[category] !== undefined && typeof profile[category] === 'number') {
          currentMaxRetryAttempts = profile[category];
        } else {
          currentMaxRetryAttempts = profile.retries; // Use the general retry count from the profile
        }

        // If we've exhausted retries for this specific error category
        if (attempt >= currentMaxRetryAttempts) {
          if ((isRateLimit || isServerError) && request.cacheKey && this.cache.has(request.cacheKey)) {
            DEBUG_APIQ.log('[EXEC_STALE_RETURN]', { cacheKey: request.cacheKey, errorCategory: category });
            return this.cache.get(request.cacheKey);
          }
          DEBUG_APIQ.log('[EXEC_MAX_RETRIES_EXCEEDED]', { cacheKey: request.cacheKey, currentMaxRetryAttempts: currentMaxRetryAttempts, category });
          throw lastError;
        }

        if (isRateLimit || isServerError || isNetworkError) {
          if (isRateLimit || isServerError) {
            this.rateLimitCount++;
            this.lastRateLimitTime = Date.now();
            this.checkCircuitBreaker();
          }
          
          // Backoff with jitter based on profile
          const baseDelay = profile.baseDelayMs || 1000;
          const backoffMultiplier = profile.backoffMultiplier || 2;
          
          const exp = Math.pow(backoffMultiplier, attempt);
          const jitter = 500 + Math.random() * 1500; // 0.5-2.0s jitter
          const backoffDelay = Math.min(60000, baseDelay * exp + jitter); // Cap max delay at 60 seconds
          DEBUG_APIQ.log('[EXEC_BACKOFF]', { category, backoffDelayMs: Math.round(backoffDelay), attempt: attempt + 1, currentMaxRetryAttempts, cacheKey: request.cacheKey });
          
          await this.delay(backoffDelay);
        } else {
          // If it's another type of error that is not explicitly handled as retriable (e.g., malformed request), rethrow immediately
          throw error;
        }
      }
    }
    
    DEBUG_APIQ.log('[EXEC_THROW_LAST_ERROR]', { cacheKey: request.cacheKey, message: lastError?.message });
    throw lastError;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  clearCache(key = null) {
    if (key) {
      if (typeof key === 'string') {
        const keysToDelete = [];
        for (const cacheKey of this.cache.keys()) {
          if (cacheKey.startsWith(key)) {
            keysToDelete.push(cacheKey);
          }
        }
        keysToDelete.forEach(k => {
          this.cache.delete(k);
          this.cacheTimestamps.delete(k);
        });
        DEBUG_APIQ.log('[CACHE_CLEAR_PREFIX]', { prefix: key, cleared: keysToDelete.length });
      } else {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
        DEBUG_APIQ.log('[CACHE_CLEAR_KEY]', { key });
      }
    } else {
      const sizeBefore = this.cache.size;
      this.cache.clear();
      this.cacheTimestamps.clear();
      DEBUG_APIQ.log('[CACHE_CLEAR_ALL]', { sizeBefore });
    }
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      isCircuitOpen: this.isCircuitOpen,
      rateLimitCount: this.rateLimitCount,
      consecutiveErrors: this.consecutiveErrors,
      requestDelay: this.requestDelay,
      cacheSize: this.cache.size,
      lastRateLimitTime: this.lastRateLimitTime
    };
  }

  emergencyPause() {
    this.isCircuitOpen = true;
    this.queue = [];
    this.consecutiveErrors = 0;
    DEBUG_APIQ.log('[EMERGENCY_PAUSE]', {});
  }

  resume() {
    this.isCircuitOpen = false;
    this.rateLimitCount = 0;
    this.consecutiveErrors = 0;
    this.requestDelay = 100; // Reset to new default delay
    DEBUG_APIQ.log('[RESUME]', {});
  }
}

const apiQueue = new ApiQueue();

export const queueEntityCall = async (entityName, method, ...args) => {
  // ADDED: Early guard for LivePosition delete/update duplicates
  if (entityName === 'LivePosition') {
    if (method === 'delete') {
      const id = args && args.length > 0 ? args[0] : null;
      if (!id) {
        DEBUG_APIQ.log('[LIVE_POSITION_DELETE_MISSING_ID_SKIP]', {});
        return { skipped: true, reason: 'missing_id' };
      }
      if (isLivePositionDeleted(id)) {
        DEBUG_APIQ.log('[LIVE_POSITION_DELETE_ALREADY_DELETED_SKIP]', { id });
        return { deleted: true, alreadyDeleted: true, skipped: true };
      }
      if (pendingLivePositionDeletes.has(String(id))) {
        DEBUG_APIQ.log('[LIVE_POSITION_DELETE_PENDING_SKIP]', { id });
        return { skipped: true, pending: true };
      }
      pendingLivePositionDeletes.add(String(id));
    } else if (method === 'update') {
      const id = args && args.length > 0 ? args[0] : null;
      if (isLivePositionDeleted(id)) {
        DEBUG_APIQ.log('[LIVE_POSITION_UPDATE_ON_DELETED_SKIP]', { id });
        return { skipped: true, reason: 'already_deleted' };
      }
    }
  }

  // NEW: Log Trade calls at enqueue time (before we mutate args)
  if (entityName === 'Trade') {
    DEBUG_TRADE.log('[ENQUEUE]', {
      entity: entityName,
      method,
      argsPreview: getSafeArgsPreview(args)
    });
  }

  const cacheKey = `${entityName}.${method}.${JSON.stringify(args)}`;
  const cacheDuration = method === 'list' || method === 'filter' ? 120000 : 30000;
  
  let priority = 'normal';
  let timeoutMs = null;
  let retryProfile = null; // NEW

  // CRITICAL: Prioritize essential entity operations to prevent them from being dropped
  if (entityName === 'ScanSettings' || entityName === 'User' || entityName === 'WalletSummary' || entityName === 'CentralWalletState') {
    priority = 'critical';
  }
  
  if (entityName === 'CentralWalletState' && (method === 'update' || method === 'create')) {
    priority = 'critical';
  }

  // ADDED: Special handling for Trade.bulkCreate with extended timeout
  if (entityName === 'Trade' && method === 'bulkCreate') {
    priority = 'critical';
    timeoutMs = 900000; // 15 minutes for bulk trade creation
    DEBUG_APIQ.log('[QUEUE_ENTITY_CALL] Trade.bulkCreate with extended timeout', { timeoutMs });
  } else if (entityName === 'Trade' && (method === 'create' || method === 'bulkCreate')) {
    priority = 'critical';
  }

  // ADDED: Stronger retry profile for Trade create/bulkCreate
  if (entityName === 'Trade' && (method === 'create' || method === 'bulkCreate')) {
    retryProfile = { 
      rate_limit: 4, 
      server_error: 5, 
      network_error: 8, 
      baseDelayMs: 2500 
    };
    DEBUG_APIQ.log('[QUEUE_ENTITY_CALL] Trade create/bulkCreate retryProfile set', { retryProfile });
  }

  // MarketAlert read: short-circuit list/filter to use cache only (avoid repeated slow calls)
  if (entityName === 'MarketAlert' && (method === 'list' || method === 'filter')) {
    const cached = getMarketAlertCache();
    DEBUG_APIQ.log('[MARKET_ALERT_CACHE_READ]', { cachedCount: cached.length, lastFetched: marketAlertCache.lastFetched ? new Date(marketAlertCache.lastFetched).toISOString() : 'never' });
    return Array.isArray(cached) ? cached.slice(0, 10) : [];
  }

  // ADDED: Delay MarketAlert creation during active scan cycles by buffering
  if (entityName === 'MarketAlert' && (method === 'create' || method === 'bulkCreate')) {
    try {
      if (typeof window !== 'undefined' && window.autoScannerService && window.autoScannerService.state?.isScanning) {
        if (method === 'bulkCreate' && Array.isArray(args[0])) {
          args[0].forEach((a) => addMarketAlertToBuffer(a));
          DEBUG_APIQ.log('[MARKET_ALERT_BUFFERED_BULK]', { count: args[0].length });
          return { buffered: true, count: args[0].length };
        } else if (method === 'create' && args[0]) {
          addMarketAlertToBuffer(args[0]);
          DEBUG_APIQ.log('[MARKET_ALERT_BUFFERED_CREATE]', {});
          return { buffered: true };
        }
      }
    } catch (_e) { /* ignore error if window.autoScannerService not available */ }
    // Non-scanning context: let it proceed with lower priority and shorter timeout
    priority = 'low';
    timeoutMs = 15000; // 15 second timeout instead of default for non list/filter ops
  }

  // Timeouts for heavy operations (if not already set above)
  if (timeoutMs === null) { // Changed to null check to ensure priority setting above can set timeoutMs
    if (method === 'create' || method === 'bulkCreate' || method === 'update' || method === 'list' || method === 'filter' || entityName === 'BacktestCombination') {
      if (entityName === 'BacktestCombination' && method === 'update') {
        timeoutMs = 480000;
      } else if (entityName !== 'MarketAlert') { // Don't override MarketAlert timeout if already set
        timeoutMs = 300000;
      }
    }
  }

  // INCREASE timeout for heavy list/filter calls to avoid queue expiry
  if ((entityName === 'HistoricalPerformance' || entityName === 'Trade') && (method === 'list' || method === 'filter')) {
    timeoutMs = Math.max(timeoutMs || 0, 600000); // 10 minutes
  }
  
  // ADDED: Extend timeout for LivePosition.delete during large cleanups and make it critical
  if (entityName === 'LivePosition' && method === 'delete') {
    timeoutMs = Math.max(timeoutMs || 0, 600000); // 10 minutes
    priority = 'critical';
  }
  
  try {
    const result = await apiQueue.enqueue(
      async () => {
        try {
          const { [entityName]: Entity } = await import(`@/api/entities`);

          let modifiedArgs = args;
          if (entityName === 'Trade') {
            if (method === 'create' && args[0] && typeof args[0] === 'object') {
              const payload = args[0];
              
              DEBUG_TRADE.log('[TRADE_CREATE_PROCESSING]', {
                tradeId: payload.trade_id,
                strategy: payload.strategy_name,
                symbol: payload.symbol,
                marketRegime: payload.market_regime || 'REGIME_NOT_PROVIDED',
                regimeConfidence: payload.regime_confidence || 'CONFIDENCE_NOT_PROVIDED',
                combinedStrength: payload.combined_strength || 'STRENGTH_NOT_PROVIDED',
                convictionScore: payload.conviction_score || 'CONVICTION_NOT_PROVIDED',
                tradingMode: payload.trading_mode || 'MODE_NOT_PROVIDED'
              });
              
              // CHANGED: Only generate trade_id if it's completely missing (for legacy compatibility)
              // New trades will already have trade_id set to the Binance orderId
              if (!payload.trade_id) {
                const ensuredTradeId = generateTradeId();
                modifiedArgs = [{ ...payload, trade_id: ensuredTradeId }];

                DEBUG_TRADE.log('[TRADE_ID_GENERATED]', { ensuredTradeId });

                // Idempotency guard: if a trade with this ID already exists, return it
                const existing = await Entity.filter({ trade_id: ensuredTradeId }, '-created_date', 1);
                if (Array.isArray(existing) && existing.length > 0) {
                  DEBUG_TRADE.log('[TRADE_FOUND_EXISTING_BY_GENERATED_ID]', { id: existing[0]?.id });
                  return existing[0];
                }
              } else {
                // trade_id is already set (likely to Binance orderId), check for duplicates
                const existing = await Entity.filter({ trade_id: payload.trade_id }, '-created_date', 1);
                if (Array.isArray(existing) && existing.length > 0) {
                  DEBUG_TRADE.log('[TRADE_FOUND_EXISTING_BY_PROVIDED_ID]', { id: existing[0]?.id });
                  return existing[0];
                }
                modifiedArgs = [payload]; // Use as-is
              }
            } else if (method === 'bulkCreate' && Array.isArray(args[0])) {
              const records = args[0];
              modifiedArgs = [
                records.map((r) => {
                  if (r && typeof r === 'object' && !r.trade_id) {
                    return { ...r, trade_id: generateTradeId() };
                  }
                  return r;
                }),
              ];
            }
          }

          // If trying to delete/update an already-deleted LivePosition, skip here too (double safety)
          if (entityName === 'LivePosition') {
            if (method === 'delete') {
              const id = modifiedArgs && modifiedArgs[0];
              if (isLivePositionDeleted(id)) {
                DEBUG_APIQ.log('[LIVE_POSITION_DELETE_ALREADY_DELETED_SKIP@EXEC]', { id });
                return { deleted: true, alreadyDeleted: true, skipped: true };
              }
            } else if (method === 'update') {
              const id = modifiedArgs && modifiedArgs[0];
              if (isLivePositionDeleted(id)) {
                DEBUG_APIQ.log('[LIVE_POSITION_UPDATE_ON_DELETED_SKIP@EXEC]', { id });
                return { skipped: true, reason: 'already_deleted' };
              }
            }
          }

          // ALIAS: Support non-standard 'save' or 'upsert' for ScanSettings (update-or-create)
          if (entityName === 'ScanSettings' && (method === 'save' || method === 'upsert')) {
            const payload = (args && typeof args[0] === 'object') ? args[0] : {};
            // Prefer updating the single settings doc if it exists, otherwise create
            const existing = await Entity.list('-created_date', 1);
            if (Array.isArray(existing) && existing.length > 0) {
              const id = existing[0].id;
              DEBUG_APIQ.log('[SCAN_SETTINGS_SAVE_ALIAS]', { action: 'update', id, via: method });
              return await Entity.update(id, payload);
            }
            DEBUG_APIQ.log('[SCAN_SETTINGS_SAVE_ALIAS]', { action: 'create', via: method });
            return await Entity.create(payload);
          }

          // Safety: Throw a clear error if the method doesn't exist (after alias handling)
          if (typeof Entity[method] !== 'function') {
            throw new Error(`Entity method not found: ${entityName}.${method}`);
          }

          const result = await Entity[method](...modifiedArgs);

          // Mark LivePosition.delete success
          if (entityName === 'LivePosition' && method === 'delete') {
            const id = modifiedArgs && modifiedArgs[0];
            markLivePositionDeleted(id);
            DEBUG_APIQ.log('[LIVE_POSITION_DELETE_OK]', { id });
          }
          
          // Additional logging for successful Trade creation
          if (entityName === 'Trade' && method === 'create' && result) {
            DEBUG_TRADE.log('[TRADE_CREATE_OK]', {
              databaseId: result.id,
              tradeId: result.trade_id,
              finalMarketRegime: result.market_regime || 'REGIME_NOT_SAVED',
              finalRegimeConfidence: result.regime_confidence || 'CONFIDENCE_NOT_SAVED',
              finalCombinedStrength: result.combined_strength || 'STRENGTH_NOT_SAVED',
              finalConvictionScore: result.conviction_score || 'CONVICTION_NOT_SAVED'
            });
          }

          // NEW: Success logging for Trade calls
          if (entityName === 'Trade') {
            let summary = result;
            try {
              if (Array.isArray(result)) {
                summary = { type: 'array', count: result.length };
              } else if (result && typeof result === 'object') {
                summary = {
                  type: 'object',
                  id: result.id,
                  trade_id: result.trade_id,
                };
              }
            } catch (_e) {}
            DEBUG_TRADE.log('[SUCCESS]', {
              entity: entityName,
              method,
              argsPreview: getSafeArgsPreview(modifiedArgs),
              summary
            });
          }

          // NEW: Enforce max 10 MarketAlert records (keep newest 10, delete older) after create/bulkCreate
          // This path is for non-buffered MarketAlert operations
          if (entityName === 'MarketAlert' && (method === 'create' || method === 'bulkCreate')) {
            try {
              // Fetch more than 10 to ensure we have enough to slice, in case of race conditions
              const latest = await Entity.list("-created_date", 50); 
              if (Array.isArray(latest) && latest.length > 10) {
                const toDelete = latest.slice(10); // keep newest 10, delete the rest
                for (const rec of toDelete) {
                  try {
                    await Entity.delete(rec.id);
                  } catch (delErr) {
                    DEBUG_APIQ.log('[MARKET_ALERT_TRIM_DELETE_FAIL]', { id: rec?.id, error: delErr?.message || String(delErr) });
                  }
                }
                DEBUG_APIQ.log('[MARKET_ALERT_TRIMMED]', { deleted: toDelete.length });
              }
              // Also update the in-memory cache after trimming or if no trim was needed
              marketAlertCache.items = Array.isArray(latest) ? latest.slice(0, 10) : [];
              marketAlertCache.lastFetched = Date.now();
              // Mirror to window if available
              try {
                if (typeof window !== "undefined") {
                  window.__marketAlertCache = { ...marketAlertCache, refreshedAt: new Date(marketAlertCache.lastFetched).toISOString() };
                }
              } catch (_e) {}

            } catch (trimErr) {
              DEBUG_APIQ.log('[MARKET_ALERT_TRIM_FAIL]', { error: trimErr?.message || String(trimErr) });
            }
          }
          
          return result;
        } catch (error) {
          // ADDED: Graceful handling for LivePosition.delete 404 (already deleted)
          const msg = (error && error.message ? String(error.message) : '').toLowerCase();
          if (entityName === 'LivePosition' && method === 'delete' && (msg.includes('404') || msg.includes('not found'))) {
            const id = args && args[0];
            markLivePositionDeleted(id);
            DEBUG_APIQ.log('[LIVE_POSITION_DELETE_404_TREATED_AS_OK]', { id, message: error.message });
            return { deleted: true, alreadyDeleted: true };
          }

          // ADDED: Graceful handling for MarketAlert timeouts
          if (entityName === 'MarketAlert' && (error.message?.includes('timeout') || error.message?.includes('NetworkTimeout'))) {
            DEBUG_APIQ.log('[MARKET_ALERT_TIMEOUT_RETURN_CACHE]', { message: error.message });
            
            // Return cached data for list/filter operations to prevent app crash
            const cached = getMarketAlertCache();
            return Array.isArray(cached) ? cached.slice(0, 10) : [];
          }
          
          if (entityName === 'Trade' && method === 'create') {
            DEBUG_TRADE.log('[TRADE_CREATE_FAIL]', { message: error?.message, stack: error?.stack });
          }

          // NEW: Failure logging for Trade calls inside executor
          if (entityName === 'Trade') {
            let status = {};
            try { status = apiQueue.getStatus ? apiQueue.getStatus() : {}; } catch (_e) {}
            DEBUG_TRADE.log('[FAIL_EXECUTOR]', {
              entity: entityName,
              method,
              message: error?.message,
              stack: error?.stack,
              queueStatus: status
            });
          }
          throw error;
        }
      },
      cacheKey,
      cacheDuration,
      priority,
      // PASS options object to set timeout + retry profile
      { timeoutMs, retryProfile }
    );

    return result;
  } catch (error) {
    // ADDED: Ensure pending tracking is cleared on enqueue-level failure for LivePosition.delete
    if (entityName === 'LivePosition' && method === 'delete') {
      const id = args && args[0];
      pendingLivePositionDeletes.delete(String(id));
    }

    // ADDED: Additional safety net for MarketAlert if enqueue fails or circuit breaker is open
    if (entityName === 'MarketAlert' && (error.message?.includes('timeout') || error.message?.includes('NetworkTimeout') || error.message?.includes('Circuit breaker is open'))) {
      DEBUG_APIQ.log('[MARKET_ALERT_OPERATION_FAILED_RETURN_CACHE]', { message: error.message });
      const cached = getMarketAlertCache();
      return Array.isArray(cached) ? cached.slice(0, 10) : [];
    }

    // NEW: Failure logging for Trade calls at enqueue layer
    if (entityName === 'Trade') {
      let status = {};
      try { status = apiQueue.getStatus ? apiQueue.getStatus() : {}; } catch (_e) {}
      DEBUG_TRADE.log('[FAIL_ENQUEUE]', {
        entity: entityName,
        method,
        message: error?.message,
        stack: error?.stack,
        queueStatus: status
      });
    }
    throw error;
  }
};

// NEW helper to detect Binance -2010 insufficient balance errors
const isBinanceInsufficientBalance = (err) => {
  try {
    const txt = JSON.stringify(err?.response?.data || err?.message || '');
    return /-2010/.test(txt) || /insufficient balance/i.test(txt);
  } catch (_e) {
    return false;
  }
};

// NEW: Simple dust ledger to aggregate tiny leftovers per symbol/mode
const dustLedger = new Map();
const getDustKey = (symbol, mode) => `${(mode || 'testnet')}:${symbol}`;
export const getDustLedgerSnapshot = () => {
  const out = {};
  for (const [k, v] of dustLedger.entries()) out[k] = v;
  return out;
};

// NEW: Utility to floor quantities to Binance step size
function floorToStep(qty, stepSize) {
  if (!Number.isFinite(qty) || !Number.isFinite(stepSize) || stepSize <= 0) return 0;
  // Determine precision from stepSize (e.g., 0.001 has 3 decimal places)
  const stepSizeStr = String(stepSize);
  const decimalPointIndex = stepSizeStr.indexOf('.');
  const precision = decimalPointIndex === -1 ? 0 : stepSizeStr.length - decimalPointIndex - 1;

  // Use a small epsilon to avoid floating point issues
  const floored = Math.floor((qty / stepSize) + 1e-9) * stepSize;
  // Correct for floating point inaccuracies by rounding to the determined precision
  return Number(floored.toFixed(precision));
}

// NEW: Fetch symbol filters and latest price from Binance public data API
async function fetchSymbolFiltersAndPrice(symbol) {
  try {
    const [exRes, pxRes] = await Promise.all([
      fetch(`https://data-api.binance.vision/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`),
      fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`)
    ]);
    const exJson = await exRes.json();
    const pxJson = await pxRes.json();

    const info = exJson?.symbols && Array.isArray(exJson.symbols) ? exJson.symbols[0] : null;
    if (!info) return null;

    const lot = (info.filters || []).find(f => f.filterType === 'LOT_SIZE') || {};
    const minNotionalF = (info.filters || []).find(f => f.filterType === 'MIN_NOTIONAL') || {};

    const baseAsset = info.baseAsset;
    const stepSize = Number(lot.stepSize || '0');
    const minQty = Number(lot.minQty || '0');
    const minNotional = Number(minNotionalF.minNotional || '0');
    const price = Number(pxJson?.price || '0');

    if (!Number.isFinite(price) || price <= 0) return null;

    return { baseAsset, stepSize, minQty, minNotional, price };
  } catch (_e) {
    DEBUG_APIQ.log('[FETCH_BINANCE_FILTERS_ERROR]', { symbol, error: _e?.message || String(_e) });
    return null;
  }
}

// Warn once when legacy queueFunctionCall signature is used (without explicit function name)
let __queueFunctionCallWarnedLegacy = false;

// REFACTORED: Support explicit function name (preferred) + legacy signature (backward-compatible)
export const queueFunctionCall = async (...allArgs) => {
  // Normalize arguments (new vs legacy signature)
  // New:   queueFunctionCall(functionName, func, params, priority?, cacheKey?, cacheDuration?, timeoutMs?)
  // Legacy: queueFunctionCall(func, params, priority?, cacheKey?, cacheDuration?, timeoutMs?)
  let funcName = 'unknown_function';
  let func = null;
  let params = undefined;
  let priority = 'normal';
  let customCacheKey = null;
  let customCacheDuration = 60000;
  let customTimeoutMs = null;

  if (typeof allArgs[0] === 'string') {
    // New signature
    funcName = allArgs[0];
    func = allArgs[1];
    params = allArgs[2];
    priority = allArgs[3] ?? 'normal';
    customCacheKey = allArgs[4] ?? null;
    customCacheDuration = allArgs[5] ?? 60000;
    customTimeoutMs = allArgs[6] ?? null;
  } else {
    // Legacy signature (keep working, but warn once)
    func = allArgs[0];
    params = allArgs[1];
    priority = allArgs[2] ?? 'normal';
    customCacheKey = allArgs[3] ?? null;
    customCacheDuration = allArgs[4] ?? 60000;
    customTimeoutMs = allArgs[5] ?? null;

    if (!__queueFunctionCallWarnedLegacy) {
      __queueFunctionCallWarnedLegacy = true;
      try {
        console.warn('[queueFunctionCall] Using legacy signature without explicit function name. Please migrate to: queueFunctionCall("functionName", func, params, ...).');
      } catch (_e) {}
    }

    // Best-effort inference for legacy calls (kept for compatibility)
    if (func && typeof func === 'function') {
      if (func.name && func.name !== 'anonymous') {
        funcName = func.name;
      } else {
        const funcString = func.toString();
        let match = funcString.match(/async\s+function\s+(\w+)/);
        if (!match) {
          match = funcString.match(/function\s+(\w+)/);
        }
        if (!match) {
          match = funcString.match(/(\w+)\s*=.*=>/);
        }
        if (!match) {
          match = funcString.match(/export.*?(\w+)/);
        }
        
        if (match && match[1] && match[1] !== 'anonymous') {
          funcName = match[1];
        }
      }
    }

    if (funcName === 'unknown_function' && params) {
      if (params.interval) {
        funcName = 'getKlineData';
      } else if (params.symbols && Array.isArray(params.symbols)) {
        funcName = 'getBinancePrices';
      } else if (params.action === 'load' || params.action === 'save') {
        funcName = 'scannerConfig';
      }
    }
  }

  // Derive action from params
  const action = params && typeof params === 'object' ? params.action : undefined;

  // If still unknown and looks like trading, normalize to liveTradingAPI (legacy compatibility)
  if (
    funcName === 'unknown_function' &&
    (action === 'createOrder' ||
     action === 'getAccountInfo' ||
     action === 'getAccountInformation' ||
     action === 'getExchangeInfo' ||
     action === 'getAccount' ||
     action === 'cancelOrder')
  ) {
    funcName = 'liveTradingAPI';
  }

  // Ensure local variables exist for dust preflight condition logging
  const upperSide = (params?.side || '').toUpperCase();
  const shouldTriggerDustPreflight =
    action === 'createOrder' &&
    upperSide === 'SELL' &&
    Boolean(params?.symbol);

  // removed unconditional console.log; keep debug hook only
  DEBUG_APIQ.log('[DUST_PREFLIGHT_CHECK_CONDITIONS]', {
    funcName,
    action,
    side: upperSide,
    symbol: params?.symbol,
    willTriggerPreflight: shouldTriggerDustPreflight
  });


  // Dust prevention preflight for SELL orders (trigger even if funcName couldn't be inferred)
  if (action === 'createOrder' && (params?.side || '').toUpperCase() === 'SELL' && params?.symbol) {
    try {
      const rawSymbol = String(params.symbol).replace('/', '');
      const mode = params?.tradingMode || 'testnet';

      DEBUG_APIQ.log('[DUST_PREVENTION_PREFLIGHT_START]', {
        rawSymbol,
        mode,
        requestedQty: params?.quantity ?? null,
        orderType: params?.orderType || params?.type || 'MARKET'
      });

      const filters = await fetchSymbolFiltersAndPrice(rawSymbol);

      if (!filters) {
        DEBUG_APIQ.log('[DUST_PREVENTION_PREFLIGHT_SKIP]', {
          rawSymbol,
          reason: 'Failed to fetch symbol filters or price'
        });
      } else {
        const { baseAsset, stepSize, minQty, minNotional, price } = filters;

        DEBUG_APIQ.log('[DUST_PREVENTION_FILTERS]', {
          rawSymbol, baseAsset, stepSize, minQty, minNotional, price
        });

        // Get current free balance for base asset
        let free = 0;
        try {
          const acctRes = await apiQueue.enqueue(
            () => func({ action: 'getAccountInfo', tradingMode: mode, proxyUrl: params?.proxyUrl }),
            `liveTradingAPI.getAccountInfo.${mode}`,
            5000,
            'critical',
            { timeoutMs: 10000 }
          );
          const balances = acctRes?.data?.balances || acctRes?.balances || [];
          const found = Array.isArray(balances)
            ? balances.find(b => (b?.asset || '').toUpperCase() === String(baseAsset || '').toUpperCase())
            : null;
          if (found) {
            free = Number(String(found?.free ?? '0'));
          }
          DEBUG_APIQ.log('[DUST_PREVENTION_CURRENT_BALANCE]', { rawSymbol, baseAsset, free });
        } catch (balErr) {
          DEBUG_APIQ.log('[DUST_PREVENTION_BALANCE_FETCH_ERROR]', {
            rawSymbol, mode, error: balErr?.message || String(balErr)
          });
        }

        const requestedQty = Number(params?.quantity ?? '0');
        const reqNotional = Number.isFinite(requestedQty) ? requestedQty * price : 0;

        DEBUG_APIQ.log('[DUST_PREVENTION_CHECK]', {
          rawSymbol, requestedQty, reqNotional, minQty, minNotional
        });

        // If requested below thresholds, try to sell all available rounded to step
        if (!Number.isFinite(requestedQty) || requestedQty < minQty || reqNotional < minNotional) {
          const freeRounded = floorToStep(free, stepSize);
          const freeNotional = freeRounded * price;

          DEBUG_APIQ.log('[DUST_PREVENTION_SMALL_QTY_DETECTED]', {
            rawSymbol, free, freeRounded, freeNotional, stepSize
          });

          if (freeRounded >= minQty && freeNotional >= minNotional) {
            params.quantity = String(freeRounded);
            DEBUG_APIQ.log('[DUST_PREVENTION_SELL_ALL]', {
              rawSymbol, mode, baseAsset, requestedQty, overrideQty: freeRounded, minQty, minNotional, price
            });
            dustLedger.delete(getDustKey(rawSymbol, mode));
          } else {
            const key = getDustKey(rawSymbol, mode);
            dustLedger.set(key, {
              symbol: rawSymbol,
              baseAsset,
              mode,
              qty: freeRounded,
              minQty,
              minNotional,
              stepSize,
              price,
              updatedAt: Date.now()
            });
            DEBUG_APIQ.log('[DUST_BLOCKED]', {
              rawSymbol, mode, baseAsset, qty: freeRounded, minQty, minNotional, price
            });

            // Short-circuit with a structured result (avoid hitting backend and getting -2010)
            return {
              data: {
                success: false,
                dust: true,
                reason: 'DUST_BLOCKED',
                symbol: rawSymbol,
                baseAsset,
                mode,
                qty: freeRounded,
                minQty,
                minNotional,
                stepSize,
                price
              }
            };
          }
        }
      }
    } catch (e) {
      DEBUG_APIQ.log('[DUST_PRECHECK_ERROR]', { message: e?.message || String(e) });
      // Allow normal flow to continue on precheck errors
    }
  }

  // NEW: Detect scanner session manager actions (especially heartbeat) and force critical handling
  const isScannerSessionManager =
    funcName === 'scannerSessionManager' ||
    (action && ['sendHeartbeat', 'getSessionStatus', 'claimSession', 'releaseSession'].includes(action));
  
  // NEW: Detect reconciliation actions and give high priority and specific retry profiles
  const isReconciliationAction = 
    (action && ['reconcileWallet', 'requestFundingWalletBalance', 'syncBinanceBalances'].includes(action));

  let timeoutMs = customTimeoutMs;
  if (!timeoutMs) {
    if (isScannerSessionManager) {
      // UPDATED: Increase heartbeat timeout to reduce false expirations under load
      if (action === 'sendHeartbeat') {
        timeoutMs = 20000; // was 7000ms → now 20s
      } else if (action === 'getSessionStatus') {
        timeoutMs = 12000; // was 10000ms → small bump
      } else {
        timeoutMs = 15000; // claim/release
      }
      // ADDED: Log scanner session manager configuration
      DEBUG_APIQ.log('[SCANNER_SM_CONFIG]', { funcName, action, timeoutMs, priority: 'critical' });
    } else if (isReconciliationAction) { // ADDED Reconciliation timeout
      timeoutMs = 120000; // 2 minutes for reconciliation operations
      DEBUG_APIQ.log('[RECONCILIATION_CONFIG]', { funcName, action, timeoutMs, priority: 'critical' });
    } else if (funcName.includes('backtest') || funcName.includes('Backtest') || funcName === 'getKlineData' || funcName === 'getBinancePrices') {
      timeoutMs = 480000;
    } else if (funcName.includes('updateStrategyStats') || funcName.includes('bulkCreate')) {
      timeoutMs = 480000;
    } else if (funcName === 'liveTradingAPI' || (params && params.action === 'createOrder')) {
      // Increased timeout for wallet initialization and API calls to handle slow Binance responses
      timeoutMs = 120000; // Increased from 45s to 120s (2 minutes)
    } else {
      timeoutMs = 240000;
    }
  }
  
  let cacheKeyParams = params;
  if ((funcName === 'getBinancePrices' || (params && params.symbols && Array.isArray(params.symbols))) && params) {
    cacheKeyParams = {
      ...params,
      symbols: [...params.symbols].sort()
    };
  }
  
  // Avoid any caching for trading actions (now independent of funcName)
  const isTradingAction = params && params.action === 'createOrder';

  // NEW: Avoid caching for session manager calls (esp. heartbeat) and give unique keys
  const noCacheForSession = isScannerSessionManager;
  const noCacheForReconciliation = isReconciliationAction; // NEW: Avoid caching for reconciliation actions
  const cacheKey = customCacheKey
    ? customCacheKey
    : (isTradingAction || noCacheForSession || noCacheForReconciliation
        ? `${funcName}.${action || 'action'}.${Date.now()}.${generateTradeId()}` // Use generateTradeId for uniqueness
        : `${funcName}.${JSON.stringify(cacheKeyParams)}`);
  const cacheDuration = isTradingAction || noCacheForSession || noCacheForReconciliation
    ? 0
    : (customCacheDuration ?? 60000);
  
  // CRITICAL: Prioritize essential function calls
  let effectivePriority = priority;
  if (funcName === 'liveTradingAPI' || funcName === 'getBinancePrices' || isTradingAction || isScannerSessionManager || isReconciliationAction) {
      effectivePriority = 'critical';
  }

  // NEW: attach retryProfile for specific actions
  let retryProfile = null;
  if (funcName === 'liveTradingAPI') {
    const action = params && params.action;
    if (action === 'getAccountInfo' || action === 'getAccountInformation' || action === 'getExchangeInfo' || action === 'getAccount') {
      retryProfile = { rate_limit: 4, server_error: 6, network_error: 10, baseDelayMs: 3000 };
      DEBUG_APIQ.log('[QUEUE_FUNCTION_CALL] liveTradingAPI retryProfile set', { action, retryProfile });
    }
  } else if (isReconciliationAction) { // NEW: Reconciliation retry profile
    retryProfile = {
      ...retryProfiles.critical, // Start with critical profile settings
      network_error: 8, // More retries for network issues during reconciliation
      server_error: 5,  // Increased retries for server errors
      baseDelayMs: 3000 // Longer base delay for retries
    };
    DEBUG_APIQ.log('[QUEUE_FUNCTION_CALL] Reconciliation retryProfile set', { action, retryProfile });
  }

  DEBUG_APIQ.log('[FUNC_ENQUEUE]', {
    funcName, action, priority: effectivePriority, timeoutMs, cacheKey, cacheDuration, hasRetryProfile: !!retryProfile
  });

  try {
    const result = await apiQueue.enqueue(
      async () => {
        let executionStartTime;
        if (isScannerSessionManager) {
          executionStartTime = Date.now();
          DEBUG_APIQ.log('[SCANNER_SM_EXEC_START]', { funcName, action });
        } else if (isReconciliationAction) { // NEW: Log reconciliation start
          executionStartTime = Date.now();
          DEBUG_APIQ.log('[RECONCILIATION_EXEC_START]', { funcName, action });
        }

        const response = await func(params);
        
        if (isScannerSessionManager) {
          const executionDuration = Date.now() - executionStartTime;
          DEBUG_APIQ.log('[SCANNER_SM_EXEC_END]', { funcName, action, duration: executionDuration });
        } else if (isReconciliationAction) { // NEW: Log reconciliation end
          const executionDuration = Date.now() - executionStartTime;
          DEBUG_APIQ.log('[RECONCILIATION_EXEC_END]', { funcName, action, duration: executionDuration });
        }
        
        if (response && typeof response === 'object') {
          // Normalize to { data: ... }
          const raw = response.data !== undefined ? response.data : response;

          // NEW: Extract executed quantity for createOrder (BUY/SELL) to ensure the caller uses actual filled qty
          if (action === 'createOrder') {
            try {
              const order = raw?.order || raw;
              // Binance can return executedQty or only fills with qty
              let executedQty = undefined;
              if (order && (order.executedQty !== undefined)) {
                executedQty = Number(order.executedQty);
              } else if (Array.isArray(order?.fills)) {
                executedQty = order.fills.reduce((sum, f) => {
                  const q = Number(f?.qty ?? f?.quantity ?? 0);
                  return Number.isFinite(q) ? sum + q : sum;
                }, 0);
              }
              if (Number.isFinite(executedQty)) {
                raw.executedQty = executedQty; // expose to caller
                DEBUG_APIQ.log('[LIVE_TRADING_API][FILLS] Executed quantity extracted', { executedQty });
              }
            } catch (e) {
              DEBUG_APIQ.log('[LIVE_TRADING_API][FILLS] Failed to extract executedQty', { message: e?.message || String(e) });
            }
          }

          return { data: raw };
        }
        
        return { data: response };
      },
      cacheKey,
      cacheDuration,
      effectivePriority,
      // PASS options with timeout and retry profile
      { timeoutMs, retryProfile }
    );

    // removed noisy liveTradingAPI response console logs (use DEBUG_APIQ if needed)

    DEBUG_APIQ.log('[FUNC_OK]', { funcName, action });
    return result;
  } catch (error) {
    // If funcName === 'liveTradingAPI' or action === 'createOrder', the following block used to contain
    // noisy console.error logs for frontend diagnostics. These have been removed.
    // The dust-recovery flow that was originally inside this block (after the console.error) is kept intact.

    if (funcName === 'liveTradingAPI' || action === 'createOrder') {
      // quiet console logs; keep recovery flow intact
      const side = (params?.side || '').toUpperCase();
      const symbol = params?.symbol;
      const mode = params?.tradingMode || 'testnet';
      const proxyUrl = params?.proxyUrl;

      if (action === 'createOrder' && side === 'SELL' && symbol && isBinanceInsufficientBalance(error)) {
        DEBUG_APIQ.log('[DUST_WORKFLOW_START]', { symbol, mode, reason: 'insufficient_balance_-2010' });

        // Step 1: Attempt dust conversion via local proxy (with small retries)
        try {
          let convertOk = false;
          for (let i = 0; i < 2 && !convertOk; i++) {
            const convertRes = await attemptDustConvert(mode, proxyUrl);
            convertOk = !!convertRes.ok;
            DEBUG_APIQ.log(convertOk ? '[DUST_CONVERT_SUCCESS]' : '[DUST_CONVERT_FAILED]', { attempt: i + 1, symbol, mode, status: convertRes?.status, data: convertRes?.data });
            if (!convertOk) {
              await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
            }
          }
        } catch (dcErr) {
          DEBUG_APIQ.log('[DUST_CONVERT_EXCEPTION]', { message: dcErr?.message || String(dcErr) });
        }

        // Small cool-down before reconciliation
        try { await new Promise(r => setTimeout(r, 800)); } catch (_e) {}

        // Step 2: Trigger reconciliation/virtual close to clean DB state (with retry)
        // CRITICAL: For SELL orders, re-throw the error so PositionManager can handle it
        if (side === 'SELL') {
          DEBUG_APIQ.log('[SKIP_VIRTUAL_CLOSE_SELL]', { 
            symbol, 
            mode, 
            reason: 'SELL order - re-throwing error for PositionManager to handle',
            errorCode: error?.code,
            errorMessage: error?.message,
            hasCodeProperty: error?.code !== undefined
          });
          
          // CRITICAL: Ensure error code is preserved when re-throwing
          // If error doesn't have code, extract it from message if possible
          if (error?.code === undefined && error?.message) {
            const msg = error.message.toLowerCase();
            if (msg.includes('insufficient balance') || msg.includes('-2010')) {
              error.code = -2010;
              DEBUG_APIQ.log('[ERROR_CODE_ADDED]', { code: -2010, reason: 'Extracted from message' });
            }
          }
          
          console.log(`[API_QUEUE] 🔍 [RE_THROW_ERROR] Re-throwing error for SELL order:`, {
            code: error?.code,
            message: error?.message,
            hasCode: error?.code !== undefined,
            symbol,
            mode
          });
          
          // Re-throw the error immediately for SELL orders so PositionManager can handle it
          throw error;
        } else {
        try {
          // Use the new PositionManager virtualCloseDustPositions method instead of backend
          const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
          const scannerService = getAutoScannerService();
          
          if (scannerService && scannerService.positionManager) {
            let vcOk = false;
            for (let i = 0; i < 2 && !vcOk; i++) {
              try {
                await scannerService.positionManager.virtualCloseDustPositions(symbol, mode);
                vcOk = true;
                DEBUG_APIQ.log('[VIRTUAL_CLOSE_AFTER_DUST]', { symbol, mode, attempt: i + 1, triggered: true, method: 'PositionManager' });
              } catch (reconErr) {
                DEBUG_APIQ.log('[VIRTUAL_CLOSE_AFTER_DUST_FAIL]', { attempt: i + 1, message: reconErr?.message || String(reconErr), method: 'PositionManager' });
                await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
              }
            }
          } else {
            DEBUG_APIQ.log('[VIRTUAL_CLOSE_AFTER_DUST_SKIP]', { symbol, mode, reason: 'PositionManager not available' });
            }
          } catch (e2) {
            DEBUG_APIQ.log('[RECOVERY_FLOW_EXCEPTION]', { message: e2?.message || String(e2) });
          }
          }

          // Step 3: Verification and last-resort cleanup of ghost positions
        // CRITICAL: For SELL orders, check order history BEFORE deleting positions
        // Positions might already be closed on Binance, so we need to verify first
        try {
          // First, check if this position was already closed by checking order history
          const requestedQty = params?.quantity;
          let orderHistoryMatched = false;
          
          if (requestedQty && side === 'SELL') {
            try {
              DEBUG_APIQ.log('[ORDER_HISTORY_CHECK_START]', { symbol, mode, requestedQty });
              const { functions } = await import('@/api/localClient');
              const orderHistoryResponse = await functions.liveTradingAPI({
                action: 'getAllOrders',
                tradingMode: mode,
                proxyUrl: proxyUrl,
                symbol: symbol,
                limit: 50
              });
              
              if (orderHistoryResponse?.data?.success && orderHistoryResponse.data.data) {
                const orders = Array.isArray(orderHistoryResponse.data.data) 
                  ? orderHistoryResponse.data.data 
                  : [orderHistoryResponse.data.data];
                
                // Check for recent SELL orders (last 2 hours) with matching quantity
                const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
                const recentSellOrders = orders.filter(order => {
                  const isSell = order.side === 'SELL' && order.status === 'FILLED';
                  const isRecent = new Date(order.time || order.updateTime || order.transactTime).getTime() > twoHoursAgo;
                  if (isSell && isRecent) {
                    const executedQty = parseFloat(order.executedQty || order.origQty || 0);
                    // Allow 20% quantity tolerance for matching
                    const qtyDiff = Math.abs(executedQty - parseFloat(requestedQty));
                    const qtyTolerance = parseFloat(requestedQty) * 0.2;
                    return qtyDiff <= qtyTolerance;
                  }
                  return false;
                });
                
                if (recentSellOrders.length > 0) {
                  orderHistoryMatched = true;
                  DEBUG_APIQ.log('[ORDER_HISTORY_MATCH_FOUND]', { 
                    symbol, 
                    mode, 
                    matchingOrders: recentSellOrders.length,
                    orderIds: recentSellOrders.map(o => o.orderId)
                  });
                  // Don't delete positions if we found a matching order - let PositionManager handle it
                } else {
                  DEBUG_APIQ.log('[ORDER_HISTORY_NO_MATCH]', { symbol, mode, requestedQty });
                }
              }
            } catch (orderHistoryError) {
              DEBUG_APIQ.log('[ORDER_HISTORY_CHECK_FAILED]', { 
                symbol, 
                mode, 
                error: orderHistoryError?.message || String(orderHistoryError) 
              });
              // If order history check fails, proceed with caution - don't delete positions
              orderHistoryMatched = false;
            }
          }
          
          // CRITICAL: For SELL orders, NEVER delete positions in apiQueue
          // PositionManager has proper order history checking logic that should handle this
          // We only delete positions for BUY orders or when confirmed to be truly ghost
          if (side === 'SELL') {
            DEBUG_APIQ.log('[SKIP_GHOST_DELETION_SELL]', { 
              symbol, 
              mode, 
              orderHistoryMatched,
              reason: 'SELL order - letting PositionManager handle via order history check' 
            });
          } else if (!orderHistoryMatched) {
            // For non-SELL orders and when order history confirms no match, check for ghost positions
            const { LivePosition } = await import('@/api/entities');
            const open = await LivePosition.filter({ symbol, trading_mode: mode, status: 'open' }, '-created_date', 10);
            if (Array.isArray(open) && open.length > 0) {
              DEBUG_APIQ.log('[GHOST_POSITIONS_DETECTED]', { count: open.length, symbol, mode });
              // Attempt to delete remaining positions (idempotent; apiQueue has guards)
              for (const pos of open) {
                try {
                  await LivePosition.delete(pos.id);
                  DEBUG_APIQ.log('[GHOST_POSITION_DELETED]', { id: pos.id, symbol, mode });
                } catch (delErr) {
                  DEBUG_APIQ.log('[GHOST_POSITION_DELETE_FAILED]', { id: pos?.id, message: delErr?.message || String(delErr) });
                }
              }
            } else {
              DEBUG_APIQ.log('[NO_GHOST_POSITIONS_REMAIN]', { symbol, mode });
            }
            }
          } catch (verifyErr) {
            DEBUG_APIQ.log('[GHOST_POSITION_VERIFY_FAIL]', { message: verifyErr?.message || String(verifyErr) });
          }

          // Optional: Ask backend to refresh wallet state for this symbol (best-effort)
          try {
          // Use the proper API to trigger wallet reconciliation
          const { invokeFunction } = await import('@/api/functions');
          await invokeFunction('reconcileWalletState', { mode, symbol });
            DEBUG_APIQ.log('[RECONCILE_WALLET_STATE_TRIGGERED]', { symbol, mode });
          } catch (_e) {
            DEBUG_APIQ.log('[RECONCILE_WALLET_STATE_SKIP_OR_FAIL]', { reason: 'function not available or failed silently' });
        }
      }
    }

    // ADDED: Specific log for scannerSessionManager execution failure
    if (isScannerSessionManager) {
      DEBUG_APIQ.log('[SCANNER_SM_EXEC_FAIL]', { funcName, action, message: (error && error.message) || String(error) });
    }
    // NEW: Specific log for reconciliation execution failure
    if (isReconciliationAction) {
      DEBUG_APIQ.log('[RECONCILIATION_EXEC_FAIL]', { funcName, action, message: (error && error.message) || String(error) });
    }
    DEBUG_APIQ.log('[FUNC_FAIL]', { funcName, action: params?.action, message: (error && error.message) || String(error) });
    throw error;
  }
};

export { apiQueue };
export default apiQueue;

// Safe load market alerts function
export const safeLoadMarketAlerts = async () => {
  try {
    const alerts = await queueEntityCall('MarketAlert', 'list');
    return {
      success: true,
      data: alerts || []
    };
  } catch (error) {
    console.error('[safeLoadMarketAlerts] Error:', error);
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
};
