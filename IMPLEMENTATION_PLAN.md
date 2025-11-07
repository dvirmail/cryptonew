# Implementation Plan: Backtest Positions & Phase 1 Signal Upgrades

## Task A: Fix Backtest Positions Not Saved to PostgreSQL

### Current State Analysis

**Problem Identified:**
- Backtest matches are created in `BacktestingEngine.jsx` and processed in `backtestProcessor.jsx`
- Matches are stored in memory only (`this.allMatches` array)
- Matches are never saved as `Trade` records to PostgreSQL database
- Live trades use: `queueEntityCall('Trade', 'create', newTradeRecord)` with `trading_mode: 'testnet'|'live'`

**Root Cause:**
- Backtest engine only creates match objects for analysis
- No database persistence logic exists for backtest trades
- Backtest results only save `BacktestCombination` records (strategy configurations), not individual trades

### Solution Design

#### **1. Create Backtest Trade Saving Function**

**Location:** `src/components/backtesting/core/backtestTradeSaver.jsx` (new file)

```javascript
import { queueEntityCall } from '@/components/utils/apiQueue';
import { v4 as uuidv4 } from 'uuid';

/**
 * Saves a backtest match as a Trade record in PostgreSQL
 * Uses the same structure as live trades but with trading_mode='backtest'
 * 
 * @param {Object} match - Backtest match object from backtestProcessor
 * @param {Object} combination - BacktestCombination object (for strategy metadata)
 * @returns {Promise<Object>} Created trade record
 */
export async function saveBacktestTradeToDB(match, combination) {
    if (!match || !combination) {
        throw new Error('Match and combination are required');
    }

    // Calculate trade metrics from match
    const entryPrice = match.price;
    const exitPrice = match.price + (match.price * (match.priceMove / 100)); // Convert % move to price
    const quantityCrypto = 100 / entryPrice; // Standardized quantity for backtest (100 USDT position)
    const entryValueUSDT = 100; // Standardized for backtest
    const exitValueUSDT = exitPrice * quantityCrypto;
    const pnlUSDT = exitValueUSDT - entryValueUSDT;
    const pnlPercentage = match.priceMove; // Already in percentage

    // Calculate duration from match data
    const entryTimestamp = new Date(match.time);
    const exitTimestamp = match.exitTime ? new Date(match.exitTime) : new Date(entryTimestamp.getTime() + (match.timeToPeak || 3600) * 1000);
    const durationSeconds = Math.floor((exitTimestamp - entryTimestamp) / 1000);

    // Build trade record (matching live trade structure)
    const tradeRecord = {
        trade_id: uuidv4(),
        position_id: `backtest_${match.time}_${uuidv4().substring(0, 8)}`,
        
        // Basic trade info
        symbol: match.coin.replace('/', ''),
        side: 'BUY', // Backtest assumes long positions
        quantity_crypto: quantityCrypto,
        entry_price: entryPrice,
        exit_price: exitPrice,
        entry_value_usdt: entryValueUSDT,
        exit_value_usdt: exitValueUSDT,
        pnl_usdt: pnlUSDT,
        pnl_percentage: pnlPercentage,
        
        // Timestamps
        entry_timestamp: entryTimestamp.toISOString(),
        exit_timestamp: exitTimestamp.toISOString(),
        duration_seconds: durationSeconds,
        
        // Trading mode (CRITICAL: identifies as backtest)
        trading_mode: 'backtest',
        
        // Strategy metadata
        strategy_name: combination.combinationName || 'Unknown Strategy',
        trigger_signals: JSON.stringify(match.signals || []),
        combined_strength: match.combinedStrength || 0,
        
        // Market context
        market_regime: match.marketRegime || 'unknown',
        regime_confidence: 0.8, // Backtest has fixed confidence
        
        // Performance metrics
        exit_reason: match.successful ? 'Target Reached' : 'Stop Loss / Reversal',
        max_drawdown: match.maxDrawdown || 0,
        
        // Analytics fields (if available from match)
        fear_greed_score: null, // Not available in backtest
        fear_greed_classification: null,
        lpm_score: null,
        conviction_score: null,
        conviction_breakdown: null,
        conviction_multiplier: null,
        atr_value: null,
        is_event_driven_strategy: combination.is_event_driven_strategy || false,
        
        // Fees (standardized for backtest)
        total_fees_usdt: (entryValueUSDT + exitValueUSDT) * 0.001, // 0.1% fee
        commission_migrated: true
    };

    try {
        const createdTrade = await queueEntityCall('Trade', 'create', tradeRecord);
        console.log(`[BacktestTradeSaver] ✅ Saved backtest trade: ${tradeRecord.trade_id}`);
        return createdTrade;
    } catch (error) {
        console.error(`[BacktestTradeSaver] ❌ Failed to save backtest trade:`, error);
        throw error;
    }
}

/**
 * Batch saves multiple backtest matches as trades
 * @param {Array} matches - Array of match objects
 * @param {Object} combination - BacktestCombination object
 * @returns {Promise<Array>} Array of created trade records
 */
export async function saveBacktestTradesBatch(matches, combination) {
    if (!matches || matches.length === 0) {
        return [];
    }

    const savePromises = matches.map(match => 
        saveBacktestTradeToDB(match, combination).catch(error => {
            console.error(`[BacktestTradeSaver] Failed to save match:`, error);
            return null; // Return null for failed saves
        })
    );

    const results = await Promise.all(savePromises);
    const successful = results.filter(r => r !== null);
    
    console.log(`[BacktestTradeSaver] ✅ Saved ${successful.length}/${matches.length} backtest trades`);
    return successful;
}
```

