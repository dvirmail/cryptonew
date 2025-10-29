const { Pool } = require('pg');

// Database connection configuration
const dbConfig = {
    user: 'dvirturkenitch',
    host: 'localhost',
    database: 'dvirturkenitch',
    port: 5432,
};

const pool = new Pool(dbConfig);

/**
 * Display all column values of a position in the console log
 * Usage: node display-position.cjs [position-id] | [list] | [recent]
 */
async function displayPosition(positionId = null) {
    console.log('🔍 Displaying Position Column Values...\n');
    
    try {
        // Test database connection
        console.log('📊 Testing database connection...');
        const connectionTest = await pool.query('SELECT NOW() as current_time');
        console.log('✅ Database connected successfully at:', connectionTest.rows[0].current_time);
        
        // Get total count of positions
        const countQuery = 'SELECT COUNT(*) as total_positions FROM live_positions;';
        const countResult = await pool.query(countQuery);
        const totalPositions = parseInt(countResult.rows[0].total_positions, 10);
        console.log(`📊 Total live positions in database: ${totalPositions}`);
        
        if (totalPositions === 0) {
            console.log('❌ No positions found in database');
            return;
        }
        
        let position = null;
        
        if (positionId === 'list') {
            // List all positions
            console.log('\n📋 All Live Positions:');
            const listQuery = `
                SELECT 
                    id, symbol, side, entry_price, current_price, unrealized_pnl,
                    conviction_score, fear_greed_score, market_regime, 
                    position_id, created_date, strategy_name
                FROM live_positions
                ORDER BY created_date DESC;
            `;
            const listResult = await pool.query(listQuery);
            
            listResult.rows.forEach((pos, index) => {
                console.log(`\n${index + 1}. Position ID: ${pos.id}`);
                console.log(`   Symbol: ${pos.symbol} (${pos.side})`);
                console.log(`   Strategy: ${pos.strategy_name}`);
                console.log(`   Entry: ${pos.entry_price}, Current: ${pos.current_price}`);
                console.log(`   PnL: ${pos.unrealized_pnl}`);
                console.log(`   Conviction: ${pos.conviction_score}, Fear&Greed: ${pos.fear_greed_score}`);
                console.log(`   Regime: ${pos.market_regime}`);
                console.log(`   Position ID: ${pos.position_id}`);
                console.log(`   Created: ${new Date(pos.created_date).toString()}`);
            });
            return;
        } else if (positionId && positionId !== 'recent') {
            // Get specific position by ID
            console.log(`\n🔍 Displaying position with ID: ${positionId}`);
            const specificQuery = 'SELECT * FROM live_positions WHERE id = $1';
            const specificResult = await pool.query(specificQuery, [positionId]);
            
            if (specificResult.rows.length === 0) {
                console.log(`❌ Position with ID ${positionId} not found`);
                return;
            }
            position = specificResult.rows[0];
        } else {
            // Get most recent position
            console.log('\n🔍 Displaying most recent position:');
            const recentQuery = 'SELECT * FROM live_positions ORDER BY created_date DESC LIMIT 1';
            const recentResult = await pool.query(recentQuery);
            position = recentResult.rows[0];
        }
        
        if (!position) {
            console.log('❌ No position found');
            return;
        }
        
        // Display all columns
        console.log('\n📈 POSITION DETAILS:');
        console.log('================================================================================');
        
        const columns = [
            'id', 'symbol', 'side', 'quantity', 'entry_price', 'current_price', 'unrealized_pnl',
            'trading_mode', 'entry_timestamp', 'created_date', 'updated_date', 'strategy_name',
            'direction', 'quantity_crypto', 'entry_value_usdt', 'status', 'stop_loss_price',
            'take_profit_price', 'is_trailing', 'trailing_stop_price', 'trailing_peak_price',
            'peak_price', 'trough_price', 'time_exit_hours', 'wallet_id', 'last_updated_timestamp',
            'last_price_update', 'binance_order_id', 'binance_executed_price', 'binance_executed_quantity',
            'trigger_signals', 'combined_strength', 'conviction_score', 'conviction_breakdown',
            'conviction_multiplier', 'market_regime', 'regime_confidence', 'atr_value',
            'is_event_driven_strategy', 'fear_greed_score', 'fear_greed_classification', 'lpm_score',
            'conviction_details', 'position_id'
        ];
        
        columns.forEach((column, index) => {
            const value = position[column];
            console.log(`\n${index + 1}. ${column.toUpperCase()}`);
            console.log(`   Value: ${JSON.stringify(value)}`);
            
            // Format different data types
            if (value !== null && value !== undefined) {
                if (typeof value === 'number') {
                    console.log(`   Formatted: ${value}`);
                } else if (typeof value === 'boolean') {
                    console.log(`   Formatted: ${value ? 'TRUE' : 'FALSE'}`);
                } else if (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(parseFloat(value))) {
                    console.log(`   Formatted: ${parseFloat(value)}`);
                } else if (column.includes('timestamp') || column.includes('date')) {
                    console.log(`   Formatted: ${new Date(value).toString()}`);
                } else if (typeof value === 'object') {
                    console.log(`   Formatted: ${JSON.stringify(value, null, 2)}`);
                }
            }
        });
        
        console.log('\n================================================================================');
        
        // Analytics summary
        console.log('\n📊 ANALYTICS SUMMARY:');
        console.log(`   Symbol: ${position.symbol}`);
        console.log(`   Side: ${position.side}`);
        console.log(`   Strategy: ${position.strategy_name}`);
        console.log(`   Entry Price: ${position.entry_price}`);
        console.log(`   Current Price: ${position.current_price}`);
        console.log(`   Unrealized PnL: ${position.unrealized_pnl}`);
        console.log(`   Conviction Score: ${position.conviction_score}`);
        console.log(`   Fear & Greed Score: ${position.fear_greed_score} (${position.fear_greed_classification})`);
        console.log(`   LPM Score: ${position.lpm_score}`);
        console.log(`   Combined Strength: ${position.combined_strength}`);
        console.log(`   Market Regime: ${position.market_regime}`);
        console.log(`   Regime Confidence: ${position.regime_confidence}`);
        console.log(`   ATR Value: ${position.atr_value}`);
        console.log(`   Event Driven: ${position.is_event_driven_strategy}`);
        console.log(`   Position ID: ${position.position_id}`);
        
        // Detailed breakdowns
        if (position.conviction_breakdown) {
            console.log('\n🔍 CONVICTION BREAKDOWN:');
            console.log(JSON.stringify(position.conviction_breakdown, null, 2));
        }
        
        if (position.trigger_signals) {
            console.log('\n🔍 TRIGGER SIGNALS:');
            console.log(JSON.stringify(position.trigger_signals, null, 2));
        }
        
        if (position.conviction_details) {
            console.log('\n🔍 CONVICTION DETAILS:');
            console.log(JSON.stringify(position.conviction_details, null, 2));
        }
        
        console.log('\n✅ Position display completed successfully!');
        
    } catch (error) {
        console.error('❌ Error displaying position:', error.message);
    } finally {
        await pool.end();
        console.log('🔌 Database connection closed');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const positionId = args[0] || null;

// Run the function
displayPosition(positionId);
