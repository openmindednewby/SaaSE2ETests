/**
 * Shared auth helpers for the poueni E2E specs — the poueni equivalent of
 * `helpers/kefi/kefiBffApi.ts`. Every poueni spec used to hand-roll signup,
 * email reading, the rate-limit-aware dashboard login, and the in-page API-key
 * rotate; this centralises them (and the one correct implementation of each).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { getPoueniUrls } from './poueniUrls.js';
import { readEmail, extractPoueniVerifyUrl } from './poueniMailbox.js';

const urls = getPoueniUrls();

/**
 * The per-IP "BffAuth" rate limiter is 5/60s. When the whole poueni suite logs
 * in back-to-back from one canary pod it 429s the later submits, so login waits
 * out a full window and retries rather than hammering (a tight retry only burns
 * more budget). A fresh signup+verify can also briefly 401 while Keycloak
 * enables the user — the same wait-and-retry covers both.
 */
export const RATE_LIMIT_WINDOW_MS = 15_000;
export const LOGIN_BUDGET_MS = 120_000;

/** POST /v1/public/signup for a canary tenant. */
export async function signup(
  request: APIRequestContext,
  email: string,
  password: string,
  tenantName = 'E2E Lab',
): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/public/signup`, {
    data: { email, tenantName, password },
  });
  expect(res.status(), 'signup should be accepted').toBe(202);
}

/** Read the verify email and return its verify URL (asserts it's present). */
export async function readVerifyUrl(email: string): Promise<string> {
  const captured = await readEmail(email, 'Verify');
  const url = extractPoueniVerifyUrl({
    uid: 0, subject: 'Verify', to: email, bodyText: captured.text, bodyHtml: captured.html,
  });
  expect(url, 'verify URL present in signup email').not.toBeNull();
  return url!;
}

/**
 * Log in via the dashboard form and stay authenticated, retrying on a 15s
 * backoff to ride out the per-IP BffAuth limiter / KC-enable propagation.
 * Throws if it can't authenticate within the budget.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  const deadline = Date.now() + LOGIN_BUDGET_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await page.context().clearCookies();
    await page.goto(`${urls.dashboardUrl}/login`);
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8_000 });
      return;
    } catch (e) {
      lastError = e;
      await delay(RATE_LIMIT_WINDOW_MS);
    }
  }
  throw lastError ?? new Error('dashboard login did not complete within the rate-limit budget');
}

interface RotateApiKeyResponse {
  apiKey: string;
}

/**
 * Mint a tenant API key through the authenticated BFF. Runs as an IN-PAGE fetch
 * (not page.request) so the request carries the dashboard Origin the BFF's CSRF
 * middleware requires — exactly the call the dashboard's adminApi.rotateApiKey()
 * makes.
 */
export async function rotateApiKey(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const res = await fetch('/bff/api/poueni/v1/admin/api-key/rotate', {
      method: 'POST',
      headers: { 'X-BFF-Csrf': '1', Accept: 'application/json' },
      credentials: 'same-origin',
    });
    return { status: res.status, text: await res.text() };
  });
  expect(result.status, `rotate-api-key should succeed (got ${result.status}: ${result.text})`).toBe(200);
  return (JSON.parse(result.text) as RotateApiKeyResponse).apiKey;
}
