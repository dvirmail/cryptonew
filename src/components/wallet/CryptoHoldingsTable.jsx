
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLivePrices } from '@/components/utils/useLivePrices';

const formatPrice = (price) => {
    if (price === null || price === undefined || isNaN(price)) return 'N/A';
    
    // For very small prices (like BONK, SHIB, etc.), show up to 8 decimal places
    if (price < 0.01 && price !== 0) { // Added price !== 0 to ensure 0 is formatted as $0.00
        return price.toLocaleString('en-US', { 
            style: 'currency', 
            currency: 'USD',
            minimumFractionDigits: 2, // minimum 2 digits for consistency, will extend if needed
            maximumFractionDigits: 8
        });
    }
    
    // For normal prices, show 2 decimal places
    return price.toLocaleString('en-US', { 
        style: 'currency', 
        currency: 'USD' 
    });
};

const formatCrypto = (amount) => {
    if (amount === null || amount === undefined) return '0.00';
    amount = Number(amount);
    if (isNaN(amount)) return '0.00';
    if (amount === 0) return '0.00';
    if (amount >= 1) {
        return amount.toFixed(6);
    }
    return amount.toFixed(8);
};

export default function CryptoHoldingsTable({ walletState, tradingMode, onTrade, onSyncBalances }) {

    //console.log('[DEBUG] CryptoHoldingsTable walletState:', walletState);
    //console.log('[DEBUG] CryptoHoldingsTable tradingMode:', tradingMode);

    // Extract crypto holdings (exclude stablecoins like USDT, USDC, etc.)
    const cryptoHoldings = useMemo(() => {
        if (!walletState?.balances || !Array.isArray(walletState.balances)) {
            //console.log('[DEBUG] CryptoHoldingsTable: No balances array found');
            return [];
        }

        //console.log('[DEBUG] CryptoHoldingsTable: Raw balances:', walletState.balances);

        const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'PAX', 'GUSD', 'USDD'];
        
        const holdings = walletState.balances
            .filter(balance => !stablecoins.includes(balance.asset))
            .filter(balance => {
                const total = parseFloat(balance.free || 0) + parseFloat(balance.locked || 0);
                return total > 0.00000001; // Filter out dust from actual wallet balances
            })
            .map(balance => ({
                asset: balance.asset,
                free: parseFloat(balance.free || 0),
                locked: parseFloat(balance.locked || 0),
                total: parseFloat(balance.free || 0) + parseFloat(balance.locked || 0)
            }));

        //console.log('[DEBUG] CryptoHoldingsTable: Filtered holdings:', holdings);
        return holdings;
    }, [walletState?.balances]);

    // Get symbols for price fetching
    const symbolsToWatch = useMemo(() => {
        // Ensure USDT is not included in symbols to watch, as its price is 1
        return cryptoHoldings
            .filter(holding => holding.asset !== 'USDT')
            .map(holding => `${holding.asset}USDT`);
    }, [cryptoHoldings]);

    const { prices: currentPrices } = useLivePrices(symbolsToWatch);

    // Calculate holdings with USD values
    const holdingsWithValues = useMemo(() => {
        return cryptoHoldings.map(holding => {
            const symbol = `${holding.asset}USDT`;
            const price = holding.asset === 'USDT' ? 1 : (currentPrices[symbol] || 0); // USDT price is always 1
            const usdValue = holding.total * price;
            
            return {
                ...holding,
                price,
                usdValue
            };
        });
    }, [cryptoHoldings, currentPrices]);

    // Filter holdings for display, removing very small values (dust) unless it's USDT itself
    const displayHoldings = useMemo(() => {
        return holdingsWithValues
            .filter(holding => !(holding.usdValue < 0.01 && holding.asset !== 'USDT')) // Filter out crypto dust based on USD value
            .sort((a, b) => b.usdValue - a.usdValue); // Sort by USD value descending
    }, [holdingsWithValues]);

    //console.log('[DEBUG] CryptoHoldingsTable: Holdings with values:', displayHoldings);

    const totalPortfolioValue = displayHoldings.reduce((sum, holding) => sum + holding.usdValue, 0);
    
    if (displayHoldings.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        💰 Crypto Holdings
                        <Badge variant="outline">
                            {tradingMode ? 'Live' : 'Testnet'}
                        </Badge>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={onSyncBalances}
                            className="ml-2"
                        >
                            Sync
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-8 text-gray-500">
                        <p className="text-lg">No significant crypto holdings found in this wallet.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        💰 Crypto Holdings
                        <Badge variant="outline">
                            {tradingMode ? 'Live' : 'Testnet'}
                        </Badge>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={onSyncBalances}
                            className="ml-2"
                        >
                            Sync
                        </Button>
                    </div>
                    <span className="text-lg font-semibold">Total: {formatPrice(totalPortfolioValue)}</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Asset</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Price</TableHead> {/* Renamed from Price (USDT) */}
                            <TableHead>Value (USD)</TableHead> {/* Renamed from USD Value */}
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {displayHoldings.map((holding) => {
                            return (
                                <TableRow key={holding.asset}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">{holding.asset}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatCrypto(holding.total)}</TableCell>
                                    <TableCell>{holding.price > 0 ? formatPrice(holding.price) : 'Loading...'}</TableCell>
                                    <TableCell className="font-semibold">{formatPrice(holding.usdValue)}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                onClick={() => onTrade(holding.asset, 'buy')}
                                            >
                                                Buy
                                            </Button>
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                onClick={() => onTrade(holding.asset, 'sell')}
                                                disabled={holding.free <= 0} // Disable sell if no free balance
                                            >
                                                Sell
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
