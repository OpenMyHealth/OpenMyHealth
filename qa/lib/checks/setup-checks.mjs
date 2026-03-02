import { checkPageLoad, checkBootState, checkCssVariables, checkDomElement, checkDomElements, createLogCollector } from './page-health.mjs';
import { captureScreenshot } from '../screenshot.mjs';
import { join } from 'node:path';

export async function runSetupChecks(session, extensionId, runDir) {
  const url = `chrome-extension://${extensionId}/setup.html`;
  const results = [];

  // 1. Page load (navigates to the page)
  results.push(await checkPageLoad(session, url, 'setup'));
  // If page didn't load, skip remaining checks
  if (results[0].status === 'fail') {
    const skip = (id) => ({ id, status: 'skip', duration: 0, message: 'Page load failed' });
    return [...results, skip('setup:boot-state'), skip('setup:no-console-errors'),
      skip('setup:css-variables'), skip('setup:dom-root'), skip('setup:dom-elements'), skip('setup:screenshot')];
  }

  // Start collecting logs early (before boot state polling)
  const logCollector = createLogCollector(session);
  await logCollector.start();

  // 2. Boot state (polls until mounted)
  results.push(await checkBootState(session, '__OMH_SETUP_BOOT_STATE__', 'setup'));

  // 3. Console errors — wait 1s after boot then collect
  const consoleStart = Date.now();
  await new Promise(r => setTimeout(r, 1000));
  await logCollector.stop();
  const errors = logCollector.getErrors();
  if (errors.length === 0) {
    results.push({ id: 'setup:no-console-errors', status: 'pass', duration: Date.now() - consoleStart, message: 'No console errors' });
  } else {
    results.push({ id: 'setup:no-console-errors', status: 'fail', duration: Date.now() - consoleStart,
      message: `${errors.length} error(s) found`, details: errors });
  }

  // 4. CSS variables
  results.push(await checkCssVariables(session, 'setup'));
  // 5. DOM root
  results.push(await checkDomElement(session, '#root', 'setup', 'setup:dom-root'));
  // 6. DOM elements
  results.push(await checkDomElements(session, ['h1', 'main', 'section'], 'setup'));
  // 7. Screenshot
  const start = Date.now();
  try {
    const screenshotPath = join(runDir, 'screenshots', 'setup.png');
    await captureScreenshot(session, screenshotPath);
    results.push({ id: 'setup:screenshot', status: 'pass', duration: Date.now() - start, message: 'Screenshot captured' });
  } catch (e) {
    results.push({ id: 'setup:screenshot', status: 'fail', duration: Date.now() - start, message: e.message });
  }

  return results;
}
