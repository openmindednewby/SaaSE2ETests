// Zygos E2E helpers (ZY-18) — the session/URL/naming plumbing for the two-tier suite.
//
// Grew out of `zygos/_pipeline/e2e/zygos-helpers.ts` (the scaffolder's starting point) but
// the transport is deliberately different, because the scaffolder's assumption does not hold
// for this product:
//
// 🔴 THE API IS NOT DIRECTLY REACHABLE. The scaffold assumed a public `ZYGOS_API_URL`
// (`http://localhost:5023` / `zygos-api.dloizides.com`). That DNS is not live (owner-gated,
// RUNBOOK.md section B) and zygos-api is a staging-placed workload. The ONLY public path to
// the API is through the BFF, same-origin with the console:
//
//     https://app.finreg.dloizides.com/bff/api/zygos/api/v1/...
//
// carrying the `__Host-bff-zygos` session cookie. `__Host-` cookies REQUIRE HTTPS by spec, so
// there is no plain-HTTP in-cluster shortcut — the suite tests the real host or nothing.
//
// That is a feature, not a compromise: it means the @api tier exercises the same hop the
// browser does (BFF auth, CSRF, token forwarding, tenant claim), not a private back door the
// product does not actually ship.
import type { APIResponse } from '@playwright/test';

/** The deployed console origin — BFF and SPA are same-origin. */
export const ZYGOS_WEB_URL = (process.env.ZYGOS_WEB_URL?.trim() || 'https://app.finreg.dloizides.com').replace(
  /\/+$/,
  '',
);

/** The BFF's proxy prefix onto zygos-api's `/api/v1`. */
export const ZYGOS_API_PREFIX = '/bff/api/zygos/api/v1';

/** The password every seeded zygos-realm fixture user shares. */
export const ZYGOS_TEST_PASSWORD = process.env.ZYGOS_TEST_PASSWORD?.trim() || 'SuperUser123!';

/**
 * 🔴 THE E2E TENANT IS NOT THE DEMO TENANT — and keeping them apart is the point.
 *
 * The five fixture users below live in a tenant dedicated to this suite
 * (`e2e00001-…`, provisioned by `personalServerNotes/scripts/provision-zygos-e2e-tenant.sh`).
 * They used to live in `7fa9403d-…`, which is ALSO the public demo tenant whose working
 * credentials `GET /bff/config` publishes deliberately and unauthenticated.
 *
 * That shared tenant had two costs, and neither was hypothetical: anyone on the internet holding
 * the published credentials could fire `/demo/reset` or write rows in the middle of a nightly
 * run, and every night's CI residue accumulated in the exact tenant a prospect clicks through
 * during a demo. Measured before the split: the published `demo` user and `zygos-maker-a` both
 * reported 345 instructions and 11 parties — the same rows.
 *
 * The consequence for anyone writing a test here: **a fixture-user session can no longer see any
 * demo-seeded row.** If a spec needs the seeded corridor/ledger showcase it must say so by
 * logging in as the demo MERCHANT (`loginAsDemo`), and it is then asserting on the demo product
 * surface — which is a legitimate thing to test, but a different thing.
 */
export const ZYGOS_E2E_TENANT_ID = 'e2e00001-0000-4000-a000-000000000001';

/** One published demo account as `GET /bff/config` advertises it. */
export interface DemoAccount {
  label: string;
  username: string;
  password: string;
}

function pickAccount(accounts: readonly DemoAccount[], matcher: RegExp): DemoAccount | undefined {
  return accounts.find((a) => matcher.test(a.label) || matcher.test(a.username));
}

/** The master/reseller account (label or username mentions "master"). */
export function masterAccount(accounts: readonly DemoAccount[]): DemoAccount | undefined {
  return pickAccount(accounts, /master/i);
}

/**
 * The merchant account (label "Merchant" or the seeded `demo` username).
 *
 * 🔴 Selected BY LABEL, never by position, and never via `publishedUsername`. That field is the
 * legacy singular one and now carries whichever account happens to be FIRST in the published
 * list. When #190 added the master account at index 0, `publishedUsername` silently flipped from
 * `demo` to `master` — repointing every caller from the seeded merchant book to the master
 * tenant, which has no payment instructions at all. Twelve specs went red asserting the demo
 * seed was missing, when the seed was fine and the LOGIN had moved. Ask for the account you mean.
 */
