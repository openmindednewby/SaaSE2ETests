import { expect, test, type APIRequestContext } from '@playwright/test';
import { deflateSync } from 'zlib';
import {
  clientApiKey,
  createSession,
  internalToken,
  sessionChecks,
  sessionConfiguration,
  submitDocument,
  type CheckRow,
} from './modb-session-helpers';

/**
 * MODB-BILLROUTE-1 "The sixth mock key round-trips gateway -> mock".
 *
 * `utility_bill_authenticity` is selected whenever the flow's `utilityBillMode` is `analysis`
 * (`verification-flow.catalog.ts:116`, `verification-sessions.service.ts:277`): utility-extraction
 * selected WITHOUT utility-authenticity. Until now only the mock's route existence was probed (415
 * to a JSON body); no dispatch with a real payload had ever been observed.
 */
const ANALYSIS_FLOW = 'frontend-v1-passive-mrz-match.utility-extraction';
const BILL_CHECK = 'utility_bill_authenticity';
const FORCED_OUTCOME = 'review';
const BILL_SIZE = [1600, 1200] as const;
const IMAGE_RGB = [180, 190, 200];
const HTTP_ACCEPTED = 202;
const SETTLE_TIMEOUT_MS = 120_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const TERMINAL = ['completed', 'failed', 'cancelled'];

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function syntheticPng([width, height]: readonly [number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(IMAGE_RGB).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function api(): string {
  const raw = process.env.MODB_GATEWAY_URL ?? '';
  return `${raw.endsWith('/') ? raw.slice(0, -1) : raw}/api`;
}

async function waitForCheck(request: APIRequestContext, sessionId: string, checkType: string): Promise<CheckRow> {
  let row: CheckRow | undefined;
  await expect
    .poll(
      async () => {
        const rows = await sessionChecks(request, sessionId);
        row = rows.find((candidate) => candidate.check_type === checkType);
        return row ? row.status : 'absent';
      },
      {
        intervals: POLL_INTERVALS_MS,
        timeout: SETTLE_TIMEOUT_MS,
        message: `${checkType} never reached a terminal state in session ${sessionId}`,
      },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
  expect(row, `${checkType} row was never created for session ${sessionId}`).toBeDefined();
  return row as CheckRow;
}

test.describe('MODB-BILLROUTE-1 utility_bill_authenticity round-trip @modb-api', () => {
  test('AC-BILL-1 a flow with utilityBillMode=analysis dispatches utility_bill_authenticity to the mock and it settles with the forced outcome', async ({
    request,
  }) => {
    test.skip(!clientApiKey() || !internalToken(), 'MODB_CLIENT_API_KEY / MODB_INTERNAL_TOKEN unset');
    const session = await createSession(request, ANALYSIS_FLOW, `billroute-${Date.now()}`);
    const configuration = await sessionConfiguration(request, session);
    expect(configuration.steps, `flow ${ANALYSIS_FLOW} must carry the utility-bill step`).toContain('utility-bill');

    await submitDocument(request, session, { mockOutcomes: { mrz_match: 'passed' } });

    const response = await request.post(`${api()}/v1/verifications/utility-bill/analysis`, {
      headers: { Authorization: `Bearer ${session.token}` },
      timeout: 30_000,
      failOnStatusCode: false,
      multipart: {
        mock_outcomes: JSON.stringify({ utility_extraction: 'passed', [BILL_CHECK]: FORCED_OUTCOME }),
        utility_bill: { name: 'bill.png', mimeType: 'image/png', buffer: syntheticPng(BILL_SIZE) },
      },
    });
    expect(
      response.status(),
      `POST /api/v1/verifications/utility-bill/analysis must be accepted: ${await response.text()}`,
    ).toBe(HTTP_ACCEPTED);

    const row = await waitForCheck(request, session.sessionId, BILL_CHECK);
    expect(TERMINAL, `${BILL_CHECK} ended ${row.status}/${row.outcome}`).toContain(row.status);
    expect(row.outcome, `${BILL_CHECK} must carry the forced mock outcome`).toBe(FORCED_OUTCOME);
  });
});
