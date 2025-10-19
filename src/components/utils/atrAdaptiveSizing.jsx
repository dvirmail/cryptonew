/**
 * ATR Adaptive Sizing Utility
 * 
 * This module provides sophisticated position sizing and risk management
 * based on Average True Range (ATR) to adapt to market volatility.
 */

/**
 * ATR-based volatility regimes
 */
const VOLATILITY_REGIMES = {
  VERY_LOW: { threshold: 0.3, multiplier: 1.5, description: "Very Low Volatility" },
  LOW: { threshold: 0.5, multiplier: 1.2, description: "Low Volatility" },
  NORMAL: { threshold: 1.0, multiplier: 1.0, description: "Normal Volatility" },
  HIGH: { threshold: 1.5, multiplier: 0.8, description: "High Volatility" },
  VERY_HIGH: { threshold: 2.5, multiplier: 0.6, description: "Very High Volatility" },
  EXTREME: { threshold: 999, multiplier: 0.4, description: "Extreme Volatility" }
};

/**
 * Calculates the current volatility regime based on ATR percentile
 * @param {number} currentATR - Current ATR value
 * @param {number} atrPercentile - ATR percentile (0-100)
 * @returns {object} Volatility regime information
 */
export function getVolatilityRegime(currentATR, atrPercentile) {
  const normalizedPercentile = atrPercentile / 100;
  
  if (normalizedPercentile <= VOLATILITY_REGIMES.VERY_LOW.threshold) {
    return { ...VOLATILITY_REGIMES.VERY_LOW, percentile: atrPercentile };
  } else if (normalizedPercentile <= VOLATILITY_REGIMES.LOW.threshold) {
    return { ...VOLATILITY_REGIMES.LOW, percentile: atrPercentile };
  } else if (normalizedPercentile <= VOLATILITY_REGIMES.NORMAL.threshold) {
    return { ...VOLATILITY_REGIMES.NORMAL, percentile: atrPercentile };
  } else if (normalizedPercentile <= VOLATILITY_REGIMES.HIGH.threshold) {
    return { ...VOLATILITY_REGIMES.HIGH, percentile: atrPercentile };
  } else if (normalizedPercentile <= VOLATILITY_REGIMES.VERY_HIGH.threshold) {
    return { ...VOLATILITY_REGIMES.VERY_HIGH, percentile: atrPercentile };
  } else {
    return { ...VOLATILITY_REGIMES.EXTREME, percentile: atrPercentile };
  }
}

/**
 * Calculates ATR percentile over a lookback period
 * @param {array} atrHistory - Array of historical ATR values
 * @param {number} currentATR - Current ATR value
 * @param {number} lookback - Lookback period (default: 252 for ~1 year)
 * @returns {number} ATR percentile (0-100)
 */
export function calculateATRPercentile(atrHistory, currentATR, lookback = 252) {
  if (!atrHistory || atrHistory.length < 20) {
    return 50; // Default to median if insufficient data
  }
  
  const relevantHistory = atrHistory.slice(-lookback);
  const sortedATR = [...relevantHistory].sort((a, b) => a - b);
  
  let rank = 0;
  for (let i = 0; i < sortedATR.length; i++) {
    if (sortedATR[i] <= currentATR) {
      rank = i + 1;
    } else {
      break;
    }
  }
  
  return Math.round((rank / sortedATR.length) * 100);
}

/**
 * Calculates adaptive position size based on ATR and account parameters
 * @param {object} params - Position sizing parameters
 * @returns {object} Position sizing details
 */
