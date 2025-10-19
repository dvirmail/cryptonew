
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter, // Added import
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge"; // Fixed: Corrected import syntax
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/use-toast";
import {
  Settings2, TrendingUp, AlertTriangle,
  LineChart as LineChartIconLucide, FilterX, Info, Save,
  ChevronRight, Loader2, BarChart3,
  Eye, AlertCircle, X, Terminal, BrainCircuit,
  Copy,
  Zap, // NEW: Import Zap icon
  Layers, // NEW: Import Layers icon
  ArrowLeftRight, // NEW: Import icon for ranging filter
  Globe // NEW: Import icon for "All" filter
} from "lucide-react";
import { format } from "date-fns";
import { processMatches, filterMatchesByBestCombination } from '@/components/backtesting/core/backtestProcessor';
import { runBacktestForCoin } from '@/components/backtesting/core/BacktestRunner'; // New import

import BacktestSummary from "../components/backtesting/BacktestSummary";
import PriceChart from "../components/backtesting/PriceChart";
import SignalMatchList from "../components/backtesting/SignalMatchList";
import SaveCombinationsButton from "../components/backtesting/SaveCombinationsButton";
import ExportResults from "../components/backtesting/ExportResults";
import CompareSignals from "../components/backtesting/CompareSignals";
import { MultiSelectCoin } from "../components/backtesting/MultiSelectCoin";
import DebugConsole from '@/components/backtesting/DebugConsole';
import TechnicalSignalPanel from "../components/backtesting/TechnicalSignalPanel";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger, // Fixed: Added TooltipTrigger import
} from "@/components/ui/tooltip";

import { validateCombinationSignals, logValidationIssues } from '../components/utils/signalValidation';
import { evaluateSignalCondition, initializeRegimeTracker, logRegimeStatistics } from '@/components/utils/signalLogic';
import { queueEntityCall } from "@/components/utils/apiQueue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch"; // NEW: Import Switch

// FIX: Import the canonical signal settings to ensure all signals are available.
import { defaultSignalSettings as defaultInternalSignalSettings } from '@/components/utils/signalSettings';

// Utility for throttling function calls
const throttle = (func, delay) => {
  let timeoutId = null;
  let lastArgs = null;
  let lastThis = null;
  let lastExecTime = 0;

  const throttled = function(...args) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;

    if (now - lastExecTime > delay) {
      // Execute immediately if enough time has passed
      lastExecTime = now;
      func.apply(lastThis, lastArgs);
      // Clear any pending timeout for immediate execution
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    } else if (!timeoutId) {
      // Otherwise, schedule for after the delay
      timeoutId = setTimeout(() => {
        lastExecTime = Date.now();
        timeoutId = null;
        func.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }, delay - (now - lastExecTime));
    }
  };

  throttled.cancel = () => {
    clearTimeout(timeoutId);
    timeoutId = null;
    lastArgs = null;
    lastThis = null;
  };

  return throttled;
};


// Constants are moved up before the component definition
const BACKTESTING_CONFIG_KEY = "preview_backtesting_config";
const CHUNK_DELAY = 150; // Not used in the current version of the code, but kept as per outline

// Add these performance optimization constants at the top
const PERFORMANCE_CONFIG = {
  COIN_BATCH_SIZE: 3, // Process 3 coins in parallel instead of sequentially
  SIGNAL_BATCH_SIZE: 1000, // Process signals in smaller batches (not directly used here but good for context)
  PROGRESS_UPDATE_THROTTLE: 100, // Update progress every 100ms max
  ENABLE_WORKER_PROCESSING: false, // Future: Web Worker support
  MEMORY_CLEANUP_INTERVAL: 2000, // Clean up memory every 2 seconds (hint)
};


const timeframes = [
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" }
];

const periods = [
  { value: "1m", label: "1 Month" },
  { value: "3m", label: "3 Months" },
  { value: "6m", label: "6 Months" },
  { value: "12m", label: "1 Year" },
  { value: "30m", label: "30 Months" }
];

const futureWindows = [
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "12h", label: "12 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "3d", label: "3 Days" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" }
];

const deepClone = (obj) => {
  if (obj === undefined) return undefined;
  return JSON.parse(JSON.stringify(obj));
};

const COIN_RAW_DATA = [
  { symbol: "BTC/USDT", name: "Bitcoin" },
  { symbol: "ETH/USDT", name: "Ethereum" },
  { symbol: "BNB/USDT", name: "Binance Coin" },
  { symbol: "SOL/USDT", name: "Solana" },
  { symbol: "XRP/USDT", name: "Ripple" },
  { symbol: "ADA/USDT", name: "Cardano" },
  { symbol: "DOGE/USDT", name: "Dogecoin" },
  { symbol: "AVAX/USDT", name: "Avalanche" },
  { symbol: "DOT/USDT", name: "Polkadot" },
  { symbol: "TRX/USDT", name: "Tron" },
  { symbol: "SHIB/USDT", name: "Shiba Inu" },
  { symbol: "LTC/USDT", name: "Litecoin" },
  { symbol: "LINK/USDT", name: "Chainlink" },
  { symbol: "UNI/USDT", name: "Uniswap" },
  { symbol: "ATOM/USDT", name: "Cosmos" },
  { symbol: "ETC/USDT", name: "Ethereum Classic" },
  { symbol: "BCH/USDT", name: "Bitcoin Cash" },
  { symbol: "XLM/USDT", name: "Stellar" },
  { symbol: "NEAR/USDT", name: "Near Protocol" },
  { symbol: "ALGO/USDT", name: "Algorand" },
  { symbol: "VET/USDT", name: "VeChain" },
  { symbol: "ICP/USDT", name: "Internet Computer" },
  { symbol: "FIL/USDT", name: "Filecoin" },
  { symbol: "EOS/USDT", name: "EOS" },
  { symbol: "XTZ/USDT", name: "Tezos" },
  { symbol: "SAND/USDT", name: "The Sandbox" },
  { symbol: "MANA/USDT", name: "Decentraland" },
  { symbol: "AAVE/USDT", name: "Aave" },
  { symbol: "GRT/USDT", name: "The Graph" },
  { symbol: "THETA/USDT", name: "Theta Network" },
  { symbol: "MKR/USDT", name: "Maker" },
  { symbol: "ZEC/USDT", name: "Zcash" },
  { symbol: "AXS/USDT", name: "Axie Infinity" },
  { symbol: "EGLD/USDT", name: "MultiversX" },
  { symbol: "FLOW/USDT", name: "Flow" },
  { symbol: "HBAR/USDT", name: "Hedera" },
  { symbol: "KSM/USDT", name: "Kusama" },
  { symbol: "RUNE/USDT", name: "THORChain" },
  { symbol: "CAKE/USDT", name: "PancakeSwap" },
  { symbol: "CRV/USDT", name: "Curve DAO Token" },
  { symbol: "COMP/USDT", name: "Compound" },
  { symbol: "SNX/USDT", "name": "Synthetix" },
  { symbol: "CHZ/USDT", name: "Chiliz" },
  { symbol: "ENJ/USDT", name: "Enjin Coin" },
  { symbol: "SUSHI/USDT", name: "SushiSwap" },
  { symbol: "YFI/USDT", name: "yearn.finance" },
  { symbol: "PEPE/USDT", name: "Pepe" },
  { symbol: "WIF/USDT", name: "dogwifhat" },
  { symbol: "BONK/USDT", name: "Bonk" },
  { symbol: "FLOKI/USDT", name: "FLOKI" },
  { symbol: "ORDI/USDT", name: "ORDI" },
  { symbol: "INJ/USDT", name: "Injective" },
  { symbol: "SEI/USDT", name: "Sei" },
  { symbol: "TIA/USDT", name: "Celestia" },
  { symbol: "JUP/USDT", name: "Jupiter" },
  { symbol: "WLD/USDT", name: "Worldcoin" },
  // Newly added coins
  { symbol: "KAS/USDT", name: "Kaspa" },
  { symbol: "RNDR/USDT", name: "Render" },
  { symbol: "FET/USDT", name: "Fetch.ai" },
  { symbol: "ARB/USDT", name: "Arbitrum" },
  { symbol: "OP/USDT", name: "Optimism" },
  { symbol: "IMX/USDT", name: "Immutable X" },
  { symbol: "SUI/USDT", name: "Sui" },
  { symbol: "PYTH/USDT", name: "Pyth Network" },
  { symbol: "APT/USDT", name: "Aptos" },
  { symbol: "GALA/USDT", name: "Gala" }
];

const availableCoins = COIN_RAW_DATA.map(coin => ({
  value: coin.symbol,
  label: `${coin.symbol} (${coin.name})`
}));


const signalNameMap = {
  "RSI": "rsi", "MACD": "macd", "EMA": "ema_crossover", "SMA": "sma", "MA200": "ma200", "Bollinger Bands": "bollinger",
  "Bollinger": "bollinger", "BBands": "bollinger", "Stochastic": "stochastic", "Stochastic Oscillator": "stochastic",
  "Volume": "volume",
  "Volume SMA": "volume",
  "Volume Spike": "spike",
  "Williams %R": "williamsr",
  "WilliamsR": "williamsr", "TEMA": "tema", "Bollinger Band Width": "bbw", "BBW": "bbw", "CMF": "cmf", "ROC": "roc",
  "CCI": "cci", "Ichimoku Cloud": "ichimoku", "Ichimoku": "ichimoku", "Doji": "cdl_doji", "CDL Doji": "cdl_doji",
  "Hammer": "cdl_hammer", "Shooting Star": "cdl_shootingstar", "Engulfing": "cdl_engulfing", "Bullish Engulfing": "cdl_engulfing",
  "Bearish Engulfing": "cdl_engulfing", "Morning Star": "cdl_morningstar", "Evening Star": "cdl_eveningstar",
  "Three White Soldiers": "cdl_3whitesoldiers", "Three Black Crows": "cdl_3blackcrows", "Pattern": "cdl_doji",
  "Dragonfly Doji": "cdl_dragonflydoji", "Three Strong Candles": "cdl_3linestrike", "Morning Star Pattern": "cdl_morningstar",
  "Awesome Oscillator": "awesomeoscillator", "MFI": "mfi", "PSAR": "psar", "Keltner Channels": "keltner", "On-Balance Volume": "obv",
  "Chaikin Money Flow": "cmf", "Accumulation/Distribution Line": "adline", "Triple EMA": "tema", "Double EMA": "dema",
  "Hull MA": "hma", "Weighted MA": "wma", "Donchian Channels": "donchian", "Chande Momentum Oscillator": "cmo",
  "Fibonacci Retracements": "fib", "Pivot Points": "pivot", "ATR": "atr", "ADX": "adx",
  "Support/Resistance": "supportresistance", "MA Ribbon": "maribbon", "TTM Squeeze": "ttm_squeeze",
  // FIXED: Add proper mappings for the missing signals
  "EMA Crossover": "ema",
  "EMA Cross": "ema",
  "ema_crossover": "ema",
  "Triple EMA": "tema",
  "TEMA": "tema",
  "MA200": "ma200",
  "Moving Average 200": "ma200"
};

