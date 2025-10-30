# Position Closing Error Analysis & Fixes

## 🔍 What's Not Working

**Symptom**: Positions fail to close with "Account has insufficient balance" error, even though positions are already closed on Binance. The logs show `code=n/a`, indicating the error code is being lost during error propagation.

**Root Cause**: The error code (`-2010`) is not being preserved as the error propagates through the promise chain:
1. `localClient.js` throws error without preserving `code` property
2. `apiQueue.jsx` re-throws error but code may be missing
3. `PositionManager.jsx`'s `parseErr` function doesn't check `err.code` directly

## 🔄 Complete Error Flow & Functions That Should Kick In

### **Step 1: Binance API Call** (`localClient.js`)
**Function**: `liveTradingAPI()` - `createOrder` action  
**What Should Happen**: 
- Detect error response from proxy server
- Extract error code from `data.code` or `data.data.code`
- Attach `code` property to Error object before throwing

**Fix Applied**: ✅ Now preserves error code in Error object

---

### **Step 2: API Queue Error Handling** (`apiQueue.jsx`)
**Function**: `queueFunctionCall()` → `processQueue()` → `executeWithRetry()`
**What Should Happen**:
- Catch error from `localClient.js`
- Detect "insufficient balance" error (`-2010`)
- Run dust conversion workflow
- **For SELL orders**: Re-throw error with code preserved

**Fix Applied**: ✅ Now ensures error code is present when re-throwing

---

### **Step 3: PositionManager Error Parsing** (`PositionManager.jsx`)
**Function**: `_executeBinanceMarketSellOrder()` → `attemptSell()` → `parseErr()`
**What Should Happen**:
- Catch error from `apiQueue.jsx`
- Parse error to extract code and message
- **CRITICAL**: Check `err.code` directly first (not just `err.response.data.code`)
- Detect `code === -2010` or message includes "insufficient balance"

**Fix Applied**: ✅ Now checks `err.code` directly before checking response data

---

### **Step 4: PositionManager Error Handling** (`PositionManager.jsx`)
**Function**: `_executeBinanceMarketSellOrder()` catch block (line ~3015)
**What Should Happen**:
- Detect `isInsufficient = true` (code `-2010` or message includes "insufficient balance")
- **In closing context**: Run order history check FIRST
- If order found in history → Treat as successful close
- If order NOT found → Trigger virtual close

**Current Status**: ✅ Logic exists but wasn't triggering due to missing error code

---

### **Step 5: Virtual Close Logic** (`PositionManager.jsx`)
**Function**: `_executeBinanceMarketSellOrder()` error handling block (line ~3184)
**What Should Happen**:
- When "insufficient balance" in closing context with no matching order:
  - Mark position as virtually closed
  - Create trade record
  - Remove from memory/database
  - Return success result

**Current Status**: ✅ Logic exists but wasn't triggering

---

## 📊 New Logging Added

### **Upstream Logging**:

1. **`localClient.js`**:
   - `[ERROR_CODE_PRESERVED]` - Confirms error code was extracted and attached
   - `[ERROR_CODE_MISSING]` - Warns if error code not found in response
   - `[CAUGHT_ERROR]` - Shows error code and message when caught
   - `[ERROR_CODE_RESTORED]` - Confirms error code restored from error.data

2. **`apiQueue.jsx`**:
   - `[RE_THROW_ERROR]` - Logs error code when re-throwing for SELL orders
   - `[ERROR_CODE_ADDED]` - Confirms error code added if missing
   - `[SKIP_VIRTUAL_CLOSE_SELL]` - Now includes error code in log

3. **`PositionManager.jsx`**:
   - `[PARSE_ERR]` - Comprehensive error parsing logs showing:
     - Error object structure
     - Direct `err.code` check
     - Nested response data checks
     - Final parsed code and message
   - `[QUEUE_ERROR_CAUGHT_IN_ATTEMPTSELL]` - Shows error when caught from queueFunctionCall
   - `[ERROR_CAUGHT]` - Existing error handling logs
   - `[ERROR_ANALYSIS]` - Parsed error details
   - `[ERROR_HANDLING]` - Confirms entry into error handling block

---

## 🔧 Functions That Should Prevent This Error

### **Primary Prevention Functions**:

1. **`parseErr()`** in `PositionManager.jsx`
   - **NOW FIXED**: Checks `err.code` directly first
   - Should detect `-2010` immediately
   
2. **`_executeBinanceMarketSellOrder()` error handling** (line ~3044)
   - **Condition**: `isInsufficient || isFilterViolation || is400`
   - **Should**: Trigger order history check → virtual close if needed

3. **Order History Check** (line ~3061)
   - **What it does**: Checks Binance for recent SELL orders matching position
   - **If found**: Treats as successful close
   - **Time window**: Last 2 hours
   - **Quantity tolerance**: 20%

4. **Virtual Close Fallback** (line ~3184)
   - **When**: Insufficient balance + closing context + no matching order
   - **What**: Creates virtual trade record and removes position

---

## 🎯 Expected Behavior Now

With these fixes, when a position fails to close due to "insufficient balance":

1. ✅ `localClient.js` preserves error code `-2010`
2. ✅ `apiQueue.jsx` ensures code is present when re-throwing
3. ✅ `PositionManager.jsx` detects code correctly via `parseErr`
4. ✅ Error handling logic triggers
5. ✅ Order history check runs
6. ✅ Virtual close executes if needed
7. ✅ Position is removed from system

---

## 📝 Next Steps for Testing

1. **Monitor logs for**:
   - `[ERROR_CODE_PRESERVED]` from localClient
   - `[RE_THROW_ERROR]` from apiQueue showing error code
   - `[PARSE_ERR]` showing error code extraction
   - `[ERROR_HANDLING]` confirming error handling triggered
   - `[OUTER_CATCH] CLOSING CONTEXT` if virtual close triggers

2. **Expected Result**:
   - Positions should close via virtual close when Binance returns "insufficient balance"
   - Trade records should be created
   - Positions should be removed from memory/database

