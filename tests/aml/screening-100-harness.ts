// AM-READY-10 D-10.6 — transport + bookkeeping for aml-screening-100-cases.spec.ts.
//
// 🔴 WHY THE BFF AND NOT AML_API_KEY. Every other aml-api spec posts straight to the API with a
// tenant key. That exercises the SERVER only. This suite goes the way the console goes: a real
// tester1 sign-in (the same /bff/passkey/login → aml-identity form the @ui spec drives), then
// POST /bff/api/aml/v1/screenings/check with the session cookie + `X-BFF-Csrf: 1`
// (apps/aml-v2/src/auth/amlBffAuth.ts:23-27,102-114) and the body buildScreenRequest() produces
// for a DEFAULT console form (apps/aml-v2/src/screens/screening/screenRequest.ts:98-153 +
// ScreeningForm.tsx:74-96). It still cannot see a client-side ReferenceError — the @ui smoke does.
//
// 🔴 ONE SIGN-IN PER RUN. A failed test tears the worker down and the next one re-runs beforeAll.
// With dozens of expected reds that would be dozens of logins against an IP-partitioned login rate
// limit, and the suite would report its own 429 as a product failure. The storage state is saved
// under ROUND_STATE_DIR keyed by the runner pid and reused while /bff/me still answers 200.
//
// 🔴 NOT UNDER test-results/: any other Playwright run empties it (a nextgame run wiped Round 1a).
// 🔴 A SLOW /bff/me IS NOT A DEAD SESSION: a throwing 10 s probe re-run per worker restart aborted Round 1b.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import type { ScreeningSubject } from './screening-100-corpus.js';

export const AML_WEB_ORIGIN = new URL(process.env.AML_WEB_URL ?? 'https://aml-screening.dloizides.com/app')
  .origin;
const TESTER_EMAIL = process.env.AML_TESTER_EMAIL?.trim() || null;
const TESTER_PASSWORD = process.env.AML_TESTER_PASSWORD?.trim() || null;
const IDP_HOST = process.env.AML_IDP_HOST?.trim() || 'aml-identity.dloizides.com';
export const HAS_TESTER = Boolean(TESTER_EMAIL && TESTER_PASSWORD);

const SCREEN_PATH = '/bff/api/aml/v1/screenings/check';
const ME_PATH = '/bff/me';
const CSRF = { 'X-BFF-Csrf': '1' };
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_TOO_MANY = 429;
const LOGIN_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Explicit, not the 10 s request default: Round 1b measured an 11.2 s /bff/me TTFB on a live session. */
const ME_PROBE_TIMEOUT_MS = 30_000;
/** One retry, on a timeout only — a wrong password must not be hammered against the login rate limit. */
const LOGIN_ATTEMPTS = 2;
const TIMEOUT_PATTERN = /timeout|timed out/i;

/** Rows JSONL + storage state: gitignored, OUTSIDE test-results/. run-aml-e2e.mjs pins cwd to E2ETests. */
export const ROUND_STATE_DIR = join(process.cwd(), '.aml-screening-100');

/** A per-run file: the worker's ppid is the Playwright runner, so worker restarts share it. */
export function runnerStateFile(name: string): string {
  return join(ROUND_STATE_DIR, `runner-${process.ppid}.${name}`);
}
const MAX_429_ATTEMPTS = 3;
const BACKOFF_MS = 2_000;
const MS_PER_S = 1000;

/** The success codes. The API answers 201 CREATED; 200 is accepted so a proxy rewrite is not a red. */
export const SUCCESS = new Set([HTTP_OK, HTTP_CREATED]);

/** The DEFAULT console form, as buildScreenRequest() serialises it (undefined fields dropped). */
const CONSOLE_DEFAULTS = {
  monitor: false,
  includeDiagnostics: true,
  threshold: 0.7,
  dobYearTolerance: 1,
  dobMismatchPenalty: 0.4,
  trigramFloor: 0.3,
  candidateLimit: 50,
  resultCap: 25,
  phonetic: true,
  nicknames: true,
  exactMatch: false,
  includeReasoning: true,
};

