
import { indicatorCalculations } from '@/components/utils/indicatorManager';

/**
 * A class responsible for calculating various technical indicators.
 * It manages individual indicator calculation functions and orchestrates their execution.
 */
class IndicatorCalculator {
  /**
   * Constructs an IndicatorCalculator instance.
   * @param {Object} indicatorCalculationsMap - A map where keys are indicator names and values are their calculation functions.
   */
  constructor(indicatorCalculationsMap) {
    this.indicatorCalculations = indicatorCalculationsMap;
  }

  /**
   * Calculates all required technical indicators for a given set of historical data.
   * @param {Array} historicalData - The raw kline data (array of objects with open, high, low, close, volume, etc.).
   * @param {Object} signalSettings - The configuration object for enabled signals, where keys are indicator names and values are their settings.
   * @param {string} coin - The coin symbol for logging purposes (e.g., "BTC/USDT").
   * @param {Function} onLog - Callback function for logging progress or errors.
   * @returns {Promise<Object>} - A promise that resolves to an object containing calculated indicators and the original historical data.
   */
  async calculateIndicators(historicalData, signalSettings, coin, onLog) {
    const startTime = performance.now();
    if (onLog) onLog(`[${coin}] Calculating technical indicators and patterns.`, 'info');
    try {
      const indicators = {};
      const closePrices = historicalData.map(c => c.close);
      const highPrices = historicalData.map(c => c.high);
      const lowPrices = historicalData.map(c => c.low);
      const volume = historicalData.map(c => c.volume);

      const indicatorPromises = Object.entries(signalSettings)
        .filter(([, settings]) => settings.enabled)
        .map(([key, settings]) => {
          const calculation = this.indicatorCalculations[key];
          if (calculation) {
            return calculation(historicalData, settings, { closePrices, highPrices, lowPrices, volume })
              .then(result => ({ key, result }))
              .catch(error => {
                if (onLog) onLog(`[${coin}] Error calculating indicator ${key}: ${error.message}`, 'error');
                return { key, result: [] }; // Return an empty array for the failed indicator to prevent Promise.all from failing
              });
          }
          return Promise.resolve(null); // Return null for indicators that do not have a defined calculation function
        });

      const calculated = await Promise.all(indicatorPromises);

      calculated.forEach(item => {
        if (item) { // Ensure the item is not null (i.e., it was a valid calculation or a failed one that returned an object)
          indicators[item.key] = item.result;
        }
      });

      indicators.data = historicalData; // Add the original historical data to the indicators object

      // REMOVED: Debug logs for indicator keys and Bollinger data existence
      const endTime = performance.now();
      const timeElapsed = ((endTime - startTime) / 1000).toFixed(2);
      
      if (onLog) onLog(`[${coin}] Indicators calculated in ${timeElapsed}s. Keys: ${Object.keys(indicators).length}`, 'info');

      return indicators;
    } catch (error) {
      if (onLog) onLog(`[IndicatorCalculator - ${coin}] Critical error during indicator calculation: ${error.message}`, 'error');
      console.error("Indicator Calculation Error:", error);
      // Re-throw the error to ensure the calling process (e.g., BacktestingEngine) knows that calculation failed.
      throw error;
    }
  }
}

// Instantiate the calculator. We assume `indicatorCalculations` is exported by `indicatorManager`
// and provides the necessary mapping of indicator names to their calculation functions.
const indicatorCalculatorInstance = new IndicatorCalculator(indicatorCalculations);

// Export the calculateIndicators method, binding 'this' to the instance.
// This maintains the original file's `export const calculateIndicators` signature,
// allowing existing callers to continue using it without changes.
export const calculateIndicators = indicatorCalculatorInstance.calculateIndicators.bind(indicatorCalculatorInstance);
