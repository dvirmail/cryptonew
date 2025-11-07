
/**
 * Enhanced Pivot Points calculation with multiple timeframe support
 * and dynamic pivot level detection
 */
export const calculatePivotPoints = (klineData, style = 'traditional', includeWeekly = true, includeDailyLevels = true) => {
  //console.log(`[PIVOT_CALC] Starting calculation: klineData.length=${klineData?.length || 0}, style=${style}, includeWeekly=${includeWeekly}`);
  const pivots = [];
  // Add a null for the first candle which doesn't have a previous period for calculations.
  // This maintains a 1:1 index mapping where pivots[i] corresponds to klineData[i].
  pivots.push(null); 
  
  if (!klineData || klineData.length < 2) {
    console.warn(`[PIVOT_CALC] ⚠️ Insufficient data: klineData.length=${klineData?.length || 0}`);
    return pivots; // This will return [null] for length 0 or 1.
  }
  
  let validCount = 0;
  let nullCount = 0;
  
  for (let i = 1; i < klineData.length; i++) {
    const currentCandle = klineData[i];
    const pivotData = {
      traditional: null,
      fibonacci: null,
      woodie: null,
      camarilla: null,
      weekly: null,
      confluence: null
    };
    
    // Get previous period's H, L, C for calculations
    const prevHigh = klineData[i - 1].high;
    const prevLow = klineData[i - 1].low;
    const prevClose = klineData[i - 1].close;

    if (prevHigh === undefined || prevLow === undefined || prevClose === undefined) { // Check for undefined to cover cases where data might be missing or incomplete
        pivots.push(pivotData); // push empty data to maintain array length alignment
        continue;
    }
    
    // Traditional Pivot Points
    const traditionalPivot = (prevHigh + prevLow + prevClose) / 3;
    pivotData.traditional = {
      pivot: traditionalPivot,
      r1: (2 * traditionalPivot) - prevLow,
      r2: traditionalPivot + (prevHigh - prevLow),
      r3: prevHigh + 2 * (traditionalPivot - prevLow),
      s1: (2 * traditionalPivot) - prevHigh,
      s2: traditionalPivot - (prevHigh - prevLow),
      s3: prevLow - 2 * (prevHigh - traditionalPivot)
    };
    
    // Fibonacci Pivot Points
    const fibPivot = traditionalPivot; // Fibonacci pivots use traditional pivot as base
    const range = prevHigh - prevLow;
    pivotData.fibonacci = {
      pivot: fibPivot,
      r1: fibPivot + (0.382 * range),
      r2: fibPivot + (0.618 * range),
      r3: fibPivot + range,
      s1: fibPivot - (0.382 * range),
      s2: fibPivot - (0.618 * range),
      s3: fibPivot - range
    };
    
    // Woodie Pivot Points
    const woodiePivot = (prevHigh + prevLow + (2 * prevClose)) / 4;
    pivotData.woodie = {
      pivot: woodiePivot,
      r1: (2 * woodiePivot) - prevLow,
      r2: woodiePivot + (prevHigh - prevLow),
      r3: prevHigh + 2 * (woodiePivot - prevLow),
      s1: (2 * woodiePivot) - prevHigh,
      s2: woodiePivot - (prevHigh - prevLow),
      s3: prevLow - 2 * (prevHigh - woodiePivot)
    };
    
    // Camarilla Pivot Points (intraday focused)
    const camarillaPivot = prevClose; // Camarilla uses previous close as its base pivot
    const camarillaRange = prevHigh - prevLow;
    pivotData.camarilla = {
      pivot: camarillaPivot,
      r1: prevClose + (camarillaRange * 1.1 / 12),
      r2: prevClose + (camarillaRange * 1.1 / 6),
      r3: prevClose + (camarillaRange * 1.1 / 4),
      r4: prevClose + (camarillaRange * 1.1 / 2),
      s1: prevClose - (camarillaRange * 1.1 / 12),
      s2: prevClose - (camarillaRange * 1.1 / 6),
      s3: prevClose - (camarillaRange * 1.1 / 4),
      s4: prevClose - (camarillaRange * 1.1 / 2)
    };
    
    // Weekly Pivot Calculation (if enabled and we have enough data)
    // Assumes klineData is daily, so 7 previous candles form a week.
    if (includeWeekly && i >= 7) {
      const weeklyData = klineData.slice(i - 7, i); // Data for the previous 7 candles
      const weeklyHigh = Math.max(...weeklyData.map(candle => candle.high));
      const weeklyLow = Math.min(...weeklyData.map(candle => candle.low));
      const weeklyClose = weeklyData[weeklyData.length - 1].close; // Close of the last candle in the week
      const weeklyPivot = (weeklyHigh + weeklyLow + weeklyClose) / 3;
      
      pivotData.weekly = {
        pivot: weeklyPivot,
        r1: (2 * weeklyPivot) - weeklyLow,
        r2: weeklyPivot + (weeklyHigh - weeklyLow),
        s1: (2 * weeklyPivot) - weeklyHigh,
        s2: weeklyPivot - (weeklyHigh - weeklyLow)
      };
    }
    
    // Confluence Detection - identify where multiple pivot methods agree
    // Pass the calculated pivotData for the current candle (i.e., klineData[i])
    pivotData.confluence = detectPivotConfluence(pivotData, currentCandle.close);
    
    pivots.push(pivotData);
    validCount++;
    
    // Log sample data for index 48 (evaluation index)
    if (i === 48 || i === klineData.length - 1) {
      //console.log(`[PIVOT_CALC] Index ${i}: traditional.pivot=${pivotData.traditional?.pivot?.toFixed(2) || 'null'}, traditional.s1=${pivotData.traditional?.s1?.toFixed(2) || 'null'}, traditional.r1=${pivotData.traditional?.r1?.toFixed(2) || 'null'}`);
    }
  }
  
  // Log summary
  const lastValidIndex = pivots.length - 1;
  //console.log(`[PIVOT_CALC] Calculation complete: total length=${pivots.length}, valid pivots=${validCount}, first null at index=0`);
  if (lastValidIndex >= 48) {
    const sample48 = pivots[48];
    if (sample48) {
      //console.log(`[PIVOT_CALC] Sample[48] structure: hasTraditional=${!!sample48.traditional}, hasFibonacci=${!!sample48.fibonacci}, keys=${Object.keys(sample48).join(', ')}`);
      if (sample48.traditional) {
        //console.log(`[PIVOT_CALC] Sample[48].traditional: pivot=${sample48.traditional.pivot?.toFixed(2) || 'null'}, s1=${sample48.traditional.s1?.toFixed(2) || 'null'}, r1=${sample48.traditional.r1?.toFixed(2) || 'null'}`);
      }
    } else {
      console.warn(`[PIVOT_CALC] ⚠️ Sample[48] is null!`);
    }
  }
  
  return pivots;
};

