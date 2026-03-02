import { checkPageLoad, checkBootState, checkCssVariables, checkDomElement, checkDomElements, createLogCollector } from './page-health.mjs';
import { captureScreenshot } from '../screenshot.mjs';
import { join } from 'node:path';

export async function runVaultChecks(session, extensionId, runDir) {
  const url = `chrome-extension://${extensionId}/vault.html`;
  const results = [];

  results.push(await checkPageLoad(session, url, 'vault'));
  if (results[0].status === 'fail') {
    const skip = (id) => ({ id, status: 'skip', duration: 0, message: 'Page load failed' });
    return [...results, skip('vault:boot-state'), skip('vault:no-console-errors'),
      skip('vault:css-variables'), skip('vault:dom-root'), skip('vault:dom-elements'), skip('vault:screenshot')];
  }

  // Start collecting logs early
  const logCollector = createLogCollector(session);
  await logCollector.start();

  results.push(await checkBootState(session, '__OMH_VAULT_BOOT_STATE__', 'vault'));

  // Console errors — wait 1s after boot then collect
  const consoleStart = Date.now();
  await new Promise(r => setTimeout(r, 1000));
  await logCollector.stop();
  const errors = logCollector.getErrors();
  if (errors.length === 0) {
    results.push({ id: 'vault:no-console-errors', status: 'pass', duration: Date.now() - consoleStart, message: 'No console errors' });
  } else {
    results.push({ id: 'vault:no-console-errors', status: 'fail', duration: Date.now() - consoleStart,
      message: `${errors.length} error(s) found`, details: errors });
  }

  results.push(await checkCssVariables(session, 'vault'));
  results.push(await checkDomElement(session, '#root', 'vault', 'vault:dom-root'));
  results.push(await checkDomElements(session, ['h1', 'main', 'section'], 'vault'));

  const start = Date.now();
  try {
    const screenshotPath = join(runDir, 'screenshots', 'vault.png');
    await captureScreenshot(session, screenshotPath);
    results.push({ id: 'vault:screenshot', status: 'pass', duration: Date.now() - start, message: 'Screenshot captured' });
  } catch (e) {
    results.push({ id: 'vault:screenshot', status: 'fail', duration: Date.now() - start, message: e.message });
  }

  return results;
}
