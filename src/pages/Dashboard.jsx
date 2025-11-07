import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import PerformanceMetrics from "@/components/dashboard/PerformanceMetrics";
import ActiveDeals from "@/components/dashboard/ActiveDeals";
import RecentTrades from "@/components/dashboard/RecentTrades";
import { queueEntityCall } from '@/components/utils/apiQueue';
import { useWallet } from '@/components/providers/WalletProvider'; // Import the wallet provider hook

export default function Dashboard() {
    // --- State Hooks ---
    const [recentTrades, setRecentTrades] = useState([]);
    const [tradesLoading, setTradesLoading] = useState(true);
    const [error, setError] = useState(null);

    // FIXED: Use WalletProvider data exclusively
    const { 
        totalEquity = 0, 
        availableBalance = 0, 
        totalRealizedPnl = 0, 
        unrealizedPnl = 0,
        isLoading: walletLoading = true 
    } = useWallet();

    console.log(`[inconsist_Dashboard] Using WalletProvider data:`, {
        totalEquity, availableBalance, totalRealizedPnl, unrealizedPnl, walletLoading
    });

    // --- Data Fetching ---
    const fetchRecentTrades = useCallback(async () => {
        try {
            setTradesLoading(true);
            const tradesData = await queueEntityCall('Trade', 'list', '-exit_timestamp', 10);
            setRecentTrades(tradesData || []);
        } catch (err) {
            console.error("Error fetching recent trades:", err);
            setError("Failed to load recent trades.");
        } finally {
            setTradesLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRecentTrades();
    }, [fetchRecentTrades]);

    // Listen for global trade data refresh events
    useEffect(() => {
        const handleTradeRefresh = () => {
            console.log('[Dashboard] 🔄 Received tradeDataRefresh event, refreshing recent trades...');
            fetchRecentTrades();
        };
        
        window.addEventListener('tradeDataRefresh', handleTradeRefresh);
        return () => {
            window.removeEventListener('tradeDataRefresh', handleTradeRefresh);
        };
    }, [fetchRecentTrades]);

    // --- Memoized Values & Calculations ---
    const overallPnl = (totalRealizedPnl || 0) + (unrealizedPnl || 0);
    
    // FIXED: Safe number formatting with proper null checks
    const formatCurrency = (value) => {
        const numValue = Number(value || 0);
        if (isNaN(numValue)) return '$0.00';
        return numValue.toLocaleString('en-US', { 
            style: 'currency', 
            currency: 'USD',
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        });
    };

    // --- Render Logic ---
    if (error) {
        return <div className="text-center text-red-500">{error}</div>;
    }

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Dashboard</h1>

            {/* Main Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Equity</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {walletLoading ? (
                            <div className="h-8 bg-gray-200 rounded w-1/2 animate-pulse"></div>
                        ) : (
                            <div className="text-2xl font-bold">{formatCurrency(totalEquity)}</div>
                        )}
                        <p className="text-xs text-muted-foreground">Available Cash: {formatCurrency(availableBalance)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                         {walletLoading ? (
                            <div className="h-8 bg-gray-200 rounded w-1/2 animate-pulse"></div>
                        ) : (
                            <div className={`text-2xl font-bold ${(unrealizedPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(unrealizedPnl)}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">From open positions</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Overall P&L</CardTitle>
                        {overallPnl >= 0 ? <TrendingUp className="h-4 w-4 text-muted-foreground" /> : <TrendingDown className="h-4 w-4 text-muted-foreground" />}
                    </CardHeader>
                    <CardContent>
                        {walletLoading ? (
                            <div className="h-8 bg-gray-200 rounded w-1/2 animate-pulse"></div>
                        ) : (
                            <div className={`text-2xl font-bold ${overallPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {overallPnl >= 0 ? '+' : ''}{formatCurrency(overallPnl)}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">Realized + Unrealized P&L</p>
                    </CardContent>
                </Card>
            </div>

            {/* Performance Metrics */}
            <PerformanceMetrics />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Active Deals / Open Positions */}
                <ActiveDeals />
                
                {/* Recent Trades History */}
                <RecentTrades trades={recentTrades} />
            </div>
        </div>
    );
}