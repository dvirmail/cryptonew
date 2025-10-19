import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Search } from 'lucide-react';
import { defaultSignalSettings } from '@/components/utils/signalSettings';

const signalImplementationStatus = {
  // Momentum
  rsi: { backtesting: true, autoScan: true },
  stochastic: { backtesting: true, autoScan: true },
  williamsR: { backtesting: true, autoScan: true },
  cci: { backtesting: true, autoScan: true },
  roc: { backtesting: true, autoScan: true },
  awesomeOscillator: { backtesting: true, autoScan: true },
  cmo: { backtesting: true, autoScan: true },
  // Trend
  macd: { backtesting: true, autoScan: true },
  ema: { backtesting: true, autoScan: true },
  ma200: { backtesting: true, autoScan: true },
  ichimoku: { backtesting: true, autoScan: true },
  adx: { backtesting: true, autoScan: true },
  psar: { backtesting: true, autoScan: true },
  tema: { backtesting: true, autoScan: true },
  dema: { backtesting: true, autoScan: true },
  hma: { backtesting: true, autoScan: true },
  wma: { backtesting: true, autoScan: true },
  // Volatility
  bollinger: { backtesting: true, autoScan: true },
  atr: { backtesting: true, autoScan: true },
  keltner: { backtesting: true, autoScan: true },
  bbw: { backtesting: true, autoScan: true },
  donchian: { backtesting: true, autoScan: true },
  // Volume
  volume: { backtesting: true, autoScan: true },
  mfi: { backtesting: true, autoScan: true },
  obv: { backtesting: true, autoScan: true },
  cmf: { backtesting: true, autoScan: true },
  adLine: { backtesting: true, autoScan: true },
  // Other
  pivot: { backtesting: true, autoScan: true },
  fibonacci: { backtesting: true, autoScan: true },
  supportResistance: { backtesting: true, autoScan: true },
  // Patterns
  candlestick: { backtesting: true, autoScan: true },
  chartPatterns: { backtesting: true, autoScan: true },
};

const SignalStatusBadge = ({ implemented }) => {
  if (implemented) {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        <CheckCircle2 className="w-4 h-4 mr-1" />
        Implemented
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="w-4 h-4 mr-1" />
      Not Implemented
    </Badge>
  );
};

export default function SignalImplementationStatus() {
  const [searchTerm, setSearchTerm] = useState('');

  const categorizedSignals = useMemo(() => {
    const categories = {};
    for (const key in defaultSignalSettings) {
      const category = defaultSignalSettings[key].category || 'Other';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(key);
    }
    return categories;
  }, []);

  const filteredCategorizedSignals = useMemo(() => {
    if (!searchTerm) {
      return categorizedSignals;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    const filtered = {};
    for (const category in categorizedSignals) {
      const signals = categorizedSignals[category].filter(signalKey =>
        signalKey.toLowerCase().includes(lowercasedFilter)
      );
      if (signals.length > 0) {
        filtered[category] = signals;
      }
    }
    return filtered;
  }, [searchTerm, categorizedSignals]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Signal Implementation Status</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
           <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for a signal..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {Object.keys(filteredCategorizedSignals).sort().map(category => (
              <div key={category}>
                <h3 className="text-xl font-semibold mb-3 capitalize">{category}</h3>
                <div className="border rounded-lg">
                  <div className="grid grid-cols-3 font-semibold bg-gray-50 dark:bg-gray-800 p-3 border-b">
                    <div>Signal Name</div>
                    <div className="text-center">Backtesting Engine</div>
                    <div className="text-center">Auto Scanner</div>
                  </div>
                  <div className="divide-y">
                    {filteredCategorizedSignals[category].sort().map(signalKey => (
                      <div key={signalKey} className="grid grid-cols-3 p-3 items-center hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                        <div className="font-medium capitalize">{signalKey.replace(/_/g, ' ')}</div>
                        <div className="flex justify-center">
                          <SignalStatusBadge implemented={signalImplementationStatus[signalKey]?.backtesting || false} />
                        </div>
                        <div className="flex justify-center">
                          <SignalStatusBadge implemented={signalImplementationStatus[signalKey]?.autoScan || false} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}