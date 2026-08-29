/**
 * SEC-2 — sign-out must END the IdP session, not just the app's.
 *
 * ─── WHY THIS TEST IS SHAPED LIKE THIS ────────────────────────────────────────
 * The obvious assertion — "`/bff/me` returns 401 after sign-out" — is WORTHLESS here.
 * It passes even when the bug is live: the SPA simply stops asking. An aml-v2 E2E
 * asserted exactly that and stayed green for two months while sign-out was broken.
 *
 * The assertion that actually bites is: after sign-out, does a FRESH AUTHORIZE
 * **prompt for credentials**, or does the IdP **silently re-issue a code** to someone
 * who just clicked "Sign out"?
 *
 * So each app is checked three ways, and the two controls are the point:
 *
 *   1. SANITY (control)    no logout at all  -> a fresh authorize MUST silently re-auth.
 *                          If this ever PROMPTS, the IdP is not doing silent SSO in this
 *                          flow and assertion (3) below would be vacuously green. This is
 *                          what stops this file from joining the hollow-test pile.
 *   2. ROPC   (control)    a password session MUST get idpLogoutUrl === null and perform
 *                          NO IdP navigation. Password sign-out already worked; breaking
 *                          it would be worse than the original bug.
 *   3. THE CONTRACT        a front-channel (auth-code/passkey) session, after sign-out:
 *                            a. the browser really NAVIGATES to the IdP end-session
 *                               endpoint, carrying id_token_hint (without it Keycloak
 *                               renders a "Do you want to log out?" page and LEAVES THE
 *                               SESSION ALIVE),
 *                            b. it lands back on the APP's own /login -- NOT stranded on
 *                               Keycloak's dead-end "You are logged out" page (that
 *                               regression shipped once; post_logout_redirect_uri must
 *                               stay registered on the client, or Keycloak rejects it),
 *                            c. a fresh authorize PROMPTS for credentials.
 *
 * NOTE ON THE ACTUAL BUG: on Keycloak the BFF's back-channel end-session call already
 * killed the SSO session, so these apps were NOT exploitable. The genuinely exploitable
 * IdP was OpenIddict (aml-identity), which exposes no end-session endpoint at all. The
 * front-channel logout is kept here as defence-in-depth (the back-channel call is
 * best-effort) and for the correct UX. This test locks in all of it either way.
 *
 * A password login through /bff/passkey/login mints a FRONT-CHANNEL session, so no
 * WebAuthn authenticator is needed.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
/** Longest we will wait for an OIDC redirect chain to come to rest. */
const SETTLE_TIMEOUT_MS = 15000;
/** The URL must hold still this long before the chain counts as finished. */
const URL_QUIET_MS = 750;
/** How often to re-check that the URL has stopped moving. */
const SETTLE_POLL_MS = 100;

interface AppUnderTest {
  readonly name: string;
  readonly baseUrl: string;
  readonly realm: string;
  readonly username: string;
  readonly password: string;
  /** testID of the real sign-out control in the app chrome. */
  readonly signOutTestId: string;
  /** A gated route that renders the app chrome (so the sign-out control exists). */
  readonly gatedPath?: string;
  /** Which match to click when the chrome renders more than one (sidebar + topbar). */
  readonly signOutNth?: number;
}

/**
 * Hosts + creds come from env so the same spec runs against local / staging / prod.
 * Skipped (not failed) when a product's base URL is not configured for this environment.
 */
