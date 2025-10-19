
import { calculateAllIndicators } from './indicatorManager';

// SAFETY PATCH: prevent ReferenceError if any debug log references `out` outside its scope
// This guards against recent comment edits that may have left a stray `out` in logs.
var out;

// Helper function to calculate percentile rank
function getPercentileRank(data) {
    if (!data || data.length === 0) return [];
    const validData = data.filter(d => d !== null && !isNaN(d));
    if (validData.length === 0) return Array(data.length).fill(null);

    const sortedData = [...validData].sort((a, b) => a - b);
    const n = sortedData.length;

    return data.map(value => {
        if (value === null || isNaN(value)) return null;
        let count = 0;
        for (let i = 0; i < n; i++) {
            if (sortedData[i] < value) {
                count++;
            }
        }
        // Calculate percentile as (number of values less than current value) / total number of valid values * 100
        return (count / n) * 100;
    });
}

class MarketRegimeDetector {
  constructor(klines, existingIndicators = null, useExistingIndicators = false, addLog = null) {
    this.klines = klines;
    this.indicators = {};
    this.addLog = typeof addLog === 'function' ? addLog : () => {};

    // IMPLEMENTATION OF SUGGESTION #2: Add Regime Confirmation State
    this.regimeHistory = []; // Store recent raw regime calculations
    this.confirmedRegime = null; // The current confirmed regime
    this.confirmedConfidence = 50; // Confidence of the confirmed regime
    this.confirmationRequired = 3; // Number of consecutive candles required for confirmation
    this.maxHistoryLength = 10; // Maximum history to keep for memory management

    // NEW: Track current streak of the _latest_ regime calculated
    this.consecutivePeriods = 0; // Current streak of same regime as last processed candle
    this.lastRegimeDetected = null; // Regime of the last processed candle

    // ensure internal tracking props exist
    if (typeof this.consecutivePeriods !== 'number') this.consecutivePeriods = 0;
    if (!Array.isArray(this.regimeHistory)) this.regimeHistory = [];
    if (typeof this.lastRegimeDetected !== 'string' && this.lastRegimeDetected !== null) this.lastRegimeDetected = null;

    // Phase 3: Ensure confirmation window >= 5 to reduce jitter
    this.confirmationRequired = Math.max(5, this.confirmationRequired || 5);

    // DEV: enable verbose console logs via localStorage flag
    try {
      this.__devDebug = typeof window !== 'undefined' && localStorage.getItem('regimeDebug') === '1';
    } catch (_) {
      this.__devDebug = false;
    }

    if (useExistingIndicators && existingIndicators && Object.keys(existingIndicators).length > 0) {
        //this.addLog('[MarketRegimeDetector] Using provided indicators', 'info');
        this.indicators = existingIndicators;
        
    } else {
        this.addLog('[MarketRegimeDetector] Calculating fresh indicators...', 'info');
        const signalSettings = this._getDefaultSignalSettings();
        this.indicators = calculateAllIndicators(this.klines, signalSettings, this.addLog);
    }
    
    // Add this log to see initial indicator availability
    //console.log('[MRD_DEBUG] Initialized with indicators:', Object.keys(this.indicators));
    //console.log('[MRD_DEBUG] Length of klines:', this.klines.length);
    //console.log(`[MRD_DEBUG] Regime confirmation requires ${this.confirmationRequired} consecutive candles`);

    if (!this.indicators || !this.indicators.adx || this.indicators.adx.length === 0) {
        this.addLog('ADX data not found or empty in MarketRegimeDetector.', 'warning');
        // Throw an error or return empty if essential indicators are missing after calculation
        if (!this.indicators) {
            throw new Error('Failed to calculate indicators for market regime detection');
        }
    }

    //this.addLog(`[MarketRegimeDetector] Initialized with ${klines.length} candles`, 'info');
    
    this.atrPercentiles = this.indicators.normalizedAtr ? getPercentileRank(this.indicators.normalizedAtr) : [];
    this.bbwPercentiles = this.indicators.bbw ? getPercentileRank(this.indicators.bbw) : [];
  }

