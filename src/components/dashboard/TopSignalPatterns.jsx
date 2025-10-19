
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react'; // Changed Zap, ArrowUpRight, ArrowDownRight to Target

export default function TopSignalPatterns({ patterns = [] }) {
  if (!patterns || patterns.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Target className="h-5 w-5" />
            Top Signal Patterns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <Target className="mx-auto h-8 w-8 mb-2" />
            <p>Top performing signal combinations will appear here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Format profit factor for display
  const formatProfitFactor = (pf) => {
    if (pf >= 10) return "10.0+"; // Cap display at 10.0+
    return pf.toFixed(2);
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Target className="h-5 w-5" />
          Top Signal Patterns
          <Badge variant="outline" className="ml-2">
            Sorted by Profit Factor
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {patterns.map((pattern, index) => (
            <div
              key={pattern.name} // FIX: Changed key to pattern.name
              className="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">
                    #{index + 1}
                  </Badge>
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    {pattern.name} 
                  </h3>
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {/* Assuming pattern.signals is now an array of strings */}
                  {pattern.signals.map((signal, sigIndex) => (
                    <Badge key={sigIndex} variant="secondary" className="text-xs">
                      {signal}
                    </Badge>
                  ))}
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                  <span>{pattern.trade_count} trades</span>
                  <span className={pattern.winRate >= 50 ? "text-green-500" : "text-red-500"}>
                    {(pattern.winRate || 0).toFixed(1)}% win rate
                  </span>
                  <span className={pattern.total_pnl >= 0 ? "text-green-500" : "text-red-500"}>
                    ${(pattern.total_pnl || 0).toFixed(2)} total P&L
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatProfitFactor(pattern.profitFactor)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Profit Factor
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
