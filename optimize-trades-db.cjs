#!/usr/bin/env node

/**
 * Optimize Trades Table Performance
 * Adds critical indexes for 2M+ row performance
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration (same as proxy-server.cjs)
const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
};

async function optimizeTradesTable() {
    const client = new Client(dbConfig);
    
    try {
        console.log('🔌 Connecting to database...');
        await client.connect();
        console.log('✅ Connected to PostgreSQL');
        
        console.log('\n🚀 Starting trades table optimization...\n');
        
        const results = {
            indexesCreated: [],
            errors: []
        };
        
        // Critical indexes
        const indexes = [
            {
                name: 'idx_trades_mode_exit_timestamp',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_mode_exit_timestamp 
                      ON trades(trading_mode, exit_timestamp) 
                      WHERE exit_timestamp IS NOT NULL`,
                description: 'Composite index for mode + exit_timestamp queries (snapshot generation)'
            },
            {
                name: 'idx_trades_exit_timestamp_desc',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_exit_timestamp_desc 
                      ON trades(exit_timestamp DESC) 
                      WHERE exit_timestamp IS NOT NULL`,
                description: 'Index for sorting by exit_timestamp (chart and wallet provider)'
            },
            {
                name: 'idx_trades_mode_exit_range',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_mode_exit_range 
                      ON trades(trading_mode, exit_timestamp DESC) 
                      WHERE exit_timestamp IS NOT NULL`,
                description: 'Composite index for mode + exit_timestamp range queries (backfill)'
            },
            {
                name: 'idx_trades_created_date_desc',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_created_date_desc 
                      ON trades(created_date DESC)`,
                description: 'Index for listing/archiving operations'
            },
            {
                name: 'idx_trades_mode_created_date',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_mode_created_date 
                      ON trades(trading_mode, created_date DESC)`,
                description: 'Composite index for mode + created_date queries'
            },
            {
                name: 'idx_trades_valid_exits',
                sql: `CREATE INDEX IF NOT EXISTS idx_trades_valid_exits 
                      ON trades(trading_mode, exit_timestamp, pnl_usdt) 
                      WHERE exit_timestamp IS NOT NULL AND pnl_usdt IS NOT NULL`,
                description: 'Partial index for trades with valid exit data (analytics queries)'
            }
        ];
        
        // Create indexes
        for (const index of indexes) {
            try {
                console.log(`📊 Creating index: ${index.name}`);
                console.log(`   ${index.description}`);
                const start = Date.now();
                await client.query(index.sql);
                const duration = Date.now() - start;
                results.indexesCreated.push({
                    name: index.name,
                    duration: `${duration}ms`
                });
                console.log(`   ✅ Created in ${duration}ms\n`);
            } catch (error) {
                const errorMsg = `Failed to create ${index.name}: ${error.message}`;
                results.errors.push(errorMsg);
                console.error(`   ❌ ${errorMsg}\n`);
            }
        }
        
        // Update table statistics
        console.log('📊 Updating table statistics (ANALYZE)...');
        try {
            const start = Date.now();
            await client.query('ANALYZE trades');
            const duration = Date.now() - start;
            console.log(`✅ ANALYZE completed in ${duration}ms\n`);
        } catch (error) {
            results.errors.push(`ANALYZE failed: ${error.message}`);
            console.error(`❌ ANALYZE failed: ${error.message}\n`);
        }
        
        // Summary
        console.log('='.repeat(60));
        console.log('📈 OPTIMIZATION SUMMARY');
        console.log('='.repeat(60));
        console.log(`✅ Indexes created: ${results.indexesCreated.length}`);
        console.log(`❌ Errors: ${results.errors.length}`);
        
        if (results.indexesCreated.length > 0) {
            console.log('\n📋 Created indexes:');
            results.indexesCreated.forEach(idx => {
                console.log(`   • ${idx.name} (${idx.duration})`);
            });
        }
        
        if (results.errors.length > 0) {
            console.log('\n⚠️  Errors:');
            results.errors.forEach(err => {
                console.log(`   • ${err}`);
            });
        }
        
        console.log('\n' + '='.repeat(60));
        
        // Check current table size
        const tableSize = await client.query(`
            SELECT 
                pg_size_pretty(pg_total_relation_size('trades')) as total_size,
                pg_size_pretty(pg_relation_size('trades')) as table_size,
                pg_size_pretty(pg_total_relation_size('trades') - pg_relation_size('trades')) as indexes_size,
                (SELECT COUNT(*) FROM trades) as row_count
        `);
        
        console.log('📊 Current trades table stats:');
        console.log(`   • Total size: ${tableSize.rows[0].total_size}`);
        console.log(`   • Table size: ${tableSize.rows[0].table_size}`);
        console.log(`   • Indexes size: ${tableSize.rows[0].indexes_size}`);
        console.log(`   • Row count: ${parseInt(tableSize.rows[0].row_count).toLocaleString()} rows`);
        console.log('='.repeat(60));
        
        if (results.errors.length === 0) {
            console.log('\n✅ Optimization completed successfully!');
            console.log('💡 Your trades table is now optimized for 2M+ rows.');
        } else {
            console.log('\n⚠️  Optimization completed with some errors.');
            console.log('   Check the errors above and fix if needed.');
        }
        
        process.exit(results.errors.length === 0 ? 0 : 1);
        
    } catch (error) {
        console.error('\n❌ Critical error:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔌 Database connection closed');
    }
}

// Run optimization
optimizeTradesTable();

