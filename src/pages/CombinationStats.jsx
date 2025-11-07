
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from '@/components/ui/use-toast';
import { BacktestCombination } from '@/api/entities';
import { Trade } from "@/api/entities";
import { queueEntityCall } from "@/components/utils/apiQueue";
import { deleteStrategyAndTrades } from '@/api/functions';
import { safeCombinationOperations } from '@/api/functions';
import ProfitFactorCell from '../components/stats/ProfitFactorCell';
import EditStrategyDialog from '../components/stats/EditStrategyDialog';
import OptOutDialog from '../components/stats/OptOutDialog';
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useWallet } from '@/components/providers/WalletProvider';
import RegimeBadge from '../components/stats/RegimeBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


import {
  Search,
  Filter,
  SortAsc,
  SortDesc,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Timer,
  AlertCircle,
  BarChart3,
  Calendar,
  Coins,
  Settings,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Rocket // New icon
} from 'lucide-react';

const ITEMS_PER_PAGE = 20;

// DEBUG flag for this page
const DEBUG_COMBINATION_STATS = true;

// Sort icon component
const SortIcon = ({ column, sortConfig }) => {
  if (sortConfig.key !== column) {
    return <SortAsc className="h-4 w-4 opacity-50" />;
  }
  return sortConfig.direction === 'asc' ?
    <SortAsc className="h-4 w-4" /> :
    <SortDesc className="h-4 w-4" />;
};

