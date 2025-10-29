
import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Loader2, Save, X, Info, ShieldCheck, TrendingUp, Target, DollarSign, Activity, Waves, BarChart3, TrendingDown, AlertTriangle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { queueEntityCall } from '@/components/utils/apiQueue';
import { getKlineData } from '@/api/functions';
import { calculateATR as unifiedCalculateATR } from '@/components/utils/atrUnified';
import { BacktestCombination } from '@/api/entities';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getAutoScannerService } from '@/components/services/AutoScannerService'; // NEW: Import AutoScannerService

const generateWarThemedName = (existingNames, coin, signals) => {
  const adjectives = [
    'Fierce', 'Brutal', 'Swift', 'Deadly', 'Iron', 'Steel', 'Thunder', 'Lightning', 'Fire', 'Ice',
    'Shadow', 'Dark', 'Crimson', 'Golden', 'Silver', 'Phantom', 'Ghost', 'Storm', 'War', 'Battle',
    'Raging', 'Furious', 'Savage', 'Wild', 'Frozen', 'Blazing', 'Electric', 'Toxic', 'Nuclear', 'Cyber'
  ];

  const nouns = [
    'Wolf', 'Dragon', 'Eagle', 'Tiger', 'Lion', 'Bear', 'Shark', 'Viper', 'Falcon', 'Hawk',
    'Warrior', 'Knight', 'Samurai', 'Ninja', 'Hunter', 'Assassin', 'Gladiator', 'Champion', 'Guardian', 'Sentinel',
    'Storm', 'Tempest', 'Hurricane', 'Tornado', 'Blizzard', 'Avalanche', 'Earthquake', 'Tsunami', 'Cyclone', 'Typhoon'
  ];

  const formations = [
    'Squad', 'Battalion', 'Regiment', 'Division', 'Corps', 'Brigade', 'Platoon', 'Company', 'Unit', 'Force',
    'Legion', 'Phalanx', 'Alliance', 'Coalition', 'Brotherhood', 'Order', 'Clan', 'Tribe', 'Guild', 'Society'
  ];

  let attempts = 0;
  let name = '';

  do {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const signalSuffix = signals.slice(0, 3).map((s) => s.type.replace(/[^A-Z]/g, '')).join('').toUpperCase().substring(0, 6);

    // Use coin if available, otherwise use a default
    const coinName = coin ? coin.replace('/', '') : 'Strategy';
    name = `${adj} ${noun} of ${coinName}`;
    if (signalSuffix) {
      name += `-${signalSuffix}`;
    }
    attempts++;
  } while (existingNames.has(name) && attempts < 50);

  existingNames.add(name);
  return name;
};

// NEW: Function to generate a unique signature from signal combination AND timeframe
const generateCombinationSignature = (signals, timeframe) => {
  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return '';
  }

  // Extract signal identifiers and sort them for consistency
  const signalIdentifiers = signals.map((signal) => {
    const type = signal.type || '';
    const value = signal.value || '';
    const params = signal.parameters || {};

    // Create a basic signature: type:value
    let identifier = `${type}:${value}`;

    // If there are important parameters, include key ones in the signature
    if (Object.keys(params).length > 0) {
      const paramString = Object.keys(params).
      sort() // Sort parameter keys for consistency
      .map((key) => `${key}=${params[key]}`).
      join(',');
      identifier += `[${paramString}]`;
    }

    return identifier;
  }).sort(); // Sort all signal identifiers alphabetically

  // NEW: Include timeframe in the signature to differentiate strategies across timeframes
  const signatureWithTimeframe = `TF:${timeframe}|${signalIdentifiers.join('+!')}`;
  
  return signatureWithTimeframe;
};

