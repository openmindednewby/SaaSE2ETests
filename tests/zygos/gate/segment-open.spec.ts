import { expect, test } from '@playwright/test';

import { VIEWPORTS, byPrefix, enterAs, id, sight } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';
import { GATE_SEGMENT, LIST_PATH, SEG, ensureGateSegment } from './segments-gate.js';

for (const vp of VIEWPORTS) {
  test.describe(`Segment open at ${vp.label} @finreg-gate`, () => {
    test.use(vp.use);
    for (const role of ROLES) {
      test(`AC-UI-3 open the gate segment as ${role.label} at ${vp.label}, Contacts shows its saved filter`, async ({ page }) => {
        await ensureGateSegment(page);
        await enterAs(page, role.user, LIST_PATH);
        const card = page.locator(byPrefix(SEG.card)).filter({ hasText: GATE_SEGMENT.name }).first();

        await card.locator(byPrefix(SEG.open)).first().click();

        await expect(page.locator(id(SEG.contacts))).toBeVisible({ timeout: 20_000 });
        await expect(page.locator(byPrefix(SEG.rule)).filter({ hasText: GATE_SEGMENT.tags }).first(), 'saved filter chip').toBeVisible();
        await sight(page, 'SEGMENTS-UX-1', `open-${role.label}-${vp.label}`);
      });
    }
  });
}
