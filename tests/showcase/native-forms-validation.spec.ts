import { BrowserContext, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';
import { TestIds } from '../../shared/testIds.js';

/**
 * E2E Tests for Native Forms Showcase: Form Validation UX
 *
 * Tests the SyncfusionThemeStudio native form validation features:
 * - Simultaneous error display on submit
 * - First-field focus on validation failure
 * - Per-field error clearing when corrected
 *
 * @tag @showcase @native-forms
 */

test.describe.serial('Form Validation UX @showcase @native-forms', () => {
  test.setTimeout(120000);

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
    await nativeFormsPage.gotoNativeForms();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should show all errors simultaneously on login form submit @critical', async () => {
    // Handle the alert dialog that appears on successful submit
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Submit login form without filling any fields
    await nativeFormsPage.submitLoginForm();

    // Both email and password errors should appear
    await nativeFormsPage.expectErrorMessage('Email is required');
    await nativeFormsPage.expectErrorMessage('Password is required');

    // Should have at least 2 errors
    const MIN_LOGIN_ERRORS = 2;
    await nativeFormsPage.expectErrorsVisible(MIN_LOGIN_ERRORS);
  });

  test('should focus first invalid field after submit @critical', async () => {
    // After submitting the login form with empty fields,
    // the first invalid field (email) should receive focus
    await nativeFormsPage.expectFocusedElement(TestIds.SHOWCASE_LOGIN_EMAIL);
  });

  test('should clear email error when valid email is entered', async () => {
    // Fill in a valid email
    await nativeFormsPage.loginEmailInput.fill('user@example.com');
    // Blur the field to trigger re-validation
    await nativeFormsPage.loginPasswordInput.click();

    // Email error should disappear
    await nativeFormsPage.expectErrorMessageGone('Email is required');
    await nativeFormsPage.expectErrorMessageGone('Please enter a valid email address');

    // Password error should still be visible
    await nativeFormsPage.expectErrorMessage('Password is required');
  });

  test('should clear all errors when all fields are valid', async () => {
    // Fill in valid password
    await nativeFormsPage.loginPasswordInput.fill('ValidPassword123');

    // All errors should disappear
    await nativeFormsPage.expectErrorMessageGone('Password is required');

    // Verify no errors remain in the login form card
    const loginCard = nativeFormsPage.getLoginFormCard();
    await nativeFormsPage.expectNoErrorsInForm(loginCard);
  });

  test('should show all errors on registration form submit with empty fields @critical', async () => {
    // Submit registration form without filling any fields
    await nativeFormsPage.submitRegistrationForm();

    // All required field errors should appear simultaneously
    await nativeFormsPage.expectErrorMessage('Name is required');
    await nativeFormsPage.expectErrorMessage('Email is required');
    await nativeFormsPage.expectErrorMessage('Password is required');
    await nativeFormsPage.expectErrorMessage('Please confirm your password');
  });

  test('should show password mismatch error on registration form', async () => {
    // Fill registration form with mismatched passwords
    await nativeFormsPage.fillRegistrationForm(
      'John Doe',
      'john@example.com',
      'Password123',
      'DifferentPassword'
    );

    // Submit
    await nativeFormsPage.submitRegistrationForm();

    // Should show password mismatch error
    await nativeFormsPage.expectErrorMessage('Passwords do not match');
  });

  test('should show subject error on contact form submit without subject', async () => {
    // Fill contact form fields but skip the subject combobox
    await nativeFormsPage.fillContactFormFields(
      'Jane Doe',
      'jane@example.com',
      'This is a test message that is long enough.'
    );

    // Submit without selecting a subject
    await nativeFormsPage.submitContactForm();

    // Subject error should appear
    await nativeFormsPage.expectErrorMessage('Please select a subject');
  });

  test('should show email error on newsletter form submit', async () => {
    // Submit newsletter form without entering email
    await nativeFormsPage.submitNewsletterForm();

    // Email error should appear
    await nativeFormsPage.expectErrorMessage('Email is required');
  });

  test('should show invalid email error for malformed email', async () => {
    // Enter malformed email in newsletter form
    await nativeFormsPage.newsletterEmailInput.fill('not-an-email');
    await nativeFormsPage.newsletterSubmitButton.click();

    // Should show email format error
    await nativeFormsPage.expectErrorMessage('Please enter a valid email address');
  });
});
