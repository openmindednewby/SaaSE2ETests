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
 *      ticket page (`app/ticket/[token].tsx` → TicketScreen → TicketQrPanel)
 *      renders from.
 *
 *      ⚠️ CORRECTED 2026-09-05 (task R11/R12). The header used to state that
 *      "there is no literal QR-image component; the page IS the rendered
 *      ticket", and that a fresh deep-link of `/ticket/{token}` was not served.
 *      BOTH are now false. `TicketQrPanel` draws a real scannable symbol
 *      (`ticket-qr-symbol`) or, when the gate withholds it, a locked placeholder
 *      (`ticket-qr-withheld`) — and the deep-link is served, which is why the UI
 *      legs below drive the real page instead of stopping at the API.
 *   3. NEGATIVE token — a tampered token and a structurally-bogus token are
 *      rejected: API 404 (HMAC tamper-evident, constant-time compare).
 *   4. THE SYMBOL ENCODES `/admit/`, NOT `/ticket/` — asserted explicitly. See
 *      the long note on step 7: a silent fallback in the renderer re-introduces
 *      the "scanning does nothing" bug, and no unit suite can catch it.
 *   5. CONFIRMED → SCANNED — the attendee is confirmed (Paid), the phone-camera
 *      admission pair is driven for real (`GET /admit/{t}` is proven read-only,
 *      then `POST /admit/{t}/check-in` → 200 `CheckedIn`), and the ticket + the
 *      door-side snapshot both reflect it.
 *   6. REPEAT SCAN — a second scan is **HTTP 409** with `outcome`
 *      `AlreadyCheckedIn` and the earlier stamp on `previousCheckIn`. That is a
 *      normal product outcome, NOT an error, and the admit screen renders it as
 *      the amber state with no retry affordance.
 *   7. ANTI-PASS-BACK — once `CheckedIn` the ticket page draws NO symbol at all:
 *      `ticket-qr-symbol` is absent from the DOM, not merely hidden or dimmed.
 *   8. UNKNOWN / TAMPERED admit token — 404 on both verbs, and the screen fails
 *      cleanly rather than offering admission.
 *   9. DOOR dashboard role gate — GET /door/events/{id} is not anonymously
 *      readable: no bearer / a wrong-role bearer are rejected (401 / 403).
 *
 * API-only vs UI (traced from KefiService/Kefi/src):
 *   - Ticket issue: API. Render/verify: API + UI. Door dashboard read: role-gated
 *     (door-staff PIN tokens come from the Keycloak pin-authenticator JAR, not an
 *     E2E ROPC flow — so the read is asserted via its negative auth gate).
 *   - ⚠️ CORRECTED 2026-09-05 (task R12). The header used to state that "the door
 *     check-in WRITE has NO product scan → mark-attended HTTP endpoint yet", and
 *     the check-in below was therefore faked with a canary admin seed. That is
 *     now false: `GET /api/v1/admit/{token}` +
 *     `POST /api/v1/admit/{token}/check-in` are the real product pair a phone
 *     camera reaches, and this spec drives THEM. The canary seed is kept only
 *     for the Paid transition, which still has no anonymous write path.
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
import { KefiTicketClient, admitTokenFromUrl } from '../../helpers/kefi/kefiTicketClient.js';
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
const HTTP_CONFLICT = 409;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const DOOR_GATE_STATUSES = [HTTP_UNAUTHORIZED, HTTP_FORBIDDEN];

const STATUS_EXPECTED = 'Expected';
const STATUS_PAID = 'Paid';
const STATUS_CHECKED_IN = 'CheckedIn';

