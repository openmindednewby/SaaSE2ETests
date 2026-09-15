import { expect, test, type Request } from '@playwright/test';

import {
  collectConsoleErrors,
  expectPageViewBeacon,
  HTTP_NOT_FOUND,
  HTTP_OK,
  NOT_FOUND_ROUTE,
  REAL_ROUTES,
  SPA_URL,
  interceptAnalytics,
} from '../../fixtures/nextgame-web';

/**
 * The API-driven suite next to this one is structurally BLIND to a client-side ReferenceError:
 * it imports one module in Node and never renders a screen. This smoke covers exactly that gap —
 * load the served SPA in a real browser and fail on ANY console error, on every signed-out route.
 */
test.describe('nextgame SPA console smoke', () => {
  let analytics: Request[] = [];

  test.beforeEach(async ({ page }) => {
    analytics = await interceptAnalytics(page);
  });


  for (const route of REAL_ROUTES) {
    // Most of these are session/flow-gated (see fixtures/nextgame-web.ts): loaded anonymously they
    // may client-side redirect elsewhere (landing, welcome, whatever the gate sends them to) — that
    // is NOT a failure. A console error IS, whatever route the page ends on, so nothing here asserts
    // the final URL or the final screen's testId.
    test(`${route.path} settles with zero console errors, whatever route it ends on`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const response = await page.goto(`${SPA_URL}${route.path}`);

      expect(response?.status(), `${route.path} did not serve 200`).toBe(HTTP_OK);
      await expectPageViewBeacon(analytics);
      expect(errors, `console errors starting from ${route.path} (ended at ${page.url()}):\n${errors.join('\n')}`).toEqual(
        [],
      );
    });
  }

  test('the not-found page renders with zero unexpected console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(`${SPA_URL}${NOT_FOUND_ROUTE.path}`);

    expect(response?.status()).toBe(HTTP_NOT_FOUND);
    await expect(page.getByTestId(NOT_FOUND_ROUTE.screenTestId)).toBeVisible();
    await expectPageViewBeacon(analytics);
    expect(errors, `console errors on ${NOT_FOUND_ROUTE.path}:\n${errors.join('\n')}`).toEqual([]);
  });
});
