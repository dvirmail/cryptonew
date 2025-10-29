import { updatePerformanceSnapshot } from './updatePerformanceSnapshot';

/**
 * Test function to manually trigger performance snapshot creation
 * This can be called from the browser console for testing
 */
export async function testPerformanceSnapshot(mode = 'testnet') {
    console.log(`[testPerformanceSnapshot] 🧪 Testing snapshot creation for mode: ${mode}`);
    
    try {
        const result = await updatePerformanceSnapshot({ mode });
        
        console.log('[testPerformanceSnapshot] 📊 Test result:', {
            success: result.success,
            snapshotsCreated: result.snapshotsCreated?.length || 0,
            errors: result.errors?.length || 0,
            details: result
        });
        
        if (result.success) {
            console.log('[testPerformanceSnapshot] ✅ Test passed! Snapshots created successfully');
            if (result.snapshotsCreated?.length > 0) {
                result.snapshotsCreated.forEach(snap => {
                    console.log(`[testPerformanceSnapshot] 📈 Created ${snap.type} snapshot:`, {
                        id: snap.id,
                        timestamp: snap.timestamp,
                        period_pnl: snap.period_pnl,
                        cumulative_realized_pnl: snap.cumulative_realized_pnl
                    });
                });
            }
        } else {
            console.error('[testPerformanceSnapshot] ❌ Test failed:', result.errors);
        }
        
        return result;
        
    } catch (error) {
        console.error('[testPerformanceSnapshot] ❌ Test error:', error);
        return { success: false, error: error.message };
    }
}

// Make it available globally for console testing
if (typeof window !== 'undefined') {
    window.testPerformanceSnapshot = testPerformanceSnapshot;
}
