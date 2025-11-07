
import { get } from 'lodash';
import { normalizeSignalName } from './signalNameRegistry';
import {
    evaluateMacdCondition,
    evaluateEmaCondition,
    evaluateMa200Condition,
    evaluateIchimokuCondition,
    evaluateAdxCondition,
    evaluatePsarCondition,
    evaluateTemaCondition,
    evaluateDemaCondition,
    evaluateHmaCondition,
    evaluateWmaCondition,
    evaluateMARibbonCondition
} from './signals/trendSignals';
import {
    evaluateRsiEnhanced,
    evaluateStochasticCondition,
    evaluateWilliamsRCondition,
    evaluateCciCondition,
    evaluateRocCondition,
    evaluateAwesomeOscillatorCondition,
    evaluateCmoCondition,
    evaluateMfiCondition
} from './signals/momentumSignals';
import {
    evaluateBollingerCondition,
    evaluateAtrCondition,
    evaluateDonchianCondition,
    evaluateKeltnerCondition,
    evaluateTtmSqueeze,
    evaluateBbwCondition
} from './signals/volatilitySignals';
import {
    evaluateVolumeCondition,
    evaluateObvCondition,
    evaluateCmfCondition,
    evaluateAdLineCondition
} from './signals/volumeSignals';
import {
    evaluateSupportResistanceCondition,
    evaluateFibonacciCondition,
    evaluatePivotCondition
} from './signals/supportResistanceSignals';
import {
    evaluateCandlestickCondition,
    evaluateChartPatternCondition
} from './signals/patternSignals';
import { initializeRegimeTracker, logRegimeStatistics, getRegimeMultiplier } from './regimeUtils';
import { defaultSignalSettings, SIGNAL_WEIGHTS, CORE_SIGNAL_TYPES } from './signalSettings';
import { calculateUnifiedCombinedStrength } from './unifiedStrengthCalculator';

const indent = '        ';

// Calculate weighted combined strength using unified calculator
// This ensures consistency between autoscanner and backtest
function calculateWeightedCombinedStrength(matchedSignals, marketRegime = 'neutral', regimeConfidence = 0.5) {
    // Use unified calculator with advanced features enabled (same as backtest)
    const result = calculateUnifiedCombinedStrength(matchedSignals, {
        marketRegime: marketRegime,
        regimeConfidence: regimeConfidence,
        useAdvancedFeatures: true,
        useSimpleRegimeMultiplier: false, // Use advanced regime weighting
        context: 'SCANNER' // Explicitly mark as scanner for correlation logging
    });
    
    // Return both strength and breakdown for analytics
    return {
        totalStrength: result.totalStrength,
        breakdown: result.breakdown
    };
}

