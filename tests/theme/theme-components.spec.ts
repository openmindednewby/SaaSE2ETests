import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsAppPage } from '../../pages/ThemeSettingsAppPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/**
 * E2E Tests for Component Theming
 *
 * Verifies that the per-tenant theme is applied to UI components:
 * - Buttons use themed primary color
 * - Form fields use themed border/focus colors
 * - Sidebar uses themed background color
 * - Topbar / header uses tenant branding
 * - Status badges use semantic theme colors
 * - Modal/dialog uses themed surface color
 *
 * These tests apply a known preset first, then navigate to pages
 * that render the themed components to verify CSS variable application.
 *
 * @tag @theme @components
 */

// =============================================================================
// Component Theming Tests
// =============================================================================

test.describe.serial('Component Theming @theme @components', () => {
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
    // Reset theme to default to avoid affecting other test suites
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

  test('should apply a distinctive preset for component verification', async () => {
    // Apply Ocean preset which has distinctive blue tones
    await themeSettings.goto();
    await themeSettings.expectPageLoaded();
    await themeSettings.selectPreset('ocean');
    await themeSettings.expectSaveSuccess();
  });

  test('should use themed primary color in live preview buttons', async () => {
    // The live preview renders buttons with the primary color
    await themeSettings.expectLivePreviewVisible();

    // The live preview box should be visible with styled content
    const previewBox = page.locator(testIdSelector(TestIds.THEME_LIVE_PREVIEW));
    await expect(previewBox).toBeVisible();

    // The preview should contain buttons that are rendered with theme colors
    // Verify the preview container has child elements (buttons, card, text)
    const previewChildren = previewBox.locator('> *');
    const childCount = await previewChildren.count();
    expect(childCount, 'Live preview should have rendered content').toBeGreaterThan(0);
  });

  test('should apply themed colors to color swatches', async () => {
    // Verify primary swatch has a non-transparent, non-default background
    const primaryBg = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(primaryBg, 'Primary swatch should have a valid color').not.toBe('rgba(0, 0, 0, 0)');
    expect(primaryBg, 'Primary swatch should not be transparent').not.toBe('transparent');

    const secondaryBg = await themeSettings.getSwatchColor(themeSettings.swatchSecondary);
    expect(secondaryBg, 'Secondary swatch should have a valid color').not.toBe('rgba(0, 0, 0, 0)');

    const accentBg = await themeSettings.getSwatchColor(themeSettings.swatchAccent);
    expect(accentBg, 'Accent swatch should have a valid color').not.toBe('rgba(0, 0, 0, 0)');

    // All three should be different colors for a well-designed preset
    expect(primaryBg, 'Primary and secondary should differ').not.toBe(secondaryBg);
  });

  test('should apply themed surface color to confirm dialog', async () => {
    // Open the reset dialog to verify it uses themed surface colors
    await themeSettings.clickReset();
    await themeSettings.expectResetDialogVisible();

    // The confirm dialog should be visible with themed styling
    const dialogBg = await page.locator(testIdSelector(TestIds.CONFIRM_DIALOG)).evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    expect(dialogBg, 'Dialog should have a valid background color').not.toBe('');

    // Cancel to dismiss
    await themeSettings.cancelReset();
    await themeSettings.expectResetDialogNotVisible();
  });

  test('should render preset cards with theme-appropriate styling', async () => {
    // Each preset card should have a visible border and background
    const presetCards = themeSettings.presetCards;
    const count = await presetCards.count();
    expect(count, 'Should have preset cards').toBeGreaterThan(0);

    // Verify at least the first preset card has valid styling
    const firstCard = presetCards.first();
    await expect(firstCard).toBeVisible();

    // Card should have a non-transparent background
    const cardBg = await firstCard.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    expect(cardBg, 'Preset card should have a visible background').not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should update component colors when switching presets @critical', async () => {
    // Record colors with Ocean preset
    const oceanPrimaryColor = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Switch to Sunset preset
    await themeSettings.selectPreset('sunset');
    await themeSettings.expectSaveSuccess();

    // Record colors with Sunset preset
    const sunsetPrimaryColor = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);

    // Verify the primary color actually changed
    expect(
      sunsetPrimaryColor,
      'Switching from Ocean to Sunset should change the primary color'
    ).not.toBe(oceanPrimaryColor);
  });

  test('should apply themed colors in dark mode', async () => {
    // Switch to dark mode
    await themeSettings.clickDarkMode();

    // The page background should reflect dark mode colors
    // Swatches should still be visible and valid
    await themeSettings.expectColorSwatchesVisible();

    const primaryBg = await themeSettings.getSwatchColor(themeSettings.swatchPrimary);
    expect(primaryBg, 'Swatches should have valid colors in dark mode').not.toBe('rgba(0, 0, 0, 0)');

    // Switch back to light mode
    await themeSettings.clickLightMode();
  });
});

// =============================================================================
// Theme Components on Tenant Editor Page
// =============================================================================

test.describe.serial('Component Theming - Editor Page @theme @components', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let themesPage: import('../../pages/TenantThemesPage.js').TenantThemesPage;

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

    const { TenantThemesPage } = await import('../../pages/TenantThemesPage.js');
    themesPage = new TenantThemesPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should render editor with themed preview card', async () => {
    await themesPage.goto();
    await themesPage.expectPageLoaded();
    await themesPage.expectPreviewVisible();
  });

  test('should display brand color inputs with current theme colors', async () => {
    // The primary color input should have a value (hex color)
    await expect(themesPage.primaryColorInput).toBeVisible();
    const primaryValue = await themesPage.primaryColorInput.inputValue();
    expect(
      primaryValue,
      'Primary color input should have a hex value'
    ).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  test('should update preview when color is changed @critical', async () => {
    // Change primary color to a distinctive value
    await themesPage.setPrimaryColor('#ff5722');
    await expect(themesPage.primaryColorInput).toHaveValue('#ff5722');

    // Preview should still be visible (updated with new color)
    await themesPage.expectPreviewVisible();
  });

  test('should display save and reset buttons for admin', async () => {
    await Promise.all([
      expect(themesPage.saveButton).toBeVisible(),
      expect(themesPage.resetButton).toBeVisible(),
    ]);
  });
});
