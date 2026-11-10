import { expect, test } from '@playwright/test';

import { MIN_HIT, PHONE, SHELL, boxOf, byPrefix, enterAs, horizontalOverflow, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';

const BRAND_HOME = 'nav-brand-home';
const EDGE_TOLERANCE = 1;

test.describe('FinReg shell phone brand and drawer @finreg-gate', () => {
  test.use(PHONE);
  for (const role of ROLES) {
    test(`AC-UI-3 closed shell as ${role.label} at 360x640, brand in the top bar, no horizontal scroll, menu hit box >= ${MIN_HIT}`, async ({ page }) => {
      await enterAs(page, role.user, '/');

      const toggle = await boxOf(page.locator(byPrefix(`${SHELL}-menu`)).first());

      await expect(page.locator(id(`${SHELL}-header`)).locator(id(BRAND_HOME))).toBeVisible();
      expect(await horizontalOverflow(page), 'horizontal scroll px').toBeLessThanOrEqual(0);
      expect(Math.min(toggle.width, toggle.height), 'menu toggle hit box').toBeGreaterThanOrEqual(MIN_HIT);
      await sight(page, 'NAV-BRAND-1', `phone-closed-${role.label}-360x640`);
    });

    test(`AC-UI-2 open drawer as ${role.label} at 360x640, full height and full width with the logo once`, async ({ page }) => {
      await enterAs(page, role.user, '/');
      const viewport = page.viewportSize() ?? { width: 360, height: 640 };

      await page.locator(byPrefix(`${SHELL}-menu`)).first().click();

      const drawer = page.locator(id(`${SHELL}-drawer`));
      const box = await boxOf(drawer);
      expect(box.width, 'drawer width').toBeGreaterThanOrEqual(viewport.width - EDGE_TOLERANCE);
      expect(box.height, 'drawer height').toBeGreaterThanOrEqual(viewport.height - EDGE_TOLERANCE);
      await expect(drawer.locator(id(BRAND_HOME)), 'logo count in drawer').toHaveCount(1);
      await sight(page, 'NAV-BRAND-1', `phone-drawer-${role.label}-360x640`);
    });
  }
});
