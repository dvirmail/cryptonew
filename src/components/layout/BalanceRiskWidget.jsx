import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Shield } from 'lucide-react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';

export default function BalanceRiskWidget({ scannerState: propScannerState }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [scannerState, setScannerState] = useState(propScannerState || null);

  // Subscribe directly to scanner service for real-time updates
  // Updates occur when notifySubscribers() is called after each scan cycle completes
  useEffect(() => {
    const scannerService = getAutoScannerService();
    
    // Get initial state
    const initialState = scannerService.getState();
    setScannerState(initialState);

    // Subscribe to updates - force re-render by creating new object reference
    // This is called after each scan cycle completes (via notifySubscribers())
    const unsubscribe = scannerService.subscribe((state) => {
      // Force React to detect the change by creating a new object reference
      setScannerState({ ...state });
    });

    return () => {
      unsubscribe();
    };
  }, []); // Empty deps - subscribe once on mount

  const adjustedRiskFactor = scannerState?.adjustedBalanceRiskFactor ?? 100;
  // maxBalancePercentRisk is a user-configurable setting (default: 100%)
  // It caps the maximum effective balance risk regardless of momentum score
  // This acts as a safety mechanism to prevent excessive position sizes
  // CRITICAL: Read directly from scanner service to ensure we get the latest value
  const scannerService = getAutoScannerService();
  const currentSettings = scannerService?.getState()?.settings;
  const maxRiskConfig = currentSettings?.maxBalancePercentRisk ?? scannerState?.settings?.maxBalancePercentRisk ?? 100;
  const momentumScore = scannerState?.performanceMomentumScore ?? null;
  
  // Debug: Log if there's a mismatch (only in development)
  if (process.env.NODE_ENV === 'development' && scannerState?.settings?.maxBalancePercentRisk !== currentSettings?.maxBalancePercentRisk) {
    console.log('[BalanceRiskWidget] ⚠️ Settings mismatch detected:', {
      fromState: scannerState?.settings?.maxBalancePercentRisk,
      fromService: currentSettings?.maxBalancePercentRisk,
      using: maxRiskConfig
    });
  }

  const riskData = useMemo(() => {
    let status = 'neutral';
    let icon = Minus;
    let colorClass = 'text-gray-600 dark:text-gray-400';
    let bgClass = 'bg-white dark:bg-gray-800';
    let description = 'Neutral risk level';

    if (adjustedRiskFactor >= 80) {
      status = 'high';
      icon = TrendingUp;
      colorClass = 'text-green-600 dark:text-green-400';
      bgClass = 'bg-white dark:bg-gray-800';
      description = 'High confidence - Full risk allocation';
    } else if (adjustedRiskFactor >= 50) {
      status = 'moderate';
      icon = TrendingUp;
      colorClass = 'text-blue-600 dark:text-blue-400';
      bgClass = 'bg-white dark:bg-gray-800';
      description = 'Moderate confidence - Balanced risk';
    } else if (adjustedRiskFactor >= 30) {
      status = 'low';
      icon = TrendingDown;
      colorClass = 'text-yellow-600 dark:text-yellow-400';
      bgClass = 'bg-white dark:bg-gray-800';
      description = 'Low confidence - Reduced risk';
    } else {
      status = 'minimal';
      icon = Shield;
      colorClass = 'text-red-600 dark:text-red-400';
      bgClass = 'bg-white dark:bg-gray-800';
      description = 'Very low confidence - Minimal risk';
    }

    return { status, icon: icon, colorClass, bgClass, description };
  }, [adjustedRiskFactor]);

  const Icon = riskData.icon;

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}>

        <Card className={`${riskData.bgClass} border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow cursor-pointer`}>
          <CardContent className="px-1 py-1.5">
            <div className="flex items-center space-x-1.5">
              <Icon className={`w-4 h-4 ${riskData.colorClass}`} />
              <div>
                <p className="text-[10px] font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap leading-tight">
                  Effective Balance Risk
                </p>
                <p className={`text-xl font-bold ${riskData.colorClass} leading-tight`}>
                  {adjustedRiskFactor.toFixed(0)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tooltip - rendered outside parent with fixed positioning */}
      {showTooltip && (
        <div 
          className="fixed z-[99999] w-64 bg-white dark:bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-300 dark:border-gray-600 p-4"
          style={{
            top: '120px',
            right: '380px',
            pointerEvents: 'none'
          }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white mb-1">
                {riskData.description}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Position sizes are scaled to{' '}
                <span className="font-semibold">{adjustedRiskFactor.toFixed(0)}%</span> based on market momentum.
              </p>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Dynamic adjustment protects capital during poor conditions and maximizes opportunities during strong trends.
            </p>

            <div className="pt-3 border-t border-gray-200 dark:border-gray-600 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Configured Max:</span>
                <span className="font-medium text-gray-900 dark:text-white">{maxRiskConfig}%</span>
              </div>
              {momentumScore !== null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Momentum Score:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{momentumScore}/100</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Effective Risk:</span>
                <span className={`font-medium ${riskData.colorClass}`}>{adjustedRiskFactor.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}