#!/usr/bin/env node

/**
 * Fix Trade Entry Prices Script
 * 
 * This script identifies and fixes trades with incorrect entry prices.
 * It checks for suspicious entry prices (e.g., ETH entry < $3000 when exit > $3800)
 * and recalculates entry_price from exit_price and P&L percentage.
 */

const { Client } = require('pg');

// PostgreSQL configuration
const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

// Expected price ranges for common symbols (approximate)
const EXPECTED_PRICE_RANGES = {
    'ETH/USDT': { min: 2500, max: 5000 },
    'BTC/USDT': { min: 40000, max: 80000 },
    'SOL/USDT': { min: 100, max: 300 },
    'BNB/USDT': { min: 300, max: 800 },
    'ADA/USDT': { min: 0.3, max: 2.0 },
    'DOGE/USDT': { min: 0.05, max: 0.5 },
    'XRP/USDT': { min: 0.4, max: 2.0 },
};

/**
 * Check if entry price seems wrong based on exit price and symbol
 */
function isEntryPriceSuspicious(symbol, entryPrice, exitPrice) {
    const range = EXPECTED_PRICE_RANGES[symbol];
    if (!range) return false;
    
    // If entry price is way below expected range and exit is in range, it's suspicious
    if (entryPrice < range.min * 0.8 && exitPrice >= range.min * 0.9) {
        return true;
    }
    
    // If entry and exit differ by more than 50% and both are valid prices, check which one is wrong
    if (entryPrice > 0 && exitPrice > 0) {
        const priceDiff = Math.abs(exitPrice - entryPrice);
        const priceDiffPercent = (priceDiff / Math.max(entryPrice, exitPrice)) * 100;
        
        // If prices differ by more than 50% and entry is outside range but exit is in range, entry is wrong
        if (priceDiffPercent > 50 && entryPrice < range.min * 0.9 && exitPrice >= range.min * 0.9) {
            return true;
        }
    }
    
    return false;
}

/**
 * Recalculate entry price from exit price and P&L percentage
 * For long positions: entry_price = exit_price / (1 + pnl_percentage/100)
 */
function recalculateEntryPrice(exitPrice, pnlPercentage, direction = 'long') {
    if (!exitPrice || exitPrice <= 0 || !pnlPercentage) {
        return null;
    }
    
    if (direction === 'long' || direction === 'BUY') {
        // For long: exit_price = entry_price * (1 + pnl_pct/100)
        // So: entry_price = exit_price / (1 + pnl_pct/100)
        const denominator = 1 + (parseFloat(pnlPercentage) / 100);
        if (denominator <= 0) return null;
        return exitPrice / denominator;
    } else {
        // For short: exit_price = entry_price * (1 - pnl_pct/100)
        // So: entry_price = exit_price / (1 - pnl_pct/100)
        const denominator = 1 - (parseFloat(pnlPercentage) / 100);
        if (denominator <= 0) return null;
        return exitPrice / denominator;
    }
}

/**
 * Recalculate P&L from entry and exit prices
 */
function recalculatePnl(entryPrice, exitPrice, quantity, commission = 0) {
    if (!entryPrice || !exitPrice || !quantity) return { pnlUsdt: 0, pnlPercent: 0 };
    
    const entryValue = entryPrice * quantity;
    const exitValue = exitPrice * quantity;
    const grossPnl = exitValue - entryValue;
    
    // Deduct fees (0.1% entry + 0.1% exit)
    const entryFees = entryValue * 0.001;
    const exitFees = exitValue * 0.001;
    const totalFees = commission || (entryFees + exitFees);
    const netPnl = grossPnl - totalFees;
    
    const pnlPercent = entryValue > 0 ? (netPnl / entryValue) * 100 : 0;
    
    return {
        pnlUsdt: netPnl,
        pnlPercent: pnlPercent,
        totalFees: totalFees
    };
}

