import React, { useState, useEffect } from 'react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { getFearAndGreedIndex } from '@/api/functions';

const FearGreedWidget = () => {
  const [data, setData] = useState({ value: '50', classification: 'Neutral' });
  const [isLoading, setIsLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const fetchFearAndGreedData = async () => {
      try {
        console.log('[FearGreedWidget] Fetching Fear & Greed Index independently...');
        const response = await getFearAndGreedIndex();
        
        if (response?.data?.data && response.data.data.length > 0) {
          const fngData = response.data.data[0];
          const newData = {
            value: fngData.value,
            classification: fngData.value_classification,
          };
          setData(newData);
          setIsLoading(false);
          console.log('[FearGreedWidget] Successfully loaded Fear & Greed data:', newData);
        } else {
          console.warn('[FearGreedWidget] Invalid Fear & Greed response format:', response);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[FearGreedWidget] Error fetching Fear & Greed Index:', error);
        setIsLoading(false);
      }
    };

    // Fetch data immediately, don't wait for scanner
    fetchFearAndGreedData();

    // Also subscribe to scanner updates for periodic refresh
    const scannerService = getAutoScannerService();
    const unsubscribe = scannerService.subscribe(() => {
      const fngData = scannerService.fearAndGreedData;
      if (fngData) {
        const newData = {
          value: fngData.value,
          classification: fngData.value_classification,
        };
        setData(newData);
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const value = parseInt(data.value, 10) || 50;
  const classification = data.classification || 'Neutral';
  const angle = (value / 100) * 180;

  const getColorForValue = (val) => {
    if (val <= 25) return '#ef4444'; // Red
    if (val <= 45) return '#f97316'; // Orange
    if (val <= 55) return '#facc15'; // Yellow
    if (val <= 75) return '#84cc16'; // Lime
    return '#22c55e'; // Green
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

  return (
    <div 
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex flex-col items-center space-y-1 cursor-pointer">
        {/* Gauge */}
        <div className="relative">
          <svg viewBox="0 0 100 50" className="w-16 h-8">
            {/* Gauge Background Arc */}
            <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#e6e6e6" strokeWidth="8" />
            
            {/* Color segments */}
            <path d={getPathForSegment(0, 25)} fill="none" stroke={getColorForValue(10)} strokeWidth="8" /> {/* Extreme Fear */}
            <path d={getPathForSegment(25, 45)} fill="none" stroke={getColorForValue(35)} strokeWidth="8" /> {/* Fear */}
            <path d={getPathForSegment(45, 55)} fill="none" stroke={getColorForValue(50)} strokeWidth="8" /> {/* Neutral */}
            <path d={getPathForSegment(55, 75)} fill="none" stroke={getColorForValue(65)} strokeWidth="8" /> {/* Greed */}
            <path d={getPathForSegment(75, 100)} fill="none" stroke={getColorForValue(85)} strokeWidth="8" /> {/* Extreme Greed */}
            
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
            <p className="text-lg font-bold" style={{ color: getColorForValue(value) }}>
                {isLoading ? '...' : value}
            </p>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 -mt-1 capitalize">
                {isLoading ? '...' : classification.toLowerCase()}
            </p>
        </div>
      </div>

      {/* Tooltip - positioned outside header */}
      {showTooltip && (
        <div 
          className="absolute z-50"
          style={{ 
            position: 'fixed', 
            top: '120px', 
            right: '20px',
            maxWidth: '90vw'
          }}
        >
          <div className="bg-white text-gray-900 p-4 text-sm rounded-lg shadow-xl border border-gray-200 w-80">
            <h3 className="font-bold text-lg text-gray-900 mb-2">Fear & Greed Index</h3>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">
              Market sentiment based on volatility, market momentum, social media sentiment, surveys, Bitcoin dominance, and safe haven demand.
            </p>
            <div className="flex justify-between items-center">
              <span className="font-semibold">Current Sentiment:</span>
              <span className={`font-bold text-lg`} style={{ color: getColorForValue(value) }}>
                {classification} ({value}/100)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FearGreedWidget;