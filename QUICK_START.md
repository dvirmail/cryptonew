# 🚀 CryptoSentinel Quick Start Guide

Get up and running with CryptoSentinel in minutes!

## ⚡ Fast Installation (5 minutes)

### Step 1: Prerequisites Check

```bash
# Check Node.js (should be 18+)
node --version

# Check npm
npm --version

# If not installed, install Node.js:
# macOS: brew install node
# Linux: sudo apt install nodejs npm
# Windows: Download from https://nodejs.org/
```

### Step 2: Install Dependencies

```bash
# Run the automated installation script
./install-dependencies.sh
```

The script will:
- ✅ Check Node.js and npm versions
- ✅ Install all npm packages
- ✅ Verify critical dependencies
- ✅ Check optional tools (PostgreSQL, Git)
- ✅ Provide next steps

**Alternative manual installation:**
```bash
npm install
```

### Step 3: Configure Environment

```bash
# Copy environment template
cp env.template .env

# Edit .env with your settings
# Required:
# - Database credentials
# - Binance API keys (use testnet for testing!)
```

### Step 4: Start the Application

```bash
# Start both backend and frontend
npm run dev

# Or start separately:
# Terminal 1: Backend (port 3003)
npm run api-server-direct

# Terminal 2: Frontend (port 5174)
npm run frontend
```

### Step 5: Access the Application

- **Frontend**: http://localhost:5174
- **Backend API**: http://localhost:3003

---

## 📋 What's Included

### Dependencies Installed

**Core Framework:**
- React 18.2.0 - UI framework
- Vite 6.1.0 - Build tool
- Express 4.18.2 - Backend server

**UI Components:**
- Radix UI components (dialogs, dropdowns, etc.)
- Tailwind CSS - Styling
- Recharts - Data visualization
- Framer Motion - Animations

**Backend:**
- PostgreSQL client (pg)
- Supabase client
- CORS support
- Express middleware

**Trading & Analysis:**
- Binance API integration
- Technical indicators
- Signal detection
- Backtesting engine

**Development Tools:**
- ESLint - Code linting
- TypeScript types
- Vite plugins

---

## 🗄️ Database Setup (Optional but Recommended)

If you want to use database features:

### 1. Install PostgreSQL

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux:**
```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download from https://www.postgresql.org/download/

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE cryptosentinel;
CREATE USER cryptouser WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;
\q
```

### 3. Run Migrations

Import SQL files from `supabase/migrations/` in order:
1. `001_initial_schema.sql`
2. `002_rls_policies.sql`
3. `003_central_wallet_state.sql`
4. ... (and other migration files)

---

## 🔑 Binance API Setup

### 1. Create API Keys

1. Go to https://www.binance.com/en/my/settings/api-management
2. Create API key
3. **Enable Testnet** for testing (recommended!)
4. Copy API Key and Secret Key

### 2. Configure in .env

```env
BINANCE_API_KEY=your_api_key_here
BINANCE_SECRET_KEY=your_secret_key_here
BINANCE_TESTNET=true  # Use testnet for testing!
```

⚠️ **Security Note:**
- Never commit `.env` to git
- Use testnet for development
- Restrict API key permissions (read-only for testing)
- Enable IP whitelist if possible

---

## 🎯 Common Commands

### Development

```bash
npm run dev          # Start both backend + frontend
npm run frontend     # Start frontend only (port 5174)
npm run api-server   # Start backend only (port 3003)
npm run build        # Build for production
npm run lint         # Run ESLint
```

### Database

```bash
npm run check:node      # Check Node.js version
npm run check:postgres # Check PostgreSQL
npm run test:connection # Test database connection
```

### Maintenance

```bash
npm run clean    # Remove node_modules and reinstall
npm run reset    # Clean + kill proxy + reinstall
npm run kill-proxy # Stop backend server
```

---

## 🐛 Troubleshooting

### Installation Issues

**Problem:** `npm install` fails
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

**Problem:** Node.js version too old
```bash
# Update Node.js using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
nvm use --lts
```

**Problem:** Permission errors
```bash
# Fix npm permissions (macOS/Linux)
sudo chown -R $(whoami) ~/.npm
```

### Runtime Issues

**Problem:** Port already in use
```bash
# Kill process on port 3003 (backend)
npm run kill-proxy

# Or manually:
lsof -ti:3003 | xargs kill -9
```

**Problem:** Database connection fails
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Check firewall settings
- Ensure database exists: `psql -U postgres -l`

**Problem:** Binance API errors
- Verify API keys in `.env`
- Check API key permissions
- Ensure testnet is enabled for testing
- Check rate limits

---

## 📚 Next Steps

1. **Read the Documentation:**
   - [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) - Detailed setup
   - [README.md](README.md) - Full feature list

2. **Explore Features:**
   - Backtesting engine
   - Live trading scanner
   - Performance analytics
   - Strategy management

3. **Configure Settings:**
   - Trading parameters
   - Risk management
   - Signal thresholds
   - Position sizing

4. **Test Thoroughly:**
   - Use testnet first!
   - Start with small positions
   - Monitor performance
   - Review logs

---

## 🆘 Need Help?

- Check [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) for detailed instructions
- Review error logs in console
- Check database connection with `npm run test:connection`
- Verify all environment variables are set

---

## ✅ Installation Checklist

- [ ] Node.js 18+ installed
- [ ] npm installed
- [ ] Dependencies installed (`./install-dependencies.sh`)
- [ ] `.env` file created and configured
- [ ] Database set up (optional)
- [ ] Binance API keys configured
- [ ] Application starts successfully
- [ ] Frontend accessible at http://localhost:5174
- [ ] Backend accessible at http://localhost:3003

---

**Ready to trade? Remember to use testnet first! 🚀**

