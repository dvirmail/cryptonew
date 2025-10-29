-- SQL script to delete all positions and trades from database
-- Run this in DBeaver or your PostgreSQL client

-- ⚠️ WARNING: This will delete ALL data!

-- Step 1: Delete all trades
DELETE FROM trades;

-- Step 2: Delete all live positions  
DELETE FROM live_positions;

-- Step 3: Verify deletion (should show 0 for both)
SELECT 'Trades remaining:' as info, COUNT(*) as count FROM trades
UNION ALL
SELECT 'Positions remaining:', COUNT(*) FROM live_positions;

-- Optional: Reset auto-increment sequences if you want to start IDs from 1
-- ALTER SEQUENCE IF EXISTS trades_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS live_positions_id_seq RESTART WITH 1;
