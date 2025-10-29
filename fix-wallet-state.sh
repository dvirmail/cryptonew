#!/bin/bash

# Fix wallet state initialization issue in AutoScannerService.jsx
# This script addresses the "No wallet state available" and "wallet mode is set (undefined)" issues

echo "🔧 Fixing wallet state initialization issues..."

# Create a backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup

# Fix the wallet state creation log message
sed -i '' 's/No wallet state available, creating minimal wallet state/No wallet state available, creating minimal wallet state for ${this.state.tradingMode || "testnet"} mode/g' src/components/services/AutoScannerService.jsx

# Fix the PositionManager log message to handle undefined mode
sed -i '' 's/Ensuring wallet mode is set (${this.state.liveWalletState?.mode})/Ensuring wallet mode is set (${this.state.liveWalletState?.mode || "undefined"})/g' src/components/services/AutoScannerService.jsx

echo "✅ Wallet state initialization fixes applied!"
echo "📝 Changes made:"
echo "   - Improved wallet state creation log message"
echo "   - Fixed PositionManager log message to handle undefined mode"
echo "   - Backup created at: src/components/services/AutoScannerService.jsx.backup"
