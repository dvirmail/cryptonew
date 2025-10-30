
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Trade } from "@/api/entities";
import { queueEntityCall } from "@/components/utils/apiQueue";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  History,
  RefreshCw,
  Info,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import SignalBadges from '@/components/trade-history/SignalBadges';
import TradeExitReason from '@/components/trade-history/TradeExitReason';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Helper function to get color based on value and max for a gradient effect
const getColorForValue = (value, max, reverse = false) => {
  if (value === null || value === undefined || isNaN(value)) return { color: 'rgb(156 163 175)' }; // gray-400 equivalent
  const percentage = Math.min(Math.max(value / max, 0), 1);
  // Hue ranges from green (120) to red (0) for `reverse = false` (higher is better, so green)
  // Or red (0) to green (120) for `reverse = true`
  const hue = reverse ? percentage * 120 : 120 - (percentage * 120);
  return { color: `hsl(${hue}, 80%, 65%)` };
};

// UPDATED: Safe date formatting to prevent Invalid Date errors
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return format(date, "MMM dd HH:mm");
  } catch (error) {
    console.warn('Date formatting error:', error, 'for date:', dateString);
    return 'Invalid Date';
  }
};

// UPDATED: Safe duration formatting
const formatDuration = (durationSeconds) => {
  if (durationSeconds === null || durationSeconds === undefined || isNaN(durationSeconds)) return 'N/A';

  const minutes = Math.floor(durationSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
};

// UPDATED: Safe formatting functions to prevent errors (existing, kept)
const formatPrice = (value) => {
  const numValue = Number(value || 0);
  if (isNaN(numValue)) return 'N/A';
  return `$${numValue.toFixed(2)}`;
};

const formatPercentage = (value) => {
  const numValue = Number(value || 0);
  if (isNaN(numValue)) return 'N/A';
  return `${numValue.toFixed(2)}%`;
};

export default function TradeHistory() {
  const { toast } = useToast();
  const { isLiveMode } = useTradingMode();
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    direction: "all",
    result: "all",
    symbol: "all",
    exitReason: "all",
    strategy: "",
    startDate: null,
    endDate: null,
    tradingMode: 'all',
    minPnL: '',
    maxPnL: '',
  });
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedTradeDetails, setSelectedTradeDetails] = useState(null);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);
  const [refreshError, setRefreshError] = useState(null);

  const fetchTrades = useCallback(async () => {
    setIsLoading(true);
    try {
      // OPTIMIZATION: Fetch trades directly from API instead of through queueEntityCall
      // This makes trade fetching independent of scanner initialization
      const response = await fetch('http://localhost:3003/api/trades?orderBy=-exit_timestamp&limit=1000');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const allTrades = result.success ? result.data : [];
      
      console.log('[TradeHistory] 📊 Fetched trades directly from API:', allTrades.length);
      setTrades(allTrades || []);
      setLastRefreshTime(new Date());
      setRefreshError(null);
    } catch (error) {
      console.error("[TradeHistory] ❌ Error fetching trades:", error);
      setRefreshError(error.message);
      toast({
        title: "Error",
        description: "Failed to load trade history. " + (error.message || "Please try again later."),
        variant: "destructive",
      });
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Manual refresh function
  const handleRefresh = useCallback(async () => {
    console.log('[TradeHistory] 🔄 Manual refresh triggered');
    await fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    let currentFiltered = [...trades];

    if (filters.tradingMode !== 'all') {
      currentFiltered = currentFiltered.filter(t => t.trading_mode === filters.tradingMode);
    }
    if (filters.direction !== 'all') {
      currentFiltered = currentFiltered.filter(t => t.direction === filters.direction);
    }
    if (filters.result !== 'all') {
      currentFiltered = currentFiltered.filter(t => (filters.result === 'profit' ? (t.pnl_usdt || 0) > 0 : (t.pnl_usdt || 0) <= 0));
    }
    if (filters.symbol !== 'all') {
      currentFiltered = currentFiltered.filter(t => t.symbol === filters.symbol);
    }
    if (filters.exitReason !== 'all') {
      currentFiltered = currentFiltered.filter(t => t.exit_reason === filters.exitReason);
    }
    if (filters.strategy) {
      currentFiltered = currentFiltered.filter(t => t.strategy_name?.toLowerCase().includes(filters.strategy.toLowerCase()));
    }
    if (filters.startDate) {
      const fromDate = new Date(filters.startDate);
      currentFiltered = currentFiltered.filter(t => new Date(t.exit_timestamp) >= fromDate);
    }
    if (filters.endDate) {
      const toDate = new Date(filters.endDate);
      toDate.setHours(23, 59, 59, 999);
      currentFiltered = currentFiltered.filter(t => new Date(t.exit_timestamp) <= toDate);
    }
    if (filters.minPnL !== '') {
      const minPnL = parseFloat(filters.minPnL);
      if (!isNaN(minPnL)) {
        currentFiltered = currentFiltered.filter(t => (t.pnl_usdt || 0) >= minPnL);
      }
    }
    if (filters.maxPnL !== '') {
      const maxPnL = parseFloat(filters.maxPnL);
      if (!isNaN(maxPnL)) {
        currentFiltered = currentFiltered.filter(t => (t.pnl_usdt || 0) <= maxPnL);
      }
    }

    setFilteredTrades(currentFiltered);
  }, [trades, filters]);

  const refreshData = () => {
    fetchTrades();
  };

  const stats = useMemo(() => {
    if (filteredTrades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgPnL: 0,
        totalFees: 0,
        grossProfit: 0,
        grossLoss: 0,
        profitFactor: 0,
        avgWinningTrade: 0,
        avgLosingTrade: 0,
        largestWin: 0,
        largestLoss: 0,
        avgDuration: 0
      };
    }

    const totalTrades = filteredTrades.length;
    const winningTrades = filteredTrades.filter(t => (t.pnl_usdt || 0) > 0);
    const losingTrades = filteredTrades.filter(t => (t.pnl_usdt || 0) < 0);

    const totalPnL = filteredTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
    const totalFees = filteredTrades.reduce((sum, t) => sum + (t.total_fees_usdt || 0), 0);

    const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl_usdt || 0), 0));

    const avgWinningTrade = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLosingTrade = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;

    const pnlValues = filteredTrades.map(t => t.pnl_usdt || 0);
    const largestWin = pnlValues.length > 0 ? Math.max(...pnlValues, 0) : 0;
    const largestLoss = pnlValues.length > 0 ? Math.min(...pnlValues, 0) : 0;

    const avgDuration = filteredTrades.reduce((sum, t) => sum + (t.duration_seconds || 0), 0) / totalTrades;
    const avgDurationMinutes = avgDuration / 60;

    return {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / totalTrades) * 100,
      totalPnL,
      avgPnL: totalPnL / totalTrades,
      totalFees,
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      avgWinningTrade,
      avgLosingTrade,
      largestWin,
      largestLoss,
      avgDuration: avgDurationMinutes
    };
  }, [filteredTrades]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleShowDetails = (trade) => {
    setSelectedTradeDetails(trade);
    setIsDetailsModalOpen(true);
  };

  const uniqueSymbols = useMemo(() => [...new Set(trades.map(trade => trade.symbol))], [trades]);
  const uniqueExitReasons = useMemo(() => [...new Set(trades.map(trade => trade.exit_reason))], [trades]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 text-blue-500 mb-4 animate-spin" />
          <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">Loading trade history...</p>
          <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">
            Fetching trades directly from database (independent of scanner)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Trade History</h1>
          <p className="text-muted-foreground">A log of all completed trades across all trading modes.</p>
          {lastRefreshTime && (
            <p className="text-xs text-muted-foreground mt-1">
              Last updated: {lastRefreshTime.toLocaleTimeString()}
            </p>
          )}
          {refreshError && (
            <p className="text-xs text-red-500 mt-1">
              Error: {refreshError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={isLiveMode ? 'live' : 'default'} className="flex items-center gap-1">
            {isLiveMode ? 'Live Mode' : 'Testnet Mode'}
          </Badge>
          <Button 
            variant="outline" 
            onClick={handleRefresh} 
            className="gap-2"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Filters</CardTitle>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              {showFilters ? "Hide Filters" : "Show Filters"}
            </Button>
          </div>
        </CardHeader>
        {showFilters && (
          <CardContent className="border-t pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="tradingMode">Trading Mode</Label>
                <Select value={filters.tradingMode} onValueChange={(value) => handleFilterChange('tradingMode', value)}>
                  <SelectTrigger id="tradingMode">
                    <SelectValue placeholder="All Modes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modes</SelectItem>
                    <SelectItem value="live">Live Only</SelectItem>
                    <SelectItem value="testnet">Testnet Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="direction">Direction</Label>
                <Select value={filters.direction} onValueChange={(value) => handleFilterChange('direction', value)}>
                  <SelectTrigger id="direction">
                    <SelectValue placeholder="All Directions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="result">Result</Label>
                <Select value={filters.result} onValueChange={(value) => handleFilterChange('result', value)}>
                  <SelectTrigger id="result">
                    <SelectValue placeholder="All Results" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="profit">Profit</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="symbol">Symbol</Label>
                <Select value={filters.symbol} onValueChange={(value) => handleFilterChange('symbol', value)}>
                  <SelectTrigger id="symbol">
                    <SelectValue placeholder="All Symbols" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Symbols</SelectItem>
                    {uniqueSymbols.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="exitReason">Exit Reason</Label>
                <Select value={filters.exitReason} onValueChange={(value) => handleFilterChange('exitReason', value)}>
                  <SelectTrigger id="exitReason">
                    <SelectValue placeholder="All Reasons" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    {uniqueExitReasons.map(er => (
                      <SelectItem key={er} value={er}>{er}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="strategy">Strategy</Label>
                <Input
                  id="strategy"
                  type="text"
                  placeholder="e.g., MyStrategyV1"
                  value={filters.strategy}
                  onChange={(e) => handleFilterChange('strategy', e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="dateFrom">Date From</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={filters.startDate ? format(filters.startDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value ? new Date(e.target.value) : null)}
                />
              </div>

              <div>
                <Label htmlFor="dateTo">Date To</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={filters.endDate ? format(filters.endDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value ? new Date(e.target.value) : null)}
                />
              </div>

              <div>
                <Label htmlFor="minPnL">Min P&L ($)</Label>
                <Input
                  id="minPnL"
                  type="number"
                  placeholder="e.g., -100"
                  value={filters.minPnL}
                  onChange={(e) => handleFilterChange('minPnL', e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="maxPnL">Max P&L ($)</Label>
                <Input
                  id="maxPnL"
                  type="number"
                  placeholder="e.g., 500"
                  value={filters.maxPnL}
                  onChange={(e) => handleFilterChange('maxPnL', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>


      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatPrice(stats.totalPnL)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
              {formatPercentage(stats.winRate)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Profit Factor</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTrades}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Trade Records ({filteredTrades.length} trades)
          </CardTitle>
          <CardDescription>A log of all your completed trades filtered by your criteria.</CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Exit Price</TableHead>
                  <TableHead>Combined Strength</TableHead>
                  <TableHead>Conviction</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Entry Time</TableHead>
                  <TableHead>Exit Time</TableHead>
                  <TableHead>Exit Reason</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrades.length > 0 ? (
                  filteredTrades.map((trade, index) => {
                    const pnlColor = (trade.pnl_usdt || 0) >= 0 ? "text-green-500" : "text-red-500";
                    const pnlPrefix = (trade.pnl_usdt || 0) >= 0 ? '+' : '';

                    return (
                      <TableRow key={`${trade.trade_id || trade.id || 'unknown'}-${index}`}>
                        <TableCell className="font-medium">{trade.symbol}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate" title={trade.strategy_name}>
                          {trade.strategy_name}
                        </TableCell>
                        <TableCell className="text-xs">
                          {trade.market_regime ? (
                            <Badge variant="secondary">{String(trade.market_regime)}</Badge>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.trading_mode === 'live' ? 'live' : 'default'}>
                            {trade.trading_mode?.toUpperCase() || 'UNKNOWN'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={trade.direction === "long" ? "success" : "destructive"}
                            className="flex items-center w-fit gap-1"
                          >
                            {trade.direction === "long" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                            {trade.direction === "long" ? "Long" : "Short"}
                          </Badge>
                        </TableCell>
                        <TableCell>${Number(trade.entry_price || 0).toFixed(4)}</TableCell>
                        <TableCell>${Number(trade.exit_price || 0).toFixed(4)}</TableCell>
                        <TableCell className="text-xs">
                          {trade.combined_strength !== undefined && trade.combined_strength !== null
                            ? Number(trade.combined_strength).toFixed(2)
                            : 'N/A'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {trade.conviction_score !== undefined && trade.conviction_score !== null
                            ? Number(trade.conviction_score).toFixed(2)
                            : 'N/A'}
                        </TableCell>
                        <TableCell className={`font-medium ${pnlColor}`}>
                          {pnlPrefix}{formatPrice(trade.pnl_usdt)} ({pnlPrefix}{formatPercentage(trade.pnl_percentage)})
                        </TableCell>
                        <TableCell>{formatDate(trade.entry_timestamp)}</TableCell>
                        <TableCell>{formatDate(trade.exit_timestamp)}</TableCell>
                        <TableCell>
                          <TradeExitReason reason={trade.exit_reason} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDuration(trade.duration_seconds)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                              <SignalBadges signals={trade.trigger_signals} />
                              <Button variant="ghost" size="icon" onClick={() => handleShowDetails(trade)} className="p-0 h-auto w-auto">
                                  <Info className="h-4 w-4 text-blue-500" />
                              </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      {isLoading ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                          Loading trades...
                        </div>
                      ) : (
                        trades.length === 0 ?
                          "No trades completed yet. Trades will appear here as positions are closed." :
                          "No trades found matching your criteria."
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedTradeDetails && (
        <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Trade Trigger Details</DialogTitle>
              <DialogDescription>
                The exact signal values that triggered the trade for <strong>{selectedTradeDetails.strategy_name}</strong> on {selectedTradeDetails.symbol}.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 max-h-[60vh] overflow-y-auto pr-4">
              {selectedTradeDetails.trigger_signals && selectedTradeDetails.trigger_signals.length > 0 ? (
                <div className="space-y-3">
                  {selectedTradeDetails.trigger_signals.map((signal, index) => (
                    <div key={index} className="p-3 bg-muted/50 rounded-lg border">
                      <p className="font-semibold text-sm">{signal.type}</p>
                      <p className="text-xs text-muted-foreground">{signal.value}</p>
                      {signal.details && <p className="text-xs font-mono mt-1 text-blue-400">{signal.details}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No trigger signal data was logged for this trade.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
