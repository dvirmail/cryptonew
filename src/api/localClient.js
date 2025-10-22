// Local API Client - Replaces Base44 SDK
// This client connects to the local API server instead of Base44

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
  const url = `${API_BASE_URL}${endpoint}`;
  console.log('[apiRequest] Making request to:', url);
  console.log('[apiRequest] Options:', options);
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    console.log('[apiRequest] Fetch config:', config);
    const response = await fetch(url, config);
    console.log('[apiRequest] Response status:', response.status, response.statusText);
    
    // Check if response is HTML (likely an error page)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      const htmlText = await response.text();
      console.error('[localClient] Received HTML response instead of JSON:', htmlText.substring(0, 200) + '...');
      throw new LocalAPIError('Server returned HTML instead of JSON - check if proxy server is running', response.status, htmlText);
    }
    
    const data = await response.json();
    console.log('[apiRequest] Response data:', data);

    if (!response.ok) {
      console.error('[apiRequest] Request failed with status:', response.status);
      throw new LocalAPIError(data.error || 'API request failed', response.status, data);
    }

    console.log('[apiRequest] Request successful, returning data');
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
    
    const response = await apiRequest(`/${this.name}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async update(id, data) {
    const response = await apiRequest(`/${this.name}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async delete(id) {
    const response = await apiRequest(`/${this.name}/${id}`, {
      method: 'DELETE',
    });
    return response.data;
  }

  async bulkDelete(ids) {
    const response = await apiRequest(`/${this.name}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
    return response.data;
  }

  async getById(id) {
    const response = await apiRequest(`/${this.name}/${id}`);
    return response.data;
  }

  async list(orderBy = '-created_date', limit = 100) {
    // For local development, use proxy server for backtestCombinations
    if (this.name === 'backtestCombinations') {
      const response = await apiRequest(`/${this.name}?${new URLSearchParams({ orderBy, limit })}`);
      return response.data;
    }
    
    const params = new URLSearchParams({ orderBy, limit });
    const response = await apiRequest(`/${this.name}?${params}`);
    return response.data;
  }

  async filter(conditions = {}, orderBy = '-created_date', limit = 100) {
    const params = new URLSearchParams({ ...conditions, orderBy, limit });
    const response = await apiRequest(`/${this.name}?${params}`);
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
export const ScanSettings = new Entity('scanSettings');
export const HistoricalPerformance = new Entity('historicalPerformance');
export const BacktestCombination = new Entity('backtestCombinations');
export const MarketAlert = new Entity('marketAlerts');
export const ScannerSession = new Entity('scannerSessions');
export const ScannerStats = new Entity('scannerStats');
export const LiveWalletState = new Entity('liveWalletStates');
export const LivePosition = new Entity('livePositions');
export const WalletSummary = new Entity('walletSummaries');
export const TradingSignal = new Entity('tradingSignals');
export const SignalPerformance = new Entity('signalPerformance');
export const OptedOutCombination = new Entity('optedOutCombinations');

// Function calls that mimic Base44 functions
export const functions = {
  async updatePerformanceSnapshot(data) {
    const response = await apiRequest('/updatePerformanceSnapshot', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
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
      const results = {};
      
      for (const symbol of symbols) {
        try {
          // Call the local proxy server to get kline data
          const response = await fetch(`http://localhost:3003/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ''}`);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const klineData = await response.json();
          
          if (klineData.success && klineData.data) {
            results[symbol] = {
              success: true,
              data: klineData.data
            };
          } else {
            results[symbol] = {
              success: false,
              error: klineData.error || 'Failed to fetch kline data'
            };
          }
        } catch (error) {
          results[symbol] = {
            success: false,
            error: error.message
          };
        }
      }
      
      return {
        success: true,
        data: results
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  async getBinancePrices(params) {
    // Handle both object and array parameters
    const symbols = Array.isArray(params) ? params : (params.symbols || []);
    
    if (symbols.length === 0) {
      return [];
    }
    
    // Filter out symbols that are known to be unavailable on testnet
    const unavailableSymbols = new Set([
      'DAIUSDT', 'MXNUSDT', 'COPUSDT', 'CZKUSDT', 'ARSUSDT', 'BRLUSDT', 
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
      // Make actual calls to Binance API via the proxy server
      const proxyUrl = 'http://localhost:3003';
      const promises = availableSymbols.map(async (symbol) => {
        try {
          // FIX: Use ticker/24hr endpoint to get both price and 24h change
          const response = await fetch(`${proxyUrl}/api/binance/ticker/24hr?symbol=${symbol}`);
          
          if (!response.ok) {
            console.warn(`[getBinancePrices] HTTP ${response.status} for ${symbol}, skipping`);
            return null; // Return null for failed requests
          }
          
          const data = await response.json();
          
          if (data.success && data.data && data.data.lastPrice) {
            return {
              symbol: symbol,
              price: data.data.lastPrice,
              change: parseFloat(data.data.priceChangePercent) || 0, // 24h change percentage
              timestamp: Date.now()
            };
          } else {
            console.warn(`[getBinancePrices] Invalid response for ${symbol}:`, data);
            return null; // Return null for invalid responses
          }
        } catch (error) {
          console.warn(`[getBinancePrices] Failed to fetch price for ${symbol}:`, error.message);
          return null; // Return null for errors
        }
      });
      
      const results = await Promise.all(promises);
      // Filter out null results (failed requests)
      return results.filter(result => result !== null);
    } catch (error) {
      console.error('[getBinancePrices] Error fetching prices:', error);
      return [];
    }
  },

  async getExchangeInfo(symbol) {
    // This would typically call Binance API
    // For now, return mock data
    return {
      success: true,
      data: {
        symbols: [{
          symbol: symbol || 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT'
        }]
      }
    };
  },

  async getFearAndGreedIndex() {
    console.log('[getFearAndGreedIndex] 🚀 FUNCTION CALLED - Starting Fear & Greed Index fetch...');
    try {
      console.log('[getFearAndGreedIndex] Starting Fear & Greed Index fetch via direct proxy call...');
      
      // Call proxy server directly with simple fetch (bypass API queue)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
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
      
      console.log('[getFearAndGreedIndex] Direct proxy response received:', proxyResponse);
      
      if (proxyResponse.success && proxyResponse.data) {
        console.log('[getFearAndGreedIndex] Successfully fetched via direct proxy call');
        return proxyResponse;
      } else {
        throw new Error('Proxy server returned invalid response');
      }
    } catch (error) {
      console.error('[getFearAndGreedIndex] Error fetching Fear & Greed Index via proxy:', error);
      
      // Try direct API call as fallback (may fail due to CORS)
      try {
        console.log('[getFearAndGreedIndex] Attempting direct API call as fallback...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch('https://api.alternative.me/fng/', {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('[getFearAndGreedIndex] Direct API response status:', response.status, response.statusText);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[getFearAndGreedIndex] Direct API data:', data);
        
        if (data && data.data && data.data.length > 0) {
          const fngData = data.data[0];
          console.log('[getFearAndGreedIndex] Direct API data extracted:', fngData);
          
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
      } catch (directError) {
        console.error('[getFearAndGreedIndex] Direct API call also failed:', directError);
        
        // Check error type
        if (directError.name === 'AbortError') {
          console.error('[getFearAndGreedIndex] Direct API request timed out');
        } else if (directError.message.includes('CORS') || directError.message.includes('cross-origin')) {
          console.error('[getFearAndGreedIndex] CORS error - direct API blocked by browser');
        } else if (directError.message.includes('fetch')) {
          console.error('[getFearAndGreedIndex] Network error - check internet connection');
        }
      }
      
      // Return fallback data on error
      console.log('[getFearAndGreedIndex] Using static fallback data');
      return {
        success: true,
        data: {
          data: [{
            value: '50',
            value_classification: 'Neutral (Fallback)',
            timestamp: Math.floor(Date.now() / 1000).toString(),
            time_until_update: '0'
          }]
        }
      };
    }
  },

  async liveTradingAPI(params) {
    // Make actual HTTP calls to BinanceLocal proxy server
    const { action, tradingMode, proxyUrl, ...otherParams } = params;
    
    console.log(`[liveTradingAPI] Called with params:`, { action, tradingMode, proxyUrl });
    
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
    // Real performance snapshot update via local API
    const response = await apiRequest('/updatePerformanceSnapshot', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return response;
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
    console.log(`[scannerSessionManager] called with:`, params);
    
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
    
    console.log(`[testBinanceKeys] Testing ${mode} keys with proxy: ${proxyUrl}`);
    
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
      console.error(`[testBinanceKeys] Error testing ${mode} keys:`, error.message);
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
    LiveWalletState,
    LivePosition,
    WalletSummary,
    TradingSignal,
    SignalPerformance,
    OptedOutCombination
  },
  functions,
  auth
};

export default localClient;
