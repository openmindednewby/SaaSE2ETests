// FINREG payments corridor @ui — the SEEDED-DATA surfaces, rendered in a real browser as the DEMO
// tenant (the one that owns the `ZC-2026-*` corridor rows; `zygos-checker-c` is a different tenant
// and by isolation cannot see them). Read-only throughout: rail badges on the detail (P-PAY-11),
// the beneficiary screening hold + its 4-eyes override AFFORDANCE (P-PAY-7 — asserted present, NOT
// exercised, so no hold is ever cleared and no side effect lands), and the velocity usage indicator
// (P-PAY-8, asserted honestly against the tenant's live cap state).
//
// Each instruction's externalId is resolved at runtime from its immutable reference (the seed's
// stable key), never hard-coded — the demo tenant assigns real GUIDs, not `mock-*` ids.
import { expect, test } from '@playwright/test';

import {
  CORRIDOR,
  RAIL_LABEL,
  SCREEN_IDS,
  enterConsoleAsDemo,
  findByReference,
  getVelocityUsage,
  gotoScreen,
  hasAnyCap,
  id,
  railDetailBadgeId,
} from './zygos-payments.js';

import type { PaymentRail } from './zygos-payments.js';
import type { ZygosSession } from './zygos-session.js';
import type { Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const SKIP_REASON = 'Zygos console unreachable or demo credentials not published';

test.describe('FINREG payments corridor @zygos-ui @ui', () => {
  let session: ZygosSession | null;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(DESKTOP);
    session = await enterConsoleAsDemo(page, '/');
    test.skip(!session, SKIP_REASON);
  });

  /** Open a corridor row's detail by reference; return its externalId once the detail has rendered. */
  async function openDetail(page: Page, reference: string): Promise<string> {
    const row = await findByReference(session as ZygosSession, reference);
    await gotoScreen(page, `/instructions/${row.externalId}`, SCREEN_IDS.detail);
    return row.externalId;
  }

  // ── P-PAY-11 rail badges — each corridor instruction's detail shows its correct rail badge.
  const RAIL_BADGE_CASES: readonly { name: string; ref: string; rail: PaymentRail }[] = [
    { name: 'SEPA Instant', ref: CORRIDOR.sepaInstant.ref, rail: 'SepaInstant' },
    { name: 'SEPA', ref: CORRIDOR.sepaStructured.ref, rail: 'Sepa' },
    { name: 'Faster Payments', ref: CORRIDOR.fasterPayments.ref, rail: 'FasterPayments' },
    { name: 'ACH', ref: CORRIDOR.ach.ref, rail: 'Ach' },
    { name: 'SWIFT', ref: CORRIDOR.swiftDebtorFees.ref, rail: 'Swift' },
  ];

  for (const c of RAIL_BADGE_CASES) {
    test(`P-PAY-11 detail shows the ${c.name} rail badge`, async ({ page }) => {
      const externalId = await openDetail(page, c.ref);
      const badge = page.locator(id(railDetailBadgeId(externalId)));
      await expect(badge, `no rail badge rendered on ${c.ref}`).toBeVisible();
      await expect(
        badge,
        `the badge on ${c.ref} should read "${RAIL_LABEL[c.rail]}"`,
      ).toContainText(RAIL_LABEL[c.rail]);
    });
  }

  // ── P-PAY-7 screening hold — the held Volkov instruction shows the badge AND an override control.
  test('P-PAY-7 the Screening-Hold instruction offers an override affordance (presence only)', async ({ page }) => {
    await openDetail(page, CORRIDOR.screeningHold.ref);

    await expect(
      page.locator(id(SCREEN_IDS.screeningBadge)),
      'the screening verdict badge is missing on the held instruction',
    ).toBeVisible();

    // The 4-eyes override button must be PRESENT and reachable — but this test deliberately does
    // NOT click it. Clearing a hold is a real, audited state change against shared demo data; its
    // behaviour belongs to a maker-checker spec, not here. Presence is the P-PAY-7 UI guarantee.
    await expect(
      page.locator(id(SCREEN_IDS.screeningOverride)),
      'the demo user should see an "Override hold" affordance on a PotentialMatch hold',
    ).toBeVisible();
  });

  // ── P-PAY-8 velocity indicator — honest against the tenant's live cap (demo currently uncapped).
  test('P-PAY-8 the velocity usage indicator matches the tenant’s live cap state', async ({ page }) => {
    await gotoScreen(page, '/instructions', SCREEN_IDS.instructions);

    // The indicator renders ONLY when the tenant has a cap for the shown currency (EUR default). So
    // read the live headroom the same screen reads, and assert the UI agrees — never a blind
    // "must be visible" that would flake the moment the seed's cap policy changes.
    const usage = await getVelocityUsage(session as ZygosSession, 'EUR');
    const indicator = page.locator(id(SCREEN_IDS.velocityUsage));

    if (hasAnyCap(usage)) {
      await expect(indicator, 'a capped tenant must show the velocity usage indicator').toBeVisible();
      await expect(indicator).toContainText(/used today/i);
    } else {
      // Uncapped ⇒ correctly hidden. The screen itself must still be healthy (this is not a crash).
      await expect(indicator, 'an uncapped tenant must NOT show the indicator').toHaveCount(0);
      await expect(page.locator(id(SCREEN_IDS.instructions))).toBeVisible();
    }
  });
});
