/**
 * Kefi TICKET SURFACE E2E — the one page an attendee keeps.
 *
 * `GET /api/v1/ticket/{token}` is ANONYMOUS: the unguessable HMAC token in the
 * URL is the entire credential. There is no session, no bearer, no rate-limited
 * login in front of it. That makes two things load-bearing:
 *
 *   1. **It must carry what the attendee needs** — their pass number, their
 *      status, whether they have paid, and the tenant's payment instructions.
 *   2. **It must carry NOTHING ELSE.** Anything secret that reaches this
 *      projection is disclosed to whoever holds (or guesses, or is forwarded, or
 *      finds in a browser history / referrer log) one token. A Stripe key or
 *      webhook secret leaked here is leaked publicly.
 *
 * The `payment` block is specifically asserted to be `null` — not an object of
 * empty strings — when the tenant has configured no payment provider (UBB's live
 * state). A hollow object renders as a payment panel with blank fields, which
 * tells a buyer to "pay here" with nowhere to pay.
 *
 * ⚠️ NOTE ON THE PATH: the real route is `/api/v1/ticket/{token}`.
 * `/api/v1/t/ticket/{token}` 404s — it looks plausible because every other
 * public route is tenant-scoped under `/t/{slug}/`, but the ticket route is not.
 *
 * Also covers the ABSOLUTE `ticketUrl` the registration response returns: a
 * relative path would resolve against the TENANT host (`ubb.kefi.dloizides.com`),
 * which does not serve `/ticket` — so the link on the page telling the attendee
 * to keep their ticket would be dead.
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

// NOT serial: `workers: 1` already runs these sequentially (which the 5/60s
// per-IP register limit needs), while serial mode would additionally CASCADE-SKIP
// every test after the first failure — hiding exactly the assertions that matter
// most when something is already wrong.

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const PHONE = '+35799000000';
const STATUS_EXPECTED = 'Expected';

/**
 * Substrings that must never appear anywhere in a PUBLIC ticket projection.
 * Matched case-insensitively against the serialized body, so a nested or
 * renamed field (`stripeSecretKey`, `payment.webhookSecret`) is caught too.
 */
const FORBIDDEN_SECRET_MARKERS = [
  'stripe',
  'secret',
  'webhook',
  'last4',
  'apikey',
] as const;

