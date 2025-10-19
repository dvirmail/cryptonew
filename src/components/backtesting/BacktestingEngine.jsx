
import { calculateAllIndicators } from '../utils/indicatorManager';
import { get } from 'lodash';
import MarketRegimeDetector from '@/components/utils/MarketRegimeDetector';

class BacktestingEngine {
  constructor({
    historicalData,
    signalSettings,
    minPriceMove = 1,
    minCandles = 250,
    requiredSignals = 1,
    maxSignals = 5,
    timeWindow = '4h',
    timeframe = '4h',
    coin = 'BTC/USDT',
    minCombinedStrength = 150,
    evaluateSignalCondition,
    defaultSignalSettings = {},
    classifySignalType,
    onLog = () => {},
    debugMode = false,
    collectDebugData = false,
    regimeTrackingEnabled = true,
    isRegimeAware = false,
  }) {
    this.historicalData = historicalData;
    this.signalSettings = signalSettings;
    this.minPriceMove = minPriceMove;
    this.minCandles = minCandles;
    this.timeWindow = timeWindow;

    this.settings = {
      requiredSignals: requiredSignals,
      maxSignals: maxSignals,
      timeframe: timeframe,
      coin: coin,
      minCombinedStrength: minCombinedStrength,
    };

    this.evaluateSignalCondition = evaluateSignalCondition;
    this.defaultSignalSettings = defaultSignalSettings;
    this.classifySignalType = classifySignalType;
    this.onLog = onLog;
    this.debugMode = debugMode;
    this.collectDebugData = collectDebugData;
    this.regimeTrackingEnabled = regimeTrackingEnabled; 
    this.isRegimeAware = isRegimeAware;
    
    this.allMatches = []; 
    this.summary = {}; 
    
    this.debugData = {
      parameters: { minPriceMove, requiredSignals: this.settings.requiredSignals, maxSignals: this.settings.maxSignals, timeWindow, timeframe: this.settings.timeframe, coin: this.settings.coin, minCombinedStrength },
      indicatorSnapshots: {},
      signalProcessingLog: [],
    };
    
    this.signalCounts = {};

    this.regimeDetectionStats = {
      totalDetections: 0,
      totalDetectionTime: 0,
    };
    this.regimeHistory = []; 

    this.log(`[${this.settings.coin}] BacktestingEngine initialized.`, 'info');
    this.log(`[${this.settings.coin}] [CONFIG] Backtest Time Window: ${this.timeWindow}`, 'info');
  }

  getDebugData() {
    return this.collectDebugData ? this.debugData : null;
  }

  log(message, level = 'info') {
    if (this.onLog) {
      this.onLog(message, level);
    }
    if (this.debugMode) {
      const logFunction = console[level] || console.log;
      //logFunction(`[BacktestingEngine] ${message}`);
    }
  }

  logSignalCount(signalType) {
      this.signalCounts[signalType] = (this.signalCounts[signalType] || 0) + 1;
  }

  getSignalCounts() {
      if (this.debugMode) {
          //this.log(`[${this.settings.coin}] [ENGINE_GET_SIGNAL_COUNTS] Returning signal counts: ${JSON.stringify(this.signalCounts)}`, 'debug');
      }
      return JSON.parse(JSON.stringify(this.signalCounts || {}));
  }

  logDataIntegrityCheck(historicalData, indicators) {
    if (!this.debugMode) return;
    this.log(`[${this.settings.coin}] [DEBUG] Data integrity check:`, 'debug');
    this.log(`[${this.settings.coin}] [DEBUG]   Historical data length: ${historicalData.length}`, 'debug');
    this.log(`[${this.settings.coin}] [DEBUG]   Calculated indicator types: ${Object.keys(indicators).join(', ')}`, 'debug');

    const checks = ['bollinger', 'bbw', 'rsi', 'macd', 'stochastic'];
    checks.forEach(key => {
        if (indicators[key]) {
            if (indicators[key].length === historicalData.length) {
                this.log(`[${this.settings.coin}] [DEBUG]   ✅ ${key} data length matches historical data.`, 'debug');
            } else {
                this.log(`[${this.settings.coin}] [DEBUG]   ⚠️ ${key} data length (${indicators[key].length}) does not match historical data (${historicalData.length}).`, 'warning');
            }
        } else {
            this.log(`[${this.settings.coin}] [DEBUG]   ❌ ${key} data not found in indicators object.`, 'warning');
        }
    });
  }

