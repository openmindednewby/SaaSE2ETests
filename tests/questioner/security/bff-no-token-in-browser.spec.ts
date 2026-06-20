import { test, expect } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { retryWhileRateLimited } from '../../../helpers/rate-limit.js';

/**
 * Phase 2 BFF security verification — erevna-web (Step 4b).
 *
 * The whole point of the per-app BFF (`bff-erevna`) is that the browser
 * never holds a Keycloak token. Authentication is terminated server-side: the
 * BFF does ROPC against Keycloak, vaults the access/refresh/id tokens in
 * Redis, and hands the browser only an opaque, httpOnly `__Host-bff-erevna`
 * session cookie. An XSS therefore has nothing to steal — there is no token in
 * any JS-reachable surface.
 *
 * This spec proves that property concretely against the BFF-fronted erevna-web
 * SPA. It performs the login the same way the SPA's `BffAuthClient` does — a
 * same-origin `fetch('/bff/login', { credentials: 'include' })` evaluated
 * inside a real loaded page — then asserts:
 *   - the login succeeded and the response body carries NO token, and
 *   - the `__Host-bff-erevna` cookie exists and is httpOnly + Secure, and
 *   - no access/refresh/id token is present in localStorage, sessionStorage,
 *     or the persisted Redux auth slice after the SPA re-bootstraps.
 *
 * Driving login through `fetch` (rather than the branded form) keeps the spec
 * independent of the SPA's client-side route rendering while still exercising
 * the real `bff-erevna` ROPC + cookie flow end-to-end.
 *
 * The erevna-web SPA is a distinct host from the legacy BaseClient SPA the
 * rest of the questioner suite drives (`BASE_URL`). It is resolved from
 * `EREVNA_BASE_URL`, defaulting to the staging erevna host (the E2E
 * host-override resolves `staging.*.dloizides.com` to the staging cluster).
 *
 * Tagged @questioner so it runs with the questioner suite.
 */
const EREVNA_BASE_URL =
  process.env.EREVNA_BASE_URL ?? 'https://staging.erevna.dloizides.com';

interface BffLoginResult {
  status: number;
  statusText: string;
  bodyHasToken: boolean;
  /**
   * Short, token-redacted excerpt of the login response body. Only used to
   * make a FAILED login actionable in the canary report (404 = route missing,
   * 401 = bad creds / user not seeded in the questioner realm, 403 = CSRF
   * rejected, 5xx = BFF/Keycloak error). Never contains a token: any JWT-ish
   * run is stripped before the value leaves the page context.
   */
  bodyExcerpt: string;
}

test.describe('BFF — no token reachable from browser JS @questioner @bff @security', () => {
  test.slow();

  test('after BFF login the browser holds only the httpOnly session cookie', async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Fresh context — no seeded storage state. The session must come purely
    // from the BFF login flow, not from any pre-injected token.
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load the SPA shell so a same-origin `fetch('/bff/login')` is possible.
    await page.goto(`${EREVNA_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Perform the BFF login exactly as the SPA's `BffAuthClient.login` does:
    // a same-origin POST to `/bff/login` with `credentials: 'include'` and the
    // `X-BFF-Csrf` anti-forgery header. `bff-erevna` terminates this against
    // the `questioner` realm and sets the httpOnly session cookie.
    // Perform one same-origin POST to /bff/login and report the outcome.
    const attemptBffLogin = (): Promise<BffLoginResult> =>
      page.evaluate(
        async (creds: { username: string; password: string }): Promise<BffLoginResult> => {
          const res = await fetch('/bff/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
            body: JSON.stringify({ username: creds.username, password: creds.password }),
          });
          let bodyHasToken = false;
          let bodyExcerpt = '';
          try {
            const text = await res.text();
            bodyHasToken = /access_?token|refresh_?token|"token"|eyJ[A-Za-z0-9_-]+\./i.test(text);
            // Redact anything JWT-ish before the excerpt leaves the page context,
            // then cap the length — this only exists to explain a FAILED login.
            bodyExcerpt = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>').slice(0, 200);
          } catch {
            // no body — fine
          }
          return { status: res.status, statusText: res.statusText, bodyHasToken, bodyExcerpt };
        },
        { username: adminUser.username, password: adminUser.password },
      );

    // The erevna BFF fronts /bff/login with an auth rate limiter; a canary
    // firing many auth ops can transiently hit HTTP 429. Retry with backoff
    // (the limiter window drains) before asserting — mirrors loginAndWait.
    const loginResult = await retryWhileRateLimited(
      'bff-no-token /bff/login',
      attemptBffLogin,
      (r: BffLoginResult) => r.status,
    );

    expect(
      loginResult.status,
      `POST /bff/login must succeed — got ${loginResult.status} ${loginResult.statusText} for user "${adminUser.username}" at ${EREVNA_BASE_URL}; body: ${loginResult.bodyExcerpt}`,
    ).toBe(200);
    expect(loginResult.bodyHasToken, 'the /bff/login response body must NOT carry a token').toBe(false);

    // 1. The opaque BFF session cookie must be present and httpOnly + Secure.
    const cookies = await context.cookies();
    const bffCookie = cookies.find((c) => c.name === '__Host-bff-erevna');
    expect(bffCookie, 'the __Host-bff-erevna session cookie must be set').toBeDefined();
    expect(bffCookie?.httpOnly, 'the BFF session cookie must be httpOnly').toBe(true);
    expect(bffCookie?.secure, 'the BFF session cookie must be Secure').toBe(true);

    // Reload so the SPA re-bootstraps its session from `GET /bff/me` (cookie)
    // and writes whatever it persists — the storage scan below then runs
    // against the SPA's real post-login state.
    await page.goto(`${EREVNA_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 2. No token may appear in any JS-reachable storage. Scan every key/value
    // in localStorage + sessionStorage and the persisted Redux auth slice for
    // anything that looks like a JWT or a token field.
    const tokenLeak = await page.evaluate(() => {
      const looksLikeJwt = (v: string): boolean => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./.test(v);
      const offenders: string[] = [];

      const scanStore = (store: Storage, label: string): void => {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (key === null) continue;
          const value = store.getItem(key) ?? '';
          if (looksLikeJwt(value)) {
            offenders.push(`${label}[${key}] holds a JWT`);
          }
          // The persisted Redux auth slice must not carry token fields.
          if (key.includes('persist:auth') || key === 'persist:auth') {
            try {
              const parsed = JSON.parse(value) as Record<string, unknown>;
              for (const field of ['accessToken', 'refreshToken', 'idToken', 'token']) {
                const fieldValue = parsed[field];
                if (typeof fieldValue === 'string' && fieldValue.length > 0) {
                  offenders.push(`${label}[${key}].${field} is non-empty`);
                }
              }
            } catch {
              // not JSON — the JWT scan above already covered raw values
            }
          }
        }
      };

      scanStore(window.localStorage, 'localStorage');
      scanStore(window.sessionStorage, 'sessionStorage');
      return offenders;
    });

    expect(tokenLeak, `no token must be reachable from JS — found: ${tokenLeak.join('; ')}`).toEqual([]);

    await context.close();
  });
});
