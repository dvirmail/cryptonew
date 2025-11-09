import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { useTradingMode } from './TradingModeProvider';
import centralWalletStateManager from '@/components/services/CentralWalletStateManager';

const WalletContext = createContext();

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};

export const WalletProvider = ({ children }) => {
    const { tradingMode } = useTradingMode();
    const [centralState, setCentralState] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [scannerInitialized, setScannerInitialized] = useState(false);

    // Performance history states
    const [dailyPnl, setDailyPnl] = useState(0);
    const [hourlyPnl, setHourlyPnl] = useState(0);
    const [dailyPerformanceHistory, setDailyPerformanceHistory] = useState([]);
    const [hourlyPerformanceHistory, setHourlyPerformanceHistory] = useState([]);
    const [recentTrades, setRecentTrades] = useState([]);

    // Calculate 24h P&L - ALWAYS use trades as source of truth (same as chart's supplementBucketsFromTrades)
    const pnl24h = useMemo(() => {
        // CRITICAL: Always calculate from trades for accuracy, since hourly snapshots may be missing/stale
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const relevantTrades = (recentTrades || []).filter(trade => {
            if (!trade?.exit_timestamp) return false;
            const exitDate = new Date(trade.exit_timestamp);
            return exitDate.getTime() >= twentyFourHoursAgo.getTime();
        });
        
        const sumFromTrades = relevantTrades.reduce((sum, trade) => sum + (Number(trade.pnl_usdt) || 0), 0);
        
        // Optional: Cross-check with hourly snapshots if available (but trades are authoritative)
        let sumFromSnapshots = 0;
        if (hourlyPerformanceHistory && hourlyPerformanceHistory.length > 0) {
            const relevantHours = hourlyPerformanceHistory.filter(rec => {
                if (!rec?.snapshot_timestamp) return false;
                const recDate = new Date(rec.snapshot_timestamp);
                return recDate.getTime() >= twentyFourHoursAgo.getTime();
            });
            sumFromSnapshots = relevantHours.reduce((sum, rec) => sum + (Number(rec.period_pnl) || 0), 0);
        }
        
        // Always prefer trades (matches chart logic), fallback to snapshots only if no trades
        return relevantTrades.length > 0 ? sumFromTrades : sumFromSnapshots;
    }, [hourlyPerformanceHistory, recentTrades]);

    // Performance optimization: Debounce state updates
    const updateTimeoutRef = useRef(null);
    const lastUpdateRef = useRef(0);

    // Computed values from central state
    const totalEquity = centralState?.total_equity || 0;
    const availableBalance = centralState?.available_balance || 0;
    const balanceInTrades = centralState?.balance_in_trades || 0;
    const unrealizedPnl = centralState?.unrealized_pnl || 0;
    const openPositionsCount = centralState?.open_positions_count || 0;
    const lifetimePnl = centralState?.total_realized_pnl || 0;
    
    // CRITICAL: Log lifetimePnl source for debugging - show it's from CENTRALWALLET
    const prevLifetimePnl = React.useRef(lifetimePnl);
    if (prevLifetimePnl.current !== lifetimePnl) {
        console.log(`[WalletProvider] 📊 CENTRALWALLET DATA UPDATE:`);
        console.log(`[WalletProvider] 📊 lifetimePnl (total_realized_pnl): $${lifetimePnl.toFixed(2)} | Source: centralState?.total_realized_pnl (CENTRALWALLET)`);
        console.log(`[WalletProvider] 📊 Central State values:`, {
            total_realized_pnl: centralState?.total_realized_pnl,
            total_trades_count: centralState?.total_trades_count,
            winning_trades_count: centralState?.winning_trades_count,
            losing_trades_count: centralState?.losing_trades_count,
            last_updated: centralState?.updated_date || centralState?.last_binance_sync || 'N/A'
        });
        prevLifetimePnl.current = lifetimePnl;
    }
    
    // Extract arrays from central state
    const balances = centralState?.balances || [];
    const positions = centralState?.positions || [];
    

    const periodPnl = useMemo(() => {
        if (!recentTrades || recentTrades.length === 0) return 0;
        
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const relevantTrades = recentTrades.filter(trade => {
            if (!trade.exit_timestamp) return false;
            const exitDate = new Date(trade.exit_timestamp);
            return exitDate.getTime() >= thirtyDaysAgo.getTime();
        });
        
        return relevantTrades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
    }, [recentTrades]);


    // Debounced state update function
    const debouncedSetCentralState = useCallback((newState) => {
        const positionsCount = newState?.positions?.length || 0;
        const now = Date.now();
        
        // Clear existing timeout
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        
        // If this is a rapid update (within 100ms), debounce it
        if (now - lastUpdateRef.current < 100) {
            updateTimeoutRef.current = setTimeout(() => {
                setCentralState(newState);
                setLoading(false);
                lastUpdateRef.current = Date.now();
            }, 100);
        } else {
            // Update immediately for non-rapid updates
            setCentralState(newState);
            setLoading(false);
            lastUpdateRef.current = now;
        }
    }, []);

    // Initialize central wallet state manager
    useEffect(() => {
        const initializeCentralWallet = async () => {
            if (!tradingMode) return;
            
            try {
                setLoading(true);
                setError(null);
                
                await centralWalletStateManager.initialize(tradingMode);
                
                // Subscribe to state changes with debounced updates
                const unsubscribe = centralWalletStateManager.subscribe(debouncedSetCentralState);
                
                // Check if scanner is initialized
                const scannerService = getAutoScannerService();
                if (scannerService) {
                    setScannerInitialized(scannerService.state?.isInitialized || false);
                }
                
                return unsubscribe;
            } catch (error) {
                console.error('[WalletProvider] ❌ Failed to initialize central wallet state:', error);
                setError(error.message);
                setLoading(false);
            }
        };

        let unsubscribe;
        initializeCentralWallet().then(unsub => {
            unsubscribe = unsub;
        });

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [tradingMode]);

    // Fetch trades data (snapshots removed - analytics calculate from trades directly)
    const fetchPerformanceHistory = useCallback(async () => {
        if (!tradingMode) return;
        
        try {
            
            // Fetch trades - analytics will calculate from these directly
            let trades = await queueEntityCall('Trade', 'filter', {
                trading_mode: tradingMode
            }, '-exit_timestamp', 10000, { timeoutMs: 15000 }).catch(() => []);
            
            // CRITICAL FIX: Deduplicate trades before using them
            // A duplicate is defined as same symbol, entry_price, exit_price, quantity, entry_timestamp, and strategy_name
            if (trades && trades.length > 0) {
                const seen = new Map();
                const uniqueTrades = [];
                
                trades.forEach(trade => {
                    if (!trade?.exit_timestamp || !trade?.entry_timestamp) return;
                    
                    const entryPrice = Math.round((Number(trade.entry_price) || 0) * 10000) / 10000;
                    const exitPrice = Math.round((Number(trade.exit_price) || 0) * 10000) / 10000;
                    const quantity = Math.round((Number(trade.quantity_crypto) || Number(trade.quantity) || 0) * 1000000) / 1000000;
                    const entryDate = trade.entry_timestamp ? new Date(trade.entry_timestamp) : null;
                    const entryDateRounded = entryDate ? new Date(Math.floor(entryDate.getTime() / 1000) * 1000).toISOString() : '';
                    const symbol = trade.symbol || '';
                    const strategy = trade.strategy_name || '';
                    
                    const uniqueKey = `${symbol}|${strategy}|${entryPrice}|${exitPrice}|${quantity}|${entryDateRounded}`;
                    
                    if (!seen.has(uniqueKey)) {
                        seen.set(uniqueKey, trade);
                        uniqueTrades.push(trade);
                    } else {
                        // Keep the trade with the earliest exit_timestamp (or earliest id if timestamps match)
                        const existing = seen.get(uniqueKey);
                        const existingExit = existing?.exit_timestamp ? new Date(existing.exit_timestamp).getTime() : 0;
                        const currentExit = trade?.exit_timestamp ? new Date(trade.exit_timestamp).getTime() : 0;
                        if (currentExit > 0 && (existingExit === 0 || currentExit < existingExit)) {
                            const index = uniqueTrades.indexOf(existing);
                            if (index >= 0) uniqueTrades.splice(index, 1);
                            seen.set(uniqueKey, trade);
                            uniqueTrades.push(trade);
                        }
                    }
                });
                
                // Deduplication complete
                
                trades = uniqueTrades;
            }
            
            // Set empty arrays for backward compatibility (components no longer use these)
            setDailyPerformanceHistory([]);
            setHourlyPerformanceHistory([]);
            setRecentTrades(trades || []);
            
            // Calculate PnL from trades directly
            const tradesWithPnl = (trades || []).filter(t => t?.exit_timestamp != null);
            const dailyPnlValue = tradesWithPnl
                .filter(t => {
                    const exitDate = new Date(t.exit_timestamp);
                    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    return exitDate >= dayAgo;
                })
                .reduce((sum, t) => sum + (Number(t.pnl_usdt) || 0), 0);
            
            const hourlyPnlValue = tradesWithPnl
                .filter(t => {
                    const exitDate = new Date(t.exit_timestamp);
                    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
                    return exitDate >= hourAgo;
                })
                .reduce((sum, t) => sum + (Number(t.pnl_usdt) || 0), 0);
            
            setDailyPnl(dailyPnlValue);
            setHourlyPnl(hourlyPnlValue);
            
        } catch (error) {
            console.error('[WalletProvider] ❌ Error fetching trades:', error);
        }
    }, [tradingMode]);

    // Fetch performance history on mount and periodically
    useEffect(() => {
        if (!tradingMode) return;
        
        fetchPerformanceHistory();
        
        // Set up periodic refresh every 5 minutes
        const interval = setInterval(fetchPerformanceHistory, 5 * 60 * 1000);
        
        return () => clearInterval(interval);
    }, [fetchPerformanceHistory]);

    // CRITICAL FIX: Periodic wallet state sync to prevent stale data after inactivity
    useEffect(() => {
        if (!tradingMode || !centralState) return;
        
        let syncInterval;
        let visibilityHandler;
        
        // Sync function that syncs wallet state AND performance history
        // CRITICAL: Always recalculate P&L from database (source of truth)
        const syncWalletData = async () => {
            try {
                // Recalculate P&L from database first (syncWithBinance also does this, but explicit for clarity)
                await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);
                await centralWalletStateManager.syncWithBinance(tradingMode);
                await fetchPerformanceHistory();
            } catch (error) {
                console.error('[WalletProvider] ❌ Periodic sync failed:', error);
            }
        };
        
        // Initial sync after initialization (debounce by 5 seconds to avoid race with init)
        // CRITICAL: Include P&L recalculation from database in initial sync
        const initialSyncTimeout = setTimeout(async () => {
            try {
                await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);
                await syncWalletData();
            } catch (error) {
                console.error('[WalletProvider] ❌ Initial sync failed:', error);
            }
        }, 5000);
        
        // Set up periodic sync every 2 minutes (more frequent than performance history)
        syncInterval = setInterval(syncWalletData, 2 * 60 * 1000);
        
        // CRITICAL: Resume sync when page becomes visible after inactivity
        visibilityHandler = () => {
            if (!document.hidden) {
                syncWalletData();
            }
        };
        
        document.addEventListener('visibilitychange', visibilityHandler);
        
        return () => {
            clearTimeout(initialSyncTimeout);
            if (syncInterval) clearInterval(syncInterval);
            if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
        };
    }, [tradingMode, centralState, fetchPerformanceHistory]);

    // Monitor scanner initialization
    useEffect(() => {
        const checkScannerStatus = () => {
            const scannerService = getAutoScannerService();
            if (scannerService) {
                const isInitialized = scannerService.state?.isInitialized || false;
                if (isInitialized !== scannerInitialized) {
                    setScannerInitialized(isInitialized);
                }
            }
        };

        const interval = setInterval(checkScannerStatus, 1000);
        return () => clearInterval(interval);
    }, [scannerInitialized]);

    // Force refresh function for external calls
    const forceRefresh = useCallback(async () => {
        if (!tradingMode) {
            return;
        }
        
        try {
            const beforeCount = centralState?.positions?.length || 0;
            await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);
            await centralWalletStateManager.syncWithBinance(tradingMode);
            await fetchPerformanceHistory();
            const afterCount = centralWalletStateManager.currentState?.positions?.length || 0;
            if (beforeCount !== afterCount) {
                //console.log(`[POSITION_UI] Force refresh: ${beforeCount} → ${afterCount} positions`);
            }
        } catch (error) {
            console.error('[WalletProvider] ❌ Force refresh failed:', error);
        }
    }, [tradingMode, fetchPerformanceHistory, centralState]);

    // Expose force refresh globally for debugging
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.forceWalletRefresh = forceRefresh;
            
            // Expose comprehensive refresh function that refreshes all trade-related widgets
            window.refreshAllTradeWidgets = async () => {
                try {
                    // CRITICAL: Clear cached wallet data to force fresh calculation
                    const mode = tradingMode || 'testnet';
                    try {
                        localStorage.removeItem(`walletSummaryCache_${mode}`);
                        localStorage.removeItem(`walletSummaryCache_live`);
                        localStorage.removeItem(`walletSummaryCache_testnet`);
                        //console.log('[WalletProvider] 🗑️ Cleared wallet cache');
                    } catch (e) {
                        console.warn('[WalletProvider] ⚠️ Could not clear cache:', e);
                    }
                    
                    // 1. Recalculate P&L from database (source of truth) and refresh WalletProvider
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode || 'testnet');
                    await forceRefresh();
                    //console.log('[WalletProvider] ✅ WalletProvider refreshed with database-calculated P&L');
                    
                    // 2. Trigger custom event for pages that listen to it
                    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                        window.dispatchEvent(new CustomEvent('tradeDataRefresh'));
                        //console.log('[WalletProvider] ✅ Dispatched tradeDataRefresh event');
                    }
                    
                    // 3. Wait a moment for state to propagate
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    //console.log('[WalletProvider] ✅ All trade widgets refreshed with correct P&L');
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error refreshing trade widgets:', error);
                }
            };
            
            // Expose function to fix trade entry prices and refresh widgets
            window.removeDuplicateTradesAndRefresh = async () => {
                //console.log('[WalletProvider] 🔧 Removing duplicate trades and refreshing widgets...');
                try {
                    // 1. Call the remove duplicates endpoint
                    const response = await fetch('http://localhost:3003/api/trades/remove-duplicates', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        throw new Error(`Remove duplicates endpoint returned ${response.status}`);
                    }

                    const result = await response.json();
                    //console.log(`[WalletProvider] ✅ Removed ${result.removedCount || 0} duplicate trades from database and ${result.removedFromMemory || 0} from memory`);

                    if (result.removedCount > 0) {
                        //console.log(`[WalletProvider] 📊 Sample duplicate IDs (first 10):`, result.duplicateIds);
                    } else {
                        //console.log('[WalletProvider] ℹ️  No duplicate trades found - all trades are unique');
                    }

                    // CRITICAL: Force P&L recalculation from database after removing duplicates
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);
                    
                    // Then refresh widgets to ensure P&L is recalculated from database
                    //console.log('[WalletProvider] 🔄 Refreshing widgets with updated P&L...');
                    await window.refreshAllTradeWidgets();
                    
                    //console.log('[WalletProvider] ✅ Duplicate trades removed and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error removing duplicate trades:', error);
                    throw error;
                }
            };

            window.fixTradeEntryPricesAndRefresh = async () => {
                //console.log('[WalletProvider] 🔧 Fixing trade entry and exit prices and refreshing widgets...');
                try {
                    // 1. Call the fix endpoint (now also fixes exit prices, especially ETH trades with wrong exit_price like 1889.03)
                    const response = await fetch('http://localhost:3003/api/trades/fix-entry-prices', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        throw new Error(`Fix endpoint returned ${response.status}`);
                    }

                    const result = await response.json();
                    //console.log(`[WalletProvider] ✅ Fixed ${result.fixedCount || 0} trades (entry and exit prices)`);

                    if (result.fixedCount > 0) {
                        //console.log(`[WalletProvider] 📊 Fixed trades:`, result.fixedTrades?.slice(0, 5));
                    } else {
                        //console.log('[WalletProvider] ℹ️  No trades needed fixing - all entry and exit prices are correct');
                    }

                    // CRITICAL: Force P&L recalculation from database after fixing trades
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);

                    // Then refresh widgets to ensure P&L is recalculated from database
                    //console.log('[WalletProvider] 🔄 Refreshing widgets with updated P&L...');
                    await window.refreshAllTradeWidgets();

                    //console.log('[WalletProvider] ✅ Trade entry and exit prices verified, P&L recalculated, and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error fixing trade prices:', error);
                    throw error;
                }
            };
            
            // Expose function to recalculate P&L for all trades from their current entry/exit prices
            // This is useful when exit prices are manually updated in the database
            window.reloadTradesFromDatabaseAndRefresh = async () => {
                //console.log('[WalletProvider] 🔄 Reloading trades from database and refreshing widgets...');
                try {
                    // 1. Call the reload endpoint
                    const response = await fetch('http://localhost:3003/api/trades/reload-from-database', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        throw new Error(`Reload endpoint returned ${response.status}`);
                    }

                    const result = await response.json();
                    //console.log(`[WalletProvider] ✅ Reloaded trades from database: ${result.oldCount} → ${result.newCount} trades`);

                    // 2. CRITICAL: Force P&L recalculation from database after reloading trades
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);

                    // 3. Refresh all widgets
                    //console.log('[WalletProvider] 🔄 Refreshing widgets with updated trade data...');
                    await window.refreshAllTradeWidgets();

                    //console.log('[WalletProvider] ✅ Trades reloaded from database and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error reloading trades from database:', error);
                    throw error;
                }
            };

            window.recalculateTradePnlAndRefresh = async () => {
                console.log('[WalletProvider] 🔧 Recalculating trade P&L from entry/exit prices and refreshing widgets...');
                try {
                    // 1. Call the recalculate P&L endpoint
                    const response = await fetch('http://localhost:3003/api/trades/recalculate-pnl', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        // Try to get detailed error message from response
                        let errorDetails = '';
                        try {
                            const errorData = await response.json();
                            errorDetails = errorData.details || errorData.error || `HTTP ${response.status}`;
                            console.error('[WalletProvider] ❌ Recalculate P&L endpoint error:', errorData);
                        } catch (parseError) {
                            const errorText = await response.text();
                            errorDetails = errorText || `HTTP ${response.status}`;
                            console.error('[WalletProvider] ❌ Recalculate P&L endpoint error (text):', errorText);
                        }
                        throw new Error(`Recalculate P&L endpoint returned ${response.status}: ${errorDetails}`);
                    }

                    const result = await response.json();
                    console.log(`[WalletProvider] ✅ Recalculated P&L for ${result.updatedCount || 0} trades (out of ${result.totalTrades || 0} total)`);

                    if (result.errorCount > 0) {
                        console.warn(`[WalletProvider] ⚠️ ${result.errorCount} trades had errors during recalculation`);
                        if (result.errors && result.errors.length > 0) {
                            console.warn('[WalletProvider] ⚠️ Sample errors:', result.errors.slice(0, 5));
                        }
                    }

                    if (result.updatedCount > 0) {
                        console.log(`[WalletProvider] 📊 Sample updated trades:`, result.updatedTrades?.slice(0, 5));
                    } else {
                        console.log('[WalletProvider] ℹ️  No trades needed P&L recalculation - all P&L values are already correct');
                    }

                    // CRITICAL: Force P&L recalculation from database after recalculating trade P&L
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);

                    // Then refresh widgets to ensure P&L is recalculated from database
                    console.log('[WalletProvider] 🔄 Refreshing widgets with updated P&L...');
                    await window.refreshAllTradeWidgets();

                    console.log('[WalletProvider] ✅ Trade P&L recalculated and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error recalculating trade P&L:', error);
                    console.error('[WalletProvider] ❌ Error details:', error.message);
                    throw error;
                }
            };

            // Expose function to clean invalid trades (nulls, invalid prices) and refresh widgets
            window.cleanInvalidTradesAndRefresh = async () => {
                //console.log('[WalletProvider] 🧹 Cleaning invalid trades and refreshing widgets...');
                try {
                    // 1. Call the clean invalid trades endpoint
                    const response = await fetch('http://localhost:3003/api/trades/clean-invalid', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        throw new Error(`Clean invalid trades endpoint returned ${response.status}`);
                    }

                    const result = await response.json();
                    //console.log(`[WalletProvider] ✅ Cleaned ${result.deletedCount || 0} invalid trades from database and ${result.removedFromMemory || 0} from memory`);

                    if (result.deletedCount > 0) {
                        //console.log(`[WalletProvider] 📊 Remaining trades: ${result.remainingCount}`);
                        //console.log(`[WalletProvider] 📊 Sample deleted trades:`, result.deletedSample?.slice(0, 5));
                    } else {
                        //console.log('[WalletProvider] ℹ️  No invalid trades found - all trades are valid');
                    }

                    // CRITICAL: Reload trades from database after cleanup
                    //console.log('[WalletProvider] 🔄 Reloading trades from database after cleanup...');
                    await window.reloadTradesFromDatabaseAndRefresh();

                    //console.log('[WalletProvider] ✅ Invalid trades cleaned and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error cleaning invalid trades:', error);
                    throw error;
                }
            };
            
            // Expose function to delete specific trades by IDs and refresh widgets
            window.deleteTradesByIdsAndRefresh = async (tradeIds) => {
                //console.log('[WalletProvider] 🗑️  Deleting specific trades by IDs and refreshing widgets...');
                try {
                    if (!tradeIds || !Array.isArray(tradeIds) || tradeIds.length === 0) {
                        throw new Error('tradeIds array is required and must not be empty');
                    }

                    // 1. Call the delete endpoint
                    const response = await fetch('http://localhost:3003/api/trades/delete-by-ids', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tradeIds: tradeIds })
                    });

                    if (!response.ok) {
                        throw new Error(`Delete trades endpoint returned ${response.status}`);
                    }

                    const result = await response.json();
                    //console.log(`[WalletProvider] ✅ Deleted ${result.deletedCount || 0} trades from database and ${result.removedFromMemory || 0} from memory`);

                    if (result.deletedCount > 0) {
                        //console.log(`[WalletProvider] 📊 Remaining trades: ${result.remainingCount}`);
                        //console.log(`[WalletProvider] 📊 Deleted trades:`, result.deletedTrades?.slice(0, 10));
                    } else {
                        console.log('[WalletProvider] ⚠️  No trades were deleted - check if IDs exist in database');
                    }

                    // CRITICAL: Reload trades from database after deletion
                    //console.log('[WalletProvider] 🔄 Reloading trades from database after deletion...');
                    await window.reloadTradesFromDatabaseAndRefresh();

                    //console.log('[WalletProvider] ✅ Trades deleted and widgets refreshed');
                    return result;
                } catch (error) {
                    console.error('[WalletProvider] ❌ Error deleting trades by IDs:', error);
                    throw error;
                }
            };
            
            // Expose a quick P&L recalculation function
            window.recalculatePnlFromDatabase = async () => {
                if (!tradingMode) {
                    console.error('[WalletProvider] ❌ Cannot recalculate: No trading mode');
                    return;
                }
                try {
                    await centralWalletStateManager.recalculateRealizedPnlFromDatabase(tradingMode);
                    //console.log('[WalletProvider] ✅ P&L recalculated from database');
                    // Trigger refresh
                    await forceRefresh();
                } catch (error) {
                    console.error('[WalletProvider] ❌ Failed to recalculate P&L:', error);
                }
            };
        }
    }, [forceRefresh]);

    // Create walletSummary object for backward compatibility
    const walletSummary = useMemo(() => ({
        totalEquity,
        availableBalance,
        balanceInTrades,
        unrealizedPnl,
        openPositionsCount,
        lifetimePnl,
        balances,
        positions,
        lastUpdated: centralState?.last_updated_timestamp || new Date().toISOString()
    }), [totalEquity, availableBalance, balanceInTrades, unrealizedPnl, openPositionsCount, lifetimePnl, balances, positions, centralState]);

    // Alias lifetimePnl as totalRealizedPnl for backward compatibility
    const totalRealizedPnl = lifetimePnl;
    
    // Log when totalRealizedPnl is accessed (it's an alias for lifetimePnl from CENTRALWALLET)
    const prevTotalRealizedPnl = React.useRef(totalRealizedPnl);
    if (prevTotalRealizedPnl.current !== totalRealizedPnl) {
        console.log(`[WalletProvider] 📊 totalRealizedPnl (alias for lifetimePnl): $${totalRealizedPnl.toFixed(2)} | Source: CENTRALWALLET (centralState?.total_realized_pnl)`);
        prevTotalRealizedPnl.current = totalRealizedPnl;
    }
    
    // Performance optimization: Memoize context value with shallow comparison
    const contextValue = useMemo(() => {
        const value = {
            // Core wallet data from central state
            totalEquity,
            availableBalance,
            balanceInTrades,
            unrealizedPnl,
            openPositionsCount,
            lifetimePnl,
            totalRealizedPnl, // Alias for lifetimePnl (from CENTRALWALLET)
            
            // Raw data arrays
            balances,
            positions,
            
            // Performance data
            dailyPnl,
            hourlyPnl,
            dailyPerformanceHistory,
            hourlyPerformanceHistory,
            recentTrades,
            periodPnl,
            pnl24h,
            
            // State
            loading,
            error,
            scannerInitialized,
            
            // Central state (for debugging)
            centralState,
            
            // Backward compatibility
            walletSummary,
            
            // Actions
            forceRefresh
        };
        
        // Only log context value changes, not every render
        if (process.env.NODE_ENV === 'development') {
            // Removed verbose logging
        }
        
        return value;
    }, [
        totalEquity,
        availableBalance,
        balanceInTrades,
        unrealizedPnl,
        openPositionsCount,
        lifetimePnl,
        totalRealizedPnl,
        balances,
        positions,
        dailyPnl,
        hourlyPnl,
        dailyPerformanceHistory,
        hourlyPerformanceHistory,
        recentTrades,
        periodPnl,
        pnl24h,
        loading,
        error,
        scannerInitialized,
        centralState,
        walletSummary,
        forceRefresh
    ]);

    return (
        <WalletContext.Provider value={contextValue}>
            {children}
        </WalletContext.Provider>
    );
};