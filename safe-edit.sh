#!/bin/bash

# Safe AutoScannerService Editor
# This script prevents file corruption by:
# 1. Creating backups before edits
# 2. Validating syntax after edits
# 3. Restoring from backup if corruption detected

AUTO_SCANNER_FILE="src/components/services/AutoScannerService.jsx"
BACKUP_DIR="src/components/services/backups"
TIMESTAMP=$(date +%s)

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Function to create backup
create_backup() {
    local backup_file="$BACKUP_DIR/AutoScannerService.jsx.backup.$TIMESTAMP"
    cp "$AUTO_SCANNER_FILE" "$backup_file"
    echo "✅ Backup created: $backup_file"
    return 0
}

# Function to validate file syntax
validate_syntax() {
    local file="$1"
    
    # Check if file is empty
    if [ ! -s "$file" ]; then
        echo "❌ File is empty or doesn't exist"
        return 1
    fi
    
    # Check if file has basic JavaScript structure
    if ! grep -q "import.*from" "$file" 2>/dev/null; then
        echo "❌ File doesn't appear to be a valid JavaScript file"
        return 1
    fi
    
    # Check for obvious syntax errors (basic validation)
    if grep -q "SyntaxError\|Unexpected token" "$file" 2>/dev/null; then
        echo "❌ File contains syntax error markers"
        return 1
    fi
    
    echo "✅ File syntax appears valid"
    return 0
}

# Function to restore from backup
restore_from_backup() {
    local backup_file="$1"
    if [ -f "$backup_file" ]; then
        cp "$backup_file" "$AUTO_SCANNER_FILE"
        echo "✅ Restored from backup: $backup_file"
        return 0
    else
        echo "❌ Backup file not found: $backup_file"
        return 1
    fi
}

# Function to safely edit file
safe_edit() {
    local edit_command="$1"
    local description="$2"
    
    echo "🔧 Applying edit: $description"
    
    # Create backup before edit
    create_backup
    
    # Apply the edit
    eval "$edit_command"
    
    # Validate the result
    if validate_syntax "$AUTO_SCANNER_FILE"; then
        echo "✅ Edit successful: $description"
        return 0
    else
        echo "❌ Edit failed, restoring from backup..."
        restore_from_backup "$BACKUP_DIR/AutoScannerService.jsx.backup.$TIMESTAMP"
        return 1
    fi
}

# Main execution
case "$1" in
    "backup")
        create_backup
        ;;
    "validate")
        validate_syntax "$AUTO_SCANNER_FILE"
        ;;
    "restore")
        if [ -z "$2" ]; then
            echo "Usage: $0 restore <backup_file>"
            exit 1
        fi
        restore_from_backup "$2"
        ;;
    "edit")
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: $0 edit '<edit_command>' '<description>'"
            exit 1
        fi
        safe_edit "$2" "$3"
        ;;
    *)
        echo "Safe AutoScannerService Editor"
        echo "Usage:"
        echo "  $0 backup                    - Create a backup"
        echo "  $0 validate                 - Validate current file"
        echo "  $0 restore <backup_file>    - Restore from backup"
        echo "  $0 edit '<command>' '<desc>' - Safely apply edit"
        echo ""
        echo "Examples:"
        echo "  $0 edit 'sed -i \"s/old/new/g\" $AUTO_SCANNER_FILE' 'Replace old with new'"
        echo "  $0 backup"
        echo "  $0 validate"
        ;;
esac
