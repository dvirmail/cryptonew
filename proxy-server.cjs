#!/usr/bin/env node

// Binance Proxy Server for CryptoSentinel
// This server proxies Binance API calls to avoid CORS issues

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3003;

// PostgreSQL configuration
const dbConfig = {
    user: process.env.DB_USER || 'dvirturkenitch',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'dvirturkenitch',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
    // Note: Transaction isolation is set via SQL command after connection (see initDatabase)
};

// PostgreSQL client
let dbClient = null;

// Initialize database connection
async function initDatabase() {
    try {
        dbClient = new Client(dbConfig);
        await dbClient.connect();
        console.log('[PROXY] ✅ Connected to PostgreSQL database');
        
        // Test the connection
        const result = await dbClient.query('SELECT NOW()');
        console.log('[PROXY] 📊 Database connection test successful:', result.rows[0]);
        
        // CRITICAL: Set transaction isolation level to READ COMMITTED to ensure we can see committed data
        // This prevents issues where queries can't see recently committed inserts
        try {
            await dbClient.query("SET SESSION default_transaction_isolation = 'read_committed'");
            const isolationResult = await dbClient.query('SHOW default_transaction_isolation');
            console.log(`[PROXY] 📊 Transaction isolation level: ${isolationResult.rows[0]?.default_transaction_isolation || 'unknown'}`);
        } catch (isoError) {
            console.warn('[PROXY] ⚠️ Could not set transaction isolation level:', isoError.message);
        }
        
        return true;
    } catch (error) {
        console.error('[PROXY] ❌ Database connection failed:', error.message);
        console.log('[PROXY] ⚠️ Continuing with file-based storage only');
        dbClient = null;
        return false;
    }
}

// Database helper functions for Trade
function ensureUuid(id) {
    try {
        return (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
            ? id
            : uuidv4();
    } catch (_) {
        return uuidv4();
    }
}
async function saveTradeToDB(trade) {
    //console.log('[debug_save] ==========================================');
    //console.log('[debug_save] saveTradeToDB CALLED');
    //console.log('[debug_save] dbClient available:', dbClient !== null);
    
    if (!dbClient) {
        console.log('[debug_save] ⚠️ Database client not available, skipping trade save');
        console.log('[debug_save] ⚠️ Trade will be saved to file storage only');
        return false;
    }
    
    try {
        //console.log('[debug_save] Attempting to save trade to database:', trade.id);
        //console.log('[debug_save] Trade position_id:', trade.position_id);
        /*console.log('[debug_save] Trade data:', {
            id: trade.id,
            symbol: trade.symbol,
            side: trade.side || (trade.direction === 'long' ? 'BUY' : trade.direction === 'short' ? 'SELL' : trade.direction),
            conviction_score: Math.round(trade.conviction_score || 0)
        });*/
        
        // CRITICAL FIX: Enhanced duplicate detection
        // All positions should have position_id - validate and use for duplicate detection
        if (!trade.position_id) {
            console.error(`[debug_save] ❌ CRITICAL: Trade missing position_id! Trade ID: ${trade.id}, Symbol: ${trade.symbol}, Strategy: ${trade.strategy_name}`);
            console.error(`[debug_save] ❌ Trade data:`, {
                id: trade.id,
                trade_id: trade.trade_id,
                position_id: trade.position_id,
                symbol: trade.symbol,
                strategy_name: trade.strategy_name
            });
            // Still proceed with characteristic-based duplicate check below
        } else {
            // Check 1: By position_id (most reliable - all positions have position_id)
            const positionIdQuery = `
                SELECT id FROM trades
                WHERE position_id = $1
                LIMIT 1
            `;
            const positionIdCheck = await dbClient.query(positionIdQuery, [trade.position_id]);
            if (positionIdCheck.rows.length > 0) {
                const existingId = positionIdCheck.rows[0].id;
                console.log(`[debug_save] ⚠️ Duplicate trade detected by position_id, skipping insert. Existing trade ID: ${existingId}, Position ID: ${trade.position_id}, New trade ID: ${trade.id}`);
                return false;
            }
        }
        
        // Check 2: By trade characteristics (symbol, entry_price, exit_price, quantity, entry_timestamp, strategy_name)
        // Fallback check for cases where position_id might be missing (shouldn't happen, but defensive)
        if (trade.exit_timestamp && trade.entry_timestamp && trade.symbol) {
            const entryTs = new Date(trade.entry_timestamp);
            // Use 2-second window for timestamp matching to handle edge cases
            const entryTsStart = new Date(Math.floor(entryTs.getTime() / 2000) * 2000 - 1000).toISOString();
            const entryTsEnd = new Date(Math.ceil(entryTs.getTime() / 2000) * 2000 + 1000).toISOString();
            
            const checkQuery = `
                SELECT id, position_id FROM trades
                WHERE symbol = $1
                  AND COALESCE(strategy_name, '') = COALESCE($2, '')
                  AND ABS(entry_price - $3) < 0.0001
                  AND ABS(exit_price - $4) < 0.0001
                  AND ABS(quantity - $5) < 0.000001
                  AND entry_timestamp >= $6
                  AND entry_timestamp <= $7
                  AND trading_mode = $8
                  AND exit_timestamp IS NOT NULL
                LIMIT 1
            `;
            
            const checkValues = [
                trade.symbol,
                trade.strategy_name || '',
                trade.entry_price,
                trade.exit_price,
                trade.quantity || trade.quantity_crypto,
                entryTsStart,
                entryTsEnd,
                trade.trading_mode || 'testnet'
            ];
            
            const duplicateCheck = await dbClient.query(checkQuery, checkValues);
            if (duplicateCheck.rows.length > 0) {
                const existingId = duplicateCheck.rows[0].id;
                const existingPositionId = duplicateCheck.rows[0].position_id;
                console.log(`[debug_save] ⚠️ Duplicate trade detected by characteristics, skipping insert. Existing trade ID: ${existingId}, Position ID: ${existingPositionId}, New trade ID: ${trade.id}`);
                return false;
            }
        }
        
        const query = `
            INSERT INTO trades (
                id, position_id, symbol, side, quantity, entry_price, exit_price, entry_timestamp, exit_timestamp,
                pnl_usdt, pnl_percent, commission, trading_mode, strategy_name,
                conviction_score, market_regime, created_date, updated_date,
                fear_greed_score, fear_greed_classification, lpm_score, combined_strength,
                conviction_breakdown, conviction_multiplier, regime_confidence, atr_value,
                is_event_driven_strategy, trigger_signals, duration_seconds, duration_hours, exit_reason,
                stop_loss_price, take_profit_price, volatility_at_open, volatility_label_at_open,
                regime_impact_on_strength, correlation_impact_on_strength, effective_balance_risk_at_open,
                btc_price_at_open, exit_time,
                market_regime_at_exit, regime_confidence_at_exit, fear_greed_score_at_exit, fear_greed_classification_at_exit,
                volatility_at_exit, volatility_label_at_exit, btc_price_at_exit, lpm_score_at_exit,
                max_favorable_excursion, max_adverse_excursion, peak_profit_usdt, peak_loss_usdt,
                peak_profit_percent, peak_loss_percent, price_movement_percent,
                distance_to_sl_at_exit, distance_to_tp_at_exit, sl_hit_boolean, tp_hit_boolean,
                exit_vs_planned_exit_time_minutes, slippage_entry, slippage_exit,
                time_in_profit_hours, time_in_loss_hours, time_at_peak_profit, time_at_max_loss,
                regime_changes_during_trade, entry_order_type, exit_order_type, entry_order_id, exit_order_id,
                entry_fill_time_ms, exit_fill_time_ms,
                strategy_win_rate_at_entry, strategy_occurrences_at_entry, similar_trades_count,
                consecutive_wins_before, consecutive_losses_before,
                entry_near_support, entry_near_resistance, entry_distance_to_support_percent,
                entry_distance_to_resistance_percent, entry_momentum_score, entry_relative_to_day_high_percent,
                entry_relative_to_day_low_percent, entry_volume_vs_average
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66, $67, $68, $69, $70, $71, $72, $73, $74, $75, $76, $77, $78, $79, $80, $81, $82, $83, $84, $85, $86)
            ON CONFLICT (id) DO UPDATE SET
                exit_price = EXCLUDED.exit_price,
                exit_timestamp = EXCLUDED.exit_timestamp,
                pnl_usdt = EXCLUDED.pnl_usdt,
                pnl_percent = EXCLUDED.pnl_percent,
                commission = EXCLUDED.commission,
                duration_seconds = EXCLUDED.duration_seconds,
                duration_hours = EXCLUDED.duration_hours,
                exit_reason = EXCLUDED.exit_reason,
                updated_date = EXCLUDED.updated_date,
                stop_loss_price = EXCLUDED.stop_loss_price,
                take_profit_price = EXCLUDED.take_profit_price,
                volatility_at_open = EXCLUDED.volatility_at_open,
                volatility_label_at_open = EXCLUDED.volatility_label_at_open,
                regime_impact_on_strength = EXCLUDED.regime_impact_on_strength,
                correlation_impact_on_strength = EXCLUDED.correlation_impact_on_strength,
                effective_balance_risk_at_open = EXCLUDED.effective_balance_risk_at_open,
                btc_price_at_open = EXCLUDED.btc_price_at_open,
                exit_time = EXCLUDED.exit_time,
                market_regime_at_exit = EXCLUDED.market_regime_at_exit,
                regime_confidence_at_exit = EXCLUDED.regime_confidence_at_exit,
                fear_greed_score_at_exit = EXCLUDED.fear_greed_score_at_exit,
                fear_greed_classification_at_exit = EXCLUDED.fear_greed_classification_at_exit,
                volatility_at_exit = EXCLUDED.volatility_at_exit,
                volatility_label_at_exit = EXCLUDED.volatility_label_at_exit,
                btc_price_at_exit = EXCLUDED.btc_price_at_exit,
                lpm_score_at_exit = EXCLUDED.lpm_score_at_exit,
                max_favorable_excursion = EXCLUDED.max_favorable_excursion,
                max_adverse_excursion = EXCLUDED.max_adverse_excursion,
                peak_profit_usdt = EXCLUDED.peak_profit_usdt,
                peak_loss_usdt = EXCLUDED.peak_loss_usdt,
                peak_profit_percent = EXCLUDED.peak_profit_percent,
                peak_loss_percent = EXCLUDED.peak_loss_percent,
                price_movement_percent = EXCLUDED.price_movement_percent,
                distance_to_sl_at_exit = EXCLUDED.distance_to_sl_at_exit,
                distance_to_tp_at_exit = EXCLUDED.distance_to_tp_at_exit,
                sl_hit_boolean = EXCLUDED.sl_hit_boolean,
                tp_hit_boolean = EXCLUDED.tp_hit_boolean,
                exit_vs_planned_exit_time_minutes = EXCLUDED.exit_vs_planned_exit_time_minutes,
                slippage_entry = EXCLUDED.slippage_entry,
                slippage_exit = EXCLUDED.slippage_exit,
                time_in_profit_hours = EXCLUDED.time_in_profit_hours,
                time_in_loss_hours = EXCLUDED.time_in_loss_hours,
                time_at_peak_profit = EXCLUDED.time_at_peak_profit,
                time_at_max_loss = EXCLUDED.time_at_max_loss,
                regime_changes_during_trade = EXCLUDED.regime_changes_during_trade,
                entry_order_type = EXCLUDED.entry_order_type,
                exit_order_type = EXCLUDED.exit_order_type,
                entry_order_id = EXCLUDED.entry_order_id,
                exit_order_id = EXCLUDED.exit_order_id,
                entry_fill_time_ms = EXCLUDED.entry_fill_time_ms,
                exit_fill_time_ms = EXCLUDED.exit_fill_time_ms,
                strategy_win_rate_at_entry = EXCLUDED.strategy_win_rate_at_entry,
                strategy_occurrences_at_entry = EXCLUDED.strategy_occurrences_at_entry,
                similar_trades_count = EXCLUDED.similar_trades_count,
                consecutive_wins_before = EXCLUDED.consecutive_wins_before,
                consecutive_losses_before = EXCLUDED.consecutive_losses_before,
                entry_near_support = EXCLUDED.entry_near_support,
                entry_near_resistance = EXCLUDED.entry_near_resistance,
                entry_distance_to_support_percent = EXCLUDED.entry_distance_to_support_percent,
                entry_distance_to_resistance_percent = EXCLUDED.entry_distance_to_resistance_percent,
                entry_momentum_score = EXCLUDED.entry_momentum_score,
                entry_relative_to_day_high_percent = EXCLUDED.entry_relative_to_day_high_percent,
                entry_relative_to_day_low_percent = EXCLUDED.entry_relative_to_day_low_percent,
                entry_volume_vs_average = EXCLUDED.entry_volume_vs_average
        `;
        
        // 🔍 DEBUG: Log all trade data before database insertion
        /*console.log('[debug_save] Trade data being saved to database:', {
            id: ensureUuid(trade.id),
            symbol: trade.symbol,
            side: trade.side || (trade.direction === 'long' ? 'BUY' : trade.direction === 'short' ? 'SELL' : trade.direction),
            quantity: trade.quantity || trade.quantity_crypto,
            entry_price: trade.entry_price,
            exit_price: trade.exit_price,
            entry_timestamp: trade.entry_timestamp,
            exit_timestamp: trade.exit_timestamp,
            pnl_usdt: trade.pnl_usdt,
            pnl_percent: trade.pnl_percentage || trade.pnl_percent,
            commission: trade.commission || trade.total_fees_usdt,
            trading_mode: trade.trading_mode,
            strategy_name: trade.strategy_name,
            conviction_score: Math.round(trade.conviction_score || 0),
            market_regime: trade.market_regime,
            created_date: trade.created_date || new Date().toISOString(),
            // Analytics fields
            fear_greed_score: trade.fear_greed_score,
            fear_greed_classification: trade.fear_greed_classification,
            lpm_score: trade.lpm_score,
            combined_strength: trade.combined_strength,
            conviction_breakdown: trade.conviction_breakdown,
            conviction_multiplier: trade.conviction_multiplier,
            regime_confidence: trade.regime_confidence,
            atr_value: trade.atr_value,
            is_event_driven_strategy: trade.is_event_driven_strategy,
            trigger_signals: trade.trigger_signals
        });*/

        const values = [
            ensureUuid(trade.id),
            trade.position_id || null, // CRITICAL: All positions have position_id - use trade_id as fallback only if needed
            trade.symbol,
            trade.side || (trade.direction === 'long' ? 'BUY' : trade.direction === 'short' ? 'SELL' : trade.direction), // Convert direction to side
            trade.quantity || trade.quantity_crypto,
            trade.entry_price,
            trade.exit_price,
            trade.entry_timestamp,
            trade.exit_timestamp,
            trade.pnl_usdt,
            trade.pnl_percentage || trade.pnl_percent,
            trade.commission || trade.total_fees_usdt,
            trade.trading_mode,
            trade.strategy_name,
            Math.round(trade.conviction_score || 0), // Convert to integer
            trade.market_regime,
            trade.created_date || new Date().toISOString(),
            new Date().toISOString(),
            // Analytics fields
            trade.fear_greed_score,
            trade.fear_greed_classification,
            trade.lpm_score,
            trade.combined_strength,
            trade.conviction_breakdown ? JSON.stringify(trade.conviction_breakdown) : null,
            trade.conviction_multiplier,
            trade.regime_confidence,
            trade.atr_value,
            trade.is_event_driven_strategy,
            trade.trigger_signals ? JSON.stringify(trade.trigger_signals) : null,
            // Duration and exit reason fields
            trade.duration_seconds !== undefined && trade.duration_seconds !== null ? Math.round(trade.duration_seconds) : null,
            trade.duration_hours !== undefined && trade.duration_hours !== null ? parseFloat(trade.duration_hours) : null,
            trade.exit_reason || null,
            // NEW: Analytics fields from position opening
            trade.stop_loss_price !== undefined && trade.stop_loss_price !== null ? parseFloat(trade.stop_loss_price) : null,
            trade.take_profit_price !== undefined && trade.take_profit_price !== null ? parseFloat(trade.take_profit_price) : null,
            trade.volatility_at_open !== undefined && trade.volatility_at_open !== null ? parseFloat(trade.volatility_at_open) : null,
            trade.volatility_label_at_open || null,
            trade.regime_impact_on_strength !== undefined && trade.regime_impact_on_strength !== null ? parseFloat(trade.regime_impact_on_strength) : null,
            trade.correlation_impact_on_strength !== undefined && trade.correlation_impact_on_strength !== null ? parseFloat(trade.correlation_impact_on_strength) : null,
            trade.effective_balance_risk_at_open !== undefined && trade.effective_balance_risk_at_open !== null ? parseFloat(trade.effective_balance_risk_at_open) : null,
            trade.btc_price_at_open !== undefined && trade.btc_price_at_open !== null ? parseFloat(trade.btc_price_at_open) : null,
            trade.exit_time || null,
            // NEW: Exit-time market conditions (Priority 1)
            trade.market_regime_at_exit || null,
            trade.regime_confidence_at_exit !== undefined && trade.regime_confidence_at_exit !== null ? parseFloat(trade.regime_confidence_at_exit) : null,
            trade.fear_greed_score_at_exit !== undefined && trade.fear_greed_score_at_exit !== null ? parseInt(trade.fear_greed_score_at_exit, 10) : null,
            trade.fear_greed_classification_at_exit || null,
            trade.volatility_at_exit !== undefined && trade.volatility_at_exit !== null ? parseFloat(trade.volatility_at_exit) : null,
            trade.volatility_label_at_exit || null,
            trade.btc_price_at_exit !== undefined && trade.btc_price_at_exit !== null ? parseFloat(trade.btc_price_at_exit) : null,
            trade.lpm_score_at_exit !== undefined && trade.lpm_score_at_exit !== null ? parseFloat(trade.lpm_score_at_exit) : null,
            // NEW: Price movement metrics - MFE/MAE (Priority 1)
            trade.max_favorable_excursion !== undefined && trade.max_favorable_excursion !== null ? parseFloat(trade.max_favorable_excursion) : null,
            trade.max_adverse_excursion !== undefined && trade.max_adverse_excursion !== null ? parseFloat(trade.max_adverse_excursion) : null,
            trade.peak_profit_usdt !== undefined && trade.peak_profit_usdt !== null ? parseFloat(trade.peak_profit_usdt) : null,
            trade.peak_loss_usdt !== undefined && trade.peak_loss_usdt !== null ? parseFloat(trade.peak_loss_usdt) : null,
            trade.peak_profit_percent !== undefined && trade.peak_profit_percent !== null ? parseFloat(trade.peak_profit_percent) : null,
            trade.peak_loss_percent !== undefined && trade.peak_loss_percent !== null ? parseFloat(trade.peak_loss_percent) : null,
            trade.price_movement_percent !== undefined && trade.price_movement_percent !== null ? parseFloat(trade.price_movement_percent) : null,
            // NEW: Exit quality metrics (Priority 1)
            trade.distance_to_sl_at_exit !== undefined && trade.distance_to_sl_at_exit !== null ? parseFloat(trade.distance_to_sl_at_exit) : null,
            trade.distance_to_tp_at_exit !== undefined && trade.distance_to_tp_at_exit !== null ? parseFloat(trade.distance_to_tp_at_exit) : null,
            trade.sl_hit_boolean !== undefined && trade.sl_hit_boolean !== null ? Boolean(trade.sl_hit_boolean) : null,
            trade.tp_hit_boolean !== undefined && trade.tp_hit_boolean !== null ? Boolean(trade.tp_hit_boolean) : null,
            trade.exit_vs_planned_exit_time_minutes !== undefined && trade.exit_vs_planned_exit_time_minutes !== null ? parseInt(trade.exit_vs_planned_exit_time_minutes, 10) : null,
            // NEW: Slippage tracking (Priority 2)
            trade.slippage_entry !== undefined && trade.slippage_entry !== null ? parseFloat(trade.slippage_entry) : null,
            trade.slippage_exit !== undefined && trade.slippage_exit !== null ? parseFloat(trade.slippage_exit) : null,
            // NEW: Trade lifecycle metrics (Priority 2)
            trade.time_in_profit_hours !== undefined && trade.time_in_profit_hours !== null ? parseFloat(trade.time_in_profit_hours) : null,
            trade.time_in_loss_hours !== undefined && trade.time_in_loss_hours !== null ? parseFloat(trade.time_in_loss_hours) : null,
            // CRITICAL: Use proper timestamp parsing for time_at_peak_profit and time_at_max_loss
            // These are ISO timestamp strings, not boolean values, so we need to check if they exist and are valid
            (trade.time_at_peak_profit !== undefined && trade.time_at_peak_profit !== null && trade.time_at_peak_profit !== '') 
                ? (typeof trade.time_at_peak_profit === 'string' ? trade.time_at_peak_profit : new Date(trade.time_at_peak_profit).toISOString())
                : null,
            (trade.time_at_max_loss !== undefined && trade.time_at_max_loss !== null && trade.time_at_max_loss !== '') 
                ? (typeof trade.time_at_max_loss === 'string' ? trade.time_at_max_loss : new Date(trade.time_at_max_loss).toISOString())
                : null,
            trade.regime_changes_during_trade !== undefined && trade.regime_changes_during_trade !== null ? parseInt(trade.regime_changes_during_trade, 10) : null,
            // NEW: Order execution metrics (Priority 3)
            trade.entry_order_type || null,
            trade.exit_order_type || null,
            trade.entry_order_id || null,
            trade.exit_order_id || null,
            trade.entry_fill_time_ms !== undefined && trade.entry_fill_time_ms !== null ? parseInt(trade.entry_fill_time_ms, 10) : null,
            trade.exit_fill_time_ms !== undefined && trade.exit_fill_time_ms !== null ? parseInt(trade.exit_fill_time_ms, 10) : null,
            // NEW: Strategy context metrics (Priority 3)
            trade.strategy_win_rate_at_entry !== undefined && trade.strategy_win_rate_at_entry !== null ? parseFloat(trade.strategy_win_rate_at_entry) : null,
            trade.strategy_occurrences_at_entry !== undefined && trade.strategy_occurrences_at_entry !== null ? parseInt(trade.strategy_occurrences_at_entry, 10) : null,
            trade.similar_trades_count !== undefined && trade.similar_trades_count !== null ? parseInt(trade.similar_trades_count, 10) : null,
            trade.consecutive_wins_before !== undefined && trade.consecutive_wins_before !== null ? parseInt(trade.consecutive_wins_before, 10) : null,
            trade.consecutive_losses_before !== undefined && trade.consecutive_losses_before !== null ? parseInt(trade.consecutive_losses_before, 10) : null,
            // NEW: Entry quality metrics (Priority 1)
            trade.entry_near_support !== undefined ? (trade.entry_near_support === true || trade.entry_near_support === 'true') : null,
            trade.entry_near_resistance !== undefined ? (trade.entry_near_resistance === true || trade.entry_near_resistance === 'true') : null,
            trade.entry_distance_to_support_percent !== undefined && trade.entry_distance_to_support_percent !== null ? parseFloat(trade.entry_distance_to_support_percent) : null,
            trade.entry_distance_to_resistance_percent !== undefined && trade.entry_distance_to_resistance_percent !== null ? parseFloat(trade.entry_distance_to_resistance_percent) : null,
            trade.entry_momentum_score !== undefined && trade.entry_momentum_score !== null ? parseFloat(trade.entry_momentum_score) : null,
            trade.entry_relative_to_day_high_percent !== undefined && trade.entry_relative_to_day_high_percent !== null ? parseFloat(trade.entry_relative_to_day_high_percent) : null,
            trade.entry_relative_to_day_low_percent !== undefined && trade.entry_relative_to_day_low_percent !== null ? parseFloat(trade.entry_relative_to_day_low_percent) : null,
            trade.entry_volume_vs_average !== undefined && trade.entry_volume_vs_average !== null ? parseFloat(trade.entry_volume_vs_average) : null
        ];
        
        // 🔍 DEBUG: Log exit analytics fields before saving
        // COMMENTED OUT: Too verbose - only enable for debugging specific trade saves
        /*
        console.log('='.repeat(80));
        console.log('[PROXY] 📊 EXIT ANALYTICS FIELDS RECEIVED IN saveTradeToDB');
        console.log('='.repeat(80));
        console.log(`[PROXY] Trade ID: ${values[0]}`);
        console.log(`[PROXY] Symbol: ${values[2]}`);
        console.log(`[PROXY] Position ID: ${values[1]}`);
        console.log(`[PROXY] 📊 TRADE LIFECYCLE METRICS (from values array):`);
        console.log(`  - time_in_profit_hours (index 62): ${values[62]}`);
        console.log(`  - time_in_loss_hours (index 63): ${values[63]}`);
        console.log(`  - time_at_peak_profit (index 64): ${values[64]}`);
        console.log(`  - time_at_max_loss (index 65): ${values[65]}`);
        console.log(`  - regime_changes_during_trade (index 66): ${values[66]}`);
        console.log(`[PROXY] 📊 ORDER EXECUTION METRICS (from values array):`);
        console.log(`  - entry_order_type (index 67): ${values[67]}`);
        console.log(`  - exit_order_type (index 68): ${values[68]}`);
        console.log(`  - entry_order_id (index 69): ${values[69]}`);
        console.log(`  - exit_order_id (index 70): ${values[70]}`);
        console.log(`[PROXY] 📊 RAW TRADE OBJECT VALUES:`);
        console.log(`  - trade.time_at_peak_profit: ${trade.time_at_peak_profit}`);
        console.log(`  - trade.time_at_max_loss: ${trade.time_at_max_loss}`);
        console.log(`  - trade.regime_changes_during_trade: ${trade.regime_changes_during_trade}`);
        console.log(`  - trade.entry_order_type: ${trade.entry_order_type}`);
        console.log(`  - trade.exit_order_type: ${trade.exit_order_type}`);
        console.log(`  - trade.entry_order_id: ${trade.entry_order_id}`);
        console.log(`  - trade.exit_order_id: ${trade.exit_order_id}`);
        console.log('');
        console.log('[PROXY] Exit Market Conditions (from values array):');
        console.log(`  - market_regime_at_exit (index 40): ${values[40] || 'null'}`);
        console.log(`  - regime_confidence_at_exit (index 41): ${values[41] !== null && values[41] !== undefined ? values[41] : 'null'}`);
        console.log(`  - fear_greed_score_at_exit (index 42): ${values[42] !== null && values[42] !== undefined ? values[42] : 'null'}`);
        console.log(`  - fear_greed_classification_at_exit (index 43): ${values[43] || 'null'}`);
        console.log(`  - volatility_at_exit (index 44): ${values[44] !== null && values[44] !== undefined ? values[44] : 'null'}`);
        console.log(`  - volatility_label_at_exit (index 45): ${values[45] || 'null'}`);
        console.log(`  - btc_price_at_exit (index 46): ${values[46] !== null && values[46] !== undefined ? values[46] : 'null'}`);
        console.log(`  - lpm_score_at_exit (index 47): ${values[47] !== null && values[47] !== undefined ? values[47] : 'null'}`);
        console.log('');
        console.log('[PROXY] Exit Metrics - MFE/MAE (from values array):');
        console.log(`  - max_favorable_excursion (index 48): ${values[48] !== null && values[48] !== undefined ? values[48] : 'null'}`);
        console.log(`  - max_adverse_excursion (index 49): ${values[49] !== null && values[49] !== undefined ? values[49] : 'null'}`);
        console.log(`  - peak_profit_usdt (index 50): ${values[50] !== null && values[50] !== undefined ? values[50] : 'null'}`);
        console.log(`  - peak_loss_usdt (index 51): ${values[51] !== null && values[51] !== undefined ? values[51] : 'null'}`);
        console.log(`  - peak_profit_percent (index 52): ${values[52] !== null && values[52] !== undefined ? values[52] : 'null'}`);
        console.log(`  - peak_loss_percent (index 53): ${values[53] !== null && values[53] !== undefined ? values[53] : 'null'}`);
        console.log(`  - price_movement_percent (index 54): ${values[54] !== null && values[54] !== undefined ? values[54] : 'null'}`);
        console.log('');
        console.log('[PROXY] Exit Quality Metrics (from values array):');
        console.log(`  - distance_to_sl_at_exit (index 55): ${values[55] !== null && values[55] !== undefined ? values[55] : 'null'}`);
        console.log(`  - distance_to_tp_at_exit (index 56): ${values[56] !== null && values[56] !== undefined ? values[56] : 'null'}`);
        console.log(`  - sl_hit_boolean (index 57): ${values[57] !== null && values[57] !== undefined ? values[57] : 'null'}`);
        console.log(`  - tp_hit_boolean (index 58): ${values[58] !== null && values[58] !== undefined ? values[58] : 'null'}`);
        console.log(`  - exit_vs_planned_exit_time_minutes (index 59): ${values[59] !== null && values[59] !== undefined ? values[59] : 'null'}`);
        console.log('');
        console.log('[PROXY] Trade Lifecycle Metrics (from values array):');
        console.log(`  - time_in_profit_hours (index 62): ${values[62] !== null && values[62] !== undefined ? values[62] : 'null'}`);
        console.log(`  - time_in_loss_hours (index 63): ${values[63] !== null && values[63] !== undefined ? values[63] : 'null'}`);
        console.log('='.repeat(80));
        console.log('');
        */
        
        try {
        await dbClient.query(query, values);
            // Only log on error - successful saves are too verbose
        
        // Update strategy's live performance asynchronously (non-blocking)
        // This ensures live performance is updated immediately when trades are closed
        if (trade.strategy_name) {
            updateStrategyLivePerformance(trade.strategy_name).catch(err => {
                console.error(`[PROXY] ⚠️ Error updating live performance for ${trade.strategy_name} (non-blocking):`, err.message);
            });
        }
        
        return true;
        } catch (queryError) {
            console.error('[PROXY] ❌ SQL QUERY ERROR:');
            console.error('[PROXY] ❌ Error message:', queryError.message);
            console.error('[PROXY] ❌ Error code:', queryError.code);
            console.error('[PROXY] ❌ Error detail:', queryError.detail);
            console.error('[PROXY] ❌ Error hint:', queryError.hint);
            console.error('[PROXY] ❌ Error position:', queryError.position);
            console.error('[PROXY] ❌ SQL Query (first 500 chars):', query.substring(0, 500));
            console.error('[PROXY] ❌ Values array length:', values.length);
            console.error('[PROXY] ❌ Values array (first 20):', values.slice(0, 20));
            console.error('[PROXY] ❌ Trade position_id:', trade.position_id);
            console.error('[PROXY] ❌ Trade symbol:', trade.symbol);
            throw queryError; // Re-throw to be caught by outer catch
        }
    } catch (error) {
        console.error('[debug_save] ❌ Error saving trade to database:', error.message);
        console.error('[debug_save] ❌ Error code:', error.code);
        console.error('[debug_save] ❌ Error details:', error);
        console.error('[debug_save] ❌ Error stack:', error.stack);
        if (error.detail) {
            console.error('[debug_save] ❌ PostgreSQL detail:', error.detail);
        }
        if (error.hint) {
            console.error('[debug_save] ❌ PostgreSQL hint:', error.hint);
        }
        console.error('[debug_save] ❌ Trade data that failed:', JSON.stringify(trade, null, 2));
        
        // Check if error is due to missing columns (e.g., duration_seconds, duration_hours, exit_reason)
        if (error.message && error.message.includes('column') && error.message.includes('does not exist')) {
            console.error('[debug_save] ❌ Database schema missing columns. Please run migration to add duration_seconds, duration_hours, and exit_reason columns.');
            console.error('[debug_save] ❌ SQL to add missing columns:');
            console.error('[debug_save] ❌ ALTER TABLE trades ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;');
            console.error('[debug_save] ❌ ALTER TABLE trades ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(10,4);');
            console.error('[debug_save] ❌ ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(50);');
        }
        
        return false;
    }
}

// Sync existing trades from memory to database
async function syncTradesToDatabase() {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database not available, skipping trade sync');
        return;
    }
    
    try {
        console.log('[PROXY] 📊 Syncing existing trades to database...');
        let syncedCount = 0;
        
        for (const trade of trades) {
            try {
                await saveTradeToDB(trade);
                syncedCount++;
            } catch (error) {
                console.error(`[PROXY] ❌ Error syncing trade ${trade.id}:`, error.message);
            }
        }
        
        console.log(`[PROXY] ✅ Synced ${syncedCount}/${trades.length} trades to database`);
    } catch (error) {
        console.error('[PROXY] ❌ Error syncing trades to database:', error.message);
    }
}

// Load trades from database into memory
async function loadTradesFromDB() {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database not available, cannot load trades from database');
        return [];
    }
    
    try {
        console.log('[PROXY] 📊 Loading trades from database...');
        
        // CRITICAL: Filter out invalid trades during load (nulls and invalid prices)
        const PRICE_THRESHOLDS = {
            'ETH/USDT': { min: 3808 },
            'SOL/USDT': { min: 184.77 },
            'XRP/USDT': { min: 2.47 }
        };
        
        // Build WHERE clause to exclude invalid trades (including analytics fields)
        const criticalColumns = [
            'symbol', 'entry_price', 'exit_price', 
            'entry_timestamp', 'exit_timestamp', 'quantity',
            'strategy_name', 'trading_mode', 'pnl_usdt', 'pnl_percent',
            'lpm_score', 'combined_strength', 'conviction_score', 'conviction_breakdown',
            'conviction_multiplier', 'market_regime', 'regime_confidence', 'atr_value',
            'is_event_driven_strategy'
        ];
        const nullChecks = criticalColumns.map(col => `${col} IS NOT NULL`).join(' AND ');
        
        // Build price threshold checks
        let priceChecks = [];
        for (const [symbol, threshold] of Object.entries(PRICE_THRESHOLDS)) {
            priceChecks.push(`NOT (symbol = '${symbol}' AND (entry_price < ${threshold.min} OR exit_price < ${threshold.min}))`);
        }
        const priceCheckClause = priceChecks.length > 0 ? ` AND (${priceChecks.join(' AND ')})` : '';
        
        const query = `
            SELECT 
                id, position_id, symbol, side, quantity, entry_price, exit_price, entry_timestamp, exit_timestamp,
                pnl_usdt, pnl_percent, commission, trading_mode, strategy_name,
                conviction_score, market_regime, created_date, updated_date,
                fear_greed_score, fear_greed_classification, lpm_score, combined_strength,
                conviction_breakdown, conviction_multiplier, regime_confidence, atr_value,
                is_event_driven_strategy, trigger_signals, duration_seconds, duration_hours, exit_reason
            FROM trades
            WHERE ${nullChecks}${priceCheckClause}
            ORDER BY exit_timestamp DESC NULLS LAST, created_date DESC
        `;
        
        const result = await dbClient.query(query);
        const dbTrades = result.rows || [];
        
        // Map database columns to in-memory trade format
        const mappedTrades = dbTrades.map(dbTrade => {
            return {
                id: dbTrade.id,
                trade_id: dbTrade.id, // For compatibility
                position_id: dbTrade.position_id || null, // CRITICAL: Include position_id for duplicate detection
                symbol: dbTrade.symbol,
                direction: dbTrade.side === 'BUY' ? 'long' : dbTrade.side === 'SELL' ? 'short' : 'long',
                side: dbTrade.side,
                quantity: dbTrade.quantity,
                quantity_crypto: dbTrade.quantity,
                entry_price: parseFloat(dbTrade.entry_price) || 0,
                exit_price: dbTrade.exit_price ? parseFloat(dbTrade.exit_price) : null,
                entry_timestamp: dbTrade.entry_timestamp,
                exit_timestamp: dbTrade.exit_timestamp,
                pnl_usdt: dbTrade.pnl_usdt ? parseFloat(dbTrade.pnl_usdt) : 0,
                pnl_percentage: dbTrade.pnl_percent ? parseFloat(dbTrade.pnl_percent) : 0,
                pnl_percent: dbTrade.pnl_percent ? parseFloat(dbTrade.pnl_percent) : 0,
                commission: dbTrade.commission ? parseFloat(dbTrade.commission) : 0,
                total_fees_usdt: dbTrade.commission ? parseFloat(dbTrade.commission) : 0,
                trading_mode: dbTrade.trading_mode || 'testnet',
                strategy_name: dbTrade.strategy_name || '',
                conviction_score: dbTrade.conviction_score || 0,
                market_regime: dbTrade.market_regime || null,
                created_date: dbTrade.created_date || dbTrade.entry_timestamp,
                updated_date: dbTrade.updated_date || dbTrade.exit_timestamp,
                // Analytics fields
                fear_greed_score: dbTrade.fear_greed_score || null,
                fear_greed_classification: dbTrade.fear_greed_classification || null,
                lpm_score: dbTrade.lpm_score || null,
                combined_strength: dbTrade.combined_strength || null,
                conviction_breakdown: dbTrade.conviction_breakdown ? 
                    (typeof dbTrade.conviction_breakdown === 'string' ? 
                        JSON.parse(dbTrade.conviction_breakdown) : 
                        dbTrade.conviction_breakdown) : null,
                conviction_multiplier: dbTrade.conviction_multiplier || null,
                regime_confidence: dbTrade.regime_confidence || null,
                atr_value: dbTrade.atr_value || null,
                is_event_driven_strategy: dbTrade.is_event_driven_strategy || false,
                trigger_signals: dbTrade.trigger_signals ? 
                    (typeof dbTrade.trigger_signals === 'string' ? 
                        JSON.parse(dbTrade.trigger_signals) : 
                        dbTrade.trigger_signals) : null,
                // Duration and exit reason fields
                duration_seconds: dbTrade.duration_seconds !== null && dbTrade.duration_seconds !== undefined ? parseInt(dbTrade.duration_seconds) : null,
                duration_hours: dbTrade.duration_hours !== null && dbTrade.duration_hours !== undefined ? parseFloat(dbTrade.duration_hours) : null,
                exit_reason: dbTrade.exit_reason || null
            };
        });
        
        console.log(`[PROXY] ✅ Loaded ${mappedTrades.length} trades from database`);
        return mappedTrades;
    } catch (error) {
        console.error('[PROXY] ❌ Error loading trades from database:', error.message);
        console.error('[PROXY] ❌ Error details:', error);
        return [];
    }
}

// Database helper function for BacktestCombination
async function saveBacktestCombinationToDB(combination) {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database client not available, skipping backtest combination save');
        return false;
    }
    
    try {
        // Get combination name from various possible fields
        const combinationName = combination.combinationName || combination.strategy_name || combination.strategyName || '';
        console.log('[PROXY] 🔍 Attempting to save backtest combination to database:', combinationName);
        console.log('[PROXY] 🔍 Combination data keys:', Object.keys(combination));
        
        // Helper function to determine if strategy is event-driven based on combination name
        function isEventDrivenStrategy(strategyName) {
            if (!strategyName || typeof strategyName !== 'string') {
                return false;
            }
            const eventDrivenKeywords = [
                'news', 'event', 'announcement', 'earnings', 'fomc', 'fed', 'cpi', 'ppi',
                'nfp', 'gdp', 'inflation', 'rate', 'cut', 'hike', 'policy', 'central',
                'bank', 'meeting', 'speech', 'conference', 'summit', 'election', 'vote',
                'referendum', 'brexit', 'trade', 'tariff', 'sanction', 'regulation',
                'compliance', 'audit', 'merger', 'acquisition', 'ipo', 'listing',
                'partnership', 'collaboration', 'launch', 'release', 'upgrade', 'update'
            ];
            const lowerStrategyName = strategyName.toLowerCase();
            return eventDrivenKeywords.some(keyword => lowerStrategyName.includes(keyword));
        }
        
        const isEventDriven = combination.is_event_driven_strategy !== undefined 
            ? combination.is_event_driven_strategy 
            : isEventDrivenStrategy(combinationName);
        
        // Calculate live performance and exit reason breakdown (use combinationName)
        const livePerformance = await calculateLivePerformanceForStrategy(combinationName);
        const liveExitReasonBreakdown = await calculateLiveExitReasonBreakdown(combinationName);
        
        // Calculate performance gap
        const performanceGap = livePerformance && combination.successRate !== undefined
            ? livePerformance.live_success_rate - combination.successRate
            : null;
        
        // Normalize combination_name to remove regime suffixes for consistent duplicate detection
        let normalizedCombinationName = combinationName;
        normalizedCombinationName = normalizedCombinationName.replace(/\s*\([A-Z]+\)\s*$/, '').trim();
        
        const query = `
            INSERT INTO backtest_combinations (
                strategy_name, combination_signature, coin, strategy_direction, timeframe, success_rate, occurrences,
                avg_price_move, take_profit_percentage, stop_loss_percentage, estimated_exit_time_minutes,
                enable_trailing_take_profit, trailing_stop_percentage, position_size_percentage,
                dominant_market_regime, signals, created_date, updated_date, is_event_driven_strategy,
                profit_factor, combined_strength, included_in_scanner, included_in_live_scanner,
                -- NEW: Priority 1 Analytics
                regime_performance, max_drawdown_percent, median_drawdown_percent, median_lowest_low_percent,
                avg_win_percent, avg_loss_percent, win_loss_ratio,
                gross_profit_total, gross_loss_total,
                -- NEW: Priority 2 Analytics
                avg_time_to_peak_minutes, median_exit_time_minutes, exit_time_variance_minutes,
                max_consecutive_wins, max_consecutive_losses, avg_trades_between_wins,
                -- NEW: Live Performance & Exit Reason Analytics
                live_success_rate, live_occurrences, live_avg_price_move, live_profit_factor,
                live_max_drawdown_percent, live_win_loss_ratio, live_gross_profit_total, live_gross_loss_total,
                performance_gap_percent, last_live_trade_date,
                exit_reason_breakdown, backtest_exit_reason_breakdown
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50)
            ON CONFLICT (combination_signature, coin, timeframe) 
            DO UPDATE SET
                strategy_name = EXCLUDED.strategy_name, -- Update name in case it changed (e.g., regime suffix removed)
                success_rate = EXCLUDED.success_rate,
                occurrences = EXCLUDED.occurrences,
                avg_price_move = EXCLUDED.avg_price_move,
                profit_factor = EXCLUDED.profit_factor,
                combined_strength = EXCLUDED.combined_strength,
                included_in_scanner = EXCLUDED.included_in_scanner,
                included_in_live_scanner = EXCLUDED.included_in_live_scanner,
                updated_date = EXCLUDED.updated_date,
                -- Update new analytics fields
                regime_performance = EXCLUDED.regime_performance,
                max_drawdown_percent = EXCLUDED.max_drawdown_percent,
                median_drawdown_percent = EXCLUDED.median_drawdown_percent,
                median_lowest_low_percent = EXCLUDED.median_lowest_low_percent,
                avg_win_percent = EXCLUDED.avg_win_percent,
                avg_loss_percent = EXCLUDED.avg_loss_percent,
                win_loss_ratio = EXCLUDED.win_loss_ratio,
                gross_profit_total = EXCLUDED.gross_profit_total,
                gross_loss_total = EXCLUDED.gross_loss_total,
                avg_time_to_peak_minutes = EXCLUDED.avg_time_to_peak_minutes,
                median_exit_time_minutes = EXCLUDED.median_exit_time_minutes,
                exit_time_variance_minutes = EXCLUDED.exit_time_variance_minutes,
                max_consecutive_wins = EXCLUDED.max_consecutive_wins,
                max_consecutive_losses = EXCLUDED.max_consecutive_losses,
                avg_trades_between_wins = EXCLUDED.avg_trades_between_wins,
                -- Update live performance fields (always recalculate from trades table)
                live_success_rate = EXCLUDED.live_success_rate,
                live_occurrences = EXCLUDED.live_occurrences,
                live_avg_price_move = EXCLUDED.live_avg_price_move,
                live_profit_factor = EXCLUDED.live_profit_factor,
                live_max_drawdown_percent = EXCLUDED.live_max_drawdown_percent,
                live_win_loss_ratio = EXCLUDED.live_win_loss_ratio,
                live_gross_profit_total = EXCLUDED.live_gross_profit_total,
                live_gross_loss_total = EXCLUDED.live_gross_loss_total,
                performance_gap_percent = EXCLUDED.performance_gap_percent,
                last_live_trade_date = EXCLUDED.last_live_trade_date,
                exit_reason_breakdown = EXCLUDED.exit_reason_breakdown,
                backtest_exit_reason_breakdown = EXCLUDED.backtest_exit_reason_breakdown,
                -- Also update other fields that might have changed
                take_profit_percentage = EXCLUDED.take_profit_percentage,
                stop_loss_percentage = EXCLUDED.stop_loss_percentage,
                estimated_exit_time_minutes = EXCLUDED.estimated_exit_time_minutes,
                dominant_market_regime = EXCLUDED.dominant_market_regime,
                signals = EXCLUDED.signals
        `;
        
        // Ensure occurrences is properly captured and validated
        const occurrences = combination.occurrences !== undefined && combination.occurrences !== null 
            ? parseInt(combination.occurrences) 
            : (combination.occurrenceDates && Array.isArray(combination.occurrenceDates) ? combination.occurrenceDates.length : 0);
        
        console.log('[PROXY] 💾 Saving backtest combination:', {
            combinationName: combination.combinationName,
            occurrences: occurrences,
            occurrencesSource: combination.occurrences !== undefined ? 'direct' : combination.occurrenceDates ? 'from occurrenceDates.length' : 'default (0)',
            successRate: combination.successRate,
            hasRegimePerformance: !!combination.regimePerformance,
            hasMaxDrawdown: combination.maxDrawdownPercent !== undefined,
            maxDrawdownPercent: combination.maxDrawdownPercent,
            hasAvgWinPercent: combination.avgWinPercent !== undefined,
            avgWinPercent: combination.avgWinPercent,
            hasAvgLossPercent: combination.avgLossPercent !== undefined,
            avgLossPercent: combination.avgLossPercent,
            hasWinLossRatio: combination.winLossRatio !== undefined,
            winLossRatio: combination.winLossRatio,
            hasGrossProfit: combination.grossProfit !== undefined,
            grossProfit: combination.grossProfit,
            hasGrossLoss: combination.grossLoss !== undefined,
            grossLoss: combination.grossLoss,
            hasMaxConsecutiveWins: combination.maxConsecutiveWins !== undefined,
            maxConsecutiveWins: combination.maxConsecutiveWins,
            hasMaxConsecutiveLosses: combination.maxConsecutiveLosses !== undefined,
            maxConsecutiveLosses: combination.maxConsecutiveLosses,
            hasMedianExitTime: combination.medianExitTimeMinutes !== undefined,
            medianExitTimeMinutes: combination.medianExitTimeMinutes,
            hasAvgTimeToPeak: combination.avgTimeToPeakMinutes !== undefined,
            avgTimeToPeakMinutes: combination.avgTimeToPeakMinutes,
            combinedStrength: combination.combinedStrength,
            combinedStrengthType: typeof combination.combinedStrength,
            meetsThreshold: combination.combinedStrength >= 600,
            allAnalyticsKeys: Object.keys(combination).filter(k => 
              k.includes('Drawdown') || k.includes('Win') || k.includes('Consecutive') || 
              k.includes('regime') || k.includes('Performance') || k.includes('Time') || k.includes('Trades') ||
              k.includes('gross') || k.includes('Loss')
            )
        });
        
        // Ensure combination_signature is not empty string (PostgreSQL unique constraint treats empty string as distinct from NULL)
        const combinationSignature = (combination.combination_signature || combination.combinationSignature || '').trim();
        const finalSignature = combinationSignature !== '' ? combinationSignature : null;
        
        // If signature is NULL, check for duplicate by strategy_name before inserting
        if (!finalSignature) {
            const duplicateCheck = await dbClient.query(
                'SELECT id FROM backtest_combinations WHERE strategy_name = $1 AND coin = $2 AND timeframe = $3 LIMIT 1',
                [normalizedCombinationName, combination.coin, combination.timeframe]
            );
            if (duplicateCheck.rows.length > 0) {
                console.log(`[PROXY] ⚠️ Duplicate strategy found (by name): ${normalizedCombinationName}, updating existing record`);
                // Update existing record instead of inserting
                const updateQuery = `
                    UPDATE backtest_combinations SET
                        success_rate = $1,
                        occurrences = $2,
                        avg_price_move = $3,
                        profit_factor = $4,
                        combined_strength = $5,
                        updated_date = NOW()
                    WHERE strategy_name = $6 AND coin = $7 AND timeframe = $8
                `;
                await dbClient.query(updateQuery, [
                    combination.successRate,
                    occurrences,
                    combination.avgPriceMove || 0,
                    combination.profitFactor || null,
                    combination.combinedStrength || null,
                    normalizedCombinationName,
                    combination.coin,
                    combination.timeframe
                ]);
                return true;
            }
        }
        
        const values = [
            normalizedCombinationName, // Use normalized name (without regime suffix)
            finalSignature, // Use signature for duplicate detection (NULL if empty)
            combination.coin,
            combination.strategyDirection || 'long',
            combination.timeframe,
            combination.successRate,
            occurrences,
            combination.avgPriceMove || 0,
            combination.takeProfitPercentage || 5,
            combination.stopLossPercentage || 2,
            Math.round(parseFloat(combination.estimatedExitTimeMinutes) || 240),
            combination.enableTrailingTakeProfit || false,
            combination.trailingStopPercentage || 0,
            combination.positionSizePercentage || 1,
            combination.dominantMarketRegime || null,
            combination.signals ? JSON.stringify(combination.signals) : '[]',
            combination.createdDate || new Date().toISOString(),
            new Date().toISOString(),
            isEventDriven,
            combination.profitFactor || null,
            combination.combinedStrength || null,
            combination.includedInScanner !== undefined ? combination.includedInScanner : true, // Default to true for demo scanner
            combination.includedInLiveScanner !== undefined ? combination.includedInLiveScanner : false, // Default to false for live trading
            // NEW: Priority 1 Analytics
            combination.regimePerformance ? JSON.stringify(combination.regimePerformance) : null,
            combination.maxDrawdownPercent !== undefined && combination.maxDrawdownPercent !== null ? parseFloat(combination.maxDrawdownPercent) : null,
            combination.medianDrawdownPercent !== undefined && combination.medianDrawdownPercent !== null ? parseFloat(combination.medianDrawdownPercent) : null,
            combination.medianLowestLowDuringBacktest !== undefined && combination.medianLowestLowDuringBacktest !== null ? parseFloat(combination.medianLowestLowDuringBacktest) : null,
            combination.avgWinPercent !== undefined && combination.avgWinPercent !== null ? parseFloat(combination.avgWinPercent) : null,
            combination.avgLossPercent !== undefined && combination.avgLossPercent !== null ? parseFloat(combination.avgLossPercent) : null,
            combination.winLossRatio !== undefined && combination.winLossRatio !== null ? parseFloat(combination.winLossRatio) : null,
            combination.grossProfit !== undefined && combination.grossProfit !== null ? parseFloat(combination.grossProfit) : null,
            combination.grossLoss !== undefined && combination.grossLoss !== null ? parseFloat(combination.grossLoss) : null,
            // NEW: Priority 2 Analytics
            combination.avgTimeToPeakMinutes !== undefined && combination.avgTimeToPeakMinutes !== null ? parseFloat(combination.avgTimeToPeakMinutes) : null,
            combination.medianExitTimeMinutes !== undefined && combination.medianExitTimeMinutes !== null ? parseFloat(combination.medianExitTimeMinutes) : null,
            combination.exitTimeVarianceMinutes !== undefined && combination.exitTimeVarianceMinutes !== null ? parseFloat(combination.exitTimeVarianceMinutes) : null,
            combination.maxConsecutiveWins !== undefined && combination.maxConsecutiveWins !== null ? parseInt(combination.maxConsecutiveWins, 10) : null,
            combination.maxConsecutiveLosses !== undefined && combination.maxConsecutiveLosses !== null ? parseInt(combination.maxConsecutiveLosses, 10) : null,
            combination.avgTradesBetweenWins !== undefined && combination.avgTradesBetweenWins !== null ? parseFloat(combination.avgTradesBetweenWins) : null,
            // NEW: Live Performance & Exit Reason Analytics
            livePerformance?.live_success_rate !== undefined && livePerformance.live_success_rate !== null ? parseFloat(livePerformance.live_success_rate) : null,
            livePerformance?.live_occurrences !== undefined && livePerformance.live_occurrences !== null ? parseInt(livePerformance.live_occurrences, 10) : null,
            livePerformance?.live_avg_price_move !== undefined && livePerformance.live_avg_price_move !== null ? parseFloat(livePerformance.live_avg_price_move) : null,
            livePerformance?.live_profit_factor !== undefined && livePerformance.live_profit_factor !== null ? parseFloat(livePerformance.live_profit_factor) : null,
            livePerformance?.live_max_drawdown_percent !== undefined && livePerformance.live_max_drawdown_percent !== null ? parseFloat(livePerformance.live_max_drawdown_percent) : null,
            livePerformance?.live_win_loss_ratio !== undefined && livePerformance.live_win_loss_ratio !== null ? parseFloat(livePerformance.live_win_loss_ratio) : null,
            livePerformance?.live_gross_profit_total !== undefined && livePerformance.live_gross_profit_total !== null ? parseFloat(livePerformance.live_gross_profit_total) : null,
            livePerformance?.live_gross_loss_total !== undefined && livePerformance.live_gross_loss_total !== null ? parseFloat(livePerformance.live_gross_loss_total) : null,
            performanceGap !== undefined && performanceGap !== null ? parseFloat(performanceGap) : null,
            livePerformance?.last_live_trade_date ? new Date(livePerformance.last_live_trade_date).toISOString() : null,
            liveExitReasonBreakdown ? JSON.stringify(liveExitReasonBreakdown) : null,
            combination.backtestExitReasonBreakdown ? JSON.stringify(combination.backtestExitReasonBreakdown) : null
        ];
        
        // Note: values array now has 50 elements (was 49, added combination_signature as $2)
        
        // Check if record exists before inserting/updating to determine if it's a duplicate
        // IMPORTANT: Always check by signature + coin + timeframe to avoid false duplicates across different coins
        let isDuplicate = false;
        if (finalSignature) {
            // Check by signature AND coin AND timeframe (signature alone is not unique across coins)
            const existingCheck = await dbClient.query(
                'SELECT id, strategy_name FROM backtest_combinations WHERE combination_signature = $1 AND coin = $2 AND timeframe = $3 LIMIT 1',
                [finalSignature, combination.coin, combination.timeframe]
            );
            isDuplicate = existingCheck.rows.length > 0;
            if (isDuplicate) {
                console.log(`[PROXY] 🔍 Duplicate found by signature: ${combinationName} (existing: ${existingCheck.rows[0].strategy_name})`);
            } else {
                console.log(`[PROXY] 🔍 No duplicate found for signature: ${finalSignature.substring(0, 50)}... | coin: ${combination.coin} | timeframe: ${combination.timeframe}`);
            }
        } else {
            // Check by strategy_name, coin, and timeframe
            const existingCheck = await dbClient.query(
                'SELECT id, strategy_name FROM backtest_combinations WHERE strategy_name = $1 AND coin = $2 AND timeframe = $3 LIMIT 1',
                [normalizedCombinationName, combination.coin, combination.timeframe]
            );
            isDuplicate = existingCheck.rows.length > 0;
            if (isDuplicate) {
                console.log(`[PROXY] 🔍 Duplicate found by name: ${combinationName}`);
            } else {
                console.log(`[PROXY] 🔍 No duplicate found for name: ${normalizedCombinationName} | coin: ${combination.coin} | timeframe: ${combination.timeframe}`);
            }
        }
        
        // Only use ON CONFLICT if signature is not NULL (PostgreSQL ON CONFLICT doesn't work with NULL values)
        if (finalSignature) {
        await dbClient.query(query, values);
        } else {
            // For NULL signatures, use INSERT without ON CONFLICT (duplicate check already done above)
            const insertQuery = query.replace(/ON CONFLICT.*DO UPDATE SET.*$/s, '');
            await dbClient.query(insertQuery, values);
        }
        console.log('[PROXY] ✅ Saved backtest combination to database:', {
            combinationName: combinationName,
            isDuplicate: isDuplicate,
            action: isDuplicate ? 'UPDATED' : 'INSERTED',
            analyticsFieldsSaved: {
                regimePerformance: values[23] ? 'YES' : 'NULL',
                maxDrawdownPercent: values[24] ?? 'NULL',
                medianDrawdownPercent: values[25] ?? 'NULL',
                avgWinPercent: values[27] ?? 'NULL',
                avgLossPercent: values[28] ?? 'NULL',
                winLossRatio: values[29] ?? 'NULL',
                grossProfitTotal: values[30] ?? 'NULL',
                grossLossTotal: values[31] ?? 'NULL',
                avgTimeToPeakMinutes: values[32] ?? 'NULL',
                medianExitTimeMinutes: values[33] ?? 'NULL',
                maxConsecutiveWins: values[35] ?? 'NULL',
                maxConsecutiveLosses: values[36] ?? 'NULL'
            }
        });
        return { success: true, isDuplicate };
    } catch (error) {
        // Get combination name again in case of error (for logging)
        const comboName = combination.combinationName || combination.strategy_name || combination.strategyName || 'Unknown';
        console.error('[PROXY] ❌ Error saving backtest combination to database:', error.message);
        console.error('[PROXY] ❌ Error code:', error.code);
        console.error('[PROXY] ❌ Error detail:', error.detail);
        console.error('[PROXY] ❌ Error hint:', error.hint);
        console.error('[PROXY] ❌ Full error stack:', error.stack);
        console.error('[PROXY] ❌ Combination name:', comboName);
        console.error('[PROXY] ❌ Combination signature:', combination.combination_signature || combination.combinationSignature);
        console.error('[PROXY] ❌ Combination coin:', combination.coin);
        console.error('[PROXY] ❌ Combination timeframe:', combination.timeframe);
        return { success: false, isDuplicate: false };
    }
}

// Bulk save backtest combinations to database
async function bulkSaveBacktestCombinationsToDB(combinations) {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database client not available, skipping bulk backtest combination save');
        return { success: false, saved: 0, updated: 0, failed: 0 };
    }
    
    let saved = 0;
    let updated = 0;
    let failed = 0;
    
    try {
        console.log(`[PROXY] 🔄 Bulk saving ${combinations.length} backtest combinations to database...`);
        
        for (let i = 0; i < combinations.length; i++) {
            const combination = combinations[i];
            const comboName = combination.combinationName || combination.strategy_name || 'Unknown';
            console.log(`[PROXY] 🔄 [${i + 1}/${combinations.length}] Saving: ${comboName}`);
            
            try {
                const result = await saveBacktestCombinationToDB(combination);
                if (result && result.success) {
                    if (result.isDuplicate) {
                        updated++;
                        // Only log errors - updates are too verbose
                    } else {
                saved++;
                        // Only log errors - successful saves are too verbose
                    }
            } else {
                failed++;
                    console.error(`[PROXY] ❌ [${i + 1}/${combinations.length}] Failed to save: ${comboName} (saveBacktestCombinationToDB returned false)`);
                }
            } catch (error) {
                failed++;
                console.error(`[PROXY] ❌ [${i + 1}/${combinations.length}] Exception saving ${comboName}:`, error.message);
                console.error(`[PROXY] ❌ Exception stack:`, error.stack);
            }
        }
        
        console.log(`[PROXY] ✅ Bulk save complete: ${saved} saved, ${updated} updated, ${failed} failed`);
        return { success: true, saved, updated, failed };
    } catch (error) {
        console.error('[PROXY] ❌ Error in bulk save backtest combinations:', error.message);
        console.error('[PROXY] ❌ Error stack:', error.stack);
        console.error('[PROXY] ❌ Error details:', error);
        return { success: false, saved, updated, failed };
    }
}

// Calculate exit reason breakdown from backtest matches
function calculateBacktestExitReasonBreakdown(matches, takeProfitPercentage, stopLossPercentage) {
    const breakdown = {};
    const totalMatches = matches.length;
    
    if (totalMatches === 0) return null;
    
    matches.forEach(match => {
        // Infer exit reason from match data
        let exitReason = 'unknown';
        
        if (match.successful) {
            // Successful trade - likely take profit
            if (match.priceMove >= (takeProfitPercentage * 0.9)) { // Within 90% of TP
                exitReason = 'take_profit';
            } else {
                exitReason = 'timeout'; // Hit TP but not at full percentage (timeout)
            }
        } else {
            // Failed trade - likely stop loss
            if (Math.abs(match.priceMove) >= (stopLossPercentage * 0.9)) { // Within 90% of SL
                exitReason = 'stop_loss';
            } else {
                exitReason = 'timeout'; // Hit SL but not at full percentage (timeout)
            }
        }
        
        if (!breakdown[exitReason]) {
            breakdown[exitReason] = {
                count: 0,
                percentage: 0,
                avg_pnl: 0,
                total_pnl: 0
            };
        }
        
        breakdown[exitReason].count++;
        breakdown[exitReason].total_pnl += match.priceMove || 0;
    });
    
    // Calculate percentages and averages
    Object.keys(breakdown).forEach(reason => {
        breakdown[reason].percentage = (breakdown[reason].count / totalMatches) * 100;
        breakdown[reason].avg_pnl = breakdown[reason].total_pnl / breakdown[reason].count;
    });
    
    return breakdown;
}

// Aggregate live performance from trades table for a strategy
async function calculateLivePerformanceForStrategy(strategyName) {
    if (!dbClient || !strategyName) {
        return null;
    }
    
    try {
        const query = `
            SELECT 
                COUNT(*) as total_trades,
                COUNT(*) FILTER (WHERE pnl_percent > 0) as winning_trades,
                COUNT(*) FILTER (WHERE pnl_percent <= 0) as losing_trades,
                AVG(pnl_percent) FILTER (WHERE pnl_percent > 0) as avg_win_percent,
                AVG(pnl_percent) FILTER (WHERE pnl_percent <= 0) as avg_loss_percent,
                SUM(pnl_percent) FILTER (WHERE pnl_percent > 0) as gross_profit,
                SUM(ABS(pnl_percent)) FILTER (WHERE pnl_percent <= 0) as gross_loss,
                MAX(ABS(pnl_percent)) FILTER (WHERE pnl_percent < 0) as max_drawdown_percent,
                MAX(exit_timestamp) as last_trade_date
            FROM trades
            WHERE strategy_name = $1 
                AND trading_mode != 'backtest'
                AND exit_timestamp IS NOT NULL
        `;
        
        const result = await dbClient.query(query, [strategyName]);
        
        if (result.rows.length === 0 || result.rows[0].total_trades === '0') {
            return null;
        }
        
        const row = result.rows[0];
        const totalTrades = parseInt(row.total_trades) || 0;
        const winningTrades = parseInt(row.winning_trades) || 0;
        const losingTrades = parseInt(row.losing_trades) || 0;
        const avgWinPercent = parseFloat(row.avg_win_percent) || 0;
        const avgLossPercent = Math.abs(parseFloat(row.avg_loss_percent) || 0);
        const grossProfit = parseFloat(row.gross_profit) || 0;
        const grossLoss = parseFloat(row.gross_loss) || 0;
        const maxDrawdownPercent = parseFloat(row.max_drawdown_percent) || 0;
        const lastTradeDate = row.last_trade_date;
        
        const successRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const avgPriceMove = totalTrades > 0 ? (grossProfit - grossLoss) / totalTrades : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);
        const winLossRatio = avgLossPercent > 0 ? avgWinPercent / avgLossPercent : (avgWinPercent > 0 ? 999 : 0);
        
        return {
            live_success_rate: successRate,
            live_occurrences: totalTrades,
            live_avg_price_move: avgPriceMove,
            live_profit_factor: profitFactor,
            live_max_drawdown_percent: maxDrawdownPercent,
            live_win_loss_ratio: winLossRatio,
            live_gross_profit_total: grossProfit,
            live_gross_loss_total: grossLoss,
            last_live_trade_date: lastTradeDate
        };
    } catch (error) {
        console.error(`[PROXY] ❌ Error calculating live performance for ${strategyName}:`, error.message);
        return null;
    }
}

// Update live performance for a single strategy in the database
async function updateStrategyLivePerformance(strategyName) {
    if (!dbClient || !strategyName) {
        return false;
    }
    
    try {
        const livePerformance = await calculateLivePerformanceForStrategy(strategyName);
        const liveExitReasonBreakdown = await calculateLiveExitReasonBreakdown(strategyName);
        
        if (!livePerformance) {
            // No live trades yet - that's OK, just return
            return true;
        }
        
        // Get backtest success rate for performance gap calculation
        const getBacktestQuery = `SELECT success_rate FROM backtest_combinations WHERE strategy_name = $1`;
        const backtestResult = await dbClient.query(getBacktestQuery, [strategyName]);
        const backtestSuccessRate = backtestResult.rows.length > 0 ? backtestResult.rows[0].success_rate : null;
        
        const performanceGap = backtestSuccessRate !== null && livePerformance.live_success_rate !== null
            ? livePerformance.live_success_rate - backtestSuccessRate
            : null;
        
        const updateQuery = `
            UPDATE backtest_combinations
            SET 
                live_success_rate = $1,
                live_occurrences = $2,
                live_avg_price_move = $3,
                live_profit_factor = $4,
                live_max_drawdown_percent = $5,
                live_win_loss_ratio = $6,
                live_gross_profit_total = $7,
                live_gross_loss_total = $8,
                performance_gap_percent = $9,
                last_live_trade_date = $10,
                exit_reason_breakdown = $11,
                updated_date = NOW()
            WHERE strategy_name = $12
        `;
        
        await dbClient.query(updateQuery, [
            livePerformance.live_success_rate,
            livePerformance.live_occurrences,
            livePerformance.live_avg_price_move,
            livePerformance.live_profit_factor,
            livePerformance.live_max_drawdown_percent,
            livePerformance.live_win_loss_ratio,
            livePerformance.live_gross_profit_total,
            livePerformance.live_gross_loss_total,
            performanceGap,
            livePerformance.last_live_trade_date,
            liveExitReasonBreakdown ? JSON.stringify(liveExitReasonBreakdown) : null,
            strategyName
        ]);
        
        return true;
    } catch (error) {
        console.error(`[PROXY] ❌ Error updating live performance for ${strategyName}:`, error.message);
        return false;
    }
}

// Refresh live performance for all strategies (async, non-blocking)
async function refreshAllStrategiesLivePerformance() {
    if (!dbClient) {
        return;
    }
    
    try {
        console.log('[PROXY] 🔄 Refreshing live performance for all strategies...');
        const query = `SELECT strategy_name FROM backtest_combinations`;
        const result = await dbClient.query(query);
        
        let updated = 0;
        let failed = 0;
        
        // Process in batches to avoid overwhelming the database
        const batchSize = 10;
        for (let i = 0; i < result.rows.length; i += batchSize) {
            const batch = result.rows.slice(i, i + batchSize);
            await Promise.all(batch.map(async (row) => {
                const success = await updateStrategyLivePerformance(row.strategy_name);
                if (success) {
                    updated++;
                } else {
                    failed++;
                }
            }));
            
            // Small delay between batches
            if (i + batchSize < result.rows.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        console.log(`[PROXY] ✅ Refreshed live performance: ${updated} updated, ${failed} failed`);
    } catch (error) {
        console.error('[PROXY] ❌ Error refreshing all strategies live performance:', error.message);
    }
}

// Calculate exit reason breakdown from live trades
async function calculateLiveExitReasonBreakdown(strategyName) {
    if (!dbClient || !strategyName) {
        return null;
    }
    
    try {
        const query = `
            SELECT 
                exit_reason,
                COUNT(*) as count,
                AVG(pnl_percent) as avg_pnl,
                SUM(pnl_percent) as total_pnl
            FROM trades
            WHERE strategy_name = $1 
                AND trading_mode != 'backtest'
                AND exit_reason IS NOT NULL
                AND exit_timestamp IS NOT NULL
            GROUP BY exit_reason
        `;
        
        const result = await dbClient.query(query, [strategyName]);
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const totalTrades = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
        const breakdown = {};
        
        result.rows.forEach(row => {
            const reason = row.exit_reason || 'unknown';
            const count = parseInt(row.count) || 0;
            const avgPnl = parseFloat(row.avg_pnl) || 0;
            
            breakdown[reason] = {
                count: count,
                percentage: totalTrades > 0 ? (count / totalTrades) * 100 : 0,
                avg_pnl: avgPnl
            };
        });
        
        return breakdown;
    } catch (error) {
        console.error(`[PROXY] ❌ Error calculating exit reason breakdown for ${strategyName}:`, error.message);
        return null;
    }
}

// Sync existing backtest combinations from file storage to database
// NOTE: Only syncs if database is empty (one-time migration). Database is the source of truth.
async function syncBacktestCombinationsToDatabase() {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database client not available, skipping backtest combination sync');
        return;
    }
    
    try {
        // Check if database already has combinations
        const existingCombinations = await loadBacktestCombinationsFromDB();
        if (existingCombinations.length > 0) {
            console.log(`[PROXY] ⏭️  Skipping backtest combination sync - database already has ${existingCombinations.length} combinations (database is source of truth)`);
            return;
        }
        
        // Only sync if database is empty (one-time migration from file storage)
        console.log('[PROXY] 🔄 Database is empty, syncing backtest combinations from file storage (one-time migration)...');
        const combinations = getStoredData('backtestCombinations');
        console.log(`[PROXY] 🔄 Found ${combinations.length} backtest combinations in file storage to sync`);
        
        if (combinations.length > 0) {
        const result = await bulkSaveBacktestCombinationsToDB(combinations);
        // Only log if there are failures or if it's a large sync
        if (result.failed > 0 || result.saved > 100) {
            console.log(`[PROXY] ✅ Synced backtest combinations: ${result.saved} saved, ${result.failed} failed`);
        }
        } else {
            // Only log if explicitly needed - too verbose otherwise
        }
    } catch (error) {
        console.error('[PROXY] ❌ Error syncing backtest combinations to database:', error.message);
    }
}

// Database helper functions for LivePosition
async function saveLivePositionToDB(position) {
    if (!dbClient) {
        console.error('[Debug_Live] [PROXY] ❌ saveLivePositionToDB: dbClient not available');
        return false;
    }
    
    try {
        console.log('[Debug_Live] [PROXY] 💾 saveLivePositionToDB called for:', {
            symbol: position.symbol,
            position_id: position.position_id,
            id: position.id,
            has_entry_fill_time_ms: position.entry_fill_time_ms !== undefined,
            entry_fill_time_ms: position.entry_fill_time_ms,
            has_all_entry_quality: !!(
                position.entry_near_support !== undefined &&
                position.entry_near_resistance !== undefined &&
                position.entry_momentum_score !== undefined
            )
        });
        const query = `
            INSERT INTO live_positions (
                id, symbol, side, quantity, entry_price, current_price, 
                unrealized_pnl, trading_mode, entry_timestamp, created_date, updated_date,
                strategy_name, direction, quantity_crypto, entry_value_usdt, status,
                stop_loss_price, take_profit_price, is_trailing, trailing_stop_price, trailing_peak_price,
                peak_price, trough_price, time_exit_hours, wallet_id, last_updated_timestamp,
                last_price_update, binance_order_id, binance_executed_price, binance_executed_quantity,
                trigger_signals, combined_strength, conviction_score, conviction_breakdown,
                conviction_multiplier, market_regime, regime_confidence, atr_value,
                is_event_driven_strategy, fear_greed_score, fear_greed_classification, lpm_score,
                position_id, conviction_details, volatility_at_open, volatility_label_at_open,
                regime_impact_on_strength, correlation_impact_on_strength, effective_balance_risk_at_open, btc_price_at_open, exit_time,
                entry_near_support, entry_near_resistance, entry_distance_to_support_percent,
                entry_distance_to_resistance_percent, entry_momentum_score, entry_relative_to_day_high_percent,
                entry_relative_to_day_low_percent, entry_volume_vs_average, entry_fill_time_ms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60)
            ON CONFLICT (id) DO UPDATE SET
                current_price = EXCLUDED.current_price,
                unrealized_pnl = EXCLUDED.unrealized_pnl,
                updated_date = EXCLUDED.updated_date,
                last_updated_timestamp = EXCLUDED.last_updated_timestamp,
                last_price_update = EXCLUDED.last_price_update
        `;
        
        const values = [
            position.id,
            position.symbol,
            position.side || (position.direction === 'long' ? 'BUY' : position.direction === 'short' ? 'SELL' : position.direction),
            position.quantity || position.quantity_crypto,
            position.entry_price,
            position.current_price || position.entry_price,
            position.unrealized_pnl || 0,
            position.trading_mode,
            position.entry_timestamp,
            position.created_date || new Date().toISOString(),
            new Date().toISOString(),
            // Analytics fields
            position.strategy_name,
            position.direction,
            parseFloat(position.quantity_crypto) || null,
            position.entry_value_usdt,
            position.status,
            position.stop_loss_price,
            position.take_profit_price,
            position.is_trailing,
            position.trailing_stop_price,
            position.trailing_peak_price,
            position.peak_price,
            position.trough_price,
            position.time_exit_hours,
            position.wallet_id,
            position.last_updated_timestamp,
            position.last_price_update,
            position.binance_order_id,
            position.binance_executed_price,
            parseFloat(position.binance_executed_quantity) || null,
            position.trigger_signals ? JSON.stringify(position.trigger_signals) : null,
            position.combined_strength,
            Math.round(position.conviction_score || 0),
            position.conviction_breakdown ? JSON.stringify(position.conviction_breakdown) : null,
            position.conviction_multiplier,
            position.market_regime,
            position.regime_confidence,
            position.atr_value,
            position.is_event_driven_strategy,
            parseInt(position.fear_greed_score) || null,
            position.fear_greed_classification,
            position.lpm_score,
            position.position_id,
            position.conviction_details ? JSON.stringify(position.conviction_details) : null,
            // NEW: Additional analytics fields
            position.volatility_at_open ? parseFloat(position.volatility_at_open) : null,
            position.volatility_label_at_open || null,
            position.regime_impact_on_strength ? parseFloat(position.regime_impact_on_strength) : null,
            position.correlation_impact_on_strength ? parseFloat(position.correlation_impact_on_strength) : null,
            position.effective_balance_risk_at_open ? parseFloat(position.effective_balance_risk_at_open) : null,
            position.btc_price_at_open ? parseFloat(position.btc_price_at_open) : null,
            position.exit_time || null,
            // NEW: Entry quality metrics (Priority 1)
            (() => {
                const entryNearSupport = position.entry_near_support !== undefined ? (position.entry_near_support === true || position.entry_near_support === 'true') : null;
                const entryNearResistance = position.entry_near_resistance !== undefined ? (position.entry_near_resistance === true || position.entry_near_resistance === 'true') : null;
                const entryDistanceToSupportPercent = position.entry_distance_to_support_percent !== undefined && position.entry_distance_to_support_percent !== null ? parseFloat(position.entry_distance_to_support_percent) : null;
                const entryDistanceToResistancePercent = position.entry_distance_to_resistance_percent !== undefined && position.entry_distance_to_resistance_percent !== null ? parseFloat(position.entry_distance_to_resistance_percent) : null;
                const entryMomentumScore = position.entry_momentum_score !== undefined && position.entry_momentum_score !== null ? parseFloat(position.entry_momentum_score) : null;
                
                console.log('[Debug_Live] [PROXY] 🔍 Entry Quality values received:', {
                    entry_near_support_raw: position.entry_near_support,
                    entry_near_support_processed: entryNearSupport,
                    entry_near_resistance_raw: position.entry_near_resistance,
                    entry_near_resistance_processed: entryNearResistance,
                    entry_distance_to_support_percent_raw: position.entry_distance_to_support_percent,
                    entry_distance_to_support_percent_processed: entryDistanceToSupportPercent,
                    entry_distance_to_resistance_percent_raw: position.entry_distance_to_resistance_percent,
                    entry_distance_to_resistance_percent_processed: entryDistanceToResistancePercent,
                    entry_momentum_score_raw: position.entry_momentum_score,
                    entry_momentum_score_processed: entryMomentumScore
                });
                
                return entryNearSupport; // Return first value
            })(),
            (() => {
                const entryNearResistance = position.entry_near_resistance !== undefined ? (position.entry_near_resistance === true || position.entry_near_resistance === 'true') : null;
                return entryNearResistance;
            })(),
            position.entry_distance_to_support_percent !== undefined && position.entry_distance_to_support_percent !== null ? parseFloat(position.entry_distance_to_support_percent) : null,
            position.entry_distance_to_resistance_percent !== undefined && position.entry_distance_to_resistance_percent !== null ? parseFloat(position.entry_distance_to_resistance_percent) : null,
            position.entry_momentum_score !== undefined && position.entry_momentum_score !== null ? parseFloat(position.entry_momentum_score) : null,
            position.entry_relative_to_day_high_percent !== undefined && position.entry_relative_to_day_high_percent !== null ? parseFloat(position.entry_relative_to_day_high_percent) : null,
            position.entry_relative_to_day_low_percent !== undefined && position.entry_relative_to_day_low_percent !== null ? parseFloat(position.entry_relative_to_day_low_percent) : null,
            position.entry_volume_vs_average !== undefined && position.entry_volume_vs_average !== null ? parseFloat(position.entry_volume_vs_average) : null,
            position.entry_fill_time_ms !== undefined && position.entry_fill_time_ms !== null ? parseInt(position.entry_fill_time_ms) : null
        ];
        
        const saveStartTime = Date.now();
        
        // CRITICAL: Use explicit transaction to ensure commit is visible
        // Check transaction state before INSERT
        try {
            const preTxCheck = await dbClient.query('SELECT txid_current() as txid, in_transaction() as in_tx, current_database() as db_name, current_schema() as schema_name');
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Pre-INSERT: txid=${preTxCheck.rows[0]?.txid || 'unknown'}, in_transaction=${preTxCheck.rows[0]?.in_tx || 'unknown'}, database=${preTxCheck.rows[0]?.db_name || 'unknown'}, schema=${preTxCheck.rows[0]?.schema_name || 'unknown'}`);
        } catch (preErr) {
            // Try simpler check
            try {
                const simpleTx = await dbClient.query('SELECT txid_current() as txid, current_database() as db_name');
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Pre-INSERT txid: ${simpleTx.rows[0]?.txid || 'unknown'}, database=${simpleTx.rows[0]?.db_name || 'unknown'}`);
            } catch (e) {
                // Ignore
            }
        }
        
        const insertResult = await dbClient.query(query, values);
        const saveEndTime = Date.now();
        console.log(`[Debug_Live] [PROXY] ✅ Saved position to DB: ${position.symbol} (${position.id?.substring(0, 8)}...) status=${position.status} mode=${position.trading_mode} in ${saveEndTime - saveStartTime}ms`);
        console.log(`[Debug_Live] [PROXY] 📊 Insert result: rowCount=${insertResult.rowCount || 0}, command=${insertResult.command || 'unknown'}`);
        console.log(`[Debug_Live] [PROXY] 🔍 Entry quality fields saved:`, {
            entry_near_support: position.entry_near_support,
            entry_near_resistance: position.entry_near_resistance,
            entry_distance_to_support_percent: position.entry_distance_to_support_percent,
            entry_distance_to_resistance_percent: position.entry_distance_to_resistance_percent,
            entry_momentum_score: position.entry_momentum_score,
            entry_relative_to_day_high_percent: position.entry_relative_to_day_high_percent,
            entry_relative_to_day_low_percent: position.entry_relative_to_day_low_percent,
            entry_volume_vs_average: position.entry_volume_vs_average,
            entry_fill_time_ms: position.entry_fill_time_ms
        });
        
        // CRITICAL: Explicitly commit the transaction (though Client should auto-commit)
        // Force a commit to ensure visibility
        try {
            await dbClient.query('COMMIT');
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Explicit COMMIT executed`);
        } catch (commitErr) {
            // If we're not in a transaction, this will error, but that's fine
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ℹ️ COMMIT: ${commitErr.message.includes('no transaction') ? 'No transaction (autocommit mode)' : commitErr.message}`);
        }
        
        // Check transaction state after INSERT
        try {
            const postTxCheck = await dbClient.query('SELECT txid_current() as txid');
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Post-INSERT txid: ${postTxCheck.rows[0]?.txid || 'unknown'}`);
        } catch (txError) {
            // Ignore - might not have permission
        }
        
        // CRITICAL FIX: Increased delay to ensure transaction is fully committed and visible to other queries
        // PostgreSQL needs time to make the transaction visible to other connections
        // Also, immediately verify the position can be queried by doing a SELECT to force a read
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Force a read to ensure the write is visible
        const forceReadQuery = 'SELECT 1 FROM live_positions WHERE id = $1';
        const forceReadResult = await dbClient.query(forceReadQuery, [position.id]);
        if (forceReadResult.rows.length > 0) {
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Position immediately queryable after INSERT`);
        } else {
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position NOT queryable immediately after INSERT!`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Verify the position was actually saved by querying it back
        const verifyStartTime = Date.now();
        const verifyQuery = 'SELECT * FROM live_positions WHERE id = $1';
        const verifyResult = await dbClient.query(verifyQuery, [position.id]);
        const verifyEndTime = Date.now();
        if (verifyResult.rows.length === 0) {
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position saved but NOT found in DB! ID: ${position.id?.substring(0, 8)}`);
            console.error(`[POSITION_DEBUG] [POSITION_DB] ⚠️ This means the INSERT failed or was rolled back!`);
        } else {
            const saved = verifyResult.rows[0];
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Verified in DB (${verifyEndTime - verifyStartTime}ms): ${saved.symbol} status=${saved.status} mode=${saved.trading_mode} id=${saved.id?.substring(0, 8)}`);
            
            // DEBUG: Verify exit_time was saved to database
            if (position.exit_time) {
                if (saved.exit_time) {
                    console.log(`[Debug_Live] [PROXY] ✅ exit_time saved to DB: ${new Date(saved.exit_time).toISOString()} (from position.exit_time: ${position.exit_time})`);
                    // Verify the calculation matches
                    if (saved.entry_timestamp && saved.time_exit_hours) {
                        const entryTimestamp = new Date(saved.entry_timestamp);
                        const exitTimeHours = parseFloat(saved.time_exit_hours) || 24;
                        const expectedExitTime = new Date(entryTimestamp.getTime() + (exitTimeHours * 60 * 60 * 1000));
                        const actualExitTime = new Date(saved.exit_time);
                        const diffMinutes = Math.abs((actualExitTime.getTime() - expectedExitTime.getTime()) / (1000 * 60));
                        if (diffMinutes < 1) {
                            console.log(`[Debug_Live] [PROXY] ✅ exit_time calculation verified: entry (${entryTimestamp.toISOString()}) + ${exitTimeHours}h = ${actualExitTime.toISOString()}`);
                        } else {
                            console.error(`[Debug_Live] [PROXY] ⚠️ exit_time mismatch! Expected: ${expectedExitTime.toISOString()}, Actual: ${actualExitTime.toISOString()}, Diff: ${diffMinutes.toFixed(2)} minutes`);
                        }
                    }
                } else {
                    console.error(`[Debug_Live] [PROXY] ❌ exit_time NOT saved to DB! Position had: ${position.exit_time}, DB has: ${saved.exit_time}`);
                    console.error(`[Debug_Live] [PROXY] ❌ Position data: entry_timestamp=${position.entry_timestamp}, time_exit_hours=${position.time_exit_hours}`);
                }
            } else {
                console.log(`[Debug_Live] [PROXY] ⚠️ Position did not have exit_time when saving. entry_timestamp=${position.entry_timestamp}, time_exit_hours=${position.time_exit_hours}`);
            }
            
            // Also verify it can be found by COUNT query
            const countQuery = 'SELECT COUNT(*) as count FROM live_positions WHERE id = $1';
            const countResult = await dbClient.query(countQuery, [position.id]);
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 COUNT query for this position: ${countResult.rows[0]?.count || 0}`);
            
            // CRITICAL: Verify it can be found by the main query pattern (SELECT * without WHERE)
            const mainQuery = 'SELECT * FROM live_positions ORDER BY created_date DESC';
            const mainQueryResult = await dbClient.query(mainQuery);
            const foundInMainQuery = mainQueryResult.rows.find(r => r.id === position.id);
            if (foundInMainQuery) {
                //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Position found in main query pattern (SELECT * FROM live_positions)`);
            } else {
                console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position NOT found in main query pattern! This is the issue!`);
                console.error(`[POSITION_DEBUG] [POSITION_DB] 🔍 Main query returned ${mainQueryResult.rows.length} rows, but position ${position.id?.substring(0, 8)} not in results`);
                if (mainQueryResult.rows.length > 0) {
                    console.error(`[POSITION_DEBUG] [POSITION_DB] 🔍 Sample row from main query: id=${mainQueryResult.rows[0].id?.substring(0, 8)}, symbol=${mainQueryResult.rows[0].symbol}`);
                }
            }
            
            // CRITICAL: Wait and verify again to check if position persists
            await new Promise(resolve => setTimeout(resolve, 200));
            const persistenceCheck = await dbClient.query('SELECT COUNT(*) as count FROM live_positions WHERE id = $1', [position.id]);
            if (parseInt(persistenceCheck.rows[0]?.count || 0) > 0) {
                //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Position persists after 200ms delay: COUNT=${persistenceCheck.rows[0]?.count}`);
                
                // CRITICAL: Test if position is visible in the main query pattern used by loadLivePositionsFromDB
                const mainPatternTest = await dbClient.query('SELECT * FROM live_positions ORDER BY created_date DESC');
                const foundInMainPattern = mainPatternTest.rows.find(r => r.id === position.id);
                if (foundInMainPattern) {
                    //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Position visible in main query pattern after 200ms: Found ${mainPatternTest.rows.length} total positions`);
                } else {
                    console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position NOT visible in main query pattern after 200ms! Main query returned ${mainPatternTest.rows.length} positions`);
                    console.error(`[POSITION_DEBUG] [POSITION_DB] ⚠️ This is the exact query pattern used by loadLivePositionsFromDB()!`);
                }
            } else {
                console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position DISAPPEARED after 200ms! COUNT=${persistenceCheck.rows[0]?.count}`);
                console.error(`[POSITION_DEBUG] [POSITION_DB] ⚠️ This suggests the position was deleted or rolled back!`);
            }
        }
        
        return true;
    } catch (error) {
        console.error('[Debug_Live] [PROXY] ❌ ERROR saving position to database:', error);
        console.error('[Debug_Live] [PROXY] ❌ Error details:', {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            position: error.position,
            symbol: position?.symbol,
            position_id: position?.position_id,
            id: position?.id
        });
        if (error.code === '23505') {
            console.error('[Debug_Live] [PROXY] ❌ Duplicate key error - position with this ID already exists');
        } else if (error.code === '23502') {
            console.error('[Debug_Live] [PROXY] ❌ Not null constraint violation - required field is missing');
        } else if (error.code === '42P01') {
            console.error('[Debug_Live] [PROXY] ❌ Table does not exist - database schema issue');
        } else if (error.code === '42703') {
            console.error('[Debug_Live] [PROXY] ❌ Column does not exist - database schema mismatch');
            console.error('[Debug_Live] [PROXY] ❌ This usually means entry_fill_time_ms or another column is missing from the database');
        }
        return false;
    }
}

async function loadLivePositionsFromDB() {
    const functionStartTime = Date.now();
    const functionStartISO = new Date(functionStartTime).toISOString();
    
    if (!dbClient) {
        console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ No DB client available`);
        return [];
    }
    
    try {
        // CRITICAL DEBUG: Check if DB client is still connected and what connection it's using
        const connectionCheckStart = Date.now();
        try {
            const connCheck = await dbClient.query('SELECT pg_backend_pid() as pid, current_database() as db, current_user as user, inet_server_addr() as server_addr, inet_server_port() as server_port');
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Connection check: pid=${connCheck.rows[0]?.pid}, db=${connCheck.rows[0]?.db}, user=${connCheck.rows[0]?.user}, server=${connCheck.rows[0]?.server_addr}:${connCheck.rows[0]?.server_port} (${Date.now() - connectionCheckStart}ms)`);
        } catch (connErr) {
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Connection check failed:`, connErr.message);
        }
        
        // CRITICAL DEBUG: Check if there are any active transactions or locks
        try {
            const lockCheck = await dbClient.query(`
                SELECT 
                    count(*) as active_locks,
                    count(*) FILTER (WHERE locktype = 'relation') as relation_locks,
                    count(*) FILTER (WHERE locktype = 'transactionid') as tx_locks
                FROM pg_locks 
                WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
            `);
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Active locks: total=${lockCheck.rows[0]?.active_locks}, relation=${lockCheck.rows[0]?.relation_locks}, tx=${lockCheck.rows[0]?.tx_locks}`);
        } catch (lockErr) {
            // Ignore lock check errors (might not have permission)
        }
        
        const query = 'SELECT * FROM live_positions ORDER BY created_date DESC';
        const queryStartTime = Date.now();
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 ========================================`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 loadLivePositionsFromDB() called at ${functionStartISO}`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 📝 SQL Query: ${query}`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] ⏰ Query start time: ${new Date(queryStartTime).toISOString()}`);
        
        // CRITICAL: Check transaction isolation level and connection state before query
        const preCheckStartTime = Date.now();
        try {
            const isolationCheck = await dbClient.query("SHOW default_transaction_isolation");
            const isolationTime = Date.now() - preCheckStartTime;
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Transaction isolation level: ${isolationCheck.rows[0]?.default_transaction_isolation || 'unknown'} (${isolationTime}ms)`);
            
            // Check database name and connection state
            // Note: in_transaction() is not available in all PostgreSQL versions, use txid_current() instead
            const dbInfoStartTime = Date.now();
            const dbInfo = await dbClient.query("SELECT current_database() as db_name, current_schema() as schema_name, txid_current() as txid");
            const dbInfoTime = Date.now() - dbInfoStartTime;
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 DB Connection: database=${dbInfo.rows[0]?.db_name}, schema=${dbInfo.rows[0]?.schema_name}, txid=${dbInfo.rows[0]?.txid} (${dbInfoTime}ms)`);
            
            // Check if table exists and get row count
            const tableCheckStartTime = Date.now();
            const tableCheckQuery = `
                SELECT 
                    COUNT(*) as total_count,
                    COUNT(*) FILTER (WHERE status = 'open') as open_count,
                    COUNT(*) FILTER (WHERE trading_mode = 'testnet') as testnet_count,
                    MAX(created_date) as latest_created
                FROM live_positions
            `;
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 📝 Table check query: ${tableCheckQuery.trim()}`);
            const tableCheck = await dbClient.query(tableCheckQuery);
            const tableCheckTime = Date.now() - tableCheckStartTime;
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Table state: total=${tableCheck.rows[0]?.total_count}, open=${tableCheck.rows[0]?.open_count}, testnet=${tableCheck.rows[0]?.testnet_count}, latest=${tableCheck.rows[0]?.latest_created} (${tableCheckTime}ms)`);
            
            // CRITICAL: If table shows 0 but we expect positions, check for any recent activity
            if (parseInt(tableCheck.rows[0]?.total_count || 0) === 0) {
                //console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ Table COUNT shows 0! Checking for very recent positions...`);
                // Check if there are any positions in the last 10 seconds (very recent saves)
                const veryRecentQuery = "SELECT id, position_id, symbol, status, trading_mode, created_date FROM live_positions WHERE created_date > NOW() - INTERVAL '10 seconds' ORDER BY created_date DESC";
                const veryRecentStartTime = Date.now();
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 📝 Very recent query: ${veryRecentQuery}`);
                const veryRecentResult = await dbClient.query(veryRecentQuery);
                const veryRecentTime = Date.now() - veryRecentStartTime;
                if (veryRecentResult.rows.length > 0) {
                    //console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ Found ${veryRecentResult.rows.length} VERY recent positions (last 10s) but COUNT shows 0! (${veryRecentTime}ms)`);
                    veryRecentResult.rows.forEach((pos, idx) => {
                        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Very recent ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status}, created=${pos.created_date}`);
                    });
                } else {
                    //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ No very recent positions found (last 10s) - table is truly empty (${veryRecentTime}ms)`);
                }
            }
        } catch (isoErr) {
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Error checking connection state:`, isoErr.message);
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Error stack:`, isoErr.stack);
        }
        
        const mainQueryStartTime = Date.now();
        //console.log(`[POSITION_DEBUG] [POSITION_DB] ⏰ Executing main query at ${new Date(mainQueryStartTime).toISOString()}`);
        const result = await dbClient.query(query);
        const queryEndTime = Date.now();
        const queryDuration = queryEndTime - queryStartTime;
        const mainQueryDuration = queryEndTime - mainQueryStartTime;
        
        //console.log(`[POSITION_DEBUG] [POSITION_DB] ⏱️ Main query executed in ${mainQueryDuration}ms`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] ⏱️ Total function time: ${queryDuration}ms`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 📊 Query returned ${result.rows.length} rows`);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 📋 Query result object: rows=${result.rows?.length || 0}, rowCount=${result.rowCount || 0}`);
        
        if (result.rows.length > 0) {
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Loaded ${result.rows.length} positions from DB`);
            result.rows.slice(0, 3).forEach((r, idx) => {
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Position ${idx + 1}: id=${r.id?.substring(0, 8)}, symbol=${r.symbol}, status=${r.status || 'NULL'}, mode=${r.trading_mode || 'NULL'}, position_id=${r.position_id || 'NULL'}, wallet_id=${r.wallet_id || 'NULL'}, created_date=${r.created_date || 'NULL'}`);
            });
        } else {
            // CRITICAL DEBUG: If query returns 0, check if positions were recently deleted
            try {
                const recentDeletesCheck = await dbClient.query(`
                    SELECT 
                        COUNT(*) as total_deleted,
                        MAX(updated_date) as last_delete_time
                    FROM live_positions 
                    WHERE status = 'closed' OR status = 'deleted'
                    AND updated_date > NOW() - INTERVAL '1 minute'
                `);
                if (parseInt(recentDeletesCheck.rows[0]?.total_deleted || 0) > 0) {
                    console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ Found ${recentDeletesCheck.rows[0]?.total_deleted} recently closed/deleted positions (last: ${recentDeletesCheck.rows[0]?.last_delete_time})`);
                }
            } catch (delErr) {
                // Ignore delete check errors
            }
            
            console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ Query returned 0 rows! Checking if positions exist in DB...`);
            // Try a simpler count query to verify DB connection and table state
            try {
            const countQuery = 'SELECT COUNT(*) as count FROM live_positions';
            const countResult = await dbClient.query(countQuery);
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Total positions in DB (COUNT): ${countResult.rows[0]?.count || 0}`);
                
                // Check for any positions created in the last 5 minutes (recent positions)
                const recentQuery = "SELECT id, position_id, symbol, status, trading_mode, created_date FROM live_positions WHERE created_date > NOW() - INTERVAL '5 minutes' ORDER BY created_date DESC LIMIT 10";
                const recentResult = await dbClient.query(recentQuery);
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Recent positions (last 5 min): ${recentResult.rows.length} found`);
                if (recentResult.rows.length > 0) {
                    recentResult.rows.forEach((pos, idx) => {
                        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Recent ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status}, created=${pos.created_date}`);
                    });
                }
                
                // Check all positions regardless of date
                const allQuery = 'SELECT id, position_id, symbol, status, trading_mode, created_date FROM live_positions ORDER BY created_date DESC LIMIT 10';
                const allResult = await dbClient.query(allQuery);
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 All positions (any date): ${allResult.rows.length} found`);
                if (allResult.rows.length > 0) {
                    allResult.rows.forEach((pos, idx) => {
                        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 All ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status}, created=${pos.created_date}`);
                    });
                }
            } catch (countError) {
                console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Error checking DB state:`, countError.message);
            }
        }
        
        // DEBUG: Log exit_time for first few positions to verify it's being loaded
        if (result.rows.length > 0) {
            result.rows.slice(0, 3).forEach((pos, idx) => {
                if (pos.exit_time) {
                    const exitTime = new Date(pos.exit_time);
                    const now = new Date();
                    const timeUntilExit = exitTime.getTime() - now.getTime();
                    const hoursUntilExit = Math.floor(timeUntilExit / (1000 * 60 * 60));
                    const minutesUntilExit = Math.floor((timeUntilExit % (1000 * 60 * 60)) / (1000 * 60));
                    console.log(`[PROXY] ✅ Position ${idx + 1} has exit_time: ${exitTime.toISOString()} (${pos.symbol}) - ${hoursUntilExit}h ${minutesUntilExit}m until exit`);
                    
                    // Verify calculation matches time_exit_hours
                    if (pos.entry_timestamp && pos.time_exit_hours) {
                        const entryTimestamp = new Date(pos.entry_timestamp);
                        const exitTimeHours = parseFloat(pos.time_exit_hours) || 24;
                        const expectedExitTime = new Date(entryTimestamp.getTime() + (exitTimeHours * 60 * 60 * 1000));
                        const actualExitTime = new Date(pos.exit_time);
                        const diffMinutes = Math.abs((actualExitTime.getTime() - expectedExitTime.getTime()) / (1000 * 60));
                        if (diffMinutes >= 1) {
                            console.log(`[PROXY] ⚠️ Position ${idx + 1} exit_time calculation mismatch: Expected ${expectedExitTime.toISOString()}, Actual ${actualExitTime.toISOString()}, Diff: ${diffMinutes.toFixed(2)} minutes`);
                        }
                    }
                } else if (pos.time_exit_hours && pos.entry_timestamp) {
                    // Calculate what exit_time should be
                    const entryTimestamp = new Date(pos.entry_timestamp);
                    const exitTimeHours = parseFloat(pos.time_exit_hours) || 24;
                    const calculatedExitTime = new Date(entryTimestamp.getTime() + (exitTimeHours * 60 * 60 * 1000));
                    console.log(`[PROXY] ⚠️ Position ${idx + 1} missing exit_time but can be calculated: ${calculatedExitTime.toISOString()} (time_exit_hours=${pos.time_exit_hours}, entry=${entryTimestamp.toISOString()}) (${pos.symbol})`);
                    console.log(`[PROXY] ⚠️ This position was likely created before exit_time feature was added`);
                } else {
                    console.log(`[PROXY] ⚠️ Position ${idx + 1} missing exit_time, time_exit_hours: ${pos.time_exit_hours}, entry_timestamp: ${pos.entry_timestamp} (${pos.symbol})`);
                }
            });
        }
        
        return result.rows;
    } catch (error) {
        console.error('[POSITION_DEBUG] [POSITION_DB] ❌ Error loading positions:', error.message);
        console.error('[POSITION_DEBUG] [POSITION_DB] ❌ Error stack:', error.stack);
        return [];
    }
}

async function deleteLivePositionFromDB(positionId) {
    if (!dbClient) return false;
    
    try {
        const deleteStartTime = Date.now();
        
        // CRITICAL: Check if position exists before deletion
        const checkQuery = 'SELECT id, symbol, status, trading_mode, created_date FROM live_positions WHERE id = $1';
        const checkResult = await dbClient.query(checkQuery, [positionId]);
        if (checkResult.rows.length > 0) {
            const pos = checkResult.rows[0];
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🗑️ About to delete position: ${pos.symbol} (${positionId?.substring(0, 8)}), status=${pos.status}, mode=${pos.trading_mode}, created=${pos.created_date}`);
        } else {
            console.log(`[POSITION_DEBUG] [POSITION_DB] ⚠️ Delete called for position ${positionId?.substring(0, 8)} but it doesn't exist in DB!`);
        }
        
        const query = 'DELETE FROM live_positions WHERE id = $1';
        const result = await dbClient.query(query, [positionId]);
        const deleteEndTime = Date.now();
        const deleted = !!(result && result.rowCount && result.rowCount > 0);
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🗑️ Deleted position from database: ${positionId?.substring(0, 8)} rowCount: ${result?.rowCount} in ${deleteEndTime - deleteStartTime}ms`);
        
        // CRITICAL DEBUG: Log full stack trace to see who called this
        const stackTrace = new Error().stack;
        const callerLines = stackTrace?.split('\n').slice(1, 6).map(l => l.trim()).filter(Boolean) || [];
        //console.log(`[POSITION_DEBUG] [POSITION_DB] 🗑️ Delete called by: ${callerLines.join(' -> ')}`);
        
        // CRITICAL DEBUG: After deletion, check how many positions remain
        try {
            const remainingCheck = await dbClient.query('SELECT COUNT(*) as count FROM live_positions');
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🔍 Positions remaining after delete: ${remainingCheck.rows[0]?.count || 0}`);
        } catch (remErr) {
            // Ignore remaining check errors
        }
        
        // Verify deletion
        const verifyQuery = 'SELECT COUNT(*) as count FROM live_positions WHERE id = $1';
        const verifyResult = await dbClient.query(verifyQuery, [positionId]);
        if (parseInt(verifyResult.rows[0]?.count || 0) > 0) {
            console.error(`[POSITION_DEBUG] [POSITION_DB] ❌ Position still exists after DELETE! COUNT=${verifyResult.rows[0]?.count}`);
        } else {
            //console.log(`[POSITION_DEBUG] [POSITION_DB] ✅ Position confirmed deleted (COUNT=0)`);
        }
        
        return deleted;
    } catch (error) {
        console.error('[POSITION_DEBUG] [POSITION_DB] ❌ Error deleting position from database:', error.message);
        return false;
    }
}

// Delete backtest combination from database by combination_name, coin, and timeframe
async function deleteBacktestCombinationFromDB(combinationName, coin, timeframe) {
    if (!dbClient) return false;
    
    try {
        // Match by strategy_name, coin, and timeframe to ensure we delete the correct strategy
        const query = 'DELETE FROM backtest_combinations WHERE strategy_name = $1 AND coin = $2 AND timeframe = $3';
        const result = await dbClient.query(query, [combinationName, coin, timeframe]);
        const deleted = !!(result && result.rowCount && result.rowCount > 0);
        console.log('[PROXY] 🗑️ Deleted backtest combination from database:', combinationName, 'rowCount:', result?.rowCount);
        return deleted;
    } catch (error) {
        console.error('[PROXY] ❌ Error deleting backtest combination from database:', error.message);
        return false;
    }
}

// Bulk delete backtest combinations from database by IDs
async function bulkDeleteBacktestCombinationsFromDB(ids) {
    if (!dbClient) {
        console.log('[PROXY] ⚠️ bulkDeleteBacktestCombinationsFromDB: Database client not available');
        return { deleted: 0, failed: ids?.length || 0 };
    }
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        console.log('[PROXY] ⚠️ bulkDeleteBacktestCombinationsFromDB: No IDs provided');
        return { deleted: 0, failed: 0 };
    }
    
    console.log(`[PROXY] 🔍 bulkDeleteBacktestCombinationsFromDB: Attempting to delete ${ids.length} combinations`);
    console.log(`[PROXY] 🔍 Sample IDs (first 3):`, ids.slice(0, 3));
    
    // Validate IDs are UUIDs (36 characters with hyphens, or allow other formats)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validIds = ids.filter(id => {
        const isValid = typeof id === 'string' && (uuidPattern.test(id) || id.length === 36);
        if (!isValid) {
            console.log(`[PROXY] ⚠️ Invalid ID format (not UUID): ${id.substring(0, 50)}...`);
        }
        return isValid;
    });
    
    if (validIds.length === 0) {
        console.error(`[PROXY] ❌ None of the provided IDs are valid UUIDs. All ${ids.length} IDs were invalid.`);
        console.error(`[PROXY] ❌ First invalid ID sample:`, ids[0]);
        return { deleted: 0, failed: ids.length };
    }
    
    if (validIds.length !== ids.length) {
        console.warn(`[PROXY] ⚠️ Only ${validIds.length} of ${ids.length} IDs are valid UUIDs. Proceeding with valid IDs only.`);
    }
    
    try {
        // First, check what IDs actually exist in the database
        console.log(`[PROXY] 🔍 Checking if provided IDs exist in database...`);
        const checkQuery = `SELECT id::text as id_text, combination_name FROM backtest_combinations WHERE id::text = ANY($1::text[]) LIMIT 10`;
        const checkResult = await dbClient.query(checkQuery, [validIds]);
        console.log(`[PROXY] 🔍 Found ${checkResult.rowCount} matching IDs in database (out of ${validIds.length} requested)`);
        if (checkResult.rowCount > 0) {
            console.log(`[PROXY] 🔍 Sample existing records:`, checkResult.rows.map(r => ({ id: r.id_text, name: r.combination_name })));
        }
        
        // Try multiple deletion approaches
        let deleted = 0;
        let lastError = null;
        
        // Approach 1: UUID array (PostgreSQL native)
        try {
            // CRITICAL: Verify IDs exist before deleting
            const verifyQuery = `SELECT id::text FROM backtest_combinations WHERE id = ANY($1::uuid[])`;
            const verifyResult = await dbClient.query(verifyQuery, [validIds]);
            const existingIds = verifyResult.rows.map(r => r.id);
            console.log(`[PROXY] 🔍 Verification: Found ${existingIds.length} IDs that will be deleted`);
            if (existingIds.length === 0) {
                console.error(`[PROXY] ❌ No matching IDs found in database! Cannot delete.`);
                console.error(`[PROXY] ❌ Requested IDs (first 5):`, validIds.slice(0, 5));
                return { deleted: 0, failed: ids.length };
            }
            if (existingIds.length < validIds.length) {
                console.warn(`[PROXY] ⚠️ Only ${existingIds.length} of ${validIds.length} requested IDs exist in database`);
                console.warn(`[PROXY] ⚠️ Will only delete existing IDs`);
            }
            
            const query1 = `DELETE FROM backtest_combinations WHERE id = ANY($1::uuid[])`;
            console.log(`[PROXY] 🔍 Executing DELETE with UUID array (${validIds.length} IDs, ${existingIds.length} exist)`);
            const result1 = await dbClient.query(query1, [validIds]);
            deleted = result1.rowCount || 0;
            console.log(`[PROXY] ✅ UUID array DELETE completed. Affected rows: ${deleted}`);
            
            // Verify deletion actually worked
            if (deleted > 0) {
                const verifyAfterQuery = `SELECT COUNT(*) as remaining FROM backtest_combinations WHERE id = ANY($1::uuid[])`;
                const verifyAfterResult = await dbClient.query(verifyAfterQuery, [validIds]);
                const remaining = parseInt(verifyAfterResult.rows[0]?.remaining || 0);
                console.log(`[PROXY] 🔍 Post-deletion verification: ${remaining} of ${validIds.length} IDs still exist`);
                if (remaining > 0) {
                    console.error(`[PROXY] ⚠️ WARNING: ${remaining} IDs were NOT deleted despite rowCount=${deleted}!`);
                } else {
                    console.log(`[PROXY] ✅ Verification passed: All ${deleted} IDs successfully deleted`);
                }
            }
            
            if (deleted > 0) {
                return { deleted, failed: ids.length - deleted };
            }
        } catch (error1) {
            console.log(`[PROXY] ⚠️ UUID array approach failed: ${error1.message}`);
            lastError = error1;
        }
        
        // Approach 2: Text comparison (more flexible)
        if (deleted === 0) {
            try {
                const placeholders = validIds.map((_, index) => `$${index + 1}`).join(', ');
                const query2 = `DELETE FROM backtest_combinations WHERE id::text IN (${placeholders})`;
                console.log(`[PROXY] 🔍 Attempting DELETE with text comparison (${validIds.length} IDs)`);
                const result2 = await dbClient.query(query2, validIds);
                deleted = result2.rowCount || 0;
                console.log(`[PROXY] ✅ Text comparison DELETE completed. Affected rows: ${deleted}`);
                if (deleted > 0) {
                    return { deleted, failed: ids.length - deleted };
                }
            } catch (error2) {
                console.log(`[PROXY] ⚠️ Text comparison approach failed: ${error2.message}`);
                lastError = error2;
            }
        }
        
        // Approach 3: Individual deletes (last resort)
        if (deleted === 0) {
            console.log(`[PROXY] 🔍 Attempting individual DELETE queries...`);
            let individualDeleted = 0;
            for (const id of validIds.slice(0, 10)) { // Limit to first 10 to avoid too many queries
                try {
                    const query3 = `DELETE FROM backtest_combinations WHERE id::text = $1`;
                    const result3 = await dbClient.query(query3, [id]);
                    if (result3.rowCount > 0) {
                        individualDeleted++;
                        console.log(`[PROXY] ✅ Deleted individual ID: ${id}`);
                    }
                } catch (error3) {
                    console.log(`[PROXY] ⚠️ Failed to delete individual ID ${id}: ${error3.message}`);
                }
            }
            deleted = individualDeleted;
            console.log(`[PROXY] ✅ Individual DELETE completed. Affected rows: ${deleted}`);
        }
        
        if (deleted === 0 && validIds.length > 0) {
            console.error(`[PROXY] ❌ WARNING: All DELETE approaches failed! 0 rows were deleted.`);
            console.error(`[PROXY] ❌ Last error: ${lastError?.message || 'Unknown error'}`);
            console.error(`[PROXY] ❌ Requested IDs (first 5):`, validIds.slice(0, 5));
            console.error(`[PROXY] 💡 This likely means the frontend IDs don't match database UUIDs.`);
            console.error(`[PROXY] 💡 SOLUTION: User needs to refresh the page to load correct UUIDs from database.`);
        }
        
        return { deleted, failed: ids.length - deleted };
    } catch (error) {
        console.error('[PROXY] ❌ Error in bulk delete from database:', error.message);
        console.error('[PROXY] ❌ Error stack:', error.stack);
        
        // If UUID array casting fails, try with text comparison
        if (error.message.includes('uuid') || error.message.includes('invalid input syntax')) {
            console.log(`[PROXY] 🔄 Retrying with text comparison...`);
            try {
                const placeholders = validIds.map((_, index) => `$${index + 1}`).join(', ');
                const query = `DELETE FROM backtest_combinations WHERE id::text IN (${placeholders})`;
                const result = await dbClient.query(query, validIds);
                const deleted = result.rowCount || 0;
                console.log(`[PROXY] ✅ Retry successful: deleted ${deleted} rows using text comparison`);
                return { deleted, failed: ids.length - deleted };
            } catch (retryError) {
                console.error('[PROXY] ❌ Retry also failed:', retryError.message);
            }
        }
        
        return { deleted: 0, failed: ids.length };
    }
}

// File storage helper functions
const STORAGE_DIR = path.join(__dirname, 'storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function getStoredData(key) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Ensure we always return an array for consistency
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed && typeof parsed === 'object') {
        // If it's a single object, wrap it in an array
        return [parsed];
      } else {
        console.warn(`[PROXY] ⚠️ Unexpected data format for ${key}, returning empty array`);
        return [];
      }
    }
    console.log(`[PROXY] 📊 No ${key} file found, returning empty array`);
    return [];
  } catch (error) {
    console.error(`[PROXY] Error reading ${key}:`, error);
    console.error(`[PROXY] Error details:`, error.message);
    return [];
  }
}

function saveStoredData(key, data) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    
    // Ensure data is always saved as an array for consistency
    let dataToSave = data;
    if (!Array.isArray(data)) {
      if (data && typeof data === 'object') {
        dataToSave = [data];
      } else {
        dataToSave = [];
      }
    }
    
    // Create backup before saving
    if (fs.existsSync(filePath)) {
      const backupPath = `${filePath}.backup`;
      fs.copyFileSync(filePath, backupPath);
    }
    
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
    console.log(`[PROXY] ✅ Successfully saved ${key} to storage (${dataToSave.length} items)`);
  } catch (error) {
    console.error(`[PROXY] Error saving ${key}:`, error);
    console.error(`[PROXY] Error details:`, error.message);
    throw error;
  }
}

// Data validation functions
function validateWalletSummary(summary) {
  const requiredFields = ['id', 'trading_mode'];
  const errors = [];
  
  for (const field of requiredFields) {
    if (!summary[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  if (summary.balance_in_trades !== undefined && typeof summary.balance_in_trades !== 'number') {
    errors.push('balance_in_trades must be a number');
  }
  
  if (summary.available_balance !== undefined && typeof summary.available_balance !== 'number') {
    errors.push('available_balance must be a number');
  }
  
  return errors;
}

function validateLivePosition(position) {
  const requiredFields = ['id', 'symbol', 'status', 'wallet_id', 'trading_mode'];
  const errors = [];
  
  for (const field of requiredFields) {
    if (!position[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Convert string numbers to actual numbers
  if (position.quantity_crypto !== undefined) {
    if (typeof position.quantity_crypto === 'string') {
      const num = parseFloat(position.quantity_crypto);
      if (!isNaN(num)) {
        position.quantity_crypto = num;
      } else {
        errors.push('quantity_crypto is not a valid number');
      }
    } else if (typeof position.quantity_crypto !== 'number') {
      errors.push('quantity_crypto must be a number');
    }
  }
  
  if (position.entry_price !== undefined) {
    if (typeof position.entry_price === 'string') {
      const num = parseFloat(position.entry_price);
      if (!isNaN(num)) {
        position.entry_price = num;
      } else {
        errors.push('entry_price is not a valid number');
      }
    } else if (typeof position.entry_price !== 'number') {
      errors.push('entry_price must be a number');
    }
  }
  
  return errors;
}


// Data integrity monitoring
function checkDataIntegrity() {
  const issues = [];
  
  // Check wallet summaries
  if (!Array.isArray(walletSummaries)) {
    issues.push('walletSummaries is not an array');
  } else {
    const duplicateModes = {};
    walletSummaries.forEach(ws => {
      if (duplicateModes[ws.trading_mode]) {
        duplicateModes[ws.trading_mode]++;
      } else {
        duplicateModes[ws.trading_mode] = 1;
      }
    });
    
    Object.entries(duplicateModes).forEach(([mode, count]) => {
      if (count > 1) {
        issues.push(`Multiple wallet summaries for trading_mode: ${mode} (${count} found)`);
      }
    });
  }
  
  // Check live positions
  if (!Array.isArray(livePositions)) {
    issues.push('livePositions is not an array');
  } else {
    const centralWalletStateIds = new Set(centralWalletStates.map(ws => ws.id));
    const orphanedPositions = livePositions.filter(pos => !centralWalletStateIds.has(pos.wallet_id));
    
    if (orphanedPositions.length > 0) {
      issues.push(`${orphanedPositions.length} orphaned positions found`);
    }
  }
  
  return issues;
}

function logDataIntegrityCheck() {
  const issues = checkDataIntegrity();
  if (issues.length > 0) {
    console.error('[PROXY] ⚠️ DATA INTEGRITY ISSUES DETECTED:');
    issues.forEach(issue => console.error(`[PROXY]   - ${issue}`));
    console.error('[PROXY] 💡 Run "node data-recovery-tool.cjs" to fix these issues');
  } else {
    console.log('[PROXY] ✅ Data integrity check passed');
  }
}

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies with increased limit for large Binance account data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Global lightweight HTTP request logger (method, path, status, duration)
app.use((req, res, next) => {
  const startMs = Date.now();
  res.on('finish', () => {
    try {
      console.log(
        `[PROXY] HTTP ${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - startMs}ms`
      );
    } catch (_) {}
  });
  next();
});

// Wallet config endpoints (registered early to ensure availability)
app.post('/api/wallet-config', async (req, res) => {
    try {
        const { trading_mode } = req.body;
        
        if (!trading_mode) {
            return res.status(400).json({ success: false, error: 'trading_mode is required' });
        }

        if (!dbClient) {
            console.error('[PROXY] ⚠️ Database not available for wallet-config query');
            // Fallback: return a default wallet ID for testnet
            if (trading_mode === 'testnet') {
                return res.json({ success: true, walletId: 'hvazdukoq' });
            }
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const query = 'SELECT primary_wallet_id FROM wallet_config WHERE trading_mode = $1';
        const result = await dbClient.query(query, [trading_mode]);
        
        if (result.rows.length > 0) {
            res.json({ success: true, walletId: result.rows[0].primary_wallet_id });
        } else {
            // Fallback: return default wallet ID for testnet if not found in DB
            if (trading_mode === 'testnet') {
                return res.json({ success: true, walletId: 'hvazdukoq' });
            }
            res.json({ success: false, error: 'No wallet config found for trading mode' });
        }
    } catch (error) {
        console.error('[PROXY] Error fetching wallet config:', error);
        // Fallback: return default wallet ID for testnet on error
        if (req.body.trading_mode === 'testnet') {
            return res.json({ success: true, walletId: 'hvazdukoq' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/wallet-config', async (req, res) => {
    try {
        const { trading_mode, primary_wallet_id } = req.body;
        
        if (!trading_mode || !primary_wallet_id) {
            return res.status(400).json({ success: false, error: 'trading_mode and primary_wallet_id are required' });
        }

        if (!dbClient) {
            console.error('[PROXY] ⚠️ Database not available for wallet-config update');
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const query = `
            INSERT INTO wallet_config (trading_mode, primary_wallet_id) 
            VALUES ($1, $2) 
            ON CONFLICT (trading_mode) 
            DO UPDATE SET 
                primary_wallet_id = EXCLUDED.primary_wallet_id,
                updated_date = now()
        `;
        
        await dbClient.query(query, [trading_mode, primary_wallet_id]);
        res.json({ success: true, message: 'Wallet config updated successfully' });
    } catch (error) {
        console.error('[PROXY] Error updating wallet config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve test files
app.get('/test-position-data.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'test-position-data.js'));
});

app.get('/load-test-functions.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'load-test-functions.js'));
});

// Binance API base URL
const BINANCE_BASE_URL = 'https://api.binance.com';
const BINANCE_TESTNET_URL = 'https://testnet.binance.vision';

// Helper function to get Binance URL based on trading mode
function getBinanceUrl(tradingMode = 'mainnet') {
  return tradingMode === 'testnet' ? BINANCE_TESTNET_URL : BINANCE_BASE_URL;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Trading endpoint for account info
app.post('/trading', async (req, res) => {
  try {
    const { action, tradingMode } = req.body;
    
    if (action === 'getAccountInfo') {
      // Use the same logic as GET /api/binance/account
      const mode = tradingMode || 'testnet';
      
      // Use actual Binance testnet API keys
      const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
      const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
      
      if (mode === 'testnet') {
        console.log('[Trading] Using testnet API keys for real Binance connection');
        
        // Make real call to Binance testnet
        const binanceUrl = 'https://testnet.binance.vision';
        const timestamp = Date.now();
        
        // Create signature for authentication
        const crypto = require('crypto');
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
        
        const accountUrl = `${binanceUrl}/api/v3/account?${queryString}&signature=${signature}`;
        
        console.log('[Trading] Making request to:', accountUrl);
        
        const response = await fetch(accountUrl, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': testnetApiKey,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Trading] Error response:', response.status, errorText);
          throw new Error(`Binance API error: ${response.status} - ${errorText}`);
        }
        
        const accountData = await response.json();
        console.log('[Trading] ✅ Successfully fetched real account data from Binance testnet');
        console.log('[Trading] Account type:', accountData.accountType);
        console.log('[Trading] Total balances:', accountData.balances?.length || 0);
        
        // Log all assets
        if (accountData.balances && accountData.balances.length > 0) {
          console.log('[Trading] 📊 All assets from Binance testnet:');
          accountData.balances.forEach((balance, index) => {
            const total = parseFloat(balance.free) + parseFloat(balance.locked);
            if (total > 0) { // Only show assets with balance
              console.log(`[Trading] Asset ${index + 1}: ${balance.asset} - Free: ${balance.free}, Locked: ${balance.locked}, Total: ${total.toFixed(8)}`);
            }
          });
        }
        
        res.json({ success: true, data: accountData });
      } else {
        // For mainnet, return mock data
        const mockAccountInfo = {
          success: true,
          data: {
            accountType: 'SPOT',
            balances: [
              {
                asset: 'USDT',
                free: '10000.00000000',
                locked: '0.00000000'
              },
              {
                asset: 'BTC',
                free: '0.10000000',
                locked: '0.00000000'
              }
            ],
            permissions: ['SPOT'],
            canTrade: true,
            canWithdraw: true,
            canDeposit: true,
            updateTime: Date.now()
          }
        };
        
        res.json(mockAccountInfo);
      }
    } else if (action === 'getAllOrders') {
      // Handle getAllOrders action
      const mode = tradingMode || 'testnet';
      const { symbol, limit = 10 } = req.body;
      
      console.log(`[Trading] Getting all orders for symbol: ${symbol}, limit: ${limit}, mode: ${mode}`);
      
      if (mode === 'testnet') {
        // Use actual Binance testnet API keys
        const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
        const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
        
        const binanceUrl = 'https://testnet.binance.vision';
        const timestamp = Date.now();
        
        // Create signature for authentication
        const crypto = require('crypto');
        const queryString = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
        
        const finalQueryString = `${queryString}&signature=${signature}`;
        const ordersUrl = `${binanceUrl}/api/v3/allOrders?${finalQueryString}`;
        
        console.log('[Trading] Orders URL:', ordersUrl);
        
        // Make the request to Binance
        const https = require('https');
        const url = require('url');
        const parsedUrl = url.parse(ordersUrl);
        
        const requestOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.path,
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': testnetApiKey,
            'Content-Type': 'application/json'
          }
        };
        
        const binanceRequest = https.request(requestOptions, (binanceResponse) => {
          let data = '';
          
          binanceResponse.on('data', (chunk) => {
            data += chunk;
          });
          
          binanceResponse.on('end', () => {
            console.log('[Trading] Binance orders response status:', binanceResponse.statusCode);
            console.log('[Trading] Binance orders response data:', data);
            
            try {
              const responseData = JSON.parse(data);
              
              if (binanceResponse.statusCode === 200) {
                res.json({
                  success: true,
                  data: responseData,
                  message: 'Orders retrieved successfully'
                });
              } else {
                res.status(binanceResponse.statusCode).json({
                  success: false,
                  error: responseData.msg || 'Failed to retrieve orders',
                  details: responseData
                });
              }
            } catch (parseError) {
              console.error('[Trading] Error parsing Binance response:', parseError);
              res.status(500).json({ success: false, error: 'Failed to parse Binance response' });
            }
          });
        });
        
        binanceRequest.on('error', (error) => {
          console.error('[Trading] Error making request to Binance:', error);
          res.status(500).json({ success: false, error: error.message });
        });
        
        binanceRequest.end();
      } else {
        // Mock response for mainnet (should not be used in production)
        res.json({
          success: true,
          data: []
        });
      }
    } else {
      res.status(400).json({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Error processing trading request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance ticker price endpoint
app.get('/api/binance/ticker/price', async (req, res) => {
  try {
    const { symbol } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }

    // CRITICAL: Normalize symbol (remove slash, ensure uppercase)
    const normalizedSymbol = symbol.replace('/', '').toUpperCase();
    
    console.log(`[PROXY] 📊 GET /api/binance/ticker/price - Symbol: ${symbol} → ${normalizedSymbol}, Mode: ${tradingMode}`);

    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/ticker/price?symbol=${normalizedSymbol}`;
    
    console.log(`[PROXY] 📊 Binance URL: ${url}`);
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            
            // CRITICAL: Log raw Binance response to track price source
            console.log(`[PROXY] 🔍 RAW Binance API response for ${normalizedSymbol}:`, {
              symbol: parsed.symbol,
              price: parsed.price,
              fullResponse: parsed
            });
            
            // CRITICAL: Validate that Binance returned the correct symbol
            if (parsed.symbol && parsed.symbol.toUpperCase() !== normalizedSymbol) {
              console.error(`[PROXY] ❌ CRITICAL: Symbol mismatch! Requested ${normalizedSymbol}, but Binance returned ${parsed.symbol}`);
              reject(new Error(`Symbol mismatch: requested ${normalizedSymbol}, got ${parsed.symbol}`));
              return;
            }
            
            // CRITICAL: Validate price is realistic
            const EXPECTED_PRICE_RANGES = {
              'ETHUSDT': { min: 2500, max: 5000 },
              'BTCUSDT': { min: 40000, max: 80000 },
              'SOLUSDT': { min: 100, max: 300 },
              'BNBUSDT': { min: 200, max: 800 }
            };
            
            const range = EXPECTED_PRICE_RANGES[normalizedSymbol];
            if (range && parsed.price) {
              const price = parseFloat(parsed.price);
              if (price < range.min || price > range.max) {
                console.error(`[PROXY] ❌ CRITICAL: Binance returned price ${price} for ${normalizedSymbol}, which is outside expected range [${range.min}, ${range.max}]`);
                console.error(`[PROXY] ❌ This may indicate Binance API returned wrong data - logging for investigation`);
                // Don't reject - log error but return data (Binance is source of truth, but we log the issue)
              }
              
              // SPECIAL: Extra validation for ETH - alert if outside 3500-4000 range
              if (normalizedSymbol === 'ETHUSDT') {
                const ETH_ALERT_MIN = 3500;
                const ETH_ALERT_MAX = 4000;
                if (price < ETH_ALERT_MIN || price > ETH_ALERT_MAX) {
                  console.error(`[PROXY] 🚨🚨🚨 ETH PRICE ALERT 🚨🚨🚨`);
                  console.error(`[PROXY] 🚨 ETH price ${price} is outside alert range [${ETH_ALERT_MIN}, ${ETH_ALERT_MAX}]`);
                  console.error(`[PROXY] 🚨 Full details:`, {
                    symbol: normalizedSymbol,
                    requestedSymbol: symbol,
                    tradingMode: tradingMode,
                    binancePrice: parsed.price,
                    parsedPrice: price,
                    expectedRange: { min: range.min, max: range.max },
                    alertRange: { min: ETH_ALERT_MIN, max: ETH_ALERT_MAX },
                    priceDifference: price < ETH_ALERT_MIN ? 
                      `${(ETH_ALERT_MIN - price).toFixed(2)} below minimum` : 
                      `${(price - ETH_ALERT_MAX).toFixed(2)} above maximum`,
                    percentDifference: price < ETH_ALERT_MIN ? 
                      `${((ETH_ALERT_MIN - price) / ETH_ALERT_MIN * 100).toFixed(2)}%` : 
                      `${((price - ETH_ALERT_MAX) / ETH_ALERT_MAX * 100).toFixed(2)}%`,
                    timestamp: new Date().toISOString(),
                    binanceResponse: parsed,
                    url: url,
                    binanceUrl: binanceUrl
                  });
                  console.error(`[PROXY] 🚨🚨🚨 END ETH PRICE ALERT 🚨🚨🚨`);
                }
              }
            }
            
            resolve(parsed);
          } catch (e) {
            console.error(`[PROXY] ❌ Error parsing Binance response for ${normalizedSymbol}:`, e);
            reject(e);
          }
        });
      });
      request.on('error', (error) => {
        console.error(`[PROXY] ❌ Network error fetching price for ${normalizedSymbol}:`, error.message);
        reject(error);
      });
      
      // Set timeout to prevent hanging
      request.setTimeout(10000, () => {
        request.destroy();
        console.error(`[PROXY] ❌ Timeout fetching price for ${normalizedSymbol} after 10 seconds`);
        reject(new Error('Request timeout'));
      });
    });
    
    console.log(`[PROXY] ✅ Successfully fetched price for ${normalizedSymbol}: $${data.price}`);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`[PROXY] ❌ Error fetching ticker price for ${req.query.symbol}:`, error.message);
    console.error(`[PROXY] ❌ Error stack:`, error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance batch ticker price endpoint (for multiple symbols)
app.get('/api/binance/ticker/price/batch', async (req, res) => {
  try {
    const { symbols } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbols) {
      return res.status(400).json({ success: false, error: 'Symbols parameter is required' });
    }

    // Parse symbols (comma-separated string or JSON array)
    let symbolList = [];
    if (typeof symbols === 'string') {
      try {
        // Try to parse as JSON array first
        symbolList = JSON.parse(symbols);
      } catch {
        // Fall back to comma-separated string
        symbolList = symbols.split(',').map(s => s.trim()).filter(s => s);
      }
    } else if (Array.isArray(symbols)) {
      symbolList = symbols;
    }

    if (!Array.isArray(symbolList) || symbolList.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid symbols format' });
    }

    console.log(`[PROXY] 📊 Batch fetching prices for ${symbolList.length} symbols`);

    const binanceUrl = getBinanceUrl(tradingMode);
    
    // Fetch all symbols in parallel
    const promises = symbolList.map(async (symbol) => {
      try {
        const url = `${binanceUrl}/api/v3/ticker/price?symbol=${symbol}`;
        const data = await new Promise((resolve, reject) => {
          const request = (url.startsWith('https') ? https : http).get(url, {
            timeout: 10000, // 10 second timeout
            agent: false
          }, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
              // Check if response is HTML (error page) instead of JSON
              if (response.statusCode !== 200 || data.trim().startsWith('<')) {
                reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 100)}`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
              }
            });
          });
          request.on('error', (error) => {
            // Improve error messages for common network issues
            if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
              reject(new Error(`DNS resolution failed for ${binanceUrl} - check network connection`));
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
              reject(new Error(`Connection timeout to ${binanceUrl} - Binance may be unavailable`));
            } else {
              reject(error);
            }
          });
          request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error(`Request timeout for ${symbol}`));
          });
        });
        return { symbol, data, success: true };
      } catch (error) {
        // Only log warnings for non-DNS errors to reduce noise
        if (!error.message.includes('DNS resolution') && !error.message.includes('timeout')) {
        console.warn(`[PROXY] ⚠️ Failed to fetch price for ${symbol}:`, error.message);
        }
        return { symbol, data: null, success: false, error: error.message };
      }
    });

    const results = await Promise.all(promises);
    
    // Filter successful results
    const successfulResults = results.filter(r => r.success && r.data);
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length > 0) {
      console.warn(`[PROXY] ⚠️ ${failedResults.length} symbols failed to fetch`);
    }

    console.log(`[PROXY] ✅ Batch price fetch completed: ${successfulResults.length}/${symbolList.length} successful`);
    
    res.json({ 
      success: true, 
      data: successfulResults.map(r => r.data),
      failed: failedResults.map(r => ({ symbol: r.symbol, error: r.error })),
      summary: {
        requested: symbolList.length,
        successful: successfulResults.length,
        failed: failedResults.length
      }
    });
  } catch (error) {
    console.error('Error fetching batch prices:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance 24hr ticker endpoint (for price and 24h change)
app.get('/api/binance/ticker/24hr', async (req, res) => {
  try {
    const { symbol } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }

    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/ticker/24hr?symbol=${symbol}`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching 24hr ticker:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance batch 24hr ticker endpoint (for multiple symbols)
app.get('/api/binance/ticker/24hr/batch', async (req, res) => {
  try {
    const { symbols } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbols) {
      return res.status(400).json({ success: false, error: 'Symbols parameter is required' });
    }

    // Parse symbols (comma-separated string or JSON array)
    let symbolList = [];
    if (typeof symbols === 'string') {
      try {
        // Try to parse as JSON array first
        symbolList = JSON.parse(symbols);
      } catch {
        // Fall back to comma-separated string
        symbolList = symbols.split(',').map(s => s.trim()).filter(s => s);
      }
    } else if (Array.isArray(symbols)) {
      symbolList = symbols;
    }

    if (!Array.isArray(symbolList) || symbolList.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid symbols format' });
    }

    console.log(`[PROXY] 📊 Batch fetching 24hr tickers for ${symbolList.length} symbols`);

    const binanceUrl = getBinanceUrl(tradingMode);
    
    // Fetch all symbols in parallel with improved error handling
    const promises = symbolList.map(async (symbol) => {
      try {
        const url = `${binanceUrl}/api/v3/ticker/24hr?symbol=${symbol}`;
        const data = await new Promise((resolve, reject) => {
          const request = (url.startsWith('https') ? https : http).get(url, {
            timeout: 10000, // 10 second timeout
            agent: false
          }, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
              // Check if response is HTML (error page) instead of JSON
              if (response.statusCode !== 200 || data.trim().startsWith('<')) {
                reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 100)}`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
              }
            });
          });
          request.on('error', (error) => {
            // Improve error messages for common network issues
            if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
              reject(new Error(`DNS resolution failed for ${binanceUrl} - check network connection`));
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
              reject(new Error(`Connection timeout to ${binanceUrl} - Binance may be unavailable`));
            } else {
              reject(error);
            }
          });
          request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error(`Request timeout for ${symbol}`));
          });
        });
        return { symbol, data, success: true };
      } catch (error) {
        // Only log warnings for non-DNS errors to reduce noise
        if (!error.message.includes('DNS resolution') && !error.message.includes('timeout')) {
        console.warn(`[PROXY] ⚠️ Failed to fetch ticker for ${symbol}:`, error.message);
        }
        return { symbol, data: null, success: false, error: error.message };
      }
    });

    const results = await Promise.all(promises);
    
    // Filter successful results
    const successfulResults = results.filter(r => r.success && r.data);
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length > 0) {
      console.warn(`[PROXY] ⚠️ ${failedResults.length} symbols failed to fetch`);
    }

    console.log(`[PROXY] ✅ Batch fetch completed: ${successfulResults.length}/${symbolList.length} successful`);
    
    res.json({ 
      success: true, 
      data: successfulResults.map(r => r.data),
      failed: failedResults.map(r => ({ symbol: r.symbol, error: r.error })),
      summary: {
        requested: symbolList.length,
        successful: successfulResults.length,
        failed: failedResults.length
      }
    });
  } catch (error) {
    console.error('Error fetching batch 24hr tickers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kline data cache
const klineCache = new Map();
const KLINE_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache for kline data

// Request deduplication for klines
const pendingKlineRequests = new Map();

// Binance klines endpoint with caching and deduplication
app.get('/api/binance/klines', async (req, res) => {
  try {
    const { symbol, interval, limit, endTime } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbol || !interval) {
      return res.status(400).json({ success: false, error: 'Symbol and interval are required' });
    }

    // Create cache key
    const cacheKey = `${symbol}_${interval}_${limit || 'default'}_${endTime || 'latest'}_${tradingMode}`;
    const now = Date.now();
    
    // Check cache first
    if (klineCache.has(cacheKey)) {
      const cached = klineCache.get(cacheKey);
      if ((now - cached.timestamp) < KLINE_CACHE_DURATION) {
        console.log(`[PROXY] 📊 Returning cached kline data for ${symbol} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
        return res.json({ success: true, data: cached.data, cached: true });
      }
    }

    // Check for pending request (deduplication)
    if (pendingKlineRequests.has(cacheKey)) {
      console.log(`[PROXY] 🔄 Waiting for pending kline request for ${symbol}`);
      try {
        const result = await pendingKlineRequests.get(cacheKey);
        return res.json({ success: true, data: result, cached: false, deduplicated: true });
      } catch (error) {
        // If the pending request failed, continue with new request
        pendingKlineRequests.delete(cacheKey);
      }
    }

    console.log(`[PROXY] 📊 Fetching fresh kline data for ${symbol} (${interval}, limit: ${limit})`);
    const binanceUrl = getBinanceUrl(tradingMode);
    let url = `${binanceUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}`;
    
    if (limit) url += `&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    
    // Create promise for deduplication
    const requestPromise = new Promise(async (resolve, reject) => {
      try {
        const data = await new Promise((resolveInner, rejectInner) => {
          const request = (url.startsWith('https') ? https : http).get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
              try {
                resolveInner(JSON.parse(data));
              } catch (e) {
                rejectInner(e);
              }
            });
          });
          request.on('error', rejectInner);
        });
        
        // Cache the result
        klineCache.set(cacheKey, {
          data: data,
          timestamp: now
        });
        
        // Clean old cache entries (keep cache size manageable)
        if (klineCache.size > 1000) {
          const entries = Array.from(klineCache.entries());
          entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
          klineCache.clear();
          entries.slice(0, 500).forEach(([key, value]) => klineCache.set(key, value));
        }
        
        console.log(`[PROXY] ✅ Kline data cached for ${symbol} (${JSON.stringify(data).length} bytes)`);
        resolve(data);
      } catch (error) {
        reject(error);
      } finally {
        // Remove from pending requests
        pendingKlineRequests.delete(cacheKey);
      }
    });
    
    // Store the promise for deduplication
    pendingKlineRequests.set(cacheKey, requestPromise);
    
    const data = await requestPromise;
    res.json({ success: true, data, cached: false });
  } catch (error) {
    console.error('Error fetching klines:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance batch klines endpoint (for multiple symbols)
app.get('/api/binance/klines/batch', async (req, res) => {
  const _batchStartTime = Date.now();
  const _batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { symbols, interval, limit, endTime } = req.query;
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    if (!symbols || !interval) {
      console.error(`[PROXY] [KLINES] ❌ Missing params: symbols=${!!symbols}, interval=${!!interval}`);
      return res.status(400).json({ success: false, error: 'Symbols and interval are required' });
    }

    // Parse symbols (comma-separated string or JSON array)
    let symbolList = [];
    if (typeof symbols === 'string') {
      try {
        symbolList = JSON.parse(symbols);
      } catch {
        symbolList = symbols.split(',').map(s => s.trim()).filter(s => s);
      }
    } else if (Array.isArray(symbols)) {
      symbolList = symbols;
    }

    if (!Array.isArray(symbolList) || symbolList.length === 0) {
      console.error(`[PROXY] [KLINES] ❌ Invalid symbols format`);
      return res.status(400).json({ success: false, error: 'Invalid symbols format' });
    }

    // Only log batch start for large batches or when there are issues
    if (symbolList.length > 10) {
      console.log(`[PROXY] [KLINES] 📊 Batch request: ${symbolList.length} symbols, ${interval}, limit=${limit || 'default'}`);
    }

    const binanceUrl = getBinanceUrl(tradingMode);
    
    // Fetch all symbols in parallel
    const promises = symbolList.map(async (symbol, index) => {
      const _symbolStartTime = Date.now();
      
      try {
        let url = `${binanceUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}`;
        if (limit) url += `&limit=${limit}`;
        if (endTime) url += `&endTime=${endTime}`;
        
        const data = await new Promise((resolve, reject) => {
          const requestStartTime = Date.now();
          
          const request = (url.startsWith('https') ? https : http).get(url, (response) => {
            let data = '';
            response.on('data', chunk => {
              data += chunk;
            });
            response.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                resolve(parsed);
              } catch (e) {
                console.error(`[PROXY] [KLINES] ❌ JSON parse error for ${symbol}: ${e.message}`);
                reject(e);
              }
            });
          });
          
          request.on('error', (error) => {
            console.error(`[PROXY] [KLINES] ❌ HTTP error for ${symbol}: ${error.message}`);
            reject(error);
          });
          
          // Add timeout to prevent indefinite hangs (20 seconds per symbol)
          request.setTimeout(20000, () => {
            console.error(`[PROXY] [KLINES] ⏱️ TIMEOUT: ${symbol} exceeded 20s`);
            request.destroy();
            reject(new Error(`Request timeout for ${symbol} after 20 seconds`));
          });
        });
        
        return { symbol, data, success: true };
      } catch (error) {
        // Only log errors (not successful requests)
        if (error.message.includes('timeout')) {
          console.error(`[PROXY] [KLINES] ⏱️ ${symbol} timeout after ${((Date.now() - _symbolStartTime) / 1000).toFixed(1)}s`);
        } else {
          console.warn(`[PROXY] [KLINES] ⚠️ ${symbol} failed: ${error.message}`);
        }
        return { symbol, data: null, success: false, error: error.message };
      }
    });

    const results = await Promise.all(promises);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = Date.now() - _batchStartTime;
    
    // Only log summary if there are failures or if batch is large
    if (failed > 0 || symbolList.length > 10) {
      console.log(`[PROXY] [KLINES] ✅ Batch complete: ${successful}/${symbolList.length} successful, ${failed} failed (${totalTime}ms)`);
    }
    
    res.json({
      success: true,
      data: results,
      summary: {
        requested: symbolList.length,
        successful: successful,
        failed: failed
      }
    });
  } catch (error) {
    const totalTime = Date.now() - _batchStartTime;
    console.error(`[PROXY] [KLINES] ❌ Batch error after ${totalTime}ms: ${error.message}`);
    console.error('[PROXY] [KLINES] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// OpenAI API endpoint
app.post('/api/openai/chat', async (req, res) => {
  try {
    const { messages, model = 'gpt-4o-mini', temperature = 0.7, max_tokens = 1000 } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Messages array is required' });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ 
        success: false, 
        error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file' 
      });
    }

    console.log(`[PROXY] 🤖 OpenAI API request: ${messages.length} messages, model: ${model}`);

    const requestBody = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens
    });

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const data = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) {
              const errorData = JSON.parse(data);
              reject(new Error(errorData.error?.message || `HTTP ${response.statusCode}: ${data.substring(0, 200)}`));
              return;
            }
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });
      
      request.on('error', reject);
      request.write(requestBody);
      request.end();
    });

    console.log(`[PROXY] ✅ OpenAI API response received (tokens: ${data.usage?.total_tokens || 'N/A'})`);

    res.json({
      success: true,
      choices: data.choices,
      usage: data.usage,
      model: data.model
    });
  } catch (error) {
    console.error('[PROXY] ❌ OpenAI API error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Exchange info cache
let exchangeInfoCache = null;
let exchangeInfoCacheTime = 0;
const EXCHANGE_INFO_CACHE_DURATION = 30 * 60 * 1000; // ✅ INCREASED: 30 minutes (was 5 minutes) to reduce Binance API calls and prevent rate limits

// ✅ RATE LIMIT PREVENTION: Track last request time to prevent too-frequent requests
let exchangeInfoLastRequestTime = 0;
const EXCHANGE_INFO_MIN_INTERVAL = 60000; // Minimum 1 minute between requests to Binance

// Binance exchange info endpoint with caching
app.get('/api/binance/exchangeInfo', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    // ✅ RATE LIMIT PREVENTION: Check cache first (most important - prevents unnecessary API calls)
    const now = Date.now();
    if (exchangeInfoCache && (now - exchangeInfoCacheTime) < EXCHANGE_INFO_CACHE_DURATION) {
      console.log(`[PROXY] 📊 Returning cached exchange info (${Math.round((now - exchangeInfoCacheTime) / 1000)}s old)`);
      return res.json({ success: true, data: exchangeInfoCache, cached: true });
    }
    
    // ✅ RATE LIMIT PREVENTION: Throttle requests to Binance (minimum interval between requests)
    const timeSinceLastRequest = now - exchangeInfoLastRequestTime;
    if (timeSinceLastRequest < EXCHANGE_INFO_MIN_INTERVAL && exchangeInfoLastRequestTime > 0) {
      const waitTime = EXCHANGE_INFO_MIN_INTERVAL - timeSinceLastRequest;
      console.log(`[PROXY] ⏳ Rate limiting: Last request was ${Math.round(timeSinceLastRequest / 1000)}s ago. Waiting ${Math.ceil(waitTime / 1000)}s before next request to Binance...`);
      
      // Return cached data if available (even if expired) rather than waiting
      if (exchangeInfoCache) {
        console.log(`[PROXY] 📊 Returning expired cache (${Math.round((now - exchangeInfoCacheTime) / 1000)}s old) to avoid rate limit`);
        return res.json({ success: true, data: exchangeInfoCache, cached: true, expired: true });
      }
      
      // No cache available - wait and then proceed
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    exchangeInfoLastRequestTime = Date.now();
    console.log(`[PROXY] 📊 Fetching fresh exchange info for ${tradingMode}`);
    const binanceUrl = getBinanceUrl(tradingMode);
    const url = `${binanceUrl}/api/v3/exchangeInfo`;
    
    const data = await new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            
            // ✅ FIX: Don't cache error responses (rate limits, etc.)
            if (parsed.code && parsed.code < 0) {
              console.error(`[PROXY] ❌ Binance returned error (code ${parsed.code}): ${parsed.msg}`);
              console.error(`[PROXY] ⚠️ NOT caching error response - will retry on next request`);
              resolve(parsed); // Return error but don't cache
              return;
            }
            
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
    });
    
    // ✅ FIX: Only cache successful responses (not errors)
    if (!data.code || data.code >= 0) {
      // Cache the result only if it's not an error
      exchangeInfoCache = data;
      exchangeInfoCacheTime = now;
      console.log(`[PROXY] ✅ Exchange info cached (${JSON.stringify(data).length} bytes)`);
      res.json({ success: true, data, cached: false });
    } else {
      // Error response - don't cache, return as-is
      console.error(`[PROXY] ❌ Error response not cached: code ${data.code}, msg: ${data.msg}`);
      res.json({ success: true, data, cached: false }); // Still return success: true because HTTP request succeeded
    }
  } catch (error) {
    console.error('Error fetching exchange info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance account info endpoint (for testing API keys)
app.get('/api/binance/account', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    
    // Use actual Binance testnet API keys
    const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
    const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
    
    if (tradingMode === 'testnet') {
      console.log('[Binance Account] Using testnet API keys for real Binance connection');
      
      try {
      // Make real call to Binance testnet
      const binanceUrl = 'https://testnet.binance.vision';
      const timestamp = Date.now();
      
      // Create signature for authentication
      const crypto = require('crypto');
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
      
      const accountUrl = `${binanceUrl}/api/v3/account?${queryString}&signature=${signature}`;
      
      console.log('[Binance Account] Making request to:', accountUrl);
      
      const response = await fetch(accountUrl, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Binance Account] Error response:', response.status, errorText);
        throw new Error(`Binance API error: ${response.status} - ${errorText}`);
      }
      
      const accountData = await response.json();
      console.log('[Binance Account] ✅ Successfully fetched real account data from Binance testnet');
      console.log('[Binance Account] Account type:', accountData.accountType);
      console.log('[Binance Account] Total balances:', accountData.balances?.length || 0);
      
      // Log all assets
      if (accountData.balances && accountData.balances.length > 0) {
        console.log('[Binance Account] 📊 All assets from Binance testnet:');
        accountData.balances.forEach((balance, index) => {
          const total = parseFloat(balance.free) + parseFloat(balance.locked);
          if (total > 0) { // Only show assets with balance
            console.log(`[Binance Account] Asset ${index + 1}: ${balance.asset} - Free: ${balance.free}, Locked: ${balance.locked}, Total: ${total.toFixed(8)}`);
          }
        });
      }
      
      res.json({ success: true, data: accountData });
      
    } catch (binanceError) {
      console.warn('[Binance Account] ⚠️ Binance API not accessible, using fallback data:', binanceError.message);
      
      // Fallback: Return mock data when Binance API is not accessible
      const fallbackData = {
        accountType: 'SPOT',
        balances: [
          { asset: 'USDT', free: '1000.00000000', locked: '0.00000000' },
          { asset: 'BTC', free: '0.01000000', locked: '0.00000000' },
          { asset: 'ETH', free: '0.10000000', locked: '0.00000000' }
        ],
        canTrade: true,
        canWithdraw: true,
        canDeposit: true
      };
      
      console.log('[Binance Account] 📊 Using fallback account data (Binance API unavailable)');
      res.json({ 
        success: true, 
        data: fallbackData,
        warning: 'Using fallback data - Binance API not accessible'
      });
    }
    
    } else {
      // For mainnet, return mock data
      const mockAccountInfo = {
        accountType: 'SPOT',
        balances: [
          {
            asset: 'USDT',
            free: '10000.00000000',
            locked: '0.00000000'
          },
          {
            asset: 'BTC',
            free: '0.10000000',
            locked: '0.00000000'
          }
        ],
        permissions: ['SPOT'],
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now()
      };
      
      res.json({ success: true, data: mockAccountInfo });
    }
  } catch (error) {
    console.error('Error fetching account info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance allOrders endpoint (GET)
app.get('/api/binance/allOrders', async (req, res) => {
  try {
    const { symbol, limit = 10, tradingMode = 'testnet' } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }
    
    console.log(`[PROXY] 📊 GET /api/binance/allOrders - Symbol: ${symbol}, Limit: ${limit}, Mode: ${tradingMode}`);
    
    if (tradingMode === 'testnet') {
      // Use actual Binance testnet API keys
      const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
      const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
      
      const binanceUrl = 'https://testnet.binance.vision';
      const timestamp = Date.now();
      
      // Create signature for authentication
      const crypto = require('crypto');
      const queryString = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
      
      const finalQueryString = `${queryString}&signature=${signature}`;
      const ordersUrl = `${binanceUrl}/api/v3/allOrders?${finalQueryString}`;
      
      console.log('[PROXY] 📊 Orders URL:', ordersUrl);
      
      // Make the request to Binance
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(ordersUrl);
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/json'
        }
      };
      
      const binanceRequest = https.request(requestOptions, (binanceResponse) => {
        let data = '';
        
        binanceResponse.on('data', (chunk) => {
          data += chunk;
        });
        
        binanceResponse.on('end', () => {
          console.log('[PROXY] 📊 Binance orders response status:', binanceResponse.statusCode);
          console.log('[PROXY] 📊 Binance orders response data:', data);
          
          try {
            const responseData = JSON.parse(data);
            
            if (binanceResponse.statusCode === 200) {
              res.json({
                success: true,
                data: responseData,
                message: 'Orders retrieved successfully'
              });
            } else {
              res.status(binanceResponse.statusCode).json({
                success: false,
                error: responseData.msg || 'Failed to retrieve orders',
                details: responseData
              });
            }
          } catch (parseError) {
            console.error('[PROXY] Error parsing Binance response:', parseError);
            res.status(500).json({ success: false, error: 'Failed to parse Binance response' });
          }
        });
      });
      
      binanceRequest.on('error', (error) => {
        console.error('[PROXY] Error making request to Binance:', error);
        res.status(500).json({ success: false, error: error.message });
      });
      
      binanceRequest.end();
    } else {
      // Mock response for mainnet
      res.json({
        success: true,
        data: []
      });
    }
  } catch (error) {
    console.error('[PROXY] Error fetching all orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance order endpoint (GET - for checking order status)
app.get('/api/binance/order', async (req, res) => {
  try {
    const { symbol, orderId, tradingMode = 'testnet' } = req.query;
    
    if (!symbol || !orderId) {
      return res.status(400).json({ success: false, error: 'Symbol and orderId are required' });
    }
    
    console.log(`[PROXY] 📊 GET /api/binance/order - Symbol: ${symbol}, OrderId: ${orderId}, Mode: ${tradingMode}`);
    
    if (tradingMode === 'testnet') {
      // Use actual Binance testnet API keys
      const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
      const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
      
      const binanceUrl = 'https://testnet.binance.vision';
      const timestamp = Date.now();
      
      // Create signature for authentication
      const crypto = require('crypto');
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', testnetApiSecret).update(queryString).digest('hex');
      
      const finalQueryString = `${queryString}&signature=${signature}`;
      const orderUrl = `${binanceUrl}/api/v3/order?${finalQueryString}`;
      
      console.log('[PROXY] 📊 Order URL:', orderUrl);
      
      // Make the request to Binance
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(orderUrl);
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/json'
        }
      };
      
      const binanceRequest = https.request(requestOptions, (binanceResponse) => {
        let data = '';
        
        binanceResponse.on('data', (chunk) => {
          data += chunk;
        });
        
        binanceResponse.on('end', () => {
          console.log('[PROXY] 📊 Binance order response status:', binanceResponse.statusCode);
          console.log('[PROXY] 📊 Binance order response data:', data);
          
          try {
            const responseData = JSON.parse(data);
            
            if (binanceResponse.statusCode === 200) {
              res.json({
                success: true,
                data: responseData,
                message: 'Order retrieved successfully'
              });
            } else {
              res.status(binanceResponse.statusCode).json({
                success: false,
                error: responseData.msg || 'Failed to retrieve order',
                details: responseData
              });
            }
          } catch (parseError) {
            console.error('[PROXY] Error parsing Binance response:', parseError);
            res.status(500).json({ success: false, error: 'Failed to parse Binance response' });
          }
        });
      });
      
      binanceRequest.on('error', (error) => {
        console.error('[PROXY] Error making request to Binance:', error);
        res.status(500).json({ success: false, error: error.message });
      });
      
      binanceRequest.end();
    } else {
      // Mock response for mainnet
      res.json({
        success: true,
        data: {
          symbol: symbol,
          orderId: orderId,
          status: 'FILLED'
        }
      });
    }
  } catch (error) {
    console.error('[PROXY] Error fetching order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance order endpoint (for trading)
app.post('/api/binance/order', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'testnet';
    const binanceUrl = getBinanceUrl(tradingMode);
    
    console.log('[PROXY] 📊 POST /api/binance/order - Request body:', JSON.stringify(req.body, null, 2));
    console.log('[PROXY] 📊 Trading mode:', tradingMode);
    console.log('[PROXY] 📊 Binance URL:', binanceUrl);
    
    // Use actual Binance testnet API keys
    const testnetApiKey = 'egRLs4wllEGNdxdESBcYUkVC2DW3FNRoEereM8BxogrT7fOhmVibwpPELvG6mCnA';
    const testnetApiSecret = 'FSVf9OYP2SY0ytqqIbQVjLpB4njS3usJNktd8pMlabzTBhE5HR1Cik04fv6D6EWM';
    
    if (tradingMode === 'testnet') {
      console.log('[PROXY] 🔄 Creating order on Binance testnet...');
      
      // Extract order parameters from request body
      const { symbol, side, type, quantity, price, timeInForce } = req.body;
      
      if (!symbol || !side || !type || !quantity) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required order parameters: symbol, side, type, quantity' 
        });
      }
      
      // Create timestamp
      const timestamp = Date.now();
      
      // Build query string for signature
      const queryParams = new URLSearchParams({
        symbol: symbol,
        side: side,
        type: type,
        quantity: quantity,
        timestamp: timestamp
      });
      
      if (price) queryParams.append('price', price);
      if (timeInForce) queryParams.append('timeInForce', timeInForce);
      
      const queryString = queryParams.toString();
      
      // Create signature
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', testnetApiSecret)
        .update(queryString)
        .digest('hex');
      
      const finalQueryString = `${queryString}&signature=${signature}`;
      const orderUrl = `${binanceUrl}/api/v3/order?${finalQueryString}`;
      
      console.log('[PROXY] 🔄 Order URL:', orderUrl);
      
      // Make the request to Binance
      const options = {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': testnetApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };
      
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(orderUrl);
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'POST',
        headers: options.headers
      };
      
      const binanceRequest = https.request(requestOptions, (binanceResponse) => {
        let data = '';
        
        binanceResponse.on('data', (chunk) => {
          data += chunk;
        });
        
        binanceResponse.on('end', () => {
          console.log('[PROXY] 📊 Binance order response status:', binanceResponse.statusCode);
          console.log('[PROXY] 📊 Binance order response data:', data);
          
          try {
            const responseData = JSON.parse(data);
            
            if (binanceResponse.statusCode === 200) {
              res.json({ 
                success: true, 
                data: responseData,
                message: 'Order created successfully'
              });
            } else {
              res.status(binanceResponse.statusCode).json({ 
                success: false, 
                error: responseData.msg || 'Order creation failed',
                details: responseData
              });
            }
          } catch (parseError) {
            console.error('[PROXY] ❌ Failed to parse Binance response:', parseError);
            res.status(500).json({ 
              success: false, 
              error: 'Failed to parse Binance response',
              rawResponse: data
            });
          }
        });
      });
      
      binanceRequest.on('error', (error) => {
        console.error('[PROXY] ❌ Binance request error:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to connect to Binance',
          details: error.message
        });
      });
      
      binanceRequest.end();
      
    } else {
      // For mainnet, return mock response for now
      res.json({ 
        success: true, 
        message: 'Mainnet trading not implemented in development mode',
        data: {
          symbol: req.body.symbol,
          orderId: Math.floor(Math.random() * 1000000),
          status: 'FILLED'
        }
      });
    }
    
  } catch (error) {
    console.error('[PROXY] ❌ Error processing order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Binance dust convert endpoint
app.post('/api/binance/dustConvert', async (req, res) => {
  try {
    const tradingMode = req.query.tradingMode || 'mainnet';
    const binanceUrl = getBinanceUrl(tradingMode);
    
    // This would need proper authentication in a real implementation
    res.json({ success: true, message: 'Dust convert endpoint - authentication required' });
  } catch (error) {
    console.error('Error processing dust convert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// In-memory storage for local development
let scanSettings = [];
let walletSummaries = [];
let historicalPerformances = [];
let centralWalletStates = [];

// Entity endpoints for local development
// Specific entity endpoints that the app expects

app.get('/api/walletSummaries', (req, res) => {
  console.log('[PROXY] 📊 GET /api/walletSummaries - Query params:', req.query);
  
  // Ensure walletSummaries is always an array
  let summariesArray = Array.isArray(walletSummaries) ? walletSummaries : [walletSummaries].filter(Boolean);
  console.log('[PROXY] 📊 GET /api/walletSummaries - Total summaries in memory:', summariesArray.length);
  
  let filteredSummaries = summariesArray;
  
  // Handle filtering by trading_mode
  if (req.query.trading_mode) {
    filteredSummaries = summariesArray.filter(ws => ws.trading_mode === req.query.trading_mode);
    console.log('[PROXY] 📊 GET /api/walletSummaries - Filtered by trading_mode:', req.query.trading_mode, 'Found:', filteredSummaries.length);
  }
  
  // Handle ordering
  if (req.query.orderBy) {
    const orderBy = req.query.orderBy;
    const direction = orderBy.startsWith('-') ? -1 : 1;
    const key = orderBy.replace(/^-/, '');
    filteredSummaries.sort((a, b) => {
      if (a[key] < b[key]) return -1 * direction;
      if (a[key] > b[key]) return 1 * direction;
      return 0;
    });
    console.log('[PROXY] 📊 GET /api/walletSummaries - Ordered by:', orderBy);
  }
  
  // Handle limit
  if (req.query.limit) {
    const limit = parseInt(req.query.limit, 10);
    filteredSummaries = filteredSummaries.slice(0, limit);
    console.log('[PROXY] 📊 GET /api/walletSummaries - Limited to:', limit);
  }
  
  console.log('[PROXY] 📊 GET /api/walletSummaries - Returning filtered summaries:', filteredSummaries.length);
  res.json({ success: true, data: filteredSummaries });
});

app.post('/api/walletSummaries', (req, res) => {
  // For local development, store in memory
  console.log('[PROXY] 📊 POST /api/walletSummaries - Request body:', JSON.stringify(req.body, null, 2));
  const newWalletSummary = {
    id: Math.random().toString(36).substr(2, 9),
    ...req.body,
    created_date: new Date().toISOString()
  };
  walletSummaries.push(newWalletSummary);
  
  // Save to persistent storage
  try {
    saveStoredData('walletSummaries', walletSummaries);
    console.log('[PROXY] 📊 Saved new wallet summary to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving wallet summary to storage:', error);
  }
  
  console.log('[PROXY] 📊 POST /api/walletSummaries - Stored summary:', JSON.stringify(newWalletSummary, null, 2));
  console.log('[PROXY] 📊 POST /api/walletSummaries - Total summaries in memory:', walletSummaries.length);
  res.json({ success: true, data: newWalletSummary });
});

app.put('/api/walletSummaries/:id', (req, res) => {
  // For local development, update in memory
  const { id } = req.params;
  console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Request body:', JSON.stringify(req.body, null, 2));
  
  // Validate the request body
  const validationErrors = validateWalletSummary(req.body);
  if (validationErrors.length > 0) {
    console.error('[PROXY] ❌ Validation errors:', validationErrors);
    return res.status(400).json({ 
      success: false, 
      error: 'Validation failed', 
      details: validationErrors 
    });
  }
  
  // Ensure walletSummaries is always an array
  let summariesArray = Array.isArray(walletSummaries) ? walletSummaries : [walletSummaries].filter(Boolean);
  const index = summariesArray.findIndex(ws => ws.id === id);
  if (index !== -1) {
    summariesArray[index] = {
      ...summariesArray[index],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Update the global walletSummaries variable
    walletSummaries = summariesArray;
    
    // Save to persistent storage
    try {
      saveStoredData('walletSummaries', walletSummaries);
      console.log('[PROXY] 📊 Saved updated wallet summary to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated wallet summary to storage:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save to storage', 
        details: error.message 
      });
    }
    
    console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Updated summary:', JSON.stringify(summariesArray[index], null, 2));
    res.json({ success: true, data: summariesArray[index] });
  } else {
    console.log('[PROXY] 📊 PUT /api/walletSummaries/:id - Summary not found:', id);
    res.status(404).json({ success: false, error: 'WalletSummary not found' });
  }
});

app.delete('/api/walletSummaries/:id', (req, res) => {
  // For local development, delete from memory
  const { id } = req.params;
  console.log('[PROXY] 📊 DELETE /api/walletSummaries/:id - Deleting summary:', id);
  const index = walletSummaries.findIndex(ws => ws.id === id);
  if (index !== -1) {
    const deletedSummary = walletSummaries.splice(index, 1)[0];
    
    // Save to persistent storage
    try {
      saveStoredData('walletSummaries', walletSummaries);
      console.log('[PROXY] 📊 Saved wallet summaries after deletion to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving wallet summaries after deletion to storage:', error);
    }
    
    console.log('[PROXY] 📊 DELETE /api/walletSummaries/:id - Deleted summary:', JSON.stringify(deletedSummary, null, 2));
    console.log('[PROXY] 📊 DELETE /api/walletSummaries/:id - Remaining summaries:', walletSummaries.length);
    res.json({ success: true, data: deletedSummary });
  } else {
    console.log('[PROXY] 📊 DELETE /api/walletSummaries/:id - Summary not found:', id);
    res.status(404).json({ success: false, error: 'WalletSummary not found' });
  }
});

// CentralWalletState endpoints
app.get('/api/centralWalletStates', (req, res) => {
  console.log('[PROXY] 📊 GET /api/centralWalletStates - Query params:', req.query);
  
  // Ensure centralWalletStates is always an array
  let statesArray = Array.isArray(centralWalletStates) ? centralWalletStates : [centralWalletStates].filter(Boolean);
  console.log('[PROXY] 📊 GET /api/centralWalletStates - Total states in memory:', statesArray.length);
  
  let filteredStates = statesArray;
  
  // Handle filtering by trading_mode
  if (req.query.trading_mode) {
    filteredStates = statesArray.filter(ws => ws.trading_mode === req.query.trading_mode);
    console.log('[PROXY] 📊 GET /api/centralWalletStates - Filtered by trading_mode:', req.query.trading_mode, 'Found:', filteredStates.length);
  }
  
  // Handle ordering
  if (req.query.orderBy) {
    const orderBy = req.query.orderBy;
    const direction = orderBy.startsWith('-') ? -1 : 1;
    const key = orderBy.replace(/^-/, '');
    filteredStates = filteredStates.sort((a, b) => {
      if (a[key] < b[key]) return -1 * direction;
      if (a[key] > b[key]) return 1 * direction;
      return 0;
    });
    console.log('[PROXY] 📊 GET /api/centralWalletStates - Ordered by:', orderBy);
  }
  
  // Handle limit
  if (req.query.limit) {
    const limit = parseInt(req.query.limit, 10);
    filteredStates = filteredStates.slice(0, limit);
    console.log('[PROXY] 📊 GET /api/centralWalletStates - Limited to:', limit);
  }
  
  console.log('[PROXY] 📊 GET /api/centralWalletStates - Returning filtered states:', filteredStates.length);
  res.json({ success: true, data: filteredStates });
});

app.post('/api/centralWalletStates', (req, res) => {
  console.log('[PROXY] 📊 POST /api/centralWalletStates - Request body:', JSON.stringify(req.body, null, 2));
  const newState = {
    id: Math.random().toString(36).substr(2, 9),
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  centralWalletStates.push(newState);
  
  // Save to persistent storage
  try {
    saveStoredData('centralWalletStates', centralWalletStates);
    console.log('[PROXY] 📊 Saved new central wallet state to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving central wallet state to storage:', error);
  }
  
  console.log('[PROXY] 📊 POST /api/centralWalletStates - Stored state:', JSON.stringify(newState, null, 2));
  console.log('[PROXY] 📊 POST /api/centralWalletStates - Total states in memory:', centralWalletStates.length);
  res.json({ success: true, data: newState });
});

app.put('/api/centralWalletStates/:id', (req, res) => {
  const { id } = req.params;
  console.log('[PROXY] 📊 PUT /api/centralWalletStates/:id - Request body:', JSON.stringify(req.body, null, 2));
  
  // Ensure centralWalletStates is always an array
  let statesArray = Array.isArray(centralWalletStates) ? centralWalletStates : [centralWalletStates].filter(Boolean);
  const index = statesArray.findIndex(ws => ws.id === id);
  if (index !== -1) {
    statesArray[index] = {
      ...statesArray[index],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Update the global centralWalletStates variable
    centralWalletStates = statesArray;
    
    // Save to persistent storage
    try {
      saveStoredData('centralWalletStates', centralWalletStates);
      console.log('[PROXY] 📊 Saved updated central wallet state to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated central wallet state to storage:', error);
    }
    
    console.log('[PROXY] 📊 PUT /api/centralWalletStates/:id - Updated state:', JSON.stringify(statesArray[index], null, 2));
    res.json({ success: true, data: statesArray[index] });
  } else {
    console.log('[PROXY] 📊 PUT /api/centralWalletStates/:id - State not found:', id);
    res.status(404).json({ success: false, error: 'CentralWalletState not found' });
  }
});

app.delete('/api/centralWalletStates/:id', (req, res) => {
  const { id } = req.params;
  console.log('[PROXY] 📊 DELETE /api/centralWalletStates/:id - Deleting state:', id);
  const index = centralWalletStates.findIndex(ws => ws.id === id);
  if (index !== -1) {
    const deletedState = centralWalletStates.splice(index, 1)[0];
    
    // Save to persistent storage
    try {
      saveStoredData('centralWalletStates', centralWalletStates);
      console.log('[PROXY] 📊 Saved central wallet states after deletion to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving central wallet states after deletion to storage:', error);
    }
    
    console.log('[PROXY] 📊 DELETE /api/centralWalletStates/:id - Deleted state:', JSON.stringify(deletedState, null, 2));
    console.log('[PROXY] 📊 DELETE /api/centralWalletStates/:id - Remaining states:', centralWalletStates.length);
    res.json({ success: true, data: deletedState });
  } else {
    console.log('[PROXY] 📊 DELETE /api/centralWalletStates/:id - State not found:', id);
    res.status(404).json({ success: false, error: 'CentralWalletState not found' });
  }
});

app.get('/api/optedOutCombinations', (req, res) => {
  res.json({ success: true, data: [] });
});




app.get('/api/historicalPerformance', (req, res) => {
  res.json({ success: true, data: [] });
});

// GET /api/trades - Get trades (REMOVED - duplicate endpoint)

// POST /api/trades - Create new trade records (REMOVED - duplicate endpoint)

// Fear & Greed Index endpoint
app.get('/api/fearAndGreed', async (req, res) => {
  try {
    console.log('[PROXY] 📊 GET /api/fearAndGreed - Fetching Fear & Greed Index...');
    
    // Try to fetch from the real API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch('https://api.alternative.me/fng/', {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CryptoSentinel/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[PROXY] 📊 GET /api/fearAndGreed - Successfully fetched from API');
      
      res.json({
        success: true,
        data: data
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.warn('[PROXY] 📊 GET /api/fearAndGreed - API fetch failed, using fallback:', fetchError.message);
      
      // Return fallback data
      res.json({
        success: true,
        data: {
          name: 'Fear and Greed Index',
          data: [{
            value: '50',
            value_classification: 'Neutral',
            timestamp: Math.floor(Date.now() / 1000).toString(),
            time_until_update: '3600'
          }],
          metadata: {
            error: 'Using fallback data due to API unavailability'
          }
        }
      });
    }
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching Fear & Greed Index:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store LivePosition entities in persistent file storage
let livePositions = [];

// Add logging wrapper to detect when array is cleared
const originalLog = console.log;
let arrayClearLogCount = 0;
function logArrayChange(operation, newLength, oldLength) {
    arrayClearLogCount++;
    if (arrayClearLogCount <= 5 || arrayClearLogCount % 100 === 0) {
        //console.log(`[POSITION_DEBUG] PROXY: livePositions array ${operation}: ${oldLength} -> ${newLength}`);
        if (newLength === 0 && oldLength > 0) {
            console.log(`[POSITION_DEBUG] PROXY: ⚠️⚠️⚠️ ARRAY CLEARED! Stack trace:`, new Error().stack);
        }
    }
}

// Load existing positions from database and file storage on startup
async function loadLivePositions() {
    //console.log('[POSITION_DEBUG] PROXY: loadLivePositions() CALLED - Stack trace:', new Error().stack.split('\n').slice(1, 4).join('\n'));
    try {
        // Try to load from database first
        const dbPositions = await loadLivePositionsFromDB();
        if (dbPositions.length > 0) {
            const oldLength = livePositions.length;
            livePositions = dbPositions;
            logArrayChange('LOADED_FROM_DB', livePositions.length, oldLength);
            console.log(`[PROXY] 📊 Loaded ${livePositions.length} existing positions from database`);
            
            // Sync to file storage as backup
            saveStoredData('livePositions', livePositions);
            console.log(`[PROXY] 📊 Synced positions to file storage as backup`);
        } else {
            // Fallback to file storage
            const oldLength = livePositions.length;
            livePositions = getStoredData('livePositions');
            logArrayChange('LOADED_FROM_FILE', livePositions.length, oldLength);
            console.log(`[PROXY] 📊 Loaded ${livePositions.length} existing positions from file storage`);
            
            // Sync to database if we have positions
            if (livePositions.length > 0) {
                console.log(`[PROXY] 📊 Syncing ${livePositions.length} positions to database...`);
                for (const position of livePositions) {
                    await saveLivePositionToDB(position);
                }
            }
        }
    } catch (error) {
        console.error('[PROXY] Error loading positions:', error);
        const oldLength = livePositions.length;
        livePositions = [];
        logArrayChange('CLEARED_ON_ERROR', 0, oldLength);
    }
}

// Store ScanSettings entities in persistent file storage

// Load existing scan settings from file storage on startup
try {
  scanSettings = getStoredData('scanSettings');
  console.log(`[PROXY] 📊 Loaded ${scanSettings.length} existing scan settings from storage`);
} catch (error) {
  console.error('[PROXY] Error loading scan settings from storage:', error);
  scanSettings = [];
}

// Load existing wallet summaries from file storage on startup
try {
  walletSummaries = getStoredData('walletSummaries');
  console.log(`[PROXY] 📊 Loaded ${walletSummaries.length} existing wallet summaries from storage`);
} catch (error) {
  console.error('[PROXY] Error loading wallet summaries from storage:', error);
  walletSummaries = [];
}


// Load existing historical performances from file storage on startup
try {
  historicalPerformances = getStoredData('historicalPerformances');
  console.log(`[PROXY] 📊 Loaded ${historicalPerformances.length} existing historical performances from storage`);
} catch (error) {
  console.error('[PROXY] Error loading historical performances from storage:', error);
  historicalPerformances = [];
}

// Load existing central wallet states from file storage on startup
try {
  centralWalletStates = getStoredData('centralWalletStates');
  console.log(`[PROXY] 📊 Loaded ${centralWalletStates.length} existing central wallet states from storage`);
} catch (error) {
  console.error('[PROXY] Error loading central wallet states from storage:', error);
  centralWalletStates = [];
}

// Store Strategy entities in persistent file storage
let strategies = [];

// Load existing strategies from file storage on startup
try {
  strategies = getStoredData('strategies');
  console.log(`[PROXY] 📊 Loaded ${strategies.length} existing strategies from storage`);
} catch (error) {
  console.error('[PROXY] Error loading strategies from storage:', error);
  strategies = [];
}

app.get('/api/livePositions', async (req, res) => {
  const endpointStartTime = Date.now();
  const endpointStartISO = new Date(endpointStartTime).toISOString();
  
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 ========================================`);
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 GET /api/livePositions received at ${endpointStartISO}`);
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📋 Query params:`, JSON.stringify(req.query));
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📝 Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  
  // CRITICAL FIX: Always reload from database if DB client is available
  // This ensures we get the most up-to-date positions, especially for newly created positions
  // that might not be in the in-memory array yet due to timing/race conditions
  if (dbClient) {
    try {
      const dbPositions = await loadLivePositionsFromDB();
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📊 Database query returned ${dbPositions.length} positions`);
      if (dbPositions.length > 0) {
        dbPositions.slice(0, 2).forEach((pos, idx) => {
          //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📊 DB Position ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}, wallet_id=${pos.wallet_id || 'NULL'}`);
        });
      } else {
        //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ⚠️ Database query returned 0 positions!`);
      }
        const oldLength = livePositions.length;
      
      // CRITICAL FIX: If DB returns 0 positions but memory has positions, preserve memory positions
      // This handles the case where positions were just created and aren't visible in DB yet due to transaction isolation
      if (dbPositions.length === 0 && oldLength > 0) {
        console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ⚠️ DB returned 0 but memory has ${oldLength} positions. Preserving memory positions to prevent data loss.`);
        //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔒 Keeping ${oldLength} memory positions (transaction isolation delay - DB will catch up)`);
        // Keep existing positions - don't overwrite with 0
        // The DB query will eventually see the positions once the transaction is fully committed
      } else if (dbPositions.length < oldLength && oldLength > 0) {
        // DB has fewer positions than memory - merge to preserve recent positions
        const now = Date.now();
        const recentThreshold = 30000; // 30 seconds - more generous threshold
        
        // Find positions in memory that aren't in DB
        const memoryPositionsNotInDB = livePositions.filter(memPos => {
          const notInDB = !dbPositions.find(dbPos => dbPos.id === memPos.id || dbPos.position_id === memPos.position_id);
          if (notInDB) {
            // Check if position is recent (within threshold) or if created_date is missing (assume recent)
            const createdDateStr = memPos.created_date || memPos.created_date_iso || memPos.createdDate;
            if (!createdDateStr) {
              // No created_date - assume it's recent and preserve it
              return true;
            }
            const createdTime = new Date(createdDateStr).getTime();
            if (isNaN(createdTime)) {
              // Invalid date - assume it's recent and preserve it
              return true;
            }
            const age = now - createdTime;
            return age < recentThreshold;
          }
          return false;
        });
        
        if (memoryPositionsNotInDB.length > 0) {
          console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ⚠️ GET: DB=${dbPositions.length}, Memory=${oldLength}. Merging ${memoryPositionsNotInDB.length} recent positions...`);
          // Merge: combine DB positions with recent memory positions
          const dbIds = new Set(dbPositions.map(p => p.id));
          const mergedPositions = [...dbPositions];
          for (const memPos of memoryPositionsNotInDB) {
            if (!dbIds.has(memPos.id)) {
              mergedPositions.push(memPos);
            }
          }
          livePositions = mergedPositions;
          //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ✅ GET Merged: ${dbPositions.length} DB + ${memoryPositionsNotInDB.length} recent = ${livePositions.length} total`);
          logArrayChange('RELOAD_FROM_DB_ON_GET_MERGED', livePositions.length, oldLength);
      } else {
          // No recent positions to merge, but DB has some - use DB
          livePositions = dbPositions;
          logArrayChange('RELOAD_FROM_DB_ON_GET', livePositions.length, oldLength);
        }
      } else if (dbPositions.length !== oldLength || dbPositions.length > 0) {
        // Normal case: DB has same or more positions, or we have positions
        livePositions = dbPositions;
        logArrayChange('RELOAD_FROM_DB_ON_GET', livePositions.length, oldLength);
      }
    } catch (error) {
      console.error('[POSITION_DEBUG] PROXY: ❌ Error reloading positions:', error);
      // Continue with in-memory array if DB reload fails
    }
  }
  
  // Positions loaded from DB (with merge logic if needed)
  
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📊 After DB reload: livePositions.length = ${livePositions.length}`);
  if (livePositions.length > 0) {
    livePositions.slice(0, 2).forEach((pos, idx) => {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📊 Memory Position ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}, wallet_id=${pos.wallet_id || 'NULL'}`);
    });
  }
  
  let filteredPositions = [...livePositions];
  
  console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Starting with ${filteredPositions.length} positions before filtering`);
  
  // Apply filters from query parameters
  if (req.query.trading_mode) {
    const beforeCount = filteredPositions.length;
    filteredPositions = filteredPositions.filter(pos => pos.trading_mode === req.query.trading_mode);
    if (beforeCount > filteredPositions.length) {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Trading mode filter: ${beforeCount} → ${filteredPositions.length} (filtered for mode=${req.query.trading_mode})`);
    }
  }
  
  if (req.query.status) {
    const beforeCount = filteredPositions.length;
    // Handle both array (multiple query params) and single value
    const statusArray = Array.isArray(req.query.status) 
      ? req.query.status 
      : (typeof req.query.status === 'string' && req.query.status.includes(','))
        ? req.query.status.split(',')
        : [req.query.status];
    filteredPositions = filteredPositions.filter(pos => {
      const posStatus = pos.status || 'open';
      const matches = statusArray.includes(posStatus);
      if (!matches && beforeCount > 0) {
        //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Status filter: position ${pos.id?.substring(0, 8)} has status=${pos.status || 'NULL'} (defaulted to 'open'), looking for [${statusArray.join(',')}]`);
      }
      return matches;
    });
    if (beforeCount > filteredPositions.length) {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Status filter: ${beforeCount} → ${filteredPositions.length} (filtered for status=[${statusArray.join(',')}])`);
    }
  }
  
  if (req.query.wallet_id) {
    const beforeCount = filteredPositions.length;
    filteredPositions = filteredPositions.filter(pos => {
      const matches = pos.wallet_id === req.query.wallet_id;
      if (!matches && beforeCount > 0) {
        //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Wallet filter: position ${pos.id?.substring(0, 8)} has wallet_id=${pos.wallet_id || 'NULL'}, looking for ${req.query.wallet_id}`);
      }
      return matches;
    });
    if (beforeCount > filteredPositions.length) {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Wallet filter: ${beforeCount} → ${filteredPositions.length} (filtered for wallet_id=${req.query.wallet_id})`);
    }
  }
  
  // Apply ordering
  if (req.query.orderBy) {
    const orderBy = req.query.orderBy;
    const direction = orderBy.startsWith('-') ? -1 : 1;
    const key = orderBy.replace(/^-/, '');
    filteredPositions.sort((a, b) => {
      const valA = a[key] ? new Date(a[key]).getTime() : (direction === -1 ? -Infinity : Infinity);
      const valB = b[key] ? new Date(b[key]).getTime() : (direction === -1 ? -Infinity : Infinity);
      return (valA - valB) * direction;
    });
  }
  
  // Apply limit
  if (req.query.limit) {
    const limit = parseInt(req.query.limit, 10);
    filteredPositions = filteredPositions.slice(0, limit);
  }
  
  const endpointEndTime = Date.now();
  const endpointDuration = endpointEndTime - endpointStartTime;
  const endpointEndISO = new Date(endpointEndTime).toISOString();
  
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 📤 Sending response: ${filteredPositions.length} positions`);
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ⏱️ Total endpoint time: ${endpointDuration}ms`);
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ⏰ Response sent at ${endpointEndISO}`);
  if (filteredPositions.length > 0) {
    filteredPositions.slice(0, 3).forEach((pos, idx) => {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Returning position ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}`);
    });
  } else if (livePositions.length > 0) {
    //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ❌ Filter: 0 positions (all ${livePositions.length} filtered out)`);
    livePositions.slice(0, 3).forEach(pos => {
      //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] 🔍 Sample position: id=${pos.id?.substring(0, 8)}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}, symbol=${pos.symbol || 'NULL'}`);
    });
  }
  //console.log(`[POSITION_DEBUG] [GET_LIVEPOSITIONS] ✅ ========================================`);
  
  res.json({ success: true, data: filteredPositions });
});

app.post('/api/livePositions', async (req, res) => {
  const newPosition = {
    id: req.body.id || uuidv4(), // Use provided ID or generate UUID
    ...req.body,
    created_date: req.body.created_date || new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  //console.log(`[POSITION_CREATE] Creating: ${newPosition.symbol} (${newPosition.id?.substring(0, 8)})`);
  
  const oldLength = livePositions.length;
  livePositions.push(newPosition);
  logArrayChange('PUSH', livePositions.length, oldLength);
  
  // Save to database
  const dbSaved = await saveLivePositionToDB(newPosition);
  if (!dbSaved) {
    console.error(`[POSITION_CREATE] ❌ Failed to save ${newPosition.symbol} to database!`);
  }
  
  // Save to persistent file storage as backup
  try {
    saveStoredData('livePositions', livePositions);
  } catch (error) {
    console.error('[POSITION_CREATE] ❌ Error saving to file storage:', error.message);
  }
  
  // Verify position is queryable immediately after save
  if (dbClient && dbSaved) {
    setTimeout(async () => {
      try {
        const verifyQuery = 'SELECT id, symbol, status, trading_mode FROM live_positions WHERE id = $1';
        const verifyResult = await dbClient.query(verifyQuery, [newPosition.id]);
        if (verifyResult.rows.length > 0) {
          const found = verifyResult.rows[0];
          //console.log(`[POSITION_CREATE] ✅ Position queryable in DB: ${found.symbol} status=${found.status} mode=${found.trading_mode}`);
        } else {
          console.error(`[POSITION_CREATE] ❌ Position NOT queryable in DB! ID: ${newPosition.id}`);
        }
      } catch (error) {
        console.error('[POSITION_CREATE] ❌ Error verifying position:', error.message);
      }
    }, 200);
  }
  
  res.json({ success: true, data: newPosition });
});

// Add support for filtering LivePosition entities
app.get('/api/livePositions/filter', (req, res) => {
  const { wallet_id, trading_mode, status } = req.query;
  
  console.log('[PROXY] 📊 GET /api/livePositions/filter - Filters:', { wallet_id, trading_mode, status });
  
  let filteredPositions = [...livePositions];
  
  // Apply filters
  if (wallet_id) {
    filteredPositions = filteredPositions.filter(pos => pos.wallet_id === wallet_id);
  }
  
  if (trading_mode) {
    filteredPositions = filteredPositions.filter(pos => pos.trading_mode === trading_mode);
  }
  
  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    filteredPositions = filteredPositions.filter(pos => statusArray.includes(pos.status));
  }
  
  console.log('[PROXY] 📊 Filtered positions:', filteredPositions.length);
  res.json({ success: true, data: filteredPositions });
});

// Add support for updating LivePosition entities
app.put('/api/livePositions/:id', (req, res) => {
  const positionId = req.params.id;
  const updateData = req.body;
  
  console.log('[PROXY] 📊 PUT /api/livePositions/' + positionId + ' - Updating position');
  
  const positionIndex = livePositions.findIndex(pos => pos.id === positionId);
  
  if (positionIndex === -1) {
    return res.status(404).json({ success: false, error: 'Position not found' });
  }
  
  // Update the position
  livePositions[positionIndex] = {
    ...livePositions[positionIndex],
    ...updateData,
    updated_date: new Date().toISOString()
  };
  
  // Save to persistent storage
  try {
    saveStoredData('livePositions', livePositions);
    console.log('[PROXY] 📊 Saved updated positions to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving updated positions to storage:', error);
  }
  
  console.log('[PROXY] 📊 Updated position:', positionId);
  res.json({ success: true, data: livePositions[positionIndex] });
});

// Add support for deleting LivePosition entities
app.delete('/api/livePositions/:id', async (req, res) => {
  const positionId = req.params.id;
  
  console.log('[PROXY] 📊 DELETE /api/livePositions/' + positionId + ' - Deleting position');
  
  const positionIndex = livePositions.findIndex(pos => pos.id === positionId);
  
  if (positionIndex === -1) {
    return res.status(404).json({ success: false, error: 'Position not found' });
  }
  
  const deletedPosition = livePositions.splice(positionIndex, 1)[0];
  
  // Delete from database
  const dbDeleted = await deleteLivePositionFromDB(positionId);
  
  // Save to persistent storage
  try {
    saveStoredData('livePositions', livePositions);
    console.log('[PROXY] 📊 Saved positions after deletion to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving positions after deletion to storage:', error);
  }
  
  console.log('[PROXY] 📊 Deleted position:', positionId);
  console.log('[PROXY] 📊 Remaining positions:', livePositions.length);
  console.log('[PROXY] 📊 Database delete result:', dbDeleted ? 'success' : 'failed');
  res.json({ success: true, data: deletedPosition });
});

// ScanSettings endpoints
app.get('/api/scanSettings', (req, res) => {
  console.log('[PROXY] 📊 GET /api/scanSettings - Returning settings:', scanSettings.length);
  res.json({ success: true, data: scanSettings });
});

app.post('/api/scanSettings', (req, res) => {
  console.log('[PROXY] 📊 POST /api/scanSettings - Creating new scan settings');
  const newSettings = {
    id: `settings_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  scanSettings.push(newSettings);
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved new scan settings to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving scan settings to storage:', error);
  }
  
  console.log('[PROXY] 📊 Created scan settings with ID:', newSettings.id);
  res.json({ success: true, data: newSettings });
});

app.put('/api/scanSettings/:id', (req, res) => {
  const settingsId = req.params.id;
  console.log('[PROXY] 📊 PUT /api/scanSettings/' + settingsId + ' - Updating scan settings');
  
  const settingsIndex = scanSettings.findIndex(settings => settings.id === settingsId);
  
  if (settingsIndex === -1) {
    return res.status(404).json({ success: false, error: 'Scan settings not found' });
  }
  
  scanSettings[settingsIndex] = {
    ...scanSettings[settingsIndex],
    ...req.body,
    updated_date: new Date().toISOString()
  };
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved updated scan settings to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving updated scan settings to storage:', error);
  }
  
  console.log('[PROXY] 📊 Updated scan settings:', settingsId);
  res.json({ success: true, data: scanSettings[settingsIndex] });
});

app.delete('/api/scanSettings/:id', (req, res) => {
  const settingsId = req.params.id;
  console.log('[PROXY] 📊 DELETE /api/scanSettings/' + settingsId + ' - Deleting scan settings');
  
  const settingsIndex = scanSettings.findIndex(settings => settings.id === settingsId);
  
  if (settingsIndex === -1) {
    return res.status(404).json({ success: false, error: 'Scan settings not found' });
  }
  
  const deletedSettings = scanSettings.splice(settingsIndex, 1)[0];
  
  // Save to persistent storage
  try {
    saveStoredData('scanSettings', scanSettings);
    console.log('[PROXY] 📊 Saved scan settings after deletion to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving scan settings after deletion to storage:', error);
  }
  
  console.log('[PROXY] 📊 Deleted scan settings:', settingsId);
  res.json({ success: true, data: deletedSettings });
});

// Generic entity operations
app.get('/api/entities/:entityName', (req, res) => {
  const entityName = req.params.entityName;
  
  // Handle LivePosition entities
  if (entityName === 'LivePosition') {
    console.log('[PROXY] 📊 GET /api/entities/LivePosition - Returning positions:', livePositions.length);
    res.json({ success: true, data: livePositions });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 GET /api/entities/ScanSettings - Returning settings:', scanSettings.length);
    res.json({ success: true, data: scanSettings });
    return;
  }
  
  // Handle HistoricalPerformance entities
  if (entityName === 'HistoricalPerformance') {
    console.log('[PROXY] 📊 GET /api/entities/HistoricalPerformance - Returning performances:', historicalPerformances.length);
    res.json({ success: true, data: historicalPerformances });
    return;
  }
  
  // Handle CentralWalletState entities
  if (entityName === 'CentralWalletState') {
    console.log('[PROXY] 📊 GET /api/entities/CentralWalletState - Returning states:', centralWalletStates.length);
    res.json({ success: true, data: centralWalletStates });
    return;
  }
  
  // Handle Strategy entities
  if (entityName === 'Strategy') {
    console.log('[PROXY] 📊 GET /api/entities/Strategy - Returning strategies:', strategies.length);
    res.json({ success: true, data: strategies });
    return;
  }
  
  // For local development, return empty arrays for entity lists
  if (entityName === 'OptedOutCombination') {
    res.json({ success: true, data: [] });
  } else {
    res.json({ success: true, data: [] });
  }
});

// Handle entity filtering (used by WalletProvider)
app.post('/api/entities/:entityName/filter', async (req, res) => {
  const entityName = req.params.entityName;
  const nameLc = String(entityName || '').toLowerCase();
  
  //console.log(`[debug_save] [FILTER_ENDPOINT] 🔍 POST /api/entities/${entityName}/filter received`);
  //console.log(`[debug_save] [FILTER_ENDPOINT] 📋 Request body:`, JSON.stringify(req.body));
  //console.log(`[debug_save] [FILTER_ENDPOINT] 📋 Request body type:`, typeof req.body);
  //console.log(`[debug_save] [FILTER_ENDPOINT] 📋 Request body keys:`, Object.keys(req.body || {}));
  //console.log(`[debug_save] [FILTER_ENDPOINT] 📋 Content-Type:`, req.headers['content-type']);
  
  // Handle LivePosition filtering (accept several casings)
  if (nameLc === 'liveposition' || nameLc === 'livepositions') {
    // CRITICAL FIX: Extract directly from req.body to avoid destructuring issues
    const wallet_id = req.body?.wallet_id;
    const trading_mode = req.body?.trading_mode;
    let status = req.body?.status;
    
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 POST /api/entities/LivePosition/filter - Request received`);
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Full req.body (stringified):`, JSON.stringify(req.body));
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 req.body keys:`, req.body ? Object.keys(req.body) : 'null');
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 req.body.status value (direct access):`, req.body?.status);
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 req.body.status type:`, typeof req.body?.status);
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Extracted values: wallet_id=${wallet_id}, trading_mode=${trading_mode}, status=`, status);
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Filter criteria:`, JSON.stringify({ trading_mode, status, wallet_id }));
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Status type: ${Array.isArray(status) ? 'array' : typeof status}, value:`, status);
    
    // CRITICAL FIX: Always reload from database if DB client is available
    // This ensures we get the most up-to-date positions, especially for newly created positions
    // that might not be in the in-memory array yet due to timing/race conditions
    if (dbClient) {
      try {
        // CRITICAL FIX: Add a small delay if we have positions in memory but DB query might be too fast
        // This handles cases where positions were just saved and need a moment to be visible
        if (livePositions.length > 0 && status) {
          // If we're filtering by status and have positions in memory, wait a tiny bit
          // to ensure DB transaction is fully committed and visible
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const dbPositions = await loadLivePositionsFromDB();
          const oldLength = livePositions.length;
        
        // CRITICAL FIX: If DB returns 0 positions but memory has positions, preserve memory positions
        // This handles the case where positions were just created and aren't visible in DB yet due to transaction isolation
        if (dbPositions.length === 0 && oldLength > 0) {
          console.log(`[POSITION_DEBUG] [POSITION_QUERY] ⚠️ Filter: DB returned 0 but memory has ${oldLength} positions. Preserving memory positions to prevent data loss.`);
          //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔒 Keeping ${oldLength} memory positions (transaction isolation delay - DB will catch up)`);
          // Keep existing positions - don't overwrite with 0
          // The DB query will eventually see the positions once the transaction is fully committed
          logArrayChange('RELOAD_FROM_DB_FOR_FILTER_PRESERVED', livePositions.length, oldLength);
        } else if (dbPositions.length < oldLength && oldLength > 0) {
          // DB has fewer positions than memory - merge to preserve recent positions
          const now = Date.now();
          const recentThreshold = 30000; // 30 seconds - more generous threshold
          
          // Find positions in memory that aren't in DB
          const memoryPositionsNotInDB = livePositions.filter(memPos => {
            const notInDB = !dbPositions.find(dbPos => dbPos.id === memPos.id || dbPos.position_id === memPos.position_id);
            if (notInDB) {
              // Check if position is recent (within threshold) or if created_date is missing (assume recent)
              const createdDateStr = memPos.created_date || memPos.created_date_iso || memPos.createdDate;
              if (!createdDateStr) {
                // No created_date - assume it's recent and preserve it
                return true;
              }
              const createdTime = new Date(createdDateStr).getTime();
              if (isNaN(createdTime)) {
                // Invalid date - assume it's recent and preserve it
                return true;
              }
              const age = now - createdTime;
              return age < recentThreshold;
            }
            return false;
          });
          
          if (memoryPositionsNotInDB.length > 0) {
            console.log(`[POSITION_DEBUG] [POSITION_QUERY] ⚠️ Filter: DB=${dbPositions.length}, Memory=${oldLength}. Merging ${memoryPositionsNotInDB.length} recent positions...`);
            // Merge: combine DB positions with recent memory positions
            const dbIds = new Set(dbPositions.map(p => p.id));
            const mergedPositions = [...dbPositions];
            for (const memPos of memoryPositionsNotInDB) {
              if (!dbIds.has(memPos.id)) {
                mergedPositions.push(memPos);
              }
            }
            livePositions = mergedPositions;
            //console.log(`[POSITION_DEBUG] [POSITION_QUERY] ✅ Filter Merged: ${dbPositions.length} DB + ${memoryPositionsNotInDB.length} recent = ${livePositions.length} total`);
            logArrayChange('RELOAD_FROM_DB_FOR_FILTER_MERGED', livePositions.length, oldLength);
          } else {
            // No recent positions to merge, but DB has some - use DB
          livePositions = dbPositions;
          logArrayChange('RELOAD_FROM_DB_FOR_FILTER', livePositions.length, oldLength);
          }
        } else if (dbPositions.length !== oldLength || dbPositions.length > 0) {
          // Normal case: DB has same or more positions, or we have positions
          livePositions = dbPositions;
          logArrayChange('RELOAD_FROM_DB_FOR_FILTER', livePositions.length, oldLength);
        }
      } catch (error) {
        console.error('[POSITION_DEBUG] [POSITION_QUERY] ❌ Error reloading from DB:', error.message);
        // Continue with in-memory array if DB reload fails
      }
    }
    
    let filteredPositions = [...livePositions];
    
    // Debug: Log positions before filtering
    if (livePositions.length > 0) {
      const samplePos = livePositions[0];
      //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Filtering ${livePositions.length} positions. Sample: id=${samplePos.id?.substring(0, 8)}, status=${samplePos.status || 'NULL'}, mode=${samplePos.trading_mode || 'NULL'}`);
    }
    
    // Apply filters
    if (wallet_id) {
      filteredPositions = filteredPositions.filter(pos => pos.wallet_id === wallet_id);
    }
    
    if (trading_mode) {
      const beforeCount = filteredPositions.length;
      filteredPositions = filteredPositions.filter(pos => pos.trading_mode === trading_mode);
      if (beforeCount > filteredPositions.length) {
        //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Trading mode filter: ${beforeCount} → ${filteredPositions.length} (filtered for mode=${trading_mode})`);
      }
    }
    
    if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      const beforeCount = filteredPositions.length;
      filteredPositions = filteredPositions.filter(pos => {
        // CRITICAL FIX: Default to 'open' if status is null/undefined
        // This handles cases where older positions might have NULL status
        const posStatus = pos.status || 'open';
        const matches = statusArray.includes(posStatus);
        if (!matches && beforeCount > 0) {
          //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Status filter: position ${pos.id?.substring(0, 8)} has status=${pos.status || 'NULL'} (defaulted to 'open'), looking for [${statusArray.join(',')}]`);
        }
        return matches;
      });
      if (beforeCount > filteredPositions.length) {
        //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Status filter: ${beforeCount} → ${filteredPositions.length} (filtered for status=[${statusArray.join(',')}])`);
      }
    }
    
    if (filteredPositions.length > 0) {
      //console.log(`[POSITION_DEBUG] [POSITION_QUERY] ✅ Filter: ${filteredPositions.length} positions (mode=${trading_mode || 'any'}, status=${Array.isArray(status) ? status.join(',') : status || 'any'})`);
      filteredPositions.slice(0, 3).forEach((pos, idx) => {
        //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Returning position ${idx + 1}: id=${pos.id?.substring(0, 8)}, symbol=${pos.symbol}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}`);
      });
    } else if (livePositions.length > 0) {
      console.log(`[POSITION_DEBUG] [POSITION_QUERY] ❌ Filter: 0 positions (all ${livePositions.length} filtered out)`);
      // Debug: Show why positions were filtered out
      livePositions.slice(0, 3).forEach(pos => {
        //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 🔍 Sample position: id=${pos.id?.substring(0, 8)}, status=${pos.status || 'NULL'}, mode=${pos.trading_mode || 'NULL'}, symbol=${pos.symbol || 'NULL'}`);
      });
    } else {
      //console.log(`[POSITION_DEBUG] [POSITION_QUERY] ℹ️ No positions in memory/database to filter`);
    }
    //console.log(`[POSITION_DEBUG] [POSITION_QUERY] 📤 Sending response: ${filteredPositions.length} positions`);
    res.json({ success: true, data: filteredPositions });
    return;
  }
  
  // Handle HistoricalPerformance filtering
  if (entityName === 'HistoricalPerformance') {
    const { mode, period_type, snapshot_timestamp } = req.body;
    
    console.log('[PROXY] 📊 POST /api/entities/HistoricalPerformance/filter - Filters:', { mode, period_type, snapshot_timestamp });
    
    let filteredPerformances = [...historicalPerformances];
    
    // Apply filters
    if (mode) {
      filteredPerformances = filteredPerformances.filter(perf => perf.mode === mode);
    }
    
    if (period_type) {
      const periodTypeArray = Array.isArray(period_type) ? period_type : [period_type];
      filteredPerformances = filteredPerformances.filter(perf => periodTypeArray.includes(perf.period_type));
    }
    
    if (snapshot_timestamp) {
      if (snapshot_timestamp.$gte) {
        filteredPerformances = filteredPerformances.filter(perf => perf.snapshot_timestamp >= snapshot_timestamp.$gte);
      }
      if (snapshot_timestamp.$lt) {
        filteredPerformances = filteredPerformances.filter(perf => perf.snapshot_timestamp < snapshot_timestamp.$lt);
      }
      if (snapshot_timestamp.$lte) {
        filteredPerformances = filteredPerformances.filter(perf => perf.snapshot_timestamp <= snapshot_timestamp.$lte);
      }
    }
    
    console.log('[PROXY] 📊 Filtered historical performances:', filteredPerformances.length);
    res.json({ success: true, data: filteredPerformances });
    return;
  }
  
  // Handle CentralWalletState filtering
  if (entityName === 'CentralWalletState') {
    const { trading_mode } = req.body;
    
    console.log('[PROXY] 📊 POST /api/entities/CentralWalletState/filter - Filters:', { trading_mode });
    
    let filteredStates = [...centralWalletStates];
    
    // Apply filters
    if (trading_mode) {
      filteredStates = filteredStates.filter(state => state.trading_mode === trading_mode);
    }
    
    console.log('[PROXY] 📊 Filtered central wallet states:', filteredStates.length);
    res.json({ success: true, data: filteredStates });
    return;
  }
  
  // For other entities, return empty array
  res.json({ success: true, data: [] });
});

app.post('/api/entities/:entityName', async (req, res) => {
  const entityName = req.params.entityName;
  const nameLc = String(entityName || '').toLowerCase();
  
  // Handle LivePosition entities
  if (nameLc === 'liveposition' || nameLc === 'livepositions') {
    const newPosition = {
      id: req.body.id || `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: req.body.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    // Ensure created_date is set for merge logic
    if (!newPosition.created_date && !newPosition.created_date_iso) {
      newPosition.created_date = newPosition.created_date || new Date().toISOString();
      newPosition.created_date_iso = newPosition.created_date;
    }
    
    const oldLength = livePositions.length;
    livePositions.push(newPosition);
    logArrayChange('PUSH_ENTITY', livePositions.length, oldLength);
    //console.log(`[POSITION_CREATE] ✅ Created: ${newPosition.symbol} (${newPosition.id?.substring(0, 8)})`);
    
    // Save to persistent storage
    try {
      saveStoredData('livePositions', livePositions);
      //console.log('[POSITION_DEBUG] PROXY: Saved new position to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new position to storage:', error);
    }
    
    // CRITICAL FIX: Save to database synchronously BEFORE responding
    // This ensures the position is in the database when the wallet page queries
    if (dbClient) {
      const saveStartTime = Date.now();
      const saveStartISO = new Date(saveStartTime).toISOString();
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 🔍 ========================================`);
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 🔍 Saving position to DB at ${saveStartISO}`);
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 📝 Position ID: ${newPosition.id?.substring(0, 8)}`);
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 📝 Symbol: ${newPosition.symbol}`);
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 📝 Status: ${newPosition.status}`);
      //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 📝 Trading Mode: ${newPosition.trading_mode}`);
      try {
        const dbSaved = await saveLivePositionToDB(newPosition);
        const saveEndTime = Date.now();
        const saveDuration = saveEndTime - saveStartTime;
        const saveEndISO = new Date(saveEndTime).toISOString();
        //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ⏱️ Save completed in ${saveDuration}ms`);
        //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ⏰ Save end time: ${saveEndISO}`);
        if (!dbSaved) {
          console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Failed to save ${newPosition.symbol} to database!`);
        } else {
          //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ✅ Save returned success - verifying position is queryable...`);
          
          // Immediately verify the position can be queried
          try {
            await new Promise(resolve => setTimeout(resolve, 100));
            const verifyQuery = 'SELECT id, symbol, status, trading_mode, created_date FROM live_positions WHERE id = $1';
            const verifyResult = await dbClient.query(verifyQuery, [newPosition.id]);
            if (verifyResult.rows.length > 0) {
              const found = verifyResult.rows[0];
              //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ✅ Position VERIFIED in DB: ${found.symbol} status=${found.status} mode=${found.trading_mode} created=${found.created_date}`);
              
              // Also verify it appears in the main query pattern
              const mainQueryTest = await dbClient.query('SELECT COUNT(*) as count FROM live_positions WHERE id = $1', [newPosition.id]);
              //console.log(`[POSITION_DEBUG] [POSITION_CREATE] 🔍 COUNT query for this position: ${mainQueryTest.rows[0]?.count || 0}`);
              
              // Test the exact query pattern used by loadLivePositionsFromDB
              const mainPatternQuery = 'SELECT * FROM live_positions ORDER BY created_date DESC';
              const mainPatternResult = await dbClient.query(mainPatternQuery);
              const foundInMainPattern = mainPatternResult.rows.find(r => r.id === newPosition.id);
              if (foundInMainPattern) {
                //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ✅ Position found in main query pattern! Total positions: ${mainPatternResult.rows.length}`);
              } else {
                console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Position NOT found in main query pattern! Main query returned ${mainPatternResult.rows.length} positions`);
                console.error(`[POSITION_DEBUG] [POSITION_CREATE] ⚠️ This is the exact query used by loadLivePositionsFromDB()!`);
              }
            } else {
              console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Position NOT found in DB after save! ID: ${newPosition.id?.substring(0, 8)}`);
              console.error(`[POSITION_DEBUG] [POSITION_CREATE] ⚠️ Save returned success but position is not queryable!`);
            }
          } catch (verifyError) {
            console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Error verifying position:`, verifyError?.message || verifyError);
          }
        }
        //console.log(`[POSITION_DEBUG] [POSITION_CREATE] ✅ ========================================`);
        } catch (error) {
        console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Error saving to database:`, error?.message || error);
        console.error(`[POSITION_DEBUG] [POSITION_CREATE] ❌ Error stack:`, error?.stack);
        }
    }
    res.json({ success: true, data: newPosition });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 POST /api/entities/ScanSettings - Creating scan settings');
    const newSettings = {
      id: `settings_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    scanSettings.push(newSettings);
    
    // Save to persistent storage
    try {
      saveStoredData('scanSettings', scanSettings);
      console.log('[PROXY] 📊 Saved new scan settings to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new scan settings to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created scan settings with ID:', newSettings.id);
    console.log('[PROXY] 📊 Total scan settings:', scanSettings.length);
    res.json({ success: true, data: newSettings });
    return;
  }
  
  // Handle HistoricalPerformance entities
  if (entityName === 'HistoricalPerformance') {
    console.log('[PROXY] 📊 POST /api/entities/HistoricalPerformance - Creating historical performance');
    const newPerformance = {
      id: `perf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    historicalPerformances.push(newPerformance);
    
    // Save to persistent storage
    try {
      saveStoredData('historicalPerformances', historicalPerformances);
      console.log('[PROXY] 📊 Saved new historical performance to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new historical performance to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created historical performance with ID:', newPerformance.id);
    console.log('[PROXY] 📊 Total historical performances:', historicalPerformances.length);
    res.json({ success: true, data: newPerformance });
    return;
  }
  
  // Handle CentralWalletState entities
  if (entityName === 'CentralWalletState') {
    console.log('[PROXY] 📊 POST /api/entities/CentralWalletState - Creating central wallet state');
    const newState = {
      id: `cws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    centralWalletStates.push(newState);
    
    // Save to persistent storage
    try {
      saveStoredData('centralWalletStates', centralWalletStates);
      console.log('[PROXY] 📊 Saved new central wallet state to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new central wallet state to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created central wallet state with ID:', newState.id);
    console.log('[PROXY] 📊 Total central wallet states:', centralWalletStates.length);
    res.json({ success: true, data: newState });
    return;
  }
  
  // Handle Strategy entities
  if (entityName === 'Strategy') {
    console.log('[PROXY] 📊 POST /api/entities/Strategy - Creating strategy');
    const newStrategy = {
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...req.body,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    strategies.push(newStrategy);
    
    // Save to persistent storage
    try {
      saveStoredData('strategies', strategies);
      console.log('[PROXY] 📊 Saved new strategy to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving new strategy to storage:', error);
    }
    
    console.log('[PROXY] 📊 Created strategy with ID:', newStrategy.id);
    console.log('[PROXY] 📊 Total strategies:', strategies.length);
    res.json({ success: true, data: newStrategy });
    return;
  }
  
  // For local development, simulate successful creation
  const mockId = Math.random().toString(36).substr(2, 9);
  res.json({ success: true, data: { id: mockId, ...req.body } });
});

app.put('/api/entities/:entityName/:id', (req, res) => {
  const entityName = req.params.entityName;
  const id = req.params.id;
  const nameLc = String(entityName || '').toLowerCase();
  
  // Handle LivePosition entities
  if (nameLc === 'liveposition' || nameLc === 'livepositions') {
    console.log('[PROXY] 📊 PUT /api/entities/LivePosition/' + id + ' - Updating position');
    const positionIndex = livePositions.findIndex(pos => pos.id === id);
    
    if (positionIndex === -1) {
      return res.status(404).json({ success: false, error: 'Position not found' });
    }
    
    livePositions[positionIndex] = {
      ...livePositions[positionIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Persist to Postgres if available (targeted columns only)
    (async () => {
      try {
        if (dbClient) {
          const { 
            time_exit_hours, 
            last_updated_timestamp, 
            current_price, 
            unrealized_pnl, 
            last_price_update,
            updated_date 
          } = req.body || {};
          
          // Build dynamic update query for any provided fields
          const setFragments = [];
          const values = [];
          let idx = 1;
          
          if (typeof time_exit_hours !== 'undefined') {
            setFragments.push(`time_exit_hours = $${idx++}`);
            values.push(time_exit_hours);
          }
          if (typeof last_updated_timestamp !== 'undefined') {
            setFragments.push(`last_updated_timestamp = $${idx++}`);
            values.push(last_updated_timestamp);
          }
          if (typeof current_price !== 'undefined' && current_price !== null) {
            setFragments.push(`current_price = $${idx++}`);
            values.push(current_price);
          }
          if (typeof unrealized_pnl !== 'undefined' && unrealized_pnl !== null) {
            setFragments.push(`unrealized_pnl = $${idx++}`);
            values.push(unrealized_pnl);
          }
          if (typeof last_price_update !== 'undefined' && last_price_update !== null) {
            setFragments.push(`last_price_update = $${idx++}`);
            values.push(last_price_update);
          }
          if (typeof updated_date !== 'undefined' && updated_date !== null) {
            setFragments.push(`updated_date = $${idx++}`);
            values.push(updated_date);
          }
          
          // Only execute query if there are fields to update
          if (setFragments.length > 0) {
            // Always bump updated_date if not explicitly set
            if (typeof updated_date === 'undefined') {
              setFragments.push(`updated_date = NOW()`);
            }
            
            const query = `UPDATE live_positions SET ${setFragments.join(', ')} WHERE id = $${idx}`;
            values.push(id);
            const result = await dbClient.query(query, values);
            console.log('[PROXY] 🗃️ DB LivePosition update', { 
              id, 
              rowCount: result?.rowCount || 0, 
              fields: Object.keys(req.body || {}),
              updatedFields: setFragments.length
            });
          }
        }
      } catch (e) {
        console.error('[PROXY] ❌ DB LivePosition update failed:', e?.message || e);
      }
    })();
    
    // Save to persistent storage
    try {
      saveStoredData('livePositions', livePositions);
      console.log('[PROXY] 📊 Saved updated position to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated position to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated position:', id);
    res.json({ success: true, data: livePositions[positionIndex] });
    return;
  }
  
  // Handle ScanSettings entities
  if (entityName === 'ScanSettings') {
    console.log('[PROXY] 📊 PUT /api/entities/ScanSettings/' + id + ' - Updating scan settings');
    const settingsIndex = scanSettings.findIndex(settings => settings.id === id);
    
    if (settingsIndex === -1) {
      return res.status(404).json({ success: false, error: 'Scan settings not found' });
    }
    
    scanSettings[settingsIndex] = {
      ...scanSettings[settingsIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Save to persistent storage
    try {
      saveStoredData('scanSettings', scanSettings);
      console.log('[PROXY] 📊 Saved updated scan settings to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated scan settings to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated scan settings:', id);
    res.json({ success: true, data: scanSettings[settingsIndex] });
    return;
  }
  
  // Handle HistoricalPerformance entities
  if (entityName === 'HistoricalPerformance') {
    console.log('[PROXY] 📊 PUT /api/entities/HistoricalPerformance/' + id + ' - Updating historical performance');
    const performanceIndex = historicalPerformances.findIndex(perf => perf.id === id);
    
    if (performanceIndex === -1) {
      return res.status(404).json({ success: false, error: 'Historical performance not found' });
    }
    
    historicalPerformances[performanceIndex] = {
      ...historicalPerformances[performanceIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Save to persistent storage
    try {
      saveStoredData('historicalPerformances', historicalPerformances);
      console.log('[PROXY] 📊 Saved updated historical performance to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated historical performance to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated historical performance:', id);
    res.json({ success: true, data: historicalPerformances[performanceIndex] });
    return;
  }
  
  // Handle CentralWalletState entities
  if (entityName === 'CentralWalletState') {
    console.log('[PROXY] 📊 PUT /api/entities/CentralWalletState/' + id + ' - Updating central wallet state');
    const stateIndex = centralWalletStates.findIndex(state => state.id === id);
    
    if (stateIndex === -1) {
      return res.status(404).json({ success: false, error: 'Central wallet state not found' });
    }
    
    centralWalletStates[stateIndex] = {
      ...centralWalletStates[stateIndex],
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Save to persistent storage
    try {
      saveStoredData('centralWalletStates', centralWalletStates);
      console.log('[PROXY] 📊 Saved updated central wallet state to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated central wallet state to storage:', error);
    }
    
    console.log('[PROXY] 📊 Updated central wallet state:', id);
    res.json({ success: true, data: centralWalletStates[stateIndex] });
    return;
  }
  
  // For local development, simulate successful update
  res.json({ success: true, data: { id, ...req.body } });
});

// Specific endpoint for backtestCombinations DELETE
app.delete('/api/backtestCombinations/:id', async (req, res) => {
  const id = req.params.id;
  console.log('[PROXY] 📊 DELETE /api/backtestCombinations/:id - Deleting combination:', id);
  
  try {
    // Get existing combinations from file storage
    const existingData = getStoredData('backtestCombinations');
    console.log(`[PROXY] 📊 Found ${existingData.length} existing combinations`);
    
    // Find the combination to be deleted
    const combinationToDelete = existingData.find(combination => combination.id === id);
    
    if (!combinationToDelete) {
      console.log(`[PROXY] 📊 Combination with ID ${id} not found in file storage`);
      return res.status(404).json({ success: false, error: 'Combination not found' });
    }
    
    // Delete from database
    const dbDeleted = await deleteBacktestCombinationFromDB(
      combinationToDelete.combinationName || combinationToDelete.combination_name,
      combinationToDelete.coin,
      combinationToDelete.timeframe
    );
    console.log(`[PROXY] 📊 Database delete result: ${dbDeleted ? 'success' : 'failed'}`);
    
    // Filter out the combination to be deleted from file storage
    const remainingData = existingData.filter(combination => combination.id !== id);
    console.log(`[PROXY] 📊 After deletion: ${remainingData.length} combinations remaining`);
    
    // Save the updated data back to file storage
    saveStoredData('backtestCombinations', remainingData);
    
    const deletedCount = existingData.length - remainingData.length;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} combination with ID: ${id}`);
    
    res.json({ success: true, data: { id, deleted: true, databaseDeleted: dbDeleted } });
  } catch (error) {
    console.error('[PROXY] 📊 Error during deletion:', error);
    res.status(500).json({ success: false, error: 'Failed to delete combination' });
  }
});

// Load backtest combinations from database
async function loadBacktestCombinationsFromDB() {
    if (!dbClient) {
        console.log('[PROXY] 🔍 [DEBUG] loadBacktestCombinationsFromDB: Database not available');
        return [];
    }
    
    try {
        const query = `
            SELECT 
                id, strategy_name, coin, strategy_direction, timeframe, success_rate, occurrences,
                avg_price_move, take_profit_percentage, stop_loss_percentage, estimated_exit_time_minutes,
                enable_trailing_take_profit, trailing_stop_percentage, position_size_percentage,
                dominant_market_regime, signals, created_date, updated_date, is_event_driven_strategy,
                included_in_scanner, included_in_live_scanner, combined_strength, profit_factor,
                combination_signature,
                -- Live Performance Fields
                live_success_rate, live_occurrences, live_avg_price_move, live_profit_factor,
                live_max_drawdown_percent, live_win_loss_ratio, live_gross_profit_total, live_gross_loss_total,
                performance_gap_percent, last_live_trade_date,
                -- Exit Reason Breakdown
                exit_reason_breakdown, backtest_exit_reason_breakdown
            FROM backtest_combinations
            ORDER BY created_date DESC
        `;
        const result = await dbClient.query(query);
        
        console.log('[PROXY] 🔍 [DEBUG] loadBacktestCombinationsFromDB: Query result:', {
            rowCount: result.rowCount,
            sampleRow: result.rows.length > 0 ? {
                id: result.rows[0].id,
                idType: typeof result.rows[0].id,
                idLength: String(result.rows[0].id).length,
                strategy_name: result.rows[0].strategy_name,
                coin: result.rows[0].coin,
                timeframe: result.rows[0].timeframe,
                included_in_scanner: result.rows[0].included_in_scanner,
                included_in_live_scanner: result.rows[0].included_in_live_scanner
            } : null
        });
        
        // Convert database rows to frontend format (snake_case to camelCase)
        // CRITICAL FIX: Use actual database UUID id instead of generating composite ID
        // PostgreSQL UUIDs need to be converted to string explicitly
        const combinations = result.rows.map(row => ({
            id: String(row.id), // Ensure UUID is converted to string (PostgreSQL returns UUID object)
            combinationName: row.strategy_name,
            strategy_name: row.strategy_name,
            coin: row.coin,
            strategyDirection: row.strategy_direction,
            strategy_direction: row.strategy_direction,
            timeframe: row.timeframe,
            successRate: row.success_rate,
            success_rate: row.success_rate,
            occurrences: row.occurrences || 0,
            avgPriceMove: row.avg_price_move,
            avg_price_move: row.avg_price_move,
            takeProfitPercentage: row.take_profit_percentage,
            take_profit_percentage: row.take_profit_percentage,
            stopLossPercentage: row.stop_loss_percentage,
            stop_loss_percentage: row.stop_loss_percentage,
            estimatedExitTimeMinutes: row.estimated_exit_time_minutes,
            estimated_exit_time_minutes: row.estimated_exit_time_minutes,
            enableTrailingTakeProfit: row.enable_trailing_take_profit,
            enable_trailing_take_profit: row.enable_trailing_take_profit,
            trailingStopPercentage: row.trailing_stop_percentage,
            trailing_stop_percentage: row.trailing_stop_percentage,
            positionSizePercentage: row.position_size_percentage,
            position_size_percentage: row.position_size_percentage,
            dominantMarketRegime: row.dominant_market_regime,
            dominant_market_regime: row.dominant_market_regime,
            signals: typeof row.signals === 'string' ? JSON.parse(row.signals) : (row.signals || []),
            created_date: row.created_date ? new Date(row.created_date).toISOString() : new Date().toISOString(),
            updated_date: row.updated_date ? new Date(row.updated_date).toISOString() : new Date().toISOString(),
            is_event_driven_strategy: row.is_event_driven_strategy || false,
            // CRITICAL: Include toggle fields from database
            includedInScanner: row.included_in_scanner || false,
            includedInLiveScanner: row.included_in_live_scanner || false,
            combinedStrength: row.combined_strength,
            profitFactor: row.profit_factor,
            combinationSignature: row.combination_signature || null,
            // Live Performance Fields
            liveSuccessRate: row.live_success_rate,
            liveOccurrences: row.live_occurrences,
            liveAvgPriceMove: row.live_avg_price_move,
            liveProfitFactor: row.live_profit_factor,
            liveMaxDrawdownPercent: row.live_max_drawdown_percent,
            liveWinLossRatio: row.live_win_loss_ratio,
            liveGrossProfitTotal: row.live_gross_profit_total,
            liveGrossLossTotal: row.live_gross_loss_total,
            performanceGapPercent: row.performance_gap_percent,
            lastLiveTradeDate: row.last_live_trade_date ? new Date(row.last_live_trade_date).toISOString() : null,
            // Exit Reason Breakdown
            exitReasonBreakdown: typeof row.exit_reason_breakdown === 'string' ? JSON.parse(row.exit_reason_breakdown) : (row.exit_reason_breakdown || null),
            backtestExitReasonBreakdown: typeof row.backtest_exit_reason_breakdown === 'string' ? JSON.parse(row.backtest_exit_reason_breakdown) : (row.backtest_exit_reason_breakdown || null)
        }));
        
        console.log('[PROXY] 🔍 [DEBUG] loadBacktestCombinationsFromDB: Converted combinations sample:', {
            total: combinations.length,
            sample: combinations.length > 0 ? {
                id: combinations[0].id,
                idType: typeof combinations[0].id,
                idIsUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(combinations[0].id)),
                combinationName: combinations[0].combinationName,
                coin: combinations[0].coin,
                timeframe: combinations[0].timeframe,
                includedInScanner: combinations[0].includedInScanner,
                includedInLiveScanner: combinations[0].includedInLiveScanner
            } : null
        });
        
        console.log(`[PROXY] 💾 Loaded ${combinations.length} combinations from database`);
        
        // Refresh live performance asynchronously (non-blocking)
        // This ensures live performance is up-to-date when strategies are loaded
        refreshAllStrategiesLivePerformance().catch(err => {
            console.error('[PROXY] ⚠️ Error refreshing live performance (non-blocking):', err.message);
        });
        
        return combinations;
    } catch (error) {
        console.error('[PROXY] ❌ Error loading backtest combinations from database:', error.message);
        return [];
    }
}

// POST endpoint to refresh live performance for all strategies
app.post('/api/backtestCombinations/refresh-live-performance', async (req, res) => {
  console.log('[PROXY] 🔄 POST /api/backtestCombinations/refresh-live-performance - Refreshing live performance');
  
  try {
    await refreshAllStrategiesLivePerformance();
    res.json({ success: true, message: 'Live performance refreshed for all strategies' });
  } catch (error) {
    console.error('[PROXY] ❌ Error refreshing live performance:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET endpoint for backtestCombinations
app.get('/api/backtestCombinations', async (req, res) => {
  console.log('[PROXY] 📊 GET /api/backtestCombinations - Fetching combinations');
  console.log('[PROXY] 🔍 [DEBUG] GET: dbClient exists:', !!dbClient);
  console.log('[PROXY] 🔍 [DEBUG] GET: Request timestamp:', new Date().toISOString());
  
  try {
    // CRITICAL FIX: ALWAYS use database when available - never fall back to file storage
    // File storage has old composite IDs which break deletion
    let existingData = [];
    
    if (dbClient) {
      console.log('[PROXY] 🔍 [DEBUG] GET: Database client available, loading from database...');
      try {
        existingData = await loadBacktestCombinationsFromDB();
        console.log(`[PROXY] 🔍 [DEBUG] GET: Database query returned ${existingData.length} combinations`);
      } catch (dbError) {
        console.error('[PROXY] ❌ ERROR: Database query failed:', dbError.message);
        console.error('[PROXY] ❌ ERROR stack:', dbError.stack);
        throw dbError; // Re-throw to trigger error response
      }
      
      // NEVER fall back to file storage - database is the source of truth
      // If database returns 0, return empty array (don't use stale file storage data)
      if (existingData.length > 0) {
        // Log sample to verify IDs are UUIDs (not composite IDs)
        const sample = existingData[0];
        const sampleId = String(sample?.id || 'N/A');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sampleId);
        console.log('[PROXY] 🔍 [DEBUG] GET: Sample combination from database:', {
          id: sampleId,
          idIsUUID: isUuid,
          idLength: sampleId?.length,
          combinationName: sample?.combinationName,
          includedInScanner: sample?.includedInScanner,
          includedInLiveScanner: sample?.includedInLiveScanner
        });
        
        if (!isUuid) {
          console.error(`[PROXY] ❌ CRITICAL ERROR: Database returned non-UUID ID! This should never happen.`);
          console.error(`[PROXY] ❌ Sample ID: ${sampleId}`);
          console.error(`[PROXY] ❌ Sample row from DB:`, JSON.stringify(sample, null, 2));
        }
      } else {
        console.log(`[PROXY] 🔍 [DEBUG] GET: Database returned 0 combinations (database is empty)`);
      }
    } else {
      console.warn(`[PROXY] ⚠️ Database client NOT available, falling back to file storage (this should not happen in production)`);
      existingData = getStoredData('backtestCombinations');
      console.log(`[PROXY] 📊 Loaded ${existingData.length} combinations from file storage`);
    }
    
    // Sort by created_date (newest first) if no specific orderBy is provided
    const orderBy = req.query.orderBy || '-created_date';
    if (orderBy === '-created_date') {
      existingData.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
    }
    
    // Apply limit if provided, default to 10000 to load all strategies
    const limit = parseInt(req.query.limit) || 10000;
    const limitedData = existingData.slice(0, limit);
    
    console.log(`[PROXY] 📊 Returning ${limitedData.length} combinations`);
    
    // Validate all returned IDs are UUIDs before sending to frontend
    const invalidIds = limitedData.filter(c => {
        const id = String(c.id || '');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
        return !isUuid && id.length > 0;
    });
    
    if (invalidIds.length > 0) {
        console.error(`[PROXY] ❌ CRITICAL: Returning ${invalidIds.length} combinations with non-UUID IDs!`);
        console.error(`[PROXY] ❌ Sample invalid IDs:`, invalidIds.slice(0, 3).map(c => ({ id: c.id, name: c.combinationName })));
    }
    
    // Disable caching to ensure fresh data
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.json({ success: true, data: limitedData });
  } catch (error) {
    console.error('[PROXY] 📊 Error getting combinations:', error);
    res.status(500).json({ success: false, error: 'Failed to get combinations' });
  }
});

// POST endpoint for backtestCombinations
app.post('/api/backtestCombinations', async (req, res) => {
  const data = req.body;
  console.log('[PROXY] 📊 POST /api/backtestCombinations - Creating combination:', data.combinationName);
  
  try {
    // Save to file storage (existing behavior)
    const existingData = getStoredData('backtestCombinations');
    const newItem = {
      id: Date.now().toString(),
      ...data,
      created_date: new Date().toISOString()
    };
    
    existingData.push(newItem);
    saveStoredData('backtestCombinations', existingData);
    
    // Save to database
    const dbSuccess = await saveBacktestCombinationToDB(data);
    
    console.log(`[PROXY] 📊 Created combination: ${newItem.combinationName} with ID: ${newItem.id}`);
    console.log(`[PROXY] 📊 Database save: ${dbSuccess ? 'success' : 'failed'}`);
    
    res.json({ 
      success: true, 
      data: newItem,
      databaseSaved: dbSuccess
    });
  } catch (error) {
    console.error('[PROXY] 📊 Error creating combination:', error);
    res.status(500).json({ success: false, error: 'Failed to create combination' });
  }
});

// POST endpoint for bulk creating backtestCombinations
app.post('/api/backtestCombinations/bulkCreate', async (req, res) => {
  const combinations = req.body;
  console.log('[PROXY] 📊 POST /api/backtestCombinations/bulkCreate - Received', combinations.length, 'combinations');
  console.log('[PROXY] 📊 First combination sample:', combinations[0] ? {
    combinationName: combinations[0].combinationName || combinations[0].strategy_name,
    coin: combinations[0].coin,
    timeframe: combinations[0].timeframe,
    combination_signature: combinations[0].combination_signature || combinations[0].combinationSignature,
    hasSignals: !!combinations[0].signals
  } : 'No combinations');
  
  try {
    // Save to file storage (existing behavior)
    const existingData = getStoredData('backtestCombinations');
    const newItems = combinations.map(combination => ({
      id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
      ...combination,
      created_date: new Date().toISOString()
    }));
    
    existingData.push(...newItems);
    saveStoredData('backtestCombinations', existingData);
    
    // Save to database
    const dbResult = await bulkSaveBacktestCombinationsToDB(combinations);
    
    console.log(`[PROXY] 📊 Bulk created ${newItems.length} combinations in file storage`);
    console.log(`[PROXY] 📊 Database save result: ${dbResult.saved} saved, ${dbResult.failed} failed`);
    
    res.json({ 
      success: true, 
      data: newItems,
      databaseResult: dbResult,
      message: `Created ${newItems.length} combinations. Database: ${dbResult.saved} saved, ${dbResult.updated || 0} updated, ${dbResult.failed} failed`
    });
  } catch (error) {
    console.error('[PROXY] 📊 Error bulk creating combinations:', error);
    res.status(500).json({ success: false, error: 'Failed to bulk create combinations' });
  }
});

// Helper function to update backtest combination in database
async function updateBacktestCombinationInDB(combinationName, coin, timeframe, updates) {
    console.log('[PROXY] 🔍 [DEBUG] updateBacktestCombinationInDB called with:', {
        combinationName,
        coin,
        timeframe,
        updates: JSON.stringify(updates, null, 2)
    });
    
    if (!dbClient) {
        console.log('[PROXY] ⚠️ Database not available, skipping DB update');
        return false;
    }
    
    try {
        // First, check if record exists
        const checkQuery = `SELECT combination_name, coin, timeframe, included_in_scanner, included_in_live_scanner 
                           FROM backtest_combinations 
                           WHERE combination_name = $1 AND coin = $2 AND timeframe = $3`;
        const checkResult = await dbClient.query(checkQuery, [combinationName, coin, timeframe]);
        console.log('[PROXY] 🔍 [DEBUG] Existing record check:', {
            found: checkResult.rowCount > 0,
            rowCount: checkResult.rowCount,
            existingRecord: checkResult.rowCount > 0 ? checkResult.rows[0] : null
        });
        
        // Map camelCase to snake_case for database columns
        const dbUpdates = {};
        if (updates.includedInScanner !== undefined) {
            dbUpdates.included_in_scanner = updates.includedInScanner;
            console.log('[PROXY] 🔍 [DEBUG] Mapped includedInScanner -> included_in_scanner:', updates.includedInScanner);
        }
        if (updates.includedInLiveScanner !== undefined) {
            dbUpdates.included_in_live_scanner = updates.includedInLiveScanner;
            console.log('[PROXY] 🔍 [DEBUG] Mapped includedInLiveScanner -> included_in_live_scanner:', updates.includedInLiveScanner);
        }
        // Add other field mappings as needed
        if (updates.combinedStrength !== undefined) {
            dbUpdates.combined_strength = updates.combinedStrength;
        }
        if (updates.profitFactor !== undefined) {
            dbUpdates.profit_factor = updates.profitFactor;
        }
        if (updates.dominantMarketRegime !== undefined) {
            dbUpdates.dominant_market_regime = updates.dominantMarketRegime;
        }
        
        if (Object.keys(dbUpdates).length === 0) {
            console.log('[PROXY] ⚠️ No database fields to update');
            return false;
        }
        
        console.log('[PROXY] 🔍 [DEBUG] Database updates to apply:', dbUpdates);
        
        // Build UPDATE query
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        
        for (const [key, value] of Object.entries(dbUpdates)) {
            updateFields.push(`${key} = $${paramIndex++}`);
            updateValues.push(value);
        }
        
        // Add updated_date
        updateFields.push(`updated_date = CURRENT_TIMESTAMP`);
        
        // Add WHERE clause parameters
        updateValues.push(combinationName || '');
        updateValues.push(coin || '');
        updateValues.push(timeframe || '');
        
        const query = `
            UPDATE backtest_combinations
            SET ${updateFields.join(', ')}
            WHERE combination_name = $${paramIndex++} 
              AND coin = $${paramIndex++} 
              AND timeframe = $${paramIndex}
        `;
        
        console.log('[PROXY] 🔍 [DEBUG] Executing UPDATE query:', query);
        console.log('[PROXY] 🔍 [DEBUG] Query parameters:', updateValues);
        
        const result = await dbClient.query(query, updateValues);
        const updated = !!(result && result.rowCount && result.rowCount > 0);
        
        console.log('[PROXY] 🔍 [DEBUG] UPDATE result:', {
            updated,
            rowCount: result?.rowCount,
            resultRows: result?.rows
        });
        
        // Verify the update by querying again
        if (updated) {
            const verifyQuery = `SELECT included_in_scanner, included_in_live_scanner 
                               FROM backtest_combinations 
                               WHERE combination_name = $1 AND coin = $2 AND timeframe = $3`;
            const verifyResult = await dbClient.query(verifyQuery, [combinationName, coin, timeframe]);
            console.log('[PROXY] 🔍 [DEBUG] Verification query result:', {
                found: verifyResult.rowCount > 0,
                values: verifyResult.rowCount > 0 ? verifyResult.rows[0] : null
            });
        }
        
        console.log('[PROXY] 💾 Updated backtest combination in database:', {
            combinationName,
            coin,
            timeframe,
            rowCount: result?.rowCount,
            fields: Object.keys(dbUpdates),
            success: updated
        });
        return updated;
    } catch (error) {
        console.error('[PROXY] ❌ Error updating backtest combination in database:', error.message);
        console.error('[PROXY] ❌ Error stack:', error.stack);
        return false;
    }
}

// PUT endpoint for updating a backtestCombination
app.put('/api/backtestCombinations/:id', async (req, res) => {
  const id = req.params.id;
  const updates = req.body;
  console.log('[PROXY] 🔍 [DEBUG] PUT /api/backtestCombinations/:id - Request received:', {
    id,
    updates: JSON.stringify(updates, null, 2),
    updateKeys: Object.keys(updates)
  });
  
  try {
    let combinationToUpdate = null;
    let combinationName = null;
    let coin = null;
    let timeframe = null;
    
    // CRITICAL FIX: Try to find combination in database first (since IDs from database don't match file storage)
    if (dbClient) {
      // The ID format from database is: combination_name-coin-timeframe
      // Try to extract or look it up directly
      // Since IDs are generated, we need to query the database
      // Try multiple approaches:
      
      // Approach 1: Try to find by ID in database (if database stores ID somehow)
      // Approach 2: Parse ID to extract combination_name, coin, timeframe
      // Approach 3: Search file storage, then database as fallback
      
      // For now, try file storage first, then database lookup
    const existingData = getStoredData('backtestCombinations');
      const index = existingData.findIndex(combination => combination.id === id);
      
      if (index !== -1) {
        // Found in file storage
        combinationToUpdate = existingData[index];
        combinationName = combinationToUpdate.combinationName || combinationToUpdate.combination_name;
        coin = combinationToUpdate.coin;
        timeframe = combinationToUpdate.timeframe;
        
        console.log('[PROXY] 🔍 [DEBUG] Found in file storage:', {
          combinationName,
          coin,
          timeframe
        });
        
        // Update file storage
        existingData[index] = {
          ...existingData[index],
          ...updates,
          updated_date: new Date().toISOString()
        };
        saveStoredData('backtestCombinations', existingData);
      } else {
        // Not found in file storage - try to look up in database
        // The ID might be from database format: combination_name-coin-timeframe
        // Or we need to query database to find by some other means
        
        // Try to query database to find by matching the ID pattern or by searching all combinations
        console.log('[PROXY] 🔍 [DEBUG] Not found in file storage, searching database...');
        
        // Since we don't have a direct ID field in database, we need to search all combinations
        // and find the one that matches the ID pattern
        const dbCombinations = await loadBacktestCombinationsFromDB();
        const dbMatch = dbCombinations.find(c => c.id === id);
        
        if (dbMatch) {
          combinationToUpdate = dbMatch;
          combinationName = dbMatch.combinationName || dbMatch.combination_name;
          coin = dbMatch.coin;
          timeframe = dbMatch.timeframe;
          
          console.log('[PROXY] 🔍 [DEBUG] Found in database:', {
            combinationName,
            coin,
            timeframe,
            currentIncludedInScanner: dbMatch.includedInScanner,
            currentIncludedInLiveScanner: dbMatch.includedInLiveScanner
          });
        } else {
          console.log('[PROXY] 🔍 [DEBUG] Not found in database either, ID:', id);
          return res.status(404).json({ success: false, error: 'Combination not found in file storage or database' });
        }
      }
    } else {
      // No database - only file storage
      const existingData = getStoredData('backtestCombinations');
    const index = existingData.findIndex(combination => combination.id === id);
    
    if (index === -1) {
      console.log('[PROXY] 📊 Combination not found:', id);
      return res.status(404).json({ success: false, error: 'Combination not found' });
    }
    
      combinationToUpdate = existingData[index];
      combinationName = combinationToUpdate.combinationName || combinationToUpdate.combination_name;
      coin = combinationToUpdate.coin;
      timeframe = combinationToUpdate.timeframe;
      
      // Update file storage
    existingData[index] = {
      ...existingData[index],
      ...updates,
      updated_date: new Date().toISOString()
    };
      saveStoredData('backtestCombinations', existingData);
    }
    
    console.log('[PROXY] 🔍 [DEBUG] Found combination to update:', {
      id: combinationToUpdate.id,
      combinationName,
      coin,
      timeframe,
      currentIncludedInScanner: combinationToUpdate.includedInScanner,
      currentIncludedInLiveScanner: combinationToUpdate.includedInLiveScanner
    });
    
    // Update database (primary source of truth)
    if (dbClient && combinationName && coin && timeframe) {
      console.log('[PROXY] 🔍 [DEBUG] Calling updateBacktestCombinationInDB with:', {
        combinationName,
        coin,
        timeframe,
        updates
      });
      
      const dbUpdated = await updateBacktestCombinationInDB(
        combinationName,
        coin,
        timeframe,
        updates
      );
      console.log(`[PROXY] 📊 Database update result: ${dbUpdated ? 'success' : 'failed'}`);
      
      // Also update file storage to keep in sync
      const existingData = getStoredData('backtestCombinations');
      const index = existingData.findIndex(c => {
        const cName = c.combinationName || c.combination_name;
        return cName === combinationName && c.coin === coin && c.timeframe === timeframe;
      });
      
      if (index !== -1) {
        existingData[index] = {
          ...existingData[index],
          ...updates,
          updated_date: new Date().toISOString()
        };
    saveStoredData('backtestCombinations', existingData);
      }
      
      // Return updated data (from database or file storage)
      const updatedCombination = {
        ...combinationToUpdate,
        ...updates,
        updated_date: new Date().toISOString()
      };
      
      res.json({ 
        success: true, 
        data: updatedCombination,
        databaseUpdated: dbUpdated
      });
    } else {
      // No database, just return file storage update
      const existingData = getStoredData('backtestCombinations');
      const index = existingData.findIndex(combination => combination.id === id);
      
      res.json({ 
        success: true, 
        data: existingData[index]
      });
    }
  } catch (error) {
    console.error('[PROXY] ❌ Error updating combination:', error);
    console.error('[PROXY] ❌ Error stack:', error.stack);
    res.status(500).json({ success: false, error: 'Failed to update combination' });
  }
});

// Bulk delete endpoint for backtestCombinations
app.delete('/api/backtestCombinations', async (req, res) => {
  const { ids } = req.body;
  console.log('[PROXY] 📊 DELETE /api/backtestCombinations (bulk) - Deleting combinations:', ids);
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'IDs array is required' });
  }
  
  try {
    // Delete from database first (primary source of truth)
    const dbResult = await bulkDeleteBacktestCombinationsFromDB(ids);
    console.log(`[PROXY] 📊 Database delete result: ${dbResult.deleted} deleted, ${dbResult.failed} failed`);
    
    // Also update file storage to keep in sync
    const existingData = getStoredData('backtestCombinations');
    const remainingData = existingData.filter(combination => !ids.includes(combination.id));
    saveStoredData('backtestCombinations', remainingData);
    console.log(`[PROXY] 📊 File storage updated: ${remainingData.length} combinations remaining`);
    
    // Use database result as the source of truth
    const deletedCount = dbResult.deleted;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} combinations from database`);
    
    // Always return 200 with databaseResult so frontend can check what actually happened
    // Frontend will check databaseResult.deleted to determine if deletion succeeded
    const deletedIds = ids.map(id => ({ id, deleted: deletedCount > 0 }));
    res.json({ 
      success: true, 
      data: { deleted: deletedIds, count: deletedCount },
      databaseResult: dbResult
    });
  } catch (error) {
    console.error('[PROXY] 📊 Error during bulk deletion:', error);
    res.status(500).json({ success: false, error: 'Failed to delete combinations: ' + error.message });
  }
});

// Generic bulk delete endpoint for entities
app.delete('/api/entities/:entityName', async (req, res) => {
  const entityName = req.params.entityName;
  const { ids } = req.body;
  
  console.log(`[PROXY] 📊 DELETE /api/entities/${entityName} (bulk) - Deleting ${entityName}:`, ids);
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'IDs array is required' });
  }
  
  try {
    // Special handling for backtestCombinations - must delete from database
    const entityNameLower = String(entityName || '').toLowerCase();
    if (entityNameLower === 'backtestcombinations') {
      // Delete from database first (primary source of truth)
      const dbResult = await bulkDeleteBacktestCombinationsFromDB(ids);
      console.log(`[PROXY] 📊 Database delete result: ${dbResult.deleted} deleted, ${dbResult.failed} failed`);
      
      // Also update file storage to keep in sync
      const existingData = getStoredData('backtestCombinations');
      const remainingData = existingData.filter(combination => !ids.includes(combination.id));
      saveStoredData('backtestCombinations', remainingData);
      console.log(`[PROXY] 📊 File storage updated: ${remainingData.length} combinations remaining`);
      
      // Use database result as the source of truth
      const deletedCount = dbResult.deleted;
      
      // Always return 200 with databaseResult so frontend can check what actually happened
      // Frontend will check databaseResult.deleted to determine if deletion succeeded
      const deletedIds = ids.map(id => ({ id, deleted: deletedCount > 0 }));
      return res.json({ 
        success: true, 
        data: { deleted: deletedIds, count: deletedCount },
        databaseResult: dbResult
      });
    }
    
    // For other entities, use file storage only
    const existingData = getStoredData(entityName);
    console.log(`[PROXY] 📊 Found ${existingData.length} existing ${entityName} records`);
    
    // Filter out the records to be deleted
    const remainingData = existingData.filter(record => !ids.includes(record.id));
    console.log(`[PROXY] 📊 After deletion: ${remainingData.length} ${entityName} records remaining`);
    
    // Save the updated data back to file storage
    saveStoredData(entityName, remainingData);

    // Keep in-memory collections in sync for known entities
    const lc = String(entityName || '').toLowerCase();
    if (lc === 'historicalperformance') {
      try {
        historicalPerformances = remainingData;
        console.log('[PROXY] 📊 In-memory HistoricalPerformance updated (bulk):', historicalPerformances.length);
      } catch (e) {
        console.warn('[PROXY] ⚠️ Failed to sync in-memory HistoricalPerformance (bulk):', e?.message);
      }
    }
    
    const deletedCount = existingData.length - remainingData.length;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} ${entityName} records`);
    
    const deletedIds = ids.map(id => ({ id, deleted: true }));
    res.json({ success: true, data: deletedIds });
  } catch (error) {
    console.error(`[PROXY] 📊 Error during bulk deletion of ${entityName}:`, error);
    res.status(500).json({ success: false, error: `Failed to delete ${entityName} records: ${error.message}` });
  }
});

app.delete('/api/entities/:entityName/:id', async (req, res) => {
  const entityName = req.params.entityName;
  const id = req.params.id;
  const nameLc = String(entityName || '').toLowerCase();
  
  console.log(`[PROXY] 📊 DELETE /api/entities/${entityName}/${id} - Deleting ${entityName}:`, id);
  
  try {
    // Get existing data from file storage
    const existingData = getStoredData(nameLc === 'liveposition' ? 'LivePosition' : entityName);
    console.log(`[PROXY] 📊 Found ${existingData.length} existing ${entityName} records`);
    
    // Filter out the record to be deleted
    const remainingData = existingData.filter(record => record.id !== id);
    console.log(`[PROXY] 📊 After deletion: ${remainingData.length} ${entityName} records remaining`);
    
    // Save the updated data back to file storage
    saveStoredData(entityName, remainingData);
    
    // CRITICAL FIX: Also delete from database and update in-memory array for LivePosition entities
    if (nameLc === 'liveposition' || nameLc === 'livepositions') {
      console.log(`[PROXY] 📊 Attempting database deletion for LivePosition ${id}...`);
      const dbDeleted = await deleteLivePositionFromDB(id);
      console.log(`[PROXY] 📊 Database delete result for LivePosition ${id}:`, dbDeleted ? 'success' : 'failed');
      if (!dbDeleted) {
        console.error(`[PROXY] 📊 WARNING: Database deletion failed for LivePosition ${id}`);
      }
      
      // CRITICAL: Also update the in-memory array
      const initialLength = livePositions.length;
      const idxMem = livePositions.findIndex(pos => pos.id === id);
      if (idxMem !== -1) livePositions.splice(idxMem, 1);
      const finalLength = livePositions.length;
      console.log(`[PROXY] 📊 Updated in-memory array: ${initialLength} -> ${finalLength} positions`);
    }
    
    // Keep in-memory HistoricalPerformance in sync too
    if (nameLc === 'historicalperformance') {
      try {
        historicalPerformances = remainingData;
        console.log('[PROXY] 📊 In-memory HistoricalPerformance updated (single):', historicalPerformances.length);
      } catch (e) {
        console.warn('[PROXY] ⚠️ Failed to sync in-memory HistoricalPerformance (single):', e?.message);
      }
    }
    
    const deletedCount = existingData.length - remainingData.length;
    console.log(`[PROXY] 📊 Successfully deleted ${deletedCount} ${entityName} record with ID: ${id}`);
    
    res.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error(`[PROXY] 📊 Error during deletion of ${entityName}/${id}:`, error);
    res.status(500).json({ success: false, error: `Failed to delete ${entityName} record` });
  }
});

// Scanner Stats endpoints
app.get('/api/scannerStats', (req, res) => {
  const { mode, orderBy, limit } = req.query;
  console.log(`[PROXY] 📊 GET /api/scannerStats - mode: ${mode}, orderBy: ${orderBy}, limit: ${limit}`);
  
  // Return empty array for now - scanner stats will be stored here
  const stats = getStoredData('scannerStats');
  const filteredStats = stats.filter(stat => !mode || stat.mode === mode);
  
  console.log(`[PROXY] 📊 Returning ${filteredStats.length} scanner stats`);
  res.json(filteredStats);
});

app.post('/api/scannerStats', (req, res) => {
  const statsData = req.body;
  console.log(`[PROXY] 📊 POST /api/scannerStats - Creating new scanner stat`);
  
  // Generate ID and timestamp
  const newStat = {
    id: Date.now().toString(),
    ...statsData,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  // Get existing stats and add new one
  const existingStats = getStoredData('scannerStats');
  const updatedStats = [...existingStats, newStat];
  saveStoredData('scannerStats', updatedStats);
  
  console.log(`[PROXY] 📊 Created scanner stat with ID: ${newStat.id}`);
  res.json(newStat);
});

app.put('/api/scannerStats/:id', (req, res) => {
  const id = req.params.id;
  const updateData = req.body;
  console.log(`[PROXY] 📊 PUT /api/scannerStats/${id} - Updating scanner stat`);
  
  // Get existing stats
  const existingStats = getStoredData('scannerStats');
  const statIndex = existingStats.findIndex(stat => stat.id === id);
  
  if (statIndex === -1) {
    return res.status(404).json({ error: 'Scanner stat not found' });
  }
  
  // Update the stat
  const updatedStat = {
    ...existingStats[statIndex],
    ...updateData,
    updated_date: new Date().toISOString()
  };
  
  existingStats[statIndex] = updatedStat;
  saveStoredData('scannerStats', existingStats);
  
  console.log(`[PROXY] 📊 Updated scanner stat with ID: ${id}`);
  res.json(updatedStat);
});

// Missing API endpoints that the frontend expects
app.post('/api/updatePerformanceSnapshot', (req, res) => {
  console.log('[PROXY] 📊 POST /api/updatePerformanceSnapshot - Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // For local development, just return success
    res.json({ 
      success: true, 
      message: 'Performance snapshot updated successfully',
      data: { 
        timestamp: new Date().toISOString(),
        ...req.body 
      }
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error updating performance snapshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Archive trades endpoint
app.post('/api/archiveTrades', (req, res) => {
  console.log('[PROXY] 📊 POST /api/archiveTrades - Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // For local development, just return success
    res.json({ 
      success: true, 
      message: 'Trades archived successfully',
      data: { 
        timestamp: new Date().toISOString(),
        archivedCount: req.body.tradeIds?.length || 0
      }
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error archiving trades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scanner configuration endpoint
app.get('/api/scannerConfig', (req, res) => {
  console.log('[PROXY] 📊 GET /api/scannerConfig - Fetching scanner configuration');
  
  try {
    // Return the stored scan settings as scanner config
    const config = scanSettings.length > 0 ? scanSettings[0] : {
      id: 'default',
      local_proxy_url: 'http://localhost:3003',
      trading_mode: 'testnet',
      created_date: new Date().toISOString()
    };
    
    console.log('[PROXY] 📊 Returning scanner config:', JSON.stringify(config, null, 2));
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching scanner config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scannerConfig', (req, res) => {
  console.log('[PROXY] 📊 POST /api/scannerConfig - Saving scanner configuration');
  console.log('[PROXY] 📊 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // Update scan settings with the new configuration
    const configData = {
      id: 'default',
      ...req.body,
      updated_date: new Date().toISOString()
    };
    
    // Replace existing settings
    scanSettings = [configData];
    
    console.log('[PROXY] 📊 Scanner configuration saved:', JSON.stringify(configData, null, 2));
    res.json({ success: true, data: configData });
  } catch (error) {
    console.error('[PROXY] ❌ Error saving scanner config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Market Alerts endpoints
app.get('/api/marketAlerts', (req, res) => {
  const { orderBy, limit } = req.query;
  console.log(`[PROXY] 📊 GET /api/marketAlerts - orderBy: ${orderBy}, limit: ${limit}`);
  
  try {
    // Return empty array for now - market alerts will be stored here
    const alerts = getStoredData('marketAlerts');
    
    // Apply ordering if specified
    if (orderBy === '-created_date') {
      alerts.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
    }
    
    // Apply limit if specified
    const limitedAlerts = limit ? alerts.slice(0, parseInt(limit)) : alerts;
    
    console.log(`[PROXY] 📊 Returning ${limitedAlerts.length} market alerts`);
    res.json({ success: true, data: limitedAlerts });
  } catch (error) {
    console.error('[PROXY] ❌ Error fetching market alerts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/marketAlerts', (req, res) => {
  const alertData = req.body;
  console.log(`[PROXY] 📊 POST /api/marketAlerts - Creating new market alert`);
  
  try {
    // Generate ID and timestamp
    const newAlert = {
      id: Date.now().toString(),
      ...alertData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    // Get existing alerts and add new one
    const existingAlerts = getStoredData('marketAlerts');
    const updatedAlerts = [...existingAlerts, newAlert];
    saveStoredData('marketAlerts', updatedAlerts);
    
    console.log(`[PROXY] 📊 Created market alert with ID: ${newAlert.id}`);
    res.json({ success: true, data: newAlert });
  } catch (error) {
    console.error('[PROXY] ❌ Error creating market alert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trade entity endpoints for local development
let trades = [];

// Helper function to save trades to file
function saveTradesToFile() {
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved trades to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving trades to storage:', error);
  }
}

// Load existing trades from file storage on startup
try {
  console.log('[PROXY] 📊 Attempting to load trades from storage...');
  trades = getStoredData('trades');
  console.log(`[PROXY] 📊 Loaded ${trades.length} existing trades from storage`);
  if (trades.length > 0) {
    console.log('[PROXY] 📊 First trade sample:', trades[0]);
  }
  console.log('[PROXY] 📊 Trades array after loading:', trades);
  console.log('[PROXY] 📊 Trades array length after loading:', trades.length);
} catch (error) {
  console.error('[PROXY] Error loading trades from storage:', error);
  console.error('[PROXY] Error details:', error.message);
  console.error('[PROXY] Error stack:', error.stack);
  trades = [];
}

// Load existing centralWalletStates from file storage on startup
try {
  console.log('[PROXY] 📊 Attempting to load centralWalletStates from storage...');
  const loadedStates = getStoredData('centralWalletStates');
  centralWalletStates = Array.isArray(loadedStates) ? loadedStates : [];
  console.log(`[PROXY] 📊 Loaded ${centralWalletStates.length} existing central wallet states from storage`);
  if (centralWalletStates.length > 0) {
    console.log('[PROXY] 📊 First central wallet state sample:', centralWalletStates[0]);
  }
} catch (error) {
  console.error('[PROXY] Error loading centralWalletStates from storage:', error);
  centralWalletStates = [];
}


// Load existing walletSummaries from file storage on startup
try {
  console.log('[PROXY] 📊 Attempting to load walletSummaries from storage...');
  const loadedSummaries = getStoredData('walletSummaries');
  walletSummaries = Array.isArray(loadedSummaries) ? loadedSummaries : [];
  console.log(`[PROXY] 📊 Loaded ${walletSummaries.length} existing wallet summaries from storage`);
  if (walletSummaries.length > 0) {
    console.log('[PROXY] 📊 First wallet summary sample:', walletSummaries[0]);
  }
} catch (error) {
  console.error('[PROXY] Error loading walletSummaries from storage:', error);
  walletSummaries = [];
}

// Run data integrity check after loading all data
console.log('[PROXY] 🔍 Running data integrity check...');
logDataIntegrityCheck();

// Trade entity endpoints
app.get('/api/entities/Trade', (req, res) => {
  console.log('[PROXY] 📊 GET /api/entities/Trade - Returning trades:', trades.length);
  console.log('[PROXY] 📊 Trades array:', trades);
  console.log('[PROXY] 📊 Trades type:', typeof trades);
  console.log('[PROXY] 📊 Trades is array:', Array.isArray(trades));
  console.log('[PROXY] 📊 About to return trades, length:', trades.length);
  res.json({ success: true, data: trades });
});

// Trade endpoints (for localClient compatibility)
app.get('/api/trades', (req, res) => {
  console.log('[PROXY] 📊 GET /api/trades - Query params:', req.query);
  console.log('[PROXY] 📊 GET /api/trades - Total trades in memory:', trades.length);
  
  let filteredTrades = trades;
  
  // CRITICAL FIX: Handle trading_mode filter (most important for accurate P&L)
  if (req.query.trading_mode) {
    filteredTrades = filteredTrades.filter(trade => trade.trading_mode === req.query.trading_mode);
    console.log('[PROXY] 📊 GET /api/trades - Filtered by trading_mode:', req.query.trading_mode, 'Found:', filteredTrades.length);
  }
  
  // CRITICAL FIX: Handle exit_timestamp filter (for closed trades only)
  // Support both $ne:null format (from Supabase) and direct IS NOT NULL check
  if (req.query.exit_timestamp) {
    try {
      // Try to parse as JSON (for Supabase-style filters like {"$ne":null})
      const exitTimestampFilter = JSON.parse(req.query.exit_timestamp);
      if (exitTimestampFilter.$ne === null || exitTimestampFilter.$ne === undefined) {
        // Filter for trades where exit_timestamp IS NOT NULL
        filteredTrades = filteredTrades.filter(trade => trade.exit_timestamp != null);
        console.log('[PROXY] 📊 GET /api/trades - Filtered by exit_timestamp IS NOT NULL, Found:', filteredTrades.length);
      } else if (exitTimestampFilter.$gte) {
        // Greater than or equal
        filteredTrades = filteredTrades.filter(trade => trade.exit_timestamp && new Date(trade.exit_timestamp) >= new Date(exitTimestampFilter.$gte));
        console.log('[PROXY] 📊 GET /api/trades - Filtered by exit_timestamp >=', exitTimestampFilter.$gte, 'Found:', filteredTrades.length);
      } else if (exitTimestampFilter.$lt) {
        // Less than
        filteredTrades = filteredTrades.filter(trade => trade.exit_timestamp && new Date(trade.exit_timestamp) < new Date(exitTimestampFilter.$lt));
        console.log('[PROXY] 📊 GET /api/trades - Filtered by exit_timestamp <', exitTimestampFilter.$lt, 'Found:', filteredTrades.length);
      }
    } catch (e) {
      // If not JSON, treat as direct value comparison
      if (req.query.exit_timestamp !== 'null' && req.query.exit_timestamp !== 'undefined') {
        filteredTrades = filteredTrades.filter(trade => trade.exit_timestamp === req.query.exit_timestamp);
        console.log('[PROXY] 📊 GET /api/trades - Filtered by exit_timestamp:', req.query.exit_timestamp, 'Found:', filteredTrades.length);
      }
    }
  }
  
  // Handle filtering by trade_id
  if (req.query.trade_id) {
    filteredTrades = filteredTrades.filter(trade => trade.trade_id === req.query.trade_id);
    console.log('[PROXY] 📊 GET /api/trades - Filtered by trade_id:', req.query.trade_id, 'Found:', filteredTrades.length);
  }
  
  // Handle other filters if needed
  if (req.query.symbol) {
    filteredTrades = filteredTrades.filter(trade => trade.symbol === req.query.symbol);
    console.log('[PROXY] 📊 GET /api/trades - Filtered by symbol:', req.query.symbol, 'Found:', filteredTrades.length);
  }
  
  // CRITICAL: Filter out trades without exit_timestamp (they're not closed yet)
  // Only show closed trades in trade history
  const beforeExitFilter = filteredTrades.length;
  filteredTrades = filteredTrades.filter(trade => trade.exit_timestamp != null && trade.exit_timestamp !== undefined);
  if (beforeExitFilter !== filteredTrades.length) {
    console.log('[PROXY] 📊 GET /api/trades - Filtered out trades without exit_timestamp:', beforeExitFilter - filteredTrades.length, 'remaining:', filteredTrades.length);
  }
  
  // Handle ordering
  if (req.query.orderBy) {
    const orderBy = req.query.orderBy;
    const direction = orderBy.startsWith('-') ? -1 : 1;
    const key = orderBy.replace(/^-/, '');
    console.log('[debug_save] GET /api/trades: Sorting by', key, 'direction:', direction);
    filteredTrades.sort((a, b) => {
      // Handle null/undefined values
      if (a[key] == null && b[key] == null) return 0;
      if (a[key] == null) return 1 * direction; // nulls last
      if (b[key] == null) return -1 * direction;
      // Convert to Date for proper comparison if both are strings/dates
      const aVal = a[key] instanceof Date ? a[key] : new Date(a[key]);
      const bVal = b[key] instanceof Date ? b[key] : new Date(b[key]);
      if (aVal < bVal) return -1 * direction;
      if (aVal > bVal) return 1 * direction;
      return 0;
    });
    //console.log('[debug_save] GET /api/trades: After sorting, first trade exit_timestamp:', filteredTrades[0]?.exit_timestamp);
    //console.log('[debug_save] GET /api/trades: After sorting, first trade position_id:', filteredTrades[0]?.position_id);
    //console.log('[PROXY] 📊 GET /api/trades - Ordered by:', orderBy);
  }
  
  // Handle offset
  if (req.query.offset) {
    const offset = parseInt(req.query.offset, 10);
    filteredTrades = filteredTrades.slice(offset);
    //console.log('[PROXY] 📊 GET /api/trades - Offset by:', offset);
  }
  
  // Handle limit
  if (req.query.limit) {
    const limit = parseInt(req.query.limit, 10);
    const beforeLimit = filteredTrades.length;
    filteredTrades = filteredTrades.slice(0, limit);
    //console.log('[debug_save] GET /api/trades: Before limit:', beforeLimit, 'After limit:', filteredTrades.length);
    //console.log('[debug_save] GET /api/trades: After limit, first trade exit_timestamp:', filteredTrades[0]?.exit_timestamp);
    //console.log('[debug_save] GET /api/trades: After limit, first trade position_id:', filteredTrades[0]?.position_id);
    //console.log('[PROXY] 📊 GET /api/trades - Limited to:', limit);
  }
  
  // CRITICAL: Log P&L calculation for debugging
  const totalPnl = filteredTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
  //console.log('[PROXY] 📊 GET /api/trades - Returning filtered trades:', filteredTrades.length);
  //console.log('[PROXY] 📊 GET /api/trades - Total P&L of filtered trades:', totalPnl.toFixed(2));
  //console.log('[PROXY] 📊 GET /api/trades - Expected SQL result (for testnet):', totalPnl.toFixed(2));
  
  res.json({ success: true, data: filteredTrades });
});

// DELETE /api/trades/:id endpoint
app.delete('/api/trades/:id', (req, res) => {
  const tradeId = req.params.id;
  console.log('[PROXY] 📊 DELETE /api/trades/:id - Deleting trade:', tradeId);
  
  const initialLength = trades.length;
  trades = trades.filter(trade => trade.id !== tradeId);
  const finalLength = trades.length;
  
  if (initialLength > finalLength) {
    console.log('[PROXY] 📊 DELETE /api/trades/:id - Trade deleted successfully');
    saveTradesToFile();
    res.json({ success: true, message: 'Trade deleted successfully' });
  } else {
    console.log('[PROXY] 📊 DELETE /api/trades/:id - Trade not found:', tradeId);
    res.status(404).json({ success: false, message: 'Trade not found' });
  }
});

// DELETE /api/trades endpoint - Delete all trades
app.delete('/api/trades', (req, res) => {
  console.log('[PROXY] 📊 DELETE /api/trades - Deleting all trades');
  
  const initialLength = trades.length;
  trades = [];
  
  console.log('[PROXY] 📊 DELETE /api/trades - Deleted', initialLength, 'trades');
  
  // Save empty trades array to persistent storage
  try {
    saveTradesToFile();
    console.log('[PROXY] 📊 Saved empty trades to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving empty trades to storage:', error);
  }
  
  res.json({ success: true, message: `Deleted ${initialLength} trades successfully` });
});

app.post('/api/entities/Trade', async (req, res) => {
  //console.log('[debug_save] ==========================================');
  //console.log('[debug_save] POST /api/entities/Trade - Creating trade');
  //console.log('[debug_save] Request received at:', new Date().toISOString());
  //console.log('[debug_save] Request body keys:', Object.keys(req.body || {}));
  //console.log('[debug_save] Trade has duration_hours:', req.body?.duration_hours !== undefined, 'value:', req.body?.duration_hours);
  //console.log('[debug_save] Trade has duration_seconds:', req.body?.duration_seconds !== undefined, 'value:', req.body?.duration_seconds);
  //console.log('[debug_save] Trade has exit_reason:', req.body?.exit_reason !== undefined, 'value:', req.body?.exit_reason);
  //console.log('[debug_save] Trade has position_id:', req.body?.position_id !== undefined, 'value:', req.body?.position_id);
  //console.log('[debug_save] Trade has trade_id:', req.body?.trade_id !== undefined, 'value:', req.body?.trade_id);
  //console.log('[debug_save] Trade symbol:', req.body?.symbol);
  //console.log('[debug_save] ==========================================');
  
  const newTrade = {
    id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  trades.push(newTrade);
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved new trade to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving trade to storage:', error);
  }
  
  // Save to database
  try {
    const saved = await saveTradeToDB(newTrade);
    if (saved) {
      //console.log('[debug_save] ✅ Successfully saved new trade to database');
      // CRITICAL: The trade is already in the in-memory array (from trades.push above)
      // No need to reload from database - the in-memory array is already up-to-date
    } else {
      console.error('[debug_save] ❌ Failed to save trade to database (saveTradeToDB returned false - likely duplicate or missing position_id)');
      console.error('[debug_save] ❌ Trade ID:', newTrade.id, 'Position ID:', newTrade.position_id);
      // Remove from in-memory array if database save failed
      const index = trades.findIndex(t => t.id === newTrade.id);
      if (index !== -1) {
        trades.splice(index, 1);
        console.log('[debug_save] 🔄 Removed trade from in-memory array (database save failed)');
      }
    }
  } catch (error) {
    console.error('[debug_save] ❌ Error saving trade to database:', error);
    console.error('[debug_save] ❌ Error stack:', error.stack);
    // Remove from in-memory array if database save failed
    const index = trades.findIndex(t => t.id === newTrade.id);
    if (index !== -1) {
      trades.splice(index, 1);
      //console.log('[debug_save] 🔄 Removed trade from in-memory array (database save error)');
    }
  }
  
  //console.log('[debug_save] Created trade with ID:', newTrade.id);
  //console.log('[debug_save] Total trades:', trades.length);
  res.json({ success: true, data: newTrade });
});

app.post('/api/trades', async (req, res) => {
  //console.log('[PROXY] 📊 POST /api/trades - Creating trade');
  const newTrade = {
    id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...req.body,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString()
  };
  
  trades.push(newTrade);
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    //console.log('[PROXY] 📊 Saved new trade to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving trade to storage:', error);
  }
  
  // Save to database
  try {
    const saved = await saveTradeToDB(newTrade);
    if (saved) {
      //console.log('[PROXY] 📊 ✅ Successfully saved new trade to database');
    } else {
      console.error('[PROXY] ❌ Failed to save trade to database (saveTradeToDB returned false - likely duplicate or missing position_id)');
    }
  } catch (error) {
    console.error('[PROXY] ❌ Error saving trade to database:', error);
    console.error('[PROXY] ❌ Error stack:', error.stack);
  }
  
  //console.log('[PROXY] 📊 Created trade with ID:', newTrade.id);
  //console.log('[PROXY] 📊 Total trades:', trades.length);
  res.json({ success: true, data: newTrade });
});

// Trade bulkCreate endpoint
app.post('/api/entities/Trade/bulkCreate', async (req, res) => {
  //console.log('[PROXY] 📊 POST /api/entities/Trade/bulkCreate - Creating bulk trades');
  const tradesToCreate = req.body;
  
  if (!Array.isArray(tradesToCreate)) {
    return res.status(400).json({ success: false, error: 'Request body must be an array of trades' });
  }
  
  const createdTrades = [];
  
  for (const tradeData of tradesToCreate) {
    const newTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...tradeData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    trades.push(newTrade);
    createdTrades.push(newTrade);
  }
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved bulk trades to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving bulk trades to storage:', error);
  }
  
  // Save to database
  try {
    let savedCount = 0;
    let failedCount = 0;
    for (const trade of createdTrades) {
      const saved = await saveTradeToDB(trade);
      if (saved) {
        savedCount++;
      } else {
        failedCount++;
        console.error('[PROXY] ❌ Failed to save trade in bulk:', trade.id || trade.trade_id);
      }
    }
    console.log('[PROXY] 📊 Saved bulk trades to database:', savedCount, 'saved,', failedCount, 'failed');
  } catch (error) {
    console.error('[PROXY] ❌ Error saving bulk trades to database:', error);
    console.error('[PROXY] ❌ Error stack:', error.stack);
  }
  
  console.log('[PROXY] 📊 Created bulk trades:', createdTrades.length);
  console.log('[PROXY] 📊 Total trades:', trades.length);
  res.json({ success: true, data: createdTrades });
});

// Trade bulkCreate endpoint for /api/trades
app.post('/api/trades/bulkCreate', async (req, res) => {
  console.log('[PROXY] 📊 POST /api/trades/bulkCreate - Creating bulk trades');
  const tradesToCreate = req.body;
  
  if (!Array.isArray(tradesToCreate)) {
    return res.status(400).json({ success: false, error: 'Request body must be an array of trades' });
  }
  
  const createdTrades = [];
  
  for (const tradeData of tradesToCreate) {
    const newTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...tradeData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    trades.push(newTrade);
    createdTrades.push(newTrade);
  }
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved bulk trades to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving bulk trades to storage:', error);
  }
  
  // Save to database
  try {
    let savedCount = 0;
    let failedCount = 0;
    for (const trade of createdTrades) {
      const saved = await saveTradeToDB(trade);
      if (saved) {
        savedCount++;
      } else {
        failedCount++;
        console.error('[PROXY] ❌ Failed to save trade in bulk:', trade.id || trade.trade_id);
      }
    }
    console.log('[PROXY] 📊 Saved bulk trades to database:', savedCount, 'saved,', failedCount, 'failed');
  } catch (error) {
    console.error('[PROXY] ❌ Error saving bulk trades to database:', error);
    console.error('[PROXY] ❌ Error stack:', error.stack);
  }
  
  console.log('[PROXY] 📊 Created bulk trades:', createdTrades.length);
  console.log('[PROXY] 📊 Total trades:', trades.length);
  res.json({ success: true, data: createdTrades });
});

app.put('/api/entities/Trade/:id', (req, res) => {
  const tradeId = req.params.id;
  const updateData = req.body;
  
  console.log('[PROXY] 📊 PUT /api/entities/Trade/' + tradeId + ' - Updating trade');
  
  const tradeIndex = trades.findIndex(trade => trade.id === tradeId);
  
  if (tradeIndex === -1) {
    return res.status(404).json({ success: false, error: 'Trade not found' });
  }
  
  trades[tradeIndex] = {
    ...trades[tradeIndex],
    ...updateData,
    updated_date: new Date().toISOString()
  };
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved updated trade to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving updated trade to storage:', error);
  }
  
  console.log('[PROXY] 📊 Updated trade:', tradeId);
  res.json({ success: true, data: trades[tradeIndex] });
});

app.delete('/api/entities/Trade/:id', (req, res) => {
  const tradeId = req.params.id;
  
  console.log('[PROXY] 📊 DELETE /api/entities/Trade/' + tradeId + ' - Deleting trade');
  
  const tradeIndex = trades.findIndex(trade => trade.id === tradeId);
  
  if (tradeIndex === -1) {
    return res.status(404).json({ success: false, error: 'Trade not found' });
  }
  
  const deletedTrade = trades.splice(tradeIndex, 1)[0];
  
  // Save to persistent storage
  try {
    saveStoredData('trades', trades);
    console.log('[PROXY] 📊 Saved trades after deletion to persistent storage');
  } catch (error) {
    console.error('[PROXY] Error saving trades after deletion to storage:', error);
  }
  
  console.log('[PROXY] 📊 Deleted trade:', tradeId);
  console.log('[PROXY] 📊 Remaining trades:', trades.length);
  res.json({ success: true, data: deletedTrade });
});

// Fix trade entry prices endpoint
// Endpoint to reload trades from database and refresh storage
app.post('/api/trades/reload-from-database', async (req, res) => {
    if (!dbClient) {
        return res.status(503).json({ success: false, error: 'Database not available' });
    }
    
    try {
        console.log('[PROXY] 🔄 POST /api/trades/reload-from-database - Reloading trades from database...');
        
        // Load trades from database
        const dbTrades = await loadTradesFromDB();
        
        if (dbTrades.length === 0) {
            console.warn('[PROXY] ⚠️ No trades found in database');
        }
        
        // Replace in-memory trades array
        const oldCount = trades.length;
        trades = dbTrades;
        
        // Save to persistent storage
        saveTradesToFile();
        
        console.log(`[PROXY] ✅ Reloaded trades from database: ${oldCount} → ${trades.length} trades`);
        
        res.json({
            success: true,
            oldCount: oldCount,
            newCount: trades.length,
            message: `Reloaded ${trades.length} trades from database and saved to trades.json`
        });
    } catch (error) {
        console.error('[PROXY] ❌ Error reloading trades from database:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/trades/remove-duplicates', async (req, res) => {
  console.log('[PROXY] 🔧 POST /api/trades/remove-duplicates - Removing duplicate trades');
  
  if (!dbClient) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }
  
  try {
    // Find duplicate trades: same symbol, entry_price, exit_price, quantity, entry_timestamp (within 1 second), and strategy_name
    const findDuplicatesQuery = `
      WITH duplicate_groups AS (
        SELECT 
          symbol,
          strategy_name,
          entry_price,
          exit_price,
          quantity,
          DATE_TRUNC('second', entry_timestamp) as entry_timestamp_rounded,
          trading_mode,
          COUNT(*) as dup_count,
          ARRAY_AGG(id ORDER BY exit_timestamp ASC, id ASC) as trade_ids
        FROM trades
        WHERE exit_timestamp IS NOT NULL
        GROUP BY symbol, strategy_name, entry_price, exit_price, quantity, DATE_TRUNC('second', entry_timestamp), trading_mode
        HAVING COUNT(*) > 1
      )
      SELECT 
        trade_ids[1] as keep_id,
        trade_ids[2:] as duplicate_ids
      FROM duplicate_groups
    `;
    
    const duplicatesResult = await dbClient.query(findDuplicatesQuery);
    const duplicateIds = [];
    
    duplicatesResult.rows.forEach(row => {
      if (row.duplicate_ids && Array.isArray(row.duplicate_ids)) {
        duplicateIds.push(...row.duplicate_ids);
      }
    });
    
    if (duplicateIds.length === 0) {
      return res.json({ 
        success: true, 
        removedCount: 0,
        message: 'No duplicate trades found' 
      });
    }
    
    // Delete duplicate trades (keep the first one in each group)
    const deleteQuery = `DELETE FROM trades WHERE id = ANY($1::uuid[]) RETURNING id`;
    const deleteResult = await dbClient.query(deleteQuery, [duplicateIds]);
    
    const removedCount = deleteResult.rowCount || 0;
    
    // Also remove from in-memory trades array
    const initialLength = trades.length;
    trades = trades.filter(t => !duplicateIds.includes(t.id));
    const removedFromMemory = initialLength - trades.length;
    
    // Save updated trades array to persistent storage
    try {
      saveStoredData('trades', trades);
      console.log('[PROXY] 📊 Saved deduplicated trades to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving deduplicated trades to storage:', error);
    }
    
    console.log(`[PROXY] ✅ Removed ${removedCount} duplicate trades from database and ${removedFromMemory} from memory`);
    
    res.json({
      success: true,
      removedCount: removedCount,
      removedFromMemory: removedFromMemory,
      duplicateIds: duplicateIds.slice(0, 10) // Return first 10 for debugging
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error removing duplicate trades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/trades/fix-entry-prices', async (req, res) => {
  console.log('[PROXY] 🔧 POST /api/trades/fix-entry-prices - Fixing incorrect entry and exit prices');
  
  if (!dbClient) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }
  
  try {
    // Expected price ranges for common symbols
    const EXPECTED_PRICE_RANGES = {
      'ETH/USDT': { min: 2500, max: 5000 },
      'BTC/USDT': { min: 40000, max: 80000 },
      'SOL/USDT': { min: 100, max: 300 },
      'BNB/USDT': { min: 300, max: 800 },
      'ADA/USDT': { min: 0.3, max: 2.0 },
      'DOGE/USDT': { min: 0.05, max: 0.5 },
      'XRP/USDT': { min: 0.4, max: 2.0 },
    };
    
    const isEntryPriceSuspicious = (symbol, entryPrice, exitPrice) => {
      const range = EXPECTED_PRICE_RANGES[symbol];
      if (!range) return false;
      if (entryPrice < range.min * 0.8 && exitPrice >= range.min * 0.9) return true;
      if (entryPrice > 0 && exitPrice > 0) {
        const priceDiff = Math.abs(exitPrice - entryPrice);
        const priceDiffPercent = (priceDiff / Math.max(entryPrice, exitPrice)) * 100;
        if (priceDiffPercent > 50 && entryPrice < range.min * 0.9 && exitPrice >= range.min * 0.9) return true;
      }
      return false;
    };
    
    const isExitPriceSuspicious = (symbol, entryPrice, exitPrice) => {
      const range = EXPECTED_PRICE_RANGES[symbol];
      if (!range) return false;
      // Exit price is way too low/high compared to entry and range
      if (exitPrice < range.min * 0.5 && entryPrice >= range.min * 0.9) return true;
      if (exitPrice > range.max * 2 && entryPrice <= range.max * 1.1) return true;
      // Exit price differs dramatically from entry (>50% difference) when entry is valid
      if (entryPrice > 0 && exitPrice > 0 && entryPrice >= range.min * 0.9 && entryPrice <= range.max * 1.1) {
        const priceDiff = Math.abs(exitPrice - entryPrice);
        const priceDiffPercent = (priceDiff / entryPrice) * 100;
        if (priceDiffPercent > 50 && exitPrice < range.min * 0.9) return true;
      }
      return false;
    };
    
    const recalculateEntryPrice = (exitPrice, pnlPercentage, direction = 'long') => {
      if (!exitPrice || exitPrice <= 0 || !pnlPercentage) return null;
      if (direction === 'long' || direction === 'BUY') {
        const denominator = 1 + (parseFloat(pnlPercentage) / 100);
        return denominator > 0 ? exitPrice / denominator : null;
      } else {
        const denominator = 1 - (parseFloat(pnlPercentage) / 100);
        return denominator > 0 ? exitPrice / denominator : null;
      }
    };
    
    const recalculatePnl = (entryPrice, exitPrice, quantity, commission = 0) => {
      if (!entryPrice || !exitPrice || !quantity) return { pnlUsdt: 0, pnlPercent: 0 };
      const entryValue = entryPrice * quantity;
      const exitValue = exitPrice * quantity;
      const grossPnl = exitValue - entryValue;
      const entryFees = entryValue * 0.001;
      const exitFees = exitValue * 0.001;
      const totalFees = commission || (entryFees + exitFees);
      const netPnl = grossPnl - totalFees;
      const pnlPercent = entryValue > 0 ? (netPnl / entryValue) * 100 : 0;
      return { pnlUsdt: netPnl, pnlPercent: pnlPercent, totalFees: totalFees };
    };
    
    // Fetch all trades
    const tradesResult = await dbClient.query(`
      SELECT id, symbol, entry_price, exit_price, pnl_usdt, pnl_percent, 
             quantity, side, commission, entry_timestamp, exit_timestamp
      FROM trades
      WHERE exit_price IS NOT NULL AND exit_price > 0
        AND entry_price IS NOT NULL AND entry_price > 0
      ORDER BY exit_timestamp DESC
    `);
    
    const allTrades = tradesResult.rows;
    const fixedTrades = [];
    let fixedCount = 0;
    
    const recalculateExitPrice = (entryPrice, pnlPercentage, direction = 'long') => {
      if (!entryPrice || entryPrice <= 0 || pnlPercentage === null || pnlPercentage === undefined) return null;
      // For long positions: exit = entry * (1 + pnl%/100)
      // For short positions: exit = entry * (1 - pnl%/100)
      if (direction === 'long' || direction === 'BUY') {
        return entryPrice * (1 + (parseFloat(pnlPercentage) / 100));
      } else {
        return entryPrice * (1 - (parseFloat(pnlPercentage) / 100));
      }
    };
    
    for (const trade of allTrades) {
      const symbol = trade.symbol;
      let entryPrice = parseFloat(trade.entry_price);
      let exitPrice = parseFloat(trade.exit_price);
      const pnlPercent = parseFloat(trade.pnl_percent || 0);
      const quantity = parseFloat(trade.quantity || 0);
      const direction = trade.side || 'BUY';
      const commission = parseFloat(trade.commission || 0);
      const range = EXPECTED_PRICE_RANGES[symbol];
      
      let needsEntryFix = isEntryPriceSuspicious(symbol, entryPrice, exitPrice);
      let needsExitFix = isExitPriceSuspicious(symbol, entryPrice, exitPrice);
      
      // Skip if neither needs fixing
      if (!needsEntryFix && !needsExitFix) continue;
      
      // Calculate duration
      let durationMinutes = null;
      if (trade.entry_timestamp && trade.exit_timestamp) {
        const entryTime = new Date(trade.entry_timestamp);
        const exitTime = new Date(trade.exit_timestamp);
        durationMinutes = (exitTime - entryTime) / (1000 * 60);
      }
      
      // Fix entry price if needed
      if (needsEntryFix) {
        let recalculatedEntryPrice = null;
        
        // Strategy 1: Quick close (< 5 min) - entry should be close to exit
        if (durationMinutes !== null && durationMinutes < 5 && range && exitPrice >= range.min * 0.9) {
          recalculatedEntryPrice = pnlPercent > 0 ? exitPrice * 0.99 : exitPrice * 1.01;
        }
        
        // Strategy 2: Recalculate from P&L
        if (!recalculatedEntryPrice || recalculatedEntryPrice <= 0) {
          recalculatedEntryPrice = recalculateEntryPrice(exitPrice, pnlPercent, direction);
        }
        
        // Strategy 3: Use exit price as fallback if valid
        if (!recalculatedEntryPrice || recalculatedEntryPrice <= 0) {
          if (range && exitPrice >= range.min * 0.9 && exitPrice <= range.max * 1.1 && entryPrice < range.min * 0.8) {
            recalculatedEntryPrice = exitPrice * 0.995;
          }
        }
        
        if (recalculatedEntryPrice && recalculatedEntryPrice > 0) {
          if (!range || (recalculatedEntryPrice >= range.min * 0.9 && recalculatedEntryPrice <= range.max * 1.1)) {
            entryPrice = recalculatedEntryPrice;
            needsEntryFix = true;
          } else {
            needsEntryFix = false;
          }
        } else {
          needsEntryFix = false;
        }
      }
      
      // Fix exit price if needed
      if (needsExitFix && entryPrice > 0) {
        let recalculatedExitPrice = null;
        
        // CRITICAL FIX: Special handling for ETH trades with exit_price around 1889.03
        // This is a known stale price that should be around 3800-3900 instead
        if (symbol === 'ETH/USDT' && exitPrice >= 1800 && exitPrice <= 2000 && entryPrice >= 3000 && entryPrice <= 5000) {
          console.log(`[PROXY] 🔧 Detected ETH trade with suspicious exit price ${exitPrice} (entry: ${entryPrice}) - using entry-based calculation`);
          // Strategy: Use entry price + P&L percentage (exit should be close to entry for same-day trades)
          recalculatedExitPrice = recalculateExitPrice(entryPrice, pnlPercent, direction);
          // Validate: If recalculated price is still way off, use a more conservative approach
          if (recalculatedExitPrice && Math.abs(recalculatedExitPrice - entryPrice) / entryPrice > 0.3) {
            // If P&L calculation gives unrealistic result, assume exit price should be close to entry
            // (typical same-day trades have small P&L, so exit ~ entry)
            recalculatedExitPrice = entryPrice * (1 + (pnlPercent / 100));
          }
        }
        
        // Strategy 1: Use entry price + P&L percentage if entry is valid
        if (!recalculatedExitPrice && range && entryPrice >= range.min * 0.9 && entryPrice <= range.max * 1.1) {
          recalculatedExitPrice = recalculateExitPrice(entryPrice, pnlPercent, direction);
        }
        
        // Strategy 2: If exit is way too low but entry is valid, use entry price as base
        if (!recalculatedExitPrice || recalculatedExitPrice <= 0) {
          if (range && entryPrice >= range.min * 0.9 && entryPrice <= range.max * 1.1 && exitPrice < range.min * 0.5) {
            // Assume a small change from entry (within 10%)
            recalculatedExitPrice = entryPrice * (1 + (pnlPercent / 100));
          }
        }
        
        // Strategy 3: Quick close - exit should be close to entry
        if (!recalculatedExitPrice || recalculatedExitPrice <= 0) {
          if (durationMinutes !== null && durationMinutes < 5 && range && entryPrice >= range.min * 0.9) {
            recalculatedExitPrice = pnlPercent > 0 ? entryPrice * 1.01 : entryPrice * 0.99;
          }
        }
        
        // Strategy 4: Use entry price directly if exit is way off
        if (!recalculatedExitPrice || recalculatedExitPrice <= 0) {
          if (range && entryPrice >= range.min * 0.9 && exitPrice < range.min * 0.5) {
            recalculatedExitPrice = entryPrice * 0.998; // Small slippage
          }
        }
        
        if (recalculatedExitPrice && recalculatedExitPrice > 0) {
          if (!range || (recalculatedExitPrice >= range.min * 0.9 && recalculatedExitPrice <= range.max * 1.1)) {
            exitPrice = recalculatedExitPrice;
            needsExitFix = true;
          } else {
            needsExitFix = false;
          }
        } else {
          needsExitFix = false;
        }
      }
      
      // Skip if no valid fixes found
      if (!needsEntryFix && !needsExitFix) continue;
      
      // Recalculate P&L with corrected prices
      const { pnlUsdt, pnlPercent: newPnlPercent } = recalculatePnl(entryPrice, exitPrice, quantity, commission);
      
      // Update in database
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;
      
      if (needsEntryFix) {
        updateFields.push(`entry_price = $${paramIndex++}`);
        updateValues.push(entryPrice);
      }
      if (needsExitFix) {
        updateFields.push(`exit_price = $${paramIndex++}`);
        updateValues.push(exitPrice);
      }
      updateFields.push(`pnl_usdt = $${paramIndex++}`);
      updateValues.push(pnlUsdt);
      updateFields.push(`pnl_percent = $${paramIndex++}`);
      updateValues.push(newPnlPercent);
      updateFields.push(`updated_date = CURRENT_TIMESTAMP`);
      updateValues.push(trade.id); // WHERE id = $X
      
      await dbClient.query(`
        UPDATE trades
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
      `, updateValues);
      
      // Update in memory
      const tradeIndex = trades.findIndex(t => t.id === trade.id);
      if (tradeIndex !== -1) {
        if (needsEntryFix) trades[tradeIndex].entry_price = entryPrice;
        if (needsExitFix) trades[tradeIndex].exit_price = exitPrice;
        trades[tradeIndex].pnl_usdt = pnlUsdt;
        trades[tradeIndex].pnl_percent = newPnlPercent;
        trades[tradeIndex].updated_date = new Date().toISOString();
      }
      
      fixedTrades.push({
        id: trade.id,
        symbol: symbol,
        oldEntryPrice: parseFloat(trade.entry_price),
        newEntryPrice: entryPrice,
        oldExitPrice: parseFloat(trade.exit_price),
        newExitPrice: exitPrice,
        oldPnl: trade.pnl_usdt,
        newPnl: pnlUsdt,
        fixedEntry: needsEntryFix,
        fixedExit: needsExitFix
      });
      
      fixedCount++;
    }
    
    // Save to persistent storage
    try {
      saveStoredData('trades', trades);
    } catch (error) {
      console.error('[PROXY] Error saving trades to storage:', error);
    }
    
    console.log(`[PROXY] ✅ Fixed ${fixedCount} trades`);
    res.json({ 
      success: true, 
      fixedCount: fixedCount,
      fixedTrades: fixedTrades
    });
    
  } catch (error) {
    console.error('[PROXY] ❌ Error fixing trade entry prices:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Recalculate P&L for all trades based on their current entry_price, exit_price, and quantity
 * This is useful when exit prices are manually updated in the database
 */
// Clean invalid trades endpoint (removes trades with nulls or invalid prices)
app.post('/api/trades/clean-invalid', async (req, res) => {
  console.log('[PROXY] 🧹 POST /api/trades/clean-invalid - Cleaning invalid trades');
  
  if (!dbClient) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }
  
  try {
    // Price thresholds
    const PRICE_THRESHOLDS = {
      'ETH/USDT': { min: 3808 },
      'SOL/USDT': { min: 184.77 },
      'XRP/USDT': { min: 2.47 }
    };
    
    // Critical columns that must not be null (including analytics fields)
    const criticalColumns = [
      'symbol', 'entry_price', 'exit_price', 
      'entry_timestamp', 'exit_timestamp', 'quantity',
      'strategy_name', 'trading_mode', 'pnl_usdt', 'pnl_percent',
      'lpm_score', 'combined_strength', 'conviction_score', 'conviction_breakdown',
      'conviction_multiplier', 'market_regime', 'regime_confidence', 'atr_value',
      'is_event_driven_strategy'
    ];
    
    // Build WHERE clause for null checks - trades with ANY null in critical columns
    const nullChecks = criticalColumns.map(col => `${col} IS NULL`).join(' OR ');
    
    // Build WHERE clause for price threshold violations
    let priceChecks = [];
    for (const [symbol, threshold] of Object.entries(PRICE_THRESHOLDS)) {
      priceChecks.push(`(symbol = '${symbol}' AND (entry_price < ${threshold.min} OR exit_price < ${threshold.min}))`);
    }
    const priceCheckClause = priceChecks.length > 0 ? ` OR (${priceChecks.join(' OR ')})` : '';
    
    // Combine null and price checks with proper parentheses
    const invalidCondition = `(${nullChecks})${priceCheckClause}`;
    
    // Count total trades first for debugging
    const totalCountResult = await dbClient.query('SELECT COUNT(*) as count FROM trades');
    const totalCount = parseInt(totalCountResult.rows[0].count) || 0;
    console.log(`[PROXY] 📊 Total trades in database: ${totalCount}`);
    
    // Count invalid trades
    const countQuery = `
      SELECT COUNT(*) as count
      FROM trades
      WHERE ${invalidCondition}
    `;
    const countResult = await dbClient.query(countQuery);
    const invalidCount = parseInt(countResult.rows[0].count) || 0;
    console.log(`[PROXY] 📊 Invalid trades found: ${invalidCount}`);
    
    if (invalidCount === 0) {
      return res.json({
        success: true,
        deletedCount: 0,
        remainingCount: 0,
        message: 'No invalid trades found'
      });
    }
    
    // Delete invalid trades
    const deleteQuery = `
      DELETE FROM trades
      WHERE ${invalidCondition}
      RETURNING id, symbol, entry_price, exit_price
    `;
    
    const deleteResult = await dbClient.query(deleteQuery);
    const deletedCount = deleteResult.rowCount || 0;
    
    // Update in-memory trades array
    const initialLength = trades.length;
    const deletedIds = deleteResult.rows.map(r => r.id);
    trades = trades.filter(t => !deletedIds.includes(t.id));
    const removedFromMemory = initialLength - trades.length;
    
    // Save to persistent storage
    try {
      saveTradesToFile();
      console.log('[PROXY] 📊 Saved cleaned trades to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving cleaned trades to storage:', error);
    }
    
    // Get remaining count (valid trades = NOT invalid)
    const validCountQuery = `
      SELECT COUNT(*) as count
      FROM trades
      WHERE NOT (${invalidCondition})
    `;
    const remainingResult = await dbClient.query(validCountQuery);
    const remainingCount = parseInt(remainingResult.rows[0].count) || 0;
    
    console.log(`[PROXY] ✅ Removed ${deletedCount} invalid trades from database and ${removedFromMemory} from memory`);
    console.log(`[PROXY] 📊 Remaining trades: ${remainingCount}`);
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      removedFromMemory: removedFromMemory,
      remainingCount: remainingCount,
      deletedSample: deleteResult.rows.slice(0, 10).map(r => ({
        id: r.id,
        symbol: r.symbol,
        entry_price: r.entry_price,
        exit_price: r.exit_price
      }))
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error cleaning invalid trades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete specific trades by IDs endpoint
app.post('/api/trades/delete-by-ids', async (req, res) => {
  console.log('[PROXY] 🗑️  POST /api/trades/delete-by-ids - Deleting specific trades');
  
  if (!dbClient) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }
  
  try {
    const { tradeIds } = req.body;
    
    if (!tradeIds || !Array.isArray(tradeIds) || tradeIds.length === 0) {
      return res.status(400).json({ success: false, error: 'tradeIds array is required' });
    }
    
    console.log(`[PROXY] 📊 Deleting ${tradeIds.length} trades by IDs...`);
    
    // Delete trades from database
    const deleteQuery = `
      DELETE FROM trades
      WHERE id = ANY($1::uuid[])
      RETURNING id, symbol, entry_price, exit_price
    `;
    
    const deleteResult = await dbClient.query(deleteQuery, [tradeIds]);
    const deletedCount = deleteResult.rowCount || 0;
    
    // Update in-memory trades array
    const initialLength = trades.length;
    const deletedIds = deleteResult.rows.map(r => r.id);
    trades = trades.filter(t => !deletedIds.includes(t.id));
    const removedFromMemory = initialLength - trades.length;
    
    // Save to persistent storage
    try {
      saveTradesToFile();
      console.log('[PROXY] 📊 Saved updated trades to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated trades to storage:', error);
    }
    
    // Get remaining count
    const remainingResult = await dbClient.query('SELECT COUNT(*) as count FROM trades');
    const remainingCount = parseInt(remainingResult.rows[0].count) || 0;
    
    console.log(`[PROXY] ✅ Deleted ${deletedCount} trades from database and ${removedFromMemory} from memory`);
    console.log(`[PROXY] 📊 Remaining trades: ${remainingCount}`);
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      removedFromMemory: removedFromMemory,
      remainingCount: remainingCount,
      deletedTrades: deleteResult.rows.map(r => ({
        id: r.id,
        symbol: r.symbol,
        entry_price: r.entry_price,
        exit_price: r.exit_price
      }))
    });
  } catch (error) {
    console.error('[PROXY] ❌ Error deleting trades by IDs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/trades/recalculate-pnl', async (req, res) => {
  console.log('[PROXY] 🔧 POST /api/trades/recalculate-pnl - Recalculating P&L for all trades');

  if (!dbClient) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }

  try {
    const COMMISSION_RATE = 0.001; // 0.1% trading fee

    // Helper function to recalculate P&L
    const recalculatePnl = (entryPrice, exitPrice, quantity) => {
      if (!entryPrice || !exitPrice || !quantity || entryPrice <= 0 || exitPrice <= 0 || quantity <= 0) {
        return { pnlUsdt: 0, pnlPercent: 0, totalFees: 0 };
      }
      const entryValue = entryPrice * quantity;
      const exitValue = exitPrice * quantity;
      const grossPnl = exitValue - entryValue;
      const entryFees = entryValue * COMMISSION_RATE;
      const exitFees = exitValue * COMMISSION_RATE;
      const totalFees = entryFees + exitFees;
      const netPnl = grossPnl - totalFees;
      const pnlPercent = entryValue > 0 ? (netPnl / entryValue) * 100 : 0;
      return { pnlUsdt: netPnl, pnlPercent: pnlPercent, totalFees: totalFees };
    };

    // Fetch all trades with exit prices
    // Note: Database column is 'quantity', but we handle both quantity and quantity_crypto in code
    const tradesResult = await dbClient.query(`
      SELECT id, entry_price, exit_price, 
             COALESCE(quantity, quantity_crypto) as quantity,
             pnl_usdt, pnl_percent, total_fees_usdt, trading_mode
      FROM trades
      WHERE exit_price IS NOT NULL AND exit_price > 0
        AND entry_price IS NOT NULL AND entry_price > 0
        AND (quantity IS NOT NULL AND quantity > 0 OR quantity_crypto IS NOT NULL AND quantity_crypto > 0)
      ORDER BY exit_timestamp DESC
    `);

    const allTrades = tradesResult.rows;
    console.log(`[PROXY] 📊 Found ${allTrades.length} trades to recalculate P&L for`);

    let updatedCount = 0;
    const updatedTrades = [];

    for (const trade of allTrades) {
      const { pnlUsdt, pnlPercent, totalFees } = recalculatePnl(
        parseFloat(trade.entry_price),
        parseFloat(trade.exit_price),
        parseFloat(trade.quantity)
      );

      // Only update if P&L values changed significantly (more than 0.01 USDT or 0.01%)
      const oldPnlUsdt = parseFloat(trade.pnl_usdt || 0);
      const oldPnlPercent = parseFloat(trade.pnl_percent || 0);
      const oldTotalFees = parseFloat(trade.total_fees_usdt || 0);

      const pnlDiff = Math.abs(pnlUsdt - oldPnlUsdt);
      const pnlPercentDiff = Math.abs(pnlPercent - oldPnlPercent);

      if (pnlDiff > 0.01 || pnlPercentDiff > 0.01 || Math.abs(totalFees - oldTotalFees) > 0.01) {
        // Update trade in database
        await dbClient.query(`
          UPDATE trades
          SET pnl_usdt = $1,
              pnl_percent = $2,
              total_fees_usdt = $3,
              updated_date = $4
          WHERE id = $5
        `, [
          pnlUsdt,
          pnlPercent,
          totalFees,
          new Date().toISOString(),
          trade.id
        ]);

        // Update in-memory trades array
        const inMemoryTrade = trades.find(t => t.id === trade.id);
        if (inMemoryTrade) {
          inMemoryTrade.pnl_usdt = pnlUsdt;
          inMemoryTrade.pnl_percentage = pnlPercent;
          inMemoryTrade.pnl_percent = pnlPercent;
          inMemoryTrade.total_fees_usdt = totalFees;
        }

        updatedTrades.push({
          id: trade.id,
          trading_mode: trade.trading_mode,
          oldPnlUsdt: oldPnlUsdt,
          newPnlUsdt: pnlUsdt,
          oldPnlPercent: oldPnlPercent,
          newPnlPercent: pnlPercent
        });

        updatedCount++;
      }
    }

    // Save updated trades to persistent storage
    try {
      saveStoredData('trades', trades);
      console.log('[PROXY] 📊 Saved updated trades to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving updated trades to storage:', error);
    }

    console.log(`[PROXY] ✅ Recalculated P&L for ${updatedCount} trades`);
    res.json({
      success: true,
      updatedCount: updatedCount,
      totalTrades: allTrades.length,
      updatedTrades: updatedTrades.slice(0, 10) // Return first 10 for debugging
    });

  } catch (error) {
    console.error('[PROXY] ❌ Error recalculating trade P&L:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// RECONCILIATION FUNCTIONS
// ============================================================================

/**
 * reconcileWalletState - Recalculates wallet state from Trade entity as source of truth
 * AI Name: WalletStateReconciler
 */
app.post('/api/functions/reconcileWalletState', async (req, res) => {
  const { mode } = req.body;
  
  console.log(`[PROXY] 🔄 reconcileWalletState called for mode: ${mode}`);
  
  try {
    // 1. Fetch current wallet state
    const walletStates = centralWalletStates.filter(ws => ws.trading_mode === mode);
    if (walletStates.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No wallet state found for mode: ${mode}` 
      });
    }
    
    const walletState = walletStates[0];
    console.log(`[PROXY] 🔄 Found wallet state: ${walletState.id}`);
    
    // 2. Fetch all closed trades for this mode
    const allTrades = trades.filter(trade => trade.trading_mode === mode);
    console.log(`[PROXY] 🔄 Found ${allTrades.length} trades for mode: ${mode}`);
    
    // 3. Calculate correct aggregated values from trades
    let totalTrades = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalRealizedPnl = 0;
    let totalGrossProfit = 0;
    let totalGrossLoss = 0;
    let totalFees = 0;
    
    for (const trade of allTrades) {
      totalTrades++;
      const pnl = trade.pnl_usdt || 0;
      totalRealizedPnl += pnl;
      
      if (pnl > 0) {
        winningTrades++;
        totalGrossProfit += pnl;
      } else {
        losingTrades++;
        totalGrossLoss += Math.abs(pnl);
      }
      
      totalFees += trade.total_fees_usdt || 0;
    }
    
    // 4. Compare with current wallet state (detect drift)
    const before = {
      total_trades_count: walletState.total_trades_count || 0,
      winning_trades_count: walletState.winning_trades_count || 0,
      losing_trades_count: walletState.losing_trades_count || 0,
      total_realized_pnl: walletState.total_realized_pnl || 0,
      total_gross_profit: walletState.total_gross_profit || 0,
      total_gross_loss: walletState.total_gross_loss || 0,
      total_fees_paid: walletState.total_fees_paid || 0
    };
    
    const after = {
      total_trades_count: totalTrades,
      winning_trades_count: winningTrades,
      losing_trades_count: losingTrades,
      total_realized_pnl: totalRealizedPnl,
      total_gross_profit: totalGrossProfit,
      total_gross_loss: totalGrossLoss,
      total_fees_paid: totalFees,
      last_updated_timestamp: new Date().toISOString()
    };
    
    // 5. Update wallet state with correct values
    const updatedWalletState = {
      ...walletState,
      ...after,
      updated_date: new Date().toISOString()
    };
    
    // Update in memory
    const stateIndex = centralWalletStates.findIndex(ws => ws.id === walletState.id);
    if (stateIndex !== -1) {
      centralWalletStates[stateIndex] = updatedWalletState;
    }
    
    // Save to persistent storage
    try {
      saveStoredData('centralWalletStates', centralWalletStates);
      console.log('[PROXY] 🔄 Saved reconciled wallet state to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving reconciled wallet state to storage:', error);
    }
    
    console.log(`[PROXY] 🔄 Reconciliation complete:`, {
      trades_diff: after.total_trades_count - before.total_trades_count,
      pnl_diff: after.total_realized_pnl - before.total_realized_pnl
    });
    
    // 6. Return reconciliation report
    res.json({
      success: true,
      before,
      after,
      changes: {
        trades_diff: after.total_trades_count - before.total_trades_count,
        pnl_diff: after.total_realized_pnl - before.total_realized_pnl,
        profit_diff: after.total_gross_profit - before.total_gross_profit,
        loss_diff: after.total_gross_loss - before.total_gross_loss,
        fees_diff: after.total_fees_paid - before.total_fees_paid
      }
    });
    
  } catch (error) {
    console.error(`[PROXY] ❌ reconcileWalletState error:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * walletReconciliation - Handles virtual closing of dust positions
 * AI Name: VirtualDustPositionCloser
 */
app.post('/api/functions/walletReconciliation', async (req, res) => {
  const { action, symbol, mode } = req.body;
  
  console.log(`[PROXY] 🔄 walletReconciliation called:`, { action, symbol, mode });
  const debugLogs = [];
  const addLog = (msg, data) => {
    try { debugLogs.push({ ts: Date.now(), msg, data }); } catch (_) {}
  };
  addLog('walletReconciliation_called', { action, symbol, mode });
  
  try {
    if (action === 'virtualCloseDustPositions') {
      // 1. Find open positions for symbol/mode
      const positions = livePositions.filter(pos => 
        pos.symbol === symbol && 
        pos.trading_mode === mode && 
        pos.status === 'open'
      );
      
      console.log(`[PROXY] 🔄 Found ${positions.length} open positions for ${symbol} in ${mode}`);
      addLog('found_open_positions', { count: positions.length });
      
      if (positions.length === 0) {
        // Fallback: if in-memory array lost state, try DB deletion by symbol+mode
        try {
          let deletedRows = 0;
          if (dbClient) {
            const del = await dbClient.query(
              `DELETE FROM live_positions WHERE symbol = $1 AND trading_mode = $2 AND status = 'open' RETURNING id`,
              [symbol, mode]
            );
            deletedRows = del?.rowCount || 0;
            addLog('db_delete_by_symbol_mode', { symbol, mode, deletedRows, ids: (del?.rows || []).map(r => r.id) });
            //console.log(`[POSITION_DEBUG] [POSITION_DB] 🗑️ DB fallback delete by symbol/mode: ${symbol}/${mode} -> ${deletedRows} rows`);
            if (deletedRows > 0) {
                //console.log(`[POSITION_DEBUG] [POSITION_DB] 🗑️ Deleted position IDs:`, (del?.rows || []).map(r => r.id?.substring(0, 8)).join(', '));
            }
          } else {
            addLog('db_unavailable_for_fallback');
            console.warn('[PROXY] ⚠️ DB client unavailable for fallback delete-by-symbol/mode');
          }
        return res.json({ 
          success: true, 
            virtualClosed: deletedRows, 
          symbol, 
          mode,
            message: deletedRows > 0 ? `Deleted ${deletedRows} open positions from DB (fallback)` : 'No open positions found',
            logs: debugLogs
        });
        } catch (fallbackErr) {
          addLog('fallback_delete_error', { error: fallbackErr?.message || String(fallbackErr) });
          console.error('[PROXY] ❌ Fallback DB delete error:', fallbackErr);
          return res.status(500).json({ success: false, error: fallbackErr?.message || 'Fallback DB delete failed', logs: debugLogs });
        }
      }
      
      // 2. Get current market price from Binance (CRITICAL: Must use correct response structure)
      let currentPrice = 0;
      try {
        // CRITICAL FIX: Always fetch fresh price from Binance ticker/price endpoint
        // Response structure: { success: true, data: { symbol: "ETHUSDT", price: "3800.00" } }
        const cleanSymbol = symbol.replace('/', '');
        const priceResponse = await fetch(`http://localhost:3003/api/binance/ticker/price?symbol=${cleanSymbol}&tradingMode=${mode}`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          // CRITICAL: Access price from data.data.price (not data.price)
          if (priceData.success && priceData.data && priceData.data.price) {
            currentPrice = parseFloat(priceData.data.price);
            if (isNaN(currentPrice) || currentPrice <= 0) {
              console.error(`[PROXY] ❌ Invalid price value from Binance for ${symbol}: ${priceData.data.price}`);
              currentPrice = 0;
            } else {
              console.log(`[PROXY] ✅ Fetched fresh price for ${symbol}: $${currentPrice}`);
            }
          } else {
            console.error(`[PROXY] ❌ Invalid price response structure for ${symbol}:`, priceData);
            currentPrice = 0;
          }
        } else {
          console.warn(`[PROXY] ⚠️ Price fetch failed for ${symbol}: HTTP ${priceResponse.status}`);
          currentPrice = 0;
        }
      } catch (priceError) {
        console.error(`[PROXY] ❌ Error fetching price for ${symbol}:`, priceError.message);
        currentPrice = 0;
      }
      
      let closedCount = 0;
      const closedTrades = [];
      
      // 3. For each position, create virtual trade record
      const COMMISSION_RATE = 0.001; // 0.1% trading fee (Binance spot)
      
      // CRITICAL: Define expected price ranges to detect unrealistic prices
      const EXPECTED_PRICE_RANGES = {
        'ETH/USDT': { min: 2500, max: 5000 },
        'BTC/USDT': { min: 40000, max: 80000 },
        'SOL/USDT': { min: 100, max: 300 },
        'BNB/USDT': { min: 200, max: 800 },
        'ADA/USDT': { min: 0.3, max: 2.0 },
        'XRP/USDT': { min: 0.3, max: 3.0 },
        'DOGE/USDT': { min: 0.05, max: 0.5 },
        'DOT/USDT': { min: 3, max: 20 },
        'LINK/USDT': { min: 5, max: 50 },
        'AVAX/USDT': { min: 20, max: 100 },
        'MATIC/USDT': { min: 0.3, max: 2.0 },
        'UNI/USDT': { min: 3, max: 20 },
        'LTC/USDT': { min: 50, max: 200 },
        'ATOM/USDT': { min: 5, max: 30 },
        'XLM/USDT': { min: 0.05, max: 0.5 },
        'VET/USDT': { min: 0.01, max: 0.2 },
        'FIL/USDT': { min: 2, max: 20 },
        'TRX/USDT': { min: 0.05, max: 0.3 },
        'ETC/USDT': { min: 15, max: 100 }
      };
      
      const isPriceRealistic = (symbol, price) => {
        const range = EXPECTED_PRICE_RANGES[symbol];
        if (!range) return true; // Unknown symbol, allow it
        return price >= range.min && price <= range.max;
      };
      
      for (const pos of positions) {
        const qty = Number(pos.quantity_crypto || 0);
        const entryPrice = Number(pos.entry_price || 0);
        
        // CRITICAL FIX: Validate both currentPrice and entryPrice before using
        let exitPrice = 0;
        
        if (currentPrice > 0 && isPriceRealistic(pos.symbol, currentPrice)) {
          exitPrice = currentPrice;
          console.log(`[PROXY] ✅ Using fresh price for ${pos.symbol}: $${exitPrice}`);
          
          // SPECIAL: Extra validation for ETH - alert if outside 3500-4000 range
          if (pos.symbol === 'ETH/USDT') {
            const ETH_ALERT_MIN = 3500;
            const ETH_ALERT_MAX = 4000;
            if (exitPrice < ETH_ALERT_MIN || exitPrice > ETH_ALERT_MAX) {
              console.error(`[PROXY] 🚨🚨🚨 ETH PRICE ALERT 🚨🚨🚨`);
              console.error(`[PROXY] 🚨 ETH exit price ${exitPrice} is outside alert range [${ETH_ALERT_MIN}, ${ETH_ALERT_MAX}]`);
              console.error(`[PROXY] 🚨 Full details:`, {
                symbol: pos.symbol,
                exitPrice: exitPrice,
                entryPrice: entryPrice,
                priceDifference: exitPrice < ETH_ALERT_MIN ? 
                  `${(ETH_ALERT_MIN - exitPrice).toFixed(2)} below minimum` : 
                  `${(exitPrice - ETH_ALERT_MAX).toFixed(2)} above maximum`,
                percentDifference: exitPrice < ETH_ALERT_MIN ? 
                  `${((ETH_ALERT_MIN - exitPrice) / ETH_ALERT_MIN * 100).toFixed(2)}%` : 
                  `${((exitPrice - ETH_ALERT_MAX) / ETH_ALERT_MAX * 100).toFixed(2)}%`,
                entryPrice: entryPrice,
                priceDiffFromEntry: entryPrice > 0 ? `${((exitPrice - entryPrice) / entryPrice * 100).toFixed(2)}%` : 'N/A',
                timestamp: new Date().toISOString(),
                positionId: pos.position_id || pos.id,
                quantity: qty,
                tradingMode: mode,
                source: 'virtualClosePriceFetch'
              });
              console.error(`[PROXY] 🚨🚨🚨 END ETH PRICE ALERT 🚨🚨🚨`);
            }
          }
        } else if (currentPrice > 0) {
          console.error(`[PROXY] ❌ CRITICAL: Fresh price ${currentPrice} is unrealistic for ${pos.symbol}, rejecting`);
          // Don't use unrealistic price - try to fetch again or skip
          exitPrice = 0;
        }
        
        // Only use entryPrice as fallback if it's realistic AND fresh price failed
        if (exitPrice === 0 && entryPrice > 0) {
          if (isPriceRealistic(pos.symbol, entryPrice)) {
            exitPrice = entryPrice;
            console.warn(`[PROXY] ⚠️ Using entry_price as fallback for ${pos.symbol}: $${exitPrice} (fresh fetch failed)`);
          } else {
            console.error(`[PROXY] ❌ CRITICAL: entry_price ${entryPrice} is unrealistic for ${pos.symbol}, cannot use as fallback`);
            // Skip this position - cannot create trade with invalid price
            console.error(`[PROXY] ❌ Skipping virtual close for ${pos.symbol} - no valid price available`);
            continue;
          }
        }
        
        // Final check: if still no valid price, skip this position
        if (exitPrice <= 0) {
          console.error(`[PROXY] ❌ CRITICAL: Cannot virtual close ${pos.symbol} - no valid price (currentPrice=${currentPrice}, entryPrice=${entryPrice})`);
          continue;
        }
        
        // Calculate virtual P&L (GROSS first)
        const pnlGross = (exitPrice - entryPrice) * qty;
        const exitValue = exitPrice * qty;
        const entryValue = Number(pos.entry_value_usdt || 0);
        
        // CRITICAL FIX: Deduct fees from P&L (matching PositionManager logic)
        const entryFees = entryValue * COMMISSION_RATE;
        const exitFees = exitValue * COMMISSION_RATE;
        const totalFees = entryFees + exitFees;
        const pnl = pnlGross - totalFees; // NET P&L (after fees)
        const pnlPct = entryValue > 0 ? (pnl / entryValue) * 100 : 0; // NET P&L percentage
        
        // Create trade record (archive the position)
        const tradeData = {
          trade_id: `${pos.position_id}-vc`, // Virtual closure marker
          position_id: pos.position_id, // CRITICAL: All positions have position_id for duplicate detection
          strategy_name: pos.strategy_name || 'Unknown',
          symbol: pos.symbol,
          direction: pos.direction || 'long',
          entry_price: entryPrice,
          exit_price: exitPrice,
          quantity_crypto: qty,
          entry_value_usdt: Number(pos.entry_value_usdt || (entryPrice * qty)),
          exit_value_usdt: exitValue,
          pnl_usdt: pnl,
          pnl_percentage: pnlPct,
          entry_timestamp: pos.entry_timestamp,
          exit_timestamp: new Date().toISOString(),
          exit_reason: 'dust_virtual_close', // Indicates virtual closure due to dust
          trading_mode: mode,
          trigger_signals: pos.trigger_signals || [],
          combined_strength: pos.combined_strength,
          conviction_score: pos.conviction_score,
          conviction_breakdown: pos.conviction_breakdown,
          conviction_multiplier: pos.conviction_multiplier,
          market_regime: pos.market_regime,
          regime_confidence: pos.regime_confidence,
          atr_value: pos.atr_value,
          is_event_driven_strategy: pos.is_event_driven_strategy,
          // Add Fear & Greed Index and LPM score for analytics
          fear_greed_score: pos.fear_greed_score,
          fear_greed_classification: pos.fear_greed_classification,
          lpm_score: pos.lpm_score,
          total_fees_usdt: totalFees, // CRITICAL: Include calculated fees
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString()
        };
        
        // 🔍 DEBUG: Log analytics fields in proxy server trade creation
        console.log('🔍 [PROXY] Analytics fields in tradeData before adding to trades array:', {
          trade_id: tradeData.trade_id,
          fear_greed_score: tradeData.fear_greed_score,
          fear_greed_classification: tradeData.fear_greed_classification,
          lpm_score: tradeData.lpm_score,
          conviction_breakdown: tradeData.conviction_breakdown,
          conviction_multiplier: tradeData.conviction_multiplier,
          is_event_driven_strategy: tradeData.is_event_driven_strategy,
          market_regime: tradeData.market_regime,
          regime_confidence: tradeData.regime_confidence,
          atr_value: tradeData.atr_value,
          combined_strength: tradeData.combined_strength,
          conviction_score: tradeData.conviction_score,
          trigger_signals: tradeData.trigger_signals
        });
        
        // Add to trades array
        trades.push(tradeData);
        closedTrades.push(tradeData);
        
        // Save to database
        try {
          await saveTradeToDB(tradeData);
          console.log('[PROXY] 💾 Saved virtual closure trade to database:', tradeData.trade_id);
        } catch (error) {
          console.error('[PROXY] Error saving virtual closure trade to database:', error);
          addLog('trade_save_error', { trade_id: tradeData.trade_id, error: error?.message || String(error) });
        }
        
        // Delete LivePosition record (memory + database)
        const posIndex = livePositions.findIndex(p => p.id === pos.id);
        if (posIndex !== -1) {
          console.log('[PROXY] 🧹 Removing position from memory:', pos.id);
          livePositions.splice(posIndex, 1);
          addLog('memory_remove', { id: pos.id, removed: true });
        } else {
          console.log('[PROXY] 🔎 Position not found in memory for removal (may already be removed):', pos.id);
          addLog('memory_remove', { id: pos.id, removed: false });
        }
        try {
          console.log('[PROXY] 🧪 Attempting DB deletion for live_position id:', pos.id);
          const deleted = await deleteLivePositionFromDB(pos.id);
          console.log('[PROXY] ✅ DB deletion attempted for', pos.id, 'result:', deleted);
          addLog('db_delete_attempt', { id: pos.id, deleted });
        } catch (delErr) {
          console.error('[PROXY] ❌ Error deleting live position from DB during virtual close:', delErr?.message || delErr);
          addLog('db_delete_error', { id: pos.id, error: delErr?.message || String(delErr) });
        }
        
        closedCount++;
        console.log(`[PROXY] 🔄 Virtually closed position ${pos.position_id} for ${symbol}`);
        addLog('virtually_closed', { position_id: pos.position_id, id: pos.id });
      }
      
      // Save to persistent storage
      try {
        saveStoredData('trades', trades);
        saveStoredData('livePositions', livePositions);
        console.log('[PROXY] 🔄 Saved virtual closures to persistent storage');
      } catch (error) {
        console.error('[PROXY] Error saving virtual closures to storage:', error);
      }
      
      console.log(`[PROXY] 🔄 Virtual closure complete: ${closedCount} positions closed for ${symbol}`);
      
      // 4. Return summary
      res.json({
        success: true,
        virtualClosed: closedCount,
        symbol,
        mode,
        closedTrades: closedTrades.map(t => ({
          trade_id: t.trade_id,
          pnl_usdt: t.pnl_usdt,
          exit_reason: t.exit_reason
        })),
        logs: debugLogs
      });
      
    } else {
      res.status(400).json({ 
        success: false, 
        error: `Unknown action: ${action}`,
        logs: debugLogs 
      });
    }
    
  } catch (error) {
    console.error(`[PROXY] ❌ walletReconciliation error:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      logs: debugLogs 
    });
  }
});

/**
 * purgeGhostPositions - Cleans up ghost positions that don't exist on Binance
 * AI Name: GhostPositionCleaner
 */
app.post('/api/functions/purgeGhostPositions', async (req, res) => {
  const { mode, walletId } = req.body;
  
  console.log(`[PROXY] 🔄 purgeGhostPositions called:`, { mode, walletId });
  
  try {
    // 1. Get all open positions for this mode/wallet
    const openPositions = livePositions.filter(pos => 
      pos.trading_mode === mode && 
      pos.status === 'open' &&
      (!walletId || pos.wallet_id === walletId)
    );
    
    console.log(`[PROXY] 🔄 Found ${openPositions.length} open positions for ${mode}`);
    
    if (openPositions.length === 0) {
      return res.json({ 
        success: true, 
        purged: 0, 
        mode,
        message: 'No open positions found'
      });
    }
    
    // 2. Get Binance account info to check actual holdings
    let binanceHoldings = [];
    try {
      const accountResponse = await fetch(`http://localhost:3003/api/binance/account?tradingMode=${mode}`);
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        binanceHoldings = accountData.balances || [];
      }
    } catch (binanceError) {
      console.warn(`[PROXY] ⚠️ Could not fetch Binance holdings:`, binanceError.message);
    }
    
    // 3. Identify ghost positions (positions that don't have corresponding Binance holdings)
    const ghostPositions = [];
    const legitimatePositions = [];
    
    for (const position of openPositions) {
      const baseAsset = position.symbol.replace(/USDT$/, '').replace(/BTC$/, '').replace(/ETH$/, '');
      const binanceHolding = binanceHoldings.find(h => h.asset === baseAsset);
      const holdingAmount = parseFloat(binanceHolding?.free || 0);
      const positionAmount = parseFloat(position.quantity_crypto || 0);
      
      // If Binance holding is significantly less than position amount, it's likely a ghost
      // Use a more reasonable threshold: 1% for testnet, 5% for mainnet
      const threshold = mode === 'testnet' ? 0.01 : 0.05; // 1% for testnet, 5% for mainnet
      if (holdingAmount < positionAmount * threshold) {
        ghostPositions.push(position);
      } else {
        legitimatePositions.push(position);
      }
    }
    
    console.log(`[PROXY] 🔄 Identified ${ghostPositions.length} ghost positions and ${legitimatePositions.length} legitimate positions`);
    
    // 4. Purge ghost positions
    let purgedCount = 0;
    const purgedPositions = [];
    
    for (const ghostPos of ghostPositions) {
      // Create a trade record for the ghost position (with minimal data)
      const tradeData = {
        trade_id: `${ghostPos.position_id}-ghost-purge`,
        strategy_name: ghostPos.strategy_name || 'Unknown',
        symbol: ghostPos.symbol,
        direction: ghostPos.direction || 'long',
        entry_price: ghostPos.entry_price || 0,
        exit_price: ghostPos.entry_price || 0, // Use entry price as exit price
        quantity_crypto: ghostPos.quantity_crypto || 0,
        entry_value_usdt: ghostPos.entry_value_usdt || 0,
        exit_value_usdt: 0, // Ghost position has no value
        pnl_usdt: -(ghostPos.entry_value_usdt || 0), // Loss equal to entry value
        pnl_percentage: -100, // 100% loss
        entry_timestamp: ghostPos.entry_timestamp,
        exit_timestamp: new Date().toISOString(),
        exit_reason: 'ghost_position_purge',
        trading_mode: mode,
        trigger_signals: ghostPos.trigger_signals || [],
        combined_strength: ghostPos.combined_strength,
        conviction_score: ghostPos.conviction_score,
        conviction_breakdown: ghostPos.conviction_breakdown,
        conviction_multiplier: ghostPos.conviction_multiplier,
        market_regime: ghostPos.market_regime,
        regime_confidence: ghostPos.regime_confidence,
        atr_value: ghostPos.atr_value,
        is_event_driven_strategy: ghostPos.is_event_driven_strategy,
        // Add Fear & Greed Index and LPM score for analytics
        fear_greed_score: ghostPos.fear_greed_score,
        fear_greed_classification: ghostPos.fear_greed_classification,
        lpm_score: ghostPos.lpm_score,
        total_fees_usdt: 0,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString()
        };
        
        // 🔍 DEBUG: Log analytics fields in ghost position purge trade creation
        console.log('🔍 [PROXY] Analytics fields in ghost purge tradeData:', {
          trade_id: tradeData.trade_id,
          fear_greed_score: tradeData.fear_greed_score,
          fear_greed_classification: tradeData.fear_greed_classification,
          lpm_score: tradeData.lpm_score,
          conviction_breakdown: tradeData.conviction_breakdown,
          conviction_multiplier: tradeData.conviction_multiplier,
          is_event_driven_strategy: tradeData.is_event_driven_strategy,
          market_regime: tradeData.market_regime,
          regime_confidence: tradeData.regime_confidence,
          atr_value: tradeData.atr_value,
          combined_strength: tradeData.combined_strength,
          conviction_score: tradeData.conviction_score,
          trigger_signals: tradeData.trigger_signals
        });
        
        // Add to trades array
        trades.push(tradeData);
      purgedPositions.push(tradeData);
      
      // Save to database
      try {
        await saveTradeToDB(tradeData);
        console.log('[PROXY] 💾 Saved ghost purge trade to database:', tradeData.trade_id);
      } catch (error) {
        console.error('[PROXY] Error saving ghost purge trade to database:', error);
      }
      
      // Remove from livePositions
      const posIndex = livePositions.findIndex(p => p.id === ghostPos.id);
      if (posIndex !== -1) {
        livePositions.splice(posIndex, 1);
      }
      
      purgedCount++;
      console.log(`[PROXY] 🔄 Purged ghost position ${ghostPos.position_id} for ${ghostPos.symbol}`);
    }
    
    // Save to persistent storage
    try {
      saveStoredData('trades', trades);
      saveStoredData('livePositions', livePositions);
      console.log('[PROXY] 🔄 Saved ghost position purges to persistent storage');
    } catch (error) {
      console.error('[PROXY] Error saving ghost position purges to storage:', error);
    }
    
    console.log(`[PROXY] 🔄 Ghost position purge complete: ${purgedCount} positions purged`);
    
    // 5. Return summary
    res.json({
      success: true,
      purged: purgedCount,
      mode,
      summary: {
        totalPositions: openPositions.length,
        ghostPositions: ghostPositions.length,
        legitimatePositions: legitimatePositions.length,
        purgedPositions: purgedCount
      },
      purgedPositions: purgedPositions.map(t => ({
        trade_id: t.trade_id,
        symbol: t.symbol,
        pnl_usdt: t.pnl_usdt,
        exit_reason: t.exit_reason
      }))
    });
    
  } catch (error) {
    console.error(`[PROXY] ❌ purgeGhostPositions error:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Port conflict detection and cleanup
function checkAndKillExistingProcesses() {
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    exec(`lsof -ti:${PORT}`, (error, stdout) => {
      if (stdout.trim()) {
        const pids = stdout.trim().split('\n').filter(Boolean);
        console.log(`[PROXY] 🔍 Found existing processes on port ${PORT}: ${pids.join(', ')}`);
        console.log(`[PROXY] 🔄 Attempting to kill processes...`);
        
        // Try without sudo first
        exec(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, (killError) => {
          if (killError) {
            console.log(`[PROXY] ⚠️  Could not kill processes (may require sudo): ${killError.message}`);
            console.log(`[PROXY] 💡 Please run manually: lsof -ti:${PORT} | xargs kill -9`);
            console.log(`[PROXY] 💡 Or if that doesn't work: sudo lsof -ti:${PORT} | xargs kill -9`);
            console.log(`[PROXY] ⏳ Waiting 3 seconds for manual cleanup...`);
            setTimeout(resolve, 3000);
          } else {
            console.log(`[PROXY] ✅ Killed existing processes on port ${PORT}`);
            setTimeout(resolve, 1000);
          }
        });
      } else {
        console.log(`[PROXY] ✅ Port ${PORT} is available`);
        resolve();
      }
    });
  });
}

// Start the server with conflict detection
async function startServer() {
  try {
    await checkAndKillExistingProcesses();
    
    // Initialize database connection
    console.log('[PROXY] 🔄 Initializing database connection...');
    const dbConnected = await initDatabase();
    
    // Load positions from database/file storage
    console.log('[PROXY] 🔄 Loading existing positions...');
    await loadLivePositions();
    
    // CRITICAL FIX: Load trades FROM database into memory (not just sync to DB)
    // This ensures the in-memory trades array matches the database
    if (dbConnected) {
      console.log('[PROXY] 🔄 Loading trades from database into memory...');
      const dbTrades = await loadTradesFromDB();
      if (dbTrades && dbTrades.length > 0) {
        trades = dbTrades;
        console.log(`[PROXY] ✅ Loaded ${trades.length} trades from database into memory`);
        
        // CRITICAL: Log P&L calculation to verify data matches database
        const testnetTrades = trades.filter(t => t.trading_mode === 'testnet' && t.exit_timestamp != null);
        const testnetPnl = testnetTrades.reduce((sum, t) => sum + (Number(t?.pnl_usdt) || 0), 0);
        console.log(`[PROXY] 📊 Testnet closed trades: ${testnetTrades.length}, Total P&L: ${testnetPnl.toFixed(2)}`);
        console.log(`[PROXY] 📊 Expected SQL result (for testnet): ${testnetPnl.toFixed(2)}`);
        console.log(`[PROXY] ⚠️ If SQL shows -22.74 but this shows ${testnetPnl.toFixed(2)}, check database pnl_usdt values!`);
      } else {
        console.log('[PROXY] ⚠️ No trades loaded from database, using empty array');
      }
    } else {
      console.log('[PROXY] ⚠️ Database not connected, cannot load trades from database');
    }
    
    // Sync existing trades to database (handles any trades that were in memory but not in DB)
    await syncTradesToDatabase();
    
    // Sync existing backtest combinations to database
    await syncBacktestCombinationsToDatabase();
    
// Endpoint to optimize trades table performance (adds critical indexes)
    app.post('/api/database/optimize-trades', async (req, res) => {
        if (!dbClient) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }
        
        try {
            console.log('[PROXY] 🚀 Starting trades table optimization...');
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
                          WHERE exit_timestamp IS NOT NULL`
                },
                {
                    name: 'idx_trades_exit_timestamp_desc',
                    sql: `CREATE INDEX IF NOT EXISTS idx_trades_exit_timestamp_desc 
                          ON trades(exit_timestamp DESC) 
                          WHERE exit_timestamp IS NOT NULL`
                },
                {
                    name: 'idx_trades_mode_exit_range',
                    sql: `CREATE INDEX IF NOT EXISTS idx_trades_mode_exit_range 
                          ON trades(trading_mode, exit_timestamp DESC) 
                          WHERE exit_timestamp IS NOT NULL`
                },
                {
                    name: 'idx_trades_created_date_desc',
                    sql: `CREATE INDEX IF NOT EXISTS idx_trades_created_date_desc 
                          ON trades(created_date DESC)`
                },
                {
                    name: 'idx_trades_mode_created_date',
                    sql: `CREATE INDEX IF NOT EXISTS idx_trades_mode_created_date 
                          ON trades(trading_mode, created_date DESC)`
                },
                {
                    name: 'idx_trades_valid_exits',
                    sql: `CREATE INDEX IF NOT EXISTS idx_trades_valid_exits 
                          ON trades(trading_mode, exit_timestamp, pnl_usdt) 
                          WHERE exit_timestamp IS NOT NULL AND pnl_usdt IS NOT NULL`
                }
            ];
            
            for (const index of indexes) {
                try {
                    await dbClient.query(index.sql);
                    results.indexesCreated.push(index.name);
                    console.log(`[PROXY] ✅ Created index: ${index.name}`);
                } catch (error) {
                    const errorMsg = `Failed to create ${index.name}: ${error.message}`;
                    results.errors.push(errorMsg);
                    console.error(`[PROXY] ❌ ${errorMsg}`);
                }
            }
            
            // Update table statistics
            try {
                await dbClient.query('ANALYZE trades');
                console.log('[PROXY] ✅ Updated table statistics (ANALYZE)');
            } catch (error) {
                results.errors.push(`ANALYZE failed: ${error.message}`);
            }
            
            const success = results.errors.length === 0;
            console.log(`[PROXY] ${success ? '✅' : '⚠️'} Optimization complete: ${results.indexesCreated.length} indexes created, ${results.errors.length} errors`);
            
            res.json({
                success,
                indexesCreated: results.indexesCreated.length,
                errors: results.errors.length,
                details: results
            });
        } catch (error) {
            console.error('[PROXY] ❌ Error optimizing trades table:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Binance Proxy Server running on port ${PORT}`);
      console.log(`   Mainnet: https://api.binance.com`);
      console.log(`   Testnet: https://testnet.binance.vision`);
      console.log(`   CORS enabled for localhost:5174`);
      console.log(`   Database: ${dbConnected ? 'Connected' : 'File storage only'}`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[PROXY] ❌ Port ${PORT} is already in use`);
        console.error(`[PROXY] 💡 Try running: lsof -ti:${PORT} | xargs kill -9`);
        process.exit(1);
      } else if (error.code === 'EPERM') {
        console.error(`[PROXY] ❌ Permission denied on port ${PORT}`);
        console.error(`[PROXY] 💡 Try running: sudo lsof -ti:${PORT} | xargs kill -9`);
        process.exit(1);
      } else {
        console.error(`[PROXY] ❌ Server error:`, error);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[PROXY] 🔄 Shutting down gracefully...');
      
      // Close database connection
      if (dbClient) {
        try {
          await dbClient.end();
          console.log('[PROXY] ✅ Database connection closed');
        } catch (error) {
          console.error('[PROXY] ❌ Error closing database connection:', error.message);
        }
      }
      
      server.close(() => {
        console.log('[PROXY] ✅ Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('[PROXY] ❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
