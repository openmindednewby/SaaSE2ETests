// Selida @api — the Free/Pro boundary, through the BFF.
//
// Covered: a free account is refused a custom slug (402), and checkout-session hands back a
// hosted-checkout URL on exactly checkout.stripe.com. The spec NEVER pays: the webhook → Pro
// path (subscription → isPro → slug change 200, expiresAt null) stays a hand probe.
// One anonymous upload — see the rate-limit note in selida-helpers.ts.
import { expect, test } from '@playwright/test';

import {
  ACCOUNT_SKIP_REASON,
  AccountLedger,
  BFF,
  HTTP_ACCOUNT,
  accountTeardownAvailable,
  bffPostJson,
  writeHeaders,
} from './selida-account-helpers.js';
import { HTTP, PageLedger, SELIDA_ROUTES, anonymousApi, describeResponse, htmlFixture, publish } from './selida-helpers.js';
import { STRIPE_SKIP_REASON, StripeCheckoutLedger, stripeTeardownAvailable } from './selida-stripe-ledger.js';

import type { SelidaAccount } from './selida-account-helpers.js';
import type { CreatedPage } from './selida-helpers.js';
import type { APIRequestContext } from '@playwright/test';

test.describe('Selida billing via BFF @selida-api @selida', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!accountTeardownAvailable(), ACCOUNT_SKIP_REASON);
  test.skip(!stripeTeardownAvailable(), STRIPE_SKIP_REASON);

  const accounts = new AccountLedger();
  const pages = new PageLedger();
  const stripe = new StripeCheckoutLedger();
  let anon: APIRequestContext;
  let user: SelidaAccount;
  let page: CreatedPage;

  test.beforeAll(async () => {
    anon = await anonymousApi();
    user = await accounts.register('b');
  });

  test.afterAll(async () => {
    const leftovers: string[] = [];
    // Owner delete first (a claimed page), then the claim token (a page the claim never reached —
    // the owner gets 403 on that one). The served read-back below is the proof, not these statuses.
    if (page && user) await user.api.delete(BFF.v1(`/pages/${page.slug}`), { headers: writeHeaders() });
    leftovers.push(...(await pages.drain(anon)));
    if (page) {
      const served = await anon.get(SELIDA_ROUTES.servedOnPagesHost(page.slug), { maxRedirects: 0 });
      if (served.status() !== HTTP.NOT_FOUND) leftovers.push(`page ${page.slug} still served (${served.status()})`);
    }
    leftovers.push(...(await stripe.drain(accounts.emails())).leftovers);
    leftovers.push(...(await accounts.drain()));
    await anon?.dispose();
    expect(leftovers, 'teardown left these behind — delete them by hand').toEqual([]);
  });

  test('a free account cannot choose a custom slug: 402', async () => {
    page = await publish(anon, pages, { name: 'billing.html', mimeType: 'text/html', buffer: htmlFixture('billing').buffer });
    const claim = await bffPostJson(user, `/pages/${page.slug}/claim`, { 'X-Claim-Token': page.claimToken });
    expect(claim.status(), await describeResponse(claim)).toBe(HTTP.OK);

    const wanted = `e2e${Date.now().toString(36)}`;
    const response = await user.api.put(BFF.v1(`/pages/${page.slug}/slug`), {
      headers: writeHeaders(),
      data: { slug: wanted },
    });
    expect(response.status(), await describeResponse(response)).toBe(HTTP_ACCOUNT.PAYMENT_REQUIRED);
  });

  test('checkout-session is 200 with a URL whose host is exactly checkout.stripe.com', async () => {
    const response = await bffPostJson(user, '/billing/checkout-session');
    expect(response.status(), await describeResponse(response)).toBe(HTTP.OK);
    const { url } = (await response.json()) as { url: string };
    stripe.track(url);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.host).toBe('checkout.stripe.com');
  });
});
