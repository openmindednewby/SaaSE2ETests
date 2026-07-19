/**
 * Does clicking "Log out" actually KILL the server-side session?
 *
 * ── Why this helper exists, and why the obvious test is worthless ─────────────
 *
 * The defect (fixed by `performBffLogout` + `logoutNavigationGuard` in
 * erevna-web and katalogos-web) was:
 *
 *   AuthProvider.logout()  →  fires POST /bff/logout  (does NOT await it)
 *                          →  dispatch(setAuthenticated(false))
 *                          →  ProtectedLayout's route guard sees !isLoggedIn
 *                          →  scheduleFallbackNavigation(150 ms)
 *                          →  window.location.replace()
 *                          →  document unload CANCELS the in-flight POST
 *
 * A BFF logout round-trip routinely exceeds 150 ms, so the request never
 * reached the server. The UI showed the login form; the operator believed they
 * had signed out; the server-side session and the IdP session BOTH survived.
 * Anyone holding that cookie stayed fully authenticated.
 *
 * 🔴 THE TRAP. Three of the five original unit tests PASSED against the broken
 * code, because they asserted things the BUG ALSO SATISFIES:
 *
 *   - "we navigated to /login"      → the bug navigates to /login. Passes.
 *   - "local auth state is cleared" → the bug clears local state. Passes.
 *   - "the login form is visible"   → it is. Passes.
 *
 * Every one of those observes the CLIENT. The bug is entirely on the SERVER
 * side of a request that was cancelled. A test that never asks the server a
 * question cannot see this defect, and will report green forever.
 *
 * ── The only assertion that can fail on the bug ───────────────────────────────
 *
 * Capture the session cookie while logged in, drive the REAL UI logout button,
 * then REPLAY that exact cookie against an authenticated endpoint from a
 * clean, isolated HTTP context:
 *
 *   401 → the session is genuinely dead.       PASS
 *   200 → the session SURVIVED logout.         FAIL — the defect is back.
 *
 * ── The positive control (do not remove it) ───────────────────────────────────
 *
 * A bare "expect 401 after logout" is itself untrustworthy: a 401 could equally
 * mean the replay technique is broken (wrong cookie name, wrong header, wrong
 * endpoint) — in which case the test passes while proving NOTHING. So we first
 * replay the same cookie the same way BEFORE logging out and require 200. That
 * pins the technique: the only variable between the two replays is the logout.
 *
 * ── It must be the UI button, not a direct POST ───────────────────────────────
 *
 * Calling POST /bff/logout with curl passes against the BROKEN build too — the
 * server endpoint was always correct; the bug is that the browser never
 * delivered the request. Only clicking the real button exercises the race.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { retryWhileRateLimited } from './rate-limit.js';

export interface BffLogoutPortal {
  /** Human name used in assertion messages, e.g. `erevna-web`. */
  readonly label: string;
  /** SPA origin, e.g. `https://erevna.dloizides.com`. */
  readonly baseUrl: string;
  /** Opaque session cookie, e.g. `__Host-bff-erevna`. */
  readonly cookieName: string;
  /**
   * A route inside the PROTECTED layout, e.g. `/settings`. Required because
   * `/` serves the public marketing landing on these apps — it renders no
   * logout control, authenticated or not.
   */
  readonly protectedPath: string;
}

interface LoginOutcome {
  readonly status: number;
  readonly bodyExcerpt: string;
}

/**
 * Log in the way the SPA's own `BffAuthClient` does — a same-origin fetch from
 * a loaded page, so the BFF's origin/CSRF checks are satisfied naturally.
 *
 * NB: this is only how we ESTABLISH a session. The logout under test is driven
 * through the real UI button below; using fetch here just keeps the setup
 * independent of the branded login form's rendering.
 */
async function bffLogin(page: Page, username: string, password: string): Promise<LoginOutcome> {
  const attempt = (): Promise<LoginOutcome> =>
    page.evaluate(
      async (creds: { username: string; password: string }): Promise<LoginOutcome> => {
        const res = await fetch('/bff/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
          body: JSON.stringify({ username: creds.username, password: creds.password }),
        });
        let bodyExcerpt = '';
        try {
          const text = await res.text();
          bodyExcerpt = text
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
            .slice(0, 200);
        } catch {
          // no body — fine
        }
        return { status: res.status, bodyExcerpt };
      },
      { username, password },
    );

  // Auth endpoints are rate limited (5/60s per IP). A dense suite can trip the
  // limiter transiently; retry with backoff so a 429 is not mis-read as a
  // product fault. A request still limited after all retries surfaces as-is.
  return retryWhileRateLimited(`${page.url()} /bff/login`, attempt, (r: LoginOutcome) => r.status);
}

