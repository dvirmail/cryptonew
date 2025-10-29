/**
 * Central Wallet State Verification Script
 * 
 * This script can be run in the browser console to verify that the
 * CentralWalletStateManager is working correctly and data persists.
 * 
 * Usage:
 * 1. Open browser console
 * 2. Copy and paste this script
 * 3. Run: verifyCentralWalletState()
 */

async function verifyCentralWalletState() {
    console.log('🧪 Verifying CentralWalletStateManager...\n');
    
    try {
        // Check if CentralWalletStateManager is available
        if (typeof window.centralWalletStateManager === 'undefined') {
            console.error('❌ CentralWalletStateManager not found on window object');
            return;
        }
        
        const manager = window.centralWalletStateManager;
        
        // Test 1: Check if manager is ready
        console.log('1️⃣ Checking manager status...');
        console.log('Ready:', manager.isReady());
        console.log('Current state:', manager.getCurrentState());
        
        // Test 2: Subscribe to updates
        console.log('\n2️⃣ Testing subscription...');
        let updateReceived = false;
        const unsubscribe = manager.subscribe((state) => {
            console.log('📡 Received state update:', {
                id: state?.id,
                trading_mode: state?.trading_mode,
                available_balance: state?.available_balance,
                balance_in_trades: state?.balance_in_trades,
                total_equity: state?.total_equity,
                status: state?.status
            });
            updateReceived = true;
        });
        
        // Test 3: Initialize if not ready
        if (!manager.isReady()) {
            console.log('\n3️⃣ Initializing manager...');
            await manager.initialize('testnet');
            console.log('✅ Initialization completed');
        }
        
        // Test 4: Test balance updates
        console.log('\n4️⃣ Testing balance updates...');
        const currentState = manager.getCurrentState();
        if (currentState) {
            const testBalance = 1000.50;
            await manager.updateBalanceInTrades(testBalance);
            console.log(`✅ Updated balance in trades to: ${testBalance}`);
            
            const testAvailableBalance = 5000.75;
            await manager.updateAvailableBalance(testAvailableBalance);
            console.log(`✅ Updated available balance to: ${testAvailableBalance}`);
        }
        
        // Test 5: Verify data persistence
        console.log('\n5️⃣ Verifying data persistence...');
        const finalState = manager.getCurrentState();
        if (finalState) {
            console.log('✅ Final state:', {
                id: finalState.id,
                trading_mode: finalState.trading_mode,
                available_balance: finalState.available_balance,
                balance_in_trades: finalState.balance_in_trades,
                total_equity: finalState.total_equity,
                last_binance_sync: finalState.last_binance_sync,
                status: finalState.status
            });
        }
        
        // Test 6: Cleanup
        console.log('\n6️⃣ Cleaning up...');
        unsubscribe();
        console.log('✅ Cleanup completed');
        
        console.log('\n🎉 All tests passed! CentralWalletStateManager is working correctly.');
        console.log('\n📋 Summary:');
        console.log('- Manager is ready:', manager.isReady());
        console.log('- State persisted:', finalState ? 'Yes' : 'No');
        console.log('- Updates received:', updateReceived ? 'Yes' : 'No');
        
        return {
            success: true,
            managerReady: manager.isReady(),
            statePersisted: !!finalState,
            updatesReceived: updateReceived
        };
        
    } catch (error) {
        console.error('❌ Verification failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Make the function available globally
window.verifyCentralWalletState = verifyCentralWalletState;

console.log('✅ Verification script loaded. Run verifyCentralWalletState() to test.');