// Central signal evaluation dispatcher
export const evaluateSignalCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode = false) => {
    let signals = [];

    // Ensure signalSettings is an object
    if (typeof signalSettings !== 'object' || signalSettings === null) {
        return [];
    }
    
    // FORCE ENABLE ALL SIGNALS FOR AUTOSCANNER
    // Merge all signal settings with defaults and force enable them
    const ensureSignalEnabled = (signalKey) => {
        const defaultSettings = defaultSignalSettings[signalKey] || {};
        const providedSettings = signalSettings[signalKey] || {};
        return {
            ...defaultSettings,
            ...providedSettings,
            enabled: true // Force enable
        };
    };
    
    // Build complete signal settings object with all signals enabled
    const allSignalsEnabled = {};
    const allSignalKeys = Object.keys(defaultSignalSettings);
    allSignalKeys.forEach(key => {
        allSignalsEnabled[key] = ensureSignalEnabled(key);
    });
    
    // Merge with provided settings (provided settings take precedence but enabled is always true)
    const finalSignalSettings = {
        ...allSignalsEnabled,
        ...signalSettings,
        // Override enabled for all signals to true
        ...Object.keys(allSignalsEnabled).reduce((acc, key) => {
            acc[key] = {
                ...allSignalsEnabled[key],
                ...(signalSettings[key] || {}),
                enabled: true
            };
            return acc;
        }, {})
    };
    
    // Trend Signals
    {
        // Always evaluate - force enabled
        const macdSignals = evaluateMacdCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...macdSignals);
    }
    {
        // Always evaluate - force enabled
        const emaSignals = evaluateEmaCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...emaSignals);
    }
    {
        // Always evaluate - force enabled
        const ma200Signals = evaluateMa200Condition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...ma200Signals);
    }
    {
        // Always evaluate - force enabled
        const ichimokuSignals = evaluateIchimokuCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...ichimokuSignals);
    }
    {
        // Always evaluate - force enabled
        const adxSignals = evaluateAdxCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...adxSignals);
    }
    {
        // Always evaluate - force enabled
        const psarSignals = evaluatePsarCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...psarSignals);
    }
    {
        // Always evaluate - force enabled
        const temaSignals = evaluateTemaCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...temaSignals);
    }
    {
        // Always evaluate - force enabled
        const demaSignals = evaluateDemaCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...demaSignals);
    }
    {
        // Always evaluate - force enabled
        const hmaSignals = evaluateHmaCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...hmaSignals);
    }
    {
        // Always evaluate - force enabled
        const wmaSignals = evaluateWmaCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...wmaSignals);
    }
    {
        // Always evaluate - force enabled
        const maribbonSignals = evaluateMARibbonCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...maribbonSignals);
    }
    
    // Momentum Signals
    {
        // Always evaluate - force enabled
        const rsiSignals = evaluateRsiEnhanced(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...rsiSignals);
    }
    {
        // Always evaluate - force enabled
        const stochSignals = evaluateStochasticCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...stochSignals);
    }
    {
        // Always evaluate - force enabled
        const williamsrSignals = evaluateWilliamsRCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...williamsrSignals);
    }
    {
        // Always evaluate - force enabled
        const cciSignals = evaluateCciCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...cciSignals);
    }
    {
        // Always evaluate - force enabled
        const rocSignals = evaluateRocCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...rocSignals);
    }
    {
        // Always evaluate - force enabled
        const awesomeOscillatorSignals = evaluateAwesomeOscillatorCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...awesomeOscillatorSignals);
    }
    {
        // Always evaluate - force enabled
        const cmoSignals = evaluateCmoCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...cmoSignals);
    }
    
    // Volatility Signals
    {
        // Always evaluate - force enabled
        const bollingerSignals = evaluateBollingerCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...bollingerSignals);
    }
    {
        // Always evaluate - force enabled
        const bbwSignals = evaluateBbwCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...bbwSignals);
    }
    {
        // Always evaluate - force enabled
        const atrSignals = evaluateAtrCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...atrSignals);
    }
    {
        // Always evaluate - force enabled
        const donchianSignals = evaluateDonchianCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...donchianSignals);
    }
    {
        // Always evaluate - force enabled
        const keltnerSignals = evaluateKeltnerCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        if (debugMode && keltnerSignals.length === 0 && onLog) {
            onLog(`[SIGNAL_LOGIC] [KELTNER] No Keltner signals found at index ${index}`, 'debug');
        }
        signals.push(...keltnerSignals);
    }
    {
        // Always evaluate - force enabled
        const ttmSqueezeSignals = evaluateTtmSqueeze(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        if (debugMode && ttmSqueezeSignals.length === 0 && onLog) {
            //onLog(`[SIGNAL_LOGIC] [TTM_SQUEEZE] No TTM Squeeze signals found at index ${index}`, 'debug');
        }
        signals.push(...ttmSqueezeSignals);
    }

    // Volume Signals
    {
        // Always evaluate - force enabled
        const volumeSignals = evaluateVolumeCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...volumeSignals);
    }
    {
        // Always evaluate - force enabled
        // Only pass debugMode if explicitly enabled (for divergence/failure swing debugging)
        const mfiSignals = evaluateMfiCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, false);
        signals.push(...mfiSignals);
    }
    {
        // Always evaluate - force enabled
        const obvSignals = evaluateObvCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...obvSignals);
    }
    {
        // Always evaluate - force enabled
        const cmfSignals = evaluateCmfCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...cmfSignals);
    }
    {
        // Always evaluate - force enabled
        const adLineSignals = evaluateAdLineCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...adLineSignals);
    }

    // S&R and Patterns
    {
        // Always evaluate - force enabled
        const supportResistanceSignals = evaluateSupportResistanceCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        if (debugMode && supportResistanceSignals.length === 0 && onLog) {
            //onLog(`[SIGNAL_LOGIC] [SUPPORT_RESISTANCE] No Support/Resistance signals found at index ${index}`, 'debug');
        }
        signals.push(...supportResistanceSignals);
    }
    {
        // Always evaluate - force enabled
        const fibonacciSignals = evaluateFibonacciCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        if (debugMode && fibonacciSignals.length === 0 && onLog) {
            //onLog(`[SIGNAL_LOGIC] [FIBONACCI] No Fibonacci signals found at index ${index}`, 'debug');
        }
        signals.push(...fibonacciSignals);
    }
    {
        // Always evaluate - force enabled
        const pivotSignals = evaluatePivotCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...pivotSignals);
    }
    {
        // Always evaluate - force enabled
        const candlestickSignals = evaluateCandlestickCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog, debugMode);
        signals.push(...candlestickSignals);
    }
    {
        // Always evaluate - force enabled
        const chartPatternSignals = evaluateChartPatternCondition(candle, indicators, index, finalSignalSettings, marketRegime, onLog);
        signals.push(...chartPatternSignals);
    }
    
    return signals;
};


