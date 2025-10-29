# Central Wallet State System Implementation

## Overview
This document describes the implementation of a centralized wallet state management system designed to eliminate data loss issues during development and provide a single source of truth for all wallet-related data.

## Problem Analysis
The original system had several critical issues causing wallet data loss:

1. **Multiple Wallet State Sources**: System used both `WalletSummary`/`LiveWalletState` entities AND various wallet managers, causing data conflicts
2. **Wallet ID Mismatch**: Different services used different wallet IDs (`myh3gys45` vs `j3vol697z`), causing data to be lost between different wallet states
3. **Stale Data Loading**: WalletProvider loaded cached data from localStorage showing old values while database queries returned different wallet states
4. **Race Conditions**: Multiple services updating wallet data simultaneously without proper coordination
5. **Missing Central Entity**: No single entity to manage wallet state consistently

## Solution: CentralWalletStateManager

### Database Schema
Created `CentralWalletState` entity with the following structure:
```sql
CREATE TABLE central_wallet_state (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trading_mode TEXT NOT NULL, -- 'testnet' or 'mainnet'
    available_balance DECIMAL(20,8) DEFAULT 0,
    balance_in_trades DECIMAL(20,8) DEFAULT 0,
    total_equity DECIMAL(20,8) DEFAULT 0,
    total_realized_pnl DECIMAL(20,8) DEFAULT 0,
    unrealized_pnl DECIMAL(20,8) DEFAULT 0,
    open_positions_count INTEGER DEFAULT 0,
    last_binance_sync TIMESTAMP WITH TIME ZONE,
    balances JSONB DEFAULT '[]'::jsonb,
    positions JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'initialized',
    created_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(trading_mode)
);
```

### Key Features

#### 1. Single Source of Truth
- Only one `CentralWalletState` record per trading mode
- All wallet data flows through this single entity
- Eliminates data fragmentation and conflicts

#### 2. Automatic Migration
- Automatically migrates data from old `WalletSummary`/`LiveWalletState` entities
- Preserves existing wallet data during transition
- Seamless upgrade path

#### 3. Real-time Synchronization
- Subscriber pattern for real-time updates
- Automatic Binance API synchronization
- Consistent data across all components

#### 4. Data Persistence
- All changes immediately persisted to database
- Automatic timestamp updates
- Critical priority in API queue

### Implementation Details

#### CentralWalletStateManager Class
```javascript
class CentralWalletStateManager {
    // Core methods
    async initialize(tradingMode)           // Initialize and migrate data
    async syncWithBinance(tradingMode)     // Sync with Binance API
    async updateBalanceInTrades(value)     // Update balance in trades
    async updateAvailableBalance(value)    // Update available balance
    
    // Subscription system
    subscribe(callback)                     // Subscribe to state changes
    notifySubscribers()                     // Notify all subscribers
    
    // Utility methods
    getCurrentState()                       // Get current state
    isReady()                              // Check if initialized
    debugState()                           // Debug current state
}
```

#### Updated Components

1. **WalletProvider**: Now uses CentralWalletStateManager exclusively
2. **AutoScannerService**: Updated to use centralized wallet state
3. **WalletManagerService**: Delegates all operations to CentralWalletStateManager
4. **PositionManager**: Updated wallet summary calls
5. **LiveScanner**: Uses CentralWalletStateManager instead of LiveWalletState

### Migration Process

1. **Database Migration**: Applied `003_central_wallet_state.sql` to create the new table
2. **Code Updates**: Updated all components to use CentralWalletStateManager
3. **Data Migration**: Automatic migration from old entities on first initialization
4. **API Queue**: Added CentralWalletState to critical priority operations

### Benefits

1. **Data Consistency**: Single source of truth eliminates data conflicts
2. **Persistence**: Wallet data persists across development sessions
3. **Real-time Updates**: All components receive updates immediately
4. **Simplified Architecture**: Reduced complexity and maintenance overhead
5. **Better Debugging**: Centralized state makes debugging easier

### Testing

Created verification script (`verify-central-wallet-state.js`) that can be run in browser console to test:
- Manager initialization
- State persistence
- Real-time updates
- Data migration
- Balance updates

### Usage

The system is now transparent to the application. All wallet data flows through the CentralWalletStateManager:

```javascript
// Get current wallet state
const walletState = centralWalletStateManager.getCurrentState();

// Subscribe to updates
const unsubscribe = centralWalletStateManager.subscribe((state) => {
    console.log('Wallet updated:', state);
});

// Update balance in trades
await centralWalletStateManager.updateBalanceInTrades(1000.50);

// Update available balance
await centralWalletStateManager.updateAvailableBalance(5000.75);
```

## Conclusion

The CentralWalletStateManager provides a robust, centralized solution for wallet state management that eliminates the data loss issues experienced during development. The system ensures data consistency, persistence, and real-time updates while maintaining backward compatibility through automatic migration.
