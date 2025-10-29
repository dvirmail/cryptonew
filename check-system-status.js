/**
 * System Status Check - Confirm Only New Functions Are Active
 * Run this in the browser console to verify the system state
 */

window.checkSystemStatus = async function() {
    console.log('🔍 Checking System Status...');
    console.log('=====================================');
    
    const status = {
        reconcileFunctions: {
            newRobustReconcile: false,
            oldBackendReconcile: false,
            positionManagerReconcile: false
        },
        walletStateManagers: {
            centralWalletStateManager: false,
            oldWalletProvider: false,
            walletManagerService: false
        },
        activeServices: [],
        issues: []
    };
    
    try {
        // Check RobustReconcileService
        try {
            const { robustReconcileService } = await import('./src/components/services/RobustReconcileService.jsx');
            status.reconcileFunctions.newRobustReconcile = true;
            console.log('✅ RobustReconcileService: ACTIVE');
        } catch (error) {
            console.log('❌ RobustReconcileService: NOT FOUND');
            status.issues.push('RobustReconcileService not found');
        }
        
        // Check CentralWalletStateManager
        try {
            const centralWalletStateManager = await import('./src/components/services/CentralWalletStateManager.jsx');
            status.walletStateManagers.centralWalletStateManager = true;
            console.log('✅ CentralWalletStateManager: ACTIVE');
        } catch (error) {
            console.log('❌ CentralWalletStateManager: NOT FOUND');
            status.issues.push('CentralWalletStateManager not found');
        }
        
        // Check if old backend reconcile is still being called
        const apiQueueCode = await fetch('./src/components/utils/apiQueue.jsx').then(r => r.text());
        if (apiQueueCode.includes('base44.functions.invoke(\'walletReconciliation\'')) {
            status.reconcileFunctions.oldBackendReconcile = true;
            console.log('⚠️ Old Backend Reconcile: STILL REFERENCED in apiQueue.jsx');
            status.issues.push('Old backend reconcile still referenced in apiQueue.jsx');
        } else {
            console.log('✅ Old Backend Reconcile: NOT REFERENCED - Successfully removed!');
        }
        
        // Check PositionManager reconcile method
        const positionManagerCode = await fetch('./src/components/services/PositionManager.jsx').then(r => r.text());
        if (positionManagerCode.includes('reconcileWithBinance()')) {
            status.reconcileFunctions.positionManagerReconcile = true;
            console.log('✅ PositionManager reconcileWithBinance: ACTIVE');
        } else {
            console.log('❌ PositionManager reconcileWithBinance: NOT FOUND');
            status.issues.push('PositionManager reconcileWithBinance not found');
        }
        
        // Check WalletProvider
        const walletProviderCode = await fetch('./src/components/providers/WalletProvider.jsx').then(r => r.text());
        if (walletProviderCode.includes('centralWalletStateManager')) {
            status.walletStateManagers.oldWalletProvider = true;
            console.log('✅ WalletProvider: USING CentralWalletStateManager');
        } else {
            console.log('❌ WalletProvider: NOT USING CentralWalletStateManager');
            status.issues.push('WalletProvider not using CentralWalletStateManager');
        }
        
        // Check WalletManagerService
        const walletManagerCode = await fetch('./src/components/services/WalletManagerService.jsx').then(r => r.text());
        if (walletManagerCode.includes('centralWalletStateManager')) {
            status.walletStateManagers.walletManagerService = true;
            console.log('✅ WalletManagerService: USING CentralWalletStateManager');
        } else {
            console.log('❌ WalletManagerService: NOT USING CentralWalletStateManager');
            status.issues.push('WalletManagerService not using CentralWalletStateManager');
        }
        
        // Check for active services
        if (window.centralWalletState) {
            status.activeServices.push('CentralWalletStateManager (window.centralWalletState)');
            console.log('✅ CentralWalletStateManager: AVAILABLE in window');
        }
        
        if (window.cleanupGhostPositions) {
            status.activeServices.push('PositionManager reconcile (window.cleanupGhostPositions)');
            console.log('✅ PositionManager reconcile: AVAILABLE in window');
        }
        
        if (window.runComprehensiveWalletFix) {
            status.activeServices.push('ComprehensiveWalletFix (window.runComprehensiveWalletFix)');
            console.log('✅ ComprehensiveWalletFix: AVAILABLE in window');
        }
        
        console.log('=====================================');
        console.log('📊 SUMMARY:');
        console.log('=====================================');
        
        // Reconcile Functions Status
        console.log('🔄 RECONCILE FUNCTIONS:');
        console.log(`  ✅ New RobustReconcileService: ${status.reconcileFunctions.newRobustReconcile ? 'ACTIVE' : 'INACTIVE'}`);
        console.log(`  ${status.reconcileFunctions.oldBackendReconcile ? '⚠️' : '✅'} Old Backend Reconcile: ${status.reconcileFunctions.oldBackendReconcile ? 'STILL REFERENCED' : 'NOT REFERENCED'}`);
        console.log(`  ✅ PositionManager reconcileWithBinance: ${status.reconcileFunctions.positionManagerReconcile ? 'ACTIVE' : 'INACTIVE'}`);
        
        // Wallet State Managers Status
        console.log('💰 WALLET STATE MANAGERS:');
        console.log(`  ✅ CentralWalletStateManager: ${status.walletStateManagers.centralWalletStateManager ? 'ACTIVE' : 'INACTIVE'}`);
        console.log(`  ✅ WalletProvider: ${status.walletStateManagers.oldWalletProvider ? 'USING CentralWalletStateManager' : 'NOT USING CentralWalletStateManager'}`);
        console.log(`  ✅ WalletManagerService: ${status.walletStateManagers.walletManagerService ? 'USING CentralWalletStateManager' : 'NOT USING CentralWalletStateManager'}`);
        
        // Active Services
        console.log('🔧 ACTIVE SERVICES:');
        status.activeServices.forEach(service => {
            console.log(`  ✅ ${service}`);
        });
        
        // Issues
        if (status.issues.length > 0) {
            console.log('⚠️ ISSUES FOUND:');
            status.issues.forEach(issue => {
                console.log(`  ❌ ${issue}`);
            });
        } else {
            console.log('✅ NO ISSUES FOUND - System is properly configured!');
        }
        
        console.log('=====================================');
        
        // Recommendations
        if (status.reconcileFunctions.oldBackendReconcile) {
            console.log('🔧 RECOMMENDATIONS:');
            console.log('  1. Remove old backend reconcile reference from apiQueue.jsx');
            console.log('  2. Ensure only RobustReconcileService is used for reconciliation');
        }
        
        return status;
        
    } catch (error) {
        console.error('❌ Error checking system status:', error);
        return { error: error.message };
    }
};

// Auto-run the check
console.log('🧪 System Status Check loaded. Run window.checkSystemStatus() to check the system.');