/**
 * Evaluates all signal conditions for a given strategy against pre-calculated indicators.
 * @param {object} strategy - The strategy object containing signals to check.
 * @param {object} indicators - The PRE-CALCULATED indicator data.
 * @param {Array} klines - The kline data, used for price and indexing.
 * @param {object} marketRegime - Optional market regime object with {regime, confidence}
 * @returns {object} - An object with match results and detailed logs.
*/
export const evaluateSignalConditions = (strategy, indicators, klines, marketRegime = null) => {
    // Robustness checks
    if (!klines || klines.length < 2) {
        return { isMatch: false, log: [{ type: 'error', message: 'Not enough kline data to evaluate' }] };
    }
    if (!indicators) {
        return { isMatch: false, log: [{ type: 'error', message: 'Indicators object not provided' }] };
    }

    const evaluationIndex = klines.length - 2;
    const candle = klines[evaluationIndex];

    if (!candle) {
         return { isMatch: false, log: [{ type: 'error', message: `No valid candle at index ${evaluationIndex}` }] };
    }
    
    const evaluationLog = [];
    const onLog = (msg, type, data) => {
        evaluationLog.push({ type: type || 'info', message: msg, data });
    };

    let matchedSignalsFromStrategy = [];
    
    for (const strategySignal of strategy.signals) {
        const signalKeyLowercase = strategySignal.type.toLowerCase();
        
        const signalSettingsForDispatcher = {
            [signalKeyLowercase]: { 
                ...(defaultSignalSettings[signalKeyLowercase] || {}),
                enabled: true,
                ...(strategySignal.parameters || {})
            }
        };

        // DEBUG: Log the structure being created
        if (signalKeyLowercase === 'bollinger') {
            //console.log(`[SIGNAL_LOGIC_DEBUG] ═══════════════════════════════════════════════════════`);
            //console.log(`[SIGNAL_LOGIC_DEBUG] Evaluating BOLLINGER signal from strategy`);
            //console.log(`[SIGNAL_LOGIC_DEBUG] strategySignal.type="${strategySignal.type}", signalKeyLowercase="${signalKeyLowercase}"`);
            //console.log(`[SIGNAL_LOGIC_DEBUG] defaultSignalSettings["${signalKeyLowercase}"]=`, defaultSignalSettings[signalKeyLowercase]);
            //console.log(`[SIGNAL_LOGIC_DEBUG] strategySignal.parameters=`, strategySignal.parameters);
            //console.log(`[SIGNAL_LOGIC_DEBUG] signalSettingsForDispatcher=`, JSON.stringify(signalSettingsForDispatcher, null, 2));
            //console.log(`[SIGNAL_LOGIC_DEBUG] signalSettingsForDispatcher.bollinger=`, signalSettingsForDispatcher.bollinger);
            //console.log(`[SIGNAL_LOGIC_DEBUG] ═══════════════════════════════════════════════════════`);
        }

        const logData = { 
            indicatorType: signalKeyLowercase, 
            value: get(indicators, `${signalKeyLowercase}[${evaluationIndex}]`, 'N/A')
        };
        
        // Enable debug logging when evaluating divergence signals, failure swing signals, RSI signals, ATR, Bollinger, BBW, or Stochastic signals
        const isDivergenceSignal = strategySignal.value && strategySignal.value.toLowerCase().includes('divergence');
        const isFailureSwingSignal = strategySignal.value && strategySignal.value.toLowerCase().includes('failure swing');
        const isRsiSignal = strategySignal.type && strategySignal.type.toLowerCase() === 'rsi';
        const isAtrSignal = strategySignal.type && strategySignal.type.toLowerCase() === 'atr';
        const isBollingerSignal = strategySignal.type && strategySignal.type.toLowerCase() === 'bollinger';
        const isBbwSignal = strategySignal.type && strategySignal.type.toLowerCase() === 'bbw';
        const isStochasticSignal = strategySignal.type && strategySignal.type.toLowerCase() === 'stochastic';
        const isKeltnerSignal = strategySignal.type && (strategySignal.type.toLowerCase() === 'keltner' || strategySignal.type.toLowerCase() === 'keltnerchannel');
        const shouldDebug = isDivergenceSignal || isFailureSwingSignal || isRsiSignal || isAtrSignal || isBollingerSignal || isBbwSignal || isStochasticSignal || isKeltnerSignal;
        
        // Use actual onLog for divergence/RSI/ATR/Bollinger debugging, empty function for others to reduce noise
        const logCallback = shouldDebug ? onLog : (() => {});
        const debugMode = shouldDebug;
        
        
        // DEBUG: Log what we're about to pass to evaluateSignalCondition
        if (isBollingerSignal) {
            //console.log(`[SIGNAL_LOGIC_DEBUG] About to call evaluateSignalCondition with:`);
            //console.log(`[SIGNAL_LOGIC_DEBUG]   - signalSettingsForDispatcher keys:`, Object.keys(signalSettingsForDispatcher));
            //console.log(`[SIGNAL_LOGIC_DEBUG]   - signalSettingsForDispatcher.bollinger exists:`, !!signalSettingsForDispatcher.bollinger);
            //console.log(`[SIGNAL_LOGIC_DEBUG]   - signalSettingsForDispatcher.bollinger.enabled:`, signalSettingsForDispatcher.bollinger?.enabled);
        }
        
        const potentialSignals = evaluateSignalCondition(
            candle,
            indicators,
            evaluationIndex,
            signalSettingsForDispatcher,
            { regime: 'neutral' },
            logCallback,
            debugMode
        );
        
        // ✅ Normalize signal type for matching (handles ALL TTM Squeeze variations)
        const normalizeSignalType = (type) => {
            if (!type || typeof type !== 'string') return type;
            const normalized = type.toLowerCase().trim();
            // Normalize ALL TTM Squeeze variations: TTMSqueeze, TTM_Squeeze, ttm_squeeze, TTM-Squeeze, etc.
            if (normalized === 'ttmsqueeze' || normalized === 'ttm_squeeze' || normalized === 'ttm-squeeze') {
                return 'ttm_squeeze';
            }
            return normalized;
        };
        
        // ✅ Phase 1: Enhanced matching with normalization
        // Normalize strategy signal type and value once (outside the find loop)
        
        const normalizedStrategyType = normalizeSignalType(strategySignal.type);
        let normalizedStrategyValue = strategySignal.value;
        try {
            normalizedStrategyValue = normalizeSignalName(strategySignal.type, strategySignal.value) || strategySignal.value;
        } catch (e) {
            // Fallback if registry not available - use original value
        }
        
        const exactMatch = potentialSignals.find(p => {
            const normalizedPType = normalizeSignalType(p.type);
            const typeMatch = normalizedPType === normalizedStrategyType;
            
            // Normalize potential signal value
            let normalizedPValue = p.value;
            try {
                normalizedPValue = normalizeSignalName(p.type, p.value) || p.value;
            } catch (e) {
                // Fallback if registry not available
            }
            
            const valueMatch = normalizedPValue === normalizedStrategyValue ||
                             p.value === strategySignal.value ||
                             (p.value && p.value.includes(strategySignal.value)) || // Partial match for divergences
                             (normalizedStrategyValue && normalizedPValue.includes(normalizedStrategyValue));
            
            return typeMatch && valueMatch;
        });

        if (exactMatch) {
            const strength = exactMatch.strength || 0;
            matchedSignalsFromStrategy.push({ ...exactMatch, strength });
            const matchType = exactMatch.isEvent ? 'signal_event_match' : 'signal_match';
            onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "${exactMatch.value}" (Strength: ${strength})`, matchType, logData);
        } else {
            // Case-insensitive type matching with normalization (same as exactMatch logic)
            const normalizedStrategyType = normalizeSignalType(strategySignal.type);
            
            const bestAvailableSignal = potentialSignals.length > 0 
                ? potentialSignals
                    .filter(p => normalizeSignalType(p.type) === normalizedStrategyType)
                    .sort((a, b) => b.strength - a.strength)[0] 
                : null;

            if (bestAvailableSignal) {
                const strength = bestAvailableSignal.strength || 0;
                matchedSignalsFromStrategy.push({ ...bestAvailableSignal, strength });
                onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "${bestAvailableSignal.value}" (Strength: ${strength})`, 'signal_mismatch', logData);
            } else {
                // Enhanced debug logging when no signal found
                const availableTypes = [...new Set(potentialSignals.map(p => p.type))].join(', ');
                const availableAtrSignals = potentialSignals.filter(p => (p.type || '').toLowerCase() === 'atr').map(p => p.value).join(', ');
                
                // Enhanced debugging for specific signal types
                const signalTypeLower = (strategySignal.type || '').toLowerCase();
                
                // ✅ Bollinger debugging
                if (signalTypeLower === 'bollinger') {
                    console.error(`[SIGNAL_MATCH] ❌❌❌ BOLLINGER SIGNAL NOT FOUND! ❌❌❌`);
                    console.error(`[SIGNAL_MATCH] Expected: type="${strategySignal.type}", value="${strategySignal.value}"`);
                    console.error(`[SIGNAL_MATCH] Strategy signal normalized type: "${signalTypeLower}"`);
                    console.error(`[SIGNAL_MATCH] Total potential signals: ${potentialSignals.length}`);
                    console.error(`[SIGNAL_MATCH] Available signal types:`, availableTypes);
                    console.error(`[SIGNAL_MATCH] Indicators object keys:`, Object.keys(indicators || {}));
                    console.error(`[SIGNAL_MATCH] Bollinger indicator exists:`, !!indicators?.bollinger);
                    console.error(`[SIGNAL_MATCH] Bollinger indicator length:`, indicators?.bollinger?.length || 'N/A');
                    console.error(`[SIGNAL_MATCH] Bollinger at evaluationIndex (${evaluationIndex}):`, indicators?.bollinger?.[evaluationIndex] ? JSON.stringify(indicators.bollinger[evaluationIndex]) : 'undefined');
                    console.error(`[SIGNAL_MATCH] Bollinger at evaluationIndex-1 (${evaluationIndex - 1}):`, indicators?.bollinger?.[evaluationIndex - 1] ? JSON.stringify(indicators.bollinger[evaluationIndex - 1]) : 'undefined');
                    
                    const bollingerSignals = potentialSignals.filter(p => 
                        (p.type || '').toLowerCase() === 'bollinger'
                    );
                    console.error(`[SIGNAL_MATCH] Bollinger signals found: ${bollingerSignals.length}`);
                    bollingerSignals.forEach((sig, idx) => {
                        console.error(`[SIGNAL_MATCH]   Bollinger Signal[${idx}]: type="${sig.type}", value="${sig.value}", strength=${sig.strength}, isEvent=${sig.isEvent}`);
                    });
                    
                    // Normalize for matching
                    const normalizedStrategyType = normalizeSignalType(strategySignal.type);
                    
                    const matchingTypeSignals = potentialSignals.filter(p => 
                        normalizeSignalType(p.type) === normalizedStrategyType
                    );
                    console.error(`[SIGNAL_MATCH] Signals with matching type "${strategySignal.type}": ${matchingTypeSignals.length}`);
                    matchingTypeSignals.forEach((sig, idx) => {
                        console.error(`[SIGNAL_MATCH]   Match[${idx}]: value="${sig.value}", strength=${sig.strength}`);
                    });
                    
                    // Show what was expected vs what was found
                    console.error(`[SIGNAL_MATCH] Expected value: "${strategySignal.value}"`);
                    console.error(`[SIGNAL_MATCH] Expected normalized value: "${normalizedStrategyValue}"`);
                    matchingTypeSignals.forEach((sig, idx) => {
                        let normalizedPValue = sig.value;
                        try {
                            normalizedPValue = normalizeSignalName(sig.type, sig.value) || sig.value;
                        } catch (e) {
                            // Fallback
                        }
                        console.error(`[SIGNAL_MATCH]   Available[${idx}]: value="${sig.value}", normalized="${normalizedPValue}", matches=${normalizedPValue === normalizedStrategyValue || sig.value === strategySignal.value}`);
                    });
                }
                
                
                // TTM Squeeze debugging
                if (signalTypeLower.includes('squeeze') || signalTypeLower.includes('ttm')) {
                    console.error(`[SIGNAL_MATCH] ❌❌❌ TTM SQUEEZE NOT FOUND! ❌❌❌`);
                    console.error(`[SIGNAL_MATCH] Expected: type="${strategySignal.type}", value="${strategySignal.value}"`);
                    console.error(`[SIGNAL_MATCH] Strategy signal normalized type: "${signalTypeLower}"`);
                    console.error(`[SIGNAL_MATCH] Total potential signals: ${potentialSignals.length}`);
                    console.error(`[SIGNAL_MATCH] Available signal types:`, availableTypes);
                    
                    const ttmSignals = potentialSignals.filter(p => 
                        (p.type || '').toLowerCase().includes('squeeze') || 
                        (p.type || '').toLowerCase().includes('ttm')
                    );
                    console.error(`[SIGNAL_MATCH] TTM-related signals found: ${ttmSignals.length}`);
                    ttmSignals.forEach((sig, idx) => {
                        console.error(`[SIGNAL_MATCH]   TTM Signal[${idx}]: type="${sig.type}", value="${sig.value}", strength=${sig.strength}`);
                    });
                    
                    // Normalize for matching
                    const normalizedStrategyType = normalizeSignalType(strategySignal.type);
                    
                    const matchingTypeSignals = potentialSignals.filter(p => 
                        normalizeSignalType(p.type) === normalizedStrategyType
                    );
                    console.error(`[SIGNAL_MATCH] Signals with matching type "${strategySignal.type}": ${matchingTypeSignals.length}`);
                    matchingTypeSignals.forEach((sig, idx) => {
                        console.error(`[SIGNAL_MATCH]   Match[${idx}]: value="${sig.value}", strength=${sig.strength}`);
                    });
                }
                
                // Chart Pattern debugging
                if (signalTypeLower.includes('chartpattern') || signalTypeLower === 'chartpattern') {
                    const chartSignals = potentialSignals.filter(p => 
                        (p.type || '').toLowerCase().includes('chartpattern') || 
                        (p.type || '').toLowerCase() === 'chartpattern'
                    );
                    onLog(`[SIGNAL_MATCH] 🔍 CHART PATTERN DEBUG: Expected "${strategySignal.value}"`, 'debug');
                    onLog(`[SIGNAL_MATCH] Available chart pattern signals: ${chartSignals.length}`, 'debug');
                    chartSignals.forEach((sig, idx) => {
                        onLog(`[SIGNAL_MATCH]   Chart Signal[${idx}]: value="${sig.value}", strength=${sig.strength}`, 'debug');
                    });
                    
                    if (chartSignals.length === 0) {
                        onLog(`[SIGNAL_MATCH] ❌ No chart pattern signals generated - check pattern detection logic`, 'warning');
                    }
                }
                
                // Candlestick Pattern debugging
                if (signalTypeLower.includes('candlestick') || signalTypeLower === 'candlestick') {
                    const candlestickSignals = potentialSignals.filter(p => 
                        (p.type || '').toLowerCase().includes('candlestick') || 
                        (p.type || '').toLowerCase() === 'candlestick'
                    );
                    onLog(`[SIGNAL_MATCH] 🔍 CANDLESTICK PATTERN DEBUG: Expected "${strategySignal.value}"`, 'debug');
                    onLog(`[SIGNAL_MATCH] Available candlestick signals: ${candlestickSignals.length}`, 'debug');
                    candlestickSignals.forEach((sig, idx) => {
                        onLog(`[SIGNAL_MATCH]   Candlestick Signal[${idx}]: value="${sig.value}", strength=${sig.strength}`, 'debug');
                    });
                    
                    if (candlestickSignals.length === 0) {
                        onLog(`[SIGNAL_MATCH] ❌ No candlestick signals generated - check pattern detection and readyForAnalysis flag`, 'warning');
                    }
                }
                
                onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "Not Found" (Strength: 0)`, 'signal_not_found', logData);
            }
        }
    }
    
    // Calculate weighted combined strength using the new system
    // Use actual market regime if provided, otherwise default to 'neutral'
    const regime = marketRegime?.regime || 'neutral';
    const regimeConfidence = marketRegime?.confidence || 0.5;
    const strengthResult = calculateWeightedCombinedStrength(matchedSignalsFromStrategy, regime, regimeConfidence);
    const totalCombinedStrength = typeof strengthResult === 'number' ? strengthResult : strengthResult.totalStrength;
    const strengthBreakdown = typeof strengthResult === 'object' && strengthResult.breakdown ? strengthResult.breakdown : null;
    
    return {
        isMatch: true, 
        strengthBreakdown: strengthBreakdown, // Include breakdown for analytics
        combinedStrength: totalCombinedStrength,
        allSignalsMatchedExactly: matchedSignalsFromStrategy.length === strategy.signals.length,
        matchedSignals: matchedSignalsFromStrategy.map(s => ({
            type: s.type,
            value: s.value,
            strength: s.strength
        })),
        priceAtMatch: candle.close,
        log: evaluationLog,
    };
};


// Helper function to get signal value from indicators
export const getSignalValue = (indicators, signalType, index) => {
    if (!indicators || !indicators[signalType] || index < 0 || index >= indicators[signalType].length) {
        return null;
    }
    return indicators[signalType][index];
};

// Re-export for other parts of the application
export { initializeRegimeTracker, logRegimeStatistics, getRegimeMultiplier };
