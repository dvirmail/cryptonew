
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

// FIXED: Prefer explicit period fields, fallback to cumulative using a baseline when missing.
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

// Helper: supplement any missing buckets from raw trades aggregation
const supplementBucketsFromTrades = (buckets, trades, groupBy) => {
  if (!buckets || !trades || trades.length === 0) return;
  const keys = Object.keys(buckets);
  if (keys.length === 0) {
    return;
  }

  const zeroOrEmpty = new Set(
    keys.filter((k) => {
      const b = buckets[k];
      return !b || (
        (Number(b.totalPnl) === 0) &&
        (Number(b.tradeCount) === 0) &&
        (Number(b.winningTrades) === 0) &&
        (Number(b.grossProfit) === 0) &&
        (Number(b.grossLoss) === 0)
      );
    })
  );

  if (zeroOrEmpty.size === 0) {
    return;
  }

  trades.forEach((trade) => {
    if (!trade?.exit_timestamp) return;
    const d = new Date(trade.exit_timestamp);
    let key;
    if (groupBy === 'hour') {
      key = new Date(Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours()
      )).toISOString();
    } else {
      key = new Date(Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate()
      )).toISOString().split('T')[0];
    }
    
    if (!buckets[key] || !zeroOrEmpty.has(key)) return;

    const b = buckets[key];
    const pnl = Number(trade.pnl_usdt || 0);
    
    b.tradeCount = (b.tradeCount || 0) + 1;
    b.totalPnl = (b.totalPnl || 0) + pnl;
    if (pnl > 0) {
      b.winningTrades = (b.winningTrades || 0) + 1;
      b.grossProfit = (b.grossProfit || 0) + pnl;
    } else if (pnl < 0) {
      b.grossLoss = (b.grossLoss || 0) + Math.abs(pnl);
    }
  });
};

