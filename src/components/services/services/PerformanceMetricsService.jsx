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
import priceCacheService from '@/components/services/PriceCacheService';

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
            // CRITICAL FIX: Filter trades by current trading mode
            const tradingMode = this.scannerService.getTradingMode?.() || this.scannerService.state?.tradingMode || 'testnet';
            // Use queueEntityCall with 'Trade' entity name string, filtered by trading mode
            const initialTrades = await queueEntityCall('Trade', 'filter', { trading_mode: tradingMode }, '-exit_timestamp', this.maxMomentumTrades);
            this.recentTradesForMomentum = initialTrades || [];
            // Update the main scanner's state with the loaded trades for reactivity
            this.scannerService.state.recentTradesForMomentum = [...this.recentTradesForMomentum];
            this.addLog(`[Performance Momentum] ✅ Loaded ${this.recentTradesForMomentum.length} initial trades for ${tradingMode} mode.`, 'success');
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
            // CRITICAL FIX: Calculate unrealized P&L for last 100 open positions only (consistent with realized P&L)
            let unrealizedComponent = 50;
            let unrealizedPnlDetails = 'No open positions';
            const activeWalletState = this.scannerService.walletManagerService?.getCurrentWalletState();
            const allOpenPositions = activeWalletState?.positions || [];
            
            // Filter to last 100 open positions by entry_timestamp (most recent first)
            // This matches the approach used for realized P&L (last 100 closed trades)
            const openPositions = allOpenPositions
                .filter(pos => pos.status === 'open' || pos.status === 'trailing')
                .sort((a, b) => {
                    // Sort by entry_timestamp DESC (most recent first)
                    const aTime = new Date(a.entry_timestamp || a.created_date || 0).getTime();
                    const bTime = new Date(b.entry_timestamp || b.created_date || 0).getTime();
                    return bTime - aTime;
                })
                .slice(0, this.maxMomentumTrades); // Limit to last 100 positions
            
            if (openPositions.length > 0) {
                // CRITICAL FIX: Fetch prices for all open positions if not available
                // Use state.currentPrices if available, otherwise fallback to scannerService.currentPrices
                const initialPrices = state.currentPrices && Object.keys(state.currentPrices).length > 0 
                    ? state.currentPrices 
                    : (this.scannerService?.currentPrices || {});
                const symbolsNeedingPrices = [];
                const priceMap = { ...initialPrices };
                
                for (const pos of openPositions) {
                    const symbolNoSlash = pos.symbol.replace('/', '');
                    const existingPrice = priceMap[symbolNoSlash];
                    if (!existingPrice || typeof existingPrice !== 'number' || existingPrice <= 0) {
                        symbolsNeedingPrices.push(symbolNoSlash);
                    }
                }
                
                // Fetch missing prices if needed
                if (symbolsNeedingPrices.length > 0) {
                    if (this.scannerService.priceManagerService) {
                        try {
                            // ⚡ PERFORMANCE: Batch fetch all missing prices at once instead of individual calls
                            const normalizedSymbols = symbolsNeedingPrices.map(s => s.replace('/', ''));
                            const tradingMode = this.scannerService?.state?.tradingMode || 'testnet';
                            
                            // Use PriceCacheService batch endpoint (with fallback to singleton)
                            const priceCache = this.scannerService?.priceCacheService || priceCacheService;
                            let batchPriceMap = new Map();
                            
                            if (priceCache && typeof priceCache.getBatchPrices === 'function') {
                                try {
                                    batchPriceMap = await priceCache.getBatchPrices(normalizedSymbols, tradingMode);
                                } catch (error) {
                                    // Silently handle batch fetch errors
                                }
                            }
                            
                            // Populate priceMap from batch results
                            normalizedSymbols.forEach(symbolNoSlash => {
                                const price = batchPriceMap.get(symbolNoSlash);
                                if (price && !isNaN(price) && price > 0) {
                                    priceMap[symbolNoSlash] = price;
                                }
                            });
                        } catch (error) {
                            // Silently handle fetch errors
                        }
                    }
                }
                
                let totalUnrealizedPnlUSDT = 0;
                let totalInvestedCapital = 0;
                let positionsWithPrice = 0;
                const positionsWithoutPrice = [];
                
                for (const pos of openPositions) {
                    const symbolNoSlash = pos.symbol.replace('/', '');
                    const currentPrice = priceMap[symbolNoSlash];
                    
                    if (currentPrice && typeof currentPrice === 'number' && currentPrice > 0) {
                        const unrealizedPnlUSDT = pos.direction === 'long'
                            ? (currentPrice - pos.entry_price) * pos.quantity_crypto
                            : (pos.entry_price - currentPrice) * pos.quantity_crypto;

                        totalUnrealizedPnlUSDT += unrealizedPnlUSDT;
                        totalInvestedCapital += pos.entry_value_usdt;
                        positionsWithPrice++;
                    } else {
                        positionsWithoutPrice.push({ symbol: pos.symbol, symbolNoSlash, price: currentPrice });
                    }
                }

                if (positionsWithPrice > 0 && totalInvestedCapital > 0) {
                    const portfolioPnlPercent = (totalUnrealizedPnlUSDT / totalInvestedCapital) * 100;
                    
                    // IMPROVED: More conservative scaling with position count normalization
                    const positionCountFactor = Math.min(1.0, positionsWithPrice / 3); // Normalize by position count
                    const conservativeScaling = 5.0; // Reduced from 10.0 for less volatility
                    
                    // Apply logarithmic scaling for profits (more stable results)
                    // Apply penalty multiplier for losses (increased negative impact)
                    const lossPenaltyMultiplier = 2.0; // Losses have 2x the impact
                    let scaledPnl;
                    
                    if (portfolioPnlPercent > 0) {
                        // Profits: Use logarithmic scaling (diminishing returns)
                        scaledPnl = Math.log(1 + Math.abs(portfolioPnlPercent)) * Math.sign(portfolioPnlPercent);
                    } else {
                        // Losses: Apply penalty multiplier for stronger negative impact
                        scaledPnl = portfolioPnlPercent * lossPenaltyMultiplier;
                    }
                    
                    unrealizedComponent = Math.max(0, Math.min(100, 
                        50 + (scaledPnl * conservativeScaling * positionCountFactor)
                    ));
                    
                    // CRITICAL FIX: Add details for unrealized P&L display
                    // Show count of positions used (last 100) vs total open positions
                    const totalOpenCount = allOpenPositions.filter(p => p.status === 'open' || p.status === 'trailing').length;
                    const positionCountText = totalOpenCount > this.maxMomentumTrades 
                        ? `${openPositions.length} of ${totalOpenCount}` 
                        : `${openPositions.length}`;
                    const sign = totalUnrealizedPnlUSDT >= 0 ? '' : '-';
                    const absPnl = Math.abs(totalUnrealizedPnlUSDT);
                    unrealizedPnlDetails = `${sign}$${absPnl.toFixed(2)} (${portfolioPnlPercent >= 0 ? '+' : ''}${portfolioPnlPercent.toFixed(1)}%, ${positionCountText} positions)`;
                } else if (openPositions.length > 0) {
                    // Some positions exist but no prices available
                    const missingCount = openPositions.length - positionsWithPrice;
                    const totalOpenCount = allOpenPositions.filter(p => p.status === 'open' || p.status === 'trailing').length;
                    const positionCountText = totalOpenCount > this.maxMomentumTrades 
                        ? `${openPositions.length} of ${totalOpenCount}` 
                        : `${openPositions.length}`;
                    unrealizedPnlDetails = `${positionCountText} position(s), ${missingCount} without prices`;
                }
            }

            // 2. Realized P&L Component - IMPROVED with recency weighting
            const tradingMode = state.tradingMode || 'testnet';
            // CRITICAL FIX: Filter trades by trading mode AND only include closed trades (with exit_timestamp)
            // Also limit to exactly 100 most recent closed trades
            const recentTrades = this.recentTradesForMomentum
                .filter(t => {
                    // Must be same trading mode
                    if ((t.trading_mode || 'testnet') !== tradingMode) return false;
                    // Must be closed (have exit_timestamp)
                    if (!t.exit_timestamp) return false;
                    // Must have valid entry_value_usdt (required for percentage calculation)
                    // CRITICAL FIX: Calculate entry_value_usdt if it doesn't exist (for trades loaded from DB)
                    let entryValue = Number(t.entry_value_usdt);
                    if (isNaN(entryValue) || entryValue <= 0) {
                        // Fallback: calculate from entry_price * quantity
                        const entryPrice = Number(t.entry_price) || 0;
                        const quantity = Number(t.quantity) || Number(t.quantity_crypto) || 0;
                        entryValue = entryPrice * quantity;
                    }
                    if (entryValue <= 0) return false;
                    return true;
                })
                .slice(0, this.maxMomentumTrades); // Ensure exactly 100 (or fewer if less available)
            
            let realizedComponent = 50;
            let realizedPnlDetails = 'No recent trades';
            
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

                // CRITICAL FIX: Increased scaling and asymmetric penalty for losses
                // Losses should hurt more than gains help (risk management)
                const tradeCountFactor = Math.min(1.0, recentTrades.length / 20); // Normalize by trade count
                
                // Asymmetric scaling: losses penalized more heavily than gains rewarded
                const scalingFactor = weightedAvgPnl >= 0 ? 8.0 : 12.0; // Losses: 12x, Gains: 8x
                
                const pnlScore = 50 + (weightedAvgPnl * scalingFactor * tradeCountFactor);
                const winRateBonus = (winRate - 50) * 0.3; // Increased from 0.2 for more impact
                realizedComponent = Math.max(0, Math.min(100, pnlScore + winRateBonus));
                
                // CRITICAL FIX: Calculate total realized P&L and percentage for details
                // Sum P&L from last 100 CLOSED trades only (with valid entry_value_usdt)
                const totalRealizedPnl = recentTrades.reduce((sum, t) => {
                    const pnl = Number(t.pnl_usdt);
                    return sum + (isNaN(pnl) ? 0 : pnl);
                }, 0);
                
                // Calculate percentage based on total entry value of those trades (not total equity)
                // This gives a meaningful ROI percentage for the last 100 trades
                // CRITICAL FIX: Calculate entry_value_usdt if it doesn't exist (for trades loaded from DB)
                const totalEntryValue = recentTrades.reduce((sum, t) => {
                    // Calculate entry_value_usdt if not present (for trades loaded from database)
                    let entryValue = Number(t.entry_value_usdt);
                    if (isNaN(entryValue) || entryValue <= 0) {
                        // Fallback: calculate from entry_price * quantity
                        const entryPrice = Number(t.entry_price) || 0;
                        const quantity = Number(t.quantity) || Number(t.quantity_crypto) || 0;
                        entryValue = entryPrice * quantity;
                    }
                    return sum + (isNaN(entryValue) || entryValue <= 0 ? 0 : entryValue);
                }, 0);
                
                const realizedPnlPercentage = totalEntryValue > 0 ? (totalRealizedPnl / totalEntryValue) * 100 : 0;
                
                // Realized P&L calculated
                
                // Format the details string similar to unrealized P&L
                const sign = totalRealizedPnl >= 0 ? '' : '-';
                const absPnl = Math.abs(totalRealizedPnl);
                realizedPnlDetails = `${sign}$${absPnl.toFixed(2)} (${realizedPnlPercentage >= 0 ? '+' : ''}${realizedPnlPercentage.toFixed(1)}%)`;
            } else if (recentTrades.length > 0) {
                // Show basic info even if we have fewer than 5 trades
                const totalRealizedPnl = recentTrades.reduce((sum, t) => {
                    const pnl = Number(t.pnl_usdt);
                    return sum + (isNaN(pnl) ? 0 : pnl);
                }, 0);
                
                // Calculate percentage based on total entry value of those trades
                const totalEntryValue = recentTrades.reduce((sum, t) => {
                    const entryValue = Number(t.entry_value_usdt);
                    return sum + (isNaN(entryValue) || entryValue <= 0 ? 0 : entryValue);
                }, 0);
                
                const realizedPnlPercentage = totalEntryValue > 0 ? (totalRealizedPnl / totalEntryValue) * 100 : 0;
                
                const sign = totalRealizedPnl >= 0 ? '' : '-';
                const absPnl = Math.abs(totalRealizedPnl);
                realizedPnlDetails = `${sign}$${absPnl.toFixed(2)} (${realizedPnlPercentage >= 0 ? '+' : ''}${realizedPnlPercentage.toFixed(1)}%)`;
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

                // CRITICAL FIX: BBW is stored as percentage (e.g., 5.789 = 5.789%), not decimal (0.05789)
                // Convert to decimal first if BBW > 1 (indicating percentage format)
                // BBW calculation returns percentage: ((upperBand - lowerBand) / sma) * 100
                const bbwDecimal = bbw > 1 ? bbw / 100 : bbw; // Convert percentage to decimal if needed
                
                // Calculate BBW score: 0.05 (5%) = 50 score, scales linearly
                let bbwScore = Math.min(100, (bbwDecimal / 0.05) * 50);
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
            // CRITICAL FIX: Calculate from all evaluated strategies, not just executed ones
            // Priority: lastCycleAverageSignalStrength > averageSignalStrength (from StrategyManager) > calculate from cycleStats
            
            // First try: Use last cycle's average (most recent)
            let avgStrength = state.stats?.lastCycleAverageSignalStrength;
            
            // Second try: Use overall average from StrategyManagerService (calculated from active strategies)
            if (!avgStrength || !Number.isFinite(avgStrength) || avgStrength === 0) {
                avgStrength = state.stats?.averageSignalStrength;
            }
            
            // Third try: Calculate from recent signal history if available
            // Use the most recent cycle's data from history
            if ((!avgStrength || !Number.isFinite(avgStrength) || avgStrength === 0) && history.length > 0) {
                // Try to get strength from the most recent cycle stats if stored
                // Note: This is a fallback - primary source should be state.stats.averageSignalStrength
            }
            
            // Fourth try: If we have strategies being evaluated but no strength data, use active strategies average
            if ((!avgStrength || !Number.isFinite(avgStrength) || avgStrength === 0) && history.length > 0) {
                const recentSignals = history.slice(-5); // Last 5 cycles
                const totalRecentSignals = recentSignals.reduce((sum, h) => sum + (h.signalsFound || 0), 0);
                const activeStrategiesCount = state.stats?.activeStrategies || 0;
                
                // If hundreds of strategies are being evaluated, they likely have some strength
                if (totalRecentSignals > 0 && activeStrategiesCount > 0) {
                    // Estimate based on typical strategy strength range (50-70 for active strategies)
                    // This is a reasonable fallback when exact strength isn't available
                    avgStrength = Math.min(70, Math.max(50, 50 + Math.min(20, totalRecentSignals / 10)));
                }
            }
            
            // Default to 0 if still no valid value
            if (!avgStrength || !Number.isFinite(avgStrength)) {
                avgStrength = 0;
            }
            
            // Signal Quality Component calculation based on table:
            // Average Strength → Signal Quality Component → LPM Contribution
            // Formula: Signal Quality Component = Average Strength / 10 (capped at 100)
            // Example: 600 avg strength → 60 component → 6.0 points LPM contribution
            // Example: 587.9 avg strength → 58.79 component → 5.88 points LPM contribution
            let signalQualityComponent = avgStrength > 0 && Number.isFinite(avgStrength) 
                ? Math.min(100, (avgStrength / 10)) 
                : 50;
            
            // CRITICAL FIX: Show actual signal count and strength
            const recentSignalCount = history.length > 0 ? history.slice(-1)[0]?.signalsFound || 0 : 0;
            const activeStrategiesCount = state.stats?.activeStrategies || 0;
            
            const signalQualityDetails = avgStrength > 0 && Number.isFinite(avgStrength)
                ? `${avgStrength.toFixed(1)} avg strength (${recentSignalCount} evaluated)` 
                : recentSignalCount > 0
                    ? `${recentSignalCount} strategies evaluated`
                    : activeStrategiesCount > 0
                        ? `${activeStrategiesCount} active strategies`
                        : 'No strategies active';

            // Calculate Final Score
            // CRITICAL FIX: Removed regimeComponent and opportunityRateComponent from LPM
            // LPM should measure PERFORMANCE MOMENTUM, not market conditions or strategy count
            // Market Regime is context (input), not performance (output)
            // Opportunity Rate (strategy count) is not a performance metric
            const finalScore = (unrealizedComponent * unrealizedWeight) +
                (realizedComponent * realizedWeight) +
                // regimeComponent removed - market regime is context, not performance
                (volatilityComponent * volatilityWeight) +
                // opportunityRateComponent removed - strategy count is not a performance metric
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
                unrealized: { 
                    score: Math.round(unrealizedComponent), 
                    weight: MOMENTUM_WEIGHTS.unrealizedPnl,
                    details: unrealizedPnlDetails // CRITICAL FIX: Add details for unrealized P&L display
                },
                realized: { 
                    score: Math.round(realizedComponent), 
                    weight: MOMENTUM_WEIGHTS.realizedPnl,
                    details: realizedPnlDetails // CRITICAL FIX: Add details for realized P&L display
                },
                regime: {
                    score: Math.round(regimeComponent),
                    weight: MOMENTUM_WEIGHTS.regime,
                    details: `${marketRegime || 'N/A'} (${regimeConfidence.toFixed(0)}%)${isConfirmed ? ' ✓' : ''}`
                },
                volatility: { score: Math.round(volatilityComponent), weight: MOMENTUM_WEIGHTS.volatility, details: `ADX: ${state.marketVolatility.adx.toFixed(1)}, BBW: ${state.marketVolatility.bbw.toFixed(3)}` },
                opportunityRate: { score: Math.round(opportunityRateComponent), weight: MOMENTUM_WEIGHTS.opportunityRate, details: `${history.slice(-1)[0]?.signalsFound || 0} recent signals` },
                fearAndGreed: { score: Math.round(fearAndGreedComponent), weight: MOMENTUM_WEIGHTS.fearGreed, details: `${this.fearAndGreedData?.value || 'N/A'} (${this.fearAndGreedData?.value_classification || 'N/A'})` },
                signalQuality: { 
                    score: Math.round(signalQualityComponent), 
                    weight: MOMENTUM_WEIGHTS.signalQuality, 
                    details: signalQualityDetails // CRITICAL FIX: Use calculated details instead of always showing "0 avg strength"
                },
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
