// Progressive counter for trade IDs (persists in memory during session)
let tradeCounter = parseInt(localStorage.getItem('tradeCounter') || '0');

// TEMP: Track all generated IDs for duplicate detection
const generatedTradeIds = new Set();

export function generateTradeId() {
  // Generate a proper UUID v4
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  // Increment counter for tracking
  tradeCounter++;
  localStorage.setItem('tradeCounter', tradeCounter.toString());
  
  // TEMP: Check for duplicates in this session
  if (generatedTradeIds.has(uuid)) {
    console.error(`[ID_GENERATION] 🚨 DUPLICATE UUID GENERATED: ${uuid}`);
  } else {
    generatedTradeIds.add(uuid);
  }
  
  return uuid;
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