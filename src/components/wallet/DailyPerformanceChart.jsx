
import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from "@/components/providers/WalletProvider";
import { queueEntityCall } from '@/components/utils/apiQueue';

// Add a robust debug logger that writes to console and window.__HP_CHART_LOGS
const hpDebug = {
  log: (...args) => {
    //try { console.log('[HP_CHART]', ...args); } catch (_) {}
    try {
      if (typeof window !== 'undefined') {
        window.__HP_CHART_LOGS = window.__HP_CHART_LOGS || [];
        const safe = args.map((a) => {
          if (a === undefined) return 'undefined';
          if (a === null) return null;
          if (typeof a === 'object') {
            try { return JSON.parse(JSON.stringify(a)); } catch { return String(a); }
          }
          return a;
        });
        window.__HP_CHART_LOGS.push(safe);
      }
    } catch (_) {}
  }
};

// DEPRECATED: No longer used - calculations now done directly from trades
const normalizeWithBaseline = (recordsAsc = [], baselineCum = null, preferPeriodFields = true) => {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  if (!Array.isArray(recordsAsc) || recordsAsc.length === 0) return [];

  const out = [];
  for (let i = 0; i < recordsAsc.length; i++) {
    const curr = recordsAsc[i] || {};

    // Previous cumulative snapshot (either prior record in array or given baseline)
    const prevCum = i > 0
      ? {
          pnl: num(recordsAsc[i - 1]?.cumulative_realized_pnl),
          count: num(recordsAsc[i - 1]?.cumulative_trade_count),
          wins: num(recordsAsc[i - 1]?.cumulative_winning_trades),
          gp: num(recordsAsc[i - 1]?.cumulative_gross_profit),
          gl: num(recordsAsc[i - 1]?.cumulative_gross_loss),
        }
      : (baselineCum
          ? {
              pnl: num(baselineCum.cumulative_realized_pnl),
              count: num(baselineCum.cumulative_trade_count),
              wins: num(baselineCum.cumulative_winning_trades),
              gp: num(baselineCum.cumulative_gross_profit),
              gl: num(baselineCum.cumulative_gross_loss),
            }
          : null);

    // Explicit fields presence
    const hasExplicitPeriodPnl = Number.isFinite(curr?.period_pnl);
    const hasExplicitPeriodCount = Number.isFinite(curr?.period_trade_count);
    const hasExplicitPeriodWins = Number.isFinite(curr?.period_winning_trades);
    const hasExplicitPeriodGp = Number.isFinite(curr?.period_gross_profit);
    const hasExplicitPeriodGl = Number.isFinite(curr?.period_gross_loss);

    let period_pnl, period_trade_count, period_winning_trades, period_gross_profit, period_gross_loss;

    if (!preferPeriodFields) { // DAILY PATH: always compute deltas from cumulative
        if (prevCum) {
            period_pnl = num(curr.cumulative_realized_pnl) - prevCum.pnl;
            period_trade_count = Math.max(0, num(curr.cumulative_trade_count) - prevCum.count);
            period_winning_trades = Math.max(0, num(curr.cumulative_winning_trades) - prevCum.wins);
            period_gross_profit = num(curr.cumulative_gross_profit) - prevCum.gp;
            period_gross_loss = num(curr.cumulative_gross_loss) - prevCum.gl;
        } else {
            // CRITICAL FIX: If no previous cumulative or baseline for the first item,
            // trust the existing period_* fields if available, otherwise default to 0.
            // This prevents the first bar showing the *cumulative* P&L as the *period* P&L.
            period_pnl = hasExplicitPeriodPnl ? num(curr.period_pnl) : 0;
            period_trade_count = hasExplicitPeriodCount ? num(curr.period_trade_count) : 0;
            period_winning_trades = hasExplicitPeriodWins ? num(curr.period_winning_trades) : 0;
            period_gross_profit = hasExplicitPeriodGp ? num(curr.period_gross_profit) : 0;
            period_gross_loss = hasExplicitPeriodGl ? num(curr.period_gross_loss) : 0;
            hpDebug.log(`normalizeWithBaseline: Daily, no prevCum for first item. Using explicit period fields:`, { 
                id: curr.id, 
                snapshot: curr.snapshot_timestamp,
                pnl: period_pnl, 
                count: period_trade_count 
            });
        }
    } else { // HOURLY PATH: prefer explicit period_* when available
        if (hasExplicitPeriodPnl || hasExplicitPeriodCount || hasExplicitPeriodWins || hasExplicitPeriodGp || hasExplicitPeriodGl) {
            period_pnl = hasExplicitPeriodPnl ? num(curr.period_pnl) : 0;
            period_trade_count = hasExplicitPeriodCount ? Math.max(0, num(curr.period_trade_count)) : 0;
            period_winning_trades = hasExplicitPeriodWins ? Math.max(0, num(curr.period_winning_trades)) : 0;
            period_gross_profit = hasExplicitPeriodGp ? num(curr.period_gross_profit) : 0;
            period_gross_loss = hasExplicitPeriodGl ? num(curr.period_gross_loss) : 0;
        } else if (prevCum) {
            // Fallback: If preferPeriodFields is true but no explicit period values, compute deltas
            period_pnl = num(curr.cumulative_realized_pnl) - prevCum.pnl;
            period_trade_count = Math.max(0, num(curr.cumulative_trade_count) - prevCum.count);
            period_winning_trades = Math.max(0, num(curr.cumulative_winning_trades) - prevCum.wins);
            period_gross_profit = num(curr.cumulative_gross_profit) - prevCum.gp;
            period_gross_loss = num(curr.cumulative_gross_loss) - prevCum.gl;
        } else {
            // Last resort: No baseline/previous and no explicit period values.
            period_pnl = 0;
            period_trade_count = 0;
            period_winning_trades = 0;
            period_gross_profit = 0;
            period_gross_loss = 0;
        }
    }

    out.push({
      ...curr,
      period_pnl,
      period_trade_count,
      period_winning_trades,
      period_gross_profit,
      period_gross_loss,
    });
  }
  return out;
};


