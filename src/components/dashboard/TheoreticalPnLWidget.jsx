
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Calculator, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function TheoreticalPnLWidget({ trades = [] }) {
  if (!trades || trades.length === 0) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Theoretical P&L (No Trailing Stops)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 text-muted-foreground">
            <Calculator className="mx-auto h-8 w-8 mb-2" />
            <p>Theoretical P&L analysis will appear once you have trade data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate actual P&L from all trades
  const actualTotalPnL = trades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);

  // Calculate theoretical P&L without trailing stops
  let theoreticalTotalPnL = 0;
  let trailingStopTrades = 0;
  let theoreticalTradesAnalyzed = 0;

  trades.forEach(trade => {
    // ENHANCED: Better detection of trades that used trailing stops
    const usedTrailingStops = 
      trade.was_trailing || // Primary flag
      trade.exit_reason === 'trailing_stop_hit' || // Exit reason indicates trailing
      trade.exit_reason === 'trailing_timeout' || // NEW: Also check for trailing timeout
      (trade.enabled_trailing_take_profit && trade.final_trailing_stop_price) || // Has trailing data
      (trade.enableTrailingTakeProfit && trade.peak_price && trade.peak_price !== trade.entry_price) || // Peak tracking suggests trailing was active
      (trade.status === 'trailing') || // Position status was trailing when closed
      (trade.trailing_stop_price && trade.trailing_stop_price > 0); // Has a trailing stop price set

    if (usedTrailingStops && trade.take_profit_price && trade.entry_price && trade.quantity_crypto) {
      trailingStopTrades++;
      theoreticalTradesAnalyzed++;

      // Calculate what the P&L would have been at the original take profit price
      const theoreticalExitValue = trade.quantity_crypto * trade.take_profit_price;
      const theoreticalPnL = trade.direction === 'long'
        ? (theoreticalExitValue - trade.entry_value_usdt)
        : (trade.entry_value_usdt - theoreticalExitValue);
      
      theoreticalTotalPnL += theoreticalPnL;
    } else {
      // For non-trailing trades, use the actual P&L
      theoreticalTotalPnL += (trade.pnl_usdt || 0);
    }
  });

  // Calculate the difference
  const trailingStopImpact = actualTotalPnL - theoreticalTotalPnL;
  const impactPercentage = theoreticalTotalPnL !== 0 ? ((trailingStopImpact / Math.abs(theoreticalTotalPnL)) * 100) : 0;

  // Determine if trailing stops are helping or hurting
  const isTrailingBeneficial = trailingStopImpact > 0;
  const impactColor = isTrailingBeneficial ? 'text-green-500' : 'text-red-500';
  const impactIcon = isTrailingBeneficial ? TrendingUp : TrendingDown;
  const ImpactIcon = impactIcon;

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Theoretical P&L Analysis (No Trailing Stops)
          <Badge variant="outline" className="ml-2">
            {trailingStopTrades} Trailing Trades
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span>Actual P&L (With Trailing)</span>
            </div>
            <div className={`text-2xl font-bold ${actualTotalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(actualTotalPnL)}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <Calculator className="h-4 w-4" />
              <span>Theoretical P&L (No Trailing)</span>
            </div>
            <div className={`text-2xl font-bold ${theoreticalTotalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(theoreticalTotalPnL)}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <ImpactIcon className="h-4 w-4" />
              <span>Trailing Stop Impact</span>
            </div>
            <div className={`text-2xl font-bold ${impactColor}`}>
              {trailingStopImpact >= 0 ? '+' : ''}{formatCurrency(trailingStopImpact)}
            </div>
            <div className={`text-sm font-medium ${impactColor}`}>
              {impactPercentage >= 0 ? '+' : ''}{impactPercentage.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Analysis Summary */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                Trailing Stop Strategy Analysis
              </h4>
              <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                <p>
                  <strong>Strategy Impact:</strong> Trailing stops have {isTrailingBeneficial ? 'increased' : 'decreased'} your total P&L by{' '}
                  <span className={`font-medium ${impactColor}`}>
                    {formatCurrency(Math.abs(trailingStopImpact))}
                  </span> compared to closing at initial take profit levels.
                </p>
                <p>
                  <strong>Trades Analyzed:</strong> {theoreticalTradesAnalyzed} out of {trades.length} total trades used trailing stops.
                </p>
                <p>
                  <strong>Recommendation:</strong> {
                    isTrailingBeneficial 
                      ? 'Your trailing stop strategy is working well, allowing profitable trades to run longer.'
                      : 'Consider reviewing your trailing stop settings. Taking profits at initial levels might be more effective.'
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Total Trades</div>
            <div className="font-bold text-lg">{trades.length}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Trailing Stop Trades</div>
            <div className="font-bold text-lg">{trailingStopTrades}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Trailing Usage Rate</div>
            <div className="font-bold text-lg">{trades.length > 0 ? ((trailingStopTrades / trades.length) * 100).toFixed(1) : 0}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Avg Impact per Trail</div>
            <div className={`font-bold text-lg ${impactColor}`}>
              {trailingStopTrades > 0 ? formatCurrency(trailingStopImpact / trailingStopTrades) : '$0.00'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
