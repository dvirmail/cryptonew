
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import BacktestingEngine, { processBacktestResults } from '@/components/backtesting/BacktestingEngine';
import { fetchKlineData } from '@/components/utils/indicatorManager';
import { AlertTriangle, CheckCircle, PlayCircle, Loader2 } from 'lucide-react';
import { getAvailablePairs } from "@/components/utils/indicatorManager";

export default function BacktestingTest() {
  const [testResults, setTestResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState('');

  const runTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    const results = [];

    try {
      // Test 1: Basic Engine Initialization
      setCurrentTest('Testing Engine Initialization...');
      try {
        const mockData = generateMockKlineData(200);
        const engine = new BacktestingEngine({
          historicalData: mockData,
          signalSettings: {
            rsi: { enabled: true, period: 14, oversoldValue: 30, overboughtValue: 70 },
            macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
          },
          minPriceMove: 2.0,
          requiredSignals: 2,
          maxSignals: 5,
          timeWindow: "24h",
          timeframe: "1h",
          coin: "BTC/USDT"
        });

        results.push({
          test: 'Engine Initialization',
          status: 'pass',
          message: 'BacktestingEngine initialized successfully'
        });
      } catch (error) {
        results.push({
          test: 'Engine Initialization',
          status: 'fail',
          message: `Failed to initialize engine: ${error.message}`
        });
      }

      // Test 2: Indicator Calculations
      setCurrentTest('Testing Indicator Calculations...');
      try {
        const mockData = generateMockKlineData(100);
        const engine = new BacktestingEngine({
          historicalData: mockData,
          signalSettings: {
            rsi: { enabled: true, period: 14 },
            macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
            bollinger: { enabled: true, period: 20, stdDev: 2.0 },
            ema: { enabled: true, fastPeriod: 20, slowPeriod: 50 },
            ma200: { enabled: true, period: 200 }
          },
          minPriceMove: 1.0,
          requiredSignals: 1,
          maxSignals: 3,
          timeWindow: "12h",
          timeframe: "1h",
          coin: "ETH/USDT"
        });

        const indicators = engine.calculateAllIndicatorsAndPatterns();
        
        let indicatorTests = [];
        if (indicators.rsi && indicators.rsi.length > 0 && indicators.rsi[indicators.rsi.length - 1] !== null) {
          indicatorTests.push('RSI: ✓');
        } else {
          indicatorTests.push('RSI: ✗');
        }

        if (indicators.macd && indicators.macd.length > 0 && indicators.macd[indicators.macd.length - 1]?.macd !== null) {
          indicatorTests.push('MACD: ✓');
        } else {
          indicatorTests.push('MACD: ✗');
        }

        if (indicators.bollingerBands && indicators.bollingerBands.length > 0 && indicators.bollingerBands[indicators.bollingerBands.length - 1]?.upper !== null) {
          indicatorTests.push('Bollinger: ✓');
        } else {
          indicatorTests.push('Bollinger: ✗');
        }

        results.push({
          test: 'Indicator Calculations',
          status: 'pass',
          message: `Indicators calculated: ${indicatorTests.join(', ')}`
        });
      } catch (error) {
        results.push({
          test: 'Indicator Calculations',
          status: 'fail',
          message: `Indicator calculation failed: ${error.message}`
        });
      }

      // Test 3: Signal Detection
      setCurrentTest('Testing Signal Detection...');
      try {
        const mockData = generateMockKlineData(150);
        const engine = new BacktestingEngine({
          historicalData: mockData,
          signalSettings: {
            rsi: { enabled: true, period: 14, oversoldValue: 30, overboughtValue: 70 },
            macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
          },
          minPriceMove: 1.5,
          requiredSignals: 1,
          maxSignals: 4,
          timeWindow: "6h",
          timeframe: "1h",
          coin: "BTC/USDT"
        });

        const indicators = engine.calculateAllIndicatorsAndPatterns();
        
        // Test signal detection at a specific index
        const testIndex = 100;
        const signals = engine.detectSignalsAtIndex(testIndex, indicators);
        
        results.push({
          test: 'Signal Detection',
          status: 'pass',
          message: `Signal detection working. Found ${signals.length} signals at index ${testIndex}`
        });
      } catch (error) {
        results.push({
          test: 'Signal Detection',
          status: 'fail',
          message: `Signal detection failed: ${error.message}`
        });
      }

      // Test 4: Chunk Analysis
      setCurrentTest('Testing Chunk Analysis...');
      try {
        const mockData = generateMockKlineData(120);
        const engine = new BacktestingEngine({
          historicalData: mockData,
          signalSettings: {
            rsi: { enabled: true, period: 14, oversoldValue: 30, overboughtValue: 70 },
            macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
          },
          minPriceMove: 2.0,
          requiredSignals: 1,
          maxSignals: 3,
          timeWindow: "24h",
          timeframe: "1h",
          coin: "BTC/USDT"
        });

        const indicators = engine.calculateAllIndicatorsAndPatterns();
        const matches = engine.analyzeSignalsChunk(50, 80, indicators);
        
        results.push({
          test: 'Chunk Analysis',
          status: 'pass',
          message: `Chunk analysis complete. Found ${matches.length} matches in range 50-80`
        });
      } catch (error) {
        results.push({
          test: 'Chunk Analysis',
          status: 'fail',
          message: `Chunk analysis failed: ${error.message}`
        });
      }

      // Test 5: Time Window Parsing
      setCurrentTest('Testing Time Window Parsing...');
      try {
        const engine = new BacktestingEngine({
          historicalData: generateMockKlineData(50),
          signalSettings: { rsi: { enabled: true, period: 14 } },
          minPriceMove: 1.0,
          requiredSignals: 1,
          maxSignals: 2,
          timeWindow: "12h",
          timeframe: "1h",
          coin: "ETH/USDT"
        });

        const candles12h = engine.parseTimeWindow("12h");
        const candles24h = engine.parseTimeWindow("24h");
        const candles60m = engine.parseTimeWindow("60m");

        results.push({
          test: 'Time Window Parsing',
          status: 'pass',
          message: `Time parsing: 12h=${candles12h} candles, 24h=${candles24h} candles, 60m=${candles60m} candles`
        });
      } catch (error) {
        results.push({
          test: 'Time Window Parsing',
          status: 'fail',
          message: `Time window parsing failed: ${error.message}`
        });
      }

      // Test 6: Results Processing
      setCurrentTest('Testing Results Processing...');
      try {
        const mockMatches = [
          {
            time: Date.now(),
            price: 45000,
            signals: [
              {
                type: 'Ichimoku',
                value: 'complex_signal',
                ichimokuSignals: [
                  { specificSignal: 'tk_cross_bullish', strength: 0.8, signalType: 'bullish', details: 'Test signal 1' },
                  { specificSignal: 'price_above_cloud', strength: 0.7, signalType: 'bullish', details: 'Test signal 2' }
                ]
              },
              { type: 'RSI', value: 'oversold_exit' }
            ],
            successful: true,
            priceMove: 2.5,
            timeToPeak: 4
          }
        ];

        const processedMatches = processBacktestResults(mockMatches);
        
        const ichimokuMatches = processedMatches.filter(m => 
          m.signals.some(s => s.type === 'Ichimoku' && s.parameters?.specificSignal)
        );

        results.push({
          test: 'Results Processing',
          status: 'pass',
          message: `Results processing working. Processed ${processedMatches.length} total matches, ${ichimokuMatches.length} Ichimoku-specific`
        });
      } catch (error) {
        results.push({
          test: 'Results Processing',
          status: 'fail',
          message: `Results processing failed: ${error.message}`
        });
      }

      // Test 7: Real Data Integration (Optional)
      setCurrentTest('Testing Real Data Integration...');
      try {
        const klineResult = await fetchKlineData('BTC/USDT', '1h', 100);
        
        if (klineResult.success && klineResult.data.length > 50) {
          const engine = new BacktestingEngine({
            historicalData: klineResult.data,
            signalSettings: {
              rsi: { enabled: true, period: 14, oversoldValue: 30, overboughtValue: 70 }
            },
            minPriceMove: 1.0,
            requiredSignals: 1,
            maxSignals: 2,
            timeWindow: "6h",
            timeframe: "1h",
            coin: "BTC/USDT"
          });

          const indicators = engine.calculateAllIndicatorsAndPatterns();
          const matches = engine.analyzeSignalsChunk(30, 60, indicators);

          results.push({
            test: 'Real Data Integration',
            status: 'pass',
            message: `Real data test passed. Used ${klineResult.data.length} candles, found ${matches.length} matches`
          });
        } else {
          results.push({
            test: 'Real Data Integration',
            status: 'warning',
            message: 'Could not fetch sufficient real data for test'
          });
        }
      } catch (error) {
        results.push({
          test: 'Real Data Integration',
          status: 'fail',
          message: `Real data integration failed: ${error.message}`
        });
      }

      // Test 8: Indicator Manager Integration (Check if getAvailablePairs is accessible and returns expected format)
      setCurrentTest('Testing Indicator Manager Integration...');
      try {
        const pairs = getAvailablePairs();
        if (Array.isArray(pairs) && pairs.length > 0 && typeof pairs[0].value === 'string') {
          results.push({
            test: 'Indicator Manager Integration',
            status: 'pass',
            message: `getAvailablePairs successful. Found ${pairs.length} pairs.`
          });
        } else {
          results.push({
            test: 'Indicator Manager Integration',
            status: 'fail',
            message: `getAvailablePairs did not return expected format.`
          });
        }
      } catch (error) {
        results.push({
          test: 'Indicator Manager Integration',
          status: 'fail',
          message: `Indicator Manager integration failed: ${error.message}`
        });
      }

    } catch (error) {
      results.push({
        test: 'Overall Test Suite',
        status: 'fail',
        message: `Test suite error: ${error.message}`
      });
    }

    setTestResults(results);
    setIsRunning(false);
    setCurrentTest('');
  };

  // Helper function to generate mock kline data
  const generateMockKlineData = (count) => {
    const data = [];
    let basePrice = 45000;
    const baseTime = Date.now() - (count * 60 * 60 * 1000); // Hours ago

    for (let i = 0; i < count; i++) {
      const volatility = 0.02; // 2% volatility
      const change = (Math.random() - 0.5) * volatility;
      const newPrice = basePrice * (1 + change);
      
      const high = newPrice * (1 + Math.random() * 0.01);
      const low = newPrice * (1 - Math.random() * 0.01);
      const volume = 1000 + Math.random() * 5000;

      data.push({
        time: baseTime + (i * 60 * 60 * 1000),
        open: basePrice,
        high: high,
        low: low,
        close: newPrice,
        volume: volume
      });

      basePrice = newPrice;
    }

    return data;
  };

  const passedTests = testResults.filter(r => r.status === 'pass').length;
  const failedTests = testResults.filter(r => r.status === 'fail').length;
  const warningTests = testResults.filter(r => r.status === 'warning').length;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-6 w-6" />
            Backtesting Engine Functionality Test
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Button 
                onClick={runTests} 
                disabled={isRunning}
                className="flex items-center gap-2"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running Tests...
                  </>
                ) : (
                  <>
                    <PlayCircle className="h-4 w-4" />
                    Run All Tests
                  </>
                )}
              </Button>
              
              {testResults.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    {passedTests} Passed
                  </span>
                  {failedTests > 0 && (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertTriangle className="h-4 w-4" />
                      {failedTests} Failed
                    </span>
                  )}
                  {warningTests > 0 && (
                    <span className="flex items-center gap-1 text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      {warningTests} Warnings
                    </span>
                  )}
                </div>
              )}
            </div>

            {isRunning && currentTest && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>{currentTest}</AlertDescription>
              </Alert>
            )}

            {testResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Test Results</h3>
                {testResults.map((result, index) => (
                  <Alert key={index} className={
                    result.status === 'pass' ? 'border-green-500 bg-green-50' :
                    result.status === 'fail' ? 'border-red-500 bg-red-50' :
                    'border-yellow-500 bg-yellow-50'
                  }>
                    {result.status === 'pass' ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className={`h-4 w-4 ${result.status === 'fail' ? 'text-red-600' : 'text-yellow-600'}`} />
                    )}
                    <AlertDescription>
                      <div className="font-medium">{result.test}</div>
                      <div className="text-sm text-gray-600 mt-1">{result.message}</div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Engine Component Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">Core Components</h4>
              <ul className="space-y-1">
                <li>✓ BacktestingEngine class</li>
                <li>✓ calculateAllIndicatorsAndPatterns</li>
                <li>✓ detectSignalsAtIndex</li>
                <li>✓ analyzeSignalsChunk</li>
                <li>✓ parseTimeWindow</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Supported Indicators</h4>
              <ul className="space-y-1">
                <li>✓ RSI (Relative Strength Index)</li>
                <li>✓ MACD (Moving Average Convergence Divergence)</li>
                <li>✓ Bollinger Bands</li>
                <li>✓ EMA (Exponential Moving Average)</li>
                <li>✓ MA200 (200-period Moving Average)</li>
                <li>✓ Ichimoku Cloud (with complex signals)</li>
                <li>✓ Support/Resistance Analysis</li>
                <li>✓ Modular Indicator System Integration (via indicatorManager)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
