// Test script to verify position closing fix
console.log('🔧 Testing position closing fix...');

// Enable debug logs
if (typeof window !== 'undefined') {
  localStorage.setItem('debug_api_queue', '1');
  localStorage.setItem('debug_trade', '1');
  window.DEBUG_API_QUEUE = true;
  window.DEBUG_TRADE_LOGS = true;
  console.log('✅ Debug logs enabled');
} else {
  console.log('⚠️ Run this in browser console');
}

// Check if positions are being processed
console.log('🔍 Checking current positions...');

// Function to check positions via API
async function checkPositions() {
  try {
    const response = await fetch('http://localhost:3003/api/livePositions?status=open');
    const data = await response.json();
    
    if (data.success && Array.isArray(data.data)) {
      console.log(`📊 Found ${data.data.length} open positions:`);
      data.data.forEach((pos, index) => {
        console.log(`${index + 1}. ${pos.symbol} - ${pos.quantity_crypto} (ID: ${pos.id})`);
      });
      return data.data.length;
    } else {
      console.log('❌ Failed to fetch positions:', data);
      return 0;
    }
  } catch (error) {
    console.error('❌ Error fetching positions:', error);
    return -1;
  }
}

// Run the check
checkPositions().then(count => {
  if (count > 0) {
    console.log('🎯 Positions found - the scanner should attempt to close them');
    console.log('📝 Watch the console for [DUST_WORKFLOW_START] and [VIRTUAL_CLOSE_AFTER_DUST] logs');
  } else if (count === 0) {
    console.log('✅ No open positions found - system is clean');
  } else {
    console.log('❌ Could not check positions - check if proxy server is running');
  }
});

console.log('🔄 Refresh the page to see the debug logs in action');