/**
 * Detects confluence between different pivot point calculations
 * @param {object} pivotData - A single object containing calculated pivots (traditional, fibonacci, etc.) for a specific period.
 * @param {number} currentPrice - The close price of the current candle to calculate proximity.
 * @returns {Array<object>} An array of confluent levels.
 */
const detectPivotConfluence = (pivotData, currentPrice) => {
  const confluenceLevels = [];
  const tolerance = 0.005; // 0.5% tolerance for confluence detection
  
  // Collect all pivot levels
  const allLevels = [];
  
  // Traditional levels
  if (pivotData.traditional) {
    Object.entries(pivotData.traditional).forEach(([key, value]) => {
      allLevels.push({ type: 'traditional', level: key, price: value });
    });
  }
  
  // Fibonacci levels
  if (pivotData.fibonacci) {
    Object.entries(pivotData.fibonacci).forEach(([key, value]) => {
      allLevels.push({ type: 'fibonacci', level: key, price: value });
    });
  }
  
  // Woodie levels
  if (pivotData.woodie) {
    Object.entries(pivotData.woodie).forEach(([key, value]) => {
      allLevels.push({ type: 'woodie', level: key, price: value });
    });
  }

  // Camarilla levels
  if (pivotData.camarilla) {
    Object.entries(pivotData.camarilla).forEach(([key, value]) => {
      allLevels.push({ type: 'camarilla', level: key, price: value });
    });
  }
  
  // Weekly levels
  if (pivotData.weekly) {
    Object.entries(pivotData.weekly).forEach(([key, value]) => {
      allLevels.push({ type: 'weekly', level: key, price: value });
    });
  }
  
  const processedIndices = new Set();
  
  for (let i = 0; i < allLevels.length; i++) {
    if (processedIndices.has(i)) continue;
    
    const currentLevel = allLevels[i];
    const cluster = [currentLevel];
    processedIndices.add(i);
    
    for (let j = i + 1; j < allLevels.length; j++) {
      if (processedIndices.has(j)) continue;
      
      const otherLevel = allLevels[j];
      const priceDiff = Math.abs(currentLevel.price - otherLevel.price);
      // Ensure currentLevel.price is not zero to prevent division by zero or NaN
      const percentDiff = currentLevel.price !== 0 ? priceDiff / currentLevel.price : Infinity;
      
      if (percentDiff <= tolerance) {
        cluster.push(otherLevel);
        processedIndices.add(j);
      }
    }
    
    // If we have confluence (2+ levels close together)
    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((sum, level) => sum + level.price, 0) / cluster.length;
      // Handle currentPrice being zero to prevent division by zero or NaN
      const distanceFromPrice = currentPrice !== 0 ? Math.abs(currentPrice - avgPrice) / currentPrice : Infinity;
      
      confluenceLevels.push({
        price: avgPrice,
        strength: cluster.length,
        types: [...new Set(cluster.map(level => level.type))], // Use Set to get unique types
        levels: cluster.map(level => `${level.type.substring(0,2)}_${level.level}`), // Specific format from outline
        distanceFromPrice: distanceFromPrice,
        isNearby: distanceFromPrice < 0.02 // Within 2% of current price
      });
    }
  }
  
  // Sort by strength (most confluent first)
  confluenceLevels.sort((a, b) => b.strength - a.strength);
  
  return confluenceLevels;
};

export const calculateFibonacci = (data, options = {}) => {
    const { lookback = 100 } = options;
    const results = new Array(data.length).fill(null);
    const fibLevels = [0.0, 23.6, 38.2, 50.0, 61.8, 78.6, 100.0];

    if (data.length < lookback) return results;

    for (let i = lookback; i < data.length; i++) {
        const window = data.slice(i - lookback, i + 1);
        
        let high = -Infinity;
        let low = Infinity;

        for(const candle of window) {
            if (candle.high > high) high = candle.high;
            if (candle.low < low) low = candle.low;
        }

        if (high === -Infinity || low === Infinity || high === low) {
            results[i] = i > 0 ? results[i-1] : null; 
            continue;
        }
        
        const range = high - low;
        const levels = {};
        
        const windowStartClose = data[i - lookback].close;
        const windowEndClose = data[i].close;
        
        const isOverallUptrend = windowEndClose > windowStartClose;

        fibLevels.forEach(level => {
            let price;
            if (isOverallUptrend) {
                price = high - (range * (level / 100));
            } else {
                price = low + (range * (level / 100));
            }
            levels[level.toFixed(1)] = price;
        });

        results[i] = {
            high,
            low,
            levels
        };
    }
    return results;
};

/**
 * Enhanced Fibonacci Retracements with automatic swing detection
 * and dynamic level analysis
 */
