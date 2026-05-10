import { test, expect } from '@playwright/test';
import axios, { type AxiosResponse } from 'axios';

/**
 * E2E coverage for the cookie-based web session that backs the
 * auth-client v2 <code>CookieTokenStorage</code> adapter.
 *
 * The contract is:
 *   1. POST /auth/login on success sets the <code>__Host-refresh</code> cookie.
 *   2. POST /auth/refresh-cookie reads the cookie, swaps it, returns a new access token.
 *   3. POST /auth/logout clears the cookie even when the body is empty.
 *
 * Tests are tagged @identity @auth @cookie so they run in
 * playwright-e2e-identity-all.
 */

const IDENTITY_API_URL = process.env.IDENTITY_API_URL || 'http://localhost:5002';
const TEST_REALM = process.env.TEST_REALM || 'questioner';
const COOKIE_NAME = '__Host-refresh';

interface SetCookieEntry {
  name: string;
  value: string;
  attributes: Record<string, string>;
}

/**
 * Parse all `Set-Cookie` headers from an axios response. Axios only
 * surfaces the array via `response.headers['set-cookie']` (lowercase).
 */
function parseSetCookieHeaders(response: AxiosResponse): SetCookieEntry[] {
  const raw = response.headers['set-cookie'];
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw.map((line: string) => {
    const parts = line.split(';').map(p => p.trim());
    const [nameValue, ...rest] = parts;
    const eq = nameValue.indexOf('=');
    const name = nameValue.substring(0, eq);
    const value = nameValue.substring(eq + 1);
    const attributes: Record<string, string> = {};
    for (const attr of rest) {
      const idx = attr.indexOf('=');
      if (idx === -1) {
        attributes[attr.toLowerCase()] = '';
      } else {
        attributes[attr.substring(0, idx).toLowerCase()] = attr.substring(idx + 1);
      }
    }
    return { name, value, attributes };
  });
}

function findRefreshCookie(response: AxiosResponse): SetCookieEntry | undefined {
  return parseSetCookieHeaders(response).find(c => c.name === COOKIE_NAME);
}

test.describe('Cookie-based Session @identity @auth @cookie', () => {
  test.slow();

  test('login response sets __Host-refresh cookie with HttpOnly + Secure + SameSite=Lax + Path=/', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    if (!username || !password) {
      test.skip(true, 'TEST_USER credentials not configured');
      return;
    }

    const response = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/login`,
      { method: 0, username, password },
      {
        headers: { 'X-Realm': TEST_REALM },
        timeout: 15000,
        validateStatus: () => true,
      },
    );

    expect(response.status).toBe(200);

    const cookie = findRefreshCookie(response);
    expect(cookie, 'Set-Cookie: __Host-refresh must be present on login success').toBeDefined();
    expect(cookie!.value.length).toBeGreaterThan(20);
    expect('httponly' in cookie!.attributes).toBe(true);
    expect('secure' in cookie!.attributes).toBe(true);
    expect(cookie!.attributes['path']).toBe('/');
    expect(cookie!.attributes['samesite']?.toLowerCase()).toBe('lax');
    // __Host- prefix forbids Domain.
    expect(cookie!.attributes['domain']).toBeUndefined();
    // 90-day default lifetime.
    const expectedSeconds = 90 * 24 * 60 * 60;
    expect(parseInt(cookie!.attributes['max-age'] ?? '0', 10)).toBe(expectedSeconds);
  });

  test('refresh-cookie swaps the cookie value and returns a new access token', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    if (!username || !password) {
      test.skip(true, 'TEST_USER credentials not configured');
      return;
    }

    // Login to get the cookie.
    const loginResponse = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/login`,
      { method: 0, username, password },
      {
        headers: { 'X-Realm': TEST_REALM },
        timeout: 15000,
        validateStatus: () => true,
      },
    );
    expect(loginResponse.status).toBe(200);
    const initialCookie = findRefreshCookie(loginResponse);
    expect(initialCookie).toBeDefined();

    // Hit refresh-cookie carrying the cookie. axios won't auto-include
    // it across requests so we manually replay it on the Cookie header.
    const refreshResponse = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/refresh-cookie`,
      undefined,
      {
        headers: {
          Cookie: `${COOKIE_NAME}=${initialCookie!.value}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      },
    );

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.data.accessToken).toBeTruthy();
    // Refresh token NOT in the body — it stays in the cookie only.
    expect(refreshResponse.data.refreshToken).toBeUndefined();

    const rotatedCookie = findRefreshCookie(refreshResponse);
    expect(rotatedCookie, 'refresh-cookie must rotate the cookie').toBeDefined();
    expect(rotatedCookie!.value).not.toBe(initialCookie!.value);
  });

  test('refresh-cookie without cookie returns 401', async () => {
    const response = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/refresh-cookie`,
      undefined,
      {
        headers: { 'X-Realm': TEST_REALM },
        timeout: 15000,
        validateStatus: () => true,
      },
    );

    expect(response.status).toBe(401);
    expect(response.data.errorCode).toBe('MISSING_COOKIE');
  });

  test('logout clears the __Host-refresh cookie even with empty body', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    if (!username || !password) {
      test.skip(true, 'TEST_USER credentials not configured');
      return;
    }

    // Login to get a cookie.
    const loginResponse = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/login`,
      { method: 0, username, password },
      {
        headers: { 'X-Realm': TEST_REALM },
        timeout: 15000,
        validateStatus: () => true,
      },
    );
    expect(loginResponse.status).toBe(200);
    const cookie = findRefreshCookie(loginResponse);
    expect(cookie).toBeDefined();

    // Logout with empty body and the cookie attached.
    const logoutResponse = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/logout`,
      {},
      {
        headers: { Cookie: `${COOKIE_NAME}=${cookie!.value}` },
        timeout: 15000,
        validateStatus: () => true,
      },
    );

    expect(logoutResponse.status).toBe(200);

    const clearedCookie = findRefreshCookie(logoutResponse);
    expect(clearedCookie, 'logout must Set-Cookie an expired refresh cookie').toBeDefined();
    // Cookie is cleared either via max-age=0 or expires in the past.
    const maxAge = parseInt(clearedCookie!.attributes['max-age'] ?? '999', 10);
    const expires = clearedCookie!.attributes['expires'];
    const cleared =
      maxAge === 0 ||
      (expires && new Date(expires).getTime() < Date.now());
    expect(cleared).toBe(true);
  });
});
