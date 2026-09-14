// AM-READY-10 — GDELT page QA over the DEPLOYED aml-v2 console (staging IS AML production).
//
// A headless re-run of the browser QA that the MCP browsers could not do (task doc "## GDELT page QA
// 2026-09-14"). Six checks, each a real assertion, never a screenshot alone:
//   QA-1 GET index-state answers 200 fast (it answered 500 after 32 s on 2026-09-13).
//   QA-2 ONE "No backfill workers are running" line; slots without a live lease fold behind ONE control.
//   QA-3 no "Not reported" copy; the three config rows the API stopped reporting are gone (ccaf5cf).
//   QA-4 two job-feed poll cycles do not pile up backfill-progress requests; the state line holds.
//   QA-5 zero console errors, zero first-party 4xx/5xx.
//   QA-6 400 px viewport: nothing wider than the screen on /gdelt and /adverse-media.
//
// Sign-in reuses the screening-100 harness (one login per runner, storage state outside test-results/).
// Selectors are the aml-v2 testIDs (src/screens/gdelt/BackfillWorkerTable.tsx, BackfillConfigPanel.tsx,
// src/screens/adverseMedia/MentionFilters.tsx); copy is src/i18n/catalogs/en/gdelt.ts verbatim.
// Run: AML_E2E_PROJECT=aml-ui node scripts/run-aml-e2e.mjs tests/aml/aml-gdelt-page-qa.spec.ts --reporter=list
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { AML_WEB_ORIGIN, HAS_TESTER, openSession, runnerStateFile } from './screening-100-harness.js';
import { findWidthOffenders, observePage, occurrences, type Observed } from './gdelt-page-qa-probes.js';

const SHOT_DIR = process.env.AML_QA_SHOT_DIR ?? join(process.cwd(), '.aml-screening-100', 'gdelt-qa');
const GDELT_URL = `${AML_WEB_ORIGIN}/app/gdelt`;
const ADVERSE_MEDIA_URL = `${AML_WEB_ORIGIN}/app/adverse-media`;
const INDEX_STATE_PATH = '/bff/api/aml/v1/adverse-media/index-state';
const CSRF = { 'X-BFF-Csrf': '1' };
const HTTP_OK = 200;
/** A third of the 32 s the endpoint took before the fix: anything slower is the old path coming back. */
const INDEX_STATE_BUDGET_MS = 10_000;
const REQUEST_TIMEOUT_MS = 45_000;
const READY_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 240_000;
/** POLL_IDLE_MS is 15 s (src/screens/jobs/jobFormat.ts:21); two cycles plus a load-time fetch fit. */
const POLL_WINDOW_MS = 90_000;
const POLL_CYCLES = 2;
const NARROW = { width: 400, height: 900 };

const FLEET_NONE =
  /^No backfill workers are running\. None of the \d+ worker slots holds a live lease, so nothing is being indexed and no rate is measured\./;
const FLEET_NONE_HEAD = 'No backfill workers are running';
const INACTIVE_TITLE = /^(\d+) worker slots without a live lease \((\d+) stale, (\d+) free\)$/;
const NOT_REPORTED = 'Not reported';
const CONFIG_PRESENT_LABEL = 'Workers per pod (configured)';
const REMOVED_CONFIG_LABELS = ['Download cap per pod', 'CPU high watermark', 'Coverage publish interval'];
const CONFIG_GROUPS = ['gdelt-backfill-config-parallelism', 'gdelt-backfill-config-cadence'];

let context: BrowserContext;

