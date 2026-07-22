// Digital Kin @api tier — constants, token minting and Greek fixtures.
//
// Separate from `digital-kin-helpers.ts` on a real seam: that file owns the PUBLIC ASTRO SITE
// (routes, sitemap, purge receiver), this owns the DigitalKinService HTTP API behind it. They are
// two different deployments on two different clusters and share nothing but a product name.
//
// 🔴 ROUTES ARE LITERALLY `/v1/...`. UseFastEndpoints registers no route prefix, so anything that
// appends `/api` does NOT reach an endpoint — and the miss surfaces as **401, not 404**, because
// the authorization fallback policy rejects unmatched routes before routing reports them missing.
// A 401 therefore tells you NOTHING about whether a route exists. Every route constant below was
// verified against the running staging deployment with a known-good 200 as the tie-break.
import { request as playwrightRequest } from '@playwright/test';

import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * The DigitalKinService API. Staging-only by design (spec D17): there is no prod instance and no
 * prod database — the prod Astro site reaches this over WireGuard via the prod proxy.
 *
 * A REAL default, not `undefined`: an unset env var would silently skip the whole suite rather
 * than test the one target it has. (zygos-helpers.ts documents the same choice for the same
 * reason, and this suite exists partly because a previous Digital Kin run reported green while
 * every test skipped.)
 */
export const DIGITALKIN_API_URL = (
  process.env.DIGITALKIN_API_URL?.trim() || 'http://10.0.0.2:30357'
).replace(/\/+$/, '');

/** Staging Keycloak. No real TLS (WireGuard-only) — every request here needs ignoreHTTPSErrors. */
export const DIGITALKIN_KEYCLOAK_URL = (
  process.env.DIGITALKIN_KEYCLOAK_URL?.trim() || 'https://staging.identity.dloizides.com'
).replace(/\/+$/, '');

/** The realm both fixture users live in. */
export const DIGITALKIN_REALM = 'digitalkin';

/** The BFF's confidential client. Direct grant is enabled on it for exactly this purpose. */
export const DIGITALKIN_CLIENT_ID = 'bff-digitalkin-client';

/**
 * The two seeded demo users (spec D18), and the role boundary this suite exists to prove.
 *
 * MASTER owns the taxonomy; ADMIN authors guides. The asymmetry that is easy to get wrong:
 * admin can **READ** taxonomy (200) but cannot **WRITE** it (403). See `GetTaxonomyEndpoint`'s
 * remarks — read was master-only until it was proved unshippable, because every guide write
 * requires a `categoryId` that only the taxonomy read publishes.
 */
export const DIGITALKIN_USERS = {
  MASTER: process.env.DIGITALKIN_DEMO_MASTER_USER?.trim() || 'demo-master',
  ADMIN: process.env.DIGITALKIN_DEMO_ADMIN_USER?.trim() || 'demo-admin',
} as const;

/** Public routes, mirroring `PublicContentRoutes`. Anonymous, every one. */
export const DK_PUBLIC = {
  categories: '/v1/public/categories',
  categoryBySlug: (slug: string) => `/v1/public/categories/${slug}`,
  subCategoryBySlug: (slug: string, sub: string) => `/v1/public/categories/${slug}/${sub}`,
  guides: '/v1/public/guides',
  guideBySlug: (slug: string) => `/v1/public/guides/${slug}`,
  pageByKey: (key: string) => `/v1/public/pages/${key}`,
  resources: '/v1/public/resources',
  search: '/v1/public/search',
  contact: '/v1/public/contact',
} as const;

/** Admin routes, mirroring `AdminRoutes`. Bearer-only — the CMS never sees a token itself. */
export const DK_ADMIN = {
  taxonomy: '/v1/admin/taxonomy',
  categoryById: (id: string) => `/v1/admin/categories/${id}`,
  subCategories: '/v1/admin/subcategories',
  subCategoryById: (id: string) => `/v1/admin/subcategories/${id}`,
  guides: '/v1/admin/guides',
  guideById: (id: string) => `/v1/admin/guides/${id}`,
  pages: '/v1/admin/pages',
  resources: '/v1/admin/resources',
  messages: '/v1/admin/messages',
} as const;

