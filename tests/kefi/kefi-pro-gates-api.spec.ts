/**
 * Kefi freemium gates — FAST API-contract tier (KEFI-2). Tag: `@api`.
 *
 * This is the FAST tier of the SAME capability the full UI spec
 * (`kefi-pro-gates-ui.spec.ts`, `@ui`) exercises through the browser. Where the
 * UI tier proves the lock UX, this tier proves the authoritative backend gate
 * CONTRACT — and does it in seconds by skipping the signup → IMAP → wizard rig
 * entirely:
 *
 *   1. `KefiBackofficeClient.createTenant` (platform-admin) mints a Free tenant
 *      directly (pure-API, as `kefi-backoffice-approval` does).
 *   2. `createTenantOwnerUser` (KC master-admin) provisions the tenant owner —
 *      `tenantId` attribute + `tenant-owner` realm role + password,
 *      `emailVerified` with no required actions so ROPC works at once.
 *   3. The owner ROPCs via the shared `getTenantOwnerBearer` path; the gates are
 *      then asserted directly against kefi-api.
 *
 * Asserted (the same three gated endpoints + the positive control as the UI/slow
 * specs):
 *   - Free: 1st event 201 (the allowed one) → 2nd event 403; custom-domain 403;
 *     stripe-credentials store 403; stripe-credentials CLEAR 2xx (downgrade path).
 *   - Pro grant via `PUT /platform/tenants/{id}/subscription` → the same three
 *     calls all 2xx. `Tenant.IsPro` is read from the DB per-request, so the
 *     cached owner bearer needs no refresh.
 *
 * The wall-clock is annotated so the API/UI speed gap is visible — this tier
 * lands in a handful of seconds vs the wizard-based spec's minutes.
 *
 * Master-admin-only: the no-wizard owner provisioning needs KC master-admin
 * creds, which only staging carries (prod deliberately does not — same posture
 * as `kefi-backoffice-approval`'s 403 sub-check). On targets without them this
 * spec skips with an explicit reason rather than falling back to the slow rig.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiBackofficeClient } from '../../helpers/kefi/kefiBackofficeClient.js';
import { KefiCustomDomainClient } from '../../helpers/kefi/kefiCustomDomainClient.js';
import {
  KefiProGatesClient,
  type OwnerCreds,
  type UpdateStripeCredentialsBody,
} from '../../helpers/kefi/kefiProGatesClient.js';
import {
  createTenantOwnerUser,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { dummySecretKey, generateWebhookSecret } from '../../helpers/kefi/kefiStripeSign.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_DAYS_AHEAD = 60;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_FORBIDDEN = 403;
const HTTP_2XX_FLOOR = 200;
const HTTP_3XX_FLOOR = 300;
/** A far-future paid period — well clear of any validator window (mirrors the siblings). */
const GRANTED_PERIOD_END_UTC = '2027-12-31T00:00:00Z';

