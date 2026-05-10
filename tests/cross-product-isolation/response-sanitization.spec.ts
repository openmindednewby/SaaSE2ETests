import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRealmToken } from '../../helpers/realm-token-helper.js';

/**
 * 401 Response Sanitization — the body and headers must not leak
 * product-specific or realm-specific information.
 *
 * The realm-validation handler comment says:
 *   "we keep cross-realm tokens indistinguishable from 'no token' at the
 *    wire."
 *
 * So a 401 caused by cross-realm rejection MUST be byte-for-byte identical
 * to a 401 caused by a missing token. In particular it MUST NOT contain:
 *
 *   - the realm name ("questioner", "onlinemenu", "OnlineMenu")
 *   - the word "realm"
 *   - product names ("Questioner", "OnlineMenus", etc.)
 *
 * If any of these appear, that's a P0 finding for backend — file as a bug.
 *
 * Status code MUST be 401 (NOT 403). 403 itself is information.
 *
 * The WWW-Authenticate header MAY be present (it's standard) but MUST NOT
 * include any realm-specific hint either. A bare `Bearer` challenge is OK.
 */

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return (value && value.trim().length > 0) ? value.trim().replace(/\/+$/, '') : fallback;
}

const SERVICE_URLS = {
  questioner: resolveBaseUrl('QUESTIONER_API_URL', 'https://localhost:5004'),
  onlineMenu: resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006'),
} as const;

const PROBE_PATHS = {
  questioner: '/api/v1/questionerTemplates/list',
  onlineMenu: '/api/v1/TenantMenus/list',
} as const;

const HTTP_UNAUTHORIZED = 401;

/**
 * Patterns that MUST NOT appear in the 401 body or headers. Case-insensitive.
 * We deliberately allow "OnlineMenu" in URL paths or service names that are
 * implicit in the request (the client is the one who chose to call
 * /api/v1/TenantMenus/list, so seeing "OnlineMenu" reflected back from
 * those is benign — but we DON'T want to see realm names like "questioner"
 * or "onlinemenu" appearing in the response itself).
 */
const FORBIDDEN_LEAK_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brealm\b/i, reason: 'leaks "realm" — info about realm topology' },
  { pattern: /\bquestioner\b/i, reason: 'leaks the questioner product name' },
  { pattern: /\bonlinemenu\b/i, reason: 'leaks the onlinemenu product/realm name' },
  { pattern: /\bAllowedRealms\b/i, reason: 'leaks internal config key' },
  { pattern: /\biss\b\s*[:=]/i, reason: 'leaks issuer-claim concept' },
];

async function makeApiContext(baseUrl: string): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

interface RejectionResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function fetchRejection(
  apiContext: APIRequestContext,
  path: string,
  authHeader: string | null,
): Promise<RejectionResponse> {
  const headers: Record<string, string> = {};
  if (authHeader !== null) {
    headers.Authorization = authHeader;
  }
  const response = await apiContext.get(path, { headers, failOnStatusCode: false });
  return {
    status: response.status(),
    body: await response.text().catch(() => ''),
    headers: response.headers(),
  };
}

function assertNoLeak(response: RejectionResponse, scenarioLabel: string): void {
  // Status assertion first — must be 401, never 403.
  expect(
    response.status,
    `${scenarioLabel}: expected 401 (not 403 — 403 itself leaks "you have a valid token"), got ${response.status}`,
  ).toBe(HTTP_UNAUTHORIZED);

  // Combine body + all headers into one searchable blob.
  const headerBlob = Object.entries(response.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const blob = `${response.body}\n${headerBlob}`;

  for (const { pattern, reason } of FORBIDDEN_LEAK_PATTERNS) {
    expect(
      blob,
      `${scenarioLabel}: 401 response ${reason}. Found match for ${pattern}. Body: ${JSON.stringify(response.body.slice(0, 500))}. Suspicious headers: ${JSON.stringify(response.headers)}`,
    ).not.toMatch(pattern);
  }

  // WWW-Authenticate header, if present, must be a generic Bearer challenge
  // — no realm parameter that would leak the expected realm name.
  const wwwAuth = response.headers['www-authenticate'];
  if (typeof wwwAuth === 'string' && wwwAuth.length > 0) {
    // Allow `Bearer` and standard error= / error_description= params, BUT
    // those error_description params must not contain realm-specific text
    // (already covered by the general blob check above).
    expect(
      wwwAuth.toLowerCase(),
      `WWW-Authenticate must not include a realm= directive that names a Keycloak realm. Got: ${wwwAuth}`,
    ).not.toMatch(/realm\s*=\s*"?(questioner|onlinemenu|onlinemenu)"?/i);
  }
}

test.describe('401 Response Sanitization — no info leak in rejection bodies @cross-product-isolation @critical', () => {
  test('QuestionerService 401 (no token) does NOT leak realm/product names', async () => {
    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const response = await fetchRejection(api, PROBE_PATHS.questioner, null);
      assertNoLeak(response, 'QuestionerService — no token');
    } finally {
      await api.dispose();
    }
  });

  test('OnlineMenuService 401 (no token) does NOT leak realm/product names', async () => {
    const api = await makeApiContext(SERVICE_URLS.onlineMenu);
    try {
      const response = await fetchRejection(api, PROBE_PATHS.onlineMenu, null);
      assertNoLeak(response, 'OnlineMenuService — no token');
    } finally {
      await api.dispose();
    }
  });

  test('QuestionerService 401 (cross-realm onlinemenu token) does NOT leak realm/product names', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const response = await fetchRejection(api, PROBE_PATHS.questioner, `Bearer ${token.accessToken}`);
      assertNoLeak(response, 'QuestionerService — cross-realm onlinemenu token');
    } finally {
      await api.dispose();
    }
  });

  test('OnlineMenuService 401 (cross-realm questioner token) does NOT leak realm/product names', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.onlineMenu);
    try {
      const response = await fetchRejection(api, PROBE_PATHS.onlineMenu, `Bearer ${token.accessToken}`);
      assertNoLeak(response, 'OnlineMenuService — cross-realm questioner token');
    } finally {
      await api.dispose();
    }
  });

  test('Cross-realm rejection 401 must be indistinguishable from no-token 401 (same status code)', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const noToken = await fetchRejection(api, PROBE_PATHS.questioner, null);
      const wrongRealm = await fetchRejection(api, PROBE_PATHS.questioner, `Bearer ${token.accessToken}`);

      expect(noToken.status, 'no-token must be 401').toBe(HTTP_UNAUTHORIZED);
      expect(wrongRealm.status, 'wrong-realm must be 401 (not 403)').toBe(HTTP_UNAUTHORIZED);

      // Status code is the strongest signal — both must be the same.
      expect(
        wrongRealm.status,
        'Cross-realm rejection MUST return identical status code to no-token rejection',
      ).toBe(noToken.status);
    } finally {
      await api.dispose();
    }
  });
});
