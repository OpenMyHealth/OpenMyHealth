import { connectTarget } from '../cdp-client.mjs';

export async function runContentScriptChecks(session, targets) {
  const results = [];

  // Find a tab with chatgpt.com or claude.ai
  const contentTarget = targets.find(t =>
    t.type === 'page' && (t.url?.includes('chatgpt.com') || t.url?.includes('claude.ai'))
  );

  if (!contentTarget) {
    const skipMsg = 'chatgpt.com/claude.ai 탭 없음';
    return [
      { id: 'content:shadow-dom-host', status: 'skip', duration: 0, message: skipMsg },
      { id: 'content:shadow-dom-structure', status: 'skip', duration: 0, message: skipMsg },
      { id: 'content:no-console-errors', status: 'skip', duration: 0, message: skipMsg }
    ];
  }

  let contentSession;
  try {
    contentSession = await connectTarget(contentTarget.webSocketDebuggerUrl);
  } catch (e) {
    const failMsg = `Failed to connect: ${e.message}`;
    return [
      { id: 'content:shadow-dom-host', status: 'fail', duration: 0, message: failMsg },
      { id: 'content:shadow-dom-structure', status: 'fail', duration: 0, message: failMsg },
      { id: 'content:no-console-errors', status: 'fail', duration: 0, message: failMsg }
    ];
  }

  try {
    // Check 1: Shadow DOM host element exists with correct styles
    let start = Date.now();
    try {
      const { result } = await contentSession.send('Runtime.evaluate', {
        expression: `(() => {
          const host = document.querySelector('#openmyhealth-overlay-root');
          if (!host) return JSON.stringify({ exists: false });
          const style = getComputedStyle(host);
          return JSON.stringify({
            exists: true,
            position: style.position,
            zIndex: style.zIndex
          });
        })()`,
        returnByValue: true
      });
      const data = JSON.parse(result.value);
      if (!data.exists) {
        results.push({ id: 'content:shadow-dom-host', status: 'fail', duration: Date.now() - start,
          message: '#openmyhealth-overlay-root not found' });
      } else if (data.position !== 'fixed' || data.zIndex !== '2147483647') {
        results.push({ id: 'content:shadow-dom-host', status: 'fail', duration: Date.now() - start,
          message: `Style mismatch: position=${data.position}, z-index=${data.zIndex}`, details: data });
      } else {
        results.push({ id: 'content:shadow-dom-host', status: 'pass', duration: Date.now() - start,
          message: 'Host element valid (fixed, z-index: 2147483647)' });
      }
    } catch (e) {
      results.push({ id: 'content:shadow-dom-host', status: 'fail', duration: Date.now() - start, message: e.message });
    }

    // Check 2: Shadow DOM internal structure using DOM.getDocument with pierce
    start = Date.now();
    try {
      await contentSession.send('DOM.enable');
      const { root } = await contentSession.send('DOM.getDocument', { depth: -1, pierce: true });
      const found = findNodeById(root, 'openmyhealth-overlay-root');
      if (found && found.shadowRoots && found.shadowRoots.length > 0) {
        const shadowChildren = found.shadowRoots[0].children || [];
        results.push({ id: 'content:shadow-dom-structure', status: 'pass', duration: Date.now() - start,
          message: `Shadow DOM found with ${shadowChildren.length} child nodes` });
      } else if (found) {
        results.push({ id: 'content:shadow-dom-structure', status: 'fail', duration: Date.now() - start,
          message: 'Host found but no Shadow DOM attached' });
      } else {
        results.push({ id: 'content:shadow-dom-structure', status: 'fail', duration: Date.now() - start,
          message: 'Could not find #openmyhealth-overlay-root in DOM tree' });
      }
      await contentSession.send('DOM.disable');
    } catch (e) {
      results.push({ id: 'content:shadow-dom-structure', status: 'fail', duration: Date.now() - start, message: e.message });
    }

    // Check 3: Console errors (OMH-related only)
    start = Date.now();
    const errors = [];
    const logHandler = (params) => {
      if (params.entry.level === 'error') {
        const text = params.entry.text || '';
        if (/openmyhealth|OMH|omh/i.test(text)) {
          errors.push(text);
        }
      }
    };
    contentSession.on('Log.entryAdded', logHandler);
    await contentSession.send('Log.enable');
    await new Promise(r => setTimeout(r, 2000));
    await contentSession.send('Log.disable');
    contentSession.off('Log.entryAdded', logHandler);

    if (errors.length === 0) {
      results.push({ id: 'content:no-console-errors', status: 'pass', duration: Date.now() - start,
        message: 'No OMH-related console errors' });
    } else {
      results.push({ id: 'content:no-console-errors', status: 'fail', duration: Date.now() - start,
        message: `${errors.length} OMH-related error(s)`, details: errors });
    }
  } finally {
    await contentSession.close();
  }

  return results;
}

/** Recursively find a node by its "id" attribute in the DOM tree. */
function findNodeById(node, id) {
  if (node.attributes) {
    const idIndex = node.attributes.indexOf('id');
    if (idIndex !== -1 && node.attributes[idIndex + 1] === id) return node;
  }
  for (const child of (node.children || [])) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  for (const shadow of (node.shadowRoots || [])) {
    const found = findNodeById(shadow, id);
    if (found) return found;
  }
  return null;
}
