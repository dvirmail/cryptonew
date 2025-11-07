
/**
 * Indicator Manager - Orchestrates all technical indicator calculations
 * and provides data fetching utilities
 */

// Import calculation functions
import { calculateMACD, calculateTEMA, calculateDEMA, calculateHMA, calculateMARibbon, calculateADX, calculatePSAR, calculateIchimoku, calculateKAMA, detectTrendExhaustion } from './indicator-calculations/trendIndicators';
import { calculateRSI, calculateStochastic, calculateWilliamsR, calculateCCI, calculateROC, calculateAwesomeOscillator, calculateCMO } from './indicator-calculations/momentumIndicators';
import { calculateATR as unifiedCalculateATR } from './atrUnified.jsx'; // Import unified ATR function
import {
    calculateBollingerBands,
    calculateBBW,
    calculateKeltnerChannels,
    calculateDonchian,
    detectVolatilityRegimeChange,
    detectBollingerSqueeze,
    detectSqueezeBreakout,
    detectVolatilityClustering,
    calculateStandardDeviation, // NEW: For volatility calculations
    calculateNormalizedATR,     // NEW: For dynamic volatility
    evaluateVolatilityStates,   // NEW: For dynamic volatility
    evaluateBBWStates           // NEW: For dynamic volatility
} from './indicator-calculations/volatilityIndicators';
import {
    calculateVolumeMA,
    calculateMFI,
    calculateOBV,
    calculateCMF,
    calculateADL,
    detectSmartMoneyFlow,
    detectVolumeClimax,
    analyzeVolumeSpread,
    calculateOBVWithDivergence,
    // NEW: Import the state evaluation functions
    evaluateRelativeVolumeStates,
    evaluateOBVTrendStates,
    evaluateOBVDivergence,
    evaluateVolumeRocStates
} from './indicator-calculations/volumeIndicators';
import {
    calculateSupportResistance,
    calculatePivotPoints,
    calculateFibonacciRetracements
} from './indicator-calculations/supportresistanceindicators';
import {
    detectCandlestickPatterns,
    detectChartPatterns
} from './indicator-calculations/patternIndicators';
import { calculateEMA, calculateMA, calculateWMA } from './indicator-calculations/helpers';
import { format } from 'date-fns';
import { get, memoize } from 'lodash';
// FIXED: Import from the new ApiManager instead of directly from functions
import { fetchKlineData as fetchKlineDataFromApi, fetchMultiplePrices as fetchMultiplePricesFromApi } from './ApiManager';
// NEW: Import MarketRegimeDetector (assuming it's in a peer file or similar utility path)
import MarketRegimeDetector from './MarketRegimeDetector';
import { SIGNAL_WEIGHTS, CORE_SIGNAL_TYPES } from './signalSettings';
import { getRegimeMultiplier } from './regimeUtils';
import { calculateUnifiedCombinedStrength } from './unifiedStrengthCalculator';

// Debug limiter (disabled to silence logs)
let imDebugCount = 0;
const IM_DEBUG_MAX = 0; // 0 = no IM_DEBUG logs printed

/**
 * Resets the debug counter for the Indicator Manager, allowing debug logs to appear again.
 */
export function resetIndicatorManagerDebug() {
  imDebugCount = 0;
}

/**
 * Default settings for various indicators. Used when specific settings are not provided in signalSettings.
 */
const defaultSignalSettings = {
    ema: { period: 21, fastPeriod: 10, slowPeriod: 21 },
    dema: { period: 21, fastPeriod: 10, slowPeriod: 21 },
    tema: { period: 21, fastPeriod: 10, slowPeriod: 21 },
    hma: { period: 21, fastPeriod: 10, slowPeriod: 21 },
    wma: { period: 20, fastPeriod: 10, slowPeriod: 21 },
    sma: { period: 20 }, // Default for general SMA
    ma200: { period: 200 },
    ma: { period: 21 }, // Default for general MA (simple)
    volume: { period: 20 },
    volume_sma: { period: 20 }, // Default for Volume SMA
    macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    adx: { period: 14 },
    psar: { afStart: 0.02, afIncrement: 0.02, afMax: 0.2 },
    ichimoku: {}, // Ichimoku has fixed periods (9, 26, 52, 26) usually, or customizable but not a single 'period'
    rsi: { period: 14 },
    stochastic: { kPeriod: 14, dPeriod: 3 },
    bollinger: { period: 20, stdDev: 2 },
    atr: { period: 14, volatilityLookback: 100 },
    bbw: { volatilityLookback: 100 },
    obv: { shortPeriod: 10, longPeriod: 30 },
    cmf: { period: 20 },
    volume_roc: { period: 14 },
    kama: { period: 10 },
    trendexhaustion: {},
    williamsr: { period: 14 },
    cci: { period: 20 },
    roc: { period: 12 },
    awesomeoscillator: {},
    cmo: { period: 14 },
    keltner: { keltnerPeriod: 20, atrPeriod: 10, kcMultiplier: 1.5 },
    ttm_squeeze: {}, // Relies on Bollinger/Keltner/AwesomeOscillator
    donchian: { period: 20 },
    mfi: { period: 14 },
    adline: {},
    pivot: {},
    fibonacci: { lookback: 100 }, // Increased default lookback for better swing detection
    supportresistance: { lookback: 100, tolerance: 0.01 }, // Increased default lookback for shorter timeframes
    chartpattern: {},
    candlestick: {}
};

// Data fetching functions - NOW WRAPPERS AROUND APIMANAGER
export const fetchKlineData = async (symbol, interval, limit = 500, endTime = null) => {
  // Note: The new ApiManager doesn't support endTime yet, but we maintain the interface.
  // The core fetchKlineData function in ApiManager will handle retries and caching.
  return fetchKlineDataFromApi(symbol, interval, limit);
};

// Fetch current price for a symbol
export const fetchCurrentPrice = async (symbol) => {
  try {
    // Use the existing fetchMultiplePrices function to get current price
    const result = await fetchMultiplePricesFromApi([symbol]);
    if (result && result[symbol]) {
      return {
        symbol,
        price: parseFloat(result[symbol].price),
        timestamp: result[symbol].timestamp
      };
    }
    throw new Error(`No price data found for ${symbol}`);
  } catch (error) {
    console.error(`[IndicatorManager] fetchCurrentPrice error for ${symbol}:`, error);
    throw error;
  }
};

export const fetchMultiplePrices = async (symbols) => {
  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return { success: true, data: [] };
  }
  // The core fetchMultiplePrices function in ApiManager will handle everything.
  return fetchMultiplePricesFromApi(symbols);
};

export const formatKlineDataForChart = (klineData, timeframe) => {
  if (!Array.isArray(klineData)) return [];

  return klineData.map(kline => ({
    time: new Date(kline[0]),
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5])
  }));
};

export const getAvailablePairs = async () => {
  try {
    const response = await fetch('https://data-api.binance.vision/api/v3/exchangeInfo');

    if (!response.ok) {
      console.error('Error fetching exchange info:', response.status, response.statusText);
      return { success: false, error: 'Failed to fetch available pairs' };
    }

    const data = await response.json();

    const usdtPairs = data.symbols
      .filter(symbol =>
        symbol.quoteAsset === 'USDT' &&
        symbol.status === 'TRADING' &&
        !symbol.baseAsset.includes('UP') &&
        !symbol.baseAsset.includes('DOWN') &&
        !symbol.baseAsset.includes('BULL') &&
        !symbol.baseAsset.includes('BEAR')
      )
      .map(symbol => ({
        symbol: `${symbol.baseAsset}/USDT`,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset
      }))
      .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));

    return { success: true, data: usdtPairs };
  } catch (e) {
      console.error('Error in getAvailablePairs:', e);
    return { success: false, error: e.message };
  }
};

// ATR function removed - use unifiedCalculateATR directly

