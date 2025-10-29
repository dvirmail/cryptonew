/**
 * Browser-side script to clear all cached data
 * Run this in the browser console (F12)
 */

console.log('🧹 Starting browser data cleanup...');

// Clear localStorage
try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
            key.includes('position') || 
            key.includes('trade') || 
            key.includes('wallet') ||
            key.includes('LivePosition') ||
            key.includes('Trade') ||
            key.includes('WalletSummary') ||
            key.includes('LiveWalletState')
        )) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(key => {
        console.log(`   🗑️  Removing: ${key}`);
        localStorage.removeItem(key);
    });
    
    console.log(`✅ Cleared ${keysToRemove.length} localStorage keys`);
} catch (error) {
    console.error('❌ Error clearing localStorage:', error);
}

// Clear sessionStorage
try {
    sessionStorage.clear();
    console.log('✅ Cleared sessionStorage');
} catch (error) {
    console.error('❌ Error clearing sessionStorage:', error);
}

// Clear IndexedDB if available
if (window.indexedDB) {
    console.log('ℹ️  IndexedDB detected - you may need to clear it manually from DevTools');
}

console.log('✅ Browser cleanup complete!');
console.log('🔄 Please refresh the page (hard refresh: Cmd+Shift+R or Ctrl+Shift+R)');

