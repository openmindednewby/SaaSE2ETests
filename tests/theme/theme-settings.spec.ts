import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsAppPage } from '../../pages/ThemeSettingsAppPage.js';

/**
 * E2E Tests for BaseClient Theme Settings Page (/settings/theme)
 *
 * Verifies the theme settings page for admins:
 * - Navigation and loading
 * - Color swatch display
 * - Preset selection and persistence
 * - Light/dark mode toggle
 * - Reset to default with confirmation
 *
 * Non-admin access is tested separately with a user-role login.
 *
 * @tag @theme @settings
 */

// =============================================================================
// Admin Theme Settings Tests
// =============================================================================

test.describe.serial('Theme Settings - Admin @theme @settings', () => {
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
    await context?.close();
  });

  test('should navigate to theme settings page @critical', async () => {
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();
  });

  test('should show current theme preview with color swatches', async () => {
    await themeSettings.expectColorSwatchesVisible();
  });

  test('should display preset cards for selection', async () => {
    const count = await themeSettings.getPresetCardCount();
    expect(count, 'Should display at least 2 preset cards').toBeGreaterThanOrEqual(2);
  });

  test('should select a preset and see it applied @critical', async () => {
    // Select the Ocean preset
    await themeSettings.selectPreset('ocean');

    // After selecting a preset, the save mutation fires and a toast appears
    await themeSettings.expectSaveSuccess();

    // Color swatches should still be visible (updated with new colors)
    await themeSettings.expectColorSwatchesVisible();
  });

  test('should show live preview after preset selection', async () => {
    await themeSettings.expectLivePreviewVisible();
  });

  test('should persist preset selection after page refresh @critical', async () => {
    // Record the primary swatch color before refresh
    const colorBefore = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Navigate away and back to force a fresh API load
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();

    // Verify the primary swatch color is the same after re-navigating
    const colorAfter = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(
      colorAfter,
      'Primary swatch color should persist after page refresh'
    ).toBe(colorBefore);
  });

  test('should toggle light/dark mode', async () => {
    // Verify both mode buttons are visible for admin
    await Promise.all([
      themeSettings.expectModeLightActive(),
      themeSettings.expectModeDarkActive(),
    ]);

    // Click dark mode
    await themeSettings.clickDarkMode();

    // The page background should update (dark themes have darker backgrounds)
    // We verify mode buttons are still functional
    await themeSettings.expectModeDarkActive();

    // Switch back to light mode
    await themeSettings.clickLightMode();
    await themeSettings.expectModeLightActive();
  });

  test('should show admin controls (customize, reset, presets)', async () => {
    await themeSettings.expectAdminControlsVisible();
  });

  test('should show reset confirmation dialog when reset is clicked', async () => {
    await themeSettings.clickReset();
    await themeSettings.expectResetDialogVisible();
  });

  test('should cancel reset when cancel is clicked', async () => {
    await themeSettings.cancelReset();
    await themeSettings.expectResetDialogNotVisible();

    // Page should still be loaded and functional
    await themeSettings.expectPageLoaded();
  });

  test('should reset to default with confirmation dialog @critical', async () => {
    // First select a non-default preset so reset has an effect
    await themeSettings.selectPreset('sunset');
    await themeSettings.expectSaveSuccess();

    // Now reset to default
    await themeSettings.clickReset();
    await themeSettings.expectResetDialogVisible();
    await themeSettings.confirmReset();

    // Should show success notification and page should still be loaded
    await themeSettings.expectSaveSuccess();
    await themeSettings.expectPageLoaded();
    await themeSettings.expectColorSwatchesVisible();
  });
});

// =============================================================================
// Non-Admin Theme Settings Tests
// =============================================================================

test.describe.serial('Theme Settings - Non-Admin @theme @settings', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let themeSettings: ThemeSettingsAppPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { user: regularUser } = getProjectUsers(testInfo.project.name);

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
    await loginPage.loginAndWait(regularUser.username, regularUser.password);

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    themeSettings = new ThemeSettingsAppPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should load theme settings page for non-admin user', async () => {
    await themeSettings.goto();
    // Non-admins should see either a read-only view or the color swatches
    // but NOT the admin controls (customize/reset buttons)
    await themeSettings.expectPageLoaded();
  });

  test('should not show admin controls for non-admin user @critical', async () => {
    await themeSettings.expectAdminControlsNotVisible();
  });

  test('should still display current theme summary for non-admin', async () => {
    // Non-admins can see the current theme swatches as a read-only summary
    await themeSettings.expectColorSwatchesVisible();
  });
});
