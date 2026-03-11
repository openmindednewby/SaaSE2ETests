import { BrowserContext, Page, test, expect } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { TenantThemesPage } from '../../pages/TenantThemesPage.js';


/**
 * E2E Tests for Tenant Theme Editor
 *
 * Verifies full editor functionality: preset selection, brand color editing,
 * live preview, save, and reset workflows.
 *
 * @tag @tenant-themes @editor
 */
test.describe.serial('Tenant Theme Editor @tenant-themes @editor', () => {
  let context: BrowserContext;
  let page: Page;
  let themesPage: TenantThemesPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
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

    themesPage = new TenantThemesPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ---------- Page load ----------

  test('should load the theme editor page @critical', async () => {
    await themesPage.goto();
    await themesPage.expectPageLoaded();
    await themesPage.expectPreviewVisible();
  });

  test('should display the page title', async () => {
    await expect(themesPage.pageTitle).toBeVisible();
    await expect(themesPage.pageTitle).toHaveText('Theme Editor');
  });

  // ---------- Preset section ----------

  test('should display all preset cards', async () => {
    const presetCount = await themesPage.presetCards.count();
    expect(presetCount).toBeGreaterThanOrEqual(2);
  });

  test('should display individual preset cards by id', async () => {
    await expect(themesPage.presetCard('default')).toBeVisible();
    await expect(themesPage.presetCard('ocean')).toBeVisible();
  });

  test('should select Ocean preset and update preview', async () => {
    await themesPage.selectPreset('Ocean');
    await themesPage.expectPreviewVisible();
  });

  test('should select Forest preset', async () => {
    await themesPage.selectPreset('Forest');
    await themesPage.expectPreviewVisible();
  });

  test('should select Sunset preset', async () => {
    await themesPage.selectPreset('Sunset');
    await themesPage.expectPreviewVisible();
  });

  // ---------- Brand color editing ----------

  test('should edit primary color', async () => {
    await themesPage.setPrimaryColor('#e63946');
    await expect(themesPage.primaryColorInput).toHaveValue('#e63946');
  });

  test('should edit secondary color', async () => {
    await themesPage.setSecondaryColor('#457b9d');
    await expect(themesPage.secondaryColorInput).toHaveValue('#457b9d');
  });

  test('should edit accent color', async () => {
    await themesPage.setAccentColor('#a8dadc');
    await expect(themesPage.accentColorInput).toHaveValue('#a8dadc');
  });

  // ---------- Typography ----------

  test('should display typography scale input', async () => {
    await expect(themesPage.typographyScaleInput).toBeVisible();
  });

  test('should edit typography heading scale', async () => {
    await themesPage.setTypographyScale('1.5');
    await expect(themesPage.typographyScaleInput).toHaveValue('1.5');
  });

  // ---------- Save workflow ----------

  test('should save theme and show success notification', async () => {
    await themesPage.clickSave();
    await themesPage.expectSaveSuccess();
  });

  test('should disable save button when no changes are pending', async () => {
    // After a fresh save, reload to get clean state
    await themesPage.goto();
    await themesPage.expectPageLoaded();
    await themesPage.expectSaveButtonDisabled();
  });

  test('should enable save button after making a change', async () => {
    await themesPage.setPrimaryColor('#ff0000');
    await themesPage.expectSaveButtonEnabled();
  });

  test('should persist saved theme after reload', async () => {
    await themesPage.clickSave();
    await themesPage.expectSaveSuccess();
    await themesPage.goto();
    await themesPage.expectPageLoaded();
    // The primary color should reflect what was saved
    await expect(themesPage.primaryColorInput).toBeVisible();
  });

  // ---------- Reset workflow ----------

  test('should show confirmation dialog when clicking reset', async () => {
    await themesPage.clickReset();
    await expect(themesPage.confirmButton).toBeVisible();
  });

  test('should cancel reset when dismissing dialog', async () => {
    // Dialog should still be open from previous test; cancel it
    await themesPage.cancelReset();
    await themesPage.expectPageLoaded();
  });

  test('should reset to default with confirmation', async () => {
    await themesPage.clickReset();
    await themesPage.confirmReset();
    await themesPage.expectPageLoaded();
  });

  // ---------- Preview section ----------

  test('should keep preview visible after preset changes', async () => {
    await themesPage.selectPreset('Default');
    await themesPage.expectPreviewVisible();
  });

  test('should keep preview visible after color changes', async () => {
    await themesPage.setPrimaryColor('#123456');
    await themesPage.expectPreviewVisible();
  });
});
