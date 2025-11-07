import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';
import { getAutoScannerService } from './AutoScannerService';
import centralWalletStateManager from './CentralWalletStateManager';

class WalletManagerService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        
        // Make test functions available globally for debugging
        if (typeof window !== 'undefined') {
            window.testBalanceCalculation = () => this.testBalanceCalculation();
            window.cleanupWalletSummaries = () => this.cleanupWalletSummaries();
            window.checkWalletSummaryDuplicates = () => this.checkWalletSummaryDuplicates();
            window.centralWalletStateManager = centralWalletStateManager;
        }
    }

    /**
     * Initialize the central wallet state and sync with Binance
     */
    async initializeLiveWallet() {
        const tradingMode = this.scannerService.getTradingMode();
        
        try {
            // Initialize central wallet state if not already done
            if (!centralWalletStateManager.isReady()) {
                await centralWalletStateManager.initialize(tradingMode);
            }
            
            // Sync with Binance to get latest data
            await centralWalletStateManager.syncWithBinance(tradingMode);
            
        } catch (error) {
            console.error('[WalletManagerService] ❌ Failed to initialize central wallet state:', error);
            throw error;
        }
    }

    /**
     * Update wallet summary when positions change
     * This method now delegates to the central wallet state manager
     */
    async updateWalletSummary() {
        const tradingMode = this.scannerService.getTradingMode();
        
        try {
            // CRITICAL FIX: Get positions from PositionManager first (single source of truth)
            // IMPORTANT: Use PositionManager even if positions array is empty (empty array is valid state!)
            let positions = [];
            const positionManager = this.scannerService?.positionManager;
            
            if (positionManager && Array.isArray(positionManager.positions)) {
                // Use positions from PositionManager (even if empty - that's valid state!)
                positions = positionManager.positions.filter(pos => 
                    pos.trading_mode === tradingMode && 
                    (pos.status === 'open' || pos.status === 'trailing')
                );
            } else {
                // Fallback: Query DB directly (PositionManager not available)
                positions = await queueEntityCall(
                    'LivePosition', 
                    'filter', 
                    { 
                        trading_mode: tradingMode, 
                        status: ['open', 'trailing'] 
                    }
                );
            }

            // Calculate balance in trades
            const balanceInTrades = positions?.reduce((total, pos) => {
                return total + (parseFloat(pos.entry_value_usdt) || 0);
            }, 0) || 0;

            // Update the central wallet state
            await centralWalletStateManager.updateBalanceInTrades(balanceInTrades);
            
        } catch (error) {
            console.error('[WalletManagerService] ❌ Failed to update wallet summary:', error);
        }
    }

    /**
     * Handle balance changes from Binance API
     * This method now delegates to the central wallet state manager
     */
    async handleBalanceChange(newBalance) {
        try {
            console.log(`[WalletManagerService] 💰 Handling balance change: ${newBalance.toFixed(2)}`);
            
            // Update the central wallet state
            await centralWalletStateManager.updateAvailableBalance(newBalance);
            
            console.log('[WalletManagerService] ✅ Balance change processed');
            
        } catch (error) {
            console.error('[WalletManagerService] ❌ Failed to handle balance change:', error);
        }
    }

    /**
     * Sync wallet state with Binance API
     * This method now delegates to the central wallet state manager
     */
    async syncWithBinance() {
        const tradingMode = this.scannerService.getTradingMode();
        
        try {
            console.log(`[WalletManagerService] 🔄 Syncing with Binance for ${tradingMode}`);
            
            await centralWalletStateManager.syncWithBinance(tradingMode);
            
            console.log('[WalletManagerService] ✅ Binance sync completed');
            
        } catch (error) {
            console.error('[WalletManagerService] ❌ Binance sync failed:', error);
            throw error;
        }
    }

    /**
     * Get current wallet state
     */
    getCurrentWalletState() {
        return centralWalletStateManager.getCurrentState();
    }

    /**
     * Check if wallet manager is ready
     */
    isReady() {
        return centralWalletStateManager.isReady();
    }

    /**
     * Test balance calculation (for debugging)
     */
    async testBalanceCalculation() {
        const tradingMode = this.scannerService.getTradingMode();
        
        try {
            console.log('[WalletManagerService] 🧪 Testing balance calculation...');
            
            const positions = await queueEntityCall(
                'LivePosition', 
                'filter', 
                { 
                    trading_mode: tradingMode, 
                    status: ['open', 'trailing'] 
                }
            );

            const balanceInTrades = positions?.reduce((total, pos) => {
                return total + (parseFloat(pos.entry_value_usdt) || 0);
            }, 0) || 0;

            console.log('[WalletManagerService] 🧪 Test results:', {
                positionsCount: positions?.length || 0,
                balanceInTrades: balanceInTrades,
                centralState: centralWalletStateManager.getCurrentState()
            });
            
        } catch (error) {
            console.error('[WalletManagerService] ❌ Test failed:', error);
        }
    }

    /**
     * Cleanup wallet summaries (legacy method for compatibility)
     */
    async cleanupWalletSummaries() {
        console.log('[WalletManagerService] 🧹 Cleanup not needed with central wallet state manager');
    }

    /**
     * Check wallet summary duplicates (legacy method for compatibility)
     */
    async checkWalletSummaryDuplicates() {
        console.log('[WalletManagerService] 🧹 Duplicate check not needed with central wallet state manager');
    }

    /**
     * Subscribe to wallet state changes
     */
    subscribe(callback) {
        return centralWalletStateManager.subscribe(callback);
    }

    /**
     * Force sync (for debugging)
     */
    async forceSync() {
        const tradingMode = this.scannerService.getTradingMode();
        await centralWalletStateManager.syncWithBinance(tradingMode);
    }
}

export default WalletManagerService;

// Factory function for creating WalletManagerService instances
export const initializeWalletManagerService = (scannerService) => {
    return new WalletManagerService(scannerService);
};