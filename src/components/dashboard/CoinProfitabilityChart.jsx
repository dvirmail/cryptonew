
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Coins, Trophy } from "lucide-react";

export default function CoinProfitabilityChart({ coinData = [] }) {
  if (!coinData || coinData.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Most Profitable Coins
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <Coins className="mx-auto h-8 w-8 mb-2" />
            <p>Coin profitability will appear once you have trade data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getBarColor = (totalPnl) => {
    if (totalPnl >= 1000) return "#10b981"; // Very Profitable (Green)
    if (totalPnl >= 500) return "#059669"; // Profitable (Dark Green)
    if (totalPnl >= 100) return "#f59e0b"; // Moderately Profitable (Yellow)
    if (totalPnl >= 0) return "#f97316"; // Slightly Profitable (Orange)
    return "#ef4444"; // Loss (Red)
  };

  // Sort coins by total P&L (highest first) and take top 10
  const sortedCoins = [...coinData]
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, 10);

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Most Profitable Coins
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sortedCoins}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="currentColor" 
                className="stroke-gray-200 dark:stroke-gray-700" 
              />
              <XAxis 
                dataKey="coin"
                tick={{ fill: 'currentColor', fontSize: 12 }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fill: 'currentColor' }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'Total P&L ($)', angle: -90, position: 'insideLeft' }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-color)",
                  border: "none",
                  borderRadius: "8px",
                  color: "var(--text-color)"
                }}
                formatter={(value, name) => [
                  `$${value.toFixed(2)}`,
                  "Total P&L"
                ]}
                labelFormatter={(label) => `${label} Trading Performance`}
              />
              <Bar dataKey="totalPnl" fill="#3b82f6" name="Total P&L">
                {sortedCoins.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.totalPnl)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Summary Stats */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {sortedCoins.slice(0, 4).map((coin, index) => (
            <div key={coin.coin} className="text-center p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
              <div className="flex items-center justify-center gap-1 mb-1">
                {index === 0 && <Trophy className="h-4 w-4 text-yellow-500" />}
                <span className="font-medium">{coin.coin}</span>
              </div>
              <div className={`text-lg font-bold ${coin.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ${(coin.totalPnl || 0).toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {coin.tradeCount} trades • {(coin.winRate || 0).toFixed(1)}% win rate
              </div>
            </div>
          ))}
        </div>
        
        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-500"></div>
            <span>Very Profitable ($1000+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-600"></div>
            <span>Profitable ($500+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-500"></div>
            <span>Moderate ($100+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-orange-500"></div>
            <span>Slight Profit ($0+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500"></div>
            <span>Loss (&lt;$0)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
