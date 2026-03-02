/**
 * JSON report generation and CLI output.
 */
import { mkdir, writeFile, symlink, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create timestamped run directories and update the `latest` symlink.
 * @param {string} qaDir — path to the qa/ root
 * @returns {Promise<string>} runDir path
 */
export async function createRunDirs(qaDir) {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-');

  const runsDir = join(qaDir, 'runs');
  const runDir = join(runsDir, timestamp);

  await mkdir(join(runDir, 'screenshots'), { recursive: true });
  await mkdir(join(runDir, 'diffs'), { recursive: true });

  // Update latest symlink
  const latestLink = join(runsDir, 'latest');
  try {
    await lstat(latestLink);
    await unlink(latestLink);
  } catch {
    // symlink doesn't exist yet
  }
  await symlink(timestamp, latestLink);

  return runDir;
}

/**
 * Write a JSON report to the run directory.
 * @param {Array<{id: string, status: string, duration: number, message: string, details?: any}>} results
 * @param {string} runDir
 * @returns {Promise<object>} report object
 */
export async function generateReport(results, runDir) {
  const summary = { passed: 0, failed: 0, skipped: 0, total: results.length };
  for (const r of results) {
    if (r.status === 'pass') summary.passed++;
    else if (r.status === 'fail') summary.failed++;
    else if (r.status === 'skip') summary.skipped++;
  }

  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  const report = {
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    summary,
    checks: results,
  };

  await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

/**
 * Print a formatted summary to the console.
 * @param {Array<{id: string, status: string, duration: number, message: string}>} results
 */
export function printSummary(results) {
  const RESET = '\x1b[0m';
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';

  const statusColor = { pass: GREEN, fail: RED, skip: YELLOW };
  const statusLabel = { pass: ' PASS ', fail: ' FAIL ', skip: ' SKIP ' };

  console.log('');
  console.log(`${BOLD}CDP QA Check \u2014 OpenMyHealth${RESET}`);
  console.log('\u2550'.repeat(30));

  for (const r of results) {
    const color = statusColor[r.status] || RESET;
    const label = statusLabel[r.status] || r.status;
    const dur = r.status === 'skip'
      ? ''
      : `${DIM}${r.duration}ms${RESET}`;
    const msg = r.message || '';

    // Pad the id to align columns
    const idPadded = r.id.padEnd(24);

    if (r.status === 'skip') {
      console.log(`${color}${label}${RESET}  ${idPadded}  ${DIM}${msg}${RESET}`);
    } else if (r.status === 'fail') {
      console.log(`${color}${label}${RESET}  ${idPadded}  ${RED}${msg}${RESET}  ${dur}`);
    } else {
      console.log(`${color}${label}${RESET}  ${idPadded}  ${dur}`);
    }
  }

  console.log('\u2500'.repeat(30));

  let passed = 0, failed = 0, skipped = 0;
  let totalMs = 0;
  for (const r of results) {
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else if (r.status === 'skip') skipped++;
    totalMs += r.duration || 0;
  }

  const parts = [];
  if (passed > 0) parts.push(`${GREEN}${passed} passed${RESET}`);
  if (failed > 0) parts.push(`${RED}${failed} failed${RESET}`);
  if (skipped > 0) parts.push(`${YELLOW}${skipped} skipped${RESET}`);

  const totalSec = (totalMs / 1000).toFixed(1);
  console.log(` ${parts.join('  ')}  ${DIM}(${totalSec}s)${RESET}`);
  console.log('');
}
