# Phase 1: Signal Correlation Update Plan

## Overview

When implementing Phase 1 signal upgrades (MACD, MFI, OBV divergence), we must ensure that:
1. **All new signals are properly correlated** with strategies
2. **Existing combinations are updated** to include new signals if applicable
3. **Backtest engine captures** new signals in combinations
4. **Autoscanner matches** new signals correctly
5. **Signal normalization** ensures consistent correlation across systems

---

## Critical Correlation Points

### 1. **Signal Capture During Backtest**

**Location:** `src/components/backtesting/BacktestingEngine.jsx`

**Current Flow:**
```javascript
// Line ~500-534: Signals are detected and added to combinations
const combinations = this.generateSignalCombinations(effectiveSignals, i, currentMarketRegime, regimeConfidence);
this.allMatches.push(...nonConsecutiveCombinations);
```

**Issue:** When new divergence signals are added, they must be included in `effectiveSignals` array.

**Solution:**
- Ensure `evaluateSignalCondition()` returns new divergence signals
- Verify signal structure: `{ type, value, strength, isEvent, ... }`
- New signals must have unique `value` strings (e.g., `"MACD Histogram Regular Bullish Divergence"`)

**Verification:**
```javascript
// Add to BacktestingEngine.jsx after signal evaluation
if (this.debugMode && effectiveSignals.length > 0) {
    const divergenceSignals = effectiveSignals.filter(s => 
        s.value && s.value.toLowerCase().includes('divergence')
    );
    if (divergenceSignals.length > 0) {
        this.log(`[DEBUG] Found ${divergenceSignals.length} divergence signals: ${divergenceSignals.map(s => s.value).join(', ')}`);
    }
}
```

---

### 2. **Signal Grouping and Correlation**

**Location:** `src/components/backtesting/core/backtestProcessor.jsx`

**Current Flow:**
```javascript
// Line ~755-765: groupMatchesBySignals()
const combinationName = match.signals.map(s => s.value || s.type).sort().join(' + ');
```

**Issue:** Combination name must include new divergence signals for proper correlation.

**Solution:**
- Signal grouping already uses `s.value || s.type`, so new signals will be included
- Ensure signals are deduplicated by `type + value` combination
- Verify combination name includes divergence signals

**Example:**
```javascript
// Before: "MACD Bullish Cross + RSI Oversold Entry"
// After:  "MACD Bullish Cross + MACD Histogram Regular Bullish Divergence + RSI Oversold Entry"
```

**Verification:**
```javascript
// Add to processBacktestResults()
const testCombination = processedCombinations.find(c => 
    c.signals.some(s => s.value && s.value.includes('Divergence'))
);
if (testCombination) {
    console.log('[CORRELATION] Combination with divergence:', {
        name: testCombination.key,
        signals: testCombination.signals.map(s => `${s.type}: ${s.value}`)
    });
}
```

---

### 3. **Signal Storage in Database**

**Location:** `src/pages/Backtesting.jsx` - `saveCombinations()`

**Current Flow:**
```javascript
// Line ~941: signals are saved directly from result.signals
signals: result.signals || [],
```

**Issue:** Signals array must include all new divergence signals with correct structure.

**Solution:**
- Ensure `result.signals` includes new divergence signals
- Validate signal structure before saving
- Normalize signal values for consistency

**Signal Structure Required:**
```javascript
{
    type: "MACD",  // Must match exactly (case-sensitive)
    value: "MACD Histogram Regular Bullish Divergence",  // Must match exactly
    strength: 85,  // Optional but recommended
    isEvent: true  // Divergences are events
}
```

**Enhancement - Signal Normalization Before Save:**
```javascript
// Add normalization function
const normalizeSignalsForSave = (signals) => {
    return signals.map(signal => {
        // Ensure consistent structure
        return {
            type: signal.type || '',
            value: signal.value || signal.type || '',
            strength: signal.strength || 0,
            isEvent: signal.isEvent !== undefined ? signal.isEvent : 
                     (signal.value && signal.value.toLowerCase().includes('divergence'))
        };
    }).filter(s => s.type && s.value); // Remove invalid signals
};

// In saveCombinations():
signals: normalizeSignalsForSave(result.signals || []),
```

---

### 4. **Signal Matching in Autoscanner**

**Location:** `src/components/utils/signalLogic.jsx` - `evaluateSignalConditions()`

**Current Flow:**
```javascript
// Line ~301-304: Exact matching by type and value
const exactMatch = potentialSignals.find(p => 
    p.type === strategySignal.type && 
    p.value === strategySignal.value
);
```

**Issue:** Matching must handle new divergence signals with normalization.

