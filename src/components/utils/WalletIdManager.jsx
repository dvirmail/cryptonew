/**
 * Wallet ID Management Utility
 * 
 * This utility ensures consistent wallet ID management across the system
 * and prevents the creation of multiple wallet IDs for the same trading mode.
 */

import { queueEntityCall } from '@/components/utils/apiQueue';

class WalletIdManager {
    constructor() {
        this.walletIdCache = new Map(); // tradingMode -> walletId
        this.initialized = false;
    }

    /**
     * Get or create a consistent wallet ID for a trading mode
     * @param {string} tradingMode - The trading mode (testnet/live)
     * @returns {Promise<string>} The wallet ID
     */
    async getWalletId(tradingMode) {
        if (!this.initialized) {
            await this.initialize();
        }

        // Check cache first
        if (this.walletIdCache.has(tradingMode)) {
            return this.walletIdCache.get(tradingMode);
        }

        // Try to find existing CentralWalletState
        try {
            const existingStates = await queueEntityCall(
                'CentralWalletState', 
                'filter', 
                { trading_mode: tradingMode }
            );

            if (existingStates && existingStates.length > 0) {
                // Use the most recent state
                const latestState = existingStates.sort((a, b) => 
                    new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date)
                )[0];
                
                this.walletIdCache.set(tradingMode, latestState.id);
                console.log(`[WalletIdManager] ✅ Found existing CentralWalletState: ${latestState.id} for ${tradingMode}`);
                return latestState.id;
            }
        } catch (error) {
            console.warn(`[WalletIdManager] ⚠️ Error checking existing CentralWalletState: ${error.message}`);
        }

        // Generate new wallet ID if none exists
        const newWalletId = this.generateWalletId(tradingMode);
        this.walletIdCache.set(tradingMode, newWalletId);
        console.log(`[WalletIdManager] ✅ Generated new wallet ID: ${newWalletId} for ${tradingMode}`);
        return newWalletId;
    }

    /**
     * Generate a consistent wallet ID for a trading mode
     * @param {string} tradingMode - The trading mode
     * @returns {string} The generated wallet ID
     */
    generateWalletId(tradingMode) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `wallet_${tradingMode}_${timestamp}_${random}`;
    }

    /**
     * Initialize the wallet ID manager
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Load existing wallet IDs from CentralWalletState
            const centralStates = await queueEntityCall('CentralWalletState', 'list').catch(() => []);

            // Cache existing wallet IDs
            centralStates.forEach(state => {
                if (state.trading_mode) {
                    this.walletIdCache.set(state.trading_mode, state.id);
                }
            });

            this.initialized = true;
            console.log(`[WalletIdManager] ✅ Initialized with ${this.walletIdCache.size} cached wallet IDs`);
        } catch (error) {
            console.error(`[WalletIdManager] ❌ Initialization failed: ${error.message}`);
            this.initialized = true; // Mark as initialized to prevent retries
        }
    }

    /**
     * Clear the cache (useful for testing or reset scenarios)
     */
    clearCache() {
        this.walletIdCache.clear();
        this.initialized = false;
        console.log('[WalletIdManager] 🧹 Cache cleared');
    }

    /**
     * Get all cached wallet IDs
     * @returns {Object} Object with trading modes as keys and wallet IDs as values
     */
    getCachedWalletIds() {
        return Object.fromEntries(this.walletIdCache);
    }
}

// Create singleton instance
const walletIdManager = new WalletIdManager();

// Make it available globally for debugging
if (typeof window !== 'undefined') {
    window.walletIdManager = walletIdManager;
}

export default walletIdManager;
