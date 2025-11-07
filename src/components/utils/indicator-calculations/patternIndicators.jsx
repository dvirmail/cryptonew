import { detectChartPatterns as detectChartPatternsAdvanced } from '../signals/chartPatternDetection.jsx';

/**
 * Detects basic candlestick patterns in a given dataset.
 * Returns objects with readyForAnalysis flag for the evaluation code.
 * @param {Array<object>} klines - Array of kline data.
 * @returns {Array<object>} An array where each element is an object with readyForAnalysis and pattern flags.
 */
export const detectCandlestickPatterns = (klines) => {
    if (!klines || klines.length === 0) return [];

    const allPatterns = [];

    for (let i = 0; i < klines.length; i++) {
        const candle = klines[i];
        
        // Basic check for valid candle data
        if (!candle || candle.open === undefined || candle.high === undefined || candle.low === undefined || candle.close === undefined) {
            // Return object with readyForAnalysis=false for invalid candles
            allPatterns.push({ readyForAnalysis: false });
            continue;
        }

        // readyForAnalysis is true if we have at least one previous candle (needed for two-candle patterns)
        const readyForAnalysis = i >= 1;

        // CRITICAL: Return object format expected by evaluateCandlestickCondition
        // MUST be an object, NOT an array. Each element of allPatterns must be an object.
        // The actual pattern detection happens in evaluateCandlestickCondition based on candle data
        const patternObj = {
            readyForAnalysis: readyForAnalysis
        };
        
        // Safety check: Ensure we're pushing an object, not an array
        if (Array.isArray(patternObj)) {
            console.error(`[PATTERN_INDICATORS] ❌ CRITICAL: detectCandlestickPatterns created an array instead of object at index ${i}`);
            allPatterns.push({ readyForAnalysis: false });
        } else {
            allPatterns.push(patternObj);
        }
    }

    // Final validation: Ensure each element is an object
    const hasArrayElements = allPatterns.some(p => Array.isArray(p));
    if (hasArrayElements) {
        console.error(`[PATTERN_INDICATORS] ❌ CRITICAL: detectCandlestickPatterns returned array with array elements! Converting...`);
        return allPatterns.map(p => Array.isArray(p) ? { readyForAnalysis: false } : p);
    }

    return allPatterns;
};

/**
 * Detects chart patterns using the proper implementation and transforms to expected format.
 * @param {Array<object>} klines - Array of kline data.
 * @param {object} settings - Optional settings for pattern detection.
 * @returns {Array<object>} An array where each element is an object with pattern boolean flags.
 */
export const detectChartPatterns = (klines, settings = {}) => {
    if (!klines || klines.length === 0) return [];

    const allPatterns = [];

    for (let i = 0; i < klines.length; i++) {
        // Initialize pattern flags object
        // CRITICAL: This MUST be an object with boolean flags, NOT an array
        const patternFlags = {
            headAndShoulders: false,
            inverseHeadAndShoulders: false,
            doubleTop: false,
            doubleBottom: false,
            triangleAscending: false,
            triangleDescending: false,
            triangleSymmetrical: false,
            wedgeRising: false,
            wedgeFalling: false,
            flag: false,
            pennant: false,
            breakout: false,
            breakdown: false
        };

        // Only detect patterns if we have enough data (minPatternLength = 10)
        if (i >= 10 && detectChartPatternsAdvanced) {
            try {
                // Call the proper chart pattern detection function
                // This returns an array of pattern objects like [{ type: 'Inverse Head and Shoulders', ... }]
                const detectedPatterns = detectChartPatternsAdvanced(klines, i, settings);
                
                if (detectedPatterns && Array.isArray(detectedPatterns) && detectedPatterns.length > 0) {
                    // Transform the detected patterns into boolean flags on patternFlags object
                    detectedPatterns.forEach(pattern => {
                        if (pattern && pattern.type) {
                            const patternType = pattern.type.toLowerCase();
                            
                            // Map pattern types to flags
                            if (patternType.includes('inverse head and shoulders') || patternType.includes('inverse head & shoulders')) {
                                patternFlags.inverseHeadAndShoulders = true;
                            } else if (patternType.includes('head and shoulders') || patternType.includes('head & shoulders')) {
                                patternFlags.headAndShoulders = true;
                            } else if (patternType.includes('double bottom')) {
                                patternFlags.doubleBottom = true;
                            } else if (patternType.includes('double top')) {
                                patternFlags.doubleTop = true;
                            } else if (patternType.includes('ascending triangle')) {
                                patternFlags.triangleAscending = true;
                            } else if (patternType.includes('descending triangle')) {
                                patternFlags.triangleDescending = true;
                            } else if (patternType.includes('symmetrical triangle')) {
                                patternFlags.triangleSymmetrical = true;
                            } else if (patternType.includes('rising wedge')) {
                                patternFlags.wedgeRising = true;
                            } else if (patternType.includes('falling wedge')) {
                                patternFlags.wedgeFalling = true;
                            } else if (patternType.includes('flag')) {
                                patternFlags.flag = true;
                            } else if (patternType.includes('pennant')) {
                                patternFlags.pennant = true;
                            }
                        }
                    });
                }
            } catch (error) {
                console.warn(`[PATTERN_INDICATORS] Error detecting chart patterns at index ${i}:`, error);
            }
        }
        
        // Safety check: Ensure patternFlags is an object, not an array
        if (Array.isArray(patternFlags)) {
            console.error(`[PATTERN_INDICATORS] ❌ CRITICAL: detectChartPatterns created an array instead of object at index ${i}`);
            // Fallback to default object
            allPatterns.push({
                headAndShoulders: false,
                inverseHeadAndShoulders: false,
                doubleTop: false,
                doubleBottom: false,
                triangleAscending: false,
                triangleDescending: false,
                triangleSymmetrical: false,
                wedgeRising: false,
                wedgeFalling: false,
                flag: false,
                pennant: false,
                breakout: false,
                breakdown: false
            });
        } else {
            allPatterns.push(patternFlags);
        }
    }

    // Final validation: Ensure each element is an object
    const hasArrayElements = allPatterns.some(p => Array.isArray(p));
    if (hasArrayElements) {
        console.error(`[PATTERN_INDICATORS] ❌ CRITICAL: detectChartPatterns returned array with array elements! Converting...`);
        return allPatterns.map(p => {
            if (Array.isArray(p)) {
                // Convert array to default object
                return {
                    headAndShoulders: false,
                    inverseHeadAndShoulders: false,
                    doubleTop: false,
                    doubleBottom: false,
                    triangleAscending: false,
                    triangleDescending: false,
                    triangleSymmetrical: false,
                    wedgeRising: false,
                    wedgeFalling: false,
                    flag: false,
                    pennant: false,
                    breakout: false,
                    breakdown: false
                };
            }
            return p;
        });
    }

    return allPatterns;
};
