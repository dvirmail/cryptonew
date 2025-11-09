// Local API Client - Replaces Base44 SDK
// This client connects to the local API server instead of Base44

import priceCacheService from '@/components/services/PriceCacheService';

const API_BASE_URL = 'http://localhost:3003/api';

class LocalAPIError extends Error {
  constructor(message, status, response) {
    super(message);
    this.name = 'LocalAPIError';
    this.status = status;
    this.response = response;
  }
}

 async function apiRequest(endpoint, options = {}) {
   let url = `${API_BASE_URL}${endpoint}`;
   
   // Handle query parameters
   if (options.params) {
     const queryString = new URLSearchParams(options.params).toString();
     url += (endpoint.includes('?') ? '&' : '?') + queryString;
   }
   
   const config = {
     headers: {
       'Content-Type': 'application/json',
       ...options.headers,
     },
     ...options,
   };

   try {
     const response = await fetch(url, config);
     
     // Check if response is HTML (likely an error page)
     const contentType = response.headers.get('content-type');
     if (contentType && contentType.includes('text/html')) {
       const htmlText = await response.text();
       console.error('[localClient] Received HTML response instead of JSON:', htmlText.substring(0, 200) + '...');
       throw new LocalAPIError('Server returned HTML instead of JSON - check if proxy server is running', response.status, htmlText);
     }
     
     const data = await response.json();

     if (!response.ok) {
       console.error('[apiRequest] Request failed with status:', response.status);
       throw new LocalAPIError(data.error || 'API request failed', response.status, data);
     }

     return data;
  } catch (error) {
    console.error('[apiRequest] Error occurred:', error);
    console.error('[apiRequest] Error message:', error.message);
    console.error('[apiRequest] Error stack:', error.stack);
    
    if (error instanceof LocalAPIError) {
      throw error;
    }
    
    // Handle JSON parsing errors
    if (error.message && error.message.includes('Unexpected token')) {
      throw new LocalAPIError('Invalid JSON response from server - check if proxy server is running', 0, null);
    }
    
    throw new LocalAPIError(error.message || 'Network error', 0, null);
  }
}

// Entity classes that mimic Base44 SDK structure
class Entity {
  constructor(name) {
    this.name = name;
  }

  async create(data) {
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.data;
    }
    
