#!/bin/bash

# Add delegation methods to AutoScannerService.jsx
FILE="src/components/services/AutoScannerService.jsx"

echo "🔄 Adding delegation methods..."

# Find the line number where we should insert the delegation methods (before the export)
EXPORT_LINE=$(grep -n "export default AutoScannerService" "$FILE" | cut -d: -f1)

if [ -z "$EXPORT_LINE" ]; then
    echo "❌ Could not find export statement"
    exit 1
fi

echo "📍 Found export at line $EXPORT_LINE"

# Create a temporary file with the delegation methods
cat > /tmp/delegation_methods.js << 'EOF'

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

# Insert the delegation methods before the export statement
head -n $((EXPORT_LINE - 1)) "$FILE" > /tmp/before_export.js
tail -n +$EXPORT_LINE "$FILE" > /tmp/after_export.js

# Combine the files
cat /tmp/before_export.js /tmp/delegation_methods.js /tmp/after_export.js > "$FILE"

# Clean up temporary files
rm /tmp/delegation_methods.js /tmp/before_export.js /tmp/after_export.js

echo "✅ Delegation methods added successfully"

# Check file size
echo "📊 New file size:"
wc -l "$FILE"