function getPandasTaSignalType(genericType) {
  // FIXED: Add more comprehensive signal name resolution
  const lowercaseType = genericType.toLowerCase();

  // Direct mapping first
  if (signalNameMap[genericType]) {
    return signalNameMap[genericType];
  }

  // Fuzzy matching for common variations
  if (lowercaseType.includes('ema')) return 'ema';
  if (lowercaseType.includes('ma200') || lowercaseType === 'ma200') return 'ma200';
  if (lowercaseType.includes('tema') || lowercaseType === 'triple ema') return 'tema';
  if (lowercaseType.includes('macd')) return 'macd';
  if (lowercaseType.includes('rsi')) return 'rsi';

  // Candlestick patterns
  if (lowercaseType.startsWith('cdl_')) {
    return lowercaseType;
  }

  // Default transformation
  return genericType.replace(/([A-Z])/g, '_$1').toLowerCase();
}


const generateCombinationName = (signals) => {
    if (!signals || signals.length === 0) return "Unnamed Combination";
    return signals.map(s => s.value || s.type).sort().join(' + ');
};

const DEFAULT_BACKTEST_SETTINGS = {
  selectedCoins: ["BTC/USDT"],
  timeframe: "4h",
  period: "3m",
  minOccurrences: 2,
  targetGain: 1.0,
  minAveragePriceMove: 0.5, // NEW: Add default for new filter
  timeWindow: "4h",
  timeExitStrategy: "balanced",
  requiredSignalsForBacktest: 2,
  maxSignals: 5,
  minCombinedStrength: 150,
  minProfitFactor: 1.0,
  activeResultsTab: "summary",
  activeOverallTab: "results",
  resultsPerPage: 10,
  signalListSortBy: "netAveragePriceMove",
  openAccordions: ['Trend', 'Momentum'], // Add default accordion state
  signalTypeFilter: 'both', // NEW: Default signal type filter
  isRegimeAware: false, // NEW: Default for regime-aware backtesting
  knownGoodCombinations: [
    { id: 'trend_reversal_rsi_macd', name: 'Trend Reversal (RSI + MACD)', description: 'Strong reversal signal combining oversold RSI with bullish MACD cross', signals: ['RSI', 'MACD'], conditions: ['Oversold Entry', 'Bullish Cross'], expectedSuccessRate: 72, riskLevel: 'medium', bestTimeframes: ['1h', '4h'], enabled: false },
    { id: 'momentum_continuation', name: 'Momentum Continuation', description: 'Trend continuation with ADX strength confirmation', signals: ['ADX', 'MACD', 'Volume'], conditions: ['Trending Market', 'spike', 'above average'], expectedSuccessRate: 68, riskLevel: 'low', bestTimeframes: ['30m', '1h', '4h'], enabled: false },
    { id: 'volatility_breakout', name: 'Volatility Breakout', description: 'Bollinger Bands squeeze breakout with volume confirmation', signals: ['Bollinger Bands', 'Volume', 'ATR'], conditions: ['Squeeze Breakout', 'spike', 'High Volatility'], expectedSuccessRate: 65, riskLevel: 'medium', bestTimeframes: ['15m', '30m', '1h'], enabled: false },
    { id: 'multi_oscillator_oversold', name: 'Multi-Oscillator Oversold', description: 'Multiple oscillators confirming oversold condition', signals: ['RSI', 'Stochastic', 'Williams %R'], conditions: ['Oversold Entry', 'Oversold Cross', 'Oversold Entry'], expectedSuccessRate: 74, riskLevel: 'low', bestTimeframes: ['1h', '4h'], enabled: false },
    { id: 'cloud_support_bounce', name: 'Ichimoku Cloud Support', description: 'Price bouncing off Ichimoku cloud support with trend confirmation', signals: ['Ichimoku Cloud', 'ADX', 'Volume'], conditions: ['Price Above Cloud', 'Trending Market', 'above average'], expectedSuccessRate: 70, riskLevel: 'medium', bestTimeframes: ['1h', '4h', '1d'], enabled: false },
    { id: 'parabolic_trend_flip', name: 'Parabolic SAR Trend Flip', description: 'PSAR trend change with momentum confirmation', signals: ['PSAR', 'MACD', 'ADX'], conditions: ['Bullish Reversal', 'Histogram Increasing', 'Trending Market'], expectedSuccessRate: 67, riskLevel: 'medium', bestTimeframes: ['30m', '1h', '4h'], enabled: false }
  ]
};

const loadSavedConfig = () => {
    try {
      const savedConfigString = localStorage.getItem(BACKTESTING_CONFIG_KEY);
      if (savedConfigString) {
        const savedConfig = JSON.parse(savedConfigString);
        const loadedSignalSettings = deepClone(defaultInternalSignalSettings);

        if (savedConfig.signalSettings) {
            const keyMigrationMap = {
                "awesomeOscillator": "awesomeoscillator", "adLine": "adline", "williamsR": "williamsr",
                "supportResistance": "supportresistance", "maRibbon": "maribbon", "chartPatterns": "chartpattern",
                "chartpatterns": "chartpattern", "volume_sma": "volume", "ttmSqueeze": "ttm_squeeze",
            };
            const migratedSavedSettings = {};
            for (const key in savedConfig.signalSettings) {
                const newKey = keyMigrationMap[key] || key.toLowerCase();
                migratedSavedSettings[newKey] = savedConfig.signalSettings[key];
            }
            savedConfig.signalSettings = migratedSavedSettings;
        }

        if (savedConfig.signalSettings) {
          for (const signalKey in savedConfig.signalSettings) {
            if (loadedSignalSettings[signalKey]) {
              const settingsToApply = { ...savedConfig.signalSettings[signalKey] };
              if (savedConfig.signalSettings[signalKey].hasOwnProperty('enabled')) {
                  loadedSignalSettings[signalKey].enabled = savedConfig.signalSettings[signalKey].enabled;
                  delete settingsToApply.enabled;
              }
              Object.assign(loadedSignalSettings[signalKey], settingsToApply);
            }
          }
        }

        const finalSettings = { ...deepClone(DEFAULT_BACKTEST_SETTINGS), ...savedConfig, signalSettings: loadedSignalSettings };

        if (savedConfig.knownGoodCombinations && Array.isArray(savedConfig.knownGoodCombinations)) {
          finalSettings.knownGoodCombinations = DEFAULT_BACKTEST_SETTINGS.knownGoodCombinations.map(defaultCombo => {
            const savedCombo = savedConfig.knownGoodCombinations.find(sc => sc.id === defaultCombo.id);
            return savedCombo ? { ...defaultCombo, enabled: savedCombo.enabled } : defaultCombo;
          });
        }

        // Add accordion state loading
        if (savedConfig.openAccordions && Array.isArray(savedConfig.openAccordions)) {
          finalSettings.openAccordions = savedConfig.openAccordions;
        }

        // NEW: Load minAveragePriceMove from saved config
        finalSettings.minAveragePriceMove = savedConfig.minAveragePriceMove ?? DEFAULT_BACKTEST_SETTINGS.minAveragePriceMove;

        // NEW: Load signalTypeFilter and isRegimeAware from saved config
        finalSettings.signalTypeFilter = savedConfig.signalTypeFilter || 'both';
        finalSettings.isRegimeAware = savedConfig.isRegimeAware ?? false; // Default to false if not present

        return finalSettings;
      }
    } catch (error) {
      console.error("Failed to load or parse backtesting config:", error);
    }

    // Always return a complete config with signal settings and default signalTypeFilter
    const defaultConfig = deepClone(DEFAULT_BACKTEST_SETTINGS);
    defaultConfig.signalSettings = deepClone(defaultInternalSignalSettings);
    defaultConfig.signalTypeFilter = 'both'; // Default for new configs
    defaultConfig.isRegimeAware = false; // Default for new configs
    return defaultConfig;
};

