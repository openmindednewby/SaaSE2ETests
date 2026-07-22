// Digital Kin role boundary (@ui) — the admin/master split, proven in the UI.
//
// Split out of digital-kin-authoring.ui.spec.ts to stay under the 300-line cap.
//
// 🔴 Hiding a nav item is NOT authorization. Both halves are asserted here: the
// nav item is absent AND direct navigation to the route is refused. A suite that
// only checked the nav would pass against an app where typing the URL works.
import { expect, test } from '@playwright/test';

import { DigitalKinLoginPage, DigitalKinShell } from '../../pages/digital-kin/DigitalKinAdminPage.js';
import { DigitalKinTaxonomyPage } from '../../pages/digital-kin/DigitalKinAdminScreens.js';
import {
  DIGITALKIN_ADMIN_PASSWORD,
  DIGITALKIN_ADMIN_URL,
  DIGITALKIN_ADMIN_USER,
  hasAdminCredentials,
} from './digital-kin-helpers.js';

const admin = DIGITALKIN_ADMIN_URL ?? '';

test.describe('Digital Kin role boundary @digital-kin-ui @digital-kin', () => {
  test.skip(
    !hasAdminCredentials() || DIGITALKIN_ADMIN_USER === null || DIGITALKIN_ADMIN_PASSWORD === null,
    'DIGITALKIN_DEMO_ADMIN_* not set — cannot assert the admin/master boundary.',
  );

  test('🔴 admin has no taxonomy nav, and direct navigation is refused in the UI', async ({
    page,
  }) => {
    const login = new DigitalKinLoginPage(page);
    await login.goto(admin);
    await login.signIn(DIGITALKIN_ADMIN_USER ?? '', DIGITALKIN_ADMIN_PASSWORD ?? '');

    const shell = new DigitalKinShell(page);
    const taxonomy = new DigitalKinTaxonomyPage(page);

    // Guide editing must still work — the boundary restricts taxonomy, it does
    // not make the admin account useless.
    await expect(shell.navGuides, 'admin cannot see the guides nav').toBeVisible();
    await expect(shell.navPages).toBeVisible();
    await expect(shell.navResources).toBeVisible();
    await expect(shell.navMessages).toBeVisible();
    await expect(shell.navTaxonomy, 'admin can SEE the master-only taxonomy nav').toHaveCount(0);

    // Hiding a nav item is not authorization. Navigating straight there must
    // refuse — and refuse cleanly, not by tripping the error boundary.
    await taxonomy.goto(admin);
    await expect(taxonomy.forbidden, 'direct navigation to /taxonomy was not refused').toBeVisible({
      timeout: 30_000,
    });
    await expect(taxonomy.screen, 'the taxonomy editor rendered for an admin').toHaveCount(0);
    await expect(
      page.getByTestId('error-boundary-reload-button'),
      'the refusal tripped the error boundary',
    ).toHaveCount(0);
  });
});
