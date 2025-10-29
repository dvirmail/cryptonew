#!/bin/bash
# CryptoSentinel Quick Setup Script
# This script automates the installation process

set -e

echo "🚀 CryptoSentinel Quick Setup"
echo "=============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running on macOS, Linux, or Windows
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
else
    print_error "Unsupported operating system: $OSTYPE"
    exit 1
fi

print_status "Detected OS: $OS"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
print_success "Node.js version: $NODE_VERSION"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

NPM_VERSION=$(npm --version)
print_success "npm version: $NPM_VERSION"

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    print_warning "PostgreSQL is not installed."
    echo "Please install PostgreSQL:"
    if [[ "$OS" == "macos" ]]; then
        echo "  brew install postgresql@15"
    elif [[ "$OS" == "linux" ]]; then
        echo "  sudo apt install postgresql postgresql-contrib"
    else
        echo "  Download from: https://www.postgresql.org/download/"
    fi
    echo ""
    read -p "Press Enter after installing PostgreSQL..."
fi

# Install npm dependencies
print_status "Installing npm dependencies..."
npm install

if [ $? -eq 0 ]; then
    print_success "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    print_status "Creating .env file..."
    cat > .env << EOF
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cryptosentinel
DB_USER=cryptouser
DB_PASSWORD=your_password_here

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_SECRET_KEY=your_binance_secret_key
BINANCE_TESTNET=true

# Application Configuration
NODE_ENV=development
PORT=3003
CORS_ORIGIN=http://localhost:5174
EOF
    print_success ".env file created"
    print_warning "Please update .env file with your actual database and API credentials"
else
    print_success ".env file already exists"
fi

# Check if PostgreSQL is running
print_status "Checking PostgreSQL connection..."
if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    print_success "PostgreSQL is running"
else
    print_warning "PostgreSQL is not running. Please start it:"
    if [[ "$OS" == "macos" ]]; then
        echo "  brew services start postgresql@15"
    elif [[ "$OS" == "linux" ]]; then
        echo "  sudo systemctl start postgresql"
    fi
    echo ""
    read -p "Press Enter after starting PostgreSQL..."
fi

# Create database and user if they don't exist
print_status "Setting up database..."
psql -h localhost -U postgres -c "CREATE DATABASE cryptosentinel;" 2>/dev/null || print_warning "Database 'cryptosentinel' might already exist"
psql -h localhost -U postgres -c "CREATE USER cryptouser WITH PASSWORD 'cryptopass123';" 2>/dev/null || print_warning "User 'cryptouser' might already exist"
psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;" 2>/dev/null || print_warning "Failed to grant privileges"
psql -h localhost -U postgres -c "ALTER USER cryptouser CREATEDB;" 2>/dev/null || print_warning "Failed to alter user"

print_success "Database setup completed"

# Update .env with default database password
sed -i.bak 's/your_password_here/cryptopass123/g' .env
rm .env.bak 2>/dev/null || true

print_success "Updated .env with default database password"

# Create startup scripts
print_status "Creating startup scripts..."

# Create start-backend.sh
cat > start-backend.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting CryptoSentinel Backend..."
node proxy-server.cjs
EOF

# Create start-frontend.sh
cat > start-frontend.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting CryptoSentinel Frontend..."
npm run dev
EOF

# Create start-all.sh
cat > start-all.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting CryptoSentinel (Backend + Frontend)..."

# Start backend in background
node proxy-server.cjs &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend
npm run dev &
FRONTEND_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "🛑 Stopping services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for both processes
wait
EOF

# Make scripts executable
chmod +x start-backend.sh start-frontend.sh start-all.sh

print_success "Startup scripts created"

# Final instructions
echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Update .env file with your Binance API credentials"
echo "2. Import database schema using DBeaver (see INSTALLATION_GUIDE.md)"
echo "3. Start the application:"
echo "   ./start-all.sh"
echo ""
echo "📚 For detailed instructions, see INSTALLATION_GUIDE.md"
echo ""
echo "🔧 Available commands:"
echo "   ./start-backend.sh  - Start backend only"
echo "   ./start-frontend.sh - Start frontend only"
echo "   ./start-all.sh      - Start both backend and frontend"
echo ""
echo "⚠️  Remember to:"
echo "   - Use testnet for testing"
echo "   - Never commit API keys to git"
echo "   - Test thoroughly before live trading"
echo ""
print_success "Happy trading! 🚀"
