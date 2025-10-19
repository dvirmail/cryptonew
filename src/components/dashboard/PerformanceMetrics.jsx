import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DollarSign, TrendingUp, CheckCircle } from "lucide-react";
import { useWallet } from '@/components/providers/WalletProvider'; // Import the wallet provider hook

export default function PerformanceMetrics() {
  // UPDATED: All data is now sourced from the central WalletProvider
  const {
    winRate = 0,
    profitFactor = 0,
    totalRealizedPnl = 0,
    winningTradesCount = 0,
    totalTradesCount = 0,
    totalGrossProfit = 0,
    totalGrossLoss = 0,
    isLoading,
  } = useWallet();

  // --- Loading State ---
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // --- Formatting Helpers ---
  const formatCurrency = (value) => {
    const numValue = Number(value || 0);
    if (isNaN(numValue)) return '$0';
    return numValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const safeToFixed = (value, decimals = 1) => {
    const numValue = Number(value || 0);
    if (isNaN(numValue)) return (0).toFixed(decimals);
    return numValue.toFixed(decimals);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{safeToFixed(winRate)}%</div>
          <p className="text-xs text-muted-foreground">
            {winningTradesCount} winning trades out of {totalTradesCount}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Profit Factor</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${profitFactor >= 1 ? 'text-green-600' : 'text-red-600'}`}>
            {isFinite(profitFactor) ? safeToFixed(profitFactor, 2) : '∞'}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(totalGrossProfit)} / {formatCurrency(totalGrossLoss)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Realized P&L</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${totalRealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalRealizedPnl)}
          </div>
          <p className="text-xs text-muted-foreground">From {totalTradesCount} closed trades</p>
        </CardContent>
      </Card>
    </div>
  );
}