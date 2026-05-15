/**
 * In-cluster canary runner — the entrypoint `command:` for the playwright-e2e
 * K8s Job (`personalServerNotes/k8s/playwright-e2e/job.yml.tpl`). Phase 4 of
 * the e2e-multi-environment effort.
 *
 * Flow:
 *   1. Generate the canary runId UP FRONT and export E2E_CANARY_RUN_ID so the
 *      Playwright globalSetup reuses it (instead of minting its own) — the
 *      wrapper then knows the id for the SeaweedFS report path.
 *   2. Run `npx playwright test ${E2E_SUITE}` to completion, capturing the
 *      exit code. The lock ConfigMap is acquired/released by the canary
 *      global-setup/teardown (helpers/canary-lock.ts) — NOT here.
 *   3. Upload reports/html + test-results (traces) to SeaweedFS S3 at
 *      s3://${S3_BUCKET}/${E2E_TARGET}/${runId}/.
 *   4. POST a markdown summary to notification-api's shared-secret
 *      `/api/v1/reports/smoke/email` endpoint (reused — no new endpoint).
 *   5. Exit with the Playwright exit code so `kubectl get jobs` reflects
 *      pass/fail.
 *
 * Steps 3 + 4 are best-effort: a failure there is logged but does NOT change
 * the exit code — the test result is what matters, and the Job logs always
 * carry the report locally. Per the parent design's failure-mode matrix.
 *
 * Env contract (set by the Job manifest):
 *   E2E_TARGET                 staging | prod
 *   E2E_SUITE                  Playwright path/args, default "tests"
 *   S3_ENDPOINT                http://seaweedfs-s3.dloizides.svc.cluster.local:8333
 *   S3_BUCKET                  e2e-canary-results
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   SeaweedFS S3 creds
 *   AWS_REGION                 us-east-1 (SeaweedFS ignores it but awscli wants one)
 *   NOTIFY_SUMMARY_URL         http://notification-api.dloizides.svc.cluster.local:8080/api/v1/reports/smoke/email
 *   SMOKE_SHARED_SECRET        shared secret for the X-Smoke-Secret header
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = path.resolve(SCRIPT_DIR, '..');
const RESULTS_JSON = path.join(E2E_ROOT, 'reports', 'results.json');
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

function runPlaywright(suite) {
  const args = ['playwright', 'test', ...suite.split(/\s+/).filter(Boolean)];
  log(`npx ${args.join(' ')}`);
  const result = spawnSync('npx', args, {
    cwd: E2E_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  // spawnSync exposes the signal-kill case via result.signal; treat any
  // non-zero/!=null as failure.
  return result.status === null ? 1 : result.status;
}

/** Recursively tally pass/fail/skip per top-level suite from the JSON report. */
function summarize() {
  const fallback = {
    total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0,
    durationMs: 0, perSuite: [], reportAvailable: false,
  };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  } catch (e) {
    log(`WARN: could not read ${RESULTS_JSON}: ${e instanceof Error ? e.message : e}`);
    return fallback;
  }

  const stats = raw.stats ?? {};
  const summary = {
    total: (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.skipped ?? 0),
    passed: stats.expected ?? 0,
    failed: stats.unexpected ?? 0,
    skipped: stats.skipped ?? 0,
    flaky: stats.flaky ?? 0,
    durationMs: Math.round(stats.duration ?? 0),
    perSuite: [],
    reportAvailable: true,
  };

  // Per top-level suite breakdown. `spec.ok` is Playwright's authoritative
  // "did this spec ultimately pass" flag — true even for a flaky spec that
  // passed on retry — so classify by it, not by raw per-attempt statuses.
  function walkSpecs(node, acc) {
    for (const spec of node.specs ?? []) {
      const statuses = (spec.tests ?? []).flatMap((t) =>
        (t.results ?? []).map((r) => r.status),
      );
      if (statuses.length === 0) continue;
      if (statuses.every((s) => s === 'skipped')) acc.skipped += 1;
      else if (spec.ok === false) acc.failed += 1;
      else acc.passed += 1;
    }
    for (const child of node.suites ?? []) walkSpecs(child, acc);
  }
  for (const top of raw.suites ?? []) {
    const acc = { passed: 0, failed: 0, skipped: 0 };
    walkSpecs(top, acc);
    summary.perSuite.push({ title: top.title ?? '(unnamed)', ...acc });
  }

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

  // Make the bucket (idempotent — ignore "already exists/owned").
  spawnSync('aws', ['s3', 'mb', `s3://${bucket}`, ...awsBase], { encoding: 'utf8' });

  // summary.json — the machine-readable per-run record. The notification-api
  // Daily Report "Canary Activity" collector reads ONLY this file per run
  // (never the HTML report). Keep its shape stable; it is a contract.
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
    [TRACES_DIR, 'traces', true],
    [summaryFile, 'summary.json', false],
  ]) {
    if (!fs.existsSync(src)) {
      log(`WARN: ${src} does not exist — nothing to upload for '${dst}'.`);
      continue;
    }
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
  return uploadedAny ? `${prefix}/report/index.html` : null;
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
    lines.push('## Per-suite');
    lines.push('');
    lines.push('| Suite | Passed | Failed | Skipped |');
    lines.push('|---|---|---|---|');
    for (const s of summary.perSuite) {
      lines.push(`| ${s.title} | ${s.passed} | ${s.failed} | ${s.skipped} |`);
    }
    lines.push('');
  }
  if (!summary.reportAvailable) {
    lines.push('> reports/results.json was missing — counts above are zeros. ' +
      'The Playwright run may have crashed before writing the JSON report.');
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
  const suite = process.env.E2E_SUITE ?? 'tests';
  const runId = ensureRunId();

  log(`target=${target} suite=${suite} runId=${runId}`);

  const exitCode = runPlaywright(suite);
  log(`playwright exited with code ${exitCode}`);

  const summary = summarize();
  const reportPath = uploadToS3(runId, target, summary);
  await postSummary(summary, runId, target, reportPath);

  // The Playwright exit code is the Job's exit code — pass/fail visible in
  // `kubectl get jobs`. S3/email failures above never override it.
  process.exit(exitCode);
}

main().catch((e) => {
  log(`FATAL: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
