// Selida @api — claiming an anonymous page into a signed-in account, through the BFF.
//
// Serial on purpose: one page walks the whole claim lifecycle (wrong token → right token →
// another account's delete and claim), and a step that fails must stop the ones that depend on it.
// One anonymous upload — see the rate-limit note in selida-helpers.ts.
import { expect, test } from '@playwright/test';

import {
  ACCOUNT_SKIP_REASON,
  AccountLedger,
  BFF,
  HTTP_ACCOUNT,
  accountTeardownAvailable,
  bffPostJson,
  tamperToken,
  writeHeaders,
} from './selida-account-helpers.js';
import { HTTP, PageLedger, SELIDA_ROUTES, anonymousApi, describeResponse, htmlFixture, publish } from './selida-helpers.js';

import type { SelidaAccount } from './selida-account-helpers.js';
import type { CreatedPage } from './selida-helpers.js';
import type { APIRequestContext } from '@playwright/test';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A free claim keeps the page claim time + 1 year; 364–367 days tolerates leap years and clock skew. */
const MIN_RETENTION_DAYS = 364;
const MAX_RETENTION_DAYS = 367;

test.describe('Selida account claim via BFF @selida-api @selida', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!accountTeardownAvailable(), ACCOUNT_SKIP_REASON);

  const accounts = new AccountLedger();
  const pages = new PageLedger();
  let anon: APIRequestContext;
  let owner: SelidaAccount;
  let intruder: SelidaAccount;
  let page: CreatedPage;

  test.beforeAll(async () => {
    anon = await anonymousApi();
  });

  test.afterAll(async () => {
    const leftovers: string[] = [];
    // Owner delete first (a claimed page), then the claim token (a page the claim never reached —
    // the owner gets 403 on that one). The served read-back below is the proof, not these statuses.
    if (page && owner) await owner.api.delete(BFF.v1(`/pages/${page.slug}`), { headers: writeHeaders() });
    leftovers.push(...(await pages.drain(anon)));
    if (page) {
      const served = await anon.get(SELIDA_ROUTES.servedOnPagesHost(page.slug), { maxRedirects: 0 });
      if (served.status() !== HTTP.NOT_FOUND) leftovers.push(`page ${page.slug} still served (${served.status()})`);
    }
    leftovers.push(...(await accounts.drain()));
    await anon?.dispose();
    expect(leftovers, 'teardown left these behind — delete them by hand').toEqual([]);
  });

  test('register through the BFF signs the user in: /bff/me is 200 for the new subject', async () => {
    owner = await accounts.register('o');
    const me = await owner.api.get(BFF.me, { headers: { Accept: 'application/json' } });
    expect(me.status(), await describeResponse(me)).toBe(HTTP.OK);
    const { user } = (await me.json()) as { user: { sub: string; preferred_username: string } };
    expect(user.sub).toBe(owner.sub);
    expect(user.preferred_username).toBe(owner.username);
  });

  test('a wrong claim token is 403 problem+json with top-level code TOKEN_MISMATCH', async () => {
    page = await publish(anon, pages, { name: 'claim.html', mimeType: 'text/html', buffer: htmlFixture('account-claim').buffer });
    const response = await bffPostJson(owner, `/pages/${page.slug}/claim`, { 'X-Claim-Token': tamperToken(page.claimToken) });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.FORBIDDEN);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect(((await response.json()) as { code?: string }).code).toBe('TOKEN_MISMATCH');
  });

  test('the issued token claims it: 200, expiresAt ≈ now + 1 year, and it is listed in /me/pages', async () => {
    const response = await bffPostJson(owner, `/pages/${page.slug}/claim`, { 'X-Claim-Token': page.claimToken });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.OK);
    const claimed = (await response.json()) as { slug: string; expiresAt: string | null };
    expect(claimed.slug).toBe(page.slug);
    const retentionDays = (Date.parse(claimed.expiresAt ?? '') - Date.now()) / DAY_MS;
    expect(retentionDays, `expiresAt=${claimed.expiresAt}`).toBeGreaterThan(MIN_RETENTION_DAYS);
    expect(retentionDays, `expiresAt=${claimed.expiresAt}`).toBeLessThan(MAX_RETENTION_DAYS);

    const mine = await owner.api.get(BFF.v1('/me/pages'), { headers: { Accept: 'application/json' } });
    expect(mine.status(), await describeResponse(mine)).toBe(HTTP.OK);
    const { items } = (await mine.json()) as { items: { slug: string }[] };
    expect(items.map((p) => p.slug)).toContain(page.slug);
  });

  test('another account cannot delete the claimed page: 403 code NOT_OWNER', async () => {
    intruder = await accounts.register('i');
    const response = await intruder.api.delete(BFF.v1(`/pages/${page.slug}`), { headers: writeHeaders() });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.FORBIDDEN);
    expect(((await response.json()) as { code?: string }).code).toBe('NOT_OWNER');
  });

  test('another account claiming with the right token is 409: a page is claimed once', async () => {
    const response = await bffPostJson(intruder, `/pages/${page.slug}/claim`, { 'X-Claim-Token': page.claimToken });
    expect(response.status(), await describeResponse(response)).toBe(HTTP_ACCOUNT.CONFLICT);
  });

  test('the BFF proxies only /api/v1: /p/<slug>, /health and a ..%2f traversal are 404', async () => {
    for (const path of [`/p/${page.slug}`, '/health', '/api/v1/..%2f..%2fhealth']) {
      const response = await owner.api.get(BFF.proxied(path), { maxRedirects: 0 });
      expect(response.status(), `${path}: ${await describeResponse(response)}`).toBe(HTTP.NOT_FOUND);
    }
  });
});
