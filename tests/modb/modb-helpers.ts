// MODB-2 task 6b — helpers for the API-driven Module B gateway <-> mocks <-> AML suite.
//
// Target: the wl-api-gateway directly (staging NodePort over WireGuard). The public
// https://modb-staging.dloizides.com routes /api/v1 to the Next.js frontend, so it is NOT an API
// target. Every request carries a per-request `mock_outcomes` map (gateway flag
// VERIFICATION_MOCK_OUTCOMES_ENABLED, mock `Scenarios/RequestOutcomes.cs`), so outcomes are
// deterministic without redeploying. Images are synthetic solid-colour PNGs; the MRZ mock returns
// the synthetic ERIKSSON / UTO specimen. No personal data leaves this file.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

export const MODB_GATEWAY_URL = (process.env.MODB_GATEWAY_URL ?? 'http://10.0.0.2:30610').replace(/\/$/, '');
/** sync | async | queue — the gateway's AML_INTEGRATION_MODE this run gates. Queue is the standing mode (D-INT-13). */
export const MODB_AML_MODE = process.env.MODB_AML_MODE ?? 'queue';
const API = `${MODB_GATEWAY_URL}/api/v1`;

export const AML_CHECK = 'aml_screening';
export const MRZ_CHECK = 'mrz_match';
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
export const AML_DECISIONS = ['Pass', 'Review', 'Fail'];
/** `adverse_media_status` contract (gateway `aml-case-response.dto.ts`): only `Ok` means adverse media was checked. */
export const ADVERSE_MEDIA_STATUSES = ['Skipped', 'Ok', 'Stale', 'Unavailable', 'NotReported'];

// Bounded by the npm script --timeout=240000 (config default is 30s; (e) settles two requests).
const SETTLE_TIMEOUT_MS = 90_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const HTTP_ACCEPTED = 202;
// The WireGuard hop to staging is ~300ms RTT and spikes; the config's 10s request default flaked a cold GET.
const REQUEST_TIMEOUT_MS = 30_000;
// Capture-quality gates reject a document under 1200x800 and a utility bill under 1600x1200 before any mock runs.
const DOC_SIZE = [1200, 800] as const;
const BILL_SIZE = [1600, 1200] as const;
const IMAGE_RGB = [180, 190, 200];
/** CHECK_PROVIDER_SOURCES on staging (MODB-2-INT-checklist Q4 evidence): every dispatched check is a mock, AML is live. */
export const SOURCE_BY_CHECK: Record<string, 'mock' | 'live'> = {
  liveness: 'mock',
  face_match: 'mock',
  mrz_match: 'mock',
  utility_extraction: 'mock',
  utility_bill_authenticity: 'mock',
  utility_authenticity: 'mock',
  aml_screening: 'live',
};

export type MockOutcome = 'passed' | 'review' | 'failed' | 'check_failed' | 'no_callback';

