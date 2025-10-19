
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWallet } from '@/components/providers/WalletProvider';
import { useLivePrices } from '@/components/utils/useLivePrices';
import { useToast } from '@/components/ui/use-toast';

// IMPORTANT: This is a MOCK positionManager for demonstration purposes.
// In a real application, you would import an actual service or API client.
// Example: import * as positionManager from '@/services/positionManager';
const positionManager = {
    manualClosePosition: async (id, symbol, entryPrice, quantity, currentPrice) => {
        console.warn("Using MOCK positionManager.manualClosePosition. Replace with actual implementation in production.");
        // Simulate an asynchronous API call
        return new Promise(resolve => setTimeout(() => {
            const success = Math.random() > 0.5; // Simulate success/failure
            if (success) {
                resolve({ success: true, message: `Mock: Position ${symbol} closed successfully.` });
            } else {
                const errorType = Math.random();
                if (errorType < 0.4) {
                    // Simulate an error requiring reconciliation (e.g., insufficient balance)
                    resolve({ success: false, error: "Mock: Binance - Insufficient balance detected.", requiresReconciliation: true });
                } else if (errorType < 0.7) {
                    // Simulate another specific Binance error
                    resolve({ success: false, error: "Mock: Binance - Order rejected by exchange rules." });
                } else {
                    // Simulate a generic error
                    resolve({ success: false, error: "Mock: A generic error occurred during position closure." });
                }
            }
        }, 1500)); // Simulate network latency
    }
};


export default function ActiveDeals() {
    // UPDATED: Use the new 'positions' property from WalletProvider and include refreshWallet
    const { positions: deals, loading: walletLoading, refreshWallet } = useWallet();
    const { toast } = useToast();
    const [isClosing, setIsClosing] = useState({}); // State to track which positions are currently being closed

    // UPDATED: symbolsToWatch is now derived from the deals themselves
    const symbolsToWatch = useMemo(() => {
        return deals.map(deal => deal.symbol?.replace('/', ''));
    }, [deals]);

    // Live prices are still needed for real-time P&L calculation
    const { prices: currentPrices } = useLivePrices(symbolsToWatch);

    const calculatePnl = (deal) => {
        const symbolKey = deal.symbol?.replace('/', '');
        const currentPrice = currentPrices[symbolKey] || deal.entry_price;
        if (!currentPrice) return { pnl: 0, pnlPercentage: 0 };
        
        const pnl = (currentPrice - deal.entry_price) * deal.quantity_crypto;
        const pnlPercentage = (pnl / deal.entry_value_usdt) * 100;
        return { pnl, pnlPercentage };
    };

    const handleClosePosition = async (position) => {
        // Prevent multiple simultaneous closing attempts for the same position
        if (isClosing[position.id]) {
            console.log(`Position ${position.id} is already being closed.`);
            return;
        }

        setIsClosing(prev => ({ ...prev, [position.id]: true }));

        try {
            // Ensure current price is available for closing order, fallback to entry price if not
            const priceForClosing = currentPrices[position.symbol.replace('/', '')] || position.entry_price;

            const result = await positionManager.manualClosePosition(
                position.id,
                position.symbol,
                position.entry_price, // entry_price might be needed for audit/record
                position.quantity_crypto,
                priceForClosing // Use the most current price for the closing order
            );

            if (result.success) {
                toast({
                    title: "Position Closed",
                    description: result.message,
                    variant: "default"
                });
                
                // Refresh wallet data to reflect the closed position
                await refreshWallet();
            } else {
                // ENHANCED: Show specific error message from Binance or backend
                toast({
                    title: "Failed to Close Position",
                    description: result.error || "An error occurred while closing the position.",
                    variant: "destructive"
                });

                // If reconciliation is needed (e.g., due to balance discrepancies), trigger it
                if (result.requiresReconciliation) {
                    toast({
                        title: "Syncing with Binance",
                        description: "Attempting to reconcile wallet balance from Binance...",
                        variant: "default"
                    });
                    
                    await refreshWallet(); // Re-fetch wallet data to sync with exchange
                }
            }
        } catch (error) {
            console.error("Error closing position:", error);
            toast({
                title: "Error",
                description: error.message || "An unexpected error occurred while trying to close the position.",
                variant: "destructive"
            });
        } finally {
            setIsClosing(prev => ({ ...prev, [position.id]: false })); // Reset closing state
        }
    };

    if (walletLoading) {
        return (
            <Card className="col-span-1 lg:col-span-1">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold">Active Deals</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex justify-between items-center animate-pulse">
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card className="col-span-1 lg:col-span-1 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Active Deals ({deals.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-80">
                    <div className="p-4 space-y-4">
                        {deals.length > 0 ? deals.map((deal) => {
                            const { pnl, pnlPercentage } = calculatePnl(deal);
                            const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';
                            return (
                                <div key={deal.position_id} className="flex justify-between items-center">
                                    <div className="font-medium text-gray-900 dark:text-white">{deal.symbol}</div>
                                    <div className="text-right">
                                        <div className={`font-semibold ${pnlColor}`}>{pnl.toFixed(2)} USDT</div>
                                        <div className={`text-xs ${pnlColor}`}>{pnlPercentage.toFixed(2)}%</div>
                                    </div>
                                    {/* A button to trigger handleClosePosition would typically go here */}
                                    {/* For example: */}
                                    {/* <Button onClick={() => handleClosePosition(deal)} disabled={isClosing[deal.id]}>
                                        {isClosing[deal.id] ? 'Closing...' : 'Close'}
                                    </Button> */}
                                </div>
                            );
                        }) : (
                            <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                                No active deals
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
