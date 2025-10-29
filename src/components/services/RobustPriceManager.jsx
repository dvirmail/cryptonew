/**
 * Robust Price Manager
 * 
 * A comprehensive solution to fix price data issues, prevent NaN values,
 * and ensure reliable price fetching for position validation.
 */

import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';

class RobustPriceManager {
    constructor() {
        this.priceCache = new Map(); // symbol -> { price, timestamp }
        this.cacheTimeoutMs = 30000; // 30 seconds
        this.maxRetries = 3;
        this.retryDelayMs = 1000;
        this.failedSymbols = new Set(); // Track symbols that consistently fail
    }

    /**
     * Get current price for a symbol with robust error handling
     */
    async getCurrentPrice(symbol, retryCount = 0) {
        const cleanSymbol = symbol.replace('/', '');
        
        // Check cache first
        const cached = this.priceCache.get(cleanSymbol);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeoutMs) {
            return cached.price;
        }
        
        // Skip if symbol has consistently failed
        if (this.failedSymbols.has(cleanSymbol)) {
            console.log(`[RobustPriceManager] ⏭️ Skipping failed symbol: ${cleanSymbol}`);
            return null;
        }
        
        try {
            console.log(`[RobustPriceManager] 🔍 Fetching price for ${cleanSymbol} (attempt ${retryCount + 1})`);
            
            const priceResponse = await fetch(
                `http://localhost:3003/api/binance/ticker/price?symbol=${cleanSymbol}&tradingMode=testnet`
            );
            
            if (!priceResponse.ok) {
                throw new Error(`HTTP ${priceResponse.status}: ${priceResponse.statusText}`);
            }
            
            const priceData = await priceResponse.json();
            
            if (!priceData?.success || !priceData?.data) {
                throw new Error('Invalid price response');
            }
            
            const price = parseFloat(priceData.data.price);
            
            if (isNaN(price) || price <= 0) {
                throw new Error(`Invalid price value: ${priceData.data.price}`);
            }
            
            // Cache the valid price
            this.priceCache.set(cleanSymbol, {
                price: price,
                timestamp: Date.now()
            });
            
            console.log(`[RobustPriceManager] ✅ Got price for ${cleanSymbol}: $${price}`);
            return price;
            
        } catch (error) {
            console.error(`[RobustPriceManager] ❌ Failed to get price for ${cleanSymbol}:`, error.message);
            
            if (retryCount < this.maxRetries) {
                console.log(`[RobustPriceManager] 🔄 Retrying ${cleanSymbol} in ${this.retryDelayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
                return await this.getCurrentPrice(symbol, retryCount + 1);
            } else {
                // Mark symbol as failed after max retries
                this.failedSymbols.add(cleanSymbol);
                console.log(`[RobustPriceManager] ⚠️ Marked ${cleanSymbol} as failed after ${this.maxRetries} attempts`);
                return null;
            }
        }
    }

    /**
     * Get prices for multiple symbols efficiently
     */
    async getCurrentPrices(symbols) {
        const prices = {};
        const promises = [];
        
        for (const symbol of symbols) {
            promises.push(
                this.getCurrentPrice(symbol).then(price => ({
                    symbol: symbol.replace('/', ''),
                    price: price
                })).catch(error => ({
                    symbol: symbol.replace('/', ''),
                    price: null,
                    error: error.message
                }))
            );
        }
        
        const results = await Promise.all(promises);
        
        for (const result of results) {
            if (result.price !== null) {
                prices[result.symbol] = result.price;
            }
        }
        
        console.log(`[RobustPriceManager] 📊 Fetched ${Object.keys(prices).length}/${symbols.length} prices`);
        return prices;
    }

    /**
     * Update prices for all open positions
     */
    async updatePositionPrices(positions) {
        if (!positions || positions.length === 0) {
            console.log('[RobustPriceManager] ⏭️ No positions to update prices for');
            return {};
        }
        
        const symbols = [...new Set(positions.map(p => p.symbol))];
        console.log(`[RobustPriceManager] 🔄 Updating prices for ${symbols.length} symbols`);
        
        const prices = await this.getCurrentPrices(symbols);
        
        // Update positions with current prices
        const updatedPositions = [];
        for (const position of positions) {
            const cleanSymbol = position.symbol.replace('/', '');
            const currentPrice = prices[cleanSymbol];
            
            if (currentPrice !== null && currentPrice > 0) {
                const updatedPosition = {
                    ...position,
                    current_price: currentPrice,
                    last_price_update: new Date().toISOString()
                };
                
                updatedPositions.push(updatedPosition);
                
                // Update in database
                try {
                    await queueEntityCall('LivePosition', 'update', position.id, {
                        current_price: currentPrice,
                        last_price_update: new Date().toISOString()
                    });
                } catch (error) {
                    console.error(`[RobustPriceManager] ❌ Failed to update position ${position.id}:`, error);
                }
            } else {
                console.log(`[RobustPriceManager] ⚠️ No valid price for ${position.symbol}`);
            }
        }
        
        console.log(`[RobustPriceManager] ✅ Updated ${updatedPositions.length}/${positions.length} positions with valid prices`);
        return prices;
    }

    /**
     * Validate position prices and fix invalid ones
     */
    async validateAndFixPositionPrices(positions) {
        const invalidPositions = [];
        const validPositions = [];
        
        for (const position of positions) {
            const currentPrice = parseFloat(position.current_price || 0);
            const entryPrice = parseFloat(position.entry_price || 0);
            
            if (isNaN(currentPrice) || currentPrice <= 0) {
                invalidPositions.push(position);
            } else if (isNaN(entryPrice) || entryPrice <= 0) {
                invalidPositions.push(position);
            } else {
                validPositions.push(position);
            }
        }
        
        console.log(`[RobustPriceManager] 🔍 Found ${invalidPositions.length} positions with invalid prices`);
        
        if (invalidPositions.length > 0) {
            console.log(`[RobustPriceManager] 🔄 Attempting to fix ${invalidPositions.length} invalid positions`);
            
            const fixedPrices = await this.updatePositionPrices(invalidPositions);
            
            // Re-validate after fixing
            const stillInvalid = [];
            for (const position of invalidPositions) {
                const cleanSymbol = position.symbol.replace('/', '');
                const fixedPrice = fixedPrices[cleanSymbol];
                
                if (fixedPrice && fixedPrice > 0) {
                    validPositions.push({
                        ...position,
                        current_price: fixedPrice,
                        last_price_update: new Date().toISOString()
                    });
                } else {
                    stillInvalid.push(position);
                }
            }
            
            console.log(`[RobustPriceManager] ✅ Fixed ${invalidPositions.length - stillInvalid.length} positions`);
            
            if (stillInvalid.length > 0) {
                console.log(`[RobustPriceManager] ⚠️ ${stillInvalid.length} positions still have invalid prices`);
            }
        }
        
        return {
            validPositions,
            invalidPositions: positions.filter(p => {
                const currentPrice = parseFloat(p.current_price || 0);
                return isNaN(currentPrice) || currentPrice <= 0;
            })
        };
    }

    /**
     * Extract price from API response
     */
    extractPriceResponse(apiResponse) {
        if (apiResponse?.data) {
            if (apiResponse.data.success && apiResponse.data.data) {
                if (apiResponse.data.data.success && apiResponse.data.data.data) {
                    return apiResponse.data.data.data;
                }
                return apiResponse.data.data;
            }
            return apiResponse.data;
        }
        return apiResponse;
    }

    /**
     * Clear failed symbols cache (for retry after some time)
     */
    clearFailedSymbols() {
        this.failedSymbols.clear();
        console.log('[RobustPriceManager] 🔄 Cleared failed symbols cache');
    }

    /**
     * Clear price cache
     */
    clearCache() {
        this.priceCache.clear();
        console.log('[RobustPriceManager] 🔄 Cleared price cache');
    }

    /**
     * Get cache status
     */
    getCacheStatus() {
        return {
            cacheSize: this.priceCache.size,
            failedSymbols: Array.from(this.failedSymbols),
            cacheTimeoutMs: this.cacheTimeoutMs
        };
    }
}

// Export singleton instance
export const robustPriceManager = new RobustPriceManager();
export default robustPriceManager;
