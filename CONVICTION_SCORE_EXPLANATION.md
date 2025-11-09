# Conviction Score - Simple Explanation

## What is Conviction Score?

**Conviction Score** is a number from 0-100 that measures **how confident the system is** that a trade will be profitable. It's calculated for each strategy when signals are detected.

**Think of it like this:**
- **High conviction (70-100)**: "I'm very confident this trade will work!"
- **Medium conviction (50-69)**: "This looks decent, but not amazing"
- **Low conviction (0-49)**: "I'm not very confident about this"

## How is it Calculated?

The conviction score is built from **4 main factors**, each contributing points:

### 1. Market Regime Factor (0-25 points)

**What it checks:** Does the current market trend match what this strategy works best in?

**How it works:**
- If market is in **uptrend** and strategy works best in **uptrend** → **+25 points**
- If market is in **downtrend** and strategy works best in **downtrend** → **+25 points**
- If they **don't match** → **0-10 points** (depending on confidence)

**Example:**
- Market: Uptrend (100% confidence)
- Strategy works best in: Uptrend
- **Result: +25 points** ✅

---

### 2. Signal Strength & Confluence (0-50 points)

**What it checks:** How strong are the signals, and how many signals agree?

**How it works:**
- **Average signal strength** (0-100) → converted to **0-40 points**
  - If average strength = 80 → 80/100 × 40 = **32 points**
- **Confluence bonus** (multiple signals agreeing) → **+0 to +10 points**
  - 1 signal = 0 bonus
  - 2 signals = +5 bonus
  - 3+ signals = +10 bonus

**Example:**
- Signal 1: Strength 75
- Signal 2: Strength 85
- Average: (75 + 85) / 2 = 80
- Signal factor: 80/100 × 40 = **32 points**
- Confluence bonus: 2 signals = **+5 points**
- **Total: 37 points** ✅

---

### 3. Volatility Factor (0-15 points)

**What it checks:** Is the market in a "squeeze" (low volatility before a big move)?

**How it works:**
- Uses **TTM Squeeze** indicator
- If market is **squeezed** (low volatility) → **+15 points**
- If market is **expanding** (high volatility) → **+5-10 points**
- If market is **neutral** → **+0-5 points**

**Example:**
- TTM Squeeze: Active (squeezed)
- **Result: +15 points** ✅

---

### 4. Demo Performance Factor (-10 to +20 points)

**What it checks:** Has this strategy been profitable in backtesting/demo trading?

**How it checks:**
- Needs at least **10 demo trades** to count
- Looks at **profit factor** (total profit / total loss)
- **Profit factor > 1.2** (very profitable) → **+20 points**
- **Profit factor > 1.0** (profitable) → **+10 points**
- **Profit factor < 1.0** (losing) → **-10 points**

**Example:**
- Strategy has 50 demo trades
- Profit factor: 1.35 (very profitable)
- **Result: +20 points** ✅

---

## Final Score Calculation

**Total Score = Market Regime + Signal Strength + Volatility + Demo Performance**

**Then apply multiplier:**
- Score ≥ 80 → **×1.5 multiplier** (boost for high conviction)
- Score ≥ 65 → **×1.25 multiplier** (small boost)
- Score < 65 → **×1.0 multiplier** (no boost)

**Final conviction = Total Score (clamped to 0-100)**

---

## Complete Example

### Example 1: High Conviction Trade

**Strategy:** "RSI + MACD Crossover"

**Factors:**
1. **Market Regime:** Uptrend (matches strategy) → **+25 points**
2. **Signal Strength:** 
   - RSI signal: 85 strength
   - MACD signal: 90 strength
   - Average: 87.5
   - Signal factor: 87.5/100 × 40 = **35 points**
   - Confluence bonus: 2 signals = **+5 points**
   - **Total: 40 points**
3. **Volatility:** TTM Squeeze active → **+15 points**
4. **Demo Performance:** Profit factor 1.4 → **+20 points**

**Calculation:**
- Total: 25 + 40 + 15 + 20 = **100 points**
- Multiplier: 100 ≥ 80 → **×1.5**
- **Final Conviction: 100** (capped at 100) ✅

**Result:** This is a **very high conviction** trade!

---

### Example 2: Medium Conviction Trade

**Strategy:** "Bollinger Bands Breakout"

**Factors:**
1. **Market Regime:** Ranging (strategy works in uptrend) → **+5 points**
2. **Signal Strength:**
   - Only 1 signal: 60 strength
   - Signal factor: 60/100 × 40 = **24 points**
   - Confluence bonus: 1 signal = **0 points**
   - **Total: 24 points**
3. **Volatility:** Market expanding → **+8 points**
4. **Demo Performance:** Profit factor 1.1 → **+10 points**

**Calculation:**
- Total: 5 + 24 + 8 + 10 = **47 points**
- Multiplier: 47 < 65 → **×1.0**
- **Final Conviction: 47** ✅

**Result:** This is a **medium-low conviction** trade.

---

### Example 3: Low Conviction Trade

**Strategy:** "Moving Average Crossover"

**Factors:**
1. **Market Regime:** Downtrend (strategy works in uptrend) → **+0 points**
2. **Signal Strength:**
   - 1 signal: 45 strength
   - Signal factor: 45/100 × 40 = **18 points**
   - Confluence bonus: 1 signal = **0 points**
   - **Total: 18 points**
3. **Volatility:** Neutral → **+3 points**
4. **Demo Performance:** Profit factor 0.9 (losing) → **-10 points**

**Calculation:**
- Total: 0 + 18 + 3 - 10 = **11 points**
- Multiplier: 11 < 65 → **×1.0**
- **Final Conviction: 11** ✅

**Result:** This is a **very low conviction** trade - probably won't execute!

---

## How Conviction Score is Used

### 1. Trade Filtering

The system compares the **conviction score** to a **dynamic minimum threshold**:

```
If conviction score >= dynamic minimum threshold:
    ✅ Execute the trade
Else:
    ❌ Block the trade
```

### 2. Dynamic Minimum Threshold

The minimum threshold **changes based on your system's performance** (LPM score):

- **LPM = 50** (neutral) → Uses **base threshold** (e.g., 60)
- **LPM > 50** (good performance) → **Lowers threshold** (e.g., 55)
  - "System is doing well, be more aggressive!"
- **LPM < 50** (poor performance) → **Raises threshold** (e.g., 65)
  - "System is struggling, be more conservative!"

**Example:**
- Base threshold: 60
- LPM: 48 (poor performance)
- Dynamic threshold: 60 + (50 - 48) × 0.5 = **61**
- Strategy conviction: 58
- **Result: ❌ Blocked** (58 < 61)

---

## Summary

**Conviction Score = How confident the system is about a trade**

**Made from 4 factors:**
1. **Market Regime** (0-25 points) - Does market match strategy?
2. **Signal Strength** (0-50 points) - How strong are the signals?
3. **Volatility** (0-15 points) - Is market in a squeeze?
4. **Demo Performance** (-10 to +20 points) - Has strategy been profitable?

**Total: 0-100 points** (with multiplier boost for high scores)

**Used to filter trades:** Only execute if conviction ≥ dynamic minimum threshold

**Dynamic threshold adjusts** based on your system's performance (LPM score)

