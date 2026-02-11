import { BrowserContext, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsPage } from '../../pages/ThemeSettingsPage.js';

/**
 * E2E Tests for Theme Settings Drawer - Layout Full Width Toggle
 *
 * Verifies the "Content Full Width" checkbox in the Layout tab of the
 * Theme Settings drawer. When toggled:
 * - The CSS variable `--content-max-width` changes from `1440px` to `none`
 * - The main content area padding changes from p-6 to p-2
 * - The content container loses its `mx-auto` centering
 *
 * Tests verify:
 * - Default state: checkbox unchecked, default max-width and padding
 * - Toggle ON: CSS variable, padding, and centering update correctly
 * - Toggle OFF: all values revert to defaults
 *
 * @tag @showcase @layout @theme-settings
 */

// =============================================================================
// Layout Full Width Toggle Tests
// =============================================================================

test.describe.serial('Layout Full Width Toggle @showcase @layout @theme-settings', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let themeSettingsPage: ThemeSettingsPage;

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

    themeSettingsPage = new ThemeSettingsPage(page);

    // Navigate to a dashboard page to access the Theme Settings drawer
    await themeSettingsPage.goto('/showcase/native-forms');
    await themeSettingsPage.openLayoutTab();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display the Layout tab with full width checkbox visible @critical', async () => {
    await themeSettingsPage.expectDrawerOpen();
    await themeSettingsPage.expectFullWidthCheckboxUnchecked();
  });

  test('should have default --content-max-width CSS variable set to 1440px @critical', async () => {
    await themeSettingsPage.expectDefaultContentMaxWidth();
  });

  test('should have standard padding on main content area by default', async () => {
    await themeSettingsPage.expectStandardPadding();
  });

  test('should have mx-auto centering on content container by default', async () => {
    await themeSettingsPage.expectContentCentered();
  });

  test('should set --content-max-width to none when full width is toggled ON @critical', async () => {
    await themeSettingsPage.toggleFullWidthCheckbox();
    await themeSettingsPage.expectFullWidthCheckboxChecked();
    await themeSettingsPage.expectFullWidthContentMaxWidth();
  });

  test('should apply reduced padding when full width is ON', async () => {
    await themeSettingsPage.expectReducedPadding();
  });

  test('should remove mx-auto centering when full width is ON', async () => {
    await themeSettingsPage.expectContentNotCentered();
  });

  test('should restore --content-max-width to 1440px when toggled OFF @critical', async () => {
    await themeSettingsPage.toggleFullWidthCheckbox();
    await themeSettingsPage.expectFullWidthCheckboxUnchecked();
    await themeSettingsPage.expectDefaultContentMaxWidth();
  });

  test('should restore standard padding when full width is toggled OFF', async () => {
    await themeSettingsPage.expectStandardPadding();
  });

  test('should restore mx-auto centering when full width is toggled OFF', async () => {
    await themeSettingsPage.expectContentCentered();
  });
});