export const calculateFibonacciRetracements = (klineData, lookbackPeriod = 100, minSwingPercent = 1.5, onLog = null) => {
  const fibonacciData = [];
  
  if (!klineData || klineData.length < lookbackPeriod) {
    const msg = `[FIB_CALC] Insufficient data: klineData.length=${klineData?.length || 0}, lookbackPeriod=${lookbackPeriod}`;
    if (onLog) onLog(msg, 'warn');
    else console.warn(msg);
    return new Array(klineData?.length || 0).fill(null);
  }
  
  //console.log(`[FIB_CALC] Starting calculation: klineData.length=${klineData.length}, lookbackPeriod=${lookbackPeriod}, minSwingPercent=${minSwingPercent}`);
  
  // CRITICAL FIX: Build array with proper index mapping
  // We need to populate indices starting from lookbackPeriod - 2 to ensure evaluation index (typically length - 2) has data
  // For a 50-candle array with lookback=50, evaluation is at index 48, so we need to populate from index 48
  // Initialize array to match klineData length
  for (let i = 0; i < klineData.length; i++) {
    fibonacciData.push(null);
  }
  
  // Start from lookbackPeriod - 2 to ensure evaluation index (typically length - 2) has data
  // For a 50-candle array with lookback=50, evaluation is at index 48, so we start at index 48
  const startIndex = Math.max(0, lookbackPeriod - 2);
  //console.log(`[FIB_CALC] Populating indices from ${startIndex} to ${klineData.length - 1}`);
  
  for (let i = startIndex; i < klineData.length; i++) {
    const currentCandle = klineData[i];
    // Ensure we have enough data for lookback (may need to adjust window start)
    const windowStart = Math.max(0, i - lookbackPeriod + 1); // +1 to include current candle
    const lookbackData = klineData.slice(windowStart, i + 1);
    
    if (i === 48 || (i >= 46 && i <= 50)) {
      //console.log(`[FIB_CALC] Index ${i}: windowStart=${windowStart}, lookbackData.length=${lookbackData.length}, required=${lookbackPeriod}`);
    }
    
    // Need at least lookbackPeriod - 1 candles (relaxed from lookbackPeriod to allow index 48)
    // For index 48 with lookback=50, we'll have 49 candles which should be enough for swing detection
    if (lookbackData.length < (lookbackPeriod - 1)) {
      // Not enough data - leave as null
      if (i === 48) {
        console.warn(`[FIB_CALC] ⚠️ Index 48: Insufficient data: lookbackData.length=${lookbackData.length}, required=${lookbackPeriod - 1}`);
      }
      continue;
    }
    
    // Detect significant swings in the lookback period
    const swings = detectSignificantSwings(lookbackData, minSwingPercent, onLog);
    
    // Reduced verbosity: Only log when swings ARE found (success case)
    if ((i === 48 || (i >= 46 && i <= 50)) && swings.length > 0) {
      //console.log(`[FIB_CALC] Index ${i}: Detected ${swings.length} swings, latest: ${swings[swings.length - 1].type} (low=${swings[swings.length - 1].low?.price?.toFixed(2)}, high=${swings[swings.length - 1].high?.price?.toFixed(2)})`);
    }
    
    // Continue to fallback logic even if swings.length === 0
    
    // Use the most recent significant swing, or fall back to incomplete swing if no complete swings
    let latestSwing = swings.length > 0 ? swings[swings.length - 1] : null;
    
    // If no complete swings detected, try to use the incomplete swing state
    if (!latestSwing && lookbackData.length >= 20) {
      // Re-detect swings with a more lenient approach for fallback
      const fallbackSwings = detectSignificantSwings(lookbackData, Math.max(1.0, minSwingPercent * 0.5), onLog); // Use 50% of threshold
      
      if (fallbackSwings.length > 0) {
        latestSwing = fallbackSwings[fallbackSwings.length - 1];
        if (i === 48) {
          const msg = `[FIB_CALC] Index ${i}: Using fallback swing (lenient threshold): ${latestSwing.type}, move=${latestSwing.percentMove.toFixed(2)}%`;
          if (onLog) onLog(msg, 'debug');
        }
      } else {
        // Last resort: find the highest high and lowest low in the lookback period
        let minLow = Infinity;
        let maxHigh = -Infinity;
        let minLowIndex = -1;
        let maxHighIndex = -1;
        
        for (let j = 0; j < lookbackData.length; j++) {
          if (lookbackData[j].low < minLow) {
            minLow = lookbackData[j].low;
            minLowIndex = j;
          }
          if (lookbackData[j].high > maxHigh) {
            maxHigh = lookbackData[j].high;
            maxHighIndex = j;
          }
        }
        
        if (minLowIndex !== -1 && maxHighIndex !== -1 && minLow < maxHigh) {
          const range = maxHigh - minLow;
          const percentMove = (range / minLow) * 100;
          
          // Use this as a fallback swing if move is at least 1%
          if (percentMove >= 1.0) {
            // Determine if it's an upswing (low before high) or downswing (high before low)
            if (minLowIndex < maxHighIndex) {
              latestSwing = {
                type: 'upswing',
                low: { index: minLowIndex, price: minLow, candle: lookbackData[minLowIndex] },
                high: { index: maxHighIndex, price: maxHigh, candle: lookbackData[maxHighIndex] },
                percentMove: percentMove,
                duration: maxHighIndex - minLowIndex
              };
            } else {
              latestSwing = {
                type: 'downswing',
                high: { index: maxHighIndex, price: maxHigh, candle: lookbackData[maxHighIndex] },
                low: { index: minLowIndex, price: minLow, candle: lookbackData[minLowIndex] },
                percentMove: percentMove,
                duration: minLowIndex - maxHighIndex
              };
            }
            
            if (i === 48) {
              //console.log(`[FIB_CALC] Index ${i}: Using extreme points fallback: ${latestSwing.type}, move=${latestSwing.percentMove.toFixed(2)}%, low=${minLow.toFixed(2)}@${minLowIndex}, high=${maxHigh.toFixed(2)}@${maxHighIndex}`);
            }
          }
        }
      }
    }
    
    // If still no swing, skip this index (expected in very low volatility)
    if (!latestSwing) {
      // Removed warning - expected behavior in low volatility, system handles gracefully
      continue;
    }
    
    const swingData = {
      swing: latestSwing,
      levels: null,
      interactions: [],
      confluence: []
    };
    
    // Calculate Fibonacci levels for the swing
    if (latestSwing.type === 'upswing') {
      // Bullish retracement (from swing low to swing high)
      const swingLow = latestSwing.low.price;
      const swingHigh = latestSwing.high.price;
      const range = swingHigh - swingLow;
      
      swingData.levels = {
        type: 'bullish_retracement',
        swingLow: swingLow,
        swingHigh: swingHigh,
        range: range,
        // Standard keys for evaluation
        '0': swingHigh, // 0% (swing high)
        '236': swingHigh - (range * 0.236),
        '382': swingHigh - (range * 0.382),
        '500': swingHigh - (range * 0.500),
        '618': swingHigh - (range * 0.618),
        '786': swingHigh - (range * 0.786),
        '1000': swingLow, // 100% (swing low)
        // Legacy keys for compatibility
        fib_0: swingHigh,
        fib_236: swingHigh - (range * 0.236),
        fib_382: swingHigh - (range * 0.382),
        fib_500: swingHigh - (range * 0.500),
        fib_618: swingHigh - (range * 0.618),
        fib_786: swingHigh - (range * 0.786),
        fib_100: swingLow,
        // Extension levels
        fib_1272: swingHigh + (range * 0.272),
        fib_1618: swingHigh + (range * 0.618),
        fib_2618: swingHigh + (range * 1.618)
      };
    } else {
      // Bearish retracement (from swing high to swing low)
      const swingHigh = latestSwing.high.price;
      const swingLow = latestSwing.low.price;
      const range = swingHigh - swingLow;
      
      swingData.levels = {
        type: 'bearish_retracement',
        swingHigh: swingHigh,
        swingLow: swingLow,
        range: range,
        // Standard keys for evaluation
        '0': swingLow, // 0% (swing low)
        '236': swingLow + (range * 0.236),
        '382': swingLow + (range * 0.382),
        '500': swingLow + (range * 0.500),
        '618': swingLow + (range * 0.618),
        '786': swingLow + (range * 0.786),
        '1000': swingHigh, // 100% (swing high)
        // Legacy keys for compatibility
        fib_0: swingLow,
        fib_236: swingLow + (range * 0.236),
        fib_382: swingLow + (range * 0.382),
        fib_500: swingLow + (range * 0.500),
        fib_618: swingLow + (range * 0.618),
        fib_786: swingLow + (range * 0.786),
        fib_100: swingHigh,
        // Extension levels
        fib_1272: swingLow - (range * 0.272),
        fib_1618: swingLow - (range * 0.618),
        fib_2618: swingLow - (range * 1.618)
      };
    }
    
    // Analyze current price interaction with Fibonacci levels
    swingData.interactions = analyzeFibonacciInteractions(currentCandle, swingData.levels, i);
    
    // Detect confluence with other technical levels
    swingData.confluence = detectFibonacciConfluence(swingData.levels, currentCandle.close);
    
    // CRITICAL: Set at correct index in array (not push!)
    fibonacciData[i] = swingData;
    
    if (i === 48) {
      //console.log(`[FIB_CALC] ✅ Index 48 populated: levels=${swingData.levels ? Object.keys(swingData.levels).filter(k => ['0', '236', '382', '500', '618', '786', '1000'].includes(k) || k.startsWith('fib_')).join(', ') : 'none'}`);
      if (swingData.levels) {
        //console.log(`[FIB_CALC] Index 48 sample levels: 236=${swingData.levels['236']}, 618=${swingData.levels['618']}, 1000=${swingData.levels['1000']}`);
      }
    }
  }
  
  
  return fibonacciData;
};

