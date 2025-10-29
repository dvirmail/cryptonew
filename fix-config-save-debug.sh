#!/bin/bash

echo "🔧 Applying scanner configuration save fix with comprehensive debugging..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Find the ConfigurationService updateSettings method and fix it
echo "📝 Fixing ConfigurationService updateSettings method..."

# Use a more targeted approach - find the exact line with upsert and replace it
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

# Add debugging to the main AutoScannerService updateSettings method
echo "📝 Adding debugging to main AutoScannerService updateSettings method..."

# Find the line with "return this.configurationService.updateSettings(newSettings);" and replace it
sed -i '' 's/return this.configurationService.updateSettings(newSettings);/console.log('\''🚀 [AutoScannerService] updateSettings called with:'\'');\
        console.log(newSettings);\
        console.log('\''🚀 [AutoScannerService] Delegating to ConfigurationService...'\'');\
        console.log('\''🚀 [AutoScannerService] ConfigurationService exists:'\'');\
        console.log(!!this.configurationService);\
        console.log('\''🚀 [AutoScannerService] ConfigurationService.updateSettings exists:'\'');\
        console.log(typeof this.configurationService?.updateSettings);\
        try {\
            const result = await this.configurationService.updateSettings(newSettings);\
            console.log('\''✅ [AutoScannerService] ConfigurationService.updateSettings completed successfully'\'');\
            console.log('\''✅ [AutoScannerService] Result:'\'');\
            console.log(result);\
            return result;\
        } catch (error) {\
            console.error('\''❌ [AutoScannerService] ConfigurationService.updateSettings failed:'\'');\
            console.error(error);\
            console.error('\''❌ [AutoScannerService] Error stack:'\'');\
            console.error(error.stack);\
            throw error;\
        }/' src/components/services/AutoScannerService.jsx

echo "✅ Configuration save fix with debugging applied!"
echo "📝 Changes made:"
echo "   - Fixed the broken 'upsert' operation in ConfigurationService.updateSettings"
echo "   - Added comprehensive console logging to both updateSettings methods"
echo "   - Added error handling and debugging information"
echo ""
echo "🧪 Testing the fix..."
echo "   - Try saving scanner configuration in the UI"
echo "   - Check browser console for debug logs"
echo "   - Look for logs starting with 🚀, 🔧, ✅, or ❌"
