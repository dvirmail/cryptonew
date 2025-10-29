// Run this in the browser console to enable debug logs
console.log('🔧 Enabling debug logs...');

// Enable API queue debug logs
localStorage.setItem('debug_api_queue', '1');
window.DEBUG_API_QUEUE = true;

// Enable trade debug logs  
localStorage.setItem('debug_trade', '1');
window.DEBUG_TRADE_LOGS = true;

console.log('✅ Debug logs enabled!');
console.log('🔄 Refresh the page to see dust workflow logs.');
console.log('📊 You should now see [DUST_WORKFLOW_START], [VIRTUAL_CLOSE_AFTER_DUST], etc.');
