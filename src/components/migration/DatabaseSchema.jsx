export const DATABASE_SCHEMA_SQL = `
-- CryptoSentinel Database Schema
-- Run this SQL script in your local PostgreSQL database

-- Users table (replaces Base44 User entity)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    full_name VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    binance_api_key TEXT,
    binance_secret_key TEXT,
    binance_testnet BOOLEAN DEFAULT false,
    telegram_token TEXT,
    telegram_chat_id TEXT
);

-- Trading Signals table
CREATE TABLE trading_signals (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    timeframes TEXT[],
    signal_conditions JSONB,
    is_active BOOLEAN DEFAULT true
);

-- Trades table
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    pair VARCHAR(50),
    entry_price DECIMAL(20,8),
    exit_price DECIMAL(20,8),
    entry_date TIMESTAMP,
    exit_date TIMESTAMP,
    position_size DECIMAL(20,8),
    direction VARCHAR(10),
    pnl DECIMAL(20,8),
    pnl_percentage DECIMAL(10,4),
    signals_used JSONB,
    notes TEXT,
    exchange VARCHAR(50),
    status VARCHAR(20),
    time_of_day VARCHAR(20),
    conviction_score DECIMAL(10,2),
    trade_type VARCHAR(50)
);

-- Backtest Combinations table
CREATE TABLE backtest_combinations (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    coin VARCHAR(50),
    timeframe VARCHAR(10),
    signals JSONB,
    combination_signature VARCHAR(255) UNIQUE,
    signal_count INTEGER,
    combined_strength DECIMAL(10,2),
    success_rate DECIMAL(5,2),
    occurrences INTEGER,
    occurrence_dates JSONB,
    avg_price_move DECIMAL(10,4),
    profit_factor DECIMAL(10,4),
    recommended_trading_strategy TEXT,
    included_in_scanner BOOLEAN DEFAULT false,
    included_in_live_scanner BOOLEAN DEFAULT false,
    combination_name VARCHAR(255),
    strategy_direction VARCHAR(10) DEFAULT 'long',
    risk_percentage DECIMAL(5,2) DEFAULT 1,
    stop_loss_atr_multiplier DECIMAL(5,2) DEFAULT 2.5,
    take_profit_atr_multiplier DECIMAL(5,2) DEFAULT 3,
    estimated_exit_time_minutes INTEGER,
    enable_trailing_take_profit BOOLEAN DEFAULT true,
    real_trade_count INTEGER DEFAULT 0,
    real_success_rate DECIMAL(5,2) DEFAULT 0,
    real_avg_pnl_percent DECIMAL(10,4) DEFAULT 0,
    real_profit_factor DECIMAL(10,4) DEFAULT 0,
    opted_out_globally BOOLEAN DEFAULT false,
    opted_out_for_coin BOOLEAN DEFAULT false,
    opted_out_date TIMESTAMP
);

-- Virtual Wallet State table
CREATE TABLE virtual_wallet_state (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    balance_usdt DECIMAL(20,8) DEFAULT 10000,
    initial_balance_usdt DECIMAL(20,8) DEFAULT 10000,
    positions JSONB DEFAULT '[]',
    trade_history JSONB DEFAULT '[]',
    total_trades_count INTEGER DEFAULT 0,
    winning_trades_count INTEGER DEFAULT 0,
    losing_trades_count INTEGER DEFAULT 0,
    last_updated_timestamp TIMESTAMP
);

-- Live Wallet State table
CREATE TABLE live_wallet_state (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    binance_account_type VARCHAR(50),
    balances JSONB DEFAULT '[]',
    positions JSONB DEFAULT '[]',
    trade_history JSONB DEFAULT '[]',
    total_trades_count INTEGER DEFAULT 0,
    winning_trades_count INTEGER DEFAULT 0,
    losing_trades_count INTEGER DEFAULT 0,
    total_fees_paid DECIMAL(20,8) DEFAULT 0,
    last_updated_timestamp TIMESTAMP,
    last_binance_sync TIMESTAMP
);

-- Scan Settings table
CREATE TABLE scan_settings (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    scan_frequency INTEGER DEFAULT 300000,
    minimum_combined_strength DECIMAL(10,2) DEFAULT 225,
    default_position_size DECIMAL(20,8) DEFAULT 100,
    use_win_strategy_size BOOLEAN DEFAULT true,
    max_positions INTEGER DEFAULT 10,
    risk_per_trade DECIMAL(5,2) DEFAULT 2.0,
    portfolio_heat_max DECIMAL(5,2) DEFAULT 20,
    minimum_trade_value DECIMAL(20,8) DEFAULT 10,
    scanner_enabled BOOLEAN DEFAULT false,
    live_scanner_enabled BOOLEAN DEFAULT false
);

-- Opted Out Combinations table
CREATE TABLE opted_out_combinations (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    combination_signature VARCHAR(255) UNIQUE NOT NULL,
    strategy_name VARCHAR(255),
    coin VARCHAR(50),
    timeframe VARCHAR(10),
    reason TEXT,
    combination_details JSONB,
    opted_out_date TIMESTAMP
);

-- Market Alerts table (if you have any)
CREATE TABLE market_alerts (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    pair VARCHAR(50),
    alert_type VARCHAR(100),
    target_price DECIMAL(20,8),
    current_price DECIMAL(20,8),
    is_active BOOLEAN DEFAULT true,
    triggered_at TIMESTAMP,
    message TEXT
);

-- Add indexes for better performance
CREATE INDEX idx_trades_created_by ON trades(created_by);
CREATE INDEX idx_trades_pair ON trades(pair);
CREATE INDEX idx_trades_entry_date ON trades(entry_date);
CREATE INDEX idx_trades_status ON trades(status);

CREATE INDEX idx_backtest_combinations_coin ON backtest_combinations(coin);
CREATE INDEX idx_backtest_combinations_signature ON backtest_combinations(combination_signature);
CREATE INDEX idx_backtest_combinations_created_by ON backtest_combinations(created_by);

CREATE INDEX idx_trading_signals_created_by ON trading_signals(created_by);
CREATE INDEX idx_trading_signals_category ON trading_signals(category);

CREATE INDEX idx_users_email ON users(email);

-- Insert default admin user (update with your email)
INSERT INTO users (full_name, email, role) 
VALUES ('Admin User', 'your-email@example.com', 'admin')
ON CONFLICT (email) DO NOTHING;
`;

export default DATABASE_SCHEMA_SQL;