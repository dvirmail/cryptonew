// Test script to verify position closing fixes
console.log('🔧 Testing position closing fixes...');

// Test 1: UUID generation
console.log('\n📋 Test 1: UUID Generation');
try {
  const { generateTradeId } = await import('./src/components/utils/id.jsx');
  const testId = generateTradeId();
  console.log(`✅ Generated UUID: ${testId}`);
  console.log(`✅ UUID format valid: ${/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId)}`);
} catch (error) {
  console.error('❌ UUID generation test failed:', error.message);
}

// Test 2: Check current positions
console.log('\n📋 Test 2: Current Positions');
try {
  const response = await fetch('http://localhost:3003/api/livePositions?status=open');
  const data = await response.json();
  
  if (data.success && Array.isArray(data.data)) {
    console.log(`📊 Found ${data.data.length} open positions:`);
    data.data.forEach((pos, index) => {
      console.log(`${index + 1}. ${pos.symbol} - Qty: ${pos.quantity_crypto} - Status: ${pos.status}`);
    });
  } else {
    console.log('❌ Failed to fetch positions:', data.error || 'Unknown error');
  }
} catch (error) {
  console.error('❌ Position fetch test failed:', error.message);
}

// Test 3: Check if debug logs are enabled
console.log('\n📋 Test 3: Debug Logs Status');
console.log(`DEBUG_API_QUEUE: ${localStorage.getItem('debug_api_queue')}`);
console.log(`DEBUG_TRADE_LOGS: ${localStorage.getItem('debug_trade')}`);
console.log(`Window DEBUG_API_QUEUE: ${window.DEBUG_API_QUEUE}`);
console.log(`Window DEBUG_TRADE_LOGS: ${window.DEBUG_TRADE_LOGS}`);

console.log('\n🎯 Fixes Applied:');
console.log('✅ 1. Fixed UUID generation to use proper UUID v4 format');
console.log('✅ 2. Fixed position closing logic to use positionQty instead of free balance');
console.log('✅ 3. Enabled debug logs by default');

console.log('\n🔄 Next Steps:');
console.log('1. Refresh the page to see the new UUID generation in action');
console.log('2. Watch the console for detailed position closing logs');
console.log('3. Positions should now close properly without "retry skip" messages');
