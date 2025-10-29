/**
 * Storage Keys Configuration
 * 
 * Centralized storage keys used throughout the scanner application
 * to ensure consistency and avoid key conflicts.
 */

export const STORAGE_KEYS = {
    // Main scanner state storage
    scannerState: 'cryptoSentinelScannerState',
    
    // Wallet summary cache keys
    walletSummaryCache: (mode) => `walletSummaryCache_${mode}`,
    
    // Session management
    sessionId: 'scanner_session_id',
    
    // Trading mode persistence
    tradingMode: 'scanner_trading_mode',
    
    // Performance metrics cache
    performanceMetrics: 'scanner_performance_metrics',
    
    // Market regime state
    marketRegimeState: 'scanner_market_regime_state',
    
    // Scan cycle statistics
    scanCycleStats: 'scanner_cycle_stats',
    
    // Configuration cache
    configurationCache: 'scanner_configuration_cache',
    
    // Price data cache
    priceDataCache: 'scanner_price_data_cache',
    
    // Strategy cache
    strategyCache: 'scanner_strategy_cache',
};

/**
 * Default cache expiration times (in milliseconds)
 */
export const CACHE_EXPIRATION = {
    walletSummary: 5 * 60 * 1000,      // 5 minutes
    performanceMetrics: 10 * 60 * 1000, // 10 minutes
    marketRegime: 60 * 60 * 1000,       // 1 hour
    priceData: 30 * 1000,               // 30 seconds
    strategyData: 15 * 60 * 1000,       // 15 minutes
    configuration: 24 * 60 * 60 * 1000, // 24 hours
};
