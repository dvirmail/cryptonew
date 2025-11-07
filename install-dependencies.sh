#!/bin/bash

# CryptoSentinel Dependency Installation Script
# This script installs all required npm packages and dependencies

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_header "CryptoSentinel Dependency Installation"

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

print_status "Working directory: $SCRIPT_DIR"

# Check if Node.js is installed
print_status "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed!"
    echo ""
    echo "Please install Node.js first:"
    echo "  macOS:   brew install node"
    echo "  Linux:   sudo apt install nodejs npm"
    echo "  Windows: Download from https://nodejs.org/"
    echo ""
    echo "Or use nvm (Node Version Manager):"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "  nvm install --lts"
    exit 1
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
print_success "Node.js: $NODE_VERSION"
print_success "npm: $NPM_VERSION"

# Check Node.js version (recommend 18+)
NODE_MAJOR_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then
    print_warning "Node.js version is $NODE_VERSION. Version 18+ is recommended."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found in current directory!"
    print_error "Please run this script from the project root directory."
    exit 1
fi

print_success "package.json found"

# Check if node_modules exists and ask about cleanup
if [ -d "node_modules" ]; then
    print_warning "node_modules directory already exists."
    echo ""
    echo "Options:"
    echo "  1. Clean install (remove node_modules and reinstall) - Recommended"
    echo "  2. Update existing installation"
    echo "  3. Skip (keep existing installation)"
    echo ""
    read -p "Choose option (1-3): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[1]$ ]]; then
        print_status "Removing existing node_modules..."
        rm -rf node_modules
        print_success "node_modules removed"
    elif [[ $REPLY =~ ^[3]$ ]]; then
        print_warning "Skipping installation. Using existing node_modules."
        exit 0
    fi
fi

# Check if package-lock.json exists
if [ -f "package-lock.json" ]; then
    print_status "package-lock.json found - will use locked versions"
else
    print_warning "package-lock.json not found - will install latest compatible versions"
fi

# Install npm dependencies
print_header "Installing npm Dependencies"

print_status "This may take a few minutes..."
print_status "Installing production and development dependencies..."

# Use npm ci if package-lock.json exists, otherwise npm install
if [ -f "package-lock.json" ]; then
    print_status "Using 'npm ci' for faster, reliable, reproducible builds..."
    npm ci
else
    print_status "Using 'npm install' to create package-lock.json..."
    npm install
fi

if [ $? -eq 0 ]; then
    print_success "All dependencies installed successfully!"
else
    print_error "Failed to install dependencies"
    echo ""
    print_status "Troubleshooting tips:"
    echo "  1. Check your internet connection"
    echo "  2. Try clearing npm cache: npm cache clean --force"
    echo "  3. Delete node_modules and package-lock.json, then run again"
    echo "  4. Check for Node.js version compatibility"
    exit 1
fi

# Verify installation
print_header "Verifying Installation"

# Check if key dependencies are installed
print_status "Checking key dependencies..."

MISSING_DEPS=0

check_dependency() {
    if [ -d "node_modules/$1" ]; then
        print_success "$1 installed"
    else
        print_error "$1 not found"
        MISSING_DEPS=1
    fi
}

# Check critical dependencies
check_dependency "react"
check_dependency "react-dom"
check_dependency "vite"
check_dependency "express"
check_dependency "@supabase/supabase-js"
check_dependency "pg"

if [ $MISSING_DEPS -eq 1 ]; then
    print_error "Some dependencies are missing. Please run the installation again."
    exit 1
fi

# Check for optional tools
print_header "Checking Optional Tools"

# Check for PostgreSQL (optional, but recommended)
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version | head -n1)
    print_success "PostgreSQL: $PSQL_VERSION"
else
    print_warning "PostgreSQL not found (optional, but required for database features)"
    echo "  Install with:"
    echo "    macOS:   brew install postgresql@15"
    echo "    Linux:   sudo apt install postgresql postgresql-contrib"
fi

# Check for Git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version)
    print_success "Git: $GIT_VERSION"
else
    print_warning "Git not found (optional, for version control)"
fi

# Summary
print_header "Installation Summary"

print_success "✓ Node.js: $NODE_VERSION"
print_success "✓ npm: $NPM_VERSION"
print_success "✓ All npm dependencies installed"

# Count installed packages
if [ -d "node_modules" ]; then
    PACKAGE_COUNT=$(find node_modules -maxdepth 1 -type d | wc -l | tr -d ' ')
    print_success "✓ Installed $PACKAGE_COUNT packages"
fi

# Check disk space used
if [ -d "node_modules" ]; then
    DISK_USAGE=$(du -sh node_modules 2>/dev/null | cut -f1)
    print_status "Disk usage: $DISK_USAGE"
fi

# Next steps
print_header "Next Steps"

echo "1. Create/update .env file with your configuration:"
echo "   - Database credentials"
echo "   - Binance API keys"
echo "   - Other environment variables"
echo ""
echo "2. Set up the database (if using PostgreSQL):"
echo "   - Create database: cryptosentinel"
echo "   - Run migrations from supabase/migrations/"
echo ""
echo "3. Start the development server:"
echo "   npm run dev"
echo ""
echo "   Or start backend and frontend separately:"
echo "   npm run api-server-direct  # Backend on port 3003"
echo "   npm run frontend            # Frontend on port 5174"
echo ""
echo "4. Available npm scripts:"
echo "   npm run dev          - Start both backend and frontend"
echo "   npm run build         - Build for production"
echo "   npm run lint          - Run ESLint"
echo "   npm run clean         - Remove node_modules and reinstall"
echo ""

print_success "Installation completed successfully! 🚀"
echo ""

