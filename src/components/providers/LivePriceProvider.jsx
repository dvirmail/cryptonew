
import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { queueFunctionCall } from '@/components/utils/apiQueue';
import { getBinancePrices } from '@/api/functions'; // Added top-level import for direct use in useCallback
import priceCacheService from '@/components/services/PriceCacheService';

const POLL_INTERVAL = 15000;
const EXTERNAL_PRICE_FRESHNESS_THRESHOLD = 12000; // Only use scanner prices if they are less than 12 seconds old.

export const LivePriceContext = createContext(null);

export const LivePriceProvider = ({ children }) => {
    // Changed from storing just numbers to storing objects with price and change data
    // Note: The structure of priceData will now be influenced by both fetchPrices and updatePricesFromScanner,
    // potentially leading to mixed structures (some with change/lastUpdated, some with timestamp/raw).
    const [priceData, setPriceData] = useState({});
    // New state to hold just the prices for easier access/compatibility
    const [prices, setPrices] = useState({});
    const subscribedSymbolsRef = useRef(new Set());
    const isFetchingRef = useRef(false); // Kept but new fetchPrices doesn't use it for its internal logic
    const pollerRef = useRef(null);
    const lastScannerPriceUpdateRef = useRef(0); // Kept but new fetchPrices doesn't use it for its internal logic
    const unsubscribeRef = useRef(null);

    const fetchPrices = useCallback(async () => {
        const symbolsToFetch = Array.from(subscribedSymbolsRef.current);
        if (symbolsToFetch.length === 0) {
            return;
        }

        // FIXED: Limit symbol requests to prevent Binance API errors
        const MAX_SYMBOLS_PER_REQUEST = 50; // Reduced from unlimited to 50
        const prioritySymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']; // Always fetch these first
        
        // Prioritize important symbols and limit the total
        const symbolsPrioritized = [
            ...prioritySymbols.filter(s => symbolsToFetch.includes(s)),
            ...symbolsToFetch.filter(s => !prioritySymbols.includes(s))
        ].slice(0, MAX_SYMBOLS_PER_REQUEST);

        try {
            const response = await getBinancePrices({ symbols: symbolsPrioritized });
            
            // Handle both direct response and wrapped response formats
            let priceArray = null;
            if (Array.isArray(response)) {
                priceArray = response;
            } else if (Array.isArray(response?.data)) {
                priceArray = response.data;
            }

            if (priceArray) {
                const newPricesForState = {}; // This is for the new 'prices' state variable
                setPriceData(prevData => {
                    const updatedPriceData = { ...prevData }; // Start with existing data
                    priceArray.forEach(item => {
                        const symbol = item.symbol.replace('/', '');
                        const price = parseFloat(item.price);
                        if (price !== null && !isNaN(price)) {
                            // This structure is explicitly defined by the outline for newPriceData.
                            // Now includes 24h change data from Binance API
                            updatedPriceData[symbol] = {
                                price,
                                change: item.change || null, // 24h change percentage from Binance
                                timestamp: item.timestamp || null, // Assuming timestamp is provided by getBinancePrices now
                                raw: item // Store the full raw item
                            };
                            newPricesForState[symbol] = price;
                        }
                    });
                    setPrices(prev => ({ ...prev, ...newPricesForState })); // Update the new `prices` state
                    return updatedPriceData; // Update the `priceData` state
                });
            } else {
                console.warn('[LivePriceProvider] Invalid response format:', response?.data);
            }
        } catch (error) {
            console.error('[LivePriceProvider] Price fetch error:', error.message);
        }
    }, [setPrices, setPriceData]);

    const subscribe = useCallback((symbols) => {
        if (!Array.isArray(symbols)) {
            console.warn('[LivePriceProvider] subscribe called with non-array symbols:', symbols);
            return;
        }
        
        let addedNewSymbols = false;
        symbols.forEach(symbol => {
            const cleanedSymbol = symbol.replace('/', '');
            if (cleanedSymbol && !subscribedSymbolsRef.current.has(cleanedSymbol)) {
                subscribedSymbolsRef.current.add(cleanedSymbol);
                addedNewSymbols = true;
            }
        });
        
        // Only fetch if we added new symbols to reduce redundant calls
        if (addedNewSymbols) {
            fetchPrices();
        }
    }, [fetchPrices]);

    const unsubscribe = useCallback((symbols) => {
        if (!Array.isArray(symbols) || symbols.length === 0) return;
        symbols.forEach(symbol => {
            if (symbol) subscribedSymbolsRef.current.delete(symbol);
        });
    }, []);

    // Updated to handle both scanner price updates (price only) and preserve change data
    const updatePricesFromScanner = useCallback((newPricesMap) => {
        if (newPricesMap && Object.keys(newPricesMap).length > 0) {
            lastScannerPriceUpdateRef.current = Date.now();
            setPriceData(prevData => {
                const updatedData = { ...prevData };
                const newPricesForState = {}; // Also update the new 'prices' state from scanner
                Object.entries(newPricesMap).forEach(([symbol, price]) => {
                    // Preserve existing change data if available, otherwise set to null.
                    // This update structure will overwrite 'timestamp' and 'raw' if they were set by fetchPrices.
                    updatedData[symbol] = {
                        price: parseFloat(price),
                        change: prevData[symbol]?.change || null, // Preserve or set to null
                        lastUpdated: Date.now(), // Set by scanner
                        // Preserve timestamp and raw if they exist from a previous fetch
                        timestamp: prevData[symbol]?.timestamp || null,
                        raw: prevData[symbol]?.raw || null
                    };
                    newPricesForState[symbol] = parseFloat(price);
                });
                setPrices(prev => ({ ...prev, ...newPricesForState })); // Update the new `prices` state
                return updatedData;
            });
        }
    }, [setPrices]);

    // Subscribe to global price coordinator instead of polling
    useEffect(() => {
        if (subscribedSymbolsRef.current.size > 0) {
            // Subscribe to global price updates
            unsubscribeRef.current = priceCacheService.subscribeToGlobalUpdates(() => {
                return Array.from(subscribedSymbolsRef.current);
            });
            
            // Start global coordinator if not already running
            priceCacheService.startGlobalPriceCoordinator(POLL_INTERVAL);
        }
        
        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [subscribedSymbolsRef.current.size]);

    const contextValue = React.useMemo(() => ({
        priceData,
        prices, // Expose the new `prices` state directly. This replaces the old calculated `prices` from `priceData`.
        subscribe,
        unsubscribe,
        updatePricesFromScanner,
        // Legacy compatibility - the `prices` property in the context now directly maps to the `prices` state.
        // If the original calculation `Object.fromEntries(Object.entries(priceData).map(([symbol, data]) => [symbol, data.price]))`
        // is still required under a different name, it would need to be added explicitly.
        // Based on the outline adding `prices` state, this is the intended replacement.
    }), [priceData, prices, subscribe, unsubscribe, updatePricesFromScanner]); // Added `prices` to dependencies

    return (
        <LivePriceContext.Provider value={contextValue}>
            {children}
        </LivePriceContext.Provider>
    );
};
