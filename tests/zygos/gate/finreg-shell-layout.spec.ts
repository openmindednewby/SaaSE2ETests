import { expect, test } from '@playwright/test';

import { DESKTOP, SHELL, boxOf, enterAs, id } from './finreg-gate.js';
import { ROLES } from './finreg-roles.js';

const MIN_CONTENT_WIDTH = 960;

test.describe('FinReg shell layout at 1280x800 @finreg-gate', () => {
  test.use(DESKTOP);
  for (const role of ROLES) {
    test(`AC-13 content column as ${role.label} at 1280x800, is at least ${MIN_CONTENT_WIDTH} px wide`, async ({ page }) => {
      await enterAs(page, role.user, '/');

      const content = await boxOf(page.locator(id(`${SHELL}-content`)));

      expect(content.width, `content column ${content.width}px < ${MIN_CONTENT_WIDTH}px`).toBeGreaterThanOrEqual(MIN_CONTENT_WIDTH);
    });
  }
});