**Solution:**
- Add signal name normalization
- Support partial matching for divergence signals (optional)
- Ensure case-insensitive matching for robustness

**Enhancement:**
```javascript
// Add normalization helper
const normalizeSignalForMatching = (type, value) => {
    // Use signal name registry if available
    if (SIGNAL_NAME_REGISTRY && SIGNAL_NAME_REGISTRY[type]) {
        return SIGNAL_NAME_REGISTRY[type][value] || value;
    }
    return value;
};

// Enhanced matching in evaluateSignalConditions():
const exactMatch = potentialSignals.find(p => {
    const typeMatch = (p.type || '').toLowerCase() === (strategySignal.type || '').toLowerCase();
    const normalizedPValue = normalizeSignalForMatching(p.type, p.value);
    const normalizedStrategyValue = normalizeSignalForMatching(strategySignal.type, strategySignal.value);
    const valueMatch = normalizedPValue === normalizedStrategyValue ||
                       p.value === strategySignal.value ||
                       (p.value && p.value.includes(normalizedStrategyValue)) || // Partial match for divergences
                       (normalizedStrategyValue && normalizedPValue.includes(normalizedStrategyValue));
    return typeMatch && valueMatch;
});
```

---

### 5. **Signal Name Registry**

**Location:** `src/components/utils/signalNameRegistry.jsx` (NEW FILE)

**Purpose:** Centralized canonical signal names for consistent correlation.

```javascript
/**
 * Signal Name Registry
 * Ensures consistent naming between backtest and autoscanner
 */
export const SIGNAL_NAME_REGISTRY = {
    MACD: {
        // Existing signals
        'Bullish Cross': 'Bullish Cross',
        'Bearish Cross': 'Bearish Cross',
        'MACD Above Zero': 'MACD Above Zero',
        'MACD Below Zero': 'MACD Below Zero',
        
        // NEW Phase 1 Divergence Signals
        'MACD Histogram Regular Bullish Divergence': 'MACD Histogram Regular Bullish Divergence',
        'MACD Histogram Regular Bearish Divergence': 'MACD Histogram Regular Bearish Divergence',
        'MACD Histogram Hidden Bullish Divergence': 'MACD Histogram Hidden Bullish Divergence',
        'MACD Histogram Hidden Bearish Divergence': 'MACD Histogram Hidden Bearish Divergence',
    },
    MFI: {
        // Existing signals
        'Oversold Entry': 'Oversold Entry',
        'Overbought Exit': 'Overbought Exit',
        'Above 80': 'Above 80',
        'Below 20': 'Below 20',
        
        // NEW Phase 1 Divergence Signals
        'MFI Regular Bullish Divergence': 'MFI Regular Bullish Divergence',
        'MFI Regular Bearish Divergence': 'MFI Regular Bearish Divergence',
        'MFI Failure Swing Bullish': 'MFI Failure Swing Bullish',
        'MFI Failure Swing Bearish': 'MFI Failure Swing Bearish',
    },
    OBV: {
        // Existing signals
        'OBV Trend Cross Bullish': 'OBV Trend Cross Bullish',
        'OBV Trend Cross Bearish': 'OBV Trend Cross Bearish',
        
        // NEW Phase 1 Divergence Signals
        'OBV Bullish Divergence': 'OBV Bullish Divergence',
        'OBV Bearish Divergence': 'OBV Bearish Divergence',
    }
};

/**
 * Normalize signal name for consistent matching
 */
export function normalizeSignalName(type, value) {
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    if (registry && registry[value]) {
        return registry[value]; // Return canonical name
    }
    return value; // Return as-is if not in registry
}

/**
 * Check if signal name is valid in registry
 */
export function isValidSignalName(type, value) {
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    if (!registry) return true; // Type not in registry, assume valid
    return registry.hasOwnProperty(value);
}

/**
 * Get all available signal values for a type
 */
export function getAvailableSignalValues(type) {
    const registry = SIGNAL_NAME_REGISTRY[type?.toUpperCase()];
    return registry ? Object.keys(registry) : [];
}
```

---

### 6. **Correlation Update for Existing Combinations**

**Issue:** Existing saved combinations may not include new divergence signals, even if they use MACD, MFI, or OBV.

**Solution:** Create correlation update script/function.

**Location:** `src/components/utils/correlationUpdateManager.jsx` (NEW FILE)

