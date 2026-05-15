/**
 * In-cluster canary orphan sweep — the `command:` for the
 * playwright-e2e orphan-cleanup CronJob
 * (`personalServerNotes/k8s/playwright-e2e/orphan-cleanup.cronjob.yml`).
 * Phase 4 of the e2e-multi-environment effort.
 *
 * The in-cluster complement to the dev-PC `scripts/canary-orphan-cleanup.ps1`
 * Tilt resource — runs weekly inside the cluster so cleanup happens even when
 * the dev PC is off. Three jobs:
 *
 *   1. STALE LOCK RELEASE — delete `canary-run-lock-{target}` if its
 *      `startedAt` is older than 30 min (a Job SIGKILL'd before its teardown
 *      ran leaves the lock held; nothing else would free it).
 *   2. KEYCLOAK e2ec-* USER SWEEP — mint a master-admin token, list users
 *      whose username contains `e2ec-` across every application realm, delete
 *      the ones older than CANARY_ORPHAN_AGE_HOURS (default 24h). A teardown
 *      crash, or the Job dying mid-run, leaks Keycloak users the per-runId
 *      cleanup endpoints never got to.
 *   3. SEAWEEDFS RETENTION — delete `s3://${S3_BUCKET}/` objects older than
 *      S3_RETENTION_DAYS (default 30). ~9 GB steady-state at 2 runs/day.
 *
 * DRY RUN: set CANARY_CLEANUP_DRY_RUN=true to log what WOULD be deleted
 * without deleting. The CronJob runs it for real (no dry-run env set).
 *
 * Env contract (set by the CronJob manifest):
 *   E2E_TARGET                  staging | prod  (selects the lock name)
 *   E2E_LOCK_KUBECTL            default "kubectl" (in-cluster ServiceAccount)
 *   E2E_LOCK_NAMESPACE          default "dloizides"
 *   KEYCLOAK_URL                http://keycloak.dloizides.svc.cluster.local:8080
 *   KEYCLOAK_MASTER_ADMIN_USER / KEYCLOAK_MASTER_ADMIN_PASSWORD
 *   CANARY_CLEANUP_REALMS       default "OnlineMenu,questioner,onlinemenu"
 *   CANARY_ORPHAN_AGE_HOURS     default 24
 *   S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *   S3_RETENTION_DAYS           default 30
 *   CANARY_CLEANUP_DRY_RUN      "true" → report only
 */
import { spawnSync } from 'node:child_process';

const DRY_RUN = (process.env.CANARY_CLEANUP_DRY_RUN ?? '').toLowerCase() === 'true';
const LOCK_TTL_MS = 30 * 60 * 1000;

function log(msg) {
  process.stdout.write(`[canary-cleanup] ${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[canary-cleanup] WARN: ${msg}\n`);
}

// ── 1. Stale lock release ────────────────────────────────────────────────
function resolveKubectl() {
  const raw = (process.env.E2E_LOCK_KUBECTL ?? 'kubectl').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return { bin: parts[0] ?? 'kubectl', args: parts.slice(1) };
}

