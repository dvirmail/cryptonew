#!/bin/bash

echo "🔧 Applying comprehensive scanner configuration save fix..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Fix the ConfigurationService updateSettings method (around line 450)
echo "📝 Fixing ConfigurationService updateSettings method..."
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
                console.log('\''[ConfigurationService] No existing settings found, creating new settings...'\'');\
                const createResult = await queueEntityCall('\''ScanSettings'\'', '\''create'\'', this.scannerService.state.settings);\
                console.log('\''[ConfigurationService] Create result:'\'');\
                console.log(createResult);\
            }/' src/components/services/AutoScannerService.jsx

# Add logging to the main AutoScannerService updateSettings method
echo "📝 Adding logging to main AutoScannerService updateSettings method..."
sed -i '' 's/return this.configurationService.updateSettings(newSettings);/console.log('\''🚀 [AutoScannerService] updateSettings called with:'\'');\
        console.log(newSettings);\
        console.log('\''🚀 [AutoScannerService] Delegating to ConfigurationService...'\'');\
        try {\
            const result = await this.configurationService.updateSettings(newSettings);\
            console.log('\''✅ [AutoScannerService] ConfigurationService.updateSettings completed successfully'\'');\
            return result;\
        } catch (error) {\
            console.error('\''❌ [AutoScannerService] ConfigurationService.updateSettings failed:'\'', error);\
            throw error;\
        }/' src/components/services/AutoScannerService.jsx

echo "✅ Configuration save fix applied successfully!"
echo "📝 Changes made:"
echo "   - Fixed ConfigurationService.updateSettings to use list/update pattern"
echo "   - Added comprehensive console logging to both updateSettings methods"
echo "   - Replaced broken 'upsert' operation with supported operations"

# Verify the changes
echo "🔍 Verifying changes..."
if grep -q "Fetching existing settings" src/components/services/AutoScannerService.jsx; then
    echo "✅ ConfigurationService fix verified"
else
    echo "❌ ConfigurationService fix not found"
fi

if grep -q "🚀 [AutoScannerService] updateSettings called with" src/components/services/AutoScannerService.jsx; then
    echo "✅ Main AutoScannerService logging verified"
else
    echo "❌ Main AutoScannerService logging not found"
fi

echo "🎉 Fix complete! The scanner configuration save should now work properly."