async function openGdelt(page: Page): Promise<void> {
  await page.goto(GDELT_URL, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
  await expect(page.getByTestId('gdelt-backfill-fleet-state')).toBeVisible({ timeout: READY_TIMEOUT_MS });
}

async function expand(page: Page, testId: string): Promise<void> {
  const header = page.getByTestId(testId);
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

/** Measurements go to the report AND to a JSONL beside the screenshots: the `list` reporter prints neither. */
function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
  appendFileSync(join(SHOT_DIR, 'measurements.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), type, description })}\n`);
}

test.describe('AM-READY-10 GDELT page QA — signed-in tester on the deployed console', () => {
  test.skip(!HAS_TESTER, 'AML_TESTER_EMAIL / AML_TESTER_PASSWORD unset (PROOViD/AMLService/.env) — nothing to observe.');
  test.describe.configure({ timeout: TEST_TIMEOUT_MS });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    mkdirSync(SHOT_DIR, { recursive: true });
    context = await openSession(browser, runnerStateFile('gdelt-page-qa.storage.json'));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('QA-1 GET adverse-media/index-state answers 200 inside the latency budget', async () => {
    const started = Date.now();
    const res = await context.request.get(`${AML_WEB_ORIGIN}${INDEX_STATE_PATH}`, {
      headers: CSRF,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const ms = Date.now() - started;
    note('index-state', `HTTP ${res.status()} in ${ms} ms`);
    expect(res.status(), `index-state answered HTTP ${res.status()} in ${ms} ms`).toBe(HTTP_OK);
    expect(ms, `index-state took ${ms} ms`).toBeLessThan(INDEX_STATE_BUDGET_MS);
  });

  test('QA-2 one fleet-state line; inactive slots fold behind one control that expands to their rows', async () => {
    const page = await context.newPage();
    await openGdelt(page);
    const fleet = page.getByTestId('gdelt-backfill-fleet-state');
    await expect(fleet).toHaveCount(1);
    await expect(fleet).toContainText(FLEET_NONE);
    expect(occurrences(await page.locator('body').innerText(), FLEET_NONE_HEAD)).toBe(1);

    await expect(page.getByTestId('gdelt-backfill-inactive-accordion')).toHaveCount(1);
    const header = page.getByTestId('gdelt-backfill-inactive-slots');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    const title = (await header.getAttribute('aria-label')) ?? '';
    const parts = INACTIVE_TITLE.exec(title);
    if (parts === null) throw new Error(`fold control title "${title}" does not match ${INACTIVE_TITLE}`);
    const [count, stale, free] = parts.slice(1).map(Number);
    note('inactive-slots', title);
    expect(count, 'fold control holds no slots').toBeGreaterThan(0);
    expect(stale + free, `title "${title}": stale + free != count`).toBe(count);
    await shot(page, 'qa2-gdelt-folded');

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const table = page.getByTestId('gdelt-backfill-inactive-table');
    await expect(table).toBeVisible();
    await expect(table.getByText(/^Slot \d+$/)).toHaveCount(count);
    await shot(page, 'qa2-gdelt-expanded');
    await page.close();
  });

  test('QA-3 no "Not reported" copy and none of the three removed config rows', async () => {
    const page = await context.newPage();
    await openGdelt(page);
    for (const group of CONFIG_GROUPS) await expand(page, group);
    // Positive control: the config rows ARE rendered, so the absences below are not a blank panel.
    await expect(page.getByText(CONFIG_PRESENT_LABEL, { exact: true })).toBeVisible();
    const text = await page.locator('body').innerText();
    const lines = text.split('\n').filter(line => line.includes(NOT_REPORTED));
    expect(occurrences(text, NOT_REPORTED), `"Not reported" lines: ${JSON.stringify(lines)}`).toBe(0);
    expect(text).not.toContain(`(${NOT_REPORTED})`);
    for (const label of REMOVED_CONFIG_LABELS) expect(text, `removed config row "${label}"`).not.toContain(label);
    await shot(page, 'qa3-gdelt-config-expanded');
    await page.close();
  });

  test('QA-4 two job-feed poll cycles: no backfill-progress pile-up, fleet line unchanged', async () => {
    const page = await context.newPage();
    const seen = observePage(page, AML_WEB_ORIGIN);
    await openGdelt(page);
    await expect.poll(() => seen.jobFeed.length, { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(0);
    const fleet = page.getByTestId('gdelt-backfill-fleet-state');
    const before = await fleet.innerText();
    const jobs0 = seen.jobFeed.length;
    const progress0 = seen.progress.length;
    await expect
      .poll(() => seen.jobFeed.length - jobs0, { timeout: POLL_WINDOW_MS, message: 'job feed did not poll twice' })
      .toBeGreaterThanOrEqual(POLL_CYCLES);
    const cycles = seen.jobFeed.length - jobs0;
    const progress = seen.progress.length - progress0;
    note('poll', `${cycles} job-feed cycles, ${progress} backfill-progress requests`);
    expect(progress, `backfill-progress requests over ${cycles} cycles`).toBeLessThanOrEqual(cycles + 1);
    expect(await fleet.innerText()).toBe(before);
    await page.close();
  });

  test('QA-5 /gdelt and /adverse-media: zero console errors, zero first-party 4xx/5xx', async () => {
    // One page per screen, asserted BEFORE it closes: navigating /gdelt away aborts its in-flight poll
    // (net::ERR_ABORTED on backfill/progress, measured 2026-09-14) — the harness's abort, not the product's.
    const gdelt = await context.newPage();
    const gdeltSeen: Observed = observePage(gdelt, AML_WEB_ORIGIN);
    await openGdelt(gdelt);
    await expect.poll(() => gdeltSeen.jobFeed.length, { timeout: POLL_WINDOW_MS }).toBeGreaterThan(1);
    expect(gdeltSeen.consoleErrors, '/gdelt console errors').toEqual([]);
    expect(gdeltSeen.badResponses, '/gdelt first-party 4xx/5xx or failed requests').toEqual([]);

    const media = await context.newPage();
    const mediaSeen: Observed = observePage(media, AML_WEB_ORIGIN);
    // The screen's own list fetch (mentions?pageSize=50) must have landed, so its status is observed.
    const mentions = media.waitForResponse(res => res.url().includes('mentions'), { timeout: READY_TIMEOUT_MS });
    await media.goto(ADVERSE_MEDIA_URL, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
    await mentions;
    await expect(media.getByTestId('am-filters')).toBeVisible({ timeout: READY_TIMEOUT_MS });
    expect(mediaSeen.consoleErrors, '/adverse-media console errors').toEqual([]);
    expect(mediaSeen.badResponses, '/adverse-media first-party 4xx/5xx or failed requests').toEqual([]);
    await media.close();
    await gdelt.close();
  });

  const narrowTargets = [
    { name: 'gdelt', url: GDELT_URL, ready: 'gdelt-backfill-fleet-state', fold: 'gdelt-backfill-inactive-slots' },
    { name: 'adverse-media', url: ADVERSE_MEDIA_URL, ready: 'am-filters', fold: null },
  ];
  for (const target of narrowTargets) {
    test(`QA-6 /${target.name} at 400 px: no horizontal overflow, no element past the right edge`, async () => {
      const page = await context.newPage();
      await page.setViewportSize(NARROW);
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
      await expect(page.getByTestId(target.ready)).toBeVisible({ timeout: READY_TIMEOUT_MS });
      if (target.fold !== null) await expand(page, target.fold);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const result = await findWidthOffenders(page, NARROW.width);
      note(`narrow-${target.name}`, `scrollWidth=${scrollWidth}; contained=${JSON.stringify(result.contained)}`);
      await shot(page, `qa6-${target.name}-400px`);
      expect(scrollWidth, 'document scrollWidth').toBeLessThanOrEqual(NARROW.width);
      expect(result.offenders, 'elements past the 400 px edge (testID right=px)').toEqual([]);
      if (target.name === 'adverse-media') {
        const range = page.locator('[data-testid^="am-filter-captured"]');
        expect(await range.count(), 'date-range filter not rendered').toBeGreaterThan(0);
        const boxes = await range.evaluateAll(els => els.map(el => el.getBoundingClientRect().right));
        for (const right of boxes) expect(right, 'date-range filter right edge').toBeLessThanOrEqual(NARROW.width);
      }
      await page.close();
    });
  }
});
