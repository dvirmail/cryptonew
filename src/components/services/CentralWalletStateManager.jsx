import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';
import { getAutoScannerService } from './AutoScannerService';

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
        
        // Reduced logging - only log when state actually changes or positions change
        if (!stateChanged) {
            this.performanceMetrics.skippedNotifications++;
            return;
        }
        
        const positionsCount = this.currentState?.positions?.length || 0;
        
        this.lastNotificationState = { ...this.currentState };
        
        const subscriberArray = Array.from(this.subscribers);
        subscriberArray.forEach((callback, index) => {
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
            
            // Check if CentralWalletState already exists for this wallet ID
            const existingStates = await queueEntityCall(
                'CentralWalletState', 
                'filter', 
                { trading_mode: tradingMode }
            );

            // Find the state that matches the primary wallet ID
            let targetState = existingStates?.find(state => state.id === primaryWalletId);
            
            if (targetState) {
                this.currentState = targetState;
                
                // Immediately sync with Binance to get latest data (this will recalculate P&L)
                await this.syncWithBinance(tradingMode);
            } else {
                
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
                return data.walletId;
            } else {
                // Fallback: use default wallet ID for this trading mode
                const fallbackWalletId = defaultWalletIds[tradingMode] || `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                return fallbackWalletId;
            }
        } catch (error) {
            // Fallback: use default wallet ID for this trading mode (hardcoded)
            const fallbackWalletId = defaultWalletIds[tradingMode] || `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            // CRITICAL FIX: Delay BEFORE fetching account info to ensure any recent position creations
            // are fully committed to the database and visible in queries
            // This prevents race conditions where positions were just created but aren't queryable yet
            // Increased to 800ms to ensure PostgreSQL transaction is fully committed and visible
            // Combined with 200ms delay in SignalDetectionEngine before event dispatch, total is ~1000ms
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // Get account info from Binance
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
            
            // Extract USDT balance
            const usdtBalance = accountData.balances?.find(b => b.asset === 'USDT');
            const availableBalance = parseFloat(usdtBalance?.free || 0);
            const lockedBalance = parseFloat(usdtBalance?.locked || 0);
            
            // CRITICAL FIX: Get positions from PositionManager first (single source of truth)
            // Only query DB if PositionManager is not available
            let positions = [];
            const queryStartTime = performance.now();
            const queryStartISO = new Date().toISOString();
            
            // Define filterCriteria outside try/catch so it's available for retry logic
            const filterCriteria = { 
                trading_mode: tradingMode,
                status: ['open', 'trailing']
            };
            
            try {
                const scannerService = getAutoScannerService();
                const positionManager = scannerService?.positionManager;
                
                // CRITICAL FIX: Use PositionManager even if positions array is empty (empty array is valid state!)
                // An empty array means "no positions" which is correct after closing a position
                if (positionManager && Array.isArray(positionManager.positions)) {
                    // Use positions from PositionManager (already filtered by status)
                    positions = positionManager.positions.filter(pos => 
                        pos.trading_mode === tradingMode && 
                        (pos.status === 'open' || pos.status === 'trailing')
                    );
                } else {
                    // Fallback: Query DB directly (PositionManager not available)
                    throw new Error('PositionManager not available'); // Fall through to DB query
                }
            } catch (pmError) {
                // Fallback: Query DB directly
                //console.log(`[POSITION_QUERY] 🔍 PositionManager access failed, querying DB directly:`, pmError.message);
                // Additional delay after account info fetch to ensure positions are queryable
                await new Promise(resolve => setTimeout(resolve, 100));
                
                //console.log(`[POSITION_QUERY] 🔍 ========================================`);
                //console.log(`[POSITION_QUERY] 🔍 Querying positions at ${queryStartISO}`);
                //console.log(`[POSITION_QUERY] 📝 Filter criteria:`, JSON.stringify(filterCriteria));
                //console.log(`[POSITION_QUERY] 📊 Before query: state has ${this.currentState?.positions?.length || 0} positions`);
                //console.log(`[POSITION_QUERY] 🌐 API: POST /api/entities/LivePosition/filter`);
                
                positions = await queueEntityCall(
                    'LivePosition', 
                    'filter', 
                    filterCriteria
                );
                
                const queryEndTime = performance.now();
                const queryDuration = queryEndTime - queryStartTime;
                const queryEndISO = new Date().toISOString();
                
                //console.log(`[POSITION_QUERY] ⏱️ Query completed in ${queryDuration.toFixed(2)}ms`);
                //console.log(`[POSITION_QUERY] ⏰ Query end time: ${queryEndISO}`);
                //console.log(`[POSITION_QUERY] 📥 Query returned: ${positions?.length || 0} positions`);
            }
            
            // Log final result (outside try/catch so it's always executed)
            const queryEndTime = performance.now();
            const queryDuration = queryEndTime - queryStartTime;
            const queryEndISO = new Date().toISOString();
            if (positions && positions.length > 0) {
                //console.log(`[POSITION_QUERY] ✅ Found ${positions.length} positions:`, positions.map(p => `${p.symbol}(${p.status || 'NULL'})`).join(', '));
            } else {
                // CRITICAL FIX: Check if position was recently created (within last 5 seconds)
                // If so, retry the query as it may not be visible yet
                const currentPositionsCount = this.currentState?.positions?.length || 0;
                const lastSyncTime = this.currentState?.last_binance_sync;
                const timeSinceLastSync = lastSyncTime ? Date.now() - new Date(lastSyncTime).getTime() : Infinity;
                
                // If we have positions in state OR last sync was very recent, retry
                if (currentPositionsCount > 0 || timeSinceLastSync < 5000) {
                    //console.log(`[POSITION_QUERY] 🔄 Retrying query after 500ms delay...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    const retryStartTime = performance.now();
                    const retryStartISO = new Date().toISOString();
                    //console.log(`[POSITION_QUERY] 🔍 Retry query with filter:`, JSON.stringify(filterCriteria));
                    //console.log(`[POSITION_QUERY] ⏰ Retry start time: ${retryStartISO}`);
                    //console.log(`[POSITION_QUERY] 🌐 API: POST /api/entities/LivePosition/filter`);
                    
                    const retryPositions = await queueEntityCall(
                        'LivePosition', 
                        'filter', 
                        filterCriteria
                    );
                    
                    const retryEndTime = performance.now();
                    const retryDuration = retryEndTime - retryStartTime;
                    const retryEndISO = new Date().toISOString();
                    
                    //console.log(`[POSITION_QUERY] ⏱️ Retry completed in ${retryDuration.toFixed(2)}ms`);
                    //console.log(`[POSITION_QUERY] ⏰ Retry end time: ${retryEndISO}`);
                    //console.log(`[POSITION_QUERY] 📥 Retry returned: ${retryPositions?.length || 0} positions`);
                    if (retryPositions && retryPositions.length > 0) {
                        //console.log(`[POSITION_QUERY] ✅ Retry found ${retryPositions.length} positions:`, retryPositions.map(p => `${p.symbol}(${p.status || 'NULL'})`).join(', '));
                        positions = retryPositions;
                    } else if (currentPositionsCount > 0 && timeSinceLastSync < 3000) {
                        // Preserve existing positions if retry failed but sync was very recent
                        console.log(`[POSITION_QUERY] ⚠️ Retry failed but preserving ${currentPositionsCount} existing positions (sync was ${Math.round(timeSinceLastSync)}ms ago)`);
                        positions = this.currentState.positions || [];
                    } else {
                        console.log(`[POSITION_QUERY] ❌ No positions found after retry`);
                        if (currentPositionsCount > 0) {
                            console.log(`[POSITION_QUERY] ⚠️ State had ${currentPositionsCount} positions but query returned 0 - positions will be overwritten!`);
                            //console.log(`[POSITION_QUERY] 🔍 Current positions in state:`, this.currentState.positions.map(p => `${p.symbol}(${p.status || 'NULL'}, id=${p.id?.substring(0, 8)})`).join(', '));
                        }
                    }
                }
            }

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
            
            // CRITICAL FIX: Use the dedicated recalculation function that handles deduplication
            // This ensures consistent P&L calculation across the entire system
            let totalRealizedPnl = 0;
            let totalTradesCount = 0;
            let winningTradesCount = 0;
            let losingTradesCount = 0;
            let totalGrossProfit = 0;
            let totalGrossLoss = 0;
            
            try {
                // Use the dedicated recalculation function which handles deduplication correctly
                totalRealizedPnl = await this.recalculateRealizedPnlFromDatabase(tradingMode);
                
                // Extract the trade counts from the updated central state (they're set by recalculateRealizedPnlFromDatabase)
                totalTradesCount = this.currentState?.total_trades_count || 0;
                winningTradesCount = this.currentState?.winning_trades_count || 0;
                losingTradesCount = this.currentState?.losing_trades_count || 0;
                totalGrossProfit = this.currentState?.total_gross_profit || 0;
                totalGrossLoss = this.currentState?.total_gross_loss || 0;
            } catch (tradeError) {
                console.error('[CentralWalletStateManager] ⚠️ Failed to calculate realized P&L from database:', tradeError);
                // Fallback: use existing value if calculation fails
                totalRealizedPnl = this.currentState?.total_realized_pnl || 0;
                totalTradesCount = this.currentState?.total_trades_count || 0;
                winningTradesCount = this.currentState?.winning_trades_count || 0;
                losingTradesCount = this.currentState?.losing_trades_count || 0;
                totalGrossProfit = this.currentState?.total_gross_profit || 0;
                totalGrossLoss = this.currentState?.total_gross_loss || 0;
            }
            
            // Calculate total equity (including crypto assets)
            const totalEquity = availableBalance + balanceInTrades + unrealizedPnl + cryptoAssetsValue;

            // Update the central state
            const positionsCount = positions?.length || 0;
            const updatedState = {
                ...this.currentState,
                available_balance: availableBalance,
                balance_in_trades: balanceInTrades,
                total_equity: totalEquity,
                total_realized_pnl: totalRealizedPnl, // CRITICAL: Always from database
                total_trades_count: totalTradesCount,
                winning_trades_count: winningTradesCount,
                losing_trades_count: losingTradesCount,
                total_gross_profit: totalGrossProfit,
                total_gross_loss: totalGrossLoss,
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
        
        // Fiat currencies that don't have USDT trading pairs on Binance
        const fiatCurrencies = new Set([
            'TRY', 'ZAR', 'UAH', 'BRL', 'PLN', 'RON', 'ARS', 'JPY', 'MXN', 'COP', 'CZK',
            'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'HUF', 'RUB', 'INR',
            'KRW', 'CNY', 'HKD', 'SGD', 'TWD', 'THB', 'VND', 'IDR', 'MYR', 'PHP', 'NGN'
        ]);
        
        // Filter crypto assets with significant amounts (exclude stablecoins and fiat)
        const cryptoAssets = balances.filter(balance => {
            if (stablecoins.includes(balance.asset)) return false;
            if (fiatCurrencies.has(balance.asset)) return false; // Skip fiat currencies
            const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);
            return total > 0.00000001; // Only include significant amounts
        });

        if (cryptoAssets.length === 0) {
            return 0;
        }

        // Fetch real-time prices from Binance (only for valid crypto assets)
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

        return totalValue;
    }


    /**
     * Recalculate total realized P&L directly from database (source of truth)
     * This should be called whenever trades are added/updated to ensure accuracy
     * @param {string} tradingMode - Trading mode
     * @returns {Promise<number>} Total realized P&L
     */
    async recalculateRealizedPnlFromDatabase(tradingMode) {
        try {
            const { queueEntityCall } = await import('@/components/utils/apiQueue');
            
            // Fetch ALL closed trades for this trading mode (only those with exit_timestamp)
            const allTrades = await queueEntityCall('Trade', 'filter', 
                { 
                    trading_mode: tradingMode,
                    exit_timestamp: { $ne: null } // Only closed trades
                }, 
                '-exit_timestamp', 
                100000 // Large limit to get all trades
            ).catch(() => []);

            // CRITICAL FIX: Deduplicate trades before calculating P&L to prevent inflated numbers
            const deduplicatedTrades = [];
            const seenTrades = new Map();
            
            if (allTrades && allTrades.length > 0) {
                allTrades.forEach(trade => {
                    if (!trade.exit_timestamp || !trade.entry_timestamp) return;
                    
                    // Create unique key based on trade characteristics
                    const entryPrice = Math.round((Number(trade.entry_price) || 0) * 10000) / 10000;
                    const exitPrice = Math.round((Number(trade.exit_price) || 0) * 10000) / 10000;
                    const quantity = Math.round((Number(trade.quantity_crypto) || Number(trade.quantity) || 0) * 1000000) / 1000000;
                    const entryDate = trade.entry_timestamp ? new Date(trade.entry_timestamp) : null;
                    const entryDateRounded = entryDate ? new Date(Math.floor(entryDate.getTime() / 1000) * 1000).toISOString() : '';
                    const symbol = trade.symbol || '';
                    const strategy = trade.strategy_name || '';
                    
                    const uniqueKey = `${symbol}|${strategy}|${entryPrice}|${exitPrice}|${quantity}|${entryDateRounded}`;
                    
                    if (!seenTrades.has(uniqueKey)) {
                        seenTrades.set(uniqueKey, trade);
                        deduplicatedTrades.push(trade);
                    } else {
                        // Keep the trade with the earliest exit_timestamp
                        const existing = seenTrades.get(uniqueKey);
                        const existingExit = existing?.exit_timestamp ? new Date(existing.exit_timestamp).getTime() : 0;
                        const currentExit = trade?.exit_timestamp ? new Date(trade.exit_timestamp).getTime() : 0;
                        if (currentExit > 0 && (existingExit === 0 || currentExit < existingExit)) {
                            const index = deduplicatedTrades.indexOf(existing);
                            if (index >= 0) deduplicatedTrades.splice(index, 1);
                            seenTrades.set(uniqueKey, trade);
                            deduplicatedTrades.push(trade);
                        }
                    }
                });
                
                if (seenTrades.size < allTrades.length) {
                }
            }

            let totalRealizedPnl = 0;
            let totalTradesCount = 0;
            let winningTradesCount = 0;
            let losingTradesCount = 0;
            let totalGrossProfit = 0;
            let totalGrossLoss = 0;

            if (deduplicatedTrades && deduplicatedTrades.length > 0) {
                deduplicatedTrades.forEach(trade => {
                    if (trade.exit_timestamp) { // Double-check: only closed trades
                        totalTradesCount++;
                        const pnl = Number(trade.pnl_usdt || 0);
                        totalRealizedPnl += pnl;

                        if (pnl > 0) {
                            winningTradesCount++;
                            totalGrossProfit += pnl;
                        } else if (pnl < 0) {
                            losingTradesCount++;
                            totalGrossLoss += Math.abs(pnl);
                        }
                    }
                });
            }

            // Update the central state with recalculated values
            if (this.currentState) {
                const updatedState = {
                    ...this.currentState,
                    total_realized_pnl: totalRealizedPnl,
                    total_trades_count: totalTradesCount,
                    winning_trades_count: winningTradesCount,
                    losing_trades_count: losingTradesCount,
                    total_gross_profit: totalGrossProfit,
                    total_gross_loss: totalGrossLoss,
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

            }

            return totalRealizedPnl;
        } catch (error) {
            console.error('[CentralWalletStateManager] ❌ Failed to recalculate realized P&L from database:', error);
            return this.currentState?.total_realized_pnl || 0;
        }
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
