/**
 * Poueni GDPR data-subject E2E (#180-completeness / Art. 15 + 17).
 *
 * Proves the erasure + export round-trip end-to-end against the deployed API:
 *
 *   1. API     signup (bot mailbox) → 202
 *   2. IMAP    verify → tenant Active
 *   3. BROWSER dashboard login → mint a tenant API key (in-page rotate)
 *   4. API     POST a contribution for a device (X-API-Key)
 *   5. API     GET  /v1/users/{device}/export   → the contribution is there
 *   6. API     DELETE /v1/users/{device}/data    → it's erased (count >= 1)
 *   7. API     GET  /v1/users/{device}/export   → contributions empty, but the
 *              erasure AUDIT row survives (the proof erasure happened)
 *
 * Tagged @poueni @gdpr @critical. Remote-only (prod/staging) — needs real Maddy
 * + Keycloak + the deployed API.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import {
  PoueniMailbox,
  loadPoueniMailboxConfig,
  newPoueniCanaryEmail,
  extractPoueniVerifyUrl,
} from '../../helpers/poueni/poueniMailbox.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MAILBOX_TIMEOUT_MS = 90_000;
const MAILBOX_POLL_MS = 2_000;
const PASSWORD = 'GdprPoueniPass-123';
const RATE_LIMIT_WINDOW_MS = 15_000;
const LOGIN_BUDGET_MS = 120_000;

const urls = getPoueniUrls();

interface RotateApiKeyResponse {
  apiKey: string;
}

async function signup(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/public/signup`, {
    data: { email, tenantName: 'E2E GDPR Lab', password: PASSWORD },
  });
  expect(res.status(), 'signup should be accepted').toBe(202);
}

async function readEmail(to: string, subjectIncludes: string): Promise<{ html: string; text: string }> {
  const mailbox = new PoueniMailbox(loadPoueniMailboxConfig(), {
    timeoutMs: MAILBOX_TIMEOUT_MS,
    pollIntervalMs: MAILBOX_POLL_MS,
  });
  const captured = await mailbox.waitForMessageTo(to, { subjectIncludes });
  await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
  return { html: captured.bodyHtml ?? '', text: captured.bodyText };
}

/** Log in, retrying on a 15s backoff to ride out the per-IP BffAuth limiter. */
async function login(page: Page, email: string, password: string): Promise<void> {
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
      await page.waitForTimeout(RATE_LIMIT_WINDOW_MS);
    }
  }
  throw lastError ?? new Error('dashboard login did not complete within the rate-limit budget');
}

/** Mint an API key via an in-page fetch (carries the dashboard Origin the BFF CSRF needs). */
async function rotateApiKey(page: Page): Promise<string> {
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

test.describe('Poueni GDPR erasure + export @poueni @gdpr', () => {
  test.skip(!isRemoteTarget(), 'Poueni GDPR E2E targets prod/staging (real Maddy + KC + API); no local stack');

  test('export shows a contribution, erase removes it, the audit row survives @critical', async ({
    page,
    request,
  }) => {
    const email = newPoueniCanaryEmail();
    const deviceId = `e2e-gdpr-${Date.now().toString(36)}`;
    test.info().annotations.push({ type: 'canaryEmail', description: email });
    test.info().annotations.push({ type: 'deviceId', description: deviceId });

    await signup(request, email);

    const verifyEmail = await readEmail(email, 'Verify');
    const verifyUrl = extractPoueniVerifyUrl({
      uid: 0, subject: 'Verify', to: email, bodyText: verifyEmail.text, bodyHtml: verifyEmail.html,
    });
    expect(verifyUrl, 'verify URL present').not.toBeNull();
    expect((await request.get(verifyUrl!)).status(), 'verify ok').toBe(200);

    await login(page, email, PASSWORD);
    const apiKey = await rotateApiKey(page);
    const apiHeaders = { 'X-API-Key': apiKey };

    // POST a contribution for the device.
    const nowIso = new Date().toISOString();
    const post = await request.post(`${urls.apiUrl}/v1/contributions`, {
      headers: apiHeaders,
      data: {
        deviceId,
        contributions: [
          {
            ts: nowIso,
            scan: { ts: nowIso, wifi: [{ bssid: 'aa:bb:cc:dd:ee:01', rssi: -50 }], cell: [] },
            gps: { lat: 35.1856, lng: 33.3823, accuracyM: 8, source: 'fused' },
            heldOut: false,
          },
        ],
      },
    });
    expect(post.ok(), `contribution accepted (got ${post.status()})`).toBeTruthy();
    expect((await post.json()).accepted, 'one contribution accepted').toBe(1);

    // Export → the contribution is present.
    const export1 = await request.get(`${urls.apiUrl}/v1/users/${deviceId}/export`, { headers: apiHeaders });
    expect(export1.status()).toBe(200);
    const export1Body = await export1.json();
    expect(export1Body.contributions.length, 'export lists the contribution').toBeGreaterThanOrEqual(1);

    // Erase → at least the one contribution is deleted.
    const erase = await request.delete(`${urls.apiUrl}/v1/users/${deviceId}/data`, { headers: apiHeaders });
    expect(erase.status()).toBe(200);
    expect((await erase.json()).contributionsDeleted, 'erase deletes the contribution').toBeGreaterThanOrEqual(1);

    // Export again → contributions gone, but the erasure audit row survives.
    const export2 = await request.get(`${urls.apiUrl}/v1/users/${deviceId}/export`, { headers: apiHeaders });
    const export2Body = await export2.json();
    expect(export2Body.contributions.length, 'contributions are erased').toBe(0);
    expect(export2Body.erasures.length, 'the erasure audit row is retained').toBeGreaterThanOrEqual(1);
  });
});