export interface CheckRow {
  request_id: string;
  check_type: string;
  status: string;
  outcome: string | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  attempt_count: number;
  source?: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** A synthetic solid-colour PNG at a capture-quality minimum. */
function syntheticPng([width, height]: readonly [number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit depth, RGB, deflate, no filter, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(IMAGE_RGB).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Built once per worker. */
const DOC_PNG = syntheticPng(DOC_SIZE);
const BILL_PNG = syntheticPng(BILL_SIZE);

function image(name: string, buffer: Buffer = DOC_PNG) {
  return { name, mimeType: 'image/png', buffer };
}

/** Hard reachability probe. The suite FAILS when the gateway is down: an all-skip run observes nothing. */
export async function assertGatewayReachable(request: APIRequestContext): Promise<void> {
  const probe = await request.get(`${API}/checks/${randomUUID()}`, { failOnStatusCode: false, timeout: REQUEST_TIMEOUT_MS });
  expect(probe.status(), `gateway at ${MODB_GATEWAY_URL} must answer an unknown request id with 404`).toBe(404);
  // GET /checks/:id answers NOT_FOUND (the aml-case route answers VERIFICATION_NOT_FOUND); either proves the API.
  expect((await probe.json()).error?.code).toBe('NOT_FOUND');
}

/**
 * POST /api/v1/verifications with the given checks (default: MRZ only) and a per-request mock outcome map.
 * A utility bill is attached only when a utility check is requested. Returns the request id.
 */
export async function submitVerification(
  request: APIRequestContext,
  mockOutcomes: Partial<Record<string, MockOutcome>>,
  checkTypes: readonly string[] = [MRZ_CHECK],
): Promise<string> {
  const requestId = randomUUID();
  const needsBill = checkTypes.some((checkType) => checkType.startsWith('utility_'));
  const response = await request.post(`${API}/verifications`, {
    headers: { 'x-request-id': requestId },
    timeout: REQUEST_TIMEOUT_MS,
    multipart: {
      check_types: checkTypes.join(','),
      document_type: 'identity_card',
      model: 'sface',
      mock_outcomes: JSON.stringify(mockOutcomes),
      document_front: image('front.png'),
      document_back: image('back.png'),
      selfie: image('selfie.png'),
      ...(needsBill ? { utility_bill: image('bill.png', BILL_PNG) } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(HTTP_ACCEPTED);
  expect((await response.json()).meta.request_id).toBe(requestId);
  return requestId;
}

/**
 * Bounded poll (no sleeps) until the AML row exists and every row is terminal, except the checks named in
 * `stillPending` (no_callback checks, which stay non-terminal for ~3 h). Returns every check row.
 */
export async function waitForSettled(
  request: APIRequestContext,
  requestId: string,
  stillPending: readonly string[] = [],
): Promise<CheckRow[]> {
  let rows: CheckRow[] = [];
  let last = 'never polled';
  await expect
    .poll(
      async () => {
        const response = await request
          .get(`${API}/checks/${requestId}`, { timeout: REQUEST_TIMEOUT_MS })
          .catch((error: Error) => error);
        if (response instanceof Error) return `transport-error: ${response.message.split(/\r?\n/)[0]}`;
        expect(response.status()).toBe(200);
        rows = (await response.json()).data as CheckRow[];
        last = rows.map((row) => `${row.check_type}:${row.status}/${row.attempt_count}`).join(',');
        if (!rows.some((row) => row.check_type === AML_CHECK)) return 'aml row absent';
        const open = rows.filter((row) => !TERMINAL_STATUSES.includes(row.status) && !stillPending.includes(row.check_type));
        return open.length === 0 ? 'settled' : open.map((row) => `${row.check_type}:${row.status}`).join(',');
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: POLL_INTERVALS_MS, message: `checks of ${requestId} never settled (last: ${last})` },
    )
    .toBe('settled');
  return rows;
}

/** Bounded poll (no sleeps) until the AML row exists and is terminal. Returns every check row. */
export async function waitForAmlTerminal(request: APIRequestContext, requestId: string): Promise<CheckRow[]> {
  let rows: CheckRow[] = [];
  await expect
    .poll(
      async () => {
        // A dropped socket on the WireGuard hop (ECONNRESET, seen 2 of 4 runs on the first poll) is retried
        // inside the bound; a wrong status code still fails immediately via the expect below.
        const response = await request
          .get(`${API}/checks/${requestId}`, { timeout: REQUEST_TIMEOUT_MS })
          .catch((error: Error) => error);
        if (response instanceof Error) return `transport-error: ${response.message.split(/\r?\n/)[0]}`;
        expect(response.status()).toBe(200);
        rows = (await response.json()).data as CheckRow[];
        return rows.find((row) => row.check_type === AML_CHECK)?.status ?? 'absent';
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: POLL_INTERVALS_MS, message: `AML row of ${requestId} never settled` },
    )
    .toMatch(new RegExp(`^(${TERMINAL_STATUSES.join('|')})$`));
  return rows;
}

export function rowOf(rows: CheckRow[], checkType: string): CheckRow {
  const row = rows.find((candidate) => candidate.check_type === checkType);
  expect(row, `no ${checkType} row`).toBeDefined();
  return row as CheckRow;
}

export function getAmlCase(request: APIRequestContext, requestId: string): Promise<APIResponse> {
  return request.get(`${API}/checks/${requestId}/aml-case`, { failOnStatusCode: false, timeout: REQUEST_TIMEOUT_MS });
}
