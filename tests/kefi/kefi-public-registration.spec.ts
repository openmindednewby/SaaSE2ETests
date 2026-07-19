/**
 * Kefi PUBLIC self-registration E2E — the front door of the whole product.
 *
 * `POST /api/v1/t/{slug}/register` is the only Kefi surface a stranger touches,
 * and the only one where a 400 means "nobody can sign up for your event". It has
 * already broken that way once in production: the GDPR consent field shipped as a
 * required `bool` while a caller (and the then-current form) omitted it, so EVERY
 * registration 400'd. That regression is the first assertion below and the reason
 * this spec asserts the FIELD-LEVEL error, not merely the status code — a 400 for
 * the wrong reason would otherwise look identical.
 *
 * Two tiers per the repo convention:
 *   `@api` — the contract: 201 shape, the consent wall (omitted AND explicit
 *            false, which bind identically), an invalid pass code, an unknown
 *            tenant. All four negatives assert on the message, so a future change
 *            that returns the right status for the wrong reason still fails.
 *   `@ui`  — the real static register form on `{slug}.kefi.dloizides.com/register`
 *            fills, submits and shows its success panel.
 *
 * PROD-SAFE: every attendee this spec creates is deleted in `finally`; addresses
 * are `@example.invalid` (RFC 2606) so no lifecycle sweep can ever mail them.
 * The negative cases create nothing at all.
 *
 * ⚠️ The route is rate-limited to 5 requests / 60 s per IP. Registrations here go
 * through `registerWithBackoff`, which waits out the window rather than flaking.
 */

import { test, expect } from '@playwright/test';

import { KefiPublicRegisterPage } from '../../pages/kefi/KefiPublicRegisterPage.js';
import {
  KefiPublicRegisterClient,
  allValidationMessages,
} from '../../helpers/kefi/kefiPublicRegisterClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  getKefiFixtureTenant,
  newEventOpsMarker,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const STATUS_EXPECTED = 'Expected';
const UNKNOWN_SLUG = 'no-such-kefi-tenant-e2e';
const UNKNOWN_PASS_CODE = 'NOT_A_REAL_PASS';
const DEFAULT_PASS_CODE = 'FULL';
const PHONE = '+35799000000';

test.describe('Kefi public registration', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api rejects a registration without consent, with a bad pass, or for an unknown tenant', async () => {
    const tenant = getKefiFixtureTenant();
    const register = new KefiPublicRegisterClient();
    const marker = newEventOpsMarker();
    const base = {
      name: 'E2E',
      surname: `${marker}-neg`,
      phone: PHONE,
      email: fixtureAttendeeEmail(marker, 'neg'),
      passCode: DEFAULT_PASS_CODE,
    };

    // ── 1. consentGiven OMITTED → 400 naming the consent field ──────────────
    // The production regression. A missing bool binds to false, so this is the
    // exact shape a client that predates the field sends.
    const omitted = await register.registerWithBackoff(tenant.slug, base);
    expect(omitted.status, 'registration without consentGiven is rejected').toBe(HTTP_BAD_REQUEST);
    expect(
      Object.keys((omitted.data as { errors: Record<string, string[]> }).errors),
      'the rejection names the consentGiven field (not some unrelated 400)',
    ).toContain('consentGiven');
    expect(
      allValidationMessages(omitted.data).join(' '),
      'the visitor is told they must accept the privacy notice',
    ).toMatch(/privacy notice/i);

    // ── 2. consentGiven EXPLICITLY false → the same 400 ─────────────────────
    const refused = await register.registerWithBackoff(tenant.slug, {
      ...base,
      consentGiven: false,
    });
    expect(refused.status, 'an explicit consentGiven:false is rejected too').toBe(HTTP_BAD_REQUEST);
    expect(
      Object.keys((refused.data as { errors: Record<string, string[]> }).errors),
      'an explicit false names the same field as an omitted one',
    ).toContain('consentGiven');

    // ── 3. An unknown pass code → 400 (NOT 404) naming the code ─────────────
    const badPass = await register.registerWithBackoff(tenant.slug, {
      ...base,
      passCode: UNKNOWN_PASS_CODE,
      consentGiven: true,
    });
    expect(badPass.status, 'an unknown pass code is a 400, not a 404').toBe(HTTP_BAD_REQUEST);
    expect(
      allValidationMessages(badPass.data).join(' '),
      'the rejection quotes the offending pass code',
    ).toContain(UNKNOWN_PASS_CODE);

    // ── 4. An unknown tenant slug → 404 ─────────────────────────────────────
    const unknownTenant = await register.registerWithBackoff(UNKNOWN_SLUG, {
      ...base,
      consentGiven: true,
    });
    expect(unknownTenant.status, 'an unknown tenant slug is a 404').toBe(HTTP_NOT_FOUND);
  });

  test('@api registers a visitor as Expected and returns their ticket token', async () => {
    const ops = await openEventOps();
    try {
      const register = new KefiPublicRegisterClient();
      const email = fixtureAttendeeEmail(ops.marker, 'happy');
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-happy`,
        phone: PHONE,
        email,
        passCode: DEFAULT_PASS_CODE,
        consentGiven: true,
      });

      expect(resp.status, 'a complete, consented registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        eventExternalId: string;
        passCode: string;
        passLabel: string;
        priceEur: number;
        status: string;
        ticketToken: string;
      };
      // Track it FIRST so a later assertion failure still cleans the row up.
      ops.trackAttendee(created.attendeeExternalId);

      expect(created.eventExternalId, 'the visitor is booked onto the fixture event').toBe(
        ops.tenant.eventExternalId,
      );
      expect(created.status, 'a self-registered visitor starts unpaid/pending').toBe(
        STATUS_EXPECTED,
      );
      expect(created.passCode, 'the requested pass is honoured').toBe(DEFAULT_PASS_CODE);
      expect(created.passLabel.length, 'the pass carries a human-readable label').toBeGreaterThan(0);
      expect(created.priceEur, 'the pass price is returned so the UI can ask for money')
        .toBeGreaterThan(0);
      expect(
        created.ticketToken.length,
        'an HMAC ticket token is issued so the visitor can reach their own ticket',
      ).toBeGreaterThan(0);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);
    }
  });

  test('@ui the public register form submits and shows the success panel', async ({ page }) => {
    const ops = await openEventOps();
    const form = new KefiPublicRegisterPage(page);
    let createdEmail = '';
    try {
      createdEmail = fixtureAttendeeEmail(ops.marker, 'ui');
      await form.goto(ops.tenant.siteUrl);

      await form.fill({
        name: 'E2E',
        surname: `${ops.marker}-ui`,
        phone: PHONE,
        email: createdEmail,
        passCode: DEFAULT_PASS_CODE,
        consent: true,
      });

      const status = await form.submitAndAwaitResponse(ops.tenant.slug);
      expect(status, 'the form POST is accepted').toBe(HTTP_CREATED);
      await form.expectSuccess();

      // The row must really exist server-side — a success panel rendered from a
      // stale/optimistic branch would otherwise pass. Reading it back also gives
      // us the id we need to delete it.
      const { KefiDoorLedgerClient } = await import(
        '../../helpers/kefi/kefiDoorLedgerClient.js'
      );
      const ledger = new KefiDoorLedgerClient();
      const view = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      const row = (view.data as { attendees: { email: string | null; attendeeExternalId: string }[] })
        .attendees.find((a) => a.email === createdEmail);
      expect(row, 'the UI registration reached the database').toBeDefined();
      ops.trackAttendee(row!.attendeeExternalId);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);
    }
  });
});
