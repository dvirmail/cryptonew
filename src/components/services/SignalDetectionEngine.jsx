import { calculateAllIndicators } from '@/components/utils/indicatorManager';
import { get, groupBy, sortBy, set } from 'lodash';
import { evaluateSignalConditions, getSignalValue } from '@/components/utils/signalLogic';
import { queueFunctionCall, apiQueue, queueEntityCall } from '@/components/utils/apiQueue';
import { calculateConvictionScore } from '../utils/convictionScoring';
import { calculateVolatilityAdjustedSize, calculateFixedSize } from '@/components/utils/dynamicPositionSizing';
import { positionSizeValidator } from '@/components/utils/positionSizeValidator';
import { getKlineData } from '@/api/functions';
import { getBinancePrices } from '@/api/functions';
import { MarketAlert } from '@/api/entities';
import { resetIndicatorManagerDebug } from "@/components/utils/indicatorManager";

// === Dynamic conviction threshold (momentum-aware) ===
// REDESIGNED: 50 is the neutral point where LPM has no impact on conviction
const NEUTRAL_LPM_SCORE = 50; // LPM = 50 means no impact on conviction
const LPM_ADJUSTMENT_FACTOR = 0.5; // Each point deviation from 50 affects conviction by 0.5

/**
 * Computes a dynamic conviction threshold based on the scanner's performance momentum score.
 * NEW LOGIC: LPM = 50 is neutral (no impact), LPM > 50 reduces conviction requirements,
 * LPM < 50 increases conviction requirements.
 * @param {object} settings - Global scanner settings, containing `minimumConvictionScore`.
 * @param {number} performanceMomentumScore - The current performance momentum score of the scanner.
 * @returns {number} The dynamically adjusted minimum conviction score.
 */
function computeDynamicConvictionThreshold(settings, performanceMomentumScore) {
    const base = Number(settings?.minimumConvictionScore ?? 0);
    const momentum = Number(performanceMomentumScore);
    
    if (!Number.isFinite(base)) return 0;
    // If momentum is not a valid number, or there's no momentum data, use the base threshold.
    if (!Number.isFinite(momentum)) return Math.min(100, Math.max(0, base));

    // NEW LOGIC: 50 is neutral, deviation from 50 affects conviction
    const deviation = momentum - NEUTRAL_LPM_SCORE; // Range: -50 to +50
    const adjustment = deviation * LPM_ADJUSTMENT_FACTOR; // Range: -25 to +25
    const dynamic = base - adjustment; // Higher LPM = lower conviction needed
    
    // Clamp between base and 100 (conviction can't exceed 100)
    return Math.min(100, Math.max(base, dynamic));
}

/**
 * Calculates the maximum lookback period required by any enabled signal.
 * @param {object} signalSettings - The signal settings configuration.
 * @returns {number} The maximum lookback period plus buffer.
 */
function calculateMaxRequiredKlineLimit(signalSettings) {
    let maxPeriod = 20; // Minimum required
    const detectedPeriods = [];
    let hasLongPeriodIndicators = false;

    // Handle the case where signalSettings might be undefined or not an object
    if (!signalSettings || typeof signalSettings !== 'object') {
        // CRITICAL FIX: Return at least 50 candles to meet minimum requirement (line 999, 1595)
        return Math.max(50, maxPeriod + 20);
    }

    for (const signalKey in signalSettings) {
        const settings = signalSettings[signalKey];
        if (settings && settings.enabled) {

            let currentSignalMaxPeriod = 0;

            // Standard period fields
            const periodFields = ['period', 'kPeriod', 'dPeriod', 'fastPeriod', 'slowPeriod',
                'tenkan', 'kijun', 'senkouB', 'bbPeriod', 'kcPeriod', 'lookback'];

            periodFields.forEach(field => {
                if (typeof settings[field] === 'number') {
                    currentSignalMaxPeriod = Math.max(currentSignalMaxPeriod, settings[field]);
                    detectedPeriods.push(`${signalKey}.${field}=${settings[field]}`);
                }
            });

            // Handle MA periods array
            if (Array.isArray(settings.maPeriods)) {
                const maxMaPeriod = Math.max(...settings.maPeriods);
                currentSignalMaxPeriod = Math.max(currentSignalMaxPeriod, maxMaPeriod);
                detectedPeriods.push(`${signalKey}.maPeriods=[${settings.maPeriods.join(',')}] max=${maxMaPeriod}`);
            }

            // ENHANCED: Check for various MA200 signal key variations
            const ma200Keys = ['ma200', 'MA200', 'sma200', 'SMA200', 'ema200', 'EMA200'];
            if (ma200Keys.includes(signalKey)) {
                currentSignalMaxPeriod = Math.max(currentSignalMaxPeriod, 200);
                detectedPeriods.push(`${signalKey} DETECTED_AS_MA200=200`);
                hasLongPeriodIndicators = true;
            }

            // ENHANCED: Check if this signal has any reference to "200" in its configuration
            if (signalKey.toLowerCase().includes('ma') || signalKey.toLowerCase().includes('sma') || signalKey.toLowerCase().includes('ema')) {
                // Check if any field contains 200
                Object.keys(settings).forEach(key => {
                    if (settings[key] === 200) {
                        currentSignalMaxPeriod = Math.max(currentSignalMaxPeriod, 200);
                        detectedPeriods.push(`${signalKey}.${key}=200 DETECTED_AS_MA200`);
                        hasLongPeriodIndicators = true;
                    }
                });
            }

            // Update overall max
            if (currentSignalMaxPeriod > 0) {
                maxPeriod = Math.max(maxPeriod, currentSignalMaxPeriod);
            }
        }
    }

    // CRITICAL SAFETY: Always ensure minimum for common long-period indicators
    // If we detect any MA-related signals enabled, ensure we have enough data for MA200
    const enabledKeys = Object.keys(signalSettings).filter(key => signalSettings[key]?.enabled);
    const hasMaSignals = enabledKeys.some(key =>
        key.toLowerCase().includes('ma') ||
        key.toLowerCase().includes('sma') ||
        key.toLowerCase().includes('ema') ||
        key.toLowerCase().includes('200') // Check for "200" in key name too
    );

    // Add a safety buffer for MA200 if any other MA signal is present, as it's a common baseline
    if (hasMaSignals && maxPeriod < 200) {
        maxPeriod = 200; // Sets maxPeriod to 200 if any MA signals are present
        hasLongPeriodIndicators = true;
        detectedPeriods.push('SAFETY_MA200=200');
    }

    // Add a generous buffer for warm-up
    let buffer;
    if (hasLongPeriodIndicators || maxPeriod >= 100) {
        // Reduced buffer: e.g., if maxPeriod is 200, then Math.max(30, 200 * 0.15 = 30) => buffer = 30
        buffer = Math.max(30, Math.ceil(maxPeriod * 0.15));
    } else {
        // Reduced buffer: e.g., if maxPeriod is 50, then Math.max(20, 50 * 0.25 = 12.5) => buffer = 20
        buffer = Math.max(20, Math.ceil(maxPeriod * 0.2));
    }

    const finalLimit = maxPeriod + buffer;

    // CRITICAL FIX: Ensure minimum of 50 candles to meet requirement (line 999, 1595)
    // This ensures even state-based signals without explicit periods get enough data
    return Math.max(50, finalLimit);
}

/**
 * TradeManager handles the logic related to potential trade execution and position management.
 * NOTE: The actual 'open position' logic has been moved out to a utility function for better
 * modularity and to allow for pre-calculation of indicators. This class now primarily
 * acts as a state and log provider to the SignalDetectionEngine.
 */
class TradeManager {
    constructor(scannerService) {
        // Keep original service reference for existing methods
        this.scannerService = scannerService;
        // Keep original addLog binding for existing methods
        this.addLog = scannerService.addLog.bind(scannerService);
        // New log function for new methods, allowing custom data structure
        this.log = (msg, type, data) => scannerService.addLog(msg, type, data);
        // New method to get scanner service's state
        this.getState = scannerService.getState.bind(scannerService);
    }

    /**
     * Calculates the Stop Loss and Take Profit prices based on strategy and market data.
     * This method is preserved for potential future use or external calls,
     * but trade opening now uses the percentage-based calculation in _openPosition.
     * @param {object} strategy - The strategy object.
     * @param {number} currentPrice - The current market price.
     * @param {number} atrValue - The current ATR value.
     * @param {number} convictionScore - The conviction score from the signal evaluation.
     * @returns {{stopLossPrice: number, takeProfitPrice: number}} An object containing the calculated stop loss and take profit prices.
     */
    calculateExitPrices(strategy, currentPrice, atrValue, convictionScore) {
        // Provide sensible defaults if strategy does not specify ATR multipliers
        const DEFAULT_SL_ATR = this.state?.scannerSettings?.defaultStopLossAtrMultiplier ?? 2.5;
        const DEFAULT_TP_ATR = this.state?.scannerSettings?.defaultTakeProfitAtrMultiplier ?? 5.0;
        const stopLossMultiplier = (strategy.stopLossAtrMultiplier ?? DEFAULT_SL_ATR);
        const takeProfitMultiplier = (strategy.takeProfitAtrMultiplier ?? DEFAULT_TP_ATR);

        const stopLossPrice = strategy.strategyDirection === 'long'
            ? currentPrice - (atrValue * stopLossMultiplier)
            : currentPrice + (atrValue * stopLossMultiplier);

        const takeProfitPrice = strategy.strategyDirection === 'long'
            ? currentPrice + (atrValue * takeProfitMultiplier)
            : currentPrice - (atrValue * takeProfitMultiplier);

        return { stopLossPrice, takeProfitPrice };
    }
}

export class SignalDetectionEngine {
    constructor(scannerService) {
        if (!scannerService || typeof scannerService.addLog !== 'function') {
            throw new Error('SignalDetectionEngine requires a valid scannerService with addLog method');
        }
        this.scannerService = scannerService;

        this.autoScannerService = this.scannerService; // Alias for backward compatibility if needed
        this.state = {};
        this.tradeManager = new TradeManager(this);
        // PositionSizeValidator is now expected to be managed by PositionManager, as per the outline's refactoring.
        // REMOVED: this.positionSizeValidator = new PositionSizeValidator(this.addLog.bind(this)); // Initialize PositionSizeValidator
        this.abortController = null; // Initialize AbortController
        this._currentScanSkipReasons = null;
        this.atrLogCounter = 0; // Track how many ATR logs we've shown
        this.maxAtrLogs = 5; // Only show first 5 strategies per scan cycle
    }

    /**
     * MEMORY FIX: Add explicit cleanup method
     */
    cleanup() {
        // Clear all caches managed by apiQueue
        // `this.klineDataCache` and `this.priceCache` are not class properties; they are local variables in scanForSignals.
        // Therefore, we focus cleanup on the shared `apiQueue` caches.
        apiQueue.clearCache('kline-');
        apiQueue.clearCache('prices-');
        apiQueue.aggressiveCacheCleanup(); // Call the aggressive cleanup function

        console.log('[SIGNAL_ENGINE] Cleanup completed - API queue caches cleared');
    }

    addLog(message, type = 'info', level = 0, data = null) {
        if (this.scannerService && this.scannerService.addLog) {
            const finalData = { ...(data || {}), level };
            this.scannerService.addLog(message, type, finalData);
        }
    }

