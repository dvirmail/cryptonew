#!/usr/bin/env node

/**
 * Creates a comprehensive test strategy with all enhanced volume indicators
 * Includes: Volume, OBV, CMF, A/D Line, MFI with advanced signals
 */

const fs = require('fs');
const path = require('path');

// Enhanced Volume Indicator Signals
const volumeSignals = [
    // Volume State Signals
    { type: 'volume', value: 'Very High Volume', strength: 80, isEvent: false },
    { type: 'volume', value: 'High Volume', strength: 65, isEvent: false },
    { type: 'volume', value: 'Above Average Volume', strength: 50, isEvent: false },
    { type: 'volume', value: 'Below Average Volume', strength: 35, isEvent: false },
    { type: 'volume', value: 'Low Volume', strength: 20, isEvent: false },
    
    // Volume Event Signals
    { type: 'volume', value: 'Volume Spike', strength: 75, isEvent: true },
    
    // Volume Spread Analysis (VSA) Signals
    { type: 'volume', value: 'No Demand', strength: 80, isEvent: true },
    { type: 'volume', value: 'No Supply', strength: 80, isEvent: true },
    { type: 'volume', value: 'Effort vs Result', strength: 75, isEvent: true },
    { type: 'volume', value: 'Hidden Buying', strength: 70, isEvent: true },
    
    // Volume Climax Signals
    { type: 'volume', value: 'Buying Climax', strength: 90, isEvent: true },
    { type: 'volume', value: 'Selling Climax', strength: 90, isEvent: true },
    
    // Smart Money Flow Signals
    { type: 'volume', value: 'Smart Money Accumulation', strength: 70, isEvent: true },
    { type: 'volume', value: 'Smart Money Distribution', strength: 70, isEvent: true }
];

const obvSignals = [
    // OBV State Signals
    { type: 'obv', value: 'OBV Above SMA', strength: 60, isEvent: false },
    { type: 'obv', value: 'OBV Below SMA', strength: 60, isEvent: false },
    { type: 'obv', value: 'OBV Rising', strength: 45, isEvent: false },
    { type: 'obv', value: 'OBV Falling', strength: 45, isEvent: false },
    
    // OBV Event Signals
    { type: 'obv', value: 'OBV Bullish Crossover', strength: 75, isEvent: true },
    { type: 'obv', value: 'OBV Bearish Crossover', strength: 75, isEvent: true },
    { type: 'OBV', value: 'OBV Bullish Divergence', strength: 85, isEvent: true },
    { type: 'OBV', value: 'OBV Bearish Divergence', strength: 85, isEvent: true }
];

const cmfSignals = [
    // CMF State Signals
    { type: 'cmf', value: 'Strong Positive CMF', strength: 80, isEvent: false },
    { type: 'cmf', value: 'Positive CMF', strength: 55, isEvent: false },
    { type: 'cmf', value: 'Strong Negative CMF', strength: 80, isEvent: false },
    { type: 'cmf', value: 'Negative CMF', strength: 55, isEvent: false },
    { type: 'cmf', value: 'Neutral CMF', strength: 25, isEvent: false },
    { type: 'cmf', value: 'Rising CMF', strength: 65, isEvent: false },
    { type: 'cmf', value: 'Falling CMF', strength: 65, isEvent: false },
    
    // CMF Event Signals
    { type: 'cmf', value: 'Bullish Zero Cross', strength: 70, isEvent: true },
    { type: 'cmf', value: 'Bearish Zero Cross', strength: 70, isEvent: true }
];

const adLineSignals = [
    // A/D Line State Signals
    { type: 'adline', value: 'ADL Above SMA', strength: 70, isEvent: false },
    { type: 'adline', value: 'ADL Below SMA', strength: 70, isEvent: false },
    { type: 'adline', value: 'ADL Rising', strength: 60, isEvent: false },
    { type: 'adline', value: 'ADL Falling', strength: 60, isEvent: false },
    
    // A/D Line Event Signals
    { type: 'adline', value: 'Bullish Crossover', strength: 65, isEvent: true },
    { type: 'adline', value: 'Bearish Crossover', strength: 65, isEvent: true }
];

