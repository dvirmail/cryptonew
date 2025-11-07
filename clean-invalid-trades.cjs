#!/usr/bin/env node

/**
 * Clean Invalid Trades Script
 * Removes trades with:
 * - Any null values in critical columns
 * - ETH trades with entry_price or exit_price < 3808
 * - SOL trades with entry_price or exit_price < 184.77
 * - XRP trades with entry_price or exit_price < 2.47
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration (same as proxy-server.cjs)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'cryptosentinel',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
};

// Price thresholds
const PRICE_THRESHOLDS = {
    'ETH/USDT': { min: 3808 },
    'SOL/USDT': { min: 184.77 },
    'XRP/USDT': { min: 2.47 }
};

async function cleanInvalidTrades() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Connected to PostgreSQL database');
        
        // First, get all trades to analyze
        const allTradesResult = await client.query(`
            SELECT id, symbol, entry_price, exit_price, 
                   entry_timestamp, exit_timestamp, quantity, strategy_name,
                   trading_mode, pnl_usdt, pnl_percent
            FROM trades
            ORDER BY exit_timestamp DESC NULLS LAST, created_date DESC
        `);
        
        const allTrades = allTradesResult.rows;
        console.log(`📊 Found ${allTrades.length} trades to check`);
        
        const invalidTradeIds = [];
        const reasons = new Map();
        
        // Check each trade for invalid conditions
        for (const trade of allTrades) {
            let isInvalid = false;
            const invalidReasons = [];
            
            // Check for null values in critical columns
            const criticalColumns = [
                'id', 'symbol', 'entry_price', 'exit_price', 
                'entry_timestamp', 'exit_timestamp', 'quantity',
                'strategy_name', 'trading_mode', 'pnl_usdt', 'pnl_percent'
            ];
            
            for (const col of criticalColumns) {
                if (trade[col] === null || trade[col] === undefined) {
                    isInvalid = true;
                    invalidReasons.push(`${col} is null`);
                }
            }
            
            // Check price thresholds for specific symbols
            const symbol = trade.symbol;
            const threshold = PRICE_THRESHOLDS[symbol];
            
            if (threshold) {
                const entryPrice = parseFloat(trade.entry_price);
                const exitPrice = parseFloat(trade.exit_price);
                
                if (!isNaN(entryPrice) && entryPrice < threshold.min) {
                    isInvalid = true;
                    invalidReasons.push(`entry_price ${entryPrice} < ${threshold.min}`);
                }
                
                if (!isNaN(exitPrice) && exitPrice < threshold.min) {
                    isInvalid = true;
                    invalidReasons.push(`exit_price ${exitPrice} < ${threshold.min}`);
                }
            }
            
            if (isInvalid) {
                invalidTradeIds.push(trade.id);
                reasons.set(trade.id.toString(), {
                    symbol: symbol,
                    entry_price: trade.entry_price,
                    exit_price: trade.exit_price,
                    reasons: invalidReasons
                });
            }
        }
        
        console.log(`\n🔍 Analysis complete:`);
        console.log(`   Total trades checked: ${allTrades.length}`);
        console.log(`   Invalid trades found: ${invalidTradeIds.length}`);
        
        if (invalidTradeIds.length > 0) {
            console.log(`\n📋 Invalid trades breakdown:`);
            let count = 0;
            for (const [id, info] of reasons) {
                if (count++ < 10) {
                    console.log(`   ${info.symbol}: ${info.reasons.join(', ')}`);
                }
            }
            if (invalidTradeIds.length > 10) {
                console.log(`   ... and ${invalidTradeIds.length - 10} more`);
            }
            
            // Delete invalid trades
            console.log(`\n🗑️  Deleting ${invalidTradeIds.length} invalid trades...`);
            const deleteResult = await client.query(`
                DELETE FROM trades 
                WHERE id = ANY($1::uuid[])
                RETURNING id, symbol, entry_price, exit_price
            `, [invalidTradeIds]);
            
            const deletedCount = deleteResult.rowCount || 0;
            console.log(`✅ Deleted ${deletedCount} invalid trades from database`);
            
            // Also update in-memory trades.json file
            const tradesFilePath = path.join(__dirname, 'storage', 'trades.json');
            if (fs.existsSync(tradesFilePath)) {
                try {
                    const tradesData = JSON.parse(fs.readFileSync(tradesFilePath, 'utf8'));
                    const initialLength = tradesData.length;
                    const filteredTrades = tradesData.filter(t => !invalidTradeIds.includes(t.id));
                    
                    // Write back to file
                    fs.writeFileSync(tradesFilePath, JSON.stringify(filteredTrades, null, 2));
                    
                    console.log(`✅ Updated trades.json: ${initialLength} → ${filteredTrades.length} trades`);
                } catch (error) {
                    console.warn(`⚠️  Could not update trades.json: ${error.message}`);
                }
            }
            
            // Get remaining trades count
            const remainingCount = await client.query(`SELECT COUNT(*) as count FROM trades`);
            console.log(`\n📊 Remaining trades in database: ${remainingCount.rows[0].count}`);
            
            return {
                success: true,
                totalChecked: allTrades.length,
                deletedCount: deletedCount,
                remainingCount: parseInt(remainingCount.rows[0].count),
                invalidTradeIds: invalidTradeIds.slice(0, 20) // Return first 20 for reference
            };
        } else {
            console.log(`✅ No invalid trades found - all trades are valid!`);
            return {
                success: true,
                totalChecked: allTrades.length,
                deletedCount: 0,
                remainingCount: allTrades.length
            };
        }
        
    } catch (error) {
        console.error('❌ Error cleaning invalid trades:', error);
        throw error;
    } finally {
        await client.end();
        console.log('\n✅ Database connection closed');
    }
}

// Run the cleanup
if (require.main === module) {
    cleanInvalidTrades()
        .then(result => {
            console.log('\n✅ Cleanup complete!');
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Cleanup failed:', error);
            process.exit(1);
        });
}

module.exports = { cleanInvalidTrades };

