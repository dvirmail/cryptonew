
import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { positionSizeValidator } from '@/components/utils/positionSizeValidator'; // Corrected import to named export
import { defaultSignalSettings } from '@/components/utils/signalSettings';
import { calculateATR } from '@/components/utils/indicator-calculations/volatilityIndicators';
import { addHours } from "date-fns";
import { debounce } from 'lodash';
import { liveTradingAPI } from '@/api/functions';
import { LiveWalletState } from '@/api/entities';
import { Trade } from '@/api/entities';
import { updatePerformanceSnapshot } from '@/api/functions';
import { getBinancePrices } from '@/api/functions';
import { generateTradeId } from '@/components/utils/id';
import * as dynamicSizing from "@/components/utils/dynamicPositionSizing";


// NEW: helper to fetch fresh free balance for a base asset from Binance account info
async function fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl }) {
  const resp = await queueFunctionCall(
    liveTradingAPI,
    {
      action: "getAccountInfo",
      tradingMode,
      proxyUrl,
    },
    "critical"
  );
  // Extract the actual Binance response, similar to _executeBinanceMarketSellOrder
  const getBinanceResponseLocal = (apiResponse) => {
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
  };
  const data = getBinanceResponseLocal(resp);
  const balances = data?.balances || [];
  const match = balances.find((b) => b.asset === baseAsset);
  const free = match ? Number(match.free) : 0;
  return Number.isFinite(free) ? free : 0;
}

// NEW: safe round down to stepSize with precision handling
function roundDownToStepSize(quantity, stepSize) {
  const q = Number(quantity);
  const s = Number(stepSize || 0);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(s) || s <= 0) return 0;
  const precision = Math.max(0, (s.toString().split(".")[1] || "").length);
  const units = Math.floor(q / s + 1e-12); // tiny epsilon safety for float division
  const rounded = units * s;
  // toFixed by precision to avoid 0.300000000004 style floats
  return Number(rounded.toFixed(precision));
}

// NEW: helper to parse key filters from cached exchange info
function getSymbolFiltersFromInfo(symbolInfo) {
  let lot = null, minNotional = null, minQty = null, stepSize = null;
  if (!symbolInfo) return { lot, minNotional: 0, minQty: 0, stepSize: 0 };

  if (Array.isArray(symbolInfo.filters)) {
    for (const f of symbolInfo.filters) {
      if (f.filterType === "LOT_SIZE") {
        lot = f;
        stepSize = Number(f.stepSize || 0);
        minQty = Number(f.minQty || 0);
      } else if (f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") {
        minNotional = Number(f.minNotional ?? f.notional ?? 0);
      }
    }
  } else if (symbolInfo.filters && typeof symbolInfo.filters === "object") {
    const ls = symbolInfo.filters.LOT_SIZE;
    if (ls) {
      lot = ls;
      stepSize = Number(ls.stepSize || 0);
      minQty = Number(ls.minQty || 0);
    }
    const nf = symbolInfo.filters.NOTIONAL || symbolInfo.filters.MIN_NOTIONAL;
    if (nf) {
      minNotional = Number(nf.minNotional ?? nf.notional ?? 0);
    }
  }
  return { lot, minNotional: Number(minNotional || 0), minQty: Number(minQty || 0), stepSize: Number(stepSize || 0) };
}

// NEW GLOBAL HELPER for final quantity precision formatting string
// This version formats a pre-quantized quantity with minimal decimals based on stepSize
function _formatQuantityString(quantizedQuantity, stepSize) {
  const qty = Number(quantizedQuantity || 0);
  const step = Number(stepSize || 1);

  // Determine precision from stepSize (handles decimals and scientific notation like 1e-8)
  const getPrecisionFromStep = (s) => {
    const str = String(s);
    if (str.includes('e-')) {
      const [, exp] = str.split('e-');
      const n = parseInt(exp, 10);
      return Number.isFinite(n) ? n : 0;
    }
    const dot = str.indexOf('.');
    return dot >= 0 ? (str.length - dot - 1) : 0;
  };

  const precision = getPrecisionFromStep(step);

  let formattedQty;
  if (precision === 0) {
    formattedQty = String(Math.floor(qty));
  } else {
    // If precision is non-zero, format to fixed decimal places, then remove trailing zeros
    const fixed = Number(qty).toFixed(precision);
    formattedQty = fixed.replace(/\.?0+$/, '');
  }

  // Safety: avoid "-0"
  if (formattedQty === '-0') formattedQty = '0';
  return formattedQty;
}


export default class PositionManager {
    constructor(scannerServiceInstance) {
        // Pass the AutoScannerService instance to access its state, logs, and other methods
        this.scannerService = scannerServiceInstance;
        this.addLog = scannerServiceInstance.addLog.bind(scannerServiceInstance); // Enhanced logging
        this.toast = scannerServiceInstance.toast; // For toast notifications

        // Internal cache of managed positions
        this.positions = []; // Initialize an empty array for managed LivePosition objects
        
        // Trading mode
        this.tradingMode = scannerServiceInstance.getTradingMode(); // UPDATED: Get from scannerService

        // Batch queues
        this.openQueue = []; // Initialize openQueue
        this.closeQueue = [];
        
        // State tracking
        this.isProcessingQueue = false;
        this.lastWalletSave = 0; // New timestamp for last save
        this.walletSavePromise = null; // Initialize with null as per outline

        // CRITICAL: Assign positionSizeValidator to instance
        this.positionSizeValidator = positionSizeValidator;
        
        if (!this.positionSizeValidator || typeof this.positionSizeValidator.calculate !== 'function') {
            this.addLog('[PositionManager] CRITICAL: positionSizeValidator.calculate is not available!', 'error');
        } else {
            this.addLog('[PositionManager] ✅ Position size validator initialized successfully', 'system');
        }

        this.managedWalletState = null;
        this.walletSaveResolve = null; // Still needed for resolving promises tied to walletSavePromise

        this.lastUpdateTime = Date.now();
        this.updateInterval = 5000;
        this.updateTimeout = null;

        // Sizing debug properties (existing)
        this.sizeDebugCounter = 0;
        this.sizeDebugMax = 5;
        this._lastDebugIndicators = null;
        this._lastDebugKlines = null;
        this._sizeDebugKeys = new Set(); // Used by _logSizeDebugOnce

        this._sizeDebugCache = new Map();
        this._sizeDebugOnceCache = new Map();
        this._sizeBreakdownCache = new Map();
        this._sizeBreakdownOnceCache = new Map();
        this.positionSizeDebugCache = new Set();
        this.sizeBreakdownDebugCache = new Set();

        // New properties for live wallet state persistence (LiveWalletState)
        this.isSavingWallet = false;
        this.saveWalletPromise = null; // Existing saveWalletPromise, distinct from the new walletSavePromise

        // Track all position IDs we've handled for opening
        this.handledPositionIds = new Set();
        // NEW: Flag to indicate if wallet state needs saving due to internal modifications
        this.needsWalletSave = false;

        // NEW: Track recent insufficient balance messages to prevent spam
        this.recentInsufficientBalanceLog = null;
        this.insufficientBalanceLogCooldown = 60000; // 1 minute cooldown

        // NEW: Track consecutive reconciliation failures
        this.consecutiveReconcileFailures = 0;
        this.maxConsecutiveFailuresBeforeAlert = 3;
        this.lastReconcileFailureTime = null;

        // Sizing debug cleanup for live environments
        if (typeof window !== 'undefined') {
            this.MAX_SIZE_DEBUG_KEYS = 100;
            setInterval(() => {
                if (this._sizeDebugKeys.size > this.MAX_SIZE_DEBUG_KEYS * 0.8) { // Corrected property name
                    const oldKeys = Array.from(this._sizeDebugKeys).slice(0, Math.floor(this.MAX_SIZE_DEBUG_KEYS * 0.5));
                    oldKeys.forEach(k => this._sizeDebugKeys.delete(k));
                }
            }, 60000);
        }
    }

    /**
     * Helper to format currency for logging.
     * @param {number} value
     * @returns {string}
     */
    _formatCurrency(value) {
        return `$${(value || 0).toFixed(2)}`;
    }

