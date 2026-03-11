import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { TenantThemesPage } from '../../pages/TenantThemesPage.js';

/**
 * E2E Tests for Tenant Theme Editor Navigation & Structure
 *
 * Verifies page navigation, structural elements, and section visibility.
 *
 * @tag @tenant-themes @navigation
 */
test.describe.serial('Tenant Theme Editor Navigation @tenant-themes @navigation', () => {
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

  test('should navigate to tenant themes page @critical', async () => {
    await themesPage.goto();
    await themesPage.expectPageLoaded();
  });

  test('should not show loading indicator after load completes', async () => {
    await expect(themesPage.loadingIndicator).not.toBeVisible();
  });

  test('should display theme editor content', async () => {
    await themesPage.expectPreviewVisible();
  });

  test('should show correct page title', async () => {
    await expect(themesPage.pageTitle).toBeVisible();
    await expect(themesPage.pageTitle).toHaveText('Theme Editor');
  });

  test('should display brand color inputs', async () => {
    await expect(themesPage.primaryColorInput).toBeVisible();
    await expect(themesPage.secondaryColorInput).toBeVisible();
    await expect(themesPage.accentColorInput).toBeVisible();
  });

  test('should display save and reset buttons', async () => {
    await expect(themesPage.saveButton).toBeVisible();
    await themesPage.expectResetButtonVisible();
  });

  test('should display preset grid section', async () => {
    const presetCount = await themesPage.presetCards.count();
    expect(presetCount).toBeGreaterThanOrEqual(2);
  });

  test('should display typography scale input', async () => {
    await expect(themesPage.typographyScaleInput).toBeVisible();
  });

  test('should display preview card section', async () => {
    await themesPage.expectPreviewVisible();
  });
});
