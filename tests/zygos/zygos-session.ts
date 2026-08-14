// Zygos session management (ZY-18) — minting, caching and reusing BFF sessions.
//
// Split from `zygos-helpers.ts` on a real seam (that file is capped at 300 lines): helpers owns
// the constants and pure utilities, this owns everything stateful about being logged in.
//
// 🔴 THE LOGIN BUDGET IS FIVE REQUESTS PER SIXTY SECONDS, PER IP — and it is the reason this
// file exists at all. See `loginAs` below before changing anything here.
//
/* eslint-disable max-file-lines/max-file-lines -- This file is already the RESULT of applying the
 * rule: it was split out of `zygos-helpers.ts` on a real seam (helpers = constants + pure
 * utilities, this = everything stateful about being logged in). It is over the 300-line limit
 * because roughly half of it is prose explaining two rate limiters (5 logins/60s per IP, 100
 * API calls/60s per user) whose behaviour has already caused false-green tests — deleting that
 * commentary to satisfy a line count would remove the most valuable thing here.
 *
 * The remaining seams are all bad ones: session minting, the cookie cache and the backoff proxy
 * share the login budget as hidden state, so splitting them again would put a single invariant
 * in three files and invite exactly the "the retry defeats itself" bug documented below. Revisit
 * if a genuinely independent concern lands here. Mirrors the same justified disable on the
 * shared `E2ETests/shared/testIds` barrel. */
import fs from 'fs';
import path from 'path';

import { expect, request as playwrightRequest } from '@playwright/test';

import {
  DEMO_MASTER_TENANT_ID,
  MERCHANT_MATCHER,
  ZYGOS_API_PREFIX,
  ZYGOS_TEST_PASSWORD,
  ZYGOS_WEB_URL,
  jsonCsrfHeaders,
  merchantAccount,
} from './zygos-helpers.js';

import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { DemoAccount } from './zygos-helpers.js';

/** One authenticated console session: a cookie jar + the origin, exactly like the browser has. */
export interface ZygosSession {
  readonly username: string;
  readonly context: APIRequestContext;
  dispose(): Promise<void>;
}

/** Bounded — a 429 that never clears is a real defect and must still fail the run. */
const RATE_LIMIT_MAX_RETRIES = 5;
/**
 * ⚠️ EXPONENTIAL, and that is not decoration — it is this file's own warning applied to itself.
 *
 * `loginAs` below records that the limiter is a **SLIDING** window, so a tight retry loop keeps
 * the window permanently saturated and the budget never recovers: *"the retry defeats itself"*.
 * A flat 2s poll against a 60s/100 window is exactly that mistake. Backing off 2→4→8→16→32s
 * (62s total) outlives the window, so the budget genuinely ages out.
 */
const RATE_LIMIT_BASE_WAIT_MS = 2_000;
const TOO_MANY_REQUESTS = 429;

/**
 * 🔴 THE API BUDGET IS 100 REQUESTS PER 60 SECONDS, PER USER — and this suite spends it.
 *
 * `RateLimiting.Defaults` partitions the global limiter **by user id when authenticated** (by IP
 * only when anonymous). That is the right design: an EMI's ops team of five each get their own
 * budget, and 100/min is ~1.7 req/s sustained — ample for a human.
 *
 * But every spec here acts as the SAME user, so the whole run drains ONE bucket in ~40s. The
 * suite legitimately does the work of many operators at once. Without this, roughly one run in
 * three failed with a 429 on an unrelated assertion — a flake that looked like a product bug and
 * was not. **The limiter is correct; the suite has to behave like a real client and back off.**
 *
 * Deliberately NOT a blanket "retry anything that failed": only 429, only a bounded number of
 * times, honouring `Retry-After`. A 429 that outlives the budget still fails the run — otherwise
 * this would hide the very rate-limit regression it looks like.
 */
