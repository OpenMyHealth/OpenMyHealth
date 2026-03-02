/**
 * CDP WebSocket client using Node.js native WebSocket (zero external deps).
 */

/**
 * Discover available CDP targets.
 * @param {number} port — CDP debugging port
 * @returns {Promise<Array>} parsed JSON array of targets
 */
export async function discoverTargets(port = 9222) {
  const res = await fetch(`http://localhost:${port}/json`);
  if (!res.ok) {
    throw new Error(`CDP discovery failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Discover the browser-level WebSocket debugger URL.
 * @param {number} port — CDP debugging port
 * @returns {Promise<string>} browser WebSocket URL
 */
export async function discoverBrowserWsUrl(port = 9222) {
  const res = await fetch(`http://localhost:${port}/json/version`);
  if (!res.ok) {
    throw new Error(`CDP version discovery failed: ${res.status} ${res.statusText}`);
  }
  const info = await res.json();
  return info.webSocketDebuggerUrl;
}

/**
 * Extract the extension ID from chrome-extension:// URLs in the target list.
 * @param {Array} targets — targets from discoverTargets()
 * @returns {string|null} extension ID or null
 */
export function findExtensionId(targets) {
  for (const t of targets) {
    const url = t.url || '';
    const match = url.match(/^chrome-extension:\/\/([a-z]{32})/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Discover the extension ID using browser-level CDP Target.getTargets().
 * Falls back to scanning the Chrome profile's IndexedDB directory.
 * @param {number} port — CDP debugging port
 * @param {string} [profileDir] — Chrome profile base directory
 * @returns {Promise<string|null>}
 */
export async function discoverExtensionId(port = 9222, profileDir) {
  // Strategy 1: Browser-level Target.getTargets() with service_worker filter
  try {
    const browserWsUrl = await discoverBrowserWsUrl(port);
    const session = await connectTarget(browserWsUrl);
    try {
      const { targetInfos } = await session.send('Target.getTargets', {
        filter: [
          { type: 'service_worker', exclude: false },
          { type: 'page', exclude: false },
          { type: 'background_page', exclude: false },
        ]
      });
      for (const t of targetInfos) {
        const match = (t.url || '').match(/^chrome-extension:\/\/([a-z]{32})/);
        if (match) return match[1];
      }
    } finally {
      await session.close();
    }
  } catch {
    // browser-level approach failed, try next strategy
  }

  // Strategy 2: Scan Chrome profile IndexedDB directory for extension pattern
  if (profileDir) {
    const { readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    try {
      const indexedDbDir = join(profileDir, 'Default', 'IndexedDB');
      const entries = readdirSync(indexedDbDir);
      for (const entry of entries) {
        const match = entry.match(/^chrome-extension_([a-z]{32})_/);
        if (match) return match[1];
      }
    } catch {
      // profile scanning failed
    }
  }

  return null;
}

/**
 * Connect to a CDP target via WebSocket.
 * @param {string} wsUrl — WebSocket debugger URL
 * @returns {Promise<CDPSession>}
 */
export async function connectTarget(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(new CDPSession(ws)), { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`CDP WebSocket error: ${e.message || 'connection failed'}`)), { once: true });
  });
}

class CDPSession {
  #ws;
  #nextId = 1;
  #callbacks = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(ws) {
    this.#ws = ws;
    this.#ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

      // Response to a send() call
      if (msg.id != null) {
        const cb = this.#callbacks.get(msg.id);
        if (cb) {
          this.#callbacks.delete(msg.id);
          if (msg.error) {
            cb.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            cb.resolve(msg.result);
          }
        }
        return;
      }

      // CDP event
      if (msg.method) {
        const fns = this.#listeners.get(msg.method);
        if (fns) {
          for (const fn of fns) fn(msg.params);
        }
      }
    });

    this.#ws.addEventListener('close', () => {
      this.#closed = true;
      for (const [id, cb] of this.#callbacks) {
        cb.reject(new Error('CDP WebSocket closed'));
      }
      this.#callbacks.clear();
    });

    this.#ws.addEventListener('error', () => {
      this.#closed = true;
      for (const [id, cb] of this.#callbacks) {
        cb.reject(new Error('CDP WebSocket error'));
      }
      this.#callbacks.clear();
    });
  }

  /**
   * Send a CDP command and await its response.
   * @param {string} method — CDP method (e.g. 'Page.captureScreenshot')
   * @param {object} params
   * @returns {Promise<object>}
   */
  async send(method, params = {}) {
    if (this.#closed) {
      throw new Error('CDP session is closed');
    }
    const id = this.#nextId++;
    const TIMEOUT_MS = 30_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#callbacks.delete(id);
        reject(new Error(`CDP timeout after ${TIMEOUT_MS}ms: ${method}`));
      }, TIMEOUT_MS);

      this.#callbacks.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Register a listener for a CDP event.
   * @param {string} event — CDP event name (e.g. 'Log.entryAdded')
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }
    this.#listeners.get(event).push(callback);
  }

  /**
   * Register a one-time listener for a CDP event.
   */
  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    wrapper._original = callback;
    this.on(event, wrapper);
  }

  /**
   * Remove a specific listener for a CDP event.
   */
  off(event, callback) {
    const fns = this.#listeners.get(event);
    if (!fns) return;
    const idx = fns.findIndex(fn => fn === callback || fn._original === callback);
    if (idx !== -1) fns.splice(idx, 1);
    if (fns.length === 0) this.#listeners.delete(event);
  }

  /**
   * Remove all listeners for a given event, or all events if no arg.
   */
  removeAllListeners(event) {
    if (event) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.clear();
    }
  }

  /**
   * Close the WebSocket connection.
   */
  async close() {
    this.#ws.close();
  }
}
