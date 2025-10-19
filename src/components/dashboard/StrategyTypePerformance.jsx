
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, Activity, BarChart3 } from 'lucide-react';
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
  Cell
} from "recharts";

const StatCard = ({ title, icon: Icon, stats }) => {
  const {
    trade_count = 0,
    winRate = 0,
    profitFactor = 0,
    totalPnl = 0,
  } = stats || {};

  const profitFactorColor = profitFactor >= 1.5 ? 'text-green-500' : profitFactor >= 1.0 ? 'text-yellow-500' : 'text-red-500';
  const winRateColor = winRate >= 50 ? 'text-green-500' : 'text-red-500';
  const pnlColor = totalPnl >= 0 ? 'text-green-500' : 'text-red-500';

  return (
    <div className="p-6 rounded-lg bg-gray-50 dark:bg-gray-700/50 border dark:border-gray-600 flex flex-col justify-between">
      <div className="flex items-center gap-3 mb-4">
        <Icon className="h-8 w-8 text-primary" />
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <div className="text-gray-500 dark:text-gray-400">Total Trades</div>
          <div className="font-bold text-lg">{trade_count}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400">Win Rate</div>
          <div className={`font-bold text-lg ${winRateColor}`}>{winRate.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400">Profit Factor</div>
          <div className={`font-bold text-lg ${profitFactorColor}`}>{profitFactor.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400">Total P&L</div>
          <div className={`font-bold text-lg ${pnlColor}`}>${totalPnl.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
};

export default function StrategyTypePerformance({ data = {}, title }) {
  if (!data || (!data.eventDriven && !data.stateBased)) {
    return null; // Don't render if data is incomplete or empty
  }

  const chartData = useMemo(() => {
    const result = [];
    if (data.eventDriven && data.eventDriven.trade_count > 0) {
      result.push({
        type: 'Event-Driven',
        ...data.eventDriven
      });
    }
    if (data.stateBased && data.stateBased.trade_count > 0) {
      result.push({
        type: 'State-Based',
        ...data.stateBased
      });
    }
    return result;
  }, [data]);
  
  const getBarColor = (winRate) => {
    if (winRate >= 60) return "#10b981"; // Green (emerald-500)
    if (winRate >= 50) return "#f59e0b"; // Yellow (amber-500)
    return "#ef4444"; // Red (red-500)
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const pnlData = payload.find(entry => entry.dataKey === 'totalPnl'); // Find totalPnl from payload
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">{label} Strategies</p>
          {payload.map((entry, index) => {
            // Filter out totalPnl if it exists in the primary payload array
            if (entry.dataKey === 'totalPnl' && pnlData) return null; 

            return (
              <p key={index} className="text-sm">
                <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: entry.color || entry.stroke }}></span>
                {entry.dataKey === 'winRate' && `Win Rate: ${entry.value.toFixed(1)}%`}
                {entry.dataKey === 'profitFactor' && `Profit Factor: ${entry.value.toFixed(2)}`}
              </p>
            );
          })}
          {pnlData && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
              Total P&L: ${pnlData.value?.toFixed(2)}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Trades: {payload[0]?.payload?.trade_count}
          </p>
        </div>
      );
    }
    return null;
  };

  const defaultTitle = "Performance by Strategy Type";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white">
          {title || defaultTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <div className="h-80 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis 
                  dataKey="type" 
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Win Rate (%)', angle: -90, position: 'insideLeft', fill: 'currentColor' }}
                  domain={[0, 100]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: 'currentColor' }}
                  stroke="currentColor"
                  className="text-gray-500 dark:text-gray-400"
                  label={{ value: 'Profit Factor', angle: 90, position: 'insideRight', fill: 'currentColor' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar 
                  yAxisId="left"
                  dataKey="winRate" 
                  name="Win Rate (%)"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-bar-${index}`} fill={getBarColor(entry.winRate)} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="profitFactor"
                  stroke="#8b5cf6" // purple-500
                  strokeWidth={3}
                  dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
                  name="Profit Factor"
                />
                <Line
                  yAxisId="right" // Can also use YAxis left or a third YAxis if scaling differs
                  type="monotone"
                  dataKey="totalPnl"
                  stroke="#22d3ee" // cyan-500
                  strokeWidth={2}
                  dot={false}
                  name="Total P&L"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-10 text-muted-foreground mb-6">
            <BarChart3 className="mx-auto h-8 w-8 mb-2 text-gray-400 dark:text-gray-500" />
            <p className="text-gray-500 dark:text-gray-400">No data available to compare strategy types.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.eventDriven && data.eventDriven.trade_count > 0 && (
            <StatCard title="Event-Driven Strategies" icon={Zap} stats={data.eventDriven} />
          )}
          {data.stateBased && data.stateBased.trade_count > 0 && (
            <StatCard title="State-Based Strategies" icon={Activity} stats={data.stateBased} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
