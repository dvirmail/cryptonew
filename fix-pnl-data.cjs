#!/usr/bin/env node

/**
 * Fix Corrupted P&L Data
 * 
 * This script recalculates all P&L values in the database from entry_price, exit_price, and quantity.
 * It fixes corrupted P&L data that may have incorrect signs or values.
 * 
 * Usage: node fix-pnl-data.cjs
 */

const fetch = require('node-fetch');

const PROXY_URL = 'http://localhost:3003';

async function fixPnlData() {
    console.log('🔧 Starting P&L data fix...');
    console.log('📊 This will recalculate all P&L values from entry_price, exit_price, and quantity');
    console.log('');
    
    try {
        console.log('⏳ Calling /api/trades/recalculate-pnl endpoint...');
        const response = await fetch(`${PROXY_URL}/api/trades/recalculate-pnl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ P&L recalculation completed successfully!');
            console.log('');
            console.log('📈 Summary:');
            console.log(`   - Total trades processed: ${result.totalTrades}`);
            console.log(`   - Trades updated: ${result.updatedCount}`);
            console.log('');
            
            if (result.updatedTrades && result.updatedTrades.length > 0) {
                console.log('📋 Sample of updated trades (first 10):');
                result.updatedTrades.forEach((trade, index) => {
                    console.log(`   ${index + 1}. Trade ID: ${trade.id} (${trade.trading_mode})`);
                    console.log(`      Old P&L: $${trade.oldPnlUsdt.toFixed(2)} (${trade.oldPnlPercent.toFixed(2)}%)`);
                    console.log(`      New P&L: $${trade.newPnlUsdt.toFixed(2)} (${trade.newPnlPercent.toFixed(2)}%)`);
                    console.log(`      Change: $${(trade.newPnlUsdt - trade.oldPnlUsdt).toFixed(2)}`);
                    console.log('');
                });
            }
            
            console.log('✅ All P&L values have been recalculated and updated in the database.');
            console.log('🔄 Please refresh your browser to see the updated P&L values.');
            
        } else {
            console.error('❌ P&L recalculation failed:', result.error);
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Error fixing P&L data:', error.message);
        console.error('');
        console.error('Make sure:');
        console.error('  1. The proxy server is running on http://localhost:3003');
        console.error('  2. The database is accessible');
        console.error('  3. You have the necessary permissions');
        process.exit(1);
    }
}

// Run the fix
fixPnlData();

