#!/usr/bin/env node
/**
 * Find Duplicate Trades Script
 * 
 * This script identifies duplicate trades in the database using the same logic
 * as the deduplication function that was removed.
 * 
 * Usage: node find-duplicate-trades.cjs [trading_mode]
 */

const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
};

const pool = new Pool(dbConfig);

async function findDuplicateTrades(tradingMode = 'testnet') {
    try {
        console.log(`\n🔍 Finding duplicate trades for trading_mode: ${tradingMode}\n`);

        // Method 1: Find duplicates by position_id
        console.log('📊 Method 1: Checking for duplicates by position_id...');
        const positionIdQuery = `
            SELECT 
                position_id,
                COUNT(*) as duplicate_count,
                ARRAY_AGG(id ORDER BY exit_timestamp ASC NULLS LAST, id ASC) as trade_ids,
                ARRAY_AGG(symbol) as symbols,
                ARRAY_AGG(strategy_name) as strategies
            FROM trades
            WHERE position_id IS NOT NULL
              AND trading_mode = $1
            GROUP BY position_id
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC
        `;
        
        const positionIdResult = await pool.query(positionIdQuery, [tradingMode]);
        const positionIdDuplicates = positionIdResult.rows;
        
        if (positionIdDuplicates.length > 0) {
            console.log(`   ⚠️  Found ${positionIdDuplicates.length} position_id groups with duplicates:`);
            positionIdDuplicates.forEach((dup, idx) => {
                console.log(`   ${idx + 1}. Position ID: ${dup.position_id}`);
                console.log(`      Duplicates: ${dup.duplicate_count} trades`);
                console.log(`      Trade IDs: ${dup.trade_ids.join(', ')}`);
                console.log(`      Symbols: ${[...new Set(dup.symbols)].join(', ')}`);
                console.log('');
            });
        } else {
            console.log('   ✅ No duplicates found by position_id\n');
        }

        // Method 2: Find duplicates by trade characteristics
        console.log('📊 Method 2: Checking for duplicates by trade characteristics...');
        const characteristicsQuery = `
            SELECT 
                symbol,
                COALESCE(strategy_name, '') as strategy_name,
                entry_price,
                exit_price,
                quantity,
                DATE_TRUNC('second', entry_timestamp) as entry_timestamp_rounded,
                trading_mode,
                COUNT(*) as duplicate_count,
                ARRAY_AGG(id ORDER BY exit_timestamp ASC, id ASC) as trade_ids,
                ARRAY_AGG(position_id) as position_ids
            FROM trades
            WHERE exit_timestamp IS NOT NULL
              AND entry_price > 0
              AND quantity > 0
              AND trading_mode = $1
            GROUP BY 
                symbol,
                COALESCE(strategy_name, ''),
                entry_price,
                exit_price,
                quantity,
                DATE_TRUNC('second', entry_timestamp),
                trading_mode
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC
            LIMIT 50
        `;
        
        const characteristicsResult = await pool.query(characteristicsQuery, [tradingMode]);
        const characteristicsDuplicates = characteristicsResult.rows;
        
        if (characteristicsDuplicates.length > 0) {
            console.log(`   ⚠️  Found ${characteristicsDuplicates.length} characteristic groups with duplicates (showing first 50):`);
            characteristicsDuplicates.forEach((dup, idx) => {
                console.log(`   ${idx + 1}. ${dup.symbol} | ${dup.strategy_name || '(no strategy)'}`);
                console.log(`      Entry: $${dup.entry_price} | Exit: $${dup.exit_price} | Qty: ${dup.quantity}`);
                console.log(`      Entry Time: ${dup.entry_timestamp_rounded}`);
                console.log(`      Duplicates: ${dup.duplicate_count} trades`);
                console.log(`      Trade IDs: ${dup.trade_ids.join(', ')}`);
                console.log(`      Position IDs: ${dup.position_ids.filter(id => id).join(', ') || '(none)'}`);
                console.log('');
            });
        } else {
            console.log('   ✅ No duplicates found by trade characteristics\n');
        }

        // Summary
        const totalPositionIdDups = positionIdDuplicates.reduce((sum, dup) => sum + (dup.duplicate_count - 1), 0);
        const totalCharacteristicsDups = characteristicsDuplicates.reduce((sum, dup) => sum + (dup.duplicate_count - 1), 0);
        
        console.log('═══════════════════════════════════════════════════════');
        console.log('📈 SUMMARY');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Position ID duplicates: ${positionIdDuplicates.length} groups, ${totalPositionIdDups} duplicate trades`);
        console.log(`Characteristic duplicates: ${characteristicsDuplicates.length} groups, ${totalCharacteristicsDups} duplicate trades`);
        console.log(`Total duplicate trades to remove: ${totalPositionIdDups + totalCharacteristicsDups}`);
        console.log('═══════════════════════════════════════════════════════\n');

        if (totalPositionIdDups + totalCharacteristicsDups > 0) {
            console.log('💡 To remove duplicates, run: node prevent-duplicate-trades.sql');
            console.log('   Or use the endpoint: POST /api/trades/remove-duplicates\n');
        }

    } catch (error) {
        console.error('❌ Error finding duplicate trades:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the script
const tradingMode = process.argv[2] || 'testnet';
findDuplicateTrades(tradingMode).catch(console.error);

