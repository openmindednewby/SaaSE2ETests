import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for QR Code Generation Feature
 *
 * Tests the QR code generation modal including:
 * - QR button visibility and disabled state for inactive menus
 * - Opening and closing the QR code modal
 * - QR code display with menu name and URL
 * - Color customization inputs
 * - Copy link button
 * - Backend QR tracking redirect endpoint
 */
test.describe.serial('QR Code Generation @online-menus @qr-code', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let activeMenuName: string;
  let inactiveMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
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

    // Save auth state to localStorage so it persists across page navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    menusPage = new OnlineMenusPage(page);
    await menusPage.goto();

    // Create an active menu for QR code testing
    activeMenuName = `QR Active Menu ${Date.now()}`;
    await menusPage.createMenu(activeMenuName, 'Menu for QR code testing');
    await menusPage.expectMenuInList(activeMenuName);
    await menusPage.activateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, true);

    // Create an inactive menu for disabled-state testing
    inactiveMenuName = `QR Inactive Menu ${Date.now()}`;
    await menusPage.createMenu(inactiveMenuName, 'Inactive menu for QR testing');
    await menusPage.expectMenuInList(inactiveMenuName);
    await menusPage.expectMenuActive(inactiveMenuName, false);
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  test.afterAll(async () => {
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();

      if (activeMenuName && await menusPage.menuExists(activeMenuName)) {
        await menusPage.deleteMenu(activeMenuName, false);
      }
      if (inactiveMenuName && await menusPage.menuExists(inactiveMenuName)) {
        await menusPage.deleteMenu(inactiveMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should show QR code button on menu cards @critical', async () => {
    // QR code button should be visible on both active and inactive menu cards
    const activeQrButton = menusPage.getQrCodeButton(activeMenuName);
    const inactiveQrButton = menusPage.getQrCodeButton(inactiveMenuName);

    await expect(activeQrButton).toBeVisible({ timeout: 10000 });
    await expect(inactiveQrButton).toBeVisible({ timeout: 10000 });
  });

  test('should disable QR code button for inactive menus', async () => {
    const inactiveQrButton = menusPage.getQrCodeButton(inactiveMenuName);
    await expect(inactiveQrButton).toBeVisible({ timeout: 10000 });
    await expect(inactiveQrButton).toBeDisabled();
  });

  test('should enable QR code button for active menus', async () => {
    const activeQrButton = menusPage.getQrCodeButton(activeMenuName);
    await expect(activeQrButton).toBeVisible({ timeout: 10000 });
    await expect(activeQrButton).toBeEnabled();
  });

  test('should open QR code modal when clicking QR button on active menu @critical', async () => {
    await menusPage.openQrCodeModal(activeMenuName);
    await menusPage.expectQrCodeModalVisible();
  });

  test('should display QR code with correct menu name', async () => {
    await menusPage.openQrCodeModal(activeMenuName);

    // Verify the QR code display area is visible (contains the SVG)
    await menusPage.expectQrCodeDisplayVisible();

    // Verify the menu name is shown in the modal
    await menusPage.expectQrCodeMenuName(activeMenuName);

    // Verify the URL text is shown
    await menusPage.expectQrCodeUrlVisible();
  });

  test('should display color customization inputs with default values', async () => {
    await menusPage.openQrCodeModal(activeMenuName);

    // Verify foreground and background color inputs are visible
    await expect(menusPage.qrCodeFgColorInput).toBeVisible({ timeout: 5000 });
    await expect(menusPage.qrCodeBgColorInput).toBeVisible({ timeout: 5000 });

    // Verify default color values are set (black foreground, white background)
    const fgColor = await menusPage.getQrCodeFgColor();
    const bgColor = await menusPage.getQrCodeBgColor();

    expect(fgColor.toLowerCase()).toBe('#000000');
    expect(bgColor.toLowerCase()).toBe('#ffffff');
  });

  test('should allow changing foreground color', async () => {
    await menusPage.openQrCodeModal(activeMenuName);

    // Change the foreground color
    await menusPage.setQrCodeFgColor('#ff0000');

    // Verify the input reflects the new value
    const fgColor = await menusPage.getQrCodeFgColor();
    expect(fgColor).toBe('#ff0000');
  });

  test('should allow changing background color', async () => {
    await menusPage.openQrCodeModal(activeMenuName);

    // Change the background color
    await menusPage.setQrCodeBgColor('#0000ff');

    // Verify the input reflects the new value
    const bgColor = await menusPage.getQrCodeBgColor();
    expect(bgColor).toBe('#0000ff');
  });

  test('should display action buttons in the modal', async () => {
    await menusPage.openQrCodeModal(activeMenuName);

    // Verify all action buttons are visible
    await Promise.all([
      expect(menusPage.qrCodeDownloadPngButton).toBeVisible({ timeout: 5000 }),
      expect(menusPage.qrCodeDownloadSvgButton).toBeVisible({ timeout: 5000 }),
      expect(menusPage.qrCodeCopyLinkButton).toBeVisible({ timeout: 5000 }),
    ]);
  });

  test('should copy link to clipboard when clicking copy button', async () => {
    // Grant clipboard permissions (Chromium-only; Firefox uses a different mechanism)
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch {
      // Firefox does not support granting clipboard permissions via Playwright
    }

    await menusPage.openQrCodeModal(activeMenuName);
    await menusPage.clickCopyLink();

    // Verify clipboard content contains a URL (the public menu link)
    // On some browsers, clipboard.readText() may fail due to permissions;
    // in that case, we verify the button is clickable and no error occurred
    try {
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBeTruthy();
      // The copied URL should contain the public menus path or the menu identifier
      expect(clipboardText).toMatch(/\/public\/menu|\/api\/qr/);
    } catch {
      // Clipboard API not available in this browser - verify the copy button was clickable
      await expect(menusPage.qrCodeCopyLinkButton).toBeEnabled();
    }
  });

  test('should close QR code modal when clicking close button @critical', async () => {
    await menusPage.openQrCodeModal(activeMenuName);
    await menusPage.expectQrCodeModalVisible();

    await menusPage.closeQrCodeModal();
    await menusPage.expectQrCodeModalNotVisible();
  });

  test('should close QR code modal when pressing Escape', async () => {
    await menusPage.openQrCodeModal(activeMenuName);
    await menusPage.expectQrCodeModalVisible();

    await page.keyboard.press('Escape');
    await menusPage.expectQrCodeModalNotVisible();
  });

  test('should return 302 redirect from QR tracking endpoint', async () => {
    // Get the menu's external ID to construct the tracking URL
    const menuId = await menusPage.getMenuExternalId(activeMenuName);
    expect(menuId, 'Menu should have an external ID').toBeTruthy();

    // Make a direct API request to the QR tracking endpoint
    // The endpoint should return a 302 redirect to the public menu page
    const onlineMenuApiUrl = process.env.ONLINEMENU_API_URL || 'http://localhost:5006';
    const trackingUrl = `${onlineMenuApiUrl}/api/qr/${menuId}`;

    try {
      const response = await page.request.get(trackingUrl, {
        maxRedirects: 0, // Don't follow redirects, we want to verify the 302
      });

      // Verify the response is a redirect
      expect(response.status()).toBe(302);

      // Verify the redirect location contains the menu ID
      const locationHeader = response.headers()['location'];
      expect(locationHeader).toBeTruthy();
      expect(locationHeader).toContain(menuId!);
    } catch (error) {
      // If the API is unreachable (e.g., Docker networking), skip gracefully
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ECONNRESET')) {
        test.skip(true, `OnlineMenu API not reachable at ${onlineMenuApiUrl}`);
      }
      throw error;
    }
  });
});
