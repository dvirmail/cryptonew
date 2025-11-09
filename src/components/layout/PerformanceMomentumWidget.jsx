
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { useWallet } from '@/components/providers/WalletProvider';
import { formatUSDT } from '@/components/utils/priceFormatter';

// Add helpers at top-level (kept internal to the widget)
// REDESIGNED: 50 is the neutral point where LPM has no impact on conviction
const NEUTRAL_LPM_SCORE = 50; // LPM = 50 means no impact on conviction
const LPM_ADJUSTMENT_FACTOR = 0.5; // Each point deviation from 50 affects conviction by 0.5

function computeDynamicConvictionThreshold(baseMin = 0, momentum) {
  const base = Number(baseMin ?? 0);
  const m = Number(momentum);

  // If base minimum conviction is not a finite number, default to 0
  if (!Number.isFinite(base)) return 0;
  // If momentum is not a finite number, return the base (clamped) as no adjustment can be made
  if (!Number.isFinite(m)) return Math.min(100, Math.max(0, base));

  // NEW LOGIC: 50 is neutral, deviation from 50 affects conviction
  const deviation = m - NEUTRAL_LPM_SCORE; // Range: -50 to +50
  const adjustment = deviation * LPM_ADJUSTMENT_FACTOR; // Range: -25 to +25
  const dynamic = base - adjustment; // Higher LPM = lower conviction needed
  
  // CRITICAL FIX: Clamp between 0 and 100 (allows going below base when LPM is high)
  // When LPM > 50: dynamic can be BELOW base (more aggressive)
  // When LPM < 50: dynamic will be ABOVE base (more conservative)
  return Math.min(100, Math.max(0, dynamic));
}

// Simple BreakdownRow component without complex tooltips
const BreakdownRow = ({ label, score, weight, details, tooltip }) => {
  const getBarColor = (score) => {
    if (score === null || isNaN(score)) return '#6b7280'; // gray-500
    if (score > 70) return '#10b981'; // emerald-500
    if (score > 50) return '#f59e0b'; // amber-500
    return '#ef4444'; // red-500
  };

  return (
    <div className="flex justify-between items-center py-2 hover:bg-gray-50 rounded px-2" title={tooltip}>
      <div className="flex-1">
        <div className="font-medium text-gray-900 text-sm">{label}</div>
        {details && <div className="text-xs text-gray-500 mt-1">{details}</div>}
      </div>
      <div className="flex items-center space-x-3 ml-4">
        <div className="w-20 h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${score != null && !isNaN(score) ? Math.max(0, Math.min(100, score)) : 0}%`,
              backgroundColor: getBarColor(score)
            }}
          />
        </div>
        <div className="text-right min-w-[60px]">
          <div className="font-bold text-gray-900">{score != null && !isNaN(score) ? Math.round(score) : '--'}</div>
          <div className="text-xs text-gray-500">({Math.round((weight || 0) * 100)}%)</div>
        </div>
      </div>
    </div>
  );
};

