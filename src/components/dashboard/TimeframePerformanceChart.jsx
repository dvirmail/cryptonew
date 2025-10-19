import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { BarChart3, Clock, DollarSign } from "lucide-react";

export default function TimeframePerformanceChart({ trades = [], backtestCombinations = [] }) {
  const timeframeData = useMemo(() => {
    if (!trades || trades.length === 0 || !backtestCombinations || backtestCombinations.length === 0) {
      return [];
    }

    // Create a mapping from COIN to timeframe
    const coinTimeframeMap = {};
    backtestCombinations.forEach(combination => {
      if (combination.coin && combination.timeframe) {
        // Normalize coin format
        const normalizedCoin = combination.coin.replace(/\//g, '').toUpperCase();
        // Store timeframe for this coin (if multiple, we'll use the first one or most common)
        if (!coinTimeframeMap[normalizedCoin]) {
          coinTimeframeMap[normalizedCoin] = [];
        }
        coinTimeframeMap[normalizedCoin].push(combination.timeframe);
      }
    });

    // Get most common timeframe for each coin
    const coinToTimeframe = {};
    Object.keys(coinTimeframeMap).forEach(coin => {
      const timeframes = coinTimeframeMap[coin];
      const counts = {};
      timeframes.forEach(tf => {
        counts[tf] = (counts[tf] || 0) + 1;
      });
      const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      coinToTimeframe[coin] = mostCommon;
    });

    console.log('[TIMEFRAME_CALC] Coin to timeframe map:', coinToTimeframe);

    // Group trades by timeframe using the coin mapping
    const timeframeStats = trades.reduce((acc, trade) => {
      let timeframe = 'Unknown';
      
      if (trade.symbol) {
        const normalizedSymbol = trade.symbol.replace(/\//g, '').toUpperCase();
        if (coinToTimeframe[normalizedSymbol]) {
          timeframe = coinToTimeframe[normalizedSymbol];
        }
      }

      if (!acc[timeframe]) {
        acc[timeframe] = {
          totalPnl: 0,
          grossProfit: 0,
          grossLoss: 0,
          totalDurationHours: 0,
          tradeCount: 0,
        };
      }

      const stats = acc[timeframe];
      stats.tradeCount++;
      stats.totalPnl += trade.pnl_usdt || 0;
      stats.totalDurationHours += (trade.duration_seconds || 0) / 3600;

      if ((trade.pnl_usdt || 0) > 0) {
        stats.grossProfit += trade.pnl_usdt;
      } else {
        stats.grossLoss += Math.abs(trade.pnl_usdt);
      }
      
      return acc;
    }, {});

    return Object.entries(timeframeStats)
      .map(([timeframe, stats]) => {
        if (stats.tradeCount === 0) return null;
        
        const profitFactor = stats.grossLoss > 0 ? stats.grossProfit / stats.grossLoss : (stats.grossProfit > 0 ? 5.0 : 0);
        const avgHourlyPnl = stats.totalDurationHours > 0 ? stats.totalPnl / stats.totalDurationHours : 0;
        
        return {
          timeframe,
          ...stats,
          profitFactor,
          avgHourlyPnl,
        };
      })
      .filter(Boolean)
      .sort((a, b) => { 
        // Sort timeframes logically, putting "Unknown" at the end
        if (a.timeframe === 'Unknown') return 1;
        if (b.timeframe === 'Unknown') return -1;
        
        const getTimeValue = (tf) => {
          const num = parseInt(tf);
          if (isNaN(num)) return Infinity;
          if (tf.includes('m')) return num;
          if (tf.includes('h')) return num * 60;
          if (tf.includes('d')) return num * 60 * 24;
          if (tf.includes('w')) return num * 60 * 24 * 7;
          return Infinity;
        };
        return getTimeValue(a.timeframe) - getTimeValue(b.timeframe);
      });
  }, [trades, backtestCombinations]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">Timeframe: {label}</p>
          <p className="text-sm" style={{ color: payload.find(p => p.dataKey === 'avgHourlyPnl')?.fill }}>
            Avg. Hourly P&L: ${data.avgHourlyPnl.toFixed(2)}
          </p>
          <p className="text-sm" style={{ color: payload.find(p => p.dataKey === 'profitFactor')?.stroke }}>
            Profit Factor: {data.profitFactor.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Trades: {data.tradeCount}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Total P&L: ${data.totalPnl.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };
  
  if (timeframeData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Analytics by Timeframe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <BarChart3 className="mx-auto h-8 w-8 mb-2" />
            <p>No trade data with timeframe information found.</p>
            <p className="text-sm mt-2">
              {backtestCombinations.length === 0 
                ? "No backtest combinations found. Please run backtests first."
                : "No matching strategies found between trades and backtest combinations."
              }
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Analytics by Timeframe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeframeData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                
                <XAxis 
                  dataKey="timeframe" 
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                />
                
                <YAxis
                  yAxisId="hourlyPnl"
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Avg. Hourly P&L ($)', angle: -90, position: 'insideLeft' }}
                />
                
                <YAxis
                  yAxisId="pf"
                  orientation="right"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Profit Factor', angle: 90, position: 'insideRight' }}
                />

                <Tooltip content={<CustomTooltip />} />
                <Legend />

                <Bar 
                  yAxisId="hourlyPnl"
                  dataKey="avgHourlyPnl" 
                  fill="#3b82f6" 
                  name="Avg. Hourly P&L"
                />

                <Line
                  yAxisId="pf"
                  type="monotone"
                  dataKey="profitFactor"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Profit Factor"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Stats */}
          {timeframeData.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="text-sm text-gray-500 dark:text-gray-400">Best Performing Timeframe (P/F)</div>
                <div className="text-lg font-semibold text-green-500">
                  {(() => {
                    const best = timeframeData.reduce((prev, current) => 
                      (prev.profitFactor > current.profitFactor) ? prev : current
                    );
                    return best.timeframe;
                  })()}
                </div>
              </div>
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="text-sm text-gray-500 dark:text-gray-400">Best Hourly P&L Timeframe</div>
                <div className="text-lg font-semibold text-blue-500">
                  {(() => {
                    const bestHourly = timeframeData.reduce((prev, current) => 
                      (prev.avgHourlyPnl > current.avgHourlyPnl) ? prev : current
                    );
                    return `${bestHourly.timeframe} ($${bestHourly.avgHourlyPnl.toFixed(2)}/hr)`;
                  })()}
                </div>
              </div>
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="text-sm text-gray-500 dark:text-gray-400">Total Timeframes</div>
                <div className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                  {timeframeData.length}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total P&L by Timeframe Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Total P&L by Timeframe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timeframe</TableHead>
                <TableHead className="text-center">Total Trades</TableHead>
                <TableHead className="text-center">Win Rate</TableHead>
                <TableHead className="text-center">Profit Factor</TableHead>
                <TableHead className="text-right">Total P&L</TableHead>
                <TableHead className="text-right">Avg. Hourly P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeframeData
                .sort((a, b) => b.totalPnl - a.totalPnl) // Sort by total P&L descending
                .map((data) => {
                  const winRate = data.tradeCount > 0 ? ((data.grossProfit / (data.grossProfit + data.grossLoss)) * 100) : 0;
                  return (
                    <TableRow key={data.timeframe}>
                      <TableCell className="font-medium">{data.timeframe}</TableCell>
                      <TableCell className="text-center">{data.tradeCount}</TableCell>
                      <TableCell className="text-center">
                        <span className={winRate >= 50 ? 'text-green-500' : 'text-red-500'}>
                          {winRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={data.profitFactor >= 1 ? 'text-green-500' : 'text-red-500'}>
                          {data.profitFactor.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={data.totalPnl >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                          ${data.totalPnl >= 0 ? '+' : ''}${data.totalPnl.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={data.avgHourlyPnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                          ${data.avgHourlyPnl >= 0 ? '+' : ''}${data.avgHourlyPnl.toFixed(2)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}