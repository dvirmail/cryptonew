
import React from 'react';
import { format } from "date-fns";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Scatter,
  ReferenceLine,
  Legend,
  Rectangle
} from 'recharts';
import { Badge } from "@/components/ui/badge";

export default function PriceChart({ 
  data, 
  loading, 
  loadingProgress, 
  symbol, // This 'symbol' prop now represents the specific coin whose data is being charted
  signalPoints = [], // These signalPoints should already be filtered for the 'symbol'
  showLineChart = true
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600 dark:text-gray-400">Loading chart data for {symbol}...</p>
        {loadingProgress > 0 && (
          <Progress value={loadingProgress} className="w-64 mt-2" />
        )}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
        <p className="text-gray-600 dark:text-gray-400">No data available for {symbol}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Try fetching data again.</p>
      </div>
    );
  }
  const mockDataPoints = data.filter(point => point.isMockData).length;
  const mockDataPercentage = data.length > 0 ? (mockDataPoints / data.length) * 100 : 0;
  const hasMockData = mockDataPercentage > 0;

  // Format data for recharts
  const chartData = data.map((point, index) => ({
    time: new Date(point.time).getTime(),
    formattedTime: format(new Date(point.time), "MM/dd HH:mm"),
    price: point.close,
    open: point.open,
    high: point.high,
    low: point.low,
    index,
    isMockData: point.isMockData || false,
    coin: point.coin || symbol // Ensure coin property is available
  }));
  
  // Process signal points - they should already be filtered for this symbol by the parent
  const signalMarkers = [];
  if (signalPoints && signalPoints.length > 0) {
    signalPoints.forEach(signalPoint => {
      // Extract time from signalPoint, could be Date object or timestamp
      const signalTime = signalPoint.time instanceof Date ? 
        signalPoint.time.getTime() : 
        typeof signalPoint.time === 'number' ? 
          signalPoint.time : 
          new Date(signalPoint.time).getTime();
      
      // Find the closest data point to this signal
      let closestIndex = -1; // Initialize with -1
      let closestDiff = Number.MAX_SAFE_INTEGER;
      
      chartData.forEach((dataPoint, idx) => {
        const diff = Math.abs(dataPoint.time - signalTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIndex = idx;
        }
      });

      if (closestIndex !== -1) { // Ensure a closest point was found
          // Create the marker point with combined properties
          const markerPoint = {
            ...chartData[closestIndex],
            isSignalPoint: true,
            signalType: signalPoint.signals ? 
              (Array.isArray(signalPoint.signals) ? 
                signalPoint.signals.map(s => s.type).join(', ') : 
                signalPoint.signals) : 
              'Signal',
            successful: signalPoint.successful,
            signalDetails: signalPoint // Keep original signal data for tooltip
          };
          signalMarkers.push(markerPoint);
      }
    });
  }

  // Get y-axis min and max for chart scaling
  const prices = chartData.map(point => point.price);
  const minPrice = Math.min(...prices) * 0.998; // Add 0.2% padding
  const maxPrice = Math.max(...prices) * 1.002; // Add 0.2% padding

  // Count signal matches by outcome
  const successfulSignals = signalPoints.filter(point => point.successful).length;
  const unsuccessfulSignals = signalPoints.filter(point => point.successful === false).length;
  const pendingSignals = signalPoints.filter(point => point.successful === undefined || point.successful === null).length;

  // Custom tooltip component for hover info on price chart
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    
    const dataPoint = payload[0].payload;
    
    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
        <p className="text-sm font-medium">{dataPoint.formattedTime} ({dataPoint.coin || symbol})</p>
        <p className="text-sm">Price: ${dataPoint.price.toFixed(dataPoint.price > 10 ? 2 : 4)}</p>
        
        {dataPoint.isMockData && (
          <div className="mt-1">
            <Badge variant="outline" className="text-yellow-500 border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 text-xs flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              <span>Simulated Data</span>
            </Badge>
          </div>
        )}
        
        {dataPoint.isSignalPoint && dataPoint.signalDetails && (
          <div className="mt-1 border-t border-gray-200 dark:border-gray-700 pt-1">
            <p className="text-xs font-semibold">
              {dataPoint.signalDetails.successful === true ? "✅ Successful" : 
                dataPoint.signalDetails.successful === false ? "❌ Failed" : "⏳ Pending"}
              {dataPoint.signalDetails.priceMove ? ` (${dataPoint.signalDetails.priceMove.toFixed(2)}%)` : ''}
            </p>
            {dataPoint.signalDetails.signals && Array.isArray(dataPoint.signalDetails.signals) && (
              <p className="text-xs">Signals: {dataPoint.signalDetails.signals.map(s => `${s.type} (${s.value || 'trigger'})`).join(', ')}</p>
            )}
             {dataPoint.signalDetails.timeToPeak && (
              <p className="text-xs">Time to peak: {(dataPoint.signalDetails.timeToPeak / (1000 * 60 * 60)).toFixed(1)}h</p>
            )}
            {dataPoint.signalDetails.maxDrawdown && (
              <p className="text-xs">Max Drawdown: {dataPoint.signalDetails.maxDrawdown.toFixed(2)}%</p>
            )}
          </div>
        )}
      </div>
    );
  };
  
  // Custom shape for signal points
  const CustomSignalPoint = (props) => {
    const { cx, cy, payload } = props; // payload contains the signal point data
    
    // Choose shape and color based on success status
    const successful = payload?.successful; // Access successful from payload
    const color = successful === true ? "#10b981" : (successful === false ? "#ef4444" : "#3b82f6");
    const size = 6; // Size of the marker
    
    return (
      <>
        {/* Base circle */}
        <circle 
          cx={cx} 
          cy={cy} 
          r={size} 
          fill={color} 
          stroke="white"
          strokeWidth={1}
        />
        {/* Halo/ring effect for better visibility */}
        <circle 
          cx={cx} 
          cy={cy} 
          r={size + 2} 
          fill="none" 
          stroke={color}
          strokeWidth={1}
          opacity={0.6}
        />
      </>
    );
  };

  return (
    <div className="h-[500px] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="mb-4 flex flex-wrap gap-3 justify-between">
        <div>
          <h3 className="font-medium">{symbol} Price Chart</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {chartData.length > 0 ? `${format(new Date(chartData[0].time), "MMM d, HH:mm")} - ${format(new Date(chartData[chartData.length-1].time), "MMM d, HH:mm")}` : 'N/A'}
          </p>
          
          {hasMockData && (
            <div className="mt-1 flex items-center">
              <Badge variant="outline" className="text-yellow-500 border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                <span>Contains {mockDataPercentage.toFixed(0)}% simulated data</span>
              </Badge>
            </div>
          )}
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">Data Points</p>
            <p className="font-medium">{chartData.length}</p>
          </div>
          {signalPoints.length > 0 && (
            <>
              <div className="text-center">
                <p className="text-xs text-green-500">Success</p>
                <p className="font-medium">{successfulSignals}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-red-500">Fail</p>
                <p className="font-medium">{unsuccessfulSignals}</p>
              </div>
              {pendingSignals > 0 && (
                <div className="text-center">
                  <p className="text-xs text-blue-500">Pending</p>
                  <p className="font-medium">{pendingSignals}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 20, bottom: 25 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis 
              dataKey="formattedTime"
              tick={{ fontSize: 10 }}
              interval={Math.floor(chartData.length / 10) || 0} // Show ~10 x-axis ticks
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              domain={[minPrice, maxPrice]} 
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => value.toFixed(chartData.length > 0 && chartData[0].price > 10 ? 2 : 4)}
              width={80} // Increased width for potentially longer y-axis labels
            />
            
            {/* Background markers for mock data regions */}
            {hasMockData && (
              <ReferenceLine
                isFront={false}
                stroke="none"
                y={0}
                shape={(props) => {
                  const { xAxis, yAxis } = props; // Ensure these are available
                  if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null;
                  
                  let previousIsMock = null;
                  let rectangles = [];
                  let startX = null;
                  
                  // Iterate through data and create background rectangles for mock data regions
                  chartData.forEach((point, index) => {
                    const xPos = xAxis.scale(index); 
                    
                    // Check for start of mock data region
                    if (previousIsMock === false && point.isMockData) {
                      startX = xPos;
                    }
                    
                    // Check for end of mock data region
                    if (previousIsMock === true && (!point.isMockData || index === chartData.length - 1)) {
                      const endX = xPos;
                      rectangles.push(
                        <rect
                          key={`mock-region-${index}`}
                          x={startX}
                          y={yAxis.scale(maxPrice)} // top of the chart
                          width={endX - startX}
                          height={yAxis.scale(minPrice) - yAxis.scale(maxPrice)} // height from min to max price
                          fill="#FFFF00" // Solid yellow for mock region background
                          opacity={0.1}  // Low opacity
                        />
                      );
                    }
                    
                    previousIsMock = point.isMockData;
                  });
                  
                  return <g>{rectangles}</g>;
                }}
              />
            )}
            
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{fontSize: "12px"}}/>
            
            {/* Price line */}
            <Line
              name={`Price (${symbol})`}
              type="monotone"
              dataKey="price"
              stroke="#3b82f6" 
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 5, fill: "#2563eb" }}
              connectNulls={true}
            />
            
            {/* Signal points */}
            {signalMarkers.length > 0 && (
              <Scatter
                name="Signal Points"
                data={signalMarkers}
                shape={CustomSignalPoint} // Pass component directly
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap justify-center gap-4">
        {signalPoints.length > 0 && (
          <>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
              <span>Successful Signals</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-1"></div>
              <span>Failed Signals</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div>
              <span>Pending/Unknown</span>
            </div>
          </>
        )}
        
        {hasMockData && (
          <div className="flex items-center">
            <AlertTriangle className="w-3 h-3 text-yellow-500 mr-1" />
            <span className="text-yellow-600 dark:text-yellow-400">Yellow background regions indicate simulated data</span>
          </div>
        )}
      </div>
    </div>
  );
}