/**
 * Replay a raw session cookie against `GET /bff/me` from a CLEAN HTTP context.
 *
 * Isolation matters: a fresh `APIRequestContext` shares no cookie jar, storage
 * or connection state with the browser that just logged out, so a 200 here can
 * only mean the server still honours this cookie.
 */
async function replaySession(
  portal: BffLogoutPortal,
  cookieValue: string,
): Promise<{ status: number; body: string }> {
  const ctx = await playwrightRequest.newContext({
    baseURL: portal.baseUrl,
    extraHTTPHeaders: { Cookie: `${portal.cookieName}=${cookieValue}` },
    ignoreHTTPSErrors: true,
  });
  try {
    const res = await ctx.get('/bff/me', { failOnStatusCode: false });
    return { status: res.status(), body: (await res.text().catch(() => '')).slice(0, 200) };
  } finally {
    await ctx.dispose();
  }
}

/** Click the real sign-out control, revealing it from the mobile drawer if needed. */
async function clickLogoutInUi(page: Page): Promise<void> {
  const logoutButton = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON)).first();

  if (!(await logoutButton.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Narrow layouts keep sign-out behind the topbar menu.
    const menu = page.locator(testIdSelector(TestIds.NAV_MENU)).first();
    if (await menu.isVisible({ timeout: 2000 }).catch(() => false)) await menu.click();
  }

  await expect(
    logoutButton,
    'the authenticated UI must expose a logout control for this test to mean anything',
  ).toBeVisible({ timeout: 10000 });

  await logoutButton.click();
}

/**
 * Full proof for one portal. Throws with a precise message on the defect.
 *
 * Returns the observed post-logout replay status so callers can report it.
 */
export async function assertLogoutKillsServerSession(
  browser: Browser,
  portal: BffLogoutPortal,
  username: string,
  password: string,
): Promise<number> {
  // Fresh context — the session must come purely from the login below, never
  // from seeded storage state.
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${portal.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const login = await bffLogin(page, username, password);
    expect(
      login.status,
      `[${portal.label}] setup: POST /bff/login must succeed — got ${String(login.status)}; body: ${login.bodyExcerpt}`,
    ).toBe(200);

    // ── Capture the exact cookie the browser now holds ───────────────────────
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === portal.cookieName);
    expect(
      sessionCookie,
      `[${portal.label}] setup: expected session cookie "${portal.cookieName}" after login`,
    ).toBeDefined();
    const cookieValue = sessionCookie?.value ?? '';
    expect(cookieValue.length, `[${portal.label}] setup: session cookie must be non-empty`).toBeGreaterThan(0);

    // ── POSITIVE CONTROL ─────────────────────────────────────────────────────
    // Prove the replay technique DETECTS a live session before trusting it to
    // detect a dead one. Without this a 401 below could mean "replay broken".
    const live = await replaySession(portal, cookieValue);
    expect(
      live.status,
      `[${portal.label}] positive control FAILED: replaying a freshly-issued session cookie against ` +
        `GET /bff/me returned ${String(live.status)}, expected 200. The replay technique is not ` +
        `working (wrong cookie name/endpoint?), so the post-logout 401 assertion would be ` +
        `meaningless. Body: ${live.body}`,
    ).toBe(200);

    // ── Re-bootstrap the SPA on a PROTECTED route so the real app chrome (and
    //    its logout button) renders from the cookie, exactly as a returning
    //    user would see it. `/` is the public marketing landing here.
    await page.goto(`${portal.baseUrl}${portal.protectedPath}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // ── Drive the REAL logout button. This is what exercises the cancelled-
    //    request race; a direct POST would pass against the broken build too.
    await clickLogoutInUi(page);

    // ── Wait for the CLIENT-side end of logout: the moment the naive test
    //    declared victory. Everything after this point is the real assertion.
    await expect(
      // The login form's own testID — one stable selector. (An earlier draft OR-ed
      // this with the username input; that both trips the repo's no-locator-or-chain
      // rule and is redundant, since the input lives inside this form.)
      page.locator(testIdSelector(TestIds.LOGIN_FORM)).first(),
      `[${portal.label}] the UI did not reach a logged-out state after clicking logout`,
    ).toBeVisible({ timeout: 20000 });

    // ── THE ASSERTION THAT CAN ACTUALLY FAIL ON THE BUG ──────────────────────
    const afterLogout = await replaySession(portal, cookieValue);
    expect(
      afterLogout.status,
      `🔴 [${portal.label}] SESSION SURVIVED LOGOUT. The UI showed the login form, but replaying ` +
        `the pre-logout "${portal.cookieName}" cookie against GET /bff/me returned ` +
        `${String(afterLogout.status)} (expected 401). Anyone holding this cookie is still ` +
        `authenticated — this is the exact defect performBffLogout + logoutNavigationGuard fix. ` +
        `Body: ${afterLogout.body}`,
    ).toBe(401);

    return afterLogout.status;
  } finally {
    await context.close();
  }
}
