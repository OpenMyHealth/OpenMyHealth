/**
 * Shared MCP test prerequisites: vault unlock + provider connection.
 *
 * Before MCP requests can be processed, the vault must be unlocked
 * and a provider (chatgpt/claude) must be connected in settings.
 *
 * This module provides helpers to set up these prerequisites
 * via a temporary vault tab.
 */
import { connectTarget, discoverBrowserWsUrl } from './cdp-client.mjs';

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Ensure vault is unlocked and provider is connected.
 *
 * Opens vault.html in a temporary tab, unlocks with PIN 123456,
 * sets the connected provider, then closes the tab.
 *
 * @param {number} port - CDP port (default 9222)
 * @param {string} extensionId - Extension ID
 * @param {string} provider - 'chatgpt' or 'claude' (default 'chatgpt')
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function ensureMcpPrerequisites(port, extensionId, provider = 'chatgpt') {
  const browserWsUrl = await discoverBrowserWsUrl(port);
  const browserSession = await connectTarget(browserWsUrl);

  let session;
  let targetId;
  try {
    // Create temp tab
    const result = await browserSession.send('Target.createTarget', { url: 'about:blank' });
    targetId = result.targetId;
    const pageWsUrl = `ws://localhost:${port}/devtools/page/${targetId}`;
    session = await connectTarget(pageWsUrl);

    // Navigate to vault
    await session.send('Page.enable');
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Vault page load timeout')), 15000);
      session.once('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
    });
    const vaultUrl = `chrome-extension://${extensionId}/vault.html`;
    await session.send('Page.navigate', { url: vaultUrl });
    await loadPromise;
    await sleep(1000); // Wait for React mount

    // Try unlocking
    const unlockResp = await sendExtMessage(session, { type: 'session:unlock', pin: '123456' });
    if (!unlockResp.isUnlocked) {
      // Maybe lockout active — wait if reasonable
      if (unlockResp.lockoutUntil) {
        const waitMs = unlockResp.lockoutUntil - Date.now();
        if (waitMs > 0 && waitMs <= 70000) {
          await sleep(waitMs + 500);
          const retry = await sendExtMessage(session, { type: 'session:unlock', pin: '123456' });
          if (!retry.isUnlocked) {
            return { ok: false, error: `Unlock failed after lockout wait: ${JSON.stringify(retry)}` };
          }
        } else if (waitMs > 70000) {
          return { ok: false, error: `Lockout too long: ${Math.round(waitMs / 1000)}s remaining` };
        }
      } else {
        return { ok: false, error: `Unlock failed: ${JSON.stringify(unlockResp)}` };
      }
    }

    // Clear always-allow rules from previous test runs
    try {
      const permResp = await sendExtMessage(session, { type: 'vault:list-permissions' });
      if (permResp.ok && permResp.permissions?.length > 0) {
        for (const perm of permResp.permissions) {
          await sendExtMessage(session, { type: 'vault:revoke-permission', key: perm.key });
        }
      }
    } catch { /* ignore */ }

    // Set provider
    const setProviderResp = await sendExtMessage(session, {
      type: 'vault:set-provider',
      provider,
    });
    if (!setProviderResp.ok) {
      return { ok: false, error: `Set provider failed: ${setProviderResp.error || JSON.stringify(setProviderResp)}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { if (session) await session.close(); } catch { /* */ }
    try { if (targetId) await browserSession.send('Target.closeTarget', { targetId }); } catch { /* */ }
    try { await browserSession.close(); } catch { /* */ }
  }
}
