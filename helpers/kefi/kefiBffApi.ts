/**
 * Shared kefi BFF API helpers for E2E specs that drive bff-kefi endpoints
 * directly through Playwright's APIRequestContext (device-PIN, forgot/reset
 * password, login).
 *
 * Extracted from kefi-device-pin-unlock.spec.ts on its second use
 * (kefi-reset-revokes-devices.spec.ts) — the extract-on-second-use rule.
 *
 * NOTE: a sibling implementation exists inside helpers/login-methods-suite.ts
 * (katalogos/erevna), parameterised by product config rather than kefi URLs.
 * Unifying the two is deliberate future cleanup, not done here.
 */

import { expect, type APIRequestContext, type Cookie } from '@playwright/test';

import { getKefiUrls } from './kefiUrls.js';

export const CSRF_HEADER = 'X-BFF-Csrf';
export const CSRF_VALUE = '1';
export const SESSION_COOKIE = '__Host-bff-kefi';
export const DEVICE_COOKIE = '__Host-bffdev-kefi';

export const HTTP_OK = 200;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * The BFF's per-IP "BffAuth" rate limiter (5 req / 60s sliding window, 10s
 * segments) sits IN FRONT of the auth endpoints. Its 429s have an EMPTY
 * body; the device-lockout 429 has a JSON `{error}` body + Retry-After.
 * Callers poll with a backoff between rate-limited attempts so they can
 * reach the auth logic underneath.
 */
export const RATE_LIMIT_BACKOFF_MS = 15_000;
export const RATE_LIMIT_MAX_WAIT_MS = 120_000;

/** POSTs a kefi BFF endpoint with the CSRF header + Origin the BFF requires. */
export function bffPost(
  request: APIRequestContext,
  path: string,
  data?: Record<string, unknown>,
): ReturnType<APIRequestContext['post']> {
  const { webUrl } = getKefiUrls();
  // Origin must be sent explicitly: the BFF's anti-forgery gate checks the
  // CSRF header AND an allow-listed Origin/Referer. Browsers add Origin
  // automatically; Playwright's APIRequestContext does not.
  return request.post(`${webUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: webUrl },
    data: data ?? {},
  });
}

/** PUTs a kefi BFF-proxied JSON endpoint (e.g. `/bff/api/tenants/*`) with CSRF + Origin. */
export function bffPut(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): ReturnType<APIRequestContext['put']> {
  const { webUrl } = getKefiUrls();
  return request.put(`${webUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: webUrl },
    data,
  });
}

/**
 * Like {@link bffPost}, but polls through the per-IP rate limiter: an
 * empty-body 429 (the "BffAuth" sliding-window limiter) is retried on a
 * backoff interval, while any other response — including the device-lockout
 * 429, which carries a JSON body — resolves the poll and is returned as-is.
 */
export async function bffPostThroughRateLimit(
  request: APIRequestContext,
  path: string,
  data?: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let lastResponse: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  await expect
    .poll(
      async () => {
        lastResponse = await bffPost(request, path, data);
        if (lastResponse.status() !== HTTP_TOO_MANY_REQUESTS) return 'reached';
        const body = await lastResponse.text();
        // Device-lockout 429s carry a JSON body — that IS the signal we want.
        return body.length > 0 ? 'reached' : 'rate-limited';
      },
      {
        message: `waiting out the per-IP BffAuth rate limiter on ${path}`,
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('reached');
  return lastResponse!;
}

/** Finds a captured cookie by name, asserting it exists. */
export function requireCookie(cookies: Cookie[], name: string): Cookie {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `cookie ${name} present`).toBeDefined();
  return cookie!;
}