#### **2. Integrate into Backtest Processing Pipeline**

**Location:** `src/pages/Backtesting.jsx`

**Modification Point:** After `processBacktestResults()` and before saving combinations

```javascript
// Add import
import { saveBacktestTradesBatch } from '@/components/backtesting/core/backtestTradeSaver';

// In runBacktest function, after finalMatches are processed:
if (finalMatches.length > 0 && finalCombinations.length > 0) {
    // ... existing code ...
    
    // ✅ NEW: Save backtest trades to database
    if (saveBacktestTrades) { // Add toggle in UI
        try {
            logCallback('💾 Saving backtest trades to database...', 'info');
            
            // Group matches by combination
            const matchesByCombination = {};
            finalMatches.forEach(match => {
                const comboKey = match.signals.map(s => `${s.type}:${s.value}`).sort().join('|');
                if (!matchesByCombination[comboKey]) {
                    matchesByCombination[comboKey] = {
                        matches: [],
                        combination: finalCombinations.find(c => 
                            c.signals.map(s => `${s.type}:${s.value}`).sort().join('|') === comboKey
                        )
                    };
                }
                matchesByCombination[comboKey].matches.push(match);
            });
            
            // Save trades for each combination
            let totalSaved = 0;
            for (const [key, { matches, combination }] of Object.entries(matchesByCombination)) {
                if (combination) {
                    const saved = await saveBacktestTradesBatch(matches, combination);
                    totalSaved += saved.length;
                }
            }
            
            logCallback(`✅ Saved ${totalSaved} backtest trades to database`, 'success');
        } catch (error) {
            console.error('[Backtesting] Failed to save backtest trades:', error);
            logCallback(`⚠️ Failed to save backtest trades: ${error.message}`, 'warning');
        }
    }
    
    // ... continue with existing saveCombinations logic ...
}
```

#### **3. Add UI Toggle for Saving Backtest Trades**

**Location:** `src/pages/Backtesting.jsx` (UI section)

```javascript
// Add state
const [saveBacktestTrades, setSaveBacktestTrades] = useState(false);

// Add UI control in settings section
<Switch
    id="save-backtest-trades"
    checked={saveBacktestTrades}
    onCheckedChange={setSaveBacktestTrades}
/>
<Label htmlFor="save-backtest-trades">
    Save backtest trades to database (for analytics)
</Label>
```

### Testing Plan

1. **Run backtest** with toggle ON
2. **Verify trades created** in database with `trading_mode='backtest'`
3. **Check trade structure** matches live trade structure
4. **Verify querying** backtest trades separately from live/testnet trades
5. **Check analytics** - backtest trades should appear in performance charts (filtered by trading_mode)

---

## Task B: Ensure Demo Scan Toggle Persistence

