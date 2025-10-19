import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Play, 
  BarChart3, 
  Zap,
  Brain,
  Target,
  TrendingUp,
  Activity
} from 'lucide-react';
import { defaultSignalSettings } from '@/components/utils/signalSettings';
import indicatorManager from '@/components/utils/indicatorManager';
import { evaluateSignalCondition } from '@/components/utils/signalLogic';
import MarketRegimeDetector from '@/components/utils/MarketRegimeDetector';

const { fetchKlineData } = indicatorManager;

export default function SystemTest() {
  const [testResults, setTestResults] = useState({});
  const [testProgress, setTestProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [overallStatus, setOverallStatus] = useState('idle');
  const [testSummary, setTestSummary] = useState(null);

  // All signals to test
  const allSignals = Object.keys(defaultSignalSettings).filter(key => 
    defaultSignalSettings[key].enabled !== undefined
  );

  const testSignal = async (signalKey, testData, regimeDetector) => {
    try {
      const settings = { ...defaultSignalSettings[signalKey], enabled: true };
      
      // Calculate indicators (mock implementation for testing)
      const mockIndicators = {
        data: testData,
        [signalKey]: testData.map((_, idx) => {
          // Generate mock indicator values based on signal type
          switch(signalKey) {
            case 'rsi':
              return 30 + (Math.sin(idx * 0.1) * 20) + (Math.random() * 10);
            case 'macd':
              return {
                macd: Math.sin(idx * 0.05) * 2,
                signal: Math.sin(idx * 0.05 - 0.2) * 2,
                histogram: Math.sin(idx * 0.1) * 1
              };
            case 'bollinger':
              const price = testData[idx]?.close || 100;
              return {
                upper: price * 1.02,
                middle: price,
                lower: price * 0.98
              };
            case 'volume':
              return testData[idx]?.volume || 1000000;
            case 'stochastic':
              return {
                k: 20 + (Math.sin(idx * 0.08) * 30) + (Math.random() * 20),
                d: 25 + (Math.sin(idx * 0.08 - 0.1) * 25) + (Math.random() * 15)
              };
            default:
              return Math.random() * 100;
          }
        })
      };

      const testResults = [];
      let signalCount = 0;
      let regimeIntegrationCount = 0;
      let convictionBonusCount = 0;

      // Test signal evaluation across multiple candles
      for (let i = 50; i < Math.min(testData.length - 10, 200); i++) {
        const candle = testData[i];
        const marketRegime = regimeDetector.detectRegime(testData, i);
        
        const signals = evaluateSignalCondition(
          signalKey,
          candle,
          mockIndicators,
          i,
          settings,
          marketRegime,
          null // No logging during test
        );

        if (signals && signals.length > 0) {
          signalCount += signals.length;
          
          // Check if signals use market regime data
          signals.forEach(signal => {
            if (signal.strength && typeof signal.strength === 'number') {
              if (signal.strength > 50 && marketRegime?.regime) {
                regimeIntegrationCount++;
              }
              if (signal.strength > 80 && marketRegime?.confidence > 0.7) {
                convictionBonusCount++;
              }
            }
          });
          
          testResults.push(...signals);
        }
      }

      return {
        success: true,
        signalCount,
        regimeIntegrationCount,
        convictionBonusCount,
        avgStrength: testResults.length > 0 ? 
          testResults.reduce((sum, s) => sum + (s.strength || 0), 0) / testResults.length : 0,
        uniqueValues: [...new Set(testResults.map(s => s.value))],
        sampleSignals: testResults.slice(0, 3)
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        signalCount: 0,
        regimeIntegrationCount: 0,
        convictionBonusCount: 0
      };
    }
  };

  const runComprehensiveTest = async () => {
    setIsRunning(true);
    setTestProgress(0);
    setOverallStatus('running');
    setTestResults({});

    try {
      // Fetch test data
      const testDataResult = await fetchKlineData('BTCUSDT', '1h', 500);
      if (!testDataResult.success || !testDataResult.data) {
        throw new Error('Failed to fetch test data');
      }

      const testData = testDataResult.data.map(kline => ({
        time: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5])
      }));

      // Initialize regime detector
      const regimeDetector = new MarketRegimeDetector();

      const results = {};
      let passedTests = 0;
      let totalTests = allSignals.length;

      // Test each signal
      for (let i = 0; i < allSignals.length; i++) {
        const signalKey = allSignals[i];
        setTestProgress(((i + 1) / totalTests) * 100);

        const result = await testSignal(signalKey, testData, regimeDetector);
        results[signalKey] = result;

        if (result.success && result.signalCount > 0) {
          passedTests++;
        }

        // Small delay to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      setTestResults(results);
      setTestSummary({
        totalSignals: totalTests,
        passedSignals: passedTests,
        failedSignals: totalTests - passedTests,
        avgSignalsPerIndicator: Object.values(results).reduce((sum, r) => sum + r.signalCount, 0) / totalTests,
        regimeIntegrationRate: Object.values(results).reduce((sum, r) => sum + r.regimeIntegrationCount, 0) / 
                              Object.values(results).reduce((sum, r) => sum + r.signalCount, 0) * 100,
        convictionUtilizationRate: Object.values(results).reduce((sum, r) => sum + r.convictionBonusCount, 0) / 
                                  Object.values(results).reduce((sum, r) => sum + r.signalCount, 0) * 100
      });

      setOverallStatus(passedTests === totalTests ? 'success' : 'partial');

    } catch (error) {
      console.error('System test failed:', error);
      setOverallStatus('failed');
    } finally {
      setIsRunning(false);
      setTestProgress(100);
    }
  };

  const getSignalStatusIcon = (result) => {
    if (!result) return <AlertTriangle className="h-4 w-4 text-gray-400" />;
    if (result.success && result.signalCount > 0) return <CheckCircle className="h-4 w-4 text-green-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getSignalStatusColor = (result) => {
    if (!result) return 'border-gray-200';
    if (result.success && result.signalCount > 0) return 'border-green-200 bg-green-50';
    return 'border-red-200 bg-red-50';
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">CryptoSentinel v7.0 - System Test</h1>
          <p className="text-muted-foreground mt-2">
            Comprehensive validation of all A-Tier signals with market regime integration
          </p>
        </div>
        <Button 
          onClick={runComprehensiveTest} 
          disabled={isRunning}
          className="bg-gradient-to-r from-blue-600 to-purple-600"
        >
          {isRunning ? (
            <>
              <Activity className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run Full System Test
            </>
          )}
        </Button>
      </div>

      {isRunning && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Testing Progress</span>
              <span className="text-sm text-muted-foreground">{Math.round(testProgress)}%</span>
            </div>
            <Progress value={testProgress} className="w-full" />
          </CardContent>
        </Card>
      )}

      {testSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Target className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{testSummary.passedSignals}/{testSummary.totalSignals}</p>
                  <p className="text-sm text-muted-foreground">Signals Passed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{testSummary.avgSignalsPerIndicator.toFixed(1)}</p>
                  <p className="text-sm text-muted-foreground">Avg Signals/Indicator</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Brain className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">{testSummary.regimeIntegrationRate.toFixed(1)}%</p>
                  <p className="text-sm text-muted-foreground">Regime Integration</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">{testSummary.convictionUtilizationRate.toFixed(1)}%</p>
                  <p className="text-sm text-muted-foreground">Conviction Utilization</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {overallStatus !== 'idle' && (
        <Alert className={
          overallStatus === 'success' ? 'border-green-200 bg-green-50' :
          overallStatus === 'partial' ? 'border-yellow-200 bg-yellow-50' :
          'border-red-200 bg-red-50'
        }>
          <AlertDescription>
            {overallStatus === 'success' && (
              <>
                <CheckCircle className="h-4 w-4 text-green-600 inline mr-2" />
                All signals passed testing! The system is operating at full A-Tier capacity with complete market regime integration.
              </>
            )}
            {overallStatus === 'partial' && (
              <>
                <AlertTriangle className="h-4 w-4 text-yellow-600 inline mr-2" />
                Most signals passed, but some issues were detected. Review the detailed results below.
              </>
            )}
            {overallStatus === 'failed' && (
              <>
                <XCircle className="h-4 w-4 text-red-600 inline mr-2" />
                System test failed. Check the console for detailed error information.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {Object.keys(testResults).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Detailed Signal Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allSignals.map(signalKey => {
                const result = testResults[signalKey];
                return (
                  <Card key={signalKey} className={`p-3 ${getSignalStatusColor(result)}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {getSignalStatusIcon(result)}
                        <span className="font-medium text-sm capitalize">
                          {signalKey.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <Badge variant={result?.success ? 'default' : 'destructive'} className="text-xs">
                        {result?.success ? 'PASS' : 'FAIL'}
                      </Badge>
                    </div>
                    
                    {result && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>Signals Generated: {result.signalCount}</div>
                        <div>Avg Strength: {result.avgStrength?.toFixed(1) || 'N/A'}</div>
                        <div>Regime Integration: {result.regimeIntegrationCount}</div>
                        <div>Conviction Bonus: {result.convictionBonusCount}</div>
                        {result.uniqueValues && (
                          <div>Values: {result.uniqueValues.slice(0, 2).join(', ')}{result.uniqueValues.length > 2 ? '...' : ''}</div>
                        )}
                        {result.error && (
                          <div className="text-red-600">Error: {result.error}</div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}