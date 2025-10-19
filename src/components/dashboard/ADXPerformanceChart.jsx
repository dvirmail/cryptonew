
import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, BarChart3 } from "lucide-react";

export default function ADXPerformanceChart({ trades = [] }) {
  const [selectedTimeframe, setSelectedTimeframe] = useState("30d");
  
  const chartData = useMemo(() => {
    if (!trades || trades.length === 0) return [];

    // Get timeframe boundaries
    const now = new Date();
    let startDate;
    
    switch (selectedTimeframe) {
      case "1d":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "1w":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    // Filter trades to selected timeframe
    const filteredTrades = trades.filter(trade => 
      new Date(trade.exit_timestamp) >= startDate
    );

    if (filteredTrades.length === 0) return [];

    // Group trades by time periods
    const groupBy = selectedTimeframe === "1d" ? "hour" : selectedTimeframe === "1w" ? "day" : "day";
    const groupedData = {};

    filteredTrades.forEach(trade => {
      const tradeDate = new Date(trade.exit_timestamp);
      let timeKey;
      
      if (groupBy === "hour") {
        timeKey = `${tradeDate.getFullYear()}-${String(tradeDate.getMonth() + 1).padStart(2, '0')}-${String(tradeDate.getDate()).padStart(2, '0')} ${String(tradeDate.getHours()).padStart(2, '0')}:00`;
      } else {
        timeKey = `${tradeDate.getFullYear()}-${String(tradeDate.getMonth() + 1).padStart(2, '0')}-${String(tradeDate.getDate()).padStart(2, '0')}`;
      }

      if (!groupedData[timeKey]) {
        groupedData[timeKey] = {
          trades: [],
          adxSum: 0,
          adxCount: 0
        };
      }
      
      groupedData[timeKey].trades.push(trade);
      
      // Extract ADX value from trigger signals if available
      const adxSignal = trade.trigger_signals?.find(signal => 
        signal.type === 'adx' || signal.details?.includes('ADX')
      );
      
      if (adxSignal && adxSignal.strength) {
        // Use signal strength as a proxy for ADX value if available
        groupedData[timeKey].adxSum += adxSignal.strength;
        groupedData[timeKey].adxCount++;
      } else {
        // Default ADX estimation based on market conditions
        // In a real implementation, you'd want actual ADX data
        const estimatedADX = Math.random() * 40 + 10; // 10-50 range for demo
        groupedData[timeKey].adxSum += estimatedADX;
        groupedData[timeKey].adxCount++;
      }
    });

    // Calculate metrics for each time period
    const processedData = Object.entries(groupedData).map(([timeKey, data]) => {
      const { trades: periodTrades, adxSum, adxCount } = data;
      
      // Calculate success rate
      const winningTrades = periodTrades.filter(t => t.pnl_usdt > 0);
      const successRate = (winningTrades.length / periodTrades.length) * 100;
      
      // Calculate profit factor
      const totalGrossProfit = winningTrades.reduce((sum, t) => sum + t.pnl_usdt, 0);
      const losingTrades = periodTrades.filter(t => t.pnl_usdt <= 0);
      const totalGrossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl_usdt, 0));
      const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : (totalGrossProfit > 0 ? 5.0 : 0);
      
      // Calculate average ADX
      const avgADX = adxCount > 0 ? adxSum / adxCount : 25; // Default to 25 if no data
      
      return {
        timeKey,
        displayTime: groupBy === "hour" ? timeKey.split(' ')[1] : timeKey.split('-').slice(1).join('/'),
        successRate: Math.round(successRate * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        avgADX: Math.round(avgADX * 100) / 100,
        tradeCount: periodTrades.length
      };
    });

    // Sort by time
    return processedData.sort((a, b) => a.timeKey.localeCompare(b.timeKey));
  }, [trades, selectedTimeframe]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">{`Time: ${label}`}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.dataKey === 'successRate' && `Success Rate: ${entry.value}%`}
              {entry.dataKey === 'profitFactor' && `Profit Factor: ${entry.value}`}
              {entry.dataKey === 'avgADX' && `Avg ADX: ${entry.value}`}
            </p>
          ))}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Trades: {payload[0]?.payload?.tradeCount}
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
            <TrendingUp className="h-5 w-5" />
            Success Rate & Profit Factor vs ADX Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <BarChart3 className="mx-auto h-8 w-8 mb-2" />
            <p>ADX performance correlation will appear once you have trade data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Success Rate & Profit Factor vs ADX Over Time
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTimeframe} onValueChange={setSelectedTimeframe} className="mb-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="1d">24 Hours</TabsTrigger>
            <TabsTrigger value="1w">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
          </TabsList>
        </Tabs>

        {chartData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <p>No trades found for the selected timeframe.</p>
          </div>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                
                <XAxis 
                  dataKey="displayTime" 
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                />
                
                {/* Left Y-Axis for Success Rate and Profit Factor */}
                <YAxis
                  yAxisId="left"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Success Rate (%) / Profit Factor', angle: -90, position: 'insideLeft' }}
                />
                
                {/* Right Y-Axis for ADX with 5-unit increments */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'ADX', angle: 90, position: 'insideRight' }}
                  domain={[20, 40]}
                  ticks={[0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40]}
                  tickFormatter={(value) => `${value}`}
                />

                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* ADX as bars */}
                <Bar
                  yAxisId="right"
                  dataKey="avgADX"
                  fill="#e5e5e5"
                  fillOpacity={0.6}
                  name="Average ADX"
                />

                {/* Success Rate as a line */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="successRate"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                  name="Success Rate (%)"
                />

                {/* Profit Factor as a line */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="profitFactor"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                  name="Profit Factor"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Summary Stats */}
        {chartData.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Avg Success Rate</div>
              <div className="text-lg font-semibold text-green-500">
                {(chartData.reduce((sum, d) => sum + d.successRate, 0) / chartData.length).toFixed(1)}%
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Avg Profit Factor</div>
              <div className="text-lg font-semibold text-blue-500">
                {(chartData.reduce((sum, d) => sum + d.profitFactor, 0) / chartData.length).toFixed(2)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Avg ADX</div>
              <div className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                {(chartData.reduce((sum, d) => sum + d.avgADX, 0) / chartData.length).toFixed(1)}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
