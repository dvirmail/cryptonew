/**
 * Scanner Timer Worker
 * 
 * This Web Worker runs the scanner countdown timer in a separate thread,
 * which is significantly less throttled than the main thread when the tab is inactive.
 * 
 * The worker sends messages to the main thread when it's time to trigger a scan cycle.
 */

class ScannerTimerWorker {
  constructor() {
    this.timerInterval = null;
    this.isRunning = false;
    this.scanFrequency = 60000; // Default 60 seconds
    this.nextScanTime = null;
    this.lastTickTime = null;
    this.tickCount = 0;
    
    this.setupMessageHandling();
    this.postMessage({ type: 'WORKER_READY', timestamp: Date.now() });
  }

  setupMessageHandling() {
    self.onmessage = (event) => {
      const { type, data } = event.data;
      
      try {
        switch (type) {
          case 'START_TIMER':
            this.startTimer(data);
            break;
          case 'STOP_TIMER':
            this.stopTimer();
            break;
          case 'UPDATE_FREQUENCY':
            this.updateFrequency(data);
            break;
          case 'RESET_TIMER':
            this.resetTimer();
            break;
          case 'GET_STATUS':
            this.getStatus();
            break;
          case 'PING':
            this.postMessage({ type: 'PONG', timestamp: Date.now() });
            break;
          default:
            this.postMessage({
              type: 'ERROR',
              error: `Unknown message type: ${type}`,
              code: 'UNKNOWN_MESSAGE_TYPE'
            });
        }
      } catch (error) {
        this.postMessage({
          type: 'ERROR',
          error: error.message,
          stack: error.stack,
          code: 'MESSAGE_HANDLER_ERROR'
        });
      }
    };
  }

  postMessage(data) {
    self.postMessage(data);
  }

  startTimer(data = {}) {
    if (this.isRunning) {
      this.stopTimer();
    }

    this.scanFrequency = data.scanFrequency || 60000;
    this.isRunning = true;
    this.nextScanTime = Date.now() + this.scanFrequency;
    this.lastTickTime = Date.now();
    this.tickCount = 0;

    this.postMessage({
      type: 'TIMER_STARTED',
      scanFrequency: this.scanFrequency,
      nextScanTime: this.nextScanTime,
      timestamp: Date.now()
    });

    // Start the timer loop using postMessage for precise timing
    // This approach is less throttled than setTimeout in inactive tabs
    this.timerLoop();
  }

  timerLoop() {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();
    const timeSinceLastTick = now - (this.lastTickTime || now);
    this.lastTickTime = now;
    this.tickCount++;

    // Check if it's time to scan
    if (this.nextScanTime && now >= this.nextScanTime) {
      this.postMessage({
        type: 'SCAN_TIME',
        expectedTime: this.nextScanTime,
        actualTime: now,
        delay: now - this.nextScanTime,
        timestamp: now
      });

      // Reset for next cycle
      this.nextScanTime = now + this.scanFrequency;
    }

    // Send tick update every second (for UI countdown)
    if (this.tickCount % 1 === 0) {
      const timeUntilScan = this.nextScanTime ? Math.max(0, this.nextScanTime - now) : 0;
      this.postMessage({
        type: 'TICK',
        timeUntilScan,
        nextScanTime: this.nextScanTime,
        timestamp: now
      });
    }

    // Use a combination of postMessage and setTimeout for the most reliable timing
    // In workers, we can use a more aggressive polling approach since we're not blocking the UI
    const checkInterval = 100; // Check every 100ms for precision
    setTimeout(() => this.timerLoop(), checkInterval);
  }

  stopTimer() {
    this.isRunning = false;
    if (this.timerInterval) {
      clearTimeout(this.timerInterval);
      this.timerInterval = null;
    }
    
    this.postMessage({
      type: 'TIMER_STOPPED',
      timestamp: Date.now()
    });
  }

  updateFrequency(data) {
    const newFrequency = data.scanFrequency;
    if (newFrequency && newFrequency > 0) {
      this.scanFrequency = newFrequency;
      
      // Recalculate next scan time if timer is running
      if (this.isRunning && this.nextScanTime) {
        const now = Date.now();
        const timeRemaining = this.nextScanTime - now;
        const newTimeRemaining = Math.min(timeRemaining, this.scanFrequency);
        this.nextScanTime = now + newTimeRemaining;
      }

      this.postMessage({
        type: 'FREQUENCY_UPDATED',
        scanFrequency: this.scanFrequency,
        nextScanTime: this.nextScanTime,
        timestamp: Date.now()
      });
    }
  }

  resetTimer() {
    if (this.isRunning) {
      this.nextScanTime = Date.now() + this.scanFrequency;
      this.postMessage({
        type: 'TIMER_RESET',
        nextScanTime: this.nextScanTime,
        timestamp: Date.now()
      });
    }
  }

  getStatus() {
    const now = Date.now();
    this.postMessage({
      type: 'STATUS',
      isRunning: this.isRunning,
      scanFrequency: this.scanFrequency,
      nextScanTime: this.nextScanTime,
      timeUntilScan: this.nextScanTime ? Math.max(0, this.nextScanTime - now) : 0,
      tickCount: this.tickCount,
      timestamp: now
    });
  }
}

// Initialize the worker
new ScannerTimerWorker();

