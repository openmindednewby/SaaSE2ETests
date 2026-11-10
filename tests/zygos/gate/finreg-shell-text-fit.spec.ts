import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test } from '@playwright/test';

import { SHELL, VIEWPORTS, VISIBLE_TEXT, byPrefix, enterAs, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';

for (const vp of VIEWPORTS) {
  test.describe(`FinReg shell text fit at ${vp.label} @finreg-gate`, () => {
    test.use(vp.use);
    for (const role of ROLES) {
      test(`AC-12 AC-UI-4 shell as ${role.label} at ${vp.label}, every nav label fits its box`, async ({ page }) => {
        await enterAs(page, role.user, '/');
        const nav = vp.phone ? page.locator(byPrefix(`${SHELL}-menu`)).first() : page.locator(id(`${SHELL}-sidebar`));

        if (vp.phone) await nav.click();

        await expect(page.locator(vp.phone ? id(`${SHELL}-drawer`) : id(`${SHELL}-sidebar`))).toBeVisible();
        await expectTextFits(page, VISIBLE_TEXT);
        await sight(page, 'NAV-BRAND-1', `text-fit-${role.label}-${vp.label}`);
      });
    }
  });
}
