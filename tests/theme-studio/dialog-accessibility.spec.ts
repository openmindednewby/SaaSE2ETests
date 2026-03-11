import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Dialog Accessibility across the SyncfusionThemeStudio app.
 *
 * Covers accessibility requirements found during visual QA:
 * - Escape key closes dialogs
 * - Backdrop click closes dialogs
 * - Focus trapping within dialogs
 * - ARIA attributes (role="dialog", aria-modal="true", aria-labelledby)
 *
 * Dialogs tested:
 * - Integration Detail (/admin/integrations)
 * - Plugin Detail (/admin/plugins)
 * - Role Management (/admin/role-management)
 * - Task Dialog (/kanban)
 * - Order Dialog (/orders)
 * - Invoice Dialog (/invoices)
 * - Inventory Dialog (/inventory)
 * - User Dialog (/admin/user-management)
 *
 * @tag @theme-studio @accessibility @dialog
 */

// ===========================================================================
// Types
// ===========================================================================

interface DialogTestConfig {
  name: string;
  route: string;
  triggerTestId: string;
  dialogTestId: string;
  /** Whether useDialog hook is used (has proper ARIA + backdrop + Escape) */
  usesDialogHook: boolean;
}

// ===========================================================================
// Dialog configurations
// ===========================================================================

/**
 * Dialogs that use the useDialog hook get full ARIA attributes, focus
 * trapping, Escape key, and backdrop-click-to-close out of the box.
 */
const DIALOGS_WITH_HOOK: DialogTestConfig[] = [
  {
    name: 'Integration Detail',
    route: '/admin/integrations',
    triggerTestId: 'admin-integrations-details-1',
    dialogTestId: 'admin-integrations-detail-dialog',
    usesDialogHook: true,
  },
  {
    name: 'Plugin Detail',
    route: '/admin/plugins',
    triggerTestId: 'admin-plugins-details-1',
    dialogTestId: 'admin-plugins-detail-dialog',
    usesDialogHook: true,
  },
];

/**
 * Dialogs that are custom div overlays (no useDialog hook). These are the
 * ones being fixed by other agents. Tests should catch regressions.
 */
const DIALOGS_CUSTOM: DialogTestConfig[] = [
  {
    name: 'Role Management',
    route: '/admin/role-management',
    triggerTestId: 'role-management-create-btn',
    dialogTestId: 'role-dialog-overlay',
    usesDialogHook: false,
  },
  {
    name: 'Task Dialog (Kanban)',
    route: '/kanban',
    triggerTestId: 'kanban-add-btn',
    dialogTestId: 'kanban-dialog',
    usesDialogHook: false,
  },
  {
    name: 'Order Dialog',
    route: '/orders',
    triggerTestId: 'orders-add-btn',
    dialogTestId: 'orders-dialog',
    usesDialogHook: false,
  },
  {
    name: 'Invoice Dialog',
    route: '/invoices',
    triggerTestId: 'invoices-add-btn',
    dialogTestId: 'invoices-dialog',
    usesDialogHook: false,
  },
  {
    name: 'Inventory Dialog',
    route: '/inventory',
    triggerTestId: 'inventory-add-btn',
    dialogTestId: 'inventory-dialog',
    usesDialogHook: false,
  },
  {
    name: 'User Dialog',
    route: '/admin/user-management',
    triggerTestId: 'admin-users-add-btn',
    dialogTestId: 'admin-users-dialog',
    usesDialogHook: false,
  },
];

// ===========================================================================
// Helper functions
// ===========================================================================