### Current State Analysis

**Existing Implementation:**
- Toggle handler: `handleToggleScanner()` in `BacktestDatabase.jsx` (line 121)
- Uses: `BacktestCombination.update(combinationId, { includedInScanner: newStatus })`
- UI updates immediately: `setCombinations(prev => prev.map(...))`

**Potential Issues:**
1. ✅ **Already Persistent** - `BacktestCombination.update()` saves to database
2. ⚠️ **Need to verify:** Database schema has `includedInScanner` column
3. ⚠️ **Need to verify:** Toggle state loads correctly on page refresh

### Verification & Fixes

#### **1. Verify Database Schema**

**Check:** Does `BacktestCombination` entity have `includedInScanner` field?

```sql
-- Check PostgreSQL schema
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'backtest_combinations' 
AND column_name = 'includedInScanner';
```

**If missing, add migration:**
```sql
ALTER TABLE backtest_combinations 
ADD COLUMN IF NOT EXISTS "includedInScanner" BOOLEAN DEFAULT false;

ALTER TABLE backtest_combinations 
ADD COLUMN IF NOT EXISTS "includedInLiveScanner" BOOLEAN DEFAULT false;
```

#### **2. Verify Load on Page Refresh**

**Location:** `src/pages/BacktestDatabase.jsx`

**Current Load Function:**
```javascript
const fetchCombinations = useCallback(async () => {
    setIsLoading(true);
    try {
        const data = await BacktestCombination.list();
        setCombinations(data);
        // ✅ Already loads from database - should persist
    } catch (error) {
        // error handling
    }
}, [toast]);
```

**✅ This looks correct** - loads from database, so persistence should work.

#### **3. Add Explicit Persistence Verification**

**Enhancement:** Add loading state and error handling for toggle

```javascript
const handleToggleScanner = async (combinationId, newStatus) => {
    try {
        // Optimistic UI update
        setCombinations(prev => prev.map(c =>
            c.id === combinationId ? { ...c, includedInScanner: newStatus } : c
        ));
        
        // Persist to database
        await BacktestCombination.update(combinationId, { includedInScanner: newStatus });
        
        toast({
            title: "Success",
            description: `Strategy ${newStatus ? 'enabled' : 'disabled'} for demo scanner (saved to database).`,
        });
    } catch (error) {
        // Revert optimistic update on error
        setCombinations(prev => prev.map(c =>
            c.id === combinationId ? { ...c, includedInScanner: !newStatus } : c
        ));
        
        console.error("Failed to update scanner status:", error);
        toast({
            title: "Error",
            description: "Could not update scanner status. Please try again.",
            variant: "destructive",
        });
    }
};
```

### Testing Plan

1. **Toggle demo scan ON** for a strategy
2. **Refresh page** - verify toggle remains ON
3. **Check database directly** - verify `includedInScanner = true`
4. **Close browser and reopen** - verify toggle persists
5. **Test bulk toggle** - verify all selected strategies persist

---

## Task C: Phase 1 Implementation Plan (Signal Upgrades)

### ⚠️ **CRITICAL: Signal Correlation Updates Required**

**IMPORTANT:** When implementing Phase 1 signal upgrades, we must ensure **proper correlation for all signals**. See `PHASE1_CORRELATION_UPDATE_PLAN.md` for detailed correlation requirements.

**Key Correlation Points:**
1. **Signal Capture:** New divergence signals must be captured during backtest
2. **Signal Grouping:** Combination names must include new signals
3. **Signal Storage:** Database combinations must store all detected signals
4. **Signal Matching:** Autoscanner must match new signals correctly
5. **Signal Normalization:** Consistent naming via signal name registry
6. **Correlation Updates:** Existing combinations may need updates

**See `PHASE1_CORRELATION_UPDATE_PLAN.md` for complete correlation implementation details.**

---

### Phase 1 Scope: MACD, MFI, OBV Divergence Upgrades

#### **Step 1: Update Signal Evaluation Functions**

**Files to Modify:**
1. `src/components/utils/signals/trendSignals.jsx` - `evaluateMacdCondition()`
2. `src/components/utils/signals/momentumSignals.jsx` - `evaluateMfiCondition()`
3. `src/components/utils/signals/volumeSignals.jsx` - `evaluateObvCondition()`

