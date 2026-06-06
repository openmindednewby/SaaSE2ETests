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
import { test, expect, type APIRequestContext } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import { newPoueniCanaryEmail } from '../../helpers/poueni/poueniMailbox.js';
import { signup, readVerifyUrl, login, rotateApiKey } from '../../helpers/poueni/poueniAuth.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'LivePoueniPass-123';

const urls = getPoueniUrls();

// Nicosia apex — a GPS fix with the ML estimate ~15 m off it.
const GPS_BASE = { lat: 35.1856, lng: 33.3823 };
const ML_OFFSET = 0.00014; // ~15 m

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
    await signup(request, email, PASSWORD, 'E2E Live-Map Lab');

    // ── 2. verify (activates tenant + enables KC user) ──────────────────
    const verifyUrl = await readVerifyUrl(email);
    expect((await request.get(verifyUrl)).status(), 'verify returns the success page').toBe(200);

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
