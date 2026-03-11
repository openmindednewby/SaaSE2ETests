import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Settings Page Tab Keyboard Navigation
 *
 * Verifies proper ARIA tab pattern implementation on the /settings page:
 * - Container has role="tablist"
 * - Tab buttons have role="tab"
 * - Tab panel has role="tabpanel"
 * - Arrow keys navigate between tabs
 * - aria-selected updates correctly
 * - Tab panel content changes when tabs switch
 * - Home/End keys jump to first/last tab
 *
 * The settings page uses the useTabNavigation hook which provides
 * all ARIA attributes and keyboard navigation.
 *
 * @tag @theme-studio @accessibility @settings @keyboard-navigation
 */

test.describe.serial('Settings Tab Keyboard Navigation @theme-studio @accessibility @settings', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
    await studioPage.gotoStudio('/settings');
    await expect(
      page.locator('[data-testid="settings-page"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should have a tablist container with role="tablist"', async () => {
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible();
  });

  test('should have three tabs with role="tab"', async () => {
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(3);
  });

  test('should have Account tab selected by default with aria-selected="true"', async () => {
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    await expect(accountTab).toHaveAttribute('role', 'tab');
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should have other tabs with aria-selected="false" by default', async () => {
    const appearanceTab = page.locator('[data-testid="settings-tab-appearance"]');
    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');

    await expect(appearanceTab).toHaveAttribute('aria-selected', 'false');
    await expect(notificationsTab).toHaveAttribute('aria-selected', 'false');
  });

  test('should have a tabpanel with role="tabpanel"', async () => {
    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeVisible();
  });

  test('should have tabpanel with aria-labelledby referencing the active tab', async () => {
    const tabpanel = page.locator('[role="tabpanel"]');
    const labelledBy = await tabpanel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    // Should reference the account tab (default)
    expect(labelledBy).toContain('account');
  });

  test('should have active tab with tabIndex=0 and inactive tabs with tabIndex=-1', async () => {
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    const appearanceTab = page.locator('[data-testid="settings-tab-appearance"]');
    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');

    await expect(accountTab).toHaveAttribute('tabindex', '0');
    await expect(appearanceTab).toHaveAttribute('tabindex', '-1');
    await expect(notificationsTab).toHaveAttribute('tabindex', '-1');
  });

  test('should navigate to next tab with ArrowRight key', async () => {
    // Focus the tablist by clicking the active tab
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    await accountTab.click();

    // Press ArrowRight to move to Appearance tab
    await page.keyboard.press('ArrowRight');

    const appearanceTab = page.locator('[data-testid="settings-tab-appearance"]');
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(accountTab).toHaveAttribute('aria-selected', 'false');
  });

  test('should update tabpanel content when tab changes via keyboard', async () => {
    // The appearance tab should now be active from previous test
    const tabpanel = page.locator('[role="tabpanel"]');
    const labelledBy = await tabpanel.getAttribute('aria-labelledby');
    expect(labelledBy).toContain('appearance');
  });

  test('should navigate to next tab with ArrowRight from Appearance to Notifications', async () => {
    // Appearance is already selected from previous test
    await page.keyboard.press('ArrowRight');

    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');
    await expect(notificationsTab).toHaveAttribute('aria-selected', 'true');

    const tabpanel = page.locator('[role="tabpanel"]');
    const labelledBy = await tabpanel.getAttribute('aria-labelledby');
    expect(labelledBy).toContain('notifications');
  });

  test('should wrap around to first tab when pressing ArrowRight on last tab', async () => {
    // Notifications is the last tab, pressing ArrowRight should go to Account
    await page.keyboard.press('ArrowRight');

    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should navigate to previous tab with ArrowLeft key', async () => {
    // Account is selected, pressing ArrowLeft should wrap to Notifications
    await page.keyboard.press('ArrowLeft');

    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');
    await expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should jump to first tab with Home key', async () => {
    // Notifications is selected
    await page.keyboard.press('Home');

    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should jump to last tab with End key', async () => {
    // Account is selected
    await page.keyboard.press('End');

    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');
    await expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should update tabIndex when tab selection changes', async () => {
    // Notifications is selected from previous test
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    const appearanceTab = page.locator('[data-testid="settings-tab-appearance"]');
    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');

    await expect(notificationsTab).toHaveAttribute('tabindex', '0');
    await expect(accountTab).toHaveAttribute('tabindex', '-1');
    await expect(appearanceTab).toHaveAttribute('tabindex', '-1');
  });

  test('should have aria-controls linking tab to its panel', async () => {
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    const ariaControls = await accountTab.getAttribute('aria-controls');
    expect(ariaControls, 'Tab should have aria-controls').toBeTruthy();

    // Verify the panel referenced by aria-controls exists when this tab is active
    if (ariaControls) {
      // Click account tab to make it active
      await accountTab.click();
      const panel = page.locator(`#${ariaControls}`);
      await expect(panel).toBeVisible();
    }
  });

  test('should display Account content when Account tab is clicked', async () => {
    const accountTab = page.locator('[data-testid="settings-tab-account"]');
    await accountTab.click();
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');

    // The tabpanel should contain account-related content
    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeVisible();
  });

  test('should display Appearance content when Appearance tab is clicked', async () => {
    const appearanceTab = page.locator('[data-testid="settings-tab-appearance"]');
    await appearanceTab.click();
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');

    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeVisible();
  });

  test('should display Notifications content when Notifications tab is clicked', async () => {
    const notificationsTab = page.locator('[data-testid="settings-tab-notifications"]');
    await notificationsTab.click();
    await expect(notificationsTab).toHaveAttribute('aria-selected', 'true');

    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeVisible();
  });
});

// ===========================================================================
// Admin System Settings Tabs (separate page with more tabs)
// ===========================================================================

test.describe.serial('Admin System Settings Tab Navigation @theme-studio @accessibility @settings', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
    await studioPage.gotoStudio('/admin/system-settings');
    await expect(
      page.locator('[data-testid="admin-settings-page"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should have a tablist container with role="tablist"', async () => {
    const tablist = page.locator('[data-testid="admin-settings-tabs"]');
    await expect(tablist).toBeVisible();

    const role = await tablist.getAttribute('role');
    expect(role).toBe('tablist');
  });

  test('should have five tab buttons with role="tab"', async () => {
    const tabs = page.locator('[data-testid="admin-settings-tabs"] [role="tab"]');
    await expect(tabs).toHaveCount(5);
  });

  test('should have General tab selected by default', async () => {
    const generalTab = page.locator('[data-testid="admin-settings-tab-general-btn"]');
    await expect(generalTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should switch to Security tab with ArrowRight', async () => {
    const generalTab = page.locator('[data-testid="admin-settings-tab-general-btn"]');
    await generalTab.click();
    await page.keyboard.press('ArrowRight');

    const securityTab = page.locator('[data-testid="admin-settings-tab-security-btn"]');
    await expect(securityTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should display the corresponding tab panel content', async () => {
    // Security tab is now active
    const securityPanel = page.locator('[data-testid="admin-settings-tab-security"]');
    await expect(securityPanel).toBeVisible();
  });
});
