
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, Shuffle, Percent, CheckCircle2, XCircle, DollarSign, Scale, BrainCircuit } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const StatCard = ({ title, value, icon, tooltipText, colorClass, children }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg shadow-inner">
          <div className="flex items-center gap-2 mb-1">
            {React.cloneElement(icon, { className: `h-4 w-4 ${colorClass || 'text-gray-500 dark:text-gray-400'}` })}
            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</h4>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          {children}
        </div>
      </TooltipTrigger>
      {tooltipText && (
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      )}
    </Tooltip>
  </TooltipProvider>
);

const RegimePerformanceCard = ({ regime, data }) => {
    if (!data || data.occurrences === 0) return null;

    const successRateColor = data.successRate >= 50 ? 'text-green-500' : 'text-red-500';
    const profitFactorColor = data.profitFactor >= 1.5 ? 'text-green-500' : (data.profitFactor >= 1.0 ? 'text-yellow-500' : 'text-red-500');

    return (
        <Card className="flex-1 min-w-[280px]">
            <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                    <BrainCircuit className="h-5 w-5 text-primary" />
                    {regime.charAt(0).toUpperCase() + regime.slice(1)} Regime Performance
                </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
                <div className="flex flex-col items-center p-2 rounded-md bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-muted-foreground">Occurrences</span>
                    <span className="text-lg font-bold">{data.occurrences.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-md bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-muted-foreground">Success Rate</span>
                    <span className={`text-lg font-bold ${successRateColor}`}>{data.successRate.toFixed(1)}%</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-md bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-muted-foreground">Avg. Price Move</span>
                    <span className="text-lg font-bold">{data.avgPriceMove.toFixed(2)}%</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-md bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-muted-foreground">Profit Factor</span>
                    <span className={`text-lg font-bold ${profitFactorColor}`}>{isFinite(data.profitFactor) ? data.profitFactor.toFixed(2) : 'Infinity'}</span>
                </div>
            </CardContent>
        </Card>
    );
};

const BacktestSummary = ({ results, signalCombinations }) => {
  // --- DIAGNOSTIC LOG ---
  if (signalCombinations && signalCombinations.length > 0) {
      console.log("[BacktestSummary DIAGNOSTIC] Received signalCombinations. First combination:", signalCombinations[0]);
      if(signalCombinations[0].marketRegimePerformance) {
          console.log("[BacktestSummary DIAGNOSTIC] First combination has marketRegimePerformance:", signalCombinations[0].marketRegimePerformance);
      } else {
          console.error("[BacktestSummary DIAGNOSTIC] First combination is MISSING marketRegimePerformance property!");
      }
  }

  if (!results) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <BarChart3 className="mx-auto h-12 w-12 mb-4" />
        <h3 className="text-lg font-medium">No Summary to Display</h3>
        <p>Run a backtest to see the performance summary.</p>
      </div>
    );
  }

  const {
    totalMatches, successfulMatches, successRate, totalCombinationsTested, coinsTested,
    coinsSuccessfullyProcessed,
  } = results;

  const totalOccurrences = signalCombinations.reduce((sum, combo) => sum + (combo.occurrences || 0), 0);
  const avgProfitFactor = signalCombinations.length > 0
    ? signalCombinations.reduce((sum, combo) => sum + (isFinite(combo.profitFactor) ? combo.profitFactor : 10), 0) / signalCombinations.length // cap infinity
    : 0;
  const avgNetMove = signalCombinations.length > 0
    ? signalCombinations.reduce((sum, combo) => sum + (combo.netAveragePriceMove || 0), 0) / signalCombinations.length
    : 0;

  // FIX: Correct aggregation logic
  const finalRegimeStats = signalCombinations.reduce((acc, combo) => {
    if (combo.marketRegimePerformance) {
      for (const regime in combo.marketRegimePerformance) {
        if (!acc[regime]) {
          acc[regime] = { occurrences: 0, successful: 0, grossProfit: 0, grossLoss: 0 };
        }
        const data = combo.marketRegimePerformance[regime];
        acc[regime].occurrences += data.occurrences || 0;
        acc[regime].successful += data.successful || 0;
        acc[regime].grossProfit += data.grossProfit || 0;
        acc[regime].grossLoss += data.grossLoss || 0;
      }
    }
    return acc;
  }, {});

  // Calculate final averages from aggregated sums
  for (const regime in finalRegimeStats) {
      const stats = finalRegimeStats[regime];
      stats.successRate = stats.occurrences > 0 ? (stats.successful / stats.occurrences) * 100 : 0;
      stats.avgPriceMove = stats.occurrences > 0 ? ((stats.grossProfit - stats.grossLoss) / stats.occurrences) : 0;
      
      // FIXED: Apply the same improved profit factor calculation
      if (stats.grossLoss === 0) {
        if (stats.grossProfit > 0 && stats.occurrences === stats.successful) {
          stats.profitFactor = 999.99; // Perfect strategy with no losses
        } else if (stats.grossProfit > 0) {
          stats.profitFactor = 100.0; // High but finite
        } else {
          stats.profitFactor = 1.0;
        }
      } else {
        stats.profitFactor = Math.min(stats.grossProfit / stats.grossLoss, 999.99);
      }
      
      //console.log(`[REGIME_CALC_DEBUG] ${regime.toUpperCase()} Regime:`);
      //console.log(`  Occurrences: ${stats.occurrences}`);
      //console.log(`  Successful: ${stats.successful}`);
      //console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`);
      //console.log(`  Gross Profit: ${stats.grossProfit.toFixed(4)}`);
      //console.log(`  Gross Loss: ${stats.grossLoss.toFixed(4)}`);
      //console.log(`  Profit Factor: ${stats.profitFactor === 999.99 ? '999.99 (Perfect)' : stats.profitFactor.toFixed(2)}`);
      //console.log(`  Avg Price Move: ${stats.avgPriceMove.toFixed(4)}%`);
      //console.log('---');
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Overall Performance</CardTitle>
          <CardDescription>
            Summary of the backtest across {coinsSuccessfullyProcessed} coin(s): {coinsTested}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            title="Coins Tested"
            value={coinsSuccessfullyProcessed}
            icon={<TrendingUp />}
            tooltipText="Number of coins successfully processed in the backtest."
          />
          <StatCard
            title="Strategies Found"
            value={signalCombinations.length.toLocaleString()}
            icon={<Shuffle />}
            tooltipText="Number of unique signal combinations that met all filter criteria."
          />
          <StatCard
            title="Total Occurrences"
            value={totalOccurrences.toLocaleString()}
            icon={<BarChart3 />}
            tooltipText="Total number of times the found strategies appeared in the historical data."
          />
          <StatCard
            title="Avg. Success Rate"
            value={`${(totalOccurrences > 0 ? (signalCombinations.reduce((sum, c) => sum + (c.successRate || 0) * (c.occurrences || 0), 0) / totalOccurrences) : 0).toFixed(1)}%`}
            icon={<Percent />}
            tooltipText="The weighted average success rate of all strategy occurrences."
            colorClass="text-green-500"
          />
          <StatCard
            title="Avg. Net Move"
            value={`${avgNetMove.toFixed(2)}%`}
            icon={<DollarSign />}
            tooltipText="The average net price movement across all successful and failed strategy occurrences."
            colorClass="text-blue-500"
          />
        </CardContent>
      </Card>
      
      {Object.keys(finalRegimeStats).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Regime-Specific Performance</CardTitle>
            <CardDescription>
              How strategies performed under different market conditions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {finalRegimeStats.trending && <RegimePerformanceCard regime="trending" data={finalRegimeStats.trending} />}
            {finalRegimeStats.ranging && <RegimePerformanceCard regime="ranging" data={finalRegimeStats.ranging} />}
            {finalRegimeStats.unknown && <RegimePerformanceCard regime="unknown" data={finalRegimeStats.unknown} />}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Strategy Quality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Average Profit Factor</span>
              <Badge variant={avgProfitFactor >= 1.5 ? "default" : "secondary"} className={avgProfitFactor >= 1.5 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                {avgProfitFactor === 999.99 ? '999+ (Perfect)' : avgProfitFactor.toFixed(2)}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Combinations Tested</span>
              <Badge variant="outline">{totalCombinationsTested.toLocaleString()}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Successful Strategy Events</span>
              <Badge variant="outline" className="text-green-700">{successfulMatches.toLocaleString()}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Event Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total Strategy Events</span>
              <Badge variant="outline">{totalMatches.toLocaleString()}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Overall Success Rate</span>
               <Badge variant="outline" className={successRate > 50 ? "text-green-700" : "text-red-700"}>{successRate.toFixed(1)}%</Badge>
            </div>
             <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Failed Strategy Events</span>
              <Badge variant="outline" className="text-red-700">{(totalMatches - successfulMatches).toLocaleString()}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BacktestSummary;
