/**
 * Data Migration Utilities for BacktestCombination Signal Names
 * Handles migration of existing inconsistent signal names in the database
 */

import { BacktestCombination } from '@/api/entities';
import {
  validateCombinationSignals,
  migrateCombinationSignals,
  logValidationIssues
} from './signalValidation';

/**
 * Helper function to migrate a single signal name using the core migration logic.
 * @param {string} signalType - The original signal type string.
 * @returns {string} The migrated (canonical) signal type string.
 */
function migrateSignalName(signalType) {
  // simulate a BacktestCombination object with a single signal to leverage migrateCombinationSignals
  const dummyCombination = { signals: [{ type: signalType }] };
  const migratedResult = migrateCombinationSignals(dummyCombination);
  return migratedResult.signals[0].type;
}

/**
 * Scans all BacktestCombination records for signal name inconsistencies
 * @returns {Promise<Object>} - Report of inconsistencies found
 */
export async function scanForSignalInconsistencies() {
  try {
    console.log('[Data Migration] Starting scan for signal name inconsistencies...');

    const allCombinations = await BacktestCombination.list();
    console.log(`[Data Migration] Found ${allCombinations.length} combinations to scan`);

    const report = {
      totalScanned: allCombinations.length,
      inconsistentCombinations: [],
      totalIssues: 0,
      issuesByType: {},
      migrationMap: {}
    };

    for (let i = 0; i < allCombinations.length; i++) {
      const combination = allCombinations[i];
      const validation = validateCombinationSignals(combination);

      if (!validation.isValid || validation.issues.length > 0) {
        report.inconsistentCombinations.push({
          id: combination.id,
          combinationName: combination.combinationName || `Unnamed-${combination.id}`,
          issues: validation.issues,
          signals: combination.signals || []
        });

        report.totalIssues += validation.issues.length;

        // Track issue types
        validation.issues.forEach(issue => {
          const issueType = issue.includes('non-canonical') ? 'migratable' : 'unknown';
          report.issuesByType[issueType] = (report.issuesByType[issueType] || 0) + 1;

          // Extract signal names for migration mapping
          const match = issue.match(/type '([^']+)'/);
          if (match) {
            const problematicName = match[1];
            // Use the single signal migration logic for mapping
            const migrated = migrateSignalName(problematicName);
            if (migrated !== problematicName) {
              report.migrationMap[problematicName] = migrated;
            }
          }
        });

        logValidationIssues(`Combination ${combination.id}`, validation);
      }

      // Progress logging for large datasets
      if ((i + 1) % 100 === 0) {
        console.log(`[Data Migration] Scanned ${i + 1}/${allCombinations.length} combinations...`);
      }
    }

    console.log(`[Data Migration] Scan complete. Found ${report.inconsistentCombinations.length} combinations with issues.`);
    console.log(`[Data Migration] Migration map:`, report.migrationMap);

    return report;

  } catch (error) {
    console.error('[Data Migration] Error during scan:', error);
    throw error;
  }
}

/**
 * Performs the actual migration of inconsistent signal names
 * @param {boolean} dryRun - If true, only simulates the migration without saving changes
 * @returns {Promise<Object>} - Migration results
 */
export async function migrateSignalNames(dryRun = true) {
  try {
    console.log(`[Data Migration] Starting signal name migration (${dryRun ? 'DRY RUN' : 'LIVE'})...`);

    const scanReport = await scanForSignalInconsistencies();

    if (scanReport.inconsistentCombinations.length === 0) {
      console.log('[Data Migration] No inconsistent combinations found. Migration not needed.');
      return {
        totalProcessed: scanReport.totalScanned,
        migratedCount: 0,
        errorCount: 0,
        errors: [],
        dryRun
      };
    }

    const migrationResults = {
      totalProcessed: scanReport.inconsistentCombinations.length,
      migratedCount: 0,
      errorCount: 0,
      errors: [],
      dryRun,
      changes: []
    };

    for (const inconsistentCombo of scanReport.inconsistentCombinations) {
      try {
        // Get the full combination from database
        const originalCombination = await BacktestCombination.get(inconsistentCombo.id);
        if (!originalCombination) {
          throw new Error(`Combination ${inconsistentCombo.id} not found`);
        }

        // Perform migration
        const migratedCombination = migrateCombinationSignals(originalCombination);

        // Check if migration actually changed anything
        const originalSignalTypes = originalCombination.signals?.map(s => s.type) || [];
        const migratedSignalTypes = migratedCombination.signals?.map(s => s.type) || [];

        const hasChanges = JSON.stringify(originalSignalTypes) !== JSON.stringify(migratedSignalTypes);

        if (hasChanges) {
          const changeDetail = {
            id: inconsistentCombo.id,
            combinationName: inconsistentCombo.combinationName,
            before: originalSignalTypes,
            after: migratedSignalTypes,
            changeCount: originalSignalTypes.filter((type, idx) => type !== migratedSignalTypes[idx]).length
          };

          migrationResults.changes.push(changeDetail);

          if (!dryRun) {
            // Actually update the database
            await BacktestCombination.update(inconsistentCombo.id, {
              signals: migratedCombination.signals
            });
            console.log(`[Data Migration] Updated combination ${inconsistentCombo.id}: ${originalSignalTypes.join(', ')} -> ${migratedSignalTypes.join(', ')}`);
          } else {
            console.log(`[Data Migration] [DRY RUN] Would update combination ${inconsistentCombo.id}: ${originalSignalTypes.join(', ')} -> ${migratedSignalTypes.join(', ')}`);
          }

          migrationResults.migratedCount++;
        }

      } catch (error) {
        console.error(`[Data Migration] Error migrating combination ${inconsistentCombo.id}:`, error);
        migrationResults.errorCount++;
        migrationResults.errors.push({
          combinationId: inconsistentCombo.id,
          error: error.message
        });
      }
    }

    console.log(`[Data Migration] Migration ${dryRun ? 'simulation' : 'execution'} complete:`);
    console.log(`  - Processed: ${migrationResults.totalProcessed} combinations`);
    console.log(`  - Migrated: ${migrationResults.migratedCount} combinations`);
    console.log(`  - Errors: ${migrationResults.errorCount} combinations`);

    return migrationResults;

  } catch (error) {
    console.error('[Data Migration] Error during migration:', error);
    throw error;
  }
}

