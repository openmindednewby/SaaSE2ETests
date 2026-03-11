import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for descriptive aria-labels on Integration page buttons.
 *
 * Verifies that Connect/Disconnect buttons and Details buttons on the
 * /admin/integrations page have aria-labels that include the integration
 * name, making them distinguishable for screen readers.
 *
 * For example, instead of a generic "Connect" aria-label, the button
 * should read "Connect Slack" or "Disconnect Slack".
 *
 * @tag @theme-studio @accessibility @aria-labels @bug-verification
 */

test.describe('Integration Button Descriptive Aria Labels @theme-studio @accessibility @aria-labels', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
    await studioPage.gotoStudio('/admin/integrations');
    await expect(
      page.locator('[data-testid="admin-integrations-page"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should have aria-label on Slack Connect/Disconnect toggle button', async () => {
    const slackToggle = page.locator(
      '[data-testid="admin-integrations-toggle-slack"]',
    );
    await expect(slackToggle).toBeVisible();

    const ariaLabel = await slackToggle.getAttribute('aria-label');
    expect(
      ariaLabel,
      'Slack toggle button should have an aria-label',
    ).toBeTruthy();

    // The aria-label should include the integration name "Slack"
    expect(
      ariaLabel?.toLowerCase(),
      `Slack toggle aria-label should include "slack", got: "${String(ariaLabel)}"`,
    ).toContain('slack');
  });

  test('should have aria-label on Slack Details button', async () => {
    const slackDetails = page.locator(
      '[data-testid="admin-integrations-details-slack"]',
    );
    await expect(slackDetails).toBeVisible();

    const ariaLabel = await slackDetails.getAttribute('aria-label');
    expect(
      ariaLabel,
      'Slack Details button should have an aria-label',
    ).toBeTruthy();

    expect(
      ariaLabel?.toLowerCase(),
      `Slack details aria-label should include "slack", got: "${String(ariaLabel)}"`,
    ).toContain('slack');
  });

  test('should have aria-label on Teams Connect button including integration name', async () => {
    const teamsToggle = page.locator(
      '[data-testid="admin-integrations-toggle-teams"]',
    );
    await expect(teamsToggle).toBeVisible();

    const ariaLabel = await teamsToggle.getAttribute('aria-label');
    expect(
      ariaLabel,
      'Teams toggle button should have an aria-label',
    ).toBeTruthy();

    expect(
      ariaLabel?.toLowerCase(),
      `Teams toggle aria-label should include "teams", got: "${String(ariaLabel)}"`,
    ).toContain('teams');
  });

  test('should have aria-label on Teams Details button including integration name', async () => {
    const teamsDetails = page.locator(
      '[data-testid="admin-integrations-details-teams"]',
    );
    await expect(teamsDetails).toBeVisible();

    const ariaLabel = await teamsDetails.getAttribute('aria-label');
    expect(
      ariaLabel,
      'Teams Details button should have an aria-label',
    ).toBeTruthy();

    expect(
      ariaLabel?.toLowerCase(),
      `Teams details aria-label should include "teams", got: "${String(ariaLabel)}"`,
    ).toContain('teams');
  });

  test('should have aria-label on Stripe toggle button including integration name', async () => {
    const stripeToggle = page.locator(
      '[data-testid="admin-integrations-toggle-stripe"]',
    );
    await expect(stripeToggle).toBeVisible();

    const ariaLabel = await stripeToggle.getAttribute('aria-label');
    expect(
      ariaLabel,
      'Stripe toggle button should have an aria-label',
    ).toBeTruthy();

    expect(
      ariaLabel?.toLowerCase(),
      `Stripe toggle aria-label should include "stripe", got: "${String(ariaLabel)}"`,
    ).toContain('stripe');
  });

  test('should have descriptive aria-labels on all visible toggle buttons', async () => {
    // Verify that every integration toggle button has an aria-label with the integration name
    const toggleButtons = page.locator(
      '[data-testid^="admin-integrations-toggle-"]',
    );
    const count = await toggleButtons.count();
    expect(
      count,
      'Should have at least one integration toggle button',
    ).toBeGreaterThan(0);

    const missingLabels: string[] = [];
    const genericLabels: string[] = [];

    for (let i = 0; i < count; i++) {
      const button = toggleButtons.nth(i);
      const testId = await button.getAttribute('data-testid');
      const ariaLabel = await button.getAttribute('aria-label');

      if (!ariaLabel) {
        missingLabels.push(testId ?? `button-${String(i)}`);
        continue;
      }

      // Extract integration ID from testId (admin-integrations-toggle-{id})
      const integrationId = testId?.replace('admin-integrations-toggle-', '');
      if (integrationId) {
        // The aria-label should contain the integration ID or name
        // Integration names are based on their IDs (slack, teams, stripe, etc.)
        const nameFragment = integrationId.split('-').join(' ');
        const labelLower = ariaLabel.toLowerCase();
        const hasIntegrationName = integrationId
          .split('-')
          .some((part) => labelLower.includes(part));

        if (!hasIntegrationName) {
          genericLabels.push(
            `${testId ?? 'unknown'}: "${ariaLabel}" (expected to contain "${nameFragment}")`,
          );
        }
      }
    }

    expect(
      missingLabels.length,
      `All toggle buttons should have aria-labels. Missing: ${missingLabels.join(', ')}`,
    ).toBe(0);

    expect(
      genericLabels.length,
      `All toggle aria-labels should include integration name. Generic: ${genericLabels.join('; ')}`,
    ).toBe(0);
  });

  test('should have descriptive aria-labels on all visible details buttons', async () => {
    const detailsButtons = page.locator(
      '[data-testid^="admin-integrations-details-"]',
    );
    const count = await detailsButtons.count();
    expect(
      count,
      'Should have at least one integration details button',
    ).toBeGreaterThan(0);

    const missingLabels: string[] = [];
    const genericLabels: string[] = [];

    for (let i = 0; i < count; i++) {
      const button = detailsButtons.nth(i);
      const testId = await button.getAttribute('data-testid');
      const ariaLabel = await button.getAttribute('aria-label');

      if (!ariaLabel) {
        missingLabels.push(testId ?? `button-${String(i)}`);
        continue;
      }

      const integrationId = testId?.replace('admin-integrations-details-', '');
      if (integrationId) {
        const labelLower = ariaLabel.toLowerCase();
        const hasIntegrationName = integrationId
          .split('-')
          .some((part) => labelLower.includes(part));

        if (!hasIntegrationName) {
          genericLabels.push(
            `${testId ?? 'unknown'}: "${ariaLabel}" (expected integration name)`,
          );
        }
      }
    }

    expect(
      missingLabels.length,
      `All details buttons should have aria-labels. Missing: ${missingLabels.join(', ')}`,
    ).toBe(0);

    expect(
      genericLabels.length,
      `All details aria-labels should include integration name. Generic: ${genericLabels.join('; ')}`,
    ).toBe(0);
  });
});
