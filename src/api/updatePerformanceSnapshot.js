import { Trade, HistoricalPerformance } from './entities';
import { queueEntityCall } from '@/components/utils/apiQueue';

/**
 * Creates or updates HistoricalPerformance snapshots for a given trading mode and period type.
 * This function implements the core snapshot logic as described in the AI Engine Explanation.
 * 
 * @param {Object} params - Parameters for snapshot creation
 * @param {string} params.mode - Trading mode ('testnet' or 'live')
 * @param {string} [params.periodType] - Period type ('hourly' or 'daily'), defaults to both
 * @param {Date} [params.specificTimestamp] - Specific timestamp to create snapshot for, defaults to current time
 * @returns {Object} Result object with success status and created snapshots
 */
export async function updatePerformanceSnapshot(params = {}) {
    const { mode, periodType, specificTimestamp } = params;
    
    console.log('[updatePerformanceSnapshot] 🚀 Starting snapshot update:', {
        mode,
        periodType,
        specificTimestamp: specificTimestamp?.toISOString(),
        timestamp: new Date().toISOString()
    });

    if (!mode) {
        throw new Error('Mode parameter is required');
    }

    const results = {
        success: true,
        snapshotsCreated: [],
        errors: [],
        currentMetrics: null
    };

    try {
        // Determine which period types to process
        const periodTypes = periodType ? [periodType] : ['hourly', 'daily'];
        
        // SAFETY: If there are no trades at all for this mode, force a zero baseline
        let hasAnyTrades = false;
        try {
            const any = await queueEntityCall('Trade', 'filter', { trading_mode: mode }, '-created_date', 1).catch(() => []);
            hasAnyTrades = Array.isArray(any) && any.length > 0;
        } catch (_) {}
        
        for (const currentPeriodType of periodTypes) {
            try {
                console.log(`[updatePerformanceSnapshot] 📊 Processing ${currentPeriodType} snapshots for mode: ${mode}`);
                
                const snapshotResult = await createSnapshotForPeriod({
                    mode,
                    periodType: currentPeriodType,
                    specificTimestamp,
                    forceZeroBaseline: !hasAnyTrades
                });
                
                if (snapshotResult.success) {
                    results.snapshotsCreated.push(...snapshotResult.snapshotsCreated);
                    console.log(`[updatePerformanceSnapshot] ✅ ${currentPeriodType} snapshot created successfully`);
                } else {
                    results.errors.push(`${currentPeriodType}: ${snapshotResult.error}`);
                    console.error(`[updatePerformanceSnapshot] ❌ ${currentPeriodType} snapshot failed:`, snapshotResult.error);
                }
            } catch (error) {
                const errorMsg = `Failed to create ${currentPeriodType} snapshot: ${error.message}`;
                results.errors.push(errorMsg);
                console.error(`[updatePerformanceSnapshot] ❌ ${errorMsg}`, error);
            }
        }

        // Get current metrics for the most recent snapshot
        if (results.snapshotsCreated.length > 0) {
            try {
                const latestSnapshot = await getLatestSnapshot(mode, 'daily');
                results.currentMetrics = latestSnapshot;
            } catch (error) {
                console.warn('[updatePerformanceSnapshot] ⚠️ Could not fetch current metrics:', error.message);
            }
        }

        // Determine overall success
        results.success = results.errors.length === 0;
        
        console.log('[updatePerformanceSnapshot] 📈 Snapshot update completed:', {
            success: results.success,
            snapshotsCreated: results.snapshotsCreated.length,
            errors: results.errors.length,
            currentMetrics: results.currentMetrics ? 'present' : 'none'
        });

        return results;

    } catch (error) {
        console.error('[updatePerformanceSnapshot] ❌ Critical error:', error);
        return {
            success: false,
            snapshotsCreated: [],
            errors: [`Critical error: ${error.message}`],
            currentMetrics: null
        };
    }
}

/**
 * Creates a snapshot for a specific period type
 */