export function merchantAccount(accounts: readonly DemoAccount[]): DemoAccount | undefined {
  return pickAccount(accounts, /merchant|^demo$/i);
}

/**
 * The seeded zygos-realm fixture users (personalServerNotes/keycloak/realms.config.json →
 * scripts/seed-realm-users.ps1). PERMANENT fixtures — never created or swept per-run.
 *
 * ⚠️ #235: a canary teardown once swept `e2ec-` users mid-run and caused a 401 cascade. These
 * users are therefore deliberately NOT `e2ec-` prefixed and there is no teardown that touches
 * a user. Nothing in this suite deletes anything it did not create.
 *
 * 🔴 THREE users in ONE tenant is the minimum that can express the contract's §1 maker ruling.
 * The rule is "checker ∉ Contributors (created OR materially edited)", NOT "checker ≠ creator".
 * Two users can only test the weaker rule — and the weaker rule is exactly the hole: A creates,
 * B edits it to point at B's own account, B approves. Both users differ from "the creator" at
 * every step. EDITOR_B exists to walk that path and be refused.
 */
export const ZYGOS_USERS = {
  /** Tenant A. Creates instructions ⇒ always a Contributor ⇒ can never approve its own. */
  MAKER_A: 'zygos-maker-a',
  /** Tenant A. EDITS A's drafts ⇒ becomes a Contributor ⇒ must be refused approval. */
  EDITOR_B: 'zygos-editor-b',
  /** Tenant A. Touches nothing ⇒ the only user who may approve. The discrimination leg. */
  CHECKER_C: 'zygos-checker-c',
  /** A DIFFERENT tenant. Must not read/list/mutate tenant A's anything (§5 G1). */
  TENANT_B: 'zygos-tenant-b',
  /** Tenant A admin (the original scaffolded fixture). */
  ADMIN: 'zygos-admin',
} as const;

/**
 * 🔴 The CSRF headers the BFF demands on EVERY mutating request — not just `/bff/login`.
 *
 * This cost a real bug and is the reason this constant exists rather than being inlined at the
 * login call: the first hand-probe of the maker-checker flow sent these ONLY on login, and every
 * subsequent POST/PUT came back **403 {"error":"Anti-forgery validation failed."}**.
 *
 * A 403 is ALSO what a maker-checker violation returns. So the naive test — "editor-b approves →
 * expect 403" — PASSED, while proving nothing whatsoever about segregation of duties. It was
 * green because the request never reached the aggregate.
 *
 * That is precisely the "passes when the feature is broken" failure this suite exists to avoid.
 * Two defences, both mandatory:
 *   1. these headers go on every mutation, so requests actually arrive; and
 *   2. `expectMakerCheckerRefusal` asserts the RESPONSE BODY names the violation — a CSRF
 *      regression can never again masquerade as a working control.
 */
export function csrfHeaders(): Record<string, string> {
  return { 'X-BFF-Csrf': '1', Origin: ZYGOS_WEB_URL };
}

/** CSRF + JSON, for requests that carry a body. */
export function jsonCsrfHeaders(): Record<string, string> {
  return { ...csrfHeaders(), 'Content-Type': 'application/json' };
}

/**
 * A unique, greppable tag for one test's data.
 *
 * 🔴 SEED-INDEPENDENCE, and it is not optional here.
 *
 * A `PaymentInstruction` CANNOT BE DELETED — there is no DELETE route, by design: it is an
 * immutable, append-only financial record (contract §2). So the usual "create → assert →
 * clean up" contract is unavailable, every run leaves rows behind forever, and another agent
 * is landing a demo seed into this same tenant right now.
 *
 * Therefore no test may ever assert on a global count, "the first row", or an unfiltered list.
 * Every test tags its own rows with this and filters with `Search`, so accumulated rows — ours,
 * the demo seed's, or a human's — cannot change any assertion.
 */
export function zygosTag(label: string): string {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `ZY18-${label}-${unique}`;
}

/**
 * A response body TRUNCATED for use in a failure message. Never throws.
 *
 * ⚠️ Truncated — so never `JSON.parse` this. (It was parsed once, and a 500-char cut produced
 * "Unterminated string in JSON" that masqueraded as a server bug.) Use `bodyJson` to read a body.
 */
export async function bodyText(res: APIResponse): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}

/** Parse a response body, or null when it is not JSON. Never throws. */
export async function bodyJson<T>(res: APIResponse): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
