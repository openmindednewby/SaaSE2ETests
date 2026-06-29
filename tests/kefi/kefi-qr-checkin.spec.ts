/**
 * Kefi QR-ticket render + door check-in E2E (KEFI-1 gap).
 *
 * KEFI-1 flags the "QR / reservation links" path as one of the two LEAST-tested
 * parts of the paying customer's (united-by-salsa) critical journey. This spec
 * closes that gap, exercising the real ticket surfaces end-to-end:
 *
 *   1. A canary tenant + Published event + a self-registered attendee → the
 *      register endpoint mints an HMAC-signed ticket token (the unguessable
 *      "QR" link) and returns it as `ticketToken` + `ticketPath`.
 *   2. RENDER / VERIFY — the public ticket endpoint validates a genuine token:
 *      GET /ticket/{token} → 200 + own-row projection (holder + event + status);
 *      the /mediaTicket alias → 200. This is the server contract the kefi-web
 *      ticket page (`app/ticket/[token].tsx` → TicketScreen/TicketSurface) renders
 *      from. The "QR" here is the signed-token link itself — there is no literal
 *      QR-image component; the page IS the rendered ticket.
 *
 *      API-only on purpose: the kefi-web ticket page is reached in-app via an
 *      in-SPA `router.push(ticketPath)` after registration — a FRESH deep-link of
 *      `/ticket/{token}` is not served as a static route by the staging SPA host
 *      (it returns the host's nginx 404, an SPA-fallback/deploy concern, not the
 *      ticket logic). So the render/verify is asserted at the authoritative API
 *      contract; the TicketScreen/TicketSurface components are covered by
 *      kefi-web unit tests.
 *   3. NEGATIVE token — a tampered token and a structurally-bogus token are
 *      rejected: API 404 (HMAC tamper-evident, constant-time compare).
 *   4. CONFIRMED → CHECKED-IN lifecycle — the attendee is confirmed (Paid) then
 *      checked in at the door (CheckedIn); the ticket reflects each transition
 *      and the door-side snapshot marks the attendee attended.
 *   5. DOUBLE check-in — re-checking the same ticket is an idempotent no-op
 *      (still CheckedIn, still a single row — no second admission).
 *   6. DOOR dashboard role gate — GET /door/events/{id} is not anonymously
 *      readable: no bearer / a wrong-role bearer are rejected (401 / 403).
 *
 * API-only vs UI (traced from KefiService/Kefi/src):
 *   - Ticket issue: API. Render/verify: API + UI. Door dashboard read: role-gated
 *     (door-staff PIN tokens come from the Keycloak pin-authenticator JAR, not an
 *     E2E ROPC flow — so the read is asserted via its negative auth gate).
 *   - The door check-in WRITE has NO product "scan → mark attended" HTTP endpoint
 *     yet: `Attendee.CheckIn()`/`AttendeeStatus.CheckedIn` exist, but the only
 *     write path to CheckedIn today is the domain transition, reachable in E2E
 *     via the canary admin seed. This spec exercises that transition and notes
 *     the missing door-staff scan endpoint.
 *
 * Rides the #185 platform-admin canary endpoints. Runs on staging + prod via
 * E2E_TARGET; local is skipped (the canary rig isn't wired into the dev loop).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import {
  KefiLifecycleClient,
  type CanaryAttendeesResult,
} from '../../helpers/kefi/kefiLifecycleClient.js';
import { KefiTicketClient } from '../../helpers/kefi/kefiTicketClient.js';
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 0 } as const;

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const DOOR_GATE_STATUSES = [HTTP_UNAUTHORIZED, HTTP_FORBIDDEN];

const STATUS_EXPECTED = 'Expected';
const STATUS_PAID = 'Paid';
const STATUS_CHECKED_IN = 'CheckedIn';

const BOGUS_TOKEN = 'this-is-not-a-valid-ticket-token';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mailbox(): KefiMailbox {
  return new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
}

/**
 * Tamper a genuine token so its HMAC no longer verifies. Flipping the FIRST
 * base64url char mutates byte 0 of the attendee-id payload, so the recomputed
 * tag can never match the presented tag — a guaranteed 404.
 */
function tamperToken(token: string): string {
  const replacement = token.charAt(0) === 'A' ? 'B' : 'A';
  return `${replacement}${token.slice(1)}`;
}

/** Resolve one attendee's lifecycle status from the canary snapshot by external id. */
function statusInSnapshot(snapshot: CanaryAttendeesResult, externalId: string): string {
  const match = snapshot.attendees.find((a) => a.externalId === externalId);
  expect(match, `attendee ${externalId} present in canary snapshot`).toBeDefined();
  return match!.status;
}

/** How many snapshot rows carry the given email — guards against a double-admission row. */
function countByEmail(snapshot: CanaryAttendeesResult, email: string): number {
  return snapshot.attendees.filter((a) => a.email === email).length;
}