async function createSnapshotForPeriod({ mode, periodType, specificTimestamp, forceZeroBaseline = false }) {
    const now = specificTimestamp || new Date();
    
    // Calculate period boundaries
    const { periodStart, periodEnd } = calculatePeriodBoundaries(now, periodType);
    
    console.log(`[createSnapshotForPeriod] 📅 ${periodType} period boundaries:`, {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        mode
    });

    try {
        // 1. Fetch trades that closed during this period
        const tradesInPeriod = await fetchTradesInPeriod(mode, periodStart, periodEnd);
        console.log(`[createSnapshotForPeriod] 📊 Found ${tradesInPeriod.length} trades in ${periodType} period`);

        // 2. Calculate period-specific stats
        const periodStats = calculatePeriodStats(tradesInPeriod);
        console.log(`[createSnapshotForPeriod] 📈 ${periodType} period stats:`, periodStats);

        // 3. Get previous snapshot for cumulative calculations
        const previousSnapshot = forceZeroBaseline ? null : await getPreviousSnapshot(mode, periodType, periodStart);
        console.log(`[createSnapshotForPeriod] 🔗 Previous ${periodType} snapshot:`, previousSnapshot ? 'found' : 'none');

        // 4. Calculate cumulative stats
        const cumulativeStats = await calculateCumulativeStats(periodStats, previousSnapshot, mode, periodEnd);
        console.log(`[createSnapshotForPeriod] 📊 ${periodType} cumulative stats:`, cumulativeStats);

        // 5. Create or update snapshot record
        const snapshotData = {
            mode,
            snapshot_timestamp: periodStart.toISOString(),
            period_type: periodType,
            ...periodStats,
            ...cumulativeStats
        };

        const snapshot = await upsertSnapshot(snapshotData);
        console.log(`[createSnapshotForPeriod] 💾 ${periodType} snapshot upserted:`, snapshot.id);

        return {
            success: true,
            snapshotsCreated: [{
                id: snapshot.id,
                type: periodType,
                timestamp: periodStart.toISOString(),
                period_pnl: periodStats.period_pnl,
                cumulative_realized_pnl: cumulativeStats.cumulative_realized_pnl
            }]
        };

    } catch (error) {
        console.error(`[createSnapshotForPeriod] ❌ Error creating ${periodType} snapshot:`, error);
        return {
            success: false,
            error: error.message,
            snapshotsCreated: []
        };
    }
}

/**
 * Calculate period boundaries based on period type
 */
function calculatePeriodBoundaries(timestamp, periodType) {
    const date = new Date(timestamp);
    
    if (periodType === 'hourly') {
        // Start of current hour
        const periodStart = new Date(date);
        periodStart.setMinutes(0, 0, 0);
        
        // End of current hour
        const periodEnd = new Date(periodStart);
        periodEnd.setHours(periodEnd.getHours() + 1);
        
        return { periodStart, periodEnd };
    } else if (periodType === 'daily') {
        // Start of current day (midnight UTC)
        const periodStart = new Date(date);
        periodStart.setUTCHours(0, 0, 0, 0);
        
        // End of current day
        const periodEnd = new Date(periodStart);
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
        
        return { periodStart, periodEnd };
    } else {
        throw new Error(`Invalid period type: ${periodType}`);
    }
}

/**
 * Fetch trades that closed during the specified period
 */
async function fetchTradesInPeriod(mode, periodStart, periodEnd) {
    try {
        const trades = await queueEntityCall('Trade', 'filter', {
            trading_mode: mode,
            exit_timestamp: {
                $gte: periodStart.toISOString(),
                $lt: periodEnd.toISOString()
            }
        }, '-exit_timestamp', 1000); // Reasonable limit
        
        return Array.isArray(trades) ? trades : [];
    } catch (error) {
        console.error('[fetchTradesInPeriod] ❌ Error fetching trades:', error);
        return [];
    }
}

/**
 * Calculate period-specific statistics from trades
 */
function calculatePeriodStats(trades) {
    const period_pnl = trades.reduce((sum, trade) => sum + (trade.pnl_usdt || 0), 0);
    const period_trade_count = trades.length;
    const period_winning_trades = trades.filter(trade => (trade.pnl_usdt || 0) > 0).length;
    const period_gross_profit = trades.reduce((sum, trade) => {
        const pnl = trade.pnl_usdt || 0;
        return sum + (pnl > 0 ? pnl : 0);
    }, 0);
    const period_gross_loss = trades.reduce((sum, trade) => {
        const pnl = trade.pnl_usdt || 0;
        return sum + (pnl < 0 ? Math.abs(pnl) : 0);
    }, 0);

    return {
        period_pnl,
        period_trade_count,
        period_winning_trades,
        period_gross_profit,
        period_gross_loss
    };
}

/**
 * Get the previous snapshot for cumulative calculations
 */
async function getPreviousSnapshot(mode, periodType, currentPeriodStart) {
    try {
        const previousSnapshots = await queueEntityCall('HistoricalPerformance', 'filter', {
            mode,
            period_type: periodType,
            snapshot_timestamp: { $lt: currentPeriodStart.toISOString() }
        }, '-snapshot_timestamp', 1);
        
        return Array.isArray(previousSnapshots) && previousSnapshots.length > 0 ? previousSnapshots[0] : null;
    } catch (error) {
        console.error('[getPreviousSnapshot] ❌ Error fetching previous snapshot:', error);
        return null;
    }
}

