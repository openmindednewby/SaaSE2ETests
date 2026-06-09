import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Anonymous (no-auth) client for the Questioner API's PUBLIC respondent
 * endpoints.
 *
 * These endpoints are NOT behind the BFF and NOT under the admin `/api/v1`
 * prefix — they sit at the ROOT path of the questioner API host:
 *
 *   GET  {base}/api/v1/public/questionerTemplates/{externalId}
 *   POST {base}/api/v1/public/questionerTemplates/{externalId}/responses
 *
 * The client deliberately carries NO Authorization header and NO cookies, so a
 * spec can prove the respondent flow works for a fully anonymous browser/client.
 * It mirrors the idiom in
 * `tests/cross-product-isolation/response-sanitization.spec.ts`:
 * `request.newContext({ baseURL, ignoreHTTPSErrors: true })`.
 */

const DEFAULT_QUESTIONER_API_URL = 'https://localhost:5004';
const API_TIMEOUT_MS = 30_000;

/**
 * Resolve the questioner API host root (no `/api/v1`, no trailing slash).
 * Reads `QUESTIONER_API_URL` (set per-target in `.env.<target>`), falling back
 * to the local Docker HTTPS host.
 */
export function resolveQuestionerApiBase(): string {
  const value = process.env.QUESTIONER_API_URL;
  const base = value && value.trim().length > 0 ? value.trim() : DEFAULT_QUESTIONER_API_URL;
  return base.replace(/\/+$/, '');
}

/** A respondent-safe question option. */
export interface PublicQuestionOption {
  label: string;
  value: string;
}

/** A respondent answer payload — only one value field is populated per question. */
export interface PublicQuestionAnswer {
  boolValue?: boolean | null;
  stringValue?: string | null;
  numericValue?: number | null;
  multiValues?: string[] | null;
}

/**
 * A question as returned by the PUBLIC GET endpoint. The correct `answer` is
 * stripped server-side for respondents, so it should be null/absent here.
 */
export interface PublicQuestion {
  id: string;
  name: string;
  type: number;
  options?: PublicQuestionOption[] | null;
  page: number;
  order: number;
  isRequired: boolean;
  answer?: PublicQuestionAnswer | null;
}

export interface PublicQuestionerContents {
  questions: PublicQuestion[];
}

/** Shape of the PUBLIC GET response. */
export interface PublicTemplateResponse {
  externalId: string;
  name: string;
  description: string | null;
  contents: PublicQuestionerContents;
}

/** Shape of the PUBLIC POST (submit response) response. */
export interface PublicSubmitResponse {
  externalId: string;
}

/** A raw fetch result keeping the status so 404 cases can be asserted. */
export interface RawResult<T> {
  status: number;
  body: T | null;
  rawText: string;
}

/**
 * Create a fresh anonymous APIRequestContext bound to the questioner API root.
 * Callers MUST `dispose()` it when done (use try/finally).
 */
export async function createAnonymousQuestionerContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: resolveQuestionerApiBase(),
    ignoreHTTPSErrors: true,
    timeout: API_TIMEOUT_MS,
  });
}

/**
 * GET the public, respondent-safe view of a template. Returns the status so a
 * spec can assert 200 (active) vs 404 (missing/inactive) without throwing.
 */
export async function getPublicTemplate(
  api: APIRequestContext,
  externalId: string,
): Promise<RawResult<PublicTemplateResponse>> {
  const response = await api.get(`/api/v1/public/questionerTemplates/${externalId}`, {
    failOnStatusCode: false,
  });
  const rawText = await response.text().catch(() => '');
  const body = parseJson<PublicTemplateResponse>(rawText);
  return { status: response.status(), body, rawText };
}

/**
 * POST an anonymous response (answer set) to a public template. Returns the
 * status so a spec can assert 200 (active) vs 404 (inactive).
 */
export async function submitPublicResponse(
  api: APIRequestContext,
  externalId: string,
  payload: { name?: string; description?: string | null; contents: PublicQuestionerContents },
): Promise<RawResult<PublicSubmitResponse>> {
  const response = await api.post(`/api/v1/public/questionerTemplates/${externalId}/responses`, {
    data: payload,
    failOnStatusCode: false,
  });
  const rawText = await response.text().catch(() => '');
  const body = parseJson<PublicSubmitResponse>(rawText);
  return { status: response.status(), body, rawText };
}

function parseJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
