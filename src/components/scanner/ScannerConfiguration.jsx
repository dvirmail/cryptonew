
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Save, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getAutoScannerService } from "@/components/services/AutoScannerService";
import { formatUSDT } from "@/components/utils/priceFormatter";
import { useWallet } from '@/components/providers/WalletProvider';

// FIX: align props with AutoScan page and keep backward compatibility
export default function ScannerConfiguration({
    config,
    onConfigChange,
    onSaveConfig,   // AutoScan passes this
    onSave,         // fallback (legacy)
    saving,         // AutoScan passes this
    isSaving,       // fallback (legacy)
    ...rest         // other props like isLoadingConfig, currentTradingMode, etc.
}) {
    const [localConfig, setLocalConfig] = useState(config || {});

    const scanner = React.useMemo(() => getAutoScannerService(), []);
    const [investCap, setInvestCap] = useState(() => {
        const s = scanner.getState();
        return (s?.settings?.maxBalanceInvestCapUSDT ?? 0);
    });
    const [currentInvested, setCurrentInvested] = useState(() => {
        const s = scanner.getState();
        return Number(s?.walletSummary?.balance_in_trades || 0);
    });

    const { balanceInTrades: walletBalanceInTrades = 0, totalEquity: walletTotalEquity = 0 } = useWallet() || {};

    useEffect(() => {
        const unsubscribe = scanner.subscribe((state) => {
            setInvestCap(state?.settings?.maxBalanceInvestCapUSDT ?? 0);
            setCurrentInvested(Number(state?.walletSummary?.balance_in_trades || 0));
        });
        return () => { if (unsubscribe) unsubscribe(); };
    }, [scanner]);


    useEffect(() => {
        if (config) {
            setLocalConfig(config);
        }
    }, [config]);

    // FIX: call onConfigChange with (field, value) to match AutoScan.handleConfigChange
    const handleChange = (field, value) => {
        const updatedConfig = { ...localConfig, [field]: value };
        setLocalConfig(updatedConfig);
        if (typeof onConfigChange === 'function') {
            onConfigChange(field, value);
        }
    };

    const handleSliderChange = (field, values) => {
        handleChange(field, values[0]);
    };

    const handleInvestCapBlur = async () => {
        const valueNum = Number(investCap);
        await scanner.updateSettings({ maxBalanceInvestCapUSDT: Number.isFinite(valueNum) && valueNum >= 0 ? valueNum : 0 });
    };

    // FIX: support either onSaveConfig or onSave
    const effectiveOnSave = typeof onSaveConfig === 'function' ? onSaveConfig : onSave;
    const handleSave = () => {
        if (effectiveOnSave) {
            effectiveOnSave(localConfig);
        }
    };

    const isSavingEffective = Boolean(isSaving ?? saving);

    const displayInvested = Number.isFinite(Number(walletBalanceInTrades)) && Number(walletBalanceInTrades) >= 0
        ? Number(walletBalanceInTrades)
        : Number(currentInvested || 0);

    const capNum = Number(investCap) || 0;
    const usedPct = capNum > 0 ? Math.min(100, Math.max(0, (displayInvested / capNum) * 100)) : 0;
    const investedOfTotalPct = walletTotalEquity > 0 ? Math.min(100, Math.max(0, (displayInvested / walletTotalEquity) * 100)) : 0;
    const remaining = capNum > 0 ? Math.max(0, capNum - displayInvested) : 0;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>⚙️ Global Scanner Settings</CardTitle>
                            <CardDescription>
                                These settings apply to the scanner's core logic. Changes will be saved globally.
                            </CardDescription>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                            {localConfig.binance_mode?.toUpperCase() || 'TESTNET'} MODE
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Scan Frequency */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="scanFrequency">Scan Frequency (ms)</Label>
                            <Input
                                id="scanFrequency"
                                type="number"
                                value={localConfig.scanFrequency || 60000}
                                onChange={(e) => handleChange('scanFrequency', parseInt(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                How often the scanner runs, in milliseconds (e.g., 60000 = 1 minute).
                            </p>
                        </div>

                        {/* Minimum Combined Strength */}
                        <div className="space-y-2">
                            <Label htmlFor="minimumCombinedStrength">Minimum Combined Strength</Label>
                            <Input
                                id="minimumCombinedStrength"
                                type="number"
                                value={localConfig.minimumCombinedStrength || 300}
                                onChange={(e) => handleChange('minimumCombinedStrength', parseInt(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                The minimum sum of all signal strengths required to trigger a trade.
                            </p>
                        </div>
                    </div>

                    {/* Max Positions and Minimum Trade Value */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="maxPositions">Max Positions per Strategy</Label>
                            <Input
                                id="maxPositions"
                                type="number"
                                value={localConfig.maxPositions || 1}
                                onChange={(e) => handleChange('maxPositions', parseInt(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Maximum number of concurrent positions per strategy (not total positions).
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="minimumTradeValue">Minimum Trade Value (USDT)</Label>
                            <Input
                                id="minimumTradeValue"
                                type="number"
                                value={localConfig.minimumTradeValue || 20}
                                onChange={(e) => handleChange('minimumTradeValue', parseFloat(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Minimum trade size in USDT to prevent dust trades.
                            </p>
                        </div>
                    </div>

                    {/* Position Sizing Toggle */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="useWinStrategySize"
                                checked={localConfig.useWinStrategySize !== false}
                                onCheckedChange={(checked) => handleChange('useWinStrategySize', checked)}
                            />
                            <Label htmlFor="useWinStrategySize" className="cursor-pointer">
                                Use Volatility-Adjusted Position Sizing
                            </Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Info className="w-4 h-4 text-gray-400" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p className="max-w-xs">
                                            When enabled, position sizes are calculated based on ATR volatility and risk percentage.
                                            When disabled, uses fixed position sizes with conviction-based adjustments.
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>

                    {/* Position Sizing Configuration */}
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-4">
                        <h3 className="font-semibold text-green-900 dark:text-green-100">Position Sizing Configuration</h3>
                        
                        {/* Base Position Size - Always visible for LPM system */}
                        <div className="space-y-2">
                            <Label htmlFor="basePositionSize">Base Position Size (USDT)</Label>
                            <Input
                                id="basePositionSize"
                                type="number"
                                min="10"
                                max="10000"
                                step="10"
                                value={localConfig.basePositionSize || 100}
                                onChange={(e) => handleChange('basePositionSize', parseFloat(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                Base position size in USDT. The LPM system will adjust this size based on market conditions and performance.
                            </p>
                        </div>

                        {/* Fixed Position Sizing - Only when Win Strategy is disabled */}
                        {!localConfig.useWinStrategySize && (
                            <div className="space-y-2">
                                <Label htmlFor="defaultPositionSize">Fixed Position Size (USDT)</Label>
                                <Input
                                    id="defaultPositionSize"
                                    type="number"
                                    value={localConfig.defaultPositionSize || 100}
                                    onChange={(e) => handleChange('defaultPositionSize', parseFloat(e.target.value))}
                                    className="font-mono"
                                />
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                    Fixed position size in USDT, adjusted by conviction score (only used when Win Strategy sizing is disabled).
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Max Balance Percent Risk - Effective Balance Risk Cap */}
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg space-y-4">
                        <h3 className="font-semibold text-yellow-900 dark:text-yellow-100">Effective Balance Risk Configuration</h3>
                        <div className="space-y-2">
                            <Label htmlFor="maxBalancePercentRisk">Max Balance Percent Risk (%)</Label>
                            <Input
                                id="maxBalancePercentRisk"
                                type="number"
                                min="10"
                                max="100"
                                step="5"
                                value={localConfig.maxBalancePercentRisk ?? 100}
                                onChange={(e) => handleChange('maxBalancePercentRisk', parseFloat(e.target.value))}
                                className="font-mono"
                            />
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                Maximum effective balance risk percentage (10-100%). This caps the "Effective Balance Risk" shown in the dashboard, 
                                regardless of momentum score. Acts as a safety mechanism to prevent excessive position sizes. 
                                Default: 100% (no restriction). Your current value: {localConfig.maxBalancePercentRisk ?? 100}%
                            </p>
                        </div>
                    </div>

                    {/* NEW: Absolute cap control, place near percent risk section and before quality filters */}
                    <div className="rounded-lg border bg-blue-50/50 p-4 mt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="maxBalanceInvestCapUSDT" className="text-gray-700">Max Balance to Invest (USDT)</Label>
                                <p className="text-sm text-gray-500 mt-1">
                                    Hard cap on total capital invested across open positions. Set 0 for unlimited.
                                </p>
                                {/* Current investment text from WalletProvider (same as widgets) */}
                                <p className="text-xs text-gray-600 mt-2">
                                    Currently invested: <span className="font-semibold">{formatUSDT(displayInvested, { minDecimals: 2, maxDecimals: 2 })}</span>
                                    {capNum > 0 && (
                                        <>
                                            {" "}({usedPct.toFixed(1)}% of cap)
                                            {" • "}Remaining: <span className="font-semibold">{formatUSDT(remaining, { minDecimals: 2, maxDecimals: 2 })}</span>
                                        </>
                                    )}
                                    {" • "}Portfolio: <span className="font-semibold">{investedOfTotalPct.toFixed(1)}%</span>
                                </p>
                            </div>
                            <div className="w-40">
                                <Input
                                    id="maxBalanceInvestCapUSDT"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={investCap}
                                    onChange={(e) => setInvestCap(e.target.value)}
                                    onBlur={handleInvestCapBlur}
                                    className="text-right"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Quality Filters Section */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Quality Filters</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Minimum Regime Confidence */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <Label htmlFor="minimumRegimeConfidence">Minimum Regime Confidence (%)</Label>
                                    <span className="text-sm font-semibold">{localConfig.minimumRegimeConfidence || 60}%</span>
                                </div>
                                <Slider
                                    id="minimumRegimeConfidence"
                                    value={[localConfig.minimumRegimeConfidence || 60]}
                                    onValueChange={(values) => handleSliderChange('minimumRegimeConfidence', values)}
                                    min={0}
                                    max={100}
                                    step={5}
                                    className="w-full"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Strategies will only be evaluated when market regime confidence meets this threshold.
                                </p>
                            </div>

                            {/* Minimum Conviction Score */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <Label htmlFor="minimumConvictionScore">Minimum Conviction Score (%)</Label>
                                    <span className="text-sm font-semibold">{localConfig.minimumConvictionScore || 50}%</span>
                                </div>
                                <Slider
                                    id="minimumConvictionScore"
                                    value={[localConfig.minimumConvictionScore || 50]}
                                    onValueChange={(values) => handleSliderChange('minimumConvictionScore', values)}
                                    min={0}
                                    max={100}
                                    step={5}
                                    className="w-full"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Only positions with conviction scores above this threshold will be opened.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Regime Controls */}
                    <div className="space-y-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="blockTradingInDowntrend"
                                    checked={!!localConfig.blockTradingInDowntrend}
                                    onCheckedChange={(checked) => handleChange('blockTradingInDowntrend', checked)}
                                />
                                <div>
                                    <Label htmlFor="blockTradingInDowntrend" className="cursor-pointer">
                                        Block trading when market regime is Downtrend
                                    </Label>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                                        <Info className="w-3.5 h-3.5" />
                                        When enabled, the scanner will not open new positions during downtrend regime detection.
                                    </p>
                                </div>
                            </div>
                            {localConfig.blockTradingInDowntrend && (
                                <Badge variant="destructive" className="shrink-0">Downtrend Block Active</Badge>
                            )}
                        </div>
                    </div>

                    {/* Save Button */}
                    <div className="pt-6 border-t">
                        <Button
                            onClick={handleSave}
                            disabled={isSavingEffective}
                            className="w-full md:w-auto"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isSavingEffective ? 'Saving...' : 'Save Configuration'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
