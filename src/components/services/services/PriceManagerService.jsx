/**
 * PriceManagerService
 * 
 * Manages price fetching, consolidation, and updates for all trading symbols.
 * This service handles all price-related operations including symbol collection and price data management.
 */

import { getBinancePrices } from '@/api/functions';
import { SCANNER_DEFAULTS } from '../constants/scannerDefaults';

export class PriceManagerService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // Price data storage
        this.currentPrices = {};
    }

    /**
     * Consolidates and fetches prices for all relevant symbols.
     * Collects symbols from strategies, positions, and wallet balances.
     */
    async _consolidatePrices() {
        if (this.scannerService.isHardResetting) return;

        try {
            const allRequiredSymbols = new Set();
            // fiatCurrencies list from outline
            const fiatCurrencies = new Set(['EUR', 'TRY', 'ZAR', 'GBP', 'AUD', 'BRL', 'JPY', 'RUB', 'UAH', 'NGN', 'PLN', 'RON', 'ARS', 'INR', 'CZK', 'MXN', 'COP']);

            // Define minimum thresholds to reduce API calls for dust
            const MIN_BALANCE_THRESHOLD = SCANNER_DEFAULTS.minBalanceThreshold;
            const ESTIMATED_MIN_VALUE_USD = SCANNER_DEFAULTS.estimatedMinValueUSD;

            // 1. Collect symbols from active strategies
            if (this.scannerService.state.activeStrategies && this.scannerService.state.activeStrategies.length > 0) {
                this.scannerService.state.activeStrategies.forEach(strategy => {
                    if (strategy.coin) {
                        allRequiredSymbols.add(strategy.coin.replace('/', '')); // Keep .replace('/', '')
                    }
                });
            }

            // 2. Collect symbols from open positions (using PositionManager as source of truth)
            if (this.scannerService.positionManager.positions && this.scannerService.positionManager.positions.length > 0) {
                this.scannerService.positionManager.positions.forEach(pos => {
                    if (pos.symbol && (pos.status === 'open' || pos.status === 'trailing')) {
                        allRequiredSymbols.add(pos.symbol.replace('/', '')); // Keep .replace('/', '')
                    }
                });
            }

            // 3. Collect symbols from wallet balances (with dust threshold)
            let balancesWithAmountCount = 0; // for logging
            let dustAssetsSkipped = 0;
            const currentWalletState = this.scannerService.walletManagerService?.getCurrentWalletState();
            if (currentWalletState && currentWalletState.balances) {
                currentWalletState.balances.forEach(balance => {
                    // Check if asset is not USDT and not a fiat currency (case-insensitive check)
                    if (balance.asset && balance.asset !== 'USDT' && !fiatCurrencies.has(balance.asset.toUpperCase())) {
                        const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);

                        // Apply dust threshold: skip extremely small balances
                        if (total > MIN_BALANCE_THRESHOLD) {
                            const symbol = balance.asset + 'USDT';
                            allRequiredSymbols.add(symbol);
                            balancesWithAmountCount++;
                        } else if (total > 0) {
                            dustAssetsSkipped++;
                        }
                    }
                });
            }

            // 4. Ensure BTCUSDT is always fetched as a baseline, if not already included.
            allRequiredSymbols.add('BTCUSDT');

            const symbolsArray = Array.from(allRequiredSymbols);

            console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 📊 Preparing to fetch prices for ${symbolsArray.length} symbols.`);
            console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 📊 Symbols to fetch:`, symbolsArray.slice(0, 20), symbolsArray.length > 20 ? `... and ${symbolsArray.length - 20} more` : '');

            if (dustAssetsSkipped > 0) {
                console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 🗑️ Skipped ${dustAssetsSkipped} dust assets (< $${ESTIMATED_MIN_VALUE_USD} estimated).`);
            }

            if (symbolsArray.length === 0) {
                console.warn(`[AutoScannerService] [PRICE_CONSOLIDATION] ⚠️ No symbols required for strategy analysis, positions, or significant wallet balances.`);
                this.currentPrices = {};
                return;
            }

            console.log('[AutoScannerService] [_consolidatePrices] Calling getBinancePrices directly (bypassing queue)...');
            const response = await getBinancePrices({ symbols: symbolsArray });

            // getBinancePrices returns an array, but queueFunctionCall wraps it as { data: [...] }
            let priceArray = null;
            if (Array.isArray(response)) {
                priceArray = response;
            } else if (response && response.data && Array.isArray(response.data)) {
                priceArray = response.data;
            } else if (response && response.success && response.data && Array.isArray(response.data)) {
                priceArray = response.data;
            }

            if (priceArray && Array.isArray(priceArray)) {
                // Convert array of price objects to a map: { symbol: price }
                const pricesMap = {};
                let validPriceCount = 0;

                priceArray.forEach(item => { // Iterate priceArray
                    if (item.symbol && item.price && !item.error) {
                        const price = parseFloat(item.price);
                        if (price > 0) {
                            pricesMap[item.symbol.replace('/', '')] = price; // Keep .replace('/', '')
                            validPriceCount++;
                        }
                    }
                });

                this.currentPrices = pricesMap;
                console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] ✅ Fetched prices for ${Object.keys(this.currentPrices).length} symbols.`);
                console.log(`[AutoScannerService] [PRICE_CONSOLIDATION] 📊 Sample prices:`, Object.entries(pricesMap).slice(0, 10));

                if (validPriceCount < symbolsArray.length) {
                    const missingCount = symbolsArray.length - validPriceCount;
                    const missingSymbols = symbolsArray.filter(symbol => !pricesMap[symbol.replace('/', '')]);
                    console.warn(`[AutoScannerService] [PRICE_CONSOLIDATION] ⚠️ ${missingCount} symbols did not return valid prices:`, missingSymbols.slice(0, 10));
                }
            } else {
                console.error('[AutoScannerService] [PRICE_CONSOLIDATION] ❌ Strategic price fetch failed or returned invalid data. Current prices reset.');
                this.currentPrices = {};
            }

        } catch (error) {
            console.error('[AutoScannerService] ❌ Error consolidating prices:', error);
            console.error(`[AutoScannerService] [PRICE_CONSOLIDATION] ❌ Failed to fetch prices: ${error.message}`, error);
            this.currentPrices = {}; // Clear prices to prevent using stale data
            throw error; // Re-throw to indicate a critical step failed
        }
    }

    /**
     * Updates current prices with new price data.
     * @param {object} pricesData - Price data object with symbol-price mappings.
     */
    _updateCurrentPrices(pricesData) {
        if (pricesData && typeof pricesData === 'object') {
            this.currentPrices = pricesData;
        }
    }

    /**
     * Gets current price for a symbol.
     * @param {string} symbol - Symbol to get price for (e.g., 'BTCUSDT').
     * @returns {number|null} Current price or null if not available.
     */
    getCurrentPrice(symbol) {
        const normalizedSymbol = symbol.replace('/', '');
        return this.currentPrices[normalizedSymbol] || null;
    }

    /**
     * Gets all current prices.
     * @returns {object} Object with symbol-price mappings.
     */
    getAllCurrentPrices() {
        return { ...this.currentPrices };
    }

    /**
     * Checks if price data is available for a symbol.
     * @param {string} symbol - Symbol to check.
     * @returns {boolean} True if price is available, false otherwise.
     */
    hasPrice(symbol) {
        const normalizedSymbol = symbol.replace('/', '');
        return this.currentPrices[normalizedSymbol] !== undefined;
    }

    /**
     * Gets the count of symbols with available prices.
     * @returns {number} Number of symbols with prices.
     */
    getPriceCount() {
        return Object.keys(this.currentPrices).length;
    }

    /**
     * Resets the price manager state.
     */
    resetState() {
        this.currentPrices = {};
        this.addLog('[PriceManagerService] State reset.', 'system');
    }
}

export default PriceManagerService;
