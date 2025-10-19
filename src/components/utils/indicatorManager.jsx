
/**
 * Indicator Manager - Orchestrates all technical indicator calculations
 * and provides data fetching utilities
 */

// Import calculation functions
import { calculateMACD, calculateTEMA, calculateDEMA, calculateHMA, calculateMARibbon, calculateADX, calculatePSAR, calculateIchimoku, calculateKAMA, detectTrendExhaustion } from './indicator-calculations/trendIndicators';
import { calculateRSI, calculateStochastic, calculateWilliamsR, calculateCCI, calculateROC, calculateAwesomeOscillator, calculateCMO } from './indicator-calculations/momentumIndicators';
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
    fibonacci: {},
    supportresistance: { lookback: 50, tolerance: 0.01 },
    chartpattern: {},
    candlestick: {}
};

// Data fetching functions - NOW WRAPPERS AROUND APIMANAGER
export const fetchKlineData = async (symbol, interval, limit = 500, endTime = null) => {
  // Note: The new ApiManager doesn't support endTime yet, but we maintain the interface.
  // The core fetchKlineData function in ApiManager will handle retries and caching.
  return fetchKlineDataFromApi(symbol, interval, limit);
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

/**
 * Calculates the Average True Range (ATR) for a given set of kline data.
 * This function expects klineData in the formatted object format:
 * `{time, open, high, low, close, volume}`
 * @param {Array<Object>} klineData - Array of kline objects.
 * @param {number} period - The period for ATR calculation (default: 14).
 * @returns {Array<number|null>} An array of ATR values, padded with nulls at the start for insufficient data.
*/
export const calculateATR = (klineData, period = 14) => {
  // FIX: Handle both array-of-arrays and array-of-objects formats
  if (!klineData || klineData.length < period) {
    // Return an array of nulls for insufficient data, matching input length
    return Array(klineData ? klineData.length : 0).fill(null);
  }

  const trueRanges = [];
  for (let i = 0; i < klineData.length; i++) {
    // Universal data access for both array and object formats
    const high = parseFloat(Array.isArray(klineData[i]) ? klineData[i][2] : klineData[i].high);
    const low = parseFloat(Array.isArray(klineData[i]) ? klineData[i][3] : klineData[i].low);
    const close = i > 0 ? parseFloat(Array.isArray(klineData[i - 1]) ? klineData[i - 1][4] : klineData[i - 1].close) : null;

    // Check for NaN values which would break the calculation
    if (isNaN(high) || isNaN(low) || (i > 0 && close !== null && isNaN(close))) {
      trueRanges.push(0); // Push 0 if data is invalid to avoid breaking the loop
      continue;
    }

    const tr1 = high - low;
    const tr2 = close !== null ? Math.abs(high - close) : 0;
    const tr3 = close !== null ? Math.abs(low - close) : 0;

    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  const atrValues = [];
  if (trueRanges.length < period) return Array(klineData.length).fill(null);

  // Calculate initial ATR (Simple Moving Average of first 'period' True Ranges)
  let sumFirstTR = 0;
  for (let i = 0; i < period; i++) {
    sumFirstTR += trueRanges[i];
  }
  atrValues.push(sumFirstTR / period);

  // Calculate subsequent ATR values using Wilder's smoothing method
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = atrValues[atrValues.length - 1];
    const currentTR = trueRanges[i];
    const currentATR = (prevATR * (period - 1) + currentTR) / period;
    atrValues.push(currentATR);
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
    if (Array.isArray(signalSettings)) {
        signalSettings.forEach(signal => {
            if (typeof signal === 'string') {
                signalLookup[signal.toLowerCase()] = true;
            } else if (signal && typeof signal === 'object' && signal.type) {
                signalLookup[signal.type.toLowerCase()] = signal.parameters || {};
            }
        });
    } else if (typeof signalSettings === 'object' && signalSettings !== null) {
        for (const key in signalSettings) {
            if (Object.prototype.hasOwnProperty.call(signalSettings, key)) {
                signalLookup[key.toLowerCase()] = signalSettings[key];
            }
        }
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

  logMessage('[atr_debug] ===== calculateAllIndicators CALLED =====', 'debug');
  logMessage(`[atr_debug] Kline data length: ${klines?.length || 0}`, 'debug');
  logMessage(`[atr_debug] Signal settings received: ${JSON.stringify(signals)}`, 'debug');

  if (!Array.isArray(klines) || klines.length === 0) {
    logMessage('[atr_debug] ⚠️ No kline data provided to calculateAllIndicators. Returning empty result.', 'debug', new Error('Empty or invalid kline data'));
    return { data: [] };
  }

  const indicators = { data: klines };
  const signalLookup = createSignalLookup(localSignalSettings); // Use localSignalSettings for createSignalLookup
  logMessage(`[atr_debug] Processed signal lookup keys: ${Object.keys(signalLookup).join(', ')}`, 'debug');

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
    indicators.atr = safeCalculate('ATR', calculateATR, klines, period);

    // Existing debug log for ATR, now enhanced
    const len = indicators.atr?.length || 0;
    const nonNull = indicators.atr ? indicators.atr.filter((v) => v !== null && v !== undefined).length : 0;
    const lastValid = indicators.atr ? [...indicators.atr].reverse().find((v) => v !== null && v !== undefined) : null;
    logMessage(`[atr_debug] ATR result: len=${len}, nonNull=${nonNull}, last=${lastValid}`, 'debug');
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
        indicators.squeeze = indicators.bbw.map(val => val < 0.02);
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
    if (indicators.bollinger && indicators.keltner) {
        if (!indicators.awesomeoscillator) {
            indicators.awesomeoscillator = safeCalculate('Awesome Oscillator (TTM Dep)', calculateAwesomeOscillator, klines);
        }
        indicators.ttm_squeeze = safeCalculate('TTM Squeeze', () => {
            // This is a simplified placeholder for the actual TTM Squeeze logic
            // In a full implementation, this would actually combine BB and KC to detect squeezes and use AO for momentum
            return klines.map((_, i) => ({ isSqueeze: false, momentum: 0 }));
        });
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
  if (signalLookup.pivot) {
    indicators.pivots = safeCalculate('Pivot Points', calculatePivotPoints, klines);
  }
  if (signalLookup.fibonacci) {
    indicators.fibonacci = safeCalculate('Fibonacci Retracements', calculateFibonacciRetracements, klines);
  }
  if (signalLookup.supportresistance) {
    const s = signalLookup.supportresistance;
    indicators.supportresistance = safeCalculate('Support/Resistance', calculateSupportResistance, klines, s?.lookback || defaultSignalSettings.supportresistance.lookback, s?.tolerance || defaultSignalSettings.supportresistance.tolerance);
  }
  if (signalLookup.chartpattern) {
    indicators.chartpattern = safeCalculate('Chart Patterns', detectChartPatterns, klines, { chartpattern: signalLookup.chartpattern });
  }
  if (signalLookup.candlestick) {
    indicators.candlestickPatterns = safeCalculate('Candlestick Patterns', detectCandlestickPatterns, klines);
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

// Default export for backward compatibility
export default {
  fetchKlineData,
  fetchMultiplePrices,
  formatKlineDataForChart,
  getAvailablePairs,
  getRequiredIndicators,
  calculateAllIndicators,
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
  calculateATR,
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
