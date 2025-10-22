
// This file centralizes the default parameters for all technical indicators.

export const SIGNAL_CATEGORIES = {
  'Momentum': {
    icon: 'TrendingUp',
    description: 'Measure the speed and change of price movements.',
    signals: ['rsi', 'stochastic', 'williamsr', 'cci', 'roc', 'awesomeoscillator', 'cmo', 'mfi']
  },
  'Trend': {
    icon: 'Activity',
    description: 'Determine the direction and strength of a market trend.',
    signals: ['macd', 'ema', 'ma200', 'ichimoku', 'maribbon', 'adx', 'psar', 'tema', 'dema', 'hma', 'wma']
  },
  'Volatility': {
    icon: 'Zap',
    description: 'Gauge the size of price fluctuations.',
    signals: ['bollinger', 'atr', 'bbw', 'keltner', 'donchian', 'ttm_squeeze']
  },
  'Volume': {
    icon: 'BarChart3',
    description: 'Analyze trading volume to confirm trends.',
    signals: ['volume', 'obv', 'cmf', 'adline']
  },
  'Support & Resistance': {
    icon: 'Layers',
    description: 'Identify key price levels where trends may pause or reverse.',
    signals: ['pivot', 'fibonacci', 'supportresistance']
  },
  'Patterns': {
    icon: 'Eye',
    description: 'Recognize recurring shapes in price charts.',
    signals: ['candlestick', 'chartpattern']
  },
};

