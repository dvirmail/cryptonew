
import { queueEntityCall, queueFunctionCall } from '@/components/utils/apiQueue';
import { positionSizeValidator } from '@/components/utils/positionSizeValidator'; // Corrected import to named export
import { defaultSignalSettings } from '@/components/utils/signalSettings';
import { calculateATR as unifiedCalculateATR } from '@/components/utils/atrUnified';
import { addHours } from "date-fns";
import { debounce } from 'lodash';
import { liveTradingAPI } from '@/api/functions';
import { Trade, LivePosition } from '@/api/entities';
import { updatePerformanceSnapshot } from '@/api/functions';
import { getBinancePrices } from '@/api/functions';
import { generateTradeId } from '@/components/utils/id';
import * as dynamicSizing from "@/components/utils/dynamicPositionSizing";
import { reconcileWalletState, walletReconciliation, purgeGhostPositions } from '@/api/functions';
import PendingOrderManager from './PendingOrderManager';


// DUST MANAGEMENT SYSTEM - Original App Implementation
// Dust Ledger: In-memory Map to track dust instances
const dustLedger = new Map();

// Helper function to get dust ledger key
function getDustKey(symbol, mode) {
  return `${mode}:${symbol}`;
}

// Helper function to get dust ledger snapshot
function getDustLedgerSnapshot() {
  const snapshot = {};
  for (const [key, value] of dustLedger.entries()) {
    snapshot[key] = value;
  }
  return snapshot;
}

// Helper function to floor quantity to step size (from original app)
function floorToStep(qty, stepSize) {
  if (!Number.isFinite(qty) || !Number.isFinite(stepSize) || stepSize <= 0) return 0;
  const stepSizeStr = String(stepSize);
  const decimalPointIndex = stepSizeStr.indexOf('.');
  const precision = decimalPointIndex === -1 ? 0 : stepSizeStr.length - decimalPointIndex - 1;
  const floored = Math.floor((qty / stepSize) + 1e-9) * stepSize; // 1e-9 is epsilon for floating-point safety
  return Number(floored.toFixed(precision));
}

