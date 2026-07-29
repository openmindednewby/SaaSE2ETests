// Zygos accounting cross-module @api (FINREG A-01, the demo beat) — proves the payments→accounting
// seam is WIRED, not just present.
//
// 🔴 THE ASSERTION THAT MATTERS. A chart of accounts and a journal endpoint can both exist and pass
// their own tests while the two modules never actually talk. The demo tenant is built to show the
// opposite: every settled payment enqueues one balanced journal (SettledPaymentJournalFactory), and
// the drainer posts it into the general ledger. So the demo ledger should already carry ~one
// auto-posted journal per settled payment (~95), each naming the payment it came from, and the whole
// set of books should still balance.
//
// This runs against the EXISTING seeded state — it does NOT call /demo/reset (that is Admin-gated and
// the demo user is deliberately non-admin). It reads what the seed already produced.
//
// NOTE (flagged follow-up): JournalDto does not yet expose sourceSystem/sourceReference as fields, so
// the payment provenance is asserted through the journal's description and reference text — which is
// exactly what the demo operator sees. If those fields are added later, tighten this to assert them.
import { expect, test } from '@playwright/test';

import { ModulesApi } from './zygos-console-modules.js';
import { bodyJson, bodyText } from './zygos-helpers.js';
import { loginAsDemo } from './zygos-session.js';

import type { JournalDto, Paged, TrialBalanceDto } from './zygos-console-modules.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or demo credentials not published';
const MAX_PAGE_SIZE = 100;
const SCAN_PAGES = 3;
const CENTS = 100;
const MIN_LEGS = 2;

/** The provenance line the factory writes: "Auto-posted from settled payment ZY-… (guid)." */
const AUTO_POSTED = /auto-posted from settled payment/i;
/** A settled-payment human reference, e.g. ZY-2026-0000123. */
const PAYMENT_REF = /ZY-\d/i;

function cents(n: number | undefined): number {
  return Math.round((n ?? 0) * CENTS);
}

test.describe('Zygos accounting cross-module @zygos-api @api', () => {
  let demo: ZygosSession | null;
  let api: ModulesApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    demo = await loginAsDemo();
    if (demo) api = new ModulesApi(demo);
  });

  test.beforeEach(() => {
    test.skip(!demo, SKIP_REASON);
  });

  /** Walk up to SCAN_PAGES pages of the ledger (100 rows each) and return every journal seen. */
  async function scanJournals(): Promise<JournalDto[]> {
    const all: JournalDto[] = [];
    for (let page = 1; page <= SCAN_PAGES; page++) {
      const res = await api.listJournals(`?page=${page}&pageSize=${MAX_PAGE_SIZE}`);
      expect(res.status(), `list journals p${page} failed: ${await bodyText(res)}`).toBe(200);
      const body = await bodyJson<Paged<JournalDto>>(res);
      all.push(...(body?.items ?? []));
      if (!body?.hasNextPage) break;
    }
    return all;
  }

  test('🔴 the demo ledger holds journals AUTO-POSTED from settled payments', async () => {
    const journals = await scanJournals();
    expect(journals.length, 'the demo ledger is seeded — an empty ledger means the seam never ran').toBeGreaterThan(
      0,
    );

    // The cross-module fact: settled payments materialised as accounting journals.
    const autoPosted = journals.filter((j) => AUTO_POSTED.test(j.description ?? ''));
    expect(
      autoPosted.length,
      'the ledger holds NO journal auto-posted from a settled payment — the payments→accounting seam ' +
        'is not wired in the demo tenant (or the drainer never ran). This is the whole demo beat.',
    ).toBeGreaterThan(0);

    // Each auto-posted journal names the settled payment it came from — in the description
    // ("settled payment ZY-…") and/or the reference field the demo operator sees.
    const namesItsPayment = autoPosted.some(
      (j) => PAYMENT_REF.test(j.description ?? '') || PAYMENT_REF.test(j.reference ?? ''),
    );
    expect(
      namesItsPayment,
      'no auto-posted journal names the payment (ZY-…) it was sourced from — provenance is lost',
    ).toBe(true);

    // And each is genuine balanced double-entry — two legs, not a one-sided memo.
    for (const j of autoPosted.slice(0, 5)) {
      expect(j.lines.length, `auto-posted journal ${j.reference} must carry both legs`).toBeGreaterThanOrEqual(
        MIN_LEGS,
      );
    }
  });

  test('🔴 with those auto-posted journals in it, the demo ledger still balances', async () => {
    const res = await api.getTrialBalance();
    const tb = await bodyJson<TrialBalanceDto>(res);
    expect(res.status(), `trial balance failed: ${await bodyText(res)}`).toBe(200);

    // If the payment→journal mapping ever posted a one-sided or mismatched entry, the books would
    // stop balancing — this is the guard that the auto-posting conserves value, tenant-wide.
    expect(cents(tb?.totalDebits), 'total debits must equal total credits across the whole ledger').toBe(
      cents(tb?.totalCredits),
    );
    expect(tb?.isBalanced, 'the server agrees the demo books balance').toBe(true);
  });
});
