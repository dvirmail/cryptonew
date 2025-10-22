
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
  const [showLotSizeDialog, setShowLotSizeDialog] = useState(false);
  const [minLotSize, setMinLotSize] = useState(null);
  const [suggestedQuantity, setSuggestedQuantity] = useState(null);
  const [lotSizeInfo, setLotSizeInfo] = useState(null);
  const { toast } = useToast();

    // Get wallet context for balance and refresh function
    const { availableBalance, refreshWallet, scannerInitialized } = useWallet();
    
    // Get live prices for "buy" calculations
    const symbolsToWatch = asset ? [`${asset}USDT`] : [];
    const { prices: currentPrices } = useLivePrices(symbolsToWatch);
    const assetPrice = currentPrices[`${asset}USDT`];

  // Function to get minimum lot size for an asset dynamically from Binance
  const getMinLotSize = async (asset) => {
    if (!asset || !proxyUrl) return 0.001; // Default fallback
    
    try {
      // Check if we already have lot size info for this asset
      if (lotSizeInfo && lotSizeInfo[asset]) {
        return lotSizeInfo[asset];
      }

      // Fetch exchange info from Binance
      const symbol = `${asset}USDT`;
      const response = await fetch(`${proxyUrl}/api/binance/exchangeInfo`);
      
      if (!response.ok) {
        console.warn(`[TradingModal] Failed to fetch exchange info for ${asset}, using default`);
        return 0.001;
      }

      const responseData = await response.json();
      console.log(`[TradingModal] 📊 Exchange info response for ${asset}:`, responseData);
      
      // Handle both direct response and wrapped response formats
      const data = responseData.data || responseData;
      console.log(`[TradingModal] 📊 Processed data:`, data);
      
      if (data && data.symbols) {
        // Try multiple symbol formats
        const possibleSymbols = [
          `${asset}USDT`,
          `${asset}USDT`.toUpperCase(),
          `${asset}USDT`.toLowerCase(),
          `${asset}BTC`,
          `${asset}ETH`,
          `${asset}BNB`
        ];
        
        let symbolInfo = null;
        let foundSymbol = null;
        
        for (const testSymbol of possibleSymbols) {
          symbolInfo = data.symbols.find(s => s.symbol === testSymbol);
          if (symbolInfo) {
            foundSymbol = testSymbol;
            break;
          }
        }
        
        if (symbolInfo) {
          console.log(`[TradingModal] 📊 Found symbol info for ${asset} (${foundSymbol}):`, symbolInfo);
          
          if (symbolInfo.filters) {
            const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
            
            if (lotSizeFilter && lotSizeFilter.minQty) {
              const minQty = parseFloat(lotSizeFilter.minQty);
              console.log(`[TradingModal] 📊 Found lot size for ${asset}: ${minQty}`);
              
              // Cache the lot size info
              setLotSizeInfo(prev => ({
                ...prev,
                [asset]: minQty
              }));
              
              return minQty;
            } else {
              console.warn(`[TradingModal] No LOT_SIZE filter found for ${asset}`);
            }
          } else {
            console.warn(`[TradingModal] No filters found for ${asset}`);
          }
        } else {
          console.warn(`[TradingModal] Symbol ${symbol} not found in exchange info`);
          // Try to find similar symbols for debugging
          const similarSymbols = data.symbols.filter(s => 
            s.symbol.includes(asset) || s.baseAsset === asset || s.quoteAsset === asset
          ).slice(0, 10);
          console.log(`[TradingModal] Similar symbols found:`, similarSymbols.map(s => s.symbol));
        }
      } else {
        console.warn(`[TradingModal] No symbols data in exchange info response`);
      }
      
      // Intelligent fallback based on asset characteristics
      let fallbackLotSize = 0.001;
      
      // For assets that are likely to have whole number lot sizes
      if (['STORJ', 'IOTA', 'XRP', 'ADA', 'DOGE', 'SHIB', 'TRX', 'XLM', 'VET', 'ALGO'].includes(asset)) {
        fallbackLotSize = 1.0;
      }
      // For major cryptocurrencies
      else if (['BTC', 'ETH', 'BNB', 'SOL', 'AVAX', 'MATIC', 'LINK', 'UNI', 'DOT', 'ATOM'].includes(asset)) {
        fallbackLotSize = 0.001;
      }
      // For smaller altcoins
      else if (asset.length <= 4) {
        fallbackLotSize = 0.01;
      }
      
      console.warn(`[TradingModal] No lot size info found for ${asset}, using intelligent fallback: ${fallbackLotSize}`);
      
      // Cache the fallback lot size
      setLotSizeInfo(prev => ({
        ...prev,
        [asset]: fallbackLotSize
      }));
      
      return fallbackLotSize;
      
    } catch (error) {
      console.error(`[TradingModal] Error fetching lot size for ${asset}:`, error);
      return 0.001; // Default fallback
    }
  };

  // Function to validate lot size before trade
  const validateLotSize = async (asset, quantity) => {
    const minLot = await getMinLotSize(asset);
    const numQuantity = parseFloat(quantity);
    
    if (numQuantity < minLot) {
      setMinLotSize(minLot);
      setSuggestedQuantity(minLot);
      setShowLotSizeDialog(true);
      return false;
    }
    return true;
  };

    // Function to validate notional value (quantity × price)
    const validateNotional = (asset, quantity, side) => {
        if (side === 'sell') {
            // For sell orders, we need the current price to calculate notional
            const currentPrice = assetPrice || 0;
            if (currentPrice <= 0) {
                toast({
                    title: "Price Error",
                    description: "Unable to get current price for notional validation. Please try again.",
                    variant: "destructive",
                });
                return false;
            }
            
            const notionalValue = parseFloat(quantity) * currentPrice;
            const minNotional = 10; // Binance testnet minimum notional is usually $10
            
            if (notionalValue < minNotional) {
                const suggestedQuantity = Math.ceil(minNotional / currentPrice);
                setMinLotSize(suggestedQuantity);
                setSuggestedQuantity(suggestedQuantity);
                setShowLotSizeDialog(true);
                return false;
            }
        } else {
            // For buy orders, we need to check if we have enough USDT
            const currentPrice = assetPrice || 0;
            if (currentPrice <= 0) {
                toast({
                    title: "Price Error", 
                    description: "Unable to get current price for notional validation. Please try again.",
                    variant: "destructive",
                });
                return false;
            }
            
            const notionalValue = parseFloat(quantity) * currentPrice;
            const minNotional = 10; // Binance testnet minimum notional is usually $10
            
            if (notionalValue < minNotional) {
                const suggestedQuantity = Math.ceil(minNotional / currentPrice);
                setMinLotSize(suggestedQuantity);
                setSuggestedQuantity(suggestedQuantity);
                setShowLotSizeDialog(true);
                return false;
            }
        }
        return true;
    };

    // Function to handle lot size adjustment
    const handleAdjustToMinLotSize = () => {
        setQuantity(suggestedQuantity.toString());
        setShowLotSizeDialog(false);
        toast({
            title: "Quantity Adjusted",
            description: `Quantity adjusted to minimum lot size: ${suggestedQuantity} ${assetInfo?.asset}`,
        });
    };

    // Function to handle lot size dialog cancellation
    const handleCancelLotSizeAdjustment = () => {
        setShowLotSizeDialog(false);
        setQuantity(''); // Clear the quantity
    };

    // Fetch proxyUrl from ScanSettings on mount
    useEffect(() => {
        async function fetchProxyUrl() {
            try {
                const settingsList = await queueEntityCall('ScanSettings', 'list');
                const settings = settingsList[0];
                if (settings?.local_proxy_url) {
                    setProxyUrl(settings.local_proxy_url);
                } else {
                    // Use default proxy URL if not configured in database
                    console.log('[TradingModal] Using default proxy URL: http://localhost:3003');
                    setProxyUrl('http://localhost:3003');
                }
            } catch (error) {
                console.error('[TradingModal] Failed to load settings, using default proxy URL:', error);
                setProxyUrl('http://localhost:3003');
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
      
      // Fetch lot size info for the new asset
      if (proxyUrl) {
        getMinLotSize(asset);
      }
    }
  }, [asset, availableAmount, initialSide, proxyUrl]);

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

            // Check if system is initialized
            if (!scannerInitialized) {
                toast({
                    title: "System Not Ready",
                    description: "Trading will be available once the system initializes. Please wait a moment and try again.",
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

    // Validate lot size before proceeding
    if (!(await validateLotSize(assetInfo.asset, quantity))) {
      return; // Stop execution if lot size validation fails
    }

        // Validate notional value before proceeding
        if (!validateNotional(assetInfo.asset, quantity, side)) {
            return; // Stop execution if notional validation fails
        }

        setIsLoading(true);
        try {
    // Validate and format quantity according to Binance lot size requirements
    const rawQuantity = parseFloat(quantity);
    let formattedQuantity = rawQuantity;
    
    // Get the minimum lot size for this asset dynamically
    const minLotSize = await getMinLotSize(assetInfo.asset);
    
    // For assets with minimum lot size of 1.0 or higher, round to nearest integer
    if (minLotSize >= 1.0) {
      formattedQuantity = Math.floor(rawQuantity);
      if (formattedQuantity < minLotSize) {
        throw new Error(`Minimum order size for ${assetInfo.asset} is ${minLotSize}`);
      }
    } else {
      // For other assets, ensure we meet the minimum lot size
      formattedQuantity = Math.max(rawQuantity, minLotSize);
    }
            
            console.log('[TradingModal] 📊 Quantity validation:');
            console.log('[TradingModal] 📊 Raw quantity:', rawQuantity);
            console.log('[TradingModal] 📊 Formatted quantity:', formattedQuantity);
            console.log('[TradingModal] 📊 Asset:', assetInfo.asset);
            
            const requestPayload = {
                action: 'createOrder',
                tradingMode: 'testnet',
                proxyUrl: proxyUrl,
                symbol: assetInfo.symbol.replace('/', ''),
                side: side.toUpperCase(),
                quantity: formattedQuantity,
                orderType: 'MARKET',
            };

            const response = await liveTradingAPI(requestPayload);
            
            console.log('[TradingModal] 🔍 Checking success condition:');
            console.log('[TradingModal] 🔍 response:', response);
            console.log('[TradingModal] 🔍 response.success:', response?.success);
            console.log('[TradingModal] 🔍 response.data:', response?.data);
            console.log('[TradingModal] 🔍 typeof response.success:', typeof response?.success);
            
            if (response?.success) {
                toast({
                    title: "Trade Executed",
                    description: `Successfully ${side === 'buy' ? 'bought' : 'sold'} ${quantity} ${assetInfo.asset}.`,
                });

                // OPTIMIZED: Single coordinated wallet refresh
                try {
                    // Wait for Binance to settle the order
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
                    const scanner = getAutoScannerService();
                    
                    // Single comprehensive wallet refresh
                    await scanner.reinitializeWalletFromBinance();
                    
                    // Single UI refresh with bypass cache
                    if (refreshWallet && typeof refreshWallet === 'function') {
                        await refreshWallet(true);
                    }
                    
                } catch (walletError) {
                    console.error('[TradingModal] ⚠️ Failed to refresh wallet:', walletError);
                    toast({
                        title: "Wallet Sync Warning",
                        description: "Trade executed but wallet balance may need manual refresh.",
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
            } else if (error.message?.includes("LOT_SIZE")) {
                errorTitle = "Invalid Order Size";
                errorDescription = `The order quantity doesn't meet the minimum lot size requirements for ${assetInfo?.asset}. Please adjust the quantity and try again.`;
            } else if (error.message?.includes("NOTIONAL")) {
                errorTitle = "Order Value Too Small";
                errorDescription = `The order value (quantity × price) is below the minimum notional value of $10. Please increase the quantity or try a different asset.`;
            } else if (error.message?.includes("Minimum order size")) {
                errorTitle = "Order Size Too Small";
                errorDescription = error.message;
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
        <>
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
                            <div className="space-y-1">
                                {side === 'sell' && availableAmount ? (
                                    <p>Available: {availableAmount} {assetInfo.asset}</p>
                                ) : side === 'buy' ? (
                                    <p>Balance: ${availableBalance.toFixed(2)} USDT</p>
                                ) : <div />}
                <p className="text-blue-600 font-medium">
                  Min lot size: {lotSizeInfo?.[assetInfo.asset] || 'Loading...'} {assetInfo.asset}
                </p>
                            </div>
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
                        disabled={isLoading || !quantity || parseFloat(quantity) <= 0 || !proxyUrl || !scannerInitialized}
                        className={side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
                    >
                        {isLoading ? "Processing..." : !scannerInitialized ? "System Initializing..." : `${side === 'buy' ? 'Buy' : 'Sell'} Now`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Lot Size/Notional Adjustment Dialog */}
        <Dialog open={showLotSizeDialog} onOpenChange={setShowLotSizeDialog}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-orange-600">⚠️ Order Validation Required</DialogTitle>
                    <DialogDescription>
                        The quantity you entered doesn't meet the minimum requirements for this asset.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                    <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <span className="font-medium">Asset:</span>
                                <span className="font-mono">{assetInfo?.asset}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-medium">Your Quantity:</span>
                                <span className="font-mono text-red-600">{quantity}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-medium">Minimum Required:</span>
                                <span className="font-mono text-green-600">{minLotSize}</span>
                            </div>
                            {assetPrice && (
                                <div className="flex justify-between">
                                    <span className="font-medium">Current Price:</span>
                                    <span className="font-mono">${assetPrice.toFixed(4)}</span>
                                </div>
                            )}
                            {assetPrice && (
                                <div className="flex justify-between">
                                    <span className="font-medium">Order Value:</span>
                                    <span className="font-mono text-orange-600">${(parseFloat(quantity) * assetPrice).toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        <p>Would you like to adjust your quantity to meet the minimum requirements?</p>
                        <p className="mt-2 font-medium">Suggested quantity: <span className="font-mono text-blue-600">{suggestedQuantity} {assetInfo?.asset}</span></p>
                        <p className="mt-1 text-xs text-gray-500">Minimum order value: $10.00</p>
                    </div>
                </div>

                <DialogFooter className="flex gap-2">
                    <Button 
                        variant="outline" 
                        onClick={handleCancelLotSizeAdjustment}
                        className="flex-1"
                    >
                        Cancel Trade
                    </Button>
                    <Button 
                        onClick={handleAdjustToMinLotSize}
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                    >
                        Adjust to Minimum
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}
