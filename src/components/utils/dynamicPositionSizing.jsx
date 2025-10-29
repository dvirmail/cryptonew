/**
 * Calculates portfolio heat (total risk across all open positions).
 * Returns heat information and constraints for new positions.
 */
function calculatePortfolioHeat(openPositions, totalEquity, settings) {
    let currentHeat = 0;
    
    for (const position of openPositions) {
        // Risk for this position = position size * stop loss distance
        const stopDistance = Math.abs(position.stop_loss_price - position.entry_price) / position.entry_price;
        const positionRisk = position.entry_value_usdt * stopDistance;
        currentHeat += positionRisk;
    }
    
    // Express as percentage of equity
    const currentHeatPercent = (currentHeat / totalEquity) * 100;
    
    // Calculate remaining heat capacity
    const remainingHeatPercent = settings.portfolioHeatMax - currentHeatPercent;
    const maxAllowedNewPositionRisk = totalEquity * (remainingHeatPercent / 100);
    
    return {
        currentHeat,
        currentHeatPercent,
        remainingHeatPercent,
        maxAllowedNewPositionRisk
    };
}

/**
 * Apply exchange filters to quantity (specification step 4)
 */
function applyExchangeFilters(rawQuantityCrypto, currentPrice, exchangeInfo, symbol = 'UNKNOWN', availableBalance = null) {
    // availableBalance: Available USDT balance for position opening (optional)
    // Used to check if buffer can be applied and to cap auto-raising

    if (!exchangeInfo) {
        // console.log('[EXCHANGE_FILTERS] ⚠️ No exchange info provided, using raw quantity');
        return {
            quantityCrypto: rawQuantityCrypto,
            positionValueUSDT: rawQuantityCrypto * currentPrice,
            appliedFilters: []
        };
    }

    let quantityCrypto = rawQuantityCrypto;
    const appliedFilters = [];

    // Get filters from exchange info (filters is an object, not an array)
    const lotSizeFilter = exchangeInfo.filters?.LOT_SIZE;
    const minNotionalFilter = exchangeInfo.filters?.MIN_NOTIONAL;

    const minQty = lotSizeFilter?.minQty ? parseFloat(lotSizeFilter.minQty) : 0;
    const stepSize = lotSizeFilter?.stepSize ? parseFloat(lotSizeFilter.stepSize) : 0.00000001; // Default small step
    const minNotional = minNotionalFilter?.minNotional ? parseFloat(minNotionalFilter.minNotional) : 0;


    // Step 1: Floor to stepSize
    if (stepSize > 0) {
        const originalQuantity = quantityCrypto;
        quantityCrypto = Math.floor(quantityCrypto / stepSize) * stepSize;
        if (originalQuantity !== quantityCrypto) {
            appliedFilters.push(`Floored to stepSize: ${originalQuantity} → ${quantityCrypto}`);
        }
    }

    // Step 2: Auto-raise to minQty if below (CRITICAL FIX: Don't reject, raise to minimum)
    // BUT: Check available balance first - can't raise beyond what we have
    if (minQty > 0 && quantityCrypto < minQty) {
        const originalQty = quantityCrypto;
        // Calculate what minQty would cost in USDT
        const minQtyCost = parseFloat(minQty) * currentPrice;
        
        // Check if we have enough balance for minQty
        if (availableBalance !== null && minQtyCost > availableBalance) {
            // Can't afford minQty - reject position (would need more balance)
            console.warn(`[EXCHANGE_FILTERS] ❌ Cannot auto-raise to minQty: need $${minQtyCost.toFixed(2)} but only have $${availableBalance.toFixed(2)}`);
            return {
                quantityCrypto: 0,
                positionValueUSDT: 0,
                appliedFilters: [...appliedFilters, `Cannot afford minQty: need $${minQtyCost.toFixed(2)}, have $${availableBalance.toFixed(2)}`],
                error: 'INSUFFICIENT_BALANCE_FOR_MIN_QTY'
            };
        }
        
        // Auto-raise to minimum quantity (we have enough balance)
        quantityCrypto = parseFloat(minQty);
        // Re-floor to step size after raising
        if (stepSize > 0) {
            quantityCrypto = Math.floor(quantityCrypto / stepSize) * stepSize;
        }
        appliedFilters.push(`Auto-raised to minQty: ${originalQty.toFixed(8)} → ${quantityCrypto.toFixed(8)}`);
        console.log(`[EXCHANGE_FILTERS] ⚠️ Auto-raising quantity from ${originalQty.toFixed(8)} to minQty ${quantityCrypto.toFixed(8)}`);
    }

    // Step 3: Auto-raise to minNotional if below (CRITICAL FIX: Don't reject, raise to minimum)
    // BUT: Check available balance first - can't raise beyond what we have
    let notionalValue = quantityCrypto * currentPrice;
    if (minNotional > 0 && notionalValue < minNotional) {
        const originalQty = quantityCrypto;
        const originalNotional = notionalValue;
        // Calculate required quantity to meet minNotional
        const requiredQty = Math.ceil(parseFloat(minNotional) / currentPrice);
        const requiredCost = requiredQty * currentPrice;
        
        // Check if we have enough balance for minNotional
        if (availableBalance !== null && requiredCost > availableBalance) {
            // Can't afford minNotional - reject position (would need more balance)
            console.warn(`[EXCHANGE_FILTERS] ❌ Cannot auto-raise to minNotional: need $${requiredCost.toFixed(2)} but only have $${availableBalance.toFixed(2)}`);
            return {
                quantityCrypto: 0,
                positionValueUSDT: 0,
                appliedFilters: [...appliedFilters, `Cannot afford minNotional: need $${requiredCost.toFixed(2)}, have $${availableBalance.toFixed(2)}`],
                error: 'INSUFFICIENT_BALANCE_FOR_MIN_NOTIONAL'
            };
        }
        
        quantityCrypto = requiredQty;
        // Floor to step size after calculating required quantity
        if (stepSize > 0) {
            quantityCrypto = Math.floor(quantityCrypto / stepSize) * stepSize;
        }
        // Recalculate notional after adjustment
        notionalValue = quantityCrypto * currentPrice;
        appliedFilters.push(`Auto-raised to minNotional: qty ${originalQty.toFixed(8)} → ${quantityCrypto.toFixed(8)}, notional $${originalNotional.toFixed(2)} → $${notionalValue.toFixed(2)}`);
        console.log(`[EXCHANGE_FILTERS] ⚠️ Auto-raising quantity from ${originalQty.toFixed(8)} to meet minNotional: ${quantityCrypto.toFixed(8)} ($${notionalValue.toFixed(2)})`);
    }

    // Step 4: Add 5% quantity buffer (ONLY if available balance allows it)
    // This buffer provides safety margin against price movements and rounding errors
    const beforeBufferQty = quantityCrypto;
    const beforeBufferNotional = quantityCrypto * currentPrice;
    
    let bufferedQuantity = quantityCrypto * 1.05; // Add 5% buffer
    const bufferedCost = bufferedQuantity * currentPrice;
    
    // Only apply buffer if we have enough balance AND it's meaningful
    if (availableBalance !== null && bufferedCost <= availableBalance && bufferedQuantity > quantityCrypto) {
        // Can afford buffer - apply it
        bufferedQuantity = Math.floor(bufferedQuantity / stepSize) * stepSize; // Re-floor to step size
        const bufferedNotional = bufferedQuantity * currentPrice;
        
        if (bufferedQuantity > quantityCrypto) {
            quantityCrypto = bufferedQuantity;
            notionalValue = bufferedNotional;
            appliedFilters.push(`Added 5% buffer: qty ${beforeBufferQty.toFixed(8)} → ${quantityCrypto.toFixed(8)}, notional $${beforeBufferNotional.toFixed(2)} → $${notionalValue.toFixed(2)}`);
            console.log(`[EXCHANGE_FILTERS] ✅ Added 5% buffer: ${beforeBufferQty.toFixed(8)} → ${quantityCrypto.toFixed(8)} (cost: $${bufferedNotional.toFixed(2)} of $${availableBalance.toFixed(2)} available)`);
        }
    } else if (availableBalance !== null && bufferedCost > availableBalance) {
        // Can't afford buffer - use original quantity (already meets minimums, buffer is optional)
        console.log(`[EXCHANGE_FILTERS] ⚠️ Skipping 5% buffer: need $${bufferedCost.toFixed(2)} but only have $${availableBalance.toFixed(2)} - using original quantity`);
        appliedFilters.push(`Skipped 5% buffer: insufficient balance (need $${bufferedCost.toFixed(2)}, have $${availableBalance.toFixed(2)})`);
    } else if (availableBalance === null) {
        // No balance info provided - apply buffer anyway (caller responsible for balance check)
        bufferedQuantity = Math.floor(bufferedQuantity / stepSize) * stepSize;
        if (bufferedQuantity > quantityCrypto) {
            quantityCrypto = bufferedQuantity;
            notionalValue = quantityCrypto * currentPrice;
            appliedFilters.push(`Added 5% buffer: qty ${beforeBufferQty.toFixed(8)} → ${quantityCrypto.toFixed(8)}`);
        }
    }
    
    // Step 5: Final validation with 10% safety margin
    const finalNotional = quantityCrypto * currentPrice;
    const requiredMinNotionalWithMargin = parseFloat(minNotional) * 1.1; // 10% above minimum
    
    // Verify final quantity meets both minimums after all adjustments
    if (minQty > 0 && quantityCrypto < minQty - 1e-12) {
        // This should never happen after auto-raising, but check for safety
        console.warn(`[EXCHANGE_FILTERS] ⚠️ Final quantity ${quantityCrypto.toFixed(8)} still below minQty ${minQty} after auto-raising`);
        return {
            quantityCrypto: 0,
            positionValueUSDT: 0,
            appliedFilters: [...appliedFilters, `ERROR: Final quantity still below minQty after auto-raising`],
            error: 'QUANTITY_STILL_BELOW_MIN_QTY'
        };
    }
    
    if (minNotional > 0 && finalNotional < minNotional - 1e-8) {
        // This should never happen after auto-raising, but check for safety
        console.warn(`[EXCHANGE_FILTERS] ⚠️ Final notional ${finalNotional.toFixed(2)} still below minNotional ${minNotional} after auto-raising`);
        return {
            quantityCrypto: 0,
            positionValueUSDT: 0,
            appliedFilters: [...appliedFilters, `ERROR: Final notional still below minNotional after auto-raising`],
            error: 'NOTIONAL_STILL_BELOW_MIN'
        };
    }
    
    // Step 6: Safety margin validation (10% above minNotional)
    if (minNotional > 0 && finalNotional < requiredMinNotionalWithMargin) {
        // Even with buffer, position is too small - reject to prevent dust risk
        console.warn(`[EXCHANGE_FILTERS] ❌ Final notional $${finalNotional.toFixed(2)} below 10% safety margin ($${requiredMinNotionalWithMargin.toFixed(2)})`);
        return {
            quantityCrypto: 0,
            positionValueUSDT: 0,
            appliedFilters: [...appliedFilters, `Rejected: Below 10% safety margin ($${finalNotional.toFixed(2)} < $${requiredMinNotionalWithMargin.toFixed(2)})`],
            error: 'WOULD_CREATE_DUST',
            reason: 'Final position value too small even with buffers - would create dust risk'
        };
    }

    return {
        quantityCrypto,
        positionValueUSDT: finalNotional,
        appliedFilters
    };
}

