# CryptoSentinel Installation Guide

Complete installation instructions for the CryptoSentinel trading bot with all dependencies.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Node.js & NPM Installation](#nodejs--npm-installation)
3. [PostgreSQL Database Setup](#postgresql-database-setup)
4. [DBeaver Database Management](#dbeaver-database-management)
5. [Application Installation](#application-installation)
6. [Database Configuration](#database-configuration)
7. [Environment Setup](#environment-setup)
8. [Binance API Configuration](#binance-api-configuration)
9. [Running the Application](#running-the-application)
10. [Troubleshooting](#troubleshooting)

## System Requirements

- **Operating System**: macOS, Linux, or Windows
- **RAM**: Minimum 4GB, Recommended 8GB+
- **Storage**: 2GB free space
- **Internet**: Stable connection for real-time data
- **Browser**: Chrome, Firefox, Safari, or Edge (latest versions)

## Node.js & NPM Installation

### macOS (using Homebrew)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and npm
brew install node

# Verify installation
node --version
npm --version
```

### Linux (Ubuntu/Debian)

```bash
# Update package index
sudo apt update

# Install Node.js and npm
sudo apt install nodejs npm

# Verify installation
node --version
npm --version
```

### Windows

1. Download Node.js from [nodejs.org](https://nodejs.org/)
2. Run the installer and follow the setup wizard
3. Verify installation in Command Prompt:
   ```cmd
   node --version
   npm --version
   ```

### Alternative: Using Node Version Manager (NVM)

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Restart terminal or source profile
source ~/.bashrc  # or ~/.zshrc

# Install latest LTS Node.js
nvm install --lts
nvm use --lts

# Verify installation
node --version
npm --version
```

## PostgreSQL Database Setup

### macOS (using Homebrew)

```bash
# Install PostgreSQL
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Create a database user
createuser -s postgres
createdb postgres

# Set password for postgres user
psql postgres
ALTER USER postgres PASSWORD 'your_password_here';
\q
```

### Linux (Ubuntu/Debian)

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Switch to postgres user and create database
sudo -u postgres psql

# In PostgreSQL shell:
CREATE DATABASE cryptosentinel;
CREATE USER cryptouser WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;
ALTER USER cryptouser CREATEDB;
\q
```

### Windows

1. Download PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Run the installer
3. Set password for postgres user during installation
4. Use pgAdmin or command line to create database:

```sql
-- Connect to PostgreSQL as postgres user
CREATE DATABASE cryptosentinel;
CREATE USER cryptouser WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;
ALTER USER cryptouser CREATEDB;
```

### Database Connection Details

After installation, note these details:
- **Host**: localhost (or 127.0.0.1)
- **Port**: 5432 (default)
- **Database**: cryptosentinel
- **Username**: cryptouser (or postgres)
- **Password**: [your chosen password]

## DBeaver Database Management

### Installation

1. Download DBeaver from [dbeaver.io](https://dbeaver.io/download/)
2. Install the Community Edition (free)
3. Launch DBeaver

### Database Connection Setup

1. **Create New Connection**:
   - Click "New Database Connection" (+ icon)
   - Select "PostgreSQL"
   - Click "Next"

2. **Configure Connection**:
   - **Host**: localhost
   - **Port**: 5432
   - **Database**: cryptosentinel
   - **Username**: cryptouser
   - **Password**: [your password]
   - Click "Test Connection"
   - Click "Finish" if successful

3. **Import Database Schema**:
   - Right-click on your connection
   - Select "SQL Editor" → "Open SQL script"
   - Navigate to `supabase/migrations/` folder
   - Run these files in order:
     - `001_initial_schema.sql`
     - `002_rls_policies.sql`
     - `003_central_wallet_state.sql`
     - `004_add_crypto_assets_value.sql`

## Application Installation

### 1. Clone Repository

```bash
# Clone the repository
git clone https://github.com/dvirmail/cryptonew.git
cd cryptonew

# Or download and extract ZIP file
# Unzip to your desired location
```

### 2. Install Dependencies

```bash
# Install all required packages
npm install

# This will install:
# - React and Vite for frontend
# - Express.js for backend
# - PostgreSQL client (pg)
# - Binance API client
# - Chart.js for data visualization
# - Tailwind CSS for styling
# - And many other dependencies
```

### 3. Verify Installation

```bash
# Check if all dependencies are installed
npm list --depth=0

# Should show all packages without errors
```

## Database Configuration

### 1. Update Database Connection

Edit `proxy-server.cjs` and update the database connection:

```javascript
// Find this section in proxy-server.cjs
const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'cryptosentinel',
  user: 'cryptouser',
  password: 'your_password_here',
  ssl: false
};
```

### 2. Run Database Migrations

```bash
# The application will automatically run migrations on startup
# Or manually run them using DBeaver as described above
```

### 3. Verify Database Tables

In DBeaver, verify these tables exist:
- `trades`
- `live_positions`
- `backtest_combinations`
- `central_wallet_state`
- `wallet_config`
- `historical_performance`

## Environment Setup

### 1. Create Environment File

Create `.env` file in the root directory:

```bash
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
```

### 2. Binance API Setup

1. **Create Binance Account**:
   - Go to [binance.com](https://binance.com)
   - Complete KYC verification

2. **Generate API Keys**:
   - Go to Account → API Management
   - Create new API key
   - Enable "Enable Trading" for live trading
   - Enable "Enable Futures" if using futures
   - **Important**: Start with testnet for testing

3. **Testnet Setup**:
   - Go to [testnet.binance.vision](https://testnet.binance.vision)
   - Create testnet account
   - Generate testnet API keys
   - Get testnet USDT from faucet

## Running the Application

### 1. Start the Backend Server

```bash
# Start the proxy server
node proxy-server.cjs

# You should see:
# 🚀 Binance Proxy Server running on port 3003
#    Mainnet: https://api.binance.com
#    Testnet: https://testnet.binance.vision
#    CORS enabled for localhost:5174
#    Database: Connected
```

### 2. Start the Frontend

In a new terminal:

```bash
# Start the React development server
npm run dev

# You should see:
# Local:   http://localhost:5174/
# Network: use --host to expose
```

### 3. Access the Application

1. Open browser to `http://localhost:5174`
2. The application should load with the trading interface
3. Configure your Binance API keys in the settings
4. Start with testnet mode for safe testing

## NPM Functions and Scripts

The application includes several npm scripts:

```bash
# Development
npm run dev              # Start frontend development server
npm run build            # Build for production
npm run preview          # Preview production build

# Backend
node proxy-server.cjs    # Start backend server
npm run server           # Alternative server start (if configured)

# Database
npm run db:migrate       # Run database migrations
npm run db:seed          # Seed database with sample data

# Utilities
npm run lint             # Run ESLint
npm run format           # Format code with Prettier
npm run test             # Run tests (if available)
```

## Required NPM Packages

The application uses these key packages:

### Backend Dependencies
- `express` - Web server framework
- `cors` - Cross-origin resource sharing
- `pg` - PostgreSQL client
- `axios` - HTTP client for API calls
- `ws` - WebSocket support
- `node-cron` - Scheduled tasks

### Frontend Dependencies
- `react` - UI framework
- `vite` - Build tool and dev server
- `chart.js` - Charting library
- `tailwindcss` - CSS framework
- `lucide-react` - Icon library
- `recharts` - Additional charting

### Trading Dependencies
- `binance-api-node` - Binance API client
- `technicalindicators` - Technical analysis
- `ccxt` - Cryptocurrency exchange library

## Troubleshooting

### Common Issues

1. **Port Already in Use**:
   ```bash
   # Kill process using port 3003
   lsof -ti:3003 | xargs kill -9
   
   # Or use different port
   PORT=3004 node proxy-server.cjs
   ```

2. **Database Connection Failed**:
   - Verify PostgreSQL is running
   - Check connection details in `proxy-server.cjs`
   - Ensure database and user exist

3. **Binance API Errors**:
   - Verify API keys are correct
   - Check if testnet/mainnet mode matches
   - Ensure API permissions are enabled

4. **Dependencies Issues**:
   ```bash
   # Clear npm cache and reinstall
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

5. **Build Errors**:
   ```bash
   # Update Node.js to latest LTS
   nvm install --lts
   nvm use --lts
   
   # Reinstall dependencies
   npm install
   ```

### Getting Help

1. **Check Logs**:
   - Backend logs in terminal running `proxy-server.cjs`
   - Browser console for frontend errors
   - Database logs in DBeaver

2. **Verify Installation**:
   ```bash
   # Check Node.js version (should be 16+)
   node --version
   
   # Check PostgreSQL
   psql --version
   
   # Check if ports are free
   lsof -i :3003
   lsof -i :5174
   ```

3. **Reset Everything**:
   ```bash
   # Stop all services
   pkill -f "node proxy-server.cjs"
   pkill -f "vite"
   
   # Clear database
   # (Use DBeaver to drop and recreate database)
   
   # Restart from scratch
   npm install
   node proxy-server.cjs
   npm run dev
   ```

## Security Notes

1. **Never commit API keys** to version control
2. **Use testnet** for development and testing
3. **Enable 2FA** on your Binance account
4. **Restrict API permissions** to minimum required
5. **Use environment variables** for sensitive data
6. **Regularly rotate** API keys

## Next Steps

After successful installation:

1. **Configure Trading Settings**:
   - Set position sizes
   - Configure stop-loss and take-profit
   - Enable/disable strategies

2. **Test with Paper Trading**:
   - Start with testnet mode
   - Monitor trades and performance
   - Adjust settings as needed

3. **Go Live** (when ready):
   - Switch to mainnet mode
   - Start with small position sizes
   - Monitor closely for first few days

4. **Set Up Monitoring**:
   - Configure alerts
   - Set up logging
   - Monitor performance metrics

## Support

For technical support:
1. Check this installation guide
2. Review application logs
3. Verify all dependencies are installed
4. Test database connectivity
5. Check Binance API configuration

---

**Important**: Always test thoroughly with testnet before using real funds. Cryptocurrency trading involves risk, and you should never trade with money you cannot afford to lose.
