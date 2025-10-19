
import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, subHours, differenceInHours } from 'date-fns';
import { HistoricalPerformance } from '@/api/entities';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

// Custom colored bar for P&L to handle negative values correctly
const PnlBar = (props) => {
    const { x, y, width, height, value } = props;
    const color = value >= 0 ? '#22c55e' : '#ef4444'; // green-500 or red-500
    
    const barY = value < 0 ? y + height : y;
    const barHeight = Math.abs(height);

    return <rect x={x} y={barY} width={width} height={barHeight} fill={color} />;
};

export default function PerformanceChart() {
    const [timeframe, setTimeframe] = useState('30d');
    const [chartConfig, setChartConfig] = useState({ data: [], formatter: null });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            
            try {
                const now = new Date();
                // LOCAL TIME boundary helpers (changed from UTC)
                const startOfLocalHour = (d) => {
                    const dt = new Date(d);
                    dt.setMinutes(0, 0, 0);
                    return dt;
                };
                const startOfLocalDay = (d) => {
                    const dt = new Date(d);
                    dt.setHours(0, 0, 0, 0);
                    return dt;
                };
                const addLocalHours = (d, h) => new Date(startOfLocalHour(d).getTime() + h * 60 * 60 * 1000);

                let startDate, xAxisFormatter, periodTypesToFetch = [], generatedRange = [];
                const pnlData = new Map();

                switch (timeframe) {
                    case 'today':
                    case '24h': {
                        const startLocal = timeframe === 'today' ? startOfLocalDay(now) : startOfLocalHour(subHours(now, 24));
                        startDate = startLocal;
                        const hoursToDisplay = differenceInHours(now, startLocal) + 1; // Calculate hours based on local start
                        periodTypesToFetch = ['hourly'];
                        xAxisFormatter = (tick) => format(new Date(tick), 'HH:mm'); // display local, data is from local buckets

                        for (let i = 0; i < hoursToDisplay; i++) {
                            const hour = addLocalHours(startLocal, i); // Generate local hour points
                            if (hour <= now) { // Only include hours that have elapsed up to current `now` (local time)
                                generatedRange.push(hour.toISOString());
                            }
                        }
                        break;
                    }

                    case '7d': {
                        const startLocal = startOfLocalDay(subDays(now, 7)); // Start 7 days ago, at the start of that local day
                        startDate = startLocal;
                        periodTypesToFetch = ['daily', 'hourly'];
                        xAxisFormatter = (tick) => format(new Date(tick), 'MMM dd');
                        for (let i = 0; i <= 7; i++) {
                            const day = startOfLocalDay(subDays(now, i)); // Generate local day points
                            generatedRange.unshift(day.toISOString());
                        }
                        break;
                    }

                    case '30d':
                    default: {
                        const startLocal = startOfLocalDay(subDays(now, 30)); // Start 30 days ago, at the start of that local day
                        startDate = startLocal;
                        periodTypesToFetch = ['daily', 'hourly'];
                        xAxisFormatter = (tick) => format(new Date(tick), 'MMM dd');
                        for (let i = 0; i <= 30; i++) {
                            const day = startOfLocalDay(subDays(now, i)); // Generate local day points
                            generatedRange.unshift(day.toISOString());
                        }
                        break;
                    }
                }

                // Ensure generatedRange is unique and sorted
                generatedRange = Array.from(new Set(generatedRange))
                    .filter(dateStr => new Date(dateStr) >= startDate)
                    .sort((a, b) => new Date(a) - new Date(b));

                // Fetch all relevant snapshots (from local-start converted to UTC for database query)
                const snapshots = await HistoricalPerformance.filter({
                    period_type: { '$in': periodTypesToFetch },
                    // Although startDate is calculated based on local time, toISOString() correctly converts it to a UTC string,
                    // which is necessary for comparison against UTC snapshot_timestamp in the database.
                    snapshot_timestamp: { '$gte': startDate.toISOString() } 
                }, 'snapshot_timestamp');

                if (timeframe === 'today' || timeframe === '24h') {
                    // Aggregate hourly snapshots into local hours
                    snapshots.forEach(s => {
                        if (s.period_type === 'hourly') {
                            // Convert UTC snapshot timestamp to local hour boundary
                            const snapshotTime = new Date(s.snapshot_timestamp);
                            const localHourKey = startOfLocalHour(snapshotTime).toISOString();
                            const existingPnl = pnlData.get(localHourKey) || 0;
                            pnlData.set(localHourKey, existingPnl + (s.period_pnl || 0));
                        }
                    });
                } else {
                    // Aggregate by local day; prefer hourly sum, fall back to daily records
                    const hourlyByDay = new Map();
                    const dailyByDay = new Map();

                    snapshots.forEach(s => {
                        const ts = new Date(s.snapshot_timestamp);
                        // Convert UTC timestamp to local day boundary
                        const dayKey = startOfLocalDay(ts).toISOString(); // Map to local day start

                        if (s.period_type === 'hourly') {
                            const current = hourlyByDay.get(dayKey) || 0;
                            hourlyByDay.set(dayKey, current + (s.period_pnl || 0));
                        } else if (s.period_type === 'daily') {
                            const current = dailyByDay.get(dayKey) || 0;
                            dailyByDay.set(dayKey, current + (s.period_pnl || 0));
                        }
                    });

                    generatedRange.forEach(dayKey => {
                        const fromHourly = hourlyByDay.get(dayKey);
                        const fromDaily = dailyByDay.get(dayKey);
                        // If hourly data exists, use it. Otherwise, use daily data. If neither, use 0.
                        const value = (fromHourly !== undefined ? fromHourly : (fromDaily !== undefined ? fromDaily : 0));
                        pnlData.set(dayKey, value);
                    });
                }

                // Final chart data (round to 2 decimals for display)
                const finalChartData = generatedRange.map(dateKey => ({
                    date: dateKey,
                    pnl: Number.parseFloat(((pnlData.get(dateKey) || 0)).toFixed(2)),
                }));
                
                setChartConfig({ data: finalChartData, formatter: xAxisFormatter });

            } catch (error) {
                console.error("[PerformanceChart] Failed to fetch performance data:", error);
                setChartConfig({ data: [], formatter: (tick) => tick });
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [timeframe]);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Performance Breakdown</CardTitle>
                <Tabs defaultValue="30d" onValueChange={setTimeframe} className="w-auto">
                    <TabsList>
                        <TabsTrigger value="today">Today</TabsTrigger>
                        <TabsTrigger value="24h">24h</TabsTrigger>
                        <TabsTrigger value="7d">7d</TabsTrigger>
                        <TabsTrigger value="30d">30d</TabsTrigger>
                    </TabsList>
                </Tabs>
            </CardHeader>
            <CardContent>
                <div className="h-[300px]">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : chartConfig.data.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            No performance data available for this period.
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartConfig.data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                                <XAxis 
                                    dataKey="date" 
                                    tickFormatter={chartConfig.formatter} 
                                    tick={{ fill: 'currentColor' }} 
                                    className="text-xs" 
                                />
                                <YAxis 
                                    tickFormatter={(value) => `$${value}`} 
                                    tick={{ fill: 'currentColor' }} 
                                    className="text-xs"
                                    allowDataOverflow={true}
                                    domain={['auto', 'auto']}
                                />
                                <Tooltip
                                    contentStyle={{ 
                                        backgroundColor: 'var(--card-bg, #ffffff)', 
                                        border: '1px solid var(--border-color, #e5e7eb)',
                                        borderRadius: '0.5rem',
                                        color: 'var(--text-color, #000000)'
                                    }}
                                    labelStyle={{ fontWeight: 'bold' }}
                                    formatter={(value) => [`$${value.toFixed(2)}`, 'P&L']}
                                    labelFormatter={(label) => format(new Date(label), timeframe.includes('d') && timeframe !== 'today' ? 'MMM dd, yyyy' : 'MMM dd, HH:mm')}
                                />
                                <Bar dataKey="pnl" shape={<PnlBar />} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
