
import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';

class WalletManagerService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.walletSummary = null; // Initialize a property to cache the last summary
    }

    /**
     * Initializes or refreshes the LiveWalletState by syncing with Binance API
     */
    async initializeLiveWallet() {
        console.log('[WalletManagerService] 🔄 [TESTNET_WALLET] 🔄 Initializing live wallet...');
        const tradingMode = this.scannerService.getTradingMode();
        let proxyUrl = this.scannerService.state?.settings?.local_proxy_url;

        if (!proxyUrl) {
            // Use default proxy URL as fallback
            proxyUrl = "http://localhost:3003";
        }

        try {
            // Call liveTradingAPI directly to avoid queue delays
            const accountResponse = await liveTradingAPI({
                action: 'getAccountInfo',
                tradingMode: tradingMode,
                proxyUrl: proxyUrl
            });
            

            // Account response received successfully

            // Handle both response formats:
            // 1. Direct liveTradingAPI response: {success: true, data: {...}}
            // 2. queueFunctionCall response: {data: {...}} (no success property)
            const isSuccess = accountResponse?.success === true || (accountResponse?.data && !accountResponse?.success);
            
            if (!isSuccess) {
                const errorMsg = accountResponse?.message || accountResponse?.error || 'Failed to fetch account info';
                throw new Error(errorMsg);
            }

            const accountData = accountResponse.data;
            
            const usdtBalance = accountData.balances?.find(b => b.asset === 'USDT');
            const usdtTotal = parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0);
            
            const nonZeroBalances = accountData.balances?.filter(b => {
                const total = parseFloat(b.free || 0) + parseFloat(b.locked || 0);
                return total > 0 && b.asset !== 'USDT';
            }) || [];

            // Removed asset list logs to reduce console clutter

            const existingWallets = await queueEntityCall('LiveWalletState', 'filter', { trading_mode: tradingMode });

            let walletState;
            if (existingWallets && existingWallets.length > 0) {
                // Sort by last_updated_timestamp to get the most recent
                existingWallets.sort((a, b) => {
                    const aTime = new Date(a.last_updated_timestamp || a.created_date || 0).getTime();
                    const bTime = new Date(b.last_updated_timestamp || b.created_date || 0).getTime();
                    return bTime - aTime; // Most recent first
                });
                
                walletState = existingWallets[0];

                if (existingWallets.length > 1) {
                    // Delete all duplicate wallet states except the most recent one
                    const duplicatesToDelete = existingWallets.slice(1);
                    for (const duplicate of duplicatesToDelete) {
                        try {
                            await queueEntityCall('LiveWalletState', 'delete', duplicate.id);
                        } catch (deleteError) {
                            console.warn(`[WalletManagerService] ⚠️ Failed to delete duplicate wallet ${duplicate.id}:`, deleteError.message);
                        }
                    }
                }

                const oldUsdtBalance = walletState.balances?.find(b => b.asset === 'USDT');
                if (oldUsdtBalance) {
                    const oldFree = parseFloat(oldUsdtBalance.free || 0);
                    const newFree = parseFloat(usdtBalance?.free || 0);
                    const difference = newFree - oldFree;
                    if (Math.abs(difference) > 0.00000001) {
                        // console.log(`[WalletManagerService] 💰 USDT Balance changed from ${oldFree.toFixed(2)} to ${newFree.toFixed(2)} (Diff: ${difference.toFixed(2)})`); // Removed debug log
                    }
                }

                walletState.binance_account_type = accountData.accountType;
                walletState.balances = accountData.balances;
                // Don't set total_equity here - it will be calculated properly in updateWalletSummary
                walletState.available_balance = usdtTotal.toString();
                walletState.last_binance_sync = new Date().toISOString();
                walletState.last_updated_timestamp = new Date().toISOString(); // Also update general timestamp

                // Remove total_equity from update data since it will be calculated in updateWalletSummary
                const updateData = { ...walletState };
                delete updateData.total_equity;

                
                const updateResult = await queueEntityCall('LiveWalletState', 'update', walletState.id, updateData);
            } else {
                walletState = {
                    trading_mode: tradingMode,
                    // Don't set total_equity here - it will be calculated properly in updateWalletSummary
                    available_balance: usdtTotal.toString(),
                    total_realized_pnl: "0.00000000",
                    unrealized_pnl: "0.00000000",
                    binance_account_type: accountData.accountType,
                    balances: accountData.balances,
                    positions: [], // This array is generally not populated with full position objects in this service
                    live_position_ids: [],
                    total_trades_count: 0,
                    winning_trades_count: 0,
                    losing_trades_count: 0,
                    total_gross_profit: 0,
                    total_gross_loss: 0,
                    total_fees_paid: 0,
                    last_updated_timestamp: new Date().toISOString(),
                    last_binance_sync: new Date().toISOString()
                };

                
                // Double-check that no wallet state was created by another process
                const finalCheck = await queueEntityCall('LiveWalletState', 'filter', { trading_mode: tradingMode });
                if (finalCheck && finalCheck.length > 0) {
                    walletState = finalCheck[0];
                } else {
                    const createdWallet = await queueEntityCall('LiveWalletState', 'create', walletState);
                    walletState = createdWallet;
                }
            }

            this.scannerService.state.liveWalletState = walletState;
            
            // Calculate total equity and update wallet summary with current prices
            try {
                
                // Fetch current prices for all crypto assets if not available
                let currentPrices = this.scannerService.currentPrices || {};
                if (Object.keys(currentPrices).length === 0) {
                    try {
                        // Get ALL assets with balances (no limit for complete calculation)
                        const nonUsdtBalances = walletState.balances?.filter(b => {
                            const total = parseFloat(b.free || 0) + parseFloat(b.locked || 0);
                            return total > 0.001 && b.asset !== 'USDT'; // Include all assets with any balance
                        }) || []; // No limit - calculate ALL assets for complete portfolio value
                        
                        
                        // Fetch prices in batches to avoid overwhelming the API
                        const batchSize = 20; // Larger batch size for processing all assets efficiently
                        const batches = [];
                        for (let i = 0; i < nonUsdtBalances.length; i += batchSize) {
                            batches.push(nonUsdtBalances.slice(i, i + batchSize));
                        }
                        
                        currentPrices = {};
                        for (const batch of batches) {
                            const batchPromises = batch.map(async (balance) => {
                                const symbol = `${balance.asset}USDT`;
                                try {
                                    const controller = new AbortController();
                                    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                                    
                                    const response = await fetch(`http://localhost:3003/api/binance/ticker/price?symbol=${symbol}`, {
                                        signal: controller.signal
                                    });
                                    clearTimeout(timeoutId);
                                    
                                    const data = await response.json();
                                    if (data.success && data.data?.price) {
                                        return { symbol, price: parseFloat(data.data.price) };
                                    }
                                } catch (error) {
                                    if (error.name !== 'AbortError') {
                                        console.warn(`[WalletManagerService] Failed to fetch price for ${symbol}:`, error.message);
                                    }
                                }
                                return null;
                            });
                            
                            const batchResults = await Promise.all(batchPromises);
                            batchResults.forEach(result => {
                                if (result) {
                                    currentPrices[result.symbol] = result.price;
                                }
                            });
                            
                            // Small delay between batches to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, 50)); // Minimal delay for faster processing of all assets
                        }
                        
                    } catch (priceError) {
                        console.warn('[WalletManagerService] ⚠️ Failed to fetch prices, using empty prices:', priceError.message);
                    }
                }
                
                await this.updateWalletSummary(walletState, currentPrices);
            } catch (summaryError) {
                console.warn('[WalletManagerService] ⚠️ Failed to update wallet summary:', summaryError.message);
                // Don't throw here - wallet state is still valid
            }
            
            
            console.log(`[WalletManagerService] ✅ Successfully initialized wallet with ${walletState.balances?.length || 0} balances`);
            return walletState;
        } catch (error) {
            this.scannerService.addLog(`[${tradingMode.toUpperCase()}_WALLET] ❌ Failed to initialize wallet: ${error.message}`, 'error', error);

            console.error('═══════════════════════════════════════════════════════');
            console.error('[WalletManagerService] ❌ initializeLiveWallet() FAILED');
            console.error('[WalletManagerService] Error:', error.message);
            console.error('[WalletManagerService] Stack:', error.stack);

            if (error.response) { // Check for Axios-like error response structure
                console.error('[WalletManagerService] HTTP Error Response:', error.response);
                console.error('[WalletManagerService] Response status:', error.response.status);
                console.error('[WalletManagerService] Response data:', error.response.data);
            }

            console.error('═══════════════════════════════════════════════════════');
            throw error;
        }
    }

    /**
     * Refreshes the LiveWalletState from the database
     */
    async refreshWalletStateFromDB() {
        const mode = this.scannerService.getTradingMode();
        this.scannerService.addLog(`[${mode.toUpperCase()}_WALLET] 🔄 Refreshing wallet state from database...`, 'system');

        try {
            const wallets = await queueEntityCall('LiveWalletState', 'filter', { mode });

            if (!wallets || wallets.length === 0) {
                throw new Error(`No ${mode} wallet state found in database`);
            }

            if (wallets.length > 1) {
                this.scannerService.addLog(`[${mode.toUpperCase()}_WALLET] ⚠️ Found ${wallets.length} wallet states, using most recent`, 'warning');
                wallets.sort((a, b) => new Date(b.last_updated_timestamp || 0) - new Date(a.last_updated_timestamp || 0));
            }

            const refreshedWallet = wallets[0];
            this.scannerService.state.liveWalletState = refreshedWallet;

            // Reload into PositionManager
            if (this.scannerService.positionManager) {
                await this.scannerService.positionManager.loadManagedState(refreshedWallet);
            }

            this.scannerService.addLog(`[${mode.toUpperCase()}_WALLET] ✅ Wallet state refreshed from DB (ID: ${refreshedWallet.id})`, 'success');
            return refreshedWallet;

        } catch (error) {
            this.scannerService.addLog(`[${mode.toUpperCase()}_WALLET] ❌ Failed to refresh wallet from DB: ${error.message}`, 'error', error);
            throw error;
        }
    }

    /**
     * Resets wallet data (deletes LiveWalletState and all associated Trades/LivePositions for the current mode)
     */
    async resetWalletData(mode) {
        let walletsDeleted = 0;
        let tradesDeleted = 0;
        let livePositionsDeleted = 0;

        try {
            // Delete all LiveWalletState records for this mode
            const walletsToDelete = await queueEntityCall('LiveWalletState', 'filter', { mode });
            
            if (walletsToDelete && walletsToDelete.length > 0) {
                for (const wallet of walletsToDelete) {
                    try {
                        await queueEntityCall('LiveWalletState', 'delete', wallet.id);
                        walletsDeleted++;
                    } catch (e) {
                        console.warn(`[WalletManagerService] ⚠️ Could not delete wallet ${wallet.id}: ${e.message}`);
                    }
                }
            }

            // Delete all Trade records for this mode
            const tradesToDelete = await queueEntityCall('Trade', 'filter', { trading_mode: mode });
            
            if (tradesToDelete && tradesToDelete.length > 0) {
                for (const trade of tradesToDelete) {
                    try {
                        await queueEntityCall('Trade', 'delete', trade.id);
                        tradesDeleted++;
                    } catch (e) {
                        console.warn(`[WalletManagerService] ⚠️ Could not delete trade ${trade.id}: ${e.message}`);
                    }
                }
            }

            // Delete all LivePosition records for this mode
            const livePositionsToDelete = await queueEntityCall('LivePosition', 'filter', { trading_mode: mode });
            
            if (livePositionsToDelete && livePositionsToDelete.length > 0) {
                for (const pos of livePositionsToDelete) {
                    try {
                        await queueEntityCall('LivePosition', 'delete', pos.id);
                        livePositionsDeleted++;
                    } catch (e) {
                        console.warn(`[WalletManagerService] ⚠️ Could not delete LivePosition ${pos.id}: ${e.message}`);
                    }
                }
            }

            // Delete all WalletSummary records for this mode
            const summariesToDelete = await queueEntityCall('WalletSummary', 'filter', { mode });

            if (summariesToDelete && summariesToDelete.length > 0) {
                for (const summary of summariesToDelete) {
                    try {
                        await queueEntityCall('WalletSummary', 'delete', summary.id);
                    } catch (e) {
                        // Silent fail for WalletSummary deletions, as per original logic.
                        console.warn(`[WalletManagerService] ⚠️ Could not delete WalletSummary ${summary.id}: ${e.message}`);
                    }
                }
            }

            return {
                success: true,
                walletsDeleted,
                tradesDeleted,
                livePositionsDeleted
            };

        } catch (error) {
            console.error('═══════════════════════════════════════════════════════');
            console.error('[WalletManagerService] ❌ resetWalletData error:', error);
            console.error('[WalletManagerService] Error stack:', error.stack);
            console.error('═══════════════════════════════════════════════════════');
            
            return {
                success: false,
                error: error
            };
        }
    }

    /**
     * Helper to format currency values.
     * @param {number} value The numeric value to format.
     * @returns {string} The formatted currency string.
     */
    _formatCurrency(value) {
        if (typeof value !== 'number') return 'N/A';
        const formatted = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `$${formatted}`;
    }

    /**
     * Compute unrealized P&L for all open positions using provided prices map
     */
    _computeUnrealizedPnl(liveWalletState, prices = {}) {
        const positions = (liveWalletState?.positions || []).filter(p => p && (p.status === 'open' || p.status === 'trailing'));
        let total = 0;
        const breakdown = [];

        for (const pos of positions) {
            const symbolKey = (pos.symbol || '').replace('/', '');
            const current = Number(prices[symbolKey]);
            const entry = Number(pos.entry_price);
            const qty = Number(pos.quantity_crypto);

            if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(entry) || !Number.isFinite(qty) || qty <= 0) {
                continue;
            }

            // Spot trades are long by default; keep direction check to be safe
            const isLong = (pos.direction || 'long') === 'long';
            const pnlUsd = isLong ? (current - entry) * qty : (entry - current) * qty;

            total += pnlUsd;
            breakdown.push({
                position_id: pos.position_id,
                symbol: symbolKey,
                direction: pos.direction || 'long',
                entry_price: entry,
                current_price: current,
                quantity_crypto: qty,
                pnl_usd: Number(pnlUsd.toFixed(6))
            });
        }

        return { totalUnrealizedPnl: Number(total.toFixed(2)), positionBreakdown: breakdown };
    }

    /**
     * Computes capital allocated to open positions (entry value) and current value using live prices
     * @param {object} liveWalletState The current live wallet state.
     * @param {object} prices An object mapping symbols (e.g., 'BTCUSDT') to their current prices.
     * @returns {object} An object containing `balanceAllocated`, `currentValue`, and `openCount`.
     */
    _computeBalanceInTrades(liveWalletState, prices = {}) {
        const positions = (liveWalletState?.positions || []).filter(
            p => p && (p.status === 'open' || p.status === 'trailing')
        );
        let allocated = 0; // sum of entry_value_usdt (fallback to qty * entry_price/price)
        let currentValue = 0;

        for (const pos of positions) {
            const symbolKey = (pos.symbol || '').replace('/', '');
            const qty = Number(pos.quantity_crypto);
            const entryPrice = Number(pos.entry_price);
            const entryValue = Number(pos.entry_value_usdt);
            const livePrice = Number(prices[symbolKey]);

            // Allocated capital at entry
            if (Number.isFinite(entryValue) && entryValue > 0) {
                allocated += entryValue;
            } else if (Number.isFinite(qty) && qty > 0) {
                const fallbackPrice = Number.isFinite(entryPrice) && entryPrice > 0
                    ? entryPrice
                    : (Number.isFinite(livePrice) && livePrice > 0 ? livePrice : NaN);
                if (Number.isFinite(fallbackPrice)) {
                    allocated += qty * fallbackPrice;
                }
            }

            // Current mark-to-market value
            if (Number.isFinite(qty) && qty > 0 && Number.isFinite(livePrice) && livePrice > 0) {
                currentValue += qty * livePrice;
            }
        }

        return {
            balanceAllocated: Number(allocated.toFixed(2)),
            currentValue: Number(currentValue.toFixed(2)),
            openCount: positions.length
        };
    }

    // TEMP: Inspect and attempt to fix incomplete positions (logs root cause indicators)
    _inspectAndFixPositions(walletState) {
        try {
            const positions = Array.isArray(walletState?.positions) ? walletState.positions : [];
            let incompleteCount = 0;
            let fixedCount = 0;

            positions.forEach((p, idx) => {
                const ep = Number(p?.entry_price);
                const qty = Number(p?.quantity_crypto);
                const ev = Number(p?.entry_value_usdt);

                const missingPrice = !(Number.isFinite(ep) && ep > 0);
                const missingQty = !(Number.isFinite(qty) && qty > 0);
                const missingEV = !(Number.isFinite(ev) && ev > 0);

                if (missingPrice || missingQty || missingEV) {
                    incompleteCount++;
                    const before = { ep: p?.entry_price, qty: p?.quantity_crypto, ev: p?.entry_value_usdt };

                    // Attempt simple fixes if two of three values exist
                    let newPrice = ep, newQty = qty, newEV = ev;

                    if (missingEV && !missingPrice && !missingQty) {
                        newEV = Number((qty * ep).toFixed(8));
                    } else if (missingQty && !missingPrice && !missingEV && ep > 0) {
                        newQty = Number((ev / ep).toFixed(8));
                    } else if (missingPrice && !missingQty && !missingEV && qty > 0) {
                        newPrice = Number((ev / qty).toFixed(10));
                    }

                    // Apply fixes if valid
                    const anyFixed =
                        (missingEV && Number.isFinite(newEV) && newEV > 0) ||
                        (missingQty && Number.isFinite(newQty) && newQty > 0) ||
                        (missingPrice && Number.isFinite(newPrice) && newPrice > 0);

                    if (anyFixed) {
                        fixedCount++;
                        p.entry_price = newPrice;
                        p.quantity_crypto = newQty;
                        p.entry_value_usdt = newEV;

                        console.warn('[WalletManagerService][FIX] Patched incomplete position', {
                            idx,
                            symbol: p?.symbol,
                            position_id: p?.position_id,
                            before,
                            after: { ep: newPrice, qty: newQty, ev: newEV },
                            status: p?.status
                        });
                    } else {
                        console.warn('[WalletManagerService][INCOMPLETE] Position missing critical fields', {
                            idx,
                            symbol: p?.symbol,
                            position_id: p?.position_id,
                            entry_price: p?.entry_price,
                            quantity_crypto: p?.quantity_crypto,
                            entry_value_usdt: p?.entry_value_usdt,
                            status: p?.status,
                            note: 'Downstream save logic should block creation when fields are invalid. Check PositionManager/openOrder flow.'
                        });
                    }
                }
            });

        } catch (e) {
            console.error('[WalletManagerService] _inspectAndFixPositions error:', e?.message || e);
        }
    }

    /**
     * Updates and saves a WalletSummary snapshot
     */
    async updateWalletSummary(walletState, currentPrices = {}) {
        /*console.log('[WalletManagerService] ===== updateWalletSummary CALLED =====');
        console.log('[WalletManagerService] Wallet ID:', walletState?.id);
        console.log('[WalletManagerService] Mode:', walletState?.mode);
        console.log('[WalletManagerService] Current prices keys:', Object.keys(currentPrices || {}).length);
        */
        if (!walletState) {
            console.warn('[WalletManagerService] ⚠️ No wallet state provided to updateWalletSummary');
            return null;
        }

        try {
            // NEW: Inspect and try to patch incomplete positions before calculations
            this._inspectAndFixPositions(walletState);

            const mode = walletState.mode || 'testnet';
            //console.log('[WalletManagerService] Processing for mode:', mode);

            // Get all closed trades for this mode
            //console.log('[WalletManagerService] Fetching trades for mode:', mode);
            const allTrades = await queueEntityCall('Trade', 'filter', { trading_mode: mode });
            //console.log('[WalletManagerService] Total trades fetched:', allTrades?.length || 0);

            // Calculate aggregate stats from closed trades
            const totalTradesCount = allTrades?.length || 0;
            const winningTrades = allTrades?.filter(t => (t.pnl_usdt || 0) > 0) || [];
            const winningTradesCount = winningTrades.length;
            const totalRealizedPnl = allTrades?.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0) || 0;
            const totalGrossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
            const losingTrades = allTrades?.filter(t => (t.pnl_usdt || 0) < 0) || [];
            const totalGrossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0));
            const totalFeesPaid = allTrades?.reduce((sum, t) => sum + (t.total_fees_usdt || 0), 0) || 0;

            /*console.log('[WalletManagerService] Trade statistics:', {
                totalTradesCount,
                winningTradesCount,
                totalRealizedPnl,
                totalGrossProfit,
                totalGrossLoss,
                totalFeesPaid
            });*/

            // Update wallet state with aggregated stats
            walletState.total_trades_count = totalTradesCount;
            walletState.winning_trades_count = winningTradesCount;
            walletState.losing_trades_count = totalTradesCount - winningTradesCount;
            walletState.total_realized_pnl = totalRealizedPnl;
            walletState.total_gross_profit = totalGrossProfit;
            walletState.total_gross_loss = totalGrossLoss;
            walletState.total_fees_paid = totalFeesPaid;

            /*console.log('[WalletManagerService] Updated wallet state aggregates:', {
                total_trades_count: walletState.total_trades_count,
                total_realized_pnl: walletState.total_realized_pnl,
                winning_trades_count: walletState.winning_trades_count
            });*/

            // Calculate unrealized P&L from open positions
            const { totalUnrealizedPnl, positionBreakdown } = this._computeUnrealizedPnl(walletState, currentPrices);

            // Calculate balance allocated in trades (and current value)
            const { balanceAllocated, currentValue, openCount } = this._computeBalanceInTrades(walletState, currentPrices);

            // Ensure walletSummary object exists and start populating it with core values
            this.walletSummary = this.walletSummary || {};

            this.walletSummary.unrealizedPnl = Number(totalUnrealizedPnl.toFixed(2));
            this.walletSummary.balanceInTrades = Number(balanceAllocated.toFixed(2));
            this.walletSummary.openPositionsCount = openCount;

            // --- Integrate wallet balance calculations (previously in _calculateAndPersistWalletSummary) ---
            const { balances = [] } = walletState;
            const fiatCurrencies = new Set(['EUR', 'TRY', 'ZAR', 'GBP', 'AUD', 'BRL', 'JPY', 'RUB', 'UAH', 'NGN', 'PLN', 'RON', 'ARS', 'INR', 'CZK', 'MXN', 'COP']);
            const MIN_BALANCE_THRESHOLD = 0.001;

            let availableBalance = 0;
            let totalCryptoValueUsd = 0;

            const usdtBalanceObject = balances.find(b => b.asset === 'USDT');
            availableBalance = parseFloat(usdtBalanceObject?.free || 0);

            const nonUsdtBalances = balances.filter(b => b.asset !== 'USDT' && !fiatCurrencies.has(b.asset));
            
            
            for (const balance of nonUsdtBalances) {
                const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);
                
                // Skip dust assets
                if (total <= MIN_BALANCE_THRESHOLD) {
                    continue;
                }

                const symbol = `${balance.asset}USDT`;
                const price = currentPrices[symbol];

                if (price && parseFloat(price) > 0) {
                    const numericPrice = parseFloat(price);
                    const usdValue = total * numericPrice;
                    totalCryptoValueUsd += usdValue;
                } else {
                    // Debug: Log assets without prices
                }
            }

            // Calculate overall metrics based on all computed values
            const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : 0;
            const winRate = totalTradesCount > 0 ? (winningTradesCount / totalTradesCount) * 100 : 0;

            // Debug logging for total equity calculation

            const totalEquity = availableBalance + totalCryptoValueUsd + this.walletSummary.unrealizedPnl;
            const portfolioUtilization = totalEquity > 0 ? (this.walletSummary.balanceInTrades / totalEquity) * 100 : 0;

            // Update this.walletSummary with these additional calculated values
            this.walletSummary.mode = mode;
            this.walletSummary.totalEquity = Number(totalEquity.toFixed(2));
            
            // Fallback: If totalCryptoValueUsd is 0 but we have non-USDT balances, 
            // use a conservative estimate based on available balance
            if (totalCryptoValueUsd === 0 && nonUsdtBalances.length > 0) {
                // Use a conservative estimate: assume crypto assets are worth 10% of available balance
                const fallbackCryptoValue = availableBalance * 0.1;
                const fallbackTotalEquity = availableBalance + fallbackCryptoValue + this.walletSummary.unrealizedPnl;
                // Update the total equity with fallback value
                this.walletSummary.totalEquity = Number(fallbackTotalEquity.toFixed(2));
                walletState.total_equity = this.walletSummary.totalEquity;
            }
            this.walletSummary.availableBalance = Number(availableBalance.toFixed(2));
            
            // FIX: Update the walletState object with the calculated total_equity
            walletState.total_equity = this.walletSummary.totalEquity;
            // balanceInTrades, unrealizedPnl, openPositionsCount already set
            this.walletSummary.totalCryptoValueUsd = Number(totalCryptoValueUsd.toFixed(2));
            this.walletSummary.totalRealizedPnl = Number(totalRealizedPnl.toFixed(2));
            this.walletSummary.totalTradesCount = totalTradesCount;
            this.walletSummary.winningTradesCount = winningTradesCount;
            this.walletSummary.totalGrossProfit = Number(totalGrossProfit.toFixed(2));
            this.walletSummary.totalGrossLoss = Number(totalGrossLoss.toFixed(2));
            this.walletSummary.profitFactor = Number(profitFactor.toFixed(2));
            this.walletSummary.winRate = Number(winRate.toFixed(2));
            this.walletSummary.portfolioUtilization = Number(portfolioUtilization.toFixed(2));
            
            this.walletSummary.lastUpdated = new Date().toISOString();
            this.walletSummary.sourceLiveWalletId = walletState.id;

            // Keep detailed breakdown for debugging/inspection in UI if needed (not persisted to DB directly)
            this.walletSummary.calculationBreakdown = this.walletSummary.calculationBreakdown || {};
            this.walletSummary.calculationBreakdown.openPositions = positionBreakdown;
            this.walletSummary.calculationBreakdown.pricesUsed = currentPrices;
            this.walletSummary.calculationBreakdown.openPositionsCurrentValueSum = currentValue;
            this.walletSummary.calculationBreakdown.openPositionsAllocatedSum = balanceAllocated;


            // Persist the summary to the database (only the fields that exist in the database)
            const dbSummaryData = {
                trading_mode: this.walletSummary.mode,
                total_equity: this.walletSummary.totalEquity,
                available_balance: this.walletSummary.availableBalance,
                total_realized_pnl: this.walletSummary.totalRealizedPnl,
                unrealized_pnl: this.walletSummary.unrealizedPnl
            };

            
            // FIX: Also update the wallet state with the calculated total_equity
            await queueEntityCall('LiveWalletState', 'update', walletState.id, { total_equity: walletState.total_equity });
            
            const summaries = await queueEntityCall('WalletSummary', 'filter', { trading_mode: mode });
            
            if (summaries && summaries.length > 0) {
                const updateResult = await queueEntityCall('WalletSummary', 'update', summaries[0].id, dbSummaryData);
            } else {
                const createResult = await queueEntityCall('WalletSummary', 'create', dbSummaryData);
            }
            
            if (this.walletSummary) {
                // Log key summary metrics. The calculationBreakdown is removed from summaryData in the new outline.
                // console.log('[WalletManagerService] ✅ Summary calculated:', { // Removed debug log
                //     totalEquity: summary.totalEquity,
                //     availableBalance: summary.availableBalance,
                //     totalCryptoValueUsd: summary.totalCryptoValueUsd,
                //     unrealizedPnl: summary.unrealizedPnl
                // });
            }

            //console.log('[WalletManagerService] ===== updateWalletSummary COMPLETE =====');
            // Make sure any return value contains the updated unrealizedPnl
            return this.walletSummary;

        } catch (error) {
            console.error('[WalletManagerService] ❌ Error in updateWalletSummary:', error);
            console.error('[WalletManagerService] Error stack:', error.stack);
            this.scannerService.addLog(`[${walletState?.mode?.toUpperCase() || 'UNKNOWN'}_WALLET] ❌ Failed to update wallet summary: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * Logs the current wallet summary to the scanner logs
     */
    async logWalletSummary() {
        const walletState = this.scannerService.state.liveWalletState;
        const tradingMode = this.scannerService.getTradingMode();
        
        if (!walletState) {
            this.scannerService.addLog('[WALLET] ⚠️ No wallet state available for summary', 'warning');
            return;
        }

        try {
            // Fetch the absolute latest WalletSummary from database
            const summaries = await queueEntityCall('WalletSummary', 'filter', { mode: tradingMode }, '-lastUpdated', 1);
            const latestSummary = summaries?.[0];
            
            if (!latestSummary) {
                this.scannerService.addLog('[WALLET] ⚠️ No WalletSummary found in database', 'warning');
                return;
            }

            this.scannerService.addLog('═══════════════════════════════════════════════════════', 'cycle-end');
            this.scannerService.addLog(`💰 ${tradingMode.toUpperCase()} WALLET SUMMARY`, 'cycle-end');
            this.scannerService.addLog('═══════════════════════════════════════════════════════', 'cycle-end');
            
            this.scannerService.addLog(`[WALLET] Total Trades: ${latestSummary.totalTradesCount || 0} | Win Rate: ${(latestSummary.winRate || 0).toFixed(1)}% | Profit Factor: ${(latestSummary.profitFactor || 0).toFixed(2)}`, 'info');
            this.scannerService.addLog(`[WALLET] Open Positions: ${latestSummary.openPositionsCount || 0} | Portfolio Utilization: ${(latestSummary.portfolioUtilization || 0).toFixed(1)}%`, 'info');
            this.scannerService.addLog(`[WALLET] Unrealized P&L: ${this._formatCurrency(latestSummary.unrealizedPnl || 0)} | Realized P&L: ${this._formatCurrency(latestSummary.totalRealizedPnl || 0)}`, 'info');
            this.scannerService.addLog(`[WALLET] Available: ${this._formatCurrency(latestSummary.availableBalance || 0)} | In Trades: ${this._formatCurrency(latestSummary.balanceInTrades || 0)} | Crypto Holdings: ${this._formatCurrency(latestSummary.totalCryptoValueUsd || 0)}`, 'info');
            this.scannerService.addLog(`[WALLET] Mode: ${tradingMode.toUpperCase()} | Total Equity: ${this._formatCurrency(latestSummary.totalEquity || 0)}`, 'info');
            this.scannerService.addLog('═══════════════════════════════════════════════════════', 'cycle-end');

        } catch (error) {
            // console.error('[WalletManagerService] ❌ Error in logWalletSummary:', error); // Removed debug log
            this.scannerService.addLog(`[WALLET] ❌ Failed to log wallet summary: ${error.message}`, 'error');
        }
    }
}

// Export functions to integrate with AutoScannerService
export function initializeWalletManagerService(scannerService) {
    return new WalletManagerService(scannerService);
}

export function extendWalletManagerService(scannerService, walletManagerService) {
    // Bind wallet manager methods to scanner service for convenience
    scannerService.initializeLiveWallet = walletManagerService.initializeLiveWallet.bind(walletManagerService);
    scannerService.refreshWalletStateFromDB = walletManagerService.refreshWalletStateFromDB.bind(walletManagerService);
    scannerService.updateWalletSummary = walletManagerService.updateWalletSummary.bind(walletManagerService);
    scannerService.logWalletSummary = walletManagerService.logWalletSummary.bind(walletManagerService);
}

export default WalletManagerService;
