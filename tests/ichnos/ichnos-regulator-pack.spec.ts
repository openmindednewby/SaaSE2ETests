// @api tier for M3 Wave-2b regulator packs (F6-pack). The unauthenticated negative always runs. With an
// ichnos tenant token: a create with no selection criterion is rejected 400 (the validator runs pre-handler,
// so this is deterministic on any plan), and the create → poll-to-completed → download-zip → tenant-scoped
// lifecycle is asserted opportunistically (Growth+ gated: a non-growth tenant returns 402, which IS the gate
// assertion). The pack is built synchronously by the service, so the create usually returns 'completed'
// immediately; the poll is defensive in case a future async worker returns 'pending' first.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ICHNOS_API_URL,
  PAYMENT_REQUIRED,
  bearer,
  getIchnosToken,
  jsonAuth,
  tryRequest,
} from './ichnos-helpers.js';

const PACKS_PATH = '/v1/regulator-packs';
const COMPLETION_TIMEOUT_MS = 25_000;
const COMPLETION_POLL_MS = 1_500;
const ZIP_MAGIC = [0x50, 0x4b]; // 'PK' — the local-file-header signature of every zip archive.

interface RegulatorPackSummary {
  packId: string;
  status: string;
  screeningCount: number;
}

/** A period covering the last 30 days — a valid selection criterion for a pack. */
function last30Days(): { fromUtc: string; toUtc: string } {
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return { fromUtc: new Date(now - THIRTY_DAYS_MS).toISOString(), toUtc: new Date(now).toISOString() };
}

async function tokenOrSkip(): Promise<string | null> {
  const token = await getIchnosToken();
  if (!token) {
    test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
    return null;
  }
  return token;
}

test.describe('Ichnos regulator packs @ichnos-api', () => {
  test('rejects an unauthenticated regulator-pack create', async ({ request }) => {
    const result = await tryRequest(request, PACKS_PATH, {
      method: 'POST',
      data: last30Days(),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('rejects a create with no selection criterion (400)', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;
    // The validator (period-or-ids required) runs before the handler's plan gate → 400 on any plan.
    const res = await tryRequest(request, PACKS_PATH, { method: 'POST', data: {}, headers: jsonAuth(token) });
    expect(res!.response.status(), await res!.response.text()).toBe(400);
  });

  test('creates a pack, polls to completed, downloads a zip, and is tenant-scoped (Growth+), else 402 gate', async ({ request }) => {
    test.setTimeout(60_000);
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;

    // Create — Growth+ gated. A non-growth tenant is 402 (that IS the gate assertion); growth+ is 201.
    const created = await tryRequest(request, PACKS_PATH, { method: 'POST', data: last30Days(), headers: jsonAuth(token) });
    expect(created).not.toBeNull();
    const createStatus = created!.response.status();
    if (createStatus === PAYMENT_REQUIRED) {
      test.skip(true, 'Regulator-pack create is Growth+ gated for this tenant — 402 gate proven (see ichnos-billing.spec.ts)');
      return;
    }
    expect(createStatus, await created!.response.text()).toBe(201);
    const pack = (await created!.response.json()) as RegulatorPackSummary;
    expect(pack.packId).toBeTruthy();
    expect(['pending', 'completed', 'failed']).toContain(pack.status);
    expect(pack.status).not.toBe('failed');

    // Poll the pack list until this pack reports completed (usually immediate — the build is synchronous).
    await expect
      .poll(async () => statusOf(request, token, pack.packId), {
        message: 'waiting for the regulator pack to complete',
        intervals: [COMPLETION_POLL_MS],
        timeout: COMPLETION_TIMEOUT_MS,
      })
      .toBe('completed');

    // Download → 200 with a real zip: content-type application/zip AND the 'PK' magic bytes.
    const download = await tryRequest(request, `${PACKS_PATH}/${pack.packId}/download`, { headers: bearer(token) });
    expect(download!.response.status(), await download!.response.text()).toBe(200);
    expect(download!.response.headers()['content-type']).toContain('zip');
    const body = await download!.response.body();
    expect(body.length).toBeGreaterThan(0);
    expect([body[0], body[1]]).toEqual(ZIP_MAGIC);

    // Tenant-scoped: an unknown pack id (another tenant's, or non-existent) → 404 (never leaked).
    const unknownId = '22222222-3333-4444-5555-666666666666';
    const foreign = await tryRequest(request, `${PACKS_PATH}/${unknownId}/download`, { headers: bearer(token) });
    expect(foreign!.response.status()).toBe(404);
  });
});

/** Return the status of a pack by id from the list endpoint, or 'pending' when not yet visible. */
async function statusOf(request: APIRequestContext, token: string, packId: string): Promise<string> {
  const listed = await tryRequest(request, PACKS_PATH, { headers: bearer(token) });
  if (!listed || listed.response.status() !== 200) return 'pending';
  const body = (await listed.response.json()) as { items: RegulatorPackSummary[] };
  return body.items.find((p) => p.packId === packId)?.status ?? 'pending';
}
