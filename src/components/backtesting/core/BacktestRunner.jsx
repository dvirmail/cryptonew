
import { fetchDataForCoin, fetchDataForCoins } from '@/components/backtesting/data/klineDataFetcher';
import BacktestingEngine from '@/components/backtesting/BacktestingEngine';
import { defaultSignalSettings } from '@/components/utils/signalSettings';
import { calculateMatchOutcomes } from './backtestProcessor';

export const runBacktestForCoin = async ({
  coinSymbol, period, timeframe, signalSettings, targetGain = 1, timeWindow = '4h',
  requiredSignalsForBacktest = 1, maxSignals = 5, minCombinedStrength = 150,
  setBacktestProgress, setDataLoadingProgress, onLog,
  evaluateSignalCondition, classifySignalType,
  isRegimeAware = false,
}) => {
    if (!coinSymbol || !period || !timeframe || !signalSettings) {
        if (onLog) onLog('Missing required parameters for backtest.', 'error');
        throw new Error('Missing required parameters for backtest.');
    }
    const enabledSignals = Object.keys(signalSettings).filter(key =>
        signalSettings[key] && signalSettings[key].enabled
    );
    if (enabledSignals.length === 0) {
        if (onLog) onLog('No signals enabled for backtest.', 'warning');
        throw new Error('No signals enabled for backtest.');
    }
    if (setBacktestProgress) {
        setBacktestProgress({ currentCoin: coinSymbol, coinProgress: 0, stage: `Fetching data for ${coinSymbol}...` });
    }
    if (onLog) onLog(`Starting data fetch for ${coinSymbol}.`, 'info');
    
    const fetchDataResult = await fetchDataForCoin({
        coinToFetch: coinSymbol,
        currentPeriod: period,
        currentTimeframe: timeframe,
        dataLoadingProgressSetter: setDataLoadingProgress,
        onLog
    });

    if (!fetchDataResult.success || !fetchDataResult.data || fetchDataResult.data.length < 50) {
        const errorMsg = fetchDataResult.error || `Insufficient data: ${fetchDataResult.data?.length || 0} candles. Need at least 50.`;
        if (onLog) onLog(`Data fetch failed: ${errorMsg}`, 'error');
        throw new Error(errorMsg);
    }
    const historicalData = fetchDataResult.data;
    if (onLog) onLog(`Successfully loaded ${historicalData.length} candles.`, 'success');

    const engine = new BacktestingEngine({
        historicalData: historicalData,
        signalSettings,
        minPriceMove: targetGain,
        requiredSignals: requiredSignalsForBacktest,
        maxSignals,
        timeWindow,
        timeframe,
        coin: coinSymbol,
        minCombinedStrength,
        evaluateSignalCondition,
        defaultSignalSettings,
        classifySignalType,
        isRegimeAware,
        onLog,
        debugMode: true,
        collectDebugData: true,
    });
    
    // NEW: Log regime-aware mode for this coin
    if (isRegimeAware) {
        if (onLog) onLog(`🧠 Running in Regime-Aware mode - will detect market conditions per candle`, 'info');
    } else {
        if (onLog) onLog(`📊 Running in Traditional mode - uniform strategy evaluation`, 'info');
    }
    
    if (setBacktestProgress) {
        setBacktestProgress({ currentCoin: coinSymbol, coinProgress: 10, stage: `Running backtest...` });
    }

    // New, simplified logic: The engine now handles its own orchestration.
    const results = await engine.run(progressUpdate => {
        if (setBacktestProgress) {
            setBacktestProgress({ currentCoin: coinSymbol, ...progressUpdate });
        }
    });

    // REFACTOR: Process raw matches from the engine to calculate outcomes.
    if (onLog) onLog(`Calculating outcomes for ${results.matches.length} raw combinations...`, 'info');
    const processedMatches = calculateMatchOutcomes(results.matches, historicalData, {
        minPriceMove: targetGain,
        timeWindow,
        timeframe,
    });
    if (onLog) onLog(`Finished calculating outcomes. Found ${processedMatches.length} valid matches.`, 'success');

    if (setBacktestProgress) {
        setBacktestProgress({ currentCoin: coinSymbol, coinProgress: 100, stage: `Finished.` });
    }
    
    const engineSignalCounts = engine.getSignalCounts();
    // Log the signal counts from the engine
    if (onLog) {
        onLog(`[BACKTEST_RUNNER] Signal counts from engine: ${JSON.stringify(engineSignalCounts)}`, 'debug');
        onLog(`[BACKTEST_RUNNER] Total unique signal types: ${Object.keys(engineSignalCounts).length}`, 'debug');
    }

    return {
        matches: processedMatches, // Return the fully processed matches
        summary: {
            ...results.summary,
            enabledSignals: enabledSignals.length
        },
        historicalData: historicalData, // This line already exists, matches the "NEW" comment in the outline
        success: true,
        signalCounts: engineSignalCounts,
        debugData: results.debugData
    };
};

