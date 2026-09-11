// Selida @api — the claim token is the only key to a published page.
//
// One upload (the project spends 9 of a 10/min budget). The steps share one page on purpose:
// a failed delete must leave the page served, and that is only observable on the same page.
import { expect, test } from '@playwright/test';

import {
  HTTP,
  PageLedger,
  SELIDA_ROUTES,
  anonymousApi,
  deletePage,
  describeResponse,
  htmlFixture,
  publish,
} from './selida-helpers.js';

import type { APIRequestContext } from '@playwright/test';

/** Same shape as a real token, one character different — so only the VALUE can reject it. */
function tamper(token: string): string {
  const last = token.slice(-1);
  return `${token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
}

test.describe('Selida claim token @selida-api @selida', () => {
  const ledger = new PageLedger();
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await anonymousApi();
  });

  test.afterEach(async () => {
    expect(await ledger.drain(api), 'these pages are still PUBLIC — delete them by hand').toEqual([]);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test('wrong or missing token is 403 and the page stays up; the right token is 204 and the page is gone', async () => {
    const page = await publish(api, ledger, {
      name: 'claim.html',
      mimeType: 'text/html',
      buffer: htmlFixture('claim').buffer,
    });

    await test.step('a wrong token is 403 (DeletePage.cs:36-40, DeletePageHandler.cs:28-31)', async () => {
      const response = await deletePage(api, page.slug, tamper(page.claimToken));
      expect(response.status(), await describeResponse(response)).toBe(HTTP.FORBIDDEN);
    });

    await test.step('no X-Claim-Token header is 403, not a bypass (DeletePage.cs:29 null → "")', async () => {
      const response = await deletePage(api, page.slug);
      expect(response.status(), await describeResponse(response)).toBe(HTTP.FORBIDDEN);
    });

    await test.step('after both refusals the page is still served', async () => {
      const response = await api.get(page.url, { maxRedirects: 0 });
      expect(response.status(), await describeResponse(response)).toBe(HTTP.OK);
    });

    await test.step('the issued token deletes it: 204 (DeletePage.cs:42)', async () => {
      const response = await deletePage(api, page.slug, page.claimToken);
      expect(response.status(), await describeResponse(response)).toBe(HTTP.NO_CONTENT);
    });

    await test.step('the slug is now unknown: 404, not 410 — delete removes the row and the blob', async () => {
      // DeletePageHandler.cs:33-35 hard-deletes · ServePageHandler.cs:28-31 → ServePage.cs:38-41.
      // 410 is reserved for a page that still EXISTS but is expired or taken down.
      const served = await api.get(SELIDA_ROUTES.servedOnPagesHost(page.slug), { maxRedirects: 0 });
      expect(served.status(), await describeResponse(served)).toBe(HTTP.NOT_FOUND);
      const metadata = await api.get(SELIDA_ROUTES.page(page.slug));
      expect(metadata.status(), await describeResponse(metadata)).toBe(HTTP.NOT_FOUND);
    });
  });
});
