
import { queueEntityCall, apiQueue, queueFunctionCall, refreshMarketAlertCache, getMarketAlertCache, flushMarketAlertBuffer } from '@/components/utils/apiQueue';
import MarketRegimeDetector from '@/components/utils/MarketRegimeDetector';
import { getKlineData } from '@/api/functions';
import { SignalDetectionEngine } from './SignalDetectionEngine';
import { calculateAllIndicators }
    from '@/components/utils/indicatorManager';
import { Trade } from '@/api/entities';
import { purgeDemoData } from '@/api/functions';
import { getBinancePrices } from '@/api/functions';
import { getFearAndGreedIndex } from '@/api/functions';
import { archiveOldTrades } from '@/api/functions';
import { positionSizeValidator } from '../utils/positionSizeValidator';
import { PositionManager } from './PositionManager';
import { scannerSessionManager } from '@/api/functions';
import { liveTradingAPI } from '@/api/functions';
import { initializeWalletManagerService } from './WalletManagerService';
import HeartbeatService from "./HeartbeatService";
import SessionManagerService from "./SessionManagerService";
import TradeArchivingService from "./TradeArchivingService";
import { formatPrice, formatUSDT } from '@/components/utils/priceFormatter';
import { generateTradeId } from "@/components/utils/id";
// Assuming updatePerformanceSnapshot is a new function similar to others in '@/api/functions'
import { updatePerformanceSnapshot } from '@/api/functions';

const STORAGE_KEY = 'cryptoSentinelScannerState';

// === Leading Performance Momentum Weights ===
// UPDATED allocation per user request:
// - Unrealized P&L: 40%
// - Realized P&L:   10%
// - Market Regime:  15%
// - Volatility:     10%
// - Opportunity:    15%
// - Fear & Greed:   10%
// - Signal Quality:  0%
const MOMENTUM_WEIGHTS = {
    unrealizedPnl: 0.40,
    realizedPnl: 0.10,
    regime: 0.15,
    volatility: 0.10,
    opportunityRate: 0.15,
    fearGreed: 0.10,
    signalQuality: 0.00,
};

// Keep a handy percent map for UI breakdowns if/when we expose it.
const MOMENTUM_WEIGHTS_PERCENTS = Object.fromEntries(
    Object.entries(MOMENTUM_WEIGHTS).map(([k, v]) => [k, Math.round(v * 100)])
);

/**
 * Manages the calculation and tracking of various performance metrics for the scanner,
 * including performance momentum score and Fear & Greed Index.
 * This class is designed to be instantiated by AutoScannerService and interact with its state.
 */
class PerformanceMetricsService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // For notifying main scanner state changes
        this.getState = scannerService.getState.bind(scannerService); // Access main scanner state

        // Internal state for this service
        this.lastMomentumCalculation = 0;
        this.momentumCalculationInterval = 30000; // 30 seconds

        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedFetchInterval = 5 * 60 * 1000; // 5 minutes
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;

        this.recentTradesForMomentum = [];
        this.maxMomentumTrades = 100;
    }

    /**
     * Loads initial trades from the database for performance momentum calculation.
     * Updates scannerService.state.recentTradesForMomentum for UI display.
     */
    async loadInitialMomentumTrades() {
        try {
            // Use queueEntityCall with 'Trade' entity name string
            const initialTrades = await queueEntityCall('Trade', 'filter', {}, '-exit_timestamp', this.maxMomentumTrades);
            this.recentTradesForMomentum = initialTrades || [];
            // Update the main scanner's state with the loaded trades for reactivity
            this.scannerService.state.recentTradesForMomentum = [...this.recentTradesForMomentum];
            this.addLog(`[Performance Momentum] ✅ Loaded ${this.recentTradesForMomentum.length} initial trades.`, 'success');
        } catch (e) {
            console.error(`[Performance Momentum] ⚠️ Could not load initial trades: ${e.message}`, 'warning');
            this.addLog(`[Performance Momentum] ⚠️ Could not load initial trades: ${e.message}`, 'warning');
        }
    }

    /**
     * Fetches the Fear & Greed Index from an external API, with caching and error handling.
     * Updates internal fearAndGreedData property.
     */
    async fetchFearAndGreedIndex() {
        const now = Date.now();
        if (now - this.lastFearAndGreedFetch < this.fearAndGreedFetchInterval) {
            return;
        }
        this.lastFearAndGreedFetch = now;

        try {
            const response = await queueFunctionCall(getFearAndGreedIndex, {}, 'low', 'fearAndGreedIndex', 300000, 30000);
            if (response.data && response.data.data && response.data.data.length > 0) {
                this.fearAndGreedData = response.data.data[0];
                if (this.fearAndGreedFailureCount > 0) {
                    this.addLog('[F&G Index] ✅ Successfully reconnected to Fear & Greed API', 'success');
                    this.fearAndGreedFailureCount = 0;
                }
            }
        } catch (error) {
            this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;

            if (this.fearAndGreedFailureCount === 1) {
                this.addLog('[F&G Index] ⚠️ Unable to fetch Fear & Greed Index - continuing without it', 'warning');
                console.log('[F&G Index] ⚠️ Unable to fetch Fear & Greed Index - continuing without it', 'warning');
            } else if (this.fearAndGreedFailureCount === 5) {
                this.addLog('[F&G Index] ⚠️ Multiple F&G fetch failures - will retry silently', 'warning');
                console.log('[F&G Index] ⚠️ Multiple F&G fetch failures - will retry silently', 'warning');
            }

            this.fearAndGreedData = { value: '50', value_classification: 'Neutral (Fallback)' };
        }
    }

    /**
     * Calculates the overall performance momentum score and its breakdown based on various factors.
     * This score influences scanning behavior and is displayed in the UI.
     * Updates scannerService.state.performanceMomentumScore and scannerService.state.momentumBreakdown.
     */
    async calculatePerformanceMomentum() {
        const now = Date.now();

        if (now - this.lastMomentumCalculation < this.momentumCalculationInterval) {
            return;
        }
        this.lastMomentumCalculation = now;

        await this.fetchFearAndGreedIndex();

        const state = this.getState();

        try {
            // Use the new MOMENTUM_WEIGHTS constant
            const unrealizedWeight = MOMENTUM_WEIGHTS.unrealizedPnl;
            const realizedWeight = MOMENTUM_WEIGHTS.realizedPnl;
            const regimeWeight = MOMENTUM_WEIGHTS.regime;
            const volatilityWeight = MOMENTUM_WEIGHTS.volatility;
            const opportunityRateWeight = MOMENTUM_WEIGHTS.opportunityRate;
            const fearAndGreedWeight = MOMENTUM_WEIGHTS.fearGreed;
            const signalQualityWeight = MOMENTUM_WEIGHTS.signalQuality;

            // 1. Unrealized P&L Component
            let unrealizedComponent = 50;
            const activeWalletState = state.liveWalletState;
            const openPositions = activeWalletState?.positions || [];
            if (openPositions.length > 0) {
                let totalUnrealizedPnlUSDT = 0;
                let totalInvestedCapital = 0;
                let positionsWithPrice = 0;

                for (const pos of openPositions) {
                    const symbolNoSlash = pos.symbol.replace('/', '');
                    const currentPrice = state.currentPrices?.[symbolNoSlash];
                    if (currentPrice && typeof currentPrice === 'number' && currentPrice > 0) {
                        const unrealizedPnlUSDT = pos.direction === 'long'
                            ? (currentPrice - pos.entry_price) * pos.quantity_crypto
                            : (pos.entry_price - currentPrice) * pos.quantity_crypto;

                        totalUnrealizedPnlUSDT += unrealizedPnlUSDT;
                        totalInvestedCapital += pos.entry_value_usdt;
                        positionsWithPrice++;
                    }
                }

                if (positionsWithPrice > 0 && totalInvestedCapital > 0) {
                    const portfolioPnlPercent = (totalUnrealizedPnlUSDT / totalInvestedCapital) * 100;
                    unrealizedComponent = Math.max(0, Math.min(100, 50 + (portfolioPnlPercent * 10.0)));
                }
            }

            // 2. Realized P&L Component
            const recentTrades = this.recentTradesForMomentum;
            let realizedComponent = 50;
            if (recentTrades.length >= 5) {
                const pnlValues = recentTrades.map(t => t.pnl_percentage || 0);
                const avgPnl = pnlValues.reduce((s, a) => s + a, 0) / pnlValues.length;
                const winningTradesCount = pnlValues.filter(p => p > 0).length;
                const winRate = (winningTradesCount / pnlValues.length) * 100;

                const pnlScore = 50 + (avgPnl * 8.0);
                const winRateBonus = (winRate - 50) * 0.3;
                realizedComponent = Math.max(0, Math.min(100, pnlScore + winRateBonus));
            }

            // 3. Market Regime Component - REFINED LOGIC
            const marketRegime = state.marketRegime?.regime;
            const regimeConfidence = (state.marketRegime?.confidence || 0) * 100;
            const isConfirmed = state.marketRegime?.isConfirmed || false;

            let baseScore = 50;

            if (marketRegime && regimeConfidence > 0) {
                const regimeLower = marketRegime.toLowerCase();

                const isHighConfidence = regimeConfidence >= 70;

                if (regimeLower === 'uptrend' || regimeLower === 'downtrend') {
                    if (isHighConfidence && isConfirmed) {
                        baseScore = 75;
                    } else if (regimeConfidence >= 60) {
                        baseScore = 65;
                    } else if (regimeConfidence >= 50) {
                        baseScore = 55;
                    } else {
                        baseScore = 50;
                    }
                } else if (regimeLower === 'ranging') {
                    if (isHighConfidence && isConfirmed) {
                        baseScore = 50;
                    } else if (regimeConfidence >= 50) {
                        baseScore = 45;
                    } else {
                        baseScore = 40;
                    }
                } else {
                    baseScore = 50;
                }
            }

            const regimeComponent = 50 + ((baseScore - 50) * (regimeConfidence / 100));

            // 4. Market Volatility Component
            const { adx = 25, bbw = 0.1 } = state.marketVolatility;
            let volatilityComponent = 50;
            if (adx !== undefined && bbw !== undefined) {
                let adxScore;
                if (adx < 20) adxScore = (adx / 20) * 50;
                else if (adx >= 20 && adx <= 40) adxScore = 50 + ((adx - 20) / 20) * 50;
                else adxScore = 100 - ((adx - 40) / 60) * 50;
                adxScore = Math.max(0, Math.min(100, adxScore));

                let bbwScore = Math.min(100, (bbw / 0.05) * 50);
                bbwScore = Math.max(0, Math.min(100, bbwScore));

                volatilityComponent = (adxScore * 0.4) + (bbwScore * 0.6);
            }

            // 5. Opportunity Rate Component
            let opportunityRateComponent = 50;
            const history = state.signalGenerationHistory;
            if (history.length > 5) {
                const recentSlice = history.slice(-5);
                const totalRecentSignals = recentSlice.reduce((sum, s) => sum + (s.signalsFound || 0), 0);
                const avgRecentSignals = totalRecentSignals / recentSlice.length;

                opportunityRateComponent = Math.min(100, avgRecentSignals * 5);
            } else if (history.length > 0) {
                opportunityRateComponent = Math.min(100, history[history.length - 1].signalsFound * 5);
            }

            // 6. Fear & Greed Component
            let fearAndGreedComponent = 50;
            if (this.fearAndGreedData?.value) {
                const fngValue = parseInt(this.fearAndGreedData.value);
                fearAndGreedComponent = 100 - fngValue;
            }

            // 7. Signal Quality Component
            const avgStrength = state.stats?.averageSignalStrength || 0;
            let signalQualityComponent = avgStrength > 0 ? Math.min(100, (avgStrength / 3.5)) : 50;

            // Calculate Final Score
            const finalScore = (unrealizedComponent * unrealizedWeight) +
                (realizedComponent * realizedWeight) +
                (regimeComponent * regimeWeight) +
                (volatilityComponent * volatilityWeight) +
                (opportunityRateComponent * opportunityRateWeight) +
                (fearAndGreedComponent * fearAndGreedWeight) +
                (signalQualityComponent * signalQualityWeight);

            const clampedScore = Math.round(Math.max(0, Math.min(100, finalScore)));

            // NEW: Calculate Adjusted Balance Risk Factor based on momentum score
            const maxBalancePercentRisk = state.settings?.maxBalancePercentRisk || 100;
            let adjustedBalanceRiskFactor;

            if (clampedScore >= 80) {
                // Excellent momentum: use full configured max risk
                adjustedBalanceRiskFactor = maxBalancePercentRisk;
            } else if (clampedScore >= 50) {
                // Good to moderate momentum: scale from 50% to 100% of max risk
                const scoreRange = 80 - 50;
                const scorePosition = clampedScore - 50;
                const scaleFactor = 0.5 + (0.5 * (scorePosition / scoreRange));
                adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
            } else if (clampedScore >= 30) {
                // Poor momentum: scale from 10% to 50% of max risk
                const scoreRange = 50 - 30;
                const scorePosition = clampedScore - 30;
                const scaleFactor = 0.1 + (0.4 * (scorePosition / scoreRange));
                adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
            } else {
                // Very poor momentum: minimum 10% of max risk (or absolute minimum of 5%)
                adjustedBalanceRiskFactor = Math.max(5, maxBalancePercentRisk * 0.1);
            }

            // Ensure we never go below 5% or above configured max
            adjustedBalanceRiskFactor = Math.max(5, Math.min(maxBalancePercentRisk, Math.round(adjustedBalanceRiskFactor)));

            const breakdown = {
                unrealized: { score: Math.round(unrealizedComponent), weight: MOMENTUM_WEIGHTS.unrealizedPnl },
                realized: { score: Math.round(realizedComponent), weight: MOMENTUM_WEIGHTS.realizedPnl },
                regime: {
                    score: Math.round(regimeComponent),
                    weight: MOMENTUM_WEIGHTS.regime,
                    details: `${marketRegime || 'N/A'} (${regimeConfidence.toFixed(0)}%)${isConfirmed ? ' ✓' : ''}`
                },
                volatility: { score: Math.round(volatilityComponent), weight: MOMENTUM_WEIGHTS.volatility, details: `ADX: ${state.marketVolatility.adx.toFixed(1)}, BBW: ${state.marketVolatility.bbw.toFixed(3)}` },
                opportunityRate: { score: Math.round(opportunityRateComponent), weight: MOMENTUM_WEIGHTS.opportunityRate, details: `${history.slice(-1)[0]?.signalsFound || 0} recent signals` },
                fearAndGreed: { score: Math.round(fearAndGreedComponent), weight: MOMENTUM_WEIGHTS.fearGreed, details: `${this.fearAndGreedData?.value || 'N/A'} (${this.fearAndGreedData?.value_classification || 'N/A'})` },
                signalQuality: { score: Math.round(signalQualityComponent), weight: MOMENTUM_WEIGHTS.signalQuality, details: `${avgStrength.toFixed(0)} avg strength` },
                finalScore: clampedScore,
                adjustedBalanceRiskFactor: adjustedBalanceRiskFactor, // NEW: Include in breakdown for UI visibility
                maxBalancePercentRisk: maxBalancePercentRisk // NEW: Show configured max for context
            };

            this.scannerService.state.momentumBreakdown = breakdown;
            this.scannerService.state.performanceMomentumScore = clampedScore;
            this.scannerService.state.adjustedBalanceRiskFactor = adjustedBalanceRiskFactor; // NEW: Update scanner state

            // Add this non-breaking guard right after you create/update momentumBreakdown:
            if (this.scannerService.state && this.scannerService.state.momentumBreakdown && !this.scannerService.state.momentumBreakdown.weightsPercents) {
                this.scannerService.state.momentumBreakdown.weightsPercents = MOMENTUM_WEIGHTS_PERCENTS;
            }

            this.addLog(`[PERFORMANCE_MOMENTUM] Leading momentum updated: ${clampedScore} | Adjusted Balance Risk: ${adjustedBalanceRiskFactor.toFixed(0)}% (max: ${maxBalancePercentRisk}%)`, 'success');
            this.notifySubscribers();

        } catch (error) {
            this.addLog(`[PERFORMANCE_MOMENTUM] Error calculating leading momentum: ${error.message}`, 'error', error);
            this.scannerService.state.performanceMomentumScore = null;
            this.scannerService.state.momentumBreakdown = null;
            this.scannerService.state.adjustedBalanceRiskFactor = 100; // Default to full risk on error
        }
    }

    /**
     * Adds a recent trade to the history for performance momentum calculation.
     * @param {object} trade - The trade object to add.
     */
    addRecentTrade(trade) {
        this.recentTradesForMomentum.unshift(trade);
        if (this.recentTradesForMomentum.length > this.maxMomentumTrades) {
            this.recentTradesForMomentum = this.recentTradesForMomentum.slice(0, this.maxMomentumTrades);
        }
        // Update the main scanner's state with the updated trades list for reactivity
        this.scannerService.state.recentTradesForMomentum = [...this.recentTradesForMomentum];
        this.notifySubscribers(); // Notify UI of state change
    }

    /**
     * Resets the internal state of the performance metrics service.
     */
    resetState() {
        this.lastMomentumCalculation = 0;
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;
        this.recentTradesForMomentum = [];
        this.scannerService.state.recentTradesForMomentum = []; // Clear main scanner state as well
        this.scannerService.state.performanceMomentumScore = null;
        this.scannerService.state.momentumBreakdown = null;
        this.scannerService.state.adjustedBalanceRiskFactor = 100; // Reset adjusted risk factor
        this.addLog('[PerformanceMetricsService] State reset.', 'system');
    }
}


