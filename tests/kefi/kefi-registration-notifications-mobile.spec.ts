/**
 * Kefi organizer registration-notifications card — MOBILE geometry.
 *
 * Christina configures this on her phone, between other things, once. If a
 * control on this card is 32px tall or sits past the right edge of a 375px
 * screen, she does not file a bug — she gives up, leaves notifications off, and
 * finds out about her pre-sale by refreshing the dashboard. A 32px control was
 * already found and fixed elsewhere on this same dashboard, so this is a live
 * regression risk, not a hypothetical one.
 *
 * Every assertion here measures RENDERED GEOMETRY rather than driving the flow,
 * because geometry is the failure mode no other test tier can see:
 *
 *   - the DOM contains the control, so the unit test passes;
 *   - the API round-trips, so the `@api` test passes;
 *   - `toBeVisible()` is satisfied, and Playwright's actionability checks SCROLL
 *     the control into view before clicking, so even the desktop `@ui` spec in
 *     `kefi-registration-notifications.spec.ts` passes;
 *   - and a human holding a phone still cannot reach it.
 *
 * Runs under real Playwright DEVICE DESCRIPTORS, one project per screen class,
 * so `isMobile`, `hasTouch`, the device-pixel-ratio and the mobile UA are all
 * realistic. A resized desktop window does NOT reproduce mobile viewport
 * semantics. Note the descriptor choice: `devices['iPhone SE']` is the 2016
 * FIRST-generation SE at 320×568, not the 375×667 screen people mean when they
 * say "iPhone SE" — so 375 comes from `iPhone 8` and the 390-class from
 * `iPhone 13`. Naming by feel would have tested a screen 55px narrower than the
 * one being claimed.
 *
 * READ-ONLY. This file never saves, so it writes no tenant config at all.
 */

import { test, expect } from '@playwright/test';

import {
  type RegistrationNotificationsCard,
  openRegistrationNotificationsCard,
  setChecked,
} from '../../helpers/kefi/kefiRegistrationNotifications.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import {
  expectNoHorizontalOverflow,
  expectNoIosZoomOnFocus,
  expectWithinViewportWidth,
} from '../../helpers/kefi/mobileLayout.js';
import { isRemoteTarget } from '../../helpers/target.js';

/** Apple's minimum comfortable touch target; Material rounds to the same place. */
const MIN_TAP_TARGET_PX = 44;

/** The controls a thumb has to hit, with the name a failure should report. */
function tappableControls(
  controls: RegistrationNotificationsCard,
): ReadonlyArray<{ name: string; locator: RegistrationNotificationsCard[keyof RegistrationNotificationsCard] }> {
  return [
    { name: 'the master "notify me" enable toggle', locator: controls.enableToggle },
    { name: 'the Email channel row', locator: controls.emailChannel },
    { name: 'the WhatsApp-handoff channel row', locator: controls.whatsappChannel },
    { name: 'the recipient-addresses field', locator: controls.recipientsField },
    { name: 'the Save button', locator: controls.saveButton },
  ];
}

