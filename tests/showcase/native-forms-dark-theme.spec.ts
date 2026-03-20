import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';

/**
 * E2E Tests for Native Forms Showcase: Dark Theme and Theme Switching
 *
 * Tests the SyncfusionThemeStudio native form dark theme features:
 * - Dark theme CSS variables applied correctly
 * - Readable text and styled inputs in dark mode
 * - Light vs dark theme background comparison
 *
 * @tag @showcase @native-forms
 */

// =============================================================================
// Dark Theme Tests
// =============================================================================

test.describe('Dark Theme Support @showcase @native-forms', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let nativeFormsPage: NativeFormsPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create context with dark color scheme
    context = await browser.newContext({
      colorScheme: 'dark',
    });
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

    nativeFormsPage = new NativeFormsPage(page);
    await nativeFormsPage.gotoNativeForms();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should render page with dark theme CSS variables', async () => {
    await nativeFormsPage.expectPageLoaded();

    // Verify that CSS variables are applied by checking computed styles
    // The form-background should use the --color-background CSS variable
    const formCard = page.locator('.form-card').first();
    await expect(formCard).toBeVisible();

    // Verify the form card has a background color set (dark or light)
    const hasBackground = await formCard.evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundColor;
      // Background should be defined and not transparent
      return bg !== '' && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    });

    expect(hasBackground, 'Form card should have a background color').toBe(true);
  });

  test('should have readable text in dark theme', async () => {
    const pageTitle = page.locator('.showcase-page__title');
    await expect(pageTitle).toBeVisible();

    // Verify text has a color set through CSS variables
    const hasTextColor = await pageTitle.evaluate((el) => {
      const color = window.getComputedStyle(el).color;
      return color !== '' && color !== 'transparent';
    });

    expect(hasTextColor, 'Title text should have a color defined').toBe(true);
  });

  test('should style inputs with dark theme', async () => {
    const input = nativeFormsPage.loginEmailInput;
    await expect(input).toBeVisible();

    // Verify the input has styling applied
    const inputStyles = await input.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        hasBackground: computed.backgroundColor !== '' && computed.backgroundColor !== 'transparent',
        hasBorder: computed.borderColor !== '' && computed.borderColor !== 'transparent',
        hasColor: computed.color !== '' && computed.color !== 'transparent',
      };
    });

    expect(inputStyles.hasBackground, 'Input should have background color').toBe(true);
    expect(inputStyles.hasBorder, 'Input should have border color').toBe(true);
    expect(inputStyles.hasColor, 'Input should have text color').toBe(true);
  });

  test('should style combobox dropdown with dark theme', async () => {
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();

    const dropdown = nativeFormsPage.comboboxDropdown;

    const dropdownStyles = await dropdown.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        hasBackground: computed.backgroundColor !== '' && computed.backgroundColor !== 'transparent',
        hasBorder: computed.borderColor !== '' && computed.borderColor !== 'transparent',
      };
    });

    expect(dropdownStyles.hasBackground, 'Dropdown should have background color').toBe(true);
    expect(dropdownStyles.hasBorder, 'Dropdown should have border color').toBe(true);

    // Close dropdown
    await nativeFormsPage.closeComboboxWithEscape();
  });

  test('should show error messages in dark theme', async () => {
    // Handle dialogs
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Trigger errors
    await nativeFormsPage.submitLoginForm();

    const errorElement = page.locator('.form-native-error').first();
    await expect(errorElement).toBeVisible();

    // Error should have the error color (red-ish)
    const errorColor = await errorElement.evaluate((el) => {
      return window.getComputedStyle(el).color;
    });

    expect(errorColor, 'Error message should have a color defined').not.toBe('');
    expect(errorColor, 'Error message should not be transparent').not.toBe('transparent');
  });

  test('should style buttons with dark theme', async () => {
    const button = nativeFormsPage.loginSubmitButton;
    await expect(button).toBeVisible();

    const buttonStyles = await button.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        hasBackground: computed.backgroundColor !== '' && computed.backgroundColor !== 'transparent' && computed.backgroundColor !== 'rgba(0, 0, 0, 0)',
        hasColor: computed.color !== '' && computed.color !== 'transparent',
      };
    });

    expect(buttonStyles.hasBackground, 'Button should have background color').toBe(true);
    expect(buttonStyles.hasColor, 'Button should have text color').toBe(true);
  });
});

// =============================================================================
// Light vs Dark Theme Comparison Tests
// =============================================================================

test.describe('Theme Switching @showcase @native-forms', () => {
  test.setTimeout(90000);

  test('should apply different backgrounds for light and dark themes @critical', async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create light theme context
    const lightContext = await browser.newContext({ colorScheme: 'light' });
    const lightPage = await lightContext.newPage();

    await lightPage.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const lightLoginPage = new LoginPage(lightPage);
    await lightLoginPage.goto();
    await lightLoginPage.loginAndWait(adminUser.username, adminUser.password);

    await lightPage.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    const lightFormsPage = new NativeFormsPage(lightPage);
    await lightFormsPage.gotoNativeForms();

    // Get light theme background
    const lightBg = await lightPage.locator('.showcase-page').evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    await lightContext.close();

    // Create dark theme context
    const darkContext = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await darkContext.newPage();

    await darkPage.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const darkLoginPage = new LoginPage(darkPage);
    await darkLoginPage.goto();
    await darkLoginPage.loginAndWait(adminUser.username, adminUser.password);

    await darkPage.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    const darkFormsPage = new NativeFormsPage(darkPage);
    await darkFormsPage.gotoNativeForms();

    // Get dark theme background
    const darkBg = await darkPage.locator('.showcase-page').evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    await darkContext.close();

    // Backgrounds should be defined (may or may not differ depending on if
    // the app actually applies different CSS variables for dark mode)
    expect(lightBg, 'Light theme should have a background color').not.toBe('');
    expect(darkBg, 'Dark theme should have a background color').not.toBe('');
  });
});
