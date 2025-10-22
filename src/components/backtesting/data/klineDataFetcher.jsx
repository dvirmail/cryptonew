import { queueFunctionCall } from '@/components/utils/apiQueue';
import { getKlineData } from '@/api/functions';

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
  if (onLog) onLog(`[KLINE_BATCH] Fetching data for ${batchSize} symbols in single backend call...`, 'info');

  const requiredCandles = calculateRequiredCandles(currentPeriod, currentTimeframe);
  if (onLog) onLog(`[KLINE_BATCH] Required candles: ~${requiredCandles.toLocaleString()} per symbol`, 'info');

  try {
    const MAX_PER_REQUEST = 1000;
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
    
    // Process each coin individually to handle large data requirements
    for (const coin of coinsToFetch) {
      if (onLog) onLog(`[KLINE_BATCH] Processing ${coin}...`, 'info');
      
      let allKlines = [];
      let endTime = Date.now();
      
      for (let i = 0; i < requestsNeeded; i++) {
        if (dataLoadingProgressSetter) {
          dataLoadingProgressSetter((i / requestsNeeded) * 100);
        }
        
        const limit = Math.min(MAX_PER_REQUEST, requiredCandles - allKlines.length);
        
        if (limit <= 0) {
          if (onLog) onLog(`[${coin}] Sufficient candles fetched (${allKlines.length}). Breaking fetch loop.`, 'info');
          break;
        }
        
        const params = {
          symbols: [coin.replace('/', '')], // Remove slash for Binance API
          interval: currentTimeframe,
          limit: limit,
          source: 'backtesting_fetcher_batch',
        };
        
        if (i > 0) {
          params.endTime = endTime;
        }
        
        try {
          const response = await queueFunctionCall(
            'getKlineData',
            getKlineData,
            params,
            'critical',
            null,
            60000,
            300000
          );
          
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
          
          if (klines.length === 0) {
            if (onLog) onLog(`[${coin}] Kline data chunk fetch returned 0 candles on attempt #${i + 1}.`, 'warning');
            break; 
          }
          
          allKlines = [...klines, ...allKlines];
          endTime = klines[0][0] - 1; 
          
          if (klines.length < MAX_PER_REQUEST) {
            if (onLog) onLog(`[${coin}] Received ${klines.length} candles, less than max limit (${MAX_PER_REQUEST}). Assuming end of history. Halting fetch loop.`, 'info');
            break; 
          }
          
        } catch (e) {
          if (onLog) onLog(`[${coin}] Critical error during fetch attempt #${i + 1}: ${e.message}`, 'error');
          throw e;
        }
      }
      
      // Format the data for this coin
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
        coin: coin
      }));

      // Sort chronologically
      formattedData.sort((a, b) => a.time - b.time);
      
      // Store the results for this coin
      results[coin] = {
        success: true,
        data: formattedData
      };
      
      if (onLog) onLog(`[${coin}] Successfully fetched ${formattedData.length} candles`, 'info');
    }
    
    if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);
    
    return results;
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

  for (let i = 0; i < requestsNeeded; i++) {
    if (dataLoadingProgressSetter) {
        dataLoadingProgressSetter((i / requestsNeeded) * 100);
    }

    const limit = Math.min(MAX_PER_REQUEST, requiredCandles - allKlines.length);
    
    if (limit <= 0) {
        if (onLog) onLog(`[${coinToFetch}] Sufficient candles fetched (${allKlines.length}). Breaking fetch loop.`, 'info');
        break;
    }

    const params = {
      symbols: [coinToFetch.replace('/', '')], // Remove slash for Binance API
      interval: currentTimeframe,
      limit: limit,
      source: 'backtesting_fetcher',
    };

    if (i > 0) {
        params.endTime = endTime;
    }

    try {
      const response = await queueFunctionCall(
        'getKlineData',
        getKlineData,
        params,
        'critical'
      );
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
        if (onLog) onLog(`[${coinToFetch}] Kline data chunk fetch returned 0 candles on attempt #${i + 1}.`, 'warning');
        break; 
      }
      
      allKlines = [...klines, ...allKlines];
      endTime = klines[0][0] - 1; 

      if (klines.length < MAX_PER_REQUEST) {
        if (onLog) onLog(`[${coinToFetch}] Received ${klines.length} candles, less than max limit (${MAX_PER_REQUEST}). Assuming end of history. Halting fetch loop.`, 'info');
        break; 
      }

    } catch (e) {
      if (onLog) onLog(`[${coinToFetch}] Critical error during fetch attempt #${i + 1}: ${e.message}`, 'error');
      throw e;
    }
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

  if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);

  return {
    success: true,
    data: formattedData
  };
};