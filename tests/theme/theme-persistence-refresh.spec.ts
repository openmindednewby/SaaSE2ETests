import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsAppPage } from '../../pages/ThemeSettingsAppPage.js';

/**
 * E2E Tests for Theme Persistence Across Page Refresh
 *
 * Verifies that theme configuration persists correctly across:
 * - Page refreshes (loaded from cache / API)
 * - Navigation away and back
 *
 * @tag @theme @persistence
 */

// =============================================================================
// Theme Persistence Across Page Refresh
// =============================================================================

test.describe.serial('Theme Persistence - Page Refresh @theme @persistence', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let themeSettings: ThemeSettingsAppPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    themeSettings = new ThemeSettingsAppPage(page);
  });

  test.afterAll(async () => {
    // Reset to default theme to avoid polluting other tests
    try {
      await themeSettings.goto();
      await themeSettings.expectPageLoaded();
      await themeSettings.clickReset();
      await themeSettings.confirmReset();
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should apply a preset for persistence testing @critical', async () => {
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();

    // Select the Forest preset so we have a non-default theme
    await themeSettings.selectPreset('forest');
    await themeSettings.expectSaveSuccess();
  });

  test('should survive page refresh - theme loaded from cache @critical', async () => {
    // Record primary swatch color
    const colorBefore = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Hard refresh to verify theme persists across page reloads (testing persistence)
    // eslint-disable-next-line no-page-reload/no-page-reload
    await page.reload();
    await themeSettings.expectPageLoaded();

    // Verify color is the same after reload
    const colorAfter = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(
      colorAfter,
      'Theme primary color should survive page refresh'
    ).toBe(colorBefore);
  });

  test('should persist theme when navigating away and back', async () => {
    // Record primary swatch color
    const colorBefore = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Navigate to a completely different page
    await page.goto('/tenants', { waitUntil: 'domcontentloaded' });
    await themeSettings.dismissOverlay();

    // Navigate back to theme settings
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();

    // Verify color persisted
    const colorAfter = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(
      colorAfter,
      'Theme color should persist when navigating away and back'
    ).toBe(colorBefore);
  });
});
