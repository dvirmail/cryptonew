/**
 * Robust Reconcile Service
 * 
 * A smart and robust solution to properly identify and remove ghost positions.
 * This service implements intelligent logic to distinguish between real positions
 * and ghost positions, preventing infinite loops and false positives.
 */

import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';

class RobustReconcileService {
    constructor() {
        this.lastReconcileTime = 0;
        this.reconcileThrottleMs = 300000; // 5 minutes minimum between reconciles (increased from 30s)
        this.ghostDetectionThreshold = 0.95; // 95% threshold for ghost detection
        this.maxReconcileAttempts = 20; // Increased from 10 to allow more attempts over longer period
        this.reconcileAttempts = new Map(); // Track attempts per wallet
    }

    /**
     * Main reconcile function with intelligent ghost detection
     * @param {string} tradingMode - Trading mode (testnet/live)
     * @param {string} walletId - Wallet ID to reconcile
     * @returns {Promise<Object>} Reconciliation result
     */
    async reconcileWithBinance(tradingMode, walletId) {
        const now = Date.now();
        const walletKey = `${tradingMode}_${walletId}`;
        
        // Throttle reconciliation calls
        if (now - this.lastReconcileTime < this.reconcileThrottleMs) {
            // console.log(`[RobustReconcile] ⏳ Throttled - last reconcile was ${Math.round((now - this.lastReconcileTime) / 1000)}s ago`);
            return { success: true, throttled: true, reason: 'Throttled' };
        }

        // Check if we've exceeded max attempts for this wallet
        const attempts = this.reconcileAttempts.get(walletKey) || 0;
        if (attempts >= this.maxReconcileAttempts) {
            console.log(`[RobustReconcile] ⚠️ Max attempts (${this.maxReconcileAttempts}) reached for wallet ${walletKey}`);
            return { success: false, error: 'Max attempts exceeded', attempts };
        }

        this.lastReconcileTime = now;
        this.reconcileAttempts.set(walletKey, attempts + 1);

        try {
            
            // Step 1: Get Binance account info
            const binanceData = await this._fetchBinanceAccountInfo(tradingMode);
            if (!binanceData.success) {
                throw new Error(`Failed to fetch Binance data: ${binanceData.error}`);
            }

            // Step 2: Get database positions
            const dbPositions = await this._fetchDatabasePositions(tradingMode, walletId);
            if (!dbPositions.success) {
                throw new Error(`Failed to fetch database positions: ${dbPositions.error}`);
            }

            // Step 3: Analyze positions with smart logic
            const analysis = await this._analyzePositions(dbPositions.data, binanceData.data);
            
            // Step 4: Clean ghost positions
            const cleanupResult = await this._cleanGhostPositions(analysis.ghostPositions);
            
            // Step 5: Update reconciliation attempts
            // Reset attempts on successful reconciliation (even if no ghosts cleaned, it was successful)
            this.reconcileAttempts.set(walletKey, 0);

            const result = {
                success: true,
                summary: {
                    totalPositions: dbPositions.data.length,
                    ghostPositionsDetected: analysis.ghostPositions.length,
                    ghostPositionsCleaned: cleanupResult.cleanedCount,
                    legitimatePositions: analysis.legitimatePositions.length,
                    errors: cleanupResult.errors
                },
                details: {
                    ghostPositions: analysis.ghostPositions,
                    legitimatePositions: analysis.legitimatePositions,
                    binanceHoldings: binanceData.data.holdings
                }
            };

            return result;

        } catch (error) {
            console.error(`[RobustReconcile] ❌ Reconciliation failed:`, error);
            
            const currentAttempts = this.reconcileAttempts.get(walletKey) || 0;
            
            // If we're getting close to max attempts, auto-reset after a delay to prevent permanent lockout
            if (currentAttempts >= this.maxReconcileAttempts - 2) {
                console.log(`[RobustReconcile] ⚠️ High attempt count (${currentAttempts}/${this.maxReconcileAttempts}). Will auto-reset after cooldown.`);
            }
            
            return {
                success: false,
                error: error.message,
                attempts: currentAttempts
            };
        }
    }

