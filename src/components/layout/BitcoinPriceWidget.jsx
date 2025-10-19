
import React, { useRef, useEffect } from 'react';
import { Bitcoin, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { useLivePrices } from '@/components/utils/useLivePrices';

const BitcoinPriceWidget = () => {
    const { priceData } = useLivePrices(['BTCUSDT']);
    
    const bitcoinData = priceData?.BTCUSDT;
    const price = bitcoinData?.price;
    const isLoading = !bitcoinData;
    const hasError = bitcoinData && (!price || isNaN(price) || price <= 0);

    // NEW: robust percent-change derivation (from entity, raw payload, or fallback to previous price)
    const prevPriceRef = useRef(null);

    // Derive 24h change percent (prefer explicit fields, then fallback to local delta)
    const deriveChangePercent = () => {
        // 1) If provider already has change as a number, use it
        if (typeof bitcoinData?.change === 'number' && !isNaN(bitcoinData.change)) {
            return bitcoinData.change;
        }
        // 2) If LivePriceProvider kept the raw data from getBinancePrices, use raw.change
        const rawChange = bitcoinData?.raw?.change;
        if (rawChange !== undefined && rawChange !== null && !isNaN(Number(rawChange))) {
            return Number(rawChange);
        }
        // 3) Fallback: compute % change vs last price (session-local direction)
        if (prevPriceRef.current && price && !isNaN(price) && prevPriceRef.current > 0) {
            return ((price - prevPriceRef.current) / prevPriceRef.current) * 100;
        }
        return null;
    };

    const changePercent = deriveChangePercent();
    const isUp = typeof changePercent === 'number' ? changePercent >= 0 : null;

    // After deriving, update previous price for the next tick
    useEffect(() => {
        if (price && !isNaN(price)) {
            prevPriceRef.current = price;
        }
    }, [price]);

    // Choose styles/icons
    const changeColor = isUp === null ? '' : (isUp ? 'text-green-500' : 'text-red-500');
    const ChangeIcon = isUp ? TrendingUp : TrendingDown;

    if (isLoading) {
        return (
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                <Bitcoin className="h-4 w-4 mr-1 animate-pulse" />
                <span>Loading Price...</span>
            </div>
        );
    }
    
    if (hasError) {
        return (
             <div className="flex items-center text-xs text-yellow-500 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4 mr-1" />
                <span>BTC Price Retrying...</span>
            </div>
        );
    }

    return (
        <div className="flex items-center space-x-2">
            <Bitcoin className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                ${price && !isNaN(price) ? price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'N/A'}
            </span>
            {/* NEW: Direction + percent change, matching the attachment style */}
            {typeof changePercent === 'number' && !isNaN(changePercent) && (
                <div className={`flex items-center text-xs font-medium ${changeColor}`}>
                    <ChangeIcon className="h-3.5 w-3.5 mr-0.5" />
                    <span>{changePercent.toFixed(2)}%</span>
                </div>
            )}
        </div>
    );
};

export default BitcoinPriceWidget;