const mfiSignals = [
    // MFI State Signals (from momentumSignals.jsx)
    { type: 'mfi', value: 'Overbought', strength: 75, isEvent: false },
    { type: 'mfi', value: 'Oversold', strength: 75, isEvent: false },
    { type: 'mfi', value: 'High MFI', strength: 55, isEvent: false },
    { type: 'mfi', value: 'Low MFI', strength: 55, isEvent: false },
    { type: 'mfi', value: 'Neutral MFI', strength: 25, isEvent: false },
    { type: 'mfi', value: 'Rising MFI', strength: 65, isEvent: false },
    { type: 'mfi', value: 'Falling MFI', strength: 65, isEvent: false },
    
    // MFI Event Signals
    { type: 'mfi', value: 'Overbought Exit', strength: 85, isEvent: true },
    { type: 'mfi', value: 'Oversold Exit', strength: 85, isEvent: true },
    { type: 'MFI', value: 'MFI Regular Bullish Divergence', strength: 85, isEvent: true },
    { type: 'MFI', value: 'MFI Regular Bearish Divergence', strength: 85, isEvent: true },
    { type: 'MFI', value: 'MFI Hidden Bullish Divergence', strength: 80, isEvent: true },
    { type: 'MFI', value: 'MFI Hidden Bearish Divergence', strength: 80, isEvent: true }
];

// Combine all volume-related signals
const allVolumeSignals = [
    ...volumeSignals,
    ...obvSignals,
    ...cmfSignals,
    ...adLineSignals,
    ...mfiSignals
];

// Create the comprehensive strategy
const strategy = {
    combination_name: 'Phase 2 - Enhanced Volume Indicators Comprehensive Test',
    coin: 'ETH',
    timeframe: '15m',
    signals: allVolumeSignals,
    signalCount: allVolumeSignals.length,
    combinedStrength: allVolumeSignals.reduce((sum, s) => sum + (s.strength || 0), 0),
    successRate: 0,
    occurrences: 0,
    occurrenceDates: [],
    avgPriceMove: 0,
    recommendedTradingStrategy: 'Enhanced Volume Analysis - Tests all volume indicators with VSA, Climax, Smart Money Flow, and advanced divergences',
    includedInScanner: false,
    included_in_live_scanner: false,
    takeProfitPercentage: 5,
    stopLossPercentage: 2,
    positionSizePercentage: 1,
    estimatedExitTimeMinutes: 240,
    strategyDirection: 'long',
    enableTrailingTakeProfit: false,
    trailingStopPercentage: 0,
    is_event_driven_strategy: false,
    dominant_market_regime: 'uptrend'
};

// Generate ID (format: combination_name-coin-timeframe)
const strategyId = `${strategy.combination_name.replace(/\s+/g, '-')}-${strategy.coin}-${strategy.timeframe}`;

// Save to file storage
const storagePath = path.join(__dirname, 'storage', 'backtestCombinations.json');
let existingCombinations = [];

if (fs.existsSync(storagePath)) {
    try {
        const fileContent = fs.readFileSync(storagePath, 'utf8');
        existingCombinations = JSON.parse(fileContent);
    } catch (error) {
        console.error('Error reading existing combinations:', error.message);
        existingCombinations = [];
    }
}

// Remove existing strategy if it exists
existingCombinations = existingCombinations.filter(c => 
    !(c.combination_name === strategy.combination_name && 
      c.coin === strategy.coin && 
      c.timeframe === strategy.timeframe)
);

// Add new strategy
existingCombinations.push({
    id: strategyId,
    ...strategy
});

// Save back to file
fs.writeFileSync(storagePath, JSON.stringify(existingCombinations, null, 2));
console.log(`✅ Strategy saved to file storage: ${storagePath}`);
console.log(`📊 Strategy ID: ${strategyId}`);
console.log(`📈 Total signals: ${allVolumeSignals.length}`);
console.log(`   - Volume signals: ${volumeSignals.length}`);
console.log(`   - OBV signals: ${obvSignals.length}`);
console.log(`   - CMF signals: ${cmfSignals.length}`);
console.log(`   - A/D Line signals: ${adLineSignals.length}`);
console.log(`   - MFI signals: ${mfiSignals.length}`);

// Now save to database using curl (POST request)
const http = require('http');

const postData = JSON.stringify(strategy);

const options = {
    hostname: 'localhost',
    port: 3003,
    path: '/api/backtestCombinations',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
            console.log('✅ Strategy saved to database successfully');
            try {
                const response = JSON.parse(data);
                console.log('📊 Database response:', JSON.stringify(response, null, 2));
            } catch (e) {
                console.log('📊 Database response (raw):', data);
            }
        } else {
            console.error(`❌ Failed to save to database. Status: ${res.statusCode}`);
            console.error('Response:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Error saving to database:', error.message);
    console.log('⚠️ Strategy saved to file storage only');
});

req.write(postData);
req.end();

console.log('\n📋 Strategy Details:');
console.log(`   Name: ${strategy.combination_name}`);
console.log(`   Coin: ${strategy.coin}`);
console.log(`   Timeframe: ${strategy.timeframe}`);
console.log(`   Regime: ${strategy.dominant_market_regime}`);
console.log(`   Total Signals: ${allVolumeSignals.length}`);


