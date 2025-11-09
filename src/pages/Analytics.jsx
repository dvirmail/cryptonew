
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Trade } from '@/api/entities';
// NOTE: HistoricalPerformance removed - analytics now use trades directly
import { BacktestCombination } from '@/api/entities';
import { Loader2 } from 'lucide-react';
import AnalyticsMetrics from '@/components/dashboard/AnalyticsMetrics';
import RegimePerformanceChart from '@/components/dashboard/RegimePerformanceChart';
import StrategyTypePerformance from '@/components/dashboard/StrategyTypePerformance';
import StrategyProfitVsBtcChart from '@/components/dashboard/StrategyProfitVsBtcChart';
import MomentumPerformanceChart from '@/components/dashboard/MomentumPerformanceChart';
import TimeOfDayPerformanceChart from '@/components/dashboard/TimeOfDayPerformanceChart';
import StrengthProfitChart from '@/components/dashboard/StrengthProfitChart';
import ConvictionProfitChart from '@/components/dashboard/ConvictionProfitChart';
import TimeframePerformanceChart from '@/components/dashboard/TimeframePerformanceChart';
import FearGreedBitcoinChart from '@/components/dashboard/FearGreedBitcoinChart';
import TradeAnalyticsDashboard from '@/components/analytics/TradeAnalyticsDashboard';
import CumulativePnLChart from '@/components/analytics/CumulativePnLChart';
import TradeAdvisorChat from '@/components/ai/TradeAdvisorChat';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { backfillTradeRegimes } from "@/api/functions";

