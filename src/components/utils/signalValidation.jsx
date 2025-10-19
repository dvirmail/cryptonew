
/**
 * Signal Name Validation and Migration Utilities
 * Ensures consistency across all signal naming conventions
 */

// Master list of canonical signal names - single source of truth
export const CANONICAL_SIGNAL_NAMES = {
  // Momentum Indicators
  'rsi': 'rsi',
  'stochastic': 'stochastic',
  'williamsR': 'williamsR',
  'cci': 'cci',
  'roc': 'roc',
  'awesomeOscillator': 'awesomeOscillator',  
  'cmo': 'cmo',
  
  // Trend Indicators
  'macd': 'macd',
  'ema': 'ema',
  'ma200': 'ma200',
  'ichimoku': 'ichimoku',
  'adx': 'adx',
  'psar': 'psar',
  'tema': 'tema',
  'dema': 'dema',
  'hma': 'hma',
  'wma': 'wma',
  'maRibbon': 'maRibbon', // New canonical name
  
  // Volatility Indicators
  'bollinger': 'bollinger',
  'atr': 'atr',
  'keltner': 'keltner',
  'bbw': 'bbw',
  'donchian': 'donchian',
  
  // Volume Indicators
  'volume': 'volume',
  'mfi': 'mfi',
  'obv': 'obv',
  'cmf': 'cmf',
  'adLine': 'adLine',
  
  // Pattern Recognition
  'candlestick': 'candlestick',
  'chartPatterns': 'chartPatterns',

  // Support/Resistance // New Category
  'pivot': 'pivot', // New canonical name
  'fibonacci': 'fibonacci', // New canonical name
  'supportResistance': 'supportResistance' // New canonical name
};

