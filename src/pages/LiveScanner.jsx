
import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Pause,
  Settings,
  Activity,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  BarChart3,
  Zap,
  Shield,
  ExternalLink,
  DollarSign,
  Trash2,
} from "lucide-react";
import { ScanSettings } from "@/api/entities";
import { BacktestCombination } from "@/api/entities";
import { User } from "@/api/entities";
import { LiveWalletState } from "@/api/entities";
import { liveScannerService } from "@/components/services/liveScannerService";
import { testBinanceKeys } from "@/api/functions";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useToast } from "@/components/ui/use-toast";
import LogDisplay from '@/components/scanner/LogDisplay';
import { getAvailablePairs } from "@/components/utils/indicatorManager";

export default function LiveScanner() {
  const [isScannerRunning, setIsScannerRunning] = useState(false);
  const [hasApiKeys, setHasApiKeys] = useState(false);
  const [accountInfo, setAccountInfo] = useState(null);
  const [config, setConfig] = useState({
    scanFrequency: 300000,
    minimumCombinedStrength: 225,
    defaultPositionSize: 100,
    useWinStrategySize: true,
    maxPositions: 10,
    riskPerTrade: 2.0,
    portfolioHeatMax: 20,
    minimumTradeValue: 10
  });
  const [stats, setStats] = useState({
    totalScans: 0,
    signalsFound: 0,
    tradesExecuted: 0,
    successRate: 0,
    totalPnL: 0
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [activeStrategies, setActiveStrategies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [liveWallet, setLiveWallet] = useState(null);
  const { toast } = useToast();

  const fetchLiveWalletData = useCallback(async () => {
    try {
      const liveWalletStates = await LiveWalletState.list();
      if (liveWalletStates.length > 0) {
        const walletData = liveWalletStates[0];
        setLiveWallet(walletData);
        // Update available balance from liveWallet as it's the most current source
        setAvailableBalance(walletData.available_balance_usdt || 0);
      }
    } catch (error) {
      console.error("Error fetching live wallet:", error);
    }
  }, [setLiveWallet, setAvailableBalance]);

  useEffect(() => {
    // Connect to the service to get live updates for logs and status
    const handleScannerUpdate = () => {
        setIsScannerRunning(liveScannerService.getIsRunning());
        setRecentActivity(liveScannerService.getRecentActivity());
        setStats(liveScannerService.getStats());
    };
    const unsubscribe = liveScannerService.on('update', handleScannerUpdate);
    handleScannerUpdate(); // Initial call to set state correctly

    const checkApiKeysAndLoadData = async () => {
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.binance_api_key) {
                setHasApiKeys(false);
                setIsLoading(false);
                return;
            }
            setHasApiKeys(true);

            const response = await testBinanceKeys({});
            if (response.data.success) {
                setAccountInfo(response.data.accountInfo);
                const usdtBalance = response.data.accountInfo.balances?.find(b => b.asset === 'USDT');
                setAvailableBalance(usdtBalance ? parseFloat(usdtBalance.free) : 0);
            }

            await loadScannerData();
            await fetchLiveWalletData();
        } catch (error) {
            console.error("Error loading data:", error);
            toast({
                title: "Error",
                description: "Failed to load scanner data",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    checkApiKeysAndLoadData();

    // Fetch wallet data periodically to keep stats fresh
    const walletInterval = setInterval(fetchLiveWalletData, 30000);

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      clearInterval(walletInterval);
    };
  }, [fetchLiveWalletData, toast]);

  const loadScannerData = async () => {
    try {
      const [settingsData, combinationsData] = await Promise.all([
        ScanSettings.list(),
        BacktestCombination.filter({ includedInScanner: true })
      ]);

      if (settingsData.length > 0) {
        setConfig(settingsData[0]);
      }

      setActiveStrategies(combinationsData);
    } catch (error) {
      console.error("Error loading scanner data:", error);
    }
  };

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveConfig = async () => {
    try {
      const settingsData = await ScanSettings.list();

      if (settingsData.length > 0) {
        await ScanSettings.update(settingsData[0].id, config);
      } else {
        await ScanSettings.create(config);
      }

      toast({
        title: "Settings Saved",
        description: "Live scanner configuration has been updated",
        variant: "success"
      });
    } catch (error) {
      console.error("Error saving config:", error);
      toast({
        title: "Error",
        description: "Failed to save configuration",
        variant: "destructive"
      });
    }
  };

  const handleStartLiveScanner = async () => {
    if (!hasApiKeys || activeStrategies.length === 0) {
      toast({
        title: "Cannot Start Scanner",
        description: !hasApiKeys ? "Please configure your Binance API keys first." : "No active strategies selected. Please enable strategies from the Backtest Combinations page.",
        variant: "destructive"
      });
      return;
    }

    try {
      await liveScannerService.start();
      setIsScannerRunning(true);
      toast({
        title: "Live Scanner Started",
        description: "Scanner is now monitoring markets and executing real trades.",
        variant: "success"
      });
      // Optionally re-fetch live wallet data and scanner stats after starting
      fetchLiveWalletData();
    } catch (error) {
      console.error("Error starting live scanner:", error);
      toast({
        title: "Error",
        description: "Failed to start live scanner: " + (error.response?.data?.message || error.message),
        variant: "destructive"
      });
    }
  };

  const handleStopLiveScanner = async () => {
    try {
      await liveScannerService.stop();
      setIsScannerRunning(false);
      toast({
        title: "Live Scanner Stopped",
        description: "Scanner has been stopped. Open positions remain active.",
        variant: "default"
      });
      // Optionally re-fetch live wallet data and scanner stats after stopping
      fetchLiveWalletData();
    } catch (error) {
      console.error("Error stopping live scanner:", error);
      toast({
        title: "Error",
        description: "Failed to stop live scanner: " + (error.response?.data?.message || error.message),
        variant: "destructive"
      });
    }
  };

  const handleToggleScanner = async () => {
    if (isScannerRunning) {
      await handleStopLiveScanner();
    } else {
      await handleStartLiveScanner();
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Loading live scanner...</p>
        </div>
      </div>
    );
  }

  if (!hasApiKeys) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Live Scanner</h1>
          <p className="text-muted-foreground">Automated trading with real money</p>
        </div>

        <Alert variant="destructive">
          <Shield className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              <strong>API Keys Required:</strong> Binance API keys must be configured before you can use live trading.
              This will execute real trades with your actual money.
            </span>
            <Link to={createPageUrl("BinanceSettings")}>
              <Button variant="outline" size="sm" className="ml-4 flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                Configure API Keys
              </Button>
            </Link>
          </AlertDescription>
        </Alert>

        <Card className="border-dashed border-red-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">Live Trading Not Available</h3>
            <p className="text-gray-500 text-center mb-4">
              Connect your Binance account to enable live automated trading.
              <strong className="text-red-600"> This will use real money!</strong>
            </p>
            <div className="flex gap-3">
              <Link to={createPageUrl("BinanceSettings")}>
                <Button className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Set Up API Keys
                </Button>
              </Link>
              <Link to={createPageUrl("AutoScan")}>
                <Button variant="outline" className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Use Demo Scanner
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Live Scanner</h1>
          <p className="text-muted-foreground">
            <span className="text-red-600 font-semibold">⚠️ REAL MONEY TRADING</span> - Automated trading with your Binance account
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge
            variant={isScannerRunning ? "destructive" : "secondary"}
            className="flex items-center gap-1"
          >
            {isScannerRunning ? <Activity className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {isScannerRunning ? "LIVE TRADING" : "STOPPED"}
          </Badge>
          <Button
            onClick={handleToggleScanner}
            className={isScannerRunning ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
          >
            {isScannerRunning ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                STOP LIVE TRADING
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                START LIVE TRADING
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Warning Alert */}
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>WARNING:</strong> This scanner uses real money from your Binance account.
          Monitor your trades carefully and ensure you understand the risks.
          Available balance: <strong>{formatCurrency(availableBalance)}</strong>
        </AlertDescription>
      </Alert>

      {/* Live Account Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Available Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(availableBalance)}
            </div>
            <p className="text-xs text-muted-foreground">USDT for trading</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{liveWallet?.active_positions_count || 0}</div>
            <p className="text-xs text-muted-foreground">Open live trades</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Strategies</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeStrategies.length}
            </div>
            <p className="text-xs text-muted-foreground">Enabled for live scan</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(liveWallet?.success_rate || 0).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Live trades</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Live P&L</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${liveWallet?.total_pnl_usdt >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(liveWallet?.total_pnl_usdt || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Real profit/loss</p>
          </CardContent>
        </Card>
      </div>

      {/* Account Information */}
      {accountInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Connected Binance Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400">Account Type</div>
                <div className="font-medium">{accountInfo.accountType}</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400">Trading Status</div>
                <div className="font-medium">{accountInfo.canTrade ? "Enabled" : "Disabled"}</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400">Permissions</div>
                <div className="flex gap-1 flex-wrap">
                  {accountInfo.permissions?.map((perm, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{perm}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Live Trading Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="scanFrequency">Scan Frequency (seconds)</Label>
                <Input
                  id="scanFrequency"
                  type="number"
                  min="30"
                  max="3600"
                  value={Math.round(config.scanFrequency / 1000)}
                  onChange={(e) => handleConfigChange('scanFrequency', parseInt(e.target.value) * 1000)}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">How often to scan for signals (30-3600 seconds)</p>
              </div>

              <div>
                <Label htmlFor="maxPositions">Max Concurrent Positions</Label>
                <Input
                  id="maxPositions"
                  type="number"
                  min="1"
                  max="50"
                  value={config.maxPositions}
                  onChange={(e) => handleConfigChange('maxPositions', parseInt(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Maximum concurrent positions per strategy (not total positions)</p>
              </div>

              <div>
                <Label htmlFor="riskPerTrade">Risk Per Trade (%)</Label>
                <Input
                  id="riskPerTrade"
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={config.riskPerTrade}
                  onChange={(e) => handleConfigChange('riskPerTrade', parseFloat(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Percentage of balance to risk per trade</p>
              </div>

              <div>
                <Label htmlFor="portfolioHeatMax">Portfolio Heat Limit (%)</Label>
                <Input
                  id="portfolioHeatMax"
                  type="number"
                  min="5"
                  max="50"
                  step="1"
                  value={config.portfolioHeatMax}
                  onChange={(e) => handleConfigChange('portfolioHeatMax', parseFloat(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Maximum total portfolio risk exposure</p>
              </div>

              <div>
                <Label htmlFor="defaultPositionSize">Default Position Size (USDT)</Label>
                <Input
                  id="defaultPositionSize"
                  type="number"
                  min="10"
                  max="10000"
                  step="10"
                  value={config.defaultPositionSize}
                  onChange={(e) => handleConfigChange('defaultPositionSize', parseFloat(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Fixed position size when Win Strategy sizing is disabled</p>
              </div>

              <div>
                <Label htmlFor="minimumTradeValue">Minimum Trade Value (USDT)</Label>
                <Input
                  id="minimumTradeValue"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={config.minimumTradeValue}
                  onChange={(e) => handleConfigChange('minimumTradeValue', parseFloat(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Minimum trade size to prevent dust trades</p>
              </div>

              <div>
                <Label htmlFor="minimumCombinedStrength">Minimum Combined Strength</Label>
                <Input
                  id="minimumCombinedStrength"
                  type="number"
                  min="50"
                  max="500"
                  step="25"
                  value={config.minimumCombinedStrength}
                  onChange={(e) => handleConfigChange('minimumCombinedStrength', parseFloat(e.target.value))}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">The minimum sum of all signal strengths required to trigger a trade.</p>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="useWinStrategySize"
                  checked={config.useWinStrategySize}
                  onCheckedChange={(checked) => handleConfigChange('useWinStrategySize', checked)}
                />
                <Label htmlFor="useWinStrategySize">Use Win Strategy Sizing</Label>
                <p className="text-xs text-gray-500">Use volatility-adjusted position sizing instead of fixed size</p>
              </div>
            </div>

            <Separator />

            <div className="flex justify-end">
              <Button onClick={handleSaveConfig} className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Save Live Configuration
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Live Activity Log
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => liveScannerService.clearLogs()}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Logs
            </Button>
          </div>
        </CardHeader>
        <CardContent>
           <LogDisplay logs={recentActivity} />
        </CardContent>
      </Card>
    </div>
  );
}
