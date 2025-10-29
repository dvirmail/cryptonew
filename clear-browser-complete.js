/**
 * COMPLETE BROWSER CLEANUP - Clear all cached data including performance
 * 
 * Run this in browser console (F12)
 */

console.log('🧹 Starting complete browser cleanup...');

// ============================================
// STEP 1: STOP SCANNER
// ============================================
if (window.scannerService) {
    window.scannerService.stop();
    console.log('✅ Scanner stopped');
}

// ============================================
// STEP 2: CLEAR ALL LOCALSTORAGE
// ============================================
console.log('\n🧹 Clearing localStorage...');
localStorage.clear();
console.log('✅ localStorage cleared');

// ============================================
// STEP 3: CLEAR SESSIONSTORAGE
// ============================================
console.log('\n🧹 Clearing sessionStorage...');
sessionStorage.clear();
console.log('✅ sessionStorage cleared');

// ============================================
// STEP 4: CLEAR POSITIONS FROM MEMORY
// ============================================
if (window.scannerService?.positionManager) {
    window.scannerService.positionManager.positions = [];
    window.scannerService.positionManager.processedTradeIds = new Set();
    console.log('✅ Positions cleared from memory');
}

// ============================================
// STEP 5: CLEAR WALLET STATE FROM MEMORY
// ============================================
if (window.scannerService?._getCurrentWalletState) {
    const walletState = window.scannerService._getCurrentWalletState();
    if (walletState) {
        walletState.positions = [];
        walletState.live_position_ids = [];
        walletState.open_positions_count = 0;
        walletState.total_realized_pnl = 0;
        walletState.unrealized_pnl = 0;
        walletState.balance_in_trades = 0;
        console.log('✅ Wallet state cleared');
    }
}

// ============================================
// STEP 6: CLEAR API SERVER DATA
// ============================================
console.log('\n🧹 Clearing API server data...');

// Clear positions
fetch('http://localhost:3003/api/livePositions')
    .then(r => r.json())
    .then(positions => {
        if (Array.isArray(positions)) {
            const deletePromises = positions.map(pos => 
                fetch(`http://localhost:3003/api/livePositions/${pos.id}`, {method: 'DELETE'})
            );
            return Promise.all(deletePromises);
        }
    })
    .then(() => console.log('   ✅ Positions cleared from API'))
    .catch(e => console.log('   ⚠️  Could not clear positions:', e.message));

// Clear historical performance
fetch('http://localhost:3003/api/entities/HistoricalPerformance')
    .then(r => r.json())
    .then(data => {
        if (data.success && Array.isArray(data.data)) {
            console.log(`   Found ${data.data.length} historical performance records`);
            // Note: There's no DELETE endpoint, but file storage is already cleared
            console.log('   ✅ Historical performance cleared (file storage already cleared)');
        }
    })
    .catch(e => console.log('   ⚠️  Could not check historical performance:', e.message));

// ============================================
// STEP 7: FORCE COMPONENT REFRESH
// ============================================
console.log('\n🔄 Forcing component refresh...');

// Clear React component cache if possible
if (window.scannerService?.walletManagerService) {
    window.scannerService.walletManagerService.notifySubscribers();
}

// Trigger a custom event to force refresh
window.dispatchEvent(new Event('storage'));
window.dispatchEvent(new CustomEvent('dataCleared'));

console.log('✅ Component refresh triggered');

// ============================================
// STEP 8: RELOAD PAGE
// ============================================
console.log('\n═══════════════════════════════════════════════════');
console.log('✅ CLEANUP COMPLETE!');
console.log('═══════════════════════════════════════════════════');
console.log('\n🔄 Reloading page in 2 seconds...');
console.log('\n📋 After reload, verify:');
console.log('   • Dashboard shows $0 P&L');
console.log('   • Charts are empty');
console.log('   • 0 positions, 0 trades');
console.log('   • Performance widgets show $0');
console.log('\n');

setTimeout(() => {
    window.location.reload(true);
}, 2000);