export const defaultSignalSettings = {
  rsi: {
    name: "RSI",
    enabled: false, // Updated from outline
    category: 'momentum',
    pandasTaName: "rsi",
    period: 14,
    overbought: 70,
    oversold: 30,
    priority: 10, // Updated from outline
  },
  stochastic: {
    name: "Stochastic",
    enabled: false, // Updated from outline
    category: 'momentum',
    pandasTaName: "stoch",
    kPeriod: 14,
    dPeriod: 3,
    overbought: 80,
    oversold: 20,
    priority: 9, // Updated from outline
  },
  williamsr: { // Standardized from williamsR
    name: "Williams %R",
    enabled: true,
    category: 'momentum',
    pandasTaName: "willr",
    period: 14,
    overbought: -20,
    oversold: -80,
    priority: 2,
  },
  cci: {
    name: "Commodity Channel Index",
    enabled: true,
    category: 'momentum',
    pandasTaName: "cci",
    period: 20,
    constant: 0.015, // This was an existing parameter and should be preserved.
    overbought: 100,
    oversold: -100,
    priority: 3,
    // New parameters for refined logic
    zeroLineConfirmation: 3, // Min candles on one side before cross is valid
    divergenceLookback: 25, // Lookback period for divergence detection
    minPeakDistance: 5, // Min candles between peaks for divergence
  },
  roc: {
    name: "ROC",
    enabled: true,
    category: 'momentum',
    pandasTaName: "roc",
    period: 12,
    priority: 3,
  },
  awesomeoscillator: { // Standardized from awesomeOscillator
    name: "Awesome Oscillator",
    enabled: true,
    category: "momentum",
    pandasTaName: "ao",
    fastPeriod: 5,
    slowPeriod: 34,
    priority: 4,
    // New parameters for refined logic
    zeroLineConfirmation: 3, // Min candles on one side for a valid cross
    divergenceLookback: 34, // Lookback for Twin Peaks / divergence
    minPeakDistance: 5, // Min candles between peaks for divergence
  },
  cmo: {
    name: "Chande Momentum Oscillator",
    enabled: true, // Updated from outline
    category: "momentum",
    pandasTaName: "cmo",
    period: 14,
    overbought: 50,
    oversold: -50,
    priority: 4, // Updated from outline
    // New parameters for refined logic
    zeroLineConfirmation: 3, // Min candles on one side for a valid cross
    divergenceLookback: 25,  // Lookback period for divergence detection
    minPeakDistance: 5,      // Min candles between peaks for divergence
  },
  macd: {
    name: "MACD",
    enabled: false, // Updated from outline
    category: 'trend', // Kept as 'trend' for consistency with SIGNAL_CATEGORIES
    pandasTaName: 'macd',
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    priority: 11, // Updated from outline
  },
  ema: {
    name: "EMA", // Updated name from outline
    enabled: false, // Updated from outline
    category: 'trend',
    pandasTaName: 'ema',
    period: 20, // Updated period and simplified from fast/slowPeriod as per outline
    priority: 6, // Updated from outline
  },
  ma200: {
    name: "MA200", // Updated name from outline
    enabled: false, // Updated from outline
    category: 'trend',
    pandasTaName: 'sma',
    period: 200,
    priority: 5, // Updated from outline
  },
  ichimoku: {
    name: "Ichimoku Cloud",
    enabled: false, // Updated from outline
    category: 'trend',
    pandasTaName: 'ichimoku',
    tenkan: 9,
    kijun: 26,
    senkouB: 52,
    displacement: 26,
    priority: 12, // Updated from outline
  },
  maribbon: { // Standardized from maRibbon
    name: "MA Ribbon",
    enabled: true,
    category: "trend",
    priority: 2,
    maPeriods: [5, 10, 20, 30, 40, 50] // Updated periods and renamed
  },
  adx: {
    name: "ADX",
    enabled: true,
    category: 'trend',
    pandasTaName: 'adx',
    period: 14,
    strongTrendLevel: 25, // Updated value
    priority: 2,
  },
  psar: {
    name: "PSAR",
    enabled: true,
    category: 'trend',
    pandasTaName: 'psar',
    afStart: 0.02,
    afIncrement: 0.02,
    afMax: 0.2,
    priority: 3,
    adxThreshold: 20,
    volumeMultiplier: 1.5, // New: Multiplier for volume confirmation
    squeezeLookback: 5,   // New: How many candles to look back for a squeeze
  },
  tema: {
    name: "Triple EMA",
    enabled: true,
    category: "trend",
    pandasTaName: "tema",
    period: 21,
    priority: 4,
  },
  dema: {
    name: "Double EMA",
    enabled: true,
    category: "trend",
    pandasTaName: "dema",
    period: 21,
    priority: 4,
  },
  hma: {
    name: "Hull MA",
    enabled: true,
    category: "trend",
    pandasTaName: "hma",
    period: 21,
    priority: 4,
  },
  wma: {
    name: "Weighted MA",
    enabled: true,
    category: "trend",
    pandasTaName: "wma",
    period: 20,
    priority: 4,
  },
  bollinger: {
    name: "Bollinger Bands",
    enabled: false, // Updated from outline
    category: 'volatility',
    pandasTaName: 'bbands',
    period: 20,
    stdDev: 2,
    priority: 13, // Updated from outline
    volumeMultiplier: 1.5, // New parameter from outline
    bandWalkLookback: 5,   // New parameter from outline
  },
  atr: {
    name: "ATR",
    enabled: false, // Updated from outline
    category: 'volatility',
    pandasTaName: 'atr',
    period: 14,
    priority: 14, // Updated from outline
    multiplier: 1.5, // New parameter from outline
  },
  bbw: {
    name: "Bollinger Band Width",
    enabled: true, // FIXED: Enable BBW by default
    category: 'volatility',
    pandasTaName: 'bbw',
    period: 20,
    stdDev: 2,
    threshold: 2.0, // FIXED: Use percentage-based threshold (2% is reasonable for squeeze detection)
    priority: 15, // Updated from outline
  },
  keltner: {
    name: "Keltner Channels",
    enabled: true,
    category: "volatility",
    pandasTaName: "kc",
    period: 20,
    atrPeriod: 20,
    multiplier: 2.0,
    priority: 3,
  },
  donchian: {
    name: "Donchian Channels",
    enabled: true,
    category: "volatility",
    pandasTaName: "donchian",
    period: 20,
    priority: 3,
  },
  volume: {
    name: "Volume SMA", // Updated name from outline
    enabled: false, // Updated from outline
    category: 'volume',
    pandasTaName: 'sma', // Updated from volume_sma to sma
    period: 20, // Renamed from maPeriod as per outline
    spikeMultiplier: 1.5, // Updated value
    priority: 16, // Updated from outline
  },
  mfi: {
    name: "MFI",
    enabled: true,
    category: 'volume', // This category will be overridden by SIGNAL_CATEGORIES. The actual category should align with the new mapping.
    pandasTaName: 'mfi',
    period: 14,
    oversold: 20,
    overbought: 80,
    priority: 2,
  },
  obv: {
    name: "On-Balance Volume",
    enabled: true,
    category: "volume",
    pandasTaName: "obv",
    priority: 2,
    // New parameters for refined logic
    shortPeriod: 10, // Short-term SMA for OBV line
    longPeriod: 30,  // Long-term SMA for OBV line
    divergenceLookback: 30,
    minPeakDistance: 5,
  },
  cmf: {
    name: "Chaikin Money Flow",
    enabled: true,
    category: 'volume',
    pandasTaName: 'cmf',
    period: 20,
    threshold: 0.05, // Updated from strongLevel/weakLevel
    priority: 3,
  },
  adline: { // Standardized from adLine
    name: "Accumulation/Distribution Line",
    enabled: true,
    category: "volume",
    pandasTaName: "ad", // Added pandasTaName
    priority: 4,
  },
  pivot: {
    name: "Pivot Points",
    enabled: true,
    category: "support_resistance", // Updated category
    pandasTaName: "pivot",
    priority: 2,
  },
  fibonacci: {
    name: "Fibonacci Retracements",
    enabled: true,
    category: "support_resistance", // Updated category
    pandasTaName: "fibonacci",
    lookback: 60, // Updated lookback
    priority: 3,
  },
  supportresistance: { // Standardized from supportResistance
    name: "Support/Resistance",
    enabled: true,
    category: "support_resistance", // Updated category
    pandasTaName: "support_resistance",
    lookback: 50, // Updated lookback
    tolerance: 0.01, // Updated tolerance
    priority: 1,
  },
  candlestick: {
    enabled: true, // Updated to true
    category: 'patterns', // Updated category
    name: 'Candlestick Patterns',
    pandasTaName: 'custom_candlestick',
    priority: 1, // Added priority
  },
  chartpattern: { // STANDARDIZED: from chartpatterns (plural) to chartpattern (singular)
    enabled: true, // Enable by default now that it's functional
    name: "Chart Patterns",
    category: "patterns",
    pandasTaName: "chart_patterns",
    priority: 2,
  },
  // Adding the new TTM Squeeze Signal
  ttm_squeeze: {
    name: "TTM Squeeze",
    enabled: true,
    category: "volatility",
    pandasTaName: "squeeze_pro", // Using a custom name as it's a composite indicator
    priority: 1,
    period: 20,
    bbMultiplier: 2,
    kcPeriod: 20,
    kcMultiplier: 1.5,
    atrPeriod: 20,
    minSqueezeDuration: 4, // Squeeze must last for at least 4 candles
    useAoSMA: true, // Use a smoothed Awesome Oscillator for momentum
    aoSmaPeriod: 5
  },
};
