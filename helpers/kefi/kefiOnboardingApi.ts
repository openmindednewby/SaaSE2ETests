/**
 * Onboarding-state API helper for the Kefi tenant-lifecycle E2E.
 *
 * The M1 fast-path wizard dropped the plan step (moved to a post-live dashboard
 * card), so the canary can no longer pick `pro` in the UI. The publish Pro-gate
 * still needs it, so we inject `plan.code` into the persisted onboarding state
 * via the API BEFORE the wizard's Finish — the completion handler maps
 * `state.plan.code` → `Tenant.SubscriptionPlanCode` once, on complete. Same
 * deterministic, Stripe-free effect the old wizard plan step had.
 *
 * Lives outside KefiAdminClient (which is at its file-size cap); the caller
 * mints the tenant-owner bearer via the client's public `getTenantOwnerBearer`.
 */
import axios, { type AxiosInstance } from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';

/**
 * GET the current onboarding state, merge `plan.code`, and PUT it back.
 * Must run before Finish so the completion handler reads the merged plan.
 */
function onboardingHttp(apiUrl: string): AxiosInstance {
  return axios.create({
    baseURL: apiUrl,
    timeout: 30_000,
    httpsAgent: sharedHttpsAgent,
    validateStatus: () => true,
  });
}

export async function forceOnboardingPlan(input: {
  apiUrl: string;
  bearer: string;
  code: string;
}): Promise<void> {
  const http = onboardingHttp(input.apiUrl);
  const headers = { Authorization: `Bearer ${input.bearer}` };

  const current = await http.get('/api/v1/admin/onboarding', { headers });
  if (current.status !== 200) {
    throw new Error(
      `[kefiOnboardingApi] get onboarding expected 200, got ${current.status}: ${JSON.stringify(current.data)}`,
    );
  }

  const state = { ...(current.data?.state ?? {}), plan: { code: input.code } };
  const step = current.data?.step ?? 'landing-copy';

  const resp = await http.put('/api/v1/admin/onboarding', { step, state }, { headers });
  if (resp.status !== 200) {
    throw new Error(
      `[kefiOnboardingApi] put onboarding plan expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
    );
  }
}

/**
 * POST /admin/onboarding/complete — the wizard's Finish, done over the API.
 *
 * A backoffice-created tenant (kefiApiTenant) never runs the wizard, so it stays
 * `OnboardingCompleted = false`. kefi-api's published-tenant discovery list
 * (`ListPublishedTenantSlugsAsync`: Active AND OnboardingCompleted AND a saved
 * config) then omits it, the publish build never renders `/t/<slug>/`, and the
 * publish Job's post-build guard fails the Job (KEFI-PEOPLE-1 T20). A real
 * organizer cannot reach Publish before finishing onboarding (kefi-web
 * `OnboardingGate`). The completion handler maps `state.plan.code` onto the
 * subscription, so call {@link forceOnboardingPlan} first to keep a Pro tenant Pro.
 */
export async function completeOnboarding(input: { apiUrl: string; bearer: string }): Promise<void> {
  const resp = await onboardingHttp(input.apiUrl).post('/api/v1/admin/onboarding/complete', undefined, {
    headers: { Authorization: `Bearer ${input.bearer}` },
  });
  if (resp.status !== 200) {
    throw new Error(
      `[kefiOnboardingApi] complete onboarding expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
    );
  }
}
