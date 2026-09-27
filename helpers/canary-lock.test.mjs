// Unit tests for the canary lock staleness rules (TEST-5MIN-1b "Indexed Jobs per target").
// Run: node --test helpers/canary-lock.test.mjs   (Node >= 22.18 strips the .ts types natively)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INDEXED_LOCK_TTL_MS,
  INDEXED_MAX_WAIT_MS,
  LOCK_TTL_MS,
  decideOnHeldLock,
  deletePreconditionBody,
  lockTtlMs,
  parseLockJson,
  resolveTakeover,
} from './canary-lock-policy.ts';

const T0 = Date.parse('2026-09-27T08:00:00Z');
const at = (ms) => new Date(T0 + ms).toISOString();

test('an indexed pod writes the short TTL, any other run the 30 min one', () => {
  assert.equal(lockTtlMs({ E2E_GROUP_INDEX: '3' }), INDEXED_LOCK_TTL_MS);
  assert.equal(lockTtlMs({}), LOCK_TTL_MS);
  assert.ok(INDEXED_LOCK_TTL_MS < 6 * 60_000, 'a killed pod must not block the next group for long');
});

test('a lock left by a pod killed at 330 s is reclaimed by the next group', () => {
  const d = decideOnHeldLock(at(0), String(INDEXED_LOCK_TTL_MS), T0 + INDEXED_LOCK_TTL_MS + 1, true);
  assert.deepEqual(d, { action: 'reclaim' });
});

test('an indexed acquirer waits out a lock that expires soon instead of failing its group', () => {
  const d = decideOnHeldLock(at(0), String(INDEXED_LOCK_TTL_MS), T0 + INDEXED_LOCK_TTL_MS - 10_000, true);
  assert.deepEqual(d, { action: 'wait', ms: 10_000 });
});

test('a live holder is refused when expiry is further than the max wait', () => {
  const d = decideOnHeldLock(at(0), String(INDEXED_LOCK_TTL_MS), T0 + 1_000, true);
  assert.equal(d.action, 'refuse');
  assert.ok(INDEXED_LOCK_TTL_MS - 1_000 > INDEXED_MAX_WAIT_MS);
});

test("the HOLDER's TTL rules: an indexed pod never reclaims a long run's lock early", () => {
  const legacy = decideOnHeldLock(at(0), undefined, T0 + INDEXED_LOCK_TTL_MS + 1, true);
  assert.equal(legacy.action, 'refuse');
  const long = decideOnHeldLock(at(0), String(LOCK_TTL_MS), T0 + INDEXED_LOCK_TTL_MS + 1, true);
  assert.equal(long.action, 'refuse');
  assert.deepEqual(decideOnHeldLock(at(0), undefined, T0 + LOCK_TTL_MS, false), { action: 'reclaim' });
});

test('a non-indexed acquirer never waits, and a garbage startedAt is reclaimed', () => {
  const d = decideOnHeldLock(at(0), String(INDEXED_LOCK_TTL_MS), T0 + INDEXED_LOCK_TTL_MS - 10_000, false);
  assert.equal(d.action, 'refuse');
  assert.deepEqual(decideOnHeldLock('not-a-date', undefined, T0, true), { action: 'reclaim' });
  assert.deepEqual(decideOnHeldLock(at(0), 'abc', T0 + LOCK_TTL_MS, true), { action: 'reclaim' });
});

// --- compare-and-delete race (code review, TEST-5MIN-1b) ---
const soonStale = { runId: 'A', startedAt: at(0), ttlMs: String(INDEXED_LOCK_TTL_MS), uid: 'u-A', resourceVersion: '7' };
const freshLong = { runId: 'B', startedAt: at(INDEXED_LOCK_TTL_MS - 5_000), ttlMs: String(LOCK_TTL_MS), uid: 'u-B', resourceVersion: '9' };

function scripted(reads) {
  let clock = T0 + INDEXED_LOCK_TTL_MS - 10_000;
  const sleeps = [];
  const queue = [...reads];
  return {
    read: () => queue.shift() ?? null,
    now: () => clock,
    sleep: (ms) => { sleeps.push(ms); clock += ms; },
    sleeps,
  };
}

test('RACE: holder released during the wait and a fresh 30 min lock was taken -> refuse, never reclaim', () => {
  const s = scripted([soonStale, freshLong]);
  const plan = resolveTakeover(s.read, s.now, s.sleep, true);
  assert.deepEqual(s.sleeps, [10_000]);
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.held.runId, 'B');
});

test('after the wait the SAME stale lock is reclaimed, carrying its uid/resourceVersion', () => {
  const s = scripted([soonStale, soonStale]);
  const plan = resolveTakeover(s.read, s.now, s.sleep, true);
  assert.equal(plan.action, 'reclaim');
  assert.equal(plan.held.resourceVersion, '7');
});

test('lock gone after the wait -> create; at most one wait', () => {
  assert.deepEqual(resolveTakeover(scripted([soonStale]).read, scripted([]).now, () => {}, true), { action: 'create' });
  const s = scripted([soonStale, { ...soonStale, runId: 'C', startedAt: at(20_000) }]);
  const plan = resolveTakeover(s.read, s.now, s.sleep, true);
  assert.equal(s.sleeps.length, 1);
  assert.equal(plan.action, 'refuse');
});

test('the delete is conditional on exactly the lock judged stale', () => {
  const body = JSON.parse(deletePreconditionBody(soonStale));
  assert.deepEqual(body, { kind: 'DeleteOptions', apiVersion: 'v1', preconditions: { uid: 'u-A', resourceVersion: '7' } });
});

test('parseLockJson reads data + metadata from kubectl -o json', () => {
  const cm = { metadata: { uid: 'u', resourceVersion: '3' }, data: { runId: 'r', startedAt: at(0), runner: 'h', ttlMs: '330000' } };
  assert.deepEqual(parseLockJson(JSON.stringify(cm)), { runId: 'r', startedAt: at(0), runner: 'h', ttlMs: '330000', uid: 'u', resourceVersion: '3' });
  assert.equal(parseLockJson(''), null);
});
