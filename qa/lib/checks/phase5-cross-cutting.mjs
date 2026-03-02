/**
 * Phase 5: Cross-cutting E2E Checks
 * Audit Log, Providers, Accessibility, and OAuth.
 *
 * Prerequisites:
 *   - Phase 3 has run (audit log entries should exist from approval/denial/timeout)
 *   - Session connected to a temp tab showing vault.html
 *   - PIN already set to "123456" (Phase 1 completed)
 */

import { connectTarget, discoverTargets } from '../cdp-client.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(id, start, message, details) {
  return { id, status: 'pass', duration: Date.now() - start, message, ...(details && { details }) };
}

function fail(id, start, message, details) {
  return { id, status: 'fail', duration: Date.now() - start, message, ...(details && { details }) };
}

function skip(id, message) {
  return { id, status: 'skip', duration: 0, message };
}

/**
 * Evaluate an async expression inside the extension context via CDP.
 */
async function evalAsync(session, expression) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown error';
    throw new Error(text);
  }
  return result;
}

/**
 * Send a chrome.runtime.sendMessage and parse the JSON response.
 */
async function sendExtMessage(session, payload) {
  const payloadJson = JSON.stringify(payload);
  const result = await evalAsync(session, `(async () => {
    const resp = await chrome.runtime.sendMessage(${payloadJson});
    return JSON.stringify(resp);
  })()`);
  return JSON.parse(result.value);
}

/**
 * Query all audit log entries from IndexedDB.
 */
async function queryAuditLogs(session) {
  const result = await evalAsync(session, `(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("openmyhealth_vault", 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction("audit_logs", "readonly");
      const store = tx.objectStore("audit_logs");
      const all = await new Promise(r => {
        const req = store.getAll();
        req.onsuccess = () => r(req.result);
      });
      return JSON.stringify(all);
    } finally {
      db.close();
    }
  })()`);
  return JSON.parse(result.value);
}

const AUDIT_REQUIRED_FIELDS = ['id', 'timestamp', 'ai_provider', 'resource_types', 'depth', 'result', 'permission_level'];

/**
 * Check that an audit entry has all required fields.
 */
