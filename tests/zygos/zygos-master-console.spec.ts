// FINREG master console @api (#177/#189) — the master↔merchant CONTRACT, exercised through the BFF.
//
// This is the fast, deterministic half of the master console: it proves on the wire what the @ui tier
// then proves renders. Four things, each a real defect if it regresses:
//
//   1. the login page publishes BOTH demo accounts (master + merchant) — the one-tap rows the marketing
//      demo relies on;
//   2. a master's portfolio summary carries a real `name` per tenant (#187) and is NOT 403'd — the fix
//      that stopped the cards showing raw GUIDs;
//   3. a MERCHANT is 403'd on that same master-only endpoint (the overview is master-gated server-side),
//      while still seeing its OWN book — the isolation that makes impersonation meaningful;
//   4. a master can mint an impersonation grant for a child merchant and the grant SCOPES reads to that
//      merchant (the returned count matches the merchant's own portfolio count).
//
// Real-data, self-cleaning: the only write is minting a bounded, auto-expiring impersonation grant — no
// financial rows are created and there is nothing to delete (payment instructions are append-only; the
// grant ages out on its own). Every read keys off the seeded tenant tree, never a global count or index.
import { expect, test } from '@playwright/test';

import { jsonCsrfHeaders } from './zygos-helpers.js';
import {
  MASTER_TENANT,
  MERCHANTS,
  ZYGOS_API_PREFIX,
  masterAccount,
  merchantAccount,
  resolveDemoAccounts,
  sessionFor,
} from './zygos-master.js';

import type { DemoAccount, ImpersonationGrant, PortfolioSummary } from './zygos-master.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or demo accounts not published';
const GRANT_DURATION_MINUTES = 60;
const FORBIDDEN = 403;
const OK = 200;
const CREATED = 201;

test.describe('FINREG master console @zygos-api @api', () => {
  let accounts: DemoAccount[];
  let master: ZygosSession | null;
  let merchant: ZygosSession | null;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    accounts = await resolveDemoAccounts();
    master = await sessionFor(masterAccount(accounts));
    merchant = await sessionFor(merchantAccount(accounts));
  });

  test('the login page publishes BOTH demo accounts (master + merchant)', () => {
    test.skip(accounts.length === 0, SKIP_REASON);

    // Two accounts, and BOTH roles present — a single-account regression (the pre-#177 shape) fails here.
    expect(accounts.length, 'both demo accounts must be published').toBeGreaterThanOrEqual(2);
    expect(masterAccount(accounts), 'a master demo account must be published').toBeTruthy();
    expect(merchantAccount(accounts), 'a merchant demo account must be published').toBeTruthy();

    // Each row carries usable, one-tap credentials — an empty username/password would render a dead row.
    for (const account of accounts) {
      expect(account.username.length, `${account.label} row has no username`).toBeGreaterThan(0);
      expect(account.password.length, `${account.label} row has no password`).toBeGreaterThan(0);
    }
  });

  test('a master portfolio summary lists the merchants BY NAME + own tenant, and is NOT 403', async () => {
    test.skip(!master, SKIP_REASON);

    const res = await (master as ZygosSession).context.get(`${ZYGOS_API_PREFIX}/portfolio/summary`);
    expect(res.status(), 'a master must never be 403 on its own cross-merchant portfolio').toBe(OK);

    const body = (await res.json()) as PortfolioSummary;
    const byId = new Map(body.tenants.map((t) => [t.tenantId, t]));

    // #187: every merchant carries a real NAME on the wire, not the GUID fallback.
    for (const merchantTenant of MERCHANTS) {
      const tenant = byId.get(merchantTenant.id);
      expect(tenant, `merchant ${merchantTenant.name} is missing from the portfolio`).toBeTruthy();
      expect(tenant?.name, `merchant ${merchantTenant.id} must carry its real name (#187)`).toBe(
        merchantTenant.name,
      );
    }

    // The master's OWN tenant is present with its name (rendered as an empty card, never hidden).
    const own = byId.get(MASTER_TENANT.id);
    expect(own?.name, 'the master owns a named, un-hidden tenant card').toBe(MASTER_TENANT.name);

    // Per-currency: a busy merchant carries multiple DISTINCT currencies, each its own line (never summed).
    const busiest = byId.get(MERCHANTS[0].id);
    const currencies = new Set((busiest?.lines ?? []).map((line) => line.currency));
    expect(currencies.size, 'per-currency totals must not be collapsed into one figure').toBeGreaterThan(1);
  });

  test('a merchant is 403 on the master portfolio, but 200 on its OWN book', async () => {
    test.skip(!merchant, SKIP_REASON);

    const denied = await (merchant as ZygosSession).context.get(`${ZYGOS_API_PREFIX}/portfolio/summary`);
    expect(denied.status(), 'the master overview is master-gated server-side').toBe(FORBIDDEN);

    const own = await (merchant as ZygosSession).context.get(
      `${ZYGOS_API_PREFIX}/payment-instructions?Page=1&PageSize=1`,
    );
    expect(own.status(), 'a merchant still reads its own payment book').toBe(OK);
  });

  test('a master mints an impersonation grant that SCOPES reads to the merchant', async () => {
    test.skip(!master, SKIP_REASON);
    const acme = MERCHANTS[0];
    const ctx = (master as ZygosSession).context;

    const mint = await ctx.post(`${ZYGOS_API_PREFIX}/platform/impersonation`, {
      headers: jsonCsrfHeaders(),
      data: {
        targetTenantId: acme.id,
        reason: 'E2E #189 impersonation verification',
        durationMinutes: GRANT_DURATION_MINUTES,
      },
    });
    expect(mint.status(), 'a master may mint a grant for a child merchant').toBe(CREATED);

    const grant = (await mint.json()) as ImpersonationGrant;
    expect(grant.targetTenantId, 'the grant names the merchant it was minted for').toBe(acme.id);
    expect(grant.token.length, 'the grant carries an opaque token').toBeGreaterThan(0);

    // The token scopes reads to that merchant: the impersonated count equals the merchant's own portfolio
    // count — proof the header actually re-scoped the read, not just that the endpoint returned 200.
    const scoped = await ctx.get(`${ZYGOS_API_PREFIX}/payment-instructions?Page=1&PageSize=1`, {
      headers: { 'X-Impersonation-Token': grant.token },
    });
    expect(scoped.status(), 'the scoped read succeeds under the grant').toBe(OK);
    const scopedPage = (await scoped.json()) as { totalCount: number };

    const summary = (await (await ctx.get(`${ZYGOS_API_PREFIX}/portfolio/summary`)).json()) as PortfolioSummary;
    const acmeSummary = summary.tenants.find((t) => t.tenantId === acme.id);
    expect(scopedPage.totalCount, 'the grant scopes reads to the merchant book').toBe(acmeSummary?.totalCount);
  });
});
