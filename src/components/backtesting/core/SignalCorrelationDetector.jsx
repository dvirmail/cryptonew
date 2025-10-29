/**
 * Signal Correlation Detector
 * 
 * This module detects and handles signal correlations to prevent double-counting
 * of related signals in combined strength calculations.
 */

export class SignalCorrelationDetector {
  constructor() {
    this.correlationMatrix = this.initializeCorrelationMatrix();
    this.correlationThreshold = 0.8; // Signals with correlation > 0.8 are considered highly correlated
    
    // Expose test function globally for easy console access
    if (typeof window !== 'undefined') {
      window.testCorrelations = () => this.testAllCorrelations();
      window.testCorrelation = (signal1, signal2) => {
        const correlation = this.calculateCorrelation(signal1, signal2);
        console.log(`${signal1} ↔ ${signal2}: ${correlation !== 0 ? correlation.toFixed(3) : 'NO CORRELATION'}`);
        return correlation;
      };
    }
  }

  /**
   * Initialize correlation matrix for different signal types
   * Values range from 0 (no correlation) to 1 (perfect correlation)
   */
  initializeCorrelationMatrix() {
    return {
      // Momentum indicators - highly correlated
      'rsi_oversold': {
        'stochastic_oversold': 0.85,
        'williams_r': 0.80,
        'rsi_overbought': -0.90,
        'stochastic_overbought': -0.85
      },
      'rsi_overbought': {
        'stochastic_overbought': 0.85,
        'williams_r': 0.80,
        'rsi_oversold': -0.90,
        'stochastic_oversold': -0.85
      },
      'stochastic_oversold': {
        'rsi_oversold': 0.85,
        'williams_r': 0.90,
        'stochastic_overbought': -0.90,
        'rsi_overbought': -0.85
      },
      'stochastic_overbought': {
        'rsi_overbought': 0.85,
        'williams_r': 0.90,
        'stochastic_oversold': -0.90,
        'rsi_oversold': -0.85
      },
      'williams_r': {
        'rsi_oversold': 0.80,
        'stochastic_oversold': 0.90,
        'rsi_overbought': -0.80,
        'stochastic_overbought': -0.90
      },

      // CCI correlations - Major gap filled
      'cci_oversold': {
        'rsi_oversold': 0.75,
        'stochastic_oversold': 0.70,
        'williams_r': 0.65,
        'cci_overbought': -0.85,
        'roc_positive': 0.60,
        'awesomeoscillator_positive': 0.55,
        'cmo_positive': 0.50,
        'mfi_oversold': 0.55
      },
      'cci_overbought': {
        'rsi_overbought': 0.75,
        'stochastic_overbought': 0.70,
        'williams_r': 0.65,
        'cci_oversold': -0.85,
        'roc_negative': 0.60,
        'awesomeoscillator_negative': 0.55,
        'cmo_negative': 0.50,
        'mfi_overbought': 0.55
      },

      // ROC correlations - Complete momentum coverage
      'roc_positive': {
        'rsi_oversold': 0.60,
        'stochastic_oversold': 0.55,
        'cci_oversold': 0.60,
        'awesomeoscillator_positive': 0.70,
        'cmo_positive': 0.65,
        'roc_negative': -0.80
      },
      'roc_negative': {
        'rsi_overbought': 0.60,
        'stochastic_overbought': 0.55,
        'cci_overbought': 0.60,
        'awesomeoscillator_negative': 0.70,
        'cmo_negative': 0.65,
        'roc_positive': -0.80
      },

      // Awesome Oscillator correlations
      'awesomeoscillator_positive': {
        'roc_positive': 0.70,
        'cmo_positive': 0.65,
        'rsi_oversold': 0.50,
        'stochastic_oversold': 0.45,
        'cci_oversold': 0.55,
        'awesomeoscillator_negative': -0.85
      },
      'awesomeoscillator_negative': {
        'roc_negative': 0.70,
        'cmo_negative': 0.65,
        'rsi_overbought': 0.50,
        'stochastic_overbought': 0.45,
        'cci_overbought': 0.55,
        'awesomeoscillator_positive': -0.85
      },

      // CMO correlations
      'cmo_positive': {
        'roc_positive': 0.65,
        'awesomeoscillator_positive': 0.65,
        'rsi_oversold': 0.50,
        'stochastic_oversold': 0.45,
        'cci_oversold': 0.50,
        'cmo_negative': -0.80
      },
      'cmo_negative': {
        'roc_negative': 0.65,
        'awesomeoscillator_negative': 0.65,
        'rsi_overbought': 0.50,
        'stochastic_overbought': 0.45,
        'cci_overbought': 0.50,
        'cmo_positive': -0.80
      },

      // MFI correlations
      'mfi_oversold': {
        'rsi_oversold': 0.70,
        'stochastic_oversold': 0.65,
        'williams_r': 0.60,
        'cci_oversold': 0.55,
        'mfi_overbought': -0.85
      },
      'mfi_overbought': {
        'rsi_overbought': 0.70,
        'stochastic_overbought': 0.65,
        'williams_r': 0.60,
        'cci_overbought': 0.55,
        'mfi_oversold': -0.85
      },

      // Trend indicators - moderately correlated
      'macd_cross': {
        'ema_cross': 0.75,
        'sma_cross': 0.70,
        'ema': 0.65,
        'dema': 0.60,
        'ma200': 0.55,
        'trend_line_break': 0.65,
        'macd_divergence': 0.60
      },
      
      // Generic MACD correlations (for signals that return 'macd' type)
      'macd': {
        'ema': 0.70,
        'ma200': 0.65,
        'tema': 0.50,
        'dema': 0.55,
        'hma': 0.50,
        'wma': 0.50,
        'psar': 0.50,
        'adx': 0.40,
        'ichimoku': 0.50,
        'maribbon': 0.45,
        'macd_cross': 0.85,
        'macd_divergence': 0.60,
        'macd_histogram': 0.55
      },

      // Uppercase signal type correlations (as generated by signal evaluation functions)
      'RSI': {
        'rsi_oversold': 0.90,
        'rsi_overbought': 0.90,
        'stochastic': 0.80,
        'Stochastic': 0.80,
        'williamsr': 0.75,
        'CCI': 0.70,
        'cci_oversold': 0.70,
        'cci_overbought': 0.70,
        'roc': 0.60,
        'awesomeoscillator': 0.55,
        'cmo': 0.55,
        'mfi': 0.65,
        'MFI': 0.65,
        'awesomeOscillator': 0.55,
        'CMO': 0.55,
        'ROC': 0.60
      },
      'Stochastic': {
        'stochastic_oversold': 0.90,
        'stochastic_overbought': 0.90,
        'RSI': 0.80,
        'rsi_oversold': 0.80,
        'rsi_overbought': 0.80,
        'williamsr': 0.85,
        'CCI': 0.70,
        'cci_oversold': 0.70,
        'cci_overbought': 0.70,
        'roc': 0.55,
        'awesomeoscillator': 0.50,
        'cmo': 0.50,
        'mfi': 0.60
      },
      'CCI': {
        'cci_oversold': 0.90,
        'cci_overbought': 0.90,
        'RSI': 0.70,
        'rsi_oversold': 0.70,
        'rsi_overbought': 0.70,
        'Stochastic': 0.70,
        'stochastic_oversold': 0.70,
        'stochastic_overbought': 0.70,
        'williamsr': 0.65,
        'roc': 0.60,
        'awesomeoscillator': 0.55,
        'cmo': 0.50,
        'mfi': 0.55
      },
      'EMA': {
        'ema': 0.90,
        'ema_cross': 0.85,
        'macd': 0.70,
        'macd_cross': 0.70,
        'MA200': 0.75,
        'ma200': 0.75,
        'tema': 0.80,
        'dema': 0.85,
        'hma': 0.75,
        'wma': 0.80,
        'Ichimoku': 0.65,
        'ichimoku': 0.65,
        'ADX': 0.55,
        'adx': 0.55,
        'PSAR': 0.60,
        'psar': 0.60,
        'maribbon': 0.60
      },
      'MA200': {
        'ma200': 0.90,
        'EMA': 0.75,
        'ema': 0.75,
        'ema_cross': 0.70,
        'macd': 0.65,
        'macd_cross': 0.65,
        'tema': 0.65,
        'dema': 0.70,
        'hma': 0.65,
        'wma': 0.70,
        'Ichimoku': 0.70,
        'ichimoku': 0.70,
        'ADX': 0.50,
        'adx': 0.50,
        'PSAR': 0.65,
        'psar': 0.65,
        'maribbon': 0.55
      },
      'Ichimoku': {
        'ichimoku': 0.90,
        'EMA': 0.65,
        'ema': 0.65,
        'MA200': 0.70,
        'ma200': 0.70,
        'tema': 0.55,
        'dema': 0.60,
        'hma': 0.55,
        'wma': 0.55,
        'ADX': 0.60,
        'adx': 0.60,
        'PSAR': 0.45,
        'psar': 0.45,
        'macd': 0.50,
        'macd_cross': 0.50,
        'maribbon': 0.50
      },
      'ADX': {
        'adx': 0.90,
        'EMA': 0.55,
        'ema': 0.55,
        'MA200': 0.50,
        'ma200': 0.50,
        'Ichimoku': 0.60,
        'ichimoku': 0.60,
        'tema': 0.45,
        'dema': 0.50,
        'hma': 0.45,
        'wma': 0.45,
        'PSAR': 0.50,
        'psar': 0.50,
        'macd': 0.40,
        'macd_cross': 0.40,
        'maribbon': 0.40
      },
      'PSAR': {
        'psar': 0.90,
        'EMA': 0.60,
        'ema': 0.60,
        'MA200': 0.65,
        'ma200': 0.65,
        'Ichimoku': 0.45,
        'ichimoku': 0.45,
        'ADX': 0.50,
        'adx': 0.50,
        'tema': 0.40,
        'dema': 0.45,
        'hma': 0.40,
        'wma': 0.40,
        'macd': 0.50,
        'macd_cross': 0.50,
        'maribbon': 0.35
      },
      'ema_cross': {
        'macd_cross': 0.75,
        'sma_cross': 0.85,
        'ema': 0.90,
        'dema': 0.80,
        'ma200': 0.70,
        'trend_line_break': 0.60,
        'macd_divergence': 0.55
      },
      'sma_cross': {
        'ema_cross': 0.85,
        'macd_cross': 0.70,
        'ema': 0.80,
        'dema': 0.75,
        'ma200': 0.85,
        'trend_line_break': 0.55,
        'macd_divergence': 0.50
      },
      'ema': {
        'ema_cross': 0.90,
        'dema': 0.85,
        'ma200': 0.75,
        'sma_cross': 0.80,
        'macd_cross': 0.65,
        'psar': 0.60
      },
      'dema': {
        'ema': 0.85,
        'ema_cross': 0.80,
        'ma200': 0.70,
        'sma_cross': 0.75,
        'macd_cross': 0.60,
        'psar': 0.55
      },
      'ma200': {
        'sma_cross': 0.85,
        'ema_cross': 0.70,
        'ema': 0.75,
        'dema': 0.70,
        'psar': 0.65,
        'macd_cross': 0.55
      },
      'psar': {
        'ma200': 0.65,
        'ema': 0.60,
        'dema': 0.55,
        'trend_line_break': 0.70,
        'macd_cross': 0.50
      },

      // Additional trend indicator correlations - filling gaps
      'adx': {
        'ema': 0.55,
        'ma200': 0.50,
        'ichimoku': 0.60,
        'tema': 0.45,
        'dema': 0.50,
        'hma': 0.45,
        'wma': 0.45,
        'macd_cross': 0.40,
        'psar': 0.50
      },
      'ichimoku': {
        'ema': 0.65,
        'ma200': 0.70,
        'adx': 0.60,
        'tema': 0.55,
        'dema': 0.60,
        'hma': 0.55,
        'wma': 0.55,
        'macd_cross': 0.50,
        'psar': 0.45
      },
      'tema': {
        'ema': 0.80,
        'ma200': 0.65,
        'adx': 0.45,
        'ichimoku': 0.55,
        'dema': 0.75,
        'hma': 0.70,
        'wma': 0.70,
        'macd_cross': 0.50,
        'psar': 0.40
      },
      'dema': {
        'ema': 0.85,
        'ma200': 0.70,
        'adx': 0.50,
        'ichimoku': 0.60,
        'tema': 0.75,
        'hma': 0.75,
        'wma': 0.75,
        'macd_cross': 0.55,
        'psar': 0.45
      },
      'hma': {
        'ema': 0.75,
        'ma200': 0.65,
        'adx': 0.45,
        'ichimoku': 0.55,
        'tema': 0.70,
        'dema': 0.75,
        'wma': 0.80,
        'macd_cross': 0.50,
        'psar': 0.40
      },
      'wma': {
        'ema': 0.80,
        'ma200': 0.70,
        'adx': 0.45,
        'ichimoku': 0.55,
        'tema': 0.70,
        'dema': 0.75,
        'hma': 0.80,
        'macd_cross': 0.50,
        'psar': 0.40
      },
      'maribbon': {
        'ema': 0.60,
        'ma200': 0.55,
        'adx': 0.40,
        'ichimoku': 0.50,
        'tema': 0.55,
        'dema': 0.60,
        'hma': 0.65,
        'wma': 0.65,
        'macd_cross': 0.45,
        'psar': 0.35
      },

      // Generic volume signal correlations
      'volume_spike': {
        'volume_breakout': 0.80,
        'volume_profile': 0.70,
        'obv_increasing': 0.60,
        'obv_decreasing': 0.60,
        'obv_divergence': 0.70,
        'cmf_positive': 0.55,
        'cmf_negative': 0.55,
        'cmf_divergence': 0.60,
        'adline_increasing': 0.50,
        'adline_decreasing': 0.50,
        'adline_divergence': 0.55,
        'mfi': 0.45,
        'MFI': 0.45,
        'obv': 0.60,
        'OBV': 0.60,
        'cmf': 0.55,
        'CMF': 0.55,
        'adline': 0.50,
        'ADLine': 0.50,
        'volume': 0.90
      },
      'volume_breakout': {
        'volume_spike': 0.80,
        'volume_profile': 0.75,
        'obv_increasing': 0.65,
        'obv_decreasing': 0.65,
        'obv_divergence': 0.75,
        'cmf_positive': 0.60,
        'cmf_negative': 0.60,
        'cmf_divergence': 0.65,
        'adline_increasing': 0.55,
        'adline_decreasing': 0.55,
        'adline_divergence': 0.60,
        'mfi': 0.50
      },
      'volume_profile': {
        'volume_spike': 0.70,
        'volume_breakout': 0.75,
        'obv_increasing': 0.60,
        'obv_decreasing': 0.60,
        'obv_divergence': 0.65,
        'cmf_positive': 0.55,
        'cmf_negative': 0.55,
        'cmf_divergence': 0.60,
        'adline_increasing': 0.50,
        'adline_decreasing': 0.50,
        'adline_divergence': 0.55,
        'mfi': 0.45
      },

      // Generic volatility signal correlations
      'volatility_breakout': {
        'bollinger_breakout': 0.80,
        'bollinger_squeeze': 0.60,
        'atr_expansion': 0.75,
        'atr_contraction': 0.60,
        'bbw_expansion': 0.70,
        'bbw_narrow': 0.60,
        'keltner_breakout': 0.65,
        'keltner_squeeze': 0.60,
        'donchian_breakout': 0.60,
        'donchian_narrow': 0.60,
        'ttm_breakout': 0.70,
        'ttm_squeeze': 0.60,
        'bollinger': 0.80,
        'Bollinger': 0.80,
        'atr': 0.75,
        'ATR': 0.75,
        'bbw': 0.70,
        'BBW': 0.70,
        'keltner': 0.65,
        'Keltner': 0.65,
        'donchian': 0.60,
        'Donchian': 0.60,
        'ttm_squeeze': 0.60,
        'TTM_Squeeze': 0.60
      },

      // Cross-category correlations (should be low/no correlation)
      // Volume ↔ Momentum (low correlation)
      'volume_spike': {
        'rsi_oversold': 0.20,
        'rsi_overbought': 0.20,
        'stochastic_oversold': 0.20,
        'stochastic_overbought': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'cci_oversold': 0.20,
        'cci_overbought': 0.20,
        'roc_positive': 0.20,
        'roc_negative': 0.20,
        'awesomeoscillator_positive': 0.20,
        'awesomeoscillator_negative': 0.20,
        'cmo_positive': 0.20,
        'cmo_negative': 0.20,
        'mfi_oversold': 0.30,
        'mfi_overbought': 0.30
      },
      'volume_breakout': {
        'rsi_oversold': 0.20,
        'rsi_overbought': 0.20,
        'stochastic_oversold': 0.20,
        'stochastic_overbought': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'cci_oversold': 0.20,
        'cci_overbought': 0.20,
        'roc_positive': 0.20,
        'roc_negative': 0.20,
        'awesomeoscillator_positive': 0.20,
        'awesomeoscillator_negative': 0.20,
        'cmo_positive': 0.20,
        'cmo_negative': 0.20,
        'mfi_oversold': 0.30,
        'mfi_overbought': 0.30
      },
      'volume_profile': {
        'rsi_oversold': 0.20,
        'rsi_overbought': 0.20,
        'stochastic_oversold': 0.20,
        'stochastic_overbought': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'cci_oversold': 0.20,
        'cci_overbought': 0.20,
        'roc_positive': 0.20,
        'roc_negative': 0.20,
        'awesomeoscillator_positive': 0.20,
        'awesomeoscillator_negative': 0.20,
        'cmo_positive': 0.20,
        'cmo_negative': 0.20,
        'mfi_oversold': 0.30,
        'mfi_overbought': 0.30
      },

      // Volume ↔ Trend (low correlation)
      'volume_spike': {
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'macd': 0.20,
        'macd_cross': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'maribbon': 0.20
      },
      'volume_breakout': {
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'macd': 0.20,
        'macd_cross': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'maribbon': 0.20
      },
      'volume_profile': {
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'macd': 0.20,
        'macd_cross': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'maribbon': 0.20
      },

      // Volatility ↔ Momentum (low correlation)
      'volatility_breakout': {
        'rsi_oversold': 0.20,
        'rsi_overbought': 0.20,
        'stochastic_oversold': 0.20,
        'stochastic_overbought': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'cci_oversold': 0.20,
        'cci_overbought': 0.20,
        'roc_positive': 0.20,
        'roc_negative': 0.20,
        'awesomeoscillator_positive': 0.20,
        'awesomeoscillator_negative': 0.20,
        'cmo_positive': 0.20,
        'cmo_negative': 0.20,
        'mfi_oversold': 0.20,
        'mfi_overbought': 0.20
      },

      // Volatility ↔ Volume (low correlation) - merged with above
      'volatility_breakout': {
        'bollinger_breakout': 0.80,
        'bollinger_squeeze': 0.60,
        'atr_expansion': 0.75,
        'atr_contraction': 0.60,
        'bbw_expansion': 0.70,
        'bbw_narrow': 0.60,
        'keltner_breakout': 0.65,
        'keltner_squeeze': 0.60,
        'donchian_breakout': 0.60,
        'donchian_narrow': 0.60,
        'ttm_breakout': 0.70,
        'ttm_squeeze': 0.60,
        'bollinger': 0.80,
        'Bollinger': 0.80,
        'atr': 0.75,
        'ATR': 0.75,
        'bbw': 0.70,
        'BBW': 0.70,
        'keltner': 0.65,
        'Keltner': 0.65,
        'donchian': 0.60,
        'Donchian': 0.60,
        'ttm_squeeze': 0.60,
        'TTM_Squeeze': 0.60,
        // Cross-category correlations
        'rsi_oversold': 0.20,
        'rsi_overbought': 0.20,
        'stochastic_oversold': 0.20,
        'stochastic_overbought': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'cci_oversold': 0.20,
        'cci_overbought': 0.20,
        'roc_positive': 0.20,
        'roc_negative': 0.20,
        'awesomeoscillator_positive': 0.20,
        'awesomeoscillator_negative': 0.20,
        'cmo_positive': 0.20,
        'cmo_negative': 0.20,
        'mfi_oversold': 0.20,
        'mfi_overbought': 0.20,
        'volume_spike': 0.20,
        'volume_breakout': 0.20,
        'volume_profile': 0.20,
        'obv_increasing': 0.20,
        'obv_decreasing': 0.20,
        'obv_divergence': 0.20,
        'cmf_positive': 0.20,
        'cmf_negative': 0.20,
        'cmf_divergence': 0.20,
        'adline_increasing': 0.20,
        'adline_decreasing': 0.20,
        'adline_divergence': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'macd_cross': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'maribbon': 0.20
      },

      // Trend ↔ Volatility (low correlation)
      'macd_cross': {
        'bollinger_squeeze': 0.20,
        'bollinger_breakout': 0.20,
        'atr_expansion': 0.20,
        'atr_contraction': 0.20,
        'bbw_narrow': 0.20,
        'bbw_expansion': 0.20,
        'keltner_squeeze': 0.20,
        'keltner_breakout': 0.20,
        'donchian_narrow': 0.20,
        'donchian_breakout': 0.20,
        'ttm_squeeze': 0.20,
        'ttm_breakout': 0.20,
        'volatility_breakout': 0.20
      },

      // Trend ↔ Volume (low correlation)
      'ema': {
        'obv_increasing': 0.20,
        'obv_decreasing': 0.20,
        'obv_divergence': 0.20,
        'cmf_positive': 0.20,
        'cmf_negative': 0.20,
        'cmf_divergence': 0.20,
        'adline_increasing': 0.20,
        'adline_decreasing': 0.20,
        'adline_divergence': 0.20,
        'volume_spike': 0.20,
        'volume_breakout': 0.20,
        'volume_profile': 0.20
      },

      // Additional missing correlations for specific signals
      'williams_r': {
        'williamsr': 0.95, // Same indicator, different naming
        'wma': 0.20, // Low correlation with trend indicators
        'WMA': 0.20
      },
      'williamsr': {
        'williams_r': 0.95, // Same indicator, different naming
        'wma': 0.20, // Low correlation with trend indicators
        'WMA': 0.20
      },
      'wma': {
        'williams_r': 0.20,
        'williamsr': 0.20,
        'WMA': 0.90, // Same indicator, different naming
        'volume_spike': 0.20,
        'volume_breakout': 0.20,
        'volume_profile': 0.20,
        'volatility_breakout': 0.20,
        'ttm_squeeze': 0.20
      },
      'WMA': {
        'williams_r': 0.20,
        'williamsr': 0.20,
        'wma': 0.90, // Same indicator, different naming
        'volume_spike': 0.20,
        'volume_breakout': 0.20,
        'volume_profile': 0.20,
        'volatility_breakout': 0.20,
        'ttm_squeeze': 0.20
      },
      'ttm_squeeze': {
        'volume_spike': 0.20,
        'volume_breakout': 0.20,
        'volume_profile': 0.20,
        'williams_r': 0.20,
        'williamsr': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'volatility_breakout': 0.60
      },
      'obv_increasing': {
        'volume_spike': 0.60,
        'volume_breakout': 0.65,
        'obv_divergence': 0.70,
        'cmf_positive': 0.75,
        'adline_increasing': 0.80,
        'obv_decreasing': -0.85
      },
      'obv_decreasing': {
        'obv_increasing': -0.85,
        'cmf_negative': 0.75,
        'adline_decreasing': 0.80,
        'volume_spike': -0.40,
        'volume_breakout': -0.45
      },
      'obv_divergence': {
        'volume_spike': 0.70,
        'volume_breakout': 0.75,
        'obv_increasing': 0.70,
        'cmf_divergence': 0.65,
        'adline_divergence': 0.60
      },
      'cmf_positive': {
        'obv_increasing': 0.75,
        'adline_increasing': 0.70,
        'volume_spike': 0.55,
        'volume_breakout': 0.60,
        'cmf_negative': -0.80
      },
      'cmf_negative': {
        'obv_decreasing': 0.75,
        'adline_decreasing': 0.70,
        'cmf_positive': -0.80,
        'volume_spike': -0.40,
        'volume_breakout': -0.45
      },
      'cmf_divergence': {
        'obv_divergence': 0.65,
        'adline_divergence': 0.60,
        'volume_spike': 0.50,
        'volume_breakout': 0.55
      },
      'adline_increasing': {
        'obv_increasing': 0.80,
        'cmf_positive': 0.70,
        'volume_spike': 0.50,
        'volume_breakout': 0.55,
        'adline_decreasing': -0.85
      },
      'adline_decreasing': {
        'obv_decreasing': 0.80,
        'cmf_negative': 0.70,
        'adline_increasing': -0.85,
        'volume_spike': -0.40,
        'volume_breakout': -0.45
      },
      'adline_divergence': {
        'obv_divergence': 0.60,
        'cmf_divergence': 0.60,
        'volume_spike': 0.45,
        'volume_breakout': 0.50
      },

      // Volatility indicators - comprehensive correlations
      'bollinger_squeeze': {
        'bollinger_breakout': 0.60,
        'atr_expansion': 0.70,
        'volatility_breakout': 0.75,
        'bbw_narrow': 0.80,
        'keltner_squeeze': 0.65,
        'donchian_narrow': 0.55,
        'ttm_squeeze': 0.75
      },
      'bollinger_breakout': {
        'bollinger_squeeze': 0.60,
        'atr_expansion': 0.65,
        'volatility_breakout': 0.80,
        'bbw_expansion': 0.70,
        'keltner_breakout': 0.60,
        'donchian_breakout': 0.55,
        'ttm_breakout': 0.70
      },
      'atr_expansion': {
        'bollinger_squeeze': 0.70,
        'bollinger_breakout': 0.65,
        'volatility_breakout': 0.75,
        'bbw_expansion': 0.60,
        'keltner_expansion': 0.55,
        'donchian_expansion': 0.50,
        'atr_contraction': -0.80
      },
      'atr_contraction': {
        'atr_expansion': -0.80,
        'bollinger_squeeze': 0.60,
        'bbw_narrow': 0.70,
        'keltner_squeeze': 0.55,
        'donchian_narrow': 0.50
      },
      'bbw_narrow': {
        'bollinger_squeeze': 0.80,
        'atr_contraction': 0.70,
        'keltner_squeeze': 0.65,
        'donchian_narrow': 0.60,
        'ttm_squeeze': 0.75,
        'bbw_expansion': -0.85
      },
      'bbw_expansion': {
        'bollinger_breakout': 0.70,
        'atr_expansion': 0.60,
        'keltner_breakout': 0.55,
        'donchian_breakout': 0.50,
        'ttm_breakout': 0.65,
        'bbw_narrow': -0.85
      },
      'keltner_squeeze': {
        'bollinger_squeeze': 0.65,
        'bbw_narrow': 0.65,
        'atr_contraction': 0.55,
        'donchian_narrow': 0.60,
        'ttm_squeeze': 0.70,
        'keltner_breakout': -0.80
      },
      'keltner_breakout': {
        'bollinger_breakout': 0.60,
        'bbw_expansion': 0.55,
        'atr_expansion': 0.55,
        'donchian_breakout': 0.60,
        'ttm_breakout': 0.65,
        'keltner_squeeze': -0.80
      },
      'donchian_narrow': {
        'bollinger_squeeze': 0.55,
        'bbw_narrow': 0.60,
        'atr_contraction': 0.50,
        'keltner_squeeze': 0.60,
        'ttm_squeeze': 0.55,
        'donchian_breakout': -0.75
      },
      'donchian_breakout': {
        'bollinger_breakout': 0.55,
        'bbw_expansion': 0.50,
        'atr_expansion': 0.50,
        'keltner_breakout': 0.60,
        'ttm_breakout': 0.55,
        'donchian_narrow': -0.75
      },
      'ttm_squeeze': {
        'bollinger_squeeze': 0.75,
        'bbw_narrow': 0.75,
        'atr_contraction': 0.60,
        'keltner_squeeze': 0.70,
        'donchian_narrow': 0.55,
        'ttm_breakout': -0.85
      },
      'ttm_breakout': {
        'bollinger_breakout': 0.70,
        'bbw_expansion': 0.65,
        'atr_expansion': 0.60,
        'keltner_breakout': 0.65,
        'donchian_breakout': 0.55,
        'ttm_squeeze': -0.85
      },

      // Pattern signals - low correlation with technical indicators
      'head_shoulders': {
        'double_top': 0.40,
        'double_bottom': -0.30,
        'triangle': 0.20
      },
      'double_top': {
        'head_shoulders': 0.40,
        'double_bottom': -0.50,
        'triangle': 0.25
      },
      'double_bottom': {
        'head_shoulders': -0.30,
        'double_top': -0.50,
        'triangle': 0.20
      },

      // Candlestick patterns - low correlation with technical indicators
      'doji': {
        'hammer': 0.30,
        'shooting_star': 0.25,
        'engulfing': 0.35
      },
      'hammer': {
        'doji': 0.30,
        'shooting_star': -0.40,
        'engulfing': 0.50
      },
      'shooting_star': {
        'doji': 0.25,
        'hammer': -0.40,
        'engulfing': 0.45
      },

      // Additional signal type mappings for actual generated signals
      'macd': {
        'MACD': 0.95,
        'ema': 0.70,
        'EMA': 0.70,
        'ma200': 0.65,
        'MA200': 0.65,
        'tema': 0.50,
        'TEMA': 0.50,
        'dema': 0.55,
        'DEMA': 0.55,
        'hma': 0.50,
        'HMA': 0.50,
        'wma': 0.50,
        'WMA': 0.50,
        'psar': 0.50,
        'PSAR': 0.50,
        'adx': 0.40,
        'ADX': 0.40,
        'ichimoku': 0.50,
        'Ichimoku': 0.50,
        'maribbon': 0.45,
        'MARibbon': 0.45,
        'macd_cross': 0.85,
        'macd_divergence': 0.60,
        'macd_histogram': 0.55
      },
      'bollinger': {
        'Bollinger': 0.95,
        'atr': 0.80,
        'ATR': 0.80,
        'bbw': 0.85,
        'BBW': 0.85,
        'keltner': 0.75,
        'Keltner': 0.75,
        'donchian': 0.70,
        'Donchian': 0.70,
        'ttm_squeeze': 0.80,
        'TTM_Squeeze': 0.80,
        'volatility_breakout': 0.80
      },
      'atr': {
        'ATR': 0.95,
        'bollinger': 0.80,
        'Bollinger': 0.80,
        'bbw': 0.75,
        'BBW': 0.75,
        'keltner': 0.70,
        'Keltner': 0.70,
        'donchian': 0.65,
        'Donchian': 0.65,
        'ttm_squeeze': 0.75,
        'TTM_Squeeze': 0.75,
        'volatility_breakout': 0.75
      },
      'bbw': {
        'BBW': 0.95,
        'bollinger': 0.85,
        'Bollinger': 0.85,
        'atr': 0.75,
        'ATR': 0.75,
        'keltner': 0.65,
        'Keltner': 0.65,
        'donchian': 0.60,
        'Donchian': 0.60,
        'ttm_squeeze': 0.75,
        'TTM_Squeeze': 0.75,
        'volatility_breakout': 0.70
      },
      'keltner': {
        'Keltner': 0.95,
        'bollinger': 0.75,
        'Bollinger': 0.75,
        'atr': 0.70,
        'ATR': 0.70,
        'bbw': 0.65,
        'BBW': 0.65,
        'donchian': 0.60,
        'Donchian': 0.60,
        'ttm_squeeze': 0.70,
        'TTM_Squeeze': 0.70,
        'volatility_breakout': 0.65
      },
      'donchian': {
        'Donchian': 0.95,
        'bollinger': 0.70,
        'Bollinger': 0.70,
        'atr': 0.65,
        'ATR': 0.65,
        'bbw': 0.60,
        'BBW': 0.60,
        'keltner': 0.60,
        'Keltner': 0.60,
        'ttm_squeeze': 0.55,
        'TTM_Squeeze': 0.55,
        'volatility_breakout': 0.60
      },
      'ttm_squeeze': {
        'TTM_Squeeze': 0.95,
        'bollinger': 0.80,
        'Bollinger': 0.80,
        'atr': 0.75,
        'ATR': 0.75,
        'bbw': 0.75,
        'BBW': 0.75,
        'keltner': 0.70,
        'Keltner': 0.70,
        'donchian': 0.55,
        'Donchian': 0.55,
        'volatility_breakout': 0.60
      },
      'volume': {
        'Volume': 0.95,
        'obv': 0.60,
        'OBV': 0.60,
        'cmf': 0.55,
        'CMF': 0.55,
        'adline': 0.50,
        'ADLine': 0.50,
        'mfi': 0.45,
        'MFI': 0.45,
        'volume_spike': 0.90,
        'volume_breakout': 0.80,
        'volume_profile': 0.70
      },
      'obv': {
        'OBV': 0.95,
        'volume': 0.60,
        'Volume': 0.60,
        'cmf': 0.75,
        'CMF': 0.75,
        'adline': 0.70,
        'ADLine': 0.70,
        'mfi': 0.60,
        'MFI': 0.60,
        'volume_spike': 0.60,
        'volume_breakout': 0.65,
        'volume_profile': 0.60
      },
      'cmf': {
        'CMF': 0.95,
        'volume': 0.55,
        'Volume': 0.55,
        'obv': 0.75,
        'OBV': 0.75,
        'adline': 0.65,
        'ADLine': 0.65,
        'mfi': 0.55,
        'MFI': 0.55,
        'volume_spike': 0.55,
        'volume_breakout': 0.60,
        'volume_profile': 0.55
      },
      'adline': {
        'ADLine': 0.95,
        'volume': 0.50,
        'Volume': 0.50,
        'obv': 0.70,
        'OBV': 0.70,
        'cmf': 0.65,
        'CMF': 0.65,
        'mfi': 0.50,
        'MFI': 0.50,
        'volume_spike': 0.50,
        'volume_breakout': 0.55,
        'volume_profile': 0.50
      },
      'mfi': {
        'MFI': 0.95,
        'volume': 0.45,
        'Volume': 0.45,
        'obv': 0.60,
        'OBV': 0.60,
        'cmf': 0.55,
        'CMF': 0.55,
        'adline': 0.50,
        'ADLine': 0.50,
        'rsi': 0.65,
        'RSI': 0.65,
        'stochastic': 0.60,
        'Stochastic': 0.60,
        'williamsr': 0.60,
        'cci': 0.55,
        'CCI': 0.55
      },
      'roc': {
        'ROC': 0.95,
        'rsi': 0.60,
        'RSI': 0.60,
        'stochastic': 0.55,
        'Stochastic': 0.55,
        'williamsr': 0.70,
        'cci': 0.60,
        'CCI': 0.60,
        'awesomeoscillator': 0.70,
        'awesomeOscillator': 0.70,
        'cmo': 0.65,
        'CMO': 0.65,
        'mfi': 0.60,
        'MFI': 0.60
      },
      'awesomeoscillator': {
        'awesomeOscillator': 0.95,
        'roc': 0.70,
        'ROC': 0.70,
        'cmo': 0.65,
        'CMO': 0.65,
        'rsi': 0.55,
        'RSI': 0.55,
        'stochastic': 0.50,
        'Stochastic': 0.50,
        'williamsr': 0.65,
        'cci': 0.55,
        'CCI': 0.55,
        'mfi': 0.55,
        'MFI': 0.55
      },
      'cmo': {
        'CMO': 0.95,
        'roc': 0.65,
        'ROC': 0.65,
        'awesomeoscillator': 0.65,
        'awesomeOscillator': 0.65,
        'rsi': 0.55,
        'RSI': 0.55,
        'stochastic': 0.50,
        'Stochastic': 0.50,
        'williamsr': 0.70,
        'cci': 0.50,
        'CCI': 0.50,
        'mfi': 0.60,
        'MFI': 0.60
      },
      'williamsr': {
        'williams_r': 0.95,
        'rsi': 0.75,
        'RSI': 0.75,
        'stochastic': 0.85,
        'Stochastic': 0.85,
        'cci': 0.65,
        'CCI': 0.65,
        'roc': 0.70,
        'ROC': 0.70,
        'awesomeoscillator': 0.65,
        'awesomeOscillator': 0.65,
        'cmo': 0.70,
        'CMO': 0.70,
        'mfi': 0.60,
        'MFI': 0.60
      },

      // Comprehensive lowercase signal type correlations
      'rsi': {
        'RSI': 0.95,
        'stochastic': 0.80,
        'Stochastic': 0.80,
        'williamsr': 0.75,
        'williams_r': 0.75,
        'cci': 0.70,
        'CCI': 0.70,
        'roc': 0.60,
        'awesomeoscillator': 0.55,
        'cmo': 0.55,
        'mfi': 0.65,
        'MFI': 0.65,
        // Cross-category correlations
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'macd': {
        'MACD': 0.95,
        'ema': 0.70,
        'EMA': 0.70,
        'ma200': 0.65,
        'MA200': 0.65,
        'ichimoku': 0.75,
        'Ichimoku': 0.75,
        'adx': 0.60,
        'ADX': 0.60,
        'psar': 0.70,
        'PSAR': 0.70,
        'tema': 0.70,
        'dema': 0.70,
        'hma': 0.70,
        'wma': 0.70,
        'WMA': 0.70,
        'maribbon': 0.80,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'mfi': 0.20,
        'MFI': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'bollinger': {
        'Bollinger': 0.95,
        'atr': 0.80,
        'ATR': 0.80,
        'bbw': 0.85,
        'BBW': 0.85,
        'keltner': 0.75,
        'Keltner': 0.75,
        'donchian': 0.70,
        'Donchian': 0.70,
        'ttm_squeeze': 0.80,
        'TTM_Squeeze': 0.80,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'mfi': 0.20,
        'MFI': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'volume': {
        'obv': 0.60,
        'OBV': 0.60,
        'cmf': 0.55,
        'CMF': 0.55,
        'adline': 0.50,
        'ADLine': 0.50,
        'mfi': 0.45,
        'MFI': 0.45,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20
      },
      'atr': {
        'ATR': 0.95,
        'bollinger': 0.80,
        'Bollinger': 0.80,
        'bbw': 0.75,
        'BBW': 0.75,
        'keltner': 0.70,
        'Keltner': 0.70,
        'donchian': 0.65,
        'Donchian': 0.65,
        'ttm_squeeze': 0.75,
        'TTM_Squeeze': 0.75,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'mfi': 0.20,
        'MFI': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'obv': {
        'OBV': 0.95,
        'cmf': 0.75,
        'CMF': 0.75,
        'adline': 0.70,
        'ADLine': 0.70,
        'mfi': 0.60,
        'MFI': 0.60,
        'volume': 0.60,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20
      },
      'cmf': {
        'CMF': 0.95,
        'obv': 0.75,
        'OBV': 0.75,
        'adline': 0.65,
        'ADLine': 0.65,
        'mfi': 0.55,
        'MFI': 0.55,
        'volume': 0.55,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20
      },
      'mfi': {
        'MFI': 0.95,
        'obv': 0.60,
        'OBV': 0.60,
        'cmf': 0.55,
        'CMF': 0.55,
        'adline': 0.50,
        'ADLine': 0.50,
        'volume': 0.45,
        // Cross-category correlations
        'rsi': 0.20,
        'RSI': 0.20,
        'stochastic': 0.20,
        'Stochastic': 0.20,
        'williamsr': 0.20,
        'williams_r': 0.20,
        'cci': 0.20,
        'CCI': 0.20,
        'roc': 0.20,
        'awesomeoscillator': 0.20,
        'cmo': 0.20,
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20
      },
      'cci': {
        'CCI': 0.95,
        'rsi': 0.70,
        'RSI': 0.70,
        'stochastic': 0.80,
        'Stochastic': 0.80,
        'williamsr': 0.85,
        'williams_r': 0.85,
        'roc': 0.70,
        'awesomeoscillator': 0.65,
        'cmo': 0.70,
        'mfi': 0.75,
        'MFI': 0.75,
        // Cross-category correlations
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'roc': {
        'rsi': 0.60,
        'RSI': 0.60,
        'stochastic': 0.65,
        'Stochastic': 0.65,
        'williamsr': 0.70,
        'williams_r': 0.70,
        'cci': 0.70,
        'CCI': 0.70,
        'awesomeoscillator': 0.80,
        'cmo': 0.85,
        'mfi': 0.60,
        'MFI': 0.60,
        // Cross-category correlations
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'awesomeoscillator': {
        'rsi': 0.55,
        'RSI': 0.55,
        'stochastic': 0.60,
        'Stochastic': 0.60,
        'williamsr': 0.65,
        'williams_r': 0.65,
        'cci': 0.65,
        'CCI': 0.65,
        'roc': 0.80,
        'cmo': 0.75,
        'mfi': 0.55,
        'MFI': 0.55,
        // Cross-category correlations
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      },
      'cmo': {
        'rsi': 0.55,
        'RSI': 0.55,
        'stochastic': 0.65,
        'Stochastic': 0.65,
        'williamsr': 0.70,
        'williams_r': 0.70,
        'cci': 0.70,
        'CCI': 0.70,
        'roc': 0.85,
        'awesomeoscillator': 0.75,
        'mfi': 0.60,
        'MFI': 0.60,
        // Cross-category correlations
        'macd': 0.20,
        'MACD': 0.20,
        'ema': 0.20,
        'EMA': 0.20,
        'ma200': 0.20,
        'MA200': 0.20,
        'ichimoku': 0.20,
        'Ichimoku': 0.20,
        'adx': 0.20,
        'ADX': 0.20,
        'psar': 0.20,
        'PSAR': 0.20,
        'tema': 0.20,
        'dema': 0.20,
        'hma': 0.20,
        'wma': 0.20,
        'WMA': 0.20,
        'maribbon': 0.20,
        'bollinger': 0.20,
        'Bollinger': 0.20,
        'atr': 0.20,
        'ATR': 0.20,
        'bbw': 0.20,
        'BBW': 0.20,
        'keltner': 0.20,
        'Keltner': 0.20,
        'donchian': 0.20,
        'Donchian': 0.20,
        'ttm_squeeze': 0.20,
        'TTM_Squeeze': 0.20,
        'volume': 0.20,
        'obv': 0.20,
        'OBV': 0.20,
        'cmf': 0.20,
        'CMF': 0.20,
        'adline': 0.20,
        'ADLine': 0.20
      }
    };
  }

  /**
   * Calculate correlation between two signals
   * @param {string} signalType1 - First signal type
   * @param {string} signalType2 - Second signal type
   * @returns {number} Correlation coefficient (-1 to 1)
   */
  calculateCorrelation(signalType1, signalType2) {
    if (!signalType1 || !signalType2 || signalType1 === signalType2) {
      return 0;
    }

    const type1 = signalType1.toLowerCase();
    const type2 = signalType2.toLowerCase();

    // Check direct correlation
    if (this.correlationMatrix[type1] && this.correlationMatrix[type1][type2]) {
      return this.correlationMatrix[type1][type2];
    }

    // Check reverse correlation
    if (this.correlationMatrix[type2] && this.correlationMatrix[type2][type1]) {
      return this.correlationMatrix[type2][type1];
    }
    
    // Log missing correlation for debugging - NO FALLBACKS as requested
    console.error(`❌ [CORRELATION_DETECTOR] Missing correlation mapping: ${type1} ↔ ${type2}`);
    
    return 0; // No correlation found
  }

  /**
   * Detect highly correlated signals in a combination
   * @param {Array} signals - Array of signal objects
   * @returns {Array} Array of correlation pairs
   */
  detectCorrelations(signals) {
    const correlations = [];
    
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        const signal1 = signals[i];
        const signal2 = signals[j];
        
        if (!signal1.type || !signal2.type) {
          continue;
        }
        
        const correlation = this.calculateCorrelation(signal1.type, signal2.type);
        
        if (Math.abs(correlation) >= this.correlationThreshold) {
          const correlationPair = {
            signal1: signal1.type,
            signal2: signal2.type,
            correlation: correlation,
            isHighCorrelation: Math.abs(correlation) >= this.correlationThreshold
          };
          correlations.push(correlationPair);
        }
      }
    }
    
    return correlations;
  }

  /**
   * Calculate correlation penalty for a signal combination
   * @param {Array} signals - Array of signal objects
   * @returns {number} Correlation penalty (0 to 1)
   */
  calculateCorrelationPenalty(signals) {
    if (!signals || signals.length < 2) {
      return 0;
    }

    const correlations = this.detectCorrelations(signals);
    
    if (correlations.length === 0) {
      return 0; // No correlations, no penalty
    }

    // Calculate penalty based on average correlation strength (not sum)
    let totalCorrelationStrength = 0;
    
    for (const correlation of correlations) {
      totalCorrelationStrength += Math.abs(correlation.correlation);
    }
    
    // Use average correlation strength with reduced penalty factor
    const averageCorrelationStrength = totalCorrelationStrength / correlations.length;
    const penalty = averageCorrelationStrength * 0.15; // Reduced from 30% to 15%

    // Cap penalty at 25% to avoid completely nullifying signals
    return Math.min(0.25, penalty);
  }

  /**
   * Calculate correlation bonus for complementary signals
   * @param {Array} signals - Array of signal objects
   * @returns {number} Correlation bonus (0 to 1)
   */
  calculateCorrelationBonus(signals) {
    if (!signals || signals.length < 2) {
      return 0;
    }

    const correlations = this.detectCorrelations(signals);
    let totalBonus = 0;
    
    for (const correlation of correlations) {
      // Negative correlation indicates complementary signals
      if (correlation.correlation < -0.5) {
        const bonus = Math.abs(correlation.correlation) * 0.2; // 20% bonus for complementary signals
        totalBonus += bonus;
      }
    }

    // Cap bonus at 30% to avoid over-inflating strength
    return Math.min(0.3, totalBonus);
  }

  /**
   * Get signal diversity score for a combination
   * @param {Array} signals - Array of signal objects
   * @returns {number} Diversity score (0 to 1)
   */
  getDiversityScore(signals) {
    if (!signals || signals.length === 0) {
      return 0;
    }

    const signalTypes = signals.map(s => s.type?.toLowerCase()).filter(Boolean);
    const uniqueTypes = new Set(signalTypes);
    
    // Base diversity score
    const baseDiversity = uniqueTypes.size / signalTypes.length;
    
    // Apply correlation penalty
    const correlationPenalty = this.calculateCorrelationPenalty(signals);
    
    // Apply correlation bonus
    const correlationBonus = this.calculateCorrelationBonus(signals);
    
    return Math.max(0, Math.min(1, baseDiversity - correlationPenalty + correlationBonus));
  }

  /**
   * Filter signals to remove highly correlated ones
   * @param {Array} signals - Array of signal objects
   * @param {number} maxCorrelation - Maximum allowed correlation (default: 0.8)
   * @returns {Array} Filtered signals array
   */
  filterCorrelatedSignals(signals, maxCorrelation = 0.8) {
    if (!signals || signals.length <= 1) {
      return signals;
    }

    const filteredSignals = [];
    const usedSignals = new Set();
    
    // Sort signals by strength (highest first)
    const sortedSignals = [...signals].sort((a, b) => (b.strength || 0) - (a.strength || 0));
    
    for (const signal of sortedSignals) {
      if (usedSignals.has(signal.type)) {
        continue; // Skip if signal type already used
      }
      
      let isCorrelated = false;
      
      // Check correlation with already selected signals
      for (const usedSignal of filteredSignals) {
        const correlation = this.calculateCorrelation(signal.type, usedSignal.type);
        if (Math.abs(correlation) >= maxCorrelation) {
          isCorrelated = true;
          break;
        }
      }
      
      if (!isCorrelated) {
        filteredSignals.push(signal);
        usedSignals.add(signal.type);
      }
    }
    
    return filteredSignals;
  }

  /**
   * Get correlation report for a signal combination
   * @param {Array} signals - Array of signal objects
   * @returns {Object} Correlation report
   */
  getCorrelationReport(signals) {
    const correlations = this.detectCorrelations(signals);
    const penalty = this.calculateCorrelationPenalty(signals);
    const bonus = this.calculateCorrelationBonus(signals);
    const diversityScore = this.getDiversityScore(signals);
    
    // DEBUG: Removed to prevent log flooding
    
    return {
      correlations,
      penalty,
      bonus,
      diversityScore,
      hasHighCorrelations: correlations.some(c => c.isHighCorrelation),
      correlationCount: correlations.length,
      averageCorrelation: correlations.length > 0 
        ? correlations.reduce((sum, c) => sum + Math.abs(c.correlation), 0) / correlations.length 
        : 0
    };
  }

  /**
   * Test all correlations in the matrix to ensure proper values
   * This function tests every possible signal combination and reports results
   */
  testAllCorrelations() {
    console.log('🧪 [CORRELATION_TEST] Starting comprehensive correlation test...');
    
    const allSignalTypes = this.getAllSignalTypes();
    const testResults = {
      totalTests: 0,
      successfulTests: 0,
      failedTests: 0,
      missingCorrelations: [],
      correlationStats: {
        highCorrelations: 0,
        moderateCorrelations: 0,
        lowCorrelations: 0,
        negativeCorrelations: 0
      }
    };

    console.log(`📊 [CORRELATION_TEST] Testing ${allSignalTypes.length} signal types...`);
    
    // Test every possible combination
    for (let i = 0; i < allSignalTypes.length; i++) {
      for (let j = i + 1; j < allSignalTypes.length; j++) {
        const signal1 = allSignalTypes[i];
        const signal2 = allSignalTypes[j];
        
        testResults.totalTests++;
        
        const correlation = this.calculateCorrelation(signal1, signal2);
        
        if (correlation !== 0) {
          testResults.successfulTests++;
          
          // Categorize correlation strength
          const absCorrelation = Math.abs(correlation);
          if (absCorrelation >= 0.8) {
            testResults.correlationStats.highCorrelations++;
          } else if (absCorrelation >= 0.5) {
            testResults.correlationStats.moderateCorrelations++;
          } else {
            testResults.correlationStats.lowCorrelations++;
          }
          
          if (correlation < 0) {
            testResults.correlationStats.negativeCorrelations++;
          }
          
          console.log(`✅ [CORRELATION_TEST] ${signal1} ↔ ${signal2}: ${correlation.toFixed(3)}`);
        } else {
          testResults.failedTests++;
          testResults.missingCorrelations.push(`${signal1} ↔ ${signal2}`);
          console.log(`❌ [CORRELATION_TEST] ${signal1} ↔ ${signal2}: NO CORRELATION`);
        }
      }
    }

    // Print comprehensive test results
    console.log('\n📈 [CORRELATION_TEST] === TEST RESULTS SUMMARY ===');
    console.log(`Total Tests: ${testResults.totalTests}`);
    console.log(`Successful Tests: ${testResults.successfulTests} (${((testResults.successfulTests / testResults.totalTests) * 100).toFixed(1)}%)`);
    console.log(`Failed Tests: ${testResults.failedTests} (${((testResults.failedTests / testResults.totalTests) * 100).toFixed(1)}%)`);
    
    console.log('\n📊 [CORRELATION_TEST] === CORRELATION STATISTICS ===');
    console.log(`High Correlations (≥0.8): ${testResults.correlationStats.highCorrelations}`);
    console.log(`Moderate Correlations (0.5-0.8): ${testResults.correlationStats.moderateCorrelations}`);
    console.log(`Low Correlations (<0.5): ${testResults.correlationStats.lowCorrelations}`);
    console.log(`Negative Correlations: ${testResults.correlationStats.negativeCorrelations}`);

    if (testResults.missingCorrelations.length > 0) {
      console.log('\n❌ [CORRELATION_TEST] === MISSING CORRELATIONS ===');
      testResults.missingCorrelations.forEach(missing => {
        console.log(`Missing: ${missing}`);
      });
    }

    // Test specific signal combinations
    console.log('\n🔍 [CORRELATION_TEST] === SPECIFIC COMBINATION TESTS ===');
    this.testSpecificCombinations();

    return testResults;
  }

  /**
   * Get all signal types from the correlation matrix
   * @returns {Array} Array of all signal types
   */
  getAllSignalTypes() {
    const signalTypes = new Set();
    
    // Add all signal types from the correlation matrix
    Object.keys(this.correlationMatrix).forEach(signalType => {
      signalTypes.add(signalType);
      Object.keys(this.correlationMatrix[signalType]).forEach(correlatedType => {
        signalTypes.add(correlatedType);
      });
    });
    
    return Array.from(signalTypes).sort();
  }

  /**
   * Test specific signal combinations that are commonly used
   */
  testSpecificCombinations() {
    const testCombinations = [
      // Momentum combinations
      ['rsi_oversold', 'stochastic_oversold', 'williams_r'],
      ['rsi_oversold', 'cci_oversold', 'roc_positive'],
      ['stochastic_oversold', 'awesomeoscillator_positive', 'cmo_positive'],
      
      // Trend combinations
      ['macd_cross', 'ema_cross', 'ma200'],
      ['ema', 'dema', 'tema'],
      ['adx', 'psar', 'macd_cross'],
      
      // Volume combinations
      ['volume_spike', 'obv_increasing', 'cmf_positive'],
      ['obv_divergence', 'cmf_divergence', 'adline_divergence'],
      
      // Volatility combinations
      ['bollinger_squeeze', 'bbw_narrow', 'ttm_squeeze'],
      ['bollinger_breakout', 'atr_expansion', 'keltner_breakout'],
      
      // Cross-category combinations (should have low/no correlation)
      ['rsi_oversold', 'volume_spike'],
      ['macd_cross', 'bollinger_squeeze'],
      ['ema', 'obv_increasing']
    ];

    testCombinations.forEach((combination, index) => {
      console.log(`\n🧪 [COMBINATION_TEST] Test ${index + 1}: ${combination.join(' + ')}`);
      
      const signals = combination.map(type => ({ type, strength: 70 }));
      const report = this.getCorrelationReport(signals);
      
      console.log(`   Correlations Found: ${report.correlationCount}`);
      console.log(`   Correlation Penalty: ${(report.penalty * 100).toFixed(1)}%`);
      console.log(`   Correlation Bonus: ${(report.bonus * 100).toFixed(1)}%`);
      console.log(`   Diversity Score: ${report.diversityScore.toFixed(3)}`);
      
      if (report.correlations.length > 0) {
        report.correlations.forEach(corr => {
          console.log(`   ${corr.signal1} ↔ ${corr.signal2}: ${corr.correlation.toFixed(3)}`);
        });
      }
    });
  }
}

export default SignalCorrelationDetector;
