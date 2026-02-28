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

  test('should load the theme editor page @critical', async () => {
    await themesPage.goto();
    await themesPage.expectPageLoaded();
    await themesPage.expectPreviewVisible();
  });

  test('should display preset cards', async () => {
    const presetCount = await themesPage.presetCards.count();
    expect(presetCount).toBeGreaterThanOrEqual(2);
  });

  test('should select a preset and update preview', async () => {
    await themesPage.selectPreset('Ocean');
    // Verify the preview section is still visible after preset selection
    await themesPage.expectPreviewVisible();
  });

  test('should edit a brand color field', async () => {
    await themesPage.setPrimaryColor('#e63946');
    // Verify the input accepted the value
    await expect(themesPage.primaryColorInput).toHaveValue('#e63946');
  });

  test('should save theme and show success notification', async () => {
    await themesPage.clickSave();
    await themesPage.expectSaveSuccess();
  });

  test('should reset to default with confirmation dialog', async () => {
    await themesPage.clickReset();
    await themesPage.confirmReset();
    // After reset, the editor should still be loaded
    await themesPage.expectPageLoaded();
  });
});
