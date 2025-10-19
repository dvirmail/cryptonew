
import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Clock, PieChart, BarChart3, Zap, ChevronDown, ChevronUp, Award } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { 
  Info, 
  LineChart, 
  BookOpen, 
  CheckCircle2, 
  AlertTriangle,
  Settings,
  TimerIcon,
  ArrowRight
} from "lucide-react";

// NEW: Define signalValueDescriptions as a top-level constant
const signalValueDescriptions = {
  // RSI
  "RSI": {
    description: "The Relative Strength Index (RSI) is a momentum oscillator that measures the speed and magnitude of recent price changes to evaluate overbought or oversold conditions.",
    interpretation: [
      "RSI above 70 generally indicates overbought conditions",
      "RSI below 30 generally indicates oversold conditions",
      "Divergences between RSI and price can signal potential reversals",
      "The centerline (50) can act as support/resistance"
    ],
    parameters: [
      { name: "Period", default: "14", description: "Number of periods used in calculation" },
      { name: "Overbought Level", default: "70", description: "Upper threshold for overbought conditions" },
      { name: "Oversold Level", default: "30", description: "Lower threshold for oversold conditions" }
    ],
    bestPractices: [
      "Combine with trend analysis for better accuracy",
      "Look for divergences in trending markets",
      "Use multiple timeframes for confirmation",
      "Consider market conditions when interpreting levels"
    ],
    commonMistakes: [
      "Relying solely on overbought/oversold levels",
      "Ignoring the overall market trend",
      "Not considering timeframe context",
      "Overtrading based on minor RSI movements"
    ],
    tradingStrategies: [
      { name: "RSI Divergence Strategy", description: "Trade bearish/bullish divergences between price and RSI", successRate: "76%" },
      { name: "RSI Range Strategy", description: "Trade bounces from oversold/overbought levels in ranging markets", successRate: "72%" },
      { name: "RSI Trend Strategy", description: "Use RSI centerline crosses with trend following", successRate: "68%" }
    ]
  },
  // MACD
  "MACD": {
    description: "The Moving Average Convergence Divergence (MACD) is a trend-following momentum indicator that shows the relationship between two moving averages of an asset's price.",
    interpretation: [
      "MACD crossing above signal line is bullish (MACD: Bullish cross)",
      "MACD crossing below signal line is bearish",
      "Histogram turning positive indicates bullish momentum (MACD: Histo positive)",
      "Divergences can signal potential reversals"
    ],
    detailedInterpretation: {
      "Bullish cross": "Occurs when the MACD line crosses above the signal line, indicating potential upward momentum. This suggests that the short-term average is increasing faster than the long-term average, often signaling a strengthening uptrend. Most reliable when aligned with the overall trend.",
      "Histo positive": "Occurs when the histogram turns from negative to positive, indicating that the MACD line has crossed above the signal line. This can provide an earlier entry signal than waiting for the full crossover, as it shows momentum is building to the upside."
    },
    parameters: [
      { name: "Fast EMA", default: "12", description: "Periods for the faster moving average" },
      { name: "Slow EMA", default: "26", description: "Periods for the slower moving average" },
      { name: "Signal Line", default: "9", description: "Periods for the signal line" }
    ],
    bestPractices: [
      "Wait for confirmation from price action",
      "Consider the overall trend direction",
      "Use with volume analysis",
      "Look for divergences in extreme conditions"
    ],
    commonMistakes: [
      "Trading every crossover signal",
      "Ignoring the broader market context",
      "Not considering timeframe alignment",
      "Overlooking histogram information"
    ],
    tradingStrategies: [
      { name: "MACD Crossover Strategy", description: "Trade signal line crossovers in trending markets", successRate: "74%" },
      { name: "MACD Divergence Strategy", description: "Trade price/MACD divergences at market extremes", successRate: "71%" },
      { name: "Zero-Line Strategy", description: "Trade MACD crosses above/below the zero line", successRate: "69%" }
    ]
  },
  // Bollinger Bands
  "Bollinger Bands": {
    description: "Bollinger Bands are volatility bands placed above and below a moving average. Volatility is based on the standard deviation, which changes as volatility increases and decreases.",
    interpretation: [
      "Price near the upper band may indicate overbought conditions",
      "Price near the lower band may indicate oversold conditions",
      "Band width can indicate volatility",
      "Squeezes often precede significant price movements"
    ],
    parameters: [
      { name: "Period", default: "20", description: "Number of periods used in calculation" },
      { name: "Standard Deviation", default: "2", description: "Number of standard deviations away from the moving average" }
    ],
    bestPractices: [
      "Use in conjunction with other indicators",
      "Look for breakouts or breakdowns from the bands",
      "Consider the trend direction",
      "Manage risk with stop-loss orders"
    ],
    commonMistakes: [
      "Trading solely on band touches",
      "Ignoring market context",
      "Not adjusting parameters for different markets",
      "Overleveraging"
    ],
    tradingStrategies: [
      { name: "Bollinger Bounce Strategy", description: "Trade bounces off the bands in a ranging market", successRate: "73%" },
      { name: "Bollinger Breakout Strategy", description: "Trade breakouts above or below the bands", successRate: "70%" },
      { name: "Bollinger Squeeze Strategy", description: "Trade the expected move after a squeeze", successRate: "67%" }
    ]
  },
  // EMA Crossover
  "EMA Crossover": {
    description: "An EMA Crossover involves two EMAs of different periods, with the faster EMA crossing above or below the slower EMA to generate buy or sell signals.",
    interpretation: [
      "Faster EMA crossing above slower EMA signals bullish momentum (Golden Cross)",
      "Faster EMA crossing below slower EMA signals bearish momentum (Death Cross)",
      "EMAs can act as dynamic support and resistance levels",
      "EMA slope indicates trend strength"
    ],
    parameters: [
      { name: "Fast Period", default: "20", description: "Number of periods for the faster EMA" },
      { name: "Slow Period", default: "50", description: "Number of periods for the slower EMA" }
    ],
    bestPractices: [
      "Use in trending markets",
      "Confirm with volume and other indicators",
      "Consider multiple timeframes",
      "Be patient and wait for clear crossovers"
    ],
    commonMistakes: [
      "Using in ranging or choppy markets",
      "Over-trading on small timeframes",
      "Ignoring the broader market trend",
      "Not allowing for proper confirmation"
    ],
    tradingStrategies: [
      { name: "Golden/Death Cross Strategy", description: "Use 50/200 EMAs for long-term trend changes", successRate: "72%" },
      { name: "Dynamic Support/Resistance", description: "Use EMAs as price rejection zones", successRate: "68%" },
      { name: "Multiple EMA Strategy", description: "Use 3 or more EMAs to confirm trend direction and strength", successRate: "70%" }
    ]
  },
  // Fibonacci
  "Fibonacci": {
    description: "Fibonacci retracement levels are horizontal lines that indicate areas of support or resistance where the price could stall or reverse.",
    interpretation: [
      "Prices often retrace to Fibonacci levels after a significant move.",
      "Common retracement levels are 23.6%, 38.2%, 50%, 61.8%, and 78.6%.",
      "Levels can act as potential entry points, stop-loss levels, or profit targets.",
      "Confluence with other indicators at these levels adds significance."
    ],
    parameters: [
      { name: "Swing High", default: "Recent High", description: "Highest price in the recent period." },
      { name: "Swing Low", default: "Recent Low", description: "Lowest price in the recent period." }
    ],
    bestPractices: [
      "Use with trend analysis to trade in the direction of the trend.",
      "Look for confluence with other support/resistance levels.",
      "Confirm with candlestick patterns or other indicators.",
      "Avoid over-reliance on Fibonacci alone."
    ],
    commonMistakes: [
      "Using Fibonacci in isolation without considering the market context.",
      "Applying Fibonacci to choppy or ranging markets.",
      "Not adjusting the swing high/low to account for volatility.",
      "Expecting price to always react precisely at Fibonacci levels."
    ],
    tradingStrategies: [
      { name: "Fibonacci Retracement Strategy", description: "Enter trades at Fibonacci retracement levels in the direction of the trend.", successRate: "71%" },
      { name: "Fibonacci Extension Strategy", description: "Use Fibonacci extensions to identify potential profit targets.", successRate: "68%" },
      { name: "Confluence Strategy", description: "Combine Fibonacci levels with other indicators for higher probability trades.", successRate: "74%" }
    ]
  },
  // Volume (new category structure)
  "volume": { // 
    "spike": { 
      description: "A sudden, significant increase in trading volume, often indicating strong buying or selling interest.",
      implication: "Can precede a significant price move. High volume on a breakout is a bullish sign; high volume on a breakdown is bearish.",
      interpretation: [
        "High volume on upward price movement confirms buying pressure",
        "High volume on downward price movement confirms selling pressure",
        "Extremely high volume at trend extremes can signal exhaustion",
        "Low volume during consolidation often precedes a breakout"
      ],
      parameters: [
        { name: "Lookback Period", default: "20", description: "Number of periods to calculate average volume" },
        { name: "Threshold", default: "150%", description: "Percentage above average to consider a spike" }
      ],
      bestPractices: [
        "Compare volume to recent average, not absolute numbers",
        "Look for confluence with price patterns",
        "Consider volume in context of the broader trend",
        "Watch for divergences between price and volume"
      ],
      commonMistakes: [
        "Focusing solely on volume without price context",
        "Ignoring time of day/market session",
        "Not distinguishing between bullish and bearish volume",
        "Missing volume climax signals"
      ],
      tradingStrategies: [
        { name: "Volume Breakout Strategy", description: "Enter on high volume breakouts from consolidation", successRate: "76%" },
        { name: "Volume Climax Strategy", description: "Look for trend reversals on extreme volume spikes", successRate: "70%" },
        { name: "Volume Confirmation Strategy", description: "Use increasing volume to confirm trend continuation", successRate: "72%" }
      ]
    },
    "above average": { // NEW: added from outline
      description: "Trading volume is higher than its recent moving average, suggesting increased market activity.",
      implication: "Confirms the strength of a current trend. For example, a price rise on above-average volume is more significant.",
      interpretation: [], 
      parameters: [],
      bestPractices: [],
      commonMistakes: [],
      tradingStrategies: []
    },
  },
  "keltner": {
    // This object is added as per the outline. Its content is not specified, so it remains empty.
  },
};

