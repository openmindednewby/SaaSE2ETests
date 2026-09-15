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


  // '/' is pinned separately below (RESPONSIVE-SSR-1) — it does not go through this generic loop.
  const NON_ROOT_ROUTES = REAL_ROUTES.filter((route) => route.path !== '/');
  const ROOT_ROUTE = REAL_ROUTES.find((route) => route.path === '/')!;
  const MOBILE_412_VIEWPORT = { width: 412, height: 823 };
  const REACT_418_MARKER = 'React error #418';

  for (const route of NON_ROOT_ROUTES) {
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

  /**
   * RESPONSIVE-SSR-1 (ruled, controller 2026-09-16): the static export hydrates against a
   * narrow-rendered DOM at desktop width and React throws #418 — a JS fix was reverted because it
   * regressed CLS to 0.41. #418 reproduces on staging INTERMITTENTLY (observed 5/6 runs, not 6/6),
   * so this filters #418 out rather than asserting its presence — an assert-present flipped red on
   * the 1-in-6 run where the defect just didn't fire that time, which is a worse signal than the
   * filter it replaces. Any console error other than #418 still fails the test normally, so the
   * gate stays live for a new regression on this route. DELETE this filter (and fold '/' back into
   * the loop above) once RESPONSIVE-SSR-1 lands.
   */
  test(`${ROOT_ROUTE.path} settles with zero console errors, whatever route it ends on (desktop; RESPONSIVE-SSR-1 filtered)`, async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(`${SPA_URL}${ROOT_ROUTE.path}`);

    expect(response?.status(), `${ROOT_ROUTE.path} did not serve 200`).toBe(HTTP_OK);
    await expectPageViewBeacon(analytics);

    const react418Seen = errors.some((error) => error.includes(REACT_418_MARKER));
    test.info().annotations.push({ type: 'known-defect', description: `RESPONSIVE-SSR-1 (#418 seen: ${react418Seen})` });

    const unrelatedErrors = errors.filter((error) => !error.includes(REACT_418_MARKER));
    expect(
      unrelatedErrors,
      `unrelated console errors on ${ROOT_ROUTE.path} (ended at ${page.url()}):\n${unrelatedErrors.join('\n')}`,
    ).toEqual([]);
  });

  test(`${ROOT_ROUTE.path} at 412x823 settles with zero console errors (RESPONSIVE-SSR-1 is desktop-only)`, async ({ page }) => {
    await page.setViewportSize(MOBILE_412_VIEWPORT);
    const errors = collectConsoleErrors(page);
    const response = await page.goto(`${SPA_URL}${ROOT_ROUTE.path}`);

    expect(response?.status(), `${ROOT_ROUTE.path} did not serve 200`).toBe(HTTP_OK);
    await expectPageViewBeacon(analytics);
    expect(errors, `console errors on ${ROOT_ROUTE.path} at 412x823:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the not-found page renders with zero unexpected console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(`${SPA_URL}${NOT_FOUND_ROUTE.path}`);

    expect(response?.status()).toBe(HTTP_NOT_FOUND);
    await expect(page.getByTestId(NOT_FOUND_ROUTE.screenTestId)).toBeVisible();
    await expectPageViewBeacon(analytics);
    expect(errors, `console errors on ${NOT_FOUND_ROUTE.path}:\n${errors.join('\n')}`).toEqual([]);
  });
});