/**

  const trueRanges = [];
  let maxReasonablePrice = 0;
  
  // [TR_DEBUG] First pass: find reasonable price range to filter out corrupted data
  for (let i = 0; i < klineData.length; i++) {
    const high = parseFloat(Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high);
    const low = parseFloat(Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low);
    
    if (!isNaN(high) && !isNaN(low) && high > 0 && low > 0) {
      maxReasonablePrice = Math.max(maxReasonablePrice, high);
    }
  }
  
  // [TR_DEBUG] Log price analysis results
  console.log('[TR_DEBUG] 💰 Price analysis results:', {
    maxReasonablePrice: maxReasonablePrice,
    totalCandles: klineData.length,
    priceThreshold: maxReasonablePrice * 10,
    // Check for extreme prices that might indicate data corruption
    extremeHighs: klineData.filter(candle => {
      const high = parseFloat(Array.isArray(candle) ? candle[2] : candle.high);
      return !isNaN(high) && high > maxReasonablePrice * 2;
    }).length,
    extremeLows: klineData.filter(candle => {
      const low = parseFloat(Array.isArray(candle) ? candle[3] : candle.low);
      return !isNaN(low) && low > maxReasonablePrice * 2;
    }).length
  });
  
  // Set a reasonable threshold (10x the highest reasonable price)
  const priceThreshold = maxReasonablePrice * 10;
  
  for (let i = 0; i < klineData.length; i++) {
    // Universal data access for both array and object formats
    const high = parseFloat(Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high);
    const low = parseFloat(Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low);
    const previousClose = i > 0 ? parseFloat(Array.isArray(klineData[i - 1]) ? klineData[i - 1][4] : klineData[i - 1].close) : null;

    // DEBUG: Log problematic values
    if (i < 5 || i > klineData.length - 5) {
      console.log(`[ATR_DEBUG] Candle ${i}:`, {
        high, low, previousClose,
        rawHigh: Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high,
        rawLow: Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low,
        rawPreviousClose: i > 0 ? (Array.isArray(klineData[i - 1]) ? klineData[i - 1][4] : klineData[i - 1].close) : null
      });
    }

    // Check for NaN values which would break the calculation
    if (isNaN(high) || isNaN(low) || (i > 0 && previousClose !== null && isNaN(previousClose))) {
      trueRanges.push(0); // Push 0 if data is invalid to avoid breaking the loop
      continue;
    }

    // [TR_DEBUG] CRITICAL FIX: Filter out corrupted price data
    if (high > priceThreshold || low > priceThreshold || high <= 0 || low <= 0) {
      console.warn(`[TR_DEBUG] 🚫 FILTERING corrupted price data at candle ${i}:`, {
        position: i,
        high: high,
        low: low,
        previousClose: previousClose,
        highThreshold: high > priceThreshold,
        lowThreshold: low > priceThreshold,
        priceThreshold: priceThreshold,
        maxReasonablePrice: maxReasonablePrice,
        highPercentage: maxReasonablePrice > 0 ? ((high / maxReasonablePrice) * 100).toFixed(2) + '%' : 'N/A',
        lowPercentage: maxReasonablePrice > 0 ? ((low / maxReasonablePrice) * 100).toFixed(2) + '%' : 'N/A',
        rawCandle: klineData[i],
        impact: 'Using previous valid true range or 0'
      });
      // Use the previous valid true range or 0 if this is the first candle
      trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
      continue;
    }

    // DETAILED TRUE RANGE DEBUGGING
    const tr1 = high - low;
    const tr2 = previousClose !== null ? Math.abs(high - previousClose) : 0;
    const tr3 = previousClose !== null ? Math.abs(low - previousClose) : 0;

    // [TR_DEBUG] Log every True Range calculation for positions around 220
    if (i >= 215 && i <= 225) {
      console.log(`[TR_DEBUG] 🔍 True Range calculation at position ${i}:`, {
        position: i,
        high: high,
        low: low,
        previousClose: previousClose,
        tr1: tr1,
        tr2: tr2,
        tr3: tr3,
        rawCandle: klineData[i],
        rawPreviousCandle: i > 0 ? klineData[i - 1] : null,
        dataFormat: Array.isArray(klineData[i]) ? 'array' : 'object',
        priceThreshold: priceThreshold,
        maxReasonablePrice: maxReasonablePrice
      });
    }

    // ADDITIONAL VALIDATION: Check for extreme price gaps that indicate data corruption
    if (previousClose !== null) {
      const priceGapUp = Math.abs(high - previousClose);
      const priceGapDown = Math.abs(low - previousClose);
      const maxReasonableGap = maxReasonablePrice * 0.15; // Max 15% gap (more appropriate for Bitcoin volatility)
      
      // [TR_DEBUG] Log gap analysis for positions around 220
      if (i >= 215 && i <= 225) {
        console.log(`[TR_DEBUG] 📊 Gap analysis at position ${i}:`, {
          position: i,
          priceGapUp: priceGapUp,
          priceGapDown: priceGapDown,
          maxReasonableGap: maxReasonableGap,
          gapUpPercentage: ((priceGapUp / previousClose) * 100).toFixed(2) + '%',
          gapDownPercentage: ((priceGapDown / previousClose) * 100).toFixed(2) + '%',
          isGapExtreme: priceGapUp > maxReasonableGap || priceGapDown > maxReasonableGap
        });
      }
      
      // More sophisticated gap validation: check both absolute and percentage thresholds
      const gapUpPercentage = (priceGapUp / previousClose) * 100;
      const gapDownPercentage = (priceGapDown / previousClose) * 100;
      const isGapExtremeAbsolute = priceGapUp > maxReasonableGap || priceGapDown > maxReasonableGap;
      const isGapExtremePercentage = gapUpPercentage > 15 || gapDownPercentage > 15; // More than 15% gap is suspicious
      
      if (isGapExtremeAbsolute && isGapExtremePercentage) {
        console.warn(`[TR_DEBUG] 🚫 FILTERING extreme price gap at candle ${i}:`, {
          position: i,
          priceGapUp: priceGapUp,
          priceGapDown: priceGapDown,
          maxReasonableGap: maxReasonableGap,
          high: high,
          low: low,
          previousClose: previousClose,
          gapUpPercentage: gapUpPercentage.toFixed(2) + '%',
          gapDownPercentage: gapDownPercentage.toFixed(2) + '%',
          isGapExtremeAbsolute: isGapExtremeAbsolute,
          isGapExtremePercentage: isGapExtremePercentage,
          impact: 'Using previous valid true range or 0'
        });
        // Use the previous valid true range or 0 if this is the first candle
        trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
        continue;
      }
    }

    const trueRange = Math.max(tr1, tr2, tr3);
    
    // [TR_DEBUG] Log the final True Range calculation for positions around 220
    if (i >= 215 && i <= 225) {
      console.log(`[TR_DEBUG] ✅ Final True Range at position ${i}:`, {
        position: i,
        trueRange: trueRange,
        tr1: tr1,
        tr2: tr2,
        tr3: tr3,
        maxComponent: tr1 === trueRange ? 'tr1 (high-low)' : tr2 === trueRange ? 'tr2 (high-prevClose)' : 'tr3 (low-prevClose)',
        trueRangePercentage: previousClose ? ((trueRange / previousClose) * 100).toFixed(2) + '%' : 'N/A'
      });
    }
    
    // CRITICAL FIX: Filter out extreme True Range values that indicate data corruption
    // Use a more sophisticated approach: check if True Range is reasonable relative to price level
    const maxReasonableTrueRange = maxReasonablePrice * 0.25; // Max 25% of highest price (more appropriate for Bitcoin volatility)
    const trueRangePercentage = previousClose ? (trueRange / previousClose) * 100 : 0;
    
    // Only filter if True Range is both absolutely extreme AND represents an unreasonable percentage
    const isExtremeAbsolute = trueRange > maxReasonableTrueRange;
    const isExtremePercentage = trueRangePercentage > 10; // More than 10% of price is suspicious
    
    if (isExtremeAbsolute && isExtremePercentage) {
      console.warn(`[ATR_DEBUG] 🚫 FILTERING extreme True Range at candle ${i}:`, {
        trueRange: trueRange,
        maxReasonableTrueRange: maxReasonableTrueRange,
        trueRangePercentage: trueRangePercentage.toFixed(2) + '%',
        high: high,
        low: low,
        previousClose: previousClose,
        tr1: tr1,
        tr2: tr2,
        tr3: tr3,
        isExtremeAbsolute: isExtremeAbsolute,
        isExtremePercentage: isExtremePercentage,
        impact: 'Using previous valid true range or 0'
      });
      // Use the previous valid true range or 0 if this is the first candle
      trueRanges.push(trueRanges.length > 0 ? trueRanges[trueRanges.length - 1] : 0);
      continue;
    }
    
    trueRanges.push(trueRange);

    // DEBUG: Log extreme true range values
    if (trueRange > 1000) {
      console.warn(`[ATR_DEBUG] ⚠️ EXTREME True Range detected at candle ${i}:`, {
        trueRange: trueRange,
        high: high,
        low: low,
        previousClose: previousClose,
        tr1: tr1,
        tr2: tr2,
        tr3: tr3,
        candle: klineData[i],
        impact: 'This indicates potentially corrupted price data - ATR will not be capped'
      });
    }
  }

  const atrValues = [];
  if (trueRanges.length < period) return Array(klineData.length).fill(null);

  // FIXED: Use proper ATR calculation with consistent smoothing
  // First ATR value is simple average of first period True Ranges
  let sumFirstTR = 0;
  for (let i = 0; i < period; i++) {
    sumFirstTR += trueRanges[i];
  }
  const firstATR = sumFirstTR / period;
  atrValues.push(firstATR);

  // Calculate subsequent ATR values using Wilder's smoothing method consistently
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = atrValues[atrValues.length - 1];
    const currentTR = trueRanges[i];
    // Wilder's smoothing: ATR = (Previous ATR * (n-1) + Current TR) / n
    const currentATR = (prevATR * (period - 1) + currentTR) / period;
    
    atrValues.push(currentATR);

    // DEBUG: Log ATR calculation at each position
    if (i % 10 === 0 || i === trueRanges.length - 1) { // Log every 10th position and the last one
      console.log(`[ATR_DEBUG] 📍 ATR calculated at position ${i}:`, {
        position: i,
        currentATR: currentATR.toFixed(6),
        prevATR: prevATR.toFixed(6),
        currentTR: currentTR.toFixed(6),
        trueRange: trueRanges[i].toFixed(6),
        period: period,
        progress: `${((i - period + 1) / (trueRanges.length - period)) * 100}%`
      });
    }

    // DEBUG: Log extreme ATR values with detailed calculations
    if (currentATR > 1000) {
      console.warn(`[ATR_DEBUG] ⚠️ EXTREME ATR calculated at position ${i}:`, {
        currentATR: currentATR,
        prevATR: prevATR,
        currentTR: currentTR,
        trueRange: trueRanges[i],
        period: period,
        calculation: `(${prevATR} * ${period - 1} + ${currentTR}) / ${period} = ${currentATR}`,
        currentATRChange: currentATR - prevATR,
        currentATRChangePercent: ((currentATR - prevATR) / prevATR * 100).toFixed(2) + '%'
      });
    }
  }

  // [TR_DEBUG] Log True Range analysis summary
  console.log('[TR_DEBUG] 📊 True Range Analysis Summary:', {
    totalCandles: klineData.length,
    validTrueRanges: trueRanges.length,
    filteredOutCount: klineData.length - trueRanges.length,
    maxTrueRange: Math.max(...trueRanges),
    avgTrueRange: trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length,
    extremeTrueRanges: trueRanges.filter(tr => tr > maxReasonablePrice * 0.1).length,
    // Check for patterns in extreme values
    extremePositions: trueRanges.map((tr, idx) => ({ position: idx, trueRange: tr }))
      .filter(item => item.trueRange > maxReasonablePrice * 0.1)
      .slice(0, 10) // Show first 10 extreme positions
  });

  // DEBUG: Log final ATR results and validate
  const finalATR = atrValues[atrValues.length - 1];
  const maxReasonableATR = maxReasonablePrice * 0.05; // Max 5% of highest price
  
  // DEBUG: Log ATR calculation summary with position details
  console.log(`[ATR_DEBUG] 📊 ATR Calculation Summary:`, {
    period: period,
    totalCandles: klineData.length,
    validTrueRanges: trueRanges.length,
    finalATR: finalATR,
    maxReasonableATR: maxReasonableATR,
    maxReasonablePrice: maxReasonablePrice,
    isATRReasonable: finalATR <= maxReasonableATR,
    atrPercentage: finalATR ? (finalATR / maxReasonablePrice) * 100 : 0,
    // NEW: Add position-specific ATR calculations
    atrPositions: {
      initialPeriod: period - 1, // First valid ATR position
      finalPosition: klineData.length - 1, // Last position
      totalCalculatedPositions: atrValues.length,
      positionRange: `${period - 1} to ${klineData.length - 1}`
    }
  });
  
  if (finalATR > maxReasonableATR) {
    console.warn('[ATR_DEBUG] ⚠️ FINAL ATR is extremely high (not capped):', {
      finalATR: finalATR,
      maxReasonableATR: maxReasonableATR,
      maxTrueRange: Math.max(...trueRanges),
      avgTrueRange: trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length,
      sampleTrueRanges: trueRanges.slice(-5),
      maxReasonablePrice,
      impact: 'ATR values are not capped - extreme values may indicate data issues'
    });
  }

  // Pad the beginning of the ATR array with nulls to match the length of klineData
  const paddedAtr = Array(period - 1).fill(null).concat(atrValues);
  // Ensure the final array length matches klineData length
  return paddedAtr.slice(0, klineData.length);
};

/**
 * Gets the list of required indicator calculations based on enabled signals.
 * @param {object} signalSettings - The signal settings object.
 * @returns {Set<string>} - A set of unique indicator keys to calculate.
 */