    /**
     * Fetch Binance account information
     */
    async _fetchBinanceAccountInfo(tradingMode) {
        try {
            const proxyUrl = 'http://localhost:3003';
            
            const accountResponse = await queueFunctionCall(
                'liveTradingAPI',
                liveTradingAPI,
                { action: 'getAccountInfo', tradingMode, proxyUrl },
                'critical',
                null,
                0,
                120000
            );

            // Extract Binance response
            const accountInfo = this._extractBinanceResponse(accountResponse);
            
            if (!accountInfo?.balances) {
                throw new Error('Invalid Binance response structure');
            }

            // Create holdings map
            const holdings = new Map();
            accountInfo.balances.forEach(balance => {
                const total = parseFloat(balance.free || '0') + parseFloat(balance.locked || '0');
                if (total > 0 && balance.asset !== 'USDT') {
                    holdings.set(balance.asset, {
                        free: parseFloat(balance.free || '0'),
                        locked: parseFloat(balance.locked || '0'),
                        total: total
                    });
                }
            });

            return {
                success: true,
                data: {
                    holdings,
                    usdtBalance: this._getUSDTBalance(accountInfo.balances),
                    rawBalances: accountInfo.balances
                }
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Fetch positions from database
     */
    async _fetchDatabasePositions(tradingMode, walletId) {
        try {
            const positions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: tradingMode,
                status: ['open', 'trailing']
            });

            return {
                success: true,
                data: positions || []
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Analyze positions with intelligent ghost detection
     */
    async _analyzePositions(dbPositions, binanceData) {
        const ghostPositions = [];
        const legitimatePositions = [];
        const analysisLog = [];

        for (const position of dbPositions) {
            const analysis = await this._analyzeSinglePosition(position, binanceData);
            analysisLog.push(analysis);

            if (analysis.isGhost) {
                ghostPositions.push({
                    ...position,
                    ghostReason: analysis.reason,
                    analysis: analysis
                });
            } else {
                legitimatePositions.push({
                    ...position,
                    analysis: analysis
                });
            }
        }

        
        return {
            ghostPositions,
            legitimatePositions,
            analysisLog
        };
    }

    /**
     * Analyze a single position for ghost detection
     */
    async _analyzeSinglePosition(position, binanceData) {
        const baseAsset = this._extractBaseAsset(position.symbol);
        const binanceHolding = binanceData.holdings.get(baseAsset);
        const expectedQuantity = parseFloat(position.quantity_crypto || 0);
        const heldQuantity = binanceHolding?.total || 0;

        // Analysis factors
        const factors = {
            quantityMatch: this._checkQuantityMatch(expectedQuantity, heldQuantity),
            positionAge: this._checkPositionAge(position),
            priceValidity: this._checkPriceValidity(position),
            tradeHistory: await this._checkTradeHistory(position),
            binanceOrderHistory: await this._checkBinanceOrderHistory(position, binanceData)
        };

        // Determine if position is a ghost
        const isGhost = this._determineGhostStatus(factors, position);
        const reason = this._getGhostReason(factors, isGhost);

        return {
            positionId: position.id,
            symbol: position.symbol,
            expectedQuantity,
            heldQuantity,
            isGhost,
            reason,
            factors,
            confidence: this._calculateConfidence(factors)
        };
    }

    /**
     * Check if quantity matches between expected and held
     */
    _checkQuantityMatch(expected, held) {
        if (expected === 0) return { match: false, reason: 'Zero expected quantity' };
        if (held === 0) return { match: false, reason: 'No holdings on Binance' };
        
        const ratio = held / expected;
        const threshold = this.ghostDetectionThreshold;
        
        if (ratio >= threshold) {
            return { match: true, ratio, reason: 'Quantity matches within threshold' };
        } else {
            return { match: false, ratio, reason: `Quantity mismatch: ${(ratio * 100).toFixed(1)}% of expected` };
        }
    }

    /**
     * Check position age
     */
    _checkPositionAge(position) {
        const entryTime = new Date(position.entry_timestamp).getTime();
        const now = Date.now();
        const ageHours = (now - entryTime) / (1000 * 60 * 60);
        
        return {
            ageHours,
            isOld: ageHours > 24,
            reason: ageHours > 24 ? 'Position older than 24 hours' : 'Recent position'
        };
    }

    /**
     * Check if position prices are valid
     */
    _checkPriceValidity(position) {
        const entryPrice = parseFloat(position.entry_price || 0);
        const currentPrice = parseFloat(position.current_price || 0);
        
        // For very new positions (less than 5 minutes), be more lenient
        const positionAge = this._checkPositionAge(position);
        const isVeryNew = positionAge.ageHours < (5 / 60); // Less than 5 minutes
        
        // If position is very new and has valid entry price, consider it valid even without current_price
        const hasValidPrices = entryPrice > 0 && (currentPrice > 0 || isVeryNew);
        
        return {
            hasValidPrices,
            entryPrice,
            currentPrice,
            isVeryNew,
            reason: hasValidPrices ? 'Valid prices' : 'Invalid or missing prices'
        };
    }

    /**
     * Check trade history for this position
     */
    async _checkTradeHistory(position) {
        try {
            const trades = await queueEntityCall('Trade', 'filter', {
                trade_id: position.position_id,
                trading_mode: position.trading_mode
            });

            return {
                hasTrades: trades && trades.length > 0,
                tradeCount: trades?.length || 0,
                reason: trades && trades.length > 0 ? 'Has trade history' : 'No trade history found'
            };
        } catch (error) {
            return {
                hasTrades: false,
                tradeCount: 0,
                reason: `Error checking trade history: ${error.message}`
            };
        }
    }

    /**
     * Check Binance order history (placeholder for future implementation)
     */
    async _checkBinanceOrderHistory(position, binanceData) {
        // This would require additional Binance API calls to check order history
        // For now, return a neutral result
        return {
            hasOrders: 'unknown',
            reason: 'Binance order history check not implemented'
        };
    }

    /**
     * Determine if position is a ghost based on analysis factors
     */
    _determineGhostStatus(factors, position) {
        // High confidence ghost indicators
        if (!factors.quantityMatch.match && factors.quantityMatch.ratio < 0.1) {
            return true; // Less than 10% of expected quantity held
        }

        if (!factors.priceValidity.hasValidPrices) {
            return true; // Invalid prices suggest data corruption
        }

        // Medium confidence ghost indicators
        if (!factors.quantityMatch.match && !factors.tradeHistory.hasTrades && factors.positionAge.isOld) {
            return true; // No trades, old position, quantity mismatch
        }

        // Low confidence - keep as legitimate
        return false;
    }

    /**
     * Get reason for ghost classification
     */
    _getGhostReason(factors, isGhost) {
        if (!isGhost) return 'Legitimate position';

        if (!factors.quantityMatch.match && factors.quantityMatch.ratio < 0.1) {
            return `Severe quantity mismatch: ${(factors.quantityMatch.ratio * 100).toFixed(1)}% of expected`;
        }

        if (!factors.priceValidity.hasValidPrices) {
            return 'Invalid or missing price data';
        }

        if (!factors.quantityMatch.match && !factors.tradeHistory.hasTrades && factors.positionAge.isOld) {
            return 'Old position with no trade history and quantity mismatch';
        }

        return 'Multiple factors indicate ghost position';
    }

    /**
     * Calculate confidence score for analysis
     */
    _calculateConfidence(factors) {
        let score = 0;
        
        if (factors.quantityMatch.match) score += 40;
        if (factors.priceValidity.hasValidPrices) score += 30;
        if (factors.tradeHistory.hasTrades) score += 20;
        if (!factors.positionAge.isOld) score += 10;
        
        return Math.min(100, score);
    }

    /**
     * Clean ghost positions from database
     */
    async _cleanGhostPositions(ghostPositions) {
        let cleanedCount = 0;
        const errors = [];

        for (const ghost of ghostPositions) {
            try {
                console.log(`[RobustReconcile] 🧹 Cleaning ghost position: ${ghost.symbol} (${ghost.ghostReason})`);
                
                // Delete the position
                await queueEntityCall('LivePosition', 'delete', ghost.id);
                
                cleanedCount++;
                
                // Log the cleanup
                console.log(`[RobustReconcile] ✅ Cleaned ghost position: ${ghost.symbol} (ID: ${ghost.id})`);
                
            } catch (error) {
                console.error(`[RobustReconcile] ❌ Failed to clean ghost position ${ghost.id}:`, error);
                errors.push({
                    positionId: ghost.id,
                    symbol: ghost.symbol,
                    error: error.message
                });
            }
        }

        return { cleanedCount, errors };
    }

    /**
     * Helper methods
     */
    _extractBinanceResponse(apiResponse) {
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

    _getUSDTBalance(balances) {
        const usdtBalance = balances.find(b => b.asset === 'USDT');
        return {
            free: parseFloat(usdtBalance?.free || 0),
            locked: parseFloat(usdtBalance?.locked || 0),
            total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
        };
    }

    _extractBaseAsset(symbol) {
        return symbol.replace('/USDT', '').replace('USDT', '');
    }

    /**
     * Reset reconciliation attempts for a wallet
     */
    resetAttempts(tradingMode, walletId) {
        const walletKey = `${tradingMode}_${walletId}`;
        const oldAttempts = this.reconcileAttempts.get(walletKey) || 0;
        this.reconcileAttempts.delete(walletKey);
        console.log(`[RobustReconcile] 🔄 Reset attempts for wallet ${walletKey} (was ${oldAttempts}/${this.maxReconcileAttempts})`);
    }
    
    /**
     * Auto-reset attempts for all wallets that have exceeded a threshold
     * Call this periodically to prevent permanent lockouts
     */
    autoResetStaleAttempts() {
        const resetThreshold = Math.floor(this.maxReconcileAttempts * 0.8); // Reset at 80% of max
        let resetCount = 0;
        
        for (const [walletKey, attempts] of this.reconcileAttempts.entries()) {
            if (attempts >= resetThreshold) {
                // Only reset if it's been more than 10 minutes since last reconcile
                // This prevents resetting too aggressively
                const timeSinceLastReconcile = Date.now() - this.lastReconcileTime;
                if (timeSinceLastReconcile > 600000) { // 10 minutes
                    this.reconcileAttempts.delete(walletKey);
                    resetCount++;
                    console.log(`[RobustReconcile] 🔄 Auto-reset stale attempts for wallet ${walletKey} (was ${attempts}/${this.maxReconcileAttempts})`);
                }
            }
        }
        
        if (resetCount > 0) {
            console.log(`[RobustReconcile] 🔄 Auto-reset ${resetCount} stale wallet(s)`);
        }
    }

    /**
     * Get reconciliation status
     */
    getStatus() {
        return {
            lastReconcileTime: this.lastReconcileTime,
            throttleMs: this.reconcileThrottleMs,
            attempts: Object.fromEntries(this.reconcileAttempts)
        };
    }
}

// Export singleton instance
export const robustReconcileService = new RobustReconcileService();
export default robustReconcileService;