/**
 * Manages the loading, updating, and persistence of scanner configuration settings.
 */
class ConfigurationService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService);
        this.toast = scannerService.toast;
    }

    /**
     * Loads the scanner configuration settings from the database and updates the AutoScannerService's state.
     */
    async loadConfiguration() {
        this.addLog('[ConfigurationService] Loading scanner configuration...', 'info');
        const settingsList = await queueEntityCall('ScanSettings', 'list');
        const loadedSettings = settingsList[0] || { id: 'default', scanFrequency: 60000, minimumCombinedStrength: 225, minimumRegimeConfidence: 50, minimumTradeValue: 10, maxPositions: 1, local_proxy_url: '' };

        // Ensure local_proxy_url is initialized, even if empty
        if (!loadedSettings.local_proxy_url) {
            loadedSettings.local_proxy_url = '';
        }
        // Ensure ID is present for upsert operations
        if (!loadedSettings.id) {
            loadedSettings.id = 'default';
        }

        // Ensure maxBalancePercentRisk is initialized
        if (typeof loadedSettings.maxBalancePercentRisk !== 'number' || loadedSettings.maxBalancePercentRisk <= 0) {
            loadedSettings.maxBalancePercentRisk = 100; // Default to 100%
        }
        // NEW: Ensure absolute invest cap default
        if (typeof loadedSettings.maxBalanceInvestCapUSDT !== 'number' || loadedSettings.maxBalanceInvestCapUSDT < 0) {
            loadedSettings.maxBalanceInvestCapUSDT = 0; // 0 means no absolute cap by default
        }
        // NEW: Ensure blockTradingInDowntrend is initialized
        if (typeof loadedSettings.blockTradingInDowntrend !== 'boolean') {
            loadedSettings.blockTradingInDowntrend = false; // Default to false
        }


        // Directly update the AutoScannerService's state
        this.scannerService.state.settings = loadedSettings;
        this.addLog('[ConfigurationService] Configuration loaded.', 'info');
    }

    /**
     * Updates the scanner settings, persists them to the database, and triggers related actions
     * like strategy re-filtering if critical settings like minimumCombinedStrength are changed.
     * @param {object} newSettings - An object containing the new settings to apply.
     */
    async updateSettings(newSettings) {
        this.addLog('[ConfigurationService] Updating scanner settings...', 'system', newSettings);
        try {
            const oldSettings = { ...this.scannerService.state.settings }; // Clone for comparison

            // Update local state first
            this.scannerService.state.settings = { ...this.scannerService.state.settings, ...newSettings };

            // Persist to database. Assume 'upsert' works with the `id` field.
            await queueEntityCall('ScanSettings', 'upsert', this.scannerService.state.settings);

            // After settings are updated, re-attach/ensure the guard is active.
            // This is crucial if blockTradingInDowntrend is changed.
            if (this.scannerService.attachRegimeOpenGuard) {
                this.scannerService.attachRegimeOpenGuard();
            }


            if (newSettings.minimumCombinedStrength !== undefined &&
                newSettings.minimumCombinedStrength !== oldSettings.minimumCombinedStrength) {
                this.addLog(`[ConfigurationService] Minimum combined strength changed to ${newSettings.minimumCombinedStrength}. Re-filtering strategies...`, 'system');
                // Delegate strategy re-filtering to StrategyManagerService via AutoScannerService
                await this.scannerService.strategyManager._loadAndFilterStrategiesInternal(newSettings.minimumCombinedStrength);
            }

            if (newSettings.minimumRegimeConfidence !== undefined &&
                newSettings.minimumRegimeConfidence !== oldSettings.minimumRegimeConfidence) {
                this.addLog(`[ConfigurationService] Minimum regime confidence threshold changed to ${newSettings.minimumRegimeConfidence}%. This will affect strategy evaluation in future scan cycles.`, 'system');
            }

            if (newSettings.minimumTradeValue !== undefined && newSettings.minimumTradeValue !== oldSettings.minimumTradeValue) {
                this.addLog(`[ConfigurationService] Minimum trade value changed to ${newSettings.minimumTradeValue} USDT.`, 'system');
            }

            if (newSettings.maxPositions !== undefined && newSettings.maxPositions !== oldSettings.maxPositions) {
                this.addLog(`[ConfigurationService] Max positions per strategy changed to ${newSettings.maxPositions}.`, 'system');
            }

            if (newSettings.maxBalancePercentRisk !== undefined && newSettings.maxBalancePercentRisk !== oldSettings.maxBalancePercentRisk) {
                this.addLog(`[ConfigurationService] Max balance percent risk changed to ${newSettings.maxBalancePercentRisk}%.`, 'system');
            }
            // NEW: Log absolute cap changes
            if (newSettings.maxBalanceInvestCapUSDT !== undefined &&
                newSettings.maxBalanceInvestCapUSDT !== oldSettings.maxBalanceInvestCapUSDT) {
                this.addLog(`[ConfigurationService] Max balance invest cap changed to $${newSettings.maxBalanceInvestCapUSDT}.`, 'system');
            }
            // NEW: Log blockTradingInDowntrend changes
            if (newSettings.blockTradingInDowntrend !== undefined &&
                newSettings.blockTradingInDowntrend !== oldSettings.blockTradingInDowntrend) {
                this.addLog(`[ConfigurationService] Block trading in downtrend set to ${newSettings.blockTradingInDowntrend ? 'ENABLED' : 'DISABLED'}.`, 'system');
            }


            this.addLog('[ConfigurationService] Scanner settings updated successfully.', 'success');
            this.notifySubscribers(); // Notify UI of settings change

            if (this.toast) {
                this.toast({
                    title: "Settings Updated",
                    description: "Scanner configuration has been successfully updated."
                });
            }

        } catch (error) {
            this.addLog(`[ConfigurationService] Failed to update settings: ${error.message}`, 'error', error);
            if (this.toast) {
                this.toast({
                    title: "Settings Update Failed",
                    description: `Failed to update settings: ${error.message}`,
                    variant: "destructive"
                });
            }
            throw error;
        }
    }
}

/**
 * Manages the loading, filtering, and state of active trading strategies.
 */
class StrategyManagerService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService);
        this.toast = scannerService.toast;
        // Reference to AutoScannerService's state for updates
        this.state = scannerService.state;
    }

    /**
     * Internal method to load and filter strategies based on various criteria including current settings.
     * Updates scannerService.state.activeStrategies and related stats.
     * @param {number|null} minCombinedStrengthOverride - Optional override for the minimum combined strength setting.
     * @returns {Array} An array of eligible strategies.
     */
    async _loadAndFilterStrategiesInternal(minCombinedStrengthOverride = null) {
        this.addLog('[StrategyManagerService] Loading and filtering strategies (internal)...', 'info');

        const minimumCombinedStrength = minCombinedStrengthOverride !== null
            ? minCombinedStrengthOverride
            : (this.state.settings?.minimumCombinedStrength || 0);

        const strategiesList = await queueEntityCall('BacktestCombination', 'list');

        let totalStrategies = strategiesList?.length || 0;
        let filteredOptedOut = 0;
        let filteredUnderperforming = 0;
        let filteredOther = 0;

        const eligibleStrategies = (strategiesList || [])
            .filter(match => {
                if (match.optedOutGlobally || match.optedOutForCoin) {
                    filteredOptedOut++;
                    return false;
                }

                if (!Array.isArray(match.signals) || match.signals.length === 0) {
                    filteredOther++;
                    return false;
                }

                // Apply minimum combined strength filter
                if ((match.combinedStrength || 0) < minimumCombinedStrength) {
                    filteredOther++;
                    return false;
                }

                const hasEnoughTrades = (match.realTradeCount || 0) >= 5;
                const isUnderperforming = hasEnoughTrades &&
                    ((match.realProfitFactor || 0) < 0.8 || (match.realSuccessRate || 0) < 25);

                if (isUnderperforming) {
                    filteredUnderperforming++;
                    return false;
                }

                if (!match.includedInScanner) {
                    filteredOther++;
                    return false;
                }

                return true;
            })
            .map(match => {
                const realTradeCount = match.realTradeCount || 0;
                const realProfitFactor = match.realProfitFactor || 0;
                const realSuccessRate = match.realSuccessRate || 0;
                const backtestProfitFactor = match.profitFactor || 0;
                const backtestSuccessRate = match.successRate || 0;

                let profitabilityScore = 0;

                if (realTradeCount >= 10) {
                    profitabilityScore = (realProfitFactor * 0.4) + (realSuccessRate * 0.003) +
                        (backtestProfitFactor * 0.2) + (backtestSuccessRate * 0.001) +
                        ((match.combinedStrength || 0) * 0.001);
                } else if (realTradeCount >= 5) {
                    profitabilityScore = (realProfitFactor * 0.3) + (realSuccessRate * 0.002) +
                        (backtestProfitFactor * 0.3) + (backtestSuccessRate * 0.002) +
                        ((match.combinedStrength || 0) * 0.001);
                } else {
                    profitabilityScore = (backtestProfitFactor * 0.4) + (backtestSuccessRate * 0.003) +
                        ((match.combinedStrength || 0) * 0.002) +
                        ((realTradeCount || 0) === 0 ? 0.5 : -0.2);
                    if (!match.realTradeCount && match.combinedStrength > 0) {
                        profitabilityScore += (match.combinedStrength / 1000);
                    }
                }

                const processedStrategy = {
                    ...match,
                    id: match.id,
                    coin: match.coin,
                    timeframe: match.timeframe,
                    signals: match.signals || [],
                    combinationName: match.combinationName || `${match.coin}-Strategy`,
                    combinedStrength: match.combinedStrength || 0,
                    minCoreSignalStrength: match.minCoreSignalStrength || 80,
                    strategyDirection: match.strategyDirection || 'long',
                    takeProfitAtrMultiplier: match.takeProfitAtrMultiplier || 3,
                    stopLossAtrMultiplier: match.stopLossAtrMultiplier || 2.5,
                    estimatedExitTimeMinutes: match.estimatedExitTimeMinutes || null, // Keep in MINUTES
                    enableTrailingTakeProfit: match.enableTrailingTakeProfit !== false,
                    profitabilityScore: profitabilityScore,
                    realTradeCount: realTradeCount
                };

                return processedStrategy;
            })
            .sort((a, b) => b.profitabilityScore - a.profitabilityScore);

        this.state.activeStrategies = eligibleStrategies; // Update scanner service state
        this.state.stats.activeStrategies = eligibleStrategies.length;

        const totalCombinedStrength = eligibleStrategies.reduce((acc, s) => acc + (s.combinedStrength || 0), 0);
        this.state.stats.averageSignalStrength = eligibleStrategies.length > 0
            ? totalCombinedStrength / eligibleStrategies.length
            : 0;

        const activeCount = eligibleStrategies.length;
        this.addLog(`[StrategyManagerService] Strategy filtering complete: ${activeCount}/${totalStrategies} active (${filteredOptedOut} opted-out, ${filteredUnderperforming} underperforming, ${filteredOther} other)`, 'info');

        if (eligibleStrategies.length > 0) {
            const topStrategy = eligibleStrategies[0];
            const avgScore = eligibleStrategies.reduce((sum, s) => sum + (s.profitabilityScore || 0), 0) / eligibleStrategies.length;
            const strategiesWithDemoTrades = eligibleStrategies.filter(s => (s.realTradeCount || 0) > 0).length;

            this.addLog(`📊 Strategy Prioritization Complete: ${eligibleStrategies.length} strategies loaded`, 'info');
            this.addLog(`📈 Top strategy: ${topStrategy.combinationName} (Score: ${(topStrategy.profitabilityScore || 0).toFixed(1)}, Avg: ${avgScore.toFixed(1)})`, 'info');
            this.addLog(`🎯 ${strategiesWithDemoTrades}/${eligibleStrategies.length} strategies have demo trading data`, 'info');
        } else {
            this.addLog(`📊 Strategy Prioritization Complete: No eligible strategies found`, 'warning');
        }

        this.notifySubscribers();
        return eligibleStrategies; // Return the filtered strategies
    }

    /**
     * Public method to load and filter strategies, typically called by AutoScannerService.
     * @param {string} tradingMode - The current trading mode ('testnet' or 'live').
     * @returns {Array} An array of eligible strategies.
     */
    async loadActiveStrategies(tradingMode) {
        // The tradingMode parameter could be used here if 'BacktestCombination' entity filtering
        // needed to be specific to tradingMode, but currently, it lists all.
        return this._loadAndFilterStrategiesInternal();
    }

    /**
     * Refreshes the list of active strategies, typically after new backtest results or settings changes.
     */
    async refreshStrategies() {
        this.addLog('[StrategyManagerService] Refreshing strategy list due to new backtest results or tradingMode...', 'info');

        try {
            const oldCount = this.state.activeStrategies.length; // Capture old count for comparison
            const newStrategies = await this.loadActiveStrategies(this.scannerService.getTradingMode()); // Use the new public method
            const newCount = newStrategies.length;
            const countChange = newCount - oldCount;
            const changeText = countChange > 0 ? `+${countChange}` : countChange.toString();

            this.addLog(`✅ Strategy list refreshed: ${newCount} strategies (${changeText} from before)`, 'success');

            if (this.toast) {
                this.toast({
                    title: "Strategy List Updated",
                    description: `Scanner now has ${newCount} strategies (${changeText})`,
                    variant: "default"
                });
            }

        } catch (error) {
            this.addLog(`❌ Failed to refresh strategies: ${error.message}`, 'error', error);
        }
    }

    /**
     * Evaluates active strategies and detects signals, delegating to SignalDetectionEngine.
     * This method also manages the `newPositionsCount` in the scanner's state.
     * @param {Array} strategies - List of active strategies.
     * @param {object} currentWalletState - The current wallet state.
     * @param {object} settings - Scanner settings.
     * @param {object} marketRegime - Current market regime data.
     * @param {object} currentPrices - Current market prices.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     * @returns {object} Scan result from signal detection, including signalsFound and tradesExecuted.
     */
    async evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {
        // Reset newPositionsCount for this evaluation cycle
        this.scannerService.state.newPositionsCount = 0;

        const scanResult = await this.scannerService.signalDetectionEngine.scanForSignals(
            strategies,
            currentWalletState,
            settings,
            marketRegime,
            currentPrices,
            cycleStats
        );

        // Assuming scanForSignals (via PositionManager) updates cycleStats.positionsOpened,
        // we can use it to reflect newPositionsCount.
        // Or, more directly, assume scanResult includes tradesExecuted which represents new positions.
        this.scannerService.state.newPositionsCount = scanResult.tradesExecuted;

        return scanResult; // { signalsFound, tradesExecuted }
    }
}

// Add lightweight helpers near the top-level of this file (outside the class) if not present
function _getRegimeNameSafe(regime) {
    if (!regime || typeof regime !== 'object') return null;
    const candidates = [regime.name, regime.regime, regime.phase, regime.trend, regime.state, regime.type];
    const found = candidates.find((v) => typeof v === 'string' && v.length > 0);
    return found ? String(found).toLowerCase() : null;
}


