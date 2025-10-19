
/**
 * Position Size Validator
 * Validates position sizes against exchange rules and settings
 */

// Helper function for volatility-adjusted sizing calculation
const calculateVolatilityAdjustedSize = ({
    balance,
    riskPercentage,
    atr,
    stopLossAtrMultiplier,
    currentPrice
}) => {
    // Basic validation for critical inputs
    if (balance === undefined || riskPercentage === undefined || atr === undefined || stopLossAtrMultiplier === undefined || currentPrice === undefined || currentPrice <= 0 || riskPercentage <= 0) {
        return { error: 'Missing or invalid parameters for volatility-adjusted size calculation: balance, riskPercentage, atr, stopLossAtrMultiplier, currentPrice must be positive numbers.' };
    }
    // Assume riskPercentage is a decimal (e.g., 0.01 for 1%)
    // If it's passed as 5 for 5%, convert it.
    let effectiveRiskPercentage = riskPercentage;
    if (riskPercentage > 1) { 
        console.warn('riskPercentage is greater than 1, assuming it is a percentage (e.g., 5 for 5%) and converting to decimal for volatility-adjusted sizing.');
        effectiveRiskPercentage /= 100;
    }

    // Risk per trade in USDT (e.g., 1% of balance)
    const riskAmountUSDT = balance * effectiveRiskPercentage;

    // Dollar risk per unit (based on ATR and current price)
    // If ATR is in price units (e.g., $X per coin), then stop loss per unit = ATR * multiplier
    const dollarRiskPerUnit = atr * stopLossAtrMultiplier;

    if (dollarRiskPerUnit <= 0) {
        return { error: 'Calculated dollar risk per unit is zero or negative. Cannot determine position size for volatility-adjusted sizing. Check ATR or stopLossAtrMultiplier values.' };
    }

    // Number of units to trade
    const numUnits = riskAmountUSDT / dollarRiskPerUnit;

    // Position size in USDT
    const positionSizeUSDT = numUnits * currentPrice;

    return {
        positionSizeUSDT: positionSizeUSDT,
        riskAmountUSDT,
        dollarRiskPerUnit,
        numUnits,
    };
};


