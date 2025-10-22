const fs = require('fs');
const path = require('path');

// Read the existing backtest combinations
const filePath = path.join(__dirname, 'storage', 'backtestCombinations.json');

try {
  const data = fs.readFileSync(filePath, 'utf8');
  const combinations = JSON.parse(data);
  
  console.log(`Found ${combinations.length} combinations to fix`);
  
  let fixedCount = 0;
  
  // Fix each combination
  const fixedCombinations = combinations.map(combo => {
    if (combo.combinedStrength === 0 && combo.signals && Array.isArray(combo.signals)) {
      // Calculate combined strength from signal strengths
      const calculatedStrength = combo.signals.reduce((sum, signal) => {
        return sum + (signal.strength || 0);
      }, 0);
      
      if (calculatedStrength > 0) {
        console.log(`Fixing ${combo.combinationName}: ${combo.combinedStrength} -> ${calculatedStrength}`);
        fixedCount++;
        return {
          ...combo,
          combinedStrength: calculatedStrength
        };
      }
    }
    return combo;
  });
  
  // Write the fixed data back
  fs.writeFileSync(filePath, JSON.stringify(fixedCombinations, null, 2));
  
  console.log(`Fixed ${fixedCount} combinations with correct combined strength`);
  console.log('Combinations updated successfully!');
  
} catch (error) {
  console.error('Error fixing combined strength:', error);
}
