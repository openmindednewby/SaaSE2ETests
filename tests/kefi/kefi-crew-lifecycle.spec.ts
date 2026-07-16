/**
 * Kefi crew-lifecycle E2E (task #267) — "from registration all the way".
 *
 * Encodes the exact chain proven manually to create the `ubb` prod tenant:
 * register → verify email → onboard → duplicate landing content + publish →
 * invite crew (organizer / ambassador / dj) → EACH crew member logs in with the
 * correct role + tenantId claim. A THROWAWAY tenant is created per run
 * (canary slug `e2c-{id}-…`, swept by the existing kefi canary-cleanup).
 *
 * Two-tier + one slow split (CLAUDE.md two-tier E2E preference):
 *   1. `@api`  — the fast CORE acceptance (invite → crew login), no browser.
 *               Mints a tenant + no-wizard owner headlessly (like kefi-pro-gates-api),
 *               then asserts the #267 PRODUCT GAP: an invited crew member CANNOT
 *               log in until an operator sets password + emailVerified via the KC
 *               admin API — and CAN afterwards, with the right role + tenantId.
 *   2. `@ui`   — the full real registration path in a browser: marketing signup →
 *               IMAP magic-link verify → onboarding wizard → a real password
 *               sign-in on the kefi web app lands an authenticated organizer session.
 *   3. `@slow` — duplicate a landing config (incl. display passes + posters) and
 *               publish it to Succeeded (kaniko build; isolated so the core stays fast).
 *
 * Target: staging (E2E_TARGET=staging). The @api owner + crew provisioning need a
 * KC-admin credential; only staging carries one (prod deliberately does not).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiBackofficeClient } from '../../helpers/kefi/kefiBackofficeClient.js';
import { KefiCrewClient, type CrewMember } from '../../helpers/kefi/kefiCrewClient.js';
import type { OwnerCreds } from '../../helpers/kefi/kefiProGatesClient.js';
import {
  createTenantOwnerUser,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
  type CapturedEmail,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { buildDuplicatedLandingConfig } from '../../helpers/kefi/kefiDuplicatedLandingConfig.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial — shares the one bot mailbox + (for @slow) the single kefi-landings Deployment.
test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** organizer + ambassador + dj, plus-addressed off the run's bot inbox (never read). */
function crewRoster(ctx: KefiCanaryContext): CrewMember[] {
  return [
    { email: ctx.email.replace('@', '-organizer@'), firstName: 'Canary', lastName: 'Organizer', role: 'organizer' },
    { email: ctx.email.replace('@', '-ambassador@'), firstName: 'Canary', lastName: 'Ambassador', role: 'ambassador' },
    { email: ctx.email.replace('@', '-dj@'), firstName: 'Canary', lastName: 'DJ', role: 'dj' },
  ];
}

/**
 * Invite → assert the #267 gap (pre-provision login FAILS) → provision password
 * + emailVerified → login SUCCEEDS with the role + tenantId claim. Returns the
 * crew KC user id for teardown.
 */
async function inviteProvisionAndVerifyLogin(input: {
  crew: KefiCrewClient;
  owner: OwnerCreds;
  member: CrewMember;
  password: string;
  expectedTenantId: string;
}): Promise<string> {
  const { crew, owner, member, password, expectedTenantId } = input;
  const userId = await crew.invite(owner, member);

  const preProvision = await crew.tryLogin(member.email, password);
  expect(
    preProvision.ok,
    `#267 gap: invited ${member.role} must NOT be able to log in before KC-admin password-set`,
  ).toBe(false);

  await crew.provisionLogin(userId, password);
  const token = await crew.login(member.email, password);
  expect(token.roles, `${member.role} carries its realm role after login`).toContain(member.role);
  expect(token.tenantId, `${member.role} token carries the tenant's externalId`).toBe(expectedTenantId);
  return userId;
}

/**
 * The shared real-registration rig (@ui + @slow): marketing signup → IMAP
 * magic-link verify → 4-step wizard → Finish. Returns the captured verify email
 * so the caller can expunge it. `pro` injects the Pro plan pre-Finish.
 */
async function registerVerifyOnboard(input: {
  page: import('@playwright/test').Page;
  ctx: KefiCanaryContext;
  admin: KefiAdminClient;
  pro: boolean;
}): Promise<CapturedEmail> {
  const { page, ctx, admin, pro } = input;
  const marketing = new KefiMarketingPage(page);
  await marketing.goto();
  await marketing.signupAndExpectSuccess({ email: ctx.email, password: ctx.password, tenantName: ctx.tenantName });
  await new KefiSignupSuccessPage(page).expectLoaded();

  const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
  const captured = await mailbox.waitForMessageTo(ctx.email);
  const verifyUrl = extractVerifyUrl(captured);
  expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();
  await page.goto(verifyUrl!);

  const wizard = new KefiOnboardingWizardPage(page);
  await wizard.expectLoaded();
  await wizard.fillFastPath({
    canaryPrefix: ctx.slugPrefix,
    eventDateIso: toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY)),
  });
  if (pro) {
    const bearer = await admin.getTenantOwnerBearer({ email: ctx.email, password: ctx.password });
    await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer, code: 'pro' });
  }
  await wizard.finishFromReview();
  return captured;
}