export default function DailyPerformanceChart({
  trades = [],
  timeframe,
  onTimeframeChange,
  dailyPerformanceHistory = [], // DEPRECATED: no longer used
  hourlyPerformanceHistory = [], // DEPRECATED: no longer used
  walletSummary = null,
  onSummaryStatsChange 
}) {
  const { isLiveMode } = useTradingMode();
  const { loading: walletLoading } = useWallet();

  // Filter trades by mode and ensure they have exit_timestamp (closed trades)
  const modeTrades = useMemo(() => {
    const mode = isLiveMode ? 'live' : 'testnet';
    const arr = Array.isArray(trades) 
      ? trades.filter(t => {
          const tradeMode = t?.trading_mode || 'testnet';
          const hasExit = t?.exit_timestamp != null;
          return tradeMode === mode && hasExit;
        })
      : [];
    return arr;
  }, [trades, isLiveMode]);

  // Helper to deduplicate trades based on unique characteristics
  const deduplicateTrades = useCallback((tradesArray) => {
    const seen = new Map();
    const uniqueTrades = [];
    
    tradesArray.forEach(trade => {
      if (!trade?.exit_timestamp) return;
      
      // Create a unique key based on trade characteristics
      // Using entry_price, exit_price, quantity, entry_timestamp, symbol, and strategy_name
      // Rounded values to handle floating point precision issues
      const entryPrice = Math.round((Number(trade.entry_price) || 0) * 10000) / 10000;
      const exitPrice = Math.round((Number(trade.exit_price) || 0) * 10000) / 10000;
      const quantity = Math.round((Number(trade.quantity_crypto) || Number(trade.quantity) || 0) * 1000000) / 1000000;
      const entryTs = trade.entry_timestamp ? new Date(trade.entry_timestamp).toISOString() : '';
      const symbol = trade.symbol || '';
      const strategy = trade.strategy_name || '';
      
      // Create unique key (allow 1 second tolerance for entry_timestamp to handle minor timing differences)
      const entryDate = entryTs ? new Date(entryTs) : null;
      const entryDateRounded = entryDate ? new Date(Math.floor(entryDate.getTime() / 1000) * 1000).toISOString() : '';
      const uniqueKey = `${symbol}|${strategy}|${entryPrice}|${exitPrice}|${quantity}|${entryDateRounded}`;
      
      // Keep the first occurrence (earliest by exit_timestamp, then by id if same)
      if (!seen.has(uniqueKey)) {
        seen.set(uniqueKey, trade);
        uniqueTrades.push(trade);
      } else {
        const existing = seen.get(uniqueKey);
        // If this trade has an earlier exit timestamp, replace it (this shouldn't happen often, but handle it)
        const existingExit = existing?.exit_timestamp ? new Date(existing.exit_timestamp).getTime() : 0;
        const currentExit = trade?.exit_timestamp ? new Date(trade.exit_timestamp).getTime() : 0;
        if (currentExit > 0 && (existingExit === 0 || currentExit < existingExit)) {
          // Remove old and add new
          const index = uniqueTrades.indexOf(existing);
          if (index >= 0) uniqueTrades.splice(index, 1);
          seen.set(uniqueKey, trade);
          uniqueTrades.push(trade);
        }
      }
    });
    
    if (seen.size < tradesArray.length) {
      // Deduplication complete
    }
    
    return uniqueTrades;
  }, []);

  // Helper to aggregate trades into time buckets
  const aggregateTradesIntoBuckets = useCallback((tradesArray, groupBy) => {
    // CRITICAL FIX: Deduplicate trades before aggregation to prevent inflated P&L
    const uniqueTrades = deduplicateTrades(tradesArray);
    const buckets = new Map();
    
    uniqueTrades.forEach(trade => {
      if (!trade?.exit_timestamp) return;
      
      const exitDate = new Date(trade.exit_timestamp);
      if (isNaN(exitDate.getTime())) return;
      
      let key;
      let timeKey;
      let displayLabel;
      
      if (groupBy === 'hour') {
        const hourStart = new Date(Date.UTC(
          exitDate.getUTCFullYear(),
          exitDate.getUTCMonth(),
          exitDate.getUTCDate(),
          exitDate.getUTCHours()
        ));
        key = hourStart.toISOString();
        timeKey = key;
        displayLabel = hourStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' +
                      hourStart.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, timeZone: 'UTC' });
      } else { // 'day'
        // CRITICAL: Use UTC date components to ensure consistent day grouping
        // This prevents the same day from appearing as multiple bars due to timezone issues
        const year = exitDate.getUTCFullYear();
        const month = exitDate.getUTCMonth();
        const date = exitDate.getUTCDate();
        
        const dayStart = new Date(Date.UTC(year, month, date));
        // Use ISO date string as key to ensure uniqueness (YYYY-MM-DD format)
        key = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
        timeKey = key;
        
        // Use the normalized dayStart for display to ensure consistency
        // Always use UTC to prevent timezone-based splitting
        displayLabel = dayStart.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          timeZone: 'UTC' 
        });
      }
      
      // CRITICAL: Ensure we don't create duplicate buckets for the same day
      // If a bucket already exists for this key, use it (don't create a new one)
      if (!buckets.has(key)) {
        buckets.set(key, {
          timeKey,
          displayLabel,
          totalPnl: 0,
          tradeCount: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
        });
      }
      
      const bucket = buckets.get(key);
      const pnl = Number(trade.pnl_usdt || 0);
      
      // Validate bucket exists (should always be true, but safety check)
      if (!bucket) {
        console.error(`[DailyPerformanceChart] ⚠️ Bucket missing for key: ${key}, trade: ${trade.id || 'unknown'}`);
        return; // Skip this trade if bucket is missing
      }
      
      bucket.tradeCount++;
      bucket.totalPnl += pnl;
      
      if (pnl > 0) {
        bucket.winningTrades++;
        bucket.grossProfit += pnl;
      } else if (pnl < 0) {
        bucket.grossLoss += Math.abs(pnl);
      }
    });
    
    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
      // For day buckets, parse YYYY-MM-DD format, for hour buckets use ISO string
      const aTime = groupBy === 'hour' ? new Date(a.timeKey).getTime() : new Date(a.timeKey + 'T00:00:00Z').getTime();
      const bTime = groupBy === 'hour' ? new Date(b.timeKey).getTime() : new Date(b.timeKey + 'T00:00:00Z').getTime();
      return aTime - bTime;
    });
    
    // CRITICAL: Log bucket information to debug duplicate day issue
    if (groupBy === 'day' && sortedBuckets.length > 0) {
      const dayCounts = new Map();
      sortedBuckets.forEach(b => {
        const count = dayCounts.get(b.displayLabel) || 0;
        dayCounts.set(b.displayLabel, count + 1);
      });
      
      const duplicates = Array.from(dayCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        console.error(`[DailyPerformanceChart] 🚨 DUPLICATE DAYS DETECTED:`, duplicates);
        console.error(`[DailyPerformanceChart] 🚨 This indicates a day grouping bug - same day appearing as multiple bars`);
        console.error(`[DailyPerformanceChart] 🚨 Bucket details:`, sortedBuckets.map(b => ({ 
          displayLabel: b.displayLabel, 
          timeKey: b.timeKey, 
          totalPnl: b.totalPnl 
        })));
      }
    }
    
    return sortedBuckets;
  }, []);

  // CRITICAL: Fetch ALL trades directly from database (same as activity log) for accurate calculations
  const [directDbTrades, setDirectDbTrades] = useState(null);
  const [dbTradesLoading, setDbTradesLoading] = useState(false);
  
  useEffect(() => {
    const fetchDirectDbTrades = async () => {
      try {
        setDbTradesLoading(true);
        const tradingMode = isLiveMode ? 'live' : 'testnet';
        
        // CRITICAL: Use direct database endpoint to bypass in-memory array limitations
        // This matches the SQL query exactly: WHERE exit_timestamp IS NOT NULL AND entry_price > 0 AND quantity > 0
        const response = await fetch(`http://localhost:3003/api/trades/direct-db?trading_mode=${tradingMode}`).catch(() => null);
        if (!response || !response.ok) {
          console.error('[DailyPerformanceChart] ❌ Failed to fetch from direct-db endpoint, falling back to queueEntityCall');
          // Fallback to queueEntityCall
          const allTrades = await queueEntityCall('Trade', 'filter', 
            { trading_mode: tradingMode }, 
            '-exit_timestamp', 
            10000
          ).catch(() => []);
          if (allTrades && allTrades.length > 0) {
            setDirectDbTrades(allTrades);
          }
          return;
        }
        
        const result = await response.json();
        const allTrades = result.success && result.data ? result.data : [];
        
        if (allTrades && allTrades.length > 0) {
          setDirectDbTrades(allTrades);
        }
      } catch (error) {
        console.error('[DailyPerformanceChart] Error fetching direct DB trades:', error);
      } finally {
        setDbTradesLoading(false);
      }
    };
    
    // Fetch on mount and periodically (every 30 seconds)
    fetchDirectDbTrades();
    const interval = setInterval(fetchDirectDbTrades, 30000);
    return () => clearInterval(interval);
  }, [isLiveMode]);

  // Use direct DB trades if available, otherwise fall back to modeTrades
  const tradesForCalculation = useMemo(() => {
    if (directDbTrades !== null && Array.isArray(directDbTrades) && directDbTrades.length > 0) {
      return directDbTrades;
    }
    return modeTrades || [];
  }, [directDbTrades, modeTrades]);

  const dataReadyForTimeframe = useMemo(() => {
    return !walletLoading && !dbTradesLoading && Array.isArray(tradesForCalculation) && tradesForCalculation.length > 0;
  }, [walletLoading, dbTradesLoading, tradesForCalculation]);

  // Add a timeout mechanism to prevent infinite loading
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  
  useEffect(() => {
    if (walletLoading || dbTradesLoading) {
      setLoadingTimeout(false);
      const timeout = setTimeout(() => {
        console.warn('[DailyPerformanceChart] ⚠️ Loading timeout reached - showing no data state');
        setLoadingTimeout(true);
      }, 10000); // 10 second timeout
      
      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [walletLoading, dbTradesLoading]);

  const chartData = useMemo(() => {
    if (!dataReadyForTimeframe || !tradesForCalculation || tradesForCalculation.length === 0) {
      return [];
    }

    const now = new Date();
    let startDate;
    
    // Determine the time window based on timeframe
    // CRITICAL: Use tradesForCalculation (direct DB trades) instead of modeTrades
      if (timeframe === 'lifetime') {
      // Use all trades (no date filter) - group by day for lifetime view
      return aggregateTradesIntoBuckets(tradesForCalculation, 'day');
    } else if (timeframe === '24h') {
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tradesInWindow = tradesForCalculation.filter(t => {
        if (!t?.exit_timestamp) return false;
        const exitDate = new Date(t.exit_timestamp);
        return exitDate.getTime() >= startDate.getTime();
      });
      return aggregateTradesIntoBuckets(tradesInWindow, 'hour');
    } else if (timeframe === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const tradesInWindow = tradesForCalculation.filter(t => {
        if (!t?.exit_timestamp) return false;
        const exitDate = new Date(t.exit_timestamp);
        return exitDate.getTime() >= startDate.getTime();
      });
      return aggregateTradesIntoBuckets(tradesInWindow, 'day');
    } else if (timeframe === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const tradesInWindow = tradesForCalculation.filter(t => {
        if (!t?.exit_timestamp) return false;
        const exitDate = new Date(t.exit_timestamp);
        return exitDate.getTime() >= startDate.getTime();
      });
      return aggregateTradesIntoBuckets(tradesInWindow, 'day');
    }

    return [];
  }, [timeframe, tradesForCalculation, aggregateTradesIntoBuckets, dataReadyForTimeframe]);

  const summaryStats = useMemo(() => {
    // CRITICAL FIX: For ALL timeframes (lifetime, 30d, 7d, 24h), calculate total P&L directly from ALL trades (not aggregated buckets)
    // This ensures accuracy and matches the header widget calculation
    const shouldCalculateFromTrades = (timeframe === 'lifetime' || timeframe === '7d' || timeframe === '30d' || timeframe === '24h');
    
    // CRITICAL: For timeframes that should use direct trade calculation, wait for tradesForCalculation to be ready
    // Do NOT fall back to chartData for these timeframes
    if (shouldCalculateFromTrades) {
      // If trades are not ready yet, return zero stats (don't use chartData fallback)
      if (!tradesForCalculation || tradesForCalculation.length === 0) {
        const result = { totalPnl: 0, profitFactor: 0, avgPeriodPnl: 0, bestPeriodPnl: 0, totalGrossProfit: 0, totalGrossLoss: 0 };
        return result;
      }
      const now = new Date();
      let startDate;
      
      // Determine time window
      // CRITICAL: Use UTC time to match database timestamps (typically stored in UTC)
      if (timeframe === 'lifetime') {
        startDate = new Date(0); // Beginning of time
      } else if (timeframe === '24h') {
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (timeframe === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (timeframe === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      
      // Filter trades within the time window
      // CRITICAL: Match SQL query filters exactly - exit_timestamp IS NOT NULL AND entry_price > 0 AND quantity > 0
      const tradesInWindow = tradesForCalculation.filter(t => {
        // Match SQL query filters exactly
        if (!t?.exit_timestamp) return false;
        if (Number(t?.entry_price) <= 0) return false;
        if (Number(t?.quantity || t?.quantity_crypto) <= 0) return false;
        
        // For lifetime, include all trades (no date filter)
        if (timeframe === 'lifetime') {
          return true;
        }
        
        // For other timeframes, filter by exit_timestamp
        const exitDate = new Date(t.exit_timestamp);
        if (isNaN(exitDate.getTime())) {
          console.warn(`[DailyPerformanceChart] Invalid exit_timestamp for trade:`, t.id, t.exit_timestamp);
          return false;
        }
        
        return exitDate.getTime() >= startDate.getTime();
      });
      
      // CRITICAL: For lifetime calculations, match database SQL query exactly - NO deduplication
      // Database query: SELECT SUM(pnl_usdt) FROM trades WHERE exit_timestamp IS NOT NULL AND entry_price > 0 AND quantity > 0
      // For other timeframes, deduplication may still be needed for chart display accuracy
      const tradesForPnlCalculation = (timeframe === 'lifetime') 
        ? tradesInWindow  // No deduplication for lifetime (matches database)
        : deduplicateTrades(tradesInWindow);  // Deduplication for period calculations
      
      // Calculate directly from closed trades in the window (matches database query)
      // Note: tradesForPnlCalculation already filtered for exit_timestamp != null, entry_price > 0, quantity > 0
      const closedTrades = tradesForPnlCalculation;
      
      // CRITICAL: Filter out trades with invalid/null/NaN pnl_usdt values
      const validTrades = closedTrades.filter(t => {
        const pnl = Number(t?.pnl_usdt);
        return !isNaN(pnl) && t?.pnl_usdt != null;
      });
      
      // Sum P&L from valid trades only
      const totalPnl = validTrades.reduce((sum, t) => {
        const pnl = Number(t.pnl_usdt);
        return sum + (isNaN(pnl) ? 0 : pnl);
      }, 0);
      
      // Calculate gross profit and loss from valid trades only
      const totalGrossProfit = validTrades
        .filter(t => {
          const pnl = Number(t?.pnl_usdt);
          return !isNaN(pnl) && pnl > 0;
        })
        .reduce((sum, t) => {
          const pnl = Number(t.pnl_usdt);
          return sum + (isNaN(pnl) ? 0 : pnl);
        }, 0);
        
      const totalGrossLoss = Math.abs(validTrades
        .filter(t => {
          const pnl = Number(t?.pnl_usdt);
          return !isNaN(pnl) && pnl < 0;
        })
        .reduce((sum, t) => {
          const pnl = Number(t.pnl_usdt);
          return sum + (isNaN(pnl) ? 0 : pnl);
        }, 0));
      
      // Calculate profit factor
      const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : (totalGrossProfit > 0 ? Infinity : 0);
      
      // Calculate averages from chartData (buckets for display)
      const avgPeriodPnl = chartData && chartData.length > 0 ? chartData.reduce((acc, data) => acc + (data.totalPnl || 0), 0) / chartData.length : 0;
      const bestPeriodPnl = chartData && chartData.length > 0 ? Math.max(...chartData.map(d => (d.totalPnl || 0))) : 0;

      const result = { totalPnl, profitFactor, avgPeriodPnl, bestPeriodPnl, totalGrossProfit, totalGrossLoss };
      
      return result;
    }

    // Fallback: Only for timeframes that don't use direct trade calculation (shouldn't happen with current timeframes)
    // But if chartData is empty, return zero stats
    if (!chartData || chartData.length === 0) {
      const result = { totalPnl: 0, profitFactor: 0, avgPeriodPnl: 0, bestPeriodPnl: 0, totalGrossProfit: 0, totalGrossLoss: 0 };
      return result;
    }

    // Calculate totals from chartData (aggregated buckets) - fallback only for non-standard timeframes
    // NOTE: This should NOT be used for lifetime, 30d, 7d, or 24h as they use direct trade calculation above
    const totalPnl = chartData.reduce((acc, data) => acc + (data.totalPnl || 0), 0);
    const totalGrossProfit = chartData.reduce((acc, data) => acc + (data.grossProfit || 0), 0);
    const totalGrossLoss = chartData.reduce((acc, data) => acc + (data.grossLoss || 0), 0);

    // Calculate profit factor
    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : (totalGrossProfit > 0 ? Infinity : 0);

    // Calculate averages
    const avgPeriodPnl = chartData.length > 0 ? totalPnl / chartData.length : 0;
    const bestPeriodPnl = chartData.length > 0 ? Math.max(...chartData.map(d => (d.totalPnl || 0))) : 0;

    const result = { totalPnl, profitFactor, avgPeriodPnl, bestPeriodPnl, totalGrossProfit, totalGrossLoss };
    
    return result;
  }, [chartData, timeframe, tradesForCalculation]);

  // CRITICAL: Use tradesForCalculation (direct DB trades) for period stats to ensure accuracy
  const recentTrades = tradesForCalculation;
  const chartTimeframe = timeframe;

  const periodTradeStats = useMemo(() => {
    if (!recentTrades || recentTrades.length === 0) {
      return { totalTrades: 0, winningTrades: 0, winRate: 0 };
    }

    const now = new Date();
    let startDate;
    
    if (chartTimeframe === 'lifetime') {
      startDate = new Date(0); // Beginning of time
    } else {
      switch (chartTimeframe) {
        case "24h":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "7d":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default: // 30d
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
    }

    const relevantTrades = recentTrades.filter(trade => {
      if (!trade?.exit_timestamp) return false;
      const tradeExitDate = new Date(trade.exit_timestamp);
      return !isNaN(tradeExitDate.getTime()) && tradeExitDate.getTime() >= startDate.getTime();
    });
    
    const totalTrades = relevantTrades.length;
    const winningTrades = relevantTrades.filter(trade => (trade.pnl_usdt || 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return { totalTrades, winningTrades, winRate };
  }, [recentTrades, chartTimeframe]);

  useEffect(() => {
    if (onSummaryStatsChange && typeof onSummaryStatsChange === 'function') {
      onSummaryStatsChange({
        ...summaryStats,
        ...periodTradeStats,
        timeframe: chartTimeframe
      });
    }
  }, [summaryStats, periodTradeStats, chartTimeframe, onSummaryStatsChange]);

  const formatCurrency = (n) =>
    typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "$0.00";

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const d = payload[0]?.payload || {};
    const pnl = typeof d.totalPnl === "number" ? d.totalPnl : 0;
    const gp = typeof d.grossProfit === "number" ? d.grossProfit : 0;
    const gl = typeof d.grossLoss === "number" ? Math.abs(d.grossLoss) : 0;
    const pf = gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0);
    const trades = typeof d.tradeCount === "number" ? d.tradeCount : 0;
    const wins = typeof d.winningTrades === "number" ? d.winningTrades : 0;

    const isHourly = timeframe === "24h";

    return (
      <div className="rounded-md border bg-white/95 p-3 shadow-sm">
        <div className="text-sm font-semibold mb-1">{d.displayLabel || label}</div>
        <div className="text-xs">
          <div className={`font-medium ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {isHourly ? "Hourly P&L: " : "Daily P&L: "}
            {formatCurrency(pnl)}
          </div>
          <div className="text-gray-700">
            Profit Factor: {Number.isFinite(pf) ? pf.toFixed(2) : "∞"}
          </div>
          <div className="text-gray-700">
            Trades: {trades.toLocaleString()} | Wins: {wins.toLocaleString()}
          </div>
        </div>
      </div>
    );
  };

  const isLoadingForTimeframe = !dataReadyForTimeframe && !loadingTimeout;

  const chartKey = useMemo(() => {
    return [
      timeframe,
      'props', // These 'props' strings seem like placeholders or historical key parts. Keeping them for consistency.
      'props',
      modeTrades?.length || 0,
      walletLoading ? 'WL' : 'RD'
    ].join('|');
  }, [timeframe, modeTrades, walletLoading]);


  if (isLoadingForTimeframe) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Performance History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-center py-10 text-muted-foreground">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
              <p>Loading performance data...</p>
            </div>
            <p className="text-xs text-gray-400">
              {timeframe === '24h' ? 'Fetching hourly data...' : 'Fetching daily data...'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // If loading timed out, show no data state
  if (loadingTimeout && !dataReadyForTimeframe) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Performance History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Tabs value={timeframe} onValueChange={onTimeframeChange} className="mb-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="24h">24 Hours</TabsTrigger>
              <TabsTrigger value="7d">7 Days</TabsTrigger>
              <TabsTrigger value="30d">30 Days</TabsTrigger>
              <TabsTrigger value="lifetime">Lifetime</TabsTrigger>
            </TabsList>
          </Tabs>
          
          <div className="text-center py-10 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No performance data available</p>
            <p className="text-sm text-gray-500 mb-4">
              No performance data available for the selected period. Data will appear as trading activity is recorded.
            </p>
            <div className="text-xs text-gray-400">
              <p>• Start trading to generate performance data</p>
              <p>• Performance data is recorded {timeframe === '24h' ? 'hourly' : 'daily'}</p>
              <p>• Switch to a different timeframe to see available data</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasAnyData = (Array.isArray(chartData) && chartData.length > 0);

  if (!hasAnyData) {
    console.warn('[DailyPerformanceChart] ⚠️ No chart data available');
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Performance History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Tabs value={timeframe} onValueChange={onTimeframeChange} className="mb-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="24h">24 Hours</TabsTrigger>
              <TabsTrigger value="7d">7 Days</TabsTrigger>
              <TabsTrigger value="30d">30 Days</TabsTrigger>
              <TabsTrigger value="lifetime">Lifetime</TabsTrigger>
            </TabsList>
          </Tabs>
          
          <div className="text-center py-10 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No performance data available</p>
            <p className="text-sm text-gray-500 mb-4">
              No performance data available for the selected period. Data will appear as trading activity is recorded.
            </p>
            <div className="text-xs text-gray-400">
              <p>• Start trading to generate performance data</p>
              <p>• Performance data is recorded {timeframe === '24h' ? 'hourly' : 'daily'}</p>
              <p>• Switch to a different timeframe to see available data</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Performance History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <Tabs value={timeframe} onValueChange={onTimeframeChange} className="mb-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="24h">24 Hours</TabsTrigger>
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="lifetime">Lifetime</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart key={chartKey} data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />

              <XAxis
                dataKey="displayLabel"
                tick={{ fontSize: 12 }}
                className="text-gray-500 dark:text-gray-400"
                interval={timeframe === 'lifetime' ? 'preserveEnd' : 'preserveStartEnd'}
              />

              <YAxis
                tickFormatter={(value) => `$${(value || 0).toFixed(0)}`}
                className="text-gray-500 dark:text-gray-400"
              />

              <Tooltip content={<CustomTooltip />} />

              <ReferenceLine y={0} stroke="#666" strokeDasharray="2 2" />

              <Bar dataKey="totalPnl" name="P&L">
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={(entry.totalPnl || 0) > 0 ? '#10b981' : (entry.totalPnl || 0) < 0 ? '#ef4444' : '#9ca3af'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Total P&L ({timeframe === 'lifetime' ? 'All Time' : timeframe})
            </div>
            <div className={`text-lg font-semibold ${
              summaryStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              ${summaryStats.totalPnl.toFixed(2)}
            </div>
            {timeframe === 'lifetime' && (
              <p className="text-xs text-gray-500 mt-1">Source: Direct DB Query (all trades)</p>
            )}
          </div>
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Profit Factor ({timeframe === 'lifetime' ? 'All Time' : timeframe})
            </div>
            <div className={`text-lg font-semibold ${isFinite(summaryStats.profitFactor) && summaryStats.profitFactor >= 1 ? 'text-green-500' : 'text-red-500'}`}>
              {isFinite(summaryStats.profitFactor) ? summaryStats.profitFactor.toFixed(2) : '∞'}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Avg {timeframe === '24h' ? 'Hourly' : 'Daily'} P&L
            </div>
            <div className={`text-lg font-semibold ${summaryStats.avgPeriodPnl >= 0 ? 'text-blue-500' : 'text-orange-500'}`}>
              ${summaryStats.avgPeriodPnl.toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Best {timeframe === '24h' ? 'Hour' : 'Day'}
            </div>
            <div className="text-lg font-semibold text-green-500">
              ${summaryStats.bestPeriodPnl.toFixed(2)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