/**
 * Calculate cumulative statistics based on previous snapshot OR trades up to period end
 */
async function calculateCumulativeStats(periodStats, previousSnapshot, mode, periodEnd) {
    const previous = previousSnapshot || {};
    
    // If no previous snapshot, calculate cumulative from ALL trades up to the END of this period
    // This ensures correctness even when snapshots are missing
    if (!previousSnapshot || previousSnapshot.cumulative_realized_pnl === undefined || previousSnapshot.cumulative_realized_pnl === null) {
        try {
            // Fetch ALL trades for this mode that closed up to and INCLUDING the end of the current period
            // Note: periodEnd is exclusive (period uses $lt), so we use periodEnd to include current period trades
            const allTradesUpToPeriod = await queueEntityCall('Trade', 'filter', {
                trading_mode: mode,
                exit_timestamp: { $lt: periodEnd.toISOString() }
            }, '-exit_timestamp', 10000).catch(() => []);
            
            // NOTE: allTradesUpToPeriod already includes trades from the current period (since period uses $lt)
            // So cumulative = sum of allTradesUpToPeriod (already includes current period)
            
            if (Array.isArray(allTradesUpToPeriod) && allTradesUpToPeriod.length > 0) {
                const totalPnl = allTradesUpToPeriod.reduce((sum, trade) => sum + (Number(trade.pnl_usdt) || 0), 0);
                const totalCount = allTradesUpToPeriod.length;
                const totalWins = allTradesUpToPeriod.filter(t => (Number(t.pnl_usdt) || 0) > 0).length;
                const totalProfit = allTradesUpToPeriod.reduce((sum, trade) => {
                    const pnl = Number(trade.pnl_usdt) || 0;
                    return sum + (pnl > 0 ? pnl : 0);
                }, 0);
                const totalLoss = allTradesUpToPeriod.reduce((sum, trade) => {
                    const pnl = Number(trade.pnl_usdt) || 0;
                    return sum + (pnl < 0 ? Math.abs(pnl) : 0);
                }, 0);
                
                console.log(`[calculateCumulativeStats] 📊 Calculated from trades up to period end (no previous snapshot):`, {
                    periodEnd: periodEnd.toISOString(),
                    totalPnl,
                    totalCount,
                    totalWins,
                    totalProfit,
                    totalLoss
                });
                
                return {
                    cumulative_realized_pnl: totalPnl,
                    cumulative_trade_count: totalCount,
                    cumulative_winning_trades: totalWins,
                    cumulative_gross_profit: totalProfit,
                    cumulative_gross_loss: totalLoss
                };
            }
        } catch (error) {
            console.error('[calculateCumulativeStats] ❌ Error fetching trades for cumulative:', error);
        }
    }
    
    // Normal case: Use previous snapshot + current period
    return {
        cumulative_realized_pnl: (previous.cumulative_realized_pnl || 0) + periodStats.period_pnl,
        cumulative_trade_count: (previous.cumulative_trade_count || 0) + periodStats.period_trade_count,
        cumulative_winning_trades: (previous.cumulative_winning_trades || 0) + periodStats.period_winning_trades,
        cumulative_gross_profit: (previous.cumulative_gross_profit || 0) + periodStats.period_gross_profit,
        cumulative_gross_loss: (previous.cumulative_gross_loss || 0) + periodStats.period_gross_loss
    };
}

/**
 * Upsert snapshot record (create if doesn't exist, update if exists)
 */
async function upsertSnapshot(snapshotData) {
    try {
        // Check if snapshot already exists
        const existingSnapshots = await queueEntityCall('HistoricalPerformance', 'filter', {
            mode: snapshotData.mode,
            period_type: snapshotData.period_type,
            snapshot_timestamp: snapshotData.snapshot_timestamp
        }, '-snapshot_timestamp', 1);
        
        if (Array.isArray(existingSnapshots) && existingSnapshots.length > 0) {
            // Update existing snapshot
            const existing = existingSnapshots[0];
            const updated = await queueEntityCall('HistoricalPerformance', 'update', existing.id, snapshotData);
            console.log(`[upsertSnapshot] 🔄 Updated existing snapshot: ${existing.id}`);
            return updated;
        } else {
            // Create new snapshot
            const created = await queueEntityCall('HistoricalPerformance', 'create', snapshotData);
            console.log(`[upsertSnapshot] ➕ Created new snapshot: ${created.id}`);
            return created;
        }
    } catch (error) {
        console.error('[upsertSnapshot] ❌ Error upserting snapshot:', error);
        throw error;
    }
}

/**
 * Get the latest snapshot for current metrics
 */
