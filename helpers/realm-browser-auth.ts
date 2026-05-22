/**
 * BFF browser auth — establishes a logged-in session for a Playwright page
 * against a BFF-fronted SPA (erevna-web / katalogos-web).
 *
 * Retargeting (2026-05-22)
 * -----------------------
 * The E2E UI suites now drive the REAL shipped apps — `erevna-web` (questioner)
 * and `katalogos-web` (online menus) — instead of the legacy BaseClient SPA
 * (Phase-6-deletion-bound). Each real app is fronted by a per-app BFF
 * (`bff-erevna` / `bff-katalogos`): authentication is terminated server-side.
 * A same-origin POST to `/bff/login` makes the BFF do ROPC against the app's
 * Keycloak realm, vault the tokens in Redis, and set an opaque httpOnly
 * `__Host-bff-{app}` session cookie. The SPA then bootstraps its session from
 * `GET /bff/me` on the next navigation. The browser holds NO token.
 *
 * This replaces the old KI-5 `injectRealmAuth` token-injection hack. That hack
 * seeded a realm-scoped JWT into `persist:auth` storage — which only works for
 * the legacy direct-KC BaseClient SPA. A BFF-fronted SPA has nothing to inject
 * (the cookie IS the session). The KI-5 cross-realm problem is also gone:
 * `erevna-web` is realm-pinned to `questioner` and `katalogos-web` to
 * `onlinemenu` by their own BFFs, so each app's login natively mints a token
 * in the correct realm — no per-product realm override needed.
 *
 * The app host comes from the page's project `baseURL`: a relative
 * `page.goto('/')` resolves to erevna-web for the questioner chunks and to
 * katalogos-web for the rest (see `playwright.projects.ts`).
 */
import type { Page } from '@playwright/test';

interface BffLoginEvalResult {
  status: number;
  body: string;
}

/**
 * Performs the same-origin `/bff/login` POST inside a loaded page and returns
 * the raw status + body. Mirrors what the SPA's `BffAuthClient.login` does.
 */
async function postBffLogin(page: Page, user: { username: string; password: string }): Promise<BffLoginEvalResult> {
  return page.evaluate(
    async (creds: { username: string; password: string }): Promise<BffLoginEvalResult> => {
      const res = await fetch('/bff/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
      });
      let body = '';
      try {
        body = await res.text();
      } catch {
        // no body — fine
      }
      return { status: res.status, body };
    },
    { username: user.username, password: user.password },
  );
}

/**
 * Log a Playwright page into its BFF-fronted SPA. After this resolves the
 * browser context holds the `__Host-bff-{app}` session cookie and the page is
 * sitting on the authenticated app root — the caller can navigate straight to
 * any protected route.
 *
 * The app is determined by the page's project `baseURL`; no realm argument is
 * needed (each app's BFF owns its realm). Call from `test.beforeAll` (or
 * wherever the suite establishes its session):
 *
 *     await loginAsTenantAdminBrowser(page, adminUser);
 */
export async function loginAsTenantAdminBrowser(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  // Load the SPA shell so a same-origin `fetch('/bff/login')` is possible.
  // The path is relative — Playwright resolves it against the project baseURL.
  // An unauthenticated load bounces to /login; that is still the same origin,
  // so the BFF login below works regardless of the landing path.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const result = await postBffLogin(page, user);
  if (result.status !== 200) {
    throw new Error(
      `loginAsTenantAdminBrowser: POST /bff/login failed (status ${result.status}) ` +
        `for user '${user.username}' at ${page.url()} — ${result.body.slice(0, 200)}`,
    );
  }

  // Re-bootstrap the SPA from `GET /bff/me` (cookie) so the page is in its
  // authenticated state before the caller navigates to a protected route.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
}
