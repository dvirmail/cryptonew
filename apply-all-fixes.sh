#!/bin/bash

echo "🔧 Applying all scanner configuration save fixes..."

# Create backup
cp src/components/services/AutoScannerService.jsx src/components/services/AutoScannerService.jsx.backup.$(date +%s)

echo "📝 Fixing ConfigurationService updateSettings method..."

# Fix the ConfigurationService updateSettings method to use direct API calls instead of queueEntityCall
sed -i '' 's|// Persist to database. Assume '\''upsert'\'' works with the `id` field.|// Persist to database using direct API calls to avoid queue hanging|' src/components/services/AutoScannerService.jsx

# Replace the queueEntityCall section with direct API calls
sed -i '' '/console.log('\''\[ConfigurationService\] Fetching existing settings\.\.\.'\'');/,/console.log('\''\[ConfigurationService\] Create result:'\'');/c\
            console.log('\''[ConfigurationService] Fetching existing settings...'\'');\
            try {\
                const listResponse = await fetch('\''http://localhost:3003/api/scanSettings'\'');\
                const listResult = await listResponse.json();\
                const existingSettings = listResult.success ? listResult.data : [];\
                console.log('\''[ConfigurationService] Existing settings:'\'');\
                console.log(existingSettings);\
                \
                if (existingSettings && existingSettings.length > 0) {\
                    console.log('\''[ConfigurationService] Updating existing settings with ID:'\'');\
                    console.log(existingSettings[0].id);\
                    const updateResponse = await fetch(`http://localhost:3003/api/scanSettings/${existingSettings[0].id}`, {\
                        method: '\''PUT'\'',\
                        headers: { '\''Content-Type'\'': '\''application/json'\'' },\
                        body: JSON.stringify(this.scannerService.state.settings)\
                    });\
                    const updateResult = await updateResponse.json();\
                    console.log('\''[ConfigurationService] Update result:'\'');\
                    console.log(updateResult);\
                } else {\
                    console.log('\''[ConfigurationService] No existing settings found, creating new settings...'\'');\
                    const createResponse = await fetch('\''http://localhost:3003/api/scanSettings'\'', {\
                        method: '\''POST'\'',\
                        headers: { '\''Content-Type'\'': '\''application/json'\'' },\
                        body: JSON.stringify(this.scannerService.state.settings)\
                    });\
                    const createResult = await createResponse.json();\
                    console.log('\''[ConfigurationService] Create result:'\'');\
                    console.log(createResult);\
                }\
            } catch (error) {\
                console.error('\''[ConfigurationService] Error with direct API calls:'\'', error);\
                throw error;\
            }' src/components/services/AutoScannerService.jsx

echo "✅ ConfigurationService fix applied"

# Check if the file is still valid
if node -c src/components/services/AutoScannerService.jsx 2>/dev/null; then
    echo "✅ File syntax is valid"
else
    echo "❌ File syntax error detected"
    exit 1
fi

echo "🎉 All fixes applied successfully!"