```javascript
import { queueEntityCall } from '@/components/utils/apiQueue';
import { SIGNAL_NAME_REGISTRY, normalizeSignalName } from './signalNameRegistry';

/**
 * Updates existing combinations to include new divergence signals if applicable
 * 
 * Strategy:
 * 1. Find combinations using MACD, MFI, or OBV
 * 2. Check if they have matching divergence signals in backtest results
 * 3. Add divergence signals to combination if they improve correlation
 */
export async function updateCombinationCorrelations(backtestMatches, savedCombinations) {
    const updates = [];
    
    for (const combination of savedCombinations) {
        const hasMacd = combination.signals?.some(s => s.type === 'MACD');
        const hasMfi = combination.signals?.some(s => s.type === 'MFI');
        const hasObv = combination.signals?.some(s => s.type === 'OBV');
        
        if (!hasMacd && !hasMfi && !hasObv) continue; // Skip if not using Phase 1 indicators
        
        // Find matches for this combination
        const combinationMatches = backtestMatches.filter(match => {
            // Match by existing signals
            const matchHasAllSignals = combination.signals.every(strategySignal => 
                match.signals?.some(matchSignal => 
                    matchSignal.type === strategySignal.type &&
                    matchSignal.value === strategySignal.value
                )
            );
            return matchHasAllSignals;
        });
        
        if (combinationMatches.length === 0) continue; // No matches found
        
        // Extract divergence signals from matches
        const divergenceSignals = [];
        combinationMatches.forEach(match => {
            match.signals?.forEach(signal => {
                if (signal.value && signal.value.toLowerCase().includes('divergence')) {
                    const exists = divergenceSignals.some(ds => 
                        ds.type === signal.type && ds.value === signal.value
                    );
                    if (!exists) {
                        divergenceSignals.push({
                            type: signal.type,
                            value: normalizeSignalName(signal.type, signal.value),
                            strength: signal.strength || 0,
                            isEvent: true
                        });
                    }
                }
            });
        });
        
        // Add divergence signals to combination if found
        if (divergenceSignals.length > 0) {
            const updatedSignals = [
                ...(combination.signals || []),
                ...divergenceSignals
            ];
            
            // Deduplicate signals
            const uniqueSignals = [];
            const seen = new Set();
            updatedSignals.forEach(signal => {
                const key = `${signal.type}:${signal.value}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueSignals.push(signal);
                }
            });
            
            updates.push({
                id: combination.id,
                signals: uniqueSignals,
                reason: `Added ${divergenceSignals.length} divergence signal(s) from correlation analysis`
            });
        }
    }
    
    return updates;
}

/**
 * Apply correlation updates to database
 */