function withRateLimitBackoff(context: APIRequestContext): APIRequestContext {
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'fetch', 'head'] as const;

  return new Proxy(context, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function' || !verbs.includes(prop as (typeof verbs)[number])) {
        return typeof original === 'function' ? original.bind(target) : original;
      }

      return async (...args: unknown[]): Promise<APIResponse> => {
        let response = (await original.apply(target, args)) as APIResponse;

        for (let attempt = 0; attempt < RATE_LIMIT_MAX_RETRIES && response.status() === TOO_MANY_REQUESTS; attempt++) {
          const retryAfter = Number(response.headers()['retry-after']);
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1_000
              : RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt;
          // The rule targets sleeping INSTEAD of waiting on an actionable signal, which is the right
          // default and is enforced everywhere else in this suite. It does not apply here: this is
          // HTTP rate-limit backoff in an APIRequestContext proxy. There is no page, no DOM and no
          // selector to await — the only thing that changes is the server's sliding 60s window, and
          // the only way to observe it is to let wall-clock time pass and re-issue the request. The
          // duration is not arbitrary either: it honours `Retry-After` when the server sends one and
          // otherwise backs off exponentially (2→4→8→16→32s), which is what actually outlives a
          // sliding window — a tight poll re-saturates it and never recovers.
          // eslint-disable-next-line no-set-timeout-in-promise/no-set-timeout-in-promise
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          response = (await original.apply(target, args)) as APIResponse;
        }

        return response;
      };
    },
  });
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
    if (probe.ok()) return { username, context: withRateLimitBackoff(context), dispose: () => context.dispose() };
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
  // ignoreHTTPSErrors is deliberately NOT set: app.finreg.dloizides.com is a real Let's Encrypt
  // host, so a bad cert is a genuine failure worth seeing rather than papering over.
  const context = await playwrightRequest.newContext({ baseURL: ZYGOS_WEB_URL });
  try {
    const res = await context.post('/bff/login', {
      headers: jsonCsrfHeaders(),
      data: { username, password },
      timeout: 20_000,
    });
    if (res.ok()) return { kind: 'ok', session: { username, context: withRateLimitBackoff(context), dispose: () => context.dispose() } };

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

/**
 * Log in as the public DEMO MERCHANT — the seeded showcase book, and the identity the public login
 * page advertises.
 *
 * 🔴 USE THIS ONLY WHEN THE DEMO IS THE SUBJECT. It is no longer "a convenient real login": since
 * the E2E fixture users moved to their own tenant (`ZYGOS_E2E_TENANT_ID`), calling this puts the
 * test in the PUBLIC demo tenant, whose credentials are published unauthenticated at
 * `GET /bff/config` — so a stranger can write rows into it, and `/demo/reset` can wipe it, while
 * the test runs. That is an acceptable and unavoidable cost for a test whose subject IS the demo
 * (the seeded corridor showcase, the auto-posted ledger, the published-credentials contract), and
 * a self-inflicted flake for anything else. If the spec merely needs to be logged in, use a
 * `ZYGOS_USERS` fixture and create its own rows.
 *
 * 🔴 The credential is FETCHED from `GET /bff/config`, not hardcoded. That config block is what the
 * marketing site prints and what a visitor types (see `zygos-public-surface.spec.ts`), so reading it
 * here means a rotated demo password can never silently turn this whole tier red against a healthy
 * deployment — the tier always uses whatever the deployment currently publishes.
 *
 * Reuses the shared session cache via `loginAs`, so the entire CRM/accounting @api tier shares ONE
 * demo login (the whole run comes from a single IP and a single user bucket — 5 logins/60s per IP,
 * 100 calls/60s per user). Returns null when the console is unreachable or no demo block is
 * published — both legitimate `test.skip` reasons; a genuine throttle still THROWS inside `loginAs`.
 */
export async function loginAsDemo(): Promise<ZygosSession | null> {
  const demo = await publishedDemo();
  if (!demo) return null;

  // 🔴 DELIBERATELY OUTSIDE any catch. `publishedDemo()` above owns the network failure — an
  // unreachable console returns null and the caller skips, which is correct. What follows is a
  // CONTRACT check, and a contract violation must never be able to present as "not deployed".
  // The previous shape wrapped both in one `try { … } catch { return null }`, so any throw added
  // here would have been laundered into a green skip: a guard that cannot fire.
  const merchant = resolvePublishedMerchant(demo);
  return loginAs(merchant.username, merchant.password);
}

/** The demo block `GET /bff/config` serves. `null` when unconfigured or the console is unreachable. */
export interface PublishedDemo {
  publishedUsername: string;
  publishedPassword: string;
  publishedAccounts?: DemoAccount[];
}

/**
 * Read the published demo block anonymously — exactly as a visitor's browser does.
 *
 * Returns null for the two legitimate `test.skip` reasons ONLY: the console is unreachable, or it
 * publishes no demo block. Never null for "the block is there but says something unexpected" —
 * that is `resolvePublishedMerchant`'s job, and it throws.
 */
export async function publishedDemo(): Promise<PublishedDemo | null> {
  const anon = await anonymousContext();
  try {
    const res = await anon.get('/bff/config', { timeout: 20_000 });
    if (!res.ok()) return null;
    const config = (await res.json()) as { demo: PublishedDemo | null };
    return config.demo;
  } catch {
    return null;
  } finally {
    await anon.dispose();
  }
}

function describeAccounts(accounts: readonly DemoAccount[]): string {
  if (accounts.length === 0) return '(empty)';
  return accounts.map((a, i) => `  [${String(i)}] label=${JSON.stringify(a.label)} username=${JSON.stringify(a.username)}`).join('\n');
}

/**
 * 🔴 THE GUARD. Resolve the account this suite means — the demo MERCHANT — or fail by NAME.
 *
 * ── Why a throw and not a fallback ────────────────────────────────────────────────────────────
 *
 * The obvious-looking safety net ("no label matched? fall back to `publishedUsername`") is not a
 * safety net, it IS the #190 defect. `publishedUsername` is the legacy singular field and, once
 * `publishedAccounts` exists, carries whichever account sits FIRST in that array. #190 put
 * "Master" at index 0. Everything that read the legacy field silently stopped returning the
 * seeded merchant book and started returning the MASTER tenant — which holds no payment
 * instructions at all, by design. Twelve specs went red claiming the demo seed was missing. The
 * seed was intact; the LOGIN had moved. The cost was hours, and every single one of those twelve
 * messages pointed away from the cause.
 *
 * So array ORDER is a load-bearing functional dependency, and the owner has deliberately decided
 * to keep BOTH accounts published — the array is not going away. The only thing that can be made
 * safe is our READ of it: select by label, and if the label is not there, say so in the loudest
 * possible terms rather than quietly landing in whichever tenant happens to be first.
 *
 * Falls back to the singular pair ONLY when NO list is published at all (a genuinely older
 * deployment), where the singular pair really is the one and only merchant.
 */
export function resolvePublishedMerchant(demo: PublishedDemo): DemoAccount {
  const accounts = demo.publishedAccounts ?? [];

  // Pre-`publishedAccounts` deployment: the singular pair IS the merchant, unambiguously.
  if (accounts.length === 0) {
    return { label: 'Merchant', username: demo.publishedUsername, password: demo.publishedPassword };
  }

  const merchant = merchantAccount(accounts);
  if (merchant) return merchant;

  throw new Error(
    [
      '',
      '🔴 ZYGOS DEMO ACCOUNT CONTRACT BROKEN — no MERCHANT account is published any more.',
      '',
      `GET /bff/config → demo.publishedAccounts lists ${String(accounts.length)} account(s):`,
      describeAccounts(accounts),
      '',
      `None matches the merchant matcher ${String(MERCHANT_MATCHER)} on either label or username.`,
      '',
      'WHAT THIS IS NOT: it is not a missing demo seed, not a rotated password, not a broken',
      'login and not a down console. Nothing about the DATA has changed. The published account',
      'LIST changed — a label was renamed or an entry removed — so the suite can no longer name',
      'the account it means.',
      '',
      `WHAT NOT TO DO: do not "fix" this by reading demo.publishedUsername (currently ${JSON.stringify(demo.publishedUsername)}).`,
      'That field is positional — it carries whichever account is FIRST — and doing exactly that',
      `is the #190 defect: it points the whole suite at the MASTER tenant (${DEMO_MASTER_TENANT_ID}),`,
      'which holds no payment instructions, and makes a dozen specs claim the demo seed vanished.',
      '',
      'FIX ONE OF:',
      '  * restore the merchant account label in the BFF config (Bff__Demo__Accounts__*), or',
      '  * widen MERCHANT_MATCHER in E2ETests/tests/zygos/zygos-helpers.ts to match the new label.',
      '',
    ].join('\n'),
  );
}
