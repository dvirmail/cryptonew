
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, TrendingUp, BarChart, Clock, Target, AlertTriangle, ChevronDown, ChevronUp, Timer, BarChart3, Scale } from "lucide-react";
import OccurrenceChart from './OccurrenceChart';
import WinStrategy from './WinStrategy';
import { Circle, CheckCircle, XCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import ProfitFactorCell from '../stats/ProfitFactorCell';


// Helper function to format the duration from milliseconds to a readable string
const formatDurationFromMs = (ms) => {
    if (!ms || typeof ms !== 'number' || ms <= 0) return "N/A";
    const minutes = ms / 60000;
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
};

const getTimeframeMinutes = (tf) => {
    if (!tf) return 60; // Default to 1 hour
    const value = parseInt(String(tf).replace(/\D/g, ''), 10) || 1;
    if (String(tf).includes('m')) return value;
    if (String(tf).includes('h')) return value * 60;
    if (String(tf).includes('d')) return value * 60 * 24;
    return 60; // Default fallback for unexpected formats
};

const formatSignalValue = (signal) => {
  if (!signal || !signal.value) return 'N/A';
  
  // Handle volume signals - ensure consistent lowercase formatting
  if (signal.type === 'volume') {
    switch (signal.value.toLowerCase()) {
      case 'spike': return 'Spike';
      case 'above average': return 'Above Average';
      case 'below average': return 'Below Average'; 
      case 'dry up': return 'Dry Up';
      default: return signal.value;
    }
  }
  
  // Handle candlestick signals
  if (signal.type.startsWith('cdl_')) {
    switch (signal.value.toLowerCase()) {
      case 'spike': return 'Spike';
      default: return signal.value;
    }
  }
  
  // For other signal types, return the value as is.
  return signal.value;
};

const SignalPill = ({ signal }) => {
  const baseClasses = "text-xs font-medium mr-2 mb-2 px-2.5 py-1 rounded-full inline-flex items-center";
  let colorClasses = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

  if (signal.type.includes('RSI')) colorClasses = "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
  if (signal.type.includes('MACD')) colorClasses = "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
  if (signal.type.includes('volume')) colorClasses = "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";

  return (
    <span className={`${baseClasses} ${colorClasses}`}>
      {signal.isEvent ? (
        <Zap className="w-3 h-3 mr-1.5 text-yellow-600" title="Event-based Signal" />
      ) : (
        <BarChart3 className="w-3 h-3 mr-1.5 text-blue-600" title="State-based Signal" />
      )}
      {signal.strength === 'weak' && <span className="w-2 h-2 mr-1.5 bg-yellow-400 rounded-full" title="Weak Signal (Tolerance-based)"></span>}
      {signal.strength === 'strong' && <span className="w-2 h-2 mr-1.5 bg-green-500 rounded-full" title="Strong Signal (Direct Hit)"></span>}
      {signal.type}{signal.value ? `:${formatSignalValue(signal)}` : ''}
    </span>
  );
};


const MatchDetails = ({ combination, timeframe, timeExitStrategy }) => {
    const [showChart, setShowChart] = useState(false);

    let timeToPeakMs = 0;
    let calculationSource = 'average';
    let percentileUsed = '80th';
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

    let targetPercentileValue = 0;
    
    if (timeExitStrategy === 'early') {
        targetPercentileValue = combination.timeToPeak50thPercentile || combination.exitTimeStatistics?.percentile50;
        percentileUsed = '50th';
    } else if (timeExitStrategy === 'conservative') {
        targetPercentileValue = combination.timeToPeak75thPercentile || combination.exitTimeStatistics?.percentile75;
        percentileUsed = '75th';
    } else if (timeExitStrategy === 'balanced') {
        targetPercentileValue = combination.timeToPeak85thPercentile || combination.exitTimeStatistics?.percentile85;
        percentileUsed = '85th';
    } else if (timeExitStrategy === 'aggressive') {
        targetPercentileValue = combination.timeToPeak95thPercentile || combination.exitTimeStatistics?.percentile95;
        percentileUsed = '95th';
    } else {
        targetPercentileValue = combination.timeToPeak80thPercentile;
        percentileUsed = '80th';
    }

    if (combination.avgWinDurationMinutes && combination.avgWinDurationMinutes > 0) {
        timeToPeakMs = combination.avgWinDurationMinutes * 60 * 1000;
        calculationSource = 'average win duration';
    } else {
        const rawAvg = combination.avgTimeToPeak;

        if (typeof targetPercentileValue === 'number' && targetPercentileValue > 0) {
            if (targetPercentileValue < (24 * 60 * 60 * 1000)) {
                if (targetPercentileValue < 10000) {
                    timeToPeakMs = targetPercentileValue * 60 * 1000;
                } else {
                    timeToPeakMs = targetPercentileValue;
                }
            } else {
                 timeToPeakMs = targetPercentileValue;
            }
            
            if (timeToPeakMs > 0 && timeToPeakMs < thirtyDaysInMs) {
                calculationSource = `${percentileUsed} percentile`;
            } else {
                if (typeof rawAvg === 'number' && rawAvg > 0 && rawAvg < thirtyDaysInMs) {
                    timeToPeakMs = rawAvg;
                    calculationSource = 'average';
                } else {
                    timeToPeakMs = 0;
                    calculationSource = 'N/A';
                }
            }
        } else if (typeof rawAvg === 'number' && rawAvg > 0 && rawAvg < thirtyDaysInMs) {
            timeToPeakMs = rawAvg;
            calculationSource = 'average';
        } else {
            timeToPeakMs = 0;
            calculationSource = 'N/A';
        }
    }
    
    const timeframeMinutes = getTimeframeMinutes(timeframe);
    const candlesToPeak = (timeframeMinutes > 0 && timeToPeakMs > 0) ? Math.round(timeToPeakMs / (timeframeMinutes * 60000)) : 0;

    return (
        <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                           <TrendingUp className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Avg. Price Move</span>
                        </div>
                    </div>
                    <div className={`text-sm font-bold text-green-600 dark:text-green-400`}>
                        {combination.averageGainOnSuccess?.toFixed(2) || '0.00'}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Avg. gain when successful.
                    </p>
                </div>
                 <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-indigo-500" />
                            <span className="text-sm font-medium">Success Rate</span>
                        </div>
                    </div>
                    <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                        {combination.successRate?.toFixed(2) || '0.00'}%
                    </div>
                     <p className="text-xs text-muted-foreground mt-1">
                        ({combination.successCount || 0} wins / {combination.failCount || 0} losses)
                    </p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <Scale className="h-4 w-4 text-purple-500" />
                            <span className="text-sm font-medium">Profit Factor</span>
                        </div>
                    </div>
                    <div className="text-sm font-bold text-purple-600 dark:text-purple-400">
                        {combination.profitFactor === 999.99 ? '999+' : combination.profitFactor?.toFixed(2) || '1.00'}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {combination.profitFactor === 999.99 ? 'Perfect strategy' : 'Profit ÷ Loss ratio'}
                    </p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <Timer className="h-4 w-4 text-blue-500" />
                            <span className="text-sm font-medium">Est. Exit Window</span>
                        </div>
                    </div>
                    <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {formatDurationFromMs(timeToPeakMs)} ({candlesToPeak}c)
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Based on {calculationSource} time.
                    </p>
                </div>
            </div>

            {/* Win Strategy component - REMOVED from here as it's now in SignalMatchList */}

            {/* Occurrence Chart */}
            <div className="mt-4">
                <Button variant="outline" size="sm" onClick={() => setShowChart(!showChart)} className="w-full">
                    {showChart ? <ChevronUp className="h-4 w-4 mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
                    {showChart ? 'Hide' : 'Show'} Daily Occurrences
                </Button>
                {showChart && (
                    <div className="mt-2">
                        <OccurrenceChart matches={combination.matches} />
                    </div>
                )}
            </div>
        </div>
    );
};

// SignalMatchListItem component is now deprecated/removed and its logic integrated into SignalMatchList

const SignalMatchList = ({ matches, minOccurrences, sortBy, signalSettings, historicalPeriod, timeframe, timeExitStrategy, targetGain, minProfitFactor }) => {
    const [expanded, setExpanded] = useState(new Set());
    const [strategyTabs, setStrategyTabs] = useState(new Map()); // NEW: Track strategy tab state per combination

    const toggleExpansion = (id) => {
        setExpanded(prevExpanded => {
            const newExpanded = new Set(prevExpanded);
            if (newExpanded.has(id)) {
                newExpanded.delete(id);
            } else {
                newExpanded.add(id);
            }
            return newExpanded;
        });
    };

    // NEW: Function to handle strategy tab changes
    const handleStrategyTabChange = (combinationId, tabType) => {
        setStrategyTabs(prev => new Map(prev.set(combinationId, tabType)));
    };

    if (!matches || matches.length === 0) {
        return (
            <div className="text-center py-10">
                <Zap className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No matching signal combinations</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Try adjusting your filters or running a new backtest.
                </p>
            </div>
        );
    }

    const filteredMatches = matches.filter(match => {
        const targetGainMatch = targetGain === null || targetGain === undefined || targetGain <= 0 || (match.averageGainOnSuccess || 0) >= targetGain;
        const profitFactorMatch = minProfitFactor === null || minProfitFactor === undefined || minProfitFactor <= 0 || (match.profitFactor || 0) >= minProfitFactor;
        return targetGainMatch && profitFactorMatch;
    });

    if (filteredMatches.length === 0) {
        return (
            <div className="text-center py-10">
                 <Zap className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No combinations meet the current filters</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                   Try lowering the "Minimum Price Move (%)" or "Minimum Profit Factor" filters to see more results.
                </p>
            </div>
        );
    }
    
    return (
        <div className="space-y-4">
            {filteredMatches.map((combination, index) => {
                const id = combination.id || index; // Use a unique ID or index
                const isExpanded = expanded.has(id);
                const currentStrategyTab = strategyTabs.get(id) || 'atr'; // FIX: Default to 'atr'
                const {
                    signals,
                    occurrences,
                    successRate,
                    netAveragePriceMove, 
                    coin,
                    hasSignificantDrops,
                    hasSevereDrops,
                    dropRate
                } = combination;

                return (
                    <Collapsible
                        key={id}
                        open={isExpanded}
                        onOpenChange={() => toggleExpansion(id)}
                        className="overflow-hidden bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200"
                    >
                        <CollapsibleTrigger asChild>
                            <button className="w-full text-left">
                                <CardHeader className="p-4 flex flex-row items-center justify-between">
                                    <div className="flex-1">
                                        <CardTitle className="text-base font-semibold mb-1.5 flex items-center gap-2">
                                            <Badge variant="outline">{coin}</Badge>
                                            <div className="flex flex-wrap items-start mt-2">
                                                {signals.map((signal, sigIndex) => (
                                                <SignalPill key={sigIndex} signal={signal} />
                                                ))}
                                            </div>
                                        </CardTitle>
                                        <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1.5">
                                                <BarChart className="h-3.5 w-3.5" />
                                                <span>{occurrences} Occurrences</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5" />
                                                <span>{timeframe} timeframe</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {hasSevereDrops && (
                                            <Badge variant="destructive" className="hidden sm:inline-flex items-center gap-1">
                                                <AlertTriangle className="h-3 w-3" /> High Risk
                                            </Badge>
                                        )}
                                        <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>
                                </CardHeader>
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                            <MatchDetails 
                                combination={combination} 
                                timeframe={timeframe} 
                                timeExitStrategy={timeExitStrategy}
                            />
                            <WinStrategy 
                                combination={combination} 
                                initialStrategy={{}}
                                onStrategyChange={(updatedFields) => {
                                    // This can be connected later if we need to lift state up
                                }}
                                currentCoin={combination.coin}
                                timeframe={combination.timeframe || timeframe}
                                defaultTab={currentStrategyTab} // NEW: Pass the preserved tab state
                                onTabChange={(tabType) => handleStrategyTabChange(id, tabType)} // NEW: Handle tab changes
                            />
                        </CollapsibleContent>
                    </Collapsible>
                );
            })}
        </div>
    );
};

export default SignalMatchList;
