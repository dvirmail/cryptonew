
import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import BacktestingEngine from './BacktestingEngine';
import { BacktestCombination } from '@/api/entities';
import { OptedOutCombination } from '@/api/entities';
import TechnicalSignalPanel from './TechnicalSignalPanel';
import { getKlineData } from '@/api/functions';
import { Loader2 } from 'lucide-react';
import { cn } from '@/components/utils/utils';
import { get, cloneDeep } from 'lodash'; // Added lodash imports

// Helper function to sanitize signals: lowercase types and remove duplicates, prioritizing object signals with parameters.
const sanitizeSignals = (signals) => {
    if (!signals || !Array.isArray(signals)) return [];

    const signalMap = new Map(); // Map from lowercased type to the signal object

    signals.forEach(signal => {
        let signalType;
        let signalObj;

        if (typeof signal === 'string') {
            signalType = signal.toLowerCase();
            signalObj = { type: signalType }; // Default signal object for string type
        } else if (typeof signal === 'object' && signal.type) {
            signalType = signal.type.toLowerCase();
            // Preserve parameters for object signals
            signalObj = { ...signal, type: signalType };
        } else {
            return; // Skip invalid signal entries
        }

        // Only add if not already present. This keeps the *first* encountered signal of a given type.
        // This ensures parameters are preserved and no duplicates by type (case-insensitive) are added.
        if (!signalMap.has(signalType)) {
            signalMap.set(signalType, signalObj);
        }
    });

    return Array.from(signalMap.values());
};

