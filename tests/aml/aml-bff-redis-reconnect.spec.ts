// BFF-REDIS-1 "Redis resilience" — a bff-aml process that boots while Redis is unreachable must
// serve Redis again once Redis returns. The defect it guards: `new Lazy<IConnectionMultiplexer>`
// cached the first failed connect forever, so a ~4s gap at pod start became a permanent 500 with the
// pod still 1/1 Ready (fixed in Bff.AspNetCore BffRedisConnection, shipped in 1.19.6).
//
// OPT-IN, because it controls staging infra: AML_BFF_REDIS_OUTAGE=1 plus `ssh jim@10.0.0.2` with
// NOPASSWD `sudo kubectl` (override with STAGING_SSH / AML_BFF_NAMESPACE). Without the flag it skips.
//   AML_BFF_REDIS_OUTAGE=1 npx playwright test --project=aml-api tests/aml/aml-bff-redis-reconnect.spec.ts
//
// The shared staging Redis is NEVER stopped: only a throwaway pod (same image + env as bff-aml) sees
// the outage, via a private stand-in Service — see bff-redis-outage-harness.ts. Teardown runs in
// `finally`, and every run first sweeps leftovers of a killed run.
//
// The observation is GET /health/ready, which dereferences the same BffRedisConnection the session
// store and the DataProtection key ring use and issues a real PING.
import { expect, test } from '@playwright/test';
import { BffRedisOutageProbe, HealthPath } from './bff-redis-outage-harness';

const OPT_IN = process.env.AML_BFF_REDIS_OUTAGE === '1';
const BOOT_WITHIN_MS = 60_000;
const RECOVER_WITHIN_MS = 30_000;
const TEST_TIMEOUT_MS = 240_000;
const POLL_INTERVALS_MS = [500, 1_000, 2_000];

test.describe('BFF-REDIS-1 "Redis resilience" — bff-aml reconnects after a Redis outage', () => {
  test.skip(!OPT_IN, 'controls staging infra: set AML_BFF_REDIS_OUTAGE=1 (needs ssh + sudo kubectl on staging)');
  test.setTimeout(TEST_TIMEOUT_MS);

  test('BFF-REDIS-1 AC-1: a bff-aml that booted with Redis unreachable answers /health/ready once Redis returns', async ({ request: _request }, testInfo) => {
    const probe = new BffRedisOutageProbe();
    probe.sweep();
    try {
      probe.startWithRedisUnreachable();

      await expect
        .poll(() => probe.health(HealthPath.Live).ok, {
          message: `${probe.podName} never answered /health/live while Redis was unreachable — the BFF did not boot without Redis`,
          timeout: BOOT_WITHIN_MS,
          intervals: POLL_INTERVALS_MS,
        })
        .toBe(true);

      const whileDown = probe.health(HealthPath.Ready);
      expect(
        whileDown.ok,
        `/health/ready returned OK with Redis unreachable, so the outage was not observed: ${whileDown.output.trim()}`,
      ).toBe(false);

      probe.restoreRedis();
      const restoredAt = Date.now();

      await expect
        .poll(() => probe.health(HealthPath.Ready).ok, {
          message: `${probe.podName} still failed /health/ready ${RECOVER_WITHIN_MS}ms after Redis returned — a failed connect is cached (the Lazy<T> defect)`,
          timeout: RECOVER_WITHIN_MS,
          intervals: POLL_INTERVALS_MS,
        })
        .toBe(true);

      testInfo.annotations.push({ type: 'recovery-ms', description: String(Date.now() - restoredAt) });
    } finally {
      await testInfo.attach('probe-pod.log', { body: probe.logs(), contentType: 'text/plain' });
      probe.teardown();
    }
  });
});
