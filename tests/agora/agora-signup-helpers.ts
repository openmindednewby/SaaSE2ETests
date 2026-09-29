// Helpers for AGORA-LAUNCH-1 "Self-serve Agora signup" (agora-signup{,.ui}.spec.ts).
//
// The request body mirrors what the agora-web register screen actually sends:
//   agora-web/app/(auth)/register.tsx renders `<RegisterForm compact>` (@dloizides/auth-web),
//   whose `expandCompactRegisterValues` turns the one "full name" field into firstName/lastName,
//   derives `username` from the email (lower-cased, `[^a-z0-9._-]` -> `_`) and keeps the empty
//   `website` honeypot; `bffAuthClient.register` (@dloizides/auth-client BffAuthClient.postRaw)
//   then POSTs it as JSON to same-origin `/bff/register` with `X-BFF-Csrf: 1` and cookies.
//   agora-web/src/auth/registerRequest.ts (`registerShop`, 2937f7c) adds `verifyUrlTemplate`:
//   the window origin + `/login` + a token query param holding the `{token}` placeholder;
//   bff-agora 400s a register without it.
//
// 🔴 This helper HAND-ASSEMBLES that request. It tests the BFF + tenant-api contract; it can never
// observe a defect in the app's own client shape (a renamed field, a dropped header). That seam is
// pinned by the app's unit tests, and the UI path by the @ui console-error smoke.
import { AGORA_WEB_URL } from './agora-helpers.js';
import { getCanaryRunIdShort } from '../../helpers/canary-prefix.js';
import { STRONG_PASSWORD } from '../../helpers/katalogos-signup-helpers.js';
import { deleteSelfServeSignup } from '../../helpers/signup-teardown.js';

import { test } from '@playwright/test';

import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Same-origin BFF paths the agora-web SPA calls. */
export const BFF_REGISTER = '/bff/register';
export const BFF_ME = '/bff/me';
/** @dloizides/auth-client BffAuthClient ENDPOINTS.login — the BFF runs ROPC against Keycloak. */
export const BFF_LOGIN = '/bff/login';
/** The app's onboarding probe: `getShop()` -> 404 means "no shop yet, run the wizard". */
export const BFF_SHOP = '/bff/api/agora/api/v1/shop';

/** Same throwaway test password as the Katalogos signup journey (already gitleaks-reviewed). */
export const AGORA_SIGNUP_PASSWORD = STRONG_PASSWORD;

const UNSAFE_USERNAME_CHARS = /[^a-z0-9._-]/g;
const RADIX_36 = 36;
/**
 * Register = tenant row + Keycloak user + auto-login grant, three hops on the staging HDD node;
 * the 10 s default action timeout is shorter than that chain, not a hang detector for it.
 */
const REGISTER_TIMEOUT_MS = 30_000;

/** The body the compact form submits, after its client-side expansion. */
export interface AgoraRegisterBody {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  tenantName: string;
  website: string;
  /** agora-web `buildVerifyUrlTemplate()`: the link the verification email carries. */
  verifyUrlTemplate: string;
}

/** agora-web registerRequest.ts TOKEN_PLACEHOLDER — the backend substitutes the real token. */
const TOKEN_PLACEHOLDER = '{token}';

/** Mirrors agora-web `buildVerifyUrlTemplate(origin)` exactly (placeholder kept literal). */
export function agoraVerifyUrlTemplate(origin: string): string {
  return `${origin}/login?token=${TOKEN_PLACEHOLDER}`;
}

let signupSeq = 0;

/**
 * A unique, VALID self-serve signup. Not the canary `e2ec-<run>-` prefix: TenantService rejects it
 * on the public register path by design (see katalogos-signup-helpers). `al1` + run id + a time
 * component keeps names unique across local re-runs (where there is no canary run id).
 */
export function uniqueAgoraSignup(): AgoraRegisterBody {
  signupSeq += 1;
  const run = getCanaryRunIdShort() ?? 'local';
  const slug = `al1${run}${Date.now().toString(RADIX_36)}${signupSeq}`;
  const email = `${slug}@example.com`;
  return {
    firstName: 'Agora',
    lastName: 'Signup',
    username: email.trim().toLowerCase().replace(UNSAFE_USERNAME_CHARS, '_'),
    email,
    password: AGORA_SIGNUP_PASSWORD,
    tenantName: `${slug} Shop`,
    website: '',
    verifyUrlTemplate: agoraVerifyUrlTemplate(AGORA_WEB_URL ?? ''),
  };
}

/**
 * POST /bff/register exactly as BffAuthClient.postRaw does (JSON + `X-BFF-Csrf: 1`), plus the
 * `Origin` header the browser attaches to every same-origin POST — the BFF anti-forgery check keys
 * on it, and without it the BFF answers 403 "Anti-forgery validation failed." (measured).
 */
export function postBffRegister(ctx: APIRequestContext, body: AgoraRegisterBody): Promise<APIResponse> {
  return ctx.post(BFF_REGISTER, {
    headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1', Origin: AGORA_WEB_URL ?? '' },
    data: body,
    timeout: REGISTER_TIMEOUT_MS,
  });
}

/** POST /bff/login `{ username, password }` (BffLoginRequest) with the same CSRF + Origin headers. */
export function postBffLogin(ctx: APIRequestContext, username: string, password: string): Promise<APIResponse> {
  return ctx.post(BFF_LOGIN, {
    headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1', Origin: AGORA_WEB_URL ?? '' },
    data: { username, password },
    timeout: REGISTER_TIMEOUT_MS,
  });
}

/** Read `errorCode` / `ErrorCode` from a JSON error body (auth-client `readBffErrorCode` semantics). */
export async function readErrorCode(res: APIResponse): Promise<string | null> {
  try {
    const body = (await res.json()) as { errorCode?: unknown; ErrorCode?: unknown };
    const code = body.errorCode ?? body.ErrorCode;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** Surface a teardown line in the report (annotation) — the lint bans console in tests. */
function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/**
 * Delete the Keycloak user + tenant row this signup created (agora realm). NEVER throws, but a
 * cleanup that could not run SAYS SO — a silent no-op here leaves orphan tenants on staging.
 */
export async function cleanupAgoraSignup(
  body: AgoraRegisterBody,
  ids: { tenantId?: string; userId?: string },
): Promise<void> {
  try {
    const res = await deleteSelfServeSignup(
      { tenantName: body.tenantName, username: body.username, ...ids },
      { realm: 'agora' },
    );
    const line = `[agora-signup teardown] attempted=${String(res.attempted)} tenant=${String(res.deletedTenant)} users=${res.deletedUserIds.length} ${res.notes.join('; ')}`;
    const nothingCreated = !ids.tenantId && !ids.userId;
    if (res.attempted && (res.deletedTenant || nothingCreated)) note('teardown', line);
    else note('teardown-orphan', `${line} -- ORPHAN LEFT: ${body.tenantName}`);
  } catch (e) {
    note('teardown-orphan', `[agora-signup teardown] threw -- ORPHAN LEFT: ${body.tenantName}: ${String(e)}`);
  }
}
