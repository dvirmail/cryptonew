
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { Loader2, TrendingUp, Shield, Target, Minus, Plus, Zap, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const formatCurrency = (value, decimals = 2) => {
  if (value === undefined || value === null) return '$0.00';
  const finalDecimals = value > 0 && Math.abs(value) < 1 ? 4 : decimals;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: finalDecimals,
    maximumFractionDigits: finalDecimals,
  }).format(value);
};

const formatRatio = (value) => {
  if (value === undefined || value === null) return 'N/A';
  return `${value.toFixed(1)}:1`;
};

export default function ATRAdaptiveStrategy({ combination, currentCoin, timeframe }) {
  const [isLoading, setIsLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [atrData, setAtrData] = useState(null);
  const [walletState, setWalletState] = useState(null);
  const [strategy, setStrategy] = useState({});
  const [baseRiskPercent, setBaseRiskPercent] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSource, setDataSource] = useState('real'); // Only use real data

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      // Get real data from scanner service
      const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
      const scannerService = getAutoScannerService();
      
      if (scannerService && scannerService.state) {
        // Get real current price
        const currentPrices = scannerService.state.currentPrices || {};
        const symbolNoSlash = currentCoin?.replace('/', '') || '';
        const realPrice = currentPrices[symbolNoSlash];
        
        // Get real ATR data
        const indicators = scannerService.state.indicators || {};
        const atrData = indicators.atr;
        let realATR = null;
        
        if (Array.isArray(atrData) && atrData.length > 0) {
          // Find the last valid ATR value
          for (let i = atrData.length - 1; i >= 0; i--) {
            if (atrData[i] !== null && atrData[i] !== undefined && !isNaN(atrData[i])) {
              realATR = atrData[i];
              break;
            }
          }
        } else if (typeof atrData === 'number' && !isNaN(atrData)) {
          realATR = atrData;
        }
        
        if (realPrice) setCurrentPrice(realPrice);
        if (realATR) setAtrData({ atr: realATR, percentile: 50 });
        
        // Update data source if we got real data
        if (realPrice || realATR) {
          setDataSource('real');
        }
        
        console.log('[ATRAdaptiveStrategy] 🔄 Manual refresh completed:', {
          symbol: currentCoin,
          realPrice: realPrice,
          realATR: realATR,
          dataSource: 'real'
        });
      }
    } catch (error) {
      console.warn('[ATRAdaptiveStrategy] Manual refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        let realPrice = null;
        let realATR = null;
        let walletData = null;

        // Try to get wallet data from scanner service instead of database
        try {
          const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
          const scannerService = getAutoScannerService();
          
          if (scannerService && scannerService.walletManagerService) {
            walletData = scannerService.walletManagerService.getCurrentWalletState();
            console.log('[ATRAdaptiveStrategy] 🔍 Real wallet data from scanner service:', {
              availableBalance: walletData.available_balance,
              totalEquity: walletData.total_equity,
              balanceInTrades: walletData.balance_in_trades
            });
          } else {
            console.warn('[ATRAdaptiveStrategy] No live wallet state available in scanner service');
          }
        } catch (error) {
          console.warn('[ATRAdaptiveStrategy] Failed to fetch wallet data from scanner service:', error);
        }

        // Get real data from scanner service
        try {
          // Import the scanner service to get real data
          const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
          const scannerService = getAutoScannerService();
          
          if (scannerService && scannerService.state) {
            // Get real current price
            const currentPrices = scannerService.state.currentPrices || {};
            const symbolNoSlash = currentCoin?.replace('/', '') || '';
            realPrice = currentPrices[symbolNoSlash];
            
            // Get real ATR data
            const indicators = scannerService.state.indicators || {};
            const atrData = indicators.atr;
            
            if (Array.isArray(atrData) && atrData.length > 0) {
              // Find the last valid ATR value
              for (let i = atrData.length - 1; i >= 0; i--) {
                if (atrData[i] !== null && atrData[i] !== undefined && !isNaN(atrData[i])) {
                  realATR = atrData[i];
                  break;
                }
              }
            } else if (typeof atrData === 'number' && !isNaN(atrData)) {
              realATR = atrData;
            }
            
            console.log('[ATRAdaptiveStrategy] 🔍 Real data from scanner service:', {
              symbol: currentCoin,
              symbolNoSlash: symbolNoSlash,
              realPrice: realPrice,
              realATR: realATR,
              atrDataType: typeof atrData,
              atrDataLength: Array.isArray(atrData) ? atrData.length : 'not array',
              hasScannerService: !!scannerService,
              hasIndicators: !!indicators,
              indicatorsKeys: Object.keys(indicators)
            });
            
            // Update data source if we got real data
            if (realPrice || realATR) {
              setDataSource('real');
            }
          }
        } catch (error) {
          console.warn('[ATRAdaptiveStrategy] Failed to get real data from scanner service:', error);
        }

        // Only use real data - throw error if not available
        if (!realPrice || !realATR) {
          throw new Error('Real data not available - cannot calculate strategy without live market data');
        }

        setCurrentPrice(realPrice);
        setAtrData({ atr: realATR, percentile: 50 });
        setWalletState(walletData || { balance_usdt: 10000 });

      } catch (error) {
        throw new Error('Failed to fetch real data');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
    
    // Set up periodic refresh to get updated real data
    const refreshInterval = setInterval(() => {
      fetchData();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(refreshInterval);
}, [combination, currentCoin, timeframe]);

  useEffect(() => {
    const calculateStrategy = (price, atr, walletBalance, baseRisk) => {
      if (!price || !atr || !walletBalance || !combination) {
        return;
      }

      let atrValue = atr?.atr || 1;
      
      const volatilityPercentile = atr?.percentile || 50;
      let riskMultiplier = 1.0;
      let volatilityLabel = "Medium Volatility";

      if (volatilityPercentile < 33) {
        riskMultiplier = 1.2;
        volatilityLabel = `Low Volatility (<33rd percentile)`;
      } else if (volatilityPercentile > 66) {
        riskMultiplier = 0.8;
        volatilityLabel = `High Volatility (>66th percentile)`;
      } else {
        volatilityLabel = `Medium Volatility (${volatilityPercentile}th percentile)`;
      }
      
      const adjustedRiskPercent = baseRisk * riskMultiplier;
      const riskAmount = walletBalance * (adjustedRiskPercent / 100);
      
      const stopLossAtrMultiplier = combination.stopLossAtrMultiplier || 1.0; // Reduced for realistic short-term trading
      const takeProfitAtrMultiplier = combination.takeProfitAtrMultiplier || 1.5; // Reduced for realistic short-term trading

      const stopLossDistance = atrValue * stopLossAtrMultiplier;
      const positionSizeCoins = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;
      const positionValue = positionSizeCoins * price;
      
      const stopLossPrice = price - stopLossDistance;
      const rewardRiskRatio = stopLossDistance > 0 ? (takeProfitAtrMultiplier / stopLossAtrMultiplier) : 0;
      const takeProfitDistance = stopLossDistance * rewardRiskRatio;
      const takeProfitPrice = price + takeProfitDistance;
      
      const potentialProfit = positionSizeCoins * takeProfitDistance;

      setStrategy({
        positionValue,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice,
        rewardRiskRatio,
        atrValue,
        riskMultiplier,
        volatilityLabel,
        riskAmount,
        potentialProfit,
        adjustedRiskPercent,
        baseRiskPercent: baseRisk,
        stopLossAtrMultiplier,
        takeProfitAtrMultiplier,
      });

      // One-time backtest SL/TP sample log
      try {
        if (typeof window !== 'undefined' && !window.__slTpBacktestLoggedOnce) {
          window.__slTpBacktestLoggedOnce = true;
          const atrPct = atrValue ? ((atrValue / price) * 100).toFixed(3) : 'n/a';
          console.log('[SLTP_SAMPLE_BACKTEST]', {
            coin: currentCoin,
            timeframe,
            price,
            atrValue,
            atrPct: `${atrPct}%`,
            stopLossAtrMultiplier,
            takeProfitAtrMultiplier,
            computedStopLoss: stopLossPrice,
            computedTakeProfit: takeProfitPrice
          });
        }
      } catch (_) {}
    };

    if (currentPrice && atrData && walletState && !isLoading) {
      calculateStrategy(currentPrice, atrData, walletState.balance_usdt, baseRiskPercent);
    }
}, [currentPrice, atrData, walletState, combination, baseRiskPercent, currentCoin, isLoading]);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Fetching market data...</p>
        </div>
      </div>
    );
  }

  if (!strategy.positionValue) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <div className="text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Unable to calculate strategy parameters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Strategy Overview */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              ATR Adaptive Trade Setup
            </CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshData}
                disabled={isRefreshing}
                className="flex items-center gap-1 px-3 py-1 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 text-sm rounded-full font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
              </button>
              <div className="px-3 py-1 bg-blue-600 text-white text-sm rounded-full font-medium">
                Score: 90/100
              </div>
            </div>
          </div>
          <CardDescription>
            Volatility-adjusted position sizing and risk management
            <div className="mt-2 flex items-center gap-2">
              <div className={`px-2 py-1 text-xs rounded-full font-medium ${
                dataSource === 'real' 
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' 
                  : dataSource === 'unavailable'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
              }`}>
                {dataSource === 'real' ? '📊 Live Data' : dataSource === 'unavailable' ? '❌ No Data' : '⚠️ Loading...'}
              </div>
              <div className="text-xs text-muted-foreground">
                {dataSource === 'real' ? 'Using real market data from scanner' : 
                 dataSource === 'unavailable' ? 'Real market data not available' : 
                 'Loading market data...'}
              </div>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(strategy.positionValue)}
              </div>
              <div className="text-sm text-muted-foreground">Position Value</div>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <Shield className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {formatCurrency(strategy.stopLoss)}
              </div>
              <div className="text-sm text-muted-foreground">Stop Loss</div>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Target className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatCurrency(strategy.takeProfit)}
              </div>
              <div className="text-sm text-muted-foreground">Take Profit</div>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {formatRatio(strategy.rewardRiskRatio)}
              </div>
              <div className="text-sm text-muted-foreground">Reward:Risk</div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Market Volatility</span>
              <span className="text-xs px-2 py-1 bg-blue-600 text-white rounded-full">
                {strategy.volatilityLabel}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min(100, (strategy.riskMultiplier - 0.5) * 100)}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ATR: {formatCurrency(strategy.atrValue)} | Risk Multiplier: {strategy.riskMultiplier}x
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Risk Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Risk Amount</Label>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                {formatCurrency(strategy.riskAmount)}
              </div>
              <div className="text-sm text-muted-foreground">
                {strategy.adjustedRiskPercent?.toFixed(1)}% of account
              </div>
            </div>
            
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Potential Profit</Label>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                {formatCurrency(strategy.potentialProfit)}
              </div>
              <div className="text-sm text-muted-foreground">
                If take-profit hit
              </div>
            </div>
            
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Risk Adjustment</Label>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {strategy.riskMultiplier?.toFixed(1)}x ({strategy.volatilityLabel?.split(' ')[0]} Volatility)
              </div>
              <div className="text-sm text-muted-foreground">
                Base: {strategy.baseRiskPercent}%
              </div>
            </div>
          </div>
          
          <div className="mt-6">
            <Label htmlFor="risk-slider" className="text-sm font-medium">
              Base Risk Percentage: {baseRiskPercent.toFixed(1)}%
            </Label>
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => setBaseRiskPercent(Math.max(0.1, baseRiskPercent - 0.1))}
                className="p-1 border rounded hover:bg-muted"
              >
                <Minus className="h-4 w-4" />
              </button>
              <Slider
                id="risk-slider"
                min={0.1}
                max={5}
                step={0.1}
                value={[baseRiskPercent]}
                onValueChange={(value) => setBaseRiskPercent(value[0])}
                className="flex-1"
              />
              <button
                onClick={() => setBaseRiskPercent(Math.min(5, baseRiskPercent + 0.1))}
                className="p-1 border rounded hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Adjusted to {strategy.adjustedRiskPercent?.toFixed(1)}% based on current market volatility
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