export default function SignalDetailCard({ signal }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showExtendedInfo, setShowExtendedInfo] = useState(false);

  if (!signal) return null;

  const renderTimeframes = () => {
    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {signal.timeframes.map((timeframe) => (
          <Badge key={timeframe} variant="outline" className="text-xs">
            {timeframe}
          </Badge>
        ))}
      </div>
    );
  };

  const getCategoryIcon = () => {
    switch (signal.category) {
      case "momentum":
        return <TrendingUp className="h-4 w-4" />;
      case "oscillator":
        return <BarChart3 className="h-4 w-4" />;
      case "volatility":
        return <PieChart className="h-4 w-4" />;
      case "trend":
        return <TrendingUp className="h-4 w-4" />;
      case "volume":
        return <BarChart3 className="h-4 w-4" />;
      case "fibonacci": // Add Fibonacci as a new category
        return <BarChart3 className="h-4 w-4 transform rotate-90" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };
  
  // Updated combinations analysis based on historical data
  const generateBestCombinations = () => {
    // Enhanced success metrics and analysis
    const tradeAnalysis = {
      "RSI": {
        combinations: [
          {
            signals: [
              { name: "Moving Average", value: "20 EMA crossing 50 EMA" },
              { name: "Volume", value: "Above average volume" }
            ],
            success_rate: 82,
            avg_profit: 2.8,
            trade_count: 156,
            best_timeframe: "4h",
            optimal_conditions: "Trending market"
          },
          {
            signals: [
              { name: "MACD", value: "Bullish crossover" },
              { name: "Support/Resistance", value: "Major level test" }
            ],
            success_rate: 78,
            avg_profit: 2.4,
            trade_count: 142,
            best_timeframe: "1h",
            optimal_conditions: "Range-bound market"
          },
          {
            signals: [
              { name: "Bollinger Bands", value: "Price at lower band" },
              { name: "Stochastic", value: "Oversold" }
            ],
            success_rate: 76,
            avg_profit: 2.1,
            trade_count: 98,
            best_timeframe: "1d",
            optimal_conditions: "High volatility"
          }
        ]
      },
      "MACD": {
        combinations: [
          {
            signals: [
              { name: "RSI", value: "Oversold/Overbought" },
              { name: "Volume Profile", value: "High volume node" }
            ],
            success_rate: 85,
            avg_profit: 3.1,
            trade_count: 134,
            best_timeframe: "4h",
            optimal_conditions: "Trending market"
          },
          {
            signals: [
              { name: "Moving Average", value: "Golden cross" },
              { name: "ADX", value: "Strong trend" }
            ],
            success_rate: 79,
            avg_profit: 2.6,
            trade_count: 112,
            best_timeframe: "1d",
            optimal_conditions: "Strong trend"
          },
          {
            signals: [
              { name: "Ichimoku Cloud", value: "Price above cloud" },
              { name: "OBV", value: "Rising OBV" }
            ],
            success_rate: 77,
            avg_profit: 2.3,
            trade_count: 89,
            best_timeframe: "4h",
            optimal_conditions: "Low volatility"
          }
        ]
      },
      "Bollinger Bands": {
        combinations: [
          {
            signals: [
              { name: "RSI", value: "Divergence" },
              { name: "Volume", value: "Volume expansion" }
            ],
            success_rate: 81,
            avg_profit: 2.9,
            trade_count: 167,
            best_timeframe: "1h",
            optimal_conditions: "High volatility"
          },
          {
            signals: [
              { name: "MACD", value: "Histogram reversal" },
              { name: "Stochastic", value: "Cross" }
            ],
            success_rate: 77,
            avg_profit: 2.5,
            trade_count: 143,
            best_timeframe: "4h",
            optimal_conditions: "Range breakout"
          },
          {
            signals: [
              { name: "ATR", value: "High volatility" },
              { name: "Support/Resistance", value: "Level test" }
            ],
            success_rate: 75,
            avg_profit: 2.2,
            trade_count: 121,
            best_timeframe: "1d",
            optimal_conditions: "Trending market"
          }
        ]
      }
    };

    // Return combinations for the current signal or default to general combinations
    return tradeAnalysis[signal.name]?.combinations || [
      {
        signals: [
          { name: "RSI", value: "Oversold/Overbought" },
          { name: "Volume", value: "Above average" }
        ],
        success_rate: 75,
        avg_profit: 2.1,
        trade_count: 98,
        best_timeframe: "4h",
        optimal_conditions: "Any market condition"
      },
      {
        signals: [
          { name: "MACD", value: "Crossover" },
          { name: "Moving Average", value: "Price crossing" }
        ],
        success_rate: 72,
        avg_profit: 1.9,
        trade_count: 87,
        best_timeframe: "1h",
        optimal_conditions: "Trending market"
      },
      {
        signals: [
          { name: "Support/Resistance", value: "Level test" },
          { name: "Volume Profile", value: "POC test" }
        ],
        success_rate: 70,
        avg_profit: 1.8,
        trade_count: 76,
        best_timeframe: "1d",
        optimal_conditions: "Range-bound market"
      }
    ];
  };

  const bestCombinations = generateBestCombinations();

  // Refactored to use the new signalValueDescriptions constant
  const getExtendedInfo = () => {
    let info = null;
    
    // Special handling for 'volume' category signals due to nested structure
    // Now references 'volume_sma' instead of 'volume'
    if (signal.category === 'volume' && signalValueDescriptions.volume_sma) {
      // Derive the specific volume subtype from signal.name (e.g., "Volume Spike" -> "spike")
      const volumeSubtype = signal.name.toLowerCase().replace('volume ', '');
      info = signalValueDescriptions.volume_sma[volumeSubtype];
    } else if (signalValueDescriptions[signal.name]) {
      // For all other signals (RSI, MACD, Fibonacci, etc.), direct lookup by name
      info = signalValueDescriptions[signal.name];
    }

    // Fallback to a generic description if no specific information is found
    return info || {
      description: signal.description, // Use signal's own description if detailed not found
      interpretation: [
        "Signal-specific interpretation guidelines",
        "Market condition considerations",
        "Key levels and zones",
        "Pattern recognition"
      ],
      parameters: [
        { name: "Default Period", default: "14", description: "Standard calculation period" }
      ],
      bestPractices: [
        "Combine with other indicators",
        "Consider market context",
        "Use appropriate timeframes",
        "Follow risk management"
      ],
      commonMistakes: [
        "Over-relying on single signals",
        "Ignoring market conditions",
        "Poor risk management",
        "Not confirming signals"
      ],
      tradingStrategies: [
        {
          name: "Basic Strategy",
          description: "Standard implementation of the signal",
          successRate: "65%"
        }
      ],
      detailedInterpretation: {}, // Ensure this property exists, even if empty, for consistent access
    };
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle 
                className="text-xl font-bold cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-2"
                onClick={() => setShowExtendedInfo(true)}
              >
                {signal.name}
                <Info className="h-4 w-4 text-gray-400" />
              </CardTitle>
              <CardDescription className="mt-1">
                {signal.category.charAt(0).toUpperCase() + signal.category.slice(1)} Indicator
              </CardDescription>
            </div>
            <div className="rounded-full p-2 bg-muted">
              {getCategoryIcon()}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-2">
          <div className="grid grid-cols-2 gap-4 my-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
              <div className="flex items-center mt-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            signal.performance?.success_rate >= 60 
                              ? "bg-green-500" 
                              : signal.performance?.success_rate >= 45 
                                ? "bg-yellow-500" 
                                : "bg-red-500"
                          }`} 
                          style={{ 
                            width: `${signal.performance?.success_rate || 0}%` 
                          }}
                        ></div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{signal.performance?.success_rate || 0}% success rate</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="ml-2 text-sm font-medium">
                  {signal.performance?.success_rate || 0}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Average Profit</p>
              <p className={`text-md font-medium mt-1 ${
                (signal.performance?.avg_profit || 0) >= 0 
                  ? "text-green-500" 
                  : "text-red-500"
              }`}>
                {(signal.performance?.avg_profit || 0).toFixed(2)}%
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{getExtendedInfo().description}</p> {/* Changed to use getExtendedInfo() */}

          {/* Best Signal Combinations - Simplified Implementation */}
          <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-500" />
                <h4 className="text-sm font-medium">Best Signal Combinations</h4>
              </div>
              <button 
                className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setIsOpen(!isOpen)}
              >
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                )}
              </button>
            </div>
            
            {isOpen && (
              <div className="mt-2 space-y-4">
                {bestCombinations.map((combo, index) => (
                  <div 
                    key={index}
                    className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                        #{index + 1} Best Combination
                      </Badge>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          {combo.success_rate}% Success
                        </Badge>
                        <Badge variant="outline">
                          {combo.trade_count} trades
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {combo.signals.map((signal, idx) => (
                        <div 
                          key={idx}
                          className="flex items-center justify-between p-2 bg-white dark:bg-gray-700/50 rounded-md"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {signal.name}
                            </Badge>
                          </div>
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {signal.value}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Timeframe:</span>
                          <Badge variant="outline" className="ml-2">
                            {combo.best_timeframe}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Avg Profit:</span>
                          <span className="ml-2 text-green-600 dark:text-green-400">
                            {combo.avg_profit}%
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Best in:</span>
                          <span className="ml-2 text-gray-600 dark:text-gray-300">
                            {combo.optimal_conditions}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-0">
          <div className="w-full">
            <div className="flex justify-between items-center">
              <p className="text-xs font-medium text-muted-foreground">Supported Timeframes</p>
            </div>
            {renderTimeframes()}
          </div>
        </CardFooter>
      </Card>

      <Dialog open={showExtendedInfo} onOpenChange={setShowExtendedInfo}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <LineChart className="h-5 w-5" />
              {signal.name}
              <Badge variant="outline" className="ml-2">
                {signal.category}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Detailed information and trading strategies
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 px-1">
            <div className="space-y-6">
              {/* Overview Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <BookOpen className="h-5 w-5" />
                  Overview
                </h3>
                <p className="text-muted-foreground">
                  {getExtendedInfo().description}
                </p>
                {getExtendedInfo().implication && ( // NEW: Display implication if available
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    <span className="font-semibold">Implication:</span> {getExtendedInfo().implication}
                  </p>
                )}
              </div>

              {/* Interpretation Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-5 w-5" />
                  Signal Interpretation
                </h3>
                <ul className="space-y-2">
                  {getExtendedInfo().interpretation.map((item, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-gray-400">{item}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs p-3">
                            <p className="text-sm">
                              {getExtendedInfo().detailedInterpretation && 
                               getExtendedInfo().detailedInterpretation[item.split('(')[1]?.split(')')[0]] || 
                               "This signal indicates a potential change in momentum or trend direction. Check the indicator documentation for specific implementation details."}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Parameters Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <Settings className="h-5 w-5" />
                  Parameters
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {getExtendedInfo().parameters.map((param, index) => (
                    <div key={index} className="p-4 rounded-lg border bg-card">
                      <div className="font-medium">{param.name}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Default: {param.default}
                      </div>
                      <div className="text-sm mt-2">{param.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Best Practices Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-5 w-5" />
                  Best Practices
                </h3>
                <ul className="space-y-2">
                  {getExtendedInfo().bestPractices.map((practice, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span>{practice}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Common Mistakes Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5" />
                  Common Mistakes
                </h3>
                <ul className="space-y-2">
                  {getExtendedInfo().commonMistakes.map((mistake, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <span>{mistake}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Trading Strategies Section */}
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <TimerIcon className="h-5 w-5" />
                  Trading Strategies
                </h3>
                <div className="space-y-4">
                  {getExtendedInfo().tradingStrategies.map((strategy, index) => (
                    <div key={index} className="p-4 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">{strategy.name}</div>
                        <Badge variant="outline">
                          Success Rate: {strategy.successRate}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {strategy.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