/**
 * Detects significant price swings for Fibonacci analysis
 * IMPROVED: More robust pairing logic that handles cases where peaks/troughs exist but aren't properly sequenced
 */
const detectSignificantSwings = (candleData, minSwingPercent, onLog = null) => {
  const swings = [];
  
  if (candleData.length < 10) {
    return swings;
  }
  
  let currentTrend = null;
  let swingStart = null;
  let extremePoint = null;
  let peakCount = 0;
  let troughCount = 0;
  
  for (let i = 1; i < candleData.length - 1; i++) {
    const current = candleData[i];
    const prev = candleData[i - 1];
    const next = candleData[i + 1];
    
    // Detect potential swing highs (peak)
    if (current.high > prev.high && current.high > next.high) {
      peakCount++;
      // If we are currently tracking a potential swing low as swingStart, and we found a new high,
      // it means a potential upswing might have formed.
      if (swingStart && swingStart.type === 'low') {
        const potentialHigh = { index: i, price: current.high, type: 'high', candle: current };
        const swingPercent = ((potentialHigh.price - swingStart.price) / swingStart.price) * 100;
        
        if (swingPercent >= minSwingPercent) {
          swings.push({
            type: 'upswing',
            low: swingStart,
            high: potentialHigh,
            percentMove: swingPercent,
            duration: potentialHigh.index - swingStart.index
          });
          // After detecting an upswing, the new swingStart becomes the current high
          // and we reset extremePoint to null as we are looking for a new low now.
          swingStart = potentialHigh;
          extremePoint = null; 
          currentTrend = 'up';
        } else {
            // If not significant, update current high if it's higher
            if (!extremePoint || current.high > extremePoint.price) {
                extremePoint = { index: i, price: current.high, type: 'high', candle: current };
            }
        }
      } else {
        // No swingStart (low) yet, or we're already tracking a high. Just update the extremePoint.
        if (!extremePoint || current.high > extremePoint.price) {
            extremePoint = { index: i, price: current.high, type: 'high', candle: current };
        }
      }
    }
    
    // Detect potential swing lows (trough)
    if (current.low < prev.low && current.low < next.low) {
      troughCount++;
      // If we are currently tracking a potential swing high as extremePoint, and we found a new low,
      // it means a potential downswing might have formed.
      if (extremePoint && extremePoint.type === 'high') {
        const potentialLow = { index: i, price: current.low, type: 'low', candle: current };
        const swingPercent = ((extremePoint.price - potentialLow.price) / extremePoint.price) * 100;
        
        if (swingPercent >= minSwingPercent) {
          swings.push({
            type: 'downswing',
            high: extremePoint,
            low: potentialLow,
            percentMove: swingPercent,
            duration: potentialLow.index - extremePoint.index
          });
          // After detecting a downswing, the new extremePoint becomes the current low
          // and we reset swingStart to null as we are looking for a new high now.
          extremePoint = potentialLow;
          swingStart = null;
          currentTrend = 'down';
        } else {
            // If not significant, update current low if it's lower
            if (!swingStart || current.low < swingStart.price) {
                swingStart = { index: i, price: current.low, type: 'low', candle: current };
            }
        }
      } else {
        // No extremePoint (high) yet, or we're already tracking a low. Just update the swingStart.
        if (!swingStart || current.low < swingStart.price) {
            swingStart = { index: i, price: current.low, type: 'low', candle: current };
        }
      }
    }
  }
  
  // IMPROVED: Alternative pairing approach - collect all peaks and troughs, then pair them sequentially
  // This helps when the state machine doesn't capture swings due to sequencing issues
  if (swings.length === 0 && peakCount > 0 && troughCount > 0) {
    // Collect all peaks and troughs
    const allPeaks = [];
    const allTroughs = [];
    
    for (let i = 1; i < candleData.length - 1; i++) {
      const current = candleData[i];
      const prev = candleData[i - 1];
      const next = candleData[i + 1];
      
      if (current.high > prev.high && current.high > next.high) {
        allPeaks.push({ index: i, price: current.high });
      }
      if (current.low < prev.low && current.low < next.low) {
        allTroughs.push({ index: i, price: current.low });
      }
    }
    
    // Try to pair peaks and troughs sequentially
    let lastPoint = null;
    const allPoints = [...allPeaks.map(p => ({...p, type: 'peak'})), ...allTroughs.map(t => ({...t, type: 'trough'}))]
      .sort((a, b) => a.index - b.index);
    
    for (let i = 1; i < allPoints.length; i++) {
      const prev = allPoints[i - 1];
      const curr = allPoints[i];
      
      // Only pair opposite types (peak->trough or trough->peak)
      if (prev.type !== curr.type) {
        const percentMove = prev.type === 'peak' 
          ? ((prev.price - curr.price) / prev.price) * 100  // Downswing
          : ((curr.price - prev.price) / prev.price) * 100; // Upswing
        
        if (Math.abs(percentMove) >= minSwingPercent) {
          swings.push({
            type: prev.type === 'peak' ? 'downswing' : 'upswing',
            high: prev.type === 'peak' ? prev : curr,
            low: prev.type === 'peak' ? curr : prev,
            percentMove: Math.abs(percentMove),
            duration: Math.abs(curr.index - prev.index)
          });
        }
      }
    }
  }
  
  
  return swings;
};

