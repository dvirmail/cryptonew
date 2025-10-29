/**
 * Test script for RobustReconcileService
 * Run this in the browser console to test the new reconcile functionality
 */

// Test function for the browser console
window.testRobustReconcile = async function() {
    console.log('🧪 Testing RobustReconcileService...');
    
    try {
        // Import the service
        const { robustReconcileService } = await import('./src/components/services/RobustReconcileService.jsx');
        
        console.log('✅ Service imported successfully');
        
        // Test reconciliation
        const result = await robustReconcileService.reconcileWithBinance('testnet', 'test-wallet');
        
        console.log('📊 Reconciliation result:', result);
        
        if (result.success) {
            console.log('✅ Reconciliation successful!');
            console.log(`📈 Summary:`, result.summary);
        } else {
            console.log('❌ Reconciliation failed:', result.error);
        }
        
        // Test throttling
        console.log('⏳ Testing throttling...');
        const result2 = await robustReconcileService.reconcileWithBinance('testnet', 'test-wallet');
        console.log('📊 Second reconciliation result:', result2);
        
        // Get service status
        const status = robustReconcileService.getStatus();
        console.log('📊 Service status:', status);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
};

// Test function for manual reconciliation
window.manualReconcile = async function(tradingMode = 'testnet') {
    console.log(`🔄 Starting manual reconciliation for ${tradingMode}...`);
    
    try {
        const { robustReconcileService } = await import('./src/components/services/RobustReconcileService.jsx');
        
        // Get current wallet ID from the app
        const walletId = 'current-wallet'; // This would need to be dynamically determined
        
        const result = await robustReconcileService.reconcileWithBinance(tradingMode, walletId);
        
        console.log('📊 Manual reconciliation result:', result);
        
        return result;
        
    } catch (error) {
        console.error('❌ Manual reconciliation failed:', error);
        return { success: false, error: error.message };
    }
};

// Reset reconciliation attempts
window.resetReconcileAttempts = function(tradingMode = 'testnet', walletId = 'current-wallet') {
    console.log(`🔄 Resetting reconciliation attempts for ${tradingMode}/${walletId}...`);
    
    import('./src/components/services/RobustReconcileService.jsx').then(({ robustReconcileService }) => {
        robustReconcileService.resetAttempts(tradingMode, walletId);
        console.log('✅ Attempts reset successfully');
    }).catch(error => {
        console.error('❌ Failed to reset attempts:', error);
    });
};

console.log('🧪 RobustReconcileService test functions loaded:');
console.log('  - testRobustReconcile() - Run full test');
console.log('  - manualReconcile(tradingMode) - Manual reconciliation');
console.log('  - resetReconcileAttempts(tradingMode, walletId) - Reset attempts');