**Pattern (Following Safe Implementation Guide):**
```javascript
// ✅ ADDITIVE: Add divergence detection alongside existing signals
export const evaluateMacdCondition = (candle, indicators, index, signalSettings, marketRegime, onLog, debugMode) => {
    const signals = [];
    // ... existing code (PRESERVE ALL EXISTING SIGNALS) ...
    
    // ✅ NEW: MACD Histogram Divergence (ADDITIVE)
    try {
        if (index >= 50 && indicators.macd && indicators.data) {
            const priceData = indicators.data.slice(0, index + 1).map(c => c.close);
            const histogramData = indicators.macd.slice(0, index + 1).map(m => 
                m && typeof m === 'object' ? m.histogram : null
            ).filter(v => v !== null);
            
            if (priceData.length >= 50 && histogramData.length >= 50) {
                const divergence = detectAdvancedDivergence(
                    priceData,
                    histogramData,
                    index,
                    {
                        lookbackPeriod: 50,
                        minPeakDistance: 5,
                        maxPeakDistance: 60,
                        pivotLookback: 5,
                        minPriceMove: 0.02,
                        minOscillatorMove: 0.0001 // MACD histogram uses small values
                    }
                );
                
                if (divergence) {
                    signals.push({
                        type: 'MACD', // ✅ Same type as existing signals
                        value: `MACD Histogram ${divergence.type}`, // ✅ UNIQUE value (new signal)
                        strength: applyRegimeAdjustment(divergence.strength + 5, marketRegime, 'macd'),
                        details: divergence.description,
                        priority: 10, // High priority
                        isEvent: true,
                        candle: index
                    });
                }
            }
        }
    } catch (error) {
        if (onLog) onLog(`[MACD] Divergence detection error: ${error.message}`, 'warning');
    }
    
    return getUniqueSignals(signals);
};
```

#### **Step 2: Update Signal Name Mappings**

**Problem:** Signal `type` and `value` must match exactly between:
- Backtest: `evaluateSignalCondition()` returns signals
- Autoscanner: `evaluateSignalConditions()` matches signals by `type` and `value`

**Location:** `src/components/utils/signalLogic.jsx`

**Current Matching Logic:**
```javascript
// Line 301-304
const exactMatch = potentialSignals.find(p => 
    p.type === strategySignal.type && 
    p.value === strategySignal.value
);
```

**✅ Solution:** Ensure signal names are consistent

**Standardization Map:**
```javascript
// Signal type normalization (case-insensitive matching)
const normalizeSignalType = (type) => {
    const typeMap = {
        'macd': 'MACD',
        'rsi': 'RSI',
        'mfi': 'MFI',
        'obv': 'OBV',
        // ... etc
    };
    return typeMap[type.toLowerCase()] || type;
};

// Signal value normalization
const normalizeSignalValue = (type, value) => {
    // Ensure consistent naming between backtest and live
    if (type === 'MACD' && value.includes('Divergence')) {
        return value; // Keep as-is, new signals have unique values
    }
    return value;
};
```

#### **Step 3: Update Signal Correlations**

**Location:** Signal correlation likely stored in `BacktestCombination.signals` array

**Structure:**
```javascript
// BacktestCombination.signals format:
signals: [
    { type: 'MACD', value: 'Bullish Cross' },
    { type: 'RSI', value: 'Oversold Entry' },
    // NEW: Should include divergence signals
    { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' }
]
```

**Update Points:**
1. **Backtest save:** `src/pages/Backtesting.jsx` - `saveCombinations()` function
2. **Signal matching:** `src/components/utils/signalLogic.jsx` - `evaluateSignalConditions()`
3. **Strategy loading:** Ensure saved strategies include new signals

#### **Step 4: Build Mock Position for Testing**

**Location:** `src/components/backtesting/test/MockPositionBuilder.jsx` (new file)

