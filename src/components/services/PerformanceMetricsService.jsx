import { queueEntityCall } from "@/components/utils/apiQueue";

export default class PerformanceMetricsService {
  constructor(scanner) {
    this.scanner = scanner;
    
    // Move momentum calculation timing from AutoScannerService
    this.lastMomentumCalculation = 0;
    this.momentumCalculationInterval = 30000;
    
    // Move trades for momentum tracking
    this._recentTradesForMomentum = [];
    this.maxMomentumTrades = 100;
  }

  async loadInitialMomentumTrades() {
    try {
      const initialTrades = await queueEntityCall('Trade', 'filter', {}, '-exit_timestamp', this.maxMomentumTrades);
      this._recentTradesForMomentum = initialTrades || [];
      
      // Keep scanner state in sync for UI
      this.scanner.state.recentTradesForMomentum = [...this._recentTradesForMomentum];
      
      this.scanner.addLog(`[Performance Momentum] ✅ Loaded ${this._recentTradesForMomentum.length} initial trades.`, 'success');
    } catch (e) {
      this.scanner.addLog(`[Performance Momentum] ⚠️ Could not load initial trades: ${e.message}`, 'warning');
      this._recentTradesForMomentum = [];
      this.scanner.state.recentTradesForMomentum = [];
    }
  }