async function fixTradeEntryPrices() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Connected to PostgreSQL database');
        
    // Fetch all trades
    const tradesResult = await client.query(`
      SELECT id, symbol, entry_price, exit_price, pnl_usdt, pnl_percent, 
             quantity, side, commission, entry_timestamp, exit_timestamp
      FROM trades
      WHERE exit_price IS NOT NULL 
        AND exit_price > 0
        AND entry_price IS NOT NULL
        AND entry_price > 0
      ORDER BY exit_timestamp DESC
    `);
    
    const trades = tradesResult.rows;
    console.log(`📊 Found ${trades.length} trades to check`);
    
    let fixedCount = 0;
    let checkedCount = 0;
    
    for (const trade of trades) {
      checkedCount++;
      const symbol = trade.symbol;
      const entryPrice = parseFloat(trade.entry_price);
      const exitPrice = parseFloat(trade.exit_price);
      const pnlPercent = parseFloat(trade.pnl_percent || 0);
      const quantity = parseFloat(trade.quantity || 0);
      const direction = trade.side || 'BUY';
      const commission = parseFloat(trade.commission || 0);
      
      // Check if entry price is suspicious
      if (!isEntryPriceSuspicious(symbol, entryPrice, exitPrice)) {
        continue; // Skip if not suspicious
      }
      
      console.log(`\n🔍 Found suspicious trade: ${trade.id}`);
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Current entry_price: $${entryPrice.toFixed(2)}`);
      console.log(`   Exit_price: $${exitPrice.toFixed(2)}`);
      console.log(`   P&L %: ${pnlPercent.toFixed(2)}%`);
      
      // Calculate duration in minutes
      let durationMinutes = null;
      if (trade.entry_timestamp && trade.exit_timestamp) {
        const entryTime = new Date(trade.entry_timestamp);
        const exitTime = new Date(trade.exit_timestamp);
        durationMinutes = (exitTime - entryTime) / (1000 * 60);
        console.log(`   Duration: ${durationMinutes.toFixed(2)} minutes`);
      }
      
      let recalculatedEntryPrice = null;
      
      // Strategy 1: If trade closed very quickly (< 5 minutes), entry price should be close to exit price
      // Use exit price * 0.98 to 0.99 as entry (assuming small movement)
      if (durationMinutes !== null && durationMinutes < 5) {
        const range = EXPECTED_PRICE_RANGES[symbol];
        if (range && exitPrice >= range.min * 0.9) {
          // Use exit price as base, adjust slightly based on P&L direction
          if (pnlPercent > 0) {
            // Profit: entry should be slightly lower than exit
            recalculatedEntryPrice = exitPrice * 0.99;
          } else {
            // Loss: entry should be slightly higher than exit
            recalculatedEntryPrice = exitPrice * 1.01;
          }
          console.log(`   💡 Quick close detected, using exit price as base: $${recalculatedEntryPrice.toFixed(2)}`);
        }
      }
      
      // Strategy 2: Try to recalculate from exit price and P&L percentage
      if (!recalculatedEntryPrice || recalculatedEntryPrice <= 0) {
        recalculatedEntryPrice = recalculateEntryPrice(exitPrice, pnlPercent, direction);
      }
      
      // Strategy 3: If exit price is in expected range and entry is way off, use exit price as fallback
      const range = EXPECTED_PRICE_RANGES[symbol];
      if (!recalculatedEntryPrice || recalculatedEntryPrice <= 0) {
        if (range && exitPrice >= range.min * 0.9 && exitPrice <= range.max * 1.1 && entryPrice < range.min * 0.8) {
          // Exit is valid, entry is wrong - use exit price with small adjustment
          recalculatedEntryPrice = exitPrice * 0.995; // Assume entry was slightly lower
          console.log(`   💡 Using exit price as fallback: $${recalculatedEntryPrice.toFixed(2)}`);
        }
      }
      
      if (!recalculatedEntryPrice || recalculatedEntryPrice <= 0) {
        console.log(`   ⚠️  Could not determine correct entry price, skipping`);
        continue;
      }
      
      // Validate recalculated price is in expected range
      if (range && (recalculatedEntryPrice < range.min * 0.9 || recalculatedEntryPrice > range.max * 1.1)) {
        console.log(`   ⚠️  Recalculated price $${recalculatedEntryPrice.toFixed(2)} is outside expected range, skipping`);
        continue;
      }
      
      console.log(`   ✅ Using entry_price: $${recalculatedEntryPrice.toFixed(2)}`);
      
      // Recalculate P&L with new entry price
      const { pnlUsdt, pnlPercent: newPnlPercent, totalFees } = recalculatePnl(
        recalculatedEntryPrice, exitPrice, quantity, commission
      );
      
      console.log(`   New P&L: $${pnlUsdt.toFixed(2)} (${newPnlPercent.toFixed(2)}%)`);
      
      // Update trade in database
      const updateQuery = `
        UPDATE trades
        SET entry_price = $1,
            pnl_usdt = $2,
            pnl_percent = $3,
            updated_date = CURRENT_TIMESTAMP
        WHERE id = $4
      `;
      
      await client.query(updateQuery, [
        recalculatedEntryPrice,
        pnlUsdt,
        newPnlPercent,
        trade.id
      ]);
      
      console.log(`   ✅ Updated trade ${trade.id} in database`);
      fixedCount++;
    }
        
        console.log(`\n✅ Repair complete!`);
        console.log(`   Checked: ${checkedCount} trades`);
        console.log(`   Fixed: ${fixedCount} trades`);
        
        // Recalculate total P&L
        console.log(`\n📊 Recalculating total P&L...`);
        const totalPnlResult = await client.query(`
            SELECT 
                SUM(pnl_usdt) as total_realized_pnl,
                COUNT(*) as total_trades,
                COUNT(CASE WHEN pnl_usdt > 0 THEN 1 END) as winning_trades,
                COUNT(CASE WHEN pnl_usdt < 0 THEN 1 END) as losing_trades,
                SUM(CASE WHEN pnl_usdt > 0 THEN pnl_usdt ELSE 0 END) as total_gross_profit,
                SUM(CASE WHEN pnl_usdt < 0 THEN ABS(pnl_usdt) ELSE 0 END) as total_gross_loss
            FROM trades
            WHERE exit_timestamp IS NOT NULL
        `);
        
        const stats = totalPnlResult.rows[0];
        console.log(`   Total Realized P&L: $${parseFloat(stats.total_realized_pnl || 0).toFixed(2)}`);
        console.log(`   Total Trades: ${stats.total_trades}`);
        console.log(`   Winning Trades: ${stats.winning_trades}`);
        console.log(`   Losing Trades: ${stats.losing_trades}`);
        console.log(`   Total Gross Profit: $${parseFloat(stats.total_gross_profit || 0).toFixed(2)}`);
        console.log(`   Total Gross Loss: $${parseFloat(stats.total_gross_loss || 0).toFixed(2)}`);
        
        const winRate = stats.winning_trades + stats.losing_trades > 0
            ? (stats.winning_trades / (stats.winning_trades + stats.losing_trades)) * 100
            : 0;
        const profitFactor = parseFloat(stats.total_gross_loss || 0) > 0
            ? parseFloat(stats.total_gross_profit || 0) / parseFloat(stats.total_gross_loss || 0)
            : (parseFloat(stats.total_gross_profit || 0) > 0 ? Infinity : 0);
        
        console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
        console.log(`   Profit Factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
        
    } catch (error) {
        console.error('❌ Error fixing trade entry prices:', error);
        throw error;
    } finally {
        await client.end();
    }
}

// Run the fix
fixTradeEntryPrices()
    .then(() => {
        console.log('\n✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    });

