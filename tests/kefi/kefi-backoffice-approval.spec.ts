/**
 * Kefi back-office manual-subscription override E2E (KEFI-1 punch-list #1).
 *
 * Covers the platform super-admin "mark this tenant as paid WITHOUT Stripe"
 * path — the comp / bank-transfer / manual-billing override on the first
 * paying customer's critical path. It exercises the real endpoint contract:
 *
 *   PUT /api/v1/platform/tenants/{tenantId}/subscription   Roles(kefi-platform-admin)
 *   body: { planCode, status, currentPeriodEndUtc }
 *   → 200 TenantDto { subscriptionPlanCode, subscriptionStatus, subscriptionCurrentPeriodEndUtc }
 *
 * Flow (pure-API — no signup/wizard/IMAP, so far lighter than its kefi siblings):
 *   1. As kefi-platformadmin, create a canary tenant — defaults to the Free plan.
 *   2. PUT pro/Active/+future-period → assert 200 + the echoed TenantDto.
 *   3. Re-fetch via GET /platform/tenants → assert the override PERSISTED and that
 *      the tenant's lifecycle status was NOT touched by the subscription write.
 *   4. Negative: invalid plan `platinum` → 400.
 *   5. Negative: a valid-but-non-admin kefi token → 403 (not 401 — proves the
 *      role wall, not just the auth wall).
 *   6. afterAll sweeps the `e2c-{canaryId}-` tenant via the canary-cleanup endpoint.
 *
 * Skipped on local: the kefi-platform-admin credentials only exist in
 * `.env.{staging,prod}.secrets`, like every other kefi spec. Runs on staging + prod.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import {
  KefiBackofficeClient,
  type SetSubscriptionBody,
} from '../../helpers/kefi/kefiBackofficeClient.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import {
  createEphemeralNonAdminUser,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** A fixed, far-future paid-period end — well clear of any validator window. */
const GRANTED_PERIOD_END_UTC = '2027-12-31T00:00:00Z';

// Serial — the spec creates exactly one canary tenant and tears it down; there
// is nothing to parallelise and it keeps the platform-admin token mint to one.
test.describe.configure({ mode: 'serial' });

