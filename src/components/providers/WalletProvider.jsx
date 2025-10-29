import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { useTradingMode } from './TradingModeProvider';
import centralWalletStateManager from '@/components/services/CentralWalletStateManager';

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
    const [centralState, setCentralState] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [scannerInitialized, setScannerInitialized] = useState(false);

    // Performance history states
    const [dailyPnl, setDailyPnl] = useState(0);
    const [hourlyPnl, setHourlyPnl] = useState(0);
    const [dailyPerformanceHistory, setDailyPerformanceHistory] = useState([]);
    const [hourlyPerformanceHistory, setHourlyPerformanceHistory] = useState([]);
    const [recentTrades, setRecentTrades] = useState([]);

    // Performance optimization: Debounce state updates
    const updateTimeoutRef = useRef(null);
    const lastUpdateRef = useRef(0);

    // Computed values from central state
    const totalEquity = centralState?.total_equity || 0;
    const availableBalance = centralState?.available_balance || 0;
    const balanceInTrades = centralState?.balance_in_trades || 0;
    const unrealizedPnl = centralState?.unrealized_pnl || 0;
    const openPositionsCount = centralState?.open_positions_count || 0;
    const lifetimePnl = centralState?.total_realized_pnl || 0;
    
    // Extract arrays from central state
    const balances = centralState?.balances || [];
    const positions = centralState?.positions || [];

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


    // Debounced state update function
    const debouncedSetCentralState = useCallback((newState) => {
        const now = Date.now();
        
        // Clear existing timeout
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        
        // If this is a rapid update (within 100ms), debounce it
        if (now - lastUpdateRef.current < 100) {
            updateTimeoutRef.current = setTimeout(() => {
                setCentralState(newState);
                setLoading(false);
                lastUpdateRef.current = Date.now();
            }, 100);
        } else {
            // Update immediately for non-rapid updates
            setCentralState(newState);
            setLoading(false);
            lastUpdateRef.current = now;
        }
    }, []);

    // Initialize central wallet state manager
    useEffect(() => {
        const initializeCentralWallet = async () => {
            if (!tradingMode) return;
            
            try {
                setLoading(true);
                setError(null);
                
                await centralWalletStateManager.initialize(tradingMode);
                
                // Subscribe to state changes with debounced updates
                const unsubscribe = centralWalletStateManager.subscribe(debouncedSetCentralState);
                
                // Check if scanner is initialized
                const scannerService = getAutoScannerService();
                if (scannerService) {
                    setScannerInitialized(scannerService.state?.isInitialized || false);
                }
                
                return unsubscribe;
            } catch (error) {
                console.error('[WalletProvider] ❌ Failed to initialize central wallet state:', error);
                setError(error.message);
                setLoading(false);
            }
        };

        let unsubscribe;
        initializeCentralWallet().then(unsub => {
            unsubscribe = unsub;
        });

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [tradingMode]);

    // Fetch performance history data
    const fetchPerformanceHistory = useCallback(async () => {
        if (!tradingMode) return;
        
        try {
            console.log(`[WalletProvider] 🚀 Starting background data fetch for performance history...`, {
                tradingMode: tradingMode,
                timestamp: new Date().toISOString()
            });
            
            const [dailyRecords, hourlyRecords, trades] = await Promise.all([
                queueEntityCall('HistoricalPerformance', 'filter', {
                    mode: tradingMode,
                    period_type: 'daily'
                }, '-snapshot_timestamp', 30, { timeoutMs: 15000 }).catch(() => []),
                
                queueEntityCall('HistoricalPerformance', 'filter', {
                    mode: tradingMode,
                    period_type: 'hourly'
                }, '-snapshot_timestamp', 168, { timeoutMs: 15000 }).catch(() => []),
                
                queueEntityCall('Trade', 'filter', {
                    trading_mode: tradingMode
                }, '-created_date', 100, { timeoutMs: 15000 }).catch(() => [])
            ]);
            
            console.log('[WalletProvider] 📊 Performance data fetched:', {
                dailyRecordsCount: dailyRecords?.length || 0,
                hourlyRecordsCount: hourlyRecords?.length || 0,
                tradesCount: trades?.length || 0,
                tradingMode: tradingMode,
                dailyRecords: dailyRecords,
                hourlyRecords: hourlyRecords
            });
            
            setDailyPerformanceHistory(dailyRecords || []);
            setHourlyPerformanceHistory(hourlyRecords || []);
            setRecentTrades(trades || []);
            
            // Calculate PnL values
            const dailyPnlValue = dailyRecords?.reduce((sum, record) => sum + (record.pnl_usdt || 0), 0) || 0;
            const hourlyPnlValue = hourlyRecords?.reduce((sum, record) => sum + (record.pnl_usdt || 0), 0) || 0;
            
            setDailyPnl(dailyPnlValue);
            setHourlyPnl(hourlyPnlValue);
            
            console.log('[WalletProvider] 📈 Performance history state updated:', {
                dailyPerformanceHistoryLength: dailyRecords?.length || 0,
                hourlyPerformanceHistoryLength: hourlyRecords?.length || 0,
                dailyRecordsSample: dailyRecords?.slice(0, 3) || [],
                hourlyRecordsSample: hourlyRecords?.slice(0, 3) || []
            });
            
            console.log('[WalletProvider] ✅ Performance data state updated:', {
                dailyPerformanceHistoryLength: dailyRecords?.length || 0,
                hourlyPerformanceHistoryLength: hourlyRecords?.length || 0,
                recentTradesLength: trades?.length || 0,
                dailyPnl: dailyPnlValue,
                hourlyPnl: hourlyPnlValue
            });
            
        } catch (error) {
            console.error('[WalletProvider] ❌ Error fetching performance history:', error);
        }
    }, [tradingMode]);

    // Fetch performance history on mount and periodically
    useEffect(() => {
        if (!tradingMode) return;
        
        fetchPerformanceHistory();
        
        // Set up periodic refresh every 5 minutes
        const interval = setInterval(fetchPerformanceHistory, 5 * 60 * 1000);
        
        return () => clearInterval(interval);
    }, [fetchPerformanceHistory]);

    // Monitor scanner initialization
    useEffect(() => {
        const checkScannerStatus = () => {
            const scannerService = getAutoScannerService();
            if (scannerService) {
                const isInitialized = scannerService.state?.isInitialized || false;
                if (isInitialized !== scannerInitialized) {
                    setScannerInitialized(isInitialized);
                }
            }
        };

        const interval = setInterval(checkScannerStatus, 1000);
        return () => clearInterval(interval);
    }, [scannerInitialized]);

    // Force refresh function for external calls
    const forceRefresh = useCallback(async () => {
        if (!tradingMode) return;
        
        try {
            await centralWalletStateManager.syncWithBinance(tradingMode);
            await fetchPerformanceHistory();
        } catch (error) {
            console.error('[WalletProvider] ❌ Force refresh failed:', error);
        }
    }, [tradingMode, fetchPerformanceHistory]);

    // Expose force refresh globally for debugging
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.forceWalletRefresh = forceRefresh;
        }
    }, [forceRefresh]);

    // Create walletSummary object for backward compatibility
    const walletSummary = useMemo(() => ({
        totalEquity,
        availableBalance,
        balanceInTrades,
        unrealizedPnl,
        openPositionsCount,
        lifetimePnl,
        balances,
        positions,
        lastUpdated: centralState?.last_updated_timestamp || new Date().toISOString()
    }), [totalEquity, availableBalance, balanceInTrades, unrealizedPnl, openPositionsCount, lifetimePnl, balances, positions, centralState]);

    // Performance optimization: Memoize context value with shallow comparison
    const contextValue = useMemo(() => {
        const value = {
            // Core wallet data from central state
            totalEquity,
            availableBalance,
            balanceInTrades,
            unrealizedPnl,
            openPositionsCount,
            lifetimePnl,
            
            // Raw data arrays
            balances,
            positions,
            
            // Performance data
            dailyPnl,
            hourlyPnl,
            dailyPerformanceHistory,
            hourlyPerformanceHistory,
            recentTrades,
            periodPnl,
            
            // State
            loading,
            error,
            scannerInitialized,
            
            // Central state (for debugging)
            centralState,
            
            // Backward compatibility
            walletSummary,
            
            // Actions
            forceRefresh
        };
        
        // Only log context value changes, not every render
        if (process.env.NODE_ENV === 'development') {
            // Removed verbose logging
        }
        
        return value;
    }, [
        totalEquity,
        availableBalance,
        balanceInTrades,
        unrealizedPnl,
        openPositionsCount,
        lifetimePnl,
        balances,
        positions,
        dailyPnl,
        hourlyPnl,
        dailyPerformanceHistory,
        hourlyPerformanceHistory,
        recentTrades,
        periodPnl,
        loading,
        error,
        scannerInitialized,
        centralState,
        walletSummary,
        forceRefresh
    ]);

    return (
        <WalletContext.Provider value={contextValue}>
            {children}
        </WalletContext.Provider>
    );
};