/**
 * Kefi UBB — the ATTENDEE TICKET at phone width.
 *
 * The ticket is the thing the buyer actually holds at the door: on a phone, one
 * -handed, in a dark venue, with a queue behind them. So the properties that
 * matter are geometric and behavioural, not data-shaped.
 *
 * ── SCOPE, AND WHAT IS DELIBERATELY MISSING ────────────────────────────────
 * This file covers the INVALID-token path only, and that is a prod-safety
 * decision rather than an oversight.
 *
 * Rendering a VALID ticket requires a valid HMAC token, which requires an
 * attendee row. UBB is a live tenant whose pre-sale opens within a day, and an
 * earlier probe registration already left an orphan row on the real roster — so
 * this suite will not create one. The alternative, reading an existing REAL
 * attendee's ticket, means pulling a paying customer's name and pass onto a CI
 * console, which is worse.
 *
 * The valid-ticket mobile layout is therefore NOT proven here. It is covered by
 * `kefi-ubb-mobile.spec.ts`, which registers its own row and deletes it — that
 * file should be pointed at a non-UBB tenant before it is run again.
 *
 * What IS proven here is the path every mistyped, truncated, expired or
 * shared-wrong link lands on. That path matters more than it looks: a link
 * broken by a messaging app's URL truncation is the single most likely ticket
 * failure on the night, and the difference between a friendly "ticket not
 * found" and a blank screen or a crash is the difference between an attendee
 * asking the door for help and an attendee believing they have been scammed.
 */

import { test, expect } from '@playwright/test';

import { attachConsoleGuard } from '../../helpers/consoleGuard.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { expectNoHorizontalOverflow } from '../../helpers/kefi/mobileLayout.js';
import { isRemoteTarget } from '../../helpers/target.js';

/**
 * A syntactically plausible but unissued token. Deliberately NOT random junk:
 * it has to survive routing and reach the real lookup, so the 404 comes from
 * the ticket service rather than from a router that rejected the shape.
 */
const UNKNOWN_TOKEN = 'e2e-unknown-ticket-token-0000000000000000';

test.describe('Kefi UBB attendee ticket on a phone', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web ticket surface');

  test('@ui an unknown ticket token shows a friendly not-found state, not a crash', async ({
    page,
  }, testInfo) => {
    const guard = attachConsoleGuard(page);
    const { webUrl } = getKefiUrls();

    const viewport = page.viewportSize();
    testInfo.annotations.push({
      type: 'viewport',
      description: `${viewport?.width}×${viewport?.height}`,
    });

    await page.goto(`${webUrl}/ticket/${UNKNOWN_TOKEN}`);

    // The screen must MOUNT. A white page here means the SPA failed to boot for
    // this route, which looks identical to "no ticket" for the attendee but has
    // a completely different cause.
    await expect(
      page.getByTestId('ticket-screen'),
      'the ticket route mounts even for a token that resolves to nothing',
    ).toBeVisible({ timeout: 45_000 });

    // Then settle on the ERROR card specifically — not merely "not the ticket".
    // The loading card is also "not the ticket", and a spinner that never
    // resolves is exactly the failure this assertion has to catch.
    await expect(
      page.getByTestId('ticket-error'),
      'an unknown token settles on the friendly not-found card. If this never appears the ' +
        'attendee is left on a spinner, which reads as "the app is broken" rather than "check ' +
        'your link" — at the door, in a queue, that is the difference between asking for help ' +
        'and assuming they have been scammed.',
    ).toBeVisible({ timeout: 45_000 });

    await expect(
      page.getByTestId('ticket-loading'),
      'the loading state gave way rather than persisting behind the error card',
    ).toHaveCount(0);

    // The error card must itself be readable on a phone — an error page that
    // scrolls sideways is its own small insult.
    await expectNoHorizontalOverflow(page, 'the ticket not-found page');

    // A 404 from the ticket fetch is EXPECTED here and is logged by the network
    // layer; it is the product behaving correctly. Anything else is not.
    guard.expectClean('the ticket not-found page', [
      /404/,
      /Failed to load resource/i,
      /ticket/i,
    ]);
  });
});
