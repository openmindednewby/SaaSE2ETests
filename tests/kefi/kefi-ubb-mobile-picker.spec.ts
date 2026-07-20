/**
 * Kefi UBB — the AMBASSADOR PICKER's BEHAVIOUR at phone width.
 *
 * What the picker offers, what it preselects, and what it refuses to invent.
 * Its RESILIENCE (endpoint down, empty list) and its GEOMETRY live in
 * `kefi-ubb-picker-resilience.spec.ts`; both files share
 * `kefiPromoterPickerFixture.ts` so they cannot disagree about the roster.
 *
 * UBB's pre-sale opens within a day and most attendees will register on a
 * phone. The picker shipped without ever having been rendered at a phone
 * viewport: the agent that built it tried to resize the browser, the resize
 * silently failed (`innerWidth` stayed at 1920), and every "mobile" number it
 * reported was in fact measured on a desktop window.
 *
 * PROD SAFETY: the register POST is intercepted unconditionally (see the
 * fixture) so no attendee row can ever be created on the live UBB roster, and
 * the default surface is a LOCAL kefi-landings build whose browser-facing API
 * base is a dead port. Either guarantee alone is sufficient.
 */

import { test, expect } from '@playwright/test';

import { attachConsoleGuard } from '../../helpers/consoleGuard.js';
import { resolveRegisterSurface } from '../../helpers/kefi/kefiRegisterSurface.js';
import { KefiPublicRegisterPage } from '../../pages/kefi/KefiPublicRegisterPage.js';
import {
  installRegisterInterceptor,
  stubPromoters,
  LIVE_PROMOTERS,
  NO_REFERRAL_LABEL,
  RETIRED_PROMOTER_NAME,
  UBB_SLUG,
} from '../../helpers/kefi/kefiPromoterPickerFixture.js';

const HTTP_OK = 200;

const surface = resolveRegisterSurface(UBB_SLUG);

test.describe('Kefi UBB ambassador picker — behaviour', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Record WHICH build produced the result: a pass against a local dist and a
    // pass against the published site are very different claims.
    testInfo.annotations.push({ type: 'surface', description: surface.label });
    await installRegisterInterceptor(page);
  });

  test('@ui the picker lists every ambassador, with the opt-out first and preselected', async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);

    const register = new KefiPublicRegisterPage(page);
    await register.goto(surface.siteUrl);

    await expect(
      register.referralField,
      'the ambassador picker is shown once the promoter list loads',
    ).toBeVisible();

    const labels = await register.referralOptionLabels();
    const values = await register.referralOptionValues();

    // The opt-out must be FIRST. A <select> preselects its first option, so a
    // promoter in slot 0 would silently credit a payout to whoever tops the
    // list for every visitor who never opens the dropdown — inventing an
    // attribution, and a real payment, out of nothing.
    expect(
      labels[0],
      'the FIRST option is the explicit opt-out. If a promoter were first, the browser would ' +
        'preselect them and every visitor who ignores the picker would be credited to that act.',
    ).toBe(NO_REFERRAL_LABEL);
    expect(values[0], 'the opt-out submits an empty referral').toBe('');

    for (const promoter of LIVE_PROMOTERS) {
      expect(labels, `"${promoter.name}" is offered as an ambassador`).toContain(promoter.name);
    }
    expect(
      labels,
      'the picker offers the opt-out plus every active act, and nothing else',
    ).toHaveLength(LIVE_PROMOTERS.length + 1);

    await expect(
      register.referralSelect,
      'nothing is attributed until the visitor actually chooses someone',
    ).toHaveValue('');

    guard.expectClean('the UBB register page with the picker loaded');
  });

  test('@ui the picker adds nobody the endpoint did not send', async ({ page }) => {
    // The retired-act filter itself is SERVER-side (`IsActive`), so a stub can
    // never exercise it — that half is asserted against the live endpoint in
    // the `@api` test below. What this test owns is the other half: the picker
    // renders exactly the list it was handed and invents no extra entries.
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);

    const register = new KefiPublicRegisterPage(page);
    await register.goto(surface.siteUrl);
    await expect(register.referralField).toBeVisible();

    const labels = await register.referralOptionLabels();
    expect(
      labels,
      'a retired act the endpoint filtered out never reappears in the picker',
    ).not.toContain(RETIRED_PROMOTER_NAME);
    expect(
      labels,
      'the picker shows the opt-out plus exactly the acts it was sent — no extras',
    ).toHaveLength(LIVE_PROMOTERS.length + 1);

    guard.expectClean('the UBB register page');
  });

  test('@ui ?ref= preselects the ambassador who shared the link', async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);
    const shared = LIVE_PROMOTERS[2];

    const register = new KefiPublicRegisterPage(page);
    await page.goto(`${surface.siteUrl}/register?ref=${shared.externalId}`);
    await expect(register.form, 'the register form renders').toBeVisible();

    await expect(register.referralField, 'the picker is shown').toBeVisible();
    await expect(
      register.referralSelect,
      `a link shared by ${shared.name} preselects ${shared.name}, so the attendee does not have ` +
        'to remember who sent them',
    ).toHaveValue(shared.externalId);

    guard.expectClean('the UBB register page opened from a share link');
  });

  test('@ui an unknown ?ref= falls back to the opt-out rather than crediting a stranger', async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await stubPromoters(page, LIVE_PROMOTERS);

    const register = new KefiPublicRegisterPage(page);
    await page.goto(`${surface.siteUrl}/register?ref=11111111-1111-4111-8111-111111111111`);
    await expect(register.form).toBeVisible();
    await expect(register.referralField).toBeVisible();

    await expect(
      register.referralSelect,
      'a ?ref= naming nobody in the list falls back to the opt-out — the picker on screen is ' +
        "the visitor's statement of record, so it must not show \"Nobody\" while submitting a name",
    ).toHaveValue('');

    guard.expectClean('the UBB register page with a stale share link');
  });

  test('@api the LIVE promoters endpoint excludes the retired act', async ({ request }) => {
    // The server-side half of the retired-act contract, and the only test in
    // these two files that touches production. A plain anonymous GET —
    // read-only, creates nothing, the same call the public form makes.
    const apiUrl = (process.env.KEFI_API_URL ?? '').trim();
    test.skip(apiUrl === '', 'KEFI_API_URL is unset — run with E2E_TARGET=prod');

    const response = await request.get(`${apiUrl}/api/v1/t/${UBB_SLUG}/promoters`);
    expect(response.status(), 'the public promoters endpoint answers').toBe(HTTP_OK);

    const promoters = (await response.json()) as { externalId: string; name: string }[];
    const names = promoters.map((promoter) => promoter.name);

    expect(
      names,
      `the retired act "${RETIRED_PROMOTER_NAME}" is still being offered to buyers on the public ` +
        "register form. Retiring is the organizer's only way to take an act off the form, so a " +
        'leak here offers a referral payout that should no longer exist.',
    ).not.toContain(RETIRED_PROMOTER_NAME);

    for (const promoter of LIVE_PROMOTERS) {
      expect(names, `the active act "${promoter.name}" is offered`).toContain(promoter.name);
    }
    expect(
      names,
      'the live list is exactly the expected active roster — a new or vanished act here means ' +
        'the picker fixture is stale and its UI assertions are testing fiction',
    ).toHaveLength(LIVE_PROMOTERS.length);
  });
});