/**
 * The six seeded categories, with their published guide counts (verified live 2026-07-22).
 *
 * Pinned as data rather than asserted loosely: "returns 200 with a non-empty array" passes against
 * a category list that has silently lost half its rows.
 */
export const DK_SEEDED_CATEGORIES = [
  { key: 'mobile', slug: 'kinito', name: 'Κινητό', publishedGuideCount: 2 },
  { key: 'family', slug: 'oikogeneia', name: 'Οικογένεια', publishedGuideCount: 1 },
  { key: 'internet', slug: 'diadiktyo', name: 'Διαδίκτυο', publishedGuideCount: 0 },
  { key: 'safety', slug: 'asfaleia', name: 'Ασφάλεια', publishedGuideCount: 2 },
  { key: 'services', slug: 'ypiresies', name: 'Υπηρεσίες', publishedGuideCount: 1 },
  { key: 'apps', slug: 'efarmoges', name: 'Εφαρμογές', publishedGuideCount: 0 },
] as const;

/**
 * 🔴 GREEK SEARCH FIXTURES — the highest-value assertions in this suite.
 *
 * Greek has three ways to write the "same" word that a naive `LIKE` treats as three different
 * words, and an elderly-audience search box that only matches perfectly-typed accented Greek is
 * broken for the exact people this product is for:
 *
 *  1. **Accents.** `πληροφορίες` vs `πληροφοριες` — the tonos is routinely omitted.
 *  2. **Final sigma.** `ς` at word end vs `σ` medially. A phone keyboard, or a user typing a word
 *     they expect to continue, produces `πληροφοριεσ`. Same word, different codepoint.
 *  3. **Case.** Older users type in caps far more often than the general population.
 *
 * All four spellings below MUST return the same single guide. They are asserted as behaviour, not
 * as status codes: `200 OK` with `count: 0` is what a broken search returns.
 *
 * ⚠️ These are real UTF-8 literals and must stay that way. An earlier probe of this same API
 * through Git Bash produced `q=p????f???es` — the shell mangled the Greek in argv and the endpoint
 * dutifully reported `count: 0`, which looked exactly like a search defect and was not. Node and
 * Playwright encode query params correctly; a shell in the loop does not.
 */
export const DK_SEARCH = {
  /** All four spellings of "information" — must all find the same guide. */
  informationSpellings: [
    { label: 'accented, final sigma', q: 'πληροφορίες' },
    { label: 'unaccented, final sigma', q: 'πληροφοριες' },
    { label: 'unaccented, MEDIAL sigma', q: 'πληροφοριεσ' },
    { label: 'UPPERCASE', q: 'ΠΛΗΡΟΦΟΡΙΕΣ' },
  ],
  /** The one guide every spelling above must resolve to. */
  informationSlug: 'ti-na-min-moirazeste-sto-diadiktyo',
  /** A word in a guide TITLE — accented and unaccented must both match. */
  titleWord: { accented: 'μήνυμα', unaccented: 'μηνυμα', slug: 'pos-na-steilete-minyma' },
  /**
   * 🔴 A word that appears ONLY in a guide STEP, never in its title or intro.
   *
   * Steps are NOT indexed — the tsvector covers title + intro only. This is a real limitation, so
   * it is PINNED here rather than left to be rediscovered as a bug report. If someone later
   * extends the index to cover steps, this assertion fails and forces a deliberate decision
   * instead of silently changing what the search box means.
   */
  stepOnlyWord: 'μολύβι',
  /** Inputs that must degrade to an empty result set, never a 4xx and never a 5xx. */
  degradeToEmpty: [
    { label: 'empty string', q: '' },
    { label: 'punctuation only', q: '!!!???' },
    { label: 'latin garbage', q: 'zzzzqqqxyzzy' },
    { label: 'SQL injection', q: "'; DROP TABLE guides;--" },
    { label: 'SQL boolean injection', q: "' OR '1'='1" },
    { label: 'tsquery metacharacters', q: '& | ! ( ) : *' },
  ],
} as const;

/** Body text of a response, for failure messages that say what actually came back. */
export async function bodyText(response: APIResponse): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}

/** Prefixes a created entity so re-runs never collide and the canary sweep can find it. */
export function dkTag(label: string): string {
  const prefix = process.env.E2E_CANARY_PREFIX ?? 'e2e-';
  return `${prefix}dk-${label}-${String(Date.now()).slice(-6)}`;
}