// Define the signature function here to ensure consistency
const getCombinationSignature = (params) => {
    if (!params || !params.signals) {
        console.warn("Attempted to get signature from invalid params:", params);
        return `invalid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    // A robust signature based on signal types and their parameters
    return params.signals
        .map(s => {
            // Ensure parameters are sorted for consistent signature
            const paramsString = s.parameters
                ? Object.keys(s.parameters)
                    .sort((a, b) => a.localeCompare(b))
                    .map(k => `${k}:${s.parameters[k]}`)
                    .join(',')
                : '';
            // Ensure signal type is lowercased for consistency, although sanitizeSignals should handle this
            return `${s.type.toLowerCase()}(${paramsString})`;
        })
        .sort((a, b) => a.localeCompare(b))
        .join('|');
};

const BacktestManager = ({
  signalSettings,
  onBacktestComplete,
  defaultSignalSettings,
  backtestConfig,
  debugMode,
  collectDebugData,
  regimeTrackingEnabled,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // New state for saving status
  const [progress, setProgress] = useState(0);
  const [currentTask, setCurrentTask] = useState('');
  const [logMessages, setLogMessages] = useState([]);
  const { toast } = useToast();

  const log = useCallback((message, level = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogMessages(prev => [...prev.slice(-100), { timestamp, level, message }]);
    if (debugMode) {
      console.log(`[BacktestManager] ${level.toUpperCase()}: ${message}`);
    }
  }, [debugMode]);

  // Placeholder for evaluateSignalCondition - kept from original
  const evaluateSignalCondition = () => {
    // This should ideally be passed in from a central logic file or a more robust module
    return { signal: false };
  };

  const handleSave = useCallback(async (resultsToSave) => {
    setIsSaving(true);
    try {
      // Step 1: Fetch the blocklist of all opted-out strategy signatures
      const optedOutList = await OptedOutCombination.list();
      const optedOutSignatures = new Set(optedOutList.map(item => item.combination_signature));
      
      // Step 2: Filter the new results to exclude any opted-out strategies before saving
      const filteredResults = resultsToSave.filter(result => {
        const resultSignature = getCombinationSignature(result);
        if (optedOutSignatures.has(resultSignature)) {
            log(`Ignoring combination "${result.combinationName}" with signature "${resultSignature}" because it is on the opt-out list.`, 'warning');
            return false;
        }
        return true;
      });

      const numOptedOut = resultsToSave.length - filteredResults.length;

      if (filteredResults.length > 0) {
        // Map to the correct database schema
        const combinationsToCreate = filteredResults.map(
          ({
            coin,
            timeframe,
            signals,
            combinedStrength,
            successRate,
            occurrences,
            occurrenceDates,
            avgPriceMove,
            combinationName,
            estimatedExitTimeMinutes,
          }) => ({
            coin,
            timeframe,
            signals,
            signalCount: signals.length, // Derived from signals array
            combinedStrength,
            successRate,
            occurrences,
            occurrenceDates,
            avgPriceMove,
            combinationName,
            strategyDirection: 'long', // Hardcoded as per previous implementation
            includedInScanner: false,
            estimatedExitTimeMinutes,
          })
        );
        await BacktestCombination.bulkCreate(combinationsToCreate);
      }
      
      let toastMessage = `${filteredResults.length} new combination(s) saved successfully.`;
      if (numOptedOut > 0) {
        toastMessage += ` ${numOptedOut} combination(s) were discarded as they are on the opt-out list.`;
      } else if (filteredResults.length === 0 && resultsToSave.length > 0) {
          toastMessage = "All found combinations were already on the opt-out list and not saved.";
      } else if (filteredResults.length === 0 && resultsToSave.length === 0) {
          toastMessage = "No successful combinations found to save.";
      }


      toast({
        title: "Save Complete",
        description: toastMessage,
      });

    } catch (error) {
      log(`Error saving combinations: ${error.message}`, 'error'); // Log internally
      console.error("Error saving combinations:", error); // For dev console
      toast({
        title: "Error",
        description: "Could not save combinations. " + error.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [log, toast]); // Dependencies for useCallback

  const runFullBacktest = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    setLogMessages([]);
    log('Backtest process started.', 'info'); // Updated logging message

    // Sanitize signals to prevent case-sensitive duplicates and ensure consistency
    const sanitizedSignalSettings = sanitizeSignals(signalSettings);
    if (signalSettings.length !== sanitizedSignalSettings.length) {
        log(`Sanitized signal list: removed ${signalSettings.length - sanitizedSignalSettings.length} duplicate(s) based on signal type.`, 'warning');
    }

    const { coins, timeframes, dataLookback, requiredSignals, minCombinedStrength, minPriceMove, timeWindow, maxSignals } = backtestConfig;
    let allMatches = [];
    let allDebugData = [];
    let allRegimeSummaries = [];

    console.log(`[BACKTEST_MANAGER] 🚀 Starting backtest with coins:`, coins);
    console.log(`[BACKTEST_MANAGER] 🚀 Timeframes:`, timeframes);
    console.log(`[BACKTEST_MANAGER] 🚀 Total steps: ${coins.length * timeframes.length}`);

    const totalSteps = coins.length * timeframes.length;
    let currentStep = 0;

    // MAJOR OPTIMIZATION: Batch fetch all coins for each timeframe
    for (const timeframe of timeframes) {
      console.log(`[BACKTEST_MANAGER] 🚀 Batch fetching data for ${coins.length} coins on ${timeframe}`);
      
      // Fetch all coins for this timeframe in a single batch request
      const symbolsToFetch = coins.map(coin => coin.replace('/', ''));
      const klineResponse = await getKlineData({
        symbols: symbolsToFetch,
        interval: timeframe,
        limit: parseInt(dataLookback, 10),
      });

      if (!klineResponse.success || !klineResponse.data) {
        throw new Error(klineResponse.error || 'Failed to fetch batch kline data.');
      }

      // Process each coin from the batch response
      for (const coin of coins) {
        currentStep++;
        const progressPercentage = (currentStep / totalSteps) * 100;
        setProgress(progressPercentage);
        setCurrentTask(`Running analysis for ${coin} on ${timeframe}...`);
        log(`--- Starting backtest for ${coin} on ${timeframe} ---`);

        try {
          const symbolKey = coin.replace('/', '');
          const symbolData = klineResponse.data[symbolKey];
          
          console.log(`[BACKTEST_MANAGER] 🔍 Symbol data for ${symbolKey}:`, symbolData);
          
          if (!symbolData || !symbolData.success || !symbolData.data) {
            console.log(`[BACKTEST_MANAGER] ❌ Failed to fetch symbol data for ${symbolKey}:`, symbolData?.error);
            throw new Error(symbolData?.error || 'Failed to fetch kline data for this symbol.');
          }

          log(`Fetched ${symbolData.data.length} candles. Initializing engine.`);

          const engine = new BacktestingEngine({
            historicalData: symbolData.data,
            signalSettings: sanitizedSignalSettings, // Use sanitized signals here
            minPriceMove,
            requiredSignals,
            maxSignals,
            timeWindow,
            timeframe,
            coin,
            minCombinedStrength,
            evaluateSignalCondition,
            defaultSignalSettings,
            onLog: log,
            debugMode: debugMode,
            collectDebugData: collectDebugData,
            regimeTrackingEnabled,
          });

          const { matches, debugData, regimeSummary } = await engine.runBacktest();
          log(`Found ${matches.length} potential signal occurrences.`);
          
          console.log(`[BACKTEST_MANAGER] 📊 Found ${matches.length} matches for ${coin} on ${timeframe}`);
          console.log(`[BACKTEST_MANAGER] 📊 Total matches so far: ${allMatches.length}`);

          if (matches.length > 0) {
            allMatches.push(...matches);
            console.log(`[BACKTEST_MANAGER] 📊 Added ${matches.length} matches for ${coin} on ${timeframe}. Total now: ${allMatches.length}`);
          }
          if (debugData) {
            allDebugData.push({ coin, timeframe, data: debugData });
          }
          if (regimeSummary) {
            allRegimeSummaries.push({ coin, timeframe, summary: regimeSummary });
          }

        } catch (error) {
          console.log(`[BACKTEST_MANAGER] ❌ Error during backtest for ${coin} on ${timeframe}:`, error);
          console.log(`[BACKTEST_MANAGER] ❌ Error message: ${error.message}`);
          console.log(`[BACKTEST_MANAGER] ❌ Error stack:`, error.stack);
          log(`Error during backtest for ${coin} on ${timeframe}: ${error.message}`, 'error');
          toast({
            title: `Backtest Error (${coin}/${timeframe})`,
            description: error.message,
            variant: 'destructive',
          });
        }
      }
    }

    setCurrentTask('Aggregating results...');
    log('--- Aggregating all results ---');
    
    console.log(`[BACKTEST_MANAGER] 📊 Final total matches: ${allMatches.length}`);
    console.log(`[BACKTEST_MANAGER] 📊 Matches by coin:`, allMatches.reduce((acc, match) => {
      acc[match.coin] = (acc[match.coin] || 0) + 1;
      return acc;
    }, {}));

    const groupedByCombination = allMatches.reduce((acc, match) => {
      // Use a consistent key for grouping
      const combinationKey = getCombinationSignature(match);
      if (!acc[combinationKey]) {
        acc[combinationKey] = [];
      }
      acc[combinationKey].push(match);
      return acc;
    }, {});

    setCurrentTask('Processing successful combinations...');
    const successfulCombinations = Object.values(groupedByCombination)
      .map(group => {
        const successfulTrades = group.filter(m => m.successful).length;
        const successRate = (successfulTrades / group.length) * 100;
        const avgPriceMove = group.reduce((sum, m) => sum + m.priceMove, 0) / group.length;

        // Calculate average exit time only for successful trades
        const successfulExits = group.filter(m => m.successful && m.exitTime);
        const avgExitTime = successfulExits.length > 0 ? successfulExits.reduce((sum, m) => sum + m.exitTime, 0) / successfulExits.length : null;
        const estimatedExitTimeMinutes = avgExitTime ? Math.round(avgExitTime / (1000 * 60)) : null;

        return {
          ...group[0], // Take base properties from the first match in the group
          successRate,
          occurrences: group.length,
          avgPriceMove,
          occurrenceDates: group.map(({ time, successful, priceMove, exitTime }) => ({
            date: new Date(time).toISOString(),
            price: 0, // Placeholder, price data is in historical data not matches
            priceMove,
            exitTime: exitTime ? Math.round(exitTime / (1000 * 60)) : null,
            successful,
          })),
          estimatedExitTimeMinutes,
        };
      })
      .filter(combo => {
        const passesSuccessRate = combo.successRate >= 50;
        const passesOccurrences = combo.occurrences > 1;
        const passesAvgPriceMove = combo.avgPriceMove >= 0.5; // 0.5% minimum average price move
        
        console.log(`[FINAL_FILTER] Combination: ${combo.combinationName || 'Unknown'}`);
        console.log(`[FINAL_FILTER]   • Success Rate: ${combo.successRate.toFixed(1)}% (>= 50%: ${passesSuccessRate})`);
        console.log(`[FINAL_FILTER]   • Occurrences: ${combo.occurrences} (> 1: ${passesOccurrences})`);
        console.log(`[FINAL_FILTER]   • Avg Price Move: ${combo.avgPriceMove.toFixed(2)}% (>= 0.5%: ${passesAvgPriceMove})`);
        console.log(`[FINAL_FILTER]   • Passes all filters: ${passesSuccessRate && passesOccurrences && passesAvgPriceMove}`);
        
        return passesSuccessRate && passesOccurrences && passesAvgPriceMove;
      });

    log(`Found ${successfulCombinations.length} combinations meeting success criteria.`);
    
    // Call handleSave to manage filtering and saving to DB
    if (successfulCombinations.length > 0) {
      setCurrentTask(`Saving successful combinations...`);
      await handleSave(successfulCombinations);
    } else {
       toast({
          title: "Backtest Complete",
          description: `No successful combinations were found.`,
        });
    }

    onBacktestComplete({
      results: successfulCombinations, // Return all found, even if not saved
      logs: logMessages,
      debugData: allDebugData,
      regimeSummaries: allRegimeSummaries,
    });

    setIsRunning(false);
    setCurrentTask('');
    setProgress(100);
  }, [
    signalSettings, // Kept as dependency, but sanitized version is used internally
    backtestConfig,
    onBacktestComplete,
    log,
    toast,
    defaultSignalSettings,
    debugMode,
    collectDebugData,
    regimeTrackingEnabled,
    handleSave, 
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backtest Execution</CardTitle>
        <CardDescription>
          Run the backtesting engine with the selected signals and configuration.
          Results will be saved and displayed below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={runFullBacktest} 
          disabled={isRunning || isSaving} 
          className="w-full"
        >
          {isRunning || isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isRunning ? 'Running Backtest...' : 'Saving Results...'}
            </>
          ) : (
            'Start Backtest'
          )}
        </Button>
        {isRunning && ( 
          <div className="space-y-2">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-center text-gray-600 dark:text-gray-300">
              {currentTask}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BacktestManager;
