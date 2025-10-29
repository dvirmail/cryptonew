#!/usr/bin/env node

/**
 * Comprehensive cleanup script to remove all positions and trades
 * from database, memory, and file storage
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const storageDir = path.join(__dirname, 'storage');

// Database connection configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'crypto_sentinel',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
};

async function connectToDatabase() {
    try {
        const client = new Client(dbConfig);
        await client.connect();
        console.log('✅ Connected to database');
        return client;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('⚠️  Continuing with file storage cleanup only...');
        return null;
    }
}

async function cleanupDatabase(dbClient) {
    if (!dbClient) {
        console.log('⏭️  Skipping database cleanup (not connected)');
        return;
    }

    try {
        console.log('\n🗑️  Cleaning database...');
        
        // Delete all trades
        const tradesResult = await dbClient.query('DELETE FROM trades');
        console.log(`   ✅ Deleted ${tradesResult.rowCount} trades from database`);

        // Delete all live positions
        const positionsResult = await dbClient.query('DELETE FROM live_positions');
        console.log(`   ✅ Deleted ${positionsResult.rowCount} positions from database`);

        console.log('✅ Database cleanup complete');
    } catch (error) {
        console.error('❌ Database cleanup error:', error.message);
        throw error;
    }
}

function cleanupFileStorage() {
    console.log('\n🗑️  Cleaning file storage...');
    
    const filesToClean = [
        'livePositions.json',
        'trades.json',
        'walletSummaries.json',
        'liveWalletStates.json'
    ];

    let cleanedCount = 0;
    for (const file of filesToClean) {
        const filePath = path.join(storageDir, file);
        if (fs.existsSync(filePath)) {
            // Create backup before deleting
            const backupPath = filePath + '.backup.' + Date.now();
            fs.copyFileSync(filePath, backupPath);
            console.log(`   📦 Backup created: ${backupPath}`);
            
            // Clear file content (write empty array for JSON files)
            fs.writeFileSync(filePath, JSON.stringify([], null, 2));
            console.log(`   ✅ Cleared ${file}`);
            cleanedCount++;
        } else {
            console.log(`   ⏭️  ${file} not found (already empty)`);
        }
    }

    console.log(`✅ File storage cleanup complete (${cleanedCount} files cleared)`);
}

async function clearLocalStorage() {
    console.log('\n🗑️  Clearing browser localStorage...');
    console.log('   ℹ️  To clear browser localStorage:');
    console.log('      1. Open browser DevTools (F12)');
    console.log('      2. Go to Application/Storage tab');
    console.log('      3. Clear Local Storage');
    console.log('      4. Or run in browser console:');
    console.log('         localStorage.clear();');
}

async function clearProxyServerMemory() {
    console.log('\n🗑️  Clearing proxy server memory...');
    console.log('   ℹ️  To clear proxy server memory:');
    console.log('      1. Stop the proxy server (Ctrl+C)');
    console.log('      2. Restart it: node proxy-server.cjs');
    console.log('      Memory will be cleared on restart');
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🧹 COMPREHENSIVE DATA CLEANUP');
    console.log('═══════════════════════════════════════════════════');
    console.log('\n⚠️  WARNING: This will delete ALL positions and trades!');
    console.log('   - Database: All records from live_positions and trades tables');
    console.log('   - File Storage: All JSON files in storage/ directory');
    console.log('   - Memory: Will be cleared on proxy server restart');
    console.log('\n💾 Backups will be created before deletion');
    console.log('═══════════════════════════════════════════════════\n');

    let dbClient = null;
    try {
        // Connect to database
        dbClient = await connectToDatabase();

        // Cleanup database
        await cleanupDatabase(dbClient);

        // Cleanup file storage
        cleanupFileStorage();

        // Instructions for memory cleanup
        await clearLocalStorage();
        await clearProxyServerMemory();

        console.log('\n═══════════════════════════════════════════════════');
        console.log('✅ CLEANUP COMPLETE!');
        console.log('═══════════════════════════════════════════════════');
        console.log('\n📋 Next steps:');
        console.log('   1. Restart the proxy server to clear memory');
        console.log('   2. Clear browser localStorage if needed');
        console.log('   3. Refresh the application to see empty state');
        console.log('\n💾 Backups are saved in storage/ directory');
        console.log('═══════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Cleanup failed:', error);
        process.exit(1);
    } finally {
        if (dbClient) {
            await dbClient.end();
            console.log('✅ Database connection closed');
        }
    }
}

// Run cleanup
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

