
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@/components/providers/WalletProvider';
import { useLivePrices } from '@/components/utils/useLivePrices';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink, TrendingUp, TrendingDown, MoreHorizontal, AlertCircle, RefreshCw, DollarSign, CheckCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pagination } from '@/components/ui/Pagination';
import DailyPerformanceChart from '@/components/wallet/DailyPerformanceChart';
import { format, subDays } from 'date-fns';
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import TradingModal from '@/components/trading/TradingModal';
import { useToast } from "@/components/ui/use-toast";
import { liveTradingAPI } from '@/api/functions';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const formatPrice = (price) => {
    if (price === null || price === undefined || isNaN(price)) return 'N/A';

    if (price < 0.01 && price !== 0) {
        return price.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 8
        });
    }

    return price.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
    });
};

const PositionRow = ({ position, currentPrice, onClosePosition, isClosing, scannerInitialized }) => {
    const pnl = currentPrice ? (currentPrice - position.entry_price) * position.quantity_crypto : 0;
    const pnlPercentage = position.entry_value_usdt > 0 ? (pnl / position.entry_value_usdt) * 100 : 0;
    const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';
    const PnlIcon = pnl >= 0 ? TrendingUp : TrendingDown;
    
    // Color coding for current price and value based on performance
    const currentPriceColor = currentPrice > position.entry_price ? 'text-green-600' : 
                             currentPrice < position.entry_price ? 'text-red-600' : 'text-gray-600';
    const valueColor = currentPrice > position.entry_price ? 'text-green-600' : 
                      currentPrice < position.entry_price ? 'text-red-600' : 'text-gray-600';

    const [timeLeftDisplay, setTimeLeftDisplay] = useState('N/A');

    const formatDateTime = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
            return format(new Date(timestamp), 'MMM dd HH:mm');
        } catch (e) {
            return 'N/A';
        }
    };

    useEffect(() => {
        const calculateTimeLeft = () => {
            const entryTimestamp = position.entry_timestamp || position.created_date;
            const timeExitHours = position.time_exit_hours || 24; // Default 24 hours if not set
            
            if (!entryTimestamp) {
                return 'N/A';
            }
            
            try {
                const entryTime = new Date(entryTimestamp);
                const exitTime = new Date(entryTime.getTime() + (timeExitHours * 60 * 60 * 1000));
                const now = new Date();
                const timeLeftMs = exitTime.getTime() - now.getTime();

                if (timeLeftMs <= 0) {
                    const overdueMs = Math.abs(timeLeftMs);
                    const totalSeconds = Math.floor(overdueMs / 1000);
                    const days = Math.floor((totalSeconds % (3600 * 24 * 365)) / (3600 * 24));
                    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);

                    let overdueString = '';
                    if (days > 0) {
                        overdueString = `${days}d ${hours}h`;
                    } else if (hours > 0) {
                        overdueString = `${hours}h ${minutes}m`;
                    } else if (minutes > 0) {
                        overdueString = `${minutes}m`;
                    } else {
                        overdueString = `${Math.floor(totalSeconds)}s`;
                    }

                    return (
                        <span className="text-red-500 font-medium text-xs">
                            Overdue by {overdueString}
                        </span>
                    );
                }

                const totalSeconds = Math.floor(timeLeftMs / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                if (hours === 0 && minutes === 0) {
                    return <span className="text-orange-500 font-medium">{seconds}s</span>;
                }

                if (hours === 0) {
                    return <span className="text-yellow-600 font-medium">{minutes}m {seconds}s</span>;
                }

                return <span className="text-blue-600 font-medium">{hours}h {minutes}m</span>;

            } catch (e) {
                // No console.error here
                return 'N/A';
            }
        };

        setTimeLeftDisplay(calculateTimeLeft());

        const intervalId = setInterval(() => {
            setTimeLeftDisplay(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(intervalId);
    }, [position.time_exit_hours, position.entry_timestamp, position.created_date, position.position_id, position.symbol, position]);

    const getStopLossInfo = () => {
        const items = [];
        const fmt = (num, digits = 4) => (typeof num === 'number' ? num.toFixed(digits) : num);

        const pctFromEntry = (price) => {
            if (typeof price !== 'number' || typeof position.entry_price !== 'number' || position.entry_price === 0) return null;
            return ((price - position.entry_price) / position.entry_price) * 100;
        };

        // Default SL/TP if not set
        const defaultSL = position.entry_price * 0.95; // 5% below entry
        const defaultTP = position.entry_price * 1.05; // 5% above entry
        
        const slPrice = typeof position.stop_loss_price === 'number' ? position.stop_loss_price : defaultSL;
        const tpPrice = typeof position.take_profit_price === 'number' ? position.take_profit_price : defaultTP;
        
        const slPct = pctFromEntry(slPrice);
        const tpPct = pctFromEntry(tpPrice);

        items.push(
            <div key="sl" className="flex items-center gap-1">
                <span className="text-red-600 font-medium text-xs">SL</span>
                <span className="text-xs">${fmt(slPrice)}</span>
                {typeof slPct === 'number' && (
                    <span className="text-red-500 text-xs">({slPct.toFixed(2)}%)</span>
                )}
            </div>
        );

        items.push(
            <div key="tp" className="flex items-center gap-1">
                <span className="text-green-600 font-medium text-xs">TP</span>
                <span className="text-xs">${fmt(tpPrice)}</span>
                {typeof tpPct === 'number' && (
                    <span className="text-green-500 text-xs">({tpPct.toFixed(2)}%)</span>
                )}
            </div>
        );

        const trailingActive = !!position.is_trailing || position.status === 'trailing';
        const hasTrailingOrder = !!position.trailing_stop_order_id;
        const hasTrailingStop = typeof position.trailing_stop_price === 'number';
        const trailingConfigured = trailingActive || hasTrailingOrder || hasTrailingStop;

        items.push(
            <div key="trailing" className="flex items-center gap-1">
                <span className={`font-medium text-xs ${
                    trailingActive ? 'text-blue-700' : (trailingConfigured ? 'text-gray-700' : 'text-gray-400')
                }`}>
                    {trailingActive ? 'Trailing: Active' : (trailingConfigured ? 'Trailing: Armed' : 'Trailing: Off')}
                </span>
            </div>
        );

        return (
            <div className="flex flex-col gap-1 text-xs">
                {items}
            </div>
        );
    };

    return (
        <TableRow key={position.position_id}>
            <TableCell>
                <div className="font-medium">{position.symbol}</div>
                <div className="text-xs text-gray-500">{position.strategy_name}</div>
            </TableCell>
            <TableCell>{formatPrice(position.entry_price)}</TableCell>
            <TableCell className={currentPriceColor}>
                {formatPrice(currentPrice || 0)}
            </TableCell>
            <TableCell>{position.quantity_crypto.toFixed(4)}</TableCell>
            <TableCell className={valueColor}>
                {formatPrice(position.entry_value_usdt)}
            </TableCell>
            <TableCell className={pnlColor}>
                <div className="flex items-center text-xs">
                    {pnl >= 0 ? '↗️' : '↘️'}
                    <span className="ml-1">{formatPrice(pnl)} ({pnlPercentage.toFixed(2)}%)</span>
                </div>
            </TableCell>
            <TableCell>
                <Badge variant={position.status === 'open' ? 'success' : 'secondary'} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                    {position.status}
                </Badge>
            </TableCell>
            <TableCell className="text-xs">
                {formatDateTime(position.entry_timestamp || position.created_date)}
            </TableCell>
            <TableCell className="text-xs">
                {timeLeftDisplay}
            </TableCell>
            <TableCell>
                {getStopLossInfo()}
            </TableCell>
            <TableCell>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <Button
                                    size="sm"
                                    className={`text-white ${pnl >= 0 ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-xs px-3 py-1 rounded`}
                                    onClick={() => onClosePosition(position, currentPrice)}
                                    disabled={isClosing || !scannerInitialized || !currentPrice}
                                >
                                    {isClosing ? 'Closing...' : 'Close'}
                                </Button>
                            </div>
                        </TooltipTrigger>
                        {!scannerInitialized && (
                            <TooltipContent>
                                <p className="text-xs">Waiting for automated trading system...</p>
                            </TooltipContent>
                        )}
                    </Tooltip>
                </TooltipProvider>
            </TableCell>
        </TableRow>
    );
};

const WalletPage = () => {
    const {
        totalEquity,
        availableBalance,
        totalRealizedPnl,
        unrealizedPnl,
        openPositionsCount,
        balanceInTrades,
        dailyPnl,
        hourlyPnl,
        dailyPerformanceHistory,
        hourlyPerformanceHistory,
        walletSummary,
        positions,
        balances,
        recentTrades,
        loading,
        backgroundSyncing,
        refreshWallet,
        scannerInitialized
    } = useWallet();

    const [currentPage, setCurrentPage] = useState(1);
    const [chartTimeframe, setChartTimeframe] = useState('30d');
    const [isTradingModalOpen, setIsTradingModalOpen] = useState(false);
    const [tradingModalConfig, setTradingModalConfig] = useState({ asset: '', initialSide: 'buy', availableAmount: 0 });
    const [closingPositions, setClosingPositions] = useState({});
    const [isSyncing, setIsSyncing] = useState(false);
    
    // NEW: State for asset balances pagination and filtering
    const [hideZeroBalances, setHideZeroBalances] = useState(true);
    const [balancesPage, setBalancesPage] = useState(1);
    const BALANCES_PER_PAGE = 20;
    
    const [chartPeriodStats, setChartPeriodStats] = useState({
        totalPnl: 0,
        profitFactor: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        timeframe: '30d'
    });

    const { toast } = useToast();
    const POSITIONS_PER_PAGE = 10;

    const activePositions = useMemo(() => {
        return (positions || []).filter(pos => pos.status === 'open' || pos.status === 'trailing');
    }, [positions]);

    const paginatedPositions = useMemo(() => {
        const startIndex = (currentPage - 1) * POSITIONS_PER_PAGE;
        return activePositions.slice(startIndex, startIndex + POSITIONS_PER_PAGE);
    }, [activePositions, currentPage]);

    const totalPages = Math.ceil(activePositions.length / POSITIONS_PER_PAGE);

    const symbolsToWatch = useMemo(() => {
        const positionSymbols = activePositions.map(p => p.symbol.replace('/', ''));

        const cryptoSymbols = (balances || []).filter(b => {
            if (b.asset === 'USDT') return false;
            const quantity = parseFloat(b.free) + parseFloat(b.locked);
            return quantity > 0;
        }).map(b => `${b.asset}USDT`);

        const majorCoins = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

        const prioritizedSymbols = [
            ...positionSymbols,
            ...majorCoins.filter(s => !positionSymbols.includes(s)),
            ...cryptoSymbols.filter(s => !positionSymbols.includes(s) && !majorCoins.includes(s))
        ];

        return prioritizedSymbols.slice(0, 50);
    }, [balances, activePositions]);

    const { prices: currentPrices } = useLivePrices(symbolsToWatch);

    const sortedBalances = useMemo(() => {
        if (!balances) return [];
        
        let filtered = [...balances];
        
        // Filter out zero balances if toggle is on
        if (hideZeroBalances) {
            filtered = filtered.filter(bal => {
                const total = parseFloat(bal.free || 0) + parseFloat(bal.locked || 0);
                return total > 0;
            });
        }
        
        // Sort by USD value
        return filtered.sort((a, b) => {
            const aPrice = currentPrices[`${a.asset}USDT`] || (a.asset === 'USDT' ? 1 : 0);
            const bPrice = currentPrices[`${b.asset}USDT`] || (b.asset === 'USDT' ? 1 : 0);
            const aValue = (parseFloat(a.free) + parseFloat(a.locked)) * aPrice;
            const bValue = (parseFloat(b.free) + parseFloat(b.locked)) * bPrice;
            return bValue - aValue;
        });
    }, [balances, currentPrices, hideZeroBalances]);

    // NEW: Paginated balances
    const paginatedBalances = useMemo(() => {
        const startIndex = (balancesPage - 1) * BALANCES_PER_PAGE;
        return sortedBalances.slice(startIndex, startIndex + BALANCES_PER_PAGE);
    }, [sortedBalances, balancesPage]);

    const balancesTotalPages = Math.ceil(sortedBalances.length / BALANCES_PER_PAGE);

    const handleClosePosition = async (position, currentPrice) => {
        if (!scannerInitialized) {
            toast({
                title: "Action Not Ready",
                description: 'The automated trading system is still initializing. Please wait a moment and try again.',
                variant: "warning",
            });
            return;
        }

        if (!position) return;
        setClosingPositions(prev => ({ ...prev, [position.position_id]: true }));

        try {
            const scannerService = getAutoScannerService();
            const positionManager = scannerService.positionManager;

            if (!positionManager) {
                throw new Error('PositionManager not available. Please ensure the scanner service is initialized.');
            }

            const result = await positionManager.manualClosePosition(position, currentPrice);

            if (result.success) {
                toast({
                    title: "Position Closed",
                    description: `${position.symbol} has been successfully closed. P&L: $${(result.pnl || 0).toFixed(2)}.`,
                    variant: "success",
                });
                
                refreshWallet(false).then(() => {
                    setClosingPositions(prev => {
                        const updated = { ...prev };
                        delete updated[position.position_id];
                        return updated;
                    });
                }).catch(err => {
                    // No console.warn here
                    setClosingPositions(prev => {
                        const updated = { ...prev };
                        delete updated[position.position_id];
                        return updated;
                    });
                });
            } else {
                throw new Error(result.error || 'Failed to close position.');
            }

        } catch (error) {
            // No console.error here

            let errorTitle = "Close Failed";
            let errorDescription = error.message || "An unexpected error occurred.";

            if (errorDescription.includes('dust_or_below_threshold') || errorDescription.includes('below minimum') || errorDescription.includes('minQty')) {
                errorTitle = "Position Too Small";
                errorDescription = `This position is too small to trade on Binance (minimum $5 value required). Cannot close position.`;
            } else if (errorDescription.includes('notional') || errorDescription.includes('MIN_NOTIONAL')) {
                errorTitle = "Trade Value Too Small";
                errorDescription = `Cannot close: The total value of this trade is below Binance's minimum for ${position.symbol}.`;
            } else if (errorDescription.includes('LOT_SIZE') || errorDescription.includes('step size')) {
                errorTitle = "Invalid Quantity";
                errorDescription = `Cannot close: The position quantity doesn't match Binance's required precision for ${position.symbol}.`;
            } else if (errorDescription.includes('Insufficient balance') || errorDescription.includes('-2010')) {
                errorTitle = "Insufficient Balance";
                errorDescription = `Your TESTNET account doesn't have enough ${position.symbol.split('/')[0]} to complete this sale.`;
            }

            toast({
                title: errorTitle,
                description: errorDescription,
                variant: "destructive",
            });
            
            setClosingPositions(prev => ({ ...prev, [position.position_id]: false }));
        }
    };

    useEffect(() => {
        const currentPositionIds = new Set(activePositions.map(p => p.position_id));
        setClosingPositions(prev => {
            const updated = { ...prev };
            let hasChanges = false;
            
            Object.keys(updated).forEach(posId => {
                if (!currentPositionIds.has(posId)) {
                    delete updated[posId];
                    hasChanges = true;
                }
            });
            
            return hasChanges ? updated : prev;
        });
    }, [activePositions]);

    const handleForceSync = async () => {
        if (!scannerInitialized) {
            toast({
                title: "Scanner Not Ready",
                description: "Please wait for the automated trading system to initialize before syncing.",
                variant: "warning"
            });
            return;
        }

        setIsSyncing(true);
        try {
            const scannerService = getAutoScannerService();

            await scannerService.reinitializeWalletFromBinance();

            await refreshWallet(true);

            toast({
                title: "Sync Complete",
                description: "Wallet successfully synced with Binance",
                variant: "success"
            });
        } catch (error) {
            // No console.error here
            toast({
                title: "Sync Failed",
                description: error.message || "Failed to sync with Binance",
                variant: "destructive"
            });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleTradeAction = (asset, side, availableAmount = 0) => {
        if (!scannerInitialized) {
            toast({
                title: "Action Not Ready",
                description: 'The automated trading system is still initializing. Please wait a moment and try again.',
                variant: "warning",
            });
            return;
        }
        setTradingModalConfig({ asset, initialSide: side, availableAmount });
        setIsTradingModalOpen(true);
    };

    const handleSummaryStatsChange = useCallback((stats) => {
        setChartPeriodStats(stats);
    }, []);

    // CRITICAL CHANGE: Show wallet data as soon as loading is false
    // Don't wait for scanner initialization
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading wallet data...</p>
                </div>
            </div>
        );
    }

    if (!totalEquity && !positions && !dailyPerformanceHistory?.length) { 
        return (
            <div className="p-8 text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No Wallet Data</h3>
                <p className="mt-1 text-sm text-gray-500">Could not load wallet data. Please try again.</p>
                <div className="mt-6">
                    <Button onClick={refreshWallet}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                </div>
            </div>
        );
    }

    const formatCurrency = (value) => {
        const numValue = Number(value || 0);
        if (isNaN(numValue)) return '$0.00';
        return numValue.toLocaleString('en-US', { 
            style: 'currency', 
            currency: 'USD',
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        });
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Scanner Status Indicator */}
                {!scannerInitialized && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-3">
                        <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-yellow-800">Automated Trading System Initializing...</p>
                            <p className="text-xs text-yellow-600 mt-0.5">Trading actions (close positions, buy/sell) will be available once initialization completes.</p>
                        </div>
                    </div>
                )}

                <Card className="mb-6">
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>Testnet Wallet Overview</CardTitle>
                                <CardDescription>
                                    Summary of your testnet account balances and performance.
                                </CardDescription>
                            </div>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div>
                                            <Button
                                                onClick={handleForceSync}
                                                disabled={isSyncing || !scannerInitialized}
                                                variant="outline"
                                                size="sm"
                                            >
                                                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                                                {isSyncing ? 'Syncing...' : 'Sync with Binance'}
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    {!scannerInitialized && (
                                        <TooltipContent>
                                            <p className="text-xs">Sync will be available once the trading system initializes</p>
                                        </TooltipContent>
                                    )}
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        {backgroundSyncing && (
                            <div className="mt-2 flex items-center justify-center text-sm text-blue-600">
                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                Auto-syncing with Binance...
                            </div>
                        )}
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <p className="text-sm text-gray-500">Total Equity</p>
                                <div className="text-2xl font-bold">{formatCurrency(totalEquity)}</div>
                            </div>
                            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <p className="text-sm text-gray-500">Available Cash</p>
                                <div className="text-2xl font-bold">{formatCurrency(availableBalance)}</div>
                            </div>
                            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <p className="text-sm text-gray-500">In Open Trades</p>
                                <div className="text-2xl font-bold">{formatCurrency(balanceInTrades)}</div>
                            </div>
                            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                <p className="text-sm text-gray-500">Unrealized P&L</p>
                                <div className={`text-2xl font-bold ${(unrealizedPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {formatCurrency(unrealizedPnl)}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Period P&L</CardTitle>
                            <DollarSign className="h-4 w-4 text-gray-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${chartPeriodStats.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(chartPeriodStats.totalPnl)}
                            </div>
                            <p className="text-xs text-gray-500">
                                For the last {chartPeriodStats.timeframe === 'lifetime' ? 'all time' : chartPeriodStats.timeframe}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Period Profit Factor</CardTitle>
                            <TrendingUp className="h-4 w-4 text-gray-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${isFinite(chartPeriodStats.profitFactor) && chartPeriodStats.profitFactor >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                                {isFinite(chartPeriodStats.profitFactor) ? chartPeriodStats.profitFactor.toFixed(2) : '∞'}
                            </div>
                            <p className="text-xs text-gray-500">
                                For the last {chartPeriodStats.timeframe === 'lifetime' ? 'all time' : chartPeriodStats.timeframe}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Period Win Rate</CardTitle>
                            <CheckCircle className="h-4 w-4 text-gray-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${chartPeriodStats.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                                {chartPeriodStats.winRate.toFixed(1)}%
                            </div>
                            <p className="text-xs text-gray-500">{chartPeriodStats.winningTrades} wins / {chartPeriodStats.totalTrades} trades in period</p>
                        </CardContent>
                    </Card>
                </div>

                <div className="mb-6">
                    <DailyPerformanceChart
                        trades={recentTrades}
                        timeframe={chartTimeframe}
                        onTimeframeChange={setChartTimeframe}
                        dailyPerformanceHistory={dailyPerformanceHistory}
                        hourlyPerformanceHistory={hourlyPerformanceHistory}
                        walletSummary={walletSummary}
                        onSummaryStatsChange={handleSummaryStatsChange}
                    />
                </div>

                <div className="flex flex-col gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Open Positions ({openPositionsCount})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Symbol</TableHead>
                                        <TableHead>Entry Price</TableHead>
                                        <TableHead>Current Price</TableHead>
                                        <TableHead>Quantity</TableHead>
                                        <TableHead>Value (USDT)</TableHead>
                                        <TableHead>Unrealized P&L</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Entry Time</TableHead>
                                        <TableHead>Time Left</TableHead>
                                        <TableHead>SL/TP/Trailing</TableHead>
                                        <TableHead>Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedPositions.length > 0 ? (
                                        paginatedPositions.map((pos) => (
                                            <PositionRow
                                                key={pos.position_id}
                                                position={pos}
                                                currentPrice={currentPrices[pos.symbol.replace('/', '')]}
                                                onClosePosition={handleClosePosition}
                                                isClosing={!!closingPositions[pos.position_id]}
                                                scannerInitialized={scannerInitialized}
                                            />
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan="11" className="text-center h-24">
                                                No open positions
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                             </Table>
                             {totalPages > 1 && (
                                <Pagination
                                    currentPage={currentPage}
                                    totalPages={totalPages}
                                    onPageChange={setCurrentPage}
                                    className="mt-4"
                                />
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>Asset Balances</CardTitle>
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="hide-zero-balances"
                                        checked={hideZeroBalances}
                                        onCheckedChange={(checked) => {
                                            setHideZeroBalances(checked);
                                            setBalancesPage(1); // Reset to first page when filter changes
                                        }}
                                    />
                                    <Label htmlFor="hide-zero-balances" className="text-sm cursor-pointer">
                                        Hide zero balances
                                    </Label>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Asset</TableHead>
                                        <TableHead>Total</TableHead>
                                        <TableHead>Value (USD)</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedBalances.map(bal => {
                                        const total = parseFloat(bal.free) + parseFloat(bal.locked);
                                        const price = currentPrices[`${bal.asset}USDT`] || (bal.asset === 'USDT' ? 1 : 0);
                                        const usdValue = total * price;

                                        return (
                                            <TableRow key={bal.asset}>
                                                <TableCell className="font-medium">{bal.asset}</TableCell>
                                                <TableCell>{total.toFixed(bal.asset === 'USDT' ? 2 : 4)}</TableCell>
                                                <TableCell>{formatPrice(usdValue)}</TableCell>
                                                <TableCell className="text-right">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="flex justify-end gap-2">
                                                                    <Button 
                                                                        variant="outline" 
                                                                        size="sm" 
                                                                        onClick={() => handleTradeAction(bal.asset, 'buy', availableBalance)} 
                                                                        disabled={!scannerInitialized}
                                                                    >
                                                                        Buy
                                                                    </Button>
                                                                    <Button 
                                                                        variant="outline" 
                                                                        size="sm" 
                                                                        onClick={() => handleTradeAction(bal.asset, 'sell', parseFloat(bal.free))} 
                                                                        disabled={!scannerInitialized}
                                                                    >
                                                                        Sell
                                                                    </Button>
                                                                </div>
                                                            </TooltipTrigger>
                                                            {!scannerInitialized && (
                                                                <TooltipContent>
                                                                    <p className="text-xs">Trading will be available once the system initializes</p>
                                                                </TooltipContent>
                                                            )}
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                            {balancesTotalPages > 1 && (
                                <Pagination
                                    currentPage={balancesPage}
                                    totalPages={balancesTotalPages}
                                    onPageChange={setBalancesPage}
                                    className="mt-4"
                                />
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            <TradingModal
                isOpen={isTradingModalOpen}
                onClose={() => setIsTradingModalOpen(false)}
                asset={tradingModalConfig.asset}
                initialSide={tradingModalConfig.initialSide}
                availableAmount={tradingModalConfig.availableAmount}
                onTradeSuccess={() => {
                    setIsTradingModalOpen(false);
                    refreshWallet();
                }}
            />
        </div>
    );
};

export default WalletPage;
