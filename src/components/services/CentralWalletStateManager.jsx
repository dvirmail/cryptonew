import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';

/**
 * CentralWalletStateManager - Single Source of Truth for Wallet State
 * 
 * This service manages all wallet-related data in a centralized manner:
 * - Maintains a single CentralWalletState entity per trading mode
 * - Provides real-time updates to all subscribers
 * - Handles data consistency and synchronization
 * - Eliminates data fragmentation issues
 */
class CentralWalletStateManager {
    constructor() {
        this.subscribers = new Set();
        this.currentState = null;
        this.isInitialized = false;
        this.syncInProgress = false;
        
        // Performance optimization: Track last notification to prevent redundant updates
        this.lastNotificationState = null;
        this.notificationTimeout = null;
        
        // Performance monitoring
        this.performanceMetrics = {
            notificationCount: 0,
            skippedNotifications: 0,
            averageNotificationTime: 0,
            lastNotificationTime: 0
        };
        
        // Make debug functions available globally
        if (typeof window !== 'undefined') {
            window.centralWalletState = this;
            window.debugCentralWalletState = () => this.debugState();
            window.forceCentralWalletSync = () => this.forceSync();
            window.getWalletPerformanceMetrics = () => this.getPerformanceMetrics();
        }
    }

    /**
     * Subscribe to wallet state updates
     * @param {Function} callback - Function to call when state changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        
        // Immediately call with current state if available
        if (this.currentState) {
            callback(this.currentState);
        }
        
        return () => this.subscribers.delete(callback);
    }

    /**
     * Notify all subscribers of state changes with debouncing
     */
    notifySubscribers() {
        // Clear existing timeout
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }
        