  generateSignalCombinations(signals, candleIndex, regimeType, regimeConfidence) {
    if (!signals || !Array.isArray(signals) || signals.length === 0) {
        return [];
    }

    const MAX_SIGNALS_PER_CANDLE = 8;
    const limitedSignals = signals.slice(0, MAX_SIGNALS_PER_CANDLE);
    
    if (signals.length > MAX_SIGNALS_PER_CANDLE) {
        if (this.onLog && candleIndex < 100) {
            this.log(`[${this.settings.coin}] Warning: Too many signals (${signals.length}) for candle ${candleIndex}. Using only top ${MAX_SIGNALS_PER_CANDLE} strongest signals.`, 'warning');
        }
    }

    const combinations = [];
    const { requiredSignals, maxSignals } = this.settings; 
    
    const validRequiredSignals = Math.max(1, Math.min(requiredSignals || 2, limitedSignals.length));
    const validMaxSignals = Math.max(validRequiredSignals, Math.min(maxSignals || 4, limitedSignals.length));

    if (this.debugMode && candleIndex < 10) {
        this.log(`[${this.settings.coin}] [ENGINE_COMBO_GEN] Candle ${candleIndex}: Generating combinations from ${limitedSignals.length} signals (required: ${validRequiredSignals}, max_size: ${validMaxSignals})`, 'debug');
    }

    for (let combinationSize = validRequiredSignals; combinationSize <= validMaxSignals; combinationSize++) {
        const singleSizeCombinations = this.generateCombinationsIterative(limitedSignals, combinationSize, candleIndex, regimeType, regimeConfidence);
        
        const MAX_COMBINATIONS_PER_SIZE = 50;
        const limitedCombinations = singleSizeCombinations.slice(0, MAX_COMBINATIONS_PER_SIZE);
        
        combinations.push(...limitedCombinations);
        
        if (combinations.length > 200) {
            if (this.onLog && candleIndex < 10) {
                this.log(`[${this.settings.coin}] Combination generation stopped at 200 combinations for candle ${candleIndex} to prevent overflow.`, 'warning');
            }
            break;
        }
    }

    if (this.debugMode && candleIndex < 10 && combinations.length > 0) {
        this.log(`[${this.settings.coin}] [ENGINE_COMBO_GEN] Candle ${candleIndex}: Generated ${combinations.length} valid combinations`, 'debug');
    }

    return combinations;
  }

  generateCombinationsIterative(signals, size, candleIndex, regimeType, regimeConfidence) {
    if (size > signals.length || size <= 0) return [];
    
    const combinations = [];
    const indices = Array.from({ length: size }, (_, i) => i);
    
    while (true) {
        const combination = indices.map(i => signals[i]);
        const combinedStrength = combination.reduce((sum, signal) => sum + (signal.strength || 0), 0);
        
        if (combinedStrength >= this.settings.minCombinedStrength) {
            const candle = this.historicalData[candleIndex];
            const candleTime = candle?.time;
            const candleClosePrice = candle?.close;
            
            const enrichedSignals = combination.map(signal => ({
                ...signal,
                isEvent: this.classifySignalType ? this.classifySignalType(signal) : false
            }));
            
            combinations.push({
                signals: enrichedSignals,
                combinedStrength,
                time: candleTime || Date.now(),
                price: candleClosePrice,
                coin: this.settings.coin,
                timeframe: this.settings.timeframe,
                candleIndex: candleIndex, 
                marketRegime: regimeType,
                regimeConfidence: regimeConfidence
            });
        }
        
        let i = size - 1;
        while (i >= 0 && indices[i] === signals.length - size + i) {
            i--;
        }
        
        if (i < 0) break;

        if (combinations.length > 100) break;

        indices[i]++;
        for (let j = i + 1; j < size; j++) {
            indices[j] = indices[j - 1] + 1;
        }
    }
    
    return combinations;
  }