/**
 * Validates all BacktestCombination records and reports current status
 * Use this to verify the health of your data after migration
 * @returns {Promise<Object>} - Validation report
 */
export async function validateAllCombinations() {
  try {
    console.log('[Data Migration] Validating all combinations...');

    const allCombinations = await BacktestCombination.list();
    let validCount = 0;
    let invalidCount = 0;
    const invalidCombinations = [];

    for (const combination of allCombinations) {
      const validation = validateCombinationSignals(combination);

      if (validation.isValid) {
        validCount++;
      } else {
        invalidCount++;
        invalidCombinations.push({
          id: combination.id,
          combinationName: combination.combinationName || `Unnamed-${combination.id}`,
          issues: validation.issues
        });
      }
    }

    const report = {
      totalCombinations: allCombinations.length,
      validCount,
      invalidCount,
      validationRate: ((validCount / allCombinations.length) * 100).toFixed(2),
      invalidCombinations
    };

    console.log(`[Data Migration] Validation complete:`);
    console.log(`  - Total: ${report.totalCombinations} combinations`);
    console.log(`  - Valid: ${report.validCount} (${report.validationRate}%)`);
    console.log(`  - Invalid: ${report.invalidCount}`);

    if (invalidCount > 0) {
      console.warn('[Data Migration] Invalid combinations found:', invalidCombinations);
    }

    return report;

  } catch (error) {
    console.error('[Data Migration] Error during validation:', error);
    throw error;
  }
}

/**
 * Emergency function to fix specific combination by ID
 * @param {string} combinationId - ID of the combination to fix
 * @returns {Promise<Object>} Migration result for this specific combination
 */
export async function fixSpecificCombination(combinationId) {
  try {
    console.log(`🔧 Fixing specific combination: ${combinationId}`);

    const combination = await BacktestCombination.get(combinationId);
    if (!combination) {
      throw new Error(`Combination with ID ${combinationId} not found`);
    }

    const target = combination;
    console.log(`📝 Found combination: ${target.combinationName}`);

    // Validate and migrate this specific combination
    const validation = validateCombinationSignals(target);

    if (validation.isValid) {
      console.log('✅ Combination is already valid, no changes needed');
      return { migrated: false, reason: 'Already valid', combinationId: combinationId, combinationName: target.combinationName };
    }

    console.log(`⚠️ Found ${validation.issues.length} issues, attempting migration...`);

    // Migrate signals
    let migrationsMade = 0;
    const migratedSignals = target.signals.map(signal => {
      const originalType = signal.type;
      const migratedType = migrateSignalName(originalType);

      if (originalType !== migratedType) {
        console.log(`🔄 Migrating signal: ${originalType} → ${migratedType}`);
        migrationsMade++;
        return { ...signal, type: migratedType };
      }

      return signal;
    });

    if (migrationsMade > 0) {
      // Update only the signals array in the database
      await BacktestCombination.update(target.id, { signals: migratedSignals });
      console.log(`✅ Successfully migrated ${migrationsMade} signals in combination ${combinationId}`);

      return {
        migrated: true,
        migrationsMade,
        originalName: target.combinationName,
        issues: validation.issues,
        combinationId: combinationId,
        newSignals: migratedSignals
      };
    } else {
      console.log('❌ No valid migrations found for this combination');
      return {
        migrated: false,
        reason: 'No valid migrations available',
        issues: validation.issues,
        combinationId: combinationId,
        combinationName: target.combinationName
      };
    }

  } catch (error) {
    console.error(`❌ Failed to fix combination ${combinationId}:`, error);
    throw error;
  }
}