export const getRequiredIndicators = (signalSettings) => {
    const required = new Set(['data']);

    for (const signalKey in signalSettings) {
        const isEnabled = typeof signalSettings[signalKey] === 'object'
                         ? signalSettings[signalKey]?.enabled
                         : signalSettings[signalKey];

        if (isEnabled) {
            switch (signalKey.toLowerCase()) {
                case 'macd':
                    required.add('macd');
                    required.add('emaForMacdFast');
                    required.add('emaForMacdSlow');
                    break;
                case 'ema':
                    required.add('ema');
                    required.add('emaFast');
                    required.add('emaSlow');
                    break;
                case 'ma200':
                    required.add('ma200');
                    required.add('maFastForGoldenCross');
                    required.add('ma100');
                    break;
                case 'ma':
                    required.add('ma');
                    break;
                case 'sma': // NEW: Add SMA signal
                    required.add('sma');
                    break;
                case 'tema':
                    required.add('tema');
                    if (signalSettings[signalKey]?.useCrossover) {
                        required.add('tema_fast');
                        required.add('tema_slow');
                    } else {
                        required.add('tema_10'); // This seems like an old placeholder, kept for compatibility
                    }
                    break;
                case 'dema':
                    required.add('dema');
                    if (signalSettings[signalKey]?.useCrossover) {
                        required.add('dema_fast');
                        required.add('dema_slow');
                    }
                    break;
                case 'hma':
                    required.add('hma');
                    if (signalSettings[signalKey]?.useCrossover) {
                        required.add('hma_fast');
                        required.add('hma_slow');
                    }
                    break;
                case 'wma':
                    required.add('wma');
                    if (signalSettings[signalKey]?.useCrossover) {
                        required.add('wma_fast');
                        required.add('wma_slow');
                    }
                    break;
                case 'maribbon':
                    required.add('maribbon');
                    required.add('ma10');
                    required.add('ma20');
                    required.add('ma30');
                    required.add('ma40');
                    required.add('ma50');
                    required.add('ma60');
                    break;
                case 'adx':
                    required.add('adx');
                    break;
                case 'psar':
                    required.add('psar');
                    required.add('volume_sma'); // Renamed from volumeSMA for consistency
                    required.add('bbw');
                    required.add('psar_mtf'); // This is likely a placeholder/future feature
                    break;
                case 'ichimoku':
                    required.add('ichimoku');
                    break;
                case 'kama':
                    required.add('kama');
                    break;
                case 'trendexhaustion':
                    required.add('trendExhaustion');
                    break;
                case 'rsi':
                    required.add('rsi');
                    break;
                case 'stochastic':
                    required.add('stochastic');
                    break;
                case 'williamsr':
                    required.add('williamsr');
                    break;
                case 'cci':
                    required.add('cci');
                    break;
                case 'roc':
                    required.add('roc');
                    break;
                case 'awesomeoscillator':
                    required.add('awesomeoscillator');
                    break;
                case 'cmo':
                    required.add('cmo');
                    break;
                case 'bollinger':
                    required.add('bollinger');
                    break;
                case 'atr':
                    required.add('atr');
                    required.add('atrSma');
                    required.add('normalizedAtr');
                    required.add('atrStates');
                    break;
                case 'bbw':
                    required.add('bbw');
                    required.add('volatilityRegime');
                    required.add('squeeze');
                    required.add('volatilityClustering');
                    required.add('bbwStates');
                    break;
                case 'keltner':
                    required.add('keltner');
                    break;
                case 'ttm_squeeze':
                    required.add('bollinger');
                    required.add('keltner');
                    required.add('awesomeoscillator');
                    required.add('ttm_squeeze');
                    break;
                case 'donchian':
                    required.add('donchian');
                    required.add('donchianWidthSma');
                    break;
                case 'volume':
                    required.add('volume_sma'); // Renamed from volumeSMA for consistency
                    required.add('smartMoneyFlow');
                    required.add('volumeClimax');
                    required.add('volumeSpread');
                    required.add('volume_roc');
                    required.add('relativeVolumeStates');
                    required.add('volumeRocStates');
                    break;
                case 'volume_sma': // NEW: Explicit volume_sma signal
                    required.add('volume_sma');
                    break;
                case 'mfi':
                    required.add('mfi');
                    break;
                case 'obv':
                    required.add('obv');
                    required.add('obvSmaShort');
                    required.add('obvSmaLong');
                    required.add('obvTrendStates');
                    required.add('obvDivergence');
                    break;
                case 'cmf':
                    required.add('cmf');
                    break;
                case 'adline':
                    required.add('adline');
                    required.add('adlSma');
                    break;
                case 'pivot':
                    required.add('pivots');
                    break;
                case 'fibonacci':
                    required.add('fibonacci');
                    break;
                case 'supportresistance':
                    required.add('supportresistance');
                    break;
                case 'chartpattern':
                    required.add('chartpattern');
                    break;
                case 'candlestick':
                    required.add('candlestickPatterns');
                    break;
                default:
                    break;
            }
        }
    }
    return required;
};

