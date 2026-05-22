import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds } from '../../shared/testIds.js';

/**
 * E2E smoke test for the CURRENT per-menu theming feature in katalogos-web.
 *
 * The old elaborate "Styling" menu-editor UI (separate Styling/Colors/
 * Typography/Layout tabs) has been removed. Per-menu theming is now a small
 * "Theme" section near the bottom of the editor's **Details** tab — a row of
 * predefined theme swatches ("light", "dark", "elegant", "colorful",
 * "minimal"), each rendered with testID `menu-editor-theme-selector-{name}`.
 *
 * This is a thin smoke spec: it only verifies the feature is present and
 * usable end to end (open editor -> select a swatch -> save closes cleanly).
 * It deliberately does NOT exhaustively test theming behaviour.
 */
test.describe.serial('Menu Theme Swatch - Smoke @menu-styling @online-menus', () => {
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(90000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Restore auth from localStorage to sessionStorage on every page load so
    // the session survives navigations (matches the online-menus specs).
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
      } catch {
        // ignore
      }
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    // Persist auth into localStorage so it survives subsequent navigations.
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    menusPage = new OnlineMenusPage(page);
  });

  test.afterAll(async () => {
    test.setTimeout(60000);
    try {
      await menusPage.goto();
      if (testMenuName && await menusPage.menuExists(testMenuName)) {
        if (await menusPage.isMenuActive(testMenuName)) {
          await menusPage.deactivateMenu(testMenuName);
        }
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create a menu for theme-swatch testing', async () => {
    testMenuName = `Theme Swatch Menu ${Date.now()}`;
    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Menu for smoke-testing per-menu theming');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should expose the Theme swatches in the Details tab and save a selection @critical', async () => {
    expect(testMenuName, 'Test menu not created; did the create test run?').toBeTruthy();

    // Open the editor dialog for the menu.
    await menusPage.editMenu(testMenuName);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The "Details" tab carries the Theme section. It is the default active
    // tab; selecting it explicitly keeps the test robust regardless of state.
    const detailsTab = dialog.getByRole('tab', { name: /details/i });
    await expect(detailsTab).toBeVisible({ timeout: 10000 });
    await detailsTab.click();

    // The Theme section renders one swatch per predefined theme, each with a
    // testID of `menu-editor-theme-selector-{name}`. "light" is the default,
    // so pick "dark" (also a free-tier theme — no premium gate).
    const defaultSwatch = dialog.locator(
      `[data-testid="${TestIds.MENU_EDITOR_THEME_SELECTOR}-light"]`,
    );
    const nonDefaultSwatch = dialog.locator(
      `[data-testid="${TestIds.MENU_EDITOR_THEME_SELECTOR}-dark"]`,
    );
    await expect(defaultSwatch).toBeVisible({ timeout: 10000 });
    await expect(nonDefaultSwatch).toBeVisible({ timeout: 10000 });

    // Select the non-default swatch.
    await nonDefaultSwatch.click();

    // Save the menu. An existing menu saves via a PUT to /TenantMenus.
    const savePromise = page.waitForResponse(
      (r) => r.url().includes('/TenantMenus') && r.request().method() === 'PUT',
      { timeout: 15000 },
    ).catch(() => null);
    await menusPage.menuEditorSaveButton.click();
    await savePromise;

    // The editor should close cleanly with no error surfaced.
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/failed|error/i)).toHaveCount(0);
  });
});
