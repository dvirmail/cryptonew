/**
 * PriceCacheService - Centralized Price Data Cache
 * 
 * This service eliminates redundant API calls by:
 * - Fetching all required symbols in batch
 * - Caching price and 24hr data
 * - Providing efficient lookup methods
 * - Managing cache invalidation and refresh
 */

class PriceCacheService {
    constructor() {
        this.priceCache = new Map(); // symbol -> { price, timestamp, data }
        this.ticker24hrCache = new Map(); // symbol -> { data, timestamp }
        this.cacheTimeout = 30000; // 30 seconds cache timeout
        this.refreshInProgress = false;
        this.pendingRequests = new Map(); // symbol -> Promise
        
        // Request batching mechanism
        this.batchQueue = new Set();
        this.batchTimeout = null;
        this.batchDelay = 100; // Wait 100ms to collect more requests
        this.isProcessingBatch = false; // Prevent concurrent batch processing
        this.globalBatchPromise = null; // Single global batch promise
        this.globalBatchLock = false; // Global lock to prevent race conditions
        this.pendingBatchRequests = new Map(); // Track pending requests by type
        
        // Performance metrics
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            apiCalls: 0,
            batchCalls: 0,
            totalSymbols: 0,
            batchedRequests: 0,
            consolidatedBatches: 0
        };
        
        // Centralized price coordination
        this.globalPriceCoordinator = null;
        this.priceUpdateInterval = null;
        this.subscribers = new Set();
        
