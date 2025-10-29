#!/bin/bash

# Crypto Sentinel Startup Script with Data Recovery
# This script ensures data integrity before starting the application

echo "🚀 Starting Crypto Sentinel with Data Recovery..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the correct directory
if [ ! -f "proxy-server.cjs" ]; then
    echo "❌ proxy-server.cjs not found. Please run this script from the project root directory."
    exit 1
fi

# Create storage directory if it doesn't exist
if [ ! -d "storage" ]; then
    echo "📁 Creating storage directory..."
    mkdir -p storage
fi

# Run data recovery tool if it exists
if [ -f "data-recovery-tool.cjs" ]; then
    echo "🔧 Running data recovery tool..."
    node data-recovery-tool.cjs
    
    if [ $? -eq 0 ]; then
        echo "✅ Data recovery completed successfully"
    else
        echo "⚠️ Data recovery completed with warnings"
    fi
else
    echo "⚠️ Data recovery tool not found, skipping..."
fi

# Start the proxy server
echo "🌐 Starting proxy server..."
node proxy-server.cjs