export function calculateAdaptivePositionSize({
  accountBalance,
  riskPercentage, // Base risk percentage (e.g., 1% = 0.01)
  currentPrice,
  atrValue,
  atrPercentile,
  stopLossATRMultiplier = 2.0,
  maxPositionPercent = 10, // Max % of account in single position
  minPositionValue = 10 // Minimum position value in base currency
}) {
  
  // Get volatility regime
  const volatilityRegime = getVolatilityRegime(atrValue, atrPercentile);
  
  // Calculate adaptive risk based on volatility
  const adaptiveRiskPercentage = riskPercentage * volatilityRegime.multiplier;
  
  // Calculate stop-loss distance in price terms
  const stopLossDistance = atrValue * stopLossATRMultiplier;
  const stopLossPrice = currentPrice - stopLossDistance;
  const riskPerUnit = currentPrice - stopLossPrice;
  
  // Calculate position size based on risk
  const riskAmount = accountBalance * adaptiveRiskPercentage;
  let positionSize = riskAmount / riskPerUnit;
  
  // Apply position limits
  const maxPositionSize = (accountBalance * maxPositionPercent / 100) / currentPrice;
  positionSize = Math.min(positionSize, maxPositionSize);
  
  // Ensure minimum position value
  const minPositionSize = minPositionValue / currentPrice;
  positionSize = Math.max(positionSize, minPositionSize);
  
  const positionValue = positionSize * currentPrice;
  const actualRiskAmount = positionSize * riskPerUnit;
  const actualRiskPercentage = (actualRiskAmount / accountBalance) * 100;
  
  return {
    positionSize: Number(positionSize.toFixed(8)),
    positionValue: Number(positionValue.toFixed(2)),
    stopLossPrice: Number(stopLossPrice.toFixed(2)),
    stopLossDistance: Number(stopLossDistance.toFixed(2)),
    riskAmount: Number(actualRiskAmount.toFixed(2)),
    riskPercentage: Number(actualRiskPercentage.toFixed(3)),
    volatilityRegime,
    atrMultiplier: volatilityRegime.multiplier,
    sizing: {
      baseRisk: riskPercentage * 100,
      adaptiveRisk: adaptiveRiskPercentage * 100,
      adjustment: `${volatilityRegime.multiplier}x (${volatilityRegime.description})`
    }
  };
}

/**
 * Calculates adaptive take-profit levels based on ATR
 * @param {object} params - Take-profit parameters
 * @returns {object} Take-profit details
 */
export function calculateAdaptiveTakeProfit({
  entryPrice,
  atrValue,
  atrPercentile,
  riskRewardRatio = 2.0, // Target 2:1 reward:risk
  takeProfitATRMultiplier = 3.0,
  useATRTrailing = true
}) {
  
  const volatilityRegime = getVolatilityRegime(atrValue, atrPercentile);
  
  // Adjust take-profit distance based on volatility
  let adjustedATRMultiplier = takeProfitATRMultiplier;
  
  // In high volatility, give more room for profits
  if (volatilityRegime.percentile > 70) {
    adjustedATRMultiplier *= 1.2;
  }
  // In low volatility, tighten take-profit
  else if (volatilityRegime.percentile < 30) {
    adjustedATRMultiplier *= 0.8;
  }
  
  const takeProfitDistance = atrValue * adjustedATRMultiplier;
  const takeProfitPrice = entryPrice + takeProfitDistance;
  
  // Calculate trailing stop parameters if enabled
  let trailingStopDetails = null;
  if (useATRTrailing) {
    const trailingATR = atrValue * (adjustedATRMultiplier * 0.6); // Closer trailing
    trailingStopDetails = {
      initialTrailDistance: Number(trailingATR.toFixed(2)),
      trailingATRMultiplier: Number((adjustedATRMultiplier * 0.6).toFixed(2)),
      recommendedTrailStart: Number((entryPrice + (takeProfitDistance * 0.3)).toFixed(2)) // Start trailing after 30% of target
    };
  }
  
  return {
    takeProfitPrice: Number(takeProfitPrice.toFixed(2)),
    takeProfitDistance: Number(takeProfitDistance.toFixed(2)),
    atrMultiplier: Number(adjustedATRMultiplier.toFixed(2)),
    volatilityRegime,
    trailingStopDetails,
    projectedRewardRisk: Number((takeProfitDistance / (atrValue * 2.0)).toFixed(2)) // Assuming 2 ATR stop
  };
}

/**
 * Comprehensive ATR-based trade setup calculator
 * @param {object} params - Complete trade setup parameters
 * @returns {object} Complete trade setup with adaptive sizing
 */