```javascript
/**
 * Creates a mock position with Phase 1 upgraded signals for testing
 * This ensures autoscanner recognizes new divergence signals
 */
export function createMockPositionWithPhase1Signals() {
    return {
        id: 'mock_phase1_test',
        symbol: 'ETH/USDT',
        strategy: {
            combinationName: 'Phase 1 Test - MACD/MFI/OBV Divergence',
            coin: 'ETH/USDT',
            timeframe: '15m',
            signals: [
                // Existing signals
                { type: 'MACD', value: 'Bullish Cross' },
                { type: 'RSI', value: 'Oversold Exit' },
                { type: 'EMA', value: 'Price Above EMA' },
                
                // ✅ NEW Phase 1 Divergence Signals
                { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
                { type: 'MFI', value: 'MFI Regular Bullish Divergence' },
                { type: 'OBV', value: 'OBV Bullish Divergence' }
            ],
            includedInScanner: true,
            includedInLiveScanner: false
        },
        entry_price: 3800.00,
        quantity_crypto: 0.026,
        entry_value_usdt: 100,
        combined_strength: 650,
        conviction_score: 75,
        trigger_signals: JSON.stringify([
            { type: 'MACD', value: 'Bullish Cross', strength: 80 },
            { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence', strength: 90 },
            { type: 'MFI', value: 'MFI Regular Bullish Divergence', strength: 85 },
            { type: 'OBV', value: 'OBV Bullish Divergence', strength: 85 }
        ]),
        trading_mode: 'testnet'
    };
}

/**
 * Tests signal matching with Phase 1 signals
 * Verifies autoscanner recognizes new divergence signals
 */
export async function testPhase1SignalMatching() {
    const mockPosition = createMockPositionWithPhase1Signals();
    const strategy = mockPosition.strategy;
    
    // Simulate signal evaluation
    const mockKlines = [/* ... mock kline data ... */];
    const mockIndicators = {
        macd: [/* ... MACD data ... */],
        mfi: [/* ... MFI data ... */],
        obv: [/* ... OBV data ... */],
        data: mockKlines
    };
    
    // Test evaluateSignalConditions
    const { evaluateSignalConditions } = require('@/components/utils/signalLogic');
    const result = evaluateSignalConditions(strategy, mockIndicators, mockKlines);
    
    // Verify all signals matched (including new divergence signals)
    const matchedSignalValues = result.matchedSignals.map(s => s.value);
    
    console.log('✅ Phase 1 Signal Matching Test:');
    console.log('Expected signals:', strategy.signals.map(s => s.value));
    console.log('Matched signals:', matchedSignalValues);
    
    const allMatched = strategy.signals.every(expectedSignal => 
        matchedSignalValues.some(matched => 
            matched === expectedSignal.value || 
            matched.includes(expectedSignal.value)
        )
    );
    
    if (allMatched) {
        console.log('✅ All Phase 1 signals recognized correctly!');
    } else {
        console.error('❌ Some Phase 1 signals not recognized');
        const missing = strategy.signals.filter(expected => 
            !matchedSignalValues.some(matched => 
                matched === expected.value || matched.includes(expected.value)
            )
        );
        console.error('Missing signals:', missing);
    }
    
    return allMatched;
}
```

#### **Step 5: Update Signal Name Registry**

**Location:** `src/components/utils/signalSettings.jsx` or new file `signalNameRegistry.jsx`

