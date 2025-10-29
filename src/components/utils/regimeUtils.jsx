
let regimeTracker = {};

// Initializes or resets the regime tracker for a new backtest run
export const initializeRegimeTracker = (onLogCallback) => {
    regimeTracker = {
        regimeStats: {
            'Uptrend': 0,
            'Downtrend': 0,
            'Ranging / Sideways': 0,
            'High Volatility': 0,
            'Low Volatility': 0
        },
        lastLoggedRegime: null,
        regimeChangeCount: 0,
        totalCandles: 0,
        onLogCallback
    };
};

export const getRegimeMultiplier = (marketRegime, signalType, signalDirection) => {
    // Add defensive programming to handle non-string signalType
    if (!signalType || typeof signalType !== 'string') {
        console.error('[regime_debug] ❌ Invalid signalType:', { signalType, type: typeof signalType });
        return 1.0; // Return neutral multiplier for invalid signalType
    }
    
    // Normalize signal type to lowercase for consistent comparison
    const normalizedSignalType = signalType.toLowerCase();
    
    // Normalize signal direction for consistency
    const normalizedDirection = signalDirection?.toLowerCase();
    
    switch (marketRegime) {
        case 'Bullish Trend':
        case 'Uptrend':
            if (normalizedDirection === 'bullish' || normalizedDirection === 'uptrend') return 1.2; // Boost bullish signals
            if (normalizedDirection === 'bearish' || normalizedDirection === 'downtrend') return 0.8; // Dampen bearish signals
            // Trend-following signals stronger in uptrends
            if (['macd', 'ema', 'ma200', 'psar', 'adx', 'tema', 'dema', 'hma', 'wma'].includes(normalizedSignalType)) return 1.15;
            break;
            
        case 'Bearish Trend':
        case 'Downtrend':
            if (normalizedDirection === 'bullish' || normalizedDirection === 'uptrend') return 0.8; // Dampen bullish signals
            if (normalizedDirection === 'bearish' || normalizedDirection === 'downtrend') return 1.2; // Boost bearish signals
            // Trend-following signals stronger in downtrends
            if (['macd', 'ema', 'ma200', 'psar', 'adx', 'tema', 'dema', 'hma', 'wma'].includes(normalizedSignalType)) return 1.15;
            break;
            
        case 'Ranging':
        case 'Ranging / Sideways':
            // Mean-reversion signals stronger in ranging markets
            if (['rsi', 'stochastic', 'bollinger', 'williamsr', 'cci', 'roc'].includes(normalizedSignalType)) return 1.15;
            // Trend-following signals weaker
            if (['macd', 'ema', 'ma200', 'psar', 'adx', 'tema', 'dema', 'hma', 'wma'].includes(normalizedSignalType)) return 0.85;
            break;
            
        case 'Volatile':
        case 'High Volatility':
            // Breakout signals stronger in volatile markets
            if (['bollinger', 'donchian', 'atr', 'bbw', 'keltner'].includes(normalizedSignalType)) return 1.2;
            // Reversal signals riskier in volatile markets
            if (['rsi', 'stochastic', 'williamsr'].includes(normalizedSignalType)) return 0.9;
            break;
            
        case 'Low Volatility':
            // Mean-reversion signals stronger in low volatility
            if (['rsi', 'stochastic', 'bollinger', 'williamsr'].includes(normalizedSignalType)) return 1.1;
            // Breakout signals weaker
            if (['donchian', 'atr', 'bbw'].includes(normalizedSignalType)) return 0.9;
            break;
            
        default:
            // For 'unknown' or any other unhandled regime, return a neutral multiplier.
            return 1.0;
    }

    // FIX: Add a fallback default return value to prevent returning undefined.
    // This handles cases where a specific signalDirection isn't defined for a given regime.
    return 1.0;
};

export const logRegimeStatistics = () => {
    if (regimeTracker.onLogCallback && regimeTracker.totalCandles > 0) {
        let logMessage = "\n\n--- Market Regime Analysis ---\n";
        for (const regime in regimeTracker.regimeStats) {
            const percentage = ((regimeTracker.regimeStats[regime] / regimeTracker.totalCandles) * 100).toFixed(1);
            logMessage += `\n📈 ${regime}: ${regimeTracker.regimeStats[regime]} candles (${percentage}%)`;
        }
        logMessage += `\n\n🔄 Total regime changes: ${regimeTracker.regimeChangeCount}`;

        // Find the dominant regime
        const dominantRegime = Object.keys(regimeTracker.regimeStats).reduce((a, b) =>
            regimeTracker.regimeStats[a] > regimeTracker.regimeStats[b] ? a : b
        );
        logMessage += `\n\n💡 Market was primarily in "${dominantRegime}" during this period.`;
        logMessage += "\n\n--- End Regime Analysis ---\n";
        regimeTracker.onLogCallback(logMessage, 'summary');
    }
};
