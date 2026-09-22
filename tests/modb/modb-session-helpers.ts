// MODB-E2E-SESSION-1 "Session-based AML smoke test" — helpers for the CURRENT session API of wl-api-gateway.
//
// Separate from modb-helpers.ts on purpose: that file drives the legacy `POST /api/v1/verifications`, whose
// disappearance is the open question MODB-ENDPOINT-1, and its acceptance specs are locked. This file drives the
// buyer/SDK session flow that exists on the deployed gateway (`3685be2`):
//   POST /api/v1/identity-verification/sessions   (buyer, x-api-key: CLIENT_API_KEY)
//   GET  /api/v1/verification-sessions/current    (browser, Bearer sdk token)
//   POST /api/v1/verifications/document           (browser, multipart)
//   GET  /api/v1/verifications/current            (browser, applicant progress)
//   GET  /api/internal/v1/checks/sessions/:id     (operator, x-internal-token)
// Images are synthetic solid-colour PNGs; the MRZ mock answers with its ERIKSSON / UTO specimen. No personal data.
import { deflateSync } from 'node:zlib';
import { expect, type APIRequestContext } from '@playwright/test';
import { resolveGatewayUrl } from './modb-guards.js';

/** Buyer API key (gateway CLIENT_API_KEY). Unset = the session API cannot be exercised at all. */
export const CLIENT_KEY_ENV = 'MODB_CLIENT_API_KEY';
/** Operator token (gateway INTERNAL_API_TOKEN) for reading the check rows of a session. */
export const INTERNAL_TOKEN_ENV = 'MODB_INTERNAL_TOKEN';

export const AML_CHECK = 'aml_screening';
export const MRZ_CHECK = 'mrz_match';
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const REQUEST_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 120_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const DOC_SIZE = [1200, 800] as const;
const IMAGE_RGB = [180, 190, 200];

export interface SessionHandle {
  sessionId: string;
  verificationId: string;
  applicantId: string;
  flowId: string;
  token: string;
}

export interface CheckRow {
  request_id: string;
  check_type: string;
  status: string;
  outcome: string | null;
  session_id?: string | null;
  error?: { code: string; message: string } | null;
}

function api(): string {
  return `${resolveGatewayUrl(process.env)}/api`;
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

/** A synthetic solid-colour PNG above the gateway's 1100x720 document capture-quality floor. */
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

const DOC_PNG = syntheticPng(DOC_SIZE);

function image(name: string) {
  return { name, mimeType: 'image/png', buffer: DOC_PNG };
}

/** The buyer key of this run, or null when it is unset (every session test then skips with that reason). */
export function clientApiKey(): string | null {
  return process.env[CLIENT_KEY_ENV]?.trim() || null;
}

/** The operator token of this run, or null when it is unset. */
export function internalToken(): string | null {
  return process.env[INTERNAL_TOKEN_ENV]?.trim() || null;
}

/** Creates a buyer session for `flowId` and returns its ids plus the browser SDK token. */
export async function createSession(
  request: APIRequestContext,
  flowId: string,
  externalApplicantId: string,
): Promise<SessionHandle> {
  const response = await request.post(`${api()}/v1/identity-verification/sessions`, {
    headers: { 'x-api-key': clientApiKey() ?? '' },
    data: { externalApplicantId, flowId },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(
    response.status(),
    `POST /api/v1/identity-verification/sessions (${flowId}) must create a session: ${await response.text()}`,
  ).toBe(HTTP_OK);
  const body = await response.json();
  return {
    sessionId: body.sessionId,
    verificationId: body.verificationId,
    applicantId: body.applicantId,
    flowId: body.flowId,
    token: body.access.token,
  };
}

/** The browser-safe flow configuration bound to the SDK token; the step order lives here. */
export async function sessionConfiguration(
  request: APIRequestContext,
  session: SessionHandle,
): Promise<{ steps: string[]; flow_id: string; session_id: string }> {
  const response = await request.get(`${api()}/v1/verification-sessions/current`, {
    headers: { Authorization: `Bearer ${session.token}` },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(response.status(), `GET /api/v1/verification-sessions/current: ${await response.text()}`).toBe(HTTP_OK);
  return (await response.json()).data;
}

/** Submits the document step of a session. Returns the gateway request id of that step. */
export async function submitDocument(
  request: APIRequestContext,
  session: SessionHandle,
  documentType = 'identity_card',
): Promise<string> {
  const response = await request.post(`${api()}/v1/verifications/document`, {
    headers: { Authorization: `Bearer ${session.token}` },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
    multipart: {
      document_type: documentType,
      document_front: image('front.png'),
      document_back: image('back.png'),
    },
  });
  expect(response.status(), `POST /api/v1/verifications/document: ${await response.text()}`).toBe(HTTP_ACCEPTED);
  return (await response.json()).meta.request_id;
}

/** Every check row of one session, read through the operator API. */
export async function sessionChecks(request: APIRequestContext, sessionId: string): Promise<CheckRow[]> {
  const response = await request.get(`${api()}/internal/v1/checks/sessions/${sessionId}`, {
    headers: { 'x-internal-token': internalToken() ?? '' },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(response.status(), `GET /api/internal/v1/checks/sessions/${sessionId}: ${await response.text()}`).toBe(HTTP_OK);
  return (await response.json()).data as CheckRow[];
}

/** Bounded poll (no sleeps) until the session's aml_screening row exists and is terminal. Returns every row. */
export async function waitForAmlTerminal(request: APIRequestContext, sessionId: string): Promise<CheckRow[]> {
  let rows: CheckRow[] = [];
  await expect
    .poll(
      async () => {
        // The WireGuard hop to staging drops the odd socket; a transport error is retried inside the bound.
        const result = await sessionChecks(request, sessionId).catch((error: Error) => error);
        if (result instanceof Error) return `transport-error: ${result.message.split(/\r?\n/)[0]}`;
        rows = result;
        const aml = rows.find((row) => row.check_type === AML_CHECK);
        const seen = rows.map((row) => `${row.check_type}:${row.status}`).join(',') || 'no rows';
        if (!aml) return `no ${AML_CHECK} row (${seen})`;
        return TERMINAL_STATUSES.includes(aml.status) ? 'terminal' : `${AML_CHECK}:${aml.status}`;
      },
      {
        timeout: SETTLE_TIMEOUT_MS,
        intervals: POLL_INTERVALS_MS,
        message: `the ${AML_CHECK} check of session ${sessionId} never reached a terminal state`,
      },
    )
    .toBe('terminal');
  return rows;
}

/** The applicant progress state the browser sees: not_started | processing | retry_required | complete. */
export async function progressState(request: APIRequestContext, session: SessionHandle): Promise<string> {
  const response = await request.get(`${api()}/v1/verifications/current`, {
    headers: { Authorization: `Bearer ${session.token}` },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(response.status(), `GET /api/v1/verifications/current: ${await response.text()}`).toBe(HTTP_OK);
  return (await response.json()).data.state as string;
}

export function rowOf(rows: CheckRow[], checkType: string): CheckRow {
  const row = rows.find((candidate) => candidate.check_type === checkType);
  const seen = rows.map((candidate) => candidate.check_type).join(',') || 'none';
  expect(row, `the session must carry a ${checkType} row; rows present: ${seen}`).toBeTruthy();
  return row as CheckRow;
}
