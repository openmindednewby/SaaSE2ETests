import axios from 'axios';
import { setTimeout as delay } from 'timers/promises';

import { AuthHelper } from './auth-helper.js';

/** Pro plan ExternalId seeded in PaymentDbContext */
const PRO_PLAN_EXTERNAL_ID = '00000000-0000-0000-0000-000000000002';

type SubscriptionResult = {
  tenantName: string;
  status: 'created' | 'already-exists' | 'error';
  details?: string;
};

/**
 * Provision a Pro subscription for a single tenant by logging in as the given
 * user and calling POST /api/v1/subscriptions on the PaymentService.
 *
 * The endpoint returns:
 *   201 — subscription created (trial or active depending on Stripe config)
 *   409 — tenant already has an active subscription (idempotent, treated as success)
 */
async function provisionProSubscription(
  identityApiUrl: string,
  paymentApiUrl: string,
  username: string,
  password: string,
  tenantName: string,
): Promise<SubscriptionResult> {
  // Authenticate as the tenant user to get a JWT with the correct tenantId claim
  let accessToken: string;
  try {
    const auth = new AuthHelper(identityApiUrl);
    const tokens = await auth.loginViaAPI(username, password);

    if (!tokens.accessToken) {
      return { tenantName, status: 'error', details: `Login returned no token for ${username}` };
    }
    accessToken = tokens.accessToken;
  } catch (loginErr: unknown) {
    const err = loginErr as { response?: { status?: number }; message?: string };
    const details = err?.response?.status
      ? `Login failed for ${username}: status ${err.response.status}`
      : `Login failed for ${username}: ${err?.message ?? String(loginErr)}`;
    return { tenantName, status: 'error', details };
  }

  const client = axios.create({
    baseURL: paymentApiUrl.endsWith('/api/v1') ? paymentApiUrl : `${paymentApiUrl}/api/v1`,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  try {
    const resp = await client.post('/subscriptions', {
      planExternalId: PRO_PLAN_EXTERNAL_ID,
      billingCycle: 'Monthly',
    });

    if (resp.status === 201) {
      return { tenantName, status: 'created', details: `Subscription created (${resp.data?.status ?? 'unknown'})` };
    }

    return { tenantName, status: 'created', details: `Status ${resp.status}` };
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    const status = err?.response?.status;

    // 409 Conflict means tenant already has an active subscription — this is expected on re-runs
    if (status === 409) {
      return { tenantName, status: 'already-exists' };
    }

    const data = err?.response?.data;
    const details = status
      ? `status ${status}: ${typeof data === 'string' ? data : JSON.stringify(data ?? '')}`
      : (err?.message ?? String(e));

    return { tenantName, status: 'error', details };
  }
}

/**
 * Ensure all test tenants have a Pro subscription provisioned.
 *
 * Logs in as each tenant's user (who has the "user" role required by the
 * PaymentService endpoint) and creates a Pro subscription. Handles 409 Conflict
 * gracefully since subscriptions may already exist from previous test runs.
 *
 * @param identityApiUrl - Identity API base URL (e.g. http://localhost:5002)
 * @param paymentApiUrl  - Payment API base URL (e.g. http://localhost:5018)
 * @param tenantUsers    - Array of { tenantName, username, password } for each tenant
 */
export async function ensureProSubscriptions(
  identityApiUrl: string,
  paymentApiUrl: string,
  tenantUsers: Array<{ tenantName: string; username: string; password: string }>,
): Promise<SubscriptionResult[]> {
  // Check if PaymentService is reachable before attempting provisioning
  try {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 5000);
    await fetch(`${paymentApiUrl}/health/live`, { signal: controller.signal });
    clearTimeout(timeoutId);
  } catch {
    console.warn(`  [subscription-admin] PaymentService not available at ${paymentApiUrl} — skipping subscription provisioning`);
    return tenantUsers.map((u) => ({
      tenantName: u.tenantName,
      status: 'error' as const,
      details: `PaymentService not reachable at ${paymentApiUrl}`,
    }));
  }

  const results: SubscriptionResult[] = [];

  // Provision sequentially to avoid overwhelming the service during setup
  for (const tenant of tenantUsers) {
    // Retry up to 3 times with brief backoff for transient failures
    let result: SubscriptionResult | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await provisionProSubscription(
        identityApiUrl,
        paymentApiUrl,
        tenant.username,
        tenant.password,
        tenant.tenantName,
      );

      if (result.status !== 'error') break;

      if (attempt < 3) {
        await delay(500 * attempt);
      }
    }

    results.push(result!);

    if (result!.status === 'error') {
      console.warn(`  [subscription-admin] Failed to provision subscription for ${tenant.tenantName}: ${result!.details}`);
    }
  }

  return results;
}
