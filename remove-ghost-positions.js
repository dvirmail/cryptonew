#!/usr/bin/env node

/**
 * Remove Ghost Positions Script
 * Removes all trades with exit_reason = 'ghost_position_purge' from the proxy server
 */

const fs = require('fs');
const path = require('path');

console.log('🧹 Starting Ghost Position Removal...');

// Path to the storage directory
const storageDir = path.join(__dirname, 'storage');

// Function to load stored data
function loadStoredData(filename) {
    try {
        const filePath = path.join(storageDir, `${filename}.json`);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error(`Error loading ${filename}:`, error.message);
        return [];
    }
}

// Function to save stored data
function saveStoredData(filename, data) {
    try {
        const filePath = path.join(storageDir, `${filename}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`✅ Saved ${filename}.json`);
    } catch (error) {
        console.error(`Error saving ${filename}:`, error.message);
    }
}

// Main function
async function removeGhostPositions() {
    try {
        // Load current trades
        const trades = loadStoredData('trades');
        console.log(`📊 Found ${trades.length} total trades`);
        
        // Filter out ghost positions
        const ghostTrades = trades.filter(trade => trade.exit_reason === 'ghost_position_purge');
        const legitimateTrades = trades.filter(trade => trade.exit_reason !== 'ghost_position_purge');
        
        console.log(`👻 Found ${ghostTrades.length} ghost positions to remove`);
        console.log(`✅ Found ${legitimateTrades.length} legitimate trades to keep`);
        
        if (ghostTrades.length === 0) {
            console.log('🎉 No ghost positions found! Nothing to remove.');
            return;
        }
        
        // Show details of ghost positions being removed
        console.log('\n📋 Ghost positions being removed:');
        ghostTrades.forEach((trade, index) => {
            console.log(`  ${index + 1}. ${trade.trade_id} - ${trade.symbol} - ${trade.strategy_name}`);
            console.log(`     Entry: ${trade.entry_timestamp} | Exit: ${trade.exit_timestamp}`);
            console.log(`     PnL: ${trade.pnl_usdt} USDT (${trade.pnl_percentage}%)`);
        });
        
        // Save the cleaned trades
        saveStoredData('trades', legitimateTrades);
        
        console.log(`\n🎉 Successfully removed ${ghostTrades.length} ghost positions!`);
        console.log(`📊 Remaining trades: ${legitimateTrades.length}`);
        
        // Create backup of removed ghost positions
        const backupPath = path.join(storageDir, `ghost-positions-backup-${Date.now()}.json`);
        fs.writeFileSync(backupPath, JSON.stringify(ghostTrades, null, 2));
        console.log(`💾 Backup of removed ghost positions saved to: ${backupPath}`);
        
    } catch (error) {
        console.error('❌ Error removing ghost positions:', error.message);
        process.exit(1);
    }
}

// Run the script
removeGhostPositions();
