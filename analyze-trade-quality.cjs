const { Client } = require('pg');
require('dotenv').config();

/**
 * Comprehensive Trade Quality Analysis Script
 * 
 * Analyzes all trades in the database to identify:
 * - Overall success metrics
 * - Win rate and profitability
 * - Exit quality patterns
 * - Strategy performance
 * - Market condition impact
 * - Entry quality correlation
 * - Areas for improvement
 */

async function analyzeTradeQuality(tradingMode = 'testnet') {
    const dbClient = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await dbClient.connect();
        console.log(`[TRADE_ANALYSIS] ✅ Connected to database for trading mode: ${tradingMode}\n`);

        // ============================================
        // 1. OVERALL TRADE STATISTICS
        // ============================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📊 OVERALL TRADE STATISTICS');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const overallStats = await dbClient.query(`
            SELECT 
                COUNT(*) as total_trades,
                COUNT(CASE WHEN pnl_percent > 0 THEN 1 END) as winning_trades,
                COUNT(CASE WHEN pnl_percent <= 0 THEN 1 END) as losing_trades,
                COUNT(CASE WHEN pnl_percent > 0 THEN 1 END)::FLOAT / NULLIF(COUNT(*), 0) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl_percent,
                AVG(CASE WHEN pnl_percent > 0 THEN pnl_percent END) as avg_win_pct,
                AVG(CASE WHEN pnl_percent <= 0 THEN pnl_percent END) as avg_loss_pct,
                SUM(pnl_usdt) as total_pnl_usdt,
                SUM(CASE WHEN pnl_usdt > 0 THEN pnl_usdt ELSE 0 END) as total_profit_usdt,
                SUM(CASE WHEN pnl_usdt < 0 THEN ABS(pnl_usdt) ELSE 0 END) as total_loss_usdt,
                AVG(duration_hours) as avg_duration_hours,
                AVG(quantity * entry_price) as avg_position_size_usdt
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND entry_price > 0
                AND quantity > 0
                AND trading_mode = $1
        `, [tradingMode]);

        const stats = overallStats.rows[0];
        console.log(`Total Trades: ${stats.total_trades}`);
        console.log(`Winning Trades: ${stats.winning_trades} (${parseFloat(stats.win_rate).toFixed(2)}%)`);
        console.log(`Losing Trades: ${stats.losing_trades} (${(100 - parseFloat(stats.win_rate)).toFixed(2)}%)`);
        console.log(`\n💰 P&L Metrics:`);
        console.log(`  Total P&L: $${parseFloat(stats.total_pnl_usdt || 0).toFixed(2)}`);
        console.log(`  Total Profit: $${parseFloat(stats.total_profit_usdt || 0).toFixed(2)}`);
        console.log(`  Total Loss: $${parseFloat(stats.total_loss_usdt || 0).toFixed(2)}`);
        console.log(`  Average P&L: ${parseFloat(stats.avg_pnl_percent || 0).toFixed(2)}%`);
        console.log(`  Average Win: ${parseFloat(stats.avg_win_pct || 0).toFixed(2)}%`);
        console.log(`  Average Loss: ${parseFloat(stats.avg_loss_pct || 0).toFixed(2)}%`);
        console.log(`\n⏱️  Duration Metrics:`);
        console.log(`  Average Duration: ${parseFloat(stats.avg_duration_hours || 0).toFixed(2)} hours`);
        console.log(`  Average Position Size: $${parseFloat(stats.avg_position_size_usdt || 0).toFixed(2)}`);

        // ============================================
        // 2. EXIT QUALITY ANALYSIS
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🎯 EXIT QUALITY ANALYSIS');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const exitQuality = await dbClient.query(`
            SELECT 
                COUNT(*) as total_with_peak_data,
                AVG(peak_profit_percent) as avg_peak_profit,
                AVG(pnl_percent) as avg_actual_profit,
                AVG(peak_profit_percent - pnl_percent) as avg_profit_left_on_table,
                COUNT(CASE WHEN (peak_profit_percent - pnl_percent) > 2.0 THEN 1 END) as trades_left_2pct_plus,
                COUNT(CASE WHEN (peak_profit_percent - pnl_percent) > 1.0 THEN 1 END) as trades_left_1pct_plus,
                AVG(distance_to_tp_at_exit) as avg_distance_to_tp,
                AVG(distance_to_sl_at_exit) as avg_distance_to_sl,
                COUNT(CASE WHEN tp_hit_boolean = true THEN 1 END) as tp_hit_count,
                COUNT(CASE WHEN sl_hit_boolean = true THEN 1 END) as sl_hit_count,
                AVG(time_in_profit_hours) as avg_time_in_profit,
                AVG(time_in_loss_hours) as avg_time_in_loss
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND peak_profit_percent IS NOT NULL
                AND trading_mode = $1
        `, [tradingMode]);

        const exit = exitQuality.rows[0];
        if (parseInt(exit.total_with_peak_data) > 0) {
            console.log(`Trades with Peak Data: ${exit.total_with_peak_data}`);
            console.log(`\n📈 Profit Analysis:`);
            console.log(`  Average Peak Profit: ${parseFloat(exit.avg_peak_profit || 0).toFixed(2)}%`);
            console.log(`  Average Actual Profit: ${parseFloat(exit.avg_actual_profit || 0).toFixed(2)}%`);
            console.log(`  Average Profit Left on Table: ${parseFloat(exit.avg_profit_left_on_table || 0).toFixed(2)}%`);
            console.log(`  Trades Left >2% Profit: ${exit.trades_left_2pct_plus} (${(parseInt(exit.trades_left_2pct_plus) / parseInt(exit.total_with_peak_data) * 100).toFixed(1)}%)`);
            console.log(`  Trades Left >1% Profit: ${exit.trades_left_1pct_plus} (${(parseInt(exit.trades_left_1pct_plus) / parseInt(exit.total_with_peak_data) * 100).toFixed(1)}%)`);
            console.log(`\n🎯 Exit Distance:`);
            console.log(`  Average Distance to TP: ${parseFloat(exit.avg_distance_to_tp || 0).toFixed(2)}%`);
            console.log(`  Average Distance to SL: ${parseFloat(exit.avg_distance_to_sl || 0).toFixed(2)}%`);
            console.log(`  TP Hit Count: ${exit.tp_hit_count || 0}`);
            console.log(`  SL Hit Count: ${exit.sl_hit_count || 0}`);
            console.log(`\n⏱️  Time Analysis:`);
            console.log(`  Average Time in Profit: ${parseFloat(exit.avg_time_in_profit || 0).toFixed(2)} hours`);
            console.log(`  Average Time in Loss: ${parseFloat(exit.avg_time_in_loss || 0).toFixed(2)} hours`);
        } else {
            console.log('⚠️  No trades with peak profit data available');
        }

        // ============================================
        // 3. EXIT REASON ANALYSIS
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🚪 EXIT REASON ANALYSIS');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const exitReasons = await dbClient.query(`
            SELECT 
                exit_reason,
                COUNT(*) as count,
                AVG(pnl_percent) as avg_pnl,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(peak_profit_percent - pnl_percent) as avg_profit_left,
                AVG(duration_hours) as avg_duration
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND exit_reason IS NOT NULL
                AND trading_mode = $1
            GROUP BY exit_reason
            ORDER BY count DESC
        `, [tradingMode]);

        console.log('Exit Reason Breakdown:');
        exitReasons.rows.forEach(row => {
            console.log(`\n  ${row.exit_reason || 'Unknown'}:`);
            console.log(`    Count: ${row.count}`);
            console.log(`    Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
            console.log(`    Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            console.log(`    Avg Profit Left: ${parseFloat(row.avg_profit_left || 0).toFixed(2)}%`);
            console.log(`    Avg Duration: ${parseFloat(row.avg_duration || 0).toFixed(2)}h`);
        });

        // ============================================
        // 4. STRATEGY PERFORMANCE
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('📊 STRATEGY PERFORMANCE (Top 20)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const strategyPerf = await dbClient.query(`
            SELECT 
                strategy_name,
                COUNT(*) as trade_count,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl,
                SUM(pnl_usdt) as total_pnl,
                AVG(peak_profit_percent - pnl_percent) as avg_profit_left,
                AVG(duration_hours) as avg_duration
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND strategy_name IS NOT NULL
                AND trading_mode = $1
            GROUP BY strategy_name
            HAVING COUNT(*) >= 3
            ORDER BY total_pnl DESC
            LIMIT 20
        `, [tradingMode]);

        console.log('Top Performing Strategies:');
        strategyPerf.rows.forEach((row, index) => {
            console.log(`\n  ${index + 1}. ${row.strategy_name}:`);
            console.log(`     Trades: ${row.trade_count}`);
            console.log(`     Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
            console.log(`     Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            console.log(`     Total P&L: $${parseFloat(row.total_pnl || 0).toFixed(2)}`);
            console.log(`     Avg Profit Left: ${parseFloat(row.avg_profit_left || 0).toFixed(2)}%`);
        });

        // ============================================
        // 5. MARKET REGIME IMPACT
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🌊 MARKET REGIME IMPACT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const regimeImpact = await dbClient.query(`
            SELECT 
                market_regime,
                COUNT(*) as trade_count,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl,
                AVG(conviction_score) as avg_conviction,
                AVG(combined_strength) as avg_strength
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND market_regime IS NOT NULL
                AND trading_mode = $1
            GROUP BY market_regime
            ORDER BY trade_count DESC
        `, [tradingMode]);

        console.log('Performance by Market Regime:');
        regimeImpact.rows.forEach(row => {
            console.log(`\n  ${row.market_regime || 'Unknown'}:`);
            console.log(`    Trades: ${row.trade_count}`);
            console.log(`    Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
            console.log(`    Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            console.log(`    Avg Conviction: ${parseFloat(row.avg_conviction || 0).toFixed(1)}`);
            console.log(`    Avg Strength: ${parseFloat(row.avg_strength || 0).toFixed(0)}`);
        });

        // ============================================
        // 6. ENTRY QUALITY CORRELATION
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🎯 ENTRY QUALITY CORRELATION');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const entryQuality = await dbClient.query(`
            SELECT 
                CASE 
                    WHEN entry_momentum_score >= 70 THEN 'High Momentum (70+)'
                    WHEN entry_momentum_score >= 40 THEN 'Medium Momentum (40-70)'
                    WHEN entry_momentum_score >= 0 THEN 'Low Momentum (0-40)'
                    ELSE 'Negative Momentum'
                END as momentum_category,
                COUNT(*) as trade_count,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl,
                AVG(entry_momentum_score) as avg_momentum
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND entry_momentum_score IS NOT NULL
                AND trading_mode = $1
            GROUP BY momentum_category
            ORDER BY avg_momentum DESC
        `, [tradingMode]);

        if (entryQuality.rows.length > 0) {
            console.log('Performance by Entry Momentum:');
            entryQuality.rows.forEach(row => {
                console.log(`\n  ${row.momentum_category}:`);
                console.log(`    Trades: ${row.trade_count}`);
                console.log(`    Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
                console.log(`    Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            });
        } else {
            console.log('⚠️  No entry momentum data available');
        }

        // Check entry near support/resistance
        const entrySR = await dbClient.query(`
            SELECT 
                CASE 
                    WHEN entry_near_support = true THEN 'Near Support'
                    WHEN entry_near_resistance = true THEN 'Near Resistance'
                    ELSE 'No Key Level'
                END as entry_context,
                COUNT(*) as trade_count,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND (entry_near_support IS NOT NULL OR entry_near_resistance IS NOT NULL)
                AND trading_mode = $1
            GROUP BY entry_context
        `, [tradingMode]);

        if (entrySR.rows.length > 0) {
            console.log('\nPerformance by Entry Context:');
            entrySR.rows.forEach(row => {
                console.log(`\n  ${row.entry_context}:`);
                console.log(`    Trades: ${row.trade_count}`);
                console.log(`    Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
                console.log(`    Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            });
        }

        // ============================================
        // 7. CONVICTION SCORE IMPACT
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('💪 CONVICTION SCORE IMPACT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const convictionImpact = await dbClient.query(`
            SELECT 
                CASE 
                    WHEN conviction_score >= 80 THEN 'Very High (80+)'
                    WHEN conviction_score >= 60 THEN 'High (60-80)'
                    WHEN conviction_score >= 40 THEN 'Medium (40-60)'
                    ELSE 'Low (<40)'
                END as conviction_category,
                COUNT(*) as trade_count,
                AVG(CASE WHEN pnl_percent > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_percent) as avg_pnl,
                AVG(conviction_score) as avg_conviction
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND conviction_score IS NOT NULL
                AND trading_mode = $1
            GROUP BY conviction_category
            ORDER BY avg_conviction DESC
        `, [tradingMode]);

        if (convictionImpact.rows.length > 0) {
            console.log('Performance by Conviction Score:');
            convictionImpact.rows.forEach(row => {
                console.log(`\n  ${row.conviction_category}:`);
                console.log(`    Trades: ${row.trade_count}`);
                console.log(`    Win Rate: ${parseFloat(row.win_rate || 0).toFixed(1)}%`);
                console.log(`    Avg P&L: ${parseFloat(row.avg_pnl || 0).toFixed(2)}%`);
            });
        }

        // ============================================
        // 8. DATA QUALITY CHECK
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🔍 DATA QUALITY CHECK');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const dataQuality = await dbClient.query(`
            SELECT 
                COUNT(*) as total_closed_trades,
                COUNT(CASE WHEN peak_profit_percent IS NOT NULL THEN 1 END) as has_peak_data,
                COUNT(CASE WHEN time_in_profit_hours IS NOT NULL THEN 1 END) as has_time_data,
                COUNT(CASE WHEN distance_to_tp_at_exit IS NOT NULL THEN 1 END) as has_tp_distance,
                COUNT(CASE WHEN entry_momentum_score IS NOT NULL THEN 1 END) as has_entry_momentum,
                COUNT(CASE WHEN market_regime_at_exit IS NOT NULL THEN 1 END) as has_exit_regime,
                COUNT(CASE WHEN slippage_entry IS NOT NULL THEN 1 END) as has_slippage_data
            FROM trades
            WHERE exit_timestamp IS NOT NULL
                AND trading_mode = $1
        `, [tradingMode]);

        const quality = dataQuality.rows[0];
        const total = parseInt(quality.total_closed_trades);
        console.log(`Total Closed Trades: ${total}`);
        console.log(`\nAnalytics Field Coverage:`);
        console.log(`  Peak Profit Data: ${quality.has_peak_data} (${(parseInt(quality.has_peak_data) / total * 100).toFixed(1)}%)`);
        console.log(`  Time in Profit/Loss: ${quality.has_time_data} (${(parseInt(quality.has_time_data) / total * 100).toFixed(1)}%)`);
        console.log(`  TP Distance at Exit: ${quality.has_tp_distance} (${(parseInt(quality.has_tp_distance) / total * 100).toFixed(1)}%)`);
        console.log(`  Entry Momentum Score: ${quality.has_entry_momentum} (${(parseInt(quality.has_entry_momentum) / total * 100).toFixed(1)}%)`);
        console.log(`  Exit Market Regime: ${quality.has_exit_regime} (${(parseInt(quality.has_exit_regime) / total * 100).toFixed(1)}%)`);
        console.log(`  Slippage Data: ${quality.has_slippage_data} (${(parseInt(quality.has_slippage_data) / total * 100).toFixed(1)}%)`);

        // ============================================
        // 9. KEY FINDINGS & RECOMMENDATIONS
        // ============================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('💡 KEY FINDINGS & RECOMMENDATIONS');
        console.log('═══════════════════════════════════════════════════════════════\n');

        // Calculate key metrics for recommendations
        const winRate = parseFloat(stats.win_rate || 0);
        const avgPnl = parseFloat(stats.avg_pnl_percent || 0);
        const profitLeft = parseFloat(exit.avg_profit_left_on_table || 0);
        const tpHitRate = exit.tp_hit_count ? (parseInt(exit.tp_hit_count) / parseInt(exit.total_with_peak_data) * 100) : 0;
        const slHitRate = exit.sl_hit_count ? (parseInt(exit.sl_hit_count) / parseInt(exit.total_with_peak_data) * 100) : 0;

        console.log('📊 Performance Assessment:');
        if (winRate >= 55) {
            console.log(`  ✅ Win Rate: ${winRate.toFixed(1)}% - EXCELLENT`);
        } else if (winRate >= 50) {
            console.log(`  ⚠️  Win Rate: ${winRate.toFixed(1)}% - GOOD, but could improve`);
        } else {
            console.log(`  ❌ Win Rate: ${winRate.toFixed(1)}% - NEEDS IMPROVEMENT`);
        }

        if (avgPnl > 0.5) {
            console.log(`  ✅ Average P&L: ${avgPnl.toFixed(2)}% - POSITIVE`);
        } else if (avgPnl > 0) {
            console.log(`  ⚠️  Average P&L: ${avgPnl.toFixed(2)}% - SLIGHTLY POSITIVE`);
        } else {
            console.log(`  ❌ Average P&L: ${avgPnl.toFixed(2)}% - NEGATIVE`);
        }

        console.log('\n🎯 Exit Quality Assessment:');
        if (profitLeft > 2.0) {
            console.log(`  ❌ CRITICAL: Average ${profitLeft.toFixed(2)}% profit left on table - EXITS ARE TOO EARLY`);
            console.log(`     Recommendation: Implement dynamic exit timing to hold longer`);
        } else if (profitLeft > 1.0) {
            console.log(`  ⚠️  Average ${profitLeft.toFixed(2)}% profit left on table - EXITS COULD BE OPTIMIZED`);
            console.log(`     Recommendation: Review exit logic, consider trailing stops`);
        } else {
            console.log(`  ✅ Average ${profitLeft.toFixed(2)}% profit left on table - GOOD EXIT TIMING`);
        }

        if (tpHitRate < 20) {
            console.log(`  ⚠️  TP Hit Rate: ${tpHitRate.toFixed(1)}% - Take profits may be too far`);
            console.log(`     Recommendation: Review TP distances, may need adjustment`);
        }

        if (slHitRate > 30) {
            console.log(`  ⚠️  SL Hit Rate: ${slHitRate.toFixed(1)}% - Stop losses may be too tight`);
            console.log(`     Recommendation: Review SL distances, consider widening`);
        }

        console.log('\n📈 Data Quality Assessment:');
        const peakDataCoverage = (parseInt(quality.has_peak_data) / total * 100);
        if (peakDataCoverage < 50) {
            console.log(`  ❌ Peak profit data only available for ${peakDataCoverage.toFixed(1)}% of trades`);
            console.log(`     Recommendation: Ensure peak tracking is enabled for all positions`);
        }

        const timeDataCoverage = (parseInt(quality.has_time_data) / total * 100);
        if (timeDataCoverage < 50) {
            console.log(`  ❌ Time in profit/loss data only available for ${timeDataCoverage.toFixed(1)}% of trades`);
            console.log(`     Recommendation: Enable time tracking during position monitoring`);
        }

        console.log('\n🔧 Priority Improvements:');
        const improvements = [];
        
        if (winRate < 50) {
            improvements.push('1. Improve entry quality - win rate below 50%');
        }
        if (profitLeft > 1.5) {
            improvements.push('2. Implement dynamic exit timing - significant profit left on table');
        }
        if (tpHitRate < 15) {
            improvements.push('3. Review and adjust take profit distances');
        }
        if (slHitRate > 25) {
            improvements.push('4. Review and adjust stop loss distances');
        }
        if (peakDataCoverage < 80) {
            improvements.push('5. Enable peak profit tracking for all positions');
        }
        if (timeDataCoverage < 80) {
            improvements.push('6. Enable time in profit/loss tracking');
        }

        if (improvements.length === 0) {
            console.log('  ✅ System is performing well! Continue monitoring.');
        } else {
            improvements.forEach(imp => console.log(`  ${imp}`));
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('Analysis Complete!');
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('[TRADE_ANALYSIS] ❌ Error analyzing trades:', error);
        console.error('[TRADE_ANALYSIS] Error stack:', error.stack);
    } finally {
        await dbClient.end();
        console.log('[TRADE_ANALYSIS] Database connection closed.');
    }
}

// Run analysis
const tradingModeArg = process.argv[2];
analyzeTradeQuality(tradingModeArg || 'testnet');