const APPS: readonly AppUnderTest[] = [
  {
    name: 'kefi',
    baseUrl: process.env.KEFI_WEB_URL ?? '',
    realm: 'kefi',
    username: process.env.KEFI_TEST_USERNAME ?? '',
    password: process.env.KEFI_TEST_PASSWORD ?? '',
    signOutTestId: 'kefi-appheader-signout',
  },
  {
    name: 'katalogos',
    baseUrl: process.env.KATALOGOS_BASE_URL ?? '',
    realm: 'onlinemenu',
    username: process.env.TEST_USER_USERNAME ?? '',
    password: process.env.TEST_USER_PASSWORD ?? '',
    signOutTestId: 'logout-button',
    gatedPath: '/menus',
  },
  {
    name: 'erevna',
    baseUrl: process.env.EREVNA_BASE_URL ?? '',
    realm: 'questioner',
    username: process.env.TEST_USER_USERNAME ?? '',
    password: process.env.TEST_USER_PASSWORD ?? '',
    signOutTestId: 'logout-button',
    gatedPath: '/quiz-templates',
  },
  {
    name: 'poueni',
    baseUrl: process.env.POUENI_WEB_URL ?? '',
    realm: 'poueni',
    username: process.env.TEST_USER_USERNAME ?? '',
    password: process.env.TEST_USER_PASSWORD ?? '',
    signOutTestId: 'poueni-signout',
  },
];

