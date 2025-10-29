
import { get } from 'lodash';
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

const indent = '        ';

// Calculate weighted combined strength with regime adjustments and core signal bonuses
function calculateWeightedCombinedStrength(matchedSignals, marketRegime = 'neutral') {
    let weightedSum = 0;
    let totalWeight = 0;
    let coreSignalsCount = 0;
    
    for (const signal of matchedSignals) {
        const signalType = signal.type?.toLowerCase();
        const weight = SIGNAL_WEIGHTS[signalType] || 1.0;
        const isCore = CORE_SIGNAL_TYPES.includes(signalType);
        
        // Apply both weight and regime adjustment
        const regimeMultiplier = getRegimeMultiplier(marketRegime, signalType, signal.category);
        const finalStrength = signal.strength * weight * regimeMultiplier;
        
        weightedSum += finalStrength;
        totalWeight += weight;
        
        if (isCore) coreSignalsCount++;
    }
    
    // Core signal bonus (10 points per core signal, max 50 points)
    const coreBonus = Math.min(coreSignalsCount * 10, 50);
    
    // Signal diversity bonus (bonus for having multiple different signal types)
    const uniqueTypes = new Set(matchedSignals.map(s => s.type?.toLowerCase()));
    const diversityBonus = uniqueTypes.size > 3 ? 5 : 0;
    
    return weightedSum + coreBonus + diversityBonus;
}

// Central signal evaluation dispatcher
export const evaluateSignalCondition = (candle, indicators, index, signalSettings, marketRegime, onLog) => {
    let signals = [];

    // Ensure signalSettings is an object
    if (typeof signalSettings !== 'object' || signalSettings === null) {
        return [];
    }
    
    // Trend Signals
    if (signalSettings.macd?.enabled) {
        const macdSignals = evaluateMacdCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...macdSignals);
    }
    if (signalSettings.ema?.enabled) {
        const emaSignals = evaluateEmaCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...emaSignals);
    }
    if (signalSettings.ma200?.enabled) {
        const ma200Signals = evaluateMa200Condition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...ma200Signals);
    }
    if (signalSettings.ichimoku?.enabled) {
        const ichimokuSignals = evaluateIchimokuCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...ichimokuSignals);
    }
    if (signalSettings.adx?.enabled) {
        const adxSignals = evaluateAdxCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...adxSignals);
    }
    if (signalSettings.psar?.enabled) {
        const psarSignals = evaluatePsarCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...psarSignals);
    }
    if (signalSettings.tema?.enabled) {
        const temaSignals = evaluateTemaCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...temaSignals);
    }
    if (signalSettings.dema?.enabled) {
        const demaSignals = evaluateDemaCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...demaSignals);
    }
    if (signalSettings.hma?.enabled) {
        const hmaSignals = evaluateHmaCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...hmaSignals);
    }
    if (signalSettings.wma?.enabled) {
        const wmaSignals = evaluateWmaCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...wmaSignals);
    }
    if (signalSettings.maribbon?.enabled) {
        const maribbonSignals = evaluateMARibbonCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...maribbonSignals);
    }
    
    // Momentum Signals
    if (signalSettings.rsi?.enabled) {
        const rsiSignals = evaluateRsiEnhanced(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...rsiSignals);
    }
    if (signalSettings.stochastic?.enabled) {
        const stochSignals = evaluateStochasticCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...stochSignals);
    }
    if (signalSettings.williamsr?.enabled) {
        const williamsrSignals = evaluateWilliamsRCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...williamsrSignals);
    }
    if (signalSettings.cci?.enabled) {
        const cciSignals = evaluateCciCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...cciSignals);
    }
    if (signalSettings.roc?.enabled) {
        const rocSignals = evaluateRocCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...rocSignals);
    }
    if (signalSettings.awesomeoscillator?.enabled) {
        const awesomeOscillatorSignals = evaluateAwesomeOscillatorCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...awesomeOscillatorSignals);
    }
    if (signalSettings.cmo?.enabled) {
        const cmoSignals = evaluateCmoCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...cmoSignals);
    }
    
    // Volatility Signals
    if (signalSettings.bollinger?.enabled) {
        const bollingerSignals = evaluateBollingerCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...bollingerSignals);
    }
    
    // FORCE ENABLE BBW: Always evaluate BBW regardless of settings
    if (true) { // FORCE ENABLE BBW
        const bbwSignals = evaluateBbwCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...bbwSignals);
    }
    if (signalSettings.atr?.enabled) {
        const atrSignals = evaluateAtrCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...atrSignals);
    }
    if (signalSettings.donchian?.enabled) {
        const donchianSignals = evaluateDonchianCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...donchianSignals);
    }
    if (signalSettings.keltner?.enabled) {
        const keltnerSignals = evaluateKeltnerCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...keltnerSignals);
    }
    if (signalSettings.ttm_squeeze?.enabled) {
        const ttmSqueezeSignals = evaluateTtmSqueeze(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...ttmSqueezeSignals);
    }

    // Volume Signals
    if (signalSettings.volume?.enabled) {
        const volumeSignals = evaluateVolumeCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...volumeSignals);
    }
    if (signalSettings.mfi?.enabled) {
        const mfiSignals = evaluateMfiCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...mfiSignals);
    }
    if (signalSettings.obv?.enabled) {
        const obvSignals = evaluateObvCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...obvSignals);
    }
    if (signalSettings.cmf?.enabled) {
        const cmfSignals = evaluateCmfCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...cmfSignals);
    }
    if (signalSettings.adline?.enabled) {
        const adLineSignals = evaluateAdLineCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...adLineSignals);
    }

    // S&R and Patterns
    if (signalSettings.supportresistance?.enabled) {
        const supportResistanceSignals = evaluateSupportResistanceCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...supportResistanceSignals);
    }
    if (signalSettings.fibonacci?.enabled) {
        const fibonacciSignals = evaluateFibonacciCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...fibonacciSignals);
    }
    if (signalSettings.pivot?.enabled) {
        const pivotSignals = evaluatePivotCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...pivotSignals);
    }
    if (signalSettings.candlestick?.enabled) {
        const candlestickSignals = evaluateCandlestickCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...candlestickSignals);
    }
    if (signalSettings.chartpattern?.enabled) {
        const chartPatternSignals = evaluateChartPatternCondition(candle, indicators, index, signalSettings, marketRegime, onLog);
        signals.push(...chartPatternSignals);
    }
    
    return signals;
};


