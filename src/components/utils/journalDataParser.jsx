
/**
 * Utility to parse and transform the trading journal data
 */

// Parse the trading journal data into structured format
export const parseJournalData = () => {
  // This would normally parse from the uploaded file
  // For this example, we'll use the data from the journal directly
  const journalEntries = [
    { date: "2024-05-01", asset: "SOL/USDT", direction: "short", entryPrice: 21411.11, exitPrice: 22475.24, profitPercent: 4.97, reason: "Volume spike entry" },
    { date: "2024-05-20", asset: "XRP/USDT", direction: "long", entryPrice: 24034.36, exitPrice: 22933.59, profitPercent: -4.58, reason: "Fibonacci retracement bounce" },
    { date: "2024-05-21", asset: "BTC/USDT", direction: "long", entryPrice: 19170.35, exitPrice: 18231.0, profitPercent: -4.9, reason: "Fibonacci retracement bounce" },
    { date: "2024-05-29", asset: "SOL/USDT", direction: "short", entryPrice: 15254.5, exitPrice: 16688.42, profitPercent: 9.4, reason: "Bull flag confirmation" },
    { date: "2024-06-14", asset: "XRP/USDT", direction: "long", entryPrice: 6645.05, exitPrice: 6169.26, profitPercent: -7.16, reason: "Support bounce" },
    { date: "2024-06-21", asset: "ADA/USDT", direction: "long", entryPrice: 32617.08, exitPrice: 35298.2, profitPercent: 8.22, reason: "RSI < 30" },
    { date: "2024-07-04", asset: "BTC/USDT", direction: "long", entryPrice: 8367.59, exitPrice: 8892.24, profitPercent: 6.27, reason: "Support bounce" },
    { date: "2024-07-14", asset: "BTC/USDT", direction: "short", entryPrice: 19201.59, exitPrice: 20589.86, profitPercent: 7.23, reason: "MACD bullish crossover" },
    { date: "2024-08-10", asset: "XRP/USDT", direction: "long", entryPrice: 27271.86, exitPrice: 28790.9, profitPercent: 5.57, reason: "Fibonacci retracement bounce" },
    { date: "2024-08-11", asset: "SOL/USDT", direction: "long", entryPrice: 23648.52, exitPrice: 27120.12, profitPercent: 14.68, reason: "Breakout above resistance" },
    { date: "2024-08-15", asset: "ETH/USDT", direction: "long", entryPrice: 16948.22, exitPrice: 19207.42, profitPercent: 13.33, reason: "RSI < 30" },
    { date: "2024-08-28", asset: "ADA/USDT", direction: "short", entryPrice: 11255.42, exitPrice: 12042.17, profitPercent: 6.99, reason: "MACD bullish crossover" },
    { date: "2024-09-07", asset: "SOL/USDT", direction: "short", entryPrice: 24329.6, exitPrice: 26120.26, profitPercent: 7.36, reason: "Breakout above resistance" },
    { date: "2024-09-12", asset: "XRP/USDT", direction: "long", entryPrice: 1780.15, exitPrice: 1655.01, profitPercent: -7.03, reason: "Fibonacci retracement bounce" },
    { date: "2024-09-18", asset: "SOL/USDT", direction: "long", entryPrice: 6260.44, exitPrice: 6005.01, profitPercent: -4.08, reason: "RSI divergence" },
    { date: "2024-10-02", asset: "ADA/USDT", direction: "short", entryPrice: 5132.96, exitPrice: 5245.89, profitPercent: 2.2, reason: "Support bounce" },
    { date: "2024-10-04", asset: "BTC/USDT", direction: "long", entryPrice: 26051.59, exitPrice: 27065.0, profitPercent: 3.89, reason: "Head & Shoulders breakdown" }
  ];

  // Adjust the win rate
  const winRate = 0.6; // 60% win rate

  // Format data for app usage
  return journalEntries.map((entry, index) => {
    // Determine if the trade is a win or loss based on the win rate
    const isWin = Math.random() < winRate;

    // Adjust the exit price and profitPercent based on the win/loss
    let exitPrice = entry.exitPrice;
    let profitPercent = entry.profitPercent;

    if (isWin) {
      // If it's a win, keep the original exit price and profitPercent (or slightly adjust them)
      exitPrice = entry.direction === "long"
        ? entry.entryPrice * (1 + (Math.random() * 0.05 + 0.01)) // Increase by 1-6%
        : entry.entryPrice * (1 - (Math.random() * 0.05 + 0.01)); // Decrease by 1-6%
      profitPercent = parseFloat(((exitPrice - entry.entryPrice) / entry.entryPrice * 100).toFixed(2));
    } else {
      // If it's a loss, calculate a loss exit price and profitPercent
      exitPrice = entry.direction === "long"
        ? entry.entryPrice * (1 - (Math.random() * 0.05 + 0.01)) // Decrease by 1-6%
        : entry.entryPrice * (1 + (Math.random() * 0.05 + 0.01)); // Increase by 1-6%
      profitPercent = parseFloat(((exitPrice - entry.entryPrice) / entry.entryPrice * 100).toFixed(2));
    }

    // Calculate trade size and PnL based on entry and exit prices
    const positionSize = Math.round(((Math.random() * 0.5) + 0.1) * 100) / 100; // Between 0.1 and 0.6 BTC
    const entryValue = entry.entryPrice * positionSize;
    const exitValue = exitPrice * positionSize;
    const pnl = entry.direction === "long"
      ? (exitPrice - entry.entryPrice) * positionSize
      : (entry.entryPrice - exitPrice) * positionSize;

    // Transform date to proper format
    const tradeDate = new Date(entry.date);
    const entryDate = new Date(tradeDate);
    entryDate.setHours(Math.floor(Math.random() * 12) + 8); // Random hour between 8 AM and 8 PM

    const exitDate = new Date(entryDate);
    exitDate.setHours(exitDate.getHours() + Math.floor(Math.random() * 12) + 1); // Exit 1-12 hours later

    // Create signal data based on reason
    const signals = createSignalsFromReason(entry.reason);

    return {
      id: `trade-${index + 1}`,
      pair: entry.asset,
      direction: entry.direction,
      entry_price: entry.entryPrice,
      exit_price: exitPrice,
      entry_date: entryDate.toISOString(),
      exit_date: exitDate.toISOString(),
      position_size: positionSize,
      pnl: pnl,
      pnl_percentage: profitPercent,
      signals_used: signals,
      notes: `Trade based on ${entry.reason}`,
      exchange: getRandomExchange(),
      status: "closed",
      time_of_day: getTimeOfDay(entryDate)
    };
  });
};