/**
 * Wait for the OIDC redirect chain to come to REST.
 *
 * Was `waitForLoadState('networkidle') + waitForTimeout(3000)`. Both are banned, and both
 * deserved to be: `networkidle` never fires on a page that polls, and a fixed 3 s sleep is
 * simultaneously too slow against a fast IdP and too short against a slow one. This waits
 * until the URL has stopped moving instead - it returns as soon as the chain is at rest and
 * only spends the full budget when something really is still redirecting.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
  await page
    .waitForFunction(
      (quietMs: number) => {
        const marker = window as unknown as { __settleHref?: string; __settleAt?: number };
        const now = Date.now();
        if (marker.__settleHref !== window.location.href) {
          marker.__settleHref = window.location.href;
          marker.__settleAt = now;
          return false;
        }
        return now - (marker.__settleAt ?? now) >= quietMs;
      },
      URL_QUIET_MS,
      { timeout: SETTLE_TIMEOUT_MS, polling: SETTLE_POLL_MS },
    )
    .catch(() => undefined);
}

/** Sign in through the IdP's OWN hosted page, so the session is EstablishedByFrontChannel. */
async function frontChannelSignIn(page: Page, app: AppUnderTest): Promise<void> {
  await page.goto(`${app.baseUrl}/bff/passkey/login?returnUrl=/`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('#username', app.username);
  await page.fill('#password', app.password);
  await page.click('#kc-login');
  await settle(page);
}

/**
 * A fresh authorize, run to COMPLETION. Never goto() mid-redirect-chain: stopping early is
 * exactly how the aml-v2 E2E lied and passed for two months.
 * Returns whether the IdP asked for credentials.
 */
async function freshAuthorizePrompts(
  page: Page,
  ctx: BrowserContext,
  app: AppUnderTest,
): Promise<{ prompted: boolean; meStatus: number }> {
  await page.goto(`${app.baseUrl}/bff/passkey/login?returnUrl=/`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const prompted = await page
    .locator('#password, input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
  const me = await ctx.request.get(`${app.baseUrl}/bff/me`);
  return { prompted, meStatus: me.status() };
}

for (const app of APPS) {
  test.describe(`SEC-2 front-channel sign-out — ${app.name}`, () => {
    test.skip(
      app.baseUrl === '' || app.username === '',
      `${app.name} not configured for this environment`,
    );

    test(`@api ${app.name}: a live session silently re-auths (control — proves this suite bites)`, async ({
      page,
      context,
    }) => {
      await frontChannelSignIn(page, app);
      expect((await context.request.get(`${app.baseUrl}/bff/me`)).status()).toBe(HTTP_OK);

      // Deliberately do NOT sign out.
      const { prompted, meStatus } = await freshAuthorizePrompts(page, context, app);

      expect(prompted, 'a LIVE IdP session must silently re-authenticate').toBe(false);
      expect(meStatus, 'silent re-auth mints a session').toBe(HTTP_OK);
    });

    test(`@api ${app.name}: a password (ROPC) sign-out performs NO IdP navigation`, async ({
      page,
      context,
    }) => {
      await page.goto(`${app.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
      await settle(page);

      const loginStatus = await page.evaluate(
        async ([u, p]) => {
          const res = await fetch('/bff/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
            body: JSON.stringify({ username: u, password: p }),
          });
          return res.status;
        },
        [app.username, app.password],
      );
      expect(loginStatus, 'ROPC password login still works').toBe(HTTP_OK);

      let navigatedToIdp = false;
      page.on('request', (r) => {
        if (r.isNavigationRequest() && /openid-connect\/logout/.test(r.url())) navigatedToIdp = true;
      });

      const body = await page.evaluate(async () => {
        const res = await fetch('/bff/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-BFF-Csrf': '1' },
        });
        return res.json() as Promise<{ idpLogoutUrl: string | null }>;
      });
      await settle(page);

      // A ROPC session never sent the browser to the IdP, so there is no IdP cookie to kill.
      // Redirecting these users would be a pointless, regression-prone change to a sign-out
      // that already worked.
      expect(body.idpLogoutUrl, 'password sessions must not get an IdP logout URL').toBeNull();
      expect(navigatedToIdp, 'password sign-out must not navigate to the IdP').toBe(false);
      expect((await context.request.get(`${app.baseUrl}/bff/me`)).status()).toBe(HTTP_UNAUTHORIZED);
    });

    test(`@ui ${app.name}: sign-out ends the IdP session AND returns to the app's /login`, async ({
      page,
      context,
    }) => {
      await frontChannelSignIn(page, app);
      expect(
        (await context.request.get(`${app.baseUrl}/bff/me`)).status(),
        'front-channel session established',
      ).toBe(HTTP_OK);

      // The 302 back to the app never COMMITS as a navigation, so the final URL alone cannot
      // tell "went through the IdP" from "SPA routed locally". The REQUEST is the proof.
      let endSessionUrl = '';
      page.on('request', (r) => {
        if (r.isNavigationRequest() && /openid-connect\/logout/.test(r.url())) endSessionUrl = r.url();
      });

      if (app.gatedPath !== undefined) {
        await page.goto(`${app.baseUrl}${app.gatedPath}`, { waitUntil: 'domcontentloaded' });
        await settle(page);
      }

      const signOut = page.locator(`[data-testid="${app.signOutTestId}"]`).nth(app.signOutNth ?? 0);
      await signOut.waitFor({ state: 'visible', timeout: 20000 });
      await signOut.scrollIntoViewIfNeeded().catch(() => undefined);
      // Some app chrome animates perpetually, so Playwright never sees the control go
      // "stable". dispatchEvent fires a REAL click on the REAL control, running the app's
      // real handler -- which is the thing under test.
      await signOut.click({ timeout: 8000 }).catch(async () => {
        await signOut.dispatchEvent('click');
      });
      await settle(page);

      // (a) the browser really hit the IdP's end-session endpoint...
      expect(endSessionUrl, 'sign-out must NAVIGATE to the IdP end-session endpoint').toContain(
        `/realms/${app.realm}/protocol/openid-connect/logout`,
      );
      // ...carrying id_token_hint. WITHOUT it Keycloak shows a confirmation page and LEAVES
      // THE SESSION ALIVE -- the fix would silently do nothing.
      expect(endSessionUrl, 'end-session must carry id_token_hint').toContain('id_token_hint=');

      // (b) and the user is returned to the APP, not stranded on the IdP's logged-out page.
      expect(page.url(), "sign-out must land on the app's own /login").toContain(app.baseUrl);
      expect(page.url()).toContain('/login');

      // (c) THE CONTRACT: a fresh authorize must now ASK FOR CREDENTIALS.
      const { prompted, meStatus } = await freshAuthorizePrompts(page, context, app);
      expect(prompted, 'after sign-out a fresh authorize MUST prompt for credentials').toBe(true);
      expect(meStatus, 'and must NOT silently mint a session').toBe(HTTP_UNAUTHORIZED);
    });
  });
}