// Common incorrect/legacy names and their correct mappings
export const SIGNAL_NAME_MIGRATIONS = {
  // Underscore prefixed variants
  '_obv': 'obv',
  '_o_b_v': 'obv', 
  'O_b_v': 'obv', 
  'O_B_V': 'obv', 
  'on_balance_volume': 'obv',
  'onbalancevolume': 'obv', 
  '_adl': 'adLine',
  '_a_d_l': 'adLine',
  'A_D_L': 'adLine', 
  'accumulation_distribution': 'adLine',
  'accumulationdistribution': 'adLine', 
  '_cmf': 'cmf',
  '_c_m_f': 'cmf',
  'C_M_F': 'cmf', 
  'chaikin_money_flow': 'cmf',
  'chaikinmoneyflow': 'cmf', 
  '_bbw': 'bbw',
  '_b_b_w': 'bbw',
  '_roc': 'roc',
  '_r_o_c': 'roc',
  'R_O_C': 'roc', 
  'rate_of_change': 'roc',
  'rateofchange': 'roc', 
  '_cmo': 'cmo',
  '_c_m_o': 'cmo',
  'C_M_O': 'cmo', 
  'chande_momentum_oscillator': 'cmo',
  'chandemomentumoscillator': 'cmo', 
  '_atr': 'atr',
  '_a_t_r': 'atr',
  '_adx': 'adx',
  '_a_d_x': 'adx',
  '_psar': 'psar',
  '_p_s_a_r': 'psar',
  '_cci': 'cci',
  '_c_c_i': 'cci',
  '_mfi': 'mfi',
  '_m_f_i': 'mfi',
  '_rsi': 'rsi',
  '_r_s_i': 'rsi',
  '_macd': 'macd',
  '_m_a_c_d': 'macd',
  '_stochastic': 'stochastic',
  '_stoch': 'stochastic',
  '_williams': 'williamsR',
  '_williamsr': 'williamsR',
  '_williams_r': 'williamsR',
  
  // Awesome Oscillator variants
  '_ao': 'awesomeOscillator',
  '_a_o': 'awesomeOscillator',
  'ao': 'awesomeOscillator',
  
  // Moving Average variants
  '_dema': 'dema',
  '_d_e_m_a': 'dema',
  '_tema': 'tema',
  '_t_e_m_a': 'tema',
  '_hma': 'hma',
  '_h_m_a': 'hma',
  '_wma': 'wma',
  '_w_m_a': 'wma',
  '_ema': 'ema',
  '_e_m_a': 'ema',
  '_ma': 'ma200',
  '_m_a': 'ma200',
  '_ma200': 'ma200',
  '_m_a_2_0_0': 'ma200',
  'ma_ribbon': 'maRibbon', // Migration for new maRibbon
  'MA_Ribbon': 'maRibbon', // Migration for new maRibbon
  
  // Volatility indicators
  '_bollinger': 'bollinger',
  '_bb': 'bollinger',
  '_keltner': 'keltner',
  '_donchian': 'donchian',
  
  // Volume variants
  'volume_sma': 'volume',
  'volume_ma': 'volume',
  'volume_average': 'volume',
  'volume_spike': 'volume',
  'volume_analysis': 'volume',
  'vol_sma': 'volume',
  'vol_ma': 'volume',
  'vol_spike': 'volume',
  '_volume': 'volume',
  '_vol': 'volume',
  
  // Compound names that should be split
  'ema_crossover': 'ema',
  'ema_cross': 'ema',
  'macd_crossover': 'macd',
  'macd_cross': 'macd',
  'macd_bullish_crossover': 'macd',
  'macd_bearish_crossover': 'macd',
  'bollinger_bands': 'bollinger',
  'bollinger_band': 'bollinger',
  'bollinger_squeeze': 'bollinger',
  'bb_squeeze': 'bollinger',
  'williams_r': 'williamsR',
  'williams_%r': 'williamsR',
  'awesome_oscillator': 'awesomeOscillator',
  'bollinger_band_width': 'bbw',
  'donchian_channels': 'donchian',
  'keltner_channels': 'keltner',
  'weighted_moving_average': 'wma',
  'hull_moving_average': 'hma',
  'triple_exponential_moving_average': 'tema',
  'double_exponential_moving_average': 'dema',
  
  // RSI variants
  'rsi_oversold': 'rsi',
  'rsi_overbought': 'rsi',
  'rsi_divergence': 'rsi',
  'relative_strength_index': 'rsi',
  
  // ADX variants
  'adx_trending': 'adx',
  'adx_strong': 'adx',
  'adx_weak': 'adx',
  'average_directional_index': 'adx',
  
  // Stochastic variants
  'stoch_oversold': 'stochastic',
  'stoch_overbought': 'stochastic', // Fixed: was 'stoch_overbought'
  'stochastic_oscillator': 'stochastic',
  'stochastic_k': 'stochastic',
  'stochastic_d': 'stochastic',
  
  // Case variations and direct lowercase mappings
  'rsi': 'rsi',
  'macd': 'macd',
  'bollinger': 'bollinger',
  'ema': 'ema',
  'ma200': 'ma200',
  'obv': 'obv',
  'cmf': 'cmf',
  'adline': 'adLine', 
  'bbw': 'bbw',
  'roc': 'roc',
  'cmo': 'cmo',
  'atr': 'atr',
  'adx': 'adx',
  'psar': 'psar',
  'cci': 'cci',
  'mfi': 'mfi',
  'tema': 'tema',
  'dema': 'dema',
  'hma': 'hma',
  'wma': 'wma',
  'volume': 'volume',
  'vol': 'volume',
  'ao': 'awesomeOscillator',
  'stoch': 'stochastic',
  'stochastic': 'stochastic',
  'williams': 'williamsR',
  'williamsr': 'williamsR', 
  'RSI': 'rsi',
  'MACD': 'macd',
  'EMA': 'ema',
  'MA200': 'ma200',
  'OBV': 'obv',
  'CMF': 'cmf',
  'ADL': 'adLine',
  'BBW': 'bbw',
  'ROC': 'roc',
  'CMO': 'cmo',
  'ATR': 'atr',
  'ADX': 'adx',
  'PSAR': 'psar',
  'CCI': 'cci',
  'MFI': 'mfi',
  'TEMA': 'tema',
  'DEMA': 'dema',
  'HMA': 'hma',
  'WMA': 'wma',
  'VOLUME': 'volume',
  'VOL': 'volume',
  'AO': 'awesomeOscillator',
  'STOCH': 'stochastic',
  'STOCHASTIC': 'stochastic',
  'WILLIAMS': 'williamsR',
  'WILLIAMSR': 'williamsR',
  
  // Legacy/alternative names
  'moving_average_200': 'ma200',
  'exponential_moving_average': 'ema',
  'relative_strength_index': 'rsi',
  'stochastic_oscillator': 'stochastic',
  'commodity_channel_index': 'cci',
  'money_flow_index': 'mfi',
  'average_true_range': 'atr',
  'average_directional_index': 'adx',
  'parabolic_sar': 'psar',
  
  // Pattern recognition variants
  'candlestick_pattern': 'candlestick',
  'candle_pattern': 'candlestick',
  'cdl_doji': 'candlestick',
  'cdl_hammer': 'candlestick',
  'cdl_shootingstar': 'candlestick',
  'cdl_engulfing': 'candlestick',
  'cdl_morningstar': 'candlestick',
  'cdl_eveningstar': 'candlestick',
  'cdl_3whitesoldiers': 'candlestick',
  'cdl_3blackcrows': 'candlestick',
  'cdl_dragonflydoji': 'candlestick',
  'cdl_3linestrike': 'candlestick',
  'cdl_harami': 'candlestick',
  'cdl_piercing': 'candlestick',
  'cdl_darkcloudcover': 'candlestick',
  'cdl_hangingman': 'candlestick',
  'cdl_invertedhammer': 'candlestick',
  'cdl_spinningtop': 'candlestick',
  'cdl_marubozu': 'candlestick',
  
  // Other common variants that might appear
  'sma': 'ma200', 
  'simple_moving_average': 'ma200',
  'moving_average': 'ma200',
  'ma_crossover': 'ema', 
  'ma_cross': 'ema',

  // Migrations for new canonical names
  'maribbon': 'maRibbon',
  'MARIBBON': 'maRibbon',
  'pivot': 'pivot',
  'PIVOT': 'pivot',
  'fibonacci': 'fibonacci',
  'FIBONACCI': 'fibonacci',
  'supportresistance': 'supportResistance',
  'SUPPORTRESISTANCE': 'supportResistance',
  'S_R': 'supportResistance',
  'support_resistance': 'supportResistance',
};

