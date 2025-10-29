#!/bin/bash

# AutoScannerService.jsx Protection Script
# This script monitors the file and restores it if it gets corrupted

AUTOSCANNER_FILE="src/components/services/AutoScannerService.jsx"
BACKUP_FILE="src/components/services/AutoScannerService.jsx.backup"
MIN_SIZE=100000  # Minimum expected file size (100KB)

echo "🛡️  AutoScannerService.jsx Protection Script Started"
echo "📁 Monitoring: $AUTOSCANNER_FILE"

# Create initial backup
if [ -f "$AUTOSCANNER_FILE" ]; then
    cp "$AUTOSCANNER_FILE" "$BACKUP_FILE"
    echo "✅ Initial backup created: $BACKUP_FILE"
else
    echo "❌ AutoScannerService.jsx not found!"
    exit 1
fi

# Monitor function
monitor_file() {
    while true; do
        if [ -f "$AUTOSCANNER_FILE" ]; then
            FILE_SIZE=$(stat -f%z "$AUTOSCANNER_FILE" 2>/dev/null || echo "0")
            
            if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
                echo "🚨 CORRUPTION DETECTED! File size: $FILE_SIZE bytes (expected > $MIN_SIZE)"
                echo "🔄 Restoring from git..."
                
                if git restore "$AUTOSCANNER_FILE" 2>/dev/null; then
                    echo "✅ Restored from git successfully"
                    
                    # Reapply our fix
                    echo "🔧 Reapplying ConfigurationService fix..."
                    if [ -f "fix-config-service.sh" ]; then
                        bash fix-config-service.sh
                    else
                        echo "⚠️  fix-config-service.sh not found, manual fix needed"
                    fi
                else
                    echo "❌ Git restore failed, trying backup..."
                    if [ -f "$BACKUP_FILE" ]; then
                        cp "$BACKUP_FILE" "$AUTOSCANNER_FILE"
                        echo "✅ Restored from backup"
                    else
                        echo "❌ No backup available!"
                    fi
                fi
                
                # Update backup
                cp "$AUTOSCANNER_FILE" "$BACKUP_FILE"
                echo "✅ Backup updated"
            fi
        else
            echo "❌ AutoScannerService.jsx missing! Restoring..."
            git restore "$AUTOSCANNER_FILE" 2>/dev/null || echo "❌ Git restore failed"
        fi
        
        sleep 5  # Check every 5 seconds
    done
}

# Start monitoring
monitor_file
