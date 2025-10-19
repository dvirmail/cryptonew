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
    const params = {
      symbols: coinsToFetch, // Send all symbols at once
      interval: currentTimeframe,
      limit: 1000, // Max per request
      source: 'backtesting_fetcher_batch',
    };

    if (dataLoadingProgressSetter) dataLoadingProgressSetter(10);

    const response = await queueFunctionCall(
      getKlineData,
      params,
      'critical',
      null, // No custom cache key
      60000, // 1 minute cache
      300000 // 5 minute timeout for batch
    );

    if (dataLoadingProgressSetter) dataLoadingProgressSetter(80);

    const responseData = response?.data;
    
    if (!responseData || typeof responseData !== 'object') {
      throw new Error('Invalid response from getKlineData: expected an object.');
    }

    // Process results for each coin
    const results = {};
    let successCount = 0;
    let failCount = 0;

    for (const coin of coinsToFetch) {
      const coinResult = responseData[coin];

      if (!coinResult || !coinResult.success) {
        const fetchError = coinResult?.error || 'No data returned for coin.';
        results[coin] = { success: false, error: fetchError, data: [] };
        failCount++;
        if (onLog) onLog(`[KLINE_BATCH] ❌ ${coin}: ${fetchError}`, 'warning');
        continue;
      }

      const klines = coinResult.data;

      if (!Array.isArray(klines) || klines.length === 0) {
        results[coin] = { success: false, error: 'No kline data returned', data: [] };
        failCount++;
        if (onLog) onLog(`[KLINE_BATCH] ❌ ${coin}: No data`, 'warning');
        continue;
      }

      // Format the data
      const formattedData = klines.map(k => ({
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

      results[coin] = {
        success: true,
        data: formattedData,
        error: null,
      };
      successCount++;
    }

    if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);
    
    if (onLog) {
      onLog(`[KLINE_BATCH] ✅ Batch complete: ${successCount} success, ${failCount} failed`, 'success');
    }

    return results;

  } catch (error) {
    if (onLog) onLog(`[KLINE_BATCH] ❌ Batch fetch failed: ${error.message}`, 'error');
    
    // Return error results for all coins
    const results = {};
    for (const coin of coinsToFetch) {
      results[coin] = {
        success: false,
        error: `Batch fetch failed: ${error.message}`,
        data: []
      };
    }
    return results;
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
      symbols: [coinToFetch],
      interval: currentTimeframe,
      limit: limit,
      source: 'backtesting_fetcher',
    };

    if (i > 0) {
        params.endTime = endTime;
    }

    try {
      const response = await queueFunctionCall(
        getKlineData,
        params,
        'critical'
      );
      const responseData = response?.data;
      
      if (!responseData || typeof responseData !== 'object') {
          throw new Error('Invalid response from getKlineData: expected an object.');
      }

      const coinResult = responseData[coinToFetch];

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
      const errorMessage = e.message || 'An unknown error occurred during data fetch.';
      if (onLog) onLog(`[${coinToFetch}] Critical error during fetch attempt #${i + 1}: ${errorMessage}`, 'error');
      return { success: false, error: `Critical failure on data fetch #${i + 1}: ${errorMessage}`, data: [] };
    }
  }

  if (allKlines.length === 0) {
      return { success: false, error: 'No kline data could be fetched after all attempts.', data: [] };
  }

  if (onLog) onLog(`[${coinToFetch}] Completed fetch. Loaded ${allKlines.length.toLocaleString()} raw candles. Now processing...`, 'success');
  if (dataLoadingProgressSetter) dataLoadingProgressSetter(98);

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

  formattedData.sort((a, b) => a.time - b.time);

  if (dataLoadingProgressSetter) dataLoadingProgressSetter(100);
  if (onLog) onLog(`[${coinToFetch}] Successfully processed ${formattedData.length} candles into the required format.`, 'success');

  return {
    success: true,
    data: formattedData,
    error: null,
  };
};