export const positionSizeValidator = {
    /**
     * Validates if a position size meets all requirements
     * @param {number} positionSizeUSDT - The calculated position size in USDT
     * @param {object} options - Validation options
     * @param {number} [options.minimumTradeValue=10] - Minimum trade value in USDT
     * @param {number} [options.availableBalance=0] - Available balance in USDT
     * @param {string} [options.symbol='UNKNOWN'] - Trading symbol
     * @param {object} [options.exchangeInfo=null] - Exchange info containing symbol filters
     * @returns {object} - Validation result with isValid flag and reason
     */
    validate(positionSizeUSDT, options = {}) {
        const {
            minimumTradeValue = 10,
            availableBalance = 0,
            symbol = 'UNKNOWN',
            exchangeInfo = null
        } = options;

        // Check if position size is a valid number
        if (typeof positionSizeUSDT !== 'number' || isNaN(positionSizeUSDT) || positionSizeUSDT <= 0) {
            return {
                isValid: false,
                reason: 'invalid_number',
                message: 'Position size must be a positive number'
            };
        }

        // Check minimum trade value
        if (positionSizeUSDT < minimumTradeValue) {
            return {
                isValid: false,
                reason: 'below_minimum',
                message: `Position size $${positionSizeUSDT.toFixed(2)} is below minimum ($${minimumTradeValue.toFixed(2)})`
            };
        }

        // Check available balance
        if (positionSizeUSDT > availableBalance) {
            return {
                isValid: false,
                reason: 'insufficient_balance',
                message: `Position size $${positionSizeUSDT.toFixed(2)} exceeds available balance ($${availableBalance.toFixed(2)})`
            };
        }

        // Check exchange-specific rules if exchange info is provided
        if (exchangeInfo && symbol) {
            const symbolInfo = exchangeInfo[symbol];
            if (symbolInfo) {
                const minNotional = symbolInfo.filters?.MIN_NOTIONAL?.minNotional;
                if (minNotional && positionSizeUSDT < parseFloat(minNotional)) {
                    return {
                        isValid: false,
                        reason: 'exchange_min_notional',
                        message: `Position size $${positionSizeUSDT.toFixed(2)} below exchange minimum ($${minNotional})`
                    };
                }
            }
        }

        return {
            isValid: true,
            reason: null,
            message: null
        };
    },

    /**
     * Calculates the optimal position size based on various parameters and then validates it.
     * This method supersedes the legacy 'calculate' which just mapped to 'validate'.
     *
     * @param {object} params - Calculation and validation parameters
     * @param {number} params.balance - Available balance in USDT
     * @param {number} params.riskPercentage - Percentage of balance to risk per trade (e.g., 0.01 for 1%)
     * @param {number} params.atr - Average True Range for volatility calculation
     * @param {number} params.stopLossAtrMultiplier - Multiplier for ATR to determine stop loss distance
     * @param {number} params.convictionScore - A score (e.g., 0-1) to adjust default position size
     * @param {number} params.currentPrice - Current price of the asset
     * @param {number} params.defaultPositionSize - Default position size in USDT for fixed sizing
     * @param {boolean} [params.useWinStrategySize=true] - If true, uses volatility-adjusted sizing; otherwise, uses fixed sizing.
     * @param {number} [params.minimumTradeValue=10] - Minimum trade value in USDT for validation
     * @param {string} [params.symbol='UNKNOWN'] - Trading symbol for exchange-specific validation
     * @param {object} [params.exchangeInfo=null] - Exchange info containing symbol filters for validation
     * @returns {object} - Calculation and validation result with isValid flag, reason, message, and calculated positionSizeUSDT
     */
    calculate(params) {
        const {
            balance,
            riskPercentage,
            atr,
            stopLossAtrMultiplier,
            convictionScore,
            currentPrice,
            defaultPositionSize,
            useWinStrategySize = true, // Default to true if not provided
            minimumTradeValue
        } = params;

        let positionSizeUSDT;
        let calculationMethod;
        let calculationDetails = {};

        if (useWinStrategySize !== false) { 
            const sizeResult = calculateVolatilityAdjustedSize({
                balance,
                riskPercentage,
                atr,
                stopLossAtrMultiplier,
                convictionScore, // Added as per outline; note: calculateVolatilityAdjustedSize function currently does not use this parameter
                currentPrice
            });

            if (sizeResult.error) {
                return {
                    isValid: false,
                    reason: 'calculation_error',
                    message: sizeResult.error,
                    details: sizeResult.error,
                    positionSizeUSDT: undefined 
                };
            }

            positionSizeUSDT = sizeResult.positionSizeUSDT;
            calculationMethod = 'volatility_adjusted';
            calculationDetails = sizeResult;
        } else {
            if (defaultPositionSize === undefined || typeof defaultPositionSize !== 'number' || defaultPositionSize <= 0) {
                return {
                    isValid: false,
                    reason: 'invalid_default_size',
                    message: 'Default position size must be a positive number for fixed sizing.',
                    positionSizeUSDT: undefined
                };
            }
            
            let effectiveConvictionScore = 1.0; // Default to full conviction
            if (convictionScore === undefined || typeof convictionScore !== 'number') {
                 console.warn('convictionScore is undefined or not a number for FIXED sizing. Using 1.0.');
                 calculationDetails.convictionApplied = false;
                 calculationDetails.originalConvictionScore = convictionScore;
            } else {
                // Assume convictionScore is a multiplier between 0 and 1.
                effectiveConvictionScore = Math.max(0, Math.min(1, convictionScore)); // Clamp between 0 and 1
                calculationDetails.convictionApplied = true;
                calculationDetails.originalConvictionScore = convictionScore;
            }

            positionSizeUSDT = defaultPositionSize * effectiveConvictionScore;
            calculationMethod = 'fixed_conviction_adjusted';
            calculationDetails = {
                ...calculationDetails,
                defaultPositionSize,
                effectiveConvictionScore
            };
        }

        // Validate the final position size
        if (!positionSizeUSDT || isNaN(positionSizeUSDT) || positionSizeUSDT <= 0) {
            return {
                isValid: false,
                reason: 'invalid_number',
                message: 'Position size must be a positive number',
                positionSizeUSDT: undefined
            };
        }

        if (positionSizeUSDT < minimumTradeValue) {
            return {
                isValid: false,
                reason: 'below_minimum',
                message: `Position size ${positionSizeUSDT.toFixed(2)} USDT is below minimum ${minimumTradeValue} USDT`,
                positionSizeUSDT,
                details: `Calculated position size of ${positionSizeUSDT.toFixed(2)} USDT is below the minimum trade value of ${minimumTradeValue} USDT`
            };
        }

        // Perform remaining general validation using the existing validate method
        const validationResult = this.validate(positionSizeUSDT, {
            minimumTradeValue: minimumTradeValue,
            availableBalance: balance,
            symbol: params.symbol,
            exchangeInfo: params.exchangeInfo
        });

        // Combine calculation and validation results
        if (!validationResult.isValid) {
            return {
                isValid: validationResult.isValid,
                reason: validationResult.reason,
                message: validationResult.message,
                positionSizeUSDT: positionSizeUSDT, 
                calculationMethod: calculationMethod,
                calculationDetails: calculationDetails,
            };
        } else {
            // All checks passed
            return {
                isValid: true,
                positionSizeUSDT,
                calculationMethod,
                calculationDetails
            };
        }
    },

    /**
     * Validates position size and returns boolean
     * @param {number} positionSizeUSDT - The calculated position size in USDT
     * @param {object} options - Validation options
     * @returns {boolean} - True if valid, false otherwise
     */
    isValid(positionSizeUSDT, options = {}) {
        const result = this.validate(positionSizeUSDT, options);
        return result.isValid;
    },

    /**
     * Adjusts position size to meet minimum requirements
     * @param {number} positionSizeUSDT - The calculated position size in USDT
     * @param {object} options - Validation options
     * @returns {number} - Adjusted position size
     */
    adjust(positionSizeUSDT, options = {}) {
        const {
            minimumTradeValue = 10,
            availableBalance = 0
        } = options;

        // Ensure it's a valid number
        if (typeof positionSizeUSDT !== 'number' || isNaN(positionSizeUSDT) || positionSizeUSDT <= 0) {
            return minimumTradeValue;
        }

        // Ensure it meets minimum
        let adjusted = Math.max(positionSizeUSDT, minimumTradeValue);

        // Ensure it doesn't exceed available balance
        adjusted = Math.min(adjusted, availableBalance);

        return adjusted;
    }
};

export default positionSizeValidator;