        // Debounce notifications to prevent rapid successive updates
        this.notificationTimeout = setTimeout(() => {
            this._performNotification();
        }, 50); // 50ms debounce
    }
    
    /**
     * Internal method to perform the actual notification
     */
    _performNotification() {
        if (!this.currentState) return;
        
        const startTime = performance.now();
        
        // Check if state has actually changed to prevent redundant notifications
        const stateChanged = !this.lastNotificationState || 
            this.lastNotificationState.total_equity !== this.currentState.total_equity ||
            this.lastNotificationState.available_balance !== this.currentState.available_balance ||
            this.lastNotificationState.balance_in_trades !== this.currentState.balance_in_trades ||
            this.lastNotificationState.open_positions_count !== this.currentState.open_positions_count;
        
        if (!stateChanged) {
            this.performanceMetrics.skippedNotifications++;
            return;
        }
        
        this.lastNotificationState = { ...this.currentState };
        
        this.subscribers.forEach(callback => {
            try {
                callback(this.currentState);
            } catch (error) {
                console.error('[CentralWalletStateManager] Error notifying subscriber:', error);
            }
        });
        
        // Update performance metrics
        const notificationTime = performance.now() - startTime;
        this.performanceMetrics.notificationCount++;
        this.performanceMetrics.lastNotificationTime = notificationTime;
        this.performanceMetrics.averageNotificationTime = 
            (this.performanceMetrics.averageNotificationTime * (this.performanceMetrics.notificationCount - 1) + notificationTime) / 
            this.performanceMetrics.notificationCount;
        
        if (notificationTime > 100) {
            console.warn(`[CentralWalletStateManager] ⚠️ Slow notification: ${notificationTime.toFixed(2)}ms`);
        }
    }
    
    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            subscriberCount: this.subscribers.size,
            efficiency: this.performanceMetrics.notificationCount > 0 ? 
                (this.performanceMetrics.skippedNotifications / this.performanceMetrics.notificationCount * 100).toFixed(1) + '%' : '0%'
        };
    }

    /**
     * Initialize the central wallet state
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     */
    async initialize(tradingMode) {
        if (this.syncInProgress) {
            return;
        }

        this.syncInProgress = true;
        
        try {
            // PERSISTENT WALLET ID SYSTEM: Get the primary wallet ID from wallet_config
            const primaryWalletId = await this.getPrimaryWalletId(tradingMode);
            console.log(`[CentralWalletStateManager] 🔑 Primary wallet ID for ${tradingMode}: ${primaryWalletId}`);
            
            // Check if CentralWalletState already exists for this wallet ID
            const existingStates = await queueEntityCall(
                'CentralWalletState', 
                'filter', 
                { trading_mode: tradingMode }
            );

            // Find the state that matches the primary wallet ID
            let targetState = existingStates?.find(state => state.id === primaryWalletId);
            
            if (targetState) {
                console.log(`[CentralWalletStateManager] ✅ Found existing state for primary wallet ID: ${primaryWalletId}`);
                this.currentState = targetState;
                
                // Immediately sync with Binance to get latest data
                await this.syncWithBinance(tradingMode);
            } else {
                console.log(`[CentralWalletStateManager] 🔄 Creating new state for primary wallet ID: ${primaryWalletId}`);
                
                // Create new state with the primary wallet ID
                const newState = {
                    id: primaryWalletId, // Use the persistent primary wallet ID
                    trading_mode: tradingMode,
                    available_balance: 0,
                    balance_in_trades: 0,
                    total_equity: 0,
                    total_realized_pnl: 0,
                    unrealized_pnl: 0,
                    crypto_assets_value: 0,
                    open_positions_count: 0,
                    last_binance_sync: new Date().toISOString(),
                    balances: [],
                    positions: [],
                    status: 'initialized'
                };

                const createdState = await queueEntityCall('CentralWalletState', 'create', newState);
                this.currentState = createdState;
                
                // Sync with Binance to get latest data
                await this.syncWithBinance(tradingMode);
            }
            
            this.isInitialized = true;
            this.notifySubscribers();
            
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Initialization failed:', error);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Get the primary wallet ID for a trading mode from wallet_config table
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @returns {Promise<string>} Primary wallet ID
     */
    async getPrimaryWalletId(tradingMode) {
        // Default wallet IDs per trading mode
        const defaultWalletIds = {
            'testnet': 'hvazdukoq',
            'mainnet': 'hvazdukoq' // Can be changed later if needed
        };

        try {
            // Query the wallet_config table directly
            const response = await fetch('http://localhost:3003/api/wallet-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trading_mode: tradingMode })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch wallet config: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.walletId) {
                console.log(`[CentralWalletStateManager] 🔑 Retrieved primary wallet ID: ${data.walletId}`);
                return data.walletId;
            } else {
                // Fallback: use default wallet ID for this trading mode
                const fallbackWalletId = defaultWalletIds[tradingMode] || `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                console.log(`[CentralWalletStateManager] ⚠️ No primary wallet ID found in DB, using default: ${fallbackWalletId}`);
                return fallbackWalletId;
            }
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Error getting primary wallet ID (server may not be running):', error.message);
            // Fallback: use default wallet ID for this trading mode (hardcoded)
            const fallbackWalletId = defaultWalletIds[tradingMode] || `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            console.log(`[CentralWalletStateManager] ✅ Using hardcoded default wallet ID for ${tradingMode}: ${fallbackWalletId}`);
            return fallbackWalletId;
        }
    }

    /**
     * Set the primary wallet ID for a trading mode in wallet_config table
     * @param {string} tradingMode - Trading mode (testnet/mainnet)
     * @param {string} walletId - Wallet ID to set as primary
     */
    async setPrimaryWalletId(tradingMode, walletId) {
        try {
            const response = await fetch('http://localhost:3003/api/wallet-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    trading_mode: tradingMode, 
                    primary_wallet_id: walletId 
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to set wallet config: ${response.statusText}`);
            }
            
            console.log(`[CentralWalletStateManager] 💾 Set primary wallet ID for ${tradingMode}: ${walletId}`);
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Error setting primary wallet ID:', error);
        }
    }

    /**
     * Create a new CentralWalletState (only when no existing state found)
     * @param {string} tradingMode - Trading mode
     */
    async createNewState(tradingMode) {
        
        const newState = {
            trading_mode: tradingMode,
            available_balance: 0,
            balance_in_trades: 0,
            total_equity: 0,
            total_realized_pnl: 0,
            unrealized_pnl: 0,
            crypto_assets_value: 0,
            open_positions_count: 0,
            last_binance_sync: new Date().toISOString(),
            balances: [],
            positions: [],
            status: 'initialized'
        };

        const createdState = await queueEntityCall('CentralWalletState', 'create', newState);
        this.currentState = createdState;
        
    }

    /**
     * Sync wallet state with Binance API
     * @param {string} tradingMode - Trading mode
     */
    async syncWithBinance(tradingMode) {
        if (this.syncInProgress) {
            return;
        }

        this.syncInProgress = true;
        
        try {
            
            // Get account info from Binance
            console.log(`[CentralWalletStateManager] 🔄 Syncing with Binance for ${tradingMode}...`);
            const accountResponse = await liveTradingAPI({
                action: 'getAccountInfo',
                tradingMode: tradingMode,
                proxyUrl: "http://localhost:3003"
            });

            if (!accountResponse?.data) {
                console.error(`[CentralWalletStateManager] ❌ Failed to fetch account info from Binance:`, accountResponse);
                throw new Error('Failed to fetch account info from Binance');
            }

            const accountData = accountResponse.data;
            console.log(`[CentralWalletStateManager] ✅ Received Binance account data:`, {
                balancesCount: accountData.balances?.length || 0,
                hasUsdtBalance: !!accountData.balances?.find(b => b.asset === 'USDT')
            });
            
            // Extract USDT balance
            const usdtBalance = accountData.balances?.find(b => b.asset === 'USDT');
            const availableBalance = parseFloat(usdtBalance?.free || 0);
            const lockedBalance = parseFloat(usdtBalance?.locked || 0);
            
            console.log(`[CentralWalletStateManager] 💰 USDT Balance extracted:`, {
                usdtBalance: usdtBalance,
                availableBalance: availableBalance,
                lockedBalance: lockedBalance
            });
            
            // Get current positions
            const positions = await queueEntityCall(
                'LivePosition', 
                'filter', 
                { 
                    trading_mode: tradingMode, 
                    status: ['open', 'trailing'] 
                }
            );

            // Calculate balance in trades
            const balanceInTrades = positions?.reduce((total, pos) => {
                return total + (parseFloat(pos.entry_value_usdt) || 0);
            }, 0) || 0;

            // Calculate unrealized P&L using live prices (fallback to stored current_price/entry_price)
            let unrealizedPnl = 0;
            try {
                const symbols = Array.from(new Set((positions || []).map(p => (p.symbol || '').replace('/', '')))).filter(Boolean);
                let priceMap = {};
                if (symbols.length > 0) {
                    const priceResp = await liveTradingAPI({
                        action: 'getSymbolPriceTicker',
                        symbols,
                        tradingMode: tradingMode,
                        proxyUrl: 'http://localhost:3003'
                    });
                    const responseData = priceResp?.data || priceResp;
                    const list = responseData?.data || responseData;
                    if (Array.isArray(list)) {
                        for (const item of list) {
                            if (item?.symbol && item?.price) priceMap[item.symbol] = parseFloat(item.price);
                        }
                    } else if (list?.symbol && list?.price) {
                        priceMap[list.symbol] = parseFloat(list.price);
                    }
                }
                unrealizedPnl = positions?.reduce((total, pos) => {
                    const key = (pos.symbol || '').replace('/', '');
                    const live = priceMap[key];
                    const current = Number.isFinite(live) ? live : (parseFloat(pos.current_price) || parseFloat(pos.entry_price) || 0);
                    const qty = parseFloat(pos.quantity_crypto) || 0;
                    const currentValue = current * qty;
                    const entryValue = parseFloat(pos.entry_value_usdt) || 0;
                    return total + (currentValue - entryValue);
                }, 0) || 0;
            } catch (pErr) {
                console.warn('[CentralWalletStateManager] ⚠️ Failed live price fetch for unrealized PnL, falling back:', pErr?.message);
                unrealizedPnl = positions?.reduce((total, pos) => {
                    const currentValue = (parseFloat(pos.current_price) || parseFloat(pos.entry_price) || 0) * (parseFloat(pos.quantity_crypto) || 0);
                    const entryValue = parseFloat(pos.entry_value_usdt) || 0;
                    return total + (currentValue - entryValue);
                }, 0) || 0;
            }

            // Calculate crypto assets value (excluding USDT)
            const cryptoAssetsValue = await this.calculateCryptoAssetsValue(accountData.balances);
            
            // Calculate total equity (including crypto assets)
            const totalEquity = availableBalance + balanceInTrades + unrealizedPnl + cryptoAssetsValue;

            // Update the central state
            const updatedState = {
                ...this.currentState,
                available_balance: availableBalance,
                balance_in_trades: balanceInTrades,
                total_equity: totalEquity,
                unrealized_pnl: unrealizedPnl,
                crypto_assets_value: cryptoAssetsValue,
                open_positions_count: positions?.length || 0,
                last_binance_sync: new Date().toISOString(),
                balances: accountData.balances || [],
                positions: positions || [],
                status: 'synced'
            };

            // Save to database
            const savedState = await queueEntityCall(
                'CentralWalletState', 
                'update', 
                this.currentState.id, 
                updatedState
            );

            this.currentState = savedState;
            this.notifySubscribers();
            
            console.log(`[CentralWalletStateManager] ✅ Sync completed:`, {
                availableBalance: availableBalance.toFixed(2),
                balanceInTrades: balanceInTrades.toFixed(2),
                cryptoAssetsValue: cryptoAssetsValue.toFixed(2),
                totalEquity: totalEquity.toFixed(2),
                positionsCount: positions?.length || 0,
                balancesCount: accountData.balances?.length || 0,
                usdtBalance: usdtBalance
            });

        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Sync failed:', error);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Calculate the total USD value of crypto assets (excluding USDT)
     * @param {Array} balances - Array of balance objects from Binance
     * @returns {number} Total USD value of crypto assets
     */
    async calculateCryptoAssetsValue(balances) {
        if (!balances || !Array.isArray(balances)) {
            return 0;
        }

        const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'PAX', 'GUSD', 'USDD'];
        
        // Filter crypto assets with significant amounts
        const cryptoAssets = balances.filter(balance => {
            if (stablecoins.includes(balance.asset)) return false;
            const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);
            return total > 0.00000001; // Only include significant amounts
        });

        if (cryptoAssets.length === 0) {
            return 0;
        }

        // Fetch real-time prices from Binance
        const symbols = cryptoAssets.map(asset => `${asset.asset}USDT`);
        const pricesResponse = await liveTradingAPI({
            action: 'getSymbolPriceTicker',
            symbols: symbols,
            tradingMode: this.currentState?.trading_mode || 'testnet',
            proxyUrl: "http://localhost:3003"
        });

        if (!pricesResponse?.data) {
            throw new Error('Failed to fetch crypto prices from Binance');
        }

        const prices = Array.isArray(pricesResponse.data) ? pricesResponse.data : [pricesResponse.data];
        const priceMap = {};
        
        prices.forEach(price => {
            if (price.symbol && price.price) {
                priceMap[price.symbol] = parseFloat(price.price);
            }
        });

        // Calculate total value using real prices
        let totalValue = 0;
        cryptoAssets.forEach(balance => {
            const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);
            const symbol = `${balance.asset}USDT`;
            const price = priceMap[symbol] || 0;
            
            if (price > 0) {
                totalValue += total * price;
            }
        });

        console.log(`[CentralWalletStateManager] 💰 Crypto assets value calculated: $${totalValue.toFixed(2)} (${cryptoAssets.length} assets)`);
        return totalValue;
    }


    /**
     * Update balance in trades (called when positions change)
     * @param {number} newBalanceInTrades - New balance in trades
     */
    async updateBalanceInTrades(newBalanceInTrades) {
        if (!this.currentState) {
            console.warn('[CentralWalletStateManager] ⚠️ No current state to update');
            return;
        }

        try {
            const updatedState = {
                ...this.currentState,
                balance_in_trades: newBalanceInTrades,
                total_equity: this.currentState.available_balance + newBalanceInTrades + this.currentState.unrealized_pnl + (this.currentState.crypto_assets_value || 0),
                updated_date: new Date().toISOString()
            };

            const savedState = await queueEntityCall(
                'CentralWalletState', 
                'update', 
                this.currentState.id, 
                updatedState
            );

            this.currentState = savedState;
            this.notifySubscribers();
            
            console.log(`[CentralWalletStateManager] 💰 Updated balance in trades: ${newBalanceInTrades.toFixed(2)}`);
            
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Failed to update balance in trades:', error);
        }
    }

    /**
     * Update available balance (called when Binance balance changes)
     * @param {number} newAvailableBalance - New available balance
     */
    async updateAvailableBalance(newAvailableBalance) {
        if (!this.currentState) {
            console.warn('[CentralWalletStateManager] ⚠️ No current state to update');
            return;
        }

        try {
            const updatedState = {
                ...this.currentState,
                available_balance: newAvailableBalance,
                total_equity: newAvailableBalance + this.currentState.balance_in_trades + this.currentState.unrealized_pnl + (this.currentState.crypto_assets_value || 0),
                last_binance_sync: new Date().toISOString(),
                updated_date: new Date().toISOString()
            };

            const savedState = await queueEntityCall(
                'CentralWalletState', 
                'update', 
                this.currentState.id, 
                updatedState
            );

            this.currentState = savedState;
            this.notifySubscribers();
            
            console.log(`[CentralWalletStateManager] 💰 Updated available balance: ${newAvailableBalance.toFixed(2)}`);
            
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Failed to update available balance:', error);
        }
    }

    /**
     * Get current wallet state
     * @returns {Object|null} Current wallet state
     */
    getCurrentState() {
        return this.currentState;
    }

    /**
     * Check if the manager is initialized
     * @returns {boolean} True if initialized
     */
    isReady() {
        return this.isInitialized && this.currentState !== null;
    }

    /**
     * Force a complete sync (for debugging)
     */
    async forceSync() {
        if (!this.currentState) {
            console.warn('[CentralWalletStateManager] ⚠️ No current state to sync');
            return;
        }

        await this.syncWithBinance(this.currentState.trading_mode);
    }

    /**
     * Debug current state
     */
    debugState() {
        console.log('[CentralWalletStateManager] 🔍 Current State:', {
            isInitialized: this.isInitialized,
            syncInProgress: this.syncInProgress,
            subscribersCount: this.subscribers.size,
            currentState: this.currentState ? {
                id: this.currentState.id,
                trading_mode: this.currentState.trading_mode,
                available_balance: this.currentState.available_balance,
                balance_in_trades: this.currentState.balance_in_trades,
                total_equity: this.currentState.total_equity,
                open_positions_count: this.currentState.open_positions_count,
                last_binance_sync: this.currentState.last_binance_sync,
                status: this.currentState.status
            } : null
        });
    }

    /**
     * Cleanup and reset
     */
    cleanup() {
        this.subscribers.clear();
        this.currentState = null;
        this.isInitialized = false;
        this.syncInProgress = false;
    }
}

// Create singleton instance
const centralWalletStateManager = new CentralWalletStateManager();

export default centralWalletStateManager;
