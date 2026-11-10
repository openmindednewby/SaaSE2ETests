import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test } from '@playwright/test';

import { PHONE, VISIBLE_TEXT, boxOf, enterAs, horizontalOverflow, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';
import { NEW_PATH, SEG } from './segments-gate.js';

test.describe('Segment editor at 360x640 @finreg-gate', () => {
  test.use(PHONE);
  for (const role of ROLES) {
    test(`AC-UI-4 new segment editor as ${role.label} at 360x640, count card above the members`, async ({ page }) => {
      await enterAs(page, role.user, NEW_PATH);

      const countBox = await boxOf(page.locator(id(SEG.count)));
      const membersBox = await boxOf(page.locator(id(SEG.members)));

      expect(countBox.y, 'count card above members').toBeLessThan(membersBox.y);
      expect(await horizontalOverflow(page), 'horizontal scroll px').toBeLessThanOrEqual(0);
      await expectTextFits(page, VISIBLE_TEXT);
      await sight(page, 'SEGMENTS-UX-1', `editor-${role.label}-360x640`);
    });
  }
});
