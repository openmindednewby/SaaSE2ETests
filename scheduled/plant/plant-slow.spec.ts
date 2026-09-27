/**
 * PLANTED NEGATIVE CONTROL — TEST-5MIN-1b "Indexed Jobs per target".
 *
 * Proves that a scheduled pod whose tests overrun is cut by Playwright's own 270 s globalTimeout
 * (playwright.scheduled.ts) and STILL uploads its JSON/HTML report, before the 330 s pod deadline.
 *
 * Reachable ONLY through E2E_GROUP_INDEX=plant (project `scheduled-plant-slow`, which exists only in
 * that mode and is in no numbered group of scheduled/scheduled-groups.json). The slow test also
 * skips unless E2E_PLANT_SLOW=1, so an accidental selection costs nothing.
 *
 * Expected result with both set: the run ends at ~270 s, exit code non-zero, reports/results.json +
 * reports/html exist and are uploaded, the fast marker test is recorded as passed.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { expect, test } from '@playwright/test';

const PLANT_SLEEP_MS = 400_000;
/** Above the sleep so the per-test cap cannot fire first — the globalTimeout must be what cuts. */
const PLANT_TEST_TIMEOUT_MS = 500_000;
const planted = process.env.E2E_PLANT_SLOW === '1';

test.describe('TEST-5MIN-1b planted slow group', () => {
  test.skip(!planted, 'planted 400 s control only runs with E2E_PLANT_SLOW=1');

  test('fast marker is recorded in the cut report', () => {
    expect(planted, 'marker test must only run under E2E_PLANT_SLOW=1').toBe(true);
  });

  test('sleeps 400 s so the 270 s globalTimeout must cut the run', async () => {
    test.setTimeout(PLANT_TEST_TIMEOUT_MS);
    // Deliberate wall-clock sleep: this test exists to overrun, it waits on nothing.
    await sleep(PLANT_SLEEP_MS);
  });
});
