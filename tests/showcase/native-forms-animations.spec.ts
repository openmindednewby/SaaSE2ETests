import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';

/**
 * E2E Tests for Native Forms Showcase: CSS Animations
 *
 * Tests the SyncfusionThemeStudio native form animation features:
 * - Form card entrance animations
 * - Field staggered fade-in
 * - Error message animations
 * - Reduced motion support
 *
 * @tag @showcase @native-forms
 */

test.describe('CSS Animations @showcase @native-forms', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let nativeFormsPage: NativeFormsPage;

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

    nativeFormsPage = new NativeFormsPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should render form cards visible after animations complete', async () => {
    await nativeFormsPage.gotoNativeForms();

    // All form cards should be visible after animation completes
    const formCards = page.locator('.form-card');
    const EXPECTED_FORM_CARDS = 4;
    await expect(formCards).toHaveCount(EXPECTED_FORM_CARDS);

    // Each card should be visible (opacity: 1 after animation)
    const FIRST_CARD = 0;
    const SECOND_CARD = 1;
    const THIRD_CARD = 2;
    const FOURTH_CARD = 3;
    await Promise.all([
      expect(formCards.nth(FIRST_CARD)).toBeVisible(),
      expect(formCards.nth(SECOND_CARD)).toBeVisible(),
      expect(formCards.nth(THIRD_CARD)).toBeVisible(),
      expect(formCards.nth(FOURTH_CARD)).toBeVisible(),
    ]);
  });

  test('should render form fields visible after staggered animation', async () => {
    // All form fields should be visible after staggered fade-in animation
    const formFields = page.locator('.form-native-field');
    const fieldCount = await formFields.count();

    expect(fieldCount, 'Should have form fields on the page').toBeGreaterThan(0);

    // First and last fields should both be visible
    await expect(formFields.first()).toBeVisible();
    await expect(formFields.last()).toBeVisible();
  });

  test('should have animation keyframes defined in styles', async () => {
    // Verify that CSS animation keyframes are injected into the page
    const hasAnimations = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      return styleSheets.some((sheet) => {
        try {
          const rules = Array.from(sheet.cssRules);
          return rules.some(
            (rule) =>
              rule instanceof CSSKeyframesRule &&
              (rule.name === 'field-fade-in' || rule.name === 'card-enter')
          );
        } catch {
          return false;
        }
      });
    });

    expect(hasAnimations, 'CSS animations should be defined').toBe(true);
  });

  test('should respect prefers-reduced-motion media query', async () => {
    // Verify the reduced motion styles are present in the injected CSS
    const hasReducedMotionRule = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      return styleSheets.some((sheet) => {
        try {
          const rules = Array.from(sheet.cssRules);
          return rules.some(
            (rule) =>
              rule instanceof CSSMediaRule &&
              rule.conditionText === '(prefers-reduced-motion: reduce)'
          );
        } catch {
          return false;
        }
      });
    });

    expect(hasReducedMotionRule, 'Reduced motion media query should be present').toBe(true);
  });

  test('should animate error messages when they appear', async () => {
    // Handle dialogs
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Submit a form to trigger error messages
    await nativeFormsPage.submitLoginForm();

    // Error messages should be visible (after error-appear animation)
    const errors = page.locator('.form-native-error');
    await expect(errors.first()).toBeVisible();

    // Verify the error element has animation applied
    const hasAnimation = await errors.first().evaluate((el) => {
      const computed = window.getComputedStyle(el);
      const animationName = computed.getPropertyValue('animation-name');
      return animationName.includes('error-appear');
    });

    expect(hasAnimation, 'Error messages should have error-appear animation').toBe(true);
  });
});
