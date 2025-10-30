import React, { useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Loader2, AlertCircle } from 'lucide-react';
import { useWallet } from '@/components/providers/WalletProvider';
import { useTradingMode } from '@/components/providers/TradingModeProvider';

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
        loading,
        error
    } = walletData;
    const recentTrades = walletData?.recentTrades || [];

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
        console.log('[WalletStatusWidget] 🔍 Raw wallet data:', currentWalletData);
        prevWalletData.current = currentWalletData;
    }
    const { isLiveMode } = useTradingMode();

    const [cachedSummary, setCachedSummary] = React.useState(null);


    // Effect to load cached summary on initial mount
    React.useEffect(() => {
        try {
            const mode = isLiveMode ? 'live' : 'testnet';
            
            // Only log once per mode change
            if (!window._walletCacheLogged || window._lastWalletMode !== mode) {
                console.log('[WalletStatusWidget] 🔍 Loading cache for mode:', mode);
                window._walletCacheLogged = true;
                window._lastWalletMode = mode;
            }
            
            const raw = localStorage.getItem(`walletSummaryCache_${mode}`);
            if (raw) {
                const snap = JSON.parse(raw);
                if (!window._walletCacheLoaded) {
                    console.log('[WalletStatusWidget] ✅ Loaded from localStorage:', snap);
                    window._walletCacheLoaded = true;
                }
                
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
                if (!window._walletCacheLoaded) {
                    console.log('[WalletStatusWidget] ✅ Loaded from window.__walletSummaryCache:', window.__walletSummaryCache);
                    window._walletCacheLoaded = true;
                }
                setCachedSummary(window.__walletSummaryCache);
            } else {
                if (!window._walletCacheNotFound) {
                    console.log('[WalletStatusWidget] ⚠️ No cache found for mode:', mode);
                    window._walletCacheNotFound = true;
                }
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
                
                if (!lastCachedData || 
                    lastCachedData.totalEquity !== summaryToCache.totalEquity ||
                    lastCachedData.availableBalance !== summaryToCache.availableBalance ||
                    lastCachedData.lifetimePnl !== summaryToCache.lifetimePnl ||
                    lastCachedData.unrealizedPnl !== summaryToCache.unrealizedPnl) {
                    console.log('[WalletStatusWidget] 💾 Saving to cache:', { mode, summaryToCache });
                }
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
    // Prefer totalRealizedPnl if provider exposes it, fallback to lifetimePnl, then cache
    let normalizedRealized = (typeof totalRealizedPnl === 'number' && !isNaN(totalRealizedPnl))
        ? totalRealizedPnl
        : (isLiveLifetimePnlValid ? lifetimePnl : (cachedSummary?.lifetimePnl ?? 0));
    // Fallback: if realized is zero or undefined but we have recent trades, sum realized from trades as a best-effort estimate
    if ((!normalizedRealized || !Number.isFinite(normalizedRealized)) && Array.isArray(recentTrades) && recentTrades.length > 0) {
        try {
            const sumTrades = recentTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
            if (Number.isFinite(sumTrades)) normalizedRealized = sumTrades;
        } catch (_e) {}
    }
    const displayLifetimePnl = normalizedRealized;
    const displayUnrealizedPnl = isLiveUnrealizedPnlValid ? unrealizedPnl : (cachedSummary?.unrealizedPnl ?? 0);
    // Display only realized P&L (exclude unrealized)
    const displayTotalPnl = (displayLifetimePnl || 0);
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
        console.log('[WalletStatusWidget] 📊 Display values:', {
            ...currentDisplayValues,
            rawValues: {
                totalEquity,
                availableBalance,
                lifetimePnl,
                unrealizedPnl,
                balanceInTrades
            },
            cachedValues: cachedSummary
        });
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