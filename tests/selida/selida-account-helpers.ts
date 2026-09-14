// Selida signed-in (@api, through the BFF) helpers for claim.spec and billing.spec.
//
// Every request copies what selida-web sends, not a shape assembled here:
//   - auth: `@dloizides/auth-client` BffAuthClient — POST /bff/register, `X-BFF-Csrf: 1` (BffAuthClient.ts:792)
//   - API:  selida-web src/api/selidaHttp.ts — same-origin `/bff/api/selida` + `/api/v1` + path,
//           writes always carry a JSON body `{}` (selidaHttp.ts:55), deletes carry none.
//   - claim: selida-web src/features/pages/pagesApi.ts:28 — `X-Claim-Token` header, body `{}`.
// A browser adds `Origin` to every same-origin write; bff-selida's CSRF check rejects a write
// without it, so the helper sends it too (it is the browser's header, not an invented one).
//
// 🔴 TEARDOWN. Register creates a Keycloak user in the PROD `selida` realm and a row in prod
// `IdentityServiceDb.Tenants`. Both are deleted through identity-api with the canary superUser
// token (the same path helpers/signup-teardown.ts uses for katalogos signups), and then READ BACK.
// Without that token the specs skip BEFORE registering, so a local run never leaks an account.
import { randomBytes } from 'node:crypto';

import { expect, request as playwrightRequest } from '@playwright/test';

import { getCanarySuperUserToken, isCanaryMode } from '../../helpers/canary-prefix.js';
import { deleteSelfServeSignup } from '../../helpers/signup-teardown.js';

import { HTTP, describeResponse } from './selida-helpers.js';

import type { APIRequestContext, APIResponse } from '@playwright/test';

/** The signed-in app origin: selida-web + bff-selida share it. Default: production. */
export const SELIDA_APP_BASE = (
  process.env.SELIDA_APP_BASE?.trim() || 'https://selida-app.dloizides.com'
).replace(/\/+$/, '');

const SELIDA_REALM = 'selida';
const PASSWORD_ENTROPY_BYTES = 12;

export const HTTP_ACCOUNT = {
  PAYMENT_REQUIRED: 402,
  CONFLICT: 409,
} as const;

export const BFF = {
  register: `${SELIDA_APP_BASE}/bff/register`,
  me: `${SELIDA_APP_BASE}/bff/me`,
  /** Anything under the BFF's selida proxy segment, allowlisted or not. */
  proxied: (path: string): string => `${SELIDA_APP_BASE}/bff/api/selida${path}`,
  v1: (path: string): string => `${SELIDA_APP_BASE}/bff/api/selida/api/v1${path}`,
} as const;

export const ACCOUNT_SKIP_REASON =
  'signed-in Selida specs run only with E2E_TARGET=prod: without the canary superUser token and ' +
  'IDENTITY_API_URL they could not delete the KC users and tenant rows they create';

export function accountTeardownAvailable(): boolean {
  return isCanaryMode() && Boolean(getCanarySuperUserToken()) && Boolean(process.env.IDENTITY_API_URL);
}

/** The headers a browser running selida-web puts on a same-origin write. */
export function writeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Origin: SELIDA_APP_BASE, 'X-BFF-Csrf': '1', Accept: 'application/json', ...extra };
}

