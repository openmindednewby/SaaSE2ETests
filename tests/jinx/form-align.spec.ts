import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectFieldsAligned } from '@dloizides/e2e-helpers';

import { DESKTOP, PHONE } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const FIELDS = ['stitch-trigger', 'motif-trigger', 'width', 'rows', 'colours-trigger', 'variation'].map((field) => `jinx-generator-${field}`);
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];

async function visualRows(page: Page): Promise<string[][]> {
  const rows: { top: number; bottom: number; ids: string[] }[] = [];
  for (const id of FIELDS) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} has no box`).not.toBeNull();
    const top = box?.y ?? 0;
    const bottom = top + (box?.height ?? 0);
    const row = rows.find((candidate) => top < candidate.bottom && bottom > candidate.top);
    if (row === undefined) rows.push({ top, bottom, ids: [id] });
    else row.ids.push(id);
  }
  return rows.map((row) => row.ids);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-52 Generator form at ${viewport.label}, Measure, expectFieldsAligned passes (1 px)`, async ({ page }) => {
      await page.goto(`${APP_URL}/make`);
      const form = page.getByTestId('jinx-generator-form');
      await expect(form).toBeVisible();

      const rows = await visualRows(page);

      for (const ids of rows) {
        await expectFieldsAligned(page, form, { tolerancePx: 1, controlSelector: ids.map((id) => `[data-testid="${id}"]`).join(', ') });
      }
    });
  });
}
