# CryptoSentinel v125 - Advanced Trading Bot

A sophisticated cryptocurrency trading bot with comprehensive backtesting, real-time analysis, and automated position management.

## 🚀 Quick Start

**For fastest setup, see [QUICK_START.md](QUICK_START.md) - Get running in 5 minutes!**

### Option 1: Automated Dependency Installation (Recommended)

**macOS/Linux:**
```bash
# Clone the repository
git clone https://github.com/dvirmail/cryptonew.git
cd cryptonew

# Install all dependencies
./install-dependencies.sh

# Configure environment
cp env.template .env
# Edit .env with your settings

# Start the application
npm run dev
```

**Windows:**
```cmd
# Clone the repository
git clone https://github.com/dvirmail/cryptonew.git
cd cryptonew

# Install dependencies
npm install

# Configure environment
copy env.template .env
# Edit .env with your settings

# Start the application
npm run dev
```

### Option 2: Full Automated Setup

**macOS/Linux:**
```bash
# Clone the repository
git clone https://github.com/dvirmail/cryptonew.git
cd cryptonew

# Run full automated setup (includes database setup)
./setup.sh
```

**Windows:**
```cmd
# Clone the repository
git clone https://github.com/dvirmail/cryptonew.git
cd cryptonew

# Run automated setup
setup.bat
```

### Option 3: Manual Setup

1. **Install Prerequisites:**
   - Node.js 18+ and npm
   - PostgreSQL 12+ (optional but recommended)
   - DBeaver (database management, optional)

2. **Install Dependencies:**
```bash
   npm install
   ```

3. **Setup Database (Optional):**
   - Create database: `cryptosentinel`
   - Create user: `cryptouser`
   - Import schema from `supabase/migrations/`

4. **Configure Environment:**
   - Copy `env.template` to `.env`
   - Update with your Binance API credentials

5. **Start Application:**
```bash
   npm run dev
   ```

## 📋 Prerequisites

- **Node.js** 18+ and npm (16+ minimum, 18+ recommended)
- **PostgreSQL** 12+ database (optional but recommended for full features)
- **DBeaver** for database management (optional)
- **Binance Account** with API access
- **4GB+ RAM** recommended

## 🛠️ Installation

### Quick Start Guide

**New to CryptoSentinel?** Start here: [QUICK_START.md](QUICK_START.md)

This guide will get you up and running in 5 minutes with:
- Dependency installation
- Environment configuration
- Database setup (optional)
- Binance API configuration
- Troubleshooting tips

### Dependency Installation

**Automated Installation Script:**
```bash
./install-dependencies.sh
```

This script will:
- ✅ Check Node.js and npm versions
- ✅ Install all npm packages
- ✅ Verify critical dependencies
- ✅ Check optional tools (PostgreSQL, Git)
- ✅ Provide installation summary

**Manual Installation:**
```bash
npm install
```

### Detailed Installation Guide

For complete step-by-step instructions, see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)

### Key Components

1. **Frontend**: React + Vite + Tailwind CSS
2. **Backend**: Node.js + Express + PostgreSQL
3. **Trading**: Binance API integration
4. **Analysis**: Technical indicators and backtesting
5. **Database**: PostgreSQL with comprehensive schema

## 🎯 Features

### Trading Features
- **Real-time Trading**: Live position management
- **Backtesting Engine**: Historical strategy testing
- **Signal Detection**: 20+ technical indicators
- **Risk Management**: Stop-loss, take-profit, position sizing
- **Portfolio Management**: Multi-asset support

### Analysis Features
- **Market Regime Detection**: Trend analysis
- **Conviction Scoring**: Signal strength assessment
- **Performance Metrics**: P&L tracking and analytics
- **Strategy Optimization**: A/B testing capabilities

### Technical Features
- **RESTful API**: Complete backend API
- **WebSocket Support**: Real-time data streaming
- **Database Persistence**: PostgreSQL integration
- **Error Handling**: Comprehensive error management
- **Logging**: Detailed operation logs

## 🔧 Available Commands

```bash
# Development
npm run dev              # Start both frontend and backend
npm run start:frontend   # Start frontend only
npm run start:backend    # Start backend only
npm run start:all        # Start both services

# Database
npm run test:connection  # Test database connection
npm run db:setup         # Database setup instructions

# Utilities
npm run check:all        # Check all prerequisites
npm run clean            # Clean and reinstall dependencies
npm run reset            # Full reset (clean + reinstall)

# Build
npm run build            # Build for production
npm run preview          # Preview production build
```

## 📊 Database Schema

The application uses PostgreSQL with the following main tables:

- **`trades`**: Completed trade records
- **`live_positions`**: Active trading positions
- **`backtest_combinations`**: Strategy configurations
- **`central_wallet_state`**: Wallet balance tracking
- **`historical_performance`**: Performance metrics

## 🔐 Configuration

### Environment Variables

Create a `.env` file with:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cryptosentinel
DB_USER=cryptouser
DB_PASSWORD=your_password

# Binance API
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key
BINANCE_TESTNET=true

# Application
NODE_ENV=development
PORT=3003
CORS_ORIGIN=http://localhost:5174
```

### Binance API Setup

1. **Create Account**: Sign up at [binance.com](https://binance.com)
2. **Generate API Keys**: Account → API Management
3. **Enable Permissions**: Trading, Futures (if needed)
4. **Testnet First**: Use testnet for development

## 🚀 Deployment

### Google Cloud Platform

For production deployment to Google Cloud:

```bash
# Deploy to Google Cloud
./deploy-to-gcloud.sh
```

See [GCLOUD_DEPLOYMENT.md](GCLOUD_DEPLOYMENT.md) for detailed instructions.

### Docker Deployment

```bash
# Build Docker image
docker build -t cryptosentinel .

# Run container
docker run -p 3003:3003 cryptosentinel
```

## 📈 Usage

### 1. Initial Setup
1. Start the application: `npm run start:all`
2. Open browser: `http://localhost:5174`
3. Configure Binance API keys
4. Set trading parameters

### 2. Backtesting
1. Go to Backtesting tab
2. Select strategies and timeframes
3. Run backtest analysis
4. Review performance metrics

### 3. Live Trading
1. Switch to Live Trading mode
2. Enable desired strategies
3. Set position sizes and risk parameters
4. Monitor positions and performance

## 🔍 Troubleshooting

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

1. Check [QUICK_START.md](QUICK_START.md) for quick troubleshooting
2. Review [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) for detailed instructions
3. Review application logs
4. Verify database connectivity
5. Check Binance API configuration
6. Run `./install-dependencies.sh` to verify dependencies

## 📚 Documentation

- **[QUICK_START.md](QUICK_START.md)** - ⚡ Get started in 5 minutes (Recommended for new users)
- [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) - Complete installation instructions
- [GCLOUD_DEPLOYMENT.md](GCLOUD_DEPLOYMENT.md) - Google Cloud deployment guide
- [API Documentation](docs/api.md) - Backend API reference
- [Strategy Guide](docs/strategies.md) - Trading strategy configuration

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

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For technical support:
1. Check the troubleshooting section
2. Review application logs
3. Verify all prerequisites are installed
4. Test database connectivity
5. Check Binance API configuration

## 🎯 Roadmap

- [ ] Advanced charting capabilities
- [ ] Mobile application
- [ ] Additional exchange support
- [ ] Machine learning integration
- [ ] Social trading features

---

**Disclaimer**: Cryptocurrency trading involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results. Always trade responsibly and within your means.