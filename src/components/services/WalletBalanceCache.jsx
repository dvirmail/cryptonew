/**
 * Global Wallet Balance Cache Service
 * 
 * This service provides a centralized cache for wallet balance data
 * to prevent multiple components from repeatedly fetching the same data.
 */

class WalletBalanceCacheService {
  constructor() {
    this.cache = {
      balance: 0,
      lastUpdated: null,
      subscribers: new Set(),
      isLoading: false,
      cacheTimeout: 5000, // 5 seconds cache validity
    };
    
    this.centralWalletStateManager = null;
    this.subscription = null;
  }

  /**
   * Initialize the cache service with the central wallet state manager
   */
  initialize(centralWalletStateManager) {
    if (this.centralWalletStateManager) {
      return; // Already initialized
    }
    
    this.centralWalletStateManager = centralWalletStateManager;
    
    // Subscribe to wallet state changes
    this.subscription = this.centralWalletStateManager.subscribe((walletState) => {
      if (walletState) {
        const totalEquity = parseFloat(walletState.total_equity) || 0;
        this.updateCache(totalEquity);
      }
    });
    
    // Initialize with current state if available
    if (this.centralWalletStateManager.currentState) {
      const walletState = this.centralWalletStateManager.currentState;
      const totalEquity = parseFloat(walletState.total_equity) || 0;
      this.updateCache(totalEquity);
    }
  }

  /**
   * Update the cache with new balance data
   */
  updateCache(newBalance) {
    const now = Date.now();
    
    // Only update if balance changed significantly (> 0.01 USDT)
    if (Math.abs(newBalance - this.cache.balance) > 0.01) {
      this.cache.balance = newBalance;
      this.cache.lastUpdated = now;
      this.cache.isLoading = false;
      
      // Notify all subscribers
      this.notifySubscribers();
    }
  }

  /**
   * Get the current cached balance
   */
  getCachedBalance() {
    return {
      balance: this.cache.balance,
      lastUpdated: this.cache.lastUpdated,
      isLoading: this.cache.isLoading,
      isValid: this.isCacheValid()
    };
  }

  /**
   * Check if the cache is still valid
   */
  isCacheValid() {
    if (!this.cache.lastUpdated) return false;
    return (Date.now() - this.cache.lastUpdated) < this.cacheTimeout;
  }

  /**
   * Subscribe to balance updates
   */
  subscribe(callback) {
    this.cache.subscribers.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.cache.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of balance changes
   */
  notifySubscribers() {
    this.cache.subscribers.forEach(callback => {
      try {
        callback(this.getCachedBalance());
      } catch (error) {
        console.error('[WalletBalanceCache] Error notifying subscriber:', error);
      }
    });
  }

  /**
   * Force refresh the balance from the central wallet state manager
   */
  async refreshBalance() {
    if (!this.centralWalletStateManager) {
      throw new Error('WalletBalanceCache not initialized');
    }
    
    this.cache.isLoading = true;
    this.notifySubscribers();
    
    try {
      // Initialize if needed
      if (!this.centralWalletStateManager.currentState) {
        await this.centralWalletStateManager.initialize('testnet');
      }
      
      const walletState = this.centralWalletStateManager.currentState;
      const totalEquity = parseFloat(walletState.total_equity) || 0;
      this.updateCache(totalEquity);
      
    } catch (error) {
      console.error('[WalletBalanceCache] Failed to refresh balance:', error);
      this.cache.isLoading = false;
      this.notifySubscribers();
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      balance: this.cache.balance,
      lastUpdated: this.cache.lastUpdated,
      subscriberCount: this.cache.subscribers.size,
      isValid: this.isCacheValid(),
      isLoading: this.cache.isLoading
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.subscription) {
      this.subscription();
      this.subscription = null;
    }
    this.cache.subscribers.clear();
    this.centralWalletStateManager = null;
  }
}

// Create singleton instance
const walletBalanceCache = new WalletBalanceCacheService();

// Expose cache stats globally for debugging
if (typeof window !== 'undefined') {
  window.getWalletCacheStats = () => walletBalanceCache.getStats();
}

// Export the singleton instance
export default walletBalanceCache;

// Also export the class for testing purposes
export { WalletBalanceCacheService };