test.describe('Kefi UBB ticket surface', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the ticket shows the attendee their pass, status and payment state', async () => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-ticket`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'ticket'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        passNumber: string;
        ticketToken: string;
      };
      ops.trackAttendee(created.attendeeExternalId);

      const tickets = new KefiTicketClient();
      const ticket = await tickets.getTicket(created.ticketToken);

      expect(ticket.status, 'the ticket renders for the token holder').toBe(HTTP_OK);
      expect(
        ticket.attendeeExternalId,
        'the ticket belongs to the attendee who registered',
      ).toBe(created.attendeeExternalId);
      expect(
        ticket.passNumber,
        'the ticket shows the pass number the attendee quotes at the door',
      ).toBe(created.passNumber);
      expect(
        ticket.statusLabel,
        'a freshly self-registered attendee reads as Expected, not admitted',
      ).toBe(STATUS_EXPECTED);
      expect(
        ticket.paid,
        'the ticket states the attendee has not paid — it is not valid until they do',
      ).toBe(false);

      // ── The payment block: null, or ACTIONABLE — never hollow ────────────
      //
      // This assertion used to read `toBeNull()`, on the premise that "UBB has no
      // payment provider configured today". That premise expired: UBB configured
      // manual-Revolut for the pre-sale, so the ticket now legitimately carries a
      // populated block and the old assertion failed on a correct product.
      //
      // Pinning the test to `null` was always pinning it to a TENANT SETTING
      // rather than to a contract. The defect actually worth guarding is
      // narrower and survives either configuration: a HOLLOW block — present, so
      // the page renders a "pay here" panel, but carrying no way to pay, which
      // reads to a buyer as a payment method that silently does nothing.
      expect(
        ticket.paymentKeyPresent,
        'the ticket carries a payment key so the page can branch on it',
      ).toBe(true);

      if (ticket.payment !== null) {
        const payment = ticket.payment as Record<string, unknown>;
        const actionableFields = ['revolutLink', 'qrImageUrl', 'instructions', 'paymentReference'];
        const populated = actionableFields.filter((field) => {
          const value = payment[field];
          return typeof value === 'string' && value.trim().length > 0;
        });

        expect(
          populated.length,
          'the ticket renders a payment panel whose every actionable field is blank — the buyer ' +
            'is shown "pay here" with no link, no QR, no reference and no instructions. Either ' +
            `configure the provider or project null. Saw: ${JSON.stringify(payment)}`,
        ).toBeGreaterThan(0);

        expect(
          payment['providerKind'],
          'a populated payment block names the provider the page must render for',
        ).toBeTruthy();
      }
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

  test('@api the public ticket projection leaks no secret-bearing field', async () => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-leak`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'leak'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as { attendeeExternalId: string; ticketToken: string };
      ops.trackAttendee(created.attendeeExternalId);

      const tickets = new KefiTicketClient();
      const ticket = await tickets.getTicket(created.ticketToken);
      expect(ticket.status, 'the ticket renders').toBe(HTTP_OK);

      const body = ticket.raw.toLowerCase();
      for (const marker of FORBIDDEN_SECRET_MARKERS) {
        expect(
          body.includes(marker),
          `the PUBLIC ticket body contains "${marker}" — this endpoint is guarded only by an ` +
            'unguessable token, so anything secret in it is disclosed to whoever holds the link',
        ).toBe(false);
      }
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

  test('@api a tampered ticket token is refused', async () => {
    // Creates nothing — a pure negative against forged tokens.
    const tickets = new KefiTicketClient();

    // A structurally plausible but never-issued token. If this rendered ANY
    // ticket, the token would not be functioning as a credential.
    const forged = 'zQU3RVQgD0WP2f6oXUZGuOO73C6lDF278CAeQl07NGU'.split('').reverse().join('');
    const resp = await tickets.getTicket(forged);
    expect(
      resp.status,
      'a forged token renders no ticket — the HMAC is the whole credential',
    ).toBe(HTTP_NOT_FOUND);

    const empty = await tickets.getTicket('not-a-real-token');
    expect(empty.status, 'a garbage token renders no ticket').toBe(HTTP_NOT_FOUND);
  });

  test('@api the registration returns an ABSOLUTE ticket URL that resolves', async ({
    request,
  }) => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-url`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'url'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        ticketToken: string;
        ticketUrl: string;
      };
      ops.trackAttendee(created.attendeeExternalId);

      // ── Absolute, not relative ───────────────────────────────────────────
      // A bare `/ticket/{token}` would resolve against the TENANT host the
      // buyer is standing on (`ubb.kefi.dloizides.com`), which serves no
      // `/ticket` route — so the "keep this link" the page shows would 404.
      expect(
        created.ticketUrl,
        'the ticket URL is absolute, so it cannot resolve against the tenant landing host',
      ).toMatch(/^https:\/\//);

      const parsed = new URL(created.ticketUrl);
      expect(
        parsed.pathname,
        "the absolute URL points at the attendee's own ticket",
      ).toContain(created.ticketToken);

      // ── And it actually resolves ─────────────────────────────────────────
      // Asserting the shape alone would still pass for an absolute URL pointing
      // at a host that serves nothing.
      const page = await request.get(created.ticketUrl, { failOnStatusCode: false });
      expect(
        page.status(),
        `the ticket URL the attendee is told to keep actually loads (${created.ticketUrl})`,
      ).toBe(HTTP_OK);
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

  test('@ui the ticket URL renders the attendee\'s actual ticket in a browser', async ({
    page,
  }) => {
    // ⚠️ THE GAP THE TEST ABOVE LEAVES OPEN, and it is not a small one.
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
