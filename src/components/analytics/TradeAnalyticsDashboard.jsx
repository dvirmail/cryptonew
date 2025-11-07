import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Trade } from '@/api/localClient';

/**
 * Trade Analytics Dashboard
 * Displays comprehensive trade performance analytics using the new exit metrics fields
 */
export default function TradeAnalyticsDashboard({ tradingMode = 'testnet' }) {
    const [trades, setTrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedTimeframe, setSelectedTimeframe] = useState('all'); // 'all', '7d', '30d', '90d'

    useEffect(() => {
        loadTrades();
    }, [tradingMode, selectedTimeframe]);

    const loadTrades = async () => {
        try {
            setLoading(true);
            setError(null);
            
            const filter = { trading_mode: tradingMode };
            
            // Add timeframe filter if not 'all'
            if (selectedTimeframe !== 'all') {
                const days = selectedTimeframe === '7d' ? 7 : selectedTimeframe === '30d' ? 30 : 90;
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - days);
                filter.exit_timestamp = { $gte: cutoffDate.toISOString() };
            }
            
            const result = await Trade.filter(filter, '-exit_timestamp', 1000);
            
            setTrades(result || []);
        } catch (err) {
            console.error('[TradeAnalyticsDashboard] Error loading trades:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Calculate aggregate statistics
    const stats = useMemo(() => {
        if (!trades || trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnL: 0,
                avgPnL: 0,
                avgPeakProfit: 0,
                avgLeftOnTable: 0,
                avgExitTiming: 0,
                slHitRate: 0,
                tpHitRate: 0
            };
        }

        const winningTrades = trades.filter(t => (t.pnl_usdt || t.pnl_percent || 0) > 0);
        const losingTrades = trades.filter(t => (t.pnl_usdt || t.pnl_percent || 0) < 0);
        const totalPnL = trades.reduce((sum, t) => sum + (parseFloat(t.pnl_usdt) || 0), 0);
        const avgPnL = totalPnL / trades.length;
        
        // Peak profit analysis
        const tradesWithPeakProfit = trades.filter(t => t.peak_profit_usdt !== null && t.peak_profit_usdt !== undefined);
        const avgPeakProfit = tradesWithPeakProfit.length > 0
            ? tradesWithPeakProfit.reduce((sum, t) => sum + (parseFloat(t.peak_profit_usdt) || 0), 0) / tradesWithPeakProfit.length
            : 0;
        
        // "Left on table" analysis (peak profit - actual profit)
        const leftOnTable = tradesWithPeakProfit
            .filter(t => parseFloat(t.peak_profit_usdt || 0) > parseFloat(t.pnl_usdt || 0))
            .map(t => parseFloat(t.peak_profit_usdt || 0) - parseFloat(t.pnl_usdt || 0));
        const avgLeftOnTable = leftOnTable.length > 0
            ? leftOnTable.reduce((sum, val) => sum + val, 0) / leftOnTable.length
            : 0;
        
        // Exit timing analysis
        const tradesWithExitTiming = trades.filter(t => t.exit_vs_planned_exit_time_minutes !== null && t.exit_vs_planned_exit_time_minutes !== undefined);
        const avgExitTiming = tradesWithExitTiming.length > 0
            ? tradesWithExitTiming.reduce((sum, t) => sum + (parseInt(t.exit_vs_planned_exit_time_minutes) || 0), 0) / tradesWithExitTiming.length
            : 0;
        
        // SL/TP hit rates
        const slHits = trades.filter(t => t.sl_hit_boolean === true).length;
        const tpHits = trades.filter(t => t.tp_hit_boolean === true).length;
        const slHitRate = trades.length > 0 ? (slHits / trades.length) * 100 : 0;
        const tpHitRate = trades.length > 0 ? (tpHits / trades.length) * 100 : 0;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
            totalPnL,
            avgPnL,
            avgPeakProfit,
            avgLeftOnTable,
            avgExitTiming,
            slHitRate,
            tpHitRate
        };
    }, [trades]);

    // Regime change analysis
    const regimeAnalysis = useMemo(() => {
        const regimeChanges = trades.filter(t => 
            t.market_regime && t.market_regime_at_exit && 
            t.market_regime !== t.market_regime_at_exit
        );
        
        const regimeChangeStats = regimeChanges.reduce((acc, t) => {
            const key = `${t.market_regime} → ${t.market_regime_at_exit}`;
            if (!acc[key]) {
                acc[key] = { count: 0, totalPnL: 0, wins: 0 };
            }
            acc[key].count++;
            acc[key].totalPnL += parseFloat(t.pnl_usdt || 0);
            if ((t.pnl_usdt || 0) > 0) acc[key].wins++;
            return acc;
        }, {});

        return { regimeChanges: regimeChanges.length, regimeChangeStats };
    }, [trades]);

    // Exit quality analysis
    const exitQualityAnalysis = useMemo(() => {
        const prematureExits = trades.filter(t => {
            if (!t.peak_profit_usdt || !t.pnl_usdt) return false;
            const peakProfit = parseFloat(t.peak_profit_usdt);
            const actualProfit = parseFloat(t.pnl_usdt);
            // Exited at less than 50% of peak profit
            return peakProfit > 0 && actualProfit < peakProfit * 0.5;
        });

        const closeToTP = trades.filter(t => {
            if (!t.distance_to_tp_at_exit || !t.tp_hit_boolean) return false;
            return !t.tp_hit_boolean && parseFloat(t.distance_to_tp_at_exit || 0) < 1.0; // Within 1% of TP but didn't hit
        });

        return {
            prematureExits: prematureExits.length,
            closeToTP: closeToTP.length,
            prematureExitRate: trades.length > 0 ? (prematureExits.length / trades.length) * 100 : 0
        };
    }, [trades]);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Trade Analytics Dashboard</CardTitle>
                    <CardDescription>Loading trade data...</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Trade Analytics Dashboard</CardTitle>
                    <CardDescription className="text-destructive">Error: {error}</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Trade Analytics Dashboard</CardTitle>
                    <CardDescription>
                        Comprehensive trade performance analysis using exit metrics
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                        <select
                            value={selectedTimeframe}
                            onChange={(e) => setSelectedTimeframe(e.target.value)}
                            className="px-3 py-2 border rounded-md"
                        >
                            <option value="all">All Time</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="90d">Last 90 Days</option>
                        </select>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalTrades}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {stats.winningTrades} wins / {stats.losingTrades} losses
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.winRate.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {stats.winningTrades} / {stats.totalTrades} trades
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${stats.totalPnL.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Avg: ${stats.avgPnL.toFixed(2)}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Avg Peak Profit</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">
                            ${stats.avgPeakProfit.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Left on table: ${stats.avgLeftOnTable.toFixed(2)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Detailed Analytics Tabs */}
            <Tabs defaultValue="exit-quality" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="exit-quality">Exit Quality</TabsTrigger>
                    <TabsTrigger value="regime">Regime Analysis</TabsTrigger>
                    <TabsTrigger value="mfe-mae">MFE/MAE</TabsTrigger>
                    <TabsTrigger value="trades">All Trades</TabsTrigger>
                </TabsList>

                <TabsContent value="exit-quality" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Exit Quality Analysis</CardTitle>
                            <CardDescription>Analyzing if exits were optimal</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="text-sm font-medium">SL Hit Rate</div>
                                    <div className="text-2xl font-bold">{stats.slHitRate.toFixed(1)}%</div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">TP Hit Rate</div>
                                    <div className="text-2xl font-bold">{stats.tpHitRate.toFixed(1)}%</div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">Premature Exits</div>
                                    <div className="text-2xl font-bold text-orange-600">
                                        {exitQualityAnalysis.prematureExits}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {exitQualityAnalysis.prematureExitRate.toFixed(1)}% of trades
                                    </div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">Close to TP</div>
                                    <div className="text-2xl font-bold text-yellow-600">
                                        {exitQualityAnalysis.closeToTP}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Within 1% but didn't hit
                                    </div>
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-medium">Avg Exit Timing</div>
                                <div className="text-lg">
                                    {stats.avgExitTiming > 0 ? '+' : ''}{stats.avgExitTiming.toFixed(0)} minutes
                                    <span className="text-xs text-muted-foreground ml-2">
                                        vs planned exit time
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="regime" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Regime Change Analysis</CardTitle>
                            <CardDescription>Market regime changes during trades</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="mb-4">
                                <div className="text-sm font-medium">Trades with Regime Changes</div>
                                <div className="text-2xl font-bold">{regimeAnalysis.regimeChanges}</div>
                                <div className="text-xs text-muted-foreground">
                                    {stats.totalTrades > 0 ? ((regimeAnalysis.regimeChanges / stats.totalTrades) * 100).toFixed(1) : 0}% of all trades
                                </div>
                            </div>
                            {Object.keys(regimeAnalysis.regimeChangeStats).length > 0 && (
                                <div>
                                    <div className="text-sm font-medium mb-2">Regime Transition Performance:</div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Transition</TableHead>
                                                <TableHead>Count</TableHead>
                                                <TableHead>Win Rate</TableHead>
                                                <TableHead>Avg P&L</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {Object.entries(regimeAnalysis.regimeChangeStats).map(([transition, data]) => (
                                                <TableRow key={transition}>
                                                    <TableCell>{transition}</TableCell>
                                                    <TableCell>{data.count}</TableCell>
                                                    <TableCell>
                                                        {data.count > 0 ? ((data.wins / data.count) * 100).toFixed(1) : 0}%
                                                    </TableCell>
                                                    <TableCell className={data.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                        ${(data.totalPnL / data.count).toFixed(2)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="mfe-mae" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>MFE/MAE Analysis</CardTitle>
                            <CardDescription>Max Favorable/Adverse Excursion</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm text-muted-foreground mb-4">
                                MFE = Maximum price reached in favorable direction<br />
                                MAE = Maximum price reached in adverse direction<br />
                                Peak Profit = Maximum profit reached during trade
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Symbol</TableHead>
                                        <TableHead>Entry</TableHead>
                                        <TableHead>Exit</TableHead>
                                        <TableHead>MFE</TableHead>
                                        <TableHead>MAE</TableHead>
                                        <TableHead>Peak Profit</TableHead>
                                        <TableHead>Actual Profit</TableHead>
                                        <TableHead>Left on Table</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {trades
                                        .filter(t => t.peak_profit_usdt !== null && t.peak_profit_usdt !== undefined)
                                        .slice(0, 20)
                                        .map((trade) => {
                                            const peakProfit = parseFloat(trade.peak_profit_usdt || 0);
                                            const actualProfit = parseFloat(trade.pnl_usdt || 0);
                                            const leftOnTable = Math.max(0, peakProfit - actualProfit);
                                            return (
                                                <TableRow key={trade.id || trade.trade_id}>
                                                    <TableCell>{trade.symbol}</TableCell>
                                                    <TableCell>${parseFloat(trade.entry_price || 0).toFixed(6)}</TableCell>
                                                    <TableCell>${parseFloat(trade.exit_price || 0).toFixed(6)}</TableCell>
                                                    <TableCell>${parseFloat(trade.max_favorable_excursion || 0).toFixed(6)}</TableCell>
                                                    <TableCell>${parseFloat(trade.max_adverse_excursion || 0).toFixed(6)}</TableCell>
                                                    <TableCell className="text-blue-600">${peakProfit.toFixed(2)}</TableCell>
                                                    <TableCell className={actualProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                        ${actualProfit.toFixed(2)}
                                                    </TableCell>
                                                    <TableCell className={leftOnTable > 0 ? 'text-orange-600 font-medium' : ''}>
                                                        ${leftOnTable.toFixed(2)}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="trades" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>All Trades</CardTitle>
                            <CardDescription>Complete trade history with exit metrics</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Symbol</TableHead>
                                        <TableHead>Strategy</TableHead>
                                        <TableHead>Entry</TableHead>
                                        <TableHead>Exit</TableHead>
                                        <TableHead>P&L</TableHead>
                                        <TableHead>Peak Profit</TableHead>
                                        <TableHead>Exit Reason</TableHead>
                                        <TableHead>Regime</TableHead>
                                        <TableHead>Regime @ Exit</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {trades.slice(0, 50).map((trade) => (
                                        <TableRow key={trade.id || trade.trade_id}>
                                            <TableCell>{trade.symbol}</TableCell>
                                            <TableCell className="max-w-[200px] truncate">
                                                {trade.strategy_name || 'N/A'}
                                            </TableCell>
                                            <TableCell>${parseFloat(trade.entry_price || 0).toFixed(6)}</TableCell>
                                            <TableCell>${parseFloat(trade.exit_price || 0).toFixed(6)}</TableCell>
                                            <TableCell className={parseFloat(trade.pnl_usdt || 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                ${parseFloat(trade.pnl_usdt || 0).toFixed(2)}
                                            </TableCell>
                                            <TableCell>
                                                {trade.peak_profit_usdt ? `$${parseFloat(trade.peak_profit_usdt).toFixed(2)}` : 'N/A'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">
                                                    {trade.exit_reason || 'N/A'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">
                                                    {trade.market_regime || 'N/A'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {trade.market_regime_at_exit ? (
                                                    <Badge variant={trade.market_regime === trade.market_regime_at_exit ? 'default' : 'destructive'}>
                                                        {trade.market_regime_at_exit}
                                                    </Badge>
                                                ) : 'N/A'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

