
import React from "react";
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
import { BrainCircuit, TrendingUp, TrendingDown, Waves, HelpCircle } from "lucide-react"; // Add HelpCircle

export default function RegimePerformanceChart({ regimeData = [] }) {
  if (!regimeData || regimeData.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            Strategy Performance by Market Regime
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <BrainCircuit className="mx-auto h-8 w-8 mb-2" />
            <div className="space-y-2">
              <p className="font-medium">No Market Regime Data Available</p>
              <p className="text-sm">Your existing trades were created before regime tracking was enabled.</p>
              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-left">
                <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">To see regime performance:</h4>
                <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                  <li>1. Go to Backtesting page</li>
                  <li>2. Enable "Regime-Aware Mode" toggle</li>
                  <li>3. Run new backtests to generate regime-tagged trades</li>
                  <li>4. Or start live trading with regime detection enabled</li>
                </ol>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getRegimeIcon = (regime) => {
    switch (regime?.toLowerCase()) {
      case "uptrend":
      case "trending":
        return <TrendingUp className="h-4 w-4" />;
      case "downtrend":
        return <TrendingDown className="h-4 w-4" />;
      case "ranging":
        return <Waves className="h-4 w-4" />;
      default:
        return <HelpCircle className="h-4 w-4" />; // Use HelpCircle for Unknown
    }
  };

  const getBarColor = (winRate) => {
    if (winRate >= 60) return "#10b981"; // Green for good performance
    if (winRate >= 50) return "#f59e0b"; // Yellow for average
    return "#ef4444"; // Red for poor performance
  };

  const getRegimeDisplayName = (regime) => {
    switch (regime?.toLowerCase()) {
      case "uptrend":
        return "Uptrend";
      case "downtrend":
        return "Downtrend";
      case "ranging":
        return "Ranging";
      case "trending":
        return "Trending";
      default:
        return regime || "Unknown";
    }
  };

  const dataWithDefault = regimeData.map(d => ({
    ...d,
    profitFactor: isFinite(d.profitFactor) && !isNaN(d.profitFactor) ? d.profitFactor : 0,
    winRate: d.winRate || 0
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium flex items-center gap-2">
            {getRegimeIcon(label)}
            {getRegimeDisplayName(label)}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.dataKey === 'winRate' && `Win Rate: ${entry.value.toFixed(1)}%`}
              {entry.dataKey === 'profitFactor' && `Profit Factor: ${(entry.value || 0).toFixed(2)}`}
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

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <BrainCircuit className="h-5 w-5" />
          Strategy Performance by Market Regime
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Chart */}
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dataWithDefault} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                
                <XAxis 
                  dataKey="regime" 
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  tickFormatter={getRegimeDisplayName}
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
                  {dataWithDefault.map((entry, index) => (
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {dataWithDefault.map((regimeStats) => (
              <div 
                key={regimeStats.regime} 
                className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getRegimeIcon(regimeStats.regime)}
                    <span className="font-medium text-sm">{getRegimeDisplayName(regimeStats.regime)}</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                    <span className={`font-medium ${
                      regimeStats.winRate >= 60 ? 'text-green-500' : 
                      regimeStats.winRate >= 50 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {regimeStats.winRate.toFixed(1)}%
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Profit Factor:</span>
                    <span className={`font-medium ${
                      regimeStats.profitFactor >= 1.5 ? 'text-green-500' : 
                      regimeStats.profitFactor >= 1.0 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {regimeStats.profitFactor.toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total Trades:</span>
                    <span className="font-medium">{regimeStats.totalTrades}</span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total P&L:</span>
                    <span className={`font-medium ${(regimeStats.totalPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${(regimeStats.totalPnl || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Insights */}
          {dataWithDefault.length > 0 && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Regime Performance Insights</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Win Rate: </span>
                  <span className="font-medium">
                    {(() => {
                      const best = dataWithDefault.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      );
                      return `${getRegimeDisplayName(best.regime)} (${best.winRate.toFixed(1)}%)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Best Profit Factor: </span>
                  <span className="font-medium">
                    {(() => {
                      const bestPF = dataWithDefault.reduce((prev, current) => 
                        (prev.profitFactor > current.profitFactor) ? prev : current
                      );
                      return `${getRegimeDisplayName(bestPF.regime)} (${bestPF.profitFactor.toFixed(2)})`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Active: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostActive = dataWithDefault.reduce((prev, current) => 
                        (prev.totalTrades > current.totalTrades) ? prev : current
                      );
                      return `${getRegimeDisplayName(mostActive.regime)} (${mostActive.totalTrades} trades)`;
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700 dark:text-blue-300">Most Profitable: </span>
                  <span className="font-medium">
                    {(() => {
                      const mostProfitable = dataWithDefault.reduce((prev, current) => 
                        ((prev.totalPnl || 0) > (current.totalPnl || 0)) ? prev : current
                      );
                      return `${getRegimeDisplayName(mostProfitable.regime)} ($${(mostProfitable.totalPnl || 0).toFixed(2)})`;
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
