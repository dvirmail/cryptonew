
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { User } from "@/api/entities";
import { fetchCurrentPrice } from "@/components/utils/indicatorManager";
import { getAvailablePairs, fetchKlineData, formatKlineDataForChart } from "@/components/utils/indicatorManager";
import { useToast } from "@/components/ui/use-toast";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Clock,
  Target,
  Shield,
  Info,
  AlertTriangle,
  CheckCircle2,
  X,
  BarChart3,
  Activity,
  Zap,
  Gauge,
  History,
  Repeat,
  Wallet,
  Loader2,
  Users, // Added new icon
  Signal, // Added new icon
} from "lucide-react";
import { format } from "date-fns";

const DEMO_INITIAL_BALANCE = 10000;

// Enhanced component for displaying combination matches
function CombinationMatchCard({ combinationMatch, onExecute, onDismiss }) {
  if (!combinationMatch) return null;

  const {
    combination,
    matchedSignals,
    totalSignals,
    signalResults,
    currentPrice,
    timestamp
  } = combinationMatch;

  return (
    <Card className="border-green-200 dark:border-green-800 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/30 dark:to-blue-900/30 animate-fade-in-down mb-6 shadow-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-green-800 dark:text-green-200 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6" />
            <span>Combination Match: {combination.combinationName}</span>
          </div>
          <Badge variant="outline" className="ml-auto text-sm">
            {matchedSignals}/{totalSignals} Signals
          </Badge>
        </CardTitle>
        <CardDescription className="text-green-700 dark:text-green-300">
          Multiple technical indicators have aligned to trigger this high-probability trading opportunity.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Key Trading Information */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white/50 dark:bg-gray-800/50 rounded-lg">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Trading Pair</div>
            <div className="font-bold text-lg">{combination.coin}</div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Direction</div>
            <div>
              <Badge 
                variant={combination.strategyDirection === 'long' ? 'default' : 'destructive'} 
                className="text-base px-3 py-1.5"
              >
                {combination.strategyDirection === 'long' ? (
                  <ArrowUpRight className="h-4 w-4 mr-1.5" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 mr-1.5" />
                )}
                {combination.strategyDirection.toUpperCase()}
              </Badge>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Success Rate</div>
            <div className="font-bold text-lg flex items-center gap-2">
              <Gauge className="h-5 w-5 text-muted-foreground" />
              <span className="text-green-600 dark:text-green-400">
                {combination.successRate.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Current Price</div>
            <div className="font-bold text-lg">
              ${currentPrice?.toFixed(4) || 'Loading...'}
            </div>
          </div>
        </div>

        {/* Matched Signals Display */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Signal className="h-5 w-5 text-green-600" />
            <span className="text-sm font-medium text-green-800 dark:text-green-200">
              Triggered Signals ({matchedSignals} of {totalSignals}):
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {signalResults.map((result, i) => (
              <div 
                key={i} 
                className={`p-3 rounded-md border-l-4 ${
                  result.isMatch 
                    ? 'border-l-green-500 bg-green-50 dark:bg-green-900/20' 
                    : 'border-l-gray-300 bg-gray-50 dark:bg-gray-800/20'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">
                    {result.signal.type.toUpperCase()}
                  </span>
                  {result.isMatch ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-gray-400" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mb-1">
                  Condition: {result.signal.value}
                </div>
                <div className="text-xs font-mono">
                  Current: {result.latestValue}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Strategy Details */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Take Profit:</span>
              <div className="font-semibold text-blue-700 dark:text-blue-300">
                {combination.takeProfitPercentage}%
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Stop Loss:</span>
              <div className="font-semibold text-red-600 dark:text-red-400">
                {combination.stopLossPercentage}%
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Timeframe:</span>
              <div className="font-semibold">{combination.timeframe}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Est. Exit:</span>
              <div className="font-semibold">
                {Math.round(combination.estimatedExitTimeMinutes / 60)}h
              </div>
            </div>
          </div>
          
          {combination.enableTrailingTakeProfit && (
            <div className="mt-3 p-2 bg-blue-100 dark:bg-blue-900/50 rounded-md">
              <div className="text-xs text-blue-800 dark:text-blue-200 font-medium flex items-center gap-2">
                <Repeat className="h-3.5 w-3.5" />
                Trailing Take Profit Enabled ({combination.trailingStopPercentage}% trail)
              </div>
            </div>
          )}
        </div>

        {/* Historical Performance */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="text-sm font-medium mb-2">Historical Performance:</div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Occurrences:</span>
              <div className="font-semibold">{combination.occurrences}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Avg. Move:</span>
              <div className="font-semibold text-green-600">
                +{combination.avgPriceMove.toFixed(2)}%
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Win Rate:</span>
              <div className="font-semibold text-blue-600">
                {combination.successRate.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground text-center">
          Signal detected at: {timestamp ? format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss') : 'Just now'}
        </div>
      </CardContent>
      
      <CardFooter className="flex items-center justify-between gap-3 bg-gradient-to-r from-green-50/50 to-blue-50/50 dark:from-green-900/10 dark:to-blue-900/10 py-4 px-6">
        <Button variant="ghost" onClick={onDismiss} className="text-gray-600">
          Dismiss Signal
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            View Details
          </Button>
          <Button 
            className="bg-green-600 hover:bg-green-700 gap-2 px-6"
            onClick={() => onExecute(combination)}
          >
            <Zap className="h-4 w-4" />
            Execute Trade
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export default function Trading() {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(DEMO_INITIAL_BALANCE);
  const [positions, setPositions] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [currentPrices, setCurrentPrices] = useState({});
  const { toast } = useToast();
  
  // Changed state variable from recommendedTrade to combinationMatch
  const [combinationMatch, setCombinationMatch] = useState(null);

  // Manual trade form state
  const [pair, setPair] = useState("BTC/USDT");
  const [direction, setDirection] = useState("long");
  const [amount, setAmount] = useState(100);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  // Load user data on mount
  useEffect(() => {
    User.me().then(setUser).catch(() => setUser(null));
  }, []);

  // Listen for combination matches from the auto-scanner
  useEffect(() => {
    const checkForCombinationMatch = () => {
      const storedMatch = sessionStorage.getItem('combinationMatch');
      if (storedMatch) {
        try {
          const matchData = JSON.parse(storedMatch);
          setCombinationMatch(matchData);
        } catch (error) {
          console.error("Failed to parse combination match data:", error);
          sessionStorage.removeItem('combinationMatch');
        }
      } else {
        setCombinationMatch(null);
      }
    };

    checkForCombinationMatch(); // Check on initial load

    // Updated event listeners to use 'combinationMatch'
    window.addEventListener('combinationMatchChanged', checkForCombinationMatch);
    window.addEventListener('storage', (e) => {
        if (e.key === 'combinationMatch') {
            checkForCombinationMatch();
        }
    });

    return () => {
      window.removeEventListener('combinationMatchChanged', checkForCombinationMatch);
      window.removeEventListener('storage', (e) => {
        if (e.key === 'combinationMatch') {
            checkForCombinationMatch();
        }
      });
    };
  }, []);

  // Updated function name and logic for executing a combination match
  const handleExecuteCombination = (combination) => {
    setPair(combination.coin);
    setDirection(combination.strategyDirection);
    setTakeProfit(combination.takeProfitPercentage.toString());
    setStopLoss(combination.stopLossPercentage.toString());
    
    // Use the position size from the combination or a default, ensuring it doesn't exceed balance
    const suggestedAmount = combination.positionSizePercentage 
      ? (balance * combination.positionSizePercentage / 100) 
      : 100;
    setAmount(Math.min(suggestedAmount, balance).toFixed(0));

    toast({
      title: "Combination Parameters Loaded",
      description: `${combination.combinationName} parameters loaded. Review and execute.`,
    });

    // Scroll to the trade form
    const tradeForm = document.getElementById('manual-trade-form');
    tradeForm?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Updated function name and logic for dismissing a combination match
  const handleDismissCombination = () => {
    setCombinationMatch(null);
    sessionStorage.removeItem('combinationMatch');
    toast({
      title: "Combination Signal Dismissed",
      description: "The trading signal has been cleared.",
    });
  };

  // Fetch prices for all position pairs
  useEffect(() => {
    const pairsToFetch = [...new Set(positions.map(p => p.pair))];
    if (pairsToFetch.length === 0) return;

    const interval = setInterval(async () => {
      const prices = await Promise.all(
        pairsToFetch.map(p => fetchCurrentPrice(p).catch(() => ({ symbol: p, price: currentPrices[p] || 0 })))
      );
      setCurrentPrices(prev => ({
        ...prev,
        ...Object.fromEntries(prices.map(item => [item.symbol, parseFloat(item.price)]))
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, [positions, currentPrices]);

  const handleExecuteTrade = async () => {
    if (!amount || parseFloat(amount) <= 0) { // Ensure amount is parsed to a float for comparison
      toast({ title: "Invalid Amount", description: "Position size must be greater than zero.", variant: "destructive" });
      return;
    }
    if (parseFloat(amount) > balance) { // Ensure amount is parsed to a float for comparison
      toast({ title: "Insufficient Balance", description: `Your demo balance is only $${balance.toFixed(2)}.`, variant: "destructive" });
      return;
    }

    setIsExecuting(true);
    try {
      const priceData = await fetchCurrentPrice(pair);
      const entryPrice = parseFloat(priceData.price);
      
      const newPosition = {
        id: `pos_${Date.now()}`,
        pair,
        direction,
        entryPrice,
        amount: parseFloat(amount),
        takeProfit: takeProfit ? entryPrice * (1 + (direction === "long" ? parseFloat(takeProfit) / 100 : -parseFloat(takeProfit) / 100)) : null,
        stopLoss: stopLoss ? entryPrice * (1 - (direction === "long" ? parseFloat(stopLoss) / 100 : -parseFloat(stopLoss) / 100)) : null,
        entryDate: new Date(),
      };

      setPositions(prev => [...prev, newPosition]);
      setBalance(prev => prev - newPosition.amount);
      toast({ title: "Trade Executed", description: `${direction.toUpperCase()} position of $${amount} on ${pair} opened.` });

      // Clear form
      setAmount(100);
      setTakeProfit("");
      setStopLoss("");

    } catch (error) {
      toast({ title: "Execution Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExecuting(false);
    }
  };
  
  const handleClosePosition = (positionId) => {
    const position = positions.find(p => p.id === positionId);
    if (!position) return;

    const exitPrice = currentPrices[position.pair] || position.entryPrice;
    const pnl = (exitPrice - position.entryPrice) * (position.amount / position.entryPrice) * (position.direction === 'long' ? 1 : -1);

    const newTradeHistory = {
      ...position,
      exitPrice,
      exitDate: new Date(),
      pnl: pnl,
      pnlPercent: (pnl / position.amount) * 100
    };

    setTradeHistory(prev => [newTradeHistory, ...prev]);
    setPositions(prev => prev.filter(p => p.id !== positionId));
    setBalance(prev => prev + position.amount + pnl);

    toast({
      title: "Position Closed",
      description: `${position.pair} closed with a P&L of $${pnl.toFixed(2)}.`,
      variant: pnl >= 0 ? "default" : "destructive",
    });
  };

  const openPositionsWithPnl = useMemo(() => {
    return positions.map(pos => {
      const currentPrice = currentPrices[pos.pair] || pos.entryPrice;
      const pnl = (currentPrice - pos.entryPrice) * (pos.amount / pos.entryPrice) * (pos.direction === 'long' ? 1 : -1);
      const pnlPercent = (pnl / pos.amount) * 100;
      return { ...pos, pnl, pnlPercent };
    }).sort((a,b) => b.entryDate.getTime() - a.entryDate.getTime()); // Corrected comparison for Date objects
  }, [positions, currentPrices]);
  
  const sortedTradeHistory = useMemo(() => {
    return [...tradeHistory].sort((a,b) => b.exitDate.getTime() - a.exitDate.getTime()); // Corrected comparison for Date objects
  }, [tradeHistory]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Demo Trading</h1>
          <p className="text-muted-foreground mt-1">Practice your strategies with a virtual balance.</p>
        </div>
        <Card className="p-3 bg-background min-w-[200px]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/50 rounded-md">
              <Wallet className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Demo Balance</div>
              <div className="text-xl font-bold">${balance.toFixed(2)}</div>
            </div>
          </div>
        </Card>
      </header>
      
      {/* Conditionally render CombinationMatchCard instead of ScannerSignalCard */}
      {combinationMatch && (
        <CombinationMatchCard 
          combinationMatch={combinationMatch} 
          onExecute={handleExecuteCombination}
          onDismiss={handleDismissCombination}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Tabs defaultValue="positions" className="w-full">
            <TabsList>
              <TabsTrigger value="positions">Open Positions ({openPositionsWithPnl.length})</TabsTrigger>
              <TabsTrigger value="history">Trade History ({sortedTradeHistory.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="positions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Your Open Trades</CardTitle>
                  <CardDescription>Monitor your active demo positions in real-time.</CardDescription>
                </CardHeader>
                <CardContent>
                  {openPositionsWithPnl.length > 0 ? (
                    <div className="space-y-4">
                      {openPositionsWithPnl.map(pos => (
                        <div key={pos.id} className="p-3 border rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-4 flex-grow">
                             <div className={`p-2 rounded-full ${pos.direction === 'long' ? 'bg-green-100 dark:bg-green-900/50' : 'bg-red-100 dark:bg-red-900/50'}`}>
                                {pos.direction === 'long' ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                             </div>
                             <div>
                                <div className="font-bold">{pos.pair} <Badge variant={pos.direction === 'long' ? 'default' : 'destructive'}>{pos.direction.toUpperCase()}</Badge></div>
                                <div className="text-sm text-muted-foreground">
                                  Entry: ${pos.entryPrice.toFixed(4)} | Size: ${pos.amount.toFixed(2)} USDT
                                </div>
                             </div>
                          </div>
                          <div className={`font-semibold text-right ${pos.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            <div>{pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}</div>
                            <div className="text-sm">({pos.pnlPercent.toFixed(2)}%)</div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => handleClosePosition(pos.id)}>Close</Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground">
                      <BarChart3 className="h-12 w-12 mx-auto opacity-30 mb-2" />
                      No open positions. Execute a trade to get started.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Completed Trades</CardTitle>
                  <CardDescription>Review your past demo trading performance.</CardDescription>
                </CardHeader>
                <CardContent>
                  {sortedTradeHistory.length > 0 ? (
                    <div className="space-y-3">
                      {sortedTradeHistory.map(trade => (
                        <div key={trade.id} className="p-3 border rounded-lg flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-full ${trade.pnl >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                              {trade.pnl >= 0 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-red-600" />}
                            </div>
                            <div>
                              <div className="font-semibold">{trade.pair} <span className="text-xs text-muted-foreground">({trade.direction})</span></div>
                              <div className="text-xs text-muted-foreground">
                                Closed: {format(trade.exitDate, 'MMM d, HH:mm')}
                              </div>
                            </div>
                          </div>
                          <div className={`font-semibold text-right ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                             <div>{trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</div>
                             <div className="text-xs">({trade.pnlPercent.toFixed(2)}%)</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground">
                      <History className="h-12 w-12 mx-auto opacity-30 mb-2" />
                      No completed trades yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:col-span-1">
          <Card id="manual-trade-form">
            <CardHeader>
              <CardTitle>Execute a Demo Trade</CardTitle>
              <CardDescription>Manually place a trade with your virtual balance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="pair" className="text-sm font-medium">Pair</label>
                  <Select value={pair} onValueChange={setPair}>
                    <SelectTrigger>
                      <SelectValue placeholder="Enter pair" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BTC/USDT">BTC/USDT</SelectItem>
                      <SelectItem value="ETH/USDT">ETH/USDT</SelectItem>
                      <SelectItem value="BNB/USDT">BNB/USDT</SelectItem>
                      <SelectItem value="SOL/USDT">SOL/USDT</SelectItem>
                      <SelectItem value="XRP/USDT">XRP/USDT</SelectItem>
                      <SelectItem value="ADA/USDT">ADA/USDT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="direction" className="text-sm font-medium">Direction</label>
                  <Select value={direction} onValueChange={setDirection}>
                    <SelectTrigger>
                      <SelectValue placeholder="Enter direction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="long">Long (Buy)</SelectItem>
                      <SelectItem value="short">Short (Sell)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="amount" className="text-sm font-medium">Amount (USDT)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="amount" 
                    type="number"
                    placeholder="Enter amount" 
                    className="pl-9"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="tp" className="text-sm font-medium">Take Profit (%)</label>
                  <div className="relative">
                    <Target className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="tp" type="number" placeholder="Enter percentage" className="pl-9" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="sl" className="text-sm font-medium">Stop Loss (%)</label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="sl" type="number" placeholder="Enter percentage" className="pl-9" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={handleExecuteTrade}
                disabled={isExecuting}
              >
                {isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Execute {direction.charAt(0).toUpperCase() + direction.slice(1)}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
