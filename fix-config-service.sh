#!/bin/bash

# Script to reapply ConfigurationService fix to AutoScannerService.jsx

AUTOSCANNER_FILE="src/components/services/AutoScannerService.jsx"

echo "🔧 Reapplying ConfigurationService fix to AutoScannerService.jsx..."

if [ ! -f "$AUTOSCANNER_FILE" ]; then
    echo "❌ AutoScannerService.jsx not found!"
    exit 1
fi

# Check if the fix is already applied
if grep -q "Persist to database using direct API calls to avoid queue hanging" "$AUTOSCANNER_FILE"; then
    echo "✅ ConfigurationService fix already applied"
    exit 0
fi

# Apply the fix using sed
echo "🔄 Applying ConfigurationService fix..."

# Create a temporary file for the replacement
cat > /tmp/fix_config_service.sed << 'EOF'
# Replace the queueEntityCall line with direct API calls
s|await queueEntityCall('ScanSettings', 'upsert', this\.scannerService\.state\.settings);|// Persist to database using direct API calls to avoid queue hanging\
            console.log('[ConfigurationService] Fetching existing settings...');\
            try {\
                const listResponse = await fetch('http://localhost:3003/api/scanSettings');\
                const listResult = await listResponse.json();\
                const existingSettings = listResult.success ? listResult.data : [];\
                console.log('[ConfigurationService] Existing settings:');\
                console.log(existingSettings);\
                \
                if (existingSettings && existingSettings.length > 0) {\
                    console.log('[ConfigurationService] Updating existing settings with ID:');\
                    console.log(existingSettings[0].id);\
                    const updateResponse = await fetch(\`http://localhost:3003/api/scanSettings/\${existingSettings[0].id}\`, {\
                        method: 'PUT',\
                        headers: { 'Content-Type': 'application/json' },\
                        body: JSON.stringify(this.scannerService.state.settings)\
                    });\
                    const updateResult = await updateResponse.json();\
                    console.log('[ConfigurationService] Update result:');\
                    console.log(updateResult);\
                    \
                    if (!updateResult.success) {\
                        throw new Error(\`API update failed: \${updateResult.error || 'Unknown error'}\`);\
                    }\
                } else {\
                    console.log('[ConfigurationService] No existing settings found, creating new settings...');\
                    const createResponse = await fetch('http://localhost:3003/api/scanSettings', {\
                        method: 'POST',\
                        headers: { 'Content-Type': 'application/json' },\
                        body: JSON.stringify(this.scannerService.state.settings)\
                    });\
                    const createResult = await createResponse.json();\
                    console.log('[ConfigurationService] Create result:');\
                    console.log(createResult);\
                    \
                    if (!createResult.success) {\
                        throw new Error(\`API create failed: \${createResult.error || 'Unknown error'}\`);\
                    }\
                }\
                \
                console.log('[ConfigurationService] ✅ Database operations completed successfully');\
            } catch (error) {\
                console.error('[ConfigurationService] Error with direct API calls:', error);\
                throw error;\
            }|
EOF

# Apply the sed script
sed -i.bak -f /tmp/fix_config_service.sed "$AUTOSCANNER_FILE"

# Clean up
rm /tmp/fix_config_service.sed

# Verify the fix was applied
if grep -q "Persist to database using direct API calls to avoid queue hanging" "$AUTOSCANNER_FILE"; then
    echo "✅ ConfigurationService fix applied successfully"
else
    echo "❌ Failed to apply ConfigurationService fix"
    exit 1
fi

# Check for syntax errors
echo "🔍 Checking for syntax errors..."
if node -c "$AUTOSCANNER_FILE" 2>/dev/null; then
    echo "✅ No syntax errors found"
else
    echo "❌ Syntax errors detected!"
    exit 1
fi

echo "🎉 ConfigurationService fix completed successfully!"
