/**
 * In-cluster canary runner — the entrypoint `command:` for the playwright-e2e
 * K8s Job (`personalServerNotes/k8s/playwright-e2e/job.yml.tpl`) and the
 * nightly CronJobs.
 *
 * TWO MODES, gated on E2E_SUITE:
 *
 *   • CHUNKED  (E2E_SUITE = "tests" or unset — the nightly full-suite run)
 *     Runs the setup projects ONCE, then each chunk-project as its OWN
 *     `playwright test --project=<chunk> --no-deps` process. A fresh process
 *     per chunk means Chromium memory is reclaimed between chunks — a single
 *     2-3h browser process was being OOM-killed ~2/3 through the suite. Per-
 *     chunk JSON reports are aggregated into one summary.
 *
 *   • SINGLE   (E2E_SUITE = a path filter, e.g. "tests/cross-product-isolation")
 *     Runs one `playwright test ${E2E_SUITE}` invocation — the on-demand
 *     job.yml.tpl path-filtered behaviour, unchanged.
 *
 * Flow (both modes):
 *   1. Generate the canary runId UP FRONT and export E2E_CANARY_RUN_ID so the
 *      Playwright globalSetup reuses it (for the SeaweedFS report path + lock).
 *   2. Run the tests (chunked or single).
 *   3. Upload reports + traces to SeaweedFS S3 at
 *      s3://${S3_BUCKET}/${E2E_TARGET}/${runId}/.
 *   4. POST a markdown summary to notification-api's shared-secret endpoint.
 *   5. Exit non-zero if any test/chunk failed.
 *
 * Steps 3 + 4 are best-effort: a failure there is logged but does NOT change
 * the exit code.
 *
 * Env contract (set by the Job manifest):
 *   E2E_TARGET, E2E_SUITE, S3_ENDPOINT, S3_BUCKET, AWS_*, NOTIFY_SUMMARY_URL,
 *   SMOKE_SHARED_SECRET — see the manifest for values.
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = path.resolve(SCRIPT_DIR, '..');
const RESULTS_JSON = path.join(E2E_ROOT, 'reports', 'results.json');
const CHUNKS_DIR = path.join(E2E_ROOT, 'reports', 'chunks');
const HTML_REPORT_DIR = path.join(E2E_ROOT, 'reports', 'html');
const TRACES_DIR = path.join(E2E_ROOT, 'test-results');

function log(msg) {
  process.stdout.write(`[canary-runner] ${msg}\n`);
}

function ensureRunId() {
  const existing = process.env.E2E_CANARY_RUN_ID;
  if (existing && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  process.env.E2E_CANARY_RUN_ID = id;
  return id;
}

// ---------------------------------------------------------------------------
// SINGLE mode — one path-filtered invocation (on-demand job.yml.tpl).
// ---------------------------------------------------------------------------
function runPlaywrightSingle(suite) {
  const args = ['playwright', 'test', ...suite.split(/\s+/).filter(Boolean)];
  log(`npx ${args.join(' ')}`);
  const result = spawnSync('npx', args, { cwd: E2E_ROOT, stdio: 'inherit', env: process.env });
  return result.status === null ? 1 : result.status;
}

// ---------------------------------------------------------------------------
// CHUNKED mode — setup once, then each chunk-project as its own process.
// ---------------------------------------------------------------------------

/** Run the setup projects once. Their globalSetup mints the token + lock; the
 *  `setup` project writes playwright/.auth/user.json that every chunk reuses.
 *
 *  E2E_CANARY_SKIP_TEARDOWN=1 — Playwright's globalTeardown is config-level, so
 *  it fires at the end of EVERY `playwright test` process the runner spawns
 *  (setup + each chunk). The canary teardown sweeps every `e2ec-{runId8}-*`
 *  record, INCLUDING the shared tenant-admin users multi-tenant.setup.ts just
 *  created. If that sweep ran here, the setup process would delete the tenant
 *  users before any chunk could log in as them → 401 Invalid user credentials
 *  in every multiTenant chunk. The flag makes globalTeardown skip the sweep
 *  (it still releases the lock); the runner performs the sweep ONCE at the end
 *  via runFinalCanaryCleanup(). */
