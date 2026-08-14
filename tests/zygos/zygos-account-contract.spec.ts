// Zygos PUBLISHED-DEMO-ACCOUNT CONTRACT — the guard on the assumption every demo-reading spec
// in this suite silently rests on: *the demo login lands in the demo MERCHANT tenant.*
//
// ── The defect this exists to make impossible-to-misread ──────────────────────────────────────
//
// `GET /bff/config` publishes, unauthenticated and on purpose:
//
//     publishedUsername: "master"                          ← LEGACY SINGULAR FIELD
//     publishedAccounts: [ {label:"Master",   username:"master"},    ← index 0
//                          {label:"Merchant", username:"demo"} ]
//
// `publishedUsername` carries whichever account is FIRST in that array. #190 added "Master" at
// index 0. `loginAsDemo()` read the legacy field, so the entire suite's demo login silently
// repointed from the seeded merchant book to the MASTER tenant — which holds no payment
// instructions at all, by design.
//
// Twelve specs went red claiming the demo seed was missing. The seed was intact. The LOGIN had
// moved. Thirteen of sixteen baseline API failures, and not one of the thirteen messages pointed
// anywhere near the cause. **The cost was not the bug; the cost was that every symptom lied.**
//
// ── Why the fix alone was not enough ──────────────────────────────────────────────────────────
//
// Selecting the merchant BY LABEL fixes today. It does not make the hazard go away, because the
// owner has deliberately decided to keep BOTH accounts published — so the array stays, and array
// ORDER stays a load-bearing, otherwise-unguarded functional dependency. Rename "Merchant", or
// drop it, and label-selection silently finds nothing.
//
// ── Where the guard lives, and why HERE ───────────────────────────────────────────────────────
//
// Two layers, with different jobs. Neither is sufficient alone:
//
//   1. HELPER-LEVEL (`resolvePublishedMerchant` in zygos-session.ts) — kills the silent PATH.
//      There is now no fallback from "no merchant label" to `publishedUsername`, because that
//      fallback *is* the defect. It throws, and it throws OUTSIDE the network try/catch so the
//      contract violation can never launder itself into a green `test.skip`. Every caller that
//      would have landed in the wrong tenant now fails with the same named message instead of
//      twelve different downstream fictions.
//
//   2. THIS FILE — the single, early, canonical diagnosis. A helper throw only tells you the
//      label is gone; it cannot tell you *which tenant you actually ended up in*, which is the
//      one question that separates "the seed is missing" from "the login moved". So this file
//      asks the deployment directly, and its test NAMES are the diagnosis.
//
// Deliberately NOT in `global-setup`: that runs for every product suite on the estate (kefi,
// katalogos, erevna, …), and a FINREG-only tenant invariant there would red the whole estate for
// one product's config — and would convert a legitimately-unreachable console into a total-run
// failure instead of a skip.
//
// Deliberately NOT a Playwright project `dependency` either: a failing dependency SKIPS the whole
// dependent project, which would take down the ~90% of this suite that runs as fixture users in
// its own tenant and is entirely unaffected by which demo account is first. Blocking that much
// real coverage to guard one assumption trades one blind spot for a bigger one.
//
// The filename does the ordering: `zygos-account-contract` sorts ahead of `zygos-accounting-*`
// and everything after it, so in the single-worker `zygos-api` project this is the FIRST file to
// run. The truth is on screen before anything downstream gets a chance to lie about it.
import { expect, test } from '@playwright/test';

import {
  DEMO_MASTER_TENANT_ID,
  DEMO_MERCHANT_TENANT_ID,
  MERCHANT_MATCHER,
  ZYGOS_API_PREFIX,
  ZYGOS_E2E_TENANT_ID,
  bodyJson,
  bodyText,
  masterAccount,
  merchantAccount,
} from './zygos-helpers.js';
import { loginAsDemo, publishedDemo, resolvePublishedMerchant } from './zygos-session.js';

import type { DemoAccount } from './zygos-helpers.js';
import type { PublishedDemo } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or no demo block published';