```javascript
/**
 * Centralized signal name registry
 * Ensures consistent naming between backtest and autoscanner
 */
export const SIGNAL_NAME_REGISTRY = {
    MACD: {
        'Bullish Cross': 'Bullish Cross', // Existing
        'Bearish Cross': 'Bearish Cross', // Existing
        'MACD Histogram Regular Bullish Divergence': 'MACD Histogram Regular Bullish Divergence', // NEW
        'MACD Histogram Regular Bearish Divergence': 'MACD Histogram Regular Bearish Divergence', // NEW
        'MACD Histogram Hidden Bullish Divergence': 'MACD Histogram Hidden Bullish Divergence', // NEW
        'MACD Histogram Hidden Bearish Divergence': 'MACD Histogram Hidden Bearish Divergence', // NEW
    },
    MFI: {
        'Oversold Entry': 'Oversold Entry', // Existing
        'Overbought Exit': 'Overbought Exit', // Existing
        'MFI Regular Bullish Divergence': 'MFI Regular Bullish Divergence', // NEW
        'MFI Regular Bearish Divergence': 'MFI Regular Bearish Divergence', // NEW
        'MFI Failure Swing Bullish': 'MFI Failure Swing Bullish', // NEW
        'MFI Failure Swing Bearish': 'MFI Failure Swing Bearish', // NEW
    },
    OBV: {
        'OBV Trend Cross Bullish': 'OBV Trend Cross Bullish', // Existing
        'OBV Trend Cross Bearish': 'OBV Trend Cross Bearish', // Existing
        'OBV Bullish Divergence': 'OBV Bullish Divergence', // NEW
        'OBV Bearish Divergence': 'OBV Bearish Divergence', // NEW
    }
};

/**
 * Normalizes signal name for matching
 */
export function normalizeSignalName(type, value) {
    const registry = SIGNAL_NAME_REGISTRY[type.toUpperCase()];
    if (registry && registry[value]) {
        return registry[value]; // Return canonical name
    }
    return value; // Return as-is if not in registry
}

/**
 * Validates signal name exists in registry
 */
export function isValidSignalName(type, value) {
    const registry = SIGNAL_NAME_REGISTRY[type.toUpperCase()];
    if (!registry) return false;
    return registry.hasOwnProperty(value);
}
```

#### **Step 6: Update Signal Matching Logic**

**Location:** `src/components/utils/signalLogic.jsx`

**Enhance `evaluateSignalConditions()` to handle new signals:**

```javascript
export const evaluateSignalConditions = (strategy, indicators, klines) => {
    // ... existing code ...
    
    for (const strategySignal of strategy.signals) {
        const signalKeyLowercase = strategySignal.type.toLowerCase();
        
        // ... existing evaluation ...
        
        const potentialSignals = evaluateSignalCondition(
            candle,
            indicators,
            evaluationIndex,
            signalSettingsForDispatcher,
            { regime: 'neutral' },
            () => {}
        );
        
        // ✅ ENHANCED: Case-insensitive and partial matching for new signals
        const exactMatch = potentialSignals.find(p => {
            const typeMatch = p.type?.toLowerCase() === strategySignal.type?.toLowerCase();
            const valueMatch = p.value === strategySignal.value || 
                              p.value?.includes(strategySignal.value) || // Partial match for divergences
                              normalizeSignalName(p.type, p.value) === normalizeSignalName(strategySignal.type, strategySignal.value);
            return typeMatch && valueMatch;
        });
        
        // ... rest of matching logic ...
    }
};
```

#### **Step 7: Testing Strategy**

**Test Plan:**

1. **Unit Test: Signal Evaluation**
   ```javascript
   // Test MACD divergence signal generation
   const signals = evaluateMacdCondition(candle, indicators, index, settings, regime, onLog);
   expect(signals.some(s => s.value === 'MACD Histogram Regular Bullish Divergence')).toBe(true);
   ```

2. **Integration Test: Signal Matching**
   ```javascript
   // Test that saved strategy with divergence signals matches correctly
   const strategy = { signals: [
       { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' }
   ]};
   const result = evaluateSignalConditions(strategy, indicators, klines);
   expect(result.isMatch).toBe(true);
   ```

3. **E2E Test: Autoscanner Recognition**
   ```javascript
   // Create mock position with Phase 1 signals
   const mockPosition = createMockPositionWithPhase1Signals();
   // Verify autoscanner detects all signals (not "not found")
   ```

4. **Backtest Test: Signal Correlation**
   ```javascript
   // Run backtest with Phase 1 signals enabled
   // Verify new divergence signals appear in results
   // Verify saved combinations include divergence signals
   ```

### Phase 1 Implementation Checklist

- [ ] **1. Update MACD evaluation** (`trendSignals.jsx`)
  - [ ] Add histogram divergence detection
  - [ ] Preserve existing signals
  - [ ] Use `detectAdvancedDivergence`
  - [ ] Add error handling

- [ ] **2. Update MFI evaluation** (`momentumSignals.jsx`)
  - [ ] Replace simplified divergence with `detectAdvancedDivergence`
  - [ ] Add failure swing detection
  - [ ] Preserve existing signals

