#!/usr/bin/env node
/**
 * CDP QA Check — OpenMyHealth
 * Validates extension pages against a running dev Chrome instance (CDP port 9222).
 *
 * Usage:
 *   node qa/cdp-check.mjs                     # Run infra checks (setup/vault/content)
 *   node qa/cdp-check.mjs --checks setup      # setup only
 *   node qa/cdp-check.mjs --checks vault      # vault only
 *   node qa/cdp-check.mjs --checks content    # content script only
 *   node qa/cdp-check.mjs --checks phase1     # Phase 1: Setup & PIN (12 checks)
 *   node qa/cdp-check.mjs --checks phase2     # Phase 2: Data Pipeline (14 checks)
 *   node qa/cdp-check.mjs --checks phase3a    # Phase 3A: MCP Core Flow (16 checks)
 *   node qa/cdp-check.mjs --checks phase3b    # Phase 3B: MCP Advanced (18 checks)
 *   node qa/cdp-check.mjs --checks phase4     # Phase 4: Edge Cases (10 checks)
 *   node qa/cdp-check.mjs --checks phase5     # Phase 5: Cross-cutting (14 checks)
 *   node qa/cdp-check.mjs --checks all-phases # All 6 phases sequentially (84 checks)
 *   node qa/cdp-check.mjs --save-baseline     # Save current screenshots as baselines
 *   node qa/cdp-check.mjs --json              # JSON-only output
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';

import { discoverTargets, connectTarget, findExtensionId, discoverBrowserWsUrl, discoverExtensionId } from './lib/cdp-client.mjs';
import { compareScreenshots } from './lib/screenshot.mjs';
import { createRunDirs, generateReport, printSummary } from './lib/report.mjs';
import { runSetupChecks } from './lib/checks/setup-checks.mjs';
import { runVaultChecks } from './lib/checks/vault-checks.mjs';
import { runContentScriptChecks } from './lib/checks/content-script-checks.mjs';

// Phase check modules (Spec v1.4 E2E coverage)
import { runPhase1Checks } from './lib/checks/phase1-setup-pin.mjs';
import { runPhase2Checks } from './lib/checks/phase2-data-pipeline.mjs';
import { runPhase3aChecks } from './lib/checks/phase3a-mcp-core.mjs';
import { runPhase3bChecks } from './lib/checks/phase3b-mcp-advanced.mjs';
import { runPhase4Checks } from './lib/checks/phase4-edge-cases.mjs';
import { runPhase5Checks } from './lib/checks/phase5-cross-cutting.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const QA_DIR = __dirname;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { checks: null, saveBaseline: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--checks' && argv[i + 1]) {
      args.checks = argv[++i].split(',');
    } else if (argv[i] === '--save-baseline') {
      args.saveBaseline = true;
    } else if (argv[i] === '--json') {
      args.json = true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers: create and close temporary tabs via browser-level CDP
// ---------------------------------------------------------------------------

/**
 * Create a temporary blank tab and return { session, targetId, browserSession }.
 * The caller is responsible for closing via closeTemporaryTab().
 */
async function openTemporaryTab(port) {
  const browserWsUrl = await discoverBrowserWsUrl(port);
  const browserSession = await connectTarget(browserWsUrl);
  const { targetId } = await browserSession.send('Target.createTarget', { url: 'about:blank' });
  const pageWsUrl = `ws://localhost:${port}/devtools/page/${targetId}`;
  const session = await connectTarget(pageWsUrl);
  return { session, targetId, browserSession };
}

/**
 * Close a temporary tab created by openTemporaryTab().
 */
