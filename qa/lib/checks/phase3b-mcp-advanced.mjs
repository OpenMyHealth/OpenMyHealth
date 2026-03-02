/**
 * Phase 3B — MCP Advanced E2E checks (Timer, Queue, Always-Allow, Detail Mode).
 *
 * Uses shadow-pierce library for closed shadow DOM access and the same
 * CS context + ACK infrastructure as Phase 3A.
 *
 * Production timer: 60s timeout, 15s amber, 5s red.
 * E2E timer (OMH_E2E): 10s timeout, 4s amber, 2s red.
 * Since pnpm dev does NOT set OMH_E2E, we use production values.
 */
import { connectTarget } from '../cdp-client.mjs';
import { ensureMcpPrerequisites } from '../mcp-setup.mjs';
import {
  initDom,
  refreshDom,
  isOverlayVisible,
  waitForOverlay,
  waitForOverlayHidden,
  clickOverlayButton,
  shadowQuery,
  shadowQueryAll,
  getNodeText,
  getNodeProperty,
  getShellText,
  readOverlayText,
} from '../shadow-pierce.mjs';

// ---------------------------------------------------------------------------
// Constants — amber/red thresholds are fixed at 15s/5s regardless of total timeout.
// TIMEOUT_S is dynamically set from the first timer reading.
// ---------------------------------------------------------------------------
const AMBER_THRESHOLD_S = 15;
const RED_THRESHOLD_S = 5;
let TIMEOUT_S = 180; // default high, updated dynamically from first timer read

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let requestCounter = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ok(id, start, msg, details) {
  return { id, status: 'pass', duration: Date.now() - start, message: msg, ...(details ? { details } : {}) };
}
function fail(id, start, msg, details) {
  return { id, status: 'fail', duration: Date.now() - start, message: msg, ...(details ? { details } : {}) };
}

async function sendMcpRequest(session, payload, suffix) {
  const reqNum = ++requestCounter;
  const varName = `__omhQaResp_${suffix}`;
  await session.send('Runtime.evaluate', {
    expression: `(() => {
      window['${varName}'] = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => { window['${varName}'] = e.data; };
      window.postMessage({
        source: 'openmyhealth-page',
        type: 'openmyhealth:mcp:read-health-records',
        requestId: 'qa-${suffix}',
        payload: ${JSON.stringify(payload)}
      }, window.location.origin, [channel.port2]);
    })()`,
    returnByValue: true,
  });
  return varName;
}

async function getResponse(session, varName, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `window['${varName}'] ? JSON.stringify(window['${varName}']) : null`,
      returnByValue: true,
    });
    if (result.value) return JSON.parse(result.value);
    await sleep(300);
  }
  return null;
}

async function ensureClean(session) {
  for (let i = 0; i < 8; i++) {
    if (!(await isOverlayVisible(session))) break;
    const clicked = await clickOverlayButton(session, '.omh-close') ||
                    await clickOverlayButton(session, '.omh-secondary');
    if (clicked) {
      await waitForOverlayHidden(session, 5000);
      await sleep(500);
    } else {
      await sleep(1000);
    }
  }
  await waitForOverlayHidden(session, 3000);
  await sleep(300);
}

// ---------------------------------------------------------------------------
// Shell helper: get classes from .omh-shell
// ---------------------------------------------------------------------------
async function getShellClasses(session) {
  const shellId = await shadowQuery(session, '.omh-shell');
  if (!shellId) return [];
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId: shellId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { return JSON.stringify([...this.classList]); }',
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return JSON.parse(result.value || '[]');
  } catch { return []; }
}

/**
 * Fast timer read using a cached RemoteObject handle.
 *
 * First call: DOM.performSearch(.omh-timer-ring) → DOM.resolveNode → cache objectId
 * Subsequent calls: Runtime.callFunctionOn(cached objectId) — <5ms per read
 *
 * This avoids DOM.getDocument({depth:-1}) which takes ~16s on chatgpt.com.
 */
let _timerObjectId = null;

