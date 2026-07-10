// @api tier for F3 developer/customer API keys (M1-10, M1-5). Full lifecycle: issue a key (JWT) → the
// plaintext `ichnos_…` is returned ONCE → screen with `X-Api-Key` (NO JWT) and get a real direct OFAC hit →
// list keys (never leaking the hash/plaintext) → revoke → the revoked key is rejected 401. The
// unauthenticated negatives always run; the authed lifecycle runs opportunistically with an ichnos tenant
// token and skips with a clear reason otherwise.
import { expect, test } from '@playwright/test';
import {
  ICHNOS_API_URL,
  SANCTIONED_TRX_ADDRESS,
  getIchnosToken,
  issueApiKey,
  tryRequest,
} from './ichnos-helpers.js';

const KEYS_PATH = '/v1/api-keys';
const SCREEN_PATH = '/v1/screenings/address';
const KEY_PREFIX = 'ichnos_';

test.describe('Ichnos API keys @ichnos-api', () => {
  test('rejects unauthenticated key issuance', async ({ request }) => {
    const result = await tryRequest(request, KEYS_PATH, {
      method: 'POST',
      data: { label: 'e2e' },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('rejects a screening presented with no credential', async ({ request }) => {
    const result = await tryRequest(request, SCREEN_PATH, {
      method: 'POST',
      data: SANCTIONED_TRX_ADDRESS,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('issues, screens via X-Api-Key (direct OFAC hit), lists, and revokes', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
      return;
    }
    const jwtHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // 1) Issue — the plaintext is returned ONCE, prefixed `ichnos_`, with a non-secret display prefix.
    const issued = await tryRequest(request, KEYS_PATH, {
      method: 'POST',
      data: { label: 'e2e-lifecycle' },
      headers: jwtHeaders,
    });
    expect(issued).not.toBeNull();
    expect(issued!.response.status(), await issued!.response.text()).toBeLessThan(300);
    const key = (await issued!.response.json()) as { id: string; plaintext: string; prefix: string; label: string };
    expect(key.id).toBeTruthy();
    expect(key.plaintext.startsWith(KEY_PREFIX), `plaintext should start ${KEY_PREFIX}`).toBeTruthy();
    expect(key.prefix).toBeTruthy();
    expect(key.label).toBe('e2e-lifecycle');

    // 2) Screen the sanctioned TRON address with ONLY the X-Api-Key (no Authorization header) → direct OFAC.
    const screened = await tryRequest(request, SCREEN_PATH, {
      method: 'POST',
      data: { ...SANCTIONED_TRX_ADDRESS, context: 'e2e-apikey' },
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key.plaintext },
    });
    expect(screened).not.toBeNull();
    expect(screened!.response.status(), await screened!.response.text()).toBe(200);
    const verdict = (await screened!.response.json()) as {
      riskTier: string;
      directMatch: boolean;
      matches: Array<{ listSource: string }>;
    };
    expect(verdict.riskTier).toBe('direct');
    expect(verdict.directMatch).toBe(true);
    expect(verdict.matches.length).toBeGreaterThan(0);
    expect(verdict.matches.some((m) => m.listSource === 'OFAC')).toBeTruthy();

    // 3) List (JWT) — a non-secret summary; the hash + plaintext must NEVER appear.
    const listed = await tryRequest(request, KEYS_PATH, { headers: { Authorization: `Bearer ${token}` } });
    expect(listed).not.toBeNull();
    expect(listed!.response.status()).toBe(200);
    const listText = await listed!.response.text();
    expect(listText).not.toContain(key.plaintext);
    expect(listText.toLowerCase()).not.toContain('hash');
    const summaries = JSON.parse(listText) as Array<{ id: string; prefix: string; active: boolean }>;
    const mine = summaries.find((s) => s.id === key.id);
    expect(mine, 'issued key appears in the list').toBeDefined();
    expect(mine!.active).toBe(true);

    // 4) Revoke → 204.
    const revoked = await tryRequest(request, `${KEYS_PATH}/${key.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoked).not.toBeNull();
    expect(revoked!.response.status()).toBe(204);

    // 5) The revoked key can no longer authenticate a screening → 401.
    const afterRevoke = await tryRequest(request, SCREEN_PATH, {
      method: 'POST',
      data: SANCTIONED_TRX_ADDRESS,
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key.plaintext },
    });
    expect(afterRevoke).not.toBeNull();
    expect([401, 403]).toContain(afterRevoke!.response.status());
  });

  test('issueApiKey helper returns a usable ichnos_ key', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const key = await issueApiKey(request, token, 'e2e-helper');
    if (!key) {
      test.skip(true, `Key issuance unavailable at ${ICHNOS_API_URL}`);
      return;
    }
    expect(key.plaintext.startsWith(KEY_PREFIX)).toBeTruthy();
    // Clean up the helper-issued key so repeated runs don't accumulate keys.
    await tryRequest(request, `${KEYS_PATH}/${key.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});
