/**
 * Apply exchange filters to quantity (specification step 4)
 */
function applyExchangeFilters(rawQuantityCrypto, currentPrice, exchangeInfo, symbol = 'UNKNOWN') {
    console.log('[EXCHANGE_FILTERS] 🔍 Applying exchange filters:', {
        rawQuantityCrypto,
        currentPrice,
        symbol,
        exchangeInfo: exchangeInfo ? 'present' : 'missing'
    });

    if (!exchangeInfo) {
        console.log('[EXCHANGE_FILTERS] ⚠️ No exchange info provided, using raw quantity');
        return {
            quantityCrypto: rawQuantityCrypto,
            positionValueUSDT: rawQuantityCrypto * currentPrice,
            appliedFilters: []
        };
    }

    let quantityCrypto = rawQuantityCrypto;
    const appliedFilters = [];

    // Get filters from exchange info
    const lotSizeFilter = exchangeInfo.filters?.find(f => f.filterType === 'LOT_SIZE');
    const minNotionalFilter = exchangeInfo.filters?.find(f => f.filterType === 'MIN_NOTIONAL');

    const minQty = lotSizeFilter?.minQty ? parseFloat(lotSizeFilter.minQty) : 0;
    const stepSize = lotSizeFilter?.stepSize ? parseFloat(lotSizeFilter.stepSize) : 0.00000001; // Default small step
    const minNotional = minNotionalFilter?.minNotional ? parseFloat(minNotionalFilter.minNotional) : 0;

    console.log('[EXCHANGE_FILTERS] 📊 Exchange filter values:', {
        minQty,
        stepSize,
        minNotional
    });

    // Step 1: Floor to stepSize
    if (stepSize > 0) {
        const originalQuantity = quantityCrypto;
        quantityCrypto = Math.floor(quantityCrypto / stepSize) * stepSize;
        if (originalQuantity !== quantityCrypto) {
            appliedFilters.push(`Floored to stepSize: ${originalQuantity} → ${quantityCrypto}`);
        }
    }

    // Step 2: Check minQty
    if (minQty > 0 && quantityCrypto < minQty) {
        console.log('[EXCHANGE_FILTERS] ❌ Quantity below minimum:', {
            quantityCrypto,
            minQty,
            difference: quantityCrypto - minQty
        });
        return {
            quantityCrypto: 0,
            positionValueUSDT: 0,
            appliedFilters: [...appliedFilters, `Below minQty: ${quantityCrypto} < ${minQty}`]
        };
    }

    // Step 3: Check minNotional
    const notionalValue = quantityCrypto * currentPrice;
    if (minNotional > 0 && notionalValue < minNotional) {
        console.log('[EXCHANGE_FILTERS] ❌ Notional value below minimum:', {
            notionalValue,
            minNotional,
            difference: notionalValue - minNotional
        });
        return {
            quantityCrypto: 0,
            positionValueUSDT: 0,
            appliedFilters: [...appliedFilters, `Below minNotional: ${notionalValue} < ${minNotional}`]
        };
    }

    const finalPositionValueUSDT = quantityCrypto * currentPrice;
    console.log('[EXCHANGE_FILTERS] ✅ Exchange filters applied successfully:', {
        originalQuantity: rawQuantityCrypto,
        finalQuantity: quantityCrypto,
        finalPositionValue: finalPositionValueUSDT,
        appliedFilters
    });

    return {
        quantityCrypto,
        positionValueUSDT: finalPositionValueUSDT,
        appliedFilters
    };
}

/**
 * Calculate position size using fixed sizing with conviction adjustment
 */
