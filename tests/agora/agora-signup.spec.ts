// AGORA-LAUNCH-1 "Self-serve Agora signup" — @api tier, API-driven (owner decision, e2e-playwright.md).
//
// Drives the deployed bff-agora the way agora-web's register screen does: `POST /bff/register`
// (realm agora -> tenant-api `/auth/register` -> auto-login), then the calls the app makes next:
// `GET /bff/me` (session) and `GET /bff/api/agora/api/v1/shop` (onboarding state: 404 = wizard).
//
// Rate limit: tenant-api register is 5/min/IP. This file spends TWO register calls (AC1 signs up,
// AC2 re-posts the same email) in order, one worker; a red test restarts the worker and costs one more.
// AC4 re-uses AC1's account (never verified: nobody opened the email) and spends a LOGIN, not a register.
import { expect, request as playwrightRequest, test } from '@playwright/test';

import { AGORA_WEB_URL } from './agora-helpers.js';
import {
  BFF_ME,
  BFF_SHOP,
  cleanupAgoraSignup,
  postBffLogin,
  postBffRegister,
  readErrorCode,
  uniqueAgoraSignup,
} from './agora-signup-helpers.js';

import type { APIRequestContext } from '@playwright/test';

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

interface BffUserBody {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  email_verified?: boolean;
  tenantId?: string;
  user?: BffUserBody;
}

/** The BFF may return the user bare or wrapped in `{ user }` (auth-client `extractUser`). */
function userOf(body: BffUserBody): BffUserBody {
  return body.user ?? body;
}

test.describe('AGORA-LAUNCH-1 self-serve signup @agora-api @agora-signup', () => {
  // NOT serial: AC2/AC4 only need the account to EXIST, not AC1's session to be right, so a red
  // AC1 must not hide their verdicts. `default` keeps one worker, in order; a failure restarts the
  // worker, whose beforeAll registers a fresh account (and whose afterAll deletes it).
  test.describe.configure({ mode: 'default' });
  test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL not set — bff-agora is not reachable for this target');

  const signup = uniqueAgoraSignup();
  const ids: { tenantId?: string; userId?: string } = {};
  let ctx: APIRequestContext;
  let regStatus = 0;
  let regText = '';

  test.beforeAll(async () => {
    // Own context: it holds the BFF session cookie between calls, like the browser does.
    ctx = await playwrightRequest.newContext({ baseURL: AGORA_WEB_URL ?? '', ignoreHTTPSErrors: true });
    const reg = await postBffRegister(ctx, signup);
    regStatus = reg.status();
    regText = await reg.text();
  });

  test.afterAll(async () => {
    await cleanupAgoraSignup(signup, ids);
    await ctx?.dispose();
  });

  test('AL1-AC1 register creates the merchant, signs them in, and leaves onboarding pending', async () => {
    expect(regStatus, `POST /bff/register -> ${regStatus}: ${regText.slice(0, 300)}`).toBe(HTTP_CREATED);

    // BffAuthClient.register (auth-client extractUser) accepts ONLY `{ user }`; anything else makes
    // the app throw "register: BFF response missing user" although the account now exists.
    const body = JSON.parse(regText) as BffUserBody & Record<string, unknown>;
    expect(
      body.user,
      `register must answer the { user } envelope the app client reads; got keys [${Object.keys(body).join(', ')}]`,
    ).toBeDefined();
    const registered = userOf(body);
    ids.userId = registered.sub;
    ids.tenantId = registered.tenantId;
    expect(registered.email, 'register response must carry the new user').toBe(signup.email);

    const cookies = (await ctx.storageState()).cookies;
    expect(cookies.length, 'register must set the BFF session cookie (auto-login)').toBeGreaterThan(0);

    const me = await ctx.get(BFF_ME);
    const meText = await me.text();
    expect(me.status(), `GET /bff/me after register -> ${me.status()}: ${meText.slice(0, 300)}`).toBe(HTTP_OK);
    const meUser = userOf(JSON.parse(meText) as BffUserBody);
    expect(meUser.email, '/bff/me must be the merchant who just registered').toBe(signup.email);
    ids.userId ??= meUser.sub;
    ids.tenantId ??= meUser.tenantId;

    const shop = await ctx.get(BFF_SHOP);
    expect(
      shop.status(),
      `a brand-new merchant has no shop, so GET /shop must 404 (onboarding pending); got ${shop.status()}: ${(await shop.text()).slice(0, 200)}`,
    ).toBe(HTTP_NOT_FOUND);
  });

  test('AL1-AC2 re-registering the same email is a 409 with typed errorCode', async () => {
    expect(regStatus, `precondition: the first register must have created the account; got ${regStatus}: ${regText.slice(0, 120)}`).toBe(HTTP_CREATED);
    const dupeCtx = await playwrightRequest.newContext({ baseURL: AGORA_WEB_URL ?? '', ignoreHTTPSErrors: true });
    try {
      const dupe = await postBffRegister(dupeCtx, { ...signup, tenantName: `${signup.tenantName} Two` });
      const code = await readErrorCode(dupe);
      expect(dupe.status(), `duplicate email must 409; errorCode=${String(code)}`).toBe(HTTP_CONFLICT);
      expect(code, 'the 409 must carry a typed errorCode the form maps to copy').toBe('USER_EXISTS');
      const cookies = (await dupeCtx.storageState()).cookies;
      expect(cookies, 'a rejected register must not establish a session').toHaveLength(0);
    } finally {
      await dupeCtx.dispose();
    }
  });

  test('AL1-AC4 a fresh merchant with an UNVERIFIED email can still sign in (no verify-email lock-out)', async () => {
    // agora-web has no verify-email route (registerRequest.ts), so a Keycloak "Verify Email"
    // required action would make ROPC answer 400 "Account is not fully set up" and lock every
    // new merchant out after their first session ends. A fresh context = a returning merchant.
    expect(regStatus, `precondition: the register must have created the account; got ${regStatus}: ${regText.slice(0, 120)}`).toBe(HTTP_CREATED);
    const loginCtx = await playwrightRequest.newContext({ baseURL: AGORA_WEB_URL ?? '', ignoreHTTPSErrors: true });
    try {
      const login = await postBffLogin(loginCtx, signup.email, signup.password);
      const loginText = await login.text();
      expect(
        login.status(),
        `POST /bff/login (email, never verified) -> ${login.status()}: ${loginText.slice(0, 200)}`,
      ).toBe(HTTP_OK);

      const me = await loginCtx.get(BFF_ME);
      const meText = await me.text();
      expect(me.status(), `GET /bff/me after login -> ${me.status()}: ${meText.slice(0, 300)}`).toBe(HTTP_OK);
      const meUser = userOf(JSON.parse(meText) as BffUserBody);
      expect(meUser.email, '/bff/me must be the unverified merchant').toBe(signup.email);
      ids.userId ??= meUser.sub;
      ids.tenantId ??= meUser.tenantId;
      const verified = meUser.emailVerified ?? meUser.email_verified;
      test.info().annotations.push({ type: 'email-verified-claim', description: String(verified) });
      expect(verified, 'precondition: the account must NOT be verified, else this proves nothing').not.toBe(true);
    } finally {
      await loginCtx.dispose();
    }
  });
});