// NEW: Default parameters to patch legacy combinations that were saved without them.
export const DEFAULT_SIGNAL_PARAMS = {
  rsi: { period: 14, oversoldValue: 30, overboughtValue: 70 },
  stochastic: { kPeriod: 14, dPeriod: 3, smoothing: 3, oversold: 20, overbought: 80 },
  cci: { period: 20, oversold: -100, overbought: 100 },
  mfi: { period: 14, oversold: 20, overbought: 80 },
  bollinger: { period: 20, stdDev: 2 },
  keltner: { emaPeriod: 20, atrPeriod: 10, atrMultiplier: 2 },
  donchian: { period: 20 },
  atr: { period: 14 },
  adx: { period: 14, strengthLevel: 25 },
  psar: { afStart: 0.02, afIncrement: 0.02, afMax: 0.2 },
  roc: { period: 12 },
  cmf: { period: 20 },
  williamsR: { period: 14, oversold: -80, overbought: -20 },
  ichimoku: { tenkanPeriod: 9, kijunPeriod: 26, senkouPeriodB: 52, displacement: 26 },
  ema: { shortPeriod: 12, longPeriod: 26 },
  dema: { period: 21 },
  tema: { period: 21 },
  hma: { period: 21 },
  wma: { period: 21 },
  fibonacci: { lookback: 100 },
  pivot: {}, // Pivot points don't need parameters here
  maRibbon: { periods: [10, 20, 30, 40, 50, 60] }, // Default for new maRibbon
  supportResistance: { lookback: 100 } // Default for new supportResistance
};

