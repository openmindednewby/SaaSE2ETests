/**
 * Kefi attendee GDPR export + erasure E2E (task #276 gap #6).
 *
 * EU-SaaS compliance obligation — Poueni has a GDPR spec, Kefi did not. An
 * attendee proves identity by holding their HMAC ticket token (no JWT), so the
 * data-subject endpoints are anonymous + token-keyed:
 *
 *   1. register an attendee → the register response mints the ticket token.
 *   2. EXPORT — GET /ticket/{token}/export returns the holder's own PII
 *      (email + name), `isErased` false. A bogus token → 404 (existence never leaks).
 *   3. ERASE — POST /ticket/{token}/erasure → 200 `attendeeErased: true`.
 *   4. EXPORT again — the contact PII is now cleared and `isErased` is true.
 *   5. ERASE again — an idempotent no-op (`attendeeErased: false`).
 *
 * Pure `@api`. The register + GDPR calls are anonymous, but seeding the event
 * needs a provisioned tenant → master-admin (staging only; prod self-skips).
 * WRITE + COMPILE-verified — the authed provisioning runs post-F1-kefi.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import { KefiTicketClient } from '../../helpers/kefi/kefiTicketClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 0 } as const;

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const BOGUS_TOKEN = 'this-is-not-a-valid-ticket-token';

test.describe('Kefi attendee GDPR export + erasure (#276)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi GDPR E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@api an attendee exports their data, then erases it (idempotently)', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a Pro tenant + owner + event via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const tickets = new KefiTicketClient();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const attendeeEmail = handle.ctx.email.replace('@', '-gdpr@');
    const attendeeName = 'Gdpr';

    try {
      // ── 1. Register an attendee → the ticket token is minted ───────────
      const reg = await lifecycle.registerAttendeeFull({
        slug: handle.slug, name: attendeeName, surname: 'Subject', phone: '+35799000801',
        email: attendeeEmail, passCode: PASS.code, consentGiven: true,
      });
      expect(reg.status, 'register with consent → 201').toBe(HTTP_CREATED);
      const token = reg.ticketToken;
      expect(token, 'register minted a ticket token').toBeTruthy();

      // ── 2. EXPORT — the holder's own PII is returned ───────────────────
      const beforeErase = await tickets.exportTicketData(token!);
      expect(beforeErase.status, 'export → 200').toBe(HTTP_OK);
      expect(beforeErase.email, 'export returns the attendee email').toBe(attendeeEmail);
      expect(beforeErase.name, 'export returns the attendee name').toBe(attendeeName);
      expect(beforeErase.isErased, 'a live attendee is not erased').toBe(false);

      // A bogus token must not leak existence — 404.
      expect(
        (await tickets.exportTicketData(BOGUS_TOKEN)).status,
        'bogus-token export → 404',
      ).toBe(HTTP_NOT_FOUND);

      // ── 3. ERASE — the contact PII is purged ───────────────────────────
      const erase = await tickets.eraseTicketData(token!);
      expect(erase.status, 'erasure → 200').toBe(HTTP_OK);
      expect(erase.attendeeErased, 'the attendee was erased').toBe(true);

      // ── 4. EXPORT again — PII cleared, isErased flag set ───────────────
      const afterErase = await tickets.exportTicketData(token!);
      expect(afterErase.status, 'post-erase export still 200').toBe(HTTP_OK);
      expect(afterErase.isErased, 'the attendee is now flagged erased').toBe(true);
      expect(afterErase.email, 'the contact email is cleared after erasure').not.toBe(attendeeEmail);

      // ── 5. ERASE again — idempotent no-op ──────────────────────────────
      const secondErase = await tickets.eraseTicketData(token!);
      expect(secondErase.status, 'second erasure still 200').toBe(HTTP_OK);
      expect(secondErase.attendeeErased, 'a re-erasure is an idempotent no-op').toBe(false);
    } finally {
      await teardownApiTenant(handle, admin);
    }
  });
});
