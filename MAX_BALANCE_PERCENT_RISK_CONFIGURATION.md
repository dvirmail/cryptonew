# Max Balance Percent Risk Configuration Guide

## Where to Configure

The **Max Balance Percent Risk** setting is now available in the Scanner Configuration UI:

1. **Navigate to**: AutoScan page (or Scanner Configuration section)
2. **Location**: In the "Effective Balance Risk Configuration" section
3. **Field Name**: "Max Balance Percent Risk (%)"

## What It Does

This setting controls the **maximum effective balance risk percentage** that can be used for trading, regardless of how high the momentum score gets.

### How It Works

- **Range**: 10% to 100%
- **Default**: 100% (no restriction)
- **Purpose**: Acts as a safety cap to prevent excessive position sizes

### Example Scenarios

**If set to 80%:**
- Even if momentum score is 100 (excellent), the Effective Balance Risk will be capped at 80%
- This means position sizes will never exceed 80% of the configured maximum

**If set to 100%:**
- No restriction - Effective Balance Risk can reach 100% when momentum is excellent
- This is the default behavior

**If set to 50%:**
- Conservative setting - Effective Balance Risk will never exceed 50%
- Useful for risk-averse trading

## Relationship to Other Settings

### Effective Balance Risk Calculation

The Effective Balance Risk is calculated based on:
1. **Momentum Score** (0-100) - Based on performance metrics
2. **Max Balance Percent Risk** - Your configured cap (this setting)

**Formula**:
- Momentum Score 75+ (Excellent) → Uses full `maxBalancePercentRisk` (e.g., 80%)
- Momentum Score 60-74 (Good) → Scales between 48% and 80% of max
- Momentum Score 40-59 (Poor) → Scales between 16% and 48% of max
- Momentum Score <40 (Very Poor) → Minimum 8% of max

**Final Calculation**:
```
Effective Balance Risk = min(momentumBasedRisk, maxBalancePercentRisk)
```

### Where It's Displayed

1. **Dashboard Widget**: "Effective Balance Risk" card shows the current effective risk
2. **Tooltip**: Hover over the widget to see:
   - Configured Max: Your `maxBalancePercentRisk` setting
   - Momentum Score: Current performance momentum
   - Effective Risk: The calculated value (capped by your setting)

## Technical Details

### Storage
- Stored in: `ScanSettings` database table
- Field name: `maxBalancePercentRisk`
- Type: Number (percentage, 10-100)

### Default Behavior
- If not set: Defaults to 100% (no restriction)
- On first load: System creates default settings with 100%

### How to Change

**Via UI (Recommended)**:
1. Go to AutoScan page
2. Find "Effective Balance Risk Configuration" section
3. Adjust "Max Balance Percent Risk (%)" slider/input
4. Save configuration

**Via Database** (Advanced):
- Update `ScanSettings` table directly
- Field: `maxBalancePercentRisk`
- Value: 10-100 (percentage)

**Via API** (Advanced):
```javascript
await scannerService.updateSettings({ 
    maxBalancePercentRisk: 80 
});
```

## Why It Was Removed (Previously)

The UI field was temporarily removed with a comment: "Max Balance Percent Risk removed per new policy - rely solely on absolute cap". However, the setting was still being used in calculations and displayed in tooltips, causing confusion.

## Why It's Back

1. **User Request**: Users need to configure this setting
2. **Still Active**: The setting is actively used in calculations
3. **Visibility**: It's displayed in tooltips, so users should be able to change it
4. **Safety**: Important risk management tool

## Recommendations

- **Conservative Trading**: Set to 50-70%
- **Moderate Trading**: Set to 80-90%
- **Aggressive Trading**: Set to 100% (default)
- **Risk-Averse**: Set to 30-50%

## Related Settings

- **Max Balance to Invest (USDT)**: Absolute hard cap on total capital invested
- **Base Position Size**: Base position size for LPM system
- **Portfolio Heat Limit**: Maximum total portfolio risk exposure

These settings work together to provide comprehensive risk management.

