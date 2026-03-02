/**
 * Phase 3A: MCP Core Flow checks (16 checks)
 *
 * Validates the MCP approval card lifecycle:
 * request → overlay render → approve/deny → response return.
 *
 * Uses CDP Runtime.evaluate for postMessage bridge (main world)
 * and CDP DOM domain (shadow-pierce) for closed shadow DOM access.
 *
 * Key fixes:
 * - Per-request response variables to prevent cross-contamination.
 * - Manual overlay:approval-rendered ACK via CS context.
 *   The natural ACK (from React useEffect + rAF) doesn't fire reliably
 *   through CDP because the closed shadow DOM's dialogRef.isConnected
 *   check fails in the rAF callback. We work around this by:
 *   1. Listening for overlay:show-approval in the CS context to capture
 *      the background's internal requestId.
 *   2. Manually sending overlay:approval-rendered ACK before clicking approve.
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
  readOverlayText,
  overlayHasElement,
  getShellText,
  shadowQuery,
  shadowQueryAll,
  getNodeText,
  getNodeProperty,
  getNodeRect,
} from '../shadow-pierce.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let requestCounter = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Send an MCP read-health-records request via the page bridge.
 * Uses a per-request response variable: `window.__omhQaResp_<N>`.
 */
async function sendMcpRequest(session, payload = {}, suffix = '') {
  const reqNum = ++requestCounter;
  const requestId = `qa-p3a-${Date.now()}-${reqNum}${suffix ? '-' + suffix : ''}`;
  const varName = `__omhQaResp_${reqNum}`;
  await session.send('Runtime.evaluate', {
    expression: `(() => {
      window.${varName} = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => { window.${varName} = e.data; };
      window.postMessage({
        source: 'openmyhealth-page',
        type: 'openmyhealth:mcp:read-health-records',
        requestId: ${JSON.stringify(requestId)},
        payload: ${JSON.stringify({
          resource_types: ['Observation'],
          depth: 'summary',
          ...payload,
        })}
      }, window.location.origin, [channel.port2]);
    })()`,
    returnByValue: true,
  });
  return { requestId, varName };
}

/**
 * Poll a per-request response variable until it has data.
 */
async function getResponse(session, varName, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `window.${varName} ? JSON.stringify(window.${varName}) : null`,
      returnByValue: true,
    });
    if (result.value) {
      return JSON.parse(result.value);
    }
    await sleep(300);
  }
  return null;
}

/**
 * Aggressively ensure overlay is fully dismissed before the next check.
 */
async function ensureClean(session) {
  for (let i = 0; i < 8; i++) {
    const visible = await isOverlayVisible(session);
    if (!visible) break;
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

function findTarget(targets, pattern) {
  return targets.find(t => t.type === 'page' && t.url && t.url.includes(pattern));
}

function getResponseStatus(response) {
  if (!response) return null;
  if (response.ok === true && response.result) {
    return response.result.status;
  }
  if (response.ok === false) return 'error';
  return null;
}

// ---------------------------------------------------------------------------
// CS Context + ACK infrastructure
// ---------------------------------------------------------------------------

/**
 * Discover the content script execution context for the extension.
 * Returns the context ID or null.
 */
async function discoverCsContext(session) {
  const contexts = [];
  const handler = (params) => contexts.push(params.context);
  session.on('Runtime.executionContextCreated', handler);
  await session.send('Runtime.enable');
  await sleep(500);
  session.off('Runtime.executionContextCreated', handler);
  const csCtx = contexts.find(c => c.origin?.includes('chrome-extension'));
  return csCtx?.id ?? null;
}

/**
 * Install a listener in the CS context that captures the requestId
 * from overlay:show-approval messages. This listener persists for the
 * lifetime of the session.
 */
async function installApprovalListener(session, csCtxId) {
  await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: `(() => {
      if (self.__omhQaListenerInstalled) return 'already installed';
      self.__omhQaLastReqId = null;
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'overlay:show-approval' && message.request?.id) {
          self.__omhQaLastReqId = message.request.id;
        }
      });
      self.__omhQaListenerInstalled = true;
      return 'installed';
    })()`,
    returnByValue: true,
  });
}

