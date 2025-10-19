
import React, { useState } from "react";
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
import { Clock, Sun, Moon, Sunrise, Sunset, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function TimeOfDayAnalytics({ timeAnalytics = [] }) {
  const [chartView, setChartView] = useState("winRate"); // winRate or profitFactor

  if (!timeAnalytics || timeAnalytics.length === 0) {
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
            <p>Time-based analytics will appear once you have trade data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTimeIcon = (timeSlot) => {
    switch (timeSlot) {
      case "00-06": return <Moon className="h-4 w-4" />;
      case "06-12": return <Sunrise className="h-4 w-4" />;
      case "12-18": return <Sun className="h-4 w-4" />;
      case "18-24": return <Sunset className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getTimeLabel = (timeSlot) => {
    switch (timeSlot) {
      case "00-06": return "Night";
      case "06-12": return "Morning";
      case "12-18": return "Afternoon";
      case "18-24": return "Evening";
      default: return timeSlot;
    }
  };

  const getBarColor = (value, metric) => {
    if (metric === 'winRate') {
      if (value >= 60) return "#10b981"; // Green for good performance
      if (value >= 50) return "#f59e0b"; // Yellow for average
      return "#ef4444"; // Red for poor performance
    } else if (metric === 'profitFactor') {
      if (value >= 2.0) return "#10b981"; // Green for good profit factor
      if (value >= 1.0) return "#f59e0b"; // Yellow for break-even
      return "#ef4444"; // Red for losses
    }
    return "#3b82f6";
  };

  // Custom tooltip for the composed chart
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium">{`${getTimeLabel(label)} (${label}:00)`}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.dataKey === 'winRate' && `Win Rate: ${entry.value.toFixed(1)}%`}
              {entry.dataKey === 'profitFactor' && `Profit Factor: ${entry.value.toFixed(2)}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Performance by Time of Day
          </CardTitle>
          <Select value={chartView} onValueChange={setChartView}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Chart View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="winRate">Win Rate Focus</SelectItem>
              <SelectItem value="profitFactor">Profit Factor Focus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Enhanced Chart with Dual Y-Axis */}
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeAnalytics} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis 
                  dataKey="timeSlot" 
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  tickFormatter={getTimeLabel}
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
                  opacity={chartView === "winRate" ? 1.0 : 0.6}
                >
                  {timeAnalytics.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getBarColor(entry.winRate, 'winRate')} />
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
                  opacity={chartView === "profitFactor" ? 1.0 : 0.6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Enhanced Stats Grid with Profit Factor */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {timeAnalytics.map((timeData, index) => (
              <div 
                key={timeData.timeSlot} 
                className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getTimeIcon(timeData.timeSlot)}
                    <span className="font-medium text-sm">{getTimeLabel(timeData.timeSlot)}</span>
                  </div>
                  <span className="text-xs text-gray-500">{timeData.timeSlot}:00</span>
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                    <span className={`font-medium ${
                      timeData.winRate >= 60 ? 'text-green-500' : 
                      timeData.winRate >= 50 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {timeData.winRate.toFixed(1)}%
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Profit Factor:</span>
                    <span className={`font-medium ${
                      timeData.profitFactor >= 2.0 ? 'text-green-500' : 
                      timeData.profitFactor >= 1.0 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {timeData.profitFactor.toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Trades:</span>
                    <span className="font-medium">{timeData.trades}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total P&L:</span>
                    <span className={`font-medium ${(timeData.totalPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${(timeData.totalPnl || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Enhanced Insights with Profit Factor */}
          {timeAnalytics.length > 0 && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Key Insights</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Win Rate: </span>
                  <span className="font-medium">
                    {(() => {
                      const best = timeAnalytics.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      );
                      return `${getTimeLabel(best.timeSlot)} (${best.winRate.toFixed(1)}%)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Profit Factor: </span>
                  <span className="font-medium">
                    {(() => {
                      const bestPF = timeAnalytics.reduce((prev, current) => 
                        (prev.profitFactor > current.profitFactor) ? prev : current
                      );
                      return `${getTimeLabel(bestPF.timeSlot)} (${bestPF.profitFactor.toFixed(2)})`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Active: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostActive = timeAnalytics.reduce((prev, current) => 
                        (prev.trades > current.trades) ? prev : current
                      );
                      return `${getTimeLabel(mostActive.timeSlot)} (${mostActive.trades} trades)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Profitable: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostProfitable = timeAnalytics.reduce((prev, current) => 
                        ((prev.totalPnl || 0) > (current.totalPnl || 0)) ? prev : current
                      );
                      return `${getTimeLabel(mostProfitable.timeSlot)} ($${(mostProfitable.totalPnl || 0).toFixed(2)})`;
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