export async function applyCorrelationUpdates(updates) {
    const results = [];
    
    for (const update of updates) {
        try {
            await queueEntityCall('BacktestCombination', 'update', update.id, {
                signals: update.signals
            });
            results.push({ id: update.id, success: true, reason: update.reason });
        } catch (error) {
            results.push({ id: update.id, success: false, error: error.message });
        }
    }
    
    return results;
}
```

---

### 7. **Verification and Testing**

#### **A. Backtest Signal Capture Test**

```javascript
// Test: Verify new divergence signals are captured during backtest
const testBacktestCapturesDivergence = async () => {
    const engine = new BacktestingEngine(settings);
    const results = await engine.run();
    
    const divergenceMatches = results.matches.filter(match => 
        match.signals.some(s => 
            s.value && s.value.toLowerCase().includes('divergence')
        )
    );
    
    console.assert(
        divergenceMatches.length > 0,
        'Backtest should capture divergence signals'
    );
    
    console.log(`✅ Captured ${divergenceMatches.length} matches with divergence signals`);
};
```

#### **B. Correlation Storage Test**

```javascript
// Test: Verify signals are saved correctly in combinations
const testCorrelationStorage = async () => {
    const combination = {
        signals: [
            { type: 'MACD', value: 'Bullish Cross' },
            { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' },
            { type: 'RSI', value: 'Oversold Entry' }
        ]
    };
    
    const saved = await queueEntityCall('BacktestCombination', 'create', {
        ...combination,
        coin: 'ETH/USDT',
        timeframe: '15m'
    });
    
    console.assert(
        saved.signals.length === 3,
        'Combination should include divergence signal'
    );
    
    console.assert(
        saved.signals.some(s => s.value.includes('Divergence')),
        'Divergence signal should be in saved combination'
    );
    
    console.log('✅ Correlation storage test passed');
};
```

#### **C. Autoscanner Matching Test**

```javascript
// Test: Verify autoscanner matches divergence signals
const testAutoscannerMatchesDivergence = async () => {
    const strategy = {
        signals: [
            { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' }
        ]
    };
    
    const indicators = {
        macd: [...], // Mock MACD data
        data: [...]  // Mock kline data
    };
    
    const result = evaluateSignalConditions(strategy, indicators, klines);
    
    console.assert(
        result.isMatch === true,
        'Autoscanner should match divergence signal'
    );
    
    console.assert(
        result.matchedSignals.some(s => s.value.includes('Divergence')),
        'Matched signals should include divergence'
    );
    
    console.log('✅ Autoscanner matching test passed');
};
```

---

## Implementation Checklist

### **Step 1: Create Signal Name Registry**
- [ ] Create `src/components/utils/signalNameRegistry.jsx`
- [ ] Define canonical names for all Phase 1 signals
- [ ] Add normalization functions
- [ ] Export registry for use across app

### **Step 2: Update Signal Evaluation Functions**
- [ ] Update `evaluateMacdCondition()` to include divergence signals
- [ ] Update `evaluateMfiCondition()` to include divergence + failure swings
- [ ] Update `evaluateObvCondition()` to include divergence signals
- [ ] Ensure all new signals have unique `value` strings
- [ ] Verify signal structure matches requirements

### **Step 3: Update Signal Matching Logic**
- [ ] Import signal name registry into `signalLogic.jsx`
- [ ] Add normalization to `evaluateSignalConditions()`
- [ ] Enhance matching to support partial matching for divergences
- [ ] Add case-insensitive matching

### **Step 4: Update Signal Storage**
- [ ] Add normalization function to `saveCombinations()`
- [ ] Verify signals array includes all new divergence signals
- [ ] Add validation for signal structure before save

### **Step 5: Create Correlation Update Manager**
- [ ] Create `correlationUpdateManager.jsx`
- [ ] Implement `updateCombinationCorrelations()`
- [ ] Implement `applyCorrelationUpdates()`
- [ ] Add UI option to trigger correlation updates (optional)

### **Step 6: Add Verification Tests**
- [ ] Backtest signal capture test
- [ ] Correlation storage test
- [ ] Autoscanner matching test
- [ ] Integration test with mock position

### **Step 7: Update Existing Combinations (Optional)**
- [ ] Create migration script to update existing combinations
- [ ] Run correlation analysis on saved combinations
- [ ] Add divergence signals where applicable
- [ ] Verify updates don't break existing functionality

---

## Expected Signal Correlations After Phase 1

### **Example 1: MACD Strategy**
**Before:**
```javascript
{
    signals: [
        { type: 'MACD', value: 'Bullish Cross' },
        { type: 'RSI', value: 'Oversold Entry' }
    ]
}
```

**After (with divergence detected):**
```javascript
{
    signals: [
        { type: 'MACD', value: 'Bullish Cross' },
        { type: 'MACD', value: 'MACD Histogram Regular Bullish Divergence' }, // NEW
        { type: 'RSI', value: 'Oversold Entry' }
    ]
}
```

### **Example 2: MFI Strategy**
**Before:**
```javascript
{
    signals: [
        { type: 'MFI', value: 'Oversold Entry' },
        { type: 'EMA', value: 'Price Above EMA' }
    ]
}
```

**After (with divergence + failure swing detected):**
```javascript
{
    signals: [
        { type: 'MFI', value: 'Oversold Entry' },
        { type: 'MFI', value: 'MFI Regular Bullish Divergence' }, // NEW
        { type: 'MFI', value: 'MFI Failure Swing Bullish' }, // NEW
        { type: 'EMA', value: 'Price Above EMA' }
    ]
}
```

---

## Risk Mitigation

### **Backward Compatibility**
- ✅ All existing signals preserved
- ✅ New signals are additive only
- ✅ Signal structure unchanged
- ✅ Matching logic enhanced, not replaced

### **Correlation Integrity**
- ✅ Signal names normalized via registry
- ✅ Deduplication prevents duplicate signals
- ✅ Validation ensures signal structure consistency
- ✅ Tests verify correlation at each step

### **Rollback Plan**
- ✅ Git commits after each step
- ✅ Database updates are reversible
- ✅ Signal registry can be disabled if needed
- ✅ Feature flag for correlation updates (optional)

---

## Success Criteria

1. ✅ **Backtest captures** new divergence signals in combinations
2. ✅ **Combinations saved** include all detected divergence signals
3. ✅ **Autoscanner matches** new divergence signals correctly
4. ✅ **Signal names normalized** consistently across systems
5. ✅ **Existing combinations** can be updated with new signals (optional)
6. ✅ **No "not found" errors** for new signals in autoscanner
7. ✅ **Correlation integrity** maintained across all updates

---

## Next Steps

1. **Review this correlation plan** with team
2. **Implement Step 1-3** (Registry + Signal Updates)
3. **Test correlation** with mock data
4. **Implement Step 4-5** (Storage + Correlation Manager)
5. **Run verification tests**
6. **Update existing combinations** (optional)
7. **Deploy and monitor**

