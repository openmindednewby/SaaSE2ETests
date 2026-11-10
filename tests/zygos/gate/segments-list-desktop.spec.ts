import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test } from '@playwright/test';

import { DESKTOP, MIN_HIT, VISIBLE_TEXT, boxOf, byPrefix, enterAs, horizontalOverflow, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';
import { GATE_SEGMENT, LIST_PATH, SEG, ensureGateSegment } from './segments-gate.js';

test.describe('Segments list at 1280x800 @finreg-gate', () => {
  test.use(DESKTOP);
  for (const role of ROLES) {
    test(`AC-UI-2 segments list as ${role.label} at 1280x800, members first beside each segment`, async ({ page }) => {
      await ensureGateSegment(page);
      await enterAs(page, role.user, LIST_PATH);

      const card = page.locator(byPrefix(SEG.card)).filter({ hasText: GATE_SEGMENT.name }).first();

      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.locator(byPrefix(SEG.rule)).first(), 'rule sentence').toBeVisible();
      for (const action of [SEG.open, SEG.edit, SEG.del]) {
        const b = await boxOf(card.locator(byPrefix(action)).first());
        expect(Math.min(b.width, b.height), `${action} hit box`).toBeGreaterThanOrEqual(MIN_HIT);
      }
      expect(await horizontalOverflow(page), 'horizontal scroll px').toBeLessThanOrEqual(0);
      await expect(card.locator(byPrefix(SEG.preview)).first(), 'members preview').toBeVisible();
      await expectTextFits(page, VISIBLE_TEXT);
      await sight(page, 'SEGMENTS-UX-1', `list-${role.label}-1280x800`);
    });
  }
});
