import { expect, test } from '@playwright/test';

import { DESKTOP, enterAs, id } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';
import { NEW_PATH, SEG } from './segments-gate.js';

const NO_MATCH_TAG = 'e2e-gate-no-contact-has-this-tag';

test.describe('Segment editor live count @finreg-gate', () => {
  test.use(DESKTOP);
  for (const role of ROLES) {
    test(`AC-14 editor as ${role.label} with tag ${NO_MATCH_TAG}, count card updates to 0`, async ({ page }) => {
      await enterAs(page, role.user, NEW_PATH);
      const count = page.locator(id(SEG.count));
      await expect(count).toBeVisible({ timeout: 20_000 });

      await page.locator(id(SEG.tags)).fill(NO_MATCH_TAG);

      await expect(count, 'live count after a no-match tag').toContainText(/\b0\b/, { timeout: 10_000 });
    });
  }
});
