(function () {
  "use strict";

  const omh = {
    ready: false,
    provider: null,
    responses: [],
    _readyResolvers: [],
    _pendingRequests: new Map(),

    waitForReady(timeoutMs = 15000) {
      if (this.ready) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Bridge ready timeout")), timeoutMs);
        this._readyResolvers.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },

    sendMcpRequest(payload) {
      const requestId = "e2e-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const channel = new MessageChannel();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pendingRequests.delete(requestId);
          channel.port1.close();
          reject(new Error("MCP request timeout"));
        }, 70000);

        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          this._pendingRequests.delete(requestId);
          const response = event.data;
          this.responses.push(response);
          log("Response received: " + JSON.stringify(response, null, 2));
          channel.port1.close();
          resolve(response);
        };

        channel.port1.onerror = (event) => {
          clearTimeout(timer);
          this._pendingRequests.delete(requestId);
          channel.port1.close();
          reject(new Error("MessagePort error: " + (event.message || "unknown")));
        };

        this._pendingRequests.set(requestId, { resolve, reject, timer });

        window.postMessage(
          {
            source: "openmyhealth-page",
            type: "openmyhealth:mcp:read-health-records",
            requestId,
            payload,
          },
          window.location.origin,
          [channel.port2]
        );

        log("Request sent: " + JSON.stringify({ requestId, payload }, null, 2));
      });
    },

    clearResponses() {
      this.responses = [];
    },
  };

  function log(msg) {
    const el = document.getElementById("log");
    if (el) {
      el.textContent += new Date().toISOString().slice(11, 23) + " " + msg + "\n";
      el.scrollTop = el.scrollHeight;
    }
  }

  // Listen for the content script ready signal
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.source === "openmyhealth-extension" && data.type === "openmyhealth:mcp:ready") {
      omh.ready = true;
      omh.provider = data.provider || null;
      const statusEl = document.getElementById("status");
      if (statusEl) {
        statusEl.textContent = "Content script connected! Provider: " + (omh.provider || "unknown");
        statusEl.className = "ready";
      }
      log("Bridge ready. Provider: " + omh.provider);
      for (const resolver of omh._readyResolvers) {
        resolver();
      }
      omh._readyResolvers = [];
    }
  });

  window.__omh = omh;
  log("Harness initialized. Waiting for content script...");
})();