  // NEW: allow restoring prior streak/history so detector can continue across reloads
  restoreState({ regimeHistory = [], consecutivePeriods = 0, lastRegimeDetected = null } = {}) {
    try {
        if (Array.isArray(regimeHistory)) {
            // cap to a reasonable size to avoid unbounded growth
            this.regimeHistory = regimeHistory.slice(-50);
        }
        if (typeof consecutivePeriods === 'number') {
            this.consecutivePeriods = Math.max(0, consecutivePeriods);
        }
        if (typeof lastRegimeDetected === 'string' || lastRegimeDetected === null) {
            this.lastRegimeDetected = lastRegimeDetected;
        }
        //this.addLog('[MarketRegimeDetector] Restored previous regime streak/history.', 'system');
    } catch (_e) {
        // swallow restore issues silently, detector will proceed normally
    }
  }

  // Enable/disable per instance
  setDevDebug(enabled) {
    this.__devDebug = !!enabled;
    try { localStorage.setItem('regimeDebug', enabled ? '1' : '0'); } catch (_) {}
  }

  // Static helpers for quick toggle from console
  static enableDevDebug() {
    try { localStorage.setItem('regimeDebug', '1'); } catch (_) {}
    console.info('[REGIME_DEBUG] Enabled (refresh or wait next scan cycle)');
  }
  static disableDevDebug() {
    try { localStorage.setItem('regimeDebug', '0'); } catch (_) {}
    console.info('[REGIME_DEBUG] Disabled');
  }

  // NEW HELPER: Get latest value of an indicator, handling object structures if necessary
  _getLatestValue(key) {
    const stream = this.indicators?.[key];
    if (!stream || stream.length === 0) return undefined;
    const v = stream[stream.length - 1];
    return v ?? undefined;
  }

