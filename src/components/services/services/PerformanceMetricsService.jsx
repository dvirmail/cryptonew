/**
 * PerformanceMetricsService
 * 
 * Manages the calculation and tracking of various performance metrics for the scanner,
 * including performance momentum score and Fear & Greed Index.
 * This class is designed to be instantiated by AutoScannerService and interact with its state.
 */

import { queueEntityCall } from '@/components/utils/apiQueue';
import { getFearAndGreedIndex } from '@/api/functions';
import { MOMENTUM_WEIGHTS, MOMENTUM_WEIGHTS_PERCENTS, MOMENTUM_INTERVALS, MOMENTUM_THRESHOLDS } from '../constants/momentumWeights';

export class PerformanceMetricsService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference // For notifying main scanner state changes
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference // Access main scanner state

        // Internal state for this service
        this.lastMomentumCalculation = 0;
        this.momentumCalculationInterval = MOMENTUM_INTERVALS.calculationInterval;

        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedFetchInterval = MOMENTUM_INTERVALS.fearAndGreedFetchInterval;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;

        this.recentTradesForMomentum = [];
        this.maxMomentumTrades = MOMENTUM_INTERVALS.maxMomentumTrades;
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
            console.log('[AutoScannerService] [fetchFearAndGreedIndex] Calling getFearAndGreedIndex directly (bypassing queue)...');
            const response = await getFearAndGreedIndex();
            console.log('[AutoScannerService] [fetchFearAndGreedIndex] Direct call response:', response);
            
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

            throw new Error('Failed to fetch Fear & Greed Index');
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

        const state = this.scannerService.state;

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
            const activeWalletState = this.scannerService.walletManagerService?.getCurrentWalletState();
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
                    
                    // IMPROVED: More conservative scaling with position count normalization
                    const positionCountFactor = Math.min(1.0, positionsWithPrice / 3); // Normalize by position count
                    const conservativeScaling = 5.0; // Reduced from 10.0 for less volatility
                    
                    // Apply logarithmic scaling for more stable results
                    const logScaledPnl = portfolioPnlPercent > 0 
                        ? Math.log(1 + Math.abs(portfolioPnlPercent)) * Math.sign(portfolioPnlPercent)
                        : portfolioPnlPercent;
                    
                    unrealizedComponent = Math.max(0, Math.min(100, 
                        50 + (logScaledPnl * conservativeScaling * positionCountFactor)
                    ));
                }
            }

            // 2. Realized P&L Component - IMPROVED with recency weighting
            const recentTrades = this.recentTradesForMomentum;
            let realizedComponent = 50;
            if (recentTrades.length >= 5) {
                // IMPROVED: Apply recency weighting (more recent trades have higher weight)
                const now = Date.now();
                const weightedPnlValues = recentTrades.map((t, index) => {
                    const ageHours = (now - new Date(t.exit_timestamp).getTime()) / (1000 * 60 * 60);
                    const recencyWeight = Math.exp(-ageHours / 24); // Decay over 24 hours
                    return (t.pnl_percentage || 0) * recencyWeight;
                });
                
                const weightedAvgPnl = weightedPnlValues.reduce((s, a) => s + a, 0) / recentTrades.length;
                const winningTradesCount = recentTrades.filter(t => (t.pnl_percentage || 0) > 0).length;
                const winRate = (winningTradesCount / recentTrades.length) * 100;

                // IMPROVED: More conservative scaling with trade count consideration
                const tradeCountFactor = Math.min(1.0, recentTrades.length / 20); // Normalize by trade count
                const conservativeScaling = 4.0; // Reduced from 8.0
                
                const pnlScore = 50 + (weightedAvgPnl * conservativeScaling * tradeCountFactor);
                const winRateBonus = (winRate - 50) * 0.2; // Reduced from 0.3
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

            // NEW: Calculate Adjusted Balance Risk Factor with smoother transitions
            const maxBalancePercentRisk = state.settings?.maxBalancePercentRisk || 100;
            let adjustedBalanceRiskFactor;

            // IMPROVED: Smoother risk scaling with gradual transitions
            if (clampedScore >= MOMENTUM_THRESHOLDS.excellent) {
                // Excellent momentum: use full configured max risk
                adjustedBalanceRiskFactor = maxBalancePercentRisk;
            } else if (clampedScore >= MOMENTUM_THRESHOLDS.good) {
                // Good momentum: smooth scaling from 60% to 100% of max risk
                const scoreRange = MOMENTUM_THRESHOLDS.excellent - MOMENTUM_THRESHOLDS.good;
                const scorePosition = clampedScore - MOMENTUM_THRESHOLDS.good;
                const scaleFactor = 0.6 + (0.4 * (scorePosition / scoreRange)); // Start at 60% instead of 50%
                adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
            } else if (clampedScore >= MOMENTUM_THRESHOLDS.poor) {
                // Poor momentum: smooth scaling from 20% to 60% of max risk
                const scoreRange = MOMENTUM_THRESHOLDS.good - MOMENTUM_THRESHOLDS.poor;
                const scorePosition = clampedScore - MOMENTUM_THRESHOLDS.poor;
                const scaleFactor = 0.2 + (0.4 * (scorePosition / scoreRange)); // Start at 20% instead of 10%
                adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
            } else {
                // Very poor momentum: minimum 10% of max risk (or absolute minimum)
                adjustedBalanceRiskFactor = Math.max(MOMENTUM_THRESHOLDS.minimum, maxBalancePercentRisk * 0.1);
            }

            // Ensure we never go below minimum or above configured max
            adjustedBalanceRiskFactor = Math.max(MOMENTUM_THRESHOLDS.minimum, Math.min(maxBalancePercentRisk, Math.round(adjustedBalanceRiskFactor)));

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
            this.scannerService.notifySubscribers();

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
        this.scannerService.notifySubscribers(); // Notify UI of state change
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

export default PerformanceMetricsService;
