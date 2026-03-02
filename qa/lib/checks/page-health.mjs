/**
 * Common page health check functions reused by setup and vault checks.
 * Every function returns { id, status, duration, message, details? }.
 */

/**
 * Check page loads within 15 seconds.
 * @param {CDPSession} session
 * @param {string} url - Full chrome-extension:// URL
 * @param {string} pageLabel - 'setup' or 'vault'
 */
export async function checkPageLoad(session, url, pageLabel) {
  const start = Date.now();
  try {
    await session.send('Page.enable');
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout (15s)')), 15000);
      session.once('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
    });
    await session.send('Page.navigate', { url });
    await loadPromise;
    return { id: `${pageLabel}:page-load`, status: 'pass', duration: Date.now() - start, message: 'Page loaded' };
  } catch (e) {
    return { id: `${pageLabel}:page-load`, status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * Check boot state variable exists and appMounted is true.
 */
export async function checkBootState(session, globalVarName, pageLabel) {
  const start = Date.now();
  const POLL_INTERVAL = 200;
  const TIMEOUT = 5000;
  try {
    while (Date.now() - start < TIMEOUT) {
      const { result } = await session.send('Runtime.evaluate', {
        expression: `(() => { const s = window['${globalVarName}']; return s ? JSON.stringify(s) : null; })()`,
        returnByValue: true
      });
      if (result.value) {
        const state = JSON.parse(result.value);
        if (state.appMounted === true) {
          const waited = Date.now() - start;
          return { id: `${pageLabel}:boot-state`, status: 'pass', duration: waited,
            message: `App mounted (${waited}ms)` };
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    return { id: `${pageLabel}:boot-state`, status: 'fail', duration: Date.now() - start,
      message: `${globalVarName} appMounted not true after ${TIMEOUT}ms` };
  } catch (e) {
    return { id: `${pageLabel}:boot-state`, status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * Check for console errors (collect for 2 seconds).
 */
export async function checkConsoleErrors(session, pageLabel) {
  const start = Date.now();
  const errors = [];
  try {
    session.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') {
        errors.push(params.entry.text);
      }
    });
    await session.send('Log.enable');
    await new Promise(r => setTimeout(r, 2000));
    await session.send('Log.disable');

    if (errors.length === 0) {
      return { id: `${pageLabel}:no-console-errors`, status: 'pass', duration: Date.now() - start, message: 'No console errors' };
    }
    return { id: `${pageLabel}:no-console-errors`, status: 'fail', duration: Date.now() - start,
      message: `${errors.length} error(s) found`, details: errors };
  } catch (e) {
    return { id: `${pageLabel}:no-console-errors`, status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/** Patterns for console errors that are expected dev-mode noise (not real bugs). */
const DEV_NOISE_PATTERNS = [
  /Content Security Policy.*localhost/i,        // WXT HMR WebSocket CSP violations
  /ws:\/\/localhost.*Content Security Policy/i,  // reverse match order
];

function isDevNoise(text) {
  return DEV_NOISE_PATTERNS.some(re => re.test(text));
}

/**
 * Create an early log collector that captures console errors from the start.
 * Call start() before page actions, stop() after checks complete.
 * Dev-mode noise (e.g. WXT HMR CSP violations) is automatically filtered out.
 */
export function createLogCollector(session) {
  const errors = [];
  const handler = (params) => {
    if (params.entry.level === 'error') {
      const text = params.entry.text || '';
      if (!isDevNoise(text)) {
        errors.push(text);
      }
    }
  };
  return {
    async start() {
      session.on('Log.entryAdded', handler);
      await session.send('Log.enable');
    },
    async stop() {
      await session.send('Log.disable');
      session.off('Log.entryAdded', handler);
    },
    getErrors() {
      return [...errors];
    }
  };
}

/**
 * Check 32 CSS variables are all non-empty.
 */
export async function checkCssVariables(session, pageLabel) {
  const CSS_VARS = [
    '--background', '--foreground', '--card', '--card-foreground',
    '--popover', '--popover-foreground', '--primary', '--primary-foreground',
    '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
    '--border', '--input', '--ring', '--radius',
    '--success', '--success-foreground', '--warning', '--warning-foreground',
    '--info', '--info-foreground',
    '--provider-chatgpt', '--provider-chatgpt-soft',
    '--provider-claude', '--provider-claude-soft',
    '--provider-disabled', '--provider-disabled-soft'
  ];

  const start = Date.now();
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `(() => {
        const style = getComputedStyle(document.documentElement);
        const vars = ${JSON.stringify(CSS_VARS)};
        const missing = [];
        const found = [];
        vars.forEach(v => {
          const val = style.getPropertyValue(v).trim();
          if (val) found.push(v); else missing.push(v);
        });
        return JSON.stringify({ found: found.length, total: vars.length, missing });
      })()`,
      returnByValue: true
    });
    const data = JSON.parse(result.value);
    if (data.missing.length === 0) {
      return { id: `${pageLabel}:css-variables`, status: 'pass', duration: Date.now() - start,
        message: `${data.found}/${data.total} variables defined` };
    }
    return { id: `${pageLabel}:css-variables`, status: 'fail', duration: Date.now() - start,
      message: `${data.missing.length} missing: ${data.missing.join(', ')}`, details: data };
  } catch (e) {
    return { id: `${pageLabel}:css-variables`, status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * Check a single DOM element exists.
 */
export async function checkDomElement(session, selector, pageLabel, checkId) {
  const start = Date.now();
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `!!document.querySelector('${selector}')`,
      returnByValue: true
    });
    if (result.value) {
      return { id: checkId, status: 'pass', duration: Date.now() - start, message: `${selector} found` };
    }
    return { id: checkId, status: 'fail', duration: Date.now() - start, message: `${selector} not found` };
  } catch (e) {
    return { id: checkId, status: 'fail', duration: Date.now() - start, message: e.message };
  }
}

/**
 * Check multiple DOM elements and merge into a single result.
 */
export async function checkDomElements(session, selectors, pageLabel) {
  const results = [];
  for (const sel of selectors) {
    results.push(await checkDomElement(session, sel, pageLabel, `${pageLabel}:dom-elements`));
  }
  const failed = results.filter(r => r.status === 'fail');
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  if (failed.length === 0) {
    return { id: `${pageLabel}:dom-elements`, status: 'pass', duration: totalDuration,
      message: `All ${selectors.length} elements found (${selectors.join(', ')})` };
  }
  const missingSelectors = failed.map(r => r.message.replace(' not found', ''));
  return { id: `${pageLabel}:dom-elements`, status: 'fail', duration: totalDuration,
    message: `Missing: ${missingSelectors.join(', ')}`, details: failed };
}