function runSetup() {
  const args = ['playwright', 'test', '--project=setup', '--project=multi-tenant-setup'];
  log(`[setup] npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, {
    cwd: E2E_ROOT,
    stdio: 'inherit',
    env: { ...process.env, E2E_CANARY_SKIP_TEARDOWN: '1' },
  });
  return r.status === null ? 1 : r.status;
}

/** Final canary data sweep — run ONCE after all chunks complete. Re-runs the
 *  lightweight `setup` project (auth.setup.ts) with E2E_CANARY_SKIP_TEARDOWN
 *  UNSET, so its config-level globalSetup re-mints the superUser token (the
 *  chunk processes' tokens died with their processes) and its globalTeardown
 *  performs the real cleanup sweep across all 6 services + releases the lock.
 *  Reuses the existing TS plumbing (token mint, env load, realm handling) with
 *  no new projects. Best-effort: failure is logged, never changes exit code. */
function runFinalCanaryCleanup() {
  const args = ['playwright', 'test', '--project=setup'];
  log(`[final-cleanup] npx ${args.join(' ')}`);
  const env = { ...process.env };
  delete env.E2E_CANARY_SKIP_TEARDOWN;
  const r = spawnSync('npx', args, { cwd: E2E_ROOT, stdio: 'inherit', env });
  if (r.status !== 0) {
    log(`WARN: final canary cleanup exited ${r.status === null ? 'null' : r.status} — ` +
      'orphan-cleanup CronJob will sweep any leaked e2ec-* records.');
  }
}

/** Enumerate chunk-project names from `playwright test --list`, in definition
 *  order, excluding the two setup projects. The `[project]` tag is always the
 *  first token on a test line, so anchor the match to line start. */
function listChunks() {
  const r = spawnSync('npx', ['playwright', 'test', '--list'], {
    cwd: E2E_ROOT, encoding: 'utf8', env: process.env,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const seen = new Set();
  const order = [];
  // A real `--list` test line is `  [project] › file › test`. The `›`
  // (›) after the bracket is what distinguishes it from stray bracketed log
  // prefixes the config load prints to stdout (e.g. `[e2e-env] target=...`).
  const SKIP = new Set(['setup', 'multi-tenant-setup', 'e2e-env']);
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*\[([a-z][a-z0-9-]+)\]\s+›/);
    if (!m) continue;
    const name = m[1];
    if (SKIP.has(name)) continue;
    if (!seen.has(name)) { seen.add(name); order.push(name); }
  }
  return order;
}

/** Run one chunk as its own `playwright test` process. `--no-deps` skips the
 *  setup projects (already run by runSetup); a fresh process reclaims memory. */
function runChunk(chunk) {
  const jsonOut = path.join(CHUNKS_DIR, `${chunk}.json`);
  const args = [
    'playwright', 'test',
    `--project=${chunk}`,
    '--no-deps',
    '--reporter=list,json',
    `--output=test-results/${chunk}`,
  ];
  log(`[chunk ${chunk}] npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, {
    cwd: E2E_ROOT,
    stdio: 'inherit',
    // E2E_CANARY_SKIP_TEARDOWN=1 — see runSetup(). The per-chunk globalTeardown
    // must NOT sweep the shared canary users mid-run; the runner sweeps once at
    // the end (runFinalCanaryCleanup). The chunk still releases the run lock it
    // acquired in its own globalSetup.
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut, E2E_CANARY_SKIP_TEARDOWN: '1' },
  });
  return r.status === null ? 1 : r.status;
}

function emptySummary() {
  return {
    total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0,
    durationMs: 0, perSuite: [], reportAvailable: false,
  };
}

/** Tally one Playwright JSON report's stats into a summary accumulator. */
function tallyStats(raw) {
  const st = raw.stats ?? {};
  return {
    passed: st.expected ?? 0,
    failed: st.unexpected ?? 0,
    skipped: st.skipped ?? 0,
    flaky: st.flaky ?? 0,
    durationMs: Math.round(st.duration ?? 0),
  };
}

/** SINGLE mode — read the one reports/results.json. */
function summarizeSingle() {
  const summary = emptySummary();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  } catch (e) {
    log(`WARN: could not read ${RESULTS_JSON}: ${e instanceof Error ? e.message : e}`);
    return summary;
  }
  const t = tallyStats(raw);
  Object.assign(summary, t, { reportAvailable: true });
  summary.total = t.passed + t.failed + t.skipped;
  summary.perSuite.push({ title: process.env.E2E_SUITE ?? 'tests', ...t });
  return summary;
}