/**
 * Creates a normalized signal lookup object from various signalSettings formats.
 * @param {Array|Object} signalSettings - The signal settings.
 * @returns {Object} A lookup object with lowercase signal keys.
 */
const createSignalLookup = (signalSettings) => {
    const signalLookup = {};
    // Normalize signal type names (e.g., TTMSqueeze -> ttm_squeeze)
    const normalizeSignalType = (type) => {
        if (!type || typeof type !== 'string') return type;
        const normalized = type.toLowerCase().trim();
        // Map ALL TTM Squeeze variations to standard name
        // Handle: TTMSqueeze, TTM_Squeeze, ttm_squeeze, ttmsqueeze, TTM-Squeeze, etc.
        if (normalized === 'ttmsqueeze' || normalized === 'ttm_squeeze' || normalized === 'ttm-squeeze') {
            if (normalized !== 'ttm_squeeze') {
                //console.log(`[SIGNAL_LOOKUP] 🔄 Normalizing "${type}" → "ttm_squeeze"`);
            }
            return 'ttm_squeeze';
        }
        return normalized;
    };
    
    if (Array.isArray(signalSettings)) {
        //console.log(`[SIGNAL_LOOKUP] 📋 Processing array of ${signalSettings.length} signals`);
        signalSettings.forEach((signal, idx) => {
            if (typeof signal === 'string') {
                const normalizedType = normalizeSignalType(signal);
                signalLookup[normalizedType] = true;
                if (signal.toLowerCase().includes('squeeze') || signal.toLowerCase().includes('ttm')) {
                    //console.log(`[SIGNAL_LOOKUP] ✅ Added string signal [${idx}]: "${signal}" → "${normalizedType}"`);
                }
            } else if (signal && typeof signal === 'object' && signal.type) {
                const normalizedType = normalizeSignalType(signal.type);
                signalLookup[normalizedType] = signal.parameters || {};
                if (signal.type.toLowerCase().includes('squeeze') || signal.type.toLowerCase().includes('ttm')) {
                    //console.log(`[SIGNAL_LOOKUP] ✅ Added object signal [${idx}]: type="${signal.type}" → "${normalizedType}", value="${signal.value || 'N/A'}"`);
                }
            }
        });
    } else if (typeof signalSettings === 'object' && signalSettings !== null) {
        //console.log(`[SIGNAL_LOOKUP] 📋 Processing object with ${Object.keys(signalSettings).length} keys`);
        for (const key in signalSettings) {
            if (Object.prototype.hasOwnProperty.call(signalSettings, key)) {
                const normalizedType = normalizeSignalType(key);
                signalLookup[normalizedType] = signalSettings[key];
                if (key.toLowerCase().includes('squeeze') || key.toLowerCase().includes('ttm')) {
                    //console.log(`[SIGNAL_LOOKUP] ✅ Added object key: "${key}" → "${normalizedType}"`);
                }
            }
        }
    }
    
    if (signalLookup.ttm_squeeze) {
        //console.log(`[SIGNAL_LOOKUP] ✅✅✅ TTM_SQUEEZE FOUND IN LOOKUP! ✅✅✅`);
        //console.log(`[SIGNAL_LOOKUP] ttm_squeeze value:`, signalLookup.ttm_squeeze);
    } else {
        //console.log(`[SIGNAL_LOOKUP] ❌❌❌ TTM_SQUEEZE NOT FOUND IN LOOKUP ❌❌❌`);
        //console.log(`[SIGNAL_LOOKUP] Available keys:`, Object.keys(signalLookup));
    }
    
    return signalLookup;
};

