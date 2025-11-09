/**
 * BackgroundTimerService
 * 
 * Manages the scanner countdown timer using a Web Worker to avoid browser throttling.
 * The timer runs in a separate thread, which is significantly less throttled when
 * the tab is inactive or when playing full-screen games.
 */

export class BackgroundTimerService {
  constructor(scannerService) {
    this.scannerService = scannerService;
    this.worker = null;
    this.isWorkerSupported = typeof Worker !== 'undefined';
    this.isWorkerReady = false;
    this.isTimerRunning = false;
    this.messageHandlers = new Map();
    this.retryCount = 0;
    this.maxRetries = 3;
    
    // Bind methods
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);
  }

  /**
   * Initialize the Web Worker
   */
  async initialize() {
    if (!this.isWorkerSupported) {
      console.warn('[BackgroundTimerService] Web Workers not supported, falling back to main thread timer');
      return false;
    }

    try {
      // Create worker from public directory
      this.worker = new Worker('/scanner-timer-worker.js');
      
      // Set up event listeners
      this.worker.onmessage = this.handleWorkerMessage;
      this.worker.onerror = this.handleWorkerError;
      this.worker.onmessageerror = (event) => {
        console.error('[BackgroundTimerService] Worker message error:', event);
      };

      // Wait for worker ready signal
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 10000);

        const readyHandler = (event) => {
          if (event.data.type === 'WORKER_READY') {
            clearTimeout(timeout);
            this.isWorkerReady = true;
            this.retryCount = 0;
            console.log('[BackgroundTimerService] ✅ Timer worker initialized successfully');
            resolve(true);
          }
        };

        this.worker.addEventListener('message', readyHandler, { once: true });
      });

    } catch (error) {
      console.error('[BackgroundTimerService] Failed to initialize worker:', error);
      this.worker = null;
      return false;
    }
  }

  /**
   * Handle messages from the worker
   */
  handleWorkerMessage(event) {
    const { type, ...data } = event.data;

    switch (type) {
      case 'WORKER_READY':
        // Already handled in initialize()
        break;
      
      case 'SCAN_TIME':
        // Time to trigger a scan cycle
        this.onScanTime(data);
        break;
      
      case 'TICK':
        // Update countdown in UI
        this.onTick(data);
        break;
      
      case 'TIMER_STARTED':
      case 'TIMER_STOPPED':
      case 'FREQUENCY_UPDATED':
      case 'TIMER_RESET':
        // Timer state changes
        this.onTimerStateChange(type, data);
        break;
      
      case 'STATUS':
        // Status response
        this.onStatus(data);
        break;
      
      case 'ERROR':
        console.error('[BackgroundTimerService] Worker error:', data);
        break;
      
      default:
        console.warn('[BackgroundTimerService] Unknown message type:', type);
    }
  }

  /**
   * Handle worker errors
   */
  handleWorkerError(error) {
    console.error('[BackgroundTimerService] Worker error:', error);
    
    // Attempt to restart worker if not exceeded retry limit
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`[BackgroundTimerService] Attempting to restart worker (attempt ${this.retryCount}/${this.maxRetries})`);
      setTimeout(() => {
        this.restartWorker();
      }, 2000);
    } else {
      console.error('[BackgroundTimerService] Worker restart attempts exhausted. Falling back to main thread timer.');
      this.fallbackToMainThread();
    }
  }

  /**
   * Restart the worker
   */
  async restartWorker() {
    this.terminate();
    await this.initialize();
  }

  /**
   * Start the timer
   */
  startTimer(scanFrequency) {
    if (!this.isWorkerReady || !this.worker) {
      console.warn('[BackgroundTimerService] Worker not ready, falling back to main thread timer');
      this.fallbackToMainThread();
      return;
    }

    try {
      this.worker.postMessage({
        type: 'START_TIMER',
        data: { scanFrequency }
      });
      this.isTimerRunning = true;
      console.log(`[BackgroundTimerService] ⏰ Timer started (${scanFrequency / 1000}s interval) in background worker`);
    } catch (error) {
      console.error('[BackgroundTimerService] Failed to start timer:', error);
      this.fallbackToMainThread();
    }
  }

  /**
   * Stop the timer
   */
  stopTimer() {
    if (this.worker && this.isWorkerReady) {
      try {
        this.worker.postMessage({ type: 'STOP_TIMER' });
        this.isTimerRunning = false;
        console.log('[BackgroundTimerService] ⏹️ Timer stopped');
      } catch (error) {
        console.error('[BackgroundTimerService] Failed to stop timer:', error);
      }
    }
  }

  /**
   * Update scan frequency
   */
  updateFrequency(scanFrequency) {
    if (this.worker && this.isWorkerReady) {
      try {
        this.worker.postMessage({
          type: 'UPDATE_FREQUENCY',
          data: { scanFrequency }
        });
      } catch (error) {
        console.error('[BackgroundTimerService] Failed to update frequency:', error);
      }
    }
  }

  /**
   * Reset the timer
   */
  resetTimer() {
    if (this.worker && this.isWorkerReady) {
      try {
        this.worker.postMessage({ type: 'RESET_TIMER' });
      } catch (error) {
        console.error('[BackgroundTimerService] Failed to reset timer:', error);
      }
    }
  }

  /**
   * Get timer status
   */
  getStatus() {
    if (this.worker && this.isWorkerReady) {
      try {
        this.worker.postMessage({ type: 'GET_STATUS' });
      } catch (error) {
        console.error('[BackgroundTimerService] Failed to get status:', error);
      }
    }
  }

  /**
   * Handle scan time event from worker
   */
  onScanTime(data) {
    const { expectedTime, actualTime, delay } = data;
    
    if (delay > 1000) {
      console.warn(`[BackgroundTimerService] ⚠️ Scan time delayed by ${(delay / 1000).toFixed(1)}s (expected: ${new Date(expectedTime).toISOString()}, actual: ${new Date(actualTime).toISOString()})`);
    } else {
      console.log(`[BackgroundTimerService] ✅ Scan time triggered (delay: ${delay}ms)`);
    }

    // Trigger scan cycle on main thread
    if (this.scannerService && this.scannerService.scanEngineService) {
      this.scannerService.scanEngineService.scanCycle().catch(e => {
        console.error(`[BackgroundTimerService] ❌ Scan cycle error: ${e.message}`, e);
      });
    }
  }

  /**
   * Handle tick event from worker (for UI updates)
   */
  onTick(data) {
    const { timeUntilScan, nextScanTime } = data;
    
    // Update scanner state with countdown info
    if (this.scannerService) {
      this.scannerService.state.nextScanTime = nextScanTime;
      this.scannerService.notifySubscribers();
    }
  }

  /**
   * Handle timer state changes
   */
  onTimerStateChange(type, data) {
    // Update scanner state if needed
    if (this.scannerService && data.nextScanTime) {
      this.scannerService.state.nextScanTime = data.nextScanTime;
      this.scannerService.notifySubscribers();
    }
  }

  /**
   * Handle status response
   */
  onStatus(data) {
    // Update scanner state with status
    if (this.scannerService && data.nextScanTime) {
      this.scannerService.state.nextScanTime = data.nextScanTime;
      this.scannerService.notifySubscribers();
    }
  }

  /**
   * Fallback to main thread timer (if worker fails)
   */
  fallbackToMainThread() {
    console.warn('[BackgroundTimerService] Falling back to main thread timer (may be throttled when tab is inactive)');
    // The LifecycleService will handle the main thread timer
    this.isWorkerReady = false;
  }

  /**
   * Check if worker is available
   */
  isAvailable() {
    return this.isWorkerSupported && this.worker && this.isWorkerReady;
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isWorkerReady = false;
      this.isTimerRunning = false;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopTimer();
    this.terminate();
  }
}

