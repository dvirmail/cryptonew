#!/usr/bin/env node

/**
 * Data Recovery Tool for Crypto Sentinel
 * 
 * This tool automatically detects and fixes common data consistency issues:
 * - Orphaned positions (positions without matching wallet states)
 * - Duplicate wallet summaries
 * - Inconsistent data types
 * - Missing required fields
 * - Data corruption
 */

const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, 'storage');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  console.log('❌ Storage directory not found. Creating...');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function loadData(key) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed && typeof parsed === 'object') {
        return [parsed];
      } else {
        console.warn(`⚠️ Unexpected data format for ${key}, returning empty array`);
        return [];
      }
    }
    return [];
  } catch (error) {
    console.error(`❌ Error reading ${key}:`, error.message);
    return [];
  }
}

function saveData(key, data) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    
    // Create backup
    if (fs.existsSync(filePath)) {
      const backupPath = `${filePath}.backup.${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);
      console.log(`📁 Created backup: ${backupPath}`);
    }
    
    // Ensure data is always an array
    let dataToSave = Array.isArray(data) ? data : [data].filter(Boolean);
    
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
    console.log(`✅ Successfully saved ${key} (${dataToSave.length} items)`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving ${key}:`, error.message);
    return false;
  }
}

function validateWalletSummary(summary) {
  const errors = [];
  
  if (!summary.id) errors.push('Missing id');
  if (!summary.trading_mode) errors.push('Missing trading_mode');
  if (summary.balance_in_trades !== undefined && typeof summary.balance_in_trades !== 'number') {
    errors.push('balance_in_trades must be a number');
  }
  if (summary.available_balance !== undefined && typeof summary.available_balance !== 'number') {
    errors.push('available_balance must be a number');
  }
  
  return errors;
}

function validateLivePosition(position) {
  const errors = [];
  
  if (!position.id) errors.push('Missing id');
  if (!position.symbol) errors.push('Missing symbol');
  if (!position.status) errors.push('Missing status');
  if (!position.wallet_id) errors.push('Missing wallet_id');
  if (!position.trading_mode) errors.push('Missing trading_mode');
  
  // Convert string numbers to actual numbers
  if (position.quantity_crypto !== undefined) {
    if (typeof position.quantity_crypto === 'string') {
      const num = parseFloat(position.quantity_crypto);
      if (!isNaN(num)) {
        position.quantity_crypto = num;
      } else {
        errors.push('quantity_crypto is not a valid number');
      }
    } else if (typeof position.quantity_crypto !== 'number') {
      errors.push('quantity_crypto must be a number');
    }
  }
  
  if (position.entry_price !== undefined) {
    if (typeof position.entry_price === 'string') {
      const num = parseFloat(position.entry_price);
      if (!isNaN(num)) {
        position.entry_price = num;
      } else {
        errors.push('entry_price is not a valid number');
      }
    } else if (typeof position.entry_price !== 'number') {
      errors.push('entry_price must be a number');
    }
  }
  
  return errors;
}

function validateLiveWalletState(state) {
  const errors = [];
  
  if (!state.id) errors.push('Missing id');
  if (!state.trading_mode) errors.push('Missing trading_mode');
  
  if (state.available_balance !== undefined && typeof state.available_balance !== 'string' && typeof state.available_balance !== 'number') {
    errors.push('available_balance must be a string or number');
  }
  
  return errors;
}

function fixWalletSummaries() {
  console.log('\n🔧 Fixing Wallet Summaries...');
  
  const summaries = loadData('walletSummaries');
  console.log(`📊 Found ${summaries.length} wallet summaries`);
  
  if (summaries.length === 0) {
    console.log('⚠️ No wallet summaries found');
    return;
  }
  
  // Remove duplicates (keep the most recent one per trading_mode)
  const uniqueSummaries = {};
  const duplicates = [];
  
  summaries.forEach(summary => {
    const key = summary.trading_mode;
    if (uniqueSummaries[key]) {
      duplicates.push(summary);
      // Keep the one with the most recent updated_date
      const existing = uniqueSummaries[key];
      const existingDate = new Date(existing.updated_date || existing.created_date || 0);
      const currentDate = new Date(summary.updated_date || summary.created_date || 0);
      
      if (currentDate > existingDate) {
        uniqueSummaries[key] = summary;
      }
    } else {
      uniqueSummaries[key] = summary;
    }
  });
  
  if (duplicates.length > 0) {
    console.log(`🗑️ Removed ${duplicates.length} duplicate wallet summaries`);
  }
  
  // Validate and fix remaining summaries
  const validSummaries = [];
  const invalidSummaries = [];
  
  Object.values(uniqueSummaries).forEach(summary => {
    const errors = validateWalletSummary(summary);
    if (errors.length > 0) {
      console.log(`❌ Invalid wallet summary ${summary.id}:`, errors);
      invalidSummaries.push(summary);
    } else {
      validSummaries.push(summary);
    }
  });
  
  if (invalidSummaries.length > 0) {
    console.log(`⚠️ Found ${invalidSummaries.length} invalid wallet summaries`);
  }
  
  // Save the cleaned data
  if (saveData('walletSummaries', validSummaries)) {
    console.log(`✅ Fixed wallet summaries: ${validSummaries.length} valid summaries`);
  }
  
  return { valid: validSummaries.length, invalid: invalidSummaries.length, duplicates: duplicates.length };
}