/**
 * Analyzes price interactions with Fibonacci levels
 */
const analyzeFibonacciInteractions = (candle, fibLevels, index) => {
  const interactions = [];
  
  if (!fibLevels || !candle) return interactions;
  
  const tolerance = 0.002; // 0.2% tolerance for level interactions
  
  // Key Fibonacci levels to check
  const keyLevels = [
    { name: '23.6%', price: fibLevels.fib_236, importance: 60 },
    { name: '38.2%', price: fibLevels.fib_382, importance: 75 },
    { name: '50%', price: fibLevels.fib_500, importance: 70 },
    { name: '61.8%', price: fibLevels.fib_618, importance: 85 }, // Golden ratio - most important
    { name: '78.6%', price: fibLevels.fib_786, importance: 65 },
    { name: '127.2%', price: fibLevels.fib_1272, importance: 70 },
    { name: '161.8%', price: fibLevels.fib_1618, importance: 80 }
  ];
  
  keyLevels.forEach(level => {
    if (typeof level.price !== 'number' || isNaN(level.price)) return;
    
    // Check if any part of the candle's range touches or crosses the level within tolerance
    const candleHigh = candle.high;
    const candleLow = candle.low;
    const levelPrice = level.price;

    const levelTolerance = levelPrice * tolerance;

    // Check for interaction: Candle's range overlaps with level +/- tolerance
    const hasInteraction = (candleHigh >= levelPrice - levelTolerance && candleLow <= levelPrice + levelTolerance);

    if (hasInteraction) {
      // Determine interaction type based on price action
      let interactionType = 'touch';
      let direction = 'neutral';
      let strength = level.importance;
      
      // Enhanced interaction detection
      if (candle.low <= levelPrice && candle.close > levelPrice + levelTolerance) {
        interactionType = 'bounce'; // Price went below or touched and closed strongly above
        direction = 'bullish';
        strength += 10;
      } else if (candle.high >= levelPrice && candle.close < levelPrice - levelTolerance) {
        interactionType = 'rejection'; // Price went above or touched and closed strongly below
        direction = 'bearish';
        strength += 10;
      } else if (candle.open < levelPrice && candle.close > levelPrice + levelTolerance) {
        interactionType = 'breakout'; // Opened below, closed strongly above
        direction = 'bullish';
        strength += 15;
      } else if (candle.open > levelPrice && candle.close < levelPrice - levelTolerance) {
        interactionType = 'breakdown'; // Opened above, closed strongly below
        direction = 'bearish';
        strength += 15;
      }
      
      interactions.push({
        level: level.name,
        price: level.price,
        type: interactionType,
        direction: direction,
        strength: Math.min(strength, 100),
        details: `Price ${interactionType} at Fibonacci ${level.name} level (${level.price.toFixed(2)})`
      });
    }
  });
  
  return interactions;
};

/**
 * Detects confluence between Fibonacci levels and other technical levels
 */
const detectFibonacciConfluence = (fibLevels, currentPrice) => {
  const confluenceLevels = [];
  const tolerance = 0.003; // 0.3% tolerance for confluence detection
  
  if (!fibLevels) return confluenceLevels;
  
  const fibPrices = [
    { level: '23.6%', price: fibLevels.fib_236 },
    { level: '38.2%', price: fibLevels.fib_382 },
    { level: '50%', price: fibLevels.fib_500 },
    { level: '61.8%', price: fibLevels.fib_618 },
    { level: '78.6%', price: fibLevels.fib_786 }
  ];
  
  // Check for confluences (this is a simplified version - could be enhanced with other indicators)
  fibPrices.forEach(fib => {
    if (typeof fib.price !== 'number' || isNaN(fib.price) || fib.price === 0) return;
    
    const proximity = Math.abs(currentPrice - fib.price) / fib.price;
    
    if (proximity <= tolerance) {
      confluenceLevels.push({
        fibLevel: fib.level,
        price: fib.price,
        proximity: proximity,
        strength: 75 + (fib.level === '61.8%' ? 15 : 0), // Bonus for golden ratio
        confluenceWith: ['price_action'] // Could be expanded with other indicators
      });
    }
  });
  
  return confluenceLevels;
};