const formatPrice = (value) => {
    const numValue = Number(value || 0);
    if (isNaN(numValue)) return '$0.00';
    return numValue.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

const calculateRegimePerformance = (trades, backtestCombinations = []) => {
    if (!trades || trades.length === 0) return [];
    
    console.log('[REGIME_CALC] Starting regime calculation', {
        tradesCount: trades.length,
        combinationsCount: backtestCombinations.length
    });
    
    // Create lookup maps by COIN (the actual trading pair)
    // BacktestCombination.coin might be "APTUSDT" or "APT/USDT"
    // Trade.symbol might be "APT/USDT" or "APTUSDT"
    const combinationByCoin = new Map();
    
    if (Array.isArray(backtestCombinations)) {
        backtestCombinations.forEach(combo => {
            if (combo.coin && combo.dominantMarketRegime) {
                // Normalize coin format: remove slashes and convert to uppercase
                const normalizedCoin = combo.coin.replace(/\//g, '').toUpperCase();
                
                // Store all combinations for this coin (there might be multiple strategies per coin)
                if (!combinationByCoin.has(normalizedCoin)) {
                    combinationByCoin.set(normalizedCoin, []);
                }
                combinationByCoin.get(normalizedCoin).push({
                    regime: combo.dominantMarketRegime,
                    name: combo.combinationName,
                    coin: combo.coin
                });
            }
        });
    }
    
    console.log('[REGIME_CALC] Built coin map with', combinationByCoin.size, 'unique coins');
    console.log('[REGIME_CALC] Sample coin entries:', Array.from(combinationByCoin.entries()).slice(0, 3));
    
    let matchedCount = 0;
    let unknownCount = 0;
    let directRegimeCount = 0;
    
    const regimeStats = trades.reduce((acc, trade) => {
        let regime = trade.market_regime;
        let matchSource = 'trade_field';
        
        // If trade doesn't have a valid regime, try to infer from BacktestCombination
        if (!regime || regime.toLowerCase() === 'unknown' || regime.trim() === '') {
            if (trade.symbol) {
                // Normalize trade symbol: remove slashes and convert to uppercase
                const normalizedSymbol = trade.symbol.replace(/\//g, '').toUpperCase();
                const matchingCombos = combinationByCoin.get(normalizedSymbol);
                
                if (matchingCombos && matchingCombos.length > 0) {
                    // Use the most common regime for this coin (or just the first one)
                    // Count regime occurrences for this coin
                    const regimeCounts = {};
                    matchingCombos.forEach(combo => {
                        regimeCounts[combo.regime] = (regimeCounts[combo.regime] || 0) + 1;
                    });
                    
                    // Find the most common regime
                    const mostCommonRegimeEntry = Object.entries(regimeCounts)
                        .sort((a, b) => b[1] - a[1])[0]; // Sort by count descending
                    
                    if (mostCommonRegimeEntry) {
                        regime = mostCommonRegimeEntry[0]; // Get the regime name
                        matchSource = 'coin_match';
                        matchedCount++;
                        
                        if (matchedCount <= 5) { // Log first 5 matches for debugging
                            //console.log(`[REGIME_MATCH] ✅ Matched symbol "${trade.symbol}" -> regime: ${regime} (from ${matchingCombos.length} combinations)`);
                        }
                    }
                } else {
                    if (unknownCount < 5) {
                        console.log(`[REGIME_UNKNOWN] ❌ No combinations found for symbol: "${trade.symbol}" (normalized: "${normalizedSymbol}")`);
                    }
                }
            }
        } else {
            directRegimeCount++;
            if (directRegimeCount <= 5) {
                console.log(`[REGIME_DIRECT] Trade already has regime: ${regime}`);
            }
        }
        
        // Final fallback to 'Unknown' if still no regime
        if (!regime || regime.toLowerCase() === 'unknown' || regime.trim() === '') {
            regime = 'Unknown';
            unknownCount++;
            
            if (unknownCount <= 5) { // Log first 5 unknown regimes after all attempts
                console.log(`[REGIME_UNKNOWN] ❌ No regime found for trade with symbol: "${trade.symbol}", strategy: "${trade.strategy_name}"`);
            }
        }
        
        if (!acc[regime]) {
            acc[regime] = { 
                totalTrades: 0, 
                winningTrades: 0, 
                totalPnl: 0, 
                grossProfit: 0, 
                grossLoss: 0 
            };
        }
        
        acc[regime].totalTrades++;
        acc[regime].totalPnl += trade.pnl_usdt || 0;
        
        if ((trade.pnl_usdt || 0) > 0) {
            acc[regime].winningTrades++;
            acc[regime].grossProfit += trade.pnl_usdt;
        } else {
            acc[regime].grossLoss += Math.abs(trade.pnl_usdt || 0);
        }
        
        return acc;
    }, {});
    
    console.log('[REGIME_CALC] Final stats:', {
        totalTrades: trades.length,
        directRegimeCount,
        matchedCount,
        unknownCount,
        regimesFound: Object.keys(regimeStats)
    });
    
    return Object.entries(regimeStats).map(([regime, stats]) => ({
        regime,
        ...stats,
        winRate: stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0,
        profitFactor: stats.grossLoss > 0 ? stats.grossProfit / stats.grossLoss : (stats.grossProfit > 0 ? 5.0 : 0),
    }));
};

const calculateStrategyTypePerformance = (trades) => {
    if (!trades || trades.length === 0) return { eventDriven: null, stateBased: null };
    
    // Debug: Check how many trades have the flag set
    const eventDrivenTrades = trades.filter(t => t.is_event_driven_strategy === true);
    const stateBasedTrades = trades.filter(t => t.is_event_driven_strategy === false);
    const undefinedOrNullTrades = trades.filter(t => t.is_event_driven_strategy === undefined || t.is_event_driven_strategy === null);
    
    console.log('[STRATEGY_TYPE_CALC]', {
        totalTrades: trades.length,
        eventDrivenCount: eventDrivenTrades.length,
        stateBasedCount: stateBasedTrades.length,
        undefinedOrNullCount: undefinedOrNullTrades.length
    });
    
    const calcStats = (filteredTrades, label) => {
        if (filteredTrades.length === 0) return null;
        const totalPnl = filteredTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
        const winningTrades = filteredTrades.filter(t => (t.pnl_usdt || 0) > 0);
        const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
        const grossLoss = filteredTrades.filter(t => (t.pnl_usdt || 0) <= 0).reduce((sum, t) => sum + Math.abs(t.pnl_usdt || 0), 0);
        
        /*console.log(`[STRATEGY_TYPE_CALC] ${label}:`, {
            tradeCount: filteredTrades.length,
            totalPnl,
            grossProfit,
            grossLoss
        });*/
        
        return {
            trade_count: filteredTrades.length,
            winRate: filteredTrades.length > 0 ? (winningTrades.length / filteredTrades.length) * 100 : 0,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 5.0 : 0),
            totalPnl,
        };
    };
    
    // Categorize trades: treat undefined/null as state-based (default assumption)
    const eventDriven = calcStats(eventDrivenTrades, 'Event-Driven');
    const stateBased = calcStats([...stateBasedTrades, ...undefinedOrNullTrades], 'State-Based (incl. undefined/null)');
    
    // Validation: Check if totals match
    const calculatedTotal = (eventDriven?.totalPnl || 0) + (stateBased?.totalPnl || 0);
    const actualTotal = trades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
    const difference = Math.abs(calculatedTotal - actualTotal);
    
    if (difference > 0.01) { // Allowing for floating point inaccuracies
        console.warn('[STRATEGY_TYPE_CALC] ⚠️ P&L mismatch detected!', {
            calculatedTotal,
            actualTotal,
            difference,
            eventDrivenPnl: eventDriven?.totalPnl || 0,
            stateBasedPnl: stateBased?.totalPnl || 0
        });
    }
    
    return {
        eventDriven,
        stateBased,
    };
};

export default function Analytics() {
    const { isLiveMode } = useTradingMode();
    const { toast } = useToast();

    // State for chart data (latest 5000 trades)
    const [analyticsData, setAnalyticsData] = useState({
        trades: [],
        isLoading: true,
        error: null
    });

    // State for all-time summary metrics (calculated from trades)
    const [summaryMetrics, setSummaryMetrics] = useState({
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0,
        profitFactor: 0,
    });

    const [isBackfilling, setIsBackfilling] = useState(false);
    const [backtestCombinations, setBacktestCombinations] = useState([]);

    // NOTE: HistoricalPerformance snapshots removed - all analytics now use trades directly

    const fetchAllAnalyticsData = useCallback(async () => {
        setAnalyticsData(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // Fetch trades and combinations in parallel
            const [tradesData, combinationsData] = await Promise.all([
                queueEntityCall('Trade', 'filter', {}, '-exit_timestamp', 10000),
                BacktestCombination.list('-created_date', 5000) // Increased limit to ensure we get all combinations
            ]);
            


            // Calculate All-Time Summary Metrics from ACTUAL TRADES
            let summaryData = { totalTrades: 0, winRate: 0, totalPnL: 0, profitFactor: 0 };
            
            if (tradesData && tradesData.length > 0) {
                const totalTrades = tradesData.length;
                const winningTrades = tradesData.filter(t => (t.pnl_usdt || 0) > 0);
                const totalPnL = tradesData.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
                const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
                const grossLoss = Math.abs(tradesData.filter(t => (t.pnl_usdt || 0) <= 0).reduce((sum, t) => sum + (t.pnl_usdt || 0), 0));

                summaryData = {
                    totalTrades,
                    winRate: totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0,
                    totalPnL,
                    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
                };
            }
            setSummaryMetrics(summaryData);

            // Set data for charts and other components
            setAnalyticsData({
                trades: tradesData || [],
                isLoading: false,
                error: null
            });
            setBacktestCombinations(combinationsData || []);

        } catch (error) {
            console.error('[DEBUG_FRONTEND] Analytics: Error fetching data:', error);
            setAnalyticsData(prev => ({
                ...prev,
                isLoading: false,
                error: error.message || 'Failed to fetch analytics data.'
            }));
            setSummaryMetrics({ totalTrades: 0, winRate: 0, totalPnL: 0, profitFactor: 0 });
            setBacktestCombinations([]);
        }
    }, [isLiveMode]);

    useEffect(() => {
        fetchAllAnalyticsData();
    }, [isLiveMode, fetchAllAnalyticsData]);

    const handleBackfill = async () => {
        console.log('[BACKFILL] Starting regime backfill process...');
        setIsBackfilling(true);
        toast({
            title: "Starting Regime Backfill",
            description: "Fetching all trade and strategy data...",
        });
        
        let totalUpdated = 0;
        let totalFailed = 0;

        try {
            // 1. Fetch all necessary data on the client first
            console.log('[BACKFILL] Fetching BacktestCombination data...');
            const combinations = await BacktestCombination.list('-created_date', 5000);
            console.log(`[BACKFILL] Fetched ${combinations?.length || 0} combinations.`);

            console.log('[BACKFILL] Fetching ALL trades from database...');
            const allTrades = await Trade.list('-exit_timestamp', 10000); // Match the analytics fetch limit to platform max
            console.log(`[BACKFILL] Fetched ${allTrades.length} total trades.`);

            const tradesToProcess = allTrades.filter(t => !t.market_regime || t.market_regime.toLowerCase() === 'unknown');
            const totalToProcess = tradesToProcess.length;
            console.log(`[BACKFILL] Found ${totalToProcess} trades that need a regime update.`);

            if (totalToProcess === 0) {
                toast({ title: "No Action Needed", description: "All trades already have a market regime." });
                setIsBackfilling(false);
                return;
            }

            // 2. Process trades in batches by calling the function multiple times
            const BATCH_SIZE = 200;
            for (let i = 0; i < totalToProcess; i += BATCH_SIZE) {
                const batch = tradesToProcess.slice(i, i + BATCH_SIZE);
                console.log(`[BACKFILL] Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(totalToProcess / BATCH_SIZE)} (${batch.length} trades)`);
                
                toast({
                    title: "Backfilling in Progress...",
                    description: `Processing trades ${i + 1}-${Math.min(i + BATCH_SIZE, totalToProcess)} of ${totalToProcess}...`,
                });

                // The backfillTradeRegimes function (imported) handles the logic of matching combinations to trades
                // It should internally use the same coin-based matching logic as calculateRegimePerformance
                const response = await backfillTradeRegimes({ 
                    combinations: combinations || [], 
                    trades: batch, // Send only the current batch
                });

                if (response.data.success) {
                    totalUpdated += response.data.updatedCount || 0;
                    totalFailed += response.data.failedCount || 0;
                    console.log(`[BACKFILL] Batch successful. Updated: ${response.data.updatedCount}, Failed: ${response.data.failedCount}`);
                } else {
                    console.error('[BACKFILL] ❌ Batch failed:', response.data);
                    throw new Error(response.data.error || response.data.message || "A batch failed to process.");
                }
            }

            console.log(`[BACKFILL] ✅ Backfill completed successfully. Total updated: ${totalUpdated}, Total failed: ${totalFailed}.`);
            toast({
                title: "Backfill Complete",
                description: `Successfully processed all batches. Updated ${totalUpdated} trades.`,
            });
            
            console.log('[BACKFILL] Refreshing analytics data...');
            fetchAllAnalyticsData(); // Refresh data

        } catch (error) {
            console.error("[BACKFILL] ❌ Exception during backfill process:", error);
            const errorMessage = error.response?.data?.message || error.message || "An unknown error occurred.";
            toast({
                title: "Backfill Failed",
                description: `An error occurred: ${errorMessage}`,
                variant: "destructive",
            });
        } finally {
            console.log('[BACKFILL] Backfill process finished, cleaning up...');
            setIsBackfilling(false);
        }
    };

    // This useMemo is now only for chart-specific calculations, specifically for best/worst strategy from recent trades.
    const recentTradeMetrics = useMemo(() => {
        const trades = analyticsData.trades;
        if (!trades || trades.length === 0) return { bestStrategy: null, worstStrategy: null };

        const strategyMap = {};
        trades.forEach(trade => {
            const strategy = trade.strategy_name || 'Unknown';
            if (!strategyMap[strategy]) {
                strategyMap[strategy] = { pnl: 0 };
            }
            strategyMap[strategy].pnl += (trade.pnl_usdt || 0);
        });

        const strategyPerformance = Object.entries(strategyMap).map(([name, data]) => ({
            strategy: name,
            totalPnL: data.pnl
        })).sort((a, b) => b.totalPnL - a.totalPnL);

        return {
            bestStrategy: strategyPerformance[0] || null,
            worstStrategy: strategyPerformance[strategyPerformance.length - 1] || null
        };
    }, [analyticsData.trades]);

    // UPDATED: Pass backtestCombinations to calculateRegimePerformance
    const regimeData = useMemo(() => 
        calculateRegimePerformance(analyticsData.trades, backtestCombinations), 
        [analyticsData.trades, backtestCombinations]
    );
    
    const strategyTypeData = useMemo(() => calculateStrategyTypePerformance(analyticsData.trades), [analyticsData.trades]);

    if (analyticsData.isLoading) { // Use the master loading indicator
        return (
            <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <span className="ml-4 text-lg">Loading {isLiveMode ? 'Live' : 'Testnet'} Analytics...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">Trading Analytics</h1>
                <Button onClick={handleBackfill} disabled={isBackfilling}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${isBackfilling ? 'animate-spin' : ''}`} />
                    {isBackfilling ? 'Backfilling Regimes...' : 'Backfill Old Trade Regimes'}
                </Button>
            </div>

            {analyticsData.error ? (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error Loading Analytics Data</AlertTitle>
                    <AlertDescription>{analyticsData.error}</AlertDescription>
                </Alert>
            ) : (
                <>
                    {/* --- Basic metrics cards now use summaryMetrics state --- */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Total Trades</CardTitle>
                                <CardDescription className="text-xs pt-1">(All Available)</CardDescription>
                            </CardHeader>
                            <CardContent><div className="text-2xl font-bold">{summaryMetrics.totalTrades.toLocaleString()}</div></CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Win Rate</CardTitle>
                                <CardDescription className="text-xs pt-1">(All Available)</CardDescription>
                            </CardHeader>
                            <CardContent><div className="text-2xl font-bold text-green-600">{summaryMetrics.winRate.toFixed(1)}%</div></CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Total P&L</CardTitle>
                                <CardDescription className="text-xs pt-1">(All Available Realized)</CardDescription>
                            </CardHeader>
                            <CardContent><div className={`text-2xl font-bold ${summaryMetrics.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatPrice(summaryMetrics.totalPnL)}</div></CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Profit Factor</CardTitle>
                                <CardDescription className="text-xs pt-1">(All Available)</CardDescription>
                            </CardHeader>
                            <CardContent><div className="text-2xl font-bold">{summaryMetrics.profitFactor === Infinity ? '∞' : summaryMetrics.profitFactor.toFixed(2)}</div></CardContent>
                        </Card>
                    </div>

                    {/* Cumulative P&L Chart */}
                    <CumulativePnLChart tradingMode={isLiveMode ? 'live' : 'testnet'} />

                    {/* NEW: Trade Analytics Dashboard with Exit Metrics */}
                    <TradeAnalyticsDashboard tradingMode={isLiveMode ? 'live' : 'testnet'} />

                    {/* NEW: AI Trade Advisor Chat */}
                    <Card className="h-[600px] mb-6">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-primary" />
                                AI Trade Advisor
                            </CardTitle>
                            <CardDescription>
                                Ask AI about your trading performance, strategies, and get personalized recommendations based on your trade analytics
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 h-[calc(100%-120px)]">
                            <TradeAdvisorChat tradingMode={isLiveMode ? 'live' : 'testnet'} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Detailed Analytics</CardTitle>
                            <CardDescription>
                                The charts below are based on analysis of up to {analyticsData.trades?.length?.toLocaleString() || 0} of your most recent trades.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                             {/* Performance charts */}
                            <div className="grid gap-6">
                                {/* NOTE: HistoricalPerformance snapshots removed - FearGreedBitcoinChart should be updated to use trades */}
                                <FearGreedBitcoinChart dailyPerformanceHistory={[]} hourlyPerformanceHistory={[]} />
                                <RegimePerformanceChart regimeData={regimeData} />
                                <StrategyTypePerformance data={strategyTypeData} />
                                <MomentumPerformanceChart trades={analyticsData.trades} />
                                <TimeOfDayPerformanceChart trades={analyticsData.trades} />
                                <StrengthProfitChart trades={analyticsData.trades} backtestCombinations={backtestCombinations} />
                                <ConvictionProfitChart trades={analyticsData.trades} backtestCombinations={backtestCombinations} />
                                <TimeframePerformanceChart trades={analyticsData.trades} backtestCombinations={backtestCombinations} />
                                <StrategyProfitVsBtcChart trades={analyticsData.trades} />
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
