@echo off
REM CryptoSentinel Quick Setup Script for Windows
REM This script automates the installation process

echo 🚀 CryptoSentinel Quick Setup
echo ==============================

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js first.
    echo Visit: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [SUCCESS] Node.js version: %NODE_VERSION%

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed. Please install npm first.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [SUCCESS] npm version: %NPM_VERSION%

REM Check if PostgreSQL is installed
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] PostgreSQL is not installed.
    echo Please install PostgreSQL from: https://www.postgresql.org/download/windows/
    echo.
    pause
)

REM Install npm dependencies
echo [INFO] Installing npm dependencies...
call npm install

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo [SUCCESS] Dependencies installed successfully

REM Create .env file if it doesn't exist
if not exist .env (
    echo [INFO] Creating .env file...
    (
        echo # Database Configuration
        echo DB_HOST=localhost
        echo DB_PORT=5432
        echo DB_NAME=cryptosentinel
        echo DB_USER=cryptouser
        echo DB_PASSWORD=cryptopass123
        echo.
        echo # Binance API Configuration
        echo BINANCE_API_KEY=your_binance_api_key
        echo BINANCE_SECRET_KEY=your_binance_secret_key
        echo BINANCE_TESTNET=true
        echo.
        echo # Application Configuration
        echo NODE_ENV=development
        echo PORT=3003
        echo CORS_ORIGIN=http://localhost:5174
    ) > .env
    echo [SUCCESS] .env file created
    echo [WARNING] Please update .env file with your actual database and API credentials
) else (
    echo [SUCCESS] .env file already exists
)

REM Check if PostgreSQL is running
echo [INFO] Checking PostgreSQL connection...
pg_isready -h localhost -p 5432 >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] PostgreSQL is not running. Please start it from Services or pgAdmin.
    pause
)

REM Create database and user
echo [INFO] Setting up database...
psql -h localhost -U postgres -c "CREATE DATABASE cryptosentinel;" >nul 2>&1
psql -h localhost -U postgres -c "CREATE USER cryptouser WITH PASSWORD 'cryptopass123';" >nul 2>&1
psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;" >nul 2>&1
psql -h localhost -U postgres -c "ALTER USER cryptouser CREATEDB;" >nul 2>&1

echo [SUCCESS] Database setup completed

REM Create startup scripts
echo [INFO] Creating startup scripts...

REM Create start-backend.bat
(
    echo @echo off
    echo echo 🚀 Starting CryptoSentinel Backend...
    echo node proxy-server.cjs
    echo pause
) > start-backend.bat

REM Create start-frontend.bat
(
    echo @echo off
    echo echo 🚀 Starting CryptoSentinel Frontend...
    echo npm run dev
    echo pause
) > start-frontend.bat

REM Create start-all.bat
(
    echo @echo off
    echo echo 🚀 Starting CryptoSentinel ^(Backend + Frontend^)...
    echo.
    echo start "Backend" cmd /k "node proxy-server.cjs"
    echo timeout /t 3 /nobreak ^>nul
    echo start "Frontend" cmd /k "npm run dev"
    echo.
    echo echo Both services started in separate windows.
    echo echo Close this window when done.
    echo pause
) > start-all.bat

echo [SUCCESS] Startup scripts created

REM Final instructions
echo.
echo 🎉 Setup completed successfully!
echo.
echo 📋 Next steps:
echo 1. Update .env file with your Binance API credentials
echo 2. Import database schema using DBeaver ^(see INSTALLATION_GUIDE.md^)
echo 3. Start the application:
echo    start-all.bat
echo.
echo 📚 For detailed instructions, see INSTALLATION_GUIDE.md
echo.
echo 🔧 Available commands:
echo    start-backend.bat  - Start backend only
echo    start-frontend.bat - Start frontend only
echo    start-all.bat      - Start both backend and frontend
echo.
echo ⚠️  Remember to:
echo    - Use testnet for testing
echo    - Never commit API keys to git
echo    - Test thoroughly before live trading
echo.
echo [SUCCESS] Happy trading! 🚀
pause
