import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  Cell,
} from "recharts";
import { TrendingUp, BarChart3, Brain, Bitcoin } from "lucide-react";
import { getFearAndGreedIndex } from "@/api/functions";
import { getBinancePrices } from "@/api/functions";
import { queueFunctionCall } from "@/components/utils/apiQueue";
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from "@/components/providers/WalletProvider";

export default function FearGreedBitcoinChart(props) {
  const {
    trades = [],
    timeframe: initialTimeframe = '7d'
  } = props;

  const [selectedTimeframe, setSelectedTimeframe] = useState(initialTimeframe);
  const [fearGreedData, setFearGreedData] = useState([]);
  const [bitcoinPrices, setBitcoinPrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const { isLiveMode } = useTradingMode();
  
  // Use WalletProvider as primary data source (same as DailyPerformanceChart)
  const { dailyPerformanceHistory, hourlyPerformanceHistory } = useWallet();

  // Fetch Fear & Greed Index and Bitcoin price data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const fearGreedResponse = await getFearAndGreedIndex();

        if (fearGreedResponse?.data?.data && Array.isArray(fearGreedResponse.data.data)) {
          setFearGreedData(fearGreedResponse.data.data);
        } else {
          console.warn('Fear & Greed data not in expected format:', fearGreedResponse);
          setFearGreedData([]);
        }

        const btcPriceResponse = await getBinancePrices({ symbols: ['BTCUSDT'] });

        // Handle both direct response and wrapped response formats
        let btcData = null;
        if (Array.isArray(btcPriceResponse)) {
          btcData = btcPriceResponse.find(item => item.symbol === 'BTCUSDT');
        } else if (btcPriceResponse?.data?.data && Array.isArray(btcPriceResponse.data.data)) {
          btcData = btcPriceResponse.data.data.find(item => item.symbol === 'BTCUSDT');
        } else if (btcPriceResponse?.data && Array.isArray(btcPriceResponse.data)) {
          btcData = btcPriceResponse.data.find(item => item.symbol === 'BTCUSDT');
        }

        if (btcData) {
          setBitcoinPrices({
            currentPrice: btcData.price,
            change24h: btcData.change
          });
        }

      } catch (error) {
        console.error('Failed to fetch data:', error);
        setFearGreedData([]);
        setBitcoinPrices({});
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Helper to find closest Fear & Greed value for a given date
  const findClosestFearGreed = useCallback((targetDate) => {
    if (!fearGreedData || fearGreedData.length === 0) return null;

    const targetTimestamp = new Date(targetDate).getTime();
    let closest = null;
    let closestDiff = Infinity;

    for (const fgEntry of fearGreedData) {
      const fgTimestamp = new Date(parseInt(fgEntry.timestamp) * 1000).getTime();
      const diff = Math.abs(targetTimestamp - fgTimestamp);

      if (diff < closestDiff) {
        closestDiff = diff;
        closest = fgEntry;
      }
    }
    return closest;
  }, [fearGreedData]);

  // COPIED FROM DailyPerformanceChart: Bucket helpers for deduplication
  const toBucketKey = useCallback((iso, bucket) => {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    if (bucket === 'day') return `${y}-${m}-${day}`;
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();
  }, []);

  const dedupeByBucket = useCallback((arr, bucket) => {
    if (!Array.isArray(arr)) return [];
    const map = new Map();
    for (const rec of arr) {
      if (!rec?.snapshot_timestamp) continue;
      const key = toBucketKey(rec.snapshot_timestamp, bucket);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, rec);
      } else {
        const tNew = new Date(rec.snapshot_timestamp).getTime();
        const tOld = new Date(existing.snapshot_timestamp).getTime();
        if (tNew > tOld) map.set(key, rec);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      new Date(a.snapshot_timestamp).getTime() - new Date(b.snapshot_timestamp).getTime()
    );
  }, [toBucketKey]);

  // UPDATED: Chart data calculation using HistoricalPerformance
  const chartData = useMemo(() => {
    //console.log('[FearGreedBitcoinChart] ========== CHART DATA CALCULATION START ==========');
    //console.log('[FearGreedBitcoinChart] Selected timeframe:', selectedTimeframe);
    //console.log('[FearGreedBitcoinChart] Hourly performance history length:', hourlyPerformanceHistory?.length || 0);
    //console.log('[FearGreedBitcoinChart] Daily performance history length:', dailyPerformanceHistory?.length || 0);
    
    const now = new Date();

    const makeHourlyBuckets = (endUtcHour, hours) => {
      const buckets = {};
      const startMs = endUtcHour.getTime() - (hours - 1) * 60 * 60 * 1000;
      for (let i = 0; i < hours; i++) {
        const currentHourMs = startMs + i * 60 * 60 * 1000;
        const hourDate = new Date(currentHourMs);
        const key = new Date(Date.UTC(
          hourDate.getUTCFullYear(),
          hourDate.getUTCMonth(),
          hourDate.getUTCDate(),
          hourDate.getUTCHours()
        )).toISOString();
        buckets[key] = {
          timeKey: key,
          date: hourDate,
          displayLabel: hourDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                        hourDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
          fgLookupDate: new Date(currentHourMs + 30 * 60 * 1000),
          totalPnl: 0,
          tradeCount: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
          btcChange: 0,
          fgValue: null,
          fgClass: null
        };
      }
      return buckets;
    };

    const makeDailyBuckets = (endUtcMidnight, days) => {
      const buckets = {};
      const startMs = endUtcMidnight.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
      for (let i = 0; i < days; i++) {
        const currentDayMs = startMs + i * 24 * 60 * 60 * 1000;
        const dayDate = new Date(currentDayMs);
        const key = new Date(Date.UTC(
          dayDate.getUTCFullYear(),
          dayDate.getUTCMonth(),
          dayDate.getUTCDate()
        )).toISOString().split('T')[0];
        buckets[key] = {
          timeKey: key,
          date: dayDate,
          displayLabel: dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fgLookupDate: new Date(currentDayMs + 12 * 60 * 60 * 1000),
          totalPnl: 0,
          tradeCount: 0,
          winningTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
          btcChange: 0,
          fgValue: null,
          fgClass: null
        };
      }
      return buckets;
    };

    const isHourly = selectedTimeframe === '24h' || selectedTimeframe === '48h';
    const windowSize = selectedTimeframe === '24h' ? 24 : selectedTimeframe === '48h' ? 48 : (selectedTimeframe === '7d' ? 7 : 30);

    //console.log('[FearGreedBitcoinChart] Is hourly mode:', isHourly);
    //console.log('[FearGreedBitcoinChart] Window size:', windowSize);

    let buckets;
    if (isHourly) {
      const endUtcHour = new Date(now);
      endUtcHour.setUTCMinutes(0, 0, 0);
      buckets = makeHourlyBuckets(endUtcHour, windowSize);
      //console.log('[FearGreedBitcoinChart] Created', Object.keys(buckets).length, 'hourly buckets');
    } else {
      const endUtcMidnight = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ));
      buckets = makeDailyBuckets(endUtcMidnight, windowSize);
      //console.log('[FearGreedBitcoinChart] Created', Object.keys(buckets).length, 'daily buckets');
    }

    const hpSource = isHourly ? hourlyPerformanceHistory : dailyPerformanceHistory;
    const hasHP = Array.isArray(hpSource) && hpSource.length > 0;

    console.log('[FearGreedBitcoinChart] Has HistoricalPerformance data:', hasHP);
    console.log('[FearGreedBitcoinChart] HP Source length:', hpSource?.length || 0);

    if (hasHP) {
      // Use HistoricalPerformance data (same as DailyPerformanceChart)
      if (isHourly) {
        const deduped = dedupeByBucket(hpSource, 'hour');
        //console.log('[FearGreedBitcoinChart] Deduped hourly records:', deduped.length);
        //console.log('[FearGreedBitcoinChart] Sample deduped record:', deduped[0]);
        
        deduped.forEach((r, idx) => {
          const key = toBucketKey(r.snapshot_timestamp, 'hour');
          if (buckets[key]) {
            buckets[key].totalPnl = Number(r.period_pnl || 0);
            buckets[key].tradeCount = Number(r.period_trade_count || 0);
            buckets[key].winningTrades = Number(r.period_winning_trades || 0);
            buckets[key].grossProfit = Number(r.period_gross_profit || 0);
            buckets[key].grossLoss = Number(r.period_gross_loss || 0);
            
            if (idx < 5) { // Log first 5 for debugging
              /*console.log(`[FearGreedBitcoinChart] Populated hourly bucket ${idx}:`, {
                key,
                displayLabel: buckets[key].displayLabel,
                totalPnl: buckets[key].totalPnl,
                tradeCount: buckets[key].tradeCount,
                source_period_pnl: r.period_pnl
              });*/
            }
          } else {
            if (idx < 5) {
              //console.log(`[FearGreedBitcoinChart] WARNING: Key ${key} not found in buckets`);
            }
          }
        });
      } else {
        const deduped = dedupeByBucket(hpSource, 'day');
        //console.log('[FearGreedBitcoinChart] Deduped daily records:', deduped.length);
        //console.log('[FearGreedBitcoinChart] Sample deduped record:', deduped[0]);
        
        deduped.forEach((r, idx) => {
          const key = toBucketKey(r.snapshot_timestamp, 'day');
          if (buckets[key]) {
            buckets[key].totalPnl = Number(r.period_pnl || 0);
            buckets[key].tradeCount = Number(r.period_trade_count || 0);
            buckets[key].winningTrades = Number(r.period_winning_trades || 0);
            buckets[key].grossProfit = Number(r.period_gross_profit || 0);
            buckets[key].grossLoss = Number(r.period_gross_loss || 0);
            
            if (idx < 5) { // Log first 5 for debugging
              /*console.log(`[FearGreedBitcoinChart] Populated daily bucket ${idx}:`, {
                key,
                displayLabel: buckets[key].displayLabel,
                totalPnl: buckets[key].totalPnl,
                tradeCount: buckets[key].tradeCount,
                source_period_pnl: r.period_pnl
              });*/
            }
          } else {
            if (idx < 5) {
              //console.log(`[FearGreedBitcoinChart] WARNING: Key ${key} not found in buckets`);
            }
          }
        });
      }
    } else {
      // Fallback: aggregate from trades (same logic as DailyPerformanceChart)
      //console.log('[FearGreedBitcoinChart] No HistoricalPerformance data, falling back to trade aggregation');
      let startDateForIteration;
      if (isHourly) {
        startDateForIteration = new Date(now.getTime() - windowSize * 60 * 60 * 1000);
        startDateForIteration.setUTCHours(startDateForIteration.getUTCHours(), 0, 0, 0);
      } else {
        startDateForIteration = new Date(now.getTime() - windowSize * 24 * 60 * 60 * 1000);
        startDateForIteration.setUTCHours(0, 0, 0, 0);
      }

      const filteredTrades = (trades || []).filter(trade => {
        const t = new Date(trade.exit_timestamp);
        return t.getTime() >= startDateForIteration.getTime();
      });

      //console.log('[FearGreedBitcoinChart] Filtered trades for aggregation:', filteredTrades.length);

      filteredTrades.forEach((trade) => {
        const t = new Date(trade.exit_timestamp);
        const key = isHourly
          ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours())).toISOString()
          : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())).toISOString().split('T')[0];

        if (buckets[key]) {
          const pnl = Number(trade.pnl_usdt || 0);
          buckets[key].totalPnl += pnl;
          buckets[key].tradeCount += 1;
          if (pnl > 0) {
            buckets[key].winningTrades += 1;
            buckets[key].grossProfit += pnl;
          } else {
            buckets[key].grossLoss += Math.abs(pnl);
          }
        }
      });
    }

    // Attach Fear & Greed and BTC change to each bucket
    const currentBtcChange = bitcoinPrices.change24h || 0;
    Object.keys(buckets).forEach((k) => {
      const period = buckets[k];

      const historicalFG = findClosestFearGreed(period.fgLookupDate);
      if (historicalFG) {
        period.fgValue = parseInt(historicalFG.value);
        period.fgClass = historicalFG.value_classification;
      } else {
        const dateObj = isHourly ? new Date(k) : new Date(`${k}T12:00:00.000Z`);
        const dayOfWeek = dateObj.getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        period.fgValue = Math.round(50 + (Math.random() - 0.5) * (isWeekend ? 60 : 40));
        period.fgClass = period.fgValue < 25 ? 'Extreme Fear' :
                                        period.fgValue < 45 ? 'Fear' :
                                        period.fgValue < 55 ? 'Neutral' :
                                        period.fgValue < 75 ? 'Greed' : 'Extreme Greed';
      }

      // BTC change simulation (can be replaced with historical data)
      if (isHourly) {
        const hour = period.fgLookupDate.getUTCHours();
        const isVolatileHour = hour >= 13 && hour <= 21;
        const baseVariation = isVolatileHour ? 2 : 1;
        period.btcChange = (Math.random() - 0.5) * baseVariation * (Math.random() > 0.7 ? 1.5 : 1);
      } else {
        const dayVariation = (Math.random() - 0.5) * 4;
        period.btcChange = (currentBtcChange * 0.3) + dayVariation;
      }
    });

    const result = Object.values(buckets).sort((a, b) => a.date.getTime() - b.date.getTime());
    
    //console.log('[FearGreedBitcoinChart] Final chart data:', result.length, 'buckets');
    //console.log('[FearGreedBitcoinChart] Sample final buckets (first 5):');
    result.slice(0, 5).forEach((bucket, idx) => {
      console.log(`  Bucket ${idx}:`, {
        displayLabel: bucket.displayLabel,
        totalPnl: bucket.totalPnl,
        tradeCount: bucket.tradeCount,
        fgValue: bucket.fgValue,
        btcChange: bucket.btcChange
      });
    });
    /*console.log('[FearGreedBitcoinChart] P&L range:', {
      min: Math.min(...result.map(r => r.totalPnl)),
      max: Math.max(...result.map(r => r.totalPnl))
    });*/
    //console.log('[FearGreedBitcoinChart] ========== CHART DATA CALCULATION END ==========');
    
    return result;
  }, [
    selectedTimeframe,
    trades,
    hourlyPerformanceHistory,
    dailyPerformanceHistory,
    dedupeByBucket,
    toBucketKey,
    bitcoinPrices,
    findClosestFearGreed
  ]);

  // Calculate dynamic Y-axis range for Fear & Greed
  const fearGreedRange = useMemo(() => {
    if (!chartData || chartData.length === 0) return [0, 100];

    const validValues = chartData
      .map(d => d.fgValue)
      .filter(val => val !== null && val !== undefined);

    if (validValues.length === 0) return [0, 100];

    const min = Math.min(...validValues);
    const max = Math.max(...validValues);

    const padding = (max - min) * 0.1;
    return [Math.max(0, min - padding), Math.min(100, max + padding)];
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;

      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-medium mb-2">{`${selectedTimeframe === '24h' || selectedTimeframe === '48h' ? 'Hour' : 'Date'}: ${data.displayLabel}`}</p>
          <p className="text-sm" style={{ color: data.totalPnl >= 0 ? '#10b981' : '#ef4444' }}>
            {`Total P&L: $${data.totalPnl.toFixed(2)}`}
          </p>
          <p className="text-sm" style={{ color: '#f59e0b' }}>
            {`BTC Change: ${data.btcChange >= 0 ? '+' : ''}${data.btcChange.toFixed(2)}%`}
          </p>
          <p className="text-sm" style={{ color: '#10b981' }}>
            {`Fear & Greed: ${data.fgValue || 'N/A'} ${data.fgClass ? `(${data.fgClass})` : ''}`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{`Trades: ${data.tradeCount}`}</p>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Fear & Greed vs Bitcoin Price Movement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-muted-foreground">Loading Fear & Greed data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Fear & Greed vs Bitcoin Price Movement & P&L
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTimeframe} onValueChange={setSelectedTimeframe} className="mb-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="24h">24 Hours</TabsTrigger>
            <TabsTrigger value="48h">48 Hours</TabsTrigger>
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-gray-200 dark:stroke-gray-700" />

              <XAxis
                dataKey="displayLabel"
                tick={{ fill: 'currentColor', fontSize: 12 }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
              />

              <YAxis
                yAxisId="pnl"
                tick={{ fill: 'currentColor' }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
              />

              <YAxis
                yAxisId="percentage"
                orientation="right"
                tick={{ fill: 'currentColor' }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
                label={{ value: 'BTC Change (%) / F&G Index', angle: 90, position: 'insideRight' }}
                domain={[
                  Math.min(fearGreedRange[0], -10),
                  Math.max(fearGreedRange[1], 10)
                ]}
              />

              <Tooltip content={<CustomTooltip />} />
              <Legend />

              <ReferenceLine yAxisId="pnl" y={0} stroke="#666" strokeDasharray="2 2" />
              <ReferenceLine yAxisId="percentage" y={0} stroke="#666" strokeDasharray="2 2" />

              <Bar
                yAxisId="pnl"
                dataKey="totalPnl"
                name={`${selectedTimeframe === '24h' || selectedTimeframe === '48h' ? 'Hourly' : 'Daily'} P&L ($)`}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.totalPnl >= 0 ? '#10b981' : '#ef4444'}
                  />
                ))}
              </Bar>

              <Line
                yAxisId="percentage"
                type="monotone"
                dataKey="btcChange"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                name="BTC Price Change (%)"
              />

              <Line
                yAxisId="percentage"
                type="monotone"
                dataKey="fgValue"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                name="Fear & Greed Index"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Stats */}
        {chartData.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Avg {selectedTimeframe === '24h' || selectedTimeframe === '48h' ? 'Hourly' : 'Daily'} P&L
              </div>
              <div className="text-lg font-semibold text-blue-500">
                ${(chartData.reduce((sum, d) => sum + d.totalPnl, 0) / chartData.length).toFixed(2)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Current BTC Price</div>
              <div className="text-lg font-semibold text-orange-500">
                ${bitcoinPrices.currentPrice ? Number(bitcoinPrices.currentPrice).toLocaleString() : 'Loading...'}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">BTC 24h Change</div>
              <div className={`text-lg font-semibold ${bitcoinPrices.change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {bitcoinPrices.change24h ? `${bitcoinPrices.change24h >= 0 ? '+' : ''}${bitcoinPrices.change24h.toFixed(2)}%` : 'Loading...'}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="text-sm text-gray-500 dark:text-gray-400">Current Fear & Greed</div>
              <div className="text-lg font-semibold text-green-500">
                {fearGreedData[0]?.value || 'N/A'}
                <span className="text-sm ml-1">
                  ({fearGreedData[0]?.value_classification || 'N/A'})
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Analysis Insights */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Market Sentiment Analysis</h4>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            This chart correlates your {selectedTimeframe === '24h' || selectedTimeframe === '48h' ? 'hourly' : 'daily'} P&L with Bitcoin price movements and the Fear & Greed Index.
            Look for patterns where extreme fear/greed levels coincide with your trading performance to identify
            optimal market sentiment conditions for your strategies.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}