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

    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);
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
      // Always log to console
      //try { console.log("[HEARTBEAT] Heartbeat paused (tab hidden)"); } catch {}
      this.onStatus({ message: "Heartbeat paused (tab hidden)", level: "system" });
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

  destroy() {
    this.stop();
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
    }
  }

  async tick() {
    if (!this.running || !this.visible) return;
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

    // Always-on dispatch log
    //try { console.log("[HEARTBEAT] -> sendHeartbeat dispatch", { sessionId, ts: new Date().toISOString() }); } catch {}

    try {
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
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      try { console.error("[HEARTBEAT] <- ERROR", { elapsedMs, error: err?.message || String(err), ts: new Date().toISOString() }); } catch {}
      this.onStatus({
        message: `Heartbeat error: ${err?.message || String(err)}`,
        level: "warning",
        error: err,
        elapsedMs
      });
    } finally {
      this.inFlight = false;
    }
  }
}