test.describe('Kefi crew lifecycle — register → onboard → invite → crew login', () => {
  test.skip(!isRemoteTarget(), 'Kefi crew-lifecycle E2E targets staging+prod; local stack not wired in dev-loop yet');

  test('@api invited crew (organizer/ambassador/dj) each log in with role + tenantId after KC provisioning', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a no-wizard owner via KC master-admin; only staging carries those creds.',
    );
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const backoffice = new KefiBackofficeClient(admin);
    const crew = new KefiCrewClient(admin);
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    const crewIds: string[] = [];
    let ownerUserId: string | null = null;
    try {
      const slug = `${ctx.slugPrefix}crew`;
      const created = await backoffice.createTenant({ name: `${ctx.slugPrefix}Crew Canary`, slug });
      const owner = await createTenantOwnerUser({ email: ctx.email, password: ctx.password, tenantId: created.tenantId });
      ownerUserId = owner.userId;
      const ownerCreds: OwnerCreds = { ownerEmail: ctx.email, ownerPassword: ctx.password };

      for (const member of crewRoster(ctx)) {
        const id = await inviteProvisionAndVerifyLogin({
          crew, owner: ownerCreds, member, password: ctx.password, expectedTenantId: created.tenantId,
        });
        crewIds.push(id);
      }
    } finally {
      for (const id of crewIds) await crew.deleteUser(id);
      if (ownerUserId) await deleteEphemeralUser(ownerUserId);
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });

  test('@ui registers, verifies email, onboards, and signs in to the organizer app', async ({ page, browser }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      const captured = await registerVerifyOnboard({ page, ctx, admin, pro: false });

      // Real password sign-in in a CLEAN browser context (not the magic-link
      // session) — proves the registered owner can authenticate through the
      // shipped kefi-web login UI and reaches an authenticated organizer session.
      const cleanCtx = await browser.newContext();
      const cleanPage = await cleanCtx.newPage();
      const login = new KefiLoginPage(cleanPage);
      await login.goto();
      await login.signInAndExpectOnboarding({ email: ctx.email, password: ctx.password });

      // Auth proof: the UI sign-in left /login AND established a real BFF session
      // (the __Host-bff-kefi cookie) — i.e. an authenticated organizer session on
      // the shipped kefi-web app, not a bounce back to the login screen.
      await expect(cleanPage, 'signed in — no longer on /login').not.toHaveURL(/\/login(\?|\/|$)/);
      await expect(login.usernameInput, 'login form gone after sign-in').toHaveCount(0);
      const cookies = await cleanCtx.cookies();
      const bffSession = cookies.find((c) => c.name.includes('bff-kefi'));
      expect(bffSession, 'BFF session cookie set by the UI sign-in').toBeTruthy();
      await cleanCtx.close();

      await new KefiMailbox(loadKefiMailboxConfig()).expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });

  test('@slow duplicates a landing config (passes + posters) and publishes to Succeeded', async ({ page }) => {
    // The kaniko publish build on staging's single (memory-heavy) kefi-landings
    // Deployment is the slow, variable part — give it room well beyond the
    // default 240s poll so this @slow test does not flake on build latency.
    test.setTimeout(900_000);
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      const captured = await registerVerifyOnboard({ page, ctx, admin, pro: false });

      // Duplicate content: PUT a landing config carrying display passes + posters.
      await admin.putLandingConfig({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        dto: buildDuplicatedLandingConfig(ctx.slugPrefix),
      });

      // Publish (Free may publish since Phase F) → poll the kaniko job to Succeeded.
      const publish = await admin.publishLanding({ ownerEmail: ctx.email, ownerPassword: ctx.password });
      expect(publish.status, 'publish enqueued').toBe('Enqueued');
      const terminal = await admin.pollPublishStatus({
        ownerEmail: ctx.email, ownerPassword: ctx.password, jobName: publish.jobName,
        timeoutMs: 600_000, pollIntervalMs: 8_000,
      });
      expect(terminal.status, `publish job ${publish.jobName} terminal`).toBe('Succeeded');

      await new KefiMailbox(loadKefiMailboxConfig()).expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});
