#!/usr/bin/env node

/**
 * Aggressive ghost position cleanup script
 * This will delete ALL open positions and let the system recreate them properly
 */

const fs = require('fs');
const path = require('path');

console.log('🧹 AGGRESSIVE Ghost Position Cleanup Script');
console.log('==========================================');

const positionsPath = path.join(__dirname, 'storage', 'livePositions.json');

try {
    // Load existing positions
    let positions = [];
    if (fs.existsSync(positionsPath)) {
        const positionsData = fs.readFileSync(positionsPath, 'utf8');
        positions = JSON.parse(positionsData);
        console.log(`📊 Loaded ${positions.length} existing positions from storage`);
    }

    if (positions.length === 0) {
        console.log('✅ No positions found to clean up');
        process.exit(0);
    }

    // Separate open/trailing positions from closed ones
    const openPositions = positions.filter(p => p.status === 'open' || p.status === 'trailing');
    const closedPositions = positions.filter(p => p.status !== 'open' && p.status !== 'trailing');

    console.log(`📊 Position Analysis:`);
    console.log(`   Total positions: ${positions.length}`);
    console.log(`   Open/Trailing: ${openPositions.length}`);
    console.log(`   Closed: ${closedPositions.length}`);

    if (openPositions.length === 0) {
        console.log('✅ No open positions found to clean up');
        process.exit(0);
    }

    // Show what we're about to delete
    console.log(`\n🗑️ Positions to be deleted:`);
    openPositions.forEach(pos => {
        console.log(`   - ${pos.symbol}: ${pos.quantity_crypto} (${pos.status})`);
    });

    // Backup original file
    const backupPath = positionsPath + '.backup.' + Date.now();
    fs.writeFileSync(backupPath, JSON.stringify(positions, null, 2));
    console.log(`\n💾 Backup created: ${backupPath}`);

    // Keep only closed positions
    fs.writeFileSync(positionsPath, JSON.stringify(closedPositions, null, 2));
    console.log(`✅ Cleaned positions saved to: ${positionsPath}`);

    console.log(`\n🎉 Aggressive Cleanup Complete!`);
    console.log(`   Deleted: ${openPositions.length} open/trailing positions`);
    console.log(`   Kept: ${closedPositions.length} closed positions`);
    console.log(`\n💡 The system will now recreate positions with correct quantities`);

} catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
}
