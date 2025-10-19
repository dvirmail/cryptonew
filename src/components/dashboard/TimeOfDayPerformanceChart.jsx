import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { Clock, Sun, Sunset, Moon } from "lucide-react";

const getTimeOfDayIcon = (period) => {
  switch (period?.toLowerCase()) {
    case "morning":
      return <Sun className="h-4 w-4" />;
    case "afternoon": 
      return <Sun className="h-4 w-4" />;
    case "evening":
      return <Sunset className="h-4 w-4" />;
    case "night":
      return <Moon className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
};

const getTimeOfDay = (timestamp) => {
  const hour = new Date(timestamp).getHours();
  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  if (hour >= 18 && hour < 22) return "Evening";
  return "Night";
};

const getBarColor = (winRate) => {
  if (winRate >= 60) return "#10b981"; // Green for good performance
  if (winRate >= 50) return "#f59e0b"; // Yellow for average
  return "#ef4444"; // Red for poor performance
};

export default function TimeOfDayPerformanceChart({ trades = [] }) {
  const timeOfDayData = useMemo(() => {
    if (!trades || trades.length === 0) return [];

    const timeStats = trades.reduce((acc, trade) => {
      const timeOfDay = getTimeOfDay(trade.entry_timestamp);
      if (!acc[timeOfDay]) {
        acc[timeOfDay] = {
          totalTrades: 0,
          winningTrades: 0,
          totalPnl: 0,
          grossProfit: 0,
          grossLoss: 0,
        };
      }
      acc[timeOfDay].totalTrades++;
      acc[timeOfDay].totalPnl += trade.pnl_usdt || 0;
      if ((trade.pnl_usdt || 0) > 0) {
        acc[timeOfDay].winningTrades++;
        acc[timeOfDay].grossProfit += trade.pnl_usdt;
      } else {
        acc[timeOfDay].grossLoss += Math.abs(trade.pnl_usdt);
      }
      return acc;
    }, {});

    return Object.entries(timeStats).map(([timeOfDay, stats]) => ({
      timeOfDay,
      ...stats,
      winRate: stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0,
      profitFactor: stats.grossLoss > 0 ? stats.grossProfit / stats.grossLoss : (stats.grossProfit > 0 ? 5.0 : 0),
    }));
  }, [trades]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium flex items-center gap-2">
            {getTimeOfDayIcon(label)}
            {label}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.dataKey === 'winRate' && `Win Rate: ${entry.value.toFixed(1)}%`}
              {entry.dataKey === 'profitFactor' && `Profit Factor: ${entry.value.toFixed(2)}`}
            </p>
          ))}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Total Trades: {payload[0]?.payload?.totalTrades}
          </p>
        </div>
      );
    }
    return null;
  };

  if (!trades || trades.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Performance by Time of Day
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <Clock className="mx-auto h-8 w-8 mb-2" />
            <p>No trade data available to analyze time of day performance.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Performance by Time of Day
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Chart */}
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeOfDayData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                
                <XAxis 
                  dataKey="timeOfDay" 
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                />
                
                {/* Left Y-Axis for Win Rate */}
                <YAxis
                  yAxisId="left"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Win Rate (%)', angle: -90, position: 'insideLeft' }}
                  domain={[0, 100]}
                />
                
                {/* Right Y-Axis for Profit Factor */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Profit Factor', angle: 90, position: 'insideRight' }}
                  domain={[0, 'dataMax']}
                />

                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* Win Rate Bars */}
                <Bar 
                  yAxisId="left"
                  dataKey="winRate" 
                  fill="#3b82f6" 
                  name="Win Rate (%)"
                >
                  {timeOfDayData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getBarColor(entry.winRate)} />
                  ))}
                </Bar>

                {/* Profit Factor Line */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="profitFactor"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  dot={{ fill: '#f59e0b', strokeWidth: 2, r: 6 }}
                  name="Profit Factor"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {timeOfDayData.map((timeStats) => (
              <div 
                key={timeStats.timeOfDay} 
                className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getTimeOfDayIcon(timeStats.timeOfDay)}
                    <span className="font-medium text-sm">{timeStats.timeOfDay}</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                    <span className={`font-medium ${
                      timeStats.winRate >= 60 ? 'text-green-500' : 
                      timeStats.winRate >= 50 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {timeStats.winRate.toFixed(1)}%
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Profit Factor:</span>
                    <span className={`font-medium ${
                      timeStats.profitFactor >= 2.0 ? 'text-green-500' : 
                      timeStats.profitFactor >= 1.0 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {timeStats.profitFactor.toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total Trades:</span>
                    <span className="font-medium">{timeStats.totalTrades}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total P&L:</span>
                    <span className={`font-medium ${(timeStats.totalPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${(timeStats.totalPnl || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Insights */}
          {timeOfDayData.length > 0 && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Time of Day Performance Insights</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Win Rate: </span>
                  <span className="font-medium">
                    {(() => {
                      const best = timeOfDayData.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      );
                      return `${best.timeOfDay} (${best.winRate.toFixed(1)}%)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Profit Factor: </span>
                  <span className="font-medium">
                    {(() => {
                      const bestPF = timeOfDayData.reduce((prev, current) => 
                        (prev.profitFactor > current.profitFactor) ? prev : current
                      );
                      return `${bestPF.timeOfDay} (${bestPF.profitFactor.toFixed(2)})`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Active: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostActive = timeOfDayData.reduce((prev, current) => 
                        (prev.totalTrades > current.totalTrades) ? prev : current
                      );
                      return `${mostActive.timeOfDay} (${mostActive.totalTrades} trades)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Profitable: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostProfitable = timeOfDayData.reduce((prev, current) => 
                        ((prev.totalPnl || 0) > (current.totalPnl || 0)) ? prev : current
                      );
                      return `${mostProfitable.timeOfDay} ($${(mostProfitable.totalPnl || 0).toFixed(2)})`;
                    })()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}