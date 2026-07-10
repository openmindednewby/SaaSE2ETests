// @api tier for F1 self-serve onboarding (M1-10): register a FRESH ichnos user via the BFF, log in by
// email, and screen through the BFF proxy — proving the register → login → first-screen chain end-to-end
// with trial credits auto-provisioned. Cookie-session flow: Playwright's `request` context keeps the BFF
// session cookie across the three calls. Skips gracefully when ICHNOS_WEB_URL is unset or the BFF is
// unreachable (the dev PC can't reach the WireGuard-only staging host — this runs in-cluster nightly).
//
// The @ui companion (register form → onboarding wizard/dashboard in a real browser) is
// ichnos-portal.ui.spec.ts, in the `ichnos-ui` browser project.
import { expect, test } from '@playwright/test';
import {
  CLEAR_BTC_ADDRESS,
  ICHNOS_WEB_URL,
  bffLogin,
  bffTryPost,
  registerIchnosUser,
} from './ichnos-helpers.js';

// The BFF proxies `/bff/api/v1/*` to ichnos-api (the shipped screeningClient path). The `ichnos` segment
// downstream is the SPA's own product, so an unprefixed `/v1/...` resolves to ichnos-api after `/bff/api`.
const BFF_SCREEN_PATH = '/bff/api/v1/screenings/address';

const HTTP_OK = 200;
const HTTP_CONFLICT = 409;

test.describe('Ichnos onboarding @ichnos-api', () => {
  test('registers a fresh user, logs in by email, and screens through the BFF', async ({ request }) => {
    if (!ICHNOS_WEB_URL) {
      test.skip(true, 'ICHNOS_WEB_URL not set — BFF onboarding runs in-cluster (staging is WireGuard-only)');
      return;
    }

    // 1) Register a fresh user (username derived from email; a unique email → a fresh tenant).
    const registered = await registerIchnosUser(request, ICHNOS_WEB_URL);
    if (!registered) {
      test.skip(true, `BFF not reachable at ${ICHNOS_WEB_URL}`);
      return;
    }
    const registerStatus = registered.response.status();
    // 2xx on a fresh create; 409 if the (astronomically unlikely) email collided on a rerun.
    expect(
      registerStatus === HTTP_CONFLICT || (registerStatus >= HTTP_OK && registerStatus < 300),
      `register -> ${registerStatus}: ${await registered.response.text()}`,
    ).toBeTruthy();

    // 2) Log in by email (the BFF field is `username`, set to the email — KC resolves email → user).
    const login = await bffLogin(request, ICHNOS_WEB_URL, registered.email, registered.password);
    expect(login, 'login request reached the BFF').not.toBeNull();
    expect(login!.status(), `login -> ${login!.status()}: ${await login!.text()}`).toBe(HTTP_OK);

    // 3) Screen a clear address through the BFF proxy — the session cookie rides the same request context,
    // and trial credits are auto-provisioned on first screen → 200 with a clear verdict.
    const screen = await bffTryPost(request, ICHNOS_WEB_URL, BFF_SCREEN_PATH, {
      ...CLEAR_BTC_ADDRESS,
      context: 'e2e-onboarding',
    });
    expect(screen, 'screen request reached the BFF').not.toBeNull();
    expect(screen!.status(), `screen -> ${screen!.status()}: ${await screen!.text()}`).toBe(HTTP_OK);

    const body = (await screen!.json()) as { riskTier: string; directMatch: boolean; screeningId: string };
    expect(body.riskTier).toBe('clear');
    expect(body.directMatch).toBe(false);
    expect(body.screeningId).toBeTruthy();
  });

  test('rejects an unauthenticated BFF-proxied screen', async ({ request }) => {
    if (!ICHNOS_WEB_URL) {
      test.skip(true, 'ICHNOS_WEB_URL not set');
      return;
    }
    // No session cookie (fresh, un-logged-in context) → the BFF has no token to attach → 401.
    const screen = await bffTryPost(request, ICHNOS_WEB_URL, BFF_SCREEN_PATH, CLEAR_BTC_ADDRESS);
    if (!screen) {
      test.skip(true, `BFF not reachable at ${ICHNOS_WEB_URL}`);
      return;
    }
    expect([401, 403]).toContain(screen.status());
  });
});
