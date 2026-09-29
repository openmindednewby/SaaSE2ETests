// AGORA-LAUNCH-1 "Self-serve Agora signup" — @api tier, API-driven (owner decision, e2e-playwright.md).
//
// Drives the deployed bff-agora the way agora-web's register screen does: `POST /bff/register`
// (realm agora -> tenant-api `/auth/register` -> auto-login), then the calls the app makes next:
// `GET /bff/me` (session) and `GET /bff/api/agora/api/v1/shop` (onboarding state: 404 = wizard).
//
// Rate limit: tenant-api register is 5/min/IP. This file spends TWO register calls (AC1 signs up,
// AC2 re-posts the same email) — serial, one worker — so it leaves headroom for a concurrent run.
import { expect, request as playwrightRequest, test } from '@playwright/test';

import { AGORA_WEB_URL } from './agora-helpers.js';
import {
  BFF_ME,
  BFF_SHOP,
  cleanupAgoraSignup,
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
  tenantId?: string;
  user?: BffUserBody;
}

/** The BFF may return the user bare or wrapped in `{ user }` (auth-client `extractUser`). */
function userOf(body: BffUserBody): BffUserBody {
  return body.user ?? body;
}

test.describe('AGORA-LAUNCH-1 self-serve signup @agora-api @agora-signup', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL not set — bff-agora is not reachable for this target');

  const signup = uniqueAgoraSignup();
  const ids: { tenantId?: string; userId?: string } = {};
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    // Own context: it holds the BFF session cookie between calls, like the browser does.
    ctx = await playwrightRequest.newContext({ baseURL: AGORA_WEB_URL ?? '', ignoreHTTPSErrors: true });
  });

  test.afterAll(async () => {
    await cleanupAgoraSignup(signup, ids);
    await ctx?.dispose();
  });

  test('AL1-AC1 register creates the merchant, signs them in, and leaves onboarding pending', async () => {
    const reg = await postBffRegister(ctx, signup);
    const regText = await reg.text();
    expect(reg.status(), `POST /bff/register -> ${reg.status()}: ${regText.slice(0, 300)}`).toBe(HTTP_CREATED);

    const registered = userOf(JSON.parse(regText) as BffUserBody);
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
});