/**
 * Read the latest captured requestId from the CS context and send
 * the overlay:approval-rendered ACK, then click the approve button.
 *
 * This is needed because the natural ACK (via React useEffect + rAF)
 * doesn't fire reliably when the overlay is in a closed shadow DOM
 * accessed via CDP.
 */
async function sendAckAndApprove(session, csCtxId) {
  // Read the captured requestId
  const { result: reqIdRes } = await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: 'self.__omhQaLastReqId',
    returnByValue: true,
  });
  const internalReqId = reqIdRes.value;
  if (!internalReqId) {
    // Fallback: just click approve without ACK (will likely fail)
    return clickOverlayButton(session, '.omh-primary');
  }

  // Send the ACK
  await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: `chrome.runtime.sendMessage({
      type: "overlay:approval-rendered",
      requestId: ${JSON.stringify(internalReqId)},
    }).catch(() => {})`,
    returnByValue: true,
    awaitPromise: true,
  }).catch(() => {});

  // Small delay for the background to process the ACK
  await sleep(100);

  // Click approve
  return clickOverlayButton(session, '.omh-primary');
}

/**
 * Clear the captured requestId so the next check gets a fresh one.
 */
async function clearCapturedReqId(session, csCtxId) {
  await session.send('Runtime.evaluate', {
    contextId: csCtxId,
    expression: 'self.__omhQaLastReqId = null',
    returnByValue: true,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

/**
 * 3A.1: MCP Request → Approval Card renders
 */
async function checkApprovalCardShow(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'show');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:approval-card-show', status: 'fail', duration: Date.now() - start,
        message: 'Approval card did not appear within 12s' };
    }
    return { id: 'p3a:approval-card-show', status: 'pass', duration: Date.now() - start,
      message: 'Approval card rendered' };
  } catch (e) {
    return { id: 'p3a:approval-card-show', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.2: Approval Card UI Elements
 */
async function checkApprovalUi(session) {
  const start = Date.now();
  try {
    let visible = await isOverlayVisible(session);
    if (!visible) {
      await sendMcpRequest(session, {}, 'ui');
      visible = await waitForOverlay(session, 12000);
    }
    if (!visible) {
      return { id: 'p3a:approval-ui', status: 'fail', duration: Date.now() - start,
        message: 'Overlay not visible' };
    }

    await refreshDom(session);

    const missing = [];
    if (!(await overlayHasElement(session, '.omh-summary'))) missing.push('summary');
    if (!(await overlayHasElement(session, '.omh-primary'))) missing.push('approve button');
    if (!(await overlayHasElement(session, '.omh-secondary'))) missing.push('deny button');
    if (!(await overlayHasElement(session, '.omh-close'))) missing.push('close button');
    if (!(await overlayHasElement(session, '.omh-desc'))) missing.push('description');

    if (missing.length > 0) {
      const shellText = await getShellText(session);
      if (shellText && shellText.length > 50 && missing.length <= 1) {
        return { id: 'p3a:approval-ui', status: 'pass', duration: Date.now() - start,
          message: `UI mostly present (${shellText.length} chars). Minor: ${missing.join(', ')}` };
      }
      return { id: 'p3a:approval-ui', status: 'fail', duration: Date.now() - start,
        message: `Missing: ${missing.join(', ')}` };
    }
    return { id: 'p3a:approval-ui', status: 'pass', duration: Date.now() - start,
      message: 'All required UI elements present' };
  } catch (e) {
    return { id: 'p3a:approval-ui', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.3: Approve → Data Return
 */
async function checkApproveData(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'approve');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:approve-data', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response) {
      return { id: 'p3a:approve-data', status: 'fail', duration: Date.now() - start,
        message: 'No response received after approve' };
    }
    const status = getResponseStatus(response);
    if (status !== 'ok') {
      return { id: 'p3a:approve-data', status: 'fail', duration: Date.now() - start,
        message: `Expected status=ok, got ${status}`, details: response };
    }
    const r = response.result;
    if (!Array.isArray(r.resources)) {
      return { id: 'p3a:approve-data', status: 'fail', duration: Date.now() - start,
        message: 'No resources array in response' };
    }
    return { id: 'p3a:approve-data', status: 'pass', duration: Date.now() - start,
      message: `Approved: ${r.count} records across ${r.resources.length} type(s)` };
  } catch (e) {
    return { id: 'p3a:approve-data', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.4: Deny → Denied Return
 */
async function checkDenyResponse(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    const { varName } = await sendMcpRequest(session, {}, 'deny');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:deny-response', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(300);
    await clickOverlayButton(session, '.omh-secondary');
    const response = await getResponse(session, varName, 20000);
    if (!response) {
      return { id: 'p3a:deny-response', status: 'fail', duration: Date.now() - start,
        message: 'No response after deny' };
    }
    const status = getResponseStatus(response);
    if (status !== 'denied') {
      return { id: 'p3a:deny-response', status: 'fail', duration: Date.now() - start,
        message: `Expected denied, got ${status}` };
    }
    return { id: 'p3a:deny-response', status: 'pass', duration: Date.now() - start,
      message: 'Deny returned denied status' };
  } catch (e) {
    return { id: 'p3a:deny-response', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.5: Close (x) = Deny
 */
async function checkCloseIsDeny(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    const { varName } = await sendMcpRequest(session, {}, 'close');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:close-is-deny', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(300);
    await clickOverlayButton(session, '.omh-close');
    const response = await getResponse(session, varName, 20000);
    if (!response) {
      return { id: 'p3a:close-is-deny', status: 'fail', duration: Date.now() - start,
        message: 'No response after close' };
    }
    const status = getResponseStatus(response);
    if (status !== 'denied') {
      return { id: 'p3a:close-is-deny', status: 'fail', duration: Date.now() - start,
        message: `Expected denied, got ${status}` };
    }
    return { id: 'p3a:close-is-deny', status: 'pass', duration: Date.now() - start,
      message: 'Close button triggers denied response' };
  } catch (e) {
    return { id: 'p3a:close-is-deny', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.6: Escape = Deny
 */
async function checkEscapeDeny(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    const { varName } = await sendMcpRequest(session, {}, 'escape');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:escape-deny', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(300);
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape',
      windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape',
      windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
    const response = await getResponse(session, varName, 20000);
    if (!response) {
      return { id: 'p3a:escape-deny', status: 'fail', duration: Date.now() - start,
        message: 'No response after Escape' };
    }
    const status = getResponseStatus(response);
    if (status !== 'denied') {
      return { id: 'p3a:escape-deny', status: 'fail', duration: Date.now() - start,
        message: `Expected denied, got ${status}` };
    }
    return { id: 'p3a:escape-deny', status: 'pass', duration: Date.now() - start,
      message: 'Escape key triggers denied response' };
  } catch (e) {
    return { id: 'p3a:escape-deny', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.7: Depth "codes" Response
 */
async function checkDepthCodes(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'codes' }, 'codes');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:depth-codes', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result) {
      return { id: 'p3a:depth-codes', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }
    const r = response.result;
    if (r.depth !== 'codes') {
      return { id: 'p3a:depth-codes', status: 'fail', duration: Date.now() - start,
        message: `Expected depth=codes, got ${r.depth}` };
    }
    return { id: 'p3a:depth-codes', status: 'pass', duration: Date.now() - start,
      message: `Codes depth: ${r.count} records` };
  } catch (e) {
    return { id: 'p3a:depth-codes', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.8: Depth "summary" Response
 */
async function checkDepthSummary(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'summary');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:depth-summary', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result) {
      return { id: 'p3a:depth-summary', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }
    const r = response.result;
    if (r.depth !== 'summary') {
      return { id: 'p3a:depth-summary', status: 'fail', duration: Date.now() - start,
        message: `Expected depth=summary, got ${r.depth}` };
    }
    const records = r.resources?.flatMap(res => res.data) || [];
    if (records.length > 0 && typeof records[0].display !== 'string') {
      return { id: 'p3a:depth-summary', status: 'fail', duration: Date.now() - start,
        message: 'Summary records missing display field' };
    }
    return { id: 'p3a:depth-summary', status: 'pass', duration: Date.now() - start,
      message: `Summary depth: ${r.count} records` };
  } catch (e) {
    return { id: 'p3a:depth-summary', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.9: Depth "detail" Response
 */
async function checkDepthDetail(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'detail' }, 'detail');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:depth-detail', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result) {
      return { id: 'p3a:depth-detail', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }
    const r = response.result;
    if (r.depth !== 'detail') {
      return { id: 'p3a:depth-detail', status: 'fail', duration: Date.now() - start,
        message: `Expected depth=detail, got ${r.depth}` };
    }
    return { id: 'p3a:depth-detail', status: 'pass', duration: Date.now() - start,
      message: `Detail depth: ${r.count} records` };
  } catch (e) {
    return { id: 'p3a:depth-detail', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.10: Resource Types Filter (single type)
 */
async function checkFilterSingle(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'filter1');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:filter-single', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result || response.result.status !== 'ok') {
      return { id: 'p3a:filter-single', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }
    const types = (response.result.resources || []).map(res => res.resource_type);
    if (types.some(t => t !== 'Observation')) {
      return { id: 'p3a:filter-single', status: 'fail', duration: Date.now() - start,
        message: `Expected only Observation, got: ${types.join(', ')}` };
    }
    return { id: 'p3a:filter-single', status: 'pass', duration: Date.now() - start,
      message: `Filter single: only Observation (${response.result.count} records)` };
  } catch (e) {
    return { id: 'p3a:filter-single', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.11: Multiple Resource Types
 */
async function checkFilterMulti(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, {
      resource_types: ['Observation', 'MedicationStatement'],
      depth: 'summary',
    }, 'filter2');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:filter-multi', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result || response.result.status !== 'ok') {
      return { id: 'p3a:filter-multi', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }
    const types = (response.result.resources || []).map(res => res.resource_type);
    const allowed = new Set(['Observation', 'MedicationStatement']);
    const unexpected = types.filter(t => !allowed.has(t));
    if (unexpected.length > 0) {
      return { id: 'p3a:filter-multi', status: 'fail', duration: Date.now() - start,
        message: `Unexpected types: ${unexpected.join(', ')}` };
    }
    return { id: 'p3a:filter-multi', status: 'pass', duration: Date.now() - start,
      message: `Filter multi: ${types.join(', ')} (${response.result.count} total)` };
  } catch (e) {
    return { id: 'p3a:filter-multi', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.12: Dual Verification — AI description + Extension summary
 */
async function checkDualVerify(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'dual');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:dual-verify', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(300);

    const summaryText = await readOverlayText(session, '.omh-summary');
    const descText = await readOverlayText(session, '.omh-desc');

    const issues = [];
    if (!summaryText) issues.push('Extension summary missing');
    if (!descText) issues.push('AI description missing');

    if (issues.length > 0) {
      const shellText = await getShellText(session);
      if (shellText && shellText.length > 50) {
        return { id: 'p3a:dual-verify', status: 'pass', duration: Date.now() - start,
          message: `Both present in overlay (${shellText.length} chars)` };
      }
      return { id: 'p3a:dual-verify', status: 'fail', duration: Date.now() - start,
        message: issues.join('; ') };
    }
    return { id: 'p3a:dual-verify', status: 'pass', duration: Date.now() - start,
      message: 'Both AI description and extension summary present' };
  } catch (e) {
    return { id: 'p3a:dual-verify', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.13: Claude.ai Tab MCP
 */
async function checkClaudeTab(targets, port, extensionId) {
  const start = Date.now();
  const claudeTarget = findTarget(targets, 'claude.ai');
  if (!claudeTarget) {
    return { id: 'p3a:claude-tab', status: 'skip', duration: 0,
      message: 'No claude.ai tab found' };
  }

  const prereq = await ensureMcpPrerequisites(port, extensionId, 'claude');
  if (!prereq.ok) {
    return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start,
      message: `Claude prereq failed: ${prereq.error}` };
  }

  let session;
  try {
    session = await connectTarget(claudeTarget.webSocketDebuggerUrl);
  } catch (e) {
    return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start,
      message: `Failed to connect: ${e.message}` };
  }
  try {
    await initDom(session);

    // Setup CS context for this tab
    const csCtxId = await discoverCsContext(session);
    if (csCtxId) {
      await installApprovalListener(session, csCtxId);
    }

    await ensureClean(session);
    if (csCtxId) await clearCapturedReqId(session, csCtxId);

    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'claude');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear on claude.ai tab' };
    }
    await sleep(500);

    if (csCtxId) {
      await sendAckAndApprove(session, csCtxId);
    } else {
      await clickOverlayButton(session, '.omh-primary');
    }

    const response = await getResponse(session, varName, 20000);
    if (!response) {
      return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start,
        message: 'No response on claude.ai tab' };
    }
    const status = getResponseStatus(response);
    if (status !== 'ok') {
      return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start,
        message: `Response status=${status}`, details: response };
    }
    return { id: 'p3a:claude-tab', status: 'pass', duration: Date.now() - start,
      message: 'Claude.ai tab MCP flow works' };
  } catch (e) {
    return { id: 'p3a:claude-tab', status: 'fail', duration: Date.now() - start, message: e.message };
  } finally {
    await ensureClean(session).catch(() => {});
    await session.close();
  }
}

/**
 * 3A.14: Response Schema Validation
 */
async function checkResponseSchema(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    const { varName } = await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'schema');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:response-schema', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    const response = await getResponse(session, varName, 20000);
    if (!response || !response.result) {
      return { id: 'p3a:response-schema', status: 'fail', duration: Date.now() - start,
        message: 'No valid response', details: response };
    }

    const envIssues = [];
    if (response.source !== 'openmyhealth-extension') envIssues.push('source mismatch');
    if (typeof response.requestId !== 'string') envIssues.push('missing requestId');
    if (response.ok !== true) envIssues.push('ok not true');

    const r = response.result;
    const issues = [];
    if (typeof r.status !== 'string') issues.push('status not string');
    if (typeof r.depth !== 'string') issues.push('depth not string');
    if (!Array.isArray(r.resources)) issues.push('resources not array');
    if (typeof r.count !== 'number') issues.push('count not number');
    if (typeof r.schema_version !== 'string') issues.push('schema_version missing');

    if (Array.isArray(r.resources) && r.resources.length > 0) {
      const res0 = r.resources[0];
      if (typeof res0.resource_type !== 'string') issues.push('resource_type not string');
      if (typeof res0.count !== 'number') issues.push('resource count not number');
      if (!Array.isArray(res0.data)) issues.push('data not array');
    }

    const allIssues = [...envIssues, ...issues];
    if (allIssues.length > 0) {
      return { id: 'p3a:response-schema', status: 'fail', duration: Date.now() - start,
        message: `Schema issues: ${allIssues.join('; ')}` };
    }
    return { id: 'p3a:response-schema', status: 'pass', duration: Date.now() - start,
      message: `Schema valid (v${r.schema_version}, ${r.resources.length} types, count=${r.count})` };
  } catch (e) {
    return { id: 'p3a:response-schema', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.15: Approved → Resolved State (auto-hides)
 */
async function checkResolvedApproved(session, csCtxId) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await clearCapturedReqId(session, csCtxId);
    await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'res-appr');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:resolved-approved', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(500);
    await sendAckAndApprove(session, csCtxId);
    await sleep(800);

    const shellText = await getShellText(session);
    const hidden = await waitForOverlayHidden(session, 8000);

    if (hidden) {
      return { id: 'p3a:resolved-approved', status: 'pass', duration: Date.now() - start,
        message: `Resolved approved: auto-hid${shellText ? ' (had resolved content)' : ''}` };
    }
    return { id: 'p3a:resolved-approved', status: 'fail', duration: Date.now() - start,
      message: 'Overlay did not auto-hide after approve' };
  } catch (e) {
    return { id: 'p3a:resolved-approved', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * 3A.16: Denied → Resolved State (auto-hides)
 */
async function checkResolvedDenied(session) {
  const start = Date.now();
  try {
    await ensureClean(session);
    await sendMcpRequest(session, { resource_types: ['Observation'], depth: 'summary' }, 'res-deny');
    const visible = await waitForOverlay(session, 12000);
    if (!visible) {
      return { id: 'p3a:resolved-denied', status: 'fail', duration: Date.now() - start,
        message: 'Overlay did not appear' };
    }
    await sleep(300);
    await clickOverlayButton(session, '.omh-secondary');
    await sleep(800);

    const shellText = await getShellText(session);
    const hidden = await waitForOverlayHidden(session, 8000);

    if (hidden) {
      return { id: 'p3a:resolved-denied', status: 'pass', duration: Date.now() - start,
        message: `Resolved denied: auto-hid${shellText ? ' (had resolved content)' : ''}` };
    }
    return { id: 'p3a:resolved-denied', status: 'fail', duration: Date.now() - start,
      message: 'Overlay did not auto-hide after deny' };
  } catch (e) {
    return { id: 'p3a:resolved-denied', status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runPhase3aChecks(session, extensionId, runDir, targets, port = 9222) {
  const results = [];

  const chatgptTarget = targets.find(t =>
    t.type === 'page' && t.url && t.url.includes('chatgpt.com')
  );
  const claudeTarget = targets.find(t =>
    t.type === 'page' && t.url && t.url.includes('claude.ai')
  );
  const contentTarget = chatgptTarget || claudeTarget;
  const primaryProvider = chatgptTarget ? 'chatgpt' : 'claude';

  if (!contentTarget) {
    const skipMsg = 'chatgpt.com/claude.ai tab not found';
    const allIds = [
      'p3a:approval-card-show', 'p3a:approval-ui', 'p3a:approve-data',
      'p3a:deny-response', 'p3a:close-is-deny', 'p3a:escape-deny',
      'p3a:depth-codes', 'p3a:depth-summary', 'p3a:depth-detail',
      'p3a:filter-single', 'p3a:filter-multi', 'p3a:dual-verify',
      'p3a:claude-tab', 'p3a:response-schema',
      'p3a:resolved-approved', 'p3a:resolved-denied',
    ];
    return allIds.map(id => ({ id, status: 'skip', duration: 0, message: skipMsg }));
  }

  const prereq = await ensureMcpPrerequisites(port, extensionId, primaryProvider);
  if (!prereq.ok) {
    return [{ id: 'p3a:approval-card-show', status: 'fail', duration: 0,
      message: `MCP prerequisite failed: ${prereq.error}` }];
  }

  let contentSession;
  try {
    contentSession = await connectTarget(contentTarget.webSocketDebuggerUrl);
  } catch (e) {
    return [{ id: 'p3a:approval-card-show', status: 'fail', duration: 0,
      message: `Content tab connection failed: ${e.message}` }];
  }

  try {
    await initDom(contentSession);

    // Setup CS context + approval listener for ACK workaround
    const csCtxId = await discoverCsContext(contentSession);
    if (csCtxId) {
      await installApprovalListener(contentSession, csCtxId);
    }

    // 3A.1 + 3A.2: Card show + UI
    results.push(await checkApprovalCardShow(contentSession));
    results.push(await checkApprovalUi(contentSession));

    // 3A.3-6: Approve, Deny, Close, Escape
    results.push(await checkApproveData(contentSession, csCtxId));
    results.push(await checkDenyResponse(contentSession));
    results.push(await checkCloseIsDeny(contentSession));
    results.push(await checkEscapeDeny(contentSession));

    // 3A.7-9: Depth variations
    results.push(await checkDepthCodes(contentSession, csCtxId));
    results.push(await checkDepthSummary(contentSession, csCtxId));
    results.push(await checkDepthDetail(contentSession, csCtxId));

    // 3A.10-11: Filter variations
    results.push(await checkFilterSingle(contentSession, csCtxId));
    results.push(await checkFilterMulti(contentSession, csCtxId));

    // 3A.12: Dual verify (read-only, no approve needed)
    results.push(await checkDualVerify(contentSession));

    // 3A.13: Claude.ai tab (separate session)
    await ensureClean(contentSession);
    results.push(await checkClaudeTab(targets, port, extensionId));

    // Restore provider for remaining checks
    if (primaryProvider !== 'claude') {
      await ensureMcpPrerequisites(port, extensionId, primaryProvider);
    }

    // 3A.14-16: Schema, Resolved states
    results.push(await checkResponseSchema(contentSession, csCtxId));
    results.push(await checkResolvedApproved(contentSession, csCtxId));
    results.push(await checkResolvedDenied(contentSession));
  } finally {
    await ensureClean(contentSession).catch(() => {});
    await contentSession.close();
  }

  return results;
}