function dateAhead(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Bundle of clients + creds threaded through the gate-assertion helpers. */
interface GateDeps {
  ctx: KefiCanaryContext;
  owner: OwnerCreds;
  progates: KefiProGatesClient;
  cd: KefiCustomDomainClient;
}

/** A shape-valid store body (sk_/whsec_ pass the handler's shape validator). */
function storeCredsBody(ctx: KefiCanaryContext): UpdateStripeCredentialsBody {
  return {
    stripeSecretKey: dummySecretKey(ctx.canaryId),
    stripeWebhookSecret: generateWebhookSecret(),
    stripePaymentsEnabled: true,
  };
}

test.describe('Kefi KEFI-2 — freemium gates @api (FAST, no-wizard)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi freemium-gate E2E targets staging+prod; local stack + platform-admin creds not in .env.local',
  );
  test.skip(
    !masterAdminAvailable(),
    'API tier provisions the owner with NO wizard via KC master-admin; only staging carries those creds (prod uses the @ui/slow rig).',
  );

  test('@api Free tenant is 403 on Pro features; a Pro grant unblocks the same calls', async () => {
    const startedAt = Date.now();
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const backoffice = new KefiBackofficeClient(admin);
    const deps: GateDeps = {
      ctx,
      owner: { ownerEmail: ctx.email, ownerPassword: ctx.password },
      progates: new KefiProGatesClient(admin),
      cd: new KefiCustomDomainClient(admin),
    };
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    let ownerUserId: string | null = null;
    try {
      // ── 1. Pure-API Free tenant + a no-wizard ROPC-able owner ──────────────
      const slug = `${ctx.slugPrefix}canary-tenant`;
      const created = await backoffice.createTenant({ name: `${ctx.slugPrefix}Pro-Gate Canary`, slug });
      expect(created.subscriptionPlanCode, 'new tenant defaults to the free plan').toBe('free');
      const owner = await createTenantOwnerUser({
        email: ctx.email,
        password: ctx.password,
        tenantId: created.tenantId,
      });
      ownerUserId = owner.userId;

      // ── 2. Free tenant is BLOCKED on every Pro feature (clear is allowed) ──
      await expectFreePlanGatesBlocked(deps);

      // ── 3. Positive control: grant Pro, then the SAME calls succeed ────────
      await grantProPlan(backoffice, created.tenantId);
      await expectProPlanGatesAllowed(deps);
    } finally {
      const elapsedMs = Date.now() - startedAt;
      test.info().annotations.push({ type: 'wall-clock-ms', description: String(elapsedMs) });
      process.stdout.write(`\n[kefi-pro-gates @api] wall-clock: ${(elapsedMs / 1000).toFixed(1)}s\n`);
      if (ownerUserId) await deleteEphemeralUser(ownerUserId);
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

/**
 * Free tenant: the 1st event is the allowed one (201); a 2nd event, a (valid)
 * custom domain, and a stripe-credentials STORE are each 403; a
 * stripe-credentials CLEAR is 2xx (the downgrade path). The custom domain is a
 * valid subdomain so the gate — not domain validation — is what rejects it.
 */
async function expectFreePlanGatesBlocked(deps: GateDeps): Promise<void> {
  const firstEvent = await deps.progates.createEvent(deps.owner, {
    name: `${deps.ctx.slugPrefix}first event`,
    dateIso: dateAhead(EVENT_DAYS_AHEAD),
  });
  expect(firstEvent.status, 'Free 1st event → 201 (the single allowed event)').toBe(HTTP_CREATED);

  const secondEvent = await deps.progates.createEvent(deps.owner, {
    name: `${deps.ctx.slugPrefix}second event`,
    dateIso: dateAhead(EVENT_DAYS_AHEAD),
  });
  expect(secondEvent.status, 'Free 2nd event → 403 (Creating additional events requires the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const domain = await deps.cd.set(deps.owner, `gate-${deps.ctx.canaryId}.example.com`);
  expect(domain.status, 'Free custom domain → 403 (Custom domains require the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const store = await deps.progates.updateStripeCredentials(deps.owner, storeCredsBody(deps.ctx));
  expect(store.status, 'Free stripe-credentials store → 403 (Attendee payments require the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const clear = await deps.progates.updateStripeCredentials(deps.owner, {
    stripePaymentsEnabled: false,
    clear: true,
  });
  expect(clear.status, 'Free stripe-credentials CLEAR is allowed (downgrade path)')
    .toBeGreaterThanOrEqual(HTTP_2XX_FLOOR);
  expect(clear.status, 'Free stripe-credentials CLEAR is 2xx').toBeLessThan(HTTP_3XX_FLOOR);
}

/** Grant the canary tenant Pro/Active via the platform-admin subscription endpoint. */
async function grantProPlan(backoffice: KefiBackofficeClient, tenantId: string): Promise<void> {
  const granted = await backoffice.setSubscription(tenantId, {
    planCode: 'pro',
    status: 'Active',
    currentPeriodEndUtc: GRANTED_PERIOD_END_UTC,
  });
  expect(granted.status, 'Pro grant → 200').toBe(HTTP_OK);
  expect(granted.data.subscriptionPlanCode, 'granted plan code').toBe('pro');
}

/**
 * Pro tenant: the SAME three previously-blocked calls now succeed (2xx) —
 * proving the gate is plan-driven, not a blanket block. Distinct domain from
 * the Free attempt to keep the assertion clean.
 */
async function expectProPlanGatesAllowed(deps: GateDeps): Promise<void> {
  const proEvent = await deps.progates.createEvent(deps.owner, {
    name: `${deps.ctx.slugPrefix}pro event`,
    dateIso: dateAhead(EVENT_DAYS_AHEAD),
  });
  expect(proEvent.status, 'Pro 2nd event → 201').toBe(HTTP_CREATED);

  const domain = await deps.cd.set(deps.owner, `pro-${deps.ctx.canaryId}.example.com`);
  expect(domain.status, 'Pro custom domain → 200').toBe(HTTP_OK);
  expect(domain.body.status, 'Pro custom domain stored PendingDns').toBe('PendingDns');

  const store = await deps.progates.updateStripeCredentials(deps.owner, storeCredsBody(deps.ctx));
  expect(store.status, 'Pro stripe-credentials store is 2xx').toBeGreaterThanOrEqual(HTTP_2XX_FLOOR);
  expect(store.status, 'Pro stripe-credentials store is 2xx').toBeLessThan(HTTP_3XX_FLOOR);
}