/**
 * The password for a fixture user, from the environment.
 *
 * Returns null rather than throwing so the caller can decide: the @api tier skips with a REASON
 * when credentials are absent (a runner without secrets is a legitimate configuration), but never
 * skips when they are present and rejected — that is a real failure.
 */
export function passwordFor(username: string): string | null {
  const byUser: Record<string, string | undefined> = {
    [DIGITALKIN_USERS.MASTER]: process.env.DIGITALKIN_DEMO_MASTER_PASSWORD,
    [DIGITALKIN_USERS.ADMIN]: process.env.DIGITALKIN_DEMO_ADMIN_PASSWORD,
  };
  return byUser[username]?.trim() || process.env.DIGITALKIN_TEST_PASSWORD?.trim() || null;
}

/** Distinguishes the outcomes that must never be conflated — see `mintToken`. */
export type TokenOutcome =
  | { kind: 'ok'; token: string }
  /** Credentials genuinely rejected. Deterministic — do not retry, and never treat as "skip". */
  | { kind: 'rejected'; status: number; body: string }
  /** Keycloak unreachable, or no client secret configured. A legitimate reason to skip. */
  | { kind: 'unavailable'; reason: string };

/** Cached so the suite mints one token per user, not one per test. */
const tokenCache = new Map<string, string>();

/**
 * Mint an access token by direct grant against staging Keycloak.
 *
 * Why direct grant instead of driving the BFF login form: this is the @api tier, and the tokens it
 * needs are the ones the API validates. Scripting a browser login would spend the shared
 * `RateLimitPolicies.Auth` budget (5 requests / 60s PER IP, sliding) to obtain the same bearer
 * token, and a 429 in a `beforeAll` is precisely how a previous suite ended up with twelve tests
 * silently skipping and a green report.
 *
 * `ignoreHTTPSErrors` is deliberate and NOT papering over a defect: staging Keycloak is reachable
 * only over WireGuard and serves a self-signed certificate. That is the standing posture for this
 * cluster.
 */
export async function mintToken(username: string): Promise<TokenOutcome> {
  const cached = tokenCache.get(username);
  if (cached) return { kind: 'ok', token: cached };

  const clientSecret = process.env.DIGITALKIN_BFF_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    return { kind: 'unavailable', reason: 'DIGITALKIN_BFF_CLIENT_SECRET is not set.' };
  }

  const password = passwordFor(username);
  if (!password) {
    return { kind: 'unavailable', reason: `No password configured for ${username}.` };
  }

  const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    const response = await context.post(
      `${DIGITALKIN_KEYCLOAK_URL}/realms/${DIGITALKIN_REALM}/protocol/openid-connect/token`,
      {
        form: {
          client_id: DIGITALKIN_CLIENT_ID,
          client_secret: clientSecret,
          username,
          password,
          grant_type: 'password',
          scope: 'openid',
        },
        timeout: 25_000,
      },
    );

    if (!response.ok()) {
      const status = response.status();
      // 4xx from a reachable Keycloak is a real answer: the credentials or the client are wrong.
      // Anything else means we could not ask the question.
      if (status >= 400 && status < 500) {
        return { kind: 'rejected', status, body: await bodyText(response) };
      }
      return { kind: 'unavailable', reason: `Keycloak answered ${status}.` };
    }

    const token = (await response.json())?.access_token;
    if (typeof token !== 'string' || token.length === 0) {
      return { kind: 'unavailable', reason: 'Keycloak returned no access_token.' };
    }

    tokenCache.set(username, token);
    return { kind: 'ok', token };
  } catch (error) {
    return { kind: 'unavailable', reason: `Keycloak unreachable: ${String(error)}` };
  } finally {
    await context.dispose();
  }
}

/** An anonymous API context against the Digital Kin API. */
export async function anonymousApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: DIGITALKIN_API_URL, ignoreHTTPSErrors: true });
}

/** An API context carrying `username`'s bearer token, or null when one cannot be minted. */
export async function authedApi(username: string): Promise<APIRequestContext | null> {
  const outcome = await mintToken(username);
  if (outcome.kind !== 'ok') return null;

  return playwrightRequest.newContext({
    baseURL: DIGITALKIN_API_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${outcome.token}` },
  });
}
