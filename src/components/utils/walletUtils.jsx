import { queueEntityCall } from './apiQueue';

let singletonWallet = null;

/**
 * Retrieves the demo wallet from the database, creating it if it doesn't exist.
 * Uses a singleton pattern to avoid redundant database calls within the same session.
 * @param {string} calledFrom - A string indicating where the function was called from, for logging.
 * @param {boolean} forceRefresh - If true, bypasses the singleton cache and fetches from the DB.
 * @returns {Promise<object|null>} The virtual wallet state object.
 */
export const getOrCreateDemoWallet = async (calledFrom = 'unknown', forceRefresh = false) => {
  //console.log(`[WALLET_UTILS] getOrCreateDemoWallet called from: ${calledFrom}`);

  if (singletonWallet && !forceRefresh) {
    //console.log('[WALLET_UTILS] Returning cached wallet from singleton');
    return singletonWallet;
  }
  
  if (forceRefresh) {
    //console.log('[WALLET_UTILS] Force refresh requested, bypassing singleton cache.');
    singletonWallet = null;
  }

  try {
    //console.log('[WALLET_UTILS] Loading wallet from database...');
    const wallets = await queueEntityCall('VirtualWalletState', 'list', '-last_updated_timestamp', 1);

    if (wallets && wallets.length > 0) {
      //console.log(`[WALLET_UTILS] Found existing wallet with ID: ${wallets[0].id}`);
      singletonWallet = wallets[0];
      return singletonWallet;
    } else {
      //console.log('[WALLET_UTILS] No existing wallet found, creating a new one...');
      const newWallet = await queueEntityCall('VirtualWalletState', 'create', {
        balance_usdt: 10000,
        initial_balance_usdt: 10000,
        positions: [],
        last_updated_timestamp: new Date().toISOString(),
      });
      //console.log(`[WALLET_UTILS] New wallet created with ID: ${newWallet.id}`);
      singletonWallet = newWallet;
      return singletonWallet;
    }
  } catch (error) {
    console.error('[WALLET_UTILS] Error getting or creating wallet:', error);
    // In case of error, return a default structure to prevent app crashes
    return {
      balance_usdt: 10000,
      initial_balance_usdt: 10000,
      positions: [],
      total_realized_pnl: 0,
      total_trades_count: 0,
      winning_trades_count: 0,
      total_gross_profit: 0,
      total_gross_loss: 0,
    };
  }
};