function releaseStaleLock() {
  const target = process.env.E2E_TARGET ?? 'staging';
  const ns = process.env.E2E_LOCK_NAMESPACE ?? 'dloizides';
  const name = `canary-run-lock-${target}`;
  const k = resolveKubectl();

  const get = spawnSync(
    k.bin,
    [...k.args, 'get', 'configmap', name, '-n', ns, '-o', 'jsonpath={.data.startedAt}'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (get.error) {
    warn(`kubectl unavailable (${get.error.message}) — skipping stale-lock check.`);
    return;
  }
  if (get.status !== 0) {
    if (/not\s*found/i.test(get.stderr ?? '')) {
      log(`no lock ${name} held — nothing to release.`);
    } else {
      warn(`could not read lock ${name}: ${(get.stderr ?? '').trim()}`);
    }
    return;
  }

  const startedAt = (get.stdout ?? '').trim();
  const startedMs = Date.parse(startedAt);
  const ageMs = Number.isNaN(startedMs) ? Number.POSITIVE_INFINITY : Date.now() - startedMs;
  if (ageMs < LOCK_TTL_MS) {
    log(`lock ${name} is fresh (started ${startedAt}, ~${Math.round(ageMs / 60_000)} min ago) — leaving it.`);
    return;
  }

  log(`lock ${name} is STALE (started ${startedAt}) — ${DRY_RUN ? 'WOULD release' : 'releasing'}.`);
  if (DRY_RUN) return;
  const del = spawnSync(
    k.bin,
    [...k.args, 'delete', 'configmap', name, '-n', ns, '--ignore-not-found'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (del.status !== 0) warn(`failed to release stale lock: ${(del.stderr ?? '').trim()}`);
  else log(`released stale lock ${name}.`);
}

// ── 2. Keycloak e2ec-* user sweep ────────────────────────────────────────
async function mintAdminToken(kcBase) {
  const user = process.env.KEYCLOAK_MASTER_ADMIN_USER;
  const pass = process.env.KEYCLOAK_MASTER_ADMIN_PASSWORD;
  if (!user || !pass) {
    warn('KEYCLOAK_MASTER_ADMIN_USER/PASSWORD unset — skipping Keycloak sweep.');
    return null;
  }
  const url = `${kcBase}/realms/master/protocol/openid-connect/token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: user,
      password: pass,
    }).toString(),
  });
  if (!resp.ok) {
    warn(`Keycloak master token mint failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    return null;
  }
  const json = await resp.json();
  return json.access_token ?? null;
}

async function sweepRealm(kcBase, token, realm, cutoffMs) {
  // Keycloak `search` is a substring match across username/email/name.
  const url = `${kcBase}/admin/realms/${encodeURIComponent(realm)}/users` +
    `?search=e2ec-&max=1000`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    warn(`realm '${realm}': user list failed HTTP ${resp.status} — skipping.`);
    return { scanned: 0, deleted: 0, kept: 0 };
  }
  const users = await resp.json();
  let deleted = 0;
  let kept = 0;
  for (const u of users) {
    // Only sweep names that genuinely match the reserved canary prefix shape.
    if (!/^e2ec-[0-9a-f]{8}-/i.test(u.username ?? '')) continue;
    const createdMs = typeof u.createdTimestamp === 'number' ? u.createdTimestamp : 0;
    if (createdMs > cutoffMs) {
      kept += 1; // younger than the age threshold — an in-flight run may own it
      continue;
    }
    if (DRY_RUN) {
      log(`realm '${realm}': WOULD delete user ${u.username} (id=${u.id})`);
      deleted += 1;
      continue;
    }
    const del = await fetch(
      `${kcBase}/admin/realms/${encodeURIComponent(realm)}/users/${u.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    if (del.ok) {
      deleted += 1;
      log(`realm '${realm}': deleted user ${u.username}`);
    } else {
      warn(`realm '${realm}': delete of ${u.username} failed HTTP ${del.status}`);
    }
  }
  return { scanned: users.length, deleted, kept };
}

async function keycloakSweep() {
  const kcBase = (process.env.KEYCLOAK_URL ?? '').replace(/\/+$/, '');
  if (!kcBase) {
    warn('KEYCLOAK_URL unset — skipping Keycloak sweep.');
    return;
  }
  const token = await mintAdminToken(kcBase);
  if (!token) return;

  const ageHours = Number(process.env.CANARY_ORPHAN_AGE_HOURS ?? 24);
  const cutoffMs = Date.now() - ageHours * 60 * 60 * 1000;
  const realms = (process.env.CANARY_CLEANUP_REALMS ?? 'OnlineMenu,questioner,onlinemenu')
    .split(',').map((r) => r.trim()).filter(Boolean);

  let totalDeleted = 0;
  for (const realm of realms) {
    const r = await sweepRealm(kcBase, token, realm, cutoffMs);
    log(`realm '${realm}': scanned ${r.scanned}, ${DRY_RUN ? 'would delete' : 'deleted'} ${r.deleted}, kept ${r.kept} (younger than ${ageHours}h)`);
    totalDeleted += r.deleted;
  }
  log(`Keycloak sweep: ${DRY_RUN ? 'would delete' : 'deleted'} ${totalDeleted} orphan e2ec-* user(s) across ${realms.length} realm(s).`);
}

// ── 3. SeaweedFS retention ───────────────────────────────────────────────
function s3Retention() {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET ?? 'e2e-canary-results';
  if (!endpoint) {
    warn('S3_ENDPOINT unset — skipping SeaweedFS retention.');
    return;
  }
  const retentionDays = Number(process.env.S3_RETENTION_DAYS ?? 30);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString();
  const awsBase = ['--endpoint-url', endpoint];

  const list = spawnSync(
    'aws',
    ['s3api', 'list-objects-v2', '--bucket', bucket, ...awsBase,
      '--query', `Contents[?LastModified<='${cutoff}'].Key`, '--output', 'text'],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (list.status !== 0) {
    // A missing bucket is fine — nothing has been uploaded yet.
    const err = (list.stderr || list.error?.message || '').toString().trim();
    if (/NoSuchBucket|Not\s*Found/i.test(err)) log(`bucket ${bucket} does not exist yet — nothing to retain.`);
    else warn(`S3 list failed: ${err}`);
    return;
  }
  const keys = (list.stdout ?? '').split(/\s+/).map((k) => k.trim()).filter((k) => k && k !== 'None');
  if (keys.length === 0) {
    log(`SeaweedFS retention: no objects older than ${retentionDays} days.`);
    return;
  }
  log(`SeaweedFS retention: ${keys.length} object(s) older than ${retentionDays} days — ${DRY_RUN ? 'WOULD delete' : 'deleting'}.`);
  if (DRY_RUN) {
    for (const k of keys.slice(0, 20)) log(`  WOULD delete s3://${bucket}/${k}`);
    return;
  }
  let removed = 0;
  for (const key of keys) {
    const rm = spawnSync('aws', ['s3', 'rm', `s3://${bucket}/${key}`, '--only-show-errors', ...awsBase],
      { encoding: 'utf8', timeout: 60_000 });
    if (rm.status === 0) removed += 1;
    else warn(`failed to delete s3://${bucket}/${key}: ${(rm.stderr ?? '').trim()}`);
  }
  log(`SeaweedFS retention: deleted ${removed}/${keys.length} object(s).`);
}

async function main() {
  log(`starting${DRY_RUN ? ' (DRY RUN)' : ''} — target=${process.env.E2E_TARGET ?? 'staging'}`);
  releaseStaleLock();
  await keycloakSweep();
  s3Retention();
  log('done.');
}

main().catch((e) => {
  warn(`FATAL: ${e instanceof Error ? e.stack : e}`);
  // A cleanup failure should surface as a red Job, but never throw uncaught.
  process.exit(1);
});