    cancel() {
        this.addLog(`[SCAN_STOP_REQUESTED] Cancellation flag set.`, 'warning', 0);
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * Provides the current state to components that need it (e.g., TradeManager).
     * @returns {object} The current state object.
     */
    getState() {
        return {
            walletState: this.state.walletState,
            scannerSettings: this.state.scannerSettings,
            marketRegime: this.state.marketRegime
        };
    }

    /**
     * Helper method to track skip reasons internally.
     * This method updates a skipReasons object associated with the current scan cycle.
     * @param {string} reason - The reason for skipping a strategy.
     */
    trackSkipReason(reason) {
        if (this._currentScanSkipReasons) {
            this._currentScanSkipReasons[reason] = (this._currentScanSkipReasons[reason] || 0) + 1;
        } else {
            console.warn("trackSkipReason called without an active scan context (_currentScanSkipReasons is null).");
        }
    }

    /**
     * Evaluates a single strategy. This method now calculates indicators internally
     * and performs signal evaluation, conviction scoring, pre-trade checks, and delegates trade execution.
     * It returns a simplified object indicating if a signal was "matched" and, if so, the prepared position.
     * Any blocking conditions (like low strength, low conviction, or invalid position size) result in `matched: false`.
     *
     * @param {object} strategy - The strategy object.
     * @param {Array<object>} klines - The kline data for the strategy's coin and timeframe, already formatted.
     * @param {object} indicators - Pre-calculated indicators for the klines.
     * @param {Map<string, number>} currentPrices - Map of current market prices by symbol.
     * @param {object} walletState - The current state of the virtual wallet.
     * @param {object} settings - Global scanner settings.
     * @param {object} marketRegime - The current market regime.
     * @returns {{matched: boolean, newlyOpenedPosition?: object, noMatchReason?: string, blockReason?: string, convictionScoreAtBlock?: number}}
     */
    async evaluateStrategy(strategy, klines, indicators, currentPrices, walletState, settings, marketRegime) {
        const result = {
            matched: false,
            newlyOpenedPosition: null,
            noMatchReason: null,
            blockReason: null,
            convictionScoreAtBlock: null
        };

        try {
            this.addLog(`🔎 [EVALUATING] ${strategy.combinationName} (Regime: ${marketRegime?.regime || 'unknown'})`, 'evaluating_strategy', { level: 1 });

            if (!klines || klines.length < 50) {
                result.noMatchReason = `Insufficient kline data (${klines?.length || 0} candles).`;
                this.addLog(`❌ ${result.noMatchReason} Skipping strategy.`, 'warning', { strategyName: strategy.combinationName, level: 1 });
                return result;
            }

            const symbolNoSlash = (strategy.coin || '').replace('/', '');
            let priceAtMatch = currentPrices.get(symbolNoSlash);

            // FALLBACK: If price not in cache, try to fetch it on-demand
            if ((typeof priceAtMatch !== 'number' || isNaN(priceAtMatch)) && this.scannerService.priceManagerService) {
                try {
                    const fetchedPrice = await this.scannerService.priceManagerService.getCurrentPrice(strategy.coin);
                    if (fetchedPrice && typeof fetchedPrice === 'number' && !isNaN(fetchedPrice) && fetchedPrice > 0) {
                        priceAtMatch = fetchedPrice;
                        // Update the Map so subsequent strategies can use it
                        currentPrices.set(symbolNoSlash, fetchedPrice);
                        // console.log(`[SignalDetectionEngine] ✅ Fetched on-demand price for ${strategy.coin}: ${fetchedPrice}`);
                    }
                } catch (fetchError) {
                    console.warn(`[SignalDetectionEngine] ⚠️ Failed to fetch on-demand price for ${strategy.coin}:`, fetchError.message);
                }
            }

            if (typeof priceAtMatch !== 'number' || isNaN(priceAtMatch)) {
                result.noMatchReason = `Current price for ${strategy.coin} is not available or invalid.`;
                this.addLog(`❌ ${result.noMatchReason} Skipping strategy.`, 'warning', { strategyName: strategy.combinationName, level: 1 });
                console.error(`❌ ${result.noMatchReason} Skipping strategy.`, 'warning', { strategyName: strategy.combinationName, level: 1 });
                return result;
            }

            // --- Perform Signal Evaluation ---
            const evaluationResult = await this._evaluateSignalAndConviction(
                strategy,
                { klines: klines, priceAtMatch }, // Pass the klineData object with priceAtMatch
                indicators,
                marketRegime
            );

            let matched = evaluationResult.isMatch;
            let combinedStrength = evaluationResult.strength;
            let triggerSignals = evaluationResult.matchedSignals;
            let convictionResult = evaluationResult.convictionResult;
            let strengthBreakdown = evaluationResult.strengthBreakdown || null; // Capture breakdown for analytics

            result.convictionScoreAtBlock = convictionResult.score;

            if (evaluationResult.signalLog && evaluationResult.signalLog.length > 0) {
                evaluationResult.signalLog.forEach(logEntry => {
                    const message = `${' '.repeat(4)}${logEntry.message}`;
                    this.addLog(message, logEntry.type, { ...logEntry.data, level: 2 });
                });
            }

            if (!matched) {
                result.noMatchReason = evaluationResult.noMatchReason;
                this.addLog(`No signal match for ${strategy.combinationName}. Reason: ${result.noMatchReason}`, 'info', { level: 1 });
                return result;
            }

            // --- Check Minimum Strength Threshold ---
            const requiredStrength = settings.minimumCombinedStrength || 225;

            this.addLog(`Live Strength: ${combinedStrength.toFixed(0)} vs Required Strength: ${requiredStrength}`, 'info', { level: 2 });
            this.addLog('═══════════════════════════════════════════════════════', 'cycle-end');

            if (combinedStrength < requiredStrength) {
                result.noMatchReason = `Combined strength below minimum threshold`;
                this.addLog(`❌ ${result.noMatchReason}`, 'info', { level: 1 });
                return result;
            }

            this.addLog(`Strong signal found for ${strategy.combinationName}.`, 'trade_signal', { level: 2, strategy: strategy.combinationName });

            // --- Dynamic Conviction Threshold Logic ---
            const performanceMomentumScore = this.scannerService?.getState()?.performanceMomentumScore;
            const dynamicConvictionThreshold = computeDynamicConvictionThreshold(settings, performanceMomentumScore);

            this.addLog(
                `[CONVICTION_CHECK] Strategy: ${strategy.combinationName}, Conviction: ${convictionResult.score.toFixed(1)}, Dynamic Threshold: ${dynamicConvictionThreshold.toFixed(1)} (Base: ${settings.minimumConvictionScore}, Momentum: ${Number.isFinite(performanceMomentumScore) ? performanceMomentumScore.toFixed(1) : 'N/A'})`,
                'info',
                {
                    level: 2,
                    strategyName: strategy.combinationName,
                    convictionScore: convictionResult.score,
                    dynamicThreshold: dynamicConvictionThreshold,
                    baseThreshold: settings.minimumConvictionScore,
                    momentumScore: performanceMomentumScore
                }
            );

            if (convictionResult.score < dynamicConvictionThreshold) {
                result.blockReason = `Conviction score (${convictionResult.score.toFixed(1)}) below dynamic threshold (${dynamicConvictionThreshold.toFixed(1)}). Base: ${settings.minimumConvictionScore}, Momentum: ${Number.isFinite(performanceMomentumScore) ? performanceMomentumScore.toFixed(1) : 'N/A'}.`;
                this.addLog(`🔻 Trade for ${strategy.combinationName} blocked: ${result.blockReason}`, 'block', {
                    level: 2,
                    strategy: strategy.combinationName,
                    reason: result.blockReason,
                    details: {
                        convictionScore: convictionResult.score,
                        dynamicThreshold: dynamicConvictionThreshold,
                        baseThreshold: settings.minimumConvictionScore,
                        momentumScore: performanceMomentumScore
                    }
                });
                return result;
            }

            this.addLog(`🎯 High conviction signal! Score: ${convictionResult.score.toFixed(1)} (dynamic threshold: ${dynamicConvictionThreshold.toFixed(1)})`, 'success', { level: 2 });


            // --- Position Sizing Logic ---
            this.addLog(`[SDE_ROUTING] Routing to centralized PositionSizeValidator. Sizing mode: ${settings.useWinStrategySize !== false ? 'Volatility-Adjusted' : 'Fixed'}`, 'info', { combination: strategy.combinationName });

            const atrValueForLog = indicators?.atr && indicators.atr.length > 0
                ? indicators.atr[indicators.atr.length - 1]
                : null;

            const availableUsdtBalance = parseFloat((walletState.balances || []).find(b => b.asset === 'USDT')?.free || 0);

            const sizeResult = await this.scannerService.positionManager.positionSizeValidator.calculate({
                balance: availableUsdtBalance,
                riskPercentage: settings.riskPerTrade || 2,
                atr: atrValueForLog,
                stopLossAtrMultiplier: strategy.stopLossAtrMultiplier || 2.5,
                convictionScore: convictionResult.score,
                currentPrice: priceAtMatch,
                defaultPositionSize: settings.defaultPositionSize || 100,
                useWinStrategySize: settings.useWinStrategySize !== false,
                minimumTradeValue: settings.minimumTradeValue || 10,
                symbol: strategy.coin || 'UNKNOWN',
                exchangeInfo: this.scannerService.getExchangeInfo ? this.scannerService.getExchangeInfo(strategy.coin?.replace('/', '')) : null
            });

            if (!sizeResult.isValid) {
                const blockKey = sizeResult.details || `Calculated position size below minimum trade value`;
                result.blockReason = blockKey;
                this.addLog(`🔻 Trade for ${strategy.combinationName} blocked: ${result.blockReason}`, 'block', {
                    level: 2,
                    strategy: strategy.combinationName,
                    reason: result.blockReason,
                    details: sizeResult.details || result.blockReason
                });
                return result;
            }

            const positionSizeUsdt = sizeResult.positionSizeUSDT;
            this.addLog(`[SignalDetectionEngine] Position size calculated: ${positionSizeUsdt?.toFixed(2)} USDT`, 'info', { level: 2 });

            // All checks passed, prepare the trade parameters.
            result.matched = true;
            
            // DEBUG: Log strategy object to understand missing fields
            
            result.newlyOpenedPosition = {
                strategy_name: strategy.combinationName,
                symbol: strategy.coin,
                direction: strategy.strategyDirection || 'long',
                entry_price: priceAtMatch,
                entry_value_usdt: sizeResult.positionSizeUSDT,
                quantity_crypto: sizeResult.positionSizeUSDT / priceAtMatch,
                leverage: 1,
                wallet_allocation_percentage: null,

                combination: strategy,
                currentPrice: priceAtMatch,
                convictionScore: convictionResult.score,

                stop_loss_price: (atrValueForLog !== null && strategy.stopLossAtrMultiplier !== undefined && strategy.stopLossAtrMultiplier !== null)
                    ? (strategy.strategyDirection === 'long'
                        ? priceAtMatch - (atrValueForLog * strategy.stopLossAtrMultiplier)
                        : priceAtMatch + (atrValueForLog * strategy.stopLossAtrMultiplier))
                    : null,
                take_profit_price: (atrValueForLog !== null && strategy.takeProfitAtrMultiplier !== undefined && strategy.takeProfitAtrMultiplier !== null)
                    ? (strategy.strategyDirection === 'long'
                        ? priceAtMatch + (atrValueForLog * strategy.takeProfitAtrMultiplier)
                        : priceAtMatch - (atrValueForLog * strategy.takeProfitAtrMultiplier))
                    : null,

                conviction_score: convictionResult.score,
                conviction_multiplier: convictionResult.multiplier,
                conviction_breakdown: convictionResult.breakdown,
                market_regime: marketRegime.regime,
                regime_confidence: marketRegime.confidence,
                trigger_signals: triggerSignals,
                combined_strength: combinedStrength,
                // NEW: Include strength breakdown for analytics (regime and correlation impacts)
                strength_breakdown: strengthBreakdown,
                regime_impact_on_strength: strengthBreakdown?.regimeAdjustment || null,
                correlation_impact_on_strength: strengthBreakdown?.correlationAdjustment || null,

                klines: klines,
                indicators: indicators,

                riskPercentage: strategy.riskPercentage || 1,
                stopLossAtrMultiplier: strategy.stopLossAtrMultiplier || 2.5,
                takeProfitAtrMultiplier: strategy.takeProfitAtrMultiplier || 3.0,
                enableTrailingTakeProfit: strategy.enableTrailingTakeProfit !== false,

                estimatedExitTimeMinutes: strategy.estimatedExitTimeMinutes,
                time_exit_hours: strategy.estimatedExitTimeMinutes
                    ? strategy.estimatedExitTimeMinutes / 60
                    : null,

                riskSettings: {
                    useWinStrategySize: settings.useWinStrategySize,
                    riskPerTrade: settings.riskPerTrade,
                    defaultPositionSize: settings.defaultPositionSize,
                    minimumTradeValue: settings.minimumTradeValue,
                },
                scannerSettings: settings,
                originalStrategy: strategy,

                atr_value: atrValueForLog,
                is_event_driven_strategy: this.isEventDrivenStrategy(strategy.combinationName)
            };

            return result;


        } catch (error) {
            result.matched = false;
            result.noMatchReason = `Evaluation error: ${error.message}`;
            result.blockReason = `Critical error during evaluation.`;

            console.error(`[CRITICAL_ERROR] Error in evaluateStrategy for ${strategy.combinationName}: ${error.message}`, 'error');
            if (error.stack) {
                console.error(`[CRITICAL_ERROR] Stack: ${error.stack}`, 'debug');
            }
            return result;
        }
    }

    /**
     * Helper method that evaluates signals and calculates conviction only if there's a match.
     * This method encapsulates the core signal and conviction logic.
     * @param {object} strategy - The strategy object.
     * @param {{klines: Array<object>, priceAtMatch: number}} klineData - Kline data and the derived priceAtMatch.
     * @param {object} indicators - Pre-calculated indicators for the klines.
     * @param {object} marketRegime - The current market regime.
     * @returns {Promise<object>} An object containing signal match, strength, matched signals, conviction score, etc.
     */
    async _evaluateSignalAndConviction(strategy, klineData, indicators, marketRegime) {
        if (!strategy || !klineData || !indicators) {
            return { isMatch: false, strength: 0, matchedSignals: [], failedConditions: ['Missing strategy, klineData, or indicators'], convictionResult: { score: 0, multiplier: 1, breakdown: {} }, priceAtMatch: null, signalLog: [], noMatchReason: 'Missing strategy, klineData, or indicators', strengthBreakdown: null };
        }

        const { klines, priceAtMatch } = klineData;
        if (!klines || klines.length === 0) {
            return { isMatch: false, strength: 0, matchedSignals: [], failedConditions: ['Kline data is empty'], convictionResult: { score: 0, multiplier: 1, breakdown: {} }, priceAtMatch: null, signalLog: [], noMatchReason: 'Kline data is empty', strengthBreakdown: null };
        }

        const signalConditionsResult = evaluateSignalConditions(
            strategy,
            indicators,
            klines,
            marketRegime // Pass actual market regime and confidence
        );

        const { isMatch, combinedStrength: strength, matchedSignals, failedConditions: rawFailedConditions, log: signalLog, strengthBreakdown } = signalConditionsResult;

        // Sample log: print one combined-strength evaluation per session
        try {
            if (typeof window !== 'undefined' && !window.__combinedStrengthLoggedOnce) {
                window.__combinedStrengthLoggedOnce = true;
                const signalBrief = Array.isArray(matchedSignals)
                    ? matchedSignals.map(s => ({ type: s.type || s.name, strength: s.strength }))
                    : [];
                // console.log('[COMBINED_STRENGTH_SAMPLE] Strategy:', strategy?.combinationName, {
                //     combinedStrength: strength,
                //     matchedSignals: signalBrief,
                //     regime: marketRegime?.regime,
                //     regimeConfidence: marketRegime?.confidence
                // });
            }
        } catch (_e) {}
        const failedConditions = rawFailedConditions || [];

        if (!isMatch || !matchedSignals || matchedSignals.length === 0) {
            return {
                isMatch: false,
                strength: 0,
                matchedSignals: [],
                failedConditions,
                convictionResult: { score: 0, multiplier: 1, breakdown: {} },
                priceAtMatch,
                signalLog,
                noMatchReason: failedConditions.length > 0 ? failedConditions.join('; ') : 'No signal conditions met',
                strengthBreakdown: null
            };
        }

        const convictionResult = calculateConvictionScore(
            strategy,
            matchedSignals,
            indicators,
            klines,
            marketRegime,
            priceAtMatch
        );

        // Sample log: print one conviction evaluation per session to verify parameters and math
        try {
            if (typeof window !== 'undefined' && !window.__convictionLoggedOnce) {
                window.__convictionLoggedOnce = true;
                const breakdownSummary = {
                    marketRegime: convictionResult?.breakdown?.marketRegime?.score,
                    signalStrength: convictionResult?.breakdown?.signalStrength?.score,
                    volatility: convictionResult?.breakdown?.volatility?.score,
                    demoPerformance: convictionResult?.breakdown?.demoPerformance?.score
                };
                // console.log('[CONVICTION_SAMPLE] Strategy:', strategy?.combinationName, {
                //     score: convictionResult?.score,
                //     multiplier: convictionResult?.multiplier,
                //     breakdown: breakdownSummary,
                //     matchedSignalsCount: matchedSignals?.length || 0,
                //     regime: marketRegime?.regime,
                //     priceAtMatch
                // });
            }
        } catch (_e) {}

        return {
            isMatch: true,
            strength,
            matchedSignals,
            failedConditions,
            convictionResult,
            priceAtMatch,
            signalLog,
            noMatchReason: null,
            strengthBreakdown: strengthBreakdown || null // Include breakdown for analytics
        };
    }

    /**
     * Builds the trade parameters object expected by the autoScannerService.executeTrade method.
     * @param {object} strategy - The strategy object.
     * @param {string} symbol - The trading symbol (e.g., BTC/USDT).
     * @param {number} priceAtMatch - The entry price.
     * @param {object} positionDetails - The result from PositionSizeValidator (positionSizeUSDT, quantityCrypto, riskAmountUsdt, stopLossPrice).
     * @param {object} convictionResult - The conviction score result.
     * @param {Array<object>} triggerSignals - Array of signals that triggered the trade.
     * @param {object} indicators - All calculated indicators.
     * @param {Array<object>} klines - The kline data.
     * @param {number} combinedStrength - The combined strength of the signals.
     * @returns {object} The formatted trade parameters.
     */
    buildTradeParams(strategy, symbol, priceAtMatch, positionDetails, convictionResult, triggerSignals, indicators, klines, combinedStrength) {
        const settings = this.state.scannerSettings;
        // Get symbol-specific ATR data
        const symbolNoSlash = symbol.replace('/', '');
        const symbolIndicators = this.scannerService.state.indicators?.[symbolNoSlash];
        const atrValue = symbolIndicators?.atr && symbolIndicators.atr.length > 0 ? symbolIndicators.atr[symbolIndicators.atr.length - 1] : null;

        const stopLossMultiplier = strategy.stopLossAtrMultiplier;
        const takeProfitMultiplier = strategy.takeProfitAtrMultiplier;

        const stopLossPrice = positionDetails.stopLossPrice || (
            atrValue !== null && stopLossMultiplier !== undefined && stopLossMultiplier !== null
                ? (strategy.strategyDirection === 'long'
                    ? priceAtMatch - (atrValue * stopLossMultiplier)
                    : priceAtMatch + (atrValue * stopLossMultiplier))
                : null
        );

        const takeProfitPrice = (atrValue !== null && takeProfitMultiplier !== undefined && takeProfitMultiplier !== null)
            ? (strategy.strategyDirection === 'long'
                ? priceAtMatch + (atrValue * takeProfitMultiplier)
                : priceAtMatch - (atrValue * takeProfitMultiplier))
            : null;

        // Diagnostics: one-time per session sample of SL/TP derivation
        try {
            if (typeof window !== 'undefined' && !window.__slTpLoggedOnce) {
                window.__slTpLoggedOnce = true;
                const atrPct = atrValue ? ((atrValue / priceAtMatch) * 100).toFixed(3) : 'n/a';
                console.log('[SLTP_SAMPLE]', {
                    strategy: strategy?.combinationName,
                    direction: strategy?.strategyDirection,
                    priceAtMatch,
                    atrValue,
                    atrPct: `${atrPct}%`,
                    stopLossAtrMultiplier: stopLossMultiplier,
                    takeProfitAtrMultiplier: takeProfitMultiplier,
                    computedStopLoss: stopLossPrice,
                    computedTakeProfit: takeProfitPrice
                });
            }
        } catch (_) {}

        return {
            strategy_name: strategy.combinationName,
            symbol: symbol,
            direction: strategy.strategyDirection,
            entry_price: priceAtMatch,
            entry_value_usdt: positionDetails.positionSizeUSDT,
            quantity_crypto: positionDetails.quantityCrypto,
            leverage: 1,
            wallet_allocation_percentage: (positionDetails.positionSizeUSDT / this.state.walletState.balance_usdt) * 100,
            stop_loss_price: stopLossPrice,
            take_profit_price: takeProfitPrice,
            conviction_score: convictionResult.score,
            conviction_multiplier: convictionResult.multiplier,
            conviction_breakdown: convictionResult.breakdown,
            market_regime: this.state.marketRegime?.regime,
            regime_confidence: this.state.marketRegime?.confidence,
            trigger_signals: triggerSignals,
            combined_strength: combinedStrength,
            klines: klines,
            indicators: indicators,
            riskPercentage: strategy.riskPercentage || 1,
            stopLossAtrMultiplier: strategy.stopLossAtrMultiplier || 2.5,
            takeProfitAtrMultiplier: strategy.takeProfitAtrMultiplier || 3.0,
            enableTrailingTakeProfit: strategy.enableTrailingTakeProfit !== false,
            estimatedExitTimeMinutes: strategy.estimatedExitTimeMinutes,
            time_exit_hours: strategy.estimatedExitTimeMinutes ? strategy.estimatedExitTimeMinutes / 60 : null,
            riskSettings: {
                useWinStrategySize: settings.useWinStrategySize,
                riskPerTrade: settings.riskPerTrade,
                defaultPositionSize: settings.defaultPositionSize,
                minimumTradeValue: settings.minimumTradeValue,
            },
            scannerSettings: settings,
            originalStrategy: strategy
        };
    }

    /**
     * NEW: Centralized logic to update trailing stop for a position.
     * This method MODIFIES the position object directly.
     */
    updateTrailingStop(position, currentPrice) {
        if (!position.enableTrailingTakeProfit) return;

        // CRITICAL FIX: Convert entry_price to number (may be string from DB/JSON)
        const entryPrice = Number(position.entry_price) || 0;
        if (entryPrice <= 0) {
            console.warn(`[updateTrailingStop] Invalid entry_price for position ${position.position_id}: ${position.entry_price}`);
            return;
        }

        const activationPriceChange = position.direction === 'long'
            ? (currentPrice - entryPrice) / entryPrice
            : (entryPrice - currentPrice) / entryPrice;

        if (!position.is_trailing && activationPriceChange > 0.005) { // 0.5% profit threshold to activate
            position.is_trailing = true;
            position.status = 'trailing';
            position.trailing_peak_price = currentPrice;

            const trailingDistance = currentPrice * (position.trailingStopPercentage || 0.01);
            position.trailing_stop_price = position.direction === 'long'
                ? currentPrice - trailingDistance
                : currentPrice + trailingDistance;

            this.addLog(`🔄 Trailing activated for ${position.symbol} (ID: ${position.position_id.slice(-8)}) at ${currentPrice.toFixed(6)}`, 'info');
        }

        if (position.is_trailing) {
            // CRITICAL FIX: Convert trailing_stop_price to number for logging
            const currentTrailingStopForLog = Number(position.trailing_stop_price) || 0;
            this.addLog(`[POS_MON] 📊 Checking trailing stop for ${position.position_id.slice(-8)}: current $${currentPrice.toFixed(6)}, trailing stop $${currentTrailingStopForLog.toFixed(6)}`, 'debug');

            // CRITICAL FIX: Convert trailing_peak_price to number
            const trailingPeakPrice = Number(position.trailing_peak_price) || entryPrice;
            
            const shouldUpdatePeak = position.direction === 'long'
                ? currentPrice > trailingPeakPrice
                : currentPrice < trailingPeakPrice;

            if (shouldUpdatePeak) {
                const oldPeak = trailingPeakPrice; // For logging old peak
                position.trailing_peak_price = currentPrice;
                const trailingDistance = currentPrice * (position.trailingStopPercentage || 0.01);
                const newTrailingStop = position.direction === 'long'
                    ? currentPrice - trailingDistance
                    : currentPrice + trailingDistance;

                // CRITICAL FIX: Convert trailing_stop_price to number
                const currentTrailingStop = Number(position.trailing_stop_price) || 0;
                const isBetterStop = position.direction === 'long'
                    ? newTrailingStop > currentTrailingStop
                    : newTrailingStop < currentTrailingStop;

                if (isBetterStop) {
                    position.trailing_stop_price = newTrailingStop;
                    this.addLog(`[POS_MON] 🚀 New ${position.direction === 'long' ? 'peak' : 'trough'} for ${position.position_id.slice(-8)}: $${oldPeak.toFixed(6)} → $${currentPrice.toFixed(6)}, new trailing stop: $${position.trailing_stop_price.toFixed(6)}`, 'debug');
                }
            }
        }
    }

    /**
     * RENAMED: Centralized logic to check all exit conditions for a position.
     * Formerly checkExitConditions.
     * @param {object} position - The position object.
     * @param {number} currentPrice - The current market price.
     * @returns {{shouldClose: boolean, reason: string | null}}
     */
    _analyzeCloseConditions(position, currentPrice) {
        const entryTime = new Date(position.entry_timestamp).getTime();
        const timeElapsedHours = (1.0 * Date.now() - entryTime) / (1000 * 3600);
        this.addLog(`[POS_MON] Position ${position.position_id.slice(-8)} age: ${timeElapsedHours.toFixed(2)} hours`, 'debug');

        // CRITICAL FIX: Convert numeric fields to numbers (may be strings from DB/JSON)
        const timeExitHours = Number(position.time_exit_hours) || 0;
        const trailingStopPrice = Number(position.trailing_stop_price) || 0;
        const stopLossPrice = Number(position.stop_loss_price) || 0;
        const takeProfitPrice = Number(position.take_profit_price) || 0;

        // PRIORITY 1: Stop Loss (protect capital first) - ALWAYS check before timeout
        // Check initial stop loss if not using trailing stop
        if (!position.is_trailing && stopLossPrice > 0) {
            if (position.direction === 'long' && currentPrice <= stopLossPrice) {
                this.addLog(`[POS_MON] 🛑 STOP LOSS HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} vs SL $${stopLossPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'stop_loss' };
            }
            if (position.direction === 'short' && currentPrice >= stopLossPrice) {
                this.addLog(`[POS_MON] 🛑 STOP LOSS HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} vs SL $${stopLossPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'stop_loss' };
            }
        }

        // PRIORITY 2: Take Profit (lock profits) - Check before timeout
        // Fixed Take Profit Hit (only for non-trailing trades)
        if (!position.enableTrailingTakeProfit && takeProfitPrice > 0) {
            if (position.direction === 'long' && currentPrice >= takeProfitPrice) {
                this.addLog(`[POS_MON] 🎯 TAKE PROFIT HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} vs TP $${takeProfitPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'take_profit' };
            }
            if (position.direction === 'short' && currentPrice <= takeProfitPrice) {
                this.addLog(`[POS_MON] 🎯 TAKE PROFIT HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} vs TP $${takeProfitPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'take_profit' };
            }
        }

        // PRIORITY 3: Trailing Stop Loss (protect profits) - Check before timeout
        if (position.is_trailing && trailingStopPrice > 0) {
            if (position.direction === 'long' && currentPrice <= trailingStopPrice) {
                this.addLog(`[POS_MON] 🎯 TRAILING STOP HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} <= $${trailingStopPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'trailing_stop_hit' };
            }
            if (position.direction === 'short' && currentPrice >= trailingStopPrice) {
                this.addLog(`[POS_MON] 🎯 TRAILING STOP HIT for ${position.position_id.slice(-8)}: $${currentPrice.toFixed(6)} >= $${trailingStopPrice.toFixed(6)}`, 'debug');
                return { shouldClose: true, reason: 'trailing_stop_hit' };
            }
        }

        // PRIORITY 4: Time-based Exit (last resort)
        // Timeout exits are checked last, after SL/TP have been checked
        if (timeExitHours > 0) {
            const timeExitMilliseconds = timeExitHours * 60 * 60 * 1000;
            const exitTimestamp = entryTime + timeExitMilliseconds;
            const now = Date.now();

            if (now >= exitTimestamp) {
                this.addLog(`[POS_MON] ⏰ TIMEOUT DETECTED for ${position.position_id.slice(-8)}: ${timeElapsedHours.toFixed(2)}h >= ${timeExitHours}h`, 'debug');
                return { shouldClose: true, reason: position.is_trailing ? 'timeout_after_trailing' : 'timeout_no_trailing' };
            }
        }

        return { shouldClose: false, reason: null };
    }

    /**
     * ENHANCED: Strategy selection with demo performance prioritization
     * Selects the best strategy from a list of eligible strategies based on a comprehensive scoring system.
     * @param {Array<object>} eligibleStrategies - List of strategies to choose from.
     * @param {string} symbol - The symbol (e.g., BTC/USDT) for which strategies are being considered.
     * @returns {object|null} The selected strategy or null if no eligible strategy is found.
     */
    async selectBestStrategy(eligibleStrategies, symbol) {
        if (eligibleStrategies.length === 0) return null;

        // Get current positions to avoid over-concentration
        const currentPositions = this.state.walletState?.positions || [];
        const positionsByStrategy = new Map();
        currentPositions.forEach(pos => {
            const count = positionsByStrategy.get(pos.strategy_name) || 0;
            positionsByStrategy.set(pos.strategy_name, count + 1);
        });

        // ENHANCED: Filter and rank strategies by comprehensive performance
        const rankedStrategies = eligibleStrategies
            .filter(strategy => {
                // Skip strategies that already have too many positions
                const currentPositionsCount = positionsByStrategy.get(strategy.combinationName) || 0;
                return currentPositionsCount < (this.state.scannerSettings?.maxPositions || 10);
            })
            .map(strategy => {
                // COMPREHENSIVE SCORING: Combine demo performance, backtest performance, and recency
                const demoTrades = strategy.realTradeCount || 0;
                const demoProfitFactor = strategy.realProfitFactor || 0;
                const demoSuccessRate = strategy.realSuccessRate || 0;
                const backtestProfitFactor = strategy.profitFactor || 0;
                const backtestSuccessRate = strategy.successRate || 0;

                let finalScore = 0;
                let confidenceLevel = 'low';

                if (demoTrades >= 15) {
                    // High confidence: Heavily weight demo performance
                    finalScore = (demoProfitFactor * 50) + (demoSuccessRate * 0.5) + (strategy.combinedStrength * 0.1);
                    confidenceLevel = 'high';

                    // PENALTY: Heavily penalize strategies with poor demo performance
                    if (demoProfitFactor < 1.0 && demoSuccessRate < 50) {
                        finalScore *= 0.2; // 80% penalty for proven underperformers
                    }
                } else if (demoTrades > 10) {
                    // UPDATED: Medium confidence threshold changed to >10 trades
                    // Medium confidence: Balance demo and backtest
                    finalScore = (demoProfitFactor * 30) + (demoSuccessRate * 0.3) +
                        (backtestProfitFactor * 20) + (backtestSuccessRate * 0.2) +
                        (strategy.combinedStrength * 0.15);
                    confidenceLevel = 'medium';

                    // PENALTY: Moderate penalty for poor demo performance
                    if (demoProfitFactor < 0.8 && demoSuccessRate < 40) {
                        finalScore *= 0.5; // 50% penalty
                    }
                } else {
                    // Low confidence: Primarily backtest with caution
                    finalScore = (backtestProfitFactor * 30) + (backtestSuccessRate * 0.3) +
                        (strategy.combinedStrength * 0.2);
                    confidenceLevel = 'low';

                    // CAUTION: Small bonus for completely untested vs penalty for few bad trades
                    if (demoTrades === 0) {
                        finalScore += 5; // Small exploration bonus
                    } else {
                        finalScore *= 0.7; // Caution penalty for limited bad data
                    }
                }

                return {
                    ...strategy,
                    finalScore,
                    confidenceLevel,
                    currentPositions: positionsByStrategy.get(strategy.combinationName) || 0
                };
            })
            .sort((a, b) => b.finalScore - a.finalScore);

        if (rankedStrategies.length === 0) {
            return null;
        }

        const selectedStrategy = rankedStrategies[0];
        return selectedStrategy;
    }

    // Normalize a single ATR value to number or null
    _normalizeToNumber(v) {
        if (typeof v === "number" && isFinite(v)) return v;
        if (typeof v === "string") {
            const n = parseFloat(v);
            return isFinite(n) ? n : null;
        }
        if (v && typeof v === "object") {
            const candidates = ["ATR", "atr", "value", "v"];
            for (const k of candidates) {
                const val = v[k];
                if (typeof val === "number" && isFinite(val)) return val;
                if (typeof val === "string") {
                    const n = parseFloat(val);
                    if (isFinite(n)) return n;
                }
            }
        }
        return null;
    }

    // Map an indicator array to numbers/nulls robustly
    _normalizeIndicatorArray(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map((x) => this._normalizeToNumber(x));
    }

    // Find last valid number in an array (already normalized preferred)
    _findLastValidNumber(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        for (let i = arr.length - 1; i >= 0; i--) {
            const v = arr[i];
            if (typeof v === "number" && isFinite(v)) return v;
        }
        return null;
    }

    /**
     * NEW HELPER METHOD: Processes a group of strategies sharing the same coin and timeframe.
     * Calculates indicators once for the group and then evaluates each strategy.
     * @param {string} groupKey - Key identifying the group (e.g., "BTCUSDT-1h").
     * @param {Array<object>} strategiesInGroup - List of strategies belonging to this group.
     * @param {Array<object>} klineData - Pre-fetched and formatted kline data for this group.
     * @param {Map<string, number>} currentPrices - Current market prices for symbols.
     * @param {object} walletState - The current state of the virtual wallet.
     * @param {object} settings - Global scanner settings.
     * @param {object} marketRegime - The current market regime.
     * @param {object} cycleStats - Object to track scan statistics.
     * @returns {Promise<{success: boolean, tradeRequests: Array<object>, error: string | null}>} An object containing success status, prepared trade requests, and any error.
     */
    async _processStrategyGroup(groupKey, strategiesInGroup, klineData, currentPrices, walletState, settings, marketRegime, cycleStats) {
        const [coin, timeframe] = groupKey.split('-');

        const groupTradeRequests = [];

        const localCycleStats = {
            signalsFound: 0,
            tradesPrepared: 0, // This will count prepared trades
            strategiesEvaluated: 0,
            strategiesProcessed: 0,
            strategiesSkipped: 0,
            skipReasons: {},
            blockReasons: {},
            blockedTrades: [],
            alertsCreated: 0,
            totalCombinedStrength: 0,
            convictionFailureScores: [],
            totalConvictionFailures: 0,
        };

        try {
            if (!klineData || klineData.length < 50) {
                const reason = `Insufficient k-line data for ${groupKey} (${klineData?.length || 0} candles).`;
                this.scannerService.addLog(`[GROUP_PROCESS] Skipping group ${groupKey}: ${reason}`, 'warning');
                strategiesInGroup.forEach(strategy => {
                    if (!localCycleStats.skipReasons[reason]) { localCycleStats.skipReasons[reason] = 0; }
                    localCycleStats.skipReasons[reason]++;
                    localCycleStats.strategiesSkipped++;
                    localCycleStats.strategiesProcessed++;
                });
                return { success: false, tradeRequests: [], error: reason };
            }

            const indicatorSettingsForCalculation = {};
            strategiesInGroup.forEach(s => {
                (s.signals || []).forEach(signalDef => {
                    const signalTypeLower = signalDef.type.toLowerCase();
                    
                    // Normalize TTM Squeeze variations (handle ALL cases)
                    let normalizedType = signalTypeLower.trim();
                    if (normalizedType === 'ttmsqueeze' || normalizedType === 'ttm_squeeze' || normalizedType === 'ttm-squeeze') {
                        normalizedType = 'ttm_squeeze';
                        if (signalDef.type.toLowerCase().trim() !== 'ttm_squeeze') {
                            //console.log(`[SIGNAL_EXTRACTION] 🔄 Normalizing "${signalDef.type}" → "ttm_squeeze" for strategy "${s.combinationName}"`);
                        }
                    }
                    
                    indicatorSettingsForCalculation[normalizedType] = {
                        enabled: true,
                        ...(indicatorSettingsForCalculation[normalizedType] || {}),
                        ...(signalDef.parameters || {})
                    };
                    
                    // Log TTM Squeeze extraction
                    if (signalDef.type.toLowerCase().includes('squeeze') || signalDef.type.toLowerCase().includes('ttm')) {
                        //console.log(`[SIGNAL_EXTRACTION] ✅ Extracted TTM Squeeze signal: type="${signalDef.type}" → normalized="${normalizedType}", value="${signalDef.value || 'N/A'}"`);
                    }
                });
            });
            
            // Log all extracted signal types for debugging
            //console.log(`[SIGNAL_EXTRACTION] 📋 Extracted ${Object.keys(indicatorSettingsForCalculation).length} signal types:`, Object.keys(indicatorSettingsForCalculation));
            if (indicatorSettingsForCalculation.ttm_squeeze) {
                //console.log(`[SIGNAL_EXTRACTION] ✅✅✅ TTM_SQUEEZE FOUND IN EXTRACTION! ✅✅✅`);
            } else {
                //console.log(`[SIGNAL_EXTRACTION] ❌❌❌ TTM_SQUEEZE NOT FOUND IN EXTRACTION ❌❌❌`);
                // Debug: Check if it's there under different name
                const squeezeKeys = Object.keys(indicatorSettingsForCalculation).filter(k => k.includes('squeeze') || k.includes('ttm'));
                if (squeezeKeys.length > 0) {
                    console.log(`[SIGNAL_EXTRACTION] ⚠️ Found similar keys:`, squeezeKeys);
                }
            }

            if (!indicatorSettingsForCalculation.atr) {
                indicatorSettingsForCalculation.atr = { enabled: true, period: 14 };
            }
            if (!indicatorSettingsForCalculation.volume_sma) {
                indicatorSettingsForCalculation.volume_sma = { enabled: true, period: 20 };
            }
            if (!indicatorSettingsForCalculation.obv) {
                indicatorSettingsForCalculation.obv = { enabled: true };
            }

            this.scannerService.addLog(`[GROUP_INDICATORS] Calculating indicators for ${groupKey}...`, 'info');
            const allIndicators = calculateAllIndicators(klineData, indicatorSettingsForCalculation, this.scannerService.addLog.bind(this.scannerService));
            this.scannerService.addLog(`[GROUP_INDICATORS] Calculated ${Object.keys(allIndicators).length} indicators for ${groupKey}`, 'info');
            
            // FIXED: Store indicators per symbol in scanner service
            if (!this.scannerService.state.indicators) {
                this.scannerService.state.indicators = {};
            }
            this.scannerService.state.indicators[coin] = allIndicators;


            for (const strategy of strategiesInGroup) {
                localCycleStats.strategiesProcessed++;

                try {
                    // Call evaluateStrategy with the new signature and handle its new return type
                    const evaluationResult = await this.evaluateStrategy(
                        strategy,
                        klineData,
                        allIndicators,
                        currentPrices,
                        walletState,
                        settings,
                        marketRegime
                    );

                    localCycleStats.strategiesEvaluated++;

                    if (evaluationResult.matched) {
                        localCycleStats.signalsFound++;
                        localCycleStats.totalCombinedStrength += evaluationResult.newlyOpenedPosition.combined_strength; // Use combined_strength from prepared position

                        const ALERT_LIMIT = 5;
                        if (cycleStats && localCycleStats.alertsCreated < ALERT_LIMIT) {
                            try {
                                const alertTitle = `${strategy.strategyDirection === 'short' ? 'Sell' : 'Buy'} Opportunity: ${strategy.coin} via ${strategy.combinationName}`;
                                const alertDescription = `Signals met combined strength: ${evaluationResult.newlyOpenedPosition.combined_strength.toFixed(0)}. Market regime: ${marketRegime?.regime || 'Unknown'} (${((marketRegime?.confidence || 0) * 100).toFixed(1)}%). Conviction Score: ${evaluationResult.newlyOpenedPosition.conviction_score?.toFixed(0) || 'N/A'}%.`;

                                let severity = 'medium';
                                if (evaluationResult.newlyOpenedPosition.combined_strength >= 350) severity = 'high';
                                else if (evaluationResult.newlyOpenedPosition.combined_strength < 250) severity = 'low';

                                const signalNames = evaluationResult.newlyOpenedPosition.trigger_signals?.map(s => s.type) || [];

                                await queueEntityCall('MarketAlert', 'create', {
                                    title: alertTitle,
                                    description: alertDescription,
                                    type: 'opportunity',
                                    severity: severity,
                                    pairs_affected: [strategy.coin],
                                    signals_involved: signalNames,
                                    date_created: new Date().toISOString(),
                                    is_read: false,
                                    action_taken: false
                                });

                                localCycleStats.alertsCreated++;
                            } catch (alertError) {
                                this.addLog(`[ALERT_ERROR] Failed to create alert: ${alertError?.message || 'Unknown error'}`, 'warning', { level: 2 });
                            }
                        }

                        groupTradeRequests.push(evaluationResult.newlyOpenedPosition);
                        localCycleStats.tradesPrepared++;
                    } else if (evaluationResult.noMatchReason) {
                        if (!localCycleStats.skipReasons[evaluationResult.noMatchReason]) { localCycleStats.skipReasons[evaluationResult.noMatchReason] = 0; }
                        localCycleStats.skipReasons[evaluationResult.noMatchReason]++;
                        localCycleStats.strategiesSkipped++;
                    } else if (evaluationResult.blockReason) {
                        if (!localCycleStats.blockReasons[evaluationResult.blockReason]) { localCycleStats.blockReasons[evaluationResult.blockReason] = 0; }
                        localCycleStats.blockReasons[evaluationResult.blockReason]++;
                        localCycleStats.blockedTrades.push({ strategy: strategy.combinationName, reason: evaluationResult.blockReason, details: evaluationResult.blockReason });
                        if (evaluationResult.blockReason.includes('Conviction')) {
                            localCycleStats.totalConvictionFailures++;
                            if (typeof evaluationResult.convictionScoreAtBlock === 'number') {
                                localCycleStats.convictionFailureScores.push(evaluationResult.convictionScoreAtBlock);
                            }
                        }
                    }

                } catch (strategyError) {
                    localCycleStats.strategiesSkipped++;
                    const errorMsg = `Error in evaluateStrategy for ${strategy.combinationName} of ${groupKey}: ${strategyError.message}`;
                    console.error(`[CRITICAL_ERROR] ${errorMsg}`, 'error');
                    console.error(`[CRITICAL_ERROR] Stack: ${strategyError.stack}`, 'error');
                    continue;
                }
            }

            cycleStats.strategiesProcessed = (cycleStats.strategiesProcessed || 0) + localCycleStats.strategiesProcessed;
            cycleStats.strategiesEvaluated = (cycleStats.strategiesEvaluated || 0) + localCycleStats.strategiesEvaluated;
            cycleStats.strategiesSkipped = (cycleStats.strategiesSkipped || 0) + localCycleStats.strategiesSkipped;

            cycleStats.signalsFound = (cycleStats.signalsFound || 0) + localCycleStats.signalsFound;
            cycleStats.totalCombinedStrength = (cycleStats.totalCombinedStrength || 0) + localCycleStats.totalCombinedStrength;
            cycleStats.alertsCreated = (cycleStats.alertsCreated || 0) + localCycleStats.alertsCreated;
            cycleStats.totalConvictionFailures = (cycleStats.totalConvictionFailures || 0) + localCycleStats.totalConvictionFailures;
            if (!cycleStats.convictionFailureScores) cycleStats.convictionFailureScores = [];
            cycleStats.convictionFailureScores.push(...localCycleStats.convictionFailureScores);

            if (!cycleStats.blockedTrades) cycleStats.blockedTrades = [];
            cycleStats.blockedTrades.push(...localCycleStats.blockedTrades);

            if (!cycleStats.skipReasons) cycleStats.skipReasons = {};
            for (const reason in localCycleStats.skipReasons) {
                if (Object.prototype.hasOwnProperty.call(localCycleStats.skipReasons, reason)) {
                    cycleStats.skipReasons[reason] = (cycleStats.skipReasons[reason] || 0) + localCycleStats.skipReasons[reason];
                }
            }

            if (!cycleStats.blockReasons) cycleStats.blockReasons = {};
            for (const reason in localCycleStats.blockReasons) {
                if (Object.prototype.hasOwnProperty.call(localCycleStats.blockReasons, reason)) {
                    cycleStats.blockReasons[reason] = (cycleStats.blockReasons[reason] || 0) + localCycleStats.blockReasons[reason];
                }
            }

            return { success: true, tradeRequests: groupTradeRequests, error: null };

        } catch (groupError) {
            console.error(`[GROUP_ERROR] Failed to process group ${groupKey}: ${groupError.message}`, 'error', { stack: groupError.stack });
            cycleStats.strategiesProcessed = (cycleStats.strategiesProcessed || 0) + localCycleStats.strategiesProcessed;
            cycleStats.strategiesEvaluated = (cycleStats.strategiesEvaluated || 0) + localCycleStats.strategiesEvaluated;
            cycleStats.strategiesSkipped = (cycleStats.strategiesSkipped || 0) + localCycleStats.strategiesSkipped;
            return { success: false, tradeRequests: [], error: groupError.message };
        }
    }


    // Normalize a single ATR value to number or null
    _normalizeToNumber(v) {
        if (typeof v === "number" && isFinite(v)) return v;
        if (typeof v === "string") {
            const n = parseFloat(v);
            return isFinite(n) ? n : null;
        }
        if (v && typeof v === "object") {
            const candidates = ["ATR", "atr", "value", "v"];
            for (const k of candidates) {
                const val = v[k];
                if (typeof val === "number" && isFinite(val)) return val;
                if (typeof val === "string") {
                    const n = parseFloat(val);
                    if (isFinite(n)) return n;
                }
            }
        }
        return null;
    }

    // Map an indicator array to numbers/nulls robustly
    _normalizeIndicatorArray(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map((x) => this._normalizeToNumber(x));
    }

    // Find last valid number in an array (already normalized preferred)
    _findLastValidNumber(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        for (let i = arr.length - 1; i >= 0; i--) {
            const v = arr[i];
            if (typeof v === "number" && isFinite(v)) return v;
        }
        return null;
    }

    /**
     * Aggregates positions that need to be closed into a single batch.
     * This method detects exit conditions but does NOT perform the closing itself.
     * @param {object} walletState - The current state of the virtual wallet.
     * @param {object} settings - Global scanner settings.
     * @param {Map<string, number>} priceCache - A map of current prices keyed by symbol.
     * @returns {{positionsToClose: Array<{position: object, exitPrice: number, exitReason: string}>, monitoringErrors: Array<string>}}> An object containing the list of positions to close and any monitoring errors.
     */
    async _manageOpenPositions(walletState, settings, priceCache) {
        const openPositions = walletState.positions?.filter(pos => pos.status === 'open') || [];
        this.addLog(`[POS_MON] Starting position monitoring for ${openPositions.length} positions.`, 'info');

        const positionsToClose = [];
        const errors = [];

        for (const position of openPositions) {
            this.addLog(`[POS_MON] Checking position ${position.position_id.slice(-8)} (${position.symbol}, ${position.strategy_name})`, 'debug');
            const symbolNoSlash = (position.symbol || '').replace('/', '');
            let currentPrice = priceCache.get(symbolNoSlash);

            // FALLBACK: If price not in cache, try to fetch it on-demand
            if ((typeof currentPrice !== 'number' || isNaN(currentPrice)) && this.scannerService?.priceManagerService) {
                try {
                    const fetchedPrice = await this.scannerService.priceManagerService.getCurrentPrice(position.symbol);
                    if (fetchedPrice && typeof fetchedPrice === 'number' && !isNaN(fetchedPrice) && fetchedPrice > 0) {
                        currentPrice = fetchedPrice;
                        // Update the cache so subsequent positions can use it
                        priceCache.set(symbolNoSlash, fetchedPrice);
                        this.addLog(`[POS_MON] ✅ Fetched on-demand price for ${position.symbol}: $${fetchedPrice.toFixed(6)}`, 'debug');
                    } else {
                        this.addLog(`[POS_MON] ⚠️ Invalid price fetched for ${position.symbol}: ${fetchedPrice}`, 'warning');
                    }
                } catch (fetchError) {
                    this.addLog(`[POS_MON] ⚠️ Failed to fetch on-demand price for ${position.symbol}: ${fetchError.message}`, 'warning');
                }
            }

            if (typeof currentPrice !== 'number' || isNaN(currentPrice)) {
                const errorMsg = `[POS_MON] ⚠️ No current price for ${position.symbol}, skipping management for position ${position.position_id.slice(-8)}.`;
                this.addLog(errorMsg, 'warning');              
                
                errors.push(errorMsg);
                continue;
            }

            // CRITICAL FIX: Convert entry_price and other numeric fields to numbers
            // Database/JSON may store these as strings
            const entryPrice = Number(position.entry_price) || 0;
            const peakPrice = Number(position.peak_price) || entryPrice;
            const troughPrice = Number(position.trough_price) || entryPrice;
            const stopLossPrice = Number(position.stop_loss_price) || 0;
            const takeProfitPrice = Number(position.take_profit_price) || 0;
            const trailingStopPrice = Number(position.trailing_stop_price) || 0;

            this.addLog(`[POS_MON] Position ${position.position_id.slice(-8)} current price: $${currentPrice.toFixed(6)}, entry: $${entryPrice.toFixed(6)}`, 'debug');

            position.peak_price = Math.max(peakPrice, currentPrice);
            position.trough_price = Math.min(troughPrice, currentPrice);

            this.updateTrailingStop(position, currentPrice);

            const exitCondition = this._analyzeCloseConditions(position, currentPrice);

            if (exitCondition.shouldClose) {
                let determinedExitPrice = currentPrice;

                // Ensure exit price is at least the trigger price, not lower due to slippage for SL/trailing, or higher for TP
                if (exitCondition.reason === 'stop_loss' && stopLossPrice > 0) {
                    if (position.direction === 'long') {
                        determinedExitPrice = Math.min(currentPrice, stopLossPrice);
                    } else { // short
                        determinedExitPrice = Math.max(currentPrice, stopLossPrice);
                    }
                } else if (exitCondition.reason === 'take_profit' && takeProfitPrice > 0) {
                    if (position.direction === 'long') {
                        determinedExitPrice = Math.max(currentPrice, takeProfitPrice);
                    } else { // short
                        determinedExitPrice = Math.min(currentPrice, takeProfitPrice);
                    }
                } else if (exitCondition.reason === 'trailing_stop_hit' && trailingStopPrice > 0) {
                    if (position.direction === 'long') {
                        determinedExitPrice = Math.min(currentPrice, trailingStopPrice);
                    } else { // short
                        determinedExitPrice = Math.max(currentPrice, trailingStopPrice);
                    }
                }

                this.addLog(`[POS_MON] Detected close condition for ${position.symbol} (ID: ${position.position_id.slice(-8)}) due to ${exitCondition.reason}. Determined Exit Price: ${determinedExitPrice.toFixed(6)} (Current Market Price: ${currentPrice.toFixed(6)})`, 'position_closing_detection', {
                    strategy: position.strategy_name,
                    positionId: position.position_id.slice(-8),
                    reason: exitCondition.reason,
                    determinedExitPrice: determinedExitPrice,
                    currentMarketPrice: currentPrice,
                });

                positionsToClose.push({
                    position: { ...position },
                    exitPrice: determinedExitPrice,
                    exitReason: exitCondition.reason,
                });
            } else {
                // Remove debug logs unless explicitly enabled for deep inspection
                // this.addLog(`[POS_MON] ✅ Position ${position.position_id.slice(-8)} still active - no exit conditions met.`, 'debug');
            }
        }
        return { positionsToClose, monitoringErrors: errors };
    }


    /**
     * Enhanced scanForSignals with better memory management
     */
    async scanForSignals(activeStrategies, walletState, settings, marketRegime, currentPrices, cycleStats) {
        this.addLog('[SIGNAL_DETECTION] Starting scan...', 'info');
        const scanStartTime = Date.now();
        this.atrLogCounter = 0;
        if (typeof resetIndicatorManagerDebug === "function") {
            resetIndicatorManagerDebug();
        }

        cycleStats.positionsBlocked = cycleStats.positionsBlocked || [];
        cycleStats.skipReasons = cycleStats.skipReasons || {};
        cycleStats.blockReasons = cycleStats.blockReasons || {};
        cycleStats.convictionFailureScores = cycleStats.convictionFailureScores || [];
        cycleStats.totalConvictionFailures = cycleStats.totalConvictionFailures || 0;
        cycleStats.strategiesProcessed = cycleStats.strategiesProcessed || 0;
        cycleStats.strategiesEvaluated = cycleStats.strategiesEvaluated || 0;
        cycleStats.strategiesSkipped = cycleStats.strategiesSkipped || 0;


        const regimeConfidencePercent = (marketRegime?.confidence || 0) * 100;
        const regimeThreshold = settings?.minimumRegimeConfidence || 60;

        if (regimeConfidencePercent < regimeThreshold) {
            const reason = `Market regime confidence (${regimeConfidencePercent.toFixed(1)}%) below threshold (${regimeThreshold}%)`;
            this.scannerService.addLog(
                `🚫 [REGIME_CONFIDENCE_FILTER] ${reason} - Skipping all strategy evaluation for this cycle`,
                'warning'
            );

            cycleStats.skipReasons[reason] = (cycleStats.skipReasons[reason] || 0) + activeStrategies.length;
            cycleStats.strategiesSkipped = (cycleStats.strategiesSkipped || 0) + activeStrategies.length;
            cycleStats.strategiesProcessed = (cycleStats.strategiesProcessed || 0) + activeStrategies.length;

            return {
                signalsFound: 0,
                eligibleSignals: 0, // Added for consistency
                tradesExecuted: 0,
                strategiesEvaluated: 0,
                strategiesProcessed: activeStrategies.length,
                strategiesSkipped: activeStrategies.length,
                skipReasons: { [reason]: activeStrategies.length },
                blockReasons: {},
                blockedTrades: [],
                positionsToClose: [],
                monitoringErrors: [],
                averageSignalStrength: 0,
                alertsCreated: 0,
                totalConvictionFailures: 0,
                newlyOpenedPositions: []
            };
        }

        this.scannerService.addLog(
            `✅ [REGIME_CONFIDENCE_FILTER] Market regime confidence (${regimeConfidencePercent.toFixed(1)}%) meets threshold (${regimeThreshold}%) - Proceeding with strategy evaluation`,
            'success'
        );

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        if (signal.aborted) {
            this.scannerService.addLog('Scan aborted before starting.', 'warning');
            return {
                signalsFound: 0, eligibleSignals: 0, tradesExecuted: 0, blockedTrades: cycleStats.positionsBlocked, blockReasons: cycleStats.blockReasons,
                strategiesEvaluated: 0, strategiesProcessed: 0, strategiesSkipped: 0, skipReasons: cycleStats.skipReasons,
                positionsToClose: [],
                monitoringErrors: [],
                averageSignalStrength: 0,
                alertsCreated: 0,
                totalConvictionFailures: cycleStats.totalConvictionFailures,
                newlyOpenedPositions: []
            };
        }

        this.state.walletState = walletState;
        this.state.scannerSettings = settings;
        this.state.marketRegime = marketRegime;

        const scanStats = {
            signalsFound: 0,
            tradesExecuted: 0,
            strategiesEvaluated: 0,
            strategiesProcessed: 0,
            strategiesSkipped: 0,
            skipReasons: {},
            blockedTrades: [],
            blockReasons: {},
            positionsToClose: [],
            monitoringErrors: [],
            alertsCreated: 0,
            totalCombinedStrength: 0,
            convictionFailureScores: [],
            totalConvictionFailures: 0,
            pendingTradeRequests: []
        };

        this._currentScanSkipReasons = scanStats.skipReasons;

        try {
            const existingAlerts = await queueEntityCall('MarketAlert', 'filter', { type: 'opportunity' });
            scanStats.alertsCreated = existingAlerts?.length || 0;
        } catch (error) {
            this.scannerService.addLog(`[ALERT_COUNT] Failed to check existing alerts: ${error.message}`, 'warning');
        }

        let klineDataCache = new Map();

        try {
            this.addLog(`🔍 Starting optimized scan of ${activeStrategies.length} strategies...`, 'cycle', 0);

            const eligibleStrategies = [];
            const maxPositionsPerStrategy = settings?.maxPositions || 1; // Used in pre-filter for strategy evaluation eligibility

            const allPositions = (walletState?.positions || []);
            const openPositions = allPositions.filter(pos => pos.status === 'open');

            const exchangeInfo = this.scannerService.getExchangeInfo();
            
            if (!exchangeInfo || Object.keys(exchangeInfo).length === 0) {
                this.addLog('🔴 CRITICAL: Exchange information is not available for symbol validation. Proceeding without validation (risky).', 'error');
            } else {
                // Removed redundant log, this is logged earlier
                // this.addLog(`[SYMBOL_VALIDATION] Loaded exchange info for ${Object.keys(exchangeInfo).length} symbols for validation.`, 'info');
            }

            let coinsBlockedCount = 0;
            let regimeBlockedCount = 0;
            let maxPositionsPreEvalBlockedCount = 0; // Renamed to avoid confusion with post-evaluation filter

            for (const strategy of activeStrategies) {
                scanStats.strategiesProcessed++;

                if (!strategy || !strategy.coin) {
                    scanStats.strategiesSkipped++;
                    const reason = 'Strategy missing required properties (coin)';
                    scanStats.skipReasons[reason] = (scanStats.skipReasons[reason] || 0) + 1;
                    continue;
                }

                if (exchangeInfo && Object.keys(exchangeInfo).length > 0) {
                    const formattedCoinSymbol = strategy.coin.replace('/', '').replace(/\s/g, '').toUpperCase();
                    const coinDetails = exchangeInfo[formattedCoinSymbol];

                    // Debug logging for symbol lookup
                    // Commented out to reduce console flooding
                    /*
                    if (!coinDetails) {
                        console.log(`[SignalDetectionEngine] 🔍 Symbol lookup failed:`, {
                            originalCoin: strategy.coin,
                            formattedSymbol: formattedCoinSymbol,
                            exchangeInfoKeys: Object.keys(exchangeInfo).slice(0, 10), // First 10 keys for debugging
                            exchangeInfoCount: Object.keys(exchangeInfo).length
                        });
                    }
                    */

                    if (!coinDetails) {
                        scanStats.strategiesSkipped++;
                        coinsBlockedCount++;
                        const reason = `Coin ${strategy.coin} not found on exchange`;
                        scanStats.skipReasons[reason] = (scanStats.skipReasons[reason] || 0) + 1;
                        scanStats.blockedTrades.push({
                            strategy: strategy.combinationName,
                            reason: `Pre-evaluation: ${reason}`,
                            details: null
                        });
                        continue;
                    }

                    if (coinDetails.status !== 'TRADING') {
                        scanStats.strategiesSkipped++;
                        coinsBlockedCount++;
                        const reason = `Coin ${strategy.coin} not trading (status: ${coinDetails.status})`;
                        scanStats.skipReasons[reason] = (scanStats.skipReasons[reason] || 0) + 1;
                        scanStats.blockedTrades.push({
                            strategy: strategy.combinationName,
                            reason: `Pre-evaluation: ${reason}`,
                            details: null
                        });
                        continue;
                    }
                }

                const strategyRegime = strategy.dominantMarketRegime?.toLowerCase();
                const currentRegime = marketRegime?.regime?.toLowerCase();
                if (strategyRegime && currentRegime && strategyRegime !== 'neutral' && currentRegime !== 'neutral' && strategyRegime !== currentRegime) {
                    scanStats.strategiesSkipped++;
                    regimeBlockedCount++;
                    const reason = `Strategy regime (${strategyRegime}) doesn't match market regime (${currentRegime})`;
                    scanStats.skipReasons[reason] = (scanStats.skipReasons[reason] || 0) + 1;
                    scanStats.blockedTrades.push({
                        strategy: strategy.combinationName,
                        reason: `Pre-evaluation: ${reason}`,
                        details: null
                    });
                    continue;
                }

                // Initial filter: Max positions per strategy (before evaluation)
                const existingPositionsForStrategy = openPositions.filter(pos => pos.status === 'open' && pos.strategy_name === strategy.combinationName);

                if (existingPositionsForStrategy.length >= maxPositionsPerStrategy) {
                    scanStats.strategiesSkipped++;
                    maxPositionsPreEvalBlockedCount++;
                    const reason = `Max positions per strategy reached (${existingPositionsForStrategy.length}/${maxPositionsPerStrategy})`;
                    scanStats.skipReasons[reason] = (scanStats.skipReasons[reason] || 0) + 1;
                    scanStats.blockedTrades.push({
                        strategy: strategy.combinationName,
                        reason: `Pre-evaluation: ${reason}`,
                        details: null
                    });
                    continue;
                }

                eligibleStrategies.push(strategy);
            }

            if (coinsBlockedCount > 0 || regimeBlockedCount > 0 || maxPositionsPreEvalBlockedCount > 0) {
                this.addLog(`[PRE_EVALUATION] Filtered ${activeStrategies.length} → ${eligibleStrategies.length} strategies (${coinsBlockedCount} coin issues, ${regimeBlockedCount} regime mismatches, ${maxPositionsPreEvalBlockedCount} max position limits)`, 'info');
            }

            if (eligibleStrategies.length === 0) {
                this.addLog('[SIGNAL_ENGINE] No eligible strategies after pre-evaluation filtering.', 'warning');
                return {
                    signalsFound: 0, eligibleSignals: 0, tradesExecuted: 0, strategiesEvaluated: 0,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: [], monitoringErrors: [], averageSignalStrength: 0, alertsCreated: 0,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: []
                };
            }

            // Removed redundant log, this is logged earlier
            // this.scannerService.addLog(`[SignalEngine] Processing ${eligibleStrategies.length} eligible strategies for signal detection...`, 'info');

            const enabledSignalSettings = settings?.signal_settings || {};

            const groupedStrategies = groupBy(eligibleStrategies, s => `${s.coin.replace('/', '')}-${s.timeframe}`);

            const klinePromises = [];

            for (const groupKey in groupedStrategies) {
                if (Object.prototype.hasOwnProperty.call(groupedStrategies, groupKey)) {
                    const strategiesInGroup = groupedStrategies[groupKey];
                    const [coin, timeframe] = groupKey.split('-');

                    let groupMaxKlineLimit = 50;
                    const signalSettingsForGroup = {};
                    strategiesInGroup.forEach(s => {
                        (s.signals || []).forEach(signalDef => {
                            const signalTypeLower = signalDef.type.toLowerCase();
                            signalSettingsForGroup[signalTypeLower] = {
                                enabled: true,
                                ...(signalSettingsForGroup[signalTypeLower] || {}),
                                ...(signalDef.parameters || {})
                            };
                        });
                    });
                    groupMaxKlineLimit = calculateMaxRequiredKlineLimit(signalSettingsForGroup);
                    // Ensure minimum of 50 even if calculateMaxRequiredKlineLimit returns less
                    groupMaxKlineLimit = Math.max(50, groupMaxKlineLimit);

                    // NEW: Direct call to bypass API queue for better batching
                    const klinePromise = getKlineData({
                        symbols: [coin],
                        interval: timeframe,
                        limit: groupMaxKlineLimit
                    })
                        .then(response => ({ groupKey, response }))
                        .catch(error => ({ groupKey, error }));
                    klinePromises.push(klinePromise);
                }
            }

            this.scannerService.addLog(`[KLINE_BATCH] Fetching K-line data for ${klinePromises.length} groups in parallel...`, 'info');

            const klineResults = await Promise.allSettled(klinePromises);
            let successfulKlineGroups = 0;
            let failedKlineGroups = 0;

            for (const result of klineResults) {
                if (result.status === 'fulfilled' && !result.value.error) {
                    const { groupKey, response } = result.value;
                    const [coin] = groupKey.split('-');
                    if (response?.data && typeof response.data === 'object' && response.data[coin]) {
                        const symbolData = response.data[coin];
                        if (symbolData.data && Array.isArray(symbolData.data) && symbolData.data.length >= 50) {
                            const transformedKlines = symbolData.data.map(kline => ({
                                timestamp: Array.isArray(kline) ? kline[0] : kline.timestamp || kline.time,
                                open: parseFloat(Array.isArray(kline) ? kline[1] : kline.open),
                                high: parseFloat(Array.isArray(kline) ? kline[2] : kline.high),
                                low: parseFloat(Array.isArray(kline) ? kline[3] : kline.low),
                                close: parseFloat(Array.isArray(kline) ? kline[4] : kline.close),
                                volume: parseFloat(Array.isArray(kline) ? kline[5] : kline.volume)
                            }));
                            klineDataCache.set(groupKey, transformedKlines);
                            successfulKlineGroups++;
                        } else {
                            this.scannerService.addLog(`[KLINE_BATCH] Group ${groupKey}: Insufficient data (${symbolData.data?.length || 0} candles)`, 'warning');
                            failedKlineGroups++;
                        }
                    } else {
                        this.scannerService.addLog(`[KLINE_BATCH] Group ${groupKey}: Invalid data format in response`, 'warning');
                        failedKlineGroups++;
                    }
                } else {
                    const groupKey = (result.status === 'fulfilled' && result.value) ? result.value.groupKey : 'unknown';
                    this.scannerService.addLog(`[KLINE_BATCH] Group ${groupKey}: Failed to fetch K-line data. ${result.status === 'rejected' ? result.reason.message : ''}`, 'error');
                    failedKlineGroups++;
                }
            }

            if (successfulKlineGroups === 0 && klinePromises.length > 0) {
                this.scannerService.addLog(`[KLINE_BATCH] No K-line data could be fetched for any group. Aborting signal detection.`, 'error');
                return {
                    signalsFound: scanStats.signalsFound, eligibleSignals: 0, tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated, strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped + activeStrategies.length,
                    skipReasons: { ...scanStats.skipReasons, 'K-line fetch failed': (scanStats.skipReasons['K-line fetch failed'] || 0) + activeStrategies.length },
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: 0,
                    alertsCreated: 0,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            if (signal.aborted) {
                this.addLog('Scan aborted during kline data fetch.', 'warning');
                apiQueue.clearCache('kline-');
                return {
                    signalsFound: scanStats.signalsFound,
                    eligibleSignals: 0,
                    tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                    alertsCreated: scanStats.alertsCreated,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            if (!this.scannerService.state.isRunning && !signal.aborted) {
                this.addLog('Scan aborted after prefetching data as scanner was stopped.', 'warning');
                return {
                    signalsFound: scanStats.signalsFound,
                    eligibleSignals: 0,
                    tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                    alertsCreated: scanStats.alertsCreated,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            const currentPricesMap = new Map();
            if (currentPrices && typeof currentPrices === 'object') {
                for (const symbolKey in currentPrices) {
                    currentPricesMap.set(symbolKey, currentPrices[symbolKey]);
                }
                this.addLog(`[SIGNAL_ENGINE] Using centralized prices for ${currentPricesMap.size} symbols`, 'info');
            } else {
                this.addLog('[SIGNAL_ENGINE] Current prices not provided or empty. Position monitoring might rely on stale or missing prices.', 'warning');
            }

            if (signal.aborted) {
                this.addLog('Scan aborted during price data setup.', 'warning');
                return {
                    signalsFound: scanStats.signalsFound,
                    eligibleSignals: 0,
                    tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                    alertsCreated: scanStats.alertsCreated,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            // FIX: Calculate indicators for symbols with open positions that aren't being scanned
            // This ensures ATR is available for position monitoring even if no strategies are active for that symbol
            const symbolsWithOpenPositions = new Set();
            openPositions.forEach(pos => {
                if (pos.symbol) {
                    const symbolNoSlash = pos.symbol.replace('/', '');
                    symbolsWithOpenPositions.add(symbolNoSlash);
                }
            });

            const symbolsBeingScanned = new Set();
            for (const groupKey in groupedStrategies) {
                const [coin] = groupKey.split('-');
                symbolsBeingScanned.add(coin);
            }

            const symbolsNeedingIndicators = Array.from(symbolsWithOpenPositions).filter(symbol => !symbolsBeingScanned.has(symbol));
            
            if (symbolsNeedingIndicators.length > 0) {
                this.scannerService.addLog(`[INDICATOR_PRELOAD] Calculating indicators for ${symbolsNeedingIndicators.length} symbols with open positions but no active strategies...`, 'info');
                
                const indicatorPreloadPromises = [];
                
                for (const symbolNoSlash of symbolsNeedingIndicators) {
                    // Find the timeframe from any open position for this symbol
                    const positionForSymbol = openPositions.find(pos => pos.symbol && pos.symbol.replace('/', '') === symbolNoSlash);
                    const timeframe = positionForSymbol?.timeframe || '15m'; // Default to 15m if not found
                    
                    const preloadPromise = getKlineData({
                        symbols: [symbolNoSlash],
                        interval: timeframe,
                        limit: 100 // Enough for ATR calculation
                    })
                    .then(response => {
                        if (response?.success && response?.data?.[symbolNoSlash]?.success && response?.data?.[symbolNoSlash]?.data) {
                            const klineData = response.data[symbolNoSlash].data.map(kline => ({
                                timestamp: Array.isArray(kline) ? kline[0] : kline.timestamp || kline.time,
                                open: parseFloat(Array.isArray(kline) ? kline[1] : kline.open),
                                high: parseFloat(Array.isArray(kline) ? kline[2] : kline.high),
                                low: parseFloat(Array.isArray(kline) ? kline[3] : kline.low),
                                close: parseFloat(Array.isArray(kline) ? kline[4] : kline.close),
                                volume: parseFloat(Array.isArray(kline) ? kline[5] : kline.volume)
                            }));

                            if (klineData.length >= 50) {
                                // Calculate indicators (especially ATR) for this symbol
                                const indicatorSettingsForCalculation = {
                                    atr: { enabled: true, period: 14 },
                                    volume_sma: { enabled: true, period: 20 },
                                    obv: { enabled: true }
                                };

                                const allIndicators = calculateAllIndicators(klineData, indicatorSettingsForCalculation, this.scannerService.addLog.bind(this.scannerService));
                                
                                // Store indicators in scanner service state
                                if (!this.scannerService.state.indicators) {
                                    this.scannerService.state.indicators = {};
                                }
                                this.scannerService.state.indicators[symbolNoSlash] = allIndicators;
                                
                                this.scannerService.addLog(`[INDICATOR_PRELOAD] ✅ Calculated and stored indicators for ${symbolNoSlash} (${timeframe})`, 'info');
                                return { symbol: symbolNoSlash, success: true };
                            }
                        }
                        return { symbol: symbolNoSlash, success: false, error: 'Insufficient kline data' };
                    })
                    .catch(error => {
                        this.scannerService.addLog(`[INDICATOR_PRELOAD] ⚠️ Failed to preload indicators for ${symbolNoSlash}: ${error.message}`, 'warning');
                        return { symbol: symbolNoSlash, success: false, error: error.message };
                    });
                    
                    indicatorPreloadPromises.push(preloadPromise);
                }
                
                const preloadResults = await Promise.allSettled(indicatorPreloadPromises);
                const successful = preloadResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
                const failed = preloadResults.length - successful;
                
                if (successful > 0) {
                    this.scannerService.addLog(`[INDICATOR_PRELOAD] ✅ Successfully preloaded indicators for ${successful} symbol${successful !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`, 'success');
                }
            }

            const { positionsToClose, monitoringErrors } = await this._manageOpenPositions(walletState, settings, currentPricesMap);
            scanStats.positionsToClose.push(...positionsToClose);
            scanStats.monitoringErrors.push(...monitoringErrors);

            this.addLog(`[POS_MON] Position monitoring complete. Found ${positionsToClose.length} positions to close.`, 'info');
            if (positionsToClose.length > 0) {
                // Removed debug log for brevity, relevant info is in 'info' log and can be accessed via `position_closing_detection` log type.
            }

            if (signal.aborted) {
                this.addLog('🛑 Scan cancelled by user during position management', 'warning', 0);
                return {
                    signalsFound: scanStats.signalsFound,
                    eligibleSignals: 0,
                    tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                    alertsCreated: scanStats.alertsCreated,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            const allCandlesDataAvailable = Array.from(klineDataCache.values()).filter(Boolean);
            if (allCandlesDataAvailable.length === 0 && eligibleStrategies.length > 0) {
                this.scannerService.addLog('No kline data available for any eligible strategy, ending scan cycle prematurely.', 'warning');
                return {
                    signalsFound: scanStats.signalsFound,
                    eligibleSignals: 0,
                    tradesExecuted: scanStats.tradesExecuted,
                    strategiesEvaluated: scanStats.strategiesEvaluated,
                    strategiesProcessed: scanStats.strategiesProcessed,
                    strategiesSkipped: scanStats.strategiesSkipped,
                    skipReasons: scanStats.skipReasons,
                    blockReasons: scanStats.blockReasons,
                    blockedTrades: scanStats.blockedTrades,
                    positionsToClose: scanStats.positionsToClose,
                    monitoringErrors: scanStats.monitoringErrors,
                    averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                    alertsCreated: scanStats.alertsCreated,
                    totalConvictionFailures: scanStats.totalConvictionFailures,
                    newlyOpenedPositions: scanStats.pendingTradeRequests
                };
            }

            this.scannerService.addLog(`[SignalEngine] Step 4: Grouping and evaluating ${eligibleStrategies.length} strategies...`, 'info');

            const groupProcessingPromises = [];

            for (const groupKey in groupedStrategies) {
                if (signal.aborted) {
                    this.addLog('Scan aborted during strategy group processing.', 'warning');
                    break;
                }

                const strategiesInGroup = groupedStrategies[groupKey];
                const klinesForGroup = klineDataCache.get(groupKey);

                const promise = this._processStrategyGroup(
                    groupKey,
                    strategiesInGroup,
                    klinesForGroup,
                    currentPricesMap,
                    walletState,
                    settings,
                    marketRegime,
                    scanStats
                );
                groupProcessingPromises.push(promise);
            }

            const allGroupResults = await Promise.allSettled(groupProcessingPromises);

            let successfulGroups = 0;
            let failedGroups = 0;

            for (const result of allGroupResults) {
                if (result.status === 'fulfilled' && result.value && result.value.success) {
                    successfulGroups++;
                    scanStats.pendingTradeRequests.push(...result.value.tradeRequests);
                } else {
                    failedGroups++;
                    const errorMsg = result.status === 'rejected' ? result.reason.message : (result.value?.error || 'Unknown error during group processing');
                    this.scannerService.addLog(`[GROUP_PROCESS_ERROR] A strategy group failed processing. Error: ${errorMsg}`, 'error');
                }
            }

            this.scannerService.addLog(`[GROUP_PROCESS] Group processing complete: ${successfulGroups} successful, ${failedGroups} failed`, 'info');
            this.scannerService.addLog(`[BATCH_POSITIONS] Collected ${scanStats.pendingTradeRequests.length} pending trade requests from all groups`, 'success');

            // Pre-filter signals based on max positions BEFORE sending to PositionManager
            const maxPositionsPerStrategyForExecution = settings?.maxPositions || 10;
            const filteredSignals = [];
            const blockedByMaxPositionsPostEval = [];

            const currentOpenAndTrailingPositions = this.scannerService.positionManager.positions.filter(
                pos => pos.status === 'open' || pos.status === 'trailing'
            );

            // Group existing positions by strategy name for quick lookup
            const existingPositionsCountMap = new Map();
            currentOpenAndTrailingPositions.forEach(pos => {
                const count = existingPositionsCountMap.get(pos.strategy_name) || 0;
                existingPositionsCountMap.set(pos.strategy_name, count + 1);
            });

            for (const signal of scanStats.pendingTradeRequests) {
                const existingPositionsForStrategy = existingPositionsCountMap.get(signal.strategy_name) || 0;
                
                if (existingPositionsForStrategy >= maxPositionsPerStrategyForExecution) {
                    blockedByMaxPositionsPostEval.push({
                        signal: signal,
                        strategy: signal.strategy_name,
                        existing: existingPositionsForStrategy,
                        max: maxPositionsPerStrategyForExecution,
                        reason: 'Strategy position limit reached'
                    });
                } else {
                    filteredSignals.push(signal);
                }
            }

            // Log blocked signals summary (only if there are any)
            if (blockedByMaxPositionsPostEval.length > 0) {
                this.addLog(`[PRE_FILTER_EXEC] 🚫 Blocked ${blockedByMaxPositionsPostEval.length} signals due to max positions reached per strategy.`, 'warning');
                // Log details only for first few to avoid spam
                blockedByMaxPositionsPostEval.slice(0, 5).forEach(blocked => {
                    this.addLog(`[PRE_FILTER_EXEC] Strategy "${blocked.strategy}" (Coin: ${blocked.signal?.symbol}): ${blocked.existing} existing positions, max allowed: ${blocked.max}.`, 'warning');
                });
                if (blockedByMaxPositionsPostEval.length > 5) {
                    this.addLog(`[PRE_FILTER_EXEC] ... and ${blockedByMaxPositionsPostEval.length - 5} more signals were blocked.`, 'warning');
                }
                // Update scanStats with these newly blocked trades
                for (const blocked of blockedByMaxPositionsPostEval) {
                    const reason = `Post-evaluation: Max positions per strategy reached (${blocked.existing}/${blocked.max})`;
                    scanStats.blockedTrades.push({ strategy: blocked.strategy, reason: reason, details: blocked });
                    scanStats.blockReasons[reason] = (scanStats.blockReasons[reason] || 0) + 1;
                }
            }

            let actualExecutedPositions = [];

            if (filteredSignals.length > 0) { // Changed from scanStats.pendingTradeRequests to filteredSignals
                this.addLog(`✅ Calling positionManager.openPositionsBatch with ${filteredSignals.length} eligible signals`, 'info'); // Log updated
                
                // DEBUG: Log the filtered signals structure
                
                try {
                    const batchResult = await this.scannerService.positionManager.openPositionsBatch(filteredSignals); // Use filteredSignals

                    const executedCount = batchResult?.opened || 0;
                    actualExecutedPositions = batchResult?.openedPositions || [];

                    if (cycleStats) {
                        cycleStats.positionsOpened = (cycleStats.positionsOpened || 0) + executedCount;
                    }

                    if (actualExecutedPositions.length > 0) {
                        this.scannerService.addLog(`[ATOMIC_EXECUTION] ✅ Successfully executed ${actualExecutedPositions.length} trade${actualExecutedPositions.length === 1 ? '' : 's'} on exchange.`, 'success');
                        this.scannerService.addLog(`[ATOMIC_UPDATE] Adding ${actualExecutedPositions.length} new positions to wallet state...`, 'info');

                        const currentWalletState = this.scannerService.walletManagerService?.getCurrentWalletState();

                        if (!currentWalletState || !Array.isArray(currentWalletState.positions)) {
                            this.scannerService.addLog(`[ATOMIC_UPDATE] ❌ Cannot update wallet: No active wallet state or positions array found`, 'error');
                        } else {
                            this.scannerService.addLog(`[ATOMIC_UPDATE] Current wallet state: ID=${currentWalletState.id}, existing positions=${currentWalletState.positions.length}`, 'info');

                            currentWalletState.positions.push(...actualExecutedPositions);

                            try {
                                await this.scannerService.positionManager.persistWalletChangesAndWait();

                                // CRITICAL FIX: Delay before dispatching event to ensure position is fully committed and queryable
                                // This prevents race conditions where syncWithBinance queries before position is visible
                                await new Promise(resolve => setTimeout(resolve, 200));
                                
                                // Dispatch event to refresh wallet page positions AFTER wallet state is persisted
                                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && actualExecutedPositions.length > 0) {
                                    const event = new CustomEvent('positionDataRefresh', { 
                                        detail: { positionsOpened: actualExecutedPositions.length, source: 'scan_cycle' } 
                                    });
                                    window.dispatchEvent(event);
                                    // console.log(`[SignalDetectionEngine] ✅ Dispatched positionDataRefresh event (${actualExecutedPositions.length} positions)`);
                                }

                                scanStats.tradesExecuted += actualExecutedPositions.length;

                                for (const position of actualExecutedPositions) {
                                    try {
                                        const recentAlerts = await queueEntityCall('MarketAlert', 'filter',
                                            { type: 'opportunity', pairs_affected: { '$in': [position.symbol.replace('USDT', '/USDT')] }, action_taken: false },
                                            '-date_created', 1
                                        );
                                        if (recentAlerts && recentAlerts.length > 0) {
                                            const alertToUpdate = recentAlerts[0];
                                            await queueEntityCall('MarketAlert', 'update', alertToUpdate.id, { action_taken: true });
                                        }
                                    } catch (alertError) {
                                        this.addLog(`[ALERT_UPDATE_ERROR] Failed to update alert: ${alertError?.message || 'Unknown error'}`, 'warning', { level: 2 });
                                    }
                                }

                            } catch (persistError) {
                                this.scannerService.addLog(`[ATOMIC_UPDATE] ❌ Failed to persist wallet changes: ${persistError?.message || 'Unknown error'}`, 'error');

                                for (let i = 0; i < actualExecutedPositions.length; i++) {
                                    currentWalletState.positions.pop();
                                }

                                this.scannerService.addLog(`[ATOMIC_UPDATE] Rolled back in-memory changes due to persistence failure`, 'warning');

                                scanStats.tradesExecuted -= actualExecutedPositions.length;
                            }

                        }
                    } else {
                        this.scannerService.addLog('[ATOMIC_EXECUTION] No trades were successfully executed in batch.', 'info');
                    }
                } catch (batchExecError) {
                    this.scannerService.addLog(`[ATOMIC_EXECUTION] ❌ Failed to execute trades in batch: ${batchExecError.message}`, 'error');
                    console.error(`[ATOMIC_EXECUTION] Stack: ${batchExecError.stack}`, 'error');
                }

            } else {
                this.addLog(`ℹ️ No eligible signals to process after pre-filtering`, 'info'); // Updated log
            }


            // Signal quality summary removed - too verbose

            const finalResults = {
                signalsFound: scanStats.signalsFound,
                eligibleSignals: filteredSignals.length, // Added eligibleSignals
                tradesExecuted: scanStats.tradesExecuted,
                strategiesEvaluated: scanStats.strategiesEvaluated,
                strategiesProcessed: scanStats.strategiesProcessed,
                strategiesSkipped: scanStats.strategiesSkipped,
                skipReasons: scanStats.skipReasons,
                blockReasons: scanStats.blockReasons,
                blockedTrades: scanStats.blockedTrades,
                positionsToClose: scanStats.positionsToClose,
                monitoringErrors: scanStats.monitoringErrors,
                averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                alertsCreated: scanStats.alertsCreated,
                totalConvictionFailures: scanStats.totalConvictionFailures,
                newlyOpenedPositions: actualExecutedPositions || []
            };

            this.scannerService.addLog(`[SCAN_COMPLETE] Final results: ${finalResults.signalsFound} signals found, ${finalResults.tradesExecuted} trades executed, ${scanStats.positionsToClose.length} positions detected for closure.`, 'success');

            return finalResults;

        } catch (error) {
            if (signal.aborted && error.message === 'Scan aborted') {
                this.scannerService.addLog('Scan cycle explicitly aborted.', 'warning');
            } else {
                this.scannerService.addLog(`[SignalEngine] UNEXPECTED ERROR in scan cycle: ${error.message}`, 'error', { level: 0, stack: error.stack });
                scanStats.monitoringErrors.push(`Critical scan cycle error: ${error.message}`);
            }
            return {
                signalsFound: scanStats.signalsFound,
                eligibleSignals: 0, // In case of error, assume 0 eligible
                tradesExecuted: scanStats.tradesExecuted,
                strategiesEvaluated: scanStats.strategiesEvaluated,
                strategiesProcessed: scanStats.strategiesProcessed,
                strategiesSkipped: scanStats.strategiesSkipped,
                skipReasons: scanStats.skipReasons,
                blockReasons: scanStats.blockReasons,
                blockedTrades: scanStats.blockedTrades,
                positionsToClose: scanStats.positionsToClose,
                monitoringErrors: scanStats.monitoringErrors,
                averageSignalStrength: scanStats.signalsFound > 0 ? scanStats.totalCombinedStrength / scanStats.signalsFound : 0,
                alertsCreated: scanStats.alertsCreated,
                totalConvictionFailures: scanStats.totalConvictionFailures,
                newlyOpenedPositions: []
            };
        } finally {
            apiQueue.clearCache('kline-');
            apiQueue.clearCache('prices-');
            apiQueue.aggressiveCacheCleanup();
            this._currentScanSkipReasons = null;

            Object.assign(cycleStats.skipReasons, scanStats.skipReasons);
            Object.assign(cycleStats.blockReasons, scanStats.blockReasons);
            cycleStats.positionsBlocked.push(...scanStats.blockedTrades);
            cycleStats.convictionFailureScores = (cycleStats.convictionFailureScores || []).concat(scanStats.convictionFailureScores);
            cycleStats.totalConvictionFailures = (cycleStats.totalConvictionFailures || 0) + scanStats.totalConvictionFailures;
            cycleStats.signalsFound = scanStats.signalsFound;
            cycleStats.tradesExecuted = scanStats.tradesExecuted;
            cycleStats.strategiesEvaluated = scanStats.strategiesEvaluated;
            cycleStats.strategiesProcessed = scanStats.strategiesProcessed;
            cycleStats.strategiesSkipped = scanStats.strategiesSkipped;
            cycleStats.alertsCreated = scanStats.alertsCreated;
            cycleStats.totalCombinedStrength = scanStats.totalCombinedStrength;


            this.addLog(`✅ Scan cycle complete: ${cycleStats.signalsFound} signals found, ${cycleStats.tradesExecuted} trades executed, ${scanStats.positionsToClose.length} positions detected for closure.`, 'cycle-end', 0);
            this.addLog(`📊 Strategy evaluation summary: ${cycleStats.strategiesProcessed} strategies processed (${cycleStats.strategiesEvaluated} evaluated, ${cycleStats.strategiesSkipped} skipped).`, 'info', 0);
            if (Object.keys(cycleStats.skipReasons).length > 0) {
                this.addLog(`  Reasons for skipping (no signal/pre-eval):`, 'info', 0);
                Object.entries(cycleStats.skipReasons).forEach(([reason, count]) => {
                    this.addLog(`    - ${reason}: ${count} strategies`, 'info', 0);
                });
            }
            if (Object.keys(cycleStats.blockReasons).length > 0) {
                this.addLog(`    Reasons for blocking (signal found but trade prevented):`, 'info', 0);
                Object.entries(cycleStats.blockReasons).forEach(([reason, count]) => {
                    this.addLog(`    - ${reason}: ${count} strategies`, 'info', 0);
                });
            }

            if (cycleStats.totalConvictionFailures > 0) {
                const minConvictionScore = settings?.minimumConvictionScore || 50;
                const avgFailedScore = cycleStats.convictionFailureScores.length > 0
                    ? cycleStats.convictionFailureScores.reduce((sum, score) => sum + score, 0) / cycleStats.convictionFailureScores.length
                    : 0; // Handle empty array
                const scoreRange = cycleStats.convictionFailureScores.length > 1
                    ? `${Math.min(...cycleStats.convictionFailureScores).toFixed(1)}-${Math.max(...cycleStats.convictionFailureScores).toFixed(1)}`
                    : (cycleStats.convictionFailureScores.length === 1 ? cycleStats.convictionFailureScores[0].toFixed(1) : 'N/A');

                this.addLog(
                    `🚫 [CONVICTION_FAIL_SUMMARY] ${cycleStats.totalConvictionFailures} strategies blocked by conviction. Scores: ${scoreRange} (avg: ${avgFailedScore.toFixed(1)}) below threshold (${minConvictionScore})`,
                    'warning'
                );
            }
        }
    }

    /**
     * Determines if a strategy is event-driven based on its name
     * @param {string} strategyName - The name of the strategy
     * @returns {boolean} True if the strategy is event-driven, false otherwise
     */
    isEventDrivenStrategy(strategyName) {
        if (!strategyName || typeof strategyName !== 'string') {
            return false;
        }

        const eventDrivenKeywords = [
            'news', 'event', 'announcement', 'earnings', 'fomc', 'fed', 'cpi', 'ppi',
            'nfp', 'gdp', 'inflation', 'rate', 'cut', 'hike', 'policy', 'central',
            'bank', 'meeting', 'speech', 'conference', 'summit', 'election', 'vote',
            'referendum', 'brexit', 'trade', 'tariff', 'sanction', 'regulation',
            'compliance', 'audit', 'merger', 'acquisition', 'ipo', 'listing',
            'partnership', 'collaboration', 'launch', 'release', 'upgrade', 'update'
        ];

        const lowerStrategyName = strategyName.toLowerCase();
        return eventDrivenKeywords.some(keyword => lowerStrategyName.includes(keyword));
    }
}

export default SignalDetectionEngine;