    // Special handling for entities that use direct API endpoints
    if (this.name === 'walletSummaries' || this.name === 'livePositions' || this.name === 'ScanSettings' || this.name === 'trades') {
      const response = await apiRequest(`/${this.name}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.data;
    }
    
    const response = await apiRequest(`/entities/${this.name}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async update(id, data) {
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response.data;
    }
    
    const response = await apiRequest(`/entities/${this.name}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async delete(id) {
    const response = await apiRequest(`/entities/${this.name}/${id}`, {
      method: 'DELETE',
    });
    return response.data;
  }

  async bulkDelete(ids) {
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}`, {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      return response;
    }
    
    const response = await apiRequest(`/entities/${this.name}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
    return response.data;
  }

  async getById(id) {
    const response = await apiRequest(`/entities/${this.name}/${id}`);
    return response.data;
  }

  async list(orderBy = '-created_date', limit = 10000) {
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}?${new URLSearchParams({ orderBy, limit })}`);
      return response.data;
    }
    
    // Special handling for entities that use direct API endpoints
    if (this.name === 'walletSummaries' || this.name === 'livePositions' || this.name === 'ScanSettings' || this.name === 'trades') {
      const params = new URLSearchParams({ orderBy, limit });
      const response = await apiRequest(`/${this.name}?${params}`);
      return response.data;
    }
    
    const params = new URLSearchParams({ orderBy, limit });
    const response = await apiRequest(`/entities/${this.name}?${params}`);
    return response.data;
  }

  async filter(conditions = {}, orderBy = '-created_date', limit = 100) {
    const filterStartTime = performance.now();
    const filterStartISO = new Date().toISOString();
    
    let endpoint = '';
    let method = 'GET';
    let requestBody = null;
    
    // CRITICAL FIX: Use POST /api/entities/LivePosition/filter instead of GET /livePositions
    // This ensures we hit the proxy server's filter endpoint which has proper DB reloading logic
    if (this.name === 'livePositions') {
      endpoint = `/entities/LivePosition/filter`;
      method = 'POST';
      // For POST, send conditions in body
      requestBody = conditions;
    } else {
      // For GET requests, build query params
      // CRITICAL FIX: Properly serialize conditions, especially nested objects like { exit_timestamp: { $ne: null } }
      // URLSearchParams doesn't handle nested objects, so we need to JSON.stringify them
      const params = new URLSearchParams();
      
      // Add simple key-value pairs
      Object.keys(conditions).forEach(key => {
        const value = conditions[key];
        if (value !== null && value !== undefined) {
          if (Array.isArray(value)) {
            // Array values: append each item separately (query string will be ?status=open&status=trailing)
            value.forEach(item => {
              params.append(key, String(item));
            });
          } else if (typeof value === 'object') {
            // Nested object (e.g., { exit_timestamp: { $ne: null } })
            // Stringify it so the proxy server can parse it
            params.append(key, JSON.stringify(value));
          } else {
            // Simple value
            params.append(key, String(value));
          }
        }
      });
      
      params.append('orderBy', orderBy);
      params.append('limit', String(limit));
      
      // For local development, use proxy server for backtestCombinations
      if (this.name === 'backtestCombinations') {
        endpoint = `/${this.name}?${params}`;
      }
      // Special handling for entities that use direct API endpoints
      else if (this.name === 'walletSummaries' || this.name === 'ScanSettings' || this.name === 'trades') {
        endpoint = `/${this.name}?${params}`;
      } else {
        endpoint = `/entities/${this.name}?${params}`;
      }
    }
    
    //console.log(`[POSITION_QUERY] [API_CLIENT] 🔍 Entity.filter() called for ${this.name}`);
    //console.log(`[POSITION_QUERY] [API_CLIENT] ⏰ Filter start time: ${filterStartISO}`);
    //console.log(`[POSITION_QUERY] [API_CLIENT] 📝 Filter conditions:`, JSON.stringify(conditions));
    //console.log(`[POSITION_QUERY] [API_CLIENT] 🌐 Endpoint: ${method} ${endpoint}`);
    
    const requestStartTime = performance.now();
    let response;
    
    // CRITICAL FIX: Use POST with body for LivePosition filter
    if (method === 'POST' && requestBody !== null) {
      response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
    } else {
      // For GET requests, use default method
      response = await apiRequest(endpoint);
    }
    
    const requestEndTime = performance.now();
    const requestDuration = requestEndTime - requestStartTime;
    const filterEndTime = performance.now();
    const filterDuration = filterEndTime - filterStartTime;
    const filterEndISO = new Date().toISOString();
    
    //console.log(`[POSITION_QUERY] [API_CLIENT] ⏱️ Request completed in ${requestDuration.toFixed(2)}ms`);
    //console.log(`[POSITION_QUERY] [API_CLIENT] ⏱️ Total filter() time: ${filterDuration.toFixed(2)}ms`);
    //console.log(`[POSITION_QUERY] [API_CLIENT] ⏰ Filter end time: ${filterEndISO}`);
    //console.log(`[POSITION_QUERY] [API_CLIENT] 📥 Response data length: ${response?.data?.length || 0}`);
    
    return response.data;
  }

  async bulkCreate(items) {
    // For backtestCombinations, use the bulk endpoint
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}/bulkCreate`, {
        method: 'POST',
        body: JSON.stringify(items),
      });
      // Return full response so frontend can access databaseResult
      return response;
    }
    
    // For local client, create items one by one for other entities
    const results = [];
    for (const item of items) {
      try {
        const result = await this.create(item);
        results.push(result);
      } catch (error) {
        console.error(`Failed to create ${this.name} item:`, error);
        results.push({ error: error.message });
      }
    }
    return results;
  }
}

// Specific entity classes
export const Trade = new Entity('trades');
export const ScanSettings = new Entity('ScanSettings');
export const HistoricalPerformance = new Entity('HistoricalPerformance');
export const BacktestCombination = new Entity('backtestCombinations');
export const MarketAlert = new Entity('marketAlerts');
export const ScannerSession = new Entity('scannerSessions');
export const ScannerStats = new Entity('scannerStats');
export const LivePosition = new Entity('livePositions');
export const WalletSummary = new Entity('walletSummaries');
export const CentralWalletState = new Entity('centralWalletStates');
export const TradingSignal = new Entity('tradingSignals');
export const SignalPerformance = new Entity('signalPerformance');
export const OptedOutCombination = new Entity('optedOutCombinations');

// Use local implementation instead of base44 version
import { updatePerformanceSnapshot as localUpdatePerformanceSnapshot } from './updatePerformanceSnapshot';

// Global request deduplication for kline data
const pendingKlineRequests = new Map();

// Response cache with TTL (Time-To-Live) - cache successful responses for 5 seconds
const klineResponseCache = new Map();
const CACHE_TTL = 5000; // 5 seconds cache

// Cleanup function for expired cache entries (can be called on-demand)
export const cleanupExpiredKlineResponseCache = () => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [key, value] of klineResponseCache.entries()) {
    if ((now - value.timestamp) >= CACHE_TTL) {
      klineResponseCache.delete(key);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`[KLINE_CACHE] 🧹 Cleaned ${cleanedCount} expired cache entries (${klineResponseCache.size} remaining)`);
  }
  return cleanedCount;
};

// Periodic cleanup as fallback (every 2 minutes - less frequent since we clean at scan cycle start)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredKlineResponseCache, 2 * 60 * 1000);
}

// Circuit breaker pattern to prevent cascading failures
const circuitBreaker = {
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  failureCount: 0,
  successCount: 0,
  lastFailureTime: null,
  failureThreshold: 5, // Open circuit after 5 consecutive failures
  successThreshold: 2, // Close circuit after 2 consecutive successes
  cooldownPeriod: 30000, // 30 seconds cooldown before attempting half-open
  requestHistory: [], // Track last 20 requests for failure rate calculation
  maxHistorySize: 20,
  
  recordSuccess() {
    this.successCount++;
    this.failureCount = 0;
    this.requestHistory.push({ success: true, timestamp: Date.now() });
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }
    
    if (this.state === 'HALF_OPEN' && this.successCount >= this.successThreshold) {
      this.state = 'CLOSED';
      console.error('[CIRCUIT_BREAKER] ✅ Circuit CLOSED - requests succeeding again');
    }
  },
  
  recordFailure() {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();
    this.requestHistory.push({ success: false, timestamp: Date.now() });
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`[CIRCUIT_BREAKER] ⚠️ Circuit OPENED - ${this.failureCount} consecutive failures`);
    }
  },
  
  canAttemptRequest() {
    if (this.state === 'CLOSED') {
      return true;
    }
    
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceLastFailure >= this.cooldownPeriod) {
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
        this.successCount = 0;
        console.error('[CIRCUIT_BREAKER] 🔄 Circuit HALF_OPEN - attempting recovery');
        return true;
      }
      return false;
    }
    
    if (this.state === 'HALF_OPEN') {
      return true;
    }
    
    return false;
  },
  
  getAdaptiveTimeout(baseTimeout) {
    // Increase timeout if circuit is half-open (being more cautious)
    if (this.state === 'HALF_OPEN') {
      return baseTimeout * 1.5;
    }
    return baseTimeout;
  }
};

// Helper to generate cache key
function getCacheKey(symbols, interval, limit, endTime) {
  const sortedSymbols = [...symbols].sort().join(',');
  return `${sortedSymbols}_${interval}_${limit || 'default'}_${endTime || 'latest'}`;
}

// Helper to check and get cached response
function getCachedResponse(symbols, interval, limit, endTime) {
  const cacheKey = getCacheKey(symbols, interval, limit, endTime);
  const cached = klineResponseCache.get(cacheKey);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    // Return cached response, filtering to requested symbols
    const filteredData = {};
    symbols.forEach(symbol => {
      if (cached.data[symbol]) {
        filteredData[symbol] = cached.data[symbol];
      }
    });
    return {
      success: true,
      data: filteredData,
      cached: true
    };
  }
  
  // Remove stale/expired cache entry on access
  if (cached) {
    klineResponseCache.delete(cacheKey);
  }
  
  return null;
}

// Helper to cache successful response
function cacheResponse(symbols, interval, limit, endTime, data) {
  const cacheKey = getCacheKey(symbols, interval, limit, endTime);
  klineResponseCache.set(cacheKey, {
    data: data,
    timestamp: Date.now()
  });
  
  // Clean up old cache entries periodically (keep cache size reasonable)
  if (klineResponseCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of klineResponseCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        klineResponseCache.delete(key);
      }
    }
  }
}

        // Global kline coordinator for batching requests
        const globalKlineCoordinator = {
          // NEW: Pre-collection system to bypass sequential API queue
          preCollectionMode: false,
          preCollectedRequests: new Map(), // Map<batchGroupKey, Array<requests>>
          preCollectionTimeout: null,
          preCollectionInterval: 200, // Collect requests for 200ms before processing (increased to batch more symbols together)
          maxBatchSize: 50, // Maximum symbols per batch (Binance can handle large batches)
          maxConcurrentBatches: 3, // Limit concurrent batch requests to avoid connection exhaustion
          activeBatches: 0, // Track active batch requests
          batchQueue: [], // Queue for batches when at max concurrency
          isProcessing: false, // Flag to prevent concurrent processing
          
          // NEW: Start pre-collection mode
          startPreCollection() {
            this.preCollectionMode = true;
            this.preCollectedRequests.clear();
            
            // Set timeout to process collected requests
            if (this.preCollectionTimeout) {
              clearTimeout(this.preCollectionTimeout);
            }
            
            this.preCollectionTimeout = setTimeout(() => {
              this.processPreCollectedRequests();
            }, this.preCollectionInterval);
          },
          
          // NEW: Process all pre-collected requests in parallel
          async processPreCollectedRequests() {
            // Prevent concurrent processing (but allow if no requests are queued)
            if (this.isProcessing) {
              // If already processing, wait a bit and check if there are new high-priority requests
              await new Promise(resolve => setTimeout(resolve, 50));
              if (this.preCollectedRequests.size === 0) {
                return;
              }
              // If there are still requests, they'll be processed in the next cycle
              return;
            }
            
            this.isProcessing = true;
            this.preCollectionMode = false;
            
            // Track which batch groups we process (needed for cleanup in finally block)
            let batchGroups = [];
            
            try {
              if (this.preCollectedRequests.size === 0) {
                this.isProcessing = false;
                return;
              }
              
              // CRITICAL FIX: Process batches SEQUENTIALLY to avoid connection exhaustion
              // Even with batching, too many concurrent fetch calls exhaust browser connection pool
              // Convert Map to Array and sort by priority (high priority first)
              batchGroups = Array.from(this.preCollectedRequests.entries());
              
              // Sort batches by priority: high priority (for open positions) first
              batchGroups.sort((a, b) => {
                const aPriority = Math.max(...a[1].map(req => req.priority || 0));
                const bPriority = Math.max(...b[1].map(req => req.priority || 0));
                return bPriority - aPriority; // Higher priority first
              });
              
              // Process each batch group one at a time - await before starting the next
              for (let i = 0; i < batchGroups.length; i++) {
                const [batchGroupKey] = batchGroups[i];
                
                // CRITICAL FIX: Re-fetch requests for this batch group key right before processing
                // This ensures we include any new requests that were added to the same batch group during processing
                const currentRequests = this.preCollectedRequests.get(batchGroupKey) || [];
                
                if (currentRequests.length === 0) {
                  continue;
                }
                
                // Track which requests we're about to process (by reference, since they're objects)
                const requestsToProcess = [...currentRequests]; // Create a copy to avoid issues if array is modified
                
                // All requests in this group have the same interval/limit/endTime, so combine all symbols
                // CRITICAL: Await here ensures this batch completes before starting the next
                await this.processRequestGroupWithLimit(requestsToProcess, batchGroupKey);
                
                // Remove the requests we just processed from the batch group
                // New requests may have been added during processing, so we only remove the ones we processed
                const requestsAfterProcessing = this.preCollectedRequests.get(batchGroupKey) || [];
                if (requestsAfterProcessing.length > 0) {
                  // Remove only the requests we processed (by filtering them out)
                  const processedRequestSet = new Set(requestsToProcess);
                  const remainingRequests = requestsAfterProcessing.filter(req => !processedRequestSet.has(req));
                  
                  if (remainingRequests.length === 0) {
                    // No remaining requests, delete the batch group
                    this.preCollectedRequests.delete(batchGroupKey);
                  } else {
                    // Update the batch group with remaining requests (new ones added during processing)
                    this.preCollectedRequests.set(batchGroupKey, remainingRequests);
                  }
                }
              }
            } catch (error) {
              console.error(`[KLINE_COORDINATOR] ❌ Error processing pre-collected requests:`, error);
            } finally {
              // Check if there are new requests that were queued during processing
              // (Note: we already handled removal of processed requests inside the loop above)
              const remainingQueued = Array.from(this.preCollectedRequests.values()).flat().length;
              
              this.isProcessing = false;
              
              // If new requests were queued while processing, process them now
              if (remainingQueued > 0) {
                // Use setTimeout to avoid stack overflow and allow the current call to complete
                setTimeout(() => {
                  this.processPreCollectedRequests();
                }, 0);
              }
            }
          },
          
          // IMPROVED: Process a group with connection limiting
          async processRequestGroupWithLimit(requests, batchGroupKey) {
            // Wait if we're at max concurrency
            while (this.activeBatches >= this.maxConcurrentBatches) {
              await new Promise(resolve => setTimeout(resolve, 50)); // Wait 50ms and check again
            }
            
            this.activeBatches++;
            
            try {
              return await this.processRequestGroup(requests, batchGroupKey);
            } finally {
              this.activeBatches--;
            }
          },
          
          // IMPROVED: Process a group of requests - combine ALL symbols from all requests into one batch call
          async processRequestGroup(requests, batchGroupKey) {
            if (requests.length === 0) {
              return;
            }
            
            const firstRequest = requests[0];
            // IMPROVED: Combine ALL symbols from ALL requests into a single batch call
            const allSymbols = [...new Set(requests.flatMap(req => req.symbols))];
            
            try {
              // IMPROVED: Make ONE batch API call with ALL symbols combined
              const result = await executeKlineRequest(allSymbols, firstRequest.interval, firstRequest.limit, firstRequest.endTime);
              
              // Cache successful result
              if (result.success && result.data) {
                cacheResponse(allSymbols, firstRequest.interval, firstRequest.limit, firstRequest.endTime, result.data);
              }
              
              // Resolve all requests in this group
              requests.forEach((request) => {
                if (result.success && result.data) {
                  // Filter data for this specific request
                  const filteredData = {};
                  request.symbols.forEach(symbol => {
                    if (result.data[symbol]) {
                      filteredData[symbol] = result.data[symbol];
                    }
                  });
                  request.resolve({ success: true, data: filteredData });
                } else {
                  request.reject(new Error(result.error || 'Unknown error'));
                }
              });
              
            } catch (error) {
              console.error(`[KLINE_COORDINATOR] ❌ Error processing group:`, error);
              // Reject all requests in this group
              requests.forEach((request) => {
                request.reject(error);
              });
            }
          },
  
          requestKlineData(symbols, interval, limit, endTime, priority = 0) {
            // priority: 0 = normal (scanning), 1 = high (open positions monitoring)
            
            // Check cache first
            const cached = getCachedResponse(symbols, interval, limit, endTime);
            if (cached) {
              return Promise.resolve(cached);
            }
            
            // Check for duplicate pending request
            const requestKey = getCacheKey(symbols, interval, limit, endTime);
            if (pendingKlineRequests.has(requestKey)) {
              // Reuse existing pending request
              return pendingKlineRequests.get(requestKey);
            }
            
            // Create new request promise
            const requestPromise = new Promise((resolve, reject) => {
              // IMPROVED: Group by interval+limit+endTime only (not by symbols) to batch ALL symbols together
              const batchGroupKey = `${interval}_${limit || 'default'}_${endTime || 'latest'}`;
              const timestamp = Date.now();
              
              // NEW: Use pre-collection system to bypass sequential API queue
              if (!this.preCollectionMode) {
                this.startPreCollection();
              }
              
              // Add request to pre-collection - group by batchGroupKey to combine all symbols
              if (!this.preCollectedRequests.has(batchGroupKey)) {
                this.preCollectedRequests.set(batchGroupKey, []);
              }
              
              const requestData = {
                symbols,
                interval,
                limit,
                endTime,
                priority, // Store priority for sorting
                resolve,
                reject,
                timestamp
              };
              
              this.preCollectedRequests.get(batchGroupKey).push(requestData);
              
              const totalRequests = Array.from(this.preCollectedRequests.values()).flat().length;
              
              // Extend the collection timeout if this is a new request
              if (this.preCollectionTimeout) {
                clearTimeout(this.preCollectionTimeout);
                this.preCollectionTimeout = setTimeout(() => {
                  this.processPreCollectedRequests();
                }, this.preCollectionInterval);
              }
              
              // IMPROVED: Force processing when we have enough symbols to batch OR enough requests
              // Check total symbols across all groups, not just request count
              const totalSymbols = Array.from(this.preCollectedRequests.values())
                .flat()
                .reduce((sum, req) => sum + (req.symbols?.length || 0), 0);
              
              // Process if we have many symbols (better batching) OR many requests (avoid waiting too long)
              // Also process immediately if there's a high priority request
              if (totalSymbols >= this.maxBatchSize || totalRequests >= 10 || priority === 1) {
                clearTimeout(this.preCollectionTimeout);
                // For high priority requests, process immediately (don't await to avoid blocking)
                this.processPreCollectedRequests().catch(err => {
                  console.error('[KLINE_COORDINATOR] ❌ Error in processPreCollectedRequests:', err);
                });
              }
            });
            
            // Store pending request for deduplication
            pendingKlineRequests.set(requestKey, requestPromise);
            
            // Clean up when request completes
            requestPromise.finally(() => {
              pendingKlineRequests.delete(requestKey);
            });
            
            return requestPromise;
          },
          
};

// Helper function for executing kline requests - ALWAYS use batch endpoint
async function executeKlineRequest(symbols, interval, limit, endTime) {
  // Check circuit breaker before attempting request
  const circuitState = circuitBreaker.state;
  const canAttempt = circuitBreaker.canAttemptRequest();
  
  if (!canAttempt) {
    return {
      success: false,
      error: 'Circuit breaker is open - too many recent failures'
    };
  }
  
  try {
    // ALWAYS use batch endpoint, even for single symbols
    
    const symbolsParam = JSON.stringify(symbols);
    const batchUrl = `http://localhost:3003/api/binance/klines/batch?symbols=${encodeURIComponent(symbolsParam)}&interval=${interval}${limit ? `&limit=${limit}` : ''}${endTime ? `&endTime=${endTime}` : ''}`;
    
    // NEW: Retry logic with shorter timeout (10s) and exponential backoff
    // Instead of one 25s attempt, try 3 times with 10s timeout each
    const maxRetries = 3;
    const baseFetchTimeout = 10000; // 10 seconds per attempt
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use adaptive timeout based on circuit breaker state
        const fetchTimeout = circuitBreaker.getAdaptiveTimeout(baseFetchTimeout);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, fetchTimeout);
        
