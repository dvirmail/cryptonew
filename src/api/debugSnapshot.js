import { Trade, HistoricalPerformance } from './entities';
import { queueEntityCall } from '@/components/utils/apiQueue';

/**
 * Debug function to test snapshot creation step by step
 */
export async function debugSnapshot(mode = 'testnet') {
    console.log(`[debugSnapshot] 🧪 Debugging snapshot creation for mode: ${mode}`);
    
    try {
        // Step 1: Test basic entity calls
        console.log('[debugSnapshot] 📊 Step 1: Testing basic entity calls...');
        
        const trades = await queueEntityCall('Trade', 'filter', {
            trading_mode: mode
        }, '-exit_timestamp', 5);
        
        console.log('[debugSnapshot] 📊 Step 1 result:', {
            tradesCount: trades?.length || 0,
            trades: trades?.slice(0, 2) || []
        });
        
        // Step 2: Test HistoricalPerformance calls
        console.log('[debugSnapshot] 📊 Step 2: Testing HistoricalPerformance calls...');
        
        const performances = await queueEntityCall('HistoricalPerformance', 'filter', {
            mode
        }, '-snapshot_timestamp', 5);
        
        console.log('[debugSnapshot] 📊 Step 2 result:', {
            performancesCount: performances?.length || 0,
            performances: performances?.slice(0, 2) || []
        });
        
        // Step 3: Test period boundary calculation
        console.log('[debugSnapshot] 📊 Step 3: Testing period boundary calculation...');
        
        const now = new Date();
        const periodStart = new Date(now);
        periodStart.setMinutes(0, 0, 0);
        const periodEnd = new Date(periodStart);
        periodEnd.setHours(periodEnd.getHours() + 1);
        
        console.log('[debugSnapshot] 📊 Step 3 result:', {
            now: now.toISOString(),
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString()
        });
        
        // Step 4: Test trades in period query
        console.log('[debugSnapshot] 📊 Step 4: Testing trades in period query...');
        
        const tradesInPeriod = await queueEntityCall('Trade', 'filter', {
            trading_mode: mode,
            exit_timestamp: {
                $gte: periodStart.toISOString(),
                $lt: periodEnd.toISOString()
            }
        }, '-exit_timestamp', 1000);
        
        console.log('[debugSnapshot] 📊 Step 4 result:', {
            tradesInPeriodCount: tradesInPeriod?.length || 0,
            tradesInPeriod: tradesInPeriod?.slice(0, 2) || []
        });
        
        console.log('[debugSnapshot] ✅ Debug completed successfully!');
        
        return {
            success: true,
            tradesCount: trades?.length || 0,
            performancesCount: performances?.length || 0,
            tradesInPeriodCount: tradesInPeriod?.length || 0
        };
        
    } catch (error) {
        console.error('[debugSnapshot] ❌ Debug error:', error);
        return { success: false, error: error.message };
    }
}

// Make it available globally for console testing
if (typeof window !== 'undefined') {
    window.debugSnapshot = debugSnapshot;
}
