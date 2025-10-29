import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Legend,
} from 'recharts';
import { TrendingUp, BarChart3, Activity } from 'lucide-react';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from "@/components/providers/WalletProvider";
import { format, parseISO, subDays, subHours } from 'date-fns';

/**
 * WalletPerformanceHistoryChart Component
 * 
 * Core Purpose: To visually represent the P&L trajectory of the user's trading activities over time,
 * allowing for analysis of daily and hourly performance trends. Shows both individual period P&L 
 * and cumulative P&L.
 * 
 * Data Sources:
 * - Primary: HistoricalPerformance Entity (daily/hourly records)
 * - Secondary: Real-time updates from Trade Entity & LiveWalletState
 * 
 * Features:
 * - Daily/Hourly timeframe selection
 * - Bar chart for period P&L (green/red)
 * - Line chart for cumulative P&L
 * - Interactive tooltips with detailed metrics
 * - Real-time data synchronization
 */
export default function WalletPerformanceHistoryChart({
  timeframe: initialTimeframe = 'daily',
  onTimeframeChange,
  className = ""
}) {
  const { isLiveMode } = useTradingMode();
  const { 
    loading: walletLoading, 
    dailyPerformanceHistory, 
    hourlyPerformanceHistory,
    walletSummary 
  } = useWallet();

  const [selectedTimeframe, setSelectedTimeframe] = useState(initialTimeframe);
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Determine which data source to use based on timeframe
  const performanceData = useMemo(() => {
    if (selectedTimeframe === 'hourly') {
      return Array.isArray(hourlyPerformanceHistory) ? hourlyPerformanceHistory : [];
    }
    return Array.isArray(dailyPerformanceHistory) ? dailyPerformanceHistory : [];
  }, [selectedTimeframe, dailyPerformanceHistory, hourlyPerformanceHistory]);

  // Process and normalize chart data
  const processedChartData = useMemo(() => {
    if (!performanceData || performanceData.length === 0) {
      return [];
    }

    // Sort by timestamp (oldest first for proper cumulative calculation)
    const sortedData = [...performanceData].sort((a, b) => 
      new Date(a.snapshot_timestamp).getTime() - new Date(b.snapshot_timestamp).getTime()
    );

    // Calculate cumulative values and prepare chart data
    let cumulativePnl = 0;
    let cumulativeTrades = 0;
    let cumulativeWins = 0;

    return sortedData.map((record, index) => {
      const periodPnl = Number(record.period_pnl || 0);
      const periodTrades = Number(record.period_trade_count || 0);
      const periodWins = Number(record.period_winning_trades || 0);
      
      // Update cumulative values
      cumulativePnl += periodPnl;
      cumulativeTrades += periodTrades;
      cumulativeWins += periodWins;

      // Format timestamp for display
      const timestamp = new Date(record.snapshot_timestamp);
      const isHourly = selectedTimeframe === 'hourly';
      
      let displayLabel;
      if (isHourly) {
        displayLabel = format(timestamp, 'MMM dd HH:mm');
      } else {
        displayLabel = format(timestamp, 'MMM dd');
      }

      return {
        timestamp: record.snapshot_timestamp,
        displayLabel,
        periodPnl,
        cumulativePnl,
        periodTrades,
        cumulativeTrades,
        periodWins,
        cumulativeWins,
        winRate: periodTrades > 0 ? (periodWins / periodTrades) * 100 : 0,
        cumulativeWinRate: cumulativeTrades > 0 ? (cumulativeWins / cumulativeTrades) * 100 : 0,
        periodGrossProfit: Number(record.period_gross_profit || 0),
        periodGrossLoss: Number(record.period_gross_loss || 0),
        cumulativeGrossProfit: Number(record.cumulative_gross_profit || 0),
        cumulativeGrossLoss: Number(record.cumulative_gross_loss || 0),
        profitFactor: Number(record.period_gross_loss || 0) > 0 ? 
          Number(record.period_gross_profit || 0) / Number(record.period_gross_loss || 0) : 
          (Number(record.period_gross_profit || 0) > 0 ? Infinity : 0)
      };
    });
  }, [performanceData, selectedTimeframe]);

  // Update chart data when processed data changes
  useEffect(() => {
    setChartData(processedChartData);
    setIsLoading(false);
  }, [processedChartData]);

  // Handle timeframe change
  const handleTimeframeChange = useCallback((newTimeframe) => {
    setSelectedTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
  }, [onTimeframeChange]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return {
        totalPeriodPnl: 0,
        totalCumulativePnl: 0,
        avgPeriodPnl: 0,
        bestPeriodPnl: 0,
        worstPeriodPnl: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0
      };
    }

    const totalPeriodPnl = chartData.reduce((sum, item) => sum + item.periodPnl, 0);
    const totalCumulativePnl = chartData[chartData.length - 1]?.cumulativePnl || 0;
    const avgPeriodPnl = chartData.length > 0 ? totalPeriodPnl / chartData.length : 0;
    const bestPeriodPnl = Math.max(...chartData.map(item => item.periodPnl));
    const worstPeriodPnl = Math.min(...chartData.map(item => item.periodPnl));
    const totalTrades = chartData.reduce((sum, item) => sum + item.periodTrades, 0);
    const totalWins = chartData.reduce((sum, item) => sum + item.periodWins, 0);
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    
    const totalGrossProfit = chartData.reduce((sum, item) => sum + item.periodGrossProfit, 0);
    const totalGrossLoss = chartData.reduce((sum, item) => sum + item.periodGrossLoss, 0);
    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : 
      (totalGrossProfit > 0 ? Infinity : 0);

    return {
      totalPeriodPnl,
      totalCumulativePnl,
      avgPeriodPnl,
      bestPeriodPnl,
      worstPeriodPnl,
      totalTrades,
      winRate,
      profitFactor
    };
  }, [chartData]);

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0]?.payload || {};
    const periodPnl = data.periodPnl || 0;
    const cumulativePnl = data.cumulativePnl || 0;
    const periodTrades = data.periodTrades || 0;
    const cumulativeTrades = data.cumulativeTrades || 0;
    const winRate = data.winRate || 0;
    const profitFactor = data.profitFactor || 0;

    return (
      <div className="rounded-md border bg-white/95 p-3 shadow-lg">
        <div className="text-sm font-semibold mb-2">{data.displayLabel || label}</div>
        <div className="space-y-1 text-xs">
          <div className={`font-medium ${periodPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {selectedTimeframe === 'hourly' ? 'Hourly P&L: ' : 'Daily P&L: '}
            ${periodPnl.toFixed(2)}
          </div>
          <div className="text-blue-600">
            Cumulative P&L: ${cumulativePnl.toFixed(2)}
          </div>
          <div className="text-gray-700">
            {selectedTimeframe === 'hourly' ? 'Hourly' : 'Daily'} Trades: {periodTrades}
          </div>
          <div className="text-gray-700">
            Total Trades: {cumulativeTrades}
          </div>
          <div className="text-gray-700">
            Win Rate: {winRate.toFixed(1)}%
          </div>
          <div className="text-gray-700">
            Profit Factor: {Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}
          </div>
        </div>
      </div>
    );
  };

  // Format currency for display
  const formatCurrency = (value) => {
    if (typeof value !== 'number' || isNaN(value)) return '$0.00';
    return value.toLocaleString('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  // Loading state
  if (isLoading || walletLoading) {
    return (
      <Card className={`bg-white ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Performance History Chart
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse" />
            <p>Loading performance data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!chartData || chartData.length === 0) {
    return (
      <Card className={`bg-white ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Performance History Chart
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <p>No performance data available for the selected period.</p>
            <p className="text-sm mt-1">Data will appear as trading activity is recorded.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-white ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Performance History Chart
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {/* Timeframe Selector */}
        <Tabs value={selectedTimeframe} onValueChange={handleTimeframeChange} className="mb-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="daily">Daily View</TabsTrigger>
            <TabsTrigger value="hourly">Hourly View</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Chart */}
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart 
              data={chartData} 
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
              
              <XAxis
                dataKey="displayLabel"
                tick={{ fontSize: 12 }}
                className="text-gray-500 dark:text-gray-400"
                interval="preserveStartEnd"
              />
              
              <YAxis
                yAxisId="pnl"
                tickFormatter={(value) => `$${(value || 0).toFixed(0)}`}
                className="text-gray-500 dark:text-gray-400"
              />
              
              <YAxis
                yAxisId="cumulative"
                orientation="right"
                tickFormatter={(value) => `$${(value || 0).toFixed(0)}`}
                className="text-gray-500 dark:text-gray-400"
              />
              
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              
              <ReferenceLine y={0} stroke="#666" strokeDasharray="2 2" />
              
              {/* Period P&L Bars */}
              <Bar 
                yAxisId="pnl"
                dataKey="periodPnl" 
                name={selectedTimeframe === 'hourly' ? 'Hourly P&L' : 'Daily P&L'}
                fill="#10b981"
                radius={[2, 2, 0, 0]}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={(entry.periodPnl || 0) >= 0 ? '#10b981' : '#ef4444'}
                  />
                ))}
              </Bar>
              
              {/* Cumulative P&L Line */}
              <Line
                yAxisId="cumulative"
                type="monotone"
                dataKey="cumulativePnl"
                name="Cumulative P&L"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Statistics */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Total {selectedTimeframe === 'hourly' ? 'Hourly' : 'Daily'} P&L
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.totalPeriodPnl >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {formatCurrency(summaryStats.totalPeriodPnl)}
            </div>
          </div>
          
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Cumulative P&L
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.totalCumulativePnl >= 0 ? 'text-blue-500' : 'text-orange-500'
            }`}>
              {formatCurrency(summaryStats.totalCumulativePnl)}
            </div>
          </div>
          
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Avg {selectedTimeframe === 'hourly' ? 'Hourly' : 'Daily'} P&L
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.avgPeriodPnl >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {formatCurrency(summaryStats.avgPeriodPnl)}
            </div>
          </div>
          
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Win Rate
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.winRate >= 50 ? 'text-green-500' : 'text-red-500'
            }`}>
              {summaryStats.winRate.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Additional Metrics */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Best {selectedTimeframe === 'hourly' ? 'Hour' : 'Day'}
            </div>
            <div className="text-lg font-semibold text-green-500">
              {formatCurrency(summaryStats.bestPeriodPnl)}
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Worst {selectedTimeframe === 'hourly' ? 'Hour' : 'Day'}
            </div>
            <div className="text-lg font-semibold text-red-500">
              {formatCurrency(summaryStats.worstPeriodPnl)}
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Profit Factor
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.profitFactor >= 1 ? 'text-green-500' : 'text-red-500'
            }`}>
              {Number.isFinite(summaryStats.profitFactor) ? 
                summaryStats.profitFactor.toFixed(2) : '∞'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