async function getLatestSnapshot(mode, periodType) {
    try {
        const snapshots = await queueEntityCall('HistoricalPerformance', 'filter', {
            mode,
            period_type: periodType
        }, '-snapshot_timestamp', 1);
        
        return Array.isArray(snapshots) && snapshots.length > 0 ? snapshots[0] : null;
    } catch (error) {
        console.error('[getLatestSnapshot] ❌ Error fetching latest snapshot:', error);
        return null;
    }
}

/**
 * Backfill historical snapshots for all periods that have trades
 * This ensures the chart has complete data
 */
export async function backfillHistoricalSnapshots({ mode, maxHours = 168, maxDays = 90 }) {
    console.log(`[backfillHistoricalSnapshots] 🚀 Starting backfill for mode: ${mode}`);
    
    try {
        // Fetch all trades for this mode
        const allTrades = await queueEntityCall('Trade', 'filter', {
            trading_mode: mode
        }, '-exit_timestamp', 10000).catch(() => []);
        
        if (!Array.isArray(allTrades) || allTrades.length === 0) {
            console.log('[backfillHistoricalSnapshots] ⚠️ No trades found, skipping backfill');
            return { success: true, hourlyCreated: 0, dailyCreated: 0 };
        }
        
        // Find the earliest and latest trade
        const tradesWithExit = allTrades.filter(t => t.exit_timestamp);
        if (tradesWithExit.length === 0) {
            console.log('[backfillHistoricalSnapshots] ⚠️ No trades with exit_timestamp, skipping backfill');
            return { success: true, hourlyCreated: 0, dailyCreated: 0 };
        }
        
        const earliestExit = new Date(Math.min(...tradesWithExit.map(t => new Date(t.exit_timestamp).getTime())));
        const latestExit = new Date(Math.max(...tradesWithExit.map(t => new Date(t.exit_timestamp).getTime())));
        
        console.log(`[backfillHistoricalSnapshots] 📅 Trade range: ${earliestExit.toISOString()} to ${latestExit.toISOString()}`);
        
        // Backfill hourly snapshots
        let hourlyCreated = 0;
        const hourlyEnd = new Date(latestExit);
        hourlyEnd.setUTCMinutes(0, 0, 0);
        const hourlyStart = new Date(earliestExit);
        hourlyStart.setUTCMinutes(0, 0, 0);
        
        const hoursToProcess = Math.min(maxHours, Math.ceil((hourlyEnd.getTime() - hourlyStart.getTime()) / (60 * 60 * 1000)));
        
        for (let i = 0; i < hoursToProcess; i++) {
            const hourTimestamp = new Date(hourlyStart.getTime() + i * 60 * 60 * 1000);
            try {
                const result = await createSnapshotForPeriod({
                    mode,
                    periodType: 'hourly',
                    specificTimestamp: hourTimestamp,
                    forceZeroBaseline: false
                });
                if (result.success) hourlyCreated++;
            } catch (error) {
                console.error(`[backfillHistoricalSnapshots] ❌ Error creating hourly snapshot for ${hourTimestamp.toISOString()}:`, error);
            }
        }
        
        // Backfill daily snapshots
        let dailyCreated = 0;
        const dailyEnd = new Date(latestExit);
        dailyEnd.setUTCHours(0, 0, 0, 0);
        const dailyStart = new Date(earliestExit);
        dailyStart.setUTCHours(0, 0, 0, 0);
        
        const daysToProcess = Math.min(maxDays, Math.ceil((dailyEnd.getTime() - dailyStart.getTime()) / (24 * 60 * 60 * 1000)));
        
        for (let i = 0; i < daysToProcess; i++) {
            const dayTimestamp = new Date(dailyStart.getTime() + i * 24 * 60 * 60 * 1000);
            try {
                const result = await createSnapshotForPeriod({
                    mode,
                    periodType: 'daily',
                    specificTimestamp: dayTimestamp,
                    forceZeroBaseline: false
                });
                if (result.success) dailyCreated++;
            } catch (error) {
                console.error(`[backfillHistoricalSnapshots] ❌ Error creating daily snapshot for ${dayTimestamp.toISOString()}:`, error);
            }
        }
        
        console.log(`[backfillHistoricalSnapshots] ✅ Backfill complete: ${hourlyCreated} hourly, ${dailyCreated} daily snapshots created`);
        
        return {
            success: true,
            hourlyCreated,
            dailyCreated
        };
        
    } catch (error) {
        console.error('[backfillHistoricalSnapshots] ❌ Critical error:', error);
        return {
            success: false,
            error: error.message,
            hourlyCreated: 0,
            dailyCreated: 0
        };
    }
}

export default updatePerformanceSnapshot;
