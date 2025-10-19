// Progressive counter for trade IDs (persists in memory during session)
let tradeCounter = parseInt(localStorage.getItem('tradeCounter') || '0');

// TEMP: Track all generated IDs for duplicate detection
const generatedTradeIds = new Set();

export function generateTradeId() {
  // Increment counter
  tradeCounter++;
  
  // Store updated counter in localStorage for persistence across page reloads
  localStorage.setItem('tradeCounter', tradeCounter.toString());
  
  // Format: <milliseconds_since_epoch>-<4_digit_random>-<5_digit_progressive>
  const ms = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const progressive = tradeCounter.toString().padStart(5, '0');
  
  const newId = `${ms}-${rand}-${progressive}`;
  
  // TEMP: Check for duplicates in this session
  if (generatedTradeIds.has(newId)) {
    console.error(`[ID_GENERATION] 🚨 DUPLICATE ID GENERATED: ${newId}`);
    console.error(`[ID_GENERATION] This should NEVER happen! Current counter: ${tradeCounter}, MS: ${ms}, Random: ${rand}`);
  } else {
    generatedTradeIds.add(newId);
  }
  
  //console.log(`[ID_GENERATION] ✅ Generated new trade ID: ${newId} (Counter: ${tradeCounter}, Session IDs: ${generatedTradeIds.size})`);
  
  return newId;
}

// Export function to get current counter (for debugging)
export function getCurrentTradeCounter() {
  return tradeCounter;
}

// Export function to reset counter (for debugging/testing)
export function resetTradeCounter() {
  tradeCounter = 0;
  generatedTradeIds.clear();
  localStorage.setItem('tradeCounter', '0');
  console.log('[ID_GENERATION] Trade counter and session cache reset to 0');
}

// TEMP: Export function to check if ID was generated in this session
export function wasIdGeneratedInSession(tradeId) {
  return generatedTradeIds.has(tradeId);
}