export function calculateFixedSize({ defaultSize, convictionScore, balance, minimumConvictionScore = 50, currentPrice, exchangeInfo, symbol = 'UNKNOWN' }) {
    console.log('[FIXED_SIZING] 🎯 ===== FIXED SIZING CALCULATION START =====');
    console.log('[FIXED_SIZING] 📋 Input parameters:', {
        defaultSize,
        convictionScore,
        minimumConvictionScore,
        balance,
        currentPrice,
        symbol,
        exchangeInfo: exchangeInfo ? 'present' : 'missing'
    });
    
    if (!defaultSize || typeof defaultSize !== 'number' || defaultSize <= 0) {
        console.error(`[FIXED_SIZING] ❌ Invalid defaultSize: ${defaultSize}`);
        return { error: "Invalid default position size" };
    }

    if (!convictionScore || typeof convictionScore !== 'number' || convictionScore < 0) {
        console.error(`[FIXED_SIZING] ❌ Invalid convictionScore: ${convictionScore}`);
        return { error: "Invalid conviction score" };
    }

    if (!balance || typeof balance !== 'number' || balance < 0) {
        console.error(`[FIXED_SIZING] ❌ Invalid balance: ${balance}`);
        return { error: "Invalid balance for position sizing" };
    }

    if (!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0) {
        console.error(`[FIXED_SIZING] ❌ Invalid currentPrice: ${currentPrice}`);
        return { error: "Invalid current price for fixed sizing" };
    }

    // Check minimum conviction score (specification step 1)
    if (convictionScore < minimumConvictionScore) {
        console.log('[FIXED_SIZING] ❌ Conviction below minimum:', {
            convictionScore,
            minimumConvictionScore
        });
        return { error: `Conviction score ${convictionScore} is below minimum required ${minimumConvictionScore}` };
    }

    // Calculate conviction multiplier (specification step 1)
    const convictionMultiplier = 1 + (convictionScore - minimumConvictionScore) / (100 - minimumConvictionScore);
    const cappedConvictionMultiplier = Math.min(convictionMultiplier, 2.5); // Cap at 2.5x as per specification
    console.log('[FIXED_SIZING] 🎯 Conviction multiplier calculation:', {
        convictionScore,
        minimumConvictionScore,
        rawMultiplier: convictionMultiplier,
        cappedMultiplier: cappedConvictionMultiplier
    });
    
    // Calculate raw position value (specification step 2)
    const rawPositionValueUSDT = defaultSize * cappedConvictionMultiplier;
    console.log('[FIXED_SIZING] 💰 Raw position value:', {
        defaultSize,
        cappedConvictionMultiplier,
        rawPositionValueUSDT
    });
    
    // Calculate raw quantity in base asset units (specification step 3)
    const rawQuantityCrypto = rawPositionValueUSDT / currentPrice;
    console.log('[FIXED_SIZING] 📊 Raw quantity calculation:', {
        rawPositionValueUSDT,
        currentPrice,
        rawQuantityCrypto
    });
    
    // Cap by available balance (specification constraint)
    const cappedPositionValueUSDT = Math.min(rawPositionValueUSDT, balance);
    const cappedQuantityCrypto = cappedPositionValueUSDT / currentPrice;
    console.log('[FIXED_SIZING] 💰 Balance cap applied:', {
        rawPositionValue: rawPositionValueUSDT,
        balance,
        cappedPositionValue: cappedPositionValueUSDT,
        cappedQuantity: cappedQuantityCrypto
    });

    // Apply exchange filters (specification step 4)
    const exchangeResult = applyExchangeFilters(cappedQuantityCrypto, currentPrice, exchangeInfo, symbol);
    
    if (exchangeResult.quantityCrypto === 0) {
        console.log('[FIXED_SIZING] ❌ Exchange filters rejected position:', exchangeResult.appliedFilters);
        return { 
            error: `Position rejected by exchange filters: ${exchangeResult.appliedFilters.join(', ')}`,
            appliedFilters: exchangeResult.appliedFilters
        };
    }

    console.log('[FIXED_SIZING] ✅ ===== FIXED SIZING CALCULATION SUCCESS =====');
    console.log('[FIXED_SIZING] 📊 Final results:', {
        originalQuantity: rawQuantityCrypto,
        cappedQuantity: cappedQuantityCrypto,
        finalQuantity: exchangeResult.quantityCrypto,
        finalPositionValue: exchangeResult.positionValueUSDT,
        convictionMultiplier: cappedConvictionMultiplier,
        appliedFilters: exchangeResult.appliedFilters
    });

    return {
        positionSize: exchangeResult.positionValueUSDT, // Return USDT value for compatibility
        quantityCrypto: exchangeResult.quantityCrypto, // Return base asset quantity
        riskAmount: exchangeResult.positionValueUSDT, // For fixed sizing, risk amount equals position size
        stopLossPrice: null,   // Fixed sizing doesn't calculate stop loss
        convictionMultiplier: cappedConvictionMultiplier,
        rawQuantityCrypto: rawQuantityCrypto,
        positionValueUSDT: exchangeResult.positionValueUSDT,
        appliedFilters: exchangeResult.appliedFilters
    };
}