test.describe('Kefi QR ticket render + door check-in (KEFI-1)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi QR/check-in E2E targets staging+prod; local canary rig not wired in dev-loop yet',
  );

  test('issues an HMAC ticket, renders it, checks the attendee in, and gates the door list', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const tickets = new KefiTicketClient();
    const attendeeEmail = ctx.email.replace('@', '-att@');
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. Verified canary tenant (signup → IMAP verify → wizard) ─────────
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const verifyCaptured = await mailbox().waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(verifyCaptured);
      expect(verifyUrl, 'verify URL').not.toBeNull();
      await page.goto(verifyUrl!);

      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      await wizard.fillFastPath({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso: toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY)),
      });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: ctx.email,
        password: ctx.password,
      });
      await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer: ownerBearer, code: 'pro' });
      await wizard.finishFromReview();

      // ── 2. Seed a Published event + a pass so the public register works ───
      const seeded = await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId,
        eventDateOffsetDays: CANARY_EVENT_DAYS_AHEAD,
        status: 'Published',
        passCode: PASS.code,
        passLabel: PASS.label,
        priceEur: PASS.priceEur,
      });
      expect(seeded.found, 'canary tenant found for seeding').toBe(true);
      const { slug, eventExternalId } = seeded;

      // ── 3. Register an attendee → an HMAC ticket token is ISSUED ──────────
      const reg = await lifecycle.registerAttendeeFull({
        slug, name: 'QR', surname: 'Canary', phone: '+35799000300',
        email: attendeeEmail, passCode: PASS.code, consentGiven: true,
      });
      expect(reg.status, 'register with consent').toBe(HTTP_CREATED);
      const attendeeId = reg.attendeeExternalId;
      const token = reg.ticketToken;
      expect(attendeeId, 'attendee externalId from register').toBeTruthy();
      expect(token, 'HMAC ticket token from register').toBeTruthy();
      expect(reg.ticketPath, 'ticket path mirrors the token').toBe(`/ticket/${token!}`);
      expect(reg.eventExternalId, 'register booked the seeded event').toBe(eventExternalId);

      // ── 4. RENDER / VERIFY — the genuine token resolves the ticket ────────
      const ticket = await tickets.getTicket(token!);
      expect(ticket.status, 'GET /ticket/{token} renders').toBe(HTTP_OK);
      expect(ticket.attendeeExternalId, 'ticket is the holder own row').toBe(attendeeId);
      expect(ticket.eventExternalId, 'ticket admits to the booked event').toBe(eventExternalId);
      expect(ticket.passCode, 'ticket shows the holder pass').toBe(PASS.code);
      expect(ticket.statusLabel, 'fresh ticket is Expected').toBe(STATUS_EXPECTED);
      expect(
        await tickets.getMediaTicketStatus(token!),
        '/mediaTicket alias also renders',
      ).toBe(HTTP_OK);

      // ── 5. NEGATIVE token — tampered + bogus tokens are rejected ──────────
      const tampered = tamperToken(token!);
      expect(
        (await tickets.getTicket(tampered)).status,
        'tampered token → 404',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await tickets.getTicket(BOGUS_TOKEN)).status,
        'structurally-bogus token → 404',
      ).toBe(HTTP_NOT_FOUND);

      // ── 6. CONFIRMED reservation — the ticket reflects the Paid transition ─
      const paidSeed = await lifecycle.seedCanaryAttendee({
        canaryId: ctx.canaryId, email: attendeeEmail,
        passCode: PASS.code, status: STATUS_PAID, consentGiven: true,
      });
      expect(paidSeed.attendeeExternalId, 'seed upserts the SAME registered row').toBe(attendeeId);
      expect(
        (await tickets.getTicket(token!)).statusLabel,
        'ticket now shows Paid (confirmed reservation)',
      ).toBe(STATUS_PAID);

      // ── 7. DOOR check-in — mark the attendee attended at the door ─────────
      // NOTE: there is no product door-staff "scan → mark attended" HTTP
      // endpoint yet; the only write path to CheckedIn is the domain transition,
      // exercised here via the canary admin seed.
      const checkInSeed = await lifecycle.seedCanaryAttendee({
        canaryId: ctx.canaryId, email: attendeeEmail,
        passCode: PASS.code, status: STATUS_CHECKED_IN, consentGiven: true,
      });
      expect(checkInSeed.attendeeExternalId, 'check-in hits the SAME row').toBe(attendeeId);
      expect(
        (await tickets.getTicket(token!)).statusLabel,
        'ticket reflects the door check-in (CheckedIn)',
      ).toBe(STATUS_CHECKED_IN);
      const afterCheckIn = await lifecycle.getCanaryAttendees(ctx.canaryId);
      expect(
        statusInSnapshot(afterCheckIn, attendeeId!),
        'door-side snapshot marks the attendee CheckedIn',
      ).toBe(STATUS_CHECKED_IN);

      // ── 8. DOUBLE check-in — re-scanning the ticket is an idempotent no-op ─
      await lifecycle.seedCanaryAttendee({
        canaryId: ctx.canaryId, email: attendeeEmail,
        passCode: PASS.code, status: STATUS_CHECKED_IN, consentGiven: true,
      });
      const afterDouble = await lifecycle.getCanaryAttendees(ctx.canaryId);
      expect(
        statusInSnapshot(afterDouble, attendeeId!),
        'double check-in leaves the attendee CheckedIn (no corruption)',
      ).toBe(STATUS_CHECKED_IN);
      expect(
        countByEmail(afterDouble, attendeeEmail),
        'double check-in does not create a second admission row',
      ).toBe(1);

      // ── 9. DOOR dashboard is role-gated (not anonymously readable) ────────
      const noBearer = await tickets.getDoorListStatus(eventExternalId);
      expect(noBearer, 'door list with no bearer is rejected').not.toBe(HTTP_OK);
      expect(DOOR_GATE_STATUSES, 'door list without auth → 401/403').toContain(noBearer);

      const wrongRole = await tickets.getDoorListStatus(eventExternalId, await admin.getBearer());
      expect(wrongRole, 'door list with a non-door-staff bearer is rejected').not.toBe(HTTP_OK);
      expect(DOOR_GATE_STATUSES, 'door list with wrong role → 401/403').toContain(wrongRole);

      // ── 10. Mailbox hygiene (the verify mail is the only one we triggered) ─
      await mailbox().expungeMessages([verifyCaptured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});