- [ ] **3. Update OBV evaluation** (`volumeSignals.jsx`)
  - [ ] Wire up existing `findDivergence` helper
  - [ ] Add divergence signals to output
  - [ ] Preserve existing signals

- [ ] **4. Create signal name registry** (`signalNameRegistry.jsx`)
  - [ ] Define canonical signal names
  - [ ] Add normalization functions
  - [ ] Add validation functions

- [ ] **5. Update signal matching logic** (`signalLogic.jsx`)
  - [ ] Add case-insensitive matching
  - [ ] Add partial matching for divergence signals
  - [ ] Use signal name registry

- [ ] **6. Build mock position builder** (`test/MockPositionBuilder.jsx`)
  - [ ] Create mock position with Phase 1 signals
  - [ ] Create test function
  - [ ] Verify signal matching

- [ ] **7. Update backtest save logic** (`Backtesting.jsx`)
  - [ ] Ensure new signals saved in combinations
  - [ ] Verify signal correlation updates

- [ ] **8. Test suite**
  - [ ] Unit tests for each indicator
  - [ ] Integration test for signal matching
  - [ ] E2E test with mock position
  - [ ] Backtest with Phase 1 signals

### Expected New Signal Values (Phase 1)

**MACD:**
- `MACD Histogram Regular Bullish Divergence`
- `MACD Histogram Regular Bearish Divergence`
- `MACD Histogram Hidden Bullish Divergence`
- `MACD Histogram Hidden Bearish Divergence`

**MFI:**
- `MFI Regular Bullish Divergence`
- `MFI Regular Bearish Divergence`
- `MFI Failure Swing Bullish`
- `MFI Failure Swing Bearish`

**OBV:**
- `OBV Bullish Divergence`
- `OBV Bearish Divergence`

**Total:** 10 new signal values (all additive, no existing signals modified)

---

## Implementation Order

### **Priority 1: Fix Backtest Positions (Task A)**
**Impact:** High - Enables backtest trade analytics  
**Risk:** Low - Additive functionality  
**Time:** 2-3 hours

### **Priority 2: Verify Demo Toggle (Task B)**
**Impact:** Medium - User experience  
**Risk:** Very Low - Verification only  
**Time:** 30 minutes

### **Priority 3: Phase 1 Implementation (Task C)**
**Impact:** Very High - Signal quality improvement  
**Risk:** Medium - Requires careful testing  
**Time:** 6-8 hours

---

## Risk Mitigation

### **Backward Compatibility**
- ✅ All existing signals preserved
- ✅ New signals have unique values
- ✅ No breaking changes to function signatures
- ✅ Database schema supports new fields

### **Testing Strategy**
- ✅ Unit tests for each indicator upgrade
- ✅ Integration test for signal matching
- ✅ Mock position test for autoscanner
- ✅ Backtest regression test

### **Rollback Plan**
- ✅ Git commit after each task
- ✅ Feature flag for Phase 1 signals (optional)
- ✅ Database migration can be reversed

---

## Success Criteria

### **Task A: Backtest Positions**
- ✅ Backtest trades saved to PostgreSQL with `trading_mode='backtest'`
- ✅ Trades queryable separately from live/testnet trades
- ✅ Trade structure matches live trade structure

### **Task B: Demo Toggle**
- ✅ Toggle state persists after page refresh
- ✅ Toggle state persists after browser close/reopen
- ✅ Bulk toggle operations persist correctly

### **Task C: Phase 1 Signals**
- ✅ MACD histogram divergence signals generated
- ✅ MFI advanced divergence + failure swing signals generated
- ✅ OBV divergence signals generated
- ✅ All signals matchable in autoscanner
- ✅ Mock position test passes (no "not found" errors)
- ✅ Backtest results include new divergence signals
- ✅ Signal correlations update correctly

---

## Next Steps

1. **Review this plan** - Confirm approach and scope
2. **Implement Task A** - Backtest position saving
3. **Verify Task B** - Demo toggle persistence
4. **Implement Task C Step 1-3** - Signal evaluation updates
5. **Implement Task C Step 4-6** - Signal matching and registry
6. **Test Task C** - Mock position and E2E tests
7. **Deploy and monitor** - Verify all systems working