test.describe('Kefi back-office manual subscription override (platform-admin)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi back-office E2E targets staging+prod; platform-admin creds are not in .env.local',
  );

  const admin = new KefiAdminClient();
  const backoffice = new KefiBackofficeClient(admin);
  const ctx = newCanaryContext();
  // e2c-{canaryId}-canary-tenant — swept by the canary-cleanup slug-prefix match.
  const slug = `${ctx.slugPrefix}canary-tenant`;
  const tenantName = `${ctx.slugPrefix}Backoffice Approval Canary`;
  // Tracks the ephemeral role-less kefi user created for the 403 case so
  // afterAll can delete it (no tenant links it → the canary sweep won't catch it).
  let ephemeralUserId: string | null = null;

  test.afterAll(async () => {
    if (ephemeralUserId) await deleteEphemeralUser(ephemeralUserId);
    await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
  });

  test('platform admin grants a Stripe-less Pro plan; invalid plan + non-admin are rejected', async () => {
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    // ── 1. Create the tenant — it must start on the default Free plan ────
    const created = await backoffice.createTenant({ name: tenantName, slug });
    expect(created.slug, 'created tenant slug').toBe(slug);
    expect(created.subscriptionPlanCode, 'new tenant defaults to free plan').toBe('free');
    expect(created.subscriptionStatus, 'new tenant defaults to None status').toBe('None');
    expect(
      created.subscriptionCurrentPeriodEndUtc,
      'new tenant has no paid period',
    ).toBeNull();
    const lifecycleStatusBefore = created.status;

    // ── 2. Manual override → Pro / Active / future period ───────────────
    const grant: SetSubscriptionBody = {
      planCode: 'pro',
      status: 'Active',
      currentPeriodEndUtc: GRANTED_PERIOD_END_UTC,
    };
    const setResp = await backoffice.setSubscription(created.tenantId, grant);
    expect(setResp.status, 'set-subscription HTTP status').toBe(HTTP_OK);
    expect(setResp.data.subscriptionPlanCode, 'response plan code').toBe('pro');
    expect(setResp.data.subscriptionStatus, 'response subscription status').toBe('Active');
    expect(
      setResp.data.subscriptionCurrentPeriodEndUtc,
      'response period end set',
    ).not.toBeNull();
    expect(
      new Date(setResp.data.subscriptionCurrentPeriodEndUtc as string).getTime(),
      'response period end equals the granted instant',
    ).toBe(new Date(GRANTED_PERIOD_END_UTC).getTime());
    // The subscription write must NOT change the tenant's lifecycle status.
    expect(setResp.data.status, 'lifecycle status untouched by subscription write').toBe(
      lifecycleStatusBefore,
    );

    // ── 3. Re-fetch → the override PERSISTED ────────────────────────────
    const refetched = await backoffice.getTenantById(created.tenantId);
    expect(refetched, 'tenant still present after override').not.toBeNull();
    expect(refetched!.subscriptionPlanCode, 'persisted plan code').toBe('pro');
    expect(refetched!.subscriptionStatus, 'persisted subscription status').toBe('Active');
    expect(
      new Date(refetched!.subscriptionCurrentPeriodEndUtc as string).getTime(),
      'persisted period end',
    ).toBe(new Date(GRANTED_PERIOD_END_UTC).getTime());
    expect(refetched!.status, 'persisted lifecycle status untouched').toBe(lifecycleStatusBefore);

    // ── 4. Negative: invalid plan code → 400 ────────────────────────────
    const badPlan = await backoffice.setSubscription(created.tenantId, {
      planCode: 'platinum',
      status: 'Active',
      currentPeriodEndUtc: null,
    });
    expect(badPlan.status, 'invalid plan code is rejected').toBe(HTTP_BAD_REQUEST);

    // ── 5a. Negative: no token at all → 401 (auth wall) ─────────────────
    // Always assertable, on every target. Proves the endpoint is not open.
    const anonStatus = await backoffice.setSubscriptionWithBearer(created.tenantId, grant, '');
    expect(anonStatus, 'anonymous request is unauthorized').toBe(HTTP_UNAUTHORIZED);

    // ── 5b. Negative: valid-but-non-admin kefi token → 403 (role wall) ──
    // The seeded kefi users are platform superUsers (above the role wall), so a
    // genuine non-admin identity has to be minted. We create an ephemeral
    // role-less kefi user via the KC Admin API — only possible where the
    // master-admin creds are configured (staging has them; prod deliberately
    // does not). Where they are absent we annotate + skip just this sub-check
    // rather than fail; the 401 wall above still proves the endpoint is closed.
    if (masterAdminAvailable()) {
      const ephemeral = await createEphemeralNonAdminUser({
        username: `${ctx.slugPrefix}nonadmin`,
        password: ctx.password,
      });
      ephemeralUserId = ephemeral.userId;
      const nonAdminBearer = await backoffice.mintUserBearer({
        username: ephemeral.username,
        password: ephemeral.password,
      });
      const forbiddenStatus = await backoffice.setSubscriptionWithBearer(
        created.tenantId,
        grant,
        nonAdminBearer,
      );
      expect(forbiddenStatus, 'non-admin token is forbidden, not merely unauthorized').toBe(
        HTTP_FORBIDDEN,
      );
    } else {
      test.info().annotations.push({
        type: 'skip-detail',
        description:
          '403 role-wall sub-check skipped — KEYCLOAK_MASTER_ADMIN_* not configured for this target (prod). The 401 auth-wall check above still ran.',
      });
    }

    // ── 6. The invalid attempts must not have mutated the stored grant ──
    const finalState = await backoffice.getTenantById(created.tenantId);
    expect(finalState!.subscriptionPlanCode, 'plan unchanged by rejected writes').toBe('pro');
    expect(finalState!.subscriptionStatus, 'status unchanged by rejected writes').toBe('Active');
  });
});
