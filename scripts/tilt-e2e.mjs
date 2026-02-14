#!/usr/bin/env node

/**
 * Tilt E2E Runner — triggers a Tilt resource, polls for completion, prints logs.
 *
 * Usage: node scripts/tilt-e2e.mjs <resource-name> [--port N] [--timeout N]
 *
 * Exit codes:
 *   0 = tests passed
 *   1 = tests failed
 *   2 = script error (bad args, Tilt unreachable, timeout, etc.)
 */

import { execSync, spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_RESOURCES = [
  'playwright-e2e-health',
  'playwright-e2e-identity-all',
  'playwright-e2e-questioner-all',
  'playwright-e2e-questioner-templates-all',
  'playwright-e2e-questioner-quiz-all',
  'playwright-e2e-online-menus-all',
  'playwright-e2e-content-all',
  'playwright-e2e-notification-all',
  'theme-studio-e2e',
];

const DEFAULT_PORT = 10350;
const DEFAULT_TIMEOUT_S = 600; // 10 minutes
const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage() {
  console.log(`
Usage: node scripts/tilt-e2e.mjs <resource-name> [--port N] [--timeout N]

Arguments:
  resource-name   Tilt resource to trigger (required)
  --port N        Tilt API port (default: ${DEFAULT_PORT})
  --timeout N     Max wait in seconds (default: ${DEFAULT_TIMEOUT_S})

Valid resources:
${VALID_RESOURCES.map((r) => `  - ${r}`).join('\n')}

Exit codes:
  0  Tests passed
  1  Tests failed
  2  Script error
`.trim());
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(2);
  }

  const resource = args[0];
  let port = DEFAULT_PORT;
  let timeout = DEFAULT_TIMEOUT_S;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[i + 1]);
      i++;
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeout = Number(args[i + 1]);
      i++;
    }
  }

  if (!VALID_RESOURCES.includes(resource)) {
    console.error(`Error: unknown resource "${resource}"\n`);
    console.error('Valid resources:');
    VALID_RESOURCES.forEach((r) => console.error(`  - ${r}`));
    process.exit(2);
  }

  if (Number.isNaN(port) || port <= 0) {
    console.error(`Error: invalid port "${args[args.indexOf('--port') + 1]}"`);
    process.exit(2);
  }

  if (Number.isNaN(timeout) || timeout <= 0) {
    console.error(
      `Error: invalid timeout "${args[args.indexOf('--timeout') + 1]}"`,
    );
    process.exit(2);
  }

  return { resource, port, timeout };
}

// ---------------------------------------------------------------------------
// Tilt API helpers
// ---------------------------------------------------------------------------

function portFlag(port) {
  return port === DEFAULT_PORT ? '' : ` --port ${port}`;
}

function getResourceJson(resource, port) {
  const cmd = `tilt get uiresource ${resource} -o json${portFlag(port)}`;
  const raw = run(cmd);
  return JSON.parse(raw);
}

function getBuildCount(json) {
  const history = json?.status?.buildHistory;
  return Array.isArray(history) ? history.length : 0;
}

function getLatestBuild(json) {
  const history = json?.status?.buildHistory;
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[0]; // newest first
}

function triggerResource(resource, port) {
  const cmd = `tilt trigger ${resource}${portFlag(port)}`;
  run(cmd);
}

function printLogs(resource, port) {
  const cmd = `tilt logs ${resource}${portFlag(port)}`;
  try {
    const logs = run(cmd);
    console.log('\n' + '='.repeat(72));
    console.log(`LOGS: ${resource}`);
    console.log('='.repeat(72));
    console.log(logs);
    console.log('='.repeat(72) + '\n');
  } catch {
    console.warn('(could not retrieve logs)');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { resource, port, timeout } = parseArgs(process.argv);

  console.log(`[tilt-e2e] Resource : ${resource}`);
  console.log(`[tilt-e2e] Port     : ${port}`);
  console.log(`[tilt-e2e] Timeout  : ${timeout}s`);
  console.log();

  // 1. Snapshot current build count
  let json;
  try {
    json = getResourceJson(resource, port);
  } catch (err) {
    console.error(
      `Error: cannot reach Tilt on port ${port}. Is Tilt running?\n`,
    );
    console.error(err.message);
    process.exit(2);
  }

  const countBefore = getBuildCount(json);
  console.log(`[tilt-e2e] Build history count before trigger: ${countBefore}`);

  // 2. Trigger the resource
  console.log(`[tilt-e2e] Triggering ${resource}...`);
  try {
    triggerResource(resource, port);
  } catch (err) {
    console.error(`Error: failed to trigger ${resource}\n`);
    console.error(err.message);
    process.exit(2);
  }
  console.log('[tilt-e2e] Triggered. Polling for completion...\n');

  // 3. Poll until a new build entry appears with a finishTime
  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    try {
      json = getResourceJson(resource, port);
    } catch {
      console.warn('[tilt-e2e] Poll: could not reach Tilt, retrying...');
      continue;
    }

    const countNow = getBuildCount(json);
    if (countNow <= countBefore) {
      process.stdout.write('.');
      continue;
    }

    // A new build entry exists — check if it has finished
    const latest = getLatestBuild(json);
    if (!latest?.finishTime) {
      process.stdout.write('.');
      continue;
    }

    // Build finished
    console.log(); // newline after dots
    console.log(
      `[tilt-e2e] Build finished at ${latest.finishTime}`,
    );

    // 4. Print logs
    printLogs(resource, port);

    // 5. Determine pass/fail from the build error field
    if (latest.error) {
      console.log(`[tilt-e2e] RESULT: FAILED`);
      console.log(`[tilt-e2e] Error: ${latest.error}`);
      process.exit(1);
    }

    console.log('[tilt-e2e] RESULT: PASSED');
    process.exit(0);
  }

  // Timeout
  console.log();
  console.error(
    `[tilt-e2e] ERROR: timed out after ${timeout}s waiting for ${resource}`,
  );
  printLogs(resource, port);
  process.exit(2);
}

main().catch((err) => {
  console.error('[tilt-e2e] Unexpected error:', err);
  process.exit(2);
});
