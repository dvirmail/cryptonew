import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';

export default function AnalyticsMetrics({ performanceData }) {
    if (!performanceData) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Overall Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/3 mb-3"></div>
                                <div className="h-8 bg-gray-200 dark:bg-gray-600 rounded w-1/2 mb-2"></div>
                                <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-2/3"></div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }
    
    const {
        cumulative_realized_pnl,
        cumulative_trade_count,
        cumulative_winning_trades,
        cumulative_gross_profit,
        cumulative_gross_loss
    } = performanceData;

    const winRate = cumulative_trade_count > 0 ? (cumulative_winning_trades / cumulative_trade_count) * 100 : 0;
    const profitFactor = cumulative_gross_loss > 0 ? cumulative_gross_profit / cumulative_gross_loss : (cumulative_gross_profit > 0 ? Infinity : 0);

    const formatCurrency = (value) => (value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatNumber = (value) => (value || 0).toLocaleString();
    const formatPercent = (value) => `${(value || 0).toFixed(1)}%`;
    const formatRatio = (value) => isFinite(value) ? value.toFixed(2) : '∞';

    return (
        <Card>
            <CardHeader>
                <CardTitle>Overall Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <h3 className="text-sm font-medium">Total Realized P&L</h3>
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className={`text-2xl font-bold ${cumulative_realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(cumulative_realized_pnl)}
                        </div>
                        <p className="text-xs text-muted-foreground">From {formatNumber(cumulative_trade_count)} trades</p>
                    </div>

                    <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <h3 className="text-sm font-medium">Win Rate</h3>
                            <CheckCircle className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="text-2xl font-bold">{formatPercent(winRate)}</div>
                        <p className="text-xs text-muted-foreground">{formatNumber(cumulative_winning_trades)} winning trades</p>
                    </div>

                    <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <h3 className="text-sm font-medium">Profit Factor</h3>
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className={`text-2xl font-bold ${profitFactor >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatRatio(profitFactor)}
                        </div>
                        <p className="text-xs text-muted-foreground">Gross profit / gross loss</p>
                    </div>

                    <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <h3 className="text-sm font-medium">Total Trades</h3>
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="text-2xl font-bold">{formatNumber(cumulative_trade_count)}</div>
                        <p className="text-xs text-muted-foreground">Completed trades</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}