// Component accepts baseMinimumConviction as a prop
const PerformanceMomentumWidget = ({ baseMinimumConviction = 0 }) => {
  const [score, setScore] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const { walletSummary, totalEquity } = useWallet();
  const unrealizedValue = Number(walletSummary?.unrealizedPnl ?? 0);
  const unrealizedPct = Number(totalEquity) ? (unrealizedValue / Number(totalEquity)) * 100 : 0;

  useEffect(() => {
    const scannerService = getAutoScannerService();

    const handleUpdate = (state) => {
      setScore(state.performanceMomentumScore);
      setBreakdown(state.momentumBreakdown);
    };

    const unsubscribe = scannerService.subscribe(handleUpdate);
    handleUpdate(scannerService.getState()); // Get initial value

    return unsubscribe;
  }, []);

  // NEW: compute the dynamic threshold for display only (no behavior change here)
  const dynamicMinConviction = computeDynamicConvictionThreshold(
    baseMinimumConviction,
    score // Use the component's internal state 'score' for momentum
  );

  if (score === null || !breakdown) {
    return (
      <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm cursor-wait">
        <Sparkles className="h-5 w-5 text-gray-400 animate-pulse" />
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  const getMomentumNarrative = (currentScore) => {
    if (currentScore === null || isNaN(currentScore)) return "Awaiting Data...";
    if (currentScore > 80) return "Very Strong Momentum";
    if (currentScore > 65) return "Strong Momentum";
    if (currentScore > 55) return "Positive Momentum";
    if (currentScore > 45) return "Neutral Momentum";
    if (currentScore > 35) return "Negative Momentum";
    if (currentScore > 20) return "Strong Negative Momentum";
    return "Very Strong Negative Momentum";
  };

  const narrative = getMomentumNarrative(score);
  // NEW: robust level positioning values
  const clamped = score != null && !isNaN(score) ? Math.max(0, Math.min(100, Number(score))) : 0;
  const indicatorTop = 100 - clamped; // percentage from top for absolute positioning

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Rebuilt compact widget header */}
      <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-shadow">
        <Sparkles className="h-5 w-5 text-purple-500 animate-pulse" />

        <div className="flex flex-col items-center w-8">
          {/* REBUILT: Full-height gradient track (no gray overlay), plus precise level arrow */}
          <div className="relative">
            <div
              className="relative w-2 h-16 rounded-full overflow-hidden ring-1 ring-black/5 dark:ring-white/10"
              style={{
                // Full gradient visible from bottom (red) to top (bright green)
                background: 'linear-gradient(to top, #ef4444 0%, #f97316 35%, #facc15 55%, #22c55e 100%)'
              }}
            />

            {/* LEVEL ARROW: move to LEFT of bar, pointing right */}
            <div
              className="absolute right-full mr-1 pointer-events-none"
              style={{
                top: `${indicatorTop}%`,
                transform: 'translateY(-50%)'
              }}
            >
              <div className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-emerald-500" />
            </div>
          </div>

          <span className="text-xs font-bold mt-1 text-gray-700 dark:text-gray-300">
            {score != null && !isNaN(score) ? Math.round(score) : '--'}
          </span>
        </div>
      </div>

      {/* Tooltip - positioned to appear below header (kept minimal) */}
      {showTooltip && (
        <div
          className="absolute top-full right-0 mt-2 z-50"
          style={{ position: 'fixed', top: '120px', right: '20px' }}
        >
          <div className="bg-white text-gray-900 p-4 text-sm rounded-lg shadow-xl border border-gray-200 w-96 max-h-[80vh] overflow-y-auto">
            <div className="border-b border-gray-200 pb-3 mb-4">
              <div className="font-bold text-lg text-gray-900 mb-2">Leading Performance Momentum</div>
              <p className="text-sm text-gray-600 leading-relaxed">
                A real-time score (0-100) reflecting the current health and potential of your trading system.
                Combines past results with live market data for a forward-looking view.
              </p>
            </div>

            <div className="space-y-1">
              {breakdown.unrealized && (
                <>
                  <BreakdownRow
                    label="Unrealized P&L"
                    score={breakdown.unrealized.score}
                    weight={breakdown.unrealized.weight}
                    tooltip="Live P&L of all open positions. Higher scores indicate profitable open trades. 30% weight."
                  />
                  {/* Enhanced: show actual Unrealized P&L value and percent below the score */}
                  <div className="mt-1 ml-4 text-[10px] sm:text-xs text-gray-600 dark:text-gray-300">
                    {breakdown.unrealized.details || `${formatUSDT(unrealizedValue)} (${isFinite(unrealizedPct) ? unrealizedPct.toFixed(1) : '0.0'}%)`}
                  </div>
                </>
              )}
              {breakdown.realized && (
                <>
                  <BreakdownRow
                    label="Realized P&L"
                    score={breakdown.realized.score}
                    weight={breakdown.realized.weight}
                    tooltip="Performance of last 100 closed trades with recency weighting. Higher scores indicate recent profitable trades. DOMINANT FACTOR - 40% weight."
                  />
                  {/* Enhanced: show actual Realized P&L details below the score */}
                  <div className="mt-1 ml-4 text-[10px] sm:text-xs text-gray-600 dark:text-gray-300">
                    {breakdown.realized.details || 'No recent trades'}
                  </div>
                </>
              )}
              {/* Market Regime removed - it's context, not performance momentum */}
              {breakdown.volatility && (
                <BreakdownRow
                  label="Market Volatility"
                  score={breakdown.volatility.score}
                  weight={breakdown.volatility.weight}
                  details={breakdown.volatility.details}
                  tooltip="Trend strength measured by ADX and Bollinger Band Width. Higher scores indicate stronger, less choppy trends. 10% weight."
                />
              )}
              {/* Opportunity Rate removed - strategy count is not a performance metric */}
              {breakdown.fearAndGreed && (
                <BreakdownRow
                  label="Fear & Greed Index"
                  score={breakdown.fearAndGreed.score}
                  weight={breakdown.fearAndGreed.weight}
                  details={breakdown.fearAndGreed.details}
                  tooltip="Contrarian sentiment indicator. 'Extreme Fear' boosts score (good buying opportunity), 'Extreme Greed' lowers it. 10% weight."
                />
              )}
              {breakdown.signalQuality && (
                <BreakdownRow
                  label="Signal Quality"
                  score={breakdown.signalQuality.score}
                  weight={breakdown.signalQuality.weight}
                  details={breakdown.signalQuality.details}
                  tooltip="Average strength of all active strategies. Higher scores indicate strategies are finding stronger signals. 10% weight."
                />
              )}
            </div>

            {/* Inject just below the existing Final Score section */}
            <div className="mt-3">
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg text-gray-900">Final Score</span>
                  <span className="font-bold text-2xl text-gray-900">{score != null && !isNaN(score) ? Math.round(score) : '--'} / 100</span>
                </div>
                <div className="text-center">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                    score > 65 ? 'bg-green-100 text-green-800' :
                    score > 45 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {narrative}
                  </span>
                </div>
              </div>
              {/* NEW: Dynamic minimum conviction line (concise, below final score) */}
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Dynamic Minimum Conviction: 
                <span className="ml-1 font-medium text-gray-700 dark:text-gray-200">
                  {Math.round(dynamicMinConviction)}
                </span>
                {typeof baseMinimumConviction === 'number' && Number.isFinite(baseMinimumConviction) && (
                  <span className="ml-2">
                    (base {Math.round(baseMinimumConviction)}, momentum {Math.round(Number(score || 0))})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PerformanceMomentumWidget;
