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
        if (this.scannerService.isHardResetting) {
            return;
        }

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

            // 2. Collect symbols from open positions (check both PositionManager and CentralWalletStateManager)
            // CRITICAL: Check both sources to ensure we don't miss any positions
            const positionSources = [];
            
            // Source 1: PositionManager (primary source)
            if (this.scannerService.positionManager.positions && this.scannerService.positionManager.positions.length > 0) {
                positionSources.push(...this.scannerService.positionManager.positions);
            }
            
            // Source 2: CentralWalletStateManager (fallback to catch positions that might not be in PositionManager yet)
            const walletManager = this.scannerService.walletManagerService;
            if (walletManager?.centralWalletStateManager?.currentState?.positions) {
                const centralPositions = walletManager.centralWalletStateManager.currentState.positions;
                if (Array.isArray(centralPositions) && centralPositions.length > 0) {
                    // Only add positions that aren't already in PositionManager
                    const positionManagerIds = new Set(
                        (this.scannerService.positionManager.positions || []).map(p => p.id || p.position_id)
                    );
                    centralPositions.forEach(pos => {
                        const posId = pos.id || pos.position_id;
                        if (!positionManagerIds.has(posId)) {
                            positionSources.push(pos);
                        }
                    });
                }
            }
            
            // Process all positions from both sources
            if (positionSources.length > 0) {
                const positionManagerCount = (this.scannerService.positionManager.positions || []).length;
                const centralStateCount = walletManager?.centralWalletStateManager?.currentState?.positions?.length || 0;
                const uniquePositionCount = positionSources.length;
                
                positionSources.forEach(pos => {
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

            // 5. Filter out known invalid/unavailable symbols (especially on testnet)
            const unavailableSymbols = new Set([
                // Fiat currencies (not traded as spot pairs on Binance)
                'MXNUSDT', 'COPUSDT', 'CZKUSDT', 'ARSUSDT', 'BRLUSDT', 
                'TRYUSDT', 'EURUSDT', 'GBPUSDT', 'JPYUSDT', 'AUDUSDT', 'CADUSDT',
                'CHFUSDT', 'SEKUSDT', 'NOKUSDT', 'DKKUSDT', 'PLNUSDT', 'HUFUSDT',
                'RUBUSDT', 'INRUSDT', 'KRWUSDT', 'CNYUSDT', 'HKDUSDT', 'SGDUSDT',
                'TWDUSDT', 'THBUSDT', 'VNDUSDT', 'IDRUSDT', 'MYRUSDT', 'PHPUSDT',
                'ZARUSDT', 'UAHUSDT', 'RONUSDT', 'NGNUSDT',
                // Delisted or invalid symbols (especially on testnet)
                'DAIUSDT', 'MATICUSDT', 'EOSUSDT', 'RNDRUSDT', 'MKRUSDT'
            ]);
            
            // Filter out unavailable symbols
            const filteredSymbols = Array.from(allRequiredSymbols).filter(symbol => !unavailableSymbols.has(symbol));

            if (filteredSymbols.length === 0) {
                this.currentPrices = {};
                // Also clear scannerService.currentPrices
                if (this.scannerService) {
                    this.scannerService.currentPrices = {};
                }
                return;
            }

            const response = await getBinancePrices({ symbols: filteredSymbols });

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
                
                // CRITICAL: Also sync prices to scannerService.currentPrices so Wallet component and other services can access them
                if (this.scannerService) {
                    this.scannerService.currentPrices = { ...pricesMap };
                }
            } else {
                this.currentPrices = {};
                // Also clear scannerService.currentPrices
                if (this.scannerService) {
                    this.scannerService.currentPrices = {};
                }
            }

        } catch (error) {
            console.error('[PriceManagerService] ❌ Error consolidating prices:', error);
            this.currentPrices = {}; // Clear prices to prevent using stale data
            // Also clear scannerService.currentPrices
            if (this.scannerService) {
                this.scannerService.currentPrices = {};
            }
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
            // Also sync to scannerService.currentPrices
            if (this.scannerService) {
                this.scannerService.currentPrices = { ...pricesData };
            }
        }
    }

    /**
     * Gets current price for a symbol.
     * @param {string} symbol - Symbol to get price for (e.g., 'BTCUSDT').
     * @returns {number|null} Current price or null if not available.
     */
    async getCurrentPrice(symbol) {
        const normalizedSymbol = symbol.replace('/', '');
        
        // Check cache first
        if (this.currentPrices[normalizedSymbol]) {
            return this.currentPrices[normalizedSymbol];
        }
        
        // FALLBACK: Fetch on-demand if not in cache
        // CRITICAL: getBinancePrices() now uses current price (not stale lastPrice), so this is safe
        try {
            const { getBinancePrices } = await import('@/api/functions');
            const response = await getBinancePrices({ symbols: [normalizedSymbol] });
            
            let priceArray = null;
            if (Array.isArray(response)) {
                priceArray = response;
            } else if (response?.data && Array.isArray(response.data)) {
                priceArray = response.data;
            } else if (response?.success && response.data && Array.isArray(response.data)) {
                priceArray = response.data;
            }
            
            if (priceArray && priceArray.length > 0) {
                const item = priceArray.find(p => p.symbol === normalizedSymbol || p.symbol === symbol);
                if (item && item.price && !item.error) {
                    const price = parseFloat(item.price);
                    if (price > 0) {
                        // Update cache with current price (not stale lastPrice)
                        this.currentPrices[normalizedSymbol] = price;
                        // Also sync to scannerService.currentPrices
                        if (this.scannerService) {
                            if (!this.scannerService.currentPrices) {
                                this.scannerService.currentPrices = {};
                            }
                            this.scannerService.currentPrices[normalizedSymbol] = price;
                        }
                        return price;
                    }
                }
            }
        } catch (error) {
            console.warn(`[PriceManagerService] ⚠️ Failed to fetch on-demand price for ${symbol}:`, error.message);
        }
        
        return null;
    }

    /**
     * Gets FRESH current price for a symbol, ALWAYS bypassing cache.
     * CRITICAL: Use this method when closing positions to ensure accurate exit prices.
     * ⚡ PERFORMANCE: Now uses batch endpoint through PriceCacheService instead of individual calls.
     * 
     * @param {string} symbol - Symbol to get price for (e.g., 'ETH/USDT' or 'ETHUSDT').
     * @param {string} tradingMode - Trading mode (testnet/mainnet), defaults to scanner's trading mode.
     * @returns {Promise<number|null>} Current price or null if not available.
     */
    async getFreshCurrentPrice(symbol, tradingMode = null) {
        const normalizedSymbol = symbol.replace('/', '');
        const mode = tradingMode || this.scannerService?.state?.tradingMode || 'testnet';
        
        try {
            // ⚡ PERFORMANCE OPTIMIZATION: Use PriceCacheService batch endpoint instead of individual fetch
            // This ensures all price requests are batched together, eliminating individual API calls
            const priceCache = this.scannerService?.priceCacheService;
            if (priceCache && typeof priceCache.getBatchPrices === 'function') {
                const priceMap = await priceCache.getBatchPrices([normalizedSymbol], mode);
                const price = priceMap.get(normalizedSymbol);
                
                if (price && !isNaN(price) && price > 0) {
                    // Validate price ranges
                    const EXPECTED_PRICE_RANGES = {
                        'ETHUSDT': { min: 1500, max: 6000 },
                        'BTCUSDT': { min: 20000, max: 150000 },
                        'SOLUSDT': { min: 50, max: 500 },
                        'BNBUSDT': { min: 150, max: 1000 }
                    };
                    
                    const range = EXPECTED_PRICE_RANGES[normalizedSymbol];
                    if (range && (price < range.min || price > range.max)) {
                        console.error(`[PriceManagerService] ❌ CRITICAL: Price ${price} for ${symbol} is outside expected range [${range.min}, ${range.max}]`);
                        throw new Error(`Price ${price} for ${symbol} is outside expected range [${range.min}, ${range.max}]`);
                    }
                    
                    // Update cache with fresh price
                    this.currentPrices[normalizedSymbol] = price;
                    // Also sync to scannerService.currentPrices
                    if (this.scannerService) {
                        if (!this.scannerService.currentPrices) {
                            this.scannerService.currentPrices = {};
                        }
                        this.scannerService.currentPrices[normalizedSymbol] = price;
                    }
                    return price;
                }
            }
            
            // Fallback: If PriceCacheService not available, use individual endpoint (should rarely happen)
            console.warn(`[PriceManagerService] ⚠️ PriceCacheService not available, using individual fetch for ${symbol}`);
            const proxyUrl = 'http://localhost:3003';
            const endpoint = `${proxyUrl}/api/binance/ticker/price?symbol=${normalizedSymbol}&tradingMode=${mode}`;
            
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success || !data.data || !data.data.price) {
                console.error(`[PriceManagerService] ❌ Invalid price response structure for ${symbol}:`, data);
                throw new Error(`Invalid price response for ${symbol}`);
            }
            
            const price = parseFloat(data.data.price);
            if (isNaN(price) || price <= 0) {
                console.error(`[PriceManagerService] ❌ Invalid price value for ${symbol}: ${data.data.price}`);
                throw new Error(`Invalid price value: ${data.data.price}`);
            }
            
            // Update cache with fresh price
            this.currentPrices[normalizedSymbol] = price;
            // Also sync to scannerService.currentPrices
            if (this.scannerService) {
                if (!this.scannerService.currentPrices) {
                    this.scannerService.currentPrices = {};
                }
                this.scannerService.currentPrices[normalizedSymbol] = price;
            }
            return price;
            
        } catch (error) {
            console.error(`[PriceManagerService] ❌ Failed to fetch fresh price for ${symbol}:`, error.message);
            return null;
        }
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
        // Also clear scannerService.currentPrices
        if (this.scannerService) {
            this.scannerService.currentPrices = {};
        }
        this.addLog('[PriceManagerService] State reset.', 'system');
    }
}

export default PriceManagerService;
