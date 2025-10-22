
import { get } from 'lodash';
// Direct import solves the 'this.evaluateSignalCondition' error
import { evaluateSignalCondition } from '@/components/utils/signalLogic'; 

/**
 * Analyzes a chunk of historical data to find raw signal matches.
 * This is a pure function with no 'this' context.
 *
 * @param {object} params - The parameters for the analysis.
 * @param {number} params.startIndex - The starting index of the chunk.
 * @param {number} params.endIndex - The ending index of the chunk.
 * @param {Array} params.historicalData - The full array of candle data.
 * @param {object} params.indicators - The pre-calculated indicators object.
 * @param {object} params.signalSettings - The configuration for all signals.
 * @param {number} params.requiredSignals - The minimum number of signals for a match.
 * @param {number} params.maxSignals - The maximum number of signals for a match.
 * @param {number} params.minCombinedStrength - The minimum combined strength for a match.
 * @param {Array} params.marketRegimesHistory - The pre-calculated regime for each candle.
 * @param {function} params.onLog - The logging callback function.
 * @returns {Array} - An array of raw signal match objects.
 */
export const analyzeSignalChunk = ({
    startIndex,
    endIndex,
    historicalData,
    indicators,
    signalSettings,
    requiredSignals,
    maxSignals,
    minCombinedStrength,
    marketRegimesHistory,
    onLog // Explicitly passed dependency solves the 'addLogCallback' error
}) => {
    const matches = [];
    // Define a constant for the minimum index required for stable indicator data.
    const MIN_STABLE_INDEX = 50; 

    if (onLog) onLog(`Analyzing signals for chunk ${startIndex}-${endIndex}.`, 'info');
    if (onLog) {
        onLog(`[Debug] Engine's Indicator Keys at start of analysis: ${Object.keys(indicators).join(', ')}`, 'debug');
    }

    for (let i = startIndex; i < endIndex; i++) {
        // Step 4.4: Add the guard condition to skip initial, unstable candles.
        if (i < MIN_STABLE_INDEX) {
            continue;
        }

        const candle = historicalData[i];
        if (!candle) continue;

        try {
            const marketRegime = get(marketRegimesHistory, `[${i}].regime`, 'unknown');
            
            // Smart sampling: only log first few candles to avoid spam
            if (onLog && i < 3) {
                onLog(`[SIGNAL_ANALYZER] Analyzing candle ${i} (${candle.time}) for signals`, 'debug');
            }

            // CRITICAL DEBUG: Log before calling evaluateSignalCondition
            if (onLog && i < 3) {
                onLog(`[SIGNAL_ANALYZER] About to call evaluateSignalCondition for candle ${i}`, 'debug');
                onLog(`[SIGNAL_ANALYZER] Signal settings keys: ${Object.keys(signalSettings).join(', ')}`, 'debug');
                onLog(`[SIGNAL_ANALYZER] BBW enabled: ${signalSettings.bbw?.enabled}`, 'debug');
                onLog(`[SIGNAL_ANALYZER] TTM_SQUEEZE enabled: ${signalSettings.ttm_squeeze?.enabled}`, 'debug');
            }
            
            const rawFoundSignals = evaluateSignalCondition(candle, indicators, i, signalSettings, marketRegime, onLog, true);
            
            if (onLog && i < 3) {
                onLog(`[SIGNAL_ANALYZER] Candle ${i}: evaluateSignalCondition returned ${rawFoundSignals.length} signals`, 'debug');
            }

            const allCandleSignals = []; // This will hold the enhanced signals
            let signalTypesFound = new Set(); // To track signal types for logging
            
            // Apply signal classification and filtering as per analyzeCandle outline
            for (const signal of rawFoundSignals) {
                // Classify signal type (event vs state)
                // Since this is a pure function, there's no `this.classifySignalType`.
                // We fallback to `signal.isEvent || false` as per the outline's conditional logic.
                const isEvent = signal.isEvent || false; 
                
                const enhancedSignal = {
                    ...signal,
                    isEvent,
                    candleIndex: i, // Using 'i' to match the loop variable
                    timestamp: candle.time
                };
                
                allCandleSignals.push(enhancedSignal);
                signalTypesFound.add(signal.type);
            }

            // Smart sampling: only log first few candles to avoid spam
            if (onLog && i < 3) {
                onLog(`[SIGNAL_ANALYZER] Candle ${i}: Final output ${allCandleSignals.length} signals. Types: ${Array.from(signalTypesFound).join(', ')}`, 'debug');
            }
            // End of added logging from analyzeCandle outline

            if (allCandleSignals.length < requiredSignals) {
                continue;
            }

            // Generate combinations of signals
            for (let r = requiredSignals; r <= Math.min(allCandleSignals.length, maxSignals); r++) {
                const combinations = getCombinations(allCandleSignals, r);
                for (const combo of combinations) {
                    const combinedStrength = combo.reduce((sum, s) => sum + (s.strength || 0), 0);
                    if (combinedStrength >= minCombinedStrength) {
                        matches.push({
                            time: candle.time,
                            price: candle.close,
                            signals: combo,
                            combinedStrength: combinedStrength,
                        });
                    }
                }
            }
        } catch (error) {
            if (onLog) {
                onLog(`Error analyzing candle ${i} (Time: ${new Date(candle.time).toISOString()}): ${error.message}`, 'error');
            }
            continue; 
        }
    }
    
    if (onLog) onLog(`Chunk ${startIndex}-${endIndex} completed. Found ${matches.length} raw combinations.`, 'info');
    return matches;
};

// Helper function to get all combinations of a certain size
function getCombinations(array, size) {
    const result = [];
    function combinationUtil(index, currentCombo) {
        if (currentCombo.length === size) {
            result.push([...currentCombo]);
            return;
        }
        if (index >= array.length) {
            return;
        }
        currentCombo.push(array[index]);
        combinationUtil(index + 1, currentCombo);
        currentCombo.pop();
        combinationUtil(index + 1, currentCombo);
    }
    combinationUtil(0, []);
    return result;
}
