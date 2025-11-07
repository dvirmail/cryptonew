import { queueEntityCall } from '@/components/utils/apiQueue';
import { v4 as uuidv4 } from 'uuid';

/**
 * Saves a backtest match as a Trade record in PostgreSQL
 * Uses the same structure as live trades but with trading_mode='backtest'
 * 
 * @param {Object} match - Backtest match object from backtestProcessor
 * @param {Object} combination - BacktestCombination object (for strategy metadata)
 * @returns {Promise<Object>} Created trade record
 */
export async function saveBacktestTradeToDB(match, combination) {
    if (!match || !combination) {
        throw new Error('Match and combination are required');
    }

    // Calculate trade metrics from match
    const entryPrice = match.price;
    const exitPrice = match.price + (match.price * (match.priceMove / 100)); // Convert % move to price
    const quantityCrypto = 100 / entryPrice; // Standardized quantity for backtest (100 USDT position)
    const entryValueUSDT = 100; // Standardized for backtest
    const exitValueUSDT = exitPrice * quantityCrypto;
    const pnlUSDT = exitValueUSDT - entryValueUSDT;
    const pnlPercentage = match.priceMove; // Already in percentage

    // Calculate duration from match data
    const entryTimestamp = new Date(match.time);
    const exitTimestamp = match.exitTime ? new Date(match.exitTime) : new Date(entryTimestamp.getTime() + (match.timeToPeak || 3600) * 1000);
    const durationSeconds = Math.floor((exitTimestamp - entryTimestamp) / 1000);

    // Build trade record (matching live trade structure)
    const tradeRecord = {
        trade_id: uuidv4(),
        position_id: `backtest_${match.time}_${uuidv4().substring(0, 8)}`,
        
        // Basic trade info
        symbol: match.coin.replace('/', ''),
        side: 'BUY', // Backtest assumes long positions
        quantity_crypto: quantityCrypto,
        entry_price: entryPrice,
        exit_price: exitPrice,
        entry_value_usdt: entryValueUSDT,
        exit_value_usdt: exitValueUSDT,
        pnl_usdt: pnlUSDT,
        pnl_percentage: pnlPercentage,
        
        // Timestamps
        entry_timestamp: entryTimestamp.toISOString(),
        exit_timestamp: exitTimestamp.toISOString(),
        duration_seconds: durationSeconds,
        
        // Trading mode (CRITICAL: identifies as backtest)
        trading_mode: 'backtest',
        
        // Strategy metadata
        strategy_name: combination.combinationName || 'Unknown Strategy',
        trigger_signals: JSON.stringify(match.signals || []),
        combined_strength: match.combinedStrength || 0,
        
        // Market context
        market_regime: match.marketRegime || 'unknown',
        regime_confidence: 0.8, // Backtest has fixed confidence
        
        // Performance metrics
        exit_reason: match.successful ? 'Target Reached' : 'Stop Loss / Reversal',
        max_drawdown: match.maxDrawdown || 0,
        
        // Analytics fields (if available from match)
        fear_greed_score: null, // Not available in backtest
        fear_greed_classification: null,
        lpm_score: null,
        conviction_score: null,
        conviction_breakdown: null,
        conviction_multiplier: null,
        atr_value: null,
        is_event_driven_strategy: combination.is_event_driven_strategy || false,
        
        // Fees (standardized for backtest)
        total_fees_usdt: (entryValueUSDT + exitValueUSDT) * 0.001, // 0.1% fee
        commission_migrated: true
    };

    try {
        const createdTrade = await queueEntityCall('Trade', 'create', tradeRecord);
        // Removed individual trade log to prevent console flooding - see batch summary instead
        return createdTrade;
    } catch (error) {
        console.error(`[BacktestTradeSaver] ❌ Failed to save backtest trade:`, error);
        throw error;
    }
}

/**
 * Batch saves multiple backtest matches as trades
 * Uses chunked processing to prevent API queue overflow
 * @param {Array} matches - Array of match objects
 * @param {Object} combination - BacktestCombination object
 * @returns {Promise<Array>} Array of created trade records
 */
export async function saveBacktestTradesBatch(matches, combination) {
    if (!matches || matches.length === 0) {
        return [];
    }

    // Chunk size: Process 10 trades at a time to prevent queue overflow
    const CHUNK_SIZE = 10;
    const DELAY_BETWEEN_CHUNKS = 100; // 100ms delay between chunks
    
    const successful = [];
    
    // Process matches in chunks
    for (let i = 0; i < matches.length; i += CHUNK_SIZE) {
        const chunk = matches.slice(i, i + CHUNK_SIZE);
        
        // Save chunk in parallel
        const chunkPromises = chunk.map(match => 
            saveBacktestTradeToDB(match, combination).catch(error => {
                console.error(`[BacktestTradeSaver] Failed to save match:`, error);
                return null; // Return null for failed saves
            })
        );
        
        const chunkResults = await Promise.all(chunkPromises);
        const chunkSuccessful = chunkResults.filter(r => r !== null);
        successful.push(...chunkSuccessful);
        
        // Add delay between chunks to prevent queue overflow (except for last chunk)
        if (i + CHUNK_SIZE < matches.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
        }
    }
    
    // Log only if there's a significant batch to reduce console noise
    // These are individual trade records for analytics, not strategy combinations
    if (matches.length >= 10) {
      console.log(`[BacktestTradeSaver] ✅ Saved ${successful.length}/${matches.length} backtest trade records (analytics data)`);
    }
    return successful;
}

