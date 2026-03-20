import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';

/**
 * E2E Tests for Native Forms Showcase: Form Field Interactions
 *
 * Tests the SyncfusionThemeStudio native form field interaction features:
 * - Password visibility toggle
 * - Checkbox toggle
 * - Textarea multi-line input
 * - Successful form submission
 *
 * @tag @showcase @native-forms
 */

test.describe.serial('Form Field Interactions @showcase @native-forms', () => {
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

  test('should toggle password visibility in login form', async () => {
    // Fill in password
    await nativeFormsPage.loginPasswordInput.fill('SecretPassword123');

    // Password should be masked initially (type="password")
    await expect(nativeFormsPage.loginPasswordInput).toHaveAttribute('type', 'password');

    // Click the password toggle button
    await nativeFormsPage.loginPasswordToggle.click();

    // Password should now be visible (type="text")
    await expect(nativeFormsPage.loginPasswordInput).toHaveAttribute('type', 'text');

    // Toggle back
    await nativeFormsPage.loginPasswordToggle.click();

    // Password should be masked again
    await expect(nativeFormsPage.loginPasswordInput).toHaveAttribute('type', 'password');
  });

  test('should toggle remember me checkbox', async () => {
    // Click the remember me checkbox
    await nativeFormsPage.loginRememberCheckbox.click();

    // Checkbox should be checked
    await expect(nativeFormsPage.loginRememberCheckbox).toBeChecked();

    // Toggle off
    await nativeFormsPage.loginRememberCheckbox.click();

    // Checkbox should be unchecked
    await expect(nativeFormsPage.loginRememberCheckbox).not.toBeChecked();
  });

  test('should accept multi-line input in contact message textarea', async () => {
    const multiLineMessage = 'Line one of the message.\nLine two of the message.\nLine three of the message.';
    await nativeFormsPage.contactMessageTextarea.fill(multiLineMessage);

    await expect(nativeFormsPage.contactMessageTextarea).toHaveValue(multiLineMessage);
  });

  test('should submit login form successfully with valid data', async () => {
    // Set up dialog handler to capture the alert
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Fill and submit login form
    await nativeFormsPage.fillLoginForm('test@example.com', 'ValidPassword');
    await nativeFormsPage.submitLoginForm();

    // Verify alert was shown (form submission triggers an alert in demo mode)
    // Give a moment for the alert to fire
    await expect(async () => {
      expect(alertMessage).toContain('Login submitted');
    }).toPass({ timeout: 5000 });
  });

  test('should submit contact form successfully with valid data', async () => {
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Fill all contact form fields
    await nativeFormsPage.fillContactFormFields(
      'Jane Doe',
      'jane@example.com',
      'This is a test message that is long enough for validation.'
    );

    // Select a subject
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.selectComboboxOption('General Inquiry');

    // Submit
    await nativeFormsPage.submitContactForm();

    // Verify success alert
    await expect(async () => {
      expect(alertMessage).toContain('Message sent');
    }).toPass({ timeout: 5000 });
  });

  test('should submit newsletter form and reset fields', async () => {
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Fill and submit newsletter form
    await nativeFormsPage.newsletterEmailInput.fill('newsletter@example.com');
    await nativeFormsPage.submitNewsletterForm();

    // Verify success alert
    await expect(async () => {
      expect(alertMessage).toContain('Subscribed');
    }).toPass({ timeout: 5000 });

    // Newsletter form resets after submission
    await expect(nativeFormsPage.newsletterEmailInput).toHaveValue('');
  });

});