/**
 * Calculate position size using volatility-adjusted sizing (ATR-based)
 */
export function calculateVolatilityAdjustedSize({ 
    balance, 
    riskPercentage, 
    atr, 
    stopLossAtrMultiplier, 
    convictionScore, 
    currentPrice,
    exchangeInfo,
    symbol = 'UNKNOWN'
}) {
    console.log('[VOLATILITY_SIZING] 🎯 ===== VOLATILITY-ADJUSTED SIZING CALCULATION START =====');
    console.log('[VOLATILITY_SIZING] 📋 Input parameters:', {
        balance,
        riskPercentage,
        atr,
        stopLossAtrMultiplier,
        convictionScore,
        currentPrice,
        symbol,
        exchangeInfo: exchangeInfo ? 'present' : 'missing'
    });

    if (!balance || typeof balance !== 'number' || balance <= 0) {
        console.error(`[VOLATILITY_SIZING] ❌ Invalid balance: ${balance}`);
        return { error: "Invalid balance for volatility-adjusted sizing" };
    }

    if (!atr || typeof atr !== 'number' || atr <= 0) {
        console.error(`[VOLATILITY_SIZING] ❌ Invalid ATR: ${atr}`);
        return { error: "Invalid ATR value for volatility-adjusted sizing" };
    }

    if (!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0) {
        console.error(`[VOLATILITY_SIZING] ❌ Invalid currentPrice: ${currentPrice}`);
        return { error: "Invalid current price for volatility-adjusted sizing" };
    }

    // Calculate dollar risk per trade (specification step 1)
    const dollarRiskPerTrade = balance * (riskPercentage / 100);
    console.log('[VOLATILITY_SIZING] 💰 Dollar risk per trade:', {
        balance,
        riskPercentage,
        dollarRiskPerTrade
    });
    
    // Calculate stop loss distance (specification step 2)
    const stopLossDistance = atr * stopLossAtrMultiplier;
    console.log('[VOLATILITY_SIZING] 📏 Stop loss distance:', {
        atr,
        stopLossAtrMultiplier,
        stopLossDistance
    });
    
    // Check for zero or very small stop loss distance (specification constraint check)
    if (stopLossDistance <= 0 || stopLossDistance < 0.0001) {
        console.log('[VOLATILITY_SIZING] ❌ Stop loss distance too small:', { stopLossDistance });
        return { error: "Stop loss distance is too small or zero. Cannot calculate position size safely." };
    }
    
    const stopLossPrice = currentPrice - stopLossDistance; // Assuming long positions
    
    // Calculate raw quantity in base asset units (specification step 3)
    const rawQuantityCrypto = dollarRiskPerTrade / stopLossDistance;
    console.log('[VOLATILITY_SIZING] 📊 Raw quantity calculation:', {
        dollarRiskPerTrade,
        stopLossDistance,
        rawQuantityCrypto
    });
    
    // Calculate position value in USDT (specification step 5)
    const positionValueUSDT = rawQuantityCrypto * currentPrice;
    console.log('[VOLATILITY_SIZING] 💵 Position value calculation:', {
        rawQuantityCrypto,
        currentPrice,
        positionValueUSDT
    });
    
    // Apply conviction adjustment to quantity (not position value)
    const convictionMultiplier = Math.max(0.5, Math.min(1.5, convictionScore / 100));
    console.log('[VOLATILITY_SIZING] 🎯 Conviction adjustment:', {
        convictionScore,
        convictionMultiplier
    });
    
    const adjustedQuantityCrypto = rawQuantityCrypto * convictionMultiplier;
    const adjustedPositionValueUSDT = adjustedQuantityCrypto * currentPrice;
    console.log('[VOLATILITY_SIZING] 🔄 After conviction adjustment:', {
        originalQuantity: rawQuantityCrypto,
        adjustedQuantity: adjustedQuantityCrypto,
        originalPositionValue: positionValueUSDT,
        adjustedPositionValue: adjustedPositionValueUSDT
    });
    
    // Cap by available balance (in USDT terms)
    const cappedPositionValueUSDT = Math.min(adjustedPositionValueUSDT, balance);
    const cappedQuantityCrypto = cappedPositionValueUSDT / currentPrice;
    console.log('[VOLATILITY_SIZING] 💰 Balance cap applied:', {
        adjustedPositionValue: adjustedPositionValueUSDT,
        balance,
        cappedPositionValue: cappedPositionValueUSDT,
        cappedQuantity: cappedQuantityCrypto
    });

    // Apply exchange filters (specification step 4)
    const exchangeResult = applyExchangeFilters(cappedQuantityCrypto, currentPrice, exchangeInfo, symbol);
    
    if (exchangeResult.quantityCrypto === 0) {
        console.log('[VOLATILITY_SIZING] ❌ Exchange filters rejected position:', exchangeResult.appliedFilters);
        return { 
            error: `Position rejected by exchange filters: ${exchangeResult.appliedFilters.join(', ')}`,
            appliedFilters: exchangeResult.appliedFilters
        };
    }

    console.log('[VOLATILITY_SIZING] ✅ ===== VOLATILITY-ADJUSTED SIZING CALCULATION SUCCESS =====');
    console.log('[VOLATILITY_SIZING] 📊 Final results:', {
        originalQuantity: rawQuantityCrypto,
        cappedQuantity: cappedQuantityCrypto,
        finalQuantity: exchangeResult.quantityCrypto,
        finalPositionValue: exchangeResult.positionValueUSDT,
        riskAmount: dollarRiskPerTrade,
        convictionMultiplier: convictionMultiplier,
        appliedFilters: exchangeResult.appliedFilters
    });

    return {
        positionSize: exchangeResult.positionValueUSDT, // Return USDT value for compatibility
        quantityCrypto: exchangeResult.quantityCrypto, // Return base asset quantity
        riskAmount: dollarRiskPerTrade,
        stopLossPrice: stopLossPrice,
        convictionMultiplier: convictionMultiplier,
        rawQuantityCrypto: rawQuantityCrypto,
        positionValueUSDT: exchangeResult.positionValueUSDT,
        appliedFilters: exchangeResult.appliedFilters
    };
}