export function consoleScreenBody(subject: ScreeningSubject, adverseMedia: boolean): Record<string, unknown> {
  const nationality = subject.nationality ? { nationality: subject.nationality.toUpperCase() } : {};
  return { fullName: subject.fullName, ...nationality, adverseMedia, ...CONSOLE_DEFAULTS };
}

export const enum RowKind {
  Case = 'case',
  Stress = 'stress',
}

export interface CaseRow {
  readonly kind: RowKind;
  readonly id: string;
  readonly subject: string;
  readonly category: string;
  readonly adverseMedia: boolean;
  readonly status: number | null;
  readonly attempts: number;
  /** Wall time of the FINAL attempt only — 429 backoff sleep is never folded into a latency. */
  readonly latencyMs: number;
  readonly error: string | null;
  readonly amStatus: string | null;
  readonly hitCount: number | null;
  readonly isMatch: boolean | null;
  readonly decision: string | null;
  readonly shapeOk: boolean;
  /** Server-reported stage timings (`includeDiagnostics: true`), verbatim. */
  readonly diagnostics: unknown;
  readonly correlationId: string | null;
}

const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split('\n')[0];
const isTimeout = (error: unknown): boolean =>
  (error as Error)?.name === 'TimeoutError' || TIMEOUT_PATTERN.test(firstLine(error));

async function signIn(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const returnUrl = encodeURIComponent('/app/screening');
    await page.goto(`${AML_WEB_ORIGIN}/bff/passkey/login?returnUrl=${returnUrl}`, {
      waitUntil: 'domcontentloaded',
      timeout: LOGIN_TIMEOUT_MS,
    });
    await expect(page, `login did not reach the IdP (${IDP_HOST})`).toHaveURL(new RegExp(IDP_HOST));
    await page.locator('input#email, input[type="email"]').first().fill(TESTER_EMAIL ?? '');
    await page.locator('input#password, input[type="password"]').first().fill(TESTER_PASSWORD ?? '');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(url => url.origin === AML_WEB_ORIGIN, { timeout: LOGIN_TIMEOUT_MS });
    await page.close();
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

const enum SessionProbe { Alive, Rejected, Unreachable }

/** Session-lifecycle evidence goes to the report as an annotation (hooks included), not the console. */
function sessionNote(message: string): void {
  test.info().annotations.push({ type: 's100-session', description: message });
}

/** GET /bff/me. NEVER throws: a timeout / network error is "not alive" (logged), not a test crash. */
async function probeSession(context: BrowserContext): Promise<SessionProbe> {
  try {
    const me = await context.request.get(`${AML_WEB_ORIGIN}${ME_PATH}`, { headers: CSRF, timeout: ME_PROBE_TIMEOUT_MS });
    if (me.status() === HTTP_OK) return SessionProbe.Alive;
    sessionNote(`${ME_PATH} answered HTTP ${me.status()} — session not alive`);
    return SessionProbe.Rejected;
  } catch (error) {
    sessionNote(`${ME_PATH} probe failed (${firstLine(error)}) — session treated as not alive`);
    return SessionProbe.Unreachable;
  }
}

/** Sign in and prove it with /bff/me, retrying ONCE when either step times out. */
async function signInWithRetry(browser: Browser): Promise<BrowserContext> {
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= LOGIN_ATTEMPTS;
    let context: BrowserContext;
    try {
      context = await signIn(browser);
    } catch (error) {
      if (last || !isTimeout(error)) throw error;
      sessionNote(`sign-in attempt ${attempt} timed out (${firstLine(error)}) — retrying once`);
      continue;
    }
    const probe = await probeSession(context);
    if (probe === SessionProbe.Unreachable && !last) {
      await context.close();
      sessionNote(`post-sign-in ${ME_PATH} probe failed on attempt ${attempt} — retrying once`);
      continue;
    }
    // The hard precondition, unchanged: a fresh sign-in that /bff/me does not answer 200 is a red.
    expect(probe, 'signed-in precondition failed: /bff/me did not return 200').toBe(SessionProbe.Alive);
    return context;
  }
}