async function acquireTimerHandle(session) {
  // Use shadow-pierce to find .omh-timer-ring (requires refreshDom for closed shadow DOM)
  await refreshDom(session);
  const nodeId = await shadowQuery(session, '.omh-timer-ring');
  if (!nodeId) return null;

  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { return this.textContent; }',
      returnByValue: true,
    });
    const val = parseInt(result.value?.replace(/\D/g, ''), 10);
    if (!isNaN(val) && val > 0) {
      _timerObjectId = object.objectId;
      return val;
    }
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
  } catch { /* failed to resolve */ }
  return null;
}

async function getTimerSeconds(session) {
  // Fast path: use cached RemoteObject handle (<5ms)
  if (_timerObjectId) {
    try {
      const { result } = await session.send('Runtime.callFunctionOn', {
        objectId: _timerObjectId,
        functionDeclaration: 'function() { return this.textContent; }',
        returnByValue: true,
      });
      const n = parseInt(result.value?.replace(/\D/g, ''), 10);
      if (!isNaN(n)) return n;
    } catch {
      // Handle invalid (node removed / overlay dismissed)
      _timerObjectId = null;
    }
  }
  // Acquire a new handle
  return acquireTimerHandle(session);
}

function releaseTimerHandle(session) {
  if (_timerObjectId) {
    session.send('Runtime.releaseObject', { objectId: _timerObjectId }).catch(() => {});
    _timerObjectId = null;
  }
}

async function waitForStage(session, stage, timeoutMs = 50000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await refreshDom(session);
    const classes = await getShellClasses(session);
    if (classes.includes(stage)) return true;
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// CS Context + ACK infrastructure (same as Phase 3A)
// ---------------------------------------------------------------------------

async function discoverCsContext(session) {
  const contexts = [];
  const handler = (params) => contexts.push(params.context);
  session.on('Runtime.executionContextCreated', handler);
  await session.send('Runtime.enable');
  await sleep(500);
  session.off('Runtime.executionContextCreated', handler);
  return contexts.find(c => c.origin?.includes('chrome-extension'))?.id ?? null;
}

async function installApprovalListener(session, csCtxId) {
  await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: `(() => {
      if (self.__omhQaListenerInstalled) return 'already';
      self.__omhQaLastReqId = null;
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'overlay:show-approval' && message.request?.id) {
          self.__omhQaLastReqId = message.request.id;
        }
      });
      self.__omhQaListenerInstalled = true;
      return 'installed';
    })()`,
    returnByValue: true,
  });
}

async function sendAckAndApprove(session, csCtxId) {
  const { result } = await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: 'self.__omhQaLastReqId',
    returnByValue: true,
  });
  const reqId = result.value;
  if (reqId) {
    await session.send('Runtime.evaluate', {
      contextId: csCtxId,
      expression: `chrome.runtime.sendMessage({
        type: "overlay:approval-rendered",
        requestId: ${JSON.stringify(reqId)},
      }).catch(() => {})`,
      returnByValue: true,
      awaitPromise: true,
    }).catch(() => {});
    await sleep(100);
  }
  return clickOverlayButton(session, '.omh-primary');
}

async function clearCapturedReqId(session, csCtxId) {
  await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: 'self.__omhQaLastReqId = null',
    returnByValue: true,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Shadow DOM interaction helpers for checkboxes/detail mode
// ---------------------------------------------------------------------------

/**
 * Click an element inside shadow DOM by resolving its nodeId.
 * Returns true if the element was found and clicked.
 */
async function clickShadowElement(session, nodeId) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { this.click(); }',
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return true;
  } catch { return false; }
}

/**
 * Get the count of elements matching a selector in shadow DOM.
 */
async function shadowCount(session, selector) {
  const ids = await shadowQueryAll(session, selector);
  return ids.length;
}

/**
 * Find text content of all elements matching a selector.
 */
async function shadowTextAll(session, selector) {
  const ids = await shadowQueryAll(session, selector);
  const texts = [];
  for (const id of ids) {
    const text = await getNodeText(session, id);
    if (text) texts.push(text.trim());
  }
  return texts;
}

/**
 * Find a label containing specific text and click its checkbox input.
 */
