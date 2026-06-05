/**
 * Poueni dual-marker live-map E2E (#184) — the real find-my-device round-trip.
 *
 * Proves the whole Flow-A chain end-to-end through the same surfaces a user
 * touches, against the deployed stack (so the BFF actually streams the SSE and
 * the dashboard actually renders both markers):
 *
 *   1. API     signup (bot mailbox, plus-addressed)                 → 202
 *   2. IMAP    read verify email → GET the verify URL               → tenant Active
 *   3. BROWSER dashboard login                                      → BFF session
 *   4. BFF     rotate API key (authenticated)                       → a tenant X-API-Key
 *   5. API     POST 3 DUAL presence beacons (gps + mlEstimate)      → 200 each
 *   6. BROWSER open /live → the device shows BOTH markers + the GPS↔ML error
 *      label, the device list reads "±N m GPS↔ML", and the stream is "live".
 *
 * The beacons are posted BEFORE opening /live, so the device is in the SSE
 * snapshot the dashboard receives on connect — deterministic, no live-race.
 *
 * Tagged @poueni @presence @critical. Remote-only (prod/staging): there's no
 * local Poueni stack and the flow needs real Maddy + Keycloak + the BFF.
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
const PASSWORD = 'LivePoueniPass-123';

const urls = getPoueniUrls();

// Nicosia apex — a GPS fix with the ML estimate ~15 m off it.
const GPS_BASE = { lat: 35.1856, lng: 33.3823 };
const ML_OFFSET = 0.00014; // ~15 m

interface RotateApiKeyResponse {
  apiKey: string;
}

async function signup(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/public/signup`, {
    data: { email, tenantName: 'E2E Live-Map Lab', password: PASSWORD },
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

/**
 * Log in via the dashboard form and stay authenticated. Retries the credential
 * submit for up to a minute: right after signup+verify, Keycloak user-enable can
 * lag the API by a few seconds (more so in-cluster, where several canary specs
 * mint fresh KC users back-to-back), so a single submit can race propagation.
 * The dual-marker behaviour under test is unrelated to auth — this just keeps
 * the login step from being the flaky part.
 */
async function login(page: Page, email: string, password: string): Promise<void> {
  const deadline = Date.now() + 60_000;
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
      await page.waitForTimeout(3_000);
    }
  }
  throw lastError ?? new Error('dashboard login did not complete within the retry window');
}

/**
 * Mint a tenant X-API-Key through the authenticated BFF. Runs as an IN-PAGE
 * fetch (not page.request) so the request carries the dashboard Origin the BFF's
 * CSRF middleware requires — exactly the call the dashboard's own
 * adminApi.rotateApiKey() makes.
 */
async function rotateApiKey(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const res = await fetch('/bff/api/poueni/v1/admin/api-key/rotate', {
      method: 'POST',
      headers: { 'X-BFF-Csrf': '1', Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const text = await res.text();
    return { status: res.status, text };
  });
  expect(result.status, `rotate-api-key should succeed (got ${result.status}: ${result.text})`).toBe(200);
  const body = JSON.parse(result.text) as RotateApiKeyResponse;
  expect(body.apiKey, 'rotate returns an apiKey').toMatch(/^poueni_/);
  return body.apiKey;
}

/** Post one dual presence beacon (GPS + ML estimate ~15 m apart). */
async function postBeacon(
  request: APIRequestContext,
  apiKey: string,
  deviceId: string,
  jitter: number,
): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/presence`, {
    headers: { 'X-API-Key': apiKey },
    data: {
      deviceId,
      gps: { lat: GPS_BASE.lat + jitter, lng: GPS_BASE.lng + jitter, accuracyM: 6 },
      mlEstimate: {
        lat: GPS_BASE.lat + jitter + ML_OFFSET,
        lng: GPS_BASE.lng + jitter + ML_OFFSET,
        confidence: 0.8,
      },
    },
  });
  expect(res.status(), 'dual presence beacon should be accepted').toBe(200);
}

test.describe('Poueni dual-marker live map @poueni @presence', () => {
  test.skip(!isRemoteTarget(), 'Poueni live-map E2E targets prod/staging (real Maddy + KC + BFF); no local stack');

  test('dual beacons render two markers + the GPS↔ML error on the live map @critical', async ({
    page,
    request,
  }) => {
    const email = newPoueniCanaryEmail();
    const deviceId = `e2e-live-${Date.now().toString(36)}`;
    test.info().annotations.push({ type: 'canaryEmail', description: email });
    test.info().annotations.push({ type: 'deviceId', description: deviceId });

    // ── 1. signup ───────────────────────────────────────────────────────
    await signup(request, email);

    // ── 2. verify (activates tenant + enables KC user) ──────────────────
    const verifyEmail = await readEmail(email, 'Verify');
    const verifyUrl = extractPoueniVerifyUrl({
      uid: 0, subject: 'Verify', to: email, bodyText: verifyEmail.text, bodyHtml: verifyEmail.html,
    });
    expect(verifyUrl, 'verify URL present in signup email').not.toBeNull();
    expect((await request.get(verifyUrl!)).status(), 'verify returns the success page').toBe(200);

    // ── 3. dashboard login ──────────────────────────────────────────────
    await login(page, email, PASSWORD);

    // ── 4. mint an API key for the collector side ───────────────────────
    const apiKey = await rotateApiKey(page);

    // ── 5. post 3 dual beacons (a short walk) ───────────────────────────
    await postBeacon(request, apiKey, deviceId, 0);
    await postBeacon(request, apiKey, deviceId, 0.00005);
    await postBeacon(request, apiKey, deviceId, 0.00010);

    // ── 6. /live shows both markers + the GPS↔ML error ──────────────────
    await page.goto(`${urls.dashboardUrl}/live`);

    // The legend (proves the live-map page mounted).
    await expect(page.locator('.legend'), 'live-map legend renders').toBeVisible({ timeout: 15_000 });

    // The device list row: the device, live, with the GPS↔ML error read-out.
    const row = page.locator('.device-list li', { hasText: deviceId });
    await expect(row, 'the device appears in the live list').toBeVisible({ timeout: 20_000 });
    await expect(row, 'the row shows the GPS↔ML error').toContainText(/±\d+ m GPS↔ML/);

    // The map's permanent dual-marker label "deviceId · ±N m" — its presence
    // proves both the GPS and ML markers + the connecting error line rendered.
    await expect(
      page.locator('.leaflet-tooltip', { hasText: deviceId }),
      'the map renders the dual-marker error label',
    ).toContainText(/±\d+ m/, { timeout: 20_000 });

    // The SSE connection indicator is live (the BFF is streaming).
    await expect(page.locator('.legend__conn--open'), 'the SSE stream is live').toBeVisible();
  });
});