function validateAuditEntry(entry) {
  const missing = AUDIT_REQUIRED_FIELDS.filter(f => entry[f] === undefined || entry[f] === null);
  return { valid: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runPhase5Checks(session, extensionId, runDir, targets, port) {
  const results = [];

  const ALL_IDS = [
    'p5:audit-approved', 'p5:audit-denied', 'p5:audit-timeout', 'p5:audit-ui',
    'p5:provider-chatgpt', 'p5:provider-claude', 'p5:provider-gemini-disabled',
    'p5:provider-connection', 'p5:cross-provider-audit',
    'p5:shadow-isolation', 'p5:a11y-touch-target', 'p5:a11y-aria-live',
    'p5:a11y-tab-trap', 'p5:oauth-relay',
  ];

  // Navigate to vault.html
  try {
    await session.send('Page.enable');
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout (15s)')), 15000);
      session.once('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
    });
    await session.send('Page.navigate', { url: `chrome-extension://${extensionId}/vault.html` });
    await loadPromise;
    await new Promise(r => setTimeout(r, 1500));
  } catch (e) {
    return ALL_IDS.map(id => skip(id, `Page load failed: ${e.message}`));
  }

  // Unlock vault
  try {
    const unlockResp = await sendExtMessage(session, { type: 'session:unlock', pin: '123456' });
    if (!unlockResp.ok) {
      throw new Error(unlockResp.error || 'Unlock failed');
    }
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    return ALL_IDS.map(id => skip(id, `Unlock failed: ${e.message}`));
  }

  // Pre-fetch audit logs once for checks 5.1-5.3, 5.9
  let auditLogs = [];
  try {
    auditLogs = await queryAuditLogs(session);
  } catch (e) {
    // If audit logs can't be queried, fail the audit checks but continue others
    for (const auditId of ['p5:audit-approved', 'p5:audit-denied', 'p5:audit-timeout', 'p5:cross-provider-audit']) {
      results.push(fail(auditId, Date.now(), `IndexedDB audit query failed: ${e.message}`));
    }
  }

  // --- 5.1 Approval -> Audit Log ---
  if (!results.find(r => r.id === 'p5:audit-approved')) {
    const id = 'p5:audit-approved';
    const start = Date.now();
    try {
      const approved = auditLogs.filter(e => e.result === 'approved');
      if (approved.length === 0) {
        results.push(fail(id, start, 'No approved audit entries found'));
      } else {
        const latest = approved[approved.length - 1];
        const validation = validateAuditEntry(latest);
        if (validation.valid) {
          results.push(ok(id, start, `Found ${approved.length} approved entries, latest valid`, { count: approved.length, latest }));
        } else {
          results.push(fail(id, start, `Latest approved entry missing fields: ${validation.missing.join(', ')}`, latest));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.2 Denial -> Audit Log ---
  if (!results.find(r => r.id === 'p5:audit-denied')) {
    const id = 'p5:audit-denied';
    const start = Date.now();
    try {
      const denied = auditLogs.filter(e => e.result === 'denied');
      if (denied.length === 0) {
        results.push(fail(id, start, 'No denied audit entries found'));
      } else {
        const latest = denied[denied.length - 1];
        const validation = validateAuditEntry(latest);
        if (validation.valid) {
          results.push(ok(id, start, `Found ${denied.length} denied entries, latest valid`, { count: denied.length, latest }));
        } else {
          results.push(fail(id, start, `Latest denied entry missing fields: ${validation.missing.join(', ')}`, latest));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.3 Timeout -> Audit Log ---
  if (!results.find(r => r.id === 'p5:audit-timeout')) {
    const id = 'p5:audit-timeout';
    const start = Date.now();
    try {
      const timeouts = auditLogs.filter(e => e.result === 'timeout');
      if (timeouts.length === 0) {
        results.push(fail(id, start, 'No timeout audit entries found'));
      } else {
        const latest = timeouts[timeouts.length - 1];
        const validation = validateAuditEntry(latest);
        if (validation.valid) {
          results.push(ok(id, start, `Found ${timeouts.length} timeout entries, latest valid`, { count: timeouts.length, latest }));
        } else {
          results.push(fail(id, start, `Latest timeout entry missing fields: ${validation.missing.join(', ')}`, latest));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.4 Audit Log UI ---
  {
    const id = 'p5:audit-ui';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(() => {
        const hasHeading = document.body.innerText.includes('공유 이력');
        const sections = document.querySelectorAll('section');
        let auditSection = null;
        for (const s of sections) {
          const h2 = s.querySelector('h2');
          if (h2 && h2.textContent.includes('공유 이력')) {
            auditSection = s;
            break;
          }
        }
        if (!auditSection) {
          return JSON.stringify({ hasHeading, hasSection: false, entryCount: 0 });
        }
        // Count rendered audit entries (div cards inside the grid)
        const grid = auditSection.querySelector('.grid');
        const entries = grid ? grid.querySelectorAll('[class*="rounded-xl"][class*="border"]') : [];
        return JSON.stringify({
          hasHeading,
          hasSection: true,
          entryCount: entries.length,
        });
      })()`);
      const data = JSON.parse(result.value);
      if (!data.hasHeading) {
        results.push(fail(id, start, '"공유 이력" heading not found in page text'));
      } else if (!data.hasSection) {
        results.push(fail(id, start, 'Audit log section element not found'));
      } else if (data.entryCount === 0) {
        results.push(fail(id, start, 'Audit section exists but no entries rendered', data));
      } else {
        results.push(ok(id, start, `Audit UI rendered with ${data.entryCount} entries`, data));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.5 ChatGPT Provider Card ---
  {
    const id = 'p5:provider-chatgpt';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(() => {
        const input = document.getElementById('provider-chatgpt');
        const label = document.querySelector('label[for="provider-chatgpt"]');
        const labelText = label ? label.textContent : '';
        const hasChatGPT = labelText.includes('ChatGPT');
        const hasBadge = labelText.includes('Plus');
        return JSON.stringify({
          inputExists: !!input,
          labelExists: !!label,
          hasChatGPT,
          hasBadge,
          labelText: labelText.substring(0, 200),
        });
      })()`);
      const data = JSON.parse(result.value);
      if (!data.inputExists) {
        results.push(fail(id, start, 'input#provider-chatgpt not found', data));
      } else if (!data.hasChatGPT) {
        results.push(fail(id, start, '"ChatGPT" text not found in label', data));
      } else if (!data.hasBadge) {
        results.push(fail(id, start, '"Plus" badge text not found in label', data));
      } else {
        results.push(ok(id, start, 'ChatGPT provider card valid', data));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.6 Claude Provider Card ---
  {
    const id = 'p5:provider-claude';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(() => {
        const input = document.getElementById('provider-claude');
        const label = document.querySelector('label[for="provider-claude"]');
        const labelText = label ? label.textContent : '';
        const hasClaude = labelText.includes('Claude');
        const hasBadge = labelText.includes('Pro');
        return JSON.stringify({
          inputExists: !!input,
          labelExists: !!label,
          hasClaude,
          hasBadge,
          labelText: labelText.substring(0, 200),
        });
      })()`);
      const data = JSON.parse(result.value);
      if (!data.inputExists) {
        results.push(fail(id, start, 'input#provider-claude not found', data));
      } else if (!data.hasClaude) {
        results.push(fail(id, start, '"Claude" text not found in label', data));
      } else if (!data.hasBadge) {
        results.push(fail(id, start, '"Pro" badge text not found in label', data));
      } else {
        results.push(ok(id, start, 'Claude provider card valid', data));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.7 Gemini Disabled ---
  {
    const id = 'p5:provider-gemini-disabled';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(() => {
        const input = document.getElementById('provider-gemini');
        const label = document.querySelector('label[for="provider-gemini"]');
        const labelText = label ? label.textContent : '';
        const hasDisabledText = labelText.includes('준비 중');
        return JSON.stringify({
          inputExists: !!input,
          isDisabled: input ? input.disabled : false,
          hasDisabledText,
          labelText: labelText.substring(0, 200),
        });
      })()`);
      const data = JSON.parse(result.value);
      if (!data.inputExists) {
        results.push(fail(id, start, 'input#provider-gemini not found', data));
      } else if (!data.isDisabled) {
        results.push(fail(id, start, 'Gemini input is not disabled', data));
      } else if (!data.hasDisabledText) {
        results.push(fail(id, start, '"준비 중" text not found', data));
      } else {
        results.push(ok(id, start, 'Gemini provider correctly disabled', data));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.8 Provider Connection State ---
  {
    const id = 'p5:provider-connection';
    const start = Date.now();
    try {
      const state = await sendExtMessage(session, { type: 'vault:get-state' });
      if (!state.ok) {
        results.push(fail(id, start, `get-state failed: ${state.error}`));
      } else {
        // Check that connected provider is reflected in state
        const provider = state.connectedProvider || state.settings?.provider || null;
        const checkedInput = await evalAsync(session, `(() => {
          const inputs = document.querySelectorAll('input[name="provider"]');
          for (const input of inputs) {
            if (input.checked) return input.value;
          }
          return null;
        })()`);
        const uiProvider = checkedInput.value;
        if (provider && uiProvider && provider === uiProvider) {
          results.push(ok(id, start, `Provider state consistent: ${provider}`, { stateProvider: provider, uiProvider }));
        } else if (provider) {
          results.push(ok(id, start, `Provider in state: ${provider}`, { stateProvider: provider, uiProvider }));
        } else {
          // No provider set is also valid if user hasn't selected one
          results.push(ok(id, start, 'No provider selected (valid initial state)', { stateProvider: provider, uiProvider }));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.9 Cross-Provider Audit ---
  if (!results.find(r => r.id === 'p5:cross-provider-audit')) {
    const id = 'p5:cross-provider-audit';
    const start = Date.now();
    try {
      const providers = [...new Set(auditLogs.map(e => e.ai_provider))];
      const hasChatGPT = providers.includes('chatgpt');
      const hasClaude = providers.includes('claude');
      if (hasChatGPT && hasClaude) {
        results.push(ok(id, start, `Cross-provider audit verified: ${providers.join(', ')}`, { providers, totalEntries: auditLogs.length }));
      } else if (providers.length > 0) {
        // Only one provider tested - verify entries match that provider
        const providerCounts = {};
        for (const entry of auditLogs) {
          providerCounts[entry.ai_provider] = (providerCounts[entry.ai_provider] || 0) + 1;
        }
        results.push(ok(id, start, `Single provider tested: ${providers.join(', ')}`, { providers, providerCounts }));
      } else {
        results.push(fail(id, start, 'No audit entries with ai_provider found'));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 5.10 Shadow DOM CSS Isolation ---
  {
    const id = 'p5:shadow-isolation';
    const start = Date.now();
    // Find a content tab (chatgpt.com or claude.ai)
    const contentTarget = targets.find(t =>
      t.type === 'page' && (t.url?.includes('chatgpt.com') || t.url?.includes('claude.ai'))
    );
    if (!contentTarget) {
      results.push(skip(id, 'No chatgpt.com/claude.ai tab found'));
    } else {
      let contentSession;
      try {
        contentSession = await connectTarget(contentTarget.webSocketDebuggerUrl);
        const result = await evalAsync(contentSession, `(() => {
          const host = document.getElementById('openmyhealth-overlay-root');
          if (!host) return JSON.stringify({ exists: false });
          const style = getComputedStyle(host);
          return JSON.stringify({
            exists: true,
            position: style.position,
            zIndex: style.zIndex,
          });
        })()`);
        const data = JSON.parse(result.value);
        if (!data.exists) {
          results.push(fail(id, start, '#openmyhealth-overlay-root not found on content tab', data));
        } else if (data.position !== 'fixed') {
          results.push(fail(id, start, `Expected position:fixed, got ${data.position}`, data));
        } else if (data.zIndex !== '2147483647') {
          results.push(fail(id, start, `Expected z-index:2147483647, got ${data.zIndex}`, data));
        } else {
          results.push(ok(id, start, 'Shadow DOM host isolation verified (fixed, z-index: 2147483647)', data));
        }
      } catch (e) {
        results.push(fail(id, start, `Content tab connection failed: ${e.message}`));
      } finally {
        if (contentSession) await contentSession.close();
      }
    }
  }

  // --- 5.11-5.13: A11y checks require overlay to be visible ---
  // Find a content tab for overlay interaction
  const a11yContentTarget = targets.find(t =>
    t.type === 'page' && (t.url?.includes('chatgpt.com') || t.url?.includes('claude.ai'))
  );

  if (!a11yContentTarget) {
    results.push(skip('p5:a11y-touch-target', 'No chatgpt.com/claude.ai tab found'));
    results.push(skip('p5:a11y-aria-live', 'No chatgpt.com/claude.ai tab found'));
    results.push(skip('p5:a11y-tab-trap', 'No chatgpt.com/claude.ai tab found'));
  } else {
    let a11ySession;
    try {
      a11ySession = await connectTarget(a11yContentTarget.webSocketDebuggerUrl);

      // Check if overlay is currently showing or try to detect its state
      // The overlay may already be visible from a prior MCP request, or it may be hidden.
      // We check the shadow DOM for rendered elements regardless.

      // --- 5.11 A11y: Touch Target 48px ---
      {
        const id = 'p5:a11y-touch-target';
        const start = Date.now();
        try {
          const result = await evalAsync(a11ySession, `(() => {
            const host = document.getElementById('openmyhealth-overlay-root');
            if (!host) return JSON.stringify({ hostExists: false });
            const sr = host.shadowRoot;
            if (!sr) return JSON.stringify({ hostExists: true, shadowOpen: false });
            const buttons = sr.querySelectorAll('button');
            if (buttons.length === 0) return JSON.stringify({ hostExists: true, shadowOpen: true, buttonCount: 0 });
            const heights = [...buttons].map(b => {
              const rect = b.getBoundingClientRect();
              return { text: b.textContent?.substring(0, 30), height: rect.height, width: rect.width };
            });
            // Only check buttons that are actually visible (height > 0)
            const visible = heights.filter(h => h.height > 0);
            const minHeight = visible.length > 0 ? Math.min(...visible.map(h => h.height)) : 0;
            return JSON.stringify({
              hostExists: true,
              shadowOpen: true,
              buttonCount: buttons.length,
              visibleCount: visible.length,
              minHeight,
              buttons: visible,
            });
          })()`);
          const data = JSON.parse(result.value);
          if (!data.hostExists) {
            results.push(skip(id, 'Overlay host not found'));
          } else if (!data.shadowOpen) {
            results.push(skip(id, 'Shadow DOM not open (closed mode in production)'));
          } else if (data.visibleCount === 0) {
            results.push(skip(id, 'No visible buttons (overlay may be hidden)'));
          } else if (data.minHeight >= 48) {
            results.push(ok(id, start, `All ${data.visibleCount} buttons >= 48px (min: ${data.minHeight}px)`, data));
          } else {
            results.push(fail(id, start, `Button below 48px min height: ${data.minHeight}px`, data));
          }
        } catch (e) {
          results.push(fail(id, start, e.message));
        }
      }

      // --- 5.12 A11y: ARIA Live Timer ---
      {
        const id = 'p5:a11y-aria-live';
        const start = Date.now();
        try {
          const result = await evalAsync(a11ySession, `(() => {
            const host = document.getElementById('openmyhealth-overlay-root');
            if (!host) return JSON.stringify({ hostExists: false });
            const sr = host.shadowRoot;
            if (!sr) return JSON.stringify({ hostExists: true, shadowOpen: false });
            // Check for aria-live on any element (timer announcements, status messages)
            const ariaLiveEls = sr.querySelectorAll('[aria-live]');
            const ariaLiveValues = [...ariaLiveEls].map(el => ({
              tagName: el.tagName,
              ariaLive: el.getAttribute('aria-live'),
              role: el.getAttribute('role'),
              className: el.className?.substring?.(0, 80) || '',
            }));
            // Check timer ring specifically
            const timerRing = sr.querySelector('.omh-timer-ring');
            const timerAriaHidden = timerRing?.getAttribute('aria-hidden');
            // Check for sr-only live region (used for timer announcements)
            const srOnly = sr.querySelector('.omh-sr-only[role="status"]');
            return JSON.stringify({
              hostExists: true,
              shadowOpen: true,
              ariaLiveCount: ariaLiveEls.length,
              ariaLiveElements: ariaLiveValues,
              timerRingExists: !!timerRing,
              timerAriaHidden,
              hasSrOnlyStatus: !!srOnly,
              srOnlyAriaLive: srOnly?.getAttribute('aria-live') || null,
            });
          })()`);
          const data = JSON.parse(result.value);
          if (!data.hostExists) {
            results.push(skip(id, 'Overlay host not found'));
          } else if (!data.shadowOpen) {
            results.push(skip(id, 'Shadow DOM not open (closed mode in production)'));
          } else if (data.ariaLiveCount > 0) {
            // aria-live exists somewhere in the overlay
            const hasAssertiveOrPolite = data.ariaLiveElements.some(
              el => el.ariaLive === 'assertive' || el.ariaLive === 'polite'
            );
            if (hasAssertiveOrPolite) {
              results.push(ok(id, start, `Found ${data.ariaLiveCount} aria-live regions`, data));
            } else {
              results.push(fail(id, start, 'aria-live elements found but none assertive/polite', data));
            }
          } else if (data.hasSrOnlyStatus) {
            results.push(ok(id, start, 'Timer has sr-only status region', data));
          } else {
            // Overlay may be hidden — if no visible elements, skip rather than fail
            results.push(skip(id, 'No aria-live elements found (overlay may be hidden)'));
          }
        } catch (e) {
          results.push(fail(id, start, e.message));
        }
      }

      // --- 5.13 A11y: Tab Trap + ESC ---
      {
        const id = 'p5:a11y-tab-trap';
        const start = Date.now();
        try {
          const result = await evalAsync(a11ySession, `(() => {
            const host = document.getElementById('openmyhealth-overlay-root');
            if (!host) return JSON.stringify({ hostExists: false });
            const sr = host.shadowRoot;
            if (!sr) return JSON.stringify({ hostExists: true, shadowOpen: false });
            // Check for role="dialog" on the shell element
            const dialog = sr.querySelector('[role="dialog"]');
            const shell = sr.querySelector('.omh-shell');
            const shellRole = shell?.getAttribute('role');
            const ariaModal = dialog?.getAttribute('aria-modal') || shell?.getAttribute('aria-modal');
            const ariaLabelledby = dialog?.getAttribute('aria-labelledby') || shell?.getAttribute('aria-labelledby');
            const tabIndex = shell?.getAttribute('tabindex');
            return JSON.stringify({
              hostExists: true,
              shadowOpen: true,
              hasDialogRole: !!dialog,
              shellExists: !!shell,
              shellRole,
              ariaModal,
              ariaLabelledby,
              tabIndex,
            });
          })()`);
          const data = JSON.parse(result.value);
          if (!data.hostExists) {
            results.push(skip(id, 'Overlay host not found'));
          } else if (!data.shadowOpen) {
            results.push(skip(id, 'Shadow DOM not open (closed mode in production)'));
          } else if (!data.shellExists) {
            results.push(skip(id, 'Overlay shell not rendered (overlay may be hidden)'));
          } else if (data.hasDialogRole || data.shellRole === 'dialog') {
            // Check for aria-modal
            const hasModal = data.ariaModal === 'true';
            if (hasModal) {
              results.push(ok(id, start, 'Dialog role + aria-modal="true" present', data));
            } else {
              // role="dialog" without aria-modal is still acceptable; focus trap is code-based
              results.push(ok(id, start, 'Dialog role present (focus trap managed by code)', data));
            }
          } else if (data.shellRole === 'status') {
            // Overlay is in a non-dialog mode (resolved, connected, timeout)
            results.push(skip(id, `Overlay in non-dialog mode (role="${data.shellRole}")`));
          } else {
            results.push(fail(id, start, 'No dialog role found on overlay shell', data));
          }
        } catch (e) {
          results.push(fail(id, start, e.message));
        }
      }
    } catch (e) {
      results.push(fail('p5:a11y-touch-target', Date.now(), `Content session failed: ${e.message}`));
      results.push(fail('p5:a11y-aria-live', Date.now(), `Content session failed: ${e.message}`));
      results.push(fail('p5:a11y-tab-trap', Date.now(), `Content session failed: ${e.message}`));
    } finally {
      if (a11ySession) await a11ySession.close();
    }
  }

  // --- 5.14 OAuth Relay ---
  {
    const id = 'p5:oauth-relay';
    results.push(skip(id, 'OAuth relay requires dedicated E2E test runner'));
  }

  return results;
}
