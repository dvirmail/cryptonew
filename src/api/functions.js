import { base44 } from './base44Client';


export const debugTelegramSettings = base44.functions.debugTelegramSettings;

export const telegramNotifications = base44.functions.telegramNotifications;

export const getFearAndGreedIndex = base44.functions.getFearAndGreedIndex;

export const getExchangeInfo = base44.functions.getExchangeInfo;

export const getKlineData = base44.functions.getKlineData;

export const deleteStrategyAndTrades = base44.functions.deleteStrategyAndTrades;

export const purgeOrphanedTrades = base44.functions.purgeOrphanedTrades;

export const getBinancePrices = base44.functions.getBinancePrices;

export const runSystemTest = base44.functions.runSystemTest;

export const getTickerData = base44.functions.getTickerData;

export const updateStrategyStats = base44.functions.updateStrategyStats;

export const safeCombinationOperations = base44.functions.safeCombinationOperations;

export const scannerControls = base44.functions.scannerControls;

export const scannerConfig = base44.functions.scannerConfig;

export const purgeDemoData = base44.functions.purgeDemoData;

export const migrateTradeHistory = base44.functions.migrateTradeHistory;

export const reconcileWalletState = base44.functions.reconcileWalletState;

export const backfillHistoricalPerformance = base44.functions.backfillHistoricalPerformance;

export const migrateTradeCommissions = base44.functions.migrateTradeCommissions;

export const purgeTradeData = base44.functions.purgeTradeData;

export const archiveOldTrades = base44.functions.archiveOldTrades;

// Use local implementation instead of base44 version
import { updatePerformanceSnapshot as localUpdatePerformanceSnapshot } from './updatePerformanceSnapshot';
export const updatePerformanceSnapshot = localUpdatePerformanceSnapshot;

export const investigateTradeData = base44.functions.investigateTradeData;

export const purgeDuplicateCombinations = base44.functions.purgeDuplicateCombinations;

export const scannerSessionManager = base44.functions.scannerSessionManager;

export const testBinanceKeys = base44.functions.testBinanceKeys;

export const liveTradingAPI = base44.functions.liveTradingAPI;

export const saveApiKeys = base44.functions.saveApiKeys;

export const server = base44.functions.server;

export const backfillTradeMode = base44.functions.backfillTradeMode;

export const clearCorruptedPositions = base44.functions.clearCorruptedPositions;

export const createBaselineSnapshot = base44.functions.createBaselineSnapshot;

export const backfillTradeRegimes = base44.functions.backfillTradeRegimes;

export const deleteTradesBeforeDate = base44.functions.deleteTradesBeforeDate;

export const setExitTimeForOpenPositions = base44.functions.setExitTimeForOpenPositions;

export const auditHistoricalPerformance = base44.functions.auditHistoricalPerformance;

export const migratePositionsToEntity = base44.functions.migratePositionsToEntity;

export const migratePositionsToLiveEntity = base44.functions.migratePositionsToLiveEntity;

export const fixNullTimeExitHours = base44.functions.fixNullTimeExitHours;

export const purgeAllPositions = base44.functions.purgeAllPositions;

export const maintainTradeLimit = base44.functions.maintainTradeLimit;

export const repairHistoricalPerformance = base44.functions.repairHistoricalPerformance;

export const walletReconciliation = base44.functions.walletReconciliation;

export const purgeGhostPositions = base44.functions.purgeGhostPositions;

export const fetchKlineData = base44.functions.fetchKlineData;

