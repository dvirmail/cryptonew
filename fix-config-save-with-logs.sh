#!/bin/bash

echo "🔧 Applying scanner configuration save fix with console logging..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Fix the upsert issue and add console logging
sed -i '' 's/await queueEntityCall('\''ScanSettings'\'', '\''upsert'\'', this.scannerService.state.settings);/console.log('\''[ConfigurationService] Fetching existing settings...'\'');\
            const existingSettings = await queueEntityCall('\''ScanSettings'\'', '\''list'\'');\
            console.log('\''[ConfigurationService] Existing settings:'\'');\
            console.log(existingSettings);\
            if (existingSettings \&\& existingSettings.length > 0) {\
                console.log('\''[ConfigurationService] Updating existing settings with ID:'\'');\
                console.log(existingSettings[0].id);\
                const updateResult = await queueEntityCall('\''ScanSettings'\'', '\''update'\'', existingSettings[0].id, this.scannerService.state.settings);\
                console.log('\''[ConfigurationService] Update result:'\'');\
                console.log(updateResult);\
            } else {\
                console.log('\''[ConfigurationService] Creating new settings...'\'');\
                const createResult = await queueEntityCall('\''ScanSettings'\'', '\''create'\'', this.scannerService.state.settings);\
                console.log('\''[ConfigurationService] Create result:'\'');\
                console.log(createResult);\
            }/' src/components/services/AutoScannerService.jsx

# Add console logging to the beginning of updateSettings method
sed -i '' 's/async updateSettings(newSettings) {/async updateSettings(newSettings) {\
        console.log('\''[ConfigurationService] updateSettings called with:'\'');\
        console.log(newSettings);/' src/components/services/AutoScannerService.jsx

# Add console logging to the end of updateSettings method
sed -i '' 's/this.addLog('\''[ConfigurationService] Scanner settings updated successfully.'\''/console.log('\''[ConfigurationService] Settings update completed successfully'\'');\
            this.addLog('\''[ConfigurationService] Scanner settings updated successfully.'\''/' src/components/services/AutoScannerService.jsx

echo "✅ Configuration save fix with console logging applied!"
echo "📝 Changes made:"
echo "   - Replaced upsert with list/update pattern"
echo "   - Added comprehensive console logging"
echo "   - Backup created"
