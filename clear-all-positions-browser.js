/**
 * COMPLETE POSITION CLEARING SOLUTION
 * 
 * Run these commands in the browser console (F12)
 * Copy and paste each section one at a time
 */

// ============================================
// STEP 1: STOP THE SCANNER FIRST
// ============================================
console.log('🛑 STEP 1: Stopping scanner...');
if (window.scannerService) {
    window.scannerService.stop();
    console.log('✅ Scanner stopped');
} else {
    console.log('⚠️ Scanner service not found - may already be stopped');
}

// ============================================
// STEP 2: CLEAR ALL POSITIONS FROM MEMORY
// ============================================
console.log('\n🧹 STEP 2: Clearing positions from memory...');
if (window.scannerService && window.scannerService.positionManager) {
    window.scannerService.positionManager.positions = [];
    window.scannerService.positionManager.processedTradeIds = new Set();
    console.log('✅ Positions cleared from PositionManager memory');
} else {
    console.log('⚠️ PositionManager not found');
}

// Clear from wallet state
if (window.scannerService && window.scannerService._getCurrentWalletState) {
    const walletState = window.scannerService._getCurrentWalletState();
    if (walletState) {
        walletState.positions = [];
        walletState.live_position_ids = [];
        walletState.open_positions_count = 0;
        console.log('✅ Positions cleared from wallet state');
    }
}

// ============================================
// STEP 3: CLEAR LOCALSTORAGE
// ============================================
console.log('\n🧹 STEP 3: Clearing localStorage...');
const keysToRemove = [];
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
        key.toLowerCase().includes('position') || 
        key.toLowerCase().includes('trade') || 
        key.toLowerCase().includes('wallet') ||
        key.toLowerCase().includes('liveposition') ||
        key.toLowerCase().includes('trades') ||
        key.toLowerCase().includes('walletsummary')
    )) {
        keysToRemove.push(key);
    }
}

keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    console.log(`   🗑️  Removed: ${key}`);
});

console.log(`✅ Cleared ${keysToRemove.length} localStorage keys`);

// ============================================
// STEP 4: CLEAR SESSIONSTORAGE
// ============================================
console.log('\n🧹 STEP 4: Clearing sessionStorage...');
sessionStorage.clear();
console.log('✅ SessionStorage cleared');

// ============================================
// STEP 5: CLEAR POSITIONS FROM API SERVER
// ============================================
console.log('\n🧹 STEP 5: Clearing positions from API server...');
fetch('http://localhost:3003/api/livePositions', {
    method: 'GET'
})
.then(res => res.json())
.then(data => {
    if (Array.isArray(data)) {
        console.log(`   Found ${data.length} positions on server`);
        // Delete each position
        const deletePromises = data.map(pos => 
            fetch(`http://localhost:3003/api/livePositions/${pos.id}`, {
                method: 'DELETE'
            })
        );
        return Promise.all(deletePromises);
    }
})
.then(() => {
    console.log('✅ Positions cleared from API server');
})
.catch(error => {
    console.log('⚠️ Could not clear API server positions:', error.message);
});

// ============================================
// STEP 6: FORCE UI UPDATE
// ============================================
console.log('\n🔄 STEP 6: Refreshing UI...');
setTimeout(() => {
    window.location.reload(true);
}, 2000);

console.log('\n✅ CLEANUP COMPLETE!');
console.log('🔄 Page will refresh in 2 seconds...');
console.log('\n📋 NEXT STEPS:');
console.log('   1. After refresh, verify positions are gone');
console.log('   2. Restart proxy server: node proxy-server.cjs');
console.log('   3. DO NOT start scanner until you want to reload positions from Binance');

