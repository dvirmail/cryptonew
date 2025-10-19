
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
        const tradingMode = this.scannerService.getTradingMode();
        const proxyUrl = this.scannerService.state?.settings?.local_proxy_url;

        if (!proxyUrl) {
            throw new Error('local_proxy_url is not configured in ScanSettings. Please configure it in Settings page.');
        }

        try {
            const accountResponse = await queueFunctionCall(
                liveTradingAPI,
                {
                    action: 'getAccountInfo',
                    tradingMode: tradingMode,
                    proxyUrl: proxyUrl
                },
                'critical',
                null, // queueKey changed to null
                0,    // callTimeout changed to 0
                30000
            );

            if (!accountResponse?.data?.success) {
                throw new Error(accountResponse?.data?.error || 'Failed to fetch account info');
            }

            const accountData = accountResponse.data.data?.data || accountResponse.data.data;
            
            const usdtBalance = accountData.balances?.find(b => b.asset === 'USDT');
            
            const nonZeroBalances = accountData.balances?.filter(b => {
                const total = parseFloat(b.free || 0) + parseFloat(b.locked || 0);
                return total > 0 && b.asset !== 'USDT';
            }) || [];

            if (nonZeroBalances.length > 0) {
                // console.log('[WalletManagerService] 📊 Non-zero crypto holdings:'); // Removed debug log
                nonZeroBalances.forEach(b => {
                    // const total = parseFloat(b.free || 0) + parseFloat(b.locked || 0); // Removed debug log
                    // console.log(`  - ${b.asset}: ${total.toFixed(8)} (Free: ${parseFloat(b.free || 0).toFixed(8)}, Locked: ${parseFloat(b.locked || 0).toFixed(8)})`); // Removed debug log
                });
            }

            const existingWallets = await queueEntityCall('LiveWalletState', 'filter', { mode: tradingMode });

            let walletState;
            if (existingWallets && existingWallets.length > 0) {
                walletState = existingWallets[0];

                if (existingWallets.length > 1) {
                    console.log(`[WalletManagerService] ⚠️ Found ${existingWallets.length} duplicate wallet states. Using most recent. ID: ${walletState.id}`);
                }

                const oldUsdtBalance = walletState.balances?.find(b => b.asset === 'USDT');
                if (oldUsdtBalance) {
                    const oldFree = parseFloat(oldUsdtBalance.free || 0);
                    const newFree = parseFloat(usdtBalance?.free || 0);
                    const difference = newFree - oldFree;
                    if (Math.abs(difference) > 0.00000001) {
                        // console.log(`[WalletManagerService] 💰 USDT Balance changed from ${oldFree.toFixed(2)} to ${newFree.toFixed(2)} (Diff: ${difference.toFixed(2)})`); // Removed debug log
                    }
                } else {
                    console.log('[WalletManagerService] ⚠️ No old USDT balance found in database for comparison');
                }

                walletState.binance_account_type = accountData.accountType;
                walletState.balances = accountData.balances;
                walletState.last_binance_sync = new Date().toISOString();
                walletState.last_updated_timestamp = new Date().toISOString(); // Also update general timestamp

                await queueEntityCall('LiveWalletState', 'update', walletState.id, walletState);
            } else {
                console.log('[WalletManagerService] ⚠️ No existing wallet state found, creating new one...');
                walletState = {
                    mode: tradingMode,
                    binance_account_type: accountData.accountType,
                    balances: accountData.balances,
                    positions: [], // This array is generally not populated with full position objects in this service
                    live_position_ids: [],
                    total_trades_count: 0,
                    winning_trades_count: 0,
                    losing_trades_count: 0,
                    total_realized_pnl: 0,
                    total_gross_profit: 0,
                    total_gross_loss: 0,
                    total_fees_paid: 0,
                    last_updated_timestamp: new Date().toISOString(),
                    last_binance_sync: new Date().toISOString()
                };

                const createdWallet = await queueEntityCall('LiveWalletState', 'create', walletState);
                walletState = createdWallet;
            }

            this.scannerService.state.liveWalletState = walletState;
            
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

            if (incompleteCount > 0) {
                console.log(`[WalletManagerService] Incomplete positions detected: ${incompleteCount}, auto-fixed: ${fixedCount}`);
            }
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
            const fiatCurrencies = new Set(['EUR', 'TRY', 'ZAR', 'GBP', 'AUD', 'BRL', 'JPY', 'RUB', 'UAH', 'NGN', 'PLN', 'RON', 'ARS', 'INR']);
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

                if (price && price > 0) {
                    const usdValue = total * price;
                    totalCryptoValueUsd += usdValue;
                }
            }

            // Calculate overall metrics based on all computed values
            const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : 0;
            const winRate = totalTradesCount > 0 ? (winningTradesCount / totalTradesCount) * 100 : 0;

            const totalEquity = availableBalance + totalCryptoValueUsd + this.walletSummary.unrealizedPnl;
            const portfolioUtilization = totalEquity > 0 ? (this.walletSummary.balanceInTrades / totalEquity) * 100 : 0;

            // Update this.walletSummary with these additional calculated values
            this.walletSummary.mode = mode;
            this.walletSummary.totalEquity = Number(totalEquity.toFixed(2));
            this.walletSummary.availableBalance = Number(availableBalance.toFixed(2));
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


            // Persist the summary to the database (only the fields meant for DB storage)
            const dbSummaryData = {
                mode: this.walletSummary.mode,
                totalEquity: this.walletSummary.totalEquity,
                availableBalance: this.walletSummary.availableBalance,
                balanceInTrades: this.walletSummary.balanceInTrades,
                unrealizedPnl: this.walletSummary.unrealizedPnl,
                totalCryptoValueUsd: this.walletSummary.totalCryptoValueUsd,
                totalRealizedPnl: this.walletSummary.totalRealizedPnl,
                totalTradesCount: this.walletSummary.totalTradesCount,
                winningTradesCount: this.walletSummary.winningTradesCount,
                totalGrossProfit: this.walletSummary.totalGrossProfit,
                totalGrossLoss: this.walletSummary.totalGrossLoss,
                profitFactor: this.walletSummary.profitFactor,
                winRate: this.walletSummary.winRate,
                openPositionsCount: this.walletSummary.openPositionsCount,
                portfolioUtilization: this.walletSummary.portfolioUtilization,
                lastUpdated: this.walletSummary.lastUpdated,
                sourceLiveWalletId: this.walletSummary.sourceLiveWalletId
            };

            const summaries = await queueEntityCall('WalletSummary', 'filter', { mode });
            if (summaries && summaries.length > 0) {
                await queueEntityCall('WalletSummary', 'update', summaries[0].id, dbSummaryData);
            } else {
                await queueEntityCall('WalletSummary', 'create', dbSummaryData);
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
