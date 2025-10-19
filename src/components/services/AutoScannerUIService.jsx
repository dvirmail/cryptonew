// Auto Scanner UI Service - Manages scanner from UI perspective
// This will coordinate between the original scanner and the new worker
import workerManager from './WorkerManager';

class AutoScannerUIService {
  constructor() {
    this.useWorker = false; // Feature flag - start with false for safety
    this.originalScanner = null; // Will hold reference to original scanner
    this.isInitialized = false;
    
    // Scanner state
    this.isRunning = false;
    this.isPaused = false;
    this.currentConfig = null;
    this.lastResults = null;
    this.logs = [];
    this.maxLogs = 1000;
    
    // Event listeners for UI updates
    this.eventListeners = new Map();
    
    // Bind methods
    this.handleWorkerEvent = this.handleWorkerEvent.bind(this);
  }

  async initialize(originalScannerInstance = null) {
    if (this.isInitialized) return;

    this.originalScanner = originalScannerInstance;

    // Initialize worker manager
    if (workerManager.isAvailable() || await workerManager.initializeWorker()) {
      this.setupWorkerEventHandlers();
      console.log('AutoScannerUIService: Worker available and ready');
    } else {
      console.log('AutoScannerUIService: Worker not available, will use main thread');
    }

    this.isInitialized = true;
  }

  setupWorkerEventHandlers() {
    // Remove any existing listeners
    workerManager.off('scanner_status', this.handleWorkerEvent);
    workerManager.off('scan_cycle_complete', this.handleWorkerEvent);
    workerManager.off('log_message', this.handleWorkerEvent);
    workerManager.off('worker_error', this.handleWorkerEvent);

    // Add event listeners
    workerManager.on('scanner_status', this.handleWorkerEvent);
    workerManager.on('scan_cycle_complete', this.handleWorkerEvent);
    workerManager.on('scan_cycle_start', this.handleWorkerEvent);
    workerManager.on('log_message', this.handleWorkerEvent);
    workerManager.on('worker_error', this.handleWorkerEvent);
    workerManager.on('memory_stats', this.handleWorkerEvent);
    workerManager.on('worker_fallback_required', this.handleWorkerEvent);
  }

  handleWorkerEvent(data) {
    // Update internal state based on worker events
    switch (data.type || 'unknown') {
      case 'scanner_status':
        this.isRunning = data.status === 'running';
        this.isPaused = data.status === 'paused';
        break;
      case 'scan_cycle_complete':
        this.lastResults = data.results;
        break;
      case 'log_message':
        this.addLog(data.level, data.message, data.details);
        break;
      case 'worker_error':
        this.addLog('error', `Worker Error: ${data.error}`);
        break;
      case 'worker_fallback_required':
        this.addLog('warn', 'Worker failed, falling back to main thread scanner');
        this.useWorker = false;
        break;
    }

    // Emit to UI listeners
    this.emit('scanner_update', data);
  }

  // Toggle between worker and main thread
  async toggleWorkerMode(useWorker) {
    if (this.isRunning) {
      throw new Error('Cannot change worker mode while scanner is running');
    }

    const wasUsingWorker = this.useWorker;
    this.useWorker = useWorker && workerManager.isAvailable();

    if (this.useWorker && !wasUsingWorker) {
      this.addLog('info', 'Switched to Web Worker mode for better performance');
    } else if (!this.useWorker && wasUsingWorker) {
      this.addLog('info', 'Switched to Main Thread mode');
    }

    return this.useWorker;
  }

  // Scanner control methods
  async startScanner(config) {
    if (this.isRunning) {
      await this.stopScanner();
    }

    this.currentConfig = config;

    if (this.useWorker && workerManager.isAvailable()) {
      this.addLog('info', 'Starting scanner in Web Worker mode');
      await workerManager.startScanner(config);
    } else {
      this.addLog('info', 'Starting scanner in Main Thread mode');
      if (this.originalScanner && typeof this.originalScanner.startScanning === 'function') {
        await this.originalScanner.startScanning(config);
      } else {
        throw new Error('Original scanner not available for main thread mode');
      }
    }

    this.isRunning = true;
    this.isPaused = false;
  }

  async stopScanner() {
    if (!this.isRunning) return;

    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.stopScanner();
    } else if (this.originalScanner && typeof this.originalScanner.stopScanning === 'function') {
      await this.originalScanner.stopScanning();
    }

    this.isRunning = false;
    this.isPaused = false;
    this.addLog('info', 'Scanner stopped');
  }

  async pauseScanner() {
    if (!this.isRunning || this.isPaused) return;

    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.pauseScanner();
    } else if (this.originalScanner && typeof this.originalScanner.pauseScanning === 'function') {
      await this.originalScanner.pauseScanning();
    }

    this.isPaused = true;
    this.addLog('info', 'Scanner paused');
  }

  async resumeScanner() {
    if (!this.isRunning || !this.isPaused) return;

    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.resumeScanner();
    } else if (this.originalScanner && typeof this.originalScanner.resumeScanning === 'function') {
      await this.originalScanner.resumeScanning();
    }

    this.isPaused = false;
    this.addLog('info', 'Scanner resumed');
  }

  async updateSettings(settings) {
    this.currentConfig = { ...this.currentConfig, ...settings };

    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.updateSettings(settings);
    } else if (this.originalScanner && typeof this.originalScanner.updateSettings === 'function') {
      await this.originalScanner.updateSettings(settings);
    }
  }

  async updateCoins(coins) {
    if (this.currentConfig) {
      this.currentConfig.coins = coins;
    }

    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.updateCoins(coins);
    } else if (this.originalScanner && typeof this.originalScanner.updateCoins === 'function') {
      await this.originalScanner.updateCoins(coins);
    }
  }

  // Memory management
  async cleanupMemory() {
    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.cleanupMemory();
    } else if (this.originalScanner && typeof this.originalScanner.cleanupMemory === 'function') {
      await this.originalScanner.cleanupMemory();
    }

    // Clean up local logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    this.addLog('info', 'Memory cleanup completed');
  }

  async getMemoryStats() {
    if (this.useWorker && workerManager.isAvailable()) {
      await workerManager.getMemoryStats();
    } else {
      // Return basic stats for main thread
      const stats = {
        mode: 'main_thread',
        logs_count: this.logs.length,
        timestamp: Date.now()
      };

      if (typeof performance !== 'undefined' && performance.memory) {
        stats.memory = {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit
        };
      }

      this.emit('memory_stats', stats);
    }
  }

  // Logging
  addLog(level, message, details = null) {
    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      details,
      id: Date.now() + Math.random()
    };

    this.logs.push(logEntry);

    // Trim logs if needed
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Emit to UI
    this.emit('log_added', logEntry);
  }

  // Event management
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
          console.error(`Error in UI service event listener for ${eventType}:`, error);
        }
      });
    }
  }

  // Status getters
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      useWorker: this.useWorker,
      workerAvailable: workerManager.isAvailable(),
      currentConfig: this.currentConfig,
      lastResults: this.lastResults,
      logs: this.logs.slice(-100), // Return last 100 logs
      workerStatus: workerManager.getStatus()
    };
  }

  isUsingWorker() {
    return this.useWorker && workerManager.isAvailable();
  }

  isUsingMainThread() {
    return !this.useWorker || !workerManager.isAvailable();
  }
}

// Create singleton instance
const autoScannerUIService = new AutoScannerUIService();

export default autoScannerUIService;