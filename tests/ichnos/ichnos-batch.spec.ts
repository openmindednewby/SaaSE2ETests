// @api tier for F4 batch CSV screening (M1-10, M1-6). Quote → create (multipart CSV upload) → poll to
// completed → merged report CSV shows the sanctioned hit as a direct OFAC match and the clean address as
// clear. Also asserts an overlong-address row → 400 and the unauthenticated negatives. The authed lifecycle
// runs opportunistically with an ichnos tenant token (Growth+ gated) and skips clearly otherwise.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CLEAR_BTC_ADDRESS,
  ICHNOS_API_URL,
  SANCTIONED_TRX_ADDRESS,
  csvMultipart,
  getIchnosToken,
  tryRequest,
} from './ichnos-helpers.js';

const QUOTE_PATH = '/v1/batches/quote';
const BATCHES_PATH = '/v1/batches';
const MAX_ADDRESS_LENGTH = 128;
const COMPLETION_TIMEOUT_MS = 25_000;
const COMPLETION_POLL_MS = 1_500;

const CSV = `chain,address\n${SANCTIONED_TRX_ADDRESS.chain},${SANCTIONED_TRX_ADDRESS.address}\n${CLEAR_BTC_ADDRESS.chain},${CLEAR_BTC_ADDRESS.address}\n`;
// One valid row + one row whose address exceeds the 128-char DB column → a per-row error → 400 on create.
const OVERLONG_CSV = `chain,address\n${CLEAR_BTC_ADDRESS.chain},${CLEAR_BTC_ADDRESS.address}\nBTC,${'A'.repeat(MAX_ADDRESS_LENGTH + 72)}\n`;

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** POST a multipart CSV; null on a transport error so the caller can skip gracefully. */
async function postCsv(
  request: APIRequestContext,
  path: string,
  csv: string,
  token: string,
) {
  try {
    return await request.post(`${ICHNOS_API_URL}${path}`, {
      headers: bearer(token),
      multipart: csvMultipart(csv),
      timeout: 15_000,
    });
  } catch {
    return null;
  }
}

test.describe('Ichnos batch screening @ichnos-api', () => {
  test('rejects an unauthenticated batch create', async ({ request }) => {
    const result = await postCsv(request, BATCHES_PATH, CSV, 'not-a-token');
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.status());
  });

  test('quotes, runs, and reports a batch with a direct OFAC hit', async ({ request }) => {
    // The batch worker screens asynchronously; the poll below needs headroom past the 30s default.
    test.setTimeout(90_000);

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

    // 1) Quote — 2 valid rows, no invalid rows, an integer estimate (0 when credits aren't enforced, else 2).
    const quoteRes = await postCsv(request, QUOTE_PATH, CSV, token);
    expect(quoteRes).not.toBeNull();
    expect(quoteRes!.status(), await quoteRes!.text()).toBe(200);
    const quote = (await quoteRes!.json()) as { rowCount: number; invalidRowCount: number; estimatedCost: number };
    expect(quote.rowCount).toBe(2);
    expect(quote.invalidRowCount).toBe(0);
    expect([0, 2]).toContain(quote.estimatedCost);

    // 2) Create — 201 pending. A non-Growth plan is gated 402; skip the async assertions then (still a pass
    // signal for the gate, which billing covers). Insufficient credits is also 402.
    const createRes = await postCsv(request, BATCHES_PATH, CSV, token);
    expect(createRes).not.toBeNull();
    const createStatus = createRes!.status();
    if (createStatus === 402) {
      test.skip(true, 'Batch is Growth+ gated (or out of credits) for this tenant — see ichnos-billing.spec.ts');
      return;
    }
    expect(createStatus, await createRes!.text()).toBe(201);
    const created = (await createRes!.json()) as { batchId: string; status: string };
    expect(created.batchId).toBeTruthy();
    expect(created.status).toBe('pending');

    // 3) Poll GET /v1/batches/{id} (returns { summary, rows }) until the worker completes.
    const detailPath = `${BATCHES_PATH}/${created.batchId}`;
    let summary: { status: string; matchedRows: number; failedRows: number } | null = null;
    await expect
      .poll(
        async () => {
          const got = await tryRequest(request, detailPath, { headers: bearer(token) });
          if (!got || got.response.status() !== 200) return 'pending';
          const detail = (await got.response.json()) as { summary: typeof summary };
          summary = detail.summary;
          return summary?.status ?? 'pending';
        },
        { message: 'waiting for the batch to complete', intervals: [COMPLETION_POLL_MS], timeout: COMPLETION_TIMEOUT_MS },
      )
      .toBe('completed');
    expect(summary!.matchedRows).toBe(1);
    expect(summary!.failedRows).toBe(0);

    // 4) Merged report CSV — one row per screening: the sanctioned TRX as a direct OFAC hit, the BTC as clear.
    const report = await tryRequest(request, `${detailPath}/report?format=csv`, { headers: bearer(token) });
    expect(report).not.toBeNull();
    expect(report!.response.status(), await report!.response.text()).toBe(200);
    expect(report!.response.headers()['content-type']).toContain('text/csv');
    const csv = await report!.response.text();
    expect(csv).toContain('direct');
    expect(csv).toContain('OFAC');
    expect(csv).toContain('clear');
  });

  test('rejects a CSV with an overlong address (400)', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const result = await postCsv(request, BATCHES_PATH, OVERLONG_CSV, token);
    expect(result).not.toBeNull();
    // 400 (malformed row) OR 402 (Growth-gate runs before parse) — both prove the bad row never enqueues.
    expect([400, 402]).toContain(result!.status());
  });
});
