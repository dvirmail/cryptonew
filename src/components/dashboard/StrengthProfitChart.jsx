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
import { Zap, BarChart3 } from "lucide-react";

export default function StrengthProfitChart({ trades = [], backtestCombinations = [] }) {
  const { strengthData, analyzedTradesCount } = useMemo(() => {
    if (!trades || trades.length === 0) return { strengthData: [], analyzedTradesCount: 0 };

    // Create a lookup map by COIN (trading pair) instead of strategy name
    const combinationByCoin = new Map();
    
    if (Array.isArray(backtestCombinations)) {
        backtestCombinations.forEach(combo => {
            if (combo.coin && combo.combinedStrength !== null && combo.combinedStrength !== undefined) {
                // Normalize coin format: remove slashes and convert to uppercase
                const normalizedCoin = combo.coin.replace(/\//g, '').toUpperCase();
                
                // Store all combinations for this coin
                if (!combinationByCoin.has(normalizedCoin)) {
                    combinationByCoin.set(normalizedCoin, []);
                }
                combinationByCoin.get(normalizedCoin).push({
                    strength: combo.combinedStrength,
                    name: combo.combinationName
                });
            }
        });
    }

    // Filter trades that have combined_strength data (or can infer it)
    const tradesWithStrength = trades.filter(t => {
      let strength = t.combined_strength;
      
      // Try to infer from BacktestCombination if missing
      if ((strength === null || strength === undefined || isNaN(strength)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        
        if (matchingCombos && matchingCombos.length > 0) {
          // Use average strength for this coin
          const avgStrength = matchingCombos.reduce((sum, c) => sum + c.strength, 0) / matchingCombos.length;
          strength = avgStrength;
        }
      }
      
      return strength !== null && strength !== undefined && !isNaN(strength);
    }).map(t => {
      let strength = t.combined_strength;
      
      // Infer from BacktestCombination if missing
      if ((strength === null || strength === undefined || isNaN(strength)) && t.symbol) {
        const normalizedSymbol = t.symbol.replace(/\//g, '').toUpperCase();
        const matchingCombos = combinationByCoin.get(normalizedSymbol);
        
        if (matchingCombos && matchingCombos.length > 0) {
          const avgStrength = matchingCombos.reduce((sum, c) => sum + c.strength, 0) / matchingCombos.length;
          strength = avgStrength;
        }
      }
      
      return { ...t, combined_strength: strength };
    });

    if (tradesWithStrength.length === 0) return { strengthData: [], analyzedTradesCount: 0 };

    // Create strength ranges in intervals of 20
    const strengthRanges = Array.from({ length: 25 }, (_, i) => ({
      min: i * 20,
      max: (i + 1) * 20,
      label: `${i * 20}-${(i + 1) * 20}`
    }));
    strengthRanges.push({ min: 500, max: Infinity, label: '500+' });

    const rangeStats = strengthRanges.map(range => {
      const rangedTrades = tradesWithStrength.filter(t => 
        t.combined_strength >= range.min && t.combined_strength < range.max
      );

      if (rangedTrades.length === 0) return null; // Return null for ranges with no trades

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
    }).filter(Boolean); // Use filter(Boolean) to remove null entries

    return { strengthData: rangeStats, analyzedTradesCount: tradesWithStrength.length };
  }, [trades, backtestCombinations]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">Combined Strength: {label}</p>
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
          <Zap className="h-5 w-5" />
          Performance by Combined Strength Score
        </CardTitle>
        <CardDescription>
          Analyzed {analyzedTradesCount.toLocaleString()} of {totalTradesAvailable.toLocaleString()} trades. Only trades with a combined strength score are included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {strengthData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <BarChart3 className="mx-auto h-8 w-8 mb-2" />
            <p>No trades with combined strength data found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={strengthData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                  
                  <XAxis 
                    dataKey="range" 
                    tick={{ fill: 'currentColor', fontSize: 10 }}
                    stroke="currentColor"
                    className="text-gray-500 dark:text-gray-400"
                    interval={1}
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
                    fill="#3b82f6" 
                    name="Profit Factor"
                  />

                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="winRate"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ fill: '#10b981', strokeWidth: 2, r: 6 }}
                    name="Win Rate (%)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Stats */}
            {strengthData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Best Performing Range (P/F)</div>
                  <div className="text-lg font-semibold text-green-500">
                    {(() => {
                      const best = strengthData.reduce((prev, current) => 
                        (prev.profitFactor > current.profitFactor) ? prev : current
                      );
                      return best.range;
                    })()}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Highest Win Rate</div>
                  <div className="text-lg font-semibold text-blue-500">
                    {(() => {
                      const bestWR = strengthData.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      );
                      return `${bestWR.range} (${bestWR.winRate.toFixed(1)}%)`;
                    })()}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Total Trades with Strength</div>
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