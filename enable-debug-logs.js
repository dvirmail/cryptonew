// Enable debug logs for API queue and dust workflow
console.log('🔧 Enabling debug logs...');

// Enable API queue debug logs
if (typeof window !== 'undefined') {
    window.DEBUG_API_QUEUE = true;
    localStorage.setItem('debug_api_queue', '1');
    console.log('✅ DEBUG_API_QUEUE enabled');
}

// Enable trade debug logs
if (typeof window !== 'undefined') {
    window.DEBUG_TRADE_LOGS = true;
    localStorage.setItem('debug_trade', '1');
    console.log('✅ DEBUG_TRADE_LOGS enabled');
}

console.log('🎯 Debug logs enabled! Refresh the page to see dust workflow logs.');