export default function Backtesting() {
  const { toast } = useToast();

  const initialConfig = loadSavedConfig();

  const [selectedCoins, setSelectedCoins] = useState(initialConfig.selectedCoins);
  const [timeframe, setTimeframe] = useState(initialConfig.timeframe);
  const [period, setPeriod] = useState(initialConfig.period);
  const [loading, setLoading] = useState(false);
  const [historicalData, setHistoricalData] = useState([]);
  const [signalSettings, setSignalSettings] = useState(initialConfig.signalSettings || deepClone(defaultInternalSignalSettings));
  const [targetGain, setTargetGain] = useState(initialConfig.targetGain);
  const [minAveragePriceMove, setMinAveragePriceMove] = useState(initialConfig.minAveragePriceMove || 0.5); // NEW: State for new filter
  const [requiredSignalsForBacktest, setRequiredSignalsForBacktest] = useState(initialConfig.requiredSignalsForBacktest);
  const [maxSignals, setMaxSignals] = useState(initialConfig.maxSignals);
  const [minOccurrences, setMinOccurrences] = useState(initialConfig.minOccurrences);
  const [timeWindow, setTimeWindow] = useState(initialConfig.timeWindow);
  const [timeExitStrategy, setTimeExitStrategy] = useState(initialConfig.timeExitStrategy);
  const [minCombinedStrength, setMinCombinedStrength] = useState(initialConfig.minCombinedStrength);
  const [minProfitFactor, setMinProfitFactor] = useState(initialConfig.minProfitFactor || 1.0);

  // NEW: Add regime-aware backtesting state
  const [isRegimeAware, setIsRegimeAware] = useState(initialConfig.isRegimeAware || false);

  const [signalMatches, setSignalMatches] = useState([]);
  const [backtestResults, setBacktestResults] = useState(null);
  const [signalCombinations, setSignalCombinations] = useState([]);
  const [activeResultsTab, setActiveResultsTab] = useState(initialConfig.activeResultsTab);
  const [activeOverallTab, setActiveOverallTab] = useState(initialConfig.activeOverallTab);
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(initialConfig.resultsPerPage);
  const [dataLoadingProgress, setDataLoadingProgress] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [signalListSortBy, setSignalListSortBy] = useState(initialConfig.signalListSortBy);
  const [dataFetchFailed, setDataFetchFailed] = useState(false);
  const [dataFetchError, setDataFetchError] = useState("");
  const [allRawMatchesFromEngine, setAllRawMatchesFromEngine] = useState([]);
  const [knownCombosState, setKnownCombosState] = useState(initialConfig.knownGoodCombinations);
  const [savingCombinations, setSavingCombinations] = useState(false);
  const [showOptedOutDialog, setShowOptedOutDialog] = useState(false);
  const [optedOutCombinations, setOptedOutCombinations] = useState([]);
  const [failedCoins, setFailedCoins] = useState([]);
  const [backtestOverallProgress, setBacktestOverallProgress] = useState({
    overall: 0,
    currentCoin: "",
    coinProgress: 0,
    stage: ""
  });
  const [engineLogs, setEngineLogs] = useState([]);
  const [signalCountSummary, setSignalCountSummary] = useState(null);
  const [debugData, setDebugData] = useState(null);
  const [openAccordions, setOpenAccordions] = useState(initialConfig.openAccordions);

  // NEW: Add state for event/state signal filtering
  const [signalTypeFilter, setSignalTypeFilter] = useState(initialConfig.signalTypeFilter || 'both'); // 'events', 'states', 'both'

  // NEW: State for the dominant regime filter
  const [regimeFilter, setRegimeFilter] = useState('all'); // 'all', 'trending', 'ranging'

  // Add performance monitoring
  const [performanceMetrics, setPerformanceMetrics] = useState({
    startTime: null,
    coinProcessingTimes: [],
    totalSignalsProcessed: 0,
    averageSignalsPerSecond: 0
  });

  // FIX: Use useMemo to ensure the throttled function is stable across renders.
  const throttledProgressUpdate = useMemo(
    () => throttle((update) => {
      setBacktestOverallProgress(update);
    }, PERFORMANCE_CONFIG.PROGRESS_UPDATE_THROTTLE),
    [] // setBacktestOverallProgress is stable.
  );

  const classifySignalType = useCallback((signal) => {
    if (!signal || !signal.type || !signal.value) {
      return false;
    }

    const signalType = signal.type.toLowerCase();
    const signalValue = signal.value.toLowerCase();

    const eventKeywords = [
      'cross', 'crossover', 'entry', 'exit', 'breakout', 'breakdown',
      'reversal', 'flip', 'squeeze', 'expansion', 'bounce', 'rejection',
      'bullish_cross', 'bearish_cross', 'oversold_entry', 'oversold_exit',
      'overbought_entry', 'overbought_exit', 'bullish_divergence',
      'bearish_divergence', 'pattern_complete', 'trend_change'
    ];

    const isEventByValue = eventKeywords.some(keyword => signalValue.includes(keyword));

    if (signalType.includes('candlestick') || signalType.includes('cdl_')) {
      return true;
    }

    return isEventByValue;
  }, []);

  const processAllResults = useCallback((allCoinResultsFromRunner, logCallback) => {
    logCallback('[BACKTESTING] Processing results from all coins...', 'info');
    let allRawMatches = [];
    let firstCoinHistoricalData = null; // We'll use the historical data from the first coin for median calculation and chart
    let allDebugData = null; // Collect debug data, usually from the last processed coin

    allCoinResultsFromRunner.forEach((resultWrapper) => {
      if (resultWrapper.success && resultWrapper.result) {
        const coinResult = resultWrapper.result;
        if (coinResult.matches) {
          logCallback(`[BACKTESTING] Aggregating matches from ${resultWrapper.coin}: ${coinResult.matches.length} matches`, 'info');
          allRawMatches = allRawMatches.concat(coinResult.matches);
        }

        // Capture historical data for chart (from first successful coin)
        if (!firstCoinHistoricalData && coinResult.historicalData) {
          firstCoinHistoricalData = coinResult.historicalData;
        }

        // Capture debug data (typically from the last coin, or aggregate if needed)
        if (coinResult.debugData) {
          allDebugData = coinResult.debugData; // Overwrite, keeping the last one
        }
      }
    });

    logCallback(`[BACKTESTING] Total raw matches across all coins before processing: ${allRawMatches.length}`, 'info');

    if (allRawMatches.length === 0) {
      logCallback('[BACKTESTING] No raw matches found to process.', 'warning');
      return { finalCombinations: [], finalMatches: [], totalCombinationsTested: 0, historicalDataForChart: firstCoinHistoricalData, debugData: allDebugData };
    }

    // Step 1: Process raw matches to identify all possible combinations
    const { processedCombinations, totalCombinationsTested } = processMatches(
      allRawMatches,
      {
        minOccurrences: minOccurrences,
        timeWindow: timeWindow,
        timeframe: timeframe // Pass timeframe here
      },
      classifySignalType,
      firstCoinHistoricalData // Pass historical data for median lowest low
    );

    logCallback(`[BACKTESTING] Identified ${processedCombinations.length} unique combinations.`, 'info');

    // Step 2: Filter combinations by minProfitFactor
    const combinationsMeetingProfitFactor = processedCombinations.filter(combo =>
      typeof combo.profitFactor === 'number' && combo.profitFactor >= minProfitFactor
    );
    logCallback(`[BACKTESTING] ${combinationsMeetingProfitFactor.length} combinations meet min profit factor (${minProfitFactor}).`, 'info');

    // Step 3: Identify the best combination for each raw match point
    const finalFilteredMatches = filterMatchesByBestCombination(allRawMatches, combinationsMeetingProfitFactor);
    logCallback(`[BACKTESTING] Final filtered optimal strategy events: ${finalFilteredMatches.length}`, 'info');

    // Step 4: Align combinations to only include those present in finalFilteredMatches
    const optimalCombinationNames = new Set(finalFilteredMatches.map(match => match.combinationName));
    const finalCombinationsWithMeta = combinationsMeetingProfitFactor.filter(combo => optimalCombinationNames.has(combo.combinationName));
    logCallback(`[BACKTESTING] Final unique high-quality strategies: ${finalCombinationsWithMeta.length}`, 'success');

    return {
      finalCombinations: finalCombinationsWithMeta,
      finalMatches: finalFilteredMatches,
      totalCombinationsTested,
      historicalDataForChart: firstCoinHistoricalData,
      debugData: allDebugData
    };
  }, [minOccurrences, timeWindow, timeframe, minProfitFactor, classifySignalType]);

  const filteredSignalCombinations = useMemo(() => {
    if (!signalCombinations || signalCombinations.length === 0) {
      return [];
    }

    let filtered = [...signalCombinations];

    // Apply signal type filter
    if (signalTypeFilter === 'events') {
      filtered = filtered.filter(combo => combo.signals && combo.signals.some(signal => classifySignalType(signal)));
    } else if (signalTypeFilter === 'states') {
      filtered = filtered.filter(combo => combo.signals && combo.signals.every(signal => !classifySignalType(signal)));
    }

    // NEW: Apply dominant regime filter
    if (regimeFilter !== 'all') {
      filtered = filtered.filter(combo => combo.dominantMarketRegime === regimeFilter);
    }

    return filtered;
  }, [signalCombinations, signalTypeFilter, regimeFilter, classifySignalType]);

  const profitableCombinations = useMemo(() => {
    if (!filteredSignalCombinations) return [];
    return filteredSignalCombinations.filter(combo =>
      combo.successRate > 50 && combo.occurrences > 1
    );
  }, [filteredSignalCombinations]);

  // NEW: Safe formatter to prevent toFixed errors
  const toFixedSafe = (n, d = 2, fallback = '0.00') =>
    (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : fallback);

  const handleSignalEnabledChange = (signalKey, isEnabled) => {
    setSignalSettings(prev => {
      // Add null check
      if (!prev || !prev[signalKey]) {
        console.warn(`Signal settings not found for key: ${signalKey}`);
        return prev;
      }
      return {
        ...prev,
        [signalKey]: { ...prev[signalKey], enabled: isEnabled }
      };
    });
  };

  const handleSignalParameterChange = (signalKey, paramKey, value) => {
    setSignalSettings(prev => {
      // Add null check
      if (!prev || !prev[signalKey]) {
        console.warn(`Signal settings not found for key: ${signalKey}`);
        return prev;
      }
      return {
        ...prev,
        [signalKey]: { ...prev[signalKey], [paramKey]: value }
      };
    });
  };

  const handleCopyLog = () => {
    if (engineLogs.length === 0) {
      toast({
        title: "Log is Empty",
        description: "There is nothing to copy yet.",
        variant: "destructive"
      });
      return;
    }

    const logText = engineLogs.map(log => {
      // Assuming log.level is 'info', 'error', 'warning', etc. not for indentation
      return `${log.timestamp}\t[${log.level.toUpperCase()}]\t${log.message}`;
    }).join('\n');

    navigator.clipboard.writeText(logText).then(() => {
      toast({
        title: "Log Copied!",
        description: "The backtest log has been copied to your clipboard.",
      });
    }).catch(err => {
      console.error('Failed to copy log: ', err);
      toast({
        title: "Copy Failed",
        description: "Could not copy the log to your clipboard.",
        variant: "destructive",
      });
    });
  };

  useEffect(() => {
    if (isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [isInitialLoad]);

  // FIX: Wrap function in useCallback and add it as a dependency to useEffect.
  const loadOptedOutCombinations = useCallback(async () => {
    try {
      const optedOut = await queueEntityCall('OptedOutCombination', 'list');
      setOptedOutCombinations(optedOut);
    } catch (error) {
      console.error('Failed to load opted out combinations:', error);
      toast({
        title: "Failed to load opted out list",
        description: error.message,
        variant: "destructive"
      });
    }
  }, [toast]); // Add toast to dependencies, though it's usually stable

  useEffect(() => {
    loadOptedOutCombinations();
  }, [loadOptedOutCombinations]); // Add loadOptedOutCombinations to dependencies

  const removeOptOut = async (optOutId) => {
    try {
      await queueEntityCall('OptedOutCombination', 'delete', optOutId);
      await loadOptedOutCombinations();
      toast({ title: "Opt-out Removed", description: "The combination will now be considered in future backtests.", variant: "default" });
    } catch (error) {
      console.error('Failed to remove opt-out:', error);
      toast({ title: "Failed to Remove Opt-out", description: "This could be a temporary issue. Please try again or check the console.", variant: "destructive" });
    }
  };

  const getChangedSignalSettings = (currentSettings) => {
    const changedSettings = {};
    const defaultCloned = deepClone(defaultInternalSignalSettings);

    for (const key in currentSettings) {
      if (defaultCloned[key]) {
        const defaultSetting = defaultCloned[key];
        const currentSetting = currentSettings[key];
        let isDifferent = false;
        if (currentSetting.enabled !== defaultSetting.enabled) {
          if (!changedSettings[key]) changedSettings[key] = {};
          changedSettings[key].enabled = currentSetting.enabled;
          isDifferent = true;
        }
        if (currentSetting.enabled || isDifferent) {
          for (const paramKey in currentSetting) {
            // Exclude non-parameter properties when comparing for changes
            if (paramKey === 'category' || paramKey === 'pandasTaName' || paramKey === 'enabled' || paramKey === 'params' || paramKey === 'priority' || paramKey === 'name') continue;
            const currentValStr = JSON.stringify(currentSetting[paramKey]);
            const defaultValStr = JSON.stringify(defaultSetting[paramKey]);
            if (currentValStr !== defaultValStr) {
              if (!changedSettings[key]) changedSettings[key] = {};
              try {
                // Ensure the value is serializable before adding
                JSON.stringify(currentSetting[paramKey]);
                changedSettings[key][paramKey] = currentSetting[paramKey];
              } catch (e) {
                console.warn(`Skipping non-serializable param ${paramKey} for signal ${key} during save config.`);
              }
              isDifferent = true;
            }
          }
        }
        // If only 'enabled: false' is changed, and default was also false, don't save as a change.
        if (Object.keys(changedSettings[key] || {}).length === 1 &&
            changedSettings[key]?.enabled === false &&
            defaultSetting.enabled === false &&
            !isDifferent
            ) {
            delete changedSettings[key];
        } else if (Object.keys(changedSettings[key] || {}).length === 0 && !isDifferent) {
          delete changedSettings[key];
        }
      }
    }
    return changedSettings;
  };

  useEffect(() => {
    const changedSignalSettingsForStorage = getChangedSignalSettings(signalSettings);
    const coreConfigToSave = {
      selectedCoins, timeframe, period, signalSettings: changedSignalSettingsForStorage, targetGain,
      minAveragePriceMove, // NEW: Save to localStorage
      requiredSignalsForBacktest, maxSignals, minOccurrences, timeWindow,
      activeResultsTab, activeOverallTab, resultsPerPage, signalListSortBy,
      minCombinedStrength, // FIX: Ensure this is saved
      minProfitFactor,
      openAccordions, // FIX: Save accordion state
      signalTypeFilter, // NEW: Add signalTypeFilter to saved config
      isRegimeAware, // NEW: Save regime-aware setting
      knownGoodCombinations: knownCombosState.map(c => ({ id: c.id, enabled: c.enabled, })),
    };
    try {
      localStorage.setItem(BACKTESTING_CONFIG_KEY, JSON.stringify(coreConfigToSave));
    }
    catch (error) {
      if (error.name === 'QuotaExceededError') {
        try {
          const absoluteMinimalConfig = { selectedCoins, timeframe, period };
          localStorage.setItem(BACKTESTING_CONFIG_KEY, JSON.stringify(absoluteMinimalConfig));
        } catch (secondError) {
          console.error("Failed to save even minimal config:", secondError);
        }
        toast({
          title: "Storage Setting Issue",
          description: "Some settings couldn't be saved due to browser storage limits. This won't affect your current session.",
          variant: "warning",
          duration: 5000,
        });
      } else {
        console.error("Error saving config to localStorage:", error);
      }
    }
  }, [
    selectedCoins, timeframe, period, signalSettings, targetGain, minAveragePriceMove, requiredSignalsForBacktest, maxSignals, minOccurrences, // NEW: Added minAveragePriceMove
    timeWindow, toast, activeResultsTab, activeOverallTab, resultsPerPage, signalListSortBy,
    timeExitStrategy, minCombinedStrength, minProfitFactor, knownCombosState, openAccordions, signalTypeFilter, isRegimeAware
  ]);

  useEffect(() => {
    return () => {
      setSignalMatches([]);
      setSignalCombinations([]);
      setBacktestResults(null);
      setAllRawMatchesFromEngine([]);
      setEngineLogs([]);
      setDebugData(null);
      // Cancel any pending throttled updates
      throttledProgressUpdate.cancel();
    };
  }, [throttledProgressUpdate]);

  const resetFilters = () => {
    setSelectedCoins(DEFAULT_BACKTEST_SETTINGS.selectedCoins);
    setTimeframe(DEFAULT_BACKTEST_SETTINGS.timeframe);
    setPeriod(DEFAULT_BACKTEST_SETTINGS.period);
    setTargetGain(DEFAULT_BACKTEST_SETTINGS.targetGain);
    setMinAveragePriceMove(DEFAULT_BACKTEST_SETTINGS.minAveragePriceMove); // NEW: Reset new filter
    setRequiredSignalsForBacktest(DEFAULT_BACKTEST_SETTINGS.requiredSignalsForBacktest);
    setMaxSignals(DEFAULT_BACKTEST_SETTINGS.maxSignals);
    setMinOccurrences(DEFAULT_BACKTEST_SETTINGS.minOccurrences);
    setTimeWindow(DEFAULT_BACKTEST_SETTINGS.timeWindow);
    setTimeExitStrategy(DEFAULT_BACKTEST_SETTINGS.timeExitStrategy);
    setMinCombinedStrength(DEFAULT_BACKTEST_SETTINGS.minCombinedStrength);
    setMinProfitFactor(DEFAULT_BACKTEST_SETTINGS.minProfitFactor);
    setOpenAccordions(DEFAULT_BACKTEST_SETTINGS.openAccordions); // FIX: Reset accordion state
    setSignalTypeFilter('both'); // FIX: Reset signal type filter
    setIsRegimeAware(false); // NEW: Reset regime-aware setting
    setRegimeFilter('all'); // NEW: Reset regime filter

    // Reset signal settings to their default internal values
    setSignalSettings(deepClone(defaultInternalSignalSettings));

    setHistoricalData([]);
    setSignalMatches([]);
    setBacktestResults(null);
    setSignalCombinations([]);
    setAllRawMatchesFromEngine([]);
    setBacktestOverallProgress({ overall: 0, currentCoin: "", coinProgress: 0, stage: "" });
    setKnownCombosState(deepClone(DEFAULT_BACKTEST_SETTINGS.knownGoodCombinations));
    setFailedCoins([]);
    setEngineLogs([]);
    setSignalCountSummary(null);
    setDebugData(null);
    setActiveOverallTab("results");
    setActiveResultsTab("summary");
    try {
      localStorage.removeItem(BACKTESTING_CONFIG_KEY);
    } catch (error) {
      console.error("Error clearing localStorage:", error);
    }
  };

  const getPaginatedSignalCombinations = () => {
    if (!filteredSignalCombinations || filteredSignalCombinations.length === 0) {
      return [];
    }

    const sortedCombinations = [...filteredSignalCombinations].sort((a, b) => {
      if (signalListSortBy === "netAveragePriceMove") return (b.netAveragePriceMove || 0) - (a.netAveragePriceMove || 0);
      if (signalListSortBy === "successRate") return (b.successRate || 0) - (a.successRate || 0);
      if (signalListSortBy === "signalCount") {
        return b.signals.length !== a.signals.length
          ? b.signals.length - a.signals.length
          : (b.successRate || 0) - (a.successRate || 0);
      }
      return (b.occurrences || 0) - (a.occurrences || 0);
    });
    const startIndex = (currentPage - 1) * resultsPerPage;
    return sortedCombinations.slice(startIndex, startIndex + resultsPerPage);
  };

  const totalPages = Math.ceil(filteredSignalCombinations.length / resultsPerPage);
  const goToNextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };
  const goToPrevPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToPage = (pageNum) => { if (pageNum >= 1 && pageNum <= totalPages) setCurrentPage(pageNum); };

  const handleCoinsChange = (newCoins) => setSelectedCoins(newCoins);
  const handleTimeframeChange = (newTimeframe) => setTimeframe(newTimeframe);
  const handlePeriodChange = (newPeriod) => setPeriod(newPeriod);

  const handleSaveConfig = () => {
    const changedSignalSettingsForStorage = getChangedSignalSettings(signalSettings);
    const configToSave = {
      selectedCoins, timeframe, period, signalSettings: changedSignalSettingsForStorage,
      targetGain, minAveragePriceMove, requiredSignalsForBacktest, maxSignals, minOccurrences, timeWindow, // NEW: Add to save
      activeResultsTab, activeOverallTab, resultsPerPage, signalListSortBy,
      timeExitStrategy, minCombinedStrength, minProfitFactor,
      openAccordions,
      signalTypeFilter, // NEW: Include signalTypeFilter in save
      isRegimeAware, // NEW: Include isRegimeAware in save
      knownGoodCombinations: knownCombosState.map(c => ({ id: c.id, enabled: c.enabled, })),
    };
    try {
      localStorage.setItem(BACKTESTING_CONFIG_KEY, JSON.stringify(configToSave));
      toast({ title: "Configuration Saved", description: "Your backtesting settings have been saved locally." });
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
          try {
            const absoluteMinimalConfig = { selectedCoins, timeframe, period };
            localStorage.setItem(BACKTESTING_CONFIG_KEY, JSON.stringify(absoluteMinimalConfig));
            toast({ title: "Minimal Configuration Saved", description: "Due to storage limits, only essential settings were saved." });
          } catch (secondError) {
            console.error("Failed to save even minimal config:", secondError);
            toast({ title: "Storage Error", description: "Could not save configuration.", variant: "destructive" });
        }
    }
  }
  };

  const saveCombinations = async () => {
    if (!signalCombinations || signalCombinations.length === 0) {
      toast({ title: "No Results", description: "No backtest results to save. Run a backtest first.", variant: "destructive" });
      return;
    }
    setSavingCombinations(true);

    let validationErrors = 0;

    try {
      const combinationsToCreate = [];
      for (const result of signalCombinations) {
        const combinationData = {
          coin: result.coin, timeframe: result.timeframe, signals: result.signals || [],
          signalCount: result.signals?.length || 0, combinedStrength: result.combinedStrength || 0,
          successRate: result.successRate || 0, occurrences: result.occurrences || 0,
          occurrenceDates: result.matches?.map(m => m.time) || [], avgPriceMove: result.netAveragePriceMove || 0,
          recommendedTradingStrategy: '', includedInScanner: false,
          combinationName: result.combinationName || generateCombinationName(result.signals),
          takeProfitPercentage: 5,
          stopLossPercentage: 2,
          positionSizePercentage: 1,
          estimatedExitTimeMinutes: 240,
          strategyDirection: "long",
          enableTrailingTakeProfit: false,
          trailingStopPercentage: 0,
        };

        const validation = validateCombinationSignals(combinationData);
        if (!validation.isValid) {
          logValidationIssues('Save Combination', validation);
          validationErrors++;
          toast({
            title: "Validation Error",
            description: `Combination has invalid signals: ${validation.issues.slice(0, 2).join(', ')}${validation.issues.length > 2 ? '...' : ''}`,
            variant: "destructive",
          });
          continue;
        }
        combinationsToCreate.push(combinationData);
      }

      if (combinationsToCreate.length > 0) {
        await queueEntityCall('BacktestCombination', 'bulkCreate', combinationsToCreate);
        toast({
          title: "Success",
          description: `${combinationsToCreate.length} combination(s) saved successfully${validationErrors > 0 ? ` (${validationErrors} failed validation)` : ''}.`,
        });
      } else {
        toast({
          title: validationErrors > 0 ? "Save Failed" : "Nothing to save",
          description: validationErrors > 0 ? `All ${validationErrors} combinations failed validation.` : "No combinations could be saved.",
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error("Error in saveCombinations:", error);
      toast({ title: "Error", description: "Failed to save combinations. Check console for details.", variant: "destructive" });
    } finally {
      setSavingCombinations(false);
    }
  };

  const runBacktest = useCallback(async () => {
    const startTime = performance.now();
    setPerformanceMetrics(prev => ({ ...prev, startTime, coinProcessingTimes: [], totalSignalsProcessed: 0, averageSignalsPerSecond: 0 }));

    setLoading(true);
    setEngineLogs([]);
    setSignalCountSummary(null);
    setActiveOverallTab("results");
    setBacktestOverallProgress({ overall: 0, currentCoin: "", coinProgress: 0, stage: "Starting optimized backtests..." });
    setSignalMatches([]);
    setSignalCombinations([]);
    setAllRawMatchesFromEngine([]);
    setBacktestResults(null);
    setDataFetchFailed(false);
    setDataFetchError("");
    setHistoricalData([]);
    setDebugData(null);

    const logCallback = (message, level = 'info') => {
      const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setEngineLogs(prev => [...prev, { timestamp, message, level }]);
    };

    // Initialize regime tracking
    initializeRegimeTracker(logCallback);

    logCallback("🚀 Starting optimized backtest with parallel processing.", "info");

    // --- Log parameters ---
    logCallback(`
--- Optimized Scan Parameters ---
Coins: ${selectedCoins.join(', ')}
Batch Size: ${PERFORMANCE_CONFIG.COIN_BATCH_SIZE} coins in parallel
Timeframe: ${timeframe}
Period: ${period}
Min Price Move (Success Target): ${targetGain}%
Min Avg. Price Move (Strategy Filter): ${minAveragePriceMove}%
Min Signals: ${requiredSignalsForBacktest}
Max Signals: ${maxSignals}
Min Occurrences: ${minOccurrences}
Future Window: ${timeWindow}
Min Combined Strength: ${minCombinedStrength}
Min Profit Factor: ${minProfitFactor}
Signal Type Filter: ${signalTypeFilter}
Regime-Aware Mode: ${isRegimeAware ? 'ENABLED' : 'DISABLED'}
Memory Cleanup Hint: Every ~${(PERFORMANCE_CONFIG.MEMORY_CLEANUP_INTERVAL / 1000) * PERFORMANCE_CONFIG.COIN_BATCH_SIZE} seconds (approx.)
---------------------------------
    `, 'summary');


    const currentRunSignalSettings = deepClone(signalSettings);

    knownCombosState.forEach(combo => {
      if (combo.enabled) {
        combo.signals.forEach(signalName => {
          const signalKey = Object.keys(signalNameMap).find(key => key.toLowerCase() === signalName.toLowerCase()) || signalName.toLowerCase();
          if (currentRunSignalSettings[signalKey]) {
            currentRunSignalSettings[signalKey].enabled = true;
          }
        });
      }
    });

    const totalCoinsToProcess = selectedCoins.length;
    let allCoinResults = []; // Collect results from each coin to process globally later
    let aggregatedSignalCounts = {};
    let currentFailedCoins = [];
    let coinsSuccessfullyProcessed = 0;


    // Process coins in parallel batches
    for (let batchStart = 0; batchStart < totalCoinsToProcess; batchStart += PERFORMANCE_CONFIG.COIN_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + PERFORMANCE_CONFIG.COIN_BATCH_SIZE, totalCoinsToProcess);
      const coinBatch = selectedCoins.slice(batchStart, batchEnd);

      logCallback(`🔄 Processing batch ${Math.floor(batchStart / PERFORMANCE_CONFIG.COIN_BATCH_SIZE) + 1} (${batchEnd - batchStart} coins): ${coinBatch.join(', ')}`, 'info');

      const batchPromises = coinBatch.map(async (currentCoin, indexInBatch) => {
        const coinStartTime = performance.now();
        const globalCoinIndex = batchStart + indexInBatch;

        try {
          logCallback(`[${currentCoin}] Starting parallel processing...`, 'info');

          const coinResult = await runBacktestForCoin({
            coinSymbol: currentCoin,
            period,
            timeframe,
            signalSettings: currentRunSignalSettings,
            targetGain,
            timeWindow,
            requiredSignalsForBacktest,
            maxSignals,
            minCombinedStrength: minCombinedStrength,
            isRegimeAware,
            evaluateSignalCondition,
            defaultSignalSettings: defaultInternalSignalSettings,
            classifySignalType: classifySignalType, // Pass the useCallback version
            setBacktestProgress: (update) => {
              const baseOverallProgress = (globalCoinIndex / totalCoinsToProcess) * 100;
              const maxCoinProgressContribution = (100 / totalCoinsToProcess);
              const calculatedOverallProgress = baseOverallProgress + (update.coinProgress / 100) * maxCoinProgressContribution;

              // Use throttled update to reduce UI overhead
              throttledProgressUpdate({
                overall: calculatedOverallProgress,
                currentCoin: `Batch ${Math.floor(batchStart / PERFORMANCE_CONFIG.COIN_BATCH_SIZE) + 1}: ${update.currentCoin}`,
                coinProgress: update.coinProgress,
                stage: update.stage
              });
            },
            setDataLoadingProgress,
            onLog: (msg, level) => logCallback(`[${currentCoin}] ${msg}`, level),
          });

          const coinEndTime = performance.now();
          const coinProcessingTime = coinEndTime - coinStartTime;

          setPerformanceMetrics(prev => ({
            ...prev,
            coinProcessingTimes: [...prev.coinProcessingTimes, { coin: currentCoin, time: coinProcessingTime }],
            totalSignalsProcessed: prev.totalSignalsProcessed + (coinResult.matches?.length || 0)
          }));

          logCallback(`[${currentCoin}] ✅ Completed in ${(coinProcessingTime / 1000).toFixed(2)}s`, 'success');

          return { success: true, coin: currentCoin, result: coinResult };

        } catch (error) {
          logCallback(`[${currentCoin}] ❌ Failed: ${error.message}`, 'error');
          return { success: false, coin: currentCoin, error: error.message };
        }
      });

      // Wait for all coins in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process batch results
      for (const batchResult of batchResults) {
        if (batchResult.success) {
          allCoinResults.push(batchResult); // Collect coin results for global processing
          coinsSuccessfullyProcessed++;

          // Aggregate signal counts
          const coinSignalCounts = batchResult.result.signalCounts || {};
          for (const signalType in coinSignalCounts) {
            if (Object.prototype.hasOwnProperty.call(coinSignalCounts, signalType)) {
              aggregatedSignalCounts[signalType] = (aggregatedSignalCounts[signalType] || 0) + coinSignalCounts[signalType];
            }
          }
        } else {
          currentFailedCoins.push({ coin: batchResult.coin, reason: batchResult.error });
        }
      }

      // OPTIMIZATION: Cleanup memory hint after each batch
      if (typeof window.gc === 'function') {
        logCallback(`Triggering garbage collection hint after batch.`, 'debug');
        window.gc();
      }
      await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.MEMORY_CLEANUP_INTERVAL));

      logCallback(`✅ Batch ${Math.floor(batchStart / PERFORMANCE_CONFIG.COIN_BATCH_SIZE) + 1} completed. Processed ${batchResults.filter(r => r.success).length}/${coinBatch.length} coins successfully.`, 'success');
    }

    setFailedCoins(currentFailedCoins);
    setSignalCountSummary(aggregatedSignalCounts);

    // Global processing of all collected results
    setBacktestOverallProgress({ overall: 90, currentCoin: "", coinProgress: 0, stage: "Consolidating and processing all results..." });
    const { finalCombinations: allFinalCombinations, finalMatches, historicalDataForChart, debugData } = processAllResults(allCoinResults, logCallback);

    // NEW: Apply Minimum Average Price Move filter
    logCallback(`[BACKTESTING] Applying Minimum Average Price Move filter (>= ${minAveragePriceMove}%)`, 'info');
    const finalCombinations = allFinalCombinations.filter(c => c.netAveragePriceMove >= minAveragePriceMove);
    if (allFinalCombinations.length !== finalCombinations.length) {
        logCallback(`[BACKTESTING] ${finalCombinations.length}/${allFinalCombinations.length} combinations passed the avg. move filter.`, 'success');
    }

    // FIX: Ensure historicalData is always an array to prevent crashes on render.
    // If historicalDataForChart is null (because all fetches failed), default to an empty array.
    setHistoricalData(historicalDataForChart || []);
    setDebugData(debugData);

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const avgSignalsPerSecond = finalMatches.length > 0 ? (finalMatches.length / (totalTime / 1000)) : 0;

    setPerformanceMetrics(prev => ({
      ...prev,
      averageSignalsPerSecond: avgSignalsPerSecond
    }));

    if (finalMatches.length > 0 && finalCombinations.length > 0) { // MODIFIED: Check finalCombinations as well
      setBacktestOverallProgress({ overall: 99, currentCoin: "", coinProgress: 100, stage: "Finalizing results..." });

      const aggregatedSummary = {
          totalMatches: finalMatches.length,
          successfulMatches: finalMatches.filter(m => m.successful).length,
          totalCombinationsTested: finalCombinations.length, // This reflects the unique combinations that met criteria
          coinsTested: selectedCoins.join(', '),
          coinsSuccessfullyProcessed: coinsSuccessfullyProcessed,
          successRate: finalMatches.length > 0 ? (finalMatches.filter(m => m.successful).length / finalMatches.length) * 100 : 0
      };

      setBacktestResults(aggregatedSummary);
      setSignalCombinations(finalCombinations);
      setAllRawMatchesFromEngine(finalMatches);
      setSignalMatches(finalMatches);


      let initialFilteredCount = finalCombinations.length;
      if (signalTypeFilter === 'events') {
        initialFilteredCount = finalCombinations.filter(combo => combo.signals && combo.signals.some(signal => classifySignalType(signal))).length;
      } else if (signalTypeFilter === 'states') {
        initialFilteredCount = finalCombinations.filter(combo => combo.signals && combo.signals.every(signal => !classifySignalType(signal))).length;
      }

      toast({
        title: `🚀 Optimized Backtest Complete!`,
        description: `Processed ${coinsSuccessfullyProcessed}/${totalCoinsToProcess} coins in ${(totalTime/1000).toFixed(1)}s. Found ${initialFilteredCount} strategies meeting your criteria.`,
        variant: "default",
        duration: 7000
      });

      logCallback(`✅ Optimized backtest completed successfully in ${(totalTime/1000).toFixed(2)}s. Found ${finalCombinations.length} strategies meeting profit factor >= ${minProfitFactor} and avg move >= ${minAveragePriceMove}%.`, 'success');
    } else {
      if (currentFailedCoins.length === totalCoinsToProcess && totalCoinsToProcess > 0) {
        toast({ title: "Backtest Failed for All Coins", description: "No coins were processed successfully. Check the logs for details.", variant: "destructive", duration: 7000 });
        logCallback("Backtest failed for all selected coins.", 'error');
      } else {
        toast({ title: "Backtest Complete", description: `No strategies found across ${coinsSuccessfullyProcessed}/${totalCoinsToProcess} processed coins meeting your criteria. Try adjusting filters.`, variant: currentFailedCoins.length > 0 ? "warning" : "default", duration: 5000 });
        logCallback("Optimized backtest completed. No strategies found meeting the specified filter criteria.", 'warning');
      }
      setBacktestResults({ totalMatches: 0, successfulMatches: 0, successRate: 0, totalCombinationsTested: 0, coinsTested: selectedCoins.join(', '), coinsSuccessfullyProcessed: coinsSuccessfullyProcessed });
    }

    setLoading(false);
    setBacktestOverallProgress({ overall: 100, currentCoin: "", coinProgress: 100, stage: "All optimized backtests finished." });

    const enabledSignalKeys = Object.keys(currentRunSignalSettings).filter(key => currentRunSignalSettings[key].enabled);

    // FIX: Use case-insensitive comparison for found signals
    const foundSignalsLower = Object.keys(aggregatedSignalCounts).map(s => s.toLowerCase());
    const notFoundSignals = enabledSignalKeys.filter(key => !foundSignalsLower.includes(key.toLowerCase()));

    let summaryLog = "\n\n--- Backtest Signal Summary ---\n\n";
    summaryLog += `✅ Found Signals (${Object.keys(aggregatedSignalCounts).length}):\n`;
    if (Object.keys(aggregatedSignalCounts).length > 0) {
        Object.keys(aggregatedSignalCounts).sort().forEach(key => {
            summaryLog += `  - ${key}: ${aggregatedSignalCounts[key].toLocaleString()} occurrences\n`;
        });
    } else {
        summaryLog += "  - None\n";
    }

    summaryLog += `\n\n❌ Enabled But Not Found Signals (${notFoundSignals.length}):\n`;
    if (notFoundSignals.length > 0) {
        summaryLog += `  - ${notFoundSignals.join(', ')}\n`;

    } else {
        summaryLog += "  - None\n";
    }

    summaryLog += `\n\n🔍 Divergence Signals Detected (${foundSignalsLower.filter(signal => signal.toLowerCase().includes('divergence')).length} types):\n`;
    const divergenceSignals = Object.keys(aggregatedSignalCounts).filter(signal => signal.toLowerCase().includes('divergence'));
    if (divergenceSignals.length > 0) {
        divergenceSignals.forEach(signal => {
            summaryLog += `  - ${signal}: ${aggregatedSignalCounts[signal].toLocaleString()} occurrences\n`;
        });
        summaryLog += "\nDivergence signals are leading indicators that often predict trend reversals.\n";
        summaryLog += "Consider combinations that include divergence for higher-probability setups.\n";
        } else {
        summaryLog += "  - None\n";
    }

    // Final Diagnostics
    summaryLog += "\n\n--- Final Backtest Diagnostics ---";
    summaryLog += `\nTotal optimal strategy events presented: ${finalMatches.length}`;
    summaryLog += `\nTotal unique strategies found across all coins: ${finalCombinations.length}`; // Use the filtered count here as well.
    summaryLog += `\nBacktest took approximately ${((endTime - startTime) / 1000).toFixed(2)} seconds.`;
    summaryLog += `\nAverage signals processed per second: ${avgSignalsPerSecond.toFixed(1)}`;
    summaryLog += `\n\nParameters:`;
    summaryLog += `\n  Coins: ${selectedCoins.join(', ')}`;
    summaryLog += `\n  Timeframe: ${timeframe}`;
    summaryLog += `\n  Period: ${period}`;
    summaryLog += `\n  Target Gain (Success Target): ${targetGain}%`;
    summaryLog += `\n  Min Avg. Price Move (Filter): ${minAveragePriceMove}%`; // NEW: Log new parameter
    summaryLog += `\n  Min Signals: ${requiredSignalsForBacktest}`;
    summaryLog += `\n  Max Signals: ${maxSignals}`;
    summaryLog += `\n  Min Occurrences: ${minOccurrences}`;
    summaryLog += `\n  Future Window: ${timeWindow}`;
    summaryLog += `\n  Min Combined Strength: ${minCombinedStrength}`;
    summaryLog += `\n  Min Profit Factor: ${minProfitFactor}`;
    summaryLog += `\n  Signal Type Filter: ${signalTypeFilter}`;
    summaryLog += `\n  Regime-Aware Mode: ${isRegimeAware ? 'ENABLED' : 'DISABLED'}`;
    summaryLog += "\n----------------------------------";

    logCallback(summaryLog, 'summary');
    logCallback("Backtest engine stopped.", "info");

    // FIX: Remove defaultInternalSignalSettings from dependency array as it's a constant.
  }, [
    selectedCoins, period, timeframe, signalSettings, targetGain, minAveragePriceMove, requiredSignalsForBacktest, maxSignals, // NEW: Added minAveragePriceMove
    timeWindow, minOccurrences, minCombinedStrength, minProfitFactor, toast, knownCombosState, setDataLoadingProgress,
    throttledProgressUpdate, classifySignalType, processAllResults,
    setFailedCoins, setAllRawMatchesFromEngine, setSignalMatches, setHistoricalData,
    setSignalCombinations, setLoading, setBacktestResults, setSignalCountSummary, setDebugData,
    signalTypeFilter, isRegimeAware
  ]);

  const currentCoinForChart = historicalData && historicalData.length > 0 && backtestOverallProgress.currentCoin ? backtestOverallProgress.currentCoin : (selectedCoins[0] || "BTC/USDT");

  const OptedOutCombinationsDialog = () => (
    <Dialog open={showOptedOutDialog} onOpenChange={setShowOptedOutDialog}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            Opted Out Combinations ({optedOutCombinations.length})
          </DialogTitle>
          <DialogDescription>
            These signal combinations will not be shown in backtesting results. You can re-enable them here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {optedOutCombinations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No combinations have been opted out yet.
              <p className="text-sm mt-1">You can opt out combinations from the Combination Stats page.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Combination</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {optedOutCombinations.map((optOut) => (
                  <TableRow key={optOut.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">
                          {(optOut.combination_signature || "").split('+').map((signal, idx) => (
                            <Badge key={idx} variant="secondary" className="mr-1 mb-1">
                              {signal}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500">
                          {optOut.combination_details?.signal_count || 0} signals
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {optOut.coin ? ( <Badge variant="secondary">{optOut.coin}</Badge> ) : ( <Badge variant="outline">All Coins</Badge> )}
                        {optOut.timeframe ? ( <Badge variant="secondary">{optOut.timeframe}</Badge> ) : ( <Badge variant="outline">All Timeframes</Badge> )}
                      </div>
                    </TableCell>
                    <TableCell><span className="text-sm text-gray-600 dark:text-gray-300">{optOut.reason}</span></TableCell>
                    <TableCell><span className="text-sm text-gray-500 dark:text-gray-400">{format(new Date(optOut.opted_out_date), "MMM dd, yyyy")}</span></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeOptOut(optOut.id)} className="text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full" title="Re-enable this combination">
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-4 sm:px-0">
        <h1 className="text-3xl font-bold">Advanced Backtesting Engine</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowOptedOutDialog(true)} className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Opted Out ({optedOutCombinations.length})
          </Button>
        </div>
      </div>

      <div className="container mx-auto py-8 space-y-6">
        {/* Enhanced Header Card */}
        <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 via-white to-purple-50 dark:from-gray-800 dark:via-gray-900 dark:to-blue-900/50">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold leading-none tracking-tight text-3xl font-bold flex items-center">
    CryptoSentinel Backtesting Engine V10.1
            </CardTitle>
            <CardDescription className="text-lg">
              Test your trading strategies against historical Binance data with 32+ technical indicators, advanced pattern recognition, and regime-aware signal analysis.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Alert for failed coins */}
        {failedCoins.length > 0 && (
          <Alert variant="destructive" className="my-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some Coins Were Skipped</AlertTitle>
            <AlertDescription>
              Could not retrieve market data or process backtest for the following coins:{" "}
              <ul className="list-disc list-inside mt-2 space-y-1">
                {failedCoins.map((fc, index) => (
                  <li key={index}><span className="font-semibold">{fc.coin}</span>: {fc.reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Progress Indicators */}
        {dataLoadingProgress > 0 && dataLoadingProgress < 100 && (
          <div className="fixed bottom-4 left-4 bg-card dark:bg-gray-800 p-4 rounded-lg shadow-xl z-40 max-w-sm border border-blue-200 dark:border-blue-900">
            <div className="flex items-center space-x-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <h4 className="font-medium">Loading data for {backtestOverallProgress.currentCoin}</h4>
                <p className="text-xs text-muted-foreground">{Math.round(dataLoadingProgress)}% complete</p>
                <Progress value={dataLoadingProgress} className="mt-2 h-1.5" />
              </div>
            </div>
          </div>
        )}

        {loading && (
           <div className="my-4 p-4 bg-card dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700">
              <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-primary">Overall Backtest Progress</span>
                  <span className="text-sm font-medium text-primary">{Math.round(backtestOverallProgress.overall)}%</span>
              </div>
              <Progress value={backtestOverallProgress.overall} className="w-full h-2" />
              {backtestOverallProgress.stage && <p className="text-xs text-muted-foreground mt-1 text-center">{backtestOverallProgress.stage}</p>}
              {backtestOverallProgress.currentCoin && backtestOverallProgress.overall < 100 && (
                <p className="text-xs text-muted-foreground mt-0.5 text-center">Processing {backtestOverallProgress.currentCoin}: {Math.round(backtestOverallProgress.coinProgress)}%</p>
              )}
           </div>
        )}

        {/* Configuration Section */}
        <div className="space-y-6">
          {/* Market & Timeframe Configuration */}
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Settings2 className="mr-2 h-5 w-5" />
                Market & Timeframe
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="coin-select">Coins (Select multiple)</Label>
                <MultiSelectCoin
                  options={availableCoins}
                  selectedValues={selectedCoins}
                  onChange={handleCoinsChange}
                  placeholder="Select coins to backtest..."
                />
              </div>
              <div>
                <Label htmlFor="timeframe-select">Candle Timeframe</Label>
                <Select value={timeframe} onValueChange={handleTimeframeChange}>
                  <SelectTrigger id="timeframe-select">
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeframes.map(tf => (
                      <SelectItem key={tf.value} value={tf.value}>{tf.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="period-select">Historical Period</Label>
                <Select value={period} onValueChange={handlePeriodChange}>
                  <SelectTrigger id="period-select">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Backtest Parameters */}
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <TrendingUp className="mr-2 h-5 w-5" />
                Backtest Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="target-gain">Minimum Price Move (Success Target %)</Label>
                <div className="relative">
                  <Input
                    id="target-gain"
                    type="number"
                    value={targetGain}
                    onChange={(e) => parseFloat(e.target.value) >= 0.1 ? setTargetGain(parseFloat(e.target.value)) : setTargetGain(0.1)}
                    min="0.1"
                    step="0.1"
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Defines the minimum price increase (%) that must be reached within the "Future Window" for a single occurrence to be considered successful. This affects the 'Success Rate' metric.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              {/* NEW: Minimum Average Price Move Filter */}
              <div>
                <Label htmlFor="min-average-price-move">Minimum Average Price Move (Filter %)</Label>
                <div className="relative">
                  <Input
                    id="min-average-price-move"
                    type="number"
                    value={minAveragePriceMove}
                    onChange={(e) => setMinAveragePriceMove(parseFloat(e.target.value) || 0)}
                    step="0.1"
                    min="0"
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Filters the final list of strategies. Only shows strategies whose overall 'Avg Move' (across all successes and failures) is greater than or equal to this value.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <div>
                <Label htmlFor="min-strength-slider">Minimum Combined Signal Strength</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    id="min-strength-slider"
                    min={50}
                    max={400}
                    step={50}
                    value={[minCombinedStrength]}
                    onValueChange={(value) => setMinCombinedStrength(value[0])}
                    className="w-full"
                  />
                  <span className="font-mono text-sm w-16 text-center">{minCombinedStrength}</span>
                </div>
                <div className="relative">
                          <TooltipProvider>
                              <Tooltip>
                                  <TooltipTrigger asChild><p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 cursor-help"><Info className="h-3 w-3" />Controls signal combination quality. Higher values = fewer but stronger setups.</p></TooltipTrigger>
                                  <TooltipContent sideOffset={8} className="max-w-md p-4 bg-popover text-popover-foreground border shadow-lg rounded-lg">
                                      <div className="space-y-3">
                                          <div className="font-semibold text-primary text-lg">Signal Strength Scoring Guide</div>
                                          <div className="font-medium text-popover-foreground">Individual Signal Strength (50-100 pts)</div>
                                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                              <div className="text-red-600 dark:text-red-400">50-69:<span className="ml-1">Weak</span></div>
                                              <div className="text-yellow-600 dark:text-yellow-400">70-79:<span className="ml-1">Moderate</span></div>
                                              <div className="text-green-600 dark:text-green-400">80-89:<span className="ml-1">Strong</span></div>
                                              <div className="text-blue-600 dark:text-blue-400">90-100:<span className="ml-1">Very Strong</span></div>
                                          </div>
                                          <div className="space-y-2">
                                              <div className="font-medium text-popover-foreground">Example Combination</div>
                                              <div className="space-y-1 text-sm bg-accent p-3 rounded-md border border-border">
                                                  <div className="text-primary font-medium">BTC/USDT Bullish Setup:</div>
                                                  <div>• RSI deeply oversold (85 pts)</div><div>• Volume surge 3x average (78 pts)</div><div>• Price bouncing off MA200 (87 pts)</div>
                                                  <div className="border-t border-border pt-1 mt-2"><span className="text-primary font-bold">Total Combined Strength: 250</span></div>
                                                  <div className="text-xs text-muted-foreground">This setup would pass a 150 threshold but not a 270 threshold.</div>
                                              </div>
                                          </div>
                                          <div className="border-t border-border pt-3">
                                              <div className="font-medium mb-2">Recommended Thresholds:</div>
                                              <div className="space-y-1 text-sm">
                                                  <div><span className="text-green-600 dark:text-green-400">50-70:</span> Single Signal Analysis</div>
                                                  <div><span className="text-yellow-600 dark:text-yellow-400">100-130:</span> Exploratory (more noise)</div>
                                                  <div><span className="text-blue-600 dark:text-blue-400">150:</span> Balanced (default)</div>
                                                  <div><span className="text-purple-600 dark:text-purple-400">180-200:</span> Conservative (high conviction)</div>
                                                  <div><span className="text-red-600 dark:text-red-400">220+:</span> Ultra-Selective (A+ setups)</div>
                                              </div>
                                          </div>
                                          <div className="border-t border-border pt-3 text-sm text-muted-foreground">
                                              <div className="font-medium mb-2 flex items-center gap-2"><Info className="h-4 w-4" /> Pro Tip:</div>
                                              <div>For single signal testing, use 50-70. For strategy discovery, start with 150, then increase to filter for your highest-conviction strategies.</div>
                                          </div>
                                      </div>
                                  </TooltipContent>
                              </Tooltip>
                          </TooltipProvider>
                      </div>
              </div>

              <div>
                <Label htmlFor="min-profit-factor-slider">Minimum Profit Factor</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    id="min-profit-factor-slider"
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    value={[minProfitFactor]}
                    onValueChange={(value) => setMinProfitFactor(value[0])}
                    className="w-full"
                  />
                  <span className="font-mono text-sm w-16 text-center">{minProfitFactor.toFixed(1)}</span>
                </div>
                <div className="relative">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 cursor-help">
                          <Info className="h-3 w-3" />
                          Filter strategies by profit factor (total wins ÷ total losses)
                        </p>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8} className="max-w-md p-4">
                        <div className="space-y-3">
                          <div className="font-semibold text-primary text-lg">Profit Factor Guide</div>
                          <div className="space-y-2">
                            <div className="text-sm">
                              <div className="font-medium mb-2">Quality Levels:</div>
                              <div className="space-y-1">
                                <div><span className="text-red-600 dark:text-red-400">0.5-1.0:</span> Losing strategies</div>
                                <div><span className="text-yellow-600 dark:text-yellow-400">1.0-1.5:</span> Breakeven to modest profit</div>
                                <div><span className="text-green-600 dark:text-green-400">1.5-2.0:</span> Good profitability</div>
                                <div><span className="text-blue-600 dark:text-blue-400">2.0-3.0:</span> Excellent strategies</div>
                                <div><span className="text-purple-600 dark:text-purple-400">3.0+:</span> Outstanding performance</div>
                              </div>
                            </div>
                            <div className="text-sm border-t pt-2">
                              <div className="font-medium">Example:</div>
                              <div>Total Wins: $300, Total Losses: $150</div>
                              <div>Profit Factor: 300 ÷ 150 = 2.0</div>
                            </div>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="required-signals-backtest">Min. Signals Required</Label>
                  <Input
                    id="required-signals-backtest"
                    type="number"
                    value={requiredSignalsForBacktest}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setRequiredSignalsForBacktest(val);
                      if (val > maxSignals) { setMaxSignals(val); }
                    }}
                    min="1"
                  />
                </div>
                <div>
                  <Label htmlFor="max-signals">Max Signals to Consider</Label>
                  <Input
                    id="max-signals"
                    type="number"
                    value={maxSignals}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setMaxSignals(val);
                      if (val < requiredSignalsForBacktest) { setRequiredSignalsForBacktest(val); }
                    }}
                    min="1"
                    max="10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="time-window">Future Window (for gain check)</Label>
                    <Select value={timeWindow} onValueChange={setTimeWindow}>
                      <SelectTrigger id="time-window">
                        <SelectValue placeholder="Select window" />
                      </SelectTrigger>
                      <SelectContent>
                        {futureWindows.map(window => (
                          <SelectItem key={window.value} value={window.value}>{window.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      The time period after a signal to check for the price move. Must be longer than the candle timeframe.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="min-occurrences">Minimum Occurrences</Label>
                    <Input
                      id="min-occurrences"
                      type="number"
                      value={minOccurrences}
                      onChange={(e) => setMinOccurrences(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                    />
                  </div>
              </div>

              {/* NEW: Signal Type Filter */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Signal Type Filter</Label>
                <div className="flex gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={signalTypeFilter === 'events' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSignalTypeFilter('events')}
                          className="flex-1"
                        >
                          <Zap className="mr-2 h-4 w-4" />
                          Event Signals Only
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Show combinations triggered by distinct market events like crossovers, breakouts, or specific pattern completions. Ideal for identifying precise entry points.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={signalTypeFilter === 'states' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSignalTypeFilter('states')}
                          className="flex-1"
                        >
                          <BarChart3 className="mr-2 h-4 w-4" />
                          State Signals Only
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Show combinations that describe prevailing market conditions or continuous indicator states. Useful for understanding market context and confirming setups.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={signalTypeFilter === 'both' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSignalTypeFilter('both')}
                          className="flex-1"
                        >
                          <Layers className="mr-2 h-4 w-4" />
                          Both Types
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Show all signal combinations regardless of type. This gives you the complete picture of all potential trading setups.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

                {/* NEW: Regime-Aware Backtesting Toggle */}
                <div>
                  <Label className="text-sm font-medium mb-3 block flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4" />
                    Regime-Aware Strategy Selection
                  </Label>
                  <div className="flex items-center space-x-3">
                    <Switch
                      id="regime-aware-toggle"
                      checked={isRegimeAware}
                      onCheckedChange={setIsRegimeAware}
                    />
                    <div className="flex-1">
                      <Label htmlFor="regime-aware-toggle" className="text-sm font-medium">
                        {isRegimeAware ? 'Enabled' : 'Disabled'}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isRegimeAware
                          ? 'Strategies will be dynamically filtered based on detected market regimes during backtest.'
                          : 'Traditional backtesting - all enabled strategies evaluated uniformly.'}
                      </p>
                    </div>
                  </div>
                </div>
            </CardContent>
          </Card>

          {/* REFACTORED: Signal Configuration now uses a dedicated component */}
          <TechnicalSignalPanel
              signalSettings={signalSettings}
              onSignalEnabledChange={handleSignalEnabledChange}
              onSignalParameterChange={handleSignalParameterChange}
              openAccordions={openAccordions}
              onAccordionChange={setOpenAccordions}
          />
        </div>

        {/* Action Buttons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <ChevronRight className="mr-2 h-5 w-5" />
              Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button
                onClick={runBacktest}
                disabled={loading}
                className="text-lg py-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LineChartIconLucide className="mr-2 h-5 w-5" />
                )}
                {loading ? `Backtesting...` : "Run Full Backtest"}
              </Button>
              <Button onClick={resetFilters} variant="outline" disabled={loading}>
                <FilterX className="mr-2 h-4 w-4" />
                Reset Settings
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button onClick={handleSaveConfig} variant="secondary" className="w-full">
                <Save className="mr-2 h-4 w-4" />
                Save Current Configuration
              </Button>
              <SaveCombinationsButton
                combinations={filteredSignalCombinations}
                timeframe={timeframe}
                getPandasTaSignalType={getPandasTaSignalType}
                minProfitFactor={minProfitFactor}
              />
            </div>
            {signalCombinations.length > 0 && !loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ExportResults
                  combinations={signalCombinations}
                  backtestResults={backtestResults}
                  timeframe={timeframe}
                />
                <CompareSignals combinations={signalCombinations} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Price Chart */}
        {historicalData && historicalData.length > 0 && !loading && (
          <PriceChart
            data={historicalData}
            loading={false}
            signalPoints={signalMatches.filter(m => m.coin === currentCoinForChart)}
            symbol={currentCoinForChart}
          />
        )}

        {(!historicalData || historicalData.length === 0) && !loading && (
          <div className="flex flex-col items-center justify-center h-[400px] bg-card dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              Price chart will appear here after running a backtest.<br />
              The chart will show candlestick data with signal markers for the analyzed coins.
            </p>
          </div>
        )}

        {/* Results Tabs */}
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveOverallTab('results')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeOverallTab === 'results'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Results
          </button>
          <button
            onClick={() => setActiveOverallTab('logs')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeOverallTab === 'logs'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'
            }`}
          >
            Engine Logs ({engineLogs.length})
          </button>
          <button
            onClick={() => setActiveOverallTab('debug')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeOverallTab === 'debug'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'
            }`}
          >
            <BrainCircuit className="h-4 w-4 inline-block mr-1" /> Debug Console
          </button>
        </div>

        {/* FIXED: Results Content Block with corrected JSX structure */}
        {activeOverallTab === 'results' && (
          <div className="bg-card dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
            <div className="flex border-b border-border dark:border-gray-700">
              <button
                onClick={() => { setActiveResultsTab("summary"); setCurrentPage(1); }}
                className={`flex-1 py-4 px-6 text-lg font-medium ${
                  activeResultsTab === "summary"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-700"
                } flex items-center justify-center transition-colors`}
              >
                <BarChart3 className={`h-5 w-5 mr-2 ${activeResultsTab === "summary" ? "text-primary" : "text-muted-foreground"}`} />
                Backtest Performance Summary
              </button>
              <button
                onClick={() => { setActiveResultsTab("signals"); setCurrentPage(1); }}
                className={`flex-1 py-4 px-6 text-lg font-medium ${
                  activeResultsTab === "signals"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-700"
                } flex items-center justify-center transition-colors`}
              >
                <LineChartIconLucide className={`h-5 w-5 mr-2 ${activeResultsTab === "signals" ? "text-primary" : "text-muted-foreground"}`} />
                Top Performing Signal Combinations
              </button>
            </div>
            <div className="p-6">
              {activeResultsTab === "summary" ? (
                <div className="space-y-6"> {/* New wrapper div */}
                  <BacktestSummary
                    results={backtestResults}
                    signalCombinations={filteredSignalCombinations} // FIX: Pass filtered list to summary
                    minOccurrences={minOccurrences}
                    signalSettings={signalSettings}
                    timeExitStrategy={timeExitStrategy}
                    selectedCoins={selectedCoins}
                    timeframe={timeframe}
                  />
                  <Card>
                      <CardHeader>
                          <CardTitle>Profitable Combinations ({profitableCombinations.length})</CardTitle>
                          <CardDescription>
                              Combinations with over 50% success rate and more than 1 occurrence.
                          </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 max-h-[600px] overflow-y-auto">
                          {profitableCombinations.length === 0 ? (
                            <p className="text-center text-muted-foreground py-4">No profitable combinations found based on current criteria (success rate &gt; 50%, occurrences &gt; 1).</p>
                          ) : (
                              profitableCombinations.map((combo, index) => (
                                  <div key={index} className="border p-4 rounded-lg space-y-2">
                                      <div className="flex justify-between items-start">
                                          <div>
                                              <h4 className="font-semibold text-md">Combination #{index + 1}</h4>
                                              <div className="flex flex-wrap gap-1 mt-1">
                                                  {combo.signals.map((s, i) => (
                                                      <Badge key={i} variant="secondary" className="text-xs">
                                                          {s.type}: {s.value}
                                                      </Badge>
                                                  ))}
                                              </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <Badge>
                                                  PF: {isFinite(combo.profitFactor) ? combo.profitFactor.toFixed(2) : '∞'}
                                              </Badge>
                                              {combo.dominantMarketRegime && (
                                                  <Badge 
                                                      className={`capitalize ${
                                                          combo.dominantMarketRegime === 'uptrend' ? 'bg-green-100 text-green-800' :
                                                          combo.dominantMarketRegime === 'downtrend' ? 'bg-red-100 text-red-800' :
                                                          combo.dominantMarketRegime === 'ranging' ? 'bg-blue-100 text-blue-800' :
                                                          'bg-gray-100 text-gray-800'
                                                      }`}
                                                  >
                                                      {combo.dominantMarketRegime === 'uptrend' && '↗️ '}
                                                      {combo.dominantMarketRegime === 'downtrend' && '↘️ '}
                                                      {combo.dominantMarketRegime === 'ranging' && '↔️ '}
                                                      {combo.dominantMarketRegime}
                                                  </Badge>
                                              )}
                                          </div>
                                      </div>
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                          <p><strong>Occurrences:</strong> {combo.occurrences}</p>
                                          <p><strong>Success Rate:</strong> {toFixedSafe(combo.successRate, 2, '0.00')}%</p>
                                          <p><strong>Avg. Move:</strong> {toFixedSafe((combo.avgPriceMove ?? combo.netAveragePriceMove), 2, '0.00')}%</p>
                                          <p><strong>Coin:</strong> {combo.coin}</p>
                                      </div>
                                  </div>
                              ))
                          )}
                      </CardContent>
                      <CardFooter>
                          <SaveCombinationsButton
                              combinations={profitableCombinations}
                              timeframe={timeframe}
                              getPandasTaSignalType={getPandasTaSignalType}
                              minProfitFactor={minProfitFactor}
                          />
                      </CardFooter>
                  </Card>
                </div>
              ) : (
                <div>
                  {backtestResults && (
                    <Card className="mb-4 shadow-md">
                      <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row justify-around items-center text-center gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">Coins Tested</p>
                            <p className="text-xl font-bold text-primary">{selectedCoins.length}</p>
                          </div>
                          <div className="h-12 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                          <hr className="w-full border-gray-300 dark:border-gray-600 sm:hidden my-2" />
                          <div>
                            <p className="text-sm text-muted-foreground">Optimal Strategy Events</p>
                            <p className="2xl:font-bold text-primary">{allRawMatchesFromEngine.length.toLocaleString()}</p>
                          </div>
                          <div className="h-12 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                          <hr className="w-full border-gray-300 dark:border-gray-600 sm:hidden my-2" />
                          <div>
                            <p className="text-sm text-muted-foreground">Unique Signal Combinations</p>
                            <p className="2xl:font-bold text-primary">{filteredSignalCombinations.length.toLocaleString()}</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-3 text-center">
                          These numbers reflect the unique combinations found and the final count of high-quality events after filtering for the best strategy at each trigger point.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                    <h2 className="text-xl font-semibold">
                      Top Performing Signal Combinations
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({filteredSignalCombinations.length} found)
                      </span>
                    </h2>

                    {/* NEW: Dominant Regime Filter */}
                    <div className="flex items-center gap-2 border p-1 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant={regimeFilter === 'all' ? 'default' : 'ghost'} size="sm" onClick={() => setRegimeFilter('all')}>
                                        <Globe className="mr-2 h-4 w-4" />All Regimes
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Show all strategies regardless of their dominant market regime.</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant={regimeFilter === 'trending' ? 'default' : 'ghost'} size="sm" onClick={() => setRegimeFilter('trending')}>
                                        <TrendingUp className="mr-2 h-4 w-4" />Trending
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Show strategies that perform best in trending markets.</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant={regimeFilter === 'ranging' ? 'default' : 'ghost'} size="sm" onClick={() => setRegimeFilter('ranging')}>
                                        <ArrowLeftRight className="mr-2 h-4 w-4" />Ranging
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Show strategies that perform best in ranging/sideways markets.</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                  </div>
                  <SignalMatchList
                    matches={getPaginatedSignalCombinations()}
                    minOccurrences={minOccurrences}
                    sortBy={signalListSortBy}
                    signalSettings={signalSettings}
                    historicalPeriod={period}
                    timeframe={timeframe}
                    timeExitStrategy={timeExitStrategy}
                    targetGain={targetGain}
                    minProfitFactor={minProfitFactor}
                  />
                  {totalPages > 1 && (
                    <div className="mt-6 flex justify-center items-center space-x-2">
                      <Button onClick={goToPrevPage} disabled={currentPage === 1} variant="outline">
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button onClick={goToNextPage} disabled={currentPage === totalPages} variant="outline">
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeOverallTab === 'logs' && (
            <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-5 w-5" />
                      Backtesting Engine Logs
                    </CardTitle>
                    <CardDescription>
                      Detailed logs from the backtesting engine showing signal evaluation and processing steps.
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleCopyLog}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Log
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-4 font-mono text-xs">
                    {engineLogs.length === 0 ? (
                      <div className="text-gray-500 dark:text-gray-400 text-center py-8">
                        No logs yet. Run a backtest to see engine logs.
                      </div>
                    ) : (
                      <div className="space-y-1 whitespace-pre-wrap">
                        {engineLogs.map((log, index) => (
                          <div key={index} className={`flex gap-2 ${
                            log.level === 'error' ? 'text-red-600 dark:text-red-400' :
                            log.level === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                            log.level === 'success' ? 'text-green-600 dark:text-green-400' :
                            log.level === 'summary' ? 'text-blue-600 dark:text-blue-400' :
                            'text-gray-700 dark:text-gray-300'
                          }`}>
                            <span className="text-gray-500 dark:text-gray-400 w-24 flex-shrink-0">
                              {log.timestamp}
                            </span>
                            <span className="break-all">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
            </Card>
        )}

        {activeOverallTab === 'debug' && (
            <DebugConsole data={debugData} />
        )}
      </div>

      <OptedOutCombinationsDialog />
    </div>
  );
}
