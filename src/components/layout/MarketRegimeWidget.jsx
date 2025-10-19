
import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { TrendingUp, TrendingDown, Minus, ShieldCheck, Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const MarketRegimeWidget = () => {
  const [regimeData, setRegimeData] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const scannerService = getAutoScannerService();

    const handleUpdate = (state) => {
      setRegimeData(state.marketRegime);
    };

    const unsubscribe = scannerService.subscribe(handleUpdate);
    handleUpdate(scannerService.getState());

    return unsubscribe;
  }, []);

  if (!regimeData) {
    return (
      <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm">
        <div className="w-4 h-4 bg-gray-400 rounded animate-pulse" />
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading...</span>
      </div>
    );
  }

  // Derive confirmation + confidence values
  const { regime, confidence, isConfirmed: detectedIsConfirmed } = regimeData;
  const isConfirmed = Boolean(detectedIsConfirmed);
  const confidencePercent = Math.round((confidence ?? 0) * 100);
  const angle = (confidencePercent / 100) * 180;

  const getColorForRegime = (regimeType) => {
    switch (regimeType?.toLowerCase()) {
      case 'uptrend':
        return '#22c55e'; // Green
      case 'downtrend': 
        return '#ef4444'; // Red
      case 'ranging':
        return '#f97316'; // Orange
      default:
        return '#6b7280'; // Gray
    }
  };

  const getPathForSegment = (startPercent, endPercent) => {
    const radius = 40;
    const cx = 50;
    const cy = 50;

    const startAngle = (1 - startPercent / 100) * Math.PI;
    const endAngle = (1 - endPercent / 100) * Math.PI;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy - radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy - radius * Math.sin(endAngle);
    
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };

  const getRegimeDescription = () => {
    switch (regime?.toLowerCase()) {
      case 'uptrend':
        return {
          title: 'Uptrend Market Detected',
          description: 'The market is trending upward with strong bullish momentum. Price action shows consistent higher highs and higher lows.',
          indicators: [
            'Strong directional movement with sustained buying pressure',
            'Price breaking above key resistance levels consistently',
            'Volume supporting upward price movements',
            'Moving averages aligned bullishly with price above key MAs'
          ],
          impact: 'Strategies optimized for trend following, breakouts, and momentum plays are prioritized.'
        };
      case 'downtrend':
        return {
          title: 'Downtrend Market Detected',
          description: 'The market is trending downward with bearish momentum. Price action shows consistent lower highs and lower lows.',
          indicators: [
            'Strong directional movement with sustained selling pressure',
            'Price breaking below key support levels consistently',
            'Volume supporting downward price movements',
            'Moving averages aligned bearishly with price below key MAs'
          ],
          impact: 'Strategies optimized for short selling, breakdown plays, and bearish momentum are prioritized.'
        };
      case 'ranging':
        return {
          title: 'Ranging Market Detected',
          description: 'The market is moving sideways within established support and resistance levels. Price action shows limited directional bias with regular oscillation between key levels.',
          indicators: [
            'Low ADX values indicating weak trend strength',
            'Price oscillating around moving averages',
            'Bollinger Bands showing compression/expansion cycles',
            'RSI making regular swings between oversold/overbought',
            'Volume patterns showing consolidation phases'
          ],
          impact: 'Strategies optimized for mean reversion, support/resistance bounces, and oscillator-based signals are prioritized.'
        };
      default:
        return {
          title: 'Market Regime Analysis',
          description: 'Analyzing current market conditions...',
          indicators: [],
          impact: 'Waiting for regime detection to complete.'
        };
    }
  };

  const regimeInfo = getRegimeDescription();

  // Build status badge as a reusable node
  const statusBadge = (
    <TooltipProvider>
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="bg-transparent hover:bg-transparent shadow-none border-gray-300/60 text-gray-700 dark:text-gray-300 inline-flex items-center gap-1.5"
            title={isConfirmed ? "Regime confirmed" : "Regime developing"}
          >
            {isConfirmed ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            {isConfirmed ? "Confirmed" : "Developing"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            {isConfirmed
              ? "Sustained regime detected over recent periods."
              : "Early signal; needs more consecutive periods to confirm."}
            <div className="mt-1 text-xs text-gray-500">
              Current confidence: {confidencePercent}%
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div 
      className="relative w-full"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center justify-center gap-3"> {/* Changed justify-between to justify-center as badge is moved */}
        <div className="flex flex-col items-center space-y-1 cursor-pointer">
          {/* Gauge */}
          <div className="relative">
            <svg viewBox="0 0 100 50" className="w-16 h-8">
              {/* Gauge Background Arc */}
              <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#e6e6e6" strokeWidth="8" />
              
              {/* Color segments based on regime type */}
              <path d={getPathForSegment(0, 33)} fill="none" stroke="#ef4444" strokeWidth="8" /> {/* Downtrend - Red */}
              <path d={getPathForSegment(33, 67)} fill="none" stroke="#f97316" strokeWidth="8" /> {/* Ranging - Orange */}
              <path d={getPathForSegment(67, 100)} fill="none" stroke="#22c55e" strokeWidth="8" /> {/* Uptrend - Green */}
              
              {/* Needle */}
              <g style={{ transition: 'transform 0.5s ease-out' }} transform={`rotate(${angle - 90} 50 50)`}>
                <line
                  x1="50"
                  y1="50"
                  x2="50"
                  y2="10"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </g>
              <circle cx="50" cy="50" r="3" fill="currentColor" />
            </svg>
          </div>
          
          {/* Text */}
          <div className="text-center -mt-2">
              <p className="text-lg font-bold" style={{ color: getColorForRegime(regime) }}>
                  {confidencePercent}%
              </p>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 -mt-1 capitalize">
                  {regime?.toLowerCase() || 'unknown'}
              </p>
          </div>

          {/* Place the status badge directly below the regime text */}
          <div className="mt-2">
            {statusBadge}
          </div>
        </div>
      </div>

      {/* Tooltip - positioned outside header */}
      {showTooltip && (
        <div 
          className="absolute z-50"
          style={{ 
            position: 'fixed', 
            top: '120px', 
            left: '50%', 
            transform: 'translateX(-50%)',
            maxWidth: '90vw'
          }}
        >
          <Card className="w-96 max-w-full bg-white shadow-xl border border-gray-200">
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-3">
                <h3 className="font-bold text-lg text-gray-900">{regimeInfo.title}</h3>
              </div>
              
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                {regimeInfo.description}
              </p>

              <div className="mb-4">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Key Indicators:</h4>
                <ul className="space-y-1">
                  {regimeInfo.indicators.map((indicator, index) => (
                    <li key={index} className="text-xs text-gray-600 flex items-start">
                      <span className="text-gray-400 mr-2">•</span>
                      <span>{indicator}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-sm text-gray-900">Confidence Level:</span>
                  <Badge className={`${confidencePercent > 60 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {confidencePercent > 80 ? 'High' : confidencePercent > 60 ? 'Moderate' : 'Low'} confidence ({confidencePercent}%)
                  </Badge>
                </div>
                <p className="text-xs text-gray-600">
                  {confidencePercent > 80 
                    ? 'Strong signals support this regime detection.'
                    : confidencePercent > 60 
                    ? 'Moderate confidence - Some indicators support this regime, but signals are mixed.'
                    : 'Low confidence - Mixed signals detected, regime may be transitioning.'
                  }
                </p>
              </div>

              <div className="border-t pt-3">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Strategy Impact:</h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {regimeInfo.impact}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default MarketRegimeWidget;