async function closeTemporaryTab({ session, targetId, browserSession }) {
  try { await session.close(); } catch { /* already closed */ }
  try { await browserSession.send('Target.closeTarget', { targetId }); } catch { /* best effort */ }
  try { await browserSession.close(); } catch { /* already closed */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const ALL_PHASES = ['phase1', 'phase2', 'phase3a', 'phase3b', 'phase4', 'phase5'];
  // Expand 'all-phases' into individual phase names
  const expandedChecks = args.checks
    ? args.checks.flatMap(c => c === 'all-phases' ? ALL_PHASES : [c])
    : null;
  const shouldRun = (name) => !expandedChecks || expandedChecks.includes(name);

  // 1. Discover CDP targets
  let targets;
  try {
    targets = await discoverTargets(9222);
  } catch {
    console.error('❌ CDP 연결 실패. pnpm dev가 실행 중인지 확인하세요.');
    process.exit(1);
  }

  // 2. Find extension ID (try targets first, then browser-level CDP + profile scan)
  let extensionId = findExtensionId(targets);
  if (!extensionId) {
    // Extension service workers may not appear in /json — use browser CDP + profile scan
    const profileDir = join(__dirname, '..', '.wxt', 'chrome-profile');
    extensionId = await discoverExtensionId(9222, profileDir);
  }
  if (!extensionId) {
    console.error('❌ 익스텐션을 찾을 수 없습니다. pnpm dev로 Chrome이 실행 중인지 확인하세요.');
    process.exit(1);
  }

  // 3. Create run directories
  const runDir = await createRunDirs(QA_DIR);

  const results = [];

  // 4. Run setup checks (in a temporary tab — does NOT touch existing tabs)
  if (shouldRun('setup')) {
    const tmp = await openTemporaryTab(9222);
    try {
      const setupResults = await runSetupChecks(tmp.session, extensionId, runDir);
      results.push(...setupResults);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // 5. Run vault checks (in a temporary tab)
  if (shouldRun('vault')) {
    const tmp = await openTemporaryTab(9222);
    try {
      const vaultResults = await runVaultChecks(tmp.session, extensionId, runDir);
      results.push(...vaultResults);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // 6. Run content script checks (re-discover targets for fresh list)
  if (shouldRun('content')) {
    const freshTargets = await discoverTargets(9222);
    const contentResults = await runContentScriptChecks(null, freshTargets);
    results.push(...contentResults);
  }

  // ---------------------------------------------------------------------------
  // Phase checks (Spec v1.4 E2E — 84 checks total)
  // ---------------------------------------------------------------------------
  const PORT = 9222;

  // Phase 1: Setup & PIN (12 checks) — runs in temp tab
  if (shouldRun('phase1')) {
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase1Checks(tmp.session, extensionId, runDir);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // Phase 2: Data Pipeline (14 checks) — runs in temp tab, depends on Phase 1 state
  if (shouldRun('phase2')) {
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase2Checks(tmp.session, extensionId, runDir);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // Phase 3A: MCP Core Flow (16 checks) — uses content script tabs
  if (shouldRun('phase3a')) {
    const freshTargets = await discoverTargets(PORT);
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase3aChecks(tmp.session, extensionId, runDir, freshTargets, PORT);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // Phase 3B: MCP Advanced (18 checks) — uses content script tabs
  if (shouldRun('phase3b')) {
    const freshTargets = await discoverTargets(PORT);
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase3bChecks(tmp.session, extensionId, runDir, freshTargets, PORT);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // Phase 4: Edge Cases (10 checks) — mixed: extension pages + content tabs
  if (shouldRun('phase4')) {
    const freshTargets = await discoverTargets(PORT);
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase4Checks(tmp.session, extensionId, runDir, freshTargets, PORT);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // Phase 5: Cross-cutting (14 checks) — mixed: audit logs + a11y + providers
  if (shouldRun('phase5')) {
    const freshTargets = await discoverTargets(PORT);
    const tmp = await openTemporaryTab(PORT);
    try {
      const r = await runPhase5Checks(tmp.session, extensionId, runDir, freshTargets, PORT);
      results.push(...r);
    } finally {
      await closeTemporaryTab(tmp);
    }
  }

  // 7. Baseline comparisons (only if screenshot check passed)
  const baselinesDir = join(QA_DIR, 'baselines');
  const pages = ['setup', 'vault'];
  for (const page of pages) {
    if (!shouldRun(page)) continue;

    // Guard: skip baseline comparison if screenshot capture didn't pass
    const screenshotResult = results.find(r => r.id === `${page}:screenshot`);
    if (!screenshotResult || screenshotResult.status !== 'pass') {
      results.push({ id: `baseline:${page}`, status: 'skip', duration: 0,
        message: 'Screenshot not available for comparison' });
      continue;
    }

    const actualPath = join(runDir, 'screenshots', `${page}.png`);
    const baselinePath = join(baselinesDir, `${page}.png`);
    const diffPath = join(runDir, 'diffs', `${page}.png`);
    const start = Date.now();
    try {
      const comparison = await compareScreenshots(actualPath, baselinePath, diffPath);
      if (comparison.match === null) {
        results.push({ id: `baseline:${page}`, status: 'skip', duration: Date.now() - start,
          message: comparison.message || 'No baseline' });
      } else if (comparison.match) {
        results.push({ id: `baseline:${page}`, status: 'pass', duration: Date.now() - start,
          message: `${(comparison.diffPercent * 100).toFixed(2)}% diff (threshold: 0.5%)` });
      } else {
        results.push({ id: `baseline:${page}`, status: 'fail', duration: Date.now() - start,
          message: `${(comparison.diffPercent * 100).toFixed(2)}% diff exceeds 0.5% threshold`,
          details: comparison });
      }
    } catch (e) {
      results.push({ id: `baseline:${page}`, status: 'skip', duration: Date.now() - start,
        message: `Comparison error: ${e.message}` });
    }
  }

  // 8. Save baselines if requested
  if (args.saveBaseline) {
    await mkdir(baselinesDir, { recursive: true });
    for (const page of pages) {
      const src = join(runDir, 'screenshots', `${page}.png`);
      const dst = join(baselinesDir, `${page}.png`);
      try {
        await copyFile(src, dst);
        if (!args.json) console.log(`📸 Baseline saved: ${page}.png`);
      } catch {
        // Screenshot may not exist if that check group was skipped
      }
    }
  }

  // 9. Generate report
  await generateReport(results, runDir);

  // 10. Output
  if (args.json) {
    const summary = { passed: 0, failed: 0, skipped: 0, total: results.length };
    for (const r of results) {
      if (r.status === 'pass') summary.passed++;
      else if (r.status === 'fail') summary.failed++;
      else summary.skipped++;
    }
    console.log(JSON.stringify({ summary, checks: results }, null, 2));
  } else {
    printSummary(results);
  }

  // 11. Exit code
  const hasFail = results.some(r => r.status === 'fail');
  process.exit(hasFail ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ QA runner error:', err);
  process.exit(1);
});
