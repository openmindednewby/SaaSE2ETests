import { test, expect } from '../../fixtures/index.js';
import type { Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
import { SidebarPage } from '../../pages/SidebarPage.js';

/**
 * E2E tests for the expandable sidebar navigation.
 *
 * The sidebar was restructured so that "Dashboard" and "Threat Detection &
 * Analysis" are expandable sections rendered by the recursive
 * NavExpandableItem component.  These tests verify:
 *  - Expand / collapse toggle behaviour
 *  - Child item visibility after expand
 *  - Multi-level (3-deep) nesting works correctly
 *  - Clicking a child navigates to the correct route
 *  - Independent expand states across sections
 */
test.describe.serial('Sidebar Expandable Navigation @navigation @sidebar', () => {
  let context: BrowserContext;
  let page: Page;
  let sidebar: SidebarPage;

  test.beforeAll(async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

    context = await browser.newContext();
    page = await context.newPage();

    // Restore auth from localStorage to sessionStorage on every navigation
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
      } catch {
        // ignore
      }
    });

    // Login
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    // Persist auth state so subsequent page loads stay authenticated
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    sidebar = new SidebarPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ── Dashboard section ────────────────────────────────────────────────

  test('should render Dashboard toggle in the sidebar', async () => {
    await sidebar.goto();
    await sidebar.expectDashboardToggleVisible();
  });

  test('should expand Dashboard to show child items', async () => {
    await sidebar.expandDashboard();
    await sidebar.expectDashboardExpanded();
  });

  test('should collapse Dashboard to hide child items', async () => {
    await sidebar.collapseDashboard();
    await sidebar.expectDashboardCollapsed();
  });

  test('should navigate to Dashboard Overview when child is clicked', async () => {
    await sidebar.expandDashboard();
    await sidebar.dashboardOverview.click();
    await expect(page).toHaveURL(/\/dashboard\/overview/);
  });

  test('should navigate to Metrics A when child is clicked', async () => {
    // Re-navigate to ensure sidebar is visible
    await sidebar.goto();
    await sidebar.expandDashboard();
    await sidebar.dashboardMetricsA.click();
    await expect(page).toHaveURL(/\/dashboard\/metrics-a/);
  });

  test('should navigate to KPIs when child is clicked', async () => {
    await sidebar.goto();
    await sidebar.expandDashboard();
    await sidebar.dashboardKpis.click();
    await expect(page).toHaveURL(/\/dashboard\/kpis/);
  });

  // ── Threat Detection & Analysis section ──────────────────────────────

  test('should render Threat Detection toggle in the sidebar', async () => {
    await sidebar.goto();
    await sidebar.expectThreatDetectionToggleVisible();
  });

  test('should expand Threat Detection to show direct children', async () => {
    await sidebar.expandThreatDetection();
    await sidebar.expectThreatDetectionExpanded();
  });

  test('should collapse Threat Detection to hide all children', async () => {
    await sidebar.collapseThreatDetection();
    await sidebar.expectThreatDetectionCollapsed();
  });

  test('should navigate to Detection Coverage when child is clicked', async () => {
    await sidebar.expandThreatDetection();
    await sidebar.detectionCoverage.click();
    await expect(page).toHaveURL(/\/threat-detection-analysis\/detection-coverage/);
  });

  test('should navigate to Playbooks when child is clicked', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.playbooks.click();
    await expect(page).toHaveURL(/\/threat-detection-analysis\/playbooks/);
  });

  // ── 3-level nesting: Detection Rules > TA items ──────────────────────

  test('should expand Detection Rules (level 2) to show TA items (level 3)', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandDetectionRules();
    await sidebar.expectDetectionRulesExpanded();
  });

  test('should navigate to TA0001 detection rule page', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandDetectionRules();
    await sidebar.detectionRulesTA0001.click();
    await expect(page).toHaveURL(/\/detection-rules\/ta0001/);
  });

  // ── 3-level nesting: Active Defense > Beacon Traps ───────────────────

  test('should expand Active Defense (level 2) to show sub-items', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandActiveDefense();
    await sidebar.expectActiveDefenseExpanded();
  });

  test('should expand Beacon Traps (level 3) to show policies and schedules', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandActiveDefense();
    await sidebar.expandBeaconTraps();
    await sidebar.expectBeaconTrapsExpanded();
  });

  test('should navigate to Beacon Policies page', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandActiveDefense();
    await sidebar.expandBeaconTraps();
    await sidebar.beaconPolicies.click();
    await expect(page).toHaveURL(/\/beacon-traps\/policies/);
  });

  // ── Identity Threat Protection sub-group ─────────────────────────────

  test('should expand Identity Threat Protection to show children', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandIdentityThreat();
    await sidebar.expectIdentityThreatExpanded();
  });

  test('should navigate to Identity Forest page', async () => {
    await sidebar.goto();
    await sidebar.expandThreatDetection();
    await sidebar.expandIdentityThreat();
    await sidebar.identityForest.click();
    await expect(page).toHaveURL(/\/identity-threat-protection\/forest/);
  });

  // ── Independent expand states ────────────────────────────────────────

  test('should keep Dashboard expanded when Threat Detection is expanded', async () => {
    await sidebar.goto();

    // Expand Dashboard first
    await sidebar.expandDashboard();
    await sidebar.expectDashboardExpanded();

    // Expand Threat Detection
    await sidebar.expandThreatDetection();
    await sidebar.expectThreatDetectionExpanded();

    // Dashboard should still be expanded
    await sidebar.expectDashboardExpanded();
  });

  test('should keep Threat Detection expanded when Dashboard is collapsed', async () => {
    await sidebar.goto();

    // Expand both sections
    await sidebar.expandDashboard();
    await sidebar.expandThreatDetection();

    // Collapse Dashboard
    await sidebar.collapseDashboard();
    await sidebar.expectDashboardCollapsed();

    // Threat Detection should still be expanded
    await sidebar.expectThreatDetectionExpanded();
  });
});