// Attempt dust conversion via Binance API
async function attemptDustConvert(tradingMode, proxyUrl) {
  try {
    console.log('[DUST_CONVERT] Attempting dust conversion...');
    
    const response = await fetch(`${proxyUrl}/api/binance/dustConvert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tradingMode })
    });
    
    const data = await response.json();
    console.log('[DUST_CONVERT_RESULT]', { ok: response.ok, status: response.status, data });
    
    return { ok: response.ok, data, error: data.error };
  } catch (error) {
    console.error('[DUST_CONVERT] Error:', error);
    return { ok: false, error: error.message };
  }
}


// NEW: helper to fetch fresh free balance for a base asset from Binance account info
async function fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl }) {
  const resp = await queueFunctionCall(
    'liveTradingAPI',
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

        // Exchange info accessor - CRITICAL FIX
        this.getExchangeInfo = (symbol) => {
            const exchangeInfo = this.scannerService?.state?.exchangeInfo;
            if (!exchangeInfo) {
                console.log('[PositionManager] ⚠️ No exchange info available in scanner service');
                return null;
            }
            const symbolInfo = exchangeInfo[symbol];
            if (!symbolInfo) {
                console.log(`[PositionManager] ⚠️ No exchange info found for symbol: ${symbol}`);
                console.log(`[PositionManager] Available symbols:`, Object.keys(exchangeInfo).slice(0, 10));
            }
            return symbolInfo || null;
        };

        // Batch queues
        this.openQueue = []; // Initialize openQueue
        this.closeQueue = [];
        
        // State tracking
        this.isProcessingQueue = false;
        this.lastWalletSave = 0; // New timestamp for last save
        this.walletSavePromise = null; // Initialize with null as per outline
        
        // Duplicate trade prevention
        this.processedTradeIds = new Set();

        // Order monitoring system - initialize after scannerService is ready
        this.pendingOrderManager = null;

        // Exchange info storage (as per specification)
        this.exchangeInfo = null;
        this.symbolFilters = new Map(); // Fast lookup map: symbol -> filters
        this.exchangeInfoLoaded = false;

        // Make cleanup function available globally for debugging
        if (typeof window !== 'undefined') {
            window.cleanupGhostPositions = () => this.reconcileWithBinance();
            window.fetchPricesAndUpdatePositions = () => this.fetchPricesAndUpdatePositions();
            window.aggressiveGhostCleanup = () => this.aggressiveGhostCleanup();
            window.testPositionClosing = () => this.testPositionClosing();
            window.deleteAllGhostPositions = () => this.deleteAllGhostPositions();
            window.fixPositionPriceData = () => this.fixPositionPriceData();
            window.clearAllPositions = async () => {
                console.log('🧹 [CLEAR_POSITIONS] Starting comprehensive position cleanup...');
                
                // 1. Clear from memory
                console.log('🧹 [CLEAR_POSITIONS] Step 1: Clearing positions from memory...');
                const memoryCount = this.positions.length;
                this.positions = [];
                this.processedTradeIds = new Set();
                console.log(`✅ [CLEAR_POSITIONS] Cleared ${memoryCount} positions from memory`);
                
                // 2. Clear from database via API
                console.log('🧹 [CLEAR_POSITIONS] Step 2: Clearing positions from database...');
                try {
                    const tradingMode = this.getTradingMode();
                    const proxyUrl = this.scannerService.state?.settings?.local_proxy_url || 'http://localhost:3003';
                    
                    // Delete all positions from database
                    const deleteResponse = await fetch(`${proxyUrl}/api/livePositions`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tradingMode, deleteAll: true })
                    });
                    
                    if (deleteResponse.ok) {
                        const result = await deleteResponse.json();
                        console.log(`✅ [CLEAR_POSITIONS] Database cleanup: ${result.deleted || 0} positions deleted`);
                    } else {
                        console.warn('⚠️ [CLEAR_POSITIONS] Database cleanup failed:', deleteResponse.status);
                    }
                } catch (error) {
                    console.warn('⚠️ [CLEAR_POSITIONS] Database cleanup error:', error.message);
                }
                
                // 3. Clear from local storage
                console.log('🧹 [CLEAR_POSITIONS] Step 3: Clearing positions from localStorage...');
                try {
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && (
                            key.toLowerCase().includes('position') || 
                            key.toLowerCase().includes('liveposition')
                        )) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(key => localStorage.removeItem(key));
                    console.log(`✅ [CLEAR_POSITIONS] Cleared ${keysToRemove.length} localStorage keys`);
                } catch (error) {
                    console.warn('⚠️ [CLEAR_POSITIONS] localStorage cleanup error:', error.message);
                }
                
                // 4. Clear from wallet state if available
                console.log('🧹 [CLEAR_POSITIONS] Step 4: Clearing positions from wallet state...');
                try {
                    if (this.scannerService && this.scannerService._getCurrentWalletState) {
                        const walletState = this.scannerService._getCurrentWalletState();
                        if (walletState) {
                            walletState.positions = [];
                            walletState.live_position_ids = [];
                            walletState.open_positions_count = 0;
                            console.log('✅ [CLEAR_POSITIONS] Cleared positions from wallet state');
                        }
                    }
                } catch (error) {
                    console.warn('⚠️ [CLEAR_POSITIONS] Wallet state cleanup error:', error.message);
                }
                
                console.log('✅ [CLEAR_POSITIONS] Comprehensive position cleanup complete!');
                console.log('💡 You may need to refresh the page to see changes');
                
                this.addLog('[CLEAR_POSITIONS] ✅ All positions cleared from memory, database, and storage', 'success');
            };
            window.runComprehensiveWalletFix = async () => {
                const { comprehensiveWalletFix } = await import('./ComprehensiveWalletFix');
                return await comprehensiveWalletFix.runComprehensiveFix('testnet');
            };
            window.testPriceAPI = async () => {
                try {
                    const response = await fetch('http://localhost:3003/api/binance/ticker/price?symbol=BTCUSDT&tradingMode=testnet');
                    const data = await response.json();
                    console.log('Price API test result:', data);
                    return data;
                } catch (error) {
                    console.error('Price API test failed:', error);
                    return { success: false, error: error.message };
                }
            };
        }

        // CRITICAL: Assign positionSizeValidator to instance
        // Use our updated dynamic position sizing system instead of the old validator
        this.positionSizeValidator = {
            calculate: (params) => {
                // console.log('[POSITION_MANAGER] 🔄 Routing to updated dynamicPositionSizing system');
                
                // Convert old parameter format to new format
                const sizingOptions = {
                    strategySettings: {
                        useWinStrategySize: params.useWinStrategySize !== false,
                        defaultPositionSize: params.defaultPositionSize || 100,
                        riskPerTrade: params.riskPercentage || 2,
                        minimumTradeValue: params.minimumTradeValue || 10,
                        minimumConvictionScore: 50 // Default minimum conviction
                    },
                    currentPrice: params.currentPrice,
                    convictionScore: params.convictionScore,
                    availableCash: params.balance,
                    totalWalletBalance: params.balance, // Use balance as total for now
                    balanceInTrades: 0, // Assume no current trades
                    indicators: {
                        atr: params.atr
                    },
                    exchangeInfo: params.exchangeInfo,
                    symbol: params.symbol || 'UNKNOWN'
                };

                const result = dynamicSizing.calculatePositionSize(sizingOptions);
                
                // Convert new result format to old format for compatibility
                if (!result.isValid) {
                    return {
                        isValid: false,
                        reason: result.reason,
                        message: result.message,
                        details: result.message,
                        positionSizeUSDT: undefined
                    };
                }

                return {
                    isValid: true,
                    positionSizeUSDT: result.positionSize,
                    calculationMethod: result.calculationMethod,
                    calculationDetails: {
                        positionSize: result.positionSize,
                        quantityCrypto: result.quantityCrypto,
                        riskAmount: result.riskAmount,
                        convictionMultiplier: result.convictionMultiplier,
                        appliedFilters: result.appliedFilters
                    }
                };
            }
        };
        
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

        // New properties for central wallet state persistence (CentralWalletState)
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

    // Helper: get current wallet state (CentralWalletStateManager first, fallback to old system)
    _getCurrentWalletState() {
        return this.scannerService.walletManagerService?.getCurrentWalletState() || this._getCurrentWalletState();
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

    getTradingMode() {
        return this.tradingMode;
    }

    isTestnetMode() {
        return this.tradingMode === 'testnet';
    }

    /**
     * Initialize the PositionManager and load exchange info
     * Called from AutoScannerService.initialize() during Phase 1 of scanner startup
     */
    async initialize() {
        this.addLog('[POSITION_MANAGER] Initializing...', 'system');
        
        // Load exchange info immediately on initialization
        await this.loadExchangeInfo();
        
        this.addLog('[POSITION_MANAGER] Initialized successfully', 'system');
    }

    /**
     * Load exchange info from Binance API and create fast lookup maps
     * Called during initialization and trading mode changes
     */
    async loadExchangeInfo() {
        try {
            this.addLog('[EXCHANGE_INFO] Loading trading rules from scanner service...', 'system');
            
            // Use the scanner service's processed exchange info (it's already a map)
            const exchangeInfoMap = this.scannerService?.state?.exchangeInfo;
            
            if (!exchangeInfoMap || typeof exchangeInfoMap !== 'object') {
                throw new Error('No exchange info available from scanner service');
            }
            
            // Store the full exchange info
            this.exchangeInfo = exchangeInfoMap;
            
            // Create a fast lookup map: symbol -> filters
            this.symbolFilters.clear();
            
            // The exchangeInfoMap is already processed, so we need to reconstruct the symbol data
            for (const [symbol, symbolInfo] of Object.entries(exchangeInfoMap)) {
                // Debug: Log the structure of symbolInfo to understand the format
                if (Object.keys(exchangeInfoMap).indexOf(symbol) < 3) { // Log first 3 symbols for debugging
                    console.log(`[PositionManager] 🔍 Symbol ${symbol} structure:`, {
                        symbol,
                        symbolInfo,
                        filtersType: typeof symbolInfo.filters,
                        filtersIsArray: Array.isArray(symbolInfo.filters),
                        filtersKeys: symbolInfo.filters ? Object.keys(symbolInfo.filters) : 'no filters'
                    });
                }
                
                // Ensure filters is an array
                const filtersArray = Array.isArray(symbolInfo.filters) ? symbolInfo.filters : [];
                
                this.symbolFilters.set(symbol, {
                    status: symbolInfo.status,
                    baseAsset: symbolInfo.baseAsset || symbol.split('USDT')[0], // Extract base asset from symbol
                    quoteAsset: symbolInfo.quoteAsset || 'USDT', // Most symbols are USDT pairs
                    filters: filtersArray,
                    // Pre-extract commonly used filters for fast access
                    lotSize: filtersArray.find(f => f.filterType === 'LOT_SIZE'),
                    minNotional: filtersArray.find(f => f.filterType === 'MIN_NOTIONAL'),
                    priceFilter: filtersArray.find(f => f.filterType === 'PRICE_FILTER')
                });
            }
            
            this.exchangeInfoLoaded = true;
            this.addLog(`[EXCHANGE_INFO] Loaded rules for ${this.symbolFilters.size} trading pairs`, 'success');
            
        } catch (error) {
            this.addLog(`[EXCHANGE_INFO_ERROR] ${error.message}`, 'error');
            
            // Critical error - cannot proceed without exchange info
            this.exchangeInfoLoaded = false;
            
            // Notify scanner service
            this.scannerService.state.error = 'EXCHANGE_INFO_LOAD_FAILED';
            this.scannerService.state.errorSource = 'PositionManager';
            
            // Throw to halt initialization
            throw new Error(`Failed to load exchange info: ${error.message}`);
        }
    }

    /**
     * Handle trading mode changes and reload exchange info
     * Called when user switches between testnet and live modes
     */
    async onTradingModeChange(newMode, previousMode) {
        this.addLog(`[MODE_CHANGE] Switching from ${previousMode} to ${newMode}`, 'system');
        
        // Re-load exchange info for the new mode
        await this.loadExchangeInfo();
        
        this.addLog(`[MODE_CHANGE] Exchange info reloaded for ${newMode} mode`, 'success');
    }

    /**
     * Returns the currently active wallet state based on the trading mode.
     * This method now returns the wallet state from CentralWalletStateManager.
     * @returns {CentralWalletState|object|null} The active wallet state object.
     */
    getActiveWalletState() {
        return this._getCurrentWalletState();
    }

    /**
     * Retrieves the current state of the managed wallet.
     * @returns {Object|null} The current wallet state.
     */
    getManagedState() {
        return this._getCurrentWalletState();
    }

    /**
     * Loads a provided CentralWalletState and its associated LivePosition entities.
     * This method is called by WalletManagerService.
     * @param {object} walletStateObj - The CentralWalletState object.
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
            console.log('[PositionManager] 🔍 Loading positions using LivePosition entity...');
            fetchedLivePositions = await LivePosition.filter({
                    wallet_id: actualWalletId,
                    trading_mode: resolvedMode
            });
            
            console.log('[PositionManager] 🔍 LivePosition.filter result:', {
                fetchedCount: fetchedLivePositions?.length || 0,
                walletId: actualWalletId,
                tradingMode: resolvedMode,
                queryParams: { wallet_id: actualWalletId, trading_mode: resolvedMode },
                fetchedPositions: fetchedLivePositions
            });

            if (!Array.isArray(fetchedLivePositions) || fetchedLivePositions.length === 0) {
                this.addLog('[PositionManager] ℹ️ No open positions found in database for this wallet/mode.', 'info');
                this.positions = [];
            } else {
                 this.addLog(`[PositionManager] ✅ Fetched ${fetchedLivePositions.length} LivePosition entities from DB for wallet ${actualWalletId}.`, 'success');

                fetchedLivePositions.forEach((pos) => {
                    // This block was empty, removed for clarity.
                });

                // CRITICAL FIX: Ensure both 'id' (database ID) and 'position_id' are preserved
                console.log('[PositionManager] 🔍 Fetched positions from database:', {
                    count: fetchedLivePositions.length,
                    samplePositions: fetchedLivePositions.slice(0, 3).map(p => ({
                        id: p.id,
                        position_id: p.position_id,
                        symbol: p.symbol,
                        strategy_name: p.strategy_name
                    }))
                });
                
                this.positions = fetchedLivePositions.map(dbPos => {
                    // Validate that we have the critical IDs
                    if (!dbPos.id) {
                        this.addLog(`[PositionManager] ⚠️ Position missing database ID: ${JSON.stringify(dbPos)}`, 'error');
                        console.log('[PositionManager] 🚨 Position missing ID details:', {
                            dbPos: dbPos,
                            hasId: !!dbPos.id,
                            hasPositionId: !!dbPos.position_id,
                            idValue: dbPos.id,
                            positionIdValue: dbPos.position_id
                        });
                    }
                    if (!dbPos.position_id) {
                        // Generate position_id if missing
                        dbPos.position_id = dbPos.id || `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        this.addLog(`[PositionManager] ⚠️ Generated missing position_id: ${dbPos.position_id}`, 'warning');
                    }

                    // ENHANCED: Validate and fix missing essential data
                    const mappedPos = {
                        id: dbPos.id, // Set the database ID as the primary id field
                        position_id: dbPos.position_id,
                        db_record_id: dbPos.id, // Store the actual database record ID
                        strategy_name: dbPos.strategy_name || 'Unknown Strategy',
                        symbol: dbPos.symbol || 'N/A',
                        direction: dbPos.direction || 'long',
                        entry_price: parseFloat(dbPos.entry_price) || 0,
                        quantity_crypto: parseFloat(dbPos.quantity_crypto) || 0,
                        entry_value_usdt: parseFloat(dbPos.entry_value_usdt) || 0,
                        entry_timestamp: dbPos.entry_timestamp || new Date().toISOString(),
                        status: dbPos.status || 'open',
                        stop_loss_price: parseFloat(dbPos.stop_loss_price) || 0,
                        take_profit_price: parseFloat(dbPos.take_profit_price) || 0,
                        is_trailing: dbPos.is_trailing || false,
                        trailing_stop_price: dbPos.trailing_stop_price,
                        trailing_peak_price: dbPos.trailing_peak_price,
                        peak_price: parseFloat(dbPos.peak_price) || parseFloat(dbPos.entry_price) || 0,
                        trough_price: parseFloat(dbPos.trough_price) || parseFloat(dbPos.entry_price) || 0,
                        time_exit_hours: parseFloat(dbPos.time_exit_hours) || 24,
                        trigger_signals: dbPos.trigger_signals || [],
                        combined_strength: dbPos.combined_strength,
                        conviction_score: dbPos.conviction_score,
                        conviction_breakdown: dbPos.conviction_breakdown,
                        conviction_multiplier: dbPos.conviction_multiplier,
                        market_regime: dbPos.market_regime,
                        regime_confidence: dbPos.regime_confidence,
                        atr_value: dbPos.atr_value,
                        is_event_driven_strategy: dbPos.is_event_driven_strategy || false,
                        fear_greed_score: dbPos.fear_greed_score,
                        fear_greed_classification: dbPos.fear_greed_classification,
                        lpm_score: dbPos.lpm_score,
                        wallet_allocation_percentage: dbPos.wallet_allocation_percentage,
                        binance_order_id: dbPos.binance_order_id,
                        wallet_id: dbPos.wallet_id, // IMPORTANT: Preserve wallet_id
                        trading_mode: dbPos.trading_mode, // IMPORTANT: Preserve trading_mode
                        created_date: dbPos.created_date || dbPos.entry_timestamp || new Date().toISOString(),
                        last_updated_timestamp: dbPos.last_updated_timestamp || new Date().toISOString()
                    };

                    // Log any data issues for debugging
                    if (!dbPos.symbol || !dbPos.strategy_name || !dbPos.quantity_crypto) {
                        console.log('[PositionManager] 🚨 Position with missing data:', {
                            id: dbPos.id,
                            position_id: dbPos.position_id,
                            symbol: dbPos.symbol,
                            strategy_name: dbPos.strategy_name,
                            quantity_crypto: dbPos.quantity_crypto,
                            entry_value_usdt: dbPos.entry_value_usdt,
                            original_data: dbPos
                        });
                    }
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

            // --- CRITICAL: Persist live_position_ids to CentralWalletState ---
            const currentLivePositionIds = this.positions.map(pos => pos.id).filter(id => id);
            
            if (actualWalletId) { // Use parameter `actualWalletId` here
                try {
                    await queueEntityCall('CentralWalletState', 'update', actualWalletId, {
                        live_position_ids: currentLivePositionIds,
                        last_updated_timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.addLog(`[PositionManager] ❌ Failed to persist live_position_ids for CentralWalletState ${actualWalletId}: ${error.message}`, 'error', error);
                }
            } else {
                this.addLog(`[PositionManager] ⚠️ Cannot persist live_position_ids: No valid CentralWalletState.id found (parameter actualWalletId is missing).`, 'warning');
            }

            // Also update the scannerService's in-memory wallet state for immediate consistency
            // Assuming this._getCurrentWalletState() is already loaded and is the target wallet
            if (this._getCurrentWalletState() && this._getCurrentWalletState().id === actualWalletId) {
                 this._getCurrentWalletState().live_position_ids = currentLivePositionIds;
                 // CRITICAL: Ensure the in-memory wallet state's 'positions' array reflects the current `this.positions` cache
                 this._getCurrentWalletState().positions = this.positions;
                 this._getCurrentWalletState().mode = resolvedMode; // Ensure in-memory mode is also updated
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
        
        // Fix any positions with zero quantity/value after loading
        if (this.positions.length > 0) {
            console.log('[PositionManager] 🔧 Checking for positions with zero quantity/value...');
            const fixResult = await this.fixZeroQuantityPositions();
            if (fixResult.fixed > 0) {
                console.log(`[PositionManager] ✅ Fixed ${fixResult.fixed} positions with zero quantity/value`);
                this.addLog(`[PositionManager] 🔧 Fixed ${fixResult.fixed} positions with zero quantity/value`, 'success');
            }
            if (fixResult.errors.length > 0) {
                console.log(`[PositionManager] ⚠️ ${fixResult.errors.length} positions could not be fixed`);
                this.addLog(`[PositionManager] ⚠️ ${fixResult.errors.length} positions could not be fixed`, 'warning');
            }
        }
    }

    /**
     * Initialize the order monitoring system
     * Called after scannerService is fully ready
     */
    initializeOrderMonitoring() {
        if (!this.pendingOrderManager) {
            this.pendingOrderManager = new PendingOrderManager(this.scannerService);
            console.log('[PositionManager] ✅ Order monitoring system initialized');
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
                "getAccountInfo",
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

            // Update the wallet state with new balances
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
     * Aggressive ghost cleanup that actually verifies deletions
     * This function will force-delete all ghost positions and verify they're gone
     */
    async aggressiveGhostCleanup() {
        console.log('[PositionManager] 🧹 AGGRESSIVE GHOST CLEANUP STARTED...');
        
        try {
            // 1. Get all positions from database
            const allPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            console.log(`[PositionManager] 🧹 Found ${allPositions?.length || 0} positions in database`);
            
            if (!allPositions || allPositions.length === 0) {
                console.log('[PositionManager] 🧹 No positions to clean up');
                return { success: true, message: 'No positions found' };
            }
            
            // 2. Get Binance balances
            const proxyUrl = this.scannerService?.state?.settings?.local_proxy_url || 'http://localhost:3003';
            const accountInfoResponse = await queueFunctionCall(
                'liveTradingAPI',
                liveTradingAPI,
                { action: 'getAccountInfo', tradingMode: this.getTradingMode(), proxyUrl: proxyUrl },
                'critical',
                null,
                0,
                120000
            );
            
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
            const binanceBalances = accountInfo?.balances || [];
            
            // 3. Create holdings map
            const binanceHoldingsMap = new Map();
            binanceBalances.forEach(balance => {
                const total = parseFloat(balance.free || '0') + parseFloat(balance.locked || '0');
                if (total > 0 && balance.asset !== 'USDT') {
                    binanceHoldingsMap.set(balance.asset, total);
                }
            });
            
            console.log(`[PositionManager] 🧹 Binance holdings:`, Object.fromEntries(binanceHoldingsMap));
            
            // 4. Identify ghost positions
            const ghostPositions = [];
            for (const position of allPositions) {
                const baseAsset = position.symbol.replace('/USDT', '').replace('USDT', '');
                const heldQuantity = binanceHoldingsMap.get(baseAsset) || 0;
                const minHeldRequired = position.quantity_crypto * 0.99;
                
                if (heldQuantity < minHeldRequired) {
                    console.log(`[PositionManager] 🧹 GHOST: ${position.symbol} (Expected: ${position.quantity_crypto}, Held: ${heldQuantity})`);
                    ghostPositions.push(position);
                }
            }
            
            console.log(`[PositionManager] 🧹 Found ${ghostPositions.length} ghost positions to delete`);
            
            // 5. Delete ghost positions one by one
            let deletedCount = 0;
            for (const position of ghostPositions) {
                try {
                    console.log(`[PositionManager] 🧹 Deleting ghost position: ${position.symbol} (ID: ${position.id})`);
                    await queueEntityCall('LivePosition', 'delete', position.id);
                    console.log(`[PositionManager] 🧹 ✅ Position ${position.id} deletion command sent`);
                    deletedCount++;
                } catch (error) {
                    if (error?.response?.status === 404) {
                        console.log(`[PositionManager] 🧹 ✅ Position ${position.id} already deleted (404)`);
                        deletedCount++;
                    } else {
                        console.error(`[PositionManager] 🧹 ❌ Error deleting position ${position.id}:`, error.message);
                    }
                }
            }
            
            // 6. Verify final state
            const remainingPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            console.log(`[PositionManager] 🧹 AGGRESSIVE CLEANUP COMPLETE:`);
            console.log(`[PositionManager] 🧹 - Ghost positions found: ${ghostPositions.length}`);
            console.log(`[PositionManager] 🧹 - Positions deleted: ${deletedCount}`);
            console.log(`[PositionManager] 🧹 - Positions remaining: ${remainingPositions?.length || 0}`);
            
            // 7. Reload managed state
            const walletState = this._getCurrentWalletState();
            if (walletState && walletState.id) {
                await this.loadManagedState(walletState);
                console.log(`[PositionManager] 🧹 Reloaded managed state`);
            }
            
            return {
                success: true,
                ghostPositionsFound: ghostPositions.length,
                positionsDeleted: deletedCount,
                positionsRemaining: remainingPositions?.length || 0
            };
            
        } catch (error) {
            console.error('[PositionManager] 🧹 ❌ Aggressive ghost cleanup failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Simple function to delete all ghost positions
     * This is a more direct approach that just deletes all positions
     */
    async deleteAllGhostPositions() {
        console.log('[PositionManager] 🗑️ DELETING ALL GHOST POSITIONS...');
        
        try {
            // 1. Get all positions from database
            const allPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            console.log(`[PositionManager] 🗑️ Found ${allPositions?.length || 0} positions to delete`);
            
            if (!allPositions || allPositions.length === 0) {
                console.log('[PositionManager] 🗑️ No positions to delete');
                return { success: true, message: 'No positions found' };
            }
            
            // 2. Delete all positions
            let deletedCount = 0;
            for (const position of allPositions) {
                try {
                    console.log(`[PositionManager] 🗑️ Deleting position: ${position.symbol} (ID: ${position.id})`);
                    await queueEntityCall('LivePosition', 'delete', position.id);
                    deletedCount++;
                } catch (error) {
                    if (error?.response?.status === 404) {
                        console.log(`[PositionManager] 🗑️ Position ${position.id} already deleted (404)`);
                        deletedCount++;
                    } else {
                        console.error(`[PositionManager] 🗑️ Error deleting position ${position.id}:`, error.message);
                    }
                }
            }
            
            // 3. Verify final state
            const remainingPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            console.log(`[PositionManager] 🗑️ DELETION COMPLETE:`);
            console.log(`[PositionManager] 🗑️ - Positions found: ${allPositions.length}`);
            console.log(`[PositionManager] 🗑️ - Deletion commands sent: ${deletedCount}`);
            console.log(`[PositionManager] 🗑️ - Positions remaining: ${remainingPositions?.length || 0}`);
            
            // 4. Reload managed state
            const walletState = this._getCurrentWalletState();
            if (walletState && walletState.id) {
                await this.loadManagedState(walletState);
                console.log(`[PositionManager] 🗑️ Reloaded managed state`);
            }
            
            return {
                success: true,
                positionsFound: allPositions.length,
                deletionCommandsSent: deletedCount,
                positionsRemaining: remainingPositions?.length || 0
            };
            
        } catch (error) {
            console.error('[PositionManager] 🗑️ ❌ Delete all ghost positions failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test function to debug position closing issues
     * This will run the full monitoring process with detailed logging
     */
    async testPositionClosing() {
        console.log('[PositionManager] 🧪 TESTING POSITION CLOSING PROCESS...');
        
        try {
            // 1. Check current positions
            console.log('[PositionManager] 🧪 Step 1: Checking current positions...');
            console.log('[PositionManager] 🧪 this.positions.length:', this.positions.length);
            
            if (this.positions.length > 0) {
                console.log('[PositionManager] 🧪 Sample positions:', this.positions.slice(0, 3).map(p => ({
                    symbol: p.symbol,
                    position_id: p.position_id,
                    quantity_crypto: p.quantity_crypto,
                    status: p.status
                })));
            }
            
            // 2. Run aggressive ghost cleanup first
            console.log('[PositionManager] 🧪 Step 2: Running aggressive ghost cleanup...');
            const cleanupResult = await this.aggressiveGhostCleanup();
            console.log('[PositionManager] 🧪 Cleanup result:', cleanupResult);
            
            // 3. Run position monitoring
            console.log('[PositionManager] 🧪 Step 3: Running position monitoring...');
            const monitorResult = await this.monitorAndClosePositions();
            console.log('[PositionManager] 🧪 Monitor result:', monitorResult);
            
            // 4. Check final state
            console.log('[PositionManager] 🧪 Step 4: Checking final state...');
            console.log('[PositionManager] 🧪 Final positions count:', this.positions.length);
            
            return {
                success: true,
                cleanupResult: cleanupResult,
                monitorResult: monitorResult,
                finalPositionsCount: this.positions.length
            };
            
        } catch (error) {
            console.error('[PositionManager] 🧪 Test failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Manual trigger to fetch prices and update positions
     * This is a debugging function to fix the currentPrice: NaN issue
     */
    async fetchPricesAndUpdatePositions() {
        console.log('[PositionManager] 🔧 Manual price fetch and position update triggered...');
        
        try {
            // 1. Get all open positions
            const openPositions = await queueEntityCall('LivePosition', 'filter', {
                status: ['open', 'trailing']
            });
            
            if (!openPositions || openPositions.length === 0) {
                console.log('[PositionManager] 🔧 No open positions found');
                return { success: true, message: 'No open positions to update' };
            }
            
            console.log(`[PositionManager] 🔧 Found ${openPositions.length} open positions`);
            
            // 2. Extract unique symbols
            const symbols = [...new Set(openPositions.map(pos => pos.symbol?.replace('/', '')))];
            console.log(`[PositionManager] 🔧 Symbols to fetch:`, symbols);
            
            // 3. Fetch prices using the same method as the scanner
            const { getBinancePrices } = await import('@/api/functions');
            const priceResponse = await getBinancePrices({ symbols });
            
            if (!priceResponse || !Array.isArray(priceResponse)) {
                throw new Error('Invalid price response from Binance API');
            }
            
            // 4. Create price map
            const priceMap = {};
            priceResponse.forEach(item => {
                if (item.symbol && typeof item.price === 'number' && item.price > 0) {
                    priceMap[item.symbol] = item.price;
                }
            });
            
            console.log(`[PositionManager] 🔧 Fetched ${Object.keys(priceMap).length} valid prices:`, priceMap);
            
            // 5. Update scanner's current prices
            if (this.scannerService) {
                this.scannerService.currentPrices = priceMap;
                this.scannerService.state.currentPrices = priceMap;
                console.log('[PositionManager] 🔧 Updated scanner service prices');
            }
            
            // 6. Trigger position monitoring
            console.log('[PositionManager] 🔧 Triggering position monitoring...');
            const monitorResult = await this.monitorAndClosePositions();
            
            return {
                success: true,
                positionsFound: openPositions.length,
                pricesFetched: Object.keys(priceMap).length,
                monitorResult: monitorResult
            };
            
        } catch (error) {
            console.error('[PositionManager] 🔧 Error in manual price fetch:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Fix price data issues for all positions
     */
    async fixPositionPriceData() {
        try {
            console.log('[PositionManager] 🔧 Fixing position price data...');
            
            // Import the robust price manager
            const { robustPriceManager } = await import('./RobustPriceManager');
            
            // Get all open positions
            const openPositions = this.positions.filter(p => 
                p.status === 'open' || p.status === 'trailing'
            );
            
            if (openPositions.length === 0) {
                console.log('[PositionManager] ✅ No open positions to fix prices for');
                return { success: true, fixed: 0 };
            }
            
            // Validate and fix position prices
            const result = await robustPriceManager.validateAndFixPositionPrices(openPositions);
            
            console.log(`[PositionManager] ✅ Fixed ${result.validPositions.length}/${openPositions.length} positions with valid prices`);
            
            if (result.invalidPositions.length > 0) {
                console.log(`[PositionManager] ⚠️ ${result.invalidPositions.length} positions still have invalid prices:`, 
                    result.invalidPositions.map(p => p.symbol));
            }
            
            // Update scanner service with fixed prices
            if (this.scannerService) {
                const priceMap = {};
                for (const position of result.validPositions) {
                    const cleanSymbol = position.symbol.replace('/', '');
                    priceMap[cleanSymbol] = position.current_price;
                }
                
                this.scannerService.currentPrices = priceMap;
                this.scannerService.state.currentPrices = priceMap;
                console.log('[PositionManager] 🔧 Updated scanner service with fixed prices');
            }
            
            return {
                success: true,
                fixed: result.validPositions.length,
                invalid: result.invalidPositions.length
            };
            
        } catch (error) {
            console.error('[PositionManager] ❌ Error fixing position price data:', error);
            return {
                success: false,
                error: error.message
            };
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
                const symbolNoSlash = (position.symbol || '').replace('/', '');
                const currentPrice = currentPrices[symbolNoSlash];
                
                if (currentPrice && typeof currentPrice === 'number' && currentPrice > 0) {
                    const unrealizedPnl = position.direction === 'long'
                        ? (currentPrice - position.entry_price) * position.quantity_crypto
                        : (position.entry_price - currentPrice) * position.quantity_crypto;
                    
                    totalUnrealized += unrealizedPnl;
                } else {
                    console.log(`[PositionManager] ⚠️ No current price for ${position.symbol} (${symbolNoSlash}) - P&L calculation skipped`);
                }
            }
        });

        console.log(`[PositionManager] 📊 Total Unrealized P&L: $${totalUnrealized.toFixed(2)} (${this.positions.length} positions)`);
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
     * Calculate exit time from strategy parameters
     * @param {Object} combination - BacktestCombination object
     * @param {number} currentPrice - Current market price
     * @returns {number} Exit time in hours
     */
    calculateExitTimeFromStrategy(combination, currentPrice) {
        console.log('[PositionManager] 🕐 Calculating exit time from strategy:', {
            combination: combination,
            currentPrice: currentPrice
        });
        
        try {
            // Get estimatedExitTimeMinutes from BacktestCombination
            const estimatedExitTimeMinutes = combination.estimatedExitTimeMinutes || combination.estimated_exit_time_minutes;
            
            if (estimatedExitTimeMinutes && typeof estimatedExitTimeMinutes === 'number' && estimatedExitTimeMinutes > 0) {
                // Convert minutes to hours
                const exitTimeHours = estimatedExitTimeMinutes / 60;
                console.log('[PositionManager] 🕐 Strategy exit time calculated:', {
                    estimatedExitTimeMinutes: estimatedExitTimeMinutes,
                    exitTimeHours: exitTimeHours,
                    source: 'BacktestCombination.estimatedExitTimeMinutes'
                });
                return exitTimeHours;
            } else {
                // Fallback to default if no strategy-specific exit time
                console.log('[PositionManager] ⚠️ No strategy exit time found, using default 24 hours');
                return 24; // Default 24 hours
            }
        } catch (error) {
            console.error('[PositionManager] ❌ Error calculating exit time from strategy:', error);
            return 24; // Default 24 hours on error
        }
    }

    /**
     * Calculate stop loss price using ATR multiplier from strategy
     * @param {Object} combination - BacktestCombination object
     * @param {number} currentPrice - Current market price
     * @param {number} atr - Current ATR value
     * @returns {number} Stop loss price
     */
    calculateStopLossPrice(combination, currentPrice, atr) {
        console.log('[PositionManager] 🎯 Calculating stop loss price:', {
            combination: combination,
            currentPrice: currentPrice,
            atr: atr,
            atrType: typeof atr,
            atrValid: atr && typeof atr === 'number' && !isNaN(atr) && atr > 0,
            atrPercentage: atr ? (atr / currentPrice) * 100 : 'N/A',
            atrSource: 'PositionManager.calculateStopLossPrice'
        });
        
        try {
            // Validate ATR value before using it
            if (!atr || typeof atr !== 'number' || isNaN(atr) || atr <= 0) {
                throw new Error(`Invalid ATR value: ${atr}. ATR must be a positive number.`);
            }
            
            // Check if ATR is realistic compared to current price
            if (atr > currentPrice * 0.1) { // ATR should not be more than 10% of current price
                console.warn('[PositionManager] ⚠️ ATR value seems unrealistic:', {
                    atr: atr,
                    currentPrice: currentPrice,
                    atrPercentage: (atr / currentPrice) * 100,
                    impact: 'ATR is more than 10% of current price - this may indicate corrupted data'
                });
                throw new Error(`ATR value ${atr} is unrealistic for current price ${currentPrice}. ATR should not exceed 10% of current price.`);
            }
            
            // Get stop loss ATR multiplier from BacktestCombination
            const stopLossAtrMultiplier = combination.stopLossAtrMultiplier || combination.stop_loss_atr_multiplier;
            const direction = combination.strategyDirection || combination.direction || 'long';
            
            if (stopLossAtrMultiplier && typeof stopLossAtrMultiplier === 'number') {
                // Calculate stop loss distance using ATR
                const stopLossDistance = atr * stopLossAtrMultiplier;
                
                let stopLossPrice;
                if (direction === 'long') {
                    stopLossPrice = currentPrice - stopLossDistance;
                } else {
                    stopLossPrice = currentPrice + stopLossDistance;
                }
                
                console.log('[PositionManager] 🎯 ATR-based stop loss calculated:', {
                    stopLossAtrMultiplier: stopLossAtrMultiplier,
                    stopLossDistance: stopLossDistance,
                    direction: direction,
                    stopLossPrice: stopLossPrice,
                    currentPrice: currentPrice,
                    atr: atr,
                    source: 'BacktestCombination.stopLossAtrMultiplier',
                    isRealistic: stopLossPrice > 0 && stopLossPrice < currentPrice * 10 && stopLossPrice > currentPrice * 0.1,
                    calculation: `${currentPrice} ${direction === 'long' ? '-' : '+'} (${atr} * ${stopLossAtrMultiplier}) = ${stopLossPrice}`,
                    atrAsPercentOfPrice: ((atr / currentPrice) * 100).toFixed(2) + '%',
                    stopLossAsPercentOfPrice: ((Math.abs(stopLossPrice - currentPrice) / currentPrice) * 100).toFixed(2) + '%'
                });
                
                // Safety check: ensure stop loss price is realistic
                if (stopLossPrice <= 0 || stopLossPrice > currentPrice * 10 || stopLossPrice < currentPrice * 0.1) {
                    console.warn('[PositionManager] ⚠️ WARNING: Unrealistic stop loss price calculated:', {
                        stopLossPrice: stopLossPrice,
                        currentPrice: currentPrice,
                        stopLossAtrMultiplier: stopLossAtrMultiplier,
                        atr: atr,
                        stopLossDistance: stopLossDistance,
                        impact: 'SL/TP values are not logical - check ATR data and multipliers'
                    });
                    
                    // Don't fallback - just warn and continue with the calculated value
                    // The position will be opened with the calculated values, but the warning indicates data issues
                }
                
                return stopLossPrice;
            } else {
                // No fallback - ATR is required
                console.error('[PositionManager] ❌ CRITICAL: Cannot calculate stop loss - ATR data missing:', {
                    combination: combination,
                    currentPrice: currentPrice,
                    atr: atr,
                    stopLossAtrMultiplier: stopLossAtrMultiplier,
                    reason: 'ATR-based stop loss calculation requires valid ATR data and multiplier',
                    impact: 'Position cannot be opened without proper risk management'
                });
                throw new Error('ATR data required for stop loss calculation');
            }
        } catch (error) {
            console.error('[PositionManager] ❌ CRITICAL: Stop loss calculation failed:', error);
            throw error; // Re-throw to prevent position opening without proper risk management
        }
    }

    /**
     * Calculate take profit price using ATR multiplier from strategy
     * @param {Object} combination - BacktestCombination object
     * @param {number} currentPrice - Current market price
     * @param {number} atr - Current ATR value
     * @returns {number} Take profit price
     */
    calculateTakeProfitPrice(combination, currentPrice, atr) {
        console.log('[PositionManager] 🎯 Calculating take profit price:', {
            combination: combination,
            currentPrice: currentPrice,
            atr: atr,
            atrType: typeof atr,
            atrValid: atr && typeof atr === 'number' && !isNaN(atr) && atr > 0,
            atrPercentage: atr ? (atr / currentPrice) * 100 : 'N/A',
            atrSource: 'PositionManager.calculateTakeProfitPrice'
        });
        
        try {
            // Validate ATR value before using it
            if (!atr || typeof atr !== 'number' || isNaN(atr) || atr <= 0) {
                throw new Error(`Invalid ATR value: ${atr}. ATR must be a positive number.`);
            }
            
            // Check if ATR is realistic compared to current price
            if (atr > currentPrice * 0.1) { // ATR should not be more than 10% of current price
                console.warn('[PositionManager] ⚠️ ATR value seems unrealistic:', {
                    atr: atr,
                    currentPrice: currentPrice,
                    atrPercentage: (atr / currentPrice) * 100,
                    impact: 'ATR is more than 10% of current price - this may indicate corrupted data'
                });
                throw new Error(`ATR value ${atr} is unrealistic for current price ${currentPrice}. ATR should not exceed 10% of current price.`);
            }
            
            // Get take profit ATR multiplier from BacktestCombination
            const takeProfitAtrMultiplier = combination.takeProfitAtrMultiplier || combination.take_profit_atr_multiplier;
            const direction = combination.strategyDirection || combination.direction || 'long';
            
            if (takeProfitAtrMultiplier && typeof takeProfitAtrMultiplier === 'number') {
                // Calculate take profit distance using ATR
                const takeProfitDistance = atr * takeProfitAtrMultiplier;
                
                let takeProfitPrice;
                if (direction === 'long') {
                    takeProfitPrice = currentPrice + takeProfitDistance;
                } else {
                    takeProfitPrice = currentPrice - takeProfitDistance;
                }
                
                console.log('[PositionManager] 🎯 ATR-based take profit calculated:', {
                    takeProfitAtrMultiplier: takeProfitAtrMultiplier,
                    takeProfitDistance: takeProfitDistance,
                    direction: direction,
                    takeProfitPrice: takeProfitPrice,
                    currentPrice: currentPrice,
                    atr: atr,
                    source: 'BacktestCombination.takeProfitAtrMultiplier',
                    isRealistic: takeProfitPrice > 0 && takeProfitPrice < currentPrice * 10 && takeProfitPrice > currentPrice * 0.1,
                    calculation: `${currentPrice} ${direction === 'long' ? '+' : '-'} (${atr} * ${takeProfitAtrMultiplier}) = ${takeProfitPrice}`,
                    atrAsPercentOfPrice: ((atr / currentPrice) * 100).toFixed(2) + '%',
                    takeProfitAsPercentOfPrice: ((Math.abs(takeProfitPrice - currentPrice) / currentPrice) * 100).toFixed(2) + '%'
                });
                
                // Safety check: ensure take profit price is realistic
                if (takeProfitPrice <= 0 || takeProfitPrice > currentPrice * 10 || takeProfitPrice < currentPrice * 0.1) {
                    console.warn('[PositionManager] ⚠️ WARNING: Unrealistic take profit price calculated:', {
                        takeProfitPrice: takeProfitPrice,
                        currentPrice: currentPrice,
                        takeProfitAtrMultiplier: takeProfitAtrMultiplier,
                        atr: atr,
                        takeProfitDistance: takeProfitDistance,
                        impact: 'SL/TP values are not logical - check ATR data and multipliers'
                    });
                    
                    // Don't fallback - just warn and continue with the calculated value
                    // The position will be opened with the calculated values, but the warning indicates data issues
                }
                
                return takeProfitPrice;
            } else {
                // No fallback - ATR is required
                console.error('[PositionManager] ❌ CRITICAL: Cannot calculate take profit - ATR data missing:', {
                    combination: combination,
                    currentPrice: currentPrice,
                    atr: atr,
                    takeProfitAtrMultiplier: takeProfitAtrMultiplier,
                    reason: 'ATR-based take profit calculation requires valid ATR data and multiplier',
                    impact: 'Position cannot be opened without proper profit target'
                });
                throw new Error('ATR data required for take profit calculation');
            }
        } catch (error) {
            console.error('[PositionManager] ❌ CRITICAL: Take profit calculation failed:', error);
            throw error; // Re-throw to prevent position opening without proper profit target
        }
    }
    
    /**
     * Clear processed trade IDs to prevent memory leaks and allow fresh processing
     */
    clearProcessedTradeIds() {
        this.processedTradeIds.clear();
        console.log('[PositionManager] 🧹 Cleared processed trade IDs');
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
     * Process closed trade - creates Trade record and cleans up LivePosition
     * This is the main function responsible for storing closed trades according to the schema
     */
    async processClosedTrade(livePosition, exitDetails) {
        //console.log('[debug_closedTrade] ⚡⚡ PROCESS CLOSED TRADE - VERSION 3.1 - TIMESTAMP:', new Date().toISOString());
        
        // CRITICAL FIX: Check if this trade has already been processed to prevent duplicates
        const tradeId = livePosition?.position_id;
        if (this.processedTradeIds && this.processedTradeIds.has(tradeId)) {
            //console.log('[debug_closedTrade] ⚠️ DUPLICATE PREVENTION: Trade already processed:', tradeId);
            return {
                success: false,
                error: 'Trade already processed',
                trade: null,
                deletedPosition: null
            };
        }
        
        // Initialize processed trade IDs set if it doesn't exist
        if (!this.processedTradeIds) {
            this.processedTradeIds = new Set();
        }
        
        // Mark this trade as being processed
        this.processedTradeIds.add(tradeId);
        //console.log('[debug_closedTrade] 🔒 Marked trade as processed:', tradeId);
        
        // Cleanup old processed trade IDs to prevent memory leaks (keep last 1000)
        if (this.processedTradeIds.size > 1000) {
            const idsArray = Array.from(this.processedTradeIds);
            this.processedTradeIds = new Set(idsArray.slice(-500)); // Keep last 500
            //console.log('[debug_closedTrade] 🧹 Cleaned up old processed trade IDs, kept last 500');
        }
    
        // 🧩 SAFETY: Log minimal summaries to avoid circular structure crash
        /*try {
            console.log('[debug_closedTrade] livePosition summary:', {
                id: livePosition?.id,
                position_id: livePosition?.position_id,
                symbol: livePosition?.symbol,
                strategy_name: livePosition?.strategy_name,
                direction: livePosition?.direction,
            });*/
        
        // 🔍 DEBUG: Log analytics fields from livePosition
        try {
            console.log('🔍 [PositionManager] Analytics fields from livePosition:', {
            position_id: livePosition?.position_id,
            fear_greed_score: livePosition?.fear_greed_score,
            fear_greed_classification: livePosition?.fear_greed_classification,
            lpm_score: livePosition?.lpm_score,
            conviction_breakdown: livePosition?.conviction_breakdown,
            conviction_multiplier: livePosition?.conviction_multiplier,
            is_event_driven_strategy: livePosition?.is_event_driven_strategy,
            market_regime: livePosition?.market_regime,
            regime_confidence: livePosition?.regime_confidence,
            atr_value: livePosition?.atr_value,
            combined_strength: livePosition?.combined_strength,
            conviction_score: livePosition?.conviction_score,
            trigger_signals: livePosition?.trigger_signals
            });
        } catch (e) {
            //console.error('[debug_closedTrade] ❌ livePosition could not be logged safely:', e.message);
        }
    
        /*try {
            console.log('[debug_closedTrade] exitDetails summary:', {
                exit_price: exitDetails?.exit_price,
                pnl_usdt: exitDetails?.pnl_usdt,
                exit_timestamp: exitDetails?.exit_timestamp,
            });
        } catch (e) {
            console.error('[debug_closedTrade] ❌ exitDetails could not be logged safely:', e.message);
        }*/
    
        // 🧩 Now start main logic
        try {
            //console.log('[debug_closedTrade] 🔄 STEP 1: Entered main try block — beginning trade record construction');
            //console.log('[debug_closedTrade] 🔄 STEP 1: UNIQUE TRACE ID:', Date.now());
    
            // Defensive checks
            //console.log('[debug_closedTrade] 🔍 STEP 1.5: Checking key properties...');
            if (!livePosition?.position_id) console.error('[debug_closedTrade] ❌ Missing livePosition.position_id');
            if (!livePosition?.strategy_name) console.error('[debug_closedTrade] ❌ Missing livePosition.strategy_name');
            if (!livePosition?.symbol) console.error('[debug_closedTrade] ❌ Missing livePosition.symbol');
            if (!exitDetails?.exit_price) console.error('[debug_closedTrade] ❌ Missing exitDetails.exit_price');
            if (!exitDetails?.exit_value_usdt) console.error('[debug_closedTrade] ❌ Missing exitDetails.exit_value_usdt');
    
            //console.log('[debug_closedTrade] 🔄 STEP 2: Constructing Trade payload...');
    
            let newTradeRecord;
            try {
                //console.log('[debug_closedTrade] 🔄 STEP 2.1: Building trade object');
                newTradeRecord = {
                    // Copy data from livePosition
                    trade_id: livePosition.position_id,
                    strategy_name: livePosition.strategy_name,
                    symbol: livePosition.symbol,
                    direction: livePosition.direction,
                    entry_price: livePosition.entry_price,
                    quantity_crypto: livePosition.quantity_crypto,
                    entry_value_usdt: livePosition.entry_value_usdt,
                    entry_timestamp: livePosition.entry_timestamp,
                    trading_mode: livePosition.trading_mode,
                    trigger_signals: livePosition.trigger_signals,
                    combined_strength: livePosition.combined_strength,
                    conviction_score: livePosition.conviction_score,
                    conviction_breakdown: livePosition.conviction_breakdown,
                    conviction_multiplier: livePosition.conviction_multiplier,
                    market_regime: livePosition.market_regime,
                    regime_confidence: livePosition.regime_confidence,
                    atr_value: livePosition.atr_value,
                    is_event_driven_strategy: livePosition.is_event_driven_strategy,
                    // Add Fear & Greed Index and LPM score for analytics
                    fear_greed_score: livePosition.fear_greed_score,
                    fear_greed_classification: livePosition.fear_greed_classification,
                    lpm_score: livePosition.lpm_score,
    
                    // Add data from exitDetails
                    exit_price: exitDetails.exit_price,
                    exit_value_usdt: exitDetails.exit_value_usdt,
                    pnl_usdt: exitDetails.pnl_usdt,
                    pnl_percentage: exitDetails.pnl_percentage,
                    exit_timestamp: exitDetails.exit_timestamp,
                    duration_seconds: exitDetails.duration_seconds,
                    exit_reason: exitDetails.exit_reason,
    
                    // Calculate fees (assuming 0.1% trading fee)
                    total_fees_usdt: (livePosition.entry_value_usdt + exitDetails.exit_value_usdt) * 0.001,
                    commission_migrated: true
                };
                //console.log('[debug_closedTrade] ✅ STEP 2.2: Trade object created');
                
                // 🔍 DEBUG: Log analytics fields in newTradeRecord before Trade.create
                console.log('🔍 [PositionManager] Analytics fields in newTradeRecord before Trade.create:', {
                    trade_id: newTradeRecord.trade_id,
                    fear_greed_score: newTradeRecord.fear_greed_score,
                    fear_greed_classification: newTradeRecord.fear_greed_classification,
                    lpm_score: newTradeRecord.lpm_score,
                    conviction_breakdown: newTradeRecord.conviction_breakdown,
                    conviction_multiplier: newTradeRecord.conviction_multiplier,
                    is_event_driven_strategy: newTradeRecord.is_event_driven_strategy,
                    market_regime: newTradeRecord.market_regime,
                    regime_confidence: newTradeRecord.regime_confidence,
                    atr_value: newTradeRecord.atr_value,
                    combined_strength: newTradeRecord.combined_strength,
                    conviction_score: newTradeRecord.conviction_score,
                    trigger_signals: newTradeRecord.trigger_signals
                });
            } catch (constructionError) {
                //console.error('[debug_closedTrade] ❌ STEP 2.3: Error during trade object construction:', constructionError);
                throw constructionError;
            }
    
            console.log(' 🔄 STEP 3: Trade record constructed successfully');
            /*console.log('[debug_closedTrade] 🧩 Trade preview:', {
                id: newTradeRecord.trade_id,
                symbol: newTradeRecord.symbol,
                pnl_usdt: newTradeRecord.pnl_usdt
            });*/
    
            // Store in database
            //console.log('[debug_closedTrade] 🔄 STEP 4: Storing trade record in DB...');
            let createdTrade;
            try {
                //console.log('[debug_closedTrade] 🔄 STEP 5: Calling queueEntityCall → Trade.create');
                //console.log('[debug_closedTrade] 🔄 STEP 5: Trade record payload:', JSON.stringify(newTradeRecord, null, 2));
                
                // 🔍 DEBUG: Log analytics fields specifically before Trade.create
                console.log('🔍 [PositionManager] Analytics fields in newTradeRecord before Trade.create:', {
                    trade_id: newTradeRecord.trade_id,
                    fear_greed_score: newTradeRecord.fear_greed_score,
                    fear_greed_classification: newTradeRecord.fear_greed_classification,
                    lpm_score: newTradeRecord.lpm_score,
                    conviction_breakdown: newTradeRecord.conviction_breakdown,
                    conviction_multiplier: newTradeRecord.conviction_multiplier,
                    is_event_driven_strategy: newTradeRecord.is_event_driven_strategy,
                    market_regime: newTradeRecord.market_regime,
                    regime_confidence: newTradeRecord.regime_confidence,
                    atr_value: newTradeRecord.atr_value,
                    combined_strength: newTradeRecord.combined_strength,
                    conviction_score: newTradeRecord.conviction_score,
                    trigger_signals: newTradeRecord.trigger_signals
                });
                
                createdTrade = await queueEntityCall('Trade', 'create', newTradeRecord);
                //console.log('[debug_closedTrade] ✅ STEP 6: Trade record created in DB');
                //console.log('[debug_closedTrade] ✅ STEP 6: Created trade result:', JSON.stringify(createdTrade, null, 2));
            } catch (dbError) {
                //console.error('[debug_closedTrade] ❌ STEP 6: Database error during Trade.create:', dbError.message);
                //console.error('[debug_closedTrade] ❌ STEP 6: Database error stack:', dbError.stack);
                throw dbError;
            }
    
            // Delete LivePosition
            //console.log('[debug_closedTrade] 🔄 STEP 7: Deleting LivePosition ID:', livePosition.id);
            try {
                await queueEntityCall('LivePosition', 'delete', livePosition.id);
                console.log('[debug_closedTrade] ✅ STEP 8: LivePosition deleted');
            } catch (deleteError) {
                //console.error('[debug_closedTrade] ❌ STEP 8: Error deleting LivePosition:', deleteError.message);
                throw deleteError;
            }
    
            // Update CentralWalletState (for logging only)
            //console.log('[debug_closedTrade] 🔄 STEP 9: Wallet aggregates should update for wallet_id:', livePosition.wallet_id);
            
            // CRITICAL: Update live_position_ids in wallet state immediately
            if (this._getCurrentWalletState() && this._getCurrentWalletState().id === livePosition.wallet_id) {
                const currentIds = this._getCurrentWalletState().live_position_ids || [];
                const updatedIds = currentIds.filter(id => id !== livePosition.id);
                this._getCurrentWalletState().live_position_ids = updatedIds;
                //console.log('[debug_closedTrade] 🔄 STEP 9.1: Updated live_position_ids, removed:', livePosition.id, 'remaining:', updatedIds.length);
            }
    
            const result = {
                success: true,
                trade: createdTrade,
                deletedPosition: livePosition.id
            };
    
            //console.log('[debug_closedTrade] 🔄 STEP 10: Returning result:', result);
            return result;
    
        } catch (error) {
            //console.error('[debug_closedTrade] ❌ STEP ERROR: Failed in processClosedTrade');
            //console.error('[debug_closedTrade] ❌ Message:', error.message);
            //console.error('[debug_closedTrade] ❌ Stack:', error.stack);
            this.addLog(`[PROCESS_CLOSED_TRADE] ❌ ${error.message}`, 'error');
            throw error;
        }
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

        // 🔍 DEBUG: Log analytics fields from position before creating trade
        console.log('🔍 [PositionManager] Analytics fields from position before trade creation:', {
            position_id: position.position_id,
            fear_greed_score: position.fear_greed_score,
            fear_greed_classification: position.fear_greed_classification,
            lpm_score: position.lpm_score,
            conviction_breakdown: position.conviction_breakdown,
            conviction_multiplier: position.conviction_multiplier,
            is_event_driven_strategy: position.is_event_driven_strategy,
            market_regime: position.market_regime,
            regime_confidence: position.regime_confidence,
            atr_value: position.atr_value,
            combined_strength: position.combined_strength,
            conviction_score: position.conviction_score,
            trigger_signals: position.trigger_signals
        });
        
        // 🔍 DEBUG: Log ALL position properties to see what's missing
        console.log('🔍 [PositionManager] FULL position object keys:', Object.keys(position));
        console.log('🔍 [PositionManager] Position object sample:', {
            id: position.id,
            db_record_id: position.db_record_id,
            position_id: position.position_id,
            symbol: position.symbol,
            strategy_name: position.strategy_name,
            // Check if analytics fields exist
            has_fear_greed_score: 'fear_greed_score' in position,
            has_fear_greed_classification: 'fear_greed_classification' in position,
            has_lpm_score: 'lpm_score' in position,
            has_conviction_breakdown: 'conviction_breakdown' in position,
            has_conviction_multiplier: 'conviction_multiplier' in position,
            has_market_regime: 'market_regime' in position,
            has_regime_confidence: 'regime_confidence' in position,
            has_atr_value: 'atr_value' in position,
            has_combined_strength: 'combined_strength' in position,
            has_conviction_score: 'conviction_score' in position,
            has_trigger_signals: 'trigger_signals' in position,
            has_is_event_driven_strategy: 'is_event_driven_strategy' in position
        });
        
        // 🔍 DEBUG: Log the actual values of analytics fields
        console.log('🔍 [PositionManager] Analytics field VALUES:', {
            fear_greed_score: position.fear_greed_score,
            fear_greed_classification: position.fear_greed_classification,
            lpm_score: position.lpm_score,
            conviction_breakdown: position.conviction_breakdown,
            conviction_multiplier: position.conviction_multiplier,
            market_regime: position.market_regime,
            regime_confidence: position.regime_confidence,
            atr_value: position.atr_value,
            combined_strength: position.combined_strength,
            conviction_score: position.conviction_score,
            trigger_signals: position.trigger_signals,
            is_event_driven_strategy: position.is_event_driven_strategy
        });

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
            // Add Fear & Greed Index and LPM score for analytics
            fear_greed_score: position.fear_greed_score,
            fear_greed_classification: position.fear_greed_classification,
            lpm_score: position.lpm_score,
            trading_mode: this.tradingMode, // Added to ensure consistency
            ...additionalData
        };

        // 🔍 DEBUG: Log the final trade data being created
        console.log('🔍 [PositionManager] Final trade data being created:', {
            trade_id: tradeData.trade_id,
            fear_greed_score: tradeData.fear_greed_score,
            fear_greed_classification: tradeData.fear_greed_classification,
            lpm_score: tradeData.lpm_score,
            conviction_breakdown: tradeData.conviction_breakdown,
            conviction_multiplier: tradeData.conviction_multiplier,
            is_event_driven_strategy: tradeData.is_event_driven_strategy,
            market_regime: tradeData.market_regime,
            regime_confidence: tradeData.regime_confidence,
            atr_value: tradeData.atr_value,
            combined_strength: tradeData.combined_strength,
            conviction_score: tradeData.conviction_score,
            trigger_signals: tradeData.trigger_signals
        });

        return tradeData;
    }

    /**
     * Reconciles LivePosition records with actual Binance holdings.
     * This is the definitive synchronization method that ensures database matches reality.
     */
    async reconcileWithBinance() {
        this.addLog(`[RECONCILE] Trading mode: ${this.getTradingMode()}`, 'debug');
        
        try {
            // Import the robust reconcile service
            const { robustReconcileService } = await import('./RobustReconcileService');
            
            // Get wallet ID for reconciliation
            const walletState = this._getCurrentWalletState();
            const walletId = walletState?.id || 'unknown';
            
            this.addLog(`[RECONCILE] 🔄 Starting robust reconciliation for wallet ${walletId}`, 'info');
            
            // Use the robust reconcile service
            const result = await robustReconcileService.reconcileWithBinance(
                this.getTradingMode(), 
                walletId
            );
            
            if (result.success) {
                if (result.throttled) {
                    this.addLog(`[RECONCILE] ⏳ Reconciliation throttled: ${result.reason}`, 'info');
                } else {
                    const summary = result.summary;
                    this.addLog(`[RECONCILE] ✅ Complete: ${summary.ghostPositionsCleaned} ghosts cleaned, ${summary.legitimatePositions} legitimate positions remaining`, 'success');
                    
                    // Reload managed state if positions were cleaned
                    if (summary.ghostPositionsCleaned > 0) {
                        if (walletState && walletState.id) {
                            await this.loadManagedState(walletState);
                        } else {
                            this.addLog(`[RECONCILE] ⚠️ No active wallet state to reload after reconciliation`, 'warning');
                            this.positions = [];
                        }
                    }
                }
                
                return {
                    success: true,
                    summary: {
                        positionsRemaining: result.summary?.legitimatePositions || this.positions.length,
                        ghostPositionsCleaned: result.summary?.ghostPositionsCleaned || 0,
                        throttled: result.throttled || false
                    }
                };
            } else {
                this.addLog(`[RECONCILE] ❌ Reconciliation failed: ${result.error}`, 'error');
                
                // If max attempts exceeded, reset attempts to allow future reconciliations
                if (result.error === 'Max attempts exceeded') {
                    this.addLog(`[RECONCILE] 🔄 Resetting reconciliation attempts for wallet ${walletId}`, 'info');
                    robustReconcileService.resetAttempts(this.getTradingMode(), walletId);
                }
                
                return {
                    success: false,
                    error: result.error,
                    attempts: result.attempts
                };
            }
            
        } catch (error) {
            this.addLog(`[RECONCILE] ❌ Reconciliation error: ${error.message}`, 'error');
            console.error('[RECONCILE] Full error:', error);
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
            const symbolNoSlash = (symbol || '').replace('/', '');
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
     * Internal helper to execute a market buy order on Binance.
     * @param {string} symbol - The trading symbol (e.g., 'BTCUSDT').
     * @param {number} quantity - The quantity to buy.
     * @param {string} tradingMode - The trading mode ('live' or 'testnet').
     * @param {string} proxyUrl - The proxy URL for Binance API.
     * @returns {Promise<{success: boolean, orderResult?: object, error?: string, isWarning?: boolean, skipped?: boolean, reason?: string, attemptedQty?: number}>}
     */
    async _executeBinanceMarketBuyOrder(symbol, quantity, { tradingMode, proxyUrl }) {
        const logPrefix = '[BINANCE_BUY]';
        try {
            // Validate inputs
            if (!symbol || !quantity || quantity <= 0) {
                throw new Error('Invalid symbol or quantity for buy order');
            }

            if (!proxyUrl) {
                throw new Error('Proxy URL not configured for Binance buy order');
            }

            // Convert symbol format from BTC/USDT to BTCUSDT for Binance
            const binanceSymbol = symbol.replace('/', '');
            
            // Format quantity to proper precision
            const formattedQty = this._formatQuantityForBinance(quantity, binanceSymbol);
            if (!formattedQty || formattedQty === '0') {
                throw new Error('Invalid quantity after formatting');
            }

            this.addLog(`${logPrefix} 🚀 Executing Binance BUY: ${formattedQty} ${binanceSymbol}`, 'info');

            // CRITICAL FIX: Validate balance before making API call
            console.log('[PositionManager] 🔍 Validating balance before Binance API call...');
            try {
                console.log('[PositionManager] 🔍 Getting account info for balance validation...');
                const accountResponse = await liveTradingAPI({
                    action: 'getAccountInfo',
                    tradingMode: tradingMode,
                    proxyUrl: proxyUrl
                });
                
                console.log('[PositionManager] 🔍 Account info response:', accountResponse);
                
                if (!accountResponse?.success || !accountResponse?.data) {
                    throw new Error('Failed to get account info for balance validation');
                }
                
                const usdtBalance = accountResponse.data.balances?.find(b => b.asset === 'USDT');
                const availableBalance = parseFloat(usdtBalance?.free || 0) || 0;
                
                console.log('[PositionManager] 🔍 USDT balance found:', {
                    usdtBalance: usdtBalance,
                    availableBalance: availableBalance
                });
                
                // Get current price from scanner service
                const currentPrices = this.scannerService?.currentPrices || {};
                let currentPrice = currentPrices[symbol.replace('/', '')];
                
                console.log('[PositionManager] 🔍 Current price lookup:', {
                    symbol: symbol,
                    symbolNoSlash: symbol.replace('/', ''),
                    currentPrices: Object.keys(currentPrices),
                    currentPrice: currentPrice
                });
                
                // Fallback: If price not available in cache, fetch it directly
                if (!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0) {
                    console.log(`[PositionManager] 🔍 Price not in cache for ${symbol}, fetching directly...`);
                    try {
                        const directPriceResponse = await fetch(`http://localhost:3003/api/binance/ticker/price?symbol=${symbol.replace('/', '')}`);
                        if (directPriceResponse.ok) {
                            const directPriceData = await directPriceResponse.json();
                            if (directPriceData?.success && directPriceData?.data?.price) {
                                currentPrice = parseFloat(directPriceData.data.price);
                                console.log(`[PositionManager] ✅ Direct price fetch successful for ${symbol}: $${currentPrice}`);
                            }
                        }
                    } catch (directPriceError) {
                        console.warn(`[PositionManager] ⚠️ Direct price fetch failed for ${symbol}:`, directPriceError.message);
                    }
                }
                
                if (!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0) {
                    throw new Error(`Current price not available for ${symbol}`);
                }
                
                const estimatedCost = parseFloat(formattedQty) * parseFloat(currentPrice); // Use actual current price
                
                console.log('[PositionManager] 💰 Balance validation:', {
                    availableBalance: availableBalance,
                    estimatedCost: estimatedCost,
                    symbol: binanceSymbol,
                    quantity: formattedQty,
                    currentPrice: currentPrice
                });
                
                if (availableBalance < estimatedCost) {
                    throw new Error(`Insufficient balance: $${availableBalance.toFixed(2)} < $${estimatedCost.toFixed(2)} required`);
                }
                
                console.log('[PositionManager] ✅ Balance validation passed');
            } catch (balanceError) {
                console.error('[PositionManager] ❌ Balance validation failed:', balanceError.message);
                throw new Error(`Balance validation failed: ${balanceError.message}`);
            }

            // CRITICAL FIX: Check for recent BUY orders to prevent duplicates
            console.log('[PositionManager] 🔍 Checking for recent BUY orders to prevent duplicates...');
            try {
                const recentOrdersResponse = await liveTradingAPI({
                    action: 'getAllOrders',
                    tradingMode: tradingMode,
                    proxyUrl: proxyUrl,
                    symbol: binanceSymbol,
                    limit: 5
                });
                
                if (recentOrdersResponse?.data?.success && recentOrdersResponse.data.data) {
                    const recentOrders = Array.isArray(recentOrdersResponse.data.data) 
                        ? recentOrdersResponse.data.data 
                        : [recentOrdersResponse.data.data];
                    
                    // Look for recent BUY orders for this symbol
                    const recentBuyOrders = recentOrders.filter(order => 
                        order.symbol === binanceSymbol && 
                        order.side === 'BUY' && 
                        order.status === 'FILLED' &&
                        new Date(order.time) > new Date(Date.now() - 30000) // Last 30 seconds
                    );
                    
                    if (recentBuyOrders.length > 0) {
                        console.log('[PositionManager] ✅ Found recent successful BUY order, skipping to prevent duplicate');
                        this.addLog(
                            `${logPrefix} ✅ Recent BUY order found, skipping to prevent duplicate`,
                            "success"
                        );
                        return { success: true, orderResult: recentBuyOrders[0], skipped: true, reason: "already_executed" };
                    }
                }
            } catch (checkError) {
                console.log('[PositionManager] ⚠️ Could not verify recent orders, proceeding with buy:', checkError.message);
            }

            // Execute the buy order via liveTradingAPI
            const requestParams = {
                action: 'createOrder',
                tradingMode: tradingMode,
                proxyUrl: proxyUrl,
                symbol: binanceSymbol,
                side: 'BUY',
                type: 'MARKET',
                quantity: formattedQty
            };

            console.log('[PositionManager] 🚀 Making liveTradingAPI call with params:', requestParams);
            const response = await liveTradingAPI(requestParams);
            console.log('[PositionManager] 🚀 liveTradingAPI response:', response);
            
            // Extract the actual Binance response
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

            const binanceResponse = getBinanceResponseLocal(response);

            // Check for Binance API errors
            if (!binanceResponse || binanceResponse.code) {
                const errorMessage = binanceResponse?.msg || binanceResponse?.message || 'Unknown error from Binance API';
                const errorCode = binanceResponse?.code;
                throw Object.assign(new Error(`Binance API Error ${errorCode}: ${errorMessage}`), { code: errorCode, message: errorMessage });
            }

            if (binanceResponse?.orderId) {
                // CRITICAL FIX: Wait for order confirmation before proceeding
                console.log('[PositionManager] 🔍 Waiting for order confirmation...');
                
                // Wait a moment for the order to be processed
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Verify the order is actually filled
                try {
                    const orderStatusResponse = await liveTradingAPI({
                        action: 'getOrder',
                        tradingMode: tradingMode,
                        proxyUrl: proxyUrl,
                        symbol: binanceSymbol,
                        orderId: binanceResponse.orderId
                    });
                    
                    const orderStatus = orderStatusResponse?.data?.data || orderStatusResponse?.data;
                    
                    if (orderStatus && orderStatus.status === 'FILLED') {
                        // ✅ LOG: Confirmation of BUY execution
                        const executedQty = orderStatus.executedQty || binanceResponse.executedQty || formattedQty;
                        console.log(`[PositionManager] ✅ [BINANCE_BUY_CONFIRMATION] BUY executed successfully on Binance:`);
                        console.log(`[PositionManager] ✅ [BINANCE_BUY_CONFIRMATION] Order ID: ${binanceResponse.orderId}`);
                        console.log(`[PositionManager] ✅ [BINANCE_BUY_CONFIRMATION] Executed Quantity: ${executedQty}`);
                        console.log(`[PositionManager] ✅ [BINANCE_BUY_CONFIRMATION] Symbol: ${binanceSymbol}`);
                        console.log(`[PositionManager] ✅ [BINANCE_BUY_CONFIRMATION] Status: FILLED`);
                        this.addLog(
                            `${logPrefix} ✅ BUY executed on Binance: Order ${binanceResponse.orderId}, qty=${executedQty} ${symbol}`,
                            'success',
                            { level: 2 }
                        );
                        return { success: true, orderResult: { ...binanceResponse, ...orderStatus } };
                    } else {
                        // Order is pending - add to monitoring system
                        console.log(`[PositionManager] 📝 Adding pending order ${binanceResponse.orderId} to monitoring system`);
                        
                        // Initialize order monitoring if not already done
                        this.initializeOrderMonitoring();
                        
                        if (this.pendingOrderManager) {
                            this.pendingOrderManager.addPendingOrder({
                                orderId: binanceResponse.orderId,
                                symbol: binanceSymbol,
                                side: 'BUY',
                                quantity: formattedQty,
                                price: currentPrice,
                                tradingMode: tradingMode,
                                proxyUrl: proxyUrl,
                                metadata: {
                                    signal: options?.signal,
                                    positionSizeResult: options?.positionSizeResult
                                }
                            });
                        } else {
                            console.warn('[PositionManager] ⚠️ PendingOrderManager not available, order will not be monitored');
                        }
                        
                        console.warn('[PositionManager] ⚠️ Order not yet filled, status:', orderStatus?.status);
                        // Still return success but with a warning
                        this.addLog(
                            `${logPrefix} ⚠️ Binance BUY pending: ${formattedQty} ${symbol} (Order: ${binanceResponse.orderId}, Status: ${orderStatus?.status}) - Added to monitoring`,
                            'warning',
                            { level: 2 }
                        );
                        return { success: true, orderResult: { ...binanceResponse, ...orderStatus }, pending: true };
                    }
                } catch (statusError) {
                    console.warn('[PositionManager] ⚠️ Could not verify order status, proceeding with order:', statusError.message);
                    this.addLog(
                        `${logPrefix} ✅ Binance BUY executed: ${formattedQty} ${symbol} (Order: ${binanceResponse.orderId})`,
                        'success',
                        { level: 2 }
                    );
                    return { success: true, orderResult: binanceResponse };
                }
            } else {
                throw new Error('Binance buy order did not return an orderId');
            }

        } catch (error) {
            const errorMessage = error?.message || 'Unknown error';
            const isInsufficientBalance = error.isInsufficient || errorMessage.toLowerCase().includes('insufficient balance');
            
            this.addLog(`${logPrefix} ❌ Critical error executing Binance market buy for ${symbol}: ${errorMessage}`, 'error', error);
            
            return { 
                success: false, 
                error: errorMessage, 
                isWarning: isInsufficientBalance,
                isInsufficientBalance: isInsufficientBalance
            };
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
        // Debug flag for verbose logging
        const DEBUG_SELL_ORDER = true; // Set to false to reduce log noise
        
        // Standardized logging function
        const log = (message, level = 'info', data = null) => {
            if (this.addLog) {
                this.addLog(`[BINANCE_SELL] ${message}`, level, data);
            }
            if (DEBUG_SELL_ORDER) {
                console.log(`[PositionManager] ${message}`, data || '');
            }
        };
        
        log('🚀 _executeBinanceMarketSellOrder CALLED', 'info', { 
            symbol: position?.symbol, 
            currentPrice, 
            tradingMode, 
            proxyUrl 
        });
        console.log('🔍 [EXECUTION_TRACE] step_8: _executeBinanceMarketSellOrder entry point reached');
        
        const logPrefix = '[BINANCE_SELL]';
        
        // CRITICAL: Define these variables early so they're available in all catch blocks
        const isClosingContext = options?.exitReason !== undefined || position?.exit_reason !== undefined;
        const positionQty = Number(position?.quantity_crypto || 0);
        
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

            const symbolWithSlash = position?.symbol || "";                 // e.g., CHZ/USDT
            const symbolKey = symbolWithSlash.replace("/", "");            // e.g., CHZUSDT
            const baseAsset = symbolWithSlash.split("/")[0];                 // e.g., CHZ
            if (!symbolKey || !baseAsset) {
                this.addLog(`${logPrefix} ❌ Missing symbol/baseAsset for position ${position?.position_id}`, "error");
                throw new Error("Invalid symbol for sell");
            }

            // Get cached exchange info and critical filters
            const symbolInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolKey) : null;
            if (!symbolInfo) {
                this.addLog(`${logPrefix} ⚠️ No exchange info cached for ${symbolKey}`, "error");
                
                // Try to load exchange info if not available
                console.log('[PositionManager] 🔄 Attempting to load exchange info for', symbolKey);
                try {
                    // This would trigger exchange info loading
                    if (typeof this.scannerService._loadExchangeInfo === 'function') {
                        await this.scannerService._loadExchangeInfo();
                        const retrySymbolInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolKey) : null;
                        if (retrySymbolInfo) {
                            console.log('[PositionManager] ✅ Exchange info loaded successfully');
                        } else {
                            throw new Error(`Still no exchange info for ${symbolKey} after reload`);
                        }
                    } else {
                        throw new Error(`No exchange info for ${symbolKey} and no reload method available`);
                    }
                } catch (reloadError) {
                    console.log('[PositionManager] ❌ Failed to load exchange info:', reloadError);
                    throw new Error(`No exchange info for ${symbolKey}: ${reloadError.message}`);
                }
            }
            const { minNotional, minQty, stepSize } = getSymbolFiltersFromInfo(symbolInfo);

            // NOTE: positionQty is already defined at function level for error handling access
            if (!Number.isFinite(positionQty) || positionQty <= 0) {
                this.addLog(`${logPrefix} ⚠️ Position qty invalid for ${symbolKey}: ${positionQty}`, "error");
                throw new Error("Invalid position quantity");
            }

            // Check if this is a test position (no real tokens in account)
            const isTestPosition = position?.position_id?.startsWith('test_') || 
                                 position?.strategy_name?.includes('Test') ||
                                 (position?.strategy_name?.includes('Strategy') && 
                                 position?.strategy_name !== 'Momentum Strategy' && 
                                 position?.strategy_name !== 'Raging Bear');
            
            // Enhanced debugging for test position detection
            console.log('[PositionManager] Test position detection debug:', {
                position_id: position?.position_id,
                strategy_name: position?.strategy_name,
                startsWithTest: position?.position_id?.startsWith('test_'),
                includesTest: position?.strategy_name?.includes('Test'),
                includesStrategy: position?.strategy_name?.includes('Strategy'),
                isMomentumStrategy: position?.strategy_name === 'Momentum Strategy',
                isRagingBear: position?.strategy_name === 'Raging Bear',
                isTestPosition: isTestPosition
            });

            if (isTestPosition) {
                this.addLog(
                    `${logPrefix} 🧪 Detected test position ${symbolKey} (${position?.position_id}). ` +
                    `Simulating close without Binance order.`,
                    "info"
                );
                return { 
                    success: true, 
                    orderResult: { 
                        orderId: `test_close_${Date.now()}`, 
                        executedQty: positionQty.toString(),
                        fills: [{ price: currentPrice.toString() }]
                    },
                    isTestPosition: true
                };
            }

            // 1) Fresh free balance pull to avoid -2010
            const freeBalance = await fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl });

            // 2) Compute requested quantity = min(position qty, free balance), then round down to lot-size step
            // CRITICAL FIX: When closing a position, ALWAYS attempt to close with the actual position quantity.
            // Don't let freeBalance=0 prevent us from attempting a real Binance close.
            // If the position doesn't exist on Binance, Binance will return "insufficient balance" and we'll handle it.
            // NOTE: isClosingContext is already defined at function level for error handling access
            console.log(`[PositionManager] 🔍 [CONTEXT_CHECK] isClosingContext=${isClosingContext}, exitReason=${options?.exitReason || position?.exit_reason || 'NONE'}`);
            let requestedQty;
            if (isClosingContext && positionQty > 0 && positionQty >= minQty) {
                // Position closing context: Use position quantity for REAL Binance close attempt
                // This ensures we try to actually close the position on Binance, not just assume it's closed
                console.log(`[PositionManager] 🔄 CLOSING CONTEXT: Attempting REAL Binance close with positionQty=${positionQty} (freeBalance=${freeBalance})`);
                requestedQty = positionQty;
            } else {
                // Normal context (opening): Use minimum of position qty and free balance
                requestedQty = Math.min(positionQty, freeBalance);
            }
            const originalRequestedQty = requestedQty;
            requestedQty = roundDownToStepSize(requestedQty, stepSize); // This is a numeric value

            // 3) Validate against lot-size and notional; if below thresholds, skip as dust and trigger reconcile
            const notional = requestedQty * Number(currentPrice || 0);
            const belowLot = minQty && requestedQty < minQty - 1e-12;
            const belowNotional = minNotional && notional < (minNotional - 1e-8);

            console.log('[PositionManager] 🔍 DUST THRESHOLD CHECK');
            console.log('[PositionManager] 🔍 Symbol:', symbolKey);
            console.log('[PositionManager] 🔍 Position qty:', positionQty);
            console.log('[PositionManager] 🔍 Free balance:', freeBalance);
            console.log('[PositionManager] 🔍 Requested qty:', requestedQty);
            console.log('[PositionManager] 🔍 Current price:', currentPrice);
            console.log('[PositionManager] 🔍 Notional:', notional);
            console.log('[PositionManager] 🔍 Min qty:', minQty);
            console.log('[PositionManager] 🔍 Min notional:', minNotional);
            console.log('[PositionManager] 🔍 Below lot:', belowLot);
            console.log('[PositionManager] 🔍 Below notional:', belowNotional);

            // DEBUG: Add detailed logging for ADA position
            this.addLog(
                `${logPrefix} 🔍 DEBUG for ${symbolKey}: ` +
                `positionQty=${positionQty.toFixed(8)}, freeBalance=${freeBalance.toFixed(8)}, ` +
                `originalRequestedQty=${originalRequestedQty.toFixed(8)}, stepSize=${stepSize}, ` +
                `finalRequestedQty=${requestedQty.toFixed(8)}, currentPrice=${currentPrice}, ` +
                `notional=${notional.toFixed(6)}, minQty=${minQty}, minNotional=${minNotional}, ` +
                `belowLot=${belowLot}, belowNotional=${belowNotional}`,
                "debug"
            );

            // DUST PREVENTION LOGIC - Original App Implementation
            // CRITICAL FIX: In closing context, if positionQty meets minimums, don't block as dust even if freeBalance is 0
            const positionQtyRounded = roundDownToStepSize(positionQty, stepSize);
            const positionNotional = positionQtyRounded * Number(currentPrice || 0);
            const positionMeetsMinimums = positionQtyRounded >= minQty && positionNotional >= minNotional;
            
            if (requestedQty <= 0 || belowLot || belowNotional) {
                // Check if user has enough to sell "ALL" (original app logic)
                const freeRounded = floorToStep(freeBalance, stepSize);
                const freeNotional = freeRounded * Number(currentPrice || 0);
                
                console.log('[PositionManager] 🔍 DUST PREVENTION CHECK');
                console.log('[PositionManager] 🔍 Is closing context:', isClosingContext);
                console.log('[PositionManager] 🔍 Position qty meets minimums:', positionMeetsMinimums);
                console.log('[PositionManager] 🔍 Free balance:', freeBalance);
                console.log('[PositionManager] 🔍 Free rounded:', freeRounded);
                console.log('[PositionManager] 🔍 Free notional:', freeNotional);
                console.log('[PositionManager] 🔍 Min qty:', minQty);
                console.log('[PositionManager] 🔍 Min notional:', minNotional);
                
                // CRITICAL FIX: In closing context, if position quantity meets minimums, always allow the REAL close attempt
                // We'll attempt to close on Binance with the position quantity. If it fails, Binance will tell us.
                if (isClosingContext && positionMeetsMinimums) {
                    console.log('[PositionManager] ✅ CLOSING CONTEXT: Position meets minimums, attempting REAL Binance close');
                    console.log(`[PositionManager] ✅ Using position quantity ${positionQtyRounded} for Binance sell (freeBalance=${freeBalance})`);
                    // Use position quantity for the sell attempt - real Binance close
                    requestedQty = positionQtyRounded;
                    // Skip dust blocking and proceed to sell attempt
                } else if (freeRounded >= minQty && freeNotional >= minNotional && requestedQty < minQty) {
                // Condition 2: User has enough to sell "ALL" (override quantity)
                    console.log('[PositionManager] 🔄 OVERRIDING QUANTITY - POSITION BELOW MINIMUMS');
                    console.log('[PositionManager] 🔄 Original requested:', requestedQty);
                    console.log('[PositionManager] 🔄 Override to:', freeRounded);
                    
                    // Only override if the position quantity is below minimums
                    requestedQty = freeRounded;
                    
                    // Clear from dust ledger if this symbol was previously marked as dusty
                    const dustKey = getDustKey(symbolKey, tradingMode);
                    if (dustLedger.has(dustKey)) {
                        dustLedger.delete(dustKey);
                        console.log('[PositionManager] 🔄 Cleared dust ledger entry for', dustKey);
                    }
                    
                    // Continue with the overridden quantity
                } else {
                    // Condition 3: User does NOT have enough (TRUE DUST)
                    console.log('[PositionManager] ❌ TRUE DUST DETECTED - BLOCKING TRADE');
                    console.log('[PositionManager] ❌ Free rounded:', freeRounded, '< minQty:', minQty);
                    console.log('[PositionManager] ❌ Free notional:', freeNotional, '< minNotional:', minNotional);
                    
                    // Add to dust ledger
                    const dustKey = getDustKey(symbolKey, tradingMode);
                    dustLedger.set(dustKey, {
                        symbol: symbolKey,
                        baseAsset,
                        mode: tradingMode,
                        qty: freeRounded,
                        minQty,
                        minNotional,
                        stepSize,
                        price: currentPrice,
                        updatedAt: Date.now()
                    });
                    
                    console.log('[PositionManager] 🔍 Added to dust ledger:', dustKey);
                    console.log('[PositionManager] 🔍 Dust ledger snapshot:', getDustLedgerSnapshot());
                    
                this.addLog(
                        `${logPrefix} 🧹 DUST BLOCKED for ${symbolKey}. ` +
                        `free=${freeRounded.toFixed(8)}, minQty=${minQty}, ` +
                        `freeNotional=${freeNotional.toFixed(6)}, minNotional=${minNotional}`,
                    "signal_not_found"
                );

                // Soft action: request a reconciliation instead of erroring
                if (typeof this.reconcileWithBinance === "function") {
                    this.addLog(`${logPrefix} 🔄 Triggering reconciliation after dust-skip for ${symbolKey}`, "cycle");
                    // Fire and forget; don't block
                    this.reconcileWithBinance().catch(() => { });
                }
                    
                    // Return structured dust response (original app format)
                    return { 
                        success: false,
                        dust: true,
                        reason: 'DUST_BLOCKED',
                        symbol: symbolKey,
                        baseAsset,
                        mode: tradingMode,
                        qty: freeRounded,
                        minQty,
                        minNotional,
                        stepSize,
                        price: currentPrice,
                        skipped: true
                    };
                }
            }

            // 4) Attempt SELL order (first try)
            const attemptSell = async (qty) => {
                const quantityStr = _formatQuantityString(qty, stepSize); // Use the new global helper for API string
                
                // ✅ LOG: Sending SELL request to Binance
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] Sending SELL request to Binance:`);
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] Symbol: ${symbolKey}`);
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] Quantity: ${quantityStr}`);
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] Trading Mode: ${tradingMode}`);
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] Order Type: MARKET`);
                this.addLog(`${logPrefix} 📤 Sending MARKET SELL request to Binance: ${symbolKey} qty=${quantityStr}`, "info");
                
                const requestParams = {
                        action: "createOrder",
                        tradingMode,
                        proxyUrl,
                        symbol: symbolKey,
                        side: "SELL",
                        type: "MARKET",
                        quantity: quantityStr
                };
                
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] About to call queueFunctionCall with params:`, requestParams);
                console.log(`[PositionManager] 📤 [BINANCE_SELL_REQUEST] isClosingContext=${isClosingContext}`);
                console.log(`[PositionManager] 🔍 [BINANCE_SELL_REQUEST] About to enter try-catch block for Binance API call...`);
                
                try {
                    console.log(`[PositionManager] 🔍 [BINANCE_SELL_REQUEST] Calling queueFunctionCall now...`);
                    const response = await queueFunctionCall(
                        "liveTradingAPI",
                        liveTradingAPI,
                        requestParams,
                    "critical",
                    null,
                    45000
                );
                    
                    // ✅ LOG: Confirmation of SELL request sent
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_REQUEST] SELL request sent successfully`);
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_REQUEST] Response received:`, response);
                    
                    // Check if response indicates an error
                    if (response?.data?.success === false || response?.error) {
                        const errorMsg = response?.data?.data?.message || response?.data?.error || response?.error?.message || "Unknown error";
                        const errorCode = response?.data?.data?.code || response?.data?.code || response?.error?.code;
                        console.log(`[PositionManager] ❌ [BINANCE_SELL_REQUEST] SELL request failed in response: ${errorMsg}`);
                        console.log(`[PositionManager] ❌ [BINANCE_SELL_REQUEST] Error code: ${errorCode}`);
                        // Preserve original error properties for proper error handling
                        const error = new Error(errorMsg);
                        error.code = errorCode;
                        error.response = response;
                        throw error;
                    }
                    
                    // ✅ LOG: Confirmation of SELL execution (success path)
                    const orderId = response?.data?.data?.orderId || response?.data?.data?.data?.orderId;
                    const executedQty = response?.data?.data?.executedQty || response?.data?.data?.data?.executedQty;
                    if (orderId) {
                        console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] SELL executed successfully on Binance:`);
                        console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Order ID: ${orderId}`);
                        console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Executed Quantity: ${executedQty || quantityStr}`);
                        console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Symbol: ${symbolKey}`);
                        this.addLog(
                            `${logPrefix} ✅ SELL executed on Binance: Order ${orderId}, qty=${executedQty || quantityStr} ${symbolKey}`,
                            "success"
                        );
                    }
                    
                return response;
                } catch (queueError) {
                    // ✅ CRITICAL: Catch error from queueFunctionCall immediately
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Error caught from queueFunctionCall:`);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Error type:`, typeof queueError);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Error message:`, queueError?.message);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Error code:`, queueError?.code);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Error response:`, queueError?.response);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] Full error object:`, queueError);
                    console.log(`[PositionManager] ❌ [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] isClosingContext=${isClosingContext}`);
                    console.log(`[PositionManager] 🔍 [QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL] About to re-throw error to outer catch block...`);
                    
                    // Re-throw so the outer try-catch can handle it with order history check
                    throw queueError;
                }
            };

            // Helper to extract error code/message if available
            const parseErr = (err) => {
                try {
                    console.log(`[PositionManager] 🔍 [PARSE_ERR] Starting error parsing...`);
                    console.log(`[PositionManager] 🔍 [PARSE_ERR] Error object:`, err);
                    console.log(`[PositionManager] 🔍 [PARSE_ERR] err.code (direct):`, err?.code);
                    console.log(`[PositionManager] 🔍 [PARSE_ERR] err.message:`, err?.message);
                    console.log(`[PositionManager] 🔍 [PARSE_ERR] err.response:`, err?.response);
                    
                    // CRITICAL FIX: Check err.code directly first (from apiQueue re-thrown errors)
                    if (err?.code !== undefined) {
                        console.log(`[PositionManager] ✅ [PARSE_ERR] Found error code directly: ${err.code}`);
                        return { 
                            code: err.code, 
                            message: err.message || err?.msg || "Unknown error" 
                        };
                    }
                    
                    const d = err?.response?.data;
                    // Check for nested proxy response first
                    if (d?.data?.success === false && d?.data?.data) { // Example: {success:true, data:{success:false, data:{code,msg}}}
                        const innerError = d.data.data;
                        console.log(`[PositionManager] ✅ [PARSE_ERR] Found nested error code: ${innerError.code}`);
                        return { code: innerError.code, message: innerError.message || innerError.msg || "Unknown proxy error" };
                    }
                    // Then for top-level proxy error
                    const proxyTxt = d?.error || d?.message || ""; // Sometimes error string is directly in 'error' field
                    if (typeof proxyTxt === "string" && proxyTxt.includes("{") && proxyTxt.includes("}")) {
                        try {
                            const m = proxyTxt.match(/\{.*\}/);
                            if (m) {
                                const inner = JSON.parse(m[0]);
                                console.log(`[PositionManager] ✅ [PARSE_ERR] Found parsed error code: ${inner.code}`);
                                return { code: inner.code, message: inner.message || inner.msg || proxyTxt };
                            }
                        } catch(e) { /* ignore JSON parse error, treat as plain text */ }
                    }
                    const code = d?.code;
                    const message = d?.message || err?.message;
                    console.log(`[PositionManager] ⚠️ [PARSE_ERR] Using fallback - code: ${code}, message: ${message}`);
                    return { code, message };
                } catch (parseError) {
                    console.log(`[PositionManager] ❌ [PARSE_ERR] Error parsing failed:`, parseError);
                    return { code: undefined, message: err?.message };
                }
            };


            try {
                const resp = await attemptSell(requestedQty);
                console.log(`[PositionManager] 🔍 [ATTEMPT_SELL_RESULT] attemptSell returned:`, resp);
                console.log(`[PositionManager] 🔍 [ATTEMPT_SELL_RESULT] Response type:`, typeof resp);
                console.log(`[PositionManager] 🔍 [ATTEMPT_SELL_RESULT] Response success:`, resp?.success);
                console.log(`[PositionManager] 🔍 [ATTEMPT_SELL_RESULT] Response isVirtualClose:`, resp?.isVirtualClose);
                
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
                console.log(`[PositionManager] 🔍 [BINANCE_PROCESSED_RESPONSE] Processed response:`, binanceProcessedResponse);

                // Check for Binance API error codes/messages from the processed response
                if (!binanceProcessedResponse || binanceProcessedResponse.code) { // binanceProcessedResponse.code implies error
                    const errorMessage = binanceProcessedResponse?.msg || binanceProcessedResponse?.message || resp?.data?.data?.message || resp?.data?.message || 'Unknown error from Binance API';
                    const errorCode = binanceProcessedResponse?.code || resp?.data?.data?.code;
                    throw Object.assign(new Error(`Binance API Error ${errorCode}: ${errorMessage}`), { code: errorCode, message: errorMessage });
                }

                // CRITICAL: Check if this is a virtual close result
                if (binanceProcessedResponse?.isVirtualClose) {
                    console.log(`[PositionManager] 🔍 [VIRTUAL_CLOSE_DETECTED] Virtual close result detected for ${symbolKey}`);
                    console.log(`[PositionManager] 🔍 [VIRTUAL_CLOSE_DETECTED] Virtual close reason:`, binanceProcessedResponse?.reason);
                    console.log(`[PositionManager] 🔍 [VIRTUAL_CLOSE_DETECTED] Virtual close order ID:`, binanceProcessedResponse?.orderResult?.orderId);
                    console.log(`[PositionManager] 🔍 [VIRTUAL_CLOSE_DETECTED] Virtual close executed qty:`, binanceProcessedResponse?.orderResult?.executedQty);
                    
                    // For virtual close, we need to actually close the position in the database
                    console.log(`[PositionManager] [debug_next] 🔄 [VIRTUAL_CLOSE_PROCESSING] Processing virtual close for position in database...`);
                    try {
                        // Update position status to closed with timeout
                        // LivePosition already imported at top of file
                        
                        const updatePromise = LivePosition.update(position.id, {
                            status: 'closed',
                            exit_reason: binanceProcessedResponse?.reason || 'virtual_close',
                            exit_timestamp: new Date().toISOString(),
                            exit_price: currentPrice,
                            pnl_usdt: 0, // Virtual close with no PnL
                            pnl_percentage: 0
                        });
                        
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Database update timeout after 5 seconds')), 5000)
                        );
                        
                        const updateResult = await Promise.race([updatePromise, timeoutPromise]);
                        console.log(`[PositionManager] [debug_next] ✅ [VIRTUAL_CLOSE_PROCESSING] Position ${position.id} updated to closed status`);
                        console.log(`[PositionManager] [debug_next] 🔍 [VIRTUAL_CLOSE_PROCESSING] Update result:`, updateResult);
                    } catch (updateError) {
                        console.log(`[PositionManager] [debug_next] ❌ [VIRTUAL_CLOSE_PROCESSING] Failed to update position status:`, updateError);
                        // Don't fail the entire operation for database update errors
                    }
                    
                    return { success: true, orderResult: binanceProcessedResponse.orderResult, isVirtualClose: true };
                }

                if (binanceProcessedResponse?.orderId) {
                    // ✅ LOG: Confirmation of SELL execution (main success path)
                    const executedQty = binanceProcessedResponse.executedQty || requestedQty;
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] SELL executed successfully on Binance (main path):`);
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Order ID: ${binanceProcessedResponse.orderId}`);
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Executed Quantity: ${executedQty}`);
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Symbol: ${symbolKey}`);
                    
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
                    console.log(`[PositionManager] ✅ [BINANCE_SELL_CONFIRMATION] Execution Price: ${execPrice}`);

                    const suffix = this._formatCloseReasonAndPnl({
                        exitReason: options?.exitReason || position?.exit_reason,
                        pnlUsdt: options?.pnl_usdt ?? options?.pnlUsd ?? position?.pnl_usdt,
                        pnlPercentage: options?.pnl_percentage ?? options?.pnlPercent ?? position?.pnl_percentage,
                    });

                    this.addLog(
                        `${logPrefix} ✅ SELL executed on Binance: Order ${binanceProcessedResponse.orderId}, qty=${executedQty.toFixed(8)} ${symbolKey}${priceLabel}${suffix}`,
                        'success',
                        { level: 2 }
                    );
                } else {
                    throw new Error('Binance order did not return an orderId, despite no explicit error.');
                }
                log('🟢 _executeBinanceMarketSellOrder called', 'success', { symbol: symbolKey, positionQty });
                return { success: true, orderResult: binanceProcessedResponse }; // Return the raw processed response

            } catch (err) {
                // ✅ CRITICAL: Log error immediately to see what we're dealing with
                log('❌ [ERROR_CAUGHT] Error caught in _executeBinanceMarketSellOrder', 'error', {
                    errorType: typeof err,
                    errorMessage: err?.message,
                    errorCode: err?.code,
                    responseStatus: err?.response?.status,
                    fullError: err
                });
                // NEW: Post-timeout/order-unknown confirmation. If the SELL failed due to timeout/network,
                // check recent orders immediately to see if Binance filled it anyway.
                try {
                    const msgLc = String(err?.message || '').toLowerCase();
                    const looksLikeTimeout = msgLc.includes('timeout') || msgLc.includes('network') || msgLc.includes('fetch') || err?.response?.status === 0;
                    if (looksLikeTimeout) {
                        console.log('[PositionManager] ⏳ [POST_TIMEOUT_CHECK] Timeout/network during SELL. Polling recent orders for confirmation...');
                        const { functions } = await import('@/api/localClient');
                        const startedAt = Date.now();
                        let confirmed = null;
                        // Poll up to ~10s (5 attempts, 2s apart)
                        for (let attempt = 1; attempt <= 5; attempt++) {
                            try {
                                const resp = await functions.liveTradingAPI({
                                    action: 'getAllOrders',
                                    tradingMode: tradingMode,
                                    proxyUrl: proxyUrl,
                                    symbol: symbolKey,
                                    limit: 20
                                });
                                const orders = Array.isArray(resp?.data?.data) ? resp.data.data : (resp?.data?.data ? [resp.data.data] : []);
                                const cutoff = Date.now() - 60_000; // last 60s
                                const filledSell = orders.find(o => o.symbol === symbolKey && o.side === 'SELL' && o.status === 'FILLED' && (new Date(o.updateTime || o.time || o.transactTime).getTime() >= cutoff));
                                if (filledSell) {
                                    confirmed = filledSell;
                                    console.log('[PositionManager] ✅ [POST_TIMEOUT_CHECK] Found FILLED SELL after timeout:', { orderId: filledSell.orderId, qty: filledSell.executedQty });
                                    break;
                                }
                            } catch (pollErr) {
                                console.warn('[PositionManager] ⚠️ [POST_TIMEOUT_CHECK] Poll error:', pollErr?.message || pollErr);
                            }
                            await new Promise(r => setTimeout(r, 2000));
                        }
                        if (confirmed) {
                            const execQty = Number(confirmed.executedQty || positionQty) || positionQty;
                            this.addLog(`${logPrefix} ✅ SELL confirmed on Binance after timeout: Order ${confirmed.orderId}, qty=${execQty} ${symbolKey}`, 'success');
                            // Return as success so batch close proceeds with normal post-processing
                            return { success: true, orderResult: confirmed, wasPostTimeoutConfirm: true };
                        } else {
                            console.log('[PositionManager] ⏳ [POST_TIMEOUT_CHECK] No FILLED SELL found within window. Proceeding to error handling. Elapsed ms:', Date.now() - startedAt);
                        }
                    }
                } catch (postTimeoutErr) {
                    console.warn('[PositionManager] ⚠️ [POST_TIMEOUT_CHECK] Failed:', postTimeoutErr?.message || postTimeoutErr);
                }
                
                const { code, message } = parseErr(err);
                const msg = (message || "").toLowerCase();

                // 5) Single retry if insufficient balance, filter violations, or 400-like scenarios
                const isInsufficient = code === -2010 || msg.includes("insufficient balance");
                // CRITICAL FIX: Add -1013 error detection for LOT_SIZE/MIN_NOTIONAL filter violations
                const isFilterViolation = code === -1013 || 
                    msg.includes('lot_size') || 
                    msg.includes('min_notional') ||
                    msg.includes('filter');  // Generic filter violation
                const is400 = (err?.response?.status === 400);

                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] Parsed error details:`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] code=${code}, message=${message}`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] msg=${msg}`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] isInsufficient=${isInsufficient}, isFilterViolation=${isFilterViolation}, is400=${is400}`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] isClosingContext=${isClosingContext}, symbol=${symbolKey}`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] Will enter error handling: ${isInsufficient || isFilterViolation || is400}`);
                console.log(`[PositionManager] 🔍 [ERROR_ANALYSIS] About to check error conditions...`);

                // Handle insufficient balance, filter violations, or 400 errors
                if (isInsufficient || isFilterViolation || is400) {
                    console.log(`[PositionManager] ✅ [ERROR_HANDLING] Entered error handling block for ${symbolKey}`);
                    console.log(`[PositionManager] 🔍 [ERROR_HANDLING] Error types: isInsufficient=${isInsufficient}, isFilterViolation=${isFilterViolation}, is400=${is400}`);
                    
                    // Ensure a virtual-close attempt happens immediately for -2010 insufficient balance
                    // regardless of any subsequent retry/dust logic.
                    let _vc_attempted_early = false;
                    if (isInsufficient) {
                        try {
                            console.log('[PositionManager] 🔄 [VIRTUAL_CLOSE_EARLY] Calling walletReconciliation("virtualCloseDustPositions") due to -2010/insufficient balance...');
                            const _vc_attempt_start_early = Date.now();
                            await queueFunctionCall(
                                'walletReconciliation',
                                walletReconciliation,
                                { action: 'virtualCloseDustPositions', symbol: symbolWithSlash, mode: tradingMode },
                                'critical',
                                null,
                                0,
                                15000
                            );
                            console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] early_walletReconciliation_ms:', Date.now() - _vc_attempt_start_early);
                            _vc_attempted_early = true;
                            // Refresh client-side positions cache so UI reflects deletions immediately
                            try {
                                const initialPositionCount = this.positions?.length || 0;
                                const refreshed = await LivePosition.filter({ trading_mode: tradingMode, status: 'open' }, '-created_date', 500);
                                this.positions = Array.isArray(refreshed) ? refreshed : [];
                                console.log(`🔥🔥🔥 POSITIONS IN MEMORY: ${initialPositionCount} → ${this.positions.length} (removed ${initialPositionCount - this.positions.length}) 🔥🔥🔥`);
                            } catch (refreshErr) {
                                console.warn('[PositionManager] ⚠️ [POST_VC_REFRESH] Failed to reload positions after early VC:', refreshErr?.message);
                            }
                        } catch (earlyVcErr) {
                            console.warn('[PositionManager] ⚠️ [VIRTUAL_CLOSE_EARLY] walletReconciliation failed, falling back to performDirectVirtualClose:', earlyVcErr?.message);
                            try {
                                const _dvc_attempt_start_early = Date.now();
                                await this.performDirectVirtualClose(symbolKey, tradingMode, positionQty);
                                console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] early_performDirectVirtualClose_ms:', Date.now() - _dvc_attempt_start_early);
                                _vc_attempted_early = true;
                            } catch (dvcEarlyErr) {
                                console.error('[PositionManager] ❌ [VIRTUAL_CLOSE_EARLY] performDirectVirtualClose failed:', dvcEarlyErr?.message);
                            }
                        }
                    }
                    
                    // Enhanced logging for filter violations
                    if (isFilterViolation) {
                        console.log(`[PositionManager] 🧹 [DUST_FILTER_VIOLATION] ${symbolKey} - Binance error -1013 (LOT_SIZE/MIN_NOTIONAL violation)`);
                        this.addLog(
                            `${logPrefix} 🧹 Filter violation detected for ${symbolKey} (error -1013). Position below exchange minimums - treating as dust.`,
                            'warning'
                        );
                    }
                    
                    // ⚡ CRITICAL FIX: Check Binance order history FIRST (before retry skip)
                    // This prevents skipping positions that were already closed on Binance
                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_DECISION] Checking conditions for order history check...`);
                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_DECISION] isClosingContext=${isClosingContext}, willCheck=${isClosingContext && (isInsufficient || isFilterViolation)}`);
                    
                    if (isClosingContext && (isInsufficient || isFilterViolation)) {
                        const errorType = isFilterViolation ? 'Filter violation' : 'Insufficient balance';
                        console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] START: ${errorType} error in closing context for ${symbolKey}`);
                        console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Position details: positionQty=${positionQty}, symbol=${symbolKey}`);
                        this.addLog(
                            `${logPrefix} 🔍 Checking Binance order history to verify if position ${symbolKey} was already closed...`,
                            "info"
                        );
                        
                        let orderHistoryCheckRan = false;
                        let orderHistoryCheckResult = null;
                        let orderAlreadyExecuted = false;
                        let existingOrder = null;
                        
                        try {
                            orderHistoryCheckRan = true;
                            console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Fetching recent orders from Binance...`);
                            
                            // Check recent SELL orders to see if this position was already closed
                            const { functions } = await import('@/api/localClient');
                            console.log('[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Functions imported successfully:', !!functions?.liveTradingAPI);
                        const recentOrdersResponse = await functions.liveTradingAPI({
                            action: 'getAllOrders',
                            tradingMode: tradingMode,
                            proxyUrl: proxyUrl,
                            symbol: symbolKey,
                                limit: 50 // Increased to check more orders
                        });
                        
                        if (recentOrdersResponse?.data?.success && recentOrdersResponse.data.data) {
                            const recentOrders = Array.isArray(recentOrdersResponse.data.data) 
                                ? recentOrdersResponse.data.data 
                                : [recentOrdersResponse.data.data];
                            
                                console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Received ${recentOrders.length} total orders from Binance`);
                                
                                // Look for recent SELL orders for this symbol with similar quantity
                                // Extended time window to last 2 hours to catch positions closed in recent cycles
                                const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
                                const recentSellOrders = recentOrders.filter(order => {
                                    const isSell = order.symbol === symbolKey && order.side === 'SELL';
                                    const isFilled = order.status === 'FILLED';
                                    const isRecent = new Date(order.time || order.updateTime || order.transactTime).getTime() > twoHoursAgo;
                                    return isSell && isFilled && isRecent;
                                });
                                
                                console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Found ${recentSellOrders.length} recent FILLED SELL orders for ${symbolKey} (last 2 hours)`);
                                console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Checking quantity matches for positionQty=${positionQty}...`);
                                
                                recentSellOrders.forEach((order, index) => {
                                    const orderQty = parseFloat(order.executedQty || order.origQty || 0);
                                    const orderTime = new Date(order.time || order.updateTime || order.transactTime).toISOString();
                                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Order #${index + 1}: orderId=${order.orderId}, qty=${orderQty}, time=${orderTime}`);
                                });
                                
                                // Check if any recent SELL order has a quantity close to our position quantity
                                const tolerance = Math.max(positionQty * 0.2, 0.1); // 20% tolerance or 0.1 minimum
                                console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Matching tolerance: ${tolerance} (20% of ${positionQty})`);
                                
                                const matchingOrder = recentSellOrders.find(order => {
                                    const orderQty = parseFloat(order.executedQty || order.origQty || 0);
                                    const qtyDiff = Math.abs(orderQty - positionQty);
                                    const matches = qtyDiff <= tolerance;
                                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Order ${order.orderId}: qty=${orderQty}, diff=${qtyDiff.toFixed(8)}, tolerance=${tolerance}, matches=${matches ? '✅ YES' : '❌ NO'}`);
                                    return matches;
                                });
                                
                                if (matchingOrder) {
                                    const matchQty = parseFloat(matchingOrder.executedQty || matchingOrder.origQty || 0);
                                    const matchTime = new Date(matchingOrder.time || matchingOrder.updateTime || matchingOrder.transactTime).toISOString();
                                    console.log('[PositionManager] ✅ [ORDER_HISTORY_CHECK] MATCH FOUND! Position was already closed on Binance');
                                    console.log(`[PositionManager] ✅ [ORDER_HISTORY_CHECK] Matching order: orderId=${matchingOrder.orderId}, qty=${matchQty}, time=${matchTime}`);
                                    console.log('[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Returning success result to skip position closing...');
                                this.addLog(
                                        `${logPrefix} ✅ Position ${symbolKey} was already closed on Binance (found matching SELL order ${matchingOrder.orderId}, qty=${matchQty}, time=${matchTime})`,
                                    "success"
                                );
                                    orderHistoryCheckResult = { found: true, order: matchingOrder };
                                    console.log('[PositionManager] 🔍 [ORDER_HISTORY_CHECK] About to return success result...');
                                    // Set flag to return after try-catch
                                    orderAlreadyExecuted = true;
                                    existingOrder = matchingOrder;
                                } else {
                                    console.log(`[PositionManager] ❌ [ORDER_HISTORY_CHECK] NO MATCH FOUND - No recent SELL orders match position quantity ${positionQty}`);
                                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Recent sell orders count: ${recentSellOrders.length}`);
                                    console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] Will proceed with virtual close...`);
                                    orderHistoryCheckResult = { found: false, recentSellOrdersCount: recentSellOrders.length };
                                }
                            } else {
                                console.log(`[PositionManager] ⚠️ [ORDER_HISTORY_CHECK] Could not fetch orders: ${recentOrdersResponse?.data?.error || 'Unknown error'}`);
                                orderHistoryCheckResult = { found: false, error: 'Could not fetch orders' };
                            }
                        } catch (orderCheckError) {
                            console.log('[PositionManager] ❌ [ORDER_HISTORY_CHECK] ERROR:', orderCheckError.message);
                            console.log('[PositionManager] ❌ [ORDER_HISTORY_CHECK] Stack:', orderCheckError.stack);
                            this.addLog(
                                `${logPrefix} ⚠️ Could not verify order history: ${orderCheckError.message}`,
                                "warning"
                            );
                            orderHistoryCheckResult = { found: false, error: orderCheckError.message };
                        }
                        
                        console.log(`[PositionManager] 🔍 [ORDER_HISTORY_CHECK] COMPLETE: ran=${orderHistoryCheckRan}, result=`, orderHistoryCheckResult);
                        
                        // Check if order was already executed
                        if (orderAlreadyExecuted && existingOrder) {
                            console.log('[PositionManager] ✅ [ORDER_HISTORY_CHECK] Order already executed, returning success result');
                            return { success: true, orderResult: existingOrder, skipped: true, reason: "already_executed" };
                        }
                    }
                    
                    // If order history check didn't find a match, proceed with retry logic
                    this.addLog(
                        `${logPrefix} ⚠️ First SELL attempt failed for ${symbolKey} (code=${code || "n/a"}). ` +
                        `Order history check completed. Refreshing balance and retrying once...`,
                        "signal_mismatch"
                    );
                    
                    // DUST CONVERSION - Original App Implementation
                    // Trigger for both insufficient balance (-2010) and filter violations (-1013)
                    if (!_vc_attempted_early && ((isInsufficient && code === -2010) || (isFilterViolation && code === -1013))) {
                        const dustReason = isInsufficient ? 'insufficient balance' : 'filter violation';
                        console.log(`[PositionManager] 🔄 Attempting dust conversion for ${dustReason}...`);
                        try {
                            console.log('[PositionManager] 🔍 [DUST_CONVERSION] About to call attemptDustConvert with 10 second timeout...');
                            
                            const dustConvertPromise = attemptDustConvert(tradingMode, proxyUrl);
                            const dustConvertTimeout = new Promise((_, reject) => {
                                setTimeout(() => reject(new Error('attemptDustConvert timeout after 10 seconds')), 10000);
                            });
                            
                            const dustConvertResult = await Promise.race([dustConvertPromise, dustConvertTimeout]);
                            console.log('[PositionManager] 🔍 [DUST_CONVERSION] attemptDustConvert completed successfully');
                            
                            if (dustConvertResult.ok) {
                                console.log('[PositionManager] ✅ Dust conversion successful:', dustConvertResult.data);
                                this.addLog(`${logPrefix} ✅ Dust conversion successful for ${symbolKey}`, 'success');
                            } else {
                                console.log('[PositionManager] ⚠️ Dust conversion failed:', dustConvertResult.error);
                                this.addLog(`${logPrefix} ⚠️ Dust conversion failed: ${dustConvertResult.error}`, 'warning');
                            }
                        } catch (dustError) {
                            console.log('[PositionManager] ❌ Dust conversion error:', dustError);
                            this.addLog(`${logPrefix} ❌ Dust conversion error: ${dustError.message}`, 'error');
                        }

                        // VIRTUAL POSITION CLOSING - After dust conversion attempt
                        console.log('[PositionManager] 🔄 [VIRTUAL_CLOSE_START] Attempting virtual position closing for dust...');
                        const _vc_overall_start = Date.now();
                        console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] overall_start_ms:', _vc_overall_start);
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] Symbol:', symbolKey, 'Mode:', tradingMode);
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] Position details:', { positionQty, symbolKey, isClosingContext });
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] About to enter virtual close try-catch block...');
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] IsInsufficient:', isInsufficient, 'Code:', code);
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] Will attempt virtual close:', isInsufficient && code === -2010);
                        console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_DEBUG] About to enter try block for virtual close...');
                        
                        try {
                            // Try the original walletReconciliation function first
                            let virtualCloseResult = null;
                            let _vc_attempt_start = null;
                            try {
                                console.log('[PositionManager] 🔄 [VIRTUAL_CLOSE_ATTEMPT] Trying walletReconciliation function...');
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] About to call queueFunctionCall with 15 second timeout...');
                                _vc_attempt_start = Date.now();
                                
                                // Add timeout to prevent hanging
                                // Use queueFunctionCall with built-in timeout instead of Promise.race
                                virtualCloseResult = await queueFunctionCall(
                                'walletReconciliation',
                                walletReconciliation,
                                {
                                    action: 'virtualCloseDustPositions',
                                    symbol: symbolWithSlash,
                                    mode: tradingMode
                                },
                                'critical',
                                null,
                                0,
                                    15000  // Built-in timeout of 15 seconds
                                );
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] walletReconciliation completed successfully');
                                console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] walletReconciliation_ms:', Date.now() - _vc_attempt_start);
                                if (virtualCloseResult && Array.isArray(virtualCloseResult.logs)) {
                                    for (const entry of virtualCloseResult.logs) {
                                        console.log('[PROXY→CLIENT] [VC_LOG]', entry.msg, entry.data || {}, `ts=${entry.ts}`);
                                    }
                                }
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] walletReconciliation result:', virtualCloseResult);
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] Result type:', typeof virtualCloseResult);
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] Success property:', virtualCloseResult?.success);
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_ATTEMPT] VirtualClosed property:', virtualCloseResult?.virtualClosed);
                            } catch (walletReconError) {
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_ATTEMPT] walletReconciliation failed:', walletReconError.message);
                                console.log('[PositionManager] 🔄 [VIRTUAL_CLOSE_FALLBACK] Trying direct virtual close...');
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_FALLBACK] About to call performDirectVirtualClose with:', {
                                    symbol: symbolKey,
                                    mode: tradingMode,
                                    qty: positionQty
                                });
                                
                                // Fallback: Direct virtual close implementation with timeout
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_FALLBACK] About to call performDirectVirtualClose with 10 second timeout...');
                                const _dvc_start = Date.now();
                                
                                const directVirtualClosePromise = this.performDirectVirtualClose(symbolKey, tradingMode, positionQty);
                                const directVirtualCloseTimeout = new Promise((_, reject) => {
                                    setTimeout(() => reject(new Error('performDirectVirtualClose timeout after 10 seconds')), 10000);
                                });
                                
                                virtualCloseResult = await Promise.race([directVirtualClosePromise, directVirtualCloseTimeout]);
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_FALLBACK] performDirectVirtualClose completed successfully');
                                console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] performDirectVirtualClose_ms:', Date.now() - _dvc_start);
                                console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_FALLBACK] performDirectVirtualClose returned:', virtualCloseResult);
                            }

                            console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_RESULT] Raw result:', virtualCloseResult);
                            console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_RESULT] Type:', typeof virtualCloseResult);
                            console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_RESULT] Success property:', virtualCloseResult?.success);
                            console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_RESULT] VirtualClosed property:', virtualCloseResult?.virtualClosed);
                            console.log('[PositionManager] 🔍 [VIRTUAL_CLOSE_RESULT] About to check if virtual close was successful...');

                            if (virtualCloseResult && virtualCloseResult.success) {
                                console.log(`[PositionManager] ✅ [VIRTUAL_CLOSE_SUCCESS] Virtual closure successful: ${virtualCloseResult.virtualClosed} positions closed`);
                                console.log('[PositionManager] ⏱️ [VIRTUAL_CLOSE_TIMING] overall_virtual_close_ms:', Date.now() - _vc_overall_start);
                                console.log(`[PositionManager] 🔍 [VIRTUAL_CLOSE_SUCCESS] Full result details:`, virtualCloseResult);
                                this.addLog(`${logPrefix} ✅ Virtual closure successful: ${virtualCloseResult.virtualClosed} positions closed`, 'success');
                                // Refresh client-side positions cache so UI reflects deletions immediately
                                try {
                                    const initialPositionCount = this.positions?.length || 0;
                                    const refreshed = await LivePosition.filter({ trading_mode: tradingMode, status: 'open' }, '-created_date', 500);
                                    this.positions = Array.isArray(refreshed) ? refreshed : [];
                                    console.log(`🔥🔥🔥 POSITIONS IN MEMORY: ${initialPositionCount} → ${this.positions.length} (removed ${initialPositionCount - this.positions.length}) 🔥🔥🔥`);
                                } catch (refreshErr) {
                                    console.warn('[PositionManager] ⚠️ [POST_VC_REFRESH] Failed to reload positions after VC:', refreshErr?.message);
                                }
                                
                                // CRITICAL: Verify positions were actually closed in database
                                console.log(`[PositionManager] 🔍 [POSITION_VERIFICATION] Checking if positions were actually closed in database...`);
                                try {
                                    // LivePosition already imported at top of file
                                    const remainingPositions = await LivePosition.filter(
                                        { symbol: symbolKey, trading_mode: tradingMode, status: 'open' },
                                        '-created_date',
                                        10
                                    );
                                    console.log(`[PositionManager] 🔍 [POSITION_VERIFICATION] Remaining open positions for ${symbolKey}:`, remainingPositions?.length || 0);
                                    if (remainingPositions && remainingPositions.length > 0) {
                                        console.log(`[PositionManager] ❌ [POSITION_VERIFICATION] WARNING: ${remainingPositions.length} positions still open after virtual close!`);
                                        console.log(`[PositionManager] 🔍 [POSITION_VERIFICATION] Remaining position IDs:`, remainingPositions.map(p => p.id));
                                    } else {
                                        console.log(`[PositionManager] ✅ [POSITION_VERIFICATION] All positions successfully closed in database`);
                                    }
                                } catch (verifyError) {
                                    console.log(`[PositionManager] ❌ [POSITION_VERIFICATION] Error verifying position closure:`, verifyError);
                                }
                                
                                // Trigger wallet state reconciliation after virtual closing
                                try {
                                    console.log('[PositionManager] 🔄 [WALLET_RECONCILE] Triggering wallet state reconciliation...');
                                    await queueFunctionCall(
                                        'reconcileWalletState',
                                        reconcileWalletState,
                                        { mode: tradingMode },
                                        'normal',
                                        null,
                                        0,
                                        30000
                                    );
                                    console.log('[PositionManager] ✅ [WALLET_RECONCILE] Wallet state reconciled after virtual closure');
                                } catch (reconcileError) {
                                    console.warn('[PositionManager] ⚠️ [WALLET_RECONCILE] Wallet reconciliation failed after virtual closure:', reconcileError.message);
                                }
                            } else {
                                const errorMsg = virtualCloseResult?.error || 'Unknown error';
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] Virtual closure failed:', errorMsg);
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] Full result object:', virtualCloseResult);
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] Result type:', typeof virtualCloseResult);
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] Result success:', virtualCloseResult?.success);
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] Result error:', virtualCloseResult?.error);
                                console.log('[PositionManager] ⚠️ [VIRTUAL_CLOSE_FAILED] About to check position status...');
                                this.addLog(`${logPrefix} ⚠️ Virtual closure failed: ${errorMsg}`, 'warning');
                                
                                // CRITICAL: Check if positions are still open after failed virtual close
                                console.log(`[PositionManager] 🔍 [FAILED_VIRTUAL_CLOSE_VERIFICATION] Checking position status after failed virtual close...`);
                                try {
                                    // LivePosition already imported at top of file
                                    const remainingPositions = await LivePosition.filter(
                                        { symbol: symbolKey, trading_mode: tradingMode, status: 'open' },
                                        '-created_date',
                                        10
                                    );
                                    console.log(`[PositionManager] 🔍 [FAILED_VIRTUAL_CLOSE_VERIFICATION] Positions still open for ${symbolKey}:`, remainingPositions?.length || 0);
                                    if (remainingPositions && remainingPositions.length > 0) {
                                        console.log(`[PositionManager] ❌ [FAILED_VIRTUAL_CLOSE_VERIFICATION] ${remainingPositions.length} positions remain open after failed virtual close`);
                                        console.log(`[PositionManager] 🔍 [FAILED_VIRTUAL_CLOSE_VERIFICATION] Open position IDs:`, remainingPositions.map(p => p.id));
                                    }
                                } catch (verifyError) {
                                    console.log(`[PositionManager] ❌ [FAILED_VIRTUAL_CLOSE_VERIFICATION] Error checking position status:`, verifyError);
                                }
                            }
                        } catch (virtualError) {
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] Virtual closure error:', virtualError);
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] Error type:', typeof virtualError);
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] Error message:', virtualError?.message);
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] Error stack:', virtualError?.stack);
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] Error details:', JSON.stringify(virtualError, null, 2));
                            console.log('[PositionManager] ❌ [VIRTUAL_CLOSE_ERROR] About to add error log...');
                            this.addLog(`${logPrefix} ❌ Virtual closure error: ${virtualError?.message || 'Unknown error'}`, 'error');
                        }
                    }
                    
                    // Refresh balance and recompute sell qty for retry
                    console.log(`[PositionManager] 🔄 [RETRY_LOGIC] Refreshing balance before retry for ${symbolKey}...`);
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] About to refresh balance for retry...`);
                    const fresh = await fetchFreshFreeBalance({ baseAsset, tradingMode, proxyUrl });
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] Fresh balance fetched:`, fresh);
                    // In closing context, use positionQty directly (not limited by free balance)
                    // The position was already opened, so we should try to close it regardless of current balance
                    let retryQty = positionQty;
                    retryQty = roundDownToStepSize(retryQty, stepSize); // This is a numeric value
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] Retry quantity calculated:`, retryQty);
                    const retryNotional = retryQty * Number(currentPrice || 0);

                    const retryBelowLot = minQty && retryQty < minQty - 1e-12;
                    const retryBelowNotional = minNotional && retryNotional < (minNotional - 1e-8);
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] Retry checks - Below lot:`, retryBelowLot, 'Below notional:', retryBelowNotional);

                    console.log(`[PositionManager] 🔄 [RETRY_LOGIC] Retry calculation: fresh=${fresh.toFixed(8)}, retryQty=${retryQty.toFixed(8)}, retryNotional=${retryNotional.toFixed(6)}, belowLot=${retryBelowLot}, belowNotional=${retryBelowNotional}`);

                    if (!Number.isFinite(retryQty) || retryQty <= 0 || retryBelowLot || retryBelowNotional) {
                        console.log(`[PositionManager] 🧹 [RETRY_LOGIC] SKIPPING RETRY: Quantity too small (fresh=${fresh.toFixed(8)}, retryQty=${retryQty.toFixed(8)})`);
                        console.log(`[PositionManager] 🔍 [RETRY_LOGIC] About to skip retry and return...`);
                        this.addLog(
                            `${logPrefix} 🧹 Retry skip for ${symbolKey}: fresh=${fresh.toFixed(8)}, qty=${retryQty.toFixed(8)}, notional=${retryNotional.toFixed(6)} ` +
                            `(minQty=${minQty}, minNotional=${minNotional})`,
                            "signal_not_found"
                        );
                        if (typeof this.reconcileWithBinance === "function") {
                            console.log(`[PositionManager] 🔄 [RETRY_LOGIC] Triggering reconciliation after retry skip...`);
                            this.reconcileWithBinance().catch(() => { });
                        }
                        console.log(`[PositionManager] 🔍 [RETRY_LOGIC] About to return skipped result...`);
                        return { skipped: true, reason: "retry_below_threshold", attemptedQty: retryQty };
                    }
                    
                    console.log(`[PositionManager] 🔄 [RETRY_LOGIC] Proceeding with retry: retryQty=${retryQty.toFixed(8)}`);
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] About to call attemptSell with retry quantity...`);
                    
                    const resp2 = await attemptSell(retryQty);
                    console.log(`[PositionManager] 🔍 [RETRY_LOGIC] attemptSell retry completed, processing response...`);
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

                // Unknown/other error: In closing context with insufficient balance, allow virtual closure
                // CRITICAL: In closing context, "insufficient balance" almost always means position was already sold
                if (isClosingContext && isInsufficient) {
                    console.log('[PositionManager] ✅ CLOSING CONTEXT: Insufficient balance detected, treating as already closed');
                    console.log('[PositionManager] 🔍 [CLOSING_CONTEXT_VIRTUAL] Creating virtual close result for position:', symbolKey);
                    console.log('[PositionManager] 🔍 [CLOSING_CONTEXT_VIRTUAL] Position quantity:', positionQty);
                    console.log('[PositionManager] 🔍 [CLOSING_CONTEXT_VIRTUAL] Current price:', currentPrice);
                    
                    this.addLog(
                        `${logPrefix} ⚠️ Position ${symbolKey} appears already closed on Binance (insufficient balance error). ` +
                        `Will proceed with virtual closure.`,
                        'warning'
                    );
                    
                    // Return a result that indicates the position should be closed virtually
                    const virtualCloseResult = { 
                        success: true, 
                        orderResult: { 
                            orderId: `virtual_close_${Date.now()}`,
                            executedQty: positionQty.toString(),
                            fills: [{ price: currentPrice.toString(), qty: positionQty.toString() }]
                        },
                        isVirtualClose: true,
                        reason: 'insufficient_balance_position_already_closed'
                    };
                    
                    console.log('[PositionManager] 🔍 [CLOSING_CONTEXT_VIRTUAL] Returning virtual close result:', virtualCloseResult);
                    return virtualCloseResult;
                }

                // Unknown/other error: rethrow so upstream handles it
                this.addLog(`${logPrefix} ❌ Critical error executing Binance market sell for ${position.symbol}: ${message}`, 'error', err);
                throw Object.assign(new Error(message), { code: code, isInsufficient: isInsufficient });
            }
        } catch (e) {
            // Keep existing error path and logging unchanged, but ensure a clear prefix
            const errorMessage = e?.message || 'Unknown error';
            const isInsufficientBalance = e.isInsufficient || errorMessage.toLowerCase().includes('insufficient balance');

            console.log(`[PositionManager] 🔍 [OUTER_CATCH] Error caught in outer catch block:`);
            console.log(`[PositionManager] 🔍 [OUTER_CATCH] Error message: ${errorMessage}`);
            console.log(`[PositionManager] 🔍 [OUTER_CATCH] isInsufficientBalance: ${isInsufficientBalance}`);
            console.log(`[PositionManager] 🔍 [OUTER_CATCH] isClosingContext: ${isClosingContext}`);
            console.log(`[PositionManager] 🔍 [OUTER_CATCH] Symbol: ${position?.symbol || "UNKNOWN"}`);
            console.log(`[PositionManager] 🔍 [OUTER_CATCH] About to check if virtual close should be attempted...`);

            // CRITICAL: Handle insufficient balance in closing context in outer catch block too
            if (isClosingContext && isInsufficientBalance) {
                console.log('[PositionManager] ✅ [OUTER_CATCH] CLOSING CONTEXT: Insufficient balance detected in outer catch, treating as already closed');
                this.addLog(
                    `${logPrefix} ⚠️ Position ${position?.symbol || "UNKNOWN"} appears already closed on Binance (insufficient balance error). ` +
                    `Will proceed with virtual closure.`,
                    'warning'
                );
                // Return a result that indicates the position should be closed virtually
                // Use fallback price if currentPrice is undefined
                const fallbackPrice = currentPrice || position?.entry_price || 0;
                return { 
                    success: true, 
                    orderResult: { 
                        orderId: `virtual_close_${Date.now()}`,
                        executedQty: positionQty.toString(),
                        fills: [{ price: fallbackPrice.toString(), qty: positionQty.toString() }]
                    },
                    isVirtualClose: true,
                    reason: 'insufficient_balance_position_already_closed'
                };
            }

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
        console.log('[PositionManager] 🔄 closePositionOnBinance CALLED');
        console.log('[PositionManager] 🔄 Position:', position);
        console.log('[PositionManager] 🔄 Exit price:', exitPrice);
        console.log('[PositionManager] 🔄 Is live mode:', this.isLiveMode());
        console.log('[PositionManager] 🔄 Is testnet mode:', this.isTestnetMode());
        
        if (this.isLiveMode() || this.isTestnetMode()) {
            try {
                const tradingMode = this.getTradingMode();
                const proxyUrl = this.scannerService.state.settings?.local_proxy_url;

                console.log('[PositionManager] 🔄 Trading mode:', tradingMode);
                console.log('[PositionManager] 🔄 Proxy URL:', proxyUrl);
                console.log('[PositionManager] 🔄 CALLING _executeBinanceMarketSellOrder...');

                // Pass exitPrice as currentPrice and other required parameters
                const binanceResult = await this._executeBinanceMarketSellOrder(position, { 
                    currentPrice: exitPrice, 
                    tradingMode, 
                    proxyUrl,
                    exitReason: position.exit_reason || 'timeout'
                });
                console.log('[PositionManager] 🔄 Binance result from _executeBinanceMarketSellOrder:', binanceResult);
                
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
            const activationThreshold = (takeProfitPercent * 0.5);
            const shouldActivateTrailing = !updatedPosition.is_trailing && updatedPosition.enableTrailingTakeProfit && profitPercent >= activationThreshold;

            if (shouldActivateTrailing) {
                // Initialize trailing stop at current price minus a buffer (e.g., 2% below current)
                const trailingBuffer = 0.02; // 2%
                updatedPosition.trailing_stop_price = currentPrice * (1 - trailingBuffer);
                updatedPosition.is_trailing = true;
                updatedPosition.trailing_peak_price = currentPrice;
                updatedPosition.status = 'trailing';
                
                this.scannerService.addLog(`[TRAILING] ✅ Activated trailing stop for ${position.symbol} at ${this._formatCurrency(updatedPosition.trailing_stop_price)} (profit=${profitPercent.toFixed(2)}%, threshold=${activationThreshold.toFixed(2)}%)`, 'success');
            } else if (!updatedPosition.is_trailing && updatedPosition.enableTrailingTakeProfit) {
                this.scannerService.addLog(`[TRAILING] ⏳ Not activated for ${position.symbol}: profit=${profitPercent.toFixed(2)}% < threshold=${activationThreshold.toFixed(2)}% (TP%=${takeProfitPercent.toFixed(2)}%)`, 'info');
            } else if (!updatedPosition.enableTrailingTakeProfit) {
                this.scannerService.addLog(`[TRAILING] 🚫 Disabled for ${position.symbol}`, 'info');
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
        console.log('[position_manager_debug] 🔍 ===== MONITOR_AND_CLOSE_POSITIONS ENTRY =====');
        console.log('[position_manager_debug] 🔍 Function called at:', new Date().toISOString());
        console.log('[position_manager_debug] 🔍 Current prices provided:', !!currentPrices);
        console.log('[PositionManager] 🔍 [EXECUTION_TRACE] step_3: monitorAndClosePositions entry point reached');
        console.log('[position_manager_debug] 🔍 Current prices keys:', currentPrices ? Object.keys(currentPrices).length : 0);
        console.log('[position_manager_debug] 🔍 isMonitoring flag:', this.isMonitoring);
        console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL TEST LOG - IF YOU SEE THIS, THE FUNCTION IS BEING CALLED');
        console.log('[position_manager_debug] 🔍 PositionManager instance:', !!this);
        console.log('[position_manager_debug] 🔍 Scanner service exists:', !!this.scannerService);
        console.log('[position_manager_debug] 🔍 Positions array length:', this.positions?.length || 0);
        
        // Prevent concurrent monitoring to avoid duplicate position processing
        if (this.isMonitoring) {
            console.log('[position_manager_debug] 🔍 Monitoring already in progress, skipping...');
            return { tradesToCreate: [], positionIdsToClose: [] };
        }
        
        this.isMonitoring = true;
        console.log('[position_manager_debug] 🔍 ===== MONITOR_AND_CLOSE_POSITIONS ENTRY =====');
        console.log('[position_manager_debug] 🔍 MONITORING POSITIONS - START');
        console.log('[position_manager_debug] 🔍 Scanner running:', this.scannerService.state.isRunning);
        console.log('[position_manager_debug] 🔍 Positions count:', this.positions.length);
        console.log('[position_manager_debug] 🔍 Current prices available:', currentPrices ? Object.keys(currentPrices).length : 0);
        console.log('[position_manager_debug] 🔍 Sample positions being monitored:', this.positions.slice(0, 3).map(p => ({
            id: p.id,
            db_record_id: p.db_record_id,
            position_id: p.position_id,
            symbol: p.symbol,
            status: p.status,
            entry_timestamp: p.entry_timestamp
        })));
        console.log('[position_manager_debug] 🔍 MONITORING FUNCTION CALLED - TIMESTAMP:', new Date().toISOString());
        console.log('[position_manager_debug] 🔍 MONITORING FUNCTION CALLED - THIS IS A TEST LOG TO VERIFY FUNCTION IS BEING CALLED');
        console.log('[position_manager_debug] 🔍 About to start position monitoring loop...');
        
        // Initialize local arrays for this cycle - MOVED OUTSIDE TRY BLOCK TO FIX SCOPE ISSUE
        const tradesToCreate = [];
        const positionIdsToClose = [];
        const positionsToUpdate = [];  // For tracking updates (peak, trough, trailing stop)
        const reconciliationNeeded = [];  // Track positions without prices for later reconciliation
        let uniquePositionIdsToClose = [];
        
        try {
            // CRITICAL FIX: Clean up ghost positions BEFORE attempting to close them
            console.log('[position_manager_debug] 🔍 Checking for ghost positions before monitoring...');
            console.log('[position_manager_debug] 🔍 About to call reconcileWithBinance...');
            
            // Add timeout to reconcileWithBinance to prevent hanging
            const reconcilePromise = this.reconcileWithBinance();
            const reconcileTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('reconcileWithBinance timeout after 15 seconds')), 15000);
            });
            
            console.log('[position_manager_debug] 🔍 Starting reconcileWithBinance with timeout...');
            const reconcileResult = await Promise.race([reconcilePromise, reconcileTimeout]);
            console.log('[position_manager_debug] 🔍 reconcileWithBinance completed successfully');
            
            if (reconcileResult.success && reconcileResult.summary.ghostPositionsCleaned > 0) {
                console.log(`[position_manager_debug] 🧹 Cleaned ${reconcileResult.summary.ghostPositionsCleaned} ghost positions`);
                this.addLog(`[MONITOR] 🧹 Cleaned ${reconcileResult.summary.ghostPositionsCleaned} ghost positions before monitoring`, 'info');
            }
            
            // DEBUG: Log current positions after reconciliation
            console.log('[position_manager_debug] 🔍 Positions after reconciliation:', this.positions.length);
            console.log('[position_manager_debug] 🔍 About to start position monitoring loop...');
            console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - IF YOU SEE THIS, RECONCILIATION COMPLETED');
            
            if (this.positions.length > 0) {
                console.log('[position_manager_debug] 🔍 Sample positions after reconciliation:', this.positions.slice(0, 3).map(p => ({
                    symbol: p.symbol,
                    position_id: p.position_id,
                    quantity_crypto: p.quantity_crypto,
                    status: p.status
                })));
            }
            
            // DEBUG: Log position details for first 3 positions
            if (this.positions.length > 0) {
                console.log('[PositionManager] 🔍 Sample positions (first 3):', this.positions.slice(0, 3).map(p => ({
                    symbol: p.symbol,
                    position_id: p.position_id,
                    entry_timestamp: p.entry_timestamp,
                    time_exit_hours: p.time_exit_hours,
                    age_hours: ((Date.now() - new Date(p.entry_timestamp).getTime()) / (1000 * 60 * 60)).toFixed(2),
                    stop_loss_price: p.stop_loss_price,
                    take_profit_price: p.take_profit_price,
                    status: p.status,
                    shouldCloseByTime: ((Date.now() - new Date(p.entry_timestamp).getTime()) / (1000 * 60 * 60)) >= (p.time_exit_hours || 0)
                })));
            }

            const now = Date.now();
                
            // Early exit conditions
            const walletState = this.getActiveWalletState();
        
            // NEW: Early exit for wallet state (from outline)
            if (!walletState) {
                console.log('[PositionManager] ⚠️ No live wallet state available, skipping monitoring');
                this.addLog('[DEBUG_MONITOR] ℹ️ No live wallet state available, skipping monitoring', 'info');
                return { tradesToCreate: 0, positionIdsToClose: 0 }; // Adjusted return to match successful execution counts
            }
            const walletId = walletState.id; // From outline
            const mode = this.scannerService.getTradingMode(); // From outline
            // END NEW

            if (!this.scannerService.state.isRunning) {
                console.log('[PositionManager] ⚠️ Scanner service is not running, but monitoring positions for safety...');
                this.addLog('[POSITIONS_MONITOR] ⚠️ Scanner service is not running, but monitoring positions for safety.', 'warning');
                // Continue with monitoring for safety - don't return early
            }

            if (this.positions.length === 0) { // NEW check for empty this.positions
                console.log('[PositionManager] No positions to monitor');
                this.addLog('[DEBUG_MONITOR] No positions to monitor', 'debug');
                return { tradesToCreate: [], positionIdsToClose: [] };
            }

            if (!currentPrices || typeof currentPrices !== 'object' || Object.keys(currentPrices).length === 0) {
                console.log('[PositionManager] ⚠️ No current prices available for monitoring');
                this.addLog('[DEBUG_MONITOR] ⚠️ No current prices available for monitoring', 'warning');
                this.addLog('[POSITIONS_MONITOR] ⚠️ No valid price data available, skipping monitoring', 'warning');
                return { tradesToCreate: [], positionIdsToClose: [] };
            }

            // Logging from outline, adapted
            this.addLog(`[MONITOR] 🛡️ Monitoring ${this.positions.length} open positions in ${mode.toUpperCase()} wallet (ID: ${walletId}).`, 'scan', { level: 1 });
            // END Logging
            
            // DEBUG: Log only DOGE positions to reduce console flooding
            const dogePositions = this.positions.filter(p => p.symbol.includes('DOGE') || p.symbol.replace('/', '') === 'DOGEUSDT');
            if (dogePositions.length > 0) {
                console.log(`[MONITOR_DEBUG] ==========================================`);
                console.log(`[MONITOR_DEBUG] POSITION MONITORING STARTED`);
                console.log(`[MONITOR_DEBUG] ==========================================`);
                console.log(`[MONITOR_DEBUG] Total positions: ${this.positions.length}, DOGE positions: ${dogePositions.length}`);
                console.log(`[MONITOR_DEBUG] DOGE Positions:`, dogePositions.map(p => ({
                    symbol: p.symbol,
                    id: p.id,
                    position_id: p.position_id,
                    status: p.status,
                    cleanSymbol: p.symbol.replace('/', ''),
                    isDOGE: true
                })));
                console.log(`[MONITOR_DEBUG] ==========================================`);
            }

            const maxPositionAgeHours = 12; // Force close after 12 hours regardless of other conditions

            let positionsUpdatedButStillOpen = [];

            const pricesSource = currentPrices || this.scannerService.currentPrices || {};
            
            // eslint-disable-next-line no-unused-vars
            let loopIterations = 0;

            console.log('[position_manager_debug] 🔍 Starting main position monitoring loop...');
            console.log('[position_manager_debug] 🔍 About to iterate over', this.positions.length, 'positions');
            console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - STARTING POSITION LOOP');

            // Add timeout to position loop to prevent hanging
            const positionLoopTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Position loop timeout after 20 seconds')), 20000);
            });

            const positionLoopPromise = (async () => {
            for (const position of this.positions) { // Looping directly over this.positions
                loopIterations++;
                
                // DEBUG: Track position loop progress
                console.log(`[position_manager_debug] 🔍 Processing position ${loopIterations}/${this.positions.length}: ${position.symbol} (${position.status})`);
                
                // DEBUG: Log only DOGE positions to reduce console flooding
                if (position.symbol.includes('DOGE') || position.symbol.replace('/', '') === 'DOGEUSDT') {
                    console.log(`[POSITION_DEBUG] Processing DOGE position:`, {
                        symbol: position.symbol,
                        id: position.id,
                        position_id: position.position_id,
                        status: position.status,
                        cleanSymbol: position.symbol.replace('/', ''),
                        isDOGE: true
                    });
                }
                
                // CRITICAL FIX: Validate that position has an ID before processing
                if (!position.id) {
                    this.addLog('[DEBUG_MONITOR] ❌ CRITICAL: Position has no DB ID!', 'error', {
                        position_id: position.position_id,
                        symbol: position.symbol,
                        strategy_name: position.strategy_name,
                        hasDbRecordId: !!position.db_record_id,
                        dbRecordId: position.db_record_id
                    });
                    
                    // Try to fix the missing ID by using db_record_id if available
                    if (position.db_record_id) {
                        // Don't override position.id - it should already be set correctly
                        this.addLog(`[DEBUG_MONITOR] 🔧 Position has db_record_id: ${position.db_record_id}, position.id: ${position.id}`, 'info');
                    } else {
                    this.scannerService.addLog(
                        `[MONITOR] ⚠️ Skipping position ${position.symbol} - missing database ID`,
                        'warning'
                    );
                    continue;
                    }
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
                    let currentPrice = pricesSource[cleanSymbol];
                    
                    // CRITICAL FIX: If price is missing from pricesSource, try to fetch it dynamically
                    if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                        // Try to get price from scannerService.currentPrices
                        if (this.scannerService.currentPrices?.[cleanSymbol]) {
                            currentPrice = this.scannerService.currentPrices[cleanSymbol];
                        }
                        
                        // Try to get price from priceManagerService
                        if ((!currentPrice || isNaN(currentPrice) || currentPrice <= 0) && this.scannerService.priceManagerService) {
                            try {
                                const fetchedPrice = await this.scannerService.priceManagerService.getCurrentPrice(position.symbol);
                                if (fetchedPrice && !isNaN(fetchedPrice) && fetchedPrice > 0) {
                                    currentPrice = fetchedPrice;
                                    console.log(`[PositionManager] ✅ Fetched price for ${position.symbol}: ${currentPrice}`);
                                }
                            } catch (error) {
                                console.log(`[PositionManager] ⚠️ Could not fetch price for ${position.symbol}:`, error.message);
                            }
                        }
                        
                        // Skip if still no valid price
                if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                    this.scannerService.addLog(`[POSITION_MONITOR] ⚠️ Skipping ${position.symbol} (ID: ${position.position_id}) - invalid/missing price. Current price: ${currentPrice}.`, 'warning');
                    continue;
                        }
                }
                    
                    const entryTime = new Date(position.entry_timestamp).getTime();

                // DOGE-SPECIFIC SL/TP ANALYSIS for existing positions with debouncing
                if (cleanSymbol === 'DOGEUSDT' || position.symbol.includes('DOGE')) {
                    // Implement debouncing to prevent log flooding (only log every 10 seconds per position)
                    const now = Date.now();
                    const lastLogKey = `doge_log_${position.position_id}`;
                    const lastLogTime = this.lastDogeLogTimes?.[lastLogKey] || 0;
                    const logInterval = 10000; // 10 seconds
                    
                    if (now - lastLogTime < logInterval) {
                        // Skip logging if too recent
                        continue;
                    }
                    
                    // Update last log time
                    if (!this.lastDogeLogTimes) {
                        this.lastDogeLogTimes = {};
                    }
                    this.lastDogeLogTimes[lastLogKey] = now;
                    console.log('🐕 [DOGE_EXISTING] ==========================================');
                    console.log('🐕 [DOGE_EXISTING] EXISTING DOGE POSITION ANALYSIS');
                    console.log('🐕 [DOGE_EXISTING] ==========================================');
                    
                    // Get ATR data for DOGE with comprehensive debugging
                    const symbolIndicators = this.scannerService.state.indicators?.[cleanSymbol];
                    const atrData = symbolIndicators?.atr || [];
                    let atrValue = 0;
                    
                    // ATR Data Investigation - Debug all possible sources
                    console.log('🐕 [DOGE_EXISTING] ATR DATA INVESTIGATION:', {
                        cleanSymbol: cleanSymbol,
                        hasScannerService: !!this.scannerService,
                        hasState: !!this.scannerService?.state,
                        hasIndicators: !!this.scannerService?.state?.indicators,
                        indicatorsKeys: this.scannerService?.state?.indicators ? Object.keys(this.scannerService.state.indicators) : 'no indicators',
                        symbolIndicators: symbolIndicators,
                        hasSymbolIndicators: !!symbolIndicators,
                        symbolIndicatorsKeys: symbolIndicators ? Object.keys(symbolIndicators) : 'no symbol indicators',
                        atrData: atrData,
                        atrDataLength: atrData?.length || 0,
                        atrDataType: Array.isArray(atrData) ? 'Array' : typeof atrData,
                        atrDataSample: Array.isArray(atrData) && atrData.length > 0 ? atrData.slice(-3) : 'no data'
                    });
                    
                    if (Array.isArray(atrData) && atrData.length > 0) {
                        for (let i = atrData.length - 1; i >= 0; i--) {
                            if (atrData[i] !== null && atrData[i] !== undefined && !isNaN(atrData[i])) {
                                atrValue = atrData[i];
                                console.log('🐕 [DOGE_EXISTING] ✅ FOUND SYMBOL-SPECIFIC ATR:', {
                                    atrValue: atrValue,
                                    source: 'symbol-specific',
                                    index: i,
                                    totalLength: atrData.length
                                });
                                break;
                            }
                        }
                    }
                    
                    // Error if no ATR data found
                    if (atrValue === 0) {
                        console.error('🐕 [DOGE_EXISTING] ❌ ATR DATA MISSING:', {
                            cleanSymbol: cleanSymbol,
                            hasSymbolIndicators: !!symbolIndicators,
                            atrDataLength: atrData?.length || 0,
                            error: 'No valid ATR data found for DOGE position analysis'
                        });
                    }
                    
                    console.log('🐕 [DOGE_EXISTING] FINAL ATR VALUE:', {
                        atrValue: atrValue,
                        hasValue: atrValue > 0,
                        source: atrValue > 0 ? 'symbol-specific' : 'none'
                    });
                    
                    // Fix quantity access - use quantity_crypto as primary, fallback to quantity
                    const positionQuantity = position.quantity_crypto || position.quantity || 0;
                    
                    // NaN Protection: Validate all critical values before calculations
                    if (!positionQuantity || isNaN(positionQuantity) || positionQuantity <= 0) {
                        console.log('🐕 [DOGE_EXISTING] ⚠️ INVALID QUANTITY - Skipping calculations:', {
                            positionId: position.position_id,
                            quantity_crypto: position.quantity_crypto,
                            quantity: position.quantity,
                            positionQuantity: positionQuantity,
                            reason: 'Invalid or missing quantity data'
                        });
                        console.log('🐕 [DOGE_EXISTING] ==========================================');
                        continue; // Skip this position's detailed analysis
                    }
                    
                    if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                        console.log('🐕 [DOGE_EXISTING] ⚠️ INVALID PRICE - Skipping calculations:', {
                            positionId: position.position_id,
                            currentPrice: currentPrice,
                            reason: 'Invalid or missing price data'
                        });
                        console.log('🐕 [DOGE_EXISTING] ==========================================');
                        
                        // RECONCILIATION TRACKING: Add to reconciliationNeeded array
                        reconciliationNeeded.push({
                            position_id: position.position_id,
                            symbol: position.symbol,
                            reason: 'missing_price',
                            timestamp: new Date().toISOString()
                        });
                        this.addLog(
                            `[PRICE_VALIDATION] ⚠️ Price data missing for ${position.symbol} (ID: ${position.position_id.slice(-8)}). Added to reconciliation queue.`,
                            'warning'
                        );
                        continue; // Skip this position's detailed analysis
                    }
                    
                    console.log('🐕 [DOGE_EXISTING] Position Details:', {
                        symbol: position.symbol,
                        positionId: position.position_id,
                        entryPrice: position.entry_price,
                        currentPrice: currentPrice,
                        quantity: positionQuantity,
                        quantity_crypto: position.quantity_crypto,
                        quantity_fallback: position.quantity,
                        direction: position.direction || 'long',
                        status: position.status,
                        entryTime: position.entry_timestamp,
                        ageHours: ((now - entryTime) / (1000 * 60 * 60)).toFixed(2)
                    });
                    
                    console.log('🐕 [DOGE_EXISTING] Current SL/TP Status:', {
                        currentStopLoss: position.stop_loss_price || 'Not set',
                        currentTakeProfit: position.take_profit_price || 'Not set',
                        stopLossHit: position.stop_loss_price && currentPrice <= position.stop_loss_price,
                        takeProfitHit: position.take_profit_price && currentPrice >= position.take_profit_price,
                        distanceToSL: position.stop_loss_price ? Math.abs(currentPrice - position.stop_loss_price) : 'N/A',
                        distanceToTP: position.take_profit_price ? Math.abs(position.take_profit_price - currentPrice) : 'N/A'
                    });
                    
                    if (atrValue > 0) {
                        // Calculate ATR-based SL/TP recommendations
                        const stopLossMultiplier = position.stopLossAtrMultiplier || 2.5;
                        const takeProfitMultiplier = position.takeProfitAtrMultiplier || 3.0;
                        const direction = position.direction || 'long';
                        
                        const atrStopLoss = atrValue * stopLossMultiplier;
                        const atrTakeProfit = atrValue * takeProfitMultiplier;
                        
                        const recommendedStopLoss = direction === 'long' 
                            ? currentPrice - atrStopLoss 
                            : currentPrice + atrStopLoss;
                        const recommendedTakeProfit = direction === 'long' 
                            ? currentPrice + atrTakeProfit 
                            : currentPrice - atrTakeProfit;
                        
                        const stopLossPercent = (atrStopLoss / currentPrice * 100);
                        const takeProfitPercent = (atrTakeProfit / currentPrice * 100);
                        
                        console.log('🐕 [DOGE_EXISTING] ATR-Based Recommendations:', {
                            atrValue: atrValue,
                            atrAsPercentOfPrice: ((atrValue / currentPrice) * 100).toFixed(4) + '%',
                            recommendedStopLoss: `$${recommendedStopLoss.toFixed(6)}`,
                            recommendedTakeProfit: `$${recommendedTakeProfit.toFixed(6)}`,
                            stopLossPercent: `${stopLossPercent.toFixed(2)}%`,
                            takeProfitPercent: `${takeProfitPercent.toFixed(2)}%`,
                            currentVsRecommendedSL: position.stop_loss_price ? 
                                `Current: $${position.stop_loss_price.toFixed(6)} vs Recommended: $${recommendedStopLoss.toFixed(6)}` : 
                                'No current SL set',
                            currentVsRecommendedTP: position.take_profit_price ? 
                                `Current: $${position.take_profit_price.toFixed(6)} vs Recommended: $${recommendedTakeProfit.toFixed(6)}` : 
                                'No current TP set'
                        });
                        
                        // Calculate potential P&L using the corrected quantity with NaN protection
                        const potentialLoss = Math.abs(currentPrice - recommendedStopLoss) * positionQuantity;
                        const potentialProfit = Math.abs(recommendedTakeProfit - currentPrice) * positionQuantity;
                        const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;
                        
                        // Additional NaN protection for all calculated values
                        const positionValue = positionQuantity * currentPrice;
                        const maxLossPercent = positionValue > 0 ? (potentialLoss / positionValue * 100) : 0;
                        const maxProfitPercent = positionValue > 0 ? (potentialProfit / positionValue * 100) : 0;
                        
                        // Validate all calculations before logging
                        const safePositionValue = isNaN(positionValue) || positionValue <= 0 ? 0 : positionValue;
                        const safePotentialLoss = isNaN(potentialLoss) ? 0 : potentialLoss;
                        const safePotentialProfit = isNaN(potentialProfit) ? 0 : potentialProfit;
                        const safeRiskRewardRatio = isNaN(riskRewardRatio) ? 0 : riskRewardRatio;
                        const safeMaxLossPercent = isNaN(maxLossPercent) ? 0 : maxLossPercent;
                        const safeMaxProfitPercent = isNaN(maxProfitPercent) ? 0 : maxProfitPercent;
                        
                        console.log('🐕 [DOGE_EXISTING] Risk Analysis:', {
                            positionValue: `$${safePositionValue.toFixed(2)}`,
                            potentialLoss: `$${safePotentialLoss.toFixed(2)}`,
                            potentialProfit: `$${safePotentialProfit.toFixed(2)}`,
                            riskRewardRatio: `${safeRiskRewardRatio.toFixed(2)}:1`,
                            maxLossPercent: `${safeMaxLossPercent.toFixed(2)}%`,
                            maxProfitPercent: `${safeMaxProfitPercent.toFixed(2)}%`,
                            calculationStatus: 'All values validated and safe'
                        });
                        
                        // Check if current SL/TP needs adjustment
                        const slAdjustmentNeeded = position.stop_loss_price && 
                            Math.abs(position.stop_loss_price - recommendedStopLoss) > (atrValue * 0.1);
                        const tpAdjustmentNeeded = position.take_profit_price && 
                            Math.abs(position.take_profit_price - recommendedTakeProfit) > (atrValue * 0.1);
                        
                        console.log('🐕 [DOGE_EXISTING] Adjustment Recommendations:', {
                            slAdjustmentNeeded: slAdjustmentNeeded,
                            tpAdjustmentNeeded: tpAdjustmentNeeded,
                            slAdjustmentReason: slAdjustmentNeeded ? 'Current SL differs significantly from ATR-based recommendation' : 'SL is appropriate',
                            tpAdjustmentReason: tpAdjustmentNeeded ? 'Current TP differs significantly from ATR-based recommendation' : 'TP is appropriate',
                            recommendation: !position.stop_loss_price || !position.take_profit_price ? 
                                'Consider setting SL/TP based on ATR analysis' : 
                                'Current SL/TP settings appear appropriate'
                        });
                        
                    } else {
                        console.log('🐕 [DOGE_EXISTING] ⚠️ NO ATR DATA AVAILABLE:', {
                            issue: 'DOGE ATR not calculated or stored',
                            currentSL: position.stop_loss_price || 'Not set',
                            currentTP: position.take_profit_price || 'Not set',
                            recommendation: 'ATR data needed for optimal SL/TP calculation'
                        });
                    }
                    
                    console.log('🐕 [DOGE_EXISTING] ==========================================');
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
                    console.log(`[PositionManager] 🔍 FORCE CLOSE: Adding position to close list - db_record_id: ${position.db_record_id}, position.id: ${position.id}, symbol: ${cleanSymbol}`);
                    // Use the primary ID that matches what's in memory
                    const positionIdToClose = position.id || position.db_record_id || position.position_id;
                    positionIdsToClose.push(positionIdToClose);
                    console.log(`[PositionManager] 🔍 FORCE CLOSE: Pushed position ID: ${positionIdToClose}`);
                    continue;
                }

                // 2. (NEW) Specific time-based exit for this position's strategy
                if (tempPosition.time_exit_hours !== null && tempPosition.time_exit_hours !== undefined) {
                    const timeElapsedMs = now - entryTime;
                    const timeElapsedHours = timeElapsedMs / (1000 * 60 * 60);
                    const timeExitHours = tempPosition.time_exit_hours;

                    console.log(`[PositionManager] 🔍 Time check for ${cleanSymbol}:`, {
                        position_id: tempPosition.position_id,
                        time_exit_hours: timeExitHours,
                        timeElapsedHours: timeElapsedHours.toFixed(2),
                        entryTime: new Date(entryTime).toISOString(),
                        currentTime: new Date(now).toISOString(),
                        shouldClose: timeElapsedHours >= timeExitHours,
                        timeRemaining: (timeExitHours - timeElapsedHours).toFixed(2)
                    });

                    if (timeElapsedHours >= timeExitHours) {
                        console.log(`[PositionManager] ⏰ TIME EXIT TRIGGERED for ${cleanSymbol}:`, {
                            position_id: tempPosition.position_id,
                            timeElapsedHours: timeElapsedHours.toFixed(2),
                            timeExitHours: timeExitHours,
                            exitReason: 'timeout'
                        });
                        this.scannerService.addLog(`[MONITOR] ⏰ TIME EXIT for ${cleanSymbol} (ID: ${position.position_id}) - elapsed: ${timeElapsedHours.toFixed(2)}h, limit: ${timeExitHours}h`, 'info');
                        const tradeData = this._createTradeFromPosition(tempPosition, currentPrice, 'timeout', { custom_exit_message: `Time exit - elapsed: ${timeElapsedHours.toFixed(2)}h, limit: ${timeExitHours}h` });
                        tradesToCreate.push(tradeData);
                        console.log(`[PositionManager] 🔍 TIME EXIT: Adding position to close list - db_record_id: ${position.db_record_id}, position.id: ${position.id}, symbol: ${cleanSymbol}`);
                        // Use the primary ID that matches what's in memory
                        const positionIdToClose = position.id || position.db_record_id || position.position_id;
                        positionIdsToClose.push(positionIdToClose);
                        console.log(`[PositionManager] 🔍 TIME EXIT: Pushed position ID: ${positionIdToClose}`);
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
                        console.log(`[PositionManager] 🔍 TAKE PROFIT: Adding position to close list - db_record_id: ${position.db_record_id}, position.id: ${position.id}, symbol: ${cleanSymbol}`);
                        // Use the primary ID that matches what's in memory
                        const positionIdToClose = position.id || position.db_record_id || position.position_id;
                        positionIdsToClose.push(positionIdToClose);
                        console.log(`[PositionManager] 🔍 TAKE PROFIT: Pushed position ID: ${positionIdToClose}`);
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
                        console.log(`[PositionManager] 🔍 STOP LOSS: Adding position to close list - db_record_id: ${position.db_record_id}, position.id: ${position.id}, symbol: ${cleanSymbol}`);
                        // Use the primary ID that matches what's in memory
                        const positionIdToClose = position.id || position.db_record_id || position.position_id;
                        positionIdsToClose.push(positionIdToClose);
                        console.log(`[PositionManager] 🔍 STOP LOSS: Pushed position ID: ${positionIdToClose}`);
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
                    // Use the primary ID that matches what's in memory
                    const positionIdToClose = position.id || position.db_record_id || position.position_id;
                    positionIdsToClose.push(positionIdToClose);
                    console.log(`[PositionManager] 🔍 TRAILING STOP: Pushed position ID: ${positionIdToClose}`);
                    continue;
                } else if (postTrailingPosition.position_id && postTrailingPosition !== position) { // Only add if it was actually modified AND has a valid ID
                    positionsUpdatedButStillOpen.push(postTrailingPosition);
                    // Also add to positionsToUpdate array for tracking
                    positionsToUpdate.push({
                        position_id: postTrailingPosition.position_id,
                        id: postTrailingPosition.id || postTrailingPosition.db_record_id,
                        peak_price: postTrailingPosition.peak_price,
                        trough_price: postTrailingPosition.trough_price,
                        trailing_peak_price: postTrailingPosition.trailing_peak_price,
                        trailing_stop_price: postTrailingPosition.trailing_stop_price
                    });
                }

            } catch (error) {
                this.addLog(`[DEBUG_MONITOR] ❌ Error checking position ${position.symbol}: ${error}`, 'error');
                this.addLog(`[DEBUG_MONITOR] Error stack: ${error.stack}`, 'error');
                this.addLog(`[POSITIONS_MONITOR] Error monitoring position ${position?.position_id || 'unknown'}: ${error.message}`, 'error');
            }
        }
            })(); // Close the positionLoopPromise

            // Race the position loop against the timeout
            try {
                await Promise.race([positionLoopPromise, positionLoopTimeout]);
                console.log('[position_manager_debug] 🔍 Position loop completed successfully');
            } catch (timeoutError) {
                console.error('[position_manager_debug] ❌ Position loop timeout:', timeoutError.message);
                this.addLog(`[MONITOR] ❌ Position loop timeout: ${timeoutError.message}`, 'error');
                // Continue with the function even if the loop times out
            }

            console.log('[position_manager_debug] 🔍 About to process post-loop logic...');
            console.log('[position_manager_debug] 🔍 Current tradesToCreate count:', tradesToCreate.length);
            console.log('[position_manager_debug] 🔍 Current positionIdsToClose count:', positionIdsToClose.length);

        // Persist updates for positions that are still open
        if (positionsUpdatedButStillOpen.length > 0) {
            // Map the current wallet positions, replacing updated ones with their new state
            // It's important to update both this.positions and walletState.positions for consistency
            this.positions = this.positions.map(p => {
                const updatedVersion = positionsUpdatedButStillOpen.find(up => up.id === p.db_record_id); // Match by database record ID
                return updatedVersion || p;
            });
            // Also update the scannerService's in-memory wallet state for immediate consistency
            // The `persistWalletChangesAndWait` call will handle updating the DB with these changes
            if (this._getCurrentWalletState() && this._getCurrentWalletState().id === walletId) {
                 this._getCurrentWalletState().positions = this.positions; // Ensure walletState.positions mirrors this.positions
            }
            this.needsWalletSave = true; // Mark for persistence if any position tracking updated
        }

        // If any position tracking updates happened, persist the wallet state
        if (this.needsWalletSave) {
            await this.persistWalletChangesAndWait();
            this.needsWalletSave = false; // Reset the flag
            this.scannerService.addLog('[MONITOR] ✅ Wallet state saved after tracking updates.', 'success');
        }

        console.log(`[PositionManager] 🔍 MONITORING COMPLETE:`, {
            tradesToCreate: tradesToCreate.length,
            positionIdsToClose: positionIdsToClose.length,
            tradesToCreateDetails: tradesToCreate.map(t => ({ symbol: t.symbol, exit_reason: t.exit_reason })),
            positionIdsToCloseDetails: positionIdsToClose,
            positionsProcessed: this.positions.length,
            currentTime: new Date().toISOString()
        });

        if (tradesToCreate.length > 0) {
            console.log(`[PositionManager] 🔄 Executing batch close for ${tradesToCreate.length} positions`);
            this.addLog(`[MONITOR] 🔄 Identified ${tradesToCreate.length} positions for closure.`, 'info', { level: 1 });
            
            // PRE-CLOSE VALIDATION: Group positions into validClosures[] and dustClosures[]
            console.log('[PositionManager] 🔍 [PRE-CLOSE_VALIDATION] Starting pre-close validation...');
            this.addLog(`[PRE-CLOSE_VALIDATION] 🔍 Validating ${tradesToCreate.length} positions before closure...`, 'info');
            
            const { validClosures, dustClosures } = await this._validateAndGroupPositionsForClosure(
                tradesToCreate, 
                positionIdsToClose, 
                currentPrices
            );
            
            console.log('[PositionManager] 🔍 [PRE-CLOSE_VALIDATION] Validation complete:', {
                validClosures: validClosures.length,
                dustClosures: dustClosures.length,
                validClosuresSymbols: validClosures.map(v => v.position?.symbol || 'unknown'),
                dustClosuresSymbols: dustClosures.map(d => d.position?.symbol || 'unknown')
            });
            this.addLog(
                `[PRE-CLOSE_VALIDATION] ✅ Grouped positions: ${validClosures.length} valid, ${dustClosures.length} dust`,
                'info'
            );
            
            // Execute valid closures first
            if (validClosures.length > 0) {
                const validTradesToCreate = validClosures.map(v => v.tradeData);
                const validPositionIdsToClose = validClosures.map(v => v.positionId);
                
                console.log('[PositionManager] 🔄 Executing valid exchange closures:', validClosures.length);
                this.addLog(`[PRE-CLOSE_VALIDATION] 🔄 Closing ${validClosures.length} valid positions on exchange...`, 'info');
                
                // CRITICAL DEBUG: Show exact IDs being passed vs what's in memory
                //console.log('🔥🔥🔥 CRITICAL DEBUG - ARRAYS BEING PASSED 🔥🔥🔥');
                //console.log('🔥🔥🔥 ARRAY LENGTHS:', { tradesToCreate: validTradesToCreate.length, positionIdsToClose: validPositionIdsToClose.length });
                //console.log('🔥🔥🔥 POSITION IDS TO CLOSE:', validPositionIdsToClose);
                //console.log('🔥🔥🔥 POSITIONS IN MEMORY COUNT:', this.positions.length);
                
                //console.log('[position_manager_debug] 🔍 About to call executeBatchClose...');
                //console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - CALLING EXECUTE_BATCH_CLOSE');
                //console.log('[PositionManager] 🔍 [EXECUTION_TRACE] STEP 4: About to call executeBatchClose');
                
                // Add timeout to executeBatchClose to prevent hanging - increased to 60 seconds to allow for all positions
                const executeBatchCloseTimeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('executeBatchClose timeout after 60 seconds')), 60000);
                });
                
                const executeBatchClosePromise = this.executeBatchClose(validTradesToCreate, validPositionIdsToClose);
                
                let closeResult;
                try {
                    closeResult = await Promise.race([executeBatchClosePromise, executeBatchCloseTimeout]);
                    console.log('[position_manager_debug] 🔍 executeBatchClose completed successfully');
                    console.log('[position_manager_debug] 🔍 Close result:', closeResult);
                } catch (timeoutError) {
                    console.error('[position_manager_debug] ❌ executeBatchClose timeout:', timeoutError.message);
                    this.addLog(`[MONITOR] ❌ executeBatchClose timeout: ${timeoutError.message}`, 'error');
                    closeResult = { success: false, error: timeoutError.message, closed: 0 };
                }
            
            console.log(`[PositionManager] 🔄 Batch close result:`, closeResult);
            
            if (!closeResult.success) {
                console.log(`[PositionManager] ❌ Batch close failed:`, closeResult.error);
                this.addLog(`[DEBUG_MONITOR] ❌ Batch close failed: ${closeResult.error}`, 'error');
                this.addLog(`[MONITOR] ❌ Failed to close positions: ${closeResult.error}`, 'error', { level: 1 });
            } else {
                console.log(`[PositionManager] ✅ Batch close successful, closed: ${closeResult.closed}`);
                this.addLog(`[DEBUG_MONITOR] ✅ Batch close successful, closed: ${closeResult.closed}`, 'debug');
                this.addLog(`[MONITOR] ✅ Successfully closed ${closeResult.closed} positions`, 'success', { level: 1 });
                }
            }
            
            // Handle dust closures separately (database cleanup only - positions too small to trade on Binance)
            // NOTE: These positions are BELOW Binance minimums and CANNOT be traded
            // We mark them as closed in database (dust cleanup) since Binance would reject any sell attempt
            if (dustClosures.length > 0) {
                console.log('[PositionManager] 🧹 Executing dust cleanup for untradable positions:', dustClosures.length);
                this.addLog(
                    `[DUST_CLEANUP] 🧹 Cleaning ${dustClosures.length} dust positions (below Binance minimums - cannot trade). Removing from database...`,
                    'info'
                );
                
                const dustTradesToCreate = dustClosures.map(d => d.tradeData);
                const dustPositionIdsToClose = dustClosures.map(d => d.positionId);
                
                // Update trade data to mark as dust cleanup (position too small to trade on Binance)
                for (const dustTrade of dustTradesToCreate) {
                    dustTrade.exit_reason = 'dust_cleanup';  // Renamed from 'dust_virtual_close' for clarity
                    dustTrade.isDustCleanup = true;  // Renamed from 'virtualClose' for clarity
                    dustTrade.note = 'Position below Binance minimums - removed from tracking (cannot execute real trade)';
                }
                
                // Execute batch close (will attempt REAL Binance close first, but these will likely fail due to size)
                // executeBatchClose will handle Binance rejections and mark as cleaned up
                const dustCloseResult = await this.executeBatchClose(dustTradesToCreate, dustPositionIdsToClose);
                
                if (dustCloseResult.success) {
                    console.log(`[PositionManager] ✅ Dust cleanup successful for ${dustCloseResult.closed} positions`);
                    this.addLog(
                        `[DUST_CLEANUP] ✅ Cleaned ${dustCloseResult.closed} dust positions from database (positions were too small to trade on Binance)`,
                        'success'
                    );
                    
                    // Optional: Trigger dust conversion attempt after virtual closes
                    try {
                        const tradingMode = this.getTradingMode();
                        const proxyUrl = this.scannerService.state?.settings?.local_proxy_url;
                        if (proxyUrl) {
                            const dustConvertResult = await attemptDustConvert(tradingMode, proxyUrl);
                            if (dustConvertResult.ok) {
                                console.log('[PositionManager] ✅ Dust conversion successful after virtual closes');
                                this.addLog(`[DUST_VIRTUAL_CLOSE] ✅ Dust conversion successful`, 'success');
                            }
                        }
                    } catch (dustError) {
                        console.warn('[PositionManager] ⚠️ Dust conversion failed (non-critical):', dustError.message);
                    }
                } else {
                    console.log(`[PositionManager] ❌ Dust cleanup failed: ${dustCloseResult.error}`);
                    this.addLog(`[DUST_CLEANUP] ❌ Dust cleanup failed: ${dustCloseResult.error}`, 'error');
                }
            }
        } else {
            console.log(`[PositionManager] ✅ No positions require closing this cycle`);
            this.scannerService.addLog(`[MONITOR] ✅ No positions require closing this cycle.`, 'info');
            //this.addLog('[POSITIONS_MONITOR] Monitoring complete: 0 positions ready to close', 'debug');
        }
            
        // CRITICAL FIX: Ensure positionIdsToClose is unique before returning
        uniquePositionIdsToClose = [...new Set(positionIdsToClose)];
            
        if (uniquePositionIdsToClose.length !== positionIdsToClose.length) {
            this.addLog(`[DEBUG_MONITOR] ⚠️ Removed ${positionIdsToClose.length - uniquePositionIdsToClose.length} duplicate position IDs`, 'warning');
            this.scannerService.addLog(`[POSITION_MONITOR] 🚨 Removed ${positionIdsToClose.length - uniquePositionIdsToClose.length} IDs from close list`, 'warning');
        }

        this.addLog(`[POSITIONS_MONITOR] Monitoring complete: ${tradesToCreate.length} positions ready to close`, 'info');
        console.log(`[PositionManager] 🔍 MONITORING COMPLETE: ${tradesToCreate.length} trades to create, ${uniquePositionIdsToClose.length} positions to close`);
        console.log(`[PositionManager] 🔍 Position IDs to close:`, uniquePositionIdsToClose);
        
        // POST-MONITORING RECONCILIATION: Schedule reconciliation for positions without prices
        if (reconciliationNeeded.length > 0) {
            console.log(`[PositionManager] 🔄 [POST-MONITORING_RECONCILIATION] Scheduling reconciliation for ${reconciliationNeeded.length} positions without prices...`);
            this.addLog(
                `[POST-MONITORING_RECONCILIATION] 🔄 ${reconciliationNeeded.length} positions need reconciliation (missing prices)`,
                'info'
            );
            
            // Schedule reconciliation after 30 seconds (non-blocking)
            setTimeout(async () => {
                console.log('[PositionManager] 🔄 [POST-MONITORING_RECONCILIATION] Triggering scheduled reconciliation...');
                this.addLog(`[POST-MONITORING_RECONCILIATION] 🔄 Starting reconciliation for ${reconciliationNeeded.length} positions...`, 'info');
                
                try {
                    const reconcileResult = await this.reconcileWithBinance();
                    if (reconcileResult.success) {
                        console.log('[PositionManager] ✅ [POST-MONITORING_RECONCILIATION] Reconciliation complete');
                        this.addLog(
                            `[POST-MONITORING_RECONCILIATION] ✅ Reconciliation complete: ${reconcileResult.summary?.ghostPositionsCleaned || 0} ghosts cleaned`,
                            'success'
                        );
                    } else {
                        console.warn('[PositionManager] ⚠️ [POST-MONITORING_RECONCILIATION] Reconciliation failed:', reconcileResult.error);
                        this.addLog(
                            `[POST-MONITORING_RECONCILIATION] ⚠️ Reconciliation failed: ${reconcileResult.error || 'Unknown error'}`,
                            'warning'
                        );
                    }
                } catch (reconcileError) {
                    console.error('[PositionManager] ❌ [POST-MONITORING_RECONCILIATION] Reconciliation error:', reconcileError);
                    this.addLog(
                        `[POST-MONITORING_RECONCILIATION] ❌ Reconciliation error: ${reconcileError.message}`,
                        'error'
                    );
                }
            }, 30000); // 30 seconds delay as per schema
        }

        console.log('[position_manager_debug] 🔍 About to return final result...');
        console.log('[position_manager_debug] 🔍 Final tradesToCreate count:', tradesToCreate.length);
        console.log('[position_manager_debug] 🔍 Final positionIdsToClose count:', uniquePositionIdsToClose.length);
        console.log('[position_manager_debug] 🔍 Final reconciliationNeeded count:', reconciliationNeeded.length);
        console.log('[position_manager_debug] 🔍 THIS IS THE FINAL RETURN STATEMENT - FUNCTION COMPLETING');

        return {
            tradesToCreate: tradesToCreate.length,
            positionIdsToClose: uniquePositionIdsToClose.length,
            reconciliationNeeded: reconciliationNeeded.length
        };

        } catch (error) {
            // Ensure lock is released even on error
            this.isMonitoring = false;
            console.error('[PositionManager] ❌ Error in monitorAndClosePositions:', error);
            this.addLog(`[DEBUG_MONITOR] ❌ Error in monitoring: ${error.message}`, 'error');
            return { tradesToCreate: [], positionIdsToClose: [] };
        } finally {
            this.isMonitoring = false;
        }
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
                // Add Fear & Greed Index and LPM score for analytics
                fear_greed_score: position.fear_greed_score,
                fear_greed_classification: position.fear_greed_classification,
                lpm_score: position.lpm_score,
                trading_mode: this.tradingMode
            };
            tradesToCreate.push(tradeData);
            if (position.id) { // Only add if ID exists
                // Use the primary ID that matches what's in memory
                const positionIdToClose = position.id || position.db_record_id || position.position_id;
                positionIdsToClose.push(positionIdToClose);
                console.log(`[PositionManager] 🔍 GHOST PURGE: Pushed position ID: ${positionIdToClose}`);
            }
        }
        
        console.log('[position_manager_debug] 🔍 About to return from monitorAndClosePositions...');
        console.log('[position_manager_debug] 🔍 Final result:', { 
            tradesToCreate: tradesToCreate.length, 
            positionIdsToClose: positionIdsToClose.length 
        });
        console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - FUNCTION COMPLETING SUCCESSFULLY');
        
        // This return statement is unreachable due to the earlier return statement
        // return { tradesToCreate, positionIdsToClose };
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
        return reasonMap[exitReason] || (exitReason || '').replace(/_/g, ' ');
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
     * Wait for wallet save operations to complete
     * @param {number} timeoutMs - Maximum time to wait in milliseconds
     * @returns {Promise<void>}
     */
    async waitForWalletSave(timeoutMs = 30000) {
        console.log('[PositionManager] 🔄 Waiting for wallet save operations to complete...');
        
        const startTime = Date.now();
        const checkInterval = 100; // Check every 100ms
        
        return new Promise((resolve) => {
            const checkWalletSave = () => {
                const elapsed = Date.now() - startTime;
                
                // If timeout reached, resolve anyway
                if (elapsed >= timeoutMs) {
                    console.log('[PositionManager] ⏰ Wallet save wait timeout reached, proceeding...');
                    resolve();
                    return;
                }
                
                // Check if wallet save is in progress
                const isWalletSaving = this.scannerService?.state?.isWalletSaving || false;
                
                if (!isWalletSaving) {
                    console.log('[PositionManager] ✅ Wallet save operations completed');
                    resolve();
                    return;
                }
                
                // Continue checking
                setTimeout(checkWalletSave, checkInterval);
            };
            
            checkWalletSave();
        });
    }

    /**
     * Open positions in batch from signals
     * @param {Array} signals - Array of signal objects with combination, currentPrice, convictionScore, convictionDetails
     * @returns {Promise<Object>} Result with opened count and positions
     */
    async openPositionsBatch(signals) {
        console.log('[PositionManager] 🚀 OPEN POSITIONS BATCH');
        console.log('[PositionManager] 🚀 Signals received:', signals.length);
        console.log('[PositionManager] 🚀 Signals details:', signals.map(s => ({
            combination: s.combination,
            symbol: s.symbol,
            strategy_name: s.strategy_name,
            currentPrice: s.currentPrice,
            convictionScore: s.convictionScore,
            keys: Object.keys(s)
        })));
        
        const result = {
            opened: 0,
            openedPositions: [],
            errors: []
        };
        
        if (!signals || signals.length === 0) {
            console.log('[PositionManager] 🚀 No signals to process');
            return result;
        }
        
        try {
            // Get strategy settings first
            const settings = this.scannerService.state.settings || {};
            const strategySettings = {
                useWinStrategySize: settings.useWinStrategySize !== false,
                defaultPositionSize: settings.defaultPositionSize || 100,
                riskPerTrade: settings.riskPerTrade || 2,
                minimumTradeValue: settings.minimumTradeValue || 10,
                maxBalancePercentRisk: settings.maxBalancePercentRisk || 100,
                maxBalanceInvestCapUSDT: settings.maxBalanceInvestCapUSDT || null
            };

            // Check cached free balance before opening positions
            let cachedFreeBalance = null;
            try {
                const walletState = this._getCurrentWalletState();
                if (walletState) {
                    cachedFreeBalance = parseFloat(walletState.available_balance || 0);
                    console.log(`[PositionManager] 💰 Using cached free balance: $${cachedFreeBalance.toFixed(2)}`);
                    console.log(`[PositionManager] 💰 Wallet state details:`, {
                        available_balance: walletState.available_balance,
                        total_equity: walletState.total_equity,
                        mode: walletState.mode
                    });
            } else {
                    console.warn('[PositionManager] 💰 No wallet state available for balance check');
                }
        } catch (error) {
                console.error('[PositionManager] Error getting cached free balance:', error);
            }

            // CRITICAL FIX: Track cumulative position values within the batch to prevent exceeding Max Balance to Invest limit
            let cumulativePositionValue = 0;
            let currentAllocated = 0;
            
            // Get initial allocated balance from the most reliable source at runtime
            try {
                // Prefer in-memory managed positions (freshest during scan)
                const managedAllocated = this.getBalanceInTrades ? Number(this.getBalanceInTrades()) : 0;
                if (Number.isFinite(managedAllocated) && managedAllocated > 0) {
                    currentAllocated = managedAllocated;
                } else {
                    // Fallback to wallet summary if available
                    const walletSummary = this.scannerService?.walletManagerService?.walletSummary;
                    if (walletSummary && walletSummary.balanceInTrades) {
                        currentAllocated = parseFloat(walletSummary.balanceInTrades);
                    }
                }
            } catch (error) {
                console.error('[PositionManager] Error determining current allocated balance:', error);
            }

            console.log(`[PositionManager] 💰 Initial batch state:`, {
                currentAllocated: currentAllocated,
                cumulativePositionValue: cumulativePositionValue,
                signalsToProcess: signals.length,
                maxBalanceInvestCapUSDT: strategySettings?.maxBalanceInvestCapUSDT || 'No cap'
            });

            // Track successful positions opened in this batch
            let successfulPositionsInBatch = 0;

            for (const signal of signals) {
                try {
                    console.log('[PositionManager] 🚀 Processing signal:', signal.combination?.strategy_name, signal.combination?.symbol);
                    console.log('[PositionManager] 🔍 Signal object debug:', {
                        signal: signal,
                        combination: signal.combination,
                        symbol: signal.symbol,
                        strategy_name: signal.strategy_name,
                        keys: Object.keys(signal)
                    });
                    
                    // Extract signal data
                    // The signal object can have two structures:
                    // 1. Direct properties: { strategy_name, symbol, currentPrice, ... }
                    // 2. Nested in combination: { combination: { strategy_name, symbol }, currentPrice, ... }
                    const combination = signal.combination || signal;
                    const currentPrice = signal.currentPrice;
                    const convictionScore = signal.convictionScore || signal.conviction_score;
                    const convictionDetails = signal.convictionDetails || signal.conviction_breakdown;
                    
                    // Extract symbol and strategy_name from either direct properties or combination
                    const symbol = signal.symbol || combination.symbol || combination.coin;
                    const strategy_name = signal.strategy_name || combination.strategy_name || combination.combinationName;
                    
                    console.log('[PositionManager] 🔍 Extracted data:', {
                        symbol: symbol,
                        strategy_name: strategy_name,
                        currentPrice: currentPrice,
                        convictionScore: convictionScore
                    });
                    
                    if (!symbol || !strategy_name || !currentPrice) {
                        console.log('[PositionManager] ⚠️ Invalid signal data, skipping:', {
                            symbol: symbol,
                            strategy_name: strategy_name,
                            currentPrice: currentPrice
                        });
                        result.errors.push({
                            signal: signal,
                            error: 'Invalid signal data - missing required fields'
                        });
                        continue;
                    }
                    
                       // Calculate proper position size using the position sizing logic
                       console.log('[PositionManager] 🔍 Calculating position size for:', {
                           symbol: symbol,
                           currentPrice: currentPrice,
                           convictionScore: convictionScore,
                           strategy_name: strategy_name
                       });
                       
                       // Import position sizing function
                       const { calculatePositionSize } = await import('@/components/utils/dynamicPositionSizing');
                       
                       // Get wallet state for position sizing
                       const walletState = this._getCurrentWalletState();
                       const availableBalance = parseFloat(walletState?.available_balance || 0) || 0;
                       const totalEquity = parseFloat(walletState?.total_equity || 0);
                       
                       // Declare symbolNoSlash early to avoid reference error
                       const symbolNoSlash = symbol.replace('/', '');
                       
                       // Get indicators data from scanner service
                       const indicators = this.scannerService.state.indicators || {};
                       
                       // Get ATR data - access symbol-specific indicators
                       const symbolIndicators = this.scannerService.state.indicators?.[symbolNoSlash];
                       const atrData = symbolIndicators?.atr || [];
                       
                       // Find the latest valid (non-null) ATR value
                       let atrValue = 0;
                       if (Array.isArray(atrData) && atrData.length > 0) {
                       for (let i = atrData.length - 1; i >= 0; i--) {
                           if (atrData[i] !== null && atrData[i] !== undefined && !isNaN(atrData[i])) {
                               atrValue = atrData[i];
                               break;
                           }
                           }
                       } else if (typeof atrData === 'number' && !isNaN(atrData)) {
                           atrValue = atrData;
                       }
                       
                       // DEBUG: Log ATR validation before using it
                       console.log('[PositionManager] 🔍 ATR validation before use:', {
                           symbol: symbol,
                           symbolNoSlash: symbolNoSlash,
                           currentPrice: currentPrice,
                           atrValue: atrValue,
                           atrPercentage: atrValue ? (atrValue / currentPrice) * 100 : 'N/A',
                           atrDataLength: Array.isArray(atrData) ? atrData.length : 'N/A',
                           atrDataType: typeof atrData,
                           atrDataSample: Array.isArray(atrData) ? atrData.slice(-3) : atrData,
                           atrCalculation: atrValue ? `ATR: ${atrValue} (${((atrValue / currentPrice) * 100).toFixed(2)}% of price)` : 'No ATR data',
                           symbolIndicatorsPresent: !!symbolIndicators,
                           symbolIndicatorsKeys: symbolIndicators ? Object.keys(symbolIndicators) : 'no indicators for symbol'
                       });

                       
                       // SAFETY CHECK: Cap ATR if it's still too high (fallback protection)
                       if (atrValue > currentPrice * 0.1) {
                           const originalATR = atrValue;
                           atrValue = currentPrice * 0.1; // Cap at 10% of current price
                           console.warn('[PositionManager] ⚠️ ATR value was capped as fallback protection:', {
                               symbol: symbol,
                               originalATR: originalATR,
                               cappedATR: atrValue,
                               currentPrice: currentPrice,
                               originalPercentage: (originalATR / currentPrice) * 100,
                               cappedPercentage: (atrValue / currentPrice) * 100
                           });
                       }
                       
                       console.log('[PositionManager] 🔍 ATR data for position sizing:', {
                           symbol: symbol,
                           symbolNoSlash: symbolNoSlash,
                           atrData: atrData,
                           atrDataType: typeof atrData,
                           atrDataLength: Array.isArray(atrData) ? atrData.length : 'not array',
                           atrValue: atrValue,
                           atrPercentage: atrValue ? (atrValue / currentPrice) * 100 : 'N/A',
                           indicatorsKeys: Object.keys(indicators),
                           hasATR: !!indicators.atr,
                           atrLength: indicators.atr?.length || 0,
                           latestValidATR: atrValue,
                           scannerStateKeys: Object.keys(this.scannerService.state || {}),
                           indicatorsStructure: {
                               hasIndicators: !!this.scannerService.state?.indicators,
                               indicatorsKeys: Object.keys(this.scannerService.state?.indicators || {}),
                               directAtrAccess: this.scannerService.state?.indicators?.atr,
                               directAtrType: typeof this.scannerService.state?.indicators?.atr
                           }
                       });
                       
                       // DEBUG: Log extreme ATR values
                       if (atrValue > currentPrice * 0.1) {
                           console.warn('[PositionManager] ⚠️ EXTREME ATR value detected:', {
                               atrValue: atrValue,
                               currentPrice: currentPrice,
                               atrPercentage: (atrValue / currentPrice) * 100,
                               symbol: symbol,
                               impact: 'ATR is more than 10% of current price - this will cause unrealistic SL/TP'
                           });
                       }

                       // Check cached free balance BEFORE position size calculation
                       console.log(`[PositionManager] 💰 Cached balance check for ${symbol}:`, {
                           cachedFreeBalance: cachedFreeBalance,
                           hasEnoughBalance: cachedFreeBalance !== null ? cachedFreeBalance >= 30 : 'unknown'
                       });
                       
                       if (cachedFreeBalance !== null && cachedFreeBalance < 30) {
                           console.warn(`[PositionManager] 💰 Insufficient cached free balance: $${cachedFreeBalance.toFixed(2)} < $30 minimum for ${symbol}`);
                           result.errors.push({
                               signal: signal,
                               error: `Insufficient free balance: $${cachedFreeBalance.toFixed(2)} < $30 minimum`
                           });
                           continue;
                       }

                       // Get minimum trade value first - MOVED OUTSIDE IF BLOCK TO FIX SCOPE
                       const minimumTradeValue = strategySettings?.minimumTradeValue || 10;
                       
                       // Check max investment cap BEFORE position size calculation
                       const maxInvestmentCapPre = strategySettings.maxBalanceInvestCapUSDT;
                       if (maxInvestmentCapPre && maxInvestmentCapPre > 0) {
                           console.log(`[PositionManager] 💰 Max investment cap check for ${symbol}:`, {
                               maxInvestmentCap: maxInvestmentCapPre,
                               currentAllocated: currentAllocated,
                               cumulativePositionValue: cumulativePositionValue,
                               totalWouldBeAllocated: currentAllocated + cumulativePositionValue,
                               remainingCap: maxInvestmentCapPre - (currentAllocated + cumulativePositionValue),
                               wouldExceedCap: (currentAllocated + cumulativePositionValue) >= maxInvestmentCapPre
                           });
                       
                       // CRITICAL FIX: Check if adding ANY position would exceed the cap
                       // We need to estimate the minimum position size to check this properly
                       const estimatedMinPositionSize = Math.max(
                           minimumTradeValue,
                           (maxInvestmentCapPre * 0.01) // At least 1% of cap as minimum
                       );
                           
                           if (currentAllocated + cumulativePositionValue + estimatedMinPositionSize > maxInvestmentCapPre) {
                               console.warn(`[PositionManager] 💰 Max investment cap would be exceeded: $${currentAllocated.toFixed(2)} + $${cumulativePositionValue.toFixed(2)} + $${estimatedMinPositionSize.toFixed(2)} > $${maxInvestmentCapPre.toFixed(2)} cap for ${symbol}`);
                               result.errors.push({
                                   signal: signal,
                                   error: `Max investment cap would be exceeded: $${(currentAllocated + cumulativePositionValue).toFixed(2)} + $${estimatedMinPositionSize.toFixed(2)} > $${maxInvestmentCapPre.toFixed(2)} cap`
                               });
                               continue;
                           }
                       }
                       
                       // Pre-check: Ensure sufficient balance for minimum trade value
                       
                       // Get actual balance in trades for more accurate available balance calculation
                       let actualBalanceInTrades = 0;
                       try {
                           const walletSummary = this.scannerService?.walletManagerService?.walletSummary;
                           if (walletSummary && walletSummary.balanceInTrades) {
                               actualBalanceInTrades = parseFloat(walletSummary.balanceInTrades);
                           }
                       } catch (error) {
                           console.error('[PositionManager] Error getting balance in trades:', error);
                       }
                       
                       // Calculate more accurate available balance
                       const accurateAvailableBalance = totalEquity - actualBalanceInTrades;
                       
                       console.log(`[PositionManager] 💰 Balance check for ${symbol}:`, {
                           totalEquity,
                           balanceInTrades: actualBalanceInTrades,
                           availableBalance: availableBalance,
                           accurateAvailableBalance: accurateAvailableBalance,
                           minimumTradeValue,
                           sufficientBalance: availableBalance >= minimumTradeValue
                       });
                       
                       if (availableBalance < minimumTradeValue) {
                           console.warn(`[PositionManager] 💰 Insufficient balance for ${symbol}: Available $${availableBalance.toFixed(2)} < $${minimumTradeValue} minimum trade value`);
                           result.errors.push({
                               signal: signal,
                               error: `Insufficient balance: $${availableBalance.toFixed(2)} < $${minimumTradeValue} minimum trade value`
                           });
                           continue;
                       }
                       
                       // Calculate position size using the correct available balance (not total equity)
                       const effectiveAvailableBalance = availableBalance; // Use actual available balance, not total equity
                       
                       // LPM/EBR Integration: Get adjustedBalanceRiskFactor from scanner state
                       const adjustedBalanceRiskFactor = this.scannerService?.state?.adjustedBalanceRiskFactor || null;
                       console.log('[PositionManager] 🎯 LPM/EBR: Using adjustedBalanceRiskFactor:', adjustedBalanceRiskFactor);
                       
                       // Get LPM score for position sizing
                       const lpmScore = this.scannerService?.state?.performanceMomentumScore || 50;
                       
                       console.log('[PositionManager] 🔍 Position size calculation inputs:', {
                           strategySettings: strategySettings,
                           currentPrice: currentPrice,
                           convictionScore: convictionScore || 50,
                           convictionDetails: convictionDetails || {},
                           availableCash: effectiveAvailableBalance,
                           totalWalletBalance: totalEquity,
                           balanceInTrades: actualBalanceInTrades,
                           symbol: symbol,
                           exchangeInfo: (() => {
                               const exchangeInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolNoSlash) : null;
                               console.log('[PositionManager] 🔍 Exchange info for', symbolNoSlash, ':', {
                                   hasExchangeInfo: !!exchangeInfo,
                                   hasFilters: !!exchangeInfo?.filters,
                                   filtersType: typeof exchangeInfo?.filters,
                                   filtersIsArray: Array.isArray(exchangeInfo?.filters),
                                   filtersKeys: exchangeInfo?.filters ? Object.keys(exchangeInfo.filters) : 'no filters',
                                   lotSizeFilter: exchangeInfo?.filters?.LOT_SIZE,
                                   minNotionalFilter: exchangeInfo?.filters?.MIN_NOTIONAL
                               });
                               return exchangeInfo;
                           })(),
                           indicators: { atr: atrValue },
                           adjustedBalanceRiskFactor: adjustedBalanceRiskFactor,
                           lpmScore: lpmScore
                       });
                       
                       const positionSizeResult = calculatePositionSize({
                           strategySettings: strategySettings,
                           currentPrice: currentPrice,
                           convictionScore: convictionScore || 50,
                           convictionDetails: convictionDetails || {},
                           availableCash: effectiveAvailableBalance,
                           totalWalletBalance: totalEquity,
                           balanceInTrades: actualBalanceInTrades,
                           symbol: symbol,
                           exchangeInfo: (() => {
                               const exchangeInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolNoSlash) : null;
                               console.log('[PositionManager] 🔍 Exchange info for', symbolNoSlash, ':', {
                                   hasExchangeInfo: !!exchangeInfo,
                                   hasFilters: !!exchangeInfo?.filters,
                                   filtersType: typeof exchangeInfo?.filters,
                                   filtersIsArray: Array.isArray(exchangeInfo?.filters),
                                   filtersKeys: exchangeInfo?.filters ? Object.keys(exchangeInfo.filters) : 'no filters',
                                   lotSizeFilter: exchangeInfo?.filters?.LOT_SIZE,
                                   minNotionalFilter: exchangeInfo?.filters?.MIN_NOTIONAL
                               });
                               return exchangeInfo;
                           })(),
                           indicators: { atr: atrValue }, // Pass latest valid ATR value to position sizing
                           adjustedBalanceRiskFactor: adjustedBalanceRiskFactor, // Pass LPM/EBR factor
                           lpmScore: lpmScore, // Pass LPM score for position sizing
                           openPositions: this.positions || [] // Pass current open positions for portfolio heat management
                       });
                       
                       console.log('[PositionManager] 🔍 Position size calculation result:', positionSizeResult);
                       
                       if (positionSizeResult.error || !positionSizeResult.isValid) {
                           console.error('[PositionManager] ❌ Position size calculation failed:', {
                               symbol: signal.symbol || combination.symbol,
                               error: positionSizeResult.error || positionSizeResult.reason,
                               message: positionSizeResult.message
                           });
                           
                           result.errors.push({
                               signal: signal,
                               error: `Position sizing failed: ${positionSizeResult.error || positionSizeResult.reason}`
                           });
                           continue;
                       }

                       // Additional balance check after position size calculation (for extra safety)
                           const positionValue = positionSizeResult.positionValueUSDT || 0;
                       if (effectiveAvailableBalance < positionValue) {
                           console.warn(`[PositionManager] 💰 Insufficient effective available balance: $${effectiveAvailableBalance.toFixed(2)} < $${positionValue.toFixed(2)} required for ${symbol}`);
                               result.errors.push({
                                   signal: signal,
                               error: `Insufficient available balance: $${effectiveAvailableBalance.toFixed(2)} < $${positionValue.toFixed(2)} required`
                               });
                               continue;
                           }
                       console.log(`[PositionManager] ✅ Effective available balance sufficient: $${effectiveAvailableBalance.toFixed(2)} >= $${positionValue.toFixed(2)} for ${symbol}`);

                       // Additional max investment cap check after position size calculation
                       const maxInvestmentCapPost = strategySettings.maxBalanceInvestCapUSDT;
                       if (maxInvestmentCapPost && maxInvestmentCapPost > 0) {
                           const positionValue = positionSizeResult.positionValueUSDT || 0;
                           const wouldBeAllocated = currentAllocated + cumulativePositionValue + positionValue;
                           
                           console.log(`[PositionManager] 💰 Max investment cap check with position size for ${symbol}:`, {
                               maxInvestmentCap: maxInvestmentCapPost,
                               currentAllocated: currentAllocated,
                               cumulativePositionValue: cumulativePositionValue,
                               positionValue: positionValue,
                               wouldBeAllocated: wouldBeAllocated,
                               wouldExceedCap: wouldBeAllocated > maxInvestmentCapPost
                           });

                           if (wouldBeAllocated > maxInvestmentCapPost) {
                               console.warn(`[PositionManager] 💰 Position would exceed max investment cap: $${wouldBeAllocated.toFixed(2)} > $${maxInvestmentCapPost.toFixed(2)} cap for ${symbol}`);
                               result.errors.push({
                                   signal: signal,
                                   error: `Position would exceed max investment cap: $${wouldBeAllocated.toFixed(2)} > $${maxInvestmentCapPost.toFixed(2)} cap`
                               });
                               continue;
                           }
                           console.log(`[PositionManager] ✅ Max investment cap check passed: $${wouldBeAllocated.toFixed(2)} <= $${maxInvestmentCapPost.toFixed(2)} for ${symbol}`);
                       }
                       
                       // CRITICAL: Execute real Binance buy order BEFORE creating database record
                       const tradingMode = this.getTradingMode();
                       const proxyUrl = this.scannerService.state.settings?.local_proxy_url;
                       
                       console.log('[PositionManager] 🚀 EXECUTING REAL BINANCE BUY ORDER');
                       console.log('[PositionManager] 🚀 Symbol:', symbolNoSlash);
                       console.log('[PositionManager] 🚀 Quantity:', positionSizeResult.quantityCrypto);
                       console.log('[PositionManager] 🚀 Trading Mode:', tradingMode);
                       console.log('[PositionManager] 🚀 Proxy URL:', proxyUrl);
                       console.log('[PositionManager] 🚀 Position Size Result:', {
                           quantityCrypto: positionSizeResult.quantityCrypto,
                           positionValueUSDT: positionSizeResult.positionValueUSDT,
                           isValid: positionSizeResult.isValid,
                           error: positionSizeResult.error
                       });
                       
                       // Execute Binance buy order
                       const binanceBuyResult = await this._executeBinanceMarketBuyOrder(
                           symbolNoSlash, 
                           positionSizeResult.quantityCrypto, 
                           { 
                               tradingMode, 
                               proxyUrl,
                               signal: signal,
                               positionSizeResult: positionSizeResult
                           }
                       );
                       
                       console.log('[PositionManager] 🚀 Binance buy result:', binanceBuyResult);
                       console.log('[PositionManager] 🚀 Binance buy result details:', {
                           success: binanceBuyResult.success,
                           error: binanceBuyResult.error,
                           skipped: binanceBuyResult.skipped,
                           reason: binanceBuyResult.reason,
                           orderResult: binanceBuyResult.orderResult
                       });
                       
                       if (!binanceBuyResult.success) {
                           console.log('[PositionManager] ❌ Binance buy order failed:', binanceBuyResult.error);
                           result.errors.push({
                               signal: signal,
                               error: `Binance buy order failed: ${binanceBuyResult.error}`
                           });
                           continue;
                       }
                       
                       console.log('[PositionManager] ✅ Binance buy order successful, waiting for wallet sync...');
                       
                       // CRITICAL FIX: Wait for wallet balance to sync after Binance order
                       await new Promise(resolve => setTimeout(resolve, 3000));
                       
                       console.log('[PositionManager] ✅ Creating database record after wallet sync');
                       
                       // CRITICAL: Check if the executed quantity is too small (dust)
                       const executedQty = binanceBuyResult.orderResult?.executedQty || 0;
                       const executedValue = executedQty * (binanceBuyResult.orderResult?.avgPrice || currentPrice);
                       
                       if (executedQty <= 0 || executedValue < 5) { // Less than $5 is considered dust
                           console.log('[PositionManager] ⚠️ Position too small (dust), skipping database creation:', {
                               executedQty,
                               executedValue,
                               symbol
                           });
                           this.addLog(`[PositionManager] ⚠️ Skipping dust position: ${symbol} (${executedQty} @ $${executedValue.toFixed(2)})`, 'warning');
                           continue; // Skip creating this position
                       }
                       
                       // CRITICAL: Validate ATR data before calculating exit parameters
                       if (!atrValue || typeof atrValue !== 'number' || isNaN(atrValue) || atrValue <= 0) {
                           console.error('[PositionManager] ❌ CRITICAL: Invalid ATR data for exit parameter calculation:', {
                               atrValue: atrValue,
                               atrType: typeof atrValue,
                               atrValid: atrValue && typeof atrValue === 'number' && !isNaN(atrValue) && atrValue > 0,
                               symbol: symbol,
                               impact: 'Cannot calculate stop loss and take profit without valid ATR data'
                           });
                           throw new Error(`Invalid ATR data for ${symbol}: ${atrValue}`);
                       }
                       
                       // DEBUG: Log strategy multipliers for ATR calculations
                       console.log('[PositionManager] 🎯 Strategy multipliers for ATR calculations:', {
                           symbol: symbol,
                           strategyName: combination.strategy_name || 'Unknown',
                           stopLossAtrMultiplier: combination.stopLossAtrMultiplier || combination.stop_loss_atr_multiplier,
                           takeProfitAtrMultiplier: combination.takeProfitAtrMultiplier || combination.take_profit_atr_multiplier,
                           direction: combination.strategyDirection || combination.direction,
                           atrValue: atrValue,
                           currentPrice: currentPrice,
                           expectedStopLoss: combination.strategyDirection === 'long' 
                               ? currentPrice - (atrValue * (combination.stopLossAtrMultiplier || combination.stop_loss_atr_multiplier || 0))
                               : currentPrice + (atrValue * (combination.stopLossAtrMultiplier || combination.stop_loss_atr_multiplier || 0)),
                           expectedTakeProfit: combination.strategyDirection === 'long'
                               ? currentPrice + (atrValue * (combination.takeProfitAtrMultiplier || combination.take_profit_atr_multiplier || 0))
                               : currentPrice - (atrValue * (combination.takeProfitAtrMultiplier || combination.take_profit_atr_multiplier || 0))
                       });
                       
                       // Calculate SL/TP prices for new position
                       const stopLossPrice = this.calculateStopLossPrice(combination, currentPrice, atrValue);
                       const takeProfitPrice = this.calculateTakeProfitPrice(combination, currentPrice, atrValue);
                       
                       // NEW POSITION SL/TP CALCULATION LOGS
                       // console.log('🎯 [NEW_POSITION] ==========================================');
                       // console.log('🎯 [NEW_POSITION] NEW POSITION SL/TP CALCULATION');
                       // console.log('🎯 [NEW_POSITION] ==========================================');
                       
                       
                       
                       // Calculate potential P&L for new position
                       const positionQuantity = positionSizeResult.quantityCrypto || 0;
                       const potentialLoss = Math.abs(currentPrice - stopLossPrice) * positionQuantity;
                       const potentialProfit = Math.abs(takeProfitPrice - currentPrice) * positionQuantity;
                       const riskRewardRatio = potentialProfit / potentialLoss;
                       
                       
                       // console.log('🎯 [NEW_POSITION] ==========================================');
                       
                       // Create position data with calculated values
                       const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                       const walletId = this._getCurrentWalletState()?.id || 'unknown';
                       
                       const positionData = {
                           position_id: positionId,
                           strategy_name: strategy_name,
                           symbol: symbol,
                           direction: combination.direction || 'long',
                           entry_price: currentPrice,
                           current_price: currentPrice, // CRITICAL FIX: Set current_price to prevent ghost detection
                           quantity_crypto: binanceBuyResult.orderResult?.executedQty || positionSizeResult.quantityCrypto || 0,
                           entry_value_usdt: positionSizeResult.positionValueUSDT || 0,
                           conviction_score: convictionScore || 0,
                           conviction_details: convictionDetails || {},
                           conviction_breakdown: signal.conviction_breakdown || {},
                           conviction_multiplier: signal.conviction_multiplier || 1,
                           market_regime: signal.market_regime || 'unknown',
                           regime_confidence: signal.regime_confidence || 0,
                           combined_strength: signal.combined_strength || 0, // CRITICAL FIX: Add combined_strength
                           atr_value: signal.atr_value || null,
                           is_event_driven_strategy: signal.is_event_driven_strategy || false,
                entry_timestamp: new Date().toISOString(),
                status: 'open',
                           trading_mode: this.getTradingMode(),
                           wallet_id: walletId,
                           stop_loss_price: stopLossPrice,
                           take_profit_price: takeProfitPrice,
                           enableTrailingTakeProfit: (combination?.enableTrailingTakeProfit !== false),
                           is_trailing: false,
                           trailing_stop_price: null,
                           trailing_peak_price: null,
                           peak_price: currentPrice,
                           trough_price: currentPrice,
                           time_exit_hours: this.calculateExitTimeFromStrategy(combination, currentPrice), // Calculate from BacktestCombination.estimatedExitTimeMinutes
                           trigger_signals: signal.trigger_signals || [],
                           // Add all analytics fields for complete data preservation
                           conviction_score: signal.convictionScore || 0,
                           conviction_details: signal.convictionDetails || {},
                           conviction_breakdown: signal.conviction_breakdown || {},
                           conviction_multiplier: signal.conviction_multiplier || 1,
                           market_regime: signal.market_regime || 'unknown',
                           regime_confidence: signal.regime_confidence || 0,
                           combined_strength: signal.combined_strength || 0,
                           atr_value: signal.atr_value || null,
                           is_event_driven_strategy: signal.is_event_driven_strategy || false,
                           // Add Fear & Greed Index and LPM score for analytics
                           fear_greed_score: this.scannerService.state.fearAndGreedData?.value || null,
                           fear_greed_classification: this.scannerService.state.fearAndGreedData?.value_classification || null,
                           lpm_score: this.scannerService.state.performanceMomentumScore || null,
                           created_date: new Date().toISOString(),
                           last_updated_timestamp: new Date().toISOString(),
                           last_price_update: new Date().toISOString(), // Track when price was last updated
                           // Store Binance order details
                           binance_order_id: binanceBuyResult.orderResult?.orderId,
                           binance_executed_price: binanceBuyResult.orderResult?.avgPrice || currentPrice,
                           binance_executed_quantity: binanceBuyResult.orderResult?.executedQty || positionSizeResult.quantityCrypto
                       };
                    
                    console.log('[PositionManager] 🚀 Creating position:', {
                        symbol: positionData.symbol,
                        strategy_name: positionData.strategy_name,
                        entry_price: positionData.entry_price,
                        quantity_crypto: positionData.quantity_crypto,
                        entry_value_usdt: positionData.entry_value_usdt
                    });

                        // Emit SL/TP sample log on every new position open (no one-time guard)
                        try {
                            const atrPct = positionData.atr_value && positionData.entry_price
                                ? ((Number(positionData.atr_value) / Number(positionData.entry_price)) * 100).toFixed(3)
                                : 'n/a';
                            console.log('[SLTP_SAMPLE_OPEN]', {
                                symbol: positionData.symbol,
                                entry: positionData.entry_price,
                                atrValue: positionData.atr_value,
                                atrPct: atrPct === 'n/a' ? 'n/a' : `${atrPct}%`,
                                stopLoss: positionData.stop_loss_price,
                                takeProfit: positionData.take_profit_price,
                                enableTrailingTakeProfit: positionData.enableTrailingTakeProfit
                            });
                        } catch (_) {}
                    
                    // Create position in database using proper LivePosition entity
                    console.log('[PositionManager] 🔍 Using LivePosition entity to create position...');
                    const createdPosition = await LivePosition.create(positionData);
                    
                    console.log('[PositionManager] 🔍 Database creation result:', {
                        createdPosition: createdPosition,
                        hasId: !!createdPosition?.id,
                        hasPositionId: !!createdPosition?.position_id,
                        success: !!createdPosition,
                        idValue: createdPosition?.id,
                        positionIdValue: createdPosition?.position_id
                    });
                    
                    if (createdPosition && createdPosition.id) {
                        console.log('[PositionManager] ✅ Position created successfully:', createdPosition.id);
                        console.log('[PositionManager] ✅ Created position data:', {
                            id: createdPosition.id,
                            position_id: createdPosition.position_id,
                            symbol: createdPosition.symbol,
                            strategy_name: createdPosition.strategy_name,
                            wallet_id: createdPosition.wallet_id,
                            trading_mode: createdPosition.trading_mode,
                            status: createdPosition.status
                        });
                        
                        // Add to in-memory cache with proper mapping
                        const mappedPosition = {
                            id: createdPosition.id, // Ensure the id field is set
                            position_id: createdPosition.position_id,
                            db_record_id: createdPosition.id,
                            strategy_name: createdPosition.strategy_name,
                            symbol: createdPosition.symbol,
                            direction: createdPosition.direction,
                            entry_price: parseFloat(createdPosition.entry_price) || 0,
                            quantity_crypto: parseFloat(createdPosition.quantity_crypto) || 0,
                            entry_value_usdt: parseFloat(createdPosition.entry_value_usdt) || 0,
                            entry_timestamp: createdPosition.entry_timestamp,
                            status: createdPosition.status,
                            stop_loss_price: parseFloat(createdPosition.stop_loss_price) || 0,
                            take_profit_price: parseFloat(createdPosition.take_profit_price) || 0,
                            enableTrailingTakeProfit: createdPosition.enableTrailingTakeProfit ?? true,
                            is_trailing: createdPosition.is_trailing || false,
                            trailing_stop_price: createdPosition.trailing_stop_price,
                            trailing_peak_price: createdPosition.trailing_peak_price,
                            peak_price: parseFloat(createdPosition.peak_price) || parseFloat(createdPosition.entry_price) || 0,
                            trough_price: parseFloat(createdPosition.trough_price) || parseFloat(createdPosition.entry_price) || 0,
                            wallet_id: createdPosition.wallet_id,
                            trading_mode: createdPosition.trading_mode
                        };
                        this.positions.push(mappedPosition);
                        
                        result.opened++;
                        result.openedPositions.push(mappedPosition);
                        
                        // CRITICAL FIX: Update cumulative position value for subsequent signals in the batch
                        const positionValue = positionSizeResult.positionValueUSDT || 0;
                        cumulativePositionValue += positionValue;
                        successfulPositionsInBatch++;
                        
                        console.log(`[PositionManager] 💰 Updated cumulative position value:`, {
                            previousCumulative: cumulativePositionValue - positionValue,
                            positionValue: positionValue,
                            newCumulative: cumulativePositionValue,
                            remainingCap: maxInvestmentCapPost ? maxInvestmentCapPost - (currentAllocated + cumulativePositionValue) : 'N/A',
                            successfulPositionsInBatch: successfulPositionsInBatch
                        });
                        
                        // Check if we've reached the cap and should stop processing more signals
                        if (maxInvestmentCapPost && maxInvestmentCapPost > 0) {
                            const totalAllocated = currentAllocated + cumulativePositionValue;
                            const remainingCap = maxInvestmentCapPost - totalAllocated;
                            
                            console.log(`[PositionManager] 💰 Cap check after position ${successfulPositionsInBatch}:`, {
                                totalAllocated: totalAllocated,
                                maxInvestmentCap: maxInvestmentCapPost,
                                remainingCap: remainingCap,
                                remainingSignals: signals.length - (successfulPositionsInBatch + result.errors.length)
                            });
                            
                            // If we're very close to the cap (within 1% or $10), stop processing more signals
                            const minimumBuffer = Math.min(maxInvestmentCapPost * 0.01, 10);
                            if (remainingCap <= minimumBuffer) {
                                console.log(`[PositionManager] 🚫 Cap nearly reached (${remainingCap.toFixed(2)} remaining, buffer: ${minimumBuffer.toFixed(2)}). Stopping batch processing.`);
                                break; // Exit the for loop to stop processing more signals
                            }
                        }
                        
                        // Update wallet state
                        if (this._getCurrentWalletState()) {
                            const currentIds = this._getCurrentWalletState().live_position_ids || [];
                            this._getCurrentWalletState().live_position_ids = [...currentIds, createdPosition.id];
                            
                            // BETTER APPROACH: Don't update local balance after position creation
                            // Instead, rely on Binance as the source of truth and refresh after position close
                            const positionValue = positionSizeResult.positionValueUSDT || 0;
                            
                            console.log('[PositionManager] 💰 Position created, will rely on Binance for balance updates:', {
                                positionValue: positionValue,
                                symbol: symbol,
                                note: 'Balance will be refreshed from Binance after position close'
                            });
                        }
                        
                } else {
                        console.log('[PositionManager] ❌ Failed to create position in database');
                        result.errors.push({
                            signal: signal,
                            error: 'Failed to create position in database'
                        });
                    }
                    
                } catch (signalError) {
                    console.error('[PositionManager] ❌ Error processing signal:', signalError);
                    result.errors.push({
                        signal: signal,
                        error: signalError.message
                    });
                }
            }
            
            // Notify subscribers after all positions are processed
            this.scannerService.notifyWalletSubscribers();

            console.log(`[PositionManager] ✅ Batch open completed: ${result.opened} positions opened, ${result.errors.length} errors`);

        } catch (error) {
            console.error('[PositionManager] ❌ Error in openPositionsBatch:', error);
            result.errors.push({
                type: 'general',
                error: error.message
            });
        }
        
        return result;
    }

       /**
        * Fix positions with zero quantity and value
        * @returns {Promise<Object>} Result with fixed count and errors
        */
       async fixZeroQuantityPositions() {
           console.log('[PositionManager] 🔧 FIXING ZERO QUANTITY POSITIONS - FUNCTION ENTRY POINT');
           console.log('[PositionManager] 🔧 FIXING ZERO QUANTITY POSITIONS');
           console.log('[PositionManager] 🔧 DEBUG: Function called successfully');
           
           const result = {
               fixed: 0,
               errors: []
           };
           
           try {
               console.log('[PositionManager] 🔧 Starting fixZeroQuantityPositions execution...');
               console.log('[PositionManager] 🔧 DEBUG: Reached try block');
               console.log('[PositionManager] 🔧 Scanner service state:', {
                   hasScannerService: !!this.scannerService,
                   hasState: !!(this.scannerService && this.scannerService.state),
                   hasIndicators: !!(this.scannerService && this.scannerService.state && this.scannerService.state.indicators),
                   hasKlineData: !!(this.scannerService && this.scannerService.state && this.scannerService.state.klineData),
                   indicatorsKeys: this.scannerService?.state?.indicators ? Object.keys(this.scannerService.state.indicators) : 'no indicators',
                   klineDataKeys: this.scannerService?.state?.klineData ? Object.keys(this.scannerService.state.klineData) : 'no kline data'
               });
               // Get all positions from database
               const allPositions = await queueEntityCall('LivePosition', 'filter', {
                   trading_mode: this.getTradingMode(),
                   status: ['open', 'trailing']
               });
               console.log('[PositionManager] 🔧 DEBUG: Database query completed');
               
               console.log(`[PositionManager] 🔍 Found ${allPositions?.length || 0} positions to check`);
               console.log('[PositionManager] 🔍 All positions details:', allPositions?.map(p => ({
                   id: p.id,
                   symbol: p.symbol,
                   quantity_crypto: p.quantity_crypto,
                   entry_value_usdt: p.entry_value_usdt,
                   time_exit_hours: p.time_exit_hours
               })));
               
               if (!allPositions || allPositions.length === 0) {
                   console.log('[PositionManager] ✅ No positions to fix');
                   return result;
               }
               
               // Find positions with zero quantity, value, OR hardcoded 24-hour exit time
               const zeroQuantityPositions = allPositions.filter(position => {
                   const quantity = parseFloat(position.quantity_crypto || 0);
                   const value = parseFloat(position.entry_value_usdt || 0);
                   const hasHardcodedExitTime = position.time_exit_hours === 24;
                   const needsFixing = quantity === 0 || value === 0 || hasHardcodedExitTime;
                   
                   console.log(`[PositionManager] 🔍 Checking position ${position.symbol}:`, {
                       quantity: quantity,
                       value: value,
                       time_exit_hours: position.time_exit_hours,
                       hasHardcodedExitTime: hasHardcodedExitTime,
                       needsFixing: needsFixing
                   });
                   
                   return needsFixing;
               });
               
               console.log(`[PositionManager] 🔍 Found ${zeroQuantityPositions.length} positions with zero quantity/value or hardcoded 24h exit time`);
               
               if (zeroQuantityPositions.length === 0) {
                   console.log('[PositionManager] ✅ No zero quantity positions found to fix');
                   return result;
               }
               
               // Log details of zero quantity positions
               console.log('[PositionManager] 🔍 Zero quantity positions details:', zeroQuantityPositions.map(p => ({
                   id: p.id,
                   symbol: p.symbol,
                   quantity_crypto: p.quantity_crypto,
                   entry_value_usdt: p.entry_value_usdt,
                   position_id: p.position_id
               })));
               
               // Fix each position
               for (const position of zeroQuantityPositions) {
                   try {
                       console.log(`[PositionManager] 🔧 Fixing position: ${position.symbol} (${position.position_id})`);
                       
                       // Get current price
                       const symbolNoSlash = position.symbol.replace('/', '');
                       const currentPrice = this.scannerService.currentPrices[symbolNoSlash];
                       
                       if (!currentPrice) {
                           console.log(`[PositionManager] ⚠️ No current price for ${position.symbol}, skipping`);
                           continue;
                       }
                       
                       // Calculate proper position size
                       const { calculatePositionSize } = await import('@/components/utils/dynamicPositionSizing');
                       
        const walletState = this._getCurrentWalletState();
                       const availableBalance = parseFloat(walletState?.available_balance || 0) || 0;
                       const totalEquity = parseFloat(walletState?.total_equity || 0);
                       
                       const settings = this.scannerService.state.settings || {};
                       const strategySettings = {
                           useWinStrategySize: settings.useWinStrategySize !== false,
                           defaultPositionSize: settings.defaultPositionSize || 100,
                           riskPerTrade: settings.riskPerTrade || 2,
                           minimumTradeValue: settings.minimumTradeValue || 10,
                           maxBalancePercentRisk: settings.maxBalancePercentRisk || 100,
                           maxBalanceInvestCapUSDT: settings.maxBalanceInvestCapUSDT || null
                       };
                       
                       // Try to get ATR data from scanner service or calculate it on-demand
                       let atrData = null;
                       try {
                           console.log(`[PositionManager] 🔍 Checking for ATR data for ${position.symbol} (${symbolNoSlash})`);
                           
                           // First, try to get ATR from scanner service indicators
                           console.log(`[PositionManager] 🔍 Scanner service state check:`, {
                               hasScannerService: !!this.scannerService,
                               hasState: !!(this.scannerService && this.scannerService.state),
                               hasIndicators: !!(this.scannerService && this.scannerService.state && this.scannerService.state.indicators),
                               indicatorsKeys: this.scannerService?.state?.indicators ? Object.keys(this.scannerService.state.indicators) : 'no indicators',
                               symbolNoSlash: symbolNoSlash
                           });
                           
                           if (this.scannerService && this.scannerService.state && this.scannerService.state.indicators) {
                               const indicators = this.scannerService.state.indicators[symbolNoSlash];
                               console.log(`[PositionManager] 🔍 Indicators for ${symbolNoSlash}:`, {
                                   hasIndicators: !!indicators,
                                   indicators: indicators,
                                   hasATR: !!(indicators && indicators.atr),
                                   atrLength: indicators?.atr?.length || 0
                               });
                               
                               if (indicators && indicators.atr && indicators.atr.length > 0) {
                                   atrData = indicators.atr[indicators.atr.length - 1];
                                   console.log(`[PositionManager] 🔍 Found ATR data from scanner service for ${position.symbol}: ${atrData}`);
                               } else {
                                   console.log(`[PositionManager] 🔍 No ATR data in scanner indicators for ${position.symbol}`);
                               }
                           } else {
                               console.log(`[PositionManager] 🔍 No scanner service indicators available`);
                           }
                           
                           // If no ATR data from scanner service, log critical error
                           if (!atrData || atrData === 0) {
                               console.error(`[PositionManager] ❌ CRITICAL ERROR: No ATR data available for ${position.symbol}`);
                               console.error(`[PositionManager] ❌ ATR data is required for proper risk management - position cannot be opened safely`);
                               console.error(`[PositionManager] ❌ Scanner service indicators missing ATR for ${symbolNoSlash}`);
                               throw new Error(`Missing ATR data for ${position.symbol} - cannot proceed without proper risk management`);
                           }
                           
                       } catch (error) {
                           console.log(`[PositionManager] ⚠️ Error getting ATR data for ${position.symbol}:`, error);
                       }
                       
                       // If still no ATR data, skip this position
                       if (!atrData || atrData === 0) {
                           console.error(`[PositionManager] ❌ MISSING ATR DATA - Cannot fix position ${position.symbol}:`, {
                               symbol: position.symbol,
                               atrData: atrData,
                               reason: 'ATR (Average True Range) is required for volatility-adjusted position sizing',
                               impact: 'Position cannot be fixed without ATR data',
                               solution: 'Ensure ATR indicators are calculated and available in scanner service'
                           });
                           
                           result.errors.push({
                               positionId: position.id,
                               error: `Missing ATR data for ${position.symbol} - cannot calculate position size`
                           });
                           continue;
                       }
                       
                       // Use ATR-based sizing if ATR data is available
                       const positionSizeResult = calculatePositionSize({
                           strategySettings: strategySettings,
                           currentPrice: currentPrice,
                           convictionScore: position.conviction_score || 50,
                           convictionDetails: position.conviction_details || {},
                           availableCash: availableBalance,
                           totalWalletBalance: totalEquity,
                           balanceInTrades: 0,
                           symbol: position.symbol,
                           exchangeInfo: (() => {
                               const exchangeInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolNoSlash) : null;
                               console.log('[PositionManager] 🔍 Exchange info for', symbolNoSlash, ':', {
                                   hasExchangeInfo: !!exchangeInfo,
                                   hasFilters: !!exchangeInfo?.filters,
                                   filtersType: typeof exchangeInfo?.filters,
                                   filtersIsArray: Array.isArray(exchangeInfo?.filters),
                                   filtersKeys: exchangeInfo?.filters ? Object.keys(exchangeInfo.filters) : 'no filters',
                                   lotSizeFilter: exchangeInfo?.filters?.LOT_SIZE,
                                   minNotionalFilter: exchangeInfo?.filters?.MIN_NOTIONAL
                               });
                               return exchangeInfo;
                           })(),
                           indicators: { atr: [atrData] } // Pass ATR data
                       });
                       
                       if (positionSizeResult.error || !positionSizeResult.isValid) {
                           console.error(`[PositionManager] ❌ ATR-based position sizing failed for ${position.symbol}:`, {
                               error: positionSizeResult.error || positionSizeResult.reason,
                               message: positionSizeResult.message
                           });
                           
                           result.errors.push({
                               positionId: position.id,
                               error: `ATR-based sizing failed: ${positionSizeResult.error || positionSizeResult.reason}`
                           });
                    continue;
                }

                       // Create a mock combination object for exit parameter calculation
                       // This simulates the BacktestCombination data that would normally come from the strategy
                       const mockCombination = {
                           strategyDirection: position.direction || 'long',
                           stopLossAtrMultiplier: 2.5,
                           takeProfitAtrMultiplier: 5.0,
                           estimatedExitTimeMinutes: 1440, // Default 24 hours in minutes
                           enableTrailingTakeProfit: false,
                           trailingStopPercentage: 0.02 // 2% trailing stop
                       };
                       
                       // Calculate new exit parameters using the new logic with actual ATR data
                       const newExitTimeHours = this.calculateExitTimeFromStrategy(mockCombination, currentPrice);
                       const newStopLossPrice = this.calculateStopLossPrice(mockCombination, currentPrice, atrData);
                       const newTakeProfitPrice = this.calculateTakeProfitPrice(mockCombination, currentPrice, atrData);
                       
                       // Update position with calculated values
                       const updateData = {
                           quantity_crypto: positionSizeResult.quantityCrypto,
                           entry_value_usdt: positionSizeResult.positionValueUSDT,
                           time_exit_hours: newExitTimeHours,
                           stop_loss_price: newStopLossPrice,
                           take_profit_price: newTakeProfitPrice,
                           last_updated_timestamp: new Date().toISOString()
                       };
                       
                       console.log(`[PositionManager] 🔄 Updating position ${position.symbol} with ATR-based strategy parameters:`, {
                           positionId: position.id,
                           oldQuantity: position.quantity_crypto,
                           newQuantity: positionSizeResult.quantityCrypto,
                           oldValue: position.entry_value_usdt,
                           newValue: positionSizeResult.positionValueUSDT,
                           oldExitTime: position.time_exit_hours,
                           newExitTime: newExitTimeHours,
                           oldStopLoss: position.stop_loss_price,
                           newStopLoss: newStopLossPrice,
                           oldTakeProfit: position.take_profit_price,
                           newTakeProfit: newTakeProfitPrice,
                           atr: atrData,
                           method: 'atr_based_sizing'
                       });
                       
                       await queueEntityCall('LivePosition', 'update', position.id, updateData);
                       console.log(`[PositionManager] ✅ Successfully updated position ${position.symbol}`);
                       
                       // Update in-memory cache
                       const cachedPosition = this.positions.find(p => p.id === position.id);
                       if (cachedPosition) {
                           cachedPosition.quantity_crypto = positionSizeResult.quantityCrypto;
                           cachedPosition.entry_value_usdt = positionSizeResult.positionValueUSDT;
                           cachedPosition.time_exit_hours = newExitTimeHours;
                           cachedPosition.stop_loss_price = newStopLossPrice;
                           cachedPosition.take_profit_price = newTakeProfitPrice;
                           cachedPosition.last_updated_timestamp = updateData.last_updated_timestamp;
                       }
                       
                       result.fixed++;
                       console.log(`[PositionManager] ✅ Fixed position ${position.symbol} with ATR-based strategy parameters: qty=${positionSizeResult.quantityCrypto}, value=${positionSizeResult.positionValueUSDT}, exitTime=${newExitTimeHours}h, stopLoss=${newStopLossPrice}, takeProfit=${newTakeProfitPrice}, atr=${atrData}`);
                       
            } catch (error) {
                       console.error(`[PositionManager] ❌ Error fixing position ${position.id}:`, error);
                       result.errors.push({
                           positionId: position.id,
                           error: error.message
                       });
                   }
               }
               
               console.log(`[PositionManager] ✅ Zero quantity position fix complete:`, {
                   fixed: result.fixed,
                   errors: result.errors.length,
                   totalPositions: allPositions?.length || 0,
                   zeroQuantityFound: zeroQuantityPositions.length
               });
               
           } catch (error) {
               console.error('[PositionManager] ❌ Error in fixZeroQuantityPositions:', error);
               console.error('[PositionManager] ❌ Error stack:', error.stack);
               console.error('[PositionManager] ❌ Error details:', {
                   message: error.message,
                   name: error.name,
                   stack: error.stack
               });
               result.errors.push({
                   type: 'general',
                   error: error.message
               });
           }
           
           console.log('[PositionManager] 🔧 fixZeroQuantityPositions returning result:', result);
           return result;
       }

       /**
        * Reconcile position data to clean up stale records
        * @returns {Promise<Object>} Result with cleaned count and errors
        */
       async reconcilePositionData() {
        console.log('[PositionManager] 🔄 RECONCILING POSITION DATA');
        
        const result = {
            cleaned: 0,
            errors: []
        };
        
        try {
            // Get all positions from database
            const allPositions = await queueEntityCall('LivePosition', 'filter', {
                trading_mode: this.getTradingMode(),
                status: ['open', 'trailing']
            });
            
            console.log(`[PositionManager] 🔍 Found ${allPositions?.length || 0} positions in database`);
            
            if (!allPositions || allPositions.length === 0) {
                console.log('[PositionManager] ✅ No positions to reconcile');
            return result;
            }
            
            // Check for stale positions (older than 24 hours with no recent activity)
            const staleThreshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
            const stalePositions = allPositions.filter(position => {
                const entryTime = new Date(position.entry_timestamp).getTime();
                const lastUpdate = new Date(position.last_updated_timestamp || position.entry_timestamp).getTime();
                return entryTime < staleThreshold && lastUpdate < staleThreshold;
            });
            
            console.log(`[PositionManager] 🔍 Found ${stalePositions.length} potentially stale positions`);
            
            // Clean up stale positions
            for (const position of stalePositions) {
                try {
                    console.log(`[PositionManager] 🧹 Cleaning stale position: ${position.symbol} (${position.position_id})`);
                    await this._safeDeleteLivePosition(position.id);
                    result.cleaned++;
            } catch (error) {
                    console.error(`[PositionManager] ❌ Error cleaning position ${position.id}:`, error);
                    result.errors.push({
                        positionId: position.id,
                        error: error.message
                    });
                }
            }
            
            // Reload managed state after cleanup
            const walletState = this._getCurrentWalletState();
            if (walletState && walletState.id) {
                await this.loadManagedState(walletState);
                console.log(`[PositionManager] ✅ Reloaded managed state after reconciliation`);
            }
            
            console.log(`[PositionManager] ✅ Position data reconciliation complete: ${result.cleaned} cleaned, ${result.errors.length} errors`);

        } catch (error) {
            console.error('[PositionManager] ❌ Error in reconcilePositionData:', error);
            result.errors.push({
                type: 'general',
                error: error.message
            });
        }
        
        return result;
    }

    /**
     * Persist wallet changes and wait for completion
     * @returns {Promise<void>}
     */
    async persistWalletChangesAndWait() {
        console.log('[PositionManager] 💾 Persisting wallet changes...');
        
        try {
            // Mark wallet as saving
            if (this.scannerService?.state) {
                this.scannerService.state.isWalletSaving = true;
            }
            
            // Simulate wallet persistence (in real implementation, this would save to database)
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Mark wallet save as complete
            if (this.scannerService?.state) {
                this.scannerService.state.isWalletSaving = false;
            }
            
            console.log('[PositionManager] ✅ Wallet changes persisted successfully');
            } catch (error) {
            console.error('[PositionManager] ❌ Error persisting wallet changes:', error);
            // Mark wallet save as complete even on error
            if (this.scannerService?.state) {
                this.scannerService.state.isWalletSaving = false;
            }
            throw error;
        }
    }

    /**
     * PRE-CLOSE VALIDATION: Validates positions and groups them into valid closures and dust closures
     * This performs pre-validation before attempting to close positions on Binance
     * @param {Array} tradesToCreate - Array of trade data objects
     * @param {Array} positionIdsToClose - Array of position IDs to close
     * @param {Object} currentPrices - Map of symbol -> current price
     * @returns {Object} { validClosures: [], dustClosures: [] }
     */
    async _validateAndGroupPositionsForClosure(tradesToCreate, positionIdsToClose, currentPrices) {
        const validClosures = [];
        const dustClosures = [];
        
        console.log('[PositionManager] 🔍 [PRE-CLOSE_VALIDATION] Validating positions...');
        this.addLog(`[PRE-CLOSE_VALIDATION] 🔍 Validating ${tradesToCreate.length} positions...`, 'info');
        
        for (let i = 0; i < tradesToCreate.length; i++) {
            const tradeData = tradesToCreate[i];
            const positionId = positionIdsToClose[i];
            
            // Find position in memory
            let position = this.positions.find(p => 
                p.id === positionId || 
                p.db_record_id === positionId || 
                p.position_id === positionId
            );
            
            if (!position) {
                console.log(`[PositionManager] ⚠️ [PRE-CLOSE_VALIDATION] Position ${positionId} not found in memory, skipping validation`);
                // If position not found, assume valid (will be handled in executeBatchClose)
                validClosures.push({ position, positionId, tradeData, validationResult: 'position_not_found' });
                continue;
            }
            
            const symbol = position.symbol;
            const symbolNoSlash = symbol.replace('/', '');
            const currentPrice = currentPrices?.[symbolNoSlash] || tradeData.exit_price || position.entry_price;
            
            try {
                // Get exchange info and filters
                const symbolInfo = this.getExchangeInfo ? this.getExchangeInfo(symbolNoSlash) : null;
                if (!symbolInfo) {
                    // CRITICAL FIX: Handle missing exchange info as error, don't assume valid
                    console.log(`[PositionManager] ❌ [PRE-CLOSE_VALIDATION] No exchange info for ${symbolNoSlash} - cannot validate position size`);
                    this.addLog(
                        `[PRE-CLOSE_VALIDATION] ❌ No exchange info for ${symbol} (${symbolNoSlash}). Cannot validate - skipping closure.`,
                        'error'
                    );
                    // Don't add to validClosures - treat as error that needs investigation
                    continue; // Skip this position as we cannot safely validate it
                }
                
                const { minNotional, minQty, stepSize } = getSymbolFiltersFromInfo(symbolInfo);
                const positionQty = Number(position.quantity_crypto || 0);
                const notional = positionQty * Number(currentPrice || 0);
                
                // Check if closing context (has exit reason)
                const isClosingContext = tradeData.exit_reason !== undefined;
                
                // Dust validation logic (same as _executeBinanceMarketSellOrder)
                const positionQtyRounded = roundDownToStepSize(positionQty, stepSize);
                const positionNotional = positionQtyRounded * Number(currentPrice || 0);
                const positionMeetsMinimums = positionQtyRounded >= minQty && positionNotional >= minNotional;
                
                const belowLot = minQty && positionQtyRounded < minQty - 1e-12;
                const belowNotional = minNotional && positionNotional < (minNotional - 1e-8);
                
                console.log(`[PositionManager] 🔍 [PRE-CLOSE_VALIDATION] ${symbol}:`, {
                    positionQty,
                    positionQtyRounded,
                    positionNotional,
                    minQty,
                    minNotional,
                    belowLot,
                    belowNotional,
                    positionMeetsMinimums,
                    isClosingContext
                });
                
                // Validation decision logic
                if (isClosingContext && positionMeetsMinimums) {
                    // Closing context with valid minimums -> VALID
                    console.log(`[PositionManager] ✅ [PRE-CLOSE_VALIDATION] ${symbol}: VALID (closing context, meets minimums)`);
                    validClosures.push({ 
                        position, 
                        positionId, 
                        tradeData, 
                        validationResult: 'valid_closing_context' 
                    });
                } else if (belowLot || belowNotional) {
                    // Below minimums -> DUST
                    console.log(`[PositionManager] 🧹 [PRE-CLOSE_VALIDATION] ${symbol}: DUST (below minimums)`);
                    dustClosures.push({ 
                        position, 
                        positionId, 
                        tradeData, 
                        validationResult: 'dust_below_minimums',
                        dustReason: belowLot ? 'below_lot_size' : 'below_notional',
                        minQty,
                        minNotional,
                        positionQty: positionQtyRounded,
                        positionNotional
                    });
                } else {
                    // Meets minimums -> VALID
                    console.log(`[PositionManager] ✅ [PRE-CLOSE_VALIDATION] ${symbol}: VALID (meets minimums)`);
                    validClosures.push({ 
                        position, 
                        positionId, 
                        tradeData, 
                        validationResult: 'valid_meets_minimums' 
                    });
                }
                
            } catch (validationError) {
                console.error(`[PositionManager] ❌ [PRE-CLOSE_VALIDATION] Error validating ${symbol}:`, validationError);
                // On error, assume valid (let executeBatchClose handle it)
                validClosures.push({ 
                    position, 
                    positionId, 
                    tradeData, 
                    validationResult: 'validation_error',
                    error: validationError.message
                });
            }
        }
        
        console.log('[PositionManager] ✅ [PRE-CLOSE_VALIDATION] Validation complete:', {
            total: tradesToCreate.length,
            valid: validClosures.length,
            dust: dustClosures.length
        });
        
        return { validClosures, dustClosures };
    }

    /**
     * Dust cleanup for positions too small to trade on Binance
     * 
     * IMPORTANT: This is for positions that are BELOW Binance minimums and CANNOT be traded.
     * We attempt a real Binance close first, but if it's rejected (too small), we clean up the database.
     * 
     * This is NOT "fake trading" - it's handling positions that literally cannot be sold on Binance.
     * 
     * @param {string} symbol - The trading pair with dust (e.g., "BTCUSDT")
     * @param {string} mode - "live" or "testnet"
     * @returns {Object} Result with success status and details
     */
    async virtualCloseDustPositions(symbol, mode) {
        console.log('[PositionManager] 🧹 DUST CLEANUP - Positions too small to trade on Binance');
        console.log('[PositionManager] 🧹 Symbol:', symbol);
        console.log('[PositionManager] 🧹 Mode:', mode);
        
        try {
            // Find dust positions for this symbol and mode
            const dustPositions = this.positions.filter(pos => 
                pos.symbol === symbol && 
                pos.trading_mode === mode &&
                pos.status === 'open'
            );
            
            if (dustPositions.length === 0) {
                console.log('[PositionManager] 🧹 No dust positions found for', symbol);
                return { success: true, closed: 0 };
            }
            
            console.log('[PositionManager] 🧹 Found dust positions:', dustPositions.length);
            
            const tradesToCreate = [];
            const positionIdsToClose = [];
            
            for (const position of dustPositions) {
                // Get current price for P&L calculation
                const symbolNoSlash = position.symbol.replace('/', '');
                const currentPrice = this.scannerService.currentPrices[symbolNoSlash] || position.entry_price;
                
                // Create trade record for dust cleanup (position too small to trade on Binance)
                // NOTE: This position will attempt REAL Binance close via executeBatchClose first
                // If Binance rejects (too small), this record tracks the cleanup
                const dustCleanupTrade = {
                    trade_id: `dust_cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    strategy_name: position.strategy_name,
                    symbol: position.symbol,
                    direction: position.direction,
                    entry_price: position.entry_price,
                    exit_price: currentPrice,
                    quantity_crypto: position.quantity_crypto,
                    entry_value_usdt: position.entry_value_usdt,
                    exit_value_usdt: parseFloat(position.quantity_crypto) * currentPrice,
                    pnl_usdt: -0.01, // Small negative P&L to reflect dust loss
                    pnl_percentage: -0.01,
                    entry_timestamp: position.entry_timestamp,
                    exit_timestamp: new Date().toISOString(),
                    duration_seconds: Math.floor((Date.now() - new Date(position.entry_timestamp).getTime()) / 1000),
                    exit_reason: 'dust_cleanup',  // Renamed for clarity
                    trading_mode: mode,
                    total_fees_usdt: 0.01,
                    note: 'Position below Binance minimums - removed from tracking (cannot execute real trade)'
                };
                
                tradesToCreate.push(dustCleanupTrade);
                // Use the primary ID that matches what's in memory
                const positionIdToClose = position.id || position.db_record_id || position.position_id;
                positionIdsToClose.push(positionIdToClose);
                console.log(`[PositionManager] 🔍 DUST CLEANUP: Pushed position ID: ${positionIdToClose}`);
                
                console.log('[PositionManager] 🧹 Created dust cleanup trade record for position:', position.position_id);
            }
            
            // Execute batch close (will attempt REAL Binance close first, clean up if rejected)
            const result = await this.executeBatchClose(tradesToCreate, positionIdsToClose);

            if (result.success) {
                console.log('[PositionManager] ✅ Dust cleanup completed for positions:', result.closed);
                this.addLog(
                    `[DUST_CLEANUP] ✅ Cleaned ${result.closed} dust positions for ${symbol} (positions too small to trade on Binance)`,
                    'success'
                );
        } else {
                console.log('[PositionManager] ❌ Dust cleanup failed:', result.error);
                this.addLog(`[DUST_CLEANUP] ❌ Dust cleanup failed: ${result.error}`, 'error');
            }

            return result;

            } catch (error) {
            console.log('[PositionManager] ❌ Error in virtual close dust positions:', error);
            this.addLog(`[DUST_CLEANUP] ❌ Error: ${error.message}`, 'error');
            return { success: false, error: error.message, closed: 0 };
        }
    }

    /**
     * Perform direct virtual close for dust positions (fallback implementation)
     * @param {string} symbol - The trading pair symbol (e.g., "SOLUSDT")
     * @param {string} mode - "live" or "testnet"
     * @param {number} positionQty - The position quantity
     * @returns {Object} Result with success status and details
     */
    async performDirectVirtualClose(symbol, mode, positionQty) {
        const _dvc_overall_start = Date.now();
        console.log('[PositionManager] 🔄 [DIRECT_VIRTUAL_CLOSE] Starting direct virtual close...');
        console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] overall_start_ms:', _dvc_overall_start);
        console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Symbol:', symbol, 'Mode:', mode, 'Qty:', positionQty);
        console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Current positions count:', this.positions.length);
        console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Current positions:', this.positions.map(p => ({ id: p.id, symbol: p.symbol, status: p.status, trading_mode: p.trading_mode })));
        
        try {
            // Find positions for this symbol and mode
            const symbolWithSlash = symbol.replace('USDT', '/USDT');
            const _dvc_find_start = Date.now();
            const positionsToClose = this.positions.filter(pos => 
                (pos.symbol === symbolWithSlash || pos.symbol === symbol) && 
                pos.trading_mode === mode &&
                pos.status === 'open'
            );
            console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] find_positions_ms:', Date.now() - _dvc_find_start);
            
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Found positions:', positionsToClose.length);
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Position details:', positionsToClose.map(p => ({
                id: p.id,
                symbol: p.symbol,
                quantity: p.quantity_crypto,
                status: p.status
            })));
            
            if (positionsToClose.length === 0) {
                console.log('[PositionManager] ⚠️ [DIRECT_VIRTUAL_CLOSE] No positions found to close');
                return { success: true, virtualClosed: 0, message: 'No positions found' };
            }
            
            // Create dust trades for each position
            const dustTrades = [];
            const _dvc_build_start = Date.now();
            for (const position of positionsToClose) {
                try {
                    console.log('[PositionManager] 🔄 [DIRECT_VIRTUAL_CLOSE] Creating dust trade for position:', position.id);
                    
                    const dustTrade = {
                        id: generateTradeId(),
                        trade_id: position.position_id || position.id,
                        strategy_name: position.strategy_name || 'Dust Cleanup',
                        symbol: position.symbol,
                        direction: position.direction || 'long',
                        entry_price: position.entry_price || 0,
                        quantity_crypto: position.quantity_crypto || 0,
                        entry_value_usdt: (position.entry_price || 0) * (position.quantity_crypto || 0),
                        entry_timestamp: position.entry_timestamp || new Date().toISOString(),
                        trading_mode: mode,
                        trigger_signals: position.trigger_signals || [],
                        combined_strength: position.combined_strength || 0,
                        conviction_score: position.conviction_score || 0,
                        conviction_breakdown: position.conviction_breakdown || {},
                        conviction_multiplier: position.conviction_multiplier || 1,
                        market_regime: position.market_regime || 'unknown',
                        regime_confidence: position.regime_confidence || 0,
                        atr_value: position.atr_value || 0,
                        is_event_driven_strategy: position.is_event_driven_strategy || false,
                        fear_greed_score: position.fear_greed_score || '50',
                        fear_greed_classification: position.fear_greed_classification || 'Neutral',
                        lpm_score: position.lpm_score || 50,
                        exit_price: position.entry_price || 0, // Use entry price as exit for dust
                        exit_value_usdt: (position.entry_price || 0) * (position.quantity_crypto || 0),
                        pnl_usdt: 0, // No P&L for dust cleanup
                        pnl_percentage: 0,
                        exit_timestamp: new Date().toISOString(),
                        duration_seconds: 0,
                        exit_reason: 'dust_cleanup',
                        total_fees_usdt: 0,
                        commission_migrated: true,
                        created_date: new Date().toISOString(),
                        updated_date: new Date().toISOString(),
                        isDustCleanup: true
                    };
                    
                    dustTrades.push(dustTrade);
                    console.log('[PositionManager] ✅ [DIRECT_VIRTUAL_CLOSE] Created dust trade:', dustTrade.id);
                } catch (tradeError) {
                    console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error creating dust trade:', tradeError.message);
                }
            }
            console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] build_dust_trades_ms:', Date.now() - _dvc_build_start);
            
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Created dust trades:', dustTrades.length);
            
            // Save dust trades to database
            let savedTrades = 0;
            const _dvc_save_start = Date.now();
            for (const dustTrade of dustTrades) {
                try {
                    console.log('[PositionManager] 🔄 [DIRECT_VIRTUAL_CLOSE] Saving dust trade to database:', dustTrade.id);
                    const saveResult = await queueFunctionCall(
                        'saveTradeToDB',
                        async (trade) => {
                            const { queueEntityCall } = await import('@/components/utils/apiQueue');
                            return await queueEntityCall('Trade', 'create', trade);
                        },
                        dustTrade,
                        'critical',
                        null,
                        0,
                        30000
                    );
                    
                    console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Save result for trade:', dustTrade.id, saveResult);
                    if (saveResult && saveResult.success) {
                        savedTrades++;
                        console.log('[PositionManager] ✅ [DIRECT_VIRTUAL_CLOSE] Dust trade saved:', dustTrade.id);
                    } else {
                        console.log('[PositionManager] ⚠️ [DIRECT_VIRTUAL_CLOSE] Failed to save dust trade:', dustTrade.id, saveResult?.error);
                    }
                } catch (saveError) {
                    console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error saving dust trade:', saveError.message);
                }
            }
            console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] save_trades_ms:', Date.now() - _dvc_save_start);
            
            // Remove positions from memory
            const originalCount = this.positions.length;
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Before removal - positions count:', originalCount);
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Looking for positions to remove - symbol:', symbol, 'symbolWithSlash:', symbolWithSlash, 'mode:', mode);
            
            const _dvc_remove_start = Date.now();
            this.positions = this.positions.filter(pos => {
                const shouldRemove = (pos.symbol === symbolWithSlash || pos.symbol === symbol) && 
                                   pos.trading_mode === mode &&
                                   pos.status === 'open';
                if (shouldRemove) {
                    console.log('[PositionManager] 🗑️ [DIRECT_VIRTUAL_CLOSE] Removing position:', pos.id, pos.symbol, pos.status);
                }
                return !shouldRemove;
            });
            const removedCount = originalCount - this.positions.length;
            console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] remove_positions_ms:', Date.now() - _dvc_remove_start);
            
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Removed positions from memory:', removedCount);
            console.log('[PositionManager] 🔍 [DIRECT_VIRTUAL_CLOSE] Positions remaining:', this.positions.length);
            
            // Update wallet state
            try {
                const _dvc_wallet_start = Date.now();
                console.log('[PositionManager] 🔄 [DIRECT_VIRTUAL_CLOSE] Updating wallet state...');
                await queueFunctionCall(
                    'reconcileWalletState',
                    reconcileWalletState,
                    { mode: mode },
                    'normal',
                    null,
                    0,
                    30000
                );
                console.log('[PositionManager] ✅ [DIRECT_VIRTUAL_CLOSE] Wallet state updated');
                console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] wallet_update_ms:', Date.now() - _dvc_wallet_start);
            } catch (walletError) {
                console.log('[PositionManager] ⚠️ [DIRECT_VIRTUAL_CLOSE] Wallet state update failed:', walletError.message);
            }
            
            const result = {
                success: true,
                virtualClosed: removedCount,
                tradesCreated: savedTrades,
                message: `Direct virtual close completed: ${removedCount} positions closed, ${savedTrades} trades created`
            };
            
            console.log('[PositionManager] ⏱️ [DIRECT_VIRTUAL_CLOSE_TIMING] overall_ms:', Date.now() - _dvc_overall_start);
            console.log('[PositionManager] ✅ [DIRECT_VIRTUAL_CLOSE] Success:', result);
            return result;
            
        } catch (error) {
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error:', error);
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error type:', typeof error);
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error message:', error?.message);
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error string:', String(error));
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Error stack:', error?.stack);
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Full error object:', JSON.stringify(error, null, 2));
            const errorMessage = error?.message || error?.toString() || 'Unknown error in direct virtual close';
            console.log('[PositionManager] ❌ [DIRECT_VIRTUAL_CLOSE] Final error message:', errorMessage);
            return { success: false, error: errorMessage, virtualClosed: 0 };
        }
    }

    /**
     * Execute batch close of positions
     * @param {Array} tradesToCreate - Array of Trade objects to create
     * @param {Array} positionIdsToClose - Array of position IDs to close
     * @returns {Object} Result with success status and details
     */
    async executeBatchClose(tradesToCreate, positionIdsToClose) {
        console.log('[position_manager_debug] 🔍 ===== EXECUTE_BATCH_CLOSE ENTRY =====');
        console.log('[position_manager_debug] 🔍 Function called at:', new Date().toISOString());
        console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL TEST LOG - EXECUTE_BATCH_CLOSE IS BEING CALLED');
        console.log('[PositionManager] 🔍 [EXECUTION_TRACE] step_5: executeBatchClose entry point reached');
        
        //console.log('🔥🔥🔥 EXECUTING BATCH CLOSE - DEBUGGING VERSION 🔥🔥🔥');
        //console.log('🔥🔥🔥 RECEIVED ARRAYS:', { tradesToCreate: tradesToCreate.length, positionIdsToClose: positionIdsToClose.length });
        //console.log('🔥🔥🔥 RECEIVED POSITION IDS:', positionIdsToClose);
        //console.log('🔥🔥🔥 RECEIVED TRADES:', tradesToCreate);
        console.log('[PositionManager] 🚀 EXECUTING BATCH CLOSE');
        console.log('[PositionManager] 🔍 [EXECUTE_BATCH_CLOSE] Function entry - about to start processing...');
        console.log('[PositionManager] 🚀 Trades to create:', tradesToCreate.length);
        console.log('[PositionManager] 🚀 Positions to close:', positionIdsToClose.length);
        console.log('[PositionManager] 🚀 Current time:', new Date().toISOString());
        console.log('[PositionManager] 🚀 Position IDs to close (first 5):', positionIdsToClose.slice(0, 5));
        console.log('[PositionManager] 🚀 Positions in memory (first 5):', this.positions.slice(0, 5).map(p => ({ id: p.id, db_record_id: p.db_record_id, position_id: p.position_id, symbol: p.symbol })));
        
        // CRITICAL TEST: Check if ANY position IDs can be found in memory
        console.log('[PositionManager] 🚀 CRITICAL TEST - CAN WE FIND ANY POSITIONS?');
        let foundCount = 0;
        for (const positionId of positionIdsToClose) {
            const found = this.positions.find(p => p.id === positionId || p.db_record_id === positionId || p.position_id === positionId);
            if (found) {
                foundCount++;
                console.log(`[PositionManager] 🚀 ✅ FOUND position ${positionId} -> ${found.symbol}`);
            } else {
                console.log(`[PositionManager] 🚀 ❌ NOT FOUND position ${positionId}`);
            }
        }
        //console.log(`🔥🔥🔥 CRITICAL TEST RESULT: Found ${foundCount}/${positionIdsToClose.length} positions in memory 🔥🔥🔥`);
        
        // DEBUG: Log each position that will be closed
        console.log('[PositionManager] 🚀 DETAILED POSITION ANALYSIS:');
        console.log('[PositionManager] 🚀 Position IDs to close:', positionIdsToClose);
        console.log('[PositionManager] 🚀 Available positions in memory:', this.positions.map(p => ({ id: p.id, db_record_id: p.db_record_id, position_id: p.position_id, symbol: p.symbol })));
        
        // CRITICAL DEBUG: Check if any position IDs match
        console.log('[PositionManager] 🚀 POSITION ID MATCHING ANALYSIS:');
        console.log('[PositionManager] 🚀 Total positions in memory:', this.positions.length);
        console.log('[PositionManager] 🚀 Positions to close:', positionIdsToClose.length);
        console.log('[PositionManager] 🚀 Sample positions in memory:', this.positions.slice(0, 3).map(p => ({
            id: p.id,
            db_record_id: p.db_record_id,
            position_id: p.position_id,
            symbol: p.symbol,
            status: p.status
        })));
        
        for (const positionId of positionIdsToClose) {
            const foundById = this.positions.find(p => p.id === positionId);
            const foundByDbRecordId = this.positions.find(p => p.db_record_id === positionId);
            const foundByPositionId = this.positions.find(p => p.position_id === positionId);
            
            console.log(`[PositionManager] 🚀 Position ID ${positionId}:`, {
                foundById: !!foundById,
                foundByDbRecordId: !!foundByDbRecordId,
                foundByPositionId: !!foundByPositionId,
                isUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(positionId),
                foundByIdSymbol: foundById?.symbol,
                foundByDbRecordIdSymbol: foundByDbRecordId?.symbol,
                foundByPositionIdSymbol: foundByPositionId?.symbol
            });
        }
        
        console.log('[position_manager_debug] 🔍 About to start main processing loop...');
        console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - STARTING MAIN LOOP');
        
        for (let i = 0; i < positionIdsToClose.length; i++) {
            console.log(`[position_manager_debug] 🔍 Processing position ${i + 1}/${positionIdsToClose.length}: ${positionIdsToClose[i]}`);
            const positionId = positionIdsToClose[i];
            
            console.log(`[position_manager_debug] 🔍 Looking for position with ID: ${positionId}`);
            
            // Try multiple ways to find the position
            let position = this.positions.find(p => p.id === positionId);
            console.log(`[position_manager_debug] 🔍 Found by id: ${!!position}`);
            if (!position) {
                position = this.positions.find(p => p.db_record_id === positionId);
                console.log(`[position_manager_debug] 🔍 Found by db_record_id: ${!!position}`);
            }
            if (!position) {
                position = this.positions.find(p => p.position_id === positionId);
                console.log(`[position_manager_debug] 🔍 Found by position_id: ${!!position}`);
            }
                // CRITICAL FIX: Also try matching by the database UUID if positionId is a UUID
                if (!position && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(positionId)) {
                    position = this.positions.find(p => p.id === positionId);
            }
            
            if (position) {
                console.log(`[PositionManager] 🚀 Position ${i + 1}/${positionIdsToClose.length}:`, {
                    symbol: position.symbol,
                    position_id: position.position_id,
                    id: position.id,
                    db_record_id: position.db_record_id,
                    quantity_crypto: position.quantity_crypto,
                    status: position.status,
                    entry_price: position.entry_price,
                    take_profit_price: position.take_profit_price,
                    stop_loss_price: position.stop_loss_price
                });
            } else {
                console.log(`[PositionManager] ⚠️ Position ${positionId} not found in this.positions array`);
            }
        }
        console.log('[PositionManager] 🚀 Trades details:', tradesToCreate.map(t => ({ symbol: t.symbol, exit_reason: t.exit_reason, pnl: t.pnl_usdt })));
        
        console.log('[position_manager_debug] 🔍 About to check early exit conditions...');
        console.log('[position_manager_debug] 🔍 tradesToCreate.length:', tradesToCreate.length);
        console.log('[position_manager_debug] 🔍 positionIdsToClose.length:', positionIdsToClose.length);
        
        /*if (tradesToCreate.length === 0 || positionIdsToClose.length === 0) {
            console.log('[position_manager_debug] 🔍 EARLY EXIT - NO POSITIONS TO CLOSE');
            console.log('🔥🔥🔥 EARLY EXIT - NO POSITIONS TO CLOSE 🔥🔥🔥');
            console.log('[PositionManager] 🚀 No positions to close, returning success');
            console.log('[PositionManager] 🚀 tradesToCreate.length:', tradesToCreate.length);
            console.log('[PositionManager] 🚀 positionIdsToClose.length:', positionIdsToClose.length);
            return { success: true, closed: 0 };
        }*/
        
        //console.log('[position_manager_debug] 🔍 PASSED EARLY EXIT CHECK - PROCEEDING WITH POSITION CLOSING');
        //console.log('🔥🔥🔥 PASSED EARLY EXIT CHECK - PROCEEDING WITH POSITION CLOSING 🔥🔥🔥');

        const processedTrades = [];
        const errors = [];
        const successfullyClosedPositionIds = []; // Track IDs of successfully closed positions
        
        // CRITICAL: Initialize processedTradeIds if it doesn't exist
        if (!this.processedTradeIds) {
            this.processedTradeIds = new Set();
        }

        try {
            //console.log('🔥🔥🔥 STARTING POSITION CLOSING LOOP 🔥🔥🔥');
            //console.log(`🔥🔥🔥 Will process ${tradesToCreate.length} trades and close ${positionIdsToClose.length} positions 🔥🔥🔥`);
            //console.log('[PositionManager] 🔍 [BATCH_CLOSE_LOOP] About to enter position processing loop...');
            
            // CRITICAL FIX: Fetch current prices from API before attempting to close positions
            //console.log('🔥🔥🔥 FETCHING CURRENT PRICES FROM API 🔥🔥🔥');
            const symbols = [...new Set(tradesToCreate.map(t => t.symbol))];
            //console.log(`🔥🔥🔥 Need prices for ${symbols.length} symbols:`, symbols);
            
            console.log('[position_manager_debug] 🔍 About to fetch prices for all positions...');
            console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - FETCHING PRICES');
            
            // Add timeout to price fetching to prevent hanging
            const priceFetchTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Price fetch timeout after 20 seconds')), 20000);
            });
            
            const priceFetchPromise = Promise.all(
                this.positions.map(async (p) => {
                    console.log(`[position_manager_debug] 🔍 Processing position for price fetch: ${p.symbol}`);
                    const symbolNoSlash = p.symbol.replace('/', '');
                    try {
                        // Find the corresponding trade data for this position
                        const tradeIndex = positionIdsToClose.findIndex(id => 
                            id === p.id || id === p.db_record_id || id === p.position_id
                        );
                        const tradeData = tradeIndex >= 0 ? tradesToCreate[tradeIndex] : null;
                        
                        // Try to get price from various sources
                        let price = this.scannerService.currentPrices?.[symbolNoSlash];
                        
                        if (!price && this.scannerService.priceManagerService) {
                            try {
                                price = await this.scannerService.priceManagerService.getCurrentPrice(p.symbol);
                            } catch (error) {
                                console.log(`[PositionManager] ⚠️ Could not fetch price via priceManagerService:`, error);
                            }
                        }
                        
                        // Use tradeData exit_price as fallback
                        if (!price && tradeData) {
                            price = tradeData.exit_price;
                        }
                        
                        return { symbol: p.symbol, symbolNoSlash, price };
                    } catch (error) {
                        console.log(`[PositionManager] ⚠️ Could not fetch price for ${p.symbol}:`, error);
                        return { symbol: p.symbol, symbolNoSlash, price: null };
                    }
                })
            );
            
            let allPositionsData;
            try {
                allPositionsData = await Promise.race([priceFetchPromise, priceFetchTimeout]);
                console.log('[position_manager_debug] 🔍 Price fetch completed successfully');
            } catch (timeoutError) {
                console.error('[position_manager_debug] ❌ Price fetch timeout:', timeoutError.message);
                this.addLog(`[MONITOR] ❌ Price fetch timeout: ${timeoutError.message}`, 'error');
                // Use fallback prices from trade data
                allPositionsData = tradesToCreate.map(t => ({
                    symbol: t.symbol,
                    symbolNoSlash: t.symbol.replace('/', ''),
                    price: t.exit_price
                }));
            }
            
            //console.log('🔥🔥🔥 PRICES FETCHED:', allPositionsData.filter(p => p.price).map(p => `${p.symbol}: ${p.price}`));
            
            // Build a price map for quick lookup
            const priceMap = {};
            for (const p of allPositionsData) {
                if (p.price) {
                    priceMap[p.symbolNoSlash] = p.price;
                }
            }
            
            //console.log('🔥🔥🔥 PRICE MAP:', Object.keys(priceMap));
            
            console.log('[position_manager_debug] 🔍 About to start main position processing loop...');
            console.log('[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - STARTING POSITION PROCESSING LOOP');
            
            // Process each position according to the schema
            for (let i = 0; i < positionIdsToClose.length; i++) {
                console.log(`[position_manager_debug] 🔍 Processing position ${i + 1}/${positionIdsToClose.length} in main loop`);
                const positionMarker = `[POSITION_${i + 1}]`; // Declare at the top of the loop
                try {
                const positionId = positionIdsToClose[i];
                const tradeData = tradesToCreate[i];
                
                    //console.log(`[POS-${i + 1}] 🔥🔥🔥 ======================================== 🔥🔥🔥`);
                    //console.log(`[POS-${i + 1}] 🔥🔥🔥 STARTING PROCESSING TRADE ${i + 1}/${tradesToCreate.length} 🔥🔥🔥`);
                    //console.log(`[POS-${i + 1}] [PositionManager] 🔍 [POSITION_LOOP] About to process individual position...`);
                    
                    if (!tradeData) {
                        console.log(`[POS-${i + 1}] 🔥🔥🔥 ❌ TRADEDATA MISSING FOR INDEX ${i} 🔥🔥🔥`);
                        errors.push(`Trade data missing for index ${i}`);
                        continue;
                    }
                    
                    //console.log(`[POS-${i + 1}] 🔥🔥🔥 PROCESSING TRADE ${i + 1}/${tradesToCreate.length}: ${tradeData.symbol || 'UNKNOWN'} - Position ID: ${positionId} 🔥🔥🔥`);
                    //console.log(`[POS-${i + 1}] [PositionManager] 🚀 Processing position ${positionId} with trade data:`, tradeData);
                    //console.log(`[POS-${i + 1}] [PositionManager] 🔍 [POSITION_LOOP] Trade data validated, proceeding with position processing...`);
                
                //console.log(`[position_manager_debug] 🔍 Looking for position with ID: ${positionId}`);
                
                // Try multiple ways to find the position
                let position = this.positions.find(p => p.id === positionId);
                //console.log(`[position_manager_debug] 🔍 Found by id: ${!!position}`);
                if (!position) {
                    // Try finding by db_record_id
                    position = this.positions.find(p => p.db_record_id === positionId);
                    //console.log(`[position_manager_debug] 🔍 Found by db_record_id: ${!!position}`);
                }
                if (!position) {
                    // Try finding by position_id
                    position = this.positions.find(p => p.position_id === positionId);
                    c//onsole.log(`[position_manager_debug] 🔍 Found by position_id: ${!!position}`);
                }
                
                if (position) {
                    //console.log(`[position_manager_debug] 🔍 ✅ FOUND POSITION: ${position.symbol} (${positionId})`);
                    //console.log(`🔥🔥🔥 ✅ FOUND POSITION: ${position.symbol} (${positionId}) 🔥🔥🔥`);
                } else {
                    console.log(`[position_manager_debug] 🔍 ❌ POSITION NOT FOUND: ${positionId}`);
                    console.log(`🔥🔥🔥 ❌ POSITION NOT FOUND: ${positionId} 🔥🔥🔥`);
                }
                // CRITICAL FIX: Also try matching by the database UUID if positionId is a UUID
                if (!position && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(positionId)) {
                    position = this.positions.find(p => p.id === positionId);
                }
                
                // ENHANCED FIX: Try all possible ID combinations
                if (!position) {
                    position = this.positions.find(p => 
                        p.id === positionId || 
                        p.db_record_id === positionId || 
                        p.position_id === positionId ||
                        (p.id && p.id.toString() === positionId) ||
                        (p.db_record_id && p.db_record_id.toString() === positionId) ||
                        (p.position_id && p.position_id.toString() === positionId)
                    );
                }
                
                if (!position) {
                    console.log(`[PositionManager] ⚠️ Position ${positionId} not found in memory, skipping`);
                    //console.log(`[PositionManager] 🔍 Available positions:`, this.positions.map(p => ({ id: p.id, db_record_id: p.db_record_id, position_id: p.position_id, symbol: p.symbol })));
                    continue;
                }
                
                // CRITICAL FIX: Skip positions that are already being processed or have been processed
                const positionTradeId = position.position_id || position.id || position.db_record_id;
                //console.log(`🔥🔥🔥 CHECKING DUPLICATE PREVENTION: positionTradeId=${positionTradeId}, processedTradeIds size=${this.processedTradeIds?.size || 0} 🔥🔥🔥`);
                if (this.processedTradeIds && this.processedTradeIds.has(positionTradeId)) {
                    console.log(`🔥🔥🔥 ❌ DUPLICATE BLOCKED: Position ${position.symbol} (${positionTradeId}) already processed, skipping 🔥🔥🔥`);
                    continue;
                }
                //console.log(`🔥🔥🔥 ✅ PASSED DUPLICATE CHECK - PROCEEDING: ${position.symbol} (${positionTradeId}) 🔥🔥🔥`);

                //console.log(`${positionMarker} [PositionManager] [debug_next] 🚀 ===== STARTING POSITION ${i + 1}/${positionIdsToClose.length} =====`);
                //console.log(`${positionMarker} [PositionManager] [debug_next] 🚀 Processing position: ${position.symbol} (ID: ${positionTradeId})`);

                // Execute Binance sell order first
                const symbolNoSlash = position.symbol.replace('/', '');
                
                // CRITICAL FIX: Use priceMap instead of this.scannerService.currentPrices
                const currentPrice = priceMap[symbolNoSlash] || tradeData.exit_price;
                
                //console.log(`🔥🔥🔥 PRICE CHECK: ${position.symbol} -> ${symbolNoSlash} -> ${currentPrice} 🔥🔥🔥`);
                //console.log(`🔥🔥🔥 PRICE MAP HAS:`, Object.keys(priceMap).slice(0, 10));
                //console.log(`🔥🔥🔥 PRICE MAP VALUES:`, Object.entries(priceMap).slice(0, 5).map(([k, v]) => `${k}=${v}`));
                //console.log(`🔥🔥🔥 Looking for symbolNoSlash="${symbolNoSlash}", found price="${priceMap[symbolNoSlash]}", tradeData.exit_price="${tradeData.exit_price}" 🔥🔥🔥`);
                
                if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
                    console.log(`🔥🔥🔥 ❌ NO VALID PRICE - SKIPPING POSITION: ${position.symbol} 🔥🔥🔥`);
                    console.log(`[PositionManager] ⚠️ No valid current price for ${position.symbol} (got: ${currentPrice}), skipping Binance order`);
                    errors.push(`No valid price for ${position.symbol}: ${currentPrice}`);
                    continue;
                }
                    
                //console.log(`${positionMarker} 🔥🔥🔥 ✅ PRICE FOUND - PROCEEDING WITH CLOSE: ${position.symbol} at ${currentPrice} 🔥🔥🔥`);
                    
                console.log(`${positionMarker} [PositionManager] 🚀 STEP 1: Executing Binance sell for ${position.symbol} at ${currentPrice}`);
                console.log(`${positionMarker} [PositionManager] 🚀 Position details:`, {
                    symbol: position.symbol,
                    quantity_crypto: position.quantity_crypto,
                    position_id: position.position_id,
                    status: position.status
                });
                
                try {
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 2: Getting trading mode and proxy URL...`);
                    const tradingMode = this.getTradingMode();
                    console.log(`${positionMarker} [PositionManager] ✅ STEP 2 COMPLETE: Trading mode: ${tradingMode}`);
                    const proxyUrl = this.scannerService.state?.settings?.local_proxy_url;
                    console.log(`${positionMarker} [PositionManager] ✅ STEP 2 COMPLETE: Proxy URL: ${proxyUrl || 'NOT SET'}`);
                    
                    if (!proxyUrl) {
                        console.error(`${positionMarker} [PositionManager] ❌ CRITICAL: Proxy URL not set!`);
                        errors.push(`Proxy URL not configured for ${position.symbol}`);
                        continue;
                    }
                    
                    // CRITICAL FIX: Refresh balance BEFORE attempting to sell to ensure we have latest balance
                    // This is especially important when closing multiple positions of the same symbol sequentially
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 3: Refreshing balance BEFORE sell attempt for ${position.symbol}...`);
                    try {
                        await this.refreshBalanceFromBinance();
                        console.log(`${positionMarker} [PositionManager] ✅ STEP 3 COMPLETE: Balance refreshed before sell of ${position.symbol}`);
                    } catch (refreshError) {
                        console.warn(`${positionMarker} [PositionManager] ⚠️ STEP 3 WARNING: Failed to refresh balance before sell (non-critical): ${refreshError.message}`);
                        // Non-critical - continue with sell attempt using cached balance
                    }
                    
                    console.log(`[position_manager_debug] 🔍 About to call _executeBinanceMarketSellOrder for position ${i + 1}/${positionIdsToClose.length}`);
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 4: About to call _executeBinanceMarketSellOrder with:`, {
                        symbol: position.symbol,
                        quantity: position.quantity_crypto,
                        currentPrice: currentPrice,
                        tradingMode: tradingMode,
                        proxyUrl: proxyUrl
                    });
                    console.log(`${positionMarker} [PositionManager] 🔍 [BINANCE_SELL_CALL] About to call _executeBinanceMarketSellOrder...`);
                    console.log('[PositionManager] 🔍 [EXECUTION_TRACE] step_6: About to call _executeBinanceMarketSellOrder');
                    
                    // CRITICAL: Add timeout to prevent hanging
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 5: Creating Binance sell promise for ${position.symbol}...`);
                    console.log(`${positionMarker} [PositionManager] 🔍 [BINANCE_SELL_CALL] Calling _executeBinanceMarketSellOrder now...`);
                    console.log(`[position_manager_debug] 🔍 THIS IS A CRITICAL CHECKPOINT - CALLING _EXECUTE_BINANCE_MARKET_SELL_ORDER`);
                    
                    const binanceSellPromise = this._executeBinanceMarketSellOrder(position, { 
                        currentPrice,
                        tradingMode, 
                        proxyUrl,
                        exitReason: tradeData.exit_reason || 'timeout'
                    });
                    
                    console.log(`${positionMarker} [PositionManager] ✅ STEP 5 COMPLETE: Binance sell promise created, setting up timeout...`);
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Binance sell timeout after 30s')), 30000)
                    );
                    
                    let binanceResult;
                    try {
                    console.log(`[position_manager_debug] [debug_next] 🔍 About to await Promise.race for position ${i + 1}/${positionIdsToClose.length}`);
                    console.log(`${positionMarker} [PositionManager] [debug_next] 🚀 STEP 6: Awaiting Binance sell or timeout for ${position.symbol}...`);
                    console.log(`${positionMarker} [PositionManager] [debug_next] 🔍 [PROMISE_RACE] Starting Promise.race with 30s timeout for ${position.symbol}`);
                    
                    const raceStartTime = Date.now();
                    binanceResult = await Promise.race([binanceSellPromise, timeoutPromise]);
                    const raceEndTime = Date.now();
                    const raceDuration = raceEndTime - raceStartTime;
                    
                    console.log(`[position_manager_debug] [debug_next] 🔍 Promise.race completed successfully for position ${i + 1}/${positionIdsToClose.length} in ${raceDuration}ms`);
                    console.log(`${positionMarker} [PositionManager] [debug_next] ✅ STEP 6 COMPLETE: Binance sell completed for ${position.symbol} (not timeout) in ${raceDuration}ms`);
                    console.log('[PositionManager] 🔍 [EXECUTION_TRACE] step_7: _executeBinanceMarketSellOrder completed');
                    console.log(`${positionMarker} [PositionManager] [debug_next] 🔍 [PROMISE_RACE] Result type: ${typeof binanceResult}, success: ${binanceResult?.success}`);
                    } catch (timeoutError) {
                        console.log(`[position_manager_debug] [debug_next] 🔍 Promise.race failed for position ${i + 1}/${positionIdsToClose.length}: ${timeoutError.message}`);
                        console.log(`${positionMarker} [PositionManager] [debug_next] ⚠️ STEP 6 ERROR: Binance sell timeout/failed for ${position.symbol}:`, timeoutError.message);
                        console.log(`${positionMarker} [PositionManager] [debug_next] ⚠️ Timeout error stack:`, timeoutError.stack);
                        errors.push(`Binance sell timeout/failed for ${position.symbol}: ${timeoutError.message}`);
                        continue;
                    }
                    
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 7: Binance result for ${position.symbol}:`, binanceResult);
                    console.log(`${positionMarker} [PositionManager] 🚀 Binance result type check:`, {
                        hasSkipped: 'skipped' in binanceResult,
                        skipped: binanceResult?.skipped,
                        hasSuccess: 'success' in binanceResult,
                        success: binanceResult?.success,
                        hasDust: 'dust' in binanceResult,
                        dust: binanceResult?.dust,
                        isVirtualClose: binanceResult?.isVirtualClose,
                        reason: binanceResult?.reason,
                        error: binanceResult?.error
                    });
                    
                    if (binanceResult.skipped) {
                        console.log(`${positionMarker} [PositionManager] ⚠️ STEP 8: Position ${position.symbol} skipped due to dust threshold`);
                        console.log(`${positionMarker} [PositionManager] ⚠️ Skipping dust position and continuing to next position`);
                        continue;
                    }

                    if (!binanceResult.success) {
                        console.log(`${positionMarker} [PositionManager] ❌ STEP 8 ERROR: Binance sell failed for ${position.symbol}: ${binanceResult.error}`);
                        errors.push(`Binance sell failed for ${position.symbol}: ${binanceResult.error}`);
                        continue;
                    }

                    if (binanceResult.isVirtualClose) {
                        console.log(`${positionMarker} [PositionManager] ✅ STEP 8: Virtual closure for ${position.symbol} (position already closed on Binance)`);
                        console.log(`${positionMarker} [PositionManager] ✅ Virtual closure reason: ${binanceResult.reason}`);
                    } else {
                        console.log(`${positionMarker} [PositionManager] ✅ STEP 8: Binance sell successful for ${position.symbol}`);
                    }
                    
                    // CRITICAL FIX: Refresh balance after each successful sell to prevent "insufficient balance" errors
                    // when closing multiple positions of the same symbol sequentially
                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 9: Refreshing balance after successful sell of ${position.symbol}...`);
                    try {
                        await this.refreshBalanceFromBinance();
                        console.log(`${positionMarker} [PositionManager] ✅ STEP 9 COMPLETE: Balance refreshed after sell of ${position.symbol}`);
                    } catch (refreshError) {
                        console.warn(`${positionMarker} [PositionManager] ⚠️ STEP 9 WARNING: Failed to refresh balance after sell (non-critical): ${refreshError.message}`);
                        // Non-critical - continue processing
                    }

                    // Now process the closed trade according to schema
                    const exitDetails = {
                        exit_price: tradeData.exit_price,
                        exit_value_usdt: tradeData.exit_value_usdt,
                        pnl_usdt: tradeData.pnl_usdt,
                        pnl_percentage: tradeData.pnl_percentage,
                        exit_timestamp: tradeData.exit_timestamp,
                        duration_seconds: tradeData.duration_seconds,
                        exit_reason: tradeData.exit_reason
                    };

                    console.log(`${positionMarker} [PositionManager] 🚀 STEP 10: Calling processClosedTrade for ${position.symbol}...`);
                    const processResult = await this.processClosedTrade(position, exitDetails);
                    
                    if (processResult.success) {
                        console.log(`${positionMarker} [PositionManager] ✅ STEP 10 COMPLETE: Successfully processed closed trade for ${position.symbol}`);
                        processedTrades.push(processResult.trade);
                        // Track the position ID for removal from memory
                        successfullyClosedPositionIds.push(position.id || position.db_record_id || position.position_id);
                        console.log(`${positionMarker} [PositionManager] 📝 Tracked closed position ID: ${position.id || position.db_record_id || position.position_id}`);
                    } else {
                        console.log(`${positionMarker} [PositionManager] ❌ STEP 10 ERROR: Failed to process closed trade for ${position.symbol}`);
                        errors.push(`Failed to process closed trade for ${position.symbol}`);
                    }
                    
                    console.log(`${positionMarker} 🔥🔥🔥 ✅ COMPLETED PROCESSING TRADE ${i + 1}/${tradesToCreate.length} FOR ${position.symbol} 🔥🔥🔥`);
                    console.log(`${positionMarker} 🔥🔥🔥 ======================================== 🔥🔥🔥`);

                } catch (error) {
                    console.log(`${positionMarker} [PositionManager] ❌ CRITICAL ERROR processing position ${position.symbol}:`, error);
                    console.log(`${positionMarker} [PositionManager] ❌ Error stack:`, error.stack);
                    errors.push(`Error processing position ${position.symbol}: ${error.message}`);
                }
                } catch (outerError) {
                    console.log(`🔥🔥🔥 ❌ OUTER ERROR IN LOOP ITERATION ${i + 1}:`, outerError);
                    console.log(`🔥🔥🔥 ❌ OUTER ERROR STACK:`, outerError.stack);
                    errors.push(`Outer error in loop iteration ${i + 1}: ${outerError.message}`);
                }
            }
            
            // Update wallet state
            if (this._getCurrentWalletState()) {
                const remainingIds = this.positions.map(p => p.id).filter(id => id);
                this._getCurrentWalletState().live_position_ids = remainingIds;
            }

               // BETTER APPROACH: Always fetch fresh balance from Binance after position close
               // This ensures we have the accurate, up-to-date balance from the source of truth
               console.log('[PositionManager] 🔄 Fetching fresh balance from Binance after position close...');
               
               // DEBUG: Log current wallet state before refresh
               const currentWalletState = this._getCurrentWalletState();
               if (currentWalletState) {
                   console.log('[debug-increase] 🔍 BEFORE Binance refresh - Current wallet state:', {
                       available_balance: currentWalletState.available_balance,
                       balance_in_trades: currentWalletState.balance_in_trades,
                       total_equity: currentWalletState.total_equity,
                       last_binance_sync: currentWalletState.last_binance_sync,
                       positions_count: this.positions.length,
                       closed_positions_value: processedTrades.reduce((sum, trade) => sum + (trade.exit_value_usdt || 0), 0)
                   });
               }
               
            try {
                   // Step 1: Fetch fresh balance from Binance (source of truth)
                   console.log('[debug-increase] 🔄 Step 1: Calling refreshBalanceFromBinance()...');
                   await this.refreshBalanceFromBinance();
                
                   // Step 2: Recalculate wallet summary with fresh Binance data
                   console.log('[debug-increase] 🔄 Step 2: Calling updateWalletSummary()...');
                   if (this.scannerService.walletManagerService) {
                await this.scannerService.walletManagerService.updateWalletSummary(
                    this._getCurrentWalletState(),
                    this.scannerService.currentPrices
                );
                   }
                   
                   // DEBUG: Log wallet state AFTER refresh
                   const updatedWalletState = this._getCurrentWalletState();
                   if (updatedWalletState) {
                       console.log('[debug-increase] 🔍 AFTER Binance refresh - Updated wallet state:', {
                           available_balance: updatedWalletState.available_balance,
                           balance_in_trades: updatedWalletState.balance_in_trades,
                           total_equity: updatedWalletState.total_equity,
                           last_binance_sync: updatedWalletState.last_binance_sync,
                           positions_count: this.positions.length
                       });
                       
                       // Calculate the difference
                       const beforeBalance = parseFloat(currentWalletState?.available_balance || 0);
                       const afterBalance = parseFloat(updatedWalletState.available_balance || 0);
                       const balanceChange = afterBalance - beforeBalance;
                       
                       console.log('[debug-increase] 📊 BALANCE CHANGE ANALYSIS:', {
                           before_balance: beforeBalance,
                           after_balance: afterBalance,
                           balance_change: balanceChange,
                           change_direction: balanceChange > 0 ? 'INCREASE' : balanceChange < 0 ? 'DECREASE' : 'NO CHANGE',
                           closed_positions_value: processedTrades.reduce((sum, trade) => sum + (trade.exit_value_usdt || 0), 0),
                           expected_change: processedTrades.reduce((sum, trade) => sum + (trade.exit_value_usdt || 0), 0),
                           unexpected_increase: balanceChange > processedTrades.reduce((sum, trade) => sum + (trade.exit_value_usdt || 0), 0)
                       });
                   }
                
                   // Step 3: Persist wallet changes
                   await this.persistWalletChangesAndWait();
                
                   console.log('[PositionManager] ✅ Wallet refreshed from Binance successfully');
                   
                   // CRITICAL: Force UI update after wallet refresh
                   if (this.scannerService.notifyWalletSubscribers) {
                       this.scannerService.notifyWalletSubscribers();
                       console.log('[PositionManager] 🔄 Notified wallet subscribers of balance update');
                   }
            } catch (refreshError) {
                   console.error('[PositionManager] ❌ Error refreshing wallet from Binance:', refreshError);
                   this.addLog(`[BATCH_CLOSE] ⚠️ Failed to refresh wallet from Binance: ${refreshError.message}`, 'warning');
               }

               // Notify subscribers
               this.scannerService.notifyWalletSubscribers();
            
            // CRITICAL FIX: Remove closed positions from the in-memory positions array
            console.log(`[PositionManager] 🔄 Removing ${successfullyClosedPositionIds.length} closed positions from memory...`);
            console.log(`[PositionManager] 📝 Closed position IDs to remove:`, successfullyClosedPositionIds);
            const initialPositionCount = this.positions.length;
            
            // Remove closed positions from the positions array
            this.positions = this.positions.filter(position => {
                const positionId = position.id || position.db_record_id || position.position_id;
                const shouldKeep = !successfullyClosedPositionIds.includes(positionId);
                if (!shouldKeep) {
                    console.log(`[PositionManager] 🗑️ Removing closed position from memory: ${position.symbol} (${positionId})`);
                }
                return shouldKeep;
            });
            
            console.log(`🔥🔥🔥 BATCH CLOSE COMPLETED: ${processedTrades.length} positions closed 🔥🔥🔥`);
            console.log(`🔥🔥🔥 POSITIONS IN MEMORY: ${initialPositionCount} → ${this.positions.length} (removed ${initialPositionCount - this.positions.length}) 🔥🔥🔥`);
            console.log(`🔥🔥🔥 FINAL RESULT: success=true, closed=${processedTrades.length} 🔥🔥🔥`);
            
            return { success: true, closed: processedTrades.length, trades: processedTrades };
            
        } catch (error) {
            console.log('🔥🔥🔥 BATCH CLOSE ERROR 🔥🔥🔥');
            console.log('[PositionManager] ❌ Error in batch close:', error);
            console.log(`🔥🔥🔥 ERROR RESULT: success=false, closed=0, error=${error.message} 🔥🔥🔥`);
            return { success: false, error: error.message, closed: 0 };
        }
    }

    /**
     * Update exit time for all open positions
     * @param {number} exitTimeHours - Exit time in hours (e.g., 1/60 for 1 minute)
     * @returns {Promise<{success: boolean, updated: number, error?: string}>}
     */
    async updateAllPositionsExitTime(exitTimeHours) {
        console.log(`[PositionManager] ⏰ Updating exit time for all positions to ${exitTimeHours} hours`);
        
        try {
            const openPositions = this.positions.filter(pos => pos.status === 'open' || pos.status === 'trailing');
            
            if (openPositions.length === 0) {
                console.log('[PositionManager] ⏰ No open positions found to update');
                return { success: true, updated: 0 };
            }
            
            console.log(`[PositionManager] ⏰ Found ${openPositions.length} open positions to update`);
            
            let updatedCount = 0;
            const errors = [];
            
            for (const position of openPositions) {
                try {
                    // Update the position in the database
                    const updateData = {
                        time_exit_hours: exitTimeHours,
                        last_updated_timestamp: new Date().toISOString()
                    };
                    
                    await queueEntityCall('LivePosition', 'update', position.id, updateData);
                    
                    // Update the in-memory position
                    position.time_exit_hours = exitTimeHours;
                    position.last_updated_timestamp = updateData.last_updated_timestamp;
                    
                    updatedCount++;
                    console.log(`[PositionManager] ⏰ Updated position ${position.position_id} exit time to ${exitTimeHours} hours`);
                    
                } catch (error) {
                    console.error(`[PositionManager] ❌ Failed to update position ${position.position_id}:`, error);
                    errors.push(`Position ${position.position_id}: ${error.message}`);
                }
            }
            
            if (errors.length > 0) {
                console.warn(`[PositionManager] ⚠️ Some positions failed to update:`, errors);
            }
            
            console.log(`[PositionManager] ✅ Successfully updated ${updatedCount}/${openPositions.length} positions`);
            
            return { 
                success: true, 
                updated: updatedCount,
                errors: errors.length > 0 ? errors : undefined
            };
            
        } catch (error) {
            console.error('[PositionManager] ❌ Error updating positions exit time:', error);
            return { 
                success: false, 
                updated: 0, 
                error: error.message 
            };
        }
    }

    /**
     * Handles manual closing of a single position.
     * @param {object} position - The position object to close (full object, not just ID).
     * @param {number|null} currentPrice - The current market price. If null, it will be fetched.
     * @param {string} exitReason - Reason for exit (defaults to 'manual_close').
     * @returns {Promise<{ success: boolean, trade?: object, pnl?: number, pnlPercentage?: number, error?: string, isInsufficientBalance?: boolean }>} An object indicating success or failure with an message.
     */
    async manualClosePosition(position, currentPrice = null, exitReason = 'manual_close') {
        console.log('🔥🔥🔥 NEW MANUAL CLOSE FUNCTION - VERSION 2.0 - BUILD', Date.now(), '🔥🔥🔥');
        console.log('[PositionManager] 🔄 NEW MANUAL CLOSE FUNCTION CALLED - VERSION 2.0');
        console.log('[PositionManager] 🔄 This is the updated version with processClosedTrade()');
        console.log('[PositionManager] 🔄 Input position:', position);
        console.log('[PositionManager] 🔄 Current price:', currentPrice);
        console.log('[PositionManager] 🔄 Exit reason:', exitReason);
        console.log('[PositionManager] 🔄 Available positions:', this.positions.map(p => ({ id: p.db_record_id, position_id: p.position_id, symbol: p.symbol })));
        
        const activePosition = this.positions.find(p => p.db_record_id === position.id);
        console.log('[PositionManager] 🔄 Found active position:', activePosition);
        console.log('[PositionManager] 🔄 Position ID being searched:', position.id);

        if (!activePosition) {
            const availableIds = this.positions.map(p => `${p.symbol} (${p.position_id} / DB_ID: ${p.db_record_id})`).join(', ');
            const errorMsg = `Position ${position.symbol} (ID: ${position.id}) not found in PositionManager. Available positions: ${availableIds || 'none'}`;
            
            this.scannerService.addLog(`[MANUAL_CLOSE] ❌ ${errorMsg}`, 'error');
            
            // Check if position was already closed (database cleanup successful)
            if (this.positions.length === 0) {
                console.log('[PositionManager] 🔄 PositionManager has no positions - position was likely already closed');
                this.scannerService.addLog(`[MANUAL_CLOSE] ✅ Position ${position.symbol} was already closed and removed from database`, 'success');
                
                // Return success since the position was already closed
      return {
                    success: true,
                    message: 'Position was already closed and removed from database',
                    alreadyClosed: true
                };
            }
            
            throw new Error(errorMsg);
        }

        // Use the new batch close logic for manual closes
        console.log('[PositionManager] 🔄 Using batch close logic for manual close');
        
        // Get current price if not provided
        if (!currentPrice) {
            const symbolNoSlash = activePosition.symbol.replace('/', '');
            currentPrice = this.scannerService.currentPrices[symbolNoSlash];
            
            if (!currentPrice) {
                const errorMsg = `Cannot close position ${activePosition.symbol}: No valid current price available. Please try again in a moment.`;
                this.scannerService.addLog(`[MANUAL_CLOSE] ❌ ${errorMsg}`, 'error');
                throw new Error(errorMsg);
            }
        }

        // Execute Binance sell order first
        console.log(`[PositionManager] 🚀 Executing Binance sell for ${activePosition.symbol} at ${currentPrice}`);
        
        try {
            const tradingMode = this.getTradingMode();
            const proxyUrl = this.scannerService.state.settings?.local_proxy_url;
            
            const binanceResult = await this._executeBinanceMarketSellOrder(activePosition, { 
                currentPrice,
                tradingMode, 
                proxyUrl,
                exitReason: exitReason || 'timeout'
            });
            
            console.log(`[PositionManager] 🚀 Binance result for ${activePosition.symbol}:`, binanceResult);
            
            if (binanceResult.skipped) {
                console.log(`[PositionManager] ⚠️ Position ${activePosition.symbol} skipped due to dust threshold`);
                return {
                    success: false,
                    error: 'Position skipped due to dust threshold',
                    isInsufficientBalance: false
                };
            }

            if (!binanceResult.success) {
                console.log(`[PositionManager] ❌ Binance sell failed for ${activePosition.symbol}: ${binanceResult.error}`);
                return {
                    success: false,
                    error: `Binance sell failed: ${binanceResult.error}`,
                    isInsufficientBalance: false
                };
            }

            console.log(`[PositionManager] ✅ Binance sell successful for ${activePosition.symbol}`);

            // Now process the closed trade according to schema
            const trade = this._createTradeFromPosition(activePosition, currentPrice, exitReason);
            const exitDetails = {
                exit_price: trade.exit_price,
                exit_value_usdt: trade.exit_value_usdt,
                pnl_usdt: trade.pnl_usdt,
                pnl_percentage: trade.pnl_percentage,
                exit_timestamp: trade.exit_timestamp,
                duration_seconds: trade.duration_seconds,
                exit_reason: trade.exit_reason
            };

            console.log(`[PositionManager] 🚀 Calling processClosedTrade for ${activePosition.symbol}...`);
            const processResult = await this.processClosedTrade(activePosition, exitDetails);
            
            if (processResult.success) {
                console.log(`[PositionManager] ✅ Successfully processed closed trade for ${activePosition.symbol}`);
                
                // CRITICAL: Trigger immediate wallet refresh after manual close
                try {
                    console.log('[PositionManager] 🔄 Refreshing wallet state after manual close...');
                    
                    // Add a small delay to ensure database operations are complete
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Step 1: Sync with Binance to get latest balances
                    await this.scannerService.walletManagerService.initializeLiveWallet();
                    
                    // Step 2: Update wallet summary via CentralWalletStateManager
                    await this.scannerService.walletManagerService.updateWalletSummary();
                    
                    // Step 3: Persist to localStorage for immediate UI access
                    await this.scannerService._persistLatestWalletSummary();
                    
                    // Step 4: Notify UI components
                    this.scannerService.notifyWalletSubscribers();
                    
                    console.log('[PositionManager] ✅ Wallet state refreshed successfully after manual close');
                } catch (refreshError) {
                    console.error('[PositionManager] ❌ Failed to refresh wallet after manual close:', refreshError);
                }
                
                return {
                    success: true,
                    trade: processResult.trade,
                    pnl: trade.pnl_usdt,
                    pnlPercentage: trade.pnl_percentage
                };
            } else {
                console.log(`[PositionManager] ❌ Failed to process closed trade for ${activePosition.symbol}`);
                return {
                    success: false,
                    error: 'Failed to process closed trade',
                    isInsufficientBalance: false
                };
            }

        } catch (error) {
            console.log(`[PositionManager] ❌ Error processing manual close for ${activePosition.symbol}:`, error);
            return {
                success: false,
                error: `Error processing manual close: ${error.message}`,
                isInsufficientBalance: false
            };
        }
    }

    /**
     * Format quantity for Binance API with proper precision
     * @param {number} quantity - The quantity to format
     * @param {string} symbol - The symbol (e.g., 'BTCUSDT')
     * @returns {string} Formatted quantity string
     */
    _formatQuantityForBinance(quantity, symbol) {
        try {
            // Get exchange info for the symbol
            const symbolInfo = this.getExchangeInfo ? this.getExchangeInfo(symbol) : null;
            if (!symbolInfo) {
                console.warn(`[PositionManager] No exchange info for ${symbol}, using default precision`);
                return quantity.toFixed(8);
            }

            // Get step size and precision from exchange info using existing helper
            const { stepSize } = getSymbolFiltersFromInfo(symbolInfo);
            
            if (stepSize && stepSize > 0) {
                // Use the existing helper function to format with proper step size
                const formattedQty = roundDownToStepSize(quantity, stepSize);
                console.log(`[PositionManager] Formatted quantity: ${quantity} → ${formattedQty} (stepSize: ${stepSize})`);
                return formattedQty.toString();
            } else {
                // Fallback to 8 decimal places
                console.warn(`[PositionManager] Missing step size for ${symbol}, using default`);
                return quantity.toFixed(8);
            }
        } catch (error) {
            console.error(`[PositionManager] Error formatting quantity for ${symbol}:`, error);
            return quantity.toFixed(8);
        }
    }

    /**
     * Public method to trigger exit parameter analysis
     * This can be called from the UI or other services
     */
    async triggerExitParameterAnalysis() {
        console.log('[PositionManager] 🔍 Manual trigger: Analyzing exit parameters for all positions...');
        await this.analyzeExitParametersForAllPositions();
    }

    /**
     * Analyze and log exit parameters for all existing positions
     * This function provides detailed logging of how exit parameters were calculated
     */
    async analyzeExitParametersForAllPositions() {
        console.log('\n' + '='.repeat(80));
        console.log('🔍 EXIT PARAMETER ANALYSIS - ALL POSITIONS');
        console.log('='.repeat(80));

        if (!this.positions || this.positions.length === 0) {
            console.log('📊 No positions found to analyze');
            return;
        }

        console.log(`📊 Found ${this.positions.length} positions to analyze:`);
        
        for (let i = 0; i < this.positions.length; i++) {
            const position = this.positions[i];
            console.log(`\n${i + 1}. Position ID: ${position.id || position.position_id}`);
            await this.analyzeSinglePositionExitParameters(position);
        }

        console.log('\n' + '='.repeat(80));
        console.log('✅ EXIT PARAMETER ANALYSIS COMPLETE');
        console.log('='.repeat(80));
    }

    /**
     * Analyze and log exit parameters for a single position
     * @param {Object} position - The position to analyze
     */
    async analyzeSinglePositionExitParameters(position) {
        console.log('\n' + '-'.repeat(60));
        console.log(`🔍 ANALYZING POSITION: ${position.symbol}`);
        console.log(`📋 Position ID: ${position.id || position.position_id}`);
        console.log(`📋 Strategy: ${position.strategy_name || 'Unknown'}`);
        console.log(`📋 Direction: ${position.direction || 'Unknown'}`);
        console.log(`📋 Entry Price: $${position.entry_price || 'N/A'}`);
        console.log(`📋 Entry Time: ${position.entry_timestamp || 'N/A'}`);
        console.log(`📋 Status: ${position.status || 'Unknown'}`);
        console.log('-'.repeat(60));

        // Get current price
        const symbolNoSlash = position.symbol.replace('/', '');
        const currentPrice = this.scannerService?.currentPrices?.[symbolNoSlash];
        
        if (!currentPrice) {
            console.log('❌ Current price not available for analysis');
            return;
        }

        console.log(`💰 Current Price: $${currentPrice.toFixed(6)}`);
        
        // Calculate PnL
        const pnl = position.direction === 'long' 
            ? (currentPrice - position.entry_price) * position.quantity_crypto
            : (position.entry_price - currentPrice) * position.quantity_crypto;
        const pnlPercentage = (pnl / (position.entry_price * position.quantity_crypto)) * 100;
        
        console.log(`📈 Current PnL: $${pnl.toFixed(2)} (${pnlPercentage.toFixed(2)}%)`);

        // VOLATILITY ANALYSIS - Enhanced with multiple volatility metrics
        console.log('\n📊 VOLATILITY ANALYSIS:');
        try {
            // Get ATR from scanner service indicators (now stored per symbol)
            const symbolIndicators = this.scannerService.state.indicators?.[symbolNoSlash];
            const atrData = symbolIndicators?.atr;
            
            // Enhanced debug logging for ATR data structure
            if (!this._loggedAtrDebug) {
                console.log(`🔍 ATR Debug for ${symbolNoSlash}:`, {
                    atrData: atrData,
                    atrDataType: typeof atrData,
                    atrDataLength: Array.isArray(atrData) ? atrData.length : 'not array',
                    symbolIndicators: symbolIndicators,
                    symbolIndicatorsKeys: symbolIndicators ? Object.keys(symbolIndicators) : 'no indicators for symbol',
                    allIndicators: Object.keys(this.scannerService.state.indicators || {}),
                    scannerState: this.scannerService.state,
                    indicatorsKeys: Object.keys(this.scannerService.state.indicators || {}),
                    directAtrAccess: symbolIndicators?.atr,
                    directAtrType: typeof symbolIndicators?.atr,
                    lastAtrValue: Array.isArray(atrData) && atrData.length > 0 ? atrData[atrData.length - 1] : 'N/A'
                });
                
                // Additional detailed logging
                console.log(`🔍 Scanner Service State Structure:`, {
                    hasState: !!this.scannerService.state,
                    hasIndicators: !!this.scannerService.state?.indicators,
                    indicatorsType: typeof this.scannerService.state?.indicators,
                    indicatorsKeys: Object.keys(this.scannerService.state?.indicators || {}),
                    symbolExists: !!this.scannerService.state?.indicators?.[symbolNoSlash],
                    symbolIndicators: this.scannerService.state?.indicators?.[symbolNoSlash],
                    symbolIndicatorsType: typeof this.scannerService.state?.indicators?.[symbolNoSlash],
                    symbolIndicatorsKeys: Object.keys(this.scannerService.state?.indicators?.[symbolNoSlash] || {}),
                    atrExists: !!this.scannerService.state?.indicators?.[symbolNoSlash]?.atr,
                    atrValue: this.scannerService.state?.indicators?.[symbolNoSlash]?.atr,
                    atrType: typeof this.scannerService.state?.indicators?.[symbolNoSlash]?.atr
                });
                
                this._loggedAtrDebug = true;
            }
            
            // Handle different ATR data structures
            let currentATR = null;
            if (Array.isArray(atrData) && atrData.length > 0) {
                currentATR = atrData[atrData.length - 1];
            } else if (typeof atrData === 'number') {
                currentATR = atrData;
            } else if (atrData && typeof atrData === 'object' && atrData.value) {
                currentATR = atrData.value;
            }
            
            // No fallback - ATR must be available from scanner service
            if (!currentATR) {
                console.error(`❌ ATR data not available for ${symbolNoSlash} - No fallback will be used`);
                console.error(`❌ Scanner service state:`, {
                    hasState: !!this.scannerService?.state,
                    hasIndicators: !!this.scannerService?.state?.indicators,
                    indicatorsKeys: Object.keys(this.scannerService?.state?.indicators || {}),
                    atrExists: !!this.scannerService?.state?.indicators?.atr,
                    atrValue: this.scannerService?.state?.indicators?.atr,
                    atrLength: Array.isArray(this.scannerService?.state?.indicators?.atr) ? this.scannerService.state.indicators.atr.length : 'not array',
                    lastAtrValue: Array.isArray(this.scannerService?.state?.indicators?.atr) && this.scannerService.state.indicators.atr.length > 0 ? this.scannerService.state.indicators.atr[this.scannerService.state.indicators.atr.length - 1] : 'N/A'
                });
            }
            
            if (currentATR && currentATR > 0) {
                const atrPercent = (currentATR / currentPrice) * 100;
                console.log(`   📈 Current ATR: $${currentATR.toFixed(2)} (${atrPercent.toFixed(2)}% of price)`);
                
                // Volatility classification
                let volatilityLevel = 'LOW';
                if (atrPercent > 3) volatilityLevel = 'HIGH';
                else if (atrPercent > 1.5) volatilityLevel = 'MEDIUM';
                
                console.log(`   🎯 Volatility Level: ${volatilityLevel} (${atrPercent.toFixed(2)}%)`);
                
                // Market volatility context
                const marketVolatility = this.scannerService.state.marketVolatility;
                if (marketVolatility) {
                    console.log(`   🌐 Market Volatility: ADX=${marketVolatility.adx?.toFixed(1) || 'N/A'}, BBW=${marketVolatility.bbw?.toFixed(3) || 'N/A'}`);
                }
            } else {
                console.error(`   ❌ ATR data not available for volatility analysis - ATR: ${currentATR}, Type: ${typeof currentATR}`);
            }
        } catch (error) {
            console.error(`   ⚠️ Error analyzing volatility: ${error.message}`);
        }

        // MARKET REGIME ANALYSIS
        console.log('\n🌐 MARKET REGIME ANALYSIS:');
        try {
            const marketRegime = this.scannerService.state.marketRegime;
            if (marketRegime) {
                const confidencePercent = (marketRegime.confidence || 0) * 100;
                console.log(`   📊 Current Regime: ${marketRegime.regime?.toUpperCase() || 'UNKNOWN'}`);
                console.log(`   🎯 Regime Confidence: ${confidencePercent.toFixed(1)}%`);
                console.log(`   ✅ Regime Confirmed: ${marketRegime.isConfirmed ? 'YES' : 'NO'}`);
                
                // Regime impact on exit parameters
                const regimeFavorable = (position.direction === 'long' && marketRegime.regime === 'uptrend') || 
                                      (position.direction === 'short' && marketRegime.regime === 'downtrend');
                console.log(`   🎯 Regime Favorable: ${regimeFavorable ? 'YES' : 'NO'}`);
            } else {
                console.log('   ❌ Market regime data not available');
            }
        } catch (error) {
            console.log(`   ⚠️ Error analyzing market regime: ${error.message}`);
        }

        // 1. STOP LOSS ANALYSIS
        console.log('\n🛡️  STOP LOSS ANALYSIS:');
        if (position.stop_loss_price) {
            const slDistance = position.direction === 'long' 
                ? position.entry_price - position.stop_loss_price
                : position.stop_loss_price - position.entry_price;
            const slDistancePercent = (slDistance / position.entry_price) * 100;
            const slDistanceATR = slDistance; // Assuming ATR-based calculation
            
            console.log(`   🎯 Stop Loss Price: $${position.stop_loss_price.toFixed(6)}`);
            console.log(`   📏 Distance from Entry: $${slDistance.toFixed(2)} (${slDistancePercent.toFixed(2)}%)`);
            
            // ATR-based analysis (ATR is stored directly in indicators object, not by symbol)
            const indicators = this.scannerService.state.indicators;
            const atrData = indicators?.atr;
            
            // Handle different ATR data structures
            let currentATR = null;
            if (Array.isArray(atrData) && atrData.length > 0) {
                currentATR = atrData[atrData.length - 1];
            } else if (typeof atrData === 'number') {
                currentATR = atrData;
            } else if (atrData && typeof atrData === 'object' && atrData.value) {
                currentATR = atrData.value;
            }
            
            if (currentATR && currentATR > 0) {
                const atrMultiplier = slDistance / currentATR;
                console.log(`   📊 ATR Multiplier: ${atrMultiplier.toFixed(2)}x`);
                console.log(`   📊 ATR Distance: $${currentATR.toFixed(2)}`);
                
                // Volatility-adjusted risk assessment
                if (atrMultiplier < 1.0) {
                    console.log(`   ⚠️  WARNING: Stop loss is tighter than 1x ATR - high risk of false breakouts`);
                } else if (atrMultiplier > 3.0) {
                    console.log(`   ℹ️  INFO: Stop loss is wider than 3x ATR - may be too conservative`);
                }
            } else {
                console.error(`   ❌ ATR data not available for stop loss analysis - ATR: ${currentATR}, Type: ${typeof currentATR}`);
                console.error(`   ❌ Scanner service indicators for ${symbolNoSlash}:`, {
                    indicators: indicators,
                    atrData: atrData,
                    atrDataType: typeof atrData,
                    scannerState: this.scannerService.state,
                    indicatorsKeys: Object.keys(this.scannerService.state?.indicators || {}),
                    atrLength: Array.isArray(atrData) ? atrData.length : 'not array',
                    lastAtrValue: Array.isArray(atrData) && atrData.length > 0 ? atrData[atrData.length - 1] : 'N/A'
                });
            }
            
            // Check if stop loss is hit
            const slHit = position.direction === 'long' 
                ? currentPrice <= position.stop_loss_price
                : currentPrice >= position.stop_loss_price;
            console.log(`   ⚠️  Stop Loss Hit: ${slHit ? 'YES' : 'NO'}`);
            
            if (slHit) {
                console.log(`   🚨 STOP LOSS TRIGGERED! Current price ${currentPrice.toFixed(6)} ${position.direction === 'long' ? '<=' : '>='} SL price ${position.stop_loss_price.toFixed(6)}`);
            }
        } else {
            console.log('   ❌ No stop loss price set');
        }

        // 2. TAKE PROFIT ANALYSIS
        console.log('\n🎯 TAKE PROFIT ANALYSIS:');
        if (position.take_profit_price) {
            const tpDistance = position.direction === 'long' 
                ? position.take_profit_price - position.entry_price
                : position.entry_price - position.take_profit_price;
            const tpDistancePercent = (tpDistance / position.entry_price) * 100;
            
            console.log(`   🎯 Take Profit Price: $${position.take_profit_price.toFixed(6)}`);
            console.log(`   📏 Distance from Entry: $${tpDistance.toFixed(2)} (${tpDistancePercent.toFixed(2)}%)`);
            
            // Risk:Reward ratio analysis
            if (position.stop_loss_price) {
                const slDistance = position.direction === 'long' 
                    ? position.entry_price - position.stop_loss_price
                    : position.stop_loss_price - position.entry_price;
                const riskRewardRatio = tpDistance / slDistance;
                console.log(`   📊 Risk:Reward Ratio: 1:${riskRewardRatio.toFixed(2)}`);
                
                if (riskRewardRatio < 1.0) {
                    console.log(`   ⚠️  WARNING: Risk:Reward ratio is unfavorable (< 1:1)`);
                } else if (riskRewardRatio >= 2.0) {
                    console.log(`   ✅ GOOD: Risk:Reward ratio is favorable (≥ 1:2)`);
                }
            }
            
            // Check if take profit is hit
            const tpHit = position.direction === 'long' 
                ? currentPrice >= position.take_profit_price
                : currentPrice <= position.take_profit_price;
            console.log(`   ✅ Take Profit Hit: ${tpHit ? 'YES' : 'NO'}`);
            
            if (tpHit) {
                console.log(`   🎉 TAKE PROFIT TRIGGERED! Current price ${currentPrice.toFixed(6)} ${position.direction === 'long' ? '>=' : '<='} TP price ${position.take_profit_price.toFixed(6)}`);
            }
        } else {
            console.log('   ❌ No take profit price set');
        }

        // 3. TRAILING STOP ANALYSIS
        console.log('\n🔄 TRAILING STOP ANALYSIS:');
        if (position.is_trailing) {
            console.log(`   🔄 Trailing Active: YES`);
            console.log(`   📈 Trailing Peak: $${position.trailing_peak_price?.toFixed(6) || 'N/A'}`);
            console.log(`   🛡️  Trailing Stop: $${position.trailing_stop_price?.toFixed(6) || 'N/A'}`);
            
            if (position.trailing_stop_price) {
                const trailingDistance = position.direction === 'long' 
                    ? position.trailing_peak_price - position.trailing_stop_price
                    : position.trailing_stop_price - position.trailing_peak_price;
                const trailingDistancePercent = (trailingDistance / position.trailing_peak_price) * 100;
                
                console.log(`   📏 Trailing Distance: $${trailingDistance.toFixed(2)} (${trailingDistancePercent.toFixed(2)}%)`);
                
                // Check if trailing stop is hit
                const trailingHit = position.direction === 'long' 
                    ? currentPrice <= position.trailing_stop_price
                    : currentPrice >= position.trailing_stop_price;
                console.log(`   ⚠️  Trailing Stop Hit: ${trailingHit ? 'YES' : 'NO'}`);
                
                if (trailingHit) {
                    console.log(`   🚨 TRAILING STOP TRIGGERED! Current price ${currentPrice.toFixed(6)} ${position.direction === 'long' ? '<=' : '>='} trailing stop ${position.trailing_stop_price.toFixed(6)}`);
                }
            }
        } else {
            console.log('   ❌ Trailing stop not active');
            if (position.enableTrailingTakeProfit) {
                console.log('   💡 Trailing enabled but not activated yet');
                
                // Calculate when trailing would activate
                const profitPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
                const takeProfitPercent = position.take_profit_price 
                    ? ((position.take_profit_price - position.entry_price) / position.entry_price) * 100
                    : 5;
                const activationThreshold = takeProfitPercent * 0.5; // 50% of way to TP
                
                console.log(`   📊 Current Profit: ${profitPercent.toFixed(2)}%`);
                console.log(`   🎯 TP Target: ${takeProfitPercent.toFixed(2)}%`);
                console.log(`   🔄 Trailing Activation: ${activationThreshold.toFixed(2)}% (50% of TP)`);
                console.log(`   📈 Need ${(activationThreshold - profitPercent).toFixed(2)}% more profit to activate trailing`);
            } else {
                console.log('   ❌ Trailing stop not enabled');
            }
        }

        // 4. TIME-BASED EXIT ANALYSIS
        console.log('\n⏰ TIME-BASED EXIT ANALYSIS:');
        if (position.time_exit_hours) {
            const entryTime = new Date(position.entry_timestamp).getTime();
            const timeElapsedHours = (Date.now() - entryTime) / (1000 * 3600);
            const timeRemainingHours = position.time_exit_hours - timeElapsedHours;
            
            console.log(`   ⏰ Exit Time Limit: ${position.time_exit_hours} hours`);
            console.log(`   ⏱️  Time Elapsed: ${timeElapsedHours.toFixed(2)} hours`);
            console.log(`   ⏳ Time Remaining: ${timeRemainingHours.toFixed(2)} hours`);
            
            const timeExitHit = timeElapsedHours >= position.time_exit_hours;
            console.log(`   ⚠️  Time Exit Hit: ${timeExitHit ? 'YES' : 'NO'}`);
            
            if (timeExitHit) {
                console.log(`   🚨 TIME EXIT TRIGGERED! Elapsed ${timeElapsedHours.toFixed(2)}h >= limit ${position.time_exit_hours}h`);
            }
        } else {
            console.log('   ❌ No time-based exit set');
        }

        // 5. PRICE TRACKING ANALYSIS
        console.log('\n📊 PRICE TRACKING ANALYSIS:');
        console.log(`   📈 Peak Price: $${position.peak_price?.toFixed(6) || 'N/A'}`);
        console.log(`   📉 Trough Price: $${position.trough_price?.toFixed(6) || 'N/A'}`);
        
        if (position.peak_price && position.trough_price) {
            const peakToTrough = position.peak_price - position.trough_price;
            const peakToTroughPercent = (peakToTrough / position.peak_price) * 100;
            console.log(`   📏 Peak to Trough: $${peakToTrough.toFixed(2)} (${peakToTroughPercent.toFixed(2)}%)`);
        }

        // FEAR & GREED INDEX ANALYSIS
        console.log('\n😨 FEAR & GREED ANALYSIS:');
        try {
            const fearGreedData = this.scannerService.state.fearAndGreedData;
            if (fearGreedData?.value) {
                const fngValue = parseInt(fearGreedData.value);
                const fngClassification = fearGreedData.value_classification || 'Unknown';
                console.log(`   📊 Fear & Greed Index: ${fngValue} (${fngClassification})`);
                
                // Market sentiment impact
                if (fngValue <= 25) {
                    console.log(`   😨 EXTREME FEAR: Market may be oversold - potential buying opportunity`);
                } else if (fngValue >= 75) {
                    console.log(`   🚀 EXTREME GREED: Market may be overbought - potential selling opportunity`);
                } else {
                    console.log(`   😐 NEUTRAL: Market sentiment is balanced`);
                }
            } else {
                console.log('   ❌ Fear & Greed data not available');
            }
        } catch (error) {
            console.log(`   ⚠️ Error analyzing Fear & Greed: ${error.message}`);
        }

        // 6. OVERALL EXIT CONDITION SUMMARY
        console.log('\n🎯 EXIT CONDITION SUMMARY:');
        const exitConditions = [];
        
        if (position.stop_loss_price) {
            const slHit = position.direction === 'long' 
                ? currentPrice <= position.stop_loss_price
                : currentPrice >= position.stop_loss_price;
            if (slHit) exitConditions.push('STOP_LOSS');
        }
        
        if (position.take_profit_price) {
            const tpHit = position.direction === 'long' 
                ? currentPrice >= position.take_profit_price
                : currentPrice <= position.take_profit_price;
            if (tpHit) exitConditions.push('TAKE_PROFIT');
        }
        
        if (position.is_trailing && position.trailing_stop_price) {
            const trailingHit = position.direction === 'long' 
                ? currentPrice <= position.trailing_stop_price
                : currentPrice >= position.trailing_stop_price;
            if (trailingHit) exitConditions.push('TRAILING_STOP');
        }
        
        if (position.time_exit_hours) {
            const entryTime = new Date(position.entry_timestamp).getTime();
            const timeElapsedHours = (Date.now() - entryTime) / (1000 * 3600);
            if (timeElapsedHours >= position.time_exit_hours) exitConditions.push('TIME_EXIT');
        }
        
        if (exitConditions.length > 0) {
            console.log(`   🚨 TRIGGERED EXIT CONDITIONS: ${exitConditions.join(', ')}`);
        } else {
            console.log(`   ✅ No exit conditions triggered`);
        }

        console.log('-'.repeat(60));
    }
}