/**
 * A hypothetical class to encapsulate the data loading logic
 * for multiple coins, using batched fetching. This class structure
 * is introduced to provide a valid 'this' context for the outlined
 * `loadDataForBacktest` method, which uses `this.setState` and `this.addLog`.
 *
 * In a real application, this might be a method within a React Component,
 * a store, or a service. For this exercise, `setState` and `addLog`
 * are provided with minimal mock implementations to ensure functionality.
 */
class BacktestDataBatcher {
    constructor() {
        // Internal state simulation for demonstration purposes
        this._state = {
            dataLoading: false,
            dataLoadingProgress: 0,
            loadingMessage: '',
            coinData: {}
        };
        // Mock setState method to simulate component state updates
        this.setState = (newState) => {
            this._state = { ...this._state, ...newState };
            // console.log('[BacktestDataBatcher] State Updated:', this._state); // Optional: for debugging
        };
        // Mock addLog method to simulate logging functionality
        this.addLog = (message, type = 'info') => {
            // console.log(`[BacktestDataBatcher][${type.toUpperCase()}] ${message}`); // Optional: for debugging
        };
    }

    async loadDataForBacktest(selectedCoins, currentPeriod, currentTimeframe) {
        this.setState({ dataLoading: true, dataLoadingProgress: 0, loadingMessage: 'Preparing to fetch data...' });
        this.addLog('Starting data fetch for backtesting...', 'info');

        const totalCoins = selectedCoins.length;
        this.addLog(`Fetching K-line data for ${totalCoins} coins using batched approach...`, 'info');

        try {
            // NEW: Use batched fetching instead of individual calls
            const BATCH_SIZE = 20; // Fetch 20 symbols per backend call
            const batches = [];
            
            for (let i = 0; i < selectedCoins.length; i += BATCH_SIZE) {
                batches.push(selectedCoins.slice(i, i + BATCH_SIZE));
            }

            this.addLog(`[KLINE_BATCH] Split ${totalCoins} coins into ${batches.length} batches of up to ${BATCH_SIZE} symbols`, 'info');

            const allResults = {};
            let processedCoins = 0;

            // Process batches sequentially to avoid overwhelming the backend
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const batchNumber = batchIndex + 1;
                
                this.setState({ 
                    loadingMessage: `Fetching batch ${batchNumber}/${batches.length} (${batch.length} coins)...` 
                });

                this.addLog(`[KLINE_BATCH] Processing batch ${batchNumber}/${batches.length} with ${batch.length} symbols...`, 'info');

                const batchResults = await fetchDataForCoins({
                    coinsToFetch: batch,
                    currentPeriod,
                    currentTimeframe,
                    dataLoadingProgressSetter: (progress) => {
                        // Calculate overall progress across all batches
                        const batchProgress = (batchIndex / batches.length) * 100;
                        const currentBatchProgress = (progress / batches.length);
                        this.setState({ dataLoadingProgress: batchProgress + currentBatchProgress });
                    },
                    onLog: this.addLog.bind(this)
                });

                // Merge batch results into allResults
                Object.assign(allResults, batchResults);
                
                processedCoins += batch.length;
                this.addLog(`[KLINE_BATCH] Batch ${batchNumber}/${batches.length} complete. Total progress: ${processedCoins}/${totalCoins} coins`, 'success');

                // Small delay between batches to prevent overwhelming the system
                if (batchIndex < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            // Process the results
            const loadedData = {};
            let successCount = 0;
            let failCount = 0;

            for (const coin of selectedCoins) {
                const result = allResults[coin];
                
                if (result && result.success && result.data && result.data.length > 0) {
                    loadedData[coin] = result.data;
                    successCount++;
                } else {
                    const error = result?.error || 'Unknown error or no data returned.';
                    this.addLog(`Failed to load data for ${coin}: ${error}`, 'error');
                    failCount++;
                }
            }

            this.setState({ 
                coinData: loadedData, 
                dataLoading: false, 
                dataLoadingProgress: 100,
                loadingMessage: `Data fetch complete: ${successCount} successful, ${failCount} failed`
            });

            this.addLog(`✅ Data loading complete: ${successCount}/${totalCoins} coins loaded successfully`, 'success');

            if (failCount > 0) {
                this.addLog(`⚠️ ${failCount} coins failed to load`, 'warning');
            }

            return loadedData;

        } catch (error) {
            this.addLog(`Critical error during data loading: ${error.message}`, 'error');
            this.setState({ 
                dataLoading: false, 
                loadingMessage: `Error: ${error.message}` 
            });
            throw error;
        }
    }
}

// Export the new class alongside the existing function
export { BacktestDataBatcher };
