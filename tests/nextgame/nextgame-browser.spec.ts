import { mkdirSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  ANALYTICS_HEADING,
  ANALYTICS_HOST,
  HTTP_NOT_FOUND,
  MIN_TARGET_PX,
  MOBILE_VIEWPORT,
  NOT_FOUND_ROUTE,
  POLICY_VERSION_TEXT,
  REAL_ROUTES,
  SPA_URL,
  TestIds,
  UMAMI_WEBSITE_ID,
} from '../../fixtures/nextgame-web';

const [LANDING, PRIVACY, AGE] = REAL_ROUTES;
const SCREENSHOT_DIR = 'test-reports/nextgame';

test.describe('nextgame SPA in a real browser', () => {
  test('each route sets its own document.title after CLIENT-SIDE navigation', async ({ page }) => {
    await page.goto(`${SPA_URL}${LANDING.path}`);
    await expect(page).toHaveTitle(LANDING.title);

    await page.getByTestId(TestIds.LANDING_PRIVACY).click();
    await expect(page).toHaveURL(`${SPA_URL}${PRIVACY.path}`);
    await expect(page).toHaveTitle(PRIVACY.title);

    await page.goBack();
    await expect(page.getByTestId(TestIds.LANDING_SCREEN)).toBeVisible();
    await page.getByTestId(TestIds.LANDING_GUEST).click();
    await expect(page).toHaveURL(`${SPA_URL}${AGE.path}`);
    await expect(page).toHaveTitle(AGE.title);
  });

  for (const route of REAL_ROUTES) {
    test(`a hard load of ${route.path} sets its own title`, async ({ page }) => {
      await page.goto(`${SPA_URL}${route.path}`);
      await expect(page).toHaveTitle(route.title);
    });
  }

  test('the service worker registers at scope / and activates', async ({ page }) => {
    await page.goto(`${SPA_URL}/`);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const registrations = await navigator.serviceWorker.getRegistrations();
          return registrations.map((r) => ({ scope: r.scope, script: r.active?.scriptURL ?? '', state: r.active?.state ?? '' }));
        }),
      )
      .toEqual([{ scope: `${SPA_URL}/`, script: expect.stringMatching(/\/service-worker\.js$/), state: 'activated' }]);
  });

  test('the Umami page-view beacon fires with the nextgame website id', async ({ page }, testInfo) => {
    const beacon = page.waitForRequest(
      (request) => request.method() === 'POST' && (request.postData() ?? '').includes(UMAMI_WEBSITE_ID),
    );
    await page.goto(`${SPA_URL}/`);
    await expect(page.locator(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`)).toHaveAttribute('src', new RegExp(ANALYTICS_HOST));

    const request = await beacon;
    const response = await request.response();
    const host = new URL(request.url()).host;
    testInfo.annotations.push({ type: 'umami-beacon', description: `host=${host} status=${String(response?.status())}` });
    expect(host).toBe(ANALYTICS_HOST);
    expect(response, 'beacon got no response').not.toBeNull();
  });

  test('an unknown path is a real 404 with the not-found title and noindex', async ({ page }) => {
    const response = await page.goto(`${SPA_URL}${NOT_FOUND_ROUTE.path}`);
    expect(response?.status()).toBe(HTTP_NOT_FOUND);
    await expect(page).toHaveTitle(NOT_FOUND_ROUTE.title);
    const robots = page.locator('meta[name="robots"]');
    await expect(robots.first()).toBeAttached();
    const contents = await robots.evaluateAll((els) => els.map((e) => e.getAttribute('content') ?? ''));
    for (const content of contents) expect(content).toContain('noindex');
  });

  test('privacy states the current policy version and the analytics section', async ({ page }) => {
    await page.goto(`${SPA_URL}${PRIVACY.path}`);
    const screen = page.getByTestId(TestIds.PRIVACY_SCREEN);
    await expect(screen).toBeVisible();
    await expect(screen.getByText(POLICY_VERSION_TEXT, { exact: true })).toBeVisible();
    // No testID exists on the analytics section (logged as a gap); scoped to the screen testID.
    await expect(screen.getByText(ANALYTICS_HEADING, { exact: true })).toBeVisible();
  });

  test.describe('at 400px wide', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    for (const route of [...REAL_ROUTES, NOT_FOUND_ROUTE]) {
      test(`${route.path} has no horizontal scroll and 44px targets`, async ({ page }) => {
        await page.goto(`${SPA_URL}${route.path}`);
        await expect(page.getByTestId(route.screenTestId)).toBeVisible();
        expect(await page.evaluate(() => window.innerWidth)).toBe(MOBILE_VIEWPORT.width);
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
        expect(widths.scroll, 'page scrolls horizontally').toBeLessThanOrEqual(widths.inner);

        const targets = page.locator('button, a[href], [role="button"], [role="link"]');
        const boxes = await targets.evaluateAll((els) =>
          els
            .map((e) => ({ label: (e.getAttribute('data-testid') ?? e.textContent ?? '').slice(0, 40), rect: e.getBoundingClientRect() }))
            .filter((t) => t.rect.width > 0 && t.rect.height > 0)
            .map((t) => ({ label: t.label, width: Math.round(t.rect.width), height: Math.round(t.rect.height) })),
        );
        expect(boxes.length, 'no interactive targets found').toBeGreaterThan(0);
        const small = boxes.filter((b) => b.width < MIN_TARGET_PX || b.height < MIN_TARGET_PX);
        expect(small, `targets under ${String(MIN_TARGET_PX)}px`).toEqual([]);

        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-400-${route.name}.png`, fullPage: true });
      });
    }
  });
});
