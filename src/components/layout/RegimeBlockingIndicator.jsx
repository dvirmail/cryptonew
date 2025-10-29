
import React, { useState, useEffect, useRef } from 'react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const RegimeBlockingIndicator = () => {
  const loggedMaxCapDetection = useRef(false);
  const loggedFinalBlockingState = useRef(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [confidence, setConfidence] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blockedReason, setBlockedReason] = useState(null); // 'downtrend_config' | 'low_confidence' | 'max_cap_reached' | 'insufficient_balance' | null
  const [blockedDetails, setBlockedDetails] = useState(null); // Additional details for blocking reasons

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

        // Check regime-based blocking
        const blockByDowntrend = downtrendBlockEnabled && regimeName === 'downtrend';
        const blockByConfidence = currentConfidence < currentThreshold;

        // Check investment cap blocking
        const maxInvestmentCap = Number(state.settings.maxBalanceInvestCapUSDT ?? 0);
        // FIX: Get balance_in_trades from CentralWalletState
        const scannerService = getAutoScannerService();
        const currentWalletState = scannerService?.walletManagerService?.getCurrentWalletState();
        const walletSummary = scannerService?.walletManagerService?.walletSummary;
        
        // Try multiple sources for balance_in_trades
        const currentAllocated = Number(
          currentWalletState?.balance_in_trades ?? 
          walletSummary?.balance_in_trades ?? 
          0
        );
        const blockByMaxCap = maxInvestmentCap > 0 && currentAllocated >= maxInvestmentCap;
        
        // Check if strategy evaluation is blocked from scanner state
        const strategyEvaluationBlocked = state.strategyEvaluationBlocked;
        const blockReason = state.blockReason;
        
        // Debug logging to see what values are being detected (sample only once)
        if (!loggedMaxCapDetection.current) {
          loggedMaxCapDetection.current = true;
        }

        // Check insufficient balance blocking
        const availableBalance = Number(currentWalletState?.available_balance ?? 0);
        const minimumTradeValue = Number(state.settings?.minimumTradeValue ?? 10);
        const blockByInsufficientBalance = availableBalance < minimumTradeValue;

        // Determine final blocking state and reason
        let finalBlocked = false;
        let finalReason = null;
        let finalDetails = null;

        // Use scanner state blocking status if available, otherwise fall back to local calculations
        if (strategyEvaluationBlocked && blockReason) {
          finalBlocked = true;
          finalReason = blockReason;
          
          // Set details based on the block reason
          switch (blockReason) {
            case 'investment_cap_reached':
              finalDetails = `Allocated $${currentAllocated.toFixed(1)} ≥ cap $${maxInvestmentCap.toFixed(1)}`;
              break;
            case 'insufficient_balance':
              finalDetails = `Balance $${availableBalance.toFixed(2)} < minimum $${minimumTradeValue}`;
              break;
            case 'downtrend_config':
              finalDetails = 'Downtrend blocking is ON';
              break;
            case 'low_regime_confidence':
              finalDetails = `Confidence ${currentConfidence.toFixed(1)}% < threshold ${currentThreshold}%`;
              break;
            case 'no_active_strategies':
              finalDetails = 'No active strategies found';
              break;
            default:
              finalDetails = 'Strategy evaluation blocked';
          }
        } else if (blockByMaxCap) {
          finalBlocked = true;
          finalReason = 'max_cap_reached';
          finalDetails = `Allocated $${currentAllocated.toFixed(1)} ≥ cap $${maxInvestmentCap.toFixed(1)}`;
        } else if (blockByInsufficientBalance) {
          finalBlocked = true;
          finalReason = 'insufficient_balance';
          finalDetails = `Balance $${availableBalance.toFixed(2)} < minimum $${minimumTradeValue}`;
        } else if (blockByDowntrend) {
          finalBlocked = true;
          finalReason = 'downtrend_config';
          finalDetails = 'Downtrend blocking is ON';
        } else if (blockByConfidence) {
          finalBlocked = true;
          finalReason = 'low_confidence';
          finalDetails = `Confidence ${currentConfidence.toFixed(1)}% < threshold ${currentThreshold}%`;
        }

        // Debug logging for final blocking state (sample only once)
        if (!loggedFinalBlockingState.current) {
          loggedFinalBlockingState.current = true;
        }
        
        setIsBlocked(finalBlocked);
        setBlockedReason(finalReason);
        setBlockedDetails(finalDetails);
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

  const getTooltipText = () => {
    if (!isBlocked) {
      return `Active: ${confidence?.toFixed(1)}% ≥ ${threshold}%`;
    }

    switch (blockedReason) {
      case 'max_cap_reached':
      case 'investment_cap_reached':
        return `Blocked: Max cap ${blockedDetails}`;
      case 'insufficient_balance':
        return `Blocked: Low balance ${blockedDetails}`;
      case 'downtrend_config':
        return `Blocked: Downtrend ON`;
      case 'low_confidence':
      case 'low_regime_confidence':
        return `Blocked: ${confidence?.toFixed(1)}% < ${threshold}%`;
      case 'no_active_strategies':
        return `Blocked: ${blockedDetails}`;
      default:
        return `Blocked: ${blockedDetails || 'Unknown'}`;
    }
  };

  const tooltipText = getTooltipText();

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
                <TooltipContent 
                  side="bottom" 
                  align="center" 
                  sideOffset={4}
                  className="max-w-xs z-50 text-xs"
                >
                    <p className="text-xs leading-tight">{tooltipText}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>);

};

export default RegimeBlockingIndicator;
