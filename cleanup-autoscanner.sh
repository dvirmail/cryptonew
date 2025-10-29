#!/bin/bash

# AutoScannerService Cleanup Script
# This script removes extracted methods and updates calls to use services

echo "🧹 Starting AutoScannerService cleanup..."

# File path
FILE="src/components/services/AutoScannerService.jsx"

# Create backup
cp "$FILE" "$FILE.backup.$(date +%s)"

echo "📋 Backup created"

# Remove methods that should be delegated to services
echo "🗑️ Removing extracted methods..."

# Remove wallet-related methods (delegate to walletStateService)
sed -i '' '/async reinitializeWalletFromBinance() {/,/^    }$/d' "$FILE"
sed -i '' '/_getAvailableUsdt() {/,/^    }$/d' "$FILE"
sed -i '' '/_getBalanceAllocatedInTrades() {/,/^    }$/d' "$FILE"
sed -i '' '/async resetWalletAndRestart() {/,/^    }$/d' "$FILE"
sed -i '' '/async _persistLatestWalletSummary() {/,/^    }$/d' "$FILE"
sed -i '' '/getWalletStateHistory() {/,/^    }$/d' "$FILE"

# Remove UI state methods (delegate to uiStateService)
sed -i '' '/notifySubscribers() {/,/^    }$/d' "$FILE"
sed -i '' '/registerToastNotifier(toastFunction) {/,/^    }$/d' "$FILE"
sed -i '' '/_saveStateToStorage() {/,/^    }$/d' "$FILE"
sed -i '' '/_loadStateFromStorage() {/,/^    }$/d' "$FILE"
sed -i '' '/clearLogs() {/,/^    }$/d' "$FILE"
sed -i '' '/forceResetState() {/,/^    }$/d' "$FILE"
sed -i '' '/_initializeWidgetDefaults() {/,/^    }$/d' "$FILE"
sed -i '' '/getState() {/,/^    }$/d' "$FILE"

# Remove lifecycle methods (delegate to lifecycleService)
sed -i '' '/async initialize() {/,/^    }$/d' "$FILE"
sed -i '' '/async start() {/,/^    }$/d' "$FILE"
sed -i '' '/async stop() {/,/^    }$/d' "$FILE"
sed -i '' '/forceStop() {/,/^    }$/d' "$FILE"
sed -i '' '/restart() {/,/^    }$/d' "$FILE"
sed -i '' '/_startScanLoop() {/,/^    }$/d' "$FILE"
sed -i '' '/_startCountdown() {/,/^    }$/d' "$FILE"
sed -i '' '/async _loadExchangeInfo() {/,/^    }$/d' "$FILE"
sed -i '' '/getExchangeInfo() {/,/^    }$/d' "$FILE"

# Remove utility methods (delegate to utilityService)
sed -i '' '/getTradingMode() {/,/^    }$/d' "$FILE"
sed -i '' '/isLiveMode() {/,/^    }$/d' "$FILE"
sed -i '' '/isTestnetMode() {/,/^    }$/d' "$FILE"
sed -i '' '/_startRunningState() {/,/^    }$/d' "$FILE"
sed -i '' '/_stopRunningState(options = {}) {/,/^    }$/d' "$FILE"
sed -i '' '/async _sendTelegramNotification(type, data) {/,/^    }$/d' "$FILE"
sed -i '' '/_isTradingBlockedByRegime() {/,/^    }$/d' "$FILE"

# Remove market regime methods (delegate to marketRegimeService)
sed -i '' '/_isRegimeCacheValid() {/,/^    }$/d' "$FILE"
sed -i '' '/async _getCachedOrCalculateRegime(forceCalculate = false) {/,/^    }$/d' "$FILE"
sed -i '' '/async _detectMarketRegime() {/,/^    }$/d' "$FILE"
sed -i '' '/async _fetchFearAndGreedIndex() {/,/^    }$/d' "$FILE"
sed -i '' '/async _updateMarketRegime() {/,/^    }$/d' "$FILE"

# Remove price management methods (delegate to priceManagerService)
sed -i '' '/async _consolidatePrices() {/,/^    }$/d' "$FILE"
sed -i '' '/_updateCurrentPrices(pricesData) {/,/^    }$/d' "$FILE"

# Remove scan engine methods (delegate to scanEngineService)
sed -i '' '/async _loadStrategies() {/,/^    }$/d' "$FILE"
sed -i '' '/async _monitorPositions(cycleStats) {/,/^    }$/d' "$FILE"
sed -i '' '/async _evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {/,/^    }$/d' "$FILE"
sed -i '' '/async _logCycleSummary(cycleStats) {/,/^    }$/d' "$FILE"
sed -i '' '/_logWalletSummary() {/,/^    }$/d' "$FILE"

# Remove configuration methods (delegate to configurationService)
sed -i '' '/async updateSettings(newSettings) {/,/^    }$/d' "$FILE"
sed -i '' '/async refreshStrategies() {/,/^    }$/d' "$FILE"

# Remove deprecated methods
sed -i '' '/async _openPosition(combination, currentPrice, convictionScore, convictionDetails, cycleStats) {/,/^    }$/d' "$FILE"
sed -i '' '/monitorAndClosePositions() {/,/^    }$/d' "$FILE"
sed -i '' '/_updateTrailingStops(prices) {/,/^    }$/d' "$FILE"
sed -i '' '/async _archiveOldTradesIfNeeded() {/,/^    }$/d' "$FILE"
sed -i '' '/async _updatePerformanceSnapshotIfNeeded(cycleStats) {/,/^    }$/d' "$FILE"

