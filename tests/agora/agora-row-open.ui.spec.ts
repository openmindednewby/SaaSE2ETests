import { expect, test } from '@playwright/test';

import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { PHONE, VIEWPORTS, sight } from '../zygos/gate/finreg-gate.js';
import { expectRowAffordances } from '../zygos/gate/row-open-check.js';
import { AGORA_WEB_URL, MERCHANT_A } from './agora-ui-helpers.js';

void PHONE;

for (const vp of VIEWPORTS) {
  test.describe(`ROW-OPEN-1 agora products at ${vp.label} @agora-ui @ui`, () => {
    test.use(vp.use);
    test(`ROW-OPEN-1 products row as merchant A at ${vp.label}, pointer, tint, focus ring, Enter opens its editor`, async ({ page }) => {
      const password = process.env.AGORA_TEST_PASSWORD?.trim();
      test.skip(!AGORA_WEB_URL || !password, 'AGORA_WEB_URL or AGORA_TEST_PASSWORD unset');
      const admin = new AgoraAdminPage(page);
      await admin.login(MERCHANT_A, password as string);
      await page.goto(`${AGORA_WEB_URL}/products`);
      const startUrl = page.url();
      const row = page.getByTestId('products-table').locator('[role="button"], [tabindex="0"]').first();

      await expectRowAffordances(page, row);

      await expect.poll(() => page.url(), { message: 'Enter opens the product editor' }).not.toBe(startUrl);
      await sight(page, 'ROW-OPEN-1', `agora-products-${vp.label}`);
    });
  });
}
