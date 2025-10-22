#!/bin/bash

# CryptoSentinel Local Development Startup Script

echo "🚀 Starting CryptoSentinel Local Development Environment"
echo "=================================================="

# Check if PostgreSQL is running
echo "📊 Checking PostgreSQL connection..."
if ! /Applications/Postgres.app/Contents/Versions/18/bin/psql dvirturkenitch -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running or database 'dvirturkenitch' doesn't exist"
    echo "💡 Please start PostgreSQL and create the database:"
    echo "   createdb dvirturkenitch"
    echo "   /Applications/Postgres.app/Contents/Versions/18/bin/psql dvirturkenitch -f functions/schema.sql"
    exit 1
fi

echo "✅ PostgreSQL connection successful"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if API server dependencies are installed
if [ ! -d "node_modules/pg" ]; then
    echo "📦 Installing API server dependencies..."
    npm install pg express cors concurrently
fi

echo "🌐 Starting local API server on port 3001..."
node local-api-server.js &
API_PID=$!

# Wait a moment for API server to start
sleep 2

echo "🎨 Starting frontend development server on port 5173..."
npm run frontend &
FRONTEND_PID=$!

echo ""
echo "🎉 CryptoSentinel is now running locally!"
echo "=================================================="
echo "📊 API Server: http://localhost:3001"
echo "🎨 Frontend:   http://localhost:5173"
echo "🗄️  Database:  PostgreSQL (dvirturkenitch)"
echo ""
echo "Press Ctrl+C to stop all services"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    kill $API_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "✅ All services stopped"
    exit 0
}

# Trap Ctrl+C
trap cleanup INT

# Wait for processes
wait
