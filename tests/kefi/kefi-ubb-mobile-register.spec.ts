/**
 * Kefi UBB MOBILE E2E — the register page at phone width.
 *
 * Split out of `kefi-ubb-mobile.spec.ts` (max-file-lines) — see that file's
 * sibling `kefi-ubb-mobile-payment.spec.ts` for the payment-sheet/ticket half.
 *
 * The owner called this out directly, and the suite had no answer: before this
 * file, NOT ONE spec in the entire E2ETests tree opened a Kefi surface at a phone
 * viewport. Every `@ui` test ran at 1280×720 desktop, which is the one resolution
 * almost no UBB attendee will use.
 *
 * That gap matters because the defect class it hides is invisible to every other
 * kind of test. A pay button rendered 40px past the right edge of a 393px screen:
 *
 *   - is in the DOM, so the unit test passes;
 *   - returns the right data, so the `@api` test passes;
 *   - satisfies `toBeVisible()`, and Playwright will happily `click()` it because
 *     actionability checks SCROLL IT INTO VIEW first — so even the desktop `@ui`
 *     test passes;
 *   - and is completely unreachable for a human holding a phone, who is given no
 *     cue that the page scrolls sideways at all.
 *
 * So the assertions here deliberately measure GEOMETRY rather than driving
 * interactions: `expectWithinViewportWidth` reads the bounding box WITHOUT
 * scrolling, because scrolling is precisely what conceals the bug.
 *
 * Covered here: the register page — the form, the pass tiles, the Register button.
 */

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiPublicRegisterPage } from '../../pages/kefi/KefiPublicRegisterPage.js';
import {
  expectNoHorizontalOverflow,
  expectWithinViewportWidth,
} from '../../helpers/kefi/mobileLayout.js';
import { fixtureTenantAvailable, FIXTURE_TENANT_SKIP_REASON } from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

// NOT serial: `workers: 1` already serializes these, while serial mode would
// CASCADE-SKIP every test after the first failure — and on a layout suite the
// later surfaces are the ones most likely to be broken independently of the first.

test.describe('Kefi UBB mobile attendee surfaces — register page', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the register page fits a phone and the Register button is reachable without scrolling sideways', async ({
    page,
  }) => {
    const ops = await openEventOps();
    const register = new KefiPublicRegisterPage(page);

    await register.goto(ops.tenant.siteUrl);

    // The page as a whole must not scroll sideways. Checked first because a
    // document-level overflow makes every per-element result below ambiguous.
    await expectNoHorizontalOverflow(page, 'the UBB register page');

    // The controls a buyer must actually reach, measured individually — an
    // `overflow:hidden` ancestor can clip a button while the page itself stays
    // put, which is the worst case: unreachable AND undetectable by scroll width.
    await expectWithinViewportWidth(page, register.form, 'the registration form');
    await expectWithinViewportWidth(page, register.nameInput, 'the name field');
    await expectWithinViewportWidth(page, register.emailInput, 'the email field');
    await expectWithinViewportWidth(page, register.consentCheckbox, 'the consent checkbox');
    await expectWithinViewportWidth(page, register.submitButton, 'the Register button');
  });

  test('@ui every pass tile and its price stay inside a phone screen', async ({ page }) => {
    // The pass tiles carry the PRICE. A tile clipped at the right edge can hide
    // the amount entirely, which is the same class of harm as quoting the wrong
    // number — the buyer commits without having seen what they will pay.
    const ops = await openEventOps();
    const register = new KefiPublicRegisterPage(page);

    await register.goto(ops.tenant.siteUrl);

    const tiles = page.locator('label.reg-pass-option');
    const tileCount = await tiles.count();
    expect(tileCount, 'the register form offers at least one pass to buy').toBeGreaterThan(0);

    for (let index = 0; index < tileCount; index++) {
      const tile = tiles.nth(index);
      const code = await tile.locator('input[name="passCode"]').getAttribute('value');
      await expectWithinViewportWidth(page, tile, `the ${code} pass tile`);
      await expectWithinViewportWidth(
        page,
        tile.locator('.reg-pass-price'),
        `the ${code} pass PRICE`,
      );
    }
  });
});