// Standardized signal key mapping - this must match signalSettings.js exactly
const VALID_SIGNAL_KEYS = [
  // Momentum
  'rsi', 'stochastic', 'williamsR', 'cci', 'roc', 'awesomeOscillator', 'cmo',
  // Trend  
  'macd', 'ema', 'ma200', 'ichimoku', 'maRibbon', 'adx', 'psar', 'tema', 'dema', 'hma', 'wma',
  // Volatility
  'bollinger', 'atr', 'bbw', 'keltner', 'donchian',
  // Volume
  'volume', 'mfi', 'obv', 'cmf', 'adLine',
  // Pattern Recognition
  'candlestick', 'chartPatterns', // CONSOLIDATED
  // Support/Resistance
  'pivot', 'fibonacci', 'supportResistance'
];

// Signal evaluation function name mapping - PascalCase for function names
const EVALUATION_FUNCTION_MAP = {
  'rsi': 'evaluateRsiCondition',
  'stochastic': 'evaluateStochasticCondition', 
  'williamsR': 'evaluateWilliamsRCondition',
  'cci': 'evaluateCciCondition',
  'roc': 'evaluateRocCondition',
  'awesomeOscillator': 'evaluateAwesomeOscillatorCondition',
  'cmo': 'evaluateCmoCondition',
  'macd': 'evaluateMacdCondition',
  'ema': 'evaluateEmaCondition',
  'ma200': 'evaluateMa200Condition',
  'ichimoku': 'evaluateIchimokuCondition',
  'maRibbon': 'evaluateMaRibbonCondition',
  'adx': 'evaluateAdxCondition',
  'psar': 'evaluatePsarCondition',
  'tema': 'evaluateTemaCondition',
  'dema': 'evaluateDemaCondition',
  'hma': 'evaluateHmaCondition',
  'wma': 'evaluateWmaCondition',
  'bollinger': 'evaluateBollingerCondition',
  'atr': 'evaluateAtrCondition',
  'bbw': 'evaluateBbwCondition',
  'keltner': 'evaluateKeltnerCondition',
  'donchian': 'evaluateDonchianCondition',
  'volume': 'evaluateVolumeCondition',
  'mfi': 'evaluateMfiCondition',
  'obv': 'evaluateObvCondition', 
  'cmf': 'evaluateCmfCondition',
  'adLine': 'evaluateAdLineCondition', 
  'pivot': 'evaluatePivotCondition',
  'fibonacci': 'evaluateFibonacciCondition',
  'supportResistance': 'evaluateSupportResistanceCondition',
  'candlestick': 'evaluateCandlestickCondition',
  'chartPatterns': 'evaluateChartPatternCondition'
};

export function getEvaluationFunctionName(signalKey) {
  return EVALUATION_FUNCTION_MAP[signalKey] || null;
}

export function isValidSignalKey(signalKey) {
  return VALID_SIGNAL_KEYS.includes(signalKey);
}

/**
 * Validates if a signal type is canonical (recognized)
 * @param {string} signalType - The signal type to validate
 * @returns {boolean} - True if signal type is canonical
 */
export function isCanonicalSignalName(signalType) {
  return Object.prototype.hasOwnProperty.call(CANONICAL_SIGNAL_NAMES, signalType);
}

/**
 * Migrates a signal type to its canonical form
 * @param {string} signalType - The signal type to migrate
 * @returns {string} - The canonical signal name, or original if no migration found
 */
