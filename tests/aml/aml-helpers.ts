// E2E helpers for the AML screening engine (@aml-api tier). Pure HTTP against the deployed
// AMLService — no browser. Mirrors the ichnos-api pattern; auth is a tenant API key (there is no
// login flow), sent as BOTH `X-Api-Key` and `Authorization: Bearer` so the same specs work whether
// the target accepts the api-key handler or the bearer path.
//
// Point it at an environment with AML_API_URL (default: our staging) + AML_API_KEY:
//   AML_API_URL=https://aml-screening.dloizides.com AML_API_KEY=<key> npx playwright test --project=aml-api
import type { APIRequestContext, APIResponse } from '@playwright/test';

function resolveAmlApiUrl(): string {
  const envUrl = process.env.AML_API_URL;
  if (envUrl && envUrl.trim()) return envUrl.trim().replace(/\/+$/, '');
  return 'https://aml-screening.dloizides.com';
}

export const AML_API_URL = resolveAmlApiUrl();
export const AML_API_KEY = process.env.AML_API_KEY?.trim() || null;

/** The four §5.5 PEP-tier classes (#364). Any wire value outside this set (+ Unknown/None) is the defect. */
export const FOUR_CLASS_TAXONOMY = new Set([
  'National',
  'Regional',
  'LocalAndEnterprise',
  'LocalGovernmentAndAssociates',
]);

export interface MatchedEntity {
  externalId: string;
  pepTier?: string | null;
  pepJurisdiction?: string | null;
}
export interface ScreeningResult {
  isMatch: boolean;
  decision?: string | null;
  matchedEntities: MatchedEntity[];
}

/** Is the AML API reachable? Uses the public `/version` (no auth) so we can skip, not fail, when down. */
export async function amlReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.fetch(`${AML_API_URL}/version`, { timeout: 8_000 });
    return res.ok();
  } catch {
    return false;
  }
}

/**
 * POST a screening. Returns the raw response, or null when the service is unreachable (network) so a
 * spec can `test.skip` gracefully. A 401/403 comes back as a real response — the caller skips on it
 * (the AML_API_KEY isn't valid for this environment), rather than false-failing.
 */
export async function screen(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<APIResponse | null> {
  if (!AML_API_KEY) return null;
  try {
    return await request.fetch(`${AML_API_URL}/v1/screenings/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': AML_API_KEY,
        Authorization: `Bearer ${AML_API_KEY}`,
      },
      data: body,
      timeout: 25_000,
    });
  } catch {
    return null;
  }
}
