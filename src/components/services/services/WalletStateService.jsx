/**
 * WalletStateService
 * 
 * Manages wallet state operations, balance calculations, and wallet-related utilities.
 * This service handles all wallet state management and provides wallet-related helper methods.
 */

import { queueFunctionCall } from '@/components/utils/apiQueue';
import { apiQueue } from '@/components/utils/apiQueue';
import { formatUSDT, formatPrice } from '@/components/utils/priceFormatter';

export class WalletStateService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        this.notifyWalletSubscribers = scannerService.notifyWalletSubscribers.bind(scannerService);
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference
    }

    // Helper: get current wallet state from CentralWalletStateManager
    _getCurrentWalletState() {
        return this.scannerService.walletManagerService?.getCurrentWalletState() || this._getCurrentWalletState();
    }

    /**
     * Reinitializes wallet from Binance and updates all related state.
     * @returns {boolean} True if successful, false otherwise.
     */
    async reinitializeWalletFromBinance() {
        if (!this.scannerService.walletManagerService) {
            throw new Error('WalletManagerService is not initialized');
        }

        try {
            await this.scannerService.walletManagerService.initializeLiveWallet();

            // NEW: ensure wallet mode is always set for downstream services
            if (this._getCurrentWalletState() && !this._getCurrentWalletState().mode) {
                this._getCurrentWalletState().mode = this.scannerService.state.tradingMode || 'testnet';
            }

            await this.scannerService.walletManagerService.updateWalletSummary(
                this._getCurrentWalletState(), 
                this.scannerService.priceManagerService.currentPrices
            );
            await this._persistLatestWalletSummary();
            this.notifyWalletSubscribers();

            return true;
        } catch (error) {
            console.error('[AutoScannerService] ❌ Failed to reinitialize wallet from Binance:', error);
            throw error;
        }
    }

    /**
     * Gets the available USDT balance from the current wallet state.
     * @returns {number} Available USDT balance.
     */
    _getAvailableUsdt() {
        const currentWalletState = this._getCurrentWalletState();
        
        if (currentWalletState) {
            // CentralWalletState stores balance directly in available_balance
            const availableBalance = parseFloat(currentWalletState.available_balance || '0');
            if (Number.isFinite(availableBalance)) {
                return availableBalance;
            }
            
            console.warn(`[WalletStateService] ⚠️ Invalid available_balance in wallet state: ${currentWalletState.available_balance}`);
            return 0; // Return 0 instead of throwing error
        }
        
        console.log(`[WalletStateService] 💰 No current wallet state available, returning 0`);
        return 0;
    }

    /**
     * Computes current balance allocated across open/trailing positions (entry basis).
     * @returns {number} Total balance allocated in trades.
     */
    _getBalanceAllocatedInTrades() {
        const positions = (this._getCurrentWalletState()?.positions || []).filter(
            p => p && (p.status === 'open' || p.status === 'trailing')
        );
        let allocated = 0;
        for (const pos of positions) {
            const qty = Number(pos.quantity_crypto);
            const entryValue = Number(pos.entry_value_usdt);
            const entryPrice = Number(pos.entry_price);
            const symbol = (pos.symbol || '').replace('/', '');
            const livePrice = Number(this.scannerService.priceManagerService.currentPrices?.[symbol]);

            if (Number.isFinite(entryValue) && entryValue > 0) {
                allocated += entryValue;
            } else if (Number.isFinite(qty) && qty > 0) {
                const price = Number.isFinite(entryPrice) && entryPrice > 0
                    ? entryPrice
                    : (Number.isFinite(livePrice) && livePrice > 0 ? livePrice : NaN);
                if (Number.isFinite(price)) {
                    allocated += qty * price;
                }
            }
        }
        return allocated;
    }

    /**
     * Resets wallet and restarts the scanner with clean state.
     * This is a comprehensive reset that clears all positions, trades, and state.
     */
    async resetWalletAndRestart() {
        const modeText = this.scannerService.isLiveMode() ? 'LIVE ACCOUNT' : 'TESTNET ACCOUNT';

        console.log(`[AutoScannerService] 🚨 ${modeText} RESET INITIATED. ${this.scannerService.isLiveMode() ? 'Closing all live positions' : 'Closing all testnet positions'} for a clean slate.`);

        if (this.scannerService.isHardResetting) {
            console.warn('[AutoScannerService] Reset already in progress. Aborting new request.');
            return;
        }
        this.scannerService.isHardResetting = true;

        try {
            if (this.scannerService.state.isRunning) {
                this.scannerService.stop();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`[AutoScannerService] 🔥 Clearing local state and database records for ${modeText}...`);

            // Step 1: Purge all LivePosition records
            console.log(`[AutoScannerService] [RESET] Purging all LivePosition records for ${this.scannerService.state.tradingMode.toUpperCase()} mode...`);

            try {
                const purgeResponse = await queueFunctionCall(
                    'purgeAllPositions',
                    { mode: this.scannerService.state.tradingMode },
                    'critical',
                    null,
                    0,
                    60000
                );

                if (purgeResponse?.data?.success) {
                    console.log(`[AutoScannerService] [RESET] ✅ Purged ${purgeResponse.data.deletedCount} LivePosition records for ${this.scannerService.state.tradingMode.toUpperCase()} mode.`);
                } else {
                    console.warn(`[AutoScannerService] [RESET] ⚠️ LivePosition purge had issues: ${purgeResponse?.data?.error || 'Unknown error'}. Continuing with reset.`);
                }
            } catch (purgeError) {
                console.error('[AutoScannerService] ❌ Error purging positions:', purgeError);
                console.warn(`[AutoScannerService] [RESET] ⚠️ Failed to purge LivePositions: ${purgeError.message}. Continuing with reset.`);
            }

            // Step 2: Regular wallet reset (clears trades, wallet state, etc.)
            const purgeResult = await this.scannerService.walletManagerService.resetWalletData(this.scannerService.getTradingMode());

            if (purgeResult?.success) {
                console.log(`[AutoScannerService] ✅ Server-side managed data cleared for ${this.scannerService.state.tradingMode.toUpperCase()} mode. Wallets: ${purgeResult.walletsDeleted}, Trades: ${purgeResult.tradesDeleted}`);
            } else {
                console.warn(`[AutoScannerService] ⚠️ Could not clear server-side data: ${purgeResult?.error?.message || 'Unknown error'}. Continuing with reset.`);
            }

            // Step 3: Clear API queue cache
            apiQueue.clearCache();

            // Step 4: Reinitialize wallet from Binance
            await this.scannerService.walletManagerService.initializeLiveWallet();

            // Step 5: Reset stats and state
            this.scannerService.state.stats = {
                activeStrategies: this.scannerService.state.activeStrategies.length,
                totalScans: 0, signalsFound: 0, tradesExecuted: 0, totalPnL: 0, successRate: 0,
                averageSignalStrength: 0,
                totalScanCycles: 0,
                averageScanTimeMs: 0,
                lastScanTimeMs: 0
            };
            this.scannerService.scanEngineService.scanCycleTimes = [];
            this.scannerService.state.logs.activity = [];
            this.scannerService.performanceMetricsService.resetState();
            this.scannerService.tradeArchivingService.resetState();
            this.scannerService.priceManagerService.currentPrices = {};
            this.scannerService.state.momentumBreakdown = null;
            this.scannerService.state.signalGenerationHistory = [];
            this.scannerService.state.marketVolatility = { adx: 25, bbw: 0.1 };
            this.scannerService.state.fearAndGreedData = null;
            this.scannerService.state.marketAlerts = [];
            this.scannerService.state.newPositionsCount = 0; // Reset new positions count
            this.scannerService.state.adjustedBalanceRiskFactor = 100; // Reset adjusted risk factor

            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 🔄 ${modeText} RESET COMPLETED`);
            console.log('════════════════════════════════════════════════════════════');
            console.log(`[AutoScannerService] 💰 ${modeText} refreshed from Binance (Wallet ID: ${this._getCurrentWalletState()?.id}).`);
            console.log('[AutoScannerService] Scanner is ready for a fresh start with clean position tracking.');
            console.log('════════════════════════════════════════════════════════════');

            await this.scannerService.walletManagerService.updateWalletSummary(
                this._getCurrentWalletState(), 
                this.scannerService.priceManagerService.currentPrices
            );
            this.notifyWalletSubscribers();
            this.scannerService.notifySubscribers();

            console.log(`[AutoScannerService] 🚀 Restarting scanner in ${this.scannerService.state.tradingMode.toUpperCase()} mode...`);
            // Use LifecycleService as the single orchestrator for scanner starts
            const lifecycleService = this.scannerService.lifecycleService;
            if (lifecycleService && lifecycleService.start) {
                await lifecycleService.start();
            } else {
                console.warn('[WalletStateService] ⚠️ LifecycleService not available, using deprecated AutoScannerService.start()');
                await this.scannerService.start();
            }

            if (this.scannerService.toast) {
                this.scannerService.toast({
                    title: `${modeText} Reset Complete`,
                    description: `${modeText} has been re-synced with Binance. Scanner is now active with clean position tracking.`
                });
            }
        } catch (error) {
            console.error('[AutoScannerService] ❌ resetWalletAndRestart error:', error);
            if (this.scannerService.toast) {
                this.scannerService.toast({
                    title: "Reset Failed",
                    description: `Failed to reset ${modeText}: ${error.message}`,
                    variant: "destructive"
                });
            }
            throw error;
        } finally {
            this.scannerService.isHardResetting = false;
        }
    }

    /**
     * Persists the latest wallet summary to localStorage for immediate UI access.
     */
    async _persistLatestWalletSummary() {
        try {
            if (typeof window === 'undefined') return;
            const mode = this.scannerService.state?.tradingMode || 'testnet';
            const latest = await queueEntityCall('WalletSummary', 'filter', { mode }, '-lastUpdated', 1);
            if (Array.isArray(latest) && latest.length > 0) {
                const snapshot = latest[0];
                localStorage.setItem(`walletSummaryCache_${mode}`, JSON.stringify(snapshot));
                try {
                    // Store snapshot for UI access
                    window.__walletSummaryCache = snapshot;
                } catch (_e) {
                    // ignore, not critical
                }
            }
        } catch (_e) {
            // silent fail - not critical to block scanner
        }
    }

    /**
     * Gets wallet state history from the position manager.
     * @returns {Array} Array of wallet state history.
     */
    getWalletStateHistory() {
        return this.scannerService.positionManager ? this.scannerService.positionManager.getWalletStateHistory() : [];
    }

    /**
     * Formats currency values using the formatUSDT utility.
     * @param {number} value - Value to format.
     * @returns {string} Formatted currency string.
     */
    _formatCurrency(value) {
        return formatUSDT(value);
    }

    /**
     * Formats price values using the formatPrice utility.
     * @param {number} value - Value to format.
     * @returns {string} Formatted price string.
     */
    _formatPrice(value) {
        return formatPrice(value);
    }

    /**
     * Resets the wallet state service.
     */
    resetState() {
        this.addLog('[WalletStateService] State reset.', 'system');
    }
}

export default WalletStateService;