// Core calculation orchestration
export function calculateAllIndicators(klines, signals = [], logFunction = console.log) {
  const enabledFlags = {};
  // Normalize signal settings: turn array of strings/objects into a map of { signalKey: settings_object | boolean }
  const localSignalSettings = Array.isArray(signals) ? signals.reduce((acc, s) => ({ ...acc, [s.type || s]: s.enabled !== false ? (s.parameters || true) : false }), {}) : signals;

  for (const key in localSignalSettings) {
      const setting = localSignalSettings[key];
      enabledFlags[key] = typeof setting === 'object' ? !!setting.enabled : !!setting; // Check 'enabled' prop if it's an object, otherwise treat as boolean
  }

  // Enhanced safeCalculate with consistent logging
  const logMessage = (message, level = 'debug', error = null) => {
      const isDebugOrInfo = level === 'debug' || level === 'info';
      const shouldLogDebug = isDebugOrInfo && imDebugCount < IM_DEBUG_MAX; // Only allow debug/info if under limit

      if (!shouldLogDebug && level !== 'error') { // Only errors bypass the debug limit entirely
          return;
      }

      if (logFunction) {
          const prefix = `[INDICATOR_MANAGER]`;
          // Add debug prefix only for limited debug logs
          const debugPrefix = shouldLogDebug ? `[components/utils/indicatorManager.js] [IM_DEBUG] ` : '';

          if (level === 'error' && error) {
              logFunction(`${debugPrefix}${prefix} ${message}`, error);
          } else {
              logFunction(`${debugPrefix}${prefix} ${message}`);
          }
      }
  };

  //logMessage('[atr_debug] ===== calculateAllIndicators CALLED =====', 'debug');
  //logMessage(`[atr_debug] Kline data length: ${klines?.length || 0}`, 'debug');
  //logMessage(`[atr_debug] Signal settings received: ${JSON.stringify(signals)}`, 'debug');

  if (!Array.isArray(klines) || klines.length === 0) {
    logMessage('[atr_debug] ⚠️ No kline data provided to calculateAllIndicators. Returning empty result.', 'debug', new Error('Empty or invalid kline data'));
    return { data: [] };
  }

  const indicators = { data: klines };
  const signalLookup = createSignalLookup(localSignalSettings); // Use localSignalSettings for createSignalLookup
  //logMessage(`[atr_debug] Processed signal lookup keys: ${Object.keys(signalLookup).join(', ')}`, 'debug');

  // Data extraction (for indicators that specifically operate on arrays of numbers)
  const closes = klines.map(d => d.close);
  const highs = klines.map(d => d.high);
  const lows = klines.map(d => d.low);
  const volumes = klines.map(d => d.volume);


  const safeCalculate = (name, calcFunc, ...args) => {
    if (typeof calcFunc !== 'function') {
        return null;
    }
    try {
        const result = calcFunc(...args);
        return result;
    } catch (error) {
        logMessage(`CRITICAL ERROR calculating '${name}': ${error.message}. Skipping this indicator.`, 'error', error);
        return null;
    }
  };

  // --- PRE-CALCULATIONS ---
  // EMAs for various purposes (general, MACD)
  if (signalLookup.ema) {
    const s = signalLookup.ema;
    indicators.ema = safeCalculate('EMA', calculateEMA, klines, s?.period || defaultSignalSettings.ema.period);
    indicators.emaFast = safeCalculate('EMA (Fast)', calculateEMA, klines, s?.fastPeriod || defaultSignalSettings.ema.fastPeriod);
    indicators.emaSlow = safeCalculate('EMA (Slow)', calculateEMA, klines, s?.slowPeriod || defaultSignalSettings.ema.slowPeriod);
  }
  if (signalLookup.macd) {
    const s = signalLookup.macd;
    indicators.emaForMacdFast = safeCalculate('EMA (MACD Fast)', calculateEMA, klines, s?.fastPeriod || defaultSignalSettings.macd.fastPeriod);
    indicators.emaForMacdSlow = safeCalculate('EMA (MACD Slow)', calculateEMA, klines, s?.slowPeriod || defaultSignalSettings.macd.slowPeriod);
  }

  // Simple Moving Averages (MA, MA200, MA Ribbon components, SMA)
  if (signalLookup.ma200 || signalLookup.maribbon) {
    indicators.ma200 = safeCalculate('MA200', calculateMA, klines, signalLookup.ma200?.period || defaultSignalSettings.ma200.period);
    indicators.maFastForGoldenCross = safeCalculate('MA (Golden Cross)', calculateMA, klines, 50); // Hardcoded period
    indicators.ma100 = safeCalculate('MA100', calculateMA, klines, 100); // Hardcoded period
    indicators.ma10 = safeCalculate('MA10', calculateMA, klines, 10); // For ribbon or general use
    indicators.ma20 = safeCalculate('MA20', calculateMA, klines, 20); // For ribbon or general use
    indicators.ma30 = safeCalculate('MA30', calculateMA, klines, 30); // For ribbon or general use
    indicators.ma40 = safeCalculate('MA40', calculateMA, klines, 40); // For ribbon or general use
    indicators.ma50 = safeCalculate('MA50', calculateMA, klines, 50); // For ribbon or general use
    indicators.ma60 = safeCalculate('MA60', calculateMA, klines, 60); // For ribbon or general use
  }
  if (signalLookup.ma) { // General MA
    const s = signalLookup.ma;
    indicators.ma = safeCalculate('MA (Default)', calculateMA, klines, s?.period || defaultSignalSettings.ma.period);
  }
  if (signalLookup.sma) { // NEW: SMA calculation using calculateMA
    const s = signalLookup.sma;
    indicators.sma = safeCalculate('SMA', calculateMA, klines, s?.period || defaultSignalSettings.sma.period);
  }

  // Volume SMA (used by PSAR and general volume analysis)
  if (signalLookup.volume || signalLookup.volume_sma || signalLookup.psar) {
      const s = signalLookup.volume_sma || signalLookup.volume || {}; // Prioritize specific volume_sma setting
      indicators.volume_sma = safeCalculate('Volume SMA', calculateVolumeMA, klines, s?.period || defaultSignalSettings.volume_sma.period);
  }

  // --- TREND INDICATORS ---
  if (signalLookup.macd && indicators.emaForMacdFast && indicators.emaForMacdSlow) {
    const s = signalLookup.macd;
    indicators.macd = safeCalculate('MACD', calculateMACD, indicators.emaForMacdFast, indicators.emaForMacdSlow, s?.signalPeriod || defaultSignalSettings.macd.signalPeriod);
  }
  if (signalLookup.adx) {
    const s = signalLookup.adx;
    indicators.adx = safeCalculate('ADX', calculateADX, klines, s?.period || defaultSignalSettings.adx.period);
  }
  if (signalLookup.psar) {
    const s = signalLookup.psar;
    const afStart = s?.afStart || defaultSignalSettings.psar.afStart;
    const afIncrement = s?.afIncrement || defaultSignalSettings.psar.afIncrement;
    const afMax = s?.afMax || defaultSignalSettings.psar.afMax;
    indicators.psar = safeCalculate('PSAR', calculatePSAR, klines, afStart, afIncrement, afMax);
  }
  if (signalLookup.ichimoku) {
    indicators.ichimoku = safeCalculate('Ichimoku', calculateIchimoku, klines, signalLookup.ichimoku);
  }

  // --- MOMENTUM INDICATORS ---
  if (signalLookup.rsi) {
    const s = signalLookup.rsi;
    indicators.rsi = safeCalculate('RSI', calculateRSI, closes, s?.period || defaultSignalSettings.rsi.period);
  }
  if (signalLookup.stochastic) {
    const s = signalLookup.stochastic;
    indicators.stochastic = safeCalculate('Stochastic', calculateStochastic, klines, s?.kPeriod || defaultSignalSettings.stochastic.kPeriod, s?.dPeriod || defaultSignalSettings.stochastic.dPeriod);
  }
  if (signalLookup.williamsr) {
    const s = signalLookup.williamsr;
    indicators.williamsr = safeCalculate('Williams %R', calculateWilliamsR, klines, s?.period || defaultSignalSettings.williamsr.period);
  }
  if (signalLookup.cci) {
    const s = signalLookup.cci;
    indicators.cci = safeCalculate('CCI', calculateCCI, klines, s?.period || defaultSignalSettings.cci.period);
  }
  if (signalLookup.roc) {
    const s = signalLookup.roc;
    indicators.roc = safeCalculate('ROC', calculateROC, closes, s?.period || defaultSignalSettings.roc.period);
  }
  if (signalLookup.awesomeoscillator) {
    indicators.awesomeoscillator = safeCalculate('Awesome Oscillator', calculateAwesomeOscillator, klines);
  }
  if (signalLookup.cmo) {
    const s = signalLookup.cmo;
    indicators.cmo = safeCalculate('CMO', calculateCMO, closes, s?.period || defaultSignalSettings.cmo.period);
  }

  // --- VOLATILITY INDICATORS ---
  if (signalLookup.bollinger) {
    const s = signalLookup.bollinger;
    indicators.bollinger = safeCalculate('Bollinger Bands', calculateBollingerBands, klines, s?.period || defaultSignalSettings.bollinger.period, s?.stdDev || defaultSignalSettings.bollinger.stdDev);
  }
  // ATR calculation block with enhanced logging
  if (signalLookup.atr || Object.keys(signalLookup).length > 0) { // ATR is often a dependency, so calculate if any signals are present
    logMessage('[atr_debug] ===== CALCULATING ATR (or dependency) =====', 'debug');
    const s = signalLookup.atr || {}; // Access specific ATR settings or an empty object if not explicitly defined
    const period = s?.period || defaultSignalSettings.atr.period;

    logMessage(`[atr_debug] ATR signal config (effective): ${JSON.stringify(s)}`, 'debug');
    logMessage(`[atr_debug] ATR period: ${period}`, 'debug');
    logMessage(`[atr_debug] Kline data length for ATR: ${klines.length}`, 'debug');
    logMessage(`[atr_debug] Minimum required kline data for ATR calculation: ${period}`, 'debug');
    
    if (klines.length < period) {
        logMessage('[atr_debug] ⚠️ INSUFFICIENT KLINE DATA for ATR calculation (klines length < period)', 'debug');
    }

    logMessage('[atr_debug] Attempting ATR calculation...', 'debug');
    
    // Calculate expected evaluation index (used in signal evaluation)
    const expectedEvaluationIndex = klines.length - 2;
    logMessage(`[atr_debug] Expected evaluation index (klines.length - 2): ${expectedEvaluationIndex}`, 'debug');
    logMessage(`[atr_debug] Expected ATR index for evaluation: ${expectedEvaluationIndex >= (period - 1) ? (expectedEvaluationIndex - (period - 1)) : 'N/A (too early)'}`, 'debug');
    
    indicators.atr = safeCalculate('ATR', unifiedCalculateATR, klines, period);

    // Enhanced diagnostic logging
    const len = indicators.atr?.length || 0;
    const nonNull = indicators.atr ? indicators.atr.filter((v) => v !== null && v !== undefined).length : 0;
    const lastValid = indicators.atr ? [...indicators.atr].reverse().find((v) => v !== null && v !== undefined) : null;
    const firstValid = indicators.atr ? indicators.atr.find((v) => v !== null && v !== undefined) : null;
    const lastValidIndex = indicators.atr ? indicators.atr.length - 1 - [...indicators.atr].reverse().findIndex((v) => v !== null && v !== undefined) : -1;
    
    logMessage(`[atr_debug] ATR result: len=${len}, nonNull=${nonNull}, first=${firstValid}, last=${lastValid} (at index ${lastValidIndex})`, 'debug');
    logMessage(`[atr_debug] Length comparison: klines.length=${klines.length}, atr.length=${len}, gap=${klines.length - len}`, 'debug');
    logMessage(`[atr_debug] Evaluation index check: evaluationIndex=${expectedEvaluationIndex}, atr.length=${len}, willAccess=${expectedEvaluationIndex < len ? 'YES' : `NO (need fallback to index ${lastValidIndex})`}`, 'debug');
    logMessage('[atr_debug] ATR calculation complete (if successful).', 'debug');

    if (indicators.atr?.length > 0) {
      indicators.atrSma = safeCalculate('ATR SMA', calculateMA, indicators.atr.map(v => ({ close: v || 0 })), 21);
      // Calculate normalized ATR for percentile-based volatility analysis
      if (enabledFlags.atr || signalLookup.atr) { // Check if ATR was explicitly enabled or requested by signalLookup
          indicators.normalizedAtr = safeCalculate('normalizedAtr', calculateNormalizedATR, indicators.atr, klines);
      } else {
          logMessage('[atr_debug] Skipping normalizedAtr calculation as ATR was not explicitly enabled or requested.', 'debug');
      }
      if (indicators.normalizedAtr?.length > 0) {
          indicators.atrStates = safeCalculate('ATR States', evaluateVolatilityStates, indicators.normalizedAtr, s?.volatilityLookback || defaultSignalSettings.atr.volatilityLookback);
      } else {
          logMessage('[atr_debug] Skipping atrStates calculation due to empty or invalid normalizedAtr.', 'debug');
      }
    } else {
        logMessage('[atr_debug] ⚠️ ATR calculation resulted in empty or invalid data, skipping dependent calculations.', 'debug');
    }
  } else {
      logMessage('[atr_debug] ⚠️ ATR signal not explicitly enabled/requested, and no general dependency requiring calculation.', 'debug');
  }
  if (signalLookup.bbw || signalLookup.psar) { // BBW can be standalone or dependency for PSAR
    const s = signalLookup.bbw;
    indicators.bbw = safeCalculate('Bollinger Band Width', calculateBBW, klines);
    if (indicators.bbw) {
        indicators.volatilityRegime = indicators.bbw.map(val => val < 0.05 ? 'low' : (val > 0.15 ? 'high' : 'medium'));
        indicators.squeeze = indicators.bbw.map(val => ({
            squeeze_on: val < 0.02,
            squeeze_off: val >= 0.02
        }));
        indicators.volatilityClustering = safeCalculate('Volatility Clustering', calculateMA, indicators.bbw.map(v => ({ close: v || 0 })), 5);
        if (indicators.bbw.length > 0) {
            indicators.bbwStates = safeCalculate('BBW States', evaluateBBWStates, indicators.bbw, s?.volatilityLookback || defaultSignalSettings.bbw.volatilityLookback);
        }
    }
  }
  if (signalLookup.keltner || signalLookup.ttm_squeeze) {
    const s = signalLookup.keltner || signalLookup.ttm_squeeze; // TTM squeeze might provide Keltner settings
    indicators.keltner = safeCalculate('Keltner Channels', calculateKeltnerChannels, klines, s?.keltnerPeriod || defaultSignalSettings.keltner.keltnerPeriod, s?.atrPeriod || defaultSignalSettings.keltner.atrPeriod, s?.kcMultiplier || defaultSignalSettings.keltner.kcMultiplier);
  }
  if (signalLookup.ttm_squeeze) {
    // TTM Squeeze logic requires other indicators, handled within its own block for clarity
    // CRITICAL: Ensure dependencies are calculated even if not explicitly requested
    if (!indicators.bollinger) {
        const s = signalLookup.bollinger || {};
        indicators.bollinger = safeCalculate('Bollinger Bands (TTM Dep)', calculateBollingerBands, klines, s?.period || defaultSignalSettings.bollinger.period, s?.stdDev || defaultSignalSettings.bollinger.stdDev);
    }
    if (!indicators.keltner) {
        const s = signalLookup.keltner || {};
        indicators.keltner = safeCalculate('Keltner Channels (TTM Dep)', calculateKeltnerChannels, klines, s?.keltnerPeriod || defaultSignalSettings.keltner.keltnerPeriod, s?.atrPeriod || defaultSignalSettings.keltner.atrPeriod, s?.kcMultiplier || defaultSignalSettings.keltner.kcMultiplier);
    }
    if (!indicators.awesomeoscillator) {
        indicators.awesomeoscillator = safeCalculate('Awesome Oscillator (TTM Dep)', calculateAwesomeOscillator, klines);
    }
    
    // Now calculate TTM Squeeze if we have the required dependencies
    if (indicators.bollinger && indicators.keltner) {
        indicators.ttm_squeeze = safeCalculate('TTM Squeeze', () => {
            // Implement proper TTM Squeeze logic
            const ttmSqueezeData = [];
            
            for (let i = 0; i < klines.length; i++) {
                if (i < 20) { // Need enough data for BB and KC
                    ttmSqueezeData.push({ isSqueeze: false, momentum: 0 });
                    continue;
                }
                
                // Get Bollinger Bands and Keltner Channels for current period
                const bbUpper = indicators.bollinger?.[i]?.upper;
                const bbLower = indicators.bollinger?.[i]?.lower;
                const kcUpper = indicators.keltner?.[i]?.upper;
                const kcLower = indicators.keltner?.[i]?.lower;
                const ao = indicators.awesomeoscillator?.[i];
                
                if (!bbUpper || !bbLower || !kcUpper || !kcLower || ao === undefined) {
                    ttmSqueezeData.push({ isSqueeze: false, momentum: 0 });
                    continue;
                }
                
                // TTM Squeeze logic: BB is inside KC (squeeze condition)
                const isSqueeze = bbUpper < kcUpper && bbLower > kcLower;
                
                // Momentum: Use Awesome Oscillator for momentum direction
                const momentum = ao > 0 ? 1 : (ao < 0 ? -1 : 0);
                
                ttmSqueezeData.push({ isSqueeze, momentum });
            }
            
            return ttmSqueezeData;
        });
    } else {
        // Log error only if dependencies still missing after attempt to calculate
        logMessage(`[TTM_SQUEEZE_CALC] ⚠️ Cannot calculate TTM Squeeze: hasBollinger=${!!indicators.bollinger}, hasKeltner=${!!indicators.keltner}`, 'warning');
    }
  }
  if (signalLookup.donchian) {
    const s = signalLookup.donchian;
    indicators.donchian = safeCalculate('Donchian Channels', calculateDonchian, klines, s?.period || defaultSignalSettings.donchian.period);
  }

  // --- VOLUME INDICATORS ---
  indicators.volume = volumes; // Raw volume data
  if (signalLookup.obv) {
    const s = signalLookup.obv;
    indicators.obv = safeCalculate('OBV', calculateOBV, klines);
    if (indicators.obv?.length > 0) {
      indicators.obvSmaShort = safeCalculate('OBV SMA Short', calculateMA, indicators.obv.map(v => ({ close: v || 0 })), s?.shortPeriod || defaultSignalSettings.obv.shortPeriod);
      indicators.obvSmaLong = safeCalculate('OBV SMA Long', calculateMA, indicators.obv.map(v => ({ close: v || 0 })), s?.longPeriod || defaultSignalSettings.obv.longPeriod);
    }
  }
  if (signalLookup.cmf) {
    const s = signalLookup.cmf;
    indicators.cmf = safeCalculate('CMF', calculateCMF, klines, s?.period || defaultSignalSettings.cmf.period);
  }
  if (signalLookup.volume || signalLookup.volume_roc) {
    const s = signalLookup.volume_roc || {};
    const rocPeriod = s?.period || defaultSignalSettings.volume_roc.period;
    indicators.volume_roc = indicators.volume.map((vol, i, arr) => {
        if (i < rocPeriod) return null;
        const pastVol = arr[i - rocPeriod];
        return pastVol ? ((vol - pastVol) / pastVol) * 100 : 0;
    });
  }
  if (signalLookup.mfi) {
    const s = signalLookup.mfi;
    indicators.mfi = safeCalculate('MFI', calculateMFI, klines, s?.period || defaultSignalSettings.mfi.period);
  }
  if (signalLookup.adline) {
    indicators.adline = safeCalculate('A/D Line', calculateADL, klines);
    if (indicators.adline?.length > 0) {
      indicators.adlSma = safeCalculate('A/D Line SMA', calculateMA, indicators.adline.map(v => ({ close: v || 0 })), 20); // Hardcoded period
    }
  }

  // --- DERIVED VOLUME STATES ---
  // Ensure volume_sma is available for this. It's calculated in PRE-CALCULATIONS.
  if (indicators.volume && indicators.volume_sma?.length > 0) {
      indicators.relativeVolumeStates = safeCalculate('RelativeVolumeStates', evaluateRelativeVolumeStates, indicators.volume, indicators.volume_sma);
  }
  if (indicators.obv?.length > 0) {
      indicators.obvTrendStates = safeCalculate('OBVTrendStates', evaluateOBVTrendStates, indicators.obv);
      indicators.obvDivergence = safeCalculate('OBVDivergence', evaluateOBVDivergence, klines, indicators.obv);
  }
  if (indicators.volume_roc?.length > 0) {
      indicators.volumeRocStates = safeCalculate('VolumeRocStates', evaluateVolumeRocStates, indicators.volume_roc);
  }

  // --- OTHERS ---
  if (signalLookup.tema) {
    const s = signalLookup.tema;
    indicators.tema = safeCalculate('TEMA', calculateTEMA, klines, s?.period || defaultSignalSettings.tema.period);
    if (s?.useCrossover) {
      indicators.tema_fast = safeCalculate('TEMA Fast', calculateTEMA, klines, s?.fastPeriod || defaultSignalSettings.tema.fastPeriod);
      indicators.tema_slow = safeCalculate('TEMA Slow', calculateTEMA, klines, s?.slowPeriod || defaultSignalSettings.tema.slowPeriod);
    }
  }
  if (signalLookup.dema) {
    const s = signalLookup.dema;
    indicators.dema = safeCalculate('DEMA', calculateDEMA, klines, s?.period || defaultSignalSettings.dema.period);
    if (s?.useCrossover) {
      indicators.dema_fast = safeCalculate('DEMA Fast', calculateDEMA, klines, s?.fastPeriod || defaultSignalSettings.dema.fastPeriod);
      indicators.dema_slow = safeCalculate('DEMA Slow', calculateDEMA, klines, s?.slowPeriod || defaultSignalSettings.dema.slowPeriod);
    }
  }
  if (signalLookup.hma) {
      const s = signalLookup.hma;
      indicators.hma = safeCalculate('HMA', calculateHMA, klines, s?.period || defaultSignalSettings.hma.period);
      if (s?.useCrossover) {
          indicators.hma_fast = safeCalculate('HMA Fast', calculateHMA, klines, s?.fastPeriod || defaultSignalSettings.hma.fastPeriod);
          indicators.hma_slow = safeCalculate('HMA Slow', calculateHMA, klines, s?.slowPeriod || defaultSignalSettings.hma.slowPeriod);
      }
  }
  if (signalLookup.wma) {
      const s = signalLookup.wma;
      indicators.wma = safeCalculate('WMA', calculateWMA, klines, s?.period || defaultSignalSettings.wma.period);
      if (s?.useCrossover) {
          indicators.wma_fast = safeCalculate('WMA Fast', calculateWMA, klines, s?.fastPeriod || defaultSignalSettings.wma.fastPeriod);
          indicators.wma_slow = safeCalculate('WMA Slow', calculateWMA, klines, s?.slowPeriod || defaultSignalSettings.wma.slowPeriod);
      }
  }
  if (signalLookup.maribbon) {
    indicators.maribbon = safeCalculate('MA Ribbon', calculateMARibbon, klines);
  }
  if (signalLookup.kama) {
    const s = signalLookup.kama;
    indicators.kama = safeCalculate('KAMA', calculateKAMA, klines, s?.period || defaultSignalSettings.kama.period);
  }
  if (signalLookup.trendexhaustion) {
    indicators.trendExhaustion = safeCalculate('Trend Exhaustion', detectTrendExhaustion, klines);
  }
  // CRITICAL FIX: Always calculate pivots when ANY signals are requested
  // This is because evaluateSignalCondition ALWAYS evaluates pivot signals regardless of strategy definition
  // Pivots are also required for: fibonacci, support/resistance, and keltner signals
  // Since auto-scanner evaluates ALL signals (including pivot) regardless of strategy signal definitions,
  // we must always calculate pivots to prevent "hasPivots=false" errors in signal evaluation
  const needsPivots = signalLookup.pivot || signalLookup.fibonacci || signalLookup.supportresistance || signalLookup.keltner;
  const hasAnySignals = Object.keys(signalLookup).length > 0;
  
  // Calculate pivots if:
  // 1. Explicitly requested (pivot, fibonacci, support/resistance, keltner)
  // 2. OR if any signals are provided (auto-scanner context where all signals are evaluated)
  if (needsPivots || hasAnySignals) {
    //console.log(`[INDICATOR_MANAGER] Calculating pivots: pivot=${!!signalLookup.pivot}, fibonacci=${!!signalLookup.fibonacci}, supportresistance=${!!signalLookup.supportresistance}, keltner=${!!signalLookup.keltner}, hasAnySignals=${hasAnySignals}`);
    indicators.pivots = safeCalculate('Pivot Points', calculatePivotPoints, klines);
    //console.log(`[INDICATOR_MANAGER] Pivot calculation result: hasPivots=${!!indicators.pivots}, type=${typeof indicators.pivots}, length=${indicators.pivots?.length || 'N/A'}, isArray=${Array.isArray(indicators.pivots)}`);
    if (indicators.pivots && Array.isArray(indicators.pivots) && indicators.pivots.length > 48) {
      const sample48 = indicators.pivots[48];
      //console.log(`[INDICATOR_MANAGER] Sample[48]: isNull=${sample48 === null}, isUndefined=${sample48 === undefined}, type=${typeof sample48}, isObject=${typeof sample48 === 'object' && sample48 !== null}`);
      if (sample48 && typeof sample48 === 'object') {
        //console.log(`[INDICATOR_MANAGER] Sample[48] keys: ${Object.keys(sample48).join(', ')}`);
      }
    }
  } else {
    console.log(`[INDICATOR_MANAGER] ⚠️ Pivot NOT calculated: no signals provided`);
  }
  
  // Create onLog callback from logFunction for SR and Fibonacci diagnostics
  // Check if logFunction is an onLog-style callback (message, level) or a console.log-style (message)
  const createOnLog = () => {
    if (!logFunction || logFunction === console.log) return null;
    
    // Check if logFunction accepts 2 parameters (onLog style: message, level)
    // If it does, use it directly; otherwise return null (will use console.log in calculation functions)
    if (logFunction.length >= 2) {
      // onLog-style callback (message, level) - use it directly
      return (message, level = 'debug') => {
        logFunction(message, level);
      };
    }
    
    // For console.log-style callbacks, route through logMessage
    return (message, level = 'debug') => {
      if (level === 'error') {
        logMessage(message, 'error');
      } else if (level === 'warn' || level === 'warning') {
        logMessage(message, 'warning');
      } else {
        logMessage(message, 'debug');
      }
    };
  };
  const onLogCallback = createOnLog();

  if (signalLookup.fibonacci) {
    const s = signalLookup.fibonacci;
    const lookback = s?.lookback || defaultSignalSettings.fibonacci.lookback || 100;
    const minSwingPercent = s?.minSwingPercent || 1.5; // Reduced from 3.0% to 1.5% for shorter timeframes
    indicators.fibonacci = safeCalculate('Fibonacci Retracements', calculateFibonacciRetracements, klines, lookback, minSwingPercent, onLogCallback);
  }
  
  // CRITICAL: Always calculate supportresistance when ANY signals are requested
  // This is needed for entry quality metrics (entry_near_support, entry_near_resistance, etc.)
  // Similar to how pivots are always calculated
  const hasAnySignalsForSR = Object.keys(signalLookup).length > 0;
  if (signalLookup.supportresistance || hasAnySignalsForSR) {
    const s = signalLookup.supportresistance || {};
    indicators.supportresistance = safeCalculate('Support/Resistance', calculateSupportResistance, klines, s?.lookback || defaultSignalSettings.supportresistance.lookback, s?.tolerance || defaultSignalSettings.supportresistance.tolerance, onLogCallback);
  }
  if (signalLookup.chartpattern) {
    indicators.chartpattern = safeCalculate('Chart Patterns', detectChartPatterns, klines, { chartpattern: signalLookup.chartpattern });
    // Validate data structure (log errors only)
    if (indicators.chartpattern && indicators.chartpattern.length > 0) {
      const sampleIndex = Math.min(48, indicators.chartpattern.length - 1);
      const sample = indicators.chartpattern[sampleIndex];
      if (Array.isArray(sample)) {
        console.error(`[INDICATOR_MANAGER] ❌ Chart Patterns[${sampleIndex}] is an ARRAY, expected object with pattern flags`);
      }
    }
  }
  if (signalLookup.candlestick) {
    indicators.candlestickPatterns = safeCalculate('Candlestick Patterns', detectCandlestickPatterns, klines);
    // Validate data structure (log errors only)
    if (indicators.candlestickPatterns && indicators.candlestickPatterns.length > 0) {
      const sampleIndex = Math.min(48, indicators.candlestickPatterns.length - 1);
      const sample = indicators.candlestickPatterns[sampleIndex];
      if (Array.isArray(sample)) {
        console.error(`[INDICATOR_MANAGER] ❌ Candlestick Patterns[${sampleIndex}] is an ARRAY, expected object with readyForAnalysis`);
      }
    }
  }

  // Final debug log for indicator keys
  const keys = Object.keys(indicators);
  logMessage(`Indicator keys: ${keys.join(", ")} | hasATR=${!!indicators.atr}`, 'debug');

  logMessage('[atr_debug] ===== calculateAllIndicators COMPLETE =====', 'debug');
  logMessage(`[atr_debug] Calculated indicator keys: ${Object.keys(indicators).join(', ')}`, 'debug');

  // Increment per-call to keep total logs capped per scan
  imDebugCount++;

  return indicators;
};

