// Worker Utilities - Shared helper functions for worker modules

export class WorkerLogger {
  constructor(postMessageFn) {
    this.postMessage = postMessageFn;
  }

  log(level, message, details = null) {
    this.postMessage({
      type: 'LOG_MESSAGE',
      level,
      message,
      details,
      timestamp: Date.now()
    });
  }

  info(message, details = null) {
    this.log('info', message, details);
  }

  warn(message, details = null) {
    this.log('warn', message, details);
  }

  error(message, details = null) {
    this.log('error', message, details);
  }

  debug(message, details = null) {
    this.log('debug', message, details);
  }
}

export class WorkerPerformanceMonitor {
  constructor(logger) {
    this.logger = logger;
    this.metrics = new Map();
  }

  startTimer(name) {
    this.metrics.set(name, { start: performance.now() });
  }

  endTimer(name) {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.end = performance.now();
      metric.duration = metric.end - metric.start;
      return metric.duration;
    }
    return 0;
  }

  logTimer(name, details = null) {
    const duration = this.endTimer(name);
    if (duration > 0) {
      this.logger.debug(`${name} completed in ${duration.toFixed(2)}ms`, details);
    }
  }

  getMetrics() {
    const results = {};
    for (const [name, metric] of this.metrics.entries()) {
      if (metric.duration) {
        results[name] = {
          duration: metric.duration,
          start: metric.start,
          end: metric.end
        };
      }
    }
    return results;
  }

  clearMetrics() {
    this.metrics.clear();
  }
}

export class WorkerErrorHandler {
  constructor(logger, postMessageFn) {
    this.logger = logger;
    this.postMessage = postMessageFn;
  }

  handleError(error, context = 'Unknown', shouldThrow = false) {
    const errorMessage = error?.message || 'Unknown error';
    const errorStack = error?.stack || 'No stack trace available';
    
    this.logger.error(`${context}: ${errorMessage}`, { stack: errorStack });
    
    this.postMessage({
      type: 'ERROR',
      error: errorMessage,
      context,
      stack: errorStack,
      timestamp: Date.now()
    });

    if (shouldThrow) {
      throw error;
    }
  }

  wrapAsync(asyncFn, context = 'Async operation') {
    return async (...args) => {
      try {
        return await asyncFn(...args);
      } catch (error) {
        this.handleError(error, context, true);
      }
    };
  }
}

export function formatMemorySize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, unitIndex);
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function createWorkerConfig(defaultConfig = {}) {
  return {
    maxRetries: 3,
    timeoutMs: 30000,
    memoryLimitMB: 512,
    cacheMaxSize: 100,
    cacheTimeoutMs: 300000, // 5 minutes
    logLevel: 'info',
    ...defaultConfig
  };
}

export function isMemoryLimitReached(limitMB = 512) {
  if (typeof performance !== 'undefined' && performance.memory) {
    const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
    return usedMB > limitMB;
  }
  return false;
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createAbortablePromise(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}