    // Add (or update) a smart price formatter without $ sign
    _formatPriceSmart(n) {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0) return null;
      const abs = Math.abs(v);
      if (abs >= 1000) return v.toFixed(2);
      if (abs >= 100)  return v.toFixed(2);
      if (abs >= 1)    return v.toFixed(4);
      if (abs >= 0.1)  return v.toFixed(5);
      if (abs >= 0.01) return v.toFixed(6);
      if (abs >= 0.001) return v.toFixed(7);
      if (abs >= 0.0001) return v.toFixed(8);
      if (abs >= 0.000001) return v.toFixed(10);
      return v.toExponential(2);
    }

    // Add (or update) a smart USD formatter
    _formatUsdSmart(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '$0.00';
      const abs = Math.abs(n);
      if (abs >= 1) return `${n < 0 ? '-' : ''}$${abs.toFixed(2)}`;
      if (abs >= 0.01) return `${n < 0 ? '-' : ''}$${abs.toFixed(4)}`;
      if (abs >= 0.000001) return `${n < 0 ? '-' : ''}$${abs.toFixed(8)}`;
      return `${n < 0 ? '-' : ''}≈$${abs.toExponential(2)}`;
    }

    // Reason + P&L suffix (no price here)
    _formatCloseReasonAndPnl({ exitReason, pnlUsdt, pnlPercentage }) {
      const map = {
        take_profit: 'TP', stop_loss: 'SL', timeout: 'TIMEOUT', manual_close: 'MANUAL',
        trailing_stop_hit: 'TRAILING', trailing_timeout: 'TRAILING_TIMEOUT', error: 'ERROR', cancelled: 'CANCELLED',
      };
      const code = (exitReason || '').toLowerCase();
      const reason = map[code] || (exitReason ? exitReason.toUpperCase() : 'UNKNOWN');

      const usdValid = Number.isFinite(Number(pnlUsdt));
      const pctValid = Number.isFinite(Number(pnlPercentage));
      const usd = usdValid ? Number(pnlUsdt) : 0;
      const pct = pctValid ? Number(pnlPercentage) : 0;

      const signPct = pct > 0 ? '+' : pct < 0 ? '-' : '';
      const usdStr = this._formatUsdSmart(usd);
      const pctStr = `${signPct}${Math.abs(pct).toFixed(2)}%`;

      let suffix = ` | Reason: ${reason}`;
      if (usdValid || pctValid) suffix += ` | P&L: ${usdStr} (${pctStr})`;
      return suffix;
    }

    // NEW: Safe delete helper - treats 404 as already-deleted and avoids error spam
    async _safeDeleteLivePosition(posId) {
      try {
        // Prefer queueEntityCall if used elsewhere in this class
        // eslint-disable-next-line no-shadow
        const { queueEntityCall } = await import('@/components/utils/apiQueue');
        await queueEntityCall('LivePosition', 'delete', posId);
      } catch (error) {
        const status = error?.response?.status;
        const msg = error?.response?.data?.message || error?.message || '';
        if (status === 404 || /not found/i.test(msg)) {
          this.addLog(`[PositionManager] ℹ️ LivePosition ${posId} already deleted (404) — skipping.`, 'system');
          return;
        }
        // Only log real errors
        this.addLog(`[PositionManager] ❌ Failed to delete LivePosition ${posId}: ${error?.message || 'Unknown error'}`, 'error');
      }
    }

    /**
     * Sets the trading mode for the PositionManager.
     * @param {'testnet'|'live'} mode - The trading mode to set.
     */
    setTradingMode(mode) {
        if (mode !== 'testnet' && mode !== 'live') {
            this.addLog(`[PositionManager] Invalid trading mode: ${mode}. Must be 'testnet' or 'live'`, 'error');
            return;
        }

        const oldMode = this.tradingMode;
        this.tradingMode = mode;

        if (oldMode !== mode) {
            this.scannerService.addLog(`[PositionManager] Trading mode updated: ${oldMode.toUpperCase()} → ${mode.toUpperCase()}`, 'system');
        }
    }

    isLiveMode() {
        return this.tradingMode === 'live';
    }

    isTestnetMode() {
        return this.tradingMode === 'testnet';
    }

    getTradingMode() {
        return this.tradingMode;
    }

    /**
     * Returns the currently active wallet state based on the trading mode.
     * This method now always returns the `scannerService.state.liveWalletState`.
     * @returns {LiveWalletState|object|null} The active wallet state object.
     */
    getActiveWalletState() {
        return this.scannerService.state.liveWalletState;
    }

    /**
     * Retrieves the current state of the managed wallet.
     * @returns {Object|null} The current wallet state.
     */
    getManagedState() {
        return this.scannerService.state.liveWalletState;
    }

    /**
     * Loads a provided LiveWalletState and its associated LivePosition entities.
     * This method is called by WalletManagerService.
     * @param {object} walletStateObj - The LiveWalletState object.
     */
    async loadManagedState(walletStateObj) { // Changed signature as per outline
        // CRITICAL FIX: Ensure actualWalletId is a string ID, not an object
        const actualWalletId = walletStateObj?.id; // Access 'id' from the passed object

        const resolvedMode = (walletStateObj && walletStateObj.mode)
            ? walletStateObj.mode
            : (this.scannerService && typeof this.scannerService.getTradingMode === 'function'
                ? this.scannerService.getTradingMode()
                : (this.scannerService?.state?.tradingMode || 'testnet'));

        if (!actualWalletId || typeof actualWalletId !== 'string' || actualWalletId.length === 0 || actualWalletId === '[object Object]') {
            this.addLog(`[PositionManager] ❌ Invalid wallet ID provided: ${JSON.stringify(walletStateObj)} (extracted: ${actualWalletId})`, 'error');
            throw new Error('Invalid wallet ID: must be a non-empty string ID.');
        }

        this.walletId = actualWalletId;
        // Update log to always show a valid mode
        this.addLog(`[PositionManager] 🔄 Loading managed state for wallet ID: ${actualWalletId} (mode: ${resolvedMode}).`, 'system');

        let fetchedLivePositions = [];
        try {
            fetchedLivePositions = await queueEntityCall(
                'LivePosition',
                'filter',
                {
                    wallet_id: actualWalletId,
                    trading_mode: resolvedMode
                },
                '-created',
                1000
            );

            if (!Array.isArray(fetchedLivePositions) || fetchedLivePositions.length === 0) {
                this.addLog('[PositionManager] ℹ️ No open positions found in database for this wallet/mode.', 'info');
                this.positions = [];
            } else {
                 this.addLog(`[PositionManager] ✅ Fetched ${fetchedLivePositions.length} LivePosition entities from DB for wallet ${actualWalletId}.`, 'success');

                fetchedLivePositions.forEach((pos) => {
                    // This block was empty, removed for clarity.
                });

                // CRITICAL FIX: Ensure both 'id' (database ID) and 'position_id' are preserved
                this.positions = fetchedLivePositions.map(dbPos => {
                    // Validate that we have the critical IDs
                    if (!dbPos.id) {
                        this.addLog(`[PositionManager] ⚠️ Position missing database ID: ${JSON.stringify(dbPos)}`, 'error');
                    }
                    if (!dbPos.position_id) {
                        this.addLog(`[PositionManager] ⚠️ Position missing position_id: ${JSON.stringify(dbPos)}`, 'error');
                    }

                    const mappedPos = {
                        position_id: dbPos.position_id,
                        db_record_id: dbPos.id, // Store the actual database record ID
                        strategy_name: dbPos.strategy_name,
                        symbol: dbPos.symbol,
                        direction: dbPos.direction,
                        entry_price: dbPos.entry_price,
                        quantity_crypto: dbPos.quantity_crypto,
                        entry_value_usdt: dbPos.entry_value_usdt,
                        entry_timestamp: dbPos.entry_timestamp,
                        status: dbPos.status,
                        stop_loss_price: dbPos.stop_loss_price,
                        take_profit_price: dbPos.take_profit_price,
                        is_trailing: dbPos.is_trailing || false,
                        trailing_stop_price: dbPos.trailing_stop_price,
                        trailing_peak_price: dbPos.trailing_peak_price,
                        peak_price: dbPos.peak_price,
                        trough_price: dbPos.trough_price,
                        time_exit_hours: dbPos.time_exit_hours,
                        trigger_signals: dbPos.trigger_signals || [],
                        combined_strength: dbPos.combined_strength,
                        conviction_score: dbPos.conviction_score,
                        market_regime: dbPos.market_regime,
                        regime_confidence: dbPos.regime_confidence,
                        atr_value: dbPos.atr_value,
                        wallet_allocation_percentage: dbPos.wallet_allocation_percentage,
                        binance_order_id: dbPos.binance_order_id,
                        wallet_id: dbPos.wallet_id, // IMPORTANT: Preserve wallet_id
                        trading_mode: dbPos.trading_mode // IMPORTANT: Preserve trading_mode
                    };
                    // Ensure the original 'id' property of LivePosition (database ID) is preserved for later DB operations
                    Object.defineProperty(mappedPos, 'id', {
                        value: dbPos.id,
                        writable: false,
                        enumerable: false, // Make it non-enumerable for general use, but available for DB calls
                        configurable: true
                    });
                    return mappedPos;
                });
            }

            // Debug: Log the first position's IDs to verify they're preserved
            if (this.positions.length > 0) {
                // eslint-disable-next-line no-unused-vars
                const firstPos = this.positions[0];
            }

            // --- CRITICAL: Persist live_position_ids to LiveWalletState ---
            const currentLivePositionIds = this.positions.map(pos => pos.id).filter(id => id);
            
            if (actualWalletId) { // Use parameter `actualWalletId` here
                try {
                    await queueEntityCall('LiveWalletState', 'update', actualWalletId, {
                        live_position_ids: currentLivePositionIds,
                        last_updated_timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.addLog(`[PositionManager] ❌ Failed to persist live_position_ids for LiveWalletState ${actualWalletId}: ${error.message}`, 'error', error);
                }
            } else {
                this.addLog(`[PositionManager] ⚠️ Cannot persist live_position_ids: No valid LiveWalletState.id found (parameter actualWalletId is missing).`, 'warning');
            }

            // Also update the scannerService's in-memory liveWalletState for immediate consistency
            // Assuming this.scannerService.state.liveWalletState is already loaded and is the target wallet
            if (this.scannerService.state.liveWalletState && this.scannerService.state.liveWalletState.id === actualWalletId) {
                 this.scannerService.state.liveWalletState.live_position_ids = currentLivePositionIds;
                 // CRITICAL: Ensure the in-memory wallet state's 'positions' array reflects the current `this.positions` cache
                 this.scannerService.state.liveWalletState.positions = this.positions;
                 this.scannerService.state.liveWalletState.mode = resolvedMode; // Ensure in-memory mode is also updated
            }
            // --- END PERSISTENCE ---

        } catch (error) {
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            this.addLog(`[PositionManager] ❌ Error loading managed state: ${error.message}`, 'error', error);
            this.addLog(`[PositionManager] Error stack: ${error.stack}`, 'error');
            this.addLog(`[PositionManager] Error details: ${JSON.stringify({
                message: error.message,
                stack: error.stack,
                walletId: actualWalletId,
                mode: resolvedMode
            })}`, 'error');
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            this.positions = [];
            // Re-throw the error as this is a critical loading function
            throw error;
        }
    }

    /**
     * Calculate P&L for a position given an exit price
     * @param {Object} position - The position object
     * @param {number} exitPrice - The exit price
     * @returns {number} P&L in USDT
     */
    calculatePnL(position, exitPrice) {
        const pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * position.quantity_crypto
            : (position.entry_price - exitPrice) * position.quantity_crypto;
        return pnl;
    }

    /**
     * Determine exit trend based on P&L
     * @param {Object} position - The position object
     * @param {number} exitPrice - The exit price
     * @returns {string} Exit trend: 'positive-trend', 'negative-trend', or 'neutral'
     */
    determineExitTrend(position, exitPrice) {
        if (!position || typeof exitPrice !== 'number' || typeof position.entry_price !== 'number') {
            return 'unknown';
        }

        const pnl = this.calculatePnL(position, exitPrice); // Correctly calls internal method

        if (pnl > 0) {
            return 'positive-trend';
        } else if (pnl < 0) {
            return 'negative-trend';
        }
        return 'neutral';
    }

    /**
     * Calculate total balance currently allocated to open trades
     * @returns {number} Total USDT in open positions
     */
    getBalanceInTrades() {
        const wallet = this.getActiveWalletState(); // Existing logic, correctly selects wallet by mode

        if (!wallet || !Array.isArray(this.positions)) { // Use this.positions for currently managed positions
            return 0;
        }

        return this.positions.reduce((acc, pos) => {
            if (pos.status === 'open' || pos.status === 'trailing') {
                return acc + (pos.entry_value_usdt || 0);
            }
            return acc;
        }, 0);
    }

     /**
     * Retrieves the current USDT balance from the active wallet state.
     * @returns {number} The current USDT balance, or 0 if not found.
     */
    getCurrentUsdtBalance() {
        const wallet = this.getActiveWalletState(); // Ensure correct wallet retrieval

        if (!wallet || !Array.isArray(wallet.balances)) {
            this.addLog('[getCurrentUsdtBalance] No valid wallet or USDT balance found.', 'warning');
            return 0;
        }

        const usdtBalance = wallet.balances.find(b => b.asset === 'USDT');
        if (!usdtBalance) {
            this.addLog('[getCurrentUsdtBalance] No USDT balance found in wallet.', 'warning');
            return 0;
        }

        return parseFloat(usdtBalance.free || '0');
    }

    /**
     * Refreshes the current account balance from Binance and updates the wallet state.
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async refreshBalanceFromBinance() {
        const walletState = this.getActiveWalletState();
        if (!walletState || !walletState.id) {
            this.addLog('[REFRESH_BALANCE] ⚠️ No active wallet state to refresh balance for.', 'warning');
            return { success: false, error: 'No active wallet state.' };
        }

        const mode = this.getTradingMode();
        const proxyUrl = this.scannerService.state.settings?.local_proxy_url;

        if (!proxyUrl && mode === 'live') {
            this.addLog('[REFRESH_BALANCE] ❌ Proxy URL not configured for LIVE mode. Cannot refresh balance.', 'error');
            return { success: false, error: 'Proxy URL not configured.' };
        }

        try {
            this.addLog(`[REFRESH_BALANCE] 🔄 Fetching account info from Binance (${mode.toUpperCase()})...`, 'debug');
            const response = await queueFunctionCall(
                liveTradingAPI,
                {
                    action: "getAccountInfo",
                    tradingMode: mode,
                    proxyUrl: proxyUrl
                },
                'normal',
                `binanceAccountInfo-${mode}`, // Cache key
                5000, // Cache for 5 seconds
                20000 // Timeout
            );

            // Extract the actual Binance response, similar to _executeBinanceMarketSellOrder
            const getBinanceResponseLocal = (apiResponse) => {
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
            };

            const accountInfo = getBinanceResponseLocal(response);

            if (!accountInfo || !Array.isArray(accountInfo.balances)) {
                throw new Error('Failed to fetch valid account balances from Binance.');
            }

            // Update the liveWalletState with new balances
            walletState.balances = accountInfo.balances.map(b => ({
                asset: b.asset,
                free: b.free,
                locked: b.locked,
                total: (parseFloat(b.free) + parseFloat(b.locked)).toString()
            }));
            walletState.last_binance_sync = new Date().toISOString();

            this.addLog(`[REFRESH_BALANCE] ✅ Successfully refreshed ${walletState.balances.length} balances. USDT Free: ${this._formatCurrency(this.getCurrentUsdtBalance())}`, 'debug');
            this.needsWalletSave = true; // Mark wallet for persistence
            await this.persistWalletChangesAndWait(); // Persist the updated balances immediately

            return { success: true };

        } catch (error) {
            this.addLog(`[REFRESH_BALANCE] ❌ Error fetching Binance account info: ${error.message}`, 'error', error);
            return { success: false, error: error.message };
        }
    }


    /**
     * Calculate total unrealized PnL for all open positions.
     * @returns {number} Total unrealized PnL in USDT.
     */
    getTotalUnrealizedPnl() {
        const walletState = this.getActiveWalletState();
        // Use this.positions for the most current in-memory positions
        if (!walletState || !Array.isArray(this.positions)) {
            return 0;
        }

        const currentPrices = this.scannerService.currentPrices || {};
        let totalUnrealized = 0;

        this.positions.forEach(position => {
            if (position.status === 'open' || position.status === 'trailing') {
                const symbolNoSlash = position.symbol.replace('/', '');
                const currentPrice = currentPrices[symbolNoSlash];
                
                if (currentPrice && typeof currentPrice === 'number' && currentPrice > 0) {
                    const unrealizedPnl = position.direction === 'long'
                        ? (currentPrice - position.entry_price) * position.quantity_crypto
                        : (position.entry_price - currentPrice) * position.quantity_crypto;
                    
                    totalUnrealized += unrealizedPnl;
                }
            }
        });

        return totalUnrealized;
    }


    /**
     * Classify a strategy as event-driven or not based on its signals
     * @param {Object} strategy - The strategy/combination object
     * @returns {boolean} True if strategy is event-driven
     */
    classifyStrategy(strategy) {
        if (!strategy || !strategy.signals || strategy.signals.length === 0) return false;

        const eventKeywords = [
            'crossover', 'cross', 'breakout', 'breakdown', 'entry', 'exit',
            'flip', 'fire', 'squeeze', 'reversal', 'engulfing', 'hammer',
            'star', 'doji', 'marubozu', 'harami', 'piercing', 'bounce',
            'break', 'violation', 'signal', 'trigger', 'alert', 'confirmation'
        ];

        const eventSignalsCount = strategy.signals.filter(s => {
            const signalType = s.type?.toLowerCase() || '';
            const signalValue = s.value?.toLowerCase() || '';

            const signalDef = defaultSignalSettings[signalType];

            if (signalDef && signalDef.category === 'patterns') return true;
            if (eventKeywords.some(keyword => signalValue.includes(keyword))) return true;

            const eventSignalTypes = ['candlestick', 'chartpattern', 'supportresistance', 'fibonacci', 'pivot'];
            if (eventSignalTypes.includes(signalType)) return true;

            const oscillatorTypes = ['rsi', 'stochastic', 'williamsr', 'cci', 'mfi'];
            const zoneKeywords = ['oversold', 'overbought', 'entering', 'exiting', 'above', 'below'];
            if (oscillatorTypes.includes(signalType) && zoneKeywords.some(keyword => signalValue.includes(keyword))) return true;

            const trendTypes = ['macd', 'ema', 'ma200', 'tema', 'dema', 'hma', 'wma', 'psar'];
            const trendKeywords = ['bullish', 'bearish', 'above', 'below', 'cross'];
            if (trendTypes.includes(signalType) && trendKeywords.some(keyword => signalValue.includes(keyword))) return true;

            const volumeVolatilityTypes = ['volume', 'atr', 'bollinger', 'keltner', 'donchian', 'ttm_squeeze'];
            const volumeVolatilityKeywords = ['spike', 'expansion', 'contraction', 'band', 'channel'];
            if (volumeVolatilityTypes.includes(signalType) && volumeVolatilityKeywords.some(keyword => signalValue.includes(keyword))) return true;

            return false;
        }).length;

        return eventSignalsCount > strategy.signals.length / 2;
    }
    
    /**
     * Get estimated exit date for a position based on time exit hours
     * @param {Object} position - The position object
     * @returns {Date|null} Estimated exit date or null if no time exit set
     */
    getEstimatedExitDate(position) {
        if (position.time_exit_hours && typeof position.time_exit_hours === 'number') {
            return addHours(new Date(position.entry_timestamp), position.time_exit_hours);
        }
        return null;
    }

    /**
     * Check if a position has exceeded its time exit threshold
     * @param {Object} position - The position object
     * @returns {boolean} True if position should be closed due to time exit
     */
    shouldExitByTime(position) {
        const exitDate = this.getEstimatedExitDate(position);
        if (!exitDate) return false;

        return new Date() >= exitDate;
    }

    /**
     * Generate trade data from a position for closure
     * @param {Object} position - The position object
     * @param {number} exitPrice - The exit price
     * @param {string} exitReason - Reason for exit
     * @param {Object} additionalData - Additional data to include
     * @returns {Object} Trade data object ready for database insertion
     */
    generateTradeFromPosition(position, exitPrice, exitReason, additionalData = {}) {
        const pnlUsdtForTradeGeneration = this.calculatePnL(position, exitPrice);
        const exitTrend = this.determineExitTrend(position, exitPrice);
        const now = new Date();
        const entryTime = new Date(position.entry_timestamp);
        const durationSeconds = Math.floor((now - entryTime) / 1000);

        // Re-calculate pnl_percentage and exit_value_usdt for full trade payload
        const entryValue = position.entry_value_usdt;
        let exitValue = 0;
        if (position.direction === 'long') {
            exitValue = position.quantity_crypto * exitPrice;
        } else if (position.direction === 'short') { // Not used in current spot trading but good to keep
            exitValue = entryValue + pnlUsdtForTradeGeneration;
        }
        const pnlPercentage = entryValue > 0 ? (pnlUsdtForTradeGeneration / entryValue) * 100 : 0;

        const tradeData = {
            trade_id: position.position_id, // This will now be the Binance orderId for positions opened by the scanner
            strategy_name: position.strategy_name,
            symbol: position.symbol,
            direction: position.direction,
            entry_price: position.entry_price,
            exit_price: exitPrice,
            quantity_crypto: position.quantity_crypto,
            entry_value_usdt: entryValue,
            exit_value_usdt: exitValue,
            pnl_usdt: pnlUsdtForTradeGeneration,
            pnl_percentage: pnlPercentage,
            entry_timestamp: position.entry_timestamp,
            exit_timestamp: now.toISOString(),
            duration_seconds: durationSeconds,
            exit_reason: exitReason,
            exit_trend: exitTrend,
            leverage: position.leverage || 1,
            take_profit_price: position.take_profit_price || null,
            wallet_allocation_percentage: position.wallet_allocation_percentage || null,
            peak_price_during_trade: position.peak_price || null,
            trough_price_during_trade: position.trough_price || null,
            trigger_signals: position.trigger_signals || [],
            combined_strength: position.combined_strength,
            conviction_score: position.conviction_score,
            conviction_breakdown: position.conviction_breakdown,
            conviction_multiplier: position.conviction_multiplier,
            market_regime: position.market_regime,
            regime_confidence: position.regime_confidence,
            atr_value: position.atr_value,
            is_event_driven_strategy: position.is_event_driven_strategy || false,
            trading_mode: this.tradingMode, // Added to ensure consistency
            ...additionalData
        };

        return tradeData;
    }

    /**
     * Reconciles LivePosition records with actual Binance holdings.
     * This is the definitive synchronization method that ensures database matches reality.
     */
    async reconcileWithBinance() {
        //this.addLog('═══════════════════════════════════════════════════════', 'debug');
        //this.addLog('[RECONCILE] ===== RECONCILIATION START =====', 'debug');
        this.addLog(`[RECONCILE] Trading mode: ${this.getTradingMode()}`, 'debug');
        //this.addLog(`[RECONCILE] 🔄 Starting Binance reconciliation (${this.getTradingMode()} mode)...`, 'info');
        
        try {
            const settings = await queueEntityCall('ScanSettings', 'list');
            const proxyUrl = settings?.[0]?.local_proxy_url;

            if (!proxyUrl) {
                this.addLog('[RECONCILE] ❌ No proxy URL configured!', 'error');
                throw new Error('local_proxy_url not set in ScanSettings');
            }

            //this.addLog('[RECONCILE] 📡 Fetching account info to verify holdings...', 'info');

            const accountInfoResponse = await queueFunctionCall(
                liveTradingAPI,
                { action: 'getAccountInfo', tradingMode: this.getTradingMode(), proxyUrl: proxyUrl },
                'critical',
                null,
                0,
                120000
            );

            let binanceBalances = [];
            // Extract the actual Binance response, similar to _executeBinanceMarketSellOrder
            const getBinanceResponseLocal = (apiResponse) => {
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
            };

            const accountInfo = getBinanceResponseLocal(accountInfoResponse);
            
            if (accountInfo?.balances) {
                binanceBalances = accountInfo.balances;
            } else {
                throw new Error('Failed to fetch valid account balances from Binance.');
            }

            const binanceHoldingsMap = new Map();
            binanceBalances.forEach(balance => {
                const total = parseFloat(balance.free || '0') + parseFloat(balance.locked || '0');
                if (total > 0 && balance.asset !== 'USDT') {
                    binanceHoldingsMap.set(balance.asset, total);
                }
            });

            //this.addLog(`[RECONCILE] 📊 Found ${binanceHoldingsMap.size} non-USDT assets on Binance`, 'info');

            const initialPositionsInDb = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            this.addLog(`[RECONCILE] 💾 Found ${initialPositionsInDb?.length || 0} active positions in database`, 'info');

            const ghostPositions = [];
            for (const position of initialPositionsInDb || []) {
                const baseAsset = position.symbol.replace('/USDT', '').replace('USDT', '');
                const heldQuantity = binanceHoldingsMap.get(baseAsset) || 0;
                
                //this.addLog(`[PositionManager] 🔍 Checking ${position.symbol} (LivePosition DB ID: ${position.id}, Position ID: ${position.position_id}): Expected: ${position.quantity_crypto}, Held: ${heldQuantity}`, 'debug');

                const minHeldRequired = position.quantity_crypto * 0.99; // Allow for up to 1% discrepancy due to fees/rounding
                if (heldQuantity < minHeldRequired) {
                    this.addLog(`[RECONCILE] 👻 Ghost: ${position.symbol} (Expected: ${position.quantity_crypto}, Held: ${heldQuantity})`, 'warning');
                    ghostPositions.push(position);
                }
            }

            if (ghostPositions.length > 0) {
                this.addLog(`[RECONCILE] ⚠️ Cleaning ${ghostPositions.length} ghost positions`, 'warning');
            } else {
                this.addLog('[RECONCILE] ✅ No ghost positions detected', 'success');
            }

            let cleanedCount = 0;
            for (const position of ghostPositions) {
                try {
                    await this._safeDeleteLivePosition(position.id); // Use safe delete helper
                    cleanedCount++;
                } catch (deleteError) {
                    // _safeDeleteLivePosition already logs
                }
            }

            // Reload the managed state to ensure internal caches are up-to-date with DB deletions.
            // This is CRITICAL for consistency.
            const walletState = this.scannerService.state.liveWalletState; // Get the active wallet state
            if (walletState && walletState.id) {
                // Modified call to pass the walletState object directly
                await this.loadManagedState(walletState);
            } else {
                this.addLog(`[RECONCILE] ⚠️ No active wallet state to reload after reconciliation. this.positions might be outdated.`, 'warning');
                this.positions = []; // Clear in-memory positions as we can't reliably reload
            }
            
            this.addLog(`[RECONCILE] ✅ Complete: ${cleanedCount} ghosts cleaned, ${this.positions.length} positions remaining`, 'success');
            //this.addLog('═══════════════════════════════════════════════════════', 'debug');

            return {
                success: true,
                summary: {
                    positionsRemaining: this.positions.length,
                    ghostPositionsCleaned: cleanedCount
                }
            };

        } catch (error) {
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            this.addLog('[RECONCILE] ===== RECONCILIATION ERROR =====', 'error');
            this.addLog(`[RECONCILE] Error type: ${error.constructor.name}`, 'error');
            this.addLog(`[RECONCILE] Error message: ${error.message}`, 'error');
            this.addLog(`[RECONCILE] Error stack: ${error.stack}`, 'error');
            
            if (error.response) {
                this.addLog(`[RECONCILE] HTTP Error Response: ${JSON.stringify({
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data,
                    headers: error.response.headers
                })}`, 'error');
            }
            
            if (error.config) {
                this.addLog(`[RECONCILE] Request config: ${JSON.stringify({
                    url: error.config.url,
                    method: error.config.method,
                    params: error.config.params,
                    data: error.config.data
                })}`, 'error');
            }

            this.addLog(`[RECONCILE] Full error object: ${JSON.stringify(error)}`, 'error');
            
            this.addLog(`[RECONCILE] ❌ Reconciliation failed: ${error.message}`, 'error');
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Helper to format quantity for logging and Binance API calls.
     * This method fetches symbol-specific filters and quantizes the quantity,
     * then uses the global `_formatQuantityString` for final precision formatting.
     * @param {string} symbol - The trading pair symbol (e.g., "BTCUSDT").
     * @param {number} quantity - The calculated quantity.
     * @param {number|null} currentPrice - The current market price for notional value calculation.
     * @returns {Promise<string>} The quantity rounded to the appropriate decimal places and respecting LOT_SIZE filter, as a string.
     */
    async formatQuantityForSymbol(symbol, quantity, currentPrice = null) {

        try {
            const exchangeInfo = this.scannerService.state.exchangeInfo;

            if (!exchangeInfo || typeof exchangeInfo !== 'object' || Object.keys(exchangeInfo).length === 0) {
                this.addLog('[FORMAT_QTY] ⚠️ No exchange info, returning formatted quantity', 'warning');
                // Fallback to simple formatting if exchange info isn't available
                return parseFloat(quantity).toFixed(8).replace(/\.?0+$/, '');
            }

            // CRITICAL FIX: exchangeInfo is a map, not an object with .symbols array
            const symbolNoSlash = symbol.replace('/', '');
            const symbolInfo = exchangeInfo[symbolNoSlash];
            
            if (!symbolInfo || !symbolInfo.filters) {
                this.addLog('[FORMAT_QTY] ⚠️ Symbol not found in exchange info, returning formatted quantity', 'warning');
                // Fallback to simple formatting if symbol info isn't available
                return parseFloat(quantity).toFixed(8).replace(/\.?0+$/, '');
            }

            const lotSizeFilter = symbolInfo.filters['LOT_SIZE'];
            const minNotionalFilter = symbolInfo.filters['NOTIONAL'] || symbolInfo.filters['MIN_NOTIONAL'];

            if (!lotSizeFilter) {
                this.addLog('[FORMAT_QTY] ⚠️ No LOT_SIZE filter, returning formatted quantity', 'warning');
                // Fallback to simple formatting if LOT_SIZE filter isn't available
                return parseFloat(quantity).toFixed(8).replace(/\.?0+$/, '');
            }

            const minQty = parseFloat(lotSizeFilter.minQty);
            const maxQty = parseFloat(lotSizeFilter.maxQty);
            const stepSize = parseFloat(lotSizeFilter.stepSize);

            let qty = parseFloat(quantity);

            // Comprehensive validation and adjustment
            if (isNaN(qty) || qty <= 0) {
                 this.addLog(`[FORMAT_QTY] ❌ Invalid initial quantity: ${qty}`, 'error');
                 throw new Error(`Invalid quantity provided: ${quantity}`);
            }

            // Round quantity to maximum precision allowed by stepSize first
            // This prevents floating point errors when checking minQty/maxQty later
            // The `_formatQuantityString` will handle the final precision.
            // This intermediate precision should be high enough not to lose data.
            let intermediatePrecision = 8; // Sufficient for most crypto quantities
            const stepStr = String(stepSize);
            if (stepStr.includes('.')) {
                intermediatePrecision = Math.max(intermediatePrecision, stepStr.split('.')[1].length + 4); // Add buffer
            }
            qty = parseFloat(qty.toFixed(intermediatePrecision));

            // Check minimum quantity
            if (qty < minQty) {
                this.addLog(`[FORMAT_QTY] ❌ Quantity below minimum! Qty: ${qty}, Min: ${minQty}`, 'error');
                throw new Error(`Quantity ${qty.toFixed(8)} is below minimum ${minQty} for ${symbolNoSlash}`);
            }

            // Check maximum quantity
            if (qty > maxQty) {
                this.addLog(`[FORMAT_QTY] ⚠️ Quantity above maximum, capping to maxQty. Qty: ${qty}, Max: ${maxQty}`, 'warning');
                qty = maxQty;
            }

            // Adjust to step size (quantize)
            const steps = Math.floor(qty / stepSize);
            const adjustedQty = steps * stepSize;

            // Use the new global helper for final string formatting
            const formattedQty = _formatQuantityString(adjustedQty, stepSize);

            const finalQty = parseFloat(formattedQty);

            // Final check: ensure still above minimum after adjustments
            if (finalQty < minQty) {
                this.addLog(`[FORMAT_QTY] ❌ After adjustment, quantity is below minimum! Final: ${finalQty}, Min: ${minQty}`, 'error');
                throw new Error(`After step size adjustment, quantity ${finalQty} is still below minimum ${minQty} for ${symbolNoSlash}`);
            }

            // Check min notional if we have current price
            if (currentPrice !== null && typeof currentPrice === 'number' && currentPrice > 0 && minNotionalFilter) {
                const minNotional = parseFloat(minNotionalFilter.minNotional || minNotionalFilter.notional);
                const notionalValue = finalQty * currentPrice;

                if (notionalValue < minNotional) {
                    this.addLog(`[FORMAT_QTY] ❌ Notional value below minimum! Notional: ${notionalValue}, Min: ${minNotional}, Symbol: ${symbolNoSlash}`, 'error');
                    throw new Error(`Trade value ${notionalValue.toFixed(2)} USDT is below minimum ${minNotional} USDT for ${symbolNoSlash}`);
                }
            }

            return formattedQty;

        } catch (error) {
            this.addLog(`[FORMAT_QTY] ❌ Error in formatQuantityForSymbol: ${error.message}`, 'error');
            // Re-throw the error for the caller to handle
            throw error;
        }
    }


    /**
     * Internal helper to execute a market sell order on Binance.
     * @param {object} position - The position object to close.
     * @param {number} currentPrice - The current market price.
     * @param {string} tradingMode - The trading mode ('live' or 'testnet').
     * @param {string} proxyUrl - The proxy URL for Binance API.
     * @param {object} options - Optional parameters including exit reason and P&L for logging.
     * @returns {Promise<{success: boolean, orderResult?: object, error?: string, isWarning?: boolean, skipped?: boolean, reason?: string, attemptedQty?: number}>}
     */
    async _executeBinanceMarketSellOrder(position, { currentPrice, tradingMode, proxyUrl, ...options }) {
        const logPrefix = '[BINANCE_SELL]';
        try {
            // STRICT: validate presence and positive quantity before formatting or sending orders
            const rawQty = position?.quantity_crypto;
            const qtyNum = Number(rawQty);

            if (!position || !position.symbol) {
                this.addLog(`${logPrefix} ❌ Skipping SELL: invalid position object received.`, 'error');
                return { success: false, error: 'Invalid position object', code: 'INVALID_POSITION', skip: true };
            }

            if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
                this.addLog(
                    `${logPrefix} ⚠️ Skipping SELL for ${position.symbol}: invalid quantity (${rawQty}). Record looks incomplete/corrupted.`,
                    'warning'
                );
                return { success: false, error: `Invalid quantity provided: ${rawQty}`, code: 'INVALID_QUANTITY', skip: true };
            }

            if (!proxyUrl) {
                const errorMsg = 'Proxy URL not configured in settings. Cannot execute close order.';
                this.scannerService.addLog(`${logPrefix} ❌ ${errorMsg}`, 'error');
                return { success: false, error: errorMsg };
            }

            const symbolKey = (position?.symbol || "").replace("/", ""); // e.g., CHZUSDT
            const baseAsset = (position?.symbol || "").split("/")[0];     // e.g., CHZ
            if (!symbolKey || !baseAsset) {
                this.addLog(`${logPrefix} ❌ Missing symbol/baseAsset for position ${position?.position_id}`, "error");
                throw new Error("Invalid symbol for sell");
            }

            // Get cached exchange info and critical filters
            const symbolInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolKey) : null;
            if (!symbolInfo) {
                this.addLog(`${logPrefix} ⚠️ No exchange info cached for ${symbolKey}`, "error");
                throw new Error(`No exchange info for ${symbolKey}`);
            }
            const { minNotional, minQty, stepSize } = getSymbolFiltersFromInfo(symbolInfo);

            const positionQty = Number(position?.quantity_crypto || 0);
            if (!Number.isFinite(positionQty) || positionQty <= 0) {
                this.addLog(`${logPrefix} ⚠️ Position qty invalid for ${symbolKey}: ${positionQty}`, "error");
                throw new Error("Invalid position quantity");
            }

            // 1) Fresh free balance pull to avoid -2010
            const freeBalance = await fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl });

            // 2) Compute requested quantity = min(position qty, free balance), then round down to lot-size step
            let requestedQty = Math.min(positionQty, freeBalance);
            requestedQty = roundDownToStepSize(requestedQty, stepSize); // This is a numeric value

            // 3) Validate against lot-size and notional; if below thresholds, skip as dust and trigger reconcile
            const notional = requestedQty * Number(currentPrice || 0);
            const belowLot = minQty && requestedQty < minQty - 1e-12;
            const belowNotional = minNotional && notional < (minNotional - 1e-8);

            if (requestedQty <= 0 || belowLot || belowNotional) {
                this.addLog(
                    `${logPrefix} 🧹 Skipping SELL for ${symbolKey} due to dust/thresholds. ` +
                    `free=${freeBalance.toFixed(8)}, posQty=${positionQty.toFixed(8)}, step=${stepSize}, minQty=${minQty}, ` +
                    `minNotional=${minNotional}, price=${currentPrice}, computedQty=${requestedQty.toFixed(8)}, notional=${notional.toFixed(6)}`,
                    "signal_not_found"
                );

                // Soft action: request a reconciliation instead of erroring
                if (typeof this.reconcileWithBinance === "function") {
                    this.addLog(`${logPrefix} 🔄 Triggering reconciliation after dust-skip for ${symbolKey}`, "cycle");
                    // Fire and forget; don't block
                    this.reconcileWithBinance().catch(() => { });
                }
                // Return a structured "skipped" result to upstream caller to prevent 400s
                return { skipped: true, reason: "dust_or_below_threshold", attemptedQty: requestedQty };
            }

            // 4) Attempt SELL order (first try)
            const attemptSell = async (qty) => {
                const quantityStr = _formatQuantityString(qty, stepSize); // Use the new global helper for API string
                this.addLog(`${logPrefix} ▶️ Placing MARKET SELL ${symbolKey} qty=${quantityStr}`, "position_opening");
                const response = await queueFunctionCall(
                    liveTradingAPI,
                    {
                        action: "createOrder",
                        tradingMode,
                        proxyUrl,
                        symbol: symbolKey,
                        side: "SELL",
                        orderType: "MARKET",
                        quantity: quantityStr
                    },
                    "critical",
                    null,
                    45000
                );
                return response;
            };

            // Helper to extract error code/message if available
            const parseErr = (err) => {
                try {
                    const d = err?.response?.data;
                    // Check for nested proxy response first
                    if (d?.data?.success === false && d?.data?.data) { // Example: {success:true, data:{success:false, data:{code,msg}}}
                        const innerError = d.data.data;
                        return { code: innerError.code, message: innerError.message || innerError.msg || "Unknown proxy error" };
                    }
                    // Then for top-level proxy error
                    const proxyTxt = d?.error || d?.message || ""; // Sometimes error string is directly in 'error' field
                    if (typeof proxyTxt === "string" && proxyTxt.includes("{") && proxyTxt.includes("}")) {
                        try {
                            const m = proxyTxt.match(/\{.*\}/);
                            if (m) {
                                const inner = JSON.parse(m[0]);
                                return { code: inner.code, message: inner.message || inner.msg || proxyTxt };
                            }
                        } catch(e) { /* ignore JSON parse error, treat as plain text */ }
                    }
                    return { code: d?.code, message: d?.message || err?.message };
                } catch {
                    return { code: undefined, message: err?.message };
                }
            };


            try {
                const resp = await attemptSell(requestedQty);
                // Use the local getBinanceResponse helper to extract actual data
                const getBinanceResponseLocal = (apiResponse) => {
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
                };
                const binanceProcessedResponse = getBinanceResponseLocal(resp);

                // Check for Binance API error codes/messages from the processed response
                if (!binanceProcessedResponse || binanceProcessedResponse.code) { // binanceProcessedResponse.code implies error
                    const errorMessage = binanceProcessedResponse?.msg || binanceProcessedResponse?.message || resp?.data?.data?.message || resp?.data?.message || 'Unknown error from Binance API';
                    const errorCode = binanceProcessedResponse?.code || resp?.data?.data?.code;
                    throw Object.assign(new Error(`Binance API Error ${errorCode}: ${errorMessage}`), { code: errorCode, message: errorMessage });
                }

                if (binanceProcessedResponse?.orderId) {
                    const symbolRaw = (position?.symbol || '').replace('/', '');
                    let execPrice = Number(binanceProcessedResponse?.avgPrice ?? binanceProcessedResponse?.price);
                    if (!Number.isFinite(execPrice) || execPrice <= 0) execPrice = Number(currentPrice);
                    if (!Number.isFinite(execPrice) || execPrice <= 0) { // Fallback to scannerService if currentPrice is bad
                        const svcPrice = this.scannerService.currentPrices[symbolRaw];
                        if (Number.isFinite(svcPrice) && svcPrice > 0) execPrice = Number(svcPrice);
                    }
                    if (!Number.isFinite(execPrice) || execPrice <= 0) execPrice = Number(options?.exit_price ?? position?.exit_price);

                    const priceStr = this._formatPriceSmart(execPrice);
                    const priceLabel = priceStr ? ` $${priceStr}` : '';

                    const suffix = this._formatCloseReasonAndPnl({
                        exitReason: options?.exitReason || position?.exit_reason,
                        pnlUsdt: options?.pnl_usdt ?? options?.pnlUsd ?? position?.pnl_usdt,
                        pnlPercentage: options?.pnl_percentage ?? options?.pnlPercent ?? position?.pnl_percentage,
                    });

                    this.addLog(
                        `${logPrefix} ✅ Binance SELL executed: ${requestedQty.toFixed(8)} ${symbolKey} (Order: ${binanceProcessedResponse.orderId})${priceLabel}${suffix}`,
                        'success',
                        { level: 2 }
                    );
                } else {
                    throw new Error('Binance order did not return an orderId, despite no explicit error.');
                }
                return { success: true, orderResult: binanceProcessedResponse }; // Return the raw processed response

            } catch (err) {
                const { code, message } = parseErr(err);
                const msg = (message || "").toLowerCase();

                // 5) Single retry if insufficient balance or 400-like scenarios
                const isInsufficient = code === -2010 || msg.includes("insufficient balance");
                const is400 = (err?.response?.status === 400);

                if (isInsufficient || is400) {
                    this.addLog(
                        `${logPrefix} ⚠️ First SELL attempt failed for ${symbolKey} (code=${code || "n/a"}). ` +
                        `Refreshing balance and retrying once...`,
                        "signal_mismatch"
                    );
                    // Refresh balance and recompute sell qty
                    const fresh = await fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl });
                    let retryQty = Math.min(positionQty, fresh);
                    retryQty = roundDownToStepSize(retryQty, stepSize); // This is a numeric value
                    const retryNotional = retryQty * Number(currentPrice || 0);

                    const retryBelowLot = minQty && retryQty < minQty - 1e-12;
                    const retryBelowNotional = minNotional && retryNotional < (minNotional - 1e-8);

                    if (!Number.isFinite(retryQty) || retryQty <= 0 || retryBelowLot || retryBelowNotional) {
                        this.addLog(
                            `${logPrefix} 🧹 Retry skip for ${symbolKey}: fresh=${fresh.toFixed(8)}, qty=${retryQty.toFixed(8)}, notional=${retryNotional.toFixed(6)} ` +
                            `(minQty=${minQty}, minNotional=${minNotional})`,
                            "signal_not_found"
                        );
                        if (typeof this.reconcileWithBinance === "function") {
                            this.reconcileWithBinance().catch(() => { });
                        }
                        return { skipped: true, reason: "retry_below_threshold", attemptedQty: retryQty };
                    }
                    
                    const resp2 = await attemptSell(retryQty);
                    // Process retry response
                    const getBinanceResponseLocal = (apiResponse) => {
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
                    };
                    const binanceProcessedResponse2 = getBinanceResponseLocal(resp2);

                    if (!binanceProcessedResponse2 || binanceProcessedResponse2.code) {
                        const errorMessage = binanceProcessedResponse2?.msg || binanceProcessedResponse2?.message || resp2?.data?.data?.message || resp2?.data?.message || 'Unknown error from Binance API';
                        const errorCode = binanceProcessedResponse2?.code || resp2?.data?.data?.code;
                        throw Object.assign(new Error(`Binance API Error ${errorCode}: ${errorMessage} (after retry)`), { code: errorCode, message: errorMessage });
                    }
                    
                    if (binanceProcessedResponse2?.orderId) {
                         const symbolRaw = (position?.symbol || '').replace('/', '');
                         let execPrice = Number(binanceProcessedResponse2?.avgPrice ?? binanceProcessedResponse2?.price);
                         if (!Number.isFinite(execPrice) || execPrice <= 0) execPrice = Number(currentPrice);
                         if (!Number.isFinite(execPrice) || execPrice <= 0) { // Fallback to scannerService if currentPrice is bad
                            const svcPrice = this.scannerService.currentPrices[symbolRaw];
                            if (Number.isFinite(svcPrice) && svcPrice > 0) execPrice = Number(svcPrice);
                         }
                         if (!Number.isFinite(execPrice) || execPrice <= 0) execPrice = Number(options?.exit_price ?? position?.exit_price);

                         const priceStr = this._formatPriceSmart(execPrice);
                         const priceLabel = priceStr ? ` $${priceStr}` : '';

                         const suffix = this._formatCloseReasonAndPnl({
                             exitReason: options?.exitReason || position?.exit_reason,
                             pnlUsdt: options?.pnl_usdt ?? options?.pnlUsd ?? position?.pnl_usdt,
                             pnlPercentage: options?.pnl_percentage ?? options?.pnlPercent ?? position?.pnl_percentage,
                         });

                        this.addLog(
                            `${logPrefix} ✅ Retry SELL executed: ${retryQty.toFixed(8)} ${symbolKey} (Order: ${binanceProcessedResponse2.orderId})${priceLabel}${suffix}`,
                            'success',
                            { level: 2 }
                        );
                    } else {
                        throw new Error('Binance order did not return an orderId after retry, despite no explicit error.');
                    }
                    return { success: true, orderResult: binanceProcessedResponse2 };
                }

                // Unknown/other error: rethrow so upstream handles it
                this.addLog(`${logPrefix} ❌ Critical error executing Binance market sell for ${position.symbol}: ${message}`, 'error', err);
                throw Object.assign(new Error(message), { code: code, isInsufficient: isInsufficient });
            }
        } catch (e) {
            // Keep existing error path and logging unchanged, but ensure a clear prefix
            const errorMessage = e?.message || 'Unknown error';
            const isInsufficientBalance = e.isInsufficient || errorMessage.toLowerCase().includes('insufficient balance');

            this.scannerService.addLog(`${logPrefix} ❌ Critical error executing Binance market sell for ${position?.symbol || "UNKNOWN"}: ${errorMessage}`, 'error', e);

            throw Object.assign(new Error(errorMessage), { isInsufficient: isInsufficientBalance });
        }
    }


    /**
     * Executes the Binance sell order for a position (LIVE/TESTNET mode only).
     * @param {object} position - The position object to close.
     * @param {number} exitPrice - The determined exit price.
     * @returns {Promise<{success: boolean, orderResult?: object, error?: string, isWarning?: boolean}>}
     */
    async closePositionOnBinance(position, exitPrice) { // Added exitPrice parameter
        if (this.isLiveMode() || this.isTestnetMode()) {
            try {
                const tradingMode = this.getTradingMode();
                const proxyUrl = this.scannerService.state.settings?.local_proxy_url;

                // Pass exitPrice as currentPrice and other required parameters
                const binanceResult = await this._executeBinanceMarketSellOrder(position, { currentPrice: exitPrice, tradingMode, proxyUrl });
                
                // If _executeBinanceMarketSellOrder skipped due to invalid quantity, propagate that
                if (binanceResult.skip || binanceResult.skipped) { // Handle both `skip` (old) and `skipped` (new)
                    return { success: false, error: binanceResult.error || binanceResult.reason, isWarning: true, skipped: true };
                }

                // binanceResult.orderResult will contain the full Binance response including fills
                return { success: binanceResult.success, orderResult: binanceResult.orderResult };
            } catch (error) {
                // Catch errors thrown by _executeBinanceMarketSellOrder (e.g., quantity formatting)
                // If isWarning is set, it means it's an insufficient balance issue we might want to virtually close
                const isWarning = error.isWarning || error.message.includes('Insufficient balance') || error.isInsufficient;
                return { success: false, error: error.message, isWarning: isWarning, isInsufficientBalance: error.isInsufficient };
            }
        } else { // DEMO mode
            this.scannerService.addLog(`[DEMO_CLOSE] Simulating market sell order for DEMO mode.`, 'info');
            // Synthesize a minimal result for demo mode
            const currentPriceForDemo = this.scannerService.currentPrices[position.symbol.replace('/', '')] || position.entry_price;
            return { success: true, orderResult: { orderId: `demo_close_${Date.now()}`, fills: [{ price: currentPriceForDemo }] } };
        }
    }

    /**
     * Internal helper to update trailing stop logic and price tracking for a position.
     * This replaces the old _updatePositionPriceTracking that was deleted from AutoScannerService.
     * 
     * @param {object} position - The position to update
     * @param {number} currentPrice - Current market price
     * @returns {object} - { updatedPosition, trailingStopTriggered }
     */
    _updateTrailingStopAndPriceTracking(position, currentPrice) {
        const updatedPosition = { ...position };
        let trailingStopTriggered = false;

        // Update peak and trough prices
        if (!updatedPosition.peak_price || currentPrice > updatedPosition.peak_price) {
            updatedPosition.peak_price = currentPrice;
        }
        if (!updatedPosition.trough_price || currentPrice < updatedPosition.trough_price) {
            updatedPosition.trough_price = currentPrice;
        }

        // Handle trailing stop logic for LONG positions (spot trading is long only)
        if (updatedPosition.direction === 'long') {
            // Check if we should activate trailing stop (if position is in profit and trailing is enabled)
            const profitPercent = ((currentPrice - updatedPosition.entry_price) / updatedPosition.entry_price) * 100;
            const takeProfitPercent = updatedPosition.take_profit_price 
                ? ((updatedPosition.take_profit_price - updatedPosition.entry_price) / updatedPosition.entry_price) * 100
                : 5; // Default 5% if no take profit set

            // Activate trailing if we're at or above 50% of the way to take profit
            const shouldActivateTrailing = !updatedPosition.is_trailing && updatedPosition.enableTrailingTakeProfit && profitPercent >= (takeProfitPercent * 0.5);

            if (shouldActivateTrailing) {
                // Initialize trailing stop at current price minus a buffer (e.g., 2% below current)
                const trailingBuffer = 0.02; // 2%
                updatedPosition.trailing_stop_price = currentPrice * (1 - trailingBuffer);
                updatedPosition.is_trailing = true;
                updatedPosition.trailing_peak_price = currentPrice;
                updatedPosition.status = 'trailing';
                
                this.scannerService.addLog(`[TRAILING] ✅ Activated trailing stop for ${position.symbol} at ${this._formatCurrency(updatedPosition.trailing_stop_price)}`, 'success');
            }

            // If already trailing, update the trailing stop as price climbs
            if (updatedPosition.is_trailing && updatedPosition.trailing_peak_price) {
                if (currentPrice > updatedPosition.trailing_peak_price) {
                    updatedPosition.trailing_peak_price = currentPrice;
                    
                    // Move trailing stop up (e.e., keep it 2% below the peak)
                    const trailingBuffer = 0.02; // 2%
                    const newTrailingStop = updatedPosition.trailing_peak_price * (1 - trailingBuffer); // Use trailing_peak_price for calculation
                    
                    // Ensure the trailing stop only moves up, not down
                    if (newTrailingStop > updatedPosition.trailing_stop_price) {
                        updatedPosition.trailing_stop_price = newTrailingStop;
                        this.scannerService.addLog(`[TRAILING] 📈 Updated trailing stop for ${position.symbol} to ${this._formatCurrency(updatedPosition.trailing_stop_price)} (peak: ${this._formatCurrency(updatedPosition.trailing_peak_price)})`, 'info');
                    }
                }

                // Check if trailing stop was hit
                if (currentPrice <= updatedPosition.trailing_stop_price) {
                    trailingStopTriggered = true;
                    this.scannerService.addLog(`[TRAILING] 🎯 Trailing stop triggered for ${position.symbol}! Current: ${this._formatCurrency(currentPrice)}, Stop: ${this._formatCurrency(updatedPosition.trailing_stop_price)}`, 'success');
                }
            }
        }

        return { updatedPosition, trailingStopTriggered };
    }


    /**
     * Monitors open positions and identifies those that need to be closed
     * based on time exit, stop loss, take profit, or trailing stop.
     * @param {Object} currentPrices - An object containing current prices for symbols, e.e., { 'BTCUSDT': 30000 }.
     * @returns {Object} An object containing arrays of trades to create and position IDs to close.
     */
    async monitorAndClosePositions(currentPrices = null) {
        // Initialize local arrays for this cycle
        const tradesToCreate = [];
        const positionIdsToClose = [];

        const now = Date.now();
            
        // Early exit conditions
        const walletState = this.getActiveWalletState();
        
        // NEW: Early exit for wallet state (from outline)
        if (!walletState) {
            this.addLog('[DEBUG_MONITOR] ⚠️ No live wallet state available, skipping monitoring', 'warning');
            return { tradesToCreate: 0, positionIdsToClose: 0 }; // Adjusted return to match successful execution counts
        }
        const walletId = walletState.id; // From outline
        const mode = this.scannerService.getTradingMode(); // From outline
        // END NEW

        if (!this.scannerService.state.isRunning) {
            this.addLog('[POSITIONS_MONITOR] ⚠️ Scanner service is not running, skipping position monitoring.', 'warning');
            return { tradesToCreate: [], positionIdsToClose: [] };
        }

        if (this.positions.length === 0) { // NEW check for empty this.positions
            this.addLog('[DEBUG_MONITOR] No positions to monitor', 'debug');
            return { tradesToCreate: [], positionIdsToClose: [] };
        }

        if (!currentPrices || typeof currentPrices !== 'object' || Object.keys(currentPrices).length === 0) {
            this.addLog('[DEBUG_MONITOR] ⚠️ No current prices available for monitoring', 'warning');
            this.addLog('[POSITIONS_MONITOR] ⚠️ No valid price data available, skipping monitoring', 'warning');
            return { tradesToCreate: [], positionIdsToClose: [] };
        }

        // Logging from outline, adapted
        this.addLog(`[MONITOR] 🛡️ Monitoring ${this.positions.length} open positions in ${mode.toUpperCase()} wallet (ID: ${walletId}).`, 'scan', { level: 1 });
        // END Logging

        const maxPositionAgeHours = 12; // Force close after 12 hours regardless of other conditions

        let positionsUpdatedButStillOpen = [];

        const pricesSource = currentPrices || this.scannerService.currentPrices || {};
        
        // eslint-disable-next-line no-unused-vars
        let loopIterations = 0;

        for (const position of this.positions) { // Looping directly over this.positions
            loopIterations++;
            
            // CRITICAL FIX: Validate that position has an ID before processing
            if (!position.id) {
                this.addLog('[DEBUG_MONITOR] ❌ CRITICAL: Position has no DB ID!', 'error', {
                    position_id: position.position_id,
                    symbol: position.symbol,
                    strategy_name: position.strategy_name
                });
                this.scannerService.addLog(
                    `[MONITOR] ⚠️ Skipping position ${position.symbol} - missing database ID`,
                    'warning'
                );
                continue;
            }
                
            if (position.status !== 'open' && position.status !== 'trailing') {
                this.addLog(`[DEBUG_MONITOR] ⏭️ Skipping position - status is ${position.status}`, 'debug');
                this.addLog(
                    `[MONITOR] ⏭️ Skipping ${position.symbol} - already in ${position.status} state`,
                    'info',
                    { level: 2 }
                );
                continue;
            }

            try {
                const cleanSymbol = position.symbol.replace('/', '');
                const currentPrice = pricesSource[cleanSymbol];
                const entryTime = new Date(position.entry_timestamp).getTime();

                // Skip if no valid current price (prerequisite for price-based exits)
                if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                    this.scannerService.addLog(`[POSITION_MONITOR] ⚠️ Skipping ${position.symbol} (ID: ${position.position_id}) - invalid/missing price. Current price: ${currentPrice}.`, 'warning');
                    continue;
                }

                let tempPosition = { ...position }; // Working copy

                // Update peak and trough prices
                if (!tempPosition.peak_price || currentPrice > tempPosition.peak_price) {
                    tempPosition.peak_price = currentPrice;
                }
                if (!tempPosition.trough_price || currentPrice < tempPosition.trough_price) {
                    tempPosition.trough_price = currentPrice;
                }

                // 1. (Existing) Force close stuck positions (global safety net)
                const positionAgeHours = (now - entryTime) / (1000 * 60 * 60);
                if (positionAgeHours > maxPositionAgeHours) {
                    this.scannerService.addLog(`[MONITOR] 🚨 FORCE CLOSING stuck position ${cleanSymbol} (ID: ${position.position_id}) - exceeded maximum age.`, 'warning');
                    const tradeData = this._createTradeFromPosition(tempPosition, currentPrice || tempPosition.entry_price, 'timeout', { custom_exit_message: `Force closed - exceeded maximum age (${positionAgeHours.toFixed(1)}h)` });
                    tradesToCreate.push(tradeData);
                    positionIdsToClose.push(position.id); // Fixed to use position.id
                    continue;
                }

                // 2. (NEW) Specific time-based exit for this position's strategy
                if (tempPosition.time_exit_hours !== null && tempPosition.time_exit_hours !== undefined) {
                    const timeElapsedMs = now - entryTime;
                    const timeElapsedHours = timeElapsedMs / (1000 * 60 * 60);
                    const timeExitHours = tempPosition.time_exit_hours;

                    if (timeElapsedHours >= timeExitHours) {
                        // eslint-disable-next-line no-unused-vars
                        const overdueHours = timeElapsedHours - timeExitHours;

                        /*this.addLog(
                            `[MONITOR] ⏰ Time-based exit triggered for ${cleanSymbol} (ID: ${tempPosition.position_id}). ` +
                            `Elapsed: ${timeElapsedHours.toFixed(2)}h, Limit: ${timeExitHours.toFixed(2)}h, Overdue: ${overdueHours.toFixed(2)}h. Closing at ${this._formatCurrency(currentPrice)}`,
                            'info',
                            { level: 2 }
                        );*/
                        const tradeData = this._createTradeFromPosition(tempPosition, currentPrice, 'timeout', { custom_exit_message: `Time-based exit reached (${timeElapsedHours.toFixed(2)}h)` });
                        
                        if (tradeData) {
                            tradesToCreate.push(tradeData);
                            positionIdsToClose.push(position.id); // FIXED: Use position.id directly, not tempPosition
                        } else {
                            this.addLog(`[POSITIONS_MONITOR] ❌ Failed to create trade for ${tempPosition.position_id}`, 'error');
                        }
                        continue;
                    }
                }


                // 3. (Existing) Check take profit (from outline, TP before SL)
                if (tempPosition.take_profit_price) {
                    if (currentPrice >= tempPosition.take_profit_price) {
                        this.addLog(
                            `[MONITOR] 🎯 Take profit hit for ${cleanSymbol} (ID: ${tempPosition.position_id}) at ${this._formatPriceSmart(currentPrice)} (target: ${this._formatPriceSmart(tempPosition.take_profit_price)})`,
                            'success',
                            { level: 2 }
                        );
                        const tradeData = this._createTradeFromPosition(tempPosition, currentPrice, 'take_profit', { custom_exit_message: 'Take profit hit' });
                        tradesToCreate.push(tradeData);
                        positionIdsToClose.push(position.id); // FIXED: Use position.id
                        continue;
                    }
                }

                // 4. (Existing) Handle Stop Loss (if triggered)
                if (tempPosition.stop_loss_price) {
                    if (currentPrice <= tempPosition.stop_loss_price) {
                        this.addLog(
                            `[MONITOR] 🛑 Stop loss hit for ${cleanSymbol} (ID: ${tempPosition.position_id}) at ${this._formatPriceSmart(currentPrice)} (stop: ${this._formatPriceSmart(tempPosition.stop_loss_price)})`,
                            'warning',
                            { level: 2 }
                        );

                        const tradeData = this._createTradeFromPosition(tempPosition, currentPrice, 'stop_loss', { custom_exit_message: 'Stop loss hit' });
                        tradesToCreate.push(tradeData);
                        positionIdsToClose.push(position.id); // FIXED: Use position.id
                        continue;
                    }
                }
                
                // 5. (Existing) Handle Trailing Stop/Take Profit Logic (uses _updateTrailingStopAndPriceTracking)
                const { updatedPosition: postTrailingPosition, trailingStopTriggered } = this._updateTrailingStopAndPriceTracking(tempPosition, currentPrice);

                // Re-assign tempPosition to the potentially updated one for subsequent checks within this loop
                tempPosition = postTrailingPosition;

                // 6. (Existing) If trailing stop was triggered by the helper
                if (trailingStopTriggered) {
                    this.scannerService.addLog(`[MONITOR] 🎯 Trailing stop triggered for ${cleanSymbol} (ID: ${tempPosition.position_id}) at ${this._formatPriceSmart(currentPrice)}`, 'info');
                    const tradeData = this._createTradeFromPosition(tempPosition, currentPrice, 'trailing_stop_hit', { custom_exit_message: 'Trailing stop triggered' });
                    tradesToCreate.push(tradeData);
                    positionIdsToClose.push(position.id); // FIXED: Use position.id
                    continue;
                } else if (postTrailingPosition.position_id && postTrailingPosition !== position) { // Only add if it was actually modified AND has a valid ID
                    positionsUpdatedButStillOpen.push(postTrailingPosition);
                }

            } catch (error) {
                this.addLog(`[DEBUG_MONITOR] ❌ Error checking position ${position.symbol}: ${error}`, 'error');
                this.addLog(`[DEBUG_MONITOR] Error stack: ${error.stack}`, 'error');
                this.addLog(`[POSITIONS_MONITOR] Error monitoring position ${position?.position_id || 'unknown'}: ${error.message}`, 'error');
            }
        }

        // Persist updates for positions that are still open
        if (positionsUpdatedButStillOpen.length > 0) {
            // Map the current wallet positions, replacing updated ones with their new state
            // It's important to update both this.positions and walletState.positions for consistency
            this.positions = this.positions.map(p => {
                const updatedVersion = positionsUpdatedButStillOpen.find(up => up.id === p.id); // Changed to use 'id'
                return updatedVersion || p;
            });
            // Also update the scannerService's in-memory liveWalletState for immediate consistency
            // The `persistWalletChangesAndWait` call will handle updating the DB with these changes
            if (this.scannerService.state.liveWalletState && this.scannerService.state.liveWalletState.id === walletId) {
                 this.scannerService.state.liveWalletState.positions = this.positions; // Ensure walletState.positions mirrors this.positions
            }
            this.needsWalletSave = true; // Mark for persistence if any position tracking updated
        }

        // If any position tracking updates happened, persist the wallet state
        if (this.needsWalletSave) {
            await this.persistWalletChangesAndWait();
            this.needsWalletSave = false; // Reset the flag
            this.scannerService.addLog('[MONITOR] ✅ Wallet state saved after tracking updates.', 'success');
        }

        if (tradesToCreate.length > 0) {
            this.addLog(`[MONITOR] 🔄 Identified ${tradesToCreate.length} positions for closure.`, 'info', { level: 1 });
            
            // CRITICAL FIX: Don't filter out any positions - close all that were identified
            this.addLog(`[POSITIONS_MONITOR] Monitoring complete: positions ready to close: ${positionIdsToClose.length}`, 'debug');
            
            // Execute batch close immediately
            const closeResult = await this.executeBatchClose(tradesToCreate, positionIdsToClose);
            
            if (!closeResult.success) {
                this.addLog(`[DEBUG_MONITOR] ❌ Batch close failed: ${closeResult.error}`, 'error');
                this.addLog(`[MONITOR] ❌ Failed to close positions: ${closeResult.error}`, 'error', { level: 1 });
            } else {
                this.addLog(`[DEBUG_MONITOR] ✅ Batch close successful, closed: ${closeResult.closed}`, 'debug');
                this.addLog(`[MONITOR] ✅ Successfully closed ${closeResult.closed} positions`, 'success', { level: 1 });
            }
        } else {
            this.scannerService.addLog(`[MONITOR] ✅ No positions require closing this cycle.`, 'info');
            //this.addLog('[POSITIONS_MONITOR] Monitoring complete: 0 positions ready to close', 'debug');
        }
            
        // CRITICAL FIX: Ensure positionIdsToClose is unique before returning
        const uniquePositionIdsToClose = [...new Set(positionIdsToClose)];
            
        if (uniquePositionIdsToClose.length !== positionIdsToClose.length) {
            this.addLog(`[DEBUG_MONITOR] ⚠️ Removed ${positionIdsToClose.length - uniquePositionIdsToClose.length} duplicate position IDs`, 'warning');
            this.scannerService.addLog(`[POSITION_MONITOR] 🚨 Removed ${positionIdsToClose.length - uniquePositionIdsToClose.length} IDs from close list`, 'warning');
        }

        this.addLog(`[POSITIONS_MONITOR] Monitoring complete: ${tradesToCreate.length} positions ready to close`, 'info');

        return {
            tradesToCreate: tradesToCreate.length,
            positionIdsToClose: uniquePositionIdsToClose.length
        };
    }


    /**
     * Prepares trade data for a batch of positions identified for closure.
     * @param {Array<Object>} positionsToCloseMeta - Array of objects with position, reason, and exitPrice.
     * @returns {Object} An object containing arrays of trades to create and position IDs to close.
     */
    prepareBatchClose(positionsToCloseMeta) {
        const tradesToCreate = [];
        const positionIdsToClose = [];
        const COMMISSION_RATE = 0.001;

        for (const { position, reason, exitPrice } of positionsToCloseMeta) {
            const pnlUsdtGross = this.calculatePnL(position, exitPrice);

            const entryFees = position.entry_value_usdt * COMMISSION_RATE;
            const exitValueUsdt = exitPrice * position.quantity_crypto;
            const exitFees = exitValueUsdt * COMMISSION_RATE;
            const totalFees = entryFees + exitFees;

            const pnlUsdt = pnlUsdtGross - totalFees;
            const pnlPercentage = position.entry_value_usdt > 0 ? (pnlUsdt / position.entry_value_usdt) * 100 : 0;

            const exitTimestamp = new Date().toISOString();
            const durationSeconds = Math.floor((new Date(exitTimestamp).getTime() - new Date(position.entry_timestamp).getTime()) / 1000);

            const tradeData = {
                trade_id: position.position_id, // This will be the Binance order ID
                strategy_name: position.strategy_name,
                symbol: position.symbol,
                direction: position.direction,
                entry_price: position.entry_price,
                exit_price: exitPrice,
                quantity_crypto: position.quantity_crypto,
                entry_value_usdt: position.entry_value_usdt,
                exit_value_usdt: exitValueUsdt,
                pnl_usdt: pnlUsdt,
                pnl_percentage: pnlPercentage,
                total_fees_usdt: totalFees, // CRITICAL: Ensure total_fees_usdt is included here
                entry_timestamp: position.entry_timestamp,
                exit_timestamp: exitTimestamp,
                duration_seconds: durationSeconds,
                exit_reason: reason,
                leverage: position.leverage || 1,
                take_profit_price: position.take_profit_price,
                wallet_allocation_percentage: position.wallet_allocation_percentage,
                peak_price_during_trade: position.peak_price,
                trough_price_during_trade: position.trough_price,
                exit_trend: this.determineExitTrend(position, exitPrice),
                trigger_signals: position.trigger_signals || [],
                enabled_trailing_take_profit: position.enableTrailingTakeProfit || false,
                was_trailing: position.is_trailing || false,
                final_trailing_stop_price: position.trailing_stop_price,
                combined_strength: position.combined_strength,
                conviction_score: position.conviction_score,
                conviction_breakdown: position.conviction_breakdown,
                conviction_multiplier: position.conviction_multiplier,
                market_regime: position.market_regime,
                regime_confidence: position.regime_confidence,
                is_event_driven_strategy: position.is_event_driven_strategy,
                trading_mode: this.tradingMode
            };
            tradesToCreate.push(tradeData);
            if (position.id) { // Only add if ID exists
                positionIdsToClose.push(position.id); // Use the LivePosition database ID
            }
        }
        return { tradesToCreate, positionIdsToClose };
    }

    /**
     * Executes the batch closure process by recording trades and updating wallet state.
     * This method now handles both live/testnet (Binance interaction) and demo mode.
     * @param {Array<Object>} tradesToCreate - Array of trade data objects to record (these are pre-calculated based on simulated exit prices).
     * @param {Array<string>} positionIdsToClose - Array of LivePosition database IDs to remove from wallet state.
     * @returns {Object} An object containing success status, counts, and total PnL.
     */
    async executeBatchClose(tradesToCreate, positionIdsToClose) {
       /* this.addLog('═══════════════════════════════════════════════════════', 'debug');
        this.addLog('[BATCH_CLOSE] 🚀 executeBatchClose() called', 'debug');
        this.addLog(`[BATCH_CLOSE] Trades to create: ${tradesToCreate.length}`, 'debug');
        this.addLog(`[BATCH_CLOSE] Position IDs to close: ${positionIdsToClose.length}`, 'debug');
        this.addLog(`[BATCH_CLOSE] Position IDs list: ${positionIdsToClose}`, 'debug');
        this.addLog('═══════════════════════════════════════════════════════', 'debug');
*/
        if (tradesToCreate.length === 0 || positionIdsToClose.length === 0) {
            this.addLog('[BATCH_CLOSE] ⚠️ No trades or positions to process, returning early', 'warning');
            return { success: true, closed: 0 };
        }

        // CRITICAL: Validate all position IDs before proceeding
        //this.addLog('[BATCH_CLOSE] 🔍 Validating position IDs...', 'debug');
        const validPositionIds = [];
        const invalidPositionIds = [];

        for (const posId of positionIdsToClose) {
            if (!posId || typeof posId !== 'string') {
                this.addLog(`[BATCH_CLOSE] ❌ Invalid position ID detected: ${posId}`, 'error');
                invalidPositionIds.push(posId);
            } else {
                validPositionIds.push(posId);
            }
        }

        /*this.addLog('[BATCH_CLOSE] Validation results:', 'debug');
        this.addLog(`[BATCH_CLOSE]   • Valid IDs: ${validPositionIds.length}`, 'debug');
        this.addLog(`[BATCH_CLOSE]   • Invalid IDs: ${invalidPositionIds.length}`, 'debug');
*/
        if (invalidPositionIds.length > 0) {
            this.addLog(`[BATCH_CLOSE] 🚨 Removed ${invalidPositionIds.length} IDs from close list`, 'warning');
            this.addLog(`[BATCH_CLOSE] Invalid IDs: ${invalidPositionIds}`, 'warning');
            this.addLog(`[POSITION_MONITOR] 🚨 Removed ${invalidPositionIds.length} IDs from close list`, 'warning');
        }

        if (validPositionIds.length === 0) {
            this.addLog('[BATCH_CLOSE] ❌ No valid position IDs to close!', 'error');
            return { success: false, error: 'No valid position IDs to close' };
        }

        //this.addLog(`[BATCH_CLOSE] 🔄 Proceeding with ${validPositionIds.length} valid position IDs`, 'debug');

        try {
            const result = await this._executeFastBatchClose(tradesToCreate, validPositionIds);
            //this.addLog('[BATCH_CLOSE] ✅ Fast batch close completed', 'debug');
            //this.addLog('═══════════════════════════════════════════════════════', 'debug');
            return result;
        } catch (error) {
            this.addLog(`[BATCH_CLOSE] ❌ Batch close failed: ${error}`, 'error');
            this.addLog(`[BATCH_CLOSE] Error stack: ${error.stack}`, 'error');
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * NEW: Helper method to update aggregated wallet statistics.
     * @param {object} walletState - The wallet object to update.
     * @param {Array<object>} newTrades - Array of trade data objects that were just closed.
     */
    updateWalletAggregatedStats(walletState, newTrades) {
        if (!newTrades || newTrades.length === 0) return;

        if (typeof walletState.total_trades_count !== 'number') walletState.total_trades_count = 0;
        if (typeof walletState.winning_trades_count !== 'number') walletState.winning_trades_count = 0;
        if (typeof walletState.losing_trades_count !== 'number') walletState.losing_trades_count = 0;
        if (typeof walletState.total_realized_pnl !== 'number') walletState.total_realized_pnl = 0;
        if (typeof walletState.total_gross_profit !== 'number') walletState.total_gross_profit = 0;
        if (typeof walletState.total_gross_loss !== 'number') walletState.total_gross_loss = 0;
        if (typeof walletState.total_fees_paid !== 'number') walletState.total_fees_paid = 0;

        newTrades.forEach(trade => {
            const pnl = trade.pnl_usdt || 0;
            const fees = trade.total_fees_usdt || 0;

            walletState.total_trades_count++;
            walletState.total_realized_pnl += pnl;
            walletState.total_fees_paid += fees;

            if (pnl > 0) {
                walletState.winning_trades_count++;
                walletState.total_gross_profit += pnl;
            } else if (pnl < 0) {
                walletState.losing_trades_count++;
                walletState.total_gross_loss += Math.abs(pnl);
            }
        });

        walletState.last_updated_timestamp = new Date().toISOString();
    }

    /**
     * Helper method to format exit reasons for display.
     * @param {string} exitReason - The raw exit reason from the trade.
     * @returns {string} Human-readable exit reason.
     */
    formatExitReason(exitReason) {
        const reasonMap = {
            'take_profit': 'Take Profit Hit',
            'stop_loss': 'Stop Loss Hit',
            'timeout': 'Time Exit',
            'trailing_stop_hit': 'Trailing Stop',
            'trailing_timeout': 'Trailing Timeout',
            'manual_close': 'Manual Close',
            'liquidation': 'Liquidated',
            'error': 'Error Close',
            'cancelled': 'Cancelled',
            'market_order_filled': 'Market Close',
            'insufficient_balance': 'Balance Mismatch (Virtual Close)',
            'invalid_symbol_cleanup': 'Invalid Symbol (Cleanup)'
        };
        return reasonMap[exitReason] || exitReason.replace(/_/g, ' ');
    }

    /**
     * Internal helper to create a trade object from a position.
     * Delegates to the existing generateTradeFromPosition method.
     * @param {object} position - The position to close.
     * @param {number} exitPrice - The exit price.
     * @param {string} exitReason - Reason for exit.
     * @param {object} additionalData - Additional data to include.
     * @returns {object} Trade data object.
     */
    _createTradeFromPosition(position, exitPrice, exitReason, additionalData = {}) {
        return this.generateTradeFromPosition(position, exitPrice, exitReason, additionalData);
    }

    /**
     * Handles manual closing of a single position.
     * @param {object} position - The position object to close (full object, not just ID).
     * @param {number|null} currentPrice - The current market price. If null, it will be fetched.
     * @param {string} exitReason - Reason for exit (defaults to 'manual_close').
     * @returns {Promise<{ success: boolean, trade?: object, pnl?: number, pnlPercentage?: number, error?: string, isInsufficientBalance?: boolean }>} An object indicating success or failure with an message.
     */
    async manualClosePosition(position, currentPrice = null, exitReason = 'manual_close') {
        const activePosition = this.positions.find(p => p.id === position.id);

        if (!activePosition) {
            const availableIds = this.positions.map(p => `${p.symbol} (${p.position_id} / DB_ID: ${p.id})`).join(', ');
            const errorMsg = `Position ${position.symbol} (ID: ${position.id}) not found in PositionManager. Available positions: ${availableIds || 'none'}`;
            
            this.scannerService.addLog(`[MANUAL_CLOSE] ❌ ${errorMsg}`, 'error');
            throw new Error(errorMsg);
        }

        this.scannerService.addLog(
            `[MANUAL_CLOSE] 🔄 Manual close requested: ${JSON.stringify({
                symbol: activePosition.symbol,
                positionId: activePosition.id, // Use LivePosition.id for logging
                quantity: activePosition.quantity_crypto,
                entryPrice: activePosition.entry_price,
                strategyName: activePosition.strategy_name,
                currentPrice: currentPrice,
                exitReason: exitReason
            })}`,
            'system'
        );

        // Get current price with multiple fallback options
        let exitPrice = currentPrice;
        if (!exitPrice || typeof exitPrice !== 'number' || exitPrice <= 0) {
            const symbolNoSlash = activePosition.symbol.replace('/', '');
            exitPrice = this.scannerService.currentPrices[symbolNoSlash];
            
            // If still no price, try to fetch from Binance directly
            if (!exitPrice || typeof exitPrice !== 'number' || exitPrice <= 0) {
                try {
                    const tickerSymbol = symbolNoSlash;
                    const tradingMode = this.scannerService.getTradingMode();
                    const proxyUrl = this.scannerService.state.settings?.local_proxy_url;

                    const binancePrices = await queueFunctionCall(
                        getBinancePrices, // Pass the function itself
                        { symbols: [tickerSymbol], tradingMode: tradingMode, proxyUrl: proxyUrl },
                        'critical', // Priority
                        `binancePrices.${tickerSymbol}`, // Cache for 30 seconds
                        30000,
                        30000  // Timeout
                    );
                    
                    if (binancePrices && binancePrices[tickerSymbol]) {
                        exitPrice = parseFloat(binancePrices[tickerSymbol]);
                    }
                } catch (fetchError) {
                    this.addLog(`[MANUAL_CLOSE] ❌ Failed to fetch price from Binance API: ${fetchError.message}`, 'error');
                }
            }
            
            if (!exitPrice || typeof exitPrice !== 'number' || exitPrice <= 0) {
                const errorMsg = `Cannot close position ${activePosition.symbol}: No valid current price available. Please try again in a moment.`;
                this.addLog(`[MANUAL_CLOSE] ❌ ${errorMsg}`, 'error');
                throw new Error(errorMsg);
            }
        }

        // Execute sell order on Binance for live/testnet modes
        let binanceCloseResult;
        try {
            this.addLog(`[MANUAL_CLOSE] 📡 Attempting to execute sell order on Binance for ${activePosition.symbol}...`, 'info');
            binanceCloseResult = await this.closePositionOnBinance(activePosition, exitPrice); // Pass exitPrice as exitPrice
        } catch (error) {
            // This catch block handles errors thrown by _executeBinanceMarketSellOrder
            this.scannerService.addLog(`[MANUAL_CLOSE] ❌ Binance sell order failed for ${activePosition.symbol}: ${error.message}`, 'error');
            this.addLog(`[PositionManager] ❌ Binance sell order error: ${error}`, 'error');
            return {
                success: false,
                error: error.message,
                isInsufficientBalance: error.isInsufficient || false
            };
        }
        
        this.addLog(`[PositionManager] 📦 Binance close result: ${JSON.stringify(binanceCloseResult)}`, 'debug'); // Added log

        if (!binanceCloseResult.success) {
            const errorMsg = binanceCloseResult.error || 'Failed to execute sell order on Binance';
            this.scannerService.addLog(`[MANUAL_CLOSE] ❌ Binance sell order failed for ${activePosition.symbol}: ${errorMsg}`, 'error');
            this.addLog(`[PositionManager] ❌ Binance sell order failed: ${errorMsg}`, 'error');
            return {
                success: false,
                error: errorMsg,
                isInsufficientBalance: binanceCloseResult.isInsufficient || false
            };
        }

        // Use the actual executed price from Binance if available, else the determined exitPrice
        const executedPrice = binanceCloseResult.orderResult?.fills && binanceCloseResult.orderResult.fills.length > 0 
            ? parseFloat(binanceCloseResult.orderResult.fills[0].price) 
            : exitPrice;
        
        // Use the actual executed quantity from Binance if available, else the position's quantity
        const actualQuantity = binanceCloseResult.orderResult?.executedQty
            ? parseFloat(binanceCloseResult.orderResult.executedQty)
            : activePosition.quantity_crypto;

        this.scannerService.addLog(
            `[MANUAL_CLOSE] ✅ Binance sell order executed: ${actualQuantity} ${activePosition.symbol.split('/')[0]} @ ${this._formatPriceSmart(executedPrice)}`,
            'success'
        );

        // Recreate trade data with actual executed price and the provided exitReason
        const finalTrade = this._createTradeFromPosition(activePosition, executedPrice, exitReason);
        this.addLog(`[PositionManager] 📊 Final Trade data prepared: ${JSON.stringify(finalTrade)}`, 'debug');

        // CRITICAL: Execute fast batch close WITHOUT waiting for performance snapshot
        // This will update DB, in-memory state, wallet summary, and notify subscribers
        const fastBatchCloseResult = await this._executeFastBatchClose([finalTrade], [activePosition.id]); 
        this.addLog(`[PositionManager] ✅ _executeFastBatchClose result: ${JSON.stringify(fastBatchCloseResult)}`, 'debug');

        if (!fastBatchCloseResult.success) {
            const errorMsg = fastBatchCloseResult.errors?.[0]?.error || fastBatchCloseResult.error || 'Failed to update wallet state after closing position.';
            this.scannerService.addLog(`[MANUAL_CLOSE] ❌ Failed to update wallet state after closing position ${activePosition.id}: ${errorMsg}`, 'error');
            this.addLog(`[PositionManager] ❌ Failed to update wallet state after closing position ${activePosition.id}: ${errorMsg}`, 'error');
            throw new Error(errorMsg);
        }

        // CRITICAL: Immediately refresh wallet state from Binance after manual close
        this.addLog('[MANUAL_CLOSE] 🔄 Syncing wallet with Binance...', 'info');
        
        try {
            const currentWalletState = this.scannerService.state.liveWalletState;
            if (currentWalletState && currentWalletState.id && currentWalletState.mode) {
                await this.scannerService.walletManagerService.initializeLiveWallet();
                
                // CRITICAL: Recalculate and persist wallet summary with fresh data
                this.addLog('[MANUAL_CLOSE] 📊 Calculating updated wallet summary...', 'info');
                
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this.scannerService.state.liveWalletState,
                    this.scannerService.currentPrices
                );
                
                // CRITICAL: Persist to localStorage for immediate UI pickup
                if (typeof this.scannerService._persistLatestWalletSummary === 'function') {
                    await this.scannerService._persistLatestWalletSummary();
                } else {
                    this.addLog('[PositionManager] ⚠️ _persistLatestWalletSummary not found on scannerService. Manual refresh might not be fully reflected in local storage.', 'warning');
                }

                this.scannerService.notifyWalletSubscribers();
            } else {
                this.addLog('[PositionManager] ⚠️ Cannot refresh wallet state: No active wallet state in scannerService.state.liveWalletState.', 'warning');
            }
        } catch (refreshError) {
            this.addLog(`[MANUAL_CLOSE] ⚠️ Failed to refresh wallet: ${refreshError.message}`, 'warning');
            this.addLog(`[PositionManager] ⚠️ Wallet refresh failed: ${JSON.stringify(refreshError)}`, 'warning');
        }

        // FIRE AND FORGET: Trigger performance snapshot update in the background
        this._triggerBackgroundPerformanceUpdate([finalTrade]);

        this.scannerService.addLog(
            `[MANUAL_CLOSE] ✅ Position ${activePosition.symbol} closed manually. P&L: ${this._formatUsdSmart(finalTrade.pnl_usdt)} (${finalTrade.pnl_percentage.toFixed(2)}%)`,
            finalTrade.pnl_usdt >= 0 ? 'success' : 'error'
        );
        this.addLog(`[PositionManager] ✅ Position ${activePosition.symbol} closed manually. P&L: ${this._formatUsdSmart(finalTrade.pnl_usdt)} (${finalTrade.pnl_percentage.toFixed(2)}%)`, 'debug');

        return { 
            success: true, 
            trade: finalTrade,
            pnl: finalTrade.pnl_usdt,
            pnlPercentage: finalTrade.pnl_percentage
        };
    }


    /**
     * NEW: Manual position closing method for Wallet page
     * @param {Object} position - The position to close
     * @param {string} exitReason - Reason for closing (e.g., 'manual_close')
     * @returns {Object} Result object with success status and details
     */
    async closePosition(position, exitReason = 'manual_close') {
        try {
            this.scannerService.addLog(`[POSITION_CLOSE] Close requested for position ${position.position_id} (${position.symbol}) (DB ID: ${position.id}) with reason: ${exitReason}`, 'info');

            // Get current price for the symbol
            const symbolNoSlash = position.symbol.replace('/', '');
            let currentPrice = null;

            // Try to get current price from scanner service first
            if (this.scannerService.currentPrices && this.scannerService.currentPrices[symbolNoSlash]) {
                currentPrice = this.scannerService.currentPrices[symbolNoSlash];
                this.scannerService.addLog(`[POSITION_CLOSE] Using cached price for ${position.symbol}: ${this._formatPriceSmart(currentPrice)}`, 'info');
            } else {
                // Simplified: just use entry price as fallback instead of complex fetching
                currentPrice = position.entry_price;
                this.scannerService.addLog(`[POSITION_CLOSE] No cached price available for ${position.symbol}, using entry price: ${this._formatPriceSmart(currentPrice)}`, 'warning');
            }

            // Ensure currentPrice is valid before proceeding
            if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                throw new Error('Could not determine a valid exit price for the position.');
            }

            // Execute the actual close through liveTradingAPI (LIVE/TESTNET mode only)
            let orderResult = null; // Declare orderResult to be available in all branches
            let binanceCloseResult;
            try {
                const tradingMode = this.getTradingMode();
                const proxyUrl = this.scannerService.state.settings?.local_proxy_url;
                binanceCloseResult = await this._executeBinanceMarketSellOrder(position, { currentPrice, tradingMode, proxyUrl, exitReason }); // Pass currentPrice as currentPrice
            } catch (error) {
                 // Catch block for errors thrown by closePositionOnBinance (e.g., from _executeBinanceMarketSellOrder)
                this.scannerService.addLog(`[POSITION_CLOSE] ❌ Binance sell order failed for ${position.symbol}: ${error.message}`, 'error');
                return {
                    success: false,
                    error: error.message,
                    isInsufficientBalance: error.isInsufficient || false
                };
            }

            if (binanceCloseResult.success) {
                orderResult = binanceCloseResult.orderResult;
            } else {
                // Handle cases where Binance sell fails. If it's a warning (e.g., insufficient balance from prior manual close),
                // we can still proceed with a virtual close/trade record update. Otherwise, it's a hard failure.
                if (binanceCloseResult.isWarning || binanceCloseResult.isInsufficientBalance || binanceCloseResult.skipped) {
                    this.scannerService.addLog(`[POSITION_CLOSE] Binance sell order returned a warning for ${position.symbol}. Proceeding with virtual close. Error: ${binanceCloseResult.error || binanceCloseResult.reason}`, 'warning');
                    orderResult = { orderId: `virtual_close_${Date.now()}`, fills: [{ price: currentPrice }] };
                } else {
                    throw new Error(binanceCloseResult.error || "Failed to execute close order on Binance.");
                }
            }
            
            // Use the actual executed price from Binance if available, else currentPrice (which is cached or entry)
            const executedPrice = orderResult?.fills && orderResult.fills.length > 0 
                ? parseFloat(orderResult.fills[0].price) 
                : currentPrice;

            this.scannerService.addLog(`[POSITION_CLOSE] Using executed price: ${this._formatPriceSmart(executedPrice)}`, 'info');

            // NEW: Add the initial debug log here, after executedPrice is available
            this.addLog('[POSITION_MANAGER] 🔄 Starting position close process:', {
                positionId: position.position_id,
                symbol: position.symbol,
                strategy: position.strategy_name,
                exitReason,
                exitPrice: executedPrice, // Use internally determined price
                currentMarketRegime: position.market_regime || 'NOT_SET',
                regimeConfidence: position.regime_confidence || 'NOT_SET'
            }, 'debug');

            // Calculate P&L
            const pnlUsdt = (executedPrice - position.entry_price) * position.quantity_crypto;
            const pnlPercentage = (position.entry_price > 0) ? ((executedPrice - position.entry_price) / position.entry_price) * 100 : 0;

            // Create trade record
            const tradeData = {
                trade_id: position.binance_order_id || generateTradeId(), // CHANGED: Use binance_order_id or generateTradeId()
                strategy_name: position.strategy_name,
                symbol: position.symbol,
                direction: position.direction,
                entry_price: executedPrice, // Use the executed price for consistency
                exit_price: executedPrice,
                quantity_crypto: position.quantity_crypto,
                entry_value_usdt: position.entry_value_usdt,
                exit_value_usdt: executedPrice * position.quantity_crypto,
                pnl_usdt: pnlUsdt,
                pnl_percentage: pnlPercentage,
                entry_timestamp: new Date().toISOString(),
                exit_timestamp: new Date().toISOString(),
                duration_seconds: Math.floor((Date.now() - new Date(position.entry_timestamp).getTime()) / 1000),
                exit_reason: exitReason,
                leverage: position.leverage || 1, // KEPT: Original leverage
                take_profit_price: position.take_profit_price,
                stop_loss_price: position.stop_loss_price,
                wallet_allocation_percentage: position.wallet_allocation_percentage,
                peak_price_during_trade: position.peak_price || executedPrice,
                trough_price_during_trade: position.trough_price || executedPrice,
                trigger_signals: position.trigger_signals || [],
                enabled_trailing_take_profit: position.enabled_trailing_take_profit !== false,
                was_trailing: position.status === 'trailing',
                final_trailing_stop_price: position.trailing_stop_price || null,
                combined_strength: position.combined_strength,
                conviction_score: position.conviction_score,
                conviction_breakdown: position.conviction_breakdown, // KEPT: Original conviction_breakdown
                conviction_multiplier: position.conviction_multiplier, // KEPT: Original conviction_multiplier
                market_regime: position.market_regime, // CRITICAL: Transfer regime from position
                regime_confidence: position.regime_confidence, // FIXED: Ensure confidence is transferred
                is_event_driven_strategy: position.is_event_driven_strategy || false,
                total_fees_usdt: 0, 
                commission_migrated: true,
                trading_mode: this.getTradingMode()
            };

            this.addLog('[POSITION_MANAGER] 📊 Trade data prepared for creation:', {
                tradeId: tradeData.trade_id,
                strategy: tradeData.strategy_name,
                symbol: tradeData.symbol,
                pnl: tradeData.pnl_usdt,
                exitReason: tradeData.exit_reason,
                marketRegime: tradeData.market_regime || 'NOT_SET',
                regimeConfidence: tradeData.regime_confidence || 'NOT_SET',
                regimeConfidenceType: typeof tradeData.regime_confidence,
                regimeConfidenceValue: tradeData.regime_confidence,
                combinedStrength: tradeData.combined_strength || 'MISSING_STRENGTH',
                convictionScore: tradeData.conviction_score || 'MISSING_CONVICTION',
                tradingMode: tradeData.trading_mode
            }, 'debug');

            if (!tradeData.market_regime) {
                this.addLog('[POSITION_MANAGER] ⚠️ CRITICAL: Trade being created WITHOUT market regime data!', {
                    positionData: {
                        market_regime: position.market_regime,
                        regime_confidence: position.regime_confidence,
                        strategy_name: position.strategy_name,
                        symbol: position.symbol,
                        entry_timestamp: position.entry_timestamp
                    }
                }, 'warning');
            }

            if (tradeData.regime_confidence === null || tradeData.regime_confidence === undefined) {
                this.addLog('[POSITION_MANAGER] ⚠️ WARNING: Trade being created WITHOUT regime confidence data!', {
                    positionRegimeConfidence: position.regime_confidence,
                    positionRegimeConfidenceType: typeof position.regime_confidence,
                    tradeRegimeConfidence: tradeData.regime_confidence
                }, 'warning');
            }
            
            this.addLog('[POSITION_MANAGER] 💾 Calling executeBatchClose for single trade...', 'debug');

            // Pass the LivePosition database ID to executeBatchClose
            const batchCloseResult = await this._executeFastBatchClose([tradeData], [position.id]);

            if (batchCloseResult.success) {
                this.scannerService.addLog(`[POSITION_CLOSE] ✅ Position ${position.position_id} closed successfully. P&L: ${this._formatUsdSmart(pnlUsdt)} (${pnlPercentage.toFixed(2)}%)`, 'success');

                this.addLog('[POSITION_MANAGER] ✅ Trade record created successfully (via executeBatchClose).', {
                    tradeId: tradeData.trade_id, // Use tradeData.trade_id as it's the identifier for this specific trade
                    databaseMarketRegime: tradeData.market_regime || 'STORED_WITHOUT_REGIME',
                    databaseRegimeConfidence: tradeData.regime_confidence !== null && tradeData.regime_confidence !== undefined 
                        ? tradeData.regime_confidence 
                        : 'STORED_WITHOUT_CONFIDENCE',
                    databaseRegimeConfidenceType: typeof tradeData.regime_confidence,
                    databaseRegimeConfidenceValue: tradeData.regime_confidence
                }, 'debug');

                return {
                    success: true,
                    trade: tradeData, // Return the prepared tradeData, as a direct 'createdTrade' from a single call isn't available
                    pnl: pnlUsdt,
                    pnlPercentage: pnlPercentage
                };
            } else {
                const errorMsg = batchCloseResult.errors?.[0]?.error || batchCloseResult.error || 'Failed to update wallet state after closing position.';
                this.scannerService.addLog(`[POSITION_CLOSE] ❌ Failed to update wallet state after closing position ${position.id}: ${errorMsg}`, 'error');
                throw new Error(errorMsg);
            }

        } catch (error) {
            this.scannerService.addLog(`[POSITION_CLOSE] ❌ Failed to close position ${position?.id}: ${error.message}`, 'error', error);
            return {
                success: false,
                error: error.message,
                isInsufficientBalance: error.isInsufficient || false
            };
        }
    }

    /**
     * Internal helper to calculate derived trade parameters (e.g., SL/TP prices).
     * Modifies the tradeData object in place.
     * This method assumes `entry_price`, `entry_value_usdt`, and `quantity_crypto` are already validated.
     * @param {object} positionData - The position data object to augment.
     * @returns {void}
     */
    _calculateTradeExecutionParameters(positionData) {
      try {
      } catch (e) {
      }

      let timeframe = positionData?.timeframe || "unknown";
      try {
        if (!timeframe || timeframe === "unknown") {
          const strategies = this.scannerService?.state?.activeStrategies || [];
          const matchedByName = strategies.find((s) => s?.combinationName === positionData?.strategy_name);
          if (matchedByName?.timeframe) timeframe = matchedByName.timeframe;
        }
      } catch (_e) { /* ignore */ }

      if (!timeframe || timeframe === "unknown") {
        try {
          const ks = positionData?.klines;
          if (Array.isArray(ks) && ks.length >= 2) {
            const getTs = (k) =>
              (typeof k.timestamp === "number" && isFinite(k.timestamp) && k.timestamp) ||
              (typeof k.time === "number" && isFinite(k.time) && k.time) ||
              (typeof k.openTime === "number" && isFinite(k.openTime) && k.openTime) ||
              (typeof k.t === "number" && isFinite(k.t) && k.t) ||
              null;

            const last = ks[ks.length - 1];
            const prev = ks[ks.length - 2];
            const t1 = getTs(last);
            const t0 = getTs(prev);

            if (t1 && t0 && t1 > t0) {
              const delta = t1 - t0; // ms
              const candidates = [
                { tf: "1m", ms: 60_000 },
                { tf: "5m", ms: 300_000 },
                { tf: "15m", ms: 900_000 },
                { tf: "30m", ms: 1_800_000 },
                { tf: "1h", ms: 3_600_000 },
                { tf: "4h", ms: 14_400_000 },
                { tf: "1d", ms: 86_400_000 },
                { tf: "1w", ms: 604_800_000 },
              ];
              const tol = 0.25;
              let derivedTf = null;
              let bestDiff = Infinity;
              for (const c of candidates) {
                const diff = Math.abs(delta - c.ms);
                if (diff <= c.ms * tol && diff < bestDiff) {
                  derivedTf = c.tf;
                  bestDiff = diff;
                }
              }
              if (derivedTf) {
                timeframe = derivedTf;
              }
            }
          }
        } catch (_e) { /* ignore */ }
      }

      let atrValue = positionData?.atr_value ?? positionData?.atrValue ?? null;
      if (!(typeof atrValue === "number" && isFinite(atrValue) && atrValue > 0)) {
        try {
          const ind = positionData?.indicators;
          let derived = null; // Use a temporary variable to store derived ATR
          if (ind) {
            const arr = ind.atr || ind.ATR || ind["atr"];
            if (Array.isArray(arr) && arr.length > 0) {
              const last = arr[arr.length - 1];
              if (typeof last === "number" && isFinite(last)) derived = last;
              else if (last && typeof last.value === "number" && isFinite(last.value)) derived = last.value;
              else if (last && typeof last.atr === "number" && isFinite(last.atr)) derived = last.atr;
            }
          }
          if (typeof derived === "number" && isFinite(derived) && derived > 0) {
            atrValue = derived;
          }
        } catch (_e) { /* ignore */ }
      }

      let strategy = null;
      try {
        const strategies = this.scannerService?.state?.activeStrategies || [];
        strategy = strategies.find((s) => s?.combinationName === positionData?.strategy_name) || null;
        if (!strategy) {
          const sym = (positionData?.symbol || "").replace(/[\s]/g, "");
          strategy = strategies.find((s) => {
            const sCoin = (s?.coin || s?.symbol || "").replace(/[\s]/g, "");
            const tfOk = timeframe && s?.timeframe ? s.timeframe === timeframe : true;
            const nameHint = (s?.combinationName || "").includes(sym);
            return (sCoin === sym || nameHint) && tfOk;
          }) || null;
        }

        if (!strategy) {
          this.scannerService?.addLog?.(
            `[STRATEGY_LOOKUP] Strategy ${positionData?.strategy_name} not found in activeStrategies.`,
            "warning",
          );
        } else {
        }
      } catch (_e) { /* ignore */ }

      const slMultiplier =
        positionData?.stopLossAtrMultiplier ??
        positionData?.combination?.stopLossAtrMultiplier ??
        strategy?.stopLossAtrMultiplier ??
        2.5;

      const tpMultiplier =
        positionData?.takeProfitAtrMultiplier ??
        positionData?.combination?.takeProfitAfitAtrMultiplier ?? // Fixed typo here
        strategy?.takeProfitAtrMultiplier ??
        3.0;

      if ((positionData?.stopLossAtrMultiplier == null && positionData?.combination?.stopLossAtrMultiplier == null && !strategy?.stopLossAtrMultiplier) ||
          (positionData?.takeProfitAtrMultiplier == null && positionData?.combination?.takeProfitAtrMultiplier == null && !strategy?.takeProfitAtrMultiplier)) {
        this.scannerService?.addLog?.(
          `[SL_TP_DEFAULTS] Using default multipliers for ${positionData?.symbol || "unknown"} on ${timeframe}: SL=${slMultiplier}, TP=${tpMultiplier}`,
          "info",
        );
      }

        positionData.atr_value = atrValue;

        // Calculate time_exit_hours
        if (positionData.time_exit_hours === undefined && typeof strategy?.estimatedExitTimeMinutes === 'number' && strategy.estimatedExitTimeMinutes > 0) {
            const estimatedHours = strategy.estimatedExitTimeMinutes / 60; // CRITICAL FIX: Divide by 60!
            const minimumTimeExitHours = 1.5;
            positionData.time_exit_hours = Math.max(estimatedHours, minimumTimeExitHours);
            
            if (estimatedHours < minimumTimeExitHours) {
                this.scannerService.addLog(`[EXIT_TIME] Strategy suggested ${estimatedHours.toFixed(2)}h exit, increased to minimum ${minimumTimeExitHours}h`, 'info');
            }
        } else if (positionData.time_exit_hours === undefined || positionData.time_exit_hours === null || typeof positionData.time_exit_hours !== 'number' || positionData.time_exit_hours <= 0) {
             positionData.time_exit_hours = 1.5; // Default fallback
        } else {
        }

        // Calculate stop_loss_price and take_profit_price
        if (typeof positionData.atr_value === 'number' && positionData.atr_value > 0) {
            const rawStopLossDistance = positionData.atr_value * slMultiplier;
            const minStopLossPercent = 0.015;
            const maxStopLossPercent = 0.08;

            const adjustedStopLossDistance = Math.min(
                Math.abs(rawStopLossDistance), Math.abs(maxStopLossPercent * positionData.entry_price)
            );
            
            const minAbsStopLossDistance = minStopLossPercent * positionData.entry_price;
            const finalAdjustedSLDistance = Math.max(adjustedStopLossDistance, minAbsStopLossDistance);

            const effectiveSLDistance = positionData.direction === 'long'
                ? finalAdjustedSLDistance
                : -finalAdjustedSLDistance;

            const initialStopLoss = positionData.direction === 'long'
                ? positionData.entry_price - effectiveSLDistance
                : positionData.entry_price + effectiveSLDistance;

            if (finalAdjustedSLDistance !== rawStopLossDistance) {
                const rawStopLossPercent = (rawStopLossDistance / positionData.entry_price) * 100;
                const adjustedStopLossPercent = (finalAdjustedSLDistance / positionData.entry_price) * 100;
                if (finalAdjustedSLDistance === minAbsStopLossDistance) {
                    this.scannerService.addLog(`[SL_ADJUSTMENT] Stop-loss widened from ${rawStopLossPercent.toFixed(1)}% to minimum ${adjustedStopLossPercent.toFixed(1)}% due to low volatility`, 'info');
                } else if (finalAdjustedSLDistance === (maxStopLossPercent * positionData.entry_price)) {
                    this.scannerService.addLog(`[SL_ADJUSTMENT] Stop-loss tightened from ${rawStopLossPercent.toFixed(1)}% to maximum ${adjustedStopLossPercent.toFixed(1)}% due to high volatility`, 'info');
                }
            }

            if (positionData.direction === 'long' && strategy?.medianLowestLowDuringBacktest) {
                const medianDrawdownPercent = strategy.medianLowestLowDuringBacktest;
                const medianSupportFloor = positionData.entry_price * (1 - (medianDrawdownPercent / 100));

                const currentMaxStopLossPrice = positionData.entry_price * (1 - maxStopLossPercent);

                if (initialStopLoss < medianSupportFloor && medianSupportFloor >= currentMaxStopLossPrice) {
                    positionData.stop_loss_price = initialStopLoss; 
                } else if (medianSupportFloor >= currentMaxStopLossPrice && medianSupportFloor < positionData.entry_price) {
                    positionData.stop_loss_price = Math.max(initialStopLoss, medianSupportFloor);
                } else {
                    positionData.stop_loss_price = initialStopLoss;
                }
                
                if (positionData.direction === 'long') {
                    positionData.stop_loss_price = Math.max(positionData.stop_loss_price, positionData.entry_price * (1 - maxStopLossPercent));
                } else {
                    positionData.stop_loss_price = Math.min(positionData.stop_loss_price, positionData.entry_price * (1 + maxStopLossPercent));
                }
                
            } else {
                positionData.stop_loss_price = initialStopLoss;
            }

            const rewardDistance = Math.abs(effectiveSLDistance) * (tpMultiplier / slMultiplier);

            positionData.take_profit_price = positionData.direction === 'long'
                ? positionData.entry_price + rewardDistance
                : positionData.entry_price - rewardDistance;

        } else {
            positionData.stop_loss_price = null;
            positionData.take_profit_price = null;
            this.scannerService.addLog(`[SL/TP] ATR calculation failed for ${positionData.symbol} despite indicators/klines. SL/TP not set.`, 'warning');
        }

        positionData.is_event_driven_strategy = this.classifyStrategy(strategy);
    }

    /**
     * Helper to format price for exchange precision.
     * @param {number} price - The price value.
     * @param {string} symbol - The trading pair symbol (e.e., "BTCUSDT").
     * @returns {number} The price rounded to the appropriate decimal places.
     */
    _formatPriceForExchange(price, symbol) {
        if (price === null || typeof price !== 'number') {
            return price;
        }
        
        if (symbol.includes('BTC') || symbol.includes('bitcoin') || symbol.includes('BITCOIN')) {
            return parseFloat(price.toFixed(2));
        }
        
        return parseFloat(price.toFixed(5));
    }

    /**
     * Validates and prepares trade data, calculating derived parameters and ensuring numeric sanity.
     * @param {object} positionData - Raw position data from the signal.
     * @returns {{preparedData: object, validation: {isValid: boolean, reason: string}}}
     */
    async validateAndPrepareTrade(positionData) {
        let preparedData = { ...positionData };
        const validation = { isValid: true, reason: '' };

        if (!preparedData.symbol) {
            validation.isValid = false;
            validation.reason = 'Missing symbol in position data.';
            this.addLog(`[TRADE_VALIDATE] CRITICAL - positionData.symbol is UNDEFINED at function entry!`, 'error');
            return { preparedData, validation };
        }

        const cleanSymbol = preparedData.symbol.replace('/', '');
        if (!cleanSymbol) {
             validation.isValid = false;
             validation.reason = 'Symbol could not be cleaned or is invalid.';
             this.addLog(`[TRADE_VALIDATE] CRITICAL - cleanSymbol is UNDEFINED after conversion!`, 'error');
             return { preparedData, validation };
        }

        // --- Numeric Input Validation and Parsing ---
        preparedData.entry_price = parseFloat(preparedData.entry_price);
        preparedData.entry_value_usdt = parseFloat(preparedData.entry_value_usdt);
        preparedData.quantity_crypto = parseFloat(preparedData.quantity_crypto);

        // Comprehensive validation of all numeric values
        if (isNaN(preparedData.entry_price) || preparedData.entry_price <= 0) {
            validation.isValid = false;
            validation.reason = `Invalid entry price: ${positionData.entry_price} (parsed: ${preparedData.entry_price})`;
            return { preparedData, validation };
        }

        if (isNaN(preparedData.entry_value_usdt) || preparedData.entry_value_usdt <= 0) {
            validation.isValid = false;
            validation.reason = `Invalid entry value USDT: ${positionData.entry_value_usdt} (parsed: ${preparedData.entry_value_usdt})`;
            return { preparedData, validation };
        }

        // Recalculate crypto quantity with validation
        if (isNaN(preparedData.quantity_crypto) || preparedData.quantity_crypto <= 0) {
            preparedData.quantity_crypto = preparedData.entry_value_usdt / preparedData.entry_price;
            
            if (isNaN(preparedData.quantity_crypto) || preparedData.quantity_crypto <= 0) {
                validation.isValid = false;
                validation.reason = `Invalid crypto quantity calculated (${preparedData.quantity_crypto}) from entry_value_usdt (${preparedData.entry_value_usdt}) / entry_price (${preparedData.entry_price})`;
                return { preparedData, validation };
            }
        }

        // Call internal helper to calculate derived parameters (SL/TP, time exit)
        this._calculateTradeExecutionParameters(preparedData);
        
        return { preparedData, validation };
    }


    /**
     * Executes a trade based on the current trading mode.
     * Dispatches to live trading or simulated (testnet) trading.
     * @param {object} preparedData - Parameters for the trade.
     * @returns {object} - Result of the trade execution.
     */
    async executeTrade(preparedData) {
        try {
            //this.addLog(`[EXECUTE_TRADE] 🎯 Executing ${this.scannerService.getTradingMode().toUpperCase()} trade for ${preparedData.symbol}...`, 'info');
            
            // CRITICAL FIX: Both live and testnet modes should execute real trades via Binance API
            // Only pure "demo" or "paper trading" modes (if we add them) should use _executeDemoTrade
            const tradingMode = this.scannerService.getTradingMode();
            
            let result;
            if (tradingMode === 'live' || tradingMode === 'testnet') {
                // Execute actual trade via Binance API (live or testnet endpoint)
                //this.addLog(`[EXECUTE_TRADE] 📡 Calling Binance ${tradingMode.toUpperCase()} API to create order...`, 'info');
                result = await this._executeRealTrade(preparedData);
            } else {
                // Pure simulation mode (not currently used, but kept for future)
                this.addLog(`[EXECUTE_TRADE] 🎮 Creating simulated trade (no Binance API call)...`, 'info');
                result = await this._executeDemoTrade(preparedData);
            }

            // --- PATCH 3 (part 1 of 2): Handle null result from _executeRealTrade ---
            if (result === null) {
                return null; // Propagate null result upwards
            }
            // --- END PATCH 3 (part 1 of 2) ---

            if (result.success) {
                this.addLog(`[EXECUTE_TRADE] ✅ ${tradingMode.toUpperCase()} trade executed successfully for ${preparedData.symbol}`, 'success');
            } else {
                this.addLog(`[EXECUTE_TRADE] ❌ Trade execution failed for ${preparedData.symbol}: ${result.error}`, 'error');
            }

            return result;

        } catch (error) {
            this.addLog(`[EXECUTE_TRADE] ❌ Critical error executing trade: ${error.message}`, 'error', error);
            return {
                success: false,
                error: error.message,
                position: null
            };
        }
    }

    async _executeRealTrade(preparedData) {
        const logPrefix = '[EXEC_REAL]';
        try {
            // Defensive validation
            if (!preparedData || typeof preparedData !== 'object') {
                throw new Error('Invalid preparedData object');
            }
            if (!preparedData.symbol || typeof preparedData.symbol !== 'string') {
                throw new Error(`Invalid symbol: ${preparedData.symbol}`);
            }
            if (!Number.isFinite(preparedData.entry_value_usdt) || preparedData.entry_value_usdt <= 0) {
                throw new Error(`Invalid position size (entry_value_usdt): ${preparedData.entry_value_usdt}`);
            }

            const tradingMode = this.scannerService.getTradingMode();
            const settings = this.scannerService?.state?.settings;
            const proxyUrl = settings?.local_proxy_url;

            if (!proxyUrl) {
                throw new Error('local_proxy_url not set in ScanSettings');
            }

            const symbolKey = preparedData.symbol.replace('/', '');
            const currentPrice = preparedData.entry_price;

            if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
                throw new Error(`No valid price for ${symbolKey}: ${currentPrice}`);
            }

            // Get exchange info for symbol validation
            const symbolInfo = this.getExchangeInfo(symbolKey);

            if (!symbolInfo || !symbolInfo.filters) {
                throw new Error(`Failed to get exchange info filters for ${symbolKey} from cached data.`);
            }

            // Calculate quantity based on preparedData's calculated quantity_crypto
            let quantity = preparedData.quantity_crypto;

            // Use the centralized formatting function to get exchange-compliant quantity
            let formattedQuantity;
            try {
                formattedQuantity = await this.formatQuantityForSymbol(
                    symbolKey,
                    quantity,
                    currentPrice
                );
                quantity = parseFloat(formattedQuantity);
            } catch (formatError) {
                this.addLog(`${logPrefix} ❌ Quantity formatting failed for ${symbolKey}: ${formatError.message}`, 'error');
                throw formatError;
            }

            // Final quantity validation before order submission
            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error(`Final calculated quantity ${quantity} is invalid for ${symbolKey}`);
            }
            
            // Check against minNotional
            const minNotionalFilter = symbolInfo.filters['NOTIONAL'] || symbolInfo.filters['MIN_NOTIONAL'];
            if (minNotionalFilter) {
                const minNotional = parseFloat(minNotionalFilter.minNotional || minNotionalFilter.notional);
                const notionalValue = quantity * currentPrice;
                if (notionalValue < minNotional) {
                    throw new Error(`Final notional value ${notionalValue.toFixed(2)} is below minimum ${minNotional} for ${symbolKey}`);
                }
            }
            
            const orderResponse = await queueFunctionCall(
                liveTradingAPI,
                {
                    action: 'createOrder',
                    symbol: symbolKey,
                    side: preparedData.direction.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
                    quantity: quantity.toString(),
                    orderType: 'MARKET', 
                    tradingMode: tradingMode,
                    proxyUrl: proxyUrl
                },
                'critical',
                null,
                45000,
                45000
            );

            // Use the local getBinanceResponse helper to extract actual data
            const getBinanceResponseLocal = (apiResponse) => {
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
            };

            const binanceOrder = getBinanceResponseLocal(orderResponse);

            // Validate Binance response
            if (!binanceOrder || !binanceOrder.orderId) {
                const errorMsg = binanceOrder?.msg || binanceOrder?.message || orderResponse?.data?.error || 'Unknown Binance error, no orderId.';
                this.addLog(`${logPrefix} ❌ Binance order failed: ${errorMsg}`, 'error');
                throw new Error(`Binance order failed: ${errorMsg}`);
            }

            // Check if order was actually filled
            const orderStatus = binanceOrder.status;
            // --- PATCH 2: Handle non-FILLED orders gracefully ---
            if (orderStatus !== 'FILLED') {
                const isTestnet = (tradingMode === 'testnet') || (this.scannerService.state.liveWalletState?.mode === 'testnet'); 
                
                if (isTestnet && (orderStatus === 'EXPIRED' || orderStatus === 'CANCELED')) {
                    this.addLog(
                        `[BINANCE_ORDER] ⚠️ Testnet liquidity: ${preparedData.strategy_name} ${symbolKey} order ${orderStatus}. No position opened.`,
                        'warning',
                        { status: orderStatus, symbol: symbolKey, strategy: preparedData.strategy_name }
                    );
                    // Gracefully skip creating a position
                    return null; // Return null as requested by patch, handled by executeTrade and openPositionsBatch
                }
                // For any other non-FILLED status (including non-EXPIRED/CANCELED on testnet, or any on live), it's an error
                throw new Error(`Binance order was not FILLED. Status: ${orderStatus || 'UNKNOWN'}.`);
            }
            // --- END PATCH 2 ---

            // If order was FILLED but has zero execution values, it's an error
            const executedQty = parseFloat(binanceOrder.executedQty || 0);
            const avgPrice = parseFloat(binanceOrder.avgPrice || (binanceOrder.fills?.[0]?.price) || binanceOrder.price || currentPrice);
            const quoteSpent = parseFloat(binanceOrder.cummulativeQuoteQty || (executedQty * avgPrice));
            
            if (executedQty <= 0 || avgPrice <= 0) {
                 throw new Error(`FILLED order returned zero execution values (qty=${executedQty}, price=${avgPrice}).`);
            }


            // Validate confirmed execution values
            if (!Number.isFinite(executedQty) || executedQty <= 0) {
                throw new Error(`Invalid confirmed quantity from Binance: ${executedQty.toFixed(8)}`);
            }
            if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
                throw new Error(`Invalid confirmed average price from Binance: ${avgPrice}`);
            }
            if (!Number.isFinite(quoteSpent) || quoteSpent <= 0) {
                throw new Error(`Invalid confirmed quote spent from Binance: ${quoteSpent}`);
            }

            // CRITICAL: Create LivePosition entity ONLY with confirmed Binance values
            const walletId = this.scannerService.state.liveWalletState.id; // Get walletId from scope

            const livePositionData = {
                wallet_id: walletId, // Use walletId from scope
                position_id: preparedData.position_id || generateTradeId(), // Original behavior
                strategy_name: preparedData.strategy_name,
                symbol: preparedData.symbol,
                direction: preparedData.direction,
                entry_price: avgPrice,  // Use confirmed avg price from Binance
                quantity_crypto: executedQty,  // Use confirmed executed quantity
                entry_value_usdt: quoteSpent,  // Use confirmed quote spent
                binance_order_id: String(binanceOrder.orderId),
                entry_timestamp: new Date(binanceOrder.transactTime || Date.now()).toISOString(), // Original behavior
                status: 'open',
                take_profit_price: preparedData.take_profit_price || null,
                stop_loss_price: preparedData.stop_loss_price || null,
                time_exit_hours: preparedData.time_exit_hours || null,
                trigger_signals: preparedData.trigger_signals || [],
                combined_strength: preparedData.combined_strength || null,
                conviction_score: preparedData.conviction_score || null,
                conviction_breakdown: preparedData.conviction_breakdown || null,
                market_regime: preparedData.market_regime || null,
                regime_confidence: preparedData.regime_confidence,
                atr_value: preparedData.atr_value || null,
                is_event_driven_strategy: preparedData.is_event_driven_strategy || false,
                is_trailing: preparedData.enableTrailingTakeProfit || false, // Original behavior
                trailing_stop_price: null, // Original behavior
                trailing_peak_price: null, // Original behavior
                peak_price: avgPrice, // Original behavior
                trough_price: avgPrice, // Original behavior
                trading_mode: tradingMode
            };

            const createdPosition = await queueEntityCall('LivePosition', 'create', livePositionData);

            if (!createdPosition || !createdPosition.id) {
                throw new Error('Failed to create LivePosition entity in database');
            }

            // Update LiveWalletState's live_position_ids array (original behavior)
            try {
                const currentWalletState = this.scannerService.state.liveWalletState;
                const currentLivePositionIds = currentWalletState.live_position_ids || [];
                if (!currentLivePositionIds.includes(createdPosition.id)) { 
                    currentLivePositionIds.push(createdPosition.id);
                    await queueEntityCall('LiveWalletState', 'update', currentWalletState.id, {
                        live_position_ids: currentLivePositionIds,
                        last_updated_timestamp: new Date().toISOString()
                    });
                    currentWalletState.live_position_ids = currentLivePositionIds;
                }
            } catch (updateError) {
                this.addLog(`${logPrefix} ❌ Failed to update LiveWalletState with new position ID: ${updateError.message}`, 'error');
            }

            // Add to PositionManager's internal cache (original behavior)
            this.positions.push(createdPosition);

            // Notify WalletProvider to refresh (original behavior)
            this.scannerService.notifyWalletSubscribers();

            return {
                success: true,
                position: createdPosition, // Changed from livePosition to position for consistency with older calls
                binanceOrderId: binanceOrder.orderId,
                executedQty: executedQty,
                avgPrice: avgPrice,
                quoteSpent: quoteSpent
            };

        } catch (error) {
            this.addLog(`${logPrefix} ❌ Trade execution failed: ${error.message}`, 'error', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async _executeDemoTrade(preparedData) {
        // LEGACY: This method creates purely simulated positions with no Binance interaction
        // Currently not used, but kept for potential future "paper trading" feature
        try {
            this.addLog(`[DEMO_TRADE] 🎮 Creating simulated position (no Binance API call)...`, 'info');

            const position = {
                wallet_id: this.scannerService.state.liveWalletState.id,
                position_id: preparedData.position_id,
                strategy_name: preparedData.strategy_name,
                symbol: preparedData.symbol,
                direction: preparedData.direction,
                entry_price: preparedData.entry_price,
                quantity_crypto: preparedData.quantity_crypto,
                entry_value_usdt: preparedData.entry_value_usdt,
                binance_order_id: `demo_${Date.now()}`, // Simulated ID
                entry_timestamp: new Date().toISOString(),
                status: 'open',
                take_profit_price: preparedData.take_profit_price,
                stop_loss_price: preparedData.stop_loss_price,
                time_exit_hours: preparedData.time_exit_hours,
                trigger_signals: preparedData.trigger_signals || [],
                combined_strength: preparedData.combined_strength,
                conviction_score: preparedData.conviction_score,
                market_regime: preparedData.market_regime,
                regime_confidence: preparedData.regime_confidence,
                atr_value: preparedData.atr_value,
                is_event_driven_strategy: preparedData.is_event_driven_strategy || false,
                trading_mode: 'demo' // Mark as demo mode
            };

            const savedPosition = await queueEntityCall('LivePosition', 'create', position);
            this.positions.push(savedPosition);

            this.addLog(`[DEMO_TRADE] ✅ Simulated position created. No actual balance affected.`, 'success');

            return {
                success: true,
                position: savedPosition
            };

        } catch (error) {
            this.addLog(`[DEMO_TRADE] ❌ Failed to create demo position: ${error.message}`, 'error', error);
            return {
                success: false,
                error: error.message,
                position: null
            };
        }
    }

    /**
     * Logs insufficient balance messages once per cooldown period to prevent spam.
     * @param {string} errorMessage - The error message to check for insufficient balance.
     */
    logInsufficientBalanceOnce(errorMessage) {
        const isInsufficientBalance = errorMessage.toLowerCase().includes('insufficient balance');
        if (isInsufficientBalance) {
            const now = Date.now();
            if (!this.recentInsufficientBalanceLog || (now - this.recentInsufficientBalanceLog) > this.insufficientBalanceLogCooldown) {
                this.scannerService.addLog(`[${this.getTradingMode().toUpperCase()}] ❌ Trade execution failed: ${errorMessage}`, 'insufficient_balance');
                this.recentInsufficientBalanceLog = now;
            }
        }
    }

    getExchangeInfo(symbol) {
        const exchangeInfo = this.scannerService.state.exchangeInfo;

        if (!exchangeInfo || typeof exchangeInfo !== 'object' || Object.keys(exchangeInfo).length === 0) { // Fix: exchangeInfo is a Map, not an object with .symbols array
            this.addLog('🔴 CRITICAL: Exchange information is not available for symbol validation. Proceeding without validation (risky).', 'error');
            return null;
        }
        
        const symbolNoSlash = symbol.replace('/', '');
        const symbolInfo = exchangeInfo[symbolNoSlash]; // Access directly by symbol key

        if (!symbolInfo) {
            this.addLog(`⚠️ Symbol ${symbol} not found in exchange info`, 'warning');
            return null;
        }

        return symbolInfo;
    }

    // Sizing Debug Logs (log only once per coin + strategy per scan)
    _logSizeDebugOnce(name, coin, reason, sizeInfo, strategyName, currentPrice, indicators, klines) {
        if (!this.scannerService) return;
        const key = `${coin}-${strategyName}`;
        if (this._sizeDebugKeys.has(key)) return;
        this._sizeDebugKeys.add(key);

        // eslint-disable-next-line no-unused-vars
        const marketRegime = this.scannerService.state?.marketRegime?.regime;
        // eslint-disable-next-line no-unused-vars
        const adx = this.scannerService.state?.marketVolatility?.adx;
        // eslint-disable-next-line no-unused-vars
        const bbw = this.scannerService.state?.marketVolatility?.bbw;

        const wallet = this.getActiveWalletState() || {};
        
        const balanceInTrades = (wallet.positions || []).reduce((acc, pos) => {
            if (pos.status === 'open' || pos.status === 'trailing') {
                return acc + (pos.entry_value_usdt || 0);
            }
            return acc;
        }, 0);
        
        // eslint-disable-next-line no-unused-vars
        const availableCash = (wallet.initial_balance_usdt || 0) + (wallet.total_realized_pnl || 0) - balanceInTrades;

        this.scannerService.addLog(`🔻 Trade for ${strategyName} on ${coin} blocked: ${reason}`, 'warning', { indicators, klines, coin, timeframe: this.scannerService.state.timeframe, strategyName, currentPrice });
    }

    _logSizeBreakdownOnce(name, coin, reason, sizeBreakdown) {
        if (!this.scannerService) return;
        if (this.sizeDebugCounter >= this.sizeDebugMax) return;
        const key = `${coin}-${name}`;
        if (this._sizeDebugKeys.has(key)) return;
        this._sizeDebugKeys.add(key);
    }

    // Sizing Debug Helpers
    _extractLatestATRForDebug(klines, indicators) {
        if (indicators && indicators.atr) return indicators.atr;
        if (this._lastDebugIndicators?.atr) return this._lastDebugIndicators.atr;
        if (klines && klines.length >= 14) return this._computeATRFromKlines(klines);
        if (this._lastDebugKlines && this._lastDebugKlines.length >= 14) return this._computeATRFromKlines(this._lastDebugKlines);
        return null;
    }

    _computeATRFromKlines(klines, period = 14) {
        if (!klines || klines.length < period) return null;
        try {
            const atrResult = calculateATR(klines, period);
            return atrResult.length > 0 ? atrResult[atrResult.length - 1].atr : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Calculates the position size based on strategy settings, market conditions, and wallet state.
     * This method acts as a wrapper around dynamicSizing.calculatePositionSize for internal consistency.
     * @param {object} combination - The strategy/combination object.
     * @param {number} currentPrice - The current market price of the asset.
     * @param {number} convictionScore - The conviction score for the trade.
     * @param {object} convictionDetails - Detailed breakdown of the conviction score.
     * @param {Array} klines - Klines data for the asset.
     * @param {object} indicators - Indicators data for the asset.
     * @param {string} timeframe - The timeframe of the data.
     * @returns {{isValid: boolean, entry_value_usdt?: number, reason?: string}}
     */
    calculatePositionSize(combination, currentPrice, convictionScore, convictionDetails, klines, indicators, timeframe) {
        if (!combination || !currentPrice || !this.scannerService.state.settings || !this.scannerService.state.liveWalletState) {
            return { isValid: false, reason: 'Missing essential data for position size calculation.' };
        }

        const strategyName = combination.combinationName || combination.coin;
        const walletState = this.scannerService.state.liveWalletState;
        const totalWalletBalance = parseFloat(walletState.initial_balance_usdt || '0') + parseFloat(walletState.total_realized_pnl || '0');
        const balanceInTrades = this.getBalanceInTrades();
        const availableCash = totalWalletBalance - balanceInTrades;

        const sizingOptions = {
            strategySettings: this.scannerService.state.settings,
            strategy: combination,
            wallet: walletState,
            currentPrice,
            convictionScore,
            convictionDetails,
            totalWalletBalance,
            availableCash,
            klines,
            indicators,
            timeframe
        };

        const result = dynamicSizing.calculatePositionSize(sizingOptions);

        if (!result.isValid) {
            this.addLog(`[POSITION_SIZE] ⚠️ Sizing failed for ${strategyName} on ${combination.coin}: ${result.reason}`, 'warning');
            return { isValid: false, reason: result.reason || 'Failed to calculate position size.' };
        }

        return {
            isValid: true,
            entry_value_usdt: result.positionSize,
            reason: result.reason
        };
    }

    /**
     * Opens a batch of positions with proper Binance integration and verification
     * @param {Array<object>} signalsToOpen - Array of signal objects to potentially open.
     * @returns {{opened: number, failed: number, skippedInsufficientFunds: number, errors: Array<object>, detailedResults: Array<object>}}
     */
    async openPositionsBatch(signalsToOpen) {
        // NEW: Defensive guards to prevent "Cannot set properties of undefined (setting '0')"
        const initialSignalsBatch = Array.isArray(signalsToOpen) ? signalsToOpen : [];
        const initialSignalsCount = initialSignalsBatch.length;
        const finalDetailedResults = new Array(initialSignalsCount).fill(null); // Initialize to track all results

        if (initialSignalsCount === 0) {
            // Nothing to do
            return { opened: 0, failed: 0, skippedInsufficientFunds: 0, errors: [], detailedResults: finalDetailedResults };
        }

        const errors = []; 
        let openedCount = 0;
        let failedOtherReasonCount = 0; // For skips due to max positions, invalid sizing, etc.
        let insufficientFundsCount = 0; // Tracks insufficient funds, both pre-check and execution
        let testnetLiquiditySkipCount = 0; // New counter for testnet EXPIRED/CANCELED orders

        // Aggregate "below minimum" skips to avoid spam
        const scanner = this.scannerService;
        const settings = scanner?.state?.settings || {};
        const minTradeValueSetting = typeof settings.minimumTradeValue === 'number' ? settings.minimumTradeValue : 10;

        // Early guard: if free USDT is below minimum trade size, skip opening any positions with a single concise log
        const balances = this.scannerService?.state?.liveWalletState?.balances || [];
        const usdtBal = balances.find(b => b.asset === 'USDT');
        const freeUsdt = Number.parseFloat(usdtBal?.free || '0') || 0;
        const minTrade = this.scannerService?.state?.settings?.minimumTradeValue ?? 10;

        if (freeUsdt < minTrade) {
            try {
                const fmt = this.scannerService && typeof this.scannerService._formatCurrency === 'function'
                    ? this.scannerService._formatCurrency.bind(this.scannerService)
                    : (v) => `$${Number(v || 0).toFixed(2)};`;
                this.addLog(`[FUNDS] Free balance ${fmt(freeUsdt)} is below minimum trade size ${fmt(minTrade)}. Skipping new position search this cycle.`, 'info');
            } catch (_) {}
            return { opened: 0, failed: 0, skippedInsufficientFunds: 0, errors: [], detailedResults: initialSignalsBatch.map(item => ({
                strategy: item?.combination?.combinationName || 'Unknown',
                symbol: item?.combination?.coin || 'Unknown',
                success: false,
                reason: `Insufficient free USDT balance (${this._formatUsdSmart(freeUsdt)}) is below minimum trade size (${this._formatUsdSmart(minTrade)}).`,
                error: null,
                isInsufficientBalance: true
            })) };
        }


        const preFilteredSignals = [];
        let belowMinInitialCount = 0;

        initialSignalsBatch.forEach((item, originalIndex) => { // Use initialSignalsBatch
            try {
                const calculatedPositionSizeUsdt = item?.calculatedPositionSizeUSDT ?? item?.positionSizeUsdt ?? item?.entry_value_usdt ?? item?.sizeUSDT ?? item?.positionDetails?.positionSizeUSDT ?? item?.sizeUsdt ?? 0;
                
                if (calculatedPositionSizeUsdt < minTradeValueSetting) {
                    belowMinInitialCount += 1;
                    finalDetailedResults[originalIndex] = {
                        strategy: item?.combination?.combinationName || 'Unknown',
                        symbol: item?.combination?.coin || 'Unknown',
                        success: false,
                        reason: `Position size ${calculatedPositionSizeUsdt.toFixed(2)} USDT is below minimum trade value ${minTradeValueSetting} USDT.`,
                        error: null,
                        isInsufficientBalance: false
                    };
                }
                else if (this.handledPositionIds.has(item.position_id || item.trade_id)) { // Prevent re-opening already handled positions
                    this.addLog(`[BATCH_OPEN] ⚠️ Skipping signal (already handled): ${item.combination?.combinationName || 'Unknown'} on ${item.combination?.coin || 'Unknown'}`, 'warning');
                    failedOtherReasonCount++;
                    finalDetailedResults[originalIndex] = {
                        strategy: item?.combination?.combinationName || 'Unknown',
                        symbol: item?.combination?.coin || 'Unknown',
                        success: false,
                        reason: 'Position already handled in this scan cycle.',
                        error: null,
                        isInsufficientBalance: false
                    };
                }
                else {
                    preFilteredSignals.push({ ...item, originalIndex }); // Preserve original index for detailedResults mapping
                }
            } catch (e) {
                // If malformed, skip silently
                belowMinInitialCount += 1;
                this.addLog(`[BATCH_OPEN] ⚠️ Malformed signal skipped during pre-filtering: ${e.message}`, 'warning', { item });
                // Add a placeholder result for the malformed signal
                finalDetailedResults[originalIndex] = {
                    strategy: item?.combination?.combinationName || 'Unknown',
                    symbol: item?.combination?.coin || 'Unknown',
                    success: false,
                    reason: `Malformed signal data: ${e.message}`,
                    error: e.message,
                    isInsufficientBalance: false
                };
            }
        });

        if (belowMinInitialCount > 0) { // Log once for all below minimum skips
            scanner.addLog(`[BATCH_OPEN] ⚠️ ${belowMinInitialCount} signal(s) skipped due to position size being below minimum trade value (${this._formatUsdSmart(minTradeValueSetting)})`, 'warning');
            failedOtherReasonCount += belowMinInitialCount; // Count these as "failed other reason"
        }

        if (preFilteredSignals.length === 0) {
            this.addLog(`[BATCH_OPEN] ⚠️ No viable signals left to process after pre-filtering.`, 'warning');
            return { opened: 0, failed: failedOtherReasonCount, skippedInsufficientFunds: insufficientFundsCount, errors: errors, detailedResults: finalDetailedResults };
        }
        // END NEW pre-filter logic

        await this.refreshBalanceFromBinance();
        const currentTotalUsdtBalance = this.getCurrentUsdtBalance();
        //this.addLog(`[BATCH_OPEN] 💰 Fresh Binance ${this.tradingMode.toUpperCase()} balance: ${this._formatCurrency(currentTotalUsdtBalance)} USDT`, 'info');

        const maxPositionsPerStrategy = this.scannerService.state.settings?.maxPositions || 10;
        const currentPositionsCountPerStrategy = {}; 

        this.positions.forEach(pos => {
            if (pos.status === 'open' || pos.status === 'trailing') {
                currentPositionsCountPerStrategy[pos.strategy_name] = (currentPositionsCountPerStrategy[pos.strategy_name] || 0) + 1;
            }
        });

        const eligibleSignalsWithIndex = [];
        let runningBalance = currentTotalUsdtBalance;

        // Ensure adjustedBalanceRiskFactor is defined before using it to scale sizes
        const adjustedBalanceRiskFactor = (
            this.scannerService?.state?.adjustedBalanceRiskFactor ??
            this.scannerService?.state?.settings?.maxBalancePercentRisk ??
            100
        );

        this.addLog(`[BATCH_OPEN] 🚀 Evaluating ${preFilteredSignals.length} signals for eligibility...`, 'info');

        preFilteredSignals.forEach((signalWithOriginalIndex) => { // Iterate over preFilteredSignals
            const signal = signalWithOriginalIndex; // signalWithOriginalIndex itself contains signal data and originalIndex
            const originalIndex = signalWithOriginalIndex.originalIndex; // Extract originalIndex

            const { combination, currentPrice, convictionScore, convictionDetails, klines, indicators, timeframe } = signal;

            let baseResult = {
                strategy: combination?.combinationName || 'Unknown',
                symbol: combination?.coin || 'Unknown',
                success: false,
                reason: '',
                error: null,
                isInsufficientBalance: false
            };

            if (!combination || !currentPrice || currentPrice <= 0) {
                baseResult.reason = 'Invalid basic signal data (missing combination or invalid current price)';
                this.addLog(`[BATCH_OPEN] ❌ Skipping signal ${baseResult.strategy} on ${baseResult.symbol}: ${baseResult.reason}`, 'warning');
                failedOtherReasonCount++;
                finalDetailedResults[originalIndex] = baseResult; // Update finalDetailedResults
                return;
            }

            const symbol = combination.coin;
            if (!symbol) {
                baseResult.reason = `No valid symbol found for combination '${combination?.combinationName || 'Unknown'}'`;
                this.addLog(`[BATCH_OPEN] ❌ Skipping signal for unknown symbol in combination '${combination?.combinationName || 'Unknown'}'`, 'warning');
                failedOtherReasonCount++;
                finalDetailedResults[originalIndex] = baseResult; // Update finalDetailedResults
                return;
            }
            baseResult.symbol = symbol;
            const strategyName = combination.combinationName;
            baseResult.strategy = strategyName;

            const currentCount = currentPositionsCountPerStrategy[strategyName] || 0;
            if (currentCount >= maxPositionsPerStrategy) {
                baseResult.reason = `Max positions (${maxPositionsPerStrategy}) reached for this strategy.`;
                this.addLog(`[BATCH_OPEN] 🚫 Skipping ${strategyName} on ${symbol}: ${baseResult.reason}`, 'info');
                failedOtherReasonCount++;
                finalDetailedResults[originalIndex] = baseResult; // Update finalDetailedResults
                return;
            }

            const sizingOptions = {
                balance: runningBalance,
                riskPercentage: settings?.riskPerTrade || 2,
                atr: signal.atr_value,
                stopLossAtrMultiplier: combination.stopLossAtrMultiplier || 2.5,
                convictionScore,
                currentPrice,
                defaultPositionSize: settings?.defaultPositionSize || 100,
                useWinStrategySize: settings?.useWinStrategySize !== false,
                minimumTradeValue: minTradeValueSetting // Use the defined minTradeValueSetting
            };

            const sizeResult = this.positionSizeValidator.calculate(sizingOptions);

            if (!sizeResult.isValid) {
                baseResult.reason = `Position size calculation failed: ${sizeResult.reason}`;
                if (sizeResult.reason.toLowerCase().includes('insufficient_balance')) {
                    insufficientFundsCount++;
                    baseResult.isInsufficientBalance = true;
                    // Don't log individual insufficient_balance messages
                } else {
                    this.addLog(`[BATCH_OPEN] 🚫 Skipping ${strategyName} on ${symbol}: ${baseResult.reason}`, 'warning');
                    failedOtherReasonCount++;
                }
                finalDetailedResults[originalIndex] = baseResult; // Update finalDetailedResults
                return;
            }

            let effectivePositionSizeUsdt = sizeResult.positionSizeUSDT;
            effectivePositionSizeUsdt = effectivePositionSizeUsdt * (adjustedBalanceRiskFactor / 100);

            // Insufficient balance check (running balance) - PRE-FILTERING PHASE
            if (effectivePositionSizeUsdt > runningBalance) {
                baseResult.reason = `Insufficient available balance. Needed ${this._formatUsdSmart(effectivePositionSizeUsdt)}, have ${this._formatUsdSmart(runningBalance)}.`;
                baseResult.isInsufficientBalance = true;
                insufficientFundsCount++; // Increment counter
                // No individual log here as per requested change
                finalDetailedResults[originalIndex] = baseResult; // Update finalDetailedResults
                return;
            }

            eligibleSignalsWithIndex.push({
                signal: {
                    ...signal,
                    strategyName: strategyName,
                    symbol: symbol,
                    convictionDetails: convictionDetails,
                    klines: klines,
                    indicators: indicators,
                    timeframe: timeframe,
                    calculatedPositionSizeUSDT: effectivePositionSizeUsdt
                },
                originalIndex: originalIndex
            });
            runningBalance -= effectivePositionSizeUsdt;
            currentPositionsCountPerStrategy[strategyName] = currentCount + 1;

            //this.addLog(`[BATCH_OPEN] ✅ ${strategyName} on ${symbol} eligible. Estimated size: ${this._formatCurrency(effectivePositionSizeUsdt)}. Remaining balance for batch: ${this._formatCurrency(runningBalance)}.`, 'debug');
        });

        if (eligibleSignalsWithIndex.length === 0) {
            // All signals were filtered out before execution
            const totalSkipped = failedOtherReasonCount + insufficientFundsCount;
            this.addLog(`[BATCH_OPEN] ⚠️ No eligible signals to open after pre-filtering. Total signals: ${initialSignalsCount}, Skipped: ${totalSkipped}.`, 'warning');
            
            if (insufficientFundsCount > 0) {
                 this.addLog(
                    `[BATCH_OPEN] 💰 ${insufficientFundsCount} ${insufficientFundsCount === 1 ? 'strategy was' : 'strategies were'} skipped due to insufficient available funds during pre-check.`,
                    'insufficient_balance',
                    { level: 1 }
                );
            }
            return { opened: 0, failed: failedOtherReasonCount + testnetLiquiditySkipCount, skippedInsufficientFunds: insufficientFundsCount, errors: errors, detailedResults: finalDetailedResults };
        }

        this.addLog(`[BATCH_OPEN] 🚀 Proceeding to open ${eligibleSignalsWithIndex.length} positions...`, 'info');

        // Loop for executing trades
        for (const { signal, originalIndex } of eligibleSignalsWithIndex) {
            const { combination, currentPrice, convictionScore, convictionDetails, klines, indicators, timeframe, symbol, strategyName, calculatedPositionSizeUSDT } = signal;

            let resultEntry = {
                strategy: strategyName,
                symbol: symbol,
                success: false,
                reason: '',
                error: null,
                isInsufficientBalance: false
            };

            try {
                let quantityCrypto;
                
                try {
                    quantityCrypto = await this.formatQuantityForSymbol(
                        symbol,
                        calculatedPositionSizeUSDT / currentPrice,
                        currentPrice
                    );
                    quantityCrypto = parseFloat(quantityCrypto);
                } catch (formatError) {
                    resultEntry.reason = `Quantity formatting failed: ${formatError.message}`;
                    resultEntry.error = formatError.message;
                    this.addLog(`[BATCH_OPEN] 🚫 BLOCKED - ${strategyName} on ${symbol}: ${resultEntry.reason}`, 'warning');
                    failedOtherReasonCount++;
                    errors.push({ strategy: strategyName, error: resultEntry.error });
                    finalDetailedResults[originalIndex] = resultEntry; // Update finalDetailedResults
                    continue;
                }

                if (quantityCrypto <= 0) {
                    resultEntry.reason = 'Adjusted quantity is zero or negative.';
                    this.addLog(`[BATCH_OPEN] 🚫 BLOCKED - ${strategyName} on ${symbol}: ${resultEntry.reason}`, 'warning');
                    failedOtherReasonCount++;
                    errors.push({ strategy: strategyName, error: resultEntry.reason });
                    finalDetailedResults[originalIndex] = resultEntry; // Update finalDetailedResults
                    continue;
                }

                const finalEntryValueUsdt = quantityCrypto * currentPrice;

                const tradeParams = {
                    ...signal,
                    strategy_name: strategyName,
                    symbol: symbol,
                    direction: combination.strategyDirection || 'long',
                    entry_price: currentPrice,
                    quantity_crypto: quantityCrypto,
                    entry_value_usdt: finalEntryValueUsdt,
                    conviction_score: convictionScore,
                    conviction_breakdown: convictionDetails,
                    combined_strength: signal.combinedStrength,
                    market_regime: this.scannerService.state.marketRegime?.regime || null,
                    regime_confidence: this.scannerService.state.marketRegime?.confidence,
                    atr_value: signal.atr_value,
                    trigger_signals: combination.signals || [],
                    timeframe: timeframe,
                    klines: klines,
                    indicators: indicators,
                    enableTrailingTakeProfit: combination.enableTrailingTakeProfit !== false,
                };

                this._calculateTradeExecutionParameters(tradeParams);

                const executionResult = await this.executeTrade(tradeParams);

                // --- PATCH 3 (part 2 of 2): Handle null result from executeTrade ---
                if (executionResult === null) {
                    this.addLog(`[BATCH_OPEN] ℹ️ ${strategyName} on ${symbol}: Order not filled (testnet ${this.tradingMode} expired/canceled). Skipping without error.`, 'info');
                    testnetLiquiditySkipCount++;
                    finalDetailedResults[originalIndex] = {
                        strategy: strategyName,
                        symbol: symbol,
                        success: false,
                        reason: `Testnet order EXPIRED/CANCELED due to liquidity.`,
                        error: null,
                        isInsufficientBalance: false,
                        isTestnetLiquiditySkip: true
                    };
                    continue; // Move to the next signal
                }
                // --- END PATCH 3 (part 2 of 2) ---

                if (executionResult.success) {
                    openedCount++;
                    resultEntry.success = true;
                    resultEntry.reason = `Position opened. ID: ${executionResult.position?.position_id}`;
                    resultEntry.trade = executionResult.position;
                    // eslint-disable-next-line no-unused-vars
                    const riskFactorForLog = (
                        this.scannerService?.state?.adjustedBalanceRiskFactor ??
                        this.scannerService?.state?.settings?.maxBalancePercentRisk ??
                        100
                    );
                   /* this.addLog(
                        `[BATCH_OPEN] ✅ Opened position for ${strategyName} on ${symbol}. Size: ${this._formatCurrency(tradeParams.entry_value_usdt)} (Risk Factor: ${Math.round(Number(riskFactorForLog) || 100)}%)`,
                        'success'
                    );*/
                } else {
                    resultEntry.reason = `Execution failed: ${executionResult.error}`;
                    resultEntry.error = executionResult.error;
                    resultEntry.isInsufficientBalance = executionResult.isInsufficientBalance || false;
                    
                    // Handle insufficient balance during execution phase
                    if (resultEntry.isInsufficientBalance) {
                        insufficientFundsCount++; // Increment counter
                        // No individual log here as per requested change
                    } else {
                        // Log other types of failures
                        failedOtherReasonCount++;
                        errors.push({ strategy: strategyName, error: resultEntry.error });
                        this.addLog(`[BATCH_OPEN] ❌ Execution failed for ${strategyName} on ${symbol}: ${executionResult.error}`, 'error');
                    }
                }
                finalDetailedResults[originalIndex] = resultEntry; // Update finalDetailedResults
            } catch (error) {
                failedOtherReasonCount++; // Mark as failed for other reasons
                resultEntry.reason = `Processing error during execution: ${error.message}`;
                resultEntry.error = error.message;
                errors.push({ strategy: strategyName, error: resultEntry.reason });
                this.addLog(`[BATCH_OPEN] ❌ Error processing eligible signal for ${strategyName} on ${symbol}: ${error.message}`, 'error');
                finalDetailedResults[originalIndex] = resultEntry; // Update finalDetailedResults
            }
        }

        // Trigger wallet save if positions were opened
        if (openedCount > 0) {
            this.persistWalletChanges();
        }
        
        // Final Summary Logs
        this.addLog(
            `[BATCH_OPEN] 📊 Batch open complete: ${openedCount} opened, ${failedOtherReasonCount} failed, ${insufficientFundsCount} skipped (funds limit), ${testnetLiquiditySkipCount} skipped (testnet liquidity)`,
            'info',
            { level: 1 }
        );

        // Log consolidated insufficient funds message if any were skipped
        if (insufficientFundsCount > 0) {
            this.addLog(
                `[BATCH_OPEN] 💰 ${insufficientFundsCount} ${insufficientFundsCount === 1 ? 'strategy was' : 'strategies were'} skipped due to funds limit.`,
                'insufficient_balance',
                { level: 1 }
            );
        }

        return { opened: openedCount, failed: failedOtherReasonCount + testnetLiquiditySkipCount, skippedInsufficientFunds: insufficientFundsCount, errors: errors, detailedResults: finalDetailedResults };
    }

    /**
     * Execute fast batch close - handles database updates without waiting for performance snapshot
     * @private
     * @param {Array<object>} tradesToCreate - Array of trade data objects that were just closed.
     * @param {Array<string>} positionIdsToClose - Array of position IDs to remove from wallet state and delete.
     * @returns {Promise<{success: boolean, tradesCreated: number, positionsRemoved: number, totalPnL: number, error?: string}>}
     */
    async _executeFastBatchClose(tradesToCreate, positionIdsToClose) {
        if (tradesToCreate.length === 0) {
            this.addLog('[PositionManager] ⚠️ No trades to create, skipping batch close', 'warning');
            return { success: true, closed: 0 };
        }

        try {
            const mode = this.scannerService.getTradingMode();
            const isLiveMode = mode === 'live' || mode === 'testnet';

            // Get proxyUrl from settings as per outline's request
            const settings = await queueEntityCall('ScanSettings', 'list');
            const proxyUrl = settings?.[0]?.local_proxy_url;

            // Step 1: Execute sell orders on Binance for both live and testnet modes
            if (isLiveMode) {
                this.addLog(`[PositionManager] 💱 Executing SELL orders on Binance (${mode.toUpperCase()} MODE)...`, 'info');

                for (const positionId of positionIdsToClose) {
                    const position = this.positions.find(p => p.id === positionId);
                    const trade = tradesToCreate.find(t => t.trade_id === position?.position_id); // Find corresponding trade data

                    if (!position) {
                        this.addLog(`[BATCH_CLOSE] ⚠️ Position with ID ${positionId} not found in in-memory cache, skipping sell order.`, 'warning');
                        continue;
                    }
                    if (!trade) {
                        this.addLog(`[BATCH_CLOSE] ⚠️ Trade data for position ${positionId} (pos_id: ${position.position_id}) not found, skipping sell P&L logging.`, 'warning');
                        // Proceed without full trade data, as it's not essential for the sell order itself
                    }

                    if (!proxyUrl) {
                        this.addLog('[PositionManager] ❌ No proxyUrl configured in settings!', 'error');
                        this.addLog('[CLOSE] ❌ Cannot execute Binance orders - proxy URL not configured', 'error', { level: 2 });
                        continue;
                    }
                    
                    try {
                        const binanceSellOptions = {
                            currentPrice: trade?.exit_price || this.scannerService.currentPrices[position.symbol.replace('/', '')] || position.entry_price,
                            tradingMode: mode,
                            proxyUrl: proxyUrl,
                            exitReason: trade?.exit_reason,
                            pnlUsdt: trade?.pnl_usdt,
                            pnlPercentage: trade?.pnl_percentage
                        };
                        
                        const sellResult = await this._executeBinanceMarketSellOrder(position, binanceSellOptions);

                        if (sellResult.skipped) {
                            this.addLog(`[BATCH_CLOSE] ℹ️ Binance SELL for ${position.symbol} skipped: ${sellResult.reason}. Continuing with local close.`, 'info');
                        } else if (!sellResult.success) {
                            const errorMsg = sellResult.error || 'Unknown error during Binance sell';
                            this.addLog(`[BATCH_CLOSE] ❌ Binance SELL order failed for ${position.symbol}: ${errorMsg}`, 'error');
                            this.addLog(`[BATCH_CLOSE] Raw Binance API response for failure: ${JSON.stringify(sellResult, null, 2)}`, 'error');
                            this.addLog(
                                `[CLOSE] ❌ Binance SELL failed for ${position.symbol}: ${errorMsg}`,
                                'error',
                                { level: 2 }
                            );
                        }
                    } catch (sellError) {
                        this.addLog(`[BATCH_CLOSE] ❌ Error executing Binance SELL for ${position.symbol}: ${sellError.message}`, 'error', sellError);
                        this.addLog(
                            `[CLOSE] ❌ Error selling ${position.symbol} on Binance: ${sellError.message}`,
                            'error',
                            { level: 2 }
                        );
                        // Continue with local close even on error
                    }
                }
                
            } else {
                this.addLog(`[PositionManager] ℹ️ ${mode.toUpperCase()} MODE - Skipping Binance order execution`, 'info');
            }

            // Step 2: Create Trade records
            if (tradesToCreate.length > 0) {
                await queueEntityCall('Trade', 'bulkCreate', tradesToCreate);
            }

            // Step 3: Delete LivePosition entities
            for (const posId of (positionIdsToClose || [])) {
                await this._safeDeleteLivePosition(posId);
            }

            // Step 4: Remove closed positions from in-memory array
            this.positions = this.positions.filter(p => !positionIdsToClose.includes(p.id));

            // Remove closed positions from wallet state's live_position_ids
            if (this.scannerService.state.liveWalletState) {
                const remainingIds = this.positions.map(p => p.id).filter(id => id);
                this.scannerService.state.liveWalletState.live_position_ids = remainingIds;
            }

            // Step 5: Refresh wallet state after batch close
            try {
                // 5a. Sync with Binance to get updated balances
                await this.scannerService.walletManagerService.initializeLiveWallet();
                
                // 5b. Update wallet summary with fresh data
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this.scannerService.state.liveWalletState,
                    this.scannerService.currentPrices
                );
                
                // 5c. Persist to localStorage
                await this.scannerService._persistLatestWalletSummary();
                
                // 5d. Notify UI subscribers
                this.scannerService.notifyWalletSubscribers();
            } catch (refreshError) {
                this.addLog('[PositionManager] ⚠️ Wallet refresh after batch close failed:', 'error', refreshError);
                this.addLog('[PositionManager] Error details:', 'error', JSON.stringify({
                    message: refreshError.message,
                    stack: refreshError.stack
                }));
                // Don't throw - we still want to return success since trades were created and positions deleted
            }

            return { success: true, closed: positionIdsToClose.length }; // Return the number of positions that were targeted for close

        } catch (error) {
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            this.addLog('[PositionManager] ❌ _executeFastBatchClose() FAILED', 'error');
            this.addLog('[PositionManager] Error message:', error.message, 'error');
            this.addLog('[PositionManager] Error stack:', error.stack, 'error');
            this.addLog('═══════════════════════════════════════════════════════', 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Trigger background performance snapshot update without blocking the main thread.
     * @private
     * @param {Array<object>} trades - Array of trade data objects that were just closed.
     */
    _triggerBackgroundPerformanceUpdate(trades) {
        // Fire and forget - don't await this
        (async () => {
            try {
                this.addLog('[BACKGROUND_PERF_UPDATE] 🔄 Starting background performance snapshot update...', 'system');
                
                const snapshotResponse = await queueFunctionCall(
                    updatePerformanceSnapshot,
                    { trades: trades },
                    'normal',
                    null,
                    0,
                    120000 // 2 minute timeout
                );

                if (snapshotResponse?.data?.success) {
                    this.addLog('[BACKGROUND_PERF_UPDATE] ✅ Performance snapshot updated', 'success');
                } else {
                    const errorMsg = snapshotResponse?.data?.message || snapshotResponse?.data?.error || 'Unknown error';
                    this.addLog(`[BACKGROUND_PERF_UPDATE] ⚠️ ${errorMsg}`, 'warning');
                }
            } catch (error) {
                this.addLog(`[BACKGROUND_PERF_UPDATE] ⚠️ ${error.message}`, 'warning');
            }
        })();
        
        this.addLog('[BACKGROUND_PERF_UPDATE] 🔥 Background update triggered (non-blocking)', 'debug');
    }

    /**
     * Internal method to perform the actual wallet persistence logic.
     * Handles both creating and updating wallet records.
     * @returns {Promise<{success: boolean, error?: string}>}
     * @private
     */
    async _doPersistWalletChangesInternal() {
        // eslint-disable-next-line no-unused-vars
        const startTime = Date.now();
        try {
            const walletState = this.scannerService.state.liveWalletState;

            if (!walletState) {
                this.addLog('[PositionManager] No walletState to persist', 'warning');
                return { success: false, error: 'No wallet state available to persist.' };
            }

            const walletToSave = { ...walletState };
            if ('id' in walletToSave) {
                delete walletToSave.id;
            }
            // CRITICAL: Ensure `positions` array is NOT persisted with full objects, only IDs
            walletToSave.positions = []; // Clear the actual position objects from the payload
            walletToSave.live_position_ids = this.positions.map(pos => pos.id).filter(id => id); // Populate with IDs from in-memory cache

            // eslint-disable-next-line no-unused-vars
            const positionsCount = walletToSave.live_position_ids?.length || 0;
            // eslint-disable-next-line no-unused-vars
            const positionsArraySize = JSON.stringify(walletToSave.live_position_ids || []).length;
            // eslint-disable-next-line no-unused-vars
            const totalPayloadSize = JSON.stringify(walletToSave).length;
            
            // eslint-disable-next-line no-unused-vars
            const updateStartTime = Date.now();
            
            let savedWallet;
            const entityToUse = 'LiveWalletState';

            if (walletState.id) {
                savedWallet = await queueEntityCall(
                    entityToUse,
                    'update',
                    walletState.id,
                    walletToSave
                );
            } else {
                walletToSave.mode = this.tradingMode;
                savedWallet = await queueEntityCall(entityToUse, 'create', walletToSave);
            }

            // eslint-disable-next-line no-unused-vars
            const updateDuration = Date.now() - updateStartTime;
            // eslint-disable-next-line no-unused-vars
            const totalDuration = Date.now() - startTime;

            if (savedWallet && savedWallet.id) {
                // eslint-disable-next-line no-unreachable
                if (updateDuration > 10000) {
                    this.addLog(`[PERSIST_WALLET] ⚠️ SLOW UPDATE DETECTED: ${updateDuration}ms for ${positionsCount} positions (${(totalPayloadSize / 1024).toFixed(2)} KB)`, 'warning');
                }
                
                return { success: true };
            } else {
                const failureReason = savedWallet ? JSON.stringify(savedWallet) : 'null response from DB';
                this.addLog(`[WALLET_SAVE] ❌ Failed to persist wallet state. Response: ${failureReason}`, 'error');
                return { success: false, error: `Failed to persist: ${failureReason}` };
            }

        } catch (error) {
            // eslint-disable-next-line no-unused-vars
            const duration = Date.now() - startTime;
            this.addLog(`[PERSIST_WALLET] ❌ Error persisting wallet state after ${duration}ms: ${error.message}`, 'error', error);
            return { success: false, error: error.message };
        } finally {
            this.isSavingWallet = false;
            this.saveWalletPromise = null;
        }
    }

    /**
     * Persists the current state of the wallet to the database asynchronously.
     * This method initiates the save operation without waiting for its completion.
     * @returns {Promise<{success: boolean, error?: string}>} A promise that resolves with the persistence result.
     */
    async persistWalletChanges() {
        if (this.isSavingWallet && this.saveWalletPromise) {
            this.addLog('[WALLET_SAVE] ⚠️ Another save operation is already in progress. Skipping, but returning current save promise.', 'warning');
            return this.saveWalletPromise;
        }
        this.isSavingWallet = true;
        this.saveWalletPromise = this._doPersistWalletChangesInternal();
        return this.saveWalletPromise;
    }

    /**
     * Persists wallet changes and waits for the operation to complete.
     * @returns {Promise<{success: boolean, error?: string}>} A promise that resolves with the persistence result.
     */
    async persistWalletChangesAndWait() {
        // eslint-disable-next-line no-unused-vars
        const startTime = Date.now();

        if (!this.scannerService.state.liveWalletState || !this.scannerService.state.liveWalletState.id) {
            this.scannerService.addLog('[PERSIST_WALLET] ⚠️ No LiveWalletState to persist.', 'warning');
            return { success: false, error: 'No LiveWalletState available to persist.' };
        }

        const updatePayload = {
            mode: this.scannerService.state.liveWalletState.mode,
            binance_account_type: this.scannerService.state.liveWalletState.binance_account_type,
            balances: this.scannerService.state.liveWalletState.balances || [],
            positions: [], // NOTE: The actual position objects are NOT stored here, only their IDs in live_position_ids
            live_position_ids: this.positions.map(pos => pos.id).filter(id => id), // Use this.positions (in-memory cache)
            total_trades_count: this.scannerService.state.liveWalletState.total_trades_count || 0,
            winning_trades_count: this.scannerService.state.liveWalletState.winning_trades_count || 0,
            losing_trades_count: this.scannerService.state.liveWalletState.losing_trades_count || 0,
            total_realized_pnl: this.scannerService.state.liveWalletState.total_realized_pnl || 0,
            total_gross_profit: this.scannerService.state.liveWalletState.total_gross_profit || 0,
            total_gross_loss: this.scannerService.state.liveWalletState.total_gross_loss || 0,
            total_fees_paid: this.scannerService.state.liveWalletState.total_fees_paid || 0,
            last_updated_timestamp: new Date().toISOString(),
            last_binance_sync: this.scannerService.state.liveWalletState.last_binance_sync
        };

        // eslint-disable-next-line no-unused-vars
        const payloadSizeKB = (JSON.stringify(updatePayload).length / 1024).toFixed(2);

        if (this.isSavingWallet && this.saveWalletPromise) { // Check if already saving AND promise exists
            return this.saveWalletPromise;
        }

        this.isSavingWallet = true;

        this.saveWalletPromise = (async () => {
            try {
                // eslint-disable-next-line no-unused-vars
                const updateStart = Date.now();
                const result = await queueEntityCall('LiveWalletState', 'update', this.scannerService.state.liveWalletState.id, updatePayload);
                // eslint-disable-next-line no-unused-vars
                const updateDuration = Date.now() - updateStart;

                if (result) {
                    // Update the in-memory wallet state with the new payload fields (balances, stats, live_position_ids)
                    // But keep the `positions` array pointing to `this.positions`
                    Object.assign(this.scannerService.state.liveWalletState, {
                        ...updatePayload,
                        positions: this.positions // Ensure the `positions` property points to the internal cache
                    });
                }

                // eslint-disable-next-line no-unused-vars
                const totalDuration = Date.now() - startTime;

                return { success: true };
            } catch (error) {
                this.scannerService.addLog(`[PERSIST_WALLET] ❌ Failed to persist LiveWalletState: ${error.message}`, 'error', error);
                return { success: false, error: error.message };
            } finally {
                this.isSavingWallet = false;
                this.saveWalletPromise = null;
            }
        })();

        return this.saveWalletPromise;
    }


    /**
     * Ensures any pending wallet save operation completes before proceeding.
     * @param {number} timeoutMs - Max time to wait in milliseconds.
     * @returns {Promise<{success: boolean, error?: string}>} A promise that resolves with the persistence result or rejects on timeout.
     */
    async waitForWalletSave(timeoutMs = 30000) {
        if (!this.isSavingWallet || !this.saveWalletPromise) {
            return Promise.resolve({ success: true, message: 'No wallet save in progress.' });
        }

        return Promise.race([
            this.saveWalletPromise,
            new Promise((resolve, reject) => {
                setTimeout(() => {
                    reject(new Error(`Wallet save timeout after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);
    }

    getWalletStateHistory() {
        return [];
    }

    /**
     * Method to clean up inconsistent or overly old position data from the wallet state.
     * This helps prevent "stuck" positions that should no longer be tracked.
     * @returns {Promise<{cleaned: number, errors: string[]}>} An object containing the count of cleaned positions and any errors.
     */
    async reconcilePositionData() {
        // eslint-disable-next-line no-unused-vars
        const startTime = Date.now();
        this.scannerService.addLog('[POSITION_RECONCILE] 🔍 Starting position data reconciliation...', 'system');
        
        const walletState = this.getActiveWalletState();
        
        if (!walletState?.positions || !Array.isArray(walletState.positions)) {
            this.scannerService.addLog('[POSITION_RECONCILE] ⚠️ No positions to reconcile', 'warning');
            return { cleaned: 0, errors: [] };
        }

        const originalCount = walletState.positions.length;
        const errors = [];

        const positionMap = new Map();
        // eslint-disable-next-line no-unused-vars
        const duplicatesFound = [];

        walletState.positions.forEach((pos, idx) => {
            if (!pos.id) { // Changed to use LivePosition.id
                errors.push(`Position at index ${idx} has no database ID (pos.id)`);
                return;
            }

            if (positionMap.has(pos.id)) { // Changed to use LivePosition.id
                duplicatesFound.push(pos.id); // Changed to use LivePosition.id
            } else {
                positionMap.set(pos.id, pos); // Changed to use LivePosition.id
            }
        });

        // After processing, ensure this.positions (internal cache) is also updated
        this.positions = Array.from(positionMap.values());
        walletState.positions = this.positions; // Ensure walletState also reflects this.positions

        const deduplicatedCount = this.positions.length;
        const duplicatesRemoved = originalCount - deduplicatedCount;

        if (duplicatesRemoved > 0) {
            this.scannerService.addLog(`[POSITION_RECONCILE] 🧹 Removed ${duplicatesRemoved} duplicate position(s) from wallet state.`, 'info');
            
            try {
                await this.persistWalletChangesAndWait();
                this.scannerService.addLog(`[POSITION_RECONCILE] ✅ Deduplicated positions persisted to database`, 'success');
            } catch (saveError) {
                const errorMsg = saveError?.message || String(saveError);
                errors.push(`Failed to persist deduplicated positions: ${errorMsg}`);
                this.scannerService.addLog(`[POSITION_RECONCILE] ❌ Failed to save cleaned positions: ${errorMsg}`, 'error');
            }
        } else {
            this.scannerService.addLog('[POSITION_RECONCILE] ✅ No duplicates found', 'success');
        }

        const duration = Date.now() - startTime;
        this.scannerService.addLog(`[POSITION_RECONCILE] Reconciliation complete in ${duration}ms (cleaned: ${duplicatesRemoved}, errors: ${errors.length})`, 'info');

        return {
            cleaned: deduplicatedCount, // Should be count of successfully kept/deduplicated positions
            errors
        };
    }

    // NEW: Batch execute trades wrapper used by SignalDetectionEngine
    async batchExecuteTrades(tradeRequests = []) {
      try {
        if (!Array.isArray(tradeRequests) || tradeRequests.length === 0) {
          this.scannerService.addLog('[BATCH_EXECUTE_TRADES] No trade requests provided.', 'system');
          return { opened: 0, failed: 0, errors: [], insufficientBalance: 0, detailedResults: [] };
        }

        const normalized = tradeRequests
          .map((r) => ({
            combination: r?.combination ?? r?.strategy ?? r?.match ?? null,
            currentPrice: r?.currentPrice ?? r?.price ?? r?.entryPrice ?? null,
            convictionScore: r?.convictionScore ?? r?.score ?? null,
            convictionDetails: r?.convictionDetails ?? r?.details ?? null,
            combinedStrength: r?.combinedStrength ?? null,
            positionSizeUsdt: r?.positionSizeUsdt ?? r?.entry_value_usdt ?? r?.sizeUSDT ?? null,
            symbol: r?.symbol || r?.combination?.coin,
            direction: r?.direction || r?.combination?.strategyDirection,
            klines: r?.klines ?? null,
            indicators: r?.indicators ?? null,
            timeframe: r?.timeframe ?? r?.combination?.timeframe ?? null,
            atr_value: r?.atr_value ?? r?.atrValue ?? null, // Ensure ATR is passed
            trigger_signals: r?.trigger_signals ?? r?.signals ?? [],
            stopLossAtrMultiplier: r?.stopLossAtrMultiplier ?? r?.combination?.stopLossAtrMultiplier,
            takeProfitAtrMultiplier: r?.takeProfitAtrMultiplier ?? r?.combination?.takeProfitAtrMultiplier,
            enableTrailingTakeProfit: r?.enableTrailingTakeProfit !== false,
            estimatedExitTimeMinutes: r?.estimatedExitTimeMinutes ?? r?.combination?.estimatedExitTimeMinutes
          }))
          .filter((x) => x.combination && typeof x.currentPrice === 'number');

        if (normalized.length === 0) {
          this.scannerService.addLog('[BATCH_EXECUTE_TRADES] All trade requests were invalid after normalization.', 'warning');
          // All signals were invalid during normalization, so they are all "skipped/failed"
          return { opened: 0, failed: tradeRequests.length, errors: [], insufficientBalance: 0, detailedResults: tradeRequests.map(req => ({
            success: false,
            strategy: req?.combination?.combinationName || 'Unknown',
            symbol: req?.combination?.coin || 'Unknown',
            reason: 'Invalid signal data'
          }))};
        }

        // Delegate to the new openPositionsBatch
        const res = await this.openPositionsBatch(normalized);
        const opened = res?.opened || 0;
        const failedOtherReason = res?.failed || 0; // Renamed for clarity, from openPositionsBatch
        const skippedInsufficientFunds = res?.skippedInsufficientFunds || 0; // New property from openPositionsBatch
        const allErrors = res?.errors || []; // Contains actual error objects

        const failed = failedOtherReason; // The failed count in openPositionsBatch already includes testnet liquidity skips.

        await this.persistWalletChangesAndWait();
        if (this.scannerService?.walletManagerService && this.scannerService?.state?.liveWalletState) {
          const prices = this.scannerService.currentPrices || {};
          await this.scannerService.walletManagerService.updateWalletSummary(this.scannerService.state.liveWalletState, prices);
          // CRITICAL ADDITION: Persist to localStorage for immediate UI pickup after batch open
          if (typeof this.scannerService._persistLatestWalletSummary === 'function') {
            await this.scannerService._persistLatestWalletSummary();
          }
        }
        if (this.scannerService.notifyWalletSubscribers) {
          this.scannerService.notifyWalletSubscribers();
        }
        
        return { opened: opened, failed: failed, errors: allErrors, insufficientBalance: skippedInsufficientFunds, detailedResults: res?.detailedResults || [] };
      } catch (error) {
        this.scannerService.addLog(`[BATCH_EXECUTE_TRADES] ❌ ${error?.message || String(error)}`, 'error');
        throw error;
      }
    }
}


(function installSafeOpenPositionValidate() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;

    const isNum = (v) => typeof v === "number" && isFinite(v);

    const normalizeSymbol = (sym) => (typeof sym === "string" ? sym.replace("/", "") : sym);

    const getExchangeFilters = (exchangeInfoMap, symbolNoSlash) => {
      try {
        const info = exchangeInfoMap?.[symbolNoSlash];
        const filters = info?.filters || {};
        const lot = filters?.LOT_SIZE || {};
        const minNotional = filters?.NOTIONAL || {};
        const stepSize = parseFloat(lot.stepSize ?? lot.min_qty ?? "0.00000001");
        const minQty = parseFloat(lot.minQty ?? lot.min_qty ?? "0");
        const maxQty = parseFloat(lot.maxQty ?? lot.max_qty ?? "999999999");
        const minNotionalVal = parseFloat(minNotional.minNotional ?? minNotional.min_notional ?? "0");
        return { stepSize: isFinite(stepSize) && stepSize > 0 ? stepSize : 0.00000001, minQty: isFinite(minQty) ? minQty : 0, maxQty: isFinite(maxQty) ? maxQty : 999999999, minNotional: isFinite(minNotionalVal) ? minNotionalVal : 0 };
      } catch (_e) {
        return { stepSize: 0.00000001, minQty: 0, maxQty: 999999999, minNotional: 0 };
      }
    };

    const roundToStep = (value, step) => {
      if (!isNum(value) || !isNum(step) || step <= 0) return null;
      const units = Math.floor(value / step);
      const res = units * step;
      return res === 0 ? 0 : res;
    };

    const applyExchangeConstraints = (qty, step, minQty, maxQty, price, minNotional) => {
      if (!isNum(qty)) return null;
      let q = qty;

      if (isNum(minQty) && q < minQty) q = minQty;
      if (isNum(maxQty) && q > maxQty) q = maxQty;

      if (isNum(step) && step > 0) {
        q = roundToStep(q, step);
      }
      if (!isNum(q) || q <= 0) return null;

      if (isNum(minNotional) && isNum(price) && minNotional > 0) {
        const notional = q * price;
        if (notional < minNotional) {
          const requiredQty = minNotional / price;
          q = roundToStep(requiredQty, step) || q;
        }
      }
      return q;
    };

    const resolveSymbol = (req) => {
      let sym = req?.symbol || req?.coin || req?.pair || req?.strategy_symbol || req?.combination?.coin || null;
      // eslint-disable-next-line no-unused-vars
      let derived = false;
      if ((!sym || typeof sym !== "string") && typeof req?.combinationName === "string") {
        const name = req.combinationName;
        if (name.includes("-Strategy")) {
          sym = name.split("-Strategy")[0];
          derived = true;
        } else if (name.endsWith("USDT") && name.length > 4) {
          sym = name;
          derived = true;
        }
      }
      return { sym, derived };
    };

    PositionManager.prototype.openPositionWithValidation = async function (req) {
      // eslint-disable-next-line no-unused-vars
      const start = performance.now();
      try {
        const { sym: derivedSymbol } = resolveSymbol(req);
        const symbol = derivedSymbol;
        const direction = req?.direction || req?.combination?.strategyDirection || "long";
        const sizeUSDT = req?.positionSizeUsdt ?? req?.sizeUSDT ?? req?.entry_value_usdt;
        const currentPrice = req?.currentPrice ?? req?.price ?? req?.entry_price;
        const combinationName = req?.combinationName || req?.combination?.combinationName || (symbol ? `${symbol}-Strategy` : "Unknown-Strategy");

        if (!symbol || !isNum(sizeUSDT) || !isNum(currentPrice) || currentPrice <= 0 || sizeUSDT <= 0) {
          const msg = `Invalid inputs for open validation (symbol/sizeUSDT/currentPrice)`;
          this.addLog(`[OPEN_VALIDATE.SAFE] invalid: ${msg}`, 'warning', { symbol, sizeUSDT, currentPrice });
          return { success: false, reason: "invalid_inputs", message: msg };
        }

        try {
          const strategies = this.scannerService?.state?.activeStrategies || [];
          const strategy = strategies.find((s) => s?.combinationName === combinationName);
          const timeframe = strategy?.timeframe || req?.timeframe || "unknown";

          const requiresAtr =
            (strategy && (isNum(strategy.stopLossAtrMultiplier) || isNum(strategy.takeProfitAtrMultiplier))) ||
            isNum(req?.stopLossAtrMultiplier) ||
            isNum(req?.takeProfitAtrMultiplier);

          const atrProvided = isNum(req?.atr_value) || isNum(req?.atrValue);

          if (requiresAtr && !atrProvided) {
            const detail = {
              symbol,
              timeframe,
              combinationName,
              requiresAtr,
              strategyHasMultipliers: {
                stopLossAtrMultiplier: strategy?.stopLossAtrMultiplier ?? null,
                takeProfitAtrMultiplier: strategy?.takeProfitAtrMultiplier ?? null
              },
              requestHasAtr: !!req?.atr_value || !!req?.atrValue
            };
            this.scannerService?.addLog?.(
              `[OPEN_ABORT] Missing ATR for ${symbol} (${timeframe}) in ${combinationName} - aborting to avoid emergency SL`,
              "error",
              detail
            );
            return { success: false, reason: "indicators_missing", message: "ATR missing in trade request; open aborted" };
          }
        } catch (preErr) {
          this.addLog(`[OPEN_VALIDATE.SAFE] preflight check warning: ${preErr?.message}`, 'warning');
        }

        const rawQty = sizeUSDT / currentPrice;
        const symbolNoSlash = normalizeSymbol(symbol);
        const exch = this.scannerService?.state?.exchangeInfo || {};
        const { stepSize, minQty, maxQty, minNotional } = getExchangeFilters(exch, symbolNoSlash);
        let qty = applyExchangeConstraints(rawQty, stepSize, minQty, maxQty, currentPrice, minNotional);

        if (!isNum(qty) || qty <= 0) {
          const msg = `Unable to compute valid quantity for ${symbol} (size ${sizeUSDT}, price ${currentPrice})`;
          this.addLog(`[OPEN_VALIDATE.SAFE] qty invalid: ${msg}`, 'warning', { symbol, sizeUSDT, currentPrice });
          return { success: false, reason: "invalid_quantity", message: msg };
        }

        const prepared = {
          symbol,
          strategy_name: combinationName,
          direction,
          entry_price: currentPrice,
          entry_value_usdt: sizeUSDT,
          quantity_crypto: qty,
          conviction_score: req?.convictionScore ?? null,
          conviction_breakdown: req?.convictionDetails ?? null,
          atr_value: req?.atr_value ?? req?.atrValue ?? null,
          stopLossAtrMultiplier: req?.stopLossAtrMultiplier ?? null,
          takeProfitAtrMultiplier: req?.takeProfitAtrMultiplier ?? null,
          klines: req?.klines ?? null,
          indicators: req?.indicators ?? null,
          timeframe: req?.timeframe ?? req?.combination?.timeframe ?? null,
        };

        // eslint-disable-next-line no-unused-vars
        const execStart = performance.now();
        const res = await this.executeTrade(prepared);
        // eslint-disable-next-line no-unused-vars
        const durationMs = Math.max(0, Math.round(performance.now() - execStart));

        return res;
      } catch (err) {
        this.addLog(`[OPEN_VALIDATE.SAFE] error: ${err?.message}`, 'error', { message: err?.message, stack: err?.stack });
        return { success: false, reason: "execution_error", message: err?.message || "Unknown error" };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const took = Math.max(0, Math.round(performance.now() - start));
      }
    };
    PositionManager.prototype.__openValidateSafeReplaced = true;
  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[OPEN_VALIDATE.SAFE] install failed: ${e?.message}`, 'error');
  }
})();


(function patchPositionManagerLogging() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) {
      return;
    }
    if (PositionManager.prototype.__loggingPatched) return;

    const wrap = (proto, method, makeWrapper) => {
      if (typeof proto[method] !== "function" || proto[`__${method}Patched`]) return;
      const original = proto[method];
      proto[method] = makeWrapper(original);
      proto[`__${method}Patched`] = true;
    };

    wrap(PositionManager.prototype, "batchExecuteTrades", (orig) => async function (tradeRequests) {
      // eslint-disable-next-line no-unused-vars
      const count = Array.isArray(tradeRequests) ? tradeRequests.length : 0;
      // eslint-disable-next-line no-unused-vars
      const mode = this?.scannerService?.getTradingMode?.() || this?.scannerService?.tradingMode || "unknown";

      // eslint-disable-next-line no-unused-vars
      const t0 = Date.now();
      try {
        const res = await orig.apply(this, [tradeRequests]);
        // eslint-disable-next-line no-unused-vars
        const openedCount = Array.isArray(res?.detailedResults) ? res.detailedResults.filter(r => r.success).length : (res?.opened ?? 0);
        // eslint-disable-next-line no-unused-vars
        const failedCount = res?.failed ?? 0;
        return res;
      } catch (e) {
        this.addLog(`[BATCH_EXECUTE_TRADES] error: ${e?.message}`, 'error', { message: e?.message, stack: e?.stack });
        throw e;
      }
    });

    wrap(PositionManager.prototype, "_executeDemoTrade", (orig) => async function (payload) {
      // eslint-disable-next-line no-unused-vars
      const symbol = payload?.symbol;
      // eslint-disable-next-line no-unused-vars
      const qty = payload?.quantity_crypto;
      // eslint-disable-next-line no-unused-vars
      const valueUSDT = payload?.entry_value_usdt;

      try {
        const res = await orig.apply(this, [payload]);
        return res;
      } catch (e) {
        this.addLog(`[EXEC_DEMO] error: ${e?.message}`, 'error', { symbol, message: e?.message, stack: e?.stack });
        throw e;
      }
    });

    wrap(PositionManager.prototype, "_executeRealTrade", (orig) => async function (payload) {
      // eslint-disable-next-line no-unused-vars
      const symbol = payload?.symbol;
      // eslint-disable-next-line no-unused-vars
      const qty = payload?.quantity_crypto;
      // eslint-disable-next-line no-unused-vars
      const valueUSDT = payload?.entry_value_usdt;
      // eslint-disable-next-line no-unused-vars
      const price = payload?.entry_price;

      try {
        const res = await orig.apply(this, [payload]);
        return res;
      } catch (e) {
        this.addLog(`[EXEC_REAL] error: ${e?.message}`, 'error', { symbol, message: e?.message, stack: e?.stack });
        throw e;
      }
    });

    PositionManager.prototype.__loggingPatched = true;
  } catch (err) {
    // eslint-disable-next-line no-undef
    this.addLog(`[Logging patch failed]: ${err?.message || err}`, 'warning');
  }
})();

(function patchPositionManagerNormalizationV2() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;

    const normalizeReq = (r) => {
      if (!r || typeof r !== "object") return r;
      const normalized = { ...r };

      if (normalized.positionSizeUsdt == null) {
        normalized.positionSizeUsdt =
          r.positionSizeUsdt ??
          r.entry_value_usdt ??
          r.sizeUSDT ??
          r.positionDetails?.positionSizeUSDT ??
          r.sizeUsdt ??
          null;
      }

      if (normalized.currentPrice == null) {
        normalized.currentPrice =
          r.currentPrice ??
          r.entry_price ??
          r.priceAtMatch ??
          r.price ??
          null;
      }

      if (normalized.quantityCrypto == null) {
        normalized.quantityCrypto =
          r.quantityCrypto ??
          r.quantity_crypto ??
          r.positionDetails?.quantityCrypto ??
          null;
      }

      if (!normalized.symbol) {
        normalized.symbol = r.symbol ?? r?.combination?.coin ?? null;
      }

      if (!normalized.direction) {
        normalized.direction = r.direction ?? r?.combination?.strategyDirection ?? null;
      }

      return normalized;
    };

    if (!PositionManager.prototype.__batchExecuteTradesPatchedV2) {
      const origBatch = PositionManager.prototype.batchExecuteTrades;
      if (typeof origBatch === "function") {
        PositionManager.prototype.batchExecuteTrades = async function (...args) {
          // eslint-disable-next-line no-unused-vars
          const count = Array.isArray(args[0]) ? args[0].length : 0;
          // eslint-disable-next-line no-unused-vars
          const mode = this?.scannerService?.getTradingMode?.() || "unknown";

          const normalizedRequests = Array.isArray(args[0])
            ? args[0].map(normalizeReq)
            : args[0];
            args[0] = normalizedRequests; // Update args with normalized requests


          // eslint-disable-next-line no-unused-vars
          let missingCount = 0;
          if (Array.isArray(normalizedRequests)) {
            for (const r of normalizedRequests) {
              if (
                r == null ||
                r.positionSizeUsdt == null ||
                r.currentPrice == null ||
                r.symbol == null ||
                r.direction == null
              ) {
                missingCount++;
              }
            }
          }
          if (missingCount > 0) {
            this.addLog(`[BATCH_EXECUTE_TRADES.V2] requests missing critical fields after normalization: missing ${missingCount} of ${count}`, 'warning');
          }

          // eslint-disable-next-line no-unused-vars
          const t0 = Date.now();
          try {
            const res = await origBatch.apply(this, args);
            // eslint-disable-next-line no-unused-vars
            const openedCount = Array.isArray(res?.detailedResults) ? res.detailedResults.filter(r => r.success).length : (res?.opened ?? 0);
            // eslint-disable-next-line no-unused-vars
            const failedCount = res?.failed ?? 0;
            return res;
          } catch (e) {
            this.addLog(`[BATCH_EXECUTE_TRADES.V2] error: ${e?.message}`, 'error', { message: e?.message, stack: e?.stack });
            throw e;
          }
        };
        PositionManager.prototype.__batchExecuteTradesPatchedV2 = true;
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[Failed to apply normalization patch V2]: ${e.message}`, 'error');
  }
})();

(function patchPositionManagerDeepLogs_Extended() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;

    if (!PositionManager.prototype.__batchExecDeepDiag2) {
      const origBatchExec = PositionManager.prototype.batchExecuteTrades;
      if (typeof origBatchExec === "function") {
        PositionManager.prototype.batchExecuteTrades = async function (...args) {
          // eslint-disable-next-line no-unused-vars
          const mode = (this?.scannerService?.getTradingMode && this.scannerService.getTradingMode()) || 'unknown';
          // eslint-disable-next-line no-unused-vars
          const openBatchType = typeof this.openPositionsBatch;
          // eslint-disable-next-line no-unused-vars
          const openBatchName = this.openBatch && this.openBatch.name;

          // eslint-disable-next-line no-unused-vars
          const t0 = Date.now();
          try {
            const res = await origBatchExec.apply(this, args);
            // eslint-disable-next-line no-unused-vars
            const durationMs = Date.now() - t0;
            // eslint-disable-next-line no-unused-vars
            const opened = Array.isArray(res?.detailedResults) ? res.detailedResults.filter(d => d.success).length : (res?.opened ?? 0);
            // eslint-disable-next-line no-unused-vars
            const attempted = res?.attempted ?? (Array.isArray(res?.results) ? res.results.length : undefined);
            return res;
          } catch (e) {
            this.addLog(`[BATCH_EXECUTE_TRADES.DIAG] error: ${e?.message}`, 'error', { message: e?.message, stack: e?.stack });
            throw e;
          }
        };
        PositionManager.prototype.__batchExecDeepDiag2 = true;
      }
    }

  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[Logging patch failed - deep extended]: ${e?.message}`, 'warning');
  }
})();

(function forceDelegateBatchExecToOpenBatch() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;
    if (PositionManager.prototype.__forceBatchExecPatched) return;

    const origBatchExec = PositionManager.prototype.batchExecuteTrades;

    const normalizeOne = (r) => {
      const combo = r?.combination || {
        coin: r?.symbol || r?.pair || null,
        strategyDirection: r?.direction || 'long',
        combinationName: r?.combinationName || r?.strategy || (r?.symbol ? `${r.symbol}-Strategy` : 'Unknown'),
        timeframe: r?.timeframe || null,
        stopLossAtrMultiplier: r?.stopLossAtrMultiplier || null,
        takeProfitAtrMultiplier: r?.takeProfitAtrMultiplier || null,
        enableTrailingTakeProfit: r?.enableTrailingTakeProfit !== false,
        signals: r?.signals || [],
        combinedStrength: r?.combinedStrength || null,
        estimatedExitTimeMinutes: r?.estimatedExitTimeMinutes || null,
      };
      const currentPrice = r?.currentPrice ?? r?.entry_price ?? r?.price ?? null;
      const positionSizeUsdt = r?.positionSizeUsdt ?? r?.entry_value_usdt ?? r?.sizeUSDT ?? null;
      const convictionScore = r?.convictionScore ?? r?.conviction ?? null;
      // eslint-disable-next-line no-unused-vars
      const convictionDetails = r?.convictionDetails ?? r?.conviction_breakdown ?? null;

      const otherFields = {};
      if (r?.takeProfitPrice !== undefined) otherFields.takeProfitPrice = r.takeProfitPrice; // This will be overwritten by _calculateTradeExecutionParameters
      if (r?.stopLossPrice !== undefined) otherFields.stopLossPrice = r.stopLossPrice; // This will be overwritten by _calculateTradeExecutionParameters
      if (r?.atr_value !== undefined) otherFields.atr_value = r.atr_value;
      if (r?.klines !== undefined) otherFields.klines = r.klines;
      if (r?.indicators !== undefined) otherFields.indicators = r.indicators;


      return {
          combination: combo,
          currentPrice,
          convictionScore,
          positionSizeUsdt,
          ...otherFields
        };
    };

    PositionManager.prototype.batchExecuteTrades = async function(tradeRequests = []) {
      // eslint-disable-next-line no-unused-vars
      const mode = (this?.scannerService?.getTradingMode && this.scannerService.getTradingMode()) || "unknown";

      const normalized = Array.isArray(tradeRequests) ? tradeRequests.map(normalizeOne) : [];
      const valid = normalized.filter(req => req?.combination?.coin && req?.currentPrice != null);

      if (!valid.length) {
        this.addLog("[FORCE_OPEN_BATCH] no valid requests after normalization - falling back to original impl", 'warning');
        if (typeof origBatchExec === "function") {
          return await origBatchExec.apply(this, [tradeRequests]);
        }
        return { opened: 0, failed: 0, errors: [], detailedResults: [] };
      }

      if (typeof this.openPositionsBatch !== "function") {
        this.addLog("[FORCE_OPEN_BATCH] openPositionsBatch missing on instance - falling back to original impl", 'warning');
        if (typeof origBatchExec === "function") {
          return await origBatchExec.apply(this, [tradeRequests]);
        }
        return { opened: 0, failed: 0, errors: [], detailedResults: [] };
      }

      // eslint-disable-next-line no-unused-vars
      const t0 = Date.now();
      try {
        const res = await this.openPositionsBatch(valid);
        const openedCount = res?.opened ?? 0;
        const failedTotal = res?.failed ?? 0; // openPositionsBatch now returns combined failed count
        const skippedInsufficientFunds = res?.skippedInsufficientFunds ?? 0;

        return {
          opened: openedCount,
          failed: failedTotal, 
          errors: res?.errors || [],
          insufficientBalance: skippedInsufficientFunds,
          detailedResults: res?.detailedResults || []
        };
      } catch (e) {
        this.addLog(`[FORCE_OPEN_BATCH] error delegating to openPositionsBatch: ${e?.message}`, 'error', {
          message: e?.message,
          stack: e?.stack
        });
        if (typeof origBatchExec === "function") {
          return await origBatchExec.apply(this, [tradeRequests]);
        }
        return { opened: 0, failed: 0, errors: [], detailedResults: [] };
      }
    };

    PositionManager.prototype.__forceBatchExecPatched = true;
  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[FORCE_OPEN_BATCH] patch failed: ${e?.message}`, 'error');
  }
})();


(function installPositionManagerDeepTracing() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;
    if (PositionManager.prototype.__deepTracingPatched) return;

    const patchMethod = (proto, name, pickFields) => {
      const original = proto[name];
      if (typeof original !== "function" || proto[`__${name}Patched`]) return;

      proto[name] = function (...args) {
        try {
          // eslint-disable-next-line no-unused-vars
          const arg0 = args && args.length ? args[0] : undefined;
          // eslint-disable-next-line no-unused-vars
          const picked = pickFields ? pickFields(arg0, ...args.slice(1)) : arg0;

          const res = original.apply(this, args);

          if (res && typeof res.then === "function") {
            return res.then((out) => {
              return out;
            }).catch((err) => {
              // Logging removed from deep tracing.
              throw err;
            });
          }

          return res;
        } catch (err) {
          // Logging removed from deep tracing.
          throw err;
        }
      };
      proto[`__${name}Patched`] = true;
    };

    const pickPrepareTrade = (arg) => {
      if (!arg || typeof arg !== 'object') return arg;
      return {
        symbol: arg.symbol,
        direction: arg.direction,
        entry_price: arg.entry_price ?? arg.currentPrice,
        entry_value_usdt: arg.entry_value_usdt ?? arg.positionSizeUsdt,
        quantity_crypto: arg.quantity_crypto,
        stop_loss_price: arg.stop_loss_price,
        take_profit_price: arg.take_profit_price,
        atr_value: arg.atr_value,
        conviction_score: arg.conviction_score,
        klines_len: arg.klines?.length ?? 0,
        indicators_len: Object.keys(arg.indicators ?? {}).length,
        timeframe: arg.timeframe
      };
    };

    const pickExecParams = (arg) => {
      if (!arg || typeof arg !== 'object') return arg;
      return {
        symbol: arg.symbol,
        direction: arg.direction,
        entry_price: arg.entry_price,
        sizeUSDT: arg.positionSizeUsdt ?? arg.entry_value_usdt,
        currentPrice: arg.currentPrice,
        regime: arg.market_regime,
        regime_confidence: arg.regime_confidence,
        klines_len: arg.klines?.length ?? 0,
        indicators_len: Object.keys(arg.indicators ?? {}).length,
        timeframe: arg.timeframe
      };
    };

    // eslint-disable-next-line no-unused-vars
    const pickFormatPrice = (price, symbol) => ({ price, symbol });
    const pickFormatQuantity = (symbol, quantity, currentPrice) => ({ quantity, symbol, currentPrice }); // Updated here

    patchMethod(PositionManager.prototype, 'validateAndPrepareTrade', pickPrepareTrade);
    patchMethod(PositionManager.prototype, '_calculateTradeExecutionParameters', pickExecParams);
    patchMethod(PositionManager.prototype, '_executeDemoTrade', pickPrepareTrade);
    patchMethod(PositionManager.prototype, '_executeRealTrade', pickPrepareTrade);
    patchMethod(PositionManager.prototype, '_formatPriceForExchange', pickFormatPrice);
    patchMethod(PositionManager.prototype, 'formatQuantityForSymbol', pickFormatQuantity); // Updated here

    PositionManager.prototype.__deepTracingPatched = true;
  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[TRACE] Failed to apply deep tracing patch: ${e?.message}`, 'error', {
      message: e?.message,
      stack: e?.stack
    });
  }
})();

(function enhanceValidationErrorDiagnostics() {
  try {
    if (typeof PositionManager !== "function" || !PositionManager.prototype) return;
    if (PositionManager.prototype.__enhancedValidationErrorLogs) return;

    const wrapWithProbe = (methodName) => {
      if (typeof PositionManager.prototype[methodName] !== "function" || PositionManager.prototype.__openValidateSafeReplaced) return;

      const original = PositionManager.prototype[methodName];

      PositionManager.prototype[methodName] = async function (...args) {
        const arg0 = args && args.length ? args[0] : null;

        // eslint-disable-next-line no-unused-vars
        const sizeUSDT = arg0?.positionSizeUsdt ?? arg0?.sizeUSDT ?? arg0?.entry_value_usdt ?? null;
        // eslint-disable-next-line no-unused-vars
        const currentPrice = arg0?.currentPrice ?? arg0?.price ?? arg0?.entry_price ?? null;
        // eslint-disable-next-line no-unused-vars
        const stopLoss = arg0?.stop_loss_price ?? arg0?.stopLossPrice ?? null;
        // eslint-disable-next-line no-unused-vars
        const takeProfit = arg0?.take_profit_price ?? arg0?.takeProfitPrice ?? null;
        // eslint-disable-next-line no-unused-vars
        const atrValue = arg0?.atr_value ?? null;
        // eslint-disable-next-line no-unused-vars
        const klinesLen = arg0?.klines?.length ?? 0;
        // eslint-disable-next-line no-unused-vars
        const indicatorsKeysLen = Object.keys(arg0?.indicators ?? {}).length;
        // eslint-disable-next-line no-unused-vars
        const timeframe = arg0?.timeframe ?? null;

        // eslint-disable-next-line no-unused-vars
        let qtyCandidate = null;
        if (typeof sizeUSDT === "number" && typeof currentPrice === "number" && isFinite(currentPrice) && currentPrice > 0) {
          qtyCandidate = sizeUSDT / currentPrice;
        }

        try {
          return await original.apply(this, args);
        } catch (err) {
          // Logging removed from enhanced error diagnostics.
          throw err;
        }
      };
    };

    wrapWithProbe("validateAndPrepareTrade");

    PositionManager.prototype.__enhancedValidationErrorLogs = true;
  } catch (e) {
    // eslint-disable-next-line no-undef
    this.addLog(`[TRACE] Enhance diagnostics failed: ${e?.message}`, 'error', {
      message: e?.message,
      stack: e?.stack
    });
  }
})();
