import { expect, test } from '@playwright/test';

import { ZYGOS_USERS } from '../zygos-helpers.js';
import { PHONE, VIEWPORTS, enterAs, sight } from './finreg-gate.js';
import { expectRowAffordances } from './row-open-check.js';

const LEDGER_TABLE = '[data-testid="zygos-account-ledger-table"]';
const ACCOUNT_LINK = /\/accounting\/accounts\/[0-9a-f-]{36}$/;
const SHOWCASE_TABLES = 'https://ui.dloizides.com/tables';

for (const vp of VIEWPORTS) {
  test.describe(`ROW-OPEN-1 FinReg ledger at ${vp.label} @finreg-gate`, () => {
    test.use(vp.use);
    test(`ROW-OPEN-1 account ledger row as Admin at ${vp.label}, pointer, tint, focus ring, Enter opens its journal`, async ({ page }) => {
      await enterAs(page, ZYGOS_USERS.ADMIN, '/accounting');
      await page.locator('a[href*="/accounting/accounts/"]').filter({ hasNotText: /new/i }).first().click();
      await expect(page).toHaveURL(ACCOUNT_LINK, { timeout: 20_000 });
      const row = page.locator(LEDGER_TABLE).locator('[role="button"], button[data-row], [tabindex="0"]').first();

      await expectRowAffordances(page, row);

      await expect(page, 'Enter on a ledger line opens its journal').toHaveURL(/\/accounting\/journals\//, { timeout: 20_000 });
      await sight(page, 'ROW-OPEN-1', `finreg-ledger-${vp.label}`);
    });
  });
}

test.describe('ROW-OPEN-1 ui-showcase tables at 360x640 @finreg-gate', () => {
  test.use(PHONE);
  test('ROW-OPEN-1 DataTable row-open story at 360x640, Enter on Item 01 opens its record', async ({ page }) => {
    await page.goto(SHOWCASE_TABLES);
    const row = page.locator('[role="button"]').filter({ hasText: 'Item 01' }).first();

    await expectRowAffordances(page, row);

    await expect(page.getByText('Opened record: Item 01')).toBeVisible();
    await sight(page, 'ROW-OPEN-1', 'showcase-tables-360x640');
  });
});
