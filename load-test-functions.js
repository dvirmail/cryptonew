// Quick loader script - copy and paste this into browser console to load the test functions

(function() {
    const script = document.createElement('script');
    script.src = 'http://localhost:3003/test-position-data.js';
    script.onload = function() {
        console.log('✅ Position data test functions loaded successfully!');
        console.log('🚀 Run testPositionData() to start testing!');
    };
    script.onerror = function() {
        console.log('❌ Failed to load test functions. Make sure proxy server is running.');
        console.log('💡 Alternative: Copy the test function code directly into console');
    };
    document.head.appendChild(script);
})();
