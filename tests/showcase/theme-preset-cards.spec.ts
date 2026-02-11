import { BrowserContext, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { ThemeSettingsPage } from '../../pages/ThemeSettingsPage.js';

/**
 * E2E Tests for Theme Settings Drawer - Preset Cards
 *
 * Verifies Bug 2 fix: PresetCard.tsx previously used `key={color}`
 * for color swatches, but some presets share colors (e.g., `100 116 139`),
 * causing React duplicate key warnings. The fix generates unique keys
 * based on color + occurrence count via `buildColorKey()`.
 *
 * Tests verify:
 * - All preset cards render correctly
 * - Each preset card shows its color preview strip with swatches
 * - Color swatches have valid background colors (no rendering issues from duplicate keys)
 * - Preset cards have names and active state indicators
 *
 * @tag @showcase @theme-presets @bug-fix
 */

// =============================================================================
// Preset Card Rendering Tests
// =============================================================================

test.describe.serial('Theme Preset Cards @showcase @theme-presets @bug-fix', () => {
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

    // Navigate to any dashboard page to access the Theme Settings drawer
    await themeSettingsPage.goto('/showcase/native-forms');
    await themeSettingsPage.openPresetsTab();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should render preset cards in the Presets tab @critical', async () => {
    await themeSettingsPage.expectDrawerOpen();
    await themeSettingsPage.expectPresetCardsRendered();
  });

  test('should display color preview strips on each preset card @critical', async () => {
    // This is the key test for Bug 2 fix: duplicate keys caused
    // some color swatches to be skipped or rendered incorrectly.
    await themeSettingsPage.expectPresetCardsHaveColorSwatches();
  });

  test('should render all color swatches with valid background colors (no duplicate key issues)', async () => {
    // With duplicate React keys, some DOM elements may not render correctly.
    // Verify each swatch has a valid, non-transparent background color.
    await themeSettingsPage.expectNoDuplicateKeyIssues();
  });

  test('should display preset names on each card', async () => {
    await themeSettingsPage.expectPresetCardsHaveNames();
  });

  test('should indicate the active preset', async () => {
    await themeSettingsPage.expectOneActivePreset();
  });
});