export default function DailyPerformanceChart({
  trades = [],
  timeframe,
  onTimeframeChange,
  dailyPerformanceHistory = [],
  hourlyPerformanceHistory = [],
  walletSummary = null,
  onSummaryStatsChange 
}) {
  const { isLiveMode } = useTradingMode();
  const { loading: walletLoading } = useWallet();

  // Debug logging for props
  console.log('[DailyPerformanceChart] 🔍 Props received:', {
    walletLoading,
    dailyPerformanceHistoryLength: dailyPerformanceHistory?.length || 0,
    hourlyPerformanceHistoryLength: hourlyPerformanceHistory?.length || 0,
    dailyPerformanceHistorySample: dailyPerformanceHistory?.slice(0, 2),
    hourlyPerformanceHistorySample: hourlyPerformanceHistory?.slice(0, 2),
    walletSummary: walletSummary ? 'present' : 'null',
    timestamp: new Date().toISOString()
  });

  const dailyHP = React.useMemo(
    () => (Array.isArray(dailyPerformanceHistory) ? dailyPerformanceHistory : []),
    [dailyPerformanceHistory]
  );
  const hourlyHP = React.useMemo(
    () => (Array.isArray(hourlyPerformanceHistory) ? hourlyPerformanceHistory : []),
    [hourlyPerformanceHistory]
  );

  // Debug logging for processed data
  console.log('[DailyPerformanceChart] 🔍 Processed data:', {
    dailyHPLength: dailyHP?.length || 0,
    hourlyHPLength: hourlyHP?.length || 0,
    dailyHPSample: dailyHP?.slice(0, 2),
    hourlyHPSample: hourlyHP?.slice(0, 2),
    timestamp: new Date().toISOString()
  });

  const modeTrades = useMemo(() => {
    const mode = isLiveMode ? 'live' : 'testnet';
    const arr = Array.isArray(trades) ? trades.filter(t => (t?.trading_mode || 'testnet') === mode) : [];
    return arr;
  }, [trades, isLiveMode]);

  const dedupeByBucket = useCallback((records, bucket) => {
    if (!Array.isArray(records)) return [];
    const map = new Map();
    for (const rec of records) {
      if (!rec?.snapshot_timestamp) continue;
      const d = new Date(rec.snapshot_timestamp);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const key = bucket === 'hour' ? `${y}-${m}-${day}T${hh}:00Z` : `${y}-${m}-${day}`;
      
      const existing = map.get(key);
      if (!existing || new Date(rec.snapshot_timestamp).getTime() > new Date(existing.snapshot_timestamp).getTime()) {
        map.set(key, rec);
      }
    }
    const out = Array.from(map.values()).sort((a, b) =>
      new Date(a.snapshot_timestamp).getTime() - new Date(b.snapshot_timestamp).getTime()
    );
    return out;
  }, []);

  const dataReadyForTimeframe = useMemo(() => {
    const ready =
      !walletLoading &&
      ((timeframe === '24h' && (hourlyHP?.length || 0) > 0) ||
       ((timeframe === '7d' || timeframe === '30d' || timeframe === 'lifetime') && (dailyHP?.length || 0) > 0));
    
    // Debug logging to help troubleshoot data loading
    console.log('[DailyPerformanceChart] Data readiness check:', {
      walletLoading,
      timeframe,
      dailyHPLength: dailyHP?.length || 0,
      hourlyHPLength: hourlyHP?.length || 0,
      ready,
      dailyHP: dailyHP?.slice(0, 2), // First 2 records for debugging
      hourlyHP: hourlyHP?.slice(0, 2) // First 2 records for debugging
    });
    
    return ready;
  }, [walletLoading, timeframe, dailyHP.length, hourlyHP.length]);

  // Add a timeout mechanism to prevent infinite loading
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  
  useEffect(() => {
    if (walletLoading) {
      setLoadingTimeout(false);
      const timeout = setTimeout(() => {
        console.warn('[DailyPerformanceChart] ⚠️ Loading timeout reached - showing no data state');
        setLoadingTimeout(true);
      }, 10000); // 10 second timeout
      
      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [walletLoading]);

  const chartData = useMemo(() => {
    
    const now = new Date();

    if (!dataReadyForTimeframe) {
      return [];
    }

    const makeHourlyBuckets = (endUtcHour, hours) => {
      const buckets = {};
      const startMs = endUtcHour.getTime() - (hours * 60 * 60 * 1000);
      for (let i = 0; i < hours; i++) {
        const currentHourMs = startMs + i * 60 * 60 * 1000;
        const hour = new Date(currentHourMs);
        const key = new Date(Date.UTC(
          hour.getUTCFullYear(),
          hour.getUTCMonth(),
          hour.getUTCDate(),
          hour.getUTCHours()
        )).toISOString();
        buckets[key] = {
          timeKey: key,
          displayLabel: hour.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                        hour.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
          totalPnl: 0,
          tradeCount: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
        };
      }
      return buckets;
    };

    const makeDailyBuckets = (endUtcMidnight, days) => {
      const buckets = {};
      // Ensure startMs calculates correctly for the number of days, including the end day
      const startMs = endUtcMidnight.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
      for (let i = 0; i < days; i++) {
        const currentDayMs = startMs + i * 24 * 60 * 60 * 1000;
        const day = new Date(currentDayMs);
        const key = new Date(Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate()
        )).toISOString().split('T')[0];
        buckets[key] = {
          timeKey: key,
          displayLabel: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          totalPnl: 0,
          tradeCount: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
        };
      }
      return buckets;
    };

    const shouldUseHistorical =
      (timeframe === '24h' && hourlyHP.length > 0) ||
      ((timeframe === '7d' || timeframe === '30d' || timeframe === 'lifetime') && dailyHP.length > 0);


    if (shouldUseHistorical) {
      if (timeframe === '24h') {
        const endUtcHour = new Date(now);
        endUtcHour.setUTCMilliseconds(0);
        endUtcHour.setUTCSeconds(0);
        endUtcHour.setUTCMinutes(0);

        const buckets = makeHourlyBuckets(endUtcHour, 24);
        const windowStartMs = endUtcHour.getTime() - 23 * 60 * 60 * 1000;

        const allDeduped = dedupeByBucket(hourlyHP, 'hour');
        let baseline = null;
        for (let i = allDeduped.length - 1; i >= 0; i--) {
          const ts = new Date(allDeduped[i].snapshot_timestamp).getTime();
          if (ts < windowStartMs) {
            baseline = allDeduped[i];
            break;
          }
        }
        
        const inWindow = allDeduped.filter(rec => {
          const ts = new Date(rec.snapshot_timestamp).getTime();
          return ts >= windowStartMs && ts <= endUtcHour.getTime();
        });

        const normalized = normalizeWithBaseline(inWindow, baseline, true);

        normalized.forEach((rec) => {
          if (!rec?.snapshot_timestamp) return;
          const d = new Date(rec.snapshot_timestamp);
          const key = new Date(Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours()
          )).toISOString();
          if (buckets[key]) {
            buckets[key].totalPnl = Number(rec.period_pnl || 0);
            buckets[key].tradeCount = Number(rec.period_trade_count || 0);
            buckets[key].winningTrades = Number(rec.period_winning_trades || 0);
            buckets[key].grossProfit = Number(rec.period_gross_profit || 0);
            buckets[key].grossLoss = Number(rec.period_gross_loss || 0);
          }
        });

        supplementBucketsFromTrades(buckets, modeTrades, 'hour');

        const final = Object.values(buckets).sort((a, b) => new Date(a.timeKey).getTime() - new Date(b.timeKey).getTime());
        
        return final;
      }

      // NEW: Handle lifetime timeframe
      if (timeframe === 'lifetime') {
        const allDeduped = dedupeByBucket(dailyHP, 'day');
        
        if (allDeduped.length === 0) {
          return [];
        }

        const oldestRecord = allDeduped[0];
        const newestRecord = allDeduped[allDeduped.length - 1];
        
        const oldestDate = new Date(oldestRecord.snapshot_timestamp);
        const newestDate = new Date(newestRecord.snapshot_timestamp);
        
        const oldestUtcMidnight = new Date(Date.UTC(
          oldestDate.getUTCFullYear(),
          oldestDate.getUTCMonth(),
          oldestDate.getUTCDate()
        ));
        
        const newestUtcMidnight = new Date(Date.UTC(
          newestDate.getUTCFullYear(),
          newestDate.getUTCMonth(),
          newestDate.getUTCDate()
        ));
        
        const totalDays = Math.ceil((newestUtcMidnight.getTime() - oldestUtcMidnight.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        
        const buckets = makeDailyBuckets(newestUtcMidnight, totalDays);
        
        const normalized = normalizeWithBaseline(allDeduped, null, false);
        
        normalized.forEach((rec) => {
          if (!rec?.snapshot_timestamp) return;
          const d = new Date(rec.snapshot_timestamp);
          const key = new Date(Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate()
          )).toISOString().split('T')[0];
          if (buckets[key]) {
            buckets[key].totalPnl = Number(rec.period_pnl || 0);
            buckets[key].tradeCount = Number(rec.period_trade_count || 0);
            buckets[key].winningTrades = Number(rec.period_winning_trades || 0);
            buckets[key].grossProfit = Number(rec.period_gross_profit || 0);
            buckets[key].grossLoss = Number(rec.period_gross_loss || 0);
          }
        });

        supplementBucketsFromTrades(buckets, modeTrades, 'day');

        const final = Object.values(buckets).sort((a, b) => new Date(a.timeKey).getTime() - new Date(b.timeKey).getTime());
        
        return final;
      }

      // 7d or 30d (daily)
      const days = timeframe === '7d' ? 7 : 30;
      const endUtcMidnight = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(), 
        now.getUTCDate()
      ));
      const buckets = makeDailyBuckets(endUtcMidnight, days);

      const windowStartMs = endUtcMidnight.getTime() - (days - 1) * 24 * 60 * 60 * 1000;

      const allDeduped = dedupeByBucket(dailyHP, 'day');

      let baseline = null;
      for (let i = allDeduped.length - 1; i >= 0; i--) {
        const d = new Date(allDeduped[i].snapshot_timestamp);
        const tsKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
        if (tsKey < windowStartMs) {
          baseline = allDeduped[i];
          break;
        }
      }

      const inWindow = allDeduped.filter(rec => {
        const d = new Date(rec.snapshot_timestamp);
        const tsKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
        return tsKey >= windowStartMs && tsKey <= endUtcMidnight.getTime();
      });

      hpDebug.log('dailyHP stats', {
        original: dailyHP.length,
        deduped: allDeduped.length,
        inWindow: inWindow.length,
        baselineTs: baseline?.snapshot_timestamp || null,
        windowStart: new Date(windowStartMs).toISOString()
      });

      const normalizedDaily = normalizeWithBaseline(inWindow, baseline, false);

      normalizedDaily.forEach((rec) => {
        if (!rec?.snapshot_timestamp) return;
        const d = new Date(rec.snapshot_timestamp);
        const key = new Date(Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate()
        )).toISOString().split('T')[0];
        if (buckets[key]) {
          buckets[key].totalPnl = Number(rec.period_pnl || 0);
          buckets[key].tradeCount = Number(rec.period_trade_count || 0);
          buckets[key].winningTrades = Number(rec.period_winning_trades || 0);
          buckets[key].grossProfit = Number(rec.period_gross_profit || 0);
          buckets[key].grossLoss = Number(rec.period_gross_loss || 0);
        }
      });

      supplementBucketsFromTrades(buckets, modeTrades, 'day');

      const final = Object.values(buckets).sort((a, b) => new Date(a.timeKey).getTime() - new Date(b.timeKey).getTime());
      
      return final;
    }

    return [];

  }, [
    timeframe,
    dailyHP,
    hourlyHP,
    modeTrades,
    dedupeByBucket,
    dataReadyForTimeframe
  ]);

  const summaryStats = useMemo(() => {

    // CRITICAL FIX: For lifetime view, use WalletSummary as source of truth
    if (timeframe === 'lifetime') {
      if (walletSummary) {
        
        const result = {
          totalPnl: walletSummary.totalRealizedPnl || 0,
          profitFactor: walletSummary.profitFactor || 0,
          avgPeriodPnl: chartData.length > 0 ? (walletSummary.totalRealizedPnl || 0) / chartData.length : 0,
          bestPeriodPnl: chartData.length > 0 ? Math.max(...chartData.map(d => (d.totalPnl || 0))) : 0,
          totalGrossProfit: walletSummary.totalGrossProfit || 0,
          totalGrossLoss: walletSummary.totalGrossLoss || 0
        };
        return result;
      } else {
        console.warn('[DailyPerformanceChart] Lifetime view but no walletSummary available, falling back to chartData');
      }
    }

    // For non-lifetime views, calculate from chartData (or if walletSummary was missing for lifetime)
    if (!chartData || chartData.length === 0) {
      const result = { totalPnl: 0, profitFactor: 0, avgPeriodPnl: 0, bestPeriodPnl: 0, totalGrossProfit: 0, totalGrossLoss: 0 };
      return result;
    }

    const totalPnl = chartData.reduce((acc, data) => acc + (data.totalPnl || 0), 0);
    const totalGrossProfit = chartData.reduce((acc, data) => acc + (data.grossProfit || 0), 0);
    const totalGrossLoss = chartData.reduce((acc, data) => acc + (data.grossLoss || 0), 0);

    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : (totalGrossProfit > 0 ? Infinity : 0);

    const avgPeriodPnl = chartData.length > 0 ? totalPnl / chartData.length : 0;
    const bestPeriodPnl = chartData.length > 0 ? Math.max(...chartData.map(d => (d.totalPnl || 0))) : 0;

    const result = { totalPnl, profitFactor, avgPeriodPnl, bestPeriodPnl, totalGrossProfit, totalGrossLoss };
    
    return result;
  }, [chartData, timeframe, walletSummary]);

  const recentTrades = modeTrades;
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
      dailyHP?.length || 0,
      hourlyHP?.length || 0,
      walletLoading ? 'WL' : 'RD'
    ].join('|');
  }, [timeframe, dailyHP, hourlyHP, walletLoading]);


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
              <p className="text-xs text-gray-500 mt-1">Source: Wallet Summary</p>
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