function fixLivePositions() {
  console.log('\n🔧 Fixing Live Positions...');
  
  const positions = loadData('livePositions');
  console.log(`📊 Found ${positions.length} live positions`);
  
  if (positions.length === 0) {
    console.log('⚠️ No live positions found');
    return;
  }
  
  // Load wallet states to check for orphaned positions
  const walletStates = loadData('centralWalletStates');
  const walletStateIds = new Set(walletStates.map(ws => ws.id));
  
  // Find the most recent wallet state for each trading mode
  const latestWalletStates = {};
  walletStates.forEach(ws => {
    const key = ws.trading_mode;
    if (!latestWalletStates[key] || 
        new Date(ws.last_updated_timestamp || ws.created_date || 0) > 
        new Date(latestWalletStates[key].last_updated_timestamp || latestWalletStates[key].created_date || 0)) {
      latestWalletStates[key] = ws;
    }
  });
  
  // Validate and categorize positions
  const validPositions = [];
  const invalidPositions = [];
  const orphanedPositions = [];
  const fixedPositions = [];
  
  positions.forEach(position => {
    const errors = validateLivePosition(position);
    if (errors.length > 0) {
      console.log(`❌ Invalid position ${position.id}:`, errors);
      invalidPositions.push(position);
    } else if (!walletStateIds.has(position.wallet_id)) {
      console.log(`🔗 Orphaned position ${position.id} (wallet_id: ${position.wallet_id})`);
      
      // Try to fix by updating wallet_id to match latest wallet state for the same trading mode
      const latestWalletState = latestWalletStates[position.trading_mode];
      if (latestWalletState) {
        console.log(`🔧 Fixing orphaned position ${position.id} by updating wallet_id to ${latestWalletState.id}`);
        position.wallet_id = latestWalletState.id;
        fixedPositions.push(position);
      } else {
        orphanedPositions.push(position);
      }
    } else {
      validPositions.push(position);
    }
  });
  
  console.log(`📊 Position analysis:`);
  console.log(`  ✅ Valid positions: ${validPositions.length}`);
  console.log(`  🔧 Fixed positions: ${fixedPositions.length}`);
  console.log(`  ❌ Invalid positions: ${invalidPositions.length}`);
  console.log(`  🔗 Orphaned positions: ${orphanedPositions.length}`);
  
  // Combine valid and fixed positions
  const allValidPositions = [...validPositions, ...fixedPositions];
  
  // Save the cleaned data
  if (saveData('livePositions', allValidPositions)) {
    console.log(`✅ Fixed live positions: ${allValidPositions.length} valid positions`);
  }
  
  return { valid: validPositions.length, fixed: fixedPositions.length, invalid: invalidPositions.length, orphaned: orphanedPositions.length };
}


function generateReport(results) {
  console.log('\n📋 RECOVERY REPORT');
  console.log('==================');
  
  if (results.walletSummaries) {
    const ws = results.walletSummaries;
    console.log(`Wallet Summaries: ${ws.valid} valid, ${ws.invalid} invalid, ${ws.duplicates} duplicates removed`);
  }
  
  if (results.livePositions) {
    const lp = results.livePositions;
    console.log(`Live Positions: ${lp.valid} valid, ${lp.invalid} invalid, ${lp.orphaned} orphaned`);
  }
  
  console.log('\n✅ Data recovery completed!');
}

function main() {
  console.log('🚀 Crypto Sentinel Data Recovery Tool');
  console.log('=====================================');
  
  const results = {};
  
  try {
    results.walletSummaries = fixWalletSummaries();
    results.livePositions = fixLivePositions();
    
    generateReport(results);
  } catch (error) {
    console.error('❌ Recovery failed:', error.message);
    process.exit(1);
  }
}

// Run the recovery tool
if (require.main === module) {
  main();
}

module.exports = {
  fixWalletSummaries,
  fixLivePositions,
  loadData,
  saveData
};
