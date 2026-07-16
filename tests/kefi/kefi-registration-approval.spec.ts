/**
 * Kefi registration-request submit → approve / reject E2E (task #276, gap #1).
 *
 * The core operational loop of a real event: an ambassador submits a registration
 * request for an attendee; an organizer approves it (which CREATES an attendee)
 * or rejects it (which does NOT). Today this had ZERO coverage — the only
 * "approval" spec (`kefi-backoffice-approval`) is a mis-named subscription
 * override. This closes the missing middle of the katastasi-flagged critical
 * path (registration → approval → payment → check-in).
 *
 * Two tiers (CLAUDE.md two-tier E2E preference):
 *   1. `@api`  — the full submit→list→approve/reject STATE MACHINE, no browser.
 *               Master-admin provisions a Pro tenant + owner + ambassador headlessly;
 *               asserts the transitions, the 409 double-decide guard, the 401/403
 *               auth+role walls, and that an APPROVED request materialises as an
 *               `Expected` attendee while a REJECTED one does not.
 *   2. `@ui`   — the organizer approvals SURFACE (`app/organizer/approvals.tsx`):
 *               a real signup owner opens the queue, sees the ambassador-submitted
 *               request, clicks Approve, and the request leaves the pending queue.
 *
 * Target: staging (needs KC master-admin to mint the ambassador; prod omits it →
 * self-skips). Anonymous legs aside, the authed legs 401 on staging until F1-kefi
 * lands — WRITE + COMPILE-verified here; runs post-F1.
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiBackofficeClient } from '../../helpers/kefi/kefiBackofficeClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import {
  KefiRegistrationClient,
  type RegistrationRequestDto,
} from '../../helpers/kefi/kefiRegistrationClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import {
  createTenantUserWithRole,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
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

const EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 0 } as const;

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;

const STATUS_PENDING = 'Pending';
const STATUS_APPROVED = 'Approved';
const STATUS_REJECTED = 'Rejected';
const STATUS_EXPECTED = 'Expected';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Narrow a submit/decision response to the DTO after asserting its status. */
function asDto(resp: { status: number; data: unknown }): RegistrationRequestDto {
  return resp.data as RegistrationRequestDto;
}

