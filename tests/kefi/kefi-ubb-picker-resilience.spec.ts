/**
 * Kefi UBB — the AMBASSADOR PICKER's RESILIENCE and GEOMETRY at phone width.
 *
 * The companion to `kefi-ubb-mobile-picker.spec.ts` (which covers what the
 * picker offers). This file covers the two things that decide whether the
 * picker can COST a sale:
 *
 *   1. What happens when the promoters endpoint is down, slow or empty. The
 *      rule the feature was built around: the picker is never allowed to cost a
 *      registration. Attribution is bookkeeping; a form that will not submit on
 *      the day pre-sale opens is a lost paying customer. Forced here with route
 *      interception rather than hoped for.
 *   2. Whether the control is physically usable on a phone — inside the screen,
 *      big enough for a thumb, and large enough not to trigger iOS Safari's
 *      focus zoom. None of these can be measured at a desktop viewport, and all
 *      three were previously "verified" at 1920px wide.
 *
 * PROD SAFETY: the register POST is intercepted unconditionally (see the
 * fixture) — no attendee row can reach the live UBB roster from this file.
 */

import { test, expect } from '@playwright/test';

import { attachConsoleGuard } from '../../helpers/consoleGuard.js';
import { resolveRegisterSurface } from '../../helpers/kefi/kefiRegisterSurface.js';
import { KefiPublicRegisterPage } from '../../pages/kefi/KefiPublicRegisterPage.js';
import {
  expectNoHorizontalOverflow,
  expectNoIosZoomOnFocus,
  expectTapTargetSize,
  expectWithinViewportWidth,
} from '../../helpers/kefi/mobileLayout.js';
import {
  failPromoters,
  installRegisterInterceptor,
  stubPromoters,
  type RegisterInterceptor,
  LIVE_PROMOTERS,
  PROMOTER_OUTAGE_CONSOLE_NOISE,
  UBB_SLUG,
} from '../../helpers/kefi/kefiPromoterPickerFixture.js';

const HTTP_CREATED = 201;
const HTTP_SERVER_ERROR = 500;

const surface = resolveRegisterSurface(UBB_SLUG);

/** A filled-in buyer, with a non-deliverable RFC 2606 address. */
const BUYER = {
  name: 'E2E',
  phone: '+35799000000',
  passCode: 'FULL',
  consent: true,
} as const;

test.describe('Kefi UBB ambassador picker — resilience and geometry', () => {
  let register: RegisterInterceptor;

  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'surface', description: surface.label });
    register = await installRegisterInterceptor(page);
  });

  test('@ui when the promoters endpoint FAILS the picker hides and registration still succeeds', async ({
    page,
  }) => {
    // ⭐ The most important test in either picker file. A registration that
    // fails because the ambassador list did not load is far worse than a lost
    // attribution.
    const guard = attachConsoleGuard(page);
    await failPromoters(page, HTTP_SERVER_ERROR);

    const form = new KefiPublicRegisterPage(page);
    await form.goto(surface.siteUrl);

    await expect(
      form.referralField,
      'with no promoter list there is nothing to choose from, so the picker must not appear at ' +
        'all — an empty or broken dropdown on a checkout form stops people',
    ).toBeHidden();

    await form.fill({ ...BUYER, surname: 'PickerDown', email: 'e2e-picker-down@example.invalid' });

    const submitted = await form.submitAndCaptureRegistration(UBB_SLUG);
    expect(
      submitted.status,
      'THE REGISTRATION STILL GOES THROUGH with the promoters endpoint down. If this fails, the ' +
        'picker has turned a broken bookkeeping call into a broken checkout on pre-sale day.',
    ).toBe(HTTP_CREATED);

    expect(register.submittedBody(), 'the form submitted a body').not.toBeNull();
    expect(
      register.submittedBody()!['referredByPromoterExternalId'],
      'no attribution is invented when the list never loaded',
    ).toBeUndefined();

    guard.expectClean(
      'the UBB register page with the promoters endpoint down',
      PROMOTER_OUTAGE_CONSOLE_NOISE,
    );
  });

  test('@ui when the promoters endpoint returns an EMPTY list the picker hides and registration still succeeds', async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, []);

    const form = new KefiPublicRegisterPage(page);
    await form.goto(surface.siteUrl);

    await expect(
      form.referralField,
      'a tenant with no ambassadors yet gets the plain form, not an empty dropdown',
    ).toBeHidden();

    await form.fill({
      ...BUYER,
      surname: 'PickerEmpty',
      email: 'e2e-picker-empty@example.invalid',
    });

    const submitted = await form.submitAndCaptureRegistration(UBB_SLUG);
    expect(submitted.status, 'a tenant with no ambassadors can still sell passes').toBe(
      HTTP_CREATED,
    );

    guard.expectClean('the UBB register page with no ambassadors');
  });

  test('@ui a phone registration naming an ambassador submits the attribution and reaches the payment sheet', async ({
    page,
  }) => {
    // The path a real UBB attendee walks at phone width: fill in, name the
    // ambassador who told them, submit, land on the pay/pending state.
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);
    const chosen = LIVE_PROMOTERS[1];

    const form = new KefiPublicRegisterPage(page);
    await form.goto(surface.siteUrl);
    await form.fill({ ...BUYER, surname: 'MobileFlow', email: 'e2e-mobile-flow@example.invalid' });

    await expect(form.referralField).toBeVisible();
    await form.referralSelect.selectOption(chosen.externalId);

    const submitted = await form.submitAndCaptureRegistration(UBB_SLUG);
    expect(submitted.status, 'the phone-width form submits').toBe(HTTP_CREATED);

    expect(
      register.submittedBody()?.['referredByPromoterExternalId'],
      `the attendee named ${chosen.name}, so the register payload must carry that id — this is ` +
        'the whole point of the picker, and the field is silently omitted when it is empty',
    ).toBe(chosen.externalId);

    // The buyer must actually LAND somewhere that tells them what to pay.
    await expect(
      form.payModal,
      'after a successful registration the attendee reaches the payment sheet rather than a ' +
        'blank card — this is where they are told what to transfer',
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'the UBB register page with the payment sheet open');
    await expectWithinViewportWidth(page, form.payModalSheet, 'the payment sheet');

    guard.expectClean('the UBB registration flow');
  });

  test('@ui the picker fits the screen, does not trigger iOS zoom, and is thumb-sized', async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);

    const form = new KefiPublicRegisterPage(page);
    await form.goto(surface.siteUrl);
    await expect(form.referralField).toBeVisible();

    await expectNoHorizontalOverflow(page, 'the UBB register page with the picker shown');
    await expectWithinViewportWidth(page, form.referralField, 'the ambassador picker');
    await expectWithinViewportWidth(page, form.referralSelect, 'the ambassador dropdown');
    await expectNoIosZoomOnFocus(form.referralSelect, 'the ambassador dropdown');
    await expectTapTargetSize(form.referralSelect, 'the ambassador dropdown');

    guard.expectClean('the UBB register page');
  });
});
