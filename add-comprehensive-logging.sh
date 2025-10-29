#!/bin/bash

echo "🔧 Adding comprehensive logging to updateSettings methods..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

# Add logging to the main AutoScannerService updateSettings method
sed -i '' 's/async updateSettings(newSettings) {/async updateSettings(newSettings) {\
        console.log("🚀 [AutoScannerService] updateSettings called with:");\
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

# Add logging to the ConfigurationService updateSettings method
sed -i '' 's/async updateSettings(newSettings) {/async updateSettings(newSettings) {\
        console.log("🔧 [ConfigurationService] updateSettings called with:");\
        console.log(newSettings);\
        console.log("🔧 [ConfigurationService] Current settings before update:", this.scannerService.state.settings);\
        this.addLog("[ConfigurationService] Updating scanner settings...", "system", newSettings);\
        try {\
            const oldSettings = { ...this.scannerService.state.settings };\
            this.scannerService.state.settings = { ...this.scannerService.state.settings, ...newSettings };\
            console.log("🔧 [ConfigurationService] Settings updated locally");\
            console.log("🔧 [ConfigurationService] Fetching existing settings...");\
            const existingSettings = await queueEntityCall("ScanSettings", "list");\
            console.log("🔧 [ConfigurationService] Existing settings:", existingSettings);\
            if (existingSettings && existingSettings.length > 0) {\
                console.log("🔧 [ConfigurationService] Updating existing settings with ID:", existingSettings[0].id);\
                const updateResult = await queueEntityCall("ScanSettings", "update", existingSettings[0].id, this.scannerService.state.settings);\
                console.log("🔧 [ConfigurationService] Update result:", updateResult);\
            } else {\
                console.log("🔧 [ConfigurationService] Creating new settings...");\
                const createResult = await queueEntityCall("ScanSettings", "create", this.scannerService.state.settings);\
                console.log("🔧 [ConfigurationService] Create result:", createResult);\
            }\
            console.log("✅ [ConfigurationService] Settings saved successfully");\
            this.addLog("[ConfigurationService] Scanner settings updated successfully.", "success");\
            this.notifySubscribers();\
            if (this.toast) {\
                this.toast({\
                    title: "Settings Updated",\
                    description: "Scanner configuration has been successfully updated."\
                });\
            }\
        } catch (error) {\
            console.error("❌ [ConfigurationService] Failed to update settings:", error);\
            this.addLog(`[ConfigurationService] Failed to update settings: ${error.message}`, "error", error);\
            if (this.toast) {\
                this.toast({\
                    title: "Settings Update Failed",\
                    description: `Failed to update settings: ${error.message}`,\
                    variant: "destructive"\
                });\
            }\
            throw error;\
        }/' src/components/services/AutoScannerService.jsx

echo "✅ Comprehensive logging added!"
echo "📝 Changes made:"
echo "   - Added logging to main AutoScannerService.updateSettings"
echo "   - Added logging to ConfigurationService.updateSettings"
echo "   - Added database operation logging"
echo "   - Added error handling logging"