/**
 * Advanced Support & Resistance Detection with multiple algorithms
 * Volume-weighted levels, touch counting, and dynamic strength assessment
 */
export function calculateSupportResistance(klineData, lookback = 50, tolerance = 0.005, onLog = null) {
    const logMsg = (msg, level = 'debug') => {
        if (onLog) onLog(msg, level);
        else (level === 'warn' ? console.warn : console.log)(msg);
    };
    
    if (!klineData || klineData.length < lookback) {
        // Return array padded with nulls to match klineData length
        logMsg(`[SR_CALC] Insufficient data: klineData.length=${klineData?.length || 0}, lookback=${lookback}`, 'warn');
        return new Array(klineData?.length || 0).fill(null);
    }
    
    //console.log(`[SR_CALC] Starting calculation: klineData.length=${klineData.length}, lookback=${lookback}, tolerance=${tolerance}`);
    
    // Build per-index structure: array where each element corresponds to a candle
    const result = new Array(klineData.length).fill(null);
    
    // Collect all pivot levels as we scan
    const allSupportLevels = [];
    const allResistanceLevels = [];
    
    // IMPROVED: Relaxed pivot point detection (from 2 candles to 1 candle on each side)
    // This is less strict and will detect more swing points, especially useful for shorter timeframes
    for (let i = 1; i < klineData.length - 1; i++) {
        // High pivot: candle must be higher than the previous AND next candle
        const isHighPivot = klineData[i].high > klineData[i - 1].high &&
                            klineData[i].high > klineData[i + 1].high;

        // Low pivot: candle must be lower than the previous AND next candle
        const isLowPivot = klineData[i].low < klineData[i - 1].low &&
                           klineData[i].low < klineData[i + 1].low;

        if (isHighPivot) {
            allResistanceLevels.push({ level: klineData[i].high, index: i });
        }
        if (isLowPivot) {
            allSupportLevels.push({ level: klineData[i].low, index: i });
        }
    }
    
    
    // Simple clustering to merge close levels
    const mergedSupport = [];
    if (allSupportLevels.length > 0) {
        allSupportLevels.sort((a, b) => a.level - b.level);
        let currentLevel = allSupportLevels[0];
        for (let i = 1; i < allSupportLevels.length; i++) {
            if (Math.abs(allSupportLevels[i].level - currentLevel.level) / currentLevel.level < tolerance) {
                // merge logic can be improved, for now we just take the first one in a cluster
            } else {
                mergedSupport.push(currentLevel.level);
                currentLevel = allSupportLevels[i];
            }
        }
        mergedSupport.push(currentLevel.level);
    }
    
    const mergedResistance = [];
    if (allResistanceLevels.length > 0) {
        allResistanceLevels.sort((a, b) => a.level - b.level);
        let currentLevel = allResistanceLevels[0];
        for (let i = 1; i < allResistanceLevels.length; i++) {
            if (Math.abs(allResistanceLevels[i].level - currentLevel.level) / currentLevel.level < tolerance) {
                // merge logic can be improved, for now we just take the first one in a cluster
            } else {
                mergedResistance.push(currentLevel.level);
                currentLevel = allResistanceLevels[i];
            }
        }
        mergedResistance.push(currentLevel.level);
    }
    
    // For each candle, include all levels found up to that point (within lookback window)
    // IMPROVED: Start populating from index 1 (after pivot detection can start) instead of wait until lookback
    // This ensures early candles still get levels from available pivots
    let firstValidIndex = -1;
    let lastValidData = null;
    
    // Start from index 1 (first candle after we can detect pivots)
    // Populate all indices from 1 onwards with available levels in their lookback window
    const startIndex = 1;
    
    //console.log(`[SR_CALC] Populating indices from ${startIndex} to ${klineData.length - 1}, lookback=${lookback}, klineLength=${klineData.length}`);
    
    for (let i = startIndex; i < klineData.length; i++) {
        // Calculate window start: look back up to 'lookback' candles, but start from 0
        const windowStart = Math.max(0, i - lookback + 1);
        const windowEnd = i;
        
        // Get levels that are relevant for this candle (within lookback window)
        // IMPROVED: Include all merged levels, but filter by whether their pivot index is in window
        const currentPrice = klineData[i].close;
        
        // Collect ALL relevant levels (both support and resistance pivots) within the lookback window
        const allRelevantLevels = [];
        
        // Add support pivots (low pivots)
        mergedSupport.forEach(level => {
            const levelObj = allSupportLevels.find(l => Math.abs(l.level - level) < 0.0001);
            if (levelObj === undefined) return;
            const inWindow = i < lookback 
                ? (levelObj.index >= 0 && levelObj.index <= windowEnd)
                : (levelObj.index >= windowStart && levelObj.index <= windowEnd);
            if (inWindow) {
                allRelevantLevels.push({ level, index: levelObj.index, originalType: 'support' });
            }
        });
        
        // Add resistance pivots (high pivots)
        mergedResistance.forEach(level => {
            const levelObj = allResistanceLevels.find(l => Math.abs(l.level - level) < 0.0001);
            if (levelObj === undefined) return;
            const inWindow = i < lookback
                ? (levelObj.index >= 0 && levelObj.index <= windowEnd)
                : (levelObj.index >= windowStart && levelObj.index <= windowEnd);
            if (inWindow) {
                allRelevantLevels.push({ level, index: levelObj.index, originalType: 'resistance' });
            }
        });
        
        // CRITICAL FIX: Classify levels dynamically based on current price position
        // Support = level BELOW current price, Resistance = level ABOVE current price
        const relevantSupport = [];
        const relevantResistance = [];
        
        for (const levelInfo of allRelevantLevels) {
            if (levelInfo.level < currentPrice) {
                // Level is below price → it's support
                relevantSupport.push(levelInfo.level);
            } else if (levelInfo.level > currentPrice) {
                // Level is above price → it's resistance
                relevantResistance.push(levelInfo.level);
            }
            // If level equals price (rare), skip it to avoid ambiguity
        }
        
        // Remove duplicates (in case same level appeared as both support and resistance pivot)
        const uniqueSupport = [...new Set(relevantSupport)];
        const uniqueResistance = [...new Set(relevantResistance)];
        
        // Always set result[i] to an object (even if arrays are empty) for consistent structure
        // This ensures we have a valid object structure even if no levels are found
        result[i] = {
            support: uniqueSupport,
            resistance: uniqueResistance
        };
        
        if (firstValidIndex === -1 && (uniqueSupport.length > 0 || uniqueResistance.length > 0)) {
            firstValidIndex = i;
        }
        if (uniqueSupport.length > 0 || uniqueResistance.length > 0) {
            lastValidData = result[i];
        }
    }
    
    // DIAGNOSTIC: Log summary for debugging
    const validCount = result.filter(r => r !== null && typeof r === 'object').length;
    const supportCount = mergedSupport.length;
    const resistanceCount = mergedResistance.length;
    
    // Count how many candles have actual levels (not empty arrays)
    let candlesWithSupport = 0;
    let candlesWithResistance = 0;
    let candlesWithBoth = 0;
    for (let i = startIndex; i < result.length; i++) {
        if (result[i] && result[i].support && result[i].support.length > 0) candlesWithSupport++;
        if (result[i] && result[i].resistance && result[i].resistance.length > 0) candlesWithResistance++;
        if (result[i] && result[i].support?.length > 0 && result[i].resistance?.length > 0) candlesWithBoth++;
    }
    
    logMsg(`[SR_CALC] 📊 Calculation Summary:`, 'debug');
    logMsg(`[SR_CALC]   - Raw pivots detected: ${allSupportLevels.length} support, ${allResistanceLevels.length} resistance`, 'debug');
    logMsg(`[SR_CALC]   - After clustering: ${supportCount} support levels, ${resistanceCount} resistance levels`, 'debug');
    logMsg(`[SR_CALC]   - Candles with support: ${candlesWithSupport}/${validCount} (${((candlesWithSupport/validCount)*100).toFixed(1)}%)`, 'debug');
    logMsg(`[SR_CALC]   - Candles with resistance: ${candlesWithResistance}/${validCount} (${((candlesWithResistance/validCount)*100).toFixed(1)}%)`, 'debug');
    logMsg(`[SR_CALC]   - Candles with both: ${candlesWithBoth}/${validCount} (${((candlesWithBoth/validCount)*100).toFixed(1)}%)`, 'debug');
    
    if (firstValidIndex >= 0 && firstValidIndex < 5) {
        logMsg(`[SR_CALC] Sample result[${firstValidIndex}]: support=${result[firstValidIndex].support.length}, resistance=${result[firstValidIndex].resistance.length}`, 'debug');
    }
    if (result.length >= 48 && result[48]) {
        logMsg(`[SR_CALC] Sample result[48]: support=${result[48].support.length}, resistance=${result[48].resistance.length}`, 'debug');
    } else if (result.length >= 48) {
        logMsg(`[SR_CALC] ⚠️ result[48] is null! Array length=${result.length}, lookback=${lookback}, firstValidIndex=${firstValidIndex}`, 'warn');
    }
    
    return result;
}

