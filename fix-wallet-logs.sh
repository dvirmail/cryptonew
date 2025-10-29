#!/bin/bash

echo "🔧 Applying wallet state log fixes..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Fix 1: Update PositionManager log message to handle undefined mode
sed -i '' 's/this.addLog(`\[PositionManager\] 🔧 Ensuring wallet mode is set (${this.state.liveWalletState?.mode}) before loading managed state.`/this.addLog(`[PositionManager] 🔧 Ensuring wallet mode is set (${this.state.liveWalletState?.mode || "undefined"}) before loading managed state.`/' src/components/services/AutoScannerService.jsx

# Fix 2: Update wallet state creation log message to include trading mode
sed -i '' 's/this.addLog('\''\[AutoScannerService\] ❌ No wallet state available, creating minimal wallet state...'\''/this.addLog(`[AutoScannerService] ❌ No wallet state available, creating minimal wallet state for ${this.state.tradingMode || "testnet"} mode...`)/' src/components/services/AutoScannerService.jsx

echo "✅ Wallet state log fixes applied!"
echo "📝 Changes made:"
echo "   - Fixed PositionManager log message to handle undefined mode"
echo "   - Improved wallet state creation log message with trading mode"
echo "   - Backup created"
