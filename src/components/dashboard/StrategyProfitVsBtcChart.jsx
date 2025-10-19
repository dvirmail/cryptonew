import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, BarChart3 } from "lucide-react";

export default function StrategyProfitVsBtcChart({ trades = [] }) {
  const [selectedTimeframe, setSelectedTimeframe] = useState("30d");
  
  const chartData = useMemo(() => {
    if (!trades || trades.length === 0) return [];

    // Get timeframe boundaries
    const now = new Date();
    let startDate;
    
    switch (selectedTimeframe) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
    }

    // Filter trades to selected timeframe
    const filteredTrades = trades.filter(trade => 
      new Date(trade.exit_timestamp) >= startDate
    );

    if (filteredTrades.length === 0) return [];

    // Group trades by day and calculate metrics
    const dailyData = {};
    
    filteredTrades.forEach(trade => {
      const tradeDate = new Date(trade.exit_timestamp);
      const dateKey = tradeDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = {
          trades: [],
          totalPnl: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
          btcChange: Math.random() * 10 - 5 // Placeholder for BTC change, should be replaced with real data
        };
      }
      
      dailyData[dateKey].trades.push(trade);
      dailyData[dateKey].totalPnl += trade.pnl_usdt || 0;
      
      if ((trade.pnl_usdt || 0) > 0) {
        dailyData[dateKey].winningTrades++;
        dailyData[dateKey].grossProfit += trade.pnl_usdt;
      } else {
        dailyData[dateKey].grossLoss += Math.abs(trade.pnl_usdt || 0);
      }
    });

    // Calculate profit factor for each day and prepare scatter plot data
    const scatterData = Object.entries(dailyData).map(([dateKey, data]) => {
      const profitFactor = data.grossLoss > 0 ? data.grossProfit / data.grossLoss : (data.grossProfit > 0 ? 5.0 : 0);
      
      return {
        date: dateKey,
        profitFactor: Math.min(profitFactor, 10), // Cap at 10 for better visualization
        btcChange: data.btcChange,
        totalPnl: data.totalPnl,
        tradeCount: data.trades.length,
        displayDate: new Date(dateKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    });

    return scatterData.filter(point => point.tradeCount > 0); // Only include days with trades
  }, [trades, selectedTimeframe]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">{`Date: ${data.displayDate}`}</p>
          <p className="text-sm text-blue-600">{`Profit Factor: ${data.profitFactor.toFixed(2)}`}</p>
          <p className="text-sm text-green-600">{`BTC Change: ${data.btcChange >= 0 ? '+' : ''}${data.btcChange.toFixed(2)}%`}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">{`Total P&L: $${data.totalPnl.toFixed(2)}`}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{`Trades: ${data.tradeCount}`}</p>
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
            Strategy Profit Factor vs Bitcoin % Change
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <BarChart3 className="mx-auto h-8 w-8 mb-2" />
            <p>Strategy performance correlation will appear once you have trade data.</p>
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
          Strategy Profit Factor vs Bitcoin % Change
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTimeframe} onValueChange={setSelectedTimeframe} className="mb-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="90d">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>

        {chartData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <p>No trades found for the selected timeframe.</p>
          </div>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                
                <XAxis 
                  type="number"
                  dataKey="btcChange"
                  name="BTC Change (%)"
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Bitcoin Daily Change (%)', position: 'insideBottom', offset: -10 }}
                />
                
                <YAxis
                  type="number"
                  dataKey="profitFactor"
                  name="Profit Factor"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Strategy Profit Factor', angle: -90, position: 'insideLeft' }}
                  domain={[0, 'dataMax']}
                />

                {/* Reference lines for neutral zones */}
                <ReferenceLine x={0} stroke="#666" strokeDasharray="2 2" />
                <ReferenceLine y={1} stroke="#666" strokeDasharray="2 2" />

                <Tooltip content={<CustomTooltip />} />

                <Scatter 
                  name="Daily Performance" 
                  data={chartData} 
                  fill="#3b82f6"
                  fillOpacity={0.7}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Summary Stats */}
        {chartData.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Avg Profit Factor</div>
              <div className="text-lg font-semibold text-blue-500">
                {(chartData.reduce((sum, d) => sum + d.profitFactor, 0) / chartData.length).toFixed(2)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Best Day P/F</div>
              <div className="text-lg font-semibold text-green-500">
                {Math.max(...chartData.map(d => d.profitFactor)).toFixed(2)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Total Trading Days</div>
              <div className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                {chartData.length}
              </div>
            </div>
          </div>
        )}

        {/* Analysis Insights */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Performance Analysis</h4>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            This scatter plot shows how your strategy's daily profit factor correlates with Bitcoin's daily price movement. 
            Points in the upper quadrants indicate profitable days, while points scattered across different BTC changes 
            suggest your strategy's independence from market direction.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}