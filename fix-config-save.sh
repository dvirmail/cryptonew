#!/bin/bash

echo "🔧 Applying scanner configuration save fix..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Fix the upsert issue
sed -i '' 's/await queueEntityCall('\''ScanSettings'\'', '\''upsert'\'', this.scannerService.state.settings);/const existingSettings = await queueEntityCall('\''ScanSettings'\'', '\''list'\'');\
            if (existingSettings \&\& existingSettings.length > 0) {\
                await queueEntityCall('\''ScanSettings'\'', '\''update'\'', existingSettings[0].id, this.scannerService.state.settings);\
            } else {\
                await queueEntityCall('\''ScanSettings'\'', '\''create'\'', this.scannerService.state.settings);\
            }/' src/components/services/AutoScannerService.jsx

echo "✅ Configuration save fix applied!"
echo "📝 Changes made:"
echo "   - Replaced upsert with list/update pattern"
echo "   - Backup created"
