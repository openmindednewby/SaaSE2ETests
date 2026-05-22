import { test, expect } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';

/**
 * Phase 2 BFF security verification — katalogos-web.
 *
 * The whole point of the per-app BFF (`bff-katalogos`) is that the browser
 * never holds a Keycloak token. Authentication is terminated server-side: the
 * BFF does ROPC against Keycloak, vaults the access/refresh/id tokens in
 * Redis, and hands the browser only an opaque, httpOnly `__Host-bff-katalogos`
 * session cookie. An XSS therefore has nothing to steal — there is no token in
 * any JS-reachable surface.
 *
 * This spec proves that property concretely against the BFF-fronted katalogos-web
 * SPA. It performs the login the same way the SPA's `BffAuthClient` does — a
 * same-origin `fetch('/bff/login', { credentials: 'include' })` evaluated
 * inside a real loaded page — then asserts:
 *   - the login succeeded and the response body carries NO token, and
 *   - the `__Host-bff-katalogos` cookie exists and is httpOnly + Secure, and
 *   - no access/refresh/id token is present in localStorage, sessionStorage,
 *     or the persisted Redux auth slice after the SPA re-bootstraps.
 *
 * The katalogos-web SPA is a distinct host from the legacy BaseClient SPA the
 * rest of the online-menus suite drives (`BASE_URL`). It is resolved from
 * `KATALOGOS_BASE_URL`, defaulting to the staging katalogos host (the E2E
 * host-override resolves `staging.*.dloizides.com` to the staging cluster).
 *
 * Tagged @online-menus so it runs with the katalogos suite.
 */
const KATALOGOS_BASE_URL =
  process.env.KATALOGOS_BASE_URL ?? 'https://staging.katalogos.dloizides.com';

interface BffLoginResult {
  status: number;
  bodyHasToken: boolean;
}

test.describe('BFF — no token reachable from browser JS @online-menus @bff @security', () => {
  test.slow();

  test('after BFF login the browser holds only the httpOnly session cookie', async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Fresh context — no seeded storage state. The session must come purely
    // from the BFF login flow, not from any pre-injected token.
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load the SPA shell so a same-origin `fetch('/bff/login')` is possible.
    await page.goto(`${KATALOGOS_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Perform the BFF login exactly as the SPA's `BffAuthClient.login` does:
    // a same-origin POST to `/bff/login` with `credentials: 'include'` and the
    // `X-BFF-Csrf` anti-forgery header. `bff-katalogos` terminates this against
    // the `onlinemenu` realm and sets the httpOnly session cookie.
    const loginResult = await page.evaluate(
      async (creds: { username: string; password: string }): Promise<BffLoginResult> => {
        const res = await fetch('/bff/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
          body: JSON.stringify({ username: creds.username, password: creds.password }),
        });
        let bodyHasToken = false;
        try {
          const text = await res.text();
          bodyHasToken = /access_?token|refresh_?token|"token"|eyJ[A-Za-z0-9_-]+\./i.test(text);
        } catch {
          // no body — fine
        }
        return { status: res.status, bodyHasToken };
      },
      { username: adminUser.username, password: adminUser.password },
    );

    expect(loginResult.status, 'POST /bff/login must succeed').toBe(200);
    expect(loginResult.bodyHasToken, 'the /bff/login response body must NOT carry a token').toBe(false);

    // 1. The opaque BFF session cookie must be present and httpOnly + Secure.
    const cookies = await context.cookies();
    const bffCookie = cookies.find((c) => c.name === '__Host-bff-katalogos');
    expect(bffCookie, 'the __Host-bff-katalogos session cookie must be set').toBeDefined();
    expect(bffCookie?.httpOnly, 'the BFF session cookie must be httpOnly').toBe(true);
    expect(bffCookie?.secure, 'the BFF session cookie must be Secure').toBe(true);

    // Reload so the SPA re-bootstraps its session from `GET /bff/me` (cookie)
    // and writes whatever it persists — the storage scan below then runs
    // against the SPA's real post-login state.
    await page.goto(`${KATALOGOS_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
