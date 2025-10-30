import { queueFunctionCall } from '@/components/utils/apiQueue';
import { getKlineData } from '@/api/functions';

// Helper function to convert timeframe to milliseconds
const getTimeframeMs = (timeframe) => {
  const timeframeMap = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000
  };
  return timeframeMap[timeframe] || 15 * 60 * 1000; // Default to 15m
};

// Global map for period durations in days
const periodMap = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "12m": 365,
  "30m": 913,
};

const timeframeToMinutes = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

const calculateRequiredCandles = (period, timeframe) => {
  const days = periodMap[period] || 30;
  const minutesInTimeframe = timeframeToMinutes[timeframe] || 60;
  const candlesPerDay = 1440 / minutesInTimeframe;
  return Math.ceil(days * candlesPerDay * 1.05);
};

/**
 * NEW: Fetch K-line data for multiple coins in a single backend call
 * This dramatically reduces network overhead by batching symbols together
 */
export const fetchDataForCoins = async ({
  coinsToFetch, // Array of coin symbols
  currentPeriod,
  currentTimeframe,
  dataLoadingProgressSetter,
  onLog
}) => {
  if (!Array.isArray(coinsToFetch) || coinsToFetch.length === 0) {
    return {};
  }

  const batchSize = coinsToFetch.length;
  if (onLog) onLog(`[KLINE_BATCH] Fetching data for ${batchSize} symbols using optimized parallel processing...`, 'info');

  const requiredCandles = calculateRequiredCandles(currentPeriod, currentTimeframe);
  if (onLog) onLog(`[KLINE_BATCH] Required candles: ~${requiredCandles.toLocaleString()} per symbol`, 'info');

  try {
    const MAX_PER_REQUEST = 1000; // Binance's limit
    const results = {};
    
    // Initialize results for all coins
    for (const coin of coinsToFetch) {
      results[coin] = {
        success: false,
        data: [],
        error: null
      };
    }
    
    // Calculate how many requests we need for each coin
    const requestsNeeded = Math.ceil(requiredCandles / MAX_PER_REQUEST);
    
    if (onLog) onLog(`[KLINE_BATCH] Need ${requestsNeeded} requests per coin to get ${requiredCandles.toLocaleString()} candles`, 'info');
    
    // MAJOR OPTIMIZATION: Use batch endpoint for multiple symbols when possible
    // Instead of individual requests per symbol, batch multiple symbols together
    if (coinsToFetch.length > 1) {
      if (onLog) onLog(`[KLINE_BATCH] 🚀 Using batch endpoint for ${coinsToFetch.length} symbols`, 'info');
      
      // Create batch request for all symbols
      const batchParams = {
        symbols: coinsToFetch.map(coin => coin.replace('/', '')),
        interval: currentTimeframe,
        limit: Math.min(requiredCandles, MAX_PER_REQUEST),
        source: 'backtesting_fetcher_batch_optimized',
      };
      
      try {
        // NEW: Direct call to bypass API queue for better batching
        const batchResponse = await getKlineData(batchParams);
        
        if (batchResponse?.success && batchResponse?.data) {
          // Process batch results
          coinsToFetch.forEach(coin => {
            const symbolKey = coin.replace('/', '');
            const coinResult = batchResponse.data[symbolKey];
            
            if (coinResult && coinResult.success && coinResult.data) {
              results[coin] = {
                success: true,
                data: coinResult.data,
                error: null
              };
            } else {
              results[coin] = {
                success: false,
                data: [],
                error: coinResult?.error || 'Failed to fetch batch data'
              };
            }
          });
          
          if (onLog) onLog(`[KLINE_BATCH] ✅ Batch request completed for ${coinsToFetch.length} symbols`, 'success');
          
          // Format and return results
          const finalResults = {};
          for (const coin of coinsToFetch) {
            if (results[coin].success && results[coin].data.length > 0) {
              const formattedData = results[coin].data.map(k => ({
                time: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                closeTime: k[6],
                quoteAssetVolume: parseFloat(k[7]),
                trades: k[8],
                takerBuyBaseAssetVolume: parseFloat(k[9]),
                takerBuyQuoteAssetVolume: parseFloat(k[10]),
                ignore: k[11],
                coin: coin
              }));
              
              formattedData.sort((a, b) => a.time - b.time);
              finalResults[coin] = formattedData;
            } else {
              finalResults[coin] = [];
            }
          }
          
          if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);
          if (onLog) onLog(`[KLINE_BATCH] ✅ Batch processing completed for ${coinsToFetch.length} symbols`, 'success');
          
          return finalResults;
        }
      } catch (error) {
        if (onLog) onLog(`[KLINE_BATCH] ⚠️ Batch request failed, falling back to individual requests: ${error.message}`, 'warning');
      }
    }
    
    // Fallback: Process individual requests (original logic)
    if (onLog) onLog(`[KLINE_BATCH] 🔄 Using individual requests as fallback`, 'info');
    
    // Process all coins in parallel batches instead of sequentially
    const allCoinRequests = [];
    
    for (const coin of coinsToFetch) {
      let endTime = Date.now();
      
      for (let i = 0; i < requestsNeeded; i++) {
        const limit = Math.min(MAX_PER_REQUEST, requiredCandles);
        
        if (limit <= 0) break;
        
        const params = {
          symbols: [coin.replace('/', '')], // Remove slash for Binance API
          interval: currentTimeframe,
          limit: limit,
          source: 'backtesting_fetcher_individual',
        };
        
        if (i > 0) {
          params.endTime = endTime;
        }
        
        allCoinRequests.push({
          coin,
          params,
          requestIndex: i,
          totalRequests: requestsNeeded
        });
      }
    }
    
    if (onLog) onLog(`[KLINE_BATCH] Total requests to process: ${allCoinRequests.length}`, 'info');
    
    // Process requests in batches to avoid overwhelming the API
    const BATCH_SIZE = 5; // Process 5 requests at a time
    for (let i = 0; i < allCoinRequests.length; i += BATCH_SIZE) {
      const batch = allCoinRequests.slice(i, i + BATCH_SIZE);
      
      if (dataLoadingProgressSetter) {
        dataLoadingProgressSetter((i / allCoinRequests.length) * 100);
      }
      
      // Process batch in parallel
      const batchPromises = batch.map(async ({ coin, params, requestIndex }) => {
        try {
          // NEW: Direct call to bypass API queue for better batching
          const response = await getKlineData(params);
          
          const responseData = response?.data;
          
          if (!responseData || typeof responseData !== 'object') {
            throw new Error('Invalid response from getKlineData: expected an object.');
          }
          
          const coinResult = responseData[coin.replace('/', '')];
          
          if (!coinResult || !coinResult.success) {
            const fetchError = coinResult?.error || 'No data or success=false returned for coin.';
            throw new Error(fetchError);
          }
          
          const klines = coinResult.data;
          
          if (!Array.isArray(klines)) {
            throw new Error('Invalid kline data format: expected an array.');
          }
          
          return { coin, klines, success: true };
        } catch (e) {
          if (onLog) onLog(`[${coin}] Error during fetch attempt #${requestIndex + 1}: ${e.message}`, 'error');
          return { coin, klines: [], success: false, error: e.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Process batch results
      batchResults.forEach(({ coin, klines, success, error }) => {
        if (success && klines.length > 0) {
          if (!results[coin].data) {
            results[coin].data = [];
          }
          results[coin].data = [...klines, ...results[coin].data];
          results[coin].success = true;
        } else if (!success) {
          results[coin].error = error;
        }
      });
    }
    
    // Format the data for all coins
    const finalResults = {};
    for (const coin of coinsToFetch) {
      if (results[coin].success && results[coin].data.length > 0) {
        const formattedData = results[coin].data.map(k => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
          quoteAssetVolume: parseFloat(k[7]),
          trades: k[8],
          takerBuyBaseAssetVolume: parseFloat(k[9]),
          takerBuyQuoteAssetVolume: parseFloat(k[10]),
          ignore: k[11],
          coin: coin
        }));
        
        // Sort chronologically
        formattedData.sort((a, b) => a.time - b.time);
        finalResults[coin] = formattedData;
        // Sufficiency check against requested period/timeframe
        try {
          const needed = requiredCandles;
          const have = formattedData.length;
          const ok = have >= needed;
          const pct = ((have / needed) * 100).toFixed(1);
          const msg = ok
            ? `[${coin}] ✅ Kline sufficiency confirmed: ${have.toLocaleString()} / ${needed.toLocaleString()} candles (${pct}%)`
            : `[${coin}] ⚠️ INSUFFICIENT_KLINES: ${have.toLocaleString()} / ${needed.toLocaleString()} candles (${pct}%). Backtest may under-cover the requested period.`;
          if (onLog) onLog(msg, ok ? 'success' : 'warning');
        } catch (_) {}
      } else {
        finalResults[coin] = [];
        if (onLog) onLog(`[${coin}] ❌ No kline data returned for requested period/timeframe`, 'error');
      }
    }
    
    if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);
    
    if (onLog) onLog(`[KLINE_BATCH] ✅ Completed fetching data for ${coinsToFetch.length} symbols`, 'info');
    
    return finalResults;
  } catch (error) {
    if (onLog) onLog(`[KLINE_BATCH] Batch fetch failed: ${error.message}`, 'error');
    throw error;
  }
};

