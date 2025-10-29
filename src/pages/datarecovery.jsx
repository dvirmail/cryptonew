
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Database, Search, AlertTriangle, RefreshCw, Trash2, Scale, Clock, Play, RotateCcw, BarChart2, RefreshCcw, DollarSign, CheckCircle, AlertTriangle as AlertTriangleIcon, CheckCircle2, Copy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';

import { BacktestCombination } from '@/api/entities';
import { Trade } from '@/api/entities';
import { HistoricalPerformance } from '@/api/entities';
import { LivePosition } from '@/api/entities';
import { useWallet } from '@/components/providers/WalletProvider';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useToast } from '@/components/ui/use-toast';
import { backfillHistoricalPerformance } from "@/api/functions";
import { migrateTradeCommissions } from "@/api/functions";
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { purgeTradeData } from "@/api/functions";
import { investigateTradeData } from "@/api/functions";
import { deleteTradesBeforeDate } from "@/api/functions";
import BaselineSnapshotPanel from "@/components/recovery/BaselineSnapshotPanel";
import { setExitTimeForOpenPositions } from "@/api/functions";
import { auditHistoricalPerformance } from "@/api/functions";
import { queueEntityCall } from '@/components/utils/apiQueue';

export default function DataRecovery() {
    const [results, setResults] = useState([]);
    const [isChecking, setIsChecking] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [isReconciling, setIsReconciling] = useState(false);
    const [isReconcilingWallet, setIsReconcilingWallet] = useState(false);
    const { toast } = useToast();
    const { virtualWallet, refreshWallet } = useWallet();
    const { tradingMode } = useTradingMode();

    const [isInitializing, setIsInitializing] = useState(true);
    const [backfillState, setBackfillState] = useState({
        isRunning: false,
        tradesProcessed: 0,
        totalTrades: null,
        lastProcessedTradeId: null, 
        lastProcessedTimestamp: null,
        currentCumulativeState: null, 
        isComplete: false,
        error: null,
        snapshotsCreated: 0,
        snapshotsUpdated: 0,
        duplicatesRemoved: 0,
        status: "Ready"
    });

    const [fetchedHistoricalPerformance, setFetchedHistoricalPerformance] = useState(null);
    const [isFetchingHistoricalPerformance, setIsFetchingHistoricalPerformance] = useState(false);

    const [debugOutput, setDebugOutput] = useState([]);
    const [auditLoading, setAuditLoading] = useState(false);

    const [commissionMigrationState, setCommissionMigrationState] = useState({
        isRunning: false,
        tradesProcessed: 0,
        totalTrades: null,
        currentBatch: 0,
        errors: [],
        isComplete: false,
        walletUpdated: false,
        status: "Ready"
    });

    const appendLog = React.useCallback((...lines) => {
        setDebugOutput(prev => {
            const arr = Array.isArray(prev) ? [...prev] : [];
            const ts = new Date().toISOString();
            lines.forEach(line => {
                if (line) {
                    arr.push(`[${ts}] ${line}`);
                }
            });
            return arr.slice(-1000);
        });
    }, []);

    const [tradePurgeStatus, setTradePurgeStatus] = useState({
        isRunning: false,
        progress: '',
        error: null,
        results: null
    });

    const [investigationResults, setInvestigationResults] = useState(null);
    const [isInvestigating, setIsInvestigating] = useState(false);

    const [deleteDate, setDeleteDate] = useState(new Date().toISOString().split('T')[0]);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteResult, setDeleteResult] = useState(null);
    const [totalDeleted, setTotalDeleted] = useState(0);
    const [isAutoDeleting, setIsAutoDeleting] = useState(false);
    const stopAutoDeleteRef = useRef(false);

    const [rebuildingHistorical, setRebuildingHistorical] = useState(false);
    const [historicalRebuildResult, setHistoricalRebuildResult] = useState(null);

    const [rebuildProgress, setRebuildProgress] = useState({
        isRunning: false,
        phase: '',
        totalCalls: 0,
        message: ''
    });

    const [fixingExitTimes, setFixingExitTimes] = useState(false);
    const [exitTimeFixResult, setExitTimeFixResult] = useState(null);

    const [repairStatus, setRepairStatus] = useState({ loading: false, message: '' });


    const clearResults = () => {
        setResults([]);
        setDebugOutput([]);
        setInvestigationResults(null);
        setDeleteResult(null);
        setTotalDeleted(0);
        setIsAutoDeleting(false);
        stopAutoDeleteRef.current = true;
        setHistoricalRebuildResult(null);
        setRebuildProgress({ isRunning: false, phase: '', totalCalls: 0, message: '' });
        setExitTimeFixResult(null);
        setRepairStatus({ loading: false, message: '' });
    };

    const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    const initializeBackfillState = useCallback(async () => {
        setIsInitializing(true);
        try {
            const latestSnapshot = await HistoricalPerformance.list('-snapshot_timestamp', 1);
            if (latestSnapshot.length > 0) {
                const lastState = latestSnapshot[0];
                setBackfillState(prev => ({
                    ...prev,
                    tradesProcessed: lastState.cumulative_trade_count || 0,
                    lastProcessedTimestamp: lastState.snapshot_timestamp, 
                    currentCumulativeState: {
                        total_realized_pnl: lastState.cumulative_realized_pnl || 0,
                        total_trades_count: lastState.cumulative_trade_count || 0,
                        winning_trades_count: lastState.cumulative_winning_trades || 0,
                        gross_profit: lastState.cumulative_gross_profit || 0, 
                        gross_loss: lastState.cumulative_gross_loss || 0,     
                    },
                    status: "Ready to Continue"
                }));
                toast({
                    title: "Backfill Resumed",
                    description: `Found previous progress. Resuming from ${new Date(lastState.snapshot_timestamp).toLocaleString()}.`,
                    variant: "default"
                });
            } else {
                setBackfillState(prev => ({ ...prev, status: "Ready" }));
                toast({
                    title: "No Previous Backfill Found",
                    description: "Starting backfill from scratch.",
                    variant: "info"
                });
            }
        } catch (error) {
            console.error("Error initializing backfill state:", error);
            setBackfillState(prev => ({ ...prev, status: "Error" }));
            toast({
                title: "Initialization Error",
                description: "Could not resume backfill progress from database.",
                variant: "destructive"
            });
        } finally {
            setIsInitializing(false);
        }
    }, [toast]);


    const fetchLatestHistoricalPerformance = useCallback(async () => {
        setIsFetchingHistoricalPerformance(true);
        try {
            const latestPerformance = await HistoricalPerformance.list('-snapshot_timestamp', 1);
            if (latestPerformance.length > 0) {
                setFetchedHistoricalPerformance(latestPerformance[0]);
            } else {
                setFetchedHistoricalPerformance(null);
            }
        } catch (error) {
            console.error("Error fetching historical performance:", error);
            setFetchedHistoricalPerformance(null);
            toast({
                title: "Error",
                description: "Failed to fetch historical performance data.",
                variant: "destructive",
            });
        } finally {
            setIsFetchingHistoricalPerformance(false);
        }
    }, [toast]);

    useEffect(() => {
        initializeBackfillState();
        fetchLatestHistoricalPerformance();
    }, [initializeBackfillState, fetchLatestHistoricalPerformance]);

    const checkTradeHistoryIntegrity = async () => {
        setIsChecking(true);
        try {
            // Virtual wallet functionality removed - only testnet and live modes supported
            setResults(prev => [...prev, "⚠️ Virtual wallet functionality has been removed. Only testnet and live modes are supported."]);
            return;

            const walletState = walletList[0];
            const dbTradeHistory = walletState.trade_history || [];
            
            setResults(prev => [
                ...prev,
                `📊 Database Trade History Analysis:`,
                `   • Total trades in database: ${dbTradeHistory.length}`,
                `   • Database record size: ~${JSON.stringify(walletState).length} bytes`,
                `   • Last trade date: ${dbTradeHistory[0]?.exit_timestamp || 'No trades'}`,
                `   • Oldest trade date: ${dbTradeHistory[dbTradeHistory.length - 1]?.exit_timestamp || 'No trades'}`,
                ``
            ]);

            const memoryTradeCount = virtualWallet?.trade_history?.length || 0;
            
            setResults(prev => [
                ...prev,
                `🧠 Memory vs Database Comparison:`,
                `   • Trades in memory (WalletProvider): ${memoryTradeCount}`,
                `   • Trades in database: ${dbTradeHistory.length}`,
                `   • Discrepancy: ${dbTradeHistory.length - memoryTradeCount} trades missing from memory`,
                ``
            ]);

            if (dbTradeHistory.length > 0) {
                const tradesByMonth = {};
                dbTradeHistory.forEach(trade => {
                    if (trade.exit_timestamp) {
                        const month = trade.exit_timestamp.substring(0, 7);
                        tradesByMonth[month] = (tradesByMonth[month] || 0) + 1;
                    }
                });

                setResults(prev => [
                    ...prev,
                    `📅 Trade Distribution by Month:`,
                    ...Object.entries(tradesByMonth)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .slice(0, 6)
                        .map(([month, count]) => `   • ${month}: ${count} trades`),
                    `   • ... (showing last 6 months only)`,
                    ``
                ]);
            }

            let corruptedTrades = 0;
            let duplicateTrades = 0;
            const tradeIds = new Set();
            
            dbTradeHistory.forEach(trade => {
                if (!trade.trade_id || !trade.strategy_name || !trade.symbol) {
                    corruptedTrades++;
                }
                if (tradeIds.has(trade.trade_id)) {
                    duplicateTrades++;
                } else {
                    tradeIds.add(trade.trade_id);
                }
            });

            setResults(prev => [
                ...prev,
                `🔍 Data Quality Analysis:`,
                `   • Corrupted trades (missing required fields): ${corruptedTrades}`,
                `   • Duplicate trade IDs: ${duplicateTrades}`,
                `   • Unique strategies found: ${new Set(dbTradeHistory.map(t => t.strategy_name)).size}`,
                ``
            ]);

        } catch (error) {
            setResults(prev => [...prev, `❌ Error checking trade history: ${error.message}`]);
        } finally {
            setIsChecking(false);
        }
    };

    const fixOrphanedCombinations = async () => {
        setIsRecovering(true);
        try {
            setResults(prev => [...prev, "🔧 Starting orphaned combination cleanup..."]);

            const combinations = await BacktestCombination.list();
            
            // Virtual wallet functionality removed - only testnet and live modes supported
            setResults(prev => [...prev, "⚠️ Virtual wallet functionality has been removed. Only testnet and live modes are supported."]);
            return;

        } catch (error) {
            setResults(prev => [...prev, `❌ Error during cleanup: ${error.message}`]);
            toast({
                title: "Cleanup Failed",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            setIsRecovering(false);
        }
    };

    const handleReconcileWallet = async () => {
        setIsReconciling(true);
        setResults(prev => [...prev, "", "💰 Starting wallet balance reconciliation..."]);
    
        try {
            // Virtual wallet functionality removed - only testnet and live modes supported
            setResults(prev => [...prev, "⚠️ Virtual wallet functionality has been removed. Only testnet and live modes are supported."]);
            return;
    
            if (walletList.length === 0) {
                throw new Error("No wallet state found in the database.");
            }
            const wallet = walletList[0];
    
            const initialBalance = wallet.initial_balance_usdt || 10000;
            const currentBalance = wallet.balance_usdt || 0;
            const balanceInTrades = (wallet.positions || []).reduce((sum, pos) => sum + (pos.entry_value_usdt || 0), 0);
            const totalRealizedPnl = (allTrades || []).reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
    
            const expectedAvailableCash = initialBalance + totalRealizedPnl - balanceInTrades;
            const discrepancy = expectedAvailableCash - currentBalance;
    
            setResults(prev => [
                ...prev,
                `   • Initial Balance: $${(initialBalance || 0).toFixed(2)}`,
                `   • Total Realized P&L (from ${allTrades.length} trades): $${(totalRealizedPnl || 0).toFixed(2)}`,
                `   • Capital in Open Positions: $${(balanceInTrades || 0).toFixed(2)}`,
                `   ---`,
                `   • Expected Available Cash: $${(expectedAvailableCash || 0).toFixed(2)}`,
                `   • Current Available Cash: $${(currentBalance || 0).toFixed(2)}`,
                `   • Discrepancy: $${(discrepancy || 0).toFixed(2)}`
            ]);
    
            if (Math.abs(discrepancy) < 0.01) {
                setResults(prev => [...prev, "✅ No significant discrepancy found. Wallet is balanced."]);
                toast({ title: "Success", description: "Wallet balance is already reconciled." });
            } else {
                setResults(prev => [...prev, `   • Applying adjustment of $${(discrepancy || 0).toFixed(2)}...`]);
                
                // Virtual wallet functionality removed - only testnet and live modes supported
                setResults(prev => [...prev, "⚠️ Virtual wallet functionality has been removed. Only testnet and live modes are supported."]);
    
                setResults(prev => [...prev, "✅ Reconciliation complete. Wallet balance has been corrected."]);
                toast({
                    title: "Reconciliation Complete",
                    description: `Wallet balance adjusted by $${(discrepancy || 0).toFixed(2)}.`,
                    variant: 'success'
                });
    
                await refreshWallet();
            }
    
        } catch (error) {
            const errorMessage = `❌ Error during reconciliation: ${error.message}`;
            setResults(prev => [...prev, errorMessage]);
            toast({
                title: "Reconciliation Failed",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsReconciling(false);
        }
    };

    const handleReconcileWalletState = async () => {
        setIsReconcilingWallet(true);
        setResults(prev => [...prev, "", "💰 Reconciling wallet state with UI display..."]);
        
        try {
            const { reconcileWalletState } = await import('@/api/functions');
            const response = await reconcileWalletState({});
            const result = response.data;
            
            if (result.success) {
                const adjustment = result.adjustment || 0;
                const availableCash = result.summary?.calculatedState?.available_cash || 0;
                const balanceInTrades = result.summary?.calculatedState?.balance_in_trades || 0;
                const totalEquity = result.summary?.calculatedState?.total_equity || 0;
                const totalRealizedPnl = result.summary?.calculatedState?.total_realized_pnl || 0;
                const totalTrades = result.summary?.calculatedState?.total_trades || 0;
                const winningTrades = result.summary?.calculatedState?.winning_trades || 0;
                const grossProfit = result.summary?.calculatedState?.gross_profit || 0;
                const grossLoss = result.summary?.calculatedState?.gross_loss || 0;
                
                setResults(prev => [
                    ...prev,
                    `✅ ${result.message}`,
                    `   • Adjustment applied: $${adjustment.toFixed(2)}`,
                    `   • Available Cash: $${availableCash.toFixed(2)}`,
                    `   • Balance in Trades: $${balanceInTrades.toFixed(2)}`,
                    `   • Total Equity: $${totalEquity.toFixed(2)}`,
                    `   ---`,
                    `   📊 Calculated & Populated Stats:`,
                    `   • Total Realized P&L: $${totalRealizedPnl.toFixed(2)}`,
                    `   • Total Trades: ${totalTrades}`,
                    `   • Winning Trades: ${winningTrades}`,
                    `   • Gross Profit: $${grossProfit.toFixed(2)}`,
                    `   • Gross Loss: $${grossLoss.toFixed(2)}`,
                ]);
                
                toast({
                    title: "Wallet Reconciled",
                    description: result.message,
                    variant: adjustment !== 0 ? "default" : "success"
                });

                await refreshWallet();
            } else {
                throw new Error(result.error);
            }
            
        } catch (error) {
            const errorMessage = `❌ Error reconciling wallet: ${error.message}`;
            setResults(prev => [...prev, errorMessage]);
            toast({
                title: "Reconciliation Failed",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsReconcilingWallet(false);
        }
    };

    const handleBackfillHistoricalData = async () => {
        if (backfillState.isRunning) return;
        
        appendLog('Backfill: starting incremental repair of HistoricalPerformance…');
        setBackfillState(prev => ({ ...prev, isRunning: true, status: "Backfilling..." }));
        
        const run = async (attempt = 1) => {
            try {
                const { data: response } = await backfillHistoricalPerformance({
                    fullRebuild: false,
                    repairExisting: true,
                    dailyLimit: 500,
                    hourlyLimit: 900,
                    maxUpdatesPerCall: 60,
                    batchSize: 6,
                    batchDelayMs: 250,
                    perUpdateDelayMs: 25,
                    debug: true,
                    debugSampleLimit: 5
                });
                
                console.log(`[DataRecovery] Backfill response:`, response);
                console.log('[DataRecovery] Backfill response (debug):', response?.debug || '(no debug)');
                const d = response?.debug?.daily;
                const h = response?.debug?.hourly;
                appendLog(
                  `Backfill: completed batch. Daily updated=${response?.summary?.daily?.updated || 0}, Hourly updated=${response?.summary?.hourly?.updated || 0}`,
                  d ? `Daily fetched=${d.fetched}, missing(period_pnl=${d.missing?.period_pnl || 0}, cum_pnl=${d.missing?.cumulative_realized_pnl || 0}), timestamps=[${d.timestamps?.first} → ${d.timestamps?.last}]` : 'Daily: no debug',
                  h ? `Hourly fetched=${h.fetched}, missing(period_pnl=${h.missing?.period_pnl || 0}, cum_pnl=${h.missing?.cumulative_realized_pnl || 0}), timestamps=[${h.timestamps?.first} → ${h.timestamps?.last}]` : 'Hourly: no debug'
                );
                
                if (response?.success) {
                    setBackfillState(prev => ({
                        ...prev,
                        tradesProcessed: (prev.tradesProcessed || 0) + (response.tradesProcessed || 0),
                        snapshotsCreated: (prev.snapshotsCreated || 0) + (response.recordsCreated || 0),
                        snapshotsUpdated: (prev.snapshotsUpdated || 0) + (response.repair?.updated || response.summary?.daily?.updated || 0) + (response.summary?.hourly?.updated || 0),
                        duplicatesRemoved: prev.duplicatesRemoved || 0,
                        lastProcessedTimestamp: response.lastProcessedTimestamp || prev.lastProcessedTimestamp,
                        isComplete: true,
                        status: "Complete ✅",
                        error: null
                    }));
                    appendLog('Backfill: success - period deltas recomputed.');

                    const repairedMsg = response.repair?.updated ? ` | Repaired ${response.repair.updated} snapshot(s)` : '';
                    toast({
                        title: "Backfill Complete",
                        description: `${response.message || 'Period deltas recomputed.'}${repairedMsg}`,
                    });

                } else {
                    const errMsg = response?.error || "Unknown error occurred during backfill";
                    throw new Error(errMsg);
                }
            } catch (error) {
                console.error(`[DataRecovery] Backfill error:`, error);
                const status = error?.response?.status || 0;
                const errText = error?.response?.data?.error || error.message || 'Backfill failed';
                appendLog(`Backfill: error (${status}) - ${errText}`);

                if (status === 429 && attempt <= 2) {
                    const retryAfter = Number(error?.response?.data?.retryAfter || 60);
                    for (let s = retryAfter; s > 0; s--) {
                        setBackfillState(prev => ({ ...prev, status: `Rate limited. Retrying in ${s}s…` }));
                        await wait(1000);
                    }
                    setBackfillState(prev => ({ ...prev, status: "Backfilling..." }));
                    appendLog('Backfill: retrying now…');
                    return run(attempt + 1);
                }

                setBackfillState(prev => ({
                    ...prev,
                    error: errText,
                    status: "Error ❌"
                }));
                
                toast({
                    title: status === 429 ? "Rate limit" : "Backfill Error",
                    description: status === 429 ? "Please wait a minute and try again." : errText,
                    variant: "destructive",
                });
            } finally {
                setBackfillState(prev => ({ ...prev, isRunning: false }));
                fetchLatestHistoricalPerformance();
            }
        };
        await run(1);
    };

    const handleFullRebuildHistoricalData = async () => {
        if (rebuildProgress.isRunning) {
            toast({
                title: "Already Running",
                description: "Rebuild is already in progress. Please wait.",
                variant: "default"
            });
            return;
        }

        if (!confirm('This will rebuild historical performance period deltas. Continue?')) {
            return;
        }

        setRebuildingHistorical(true);
        setHistoricalRebuildResult(null);
        setDebugOutput([]);
        setBackfillState(prev => ({ ...prev, snapshotsUpdated: 0 }));
        setRebuildProgress({ isRunning: true, phase: 'starting', totalCalls: 0, message: 'Preparing…' });
        appendLog('Rebuild: starting… (daily, then hourly)');

        const runStep = async (periodType, attempt = 1) => {
            setRebuildProgress({ isRunning: true, phase: periodType, totalCalls: attempt, message: `Recomputing ${periodType}…` });
            appendLog(`Rebuild: ${periodType} step started (attempt ${attempt})`);
            try {
                const { data } = await backfillHistoricalPerformance({
                    fullRebuild: true,
                    periodTypes: [periodType],
                    dailyLimit: periodType === 'daily' ? 400 : undefined,
                    hourlyLimit: periodType === 'hourly' ? 800 : undefined,
                    maxUpdatesPerCall: 30,
                    batchSize: 2,
                    batchDelayMs: 500,
                    perUpdateDelayMs: 80,
                    debug: true,
                    debugSampleLimit: 5
                });
                console.log(`[DataRecovery] Rebuild ${periodType} response (debug):`, data?.debug || '(no debug)');
                const d = data?.debug?.daily;
                const h = data?.debug?.hourly;
                const upd = (periodType === 'daily' ? data?.summary?.daily?.updated : data?.summary?.hourly?.updated) || 0;
                appendLog(
                  `Rebuild: ${periodType} updated=${upd}`,
                  d && periodType === 'daily' ? `Daily fetched=${d.fetched}, missing(period_pnl=${d.missing?.period_pnl || 0}, cum_pnl=${d.missing?.cumulative_realized_pnl || 0})` : null,
                  h && periodType === 'hourly' ? `Hourly fetched=${h.fetched}, missing(period_pnl=${h.missing?.period_pnl || 0}, cum_pnl=${h.missing?.cumulative_realized_pnl || 0})` : null
                );

                if (!data?.success) {
                    const err = data?.error || 'Backfill failed';
                    throw new Error(err);
                }

                const updated = (periodType === 'daily' ? data?.summary?.daily?.updated : data?.summary?.hourly?.updated) || 0;

                setBackfillState(prev => ({
                    ...prev,
                    snapshotsUpdated: (prev.snapshotsUpdated || 0) + updated
                }));

                toast({
                    title: `Rebuild: ${periodType} done`,
                    description: `Updated ${updated} ${periodType} snapshots.`,
                });

                return updated;
            } catch (error) {
                const status = error?.response?.status || 0;
                if (status === 429 && attempt <= 3) {
                    const retryAfter = Number(error?.response?.data?.retryAfter || 60);
                    const jitter = Math.floor(Math.random() * 6);
                    for (let s = retryAfter + jitter; s > 0; s--) {
                        setRebuildProgress({
                            isRunning: true,
                            phase: `${periodType}-waiting`,
                            totalCalls: attempt,
                            message: `Rate limited. Retrying ${periodType} in ${s}s…`
                        });
                        await wait(1000);
                    }
                    setRebuildProgress(prev => ({ ...prev, message: `Retrying ${periodType}...` }));
                    appendLog(`Rebuild: retrying ${periodType} now…`);
                    return runStep(periodType, attempt + 1);
                }

                const msg = error?.response?.data?.error || error.message || `Rebuild ${periodType} failed`;
                setHistoricalRebuildResult({ type: 'error', message: msg });
                toast({ title: `Rebuild ${periodType} Failed`, description: msg, variant: "destructive" });
                appendLog(`Rebuild: ${periodType} failed - ${msg}`);
                return 0;
            }
        };

        try {
            const dailyUpdated = await runStep('daily', 1);
            for (let s = 3; s > 0; s--) {
                setRebuildProgress({ isRunning: true, phase: 'pause', totalCalls: 0, message: `Waiting ${s}s before hourly…` });
                appendLog(`Rebuild: pause ${s}s before hourly step…`);
                await wait(1000);
            }
            const hourlyUpdated = await runStep('hourly', 1);

            setBackfillState(prev => ({ ...prev, status: "Complete ✅" }));
            setHistoricalRebuildResult({
                type: 'success',
                message: 'Rebuild completed successfully',
                details: `Updated ${dailyUpdated} daily and ${hourlyUpdated} hourly snapshots.`
            });
            toast({ title: "Rebuild Complete", description: `Daily updated: ${dailyUpdated}, Hourly updated: ${hourlyUpdated}` });
            appendLog(`Rebuild: completed. Daily updated=${dailyUpdated}, Hourly updated=${hourlyUpdated}`);
        } finally {
            setRebuildingHistorical(false);
            setRebuildProgress({ isRunning: false, phase: '', totalCalls: 0, message: '' });
            fetchLatestHistoricalPerformance();
        }
    };

    const handleAuditAndFix = async () => {
      if (auditLoading) return;
      setAuditLoading(true);
      appendLog('Audit: starting “Audit & Fix Missing Fields”…');
      try {
        let totalFixed = 0;
        const maxPasses = 8;
        for (let pass = 1; pass <= maxPasses; pass++) {
          appendLog(`Audit: pass ${pass}…`);

          let passFixed = 0;

          while (true) {
            try {
              const { data } = await auditHistoricalPerformance({
                limit: 4000,
                maxUpdatesPerCall: 30,
                batchSize: 4,
                perUpdateDelayMs: 120,
                batchDelayMs: 1800,
                debug: true,
                debugSampleLimit: 5,
              });

              const dailyFixed = data?.results?.daily?.repaired || 0;
              const hourlyFixed = data?.results?.hourly?.repaired || 0;
              passFixed = dailyFixed + hourlyFixed;
              totalFixed += passFixed;

              const dMissing = data?.results?.daily?.missingCounters;
              const hMissing = data?.results?.hourly?.missingCounters;

              if (data?.rateLimited) {
                const waitSecs = Number(data?.retryAfter || 60);
                appendLog(
                  `Audit: rate limited by backend. Will retry in ${waitSecs}s…`,
                  dMissing ? `Missing (daily): ${JSON.stringify(dMissing)}` : 'Missing (daily): n/a',
                  hMissing ? `Missing (hourly): ${JSON.stringify(hMissing)}` : 'Missing (hourly): n/a'
                );
                for (let s = waitSecs; s > 0; s--) {
                  appendLog(`Audit: retrying in ${s}s…`);
                  await wait(1000);
                }
                appendLog('Audit: retrying now…');
                continue;
              }

              appendLog(
                `Audit: pass ${pass} repaired daily=${dailyFixed}, hourly=${hourlyFixed} (total so far=${totalFixed})`,
                dMissing ? `Missing (daily): ${JSON.stringify(dMissing)}` : 'Missing (daily): n/a',
                hMissing ? `Missing (hourly): ${JSON.stringify(hMissing)}` : 'Missing (hourly): n/a'
              );

              break;
            } catch (err) {
              const status = err?.response?.status || 0;
              const retryAfter = Number(err?.response?.data?.retryAfter || 60);
              if (status === 429) {
                for (let s = retryAfter; s > 0; s--) {
                  appendLog(`Audit: rate limited. Retrying in ${s}s…`);
                  await wait(1000);
                }
                appendLog('Audit: retrying now…');
                continue;
              }
              throw err;
            }
          }

          if (passFixed === 0) {
            appendLog('Audit: dataset is clean — no further repairs needed.');
            break;
          }

          await new Promise(r => setTimeout(r, 250));
        }

        setBackfillState(prev => ({
          ...prev,
          snapshotsUpdated: (prev.snapshotsUpdated || 0) + totalFixed,
          status: "Complete ✅",
        }));

        toast({
          title: "Audit Finished",
          description: `Total repairs applied: ${totalFixed}`,
        });
      } catch (err) {
        const msg = err?.response?.data?.error || err?.message || 'Unknown error';
        appendLog(`Audit error: ${msg}`);
        toast({ title: "Audit failed", description: msg, variant: "destructive" });
      } finally {
        setAuditLoading(false);
        fetchLatestHistoricalPerformance();
      }
    };


    const handleResetBackfill = async () => {
        setBackfillState(prev => ({ ...prev, isRunning: true, status: "Resetting..." }));
        try {
            toast({ title: "Resetting...", description: "Deleting all historical performance snapshots...", duration: 5000 });
            
            const allSnapshots = await HistoricalPerformance.list();
            
            const batchSize = 50;
            for (let i = 0; i < allSnapshots.length; i += batchSize) {
                const batch = allSnapshots.slice(i, i + batchSize);
                await Promise.all(batch.map(s => HistoricalPerformance.delete(s.id)));
            }

            setBackfillState({
                isRunning: false,
                tradesProcessed: 0,
                totalTrades: null,
                lastProcessedTradeId: null,
                lastProcessedTimestamp: null,
                isComplete: false,
                error: null,
                snapshotsCreated: 0,
                snapshotsUpdated: 0,
                duplicatesRemoved: 0,
                status: "Ready"
            });
            setFetchedHistoricalPerformance(null);
            setDebugOutput([]);
            setHistoricalRebuildResult(null);
            setRebuildProgress({ isRunning: false, phase: '', totalCalls: 0, message: '' });
            toast({
                title: "Backfill Reset Complete",
                description: "Historical data cleared. You can start a fresh backfill or full rebuild.",
                variant: "success"
            });
        } catch (error) {
            console.error("Error resetting backfill:", error);
            toast({
                title: "Reset Failed",
                description: `Could not delete historical data: ${error.message}`,
                variant: "destructive"
            });
            setBackfillState(prev => ({ ...prev, isRunning: false, error: error.message, status: "Error" }));
        }
    };

    const handleStartCommissionMigration = async () => {
        if (commissionMigrationState.isRunning) return;
        
        if (!confirm('This will apply 0.1% trading commission (0.2% round-trip) to ALL historical trades and update their P&L. This operation cannot be easily undone. Continue?')) {
            return;
        }

        setCommissionMigrationState(prev => ({ 
            ...prev, 
            isRunning: true, 
            status: "Processing...",
            currentBatch: 1 
        }));
        
        await processCommissionMigrationBatch();
    };

    const processCommissionMigrationBatch = async () => {
        try {
            const { data: response } = await migrateTradeCommissions({
                batchSize: 500
            });
            
            console.log(`[DataRecovery] Commission migration batch response:`, response);
            
            if (response?.success) {
                setCommissionMigrationState(prev => ({
                    ...prev,
                    tradesProcessed: prev.tradesProcessed + (response.batchProcessed || 0),
                    errors: [...prev.errors, ...(response.errors || [])],
                    isComplete: response.isComplete || false,
                    walletUpdated: !!response.walletUpdated,
                    status: response.isComplete ? "Complete ✅" : "Processing...",
                    currentBatch: prev.currentBatch + 1
                }));

                toast({
                    title: response.isComplete ? "Migration Complete" : "Batch Processed",
                    description: response.message,
                    variant: response.errors?.length > 0 ? "destructive" : "default"
                });

                if (!response.isComplete && response.hasMoreTrades) {
                    setTimeout(() => {
                        processCommissionMigrationBatch();
                    }, 5000);
                } else {
                    setCommissionMigrationState(prev => ({ ...prev, isRunning: false }));
                    
                    if (response.isComplete) {
                        await refreshWallet();
                    }
                }
            } else {
                throw new Error(response?.error || "Unknown error occurred during backfill");
            }
        } catch (error) {
            console.error(`[DataRecovery] Commission migration error:`, error);
            setCommissionMigrationState(prev => ({
                ...prev,
                isRunning: false,
                status: "Error ❌",
                errors: [...prev.errors, error.message]
            }));
            
            toast({
                title: "Migration Error",
                description: error.message,
                variant: "destructive",
            });
        }
    };

    const handleResetCommissionMigration = async () => {
        if (commissionMigrationState.isRunning) return;
        
        if (!confirm('This will reset all commission migration flags, allowing trades to be re-processed. Use this if the migration failed midway. Continue?')) {
            return;
        }

        setCommissionMigrationState(prev => ({ ...prev, isRunning: true, status: "Resetting..." }));
        
        try {
            const { data: response } = await migrateTradeCommissions({
                resetMigration: true
            });
            
            if (response?.success) {
                setCommissionMigrationState({
                    isRunning: false,
                    tradesProcessed: 0,
                    totalTrades: null,
                    currentBatch: 0,
                    errors: [],
                    isComplete: false,
                    walletUpdated: false,
                    status: "Ready"
                });
                
                toast({
                    title: "Reset Complete",
                    description: response.message,
                });
            } else {
                throw new Error(response?.error || "Reset failed");
            }
        } catch (error) {
            setCommissionMigrationState(prev => ({
                ...prev,
                isRunning: false,
                status: "Reset Error ❌",
                errors: [error.message]
            }));
            
            toast({
                title: "Reset Failed",
                description: error.message,
                variant: "destructive",
            });
        }
    };

    const handlePurgeAllTrades = async () => {
        if (!confirm('⚠️ This will delete duplicate trades in batches. You may need to click multiple times. Continue?')) {
            return;
        }

        setTradePurgeStatus({
            isRunning: true,
            progress: 'Starting trade purge operation...',
            error: null,
            results: null
        });

        try {
            console.log(`[DataRecovery] 🗑️ Starting trade purge operation...`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            
            const { data: response } = await purgeTradeData({}, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            console.log(`[DataRecovery] Trade purge response:`, response);
            
            if (response.success) {
                setTradePurgeStatus({
                    isRunning: false,
                    progress: response.hasMoreTrades ? 
                        'Batch completed successfully! Click "Purge Trades (Batch)" again to continue.' :
                        'Trade purge completed successfully!',
                    error: null,
                    results: {
                        tradesDeleted: response.tradesDeleted,
                        hasMoreTrades: response.hasMoreTrades,
                        message: response.message,
                        remainingCount: response.remainingTrades,
                        initialCount: response.initialTradeCount,
                    }
                });
                
                toast({
                    title: response.hasMoreTrades ? "Batch Purge Complete" : "Trade Purge Complete",
                    description: response.message,
                    variant: "default"
                });
            } else {
                throw new Error(response.error || 'Trade purge failed');
            }
        } catch (error) {
            console.error(`[DataRecovery] Trade purge error:`, error);
            
            let errorMessage = error.message;
            if (error.name === 'AbortError') {
                errorMessage = 'Operation timed out. The system may be processing a large dataset. Please try again in a few minutes.';
            } else if (errorMessage.includes('503')) {
                errorMessage = 'Service temporarily unavailable. The function may be overloaded. Please wait a moment and try again.';
            } else if (errorMessage.includes('500')) {
                errorMessage = 'Internal server error. Please check the function logs for details.';
            }
            
            setTradePurgeStatus({
                isRunning: false,
                progress: '',
                error: errorMessage,
                results: null
            });
            
            toast({
                title: "Trade Purge Failed", 
                description: errorMessage,
                variant: "destructive"
            });
        }
    };

    const handleInvestigateTradeData = async () => {
        setIsInvestigating(true);
        setInvestigationResults(null);
        try {
            console.log('🔍 Starting trade data investigation...');
            const { data: response } = await investigateTradeData({});
            
            if (response.success) {
                setInvestigationResults(response.analysis);
                toast({
                    title: "Investigation Complete",
                    description: `Analyzed ${response.analysis.summary.totalTrades} trades. Check results below.`,
                });
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            console.error('Investigation failed:', error);
            toast({
                title: "Investigation Failed", 
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsInvestigating(false);
        }
    };
    
    const startAutoDelete = async () => {
        if (!deleteDate) {
            toast({ title: "Error", description: "Please select a cutoff date", variant: "destructive" });
            return;
        }

        const confirmDelete = window.confirm(
            `⚠️ WARNING: This will start an automated process to permanently delete ALL trade records closed before ${deleteDate}.\n\nThis action cannot be undone. Are you sure?`
        );
        if (!confirmDelete) return;

        setIsAutoDeleting(true);
        stopAutoDeleteRef.current = false;
        setTotalDeleted(0);
        setDeleteResult(null);

        let currentOffset = 0;
        let hasMore = true;

        while (hasMore && !stopAutoDeleteRef.current) {
            setDeleteLoading(true);
            try {
                const response = await deleteTradesBeforeDate({ cutoffDate: deleteDate, offset: currentOffset });
                
                if (response.data.success) {
                    setDeleteResult(response.data);
                    setTotalDeleted(prev => prev + response.data.deletedCount);
                    
                    hasMore = response.data.hasMoreToDelete;
                    currentOffset = response.data.nextOffset;

                    if (!hasMore) {
                        toast({ title: "Deletion Complete", description: "Finished processing all trades before the cutoff date.", variant: "default" });
                        await refreshWallet();
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                } else {
                    throw new Error(response.data.message || "An unknown error occurred in the backend.");
                }
            } catch (error) {
                console.error('Auto-delete batch error:', error);
                toast({ title: "Auto-Delete Error", description: error.message, variant: "destructive" });
                hasMore = false;
                setDeleteResult(prev => ({ ...prev, success: false, message: error.message }));
            } finally {
                setDeleteLoading(false);
            }
        }

        setIsAutoDeleting(false);
        stopAutoDeleteRef.current = false;
    };

    const stopAutoDelete = () => {
        stopAutoDeleteRef.current = true;
        setIsAutoDeleting(false);
        setDeleteLoading(false);
        toast({ title: "Deletion Stopped", description: "The automated deletion process has been stopped.", variant: "info" });
    };

    function ExitTimeFixer() {
        const { toast } = useToast();
        const [loadingMode, setLoadingMode] = useState(null);
        const [result, setResult] = useState(null);

        const runFix = async (mode) => {
            try {
                setLoadingMode(mode);
                setResult(null);
                const { data } = await setExitTimeForOpenPositions({
                    mode,
                    exitMinutes: 30,
                    onlyMissing: true
                });
                setResult(data);
                toast({
                    title: "Exit time updated",
                    description: data?.message || `Applied 30m exit time for ${mode}.`,
                });
            } catch (e) {
                console.error("Failed to update exit time:", e);
                toast({
                    title: "Failed to update exit time",
                    description: e.response?.data?.error || e.message || "Unknown error",
                    variant: "destructive",
                });
            } finally {
                setLoadingMode(null);
            }
        };

        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Fix Missing Exit Times
                    </CardTitle>
                    <CardDescription>
                        Apply a 30-minute time-based exit to all currently open positions that are missing it.
                        This can help resolve positions stuck indefinitely.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                        <Button
                            onClick={() => runFix("testnet")}
                            disabled={loadingMode === "testnet"}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {loadingMode === "testnet" ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {loadingMode === "testnet" ? "Updating Testnet..." : "Set 30m Exit (Testnet)"}
                        </Button>
                        <Button
                            onClick={() => runFix("live")}
                            disabled={loadingMode === "live"}
                            variant="outline"
                        >
                            {loadingMode === "live" ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {loadingMode === "live" ? "Updating Live..." : "Set 30m Exit (Live)"}
                        </Button>
                    </div>

                    {result && (
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-sm space-y-1">
                            <p><strong>Result:</strong> {result.message}</p>
                            <p><strong>Mode:</strong> {result.mode}</p>
                            <p><strong>Wallets Processed:</strong> {result.walletsProcessed}</p>
                            <p><strong>Positions Evaluated:</strong> {result.positionsEvaluated}</p>
                            <p><strong>Positions Updated:</strong> {result.positionsUpdated}</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    }
    
    const handleFixOpenPositionsExitTime = async () => {
        if (!window.confirm('⚠️ This will update ALL open positions to exit in 5 minutes. This action cannot be undone. Continue?')) {
            return;
        }

        setFixingExitTimes(true);
        setExitTimeFixResult(null);

        try {
            console.log('[EXIT_TIME_FIX] Starting exit time fix process...');
            
            console.log('[EXIT_TIME_FIX] Fetching open positions...');
            
            let openPositions = [];
            
            try {
                const [open, trailing] = await Promise.all([
                    LivePosition.filter({ status: 'open' }).catch(() => []),
                    LivePosition.filter({ status: 'trailing' }).catch(() => [])
                ]);
                openPositions = [...open, ...trailing];
                console.log('[EXIT_TIME_FIX] Total positions found:', openPositions.length);
            } catch (e) {
                console.error('[EXIT_TIME_FIX] Error fetching positions:', e);
                throw new Error(`Failed to fetch positions: ${e.message}`);
            }
            
            console.log('[EXIT_TIME_FIX] Fetched positions:', {
                count: openPositions?.length || 0,
                sample: openPositions[0] ? {
                    id: openPositions[0].id,
                    position_id: openPositions[0].position_id,
                    status: openPositions[0].status,
                    time_exit_hours: openPositions[0].time_exit_hours
                } : null
            });

            if (!openPositions || openPositions.length === 0) {
                setExitTimeFixResult({
                    success: true,
                    message: 'No open positions found to update.',
                    updated: 0,
                    inProgress: false
                });
                setFixingExitTimes(false);
                toast({
                    title: "No Positions Found",
                    description: "There are no open positions to update.",
                    variant: "default"
                });
                return;
            }

            console.log('[EXIT_TIME_FIX] Found open positions to update:', openPositions.length);

            const fiveMinutesInHours = 5 / 60;
            const now = new Date();
            
            let successCount = 0;
            let failedCount = 0;
            const results = [];

            setExitTimeFixResult({
                success: null,
                message: `Updating positions... (0/${openPositions.length})`,
                updated: 0,
                failed: 0,
                inProgress: true
            });

            for (let i = 0; i < openPositions.length; i++) {
                const position = openPositions[i];
                try {
                    const entryTime = new Date(position.entry_timestamp);
                    const timeSinceEntry = (now.getTime() - entryTime.getTime()) / (1000 * 60 * 60);
                    const newTimeExitHours = timeSinceEntry + fiveMinutesInHours;

                    console.log(`[EXIT_TIME_FIX] Updating position ${i + 1}/${openPositions.length}:`, {
                        position_id: position.position_id,
                        strategy: position.strategy_name,
                        old_time_exit_hours: position.time_exit_hours,
                        new_time_exit_hours: newTimeExitHours,
                        will_exit_in_minutes: 5
                    });

                    await LivePosition.update(position.id, {
                        time_exit_hours: newTimeExitHours
                    });

                    successCount++;
                    results.push({ success: true, position_id: position.position_id });
                    console.log('[EXIT_TIME_FIX] Successfully updated position:', position.position_id);

                } catch (error) {
                    console.error('[EXIT_TIME_FIX] Failed to update position:', position.position_id, error);
                    failedCount++;
                    results.push({ success: false, position_id: position.position_id, error: error.message });
                    
                    if (error.message && error.message.includes('Network')) {
                        console.log('[EXIT_TIME_FIX] Network error detected, adding extra delay...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                setExitTimeFixResult({
                    success: null,
                    message: `Updating positions... (${i + 1}/${openPositions.length})`,
                    updated: successCount,
                    failed: failedCount,
                    inProgress: true
                });

                if (i < openPositions.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            console.log('[EXIT_TIME_FIX] Update complete:', {
                successCount,
                failedCount,
                totalProcessed: openPositions.length
            });

            setExitTimeFixResult({
                success: failedCount === 0,
                message: `Updated ${successCount} positions to exit in 5 minutes.${failedCount > 0 ? ` ${failedCount} failed.` : ''}`,
                updated: successCount,
                failed: failedCount,
                details: results,
                inProgress: false
            });

            toast({
                title: "Exit Times Updated",
                description: `${successCount} positions will now exit in approximately 5 minutes${failedCount > 0 ? `. ${failedCount} failed to update.` : ''}`,
                variant: failedCount > 0 ? "destructive" : "default"
            });

        } catch (error) {
            console.error('[EXIT_TIME_FIX] Error fixing exit times:', error);
            console.error('[EXIT_TIME_FIX] Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            
            setExitTimeFixResult({
                success: false,
                message: `Failed to fix exit times: ${error.message || 'Unknown error'}`,
                error: error.message,
                inProgress: false
            });

            toast({
                title: "Update Failed",
                description: error.message || 'An unknown error occurred',
                variant: "destructive"
            });
        } finally {
            setFixingExitTimes(false);
        }
    };

    const handleRepairHistoricalPerformance = async () => {
        if (!tradingMode) {
            toast({
                title: "Error",
                description: "No trading mode selected. Please select testnet or live mode first.",
                variant: "destructive",
            });
            return;
        }

        if (!confirm(`This will repair all HistoricalPerformance records for ${tradingMode} mode using actual Trade data. This operation may take some time. Continue?`)) {
            return;
        }

        setRepairStatus({ loading: true, message: 'Repairing historical performance data...' });

        try {
            console.log('[DataRecovery] Calling repairHistoricalPerformance with:', {
                mode: tradingMode,
                daysBack: 30
            });

            const response = await base44.functions.invoke('repairHistoricalPerformance', {
                mode: tradingMode,
                daysBack: 30
            });

            console.log('[DataRecovery] Repair response:', response);

            const data = response.data;

            if (data.success) {
                setRepairStatus({
                    loading: false,
                    message: `✅ Repair complete! Hourly: ${data.hourlyRepaired || 0}, Daily: ${data.dailyRepaired || 0}`
                });
                toast({
                    title: "Repair Complete",
                    description: `Repaired ${data.hourlyRepaired || 0} hourly and ${data.dailyRepaired || 0} daily snapshots.`,
                });
                
                await refreshWallet();
            } else {
                throw new Error(data.error || 'Repair failed');
            }
        } catch (error) {
            console.error('[DataRecovery] Error repairing historical performance:', error);
            const errorMessage = error?.response?.data?.error || error.message || 'Unknown error';
            setRepairStatus({
                loading: false,
                message: `❌ Error: ${errorMessage}`
            });
            toast({
                title: "Repair Failed",
                description: errorMessage,
                variant: "destructive",
            });
        } finally {
            fetchLatestHistoricalPerformance();
        }
    };


    if (isInitializing) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                <p className="mt-4 text-lg text-gray-700 dark:text-gray-300">Loading backfill status...</p>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">Data Recovery & Diagnostics</h1>
                {results.length > 0 || debugOutput.length > 0 || investigationResults || deleteResult || historicalRebuildResult || rebuildProgress.isRunning || exitTimeFixResult || repairStatus.message ? (
                    <Button onClick={clearResults} variant="outline" size="sm">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear Results
                    </Button>
                ) : null}
            </div>

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                    These tools help diagnose and fix data integrity issues. Use with caution and always backup your data first.
                </AlertDescription>
            </Alert>

            <BaselineSnapshotPanel />

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center">
                            <Database className="mr-2 h-5 w-5" />
                            Trade History Integrity Check
                        </CardTitle>
                        <CardDescription>
                            Analyze trade history storage and identify potential data loss issues
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button 
                            onClick={checkTradeHistoryIntegrity}
                            disabled={isChecking}
                            variant="outline"
                        >
                            {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                            Check Trade History Integrity
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center">
                            <RefreshCw className="mr-2 h-5 w-5" />
                            Fix Orphaned Combinations
                        </CardTitle>
                        <CardDescription>
                            Remove trade history from deleted/non-existent strategy combinations
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button 
                            onClick={fixOrphanedCombinations}
                            disabled={isRecovering}
                            variant="destructive"
                        >
                            {isRecovering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Clean Up Orphaned Trades
                        </Button>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center">
                            <Scale className="mr-2 h-5 w-5" />
                            Wallet State Reconciliation
                        </CardTitle>
                        <CardDescription>
                            Virtual wallet functionality has been removed. Only testnet and live modes are supported.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button 
                            onClick={handleReconcileWalletState}
                            disabled={isReconcilingWallet}
                            variant="secondary"
                        >
                            {isReconcilingWallet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Reconcile Wallet State
                        </Button>
                        
                        <Button 
                            onClick={handleReconcileWallet}
                            disabled={isReconciling}
                            variant="outline"
                            className="ml-2"
                        >
                            {isReconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Legacy Balance Reconcile
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <ExitTimeFixer />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Force Exit All Open Positions
                    </CardTitle>
                    <CardDescription>
                        Update all currently open positions to exit in 5 minutes from their entry time. 
                        Use this to force-close positions that might be stuck or have invalid exit configurations.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                                    Warning: This will force ALL currently open positions to close.
                                </p>
                                <p className="text-sm text-amber-700 dark:text-amber-300">
                                    All open positions (status 'open' or 'trailing') will be updated to have a 5-minute time-based exit relative to their entry.
                                    The AutoScanner will then process these updates and close them on its next cycle. This action cannot be easily undone.
                                </p>
                            </div>
                        </div>
                    </div>

                    <Button
                        onClick={handleFixOpenPositionsExitTime}
                        disabled={fixingExitTimes}
                        variant="destructive"
                        className="w-full"
                    >
                        {fixingExitTimes ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {exitTimeFixResult?.inProgress ? exitTimeFixResult.message : 'Updating Exit Times...'}
                            </>
                        ) : (
                            <>
                                <Clock className="mr-2 h-4 w-4" />
                                Force Exit All Open Positions in 5 Minutes
                            </>
                        )}
                    </Button>

                    {exitTimeFixResult && !exitTimeFixResult.inProgress && (
                        <div className={`rounded-lg p-4 ${
                            exitTimeFixResult.success 
                                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' 
                                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                        }`}>
                            <p className={`text-sm font-medium ${
                                exitTimeFixResult.success 
                                    ? 'text-green-900 dark:text-green-100' 
                                    : 'text-red-900 dark:text-red-100'
                            }`}>
                                {exitTimeFixResult.message}
                            </p>
                            {exitTimeFixResult.updated > 0 && (
                                <p className="text-sm text-green-700 dark:text-green-300 mt-2">
                                    ✅ {exitTimeFixResult.updated} positions updated successfully
                                </p>
                            )}
                            {exitTimeFixResult.failed > 0 && (
                                <p className="text-sm text-red-700 dark:text-red-300 mt-2">
                                    ❌ {exitTimeFixResult.failed} positions failed to update
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>


            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                <CardHeader>
                    <CardTitle className="text-lg font-medium text-gray-900 dark:text-white p-6 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5" />
                            Historical Commission Migration
                        </div>
                    </CardTitle>
                    <CardDescription className="px-6 pt-2">
                        Apply 0.1% trading commission per leg (0.2% round-trip) to ALL historical trades. 
                        This will update P&L calculations to include realistic trading costs.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Trades Processed</div>
                            <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{commissionMigrationState.tradesProcessed}</div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">Current Batch</div>
                            <div className="text-lg font-bold text-purple-900 dark:text-purple-100">{commissionMigrationState.currentBatch}</div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Errors</div>
                            <div className="text-lg font-bold text-red-900 dark:text-red-100">{commissionMigrationState.errors.length}</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Wallet Updated</div>
                            <div className="text-lg font-bold text-green-900 dark:text-green-100">
                                {commissionMigrationState.walletUpdated ? "✅" : "⏳"}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            onClick={handleStartCommissionMigration}
                            disabled={commissionMigrationState.isRunning || commissionMigrationState.isComplete}
                            className="bg-orange-600 hover:bg-orange-700 text-white disabled:bg-gray-400 flex-1"
                        >
                            {commissionMigrationState.isRunning ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Processing Batch {commissionMigrationState.currentBatch}...
                                </>
                            ) : (
                                <>
                                    <DollarSign className="h-4 w-4" />
                                    {commissionMigrationState.tradesProcessed > 0 ? 'Continue Migration' : 'Start Commission Migration'}
                                </>
                            )}
                        </Button>
                        
                        <Button
                            onClick={handleResetCommissionMigration}
                            disabled={commissionMigrationState.isRunning}
                            variant="outline"
                        >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Reset
                        </Button>
                    </div>

                    <div className="text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            commissionMigrationState.status === "Complete ✅" ? 'bg-green-100 text-green-800' :
                            commissionMigrationState.status.includes("Error") ? 'bg-red-100 text-red-800' :
                            commissionMigrationState.status === "Processing..." ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                        }`}>
                            Status: {commissionMigrationState.status}
                        </span>
                    </div>

                    {commissionMigrationState.errors.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
                            <div className="text-sm text-red-600 dark:text-red-400">
                                <strong>Recent Errors ({commissionMigrationState.errors.length}):</strong>
                                <ul className="mt-2 list-disc list-inside">
                                    {commissionMigrationState.errors.slice(-3).map((error, index) => (
                                        <li key={index}>{error}</li>
                                    ))}
                                    {commissionMigrationState.errors.length > 3 && <li>...</li>}
                                </ul>
                            </div>
                        </div>
                    )}

                    <div className="text-sm text-gray-600 dark:text-gray-400 bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
                        <strong>Important:</strong> This migration applies a 0.1% commission fee on both entry and exit (total 0.2% per round-trip trade). 
                        All historical trade P&L will be recalculated and your wallet's aggregate statistics will be updated. 
                        The process can be safely interrupted and resumed.
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                <CardHeader>
                    <CardTitle className="text-lg font-medium text-gray-900 dark:text-white p-6 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Historical Performance Backfill & Rebuild
                        </div>
                    </CardTitle>
                    <CardDescription className="px-6 pt-2">
                        Use these tools to fix or populate historical performance data from all existing trades.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Trades Processed</div>
                            <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{backfillState.tradesProcessed}</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Snapshots Created</div>
                            <div className="text-lg font-bold text-green-900 dark:text-green-100">{backfillState.snapshotsCreated}</div>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-yellow-600 dark:text-yellow-400 uppercase tracking-wide">Snapshots Updated</div>
                            <div className="text-lg font-bold text-yellow-900 dark:text-yellow-100">{backfillState.snapshotsUpdated}</div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded">
                            <div className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Duplicates Removed</div>
                            <div className="text-lg font-bold text-red-900 dark:text-red-100">{backfillState.duplicatesRemoved}</div>
                        </div>
                    </div>

                    {rebuildProgress.isRunning && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                <span className="font-medium text-blue-800 dark:text-blue-200">
                                    Rebuild in Progress
                                </span>
                            </div>
                            <div className="text-sm text-blue-700 dark:text-blue-300">
                                <div>Batch: {rebuildProgress.totalCalls}</div>
                                <div>Phase: {rebuildProgress.phase}</div>
                                <div>Status: {rebuildProgress.message}</div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            onClick={handleBackfillHistoricalData}
                            disabled={backfillState.isRunning || backfillState.isComplete || rebuildingHistorical || rebuildProgress.isRunning || auditLoading || repairStatus.loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400 flex-1"
                        >
                            {backfillState.isRunning && backfillState.status.includes('Backfilling') ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Processing Batch...
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4" />
                                    {backfillState.tradesProcessed > 0 ? 'Continue Backfill (Batch)' : 'Backfill Missing Performance Data'}
                                </>
                            )}
                        </Button>
                        
                        <Button
                            onClick={handleFullRebuildHistoricalData}
                            disabled={rebuildingHistorical || backfillState.isRunning || rebuildProgress.isRunning || auditLoading || repairStatus.loading}
                            variant="destructive"
                            className="flex-1"
                        >
                            {rebuildingHistorical || rebuildProgress.isRunning ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Full Rebuild in Progress...
                                </>
                            ) : (
                                <>
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    Full Rebuild
                                </>
                            )}
                        </Button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            onClick={handleAuditAndFix}
                            disabled={auditLoading || backfillState.isRunning || rebuildProgress.isRunning || rebuildingHistorical || repairStatus.loading}
                            variant="secondary"
                            className="flex-1"
                        >
                            {auditLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Auditing & Fixing…
                                </>
                            ) : (
                                <>
                                    <Search className="mr-2 h-4 w-4" />
                                    Audit & Fix Missing Fields
                                </>
                            )}
                        </Button>
                    </div>

                    {historicalRebuildResult && (
                        <Alert className={historicalRebuildResult.type === 'error' ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30" : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30"}>
                            {historicalRebuildResult.type === 'error' ? 
                                <AlertTriangleIcon className="h-4 w-4 text-red-600 dark:text-red-400" /> :
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                            }
                            <AlertTitle className={historicalRebuildResult.type === 'error' ? "text-red-800 dark:text-red-300" : "text-green-800 dark:text-green-300"}>
                                {historicalRebuildResult.type === 'error' ? 'Full Rebuild Failed' : 'Full Rebuild Successful'}
                            </AlertTitle>
                            <AlertDescription className={historicalRebuildResult.type === 'error' ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
                                {historicalRebuildResult.message}
                                {historicalRebuildResult.details && (
                                    <p className="mt-2 text-sm">{historicalRebuildResult.details}</p>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            backfillState.status === "Complete ✅" ? 'bg-green-100 text-green-800' :
                            backfillState.status.includes("Error") ? 'bg-red-100 text-red-800' :
                            backfillState.status.includes("Progress") || backfillState.status.includes("Backfilling") || backfillState.status.includes("limited") ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                        }`}>
                            Status: {backfillState.status}
                        </span>
                    </div>

                    {backfillState.error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
                            <div className="text-sm text-red-600 dark:text-red-400">
                                <strong>Error:</strong> {backfillState.error}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        {backfillState.currentCumulativeState && (
                            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                                <div className="mt-3 pt-3">
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Cumulative P&L (Backfill Session):</div>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className={`text-lg font-bold ${
                                            (backfillState.currentCumulativeState.total_realized_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                        }`}>
                                            P&L: ${(backfillState.currentCumulativeState.total_realized_pnl || 0).toLocaleString('en-US', { 
                                                minimumFractionDigits: 2, 
                                                maximumFractionDigits: 2 
                                            })}
                                        </div>
                                        <div>
                                            Trades: ${(backfillState.currentCumulativeState.total_trades_count || 0).toLocaleString()} <br/>
                                            Wins: ${(backfillState.currentCumulativeState.winning_trades_count || 0).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {backfillState.lastProcessedTimestamp && (
                            <div className="text-xs text-gray-500">
                                Last Processed Trade Timestamp: {new Date(backfillState.lastProcessedTimestamp).toLocaleString()}
                            </div>
                        )}
                    </div>


                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            onClick={handleResetBackfill}
                            disabled={backfillState.isRunning || rebuildingHistorical || rebuildProgress.isRunning || auditLoading || repairStatus.loading}
                            className="flex items-center gap-2"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset Backfill & Rebuild History
                        </Button>
                    </div>

                    <div className="text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                        <strong>Instructions:</strong>
                        <ol className="list-decimal list-inside mt-1 space-y-1">
                            <li><strong>Backfill (Incremental):</strong> Click "Backfill Missing Performance Data" to fix recent data. This processes in batches and is safe to run anytime.</li>
                            <li><strong>Full Rebuild (Destructive):</strong> Click "Full Rebuild" to delete ALL historical performance data and recreate it from scratch. Use this for major data corruption.</li>
                            <li><strong>Audit & Fix:</strong> Click "Audit & Fix Missing Fields" to scan for and repair missing P&L calculation fields in existing snapshots without deleting them.</li>
                            <li><strong>Reset:</strong> Click "Reset" to clear all historical performance data if you want to start fresh without rebuilding immediately.</li>
                        </ol>
                    </div>

                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold">Debug Console</h4>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => setDebugOutput([])}>
                                    Clear
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1"
                                    onClick={() => {
                                        const text = (debugOutput || []).join('\n');
                                        navigator.clipboard.writeText(text);
                                        appendLog('Logs copied to clipboard');
                                    }}
                                >
                                    <Copy className="h-4 w-4" />
                                    Copy
                                </Button>
                            </div>
                        </div>
                        <div className="bg-black/90 text-green-400 font-mono text-xs rounded-md p-3 h-48 overflow-auto">
                            {(debugOutput || []).length === 0 ? (
                                <div className="text-gray-400">No logs yet. Run Backfill or Full Rebuild to see debug details here.</div>
                            ) : (
                                (debugOutput || []).map((line, idx) => (
                                    <pre key={idx} className="whitespace-pre-wrap leading-5">{line}</pre>
                                ))
                            )}
                        </div>
                    </div>

                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart2 className="h-5 w-5" />
                        Repair Historical Performance
                    </CardTitle>
                    <CardDescription>
                        Fix HistoricalPerformance records by recalculating from Trade data. 
                        This will repair data for the current trading mode: <strong>{tradingMode || 'Not selected'}</strong>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!tradingMode && (
                        <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
                            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                            <AlertTitle className="text-yellow-800 dark:text-yellow-300">No Trading Mode Selected</AlertTitle>
                            <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                                Please select a trading mode (testnet or live) using the toggle in the header before running this repair.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            This will repair hourly and daily HistoricalPerformance snapshots. It works by:
                        </p>
                        <ul className="list-disc list-inside text-sm text-blue-700 dark:text-blue-300 mt-2 space-y-1">
                            <li>Grouping trades by hour and day.</li>
                            <li>Calculating correct period_pnl for each snapshot.</li>
                            <li>Updating cumulative metrics chronologically.</li>
                            <li>Creating missing snapshots where needed.</li>
                            <li>Currently limited to the last 30 days for safety and performance.</li>
                        </ul>
                    </div>

                    <Button
                        onClick={handleRepairHistoricalPerformance}
                        disabled={repairStatus.loading || !tradingMode}
                        className="w-full"
                    >
                        {repairStatus.loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Repairing...
                            </>
                        ) : (
                            <>
                                <BarChart2 className="mr-2 h-4 w-4" />
                                Repair Historical Performance (Last 30 Days)
                            </>
                        )}
                    </Button>

                    {repairStatus.message && (
                        <div className={`p-3 rounded-lg ${
                            repairStatus.message.includes('✅') 
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                        }`}>
                            <p className="text-sm font-medium">{repairStatus.message}</p>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle className="text-red-600">🗑️ Purge Trades</CardTitle>
                    <CardDescription>
                        This function is specifically designed to remove duplicate trades from your historical data. 
                        It processes trades in batches to prevent timeouts.
                        <strong className="text-red-600"> This action cannot be undone!</strong>
                        <br />
                        <strong>Note:</strong> You may need to click the button multiple times until no more duplicates are found.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30">
                        <AlertTriangleIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
                        <AlertTitle className="text-red-800 dark:text-red-300">Batch Processing Required</AlertTitle>
                        <AlertDescription className="text-red-700 dark:text-red-400">
                            This function processes trades in batches to avoid timeouts. 
                            Click "Purge Duplicates (Batch)" repeatedly until no more duplicates remain.
                        </AlertDescription>
                    </Alert>
                    
                    <Button 
                        onClick={handlePurgeAllTrades}
                        disabled={tradePurgeStatus.isRunning}
                        variant="destructive"
                        className="w-full"
                    >
                        {tradePurgeStatus.isRunning ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Purging Batch...
                            </>
                        ) : (
                            <>
                                <Trash2 className="h-4 w-4 mr-2" />
                                {tradePurgeStatus.results?.hasMoreTrades !== false ? 
                                    'Purge Duplicates (Batch)' : 
                                    'Purge Duplicates'
                                }
                            </>
                        )}
                    </Button>
                    
                    {tradePurgeStatus.progress && (
                        <div className="text-sm text-muted-foreground">
                            {tradePurgeStatus.progress}
                        </div>
                    )}
                    
                    {tradePurgeStatus.error && (
                        <Alert className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30">
                            <AlertTriangleIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <AlertTitle className="text-red-800 dark:text-red-300">Purge Failed</AlertTitle>
                            <AlertDescription className="text-red-700 dark:text-red-400">
                                {tradePurgeStatus.error}
                            </AlertDescription>
                        </Alert>
                    )}
                    
                    {tradePurgeStatus.results && (
                        <Alert className={tradePurgeStatus.results.hasMoreTrades ? 
                            "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/30" : 
                            "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30"
                        }>
                            {tradePurgeStatus.results.hasMoreTrades ? 
                                <AlertTriangleIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" /> :
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                            }
                            <AlertTitle className={tradePurgeStatus.results.hasMoreTrades ? 
                                "text-orange-800 dark:text-orange-300" : 
                                "text-green-800 dark:text-green-300"
                            }>
                                {tradePurgeStatus.results.hasMoreTrades ? 
                                    'Batch Purge Successful' : 
                                    'Purge Complete'
                                }
                            </AlertTitle>
                            <AlertDescription className={tradePurgeStatus.results.hasMoreTrades ? 
                                "text-orange-700 dark:text-orange-400" : 
                                "text-green-700 dark:text-green-300"
                            }>
                                <div className="space-y-2 mt-2">
                                    {typeof tradePurgeStatus.results.remainingCount === 'number' && (
                                        <div className="text-base font-semibold">
                                            Trades Remaining: 
                                            <span className="text-lg font-bold ml-2">
                                                {tradePurgeStatus.results.remainingCount.toLocaleString()}
                                            </span>
                                            <span className="text-sm text-muted-foreground">
                                                {' '}/ {tradePurgeStatus.results.initialCount?.toLocaleString() || 'Total unknown'}
                                            </span>
                                        </div>
                                    )}
                                    <div>Duplicates Deleted This Batch: <strong>{tradePurgeStatus.results.tradesDeleted.toLocaleString()}</strong></div>
                                    {tradePurgeStatus.results.hasMoreTrades && (
                                        <div className="text-orange-600 dark:text-orange-300 font-medium mt-2">
                                            ⚠️ More duplicates remain. Click "Purge Duplicates (Batch)" again to continue.
                                        </div>
                                    )}
                                    <div className="text-xs mt-2">{tradePurgeStatus.results.message}</div>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
                <CardHeader>
                    <CardTitle className="text-red-800 dark:text-red-200 flex items-center gap-2">
                        <Trash2 className="h-5 w-5" />
                        Delete Historical Trades
                    </CardTitle>
                    <CardDescription className="text-red-700 dark:text-red-300">
                        ⚠️ DESTRUCTIVE OPERATION: Permanently delete all trade records closed before a specific date.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4">
                        <div className="flex items-start">
                            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 mr-3 flex-shrink-0" />
                            <div className="text-sm text-yellow-800 dark:text-yellow-200">
                                <p className="font-medium mb-1">Before proceeding:</p>
                                <ul className="list-disc list-inside space-y-1">
                                    <li>This operation cannot be undone</li>
                                    <li>Consider backing up your data first</li>
                                    <li>This will affect analytics and historical performance charts</li>
                                    <li>Only trades with an exit_timestamp before the cutoff date will be deleted</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <Label htmlFor="delete-date" className="text-sm font-medium text-red-800 dark:text-red-200">
                                Delete trades closed before:
                            </Label>
                            <Input
                                id="delete-date"
                                type="date"
                                value={deleteDate}
                                onChange={(e) => setDeleteDate(e.target.value)}
                                className="mt-1"
                                disabled={isAutoDeleting || deleteLoading}
                            />
                        </div>
                        
                        {!isAutoDeleting ? (
                            <Button 
                                onClick={startAutoDelete}
                                disabled={!deleteDate}
                                variant="destructive"
                                className="bg-red-600 hover:bg-red-700"
                            >
                                <Play className="mr-2 h-4 w-4" />
                                Start Auto-Deletion
                            </Button>
                        ) : (
                            <Button 
                                onClick={stopAutoDelete}
                                variant="secondary"
                            >
                                {deleteLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Stop Deletion
                            </Button>
                        )}
                    </div>
                    
                    {totalDeleted > 0 && (
                        <div className="text-center font-semibold text-green-700 dark:text-green-300">
                            Total Deleted So Far: {totalDeleted.toLocaleString()}
                        </div>
                    )}

                    {deleteResult && (
                        <Alert className={deleteResult.errors && deleteResult.errors.length > 0 ? "border-orange-200 bg-orange-50 dark:bg-orange-950" : "border-green-200 bg-green-50 dark:bg-green-950"}>
                            {deleteResult.errors && deleteResult.errors.length > 0 ? 
                                <AlertTriangleIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" /> :
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            }
                            <AlertTitle className={deleteResult.errors && deleteResult.errors.length > 0 ? "text-orange-800 dark:text-orange-200" : "text-green-800 dark:text-green-200"}>
                                {isAutoDeleting && deleteResult.hasMoreToDelete ? "Processing Batch..." : deleteResult.hasMoreToDelete ? "Batch Processed" : "Final Batch Complete"}
                            </AlertTitle>
                            <AlertDescription className={deleteResult.errors && deleteResult.errors.length > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300"}>
                                {deleteResult.message}
                                <div className="mt-2 text-sm space-y-1">
                                    <p>• Trades in this batch: {deleteResult.processedInBatch?.toLocaleString()}</p>
                                    <p>• Successfully deleted: {deleteResult.deletedCount?.toLocaleString()}</p>
                                    {deleteResult.errors && deleteResult.errors.length > 0 && (
                                       <p className="text-red-500">• Errors in this batch: {deleteResult.errors.length}</p>
                                    )}
                                    {isAutoDeleting && deleteResult.hasMoreToDelete && (
                                        <p className="text-blue-500 font-medium mt-2">
                                            <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                                            Automatically starting next batch...
                                        </p>
                                    )}
                                </div>
                                {deleteResult.errors && deleteResult.errors.length > 0 && (
                                    <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-md max-h-40 overflow-y-auto">
                                        <h4 className="font-bold text-xs">Error Samples:</h4>
                                        <ul className="text-xs font-mono list-disc list-inside">
                                            {deleteResult.errors.map((err, i) => (
                                                <li key={i}>{err.tradeId}: {err.error}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        🔍 Trade Data Investigation
                    </CardTitle>
                    <CardDescription>
                        Analyze the 4+ million trades to understand their source and composition.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Button 
                        onClick={handleInvestigateTradeData}
                        disabled={isInvestigating}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        {isInvestigating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <Search className="mr-2 h-4 w-4" />
                                Investigate Trade Data
                            </>
                        )}
                    </Button>
                    
                    {investigationResults && (
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-4">
                            <h3 className="font-bold text-lg">Investigation Results</h3>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-blue-100 dark:bg-blue-900/20 p-3 rounded">
                                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase">Total Trades</div>
                                    <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{(investigationResults.summary.totalTrades || 0).toLocaleString()}</div>
                                </div>
                                <div className="bg-green-100 dark:bg-green-900/20 p-3 rounded">
                                    <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase">Unique Trade IDs</div>
                                    <div className="text-lg font-bold text-green-900 dark:text-green-100">{(investigationResults.summary.uniqueTradeIds || 0).toLocaleString()}</div>
                                </div>
                                <div className="bg-red-100 dark:bg-red-900/20 p-3 rounded">
                                    <div className="text-xs font-medium text-red-600 dark:text-red-400 uppercase">Duplicates</div>
                                    <div className="text-lg font-bold text-red-900 dark:text-red-100">{(investigationResults.summary.duplicates || 0).toLocaleString()}</div>
                                </div>
                                <div className="bg-yellow-100 dark:bg-yellow-900/20 p-3 rounded">
                                    <div className="text-xs font-medium text-yellow-600 dark:text-yellow-400 uppercase">Last 24h</div>
                                    <div className="text-lg font-bold text-yellow-900 dark:text-yellow-100">{(investigationResults.summary.tradesLast24h || 0).toLocaleString()}</div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-medium mb-2">Top Strategies (by trade count)</h4>
                                    <div className="space-y-1 text-sm">
                                        {(investigationResults.topStrategies || []).slice(0, 5).map(([strategy, count]) => (
                                            <div key={strategy} className="flex justify-between">
                                                <span className="truncate">{strategy}</span>
                                                <span className="font-mono">{count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <div>
                                    <h4 className="font-medium mb-2">Time Range</h4>
                                    <div className="space-y-1 text-sm">
                                        <div><strong>Earliest:</strong> {investigationResults.timeRange.earliest ? new Date(investigationResults.timeRange.earliest).toLocaleDateString() : 'N/A'}</div>
                                        <div><strong>Latest:</strong> {investigationResults.timeRange.latest ? new Date(investigationResults.timeRange.latest).toLocaleDateString() : 'N/A'}</div>
                                        <div><strong>Last 7d:</strong> ${(investigationResults.timeRange.last7d || 0).toLocaleString()}</div>
                                        <div><strong>Last 30d:</strong> ${(investigationResults.timeRange.last30d || 0).toLocaleString()}</div>
                                    </div>
                                </div>
                            </div>
                            
                            {investigationResults.duplicateSamples && investigationResults.duplicateSamples.length > 0 && (
                                <div>
                                    <h4 className="font-medium mb-2 text-red-600">Duplicate Trade ID Samples</h4>
                                    <div className="bg-red-50 p-2 rounded text-xs font-mono">
                                        {investigationResults.duplicateSamples.map((sample, i) => (
                                            <div key={i}>
                                                ID: {sample.trade_id} (Count: {sample.count})
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart2 className="h-5 w-5" />
                        Current Aggregated Performance (from DB)
                    </CardTitle>
                    <CardDescription>
                        Shows the latest complete historical performance record saved in the database.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isFetchingHistoricalPerformance ? (
                        <div className="flex items-center text-gray-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading latest performance...
                        </div>
                    ) : fetchedHistoricalPerformance ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                            <div className="col-span-full pb-2 border-b border-gray-200 dark:border-gray-700">
                                <span className="font-medium">Last Updated:</span>{' '}
                                {new Date(fetchedHistoricalPerformance.snapshot_timestamp).toLocaleString()}
                            </div>
                            <div>
                                <span className="font-medium">Total Trades:</span>{' '}
                                <Badge variant="secondary">{fetchedHistoricalPerformance.cumulative_trade_count?.toLocaleString() || 'N/A'}</Badge>
                            </div>
                            <div>
                                <span className="font-medium">Winning Trades:</span>{' '}
                                <Badge className="bg-green-500 text-white">{fetchedHistoricalPerformance.cumulative_winning_trades?.toLocaleString() || 'N/A'}</Badge>
                            </div>
                            <div>
                                <span className="font-medium">Losing Trades:</span>{' '}
                                <Badge className="bg-red-500 text-white">{(fetchedHistoricalPerformance.cumulative_trade_count - fetchedHistoricalPerformance.cumulative_winning_trades)?.toLocaleString() || 'N/A'}</Badge>
                            </div>
                            <div>
                                <span className="font-medium">Total Realized P&L:</span>{' '}
                                <span className={`font-bold ${
                                    (fetchedHistoricalPerformance.cumulative_realized_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                    ${(fetchedHistoricalPerformance.cumulative_realized_pnl || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div>
                                <span className="font-medium">Gross Profit:</span>{' '}
                                <span className="font-bold text-green-600">
                                    ${(fetchedHistoricalPerformance.cumulative_gross_profit || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div>
                                <span className="font-medium">Gross Loss:</span>{' '}
                                <span className="font-bold text-red-600">
                                    ${(fetchedHistoricalPerformance.cumulative_gross_loss || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            {fetchedHistoricalPerformance.profit_factor !== undefined && (
                                <div>
                                    <span className="font-medium">Profit Factor:</span>{' '}
                                    <Badge variant="outline">{(fetchedHistoricalPerformance.profit_factor || 0).toFixed(2)}</Badge>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-gray-500">No historical performance data found. Run the backfill process above to generate it.</p>
                    )}
                </CardContent>
            </Card>

            {results.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Diagnostic Results</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                            {results.map((result, index) => (
                                <div key={index} className={result.startsWith('❌') ? 'text-red-600' : result.startsWith('✅') ? 'text-green-600' : ''}>
                                    {result}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