        // Make debug functions available globally
        if (typeof window !== 'undefined') {
            window.priceCache = this;
            window.getPriceCacheMetrics = () => this.getMetrics();
            window.clearPriceCache = () => this.clearCache();
            window.refreshPriceCache = () => this.refreshCache();
            window.startGlobalPriceCoordinator = () => this.startGlobalPriceCoordinator();
            window.stopGlobalPriceCoordinator = () => this.stopGlobalPriceCoordinator();
        }
    }

    /**
     * Get price for a single symbol (with caching)
     * @param {string} symbol - Symbol to get price for
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @returns {Promise<number>} Price value
     */
    async getPrice(symbol, tradingMode = 'testnet') {
        const cacheKey = `${symbol}_${tradingMode}`;
        
        // Check cache first
        if (this.isCacheValid(cacheKey, this.priceCache)) {
            this.metrics.cacheHits++;
            return parseFloat(this.priceCache.get(cacheKey).price);
        }
        
        // Check if request is already in progress
        if (this.pendingRequests.has(cacheKey)) {
            const result = await this.pendingRequests.get(cacheKey);
            return parseFloat(result.price);
        }
        
        this.metrics.cacheMisses++;
        
        // Make API call
        const promise = this.fetchSinglePrice(symbol, tradingMode);
        this.pendingRequests.set(cacheKey, promise);
        
        try {
            const result = await promise;
            this.priceCache.set(cacheKey, {
                price: result.price,
                timestamp: Date.now(),
                data: result
            });
            return parseFloat(result.price);
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    /**
     * Get 24hr ticker data for a single symbol (with caching)
     * @param {string} symbol - Symbol to get ticker for
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @returns {Promise<Object>} Ticker data
     */
    async getTicker24hr(symbol, tradingMode = 'testnet') {
        const cacheKey = `${symbol}_${tradingMode}`;
        
        // Check cache first
        if (this.isCacheValid(cacheKey, this.ticker24hrCache)) {
            this.metrics.cacheHits++;
            return this.ticker24hrCache.get(cacheKey).data;
        }
        
        // Check if request is already in progress
        if (this.pendingRequests.has(cacheKey)) {
            return await this.pendingRequests.get(cacheKey);
        }
        
        this.metrics.cacheMisses++;
        
        // Make API call
        const promise = this.fetchSingleTicker24hr(symbol, tradingMode);
        this.pendingRequests.set(cacheKey, promise);
        
        try {
            const result = await promise;
            this.ticker24hrCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });
            return result;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    /**
     * Batch fetch prices for multiple symbols
     * @param {Array<string>} symbols - Array of symbols
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @returns {Promise<Map>} Map of symbol -> price
     */
    async getBatchPrices(symbols, tradingMode = 'testnet') {
        if (!Array.isArray(symbols) || symbols.length === 0) {
            return new Map();
        }

        const results = new Map();
        const symbolsToFetch = [];
        
        // Check cache for existing data
        symbols.forEach(symbol => {
            const cacheKey = `${symbol}_${tradingMode}`;
            if (this.isCacheValid(cacheKey, this.priceCache)) {
                this.metrics.cacheHits++;
                results.set(symbol, parseFloat(this.priceCache.get(cacheKey).price));
            } else {
                symbolsToFetch.push(symbol);
            }
        });

        // If we have symbols to fetch, add them to the global batch queue
        if (symbolsToFetch.length > 0) {
            return this.addToGlobalBatch(symbolsToFetch, tradingMode, 'prices', results);
        }

        return results;
    }

    /**
     * Add symbols to global batch for consolidated processing
     * @param {Array<string>} symbols - Symbols to fetch
     * @param {string} tradingMode - Trading mode
     * @param {string} type - Type of data (prices or tickers)
     * @param {Map} existingResults - Existing results to merge with
     * @returns {Promise<Map>} Combined results
     */
    async addToGlobalBatch(symbols, tradingMode, type, existingResults = new Map()) {
        const batchKey = `${tradingMode}_${type}`;
        
        // Add symbols to global batch queue
        symbols.forEach(symbol => {
            this.batchQueue.add(`${symbol}_${tradingMode}_${type}`);
        });

        this.metrics.batchedRequests += symbols.length;

        // Check if there's already a pending batch for this type
        if (this.pendingBatchRequests.has(batchKey)) {
            //console.log(`[PriceCacheService] 🔄 Waiting for existing ${type} batch to complete`);
            const batchPromise = this.pendingBatchRequests.get(batchKey);
            await batchPromise;
            
            // After the batch completes, check if our symbols are now cached
            const finalResults = new Map(existingResults);
            symbols.forEach(symbol => {
                const cacheKey = `${symbol}_${tradingMode}`;
                const cache = type === 'prices' ? this.priceCache : this.ticker24hrCache;
                if (this.isCacheValid(cacheKey, cache)) {
                    if (type === 'prices') {
                        finalResults.set(symbol, parseFloat(cache.get(cacheKey).price));
                    } else {
                        finalResults.set(symbol, cache.get(cacheKey).data);
                    }
                }
            });
            return finalResults;
        }

        // Create new global batch promise with lock
        if (this.globalBatchLock) {
            //console.log(`[PriceCacheService] 🔒 Global batch lock active, waiting...`);
            // Wait for lock to be released
            while (this.globalBatchLock) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        this.globalBatchLock = true;
        const batchPromise = this.processGlobalBatch(tradingMode, type);
        this.pendingBatchRequests.set(batchKey, batchPromise);
        
        try {
            await batchPromise;
            
            // After global batch completes, get our results
            const finalResults = new Map(existingResults);
            symbols.forEach(symbol => {
                const cacheKey = `${symbol}_${tradingMode}`;
                const cache = type === 'prices' ? this.priceCache : this.ticker24hrCache;
                if (this.isCacheValid(cacheKey, cache)) {
                    if (type === 'prices') {
                        finalResults.set(symbol, parseFloat(cache.get(cacheKey).price));
                    } else {
                        finalResults.set(symbol, cache.get(cacheKey).data);
                    }
                }
            });
            
            return finalResults;
        } finally {
            this.pendingBatchRequests.delete(batchKey);
            this.globalBatchLock = false;
        }
    }

    /**
     * Process the global batch queue and fetch all symbols at once
     * @param {string} tradingMode - Trading mode
     * @param {string} type - Type of data (prices or tickers)
     */
    async processGlobalBatch(tradingMode, type) {
        // Wait a bit to collect more requests
        await new Promise(resolve => setTimeout(resolve, this.batchDelay));

        // Extract all unique symbols from batch queue
        const symbolsToFetch = new Set();
        this.batchQueue.forEach(queueItem => {
            const [symbol, mode, dataType] = queueItem.split('_');
            if (mode === tradingMode && dataType === type) {
                symbolsToFetch.add(symbol);
            }
        });

        if (symbolsToFetch.size === 0) {
            return;
        }

        //console.log(`[PriceCacheService] 🚀 Processing GLOBAL consolidated batch: ${symbolsToFetch.size} ${type} symbols`);
        
        // Clear the batch queue
        this.batchQueue.clear();

        try {
            // Fetch all symbols in one batch
            let fetchedData;
            if (type === 'prices') {
                fetchedData = await this.fetchBatchPrices(Array.from(symbolsToFetch), tradingMode);
            } else {
                fetchedData = await this.fetchBatchTicker24hr(Array.from(symbolsToFetch), tradingMode);
            }

            // Update cache for all fetched symbols
            fetchedData.forEach((data, symbol) => {
                if (type === 'prices') {
                    const cacheKey = `${symbol}_${tradingMode}`;
                    this.priceCache.set(cacheKey, {
                        price: data.toString(),
                        timestamp: Date.now(),
                        data: { symbol, price: data.toString() }
                    });
                } else {
                    const cacheKey = `${symbol}_${tradingMode}`;
                    this.ticker24hrCache.set(cacheKey, {
                        data: data,
                        timestamp: Date.now()
                    });
                }
            });

            this.metrics.consolidatedBatches++;
            this.metrics.cacheMisses += symbolsToFetch.size;
            this.metrics.batchCalls++;
            this.metrics.totalSymbols += symbolsToFetch.size;
            
            //console.log(`[PriceCacheService] ✅ GLOBAL consolidated batch completed: ${fetchedData.size}/${symbolsToFetch.size} symbols`);

        } catch (error) {
            console.error('[PriceCacheService] ❌ GLOBAL consolidated batch failed:', error);
        }
    }

    /**
     * Batch fetch 24hr ticker data for multiple symbols
     * @param {Array<string>} symbols - Array of symbols
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @returns {Promise<Map>} Map of symbol -> ticker data
     */
    async getBatchTicker24hr(symbols, tradingMode = 'testnet') {
        if (!Array.isArray(symbols) || symbols.length === 0) {
            return new Map();
        }

        const results = new Map();
        const symbolsToFetch = [];
        
        // Check cache for existing data
        symbols.forEach(symbol => {
            const cacheKey = `${symbol}_${tradingMode}`;
            if (this.isCacheValid(cacheKey, this.ticker24hrCache)) {
                this.metrics.cacheHits++;
                results.set(symbol, this.ticker24hrCache.get(cacheKey).data);
            } else {
                symbolsToFetch.push(symbol);
            }
        });

        // If we have symbols to fetch, add them to the global batch queue
        if (symbolsToFetch.length > 0) {
            return this.addToGlobalBatch(symbolsToFetch, tradingMode, 'tickers', results);
        }

        return results;
    }

    /**
     * Check if cache entry is still valid
     * @param {string} cacheKey - Cache key
     * @param {Map} cache - Cache map
     * @returns {boolean} True if valid
     */
    isCacheValid(cacheKey, cache) {
        const entry = cache.get(cacheKey);
        if (!entry) return false;
        
        const age = Date.now() - entry.timestamp;
        return age < this.cacheTimeout;
    }

    /**
     * Fetch single price from API
     * @param {string} symbol - Symbol
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Object>} Price data
     */
    async fetchSinglePrice(symbol, tradingMode) {
        this.metrics.apiCalls++;
        const proxyUrl = 'http://localhost:3003';
        const endpoint = `${proxyUrl}/api/binance/ticker/price?symbol=${symbol}&tradingMode=${tradingMode}`;
        
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${symbol}`);
        }
        
        const data = await response.json();
        return {
            symbol,
            price: data.data?.price || '0'
        };
    }

    /**
     * Fetch single 24hr ticker from API
     * @param {string} symbol - Symbol
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Object>} Ticker data
     */
    async fetchSingleTicker24hr(symbol, tradingMode) {
        this.metrics.apiCalls++;
        const proxyUrl = 'http://localhost:3003';
        const endpoint = `${proxyUrl}/api/binance/ticker/24hr?symbol=${symbol}&tradingMode=${tradingMode}`;
        
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${symbol}`);
        }
        
        const data = await response.json();
        return data.data || {};
    }

    /**
     * Fetch multiple prices in batch using the new batch endpoint
     * @param {Array<string>} symbols - Symbols to fetch
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Map>} Map of symbol -> price
     */
    async fetchBatchPrices(symbols, tradingMode) {
        //console.log(`[PriceCacheService] 📊 Batch fetching prices for ${symbols.length} symbols using batch endpoint`);
        
        try {
            const proxyUrl = 'http://localhost:3003';
            const symbolsParam = JSON.stringify(symbols);
            const endpoint = `${proxyUrl}/api/binance/ticker/price/batch?symbols=${encodeURIComponent(symbolsParam)}&tradingMode=${tradingMode}`;
            
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Batch request failed');
            }
            
            // Convert array of price data to Map
            const priceMap = new Map();
            result.data.forEach(priceData => {
                if (priceData && priceData.symbol) {
                    priceMap.set(priceData.symbol, parseFloat(priceData.price));
                }
            });
            
            //console.log(`[PriceCacheService] ✅ Batch price fetch successful: ${priceMap.size}/${symbols.length} symbols`);
            
            if (result.summary && result.summary.failed > 0) {
                console.warn(`[PriceCacheService] ⚠️ ${result.summary.failed} symbols failed to fetch`);
            }
            
            return priceMap;
            
        } catch (error) {
            console.error('[PriceCacheService] ❌ Batch price fetch failed, falling back to individual requests:', error);
            
            // Fallback to individual requests if batch fails
            return this.fetchBatchPricesFallback(symbols, tradingMode);
        }
    }

    /**
     * Fallback method for individual price requests
     * @param {Array<string>} symbols - Symbols to fetch
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Map>} Map of symbol -> price
     */
    async fetchBatchPricesFallback(symbols, tradingMode) {
        //console.log(`[PriceCacheService] 🔄 Using fallback individual price requests for ${symbols.length} symbols`);
        
        const promises = symbols.map(async (symbol) => {
            try {
                const result = await this.fetchSinglePrice(symbol, tradingMode);
                return [symbol, parseFloat(result.price)];
            } catch (error) {
                console.warn(`[PriceCacheService] ⚠️ Failed to fetch price for ${symbol}:`, error.message);
                return [symbol, 0];
            }
        });
        
        const results = await Promise.all(promises);
        return new Map(results);
    }

    /**
     * Fetch multiple 24hr tickers in batch using the new batch endpoint
     * @param {Array<string>} symbols - Symbols to fetch
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Map>} Map of symbol -> ticker data
     */
    async fetchBatchTicker24hr(symbols, tradingMode) {
        //console.log(`[PriceCacheService] 📊 Batch fetching 24hr tickers for ${symbols.length} symbols using batch endpoint`);
        
        try {
            const proxyUrl = 'http://localhost:3003';
            const symbolsParam = JSON.stringify(symbols);
            const endpoint = `${proxyUrl}/api/binance/ticker/24hr/batch?symbols=${encodeURIComponent(symbolsParam)}&tradingMode=${tradingMode}`;
            
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Batch request failed');
            }
            
            // Convert array of ticker data to Map
            const tickerMap = new Map();
            result.data.forEach(tickerData => {
                if (tickerData && tickerData.symbol) {
                    tickerMap.set(tickerData.symbol, tickerData);
                }
            });
            
            //console.log(`[PriceCacheService] ✅ Batch fetch successful: ${tickerMap.size}/${symbols.length} symbols`);
            
            if (result.summary && result.summary.failed > 0) {
                console.warn(`[PriceCacheService] ⚠️ ${result.summary.failed} symbols failed to fetch`);
            }
            
            return tickerMap;
            
        } catch (error) {
            console.error('[PriceCacheService] ❌ Batch fetch failed, falling back to individual requests:', error);
            
            // Fallback to individual requests if batch fails
            return this.fetchBatchTicker24hrFallback(symbols, tradingMode);
        }
    }

    /**
     * Fallback method for individual ticker requests
     * @param {Array<string>} symbols - Symbols to fetch
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<Map>} Map of symbol -> ticker data
     */
    async fetchBatchTicker24hrFallback(symbols, tradingMode) {
        console.log(`[PriceCacheService] 🔄 Using fallback individual requests for ${symbols.length} symbols`);
        
        const promises = symbols.map(async (symbol) => {
            try {
                const result = await this.fetchSingleTicker24hr(symbol, tradingMode);
                return [symbol, result];
            } catch (error) {
                console.warn(`[PriceCacheService] ⚠️ Failed to fetch 24hr ticker for ${symbol}:`, error.message);
                return [symbol, {}];
            }
        });
        
        const results = await Promise.all(promises);
        return new Map(results);
    }

    /**
     * Refresh entire cache
     */
    async refreshCache() {
        if (this.refreshInProgress) {
            console.log('[PriceCacheService] ⏳ Cache refresh already in progress');
            return;
        }
        
        this.refreshInProgress = true;
        //console.log('[PriceCacheService] 🔄 Refreshing entire cache');
        
        try {
            // Clear existing cache
            this.priceCache.clear();
            this.ticker24hrCache.clear();
            
            //console.log('[PriceCacheService] ✅ Cache refreshed successfully');
        } finally {
            this.refreshInProgress = false;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.priceCache.clear();
        this.ticker24hrCache.clear();
        this.pendingRequests.clear();
        console.log('[PriceCacheService] 🗑️ Cache cleared');
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getMetrics() {
        const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
        const hitRate = totalRequests > 0 ? (this.metrics.cacheHits / totalRequests * 100).toFixed(1) : '0.0';
        const consolidationRate = this.metrics.batchedRequests > 0 ? (this.metrics.consolidatedBatches / this.metrics.batchedRequests * 100).toFixed(1) : '0.0';
        
        return {
            ...this.metrics,
            hitRate: `${hitRate}%`,
            consolidationRate: `${consolidationRate}%`,
            cacheSize: this.priceCache.size + this.ticker24hrCache.size,
            pendingRequests: this.pendingRequests.size,
            batchQueueSize: this.batchQueue.size,
            globalBatchLock: this.globalBatchLock,
            pendingBatchRequests: this.pendingBatchRequests.size
        };
    }

    /**
     * Start global price coordinator to consolidate all price requests
     * @param {number} intervalMs - Update interval in milliseconds
     */
    startGlobalPriceCoordinator(intervalMs = 15000) {
        if (this.priceUpdateInterval) {
            //console.log('[PriceCacheService] 🔄 Global price coordinator already running');
            return;
        }

        console.log(`[PriceCacheService] 🚀 Starting global price coordinator (${intervalMs}ms interval)`);
        
        this.priceUpdateInterval = setInterval(async () => {
            await this.coordinateGlobalPriceUpdate();
        }, intervalMs);

        // Initial update
        this.coordinateGlobalPriceUpdate();
    }

    /**
     * Stop global price coordinator
     */
    stopGlobalPriceCoordinator() {
        if (this.priceUpdateInterval) {
            clearInterval(this.priceUpdateInterval);
            this.priceUpdateInterval = null;
            console.log('[PriceCacheService] 🛑 Global price coordinator stopped');
        }
    }

    /**
     * Coordinate global price update across all subscribers
     */
    async coordinateGlobalPriceUpdate() {
        if (this.subscribers.size === 0) {
            return;
        }

        // Collect all symbols from all subscribers
        const allSymbols = new Set();
        this.subscribers.forEach(callback => {
            try {
                const symbols = callback();
                if (Array.isArray(symbols)) {
                    symbols.forEach(symbol => allSymbols.add(symbol));
                }
            } catch (error) {
                console.warn('[PriceCacheService] ⚠️ Subscriber callback error:', error);
            }
        });

        if (allSymbols.size === 0) {
            return;
        }

        const symbolsArray = Array.from(allSymbols);
        //console.log(`[PriceCacheService] 🌐 Global price update for ${symbolsArray.length} symbols from ${this.subscribers.size} subscribers`);

        try {
            // Use global batch coordination
            await this.getBatchTicker24hr(symbolsArray, 'testnet');
            //console.log(`[PriceCacheService] ✅ Global price update completed`);
        } catch (error) {
            console.error('[PriceCacheService] ❌ Global price update failed:', error);
        }
    }

    /**
     * Subscribe to global price updates
     * @param {Function} callback - Function that returns array of symbols to fetch
     * @returns {Function} Unsubscribe function
     */
    subscribeToGlobalUpdates(callback) {
        this.subscribers.add(callback);
        //console.log(`[PriceCacheService] 📝 Subscriber added (total: ${this.subscribers.size})`);
        
        return () => {
            this.subscribers.delete(callback);
            //console.log(`[PriceCacheService] 📝 Subscriber removed (total: ${this.subscribers.size})`);
        };
    }

    /**
     * Preload common symbols with graceful fallback
     * @param {Array<string>} symbols - Common symbols to preload
     * @param {string} tradingMode - Trading mode
     */
    async preloadCommonSymbols(symbols, tradingMode = 'testnet') {
        //console.log(`[PriceCacheService] 🚀 Preloading ${symbols.length} common symbols`);
        
        try {
            // Preload both prices and 24hr data
            await Promise.all([
                this.getBatchPrices(symbols, tradingMode),
                this.getBatchTicker24hr(symbols, tradingMode)
            ]);
            
            //console.log(`[PriceCacheService] ✅ Preloaded ${symbols.length} symbols`);
        } catch (error) {
            console.warn('[PriceCacheService] ⚠️ Preload failed due to network issues, will retry on demand:', error.message);
            
            // Don't throw error - let the system continue with empty cache
            // Individual requests will be made when needed
        }
    }
}

// Create singleton instance
const priceCacheService = new PriceCacheService();

export default priceCacheService;