/**
 * Detects fractal-based support and resistance levels
 */
const detectFractalLevels = (candleData, fractalPeriod = 5) => {
  const levels = [];
  const halfPeriod = Math.floor(fractalPeriod / 2);
  
  for (let i = halfPeriod; i < candleData.length - halfPeriod; i++) {
    const current = candleData[i];
    
    // Check for fractal high (resistance)
    let isHigh = true;
    for (let j = i - halfPeriod; j <= i + halfPeriod; j++) {
      if (j !== i && candleData[j].high >= current.high) {
        isHigh = false;
        break;
      }
    }
    
    if (isHigh) {
      levels.push({
        price: current.high,
        type: 'resistance',
        index: i,
        touches: 1,
        lastTouch: i,
        baseStrength: 60
      });
    }
    
    // Check for fractal low (support)
    let isLow = true;
    for (let j = i - halfPeriod; j <= i + halfPeriod; j++) {
      if (j !== i && candleData[j].low <= current.low) {
        isLow = false;
        break;
      }
    }
    
    if (isLow) {
      levels.push({
        price: current.low,
        type: 'support',
        index: i,
        touches: 1,
        lastTouch: i,
        baseStrength: 60
      });
    }
  }
  
  return levels;
};

/**
 * Detects volume-weighted significant price levels
 */
const detectVolumeWeightedLevels = (candleData, volumeData) => {
  const levels = [];
  const volumeThreshold = calculateVolumePercentile(volumeData, 80); // Top 20% volume
  
  for (let i = 0; i < candleData.length; i++) {
    if (volumeData[i] >= volumeThreshold) {
      const candle = candleData[i];
      
      // High volume resistance level
      levels.push({
        price: candle.high,
        type: 'resistance',
        index: i,
        touches: 1,
        lastTouch: i,
        baseStrength: 70,
        volume: volumeData[i]
      });
      
      // High volume support level
      levels.push({
        price: candle.low,
        type: 'support',
        index: i,
        touches: 1,
        lastTouch: i,
        baseStrength: 70,
        volume: volumeData[i]
      });
    }
  }
  
  return levels;
};

/**
 * Detects psychological round number levels
 */
const detectRoundNumberLevels = (currentPrice) => {
  const levels = [];
  const roundNumbers = [100, 500, 1000, 5000, 10000, 50000, 100000];
  
  roundNumbers.forEach(base => {
    const multipliers = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    
    multipliers.forEach(mult => {
      const level = base * mult;
      const distance = Math.abs(currentPrice - level) / currentPrice;
      
      // Only include levels within reasonable distance (5%)
      if (distance <= 0.05) {
        levels.push({
          price: level,
          type: level > currentPrice ? 'resistance' : 'support',
          index: -1, // Special marker for round numbers
          touches: 1,
          lastTouch: -1,
          baseStrength: 50
        });
      }
    });
  });
  
  return levels;
};

/**
 * Detects previous session high/low levels
 */
