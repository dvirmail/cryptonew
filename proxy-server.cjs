#!/usr/bin/env node

// Binance Proxy Server for CryptoSentinel
// This server proxies Binance API calls to avoid CORS issues

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3003;

// File storage helper functions
const STORAGE_DIR = path.join(__dirname, 'storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function getStoredData(key) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error(`[PROXY] Error reading ${key}:`, error);
    return [];
  }
}

function saveStoredData(key, data) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`[PROXY] Error saving ${key}:`, error);
    throw error;
  }
}

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Binance API base URL
const BINANCE_BASE_URL = 'https://api.binance.com';
const BINANCE_TESTNET_URL = 'https://testnet.binance.vision';

// Helper function to get Binance URL based on trading mode
function getBinanceUrl(tradingMode = 'mainnet') {
  return tradingMode === 'testnet' ? BINANCE_TESTNET_URL : BINANCE_BASE_URL;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Trading endpoint for account info
app.post('/trading', async (req, res) => {
  try {
    const { action, tradingMode } = req.body;
    
    if (action === 'getAccountInfo') {
      // Use the same logic as GET /api/binance/account
      const mode = tradingMode || 'testnet';
      
      // Use actual Binance testnet API keys
      const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
      const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
      
      if (mode === 'testnet') {
        console.log('[Trading] Using testnet API keys for real Binance connection');
        
        // Make real call to Binance testnet
        const binanceUrl = 'https://testnet.binance.vision';
        const timestamp = Date.now();
        
        // Create signature for authentication
        const crypto = require('crypto');
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
        
        const accountUrl = `${binanceUrl}/api/v3/account?${queryString}&signature=${signature}`;
        
        console.log('[Trading] Making request to:', accountUrl);
        
        const response = await fetch(accountUrl, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': testnetApiKey,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Trading] Error response:', response.status, errorText);
          throw new Error(`Binance API error: ${response.status} - ${errorText}`);
        }
        
        const accountData = await response.json();
        console.log('[Trading] ✅ Successfully fetched real account data from Binance testnet');
        console.log('[Trading] Account type:', accountData.accountType);
        console.log('[Trading] Total balances:', accountData.balances?.length || 0);
        
        // Log all assets
        if (accountData.balances && accountData.balances.length > 0) {
          console.log('[Trading] 📊 All assets from Binance testnet:');
          accountData.balances.forEach((balance, index) => {
            const total = parseFloat(balance.free) + parseFloat(balance.locked);
            if (total > 0) { // Only show assets with balance
              console.log(`[Trading] Asset ${index + 1}: ${balance.asset} - Free: ${balance.free}, Locked: ${balance.locked}, Total: ${total.toFixed(8)}`);
            }
          });
        }
        
        res.json({ success: true, data: accountData });
      } else {
        // For mainnet, return mock data
        const mockAccountInfo = {
          success: true,
          data: {
            accountType: 'SPOT',
            balances: [
              {
                asset: 'USDT',
                free: '10000.00000000',
                locked: '0.00000000'
              },
              {
                asset: 'BTC',
                free: '0.10000000',
                locked: '0.00000000'
              }
            ],
            permissions: ['SPOT'],
            canTrade: true,
            canWithdraw: true,
            canDeposit: true,
            updateTime: Date.now()
          }
        };
        
        res.json(mockAccountInfo);
      }
    } else {
      res.status(400).json({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Error processing trading request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance ticker price endpoint
app.get('/api/binance/ticker/price', async (req, res) => {
  try {
    const { symbol } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }

    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/ticker/price?symbol=${symbol}`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching ticker price:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance 24hr ticker endpoint (for price and 24h change)
app.get('/api/binance/ticker/24hr', async (req, res) => {
  try {
    const { symbol } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }

    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/ticker/24hr?symbol=${symbol}`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching 24hr ticker:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance klines endpoint
app.get('/api/binance/klines', async (req, res) => {
  try {
    const { symbol, interval, limit, endTime } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol || !interval) {
      return res.status(400).json({ success: false, error: 'Symbol and interval are required' });
    }

    const binanceUrl = getBinanceUrl(tradingMode);
    let url = `${binanceUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}`;
    
    if (limit) url += `&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching klines:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance exchange info endpoint
app.get('/api/binance/exchangeInfo', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/exchangeInfo`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching exchange info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance account info endpoint (for testing API keys)
app.get('/api/binance/account', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    // Use actual Binance testnet API keys
    const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
    const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
    
    if (tradingMode === 'testnet') {
      console.log('[Binance Account] Using testnet API keys for real Binance connection');
      
      try {
      // Make real call to Binance testnet
      const binanceUrl = 'https://testnet.binance.vision';
      const timestamp = Date.now();
      
      // Create signature for authentication
      const crypto = require('crypto');
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
      
      const accountUrl = `${binanceUrl}/api/v3/account?${queryString}&signature=${signature}`;
      
      console.log('[Binance Account] Making request to:', accountUrl);
      
      const response = await fetch(accountUrl, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Binance Account] Error response:', response.status, errorText);
        throw new Error(`Binance API error: ${response.status} - ${errorText}`);
      }
      
      const accountData = await response.json();
      console.log('[Binance Account] ✅ Successfully fetched real account data from Binance testnet');
      console.log('[Binance Account] Account type:', accountData.accountType);
      console.log('[Binance Account] Total balances:', accountData.balances?.length || 0);
      
      // Log all assets
      if (accountData.balances && accountData.balances.length > 0) {
        console.log('[Binance Account] 📊 All assets from Binance testnet:');
        accountData.balances.forEach((balance, index) => {
          const total = parseFloat(balance.free) + parseFloat(balance.locked);
          if (total > 0) { // Only show assets with balance
            console.log(`[Binance Account] Asset ${index + 1}: ${balance.asset} - Free: ${balance.free}, Locked: ${balance.locked}, Total: ${total.toFixed(8)}`);
          }
        });
      }
      
      res.json({ success: true, data: accountData });
      
    } catch (binanceError) {
      console.warn('[Binance Account] ⚠️ Binance API not accessible, using fallback data:', binanceError.message);
      
      // Fallback: Return mock data when Binance API is not accessible
      const fallbackData = {
        accountType: 'SPOT',
        balances: [
          { asset: 'USDT', free: '1000.00000000', locked: '0.00000000' },
          { asset: 'BTC', free: '0.01000000', locked: '0.00000000' },
          { asset: 'ETH', free: '0.10000000', locked: '0.00000000' }
        ],
        canTrade: true,
        canWithdraw: true,
        canDeposit: true
      };
      
      console.log('[Binance Account] 📊 Using fallback account data (Binance API unavailable)');
      res.json({ 
        success: true, 
        data: fallbackData,
        warning: 'Using fallback data - Binance API not accessible'
      });
    }
    
    } else {
      // For mainnet, return mock data
      const mockAccountInfo = {
        accountType: 'SPOT',
        balances: [
          {
            asset: 'USDT',
            free: '10000.00000000',
            locked: '0.00000000'
          },
          {
            asset: 'BTC',
            free: '0.10000000',
            locked: '0.00000000'
          }
        ],
        permissions: ['SPOT'],
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now()
      };
      
      res.json({ success: true, data: mockAccountInfo });
    }
  } catch (error) {
    console.error('Error fetching account info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance order endpoint (for trading)
app.post('/api/binance/order', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'testnet';
    const binanceUrl = getBinanceUrl(tradingMode);
    
    console.log('[PROXY] 📊 POST /api/binance/order - Request body:', JSON.stringify(req.body, null, 2));
    console.log('[PROXY] 📊 Trading mode:', tradingMode);
    console.log('[PROXY] 📊 Binance URL:', binanceUrl);
    
    // Use actual Binance testnet API keys
    const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
    const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
    
    if (tradingMode === 'testnet') {
      console.log('[PROXY] 🔄 Creating order on Binance testnet...');
      
      // Extract order parameters from request body
      const { symbol, side, type, quantity, price, timeInForce } = req.body;
      
      if (!symbol || !side || !type || !quantity) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required order parameters: symbol, side, type, quantity' 
        });
      }
      
      // Create timestamp
      const timestamp = Date.now();
      
      // Build query string for signature
      const queryParams = new URLSearchParams({
        symbol: symbol,
        side: side,
        type: type,
        quantity: quantity,
        timestamp: timestamp
      });
      
      if (price) queryParams.append('price', price);
      if (timeInForce) queryParams.append('timeInForce', timeInForce);
      
      const queryString = queryParams.toString();
      
      // Create signature
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', testnetApiSecret)
        .update(queryString)
        .digest('hex');
      
      const finalQueryString = `${queryString}&signature=${signature}`;
      const orderUrl = `${binanceUrl}/api/v3/order?${finalQueryString}`;
      
      console.log('[PROXY] 🔄 Order URL:', orderUrl);
      
      // Make the request to Binance
      const options = {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };
      
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(orderUrl);
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'POST',
        headers: options.headers
      };
      
      const binanceRequest = https.request(requestOptions, (binanceResponse) => {
        let data = '';
        
        binanceResponse.on('data', (chunk) => {
          data += chunk;
        });
        
        binanceResponse.on('end', () => {
          console.log('[PROXY] 📊 Binance order response status:', binanceResponse.statusCode);
          console.log('[PROXY] 📊 Binance order response data:', data);
          
          try {
            const responseData = JSON.parse(data);
            
            if (binanceResponse.statusCode === 200) {
              res.json({ 
                success: true, 
                data: responseData,
                message: 'Order created successfully'
              });
            } else {
              res.status(binanceResponse.statusCode).json({ 
                success: false, 
                error: responseData.msg || 'Order creation failed',
                details: responseData
              });
            }
          } catch (parseError) {
            console.error('[PROXY] ❌ Failed to parse Binance response:', parseError);
            res.status(500).json({ 
              success: false, 
              error: 'Failed to parse Binance response',
              rawResponse: data
            });
          }
        });
      });
      
      binanceRequest.on('error', (error) => {
        console.error('[PROXY] ❌ Binance request error:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to connect to Binance',
          details: error.message
        });
      });
      
      binanceRequest.end();
      
    } else {
      // For mainnet, return mock response for now
      res.json({ 
        success: true, 
        message: 'Mainnet trading not implemented in development mode',
        data: {
          symbol: req.body.symbol,
          orderId: Math.floor(Math.random() * 1000000),
          status: 'FILLED'
        }
      });
    }
    
  } catch (error) {
    console.error('[PROXY] ❌ Error processing order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance dust convert endpoint
app.post('/api/binance/dustConvert', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    const binanceUrl = getBinanceUrl(tradingMode);
    
    // This would need proper authentication in a real implementation
    res.json({ success: true, message: 'Dust convert endpoint - authentication required' });
  } catch (error) {
    console.error('Error processing dust convert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// In-memory storage for local development
let scanSettings = [];
let liveWalletStates = [];
let walletSummaries = [];

// Entity endpoints for local development
// Specific entity endpoints that the app expects

app.get('/api/walletSummaries', (req, res) => {
  console.log('[PROXY] 📊 GET /api/walletSummaries - Returning summaries:', JSON.stringify(walletSummaries, null, 2));
  console.log('[PROXY] 📊 GET /api/walletSummaries - Total summaries in memory:', walletSummaries.length);
  res.json({ success: true, data: walletSummaries });
});

app.post('/api/walletSummaries', (req, res) => {
  // For local development, store in memory
  console.log('[PROXY] 📊 POST /api/walletSummaries - Request body:', JSON.stringify(req.body, null, 2));
  const newWalletSummary = {
    id: Math.random().toString(36).substr(2, 9),
    ...req.body,
    created_date: new Date().toISOString()
  };
  walletSummaries.push(newWalletSummary);
  console.log('[PROXY] 📊 POST /api/walletSummaries - Stored summary:', JSON.stringify(newWalletSummary, null, 2));
  console.log('[PROXY] 📊 POST /api/walletSummaries - Total summaries in memory:', walletSummaries.length);
  res.json({ success: true, data: newWalletSummary });
});

app.put('/api/walletSummaries/:id', (req, res) => {
  // For local development, update in memory
  const { id } = req.params;
  console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Request body:', JSON.stringify(req.body, null, 2));
  const index = walletSummaries.findIndex(ws => ws.id === id);
  if (index !== -1) {
    walletSummaries[index] = {
      ...walletSummaries[index],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Updated summary:', JSON.stringify(walletSummaries[index], null, 2));
    res.json({ success: true, data: walletSummaries[index] });
  } else {
    console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Summary not found:', id);
    res.status(404).json({ success: false, error: 'WalletSummary not found' });
  }
});

app.get('/api/optedOutCombinations', (req, res) => {
  res.json({ success: true, data: [] });
});

app.get('/api/liveWalletStates', (req, res) => {
  console.log('[PROXY] 📊 GET /api/liveWalletStates - Returning states:', JSON.stringify(liveWalletStates, null, 2));
  console.log('[PROXY] 📊 GET /api/liveWalletStates - Total states in memory:', liveWalletStates.length);
  res.json({ success: true, data: liveWalletStates });
});

app.post('/api/liveWalletStates', (req, res) => {
  // For local development, store in memory
  console.log('[PROXY] 📊 POST /api/liveWalletStates - Request body:', JSON.stringify(req.body, null, 2));
  const newWalletState = {
    id: Math.random().toString(36).substr(2, 9),
    ...req.body,
    created_date: new Date().toISOString()
  };
  liveWalletStates.push(newWalletState);
  console.log('[PROXY] 📊 POST /api/liveWalletStates - Stored state:', JSON.stringify(newWalletState, null, 2));
  console.log('[PROXY] 📊 POST /api/liveWalletStates - Total states in memory:', liveWalletStates.length);
  res.json({ success: true, data: newWalletState });
});

app.put('/api/liveWalletStates/:id', (req, res) => {
  // For local development, update in memory
  const { id } = req.params;
  const index = liveWalletStates.findIndex(ws => ws.id === id);
  if (index !== -1) {
    liveWalletStates[index] = {
      ...liveWalletStates[index],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    res.json({ success: true, data: liveWalletStates[index] });
  } else {
    res.status(404).json({ success: false, error: 'Wallet state not found' });
  }
});

app.delete('/api/liveWalletStates/:id', (req, res) => {
  // For local development, delete from memory
  const { id } = req.params;
  const index = liveWalletStates.findIndex(ws => ws.id === id);
  if (index !== -1) {
    const deletedState = liveWalletStates.splice(index, 1)[0];
    console.log('[PROXY] 📊 DELETE /api/liveWalletStates/:id - Deleted state:', JSON.stringify(deletedState, null, 2));
    console.log('[PROXY] 📊 DELETE /api/liveWalletStates/:id - Remaining states:', liveWalletStates.length);
    res.json({ success: true, data: { id, deleted: true } });
  } else {
    console.log('[PROXY] 📊 DELETE /api/liveWalletStates/:id - State not found:', id);
    res.status(404).json({ success: false, error: 'Wallet state not found' });
  }
});

app.get('/api/historicalPerformance', (req, res) => {
  res.json({ success: true, data: [] });
});

app.get('/api/trades', (req, res) => {
  res.json({ success: true, data: [] });
});

// POST /api/trades - Create new trade records
app.post('/api/trades', (req, res) => {
  try {
    console.log('[PROXY] 📝 Creating trade record:', req.body);
    
    // For local development, just return success
    // In production, this would save to database
    res.json({ 
      success: true, 
      data: {
        id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...req.body,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error creating trade:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fear & Greed Index endpoint
app.get('/api/fearAndGreed', async (req, res) => {
  try {
    console.log('[PROXY] 📊 GET /api/fearAndGreed - Fetching Fear & Greed Index...');
    
    // Try to fetch from the real API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch('https://api.alternative.me/fng/', {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CryptoSentinel/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[PROXY] 📊 GET /api/fearAndGreed - Successfully fetched from API');
      
      res.json({
        success: true,
        data: data
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.warn('[PROXY] 📊 GET /api/fearAndGreed - API fetch failed, using fallback:', fetchError.message);
      
      // Return fallback data
      res.json({
        success: true,
        data: {
          name: 'Fear and Greed Index',
          data: [{
            value: '50',
            value_classification: 'Neutral',
            timestamp: Math.floor(Date.now() / 1000).toString(),
            time_until_update: '3600'
          }],
          metadata: {
            error: 'Using fallback data due to API unavailability'
          }
        }
      });
    }
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching Fear & Greed Index:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store LivePosition entities in persistent file storage
let livePositions = [];

// Load existing positions from file storage on startup
try {
  livePositions = getStoredData('livePositions');
  console.log(`[PROXY] 📊 Loaded ${livePositions.length} existing positions from storage`);
} catch (error) {
  console.error('[PROXY] Error loading positions from storage:', error);
  livePositions = [];
}

// Store ScanSettings entities in persistent file storage

// Load existing scan settings from file storage on startup
try {
  scanSettings = getStoredData('scanSettings');
  console.log(`[PROXY] 📊 Loaded ${scanSettings.length} existing scan settings from storage`);
} catch (error) {
  console.error('[PROXY] Error loading scan settings from storage:', error);
  scanSettings = [];
}

app.get('/api/livePositions', (req, res) => {
  console.log('[PROXY] 📊 GET /api/livePositions - Returning positions:', livePositions.length);
  res.json({ success: true, data: livePositions });
});

app.post('/api/livePositions', (req, res) => {
  console.log('[PROXY] 📊 POST /api/livePositions - Creating new live position');
  const newPosition = {
    id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  // Store in memory
  livePositions.push(newPosition);
  
  // Save to persistent storage
  try {
    saveStoredData('livePositions', livePositions);
    console.log('[PROXY] 📊 Saved positions to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving positions to storage:', error);
  }
  
  console.log('[PROXY] 📊 Created live position with ID:', newPosition.id);
  console.log('[PROXY] 📊 Total positions in memory:', livePositions.length);
  res.json({ success: true, data: newPosition });
});

// Add support for filtering LivePosition entities
app.get('/api/livePositions/filter', (req, res) => {
  const { wallet_id, trading_mode, status } = req.query;
  
  console.log('[PROXY] 📊 GET /api/livePositions/filter - Filters:', { wallet_id, trading_mode, status });
  
  let filteredPositions = [...livePositions];
  
  // Apply filters
  if (wallet_id) {
    filteredPositions = filteredPositions.filter(pos => pos.wallet_id === wallet_id);
  }
  
  if (trading_mode) {
    filteredPositions = filteredPositions.filter(pos => pos.trading_mode === trading_mode);
  }
  
  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    filteredPositions = filteredPositions.filter(pos => statusArray.includes(pos.status));
  }
  
  console.log('[PROXY] 📊 Filtered positions:', filteredPositions.length);
  res.json({ success: true, data: filteredPositions });
});

// Add support for updating LivePosition entities
app.put('/api/livePositions/:id', (req, res) => {
  const positionId = req.params.id;
  const updateData = req.body;
  
  console.log('[PROXY] 📊 PUT /api/livePositions/' + positionId + ' - Updating position');
  
  const positionIndex = livePositions.findIndex(pos => pos.id === positionId);
  
  if (positionIndex === -1) {
    return res.status(404).json({ success: false, error: 'Position not found' });
  }
  
  // Update the position
  livePositions[positionIndex] = {
    ...livePositions[positionIndex],
    ...updateData,
    updated_date: new Date().toISOString()
  };
  
  // Save to persistent storage
  try {
    saveStoredData('livePositions', livePositions);
    console.log('[PROXY] 📊 Saved updated positions to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving updated positions to storage:', error);
  }
  
  console.log('[PROXY] 📊 Updated position:', positionId);
  res.json({ success: true, data: livePositions[positionIndex] });
});

// Add support for deleting LivePosition entities
app.delete('/api/livePositions/:id', (req, res) => {
  const positionId = req.params.id;
  
  console.log('[PROXY] 📊 DELETE /api/livePositions/' + positionId + ' - Deleting position');
  
  const positionIndex = livePositions.findIndex(pos => pos.id === positionId);
  
  if (positionIndex === -1) {
    return res.status(404).json({ success: false, error: 'Position not found' });
  }
  
  const deletedPosition = livePositions.splice(positionIndex, 1)[0];
  
  // Save to persistent storage
  try {
    saveStoredData('livePositions', livePositions);
    console.log('[PROXY] 📊 Saved positions after deletion to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving positions after deletion to storage:', error);
  }
  
  console.log('[PROXY] 📊 Deleted position:', positionId);
  console.log('[PROXY] 📊 Remaining positions:', livePositions.length);
  res.json({ success: true, data: deletedPosition });
});

// ScanSettings endpoints
app.get('/api/scanSettings', (req, res) => {
  console.log('[PROXY] 📊 GET /api/scanSettings - Returning settings:', scanSettings.length);
  res.json({ success: true, data: scanSettings });
});

app.post('/api/scanSettings', (req, res) => {
  console.log('[PROXY] 📊 POST /api/scanSettings - Creating new scan settings');
  const newSettings = {
    id: `settings_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  scanSettings.push(newSettings);
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved new scan settings to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving scan settings to storage:', error);
  }
  
  console.log('[PROXY] 📊 Created scan settings with ID:', newSettings.id);
  res.json({ success: true, data: newSettings });
});

app.put('/api/scanSettings/:id', (req, res) => {
  const settingsId = req.params.id;
  console.log('[PROXY] 📊 PUT /api/scanSettings/' + settingsId + ' - Updating scan settings');
  
  const settingsIndex = scanSettings.findIndex(settings => settings.id === settingsId);
  
  if (settingsIndex === -1) {
    return res.status(404).json({ success: false, error: 'Scan settings not found' });
  }
  
  scanSettings[settingsIndex] = {
    ...scanSettings[settingsIndex],
    ...req.body,
    updated_date: new Date().toISOString()
  };
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved updated scan settings to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving updated scan settings to storage:', error);
  }
  
  console.log('[PROXY] 📊 Updated scan settings:', settingsId);
  res.json({ success: true, data: scanSettings[settingsIndex] });
});

app.delete('/api/scanSettings/:id', (req, res) => {
  const settingsId = req.params.id;
  console.log('[PROXY] 📊 DELETE /api/scanSettings/' + settingsId + ' - Deleting scan settings');
  
  const settingsIndex = scanSettings.findIndex(settings => settings.id === settingsId);
  
  if (settingsIndex === -1) {
    return res.status(404).json({ success: false, error: 'Scan settings not found' });
  }
  
  const deletedSettings = scanSettings.splice(settingsIndex, 1)[0];
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved scan settings after deletion to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving scan settings after deletion to storage:', error);
  }
  
  console.log('[PROXY] 📊 Deleted scan settings:', settingsId);
  res.json({ success: true, data: deletedSettings });
});

// Generic entity operations
app.get('/api/entities/:entityName', (req, res) => {
  const entityName = req.params.entityName;
  
  // Handle LivePosition entities
  if (entityName === 'LivePosition') {
    console.log('[PROXY] 📊 GET /api/entities/LivePosition - Returning positions:', livePositions.length);
    res.json({ success: true, data: livePositions });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 GET /api/entities/ScanSettings - Returning settings:', scanSettings.length);
    res.json({ success: true, data: scanSettings });
    return;
  }
  
  // For local development, return empty arrays for entity lists
  if (entityName === 'OptedOutCombination') {
    res.json({ success: true, data: [] });
  } else {
    res.json({ success: true, data: [] });
  }
});

// Handle entity filtering (used by WalletProvider)
app.post('/api/entities/:entityName/filter', (req, res) => {
  const entityName = req.params.entityName;
  
  // Handle LivePosition filtering
  if (entityName === 'LivePosition') {
    const { wallet_id, trading_mode, status } = req.body;
    
    console.log('[PROXY] 📊 POST /api/entities/LivePosition/filter - Filters:', { wallet_id, trading_mode, status });
    
    let filteredPositions = [...livePositions];
    
    // Apply filters
    if (wallet_id) {
      filteredPositions = filteredPositions.filter(pos => pos.wallet_id === wallet_id);
    }
    
    if (trading_mode) {
      filteredPositions = filteredPositions.filter(pos => pos.trading_mode === trading_mode);
    }
    
    if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      filteredPositions = filteredPositions.filter(pos => statusArray.includes(pos.status));
    }
    
    console.log('[PROXY] 📊 Filtered positions:', filteredPositions.length);
    res.json({ success: true, data: filteredPositions });
    return;
  }
  
  // For other entities, return empty array
  res.json({ success: true, data: [] });
});

app.post('/api/entities/:entityName', (req, res) => {
  const entityName = req.params.entityName;
  
  // Handle LivePosition entities
  if (entityName === 'LivePosition') {
    console.log('[PROXY] 📊 POST /api/entities/LivePosition - Creating position');
    const newPosition = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    livePositions.push(newPosition);
    
    // Save to persistent storage
    try {
      saveStoredData('livePositions', livePositions);
      console.log('[PROXY] 📊 Saved new position to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new position to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created position with ID:', newPosition.id);
    console.log('[PROXY] 📊 Total positions:', livePositions.length);
    res.json({ success: true, data: newPosition });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 POST /api/entities/ScanSettings - Creating scan settings');
    const newSettings = {
      id: `settings_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    scanSettings.push(newSettings);
    
    // Save to persistent storage
    try {
      saveStoredData('scanSettings', scanSettings);
      console.log('[PROXY] 📊 Saved new scan settings to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new scan settings to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created scan settings with ID:', newSettings.id);
    console.log('[PROXY] 📊 Total scan settings:', scanSettings.length);
    res.json({ success: true, data: newSettings });
    return;
  }
  
  // For local development, simulate successful creation
  const mockId = Math.random().toString(36).substr(2, 9);
  res.json({ success: true, data: { id: mockId, ...req.body } });
});

app.put('/api/entities/:entityName/:id', (req, res) => {
  const entityName = req.params.entityName;
  const id = req.params.id;
  
  // Handle LivePosition entities
  if (entityName === 'LivePosition') {
    console.log('[PROXY] 📊 PUT /api/entities/LivePosition/' + id + ' - Updating position');
    const positionIndex = livePositions.findIndex(pos => pos.id === id);
    
    if (positionIndex === -1) {
      return res.status(404).json({ success: false, error: 'Position not found' });
    }
    
    livePositions[positionIndex] = {
      ...livePositions[positionIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Save to persistent storage
    try {
      saveStoredData('livePositions', livePositions);
      console.log('[PROXY] 📊 Saved updated position to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated position to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated position:', id);
    res.json({ success: true, data: livePositions[positionIndex] });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 PUT /api/entities/ScanSettings/' + id + ' - Updating scan settings');
    const settingsIndex = scanSettings.findIndex(settings => settings.id === id);
    
    if (settingsIndex === -1) {
      return res.status(404).json({ success: false, error: 'Scan settings not found' });
    }
    
    scanSettings[settingsIndex] = {
      ...scanSettings[settingsIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Save to persistent storage
    try {
      saveStoredData('scanSettings', scanSettings);
      console.log('[PROXY] 📊 Saved updated scan settings to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated scan settings to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated scan settings:', id);
    res.json({ success: true, data: scanSettings[settingsIndex] });
    return;
  }
  
  // For local development, simulate successful update
  res.json({ success: true, data: { id, ...req.body } });
});

// Specific endpoint for backtestCombinations DELETE
app.delete('/api/backtestCombinations/:id', (req, res) => {
  const id = req.params.id;
  console.log('[PROXY] 📊 DELETE /api/backtestCombinations/:id - Deleting combination:', id);
  
  try {
    // Get existing combinations from file storage
    const existingData = getStoredData('backtestCombinations');
    console.log(`[PROXY] 📊 Found ${existingData.length} existing combinations`);
    
    // Filter out the combination to be deleted
    const remainingData = existingData.filter(combination => combination.id !== id);
    console.log(`[PROXY] 📊 After deletion: ${remainingData.length} combinations remaining`);
    
    // Save the updated data back to file storage
    saveStoredData('backtestCombinations', remainingData);
    
    const deletedCount = existingData.length - remainingData.length;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} combination with ID: ${id}`);
    
    res.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error('[PROXY] 📊 Error during deletion:', error);
    res.status(500).json({ success: false, error: 'Failed to delete combination' });
  }
});

// GET endpoint for backtestCombinations
app.get('/api/backtestCombinations', (req, res) => {
  console.log('[PROXY] 📊 GET /api/backtestCombinations - Fetching combinations');
  
  try {
    const existingData = getStoredData('backtestCombinations');
    console.log(`[PROXY] 📊 Found ${existingData.length} combinations in storage`);
    
    // Sort by created_date (newest first) if no specific orderBy is provided
    const orderBy = req.query.orderBy || '-created_date';
    if (orderBy === '-created_date') {
      existingData.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
    }
    
    // Apply limit if provided
    const limit = parseInt(req.query.limit) || 100;
    const limitedData = existingData.slice(0, limit);
    
    console.log(`[PROXY] 📊 Returning ${limitedData.length} combinations`);
    res.json({ success: true, data: limitedData });
  } catch (error) {
    console.error('[PROXY] 📊 Error getting combinations:', error);
    res.status(500).json({ success: false, error: 'Failed to get combinations' });
  }
});

// POST endpoint for backtestCombinations
app.post('/api/backtestCombinations', (req, res) => {
  const data = req.body;
  console.log('[PROXY] 📊 POST /api/backtestCombinations - Creating combination:', data.combinationName);
  
  try {
    const existingData = getStoredData('backtestCombinations');
    const newItem = {
      id: Date.now().toString(),
      ...data,
      created_date: new Date().toISOString()
    };
    
    existingData.push(newItem);
    saveStoredData('backtestCombinations', existingData);
    
    console.log(`[PROXY] 📊 Created combination: ${newItem.combinationName} with ID: ${newItem.id}`);
    res.json({ success: true, data: newItem });
  } catch (error) {
    console.error('[PROXY] 📊 Error creating combination:', error);
    res.status(500).json({ success: false, error: 'Failed to create combination' });
  }
});

// Bulk delete endpoint for backtestCombinations
app.delete('/api/backtestCombinations', (req, res) => {
  const { ids } = req.body;
  console.log('[PROXY] 📊 DELETE /api/backtestCombinations (bulk) - Deleting combinations:', ids);
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'IDs array is required' });
  }
  
  try {
    // Get existing combinations from file storage
    const existingData = getStoredData('backtestCombinations');
    console.log(`[PROXY] 📊 Found ${existingData.length} existing combinations`);
    
    // Filter out the combinations to be deleted
    const remainingData = existingData.filter(combination => !ids.includes(combination.id));
    console.log(`[PROXY] 📊 After deletion: ${remainingData.length} combinations remaining`);
    
    // Save the updated data back to file storage
    saveStoredData('backtestCombinations', remainingData);
    
    const deletedCount = existingData.length - remainingData.length;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} combinations`);
    
    const deletedIds = ids.map(id => ({ id, deleted: true }));
    res.json({ success: true, data: { deleted: deletedIds, count: deletedCount } });
  } catch (error) {
    console.error('[PROXY] 📊 Error during bulk deletion:', error);
    res.status(500).json({ success: false, error: 'Failed to delete combinations' });
  }
});

app.delete('/api/entities/:entityName/:id', (req, res) => {
  const entityName = req.params.entityName;
  const id = req.params.id;
  
  // For local development, simulate successful deletion
  res.json({ success: true, data: { id, deleted: true } });
});

// Scanner Stats endpoints
app.get('/api/scannerStats', (req, res) => {
  const { mode, orderBy, limit } = req.query;
  console.log(`[PROXY] 📊 GET /api/scannerStats - mode: ${mode}, orderBy: ${orderBy}, limit: ${limit}`);
  
  // Return empty array for now - scanner stats will be stored here
  const stats = getStoredData('scannerStats');
  const filteredStats = stats.filter(stat => !mode || stat.mode === mode);
  
  console.log(`[PROXY] 📊 Returning ${filteredStats.length} scanner stats`);
  res.json(filteredStats);
});

app.post('/api/scannerStats', (req, res) => {
  const statsData = req.body;
  console.log(`[PROXY] 📊 POST /api/scannerStats - Creating new scanner stat`);
  
  // Generate ID and timestamp
  const newStat = {
    id: Date.now().toString(),
    ...statsData,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  // Get existing stats and add new one
  const existingStats = getStoredData('scannerStats');
  const updatedStats = [...existingStats, newStat];
  saveStoredData('scannerStats', updatedStats);
  
  console.log(`[PROXY] 📊 Created scanner stat with ID: ${newStat.id}`);
  res.json(newStat);
});

app.put('/api/scannerStats/:id', (req, res) => {
  const id = req.params.id;
  const updateData = req.body;
  console.log(`[PROXY] 📊 PUT /api/scannerStats/${id} - Updating scanner stat`);
  
  // Get existing stats
  const existingStats = getStoredData('scannerStats');
  const statIndex = existingStats.findIndex(stat => stat.id === id);
  
  if (statIndex === -1) {
    return res.status(404).json({ error: 'Scanner stat not found' });
  }
  
  // Update the stat
  const updatedStat = {
    ...existingStats[statIndex],
    ...updateData,
    updated_date: new Date().toISOString()
  };
  
  existingStats[statIndex] = updatedStat;
  saveStoredData('scannerStats', existingStats);
  
  console.log(`[PROXY] 📊 Updated scanner stat with ID: ${id}`);
  res.json(updatedStat);
});

// Missing API endpoints that the frontend expects
app.post('/api/updatePerformanceSnapshot', (req, res) => {
  console.log('[PROXY] 📊 POST /api/updatePerformanceSnapshot - Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // For local development, just return success
    res.json({ 
      success: true, 
      message: 'Performance snapshot updated successfully',
      data: { 
        timestamp: new Date().toISOString(),
        ...req.body 
      }
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error updating performance snapshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Archive trades endpoint
app.post('/api/archiveTrades', (req, res) => {
  console.log('[PROXY] 📊 POST /api/archiveTrades - Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // For local development, just return success
    res.json({ 
      success: true, 
      message: 'Trades archived successfully',
      data: { 
        timestamp: new Date().toISOString(),
        archivedCount: req.body.tradeIds?.length || 0
      }
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error archiving trades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scanner configuration endpoint
app.get('/api/scannerConfig', (req, res) => {
  console.log('[PROXY] 📊 GET /api/scannerConfig - Fetching scanner configuration');
  
  try {
    // Return the stored scan settings as scanner config
    const config = scanSettings.length > 0 ? scanSettings[0] : {
      id: 'default',
      local_proxy_url: 'http://localhost:3003',
      trading_mode: 'testnet',
      created_date: new Date().toISOString()
    };
    
    console.log('[PROXY] 📊 Returning scanner config:', JSON.stringify(config, null, 2));
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching scanner config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scannerConfig', (req, res) => {
  console.log('[PROXY] 📊 POST /api/scannerConfig - Saving scanner configuration');
  console.log('[PROXY] 📊 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // Update scan settings with the new configuration
    const configData = {
      id: 'default',
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Replace existing settings
    scanSettings = [configData];
    
    console.log('[PROXY] 📊 Scanner configuration saved:', JSON.stringify(configData, null, 2));
    res.json({ success: true, data: configData });
  } catch (error) {
    console.error('[PROXY] ❌ Error saving scanner config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Market Alerts endpoints
app.get('/api/marketAlerts', (req, res) => {
  const { orderBy, limit } = req.query;
  console.log(`[PROXY] 📊 GET /api/marketAlerts - orderBy: ${orderBy}, limit: ${limit}`);
  
  try {
    // Return empty array for now - market alerts will be stored here
    const alerts = getStoredData('marketAlerts');
    
    // Apply ordering if specified
    if (orderBy === '-created_date') {
      alerts.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
    }
    
    // Apply limit if specified
    const limitedAlerts = limit ? alerts.slice(0, parseInt(limit)) : alerts;
    
    console.log(`[PROXY] 📊 Returning ${limitedAlerts.length} market alerts`);
    res.json({ success: true, data: limitedAlerts });
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching market alerts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/marketAlerts', (req, res) => {
  const alertData = req.body;
  console.log(`[PROXY] 📊 POST /api/marketAlerts - Creating new market alert`);
  
  try {
    // Generate ID and timestamp
    const newAlert = {
      id: Date.now().toString(),
      ...alertData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    // Get existing alerts and add new one
    const existingAlerts = getStoredData('marketAlerts');
    const updatedAlerts = [...existingAlerts, newAlert];
    saveStoredData('marketAlerts', updatedAlerts);
    
    console.log(`[PROXY] 📊 Created market alert with ID: ${newAlert.id}`);
    res.json({ success: true, data: newAlert });
  } catch (error) {
    console.error('[PROXY] ❌ Error creating market alert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Binance Proxy Server running on port ${PORT}`);
  console.log(`   Mainnet: https://api.binance.com`);
  console.log(`   Testnet: https://testnet.binance.vision`);
  console.log(`   CORS enabled for localhost:5174`);
});
