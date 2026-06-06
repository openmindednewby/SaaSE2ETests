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
import { test, expect } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import { newPoueniCanaryEmail } from '../../helpers/poueni/poueniMailbox.js';
import { signup, readVerifyUrl, login, rotateApiKey } from '../../helpers/poueni/poueniAuth.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'GdprPoueniPass-123';

const urls = getPoueniUrls();

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

    await signup(request, email, PASSWORD, 'E2E GDPR Lab');

    const verifyUrl = await readVerifyUrl(email);
    expect((await request.get(verifyUrl)).status(), 'verify ok').toBe(200);

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
