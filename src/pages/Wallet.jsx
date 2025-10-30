
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@/components/providers/WalletProvider';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useLivePrices } from '@/components/utils/useLivePrices';
import { queueEntityCall } from '@/components/utils/apiQueue';
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

const PositionRow = React.memo(({ position, currentPrice, onClosePosition, isClosing, scannerInitialized }) => {
    // Memoize calculations to prevent duplicate processing
    const calculations = useMemo(() => {
        const pnl = currentPrice ? (currentPrice - position.entry_price) * position.quantity_crypto : 0;
        const pnlPercentage = position.entry_value_usdt > 0 ? (pnl / position.entry_value_usdt) * 100 : 0;
        const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';
        const PnlIcon = pnl >= 0 ? TrendingUp : TrendingDown;
        
        return { pnl, pnlPercentage, pnlColor, PnlIcon };
    }, [currentPrice, position.entry_price, position.quantity_crypto, position.entry_value_usdt]);
    
    const { pnl, pnlPercentage, pnlColor, PnlIcon } = calculations;
    
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
            
            // Exit time calculation (logs removed to prevent flooding)
            
            if (!entryTimestamp) {
                return 'N/A';
            }
            
            try {
                const entryTime = new Date(entryTimestamp);
                const exitTime = new Date(entryTime.getTime() + (timeExitHours * 60 * 60 * 1000));
                const now = new Date();
                const timeLeftMs = exitTime.getTime() - now.getTime();
                
                // Log exit time calculation details (throttled to prevent spam)
                const nowTime = Date.now();
                const lastLogTime = window.lastExitTimeLog || 0;
                
                if (nowTime - lastLogTime > 10000) { // Log every 10 seconds max globally
                    // console.log('[EXIT_TIME] 🕐 Exit time calculation for position:', {
                    //     // HOW EXIT TIME IS DECIDED:
                    //     exitTimeDecision: {
                    //         source: 'time_exit_hours field from position data',
                    //         value: timeExitHours,
                    //         unit: 'hours',
                    //         explanation: `Position will close after ${timeExitHours} hours from entry time`,
                    //         isFixed: timeExitHours === 24 ? 'YES - All positions use 24-hour default' : 'NO - Custom exit time'
                    //     },
                    //     symbol: position.symbol,
                    //     position_id: position.position_id,
                    //     entryTimestamp: entryTimestamp,
                    //     entryTime: entryTime.toISOString(),
                    //     timeExitHours: timeExitHours,
                    //     exitTime: exitTime.toISOString(),
                    //     currentTime: now.toISOString(),
                    //     timeLeftMs: timeLeftMs,
                    //     timeLeftHours: (timeLeftMs / (1000 * 60 * 60)).toFixed(2),
                    //     calculation: {
                    //         step1_entryTimeMs: entryTime.getTime(),
                    //         step2_timeExitHours: timeExitHours,
                    //         step3_timeExitHoursMs: timeExitHours * 60 * 60 * 1000,
                    //         step4_calculatedExitTimeMs: entryTime.getTime() + (timeExitHours * 60 * 60 * 1000),
                    //         step5_currentTimeMs: now.getTime(),
                    //         step6_timeLeftMs: timeLeftMs,
                    //         step7_timeLeftHours: (timeLeftMs / (1000 * 60 * 60)).toFixed(2),
                    //         formula: `exitTime = entryTime + (${timeExitHours} hours * 60 * 60 * 1000) = ${entryTime.getTime()} + ${timeExitHours * 60 * 60 * 1000} = ${entryTime.getTime() + (timeExitHours * 60 * 60 * 1000)}`,
                    //         timeLeftFormula: `timeLeft = exitTime - currentTime = ${entryTime.getTime() + (timeExitHours * 60 * 60 * 1000)} - ${now.getTime()} = ${timeLeftMs}`
                    //     }
                    // });
                    
                    // Store last log time globally
                    window.lastExitTimeLog = nowTime;
                }
                

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
    }, [position.time_exit_hours, position.entry_timestamp, position.created_date, position.position_id, position.symbol]);

    const getStopLossInfo = useMemo(() => {
        const items = [];
        const fmt = (num, digits = 4) => (typeof num === 'number' ? num.toFixed(digits) : num);

        // Exit parameters calculation (logs removed to prevent flooding)

        const pctFromEntry = (price) => {
            if (typeof price !== 'number' || typeof position.entry_price !== 'number' || position.entry_price === 0) return null;
            const percentage = ((price - position.entry_price) / position.entry_price) * 100;
            return percentage;
        };

        // Check if SL/TP values are realistic and log warnings if not
        const isRealisticPrice = (price, entryPrice) => {
            if (typeof price !== 'number' || typeof entryPrice !== 'number') return false;
            // Check if price is within reasonable range (not more than 10x entry price or negative)
            return price > 0 && price < entryPrice * 10 && price > entryPrice * 0.1;
        };

        // Use actual SL/TP prices and log warnings if unrealistic
        const slPrice = position.stop_loss_price;
        const tpPrice = position.take_profit_price;
        
        // Log warnings for unrealistic values
        if (typeof slPrice === 'number' && !isRealisticPrice(slPrice, position.entry_price)) {
            console.warn('[Wallet] ⚠️ WARNING: Unrealistic stop loss price:', {
                stopLossPrice: slPrice,
                entryPrice: position.entry_price,
                symbol: position.symbol,
                impact: 'SL/TP values are not logical - check ATR data and multipliers'
            });
        }
        
        if (typeof tpPrice === 'number' && !isRealisticPrice(tpPrice, position.entry_price)) {
            console.warn('[Wallet] ⚠️ WARNING: Unrealistic take profit price:', {
                takeProfitPrice: tpPrice,
                entryPrice: position.entry_price,
                symbol: position.symbol,
                impact: 'SL/TP values are not logical - check ATR data and multipliers'
            });
        }
        
        const slPct = pctFromEntry(slPrice);
        const tpPct = pctFromEntry(tpPrice);

        // Final calculated values (logs removed to prevent flooding)

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
    }, [position.entry_price, position.stop_loss_price, position.take_profit_price, position.is_trailing, position.trailing_stop_price, position.trailing_peak_price, position.peak_price, position.trough_price]);

    return (
        <TableRow key={position.position_id}>
            <TableCell>
                <div className="font-medium">{position.symbol || 'N/A'}</div>
                <div className="text-xs text-gray-500">{position.strategy_name || 'Unknown Strategy'}</div>
            </TableCell>
            <TableCell>{formatPrice(position.entry_price)}</TableCell>
            <TableCell className={currentPriceColor}>
                {formatPrice(currentPrice || 0)}
            </TableCell>
            <TableCell>{Number(position.quantity_crypto || 0).toFixed(4)}</TableCell>
            <TableCell className={valueColor}>
                {formatPrice(position.entry_value_usdt)}
            </TableCell>
            <TableCell className="text-xs">
                {position.combined_strength !== undefined && position.combined_strength !== null
                    ? Number(position.combined_strength).toFixed(2)
                    : 'N/A'}
            </TableCell>
            <TableCell className="text-xs">
                {position.conviction_score !== undefined && position.conviction_score !== null
                    ? Number(position.conviction_score).toFixed(2)
                    : 'N/A'}
            </TableCell>
            <TableCell className={pnlColor}>
                <div className="flex items-center text-xs">
                    {pnl >= 0 ? '↗️' : '↘️'}
                    <span className="ml-1">{formatPrice(pnl)} ({Number(pnlPercentage || 0).toFixed(2)}%)</span>
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
                {getStopLossInfo}
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
}, (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
    return (
        prevProps.position.position_id === nextProps.position.position_id &&
        prevProps.position.quantity_crypto === nextProps.position.quantity_crypto &&
        prevProps.position.entry_value_usdt === nextProps.position.entry_value_usdt &&
        prevProps.currentPrice === nextProps.currentPrice &&
        prevProps.isClosing === nextProps.isClosing &&
        prevProps.scannerInitialized === nextProps.scannerInitialized
    );
});

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
        forceRefresh,
        scannerInitialized
    } = useWallet();

    const { tradingMode } = useTradingMode();

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
        
        const validPositions = (positions || []).filter(pos => {
            const isValid = pos.status === 'open' || pos.status === 'trailing';
            // TEMPORARILY DISABLE STRICT FILTERING TO DEBUG
            const hasEssentialData = true; // pos.position_id && pos.symbol && pos.strategy_name;
            
            
            if (!hasEssentialData) {
            }
            
            return isValid && hasEssentialData;
        });
        
        
        return validPositions;
    }, [positions]);

    // Cleanup corrupted positions automatically
    const cleanupCorruptedPositions = useCallback(async () => {
        
        try {
            const scannerService = getAutoScannerService();
            const positionManager = scannerService.positionManager;
            
            if (!positionManager) {
                throw new Error('PositionManager not available');
            }
            
            // Get all positions from database
            const allPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: tradingMode,
                status: ['open', 'trailing']
            });
            
            
            if (!allPositions || allPositions.length === 0) {
                return;
            }
            
            // Identify corrupted positions (missing essential data)
            const corruptedPositions = allPositions.filter(pos => 
                !pos.symbol || !pos.strategy_name || !pos.quantity_crypto || pos.quantity_crypto <= 0
            );
            
            
            if (corruptedPositions.length === 0) {
                return;
            }
            
            // Delete corrupted positions
            let deletedCount = 0;
            for (const corruptedPos of corruptedPositions) {
                try {
                    
                    await queueEntityCall('LivePosition', 'delete', corruptedPos.id);
                    deletedCount++;
                } catch (deleteError) {
                    console.error('[Wallet] ❌ Error deleting corrupted position:', deleteError);
                }
            }
            
            
            // Refresh wallet data
            await forceRefresh();
            
            toast({
                title: "Cleanup Complete",
                description: `Removed ${deletedCount} corrupted positions from the database.`,
                variant: "success",
            });
            
        } catch (error) {
            console.error('[Wallet] ❌ Error during cleanup:', error);
            toast({
                title: "Cleanup Failed",
                description: `Failed to clean up corrupted positions: ${error.message}`,
                variant: "destructive",
            });
        }
    }, [tradingMode, forceRefresh]);

    const analyzeExitParameters = useCallback(async () => {
        if (!scannerInitialized) {
            toast({
                title: "Scanner Not Ready",
                description: "Please wait for the scanner to initialize.",
                variant: "destructive"
            });
            return;
        }

        try {
            console.log('[Wallet] 🔍 Starting exit parameter analysis...');
            const scannerService = getAutoScannerService();
            
            if (scannerService?.positionManager) {
                console.log('[Wallet] 🔍 Triggering exit parameter analysis...');
                await scannerService.positionManager.triggerExitParameterAnalysis();
                console.log('[Wallet] ✅ Exit parameter analysis completed - check console for detailed logs');
                
                toast({
                    title: "Analysis Complete",
                    description: "Exit parameter analysis completed. Check console for detailed logs.",
                    variant: "default"
                });
            } else {
                throw new Error('PositionManager not available');
            }
        } catch (error) {
            console.error('[Wallet] ❌ Error during exit parameter analysis:', error);
            toast({
                title: "Analysis Failed",
                description: `Error: ${error.message}`,
                variant: "destructive"
            });
        }
    }, [scannerInitialized, toast]);

    // Auto-cleanup corrupted positions and fix zero quantity positions when positions change
    const autoCleanupCorruptedPositions = useCallback(async () => {
        if (!positions || positions.length === 0) return;
        
        const corruptedPositions = positions.filter(pos => {
            const isValid = pos.status === 'open' || pos.status === 'trailing';
            const hasEssentialData = pos.position_id && pos.symbol && pos.strategy_name;
            return isValid && !hasEssentialData;
        });
        
        const zeroQuantityPositions = positions.filter(pos => {
            const isValid = pos.status === 'open' || pos.status === 'trailing';
            const hasZeroQuantity = pos.quantity_crypto === 0 || pos.entry_value_usdt === 0;
            return isValid && hasZeroQuantity;
        });
        
        if (corruptedPositions.length > 0 || zeroQuantityPositions.length > 0) {
            try {
                const scannerService = getAutoScannerService();
                if (scannerService?.positionManager) {
                    // Fix zero quantity positions first
                    if (zeroQuantityPositions.length > 0) {
                        console.log('[Wallet] 🔧 Fixing zero quantity positions:', zeroQuantityPositions.length);
                        const fixResult = await scannerService.positionManager.fixZeroQuantityPositions();
                        if (fixResult.fixed > 0) {
                            console.log(`[Wallet] ✅ Fixed ${fixResult.fixed} positions with zero quantity/value`);
                        }
                    }
                    
                    // Clean up corrupted positions
                    if (corruptedPositions.length > 0) {
                        await Promise.all(corruptedPositions.map(async (corruptedPos) => {
                            await scannerService.positionManager._safeDeleteLivePosition(corruptedPos.id);
                        }));
                    }
                    
                    // Refresh wallet to get updated positions
                    forceRefresh();
                }
            } catch (error) {
                console.error('[Wallet] ❌ Error cleaning up positions:', error);
            }
        }
    }, [positions, forceRefresh]);

    // Trigger cleanup when positions change
    useEffect(() => {
        if (positions && positions.length > 0) {
            autoCleanupCorruptedPositions();
        }
    }, [positions, autoCleanupCorruptedPositions]);

    // Add manual cleanup button for corrupted positions
    const handleCleanupCorruptedPositions = useCallback(async () => {
        if (!positions || positions.length === 0) {
            toast({
                title: "No Positions",
                description: "No positions found to cleanup.",
                variant: "info",
            });
            return;
        }

        const corruptedCount = positions.filter(pos => {
            const isValid = pos.status === 'open' || pos.status === 'trailing';
            const hasEssentialData = pos.position_id && pos.symbol && pos.strategy_name;
            return isValid && !hasEssentialData;
        }).length;

        if (corruptedCount === 0) {
            toast({
                title: "No Corrupted Positions",
                description: "All positions have valid data.",
                variant: "success",
            });
            return;
        }

        try {
            await cleanupCorruptedPositions();
            toast({
                title: "Cleanup Complete",
                description: `Removed ${corruptedCount} corrupted positions.`,
                variant: "success",
            });
        } catch (error) {
            toast({
                title: "Cleanup Failed",
                description: `Error: ${error.message}`,
                variant: "destructive",
            });
        }
    }, [positions, cleanupCorruptedPositions, toast]);

    const paginatedPositions = useMemo(() => {
        const startIndex = (currentPage - 1) * POSITIONS_PER_PAGE;
        return activePositions.slice(startIndex, startIndex + POSITIONS_PER_PAGE);
    }, [activePositions, currentPage]);

    const totalPages = Math.ceil(activePositions.length / POSITIONS_PER_PAGE);

    const symbolsToWatch = useMemo(() => {
        const positionSymbols = activePositions.map(p => (p.symbol || '').replace('/', ''));

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

            let result;
            try {
                result = await positionManager.manualClosePosition(position, currentPrice);
            } catch (error) {
                throw error;
            }

            if (result.success) {
                if (result.alreadyClosed) {
                    toast({
                        title: "Position Already Closed",
                        description: `${position.symbol} was already closed and removed from the database.`,
                        variant: "success",
                    });
                } else {
                    toast({
                        title: "Position Closed",
                        description: `${position.symbol} has been successfully closed. P&L: $${(result.pnl || 0).toFixed(2)}.`,
                        variant: "success",
                    });
                }
                
                // Force refresh wallet data after successful position close
                await forceRefresh(); // Force refresh from database
                
                setClosingPositions(prev => {
                    const updated = { ...prev };
                    delete updated[position.position_id];
                    return updated;
                });
            } else {
                throw new Error(result.error || 'Failed to close position.');
            }

        } catch (error) {

            let errorTitle = "Close Failed";
            let errorDescription = error.message || "An unexpected error occurred.";

            if (errorDescription.includes('dust_or_below_threshold') || errorDescription.includes('below minimum') || errorDescription.includes('minQty')) {
                errorTitle = "Position Too Small";
                // Calculate actual position value for more accurate error message
                const positionValue = parseFloat(position.quantity_crypto) * parseFloat(position.current_price || position.entry_price);
                errorDescription = `This position is too small to trade on Binance. Position value: $${positionValue.toFixed(2)} (minimum $5 required). Cannot close position.`;
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

            await forceRefresh();

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
                    <Button onClick={forceRefresh}>
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
                    {(() => {
                        console.log('[Wallet] 🔍 Passing data to DailyPerformanceChart:', {
                            recentTradesLength: recentTrades?.length || 0,
                            chartTimeframe,
                            dailyPerformanceHistoryLength: dailyPerformanceHistory?.length || 0,
                            hourlyPerformanceHistoryLength: hourlyPerformanceHistory?.length || 0,
                            walletSummary: walletSummary ? 'present' : 'null',
                            dailyPerformanceHistorySample: dailyPerformanceHistory?.slice(0, 2),
                            hourlyPerformanceHistorySample: hourlyPerformanceHistory?.slice(0, 2),
                            timestamp: new Date().toISOString()
                        });
                        return null;
                    })()}
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
                            <div className="flex justify-between items-center">
                                <CardTitle>Open Positions ({openPositionsCount})</CardTitle>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={async () => {
                                        if (!scannerInitialized) {
                                            toast({
                                                title: "Scanner Not Ready",
                                                description: "Please wait for the scanner to initialize.",
                                                variant: "destructive"
                                            });
                                            return;
                                        }

                                        if (openPositionsCount === 0) {
                                            toast({
                                                title: "No Positions",
                                                description: "No open positions found to update.",
                                                variant: "info",
                                            });
                                            return;
                                        }

                                        try {
                                            const scannerService = getAutoScannerService();
                                            
                                            if (scannerService?.positionManager) {
                                                console.log('[Wallet] ⏰ Updating exit time for all positions to 1 minute...');
                                                
                                                // Update exit time for all open positions to 1 minute (1/60 hours)
                                                const updateResult = await scannerService.positionManager.updateAllPositionsExitTime(1/60);
                                                
                                                if (updateResult.success) {
                                                    toast({
                                                        title: "Exit Times Updated",
                                                        description: `Updated exit time to 1 minute for ${updateResult.updated} positions.`,
                                                        variant: "success",
                                                    });
                                                    forceRefresh();
                                                } else {
                                                    throw new Error(updateResult.error || 'Failed to update exit times');
                                                }
                                            } else {
                                                throw new Error('PositionManager not available');
                                            }
                                        } catch (error) {
                                            console.error('[Wallet] ❌ Error updating exit times:', error);
                                            toast({
                                                title: "Update Failed",
                                                description: `Failed to update exit times: ${error.message}`,
                                                variant: "destructive",
                                            });
                                        }
                                    }}
                                    className="text-xs"
                                >
                                    ⏰ Set Exit Time to 1min
                                </Button>
                            </div>
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
                                        <TableHead>Combined Strength</TableHead>
                                        <TableHead>Conviction</TableHead>
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
                                        paginatedPositions.map((pos, index) => (
                                            <PositionRow
                                                key={pos.position_id || pos.id || `position-${index}`}
                                                position={pos}
                                                currentPrice={currentPrices[(pos.symbol || '').replace('/', '')]}
                                                onClosePosition={handleClosePosition}
                                                isClosing={!!closingPositions[pos.position_id]}
                                                scannerInitialized={scannerInitialized}
                                            />
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan="13" className="text-center h-24">
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
                    forceRefresh();
                }}
            />
        </div>
    );
};

export default WalletPage;
