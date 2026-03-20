import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeFormsPage } from '../../pages/NativeFormsPage.js';

/**
 * E2E Tests for Native Forms Showcase: Combobox (Searchable Dropdown)
 *
 * Tests the SyncfusionThemeStudio native form combobox features:
 * - Dropdown open/close behavior
 * - Filtering options by typing
 * - Keyboard navigation
 *
 * @tag @showcase @native-forms
 */

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
