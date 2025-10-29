/**
 * Wallet State Validation Utility
 * 
 * This utility helps ensure wallet states are properly initialized
 * and prevents common wallet state issues.
 */

export class WalletStateValidator {
    /**
     * Validates and fixes a wallet state object
     * @param {Object} walletState - The wallet state to validate
     * @param {string} tradingMode - The trading mode (testnet/live)
     * @returns {Object} - The validated and fixed wallet state
     */
    static validateAndFix(walletState, tradingMode = 'testnet') {
        if (!walletState) {
            console.warn('[WalletStateValidator] ⚠️ Wallet state is null/undefined, creating minimal state');
            return this.createMinimalWalletState(tradingMode);
        }

        // Ensure required fields exist
        const fixedState = {
            id: walletState.id || `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            trading_mode: walletState.trading_mode || tradingMode,
            mode: walletState.mode || tradingMode,
            available_balance: walletState.available_balance || "0.00000000",
            balance_in_trades: walletState.balance_in_trades || "0.00000000",
            total_equity: walletState.total_equity || "0.00000000",
            total_realized_pnl: walletState.total_realized_pnl || "0.00000000",
            unrealized_pnl: walletState.unrealized_pnl || "0.00000000",
            balances: walletState.balances || [],
            positions: walletState.positions || [],
            live_position_ids: walletState.live_position_ids || [],
            total_trades_count: walletState.total_trades_count || 0,
            winning_trades_count: walletState.winning_trades_count || 0,
            losing_trades_count: walletState.losing_trades_count || 0,
            total_gross_profit: walletState.total_gross_profit || 0,
            total_gross_loss: walletState.total_gross_loss || 0,
            total_fees_paid: walletState.total_fees_paid || 0,
            last_updated_timestamp: walletState.last_updated_timestamp || new Date().toISOString(),
            last_binance_sync: walletState.last_binance_sync || new Date().toISOString(),
            created_date: walletState.created_date || new Date().toISOString(),
            updated_date: walletState.updated_date || new Date().toISOString()
        };

        // Log any fixes applied
        const fixes = [];
        if (!walletState.id) fixes.push('missing ID');
        if (!walletState.mode) fixes.push('missing mode');
        if (!walletState.trading_mode) fixes.push('missing trading_mode');
        if (!walletState.available_balance) fixes.push('missing available_balance');
        
        if (fixes.length > 0) {
            console.log(`[WalletStateValidator] 🔧 Applied fixes: ${fixes.join(', ')}`);
        }

        return fixedState;
    }

    /**
     * Creates a minimal wallet state for a given trading mode
     * @param {string} tradingMode - The trading mode (testnet/live)
     * @returns {Object} - A minimal wallet state object
     */
    static createMinimalWalletState(tradingMode = 'testnet') {
        const now = new Date().toISOString();
        return {
            id: `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            trading_mode: tradingMode,
            mode: tradingMode,
            available_balance: "0.00000000",
            balance_in_trades: "0.00000000",
            total_equity: "0.00000000",
            total_realized_pnl: "0.00000000",
            unrealized_pnl: "0.00000000",
            balances: [],
            positions: [],
            live_position_ids: [],
            total_trades_count: 0,
            winning_trades_count: 0,
            losing_trades_count: 0,
            total_gross_profit: 0,
            total_gross_loss: 0,
            total_fees_paid: 0,
            last_updated_timestamp: now,
            last_binance_sync: now,
            created_date: now,
            updated_date: now
        };
    }

    /**
     * Checks if a wallet state is valid
     * @param {Object} walletState - The wallet state to check
     * @returns {boolean} - True if valid, false otherwise
     */
    static isValid(walletState) {
        if (!walletState) return false;
        
        const requiredFields = ['id', 'mode', 'trading_mode', 'available_balance'];
        return requiredFields.every(field => walletState[field] !== undefined && walletState[field] !== null);
    }

    /**
     * Ensures wallet state has proper mode setting
     * @param {Object} walletState - The wallet state to fix
     * @param {string} tradingMode - The trading mode to set
     * @returns {Object} - The wallet state with proper mode
     */
    static ensureMode(walletState, tradingMode = 'testnet') {
        if (!walletState) {
            return this.createMinimalWalletState(tradingMode);
        }

        if (!walletState.mode || walletState.mode === 'undefined') {
            walletState.mode = tradingMode;
            console.log(`[WalletStateValidator] 🔧 Set wallet mode to: ${tradingMode}`);
        }

        if (!walletState.trading_mode || walletState.trading_mode === 'undefined') {
            walletState.trading_mode = tradingMode;
            console.log(`[WalletStateValidator] 🔧 Set wallet trading_mode to: ${tradingMode}`);
        }

        return walletState;
    }
}

export default WalletStateValidator;