// Export all calculation functions for individual use
export {
  // Trend
  calculateMACD,
  calculateTEMA,
  calculateDEMA,
  calculateHMA,
  calculateMARibbon,
  calculateADX,
  calculatePSAR,
  calculateIchimoku,
  calculateKAMA,
  detectTrendExhaustion,

  // Momentum
  calculateRSI,
  calculateStochastic,
  calculateWilliamsR,
  calculateCCI,
  calculateROC,
  calculateAwesomeOscillator,
  calculateCMO,

  // Volatility
  calculateBollingerBands,
  calculateBBW,
  calculateKeltnerChannels,
  calculateDonchian,
  detectVolatilityRegimeChange,
  detectBollingerSqueeze,
  detectSqueezeBreakout,
  detectVolatilityClustering,
  calculateStandardDeviation,
  calculateNormalizedATR,
  evaluateVolatilityStates,
  evaluateBBWStates,

  // Volume
  calculateVolumeMA, // This is what calculateVolumeSMA maps to
  calculateMFI,
  calculateOBV,
  calculateCMF,
  calculateADL,
  detectSmartMoneyFlow,
  detectVolumeClimax,
  analyzeVolumeSpread,
  calculateOBVWithDivergence,
  evaluateRelativeVolumeStates,
  evaluateOBVTrendStates,
  evaluateOBVDivergence,
  evaluateVolumeRocStates,

  // Pattern & S/R
  calculatePivotPoints,
  calculateFibonacciRetracements,
  calculateSupportResistance,
  detectCandlestickPatterns,
  detectChartPatterns,

  // Helpers
  calculateEMA,
  calculateMA, // This is what calculateSMA maps to
  calculateWMA
};

