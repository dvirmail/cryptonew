import { scannerSessionManager } from "@/api/functions";

export default class HeartbeatService {
  constructor({
    getSessionId,
    isLeaderProvider,
    onStatus,
    intervalMs = 25000, // 25s default; server timeout tolerance handled in send()
  } = {}) {
    this.getSessionId = getSessionId || (() => null);
    this.isLeaderProvider = isLeaderProvider || (() => false);
    this.onStatus = onStatus || (() => {});
    this.intervalMs = intervalMs;

    this.timer = null;
    this.inFlight = false;
    this.running = false;
    this.visible = true;
    this.keepAlive = true; // New flag to ensure continuous operation

    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
    this.boundWakeUpHandler = this.handleWakeUp.bind(this);
    this.boundBeforeUnloadHandler = this.handleBeforeUnload.bind(this);
    
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);
      document.addEventListener("focus", this.boundWakeUpHandler);
      document.addEventListener("beforeunload", this.boundBeforeUnloadHandler);
    }
    
    // Add page focus/blur handlers for better wake-up detection
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("focus", this.boundWakeUpHandler);
      window.addEventListener("blur", this.handleBlur.bind(this));
    }
  }

  setIntervalMs(ms) {
    this.intervalMs = ms;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  handleVisibilityChange() {
    const hidden = typeof document !== "undefined" ? document.hidden : false;
    this.visible = !hidden;
    if (!this.visible) {
      // Continue running even when tab is hidden - don't pause heartbeat
      this.onStatus({ message: "Heartbeat continuing (tab hidden but scanner active)", level: "system" });
    } else if (this.running) {
      this.pulse();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    //try { console.log("[HEARTBEAT] start() called"); } catch {}
    this.pulse(); // fire immediately
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.onStatus({ message: "Heartbeat started", level: "system" });
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlight = false;
    //try { console.log("[HEARTBEAT] stop() called"); } catch {}
    this.onStatus({ message: "Heartbeat stopped", level: "system" });
  }

  handleWakeUp() {
    this.onStatus({ message: "System wake-up detected - resuming full operation", level: "system" });
    if (this.running) {
      this.pulse(); // Send immediate heartbeat on wake-up
    }
  }

  handleBlur() {
    // Don't stop operation when window loses focus - continue running
    this.onStatus({ message: "Window blurred but scanner continues running", level: "system" });
  }

  handleBeforeUnload() {
    // Only stop when actually closing the page/tab
    this.keepAlive = false;
    this.onStatus({ message: "Page unloading - stopping heartbeat", level: "system" });
  }

  destroy() {
    this.stop();
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
      document.removeEventListener("focus", this.boundWakeUpHandler);
      document.removeEventListener("beforeunload", this.boundBeforeUnloadHandler);
    }
    if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("focus", this.boundWakeUpHandler);
      window.removeEventListener("blur", this.handleBlur.bind(this));
    }
  }

  async tick() {
    if (!this.running) return; // Remove visibility check - continue even when tab is hidden
    if (this.inFlight) return;

    const isLeader = !!this.isLeaderProvider();
    if (!isLeader) return;

    await this.send();
  }

  async pulse() {
    if (this.inFlight) return;
    await this.send();
  }

  async send() {
    const sessionId = this.getSessionId();
    if (!sessionId) return;

    this.inFlight = true;
    const timeoutMs = 45000; // 45s client-side guard (bypasses apiQueue timeouts)
    const startedAt = Date.now();
    const maxRetries = 3;
    let attempt = 0;

    // Always-on dispatch log
    //try { console.log("[HEARTBEAT] -> sendHeartbeat dispatch", { sessionId, ts: new Date().toISOString() }); } catch {}

    while (attempt < maxRetries) {
      try {
        attempt++;
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Heartbeat client-side timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        // DIRECT call — bypasses apiQueue to avoid queue contention
        const response = await Promise.race([
          scannerSessionManager({ action: "sendHeartbeat", sessionId }),
          timeoutPromise
        ]);

        const elapsedMs = Date.now() - startedAt;
        //try { console.log("[HEARTBEAT] <- OK", { elapsedMs, ts: new Date().toISOString() }); } catch {}

        const ok = !!response && typeof response === "object" && "data" in response;
        this.onStatus({
          message: "Heartbeat OK",
          level: "system",
          data: ok ? response.data : response
        });
        
        // Success - exit retry loop
        break;
        
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        
        if (attempt < maxRetries) {
          // Retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5s delay
          try { console.warn(`[HEARTBEAT] <- ERROR (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, { elapsedMs, error: err?.message || String(err), ts: new Date().toISOString() }); } catch {}
          
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Final attempt failed
          try { console.error("[HEARTBEAT] <- ERROR (final)", { elapsedMs, error: err?.message || String(err), ts: new Date().toISOString() }); } catch {}
          this.onStatus({
            message: `Heartbeat error: ${err?.message || String(err)}`,
            level: "warning",
            error: err,
            elapsedMs
          });
        }
      }
    }
    
    this.inFlight = false;
  }
}