class AutoScannerService {
    constructor() {
        if (AutoScannerService.instance) {
            return AutoScannerService.instance;
        }

        this.state = {
            isInitialized: false,
            isInitializing: false,
            isRunning: false,
            isScanning: false,
            settings: null,
            activeStrategies: [],
            marketRegime: null,
            performanceMomentumScore: null,
            momentumBreakdown: null,
            signalGenerationHistory: [],
            marketVolatility: { adx: 25, bbw: 0.1 },
            logs: { activity: [], performance: [] },
            stats: {
                activeStrategies: 0,
                totalScans: 0,
                signalsFound: 0,
                tradesExecuted: 0,
                successRate: 0,
                totalPnL: 0,
                averageSignalStrength: 0,
                // NEW: Scan cycle metrics
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            },
            lastScanTime: null,
            nextScanTime: null,
            recentTradesForMomentum: [],
            tradingMode: 'testnet',
            liveWalletState: null,
            exchangeInfo: null,
            leaderSessionId: null,
            // ADDED: Fear & Greed data in state for UI widgets
            fearAndGreedData: null,
            // ADDED: Expose cached alerts to UI
            marketAlerts: [],
            // ADDED: Track new positions opened in current cycle for immediate wallet refresh
            newPositionsCount: 0,
            adjustedBalanceRiskFactor: 100, // NEW: Dynamic risk factor based on momentum (0-100)
        };

        this.regimeCache = {
            regime: null,
            lastCalculated: null,
            cacheValidityHours: 1
        };

        this.currentPrices = {};

        this.telegramSettings = {
            token: typeof window !== 'undefined' ? (window.TELEGRAM_BOT_TOKEN || '') : '',
            chat_id: typeof window !== 'undefined' ? (window.TELEGRAM_CHAT_ID || '') : ''
        };

        this.subscribers = [];
        this.scanInterval = null;
        this.countdownInterval = null;
        this.walletSubscribers = [];

        this.isHardResetting = false;
        this.sessionId = null;
        this.isNavigating = false;
        this.navigationTimeout = null;
        this._hasAutoStartedOnInit = false;
        this._isAutoStartBlocked = false; // NEW: allows UI to control auto-start timing
        this._persistedRunningFlag = false; // NEW: remember prior "running" without starting immediately
        this._openGuardAttached = false; // Flag to track if the guard has been attached

        this._loadStateFromStorage();
        // NOTE: Do NOT auto-start here based on persisted state. We'll start only after init completes.

        // Ensure tradingMode always has a valid default
        if (!this.state.tradingMode) {
            this.state.tradingMode = 'testnet';
        }

        this.backtestCache = new Map();
        this.backtestCacheTimestamps = new Map();

        // Instance properties for _fetchFearAndGreedIndex to work within AutoScannerService
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedData = null; // AutoScannerService's own property, distinct from state.fearAndGreedData
        this.fearAndGreedFailureCount = 0;

        // NEW: Track scan cycle times for averaging
        this.scanCycleTimes = [];
        this.maxCycleTimeSamples = 20; // Keep last 20 cycle times for rolling average

        // Add: toggle to print to browser console (off by default)
        this.debugConsole = false;

        // NEW: Filter noisy console logs globally for known scanner tags (leave errors)
        if (typeof window !== 'undefined' && !window.__scannerConsoleFiltered) {
            window.__scannerConsoleFiltered = true;
            const origLog = console.log.bind(console);
            const origWarn = console.warn.bind(console);
            const bannedTags = [
                '[AutoScannerService]',
                '[AutoScanner]',
                '[POS_MON]',
                '[BATCH_OPEN]',
                '[BATCH_CLOSE]',
                '[RECONCILE]',
                '[PRICE_CONSOLIDATION]',
                '[SCAN_CYCLE]',
                '[HEARTBEAT]',
                '[GROUP_INDICATORS]',
                'EVALUATING_STRATEGY',
                'POSITION_CLOSING_DETECTION',
                '===== SCAN CYCLE',
                '⏱️ Scan cycle',
                '[PositionManager]',
                '[MONITOR]'
            ];

            console.log = (...args) => {
                try {
                    const first = args[0];
                    if (typeof first === 'string' && bannedTags.some(tag => first.includes(tag))) {
                        return; // suppress known scanner debug logs
                    }
                } catch (_) { }
                origLog(...args);
            };

            console.warn = (...args) => {
                try {
                    const first = args[0];
                    if (typeof first === 'string' && bannedTags.some(tag => first.includes(tag))) {
                        return; // suppress noisy warnings from scanner tags
                    }
                } catch (_) { }
                origWarn(...args);
            };
        }

        // CRITICAL: Initialize services in correct order
        // 1. HeartbeatService first (no dependencies)
        this.heartbeatService = new HeartbeatService({
            getSessionId: () => this.sessionId,
            isLeaderProvider: () => {
                return this.state.leaderSessionId === this.sessionId && this.state.isRunning;
            },
            onStatus: (payload) => {
                try {
                    const snap = {
                        message: payload?.message,
                        level: payload?.level || "system",
                        data: payload?.data ? true : false,
                        error: payload?.error ? (payload?.error?.message || String(payload.error)) : null,
                        ts: new Date().toISOString(),
                    };
                    if (payload?.error) {
                        console.error("[HEARTBEAT] ", snap);
                    }
                } catch (_) { }
                this.addLog(`[HEARTBEAT] ${payload.message}`, payload.level || "system");
            },
            intervalMs: 25000,
        });

        // Defensive: Ensure send method is properly bound
        if (this.heartbeatService && typeof this.heartbeatService.send === 'function') {
            this.heartbeatService.send = this.heartbeatService.send.bind(this.heartbeatService);
        }

        // Defensive: Wrap heartbeat console logging
        if (this.heartbeatService && !this.heartbeatService.__consoleWrapped) {
            this.heartbeatService.__consoleWrapped = true;
            const __origStart = this.heartbeatService.start.bind(this.heartbeatService);
            const __origStop = this.heartbeatService.stop.bind(this.heartbeatService);

            this.heartbeatService.start = (...args) => {
                return __origStart(...args);
            };
            this.heartbeatService.stop = (...args) => {
                return __origStop(...args);
            };
        }

        // 2. Then SessionManager (depends on heartbeatService existing)
        this.sessionManager = new SessionManagerService(this);

        // 3. Configuration and Strategy services
        this.configurationService = new ConfigurationService(this);
        this.strategyManager = new StrategyManagerService(this);

        // 4. CRITICAL: Initialize PositionManager BEFORE SignalDetectionEngine
        this.positionManager = new PositionManager(this);

        // Attach the open guard immediately after positionManager is created
        this.attachRegimeOpenGuard();

        // 5. THEN initialize SignalDetectionEngine (which depends on PositionManager)
        this.signalDetectionEngine = new SignalDetectionEngine(this);

        // 6. Finally, other services
        this.walletManagerService = initializeWalletManagerService(this);
        this.performanceMetricsService = new PerformanceMetricsService(this);
        this.tradeArchivingService = new TradeArchivingService(this);

        // Add this non-breaking guard right after you create/update momentumBreakdown:
        if (this.state && this.state.momentumBreakdown && !this.state.momentumBreakdown.weightsPercents) {
            this.state.momentumBreakdown.weightsPercents = MOMENTUM_WEIGHTS_PERCENTS;
        }

        // Also, if you expose a getter, ensure percents are present:
        if (this.getState) {
            const _origGetState = this.getState.bind(this);
            this.getState = () => {
                const s = _origGetState();
                if (s && s.momentumBreakdown && !s.momentumBreakdown.weightsPercents) {
                    s.momentumBreakdown.weightsPercents = MOMENTUM_WEIGHTS_PERCENTS;
                }
                return s;
            };
        }

        // ADDED: Monkey-patch direct MarketAlert.create/bulkCreate to buffer while scanning
        // so any legacy direct SDK usage won't hit DB during scan
        (async () => {
            try {
                const { MarketAlert } = await import('@/api/entities');
                if (!MarketAlert.__originalCreate) {
                    MarketAlert.__originalCreate = MarketAlert.create;
                    MarketAlert.create = async (payload) => {
                        if (this.state?.isScanning) {
                            const { addMarketAlertToBuffer } = await import('@/components/utils/apiQueue');
                            addMarketAlertToBuffer(payload);
                            this.addLog('[MarketAlert] Buffered create during scan cycle', 'system');
                            return { id: 'buffered' }; // Return a placeholder ID
                        }
                        return MarketAlert.__originalCreate(payload);
                    };
                }
                if (!MarketAlert.__originalBulkCreate) {
                    MarketAlert.bulkCreate = async (records) => {
                        if (this.state?.isScanning && Array.isArray(records)) {
                            const { addMarketAlertToBuffer } = await import('@/components/utils/apiQueue');
                            records.forEach((r) => addMarketAlertToBuffer(r));
                            this.addLog(`[MarketAlert] Buffered bulkCreate (${records.length}) during scan cycle', 'system`);
                            return records.map((r) => ({ ...r, id: 'buffered' })); // Return placeholder IDs
                        }
                        return MarketAlert.__originalBulkCreate(records);
                    };
                }
            } catch (_e) {
                // ignore patch errors silently, e.g., if MarketAlert entity is not found or already patched by another instance
            }
        })();

        if (typeof window !== 'undefined') {
            // Ensure we always have a stable sessionId for this tab BEFORE any session calls
            try {
                const key = 'scanner_session_id';
                let sid = sessionStorage.getItem(key);
                if (!sid) {
                    sid = `session_${generateTradeId()}`;
                    sessionStorage.setItem(key, sid);
                }
                this.setSessionId(sid);
            } catch (_e) {
                // Fallback: still set a random id to avoid missing sessionId
                const sid = `session_${generateTradeId()}`;
                this.setSessionId(sid);
            }

            window.autoScannerService = this;
            this._setupNavigationHandlers();
        }

        AutoScannerService.instance = this;
    }

    // Add guard attachment and check methods
    attachRegimeOpenGuard() {
        try {
            if (!this.positionManager || this._openGuardAttached) return;

            const originalOpenFn = this.positionManager.openPositionsBatch?.bind(this.positionManager);
            if (typeof originalOpenFn !== 'function') {
                console.warn('[AutoScannerService] Cannot attach regime open guard: positionManager.openPositionsBatch is not a function.');
                return;
            }

            this.positionManager.openPositionsBatch = async (...args) => {
                // Evaluate guard at call-time so latest state is used
                const isBlocked = this._isTradingBlockedByRegime();
                if (isBlocked) {
                    // Best-effort logging into scanner logs if available
                    const msg = 'Downtrend block active — skipping opening new positions due to user configuration.';
                    try {
                        if (typeof this.addLog === 'function') {
                            this.addLog(msg, 'trade_blocked', { reason: 'downtrend_config' });
                        } else {
                            console.warn('[AutoScannerService] trade_blocked:', msg);
                        }
                    } catch (_e) {
                        // swallow
                    }
                    // Return a neutral result so callers proceed gracefully without opening trades
                    const signals = Array.isArray(args?.[0]) ? args[0] : [];
                    return { opened: 0, failed: 0, skipped: signals.length, reason: 'downtrend_block_active' };
                }
                return await originalOpenFn(...args);
            };

            this._openGuardAttached = true;
            console.log('[AutoScannerService] ✅ Regime open guard attached to PositionManager.');
        } catch (e) {
            console.warn('[AutoScannerService] ⚠️ attachRegimeOpenGuard failed:', e?.message || e);
        }
    }

    _isTradingBlockedByRegime() {
        try {
            const settings = this.state?.settings;
            const regime = this.state?.marketRegime;
            const enabled = !!settings?.blockTradingInDowntrend;
            if (!enabled) return false;
            const regimeName = _getRegimeNameSafe(regime);
            return regimeName === 'downtrend';
        } catch (_e) {
            console.error('[AutoScannerService] Error in _isTradingBlockedByRegime:', _e);
            return false;
        }
    }

    // ADDED: Expose wallet re-initialization method for external use (e.g., TradingModal)
    async reinitializeWalletFromBinance() {
        if (!this.walletManagerService) {
            throw new Error('WalletManagerService is not initialized');
        }

        try {
            await this.walletManagerService.initializeLiveWallet();

            // NEW: ensure wallet mode is always set for downstream services
            if (this.state.liveWalletState && !this.state.liveWalletState.mode) {
                this.state.liveWalletState.mode = this.state.tradingMode || 'testnet';
            }

            await this.walletManagerService.updateWalletSummary(this.state.liveWalletState, this.currentPrices);
            await this._persistLatestWalletSummary();
            this.notifyWalletSubscribers();

            return true;
        } catch (error) {
            console.error('[AutoScannerService] ❌ Failed to reinitialize wallet from Binance:', error);
            throw error;
        }
    }

    _formatCurrency(value) {
        return formatUSDT(value);
    }

    _formatPrice(value) {
        return formatPrice(value);
    }

    _setupNavigationHandlers() {
        const originalPushState = window.history.pushState;
        const originalReplaceState = window.history.replaceState;

        window.history.pushState = (...args) => {
            this._handleNavigationStart();
            return originalPushState.apply(window.history, args);
        };

        window.history.replaceState = (...args) => {
            this._handleNavigationStart();
            return originalReplaceState.apply(window.history, args);
        };

        window.addEventListener('popstate', () => {
            this._handleNavigationStart();
        });

        window.addEventListener('load', () => {
            this._handleNavigationEnd();
        });
    }

    _handleNavigationStart() {
        this.isNavigating = true;

        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
        }

        console.log(`[AutoScannerService] 🧭 Navigation detected - preventing scanner control changes`);