  generateCombinationName(signals) {
    if (!signals || !Array.isArray(signals)) return "Unnamed Combination";
    return signals
        .map(s => s.type)
        .filter(type => type)
        .sort()
        .join(' + ');
  }

  isProperSubset(setA, setB) {
    if (setA.length >= setB.length) {
        return false;
    }
    const setATypes = new Set(setA.map(s => s.type));
    const setBTypes = new Set(setB.map(s => s.type));
    
    for (const typeA of setATypes) {
        if (!setBTypes.has(typeA)) {
            return false;
        }
    }
    return true;
  }

  filterSubsetCombinations(combinations) {
      if (!combinations || combinations.length <= 1) {
          return combinations;
      }

      const finalCombinations = [];

      for (let i = 0; i < combinations.length; i++) {
          const combo1 = combinations[i];
          let isSubsetOfAnother = false;

          for (let j = 0; j < combinations.length; j++) {
              if (i === j) continue;

              const combo2 = combinations[j];
              if (this.isProperSubset(combo1.signals, combo2.signals)) {
                  isSubsetOfAnother = true;
                  break;
              }
          }

          if (!isSubsetOfAnother) {
              finalCombinations.push(combo1);
          }
      }
      return finalCombinations;
  }

  async run(progressCallback) {
    const startTime = performance.now();
    this.log(`[${this.settings.coin}] BacktestingEngine run started.`, 'info');

    if (!this.historicalData || this.historicalData.length === 0) {
        this.onLog('Historical data is empty, cannot run backtest.', 'error');
        return { matches: [], summary: {} };
    }

    if (this.isRegimeAware) {
      this.log(`[${this.settings.coin}] 🧠 Regime-Aware Mode ENABLED - Will detect market regime for each candle`, 'info');
    } else {
      this.log(`[${this.settings.coin}] 📊 Traditional Mode - Uniform strategy evaluation`, 'info');
    }

    this.log(`[${this.settings.coin}] Calculating technical indicators and patterns.`, 'info');
    
    this.indicators = calculateAllIndicators(this.historicalData, this.signalSettings, this.onLog);
    this.logDataIntegrityCheck(this.historicalData, this.indicators);

    this.log(`[${this.settings.coin}] Calculated ${Object.keys(this.indicators).length} indicator types`, 'info');

    if (this.indicators.adx && this.indicators.adx.length > 100) {
        //console.log(`[BacktestingEngine] [${this.settings.coin}] [ADX_DIAGNOSTIC] Verifying ADX calculations...`);
        
        const sampleIndices = [100, 200, 300, 500, 749, this.indicators.adx.length - 1]; 
        sampleIndices.forEach(i => {
            if (i >= this.indicators.adx.length) return;

            const adxData = this.indicators.adx[i];
            const candle = this.historicalData[i];

            if (candle && adxData) {
                const date = new Date(candle.time).toISOString().slice(0, 10);
                const price = typeof candle.close === 'number' ? candle.close.toFixed(2) : 'N/A';
                const adxVal = typeof adxData.ADX === 'number' ? adxData.ADX.toFixed(2) : 'null';
                const pdiVal = typeof adxData.PDI === 'number' ? adxData.PDI.toFixed(2) : 'null';
                const mdiVal = typeof adxData.MDI === 'number' ? adxData.MDI.toFixed(2) : 'null';

                //console.log(
                    //`[BacktestingEngine] [${this.settings.coin}] [ADX_DIAGNOSTIC] Candle #${i} (${date}) | ` +
                    //`Price: ${price} | ADX: ${adxVal} | +DI: ${pdiVal} | -DI: ${mdiVal}`
                //);
            } else {
                //console.warn(`[BacktestingEngine] [${this.settings.coin}] [ADX_DIAGNOSTIC] Missing candle or adxData at index ${i}`);
            }
        });
        
        const validAdxCount = this.indicators.adx.filter(adx => adx && typeof adx.ADX === 'number').length;
        const validPdiCount = this.indicators.adx.filter(adx => adx && typeof adx.PDI === 'number').length;
        const validMdiCount = this.indicators.adx.filter(adx => adx && typeof adx.MDI === 'number').length;
        const totalCount = this.indicators.adx.length;
        
        //console.log(`[BacktestingEngine] [${this.settings.coin}] [ADX_DIAGNOSTIC] Calculation Summary:`);
        //console.log(`  - Total Candles: ${totalCount}`);
        //console.log(`  - Valid ADX: ${validAdxCount} (${((validAdxCount/totalCount)*100).toFixed(1)}%)`);
        //console.log(`  - Valid +DI: ${validPdiCount} (${((validPdiCount/totalCount)*100).toFixed(1)}%)`);
        //console.log(`  - Valid -DI: ${validMdiCount} (${((validMdiCount/totalCount)*100).toFixed(1)}%)`);
    }

    this.signalCounts = {};
    this.allMatches = []; 
    this.regimeHistory = []; 

    const totalCandlesToProcess = this.historicalData.length - 1 - this.minCandles; 

    const allIndicators = { data: this.historicalData, ...this.indicators };
    
    let errorLogCount = 0;
    const MAX_ERROR_LOGS = 5;

    const noopLogger = () => {};

    if (this.onLog) this.log(`[${this.settings.coin}] [ENGINE_SIGNAL_PROCESSING] Starting to process ${totalCandlesToProcess} candles for signal detection (after warmup).`, 'info');

    const regimeDetector = this.isRegimeAware ? new MarketRegimeDetector(this.historicalData, this.indicators, true, this.log.bind(this)) : null;

    let regimeDetectionStartTime;
    
    // Variables for current candle's regime
    let currentMarketRegime = 'unknown'; 
    let regimeConfidence = 0.0; 

    // MODIFIED: Added a tracker for the last match index of each signal combination signature
    const lastMatchIndexBySignature = new Map();

    for (let i = this.minCandles; i < this.historicalData.length - 1; i++) {
        this.currentIndex = i; 
        const candle = this.historicalData[i];
        
        if (!candle) continue; 

        if (i % 200 === 0 && progressCallback) {
            const progress = ((i - this.minCandles) / totalCandlesToProcess) * 100;
            progressCallback({ coinProgress: 10 + (progress * 0.8), stage: `Processing candle ${i + 1}/${this.historicalData.length} (${Math.round(progress)}%)` });
        }

        if (this.isRegimeAware && regimeDetector) {
            regimeDetectionStartTime = performance.now();
            
            if (i % 200 === 0) {
                this.onLog(`[${this.settings.coin}] [ENGINE_DIAGNOSTIC] Attempting to call MarketRegimeDetector for candle ${i}`, 'info');
                
                if (typeof MarketRegimeDetector === 'undefined') {
                     this.onLog(`[${this.settings.coin}] [IMPORT_FAILURE] MarketRegimeDetector class is UNDEFINED.`, 'error');
                } else if (typeof regimeDetector.getRegime !== 'function') { 
                     this.onLog(`[${this.settings.coin}] [IMPORT_FAILURE] regimeDetector.getRegime is NOT A FUNCTION. It is a: ${typeof regimeDetector.getRegime}`, 'error');
                     this.onLog(`[${this.settings.coin}] [IMPORT_FAILURE] Contents of MarketRegimeDetector instance: ${JSON.stringify(Object.keys(regimeDetector))}`, 'error');
                } else {
                     this.onLog(`[${this.settings.coin}] [IMPORT_SUCCESS] regimeDetector.getRegime is a valid function.`, 'info');
                }
            }

            try {
                const regimeResult = regimeDetector.getRegime(i); 
                currentMarketRegime = regimeResult.regime; 
                regimeConfidence = regimeResult.confidence; 
                this.regimeHistory.push(currentMarketRegime); 
                
                this.regimeDetectionStats.totalDetections++;
                
            } catch (error) {
                this.log(`[${this.settings.coin}] ⚠️ Regime detection failed at candle ${i}: ${error.message}`, 'warning');
                currentMarketRegime = 'unknown'; 
                regimeConfidence = 0; 
                this.regimeHistory.push(currentMarketRegime); 
            }
            
            const regimeDetectionTime = performance.now() - regimeDetectionStartTime;
            this.regimeDetectionStats.totalDetectionTime += regimeDetectionTime;
            
            if ((i - this.minCandles) % 100 === 0 && (i - this.minCandles) > 0) {
                const avgRegimeTime = this.regimeDetectionStats.totalDetections > 0
                    ? this.regimeDetectionStats.totalDetectionTime / this.regimeDetectionStats.totalDetections
                    : 0;
                const regimeForLog = this.regimeHistory[this.regimeHistory.length - 1] || 'N/A'; 
                //this.log(`[${this.settings.coin}] [REGIME] Candle ${i}: ${regimeForLog.toUpperCase()} (${regimeConfidence.toFixed(3)}) | Avg Detection Time: ${avgRegimeTime.toFixed(2)}ms (Cumulative)`, 'debug');
            }
        }
        
        try {
            const signalsAtCandle = this.evaluateSignalCondition(
                candle, 
                allIndicators, 
                i, 
                this.signalSettings, 
                currentMarketRegime, 
                noopLogger, 
                this.debugMode 
            );
            
            let effectiveSignals = signalsAtCandle; 
            if (effectiveSignals && effectiveSignals.length > 0) {
                const strongestSignalMap = new Map();
                effectiveSignals.forEach(signal => {
                    if (signal && signal.type && typeof signal.strength === 'number') {
                        if (!strongestSignalMap.has(signal.type) || signal.strength > strongestSignalMap.get(signal.type).strength) {
                            strongestSignalMap.set(signal.type, signal);
                        }
                    }
                });
                effectiveSignals = Array.from(strongestSignalMap.values());
            }

            if (this.debugMode && (i - this.minCandles) < 5) {
                this.log(`[${this.settings.coin}] [ENGINE_CANDLE_${i}] Found ${effectiveSignals.length} signals at candle ${i}. Signal types: ${(effectiveSignals || []).map(s => s.type).join(', ')}`, 'debug');
            }

            if (this.collectDebugData) {
                this.debugData.signalProcessingLog.push({
                    timestamp: candle.time,
                    signals: (effectiveSignals || []).map(s => {
                        const valueString = s.value !== undefined 
                            ? (typeof s.value === 'number' ? s.value.toFixed(2) : s.value) 
                            : 'N/A';
                        const strengthString = s.strength !== undefined ? s.strength.toFixed(0) : 'N/A';
                        const isEventString = typeof s.isEvent === 'boolean' ? ` (Event: ${s.isEvent ? 'Yes' : 'No'})` : '';
                        return `${s.type || 'N/A'}: ${valueString} (Str: ${strengthString})${isEventString}`;
                    }).join(', '),
                });
            }

            if (!effectiveSignals || effectiveSignals.length < this.settings.requiredSignals) continue;

            effectiveSignals.forEach(signal => {
                if (signal && signal.type) {
                    this.logSignalCount(signal.type.toLowerCase()); 
                }
            });
            
            let combinations = this.generateSignalCombinations(effectiveSignals, i, currentMarketRegime, regimeConfidence); 
            
            if (combinations.length > 1) {
                combinations = this.filterSubsetCombinations(combinations);
            }

            if (combinations.length > 0) {
                const combinationsToProcess = combinations.map(combination => ({
                    ...combination,
                    combinationName: this.generateCombinationName(combination.signals), // This will be our signature
                }));

                const nonConsecutiveCombinations = [];
                combinationsToProcess.forEach(combination => {
                    const signature = combination.combinationName; 
                    const lastMatchIndex = lastMatchIndexBySignature.get(signature);

                    // Check if the signal is consecutive: A new occurrence is only registered if this is the first time,
                    // or if it did not occur on the immediately preceding candle (i.e., current index is more than 1 greater than last index).
                    if (lastMatchIndex === undefined || i > lastMatchIndex + 1) {
                        nonConsecutiveCombinations.push(combination);
                        lastMatchIndexBySignature.set(signature, i);
                    }
                });

                if (this.debugMode && this.isRegimeAware && i % 50 === 0 && nonConsecutiveCombinations.length > 0) {
                    const firstCombination = nonConsecutiveCombinations[0];
                    if (firstCombination) {
                        //this.log(`[${this.settings.coin}] [MATCH_TAGGED] Candle ${i}: '${firstCombination.combinationName.substring(0, 30)}...' tagged with ${firstCombination.marketRegime.toUpperCase()} regime (Confidence: ${firstCombination.regimeConfidence.toFixed(2)})`, 'debug');
                    }
                }
                
                // Add the filtered, non-consecutive combinations to allMatches
                this.allMatches.push(...nonConsecutiveCombinations); 
            }
        } catch (error) {
            if (this.onLog && errorLogCount < MAX_ERROR_LOGS) {
                this.log(`[${this.settings.coin}] Error analyzing candle ${i} (Time: ${new Date(candle.time).toISOString()}): ${error.message}`, 'error');
                errorLogCount++;
                if (errorLogCount === MAX_ERROR_LOGS) {
                     this.log(`[${this.settings.coin}] Further errors for this coin will be suppressed to prevent log spam.`, 'warning');
                }
            }
            continue;
        }
    }
    
    if (progressCallback) {
        progressCallback({ coinProgress: 95, stage: 'Finalizing results...' });
    }

    if (this.isRegimeAware) {
      const totalRegimeDetections = this.regimeDetectionStats.totalDetections; 
      const totalDetectionTime = this.regimeDetectionStats.totalDetectionTime; 

      const avgRegimeDetectionTime = totalRegimeDetections > 0 ? totalDetectionTime / totalRegimeDetections : 0;
      const regimeOverheadPercent = (totalDetectionTime / (performance.now() - startTime)) * 100;
      
      this.log(`[${this.settings.coin}] [REGIME_STATS] Performance Summary:`, 'info');
      this.log(`  • Total Regime Detections: ${totalRegimeDetections}`, 'info');
      this.log(`  • Total Detection Time: ${totalDetectionTime.toFixed(2)}ms`, 'info');
      this.log(`  • Average Time per Detection: ${avgRegimeDetectionTime.toFixed(2)}ms`, 'info');
      this.log(`  • Regime Detection Overhead: ${regimeOverheadPercent.toFixed(1)}% of total backtest time`, 'info');
      
      this.log(`[${this.settings.coin}] [REGIME_DISTRIBUTION] Detected Regimes:`, 'system');
      const total = this.regimeHistory.length;
      const regimeCounts = this.regimeHistory.reduce((acc, regime) => {
          acc[regime] = (acc[regime] || 0) + 1;
          return acc;
      }, {});

      const logRegime = (regimeName, count) => {
          if (count > 0) {
            this.log(`  • ${regimeName.toUpperCase()}: ${count} candles (${((count / total) * 100).toFixed(1)}%)`, 'system');
          }
      };

      logRegime('uptrend', regimeCounts.uptrend || 0);
      logRegime('downtrend', regimeCounts.downtrend || 0);
      logRegime('ranging', regimeCounts.ranging || 0);
      logRegime('unknown', regimeCounts.unknown || 0);
    }

    const totalTime = performance.now() - startTime;
    this.log(`[${this.settings.coin}] Backtest completed in ${totalTime.toFixed(2)}ms`, 'success');
    this.log(`[${this.settings.coin}] Found ${this.allMatches.length} signal combinations across ${totalCandlesToProcess} processed candles`, 'success');

    if (this.onLog) {
        this.log(`[${this.settings.coin}] [ENGINE_SIGNAL_PROCESSING] Completed processing ${totalCandlesToProcess} candles.`, 'info');
        this.log(`[${this.settings.coin}] [ENGINE_SIGNAL_COUNTS] Final signal counts: ${JSON.stringify(this.signalCounts)}`, 'debug');
        this.log(`[${this.settings.coin}] [ENGINE_RAW_MATCHES] Generated ${this.allMatches.length} raw signal combinations.`, 'info');
    }
    
    this.summary.coin = this.settings.coin;
    this.summary.totalRawCombinations = this.allMatches.length;
    this.summary.totalCandles = this.historicalData.length;
    this.summary.totalMatches = this.allMatches.length;

    return {
        matches: this.allMatches, 
        summary: this.summary, 
        debugData: this.getDebugData(), 
    };
  }

  getEnabledSignals() {
    return Object.keys(this.signalSettings).filter(key => 
        this.signalSettings[key] && this.signalSettings[key].enabled
    );
  }
}

export default BacktestingEngine;
