import { expect, test } from '@playwright/test';

import { PHONE, sight } from './finreg-gate.js';
import { expectRowAffordances } from './row-open-check.js';

const SHOWCASE_TABLES = 'https://ui.dloizides.com/tables';

test.describe('ROW-OPEN-1 ui-showcase tables at 360x640 @finreg-gate', () => {
  test.use(PHONE);
  test('ROW-OPEN-1 DataTable row-open story at 360x640, Enter on Item 01 opens its record', async ({ page }) => {
    await page.goto(SHOWCASE_TABLES);
    const row = page.locator('[role="row"][tabindex="0"]').filter({ hasText: 'Item 01' }).first();

    await expectRowAffordances(page, row);

    await expect(page.getByText('Opened record: Item 01')).toBeVisible();
    await sight(page, 'ROW-OPEN-1', 'showcase-tables-360x640');
  });
});
