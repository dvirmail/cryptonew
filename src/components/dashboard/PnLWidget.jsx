import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, History, DollarSign } from 'lucide-react';
import { useWallet } from '@/components/providers/WalletProvider'; // Import wallet provider hook

export default function PnLWidget() {
    // UPDATED: All P&L data now sourced from central WalletProvider
    const {
        unrealizedPnl = 0,
        totalRealizedPnl = 0,
        totalTradesCount = 0,
        isLoading
    } = useWallet();

    const formatCurrency = (value) => {
        const numValue = Number(value || 0);
        return numValue.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
        });
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader><CardTitle>P&L Summary</CardTitle></CardHeader>
                <CardContent className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
                    <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
                    <div className="h-6 bg-gray-200 rounded w-2/3"></div>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">P&L Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                        {unrealizedPnl >= 0 ? <TrendingUp className="h-5 w-5 text-green-500" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
                        <span>Unrealized P&L</span>
                    </div>
                    <span className={`font-semibold ${unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {formatCurrency(unrealizedPnl)}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                        <DollarSign className="h-5 w-5 text-blue-500" />
                        <span>All-Time P&L</span>
                    </div>
                    <span className={`font-semibold ${totalRealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {formatCurrency(totalRealizedPnl)}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                        <History className="h-5 w-5 text-gray-500" />
                        <span>Total Trades</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">{totalTradesCount}</span>
                </div>
            </CardContent>
        </Card>
    );
}