/** A signed-in tester1 context, reusing this run's saved session when it is still valid. */
export async function openSession(browser: Browser, stateFile: string): Promise<BrowserContext> {
  if (existsSync(stateFile)) {
    const reused = await browser.newContext({ storageState: stateFile });
    if ((await probeSession(reused)) === SessionProbe.Alive) return reused;
    await reused.close();
    sessionNote('saved session not reusable — signing in fresh');
  }
  const context = await signInWithRetry(browser);
  mkdirSync(dirname(stateFile), { recursive: true });
  await context.storageState({ path: stateFile });
  return context;
}

interface Attempt {
  readonly status: number | null;
  readonly body: Record<string, unknown> | null;
  readonly error: string | null;
  readonly latencyMs: number;
}

async function attempt(ctx: APIRequestContext, body: Record<string, unknown>): Promise<Attempt> {
  const started = Date.now();
  try {
    const res = await ctx.post(`${AML_WEB_ORIGIN}${SCREEN_PATH}`, {
      data: body,
      headers: { ...CSRF, 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const status = res.status();
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null; // a non-JSON body (proxy error page) — the status names it
    }
    return { status, body: parsed, error: null, latencyMs: Date.now() - started };
  } catch (error) {
    return { status: null, body: null, error: (error as Error).message, latencyMs: Date.now() - started };
  }
}

function shapeOk(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const typed =
    typeof body.id === 'string' && typeof body.isMatch === 'boolean' && typeof body.decision === 'string';
  return typed && Array.isArray(body.matchedEntities) && 'adverseMediaStatus' in body;
}

/**
 * Screen one subject. Retries ONLY a 429 (a throttle is not the product's answer) and only for
 * the sequential cases — the stress test takes one attempt, so a 429 under load is a counted error.
 * A 5xx or a timeout is never retried: it is the finding.
 */
export async function screenCase(
  ctx: APIRequestContext,
  subject: ScreeningSubject,
  adverseMedia: boolean,
  kind: RowKind,
): Promise<CaseRow> {
  const body = consoleScreenBody(subject, adverseMedia);
  const maxAttempts = kind === RowKind.Stress ? 1 : MAX_429_ATTEMPTS;
  let result = await attempt(ctx, body);
  let attempts = 1;
  while (result.status === HTTP_TOO_MANY && attempts < maxAttempts) {
    await sleep(BACKOFF_MS * attempts);
    result = await attempt(ctx, body);
    attempts += 1;
  }
  const served = result.body ?? {};
  const matched = Array.isArray(served.matchedEntities) ? served.matchedEntities.length : null;
  return {
    kind,
    id: subject.id,
    subject: subject.fullName,
    category: subject.category,
    adverseMedia,
    status: result.status,
    attempts,
    latencyMs: result.latencyMs,
    error: result.error,
    amStatus: typeof served.adverseMediaStatus === 'string' ? served.adverseMediaStatus : null,
    hitCount: matched,
    isMatch: typeof served.isMatch === 'boolean' ? served.isMatch : null,
    decision: typeof served.decision === 'string' ? served.decision : null,
    shapeOk: shapeOk(result.body),
    diagnostics: served.diagnostics ?? null,
    correlationId: typeof served.correlationId === 'string' ? served.correlationId : null,
  };
}

export function appendRow(file: string, row: CaseRow): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

export function readRows(file: string): CaseRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as CaseRow);
}

export const seconds = (ms: number): string => `${(ms / MS_PER_S).toFixed(2)}s`;

/**
 * Write the round's results. `test-results/` is what the brief names, but Playwright EMPTIES it at
 * the start of every run — so the same file is mirrored to `reports/aml-screening-100/`, which is
 * where rounds are diffed from.
 */
export function writeRound(summary: Record<string, unknown>): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targets = ['test-results', 'reports'].map(dir =>
    join(process.cwd(), dir, 'aml-screening-100', `round-${stamp}.json`),
  );
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(summary, null, 2));
  }
  return targets;
}