/**
 * Main position sizing function that determines which sizing method to use
 */
export function calculatePositionSize(options) {
    console.log('[POSITION_SIZING] 🎯 ===== POSITION SIZING CALCULATION START =====');
    console.log('[POSITION_SIZING] 📋 Input parameters:', {
        strategySettings: options.strategySettings,
        currentPrice: options.currentPrice,
        convictionScore: options.convictionScore,
        availableCash: options.availableCash,
        totalWalletBalance: options.totalWalletBalance,
        balanceInTrades: options.balanceInTrades,
        indicators: options.indicators ? Object.keys(options.indicators) : 'none',
        exchangeInfo: options.exchangeInfo ? 'present' : 'missing',
        symbol: options.symbol || 'UNKNOWN'
    });
    
    const {
        strategySettings,
        strategy,
        wallet,
        currentPrice,
        convictionScore,
        convictionDetails,
        totalWalletBalance,
        availableCash,
        klines,
        indicators,
        timeframe
    } = options;

    // Extract settings
    const useWinStrategySize = strategySettings?.useWinStrategySize !== false; // Default to true
    const defaultPositionSize = strategySettings?.defaultPositionSize || 100;
    const riskPerTrade = strategySettings?.riskPerTrade || 2;
    const minimumTradeValue = strategySettings?.minimumTradeValue || 10;
    const maxBalancePercentRisk = strategySettings?.maxBalancePercentRisk || 100; // Default 100%
    const maxBalanceInvestCapUSDT = strategySettings?.maxBalanceInvestCapUSDT || null; // No hard cap by default
    const balanceInTrades = options.balanceInTrades || 0; // Amount currently invested in trades

    console.log('[POSITION_SIZING] 📊 Settings extracted:', {
        useWinStrategySize,
        defaultPositionSize,
        riskPerTrade,
        minimumTradeValue,
        maxBalancePercentRisk,
        maxBalanceInvestCapUSDT,
        availableCash,
        balanceInTrades,
        totalWalletBalance
    });

    // Apply global constraints (specification: Additional Overarching Constraints)
    console.log('[POSITION_SIZING] 🔒 Applying global constraints...');
    
    // Constraint 1: maxBalancePercentRisk (Soft Cap)
    const effectiveMaxBalance = totalWalletBalance * (maxBalancePercentRisk / 100);
    const effectiveAvailableCash = Math.min(availableCash, effectiveMaxBalance);
    
    console.log('[POSITION_SIZING] 💰 Soft cap (maxBalancePercentRisk):', {
        totalWalletBalance,
        maxBalancePercentRisk,
        effectiveMaxBalance,
        originalAvailableCash: availableCash,
        effectiveAvailableCash
    });

    // Constraint 2: maxBalanceInvestCapUSDT (Hard Cap)
    let finalAvailableCash = effectiveAvailableCash;
    if (maxBalanceInvestCapUSDT && maxBalanceInvestCapUSDT > 0) {
        const remainingInvestCap = maxBalanceInvestCapUSDT - balanceInTrades;
        finalAvailableCash = Math.min(effectiveAvailableCash, remainingInvestCap);
        
        console.log('[POSITION_SIZING] 🚫 Hard cap (maxBalanceInvestCapUSDT):', {
            maxBalanceInvestCapUSDT,
            balanceInTrades,
            remainingInvestCap,
            finalAvailableCash
        });
    }

    // Update available cash for calculations
    const adjustedAvailableCash = finalAvailableCash;
    console.log('[POSITION_SIZING] ✅ Final available cash after constraints:', {
        originalAvailableCash: availableCash,
        finalAvailableCash: adjustedAvailableCash,
        constraintsApplied: availableCash !== adjustedAvailableCash
    });


    // Check if we have enough balance (using adjusted available cash)
    if (adjustedAvailableCash < minimumTradeValue) {
        console.log('[POSITION_SIZING] ❌ Insufficient balance after constraints:', {
            originalAvailableCash: availableCash,
            adjustedAvailableCash,
            minimumTradeValue,
            difference: adjustedAvailableCash - minimumTradeValue,
            constraintsApplied: availableCash !== adjustedAvailableCash
        });
        return {
            isValid: false,
            reason: 'insufficient_balance',
            message: `Available balance $${adjustedAvailableCash.toFixed(2)} is below minimum trade value $${minimumTradeValue}${availableCash !== adjustedAvailableCash ? ' (reduced by global constraints)' : ''}`
        };
    }

    let result;
    let calculationMethod;

    if (useWinStrategySize) {
        // Use volatility-adjusted sizing
        console.log('[POSITION_SIZING] 🔄 Using volatility-adjusted sizing');
        
        // Get ATR from indicators
        const atr = indicators?.atr || 0;
        const stopLossAtrMultiplier = 2.0; // Default ATR multiplier for stop loss
        
        console.log('[POSITION_SIZING] 📈 ATR details:', {
            atr,
            stopLossAtrMultiplier,
            currentPrice,
            riskPerTrade
        });
        
        if (!atr || atr <= 0) {
            console.log('[POSITION_SIZING] ❌ Missing ATR:', { atr, indicators });
            return {
                isValid: false,
                reason: 'missing_atr',
                message: 'ATR (Average True Range) is required for volatility-adjusted sizing but not available'
            };
        }

        result = calculateVolatilityAdjustedSize({
            balance: adjustedAvailableCash,
            riskPercentage: riskPerTrade,
            atr: atr,
            stopLossAtrMultiplier: stopLossAtrMultiplier,
            convictionScore: convictionScore,
            currentPrice: currentPrice,
            exchangeInfo: options.exchangeInfo,
            symbol: options.symbol || 'UNKNOWN'
        });
        
        console.log('[POSITION_SIZING] 📊 Volatility-adjusted result:', result);
        calculationMethod = 'volatility_adjusted';
    } else {
        // Use fixed sizing
        console.log('[POSITION_SIZING] 🔄 Using fixed sizing');
        
        result = calculateFixedSize({
            defaultSize: defaultPositionSize,
            convictionScore: convictionScore,
            balance: adjustedAvailableCash,
            minimumConvictionScore: strategySettings?.minimumConvictionScore || 50,
            currentPrice: currentPrice,
            exchangeInfo: options.exchangeInfo,
            symbol: options.symbol || 'UNKNOWN'
        });
        
        console.log('[POSITION_SIZING] 📊 Fixed sizing result:', result);
        calculationMethod = 'fixed';
    }

    if (result.error) {
        console.log('[POSITION_SIZING] ❌ Calculation error:', result.error);
        return {
            isValid: false,
            reason: 'calculation_error',
            message: result.error
        };
    }

    // Validate the calculated position size
    console.log('[POSITION_SIZING] 🔍 Validating position size:', {
        positionSize: result.positionSize,
        minimumTradeValue,
        difference: result.positionSize - minimumTradeValue,
        isValid: result.positionSize >= minimumTradeValue
    });

    if (result.positionSize < minimumTradeValue) {
        console.log('[POSITION_SIZING] ❌ Position size below minimum:', {
            positionSize: result.positionSize,
            minimumTradeValue,
            calculationMethod,
            availableCash,
            convictionScore
        });
        return {
            isValid: false,
            reason: 'below_minimum',
            message: `Calculated position size $${result.positionSize.toFixed(2)} is below minimum trade value $${minimumTradeValue}`,
            positionSize: result.positionSize,
            calculationMethod: calculationMethod
        };
    }

    console.log('[POSITION_SIZING] ✅ ===== POSITION SIZING CALCULATION SUCCESS =====');
    console.log('[POSITION_SIZING] 📊 Final results:', {
        positionSize: result.positionSize,
        quantityCrypto: result.quantityCrypto,
        riskAmount: result.riskAmount,
        convictionMultiplier: result.convictionMultiplier,
        calculationMethod,
        rawQuantityCrypto: result.rawQuantityCrypto,
        positionValueUSDT: result.positionValueUSDT,
        appliedFilters: result.appliedFilters || []
    });

    return {
        isValid: true,
        positionSize: result.positionSize,
        quantityCrypto: result.quantityCrypto,
        riskAmount: result.riskAmount,
        stopLossPrice: result.stopLossPrice,
        convictionMultiplier: result.convictionMultiplier,
        calculationMethod: calculationMethod,
        rawQuantityCrypto: result.rawQuantityCrypto,
        positionValueUSDT: result.positionValueUSDT,
        appliedFilters: result.appliedFilters || [],
        reason: `Position size calculated using ${calculationMethod} method`
    };
}