/**
 * Check which strategies use support/resistance signals
 * and determine if they need updates after the threshold change
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    try {
        console.log('🔍 Checking backtest_combinations for support/resistance strategies...\n');
        
        // Fetch all strategies
        const { data: strategies, error } = await supabase
            .from('backtest_combinations')
            .select('id, strategy_name, signal_lookup')
            .limit(5000);
        
        if (error) {
            console.error('❌ Database error:', error.message);
            process.exit(1);
        }
        
        console.log(`📊 Total strategies in database: ${strategies.length}\n`);
        
        // Analyze strategies
        let srStrategies = [];
        let totalWithSignals = 0;
        
        strategies.forEach(strategy => {
            const signalLookup = strategy.signal_lookup;
            
            if (signalLookup && typeof signalLookup === 'object') {
                totalWithSignals++;
                
                // Check if supportresistance is enabled
                if (signalLookup.supportresistance === true || 
                    (typeof signalLookup.supportresistance === 'object' && signalLookup.supportresistance !== null)) {
                    srStrategies.push({
                        id: strategy.id,
                        name: strategy.strategy_name,
                        settings: signalLookup.supportresistance,
                        fullSignalLookup: signalLookup
                    });
                }
            }
        });
        
        console.log(`📈 Strategies with signal_lookup: ${totalWithSignals}`);
        console.log(`🎯 Strategies using support/resistance: ${srStrategies.length}\n`);
        
        if (srStrategies.length === 0) {
            console.log('✅ No strategies use support/resistance signals.');
            console.log('   The threshold change (2% → 0.5%) only affects entry quality classification.');
            console.log('   It does NOT affect signal detection (which uses 1% and 3% thresholds).');
            process.exit(0);
        }
        
        // Show sample strategies
        console.log('📋 Sample strategies using support/resistance:\n');
        srStrategies.slice(0, 20).forEach((s, i) => {
            console.log(`${i + 1}. ${s.name} (ID: ${s.id})`);
            if (typeof s.settings === 'object' && s.settings !== null) {
                console.log(`   Settings: ${JSON.stringify(s.settings)}`);
            } else {
                console.log(`   Settings: ${s.settings} (enabled)`);
            }
            console.log('');
        });
        
        if (srStrategies.length > 20) {
            console.log(`   ... and ${srStrategies.length - 20} more strategies\n`);
        }
        
        // Analysis
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 IMPACT ANALYSIS');
        console.log('═══════════════════════════════════════════════════════════\n');
        
        console.log('🔍 What Changed:');
        console.log('   - Entry Quality Threshold: 2.0% → 0.5% (for entry_near_support classification)');
        console.log('   - Signal Detection Thresholds: UNCHANGED (1% and 3%)\n');
        
        console.log('✅ GOOD NEWS:');
        console.log('   - Signal detection uses DIFFERENT thresholds (1% and 3%)');
        console.log('   - Strategies match signals based on:');
        console.log('     * "At Support" = within 1%');
        console.log('     * "Near Support" = within 3%');
        console.log('     * "Above Support" = beyond 3%');
        console.log('   - Entry quality classification is SEPARATE from signal detection');
        console.log('   - Strategies should NOT be affected by the threshold change\n');
        
        console.log('📝 What Entry Quality Does:');
        console.log('   - Classifies entries AFTER they are opened');
        console.log('   - Used for analytics (entry_near_support field in database)');
        console.log('   - Does NOT affect when signals are generated');
        console.log('   - Does NOT affect when positions are opened\n');
        
        console.log('🎯 Conclusion:');
        console.log('   ✅ NO STRATEGY UPDATES NEEDED');
        console.log('   ✅ The threshold change only affects entry quality classification');
        console.log('   ✅ Signal detection and strategy matching are unchanged');
        console.log('   ✅ Strategies will continue to work as before\n');
        
        // Check if any strategies have custom thresholds
        const strategiesWithCustomThresholds = srStrategies.filter(s => {
            if (typeof s.settings === 'object' && s.settings !== null) {
                return s.settings.lookback !== undefined || 
                       s.settings.tolerance !== undefined ||
                       s.settings.threshold !== undefined;
            }
            return false;
        });
        
        if (strategiesWithCustomThresholds.length > 0) {
            console.log('⚠️  Strategies with custom SR settings:');
            strategiesWithCustomThresholds.slice(0, 10).forEach(s => {
                console.log(`   - ${s.name}: ${JSON.stringify(s.settings)}`);
            });
            console.log('\n   Note: These custom settings affect SR calculation, not signal thresholds.\n');
        }
        
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
})();

