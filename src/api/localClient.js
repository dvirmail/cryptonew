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

  async list(orderBy = '-created_date', limit = 100) {
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
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const params = new URLSearchParams({ ...conditions, orderBy, limit });
      const response = await apiRequest(`/${this.name}?${params}`);
      return response.data;
    }
    
    // Special handling for entities that use direct API endpoints
    if (this.name === 'walletSummaries' || this.name === 'livePositions' || this.name === 'ScanSettings' || this.name === 'trades') {
      const params = new URLSearchParams({ ...conditions, orderBy, limit });
      const response = await apiRequest(`/${this.name}?${params}`);
      return response.data;
    }
    
    const params = new URLSearchParams({ ...conditions, orderBy, limit });
    const response = await apiRequest(`/entities/${this.name}?${params}`);
    return response.data;
  }

  async bulkCreate(items) {
    // For local client, create items one by one
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

        // Global kline coordinator for batching requests
        const globalKlineCoordinator = {
          // NEW: Pre-collection system to bypass sequential API queue
          preCollectionMode: false,
          preCollectedRequests: new Map(), // Map<symbolTimeframeKey, Array<requests>>
          preCollectionTimeout: null,
          preCollectionInterval: 500, // Collect requests for 500ms before processing
          
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
            this.preCollectionMode = false;
            
            if (this.preCollectedRequests.size === 0) {
              return;
            }
            
            // Process all groups in parallel
            const processingPromises = [];
            
            for (const [symbolTimeframeKey, requests] of this.preCollectedRequests) {
              
              // Group requests by endTime
              const requestsByEndTime = new Map();
              requests.forEach(request => {
                const endTimeKey = request.endTime || 'latest';
                if (!requestsByEndTime.has(endTimeKey)) {
                  requestsByEndTime.set(endTimeKey, []);
                }
                requestsByEndTime.get(endTimeKey).push(request);
              });
              
              // Process each endTime group
              for (const [endTimeKey, endTimeRequests] of requestsByEndTime) {
                const processingPromise = this.processRequestGroup(endTimeRequests, endTimeKey);
                processingPromises.push(processingPromise);
              }
            }
            
            // Wait for all processing to complete
            try {
              await Promise.all(processingPromises);
            } catch (error) {
              console.error(`[KLINE_COORDINATOR] ❌ Error processing pre-collected requests:`, error);
            }
            
            // Clear the collection
            this.preCollectedRequests.clear();
          },
          
          // NEW: Process a group of requests with the same endTime
          async processRequestGroup(requests, endTimeKey) {
            if (requests.length === 0) return;
            
            const firstRequest = requests[0];
            const symbols = [...new Set(requests.flatMap(req => req.symbols))];
            
            try {
              // Make the actual API call
              const result = await executeKlineRequest(symbols, firstRequest.interval, firstRequest.limit, firstRequest.endTime);
              
              // Resolve all requests in this group
              requests.forEach(request => {
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
              requests.forEach(request => {
                request.reject(error);
              });
            }
          },
  
          requestKlineData(symbols, interval, limit, endTime) {
            return new Promise((resolve, reject) => {
              const requestKey = `${symbols.join(',')}_${interval}_${limit || 'default'}_${endTime || 'latest'}`;
              const timeframeKey = `${interval}_${limit || 'default'}`;
              const symbolTimeframeKey = `${symbols.join(',')}_${interval}`; // Group by symbol+timeframe regardless of endTime
              const timestamp = Date.now();
              
              // NEW: Use pre-collection system to bypass sequential API queue
              if (!this.preCollectionMode) {
                this.startPreCollection();
              }
              
              // Add request to pre-collection
              if (!this.preCollectedRequests.has(symbolTimeframeKey)) {
                this.preCollectedRequests.set(symbolTimeframeKey, []);
              }
              
              const requestData = {
                symbols,
                interval,
                limit,
                endTime,
                resolve,
                reject,
                timestamp
              };
              
              this.preCollectedRequests.get(symbolTimeframeKey).push(requestData);
              
              const totalRequests = Array.from(this.preCollectedRequests.values()).flat().length;
              
              // Extend the collection timeout if this is a new request
              if (this.preCollectionTimeout) {
                clearTimeout(this.preCollectionTimeout);
                this.preCollectionTimeout = setTimeout(() => {
                  this.processPreCollectedRequests();
                }, this.preCollectionInterval);
              }
              
              // NEW: Force processing after collecting a reasonable number of requests
              if (totalRequests >= 5) {
                clearTimeout(this.preCollectionTimeout);
                this.processPreCollectedRequests();
              }
            });
          },
          
};

// Helper function for executing kline requests - ALWAYS use batch endpoint
async function executeKlineRequest(symbols, interval, limit, endTime) {
  try {
    // ALWAYS use batch endpoint, even for single symbols
    
    const symbolsParam = JSON.stringify(symbols);
    const batchUrl = `http://localhost:3003/api/binance/klines/batch?symbols=${encodeURIComponent(symbolsParam)}&interval=${interval}${limit ? `&limit=${limit}` : ''}${endTime ? `&endTime=${endTime}` : ''}`;
    
    const response = await fetch(batchUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const batchData = await response.json();
    
    if (batchData.success && batchData.data) {
      // Convert batch response to expected format
      const results = {};
      batchData.data.forEach(item => {
        results[item.symbol] = {
          success: item.success,
          data: item.data,
          error: item.error
        };
      });
      
      return {
        success: true,
        data: results
      };
    } else {
      return {
        success: false,
        error: batchData.error || 'Failed to fetch batch kline data'
      };
    }
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
      const { symbols, interval, limit, endTime } = data;
      
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return { success: false, error: 'Symbols array is required' };
      }
      
      // Direct kline coordinator bypass - no API queue for kline requests
      const result = await globalKlineCoordinator.requestKlineData(symbols, interval, limit, endTime);
      
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
    
    // Filter out only fiat currency pairs that are truly unavailable on testnet
    const unavailableSymbols = new Set([
      'MXNUSDT', 'COPUSDT', 'CZKUSDT', 'ARSUSDT', 'BRLUSDT', 
      'TRYUSDT', 'EURUSDT', 'GBPUSDT', 'JPYUSDT', 'AUDUSDT', 'CADUSDT',
      'CHFUSDT', 'SEKUSDT', 'NOKUSDT', 'DKKUSDT', 'PLNUSDT', 'HUFUSDT',
      'RUBUSDT', 'INRUSDT', 'KRWUSDT', 'CNYUSDT', 'HKDUSDT', 'SGDUSDT',
      'TWDUSDT', 'THBUSDT', 'VNDUSDT', 'IDRUSDT', 'MYRUSDT', 'PHPUSDT'
    ]);
    
    const availableSymbols = symbols.filter(symbol => !unavailableSymbols.has(symbol));
    
    if (availableSymbols.length === 0) {
      console.warn('[getBinancePrices] All symbols filtered out as unavailable on testnet');
      return [];
    }
    
    if (availableSymbols.length < symbols.length) {
      console.log(`[getBinancePrices] Filtered out ${symbols.length - availableSymbols.length} unavailable symbols on testnet`);
    }
    
    try {
      console.log(`[getBinancePrices] 📊 Request for ${availableSymbols.length} symbols: ${availableSymbols.slice(0, 5).join(', ')}${availableSymbols.length > 5 ? '...' : ''}`);
      
      // Use centralized cache service for batch fetching with global coordination
      const tickerMap = await priceCacheService.getBatchTicker24hr(availableSymbols, 'testnet');
      
      // Convert Map to array format expected by existing code
      const results = [];
      tickerMap.forEach((tickerData, symbol) => {
        if (tickerData && tickerData.lastPrice) {
          results.push({
            symbol: symbol,
            price: tickerData.lastPrice,
            change: parseFloat(tickerData.priceChangePercent) || 0,
            timestamp: Date.now()
          });
        }
      });
      
      console.log(`[getBinancePrices] ✅ Retrieved ${results.length} prices from global batch`);
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
       // Try proxy server as fallback
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
         throw new Error('Failed to fetch Fear & Greed Index from proxy server');
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
            type: 'MARKET',
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
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      // The BinanceLocal server already wraps responses in { success: true, data: ... }
      // So we can return the response directly
      return data;
      
    } catch (error) {
      console.error(`[liveTradingAPI] Error calling ${action}:`, error.message);
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
      'DOGEUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT', 'LTCUSDT',
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
          console.log(`[scannerSessionManager] Session claim failed - already active by ${state.activeSessionId}`);
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
    console.log('[archiveOldTrades] Starting trade archiving process...');
    
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
      
      console.log('[archiveOldTrades] Counting trades...');
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
      
      console.log(`[archiveOldTrades] Total trades: ${totalCount}, Exceeded limit: ${exceededLimit}`);
      
      // Step 2: Check if archiving is needed
      if (!exceededLimit) {
        console.log(`[archiveOldTrades] No archiving needed. Total trades: ${totalCount} (limit: ${TRADE_LIMIT})`);
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
      console.log(`[archiveOldTrades] Need to delete ${tradesToDelete} trades`);
      
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
      console.log(`[archiveOldTrades] Found ${tradesToDeleteList.length} trades to delete`);
      
      // Step 5: Delete trades in batches
      let deletedCount = 0;
      const deletionErrors = [];
      
      for (const trade of tradesToDeleteList) {
        try {
          await apiRequest(`/trades/${trade.id}`, {
            method: 'DELETE'
          });
          deletedCount++;
          
          // Small delay between deletions
          await new Promise(resolve => setTimeout(resolve, 20));
        } catch (error) {
          console.error(`[archiveOldTrades] Failed to delete trade ${trade.id}:`, error);
          deletionErrors.push({ id: trade.id, error: error.message });
          
          // Longer delay on error
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      const remainingCount = totalCount - deletedCount;
      const moreToProcess = remainingCount >= TRADE_LIMIT;
      
      console.log(`[archiveOldTrades] Deleted ${deletedCount} trades, ${remainingCount} remaining`);
      
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
