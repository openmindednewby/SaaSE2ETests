/**
 * Kefi UBB MOBILE E2E — the attendee-facing surfaces at phone width.
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
 * Covered, in the order a buyer meets them:
 *   1. the register page  — the form, the pass tiles, the Register button
 *   2. the payment sheet  — the modal shown on a 201, and its pay/ticket controls
 *   3. the ticket         — what the attendee shows at the door
 *
 * PROD-SAFE: the browser-driven registration creates a REAL row on the live UBB
 * tenant. Its `attendeeExternalId` is captured from the register response and
 * tracked for deletion in `finally`, and the roster is asserted back to baseline.
 */

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
import { KefiPublicRegisterPage } from '../../pages/kefi/KefiPublicRegisterPage.js';
import {
  expectNoHorizontalOverflow,
  expectWithinViewportWidth,
} from '../../helpers/kefi/mobileLayout.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

// NOT serial: `workers: 1` already serializes these, while serial mode would
// CASCADE-SKIP every test after the first failure — and on a layout suite the
// later surfaces (the pay sheet, the ticket) are the ones most likely to be
// broken independently of the first.

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const PHONE = '+35799000000';

test.describe('Kefi UBB mobile attendee surfaces', () => {
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

  test('@ui the payment sheet opens on a phone with its controls reachable', async ({ page }) => {
    // ⭐ The surface the owner named. This drives a REAL registration through the
    // real form so the modal is opened the way a buyer opens it — there is no way
    // to assert the sheet's phone layout without producing the state that shows it.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterPage(page);
      await register.goto(ops.tenant.siteUrl);

      await register.fill({
        name: 'E2E',
        surname: `${ops.marker}-mobile`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'mobile'),
        passCode: 'FULL',
        consent: true,
      });

      const submitted = await register.submitAndCaptureRegistration(ops.tenant.slug);
      // Track BEFORE asserting: a 201 whose assertion later fails must still be
      // cleaned up, or a real row is orphaned on a live tenant.
      const attendeeId = submitted.body['attendeeExternalId'];
      if (typeof attendeeId === 'string' && attendeeId.length > 0) {
        ops.trackAttendee(attendeeId);
      }
      expect(submitted.status, 'the phone-width form submits successfully').toBe(HTTP_CREATED);

      await expect(
        register.payModal,
        'the payment sheet opens after a successful registration',
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'the UBB register page with the payment sheet open');
      await expectWithinViewportWidth(page, register.payModalSheet, 'the payment sheet');
      await expectWithinViewportWidth(page, register.payModalTitle, 'the payment sheet heading');
      await expectWithinViewportWidth(
        page,
        register.payModalTicketLink,
        'the ticket link in the payment sheet',
      );
      await expectWithinViewportWidth(
        page,
        register.payModalDone,
        'the payment sheet\'s primary action button',
      );

      // ── Vertical REACHABILITY ────────────────────────────────────────────
      // Measured, not assumed. On a Pixel 5 the sheet holds 1075px of content in
      // a 693px window, so the primary action genuinely starts ~270px below the
      // fold — but `.pay-modal-sheet` is `overflow-y: auto`, so a buyer scrolls
      // the sheet and reaches it. "Below the fold" is therefore NOT the defect;
      // "below the fold in a container that does not scroll" is.
      //
      // An earlier draft of this test asserted the button was above the fold on
      // arrival and failed here. That was the assertion being wrong, not the
      // product — a modal taller than the screen is normal, and demanding
      // otherwise would have been a false alarm on a real money surface.
      const viewport = page.viewportSize()!;
      const sheetScroll = await register.payModalSheet.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));

      if (sheetScroll.scrollHeight > sheetScroll.clientHeight) {
        expect(
          ['auto', 'scroll'],
          `the payment sheet holds ${sheetScroll.scrollHeight}px of content in a ` +
            `${sheetScroll.clientHeight}px window but its overflow-y is ` +
            `"${sheetScroll.overflowY}" — the content below the fold, including the primary ` +
            'action, is permanently unreachable on a phone',
        ).toContain(sheetScroll.overflowY);

        // Scroll the sheet the way a buyer would, then prove the action arrives.
        await register.payModalSheet.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      }

      const doneBox = await register.payModalDone.boundingBox();
      expect(doneBox, 'the primary action has a measurable box').not.toBeNull();
      expect(
        doneBox!.y + doneBox!.height,
        'after scrolling the payment sheet to its end the primary action is STILL not on screen ' +
          `(it ends at ${Math.round(doneBox!.y + doneBox!.height)}px on a ${viewport.height}px ` +
          'screen) — a buyer who has already registered cannot complete the purchase',
      ).toBeLessThanOrEqual(viewport.height);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });

  test('@ui the attendee ticket fits a phone and its QR is fully on screen', async ({ page }) => {
    // The ticket is read at the door, on a phone, in the dark, by someone holding
    // it up to a scanner. A QR clipped by the viewport cannot be scanned at all.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      // Registered through the API, not the form: this test is about the TICKET's
      // layout, and spending a second browser registration would burn the 5/60s
      // per-IP limiter the whole suite shares.
      const api = new KefiPublicRegisterClient();
      const resp = await api.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-mticket`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'mticket'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        ticketToken: string;
        ticketUrl?: string;
        passNumber?: string;
      };
      ops.trackAttendee(created.attendeeExternalId);

      expect(
        created.ticketUrl,
        'the registration returns the ticket URL the attendee is told to keep',
      ).toBeTruthy();

      await page.goto(created.ticketUrl!, { waitUntil: 'networkidle' });

      // ── Does the ticket RENDER AT ALL? ───────────────────────────────────
      // Asserted before any layout measurement, because measuring the geometry
      // of an error page is meaningless. This is also the assertion the suite was
      // missing: `kefi-ubb-ticket-surface` proves `GET ticketUrl` returns 200,
      // but 200 is the SPA SHELL — the ticket is fetched by client JS afterwards,
      // so the page can return 200 and still show the buyer nothing.
      const body = page.locator('body');
      await expect(
        body,
        'the attendee ticket page renders an error instead of the ticket. The token is valid ' +
          '(the API returns 200 for it), but the page cannot load it — so the buyer has no ' +
          'ticket to show at the door',
      ).not.toContainText(/something went wrong|could not be loaded/i);

      await expect(
        body,
        'the ticket shows the pass number the attendee quotes at the door',
      ).toContainText(created.passNumber!);

      await expectNoHorizontalOverflow(page, 'the UBB attendee ticket');

      // The QR is the functional payload of this page. Located by tag/attribute
      // rather than a bespoke class so a re-render as <img>, <svg> or <canvas> is
      // still caught rather than silently skipped.
      //
      // ⚠️ `[role="img"][aria-label]` is NOT redundant with `img[alt]`. This page
      // is React-Native-web, which renders an <Image> as a <div role="img"
      // aria-label="…">, not an <img alt="…">. A CSS tag selector therefore never
      // matches it, and the test failed with "element(s) not found" while the QR
      // was demonstrably on the page (the a11y snapshot shows
      // `img "QR code for this ticket"` — that is the ROLE, not the tag).
      const qr = page
        .locator(
          'img[alt*="QR" i], img[src*="qr" i], svg.qr, canvas, ' +
            '[role="img"][aria-label*="QR" i]',
        )
        .first();
      await expect(qr, 'the ticket renders a QR code for the door scanner').toBeVisible();
      await expectWithinViewportWidth(page, qr, 'the ticket QR code');
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });
});
