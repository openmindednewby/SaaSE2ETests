// Zygos session management (ZY-18) — minting, caching and reusing BFF sessions.
//
// Split from `zygos-helpers.ts` on a real seam (that file is capped at 300 lines): helpers owns
// the constants and pure utilities, this owns everything stateful about being logged in.
//
// 🔴 THE LOGIN BUDGET IS FIVE REQUESTS PER SIXTY SECONDS, PER IP — and it is the reason this
// file exists at all. See `loginAs` below before changing anything here.
import fs from 'fs';
import path from 'path';

import { expect, request as playwrightRequest } from '@playwright/test';

import { ZYGOS_API_PREFIX, ZYGOS_TEST_PASSWORD, ZYGOS_WEB_URL, jsonCsrfHeaders } from './zygos-helpers.js';

import type { APIRequestContext } from '@playwright/test';

/** One authenticated console session: a cookie jar + the origin, exactly like the browser has. */
export interface ZygosSession {
  readonly username: string;
  readonly context: APIRequestContext;
  dispose(): Promise<void>;
}

/**
 * 🔴 THE LOGIN BUDGET IS FIVE REQUESTS PER SIXTY SECONDS, PER IP.
 *
 * `/bff/login` runs the shared `RateLimitPolicies.Auth` policy: a sliding window,
 * `PermitLimit = 5` per 60s, partitioned by client IP (RateLimiting.Defaults). Every spec in
 * this suite comes from ONE IP, so the budget is shared by the entire run — it is not per-user
 * and not per-file.
 *
 * This was not theoretical. Building this suite, a `beforeAll` per spec file blew the budget
 * within seconds and `/bff/login` began returning 429 for everything. Because the first version
 * of this function mapped *any* failure to `null`, and every spec did
 * `test.skip(!session, 'console unreachable')`, the result was **12 tests silently skipping and
 * the run reporting green.** A rate limit was wearing "the environment isn't deployed" as a
 * disguise. That is the exact false-green this suite exists to prevent, produced by the suite
 * itself.
 *
 * Hence two rules, both load-bearing:
 *
 *   1. **Sessions are minted once and shared.** A BFF session cookie stays valid; re-authing per
 *      test buys nothing and costs the budget. Four fixture users ⇒ four logins per worker.
 *   2. **A 429 is never a skip.** It is retried (the window is 60s, so it always clears), and if
 *      it will not clear, `loginAs` THROWS. A rate limit is a real condition the run must
 *      surface, not absorb.
 */
const sessionCache = new Map<string, ZygosSession>();

/**
 * Where a minted session cookie is parked so it survives worker restarts.
 *
 * 🔴 THIS IS NOT AN OPTIMISATION — it is what makes the suite runnable at all.
 *
 * An in-memory cache alone is not enough: Playwright restarts the worker process after a test
 * fails, which drops module state. With 4 fixture users and a 5-per-60s budget, ONE failure ⇒
 * 4 fresh logins ⇒ 429 ⇒ every later spec fails to authenticate. A red test would cascade into
 * a suite-wide auth outage, and the cascade would look like a product bug.
 *
 * Worse, retrying does not help: the limiter is a SLIDING window, so polling every second keeps
 * the window permanently saturated and the budget never recovers. The retry defeats itself. (The
 * first version of this file did exactly that and timed out after 90s of self-inflicted 429s.)
 *
 * So: log in once, persist the cookie, reuse it everywhere — the standard Playwright
 * storageState pattern, and the platform's existing convention (`playwright/.auth/`, gitignored).
 */
const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth');

function statePath(username: string): string {
  return path.join(AUTH_DIR, `zygos-${username}.json`);
}

/** Build a context from a parked cookie, and prove it still works. Null if stale/absent. */
async function restoreSession(username: string): Promise<ZygosSession | null> {
  const file = statePath(username);
  if (!fs.existsSync(file)) return null;

  const context = await playwrightRequest.newContext({ baseURL: ZYGOS_WEB_URL, storageState: file });
  try {
    // Verify against a real authenticated endpoint. A parked cookie that silently expired would
    // otherwise turn every downstream assertion into a confusing 401.
    const probe = await context.get(`${ZYGOS_API_PREFIX}/payment-instructions?pageSize=1`, { timeout: 15_000 });
    if (probe.ok()) return { username, context, dispose: () => context.dispose() };
  } catch {
    /* fall through — treat as stale */
  }
  await context.dispose();
  return null;
}

/** Distinguishes the three outcomes that must never be conflated. */
type LoginOutcome =
  | { kind: 'ok'; session: ZygosSession }
  /** The credentials were genuinely rejected. Deterministic — do not retry. */
  | { kind: 'rejected' }
  /** Rate limited. Transient — retry. */
  | { kind: 'throttled' }
  /** The console could not be reached at all. A legitimate reason to skip. */
  | { kind: 'unreachable' };

async function attemptLogin(username: string, password: string): Promise<LoginOutcome> {
  // ignoreHTTPSErrors is deliberately NOT set: app.zygos.dloizides.com is a real Let's Encrypt
  // host, so a bad cert is a genuine failure worth seeing rather than papering over.
  const context = await playwrightRequest.newContext({ baseURL: ZYGOS_WEB_URL });
  try {
    const res = await context.post('/bff/login', {
      headers: jsonCsrfHeaders(),
      data: { username, password },
      timeout: 20_000,
    });
    if (res.ok()) return { kind: 'ok', session: { username, context, dispose: () => context.dispose() } };

    await context.dispose();
    if (res.status() === 429) return { kind: 'throttled' };
    // 401/403 — a real answer from a reachable server.
    if (res.status() === 401 || res.status() === 400 || res.status() === 403) return { kind: 'rejected' };
    return { kind: 'unreachable' };
  } catch {
    await context.dispose();
    return { kind: 'unreachable' };
  }
}

