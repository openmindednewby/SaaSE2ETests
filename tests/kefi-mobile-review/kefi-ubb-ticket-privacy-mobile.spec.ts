/**
 * Kefi attendee TICKET — the "Privacy & your data" disclosure at phone width.
 *
 * The GDPR data-rights controls were just RELOCATED on the public ticket page:
 * they used to render as a large, always-open card in the ticket body; they now
 * sit below the ticket/footer as a discreet, COLLAPSED "Privacy & your data"
 * link that expands the same card on demand
 * (`kefi-web/.../TicketDataRightsDisclosure.tsx`).
 *
 * This spec proves that relocation on a real 375×812 phone:
 *   1. the disclosure link is present and COLLAPSED by default (the card is not
 *      in the DOM until the link is pressed);
 *   2. pressing it reveals the card with all three capabilities still one tap
 *      away — Download (Art. 15), Delete (Art. 17) and the privacy notice;
 *   3. neither state scrolls the page sideways, and the pass number + QR the
 *      buyer shows at the door stay readable and on-screen.
 *
 * ── PROD-SAFETY ────────────────────────────────────────────────────────────
 * Registration creates a REAL row, so it runs ONLY against the dedicated `e2e`
 * fixture tenant (guarded by {@link fixtureTenantAvailable} + the customer-tenant
 * refusal in `kefiFixtureTenant.ts`), the attendee email is `@example.invalid`
 * (RFC 2606, non-deliverable), the id is tracked, and `ops.cleanup()` hard-
 * deletes it via `DELETE /api/v1/organizer/events/{eventId}/attendees/{id}` in a
 * `finally`. The roster is asserted back to its baseline size — no real row touched.
 *
 * Screenshots (for the mobile visual review) are written to `SHOT_DIR` when set.
 */

import fs from 'fs';
import path from 'path';

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiAttendeeAdminClient } from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
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

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const PHONE = '+35799000000';

const SHOT_DIR = process.env.SHOT_DIR ?? '';
function shot(name: string): string | undefined {
  if (SHOT_DIR.length === 0) return undefined;
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}
async function maybeShot(target: { screenshot: (o: { path: string }) => Promise<unknown> }, name: string): Promise<void> {
  const p = shot(name);
  if (p !== undefined) await target.screenshot({ path: p });
}

test.describe('Kefi attendee ticket — Privacy & your data disclosure (phone)', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web ticket surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the relocated data-rights disclosure is collapsed, expands to Download/Delete/Privacy, and never overflows', async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    testInfo.annotations.push({ type: 'viewport', description: `${viewport?.width}×${viewport?.height}` });

    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      // Register via the API (not the browser) — this test is about the TICKET,
      // and a second browser registration would burn the shared 5/60s per-IP limiter.
      const api = new KefiPublicRegisterClient();
      const resp = await api.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-privacy`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'privacy'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        ticketUrl?: string;
        passNumber?: string;
      };
      ops.trackAttendee(created.attendeeExternalId);
      expect(created.ticketUrl, 'the registration returns the ticket URL').toBeTruthy();

      // Mark the row PAID so the ticket unlocks its scannable door code (QR).
      // A freshly-registered row is "Payment pending → door code locked"; the QR
      // the buyer shows at the door only renders once the organizer confirms
      // payment. `paid: true` is a reversible toggle and the row is deleted anyway.
      const attendeeAdmin = new KefiAttendeeAdminClient();
      const marked = await attendeeAdmin.markPayment(ops.bearer, created.attendeeExternalId, {
        paid: true,
      });
      expect(marked.status, 'marking the attendee paid unlocks the door code').toBe(HTTP_OK);

      await page.goto(created.ticketUrl!, { waitUntil: 'domcontentloaded' });

      // The ticket must RENDER (200 is only the SPA shell; the ticket is fetched by JS).
      // The actionable wait below (ticket-screen visible) is the real settle signal.
      await expect(page.getByTestId('ticket-screen'), 'the ticket route mounts').toBeVisible({
        timeout: 45_000,
      });
      await expect(page.locator('body'), 'the ticket did not error').not.toContainText(
        /something went wrong|could not be loaded/i,
      );
      if (created.passNumber) {
        await expect(page.locator('body'), 'the ticket shows the door pass number').toContainText(
          created.passNumber,
        );
      }

      // Pass + QR readable and on-screen.
      const qr = page
        .locator('img[alt*="QR" i], img[src*="qr" i], svg.qr, canvas, [role="img"][aria-label*="QR" i]')
        .first();
      await expect(qr, 'the ticket renders a QR code for the door scanner').toBeVisible();
      await expectWithinViewportWidth(page, qr, 'the ticket QR code');
      await expectNoHorizontalOverflow(page, 'the attendee ticket (disclosure collapsed)');
      await maybeShot(page, 'ticket-full.png');

      // ── 1. COLLAPSED BY DEFAULT ─────────────────────────────────────────
      const disclosure = page.getByTestId('ticket-data-rights-disclosure');
      await disclosure.scrollIntoViewIfNeeded();
      await expect(disclosure, 'the "Privacy & your data" disclosure link is present').toBeVisible();
      await expect(disclosure, 'the disclosure carries the expected label').toContainText(
        /Privacy & your data/i,
      );
      await expect(
        page.getByTestId('ticket-data-rights-disclosure-body'),
        'the data-rights card is COLLAPSED by default — not in the DOM until pressed',
      ).toHaveCount(0);
      await expectWithinViewportWidth(page, disclosure, 'the disclosure link');
      await maybeShot(page, 'ticket-disclosure-collapsed.png');

      // ── 2. EXPANDS TO DOWNLOAD / DELETE / PRIVACY ───────────────────────
      await disclosure.click();
      const body = page.getByTestId('ticket-data-rights-disclosure-body');
      await expect(body, 'pressing the link reveals the data-rights card').toBeVisible();
      await expect(body, 'the expanded card offers the Art.15 DOWNLOAD').toContainText(
        /Download my data/i,
      );
      await expect(body, 'the expanded card offers the Art.17 DELETE path').toContainText(
        /Deleting your data/i,
      );
      await expect(body, 'the expanded card links the PRIVACY notice').toContainText(
        /Read the privacy notice/i,
      );

      // ── 3. STILL NO SIDEWAYS SCROLL WHEN EXPANDED ───────────────────────
      await expectNoHorizontalOverflow(page, 'the attendee ticket (disclosure expanded)');
      await expectWithinViewportWidth(page, body, 'the expanded data-rights card');
      await body.scrollIntoViewIfNeeded();
      await maybeShot(page, 'ticket-disclosure-expanded.png');
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was hard-deleted').toEqual([]);
      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });
});
