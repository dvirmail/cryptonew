import React, { useState, useEffect } from 'react';
import { ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, LineChart } from 'lucide-react';
import { HistoricalPerformance } from '@/api/entities';
import { getKlineData } from '@/api/functions';
import { queueFunctionCall } from '@/components/utils/apiQueue';

// Custom colored bar for P&L to handle negative values correctly
const PnlBar = (props) => {
    const { x, y, width, height, value } = props;
    const color = value >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'; // Green or Red with some transparency
    const barY = value < 0 ? y + height : y;
    const barHeight = Math.abs(height);
    return <rect x={x} y={barY} width={width} height={barHeight} fill={color} />;
};

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        const pnlData = payload.find(p => p.dataKey === 'pnl');
        const btcData = payload.find(p => p.dataKey === 'btcPrice');
        return (
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">{label}</p>
                {pnlData && <p style={{ color: pnlData.color }}>{`Daily P&L: $${pnlData.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>}
                {btcData && <p style={{ color: btcData.color }}>{`BTC Price: $${btcData.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>}
            </div>
        );
    }
    return null;
};

export default function StrategyVsBtcChart() {
    const [timeframe, setTimeframe] = useState('30d');
    const [chartData, setChartData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const days = parseInt(timeframe.replace('d', ''));
                const now = new Date();
                const startDate = startOfDay(subDays(now, days - 1));

                // Fetch P&L Data
                const pnlSnapshots = await HistoricalPerformance.filter({
                    period_type: 'daily',
                    snapshot_timestamp: { '$gte': startDate.toISOString() }
                });
                
                const pnlMap = new Map();
                pnlSnapshots.forEach(s => {
                    const dateKey = format(new Date(s.snapshot_timestamp), 'yyyy-MM-dd');
                    pnlMap.set(dateKey, s.period_pnl || 0);
                });

                // Fetch BTC Price Data
                // NEW: Direct call to bypass API queue for better batching
                const { data: btcResult } = await getKlineData({
                    symbols: ['BTCUSDT'],
                    interval: '1d',
                    limit: days,
                    source: 'StrategyVsBtcChart',
                });
                
                if (!btcResult?.BTCUSDT?.success) {
                    throw new Error('Failed to fetch BTC price data.');
                }
                const btcKlines = btcResult.BTCUSDT.data;
                const btcPriceMap = new Map();
                btcKlines.forEach(kline => {
                    const dateKey = format(new Date(kline[0]), 'yyyy-MM-dd');
                    btcPriceMap.set(dateKey, parseFloat(kline[4])); // Closing price
                });

                // Combine Data
                const combinedData = [];
                for (let i = 0; i < days; i++) {
                    const date = subDays(now, days - 1 - i);
                    const dateKey = format(date, 'yyyy-MM-dd');
                    const label = format(date, 'MMM d');
                    
                    combinedData.push({
                        date: label,
                        pnl: pnlMap.get(dateKey) || 0,
                        btcPrice: btcPriceMap.get(dateKey) || (combinedData[i-1]?.btcPrice || 0) // Fill gaps with previous day's price
                    });
                }
                
                setChartData(combinedData);

            } catch (err) {
                console.error("Error fetching data for Strategy vs BTC chart:", err);
                setError("Failed to load chart data. Please try again later.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [timeframe]);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Daily P&L vs. BTC Price</CardTitle>
                <Tabs value={timeframe} onValueChange={setTimeframe}>
                    <TabsList>
                        <TabsTrigger value="7d">7d</TabsTrigger>
                        <TabsTrigger value="30d">30d</TabsTrigger>
                        <TabsTrigger value="90d">90d</TabsTrigger>
                    </TabsList>
                </Tabs>
            </CardHeader>
            <CardContent className="h-[350px]">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full text-red-500">
                        <AlertTriangle className="h-8 w-8 mb-2" />
                        <p>{error}</p>
                    </div>
                ) : chartData.length === 0 ? (
                     <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <LineChart className="h-8 w-8 mb-2" />
                        <p>No performance data available for this period.</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                            <XAxis dataKey="date" tick={{ fill: 'currentColor' }} className="text-xs" />
                            <YAxis yAxisId="left" orientation="left" tickFormatter={(value) => `$${value/1000}k`} tick={{ fill: 'currentColor' }} className="text-xs" stroke="#3b82f6" />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `$${(value || 0).toLocaleString()}`} tick={{ fill: 'currentColor' }} className="text-xs" stroke="#10b981" />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            <defs>
                                <linearGradient id="colorBtc" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <Area yAxisId="right" type="monotone" dataKey="btcPrice" name="BTC Price" stroke="#10b981" fillOpacity={1} fill="url(#colorBtc)" />
                            <Bar yAxisId="left" dataKey="pnl" name="Daily P&L" shape={<PnlBar />} />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}