test.describe('Kefi registration-request submit → approve / reject', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi registration-approval E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@api ambassador submits, organizer approves (→ attendee) + rejects; walls + 409 hold', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a Pro tenant + owner + ambassador via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const reg = new KefiRegistrationClient();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const ambEmail = handle.ctx.email.replace('@', '-amb@');
    const approvedEmail = handle.ctx.email.replace('@', '-approved@');
    const rejectedEmail = handle.ctx.email.replace('@', '-rejected@');
    let ambassadorUserId: string | null = null;

    try {
      const ambassador = await createTenantUserWithRole({
        email: ambEmail,
        password: handle.ctx.password,
        tenantId: handle.tenantId,
        role: 'ambassador',
        lastName: 'Ambassador',
      });
      ambassadorUserId = ambassador.userId;
      const ambBearer = await admin.getTenantOwnerBearer({ email: ambEmail, password: handle.ctx.password });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });

      // ── Submit two requests as the ambassador (one to approve, one to reject) ──
      const submitApproved = await reg.submit(ambBearer, {
        name: 'Approve', surname: 'Me', phone: '+35799000401', email: approvedEmail, passCode: PASS.code,
      });
      expect(submitApproved.status, 'ambassador submit → 201').toBe(HTTP_CREATED);
      const approvedId = asDto(submitApproved).externalId;
      expect(asDto(submitApproved).status, 'fresh request is Pending').toBe(STATUS_PENDING);

      const submitRejected = await reg.submit(ambBearer, {
        name: 'Reject', surname: 'Me', phone: '+35799000402', email: rejectedEmail, passCode: PASS.code,
      });
      expect(submitRejected.status, 'second submit → 201').toBe(HTTP_CREATED);
      const rejectedId = asDto(submitRejected).externalId;

      // ── The organizer queue lists both as Pending ──────────────────────
      const pending = await reg.list(ownerBearer, 'Pending');
      expect(pending.status, 'organizer list pending → 200').toBe(HTTP_OK);
      const pendingIds = (pending.data as { requests: RegistrationRequestDto[] }).requests.map((r) => r.externalId);
      expect(pendingIds, 'both fresh requests are in the pending queue').toEqual(
        expect.arrayContaining([approvedId, rejectedId]),
      );

      // ── Auth + role walls on the queue ─────────────────────────────────
      expect((await reg.list('')).status, 'no-bearer queue → 401').toBe(HTTP_UNAUTHORIZED);
      expect(
        (await reg.list(ambBearer)).status,
        'ambassador (wrong role) on the organizer queue → 403',
      ).toBe(HTTP_FORBIDDEN);

      // ── Approve → 200 Approved; double-approve → 409 ───────────────────
      const approve = await reg.approve(ownerBearer, approvedId);
      expect(approve.status, 'approve → 200').toBe(HTTP_OK);
      expect(asDto(approve).status, 'approved request status').toBe(STATUS_APPROVED);
      expect(asDto(approve).decidedAt, 'approved request has a decision timestamp').not.toBeNull();
      expect(
        (await reg.approve(ownerBearer, approvedId)).status,
        'double-approve is a 409 conflict',
      ).toBe(HTTP_CONFLICT);

      // ── Reject → 200 Rejected; empty reason → 400; re-reject → 409 ─────
      expect(
        (await reg.reject(ownerBearer, rejectedId, '')).status,
        'reject with empty reason → 400',
      ).toBe(HTTP_BAD_REQUEST);
      const reject = await reg.reject(ownerBearer, rejectedId, 'Event is at capacity');
      expect(reject.status, 'reject → 200').toBe(HTTP_OK);
      expect(asDto(reject).status, 'rejected request status').toBe(STATUS_REJECTED);
      expect(asDto(reject).rejectReason, 'reject reason persisted').toBe('Event is at capacity');
      expect(
        (await reg.reject(ownerBearer, rejectedId, 'again')).status,
        're-reject an already-decided request → 409',
      ).toBe(HTTP_CONFLICT);

      // ── Approved request became an Expected attendee; rejected did NOT ──
      const attendees = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      const approvedAttendee = attendees.attendees.find((a) => a.email === approvedEmail);
      expect(approvedAttendee, 'approving created an attendee for the approved email').toBeDefined();
      expect(approvedAttendee!.status, 'the approved attendee is Expected (pending/unpaid)').toBe(STATUS_EXPECTED);
      expect(
        attendees.attendees.some((a) => a.email === rejectedEmail),
        'a rejected request must NOT create an attendee',
      ).toBe(false);
    } finally {
      if (ambassadorUserId) await deleteEphemeralUser(ambassadorUserId);
      await teardownApiTenant(handle, admin);
    }
  });

  test('@ui organizer sees the queue and approves a submitted request', async ({ page, browser }) => {
    test.skip(
      !masterAdminAvailable(),
      'The @ui tier provisions the ambassador via KC master-admin; only staging carries those creds.',
    );
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const backoffice = new KefiBackofficeClient(admin);
    const lifecycle = new KefiLifecycleClient(admin);
    const reg = new KefiRegistrationClient();
    const ambEmail = ctx.email.replace('@', '-amb@');
    const attendeeEmail = ctx.email.replace('@', '-att@');
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    let ambassadorUserId: string | null = null;

    try {
      // ── Real signup owner → verified tenant + wizard event (no onboarding bounce) ──
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({ email: ctx.email, password: ctx.password, tenantName: ctx.tenantName });
      await new KefiSignupSuccessPage(page).expectLoaded();
      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, 'verify URL').not.toBeNull();
      await page.goto(verifyUrl!);
      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      await wizard.fillFastPath({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso: toIsoDate(new Date(Date.now() + EVENT_DAYS_AHEAD * MS_PER_DAY)),
      });
      const ownerBearer = await admin.getTenantOwnerBearer({ email: ctx.email, password: ctx.password });
      await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer: ownerBearer, code: 'pro' });
      await wizard.finishFromReview();

      // ── Ensure a pass, provision an ambassador, submit a request via API ──
      await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId, eventDateOffsetDays: EVENT_DAYS_AHEAD, status: 'Published',
        passCode: PASS.code, passLabel: PASS.label, priceEur: PASS.priceEur,
      });
      const tenant = await backoffice.findTenantBySlugPrefix(ctx.slugPrefix);
      expect(tenant, 'signup tenant resolvable by slug prefix').not.toBeNull();
      const ambassador = await createTenantUserWithRole({
        email: ambEmail, password: ctx.password, tenantId: tenant!.tenantId, role: 'ambassador', lastName: 'Ambassador',
      });
      ambassadorUserId = ambassador.userId;
      const ambBearer = await admin.getTenantOwnerBearer({ email: ambEmail, password: ctx.password });
      const submit = await reg.submit(ambBearer, {
        name: 'UI', surname: 'Approve', phone: '+35799000403', email: attendeeEmail, passCode: PASS.code,
      });
      expect(submit.status, 'ambassador submit → 201').toBe(HTTP_CREATED);
      const requestId = (submit.data as RegistrationRequestDto).externalId;

      // ── Owner opens the approvals surface in a clean session and approves ──
      const cleanCtx = await browser.newContext();
      const cleanPage = await cleanCtx.newPage();
      const login = new KefiLoginPage(cleanPage);
      await login.goto();
      await login.signIn({ email: ctx.email, password: ctx.password });
      await cleanPage.goto(`${getKefiUrls().webUrl}/organizer/approvals`);

      await expect(cleanPage.getByTestId('kefi-organizer-approvals-page'), 'approvals surface renders').toBeVisible();
      await expect(cleanPage.getByTestId('registration-queue-section'), 'the queue section renders').toBeVisible();
      await expect(
        cleanPage.getByTestId('error-boundary-reload-button'),
        'the app error boundary did not trip',
      ).toHaveCount(0);

      const approveButton = cleanPage.getByTestId(`registration-queue-approve-${requestId}`);
      await expect(approveButton, 'the submitted request shows an Approve action').toBeVisible();
      await approveButton.click();

      // The approved request leaves the default pending queue; confirm via the API contract.
      await expect(async () => {
        const approved = await reg.list(ownerBearer, 'Approved');
        const ids = (approved.data as { requests: RegistrationRequestDto[] }).requests.map((r) => r.externalId);
        expect(ids, 'the request is now Approved').toContain(requestId);
      }).toPass({ timeout: 15_000 });

      await cleanCtx.close();
      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      if (ambassadorUserId) await deleteEphemeralUser(ambassadorUserId);
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});
