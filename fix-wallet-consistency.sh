#!/bin/bash

echo "🔧 Applying wallet ID consistency fixes..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Fix 1: Update the log message to include trading mode
sed -i '' 's/this.addLog('\''\[AutoScannerService\] ❌ No wallet state available, creating minimal wallet state...'\''/this.addLog(`[AutoScannerService] ❌ No wallet state available, creating minimal wallet state for ${this.state.tradingMode || "testnet"} mode...`)/' src/components/services/AutoScannerService.jsx

# Fix 2: Update PositionManager log message to handle undefined mode
sed -i '' 's/this.addLog(`\[PositionManager\] 🔧 Ensuring wallet mode is set (${this.state.liveWalletState?.mode}) before loading managed state.`/this.addLog(`[PositionManager] 🔧 Ensuring wallet mode is set (${this.state.liveWalletState?.mode || "undefined"}) before loading managed state.`)/' src/components/services/AutoScannerService.jsx

echo "✅ Wallet ID consistency fixes applied!"
echo "📝 Changes made:"
echo "   - Updated wallet state creation log message to include trading mode"
echo "   - Fixed PositionManager log message to handle undefined mode"
echo "   - Backup created at: src/components/services/AutoScannerService.jsx.backup.*"