/**
 * Log a fixture user in through the REAL `/bff/login`, reusing a cached session when one exists.
 *
 * Returns null ONLY when the console is unreachable or the credentials are genuinely rejected —
 * both legitimate `test.skip` reasons. THROWS on a rate limit that will not clear, because a
 * silent skip there is a lie (see the note above).
 */
export async function loginAs(username: string, password = ZYGOS_TEST_PASSWORD): Promise<ZygosSession | null> {
  const cached = sessionCache.get(username);
  if (cached) return cached;

  // Survives worker restarts — see AUTH_DIR. Costs zero login budget.
  const restored = await restoreSession(username);
  if (restored) {
    sessionCache.set(username, restored);
    return restored;
  }

  // A holder, not a bare `let`: TS narrows a `let` to its initializer's literal type and then
  // cannot see the assignments made inside the poll closure, so `outcome.kind !== 'ok'` below
  // would be flagged as a comparison with no overlap.
  const result: { outcome: LoginOutcome } = { outcome: { kind: 'throttled' } };

  // Only reached when there is genuinely no usable parked cookie.
  //
  // The intervals are LONG and few on purpose. The limiter is a 60s SLIDING window, so a tight
  // retry loop keeps it saturated and never recovers — the retry has to be quieter than the
  // window is wide. `expect.poll` rather than a hand-rolled setTimeout because E2ETests'
  // `no-set-timeout-in-promise` rule bans the latter and poll is the sanctioned primitive.
  //
  // This is NOT a fixed sleep masking a race: it waits out a documented, server-declared rate
  // limit and stops the instant login succeeds.
  await expect
    .poll(
      async () => {
        result.outcome = await attemptLogin(username, password);
        return result.outcome.kind;
      },
      {
        timeout: 150_000,
        intervals: [20_000, 30_000, 30_000, 30_000],
        message:
          `/bff/login for ${username} kept returning 429. The Auth policy is 5 requests/60s PER IP and is ` +
          `shared by the whole run — if this fires, the suite is authenticating too often (every session ` +
          `should come from the cache or playwright/.auth/). This is deliberately a FAILURE, not a skip: ` +
          `a throttle must never masquerade as "the console is not deployed".`,
      },
    )
    .not.toBe('throttled');

  const { outcome } = result;
  if (outcome.kind !== 'ok') return null;

  // Park the cookie so no other file/worker pays for this login again.
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await outcome.session.context.storageState({ path: statePath(username) });
  } catch {
    /* a cache miss is survivable; a crash here would not be */
  }

  sessionCache.set(username, outcome.session);
  return outcome.session;
}

/**
 * Attempt a login and report WHICH of the four things happened, without caching or retrying.
 *
 * 🔴 Exists because `null` is ambiguous and the ambiguity is dangerous. "Bad credentials do not
 * establish a session" asserts a login FAILS — and a 429 also fails. A test that accepts any
 * falsy result passes when the server is throttling and the credential check is broken: a green
 * test for a wide-open door. Callers that assert a REJECTION must assert `kind === 'rejected'`,
 * never merely "no session".
 */
export async function loginOutcome(username: string, password: string): Promise<LoginOutcome> {
  return attemptLogin(username, password);
}

/**
 * Mint a session WITHOUT the cache — for tests that must observe a fresh login or kill a session
 * (logout). Rides out a throttle like `loginAs` does; give the caller a generous timeout.
 */
export async function loginFresh(username: string, password = ZYGOS_TEST_PASSWORD): Promise<ZygosSession | null> {
  const result: { outcome: LoginOutcome } = { outcome: { kind: 'throttled' } };

  await expect
    .poll(
      async () => {
        result.outcome = await attemptLogin(username, password);
        return result.outcome.kind;
      },
      {
        timeout: 150_000,
        intervals: [20_000, 30_000, 30_000, 30_000],
        message: `/bff/login for ${username} kept returning 429 (Auth policy: 5 req/60s per IP).`,
      },
    )
    .not.toBe('throttled');

  const { outcome } = result;
  return outcome.kind === 'ok' ? outcome.session : null;
}

/** Drop every cached session. Call from a top-level afterAll, never mid-run. */
export async function disposeCachedSessions(): Promise<void> {
  await Promise.all([...sessionCache.values()].map((s) => s.dispose()));
  sessionCache.clear();
}

/** A Playwright-shaped cookie, as parked in a storageState file. */
export interface ParkedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/**
 * The session cookie for `username`, ready to inject into a BROWSER context.
 *
 * Why the @ui tier uses this instead of typing into the login form every time:
 *
 * The login budget (5/60s per IP) is shared by BOTH tiers. A UI tier that logs in per test needs
 * ~7 logins and reliably 429s — at which point every UI test fails at the login screen and the
 * whole tier reports a product bug that is really a self-inflicted throttle.
 *
 * So the login FORM is exercised where it is the subject (the login/logout test, the bad-creds
 * test), and every other UI test injects an already-minted session and gets on with testing the
 * screen it is actually about. The session is real and server-issued either way — nothing is
 * faked; the only thing skipped is retyping a password the login test already proved works.
 */
export async function parkedCookies(username: string): Promise<ParkedCookie[]> {
  // Ensure a session exists and is parked (costs nothing when cached).
  const session = await loginAs(username);
  if (!session) return [];

  const state = await session.context.storageState();
  return state.cookies as ParkedCookie[];
}

/** An anonymous context — for the "no cookie ⇒ 401" leg. */
export async function anonymousContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: ZYGOS_WEB_URL });
}
