import React, { useRef, useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Loader2, AlertCircle } from 'lucide-react';
import { useWallet } from '@/components/providers/WalletProvider';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { queueEntityCall } from '@/components/utils/apiQueue';

export default function WalletStatusWidget() {
    const loggedWalletStatusValues = useRef(false);
    const walletData = useWallet();
    const {
        totalEquity,
        availableBalance,
        balanceInTrades,
        lifetimePnl,
        unrealizedPnl,
        totalRealizedPnl,
        pnl24h,
        loading,
        error
    } = walletData;
    const recentTrades = walletData?.recentTrades || [];
    const { isLiveMode } = useTradingMode();
    
    // CRITICAL: Fetch P&L directly from database (same as activity log) to ensure accuracy
    const [directDbPnl, setDirectDbPnl] = useState(null);
    const [dbPnlLoading, setDbPnlLoading] = useState(false);
    
    useEffect(() => {
        const fetchDirectDbPnl = async () => {
            try {
                setDbPnlLoading(true);
                const tradingMode = isLiveMode ? 'live' : 'testnet';
                
                // Use same query as ScanEngineService._logWalletSummary
                const allTrades = await queueEntityCall('Trade', 'filter', 
                    { trading_mode: tradingMode }, 
                    '-exit_timestamp', 
                    10000
                ).catch(() => []);
                
                if (allTrades && allTrades.length > 0) {
                    // CRITICAL FIX: Deduplicate trades BEFORE calculating P&L to prevent inflated totals
                    // This matches the DailyPerformanceChart logic and ensures accuracy
                    const closedTrades = allTrades.filter(t => t?.exit_timestamp != null);
                    
                    // Deduplicate trades based on unique characteristics
                    const seen = new Map();
                    const uniqueTrades = [];
                    
                    closedTrades.forEach(trade => {
                        if (!trade?.exit_timestamp) return;
                        
                        // Create a unique key based on trade characteristics
                        // Using entry_price, exit_price, quantity, entry_timestamp, symbol, and strategy_name
                        // Rounded values to handle floating point precision issues
                        const entryPrice = Math.round((Number(trade.entry_price) || 0) * 10000) / 10000;
                        const exitPrice = Math.round((Number(trade.exit_price) || 0) * 10000) / 10000;
                        const quantity = Math.round((Number(trade.quantity_crypto) || Number(trade.quantity) || 0) * 1000000) / 1000000;
                        const entryTs = trade.entry_timestamp ? new Date(trade.entry_timestamp).toISOString() : '';
                        const symbol = trade.symbol || '';
                        const strategy = trade.strategy_name || '';
                        
                        // Create unique key (allow 1 second tolerance for entry_timestamp)
                        const entryDate = entryTs ? new Date(entryTs) : null;
                        const entryDateRounded = entryDate ? new Date(Math.floor(entryDate.getTime() / 1000) * 1000).toISOString() : '';
                        const uniqueKey = `${symbol}|${strategy}|${entryPrice}|${exitPrice}|${quantity}|${entryDateRounded}`;
                        
                        // Keep the first occurrence (earliest by exit_timestamp)
                        if (!seen.has(uniqueKey)) {
                            seen.set(uniqueKey, trade);
                            uniqueTrades.push(trade);
                        } else {
                            const existing = seen.get(uniqueKey);
                            const existingExit = existing?.exit_timestamp ? new Date(existing.exit_timestamp).getTime() : 0;
                            const currentExit = trade?.exit_timestamp ? new Date(trade.exit_timestamp).getTime() : 0;
                            if (currentExit > 0 && (existingExit === 0 || currentExit < existingExit)) {
                                // Remove old and add new
                                const index = uniqueTrades.indexOf(existing);
                                if (index >= 0) uniqueTrades.splice(index, 1);
                                seen.set(uniqueKey, trade);
                                uniqueTrades.push(trade);
                            }
                        }
                    });
                    
                    // Calculate P&L from deduplicated trades only
                    const computedPnl = uniqueTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
                    
                    // CRITICAL: Also calculate WITHOUT deduplication to compare with SQL query
                    const computedPnlWithoutDedup = closedTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
                    
                    // CRITICAL: Check for invalid/null/NaN pnl_usdt values
                    const invalidPnlTrades = closedTrades.filter(t => {
                        const pnl = Number(t?.pnl_usdt);
                        return isNaN(pnl) || t?.pnl_usdt === null || t?.pnl_usdt === undefined;
                    });
                    
                    setDirectDbPnl(computedPnl);
                }
            } catch (error) {
                console.error('[WalletStatusWidget] Error fetching direct DB P&L:', error);
            } finally {
                setDbPnlLoading(false);
            }
        };
        
        // Fetch on mount and periodically (every 30 seconds)
        fetchDirectDbPnl();
        const interval = setInterval(fetchDirectDbPnl, 30000);
        return () => clearInterval(interval);
    }, [isLiveMode]);

    // Debug: Log the raw wallet data to see what we're getting (only when values change)
    const prevWalletData = React.useRef({});
    const currentWalletData = {
        totalEquity,
        availableBalance,
        balanceInTrades,
        lifetimePnl,
        unrealizedPnl,
        loading,
        error
    };
    
    const walletDataHasChanged = Object.keys(currentWalletData).some(key => 
        prevWalletData.current[key] !== currentWalletData[key]
    );
    
    if (walletDataHasChanged) {
        prevWalletData.current = currentWalletData;
    }

    const [cachedSummary, setCachedSummary] = React.useState(null);


    // Effect to load cached summary on initial mount
    React.useEffect(() => {
        try {
            const mode = isLiveMode ? 'live' : 'testnet';
            
            const raw = localStorage.getItem(`walletSummaryCache_${mode}`);
            if (raw) {
                const snap = JSON.parse(raw);
                
                // Parse balance_in_trades from database field only
                const balanceInTradesValue = parseFloat(snap.balance_in_trades || 0);
                
                setCachedSummary({
                    totalEquity: parseFloat(snap.totalEquity || snap.total_equity || 0),
                    availableBalance: parseFloat(snap.availableBalance || snap.available_balance || 0),
                    lifetimePnl: parseFloat(snap.lifetimePnl || snap.total_realized_pnl || 0),
                    unrealizedPnl: parseFloat(snap.unrealizedPnl || snap.unrealized_pnl || 0),
                    balanceInTrades: balanceInTradesValue,
                });
            } else if (typeof window !== 'undefined' && window.__walletSummaryCache) {
                setCachedSummary(window.__walletSummaryCache);
            }
        } catch (_e) {
            console.error("[WalletStatusWidget] Failed to load cached wallet summary:", _e);
        }
    }, [isLiveMode]);

    // Effect to save the current wallet summary to cache when data updates
    React.useEffect(() => {
        if (!loading && !error && typeof totalEquity === 'number' && typeof availableBalance === 'number' && typeof lifetimePnl === 'number') {
            try {
                const mode = isLiveMode ? 'live' : 'testnet';
                const summaryToCache = {
                    totalEquity,
                    availableBalance,
                    lifetimePnl,
                    unrealizedPnl,
                    balanceInTrades,
                };
                // Only log cache saves when values actually change
                const cacheKey = `walletSummaryCache_${mode}`;
                const lastCached = localStorage.getItem(cacheKey);
                const lastCachedData = lastCached ? JSON.parse(lastCached) : null;
                
                localStorage.setItem(`walletSummaryCache_${mode}`, JSON.stringify(summaryToCache));
            } catch (e) {
                console.error("[WalletStatusWidget] Failed to save wallet summary to cache:", e);
            }
        }
    }, [totalEquity, availableBalance, lifetimePnl, balanceInTrades, loading, error, isLiveMode]);

    // Determine which values to display, prioritizing live data over cached data
    const isLiveTotalEquityValid = typeof totalEquity === 'number' && !isNaN(totalEquity);
    const isLiveAvailableBalanceValid = typeof availableBalance === 'number' && !isNaN(availableBalance);
    const isLiveLifetimePnlValid = typeof lifetimePnl === 'number' && !isNaN(lifetimePnl);
    const isLiveUnrealizedPnlValid = typeof unrealizedPnl === 'number' && !isNaN(unrealizedPnl);
    const isLiveBalanceInTradesValid = typeof balanceInTrades === 'number' && !isNaN(balanceInTrades);

    // CRITICAL FIX: Always use live data when available, never fall back to stale cache
    const displayTotalEquity = isLiveTotalEquityValid ? totalEquity : (cachedSummary?.totalEquity ?? 0);
    const displayAvailableBalance = isLiveAvailableBalanceValid ? availableBalance : (cachedSummary?.availableBalance ?? 0);
    
    // CRITICAL FIX: Use direct DB query result (same as activity log) as PRIMARY source
    // This ensures 100% accuracy match with the activity log
    let normalizedRealized = null;
    let pnlSource = 'fallback';
    
    // PRIORITY 1: Use direct DB query result (matches activity log exactly)
    if (directDbPnl !== null && Number.isFinite(directDbPnl)) {
        normalizedRealized = directDbPnl;
        pnlSource = 'directDbQuery';
    }
    // PRIORITY 2: Fallback to recentTrades if direct DB query hasn't loaded yet
    else if (Array.isArray(recentTrades) && recentTrades.length > 0) {
        try {
            // Match scanner log calculation: sum all closed trades' pnl_usdt
            const closedTrades = recentTrades.filter(t => t?.exit_timestamp != null);
            const computedPnl = closedTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
            
            
            if (Number.isFinite(computedPnl)) {
                normalizedRealized = computedPnl;
                pnlSource = 'recentTrades';
            }
        } catch (_e) {
            console.error('[WalletStatusWidget] Error calculating P&L from trades:', _e);
        }
    }
    
    // PRIORITY 3: Fallback to central state if both above failed
    if (normalizedRealized === null || !Number.isFinite(normalizedRealized)) {
        if (typeof totalRealizedPnl === 'number' && !isNaN(totalRealizedPnl)) {
            normalizedRealized = totalRealizedPnl;
            pnlSource = 'totalRealizedPnl';
        } else if (isLiveLifetimePnlValid) {
            normalizedRealized = lifetimePnl;
            pnlSource = 'lifetimePnl';
        } else {
            normalizedRealized = cachedSummary?.lifetimePnl ?? 0;
            pnlSource = 'cache';
        }
    }
    
    // Ensure we always have a number (but preserve negative values!)
    normalizedRealized = (normalizedRealized === null || normalizedRealized === undefined) ? 0 : normalizedRealized;
    
    const displayLifetimePnl = normalizedRealized;
    const displayUnrealizedPnl = isLiveUnrealizedPnlValid ? unrealizedPnl : (cachedSummary?.unrealizedPnl ?? 0);
    // CRITICAL FIX: Use calculated P&L from trades (matches scanner log)
    // Preserve negative values (don't use || 0 which would convert -0.5 to 0)
    const displayTotalPnl = displayLifetimePnl; // Always show total realized P&L from trades
    const displayBalanceInTrades = balanceInTrades; // ALWAYS use live data, never cache for balanceInTrades

    // Debug: Log display values (only when values change)
    const prevDisplayValues = React.useRef({});
    const currentDisplayValues = {
        totalEquity: displayTotalEquity,
        availableBalance: displayAvailableBalance,
        lifetimePnl: displayLifetimePnl,
        unrealizedPnl: displayUnrealizedPnl,
        totalPnl: displayTotalPnl,
        balanceInTrades: displayBalanceInTrades,
        hasCachedData: !!cachedSummary,
        isLiveDataValid: isLiveTotalEquityValid || isLiveAvailableBalanceValid
    };
    
    const displayValuesHaveChanged = Object.keys(currentDisplayValues).some(key => 
        prevDisplayValues.current[key] !== currentDisplayValues[key]
    );
    
    if (displayValuesHaveChanged) {
        prevDisplayValues.current = currentDisplayValues;
    }

    // Debug logging to see current values (sample only once)
    if (!loggedWalletStatusValues.current) {
        loggedWalletStatusValues.current = true;
    }


    const formatCurrency = (value) => {
        const num = Number(value) || 0;
        if (Math.abs(num) >= 1000000) {
            return `$${(num / 1000000).toFixed(1)}M`;
        } else if (Math.abs(num) >= 1000) {
            return `$${(num / 1000).toFixed(1)}K`;
        }
        return `$${num.toLocaleString('en-US', {
            minimumFractionDigits: (num % 1 !== 0 && Math.abs(num) < 1000) ? 2 : 0,
            maximumFractionDigits: (Math.abs(num) < 1000) ? 2 : 0
        })}`;
    };

    const getPnLColor = (pnl) => {
        if (pnl > 0) return 'text-green-600';
        if (pnl < 0) return 'text-red-600';
        return 'text-gray-600';
    };

    // Render loading state only if we have no cached data and no live data
    if (loading && !cachedSummary && !isLiveTotalEquityValid && !isLiveAvailableBalanceValid) {
        console.log('[WalletStatusWidget] 🔄 Rendering loading state - no cached data available');
        return (
            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 w-32">
                <CardContent className="p-3">
                    <div className="flex flex-col items-center space-y-2">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                        <div className="text-center">
                            <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {isLiveMode ? 'LIVE' : 'TESTNET'}
                            </div>
                            <div className="text-xs text-gray-500">Loading...</div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Show cached data immediately if available, even while loading
    if (loading && cachedSummary && !isLiveTotalEquityValid && !isLiveAvailableBalanceValid) {
        console.log('[WalletStatusWidget] 📊 Showing cached data while loading live data');
        // Continue to render the main widget with cached data
    }

    // Render error state
    if (error && !cachedSummary) {
        return (
            <Card className="bg-white dark:bg-gray-800 border-red-200 dark:border-red-700 w-32">
                <CardContent className="p-3">
                    <div className="flex flex-col items-center space-y-2">
                        <AlertCircle className="h-6 w-6 text-red-600" />
                        <div className="text-center">
                            <div className="text-xs font-medium text-red-900 dark:text-red-100">
                                {isLiveMode ? 'LIVE' : 'TESTNET'}
                            </div>
                            <div className="text-xs text-red-600">Error</div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }


    return (
        <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 w-36">
            <CardContent className="p-3">
                <div className="flex flex-col space-y-2">
                    <div className="flex items-center justify-center space-x-2">
                        <Wallet className={`h-4 w-4 ${isLiveMode ? 'text-purple-600' : 'text-blue-600'}`} />
                        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                            {isLiveMode ? 'LIVE' : 'TESTNET'}
                        </span>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {formatCurrency(displayTotalEquity)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600 dark:text-gray-400">Cash:</span>
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {formatCurrency(displayAvailableBalance)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600 dark:text-gray-400">Trades:</span>
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                {formatCurrency(displayBalanceInTrades)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600 dark:text-gray-400">P&L:</span>
                            <span className={`text-xs font-medium ${getPnLColor(displayTotalPnl)}`}>
                                {formatCurrency(displayTotalPnl)}
                            </span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}