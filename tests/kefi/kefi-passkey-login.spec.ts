/**
 * Kefi passkey (WebAuthn) E2E (unified-login Increment 2, Batch 4).
 *
 * Proves the passkey registration + login journey end-to-end through the real
 * kefi-web SPA + bff-kefi BFF (auth-code flow) + Keycloak's native WebAuthn
 * ceremony, using Playwright's CDP virtual authenticator:
 *   1. Self-serve signup + IMAP verify magic-link auto-logs-in the tenant owner —
 *      a real, Active, authenticated session (reuses the tenant-lifecycle setup).
 *   2. A CDP virtual authenticator (CTAP2 / internal / resident-key / UV) is
 *      attached to the page — it stands in for TouchID / Windows Hello.
 *   3. REGISTER: "Add a passkey" on the organizer dashboard → /bff/passkey/register
 *      → Keycloak re-auth (password — the BFF session is not a KC browser session)
 *      → the webauthn-register-passwordless ceremony (virtual authenticator
 *      auto-creates the credential) → back at /organizer?passkey=registered.
 *   4. SIGN OUT (clear cookies — the virtual authenticator keeps its credential).
 *   5. LOGIN: "Sign in with a passkey" on /login → /bff/passkey/login → Keycloak's
 *      usernameless WebAuthn ceremony (the discoverable credential identifies the
 *      user) → back at the app with a fresh BFF session cookie.
 *   6. NEGATIVE: a forged callback (garbage state, no binding cookie) cannot mint
 *      a session — the browser is bounced to /login?passkeyError=failed.
 *   7. Phase-A canary-cleanup removes the tenant + KC user + per-tenant resources.
 *
 * Tokens never reach the browser; Keycloak stays the sole issuer. The browser
 * sees Keycloak's hosted pages during the ceremony (BFF→KC→BFF redirect) — that
 * is the auth-code flow shape, not a facade violation.
 *
 * KC hosted-page driving: the spec doesn't hard-code one exact page sequence —
 * Keycloak's flow ("Browser - Passkey or Password": Cookie / WebAuthn-Passwordless
 * / Password-Form alternatives) decides what appears. driveKeycloakPages() reacts
 * to whichever known element is on screen (try-another-way link, auth-method
 * selector, username/password form, webauthn trigger button, label form) until
 * the browser leaves Keycloak. Runs on staging + prod via E2E_TARGET.
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiPasskeyPage } from '../../pages/kefi/KefiPasskeyPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';
import {
  attachVirtualAuthenticator,
  driveKeycloakPages,
  isOnKeycloak,
} from '../../helpers/webauthn-helpers.js';

// Serial — shares one bot mailbox + one Maddy SMTP queue with the other kefi canaries.
test.describe.configure({ mode: 'serial' });

const SESSION_COOKIE = '__Host-bff-kefi';
const NAV_TIMEOUT_MS = 30_000;

test.describe('Kefi passkey — register, sign out, sign in with passkey', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi passkey E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('a tenant owner registers a passkey and signs back in with it', async ({ page }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    const { webUrl } = getKefiUrls();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      // ── 1. Signup + IMAP verify → magic-link auto-login (authenticated) ──
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();

      // Wait for /organizer — the session cookie isn't minted until
      // /bff/verify-and-login completes (lesson from the device-PIN spec).
      await page.goto(verifyUrl!);
      await page.waitForURL((url) => url.pathname.includes('/organizer'), {
        timeout: NAV_TIMEOUT_MS,
      });

      // ── 2. Virtual platform authenticator (TouchID / Hello stand-in) ─────
      await attachVirtualAuthenticator(page);

      // ── 3. REGISTER a passkey ─────────────────────────────────────────────
      // A fresh canary tenant sees the onboarding WIZARD at /organizer, not the
      // dashboard, so the settings card (which lives on the dashboard) is not
      // reachable here. Navigate to the BFF register endpoint directly — that is
      // exactly what the card's "Add a passkey" button does (a window.location
      // navigation); the card's rendering/gating is covered by kefi-web's jest
      // suite + the login-surface button assert below.
      const passkeyPage = new KefiPasskeyPage(page);
      await page.goto(`${webUrl}/bff/passkey/register?returnUrl=/organizer`);

      // The browser is now bounced to Keycloak. Drive whatever KC shows
      // (re-auth + ceremony + label) until we are back at the app.
      await page.waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });
      await driveKeycloakPages(page, { email: ctx.email, password: ctx.password });

      // Back at the app on /organizer. NOTE: the BFF appends ?passkey=registered
      // to the redirect, but expo-router strips query params during client-side
      // route normalisation, so the spec must not assert on it — the passkey
      // LOGIN below is the real proof the credential was registered.
      await page.waitForURL(
        (url) => !isOnKeycloak(page) && url.pathname.includes('/organizer'),
        { timeout: NAV_TIMEOUT_MS },
      );

      // ── 4. SIGN OUT: clear every cookie. The virtual authenticator (and its
      // discoverable credential) lives on the browser target, not in cookies —
      // exactly like a real device's platform authenticator. ─────────────────
      await page.context().clearCookies();

      // ── 5. SIGN IN with the passkey from the login surface ───────────────
      await passkeyPage.gotoLoginAndExpectPasskeyButton();
      await passkeyPage.clickSignInWithPasskey();

      // /bff/passkey/login → KC's usernameless WebAuthn ceremony. The virtual
      // authenticator's resident credential identifies + verifies the user with
      // no typing at all; drive any incidental KC page just in case.
      await page.waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });
      await driveKeycloakPages(page, { email: ctx.email, password: ctx.password });

      // Back at the app, signed in: the BFF set a fresh session cookie.
      await page.waitForURL((url) => !isOnKeycloak(page) && !url.pathname.includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      expect(sessionCookie, 'passkey login minted a BFF session cookie').toBeDefined();

      // The session is real: /bff/me answers 200 with the canary's identity.
      const meResponse = await page.request.get(`${webUrl}/bff/me`);
      expect(meResponse.status(), 'passkey-minted session resolves /bff/me').toBe(200);
      const me = (await meResponse.json()) as { user?: { email?: string } };
      expect(me.user?.email, 'the passkey session belongs to the canary').toBe(ctx.email);

      // ── 6. NEGATIVE: a forged callback cannot mint a session ─────────────
      // Fresh logged-out state, no binding cookie → the BFF bounces to
      // /login?passkeyError=failed and sets no session.
      await page.context().clearCookies();
      await page.goto(`${webUrl}/bff/passkey/callback?state=forged-state&code=forged-code`);
      await page.waitForURL((url) => url.searchParams.get('passkeyError') !== null, {
        timeout: NAV_TIMEOUT_MS,
      });
      await passkeyPage.expectLoginError();
      const forgedCookies = await page.context().cookies();
      expect(
        forgedCookies.find((cookie) => cookie.name === SESSION_COOKIE),
        'a forged callback must not mint a session',
      ).toBeUndefined();

      // ── 7. Mailbox hygiene ────────────────────────────────────────────────
      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