async function openDialog(
  page: Page,
  config: DialogTestConfig,
) {
  const trigger = page.locator(`[data-testid="${config.triggerTestId}"]`);
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();

  const dialog = page.locator(`[data-testid="${config.dialogTestId}"]`);
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

// ===========================================================================
// Tests: Integration Detail Dialog (useDialog hook)
// ===========================================================================

test.describe('Integration Detail Dialog Accessibility @theme-studio @accessibility @dialog', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  const config = DIALOGS_WITH_HOOK[0];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    await studioPage.gotoStudio(config.route);
    // Wait for the page content to load
    await expect(
      page.locator(`[data-testid="admin-integrations-page"]`),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should have role="dialog" and aria-modal="true" on dialog container', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );
    await expect(dialogContainer).toBeVisible();
    await expect(dialogContainer).toHaveAttribute('aria-modal', 'true');
  });

  test('should have aria-labelledby pointing to the dialog title', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );
    const labelledBy = await dialogContainer.getAttribute('aria-labelledby');
    expect(
      labelledBy,
      'Dialog should have aria-labelledby attribute',
    ).toBeTruthy();

    // Verify the referenced element exists and has text
    const titleElement = page.locator(`#${labelledBy}`);
    await expect(titleElement).toBeVisible();
    const titleText = await titleElement.textContent();
    expect(
      titleText?.trim().length,
      'Dialog title should have text content',
    ).toBeGreaterThan(0);
  });

  test('should close when Escape key is pressed', async () => {
    const dialog = await openDialog(page, config);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('should close when backdrop overlay is clicked', async () => {
    const dialog = await openDialog(page, config);

    // The backdrop is the outer div with the dialog testid
    const backdrop = page.locator(
      `[data-testid="${config.dialogTestId}"]`,
    );

    // Click at the edge of the backdrop (outside the inner dialog panel)
    const backdropBox = await backdrop.boundingBox();
    if (backdropBox) {
      // Click top-left corner of the backdrop (which is outside the dialog)
      await page.mouse.click(
        backdropBox.x + 5,
        backdropBox.y + 5,
      );
    }

    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('should trap focus within the dialog when tabbing', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );

    // Get all focusable elements within the dialog
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = dialogContainer.locator(focusableSelector);
    const count = await focusableElements.count();
    expect(count, 'Dialog should have focusable elements').toBeGreaterThan(0);

    // Tab through all elements and verify focus stays within dialog
    for (let i = 0; i < count + 1; i++) {
      await page.keyboard.press('Tab');

      const activeElementInDialog = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return false;
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(active) ?? false;
      });

      expect(
        activeElementInDialog,
        `Focus should stay within dialog on tab press ${String(i + 1)}`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// Tests: Plugin Detail Dialog (useDialog hook)
// ===========================================================================

test.describe('Plugin Detail Dialog Accessibility @theme-studio @accessibility @dialog', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  const config = DIALOGS_WITH_HOOK[1];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    await studioPage.gotoStudio(config.route);
    await expect(
      page.locator(`[data-testid="admin-plugins-page"]`),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should have role="dialog" and aria-modal="true" on dialog container', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );
    await expect(dialogContainer).toBeVisible();
    await expect(dialogContainer).toHaveAttribute('aria-modal', 'true');
  });

  test('should have aria-labelledby pointing to the dialog title', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );
    const labelledBy = await dialogContainer.getAttribute('aria-labelledby');
    expect(labelledBy, 'Dialog should have aria-labelledby').toBeTruthy();

    const titleElement = page.locator(`#${labelledBy}`);
    await expect(titleElement).toBeVisible();
  });

  test('should close when Escape key is pressed', async () => {
    const dialog = await openDialog(page, config);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('should close when backdrop overlay is clicked', async () => {
    const dialog = await openDialog(page, config);

    const backdrop = page.locator(
      `[data-testid="${config.dialogTestId}"]`,
    );
    const backdropBox = await backdrop.boundingBox();
    if (backdropBox) {
      await page.mouse.click(backdropBox.x + 5, backdropBox.y + 5);
    }

    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('should trap focus within the dialog when tabbing', async () => {
    await openDialog(page, config);

    const dialogContainer = page.locator(
      `[data-testid="${config.dialogTestId}"] [role="dialog"]`,
    );
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = dialogContainer.locator(focusableSelector);
    const count = await focusableElements.count();

    for (let i = 0; i < count + 1; i++) {
      await page.keyboard.press('Tab');
      const inDialog = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return false;
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(active) ?? false;
      });
      expect(inDialog, `Focus should stay in dialog on tab ${String(i + 1)}`).toBe(true);
    }
  });
});

// ===========================================================================
// Tests: Custom Dialogs (Role, Task, Order, Invoice, Inventory, User)
// These dialogs were identified during visual QA as needing fixes.
// The tests validate that the fixes are applied correctly.
// ===========================================================================

for (const config of DIALOGS_CUSTOM) {
  test.describe(`${config.name} Dialog Accessibility @theme-studio @accessibility @dialog`, () => {
    test.setTimeout(60000);

    let context: BrowserContext;
    let page: Page;
    let studioPage: StudioBasePage;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      studioPage = new StudioBasePage(page);
      await studioPage.studioLogin();
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test.beforeEach(async () => {
      await studioPage.gotoStudio(config.route);
      // Wait for the page to be ready by checking for the add button
      await expect(
        page.locator(`[data-testid="${config.triggerTestId}"]`),
      ).toBeVisible({ timeout: 10000 });
    });

    test('should open dialog when trigger button is clicked', async () => {
      const dialog = await openDialog(page, config);
      await expect(dialog).toBeVisible();
    });

    test('should have role="dialog" on the dialog panel', async () => {
      await openDialog(page, config);

      // Check for role="dialog" either on the testid element or a child
      const dialogRole = page.locator(
        `[data-testid="${config.dialogTestId}"] [role="dialog"], ` +
        `[data-testid="${config.dialogTestId}"][role="dialog"]`,
      );
      const roleCount = await dialogRole.count();

      // If the dialog was fixed by other agents, it should have role="dialog"
      // If not yet fixed, this test will catch the regression
      expect(
        roleCount,
        `${config.name}: should have an element with role="dialog"`,
      ).toBeGreaterThan(0);
    });

    test('should have aria-modal="true" on the dialog panel', async () => {
      await openDialog(page, config);

      const dialogRole = page.locator(
        `[data-testid="${config.dialogTestId}"] [role="dialog"], ` +
        `[data-testid="${config.dialogTestId}"][role="dialog"]`,
      );
      const first = dialogRole.first();
      await expect(first).toHaveAttribute('aria-modal', 'true');
    });

    test('should have aria-labelledby referencing a visible title', async () => {
      await openDialog(page, config);

      const dialogRole = page.locator(
        `[data-testid="${config.dialogTestId}"] [role="dialog"], ` +
        `[data-testid="${config.dialogTestId}"][role="dialog"]`,
      );
      const first = dialogRole.first();
      const labelledBy = await first.getAttribute('aria-labelledby');

      expect(
        labelledBy,
        `${config.name}: dialog should have aria-labelledby`,
      ).toBeTruthy();

      if (labelledBy) {
        const titleEl = page.locator(`#${labelledBy}`);
        await expect(titleEl).toBeVisible();
      }
    });

    test('should close when Escape key is pressed', async () => {
      const dialog = await openDialog(page, config);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 3000 });
    });

    test('should close when backdrop overlay is clicked', async () => {
      const dialog = await openDialog(page, config);

      // Click on the backdrop overlay (the dark overlay area)
      const backdrop = page.locator(
        `[data-testid="${config.dialogTestId}"]`,
      );
      const backdropBox = await backdrop.boundingBox();
      if (backdropBox) {
        // Click at the top-left of the backdrop, outside the inner panel
        await page.mouse.click(backdropBox.x + 5, backdropBox.y + 5);
      }

      await expect(dialog).not.toBeVisible({ timeout: 3000 });
    });

    test('should trap focus within the dialog when tabbing', async () => {
      await openDialog(page, config);

      // Find the dialog panel (the role="dialog" element)
      const dialogPanel = page.locator(
        `[data-testid="${config.dialogTestId}"] [role="dialog"], ` +
        `[data-testid="${config.dialogTestId}"][role="dialog"]`,
      ).first();

      const focusableSelector =
        'a[href], button:not([disabled]), textarea:not([disabled]), ' +
        'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusableElements = dialogPanel.locator(focusableSelector);
      const count = await focusableElements.count();

      if (count > 0) {
        // Tab through all elements + 1 to verify wrap
        for (let i = 0; i < count + 1; i++) {
          await page.keyboard.press('Tab');

          const activeInDialog = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active) return false;
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) return dialog.contains(active);
            // Fallback: check if active is inside any fixed overlay
            const overlay = active.closest('.fixed');
            return overlay !== null;
          });

          expect(
            activeInDialog,
            `${config.name}: Focus should stay in dialog on tab ${String(i + 1)}`,
          ).toBe(true);
        }
      }
    });
  });
}