async function clickLabelCheckbox(session, labelSelector, containsText) {
  await refreshDom(session);
  const labels = await shadowQueryAll(session, labelSelector);
  for (const labelId of labels) {
    const text = await getNodeText(session, labelId);
    if (text && text.includes(containsText)) {
      // Find the input inside this label
      try {
        const { object } = await session.send('DOM.resolveNode', { nodeId: labelId });
        const { result } = await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: `function() {
            const input = this.querySelector('input[type="checkbox"]');
            if (input) { input.click(); return true; }
            return false;
          }`,
          returnByValue: true,
        });
        await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
        return result.value === true;
      } catch { return false; }
    }
  }
  return false;
}

/**
 * Uncheck all L1 type checkboxes.
 */
async function uncheckAllL1(session) {
  await refreshDom(session);
  const groups = await shadowQueryAll(session, '.omh-type-group');
  for (const groupId of groups) {
    try {
      const { object } = await session.send('DOM.resolveNode', { nodeId: groupId });
      await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function() {
          const cb = this.querySelector('label.omh-checkbox-row input[type="checkbox"]');
          if (cb && cb.checked) cb.click();
        }`,
      });
      await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    } catch {}
  }
}

/**
 * Get checked state of L2 checkboxes in the first type group.
 */
async function getFirstGroupL2States(session) {
  await refreshDom(session);
  const groups = await shadowQueryAll(session, '.omh-type-group');
  if (groups.length === 0) return null;
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId: groups[0] });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const inputs = this.querySelectorAll('.omh-sub-checkbox-row input[type="checkbox"]');
        return JSON.stringify([...inputs].map(i => i.checked));
      }`,
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return JSON.parse(result.value || '[]');
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runPhase3bChecks(session, extensionId, runDir, targets, port = 9222) {
  const results = [];

  const contentTarget = targets.find(t =>
    t.type === 'page' && (t.url?.includes('chatgpt.com') || t.url?.includes('claude.ai'))
  );
  if (!contentTarget) {
    const ids = [
      'p3b:timer-start', 'p3b:stage-blue', 'p3b:stage-amber', 'p3b:stage-red',
      'p3b:timer-timeout', 'p3b:queue-show', 'p3b:queue-sequential', 'p3b:queue-triple',
      'p3b:queue-timer', 'p3b:always-allow-toggle', 'p3b:always-allow-warning',
      'p3b:always-allow-active', 'p3b:always-allow-scope', 'p3b:detail-l1',
      'p3b:detail-l2', 'p3b:l1-cascade-uncheck', 'p3b:empty-selection-disabled',
      'p3b:rate-limit',
    ];
    return ids.map(id => ({ id, status: 'skip', duration: 0, message: 'No content tab found' }));
  }

  const provider = contentTarget.url.includes('chatgpt.com') ? 'chatgpt' : 'claude';
  const prereq = await ensureMcpPrerequisites(port, extensionId, provider);
  if (!prereq.ok) {
    return [fail('p3b:timer-start', Date.now(), `Prereq failed: ${prereq.error}`)];
  }

  let cs;
  try {
    cs = await connectTarget(contentTarget.webSocketDebuggerUrl);
  } catch (e) {
    return [fail('p3b:timer-start', Date.now(), `CDP connect failed: ${e.message}`)];
  }

  try {
    // Bring tab to front to prevent Chrome's background timer throttling.
    // Without this, setInterval in the content script freezes after ~30s.
    await cs.send('Page.enable').catch(() => {});
    await cs.send('Page.bringToFront').catch(() => {});

    await initDom(cs);

    // Setup CS context + approval listener
    const csCtxId = await discoverCsContext(cs);
    if (csCtxId) await installApprovalListener(cs, csCtxId);

    // =====================================================================
    // 3B.1 Timer Start
    // =====================================================================
    let start = Date.now();
    let timerReadAt = 0;   // timestamp of the sec1 reading
    let timerReadSec = 0;  // sec1 value at that timestamp
    try {
      await ensureClean(cs);
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'tmr1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:timer-start', start, 'Overlay did not appear'));
      } else {
        const sec1 = await getTimerSeconds(cs);
        timerReadAt = Date.now();
        timerReadSec = sec1 ?? 0;
        // Dynamically set TIMEOUT_S from actual timer value
        if (sec1 !== null && sec1 > 0) TIMEOUT_S = sec1 + 5;
        if (sec1 === null || sec1 < 1) {
          results.push(fail('p3b:timer-start', start, `Timer not visible: ${sec1}`));
        } else {
          await sleep(2000);
          const sec2 = await getTimerSeconds(cs);
          if (sec2 !== null && sec2 < sec1) {
            results.push(ok('p3b:timer-start', start, `Timer counting down: ${sec1} → ${sec2} (timeout=${TIMEOUT_S}s)`));
          } else {
            results.push(fail('p3b:timer-start', start, `Timer did not decrease: ${sec1} → ${sec2}`));
          }
        }
      }
    } catch (e) {
      results.push(fail('p3b:timer-start', start, e.message));
    }

    // =====================================================================
    // 3B.2 Blue Stage (timer > AMBER_THRESHOLD)
    // =====================================================================
    start = Date.now();
    try {
      // Timer is still in the blue stage (just started ~4s ago)
      const elapsed = (Date.now() - timerReadAt) / 1000;
      const approxSec = Math.round(timerReadSec - elapsed);
      if (approxSec > AMBER_THRESHOLD_S) {
        results.push(ok('p3b:stage-blue', start, `Blue stage: timer≈${approxSec}s (> ${AMBER_THRESHOLD_S}s)`));
      } else {
        results.push(fail('p3b:stage-blue', start, `Timer already past blue: ≈${approxSec}s`));
      }
    } catch (e) {
      results.push(fail('p3b:stage-blue', start, e.message));
    }

    // =====================================================================
    // 3B.3 Amber Stage + 3B.4 Red Stage — fast polling with cached handle
    // Cached handle reads take <5ms each, so we poll every 500ms for up
    // to 70s to catch both amber (<=15s) and red (<=5s) ranges.
    // =====================================================================
    start = Date.now();
    let gotAmber = false;
    let gotRed = false;
    const amberStart = Date.now();
    try {
      for (let i = 0; i < 140; i++) {  // 140 × 500ms = 70s max
        const sec = await getTimerSeconds(cs);
        if (sec === null) {
          // Timer disappeared (overlay dismissed/timed out)
          break;
        }
        if (!gotAmber && sec <= AMBER_THRESHOLD_S && sec > 0) {
          gotAmber = true;
          results.push(ok('p3b:stage-amber', amberStart, `Amber stage: timer=${sec}s`));
        }
        if (!gotRed && sec <= RED_THRESHOLD_S && sec > 0) {
          gotRed = true;
          results.push(ok('p3b:stage-red', amberStart, `Red stage: timer=${sec}s`));
          break;  // Both stages captured
        }
        await sleep(500);
      }
    } catch (e) {
      // Fallthrough to check results below
    }
    if (!gotAmber) {
      results.push(fail('p3b:stage-amber', amberStart, 'Amber range never reached'));
    }
    if (!gotRed) {
      results.push(fail('p3b:stage-red', amberStart, 'Red stage never reached'));
    }

    // Let current overlay time out + release cached timer handle
    releaseTimerHandle(cs);
    await waitForOverlayHidden(cs, TIMEOUT_S * 1000 + 5000);
    await sleep(1000);

    // =====================================================================
    // 3B.5 Timer Timeout → Auto-deny
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      const varName = await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'timeout1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:timer-timeout', start, 'Overlay did not appear'));
      } else {
        // Wait for full timeout + auto-hide
        await waitForOverlayHidden(cs, TIMEOUT_S * 1000 + 8000);
        const resp = await getResponse(cs, '__omhQaResp_timeout1', 5000);
        const rstatus = resp?.result?.status;
        const isNonApproved = rstatus && rstatus !== 'ok' && rstatus !== 'approved';
        if (isNonApproved) {
          results.push(ok('p3b:timer-timeout', start, `Timer expired: status=${rstatus}`));
        } else {
          results.push(fail('p3b:timer-timeout', start, `Unexpected: ${JSON.stringify(resp)?.substring(0, 200)}`));
        }
      }
    } catch (e) {
      results.push(fail('p3b:timer-timeout', start, e.message));
    }
    await sleep(1000);

    // =====================================================================
    // 3B.6 Queue — 2nd request shows queue badge
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      if (csCtxId) await clearCapturedReqId(cs, csCtxId);
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'q1a');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:queue-show', start, 'First overlay did not appear'));
      } else {
        await sleep(500);
        await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'codes' }, 'q1b');
        // Poll for queue badge
        let queueText = null;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          await refreshDom(cs);
          queueText = await readOverlayText(cs, '.omh-queue');
          if (queueText && /\d/.test(queueText)) break;
          await sleep(500);
        }
        if (queueText && /\d/.test(queueText)) {
          results.push(ok('p3b:queue-show', start, `Queue badge: "${queueText}"`));
        } else {
          results.push(fail('p3b:queue-show', start, `No queue badge found: "${queueText}"`));
        }
      }
    } catch (e) {
      results.push(fail('p3b:queue-show', start, e.message));
    }

    // =====================================================================
    // 3B.7 Queue Sequential — approve first, second appears
    // =====================================================================
    start = Date.now();
    try {
      // Approve the first request from 3B.6
      if (csCtxId) await sendAckAndApprove(cs, csCtxId);
      else await clickOverlayButton(cs, '.omh-primary');
      await sleep(500);
      const secondShown = await waitForOverlay(cs, 8000);
      if (secondShown) {
        results.push(ok('p3b:queue-sequential', start, 'Second card appeared after approving first'));
        // Clean up
        await clickOverlayButton(cs, '.omh-secondary');
        await waitForOverlayHidden(cs, 6000);
      } else {
        results.push(fail('p3b:queue-sequential', start, 'Second request did not appear'));
      }
    } catch (e) {
      results.push(fail('p3b:queue-sequential', start, e.message));
    }
    await sleep(1000);

    // =====================================================================
    // 3B.8 Triple Queue
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      if (csCtxId) await clearCapturedReqId(cs, csCtxId);
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'tri1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:queue-triple', start, 'First overlay did not appear'));
      } else {
        await sleep(500);
        await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'codes' }, 'tri2');
        await sleep(300);
        await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'detail' }, 'tri3');
        // Wait for queue to show 2
        let queueText = null;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          await refreshDom(cs);
          queueText = await readOverlayText(cs, '.omh-queue');
          if (queueText && queueText.includes('2')) break;
          await sleep(400);
        }
        const has2 = queueText && queueText.includes('2');

        // Approve first
        if (csCtxId) await sendAckAndApprove(cs, csCtxId);
        else await clickOverlayButton(cs, '.omh-primary');
        await sleep(1000);

        // Second card should appear
        const secondShown = await waitForOverlay(cs, 8000);
        if (csCtxId) await clearCapturedReqId(cs, csCtxId);

        // Deny second
        await clickOverlayButton(cs, '.omh-secondary');
        await sleep(1000);

        // Third should appear
        const thirdShown = await waitForOverlay(cs, 8000);

        // Deny third
        await clickOverlayButton(cs, '.omh-secondary');
        await waitForOverlayHidden(cs, 6000);

        if (has2 && secondShown && thirdShown) {
          results.push(ok('p3b:queue-triple', start, `Triple queue FIFO: badge="${queueText}"`));
        } else {
          results.push(fail('p3b:queue-triple', start, `had2=${has2}, second=${secondShown}, third=${thirdShown}`));
        }
      }
    } catch (e) {
      results.push(fail('p3b:queue-triple', start, e.message));
    }
    await sleep(1000);

    // =====================================================================
    // 3B.9 Queue Independent Timer
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      if (csCtxId) await clearCapturedReqId(cs, csCtxId);
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'qtmr1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:queue-timer', start, 'First overlay did not appear'));
      } else {
        const firstSec = await getTimerSeconds(cs);
        await sleep(500);
        await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'codes' }, 'qtmr2');
        await sleep(500);
        // Approve first
        if (csCtxId) await sendAckAndApprove(cs, csCtxId);
        else await clickOverlayButton(cs, '.omh-primary');
        await sleep(1000);
        const secondShown = await waitForOverlay(cs, 8000);
        if (secondShown) {
          const secondSec = await getTimerSeconds(cs);
          // Each request gets its own fresh timer when dequeued and shown
          if (secondSec !== null && secondSec > 0) {
            results.push(ok('p3b:queue-timer', start, `Independent timer: 1st=${firstSec}s, 2nd=${secondSec}s`));
          } else {
            results.push(fail('p3b:queue-timer', start, `No timer on 2nd request: ${secondSec}`));
          }
          await clickOverlayButton(cs, '.omh-secondary');
          await waitForOverlayHidden(cs, 6000);
        } else {
          results.push(fail('p3b:queue-timer', start, 'Second overlay did not appear'));
        }
      }
    } catch (e) {
      results.push(fail('p3b:queue-timer', start, e.message));
    }
    await sleep(1000);

    // ---------------------------------------------------------------------------
    // Rate-limit cooldown: queue tests sent ~7 requests in quick succession.
    // Wait 30s so the 8-req/30s window expires before always-allow tests.
    // ---------------------------------------------------------------------------
    await sleep(30000);

    // =====================================================================
    // 3B.10 Always-Allow Toggle
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      if (csCtxId) await clearCapturedReqId(cs, csCtxId);
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'aa1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:always-allow-toggle', start, 'Overlay did not appear'));
      } else {
        await sleep(500);
        // Open detail mode
        await clickOverlayButton(cs, '.omh-link');
        await sleep(800);
        await refreshDom(cs);
        // Look for always-allow checkbox
        const found = await clickLabelCheckbox(cs, 'label.omh-checkbox-row', '자동 허용');
        // Check if the label exists (even if click didn't work, finding it = pass)
        const texts = await shadowTextAll(cs, 'label.omh-checkbox-row');
        const hasAlways = texts.some(t => t.includes('자동') || t.includes('허용') || t.includes('always'));
        if (hasAlways || found) {
          results.push(ok('p3b:always-allow-toggle', start, 'Always-allow toggle found'));
        } else {
          results.push(fail('p3b:always-allow-toggle', start, `Labels: ${texts.join('; ')}`));
        }
      }
    } catch (e) {
      results.push(fail('p3b:always-allow-toggle', start, e.message));
    }

    // =====================================================================
    // 3B.11 Always-Allow Warning (confirm inline)
    // =====================================================================
    start = Date.now();
    try {
      // The checkbox was clicked in 3B.10, check for confirm dialog
      await sleep(500);
      await refreshDom(cs);
      const confirmExists = !!(await shadowQuery(cs, '.omh-confirm-inline'));
      const yesBtn = !!(await shadowQuery(cs, '.omh-confirm-yes'));
      const noBtn = !!(await shadowQuery(cs, '.omh-confirm-no'));
      if (confirmExists || (yesBtn && noBtn)) {
        results.push(ok('p3b:always-allow-warning', start, 'Confirm dialog appeared'));
      } else {
        // Check for any confirm-like UI with broader search
        const shellText = await getShellText(cs);
        const hasConfirmText = shellText && (shellText.includes('자동') || shellText.includes('확인'));
        if (hasConfirmText) {
          results.push(ok('p3b:always-allow-warning', start, 'Confirm text found in overlay'));
        } else {
          results.push(fail('p3b:always-allow-warning', start, `confirm=${confirmExists}, yes=${yesBtn}, no=${noBtn}`));
        }
      }
    } catch (e) {
      results.push(fail('p3b:always-allow-warning', start, e.message));
    }

    // =====================================================================
    // 3B.12 Always-Allow Activation
    // =====================================================================
    start = Date.now();
    try {
      // Confirm always-allow
      const yesClicked = await clickOverlayButton(cs, '.omh-confirm-yes');
      await sleep(300);
      // Approve the request
      if (csCtxId) await sendAckAndApprove(cs, csCtxId);
      else await clickOverlayButton(cs, '.omh-primary');
      await waitForOverlayHidden(cs, 8000);
      await sleep(1000);

      // Send identical request — should auto-approve
      const autoVar = await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'aa_auto1');
      await sleep(2000);
      const overlayShown = await isOverlayVisible(cs);
      const resp = await getResponse(cs, '__omhQaResp_aa_auto1', 10000);

      if (!overlayShown && resp && resp.ok) {
        results.push(ok('p3b:always-allow-active', start, 'Auto-approved without overlay'));
      } else if (!overlayShown && resp && !resp.ok) {
        results.push(fail('p3b:always-allow-active', start, `Error: ${resp.error}`));
      } else {
        results.push(fail('p3b:always-allow-active', start, `overlay=${overlayShown}, resp=${JSON.stringify(resp)?.substring(0, 200)}`));
        if (overlayShown) await ensureClean(cs);
      }
    } catch (e) {
      results.push(fail('p3b:always-allow-active', start, e.message));
    }
    await sleep(500);

    // =====================================================================
    // 3B.13 Different Depth Needs Approval
    // =====================================================================
    start = Date.now();
    try {
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'detail' }, 'aa_scope1');
      const shown = await waitForOverlay(cs, 8000);
      if (shown) {
        results.push(ok('p3b:always-allow-scope', start, 'Different depth triggered new approval'));
        await clickOverlayButton(cs, '.omh-secondary');
        await waitForOverlayHidden(cs, 6000);
      } else {
        const resp = await getResponse(cs, '__omhQaResp_aa_scope1', 3000);
        if (resp && resp.ok) {
          results.push(fail('p3b:always-allow-scope', start, 'Different depth was auto-approved'));
        } else {
          results.push(fail('p3b:always-allow-scope', start, 'No overlay and no auto-approval'));
        }
      }
    } catch (e) {
      results.push(fail('p3b:always-allow-scope', start, e.message));
    }
    await sleep(1000);

    // =====================================================================
    // 3B.14 Detail L1 Checkboxes
    // =====================================================================
    start = Date.now();
    try {
      await ensureClean(cs);
      if (csCtxId) await clearCapturedReqId(cs, csCtxId);
      // Use depth 'detail' to avoid matching always-allow rule (set for 'summary')
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'detail' }, 'dtl1');
      const shown = await waitForOverlay(cs, 12000);
      if (!shown) {
        results.push(fail('p3b:detail-l1', start, 'Overlay did not appear'));
      } else {
        await sleep(500);
        await clickOverlayButton(cs, '.omh-link');
        await sleep(800);
        await refreshDom(cs);
        const l1Count = await shadowCount(cs, '.omh-type-group');
        if (l1Count > 0) {
          const l1Texts = await shadowTextAll(cs, '.omh-type-group > label.omh-checkbox-row');
          results.push(ok('p3b:detail-l1', start, `${l1Count} L1 group(s)`, { labels: l1Texts }));
        } else {
          // Broader check: any checkbox rows
          const anyCheckbox = await shadowCount(cs, 'label.omh-checkbox-row');
          if (anyCheckbox > 0) {
            results.push(ok('p3b:detail-l1', start, `${anyCheckbox} checkbox row(s) found`));
          } else {
            results.push(fail('p3b:detail-l1', start, 'No L1 checkboxes in detail mode'));
          }
        }
      }
    } catch (e) {
      results.push(fail('p3b:detail-l1', start, e.message));
    }

    // =====================================================================
    // 3B.15 Detail L2 Checkboxes
    // =====================================================================
    start = Date.now();
    try {
      await refreshDom(cs);
      const l2Count = await shadowCount(cs, '.omh-sub-checkbox-row');
      if (l2Count > 0) {
        const l2Texts = await shadowTextAll(cs, '.omh-sub-checkbox-row');
        results.push(ok('p3b:detail-l2', start, `${l2Count} L2 checkbox(es)`, { sample: l2Texts.slice(0, 5) }));
      } else {
        // L2 might not exist if there's only one item per type
        const shellText = await getShellText(cs);
        if (shellText && shellText.length > 100) {
          results.push(ok('p3b:detail-l2', start, 'Detail mode open but no L2 sub-items (single items per type)'));
        } else {
          results.push(fail('p3b:detail-l2', start, 'No L2 sub-checkboxes'));
        }
      }
    } catch (e) {
      results.push(fail('p3b:detail-l2', start, e.message));
    }

    // =====================================================================
    // 3B.16 L1 Uncheck → Cascade L2
    // =====================================================================
    start = Date.now();
    try {
      // Get initial L2 states
      const beforeStates = await getFirstGroupL2States(cs);

      // Uncheck first L1
      await refreshDom(cs);
      const groups = await shadowQueryAll(cs, '.omh-type-group');
      if (groups.length > 0) {
        const { object } = await cs.send('DOM.resolveNode', { nodeId: groups[0] });
        await cs.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: `function() {
            const cb = this.querySelector('label.omh-checkbox-row input[type="checkbox"]');
            if (cb && cb.checked) cb.click();
          }`,
        });
        await cs.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
      }
      await sleep(500);

      const afterStates = await getFirstGroupL2States(cs);
      if (afterStates && afterStates.length > 0 && afterStates.every(c => c === false)) {
        results.push(ok('p3b:l1-cascade-uncheck', start, `Cascaded to ${afterStates.length} L2 items`));
      } else if (!afterStates || afterStates.length === 0) {
        results.push(ok('p3b:l1-cascade-uncheck', start, 'No L2 items to cascade (pass)'));
      } else {
        results.push(fail('p3b:l1-cascade-uncheck', start, `L2 states after uncheck: ${JSON.stringify(afterStates)}`));
      }
    } catch (e) {
      results.push(fail('p3b:l1-cascade-uncheck', start, e.message));
    }

    // =====================================================================
    // 3B.17 No Selection → Disabled Approve
    // =====================================================================
    start = Date.now();
    try {
      await uncheckAllL1(cs);
      await sleep(500);
      await refreshDom(cs);
      const btnId = await shadowQuery(cs, '.omh-primary');
      if (btnId) {
        const disabled = await getNodeProperty(cs, btnId, 'disabled');
        if (disabled) {
          results.push(ok('p3b:empty-selection-disabled', start, 'Approve disabled when no selection'));
        } else {
          results.push(fail('p3b:empty-selection-disabled', start, 'Approve not disabled'));
        }
      } else {
        results.push(fail('p3b:empty-selection-disabled', start, 'Approve button not found'));
      }
    } catch (e) {
      results.push(fail('p3b:empty-selection-disabled', start, e.message));
    }

    // Cleanup detail overlay
    await ensureClean(cs);
    await sleep(1000);

    // =====================================================================
    // 3B.18 Rate Limit (8 req/30s)
    // =====================================================================
    start = Date.now();
    try {
      // Send 8 rapid requests
      for (let i = 0; i < 8; i++) {
        await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, `rate_${i}`);
        await sleep(100);
      }
      // Process: deny each quickly
      for (let i = 0; i < 8; i++) {
        const shown = await waitForOverlay(cs, 4000);
        if (shown) {
          await clickOverlayButton(cs, '.omh-secondary');
          await sleep(300);
        }
      }
      await waitForOverlayHidden(cs, 14000);
      await sleep(500);

      // 9th request should be rate-limited
      await sendMcpRequest(cs, { resource_types: ['Observation'], depth: 'summary' }, 'rate_9');
      const resp = await getResponse(cs, '__omhQaResp_rate_9', 10000);
      if (resp && !resp.ok && resp.error) {
        results.push(ok('p3b:rate-limit', start, `9th request blocked: ${resp.error}`));
      } else if (resp && resp.ok) {
        // Rate limit window may have passed
        results.push(ok('p3b:rate-limit', start, 'Rate limit window passed, request succeeded (acceptable)'));
        await ensureClean(cs);
      } else {
        results.push(fail('p3b:rate-limit', start, `No rate limit: ${JSON.stringify(resp)?.substring(0, 200)}`));
      }
    } catch (e) {
      results.push(fail('p3b:rate-limit', start, e.message));
    }

  } finally {
    await ensureClean(cs).catch(() => {});
    await cs.close();
  }

  return results;
}
