/**
 * UtilityService
 * 
 * Provides utility methods and helper functions for the scanner.
 * This service handles formatting, navigation, trading mode checks, and notifications.
 */

export class UtilityService {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.addLog = scannerService.addLog.bind(scannerService);
        // REMOVED: this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService); // This creates circular reference
        // REMOVED: this.getState = scannerService.getState.bind(scannerService); // This creates circular reference

        // Navigation state
        this.isNavigating = false;
        this.navigationTimeout = null;
    }

    /**
     * Sets up navigation handlers to prevent scanner control changes during navigation.
     */
    _setupNavigationHandlers() {
        const originalPushState = window.history.pushState;
        const originalReplaceState = window.history.replaceState;

        window.history.pushState = (...args) => {
            this._handleNavigationStart();
            return originalPushState.apply(window.history, args);
        };

        window.history.replaceState = (...args) => {
            this._handleNavigationStart();
            return originalReplaceState.apply(window.history, args);
        };

        window.addEventListener('popstate', () => {
            this._handleNavigationStart();
        });

        window.addEventListener('load', () => {
            this._handleNavigationEnd();
        });
    }

    /**
     * Handles navigation start events.
     */
    _handleNavigationStart() {
        this.isNavigating = true;

        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
        }

        console.log(`[AutoScannerService] 🧭 Navigation detected - preventing scanner control changes`);

        this.navigationTimeout = setTimeout(() => {
            this._handleNavigationEnd();
        }, 2000);
    }

    /**
     * Handles navigation end events.
     */
    _handleNavigationEnd() {
        this.isNavigating = false;

        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
            this.navigationTimeout = null;
        }

        console.log(`[AutoScannerService] 🧭 Navigation completed - scanner control restored`);
    }

    /**
     * Sets the auto-start blocked flag.
     * @param {boolean} flag - Whether auto-start is blocked.
     */
    setAutoStartBlocked(flag) {
        this.scannerService._isAutoStartBlocked = flag;
        console.log(`[AutoScannerService] [AutoStart] UI ${this.scannerService._isAutoStartBlocked ? 'blocked' : 'unblocked'} internal auto-start.`);
    }

    /**
     * Gets the current trading mode.
     * @returns {string} Current trading mode ('testnet' or 'live').
     */
    getTradingMode() {
        return this.scannerService.state.tradingMode;
    }

    /**
     * Checks if the scanner is in live mode.
     * @returns {boolean} True if in live mode, false otherwise.
     */
    isLiveMode() {
        return this.scannerService.state.tradingMode === 'live';
    }

    /**
     * Checks if the scanner is in testnet mode.
     * @returns {boolean} True if in testnet mode, false otherwise.
     */
    isTestnetMode() {
        return this.scannerService.state.tradingMode === 'testnet';
    }

    /**
     * Starts the running state of the scanner.
     */
    async _startRunningState() {
        this.scannerService.state.isRunning = true;
        this.scannerService.uiStateService._saveStateToStorage();
        
        console.log('[AutoScannerService] ✅ Auto Scanner now in running state.');

        // Start heartbeat service (25s interval)
        this.scannerService.heartbeatService.start();

        // Start passive monitoring (60s interval)
        this.scannerService.sessionManager.startMonitoring();

        // Fetch Fear & Greed Index immediately when scanner starts
        try {
            // console.log('[UtilityService] [F&G_START] 🔄 Fetching Fear & Greed Index on scanner start...');
            await this.scannerService._fetchFearAndGreedIndex();
            // console.log('[UtilityService] [F&G_START] 🔍 Fear & Greed fetch completed, checking result...');
            const fngData = this.scannerService.state.fearAndGreedData;
            // console.log('[UtilityService] [F&G_START] 🔍 Scanner state F&G data:', fngData);
            if (fngData) {
                // console.log(`[AutoScannerService] [F&G_START] ✅ F&G Index fetched: ${fngData.value} (${fngData.value_classification})`);
            } else {
                // console.warn('[UtilityService] [F&G_START] ⚠️ No F&G data after fetch');
            }
        } catch (error) {
            console.warn('[AutoScannerService] [F&G_START] ⚠️ Fear & Greed fetch failed on start:', error.message);
            // console.error('[UtilityService] [F&G_START] ❌ Fear & Greed fetch error:', error);
        }

        await this.scannerService.lifecycleService._startScanLoop();
        // console.log('[UtilityService] 🔍 _startScanLoop() call completed');
        
        // Countdown scheduling is owned by ScanEngineService after each scan completes.
        // Intentionally not starting countdown here to avoid duplicate timers.
        // console.log('[UtilityService] 🔄 Countdown scheduling delegated to ScanEngineService');
        
        this.scannerService.notifySubscribers();
    }

    /**
     * Stops the running state of the scanner.
     * @param {object} options - Options for stopping.
     */
    _stopRunningState(options = {}) {
        console.log('[AutoScannerService] 🛑 Auto Scanner transitioning to stopped state.');

        this.scannerService.state.isRunning = false;
        this.scannerService.state.isScanning = false;
        this.scannerService.state.nextScanTime = null;

        // Stop countdown timer (both background and main thread)
        if (this.scannerService.lifecycleService && typeof this.scannerService.lifecycleService._stopCountdown === 'function') {
            this.scannerService.lifecycleService._stopCountdown();
        } else {
            // Fallback: Clear countdown interval manually
            if (this.scannerService.lifecycleService && this.scannerService.lifecycleService.countdownInterval) {
                clearInterval(this.scannerService.lifecycleService.countdownInterval);
                clearTimeout(this.scannerService.lifecycleService.countdownInterval);
                this.scannerService.lifecycleService.countdownInterval = null;
            }
        }

        // Stop heartbeat service
        this.scannerService.heartbeatService.stop();

        // Stop passive monitoring
        this.scannerService.sessionManager.stopMonitoring();

        this.scannerService.uiStateService._saveStateToStorage();
        this.scannerService.notifySubscribers();
    }

    /**
     * Sends a Telegram notification.
     * @param {string} type - Type of notification.
     * @param {object} data - Data for the notification.
     */
    async _sendTelegramNotification(type, data) {
        if (!this.scannerService.telegramSettings.token || !this.scannerService.telegramSettings.chat_id) {
            console.warn('[AutoScannerService] Telegram notification skipped: Bot token or chat ID not configured.');
            return;
        }

        let message = '';
        switch (type) {
            case 'TRADE_CLOSED':
                message = `📈 *Trade Closed!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `P&L: ${data.pnl >= 0 ? '✅' : '❌'} $${data.pnl.toFixed(2)} (${data.pnlPercentage.toFixed(2)}%)%0A` +
                    `Exit Reason: ${data.exitReason.replace(/_/g, ' ')}%0A` +
                    `Duration: ${data.duration} mins`;
                break;
            case 'TRADE_OPENED':
                message = `✅ *Trade Opened!* %0A` +
                    `Strategy: ${data.strategy}%0A` +
                    `Symbol: ${data.symbol} (${data.direction})%0A` +
                    `Entry Price: $${data.entry_price.toFixed(4)}%0A` +
                    `Size: $${data.entry_value_usdt.toFixed(2)} USDT%0A` +
                    `Conviction: ${data.conviction_score.toFixed(1)}`;
                break;
            default:
                message = `*AutoScanner Update:* ${JSON.stringify(data)}`;
                break;
        }

        const url = `https://api.telegram.org/bot${this.scannerService.telegramSettings.token}/sendMessage`;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.scannerService.telegramSettings.chat_id,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });
            console.log(`[AutoScannerService] Telegram notification sent successfully.`);
        } catch (error) {
            console.error(`[AutoScannerService] Failed to send Telegram notification: ${error.message}`);
        }
    }

    /**
     * Checks if trading is blocked by market regime.
     * @returns {boolean} True if trading is blocked, false otherwise.
     */
    _isTradingBlockedByRegime() {
        if (!this.scannerService.state.settings?.blockTradingInDowntrend) {
            return false;
        }

        const regime = this.scannerService.state.marketRegime;
        if (!regime) {
            return false;
        }

        const isDowntrend = regime.regime === 'downtrend';
        const confidenceThreshold = this.scannerService.state.settings?.minimumRegimeConfidence || 60;
        const isConfidentEnough = (regime.confidence * 100) >= confidenceThreshold;

        return isDowntrend && isConfidentEnough;
    }

    /**
     * Attaches regime open guard to prevent opening positions during downtrends.
     */
    attachRegimeOpenGuard() {
        if (this.scannerService.positionManager && typeof this.scannerService.positionManager.setRegimeGuard === 'function') {
            this.scannerService.positionManager.setRegimeGuard(() => this._isTradingBlockedByRegime());
            console.log('[AutoScannerService] ✅ Regime open guard attached to PositionManager');
        }
    }

    /**
     * Resets the utility service state.
     */
    resetState() {
        this.isNavigating = false;
        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
            this.navigationTimeout = null;
        }
        this.addLog('[UtilityService] State reset.', 'system');
    }
}

export default UtilityService;