  // The new _detectRegime and _calculateConfidence replace the previous _calculateRawRegime and __applyGuardrails logic
  _detectRegime() {
        //console.log(`[REGIME_CALC] 🎯 Starting regime detection with ${this.klines.length} klines`);
        
        // Get latest indicator values
        const latest = this.klines.length - 1;
        const adxData = this._getLatestValue('adx');
        const adx = adxData && typeof adxData.ADX === 'number' ? adxData.ADX : undefined; // Extract ADX number
        const ema = this._getLatestValue('ema');
        // 'ma200' is typically a simple moving average, `sma` might be generic, prefer specific if possible
        const smaValue = this._getLatestValue('ma200') || this._getLatestValue('sma'); // Assuming sma is a specific type, if not, it should be _getLatestValue('sma_someperiod')
        const sma = typeof smaValue === 'number' ? smaValue : undefined; // Ensure it's a number
        const macdData = this._getLatestValue('macd');
        const macd = macdData && typeof macdData.macd === 'number' && typeof macdData.signal === 'number' ? macdData : undefined;
        const rsi = this._getLatestValue('rsi');
        const bbw = this._getLatestValue('bbw');
        const currentPrice = this.klines[latest]?.close;
        
        /*console.log(`[REGIME_CALC] 📊 Latest indicator values:`, {
            currentPrice: currentPrice?.toFixed(2),
            adx: adx?.toFixed(2),
            ema: ema?.toFixed(2),
            sma: sma?.toFixed(2),
            macd: macd ? `${macd.macd?.toFixed(4)} / ${macd.signal?.toFixed(4)}` : 'N/A',
            rsi: rsi?.toFixed(2),
            bbw: bbw?.toFixed(4)
        });*/

        // Initialize scores
        let uptrendScore = 0;
        let downtrendScore = 0;
        let rangingScore = 0;
        
        //console.log(`[REGIME_CALC] 🔍 Starting indicator analysis...`);

        // Price vs Moving Averages
        let priceAboveEMA = false;
        let priceAboveSMA = false;
        
        if (ema !== undefined && currentPrice !== undefined) {
            priceAboveEMA = currentPrice > ema;
            if (priceAboveEMA) {
                uptrendScore += 20;
                //console.log(`[REGIME_CALC] ✅ Price above EMA: +20 uptrend (${currentPrice.toFixed(2)} > ${ema.toFixed(2)})`);
            } else {
                downtrendScore += 20;
                //console.log(`[REGIME_CALC] ❌ Price below EMA: +20 downtrend (${currentPrice.toFixed(2)} < ${ema.toFixed(2)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing EMA or current price data`);
        }

        if (sma !== undefined && currentPrice !== undefined) {
            priceAboveSMA = currentPrice > sma;
            if (priceAboveSMA) {
                uptrendScore += 15;
                //console.log(`[REGIME_CALC] ✅ Price above SMA: +15 uptrend (${currentPrice.toFixed(2)} > ${sma.toFixed(2)})`);
            } else {
                downtrendScore += 15;
                //console.log(`[REGIME_CALC] ❌ Price below SMA: +15 downtrend (${currentPrice.toFixed(2)} < ${sma.toFixed(2)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing SMA data`);
        }

        // MACD Analysis
        if (macd && macd.macd !== undefined && macd.signal !== undefined) {
            const macdBullish = macd.macd > macd.signal;
            const macdStrength = Math.abs(macd.macd - macd.signal);
            
            if (macdBullish) {
                const macdPoints = Math.min(15, macdStrength * 1000); // Scale the strength
                uptrendScore += macdPoints;
                //console.log(`[REGIME_CALC] 📈 MACD bullish: +${macdPoints.toFixed(1)} uptrend (MACD: ${macd.macd.toFixed(4)} > Signal: ${macd.signal.toFixed(4)})`);
            } else {
                const macdPoints = Math.min(15, macdStrength * 1000);
                downtrendScore += macdPoints;
                //console.log(`[REGIME_CALC] 📉 MACD bearish: +${macdPoints.toFixed(1)} downtrend (MACD: ${macd.macd.toFixed(4)} < Signal: ${macd.signal.toFixed(4)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing MACD data`);
        }

        // RSI Analysis
        if (rsi !== undefined) {
            if (rsi > 60) {
                const rsiPoints = Math.min(10, (rsi - 60) * 0.25);
                uptrendScore += rsiPoints;
                //console.log(`[REGIME_CALC] 🚀 RSI bullish: +${rsiPoints.toFixed(1)} uptrend (RSI: ${rsi.toFixed(2)})`);
            } else if (rsi < 40) {
                const rsiPoints = Math.min(10, (40 - rsi) * 0.25);
                downtrendScore += rsiPoints;
                //console.log(`[REGIME_CALC] 🔻 RSI bearish: +${rsiPoints.toFixed(1)} downtrend (RSI: ${rsi.toFixed(2)})`);
            } else {
                const rsiPoints = 5;
                rangingScore += rsiPoints;
                //console.log(`[REGIME_CALC] ↔️ RSI neutral: +${rsiPoints} ranging (RSI: ${rsi.toFixed(2)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing RSI data`);
        }

        // ADX Analysis (Trend Strength)
        if (adx !== undefined) {
            if (adx > 25) {
                // Strong trend - boost the leading direction
                const adxBoost = Math.min(20, (adx - 25) * 0.5);
                if (uptrendScore > downtrendScore) {
                    uptrendScore += adxBoost;
                    //console.log(`[REGIME_CALC] 💪 ADX confirms uptrend strength: +${adxBoost.toFixed(1)} uptrend (ADX: ${adx.toFixed(2)})`);
                } else if (downtrendScore > uptrendScore) {
                    downtrendScore += adxBoost;
                    //console.log(`[REGIME_CALC] 💪 ADX confirms downtrend strength: +${adxBoost.toFixed(1)} downtrend (ADX: ${adx.toFixed(2)})`);
                } else {
                    // Tie - ADX suggests strong movement but direction unclear
                    //console.log(`[REGIME_CALC] 💪 ADX shows strong movement but direction unclear (ADX: ${adx.toFixed(2)})`);
                }
            } else {
                // Weak trend - favor ranging
                const rangingBonus = Math.min(15, (25 - adx) * 0.6);
                rangingScore += rangingBonus;
                //console.log(`[REGIME_CALC] 😴 ADX suggests weak trend: +${rangingBonus.toFixed(1)} ranging (ADX: ${adx.toFixed(2)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing ADX data`);
        }

        // Bollinger Band Width (Volatility)
        if (bbw !== undefined) {
            if (bbw > 0.04) {
                // High volatility - could support trending
                const volatilityBonus = Math.min(8, bbw * 100);
                if (uptrendScore > downtrendScore) {
                    uptrendScore += volatilityBonus;
                    //console.log(`[REGIME_CALC] 🌪️ High volatility supports uptrend: +${volatilityBonus.toFixed(1)} uptrend (BBW: ${bbw.toFixed(4)})`);
                } else if (downtrendScore > uptrendScore) {
                    downtrendScore += volatilityBonus;
                    //console.log(`[REGIME_CALC] 🌪️ High volatility supports downtrend: +${volatilityBonus.toFixed(1)} downtrend (BBW: ${bbw.toFixed(4)})`);
                }
            } else {
                // Low volatility - suggests ranging
                const lowVolBonus = Math.min(12, (0.04 - bbw) * 200);
                rangingScore += lowVolBonus;
                //console.log(`[REGIME_CALC] 😴 Low volatility suggests ranging: +${lowVolBonus.toFixed(1)} ranging (BBW: ${bbw.toFixed(4)})`);
            }
        } else {
            console.log(`[REGIME_CALC] ⚠️ Missing BBW data`);
        }

        // Final scoring
        /*console.log(`[REGIME_CALC] 📊 Final scores:`, {
            uptrend: uptrendScore.toFixed(1),
            downtrend: downtrendScore.toFixed(1),
            ranging: rangingScore.toFixed(1)
        });*/

        let regime;
        if (uptrendScore > downtrendScore && uptrendScore > rangingScore) {
            regime = 'uptrend';
            //console.log(`[REGIME_CALC] ✅ UPTREND wins with ${uptrendScore.toFixed(1)} points`);
        } else if (downtrendScore > uptrendScore && downtrendScore > rangingScore) {
            regime = 'downtrend';
            //console.log(`[REGIME_CALC] ✅ DOWNTREND wins with ${downtrendScore.toFixed(1)} points`);
        } else if (rangingScore > uptrendScore && rangingScore > downtrendScore) {
            regime = 'ranging';
            //console.log(`[REGIME_CALC] ✅ RANGING wins with ${rangingScore.toFixed(1)} points`);
        } else {
            regime = 'neutral';
            //console.log(`[REGIME_CALC] ⚖️ NEUTRAL - scores too close or tied`);
        }

        return regime;
  }

  _calculateConfidence(regime) {
      //console.log(`[REGIME_CALC] 🎯 Calculating confidence for ${regime.toUpperCase()}...`);
      
      const latest = this.klines.length - 1; // Assuming latest candle
      const adxData = this._getLatestValue('adx');
      const adx = adxData && typeof adxData.ADX === 'number' ? adxData.ADX : undefined; // Extract ADX number
      const rsi = this._getLatestValue('rsi');
      const macdData = this._getLatestValue('macd');
      const macd = macdData && typeof macdData.macd === 'number' && typeof macdData.signal === 'number' ? macdData : undefined;
      const bbw = this._getLatestValue('bbw');

      let confidence = 0.5; // Base confidence

      // ADX contribution to confidence
      if (adx !== undefined) {
          if (adx > 25) {
              const adxConfidence = Math.min(0.3, (adx - 25) / 100);
              confidence += adxConfidence;
              //console.log(`[REGIME_CALC] 💪 ADX adds confidence: +${(adxConfidence * 100).toFixed(1)}% (ADX: ${adx.toFixed(2)})`);
          } else {
              const adxPenalty = Math.min(0.2, (25 - adx) / 100);
              confidence -= adxPenalty;
              //console.log(`[REGIME_CALC] 😴 ADX reduces confidence: -${(adxPenalty * 100).toFixed(1)}% (ADX: ${adx.toFixed(2)})`);
          }
      }

      // MACD contribution
      if (macd && macd.macd !== undefined && macd.signal !== undefined) {
          const macdStrength = Math.abs(macd.macd - macd.signal);
          const macdConfidence = Math.min(0.15, macdStrength * 10);
          confidence += macdConfidence;
          //console.log(`[REGIME_CALC] 📈 MACD adds confidence: +${(macdConfidence * 100).toFixed(1)}% (strength: ${macdStrength.toFixed(4)})`);
      }

      // RSI extremes add confidence for trending regimes
      if (rsi !== undefined && (regime === 'uptrend' || regime === 'downtrend')) {
          if ((regime === 'uptrend' && rsi > 60) || (regime === 'downtrend' && rsi < 40)) {
              const rsiConfidence = Math.min(0.1, Math.abs(rsi - 50) / 500);
              confidence += rsiConfidence;
              //console.log(`[REGIME_CALC] 🎯 RSI supports regime: +${(rsiConfidence * 100).toFixed(1)}% (RSI: ${rsi.toFixed(2)})`);
          }
      }

      // Bollinger Band Width
      if (bbw !== undefined) {
          if (regime === 'ranging' && bbw < 0.03) {
              const bbwConfidence = Math.min(0.1, (0.03 - bbw) * 2);
              confidence += bbwConfidence;
              //console.log(`[REGIME_CALC] 🤏 Low BBW supports ranging: +${(bbwConfidence * 100).toFixed(1)}% (BBW: ${bbw.toFixed(4)})`);
          } else if ((regime === 'uptrend' || regime === 'downtrend') && bbw > 0.04) {
              const bbwConfidence = Math.min(0.1, bbw * 2);
              confidence += bbwConfidence;
              //console.log(`[REGIME_CALC] 🌪️ High BBW supports trending: +${(bbwConfidence * 100).toFixed(1)}% (BBW: ${bbw.toFixed(4)})`);
          }
      }

      // Ensure confidence stays within bounds
      confidence = Math.max(0.1, Math.min(1.0, confidence));
      
      //console.log(`[REGIME_CALC] 🎯 Final confidence: ${(confidence * 100).toFixed(1)}%`);
      
      return confidence;
  }
  
  _getDefaultSignalSettings() {
    return [
        { type: 'atr', enabled: true, period: 14 },
        { type: 'bollinger', enabled: true, period: 20, stdDev: 2 },
        { type: 'bbw', enabled: true, period: 20, stdDev: 2 },
        { type: 'ema', enabled: true, period: 50 },
        { type: 'sma', enabled: true, period: 200 }, // For MA200
        { type: 'adx', enabled: true, period: 14 },
        { type: 'macd', enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        { type: 'rsi', enabled: true, period: 14 },
        { type: 'obv', enabled: true },
        { type: 'volume_sma', enabled: true, period: 20 },
        { type: 'volume_roc', enabled: true, period: 14 },
    ];
  }

  getRegime() { // Removed index parameter as per outline. Operates on latest candle.
    //console.log(`[REGIME_MAIN] 🚀 Starting complete regime analysis...`);
    const targetIndex = this.klines.length - 1; // Always operate on the latest candle

    try {
        const regime = this._detectRegime();
        const confidence = this._calculateConfidence(regime); // This confidence is 0-1, will be converted to 0-100 for storage/return

        // Update regime history (adapting existing logic)
        this.regimeHistory.push({
            index: targetIndex,
            regime: regime,
            confidence: confidence * 100, // Convert to 0-100 for consistency with existing confirmation logic
            timestamp: this.klines[targetIndex]?.timestamp || Date.now()
        });

        // Trim history
        if (this.regimeHistory.length > this.maxHistoryLength) {
            this.regimeHistory = this.regimeHistory.slice(-this.maxHistoryLength);
        }

        // Streak logic (adapting existing logic)
        const currentRegimeFromDetection = regime;
        if (this.lastRegimeDetected === currentRegimeFromDetection) {
            this.consecutivePeriods++;
        } else {
            if (this.__devDebug && this.lastRegimeDetected) {
                console.log(`[REGIME_CHANGE] ${this.lastRegimeDetected?.toUpperCase() || 'UNKNOWN'} → ${currentRegimeFromDetection.toUpperCase()} (streak broken, was ${this.consecutivePeriods} periods)`);
            }
            this.consecutivePeriods = 1;
            this.lastRegimeDetected = currentRegimeFromDetection;
        }
        if (this.__devDebug) {
            //console.log(`[REGIME_STREAK] Current ${currentRegimeFromDetection.toUpperCase()} streak: ${this.consecutivePeriods} periods`);
        }

        // Determine confirmed regime (existing _determineConfirmedRegime method)
        const confirmationResult = this._determineConfirmedRegime();

        // Debug logging for confirmation (adapting existing __devDebug logic)
        if (this.__devDebug) {
            const confirmationThreshold = this.confirmationRequired;
            const currentCandleIsConfirmed = this.consecutivePeriods >= confirmationThreshold;
            const remainingForCurrentCandle = Math.max(0, confirmationThreshold - this.consecutivePeriods);

            //console.log(`[REGIME_DETECTION] Raw regime: ${currentRegimeFromDetection?.toUpperCase()}, Confidence: ${(confidence * 100).toFixed(1)}%`);
            //console.log(`[REGIME_CONFIRMATION] Consecutive periods: ${this.consecutivePeriods}/${confirmationThreshold}, Status: ${currentCandleIsConfirmed ? 'CONFIRMED' : 'DEVELOPING'}`);
            
            if (this.regimeHistory.length > 1) {
                const recent = this.regimeHistory.slice(-5).map(r => r.regime).join(' → ');
                //console.log(`[REGIME_HISTORY] Last 5 periods: ${recent}`);
            }

            if (currentCandleIsConfirmed) {
                //console.log(`[REGIME_CONFIRMED] ✅ ${currentRegimeFromDetection.toUpperCase()} confirmed after ${this.consecutivePeriods} consecutive periods`);
            } else {
                //console.log(`[REGIME_DEVELOPING] ⏳ ${currentRegimeFromDetection.toUpperCase()} developing... need ${remainingForCurrentCandle} more periods for confirmation`);
            }
        }
        
        /*console.log(`[REGIME_MAIN] 🎯 Complete regime analysis result:`, {
            regime: confirmationResult.regime?.toUpperCase(),
            confidence: `${confirmationResult.confidence?.toFixed(1)}%`, // confidence is 0-100 from _determineConfirmedRegime
            isConfirmed: confirmationResult.isConfirmed,
            consecutivePeriods: confirmationResult.streakCount,
            confirmationThreshold: this.confirmationRequired
        });*/

        return {
            regime: confirmationResult.regime,
            confidence: confirmationResult.confidence, // This is already 0-100 from _determineConfirmedRegime
            confidencePct: confirmationResult.confidence, // For compatibility
            isConfirmed: confirmationResult.isConfirmed,
            consecutivePeriods: confirmationResult.streakCount,
            confirmationThreshold: this.confirmationRequired,
            regimeHistory: this.regimeHistory.slice(-5) // Last 5 for debugging
        };
    } catch (error) {
        console.error(`[REGIME_MAIN] ❌ Failed to detect regime:`, error);
        this.addLog(`[REGIME_ERROR] Failed to detect regime: ${error.message}`, 'error'); // Using addLog here
        return {
            regime: 'neutral',
            confidence: 50, // Default to 50 for 0-100 scale
            confidencePct: 50,
            isConfirmed: false,
            consecutivePeriods: 0,
            confirmationThreshold: this.confirmationRequired,
            regimeHistory: []
        };
    }
  }

  // _determineConfirmedRegime method and related logic are retained
  _determineConfirmedRegime() {
    const N = this.confirmationRequired || 5;
    const len = this.regimeHistory.length;

    // Compute current streak from the end (consecutive same-regime candles)
    let streakCount = 0;
    let streakRegime = null;
    const streakIndices = [];
    if (len > 0) {
      streakRegime = this.regimeHistory[len - 1].regime;
      for (let k = len - 1; k >= 0; k--) {
        const r = this.regimeHistory[k];
        if (r.regime === streakRegime) {
          streakCount++;
          streakIndices.push(r.index ?? k);
        } else {
          break;
        }
      }
    }

    if (this.__devDebug) {
      try {
        /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] Streak', {
          streakRegime,
          streakCount,
          needed: N,
          lastIndex: this.regimeHistory[len - 1]?.index ?? (len - 1),
          indices: streakIndices.slice(0, N)
        });*/
      } catch (_) {}
    }

    const window = this.regimeHistory.slice(-N);
    const windowPayload = window.map(r => ({
      idx: r.index,
      regime: r.regime,
      confidencePct: typeof r.confidence === 'number' ? Number(r.confidence.toFixed(2)) : r.confidence
    }));

    if (this.__devDebug) {
      try {
        /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] Recent window', {
          size: window.length,
          required: N,
          window: windowPayload
        });*/
      } catch (_) {}
    }

    // Not enough history yet: pass through latest (UNCAPPED – cap removed previously)
    if (len < N) {
      const latestRegime = this.regimeHistory[len - 1];
      if (latestRegime) {
        if (this.__devDebug) {
          try {
            /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] Unconfirmed (insufficient history)', {
              regime: latestRegime.regime,
              confidencePct: typeof latestRegime.confidence === 'number' ? Number(latestRegime.confidence.toFixed(2)) : latestRegime.confidence,
              historyLen: len,
              needed: N
            });*/
          } catch (_) {}
        }
        return {
          regime: latestRegime.regime,
          confidence: latestRegime.confidence, // previously capped: Math.min(latestRegime.confidence, 60)
          isConfirmed: false,
          streakCount: streakCount // Return the actual streak count
        };
      } else {
        return { regime: 'Neutral', confidence: 50, isConfirmed: false, streakCount: 0 };
      }
    }

    // Enough history: check for consistency in the last N candles
    const firstRegime = window[0].regime;
    const isConsistent = window.every(r => r.regime === firstRegime);

    if (isConsistent) {
      const averageConfidence = window.reduce((sum, r) => sum + (typeof r.confidence === 'number' ? r.confidence : 0), 0) / window.length;
      const boostedConfidence = Math.min(100, averageConfidence + 10);

      this.confirmedRegime = firstRegime;
      this.confirmedConfidence = boostedConfidence;

      if (this.__devDebug) {
        try {
          /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] CONSISTENT_WINDOW_REACHED', {
            regime: firstRegime,
            averageConfidencePct: Number(averageConfidence.toFixed(2)),
            boostedConfidencePct: Number(boostedConfidence.toFixed(2)),
            window: windowPayload
          });*/
          if (streakCount >= N) {
            /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] 5_CONSECUTIVE_REACHED', {
              regime: firstRegime,
              streakCount,
              indices: streakIndices.slice(0, N)
            });*/
          }
        } catch (_) {}
      }

      return {
        regime: this.confirmedRegime,
        confidence: this.confirmedConfidence,
        isConfirmed: true,
        streakCount: streakCount // Streak count should be N if consistent for the whole window, or the actual longer streak
      };
    } else {
      const counts = window.reduce((acc, r) => {
        acc[r.regime] = (acc[r.regime] || 0) + 1;
        return acc;
      }, {});
      const latest = this.regimeHistory[len - 1];

      if (this.__devDebug) {
        try {
          /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] INCONSISTENT_WINDOW', {
            required: N,
            counts,
            latestRegime: latest?.regime,
            latestConfidencePct: typeof latest?.confidence === 'number' ? Number(latest.confidence.toFixed(2)) : latest?.confidence
          });*/
        } catch (_) {}
      }

      return {
        regime: latest?.regime ?? 'Neutral',
        confidence: latest?.confidence ?? 50,
        isConfirmed: false,
        streakCount: streakCount // Return the actual streak count
      };
    }
  }

  // NEW: Expose volatility data (kept this as it was outside of the old regime calc flow)
  getVolatilityData() {
    if (!this.indicators.adx || this.indicators.adx.length === 0 || !this.indicators.bbw || this.indicators.bbw.length === 0) {
        // Return defaults, ensuring ADX is an object matching calculateADX output structure
        return { adx: { ADX: 25, plusDI: null, minusDI: null }, bbw: 0.1 }; 
    }

    const latestAdx = this.indicators.adx[this.indicators.adx.length - 1];
    const latestBbw = this.indicators.bbw[this.indicators.bbw.length - 1];

    return {
        // Ensure consistency with the ADX object structure
        adx: latestAdx && typeof latestAdx === 'object' ? latestAdx : { ADX: 25, plusDI: null, minusDI: null },
        bbw: typeof latestBbw === 'number' ? latestBbw : 0.1
    };
  }
}

