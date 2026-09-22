// MODB-MOCK-1 "demo identity picker + AML source links": the pieces the AC-MOCK API specs share.
//
// How a demo identity reaches AML (MODB-MOCK-1-SPEC.md §3.1): the portal never sends a name to AML. The picker sets
// the name the MOCK MRZ check returns, and the gateway's unchanged derivation (aml-screening.service.ts buildPayload)
// screens it. The form carries it beside `mock_outcomes` as the multipart field below. That field name and its JSON
// shape are the test's proposal for the contract; the gateway implementation must match it or change both.
//
// Sample identities come from ONE fixture the frontend owns, generated from real screenings (spec §3.2):
//   PROOViD/module-b/wt/wl-mvp-frontend/app/data/demo-identities.json  [{name,label,screeningId,classification,verifiedAt}]
// Override with MODB_DEMO_IDENTITIES_PATH. An ABSENT file is reported as a skip with the path; a present but malformed
// file FAILS.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { amlCase } from './modb-session-helpers.js';
import { amlGet, SPECIMEN_IDENTITY } from './modb-processing-trace.js';

export const DEMO_IDENTITIES_ENV = 'MODB_DEMO_IDENTITIES_PATH';
/** Proposed gateway form field: JSON `{"surname": string, "given_names": string[]}`, forwarded to the MRZ mock. */
export const MOCK_IDENTITY_FIELD = 'mock_identity';
const DEFAULT_FIXTURE = 'PROOViD/module-b/wt/wl-mvp-frontend/app/data/demo-identities.json';

export interface DemoIdentity {
  name: string;
  label: string;
  screeningId: string;
  classification: string;
  verifiedAt: string;
}

export function demoIdentitiesPath(): string {
  const override = process.env[DEMO_IDENTITIES_ENV]?.trim();
  // Playwright runs from E2ETests/, a sibling of PROOViD/ under the SaaS root.
  return override ? path.resolve(override) : path.resolve(process.cwd(), '..', DEFAULT_FIXTURE);
}

/** The committed sample identities, or null when the fixture file does not exist yet. */
export function loadDemoIdentities(): DemoIdentity[] | null {
  const file = demoIdentitiesPath();
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  // The curation script wraps the list as { generatedBy, sha256, identities }; a bare array is the older shape.
  const list = Array.isArray(parsed) ? parsed : (parsed as { identities?: unknown } | null)?.identities;
  expect(Array.isArray(list), `${file} must be a JSON array or { identities: [...] }`).toBe(true);
  const identities = list as DemoIdentity[];
  for (const [index, entry] of identities.entries()) {
    for (const key of ['name', 'label', 'screeningId', 'classification', 'verifiedAt'] as const) {
      expect(typeof entry[key] === 'string' && entry[key].trim() !== '', `${file}[${index}].${key}`).toBe(true);
    }
  }
  return identities;
}

export function fixtureAbsentReason(): string {
  return `demo identity fixture absent at ${demoIdentitiesPath()} (MODB-MOCK-1 frontend has not committed it)`;
}

/** The multipart field for a free-text or sample name: the last token is the MRZ surname, the rest are given names. */
export function mockIdentityFields(name: string): Record<string, string> {
  const tokens = name.trim().split(/\s+/);
  const surname = tokens[tokens.length - 1];
  return { [MOCK_IDENTITY_FIELD]: JSON.stringify({ surname, given_names: tokens.slice(0, -1) }) };
}

/** Order- and case-insensitive name tokens, so "Anna Maria Eriksson" equals "ERIKSSON ANNA MARIA". */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

export const SPECIMEN_TOKENS = nameTokens([...SPECIMEN_IDENTITY.given_names, SPECIMEN_IDENTITY.surname].join(' '));

/** The AML screening id the gateway recorded for a request (aml-case `data.screening_id`). */
export async function screeningIdOf(request: APIRequestContext, requestId: string): Promise<string> {
  const read = await amlCase(request, requestId);
  expect(read.status(), await read.text()).toBe(200);
  const screeningId = String((await read.json()).data?.screening_id ?? '');
  expect(screeningId, `aml-case of ${requestId} carries no screening_id`).not.toBe('');
  return screeningId;
}

/** The name AML actually screened, read from ITS case record (`GET /v1/cases/{id}` fullName), not from the form. */
export async function screenedName(request: APIRequestContext, screeningId: string): Promise<string> {
  const read = await amlGet(request, `/v1/cases/${screeningId}`);
  expect(read.status(), `GET /v1/cases/${screeningId}`).toBe(200);
  const body = (await read.json()) as { fullName?: unknown; subject?: { fullName?: unknown } };
  const fullName = body.fullName ?? body.subject?.fullName;
  expect(typeof fullName, `case ${screeningId} fullName`).toBe('string');
  return fullName as string;
}
