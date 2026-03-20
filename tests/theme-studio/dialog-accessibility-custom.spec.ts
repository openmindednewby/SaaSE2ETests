import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Custom Dialog Accessibility in the SyncfusionThemeStudio app.
 *
 * Covers accessibility requirements for custom div overlay dialogs:
 * - Escape key closes dialogs
 * - Backdrop click closes dialogs
 * - Focus trapping within dialogs
 * - ARIA attributes (role="dialog", aria-modal="true", aria-labelledby)
 *
 * Dialogs tested:
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
}

// ===========================================================================
// Dialog configurations
// ===========================================================================

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
  },
  {
    name: 'Task Dialog (Kanban)',
    route: '/kanban',
    triggerTestId: 'kanban-add-btn',
    dialogTestId: 'kanban-dialog',
  },
  {
    name: 'Order Dialog',
    route: '/orders',
    triggerTestId: 'orders-add-btn',
    dialogTestId: 'orders-dialog',
  },
  {
    name: 'Invoice Dialog',
    route: '/invoices',
    triggerTestId: 'invoices-add-btn',
    dialogTestId: 'invoices-dialog',
  },
  {
    name: 'Inventory Dialog',
    route: '/inventory',
    triggerTestId: 'inventory-add-btn',
    dialogTestId: 'inventory-dialog',
  },
  {
    name: 'User Dialog',
    route: '/admin/user-management',
    triggerTestId: 'admin-users-add-btn',
    dialogTestId: 'admin-users-dialog',
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
