/**
 * Scanner Default Configuration
 * 
 * Default values and configurations used throughout the scanner application.
 * These provide fallback values when user settings are not available.
 */

export const SCANNER_DEFAULTS = {
    // Trading modes
    tradingMode: 'testnet',
    
    // Scan configuration
    scanFrequency: 60000, // 1 minute in milliseconds
    minimumCombinedStrength: 225,
    minimumRegimeConfidence: 50, // RESTORED: Fixed confidence calculation, back to normal threshold
    minimumTradeValue: 10,
    maxPositions: 1,
    portfolioHeatMax: 20,
    riskPerTrade: 2,
    
    // Balance and risk management
    maxBalancePercentRisk: 100,
    maxBalanceInvestCapUSDT: 0, // 0 means no absolute cap
    blockTradingInDowntrend: false,
    
    // Position sizing
    defaultPositionSize: 100,
    basePositionSize: 100, // Base position size for LPM system
    useWinStrategySize: true,
    
    // Signal matching
    signalMatchingMode: 'conviction_based',
    minimumConvictionScore: 50,
    
    // Performance tracking
    resetStatsOnModeSwitch: false,
    
    // Network configuration
    localProxyUrl: 'http://localhost:3003',
    
    // Session management
    heartbeatInterval: 25000, // 25 seconds
    sessionTimeout: 60000,   // 1 minute
    
    // Price consolidation
    minBalanceThreshold: 0.001,
    estimatedMinValueUSD: 0.10,
    
    // Market regime
    regimeCacheValidityHours: 1,
    regimeConfirmationThreshold: 3,
    
    // Performance metrics
    maxCycleTimeSamples: 20,
    maxSignalHistory: 50,
    maxLogEntries: 1000,
    
    // Fear & Greed Index
    fearGreedFetchInterval: 30 * 1000, // 30 seconds
    
    // Trade archiving
    maxTradeHistory: 1000,
    archiveThresholdDays: 30,
    
    // Error handling
    maxRetries: 3,
    retryDelayMs: 2000,
    criticalErrorThreshold: 5,
};

/**
 * Default state structure for the scanner
 */
export const DEFAULT_SCANNER_STATE = {
    isInitialized: false,
    isInitializing: false,
    isRunning: false,
    isScanning: false,
    settings: null,
    activeStrategies: [],
    marketRegime: null,
    performanceMomentumScore: null,
    momentumBreakdown: null,
    signalGenerationHistory: [],
    marketVolatility: { adx: 25, bbw: 0.1 },
    logs: { activity: [], performance: [] },
    stats: {
        activeStrategies: 0,
        totalScans: 0,
        signalsFound: 0,
        tradesExecuted: 0,
        successRate: 0,
        totalPnL: 0,
        averageSignalStrength: 0,
        totalScanCycles: 0,
        averageScanTimeMs: 0,
        lastScanTimeMs: 0
    },
    lastScanTime: null,
    nextScanTime: null,
    recentTradesForMomentum: [],
    tradingMode: SCANNER_DEFAULTS.tradingMode,
    liveWalletState: null,
    exchangeInfo: null,
    leaderSessionId: null,
    fearAndGreedData: null,
    marketAlerts: [],
    newPositionsCount: 0,
    adjustedBalanceRiskFactor: 100,
};

/**
 * Default wallet state structure
 */
export const DEFAULT_WALLET_STATE = {
    available_balance: "0.00000000",
    total_realized_pnl: "0.00000000",
    unrealized_pnl: "0.00000000",
    balances: [],
    positions: [],
    live_position_ids: [],
    total_trades_count: 0,
    winning_trades_count: 0,
    losing_trades_count: 0,
    total_gross_profit: 0,
    total_gross_loss: 0,
    total_fees_paid: 0,
    last_updated_timestamp: new Date().toISOString(),
    last_binance_sync: new Date().toISOString()
};

/**
 * Default market regime state
 */
export const DEFAULT_MARKET_REGIME = {
    regime: 'neutral',
    confidence: 0.5,
    isConfirmed: false,
    consecutivePeriods: 0,
    confirmationThreshold: SCANNER_DEFAULTS.regimeConfirmationThreshold,
    regimeHistory: []
};
