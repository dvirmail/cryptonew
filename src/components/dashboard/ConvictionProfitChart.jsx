import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Target, BarChart3, Clock } from "lucide-react";

export default function ConvictionProfitChart({ trades = [], backtestCombinations = [] }) {
  const { convictionData, analyzedTradesCount } = useMemo(() => {
    if (!trades || trades.length === 0) return { convictionData: [], analyzedTradesCount: 0 };

    // Create a lookup map by COIN (trading pair) instead of strategy name
    const combinationByCoin = new Map();
    
    if (Array.isArray(backtestCombinations)) {
        backtestCombinations.forEach(combo => {
            if (combo.coin && combo.realAvgConvictionScore !== null && combo.realAvgConvictionScore !== undefined) {
                // Normalize coin format: remove slashes and convert to uppercase
                const normalizedCoin = combo.coin.replace(/\//g, '').toUpperCase();
                
                // Store all combinations for this coin
                if (!combinationByCoin.has(normalizedCoin)) {
                    combinationByCoin.set(normalizedCoin, []);
                }
                combinationByCoin.get(normalizedCoin).push({
                    conviction: combo.realAvgConvictionScore,
                    name: combo.combinationName
                });
            }
        });
    }

    // Filter trades that have conviction_score data (or can infer it)
    const tradesWithConviction = trades.filter(t => {
      let conviction = t.conviction_score;
      
      // Try to infer from BacktestCombination if missing
      if ((conviction === null || conviction === undefined || isNaN(conviction)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        
        if (matchingCombos && matchingCombos.length > 0) {
          // Use average conviction for this coin
          const avgConviction = matchingCombos.reduce((sum, c) => sum + c.conviction, 0) / matchingCombos.length;
          conviction = avgConviction;
        }
      }
      
      return conviction !== null && conviction !== undefined && !isNaN(conviction);
    }).map(t => {
      let conviction = t.conviction_score;
      
      // Infer from BacktestCombination if missing
      if ((conviction === null || conviction === undefined || isNaN(conviction)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        
        if (matchingCombos && matchingCombos.length > 0) {
          const avgConviction = matchingCombos.reduce((sum, c) => sum + c.conviction, 0) / matchingCombos.length;
          conviction = avgConviction;
        }
      }
      
      return { ...t, conviction_score: conviction };
    });

    if (tradesWithConviction.length === 0) return { convictionData: [], analyzedTradesCount: 0 };

    // Create conviction ranges in increments of 5 (0-100 scale)
    const convictionRanges = [];
    for (let i = 0; i < 100; i += 5) {
      const min = i;
      const max = i + 5;
      convictionRanges.push({
        min,
        max,
        label: `${min}-${max}`
      });
    }

    const rangeStats = convictionRanges.map(range => {
      // For the last range (95-100), include the max value, otherwise use < max
      const rangedTrades = tradesWithConviction.filter(t => {
        const score = t.conviction_score;
        if (range.max === 100) {
          return score >= range.min && score <= range.max;
        }
        return score >= range.min && score < range.max;
      });

      if (rangedTrades.length === 0) {
        return {
          range: range.label,
          totalTrades: 0,
          winRate: 0,
          totalPnl: 0,
          profitFactor: 0
        };
      }

      const winningTrades = rangedTrades.filter(t => t.pnl_usdt > 0);
      const totalPnl = rangedTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
      const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl_usdt, 0);
      const grossLoss = Math.abs(rangedTrades.filter(t => t.pnl_usdt <= 0).reduce((sum, t) => sum + t.pnl_usdt, 0));

      return {
        range: range.label,
        totalTrades: rangedTrades.length,
        winRate: (winningTrades.length / rangedTrades.length) * 100,
        totalPnl: totalPnl,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 5.0 : 0)
      };
    }).filter(data => data.totalTrades > 0);

    return { convictionData: rangeStats, analyzedTradesCount: tradesWithConviction.length };
  }, [trades, backtestCombinations]);

  // Time of day performance by conviction score
  const { timeOfDayData } = useMemo(() => {
    if (!trades || trades.length === 0) return { timeOfDayData: [] };

    // Helper function to get time of day from timestamp
    const getTimeOfDay = (timestamp) => {
      if (!timestamp) return null;
      try {
        const date = new Date(timestamp);
        const hour = date.getUTCHours(); // Use UTC to be consistent
        
        if (hour >= 6 && hour < 12) return 'Morning';      // 6:00 AM - 12:00 PM
        if (hour >= 12 && hour < 18) return 'Noon';        // 12:00 PM - 6:00 PM
        if (hour >= 18 && hour < 24) return 'Evening';     // 6:00 PM - 12:00 AM
        return 'Night';                                     // 12:00 AM - 6:00 AM
      } catch (e) {
        return null;
      }
    };

    // Create a lookup map by COIN for conviction scores
    const combinationByCoin = new Map();
    if (Array.isArray(backtestCombinations)) {
      backtestCombinations.forEach(combo => {
        if (combo.coin && combo.realAvgConvictionScore !== null && combo.realAvgConvictionScore !== undefined) {
          const normalizedCoin = combo.coin.replace(/\//g, '').toUpperCase();
          if (!combinationByCoin.has(normalizedCoin)) {
            combinationByCoin.set(normalizedCoin, []);
          }
          combinationByCoin.get(normalizedCoin).push({
            conviction: combo.realAvgConvictionScore,
            name: combo.combinationName
          });
        }
      });
    }

    // Filter and enrich trades with conviction and time of day
    const tradesWithData = trades.filter(t => {
      let conviction = t.conviction_score;
      
      if ((conviction === null || conviction === undefined || isNaN(conviction)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        if (matchingCombos && matchingCombos.length > 0) {
          const avgConviction = matchingCombos.reduce((sum, c) => sum + c.conviction, 0) / matchingCombos.length;
          conviction = avgConviction;
        }
      }
      
      const timeOfDay = getTimeOfDay(t.entry_timestamp);
      return conviction !== null && conviction !== undefined && !isNaN(conviction) && timeOfDay !== null;
    }).map(t => {
      let conviction = t.conviction_score;
      if ((conviction === null || conviction === undefined || isNaN(conviction)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        if (matchingCombos && matchingCombos.length > 0) {
          const avgConviction = matchingCombos.reduce((sum, c) => sum + c.conviction, 0) / matchingCombos.length;
          conviction = avgConviction;
        }
      }
      return { 
        ...t, 
        conviction_score: conviction,
        timeOfDay: getTimeOfDay(t.entry_timestamp)
      };
    });

    if (tradesWithData.length === 0) return { timeOfDayData: [] };

    // Create conviction ranges (same as main chart)
    const convictionRanges = [];
    for (let i = 0; i < 100; i += 5) {
      const min = i;
      const max = i + 5;
      convictionRanges.push({
        min,
        max,
        label: `${min}-${max}`
      });
    }

    // Time of day periods
    const timeOfDayPeriods = ['Morning', 'Noon', 'Evening', 'Night'];

    // Build data structure: for each conviction range, calculate stats for each time of day
    const chartData = convictionRanges.map(range => {
      const dataPoint = { range: range.label };
      
      timeOfDayPeriods.forEach(period => {
        const rangedTrades = tradesWithData.filter(t => {
          const score = t.conviction_score;
          const matchesRange = range.max === 100 
            ? (score >= range.min && score <= range.max)
            : (score >= range.min && score < range.max);
          return matchesRange && t.timeOfDay === period;
        });

        if (rangedTrades.length === 0) {
          dataPoint[`${period}_profitFactor`] = 0;
          dataPoint[`${period}_winRate`] = 0;
          dataPoint[`${period}_trades`] = 0;
        } else {
          const winningTrades = rangedTrades.filter(t => t.pnl_usdt > 0);
          const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl_usdt, 0);
          const grossLoss = Math.abs(rangedTrades.filter(t => t.pnl_usdt <= 0).reduce((sum, t) => sum + t.pnl_usdt, 0));
          
          dataPoint[`${period}_profitFactor`] = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 5.0 : 0);
          dataPoint[`${period}_winRate`] = (winningTrades.length / rangedTrades.length) * 100;
          dataPoint[`${period}_trades`] = rangedTrades.length;
        }
      });
      
      return dataPoint;
    }).filter(data => {
      // Only include ranges that have at least one time of day with trades
      return timeOfDayPeriods.some(period => data[`${period}_trades`] > 0);
    });

    return { timeOfDayData: chartData };
  }, [trades, backtestCombinations]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">Conviction Score: {label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.dataKey === 'profitFactor' && `Profit Factor: ${entry.value.toFixed(2)}`}
              {entry.dataKey === 'winRate' && `Win Rate: ${entry.value.toFixed(1)}%`}
            </p>
          ))}
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Total P&L: ${payload[0]?.payload?.totalPnl?.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Trades: {payload[0]?.payload?.totalTrades}
          </p>
        </div>
      );
    }
    return null;
  };

  const totalTradesAvailable = trades.length;

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Target className="h-5 w-5" />
          Performance by Conviction Score
        </CardTitle>
        <CardDescription>
          Analyzed {analyzedTradesCount.toLocaleString()} of {totalTradesAvailable.toLocaleString()} trades. Only trades with a conviction score are included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {convictionData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <BarChart3 className="mx-auto h-8 w-8 mb-2" />
            <p>No trades with conviction score data found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={convictionData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                  
                  <XAxis 
                    dataKey="range" 
                    tick={{ fill: 'currentColor' }}
                    stroke="currentColor"
                    className="text-gray-500 dark:text-gray-400"
                  />
                  
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: 'currentColor' }}
                    stroke="currentColor"
                    className="text-gray-500 dark:text-gray-400"
                    label={{ value: 'Profit Factor', angle: -90, position: 'insideLeft' }}
                  />
                  
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: 'currentColor' }}
                    stroke="currentColor"
                    className="text-gray-500 dark:text-gray-400"
                    label={{ value: 'Win Rate (%)', angle: 90, position: 'insideRight' }}
                    domain={[0, 100]}
                  />

                  <Tooltip content={<CustomTooltip />} />
                  <Legend />

                  <Bar 
                    yAxisId="left"
                    dataKey="profitFactor" 
                    fill="#8b5cf6" 
                    name="Profit Factor"
                  />

                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="winRate"
                    stroke="#f59e0b"
                    strokeWidth={3}
                    dot={{ fill: '#f59e0b', strokeWidth: 2, r: 6 }}
                    name="Win Rate (%)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Stats */}
            {convictionData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Best Performing Range (P/F)</div>
                  <div className="text-lg font-semibold text-purple-500">
                    {(() => {
                      const best = convictionData.reduce((prev, current) => 
                        (prev.profitFactor > current.profitFactor) ? prev : current
                      );
                      return best.range;
                    })()}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Highest Win Rate</div>
                  <div className="text-lg font-semibold text-yellow-500">
                    {(() => {
                      const bestWR = convictionData.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      );
                      return `${bestWR.range} (${bestWR.winRate.toFixed(1)}%)`;
                    })()}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Total Trades with Conviction</div>
                  <div className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                    {analyzedTradesCount.toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Time of Day Performance Chart */}
            {timeOfDayData && timeOfDayData.length > 0 && (
              <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Performance by Conviction Score - Time of Day
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Profit Factor by time of day across conviction score ranges
                  </p>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeOfDayData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                      
                      <XAxis 
                        dataKey="range" 
                        tick={{ fill: 'currentColor' }}
                        stroke="currentColor"
                        className="text-gray-500 dark:text-gray-400"
                      />
                      
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: 'currentColor' }}
                        stroke="currentColor"
                        className="text-gray-500 dark:text-gray-400"
                        label={{ value: 'Profit Factor', angle: -90, position: 'insideLeft' }}
                      />
                      
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: 'currentColor' }}
                        stroke="currentColor"
                        className="text-gray-500 dark:text-gray-400"
                        label={{ value: 'Win Rate (%)', angle: 90, position: 'insideRight' }}
                        domain={[0, 100]}
                      />

                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                                <p className="font-medium mb-2">Conviction Score: {label}</p>
                                {payload.map((entry, index) => {
                                  const timeOfDay = entry.dataKey.replace('_profitFactor', '').replace('_winRate', '');
                                  const metric = entry.dataKey.includes('profitFactor') ? 'Profit Factor' : 'Win Rate';
                                  const value = entry.dataKey.includes('profitFactor') 
                                    ? entry.value.toFixed(2) 
                                    : `${entry.value.toFixed(1)}%`;
                                  const trades = entry.payload[`${timeOfDay}_trades`] || 0;
                                  return (
                                    <p key={index} style={{ color: entry.color }} className="text-sm">
                                      {timeOfDay} - {metric}: {value} ({trades} trades)
                                    </p>
                                  );
                                })}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Legend />

                      {/* Profit Factor Lines for each time of day */}
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="Morning_profitFactor"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                        name="Morning (6AM-12PM)"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="Noon_profitFactor"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                        name="Noon (12PM-6PM)"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="Evening_profitFactor"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                        name="Evening (6PM-12AM)"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="Night_profitFactor"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
                        name="Night (12AM-6AM)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}