        this.navigationTimeout = setTimeout(() => {
            this._handleNavigationEnd();
        }, 2000);
    }

    _handleNavigationEnd() {
        this.isNavigating = false;

        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
            this.navigationTimeout = null;
        }

        console.log(`[AutoScannerService] 🧭 Navigation completed - scanner control restored`);
    }

    // NEW: allow UI to block or allow the internal persisted auto-start
    setAutoStartBlocked(flag) {
        this._isAutoStartBlocked = !!flag;
        console.log(`[AutoScannerService] [AutoStart] UI ${this._isAutoStartBlocked ? 'blocked' : 'unblocked'} internal auto-start.`);
    }

    setSessionId(id) {
        if (!this.sessionId) {
            this.sessionId = id;
            console.log(`[AutoScannerService] [SESSION] Session ID set: ${id}`);
        }
    }

    subscribeToWalletUpdates(callback) {
        this.walletSubscribers.push(callback);
        return () => {
            this.walletSubscribers = this.walletSubscribers.filter(sub => sub !== callback);
        };
    }

    notifyWalletSubscribers() {
        this.walletSubscribers.forEach(callback => {
            try {
                callback();
            } catch (error) {
            }
        });
    }

    setTradingMode(mode) {
        if (mode !== 'testnet' && mode !== 'live') {
            console.error(`[AutoScannerService] ❌ Invalid trading mode: ${mode}. Must be 'testnet' or 'live'`);
            return;
        }

        const oldMode = this.state.tradingMode;
        if (oldMode === mode) {
            return;
        }

        this.state.tradingMode = mode;
        console.log(`[AutoScannerService] 🔄 Trading mode changed from ${oldMode.toUpperCase()} to ${mode.toUpperCase()}. Re-initializing wallet...`);

        this.state.isInitialized = false;
        this.initialize().then(() => {
            console.log(`[AutoScannerService] ✅ Successfully switched to ${mode.toUpperCase()} mode.`);
            this.notifyWalletSubscribers();
            this.notifySubscribers();
        }).catch(error => {
            console.error(`[AutoScannerService] ❌ Failed to switch to ${mode.toUpperCase()} mode: ${error.message}`);
        });

        if (this.positionManager) {
            this.positionManager.setTradingMode(mode);
        }

        this.notifySubscribers();
    }

    getTradingMode() {
        return this.state.tradingMode;
    }

    isLiveMode() {
        return this.state.tradingMode === 'live';
    }

    isTestnetMode() {
        return this.state.tradingMode === 'testnet';
    }

    _startRunningState() {
        this.state.isRunning = true;
        this._saveStateToStorage();
        console.log('[AutoScannerService] ✅ Auto Scanner now in running state.');

        // Start heartbeat service (25s interval)
        this.heartbeatService.start();

        // Start passive monitoring (60s interval)
        this.sessionManager.startMonitoring();

        this._startScanLoop();
        this.notifySubscribers();
    }

    _stopRunningState(options = {}) {
        console.log('[AutoScannerService] 🛑 Auto Scanner transitioning to stopped state.');

        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }

        this.state.isRunning = false;
        this.state.isScanning = false;
        this.state.nextScanTime = null;
        this.state.leaderSessionId = null;

        this.heartbeatService.stop();
        this.sessionManager.stopMonitoring();

        this._saveStateToStorage();
        this.notifySubscribers();
    }

    // DEPRECATE legacy immediate open; route via batch for safety/back-compat
    async _openPosition(combination, currentPrice, convictionScore, convictionDetails, cycleStats) {
        console.log('[AutoScannerService] [DEPRECATION] _openPosition called; routing via batch openPositionsBatch.');
        const res = await this.positionManager.openPositionsBatch([{ combination, currentPrice, convictionScore, convictionDetails }]);
        if (cycleStats && res?.opened) {
            cycleStats.positionsOpened = (cycleStats.positionsOpened || 0) + res.opened;
        }
        return (res?.opened || 0) > 0;
    }

    registerPriceUpdateCallback(callback) {
        this.priceUpdateCallback = callback;
        if (this.priceUpdateCallback && Object.keys(this.currentPrices).length > 0) {
            this.priceUpdateCallback(this.currentPrices);
        }
    }

    unregisterPriceUpdateCallback(callback) {
        if (this.priceUpdateCallback === callback) {
            this.priceUpdateCallback = null;
        }
    }

    // Helper: get free USDT balance safely
    _getAvailableUsdt() {
        const balances = this.state?.liveWalletState?.balances || [];
        const usdt = balances.find(b => b.asset === 'USDT');
        const free = parseFloat(usdt?.free || '0');
        return Number.isFinite(free) ? free : 0;
    }

    // NEW: compute current balance allocated across open/trailing positions (entry basis)
    _getBalanceAllocatedInTrades() {
        const positions = (this.state?.liveWalletState?.positions || []).filter(
            p => p && (p.status === 'open' || p.status === 'trailing')
        );
        let allocated = 0;
        for (const pos of positions) {
            const qty = Number(pos.quantity_crypto);
            const entryValue = Number(pos.entry_value_usdt);
            const entryPrice = Number(pos.entry_price);
            const symbol = (pos.symbol || '').replace('/', '');
            const livePrice = Number(this.currentPrices?.[symbol]);

            if (Number.isFinite(entryValue) && entryValue > 0) {
                allocated += entryValue;
            } else if (Number.isFinite(qty) && qty > 0) {
                const price = Number.isFinite(entryPrice) && entryPrice > 0
                    ? entryPrice
                    : (Number.isFinite(livePrice) && livePrice > 0 ? livePrice : NaN);
                if (Number.isFinite(price)) {
                    allocated += qty * price;
                }
            }
        }
        return Number(allocated.toFixed(2));
    }

    _isRegimeCacheValid() {
        if (!this.regimeCache.lastCalculated || !this.regimeCache.regime) {
            return false;
        }

        const cacheAgeMs = Date.now() - this.regimeCache.lastCalculated;
        const cacheValidityMs = this.regimeCache.cacheValidityHours * 60 * 60 * 1000;

        return cacheAgeMs < cacheValidityMs;
    }

    async _getCachedOrCalculateRegime(forceCalculate = false) {
        const isCacheValid = this._isRegimeCacheValid();

        if (!forceCalculate && isCacheValid) {
            const cacheAgeMinutes = Math.round((Date.now() - this.regimeCache.lastCalculated) / (1000 * 60));
            console.log(`[AutoScannerService] [Regime] Using cached regime: ${this.regimeCache.regime.regime.toUpperCase()} (${(this.regimeCache.regime.confidence * 100).toFixed(1)}%) - Cache age: ${cacheAgeMinutes}min`);
            return this.regimeCache.regime;
        }

        try {
            await this._updateMarketRegime();

            this.regimeCache.regime = { ...this.state.marketRegime };
            this.regimeCache.lastCalculated = Date.now();

            const confidencePercent = (this.regimeCache.regime.confidence * 100).toFixed(1);
            console.log(`[AutoScannerService] [Regime] ✅ Fresh regime calculated and cached: ${this.regimeCache.regime.regime.toUpperCase()} (${confidencePercent}%)`);

            return this.regimeCache.regime;
        } catch (error) {
            console.error(`[AutoScannerService] [Regime] ❌ Failed to calculate regime: ${error.message}`);
            console.error(`[AutoScannerService] [Regime] ❌ Failed to calculate regime: ${error.message}`, 'error');
            return this.regimeCache.regime || { regime: 'neutral', confidence: 0.5 };
        }
    }

    async resetWalletAndRestart() {
        const modeText = this.isLiveMode() ? 'LIVE ACCOUNT' : 'TESTNET ACCOUNT';

        console.log(`[AutoScannerService] 🚨 ${modeText} RESET INITIATED. ${this.isLiveMode() ? 'Closing all live positions' : 'Closing all testnet positions'} for a clean slate.`);

        if (this.isHardResetting) {
            console.warn('[AutoScannerService] Reset already in progress. Aborting new request.');
            return;
        }
        this.isHardResetting = true;

        try {
            if (this.state.isRunning) {
                this.stop();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`[AutoScannerService] 🔥 Clearing local state and database records for ${modeText}...`);

            // Step 1: Purge all LivePosition records
            console.log(`[AutoScannerService] [RESET] Purging all LivePosition records for ${this.state.tradingMode.toUpperCase()} mode...`);

            try {
                const purgeResponse = await queueFunctionCall(
                    'purgeAllPositions',
                    { mode: this.state.tradingMode },
                    'critical',
                    null,
                    0,
                    60000
                );

                if (purgeResponse?.data?.success) {
                    console.log(`[AutoScannerService] [RESET] ✅ Purged ${purgeResponse.data.deletedCount} LivePosition records for ${this.state.tradingMode.toUpperCase()} mode.`);
                } else {
                    console.warn(`[AutoScannerService] [RESET] ⚠️ LivePosition purge had issues: ${purgeResponse?.data?.error || 'Unknown error'}. Continuing with reset.`);
                }
            } catch (purgeError) {
                console.error('[AutoScannerService] ❌ Error purging positions:', purgeError);
                console.warn(`[AutoScannerService] [RESET] ⚠️ Failed to purge LivePositions: ${purgeError.message}. Continuing with reset.`);
            }

            // Step 2: Regular wallet reset (clears trades, wallet state, etc.)
            const purgeResult = await this.walletManagerService.resetWalletData(this.getTradingMode());

            if (purgeResult?.success) {
                console.log(`[AutoScannerService] ✅ Server-side managed data cleared for ${this.state.tradingMode.toUpperCase()} mode. Wallets: ${purgeResult.walletsDeleted}, Trades: ${purgeResult.tradesDeleted}`);
            } else {
                console.warn(`[AutoScannerService] ⚠️ Could not clear server-side data: ${purgeResult?.error?.message || 'Unknown error'}. Continuing with reset.`);
            }

            // Step 3: Clear API queue cache
            apiQueue.clearCache();

            // Step 4: Reinitialize wallet from Binance
            await this.walletManagerService.initializeLiveWallet();

            // Step 5: Reset stats and state
            this.state.stats = {
                activeStrategies: this.state.activeStrategies.length,
                totalScans: 0, signalsFound: 0, tradesExecuted: 0, totalPnL: 0, successRate: 0,
                averageSignalStrength: 0,
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            };
            this.scanCycleTimes = [];
            this.state.logs.activity = [];
            this.performanceMetricsService.resetState();
            this.tradeArchivingService.resetState();
            this.currentPrices = {};
            this.state.momentumBreakdown = null;
            this.state.signalGenerationHistory = [];
            this.state.marketVolatility = { adx: 25, bbw: 0.1 };
            this.state.fearAndGreedData = null;
            this.state.marketAlerts = [];
            this.state.newPositionsCount = 0; // Reset new positions count
            this.state.adjustedBalanceRiskFactor = 100; // Reset adjusted risk factor

            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 🔄 ${modeText} RESET COMPLETED`);
            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 💰 ${modeText} refreshed from Binance (Wallet ID: ${this.state.liveWalletState?.id}).`);
            console.log('[AutoScannerService] Scanner is ready for a fresh start with clean position tracking.');
            console.log('════════════════════════════════════════════════════════════');

            await this.walletManagerService.updateWalletSummary(this.state.liveWalletState, this.currentPrices);
            this.notifyWalletSubscribers();
            this.notifySubscribers();

            console.log(`[AutoScannerService] 🚀 Restarting scanner in ${this.state.tradingMode.toUpperCase()} mode...`);
            await this.start();

            if (this.toast) {
                this.toast({
                    title: `${modeText} Reset Complete`,
                    description: `${modeText} has been re-synced with Binance. Scanner is now active with clean position tracking.`
                });
            }
        } catch (error) {
            console.error('[AutoScannerService] ❌ resetWalletAndRestart error:', error);
            console.error('[AutoScannerService] Error stack:', error.stack);
            console.error(`[AutoScannerService] ❌ CRITICAL FAILURE during ${modeText.toLowerCase()} reset: ${error.message}`);
            if (this.toast) {
                this.toast({
                    title: "Reset Failed",
                    description: `Failed to reset ${modeText.toLowerCase()}: ${error.message}`,
                    variant: "destructive"
                });
            }
        } finally {
            this.isHardResetting = false;
        }
    }

    subscribe(callback) {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== callback);
        };
    }

    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
            }
        });
    }

    registerToastNotifier(toastFunction) {
        this.toast = toastFunction;
    }

    _saveStateToStorage() {
        try {
            if (typeof window === 'undefined') return;
            const stateToSave = {
                isRunning: this.state.isRunning,
                tradingMode: this.state.tradingMode,
                // NEW: persist market regime streak/state
                marketRegimeState: this.state.marketRegime
                    ? {
                        regime: this.state.marketRegime.regime,
                        confidence: this.state.marketRegime.confidence,
                        isConfirmed: this.state.marketRegime.isConfirmed,
                        consecutivePeriods: this.state.marketRegime.consecutivePeriods,
                        confirmationThreshold: this.state.marketRegime.confirmationThreshold,
                        regimeHistory: Array.isArray(this.state.marketRegime.regimeHistory)
                            ? this.state.marketRegime.regimeHistory.slice(-20) // cap history length
                            : []
                    }
                    : null,
                // NEW: persist scan cycle statistics
                scanCycleStats: {
                    totalScanCycles: this.state.stats?.totalScanCycles || 0,
                    averageScanTimeMs: this.state.stats?.averageScanTimeMs || 0,
                    lastScanTimeMs: this.state.stats?.lastScanTimeMs || 0,
                    totalScans: this.state.stats?.totalScans || 0 // ADDED: Persist totalScans
                }
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (error) {
            console.error('[AutoScannerService] Failed to save scanner state to localStorage.', error);
        }
    }

    _loadStateFromStorage() {
        try {
            if (typeof window === 'undefined') return;
            const savedStateJSON = localStorage.getItem(STORAGE_KEY);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                if (typeof savedState.isRunning === 'boolean') {
                    // NEW: Keep a flag instead of flipping state.isRunning now.
                    this._persistedRunningFlag = savedState.isRunning;
                    if (this._persistedRunningFlag) {
                        console.log('[AutoScannerService] Loaded persisted state: Scanner was marked RUNNING in previous session.');
                    }
                }
                if (savedState.tradingMode === 'testnet' || savedState.tradingMode === 'live') {
                    this.state.tradingMode = savedState.tradingMode;
                    console.log(`[AutoScannerService] Loaded persisted state: Trading mode set to ${this.state.tradingMode.toUpperCase()}.`);
                } else if (savedState.tradingMode === 'demo') {
                    this.state.tradingMode = 'testnet';
                    console.log(`[AutoScannerService] Migrated persisted state: Demo mode converted to TESTNET mode.`);
                }

                // NEW: restore market regime state (streak)
                if (savedState.marketRegimeState) {
                    this.state.marketRegime = {
                        regime: savedState.marketRegimeState.regime || 'neutral',
                        confidence: typeof savedState.marketRegimeState.confidence === 'number'
                            ? savedState.marketRegimeState.confidence
                            : 0.5,
                        isConfirmed: !!savedState.marketRegimeState.isConfirmed,
                        consecutivePeriods: savedState.marketRegimeState.consecutivePeriods || 0,
                        confirmationThreshold: savedState.marketRegimeState.confirmationThreshold || 3,
                        regimeHistory: Array.isArray(savedState.marketRegimeState.regimeHistory)
                            ? savedState.marketRegimeState.regimeHistory
                            : []
                    };
                    // seed cache to avoid showing "awaiting" right on reload
                    this.regimeCache.regime = { ...this.state.marketRegime };
                    this.regimeCache.lastCalculated = Date.now();
                    console.log('[AutoScannerService] [Regime] Restored regime streak from previous session.');
                }

                // NEW: restore scan cycle statistics
                if (savedState.scanCycleStats) {
                    this.state.stats.totalScanCycles = savedState.scanCycleStats.totalScanCycles || 0;
                    this.state.stats.averageScanTimeMs = savedState.scanCycleStats.averageScanTimeMs || 0;
                    this.state.stats.lastScanTimeMs = savedState.scanCycleStats.lastScanTimeMs || 0;
                    this.state.stats.totalScans = savedState.scanCycleStats.totalScans || 0; // ADDED: Load totalScans
                    if (this.state.stats.totalScanCycles > 0) {
                        console.log(`[AutoScannerService] [CycleStats] Restored ${this.state.stats.totalScanCycles} scan cycles (${this.state.stats.totalScans} scans) from previous session (avg: ${(this.state.stats.averageScanTimeMs / 1000).toFixed(2)}s)`);
                    }
                }
            }
        } catch (error) {
            console.error('[AutoScannerService] Failed to load scanner state to localStorage.', error);
        }
    }

    addLog(message, type = 'info', data = null) {
        let msg = typeof message === 'string' ? message.replace(/\$undefined/g, '$0.00') : message;

        // Determine console method based on type
        let consoleMethod = console.log;
        let prefix = '[AutoScanner] ';
        if (type === 'error') {
            consoleMethod = console.error;
            prefix += 'ERROR: ';
        } else if (type === 'warning' || type === 'warn') {
            consoleMethod = console.warn;
            prefix += 'WARN: ';
        } else if (type === 'success' || type === 'start') {
            prefix += 'INFO: ';
        } else if (type === 'system' || type === 'info') {
            prefix += 'INFO: ';
        } else if (type === 'cycle') {
            prefix += 'CYCLE: ';
        } else if (type === 'regime_info') {
            prefix += 'REGIME_INFO: ';
        } else if (type === 'regime_confidence_filter') {
            prefix += 'REGIME_FILTER: ';
        } else if (type === 'trade_blocked') { // NEW: Handle trade_blocked type
            consoleMethod = console.warn;
            prefix += 'TRADE_BLOCKED: ';
        }
        else if (type === 'scan') {
            prefix += 'SCAN: ';
        } else {
            prefix += `${type.toUpperCase()}: `;
        }

        // CHANGED: do not spam browser console unless explicitly enabled or for errors
        if (this.debugConsole || type === 'error' || type === 'trade_blocked') {
            if (data) {
                consoleMethod(`${prefix}${msg}`, data);
            } else {
                consoleMethod(`${prefix}${msg}`);
            }
        }

        let sanitizedData = null;

        if (data && typeof data === 'object') {
            sanitizedData = {};

            const safeProps = ['strategy', 'level', 'error', 'symbol', 'strength', 'conviction_score', 'combined_strength', 'settings', 'keys', 'reason']; // Added 'reason'
            safeProps.forEach(prop => {
                if (data[prop] !== undefined) {
                    if (typeof data[prop] === 'string' || typeof data[prop] === 'number' || typeof data[prop] === 'boolean') {
                        sanitizedData[prop] = data[prop];
                    } else if (prop === 'settings' && Array.isArray(data[prop])) {
                        sanitizedData[prop] = data[prop].map(s => ({ type: s.type, enabled: s.enabled, period: s.period }));
                    } else if (prop === 'keys' && Array.isArray(data[prop])) {
                        sanitizedData[prop] = data[prop];
                    }
                }
            });

            if (data.strategy && typeof data.strategy === 'object' && data.strategy.combinationName) {
                sanitizedData.strategy = data.strategy.combinationName;
            }

            if (Object.keys(sanitizedData).length === 0) {
                sanitizedData = null;
            }
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            message: msg,
            type,
            data: sanitizedData
        };

        this.state.logs.activity.unshift(logEntry);

        if (this.state.logs.activity.length > 1000) {
            this.state.logs.activity = this.state.logs.activity.slice(0, 1000);
        }

        this.notifySubscribers();
    }

    clearLogs() {
        this.state.logs.activity = [];
        console.log('[AutoScannerService] Logs cleared by user.');
    }

    forceResetState() {
        console.log('[AutoScannerService] 🚨 [CRITICAL] Forcing a complete state reset of the scanner service.');
        this.isHardResetting = true;

        this.stop();

        // NEW: clear persisted storage entirely
        if (typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(`walletSummaryCache_testnet`);
            localStorage.removeItem(`walletSummaryCache_live`);
        }

        this.state = {
            isInitialized: false,
            isInitializing: false,
            isRunning: false,
            isScanning: false,
            settings: null,
            activeStrategies: [],
            marketRegime: null,
            performanceMomentumScore: null,
            momentumBreakdown: null,
            signalGenerationHistory: [],
            marketVolatility: { adx: 25, bbw: 0.1 },
            logs: { activity: [], performance: [] },
            stats: {
                activeStrategies: 0,
                totalScans: 0,
                signalsFound: 0,
                tradesExecuted: 0,
                totalPnL: 0,
                averageSignalStrength: 0,
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            },
            lastScanTime: null,
            nextScanTime: null,
            recentTradesForMomentum: [],
            tradingMode: 'testnet',
            liveWalletState: null,
            exchangeInfo: null,
            leaderSessionId: null,
            fearAndGreedData: null,
            marketAlerts: [],
            newPositionsCount: 0,
            adjustedBalanceRiskFactor: 100,
        };

        this.currentPrices = {};
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;
        this._persistedRunningFlag = false; // Reset this too on hard reset
        this._isAutoStartBlocked = false; // Reset this too on hard reset
        this.scanCycleTimes = []; // Reset scan cycle times on hard reset
        this._openGuardAttached = false; // Reset the guard flag

        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.scanInterval = null;
        this.countdownInterval = null;

        this.sessionManager.stopMonitoring();
        this.heartbeatService.stop();
        this.performanceMetricsService.resetState();
        // UPDATED: Reset TradeArchivingService state
        this.tradeArchivingService.resetState();

        this._loadStateFromStorage();

        console.log('[AutoScannerService] ✅ Scanner service state has been fully reset.');
        this.notifySubscribers();
        this.notifyWalletSubscribers();

        setTimeout(() => {
            this.isHardResetting = false;
        }, 500);
    }

    async initialize() {
        if (this.state.isInitializing) {
            console.warn('[AutoScannerService] Initialization already in progress.');
            return false;
        }

        if (this.state.isInitialized && !this._persistedRunningFlag && !this._isAutoStartBlocked) {
            console.log('[AutoScannerService] Already initialized. Skipping re-initialization.');
            return true;
        }

        this.state.isInitializing = true;
        console.log(`[AutoScannerService] Initializing scanner in ${this.state.tradingMode.toUpperCase()} mode...`);
        this.notifySubscribers();

        try {
            // Step 1: Load configuration
            await this.configurationService.loadConfiguration();
            console.log('[AutoScannerService] ✅ Configuration loaded.');

            // Step 2: Load exchange info (CRITICAL for position sizing/validation)
            this.state.exchangeInfo = await this._loadExchangeInfo();

            // Step 3: Initialize wallet (with robust error handling)
            console.log(`[AutoScannerService] 🔄 Syncing ${this.state.tradingMode.toUpperCase()} wallet with Binance API...`);

            try {
                await this.walletManagerService.initializeLiveWallet();
                console.log(`[AutoScannerService] ✅ Successfully synced ${this.state.tradingMode.toUpperCase()} wallet with Binance`);
            } catch (binanceError) {
                console.error(`[AutoScannerService] ❌ Failed to sync with Binance: ${binanceError.message}`);
                console.warn(`[AutoScannerService] 📂 Attempting to load existing wallet state from database as fallback...`);

                const existingWallets = await queueEntityCall('LiveWalletState', 'filter', { mode: this.state.tradingMode });

                if (existingWallets && existingWallets.length > 1) {
                    console.warn(`[AutoScannerService] 🧹 Found ${existingWallets.length} duplicate ${this.state.tradingMode.toUpperCase()} wallets. Using the most recent one.`);
                    existingWallets.sort((a, b) => new Date(b.last_updated_timestamp || 0) - new Date(a.last_updated_timestamp || 0));
                }

                if (existingWallets && existingWallets.length > 0) {
                    this.state.liveWalletState = existingWallets[0];
                    if (!Array.isArray(this.state.liveWalletState.positions)) {
                        this.state.liveWalletState.positions = [];
                        console.warn(`[AutoScannerService] [${this.state.tradingMode.toUpperCase()}_WALLET] ⚠️ Initialized missing positions array from fallback`);
                    }
                    console.log(`[AutoScannerService] ✅ Using existing ${this.state.tradingMode.toUpperCase()} wallet from database (ID: ${this.state.liveWalletState.id})`);
                } else {
                    throw new Error(`Cannot initialize scanner: No Binance connection and no existing wallet state found for ${this.state.tradingMode} mode.`);
                }
            }

            // Step 4: Start session monitoring (CRITICAL for leader election)
            this.sessionManager.startMonitoring();

            // Always enforce mode on wallet state BEFORE loading managed positions
            if (this.state.liveWalletState && !this.state.liveWalletState.mode) {
                this.state.liveWalletState.mode = this.state.tradingMode || 'testnet';
            }

            // Step: Load managed positions after ensuring mode is set
            this.addLog(`[PositionManager] 🔧 Ensuring wallet mode is set (${this.state.liveWalletState?.mode}) before loading managed state.`, 'system');
            await this.positionManager.loadManagedState(this.state.liveWalletState);
            console.log(`[AutoScannerService] ✅ Loaded ${this.positionManager.positions.length} open positions`);

            // Ensure the guard is attached after PositionManager is fully set up
            this.attachRegimeOpenGuard();

            // Step 6: Load initial momentum trades
            await this.performanceMetricsService.loadInitialMomentumTrades();

            // Step 7: Load and filter strategies
            console.log('[AutoScannerService] 📋 Loading active strategies...');
            const loadedStrategies = await this._loadStrategies();
            console.log(`[AutoScannerService] ✅ Loaded ${loadedStrategies.length} strategies`);

            // Step 8: Fetch initial prices (now that strategies are loaded to know which symbols are relevant)
            console.log('[AutoScannerService] 📊 Fetching initial prices...');
            await this._consolidatePrices();
            const priceCount = Object.keys(this.currentPrices || {}).length;
            console.log(`[AutoScannerService] ✅ Fetched prices for ${priceCount} symbols.`);

            // Step 9: Update wallet summary (now with current prices)
            console.log('[AutoScannerService] 🔄 Initial wallet summary calculation...');
            await this.walletManagerService.updateWalletSummary(this.state.liveWalletState, this.currentPrices);

            // NEW: Log wallet summary after initial calculation (from outline)
            const summary = this.walletManagerService.walletSummary;
            if (summary) {
                // Keep the addLog but remove console.log, as per instruction to clean debug logs
            }
            console.log('[AutoScannerService] ✅ Wallet summary updated');

            // Step 10: Persist latest wallet summary
            await this._persistLatestWalletSummary();
            console.log('[AutoScannerService] ✅ Wallet summary persisted');

            // Step 11: Calculate market regime
            await this._getCachedOrCalculateRegime(true);

            // Step 12: Calculate performance momentum (uses current prices and wallet state)
            await this.performanceMetricsService.calculatePerformanceMomentum();

            this.notifySubscribers();

            // CRITICAL: Mark as initialized ONLY after ALL async operations complete
            this.state.isInitialized = true;
            console.log(`[AutoScannerService] ✅ Initialization complete in ${this.state.tradingMode.toUpperCase()} mode. Loaded ${loadedStrategies.length} strategies.`);

            // Auto-start logic (if needed and not blocked)
            if (this._persistedRunningFlag && !this.isNavigating && !this._isAutoStartBlocked) {
                console.log('[AutoScannerService] 🔄 Resuming scanner from previous session (claiming leadership)...');
                this.start();
                this._persistedRunningFlag = false; // Reset after attempt to start
            }

            return true;
        } catch (error) {
            console.error(`[AutoScannerService] ❌ Initialization failed: ${error.message}`, error);
            this.state.error = error.message;
            this._persistedRunningFlag = false; // Ensure this is reset on failure
            this.state.isInitialized = false; // Ensure state is not initialized on failure
            return false;
        } finally {
            this.state.isInitializing = false;
            this.notifySubscribers();
        }
    }

    async _loadExchangeInfo() {
        console.log('[AutoScannerService] [EXCHANGE_INFO] 📋 _loadExchangeInfo() called');
        const MAX_RETRIES = 3;
        let attempt = 0;
        let lastError = null;

        while (attempt < MAX_RETRIES) {
            attempt++;
            console.log(`[AutoScannerService] [EXCHANGE_INFO] 🔄 Attempt ${attempt}/${MAX_RETRIES} to load exchange info`);

            try {
                const proxyUrl = this.state.settings?.local_proxy_url;
                console.log(`[AutoScannerService] [EXCHANGE_INFO] Proxy URL from settings: ${proxyUrl || 'NOT SET'}`);

                if (!proxyUrl) {
                    console.error('[AutoScannerService] [EXCHANGE_INFO] ❌ Proxy URL not configured in settings.');
                    // If proxy URL is fundamentally missing, no point in retrying.
                    return null;
                }

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 🌐 Calling liveTradingAPI with action: getExchangeInfo, mode: ${this.state.tradingMode}`);

                const requestParams = {
                    action: 'getExchangeInfo',
                    tradingMode: this.state.tradingMode, // Preserve original parameter
                    proxyUrl: proxyUrl
                };

                const response = await queueFunctionCall(
                    liveTradingAPI,
                    requestParams,
                    'critical',
                    `exchangeInfo.${this.state.tradingMode}`, // Preserve original cache key
                    300000, // Preserve original cache time
                    30000   // Preserve original 30 second timeout
                );

                if (!response?.data?.success) {
                    const errorMsg = response?.data?.message || response?.data?.error || 'Unknown error from liveTradingAPI';
                    throw new Error(errorMsg);
                }

                if (!response.data.data?.success) {
                    const proxyError = response.data.data?.message || response.data.data?.error || 'Unknown proxy error';
                    throw new Error(proxyError);
                }

                const exchangeInfoData = response.data.data.data;

                if (!exchangeInfoData || !Array.isArray(exchangeInfoData.symbols)) {
                    throw new Error('Invalid exchange info structure');
                }

                console.log(`[AutoScannerService] [EXCHANGE_INFO] 📊 Exchange info structure:`, {
                    hasSymbols: !!exchangeInfoData.symbols,
                    symbolCount: exchangeInfoData.symbols.length,
                    sampleSymbol: exchangeInfoData.symbols[0]?.symbol
                });


                // Transform the array of symbols into a map for easier lookup (preserving original structure)
                const infoMap = exchangeInfoData.symbols.reduce((acc, symbol) => {
                    acc[symbol.symbol] = {
                        status: symbol.status,
                        filters: symbol.filters.reduce((filterAcc, filter) => {
                            filterAcc[filter.filterType] = filter;
                            return filterAcc;
                        }, {})
                    };
                    return acc;
                }, {});

                this.state.exchangeInfo = infoMap;
                console.log(`[AutoScannerService] [EXCHANGE_INFO] ✅ Successfully loaded and mapped exchange info for ${Object.keys(infoMap).length} symbols`);

                return infoMap; // Return the processed map

            } catch (error) {
                lastError = error; // Store the last error
                console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Attempt ${attempt} failed: ${error.message}`);

                if (attempt < MAX_RETRIES) {
                    const delayMs = attempt * 2000;
                    console.log(`[AutoScannerService] [EXCHANGE_INFO] Waiting ${delayMs}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                } else {
                    console.error(`[AutoScannerService] [EXCHANGE_INFO] ❌ Unable to load exchange info after ${MAX_RETRIES} retries: ${lastError?.message}`);
                }
            }
        }

        // If loop finishes (all retries exhausted), return null as per original behavior
        return null;
    }

    getExchangeInfo() {
        return this.state.exchangeInfo;
    }

    async start() {
        console.log('[AutoScannerService] start() called');
        console.log('[AutoScannerService] Attempting to start scanner and claim leadership...');
        const result = await this.sessionManager.start();
        if (result) {
            console.log('[AutoScannerService] Scanner started successfully');
        } else {
            console.warn('[AutoScannerService] Scanner start failed or leadership not claimed.');
        }
        return result;
    }

    async stop() {
        console.log('[AutoScannerService] stop() called');
        console.log('[AutoScannerService] Attempting to stop scanner and release leadership...');
        const result = await this.sessionManager.stop();
        if (result) {
            console.log('[AutoScannerService] Scanner stopped successfully');
        } else {
            console.warn('[AutoScannerService] Scanner stop failed.');
        }
        return result;
    }

    forceStop() {
        console.log('[AutoScannerService] Initiating force stop and leadership release...');
        return this.sessionManager.forceStop();
    }

    restart() {
        console.log('[AutoScannerService] 🔄 Restarting scanner...');

        try {
            this.stop();

            return new Promise(resolve => setTimeout(async () => {
                this.state.stats.totalScans = 0;
                this.state.stats.totalScanCycles = 0; // Reset total scan cycles on restart
                this.scanCycleTimes = []; // Reset cycle times on restart

                const initResult = await this.initialize();
                if (!initResult) {
                    console.error('[AutoScannerService] ❌ Failed to initialize scanner during restart.');
                    resolve(false);
                    return;
                }

                const startResult = await this.start();

                if (startResult) {
                    console.log('[AutoScannerService] ✅ Scanner restarted successfully.');
                } else {
                    console.error('[AutoScannerService] ❌ Failed to start scanner after initialization during restart.');
                }
                resolve(startResult);
            }, 500));
        } catch (error) {
            console.error(`[AutoScannerService] ❌ Error during scanner restart: ${error.message}`, error);
            return Promise.resolve(false);
        }
    }

    _startScanLoop() {
        this.scanCycle().catch(e => {
            console.error(`[AutoScannerService] Initial scan failed: ${e.message}`, e);
        });
    }

    _startCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        if (!this.state.isRunning || this.state.isScanning) {
            return;
        }

        const scanFrequency = this.state.settings?.scanFrequency || 60000;
        this.state.nextScanTime = Date.now() + scanFrequency;

        console.log(`[AutoScannerService] ⏰ Next scan in ${Math.round(scanFrequency / 1000)} seconds...`);

        this.notifySubscribers();

        this.countdownInterval = setInterval(() => {
            if (!this.state.isRunning || this.state.isScanning) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.state.nextScanTime = null;

                this.notifySubscribers();
                return;
            }

            if (this.state.nextScanTime && Date.now() >= this.state.nextScanTime) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.state.nextScanTime = null;

                this.scanCycle().catch(e => {
                    console.error(`[AutoScannerService] Scan cycle error: ${e.message}`, e);
                });
                return;
            }

            this.notifySubscribers();
        }, 1000);
    }

    async _fetchFearAndGreedIndex() { // Marked async to allow await
        const now = Date.now();
        if (now - this.lastFearAndGreedFetch < this.fearAndGreedFetchInterval) {
            return;
        }
        this.lastFearAndGreedFetch = now;

        try {
            const response = await queueFunctionCall(getFearAndGreedIndex, {}, 'low', 'fearAndGreedIndex', 300000, 30000);
            if (response.data && response.data.data && response.data.data.length > 0) {
                // Store in both locations for compatibility
                this.fearAndGreedData = response.data.data[0];
                this.state.fearAndGreedData = response.data.data[0];

                if (this.fearAndGreedFailureCount > 0) {
                    console.log('[AutoScannerService] [F&G Index] ✅ Successfully reconnected to Fear & Greed API');
                    this.fearAndGreedFailureCount = 0;
                }

                // Notify subscribers of state change
                this.notifySubscribers();
            }
        } catch (error) {
            this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;

            if (this.fearAndGreedFailureCount === 1) {
                console.warn('[AutoScannerService] [F&G Index] ⚠️ Unable to fetch Fear & Greed Index - continuing without it');
            } else if (this.fearAndGreedFailureCount === 5) {
                console.warn('[AutoScannerService] [F&G Index] ⚠️ Multiple F&G fetch failures - will retry silently');
            }

            // Store fallback in both locations
            const fallback = { value: '50', value_classification: 'Neutral (Fallback)' };
            this.fearAndGreedData = fallback;
            this.state.fearAndGreedData = fallback;

            // Notify subscribers of state change
            this.notifySubscribers();
        }
    }


    // REPLACED: Legacy method removed from AutoScannerService.
    // All monitoring/closing is handled by PositionManager.monitorAndClosePositions.
    monitorAndClosePositions() {
        console.log('[AutoScannerService] [DEPRECATION] monitorAndClosePositions in AutoScannerService is deprecated; handled by PositionManager.monitorAndClosePositions.');
        return;
    }

    // REPLACED: Legacy method removed from AutoScannerService.
    // Trailing stop updates are handled by PositionManager.
    _updateTrailingStops(prices) {
        console.log('[AutoScannerService] [DEPRECATION] _updateTrailingStops in AutoScannerService is deprecated; handled by PositionManager.');
        return;
    }

    async scanCycle() {
        console.log('[AutoScannerService] ===== SCAN CYCLE START =====');

        if (!this.state.isRunning) {
            console.warn('[AutoScannerService] Scan cycle aborted: Scanner is not running.');
            this.state.isScanning = false;
            return;
        }

        if (this.isHardResetting) {
            console.warn('[AutoScannerService] Scan cycle aborted due to hard reset.');
            this.state.isScanning = false;
            return;
        }

        if (this.state.isScanning) {
            console.warn('[AutoScannerService] ⚠️ Scan already in progress, skipping this cycle.');
            return;
        }

        this.state.isScanning = true;
        this.notifySubscribers(); // Notify UI that scanning has started

        const cycleStartTime = Date.now();
        let phaseTimings = {};

        this.state.lastScanTime = Date.now();
        this.state.stats.totalScans++; // Increment total scans for this tab instance
        this.state.stats.lastScanStartTime = new Date().toISOString();
        this.state.nextScanTime = null;
        this.state.newPositionsCount = 0; // Reset new positions count for this cycle

        console.log(`[AutoScannerService] [SCAN_CYCLE] 🔄 Starting scan cycle #${this.state.stats.totalScanCycles + 1}`);

        console.log(`[AutoScannerService] 🔄 Starting new scan cycle #${this.state.stats.totalScanCycles + 1}...`);
        this.notifySubscribers();

        let cycleStats = {
            combinationsEvaluated: 0,
            combinationsMatched: 0,
            positionsOpened: 0,
            positionsBlocked: [],
            marketRegime: this.state.marketRegime ? { ...this.state.marketRegime } : null,
            strategiesProcessed: 0,
            strategiesSkipped: 0,
            skipReasons: {},
            blockReasons: {}
        };

        try {
            // NEW: Pre-scan leadership check
            if (this.state.isRunning) {
                const hasLeadership = await this.sessionManager.verifyLeadership();
                if (!hasLeadership) {
                    console.warn('[AutoScannerService] ⚠️ Lost leadership during scan - another tab is now active. Stopping scanner.');
                    this.stop();
                    return;
                }
            }

            await this.positionManager.waitForWalletSave(60000);

            // PHASE 1: Market Regime Detection & F&G Index
            const regimeStartTime = Date.now();
            console.log('[AutoScannerService] 🌡️ Detecting market regime and fetching F&G Index...');
            const regimeData = await this._detectMarketRegime();
            phaseTimings.regimeDetection = Date.now() - regimeStartTime;

            if (!regimeData) {
                console.error('[AutoScannerService] ❌ Failed to detect market regime, skipping cycle.');
                this.state.isScanning = false;
                this.notifySubscribers();
                return;
            }

            const { regime, confidence } = regimeData;
            console.log(`[AutoScannerService] 📊 Market Regime: ${regime.toUpperCase()} (${confidence.toFixed(1)}% confidence)`);
            cycleStats.marketRegime = this.state.marketRegime ? { ...this.state.marketRegime } : null;

            if (confidence < this.state.settings.minimumRegimeConfidence) {
                console.warn(`[AutoScannerService] ⚠️ Regime confidence ${confidence.toFixed(1)}% below threshold (${this.state.settings.minimumRegimeConfidence}%). Skipping strategy evaluation.`);
                this.state.isScanning = false;
                this.notifySubscribers();
                return;
            }

            // PHASE 2: Price Fetching
            const priceStartTime = Date.now();
            console.log('[AutoScannerService] 💰 Fetching current prices for strategies and positions...');
            await this._consolidatePrices();
            phaseTimings.priceFetching = Date.now() - priceStartTime;


            // PHASE 3: Position Monitoring and Reconciliation
            const monitoringStartTime = Date.now();
            console.log('[AutoScannerService] 👀 Monitoring open positions and reconciling...');
            await this._monitorPositions(cycleStats);
            phaseTimings.positionMonitoring = Date.now() - monitoringStartTime;


            if (this.isHardResetting) {
                console.warn('[AutoScannerService] Cycle aborted after position monitoring.');
                this.state.isScanning = false;
                this.notifySubscribers();
                return;
            }

            // NEW: Single summary check to avoid strategy evaluation when funds below minimum
            const availableUsdt = this._getAvailableUsdt();
            const minTrade = this.state?.settings?.minimumTradeValue || 10;

            if (availableUsdt < minTrade) {
                this.addLog(
                    `[FUNDS] Free balance ${this._formatCurrency(availableUsdt)} is below minimum trade size ${this._formatCurrency(minTrade)}. Skipping new position search this cycle.`,
                    'info'
                );

                // Continue with maintenance tasks but skip strategy evaluation
                // PHASE 6: Trade Archiving
                const archivingStartTime = Date.now();
                await this._archiveOldTradesIfNeeded();
                // PHASE 7: Performance Snapshot & Wallet Update
                const snapshotStartTime = Date.now();
                await this._updatePerformanceSnapshotIfNeeded(cycleStats);

                // Emit end-of-cycle summary before exiting this cycle early
                await this._logCycleSummary(cycleStats);

                // finalize (rest of scanCycle will handle timers/stats)
                return;
            }

            // NEW: Enforce absolute invest cap before loading strategies
            const capUsdt = Number(this.state?.settings?.maxBalanceInvestCapUSDT || 0);
            if (capUsdt > 0) {
                const allocatedNow = this._getBalanceAllocatedInTrades();
                if (allocatedNow >= capUsdt) {
                    this.addLog(
                        `[FUNDS] Max invest cap reached: allocated ${this._formatCurrency(allocatedNow)} ≥ cap ${this._formatCurrency(capUsdt)}. Skipping new position search this cycle.`,
                        'warning'
                    );
                    // Continue with maintenance tasks but skip strategy evaluation
                    const archivingStartTime = Date.now();
                    await this._archiveOldTradesIfNeeded();
                    const snapshotStartTime = Date.now();
                    await this._updatePerformanceSnapshotIfNeeded(cycleStats);
                    await this._logCycleSummary(cycleStats);
                    return;
                }
            }


            // PHASE 4: Strategy Loading
            const strategyLoadStartTime = Date.now();
            console.log('[AutoScannerService] 📋 Loading active strategies...');
            const strategies = await this._loadStrategies();
            console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} strategies`);
            phaseTimings.strategyLoading = Date.now() - strategyLoadStartTime;

            if (!strategies || strategies.length === 0) {
                console.warn('[AutoScannerService] ⚠️ No active strategies found');
                this.state.isScanning = false;
                this.notifySubscribers();
                return;
            }
            console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} active strategies`);

            // PHASE 5: Strategy Evaluation & Signal Detection
            const evaluationStartTime = Date.now();
            console.log('[AutoScannerService] 🔍 Evaluating strategies and detecting signals...');
            // Call the modified _evaluateStrategies (which now delegates to StrategyManagerService)
            const scanResult = await this._evaluateStrategies(
                strategies,
                this.state.liveWalletState,
                this.state.settings,
                this.state.marketRegime,
                this.currentPrices,
                cycleStats
            );
            phaseTimings.strategyEvaluation = Date.now() - evaluationStartTime;

            if (this.isHardResetting) {
                console.warn('[AutoScannerService] Cycle aborted after signal detection.');
                this.state.isScanning = false;
                this.notifySubscribers();
                return;
            }

            // PHASE 6: Trade Archiving
            const archivingStartTime = Date.now();
            console.log('[AutoScannerService] 📦 Archiving old trades...');
            await this._archiveOldTradesIfNeeded();
            phaseTimings.tradeArchiving = Date.now() - archivingStartTime;

            // PHASE 7: Performance Snapshot & Wallet Update
            const snapshotStartTime = Date.now();
            console.log('[AutoScannerService] 📈 Updating performance metrics and wallet state...');
            await this._updatePerformanceSnapshotIfNeeded(cycleStats);
            phaseTimings.performanceSnapshot = Date.now() - snapshotStartTime;

            const summaryMessage = `✅ Scan cycle complete: ${scanResult.signalsFound} signals found, ${scanResult.tradesExecuted} trades executed.`;
            console.log(`[AutoScannerService] ${summaryMessage}`);

            // Emit end-of-cycle summary logs (wallet snapshot, metrics, blocked reasons, etc.)
            await this._logCycleSummary(cycleStats);

        } catch (error) {
            const isCriticalError = error.message && (
                error.message.includes('database') ||
                error.message.includes('initialization') ||
                error.message.includes('configuration') ||
                (error.message.includes('network') && !error.message.includes('insufficient balance'))
            );

            if (isCriticalError) {
                console.error(`[AutoScannerService] 💥 CRITICAL ERROR in scan cycle: ${error.message}`, error);
                console.error(`[AutoScannerService] 🛑 STOPPING SCANNER due to critical error. Stack trace: ${error.stack}`);

                this.stop();

                if (this.toast) {
                    this.toast({
                        title: "Scanner Stopped - Critical Error",
                        description: `Scanner has been stopped due to critical error: ${error.message}`,
                        variant: "destructive"
                    });
                }

                console.error(`[AutoScannerService] 🔴 Scanner has been STOPPED due to critical error. Please review the error and manually restart if needed.`);
            } else {
                console.warn(`[AutoScannerService] ⚠️ Non-critical error in scan cycle: ${error.message}. Scanner will continue.`, error);
            }
            this.state.error = error.message;
            this.state.errorSource = 'scanCycle';
        } finally {
            // Update stats
            const scanDuration = Date.now() - cycleStartTime;
            this.state.stats.totalScanCycles++;
            this.state.stats.lastScanTimeMs = scanDuration;

            // Update rolling average
            if (this.state.stats.averageScanTimeMs === 0) {
                this.state.stats.averageScanTimeMs = scanDuration;
            } else {
                this.state.stats.averageScanTimeMs = (this.state.stats.averageScanTimeMs * 0.8) + (scanDuration * 0.2);
            }

            console.log(`[AutoScannerService] ⏱️ Scan cycle completed in ${(scanDuration / 1000).toFixed(2)}s (avg: ${(this.state.stats.averageScanTimeMs / 1000).toFixed(2)}s)`, { duration: scanDuration });

            // NEW: Persist updated stats to localStorage immediately after cycle completion
            this._saveStateToStorage();

            this.state.isScanning = false;

            // NEW: Notify subscribers immediately after stats update to ensure UI reflects changes
            this.notifySubscribers();

            if (this.state.isRunning) {
                try {
                    await this.sessionManager.claimLeadership();
                } catch (heartbeatError) {
                    console.warn(`[AutoScannerService] ⚠️ Post-scan heartbeat failed: ${heartbeatError.message}`);
                }
            }

            if (this.state.isRunning && !this.isHardResetting) {
                this._startCountdown();
            } else {
                console.log('[AutoScannerService] Not starting new countdown as scanner is stopped or resetting.');
            }

            // Final notification at end of cycle
            this.notifySubscribers();
            console.log('[AutoScannerService] ===== SCAN CYCLE COMPLETE =====');
        }
    }


    /**
     * Helper method to detect market regime and fetch F&G index.
     * @returns {object|null} An object containing regime and confidence, or null on failure.
     */
    async _detectMarketRegime() {
        if (this.isHardResetting) return null;

        try {
            const cachedRegime = await this._getCachedOrCalculateRegime(); // This updates this.state.marketRegime
            await this._fetchFearAndGreedIndex(); // This updates this.state.fearAndGreedData

            if (this.state.marketRegime) {
                return {
                    regime: this.state.marketRegime.regime,
                    confidence: Math.max(0, Math.min(100, this.state.marketRegime.confidence * 100)) // Return as percentage, clamped
                };
            }
            return null;
        } catch (error) {
            console.error(`[AutoScannerService] [Regime Detection] ❌ Failed to determine market regime or F&G: ${error.message}`, error);
            return null;
        }
    }

    /**
     * Helper method to consolidate and fetch prices for all relevant symbols.
     */
    async _consolidatePrices() {
        if (this.isHardResetting) return;

        try {
            const allRequiredSymbols = new Set();
            // fiatCurrencies list from outline
            const fiatCurrencies = new Set(['EUR', 'TRY', 'ZAR', 'GBP', 'AUD', 'BRL', 'JPY', 'RUB', 'UAH', 'NGN', 'PLN', 'RON', 'ARS', 'INR']);

            // Define minimum thresholds to reduce API calls for dust
            const MIN_BALANCE_THRESHOLD = 0.001; // Minimum token quantity to consider
            const ESTIMATED_MIN_VALUE_USD = 0.10; // Estimated minimum USD value (very conservative)

            // 1. Collect symbols from active strategies
            if (this.state.activeStrategies && this.state.activeStrategies.length > 0) {
                this.state.activeStrategies.forEach(strategy => {
                    if (strategy.coin) {
                        allRequiredSymbols.add(strategy.coin.replace('/', '')); // Keep .replace('/', '')
                    }
                });
            }

            // 2. Collect symbols from open positions (using PositionManager as source of truth)
            if (this.positionManager.positions && this.positionManager.positions.length > 0) {
                this.positionManager.positions.forEach(pos => {
                    if (pos.symbol && (pos.status === 'open' || pos.status === 'trailing')) {
                        allRequiredSymbols.add(pos.symbol.replace('/', '')); // Keep .replace('/', '')
                    }
                });
            }

            // 3. Collect symbols from wallet balances (with dust threshold)
            let balancesWithAmountCount = 0; // for logging
            let dustAssetsSkipped = 0;
            if (this.state.liveWalletState && this.state.liveWalletState.balances) {
                this.state.liveWalletState.balances.forEach(balance => {
                    // Check if asset is not USDT and not a fiat currency (case-insensitive check)
                    if (balance.asset && balance.asset !== 'USDT' && !fiatCurrencies.has(balance.asset.toUpperCase())) {
                        const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);

                        // Apply dust threshold: skip extremely small balances
                        if (total > MIN_BALANCE_THRESHOLD) {
                            const symbol = balance.asset + 'USDT';
                            allRequiredSymbols.add(symbol);
                            balancesWithAmountCount++;
                        } else if (total > 0) {
                            dustAssetsSkipped++;
                        }
                    }
                });
            }

            // 4. Ensure BTCUSDT is always fetched as a baseline, if not already included.
            allRequiredSymbols.add('BTCUSDT');

            const symbolsArray = Array.from(allRequiredSymbols);

            console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 📊 Preparing to fetch prices for ${symbolsArray.length} symbols.`);

            if (dustAssetsSkipped > 0) {
                console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 🗑️ Skipped ${dustAssetsSkipped} dust assets (< $${ESTIMATED_MIN_VALUE_USD} estimated).`);
            }


            if (symbolsArray.length === 0) {
                console.warn(`[AutoScannerService] [PRICE_CONSOLIDATION] ⚠️ No symbols required for strategy analysis, positions, or significant wallet balances.`);
                this.currentPrices = {};
                return;
            }

            const response = await queueFunctionCall(
                getBinancePrices,
                { symbols: symbolsArray },
                'critical', // As per outline
                null,
                0,
                30000
            );

            // Access response.data.data as per actual getBinancePrices structure
            if (response && response.data && Array.isArray(response.data.data)) {
                // Convert array of price objects to a map: { symbol: price }
                const pricesMap = {};
                let validPriceCount = 0;

                response.data.data.forEach(item => { // Iterate response.data.data
                    if (item.symbol && typeof item.price === 'number' && item.price > 0 && !item.error) {
                        pricesMap[item.symbol.replace('/', '')] = item.price; // Keep .replace('/', '')
                        validPriceCount++;
                    }
                });

                this.currentPrices = pricesMap;
                console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] ✅ Fetched prices for ${Object.keys(this.currentPrices).length} symbols.`);

                if (validPriceCount < symbolsArray.length) {
                    const missingCount = symbolsArray.length - validPriceCount;
                    console.warn(`[AutoScannerService] [PRICE_CONSOLIDATION] ⚠️ ${missingCount} symbols did not return valid prices.`);
                }
            } else {
                console.error('[AutoScannerService] [PRICE_CONSOLIDATION] ❌ Strategic price fetch failed or returned invalid data. Current prices reset.');
                this.currentPrices = {};
            }

        } catch (error) {
            console.error('[AutoScannerService] ❌ Error consolidating prices:', error);
            console.error(`[AutoScannerService] [PRICE_CONSOLIDATION] ❌ Failed to fetch prices: ${error.message}`, error);
            this.currentPrices = {}; // Clear prices to prevent using stale data
            throw error; // Re-throw to indicate a critical step failed
        }
    }

    /**
     * Helper method to load active strategies.
     * In a normal scan cycle, this simply returns the strategies already loaded into state.
     * @returns {Array} List of active strategies.
     */
    async _loadStrategies() {
        console.log('[AutoScannerService] 📋 Loading strategies...');

        const strategies = await this.strategyManager.loadActiveStrategies(this.state.tradingMode);

        // CRITICAL FIX: Build activeStrategies map for PositionManager lookups
        const activeStrategiesMap = new Map();
        strategies.forEach(strategy => {
            if (strategy.combinationName) {
                activeStrategiesMap.set(strategy.combinationName, strategy);
            }
        });

        // CRITICAL: Ensure PositionManager has access to the activeStrategies map
        if (this.positionManager) {
            this.positionManager.activeStrategies = activeStrategiesMap;
            console.log(`[AutoScannerService] ✅ Updated PositionManager with ${activeStrategiesMap.size} strategies`);
        }

        // Fix: Ensure SignalDetectionEngine is updated with the latest strategies
        if (this.signalDetectionEngine && typeof this.signalDetectionEngine.updateStrategies === 'function') {
            this.signalDetectionEngine.updateStrategies(strategies);
            console.log(`[AutoScannerService] ✅ Updated SignalDetectionEngine with ${strategies.length} strategies`);
        }

        console.log(`[AutoScannerService] ✅ Loaded ${strategies.length} strategies`);

        return strategies;
    }

    /**
     * Helper method for position monitoring, reconciliation, and executing queued orders.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _monitorPositions(cycleStats) {
        if (this.isHardResetting) return;

        console.log('[AutoScannerService] [MONITOR] 🔍 Monitoring open positions...');

        const monitorResult = await this.positionManager.monitorAndClosePositions(this.currentPrices);

        if (monitorResult.tradesToCreate.length > 0) {
            console.log(`[AutoScannerService] [MONITOR] 💰 ${monitorResult.tradesToCreate.length} position(s) ready to close`);
        }

        // CRITICAL FIX: executeBatchOpen doesn't exist - positions are opened in _evaluateStrategies
        // Only refresh wallet if trades were closed (not opened here)
        const tradesWereClosed = (monitorResult?.tradesToCreate.length > 0);

        if (tradesWereClosed) {
            console.log('[AutoScannerService] [MONITOR] 🔄 Refreshing wallet state after trade execution...');

            try {
                // Step 1: Sync with Binance to get latest balances
                await this.walletManagerService.initializeLiveWallet();

                // Step 2: Recalculate wallet summary with fresh data
                await this.walletManagerService.updateWalletSummary(
                    this.state.liveWalletState,
                    this.currentPrices
                );

                // Step 3: Persist to localStorage for immediate UI access
                await this._persistLatestWalletSummary();

                // Step 4: Notifying UI components
                this.notifyWalletSubscribers();

                console.log('[AutoScannerService] [MONITOR] ✅ Wallet state refreshed successfully');
            } catch (refreshError) {
                console.error('[AutoScannerService] ❌ Failed to refresh wallet after trades:', refreshError);
                console.warn(`[AutoScannerService] [MONITOR] ⚠️ Wallet refresh warning: ${refreshError.message}`);
            }
        }

        const currentWalletState = this.state.liveWalletState;
        const usdtBalanceObject = (currentWalletState?.balances || []).find(b => b.asset === 'USDT');
        const availableUsdt = parseFloat(usdtBalanceObject?.free || '0');
        const lockedUsdt = parseFloat(usdtBalanceObject?.locked || '0');
        // CRITICAL FIX: Get actual open positions count from PositionManager's internal cache
        const walletPositionsCount = this.positionManager.positions.length;

        console.log(`[AutoScannerService] 💰 Using ${this.state.tradingMode.toUpperCase()} wallet state. USDT Balance: ${this._formatCurrency(availableUsdt)} | Positions: ${walletPositionsCount}`);

        // Run full reconciliation every 5 scans
        if (this.state.stats.totalScans % 5 === 0 && this.state.stats.totalScans > 0) {
            console.log('[AutoScannerService] [RECONCILE] 🔄 Performing periodic reconciliation with Binance...');
            try {
                const reconcileResult = await this.positionManager.reconcileWithBinance();
                if (reconcileResult.success && reconcileResult.summary) {
                    const s = reconcileResult.summary;
                    console.log(`[AutoScannerService] [RECONCILE] ✅ Sync complete: ${s.positionsRemaining} positions, ${s.ghostPositionsCleaned} ghosts cleaned, ${s.externalOrders || 0} external orders`);
                } else if (!reconcileResult.success) {
                    console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation failed: ${reconcileResult.error || 'Unknown issue'}. Continuing with scan cycle.`);
                } else {
                    console.log('[AutoScannerService] [RECONCILE] ℹ️ Reconciliation completed with no specific summary (likely no changes)');
                }
            } catch (reconcileError) {
                console.warn(`[AutoScannerService] [RECONCILE] ⚠️ Reconciliation error: ${reconcileError.message}`);
            }
        }

        if (this.state.stats.totalScans % 10 === 0 && this.state.stats.totalScans > 0) {
            //this.addLog('[RECONCILE] 🔄 Performing position data reconciliation...', 'system');
            const reconcileResult = await this.positionManager.reconcilePositionData();
            if (reconcileResult.cleaned > 0) {
                //this.addLog(`[RECONCILE] ✅ Cleaned up ${reconcileResult.cleaned} stale position records.`, 'success');
            }
            if (reconcileResult.errors.length > 0) {
                console.log(`[AutoScannerService] [RECONCILE] ℹ️ Found ${reconcileResult.errors.length} position data issues`);
            }
        }

        try {
            const { tradesToCreate, positionIdsToClose } = await this.positionManager.monitorAndClosePositions(this.currentPrices);
            if (tradesToCreate.length > 0) {
                await this.positionManager.executeBatchClose(tradesToCreate, positionIdsToClose);
            }
        } catch (error) {
            console.error(`[AutoScannerService] [POS_MONITOR] ❌ Error in position monitoring: ${error.message}`);
        }
    }


    /**
     * Helper method to evaluate strategies and detect signals.
     * This method now delegates the core evaluation to StrategyManagerService.
     * @param {Array} strategies - List of active strategies.
     * @param {object} currentWalletState - The current wallet state.
     * @param {object} settings - Scanner settings.
     * @param {object} marketRegime - Current market regime data.
     * @param {object} currentPrices - Current market prices.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     * @returns {object} Scan result from signal detection ({ signalsFound, tradesExecuted }).
     */
    async _evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {
        if (this.isHardResetting) return { signalsFound: 0, tradesExecuted: 0 };

        // No need for separate balance check here, it's handled at the beginning of scanCycle()
        // If execution reaches here, sufficient funds are presumed.

        console.log('[AutoScannerService] [STRATEGY] 🎯 Evaluating trading strategies...');

        // Check if strategies are empty (corresponds to coinsData check in outline)
        if (!strategies || strategies.length === 0) {
            console.warn('[AutoScannerService] [STRATEGY] ⚠️ No active strategies available for evaluation');
            return { signalsFound: 0, tradesExecuted: 0 }; // Consistent with old return
        }

        // Delegate to StrategyManagerService
        const scanResult = await this.strategyManager.evaluateStrategies(
            strategies,
            currentWalletState,
            settings,
            marketRegime,
            currentPrices,
            cycleStats
        );

        console.log('[AutoScannerService] [AutoScannerService] 📊 Strategy evaluation complete.', {
            signalsFound: scanResult.signalsFound,
            tradesExecuted: scanResult.tradesExecuted,
            newPositionsOpened: this.state.newPositionsCount
        });

        // Update signal generation history (original logic)
        this.state.signalGenerationHistory.push({
            timestamp: Date.now(),
            signalsFound: scanResult.signalsFound,
        });
        if (this.state.signalGenerationHistory.length > 50) {
            this.state.signalGenerationHistory.shift();
        }

        // Apply wallet refresh logic from outline based on newPositionsCount
        if (this.state.newPositionsCount > 0) {
            console.log('[AutoScannerService] [STRATEGY] 🔄 Refreshing wallet state after opening positions...');
            try {
                // Step 1: Sync with Binance to get latest balances
                await this.walletManagerService.initializeLiveWallet();

                // Step 2: Recalculate wallet summary with fresh data
                await this.walletManagerService.updateWalletSummary(
                    this.state.liveWalletState,
                    this.currentPrices
                );

                // Step 3: Persist to localStorage for immediate UI access
                await this._persistLatestWalletSummary();

                // Step 4: Notifying UI components
                this.notifyWalletSubscribers();

                console.log('[AutoScannerService] [STRATEGY] ✅ Wallet state refreshed successfully');
            } catch (refreshError) {
                console.error('[AutoScannerService] ❌ Failed to refresh wallet after opening positions:', refreshError);
                console.warn(`[AutoScannerService] [STRATEGY] ⚠️ Wallet refresh warning: ${refreshError.message}`);
            }
        }

        return scanResult; // Return original expected structure for scanCycle
    }


    /**
     * Helper method to run the trade archiving process.
     */
    async _archiveOldTradesIfNeeded() {
        if (this.isHardResetting) return;
        await this.tradeArchivingService.runArchivingProcess();
    }

    /**
     * Helper method to update performance snapshots, wallet state, and log summaries.
     * @param {object} cycleStats - Statistics object for the current scan cycle.
     */
    async _updatePerformanceSnapshotIfNeeded(cycleStats) {
        console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded CALLED =====');
        console.log('[AutoScannerService] Current trading mode:', this.state.tradingMode);

        if (this.isHardResetting) {
            console.log('[AutoScannerService] _updatePerformanceSnapshotIfNeeded skipped due to hard reset.');
            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETE =====');
            return;
        }

        try {
            // 1. Update wallet summary
            console.log('[AutoScannerService] Updating wallet summary...');
            console.log('[AutoScannerService] Current wallet state before update:', {
                id: this.state.liveWalletState?.id,
                total_realized_pnl: this.state.liveWalletState?.total_realized_pnl,
                total_trades_count: this.state.liveWalletState?.total_trades_count
            });

            await this.walletManagerService.updateWalletSummary(
                this.state.liveWalletState,
                this.currentPrices || {}
            );

            console.log('[AutoScannerService] Wallet summary updated');
            console.log('[AutoScannerService] Current wallet state after update:', {
                id: this.state.liveWalletState?.id,
                total_realized_pnl: this.state.liveWalletState?.total_realized_pnl,
                total_trades_count: this.state.liveWalletState?.total_trades_count
            });

            // 2. Update HistoricalPerformance snapshots
            console.log('[AutoScannerService] Calling updatePerformanceSnapshot function...');
            const response = await queueFunctionCall(
                updatePerformanceSnapshot,
                { mode: this.state.tradingMode },
                'normal',
                null,
                0,
                120000
            );

            console.log(`[AutoScannerService] updatePerformanceSnapshot response: success=${response?.data?.success}, error=${response?.data?.error}`);

            if (response?.data?.success) {
                console.log('[AutoScannerService] ✅ HistoricalPerformance snapshots created successfully');
                if (response.data.snapshotsCreated && response.data.snapshotsCreated.length > 0) {
                    response.data.snapshotsCreated.forEach(snap => {
                        console.log(`[AutoScannerService] Created ${snap.type} snapshot at ${snap.timestamp}`);
                    });
                }
                if (response.data.currentMetrics) {
                    console.log(`[AutoScannerService] Current metrics: PnL=${response.data.currentMetrics.total_realized_pnl?.toFixed(2) || 'N/A'}`);
                }
            } else {
                console.warn('[AutoScannerService] ⚠️ HistoricalPerformance update had issues: ' + (response?.data?.error || 'Unknown error'));
            }

            console.log('[AutoScannerService] Calculating performance momentum...');
            await this.performanceMetricsService.calculatePerformanceMomentum();

            console.log('[AutoScannerService] Persisting wallet changes...');
            await this.positionManager.persistWalletChangesAndWait();

            console.log('[AutoScannerService] Updating wallet summary again after persist...');
            await this.walletManagerService.updateWalletSummary(this.state.liveWalletState, this.currentPrices);

            // 3. Notify WalletProvider
            console.log('[AutoScannerService] Notifying wallet subscribers...');
            if (typeof this.notifyWalletSubscribers === 'function') {
                this.notifyWalletSubscribers();
            } else {
                console.warn('[AutoScannerService] ⚠️ notifyWalletSubscribers callback not registered');
            }

            console.log('[AutoScannerService] Persisting latest wallet summary...');
            await this._persistLatestWalletSummary();

            // Flush market alerts
            try {
                console.log('[AutoScannerService] Flushing market alert buffer...');
                const flushRes = await flushMarketAlertBuffer();
                if (flushRes?.created > 0) {
                    this.addLog(`[MarketAlert] Flushed ${flushRes.created} buffered alert(s)`, 'info');
                }
                console.log('[AutoScannerService] Market alert buffer flushed, result:', flushRes);
            } catch (e) {
                this.addLog(`[MarketAlert] ⚠️ Failed to flush alerts: ${e.message}`, 'warning');
            }

            // Report on trade archiving
            const lastArchivingReport = this.tradeArchivingService.getLastArchivingReport();
            if (lastArchivingReport) {
                this.addLog('──────────── 📦 ARCHIVING SUMMARY ────────────', 'cycle-end');
                const r = lastArchivingReport;
                if (r.success) {
                    this.addLog(`[ARCHIVING] ${r.message}`, 'info');
                    if (r.performance) {
                        const { totalMs = 0, fetchMs = 0, identifyMs = 0, deleteMs = 0 } = r.performance || {};
                        this.addLog(`[ARCHIVING_PERF] Total: ${totalMs.toFixed(0)}ms | Fetch: ${fetchMs.toFixed(0)}ms | Identify: ${identifyMs.toFixed(0)}ms | Delete: ${deleteMs.toFixed(0)}ms`, 'info');
                    }
                    if (typeof r.remainingCount === 'number') {
                        this.addLog(`[ARCHIVING] Remaining trades (approx): ${r.remainingCount} | More to process: ${r.moreToProcess ? 'Yes' : 'No'}`, 'info');
                    }
                } else {
                    this.addLog(`[ARCHIVING] ❌ ${r.error || 'Archiving failed.'}`, 'error');
                    if (r.performance) {
                        const { totalMs = 0, fetchMs = 0, identifyMs = 0, deleteMs = 0 } = r.performance || {};
                        this.addLog(`[ARCHIVING_PERF] Total: ${totalMs.toFixed(0)}ms | Fetch: ${fetchMs.toFixed(0)}ms | Identify: ${identifyMs.toFixed(0)}ms | Delete: ${deleteMs.toFixed(0)}ms`, 'error');
                    }
                }
                this.addLog('──────────────────────────────────────────────', 'cycle-end');
            }

            // Refresh market alert cache
            try {
                console.log('[AutoScannerService] Refreshing market alert cache...');
                await refreshMarketAlertCache({ limit: 10, timeoutMs: 30000 });
                this.state.marketAlerts = getMarketAlertCache();
                this.addLog(`[MarketAlerts] Cache refreshed. ${this.state.marketAlerts.length} alerts loaded.`, 'info');
            } catch (e) {
                this.addLog(`[MarketAlerts] ⚠️ Failed to refresh alerts: ${e.message}`, 'warning');
            }

            // Update price callback
            if (this.priceUpdateCallback && Object.keys(this.currentPrices).length > 0) {
                console.log('[AutoScannerService] Calling priceUpdateCallback...');
                this.priceUpdateCallback(this.currentPrices);
            } else {
                console.log('[AutoScannerService] priceUpdateCallback not set or no current prices.');
            }

            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETED SUCCESSFULLY =====');

        } catch (error) {
            console.error('[AutoScannerService] ❌ Error in _updatePerformanceSnapshotIfNeeded:', error);
            console.error('[AutoScannerService] Error stack:', error.stack);
            this.addLog(`Error updating performance snapshot: ${error.message}`, 'error', error);
            console.log('[AutoScannerService] ===== _updatePerformanceSnapshotIfNeeded COMPLETED WITH ERROR =====');
            throw error;
        }
    }


    _updateCurrentPrices(pricesData) {
        if (pricesData && typeof pricesData === 'object') {
            this.currentPrices = pricesData;
        }
    }

    async _sendTelegramNotification(type, data) {
        if (!this.telegramSettings.token || !this.telegramSettings.chat_id) {
            console.warn('[AutoScannerService] Telegram notification skipped: Bot token or chat ID not configured.');
            return;
        }

        let message = '';
        switch (type) {
            case 'TRADE_CLOSED':
                message = `📈 *Trade Closed!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `P&L: ${data.pnl >= 0 ? '✅' : '❌'} $${data.pnl.toFixed(2)} (${data.pnlPercentage.toFixed(2)}%)%0A` +
                    `Exit Reason: ${data.exitReason.replace(/_/g, ' ')}%0A` +
                    `Duration: ${data.duration} mins`;
                break;
            case 'TRADE_OPENED':
                message = `✅ *Trade Opened!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `Entry Price: $${data.entry_price.toFixed(4)}%0A` +
                    `Size: $${data.entry_value_usdt.toFixed(2)} USDT%0A` +
                    `Conviction: ${data.conviction_score.toFixed(1)}`;
                break;
            default:
                message = `*AutoScanner Update:* ${JSON.stringify(data)}`;
                break;
        }

        const url = `https://api.telegram.org/bot${this.telegramSettings.token}/sendMessage`;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.telegramSettings.chat_id,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });
            console.log(`[AutoScannerService] Telegram notification sent successfully.`);
        } catch (error) {
            console.error(`[AutoScannerService] Failed to send Telegram notification: ${error.message}`);
        }
    }

    getWalletStateHistory() {
        return this.positionManager ? this.positionManager.getWalletStateHistory() : [];
    }

    async _logCycleSummary(cycleStats) {
        if (!this.state.isRunning) {
            return;
        }

        const signalsFound = cycleStats.combinationsMatched;
        const tradesExecuted = cycleStats.positionsOpened;
        this.addLog(`✅ Scan cycle complete: ${signalsFound} signals found, ${tradesExecuted || 0} trades executed.`, 'cycle');
        this.addLog('', 'cycle');

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        if (this.state.momentumBreakdown) {
            const { signalQuality, fearAndGreed, opportunityRate, volatility, regime, unrealized, realized } = this.state.momentumBreakdown;

            this.addLog(`• Unrealized P&L: ${unrealized.score.toFixed(0)} (Wt: ${(unrealized.weight * 100).toFixed(0)}%)`, 'cycle');
            this.addLog(`• Realized P&L: ${realized.score.toFixed(0)} (Wt: ${(realized.weight * 100).toFixed(0)}%)`, 'cycle');

            const marketRegime = this.state.marketRegime?.regime || 'unknown';
            const regimeConfidence = (this.state.marketRegime?.confidence * 100)?.toFixed(0) || 'N/A';
            this.addLog(`• Market Regime: ${regime.score.toFixed(0)} (Wt: ${(regime.weight * 100).toFixed(0)}%) (${marketRegime} (${regimeConfidence}%))`, 'cycle');

            const adxValue = this.state.marketVolatility.adx?.toFixed(1) || 'N/A';
            const bbwValue = (this.state.marketVolatility.bbw * 100)?.toFixed(1) || 'N/A';
            this.addLog(`• Market Volatility: ${volatility.score.toFixed(0)} (Wt: ${(volatility.weight * 100).toFixed(0)}%) (ADX: ${adxValue}, BBW: ${bbwValue}%)`, 'cycle');

            const recentSignalCount = this.state.signalGenerationHistory.slice(-1)[0]?.signalsFound || 0;
            this.addLog(`• Opportunity Rate: ${opportunityRate.score.toFixed(0)} (Wt: ${(opportunityRate.weight * 100).toFixed(0)}%) (${recentSignalCount} recent signals)`, 'cycle');

            const fearGreedValue = this.state.fearAndGreedData?.value || 'N/A';
            const fearGreedClassification = this.state.fearAndGreedData?.value_classification || 'N/A';
            this.addLog(`• Fear & Greed: ${fearAndGreed.score.toFixed(0)} (Wt: ${(fearAndGreed.weight * 100).toFixed(0)}%) (F&G: ${fearGreedValue} (${fearGreedClassification}))`, 'cycle');

            // Only log Signal Quality if its weight is not 0
            if (signalQuality.weight > 0) {
                const avgStrength = this.state.stats?.averageSignalStrength || 0;
                this.addLog(`• Signal Quality: ${signalQuality.score.toFixed(0)} (Wt: ${(signalQuality.weight * 100).toFixed(0)}%) (${avgStrength.toFixed(0)} avg strength)`, 'cycle');
            }

        } else {
            this.addLog(`• Performance metrics: Awaiting initial calculation...`, 'cycle');
        }

        const performanceMomentumScore = this.state.performanceMomentumScore;
        if (typeof performanceMomentumScore === 'number') {
            this.addLog(`📊 Performance Momentum Score: ${performanceMomentumScore.toFixed(0)}`, 'cycle');
        } else {
            this.addLog(`📊 Performance Momentum Score: Awaiting initial calculation...`, 'cycle');
        }
        if (typeof this.state.adjustedBalanceRiskFactor === 'number') {
            this.addLog(`📈 Adjusted Balance Risk Factor: ${this.state.adjustedBalanceRiskFactor.toFixed(0)}% (Max configured: ${this.state.settings?.maxBalancePercentRisk || 100}%)`, 'cycle');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        try {
            if (!this.walletManagerService.walletSummary || !this.state.liveWalletState || !this.walletManagerService.walletSummary.lastUpdated || (Date.now() - new Date(this.walletManagerService.walletSummary.lastUpdated).getTime() > 10000)) {
                await this.walletManagerService.initializeLiveWallet();
                await this.walletManagerService.updateWalletSummary(
                    this.state.liveWalletState,
                    this.currentPrices
                );
                await this._persistLatestWalletSummary();
            } else {
                await this.walletManagerService.updateWalletSummary(
                    this.state.liveWalletState,
                    this.currentPrices
                );
                await this._persistLatestWalletSummary();
            }
        } catch (walletError) {
            this.addLog(`[WALLET] ⚠️ Wallet refresh failed for logging: ${walletError.message}`, 'warning');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
        this.addLog('🏦 WALLET SUMMARY', 'cycle');
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');

        this._logWalletSummary();

        const totalBlocked = Object.values(cycleStats.blockReasons || {}).reduce((sum, count) => sum + count, 0);

        if (totalBlocked > 0) {
            const convictionBlocks = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) => reason.toLowerCase().includes('conviction'))
                .reduce((sum, [, count]) => sum + count, 0);

            if (convictionBlocks > 0) {
                const minConvictionThreshold = this.state.settings?.minimumCombinedStrength || 50;
                this.addLog(`🚫 ${convictionBlocks} strategies blocked: Conviction score below threshold (${minConvictionThreshold})`, 'warning');
            }

            const sizeBlocks = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) => reason.toLowerCase().includes('calculated position size') || reason.toLowerCase().includes('is below minimum'))
                .reduce((sum, [, count]) => sum + count, 0);

            if (sizeBlocks > 0) {
                const minTradeValue = this.state.settings?.minimumTradeValue || 10;
                this.addLog(`🚫 ${sizeBlocks} strategies blocked: Calculated position size below minimum ($${minTradeValue})`, 'warning');
            }

            const otherBlockReasons = Object.entries(cycleStats.blockReasons || {})
                .filter(([reason]) =>
                    !reason.toLowerCase().includes('conviction') &&
                    !reason.toLowerCase().includes('calculated position size') &&
                    !reason.toLowerCase().includes('is below minimum')
                );

            if (otherBlockReasons.length > 0) {
                const otherBlocksCount = otherBlockReasons.reduce((sum, [, count]) => sum + count, 0);
                if (otherBlocksCount > 0) {
                    this.addLog(`🚫 ${otherBlocksCount} strategies blocked for other reasons`, 'warning');
                }
            }
        } else {
            this.addLog(`🚫 Positions Blocked: 0`, 'info');
        }

        if (cycleStats.positionsOpened > 0) {
            this.addLog(`🚀 New Positions Opened: ${cycleStats.positionsOpened}`, 'success');
        } else if (cycleStats.combinationsMatched > 0) {
            this.addLog(`✅ Strategies Matches Found: ${cycleStats.combinationsMatched}`, 'info');
        }

        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
        this.addLog('', 'system');
    }

    _logWalletSummary() {
        if (!this.walletManagerService?.walletSummary) {
            this.addLog('[WALLET] No wallet summary available', 'info', { level: 1 });
            return;
        }

        const summary = this.walletManagerService.walletSummary;
        const positions = this.positionManager?.positions || [];

        let unrealizedPnl = 0;
        for (const position of positions) {
            const symbol = position.symbol.replace('/', '');
            const currentPrice = this.currentPrices[symbol];
            if (currentPrice && position.entry_price) {
                const pnl = (currentPrice - position.entry_price) * position.quantity_crypto;
                unrealizedPnl += pnl;
            }
        }

        const realizedPnl = summary.totalRealizedPnl || 0;

        const formatCurrencyWithSign = (value) => {
            const absValue = Math.abs(value);
            const formatted = `$${absValue.toFixed(2)}`;
            if (value < 0) {
                return `-${formatted}`;
            } else if (value > 0) {
                return `+${formatted}`;
            }
            return formatted;
        };

        this.addLog(
            `[WALLET] Unrealized P&L: ${formatCurrencyWithSign(unrealizedPnl)} | Realized P&L: ${formatCurrencyWithSign(realizedPnl)}`,
            'info',
            { level: 1 }
        );

        this.addLog(
            `[WALLET] Open Positions: ${positions.length} | Portfolio Utilization: ${(summary.portfolioUtilization || 0).toFixed(1)}%`,
            'info',
            { level: 1 }
        );

        this.addLog(
            `[WALLET] Total Trades: ${summary.totalTradesCount || 0} | Win Rate: ${(summary.winRate || 0).toFixed(1)}% | Profit Factor: ${(summary.profitFactor || 0).toFixed(2)}`,
            'info',
            { level: 1 }
        );

        const modeText = this.state?.liveWalletState?.mode?.toUpperCase() || 'UNKNOWN';
        this.addLog(`[WALLET] Mode: ${modeText} | Total Equity: ${this._formatCurrency(summary.totalEquity || 0)}`, 'cycle');
        this.addLog('═══════════════════════════════════════════════════════', 'cycle');
    }

    // DELEGATED: updateSettings now calls ConfigurationService.updateSettings
    async updateSettings(newSettings) {
        return this.configurationService.updateSettings(newSettings);
    }

    // DELEGATED: refreshStrategies now calls StrategyManagerService.refreshStrategies
    async refreshStrategies() {
        return this.strategyManager.refreshStrategies();
    }

    async _updateMarketRegime() {
        try {
            const symbol = 'BTC/USDT';
            const timeframe = '4h';
            const klineLimit = 300;

            const response = await queueFunctionCall(getKlineData, { symbols: [symbol], interval: timeframe, limit: klineLimit });

            const responseData = response.data;

            if (!responseData || typeof responseData !== 'object') {
                throw new Error('Invalid response data format from getKlineData');
            }

            const symbolData = responseData[symbol];
            if (!symbolData || symbolData.error) {
                throw new Error(`No valid data for ${symbol}: ${symbolData?.error || 'No data'}`);
            }

            const klineDataResponse = symbolData.data;

            if (!Array.isArray(klineDataResponse) || klineDataResponse.length < 50) {
                throw new Error(`Insufficient kline data: ${klineDataResponse?.length || 0} candles`);
            }

            const transformedKlines = klineDataResponse.map((kline, index) => {
                let transformed;
                if (Array.isArray(kline)) {
                    transformed = {
                        timestamp: kline[0],
                        open: parseFloat(kline[1]),
                        high: parseFloat(kline[2]),
                        low: parseFloat(kline[3]),
                        close: parseFloat(kline[4]),
                        volume: parseFloat(kline[5])
                    };
                } else if (kline && typeof kline === 'object') {
                    transformed = {
                        timestamp: kline.timestamp || kline.time || kline.openTime,
                        open: parseFloat(kline.open || kline.o),
                        high: parseFloat(kline.h || kline.high),
                        low: parseFloat(kline.l || kline.low),
                        close: parseFloat(kline.c || kline.close),
                        volume: parseFloat(kline.v || kline.volume)
                    };
                }

                const hasValidData = transformed &&
                    !isNaN(transformed.open) && !isNaN(transformed.high) &&
                    !isNaN(transformed.low) && !isNaN(transformed.close) &&
                    transformed.open > 0 && transformed.high > 0 &&
                    !isNaN(transformed.volume) &&
                    transformed.low > 0 && transformed.close > 0;

                return hasValidData ? transformed : null;
            }).filter(kline => kline !== null);

            if (transformedKlines.length < 50) {
                throw new Error(`Insufficient valid kline data after filtering: ${transformedKlines.length} candles`);
            }

            const coreRegimeSignalSettings = [
                { type: 'adx', enabled: true },
                { type: 'atr', enabled: true, period: 14 },
                { type: 'bbw', enabled: true },
                { type: 'ema', enabled: true },
                { type: 'sma', enabled: true, period: 20 },
                { type: 'ma200', enabled: true },
                { type: 'macd', enabled: true },
                { type: 'rsi', enabled: true },
                { type: 'obv', enabled: true },
                { type: 'volume_sma', enabled: true },
                { type: 'volume_roc', enabled: true }
            ];

            const fullIndicators = calculateAllIndicators(transformedKlines, coreRegimeSignalSettings, this.addLog.bind(this));

            const essentialIndicators = ['atr', 'adx', 'bbw', 'ema'];

            const smaAlternatives = ['sma', 'ma200', 'ma100', 'ma50'];
            const hasSma = smaAlternatives.some(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);

            if (!hasSma) {
                essentialIndicators.push('sma');
            }

            const calculatedIndicatorNames = Object.keys(fullIndicators).filter(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);
            const actuallyMissingIndicators = essentialIndicators.filter(ind => !calculatedIndicatorNames.includes(ind.split(' ')[0]));

            if (actuallyMissingIndicators.length > 0) {
                this.addLog(`[Regime] ⚠️ Missing essential indicators: ${actuallyMissingIndicators.join(', ')}`, 'warning');
            }

            const detector = new MarketRegimeDetector(transformedKlines, fullIndicators, true, this.addLog.bind(this));

            // NEW: seed detector with previously saved streak/history (if available)
            if (this.state.marketRegime && (Array.isArray(this.state.marketRegime.regimeHistory) || typeof this.state.marketRegime.consecutivePeriods === 'number')) {
                detector.restoreState({
                    regimeHistory: Array.isArray(this.state.marketRegime.regimeHistory) ? this.state.marketRegime.regimeHistory : [],
                    consecutivePeriods: typeof this.state.marketRegime.consecutivePeriods === 'number' ? this.state.marketRegime.consecutivePeriods : 0,
                    lastRegimeDetected: this.state.marketRegime.regime || null
                });
            }

            const regimeResult = detector.getRegime();
            const volatilityData = detector.getVolatilityData();

            const resolvedConfidencePct = (typeof regimeResult.confidence === 'number'
                ? regimeResult.confidence
                : (typeof regimeResult.confidencePct === 'number' ? regimeResult.confidencePct : 50));

            this.state.marketRegime = {
                regime: regimeResult.regime,
                confidence: Math.max(0, Math.min(1, resolvedConfidencePct / 100)),
                isConfirmed: Boolean(regimeResult.isConfirmed),
                // ADDED: Include confirmation tracking data
                consecutivePeriods: regimeResult.consecutivePeriods || 0,
                confirmationThreshold: regimeResult.confirmationThreshold || 3,
                regimeHistory: regimeResult.regimeHistory || []
            };

            this.state.marketVolatility = {
                adx: volatilityData.adx.adx || 25,
                bbw: volatilityData.bbw || 0.1
            };

            // Persist the updated regime state so streak survives reloads
            this._saveStateToStorage();

            const userMinimum = this.state.settings?.minimumRegimeConfidence || 60;
            const wouldBlock = (this.state.marketRegime.confidence * 100) < userMinimum;

            // ADDED: Enhanced regime calculation logging with confirmation details
            const confidenceText = `${(this.state.marketRegime.confidence * 100).toFixed(1)}%`;
            const confirmationStatus = this.state.marketRegime.isConfirmed ? 'CONFIRMED' : 'DEVELOPING';
            const streakText = `${this.state.marketRegime.consecutivePeriods}/${this.state.marketRegime.confirmationThreshold}`;

            this.addLog(`[REGIME_CALCULATION] 🎯 ${regimeResult.regime.toUpperCase()} detected with ${confidenceText} confidence`, 'info');
            this.addLog(`[REGIME_CALCULATION] 📊 Status: ${confirmationStatus} (${streakText} consecutive periods)`, 'info');

            if (this.state.marketRegime.regimeHistory?.length > 1) {
                const recentHistory = this.state.marketRegime.regimeHistory
                    .slice(-4) // Show last 4 periods
                    .map(h => h.regime.toUpperCase())
                    .join(' → ');
                this.addLog(`[REGIME_CALCULATION] 📈 Recent history: ${recentHistory}`, 'info');
            }

            if (wouldBlock) {
                this.addLog(`[REGIME_CALCULATION] ⚠️  BLOCKING: Strategies will be skipped due to low regime confidence`, 'warning');
            } else {
                this.addLog(`[REGIME_CALCULATION] ✅ ALLOWING: Regime confidence meets user threshold`, 'info');
            }

        } catch (error) {
            this.addLog(`[Regime] ❌ Could not update market regime: ${error.message}`, 'error', error);
            this.state.marketRegime = {
                regime: 'neutral',
                confidence: 0.5,
                isConfirmed: false,
                consecutivePeriods: 0,
                confirmationThreshold: 3,
                regimeHistory: []
            };
            this.addLog('[Regime] Falling back to NEUTRAL market regime due to error.', 'warning');
            throw error; // Propagate error
        }
    }

    // NEW: helper to persist the most recent WalletSummary for the current mode
    async _persistLatestWalletSummary() {
        try {
            if (typeof window === 'undefined') return;
            const mode = this.state?.tradingMode || 'testnet';
            const latest = await queueEntityCall('WalletSummary', 'filter', { mode }, '-lastUpdated', 1);
            if (Array.isArray(latest) && latest.length > 0) {
                const snapshot = latest[0];
                localStorage.setItem(`walletSummaryCache_${mode}`, JSON.stringify(snapshot));
                try {
                    window.__walletSummaryCache = snapshot; // easy global fallback for UI
                } catch (_e) {
                    // ignore, not critical
                }
            }
        } catch (_e) {
            // silent fail - not critical to block scanner
        }
    }

    getState() {
        return { ...this.state };
    }
}

let instance = null;
export const getAutoScannerService = () => {
    if (typeof window !== 'undefined' && window.autoScannerService) {
        return window.autoScannerService;
    }

    if (!instance) {
        instance = new AutoScannerService();
    }
    return instance;
};

export default AutoScannerService;
