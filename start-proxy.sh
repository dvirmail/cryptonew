#!/bin/bash

# Crypto Sentinel Proxy Server Startup Script
# Prevents port conflicts and ensures clean startup

PORT=3003
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting Crypto Sentinel Proxy Server..."

# Function to check if port is in use
check_port() {
    if lsof -ti:$PORT >/dev/null 2>&1; then
        echo "⚠️  Port $PORT is already in use"
        return 1
    else
        echo "✅ Port $PORT is available"
        return 0
    fi
}

# Function to kill existing processes
kill_existing() {
    echo "🔍 Killing existing processes on port $PORT..."
    lsof -ti:$PORT | xargs kill -9 2>/dev/null
    sleep 2
    echo "✅ Cleaned up existing processes"
}

# Function to start the server
start_server() {
    echo "🚀 Starting proxy server on port $PORT..."
    cd "$PROJECT_DIR"
    node proxy-server.cjs
}

# Main execution
echo "🔍 Checking port $PORT availability..."

if ! check_port; then
    echo "🔄 Port conflict detected, cleaning up..."
    kill_existing
    
    # Wait a moment and check again
    sleep 1
    if ! check_port; then
        echo "❌ Failed to free port $PORT after cleanup"
        echo "💡 Try running manually: sudo lsof -ti:$PORT | xargs kill -9"
        exit 1
    fi
fi

echo "✅ Port $PORT is ready"
start_server