/** Every tenant this suite can plausibly land in, so a wrong landing can be NAMED, not just flagged. */
const KNOWN_TENANTS = new Map<string, string>([
  [DEMO_MERCHANT_TENANT_ID, 'the PUBLIC DEMO MERCHANT tenant ("Acme Pay") — the seeded showcase book. CORRECT.'],
  [
    DEMO_MASTER_TENANT_ID,
    'the MASTER/reseller tenant — it holds NO payment instructions by design. This is the #190 landing: ' +
      'the demo login fell back to positional selection and every seed assertion is about to report a ' +
      'missing seed that is not missing.',
  ],
  [ZYGOS_E2E_TENANT_ID, "the suite's OWN dedicated E2E tenant — a fixture login leaked into the demo path."],
]);

function describeTenant(tenantId: string): string {
  return KNOWN_TENANTS.get(tenantId) ?? 'an UNKNOWN tenant — not the demo merchant, not the master, not the E2E tenant.';
}

interface BffMe {
  user: { preferred_username: string; tenantId: string } | null;
}

test.describe('Zygos published-demo-account contract @zygos-api @api', () => {
  let demo: PublishedDemo | null;

  test.beforeAll(async () => {
    demo = await publishedDemo();
  });

  test.beforeEach(() => {
    test.skip(!demo, SKIP_REASON);
  });

  test('🔴 a MERCHANT-labelled account is still published (renaming it must not silently repoint the suite)', () => {
    const published = demo as PublishedDemo;
    const accounts = published.publishedAccounts ?? [];

    // The throw is the assertion. `resolvePublishedMerchant` carries the full diagnosis — the
    // account list as served, the matcher that failed, why NOT to reach for `publishedUsername`,
    // and the two ways to fix it. Re-wording it here would put the message in two places and let
    // them drift; this is the one that fires at every call site in the suite.
    const merchant = resolvePublishedMerchant(published);

    expect(
      MERCHANT_MATCHER.test(merchant.label) || MERCHANT_MATCHER.test(merchant.username),
      `resolved merchant ${JSON.stringify(merchant)} does not itself match ${String(MERCHANT_MATCHER)} — the picker and the matcher have drifted apart`,
    ).toBe(true);

    // A rename can also collapse the two roles onto ONE entry — e.g. label "Master Merchant".
    // Both pickers then return the same account, every downstream check still "resolves", and the
    // suite is quietly in the master tenant again with nothing red. Distinctness is the guard.
    const master = masterAccount(accounts);
    if (master) {
      expect(
        master.username,
        `the master and merchant pickers both resolved to ${JSON.stringify(master.username)}. One published ` +
          'account is now matching BOTH roles (a label like "Master Merchant" does this), so selecting the ' +
          '"merchant" by label lands in the MASTER tenant — the #190 failure with the label-based fix in place.',
      ).not.toBe(merchant.username);
    }
  });

  test('🔴 the demo login LANDS IN THE MERCHANT TENANT (not the master tenant)', async () => {
    // The load-bearing assertion. It is mechanism-independent: it does not care whether selection
    // is by label, by index, or by something invented next year — it asks the deployment which
    // tenant this suite's demo session is actually in. Any future silent repointing fails HERE,
    // by name, before a single seed assertion gets to misreport it.
    const session = await loginAsDemo();
    expect(session, 'loginAsDemo() returned no session — the console is unreachable or the demo credentials were rejected').not.toBeNull();
    const live = session as NonNullable<typeof session>;

    const res = await live.context.get('/bff/me');
    expect(res.status(), `GET /bff/me failed: ${await bodyText(res)}`).toBe(200);
    const me = await bodyJson<BffMe>(res);
    expect(me?.user, 'GET /bff/me returned no user for an authenticated demo session').toBeTruthy();
    const user = me?.user as NonNullable<BffMe['user']>;

    expect(
      user.tenantId,
      `\n🔴 THE DEMO LOGIN HAS MOVED TENANT.\n` +
        `  logged in as : ${user.preferred_username}\n` +
        `  landed in    : ${user.tenantId}\n` +
        `                 → ${describeTenant(user.tenantId)}\n` +
        `  expected     : ${DEMO_MERCHANT_TENANT_ID}\n` +
        `                 → ${describeTenant(DEMO_MERCHANT_TENANT_ID)}\n` +
        `\nEverything downstream that reads the demo seed is about to fail claiming the seed is MISSING.\n` +
        `It is not. The seed is where it always was; this suite is no longer looking at it.\n` +
        `Start at GET /bff/config → demo.publishedAccounts and at resolvePublishedMerchant().\n`,
    ).toBe(DEMO_MERCHANT_TENANT_ID);

    // Belt and braces on the same claim from the identity side: the tenant could in principle be
    // right while the username is not the one we asked for.
    const merchant = resolvePublishedMerchant(demo as PublishedDemo);
    expect(
      user.preferred_username,
      `the demo session is authenticated as ${JSON.stringify(user.preferred_username)} but the suite selected ` +
        `${JSON.stringify(merchant.username)} from publishedAccounts. loginAsDemo() is not logging in as the ` +
        'account it resolved — a caching or session-reuse fault, not a config one.',
    ).toBe(merchant.username);
  });

  test('the merchant tenant actually holds the seeded book (so "seed missing" can only ever mean seed missing)', async () => {
    // Deliberately SEPARATE from the tenant assertion above, and that separation is the point:
    // together the two tests turn one ambiguous red into an unambiguous one.
    //
    //   tenant test RED, this RED   → the login moved. Ignore every "seed missing" downstream.
    //   tenant test GREEN, this RED → the seed really is gone. /demo/reset, or a wipe.
    //
    // #190 was the first case and the suite could only ever report the second.
    const session = await loginAsDemo();
    test.skip(!session, SKIP_REASON);
    const live = session as NonNullable<typeof session>;

    const res = await live.context.get(`${ZYGOS_API_PREFIX}/payment-instructions?pageSize=1`);
    expect(res.status(), `list payment-instructions failed: ${await bodyText(res)}`).toBe(200);
    const page = await bodyJson<{ totalCount?: number }>(res);

    expect(
      page?.totalCount ?? 0,
      'the demo MERCHANT tenant reports zero payment instructions. The sibling test above confirms the ' +
        'login is in the right tenant, so this is a genuinely empty seed — /demo/reset, a wipe, or a ' +
        'reprovision that never ran. This is the ONLY circumstance in which "the demo seed is missing" ' +
        'is a true statement.',
    ).toBeGreaterThan(0);
  });

  test('publishedUsername is POSITIONAL — pinned here so nobody trusts it again', () => {
    const published = demo as PublishedDemo;
    const accounts = published.publishedAccounts ?? [];
    test.skip(accounts.length === 0, 'no publishedAccounts list — the singular pair is unambiguous on this deployment');

    // NOT an assertion that publishedUsername equals the merchant — today it deliberately does
    // not, and the owner's decision to publish Master first is final. This pins the MECHANISM
    // instead: the legacy singular field mirrors index 0 and nothing else. That is what makes it
    // unusable for "which account do I mean?", and pinning it means the next reader does not have
    // to rediscover it the expensive way.
    expect(
      published.publishedUsername,
      'demo.publishedUsername no longer mirrors publishedAccounts[0]. The legacy field has changed meaning ' +
        'in some third way — re-derive what it now carries before ANY code reads it, and keep reading it out ' +
        'of the suite either way.',
    ).toBe((accounts[0] as DemoAccount).username);

    const merchant = merchantAccount(accounts) as DemoAccount;
    if (published.publishedUsername !== merchant.username) {
      // Not a failure — this is the expected steady state. Recorded as a REPORT ANNOTATION rather
      // than a console line so it survives into the HTML report and CI output, where the person
      // triaging a demo-tenant failure will actually be looking.
      test.info().annotations.push({
        type: 'positional-drift',
        description:
          `publishedUsername=${JSON.stringify(published.publishedUsername)} is NOT the merchant ` +
          `(${JSON.stringify(merchant.username)}); it mirrors publishedAccounts[0], the Master account. ` +
          'Expected and deliberate — it is exactly why this suite selects by label. Nothing to do.',
      });
    }
  });
});
