/**
 * Shadow DOM piercing utilities using CDP DOM domain.
 *
 * Chrome's DOM domain can access closed shadow roots via
 * DOM.getDocument({depth: -1, pierce: true}). This loads the
 * full tree including shadow roots with valid nodeIds that
 * work with DOM.querySelector.
 *
 * Key insight: DOM.getDocument with depth:-1 + pierce:true must
 * be called FIRST to establish valid nodeIds for shadow root nodes.
 * Without this, querySelector on shadow roots returns 0.
 */

/** Cache for shadow root nodeId — invalidated by refreshDom(). */
let _cachedSrNodeId = null;

/**
 * Load the full DOM tree (including shadow roots) and cache
 * the overlay shadow root nodeId.
 * Must be called before any query functions.
 */
export async function refreshDom(session) {
  await session.send('DOM.enable').catch(() => {});
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  _cachedSrNodeId = findOverlayShadowRoot(root);
  return _cachedSrNodeId;
}

/**
 * Initialize the DOM domain. Alias for refreshDom for clarity.
 */
export async function initDom(session) {
  return refreshDom(session);
}

/**
 * Walk the DOM tree to find #openmyhealth-overlay-root's shadow root nodeId.
 */
function findOverlayShadowRoot(node) {
  // Check if this node is the overlay host
  if (node.attributes) {
    const idIdx = node.attributes.indexOf('id');
    if (idIdx >= 0 && node.attributes[idIdx + 1] === 'openmyhealth-overlay-root') {
      if (node.shadowRoots && node.shadowRoots.length > 0) {
        return node.shadowRoots[0].nodeId;
      }
      return null;
    }
  }
  // Recurse children
  for (const child of (node.children || [])) {
    const found = findOverlayShadowRoot(child);
    if (found) return found;
  }
  // Recurse shadow roots
  for (const sr of (node.shadowRoots || [])) {
    const found = findOverlayShadowRoot(sr);
    if (found) return found;
  }
  return null;
}

/**
 * Get the cached shadow root nodeId, refreshing if needed.
 */
async function getSrNodeId(session) {
  if (_cachedSrNodeId) return _cachedSrNodeId;
  return refreshDom(session);
}

/**
 * querySelector inside the overlay shadow root.
 * Returns the nodeId or null. Auto-refreshes DOM tree on miss.
 */
export async function shadowQuery(session, selector) {
  const srId = await getSrNodeId(session);
  if (!srId) return null;
  try {
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: srId,
      selector,
    });
    if (nodeId > 0) return nodeId;
    // Miss — refresh DOM tree (overlay may have changed)
    await refreshDom(session);
    const srId2 = _cachedSrNodeId;
    if (!srId2) return null;
    const { nodeId: nodeId2 } = await session.send('DOM.querySelector', {
      nodeId: srId2,
      selector,
    });
    return nodeId2 > 0 ? nodeId2 : null;
  } catch {
    // DOM tree invalidated — refresh and retry
    await refreshDom(session);
    const srId2 = _cachedSrNodeId;
    if (!srId2) return null;
    try {
      const { nodeId } = await session.send('DOM.querySelector', {
        nodeId: srId2,
        selector,
      });
      return nodeId > 0 ? nodeId : null;
    } catch {
      return null;
    }
  }
}

/**
 * querySelectorAll inside the overlay shadow root.
 * Returns an array of nodeIds.
 */
export async function shadowQueryAll(session, selector) {
  const srId = await getSrNodeId(session);
  if (!srId) return [];
  try {
    const { nodeIds } = await session.send('DOM.querySelectorAll', {
      nodeId: srId,
      selector,
    });
    return nodeIds.filter(id => id > 0);
  } catch {
    await refreshDom(session);
    const srId2 = _cachedSrNodeId;
    if (!srId2) return [];
    try {
      const { nodeIds } = await session.send('DOM.querySelectorAll', {
        nodeId: srId2,
        selector,
      });
      return nodeIds.filter(id => id > 0);
    } catch {
      return [];
    }
  }
}

/**
 * Get textContent of a node by its nodeId.
 */
export async function getNodeText(session, nodeId) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { return this.textContent; }',
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return result.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the full text content of the overlay shell.
 */
export async function getShellText(session) {
  const shellId = await shadowQuery(session, '.omh-shell');
  if (!shellId) return null;
  return getNodeText(session, shellId);
}

/**
 * Check if a node is visible (not display:none, not visibility:hidden).
 */
export async function isNodeVisible(session, nodeId) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const s = getComputedStyle(this);
        return s.display !== 'none' && s.visibility !== 'hidden';
      }`,
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return result.value === true;
  } catch {
    return false;
  }
}

/**
 * Check if the overlay shell is visible.
 * Works with both open and closed shadow DOMs.
 */
export async function isOverlayVisible(session) {
  // Always refresh DOM to catch overlay state changes
  await refreshDom(session);
  const shellId = await shadowQuery(session, '.omh-shell');
  if (!shellId) return false;
  return isNodeVisible(session, shellId);
}

/**
 * Wait for the overlay shell to become visible.
 */
export async function waitForOverlay(session, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOverlayVisible(session)) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Wait for the overlay to disappear.
 */
export async function waitForOverlayHidden(session, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isOverlayVisible(session))) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Click an element inside the overlay shadow root by selector.
 * Resolves the DOM node to a JS object and calls .click().
 */
export async function clickOverlayButton(session, selector) {
  // Refresh DOM to ensure we have current state
  await refreshDom(session);
  const nodeId = await shadowQuery(session, selector);
  if (!nodeId) return false;
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { this.click(); }',
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Read text content of an element inside the overlay shadow root.
 */
export async function readOverlayText(session, selector) {
  const nodeId = await shadowQuery(session, selector);
  if (!nodeId) return null;
  return getNodeText(session, nodeId);
}

/**
 * Check if an element exists inside the overlay shadow root.
 */
export async function overlayHasElement(session, selector) {
  const nodeId = await shadowQuery(session, selector);
  return nodeId !== null;
}

/**
 * Get a computed CSS property value for a node.
 */
export async function getNodeStyle(session, nodeId, property) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() { return getComputedStyle(this).getPropertyValue(${JSON.stringify(property)}); }`,
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return result.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Get a boolean attribute or property value from a node.
 */
export async function getNodeProperty(session, nodeId, propName) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() { return this[${JSON.stringify(propName)}]; }`,
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return result.value;
  } catch {
    return undefined;
  }
}

/**
 * Get the element's bounding rect dimensions.
 */
export async function getNodeRect(session, nodeId) {
  try {
    const { object } = await session.send('DOM.resolveNode', { nodeId });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const r = this.getBoundingClientRect();
        return JSON.stringify({ width: r.width, height: r.height, top: r.top, left: r.left });
      }`,
      returnByValue: true,
    });
    await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return JSON.parse(result.value);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