const formatDuration = (minutes) => {
  if (minutes === null || minutes === undefined || isNaN(minutes) || minutes < 0) {
    return 'N/A';
  }

  if (minutes === 0) {
    return '0 minutes';
  }

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = Math.round(minutes % 60); // Round minutes to nearest integer

  let parts = [];
  if (days > 0) {
    parts.push(`${days} day${days > 1 ? 's' : ''}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  }
  // Only add minutes if it's non-zero OR if there are no days/hours and minutes is the only significant part
  if (remainingMinutes > 0 || (days === 0 && hours === 0 && minutes < 60)) {
    parts.push(`${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`);
  }

  return parts.join(', ') || 'N/A';
};

const ATR_ADAPTIVE_DEFAULTS = {
  riskPercentage: 1,
  rewardRiskRatio: 1.5,
  stopLossAtrMultiplier: 1.0, // Reduced from 2.5 to 1.0 for more realistic short-term trading
  takeProfitAtrMultiplier: 1.5 // Reduced from 3.0 to 1.5 for more realistic short-term trading
};

// NEW: Function to get regime icon
const getRegimeIcon = (regime) => {
  switch (regime?.toLowerCase()) {
    case 'uptrend':
      return '↗️';
    case 'downtrend':
      return '↘️';
    case 'ranging':
      return '↔️';
    default:
      return '❓';
  }
};

// Strategy List Item Component - Updated to show regime properly
  const StrategyListItem = ({ strategy, isSelected, onSelect, isEnabled, onToggleEnabled }) => {
  const getRegimeColor = (regime) => {
    switch (regime?.toLowerCase()) {
      case 'uptrend':
        return 'text-green-600 bg-green-100 border-green-200 dark:bg-green-900/50 dark:text-green-400 dark:border-green-800';
      case 'downtrend':
        return 'text-red-600 bg-red-100 border-red-200 dark:bg-red-900/50 dark:text-red-400 dark:border-red-800';
      case 'ranging':
        return 'text-blue-600 bg-blue-100 border-blue-200 dark:bg-blue-900/50 dark:text-blue-400 dark:border-blue-800';
      default:
        return 'text-gray-600 bg-gray-100 border-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:border-gray-600';
    }
  };

  return (
    <div
      className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 mb-3 ${
        isSelected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30 dark:bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={`checkbox-${strategy.id}`}
          checked={isEnabled}
          onCheckedChange={onToggleEnabled}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-sm truncate">
              {strategy.combinationName}
              <span className="text-muted-foreground font-normal"> ({strategy.dominantMarketRegime?.toUpperCase() || 'UNKNOWN'})</span>
            </h4>
            {strategy.dominantMarketRegime && (
              <Badge
                variant="outline"
                className={`text-xs px-2 py-0.5 capitalize font-medium ${getRegimeColor(strategy.dominantMarketRegime)} flex items-center gap-1`}
              >
                <span>{getRegimeIcon(strategy.dominantMarketRegime)}</span>
                {strategy.dominantMarketRegime}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">{strategy.coin}</p>

          <div className="flex flex-wrap gap-1 mb-3">
            {strategy.signals &&
              strategy.signals.slice(0, 4).map((signal, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs px-2 py-0.5 font-normal">
                  {signal.type}
                </Badge>
              ))}
            {strategy.signals && strategy.signals.length > 4 && (
              <Badge variant="secondary" className="text-xs px-2 py-0.5 font-normal">
                +{strategy.signals.length - 4} more
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-muted-foreground">
              Profit Factor:{' '}
              <span className="font-bold text-green-600 dark:text-green-400">
                {isFinite(strategy.profitFactor) ? strategy.profitFactor.toFixed(2) : '∞'}
              </span>
            </div>
            <div className="text-muted-foreground">
              Success Rate:{' '}
              <span className="font-bold text-primary">{strategy.successRate?.toFixed(1) || 'N/A'}%</span>
            </div>
            <div className="text-muted-foreground">
              Occurrences:{' '}
              <span className="font-bold text-foreground">{strategy.occurrences || 0}</span>
            </div>
            <div className="text-muted-foreground">
              Avg Move:{' '}
              <span className="font-bold text-foreground">{strategy.netAveragePriceMove?.toFixed(2) || 'N/A'}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function SaveCombinationsButton({ combinations, timeframe, minProfitFactor, selectedCoins = [] }) {
  const { toast } = useToast();
  const [isSaveReviewDialogOpen, setIsSaveReviewDialogOpen] = useState(false);
  const [filteredCombinations, setFilteredCombinations] = useState([]);
  const [combinationStrategies, setCombinationStrategies] = useState({});
  const [profitFactorFilter, setProfitFactorFilter] = useState(minProfitFactor || 1.2); // Sync initial state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [allStrategiesAreDuplicates, setAllStrategiesAreDuplicates] = useState(false);

  // NEW: State for preloaded market data
  const [marketDataCache, setMarketDataCache] = useState(new Map());
  const [dataLoadingProgress, setDataLoadingProgress] = useState(0);
  const [isPreloadingData, setIsPreloadingData] = useState(false);

  // Sync the filter with the prop from the main page when the dialog opens or the prop changes.
  useEffect(() => {
    if (isSaveReviewDialogOpen) {
      setProfitFactorFilter(minProfitFactor || 1.2);
    }
  }, [isSaveReviewDialogOpen, minProfitFactor]);

  // NEW: Preload market data for all unique coins
  const preloadMarketData = async (strategies) => {
    setIsPreloadingData(true);
    setDataLoadingProgress(0);

    const uniqueCoins = [...new Set(strategies.map((s) => s.coin).filter(Boolean))];
    const dataCache = new Map();

    //console.log(`[MARKET_DATA] Preloading data for ${uniqueCoins.length} coins:`, uniqueCoins);

    // If no coins are available, skip market data fetching
    if (uniqueCoins.length === 0) {
      console.log(`[MARKET_DATA] No coins available for market data fetching`);
      setMarketDataCache(dataCache);
      setIsPreloadingData(false);
      return;
    }

    let processedCoins = 0;

    // OPTIMIZATION: Batch fetch all coins at once
    if (uniqueCoins.length > 0) {
      try {
        console.log(`[MARKET_DATA] 🚀 Batch fetching data for ${uniqueCoins.length} coins`);
        
        const symbolsToFetch = uniqueCoins.map(coin => coin.replace('/', ''));
        const response = await getKlineData({
          symbols: symbolsToFetch,
          interval: timeframe || '4h',
          limit: 100
        });

        if (response?.success && response?.data) {
          // Process each coin from the batch response
          for (const coin of uniqueCoins) {
            if (!coin) continue;
            
            const coinDataContainer = response.data[coin.replace('/', '')];
            let klineData;
            
            if (coinDataContainer && coinDataContainer.success && Array.isArray(coinDataContainer.data)) {
              klineData = coinDataContainer.data;
            }
            
            if (klineData && klineData.length > 0) {
              const latestCandle = klineData[klineData.length - 1];
              const currentPrice = parseFloat(latestCandle[4]);

              // NEW: Calculate historical price range from the fetched data
              const historicalHighs = klineData.map(candle => parseFloat(candle[2])); // High prices
              const historicalLows = klineData.map(candle => parseFloat(candle[3]));  // Low prices
              const historicalHigh = Math.max(...historicalHighs);
              const historicalLow = Math.min(...historicalLows);
              
              // Calculate historical range metrics
              const rangeSize = historicalHigh - historicalLow;
              // Ensure rangeSize is not zero to prevent division by zero
              const currentPositionInRange = rangeSize > 0 ? ((currentPrice - historicalLow) / rangeSize) * 100 : 0;

              const atrValues = unifiedCalculateATR(klineData, 14, { debug: false, validateData: true });
              // Use a default value of 0 if ATR is null or undefined
              const latestAtr = atrValues && atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;

              // CRITICAL FIX: Add a check to ensure latestAtr is a valid number
              const atrToLog = typeof latestAtr === 'number' ? latestAtr.toFixed(6) : 'N/A';

              dataCache.set(coin, {
                price: currentPrice,
                atr: typeof latestAtr === 'number' ? latestAtr : 0, // Ensure a number is stored
                // NEW: Add historical price range data
                historicalHigh,
                historicalLow,
                rangeSize,
                currentPositionInRange,
                timestamp: Date.now(),
                error: null
              });

              processedCoins++;
              const progressPercentage = (processedCoins / uniqueCoins.length) * 100;
              setDataLoadingProgress(progressPercentage);

              //console.log(`[MARKET_DATA] ✅ ${coin}: Price=$${currentPrice.toFixed(4)}, ATR=$${atrToLog}, Range: $${historicalLow.toFixed(4)} - $${historicalHigh.toFixed(4)}`);
            } else {
              // ATR DEBUG: Log failure reason
              dataCache.set(coin, {
                price: 0,
                atr: 0,
                historicalHigh: 0,
                historicalLow: 0,
                rangeSize: 0,
                currentPositionInRange: 0,
                timestamp: Date.now(),
                error: 'No valid kline data'
              });
            }
          }
        } else {
          console.error(`[MARKET_DATA] ❌ Batch request failed:`, response?.error);
          // Set default values for all coins
          for (const coin of uniqueCoins) {
            dataCache.set(coin, {
              price: 0,
              atr: 0,
              historicalHigh: 0,
              historicalLow: 0,
              rangeSize: 0,
              currentPositionInRange: 0,
              timestamp: Date.now(),
              error: response?.error || 'Batch request failed'
            });
          }
        }
      } catch (error) {
        console.error(`[MARKET_DATA] ❌ Batch fetch failed:`, error.message);
        // Set default values for all coins
        for (const coin of uniqueCoins) {
          dataCache.set(coin, {
            price: 0,
            atr: 0,
            historicalHigh: 0,
            historicalLow: 0,
            rangeSize: 0,
            currentPositionInRange: 0,
            timestamp: Date.now(),
            error: error.message
          });
        }
      }
    }

    setMarketDataCache(dataCache);
    setIsPreloadingData(false);
    console.log(`[MARKET_DATA] Preloading complete. Cached data for ${dataCache.size} coins.`);
  };

  const handleReviewClick = async () => {
    setLoading(true);


    // Remove the 50 strategy limit - take ALL combinations
    const allCombinations = [...combinations].sort(
      (a, b) => (b.profitabilityScore || 0) - (a.profitabilityScore || 0)
    );

    if (allCombinations.length === 0) {
      toast({
        title: 'No Strategies Found',
        description: 'No combinations were found in the backtest results.',
        variant: 'destructive'
      });
      setLoading(false);
      return;
    }

    // Debug: Log input strategies before filtering
    console.log('[SAVE_COMBINATIONS] 📊 Input strategies count:', allCombinations.length);
    console.log('[SAVE_COMBINATIONS] 📊 Input strategies by coin:', allCombinations.reduce((acc, s) => {
      acc[s.coin] = (acc[s.coin] || 0) + 1;
      return acc;
    }, {}));
    console.log('[SAVE_COMBINATIONS] 📊 Sample input strategies:', allCombinations.slice(0, 3).map(s => ({ 
      coin: s.coin, 
      combinationName: s.combinationName,
      profitFactor: s.profitFactor,
      signals: s.signals?.map(sig => sig.type).join('+') || 'No signals'
    })));

    // Smart filtering to keep only the best version of each signal combination
    const filteredStrategies = filterForBestSignalVariations(allCombinations);
    
    // Debug: Log the strategies and their coin information
    console.log('[SAVE_COMBINATIONS] 📊 Filtered strategies count:', filteredStrategies.length);
    console.log('[SAVE_COMBINATIONS] 📊 Filtered strategies by coin:', filteredStrategies.reduce((acc, s) => {
      acc[s.coin] = (acc[s.coin] || 0) + 1;
      return acc;
    }, {}));
    console.log('[SAVE_COMBINATIONS] 📊 Filtered strategies with coin info:', filteredStrategies.map(s => ({ 
      coin: s.coin, 
      combinationName: s.combinationName,
      profitFactor: s.profitFactor 
    })));

    // Generate unique names for this display batch and assign unique IDs
    const namesForDisplay = new Set();
    const topPerformersWithNames = filteredStrategies.map((combo, index) => ({
      ...combo,
      // Preserve the original coin information from the backtesting results
      coin: combo.coin || 'BTC/USDT', // Only use fallback if coin is completely missing
      id: combo.id || `strategy-${index}-${combo.coin || 'Strategy'}-${combo.signals.map((s) => s.type).join('-')}`, // Ensure each strategy has a unique ID
      combinationName: generateWarThemedName(namesForDisplay, combo.coin || 'Strategy', combo.signals),
      // FIX: Map the regime data correctly
      dominantMarketRegime: combo.dominantMarketRegime || combo.marketRegime || null,
      marketRegimeDistribution: combo.marketRegimeDistribution || combo.marketRegimePerformance || null
    }));

    setFilteredCombinations(topPerformersWithNames);

    // Set up initial advanced strategy for each top performer
    const initialStrategies = {};
    topPerformersWithNames.forEach((combo) => {
      initialStrategies[combo.id] = {
        enabled: combo.profitFactor >= 1.5, // Auto-enable high-profit strategies
        riskPercentage: ATR_ADAPTIVE_DEFAULTS.riskPercentage,
        stopLossAtrMultiplier: ATR_ADAPTIVE_DEFAULTS.stopLossAtrMultiplier,
        takeProfitAtrMultiplier: ATR_ADAPTIVE_DEFAULTS.rewardRiskRatio * ATR_ADAPTIVE_DEFAULTS.stopLossAtrMultiplier,
        enableTrailingTakeProfit: true,
        combinationName: combo.combinationName, // Store combination name for consistency
        strategyDirection: 'long'
      };
    });
    setCombinationStrategies(initialStrategies);

    // Set the default profit factor filter to the prop value or 1.2
    setProfitFactorFilter(minProfitFactor || 1.2);

    // NEW: Preload market data before opening the dialog
    await preloadMarketData(topPerformersWithNames);

    // NEW: Check for existing strategies to prevent duplicate saves
    try {
      const existingStrategies = await queueEntityCall('BacktestCombination', 'list');
      const existingSignatures = new Set(
        existingStrategies
          .map((strategy) => strategy.combination_signature)
          .filter((signature) => signature && signature.trim() !== '')
      );

      // Check if all strategies are duplicates
      const allStrategiesAreDuplicates = topPerformersWithNames.every((combo) => {
        const signature = generateCombinationSignature(combo.signals, timeframe);
        return existingSignatures.has(signature);
      });

      setAllStrategiesAreDuplicates(allStrategiesAreDuplicates);
    } catch (error) {
      console.error('Error checking for existing strategies:', error);
      setAllStrategiesAreDuplicates(false); // Default to false if check fails
    }

    // Auto-select the first strategy
    if (topPerformersWithNames.length > 0) {
      setSelectedStrategyId(topPerformersWithNames[0].id);
    }

    setIsSaveReviewDialogOpen(true);
    setLoading(false);
  };

  const filterForBestSignalVariations = (strategies) => {
    // Filter to keep only the best version of each unique signal combination PER COIN
    const signalCombinationMap = new Map();
    
    strategies.forEach(strategy => {
      // Create a unique key based on signal types (sorted for consistency) AND coin
      const signalTypes = strategy.signals.map(s => s.type).sort().join('+');
      const coin = strategy.coin || 'Unknown';
      const key = `${coin}-${signalTypes}`; // Include coin in key to separate by coin
      
      // Keep the best strategy for each coin-signal combination
      if (!signalCombinationMap.has(key) || 
          strategy.profitabilityScore > signalCombinationMap.get(key).profitabilityScore) {
        signalCombinationMap.set(key, strategy);
      }
    });
    
    // Convert map values to array
    const filteredStrategies = Array.from(signalCombinationMap.values());
    
    console.log(`[STRATEGY_FILTER] Filtered ${strategies.length} strategies down to ${filteredStrategies.length} unique signal combinations (per coin)`);
    console.log(`[STRATEGY_FILTER] Strategies by coin:`, filteredStrategies.reduce((acc, s) => {
      acc[s.coin] = (acc[s.coin] || 0) + 1;
      return acc;
    }, {}));
    return filteredStrategies;
  };

  // NEW: Get market data from cache
  const getMarketData = (coin) => {
    // If no coin is provided, return a default state without loading
    if (!coin) {
      return { 
        isLoading: false, 
        price: null, 
        atr: null, 
        historicalHigh: null, 
        historicalLow: null, 
        rangeSize: null, 
        currentPositionInRange: null, 
        error: 'No coin data available' 
      };
    }
    
    const cachedData = marketDataCache.get(coin);
    if (!cachedData) {
      return { isLoading: true, price: null, atr: null, historicalHigh: null, historicalLow: null, rangeSize: null, currentPositionInRange: null, error: null };
    }

    if (cachedData.error) {
      return {
        isLoading: false,
        price: null,
        atr: null,
        historicalHigh: 0, // Ensure these are numbers for calculations later
        historicalLow: 0,
        rangeSize: 0,
        currentPositionInRange: 0,
        error: `Market data unavailable for ${coin}: ${cachedData.error}`
      };
    }

    return {
      isLoading: false,
      price: cachedData.price,
      atr: cachedData.atr,
      historicalHigh: cachedData.historicalHigh,
      historicalLow: cachedData.historicalLow,
      rangeSize: cachedData.rangeSize,
      currentPositionInRange: cachedData.currentPositionInRange,
      error: null
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // STEP 1: Fetch existing strategy signatures to prevent duplicates
      const existingStrategies = await queueEntityCall('BacktestCombination', 'list');
      const existingSignatures = new Set(
        existingStrategies.
        map((strategy) => strategy.combination_signature).
        filter((signature) => signature && signature.trim() !== '')
      );

      // STEP 2: Build strategies to save with signature generation
      const allStrategiesToSave = Object.keys(combinationStrategies).
      filter((id) => combinationStrategies[id]?.enabled).
      map((id) => {
        const combo = filteredCombinations.find((f) => f.id === id);
        const strategyConfig = combinationStrategies[id];
        if (!combo) return null;

        // MODIFIED: Pass timeframe to signature generation
        const signature = generateCombinationSignature(combo.signals, timeframe);

        return {
          combo,
          strategyConfig,
          signature,
          strategyData: {
            coin: combo.coin,
            timeframe: timeframe,
            signals: combo.signals || [],
            combination_signature: signature,
            signalCount: combo.signals?.length || 0,
            combinedStrength: combo.combinedStrength || (combo.signals?.reduce((sum, signal) => sum + (signal.strength || 0), 0) || 0),
            successRate: combo.successRate || 0,
            occurrences: combo.occurrences || 0,
            occurrenceDates: combo.matches?.map((m) => ({
              date: new Date(m.time).toISOString(),
              price: m.price,
              priceMove: m.priceMove,
              successful: m.successful,
              exitTime: m.exitTime,
              marketRegime: m.marketRegime
            })) || [],
            avgPriceMove: combo.netAveragePriceMove || 0,
            profitFactor: combo.profitFactor || 0,
            dominantMarketRegime: combo.dominantMarketRegime || combo.marketRegime || null,
            marketRegimeDistribution: combo.marketRegimeDistribution || combo.marketRegimePerformance || null,
            recommendedTradingStrategy: '',
            includedInScanner: true,
            combinationName: strategyConfig.combinationName || combo.combinationName || '',
            riskPercentage: strategyConfig.riskPercentage,
            stopLossAtrMultiplier: strategyConfig.stopLossAtrMultiplier,
            takeProfitAtrMultiplier: strategyConfig.takeProfitAtrMultiplier,
            enableTrailingTakeProfit: strategyConfig.enableTrailingTakeProfit,
            estimatedExitTimeMinutes: combo.avgWinDurationMinutes || 240,
            strategyDirection: strategyConfig.strategyDirection,
            medianLowestLowDuringBacktest: combo.medianLowestLowDuringBacktest ?? null,
          }
        };
      }).filter(Boolean);

      // STEP 3: Filter out duplicates based on signature
      const strategiesToSave = [];
      const duplicateStrategies = [];

      allStrategiesToSave.forEach((item) => {
        if (existingSignatures.has(item.signature)) {
          duplicateStrategies.push(item);
        } else {
          strategiesToSave.push(item.strategyData);
          existingSignatures.add(item.signature);
        }
      });

      // STEP 4: Bulk save strategies using API queue for rate limiting
      if (strategiesToSave.length === 0) {
        const totalSelected = allStrategiesToSave.length;
        const duplicateCount = duplicateStrategies.length;

        if (duplicateCount > 0) {
          toast({
            title: 'No New Strategies to Save',
            description: `All ${totalSelected} selected ${totalSelected === 1 ? 'strategy' : 'strategies'} already exist in the database (including timeframe variations).`,
            type: 'info',
            duration: 6000 // Show for 6 seconds
          });
        } else {
          toast({
            title: 'No Strategies Selected',
            description: 'Please select at least one strategy to save.',
            type: 'warning',
            duration: 5000 // Show for 5 seconds
          });
        }
        return;
      }

      // Use API queue for bulk creation - this handles rate limiting automatically
      await queueEntityCall('BacktestCombination', 'bulkCreate', strategiesToSave);

      // STEP 5: Show success results
      const duplicateCount = duplicateStrategies.length;
      const savedCount = strategiesToSave.length;

      let title = `Successfully saved ${savedCount} ${savedCount === 1 ? 'strategy' : 'strategies'}!`;
      let description = '';

      if (duplicateCount > 0) {
        description = `${duplicateCount} duplicate ${duplicateCount === 1 ? 'strategy was' : 'strategies were'} skipped (including timeframe duplicates).`;
      }

      // NEW: Notify the auto scanner to refresh its strategy list
      if (savedCount > 0) {
        try {
          const scannerService = getAutoScannerService();
          if (scannerService && typeof scannerService.refreshStrategies === 'function') {
            await scannerService.refreshStrategies();
            description += ` Auto scanner has been notified.`;
          }
        } catch (scannerError) {
          console.error('Error notifying auto scanner:', scannerError);
          // Don't fail the save operation if scanner notification fails
          description += ` (Failed to notify auto scanner: ${scannerError.message.substring(0, 50)}...)`;
        }
      }

      toast({
        title,
        description,
        type: 'success',
        duration: 8000 // Show for 8 seconds instead of default
      });

      setIsSaveReviewDialogOpen(false);
    } catch (error) {
      console.error('Error saving strategies:', error);

      let errorMessage = 'An error occurred while saving the strategies. Please try again.';
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
      }

      toast({
        title: 'Save Failed',
        description: errorMessage,
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const displayedCombinations = useMemo(() => {
    // FIX: Corrected syntax for filter condition
    return filteredCombinations.filter((combo) => (combo.profitFactor || 0) >= profitFactorFilter);
  }, [filteredCombinations, profitFactorFilter]);

  const selectedCombinationForAnalysis = selectedStrategyId
    ? filteredCombinations.find((strategy) => strategy.id === selectedStrategyId)
    : null;

  // StrategyAnalysisPanel Component - updated to show regime properly
  const StrategyAnalysisPanel = ({ strategy, marketData, walletBalance = 10000 }) => {
    const { isLoading, price, atr, historicalHigh, historicalLow, rangeSize, currentPositionInRange, error } = marketData;

    const calculations = useMemo(() => {
      // Allow calculation to proceed even if ATR is 0, as there's a fallback.
      if (isLoading || !price || !strategy || price <= 0) {
        return {
          positionValue: 0,
          stopLossPrice: 0,
          takeProfitPrice: 0,
          rewardRiskRatio: 0,
          riskAmount: 0,
          potentialProfit: 0,
          positionSizePercent: 0,
          slPercentage: 0,
          stopLossVsHistoricalLow: null, 
          stopLossRiskLevel: 'unknown' 
        };
      }

      // Get strategy parameters from combinationStrategies state (from parent component)
      const strategyParams = combinationStrategies[strategy.id] || {};
      const riskPercentage = strategyParams.riskPercentage || ATR_ADAPTIVE_DEFAULTS.riskPercentage;
      const stopLossMultiplier = strategyParams.stopLossAtrMultiplier || ATR_ADAPTIVE_DEFAULTS.stopLossAtrMultiplier;
      const takeProfitMultiplier =
        strategyParams.takeProfitAtrMultiplier ||
        ATR_ADAPTIVE_DEFAULTS.rewardRiskRatio * ATR_ADAPTIVE_DEFAULTS.stopLossAtrMultiplier;

      // Calculate risk amount
      const riskAmount = walletBalance * (riskPercentage / 100);
      const currentAtr = atr && atr > 0 ? atr : 0;

      // Calculate risk per share based on ATR. This will be 0 if ATR is 0.
      let riskPerShare = currentAtr * stopLossMultiplier;
      let stopLossPrice;
      let positionValue;
      let positionSizePercent;
      let takeProfitPrice;
      let potentialProfit;
      let rewardRiskRatio;
      let slPercentage;

      // Handle cases where riskPerShare is non-positive (e.g., ATR is 0)
      if (riskPerShare <= 0.00001 || !isFinite(riskPerShare)) {
        const fallbackRiskPercent = 0.02; // Use a 2% price move as fallback risk
        riskPerShare = price * fallbackRiskPercent;
        stopLossPrice = price - riskPerShare;
        positionValue = riskAmount / fallbackRiskPercent;
        positionSizePercent = (positionValue / walletBalance) * 100;
        takeProfitPrice = price + riskPerShare * 2; // Assume 2:1 RR for fallback
        potentialProfit = riskAmount * 2;
        rewardRiskRatio = 2.0;
        slPercentage = fallbackRiskPercent * 100;
      } else {
        // Standard ATR-based calculation
        stopLossPrice = price - riskPerShare;
        positionValue = riskAmount / (riskPerShare / price);
        positionSizePercent = (positionValue / walletBalance) * 100;
        takeProfitPrice = price + currentAtr * takeProfitMultiplier; // Use currentAtr here
        potentialProfit = positionValue * ((takeProfitPrice - price) / price);
        rewardRiskRatio = takeProfitMultiplier / stopLossMultiplier;
        slPercentage = (riskPerShare / price) * 100; // Calculate SL percentage
      }

      // NEW: Calculate historical range analysis
      let stopLossVsHistoricalLow = null;
      let stopLossRiskLevel = 'unknown';
      
      if (price > 0 && historicalLow > 0 && isFinite(stopLossPrice) && stopLossPrice > 0) {
        stopLossVsHistoricalLow = ((stopLossPrice - historicalLow) / historicalLow) * 100;
        
        // Determine risk level based on how close stop loss is to historical low
        if (stopLossPrice <= historicalLow) { // Stop loss is at or below historical low
          stopLossRiskLevel = 'high'; 
        } else if (stopLossVsHistoricalLow < 2) { // Stop loss is within 2% above historical low
          stopLossRiskLevel = 'medium'; 
        } else { // Stop loss is more than 2% above historical low
          stopLossRiskLevel = 'low'; 
        }
      }

      return {
        positionValue: isFinite(positionValue) ? positionValue : 0,
        stopLossPrice: isFinite(stopLossPrice) ? stopLossPrice : 0,
        takeProfitPrice: isFinite(takeProfitPrice) ? takeProfitPrice : 0,
        rewardRiskRatio: isFinite(rewardRiskRatio) ? rewardRiskRatio : 0,
        riskAmount: isFinite(riskAmount) ? riskAmount : 0,
        potentialProfit: isFinite(potentialProfit) ? potentialProfit : 0,
        positionSizePercent: isFinite(positionSizePercent) ? positionSizePercent : 0,
        slPercentage: isFinite(slPercentage) ? slPercentage : 0, // Add SL percentage
        stopLossVsHistoricalLow, 
        stopLossRiskLevel 
      };
    }, [strategy, price, atr, historicalLow, isLoading, walletBalance]);

    // FIX: Remove unnecessary dependencies from useEffect
    useEffect(() => {
      if (strategy && price && atr) {
      }
    }, [strategy, price, atr, calculations.stopLossPrice]); // FIX: Removed combinationStrategies dependency

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground p-6 border rounded-lg bg-gray-50 dark:bg-gray-800/30">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
          <p>Loading market data for {strategy.coin || 'strategy'}...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-red-600 dark:text-red-400 p-6 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
          <Info className="h-8 w-8 mr-3" />
          <p>{error}</p>
        </div>
      );
    }

    if (!strategy) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground p-6 border rounded-lg bg-gray-50 dark:bg-gray-800/30">
          <div className="text-center">
            <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Select a Strategy</p>
            <p className="text-sm">Click on a strategy from the list to see detailed analysis.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 h-full overflow-y-auto pr-2">
        <div className="border-b pb-4">
          <h3 className="text-xl font-bold break-words">
            {strategy.combinationName}
            <span className="text-muted-foreground font-normal"> ({strategy.dominantMarketRegime?.toUpperCase() || 'UNKNOWN'})</span>
          </h3>
          <p className="text-muted-foreground mb-3">{strategy.coin}</p>
          <div className="flex flex-wrap gap-2">
            {strategy.signals.map((signal, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs px-2 py-1">
                {signal.type}: {signal.value}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-900/20">
            <div className="flex items-center mb-2">
              <TrendingUp className="h-4 w-4 text-green-600 mr-2" />
              <span className="text-sm font-medium">Profit Factor</span>
            </div>
            <p className="text-2xl font-bold text-green-600">
              {strategy.profitFactor?.toFixed(2) || 'N/A'}
            </p>
          </div>
          <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-center mb-2">
              <Target className="h-4 w-4 text-blue-600 mr-2" />
              <span className="text-sm font-medium">Success Rate</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {strategy.successRate?.toFixed(1) || 'N/A'}%
            </p>
          </div>
        </div>

        {/* NEW: Expected Exit Time Section */}
        <div className="p-4 border rounded-lg bg-purple-50 dark:bg-purple-900/20">
          <h4 className="font-semibold flex items-center mb-4">
            <Clock className="h-4 w-4 mr-2 text-purple-500" />
            Expected Exit Time
          </h4>
          
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <Clock className="h-5 w-5 text-purple-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-purple-600">
                {formatDuration(strategy.avgWinDurationMinutes)}
              </p>
              <p className="text-xs text-muted-foreground">Average Hold Time</p>
            </div>
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <BarChart3 className="h-5 w-5 text-purple-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-purple-600">
                {strategy.occurrences || 0}
              </p>
              <p className="text-xs text-muted-foreground">Historical Occurrences</p>
            </div>
          </div>
          
          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <strong>Based on:</strong>
              {` ${strategy.avgWinDurationMinutes ? 
                `Average duration of ${Math.round((strategy.occurrences || 0) * (strategy.successRate || 0) / 100)} winning trades` : 
                'Historical pattern analysis'
              }`}
            </p>
          </div>
        </div>

        <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/50">
          <h4 className="font-semibold flex items-center mb-4">
            <ShieldCheck className="h-4 w-4 mr-2 text-blue-500" />
            ATR Adaptive Trade Setup
          </h4>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <DollarSign className="h-5 w-5 text-green-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-green-600">
                ${calculations.positionValue.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">Position Value</p>
              <p className="text-xs text-muted-foreground mt-1">
                {`${calculations.positionSizePercent.toFixed(1)}% of wallet`}
              </p>
            </div>
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <X className="h-5 w-5 text-red-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-red-600">
                ${calculations.stopLossPrice.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Stop Loss</p>
              <p className="text-xs font-semibold text-red-500 mt-1">
                {`(${calculations.slPercentage.toFixed(2)}%)`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <Target className="h-5 w-5 text-blue-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-blue-600">
                ${calculations.takeProfitPrice.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Take Profit</p>
              <p className="text-xs font-semibold text-green-500 mt-1">
                {`(${(calculations.slPercentage * calculations.rewardRiskRatio).toFixed(2)}%)`}
              </p>
            </div>
            <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border">
              <Activity className="h-5 w-5 text-purple-500 mx-auto mb-2" />
              <p className="text-lg font-bold text-purple-600">
                {calculations.rewardRiskRatio.toFixed(1)}:1
              </p>
              <p className="text-xs text-muted-foreground">Reward:Risk</p>
            </div>
             <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                       <div className="text-center p-3 bg-white dark:bg-gray-900/50 rounded-lg border cursor-help">
                            <Waves className="h-5 w-5 text-teal-500 mx-auto mb-2" />
                            <p className="text-lg font-bold text-teal-600">
                                {atr ? atr.toFixed(6) : 'N/A'}
                            </p>
                            <p className="text-xs text-muted-foreground">Current ATR</p>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                        <p className="font-semibold">Average True Range (ATR)</p>
                        <p className="text-sm text-muted-foreground">
                            ATR is a market volatility indicator. It measures the average price range over the last 14 candles. It is used here to set dynamic stop-loss and take-profit levels that adapt to the current market conditions.
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* FIXED: Median Historical Support Analysis */}
        <div className="p-4 border rounded-lg bg-orange-50 dark:bg-orange-900/20">
          <h4 className="font-semibold flex items-center mb-4">
            <TrendingUp className="h-4 w-4 mr-2 text-orange-500" />
            Historical Support Analysis
          </h4>
          
          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            {/* DEBUG: Log strategy data */}
            {console.log(`[SAVE_COMBINATIONS] Strategy ${strategy.combinationName} - medianLowestLowDuringBacktest:`, strategy.medianLowestLowDuringBacktest, 'type:', typeof strategy.medianLowestLowDuringBacktest)}
            {strategy.medianLowestLowDuringBacktest && typeof strategy.medianLowestLowDuringBacktest === 'number' && marketData.price > 0 ? (
              <div className="space-y-2">
                {/* FIXED: Display as percentage, not dollar amount */}
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Median Historical Support:
                  </span>
                  <span className="font-bold text-orange-600">
                    {strategy.medianLowestLowDuringBacktest.toFixed(2)}%
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-2">
                      (typical drawdown)
                    </span>
                  </span>
                </div>
                
                {/* Calculate the actual support price level from the percentage */}
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Estimated Support Price:
                  </span>
                  <span className="font-bold text-blue-600">
                    ${(marketData.price * (1 - strategy.medianLowestLowDuringBacktest / 100)).toFixed(4)}
                    <span className="text-xs font-normal text-blue-500 dark:text-blue-400 ml-2">
                      ({strategy.medianLowestLowDuringBacktest.toFixed(1)}% below current)
                    </span>
                  </span>
                </div>
                
                {/* ATR Stop Loss with Percentage */}
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    ATR Stop Loss:
                  </span>
                  <span className="font-bold text-red-600">
                    ${calculations.stopLossPrice.toFixed(4)}
                     <span className="text-xs font-normal text-red-500 dark:text-red-400 ml-2">
                      ({(((calculations.stopLossPrice - marketData.price) / marketData.price) * 100).toFixed(1)}%)
                    </span>
                  </span>
                </div>
                
                {/* FIXED: Risk assessment comparison using percentage */}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {(() => {
                    const atrStopLossPercent = Math.abs(((calculations.stopLossPrice - marketData.price) / marketData.price) * 100);
                    const historicalDrawdownPercent = strategy.medianLowestLowDuringBacktest;
                    
                    if (atrStopLossPercent < historicalDrawdownPercent) {
                      return (
                        <div className="flex items-center text-green-700 dark:text-green-300">
                          <div className="w-2 h-2 bg-green-500 rounded-full mr-2 flex-shrink-0"></div>
                          <span className="text-sm font-medium">
                            ✓ ATR Stop Loss ({atrStopLossPercent.toFixed(1)}%) is tighter than typical drawdown ({historicalDrawdownPercent.toFixed(1)}%) - Good risk management.
                          </span>
                        </div>
                      );
                    } else {
                      return (
                        <div className="flex items-center text-red-700 dark:text-red-300">
                          <div className="w-2 h-2 bg-red-500 rounded-full mr-2 flex-shrink-0"></div>
                          <span className="text-sm font-medium">
                            <AlertTriangle className="inline-block h-4 w-4 mr-1 text-red-500" />
                            ATR Stop Loss ({atrStopLossPercent.toFixed(1)}%) is wider than typical drawdown ({historicalDrawdownPercent.toFixed(1)}%) - Consider tighter SL.
                          </span>
                        </div>
                      );
                    }
                  })()}
                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">
                            What is Median Historical Support?
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          <p className="text-xs">
                            This represents the typical percentage drawdown (from entry price) observed during past occurrences 
                            of this strategy pattern. It shows how far prices typically fall before recovering, 
                            helping you set more intelligent stop-loss levels.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400">
                <p className="text-sm">No historical support data available</p>
                <p className="text-xs mt-1">This strategy may have limited backtest history</p>
              </div>
            )}
          </div>
        </div>

        {/* Risk Analysis Summary */}
        <div className="p-4 border rounded-lg bg-red-50 dark:bg-red-900/20">
          <h4 className="font-semibold flex items-center mb-4">
            <ShieldCheck className="h-4 w-4 mr-2 text-red-500" />
            Risk Analysis
          </h4>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Risk Amount</p>
              <p className="text-xl font-bold text-red-600">
                ${calculations.riskAmount.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {`${strategy.riskPercentage || ATR_ADAPTIVE_DEFAULTS.riskPercentage}% of $${walletBalance.toLocaleString()} wallet`}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Potential Profit</p>
              <p className="text-xl font-bold text-green-600">
                ${calculations.potentialProfit.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">If take-profit hit</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Current Price</p>
              <p className="text-xl font-bold text-blue-600">${price?.toFixed(4) || '0.00'}</p>
              <p className="text-xs text-muted-foreground mt-1">Live price for {strategy.coin}</p>
            </div>
          </div>

          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <strong>Base Risk:</strong>
              {` ${combinationStrategies[strategy.id]?.riskPercentage || ATR_ADAPTIVE_DEFAULTS.riskPercentage}% • `}
              <strong>Wallet:</strong>
              {` $${walletBalance.toLocaleString()} • `}
              <strong>Max Risk:</strong>
              {` $${calculations.riskAmount.toFixed(2)}`}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Button onClick={handleReviewClick} disabled={loading || combinations.length === 0} className="w-full">
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Review & Save Top Strategies
      </Button>

      <Dialog open={isSaveReviewDialogOpen} onOpenChange={setIsSaveReviewDialogOpen}>
        <DialogContent className="bg-slate-50 p-0 relative max-w-7xl w-[90vw] h-[85vh] flex flex-col">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="text-xl">Save Profitable Trading Strategies</DialogTitle>
            <DialogDescription>
              Review the top-performing strategies found in the backtest. Select strategies from the list to see
              detailed analysis and save them for auto-scanning.
            </DialogDescription>
          </DialogHeader>

          {/* Loading overlay for data preloading */}
          {isPreloadingData && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center z-10 rounded-lg">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-lg font-medium">Loading Market Data</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Fetching live prices and ATR values for analysis...
                </p>
                <div className="w-64 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${dataLoadingProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">{`${Math.round(dataLoadingProgress)}% complete`}</p>
              </div>
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            {/* Left Column - Strategy List */}
            <div className="w-1/2 border-r border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
              {/* Filtering Controls */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold">Filtering Criteria</h3>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const newStrategies = { ...combinationStrategies };
                        displayedCombinations.forEach((combo) => {
                          if (newStrategies[combo.id]) {
                            newStrategies[combo.id] = { ...newStrategies[combo.id], enabled: true };
                          }
                        });
                        setCombinationStrategies(newStrategies);
                      }}
                    >
                      Select All
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const newStrategies = { ...combinationStrategies };
                        displayedCombinations.forEach((combo) => {
                          if (newStrategies[combo.id]) {
                            newStrategies[combo.id] = { ...newStrategies[combo.id], enabled: false };
                          }
                        });
                        setCombinationStrategies(newStrategies);
                      }}
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Minimum Profit Factor: {profitFactorFilter.toFixed(1)}</Label>
                    <Slider
                      value={[profitFactorFilter]}
                      onValueChange={(value) => setProfitFactorFilter(value[0])}
                      min={0.5}
                      max={5.0}
                      step={0.1}
                      className="mt-2"
                    />

                    <p className="text-xs text-muted-foreground mt-1">
                      Showing {displayedCombinations.length} of {filteredCombinations.length} strategies
                    </p>
                  </div>
                </div>
              </div>

              {/* Strategy List */}
              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                <h3 className="text-base font-semibold mb-3">
                  Available Strategies ({displayedCombinations.length})
                </h3>
                <div className="space-y-2">
                  {displayedCombinations.map((strategy) => (
                    <StrategyListItem
                      key={strategy.id}
                      strategy={strategy}
                      isSelected={selectedStrategyId === strategy.id}
                      onSelect={() => setSelectedStrategyId(strategy.id)}
                      isEnabled={combinationStrategies[strategy.id]?.enabled || false}
                      onToggleEnabled={(enabled) => {
                        setCombinationStrategies((prev) => ({
                          ...prev,
                          [strategy.id]: { ...prev[strategy.id], enabled }
                        }));
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column - Strategy Analysis */}
            <div className="w-1/2 flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <h3 className="text-base font-semibold">Strategy Analysis</h3>
                {selectedCombinationForAnalysis ? (
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedCombinationForAnalysis.combinationName} • {selectedCombinationForAnalysis.coin}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a strategy to see detailed analysis</p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                {selectedCombinationForAnalysis ? (
                  <StrategyAnalysisPanel
                    strategy={selectedCombinationForAnalysis}
                    marketData={getMarketData(selectedCombinationForAnalysis.coin)}
                    walletBalance={10000}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-lg text-muted-foreground">Select a Strategy</p>
                      <p className="text-sm text-muted-foreground">
                        Choose a strategy from the list to see detailed risk analysis, position sizing, and trade setup
                        information.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setIsSaveReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={saving || allStrategiesAreDuplicates} 
              className="min-w-[150px]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {allStrategiesAreDuplicates 
                ? `All Strategies Already Saved (${Object.values(combinationStrategies).filter((s) => s.enabled).length})`
                : `Save Selected (${Object.values(combinationStrategies).filter((s) => s.enabled).length})`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
