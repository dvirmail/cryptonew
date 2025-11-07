/**
 * MarketRegimeService
 * 
 * Manages market regime detection, caching, and Fear & Greed Index fetching.
 * This service handles all market analysis and regime-related operations.
 */

import { queueFunctionCall } from '@/components/utils/apiQueue';
import { getKlineData } from '@/api/functions';
import { getFearAndGreedIndex } from '@/api/functions';
import { calculateAllIndicators } from '@/components/utils/indicatorManager';
import MarketRegimeDetector from '@/components/utils/MarketRegimeDetector';
import { SCANNER_DEFAULTS } from '../constants/scannerDefaults';

export class MarketRegimeService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // Regime cache
        this.regimeCache = {
            regime: null,
            lastCalculated: null,
            cacheValidityHours: SCANNER_DEFAULTS.regimeCacheValidityHours
        };

        // Fear & Greed Index properties
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedFetchInterval = SCANNER_DEFAULTS.fearGreedFetchInterval;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;

        // Initialize with default Fear & Greed data
        this.scannerService.state.fearAndGreedData = {
            value: '50',
            value_classification: 'Neutral',
            timestamp: Date.now().toString(),
            time_until_update: '3600'
        };
    }

    /**
     * Checks if the current regime cache is still valid.
     * @returns {boolean} True if cache is valid, false otherwise.
     */
    _isRegimeCacheValid() {
        if (!this.regimeCache.lastCalculated || !this.regimeCache.regime) {
            return false;
        }

        const cacheAgeMs = Date.now() - this.regimeCache.lastCalculated;
        const cacheValidityMs = this.regimeCache.cacheValidityHours * 60 * 60 * 1000;

        return cacheAgeMs < cacheValidityMs;
    }

    /**
     * Gets cached regime or calculates new one if cache is invalid.
     * @param {boolean} forceCalculate - Force calculation even if cache is valid.
     * @returns {object|null} Regime data or null on error.
     */
    async _getCachedOrCalculateRegime(forceCalculate = false) {
        const isCacheValid = this._isRegimeCacheValid();

        if (!forceCalculate && isCacheValid) {
            const cacheAgeMinutes = Math.round((Date.now() - this.regimeCache.lastCalculated) / (1000 * 60));
            console.log(`[AutoScannerService] [Regime] Using cached regime: ${this.regimeCache.regime.regime.toUpperCase()} (${(this.regimeCache.regime.confidence * 100).toFixed(1)}%) - Cache age: ${cacheAgeMinutes}min`);
            return this.regimeCache.regime;
        }

        console.log('[AutoScannerService] [Regime] Cache invalid or force calculate requested, calculating new regime...');
        await this._updateMarketRegime();
        return this.regimeCache.regime;
    }

    /**
     * Detects market regime and fetches Fear & Greed Index.
     * @returns {object|null} Regime data with confidence or null on failure.
     */
    async _detectMarketRegime() {
        if (this.scannerService.isHardResetting) return null;

        try {
            const cachedRegime = await this._getCachedOrCalculateRegime(); // This updates this.state.marketRegime
            
            // Try to fetch Fear & Greed Index, but don't let failures stop regime detection
            try {
                await this._fetchFearAndGreedIndex(); // This updates this.state.fearAndGreedData
            } catch (fngError) {
                // F&G fetch failed, but regime detection succeeded - log and continue
                console.warn(`[AutoScannerService] [Regime Detection] ⚠️ Failed to fetch Fear & Greed Index, continuing without it: ${fngError.message}`);
            }

            if (this.scannerService.state.marketRegime) {
                return {
                    regime: this.scannerService.state.marketRegime.regime,
                    confidence: Math.max(0, Math.min(100, this.scannerService.state.marketRegime.confidence * 100)) // Return as percentage, clamped
                };
            }
            return null;
        } catch (error) {
            console.error(`[AutoScannerService] [Regime Detection] ❌ Failed to determine market regime: ${error.message}`, error);
            return null;
        }
    }

    /**
     * Fetches Fear & Greed Index with caching and error handling.
     */
    async _fetchFearAndGreedIndex() {
        const now = Date.now();

        if (now - this.lastFearAndGreedFetch < this.fearAndGreedFetchInterval) {
            return;
        }

        this.lastFearAndGreedFetch = now;

        try {
            const response = await getFearAndGreedIndex();

            // Handle response that indicates failure but doesn't throw
            if (!response.success) {
                // Network error or other failure - silently continue
                this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;
                if (this.fearAndGreedFailureCount === 1) {
                    // Only log once to avoid console spam
                    console.warn('[MarketRegimeService] ⚠️ Fear & Greed Index unavailable - continuing without it');
                }
                return; // Don't throw - F&G Index is optional
            }

            if (response.data && response.data.data && response.data.data.length > 0) {
                const fngData = response.data.data[0];
                
                this.fearAndGreedData = fngData;
                this.scannerService.state.fearAndGreedData = fngData; // Update main scanner state

                if (this.fearAndGreedFailureCount > 0) {
                    this.addLog('[F&G Index] ✅ Successfully reconnected to Fear & Greed API', 'success');
                    this.fearAndGreedFailureCount = 0;
                }
                
                // Notify subscribers
                this.scannerService.notifySubscribers();
            } else {
                throw new Error('Invalid response structure from Fear & Greed API');
            }
        } catch (error) {
            // Suppress network errors - they're expected in some environments
            const isNetworkError = error.message?.includes('ERR_SOCKET_NOT_CONNECTED') ||
                                   error.message?.includes('Failed to fetch') ||
                                   error.message?.includes('NetworkError') ||
                                   error.name === 'TypeError';
            
            if (isNetworkError) {
                // Silently continue - F&G Index is optional
                this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;
                if (this.fearAndGreedFailureCount === 1) {
                    console.warn('[MarketRegimeService] ⚠️ Fear & Greed Index network error - continuing without it');
                }
                return; // Don't throw
            }
            
            // For other errors, log but don't throw
            this.fearAndGreedFailureCount = (this.fearAndGreedFailureCount || 0) + 1;
            if (this.fearAndGreedFailureCount === 1) {
                this.addLog('[F&G Index] ⚠️ Unable to fetch Fear & Greed Index - continuing without it', 'warning');
            } else if (this.fearAndGreedFailureCount === 5) {
                this.addLog('[F&G Index] ⚠️ Multiple F&G fetch failures - will retry silently', 'warning');
            }
            // Don't throw - F&G Index is optional
        }
    }

    /**
     * Updates market regime by fetching kline data and calculating indicators.
     */
    async _updateMarketRegime() {
        try {
            const symbol = 'BTCUSDT'; // Use Binance format (no slash)
            const timeframe = '4h';
            const klineLimit = 300;

            // NEW: Direct call to bypass API queue for better batching
            const response = await getKlineData({ symbols: [symbol], interval: timeframe, limit: klineLimit });

            const responseData = response.data;

            if (!responseData || typeof responseData !== 'object') {
                throw new Error('Invalid response data format from getKlineData');
            }

            const symbolData = responseData[symbol];
            if (!symbolData || symbolData.error) {
                throw new Error(`No valid data for ${symbol}: ${symbolData?.error || 'No data'}`);
            }

            const klineDataResponse = symbolData.data;

            if (!Array.isArray(klineDataResponse) || klineDataResponse.length < 50) {
                throw new Error(`Insufficient kline data: ${klineDataResponse?.length || 0} candles`);
            }

            const transformedKlines = klineDataResponse.map((kline, index) => {
                let transformed;
                if (Array.isArray(kline)) {
                    transformed = {
                        timestamp: kline[0],
                        open: parseFloat(kline[1]),
                        high: parseFloat(kline[2]),
                        low: parseFloat(kline[3]),
                        close: parseFloat(kline[4]),
                        volume: parseFloat(kline[5])
                    };
                } else if (kline && typeof kline === 'object') {
                    transformed = {
                        timestamp: kline.timestamp || kline.time || kline.openTime,
                        open: parseFloat(kline.open || kline.o),
                        high: parseFloat(kline.h || kline.high),
                        low: parseFloat(kline.l || kline.low),
                        close: parseFloat(kline.c || kline.close),
                        volume: parseFloat(kline.v || kline.volume)
                    };
                }

                const hasValidData = transformed &&
                    !isNaN(transformed.open) && !isNaN(transformed.high) &&
                    !isNaN(transformed.low) && !isNaN(transformed.close) &&
                    transformed.open > 0 && transformed.high > 0 &&
                    !isNaN(transformed.volume) &&
                    transformed.low > 0 && transformed.close > 0;

                return hasValidData ? transformed : null;
            }).filter(kline => kline !== null);

            if (transformedKlines.length < 50) {
                throw new Error(`Insufficient valid kline data after filtering: ${transformedKlines.length} candles`);
            }

            const coreRegimeSignalSettings = [
                { type: 'adx', enabled: true },
                { type: 'atr', enabled: true, period: 14 },
                { type: 'bbw', enabled: true },
                { type: 'ema', enabled: true },
                { type: 'sma', enabled: true, period: 20 },
                { type: 'ma200', enabled: true },
                { type: 'macd', enabled: true },
                { type: 'rsi', enabled: true },
                { type: 'obv', enabled: true },
                { type: 'volume_sma', enabled: true },
                { type: 'volume_roc', enabled: true }
            ];

            const fullIndicators = calculateAllIndicators(transformedKlines, coreRegimeSignalSettings, this.addLog.bind(this));

            const essentialIndicators = ['atr', 'adx', 'bbw', 'ema'];

            const smaAlternatives = ['sma', 'ma200', 'ma100', 'ma50'];
            const hasSma = smaAlternatives.some(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);

            if (!hasSma) {
                essentialIndicators.push('sma');
            }

            const calculatedIndicatorNames = Object.keys(fullIndicators).filter(key => fullIndicators[key] && Array.isArray(fullIndicators[key]) && fullIndicators[key].length > 0);
            const actuallyMissingIndicators = essentialIndicators.filter(ind => !calculatedIndicatorNames.includes(ind.split(' ')[0]));

            if (actuallyMissingIndicators.length > 0) {
                this.addLog(`[Regime] ⚠️ Missing essential indicators: ${actuallyMissingIndicators.join(', ')}`, 'warning');
            }

            const detector = new MarketRegimeDetector(transformedKlines, fullIndicators, true, this.addLog.bind(this));

            // NEW: seed detector with previously saved streak/history (if available)
            if (this.scannerService.state.marketRegime && (Array.isArray(this.scannerService.state.marketRegime.regimeHistory) || typeof this.scannerService.state.marketRegime.consecutivePeriods === 'number')) {
                detector.restoreState({
                    regimeHistory: Array.isArray(this.scannerService.state.marketRegime.regimeHistory) ? this.scannerService.state.marketRegime.regimeHistory : [],
                    consecutivePeriods: typeof this.scannerService.state.marketRegime.consecutivePeriods === 'number' ? this.scannerService.state.marketRegime.consecutivePeriods : 0,
                    lastRegimeDetected: this.scannerService.state.marketRegime.regime || null
                });
            }

            const regimeResult = detector.getRegime();
            const volatilityData = detector.getVolatilityData();

            // FIXED: Use confidencePct (percentage) instead of confidence (decimal)
            const resolvedConfidencePct = (typeof regimeResult.confidencePct === 'number'
                ? regimeResult.confidencePct
                : (typeof regimeResult.confidence === 'number' ? regimeResult.confidence * 100 : 50));


            this.scannerService.state.marketRegime = {
                regime: regimeResult.regime,
                confidence: Math.max(0, Math.min(1, resolvedConfidencePct / 100)),
                isConfirmed: Boolean(regimeResult.isConfirmed),
                // ADDED: Include confirmation tracking data
                consecutivePeriods: regimeResult.consecutivePeriods || 0,
                confirmationThreshold: regimeResult.confirmationThreshold || 3,
                regimeHistory: regimeResult.regimeHistory || []
            };

            this.scannerService.state.marketVolatility = {
                adx: volatilityData.adx.adx || 25,
                bbw: volatilityData.bbw || 0.1
            };

            // Update cache
            this.regimeCache.regime = this.scannerService.state.marketRegime;
            this.regimeCache.lastCalculated = Date.now();

            // Persist the updated regime state so streak survives reloads
            this.scannerService._saveStateToStorage();

            const userMinimum = this.scannerService.state.settings?.minimumRegimeConfidence || 60;
            const wouldBlock = (this.scannerService.state.marketRegime.confidence * 100) < userMinimum;

            // ADDED: Enhanced regime calculation logging with confirmation details
            const confidenceText = `${(this.scannerService.state.marketRegime.confidence * 100).toFixed(1)}%`;
            const confirmationStatus = this.scannerService.state.marketRegime.isConfirmed ? 'CONFIRMED' : 'DEVELOPING';
            const streakText = `${this.scannerService.state.marketRegime.consecutivePeriods}/${this.scannerService.state.marketRegime.confirmationThreshold}`;

            this.addLog(`[REGIME_CALCULATION] 🎯 ${regimeResult.regime.toUpperCase()} detected with ${confidenceText} confidence`, 'info');
            this.addLog(`[REGIME_CALCULATION] 📊 Status: ${confirmationStatus} (${streakText} consecutive periods)`, 'info');

            if (this.scannerService.state.marketRegime.regimeHistory?.length > 1) {
                const recentHistory = this.scannerService.state.marketRegime.regimeHistory
                    .slice(-4) // Show last 4 periods
                    .map(h => h.regime.toUpperCase())
                    .join(' → ');
                this.addLog(`[REGIME_CALCULATION] 📈 Recent history: ${recentHistory}`, 'info');
            }

            if (wouldBlock) {
                this.addLog(`[REGIME_CALCULATION] ⚠️  BLOCKING: Strategies will be skipped due to low regime confidence`, 'warning');
            } else {
                this.addLog(`[REGIME_CALCULATION] ✅ ALLOWING: Regime confidence meets user threshold`, 'info');
            }

        } catch (error) {
            this.addLog(`[Regime] ❌ Could not update market regime: ${error.message}`, 'error', error);
            this.scannerService.state.marketRegime = {
                regime: 'neutral',
                confidence: 0.5,
                isConfirmed: false,
                consecutivePeriods: 0,
                confirmationThreshold: 3,
                regimeHistory: []
            };
            this.addLog('[Regime] Falling back to NEUTRAL market regime due to error.', 'warning');
            throw error; // Propagate error
        }
    }

    /**
     * Resets the market regime service state.
     */
    resetState() {
        this.regimeCache = {
            regime: null,
            lastCalculated: null,
            cacheValidityHours: SCANNER_DEFAULTS.regimeCacheValidityHours
        };
        this.lastFearAndGreedFetch = 0;
        this.fearAndGreedData = null;
        this.fearAndGreedFailureCount = 0;
        this.addLog('[MarketRegimeService] State reset.', 'system');
    }
}

export default MarketRegimeService;
