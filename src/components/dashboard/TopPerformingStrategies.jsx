
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Clock, TrendingUp, BarChart2 } from 'lucide-react';

const StrategyCard = ({ strategy, index }) => {
  const {
    name,
    winRate = 0,
    profitFactor = 0,
    trade_count = 0,
    bestTimeSlot = 'N/A'
  } = strategy;

  const profitFactorColor = profitFactor >= 1.5 ? 'text-green-500' : profitFactor >= 1 ? 'text-yellow-500' : 'text-red-500';
  const winRateColor = winRate >= 50 ? 'text-green-500' : 'text-red-500';

  const getTimeLabel = (timeSlot) => {
    switch (timeSlot) {
      case "00-06": return "Night (00-06)";
      case "06-12": return "Morning (06-12)";
      case "12-18": return "Afternoon (12-18)";
      case "18-24": return "Evening (18-24)";
      default: return "N/A";
    }
  };

  return (
    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border dark:border-gray-600 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 dark:text-white truncate" title={name}>
          <Badge variant="secondary" className="mr-2">#{index + 1}</Badge>
          {name}
        </h3>
        <Badge variant="outline">{trade_count} Trades</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <TrendingUp className={`h-4 w-4 ${winRateColor}`} />
          <div>
            <div className="text-gray-500 dark:text-gray-400">Win Rate</div>
            <div className={`font-semibold ${winRateColor}`}>{winRate.toFixed(1)}%</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BarChart2 className={`h-4 w-4 ${profitFactorColor}`} />
          <div>
            <div className="text-gray-500 dark:text-gray-400">Profit Factor</div>
            <div className={`font-semibold ${profitFactorColor}`}>{profitFactor.toFixed(2)}</div>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2 text-sm pt-2 border-t border-gray-200 dark:border-gray-600">
        <Clock className="h-4 w-4 text-blue-500" />
        <div>
          <div className="text-gray-500 dark:text-gray-400">Optimal Trade Time</div>
          <div className="font-semibold text-blue-600 dark:text-blue-400">{getTimeLabel(bestTimeSlot)}</div>
        </div>
      </div>
    </div>
  );
};

export default function TopPerformingStrategies({ strategies = [] }) {
  if (!strategies || strategies.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            Top 20 Performing Strategies
          </CardTitle>
          <CardDescription>
            Analysis of your most successful strategies and their optimal trading times.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <Award className="mx-auto h-8 w-8 mb-2" />
            <h3 className="text-lg font-medium mb-2">No Trading Data Yet</h3>
            <p className="text-sm">Start running the auto-scanner to generate trades and build strategy performance data. Once you have completed trades, your top performing strategies will be analyzed and displayed here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show top 20 strategies
  const topStrategies = strategies.slice(0, 20);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          Top 20 Performing Strategies
        </CardTitle>
        <CardDescription>
          Analysis of your most successful strategies and their optimal trading times.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="h-full overflow-y-auto pr-2">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {topStrategies.map((strategy, index) => (
              <StrategyCard key={strategy.name} strategy={strategy} index={index} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
