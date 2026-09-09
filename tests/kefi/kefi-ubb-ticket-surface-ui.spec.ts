/**
 * Kefi TICKET SURFACE E2E (UI tier) — the one page an attendee keeps.
 *
 * Split out of `kefi-ubb-ticket-surface.spec.ts` (max-file-lines) — see that
 * file's sibling `kefi-ubb-ticket-surface-api.spec.ts` for the API-tier tests.
 *
 * PROD-SAFE: the single attendee is deleted in `finally`, roster asserted back
 * to baseline.
 */

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import { KefiTicketClient } from '../../helpers/kefi/kefiTicketClient.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const PHONE = '+35799000000';

test.describe('Kefi UBB ticket surface (UI render)', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the ticket URL renders the attendee\'s actual ticket in a browser', async ({
    page,
  }) => {
    // ⚠️ THE GAP AN API-ONLY CHECK LEAVES OPEN, and it is not a small one.
    //
    // `request.get(ticketUrl)` → 200 asserts that the SPA SHELL was served. The
    // ticket itself is fetched by client JS after the shell boots, so the HTTP
    // 200 says nothing about whether the buyer ever sees a ticket. A page that
    // renders "Something went wrong" for every attendee returns 200 all day.
    //
    // Nor does the `@api` tier cover it: those tests call the kefi API HOST
    // directly, while the browser calls the SAME endpoint through the app's BFF
    // proxy — a different path, with different auth, and the only one a real
    // buyer ever takes. Both tiers can be green while the product is dead.
    //
    // This test takes the buyer's path: a browser with NO session (an attendee
    // has no kefi-web account), following the link from their confirmation.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-render`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'render'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        ticketToken: string;
        ticketUrl: string;
        passNumber: string;
      };
      ops.trackAttendee(created.attendeeExternalId);

      // The token is good — established against the API before blaming the page,
      // so a failure below can only be the rendering path, never a bad token.
      const apiTicket = await new KefiTicketClient().getTicket(created.ticketToken);
      expect(
        apiTicket.status,
        'the API serves this ticket token, so the token itself is valid',
      ).toBe(HTTP_OK);

      await page.goto(created.ticketUrl, { waitUntil: 'domcontentloaded' });

      const body = page.locator('body');
      await expect(
        body,
        `the attendee ticket page shows an error instead of the ticket (${created.ticketUrl}). ` +
          'The token is valid — the API returns 200 for it — so every buyer following the link ' +
          'from their confirmation arrives at a dead page and has nothing to show at the door',
      ).not.toContainText(/something went wrong|could not be loaded/i);

      await expect(
        body,
        'the rendered ticket shows the pass number the attendee quotes at the door',
      ).toContainText(created.passNumber);
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