        const fetchPromise = fetch(batchUrl, { signal: controller.signal });
        const response = await fetchPromise;
        clearTimeout(timeoutId);
        
        // Success - break out of retry loop
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const batchData = await response.json();
        
        // Convert batch response to expected format
        if (batchData.success && batchData.data) {
          const results = {};
          batchData.data.forEach(item => {
            results[item.symbol] = {
              success: item.success,
              data: item.data,
              error: item.error
            };
          });
          
          // Record success in circuit breaker
          circuitBreaker.recordSuccess();
          
          return {
            success: true,
            data: results
          };
        } else {
          throw new Error(batchData.error || 'Failed to fetch batch kline data');
        }
      } catch (error) {
        lastError = error;
        const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
        const isLastAttempt = attempt === maxRetries;
        
        if (isTimeout && !isLastAttempt) {
          // Exponential backoff: wait 500ms * attempt number before retry
          const backoffDelay = 500 * attempt;
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        } else if (isLastAttempt) {
          // Final attempt failed - record failure in circuit breaker
          circuitBreaker.recordFailure();
          throw error;
        } else {
          // Non-timeout error - don't retry, but record failure
          circuitBreaker.recordFailure();
          throw error;
        }
      }
    }
    
    // Should never reach here, but just in case
    throw lastError || new Error('Unknown error');
  } catch (error) {
    console.error('[executeKlineRequest] ❌ Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function calls that mimic Base44 functions
export const functions = {
  async updatePerformanceSnapshot(data) {
    console.log('[localClient] 🚀 Calling local updatePerformanceSnapshot with data:', data);
    try {
      const result = await localUpdatePerformanceSnapshot(data);
      console.log('[localClient] ✅ Local updatePerformanceSnapshot completed:', result);
      return result;
    } catch (error) {
      console.error('[localClient] ❌ Local updatePerformanceSnapshot failed:', error);
      throw error;
    }
  },

  async backfillHistoricalPerformance(data) {
    const response = await apiRequest('/backfillHistoricalPerformance', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async scannerConfig(action, config) {
    if (action === 'load') {
      const response = await apiRequest('/scannerConfig');
      return { success: true, config: response.data };
    } else if (action === 'save') {
      const response = await apiRequest('/scannerConfig', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
      return { success: true, config: response.data };
    }
    throw new Error('Invalid action');
  },

  async getKlineData(data) {
    try {
      const { symbols, interval, limit, endTime, priority = 0 } = data;
      
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return { success: false, error: 'Symbols array is required' };
      }
      
      // Direct kline coordinator bypass - no API queue for kline requests
      // priority: 0 = normal (scanning), 1 = high (position monitoring)
      const result = await globalKlineCoordinator.requestKlineData(symbols, interval, limit, endTime, priority);
      
      // Extract only the requested symbols from the batch result
      if (result.success && result.data) {
        const filteredData = {};
        symbols.forEach(symbol => {
          if (result.data[symbol]) {
            filteredData[symbol] = result.data[symbol];
          }
        });
        
        return {
          success: true,
          data: filteredData
        };
      }
      
      return result;
    } catch (error) {
      console.error('[getKlineData] ❌ Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async reconcileWalletState(params) {
    console.log('[localClient] 🔄 Calling reconcileWalletState with params:', params);
    try {
      const response = await fetch('http://localhost:3003/api/functions/reconcileWalletState', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[localClient] ✅ reconcileWalletState completed:', result);
      return result;
    } catch (error) {
      console.error('[localClient] ❌ reconcileWalletState failed:', error);
      throw error;
    }
  },

  async walletReconciliation(params) {
    console.log('[localClient] 🔄 Calling walletReconciliation with params:', params);
    try {
      const response = await fetch('http://localhost:3003/api/functions/walletReconciliation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[localClient] ✅ walletReconciliation completed:', result);
      return result;
    } catch (error) {
      console.error('[localClient] ❌ walletReconciliation failed:', error);
      throw error;
    }
  },

  async purgeGhostPositions(params) {
    console.log('[localClient] 🔄 Calling purgeGhostPositions with params:', params);
    try {
      const response = await fetch('http://localhost:3003/api/functions/purgeGhostPositions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[localClient] ✅ purgeGhostPositions completed:', result);
      return result;
    } catch (error) {
      console.error('[localClient] ❌ purgeGhostPositions failed:', error);
      throw error;
    }
  },

  async getBinancePrices(params) {
    // Handle both object and array parameters
    const symbols = Array.isArray(params) ? params : (params.symbols || []);
    
    if (symbols.length === 0) {
      return [];
    }
    
    // Filter out fiat currency pairs and invalid symbols that are unavailable on Binance
    const unavailableSymbols = new Set([
      // Fiat currencies (not traded as spot pairs on Binance)
      'MXNUSDT', 'COPUSDT', 'CZKUSDT', 'ARSUSDT', 'BRLUSDT', 
      'TRYUSDT', 'EURUSDT', 'GBPUSDT', 'JPYUSDT', 'AUDUSDT', 'CADUSDT',
      'CHFUSDT', 'SEKUSDT', 'NOKUSDT', 'DKKUSDT', 'PLNUSDT', 'HUFUSDT',
      'RUBUSDT', 'INRUSDT', 'KRWUSDT', 'CNYUSDT', 'HKDUSDT', 'SGDUSDT',
      'TWDUSDT', 'THBUSDT', 'VNDUSDT', 'IDRUSDT', 'MYRUSDT', 'PHPUSDT',
      'ZARUSDT', 'UAHUSDT', 'RONUSDT', 'NGNUSDT',
      // Delisted or invalid symbols
      'DAIUSDT', 'MATICUSDT'
    ]);
    
    const availableSymbols = symbols.filter(symbol => !unavailableSymbols.has(symbol));
    
    if (availableSymbols.length === 0) {
      console.warn('[getBinancePrices] All symbols filtered out as unavailable on testnet');
      return [];
    }
    
    if (availableSymbols.length < symbols.length) {
    }
    
    try {
      
      // CRITICAL FIX: Use current price endpoint instead of 24hr ticker's lastPrice
      // The 24hr ticker's lastPrice is stale (could be hours old) and causes wrong exit prices like 4160.88 for ETH
      // Use getBatchPrices() which fetches from /api/v3/ticker/price (current price, not lastPrice)
      const priceMap = await priceCacheService.getBatchPrices(availableSymbols, 'testnet');
      
      // Optionally fetch 24hr ticker for priceChangePercent (but use current price for price field)
      let tickerMap = new Map();
      try {
        tickerMap = await priceCacheService.getBatchTicker24hr(availableSymbols, 'testnet');
      } catch (tickerError) {
        console.warn(`[getBinancePrices] ⚠️ Failed to fetch 24hr ticker for change data: ${tickerError.message}`);
      }
      
      // Convert Map to array format expected by existing code
      const results = [];
      priceMap.forEach((currentPrice, symbol) => {
        if (currentPrice && currentPrice > 0) {
          // Get priceChangePercent from 24hr ticker if available, otherwise 0
          const tickerData = tickerMap.get(symbol);
          const change = tickerData && tickerData.priceChangePercent 
            ? parseFloat(tickerData.priceChangePercent) 
            : 0;
          
          // NOTE: The 24hr ticker's lastPrice is intentionally NOT used for price - it can be stale
          // We only use it for priceChangePercent (24h change). The actual price comes from /api/v3/ticker/price
          // This diagnostic check is disabled to reduce noise - price mismatch is expected and harmless
          // if (symbol === 'ETHUSDT' && tickerData && tickerData.lastPrice) {
          //   const ethLastPrice = parseFloat(tickerData.lastPrice);
          //   const ethCurrentPrice = currentPrice;
          //   const priceDiff = Math.abs(ethCurrentPrice - ethLastPrice);
          //   const priceDiffPercent = (priceDiff / ethCurrentPrice) * 100;
          //   if (priceDiffPercent > 50) {
          //     console.warn(`[getBinancePrices] ⚠️ Large price discrepancy (expected): Current=${ethCurrentPrice}, 24hrTicker.lastPrice=${ethLastPrice} (${priceDiffPercent.toFixed(2)}% diff)`);
          //     console.warn(`[getBinancePrices] ℹ️ This is normal - 24hr ticker lastPrice is stale. We use current price (correct).`);
          //   }
          // }
          
          results.push({
            symbol: symbol,
            price: currentPrice, // CRITICAL: Use current price, not stale lastPrice
            change: change,
            timestamp: Date.now()
          });
        }
      });
      
      return results;
      
    } catch (error) {
      console.error('[getBinancePrices] ❌ Failed to fetch prices:', error);
      return [];
    }
  },

  async getExchangeInfo(symbol) {
    throw new Error('Exchange info API not implemented');
  },

   async getFearAndGreedIndex() {
     try {
       // Call direct API first (more reliable)
       const controller = new AbortController();
       const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
       
       const response = await fetch('https://api.alternative.me/fng/', {
         signal: controller.signal
       });
       
       clearTimeout(timeoutId);
       
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       
       const data = await response.json();
       
       if (data && data.data && data.data.length > 0) {
         const fngData = data.data[0];
         
         return {
           success: true,
           data: {
             data: [{
               value: fngData.value,
               value_classification: fngData.value_classification,
               timestamp: fngData.timestamp,
               time_until_update: fngData.time_until_update
             }]
           }
         };
       } else {
         throw new Error('Invalid response format from direct API');
       }
     } catch (error) {
       // Suppress network errors (expected in some environments)
       const isNetworkError = error.message?.includes('ERR_SOCKET_NOT_CONNECTED') ||
                              error.message?.includes('Failed to fetch') ||
                              error.message?.includes('NetworkError') ||
                              error.name === 'TypeError' ||
                              error.name === 'AbortError';
       
       if (isNetworkError) {
         // Silently fail for network errors - F&G Index is optional
         return {
           success: false,
           error: 'Network error - Fear & Greed Index unavailable',
           data: null
         };
       }
       
       // Try proxy server as fallback for non-network errors
       try {
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout for proxy
         
         const response = await fetch('http://localhost:3003/api/fearAndGreed', {
           method: 'GET',
           headers: {
             'Content-Type': 'application/json',
           },
           signal: controller.signal
         });
         
         clearTimeout(timeoutId);
         
         if (!response.ok) {
           throw new Error(`HTTP ${response.status}: ${response.statusText}`);
         }
         
         const proxyResponse = await response.json();
         
         if (proxyResponse.success && proxyResponse.data) {
           return proxyResponse;
         } else {
           throw new Error('Proxy server returned invalid response');
         }
       } catch (proxyError) {
         // Return failure instead of throwing - F&G Index is optional
         return {
           success: false,
           error: 'Failed to fetch Fear & Greed Index',
           data: null
         };
       }
     }
   },

  async liveTradingAPI(params) {
    // Make actual HTTP calls to BinanceLocal proxy server
    const { action, tradingMode, proxyUrl, ...otherParams } = params;
    
    
    if (!proxyUrl) {
      throw new Error('Proxy URL is required for liveTradingAPI calls');
    }
    
    try {
      let endpoint, method, body;
      
      switch (action) {
        case 'getAccountInfo':
          endpoint = `${proxyUrl}/api/binance/account?tradingMode=${tradingMode || 'testnet'}`;
          method = 'GET';
          break;
          
        case 'getExchangeInfo':
          endpoint = `${proxyUrl}/api/binance/exchangeInfo?tradingMode=${tradingMode || 'testnet'}`;
          method = 'GET';
          break;
          
        case 'createOrder':
          endpoint = `${proxyUrl}/api/binance/order`;
          method = 'POST';
          body = {
            symbol: otherParams.symbol,
            side: otherParams.side,
            type: otherParams.type || 'MARKET',
            quantity: otherParams.quantity,
            tradingMode: tradingMode || 'testnet',
            ...otherParams
          };
          break;
          
        case 'getAllOrders':
          endpoint = `${proxyUrl}/api/binance/allOrders?tradingMode=${tradingMode || 'testnet'}&symbol=${otherParams.symbol}&limit=${otherParams.limit || 10}`;
          method = 'GET';
          break;
          
        case 'getOrder':
          endpoint = `${proxyUrl}/api/binance/order?tradingMode=${tradingMode || 'testnet'}&symbol=${otherParams.symbol}&orderId=${otherParams.orderId}`;
          method = 'GET';
          break;
          
        case 'getSymbolPriceTicker':
          // Support both single symbol and multiple symbols using centralized cache
          if (otherParams.symbols && Array.isArray(otherParams.symbols)) {
            // Multiple symbols - use batch cache
            const priceMap = await priceCacheService.getBatchPrices(otherParams.symbols, tradingMode || 'testnet');
            const prices = Array.from(priceMap.entries()).map(([symbol, price]) => ({
              symbol: symbol,
              price: price.toString()
            }));
            return { success: true, data: prices };
          } else if (otherParams.symbol) {
            // Single symbol - use cache
            const price = await priceCacheService.getPrice(otherParams.symbol, tradingMode || 'testnet');
            return { 
              success: true, 
              data: { 
                symbol: otherParams.symbol, 
                price: price.toString() 
              } 
            };
          } else {
            throw new Error('Either symbol or symbols parameter is required for getSymbolPriceTicker');
          }
          break;
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      const requestOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };
      
      if (body) {
        requestOptions.body = JSON.stringify(body);
      }
      
      const response = await fetch(endpoint, requestOptions);
      const data = await response.json();
      
      if (!response.ok) {
        // CRITICAL: Preserve error code when throwing error
        const errorMsg = data.error || data.message || `HTTP ${response.status}: ${response.statusText}`;
        const errorCode = data.code || data.data?.code;
        const error = new Error(errorMsg);
        if (errorCode !== undefined) {
          error.code = errorCode;
          console.log(`[localClient] 🔍 [ERROR_CODE_PRESERVED] Error code ${errorCode} preserved for ${action}`);
        } else {
          console.log(`[localClient] ⚠️ [ERROR_CODE_MISSING] No error code found in response:`, data);
        }
        error.response = response;
        error.data = data;
        throw error;
      }
      
      // The BinanceLocal server already wraps responses in { success: true, data: ... }
      // So we can return the response directly
      return data;
      
    } catch (error) {
      console.error(`[liveTradingAPI] Error calling ${action}:`, error.message);
      console.log(`[localClient] 🔍 [CAUGHT_ERROR] Error code: ${error?.code}, message: ${error?.message}`);
      // Ensure error code is preserved even if it wasn't set above
      if (error?.code === undefined && error?.data?.code !== undefined) {
        error.code = error.data.code;
        console.log(`[localClient] ✅ [ERROR_CODE_RESTORED] Restored error code ${error.code} from error.data`);
      }
      throw error;
    }
  },

  async updatePerformanceSnapshot(params) {
    // Use local implementation instead of API call
    console.log('[liveTradingAPI] 🚀 Calling local updatePerformanceSnapshot with params:', params);
    try {
      const result = await localUpdatePerformanceSnapshot(params);
      console.log('[liveTradingAPI] ✅ Local updatePerformanceSnapshot completed:', result);
      return { success: true, data: result };
    } catch (error) {
      console.error('[liveTradingAPI] ❌ Local updatePerformanceSnapshot failed:', error);
      return { success: false, error: error.message };
    }
  },

  // Initialize price cache with common symbols
  async initializePriceCache() {
    const commonSymbols = [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'DOTUSDT',
      'DOGEUSDT', 'AVAXUSDT', 'POLUSDT', 'LINKUSDT', 'UNIUSDT', 'LTCUSDT',
      'ATOMUSDT', 'XLMUSDT', 'ALGOUSDT', 'VETUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT'
    ];
    
    try {
      console.log('[localClient] 🚀 Initializing price cache with common symbols');
      await priceCacheService.preloadCommonSymbols(commonSymbols, 'testnet');
      console.log('[localClient] ✅ Price cache initialized successfully');
    } catch (error) {
      console.error('[localClient] ❌ Failed to initialize price cache:', error);
    }
  },

  // Get price cache metrics
  getPriceCacheMetrics() {
    return priceCacheService.getMetrics();
  },

  async fetchKlineData(params) {
    // Real kline data from Binance via proxy
    const { symbol, interval, limit = 100 } = params;
    
    try {
      const proxyUrl = 'http://localhost:3003';
      const response = await fetch(`${proxyUrl}/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        return {
          success: true,
          data: data.data // Return Binance kline format directly
        };
      } else {
        throw new Error('Invalid response format from Binance API');
      }
    } catch (error) {
      console.error('[fetchKlineData] Error fetching kline data:', error);
      throw error;
    }
  },

  async fetchAllAssetsFromTestnet() {
    // Fetch all assets from Binance testnet using the provided API keys
    try {
      console.log('[fetchAllAssetsFromTestnet] Fetching all assets from Binance testnet...');
      
      const proxyUrl = 'http://localhost:3003';
      
      // First, get account info to confirm we're using the correct testnet keys
      const accountResponse = await fetch(`${proxyUrl}/api/binance/account?tradingMode=testnet`);
      const accountData = await accountResponse.json();
      
      console.log('[fetchAllAssetsFromTestnet] Account info response:', accountData);
      
      if (accountData.success && accountData.data) {
        console.log('[fetchAllAssetsFromTestnet] ✅ Successfully connected to Binance testnet');
        console.log('[fetchAllAssetsFromTestnet] Account type:', accountData.data.accountType);
        console.log('[fetchAllAssetsFromTestnet] Balances count:', accountData.data.balances?.length || 0);
        
        // Display all balances/assets
        if (accountData.data.balances && accountData.data.balances.length > 0) {
          console.log('[fetchAllAssetsFromTestnet] 📊 All assets from testnet:');
          accountData.data.balances.forEach((balance, index) => {
            console.log(`[fetchAllAssetsFromTestnet] Asset ${index + 1}:`, {
              asset: balance.asset,
              free: balance.free,
              locked: balance.locked,
              total: (parseFloat(balance.free) + parseFloat(balance.locked)).toFixed(8)
            });
          });
        } else {
          console.log('[fetchAllAssetsFromTestnet] ⚠️ No balances found in testnet account');
        }
        
        return {
          success: true,
          data: accountData.data,
          assets: accountData.data.balances || []
        };
      } else {
        console.error('[fetchAllAssetsFromTestnet] ❌ Failed to connect to testnet:', accountData.error);
        return {
          success: false,
          error: accountData.error || 'Failed to fetch account info'
        };
      }
    } catch (error) {
      console.error('[fetchAllAssetsFromTestnet] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async fetchAllAssetsFromTestnet() {
    // Fetch all assets from Binance testnet using the provided API keys
    try {
      console.log('[fetchAllAssetsFromTestnet] Fetching all assets from Binance testnet...');
      
      const proxyUrl = 'http://localhost:3003';
      
      // First, get account info to confirm we're using the correct testnet keys
      const accountResponse = await fetch(`${proxyUrl}/api/binance/account?tradingMode=testnet`);
      const accountData = await accountResponse.json();
      
      console.log('[fetchAllAssetsFromTestnet] Account info response:', accountData);
      
      if (accountData.success && accountData.data) {
        console.log('[fetchAllAssetsFromTestnet] ✅ Successfully connected to Binance testnet');
        console.log('[fetchAllAssetsFromTestnet] Account type:', accountData.data.accountType);
        console.log('[fetchAllAssetsFromTestnet] Balances count:', accountData.data.balances?.length || 0);
        
        // Display all balances/assets
        if (accountData.data.balances && accountData.data.balances.length > 0) {
          console.log('[fetchAllAssetsFromTestnet] 📊 All assets from testnet:');
          accountData.data.balances.forEach((balance, index) => {
            console.log(`[fetchAllAssetsFromTestnet] Asset ${index + 1}:`, {
              asset: balance.asset,
              free: balance.free,
              locked: balance.locked,
              total: (parseFloat(balance.free) + parseFloat(balance.locked)).toFixed(8)
            });
          });
        } else {
          console.log('[fetchAllAssetsFromTestnet] ⚠️ No balances found in testnet account');
        }
        
        return {
          success: true,
          data: accountData.data,
          assets: accountData.data.balances || []
        };
      } else {
        console.error('[fetchAllAssetsFromTestnet] ❌ Failed to connect to testnet:', accountData.error);
        return {
          success: false,
          error: accountData.error || 'Failed to fetch account info'
        };
      }
    } catch (error) {
      console.error('[fetchAllAssetsFromTestnet] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async scannerSessionManager(params) {
    // Mock implementation for scanner session management with persistent state
    // console.log(`[scannerSessionManager] called with:`, params);
    
    // Handle object parameter (new format)
    const action = params?.action || 'unknown';
    const sessionId = params?.sessionId;
    const force = params?.force;
    
    // Persistent session state (survives across calls)
    if (!window._mockSessionState) {
      window._mockSessionState = {
        isActive: false,
        activeSessionId: null,
        lastHeartbeat: null,
        sessionStartTime: null
      };
    }
    
    const state = window._mockSessionState;
    const now = Date.now();
    
    switch (action) {
      case 'sendHeartbeat':
        if (state.isActive && state.activeSessionId === sessionId) {
          state.lastHeartbeat = now;
          return { 
            success: true, 
            data: { 
              success: true, 
              timestamp: now 
            } 
          };
        } else {
          return { 
            success: false, 
            data: { 
              success: false, 
              error: 'No active session to heartbeat' 
            } 
          };
        }
        
      case 'getSessionStatus':
        // Check if session has expired (5 minutes without heartbeat)
        const heartbeatTimeout = 5 * 60 * 1000; // 5 minutes
        if (state.isActive && state.lastHeartbeat && (now - state.lastHeartbeat) > heartbeatTimeout) {
          console.log('[scannerSessionManager] Session expired due to heartbeat timeout');
          state.isActive = false;
          state.activeSessionId = null;
        }
        
        return { 
          success: true, 
          data: { 
            success: true, 
            is_active: state.isActive, 
            active_session_id: state.activeSessionId,
            isLeader: state.isActive && state.activeSessionId === sessionId
          } 
        };
        
      case 'claimSession':
        // Only allow claiming if no active session or force is true
        if (!state.isActive || force) {
          state.isActive = true;
          state.activeSessionId = sessionId;
          state.lastHeartbeat = now;
          state.sessionStartTime = now;
          console.log(`[scannerSessionManager] Session claimed by ${sessionId}`);
          return { 
            success: true, 
            data: { 
              success: true, 
              sessionId: sessionId,
              code: 'success'
            } 
          };
        } else {
          // Session claim failed - already active (expected behavior)
          return { 
            success: false, 
            data: { 
              success: false, 
              error: 'Session already active',
              active_session_id: state.activeSessionId
            } 
          };
        }
        
      case 'releaseSession':
        if (state.isActive && state.activeSessionId === sessionId) {
          state.isActive = false;
          state.activeSessionId = null;
          state.lastHeartbeat = null;
          state.sessionStartTime = null;
          console.log(`[scannerSessionManager] Session released by ${sessionId}`);
          return { 
            success: true, 
            data: { 
              success: true 
            } 
          };
        } else {
          console.log(`[scannerSessionManager] Release failed - session not active or not owned by ${sessionId}`);
          return { 
            success: false, 
            data: { 
              success: false, 
              error: 'Session not active or not owned by this session'
            } 
          };
        }
        
      default:
        console.warn(`[scannerSessionManager] Unknown action: ${action}, defaulting to getSessionStatus`);
        return { 
          success: true, 
          data: { 
            success: true, 
            is_active: state.isActive, 
            active_session_id: state.activeSessionId,
            isLeader: state.isActive && state.activeSessionId === sessionId
          } 
        };
    }
  },

   async testBinanceKeys(params) {
     // Test Binance API keys by making a request to the proxy server
     const { mode, proxyUrl } = params;
     
     try {
       // Make a test request to the proxy server to verify API keys
       const response = await fetch(`${proxyUrl}/api/binance/account?tradingMode=${mode}`, {
         method: 'GET',
         headers: {
           'Content-Type': 'application/json',
         }
       });
       
       if (!response.ok) {
         const errorData = await response.json().catch(() => ({}));
         throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
       }
       
       const data = await response.json();
       
       if (data.success) {
         return {
           success: true,
           data: {
             success: true,
             message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} API keys are valid and working`
           }
         };
       } else {
         throw new Error(data.error || 'API key test failed');
       }
     } catch (error) {
       return {
         success: false,
         data: {
           success: false,
           message: error.message
         }
       };
     }
   },

  async archiveOldTrades(params = {}) {
    // Real implementation of archiveOldTrades function
    const TRADE_LIMIT = 2000; // Maximum number of trades before archiving
    const TARGET_TRADES = 1800; // Desired number after archiving
    const BATCH_SIZE = 50; // Records to delete in one batch
    const PAGE_SIZE = 200; // Records to fetch when counting
    
    try {
      const perfStart = Date.now();
      
      // Step 1: Count total trades efficiently
      let totalCount = 0;
      let offset = 0;
      let exceededLimit = false;
      while (true) {
        const pageResponse = await apiRequest('/trades', {
          method: 'GET',
          params: {
            orderBy: '-exit_timestamp',
            limit: PAGE_SIZE,
            offset: offset
          }
        });
        
        if (!pageResponse.success || !pageResponse.data) {
          break;
        }
        
        const page = pageResponse.data;
        totalCount += page.length;
        
        if (totalCount >= TRADE_LIMIT) {
          exceededLimit = true;
          break;
        }
        
        if (page.length === 0) {
          break;
        }
        
        offset += PAGE_SIZE;
        
        // Small delay to prevent overloading
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Step 2: Check if archiving is needed
      if (!exceededLimit) {
        return {
          success: true,
          data: {
            deletedCount: 0,
            remainingCount: totalCount,
            moreToProcess: false,
            message: `No archiving needed. Total trades: ${totalCount} (limit: ${TRADE_LIMIT})`,
            performance: { totalMs: Date.now() - perfStart }
          }
        };
      }
      
      // Step 3: Calculate how many trades to delete
      const tradesToDelete = Math.min(totalCount - TARGET_TRADES, BATCH_SIZE);
      // Archiving needed
      
      // Step 4: Get oldest trades for deletion
      const oldestTradesResponse = await apiRequest('/trades', {
        method: 'GET',
        params: {
          orderBy: 'exit_timestamp',
          limit: tradesToDelete,
          offset: 0
        }
      });
      
      if (!oldestTradesResponse.success || !oldestTradesResponse.data) {
        return {
          success: true,
          data: {
            deletedCount: 0,
            remainingCount: totalCount,
            moreToProcess: false,
            message: 'No trades found for deletion',
            performance: { totalMs: Date.now() - perfStart }
          }
        };
      }
      
      const tradesToDeleteList = oldestTradesResponse.data;
      // Trades to delete identified
      
      // Step 5: Delete trades in batches
      let deletedCount = 0;
      const deletionErrors = [];
      let skippedCount = 0;
      
      for (const trade of tradesToDeleteList) {
        // CRITICAL FIX: Skip trades without valid IDs to prevent 404 errors
        if (!trade || !trade.id || trade.id === 'undefined' || trade.id === undefined || trade.id === null) {
          skippedCount++;
          console.warn(`[archiveOldTrades] ⚠️ Skipping trade with invalid ID:`, {
            trade: trade,
            id: trade?.id,
            hasId: !!trade?.id,
            idType: typeof trade?.id
          });
          continue;
        }
        
        try {
          await apiRequest(`/trades/${trade.id}`, {
            method: 'DELETE'
          });
          deletedCount++;
          
          // Small delay between deletions
          await new Promise(resolve => setTimeout(resolve, 20));
        } catch (error) {
          // Only log if it's not a 404 (which is expected for already-deleted trades)
          if (error?.response?.status !== 404) {
            console.error(`[archiveOldTrades] Failed to delete trade ${trade.id}:`, error);
          }
          deletionErrors.push({ id: trade.id, error: error.message });
          
          // Longer delay on error
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (skippedCount > 0) {
        console.warn(`[archiveOldTrades] ⚠️ Skipped ${skippedCount} trades with invalid IDs`);
      }
      
      const remainingCount = totalCount - deletedCount;
      const moreToProcess = remainingCount >= TRADE_LIMIT;
      
      // Archiving complete
      
      return {
        success: true,
        data: {
          deletedCount,
          remainingCount,
          moreToProcess,
          message: `Archived ${deletedCount} trades. ${remainingCount} remaining.${deletionErrors.length > 0 ? ` ${deletionErrors.length} deletion errors.` : ''}`,
          performance: { totalMs: Date.now() - perfStart },
          deletionErrors: deletionErrors.length > 0 ? deletionErrors : undefined
        }
      };
      
    } catch (error) {
      console.error('[archiveOldTrades] Error during archiving:', error);
      console.error('[archiveOldTrades] Error stack:', error.stack);
      return {
        success: false,
        data: {
          deletedCount: 0,
          remainingCount: 0,
          moreToProcess: false,
          message: `Archiving failed: ${error.message}`,
          performance: { totalMs: 0 }
        }
      };
    }
  },

  async saveApiKeys(keys) {
    // Save API keys to localStorage for local development
    console.log('[saveApiKeys] Saving API keys to localStorage');
    
    try {
      // Store keys in localStorage (in a real app, these would be encrypted)
      const keysData = {
        liveApiKey: keys.liveApiKey || '',
        liveApiSecret: keys.liveApiSecret || '',
        testnetApiKey: keys.testnetApiKey || '',
        testnetApiSecret: keys.testnetApiSecret || '',
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem('binanceApiKeys', JSON.stringify(keysData));
      
      console.log('[saveApiKeys] API keys saved successfully');
      
      return {
        success: true,
        data: {
          success: true,
          message: 'API keys saved successfully'
        }
      };
    } catch (error) {
      console.error('[saveApiKeys] Error saving API keys:', error.message);
      return {
        success: false,
        data: {
          success: false,
          message: error.message
        }
      };
    }
  }
};

// Auth mock (no authentication needed for local development)
export const auth = {
  async me() {
    return {
      id: 'local-user',
      email: 'local@cryptosentinel.dev',
      full_name: 'Local User',
      role: 'admin'
    };
  },

  setToken(token) {
    // No-op for local development
  },

  async login(email, password) {
    return {
      user: await this.me(),
      token: 'local-token'
    };
  },

  async logout() {
    return { success: true };
  }
};

// Main client object that mimics Base44 SDK
export const localClient = {
  entities: {
    Trade,
    ScanSettings,
    HistoricalPerformance,
    BacktestCombination,
    MarketAlert,
    ScannerSession,
    ScannerStats,
    LivePosition,
    WalletSummary,
    CentralWalletState,
    TradingSignal,
    SignalPerformance,
    OptedOutCombination
  },
  functions,
  auth
};

export default localClient;