const detectSessionLevels = (candleData) => {
  const levels = [];
  
  if (candleData.length < 24) return levels; // Need at least 24 periods
  
  // Daily highs and lows (assuming hourly data)
  const dailyPeriods = Math.floor(candleData.length / 24);
  
  for (let day = 0; day < dailyPeriods; day++) {
    const dayStart = day * 24;
    const dayEnd = Math.min(dayStart + 24, candleData.length);
    const dayData = candleData.slice(dayStart, dayEnd);
    
    if (dayData.length === 0) continue;
    
    const dayHigh = Math.max(...dayData.map(c => c.high));
    const dayLow = Math.min(...dayData.map(c => c.low));
    
    levels.push({
      price: dayHigh,
      type: 'resistance',
      index: dayStart,
      touches: 1,
      lastTouch: dayStart,
      baseStrength: 65
    });
    
    levels.push({
      price: dayLow,
      type: 'support',
      index: dayStart,
      touches: 1,
      lastTouch: dayStart,
      baseStrength: 65
    });
  }
  
  return levels;
};

/**
 * Clusters similar price levels together
 */
const clusterSimilarLevels = (levels, threshold) => {
  if (levels.length === 0) return [];
  
  const clustered = [];
  const processed = new Set();
  
  levels.forEach((level, index) => {
    if (processed.has(index)) return;
    
    const cluster = [level];
    const levelPrice = level.price;
    
    // Find similar levels
    for (let i = index + 1; i < levels.length; i++) {
      if (processed.has(i)) continue;
      
      const otherLevel = levels[i];
      const priceDiff = Math.abs(levelPrice - otherLevel.price) / levelPrice * 100;
      
      if (priceDiff <= threshold) {
        cluster.push(otherLevel);
        processed.add(i);
      }
    }
    
    // Create averaged cluster level
    const avgPrice = cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length;
    const totalTouches = cluster.reduce((sum, l) => sum + l.touches, 0);
    const avgStrength = cluster.reduce((sum, l) => sum + l.baseStrength, 0) / cluster.length;
    const methods = [...new Set(cluster.map(l => l.method))];
    
    clustered.push({
      price: avgPrice,
      type: cluster[0].type,
      touches: totalTouches,
      baseStrength: avgStrength + (cluster.length * 5), // Bonus for confluence
      methods: methods,
      clusterSize: cluster.length
    });
    
    processed.add(index);
  });
  
  return clustered;
};

/**
 * Calculates dynamic strength for support/resistance levels
 */
const calculateLevelStrength = (level, candleData, currentCandle, currentIndex) => {
  let strength = level.baseStrength;
  let touches = level.touches;
  
  // Count additional touches in the data
  const priceThreshold = level.price * 0.002; // 0.2% threshold
  
  candleData.forEach((candle, index) => {
    const touchedHigh = Math.abs(candle.high - level.price) <= priceThreshold;
    const touchedLow = Math.abs(candle.low - level.price) <= priceThreshold;
    
    if (touchedHigh || touchedLow) {
      touches++;
      level.lastTouch = currentIndex - (candleData.length - 1 - index);
    }
  });
  
  // Strength bonuses
  strength += Math.min(touches * 10, 40); // Up to +40 for multiple touches
  strength += level.clusterSize ? (level.clusterSize - 1) * 8 : 0; // Confluence bonus
  
  // Age penalty (older levels are weaker)
  const age = currentIndex - (level.lastTouch || 0);
  strength -= Math.min(age * 0.1, 20);
  
  // Round number bonus
  if (level.methods && level.methods.includes('round_number')) {
    strength += 15;
  }
  
  // Volume bonus
  if (level.volume) {
    strength += 10;
  }
  
  return {
    ...level,
    touches: touches,
    strength: Math.max(Math.min(strength, 100), 30) // Cap between 30-100
  };
};

/**
 * Analyzes current price interactions with S&R levels
 */
const analyzeSRInteractions = (candle, levels, currentIndex) => {
  const interactions = [];
  const priceThreshold = candle.close * 0.003; // 0.3% threshold
  
  levels.forEach(level => {
    const distance = Math.abs(candle.close - level.price);
    
    if (distance <= priceThreshold) {
      // Direct interaction
      let interactionType = 'touch';
      let direction = 'neutral';
      
      if (level.type === 'resistance' && candle.close < level.price) {
        interactionType = 'rejection';
        direction = 'bearish';
      } else if (level.type === 'support' && candle.close > level.price) {
        interactionType = 'bounce';
        direction = 'bullish';
      } else if (distance <= priceThreshold * 0.5) {
        interactionType = 'breakout_attempt';
        direction = level.type === 'resistance' ? 'bullish' : 'bearish';
      }
      
      interactions.push({
        type: interactionType,
        direction: direction,
        level: level.type,
        price: level.price,
        strength: level.strength,
        distance: distance,
        details: `Price ${interactionType} at ${level.type} level ${level.price.toFixed(2)}`
      });
    }
  });
  
  return interactions;
};

/**
 * Detects confluence between S&R levels
 */
const detectSRConfluence = (levels, currentPrice) => {
  const confluenceZones = [];
  const priceThreshold = currentPrice * 0.005; // 0.5% threshold for confluence
  
  for (let i = 0; i < levels.length; i++) {
    const level1 = levels[i];
    const nearbyLevels = [level1];
    
    for (let j = i + 1; j < levels.length; j++) {
      const level2 = levels[j];
      
      if (Math.abs(level1.price - level2.price) <= priceThreshold) {
        nearbyLevels.push(level2);
      }
    }
    
    if (nearbyLevels.length >= 2) {
      const avgPrice = nearbyLevels.reduce((sum, l) => sum + l.price, 0) / nearbyLevels.length;
      const totalStrength = nearbyLevels.reduce((sum, l) => sum + l.strength, 0);
      
      confluenceZones.push({
        price: avgPrice,
        levels: nearbyLevels,
        strength: totalStrength,
        confluence: true
      });
    }
  }
  
  return confluenceZones;
};

/**
 * Helper function to calculate volume percentile
 */
const calculateVolumePercentile = (volumeData, percentile) => {
  const sorted = [...volumeData].sort((a, b) => a - b);
  const index = Math.floor((percentile / 100) * sorted.length);
  return sorted[index] || 0;
};
