import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers, TEST_USERS } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsAppPage } from '../../pages/ThemeSettingsAppPage.js';

/**
 * E2E Tests for Theme Persistence
 *
 * Verifies that theme configuration persists correctly across:
 * - Page refreshes (loaded from cache / API)
 * - Login/logout cycles
 * - Different tenants seeing different themes
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

    // Hard refresh the page
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

// =============================================================================
// Theme Applied on Login / Cleared on Logout
// =============================================================================

test.describe.serial('Theme Persistence - Login/Logout @theme @persistence', () => {
  test.setTimeout(180000);

  let context: BrowserContext;
  let page: Page;
  let loginPage: LoginPage;
  let themeSettings: ThemeSettingsAppPage;

  test.beforeAll(async ({ browser }) => {
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

    loginPage = new LoginPage(page);
    themeSettings = new ThemeSettingsAppPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should apply saved theme on login @critical', async (_fixtures, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Login as admin
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    // Save auth to localStorage for persistence
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    // Navigate to theme settings - theme should already be applied from the API
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();

    // The color swatches should be visible, indicating theme was fetched on login
    await themeSettings.expectColorSwatchesVisible();
  });

  test('should revert to default theme after logout and fresh login @critical', async (_fixtures, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // First, set a specific preset so we can tell when it reverts
    await themeSettings.selectPreset('sunset');
    await themeSettings.expectSaveSuccess();

    // Record the sunset theme color
    const sunsetColor = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Reset to default so the next login gets default
    await themeSettings.clickReset();
    await themeSettings.confirmReset();
    await themeSettings.expectSaveSuccess();

    // Record the default theme color
    const defaultColor = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Verify the colors are different (sunset != default)
    expect(
      sunsetColor,
      'Sunset and default themes should have different primary colors'
    ).not.toBe(defaultColor);

    // Logout
    const logoutButton = page.locator('[data-testid="logout-button"]');
    if (await logoutButton.count() > 0) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    }

    // Login again
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    // Navigate to theme settings - should have default theme
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();

    // Verify the color matches the default, not sunset
    const currentColor = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(
      currentColor,
      'After reset and re-login, theme should be default'
    ).toBe(defaultColor);
  });
});

// =============================================================================
// Different Tenants See Different Themes
// =============================================================================

test.describe('Theme Persistence - Tenant Isolation @theme @persistence @isolation', () => {
  test.setTimeout(180000);

  test('should show different themes for different tenants @critical', async ({ browser }) => {
    // Login as Tenant A admin
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await pageA.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const loginPageA = new LoginPage(pageA);
    await loginPageA.goto();
    await loginPageA.loginAndWait(
      TEST_USERS.TENANT_A_ADMIN.username,
      TEST_USERS.TENANT_A_ADMIN.password
    );

    await pageA.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    const themeSettingsA = new ThemeSettingsAppPage(pageA);

    // Login as Tenant B admin in a separate context
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await pageB.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const loginPageB = new LoginPage(pageB);
    await loginPageB.goto();
    await loginPageB.loginAndWait(
      TEST_USERS.TENANT_B_ADMIN.username,
      TEST_USERS.TENANT_B_ADMIN.password
    );

    await pageB.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    const themeSettingsB = new ThemeSettingsAppPage(pageB);

    try {
      // Set Tenant A to Ocean preset
      await themeSettingsA.goto();
      await themeSettingsA.expectPageLoaded();
      await themeSettingsA.selectPreset('ocean');
      await themeSettingsA.expectSaveSuccess();
      const tenantAColor = await themeSettingsA.getSwatchColor(themeSettingsA.swatchPrimary);

      // Set Tenant B to Sunset preset
      await themeSettingsB.goto();
      await themeSettingsB.expectPageLoaded();
      await themeSettingsB.selectPreset('sunset');
      await themeSettingsB.expectSaveSuccess();
      const tenantBColor = await themeSettingsB.getSwatchColor(themeSettingsB.swatchPrimary);

      // Verify the two tenants have different primary colors
      expect(
        tenantAColor,
        'Tenant A (Ocean) and Tenant B (Sunset) should have different primary colors'
      ).not.toBe(tenantBColor);

      // Refresh both pages and verify persistence is per-tenant
      await themeSettingsA.goto();
      await themeSettingsA.expectPageLoaded();
      const tenantAColorAfter = await themeSettingsA.getSwatchColor(themeSettingsA.swatchPrimary);

      await themeSettingsB.goto();
      await themeSettingsB.expectPageLoaded();
      const tenantBColorAfter = await themeSettingsB.getSwatchColor(themeSettingsB.swatchPrimary);

      expect(tenantAColorAfter, 'Tenant A color should persist').toBe(tenantAColor);
      expect(tenantBColorAfter, 'Tenant B color should persist').toBe(tenantBColor);
    } finally {
      // Cleanup: reset both tenants to default
      try {
        await themeSettingsA.clickReset();
        await themeSettingsA.confirmReset();
      } catch {
        // Ignore cleanup errors
      }
      try {
        await themeSettingsB.clickReset();
        await themeSettingsB.confirmReset();
      } catch {
        // Ignore cleanup errors
      }
      await contextA.close();
      await contextB.close();
    }
  });
});
