-- Cleanup all trade records from CryptoSentinel database
-- Run this script with: psql -d dvirturkenitch -f cleanup-trades.sql

-- Show current record counts before deletion
SELECT 'BEFORE CLEANUP - Record counts:' as status;

SELECT 'trades' as table_name, COUNT(*) as record_count FROM trades
UNION ALL
SELECT 'live_positions', COUNT(*) FROM live_positions
UNION ALL  
SELECT 'wallet_summaries', COUNT(*) FROM wallet_summaries
UNION ALL
SELECT 'central_wallet_states', COUNT(*) FROM central_wallet_states
UNION ALL
SELECT 'historical_performances', COUNT(*) FROM historical_performances
UNION ALL
SELECT 'live_wallet_state', COUNT(*) FROM live_wallet_state
UNION ALL
SELECT 'virtual_wallet_state', COUNT(*) FROM virtual_wallet_state;

-- Delete all trade-related records
DELETE FROM trades;
DELETE FROM live_positions;
DELETE FROM wallet_summaries;
DELETE FROM central_wallet_states;
DELETE FROM historical_performances;
DELETE FROM live_wallet_state;
DELETE FROM virtual_wallet_state;

-- Reset auto-increment sequences to start from 1
ALTER SEQUENCE trades_id_seq RESTART WITH 1;
ALTER SEQUENCE live_positions_id_seq RESTART WITH 1;
ALTER SEQUENCE wallet_summaries_id_seq RESTART WITH 1;
ALTER SEQUENCE central_wallet_states_id_seq RESTART WITH 1;
ALTER SEQUENCE historical_performances_id_seq RESTART WITH 1;
ALTER SEQUENCE live_wallet_state_id_seq RESTART WITH 1;
ALTER SEQUENCE virtual_wallet_state_id_seq RESTART WITH 1;

-- Show record counts after deletion
SELECT 'AFTER CLEANUP - Record counts:' as status;

SELECT 'trades' as table_name, COUNT(*) as record_count FROM trades
UNION ALL
SELECT 'live_positions', COUNT(*) FROM live_positions
UNION ALL  
SELECT 'wallet_summaries', COUNT(*) FROM wallet_summaries
UNION ALL
SELECT 'central_wallet_states', COUNT(*) FROM central_wallet_states
UNION ALL
SELECT 'historical_performances', COUNT(*) FROM historical_performances
UNION ALL
SELECT 'live_wallet_state', COUNT(*) FROM live_wallet_state
UNION ALL
SELECT 'virtual_wallet_state', COUNT(*) FROM virtual_wallet_state;

SELECT 'CLEANUP COMPLETED - All trade records have been removed!' as status;
