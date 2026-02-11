import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { NativeComponentsPage } from '../../pages/NativeComponentsPage.js';

/**
 * E2E Tests for Native Components Showcase Page - Checkbox Section
 *
 * Verifies Bug 1 fix: The "Indeterminate" checkbox previously had
 * `checked` without an `onChange` handler, causing a React warning.
 * The fix added `readOnly` to the indeterminate checkbox.
 *
 * Tests verify:
 * - All checkbox states render correctly (checked, unchecked, disabled, indeterminate)
 * - The indeterminate checkbox has the readOnly attribute
 * - Interactive checkboxes can be toggled
 * - The disabled checkbox cannot be interacted with
 *
 * @tag @showcase @native-components @bug-fix
 */

// =============================================================================
// Checkbox Section Tests
// =============================================================================

test.describe.serial('Native Checkbox Section @showcase @native-components @bug-fix', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let nativeComponentsPage: NativeComponentsPage;

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

    nativeComponentsPage = new NativeComponentsPage(page);
    await nativeComponentsPage.gotoNativeComponents();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display the native components page', async () => {
    await nativeComponentsPage.expectPageLoaded();
  });

  test('should render all four checkbox states @critical', async () => {
    await nativeComponentsPage.expectAllCheckboxStatesVisible();
  });

  test('should have readOnly attribute on indeterminate checkbox (Bug 1 fix) @critical', async () => {
    // Bug 1: The indeterminate checkbox had `checked` without `onChange`,
    // causing a React warning. Fix: added `readOnly` attribute.
    // Verify the readOnly attribute is present on the checkbox input.
    const indeterminateInput = nativeComponentsPage.indeterminateCheckbox;

    // Check if the testId is on the input or a wrapper
    const inputElement = indeterminateInput.locator('input[type="checkbox"]');
    const hasNestedInput = await inputElement.count() > 0;
    const target = hasNestedInput ? inputElement : indeterminateInput;

    // The readOnly attribute should be present (set by the React `readOnly` prop)
    const isReadOnly = await target.evaluate((el) => {
      return (el as HTMLInputElement).readOnly;
    });
    expect(isReadOnly, 'Indeterminate checkbox should have readOnly attribute').toBe(true);
  });

  test('should keep indeterminate checkbox in checked state', async () => {
    // The indeterminate checkbox is readOnly and checked, so it should stay checked
    const indeterminateInput = nativeComponentsPage.indeterminateCheckbox;
    const inputElement = indeterminateInput.locator('input[type="checkbox"]');
    const hasNestedInput = await inputElement.count() > 0;
    const target = hasNestedInput ? inputElement : indeterminateInput;

    await expect(target).toBeChecked();
  });

  test('should have disabled checkbox that is non-interactive', async () => {
    await nativeComponentsPage.expectDisabledCheckboxIsDisabled();
  });

  test('should toggle the checked checkbox when clicked @critical', async () => {
    // The "checked" checkbox has an onChange handler and should be interactive
    const checkedInput = nativeComponentsPage.checkedCheckbox;
    const inputElement = checkedInput.locator('input[type="checkbox"]');
    const hasNestedInput = await inputElement.count() > 0;
    const target = hasNestedInput ? inputElement : checkedInput;

    // Initially the checkbox is controlled by state (starts as false per useState)
    // After first click it should toggle
    const wasChecked = await target.isChecked();
    await nativeComponentsPage.toggleCheckedCheckbox();

    if (wasChecked)
      await expect(target).not.toBeChecked();
    else
      await expect(target).toBeChecked();
  });

  test('should toggle the unchecked checkbox when clicked', async () => {
    const uncheckedInput = nativeComponentsPage.uncheckedCheckbox;
    const inputElement = uncheckedInput.locator('input[type="checkbox"]');
    const hasNestedInput = await inputElement.count() > 0;
    const target = hasNestedInput ? inputElement : uncheckedInput;

    // Unchecked checkbox is uncontrolled, should start unchecked
    await expect(target).not.toBeChecked();
    await nativeComponentsPage.toggleUncheckedCheckbox();
    await expect(target).toBeChecked();
  });
});
