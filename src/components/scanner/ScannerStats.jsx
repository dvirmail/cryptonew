
import React, { useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Wallet, Package, TrendingUp, HelpCircle, Activity, Clock } from 'lucide-react';
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from '@/components/providers/WalletProvider';

export default function ScannerStats({ stats = {} }) {
    const { isLiveMode } = useTradingMode();
    const {
        walletSummary,
        totalEquity,
        availableBalance,
        balanceInTrades,
        openPositionsCount,
        loading,
        error
    } = useWallet();

    const formatCurrency = useCallback(
        (value) => `$${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        []
    );

    const formatTime = useCallback((ms) => {
        if (!ms || ms === 0) return 'N/A';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    }, []);

    const metrics = useMemo(() => ([
        { title: "Total Equity", value: formatCurrency(totalEquity), icon: Wallet, gridClass: "md:col-span-1" },
        { title: "Available Balance", value: formatCurrency(availableBalance), icon: DollarSign, gridClass: "md:col-span-1" },
        { title: "Balance in Trades", value: formatCurrency(balanceInTrades), icon: Package, gridClass: "md:col-span-1" },
        { title: "Open Positions", value: openPositionsCount ?? 'N/A', icon: TrendingUp, gridClass: "md:col-span-1" },
    ]), [totalEquity, availableBalance, balanceInTrades, openPositionsCount, formatCurrency]);

    const cycleMetrics = useMemo(() => {
        return [
            { 
                title: "Total Scan Cycles", 
                value: stats?.totalScanCycles ?? 0, 
                icon: Activity,
                subtitle: `${stats?.totalScans ?? 0} total scans`
            },
            { 
                title: "Avg Scan Time", 
                value: formatTime(stats?.averageScanTimeMs), 
                icon: Clock,
                subtitle: stats?.lastScanTimeMs ? `Last: ${formatTime(stats.lastScanTimeMs)}` : 'Waiting for first scan...'
            },
        ];
    }, [stats, formatTime]);

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <div className="h-4 bg-gray-300 rounded w-20"></div>
                            </CardHeader>
                            <CardContent>
                                <div className="h-8 bg-gray-300 rounded w-28"></div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {[...Array(2)].map((_, i) => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <div className="h-4 bg-gray-300 rounded w-24"></div>
                            </CardHeader>
                            <CardContent>
                                <div className="h-8 bg-gray-300 rounded w-20"></div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    if (!walletSummary || error) {
        return (
            <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {[{ title: "Total Equity" }, { title: "Available Balance" }, { title: "Balance in Trades" }, { title: "Open Positions" }].map((m, i) => (
                        <Card key={i}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">{m.title}</CardTitle>
                                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">No Data</div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {cycleMetrics.map((metric) => (
                        <Card key={metric.title}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                                <metric.icon className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{metric.value}</div>
                                {metric.subtitle && (
                                    <p className="text-xs text-muted-foreground mt-1">{metric.subtitle}</p>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Wallet Metrics - 4 columns */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {metrics.map((metric) => (
                    <Card key={metric.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                            <metric.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{metric.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Scan Cycle Metrics - 2 columns */}
            <div className="grid gap-4 md:grid-cols-2">
                {cycleMetrics.map((metric) => (
                    <Card key={metric.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                            <metric.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{metric.value}</div>
                            {metric.subtitle && (
                                <p className="text-xs text-muted-foreground mt-1">{metric.subtitle}</p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
