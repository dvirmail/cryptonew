#!/usr/bin/env node

/**
 * Complete cleanup script - clears all data including historical performance
 * Clears: positions, trades, historical performance, wallet summaries
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const storageDir = path.join(__dirname, 'storage');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'dvirturkenitch',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
};

async function clearDatabase(dbClient) {
    if (!dbClient) return;
    
    try {
        console.log('\n🗑️  Clearing database...');
        
        // Delete all positions
        const positionsResult = await dbClient.query('DELETE FROM live_positions');
        console.log(`   ✅ Deleted ${positionsResult.rowCount} positions`);
        
        // Delete all trades
        const tradesResult = await dbClient.query('DELETE FROM trades');
        console.log(`   ✅ Deleted ${tradesResult.rowCount} trades`);
        
        // Delete historical performance (if table exists)
        try {
            const hpResult = await dbClient.query('DELETE FROM historical_performance');
            console.log(`   ✅ Deleted ${hpResult.rowCount} historical performance records`);
        } catch (error) {
            if (error.code === '42P01') {
                console.log('   ℹ️  historical_performance table does not exist (skipping)');
            } else {
                throw error;
            }
        }
        
        // Reset wallet states
        await dbClient.query(`
            UPDATE central_wallet_state 
            SET 
                positions = '[]'::jsonb,
                open_positions_count = 0,
                total_realized_pnl = 0,
                unrealized_pnl = 0,
                balance_in_trades = 0
        `);
        console.log(`   ✅ Reset wallet states`);
        
        console.log('✅ Database cleanup complete');
    } catch (error) {
        console.error('❌ Database cleanup error:', error.message);
        throw error;
    }
}

function clearFileStorage() {
    console.log('\n🗑️  Clearing file storage...');
    
    const files = [
        'livePositions.json',
        'trades.json',
        'historicalPerformances.json',
        'walletSummaries.json',
        'liveWalletStates.json'
    ];
    
    let clearedCount = 0;
    for (const file of files) {
        const filePath = path.join(storageDir, file);
        if (fs.existsSync(filePath)) {
            // Create backup
            const backupPath = filePath + '.backup.' + Date.now();
            fs.copyFileSync(filePath, backupPath);
            
            // Clear file
            fs.writeFileSync(filePath, JSON.stringify([], null, 2));
            console.log(`   ✅ Cleared ${file}`);
            clearedCount++;
        } else {
            console.log(`   ⏭️  ${file} not found (already empty)`);
        }
    }
    
    console.log(`✅ File storage cleanup complete (${clearedCount} files cleared)`);
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🧹 COMPLETE DATA CLEANUP (Including Performance)');
    console.log('═══════════════════════════════════════════════════\n');
    
    let dbClient = null;
    
    try {
        // Connect to database
        console.log('🔌 Connecting to database...');
        dbClient = new Client(dbConfig);
        await dbClient.connect();
        console.log('✅ Connected to database\n');
        
        // Clear database
        await clearDatabase(dbClient);
        
        // Clear file storage
        clearFileStorage();
        
        console.log('\n═══════════════════════════════════════════════════');
        console.log('✅ ALL DATA CLEARED!');
        console.log('═══════════════════════════════════════════════════\n');
        
        console.log('📋 NEXT STEPS:\n');
        
        console.log('1️⃣  CLEAR BROWSER CACHE:');
        console.log('   • Open DevTools (F12) → Console');
        console.log('   • Run: localStorage.clear(); sessionStorage.clear();');
        console.log('   • Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)\n');
        
        console.log('2️⃣  RESTART PROXY SERVER:');
        console.log('   • Stop: Ctrl+C');
        console.log('   • Restart: node proxy-server.cjs\n');
        
        console.log('3️⃣  VERIFY CLEAN STATE:');
        console.log('   • Dashboard should show $0 P&L');
        console.log('   • Charts should be empty');
        console.log('   • 0 positions, 0 trades\n');
        
        console.log('═══════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('\n⚠️  Database connection failed. File storage was still cleared.');
        }
    } finally {
        if (dbClient) {
            await dbClient.end();
        }
    }
}

main().catch(console.error);

