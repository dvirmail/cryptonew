
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
    // A simple multiplier system based on regime. Can be expanded.
    switch (marketRegime) {
        case 'Bullish Trend':
            if (signalDirection === 'bullish') return 1.2; // Boost bullish signals
            if (signalDirection === 'bearish') return 0.8; // Dampen bearish signals
            break;
        case 'Bearish Trend':
            if (signalDirection === 'bullish') return 0.8; // Dampen bullish signals
            if (signalDirection === 'bearish') return 1.2; // Boost bearish signals
            break;
        case 'Ranging':
            // In ranging markets, mean-reversion signals are stronger
            if (signalType === 'rsi' || signalType === 'stochastic' || signalType === 'bollinger') {
                return 1.15;
            }
            // Trend-following signals are weaker
            if (signalType === 'macd' || signalType === 'ema') {
                return 0.85;
            }
            break;
        case 'Volatile':
            // Breakout signals could be stronger, reversal signals riskier
            if (signalType === 'bollinger' || signalType === 'donchian') { // Breakout-style signals
                return 1.2;
            }
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
