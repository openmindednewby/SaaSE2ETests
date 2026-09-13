import { expect, test, type Page } from '@playwright/test';

import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  NOT_FOUND_ROUTE,
  REAL_ROUTES,
  SPA_URL,
  TestIds,
} from '../../fixtures/nextgame-web';

/**
 * The API-driven suite next to this one is structurally BLIND to a client-side ReferenceError:
 * it imports one module in Node and never renders a screen. This smoke covers exactly that gap —
 * load the served SPA in a real browser and fail on ANY console error, on every signed-out route.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The ONE expected error: Chrome logs the not-found document's own 404 as a failed resource.
    // It is excused only when its location IS the not-found URL, never for any other resource.
    const isNotFoundDocument =
      message.location().url === `${SPA_URL}${NOT_FOUND_ROUTE.path}` && message.text().includes(String(HTTP_NOT_FOUND));
    if (!isNotFoundDocument) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.describe('nextgame SPA console smoke', () => {
  for (const route of REAL_ROUTES) {
    test(`${route.path} renders its own screen with zero console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const response = await page.goto(`${SPA_URL}${route.path}`, { waitUntil: 'networkidle' });

      expect(response?.status(), `${route.path} did not serve 200`).toBe(HTTP_OK);
      await expect(page.getByTestId(route.screenTestId)).toBeVisible();
      // A real route that falls through to the not-found screen must fail here, not pass quietly.
      await expect(page.getByTestId(TestIds.NOT_FOUND_SCREEN)).toHaveCount(0);
      expect(errors, `console errors on ${route.path}:\n${errors.join('\n')}`).toEqual([]);
    });
  }

  test('the not-found page renders with zero unexpected console errors', async ({ page }) => {
    const errors = collectErrors(page);
    const response = await page.goto(`${SPA_URL}${NOT_FOUND_ROUTE.path}`, { waitUntil: 'networkidle' });

    expect(response?.status()).toBe(HTTP_NOT_FOUND);
    await expect(page.getByTestId(NOT_FOUND_ROUTE.screenTestId)).toBeVisible();
    expect(errors, `console errors on ${NOT_FOUND_ROUTE.path}:\n${errors.join('\n')}`).toEqual([]);
  });
});