echo "✅ Methods removed"

# Add delegation methods
echo "🔄 Adding delegation methods..."

# Add delegation methods after the existing methods
cat >> "$FILE" << 'EOF'

    // ===== DELEGATION METHODS =====
    // These methods delegate to the appropriate services

    // Wallet State Service Delegations
    async reinitializeWalletFromBinance() {
        return this.walletStateService.reinitializeWalletFromBinance();
    }

    _getAvailableUsdt() {
        return this.walletStateService._getAvailableUsdt();
    }

    _getBalanceAllocatedInTrades() {
        return this.walletStateService._getBalanceAllocatedInTrades();
    }

    async resetWalletAndRestart() {
        return this.walletStateService.resetWalletAndRestart();
    }

    async _persistLatestWalletSummary() {
        return this.walletStateService._persistLatestWalletSummary();
    }

    getWalletStateHistory() {
        return this.walletStateService.getWalletStateHistory();
    }

    // UI State Service Delegations
    notifySubscribers() {
        return this.uiStateService.notifySubscribers();
    }

    registerToastNotifier(toastFunction) {
        return this.uiStateService.registerToastNotifier(toastFunction);
    }

    _saveStateToStorage() {
        return this.uiStateService._saveStateToStorage();
    }

    _loadStateFromStorage() {
        return this.uiStateService._loadStateFromStorage();
    }

    clearLogs() {
        return this.uiStateService.clearLogs();
    }

    forceResetState() {
        return this.uiStateService.forceResetState();
    }

    _initializeWidgetDefaults() {
        return this.uiStateService._initializeWidgetDefaults();
    }

    getState() {
        return this.uiStateService.getState();
    }

    // Lifecycle Service Delegations
    async initialize() {
        return this.lifecycleService.initialize();
    }

    async start() {
        return this.lifecycleService.start();
    }

    async stop() {
        return this.lifecycleService.stop();
    }

    forceStop() {
        return this.lifecycleService.forceStop();
    }

    restart() {
        return this.lifecycleService.restart();
    }

    _startScanLoop() {
        return this.lifecycleService._startScanLoop();
    }

    _startCountdown() {
        return this.lifecycleService._startCountdown();
    }

    async _loadExchangeInfo() {
        return this.lifecycleService._loadExchangeInfo();
    }

    getExchangeInfo() {
        return this.lifecycleService.getExchangeInfo();
    }

    // Utility Service Delegations
    getTradingMode() {
        return this.utilityService.getTradingMode();
    }

    isLiveMode() {
        return this.utilityService.isLiveMode();
    }

    isTestnetMode() {
        return this.utilityService.isTestnetMode();
    }

    _startRunningState() {
        return this.utilityService._startRunningState();
    }

    _stopRunningState(options = {}) {
        return this.utilityService._stopRunningState(options);
    }

    async _sendTelegramNotification(type, data) {
        return this.utilityService._sendTelegramNotification(type, data);
    }

    _isTradingBlockedByRegime() {
        return this.utilityService._isTradingBlockedByRegime();
    }

    // Market Regime Service Delegations
    _isRegimeCacheValid() {
        return this.marketRegimeService._isRegimeCacheValid();
    }

    async _getCachedOrCalculateRegime(forceCalculate = false) {
        return this.marketRegimeService._getCachedOrCalculateRegime(forceCalculate);
    }

    async _detectMarketRegime() {
        return this.marketRegimeService._detectMarketRegime();
    }

    async _fetchFearAndGreedIndex() {
        return this.marketRegimeService._fetchFearAndGreedIndex();
    }

    async _updateMarketRegime() {
        return this.marketRegimeService._updateMarketRegime();
    }

    // Price Manager Service Delegations
    async _consolidatePrices() {
        return this.priceManagerService._consolidatePrices();
    }

    _updateCurrentPrices(pricesData) {
        return this.priceManagerService._updateCurrentPrices(pricesData);
    }

    // Scan Engine Service Delegations
    async _loadStrategies() {
        return this.scanEngineService._loadStrategies();
    }

    async _monitorPositions(cycleStats) {
        return this.scanEngineService._monitorPositions(cycleStats);
    }

    async _evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats) {
        return this.scanEngineService._evaluateStrategies(strategies, currentWalletState, settings, marketRegime, currentPrices, cycleStats);
    }

    async _logCycleSummary(cycleStats) {
        return this.scanEngineService._logCycleSummary(cycleStats);
    }

    _logWalletSummary() {
        return this.scanEngineService._logWalletSummary();
    }

    // Configuration Service Delegations
    async updateSettings(newSettings) {
        return this.configurationService.updateSettings(newSettings);
    }

    async refreshStrategies() {
        return this.strategyManager.refreshStrategies();
    }

EOF

echo "✅ Delegation methods added"

# Clean up any duplicate method definitions
echo "🧽 Cleaning up duplicates..."

# Remove any remaining duplicate method definitions
sed -i '' '/async reinitializeWalletFromBinance() {/,/^    }$/d' "$FILE"
sed -i '' '/_getAvailableUsdt() {/,/^    }$/d' "$FILE"
sed -i '' '/_getBalanceAllocatedInTrades() {/,/^    }$/d' "$FILE"

echo "✅ Cleanup complete!"

# Check file size
echo "📊 Final file size:"
wc -l "$FILE"

echo "🎉 AutoScannerService cleanup completed!"