/**
 * Evaluates all signal conditions for a given strategy against pre-calculated indicators.
 * @param {object} strategy - The strategy object containing signals to check.
 * @param {object} indicators - The PRE-CALCULATED indicator data.
 * @param {Array} klines - The kline data, used for price and indexing.
 * @returns {object} - An object with match results and detailed logs.
*/
export const evaluateSignalConditions = (strategy, indicators, klines) => {
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

        const logData = { 
            indicatorType: signalKeyLowercase, 
            value: get(indicators, `${signalKeyLowercase}[${evaluationIndex}]`, 'N/A')
        };
        
        const potentialSignals = evaluateSignalCondition(
            candle,
            indicators,
            evaluationIndex,
            signalSettingsForDispatcher,
            { regime: 'neutral' },
            () => {}
        );
        
        const exactMatch = potentialSignals.find(p => 
            p.type === strategySignal.type && 
            p.value === strategySignal.value
        );

        if (exactMatch) {
            const strength = exactMatch.strength || 0;
            matchedSignalsFromStrategy.push({ ...exactMatch, strength });
            const matchType = exactMatch.isEvent ? 'signal_event_match' : 'signal_match';
            onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "${exactMatch.value}" (Strength: ${strength})`, matchType, logData);
        } else {
            const bestAvailableSignal = potentialSignals.length > 0 
                ? potentialSignals
                    .filter(p => p.type === strategySignal.type)
                    .sort((a, b) => b.strength - a.strength)[0] 
                : null;

            if (bestAvailableSignal) {
                const strength = bestAvailableSignal.strength || 0;
                matchedSignalsFromStrategy.push({ ...bestAvailableSignal, strength });
                onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "${bestAvailableSignal.value}" (Strength: ${strength})`, 'signal_mismatch', logData);
            } else {
                onLog(`${indent}>>>>>> ${strategySignal.type}: Expected "${strategySignal.value}" → Got "Not Found" (Strength: 0)`, 'signal_not_found', logData);
            }
        }
    }
    
    // Calculate weighted combined strength using the new system
    const totalCombinedStrength = calculateWeightedCombinedStrength(matchedSignalsFromStrategy, 'neutral');
    
    return {
        isMatch: true, 
        allSignalsMatchedExactly: matchedSignalsFromStrategy.length === strategy.signals.length,
        matchedSignals: matchedSignalsFromStrategy.map(s => ({
            type: s.type,
            value: s.value,
            strength: s.strength
        })),
        combinedStrength: totalCombinedStrength,
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