// Calculate weighted combined strength using unified calculator
function calculateWeightedCombinedStrength(matchedSignals, marketRegime = 'neutral', regimeConfidence = 0.5) {
    // Use unified calculator for consistency
    const result = calculateUnifiedCombinedStrength(matchedSignals, {
        marketRegime: marketRegime,
        regimeConfidence: regimeConfidence,
        useAdvancedFeatures: true,
        useSimpleRegimeMultiplier: false
    });
    
    // Return both strength and breakdown for analytics
    return {
        totalStrength: result.totalStrength,
        breakdown: result.breakdown
    };
}

// Evaluate signal conditions for a strategy
export const evaluateSignalConditions = (strategy, indicators, klinesForEval, marketRegime = null) => {
  try {
    if (!strategy || !strategy.signals || !indicators) {
      return {
        isMatch: false,
        combinedStrength: 0,
        matchedSignals: [],
        error: 'Missing required parameters'
      };
    }

    const matchedSignals = [];
    let totalStrength = 0;
    let signalCount = 0;

    // Check each signal in the strategy
    for (const signalName of Object.keys(strategy.signals)) {
      const signalConfig = strategy.signals[signalName];
      
      if (!signalConfig || !signalConfig.enabled) {
        continue;
      }

      // Get the signal value from indicators
      const signalValue = indicators[signalName];
      
      if (signalValue === undefined || signalValue === null) {
        continue;
      }

      // Check if signal condition is met
      let isMatch = false;
      let strength = 0;

      // Basic signal evaluation logic
      if (typeof signalValue === 'object' && signalValue.value !== undefined) {
        strength = signalValue.value;
        isMatch = signalValue.value >= (signalConfig.threshold || 50);
      } else if (typeof signalValue === 'number') {
        strength = signalValue;
        isMatch = signalValue >= (signalConfig.threshold || 50);
      } else if (typeof signalValue === 'boolean') {
        strength = signalValue ? 75 : 0;
        isMatch = signalValue;
      }

      if (isMatch) {
        matchedSignals.push({
          type: signalName,
          name: signalName, // Keep both for compatibility
          strength: strength,
          config: signalConfig
        });
        totalStrength += strength;
        signalCount++;
      }
    }

    // Calculate weighted combined strength using the new system
    // Use actual market regime if provided, otherwise default to 'neutral'
    const regime = marketRegime?.regime || 'neutral';
    const regimeConfidence = marketRegime?.confidence || 0.5;
    const strengthResult = calculateWeightedCombinedStrength(matchedSignals, regime, regimeConfidence);
    const combinedStrength = typeof strengthResult === 'number' ? strengthResult : strengthResult.totalStrength;
    const strengthBreakdown = typeof strengthResult === 'object' && strengthResult.breakdown ? strengthResult.breakdown : null;
    const isMatch = signalCount >= (strategy.minSignals || 1) && combinedStrength >= (strategy.minStrength || 50);

    return {
      isMatch,
      strengthBreakdown: strengthBreakdown, // Include breakdown for analytics
      combinedStrength,
      matchedSignals,
      signalCount,
      totalStrength
    };

  } catch (error) {
    console.error('Error evaluating signal conditions:', error);
    return {
      isMatch: false,
      combinedStrength: 0,
      matchedSignals: [],
      error: error.message
    };
  }
};