const BOGUS_TOKEN = 'this-is-not-a-valid-ticket-token';
const OUTCOME_CHECKED_IN = 'CheckedIn';
const OUTCOME_ALREADY = 'AlreadyCheckedIn';
const DEVICE_LABEL = 'E2E Door A';
const UI_TIMEOUT_MS = 45_000;

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

      // -- 7. THE SYMBOL MUST ENCODE /admit/, NOT /ticket/ -----------------
      //
      // WHY THIS ASSERTION EXISTS, AND WHY IT IS MADE HERE. The renderer
      // (`ticketAdmissionHelpers.ts` -> `resolveTicketQrUrl`) falls back to the
      // OLD read-only `/ticket/{token}` URL whenever `admitUrl` is absent from
      // the response, and the fallback is SILENT. A kefi-web unit test asserts
      // that fallback as expected behaviour, so if the server field is ever
      // dropped, renamed, or simply not deployed, the original "scanning the QR
      // does nothing" bug returns with every unit suite still green.
      //
      // WHAT THIS ASSERTS ON, AND WHY NOT THE DOM. The symbol is drawn as a
      // single SVG <Path>; the encoded string appears NOWHERE in the DOM (the
      // element's accessibilityLabel is static copy, not the URL), and this spec
      // may not add a data attribute to kefi-web to expose it. So the encoded
      // VALUE is asserted at `admitUrl` -- the exact field whose absence triggers
      // the silent fallback -- and is then proven to be a working admission
      // credential by driving it end-to-end in steps 9-11. Asserting merely that
      // "a QR element exists" would be a check that cannot fail, which is worse
      // than no check at all.
      const paidTicket = await tickets.getTicket(token!);
      expect(paidTicket.admitUrl, 'the ticket carries an admitUrl to encode').toBeTruthy();
      expect(
        paidTicket.admitUrl!,
        'the QR encodes the ADMIT url. A /ticket/ url here means the renderer fell back and a ' +
          'phone-camera scan would silently do nothing - the exact bug R12 exists to fix.',
      ).toContain('/admit/');
      const admitToken = admitTokenFromUrl(paidTicket.admitUrl!);
      expect(admitToken, 'an admit token is extractable from admitUrl').toBeTruthy();
      expect(
        admitToken,
        'the admit token is a SEPARATE capability from the read token - an equal value would mean ' +
          'a forwarded ticket link doubles as a check-in button',
      ).not.toBe(token);

      // -- 8. TICKET UI while Paid - the symbol IS drawn --------------------
      const { webUrl } = getKefiUrls();
      await page.goto(`${webUrl}/ticket/${token!}`);
      await expect(
        page.getByTestId('ticket-qr-panel'),
        'the paid ticket renders its QR panel',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('ticket-qr-symbol'),
        'a PAID, un-scanned ticket draws a scannable symbol',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('ticket-qr-withheld'),
        'and shows no withheld placeholder while the code is live',
      ).toHaveCount(0);

      // -- 9. GET /admit/{token} MUTATES NOTHING ---------------------------
      // Load-bearing: WhatsApp/iMessage/Slack fetch URLs to build link
      // previews. A GET that admitted would check in every ticket forwarded
      // into a group chat, before anyone left home.
      const admitRead = await tickets.getAdmit(admitToken);
      expect(admitRead.status, 'GET /admit/{token} resolves the holder').toBe(HTTP_OK);
      expect(admitRead.attendeeExternalId, 'admit resolves the SAME holder').toBe(attendeeId);
      expect(admitRead.admissible, 'a paid, unused pass is admissible').toBe(true);
      expect(admitRead.existingCheckIn, 'nothing is stamped yet').toBeNull();
      expect(
        statusInSnapshot(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'the READ did not mark attendance - a link-preview fetch must not admit anybody',
      ).toBe(STATUS_PAID);

      // -- 10. THE SCAN - the phone-camera write marks attendance ----------
      const scanned = await tickets.admitCheckIn(admitToken, DEVICE_LABEL);
      expect(scanned.status, 'a fresh scan admits the holder').toBe(HTTP_OK);
      expect(scanned.outcome, 'and reports it as CheckedIn').toBe(OUTCOME_CHECKED_IN);
      expect(scanned.checkIn, 'the scan wrote a stamp').not.toBeNull();
      expect(scanned.checkIn!.atUtc, 'the stamp carries an instant').toBeTruthy();
      expect(
        (await tickets.getTicket(token!)).statusLabel,
        'the ticket reflects the scan (CheckedIn)',
      ).toBe(STATUS_CHECKED_IN);
      expect(
        statusInSnapshot(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'the door-side snapshot marks the attendee CheckedIn',
      ).toBe(STATUS_CHECKED_IN);

      // -- 11. REPEAT SCAN - 409, with the earlier stamp. NOT an error. ----
      const repeat = await tickets.admitCheckIn(admitToken, DEVICE_LABEL);
      expect(
        repeat.status,
        'a repeat scan is 409 - a duplicate that reached the client looking like a success would ' +
          'ship the exact bug this feature exists to fix',
      ).toBe(HTTP_CONFLICT);
      expect(repeat.outcome, 'and names itself AlreadyCheckedIn').toBe(OUTCOME_ALREADY);
      expect(repeat.previousCheckIn, 'the 409 body carries the EARLIER stamp').not.toBeNull();
      expect(
        repeat.previousCheckIn!.atUtc,
        'the earlier stamp quotes when they came in, so the door can settle the argument',
      ).toBeTruthy();
      const snapshotAfterRepeat = await lifecycle.getCanaryAttendees(ctx.canaryId);
      expect(
        statusInSnapshot(snapshotAfterRepeat, attendeeId!),
        'a repeat scan leaves the attendee CheckedIn (no corruption)',
      ).toBe(STATUS_CHECKED_IN);
      expect(
        countByEmail(snapshotAfterRepeat, attendeeEmail),
        'a repeat scan does not create a second admission row',
      ).toBe(1);

      // -- 12. ANTI-PASS-BACK - a spent ticket draws NO symbol at all ------
      // A ticket URL is a BEARER credential: the holder can forward the link
      // from inside the venue. So the geometry must be GONE, not greyed -
      // styling is the least durable layer we have (print stylesheet, reader
      // mode, screenshot with contrast pushed up).
      await page.goto(`${webUrl}/ticket/${token!}`);
      await expect(
        page.getByTestId('ticket-qr-withheld'),
        'a scanned ticket shows the locked placeholder that names the reason',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('ticket-qr-symbol'),
        'and the scannable symbol is ABSENT FROM THE DOM - not hidden, not dimmed. Anything with ' +
          'path data still on the page can be handed back by a stylesheet or a screenshot.',
      ).toHaveCount(0);
      await expect(
        page.getByTestId('ticket-pass-number'),
        'the pass number stays - once the symbol is gone it is all the door has to work with',
      ).toBeVisible();

      // -- 13. ADMIT SCREEN, second scan - amber, stamped, no retry --------
      await page.goto(`${webUrl}/admit/${admitToken}`);
      await expect(
        page.getByTestId('admit-screen'),
        'the admit route mounts for a genuine token',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('admit-pass-number'),
        'the screen names who is at the door by pass number',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('admit-confirm-button'),
        'an ALREADY-admitted pass offers no second confirm',
      ).toHaveCount(0);
      await expect(
        page.getByTestId('admit-retry-button'),
        'and offers no retry - a repeat scan is a verdict, not a failure to retry',
      ).toHaveCount(0);
      await expect(
        page.getByTestId('admit-body'),
        'the amber state quotes the stamp rather than reading as a generic error',
      ).not.toBeEmpty();

      // -- 14. UNKNOWN / TAMPERED admit token fails cleanly ----------------
      expect(
        (await tickets.getAdmit(BOGUS_TOKEN)).status,
        'an unknown admit token reads as not-found',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await tickets.getAdmit(tamperToken(admitToken))).status,
        'a tampered admit token is rejected (HMAC is purpose-bound + tamper-evident)',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await tickets.admitCheckIn(BOGUS_TOKEN)).status,
        'and it cannot be used to admit anybody',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await tickets.getAdmit(token!)).status,
        'the READ ticket token cannot be replayed as an admit token - purpose separation',
      ).toBe(HTTP_NOT_FOUND);

      await page.goto(`${webUrl}/admit/${BOGUS_TOKEN}`);
      await expect(
        page.getByTestId('admit-screen'),
        'the admit route still MOUNTS for a dud token - a white page reads as "app broken"',
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(
        page.getByTestId('admit-confirm-button'),
        'and never offers admission on a pass the server did not vouch for',
      ).toHaveCount(0);

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
