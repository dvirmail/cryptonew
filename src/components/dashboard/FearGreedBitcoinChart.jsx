import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { TrendingUp, Activity, Brain, Bitcoin } from 'lucide-react';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from "@/components/providers/WalletProvider";
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { queueFunctionCall } from '@/components/utils/apiQueue';
import { getFearAndGreedIndex, getKlineData } from '@/api/functions';
import { format, parseISO, subDays } from 'date-fns';

/**
 * FearGreedBitcoinChart Component
 * 
 * Core Purpose: To analyze the correlation between market sentiment (Fear & Greed Index), 
 * Bitcoin's price movements, and the system's trading performance (P&L). This helps in 
 * understanding how psychological factors and broad market trends might influence trading outcomes.
 * 
 * Data Sources:
 * - Fear & Greed Index: External API (api.alternative.me/fng/)
 * - Bitcoin Price: Binance API (BTCUSDT daily klines)
 * - Trading Performance: HistoricalPerformance Entity
 * 
 * Features:
 * - Multi-axis chart with Fear & Greed, Bitcoin price changes, and system P&L
 * - Correlation analysis between market sentiment and trading performance
 * - Historical data synchronization across all three data sources
 * - Interactive tooltips with detailed metrics
 */
export default function FearGreedBitcoinChart({
  timeframe: initialTimeframe = '30d',
  onTimeframeChange,
  className = "",
  dailyPerformanceHistory = [], // DEPRECATED: pass trades instead
  hourlyPerformanceHistory = [] // DEPRECATED: not used
}) {
  const { isLiveMode } = useTradingMode();
  const {
    loading: walletLoading,
    recentTrades
  } = useWallet();

  const [selectedTimeframe, setSelectedTimeframe] = useState(initialTimeframe);
  const [fearGreedData, setFearGreedData] = useState([]);
  const [bitcoinPrices, setBitcoinPrices] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Determine date range based on timeframe
  const getDateRange = useCallback((timeframe) => {
    const now = new Date();
    switch (timeframe) {
      case '7d':
        return { start: subDays(now, 7), end: now, limit: 7 };
      case '30d':
        return { start: subDays(now, 30), end: now, limit: 30 };
      case '90d':
        return { start: subDays(now, 90), end: now, limit: 90 };
      default:
        return { start: subDays(now, 30), end: now, limit: 30 };
    }
  }, []);

  // Fetch Fear & Greed Index data
  const fetchFearAndGreedData = useCallback(async (limit = 30) => {
    try {
      console.log('[FearGreedBitcoinChart] Fetching Fear & Greed data...');
      const response = await queueFunctionCall(
        'getFearAndGreedIndex',
        getFearAndGreedIndex,
        { limit },
        'low',
        'fearAndGreedIndex',
        300000, // 5 minute cache
        30000  // 30 second timeout
      );
      
      if (response?.data?.data && Array.isArray(response.data.data)) {
        const processedData = response.data.data.map(item => ({
          timestamp: parseInt(item.timestamp) * 1000, // Convert to milliseconds
          value: parseInt(item.value),
          classification: item.value_classification,
          date: format(new Date(parseInt(item.timestamp) * 1000), 'yyyy-MM-dd')
        }));
        
        //console.log('[FearGreedBitcoinChart] Fetched Fear & Greed data:', processedData.length, 'records');
        return processedData;
      } else {
        console.warn('[FearGreedBitcoinChart] Invalid Fear & Greed response format:', response);
        return [];
      }
    } catch (error) {
      console.error('[FearGreedBitcoinChart] Error fetching Fear & Greed data:', error);
      return [];
    }
  }, []);

  // Fetch Bitcoin price data
  const fetchBitcoinData = useCallback(async (limit = 30) => {
    try {
      console.log('[FearGreedBitcoinChart] Fetching Bitcoin price data...');
      const response = await queueFunctionCall(
        'getKlineData',
        getKlineData,
        { 
          symbols: ['BTCUSDT'], 
          interval: '1d', 
          limit 
        },
        'low',
        'bitcoinData',
        300000, // 5 minute cache
        30000   // 30 second timeout
      );
      
      if (response?.data && response.data.BTCUSDT?.success && Array.isArray(response.data.BTCUSDT.data)) {
        const processedData = response.data.BTCUSDT.data
          .filter(item => item?.openTime != null) // Filter out items without openTime
          .map(item => {
            // Handle openTime - it could be a number (timestamp in ms) or string
            let openTime;
            if (typeof item.openTime === 'number') {
              openTime = item.openTime;
            } else if (typeof item.openTime === 'string') {
              openTime = parseInt(item.openTime, 10);
            } else {
              // Skip invalid items
              return null;
            }
            
            // Validate the timestamp
            const dateObj = new Date(openTime);
            if (isNaN(dateObj.getTime())) {
              return null; // Skip invalid dates
            }
            
            const open = parseFloat(item.open);
            const close = parseFloat(item.close);
            const change = ((close - open) / open) * 100;
            
            return {
              timestamp: openTime,
              date: format(dateObj, 'yyyy-MM-dd'),
              open,
              close,
              high: parseFloat(item.high),
              low: parseFloat(item.low),
              volume: parseFloat(item.volume),
              change,
              changeAbs: Math.abs(change)
            };
          })
          .filter(item => item !== null); // Remove any null entries
        
        //console.log('[FearGreedBitcoinChart] Fetched Bitcoin data:', processedData.length, 'records');
        return processedData;
      } else {
        console.warn('[FearGreedBitcoinChart] Invalid Bitcoin response format:', response);
        return [];
      }
    } catch (error) {
      console.error('[FearGreedBitcoinChart] Error fetching Bitcoin data:', error);
      return [];
    }
  }, []);

  // Calculate performance data from trades (group by day)
  const calculatePerformanceFromTrades = useCallback((trades, timeframe) => {
    if (!trades || trades.length === 0) return [];
    
    const { start } = getDateRange(timeframe);
    const filteredTrades = trades.filter(t => {
      if (!t?.exit_timestamp) return false;
      const exitDate = new Date(t.exit_timestamp);
      return exitDate >= start;
    });
    
    // Group trades by day
    const dayMap = new Map();
    filteredTrades.forEach(trade => {
      const exitDate = new Date(trade.exit_timestamp);
      const dayKey = format(new Date(Date.UTC(
        exitDate.getUTCFullYear(),
        exitDate.getUTCMonth(),
        exitDate.getUTCDate()
      )), 'yyyy-MM-dd');
      
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, {
          snapshot_timestamp: new Date(Date.UTC(
            exitDate.getUTCFullYear(),
            exitDate.getUTCMonth(),
            exitDate.getUTCDate()
          )).toISOString(),
          period_pnl: 0,
          period_trade_count: 0,
          period_winning_trades: 0
        });
      }
      
      const dayData = dayMap.get(dayKey);
      dayData.period_pnl += Number(trade.pnl_usdt || 0);
      dayData.period_trade_count++;
      if (Number(trade.pnl_usdt || 0) > 0) {
        dayData.period_winning_trades++;
      }
    });
    
    // Convert to array and calculate cumulative
    const sortedDays = Array.from(dayMap.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
    
    let cumulative = 0;
    return sortedDays.map(([dateKey, data]) => {
      cumulative += data.period_pnl;
      return {
        ...data,
        cumulative_realized_pnl: cumulative
      };
    });
  }, [getDateRange]);

  // Merge data from all sources by date
  const mergeDataByDate = useCallback((fearGreed, bitcoin, performance) => {
    const dateMap = new Map();
    
    // Add Fear & Greed data
    fearGreed.forEach(item => {
      const date = item.date;
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, timestamp: item.timestamp });
      }
      dateMap.get(date).fearGreed = item;
    });
    
    // Add Bitcoin data
    bitcoin.forEach(item => {
      const date = item.date;
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, timestamp: item.timestamp });
      }
      dateMap.get(date).bitcoin = item;
    });
    
    // Add performance data
    performance.forEach(item => {
      const date = format(new Date(item.snapshot_timestamp), 'yyyy-MM-dd');
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, timestamp: new Date(item.snapshot_timestamp).getTime() });
      }
      dateMap.get(date).performance = {
        periodPnl: Number(item.period_pnl || 0),
        cumulativePnl: Number(item.cumulative_realized_pnl || 0),
        periodTrades: Number(item.period_trade_count || 0),
        periodWins: Number(item.period_winning_trades || 0),
        winRate: Number(item.period_trade_count || 0) > 0 ? 
          (Number(item.period_winning_trades || 0) / Number(item.period_trade_count || 0)) * 100 : 0
      };
    });
    
    // Convert to array and sort by date
    const merged = Array.from(dateMap.values())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(item => ({
        date: item.date,
        timestamp: item.timestamp,
        displayLabel: format(new Date(item.date), 'MMM dd'),
        // Fear & Greed data
        fearGreedValue: item.fearGreed?.value || null,
        fearGreedClassification: item.fearGreed?.classification || null,
        // Bitcoin data
        bitcoinPrice: item.bitcoin?.close || null,
        bitcoinChange: item.bitcoin?.change || null,
        bitcoinChangeAbs: item.bitcoin?.changeAbs || null,
        bitcoinVolume: item.bitcoin?.volume || null,
        // Performance data
        systemPnl: item.performance?.periodPnl || 0,
        cumulativePnl: item.performance?.cumulativePnl || 0,
        systemTrades: item.performance?.periodTrades || 0,
        systemWins: item.performance?.periodWins || 0,
        systemWinRate: item.performance?.winRate || 0
      }));
    
    return merged;
  }, []);

  // Fetch all data and merge
  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { limit } = getDateRange(selectedTimeframe);
      
      // Calculate performance data from trades (group by day)
      const performanceData = calculatePerformanceFromTrades(recentTrades || [], selectedTimeframe);
      
      // Fetch all data in parallel
      const [fearGreed, bitcoin] = await Promise.all([
        fetchFearAndGreedData(limit),
        fetchBitcoinData(limit)
      ]);
      
      setFearGreedData(fearGreed);
      setBitcoinPrices(bitcoin);
      
      // Merge data by date
      const mergedData = mergeDataByDate(fearGreed, bitcoin, performanceData);
      setChartData(mergedData);
      
      console.log('[FearGreedBitcoinChart] Merged data:', mergedData.length, 'records');
      
    } catch (error) {
      console.error('[FearGreedBitcoinChart] Error fetching data:', error);
      setError('Failed to load chart data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedTimeframe, recentTrades, fetchFearAndGreedData, fetchBitcoinData, getDateRange, calculatePerformanceFromTrades, mergeDataByDate]);

  // Calculate correlation metrics
  const correlationMetrics = useMemo(() => {
    if (chartData.length < 3) return null;
    
    const validData = chartData.filter(item => 
      item.fearGreedValue !== null && 
      item.bitcoinChange !== null && 
      item.systemPnl !== 0
    );
    
    if (validData.length < 3) return null;
    
    // Calculate correlations
    const fearGreedValues = validData.map(item => item.fearGreedValue);
    const bitcoinChanges = validData.map(item => item.bitcoinChange);
    const systemPnls = validData.map(item => item.systemPnl);
    
    const correlationFG_BTC = calculateCorrelation(fearGreedValues, bitcoinChanges);
    const correlationFG_System = calculateCorrelation(fearGreedValues, systemPnls);
    const correlationBTC_System = calculateCorrelation(bitcoinChanges, systemPnls);
    
    return {
      fearGreedBitcoin: correlationFG_BTC,
      fearGreedSystem: correlationFG_System,
      bitcoinSystem: correlationBTC_System,
      dataPoints: validData.length
    };
  }, [chartData]);

  // Calculate correlation coefficient
  const calculateCorrelation = (x, y) => {
    const n = x.length;
    if (n === 0) return 0;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0]?.payload || {};

      return (
      <div className="rounded-md border bg-white/95 p-3 shadow-lg">
        <div className="text-sm font-semibold mb-2">{data.displayLabel || label}</div>
        <div className="space-y-1 text-xs">
          {data.fearGreedValue !== null && (
            <div className="text-purple-600">
              Fear & Greed: {data.fearGreedValue} ({data.fearGreedClassification})
            </div>
          )}
          {data.bitcoinChange !== null && (
            <div className={`${data.bitcoinChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              Bitcoin: ${data.bitcoinPrice?.toFixed(2)} ({data.bitcoinChange?.toFixed(2)}%)
            </div>
          )}
          <div className={`${data.systemPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            System P&L: ${data.systemPnl?.toFixed(2)}
          </div>
          <div className="text-gray-700">
            Trades: {data.systemTrades} | Win Rate: {data.systemWinRate?.toFixed(1)}%
          </div>
        </div>
        </div>
      );
  };

  // Handle timeframe change
  const handleTimeframeChange = useCallback((newTimeframe) => {
    setSelectedTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
  }, [onTimeframeChange]);

  // Fetch data on component mount and timeframe change
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Subscribe to scanner updates for real-time Fear & Greed data
  useEffect(() => {
    const scannerService = getAutoScannerService();
    const unsubscribe = scannerService.subscribe(() => {
      if (scannerService.fearAndGreedData) {
        // Update Fear & Greed data and re-merge
        const newFearGreedData = [{
          timestamp: parseInt(scannerService.fearAndGreedData.timestamp) * 1000,
          value: parseInt(scannerService.fearAndGreedData.value),
          classification: scannerService.fearAndGreedData.value_classification,
          date: format(new Date(parseInt(scannerService.fearAndGreedData.timestamp) * 1000), 'yyyy-MM-dd')
        }];
        
        setFearGreedData(prev => {
          const updated = [...prev, ...newFearGreedData];
          const performanceData = calculatePerformanceFromTrades(recentTrades || [], selectedTimeframe);
          const merged = mergeDataByDate(updated, bitcoinPrices, performanceData);
          setChartData(merged);
          return updated;
        });
      }
    });

    return () => unsubscribe();
  }, [bitcoinPrices, recentTrades, selectedTimeframe, calculatePerformanceFromTrades, mergeDataByDate]);

  // Loading state
  if (isLoading || walletLoading) {
    return (
      <Card className={`bg-white ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Fear & Greed vs Bitcoin vs System Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse" />
            <p>Loading market sentiment and performance data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className={`bg-white ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Fear & Greed vs Bitcoin vs System Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <p className="text-red-600">{error}</p>
            <button 
              onClick={fetchAllData}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Retry
            </button>
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
            <Brain className="h-5 w-5" />
            Fear & Greed vs Bitcoin vs System Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <p>No data available for correlation analysis.</p>
            <p className="text-sm mt-1">Data will appear as market data and trading activity is recorded.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-white ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Fear & Greed vs Bitcoin vs System Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {/* Timeframe Selector */}
        <Tabs value={selectedTimeframe} onValueChange={handleTimeframeChange} className="mb-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="90d">90 Days</TabsTrigger>
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
                yAxisId="fearGreed"
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'Fear & Greed Index', angle: -90, position: 'insideLeft' }}
              />

              <YAxis
                yAxisId="price"
                orientation="right"
                tickFormatter={(value) => `${value}%`}
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'Bitcoin Change %', angle: 90, position: 'insideRight' }}
              />

              <YAxis
                yAxisId="pnl"
                orientation="right"
                tickFormatter={(value) => `$${value}`}
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'System P&L', angle: 90, position: 'insideRight' }}
              />

              <Tooltip content={<CustomTooltip />} />
              <Legend />

              {/* Fear & Greed Index Line */}
              <Line
                yAxisId="fearGreed"
                type="monotone"
                dataKey="fearGreedValue"
                name="Fear & Greed Index"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
                connectNulls={false}
              />
              
              {/* Bitcoin Change Bars */}
              <Bar 
                yAxisId="price"
                dataKey="bitcoinChange" 
                name="Bitcoin Daily Change %"
                fill="#f59e0b"
                radius={[2, 2, 0, 0]}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={(entry.bitcoinChange || 0) >= 0 ? '#10b981' : '#ef4444'}
                  />
                ))}
              </Bar>

              {/* System P&L Line */}
              <Line
                yAxisId="pnl"
                type="monotone"
                dataKey="systemPnl"
                name="System Daily P&L"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Correlation Analysis */}
        {correlationMetrics && (
          <div className="mt-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Correlation Analysis ({correlationMetrics.dataPoints} data points)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                  Fear & Greed ↔ Bitcoin
                </div>
                <div className={`text-lg font-semibold ${
                  Math.abs(correlationMetrics.fearGreedBitcoin) > 0.3 ? 'text-blue-500' : 'text-gray-500'
                }`}>
                  {correlationMetrics.fearGreedBitcoin.toFixed(3)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Fear & Greed ↔ System P&L
              </div>
                <div className={`text-lg font-semibold ${
                  Math.abs(correlationMetrics.fearGreedSystem) > 0.3 ? 'text-blue-500' : 'text-gray-500'
                }`}>
                  {correlationMetrics.fearGreedSystem.toFixed(3)}
            </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Bitcoin ↔ System P&L
                </div>
                <div className={`text-lg font-semibold ${
                  Math.abs(correlationMetrics.bitcoinSystem) > 0.3 ? 'text-blue-500' : 'text-gray-500'
                }`}>
                  {correlationMetrics.bitcoinSystem.toFixed(3)}
            </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Values closer to ±1 indicate stronger correlation. Values closer to 0 indicate no correlation.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}