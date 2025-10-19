// Worker Manager - Handles Web Worker lifecycle and communication
import { apiQueue } from '../utils/apiQueue';

class WorkerManager {
  constructor() {
    this.worker = null;
    this.isWorkerSupported = typeof Worker !== 'undefined';
    this.isWorkerReady = false;
    this.messageQueue = [];
    this.eventListeners = new Map();
    this.workerRetryCount = 0;
    this.maxWorkerRetries = 3;
    
    // Bind methods
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);
  }

  // Check if worker is available and supported
  isAvailable() {
    return this.isWorkerSupported && this.worker && this.isWorkerReady;
  }

  // Initialize the worker
  async initializeWorker() {
    if (!this.isWorkerSupported) {
      console.warn('Web Workers not supported in this browser');
      return false;
    }

    try {
      // Create worker from the worker file - Updated path
      this.worker = new Worker('/components/workers/AutoScannerWorker.js');
      
      // Set up event listeners
      this.worker.onmessage = this.handleWorkerMessage;
      this.worker.onerror = this.handleWorkerError;
      this.worker.onmessageerror = (event) => {
        console.error('Worker message error:', event);
        this.emit('worker_error', { error: 'Message serialization error' });
      };

      // Wait for worker ready signal with timeout
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 10000);

        const readyHandler = (event) => {
          if (event.data.type === 'WORKER_READY') {
            clearTimeout(timeout);
            this.isWorkerReady = true;
            this.workerRetryCount = 0;
            console.log('Auto Scanner Worker initialized successfully');
            
            // Process any queued messages
            this.processMessageQueue();
            
            resolve(true);
          }
        };

        this.worker.addEventListener('message', readyHandler, { once: true });
      });

    } catch (error) {
      console.error('Failed to initialize worker:', error);
      this.worker = null;
      return false;
    }
  }

  // Handle messages from worker
  handleWorkerMessage(event) {
    const { type, ...data } = event.data;
    
    // Emit the message to registered listeners
    this.emit(type.toLowerCase(), data);
    
    // Log worker messages for debugging
    if (type === 'LOG_MESSAGE') {
      console.log(`[Worker ${data.level.toUpperCase()}]:`, data.message);
    }
  }

  // Handle worker errors
  handleWorkerError(error) {
    console.error('Worker error:', error);
    this.emit('worker_error', { error: error.message });
    
    // Attempt to restart worker if not exceeded retry limit
    if (this.workerRetryCount < this.maxWorkerRetries) {
      this.workerRetryCount++;
      console.log(`Attempting to restart worker (attempt ${this.workerRetryCount}/${this.maxWorkerRetries})`);
      setTimeout(() => {
        this.restartWorker();
      }, 2000);
    } else {
      console.error('Worker restart attempts exhausted. Falling back to main thread.');
      this.emit('worker_fallback_required', {});
    }
  }

  // Restart the worker
  async restartWorker() {
    this.terminateWorker();
    await this.initializeWorker();
  }

  // Terminate the worker
  terminateWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isWorkerReady = false;
    }
  }

  // Send message to worker
  postMessage(type, data = {}) {
    const message = { type: type.toUpperCase(), data };

    if (!this.isAvailable()) {
      // Queue message if worker not ready
      this.messageQueue.push(message);
      return;
    }

    try {
      this.worker.postMessage(message);
    } catch (error) {
      console.error('Failed to send message to worker:', error);
      this.emit('worker_error', { error: 'Failed to send message to worker' });
    }
  }

  // Process queued messages
  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.isAvailable()) {
      const message = this.messageQueue.shift();
      this.worker.postMessage(message);
    }
  }

  // Event listener management
  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
  }

  off(eventType, callback) {
    if (this.eventListeners.has(eventType)) {
      const listeners = this.eventListeners.get(eventType);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(eventType, data) {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }
  }

  // High-level scanner control methods
  async startScanner(config) {
    this.postMessage('START_SCANNER', config);
  }

  async stopScanner() {
    this.postMessage('STOP_SCANNER');
  }

  async pauseScanner() {
    this.postMessage('PAUSE_SCANNER');
  }

  async resumeScanner() {
    this.postMessage('RESUME_SCANNER');
  }

  async updateSettings(settings) {
    this.postMessage('UPDATE_SETTINGS', settings);
  }

  async updateCoins(coins) {
    this.postMessage('UPDATE_COINS', coins);
  }

  async cleanupMemory() {
    this.postMessage('CLEANUP_MEMORY');
  }

  async getMemoryStats() {
    this.postMessage('GET_MEMORY_STATS');
  }

  // Ping worker to check if it's responsive
  async pingWorker() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker ping timeout'));
      }, 5000);

      const pongHandler = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      this.on('pong', pongHandler);
      this.postMessage('PING');
    });
  }

  // Get current worker status
  getStatus() {
    return {
      isSupported: this.isWorkerSupported,
      isReady: this.isWorkerReady,
      hasWorker: !!this.worker,
      retryCount: this.workerRetryCount,
      queuedMessages: this.messageQueue.length
    };
  }
}

// Create singleton instance
const workerManager = new WorkerManager();

export default workerManager;