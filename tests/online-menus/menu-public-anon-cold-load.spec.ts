import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';
import { OnlineMenusPublicPage } from '../../pages/OnlineMenusPublicPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/**
 * Regression: the SINGULAR public menu URL `/public/menu/{id}` must render for a
 * COLD, ANONYMOUS browser load — the real diner path behind every QR / share link
 * (P1-08 last mile).
 *
 * Coverage gap this closes: the other `@public-viewer` specs verify the viewer via
 * the in-app PREVIEW MODAL or the PLURAL `/public/menus` list — an AUTHENTICATED
 * page (a hard nav to the singular URL redirects an authenticated session to the
 * admin app). None of them hard-navigate a FRESH, unauthenticated context to the
 * singular `/public/menu/{id}`, so the diner path went untested.
 *
 * The failure mode it guards: the public route ships a large (~2.5 MB) `_layout`
 * chunk. Any tooling that re-navigates while that chunk is still downloading aborts
 * it (net::ERR_ABORTED) → React never mounts → blank body + zero `/public/menus/`
 * calls. So this spec loads ONCE and waits for the `/public/menus/` response (which
 * only fires after the route chunk mounts), then asserts the viewer — and asserts
 * the route chunk did NOT abort.
 */
test.describe.serial('Public Menu — cold anonymous singular URL @online-menus @public-viewer', () => {
  const SETUP_TIMEOUT = 120_000;
  const NAV_TIMEOUT = 60_000;
  const RENDER_TIMEOUT = 45_000;

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let publicPage: OnlineMenusPublicPage;
  let testMenuName: string;
  let publicUrl: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(SETUP_TIMEOUT);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
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
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    menusPage = new OnlineMenusPage(page);
    editorPage = new OnlineMenusEditorPage(page);
    publicPage = new OnlineMenusPublicPage(page);

    // Clean slate (free-tier 2-menu cap) then build + publish a real menu.
    await menusPage.deleteAllMenus();

    testMenuName = `Anon Cold Load ${Date.now()}`;
    await menusPage.goto();
    await menusPage.waitForLoading();
    await expect(menusPage.createMenuButton).toBeVisible({ timeout: 10_000 });
    await menusPage.createMenu(testMenuName, 'Menu for cold anonymous load testing');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10_000 });
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Test Category');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Test Item');
    await editorPage.updateMenuItemPrice(0, 0, '9.99');
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.activateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, true);

    // Read the exact public URL a diner would scan, straight from the QR modal.
    await publicPage.openQrCodeModal(testMenuName);
    publicUrl = (await publicPage.qrCodeUrlText.textContent({ timeout: 10_000 }))?.trim() ?? '';
    await publicPage.closeQrCodeModal().catch(() => undefined);
    expect(publicUrl, 'QR modal did not expose a singular /public/menu/ URL').toMatch(/\/public\/menu\//);
  });

  test.afterAll(async () => {
    test.setTimeout(SETUP_TIMEOUT);
    try {
      await menusPage.goto();
      await menusPage.waitForLoading();
      if (testMenuName && (await menusPage.menuExists(testMenuName))) {
        if (await menusPage.isMenuActive(testMenuName)) {
          await menusPage.deactivateMenu(testMenuName);
        }
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // ignore cleanup errors
    }
    await context?.close();
  });

  test('renders the viewer on a single cold anonymous load of /public/menu/{id} @critical', async ({ browser }) => {
    test.setTimeout(SETUP_TIMEOUT);
    expect(publicUrl, 'public URL not captured in setup').toBeTruthy();

    // A FRESH, unauthenticated context — the real diner. seedClientState is not
    // needed here: the public-menu tour and cookie banner do not block a read-only
    // assertion on the viewer, and asserting on a truly-cold context is the point.
    const anonContext = await browser.newContext();
    try {
      const anon = await anonContext.newPage();

      const abortedChunks: string[] = [];
      anon.on('requestfailed', (r) => {
        const u = r.url();
        if (u.includes('/_expo/static/js/') || u.includes('/public/menus')) {
          abortedChunks.push(`${u.split('/').pop() ?? u}:${r.failure()?.errorText ?? ''}`);
        }
      });
      let menuApiFired = false;
      anon.on('response', (r) => {
        if (r.url().includes('/public/menus/')) menuApiFired = true;
      });

      const viewer = anon.locator(testIdSelector(TestIds.PUBLIC_MENU_VIEWER));
      const nameText = anon.getByText(testMenuName, { exact: false }).first();
      const target = viewer.or(nameText).first();

      // Load ONCE. Wait for the public fetch (fires only after the route chunk
      // mounts) — no re-goto, so the 2.5 MB chunk is never aborted mid-flight.
      // `waitUntil:'commit'` + an actionable `waitForResponse`: `goto` resolves
      // early, but the public fetch fires only after the route chunk mounts, so
      // awaiting it proves the chunk loaded without a chunk-aborting re-navigation.
      const menuFetched = anon
        .waitForResponse((r) => r.url().includes('/public/menus/'), { timeout: NAV_TIMEOUT })
        .catch(() => null);
      await anon.goto(publicUrl, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
      await menuFetched;

      await expect(target).toBeVisible({ timeout: RENDER_TIMEOUT });

      // The exact hidden-regression guards: the route bootstrapped (API fired) and
      // no route/layout chunk was aborted mid-download.
      expect(menuApiFired, 'anon cold load never issued the /public/menus/{id} fetch').toBe(true);
      expect(abortedChunks, `route/layout chunk aborted on cold load: ${abortedChunks.join(', ')}`).toEqual([]);
      await expect(anon.locator('body')).not.toContainText(
        /something went wrong|unexpected error occurred/i,
        { timeout: 5_000 },
      );
    } finally {
      await anonContext.close();
    }
  });
});