// ========== RUNTIME CONF_DEBUG INSTRUMENTATION (safe, non-breaking) ==========
try {
  const CLS = typeof MarketRegimeDetector !== 'undefined' ? MarketRegimeDetector : null;

  if (CLS && !CLS.__confDebugPatched) {
    CLS.__confDebugPatched = true;
    const P = CLS.prototype;

    // Wrap getRegime to log entry and final result (always-on)
    if (typeof P.getRegime === 'function') {
      const __origGetRegime = P.getRegime;
      P.getRegime = function(...args) { // Use ...args to capture potential future index parameter if it's re-added
        try {
          /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] getRegime entered (wrapper)', {
            indexRequested: args[0] ?? -1, // Log args[0] if it exists
            klinesLen: Array.isArray(this?.klines) ? this.klines.length : null
          });*/
        } catch (_) {}

        const res = __origGetRegime.apply(this, args);

        try {
          /*console.log('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] getRegime final (wrapper)', {
            indexResolved: args[0] ?? -1,
            regime: res?.regime,
            confidencePct: typeof res?.confidence === 'number'
              ? Number(res.confidence.toFixed(2))
              : res?.confidence,
            isConfirmed: !!res?.isConfirmed,
            hasDetails: !!res?.details
          });*/
        } catch (_) {}

        return res;
      };
    }
    // _calculateRawRegime, __applyGuardrails, __logUptrendCalc, __logRangingCalc wrappers are removed
    // as these methods are themselves removed or no longer relevant.
  }
} catch (e) {
  console.warn('[components/utils/MarketRegimeDetector.js] [CONF_DEBUG] Patch failed:', e?.message);
}
// ========== END RUNTIME CONF_DEBUG INSTRUMENTATION ==========

export default MarketRegimeDetector;
