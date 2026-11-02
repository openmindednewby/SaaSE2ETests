import { expect, test, type Page } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import {
  chooseFile,
  longestFrameMs,
  makePhoto,
  openPhotoTab,
  resetFrameWatch,
  VISIBLE_TEXT,
  watchMainThread,
} from './helpers/photo';
import { DESKTOP, PHONE, readLayoutProblems } from './helpers/screens';

const BUDGET_MS = 3000;
const LONGEST_FRAME_MS = 200;
const WAIT_FOR_VERDICT_MS = 30_000;
const CHART_DONE = 'Chart made from your photo.';
const BEADS_WIDE = 40;
const ROWS_FROM_4_BY_3 = 30;

async function fillsAtChartEdges(page: Page): Promise<{ left: string; right: string }> {
  return page.getByTestId('jinx-generator-preview').evaluate((chart) => {
    const box = chart.getBoundingClientRect();
    const beads = [...chart.querySelectorAll<HTMLElement>('div')].filter((el) => {
      const rect = el.getBoundingClientRect();
      const paint = getComputedStyle(el).backgroundColor;
      return rect.width > 0 && rect.width < box.width / 10 && paint !== 'rgba(0, 0, 0, 0)';
    });
    const sorted = beads.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return {
      left: getComputedStyle(sorted[0]).backgroundColor,
      right: getComputedStyle(sorted[sorted.length - 1]).backgroundColor,
    };
  });
}

test.describe('phone', () => {
  test.use(PHONE);

  test('AC-35 Generator photo tab, Run on 360x640 device descriptor, Finishes under 3 s for a 12 MP input, main thread stays responsive (worker)', async ({ page, context }) => {
    const path = test.info().outputPath('photo-12mp.jpg');
    await makePhoto(page, path);
    await watchMainThread(page);
    const workerChunks: { url: string; status: number; type: string }[] = [];
    context.on('response', (response) => {
      if (/\.js(\?|$)/.test(response.url())) workerChunks.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] ?? '' });
    });
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await openPhotoTab(page);
    const before = await page.getByTestId('jinx-generator-result').innerText();
    await resetFrameWatch(page);
    const started = Date.now();

    await chooseFile(page, 'jinx-photo-choose', path);

    await expect(page.getByTestId('jinx-photo-status')).toHaveText(CHART_DONE, { timeout: WAIT_FOR_VERDICT_MS });
    const elapsed = Date.now() - started;
    const stall = await longestFrameMs(page);
    const after = await page.getByTestId('jinx-generator-result').innerText();
    const edges = await fillsAtChartEdges(page);
    const chunk = workerChunks.find((candidate) => workers.includes(candidate.url));
    console.log(`MEASURED chart ${elapsed} ms, longest frame ${Math.round(stall)} ms, worker ${workers.join(' ')}, chunk ${JSON.stringify(chunk)}, result ${after.slice(0, 60)}, edges ${JSON.stringify(edges)}`);
    expect(workers.length, 'no Worker started').toBeGreaterThan(0);
    expect(chunk?.status, `worker chunk response for ${workers.join(' ')}`).toBe(200);
    expect(chunk?.type).toMatch(/javascript/);
    expect(after).not.toEqual(before);
    expect(after).toContain(`${BEADS_WIDE * ROWS_FROM_4_BY_3} beads`);
    expect(edges.left, 'the chart does not follow the two-colour photo').not.toEqual(edges.right);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(stall).toBeLessThan(LONGEST_FRAME_MS);
  });
});

for (const viewport of [{ label: '360x640', use: PHONE }, { label: '1280x800', use: DESKTOP }]) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-51 photo tab before a photo at ${viewport.label}, Walk, expectTextFits passes; no horizontal scroll; hit boxes >= 44`, async ({ page }) => {
      await openPhotoTab(page);

      const problems = await readLayoutProblems(page);

      expect.soft(problems).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });

    test(`AC-51 photo tab with a finished chart at ${viewport.label}, Walk, expectTextFits passes; no horizontal scroll; hit boxes >= 44`, async ({ page }) => {
      const path = test.info().outputPath('photo-12mp.jpg');
      await makePhoto(page, path);
      await openPhotoTab(page);

      await chooseFile(page, 'jinx-photo-choose', path);

      await expect(page.getByTestId('jinx-photo-status')).toHaveText(CHART_DONE, { timeout: WAIT_FOR_VERDICT_MS });
      expect.soft(await readLayoutProblems(page)).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}
