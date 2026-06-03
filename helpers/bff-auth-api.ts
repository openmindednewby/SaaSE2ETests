/**
 * BFF auth API helpers shared by the parameterised login-methods suite
 * (katalogos, erevna, …): CSRF-correct POSTs, rate-limit-aware polling
 * wrappers, and cookie/banner utilities.
 *
 * Extracted from helpers/login-methods-suite.ts to keep that file within the
 * max-file-lines budget. Product-agnostic: every function takes the app's
 * base URL (the calling project's baseURL) rather than reading env itself.
 *
 * NOTE: helpers/kefi/kefiBffApi.ts is the kefi-flavoured sibling (kefi URLs
 * come from getKefiUrls(), not a baseURL parameter). Unifying the two is
 * deliberate future cleanup.
 */

import { expect, type APIRequestContext, type Cookie, type Page } from '@playwright/test';

import { loginAsTenantAdminBrowser } from './realm-browser-auth.js';
import { isOnKeycloak } from './webauthn-helpers.js';

const CSRF_HEADER = 'X-BFF-Csrf';
const CSRF_VALUE = '1';

export const HTTP_OK = 200;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * The per-IP "BffAuth" rate limiter (5 req/60s, empty-body 429s) sits in front
 * of the device lockout (JSON-body 429 + Retry-After). Poll through it.
 */
export const RATE_LIMIT_BACKOFF_MS = 15_000;
export const RATE_LIMIT_MAX_WAIT_MS = 120_000;

/** POSTs a /bff endpoint with the CSRF header + explicit Origin the BFF requires. */
export function bffPost(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data?: Record<string, unknown>,
): ReturnType<APIRequestContext['post']> {
  return request.post(`${baseUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: baseUrl },
    data: data ?? {},
  });
}

/** Like {@link bffPost}, but polls through the per-IP rate limiter's empty-body 429s. */
export async function bffPostThroughRateLimit(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data?: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let lastResponse: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  await expect
    .poll(
      async () => {
        lastResponse = await bffPost(request, baseUrl, path, data);
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

/**
 * PUTs a BFF-proxied JSON endpoint (e.g. the tenant-api `/bff/api/tenants/*`
 * routes) with the CSRF header + explicit Origin the BFF requires on
 * state-changing calls. Unlike {@link bffPost} this targets the YARP proxy
 * path, not the BFF's own `/bff/*` auth endpoints.
 */
export function bffPut(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data: Record<string, unknown>,
): ReturnType<APIRequestContext['put']> {
  return request.put(`${baseUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: baseUrl },
    data,
  });
}

/** Upstream-error statuses worth retrying — a BFF→Keycloak grant can blip. */
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
const TRANSIENT_RETRY_BACKOFF_MS = 3_000;
const TRANSIENT_RETRY_MAX_ATTEMPTS = 4;

/**
 * Like {@link bffPostThroughRateLimit}, but ALSO retries transient upstream
 * errors (502/503/504) on a short backoff. The device-PIN enrol calls
 * `bff → Keycloak` for an offline-access grant; on staging that grant
 * occasionally 502s on a momentary KC hiccup (it succeeds on the next try).
 * Retrying here keeps the shared suite from flaking on an environment blip
 * without masking a persistent config error (which 502s every attempt).
 */
export async function bffPostThroughTransientErrors(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data?: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let last: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  await expect
    .poll(
      async () => {
        last = await bffPostThroughRateLimit(request, baseUrl, path, data);
        const status = last.status();
        const isTransient =
          status === HTTP_BAD_GATEWAY ||
          status === HTTP_SERVICE_UNAVAILABLE ||
          status === HTTP_GATEWAY_TIMEOUT;
        return isTransient ? 'transient' : 'settled';
      },
      {
        message: `retrying transient upstream errors on ${path}`,
        intervals: Array<number>(TRANSIENT_RETRY_MAX_ATTEMPTS).fill(TRANSIENT_RETRY_BACKOFF_MS),
        timeout: TRANSIENT_RETRY_BACKOFF_MS * (TRANSIENT_RETRY_MAX_ATTEMPTS + 1),
      },
    )
    .toBe('settled');
  return last!;
}

/** Finds a captured cookie by name, asserting it exists. */
export function requireCookie(cookies: Cookie[], name: string): Cookie {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `cookie ${name} present`).toBeDefined();
  return cookie!;
}

/**
 * Auto-dismiss the app's cookie-consent banner whenever it blocks an
 * interaction (mirrors BasePage.registerOverlayHandlers). Without it, the
 * banner overlays the passkey button and intercepts the click.
 */
export async function registerCookieBannerHandler(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.locator('[data-testid="cookie-consent-banner"]'),
    async () => {
      try {
        await page
          .locator('[data-testid="cookie-consent-accept-all"]')
          .click({ noWaitAfter: true, timeout: 5_000 });
      } catch {
        // Banner disappeared mid-navigation — safe to ignore.
      }
    },
  );
}

/**
 * Drives the browser to a rate-limited BFF GET endpoint (/bff/passkey/login or
 * /bff/passkey/register), polling through empty-body 429 pages. These endpoints
 * share the per-IP "BffAuth" limiter with the PIN endpoints, so in serial runs
 * the PIN test's lockout phase can leave the window drained — a navigation then
 * renders a bare 429 instead of redirecting to Keycloak.
 */
export async function gotoBffThroughRateLimit(page: Page, url: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if (isOnKeycloak(page)) return 'on-keycloak';
        const response = await page.goto(url);
        if (response !== null && response.status() === HTTP_TOO_MANY_REQUESTS) {
          return 'rate-limited';
        }
        return isOnKeycloak(page) ? 'on-keycloak' : 'navigating';
      },
      {
        message: `waiting out the per-IP BffAuth rate limiter navigating to ${url}`,
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('on-keycloak');
}

/**
 * Logs in via the BFF, polling through per-IP rate-limit 429s. The serial
 * device-PIN test's lockout phase deliberately drains the BffAuth limiter, so
 * the next test's first login can land inside a still-throttled window —
 * that's the limiter doing its job, not a product failure.
 */
export async function loginThroughRateLimit(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          await loginAsTenantAdminBrowser(page, user);
          return 'logged-in';
        } catch (error) {
          if (error instanceof Error && error.message.includes('status 429')) {
            return 'rate-limited';
          }
          throw error;
        }
      },
      {
        message: 'waiting out the per-IP BffAuth rate limiter before /bff/login',
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('logged-in');
}
