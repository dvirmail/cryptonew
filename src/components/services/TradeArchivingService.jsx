import { queueFunctionCall } from "@/components/utils/apiQueue";
import { functions } from "@/api/localClient";

/**
 * Service responsible for managing trade archiving operations.
 * Encapsulates periodic archiving of old trades and keeps the latest report for UI summaries.
 */
class TradeArchivingService {
  constructor(scannerService) {
    this.scanner = scannerService;

    // Archiving state
    this.isArchiving = false;
    this.lastArchivingReport = null;
    this.lastArchiveRunTimestamp = 0;

    // Run at most once per 5 minutes (same cadence as other low-priority jobs)
    this.ARCHIVE_INTERVAL_MS = 5 * 60 * 1000;
  }

  /**
   * Reset the internal archiving state (used on hard resets).
   */
  resetState() {
    this.isArchiving = false;
    this.lastArchivingReport = null;
    this.lastArchiveRunTimestamp = 0;
  }

  /**
   * Get the last archiving report (used by AutoScannerService to display at cycle end).
   */
  getLastArchivingReport() {
    return this.lastArchivingReport;
  }

  /**
   * Runs the trade archiving process if enough time has passed since last run.
   * Can be invoked from scan cycles; it is non-blocking if recently executed.
   * @param {boolean} force - If true, ignore interval and run anyway.
   */
  async runArchivingProcess(force = false) {
    if (this.isArchiving) return;

    const now = Date.now();
    if (!force && now - this.lastArchiveRunTimestamp < this.ARCHIVE_INTERVAL_MS) {
      return;
    }

    this.isArchiving = true;
    this.lastArchiveRunTimestamp = now;

    try {
      const perfStart = typeof performance !== "undefined" ? performance.now() : Date.now();

      // Use low priority and cache key like other background jobs
      const res = await queueFunctionCall(
        'archiveOldTrades',
        functions.archiveOldTrades,
        {},
        "low",
        "archiveOldTrades",
        60_000, // cache for 1 minute
        60_000  // timeout 60s
      );

      console.log('[TradeArchivingService] Raw response:', res);
      const data = res?.data ?? res ?? {};
      const success = data?.success === true;
      
      console.log('[TradeArchivingService] Parsed data:', data);
      console.log('[TradeArchivingService] Success:', success);

      const deletedCount = typeof data?.deletedCount === "number" ? data.deletedCount : 0;
      const remainingCount = typeof data?.remainingCount === "number" ? data.remainingCount : null;
      const moreToProcess = Boolean(data?.moreToProcess);
      const message =
        data?.message ||
        (deletedCount > 0
          ? `Archived ${deletedCount} trades`
          : "No archiving needed");

      const perfEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
      const totalMs = Math.round((perfEnd - perfStart) || 0);

      this.lastArchivingReport = {
        success,
        message,
        deletedCount,
        remainingCount,
        moreToProcess,
        performance: data?.performance || { totalMs },
        at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[TradeArchivingService] Error during archiving:', error);
      console.error('[TradeArchivingService] Error stack:', error.stack);
      this.lastArchivingReport = {
        success: false,
        error: error?.message || String(error),
        performance: null,
        at: new Date().toISOString(),
      };
      // Best-effort logging into scanner log stream
      if (this.scanner && typeof this.scanner.addLog === "function") {
        this.scanner.addLog(`[ARCHIVING] ❌ Error during archiving: ${this.lastArchivingReport.error}`, "error");
      }
    } finally {
      this.isArchiving = false;
    }
  }
}

export default TradeArchivingService;