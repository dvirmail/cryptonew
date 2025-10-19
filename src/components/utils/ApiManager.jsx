/**
 * Centralized API Manager with intelligent caching and retry logic
 * Handles all external API calls to prevent 502 errors and reduce load
 */

class ApiManager {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.requestQueue = [];
    this.isProcessing = false;
    this.retryDelays = [1000, 2000, 5000, 10000, 15000]; // Progressive delays
    this.observers = new Set(); // Use Set instead of Map for better compatibility
    
    // Circuit breaker properties
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.circuitBreakerThreshold = 5;
    this.circuitBreakerTimeout = 60000; // 1 minute
    this.isCircuitOpen = false;
    
    //console.log('[ApiManager] Initialized with caching and retry logic');
  }

  // Subscribe to API manager events
  subscribe(observer) {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  // Notify observers of events
  notifyObservers(event, data) {
    this.observers.forEach(observer => {
      try {
        observer(event, data);
      } catch (error) {
        console.error('[ApiManager] Observer error:', error);
      }
    });
  }

  // Check if cache is valid
  isCacheValid(key, maxAge = 300000) { // Default 5 minutes
    if (!this.cache.has(key) || !this.cacheTimestamps.has(key)) {
      return false;
    }
    
    const cacheTime = this.cacheTimestamps.get(key);
    const age = Date.now() - cacheTime;
    return age < maxAge;
  }

  // Get from cache
  getFromCache(key, maxAge) {
    if (this.isCacheValid(key, maxAge)) {
      //console.log(`[ApiManager] Cache hit for ${key}`);
      return this.cache.get(key);
    }
    return null;
  }

  // Set cache
  setCache(key, data, customMaxAge = null) {
    this.cache.set(key, data);
    this.cacheTimestamps.set(key, Date.now());
    
    // Clean old cache entries periodically
    if (this.cache.size > 1000) {
      this.cleanOldCache();
    }
    
    //console.log(`[ApiManager] Cached data for ${key}`);
  }

  // Clean old cache entries
  cleanOldCache() {
    const now = Date.now();
    const maxAge = 600000; // 10 minutes
    
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > maxAge) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
      }
    }
    
    //console.log(`[ApiManager] Cleaned old cache entries. Current size: ${this.cache.size}`);
  }

  // Check circuit breaker
  checkCircuitBreaker() {
    if (this.isCircuitOpen) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.circuitBreakerTimeout) {
        this.isCircuitOpen = false;
        this.failureCount = 0;
        console.log('[ApiManager] Circuit breaker reset');
        this.notifyObservers('circuit_reset', {});
      }
    }
    return this.isCircuitOpen;
  }

  // Record failure
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.circuitBreakerThreshold) {
      this.isCircuitOpen = true;
      console.warn('[ApiManager] Circuit breaker opened due to repeated failures');
      this.notifyObservers('circuit_open', { failureCount: this.failureCount });
    }
  }

  // Record success
  recordSuccess() {
    if (this.failureCount > 0) {
      this.failureCount = Math.max(0, this.failureCount - 1);
      //console.log(`[ApiManager] Success recorded, failure count: ${this.failureCount}`);
    }
  }
  
  // Make HTTP request with retry logic
  async makeRequestWithRetry(requestFn, retryCount = 0) {
    if (this.checkCircuitBreaker()) {
      throw new Error('Circuit breaker is open - API temporarily unavailable');
    }

    try {
      const response = await requestFn();

      // Check for SDK-level error
      if (response.error) {
        throw new Error(response.error.message || `Request failed with status ${response.status}`);
      }
      
      // Check for application-level error in the data payload
      if (response.data && response.data.error) {
          throw new Error(response.data.error);
      }

      // Check for invalid data format
      if (!response.data) {
        throw new Error('Invalid data format received from backend');
      }

      this.recordSuccess();
      return response.data;
      
    } catch (error) {
      console.error(`[ApiManager] Request failed (attempt ${retryCount + 1}):`, error.message);
      
      const errorMessage = (error.message || '').toLowerCase();
      const shouldRetry = retryCount < this.retryDelays.length && 
                         (errorMessage.includes('502') || 
                          errorMessage.includes('503') || 
                          errorMessage.includes('504') || 
                          errorMessage.includes('timeout') ||
                          errorMessage.includes('network') ||
                          errorMessage.includes('failed to fetch'));

      if (shouldRetry) {
        const delay = this.retryDelays[retryCount];
        console.log(`[ApiManager] Retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }

      this.recordFailure();
      throw error;
    }
  }

  // Fetch multiple prices with intelligent batching
  async fetchMultiplePrices(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return { success: false, error: 'Invalid symbols array', data: [] };
    }

    // CRITICAL FIX: Ensure symbols are unique to prevent redundant processing
    const uniqueSymbols = [...new Set(symbols)];
    const binanceSymbols = uniqueSymbols.map(s => s.replace('/', ''));
    
    const cacheKey = `prices_bulk_${uniqueSymbols.sort().join(',')}`;
    
    const cached = this.getFromCache(cacheKey, 30000); // Cache price data for 30 seconds
    if (cached) {
      return cached;
    }

    try {
      const { getBinancePrices } = await import('@/api/functions');
      const responseData = await this.makeRequestWithRetry(() => getBinancePrices({ symbols: binanceSymbols }));
      
      // The backend function itself returns a `{ success, data/error }` object.
      if (!responseData.success) {
          throw new Error(responseData.error || 'getBinancePrices function returned failure');
      }
      
      const result = {
        success: true,
        data: responseData.data.map(item => ({
          symbol: item.symbol,
          price: item.price,
          change: item.change || 0,
          volume: item.volume || 0,
          error: item.error || null
        }))
      };

      this.setCache(cacheKey, result, 30000);
      return result;
      
    } catch (error) {
      console.error('[ApiManager] Failed to fetch multiple prices:', error.message);
      return {
        success: false,
        error: error.message,
        data: uniqueSymbols.map(symbol => ({
          symbol: symbol.replace('USDT', '/USDT'),
          price: null, change: null, volume: null, error: error.message
        }))
      };
    }
  }

  // Fetch kline data with caching
  async fetchKlineData(symbol, interval, limit = 500) {
    const cacheKey = `kline_${symbol}_${interval}_${limit}`;
    const cached = this.getFromCache(cacheKey, 60000);
    if (cached) {
      return cached;
    }

    try {
      const { getKlineData } = await import('@/api/functions');
      const responseData = await this.makeRequestWithRetry(() => getKlineData({ symbol, interval, limit }));
      
      // Kline data is returned directly as an array on success.
      if (!Array.isArray(responseData)) {
          throw new Error('Invalid kline data format received');
      }

      const result = { success: true, data: responseData };
      this.setCache(cacheKey, result, 60000);
      return result;
      
    } catch (error) {
      console.error(`[ApiManager] Failed to fetch kline data for ${symbol}:`, error.message);
      return { success: false, error: error.message, data: [] };
    }
  }

  // Get API status
  getStatus() {
    return {
      cacheSize: this.cache.size,
      isCircuitOpen: this.isCircuitOpen,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
    console.log('[ApiManager] Cache cleared');
  }
}

// Create singleton instance
const apiManager = new ApiManager();

// Export both the instance and the class
export default apiManager;
export { ApiManager };

// Convenience functions for backward compatibility
export const fetchMultiplePrices = (symbols) => apiManager.fetchMultiplePrices(symbols);
export const fetchKlineData = (symbol, interval, limit) => apiManager.fetchKlineData(symbol, interval, limit);