/** CHUNKED mode — aggregate every reports/chunks/<chunk>.json. A chunk with no
 *  JSON crashed before writing one — surface it as a failed chunk. */
function summarizeChunked(chunks) {
  const summary = emptySummary();
  for (const chunk of chunks) {
    const f = path.join(CHUNKS_DIR, `${chunk}.json`);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      log(`WARN: chunk '${chunk}' produced no JSON (${e instanceof Error ? e.message : e}) — counting as crashed`);
      summary.perSuite.push({ title: `${chunk} (crashed)`, passed: 0, failed: 0, skipped: 0 });
      summary.failed += 1;
      continue;
    }
    summary.reportAvailable = true;
    const t = tallyStats(raw);
    summary.passed += t.passed;
    summary.failed += t.failed;
    summary.skipped += t.skipped;
    summary.flaky += t.flaky;
    summary.durationMs += t.durationMs;
    summary.perSuite.push({ title: chunk, passed: t.passed, failed: t.failed, skipped: t.skipped });
  }
  summary.total = summary.passed + summary.failed + summary.skipped;
  return summary;
}

function fmtDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function uploadToS3(runId, target, summary) {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET ?? 'e2e-canary-results';
  if (!endpoint) {
    log('WARN: S3_ENDPOINT unset — skipping report upload.');
    return null;
  }
  const prefix = `s3://${bucket}/${target}/${runId}`;
  const awsBase = ['--endpoint-url', endpoint];

  spawnSync('aws', ['s3', 'mb', `s3://${bucket}`, ...awsBase], { encoding: 'utf8' });

  // summary.json — the machine-readable per-run record. The notification-api
  // Daily Report "Canary Activity" collector reads ONLY this file per run.
  // Keep its shape stable; it is a contract.
  const summaryDoc = {
    runId,
    target,
    finishedAt: new Date().toISOString(),
    status: summary.failed > 0 ? 'FAIL' : 'PASS',
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    flaky: summary.flaky,
    durationMs: summary.durationMs,
    suite: process.env.E2E_SUITE ?? 'tests',
    perSuite: summary.perSuite,
    reportPath: `${target}/${runId}/report/index.html`,
  };
  const summaryFile = path.join(E2E_ROOT, 'reports', 'summary.json');
  try {
    fs.writeFileSync(summaryFile, JSON.stringify(summaryDoc, null, 2));
  } catch (e) {
    log(`WARN: could not write summary.json: ${e instanceof Error ? e.message : e}`);
  }

  let uploadedAny = false;
  for (const [src, dst, recursive] of [
    [HTML_REPORT_DIR, 'report', true],
    [CHUNKS_DIR, 'chunks', true],
    [TRACES_DIR, 'traces', true],
    [summaryFile, 'summary.json', false],
  ]) {
    if (!fs.existsSync(src)) continue;
    const args = recursive
      ? ['s3', 'cp', src, `${prefix}/${dst}`, '--recursive', '--only-show-errors', ...awsBase]
      : ['s3', 'cp', src, `${prefix}/${dst}`, '--only-show-errors', ...awsBase];
    const cp = spawnSync('aws', args, { encoding: 'utf8' });
    if (cp.status === 0) {
      uploadedAny = true;
      log(`uploaded ${dst} → ${prefix}/${dst}${recursive ? '/' : ''}`);
    } else {
      log(`WARN: S3 upload of '${dst}' failed: ${(cp.stderr || cp.error || '').toString().trim()}`);
    }
  }
  return uploadedAny ? `${prefix}/summary.json` : null;
}