// Default export for backward compatibility
export default {
  fetchKlineData,
  fetchMultiplePrices,
  formatKlineDataForChart,
  getAvailablePairs,
  getRequiredIndicators,
  calculateAllIndicators,
  evaluateSignalConditions,
  resetIndicatorManagerDebug, // Export the reset function
  // Include all calculation functions
  calculateMACD,
  calculateTEMA,
  calculateDEMA,
  calculateHMA,
  calculateMARibbon,
  calculateADX,
  calculatePSAR,
  calculateIchimoku,
  calculateKAMA,
  detectTrendExhaustion,
  calculateRSI,
  calculateStochastic,
  calculateWilliamsR,
  calculateCCI,
  calculateROC,
  calculateAwesomeOscillator,
  calculateCMO,
  calculateBollingerBands,
  calculateBBW,
  calculateKeltnerChannels,
  calculateDonchian,
  calculateATR: unifiedCalculateATR,
  detectVolatilityRegimeChange,
  detectSqueezeBreakout,
  detectVolatilityClustering,
  calculateStandardDeviation,
  calculateNormalizedATR,
  evaluateVolatilityStates,
  evaluateBBWStates,
  calculateVolumeMA,
  calculateMFI,
  calculateOBV,
  calculateCMF,
  calculateADL,
  detectSmartMoneyFlow,
  detectVolumeClimax,
  analyzeVolumeSpread,
  calculateOBVWithDivergence,
  evaluateRelativeVolumeStates,
  evaluateOBVTrendStates,
  evaluateOBVDivergence,
  evaluateVolumeRocStates,
  calculatePivotPoints,
  calculateFibonacciRetracements,
  calculateSupportResistance,
  detectCandlestickPatterns,
  detectChartPatterns,
  calculateEMA,
  calculateMA,
  calculateWMA
};
