import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test } from '@playwright/test';

import { DESKTOP, VISIBLE_TEXT, boxOf, enterAs, horizontalOverflow, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';
import { NEW_PATH, SEG } from './segments-gate.js';

test.describe('Segment editor at 1280x800 @finreg-gate', () => {
  test.use(DESKTOP);
  for (const role of ROLES) {
    test(`AC-UI-5 new segment editor as ${role.label} at 1280x800, members first, count card on the right`, async ({ page }) => {
      await enterAs(page, role.user, NEW_PATH);

      const countBox = await boxOf(page.locator(id(SEG.count)));
      const membersBox = await boxOf(page.locator(id(SEG.members)));

      expect(countBox.x, 'count card right of members').toBeGreaterThan(membersBox.x + membersBox.width / 2);
      expect(await horizontalOverflow(page), 'horizontal scroll px').toBeLessThanOrEqual(0);
      await expectTextFits(page, VISIBLE_TEXT);
      await sight(page, 'SEGMENTS-UX-1', `editor-${role.label}-1280x800`);
    });
  }
});
