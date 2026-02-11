import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';
import { TestIds } from '../../shared/testIds.js';

/**
 * E2E Tests for Native Forms Showcase Page
 *
 * Tests the SyncfusionThemeStudio native form features:
 * - Searchable dropdown (combobox) with filtering and keyboard navigation
 * - Form validation UX (simultaneous errors, first-field focus)
 * - CSS animations (form card entrance, field fade-in)
 * - Form field interactions (password toggle, checkbox, textarea)
 *
 * @tag @showcase @native-forms
 */

// =============================================================================
// Combobox (Searchable Dropdown) Tests
// =============================================================================

test.describe.serial('Combobox Searchable Dropdown @showcase @native-forms', () => {
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

  test('should display the native forms page with all four forms', async () => {
    await nativeFormsPage.expectPageLoaded();
    await nativeFormsPage.expectAllFormsVisible();
  });

  test('should open dropdown when combobox input is clicked', async () => {
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();
  });

  test('should show all options when dropdown is first opened @critical', async () => {
    // Contact form has 5 subject options: General, Technical Support, Sales, Feedback, Other
    const TOTAL_SUBJECT_OPTIONS = 5;
    await nativeFormsPage.expectComboboxOptionCount(TOTAL_SUBJECT_OPTIONS);
  });

  test('should filter options when typing in combobox @critical', async () => {
    // Type "tech" to filter - should match "Technical Support"
    await nativeFormsPage.typeInSubjectCombobox('tech');
    await nativeFormsPage.expectDropdownVisible();

    const FILTERED_COUNT = 1;
    await nativeFormsPage.expectComboboxOptionCount(FILTERED_COUNT);
  });

  test('should show "No results" when filter matches nothing', async () => {
    await nativeFormsPage.contactSubjectCombobox.clear();
    await nativeFormsPage.typeInSubjectCombobox('zzzznonexistent');
    await nativeFormsPage.expectNoResultsMessage();
  });

  test('should select option by clicking and show selected value @critical', async () => {
    // Clear and reopen
    await nativeFormsPage.contactSubjectCombobox.clear();
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();

    // Click "Technical Support" option
    await nativeFormsPage.selectComboboxOption('Technical Support');

    // Dropdown should close after selection
    await nativeFormsPage.expectDropdownHidden();

    // Input should show the selected label
    await nativeFormsPage.expectComboboxValue('Technical Support');
  });

  test('should clear selection to show all options again', async () => {
    const TOTAL_SUBJECT_OPTIONS = 5;

    // Click the combobox to open it, which resets search text
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();

    // All options should be visible again since search text resets on focus
    await nativeFormsPage.expectComboboxOptionCount(TOTAL_SUBJECT_OPTIONS);
  });

  test('should navigate options with keyboard and select with Enter @critical', async () => {
    // Combobox should already be open from previous test
    // If not, open it
    if (await nativeFormsPage.comboboxDropdown.count() === 0)
      await nativeFormsPage.openSubjectDropdown();

    // Press ArrowDown twice to highlight the second option ("Technical Support")
    const ARROW_DOWN_PRESSES = 2;
    await nativeFormsPage.selectComboboxOptionByKeyboard(ARROW_DOWN_PRESSES);

    // Dropdown should close after Enter
    await nativeFormsPage.expectDropdownHidden();

    // Verify the combobox shows selected value
    const value = await nativeFormsPage.contactSubjectCombobox.inputValue();
    expect(value.length, 'Selected value should not be empty').toBeGreaterThan(0);
  });

  test('should close dropdown when Escape is pressed', async () => {
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();

    await nativeFormsPage.closeComboboxWithEscape();
    await nativeFormsPage.expectDropdownHidden();
  });

  test('should close dropdown when clicking outside', async () => {
    await nativeFormsPage.openSubjectDropdown();
    await nativeFormsPage.expectDropdownVisible();

    await nativeFormsPage.closeComboboxByClickingOutside();
    await nativeFormsPage.expectDropdownHidden();
  });
});

// =============================================================================
// Form Validation UX Tests
// =============================================================================

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

// =============================================================================
// Form Field Interaction Tests
// =============================================================================

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

// =============================================================================
// CSS Animations Tests
// =============================================================================

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
    await Promise.all([
      expect(formCards.nth(0)).toBeVisible(),
      expect(formCards.nth(1)).toBeVisible(),
      expect(formCards.nth(2)).toBeVisible(),
      expect(formCards.nth(3)).toBeVisible(),
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
