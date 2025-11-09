# Anti-Throttling Implementation - Web Worker Timer

## Overview

This implementation uses a **Web Worker** to run the scanner countdown timer in a separate thread, which is **significantly less throttled** than the main thread when the browser tab is inactive or when playing full-screen games.

## How It Works

### Architecture

1. **Web Worker** (`public/scanner-timer-worker.js`):
   - Runs in a separate thread, isolated from the main thread
   - Handles the countdown timer logic
   - Sends messages to the main thread when it's time to scan
   - Uses `setTimeout` with recursive calls for precise timing (checks every 100ms)

2. **BackgroundTimerService** (`src/components/services/BackgroundTimerService.jsx`):
   - Manages the Web Worker lifecycle
   - Handles communication between worker and main thread
   - Provides fallback to main thread timer if worker fails

3. **LifecycleService Integration**:
   - Automatically uses Web Worker timer if available
   - Falls back to main thread timer if worker is not supported or fails
   - Seamlessly switches between worker and main thread

## Benefits

### ✅ **Significantly Reduced Throttling**
- Web Workers are **much less throttled** than the main thread
- Timer continues running accurately even when:
  - Tab is inactive (`document.hidden = true`)
  - Browser window is minimized
  - Playing full-screen games
  - Other applications are in focus

### ✅ **Automatic Fallback**
- If Web Workers are not supported or fail to initialize, the system automatically falls back to the main thread timer
- No user intervention required
- Graceful degradation

### ✅ **Zero Configuration**
- Works automatically when the scanner starts
- No settings to configure
- Transparent to the user

## Technical Details

### Worker Timer Logic

The worker uses a recursive `setTimeout` approach that:
- Checks every 100ms for precision
- Sends tick updates every second for UI countdown
- Triggers scan cycle when `nextScanTime` is reached
- Continues running even when the tab is inactive

### Message Protocol

**Main Thread → Worker:**
- `START_TIMER` - Start the countdown timer
- `STOP_TIMER` - Stop the timer
- `UPDATE_FREQUENCY` - Update scan frequency
- `RESET_TIMER` - Reset the timer
- `GET_STATUS` - Get current timer status
- `PING` - Check if worker is responsive

**Worker → Main Thread:**
- `WORKER_READY` - Worker initialized and ready
- `SCAN_TIME` - Time to trigger scan cycle
- `TICK` - Countdown tick (for UI updates)
- `TIMER_STARTED` - Timer started
- `TIMER_STOPPED` - Timer stopped
- `FREQUENCY_UPDATED` - Frequency updated
- `TIMER_RESET` - Timer reset
- `STATUS` - Timer status response
- `ERROR` - Error occurred

## Browser Compatibility

- ✅ **Chrome/Edge**: Full support
- ✅ **Firefox**: Full support
- ✅ **Safari**: Full support (iOS 10+)
- ✅ **Brave**: Full support
- ⚠️ **IE11**: Not supported (falls back to main thread)

## Performance Impact

- **Memory**: Minimal (~1-2 MB for worker)
- **CPU**: Negligible (worker only runs timer logic)
- **Network**: None (worker doesn't make network calls)
- **UI**: No impact (worker doesn't block UI thread)

## Monitoring

The system logs the following to help monitor the timer:

- `[BackgroundTimerService] ✅ Timer worker initialized successfully` - Worker initialized
- `[LifecycleService] ✅ Using background timer (Web Worker)` - Using worker timer
- `[LifecycleService] ⚠️ Using main thread timer` - Using fallback timer
- `[BackgroundTimerService] ⚠️ Scan time delayed by Xs` - Throttling detected (rare with worker)

## Troubleshooting

### Worker Not Initializing

If you see `⚠️ Background timer initialization failed`, check:
1. Browser console for errors
2. Network tab for `scanner-timer-worker.js` loading
3. Browser compatibility (see above)

### Timer Still Throttled

If the timer is still being throttled:
1. Verify worker is being used: Look for `✅ Using background timer (Web Worker)` in logs
2. Check browser throttling settings (some browsers have aggressive throttling)
3. Ensure the tab/window is not completely suspended by the OS

## Future Enhancements

Potential improvements:
- Service Worker for even better background operation
- Shared Worker for multi-tab coordination
- WebAssembly for ultra-precise timing
- IndexedDB for persistent timer state

## Files Modified

1. `public/scanner-timer-worker.js` - Web Worker implementation
2. `src/components/services/BackgroundTimerService.jsx` - Worker manager
3. `src/components/services/services/LifecycleService.jsx` - Integration
4. `src/components/services/services/UtilityService.jsx` - Stop timer on scanner stop

## Testing

To test the anti-throttling:

1. Start the scanner
2. Verify logs show: `✅ Using background timer (Web Worker)`
3. Switch to another tab or minimize the browser
4. Play a full-screen game
5. Check logs after scan frequency period - should see scan cycles continuing

The scanner should continue running accurately even when the tab is inactive!

