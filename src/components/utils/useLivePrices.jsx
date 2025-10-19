import { useContext, useEffect, useMemo } from 'react';
import { LivePriceContext } from '@/components/providers/LivePriceProvider';

/**
 * Custom hook to subscribe to and receive live price data for specific symbols.
 * 
 * @param {string[]} symbolsToWatch - An array of symbols to subscribe to (e.g., ['BTCUSDT', 'ETHUSDT']).
 * @returns {{priceData: Object, prices: Object}} An object containing both detailed price data and legacy price-only data.
 */
export const useLivePrices = (symbolsToWatch) => {
    const context = useContext(LivePriceContext);

    if (!context) {
        throw new Error('useLivePrices must be used within a LivePriceProvider');
    }

    const { priceData, prices, subscribe, unsubscribe } = context;

    // Memoize the string representation of the array to prevent useEffect from re-running on every render
    const symbolsKey = useMemo(() => JSON.stringify(symbolsToWatch?.sort() || []), [symbolsToWatch]);

    useEffect(() => {
        const symbols = JSON.parse(symbolsKey);
        // Ensure we only subscribe if there are valid symbols to watch.
        if (Array.isArray(symbols) && symbols.length > 0) {
            subscribe(symbols);
        }

        // The cleanup function will run when the component unmounts or when symbolsToWatch changes.
        return () => {
            if (Array.isArray(symbols) && symbols.length > 0) {
                unsubscribe(symbols);
            }
        };
    }, [symbolsKey, subscribe, unsubscribe]);

    // Return both the new detailed price data and legacy prices for backward compatibility
    return { priceData, prices };
};