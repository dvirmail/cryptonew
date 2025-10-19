import { uniqBy } from 'lodash';
import { getRegimeMultiplier } from '../regimeUtils';

/**
 * Removes duplicate signals from an array based on the signal's 'value' property.
 * For example, if multiple "Bullish Reversal" signals are found, only the first one is kept.
 *
 * @param {Array} signals - An array of signal objects.
 * @returns {Array} - An array of unique signal objects.
 */
export const getUniqueSignals = (signals) => {
    if (!signals || !Array.isArray(signals)) {
        return [];
    }
    // A signal is considered unique based on its 'value' property.
    return uniqBy(signals, 'value');
};

/**
 * Adjusts a signal's strength based on the current market regime.
 * It fetches a multiplier and applies it to the base strength.
 *
 * @param {number} baseStrength - The initial strength of the signal.
 * @param {string} marketRegime - The current detected market regime (e.g., 'bullish', 'ranging').
 * @param {string} signalType - The type of the signal (e.g., 'psar', 'rsi').
 * @returns {number} - The adjusted signal strength.
 */
export const applyRegimeAdjustment = (baseStrength, marketRegime, signalType) => {
    // Get the multiplier for the current regime and signal type.
    const multiplier = getRegimeMultiplier(marketRegime, signalType);
    
    // Apply the multiplier and round to the nearest integer.
    return Math.round(baseStrength * multiplier);
};