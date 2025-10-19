
import React, { useState, useEffect } from 'react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const RegimeBlockingIndicator = () => {
  const [isBlocked, setIsBlocked] = useState(false);
  const [confidence, setConfidence] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blockedReason, setBlockedReason] = useState(null); // 'downtrend_config' | 'low_confidence' | null

  // Helper: safely read regime name from various shapes
  const getRegimeName = (regime) => {
    if (!regime || typeof regime !== 'object') return null;
    const candidates = [
      regime.name, regime.regime, regime.phase, regime.trend, regime.state, regime.type
    ];
    const found = candidates.find((v) => typeof v === 'string' && v.length > 0);
    return found ? String(found).toLowerCase() : null;
  };

  useEffect(() => {
    const scannerService = getAutoScannerService();
    const handleUpdate = (state) => {
      if (state.marketRegime && state.settings) {
        const currentConfidence = (state.marketRegime.confidence ?? 0) * 100;
        const currentThreshold = Number(state.settings.minimumRegimeConfidence ?? 60);
        const regimeName = getRegimeName(state.marketRegime);
        const downtrendBlockEnabled = !!state.settings.blockTradingInDowntrend;

        const blockByDowntrend = downtrendBlockEnabled && regimeName === 'downtrend';
        const blockByConfidence = currentConfidence < currentThreshold;

        const finalBlocked = blockByDowntrend || blockByConfidence;
        setIsBlocked(finalBlocked);
        setBlockedReason(blockByDowntrend ? 'downtrend_config' : (blockByConfidence ? 'low_confidence' : null));
        setConfidence(currentConfidence);
        setThreshold(currentThreshold);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
    };

    const unsubscribe = scannerService.subscribe(handleUpdate);
    // Get initial state
    handleUpdate(scannerService.getState());

    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Regime...</span>
            </div>);
  }

  // Updated classes to remove background and padding
  const baseClasses = "flex items-center space-x-1.5 text-sm font-medium transition-colors";
  const activeClasses = "text-green-600 dark:text-green-500";
  const blockedClasses = "text-red-600 dark:text-red-500";

  const tooltipText = isBlocked
    ? (blockedReason === 'downtrend_config'
        ? `Trades are blocked due to your configuration: Downtrend blocking is ON.`
        : `Trades are blocked because regime confidence (${confidence?.toFixed(1)}%) is below your threshold (${threshold}%).`)
    : `Trades are active. Regime confidence (${confidence?.toFixed(1)}%) is above your threshold (${threshold}%).`;

  return (
    <TooltipProvider>
            <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                    <div className={`${baseClasses} ${isBlocked ? blockedClasses : activeClasses}`}>
                        {isBlocked ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                        <span>
                          {isBlocked ? (blockedReason === 'downtrend_config' ? 'Blocked' : 'Blocked') : 'Active'}
                        </span>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p className="max-w-xs">{tooltipText}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>);

};

export default RegimeBlockingIndicator;
