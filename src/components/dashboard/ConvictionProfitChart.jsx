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
import { Target, BarChart3 } from "lucide-react";

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

    // Create conviction ranges (0-100 scale)
    const convictionRanges = [
      { min: 0, max: 20, label: '0-20' },
      { min: 20, max: 40, label: '20-40' },
      { min: 40, max: 60, label: '40-60' },
      { min: 60, max: 80, label: '60-80' },
      { min: 80, max: 100, label: '80-100' }
    ];

    const rangeStats = convictionRanges.map(range => {
      const rangedTrades = tradesWithConviction.filter(t => 
        t.conviction_score >= range.min && t.conviction_score < range.max
      );

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
          </div>
        )}
      </CardContent>
    </Card>
  );
}