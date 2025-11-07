-- Remove combination_name column from trades table
-- This column is no longer used and all values are NULL

-- Drop the column if it exists
ALTER TABLE trades DROP COLUMN IF EXISTS combination_name;

-- Verify removal
DO $$ 
BEGIN
    RAISE NOTICE '✅ combination_name column removed from trades table';
END $$;

