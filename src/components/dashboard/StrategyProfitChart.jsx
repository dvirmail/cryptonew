
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
import { TrendingUp, Award } from "lucide-react";

export default function StrategyProfitChart({ strategies = [] }) {
  if (!strategies || strategies.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Strategy Profit Factor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <TrendingUp className="mx-auto h-8 w-8 mb-2" />
            <p>Strategy performance will appear once you have trade data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getBarColor = (profitFactor) => {
    if (profitFactor >= 3.0) return "#10b981"; // Excellent (Green)
    if (profitFactor >= 2.0) return "#059669"; // Very Good (Dark Green)
    if (profitFactor >= 1.5) return "#f59e0b"; // Good (Yellow)
    if (profitFactor >= 1.0) return "#f97316"; // Break-even (Orange)
    return "#ef4444"; // Loss (Red)
  };

  const formatProfitFactor = (value) => {
    if (value >= 10) return "10.0+";
    return value.toFixed(2);
  };

  // Sort strategies by profit factor (highest first) and take top 10
  const sortedStrategies = [...strategies]
    .sort((a, b) => b.profitFactor - a.profitFactor)
    .slice(0, 10)
    .map(strategy => ({
      ...strategy,
      shortName: strategy.strategyName.length > 20 
        ? strategy.strategyName.substring(0, 20) + "..." 
        : strategy.strategyName
    }));

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Top Strategies by Profit Factor (10+ Trades)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sortedStrategies}
              margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="currentColor" 
                className="stroke-gray-200 dark:stroke-gray-700" 
              />
              <XAxis 
                dataKey="shortName"
                tick={{ fill: 'currentColor', fontSize: 12 }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                tick={{ fill: 'currentColor' }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'Profit Factor', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-color)",
                  border: "none",
                  borderRadius: "8px",
                  color: "var(--text-color)"
                }}
                formatter={(value, name, props) => [
                  `${formatProfitFactor(value)} (Trades: ${props.payload.trade_count})`,
                  "Profit Factor"
                ]}
                labelFormatter={(label) => {
                  const strategy = strategies.find(s => s.strategyName.startsWith(label.replace("...", "")));
                  return strategy ? strategy.strategyName : label;
                }}
              />
              <Bar dataKey="profitFactor" fill="#3b82f6" name="Profit Factor">
                {sortedStrategies.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.profitFactor)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-500"></div>
            <span>Excellent (3.0+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-600"></div>
            <span>Very Good (2.0+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-500"></div>
            <span>Good (1.5+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-orange-500"></div>
            <span>Break-even (1.0+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500"></div>
            <span>Loss (&lt;1.0)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
