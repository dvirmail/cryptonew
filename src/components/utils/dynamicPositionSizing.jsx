/**
 * Calculate position size using fixed sizing with conviction adjustment
 */
export function calculateFixedSize({ defaultSize, convictionScore, balance }) {
    console.log(`[position_size_debug] === calculateFixedSize START ===`);
    console.log(`[position_size_debug] Input Parameters:`);
    console.log(`[position_size_debug]   • Default Size: $${defaultSize}`);
    console.log(`[position_size_debug]   • Conviction Score: ${convictionScore}`);
    console.log(`[position_size_debug]   • Available Balance: $${balance}`);
    
    if (!defaultSize || typeof defaultSize !== 'number' || defaultSize <= 0) {
        console.error(`[position_size_debug] ❌ Invalid defaultSize: ${defaultSize}`);
        return { error: "Invalid default position size" };
    }

    if (!convictionScore || typeof convictionScore !== 'number' || convictionScore <= 0) {
        console.error(`[position_size_debug] ❌ Invalid convictionScore: ${convictionScore}`);
        return { error: "Invalid conviction score" };
    }

    if (!balance || typeof balance !== 'number' || balance < 0) {
        console.error(`[position_size_debug] ❌ Invalid balance: ${balance}`);
        return { error: "Invalid balance for position sizing" };
    }

    // Calculate conviction multiplier (0.1x to 2.0x based on 0-100 score)
    const convictionMultiplier = Math.max(0.1, Math.min(2.0, convictionScore / 100));
    const adjustedSize = defaultSize * convictionMultiplier;
    
    // Cap the final size by available balance
    const finalSize = Math.min(adjustedSize, balance);

    console.log(`[position_size_debug] Calculation Steps:`);
    console.log(`[position_size_debug]   • Conviction Multiplier: ${convictionMultiplier.toFixed(3)}x`);
    console.log(`[position_size_debug]   • Adjusted Size: $${adjustedSize.toFixed(2)}`);
    console.log(`[position_size_debug]   • Final Size (capped by balance): $${finalSize.toFixed(2)}`);
    console.log(`[position_size_debug] === calculateFixedSize END ===`);

    return {
        positionSize: finalSize,
        riskAmount: finalSize, // For fixed sizing, risk amount equals position size
        stopLossPrice: null,   // Fixed sizing doesn't calculate stop loss
        convictionMultiplier: convictionMultiplier
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
    currentPrice 
}) {
    console.log(`[position_size_debug] === calculateVolatilityAdjustedSize START ===`);
    console.log(`[position_size_debug] Input Parameters:`);
    console.log(`[position_size_debug]   • Available Balance: $${balance}`);
    console.log(`[position_size_debug]   • Risk Percentage: ${riskPercentage}%`);
    console.log(`[position_size_debug]   • ATR: ${atr}`);
    console.log(`[position_size_debug]   • Stop Loss ATR Multiplier: ${stopLossAtrMultiplier}`);
    console.log(`[position_size_debug]   • Conviction Score: ${convictionScore}`);
    console.log(`[position_size_debug]   • Current Price: $${currentPrice}`);

    if (!balance || typeof balance !== 'number' || balance <= 0) {
        console.error(`[position_size_debug] ❌ Invalid balance: ${balance}`);
        return { error: "Invalid balance for volatility-adjusted sizing" };
    }

    if (!atr || typeof atr !== 'number' || atr <= 0) {
        console.error(`[position_size_debug] ❌ Invalid ATR: ${atr}`);
        return { error: "Invalid ATR value for volatility-adjusted sizing" };
    }

    if (!currentPrice || typeof currentPrice !== 'number' || currentPrice <= 0) {
        console.error(`[position_size_debug] ❌ Invalid currentPrice: ${currentPrice}`);
        return { error: "Invalid current price for volatility-adjusted sizing" };
    }

    // Calculate risk amount based on balance and risk percentage
    const riskAmount = (balance * riskPercentage) / 100;
    console.log(`[position_size_debug]   • Risk Amount: $${riskAmount.toFixed(2)}`);
    
    // Calculate stop loss distance based on ATR
    const stopLossDistance = atr * stopLossAtrMultiplier;
    console.log(`[position_size_debug]   • Stop Loss Distance: $${stopLossDistance.toFixed(4)}`);
    
    const stopLossPrice = currentPrice - stopLossDistance; // Assuming long positions
    console.log(`[position_size_debug]   • Stop Loss Price: $${stopLossPrice.toFixed(4)}`);
    
    // Calculate position size based on risk amount and stop loss distance
    const positionSize = riskAmount / stopLossDistance * currentPrice;
    console.log(`[position_size_debug]   • Base Position Size: $${positionSize.toFixed(2)}`);
    
    // Apply conviction adjustment
    const convictionMultiplier = Math.max(0.5, Math.min(1.5, convictionScore / 100));
    console.log(`[position_size_debug]   • Conviction Multiplier: ${convictionMultiplier.toFixed(3)}x`);
    
    const adjustedPositionSize = positionSize * convictionMultiplier;
    console.log(`[position_size_debug]   • Adjusted Position Size: $${adjustedPositionSize.toFixed(2)}`);
    
    // Cap by available balance
    const finalPositionSize = Math.min(adjustedPositionSize, balance);
    console.log(`[position_size_debug]   • Final Position Size (capped): $${finalPositionSize.toFixed(2)}`);

    console.log(`[position_size_debug] === calculateVolatilityAdjustedSize END ===`);

    return {
        positionSize: finalPositionSize,
        riskAmount: riskAmount,
        stopLossPrice: stopLossPrice,
        convictionMultiplier: convictionMultiplier
    };
}