# Unrealized P&L Impact on LPM Score - Scenarios with $5,000 Invested Capital

## Setup
- **Total Invested Capital**: $5,000 (in open positions)
- **Unrealized P&L Weight**: 30% of LPM score
- **Scaling Factor**: 5.0
- **Position Count Factor**: 1.0 (assuming 3+ positions)

---

## Scenario 1: Small Profit (+2.5%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: +$125

**Calculation:**
1. **Portfolio P&L %** = ($125 / $5,000) × 100 = **+2.5%**
2. **Log Scaled P&L** = log(1 + 2.5) × 1 = log(3.5) = **1.25**
3. **Position Count Factor** = min(1.0, 3/3) = **1.0**
4. **Unrealized Component** = 50 + (1.25 × 5.0 × 1.0) = 50 + 6.25 = **56.25 ≈ 56**
5. **LPM Contribution** = 56 × 0.30 = **+16.8 points**

**Impact**: Small profit increases LPM by **6.8 points** from unrealized component (from 15.0 to 16.8).

---

## Scenario 2: Moderate Profit (+5%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: +$250

**Calculation:**
1. **Portfolio P&L %** = ($250 / $5,000) × 100 = **+5.0%**
2. **Log Scaled P&L** = log(1 + 5.0) × 1 = log(6.0) = **1.79**
3. **Position Count Factor** = **1.0**
4. **Unrealized Component** = 50 + (1.79 × 5.0 × 1.0) = 50 + 8.95 = **58.95 ≈ 59**
5. **LPM Contribution** = 59 × 0.30 = **+17.7 points**

**Impact**: Moderate profit increases LPM by **8.7 points** from unrealized component (from 15.0 to 17.7).

---

## Scenario 3: Good Profit (+10%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: +$500

**Calculation:**
1. **Portfolio P&L %** = ($500 / $5,000) × 100 = **+10.0%**
2. **Log Scaled P&L** = log(1 + 10.0) × 1 = log(11.0) = **2.40**
3. **Position Count Factor** = **1.0**
4. **Unrealized Component** = 50 + (2.40 × 5.0 × 1.0) = 50 + 12.0 = **62.0**
5. **LPM Contribution** = 62 × 0.30 = **+18.6 points**

**Impact**: Good profit increases LPM by **11.6 points** from unrealized component (from 15.0 to 18.6).

---

## Scenario 4: Strong Profit (+20%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: +$1,000

**Calculation:**
1. **Portfolio P&L %** = ($1,000 / $5,000) × 100 = **+20.0%**
2. **Log Scaled P&L** = log(1 + 20.0) × 1 = log(21.0) = **3.04**
3. **Position Count Factor** = **1.0**
4. **Unrealized Component** = 50 + (3.04 × 5.0 × 1.0) = 50 + 15.2 = **65.2 ≈ 65**
5. **LPM Contribution** = 65 × 0.30 = **+19.5 points**

**Impact**: Strong profit increases LPM by **14.5 points** from unrealized component (from 15.0 to 19.5).

---

## Scenario 5: Break Even (0%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: $0

**Calculation:**
1. **Portfolio P&L %** = ($0 / $5,000) × 100 = **0.0%**
2. **Log Scaled P&L** = 0 (no scaling needed)
3. **Position Count Factor** = **1.0**
4. **Unrealized Component** = 50 + (0 × 5.0 × 1.0) = **50.0**
5. **LPM Contribution** = 50 × 0.30 = **+15.0 points**

**Impact**: Neutral - no impact on LPM from unrealized component.

---

## Scenario 5.5: Very Small Loss (-0.5%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$25

**Calculation:**
1. **Portfolio P&L %** = (-$25 / $5,000) × 100 = **-0.5%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -0.5% × 2.0 = **-1.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-1.0 × 5.0 × 1.0) = 50 - 5.0 = **45.0**
6. **LPM Contribution** = 45 × 0.30 = **+13.5 points**

**Impact**: Very small loss reduces LPM by **1.5 points** from unrealized component (from 15.0 to 13.5).
**⚠️ NEW**: With 2x penalty, even a tiny -0.5% loss has measurable impact (-1.5 LPM points)!

---

## Scenario 5.6: Small Loss (-1.0%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$50

**Calculation:**
1. **Portfolio P&L %** = (-$50 / $5,000) × 100 = **-1.0%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -1.0% × 2.0 = **-2.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-2.0 × 5.0 × 1.0) = 50 - 10.0 = **40.0**
6. **LPM Contribution** = 40 × 0.30 = **+12.0 points**

**Impact**: Small loss reduces LPM by **3.0 points** from unrealized component (from 15.0 to 12.0).
**⚠️ NEW**: With 2x penalty, a -1% loss has double the impact it would have without the penalty!

---

## Scenario 6: Small Loss (-2.5%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$125

**Calculation:**
1. **Portfolio P&L %** = (-$125 / $5,000) × 100 = **-2.5%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -2.5% × 2.0 = **-5.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-5.0 × 5.0 × 1.0) = 50 - 25.0 = **25.0**
6. **LPM Contribution** = 25 × 0.30 = **+7.5 points**

**Impact**: Small loss reduces LPM by **7.5 points** from unrealized component (from 15.0 to 7.5).
**⚠️ NEW**: With 2x penalty, a -2.5% loss now has the same impact as a -5% loss previously had!

---

## Scenario 7: Moderate Loss (-5%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$250

**Calculation:**
1. **Portfolio P&L %** = (-$250 / $5,000) × 100 = **-5.0%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -5.0% × 2.0 = **-10.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-10.0 × 5.0 × 1.0) = 50 - 50.0 = **0.0** (clamped to minimum)
6. **LPM Contribution** = 0 × 0.30 = **+0.0 points**

