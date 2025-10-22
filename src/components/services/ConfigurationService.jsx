import { queueEntityCall } from "@/components/utils/apiQueue";

export default class ConfigurationService {
  constructor(scanner) {
    this.scanner = scanner;
  }

  async loadConfiguration() {
    const s = this.scanner;
    s.addLog("[Config] Loading scanner configuration...", "info");

    const settingsList = await queueEntityCall("ScanSettings", "list");
    let settings = settingsList?.[0];

    if (!settings) {
      // Sensible defaults aligned with existing app expectations
      const defaults = {
        scanFrequency: 60000,
        minimumCombinedStrength: 225,
        minimumRegimeConfidence: 60,
        minimumTradeValue: 10,
        maxPositions: 10,
        riskPerTrade: 2,
        portfolioHeatMax: 20,
        defaultPositionSize: 100,
        useWinStrategySize: true,
        signalMatchingMode: "conviction_based",
        maxBalancePercentRisk: 100, // NEW: Default to 100% (no restriction)
        local_proxy_url: "http://localhost:3003",
        isLiveTradingEnabled: false, // NEW: Default to testnet mode
        isTestnetTradingEnabled: true // NEW: Default to testnet mode
      };
      settings = await queueEntityCall("ScanSettings", "create", defaults);
      s.addLog("[Config] Created default ScanSettings record with maxBalancePercentRisk=100%", "system");
    } else {
      // Ensure new fields exist with defaults
      if (typeof settings.maxBalancePercentRisk !== 'number') {
        settings.maxBalancePercentRisk = 100;
        s.addLog("[Config] Initialized maxBalancePercentRisk to 100% for existing settings", "system");
      }
      if (!settings.local_proxy_url) {
        settings.local_proxy_url = "http://localhost:3003";
      }
      if (typeof settings.isLiveTradingEnabled !== 'boolean') {
        settings.isLiveTradingEnabled = false;
        s.addLog("[Config] Initialized isLiveTradingEnabled to false for existing settings", "system");
      }
      if (typeof settings.isTestnetTradingEnabled !== 'boolean') {
        settings.isTestnetTradingEnabled = true;
        s.addLog("[Config] Initialized isTestnetTradingEnabled to true for existing settings", "system");
      }
    }

    s.state.settings = settings;
    s.addLog(`[Config] Configuration loaded. Max Balance Risk: ${settings.maxBalancePercentRisk}%`, "info");
    return settings;
  }

  async updateSettings(newSettings) {
    const s = this.scanner;
    const old = { ...(s.state?.settings || {}) };

    s.addLog("[Config] Updating scanner settings...", "system", newSettings);

    let savedRecord;
    const list = await queueEntityCall("ScanSettings", "list");
    if (list?.length) {
      savedRecord = await queueEntityCall("ScanSettings", "update", list[0].id, newSettings);
    } else {
      savedRecord = await queueEntityCall("ScanSettings", "create", newSettings);
    }

    // Merge and store locally
    s.state.settings = { ...old, ...(savedRecord || newSettings) };

    // Log significant changes
    if (newSettings.minimumCombinedStrength !== undefined &&
        newSettings.minimumCombinedStrength !== old.minimumCombinedStrength) {
      s.addLog(
        `[Config] Minimum combined strength changed to ${newSettings.minimumCombinedStrength}.`,
        "system"
      );
      
      // Refresh strategies if this impacts strategy eligibility
      if (typeof s.refreshStrategies === "function") {
        s.addLog("[Config] Refreshing strategies due to strength threshold change...", "system");
        await s.refreshStrategies();
      }
    }

    if (newSettings.minimumRegimeConfidence !== undefined &&
        newSettings.minimumRegimeConfidence !== old.minimumRegimeConfidence) {
      s.addLog(
        `[Config] Minimum regime confidence threshold changed to ${newSettings.minimumRegimeConfidence}%.`,
        "system"
      );
    }

    if (newSettings.minimumTradeValue !== undefined &&
        newSettings.minimumTradeValue !== old.minimumTradeValue) {
      s.addLog(`[Config] Minimum trade value changed to ${newSettings.minimumTradeValue} USDT.`, "system");
    }

    if (newSettings.maxPositions !== undefined &&
        newSettings.maxPositions !== old.maxPositions) {
      s.addLog(`[Config] Max positions per strategy changed to ${newSettings.maxPositions}.`, "system");
    }

    // NEW: Log maxBalancePercentRisk changes
    if (newSettings.maxBalancePercentRisk !== undefined &&
        newSettings.maxBalancePercentRisk !== old.maxBalancePercentRisk) {
      s.addLog(
        `[Config] 💰 Max Balance Percent Risk changed from ${old.maxBalancePercentRisk}% to ${newSettings.maxBalancePercentRisk}%. This will limit available balance for trading operations.`,
        "system"
      );
    }

    s.addLog("[Config] Scanner settings updated successfully.", "success");
    s.notifySubscribers?.();

    return s.state.settings;
  }
}