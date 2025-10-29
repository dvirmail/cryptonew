# CryptoSentinel v125 - Complete Trading Bot Package

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- **Node.js 16+** and npm
- **PostgreSQL 12+** database
- **Binance Account** with API access

### Installation

**Option 1: Automated Setup (Recommended)**
```bash
# macOS/Linux
./setup.sh

# Windows
setup.bat
```

**Option 2: Manual Setup**
```bash
# 1. Install dependencies
npm install

# 2. Setup database (see Database Setup below)
# 3. Configure environment (see Configuration below)
# 4. Start application
npm run start:all
```

## 📋 What's Included

### Core Application
- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express + PostgreSQL
- **Trading Engine**: Binance API integration
- **Backtesting**: Historical strategy testing
- **Database**: Complete PostgreSQL schema

### Key Features
- ✅ **Real-time Trading**: Live position management
- ✅ **Backtesting Engine**: Historical strategy testing
- ✅ **Signal Detection**: 20+ technical indicators
- ✅ **Risk Management**: Stop-loss, take-profit, position sizing
- ✅ **Portfolio Management**: Multi-asset support
- ✅ **Performance Analytics**: P&L tracking and metrics

### Files Structure
```
cryptosentinel-v125/
├── src/                    # Frontend React application
├── proxy-server.cjs        # Backend API server
├── supabase/              # Database migrations
├── storage/               # File storage
├── setup.sh              # Automated setup (macOS/Linux)
├── setup.bat             # Automated setup (Windows)
├── INSTALLATION_GUIDE.md # Detailed installation guide
├── README.md             # Main documentation
└── package.json          # Dependencies and scripts
```

## 🛠️ Database Setup

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
Download from [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Create Database
```sql
-- Connect to PostgreSQL as postgres user
CREATE DATABASE cryptosentinel;
CREATE USER cryptouser WITH PASSWORD 'cryptopass123';
GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;
ALTER USER cryptouser CREATEDB;
```

### 3. Import Schema
The application will automatically create tables on first run, or you can manually run the SQL files in `supabase/migrations/` folder.

## ⚙️ Configuration

### 1. Environment Variables
Copy `env.template` to `.env` and update:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cryptosentinel
DB_USER=cryptouser
DB_PASSWORD=cryptopass123

# Binance API (Get from binance.com)
BINANCE_API_KEY=your_api_key_here
BINANCE_SECRET_KEY=your_secret_key_here
BINANCE_TESTNET=true

# Application
NODE_ENV=development
PORT=3003
CORS_ORIGIN=http://localhost:5174
```

### 2. Binance API Setup
1. **Create Account**: [binance.com](https://binance.com)
2. **Generate API Keys**: Account → API Management
3. **Enable Permissions**: Trading, Futures (if needed)
4. **Start with Testnet**: Use testnet for development

## 🚀 Running the Application

### Start Everything
```bash
npm run start:all
```

### Individual Services
```bash
# Backend only
npm run start:backend

# Frontend only
npm run start:frontend
```

### Access Application
- **Frontend**: http://localhost:5174
- **Backend API**: http://localhost:3003

## 📊 Available Commands

```bash
# Development
npm run dev              # Start both frontend and backend
npm run start:all        # Alternative start command
npm run build            # Build for production

# Database
npm run test:connection  # Test database connection
npm run db:setup         # Database setup instructions

# Utilities
npm run check:all        # Check all prerequisites
npm run clean            # Clean and reinstall dependencies
npm run reset            # Full reset (clean + reinstall)
```

## 🔧 Troubleshooting

### Common Issues

**Port Already in Use:**
```bash
npm run kill-proxy
```

**Database Connection Failed:**
```bash
npm run test:connection
```

**Dependencies Issues:**
```bash
npm run clean
```

**Check Prerequisites:**
```bash
npm run check:all
```

### Getting Help
1. Check `INSTALLATION_GUIDE.md` for detailed instructions
2. Review application logs in terminal
3. Verify database connectivity
4. Check Binance API configuration

## 📚 Documentation

- **INSTALLATION_GUIDE.md**: Complete step-by-step installation
- **README.md**: Main documentation and features
- **GCLOUD_DEPLOYMENT.md**: Google Cloud deployment guide
- **API Documentation**: Backend API reference in code

## ⚠️ Important Notes

### Security
- **Never commit API keys** to version control
- **Use testnet** for development and testing
- **Enable 2FA** on your Binance account
- **Restrict API permissions** to minimum required

### Risk Management
- **Start with small position sizes**
- **Test thoroughly** before live trading
- **Monitor positions** closely
- **Use stop-losses** and position limits

### Legal Compliance
- **Check local regulations** for cryptocurrency trading
- **Understand tax implications** of trading
- **Trade responsibly** and within your means

## 🎯 Next Steps

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

## 🆘 Support

For technical support:
1. Check the troubleshooting section above
2. Review application logs
3. Verify all prerequisites are installed
4. Test database connectivity
5. Check Binance API configuration

## 📄 License

This project is licensed under the MIT License.

---

**Disclaimer**: Cryptocurrency trading involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results. Always trade responsibly and within your means.

## 🎉 Ready to Start Trading!

Your CryptoSentinel trading bot is ready to go! Follow the quick start guide above to get up and running in minutes.

Happy trading! 🚀
