/**
 * Signal Name Registry
 * Centralized canonical signal names for consistent correlation between backtest and autoscanner
 * 
 * This ensures that signal names are normalized and consistent across:
 * - Backtest engine signal detection
 * - Combination storage in database
 * - Autoscanner signal matching
 */

export const SIGNAL_NAME_REGISTRY = {
    MACD: {
        // Existing signals
        'Bullish Cross': 'Bullish Cross',
        'Bearish Cross': 'Bearish Cross',
        'MACD Above Zero': 'MACD Above Zero',
        'MACD Below Zero': 'MACD Below Zero',
        'MACD Above Signal': 'MACD Above Signal',
        'MACD Below Signal': 'MACD Below Signal',
        
        // Phase 1: NEW Divergence Signals
        'MACD Histogram Regular Bullish Divergence': 'MACD Histogram Regular Bullish Divergence',
        'MACD Histogram Regular Bearish Divergence': 'MACD Histogram Regular Bearish Divergence',
        'MACD Histogram Hidden Bullish Divergence': 'MACD Histogram Hidden Bullish Divergence',
        'MACD Histogram Hidden Bearish Divergence': 'MACD Histogram Hidden Bearish Divergence',
    },
    MFI: {
        // Existing signals
        'Oversold Entry': 'Oversold Entry',
        'Overbought Exit': 'Overbought Exit',
        'Above 80': 'Above 80',
        'Below 20': 'Below 20',
        
        // Phase 1: NEW Divergence Signals
        'MFI Regular Bullish Divergence': 'MFI Regular Bullish Divergence',
        'MFI Regular Bearish Divergence': 'MFI Regular Bearish Divergence',
        'MFI Failure Swing Bullish': 'MFI Failure Swing Bullish',
        'MFI Failure Swing Bearish': 'MFI Failure Swing Bearish',
    },
    OBV: {
        // Existing signals
        'OBV Trend Cross Bullish': 'OBV Trend Cross Bullish',
        'OBV Trend Cross Bearish': 'OBV Trend Cross Bearish',
        
        // Phase 1: NEW Divergence Signals
        'OBV Bullish Divergence': 'OBV Bullish Divergence',
        'OBV Bearish Divergence': 'OBV Bearish Divergence',
    },
    RSI: {
        'Oversold Entry': 'Oversold Entry',
        'Oversold Exit': 'Oversold Exit',
        'Overbought Entry': 'Overbought Entry',
        'Overbought Exit': 'Overbought Exit',
    },
    BBW: {
        // Canonical names (from generateSignals)
        'squeeze_start': 'Squeeze Start',
        'squeeze_release': 'Squeeze Release',
        'in_squeeze': 'In Squeeze',
        'Expansion State': 'Expansion State',
        'Expansion': 'Expansion',
        // Also accept the canonical names directly
        'Squeeze Start': 'Squeeze Start',
        'Squeeze Release': 'Squeeze Release',
        'In Squeeze': 'In Squeeze',
    },
    // Add other signal types as needed
};

/**
 * Normalize signal name for consistent matching
 * @param {string} type - Signal type (e.g., 'MACD', 'MFI')
 * @param {string} value - Signal value (e.g., 'Bullish Cross')
 * @returns {string} Normalized signal value
 */
export function normalizeSignalName(type, value) {
    if (!type || !value) return value || '';
    
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    if (registry && registry[value]) {
        return registry[value]; // Return canonical name
    }
    
    // If not found, try case-insensitive match for BBW signals
    if (type?.toUpperCase() === 'BBW' && registry) {
        const lowerValue = value.toLowerCase();
        for (const [key, canonical] of Object.entries(registry)) {
            if (key.toLowerCase() === lowerValue) {
                return canonical;
            }
        }
    }
    
    return value; // Return as-is if not in registry
}

/**
 * Check if signal name is valid in registry
 * @param {string} type - Signal type
 * @param {string} value - Signal value
 * @returns {boolean} True if signal exists in registry or type not registered
 */
export function isValidSignalName(type, value) {
    if (!type || !value) return false;
    
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    if (!registry) return true; // Type not in registry, assume valid
    return registry.hasOwnProperty(value);
}

/**
 * Get all available signal values for a type
 * @param {string} type - Signal type
 * @returns {Array<string>} Array of available signal values
 */
export function getAvailableSignalValues(type) {
    if (!type) return [];
    
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    return registry ? Object.keys(registry) : [];
}

/**
 * Check if a signal is a Phase 1 divergence signal
 * @param {string} type - Signal type
 * @param {string} value - Signal value
 * @returns {boolean} True if signal is a Phase 1 divergence signal
 */
export function isPhase1DivergenceSignal(type, value) {
    if (!type || !value) return false;
    
    const divergenceKeywords = ['divergence', 'failure swing'];
    const lowerValue = value.toLowerCase();
    
    return divergenceKeywords.some(keyword => lowerValue.includes(keyword)) &&
           (type.toUpperCase() === 'MACD' || type.toUpperCase() === 'MFI' || type.toUpperCase() === 'OBV');
}

