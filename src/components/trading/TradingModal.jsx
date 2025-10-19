
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { liveTradingAPI } from '@/api/functions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from '@/components/providers/WalletProvider';
import { useLivePrices } from '@/components/utils/useLivePrices';
import { queueEntityCall } from '@/components/utils/apiQueue';

export default function TradingModal({ isOpen, onClose, asset, availableAmount, initialSide = 'buy', onTradeSuccess }) {
    const [quantity, setQuantity] = useState('');
    const [assetInfo, setAssetInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [side, setSide] = useState(initialSide);
    const [proxyUrl, setProxyUrl] = useState(null);
    const { toast } = useToast();

    // Get wallet context for balance and refresh function
    const { availableBalance, refreshWallet } = useWallet();
    
    // Get live prices for "buy" calculations
    const symbolsToWatch = asset ? [`${asset}USDT`] : [];
    const { prices: currentPrices } = useLivePrices(symbolsToWatch);
    const assetPrice = currentPrices[`${asset}USDT`];

    // Fetch proxyUrl from ScanSettings on mount
    useEffect(() => {
        async function fetchProxyUrl() {
            try {
                const settingsList = await queueEntityCall('ScanSettings', 'list');
                const settings = settingsList[0];
                if (settings?.local_proxy_url) {
                    setProxyUrl(settings.local_proxy_url);
                } else {
                    console.error('[TradingModal] ⚠️ No proxyUrl found in ScanSettings');
                    toast({
                        title: "Configuration Error",
                        description: "Proxy URL is not configured. Please set it in Settings.",
                        variant: "destructive",
                    });
                }
            } catch (error) {
                console.error('[TradingModal] Failed to load settings:', error);
            }
        }
        fetchProxyUrl();
    }, []);

    useEffect(() => {
        if (asset) {
            setAssetInfo({
                asset: asset,
                availableAmount: availableAmount || 0,
                symbol: `${asset}USDT`
            });
            setQuantity('');
            setSide(initialSide);
        }
    }, [asset, availableAmount, initialSide]);

    useEffect(() => {
        setQuantity('');
    }, [side]);

    const handleTrade = async () => {
        
        if (!assetInfo || !quantity || parseFloat(quantity) <= 0) {
            toast({
                title: "Invalid Trade",
                description: "Please ensure you have an asset and a valid quantity.",
                variant: "destructive",
            });
            return;
        }

        if (!proxyUrl) {
            toast({
                title: "Configuration Error",
                description: "Proxy URL is not configured. Cannot execute trade.",
                variant: "destructive",
            });
            return;
        }

        setIsLoading(true);
        try {
            const requestPayload = {
                action: 'createOrder',
                tradingMode: 'testnet',
                proxyUrl: proxyUrl,
                symbol: assetInfo.symbol.replace('/', ''),
                side: side.toUpperCase(),
                quantity: parseFloat(quantity),
                orderType: 'MARKET',
            };

            const response = await liveTradingAPI(requestPayload);
            
            if (response?.data?.success) {
                toast({
                    title: "Trade Executed",
                    description: `Successfully ${side === 'buy' ? 'bought' : 'sold'} ${quantity} ${assetInfo.asset}.`,
                });

                // CRITICAL FIX: Wait 3 seconds for Binance to fully settle the order
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // CRITICAL FIX: Trigger full wallet re-initialization from Binance via scanner service
                try {
                    const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
                    const scanner = getAutoScannerService();
                    
                    await scanner.reinitializeWalletFromBinance();
                    
                    // Additionally refresh WalletProvider's display
                    if (refreshWallet && typeof refreshWallet === 'function') {
                        await refreshWallet();
                    }
                } catch (walletError) {
                    console.error('[TradingModal] ⚠️ Failed to reinitialize wallet:', walletError);
                    toast({
                        title: "Wallet Sync Warning",
                        description: "Trade executed but wallet balance may need manual refresh due to sync failure.",
                        variant: "destructive",
                    });
                }

                if (onTradeSuccess) {
                    onTradeSuccess(response.data.data);
                }
                
                onClose();
            } else {
                throw new Error(response?.data?.error || response?.data?.message || 'Trade failed');
            }

        } catch (error) {
            console.error('[TradingModal] Caught Error:', error);
            let errorTitle = "Trade Failed";
            let errorDescription = error.message || "An unexpected error occurred while placing the trade.";
            
            if (error.message?.includes("Insufficient balance") || error.message?.includes("-2010")) {
                errorTitle = "Insufficient Balance";
                const currencyNeeded = side === 'buy' ? 'USDT' : (assetInfo?.asset || 'crypto');
                errorDescription = `Your TESTNET account doesn't have enough ${currencyNeeded} to complete this trade. Please check your balance and try again.`;
            } else if (error.message?.includes("proxyUrl")) {
                errorTitle = "Configuration Error";
                errorDescription = "Proxy URL is not properly configured. Please check your settings.";
            }
            
            toast({
                title: errorTitle,
                description: errorDescription,
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSetQuantity = (percentage) => {
        let newQuantity = 0;
        if (side === 'sell') {
            newQuantity = (availableAmount || 0) * percentage;
        } else if (side === 'buy') {
            if (assetPrice > 0) {
                const maxCrypto = availableBalance / assetPrice;
                newQuantity = maxCrypto * percentage;
            } else {
                toast({ title: "Price not available", description: `Cannot calculate buy amount for ${asset}.`, variant: "destructive" });
            }
        }
        setQuantity(newQuantity > 0 ? newQuantity.toFixed(8) : '');
    };

    if (!assetInfo) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Manual Trade: {assetInfo.asset}
                    </DialogTitle>
                    <DialogDescription>
                        Place a manual market order in TESTNET mode.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={side} onValueChange={(value) => setSide(value)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="buy">Buy</TabsTrigger>
                        <TabsTrigger value="sell">Sell</TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="quantity">Amount in {assetInfo.asset}</Label>
                        <Input
                            id="quantity"
                            type="number"
                            placeholder="0.0"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                        />
                        <div className="flex justify-between items-center text-xs text-gray-500 pt-1">
                            {side === 'sell' && availableAmount ? (
                                <p>Available: {availableAmount} {assetInfo.asset}</p>
                            ) : side === 'buy' ? (
                                <p>Balance: ${availableBalance.toFixed(2)} USDT</p>
                            ) : <div />}
                            <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => handleSetQuantity(0.25)}>25%</Button>
                                <Button size="sm" variant="outline" onClick={() => handleSetQuantity(0.50)}>50%</Button>
                                <Button size="sm" variant="outline" onClick={() => handleSetQuantity(0.75)}>75%</Button>
                                <Button size="sm" variant="outline" onClick={() => handleSetQuantity(1.0)}>Max</Button>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button 
                        onClick={handleTrade} 
                        disabled={isLoading || !quantity || parseFloat(quantity) <= 0 || !proxyUrl}
                        className={side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
                    >
                        {isLoading ? "Processing..." : `${side === 'buy' ? 'Buy' : 'Sell'} Now`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
