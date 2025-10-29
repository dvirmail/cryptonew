import { queueEntityCall } from '@/components/utils/apiQueue';

/**
 * Simple test to debug queueEntityCall issue
 */
export async function testQueueCall() {
    console.log('[testQueueCall] 🧪 Testing queueEntityCall directly...');
    
    try {
        // Test 1: Direct list call
        console.log('[testQueueCall] 📊 Test 1: Direct list call...');
        const listResult = await queueEntityCall('HistoricalPerformance', 'list', {}, '-snapshot_timestamp', 5);
        console.log('[testQueueCall] 📊 Test 1 result:', {
            success: !!listResult,
            length: listResult?.length || 0,
            type: typeof listResult,
            isArray: Array.isArray(listResult),
            sample: listResult?.slice(0, 1) || []
        });
        
        // Test 2: Filter call
        console.log('[testQueueCall] 📊 Test 2: Filter call...');
        const filterResult = await queueEntityCall('HistoricalPerformance', 'filter', {
            mode: 'testnet'
        }, '-snapshot_timestamp', 5);
        console.log('[testQueueCall] 📊 Test 2 result:', {
            success: !!filterResult,
            length: filterResult?.length || 0,
            type: typeof filterResult,
            isArray: Array.isArray(filterResult),
            sample: filterResult?.slice(0, 1) || []
        });
        
        // Test 3: Raw fetch test
        console.log('[testQueueCall] 📊 Test 3: Raw fetch test...');
        const rawResponse = await fetch('http://localhost:3003/api/entities/HistoricalPerformance');
        const rawData = await rawResponse.json();
        console.log('[testQueueCall] 📊 Test 3 result:', {
            success: rawData.success,
            length: rawData.data?.length || 0,
            sample: rawData.data?.slice(0, 1) || []
        });
        
        return {
            success: true,
            listLength: listResult?.length || 0,
            filterLength: filterResult?.length || 0,
            rawLength: rawData.data?.length || 0
        };
        
    } catch (error) {
        console.error('[testQueueCall] ❌ Error:', error);
        return { success: false, error: error.message };
    }
}

// Make it available globally for console testing
if (typeof window !== 'undefined') {
    window.testQueueCall = testQueueCall;
}