function buildMarkdown(summary, runId, target, reportPath) {
  const lines = [];
  lines.push(`# E2E Canary — ${target}`);
  lines.push('');
  lines.push(`- **Run ID**: \`${runId}\``);
  lines.push(`- **Result**: ${summary.failed > 0 ? 'FAIL' : 'PASS'} — ` +
    `${summary.passed}/${summary.total} passed, ${summary.failed} failed, ` +
    `${summary.skipped} skipped${summary.flaky ? `, ${summary.flaky} flaky` : ''}`);
  lines.push(`- **Duration**: ${fmtDuration(summary.durationMs)}`);
  if (reportPath) {
    lines.push(`- **Report**: \`${reportPath}\` (SeaweedFS — fetch with the canary S3 creds)`);
  } else {
    lines.push('- **Report**: upload failed — see Job logs (`kubectl logs job/...`)');
  }
  lines.push('');
  if (summary.perSuite.length > 0) {
    lines.push('## Per-chunk');
    lines.push('');
    lines.push('| Chunk | Passed | Failed | Skipped |');
    lines.push('|---|---|---|---|');
    for (const s of summary.perSuite) {
      lines.push(`| ${s.title} | ${s.passed} | ${s.failed} | ${s.skipped} |`);
    }
    lines.push('');
  }
  if (!summary.reportAvailable) {
    lines.push('> No JSON reports were found — counts above are zeros. ' +
      'The run may have crashed before writing any report.');
  }
  return lines.join('\n');
}

async function postSummary(summary, runId, target, reportPath) {
  const url = process.env.NOTIFY_SUMMARY_URL;
  const secret = process.env.SMOKE_SHARED_SECRET;
  if (!url || !secret) {
    log('WARN: NOTIFY_SUMMARY_URL or SMOKE_SHARED_SECRET unset — skipping summary email.');
    return;
  }
  const overallStatus = summary.failed > 0 ? 'FAIL' : 'PASS';
  const subject = `[E2E Canary] ${target} ${summary.passed}/${summary.total} ` +
    `(${fmtDuration(summary.durationMs)})`;
  const body = {
    service: 'e2e-canary',
    environment: target,
    subject,
    overallStatus,
    ranServices: summary.perSuite.map((s) => s.title),
    aggregateMarkdown: buildMarkdown(summary, runId, target, reportPath),
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smoke-Secret': secret },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      log(`summary email sent (${subject})`);
    } else {
      const txt = await resp.text().catch(() => '');
      log(`WARN: summary email POST returned HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    log(`WARN: summary email POST failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const target = process.env.E2E_TARGET ?? 'staging';
  const suite = (process.env.E2E_SUITE ?? 'tests').trim();
  const runId = ensureRunId();
  const chunked = suite === 'tests' || suite === '';

  log(`target=${target} runId=${runId} mode=${chunked ? 'chunked' : 'single'} suite=${suite}`);

  let summary;
  let failed;

  if (chunked) {
    fs.rmSync(CHUNKS_DIR, { recursive: true, force: true });
    fs.mkdirSync(CHUNKS_DIR, { recursive: true });

    const setupExit = runSetup();
    if (setupExit !== 0) {
      log(`FATAL: setup phase failed (exit ${setupExit}) — chunks need the auth state; aborting.`);
      process.exit(setupExit);
    }

    const chunks = listChunks();
    if (chunks.length === 0) {
      log('FATAL: no chunk projects found via `playwright test --list`.');
      process.exit(1);
    }
    log(`running ${chunks.length} chunks: ${chunks.join(', ')}`);

    const exits = {};
    for (const chunk of chunks) {
      exits[chunk] = runChunk(chunk);
      log(`[chunk ${chunk}] exit ${exits[chunk]}`);
    }

    // Sweep all canary data ONCE, now that every chunk has finished. The
    // intermediate processes ran with E2E_CANARY_SKIP_TEARDOWN set so the
    // shared tenant users survived for the whole run; this is where they get
    // cleaned up. Best-effort — never affects the pass/fail exit code.
    runFinalCanaryCleanup();

    summary = summarizeChunked(chunks);
    failed = Object.values(exits).some((c) => c !== 0);
    log(`AGGREGATE: ${summary.passed} passed, ${summary.failed} failed, ` +
      `${summary.skipped} skipped, ${summary.flaky} flaky across ${chunks.length} chunks`);
  } else {
    const exitCode = runPlaywrightSingle(suite);
    log(`playwright exited with code ${exitCode}`);
    summary = summarizeSingle();
    failed = exitCode !== 0;
  }

  const reportPath = uploadToS3(runId, target, summary);
  await postSummary(summary, runId, target, reportPath);

  // Non-zero if anything failed — pass/fail visible in `kubectl get jobs`.
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  log(`FATAL: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