  async calculatePerformanceMomentum() {
    const now = Date.now();

    if (now - this.lastMomentumCalculation < this.momentumCalculationInterval) {
      return;
    }
    this.lastMomentumCalculation = now;

    // Fear & Greed Index is managed by the main scanner service
    // No need to fetch it here as it's already being fetched in background operations

    try {
      const unrealizedWeight = 0.30;
      const realizedWeight = 0.20;
      const regimeWeight = 0.15;
      const volatilityWeight = 0.10;
      const opportunityRateWeight = 0.10;
      const fearAndGreedWeight = 0.10;
      const signalQualityWeight = 0.05;

      let unrealizedComponent = 50;
      const activeWalletState = this.scanner.walletManagerService?.getCurrentWalletState();
      const openPositions = activeWalletState?.positions || [];
      if (openPositions.length > 0) {
        let totalUnrealizedPnlUSDT = 0;
        let totalInvestedCapital = 0;
        let positionsWithPrice = 0;

        for (const pos of openPositions) {
          const symbolNoSlash = (pos.symbol || '').replace('/', '');
          const currentPrice = this.scanner.currentPrices?.[symbolNoSlash];
          if (currentPrice && typeof currentPrice === 'number' && currentPrice > 0) {
            const unrealizedPnlUSDT = pos.direction === 'long'
              ? (currentPrice - pos.entry_price) * pos.quantity_crypto
              : (pos.entry_price - currentPrice) * pos.quantity_crypto;

            totalUnrealizedPnlUSDT += unrealizedPnlUSDT;
            totalInvestedCapital += pos.entry_value_usdt;
            positionsWithPrice++;
          }
        }

        if (positionsWithPrice > 0 && totalInvestedCapital > 0) {
          const portfolioPnlPercent = (totalUnrealizedPnlUSDT / totalInvestedCapital) * 100;
          unrealizedComponent = Math.max(0, Math.min(100, 50 + (portfolioPnlPercent * 10.0)));
        }
      }

      const recentTrades = this._recentTradesForMomentum;
      let realizedComponent = 50;
      if (recentTrades.length >= 5) {
        const pnlValues = recentTrades.map(t => t.pnl_percentage || 0);
        const avgPnl = pnlValues.reduce((s, a) => s + a, 0) / pnlValues.length;
        const winningTradesCount = pnlValues.filter(p => p > 0).length;
        const winRate = (winningTradesCount / pnlValues.length) * 100;

        const pnlScore = 50 + (avgPnl * 8.0);
        const winRateBonus = (winRate - 50) * 0.3;
        realizedComponent = Math.max(0, Math.min(100, pnlScore + winRateBonus));
      }

      const marketRegime = this.scanner.state.marketRegime?.regime;
      const regimeConfidence = (this.scanner.state.marketRegime?.confidence || 0) * 100;
      let baseScore = 50;
      if (marketRegime) {
        switch (marketRegime.toLowerCase()) {
          case 'uptrend':
            baseScore = 75;
            break;
          case 'downtrend':
            baseScore = 25;
            break;
          case 'ranging':
            baseScore = 50;
            break;
          default:
            baseScore = 50;
        }
      }
      const regimeComponent = 50 + ((baseScore - 50) * (regimeConfidence / 100));

      const { adx = 25, bbw = 0.1 } = this.scanner.state.marketVolatility;
      let volatilityComponent = 50;
      if (adx !== undefined && bbw !== undefined) {
        let adxScore;
        if (adx < 20) adxScore = (adx / 20) * 50;
        else if (adx >= 20 && adx <= 40) adxScore = 50 + ((adx - 20) / 20) * 50;
        else adxScore = 100 - ((adx - 40) / 60) * 50;
        adxScore = Math.max(0, Math.min(100, adxScore));

        let bbwScore = Math.min(100, (bbw / 0.05) * 50);
        bbwScore = Math.max(0, Math.min(100, bbwScore));

        volatilityComponent = (adxScore * 0.4) + (bbwScore * 0.6);
      }

      let opportunityRateComponent = 50;
      const history = this.scanner.state.signalGenerationHistory;
      if (history.length > 5) {
        const recentSlice = history.slice(-5);
        const totalRecentSignals = recentSlice.reduce((sum, s) => sum + (s.signalsFound || 0), 0);
        const avgRecentSignals = totalRecentSignals / recentSlice.length;

        opportunityRateComponent = Math.min(100, avgRecentSignals * 5);
      } else if (history.length > 0) {
        opportunityRateComponent = Math.min(100, history[history.length - 1].signalsFound * 5);
      }

      let fearAndGreedComponent = 50;
      if (this.scanner.fearAndGreedData?.value) {
        const fngValue = parseInt(this.scanner.fearAndGreedData.value);
        fearAndGreedComponent = 100 - fngValue;
      }

      const avgStrength = this.scanner.state.stats?.averageSignalStrength || 0;
      let signalQualityComponent = avgStrength > 0 ? Math.min(100, (avgStrength / 3.5)) : 50;

      const finalScore = (unrealizedComponent * unrealizedWeight) +
        (realizedComponent * realizedWeight) +
        (regimeComponent * regimeWeight) +
        (volatilityComponent * volatilityWeight) +
        (opportunityRateComponent * opportunityRateWeight) +
        (fearAndGreedComponent * fearAndGreedWeight) +
        (signalQualityComponent * signalQualityWeight);

      const clampedScore = Math.round(Math.max(0, Math.min(100, finalScore)));

      const breakdown = {
        unrealized: { score: Math.round(unrealizedComponent), weight: unrealizedWeight },
        realized: { score: Math.round(realizedComponent), weight: realizedWeight },
        regime: { score: Math.round(regimeComponent), weight: regimeWeight, details: `${marketRegime || 'N/A'} (${regimeConfidence.toFixed(0)}%)` },
        volatility: { score: Math.round(volatilityComponent), weight: volatilityWeight, details: `ADX: ${adx.toFixed(1)}, BBW: ${bbw.toFixed(3)}` },
        opportunityRate: { score: Math.round(opportunityRateComponent), weight: opportunityRateWeight, details: `${history.slice(-1)[0]?.signalsFound || 0} recent signals` },
        fearAndGreed: { score: Math.round(fearAndGreedComponent), weight: fearAndGreedWeight, details: `${this.scanner.fearAndGreedData?.value || 'N/A'} (${this.scanner.fearAndGreedData?.value_classification || 'N/A'})` },
        signalQuality: { score: Math.round(signalQualityComponent), weight: signalQualityWeight, details: `${avgStrength.toFixed(0)} avg strength` },
        finalScore: clampedScore,
      };

      // Update scanner state for UI widgets
      this.scanner.state.momentumBreakdown = breakdown;
      this.scanner.state.performanceMomentumScore = clampedScore;

      this.scanner.addLog(`[PERFORMANCE_MOMENTUM] Leading momentum updated: ${clampedScore} (U:${unrealizedComponent.toFixed(0)} R:${realizedComponent.toFixed(0)} M:${regimeComponent.toFixed(0)} V:${volatilityComponent.toFixed(0)} O:${opportunityRateComponent.toFixed(0)} F&G:${fearAndGreedComponent.toFixed(0)} S:${signalQualityComponent.toFixed(0)})`, 'success');

    } catch (error) {
      this.scanner.addLog(`[PERFORMANCE_MOMENTUM] Error calculating leading momentum: ${error.message}`, 'error', error);
      this.scanner.state.performanceMomentumScore = null;
      this.scanner.state.momentumBreakdown = null;
    }
  }

  updateRecentTrades(newTrades) {
    if (Array.isArray(newTrades)) {
      this._recentTradesForMomentum = newTrades.slice(0, this.maxMomentumTrades);
      this.scanner.state.recentTradesForMomentum = [...this._recentTradesForMomentum];
    }
  }

  addRecentTrade(trade) {
    this._recentTradesForMomentum.unshift(trade);
    if (this._recentTradesForMomentum.length > this.maxMomentumTrades) {
      this._recentTradesForMomentum = this._recentTradesForMomentum.slice(0, this.maxMomentumTrades);
    }
    this.scanner.state.recentTradesForMomentum = [...this._recentTradesForMomentum];
  }
}