export function calculateATRTradeSetup({
  // Account parameters
  accountBalance,
  baseRiskPercentage = 0.01, // 1%
  
  // Market data
  currentPrice,
  atrValue,
  atrHistory = [],
  
  // Strategy parameters
  stopLossATRMultiplier = 2.5,
  takeProfitATRMultiplier = 3.0,
  useTrailingStop = true,
  
  // Limits
  maxPositionPercent = 8,
  minPositionValue = 10
}) {
  
  // Calculate ATR percentile
  const atrPercentile = calculateATRPercentile(atrHistory, atrValue);
  
  // Calculate position sizing
  const positionDetails = calculateAdaptivePositionSize({
    accountBalance,
    riskPercentage: baseRiskPercentage,
    currentPrice,
    atrValue,
    atrPercentile,
    stopLossATRMultiplier,
    maxPositionPercent,
    minPositionValue
  });
  
  // Calculate take-profit
  const takeProfitDetails = calculateAdaptiveTakeProfit({
    entryPrice: currentPrice,
    atrValue,
    atrPercentile,
    takeProfitATRMultiplier,
    useATRTrailing: useTrailingStop
  });
  
  // Calculate trade statistics
  const potentialProfit = (takeProfitDetails.takeProfitPrice - currentPrice) * positionDetails.positionSize;
  const potentialLoss = positionDetails.riskAmount;
  const rewardRiskRatio = potentialProfit / potentialLoss;
  
  return {
    // Entry details
    entry: {
      price: currentPrice,
      quantity: positionDetails.positionSize,
      value: positionDetails.positionValue
    },
    
    // Risk management
    stopLoss: {
      price: positionDetails.stopLossPrice,
      distance: positionDetails.stopLossDistance,
      atrMultiplier: stopLossATRMultiplier
    },
    
    // Take profit
    takeProfit: {
      price: takeProfitDetails.takeProfitPrice,
      distance: takeProfitDetails.takeProfitDistance,
      atrMultiplier: takeProfitDetails.atrMultiplier,
      trailing: takeProfitDetails.trailingStopDetails
    },
    
    // Risk metrics
    risk: {
      amount: positionDetails.riskAmount,
      percentage: positionDetails.riskPercentage,
      baseRisk: baseRiskPercentage * 100,
      adjustment: positionDetails.sizing.adjustment
    },
    
    // Volatility context
    volatility: {
      atr: atrValue,
      percentile: atrPercentile,
      regime: positionDetails.volatilityRegime.description,
      multiplier: positionDetails.volatilityRegime.multiplier
    },
    
    // Trade projections
    projections: {
      potentialProfit: Number(potentialProfit.toFixed(2)),
      potentialLoss: Number(potentialLoss.toFixed(2)),
      rewardRiskRatio: Number(rewardRiskRatio.toFixed(2)),
      breakeven: currentPrice,
      maxDrawdown: positionDetails.riskPercentage
    }
  };
}

/**
 * Validates ATR trade setup for reasonableness
 * @param {object} tradeSetup - Trade setup from calculateATRTradeSetup
 * @returns {object} Validation results
 */
export function validateATRTradeSetup(tradeSetup) {
  const warnings = [];
  const errors = [];
  
  // Check reward:risk ratio
  if (tradeSetup.projections.rewardRiskRatio < 1.5) {
    warnings.push(`Low reward:risk ratio of ${tradeSetup.projections.rewardRiskRatio}. Consider 1.5+ for better risk-adjusted returns.`);
  }
  
  // Check risk percentage
  if (tradeSetup.risk.percentage > 3) {
    warnings.push(`High risk percentage of ${tradeSetup.risk.percentage}%. Consider reducing position size.`);
  }
  
  // Check volatility extremes
  if (tradeSetup.volatility.percentile > 90) {
    warnings.push(`Extreme high volatility (${tradeSetup.volatility.percentile}th percentile). Consider reducing position size further.`);
  }
  
  // Check position size sanity
  if (tradeSetup.entry.value < 10) {
    errors.push(`Position value too small ($${tradeSetup.entry.value}). Increase account balance or risk percentage.`);
  }
  
  const isValid = errors.length === 0;
  
  return {
    isValid,
    score: Math.max(0, 100 - (errors.length * 50) - (warnings.length * 10)),
    errors,
    warnings,
    recommendation: isValid ? 
      (warnings.length === 0 ? "Setup looks excellent!" : "Setup is valid with minor considerations.") :
      "Setup has critical issues that should be addressed."
  };
}