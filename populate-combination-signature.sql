-- ============================================
-- Populate combination_signature for existing strategies
-- ============================================
-- This migration generates combination_signature for existing strategies
-- that don't have it, based on their signals and timeframe
-- ============================================

-- Function to generate signature from signals and timeframe
-- Format: TF:timeframe|signal1+!signal2+!
DO $$
DECLARE
    rec RECORD;
    signal_identifiers TEXT[];
    signature TEXT;
    timeframe_val TEXT;
BEGIN
    FOR rec IN 
        SELECT 
            id,
            strategy_name,
            signals,
            timeframe,
            combination_signature
        FROM backtest_combinations
        WHERE combination_signature IS NULL OR combination_signature = ''
    LOOP
        -- Extract timeframe
        timeframe_val := rec.timeframe;
        
        -- Extract signal identifiers from JSONB signals array
        SELECT ARRAY_AGG(
            COALESCE(signal->>'type', '') || ':' || COALESCE(signal->>'value', '')
            ORDER BY COALESCE(signal->>'type', '')
        )
        INTO signal_identifiers
        FROM jsonb_array_elements(rec.signals) AS signal;
        
        -- Generate signature
        IF signal_identifiers IS NOT NULL AND array_length(signal_identifiers, 1) > 0 THEN
            signature := 'TF:' || timeframe_val || '|' || array_to_string(signal_identifiers, '+!');
            
            -- Update the record
            UPDATE backtest_combinations
            SET combination_signature = signature
            WHERE id = rec.id;
            
            RAISE NOTICE 'Updated strategy %: %', rec.strategy_name, signature;
        ELSE
            RAISE NOTICE 'Skipped strategy %: No signals found', rec.strategy_name;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Migration complete: Populated combination_signature for existing strategies';
END $$;


