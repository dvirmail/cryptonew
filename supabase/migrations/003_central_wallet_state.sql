-- 003_central_wallet_state.sql
-- Create CentralWalletState table for centralized wallet management

-- CentralWalletState table - Single source of truth for wallet data
CREATE TABLE IF NOT EXISTS central_wallet_state (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trading_mode TEXT NOT NULL, -- 'testnet' or 'mainnet'
    available_balance DECIMAL(20,8) DEFAULT 0,
    balance_in_trades DECIMAL(20,8) DEFAULT 0,
    total_equity DECIMAL(20,8) DEFAULT 0,
    total_realized_pnl DECIMAL(20,8) DEFAULT 0,
    unrealized_pnl DECIMAL(20,8) DEFAULT 0,
    crypto_assets_value DECIMAL(20,8) DEFAULT 0,
    open_positions_count INTEGER DEFAULT 0,
    last_binance_sync TIMESTAMP WITH TIME ZONE,
    balances JSONB DEFAULT '[]'::jsonb, -- Store all balances from Binance
    positions JSONB DEFAULT '[]'::jsonb, -- Store current positions snapshot
    status TEXT DEFAULT 'initialized', -- 'initialized', 'synced', 'error'
    created_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Ensure only one active state per trading mode
    UNIQUE(trading_mode)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_central_wallet_state_trading_mode 
ON central_wallet_state(trading_mode);

CREATE INDEX IF NOT EXISTS idx_central_wallet_state_updated_date 
ON central_wallet_state(updated_date);

-- Enable Row Level Security
ALTER TABLE central_wallet_state ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (for now)
CREATE POLICY "Allow all authenticated users to manage central wallet state" 
ON central_wallet_state
FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Add trigger to update updated_date automatically
CREATE OR REPLACE FUNCTION update_central_wallet_state_updated_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_date = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_central_wallet_state_updated_date
    BEFORE UPDATE ON central_wallet_state
    FOR EACH ROW
    EXECUTE FUNCTION update_central_wallet_state_updated_date();
