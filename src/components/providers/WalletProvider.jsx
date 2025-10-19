
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { useTradingMode } from './TradingModeProvider';

const WalletContext = createContext();

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};

export const WalletProvider = ({ children }) => {
    const { tradingMode } = useTradingMode();
    const [walletSummary, setWalletSummary] = useState(null);
    const [liveWalletState, setLiveWalletState] = useState(null);
    const [livePositions, setLivePositions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [totalEquity, setTotalEquity] = useState(0);
    const [availableBalance, setAvailableBalance] = useState(0);
    const [balanceInTrades, setBalanceInTrades] = useState(0);
    const [unrealizedPnl, setUnrealizedPnl] = useState(0);
    const [openPositionsCount, setOpenPositionsCount] = useState(0);

    const [dailyPnl, setDailyPnl] = useState(0);
    const [hourlyPnl, setHourlyPnl] = useState(0);
    const [dailyPerformanceHistory, setDailyPerformanceHistory] = useState([]);
    const [hourlyPerformanceHistory, setHourlyPerformanceHistory] = useState([]);
    const [recentTrades, setRecentTrades] = useState([]);
    const [scannerInitialized, setScannerInitialized] = useState(false);

    const periodPnl = useMemo(() => {
        if (!recentTrades || recentTrades.length === 0) return 0;
        
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const relevantTrades = recentTrades.filter(trade => {
            if (!trade.exit_timestamp) return false;
            const exitDate = new Date(trade.exit_timestamp);
            return exitDate.getTime() >= thirtyDaysAgo.getTime();
        });
        
        return relevantTrades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
    }, [recentTrades]);

    const lifetimePnl = useMemo(() => {
        const pnl = walletSummary?.totalRealizedPnl || 0;
        return pnl;
    }, [walletSummary]);

    const fetchWalletData = useCallback(async (bypassCache = false) => {
        if (!tradingMode) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Fetch WalletSummary
            const summariesFromDb = await queueEntityCall('WalletSummary', 'filter', { mode: tradingMode }, '-lastUpdated', 1);
            let latestSummary = null;
            let openPositions = [];

            if (summariesFromDb && summariesFromDb.length > 0) {
                latestSummary = summariesFromDb[0];
            } else {
                // No summary found in DB, try cache
            }

            if (!latestSummary) {
                const cacheKey = `walletSummaryCache_${tradingMode}`;
                if (typeof window !== 'undefined') {
                    const cached = localStorage.getItem(cacheKey);
                    if (cached) {
                        try {
                            latestSummary = JSON.parse(cached);
                        } catch (parseError) {
                            console.error('[WalletProvider] Failed to parse cache:', parseError);
                        }
                    }
                }
            }

            if (!latestSummary) {
                setWalletSummary(null);
                setTotalEquity(0);
                setAvailableBalance(0);
                setBalanceInTrades(0);
                setUnrealizedPnl(0);
                setOpenPositionsCount(0);
                setLoading(false);
                return;
            }

            setWalletSummary(latestSummary);
            setTotalEquity(latestSummary.totalEquity || 0);
            setAvailableBalance(latestSummary.availableBalance || 0);
            setBalanceInTrades(latestSummary.balanceInTrades || 0);
            setUnrealizedPnl(latestSummary.unrealizedPnl || 0);
            setOpenPositionsCount(latestSummary.openPositionsCount || 0);

            // 2. Fetch LiveWalletState
            const walletStates = await queueEntityCall('LiveWalletState', 'filter', { mode: tradingMode });
            
            let currentLiveWalletState = null;
            if (walletStates && walletStates.length > 0) {
                currentLiveWalletState = walletStates[0];
                setLiveWalletState(currentLiveWalletState);
                
                openPositions = await queueEntityCall(
                    'LivePosition',
                    'filter',
                    {
                        wallet_id: currentLiveWalletState.id,
                        trading_mode: tradingMode,
                        status: ['open', 'trailing']
                    }
                );
                
                setLivePositions(openPositions || []);
                const actualOpenPositionsCount = openPositions?.length || 0;
                setOpenPositionsCount(actualOpenPositionsCount); 
                
            } else {
                setLiveWalletState(null);
                setLivePositions([]);
                setOpenPositionsCount(0);
            }

            // 3. Fetch HistoricalPerformance data
            const dailyRecords = await queueEntityCall(
                'HistoricalPerformance',
                'filter',
                {
                    mode: tradingMode,
                    period_type: 'daily'
                },
                '-snapshot_timestamp',
                60
            );
            
            const hourlyRecords = await queueEntityCall(
                'HistoricalPerformance',
                'filter',
                {
                    mode: tradingMode,
                    period_type: 'hourly'
                },
                '-snapshot_timestamp',
                72
            );
            
            setDailyPerformanceHistory(Array.isArray(dailyRecords) ? dailyRecords.sort((a, b) => 
                new Date(a.snapshot_timestamp).getTime() - new Date(b.snapshot_timestamp).getTime()
            ) : []);
            setHourlyPerformanceHistory(Array.isArray(hourlyRecords) ? hourlyRecords.sort((a, b) => 
                new Date(a.snapshot_timestamp).getTime() - new Date(b.snapshot_timestamp).getTime()
            ) : []);
            
            const mostRecentDaily = dailyRecords && dailyRecords.length > 0 ? dailyRecords[0] : null;
            const mostRecentHourly = hourlyRecords && hourlyRecords.length > 0 ? hourlyRecords[0] : null;
            
            setDailyPnl(mostRecentDaily?.period_pnl || 0);
            setHourlyPnl(mostRecentHourly?.period_pnl || 0);
            
            // 4. Fetch recent trades for calculations
            const trades = await queueEntityCall(
                'Trade',
                'filter',
                { trading_mode: tradingMode },
                '-exit_timestamp',
                300
            );
            
            setRecentTrades(Array.isArray(trades) ? trades : []);

            const cacheKey = `walletSummaryCache_${tradingMode}`;
            if (typeof window !== 'undefined') {
                localStorage.setItem(cacheKey, JSON.stringify(latestSummary));
            }

        } catch (err) {
            console.error('[WalletProvider] Error fetching wallet data:', err);
            setError(err.message);
            
            // Attempt to load from cache on error
            const cacheKey = `walletSummaryCache_${tradingMode}`;
            if (typeof window !== 'undefined') {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const cachedSummary = JSON.parse(cached);
                        setWalletSummary(cachedSummary);
                        setTotalEquity(cachedSummary.totalEquity || 0);
                        setAvailableBalance(cachedSummary.availableBalance || 0);
                        setBalanceInTrades(cachedSummary.balanceInTrades || 0);
                        setUnrealizedPnl(cachedSummary.unrealizedPnl || 0);
                        setOpenPositionsCount(cachedSummary.openPositionsCount || 0);
                    } catch (parseError) {
                        console.error('[WalletProvider] Failed to parse cached data after error:', parseError);
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    }, [tradingMode]);

    useEffect(() => {
        const scanner = getAutoScannerService();
        
        const unsubscribe = scanner.subscribeToWalletUpdates(() => {
            fetchWalletData(false);
        });

        const unsubscribeScanner = scanner.subscribe((state) => {
            if (state.isInitialized !== scannerInitialized) {
                setScannerInitialized(state.isInitialized);
                
                if (state.isInitialized && scanner.positionManager) {
                    const pmPositions = [...scanner.positionManager.positions];
                    setLivePositions(pmPositions);
                    setOpenPositionsCount(pmPositions.length);
                }
            }
        });

        return () => { 
            if (unsubscribe) unsubscribe(); 
            if (unsubscribeScanner) unsubscribeScanner();
        };
    }, [fetchWalletData, scannerInitialized]);

    useEffect(() => {
        fetchWalletData();
    }, [tradingMode, fetchWalletData]);

    const refreshWallet = useCallback(async () => {
        await fetchWalletData(true);
    }, [fetchWalletData]);

    const value = {
        walletSummary,
        totalEquity,
        availableBalance,
        totalRealizedPnl: walletSummary?.totalRealizedPnl || 0,
        periodPnl,
        lifetimePnl,
        unrealizedPnl,
        balanceInTrades,
        dailyPnl,
        hourlyPnl,
        dailyPerformanceHistory,
        hourlyPerformanceHistory,
        winRate: walletSummary?.winRate || 0,
        profitFactor: walletSummary?.profitFactor || 0,
        winningTradesCount: walletSummary?.winningTradesCount || 0,
        totalTradesCount: walletSummary?.totalTradesCount || 0,
        totalGrossProfit: walletSummary?.totalGrossProfit || 0,
        totalGrossLoss: walletSummary?.totalGrossLoss || 0,
        
        openPositionsCount,
        
        liveWalletState,
        positions: livePositions,
        balances: liveWalletState?.balances || [],
        recentTrades,
        
        loading,
        error,
        scannerInitialized,
        refreshWallet
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    );
};