/** Same shape as a real token, one character different — so only the VALUE can reject it. */
export function tamperToken(token: string): string {
  const last = token.slice(-1);
  return `${token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
}

export interface SelidaAccount {
  api: APIRequestContext;
  username: string;
  email: string;
  tenantName: string;
  sub?: string;
  tenantId?: string;
}

/** POST a JSON body through the BFF, exactly as selidaHttp.postJson does. */
export async function bffPostJson(
  account: SelidaAccount,
  path: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return account.api.post(BFF.v1(path), { headers: writeHeaders(headers), data: {} });
}

/** The auth-web RegisterForm payload: no `@` in the username, a non-empty verify-URL template. */
function registerBody(account: SelidaAccount): Record<string, string> {
  return {
    firstName: 'Selida',
    lastName: 'E2E',
    username: account.username,
    email: account.email,
    // Generated per account: nothing signs in with it after teardown, and no credential is committed.
    password: `Se!${randomBytes(PASSWORD_ENTROPY_BYTES).toString('hex')}9Z`,
    tenantName: account.tenantName,
    verifyUrlTemplate: `${SELIDA_APP_BASE}/verify-email?token={token}`,
  };
}

/** Admin reads against identity-api, scoped to the selida realm. */
async function identityAdmin(token: string): Promise<APIRequestContext> {
  const base = (process.env.IDENTITY_API_URL ?? '').replace(/\/+$/, '');
  return playwrightRequest.newContext({
    baseURL: `${base}/api/v1/`,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Realm': SELIDA_REALM },
  });
}

interface AdminSnapshot {
  userListed: boolean;
  tenantListed: boolean;
}

async function snapshot(admin: APIRequestContext, account: SelidaAccount): Promise<AdminSnapshot> {
  const users = (await (await admin.get('users')).json()) as { users?: { id?: string; username?: string }[] };
  const tenants = (await (await admin.get('tenants')).json()) as { tenants?: { tenantId?: string }[] };
  return {
    userListed: (users.users ?? []).some((u) => u.id === account.sub || u.username === account.username),
    tenantListed: (tenants.tenants ?? []).some((t) => t.tenantId === account.tenantId),
  };
}

/**
 * Accounts this run registered. Drained in afterAll: identity-api deletes the KC user then the
 * tenant row, and the read-back requires BOTH to be listed before and absent after — a list that
 * never showed the row cannot prove it is gone, so that is reported rather than passed.
 */
export class AccountLedger {
  private readonly accounts: SelidaAccount[] = [];

  async register(label: string): Promise<SelidaAccount> {
    const username = `selidae2e${label}${Date.now().toString(36)}`;
    const account: SelidaAccount = {
      api: await playwrightRequest.newContext({ ignoreHTTPSErrors: true }),
      username,
      email: `${username}@example.com`,
      tenantName: `Selida E2E ${username}`,
    };
    // Tracked BEFORE the call: a failure after Keycloak created the user must still be swept.
    this.accounts.push(account);
    const response = await account.api.post(BFF.register, { headers: writeHeaders(), data: registerBody(account) });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.OK);
    const { user } = (await response.json()) as { user: { sub: string; tenantId: string } };
    account.sub = user.sub;
    account.tenantId = user.tenantId;
    return account;
  }

  emails(): string[] {
    return this.accounts.map((a) => a.email);
  }

  /** Deletes every account; returns what could NOT be proven gone. Never throws. */
  async drain(): Promise<string[]> {
    const token = getCanarySuperUserToken() ?? '';
    const admin = await identityAdmin(token);
    const leftovers: string[] = [];
    for (const account of this.accounts) {
      try {
        leftovers.push(...(await this.removeOne(admin, token, account)));
      } catch (e) {
        leftovers.push(`${account.username}: teardown threw ${e instanceof Error ? e.message : String(e)}`);
      }
      await account.api.dispose();
    }
    await admin.dispose();
    this.accounts.length = 0;
    return leftovers;
  }

  private async removeOne(admin: APIRequestContext, token: string, account: SelidaAccount): Promise<string[]> {
    const before = await snapshot(admin, account);
    const result = await deleteSelfServeSignup(
      { username: account.username, tenantName: account.tenantName, userId: account.sub, tenantId: account.tenantId },
      { token, realm: SELIDA_REALM },
    );
    const after = await snapshot(admin, account);
    const problems: string[] = [];
    if (!before.userListed) problems.push(`${account.username}: KC user never listed — deletion unobservable`);
    if (!before.tenantListed) problems.push(`${account.username}: tenant ${account.tenantId} never listed — deletion unobservable`);
    if (after.userListed) problems.push(`${account.username}: KC user still present (${result.notes.join('; ')})`);
    if (after.tenantListed) problems.push(`${account.username}: tenant ${account.tenantId} still present (${result.notes.join('; ')})`);
    return problems;
  }
}