export function migrateSignalName(signalType) {
  if (!signalType || typeof signalType !== 'string') {
    return signalType;
  }
  
  // Return canonical name if already correct
  if (isCanonicalSignalName(signalType)) {
    return signalType;
  }
  
  // Check for direct migration mapping
  const migrated = SIGNAL_NAME_MIGRATIONS[signalType];
  if (migrated) {
    return migrated;
  }
  
  // Try case-insensitive lookup
  const lowerSignalType = signalType.toLowerCase();
  const caseInsensitiveMigration = SIGNAL_NAME_MIGRATIONS[lowerSignalType];
  if (caseInsensitiveMigration) {
    return caseInsensitiveMigration;
  }
  
  // Try removing common prefixes/suffixes
  const cleaned = signalType.replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  const cleanedMigration = SIGNAL_NAME_MIGRATIONS[cleaned];
  if (cleanedMigration) {
    return cleanedMigration;
  }
  
  // Return original if no migration found
  return signalType;
}

// Enhanced migration function that handles signal objects within combinations
// REVISED: This function now also repairs missing parameters.
export function migrateCombinationSignals(combination) {
  if (!combination || !Array.isArray(combination.signals)) {
    return combination;
  }
  
  // Use a deep copy to avoid mutating the original object
  const repairedCombination = JSON.parse(JSON.stringify(combination));

  repairedCombination.signals = repairedCombination.signals.map(signal => {
    // 1. Migrate the name first to get the canonical type
    const canonicalType = migrateSignalName(signal.type);
    const repairedSignal = { ...signal, type: canonicalType };

    // 2. Check if parameters are missing (null or undefined) for signals that should have them.
    // If so, inject the default parameters as a fallback.
    if (!repairedSignal.parameters && DEFAULT_SIGNAL_PARAMS[canonicalType]) {
      repairedSignal.parameters = { ...DEFAULT_SIGNAL_PARAMS[canonicalType] };
    }
    
    return repairedSignal;
  });

  return repairedCombination;
}

// Enhanced function to migrate a complete combination object
export function migrateLegacyCombination(combination) {
  if (!combination) return combination;
  
  // First migrate the signal types
  let migrated = migrateCombinationSignals(combination);
  
  // Then handle any other legacy fields if needed
  // (placeholder for future migrations)
  
  return migrated;
}

/**
 * Validates a BacktestCombination's signals array
 * @param {Object} combination - The BacktestCombination object to validate
 * @returns {Object} - Validation result with isValid flag and issues array
 */
export function validateCombinationSignals(combination) {
  const issues = [];
  let isValid = true;
  
  if (!combination) {
    return { isValid: false, issues: ['Combination object is null or undefined'] };
  }
  
  if (!combination.signals || !Array.isArray(combination.signals)) {
    return { isValid: false, issues: ['Combination has no signals array'] };
  }
  
  combination.signals.forEach((signal, index) => {
    if (!signal || typeof signal !== 'object') {
      issues.push(`Signal at index ${index} is not a valid object`);
      isValid = false;
      return;
    }
    
    if (!signal.type || typeof signal.type !== 'string') {
      issues.push(`Signal at index ${index} has no valid type property`);
      isValid = false;
      return;
    }
    
    if (!isCanonicalSignalName(signal.type)) {
      const migratedName = migrateSignalName(signal.type);
      if (isCanonicalSignalName(migratedName)) {
        issues.push(`Signal at index ${index} has non-canonical type '${signal.type}' (can be migrated to '${migratedName}')`);
      } else {
        issues.push(`Signal at index ${index} has unknown signal type '${signal.type}' (no migration available)`);
        isValid = false;
      }
    }
  });
  
  return { isValid, issues };
}

/**
 * Gets all canonical signal names as an array
 * @returns {string[]} - Array of canonical signal names
 */
export function getCanonicalSignalNames() {
  return Object.keys(CANONICAL_SIGNAL_NAMES);
}

/**
 * Logs validation issues for debugging
 * @param {string} context - Context where validation occurred
 * @param {Object} validationResult - Result from validateCombinationSignals
 */
export function logValidationIssues(context, validationResult) {
  if (!validationResult.isValid && validationResult.issues.length > 0) {
    console.warn(`[Signal Validation - ${context}] Issues found:`, validationResult.issues);
  }
}
