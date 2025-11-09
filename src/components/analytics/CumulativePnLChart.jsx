import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
} from 'recharts';
import { Trade } from '@/api/localClient';
import { Loader2 } from 'lucide-react';

/**
 * Cumulative P&L Chart
 * Displays cumulative profit/loss over time for 24h, 7 days, and 30 days
 */
export default function CumulativePnLChart({ tradingMode = 'testnet' }) {
    const [trades, setTrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedPeriod, setSelectedPeriod] = useState('24h'); // '24h', '7d', or '30d'

    useEffect(() => {
        loadTrades();
    }, [tradingMode]);

    const loadTrades = async () => {
        try {
            setLoading(true);
            setError(null);
            
            // Fetch trades from last 30 days (we'll filter for different periods in the component)
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30);
            
            const filter = {
                trading_mode: tradingMode,
                exit_timestamp: { $gte: cutoffDate.toISOString() }
            };
            
            const result = await Trade.filter(filter, 'exit_timestamp', 5000);
            
            setTrades(result || []);
        } catch (err) {
            console.error('[CumulativePnLChart] Error loading trades:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Process trades into cumulative P&L data points for the selected period
    const chartData = useMemo(() => {
        if (!trades || trades.length === 0) return [];

        const now = new Date();
        const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Filter trades for the selected period
        let filteredTrades;
        let cutoff;
        if (selectedPeriod === '24h') {
            cutoff = cutoff24h;
            filteredTrades = trades
                .filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff24h)
                .sort((a, b) => new Date(a.exit_timestamp) - new Date(b.exit_timestamp));
        } else if (selectedPeriod === '7d') {
            cutoff = cutoff7d;
            filteredTrades = trades
                .filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff7d)
                .sort((a, b) => new Date(a.exit_timestamp) - new Date(b.exit_timestamp));
        } else {
            cutoff = cutoff30d;
            filteredTrades = trades
                .filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff30d)
                .sort((a, b) => new Date(a.exit_timestamp) - new Date(b.exit_timestamp));
        }

        if (filteredTrades.length === 0) return [];

        let cumulativePnL = 0;
        const dataPoints = [];
        const timeBuckets = new Map();

        filteredTrades.forEach(trade => {
            const exitTime = new Date(trade.exit_timestamp);
            const pnl = parseFloat(trade.pnl_usdt || 0);
            
            // Determine bucket key based on period
            let bucketKey;
            if (selectedPeriod === '24h') {
                // Group by hour
                bucketKey = exitTime.toISOString().slice(0, 13) + ':00:00';
            } else if (selectedPeriod === '7d') {
                // Group by 6 hours
                const hours = exitTime.getHours();
                const bucketHour = Math.floor(hours / 6) * 6;
                const bucketDate = new Date(exitTime);
                bucketDate.setHours(bucketHour, 0, 0, 0);
                bucketKey = bucketDate.toISOString();
            } else {
                // Group by day
                bucketKey = exitTime.toISOString().slice(0, 10) + 'T00:00:00';
            }

            if (!timeBuckets.has(bucketKey)) {
                timeBuckets.set(bucketKey, { time: bucketKey, pnl: 0, count: 0 });
            }
            const bucket = timeBuckets.get(bucketKey);
            bucket.pnl += pnl;
            bucket.count += 1;
        });

        // Convert buckets to cumulative data points
        const sortedBuckets = Array.from(timeBuckets.entries())
            .sort((a, b) => new Date(a[0]) - new Date(b[0]));

        sortedBuckets.forEach(([bucketKey, bucket]) => {
            cumulativePnL += bucket.pnl;
            const time = new Date(bucketKey);
            
            // Format time label based on period
            let timeLabel;
            if (selectedPeriod === '24h') {
                timeLabel = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            } else if (selectedPeriod === '7d') {
                timeLabel = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
            } else {
                timeLabel = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            // Calculate percentage of invested balance ($5000)
            const investedBalance = 5000;
            const cumulativePnLPercent = (cumulativePnL / investedBalance) * 100;

            dataPoints.push({
                time: timeLabel,
                timestamp: bucketKey,
                cumulativePnL: parseFloat(cumulativePnL.toFixed(2)),
                cumulativePnLPercent: parseFloat(cumulativePnLPercent.toFixed(2)),
                trades: bucket.count
            });
        });

        return dataPoints;
    }, [trades, selectedPeriod]);

    // Calculate totals for each period
    const totals = useMemo(() => {
        const now = new Date();
        const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const trades24h = trades.filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff24h);
        const trades7d = trades.filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff7d);
        const trades30d = trades.filter(t => t.exit_timestamp && new Date(t.exit_timestamp) >= cutoff30d);

        const total24h = trades24h.reduce((sum, t) => sum + parseFloat(t.pnl_usdt || 0), 0);
        const total7d = trades7d.reduce((sum, t) => sum + parseFloat(t.pnl_usdt || 0), 0);
        const total30d = trades30d.reduce((sum, t) => sum + parseFloat(t.pnl_usdt || 0), 0);

        return { total24h, total7d, total30d };
    }, [trades]);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Cumulative P&L</CardTitle>
                    <CardDescription>Loading trade data...</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Cumulative P&L</CardTitle>
                    <CardDescription className="text-destructive">Error: {error}</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    if (!chartData || chartData.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Cumulative P&L</CardTitle>
                    <CardDescription>No trade data available for the selected periods</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    // Get color and name for selected period
    const getPeriodConfig = (period) => {
        switch (period) {
            case '24h':
                return { color: '#3b82f6', name: '24 Hours' };
            case '7d':
                return { color: '#10b981', name: '7 Days' };
            case '30d':
                return { color: '#8b5cf6', name: '30 Days' };
            default:
                return { color: '#3b82f6', name: '24 Hours' };
        }
    };

    const periodConfig = getPeriodConfig(selectedPeriod);
    const selectedTotal = selectedPeriod === '24h' ? totals.total24h : selectedPeriod === '7d' ? totals.total7d : totals.total30d;

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const pnlValue = payload.find(p => p.dataKey === 'cumulativePnL')?.value;
            const pnlPercent = payload.find(p => p.dataKey === 'cumulativePnLPercent')?.value;
            
            if (pnlValue === null || pnlValue === undefined) return null;
            return (
                <div className="bg-background border rounded-lg shadow-lg p-3">
                    <p className="font-medium mb-2">{label}</p>
                    <p style={{ color: periodConfig.color }} className="text-sm">
                        Cumulative P&L: ${pnlValue.toFixed(2)}
                    </p>
                    {pnlPercent !== null && pnlPercent !== undefined && (
                        <p style={{ color: periodConfig.color }} className="text-sm">
                            Percentage: {pnlPercent.toFixed(2)}%
                        </p>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Cumulative P&L</CardTitle>
                <CardDescription>
                    Cumulative profit and loss over time
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="mb-4">
                    <Tabs value={selectedPeriod} onValueChange={setSelectedPeriod} className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="24h">24 Hours</TabsTrigger>
                            <TabsTrigger value="7d">7 Days</TabsTrigger>
                            <TabsTrigger value="30d">30 Days</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                
                <div className="mb-4 text-center">
                    <div className="text-sm text-muted-foreground mb-1">{periodConfig.name}</div>
                    <div className={`text-2xl font-bold ${selectedTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ${selectedTotal.toFixed(2)}
                    </div>
                </div>

                {chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                        No trade data available for {periodConfig.name.toLowerCase()}
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={400}>
                        <ComposedChart data={chartData} margin={{ top: 5, right: 50, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                                dataKey="time" 
                                className="text-xs"
                                angle={-45}
                                textAnchor="end"
                                height={80}
                            />
                            <YAxis 
                                yAxisId="left"
                                className="text-xs"
                                tickFormatter={(value) => `$${value.toFixed(0)}`}
                                label={{ value: 'P&L (USD)', angle: -90, position: 'insideLeft' }}
                            />
                            <YAxis 
                                yAxisId="right"
                                orientation="right"
                                className="text-xs"
                                tickFormatter={(value) => `${value.toFixed(1)}%`}
                                label={{ value: 'P&L (%)', angle: 90, position: 'insideRight' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Line 
                                yAxisId="left"
                                type="monotone" 
                                dataKey="cumulativePnL" 
                                stroke={periodConfig.color} 
                                strokeWidth={2}
                                dot={false}
                                name={periodConfig.name}
                            />
                            <Line 
                                yAxisId="right"
                                type="monotone" 
                                dataKey="cumulativePnLPercent" 
                                stroke={periodConfig.color} 
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                                name={`${periodConfig.name} (%)`}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}

