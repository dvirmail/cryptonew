# Effective Balance Risk Widget Fix

## Issues Fixed

### 1. Stale Data Issue ✅ FIXED

**Problem**: The "Effective Balance Risk" widget showed stale data and only updated when hovering over it.

**Root Cause**: 
- The widget was receiving `scannerState` as a prop from `Layout.jsx`
- While `Layout.jsx` subscribes to scanner updates, the widget component wasn't re-rendering when the prop changed
- The tooltip worked because it recalculated on hover using `useMemo`, but the main display didn't update

**Solution**:
- Modified `BalanceRiskWidget.jsx` to subscribe directly to the scanner service (similar to `FearGreedWidget`)
- The widget now uses `useEffect` to subscribe to scanner updates on mount
- This ensures the widget always has real-time data and updates automatically when `adjustedBalanceRiskFactor` changes

**Code Changes**:
```javascript
// Before: Relied on prop updates
export default function BalanceRiskWidget({ scannerState }) {
  const adjustedRiskFactor = scannerState?.adjustedBalanceRiskFactor ?? 100;
  // ...
}

// After: Subscribes directly to scanner service
export default function BalanceRiskWidget({ scannerState: propScannerState }) {
  const [scannerState, setScannerState] = useState(propScannerState || null);
  
  useEffect(() => {
    const scannerService = getAutoScannerService();
    const initialState = scannerService.getState();
    setScannerState(initialState);
    
    const unsubscribe = scannerService.subscribe((state) => {
      setScannerState(state);
    });
    
    return () => unsubscribe();
  }, []);
  // ...
}
```

### 2. 80% Cap Explanation

**Question**: Why is there a cap of 80%?

**Answer**: The 80% cap is a **user-configurable setting** called `maxBalancePercentRisk`.

**How It Works**:
1. **Default Value**: 100% (no cap by default)
2. **User Configuration**: Can be set in scanner settings (typically 80% for conservative trading)
3. **Purpose**: Acts as a safety mechanism to prevent excessive position sizes, even during periods of high market momentum

**Calculation Logic** (from `PerformanceMetricsService.jsx`):
```javascript
const maxBalancePercentRisk = state.settings?.maxBalancePercentRisk || 100;
let adjustedBalanceRiskFactor;

// Based on momentum score, calculate risk factor
if (clampedScore >= 75) {
    // Excellent momentum: use full configured max risk
    adjustedBalanceRiskFactor = maxBalancePercentRisk; // e.g., 80%
} else if (clampedScore >= 60) {
    // Good momentum: scale from 60% to 100% of max risk
    adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
} else if (clampedScore >= 40) {
    // Poor momentum: scale from 20% to 60% of max risk
    adjustedBalanceRiskFactor = maxBalancePercentRisk * scaleFactor;
} else {
    // Very poor momentum: minimum 10% of max risk
    adjustedBalanceRiskFactor = Math.max(10, maxBalancePercentRisk * 0.1);
}

// Ensure we never exceed the configured max
adjustedBalanceRiskFactor = Math.min(maxBalancePercentRisk, adjustedBalanceRiskFactor);
```

**Example Scenarios**:
- **Momentum Score: 75+** (Excellent) → Uses full `maxBalancePercentRisk` (e.g., 80%)
- **Momentum Score: 60-74** (Good) → Scales between 48% and 80% of max
- **Momentum Score: 40-59** (Poor) → Scales between 16% and 48% of max
- **Momentum Score: <40** (Very Poor) → Minimum 8% of max (or absolute minimum 10%)

**Where to Change**:
- The `maxBalancePercentRisk` setting can be configured in the scanner settings
- It's stored in `scannerState.settings.maxBalancePercentRisk`
- Default is 100% if not set

## Technical Details

### Update Frequency
- The widget now updates in real-time whenever `adjustedBalanceRiskFactor` changes
- Updates occur when:
  - Performance momentum score changes
  - Market conditions change (affecting momentum calculation)
  - Scanner settings are updated

### Component Architecture
- **Before**: Prop-based, reactive to parent updates
- **After**: Direct subscription, reactive to scanner service updates
- **Pattern**: Follows the same pattern as `FearGreedWidget` for consistency

### Performance
- Subscription is lightweight (just state updates)
- Component only re-renders when `adjustedBalanceRiskFactor` actually changes
- No performance impact from the fix

## Testing

To verify the fix:
1. Open the scanner dashboard
2. Observe the "Effective Balance Risk" widget
3. Wait for a scan cycle to complete (momentum score may change)
4. The widget should update automatically without hovering
5. Hover over the widget to see the tooltip with detailed breakdown

## Related Files

- `src/components/layout/BalanceRiskWidget.jsx` - Widget component (fixed)
- `src/components/services/services/PerformanceMetricsService.jsx` - Risk calculation logic
- `src/pages/Layout.jsx` - Parent component that passes scannerState prop
- `src/components/layout/FearGreedWidget.jsx` - Reference implementation for subscription pattern