// Format duration helper
const formatDuration = (minutes) => {
  if (!minutes || minutes === 0) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${Math.round(remainingMinutes)}m` : `${hours}h`;
};

// Get color for metric
const getColorForMetric = (value, type) => {
  if (value == null || isNaN(value)) return 'text-gray-500';

  switch (type) {
    case 'successRate':
      if (value >= 70) return 'text-green-600 dark:text-green-400';
      if (value >= 50) return 'text-yellow-600 dark:text-yellow-400';
      return 'text-red-600 dark:text-red-400';
    case 'profitFactor':
      if (value >= 1.5) return 'text-green-600 dark:text-green-400';
      if (value >= 1) return 'text-yellow-600 dark:text-yellow-400';
      return 'text-red-600 dark:text-red-400';
    case 'avgPriceMove':
      return value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    case 'combinedStrength':
      if (value >= 300) return 'text-green-600 dark:text-green-400';
      if (value >= 200) return 'text-yellow-600 dark:text-yellow-400';
      return 'text-red-600 dark:text-red-400';
    case 'convictionScore':
      if (value >= 70) return 'text-green-600 dark:text-green-400';
      if (value >= 50) return 'text-yellow-600 dark:text-yellow-400';
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-900 dark:text-gray-100';
  }
};

// Expanded row content component
const ExpandedRowContent = ({ combination, strategyStats }) => {
  const currentStats = strategyStats[combination.combinationName];
  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800/50">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Strategy Details */}
        <div>
          <h4 className="font-semibold mb-3 flex items-center">
            <Settings className="h-4 w-4 mr-2" />
            Strategy Configuration
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction:</span>
              <Badge variant={combination.strategyDirection === 'long' ? 'success' : 'destructive'}>
                {combination.strategyDirection?.toUpperCase() || 'LONG'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Risk per Trade:</span>
              <span>{combination.riskPercentage || 1}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stop Loss (ATR):</span>
              <span>{combination.stopLossAtrMultiplier || 1.0}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Take Profit (ATR):</span>
              <span>{combination.takeProfitAtrMultiplier || 1.5}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Exit Time:</span>
              <span>{formatDuration(combination.estimatedExitTimeMinutes)}</span>
            </div>
          </div>
        </div>

        {/* Performance Breakdown */}
        <div>
          <h4 className="font-semibold mb-3 flex items-center">
            <BarChart3 className="h-4 w-4 mr-2" />
            Performance Breakdown
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Backtest Trades:</span>
              <span>{combination.occurrences || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demo Trades:</span>
              <span className={getColorForMetric(currentStats?.realTradeCount, 'default')}>
                {currentStats?.realTradeCount || 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demo Win Rate:</span>
              <span className={getColorForMetric(currentStats?.realSuccessRate, 'successRate')}>
                {currentStats?.realSuccessRate ? currentStats.realSuccessRate.toFixed(1) : '0.0'}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demo Avg P&L:</span>
              <span className={getColorForMetric(currentStats?.realAvgPnlPercent, 'avgPriceMove')}>
                {currentStats?.realAvgPnlPercent ?
                  `${currentStats.realAvgPnlPercent > 0 ? '+' : ''}${currentStats.realAvgPnlPercent.toFixed(2)}%` :
                  '0.00%'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demo P/F:</span>
              <div className="flex items-center">
                <ProfitFactorCell value={currentStats?.realProfitFactor || 0} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Signal Details */}
      <div className="mt-4">
        <h4 className="font-semibold mb-3 flex items-center">
          <Activity className="h-4 w-4 mr-2" />
          Signal Composition ({combination.signals?.length || 0} signals)
        </h4>
        <div className="flex flex-wrap gap-2">
          {combination.signals?.map((signal, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {signal.type}
              {signal.value && `: ${signal.value}`}
            </Badge>
          ))}
        </div>
      </div>

      {/* Market Regime Info */}
      {combination.dominantMarketRegime && (
        <div className="mt-4">
          <h4 className="font-semibold mb-3">Market Regime Performance</h4>
          <div className="text-sm">
            <span className="text-muted-foreground">Best performing in: </span>
            <RegimeBadge regime={combination.dominantMarketRegime} />
          </div>
        </div>
      )}
    </div>
  );
};

export default function CombinationStats() {
  const [combinations, setCombinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tradeHistory, setTradeHistory] = useState([]);

  // Filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [coinFilter, setCoinFilter] = useState('all');
  const [timeframeFilter, setTimeframeFilter] = useState('all');
  const [regimeFilter, setRegimeFilter] = useState('all'); // NEW: Regime filter state
  const [statusFilter, setStatusFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [demoTradesFilter, setDemoTradesFilter] = useState([0]);

  // Sorting
  const [sortConfig, setSortConfig] = useState({ key: 'realProfitFactor', direction: 'desc' });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // UI State
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showOptOutDialog, setShowOptOutDialog] = useState(false);
  const [editingCombination, setEditingCombination] = useState(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false); // New state for bulk operations

  // Auto opt-out state with localStorage persistence
  const [autoOptOutEnabled, setAutoOptOutEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('cryptosentinel_auto_opt_out_enabled');
      return saved !== null ? JSON.parse(saved) : false;
    } catch (error) {
      console.warn('Failed to load auto opt-out setting from localStorage:', error);
      return false;
    }
  });

  const [isProcessingAutoOptOut, setIsProcessingAutoOptOut] = useState(false);

  const { toast } = useToast();
  const { virtualWallet } = useWallet();

  // Add refs to track updates and prevent excessive API calls
  const lastUpdateTimeRef = useRef(0);
  const pendingUpdatesRef = useRef(new Map());
  const updateTimeoutRef = useRef(null);

  // NEW: Add refs to track trade history changes and prevent excessive auto opt-out checks
  const lastTradeHistoryLengthRef = useRef(0);
  const lastAutoOptOutCheckRef = useRef(0);
  const autoOptOutTimeoutRef = useRef(null);

  // Save auto opt-out setting to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('cryptosentinel_auto_opt_out_enabled', JSON.stringify(autoOptOutEnabled));
    } catch (error) {
      console.warn('Failed to save auto opt-out setting to localStorage:', error);
    }
  }, [autoOptOutEnabled]);


  // MODIFIED: Update strategy stats calculation to include latest trade timestamp
  const strategyStats = useMemo(() => {
    if (DEBUG_COMBINATION_STATS) {
      //console.log('[CS] strategyStats recompute: combos=', combinations.length, 'trades=', tradeHistory.length);
    }
    if (!combinations.length || !tradeHistory.length) {
      const defaultStats = {};
      combinations.forEach(combo => {
        defaultStats[combo.combinationName] = {
          realTradeCount: 0,
          realSuccessRate: 0,
          realAvgPnlPercent: 0,
          realProfitFactor: 0,
          realAvgConvictionScore: null,
          totalRealPnl: 0,
          backtestTradeCount: combo.occurrences || 0,
          backtestSuccessRate: combo.successRate || 0,
          backtestProfitFactor: combo.profitFactor || 0,
          backtestAvgPriceMove: combo.avgPriceMove || 0,
          latestTradeTimestamp: null, // NEW
        };
      });
      return defaultStats;
    }

    const stats = {};

    combinations.forEach(combo => {
      // Find CLOSED trades for this specific strategy (only count trades with exit_timestamp)
      // Match by strategy_name (combinationName)
      const strategyTrades = tradeHistory.filter(trade =>
        trade.strategy_name === combo.combinationName &&
        trade.exit_timestamp != null && // Only count closed trades
        trade.exit_timestamp !== undefined &&
        trade.exit_timestamp !== ''
      );
      

      // DEBUG: Log strategy matching
      if (DEBUG_COMBINATION_STATS) {
        //console.log(`[CS] Processing strategy: ${combo.combinationName}`);
        //console.log(`[CS] Found ${strategyTrades.length} trades for this strategy`);

        // Check all available strategy names in trades for debugging
        const allStrategyNames = [...new Set(tradeHistory.map(t => t.strategy_name))];
        //console.log(`[CS] All strategy names in trades:`, allStrategyNames.slice(0, 5));

        if (strategyTrades.length > 0) {
          /*console.log(`[CS] Sample trade:`, {
            strategy_name: strategyTrades[0].strategy_name,
            exit_timestamp: strategyTrades[0].exit_timestamp,
            conviction_score: strategyTrades[0].conviction_score,
            pnl_usdt: strategyTrades[0].pnl_usdt
          });*/
        } else {
          //console.log(`[CS] No trades found for strategy: ${combo.combinationName}`);
        }
      }

      const winningTrades = strategyTrades.filter(trade => trade.pnl_usdt > 0);
      const losingTrades = strategyTrades.filter(trade => trade.pnl_usdt < 0); // Corrected to only negative for grossLoss

      const totalPnl = strategyTrades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
      const grossProfit = winningTrades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
      const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0));

      // NEW: Find latest trade timestamp
      let latestTradeTimestamp = null;
      if (strategyTrades.length > 0) {
        const sortedByTime = [...strategyTrades].sort((a, b) => {
          const timeA = new Date(a.exit_timestamp).getTime();
          const timeB = new Date(b.exit_timestamp).getTime();
          return timeB - timeA; // descending
        });
        latestTradeTimestamp = sortedByTime[0]?.exit_timestamp || null;
      }

      stats[combo.combinationName] = {
        // Demo/Real stats (from actual trades)
        realTradeCount: strategyTrades.length,
        realSuccessRate: strategyTrades.length > 0 ? (winningTrades.length / strategyTrades.length) * 100 : 0,
        realAvgPnlPercent: strategyTrades.length > 0 ?
          strategyTrades.reduce((sum, trade) => sum + (trade.pnl_percentage || 0), 0) / strategyTrades.length : 0,
        realProfitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 10 : 0), // if grossLoss is 0 but grossProfit > 0, set to high value
        realAvgConvictionScore: strategyTrades.length > 0 ?
          strategyTrades.reduce((sum, trade) => sum + (trade.conviction_score || 0), 0) / strategyTrades.length : null,
        totalRealPnl: totalPnl,

        // Backtest stats (from combination data)
        backtestTradeCount: combo.occurrences || 0,
        backtestSuccessRate: combo.successRate || 0,
        backtestProfitFactor: combo.profitFactor || 0,
        backtestAvgPriceMove: combo.avgPriceMove || 0,

        latestTradeTimestamp, // NEW
      };
    });

    if (DEBUG_COMBINATION_STATS && combinations.length > 0) {
      const sampleKey = combinations[0]?.combinationName;
      // Removed [CS] log
    }
    return stats;
  }, [combinations, tradeHistory]);

  // Load combinations and trade data
  const loadData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);

    try {
      // Removed [CS] log
      // Fetch combinations and trade history in parallel
      // MODIFIED: Fetch all trades and deduplicate - filtering for exit_timestamp happens in deduplication logic
      const [combinationsData, tradesData] = await Promise.all([
        queueEntityCall('BacktestCombination', 'list', '-created_date'), // Adjusted sort key from -updated_date
        queueEntityCall('Trade', 'list', '-exit_timestamp') // Fetch all trades, deduplication will filter duplicates and open positions
      ]);

      if (DEBUG_COMBINATION_STATS) {
        // Removed [CS] logs
      }

      setCombinations(combinationsData || []);

      // MODIFIED: Update trade history processing with deduplication
      // CRITICAL FIX: Deduplicate trades before using them for stats
      const rawTrades = tradesData || [];
      
      // Deduplication logic: same as used in other parts of the system
      // A duplicate is defined as same symbol, entry_price, exit_price, quantity, entry_timestamp (within 1 second), and strategy_name
      const deduplicatedTrades = [];
      const seenTrades = new Map();
      
      for (const trade of rawTrades) {
        // Skip trades without exit_timestamp (open positions)
        if (!trade.exit_timestamp || trade.exit_timestamp === null || trade.exit_timestamp === undefined || trade.exit_timestamp === '') {
          continue;
        }
        
        // Primary deduplication: by position_id if available (most reliable)
        if (trade.position_id) {
          if (seenTrades.has(trade.position_id)) {
            const existing = seenTrades.get(trade.position_id);
            // Keep the one with the most complete data or later exit_timestamp
            if (trade.exit_timestamp > existing.exit_timestamp || 
                (trade.exit_timestamp === existing.exit_timestamp && Object.keys(trade).length > Object.keys(existing).length)) {
              const index = deduplicatedTrades.indexOf(existing);
              if (index >= 0) deduplicatedTrades.splice(index, 1);
              seenTrades.set(trade.position_id, trade);
              deduplicatedTrades.push(trade);
            }
            continue;
          }
          seenTrades.set(trade.position_id, trade);
          deduplicatedTrades.push(trade);
          continue;
        }
        
        // Fallback deduplication: by trade characteristics
        const entryTs = new Date(trade.entry_timestamp);
        const entryTsRounded = Math.floor(entryTs.getTime() / 2000) * 2000; // Round to 2 seconds
        
        const uniqueKey = `${trade.symbol || ''}_${trade.strategy_name || ''}_${trade.entry_price || 0}_${trade.exit_price || 0}_${trade.quantity || trade.quantity_crypto || 0}_${entryTsRounded}_${trade.trading_mode || ''}`;
        
        if (seenTrades.has(uniqueKey)) {
          const existing = seenTrades.get(uniqueKey);
          // Keep the one with the most complete data or later exit_timestamp
          if (trade.exit_timestamp > existing.exit_timestamp || 
              (trade.exit_timestamp === existing.exit_timestamp && Object.keys(trade).length > Object.keys(existing).length)) {
            const index = deduplicatedTrades.indexOf(existing);
            if (index >= 0) deduplicatedTrades.splice(index, 1);
            seenTrades.set(uniqueKey, trade);
            deduplicatedTrades.push(trade);
          }
          continue;
        }
        
        seenTrades.set(uniqueKey, trade);
        deduplicatedTrades.push(trade);
      }
      
      
      setTradeHistory(deduplicatedTrades);

      //if (DEBUG_COMBINATION_STATS) console.log(`[CS] loadData() done: combos=${combinationsData?.length || 0}, trades=${processedTrades.length}`);

    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message || 'Failed to load data');
      toast({
        title: "Error",
        description: "Failed to load strategy data.",
        variant: "destructive",
      });
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [toast]);

  // Debounced batch update function
  const debouncedBatchUpdate = useCallback(async () => {
    const now = Date.now();

    // Rate limiting: Don't update more than once every 10 seconds
    // This is an outer guard to prevent hammering the backend too frequently
    if (now - lastUpdateTimeRef.current < 10000) {
      // If we recently sent an update, re-queue this function to run after the cool-down
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(debouncedBatchUpdate, 10000 - (now - lastUpdateTimeRef.current) + 1000); // Try again after cooldown + 1 sec
      // Removed [CS] log
      return;
    }

    const updates = Array.from(pendingUpdatesRef.current.entries());
    if (updates.length === 0) {
      // Removed [CS] log
      return;
    }

    // DEBUG LOG: Log the start of the database update process
    //if (DEBUG_COMBINATION_STATS) console.log(`[CS] DebouncedBatchUpdate: Starting to process ${updates.length} database updates.`);

    // Set last update time only when we are about to start processing
    lastUpdateTimeRef.current = now;
    // Clear pending updates for this batch (they will be re-added if failed due to rate limit)
    pendingUpdatesRef.current.clear();

    // Process updates in small batches to avoid overwhelming the API
    // The inner loop processes `BATCH_SIZE` items before a `BATCH_DELAY`
    const BATCH_SIZE = 3;
    const UPDATE_DELAY_MS = 500; // Delay between individual updates within a batch
    const BATCH_DELAY_MS = 2000; // Delay between batches

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      // Process each update in the batch
      for (const [strategyName, updateData] of batch) {
        try {
          // Find the combination by name, as IDs might change or not be immediately available if list not yet refreshed
          const strategyToUpdate = combinations.find(c => c.combinationName === strategyName);
          if (strategyToUpdate) {
            // DEBUG LOG: Log the exact data being sent to the database
            //if (DEBUG_COMBINATION_STATS) console.log(`[CS] Persisting update for ${strategyName} (ID: ${strategyToUpdate.id}) with data:`, updateData);
            await BacktestCombination.update(strategyToUpdate.id, updateData);
            // Add small delay between updates to respect rate limits
            await new Promise(resolve => setTimeout(resolve, UPDATE_DELAY_MS));
          } else {
            // Removed [CS] log
          }
        }
        catch (err) {
          // Check for common rate limit or network error messages
          const errorMessage = err.message?.toLowerCase();
          if (errorMessage?.includes('429') || errorMessage?.includes('rate limit') || errorMessage?.includes('network error') || errorMessage?.includes('failed to fetch')) {
            // Removed [CS] log
            // Re-queue this update for later attempt
            pendingUpdatesRef.current.set(strategyName, updateData);
          } else {
            // Removed [CS] log
          }
        }
      }

      // Delay between batches only if there are more updates to process
      if (i + BATCH_SIZE < updates.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // After processing, if there are still pending updates (due to re-queuing),
    // schedule another run after a longer delay
    if (pendingUpdatesRef.current.size > 0) {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      // Removed [CS] log
      updateTimeoutRef.current = setTimeout(debouncedBatchUpdate, 15000); // Retry re-queued items after 15 seconds
    } else {
      // Removed [CS] log
    }

  }, [combinations]);

  // NEW: Persist derived stats into BacktestCombination with debounce when stats change
  useEffect(() => {
    if (!combinations.length) return;
    const updatesQueued = [];

    combinations.forEach(combo => {
      const s = strategyStats[combo.combinationName];
      if (!s) return; // Should not happen if strategyStats is comprehensive

      // Compare with current stored values on the combination object itself
      // to avoid noisy writes.
      // Use || 0 for numbers to handle undefined/null for comparison
      // Use ?? null for conviction if null is a valid state
      const current = {
        realTradeCount: combo.realTradeCount || 0,
        realSuccessRate: combo.realSuccessRate || 0,
        realAvgPnlPercent: combo.realAvgPnlPercent || 0,
        realProfitFactor: combo.realProfitFactor || 0,
        realAvgConvictionScore: combo.realAvgConvictionScore ?? null,
        latestTradeTimestamp: combo.latestTradeTimestamp ?? null, // NEW
      };

      const target = {
        realTradeCount: s.realTradeCount || 0,
        realSuccessRate: s.realSuccessRate || 0,
        realAvgPnlPercent: s.realAvgPnlPercent || 0,
        realProfitFactor: s.realProfitFactor || 0,
        realAvgConvictionScore: s.realAvgConvictionScore ?? null,
        latestTradeTimestamp: s.latestTradeTimestamp ?? null, // NEW
      };

      // Check for differences with a small tolerance for floating point numbers
      const hasDiff =
        current.realTradeCount !== target.realTradeCount ||
        Math.abs(current.realSuccessRate - target.realSuccessRate) > 0.001 ||
        Math.abs(current.realAvgPnlPercent - target.realAvgPnlPercent) > 0.001 ||
        Math.abs(current.realProfitFactor - target.realProfitFactor) > 0.001 ||
        (current.realAvgConvictionScore ?? null) !== (target.realAvgConvictionScore ?? null) ||
        (current.latestTradeTimestamp ?? null) !== (target.latestTradeTimestamp ?? null); // NEW: Compare timestamps

      if (hasDiff) {
        pendingUpdatesRef.current.set(combo.combinationName, target);
        updatesQueued.push(combo.combinationName);
      }
    });

    if (updatesQueued.length > 0) {
      // Removed [CS] log
      // Clear existing timeout and set new one to trigger debouncedBatchUpdate
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = setTimeout(() => {
        // Removed [CS] log
        debouncedBatchUpdate();
      }, 2000); // Debounce by 2 seconds
    } else {
      // Removed [CS] log
    }
  }, [strategyStats, combinations, debouncedBatchUpdate]);


  // New function to handle automatic opt-out of underperforming strategies
  const handleAutoOptOut = useCallback(async (options = {}) => {
    const { skipToast = false } = options;

    // FIXED: Rate limit auto opt-out checks to prevent spam - only run once every 30 seconds
    const now = Date.now();
    if (now - lastAutoOptOutCheckRef.current < 30000) {
      if (!skipToast) {
        toast({
          title: "Auto Opt-Out Rate Limited",
          description: "A check was performed recently. Please wait before trying again.",
          variant: "destructive",
          duration: 3000,
        });
      }
      // Removed [CS] log
      return;
    }
    lastAutoOptOutCheckRef.current = now;
    // Removed [CS] log

    setIsProcessingAutoOptOut(true);

    try {
      // Find strategies that meet the criteria: >=20 demo trades AND P/F < 1
      const strategiesToOptOut = combinations.filter(combo => {
        const currentStats = strategyStats[combo.combinationName];
        // CRITICAL FIX: The criteria should only apply if auto opt-out is enabled.
        // And ensure we don't try to opt-out already opted-out strategies.
        return (
          autoOptOutEnabled &&
          (currentStats?.realTradeCount || 0) >= 20 &&
          (currentStats?.realProfitFactor || 0) < 1 &&
          !combo.optedOutGlobally
        );
      });

      if (strategiesToOptOut.length === 0) {
        if (!skipToast) {
          toast({
            title: "Auto Opt-Out Check Complete",
            description: "No new underperforming strategies found.",
            duration: 3000,
          });
        }
        // Removed [CS] log
        return;
      }

      // Batch opt-out these strategies
      const optOutIds = strategiesToOptOut.map(s => s.id);
      //if (DEBUG_COMBINATION_STATS) console.log(`[CS] Auto opt-out: ${strategiesToOptOut.length} strategies identified:`, strategiesToOptOut.map(s => s.combinationName));

      await safeCombinationOperations({
        action: 'bulk_update',
        combinationIds: optOutIds,
        updateData: {
          optedOutGlobally: true,
          optedOutDate: new Date().toISOString()
        }
      });

      toast({
        title: "Auto Opt-Out Successful",
        description: `${strategiesToOptOut.length} underperforming strategies have been automatically opted out.`,
      });
      //if (DEBUG_COMBINATION_STATS) console.log(`[CS] Auto opt-out successful for ${strategiesToOptOut.length} strategies.`);

      // Refresh the combinations list after bulk update
      await loadData(false);

    } catch (error) {
      // Removed [CS] log
      toast({
        title: "Auto Opt-Out Failed",
        description: "Failed to automatically opt-out strategies: " + (error.message || "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setIsProcessingAutoOptOut(false);
    }
  }, [combinations, strategyStats, toast, loadData, autoOptOutEnabled]); // Added autoOptOutEnabled dependency

  // NEW: Handler for the button click to provide immediate feedback.
  const handleToggleAutoOptOut = () => {
    const isEnabling = !autoOptOutEnabled;
    setAutoOptOutEnabled(isEnabling);

    // If enabling, trigger the check immediately.
    if (isEnabling) {
      toast({
        title: "Auto Opt-Out Enabled",
        description: "Running an immediate check for underperforming strategies...",
      });
      // Pass options to the handler.
      handleAutoOptOut({ skipToast: true });
    } else {
       toast({
        title: "Auto Opt-Out Disabled",
        description: "Strategies will no longer be automatically opted out.",
      });
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Expose refresh function globally for manual refresh
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.refreshCombinationStats = () => {
        loadData(false);
      };
    }
    return () => {
      if (typeof window !== 'undefined' && window.refreshCombinationStats) {
        delete window.refreshCombinationStats;
      }
    };
  }, [loadData]);

  // Listen for global trade data refresh events
  useEffect(() => {
    const handleTradeRefresh = () => {
      loadData(false); // Refresh without showing loader
    };
    
    window.addEventListener('tradeDataRefresh', handleTradeRefresh);
    return () => {
      window.removeEventListener('tradeDataRefresh', handleTradeRefresh);
    };
  }, [loadData]);

  // MODIFIED: Watch for trade history changes from virtualWallet and trigger full data refresh
  useEffect(() => {
    // Only proceed if virtualWallet data is available
    if (!virtualWallet?.trade_history) return;

    const currentWalletTradeCount = virtualWallet.trade_history.length;

    // Only trigger processing when trade history actually grows (new trade closed in virtual wallet)
    if (currentWalletTradeCount > lastTradeHistoryLengthRef.current) {
      //if (DEBUG_COMBINATION_STATS) console.log(`[CS] New trade detected (old: ${lastTradeHistoryLengthRef.current}, new: ${currentWalletTradeCount}). Scheduling data refresh and auto opt-out.`);
      // Debounce the full data reload and subsequent actions
      if (autoOptOutTimeoutRef.current) {
        clearTimeout(autoOptOutTimeoutRef.current);
      }

      autoOptOutTimeoutRef.current = setTimeout(async () => {
        // Reload all data (combinations and trades) to ensure the latest are available
        await loadData(false); // Using false to prevent loading spinner on background refresh
        // Removed [CS] log

        // CRITICAL FIX: This is the right place to call the opt-out logic.
        // It runs after data is reloaded, ensuring it has the latest stats.
        if(autoOptOutEnabled) { // Double-check it's still enabled
           handleAutoOptOut({ skipToast: true });
        }

      }, 5000); // Wait 5 seconds after trade closure to allow data to settle and be processed

      lastTradeHistoryLengthRef.current = currentWalletTradeCount; // Update the ref
    } else if (currentWalletTradeCount < lastTradeHistoryLengthRef.current) {
      // This handles cases where history might be reset or reduced (e.g., user clears data)
      //if (DEBUG_COMBINATION_STATS) console.log(`[CS] Trade history shrunk (old: ${lastTradeHistoryLengthRef.current}, new: ${currentWalletTradeCount}). Refreshing all data.`);
      lastTradeHistoryLengthRef.current = currentWalletTradeCount;
      loadData(); // Also refresh complete data in this case to keep analytics accurate
    }

  }, [virtualWallet?.trade_history, autoOptOutEnabled, loadData, handleAutoOptOut]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (autoOptOutTimeoutRef.current) {
        clearTimeout(autoOptOutTimeoutRef.current);
      }
    };
  }, []);

  // Get unique values for filters
  const uniqueCoins = [...new Set(combinations.map(c => c.coin))].sort();
  const uniqueTimeframes = [...new Set(combinations.map(c => c.timeframe))].sort();
  const uniqueRegimes = [...new Set(combinations.map(c => c.dominantMarketRegime).filter(Boolean))].sort(); // NEW: Get unique regimes


  // MODIFIED: Update filtered and sorted combinations to handle new latestTradeTimestamp field
  const filteredAndSortedCombinations = useMemo(() => {
    let filtered = combinations.filter(combination => {
      const currentStats = strategyStats[combination.combinationName];

      if (DEBUG_COMBINATION_STATS) {
        // console.log('[CS] filter check:', {
        //   name: combination.combinationName,
        //   realTrades: currentStats?.realTradeCount || 0,
        //   pf: currentStats?.realProfitFactor || 0,
        //   statusFilter,
        //   performanceFilter,
        //   demoTradesMin: demoTradesFilter[0],
        // });
      }

      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!combination.combinationName?.toLowerCase().includes(searchLower) &&
            !combination.coin?.toLowerCase().includes(searchLower) &&
            !combination.dominantMarketRegime?.toLowerCase().includes(searchLower) &&
            !combination.signals?.some(s => s.type?.toLowerCase().includes(searchLower))) {
          return false;
        }
      }

      // Coin filter
      if (coinFilter !== 'all' && combination.coin !== coinFilter) return false;

      // Timeframe filter
      if (timeframeFilter !== 'all' && combination.timeframe !== timeframeFilter) return false;

      // NEW: Regime filter
      if (regimeFilter !== 'all' && combination.dominantMarketRegime !== regimeFilter) return false;

      // Status filter
      if (statusFilter !== 'all') {
        const isCurrentlyActiveInScanner = combination.includedInScanner || combination.includedInLiveScanner;
        const isCurrentlyOptedOut = combination.optedOutGlobally || combination.optedOutForCoin;

        if (statusFilter === 'active') { // "Active in Demo"
          // True if includedInScanner is true AND includedInLiveScanner is false (exclusive demo)
          if (!(combination.includedInScanner && !combination.includedInLiveScanner)) return false;
        } else if (statusFilter === 'live_active') { // "Active in Live"
          // True if includedInLiveScanner is true
          if (!combination.includedInLiveScanner) return false;
        } else if (statusFilter === 'inactive') {
          // True if NOT active in any scanner AND NOT opted out
          if (isCurrentlyActiveInScanner || isCurrentlyOptedOut) return false;
        } else if (statusFilter === 'opted_out') {
          // True if opted out globally or for coin
          if (!isCurrentlyOptedOut) return false;
        }
      }

      // Performance filter (uses derived real stats)
      if (performanceFilter !== 'all') {
        const pf = currentStats?.realProfitFactor || 0;
        const tradeCount = currentStats?.realTradeCount || 0;

        if (performanceFilter === 'profitable' && pf < 1) return false;
        if (performanceFilter === 'unprofitable' && pf >= 1) return false;
        if (performanceFilter === 'no_trades' && tradeCount > 0) return false;
      }

      // Demo Trades filter (uses derived real stats)
      if ((currentStats?.realTradeCount || 0) < demoTradesFilter[0]) return false;

      return true;
    });

    if (DEBUG_COMBINATION_STATS) {
      // Removed [CS] log
    }

    // Sort
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aVal, bVal;

        // NEW: Handle latestTradeTimestamp sorting
        if (sortConfig.key === 'latestTradeTimestamp') {
          const aTimestamp = strategyStats[a.combinationName]?.latestTradeTimestamp;
          const bTimestamp = strategyStats[b.combinationName]?.latestTradeTimestamp;

          // Convert to timestamps for comparison (null = oldest for asc, newest for desc)
          // Using 0 for null to put "Never" (null) at the beginning for 'asc' and end for 'desc' in numerical sort.
          aVal = aTimestamp ? new Date(aTimestamp).getTime() : (sortConfig.direction === 'asc' ? 0 : Number.MAX_SAFE_INTEGER);
          bVal = bTimestamp ? new Date(bTimestamp).getTime() : (sortConfig.direction === 'asc' ? 0 : Number.MAX_SAFE_INTEGER);
        } else if (sortConfig.key.startsWith('real')) {
          aVal = strategyStats[a.combinationName]?.[sortConfig.key];
          bVal = strategyStats[b.combinationName]?.[sortConfig.key];
        } else {
          aVal = a[sortConfig.key];
          bVal = b[sortConfig.key];
        }

        // Handle null/undefined values
        if (aVal == null) aVal = (sortConfig.direction === 'asc' ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
        if (bVal == null) bVal = (sortConfig.direction === 'asc' ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);

        // Special handling for strings
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortConfig.direction === 'asc' ?
            aVal.localeCompare(bVal) :
            bVal.localeCompare(aVal);
        }

        // Handle boolean values - false before true, or vice-versa
        if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
            if (sortConfig.direction === 'asc') {
                return (aVal === bVal) ? 0 : aVal ? 1 : -1; // false, then true
            } else {
                return (aVal === bVal) ? 0 : aVal ? -1 : 1; // true, then false
            }
        }

        // Numeric comparison
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    return filtered;
  }, [combinations, searchTerm, coinFilter, timeframeFilter, regimeFilter, statusFilter, performanceFilter, demoTradesFilter, sortConfig, strategyStats]);


  // Pagination
  const totalPages = Math.ceil(filteredAndSortedCombinations.length / ITEMS_PER_PAGE);
  const paginatedCombinations = filteredAndSortedCombinations.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Sorting handler
  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Row expansion handler
  const toggleRowExpansion = (id) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Selection handlers for bulk actions
  const handleSelectRow = (id, checked) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedRows(new Set(paginatedCombinations.map(c => c.id)));
    } else {
      setSelectedRows(new Set());
    }
  };

  // Bulk action handlers
  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedRows.size} selected strategies? This action is irreversible.`)) {
      return;
    }

    const strategiesToDelete = combinations.filter(c => selectedRows.has(c.id));
    const idsToDelete = Array.from(selectedRows);
    const namesToDelete = strategiesToDelete.map(c => c.combinationName);

    try {
      await deleteStrategyAndTrades({
        strategyNames: namesToDelete,
        backtestCombinationIds: idsToDelete
      });
      toast({
        title: "Success",
        description: `${selectedRows.size} strategies deleted successfully.`,
      });
      setSelectedRows(new Set());
      await loadData(false);
    } catch (err) {
      console.error("Bulk delete failed:", err);
      toast({
        title: "Error",
        description: "Failed to delete strategies. " + (err.message || "An unknown error occurred."),
        variant: "destructive",
      });
    }
  };

  const handleBulkOptOut = async () => {
    if (selectedRows.size === 0) return;
     if (!window.confirm(`Are you sure you want to globally opt-out ${selectedRows.size} selected strategies?`)) {
      return;
    }

    try {
       await safeCombinationOperations({
         action: 'bulk_update',
         combinationIds: Array.from(selectedRows),
         updateData: { optedOutGlobally: true, optedOutDate: new Date().toISOString() }
       });
       toast({
         title: "Success",
         description: `${selectedRows.size} strategies opted out globally.`,
       });
       setSelectedRows(new Set());
       await loadData(false);
    } catch (err) {
      console.error("Bulk opt-out failed:", err);
      toast({
         title: "Error",
         description: "Failed to opt-out strategies. " + (err.message || "An unknown error occurred."),
         variant: "destructive",
      });
    }
  };

  const handleBulkMarkForLive = async () => {
    if (filteredAndSortedCombinations.length === 0) {
      toast({
        title: "No Strategies to Mark",
        description: "Please adjust your filters to select strategies.",
        variant: "destructive",
      });
      return;
    }

    if (!window.confirm(`Are you sure you want to mark all ${filteredAndSortedCombinations.length} filtered strategies for live trading?`)) {
      return;
    }

    setIsBulkUpdating(true);
    try {
      const idsToUpdate = filteredAndSortedCombinations.map(c => c.id);
      await safeCombinationOperations({
        action: 'bulk_update',
        combinationIds: idsToUpdate,
        updateData: { includedInLiveScanner: true }
      });
      toast({
        title: "Success",
        description: `${idsToUpdate.length} strategies have been marked for live trading.`,
      });
      await loadData(false);
    } catch (err) {
      console.error("Bulk mark for live failed:", err);
      toast({
        title: "Error",
        description: "Failed to mark strategies for live trading. " + (err.message || "An unknown error occurred."),
        variant: "destructive",
      });
    } finally {
      setIsBulkUpdating(false);
    }
  };


  // Edit dialog handlers
  const handleEdit = (combination) => {
    setEditingCombination(combination);
    setShowEditDialog(true);
  };

  const handleOptOut = (combination) => {
    setEditingCombination(combination);
    setShowOptOutDialog(true);
  };

  const handleSaveEdit = async (updatedData) => {
    try {
      await BacktestCombination.update(editingCombination.id, updatedData);
      toast({
        title: "Success",
        description: "Strategy updated successfully.",
      });
      setShowEditDialog(false);
      setEditingCombination(null);
      await loadData(false);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update strategy.",
        variant: "destructive",
      });
    }
  };

  const handleOptOutConfirm = async (combination, scope) => {
    try {
      const updateData = scope === 'all_coins' ?
        { optedOutGlobally: true, optedOutDate: new Date().toISOString() } :
        { optedOutForCoin: true, optedOutDate: new Date().toISOString() };

      await BacktestCombination.update(combination.id, updateData);

      toast({
        title: "Success",
        description: `Strategy opted out ${scope === 'all_coins' ? 'globally' : 'for this coin'}.`,
      });

      setShowOptOutDialog(false);
      setEditingCombination(null);
      await loadData(false);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to opt out strategy.",
        variant: "destructive",
      });
    }
  };

  // Helper function to format latest trade timestamp
  const formatLatestTrade = (timestamp) => {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Show relative time for recent trades
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // Show formatted date for older trades
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Strategy Performance</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span className="text-lg">Loading strategy data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Strategy Performance</h1>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData()}
              className="ml-4"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isAllOnPageSelected = paginatedCombinations.length > 0 && selectedRows.size > 0 && paginatedCombinations.every(c => selectedRows.has(c.id));

  return (
    <div className="space-y-6">
      {/* Header with Auto Opt-Out Toggle */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Strategy Performance</h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(false)}
            className="flex items-center gap-2"
            title="Refresh demo trade counts and performance metrics"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Stats
          </Button>
          <Badge variant="secondary" className="text-xs">
            Auto-updating with live trades ({tradeHistory.length} total trades analyzed)
          </Badge>

          <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <Button
              variant={autoOptOutEnabled ? "destructive" : "outline"}
              size="sm"
              onClick={handleToggleAutoOptOut}
              disabled={isProcessingAutoOptOut}
              className="flex items-center gap-2"
            >
              {isProcessingAutoOptOut ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : autoOptOutEnabled ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Auto Opt-Out: ON
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Auto Opt-Out: OFF
                </>
              )}
            </Button>
            <div className="text-xs text-red-700 dark:text-red-300 max-w-48">
              Auto opt-out strategies with &gt;20 demo trades & P/F &lt;1
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <BarChart3 className="h-8 w-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Total Strategies</p>
                <p className="text-2xl font-bold">{combinations.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Active in Scanner</p>
                <p className="text-2xl font-bold">
                  {combinations.filter(c => (c.includedInScanner || c.includedInLiveScanner) && !c.optedOutGlobally && !c.optedOutForCoin).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Profitable (Demo)</p>
                <p className="text-2xl font-bold">
                  {combinations.filter(c => {
                    const currentStats = strategyStats[c.combinationName];
                    return (currentStats?.realProfitFactor || 0) >= 1 && (currentStats?.realTradeCount || 0) > 0;
                  }).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Activity className="h-8 w-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Demo Trades</p>
                <p className="text-2xl font-bold">
                  {Object.values(strategyStats).reduce((sum, stats) => sum + (stats.realTradeCount || 0), 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auto Opt-Out Status Card */}
      {autoOptOutEnabled && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <h4 className="font-semibold text-red-800 dark:text-red-200">Auto Opt-Out Active</h4>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Strategies with more than 20 demo trades and a profit factor below 1.0 will be automatically opted out from future scans.
                  Current candidates: {combinations.filter(c => {
                    const currentStats = strategyStats[c.combinationName];
                    return (currentStats?.realTradeCount || 0) > 20 && (currentStats?.realProfitFactor || 0) < 1 && !c.optedOutGlobally && !c.optedOutForCoin;
                  }).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Filter className="h-5 w-5 mr-2" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-5">
                <Input
                    placeholder="Search by name, coin, regime, or signal type..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full"
                />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Coin</label>
              <Select value={coinFilter} onValueChange={setCoinFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Coins</SelectItem>
                  {uniqueCoins.map(coin => (
                    <SelectItem key={coin} value={coin}>{coin}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Timeframe</label>
              <Select value={timeframeFilter} onValueChange={setTimeframeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Timeframes</SelectItem>
                  {uniqueTimeframes.map(tf => (
                    <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* NEW: Regime Filter */}
            <div>
              <label className="text-sm font-medium mb-2 block">Regime</label>
              <Select value={regimeFilter} onValueChange={setRegimeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Regimes</SelectItem>
                  {uniqueRegimes.map(regime => (
                    <SelectItem key={regime} value={regime}>{regime.charAt(0).toUpperCase() + regime.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active in Demo</SelectItem>
                  <SelectItem value="live_active">Active in Live</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="opted_out">Opted Out</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Performance</label>
              <Select value={performanceFilter} onValueChange={setPerformanceFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Performance</SelectItem>
                  <SelectItem value="profitable">Profitable (PF ≥ 1)</SelectItem>
                  <SelectItem value="unprofitable">Unprofitable (PF &lt; 1)</SelectItem>
                  <SelectItem value="no_trades">No Demo Trades</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="lg:col-span-2 xl:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Min. Demo Trades</Label>
                <Badge variant="secondary">{demoTradesFilter[0]}</Badge>
              </div>
              <Slider
                min={0}
                max={50}
                step={1}
                value={demoTradesFilter}
                onValueChange={setDemoTradesFilter}
                className="w-full mt-2"
              />
            </div>

            <div className="flex items-end lg:col-span-2 xl:col-span-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm('');
                  setCoinFilter('all');
                  setTimeframeFilter('all');
                  setRegimeFilter('all'); // NEW: Reset regime filter
                  setStatusFilter('all');
                  setPerformanceFilter('all');
                  setDemoTradesFilter([0]);
                  setCurrentPage(1);
                }}
                className="w-full"
              >
                Clear All Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions & Results Info */}
      <div className="flex items-center justify-between transition-all duration-300">
        <div className="flex items-center gap-4">
          {selectedRows.size > 0 ? (
            <div className="flex items-center gap-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <span className="text-sm font-semibold">{selectedRows.size} selected</span>
              <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
              <Button size="sm" variant="outline" onClick={handleBulkOptOut}>
                <EyeOff className="h-4 w-4 mr-2" />
                Opt-Out
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Showing {paginatedCombinations.length} of {filteredAndSortedCombinations.length} strategies
              {filteredAndSortedCombinations.length !== combinations.length &&
                ` (filtered from ${combinations.length} total)`}
            </p>
          )}

          <Button
              size="sm"
              variant="outline"
              className="bg-purple-100 hover:bg-purple-200 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:hover:bg-purple-900/60 dark:border-purple-700"
              onClick={handleBulkMarkForLive}
              disabled={isBulkUpdating || filteredAndSortedCombinations.length === 0}
          >
              {isBulkUpdating ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                  <Rocket className="h-4 w-4 mr-2" />
              )}
              Mark all {filteredAndSortedCombinations.length} filtered for Live
          </Button>
        </div>

        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
      </div>

      {/* Strategy Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={isAllOnPageSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="w-8">{/* Empty header for expand button */}</TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('combinationName')}
                  >
                    <div className="flex items-center">
                      Strategy Name
                      <SortIcon column="combinationName" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('coin')}
                  >
                    <div className="flex items-center">
                      Coin
                      <SortIcon column="coin" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                      className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                      onClick={() => handleSort('dominantMarketRegime')}
                  >
                      <div className="flex items-center">
                          Regime
                          <SortIcon column="dominantMarketRegime" sortConfig={sortConfig} />
                      </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('timeframe')}
                  >
                    <div className="flex items-center">
                      Timeframe
                      <SortIcon column="timeframe" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('signalCount')}
                  >
                    <div className="flex items-center">
                      Signals
                      <SortIcon column="signalCount" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('combinedStrength')}
                  >
                    <div className="flex items-center">
                      Combined Strength
                      <SortIcon column="combinedStrength" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('realAvgConvictionScore')}
                  >
                    <div className="flex items-center">
                      Conviction Score
                      <SortIcon column="realAvgConvictionScore" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('successRate')}
                  >
                    <div className="flex items-center">
                      Backtest Win %
                      <SortIcon column="successRate" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('profitFactor')}
                  >
                    <div className="flex items-center">
                      Backtest P/F
                      <SortIcon column="profitFactor" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('realTradeCount')}
                  >
                    <div className="flex items-center">
                      Demo Trades
                      <SortIcon column="realTradeCount" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  {/* NEW: Latest Trade Column */}
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('latestTradeTimestamp')}
                  >
                    <div className="flex items-center">
                      <Clock className="h-4 w-4 mr-1" />
                      Latest Trade
                      <SortIcon column="latestTradeTimestamp" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('realSuccessRate')}
                  >
                    <div className="flex items-center">
                      Demo Win %
                      <SortIcon column="realSuccessRate" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead
                    className="p-4 text-left font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort('realProfitFactor')}
                  >
                    <div className="flex items-center">
                      Demo P/F
                      <SortIcon column="realProfitFactor" sortConfig={sortConfig} />
                    </div>
                  </TableHead>
                  <TableHead className="p-4 text-left font-medium">Status</TableHead>
                  <TableHead className="p-4 text-left font-medium w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedCombinations.map((combination) => {
                  const currentStats = strategyStats[combination.combinationName];
                  return (
                    <React.Fragment key={combination.id}>
                      <TableRow className={`border-b hover:bg-muted/30 transition-colors ${selectedRows.has(combination.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`} onClick={() => handleSelectRow(combination.id, !selectedRows.has(combination.id))}>
                        <TableCell className="p-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedRows.has(combination.id)}
                            onCheckedChange={(checked) => handleSelectRow(combination.id, checked)}
                          />
                        </TableCell>
                        <TableCell className="p-4" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRowExpansion(combination.id)}
                            className="h-6 w-6 p-0"
                          >
                            {expandedRows.has(combination.id) ?
                              <ChevronDown className="h-4 w-4" /> :
                              <ChevronRight className="h-4 w-4" />
                            }
                          </Button>
                        </TableCell>
                        <TableCell className="p-4">
                          <div>
                            <div className="font-medium">
                              {combination.combinationName || 'Unnamed Strategy'}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              ID: {combination.id.substring(0, 8)}...
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="p-4">
                          <Badge variant="outline">
                            <Coins className="h-3 w-3 mr-1" />
                            {combination.coin}
                          </Badge>
                        </TableCell>
                        <TableCell className="p-4">
                          <RegimeBadge regime={combination.dominantMarketRegime} />
                        </TableCell>
                        <TableCell className="p-4">
                          <Badge variant="secondary">
                            <Clock className="h-3 w-3 mr-1" />
                            {combination.timeframe}
                          </Badge>
                        </TableCell>
                        <TableCell className="p-4 text-center">
                          <Badge variant="outline">
                            {combination.signalCount || 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="p-4 text-center">
                          <span className={`font-semibold ${getColorForMetric(combination.combinedStrength, 'combinedStrength')}`}>
                            {combination.combinedStrength ? Math.round(combination.combinedStrength) : 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="p-4 text-center">
                          <span className={`font-semibold ${getColorForMetric(currentStats?.realAvgConvictionScore, 'convictionScore')}`}>
                            {currentStats?.realAvgConvictionScore ? currentStats.realAvgConvictionScore.toFixed(1) : 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="p-4">
                          <span className={getColorForMetric(combination.successRate, 'successRate')}>
                            {combination.successRate ? combination.successRate.toFixed(1) : '0.0'}%
                          </span>
                        </TableCell>
                        <TableCell className="p-4">
                          <ProfitFactorCell value={combination.profitFactor || 0} />
                        </TableCell>
                        <TableCell className="p-4 text-center">
                          <span className={getColorForMetric(currentStats?.realTradeCount, 'default')}>
                            {currentStats?.realTradeCount || 0}
                          </span>
                        </TableCell>
                        <TableCell className="p-4">
                          <div className="flex items-center gap-1 text-sm">
                            {currentStats?.latestTradeTimestamp ? (
                              <>
                                <Activity className="h-3 w-3 text-blue-500" />
                                <span className="text-muted-foreground">
                                  {formatLatestTrade(currentStats.latestTradeTimestamp)}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground italic">Never</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="p-4">
                          <span className={getColorForMetric(currentStats?.realSuccessRate, 'successRate')}>
                            {currentStats?.realSuccessRate ? currentStats.realSuccessRate.toFixed(1) : '0.0'}%
                          </span>
                        </TableCell>
                        <TableCell className="p-4">
                          <ProfitFactorCell value={currentStats?.realProfitFactor || 0} />
                        </TableCell>
                        <TableCell className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {combination.includedInLiveScanner && (
                              <Badge variant="outline" className="text-xs text-purple-700 bg-purple-100 border-purple-300 dark:text-purple-200 dark:bg-purple-900/40 dark:border-purple-700">
                                <Rocket className="h-3 w-3 mr-1" />
                                Live
                              </Badge>
                            )}
                            {(combination.includedInScanner && !combination.includedInLiveScanner) && (
                              <Badge variant="success" className="text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Demo
                              </Badge>
                            )}
                            {combination.optedOutGlobally && (
                              <Badge variant="destructive" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1" />
                                Opted Out (Global)
                              </Badge>
                            )}
                            {combination.optedOutForCoin && (
                              <Badge variant="destructive" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1" />
                                Opted Out (Coin)
                              </Badge>
                            )}
                            {!(combination.includedInScanner || combination.includedInLiveScanner || combination.optedOutGlobally || combination.optedOutForCoin) && (
                              <Badge variant="secondary" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="p-4">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(combination)}
                              className="h-8 w-8 p-0"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOptOut(combination)}
                              className="h-8 w-8 p-0"
                              disabled={combination.optedOutGlobally || combination.optedOutForCoin}
                            >
                              {combination.optedOutGlobally || combination.optedOutForCoin ?
                                <EyeOff className="h-4 w-4" /> :
                                <Eye className="h-4 w-4" />
                              }
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(combination.id) && (
                        <TableRow><TableCell colSpan="17" className="p-0"><ExpandedRowContent combination={combination} strategyStats={strategyStats} /></TableCell></TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {paginatedCombinations.length === 0 && (
            <div className="text-center py-8">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No strategies found</p>
              <p className="text-muted-foreground">
                {filteredAndSortedCombinations.length === 0 ?
                  'Try adjusting your filters' :
                  'No strategies match your current filters'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      )}

      {/* Edit Dialog */}
      <EditStrategyDialog
        isOpen={showEditDialog}
        onClose={() => {
          setShowEditDialog(false);
          setEditingCombination(null);
        }}
        combination={editingCombination}
        onSave={handleSaveEdit}
      />

      {/* Opt Out Dialog */}
      <OptOutDialog
        isOpen={showOptOutDialog}
        onClose={() => {
          setShowOptOutDialog(false);
          setEditingCombination(null);
        }}
        combination={editingCombination}
        onConfirm={handleOptOutConfirm}
      />
    </div>
  );
}
