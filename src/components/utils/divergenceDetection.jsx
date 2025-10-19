import { get } from 'lodash';

/**
 * Finds swing points in a data array.
 * A swing low is a point lower than 'lookback' points on either side.
 * A swing high is a point higher than 'lookback' points on either side.
 * @param {number[]} data - The array of numbers (e.g., prices or indicator values).
 * @param {number} lookback - The number of bars to look on each side.
 * @param {'high' | 'low'} type - The type of swing point to find.
 * @returns {Array<{index: number, value: number}>} - An array of swing points.
 */
function findSwingPoints(data, lookback, type) {
    const swingPoints = [];
    if (data.length < (2 * lookback + 1)) {
        return [];
    }

    for (let i = lookback; i < data.length - lookback; i++) {
        const currentValue = data[i];
        if (currentValue === null || currentValue === undefined) continue;

        let isSwing = true;
        for (let j = 1; j <= lookback; j++) {
            const leftValue = data[i - j];
            const rightValue = data[i + j];

            if (type === 'low') {
                if ((leftValue !== null && leftValue < currentValue) || (rightValue !== null && rightValue < currentValue)) {
                    isSwing = false;
                    break;
                }
            } else { // 'high'
                if ((leftValue !== null && leftValue > currentValue) || (rightValue !== null && rightValue > currentValue)) {
                    isSwing = false;
                    break;
                }
            }
        }

        if (isSwing) {
            swingPoints.push({ index: i, value: currentValue });
            i += lookback; // Skip forward to avoid finding adjacent points in the same swing
        }
    }
    return swingPoints;
}


/**
 * Detects divergence between price and an indicator.
 * @param {Array<object>} priceData - Array of kline objects.
 * @param {number[]} indicatorData - Array of indicator values.
 * @param {number} currentIndex - The index to check for divergence at.
 * @param {number} lookback - How far to look back for swing points.
 * @param {'bullish' | 'bearish'} type - The type of divergence to detect.
 * @returns {object | null} - Divergence information or null.
 */
export function detectDivergence(priceData, indicatorData, currentIndex, lookback = 10, type = 'bullish') {
    if (currentIndex < 2 * lookback + 1) return null;

    const priceSlice = priceData.slice(0, currentIndex + 1);
    const indicatorSlice = indicatorData.slice(0, currentIndex + 1);
    
    const priceValues = type === 'bullish' ? priceSlice.map(c => parseFloat(c.low)) : priceSlice.map(c => parseFloat(c.high));
    
    const swingType = type === 'bullish' ? 'low' : 'high';
    const priceSwings = findSwingPoints(priceValues, lookback, swingType);
    const indicatorSwings = findSwingPoints(indicatorSlice, lookback, swingType);

    if (priceSwings.length < 2 || indicatorSwings.length < 2) return null;

    // Get the last two swings for both
    const lastPriceSwing = priceSwings[priceSwings.length - 1];
    const prevPriceSwing = priceSwings[priceSwings.length - 2];
    
    // Find corresponding indicator swings. This is tricky. We'll find the closest ones.
    const findClosestIndicatorSwing = (priceSwingIndex) => {
        return indicatorSwings.reduce((closest, current) => {
            return Math.abs(current.index - priceSwingIndex) < Math.abs(closest.index - priceSwingIndex) ? current : closest;
        }, { index: -1, value: 0 });
    };

    const lastIndicatorSwing = findClosestIndicatorSwing(lastPriceSwing.index);
    const prevIndicatorSwing = findClosestIndicatorSwing(prevPriceSwing.index);

    if (lastIndicatorSwing.index === prevIndicatorSwing.index) return null; // Didn't find two distinct swings

    if (type === 'bullish') {
        // Price: lower low. Indicator: higher low.
        if (lastPriceSwing.value < prevPriceSwing.value && lastIndicatorSwing.value > prevIndicatorSwing.value) {
            return {
                type: 'Bullish Divergence',
                price1: { index: prevPriceSwing.index, value: prevPriceSwing.value },
                price2: { index: lastPriceSwing.index, value: lastPriceSwing.value },
                indicator1: { index: prevIndicatorSwing.index, value: prevIndicatorSwing.value },
                indicator2: { index: lastIndicatorSwing.index, value: lastIndicatorSwing.value }
            };
        }
    } else { // Bearish
        // Price: higher high. Indicator: lower high.
        if (lastPriceSwing.value > prevPriceSwing.value && lastIndicatorSwing.value < prevIndicatorSwing.value) {
            return {
                type: 'Bearish Divergence',
                price1: { index: prevPriceSwing.index, value: prevPriceSwing.value },
                price2: { index: lastPriceSwing.index, value: lastPriceSwing.value },
                indicator1: { index: prevIndicatorSwing.index, value: prevIndicatorSwing.value },
                indicator2: { index: lastIndicatorSwing.index, value: lastIndicatorSwing.value }
            };
        }
    }

    return null;
}