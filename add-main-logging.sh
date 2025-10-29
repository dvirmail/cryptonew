#!/bin/bash

echo "🔧 Adding logging to main updateSettings method..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Find and replace the main updateSettings method
sed -i '' 's/return this.configurationService.updateSettings(newSettings);/console.log("🚀 [AutoScannerService] updateSettings called with:");\
        console.log(newSettings);\
        console.log("🚀 [AutoScannerService] Delegating to ConfigurationService...");\
        try {\
            const result = await this.configurationService.updateSettings(newSettings);\
            console.log("✅ [AutoScannerService] ConfigurationService.updateSettings completed successfully");\
            return result;\
        } catch (error) {\
            console.error("❌ [AutoScannerService] ConfigurationService.updateSettings failed:", error);\
            throw error;\
        }/' src/components/services/AutoScannerService.jsx

echo "✅ Main updateSettings logging added!"