**Impact**: Moderate loss reduces LPM by **15.0 points** from unrealized component (from 15.0 to 0.0).
**⚠️ NEW**: With 2x penalty, a -5% loss now hits the minimum immediately (previously required -10%)!

---

## Scenario 8: Significant Loss (-10%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$500

**Calculation:**
1. **Portfolio P&L %** = (-$500 / $5,000) × 100 = **-10.0%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -10.0% × 2.0 = **-20.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-20.0 × 5.0 × 1.0) = 50 - 100.0 = **0.0** (clamped to minimum)
6. **LPM Contribution** = 0 × 0.30 = **+0.0 points**

**Impact**: Significant loss reduces LPM by **15.0 points** from unrealized component (from 15.0 to 0.0).
**⚠️ NEW**: With 2x penalty, a -10% loss still hits minimum (same as before, but now -5% also hits minimum).

---

## Scenario 9: Severe Loss (-20%)

**Position Details:**
- Total Invested Capital: $5,000
- Total Unrealized P&L: -$1,000

**Calculation:**
1. **Portfolio P&L %** = (-$1,000 / $5,000) × 100 = **-20.0%**
2. **Penalty Multiplier** = 2.0x (losses have 2x impact)
3. **Scaled P&L** = -20.0% × 2.0 = **-40.0%**
4. **Position Count Factor** = **1.0**
5. **Unrealized Component** = 50 + (-40.0 × 5.0 × 1.0) = 50 - 200.0 = **0.0** (clamped to minimum)
6. **LPM Contribution** = 0 × 0.30 = **+0.0 points**

**Impact**: Severe loss reduces LPM by **15.0 points** from unrealized component (from 15.0 to 0.0).
**⚠️ NEW**: With 2x penalty, all losses ≥ -5% hit the minimum immediately.

---

## Summary Table: Impact on LPM Score (WITH 2X LOSS PENALTY)

| Scenario | Unrealized P&L | Portfolio P&L % | Scaled P&L (with penalty) | Component Score | LPM Contribution | LPM Impact |
|----------|----------------|-----------------|----------------------------|-----------------|-----------------|------------|
| Strong Profit | +$1,000 | +20.0% | +3.04 (log scaled) | 65 | +19.5 points | **+4.5 points** |
| Good Profit | +$500 | +10.0% | +2.40 (log scaled) | 62 | +18.6 points | **+3.6 points** |
| Moderate Profit | +$250 | +5.0% | +1.79 (log scaled) | 59 | +17.7 points | **+2.7 points** |
| Small Profit | +$125 | +2.5% | +1.25 (log scaled) | 56 | +16.8 points | **+1.8 points** |
| Break Even | $0 | 0.0% | 0.0 | 50 | +15.0 points | **0.0 points** (neutral) |
| Very Small Loss | -$25 | -0.5% | **-1.0%** (2x penalty) | 45 | +13.5 points | **-1.5 points** ⚠️ |
| Small Loss (-1%) | -$50 | -1.0% | **-2.0%** (2x penalty) | 40 | +12.0 points | **-3.0 points** ⚠️ |
| Small Loss | -$125 | -2.5% | **-5.0%** (2x penalty) | 25 | +7.5 points | **-7.5 points** ⚠️ |
| Moderate Loss | -$250 | -5.0% | **-10.0%** (2x penalty) | 0 | +0.0 points | **-15.0 points** ⚠️ |
| Significant Loss | -$500 | -10.0% | **-20.0%** (2x penalty) | 0 | +0.0 points | **-15.0 points** ⚠️ |
| Severe Loss | -$1,000 | -20.0% | **-40.0%** (2x penalty) | 0 | +0.0 points | **-15.0 points** ⚠️ |

**⚠️ NEW**: Losses now have **2x the impact** due to penalty multiplier!

---

## Key Observations

### 1. **Asymmetric Impact (ENHANCED)**
- **Profits**: Logarithmic scaling means diminishing returns
  - +10% profit → +3.6 LPM points
  - +20% profit → +4.5 LPM points (only +0.9 more despite 2× the profit)
  
- **Losses**: **2x Penalty Multiplier** + Linear scaling = **DOUBLE IMPACT**
  - -2.5% loss → **-7.5 LPM points** (was -3.6, now 2x worse)
  - -5% loss → **-15.0 LPM points** (was -7.5, now 2x worse, hits minimum immediately)
  - -10% loss → **-15.0 LPM points** (hits minimum, same as -5% now)

### 2. **Maximum Impact Range**
- **Best Case**: +20% profit → +19.5 LPM points (max +4.5 from neutral)
- **Worst Case**: -10% or worse → +0.0 LPM points (max -15.0 from neutral)
- **Total Range**: 19.5 points swing (from 0 to 19.5)

### 3. **Real-World Example**

**If your LPM is currently 60:**
- With +10% unrealized profit: LPM would be **63.6** (if other components stay same)
- With -2.5% unrealized loss: LPM would be **52.5** ⚠️ (was 56.4 before, now 2x worse)
- With -5% unrealized loss: LPM would be **45.0** ⚠️ (was 52.5 before, now 2x worse, hits minimum)
- With -10% unrealized loss: LPM would be **45.0** (hits minimum, same as -5% now)

**⚠️ NEW**: With the 2x loss penalty, losses now have **DOUBLE the negative impact** on LPM!

---

## Notes

- All scenarios assume **3+ positions** (full position count factor = 1.0)
- If you have fewer than 3 positions, the impact would be reduced (factor < 1.0)
- The component score is clamped between 0 and 100
- Losses beyond -10% all result in component score of 0 (minimum)