// Keep the original single-coin function for backward compatibility
export const fetchDataForCoin = async ({
  coinToFetch,
  currentPeriod,
  currentTimeframe,
  dataLoadingProgressSetter,
  onLog
}) => {
  if (onLog) onLog(`[${coinToFetch}] Fetching ${coinToFetch} with timeframe ${currentTimeframe} for period ${currentPeriod}...`, 'info');

  const requiredCandles = calculateRequiredCandles(currentPeriod, currentTimeframe);
  if (onLog) onLog(`[${coinToFetch}] Required candles for ${currentPeriod} on ${currentTimeframe} timeframe: ~${requiredCandles.toLocaleString()}`, 'info');

  const MAX_PER_REQUEST = 1000;
  let allKlines = [];
  let endTime = Date.now(); 
  let requestsNeeded = Math.ceil(requiredCandles / MAX_PER_REQUEST);

  // OPTIMIZATION: Collect all required endTime values upfront for batch processing
  const endTimeRequests = [];
  let tempEndTime = endTime;
  
  for (let i = 0; i < requestsNeeded; i++) {
    const limit = Math.min(MAX_PER_REQUEST, requiredCandles - (i * MAX_PER_REQUEST));
    
    if (limit <= 0) break;
    
    endTimeRequests.push({
      endTime: i === 0 ? null : tempEndTime, // First request has no endTime (latest)
      limit: limit,
      requestIndex: i
    });
    
    // Calculate next endTime (approximate)
    tempEndTime = tempEndTime - (limit * getTimeframeMs(currentTimeframe));
  }

  if (onLog) onLog(`[${coinToFetch}] 🚀 OPTIMIZED: Making ${endTimeRequests.length} batch requests instead of ${requestsNeeded} sequential calls`, 'info');

  // OPTIMIZATION: Make all requests in parallel using Promise.all for true batching
  if (onLog) onLog(`[${coinToFetch}] 🚀 Making ${endTimeRequests.length} parallel requests for optimal batching`, 'info');
  
  const batchPromises = endTimeRequests.map(async (request, index) => {
    const params = {
      symbols: [coinToFetch.replace('/', '')], // Remove slash for Binance API
      interval: currentTimeframe,
      limit: request.limit,
      source: 'backtesting_fetcher',
    };

    if (request.endTime) {
        params.endTime = request.endTime;
    }

    try {
      // NEW: Direct call to bypass API queue for better batching
      const response = await getKlineData(params);
      const responseData = response?.data;
      
      if (!responseData || typeof responseData !== 'object') {
          throw new Error('Invalid response from getKlineData: expected an object.');
      }

      const coinResult = responseData[coinToFetch.replace('/', '')];

      if (!coinResult || !coinResult.success) {
          const fetchError = coinResult?.error || 'No data or success=false returned for coin.';
          throw new Error(fetchError);
      }

      const klines = coinResult.data;

      if (!Array.isArray(klines)) {
          throw new Error('Invalid kline data format: expected an array.');
      }

      if (klines.length === 0) {
        if (onLog) onLog(`[${coinToFetch}] Kline data chunk fetch returned 0 candles on batch #${index + 1}.`, 'warning');
        return []; 
      }
      
      if (onLog) onLog(`[${coinToFetch}] ✅ Batch #${index + 1} completed: ${klines.length} candles`, 'info');
      return klines;

    } catch (e) {
      if (onLog) onLog(`[${coinToFetch}] Critical error during batch #${index + 1}: ${e.message}`, 'error');
      throw e;
    }
  });

  // Wait for all batch requests to complete
  try {
    const batchResults = await Promise.all(batchPromises);
    
    // Combine all results
    for (const klines of batchResults) {
      if (klines.length > 0) {
        allKlines = [...klines, ...allKlines];
      }
    }
    
    if (onLog) onLog(`[${coinToFetch}] 🎉 OPTIMIZED: Collected ${allKlines.length} total candles from ${batchResults.length} parallel batches`, 'info');
    
  } catch (e) {
    if (onLog) onLog(`[${coinToFetch}] Error in parallel batch processing: ${e.message}`, 'error');
    throw e;
  }

  // Format the data
  const formattedData = allKlines.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
    quoteAssetVolume: parseFloat(k[7]),
    trades: k[8],
    takerBuyBaseAssetVolume: parseFloat(k[9]),
    takerBuyQuoteAssetVolume: parseFloat(k[10]),
    ignore: k[11],
    coin: coinToFetch
  }));

  // Sort chronologically
  formattedData.sort((a, b) => a.time - b.time);

  // Final sufficiency confirmation
  try {
    const have = formattedData.length;
    const pct = ((have / requiredCandles) * 100).toFixed(1);
    const ok = have >= requiredCandles;
    const msg = ok
      ? `[${coinToFetch}] ✅ Kline sufficiency confirmed: ${have.toLocaleString()} / ${requiredCandles.toLocaleString()} candles (${pct}%)`
      : `[${coinToFetch}] ⚠️ INSUFFICIENT_KLINES: ${have.toLocaleString()} / ${requiredCandles.toLocaleString()} candles (${pct}%). Backtest may under-cover the requested period.`;
    if (onLog) onLog(msg, ok ? 'success' : 'warning');
  } catch (_) {}

  if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);

  return {
    success: true,
    data: formattedData
  };
};