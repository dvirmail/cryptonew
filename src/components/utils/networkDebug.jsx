/* Lightweight XHR logger for liveTradingAPI requests/responses
   Notes:
   - Logs only requests whose URL contains "liveTradingAPI"
   - Uses console.error/info so logs are visible even if console.log is filtered
   - Safe to load multiple times (installs once)
*/
export function initNetworkDebug() {
  try {
    if (typeof window === "undefined") return;
    if (window.__liveTradingApiDebugInstalled) return;
    window.__liveTradingApiDebugInstalled = true;

    const OriginalXHR = window.XMLHttpRequest;

    function shouldLogUrl(url) {
      try {
        return typeof url === "string" && url.toLowerCase().includes("livetradingapi");
      } catch (_e) {
        return false;
      }
    }

    class XHRProxy extends OriginalXHR {
      constructor() {
        super();
        this.__debug = {
          method: "",
          url: "",
          start: 0,
          body: undefined,
        };

        this.addEventListener("readystatechange", () => {
          try {
            if (this.readyState !== 4) return; // only completed
            if (!shouldLogUrl(this.__debug.url)) return;

            const duration = Date.now() - (this.__debug.start || Date.now());
            let parsed = null;
            let trimmed = "";

            try {
              trimmed = (this.responseText || "").slice(0, 2000);
              parsed = JSON.parse(this.responseText || "{}");
            } catch (_e) {
              // not JSON; keep trimmed text
            }

            /*console.error("[XHR][liveTradingAPI] Response", {
              url: this.__debug.url,
              method: this.__debug.method,
              status: this.status,
              statusText: this.statusText,
              durationMs: duration,
              request: sanitizeRequest(this.__debug.body),
              responsePreview: parsed ? undefined : trimmed,
              responseJson: parsed || undefined,
            });*/
          } catch (_e) {
            // ignore logging errors
          }
        });
      }

      open(method, url, async, user, password) {
        try {
          this.__debug.method = method;
          this.__debug.url = url;
        } catch (_e) {}
        return super.open(method, url, async, user, password);
      }

      send(body) {
        try {
          this.__debug.start = Date.now();
          this.__debug.body = body;
          if (shouldLogUrl(this.__debug.url)) {
            /*console.error("[XHR][liveTradingAPI] Request", {
              url: this.__debug.url,
              method: this.__debug.method,
              request: sanitizeRequest(body),
              timestamp: new Date().toISOString(),
            });*/
          }
        } catch (_e) {}
        return super.send(body);
      }
    }

    function sanitizeRequest(body) {
      try {
        if (!body) return undefined;
        let data = body;

        // Attempt to parse JSON bodies
        if (typeof body === "string") {
          try {
            data = JSON.parse(body);
          } catch (_e) {
            // not JSON; return trimmed
            return body.slice(0, 2000);
          }
        }

        // Shallow clone + redact any obviously sensitive fields
        const clone = Array.isArray(data) ? [...data] : { ...data };
        const redactKeys = ["apiKey", "apiSecret", "binance_api_key", "binance_api_secret", "signature"];
        for (const k of redactKeys) {
          if (clone && Object.prototype.hasOwnProperty.call(clone, k)) {
            clone[k] = "***REDACTED***";
          }
        }
        return clone;
      } catch (_e) {
        return undefined;
      }
    }

    window.XMLHttpRequest = XHRProxy;
    console.info("[XHR][liveTradingAPI] Debug interceptor installed");
  } catch (_e) {
    // Fallback: do nothing if installation fails
  }
}