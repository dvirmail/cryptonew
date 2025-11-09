/**
 * Performance Momentum Weights Configuration
 * 
 * These weights determine how different factors contribute to the overall
 * performance momentum score that influences scanning behavior.
 * 
 * Updated allocation per user request:
 * - Unrealized P&L: 40%
 * - Realized P&L:   10%
 * - Market Regime:  15%
 * - Volatility:     10%
 * - Opportunity:    15%
 * - Fear & Greed:   10%
 * - Signal Quality:  0%
 */

export const MOMENTUM_WEIGHTS = {
    unrealizedPnl: 0.30,    // 30% - Increased to focus on current position performance
    realizedPnl: 0.40,      // 40% - DOMINANT FACTOR - actual trading results matter most
    regime: 0.00,            // 0% - REMOVED: Market regime is context, not performance momentum
    volatility: 0.10,        // 10% - Keep same
    opportunityRate: 0.00,  // 0% - REMOVED: Strategy count is not a performance metric
    fearGreed: 0.10,        // 10% - Keep same
    signalQuality: 0.10,   // 10% - Increased from 4% - signal strength is important
};

/**
 * Percentage representation of momentum weights for UI display
 */
export const MOMENTUM_WEIGHTS_PERCENTS = Object.fromEntries(
    Object.entries(MOMENTUM_WEIGHTS).map(([k, v]) => [k, Math.round(v * 100)])
);

/**
 * Default momentum calculation intervals
 */
export const MOMENTUM_INTERVALS = {
    calculationInterval: 30000, // 30 seconds - more stable, less noise
    fearAndGreedFetchInterval: 5 * 60 * 1000, // 5 minutes
    maxMomentumTrades: 100,
};

/**
 * Momentum score thresholds for risk adjustment
 */
export const MOMENTUM_THRESHOLDS = {
    excellent: 75, // Use full configured max risk (lowered from 80)
    good: 60,      // Scale from 60% to 100% of max risk (raised from 50)
    poor: 40,       // Scale from 20% to 60% of max risk (raised from 30)
    minimum: 10,    // Absolute minimum risk percentage (raised from 5)
};
