#!/usr/bin/env node

/**
 * Run dust aggregation database migration
 * This script adds the necessary columns to live_positions table
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function runMigration() {
    let client = null;
    
    try {
        console.log('[MIGRATION] 🔄 Connecting to database...');
        client = new Client(dbConfig);
        await client.connect();
        console.log('[MIGRATION] ✅ Connected to PostgreSQL database');
        
        // Read SQL migration file
        const sqlFile = path.join(__dirname, 'add-dust-aggregation-fields.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        console.log('[MIGRATION] 📄 Reading migration file:', sqlFile);
        console.log('[MIGRATION] 🔄 Executing migration...');
        
        // Execute migration
        await client.query(sql);
        
        console.log('[MIGRATION] ✅ Migration completed successfully!');
        console.log('[MIGRATION] 📊 Added columns: dust_status, aggregated_position_id, accumulated_quantity, aggregated_position_ids, note');
        console.log('[MIGRATION] 📊 Created indexes: idx_live_positions_dust_status, idx_live_positions_aggregated_position_id');
        
        // Verify columns exist
        const verifyQuery = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'live_positions' 
            AND column_name IN ('dust_status', 'aggregated_position_id', 'accumulated_quantity', 'aggregated_position_ids', 'note')
            ORDER BY column_name;
        `;
        const verifyResult = await client.query(verifyQuery);
        
        if (verifyResult.rows.length === 5) {
            console.log('[MIGRATION] ✅ Verification: All 5 columns exist');
            verifyResult.rows.forEach(row => {
                console.log(`[MIGRATION]   - ${row.column_name}: ${row.data_type}`);
            });
        } else {
            console.warn(`[MIGRATION] ⚠️ Verification: Expected 5 columns, found ${verifyResult.rows.length}`);
        }
        
        return true;
    } catch (error) {
        console.error('[MIGRATION] ❌ Migration failed:', error.message);
        console.error('[MIGRATION] ❌ Error details:', error);
        if (error.code) {
            console.error('[MIGRATION] ❌ Error code:', error.code);
        }
        return false;
    } finally {
        if (client) {
            await client.end();
            console.log('[MIGRATION] 🔌 Database connection closed');
        }
    }
}

// Run migration
runMigration()
    .then(success => {
        if (success) {
            console.log('[MIGRATION] ✅ Migration script completed successfully');
            process.exit(0);
        } else {
            console.error('[MIGRATION] ❌ Migration script failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('[MIGRATION] ❌ Unexpected error:', error);
        process.exit(1);
    });

