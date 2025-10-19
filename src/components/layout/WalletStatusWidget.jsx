import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Loader2, AlertCircle } from 'lucide-react';
import { useWallet } from '@/components/providers/WalletProvider';
import { useTradingMode } from '@/components/providers/TradingModeProvider';

export default function WalletStatusWidget() {
    const walletData = useWallet();
    const {
        totalEquity,
        availableBalance,
        lifetimePnl,
        totalRealizedPnl,
        loading,
        error
    } = walletData;
    const { isLiveMode } = useTradingMode();

    const [cachedSummary, setCachedSummary] = React.useState(null);

    // Log data from useWallet hook
    React.useEffect(() => {
        /*console.log('[WalletStatusWidget] Data from useWallet hook:', {
            totalEquity,
            availableBalance,
            lifetimePnl,
            totalRealizedPnl,
            loading,
            error,
            isLiveMode
        });*/
    }, [totalEquity, availableBalance, lifetimePnl, totalRealizedPnl, loading, error, isLiveMode]);

    // Effect to load cached summary on initial mount
    React.useEffect(() => {
        try {
            const mode =
                (window.autoScannerService && window.autoScannerService.state && window.autoScannerService.state.tradingMode) ||
                (isLiveMode ? 'live' : 'testnet');
            
            //console.log('[WalletStatusWidget] Loading cache for mode:', mode);
            
            const raw = localStorage.getItem(`walletSummaryCache_${mode}`);
            if (raw) {
                const snap = JSON.parse(raw);
                //console.log('[WalletStatusWidget] Loaded from localStorage:', snap);
                setCachedSummary({
                    totalEquity: parseFloat(snap.totalEquity || 0),
                    availableBalance: parseFloat(snap.availableBalance || 0),
                    lifetimePnl: parseFloat(snap.lifetimePnl || 0),
                });
            } else if (typeof window !== 'undefined' && window.__walletSummaryCache) {
                //console.log('[WalletStatusWidget] Loaded from window.__walletSummaryCache:', window.__walletSummaryCache);
                setCachedSummary(window.__walletSummaryCache);
            } else {
                //console.log('[WalletStatusWidget] No cache found');
            }
        } catch (_e) {
            console.error("[WalletStatusWidget] Failed to load cached wallet summary:", _e);
        }
    }, [isLiveMode]);

    // Effect to save the current wallet summary to cache when data updates
    React.useEffect(() => {
        if (!loading && !error && typeof totalEquity === 'number' && typeof availableBalance === 'number' && typeof lifetimePnl === 'number') {
            try {
                const mode =
                    (window.autoScannerService && window.autoScannerService.state && window.autoScannerService.state.tradingMode) ||
                    (isLiveMode ? 'live' : 'testnet');
                const summaryToCache = {
                    totalEquity,
                    availableBalance,
                    lifetimePnl,
                };
                //console.log('[WalletStatusWidget] Saving to cache:', { mode, summaryToCache });
                localStorage.setItem(`walletSummaryCache_${mode}`, JSON.stringify(summaryToCache));
            } catch (e) {
                console.error("[WalletStatusWidget] Failed to save wallet summary to cache:", e);
            }
        }
    }, [totalEquity, availableBalance, lifetimePnl, loading, error, isLiveMode]);

    // Determine which values to display, prioritizing live data over cached data
    const isLiveTotalEquityValid = typeof totalEquity === 'number' && !isNaN(totalEquity) && totalEquity !== 0;
    const isLiveAvailableBalanceValid = typeof availableBalance === 'number' && !isNaN(availableBalance) && availableBalance !== 0;
    const isLiveLifetimePnlValid = typeof lifetimePnl === 'number' && !isNaN(lifetimePnl);

    const displayTotalEquity = isLiveTotalEquityValid ? totalEquity : cachedSummary?.totalEquity ?? 0;
    const displayAvailableBalance = isLiveAvailableBalanceValid ? availableBalance : cachedSummary?.availableBalance ?? 0;
    const displayLifetimePnl = isLiveLifetimePnlValid ? lifetimePnl : cachedSummary?.lifetimePnl ?? 0;

    // Log display values
    React.useEffect(() => {
        /*console.log('[WalletStatusWidget] Display value calculation:', {
            isLiveTotalEquityValid,
            isLiveAvailableBalanceValid,
            isLiveLifetimePnlValid,
            displayTotalEquity,
            displayAvailableBalance,
            displayLifetimePnl,
            usingCache: {
                equity: !isLiveTotalEquityValid,
                balance: !isLiveAvailableBalanceValid,
                pnl: !isLiveLifetimePnlValid
            }
        });*/
    }, [displayTotalEquity, displayAvailableBalance, displayLifetimePnl, isLiveTotalEquityValid, isLiveAvailableBalanceValid, isLiveLifetimePnlValid]);

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

    // Render loading state
    if (loading && (!cachedSummary || (displayTotalEquity === 0 && displayAvailableBalance === 0))) {
        //console.log('[WalletStatusWidget] Rendering loading state');
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

    // Render error state
    if (error && !cachedSummary) {
        console.log('[WalletStatusWidget] Rendering error state:', error);
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

    /*console.log('[WalletStatusWidget] Rendering with values:', {
        displayTotalEquity,
        displayAvailableBalance,
        displayLifetimePnl,
        formatted: {
            equity: formatCurrency(displayTotalEquity),
            balance: formatCurrency(displayAvailableBalance),
            pnl: formatCurrency(displayLifetimePnl)
        }
    });*/

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
                            <span className="text-xs text-gray-600 dark:text-gray-400">P&L:</span>
                            <span className={`text-xs font-medium ${getPnLColor(displayLifetimePnl)}`}>
                                {formatCurrency(displayLifetimePnl)}
                            </span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}