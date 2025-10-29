#!/usr/bin/env node

/**
 * Complete position clearing script
 * Clears positions from all sources: database, file storage, and provides instructions for browser/proxy
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
        
        // Delete all positions first
        const positionsResult = await dbClient.query('DELETE FROM live_positions');
        console.log(`   ✅ Deleted ${positionsResult.rowCount} positions from database`);
        
        // Delete all trades
        const tradesResult = await dbClient.query('DELETE FROM trades');
        console.log(`   ✅ Deleted ${tradesResult.rowCount} trades from database`);
        
        // Clear wallet states that might have position references
        const walletStateResult = await dbClient.query('UPDATE central_wallet_state SET positions = \'[]\'::jsonb, open_positions_count = 0');
        console.log(`   ✅ Cleared position references from wallet states`);
        
        console.log('✅ Database cleanup complete');
    } catch (error) {
        console.error('❌ Database cleanup error:', error.message);
    }
}

function clearFileStorage() {
    console.log('\n🗑️  Clearing file storage...');
    
    const files = [
        'livePositions.json',
        'trades.json',
        'walletSummaries.json',
        'liveWalletStates.json'
    ];
    
    for (const file of files) {
        const filePath = path.join(storageDir, file);
        if (fs.existsSync(filePath)) {
            const backupPath = filePath + '.backup.' + Date.now();
            fs.copyFileSync(filePath, backupPath);
            fs.writeFileSync(filePath, JSON.stringify([], null, 2));
            console.log(`   ✅ Cleared ${file}`);
        }
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🧹 COMPLETE POSITION CLEARING');
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
        console.log('✅ DATABASE & FILE STORAGE CLEARED!');
        console.log('═══════════════════════════════════════════════════\n');
        
        console.log('📋 NEXT STEPS TO COMPLETE CLEANUP:\n');
        
        console.log('1️⃣  CLEAR BROWSER LOCALSTORAGE:');
        console.log('   • Open browser DevTools (F12)');
        console.log('   • Go to Application → Local Storage → http://localhost:5174');
        console.log('   • Right-click → Clear');
        console.log('   • OR run in browser console:');
        console.log('     localStorage.clear();\n');
        
        console.log('2️⃣  RESTART PROXY SERVER:');
        console.log('   • Stop proxy server (Ctrl+C)');
        console.log('   • Restart: node proxy-server.cjs\n');
        
        console.log('3️⃣  REFRESH BROWSER:');
        console.log('   • Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)');
        console.log('   • Or close and reopen the browser tab\n');
        
        console.log('4️⃣  STOP BINANCE RECONCILIATION (Important!):');
        console.log('   • The scanner might reload positions from Binance');
        console.log('   • Stop the scanner before restarting to prevent reload');
        console.log('   • In UI: Click "Stop Testnet Scanner" button\n');
        
        console.log('═══════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('\n⚠️  Database connection failed. File storage was still cleared.');
            console.log('💡 To clear database manually, run:');
            console.log('   psql -U postgres -d dvirturkenitch -c "DELETE FROM live_positions; DELETE FROM trades;"');
        }
    } finally {
        if (dbClient) {
            await dbClient.end();
        }
    }
}

main().catch(console.error);