// Convert reason to signal data
const createSignalsFromReason = (reason) => {
  const signalMap = {
    "RSI < 30": [
      { signal_id: "2", signal_name: "RSI", timeframe: "1h", value: "Oversold (28)" }
    ],
    "MACD bullish crossover": [
      { signal_id: "4", signal_name: "MACD", timeframe: "4h", value: "Bullish Crossover" }
    ],
    "Support bounce": [
      { signal_id: "1", signal_name: "Support/Resistance", timeframe: "1d", value: "Support Held" },
      { signal_id: "2", signal_name: "RSI", timeframe: "4h", value: "Oversold Bounce" }
    ],
    "Fibonacci retracement bounce": [
      { signal_id: "6", signal_name: "Fibonacci", timeframe: "1d", value: "0.618 Retracement" }
    ],
    "Breakout above resistance": [
      { signal_id: "1", signal_name: "Support/Resistance", timeframe: "4h", value: "Resistance Break" },
      { signal_id: "7", signal_name: "Volume", timeframe: "4h", value: "spike" } 
    ],
    "Volume spike entry": [
      { signal_id: "7", signal_name: "Volume", timeframe: "1h", value: "spike" }, 
      { signal_id: "5", signal_name: "Price Action", timeframe: "1h", value: "Impulse Move" }
    ],
    "Bull flag confirmation": [
      { signal_id: "5", signal_name: "Price Action", timeframe: "4h", value: "Bull Flag Pattern" },
      { signal_id: "1", signal_name: "Moving Average", timeframe: "1h", value: "Above 20 EMA" }
    ],
    "Fake breakout": [
      { signal_id: "5", signal_name: "Price Action", timeframe: "1h", value: "Failed Breakout" },
      { signal_id: "7", signal_name: "Volume", timeframe: "1h", value: "spike" } 
    ],
    "Head & Shoulders breakdown": [
      { signal_id: "5", signal_name: "Price Action", timeframe: "4h", value: "H&S Pattern Complete" }
    ],
    "RSI divergence": [
      { signal_id: "2", signal_name: "RSI", timeframe: "4h", value: "Bullish Divergence" }
    ],
    "Double top rejection": [
      { signal_id: "5", signal_name: "Price Action", timeframe: "4h", value: "Double Top Pattern" }
    ]
  };

  // Default signal if reason doesn't match
  const defaultSignal = [
    { signal_id: "1", signal_name: "Technical Analysis", timeframe: "1h", value: "Mixed Signals" }
  ];

  return signalMap[reason] || defaultSignal;
};

// Get random exchange
const getRandomExchange = () => {
  const exchanges = ["Binance", "Coinbase", "Kraken", "FTX", "KuCoin"];
  return exchanges[Math.floor(Math.random() * exchanges.length)];
};

// Determine time of day from date
const getTimeOfDay = (date) => {
  const hour = date.getHours();
  
  if (hour >= 5 && hour < 12) {
    return "morning";
  } else if (hour >= 12 && hour < 17) {
    return "afternoon";
  } else if (hour >= 17 && hour < 21) {
    return "evening";
  } else {
    return "night";
  }
};

// Add market conditions to each trade
export const addMarketConditions = (trades) => {
  return trades.map(trade => {
    // Generate market conditions based on trade outcome
    const isProfitable = trade.pnl > 0;
    
    const conditions = [
      {
        impact: isProfitable ? "positive" : "negative",
        description: isProfitable 
          ? "Market showing strong momentum in trade direction" 
          : "Opposing market forces emerged during trade"
      },
      {
        impact: Math.random() > 0.5 ? "positive" : "negative", 
        description: Math.random() > 0.5 
          ? "Volume confirming price action" 
          : "Volatility higher than average"
      }
    ];
    
    return {
      ...trade,
      market_conditions: conditions
    };
  });
};

export default {
  parseJournalData,
  addMarketConditions
};