/**
 * Calculate position size using fixed sizing with conviction adjustment
 */
export function calculateFixedSize({ defaultSize, convictionScore, balance, minimumConvictionScore = 50, currentPrice, exchangeInfo, symbol = 'UNKNOWN', lpmScore = 50 }) {
    // console.log('[FIXED_SIZING] 🎯 ===== FIXED SIZING CALCULATION START =====');
    // console.log('[FIXED_SIZING] 📋 Input parameters:', {
    //     defaultSize,
    //     convictionScore,
    //     minimumConvictionScore,
    //     balance,
    //     currentPrice,
    //     symbol,
    //     exchangeInfo: exchangeInfo ? 'present' : 'missing'
    // });
    
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
        // console.log('[FIXED_SIZING] ❌ Conviction below minimum:', {
        //     convictionScore,
        //     minimumConvictionScore
        // });
        return { error: `Conviction score ${convictionScore} is below minimum required ${minimumConvictionScore}` };
    }

    // Calculate LPM-based position multiplier (CORRECTED LOGIC)
    // LPM score (0-100) should directly impact position size
    // Higher LPM = larger positions, Lower LPM = smaller positions
    const currentLpmScore = lpmScore || 50; // Default to neutral if not provided
    const lpmMultiplier = 0.5 + (currentLpmScore / 100) * 1.0; // Range: 0.5x to 1.5x based on LPM
    const cappedLpmMultiplier = Math.min(Math.max(lpmMultiplier, 0.5), 1.5); // Cap between 0.5x and 1.5x
    
    // console.log('[FIXED_SIZING] 🎯 LPM-based position multiplier calculation:', {
    //     lpmScore: currentLpmScore,
    //     rawMultiplier: lpmMultiplier,
    //     cappedMultiplier: cappedLpmMultiplier,
    //     convictionScore: convictionScore, // Keep for logging but don't use for sizing
    //     minimumConvictionScore: minimumConvictionScore
    // });
    
    // Calculate raw position value (specification step 2) - NOW USING LPM, NOT CONVICTION
    const rawPositionValueUSDT = defaultSize * cappedLpmMultiplier;
    // console.log('[FIXED_SIZING] 💰 Raw position value:', {
    //     defaultSize,
    //     cappedLpmMultiplier,
    //     rawPositionValueUSDT
    // });
    
    // Calculate raw quantity in base asset units (specification step 3)
    const rawQuantityCrypto = rawPositionValueUSDT / currentPrice;
    // console.log('[FIXED_SIZING] 📊 Raw quantity calculation:', {
    //     rawPositionValueUSDT,
    //     currentPrice,
    //     rawQuantityCrypto
    // });
    
    // Cap by available balance (specification constraint)
    const cappedPositionValueUSDT = Math.min(rawPositionValueUSDT, balance);
    const cappedQuantityCrypto = cappedPositionValueUSDT / currentPrice;
    // console.log('[FIXED_SIZING] 💰 Balance cap applied:', {
    //     rawPositionValue: rawPositionValueUSDT,
    //     balance,
    //     cappedPositionValue: cappedPositionValueUSDT,
    //     cappedQuantity: cappedQuantityCrypto
    // });

    // Apply exchange filters (specification step 4)
    // Pass available balance so auto-raising and buffer respect balance limits
    const exchangeResult = applyExchangeFilters(cappedQuantityCrypto, currentPrice, exchangeInfo, symbol, balance);
    
    if (exchangeResult.quantityCrypto === 0) {
        // console.log('[FIXED_SIZING] ❌ Exchange filters rejected position:', exchangeResult.appliedFilters);
        return { 
            error: `Position rejected by exchange filters: ${exchangeResult.appliedFilters.join(', ')}`,
            appliedFilters: exchangeResult.appliedFilters
        };
    }

    // console.log('[FIXED_SIZING] ✅ ===== FIXED SIZING CALCULATION SUCCESS =====');
    // console.log('[FIXED_SIZING] 📊 Final results:', {
    //     originalQuantity: rawQuantityCrypto,
    //     cappedQuantity: cappedQuantityCrypto,
    //     finalQuantity: exchangeResult.quantityCrypto,
    //     finalPositionValue: exchangeResult.positionValueUSDT,
    //     lpmMultiplier: cappedLpmMultiplier,
    //     lpmScore: currentLpmScore,
    //     appliedFilters: exchangeResult.appliedFilters
    // });

    return {
        positionSize: exchangeResult.positionValueUSDT, // Return USDT value for compatibility
        quantityCrypto: exchangeResult.quantityCrypto, // Return base asset quantity
        riskAmount: exchangeResult.positionValueUSDT, // For fixed sizing, risk amount equals position size
        stopLossPrice: null,   // Fixed sizing doesn't calculate stop loss
        lpmMultiplier: cappedLpmMultiplier,
        lpmScore: currentLpmScore,
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
    symbol = 'UNKNOWN',
    openPositions = [],
    totalEquity = balance,
    settings = {},
    basePositionSize = 100, // Base position size for LPM system
    lpmScore = 50 // LPM score for position sizing
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

    // Calculate LPM-based position multiplier (NEW LOGIC)
    // LPM score (0-100) should directly impact position size
    // Higher LPM = larger positions, Lower LPM = smaller positions
    const currentLpmScore = lpmScore || 50; // Default to neutral if not provided
    const lpmMultiplier = 0.5 + (currentLpmScore / 100) * 1.0; // Range: 0.5x to 1.5x based on LPM
    const cappedLpmMultiplier = Math.min(Math.max(lpmMultiplier, 0.5), 1.5); // Cap between 0.5x and 1.5x
    
    // Calculate base position value using basePositionSize and LPM multiplier
    const basePositionValueUSDT = basePositionSize * cappedLpmMultiplier;
    
    // Calculate dollar risk per trade using base position value (specification step 1)
    const dollarRiskPerTrade = basePositionValueUSDT;
    console.log('[VOLATILITY_SIZING] 💰 Base position value with LPM:', {
        basePositionSize,
        lpmScore: currentLpmScore,
        lpmMultiplier: cappedLpmMultiplier,
        basePositionValueUSDT,
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

    // Apply portfolio heat constraint (specification step 10)
    if (settings.portfolioHeatMax && openPositions.length > 0) {
        const portfolioHeatResult = calculatePortfolioHeat(openPositions, totalEquity, settings);
        console.log('[VOLATILITY_SIZING] 🔥 Portfolio heat check:', {
            currentHeatPercent: portfolioHeatResult.currentHeatPercent,
            portfolioHeatMax: settings.portfolioHeatMax,
            remainingHeatPercent: portfolioHeatResult.remainingHeatPercent
        });
        
        if (portfolioHeatResult.currentHeatPercent >= settings.portfolioHeatMax) {
            console.log('[VOLATILITY_SIZING] ❌ Portfolio heat limit exceeded');
            return { error: "Portfolio heat limit exceeded - no new positions allowed" };
        }
        
        // Calculate remaining heat capacity for this position
        const positionRisk = cappedPositionValueUSDT * (stopLossDistance / currentPrice);
        if (positionRisk > portfolioHeatResult.maxAllowedNewPositionRisk) {
            console.log('[VOLATILITY_SIZING] 🔥 Scaling down for portfolio heat:', {
                originalRisk: positionRisk,
                maxAllowedRisk: portfolioHeatResult.maxAllowedNewPositionRisk
            });
            
            // Scale down position to fit within remaining heat
            const scaledPositionValue = portfolioHeatResult.maxAllowedNewPositionRisk / (stopLossDistance / currentPrice);
            const scaledQuantityCrypto = scaledPositionValue / currentPrice;
            // Pass balance to respect limits when applying filters (auto-raising and buffer)
            const exchangeResult = applyExchangeFilters(scaledQuantityCrypto, currentPrice, exchangeInfo, symbol, balance);
            
            return {
                isValid: exchangeResult.isValid,
                positionValueUSDT: exchangeResult.positionValueUSDT,
                quantityCrypto: exchangeResult.quantityCrypto,
                calculationMethod: 'volatility_adjusted_scaled_for_heat',
                portfolioHeatApplied: true,
                originalSize: cappedPositionValueUSDT,
                scaledSize: exchangeResult.positionValueUSDT,
                portfolioHeatInfo: portfolioHeatResult
            };
        }
    }

    // Apply exchange filters (specification step 4)
    // Pass available balance so auto-raising and buffer respect balance limits
    const exchangeResult = applyExchangeFilters(cappedQuantityCrypto, currentPrice, exchangeInfo, symbol, balance);
    
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
    // Position sizing calculation with strategic logging
    // console.log('[POSITION_SIZING] 🎯 Calculating position size for:', {
    //     symbol: options.symbol || 'UNKNOWN',
    //     currentPrice: options.currentPrice,
    //     convictionScore: options.convictionScore,
    //     availableCash: options.availableCash
    // });
    
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
    const basePositionSize = strategySettings?.basePositionSize || 100; // Base position size for LPM system
    const riskPerTrade = strategySettings?.riskPerTrade || 2;
    const minimumTradeValue = strategySettings?.minimumTradeValue || 10;
    const maxBalancePercentRisk = strategySettings?.maxBalancePercentRisk || 100; // Default 100%
    const maxBalanceInvestCapUSDT = strategySettings?.maxBalanceInvestCapUSDT || null; // No hard cap by default
    const balanceInTrades = options.balanceInTrades || 0; // Amount currently invested in trades
    
    // LPM/EBR Integration: Use adjustedBalanceRiskFactor if provided
    const adjustedBalanceRiskFactor = options.adjustedBalanceRiskFactor || null;
    const currentLpmScore = options?.lpmScore || 50; // Default to neutral if not provided
    const effectiveRiskPerTrade = adjustedBalanceRiskFactor !== null 
        ? (maxBalancePercentRisk * (adjustedBalanceRiskFactor / 100)) // Scale maxBalancePercentRisk by EBR
        : riskPerTrade; // Fallback to strategy-specific risk
    
    // console.log('[POSITION_SIZING] 🎯 LPM/EBR Integration:', {
    //     adjustedBalanceRiskFactor: adjustedBalanceRiskFactor,
    //     maxBalancePercentRisk: maxBalancePercentRisk,
    //     strategyRiskPerTrade: riskPerTrade,
    //     effectiveRiskPerTrade: effectiveRiskPerTrade,
    //     isUsingDynamicRisk: adjustedBalanceRiskFactor !== null
    // });

    // Settings extracted (logs removed for performance)

    // Apply global constraints (specification: Additional Overarching Constraints)
    // Applying global constraints
    
    // Constraint 1: maxBalancePercentRisk (Soft Cap)
    const effectiveMaxBalance = totalWalletBalance * (maxBalancePercentRisk / 100);
    const effectiveAvailableCash = Math.min(availableCash, effectiveMaxBalance);
    
    // console.log('[POSITION_SIZING] 💰 Soft cap (maxBalancePercentRisk):', {
    //     totalWalletBalance,
    //     maxBalancePercentRisk,
    //     effectiveMaxBalance,
    //     originalAvailableCash: availableCash,
    //     effectiveAvailableCash
    // });

    // Constraint 2: maxBalanceInvestCapUSDT (Hard Cap)
    let finalAvailableCash = effectiveAvailableCash;
    if (maxBalanceInvestCapUSDT && maxBalanceInvestCapUSDT > 0) {
        const remainingInvestCap = maxBalanceInvestCapUSDT - balanceInTrades;
        finalAvailableCash = Math.min(effectiveAvailableCash, remainingInvestCap);
        
        // console.log('[POSITION_SIZING] 🚫 Hard cap (maxBalanceInvestCapUSDT):', {
        //     maxBalanceInvestCapUSDT,
        //     balanceInTrades,
        //     remainingInvestCap,
        //     finalAvailableCash
        // });
    }

    // Update available cash for calculations
    const adjustedAvailableCash = finalAvailableCash;
    // console.log('[POSITION_SIZING] ✅ Final available cash after constraints:', {
    //     originalAvailableCash: availableCash,
    //     finalAvailableCash: adjustedAvailableCash,
    //     constraintsApplied: availableCash !== adjustedAvailableCash
    // });


    // Check if we have enough balance (using adjusted available cash)
    if (adjustedAvailableCash < minimumTradeValue) {
        // console.log('[POSITION_SIZING] ❌ Insufficient balance after constraints:', {
        //     originalAvailableCash: availableCash,
        //     adjustedAvailableCash,
        //     minimumTradeValue,
        //     difference: adjustedAvailableCash - minimumTradeValue,
        //     constraintsApplied: availableCash !== adjustedAvailableCash
        // });
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
        // console.log('[POSITION_SIZING] 🔄 Using volatility-adjusted sizing');
        
        // Get ATR from indicators - extract the last valid value from the array
        let atr = 0;
        if (indicators?.atr) {
            if (Array.isArray(indicators.atr) && indicators.atr.length > 0) {
                // Find the last valid (non-null) ATR value
                for (let i = indicators.atr.length - 1; i >= 0; i--) {
                    if (indicators.atr[i] !== null && indicators.atr[i] !== undefined && !isNaN(indicators.atr[i])) {
                        atr = indicators.atr[i];
                        break;
                    }
                }
            } else if (typeof indicators.atr === 'number' && !isNaN(indicators.atr)) {
                atr = indicators.atr;
            }
        }
        const stopLossAtrMultiplier = 2.0; // Default ATR multiplier for stop loss
        
        // console.log('[POSITION_SIZING] 📈 ATR CALCULATION DETAILS:', {
        //     symbol: options.symbol || 'UNKNOWN',
        //     atr: atr,
        //     atrValue: atr,
        //     atrType: typeof atr,
        //     atrPercentage: atr ? (atr / currentPrice) * 100 : 'N/A',
        //     stopLossAtrMultiplier: stopLossAtrMultiplier,
        //     currentPrice: currentPrice,
        //     riskPerTrade: riskPerTrade,
        //     availableIndicators: options.indicators ? Object.keys(options.indicators) : 'none',
        //     indicatorsData: options.indicators,
        //     atrCalculation: {
        //         source: 'indicators.atr from technical analysis (last valid value)',
        //         value: atr,
        //         unit: 'price units',
        //         usage: 'Used for volatility-adjusted position sizing',
        //         stopLossDistance: atr * stopLossAtrMultiplier,
        //         explanation: `ATR of ${atr} means stop loss will be ${atr * stopLossAtrMultiplier} price units away`
        //     }
        // });
        
        if (!atr || atr <= 0) {
            // Missing ATR data - show error to user
            console.error('[POSITION_SIZING] ❌ MISSING ATR DATA - THIS CAUSES ZERO QUANTITY:', {
                symbol: options.symbol || 'UNKNOWN',
                atr: atr,
                indicators: options.indicators ? Object.keys(options.indicators) : 'none',
                message: 'ATR (Average True Range) is required for volatility-adjusted sizing but not available',
                impact: 'This will result in zero quantity positions because ATR is needed for position sizing',
                solution: 'Need to ensure ATR is calculated and passed in indicators object'
            });
            
            return {
                isValid: false,
                reason: 'missing_atr',
                message: 'ATR (Average True Range) is required for volatility-adjusted sizing but not available'
            };
        }

        // console.log('[POSITION_SIZING] 🔄 Calling calculateVolatilityAdjustedSize with ATR:', {
        //     symbol: options.symbol || 'UNKNOWN',
        //     atr: atr,
        //     stopLossAtrMultiplier: stopLossAtrMultiplier,
        //     balance: adjustedAvailableCash,
        //     riskPercentage: riskPerTrade,
        //     convictionScore: convictionScore,
        //     currentPrice: currentPrice
        // });
        
        result = calculateVolatilityAdjustedSize({
            balance: adjustedAvailableCash,
            riskPercentage: effectiveRiskPerTrade,
            atr: atr,
            stopLossAtrMultiplier: stopLossAtrMultiplier,
            convictionScore: convictionScore,
            currentPrice: currentPrice,
            exchangeInfo: options.exchangeInfo,
            symbol: options.symbol || 'UNKNOWN',
            openPositions: options.openPositions || [],
            totalEquity: totalWalletBalance,
            settings: {
                portfolioHeatMax: strategySettings?.portfolioHeatMax || null
            },
            basePositionSize: basePositionSize, // Pass base position size for LPM system
            lpmScore: currentLpmScore // Pass LPM score
        });
        
        // console.log('[POSITION_SIZING] 📊 Volatility-adjusted result with ATR:', {
        //     symbol: options.symbol || 'UNKNOWN',
        //     atr: atr,
        //     result: result
        // });
        calculationMethod = 'volatility_adjusted';
    } else {
        // Use fixed sizing
        // console.log('[POSITION_SIZING] 🔄 Using fixed sizing');
        
        result = calculateFixedSize({
            defaultSize: defaultPositionSize,
            convictionScore: convictionScore,
            balance: adjustedAvailableCash,
            minimumConvictionScore: strategySettings?.minimumConvictionScore || 50,
            currentPrice: currentPrice,
            exchangeInfo: options.exchangeInfo,
            symbol: options.symbol || 'UNKNOWN',
            lpmScore: currentLpmScore
        });
        
        // console.log('[POSITION_SIZING] 📊 Fixed sizing result:', result);
        calculationMethod = 'fixed';
    }

    if (result.error) {
        // console.log('[POSITION_SIZING] ❌ Calculation error:', result.error);
        return {
            isValid: false,
            reason: 'calculation_error',
            message: result.error
        };
    }

    // Validate the calculated position size
    // console.log('[POSITION_SIZING] 🔍 Validating position size:', {
    //     positionSize: result.positionSize,
    //     minimumTradeValue,
    //     difference: result.positionSize - minimumTradeValue,
    //     isValid: result.positionSize >= minimumTradeValue
    // });

    if (result.positionSize < minimumTradeValue) {
        // console.log('[POSITION_SIZING] ❌ Position size below minimum:', {
            //positionSize: result.positionSize,
            //minimumTradeValue,
            //calculationMethod,
            //availableCash,
            //convictionScore
        //});
        return {
            isValid: false,
            reason: 'below_minimum',
            message: `Calculated position size $${result.positionSize.toFixed(2)} is below minimum trade value $${minimumTradeValue}`,
            positionSize: result.positionSize,
            calculationMethod: calculationMethod
        };
    }
/*
    // Log final result
     console.log('[POSITION_SIZING] ✅ Final result:', {
       // symbol: options.symbol || 'UNKNOWN',
        positionSize: result.positionSize,
        quantityCrypto: result.quantityCrypto,
        method: calculationMethod
    });
*/
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