test.describe('Kefi registration-notifications card on a phone', () => {
  test.skip(!isRemoteTarget(), 'the card lives on the deployed kefi-web organizer dashboard');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui every control on the card is thumb-sized and inside the screen', async ({ page }) => {
    const { controls, console: consoleGuard } = await openRegistrationNotificationsCard(page);

    await test.info().attach('card-mobile.png', {
      body: await controls.card.screenshot(),
      contentType: 'image/png',
    });

    // The card itself first — if the CARD overflows, every control inside it
    // does too, and naming the card is more useful than naming five children.
    await expectWithinViewportWidth(page, controls.card, 'the registration-notifications card');

    for (const { name, locator } of tappableControls(controls)) {
      await expectWithinViewportWidth(page, locator, name);
    }

    // MEASURE EVERY control before asserting, rather than asserting inside the
    // loop. A per-control assertion aborts at the first offender, so a report
    // saying "the recipient field is 41px" leaves the Save button — the control
    // that actually completes the task — unmeasured and unmentioned. When the
    // question is "is this card usable on a phone", a partial answer is the one
    // thing the report must not give.
    const measured: Array<{ name: string; height: number }> = [];
    for (const { name, locator } of tappableControls(controls)) {
      await expect(locator, `${name} is rendered`).toBeVisible();
      const box = await locator.boundingBox();
      expect(box, `${name} has a measurable box`).not.toBeNull();
      measured.push({ name, height: Math.round(box!.height) });
    }

    test.info().attach('tap-target-heights.json', {
      body: JSON.stringify(measured, null, 2),
      contentType: 'application/json',
    });

    const undersized = measured.filter((m) => m.height < MIN_TAP_TARGET_PX);
    expect(
      undersized,
      `${undersized.length} control(s) on the registration-notifications card are under the ` +
        `${MIN_TAP_TARGET_PX}px minimum touch target at ${page.viewportSize()?.width}px wide:\n` +
        measured
          .map(
            (m) =>
              `      ${m.height < MIN_TAP_TARGET_PX ? '✗' : '✓'} ${m.name} — ${m.height}px`,
          )
          .join('\n') +
        '\n    An undersized control is hit-or-miss with a thumb. The organizer configuring this ' +
        'is not at a desk — she does it on her phone, once, and if a control fights her she ' +
        'leaves notifications off and finds out about her pre-sale by refreshing the dashboard.\n',
    ).toEqual([]);

    consoleGuard.expectClean('the registration-notifications card at phone width');
  });

  test('@ui the recipient field does not trigger iOS focus-zoom', async ({ page }) => {
    const { controls } = await openRegistrationNotificationsCard(page);

    // The field is disabled until notifications are on, but its computed
    // font-size is what matters and that does not depend on the toggle.
    await expectNoIosZoomOnFocus(controls.recipientsInput, 'the recipient-addresses field');
  });

  test('@ui the dashboard carrying the card does not scroll sideways', async ({ page }) => {
    const { controls, console: consoleGuard } = await openRegistrationNotificationsCard(page);
    await expect(controls.card).toBeVisible();

    await expectNoHorizontalOverflow(
      page,
      'the organizer dashboard carrying the registration-notifications card',
    );

    consoleGuard.expectClean('the organizer dashboard at phone width');
  });

  test('@ui the WhatsApp-only warning is fully readable on a phone', async ({ page }) => {
    const { controls } = await openRegistrationNotificationsCard(page);

    // The warning is the highest-value thing on the card and the easiest to
    // lose on a narrow screen: it is the widest block of prose, so if anything
    // clips or overflows, it is this. A warning the organizer cannot read is
    // exactly equivalent to no warning at all.
    // Via `setChecked`, which reads the ✓ GLYPH. Reading `aria-checked` here
    // would silently no-op: the attribute is never rendered (see `isChecked`),
    // so every control reads as unchecked and the "uncheck email" step does
    // nothing — leaving email selected, no warning raised, and a failure that
    // looks like a missing warning rather than a broken test.
    await setChecked(controls.enableToggle, true);
    await expect(controls.whatsappChannel).toBeVisible();
    await setChecked(controls.emailChannel, false);
    await setChecked(controls.whatsappChannel, true);

    await expect(
      controls.noServerChannelWarning,
      'selecting WhatsApp handoff alone raises the "nothing will be sent" warning on mobile too',
    ).toBeVisible({ timeout: 10_000 });

    await expectWithinViewportWidth(
      page,
      controls.noServerChannelWarning,
      'the "no automatic message will be sent" warning',
    );
    await expectNoHorizontalOverflow(page, 'the dashboard with the WhatsApp-only warning shown');

    await test.info().attach('whatsapp-warning-mobile.png', {
      body: await controls.card.screenshot(),
      contentType: 'image/png',
    });

    // Deliberately does NOT save — this file is read-only against the tenant.
  });
});
