import { expect, test } from '@playwright/test';

import { DESKTOP, SHELL, boxOf, enterAs, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';

const RAIL_WIDTH = 240;
const BRAND_HOME = 'nav-brand-home';

test.describe('FinReg shell desktop brand @finreg-gate', () => {
  test.use(DESKTOP);
  for (const role of ROLES) {
    test(`AC-UI-1 shell as ${role.label} at 1280x800, brand in the top bar and a ${RAIL_WIDTH} px rail without it`, async ({ page }) => {
      await enterAs(page, role.user, '/');

      const header = page.locator(id(`${SHELL}-header`));
      const rail = page.locator(id(`${SHELL}-sidebar`));
      const brandBox = await boxOf(header.locator(id(BRAND_HOME)));
      const railBox = await boxOf(rail);

      await expect(header.getByText('FINREG', { exact: true })).toBeVisible();
      expect(brandBox.x, 'brand is not at the top-left').toBeLessThan(RAIL_WIDTH);
      expect(Math.round(railBox.width), 'rail width').toBe(RAIL_WIDTH);
      await expect(rail.locator(id(BRAND_HOME)), 'brand is repeated in the rail').toHaveCount(0);
      await sight(page, 'NAV-BRAND-1', `desktop-${role.label}-1280x800`);
    });
  }
});
