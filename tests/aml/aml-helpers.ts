// E2E helpers for the AML screening engine (@aml-api tier). Pure HTTP against the deployed
// AMLService — no browser. Mirrors the ichnos-api pattern; auth is a tenant API key (there is no
// login flow), sent as BOTH `X-Api-Key` and `Authorization: Bearer` so the same specs work whether
// the target accepts the api-key handler or the bearer path.
//
// Point it at an environment with AML_API_URL (default: our staging) + AML_API_KEY:
//   AML_API_URL=https://aml-screening.dloizides.com AML_API_KEY=<key> npx playwright test --project=aml-api
//
// The generic building blocks (base-URL resolution, transport-safe request) live in the shared
// @dloizides/e2e-helpers package; this file keeps only the AML-specific glue (dual-auth screen call,
// the §5.5 taxonomy, result shapes).
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { resolveBaseUrl, tryRequest } from '@dloizides/e2e-helpers';

export const AML_API_URL = resolveBaseUrl('AML_API_URL', 'https://aml-screening.dloizides.com');
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
  const result = await tryRequest(request, AML_API_URL, '/version', { timeoutMs: 8_000 });
  return result?.response.ok() ?? false;
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
  const result = await tryRequest(request, AML_API_URL, '/v1/screenings/check', {
    method: 'POST',
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': AML_API_KEY,
      Authorization: `Bearer ${AML_API_KEY}`,
    },
    timeoutMs: 25_000,
  });
  return result?.response ?? null;
}

/**
 * GET an AML API path with the same dual-auth headers as {@link screen}. Returns the raw response, or
 * null when the service is unreachable (network) so a spec can `test.skip` rather than false-fail.
 *
 * 🔴 LIMIT: this helper HAND-ASSEMBLES its request. It therefore exercises the SERVER contract only —
 * it can never observe a defect in the aml-v2 client's own request shape (a stripped Content-Type, a
 * wrong header, a client-side ReferenceError). Pin the app client separately.
 */
export async function amlGet(
  request: APIRequestContext,
  path: string,
): Promise<APIResponse | null> {
  if (!AML_API_KEY) return null;
  const result = await tryRequest(request, AML_API_URL, path, {
    headers: {
      'X-Api-Key': AML_API_KEY,
      Authorization: `Bearer ${AML_API_KEY}`,
    },
    timeoutMs: 20_000,
  });
  return result?.response ?? null;
}

/** One cell of the decision matrix: category × evidence tier × multiplicity → Pass/Review/Fail. */
export interface DecisionMatrixCell {
  category: string;
  tier: string;
  multiplicity: string;
  decision: string;
}
export interface DecisionMatrixView {
  unconfirmedPosture: string;
  effective: { cells: DecisionMatrixCell[] };
  systemDefault: { cells: DecisionMatrixCell[] };
}

export interface AdverseMediaCapability {
  available: boolean;
  source: string;
  unavailableReason?: string | null;
}

/** The wire token for the adverse-media risk category (Domain/Risk/RiskCategories.cs:20). */
export const ADVERSE_MEDIA_CATEGORY = 'adverse_media';
/** The five evidence tiers (Domain/Risk/DecisionMatrixTokens.cs:12-16). */
export const EVIDENCE_TIERS = [
  'exact_name_exact_dob',
  'exact_name_no_dob',
  'exact_name_dob_mismatch',
  'exact_name_dob_near_match',
  'weak_or_partial_name',
];
/** The three capability sources (Application/Screening/ScreeningCapabilitiesResponse.cs:36-40). */
export const CAPABILITY_SOURCES = new Set(['None', 'Gdelt', 'TenantEndpoint']);

/**
 * POST an arbitrary AML API path with the same dual-auth headers as {@link screen}. Used by the
 * adverse-media case/disposition specs. Same hand-assembled LIMIT as {@link amlGet}.
 */
export async function amlPost(
  request: APIRequestContext,
  path: string,
  body: Record<string, unknown>,
): Promise<APIResponse | null> {
  if (!AML_API_KEY) return null;
  const result = await tryRequest(request, AML_API_URL, path, {
    method: 'POST',
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': AML_API_KEY,
      Authorization: `Bearer ${AML_API_KEY}`,
    },
    timeoutMs: 25_000,
  });
  return result?.response ?? null;
}

/** Read the tenant's adverse-media capability, or null when it cannot be read. */
export async function adverseMediaCapability(
  request: APIRequestContext,
): Promise<AdverseMediaCapability | null> {
  const res = await amlGet(request, '/v1/tenants/me/screening-capabilities');
  if (!res || !res.ok()) return null;
  const body = (await res.json()) as { adverseMedia?: AdverseMediaCapability };
  return body.adverseMedia ?? null;
}

/**
 * POST a multipart body to an AML API path with the same dual-auth headers as {@link screen}.
 *
 * 🔴 SAME HAND-ASSEMBLED LIMIT as {@link amlGet}, and it matters more here than anywhere else in this
 * file. `apps/aml-v2/src/api/client.ts:345-352` builds its OWN `FormData` (`file` + a String()'d
 * `adverseMedia` form field). This helper builds a DIFFERENT one. So it covers the SERVER's multipart
 * contract — that the endpoint accepts a file plus a string form field and applies the flag — and it
 * is structurally incapable of observing a defect in the app client's shape. Pinning client.ts:345-352
 * is a unit-level job in apps/aml-v2 (AM-READY-5 §6), not something this tier can fake.
 *
 * `tryRequest` has no multipart option, so this calls Playwright directly and catches the transport
 * error itself to keep the same null-on-unreachable contract.
 */
export async function amlUpload(
  request: APIRequestContext,
  path: string,
  multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>,
): Promise<APIResponse | null> {
  if (!AML_API_KEY) return null;
  try {
    return await request.post(`${AML_API_URL}${path}`, {
      multipart,
      headers: {
        'X-Api-Key': AML_API_KEY,
        Authorization: `Bearer ${AML_API_KEY}`,
      },
      timeout: 60_000,
    });
  } catch {
    return null; // transport failure — the caller test.skips rather than false-failing
  }
}
