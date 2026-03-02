#!/usr/bin/env node
import { discoverTargets, connectTarget } from './lib/cdp-client.mjs';
import { ensureMcpPrerequisites } from './lib/mcp-setup.mjs';

// Find extension ID
const targets = await discoverTargets(9222);
const extTarget = targets.find(t => t.url && t.url.includes('chrome-extension://'));
const extId = extTarget?.url?.match(/chrome-extension:\/\/([^/]+)/)?.[1];

// Setup provider first
if (extId) {
  console.log('Setting up provider...');
  await ensureMcpPrerequisites(9222, extId, 'chatgpt');
}

const chatgpt = targets.find(t => t.url && t.url.includes('chatgpt.com'));
if (!chatgpt) { console.log('No chatgpt.com tab'); process.exit(1); }

const s = await connectTarget(chatgpt.webSocketDebuggerUrl);

// Send an MCP request to trigger the overlay
console.log('Sending MCP request...');
await s.send('Runtime.evaluate', {
  expression: `(() => {
    window.__omhQaResponse = null;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { window.__omhQaResponse = e.data; };
    window.postMessage({
      source: 'openmyhealth-page',
      type: 'openmyhealth:mcp:read-health-records',
      requestId: 'debug-' + Date.now(),
      payload: { resource_types: ['Observation'], depth: 'summary' }
    }, window.location.origin, [ch.port2]);
  })()`,
  returnByValue: true,
});

// Wait for overlay to render
await new Promise(r => setTimeout(r, 2000));

// Check response first
const { result: respCheck } = await s.send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__omhQaResponse)',
  returnByValue: true,
});
console.log('Response so far:', respCheck.value);

// Now try DOM approaches
console.log('\n--- DOM Domain Approach ---');
await s.send('DOM.enable');

// Approach 1: DOM.performSearch
console.log('\nApproach 1: DOM.performSearch');
try {
  const search = await s.send('DOM.performSearch', { query: '.omh-shell', includeUserAgentShadowDOM: true });
  console.log('  Search results:', search.resultCount);
  if (search.resultCount > 0) {
    const { nodeIds } = await s.send('DOM.getSearchResults', { searchId: search.searchId, fromIndex: 0, toIndex: search.resultCount });
    console.log('  Found nodeIds:', nodeIds);
    for (const nid of nodeIds) {
      const { object } = await s.send('DOM.resolveNode', { nodeId: nid });
      const { result } = await s.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function() { return "tag=" + this.tagName + " class=" + this.className + " text=" + this.textContent.substring(0,100); }',
        returnByValue: true,
      });
      console.log('  Node:', result.value);
    }
  }
  await s.send('DOM.discardSearchResults', { searchId: search.searchId });
} catch (e) {
  console.log('  Error:', e.message);
}

// Approach 2: Search for buttons
console.log('\nApproach 2: Search for buttons in shadow');
try {
  const search = await s.send('DOM.performSearch', { query: '.omh-primary', includeUserAgentShadowDOM: true });
  console.log('  .omh-primary results:', search.resultCount);
  await s.send('DOM.discardSearchResults', { searchId: search.searchId });

  const search2 = await s.send('DOM.performSearch', { query: '.omh-secondary', includeUserAgentShadowDOM: true });
  console.log('  .omh-secondary results:', search2.resultCount);
  await s.send('DOM.discardSearchResults', { searchId: search2.searchId });

  const search3 = await s.send('DOM.performSearch', { query: '.omh-close', includeUserAgentShadowDOM: true });
  console.log('  .omh-close results:', search3.resultCount);
  await s.send('DOM.discardSearchResults', { searchId: search3.searchId });

  const search4 = await s.send('DOM.performSearch', { query: '.omh-actions', includeUserAgentShadowDOM: true });
  console.log('  .omh-actions results:', search4.resultCount);
  await s.send('DOM.discardSearchResults', { searchId: search4.searchId });
} catch (e) {
  console.log('  Error:', e.message);
}

// Approach 3: Get full document with pierce and walk to shadow root
console.log('\nApproach 3: getDocument with pierce');
try {
  const { root } = await s.send('DOM.getDocument', { depth: -1, pierce: true });
  // Find overlay host in tree
  function findNode(node, id) {
    if (node.attributes) {
      const idx = node.attributes.indexOf('id');
      if (idx >= 0 && node.attributes[idx + 1] === id) return node;
    }
    for (const child of (node.children || [])) {
      const found = findNode(child, id);
      if (found) return found;
    }
    for (const sr of (node.shadowRoots || [])) {
      const found = findNode(sr, id);
      if (found) return found;
    }
    return null;
  }

  const host = findNode(root, 'openmyhealth-overlay-root');
  if (host) {
    console.log('  Found host! shadowRoots:', host.shadowRoots?.length);
    const sr = host.shadowRoots?.[0];
    if (sr) {
      console.log('  SR nodeId:', sr.nodeId, 'childCount:', sr.childNodeCount);
      // Try querySelector on this SR nodeId
      const { nodeId: testShellId } = await s.send('DOM.querySelector', { nodeId: sr.nodeId, selector: '.omh-shell' });
      console.log('  querySelector .omh-shell on SR:', testShellId);

      // Dump children
      function dumpTree(node, indent = '') {
        const name = node.nodeName || node.localName || '#text';
        const cls = node.attributes ? (() => { const i = node.attributes.indexOf('class'); return i >= 0 ? node.attributes[i+1] : ''; })() : '';
        if (cls || name !== '#text') {
          console.log(`${indent}${name}${cls ? '.' + cls.split(' ').join('.') : ''} [nodeId=${node.nodeId}]`);
        }
        for (const child of (node.children || [])) {
          dumpTree(child, indent + '  ');
        }
      }
      dumpTree(sr, '  ');
    }
  } else {
    console.log('  Host not found in tree');
  }
} catch (e) {
  console.log('  Error:', e.message);
}

await s.close();
