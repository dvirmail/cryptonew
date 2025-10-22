
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
    const [backgroundSyncing, setBackgroundSyncing] = useState(false);

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
        const pnl = walletSummary?.totalRealizedPnl || walletSummary?.total_realized_pnl || 0;
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
            // 1. Parallel fetch of critical data for faster loading
            const [summariesFromDb, walletStates] = await Promise.all([
                queueEntityCall('WalletSummary', 'filter', { trading_mode: tradingMode }, '-updated_date', 1, { timeoutMs: 15000 }),
                queueEntityCall('LiveWalletState', 'filter', { trading_mode: tradingMode }, null, null, { timeoutMs: 15000 }).catch(error => {
                    console.error('[WalletProvider] Error fetching LiveWalletState:', error);
                    return [];
                })
            ]);
            
            let latestSummary = null;
            let openPositions = [];

            if (summariesFromDb && summariesFromDb.length > 0) {
                latestSummary = summariesFromDb[0];
            }
            
            // If no LiveWalletState found, trigger automatic background sync
            if (!walletStates || walletStates.length === 0) {
                // Trigger automatic background sync without blocking UI
                setTimeout(async () => {
                    try {
                        setBackgroundSyncing(true);
                        const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
                        const scannerService = getAutoScannerService();
                        await scannerService.reinitializeWalletFromBinance();
                        // Refresh wallet data after sync completes
                        fetchWalletData();
                    } catch (error) {
                        console.error('[WalletProvider] Automatic background sync failed:', error);
                    } finally {
                        setBackgroundSyncing(false);
                    }
                }, 1000); // Start sync 1 second after UI loads
            }
            
            let currentLiveWalletState = null;
            if (walletStates && walletStates.length > 0) {
                currentLiveWalletState = walletStates[0];
                setLiveWalletState(currentLiveWalletState);
                
                // DEBUG: Add logging to understand the filter parameters
                console.log('[WalletProvider] 🔍 Fetching positions with filter:', {
                    wallet_id: currentLiveWalletState.id,
                    trading_mode: tradingMode,
                    status: ['open', 'trailing']
                });
                
                openPositions = await queueEntityCall(
                    'LivePosition',
                    'filter',
                    {
                        wallet_id: currentLiveWalletState.id,
                        trading_mode: tradingMode,
                        status: ['open', 'trailing']
                    },
                    null,
                    null,
                    { timeoutMs: 15000 }
                );
                
                console.log('[WalletProvider] 📊 Found positions:', {
                    count: openPositions?.length || 0,
                    positions: openPositions?.map(p => ({
                        id: p.id,
                        position_id: p.position_id,
                        symbol: p.symbol,
                        status: p.status,
                        trading_mode: p.trading_mode,
                        wallet_id: p.wallet_id
                    })) || []
                });
                
                // FALLBACK: If no positions found with strict filter, try broader search
                if (!openPositions || openPositions.length === 0) {
                    console.log('[WalletProvider] 🔄 No positions found with strict filter, trying broader search...');
                    
                    // Try without status filter
                    const allPositions = await queueEntityCall(
                        'LivePosition',
                        'filter',
                        {
                            wallet_id: currentLiveWalletState.id,
                            trading_mode: tradingMode
                        },
                        null,
                        null,
                        { timeoutMs: 15000 }
                    );
                    
                    console.log('[WalletProvider] 📊 All positions for wallet:', {
                        count: allPositions?.length || 0,
                        positions: allPositions?.map(p => ({
                            id: p.id,
                            position_id: p.position_id,
                            symbol: p.symbol,
                            status: p.status,
                            trading_mode: p.trading_mode,
                            wallet_id: p.wallet_id
                        })) || []
                    });
                    
                    // Filter to only open/trailing positions
                    const filteredPositions = (allPositions || []).filter(p => 
                        p.status === 'open' || p.status === 'trailing'
                    );
                    
                    console.log('[WalletProvider] ✅ Filtered positions:', {
                        count: filteredPositions.length,
                        positions: filteredPositions.map(p => ({
                            id: p.id,
                            position_id: p.position_id,
                            symbol: p.symbol,
                            status: p.status
                        }))
                    });
                    
                    setLivePositions(filteredPositions);
                    setOpenPositionsCount(filteredPositions.length);
                } else {
                    setLivePositions(openPositions || []);
                    const actualOpenPositionsCount = openPositions?.length || 0;
                    setOpenPositionsCount(actualOpenPositionsCount);
                } 
                
            } else {
                setLiveWalletState(null);
                setLivePositions([]);
                setOpenPositionsCount(0);
            }

            // If no WalletSummary was found, try to use LiveWalletState data
            if (!latestSummary && currentLiveWalletState) {
                // Create a mock summary from LiveWalletState data
                latestSummary = {
                    totalEquity: parseFloat(currentLiveWalletState.total_equity || 0),
                    availableBalance: parseFloat(currentLiveWalletState.available_balance || 0),
                    total_equity: currentLiveWalletState.total_equity,
                    available_balance: currentLiveWalletState.available_balance,
                    total_realized_pnl: currentLiveWalletState.total_realized_pnl || "0",
                    unrealized_pnl: currentLiveWalletState.unrealized_pnl || "0",
                    balance_in_trades: "0",
                    open_positions_count: 0
                };
            }

            // Now set wallet values from either WalletSummary or LiveWalletState
            if (latestSummary) {
                setWalletSummary(latestSummary);
                const totalEquityValue = parseFloat(latestSummary.totalEquity || latestSummary.total_equity || 0);
                const availableBalanceValue = parseFloat(latestSummary.availableBalance || latestSummary.available_balance || 0);
                setTotalEquity(totalEquityValue);
                setAvailableBalance(availableBalanceValue);
                setBalanceInTrades(parseFloat(latestSummary.balanceInTrades || latestSummary.balance_in_trades || 0));
                setUnrealizedPnl(parseFloat(latestSummary.unrealizedPnl || latestSummary.unrealized_pnl || 0));
                // Don't set openPositionsCount here - it will be set when positions are fetched
            } else {
                setWalletSummary(null);
                setTotalEquity(0);
                setAvailableBalance(0);
                setBalanceInTrades(0);
                setUnrealizedPnl(0);
                setOpenPositionsCount(0);
            }

            // Set loading to false immediately after setting wallet values for fast UI
            setLoading(false);

            // 3. Fetch non-critical data in background (don't block UI)
            Promise.all([
                // Historical performance data (reduced limits for faster loading)
                queueEntityCall('HistoricalPerformance', 'filter', {
                    mode: tradingMode,
                    period_type: 'daily'
                }, '-snapshot_timestamp', 30, { timeoutMs: 30000 }), // 30 second timeout
                
                queueEntityCall('HistoricalPerformance', 'filter', {
                    mode: tradingMode,
                    period_type: 'hourly'
                }, '-snapshot_timestamp', 24, { timeoutMs: 30000 }), // 30 second timeout
                
                // Recent trades (reduced limit)
                queueEntityCall('Trade', 'filter', { trading_mode: tradingMode }, '-exit_timestamp', 100, { timeoutMs: 30000 }) // 30 second timeout
            ]).then(([dailyRecords, hourlyRecords, trades]) => {
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
                setRecentTrades(Array.isArray(trades) ? trades : []);
            }).catch(error => {
                console.error('[WalletProvider] Error fetching background data:', error);
            });

            // Removed localStorage caching to prevent stale data issues

        } catch (err) {
            console.error('[WalletProvider] Error fetching wallet data:', err);
            setError(err.message);
            
            // Removed localStorage caching to prevent stale data issues
        } finally {
            // Loading is now set to false earlier for faster UI
        }
    }, [tradingMode]);

    useEffect(() => {
        const scanner = getAutoScannerService();
        
        const unsubscribe = scanner.subscribeToWalletUpdates(() => {
            console.log('[WalletProvider] 🔔 Received wallet update notification, refreshing data...');
            // Only refresh if scanner is initialized
            if (scannerInitialized) {
                fetchWalletData(true); // Force refresh from database
            }
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
        // Load wallet data immediately, don't wait for scanner
        fetchWalletData();
        
        // Only set up periodic refresh if scanner is initialized
        let refreshInterval = null;
        if (scannerInitialized) {
            refreshInterval = setInterval(() => {
                fetchWalletData(true);
            }, 15000); // 15 seconds to reduce load
        }
        
        return () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        };
    }, [tradingMode, fetchWalletData, scannerInitialized]);

    const refreshWallet = useCallback(async () => {
        await fetchWalletData(true);
    }, [fetchWalletData]);

    // Sync openPositionsCount with actual livePositions array
    useEffect(() => {
        setOpenPositionsCount(livePositions.length);
    }, [livePositions]);

    const value = {
        walletSummary,
        totalEquity,
        availableBalance,
        totalRealizedPnl: walletSummary?.totalRealizedPnl || walletSummary?.total_realized_pnl || 0,
        periodPnl,
        lifetimePnl,
        unrealizedPnl,
        balanceInTrades,
        dailyPnl,
        hourlyPnl,
        dailyPerformanceHistory,
        hourlyPerformanceHistory,
        winRate: walletSummary?.winRate || walletSummary?.win_rate || 0,
        profitFactor: walletSummary?.profitFactor || walletSummary?.profit_factor || 0,
        winningTradesCount: walletSummary?.winningTradesCount || walletSummary?.winning_trades_count || 0,
        totalTradesCount: walletSummary?.totalTradesCount || walletSummary?.total_trades_count || 0,
        totalGrossProfit: walletSummary?.totalGrossProfit || walletSummary?.total_gross_profit || 0,
        totalGrossLoss: walletSummary?.totalGrossLoss || walletSummary?.total_gross_loss || 0,
        
        openPositionsCount,
        
        liveWalletState,
        positions: livePositions,
        balances: liveWalletState?.balances || [],
        recentTrades,
        
        loading,
        error,
        backgroundSyncing,
        scannerInitialized,
        refreshWallet
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    );
};
