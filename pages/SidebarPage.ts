import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * NavTestIds mirror — kept in sync with BaseClient/src/shared/testIds/navTestIds.ts.
 * We inline them here to avoid importing from the BaseClient source tree.
 */
const NavTestIds = {
  // Dashboard expandable section
  NAV_DASHBOARD: 'nav-dashboard',
  NAV_DASHBOARD_OVERVIEW: 'nav-dashboard-overview',
  NAV_DASHBOARD_METRICS_A: 'nav-dashboard-metrics-a',
  NAV_DASHBOARD_KPIS: 'nav-dashboard-kpis',

  // Threat Detection & Analysis expandable section
  NAV_THREAT_DETECTION: 'nav-threat-detection',
  NAV_DETECTION_COVERAGE: 'nav-detection-coverage',
  NAV_DETECTION_RULES: 'nav-detection-rules',
  NAV_DETECTION_RULES_TA0001: 'nav-detection-rules-ta0001',
  NAV_DETECTION_RULES_TA0002: 'nav-detection-rules-ta0002',
  NAV_PLAYBOOKS: 'nav-playbooks',
  NAV_USER_BEHAVIOR: 'nav-user-behavior',
  NAV_ENDPOINT_BEHAVIOR: 'nav-endpoint-behavior',

  // Identity Threat Protection sub-group
  NAV_IDENTITY_THREAT: 'nav-identity-threat',
  NAV_IDENTITY_FOREST: 'nav-identity-forest',
  NAV_IDENTITY_DOMAIN: 'nav-identity-domain',
  NAV_IDENTITY_SITE: 'nav-identity-site',

  // Active Defense sub-group
  NAV_ACTIVE_DEFENSE: 'nav-active-defense',
  NAV_ACTIVE_DEFENSE_OVERVIEW: 'nav-active-defense-overview',
  NAV_AD_INSTANCES: 'nav-ad-instances',
  NAV_BEACON_TRAPS: 'nav-beacon-traps',
  NAV_BEACON_POLICIES: 'nav-beacon-policies',
  NAV_BEACON_SCHEDULES: 'nav-beacon-schedules',
  NAV_ACTIVE_DEFENSE_LICENSE: 'nav-active-defense-license',
} as const;

function tid(id: string): string {
  return `[data-testid="${id}"]`;
}

/**
 * Page object for the sidebar expandable navigation.
 *
 * Covers the Dashboard and Threat Detection & Analysis expandable sections,
 * including multi-level nested items introduced by the NavExpandableItem
 * component.
 */
export class SidebarPage extends BasePage {
  // ── Dashboard section ──
  readonly dashboardToggle: Locator;
  readonly dashboardOverview: Locator;
  readonly dashboardMetricsA: Locator;
  readonly dashboardKpis: Locator;

  // ── Threat Detection section ──
  readonly threatDetectionToggle: Locator;
  readonly detectionCoverage: Locator;
  readonly detectionRulesToggle: Locator;
  readonly detectionRulesTA0001: Locator;
  readonly detectionRulesTA0002: Locator;
  readonly playbooks: Locator;
  readonly userBehavior: Locator;
  readonly endpointBehavior: Locator;

  // ── Identity Threat Protection sub-group ──
  readonly identityThreatToggle: Locator;
  readonly identityForest: Locator;
  readonly identityDomain: Locator;
  readonly identitySite: Locator;

  // ── Active Defense sub-group ──
  readonly activeDefenseToggle: Locator;
  readonly activeDefenseOverview: Locator;
  readonly adInstances: Locator;
  readonly beaconTrapsToggle: Locator;
  readonly beaconPolicies: Locator;
  readonly beaconSchedules: Locator;
  readonly activeDefenseLicense: Locator;

  constructor(page: Page) {
    super(page);

    // Dashboard
    this.dashboardToggle = page.locator(tid(NavTestIds.NAV_DASHBOARD));
    this.dashboardOverview = page.locator(tid(NavTestIds.NAV_DASHBOARD_OVERVIEW));
    this.dashboardMetricsA = page.locator(tid(NavTestIds.NAV_DASHBOARD_METRICS_A));
    this.dashboardKpis = page.locator(tid(NavTestIds.NAV_DASHBOARD_KPIS));

    // Threat Detection
    this.threatDetectionToggle = page.locator(tid(NavTestIds.NAV_THREAT_DETECTION));
    this.detectionCoverage = page.locator(tid(NavTestIds.NAV_DETECTION_COVERAGE));
    this.detectionRulesToggle = page.locator(tid(NavTestIds.NAV_DETECTION_RULES));
    this.detectionRulesTA0001 = page.locator(tid(NavTestIds.NAV_DETECTION_RULES_TA0001));
    this.detectionRulesTA0002 = page.locator(tid(NavTestIds.NAV_DETECTION_RULES_TA0002));
    this.playbooks = page.locator(tid(NavTestIds.NAV_PLAYBOOKS));
    this.userBehavior = page.locator(tid(NavTestIds.NAV_USER_BEHAVIOR));
    this.endpointBehavior = page.locator(tid(NavTestIds.NAV_ENDPOINT_BEHAVIOR));

    // Identity Threat Protection
    this.identityThreatToggle = page.locator(tid(NavTestIds.NAV_IDENTITY_THREAT));
    this.identityForest = page.locator(tid(NavTestIds.NAV_IDENTITY_FOREST));
    this.identityDomain = page.locator(tid(NavTestIds.NAV_IDENTITY_DOMAIN));
    this.identitySite = page.locator(tid(NavTestIds.NAV_IDENTITY_SITE));

    // Active Defense
    this.activeDefenseToggle = page.locator(tid(NavTestIds.NAV_ACTIVE_DEFENSE));
    this.activeDefenseOverview = page.locator(tid(NavTestIds.NAV_ACTIVE_DEFENSE_OVERVIEW));
    this.adInstances = page.locator(tid(NavTestIds.NAV_AD_INSTANCES));
    this.beaconTrapsToggle = page.locator(tid(NavTestIds.NAV_BEACON_TRAPS));
    this.beaconPolicies = page.locator(tid(NavTestIds.NAV_BEACON_POLICIES));
    this.beaconSchedules = page.locator(tid(NavTestIds.NAV_BEACON_SCHEDULES));
    this.activeDefenseLicense = page.locator(tid(NavTestIds.NAV_ACTIVE_DEFENSE_LICENSE));
  }

  // ── Navigation ──

  async goto() {
    await super.goto('/');
  }

  // ── Actions: expand / collapse ──

  async expandDashboard() {
    await this.dashboardToggle.click();
    await expect(this.dashboardOverview).toBeVisible();
  }

  async collapseDashboard() {
    await this.dashboardToggle.click();
    await expect(this.dashboardOverview).not.toBeVisible();
  }

  async expandThreatDetection() {
    await this.threatDetectionToggle.click();
    await expect(this.detectionCoverage).toBeVisible();
  }

  async collapseThreatDetection() {
    await this.threatDetectionToggle.click();
    await expect(this.detectionCoverage).not.toBeVisible();
  }

  async expandDetectionRules() {
    await this.detectionRulesToggle.click();
    await expect(this.detectionRulesTA0001).toBeVisible();
  }

  async expandIdentityThreat() {
    await this.identityThreatToggle.click();
    await expect(this.identityForest).toBeVisible();
  }

  async expandActiveDefense() {
    await this.activeDefenseToggle.click();
    await expect(this.activeDefenseOverview).toBeVisible();
  }

  async expandBeaconTraps() {
    await this.beaconTrapsToggle.click();
    await expect(this.beaconPolicies).toBeVisible();
  }

  // ── Assertions ──

  async expectDashboardExpanded() {
    await expect(this.dashboardOverview).toBeVisible();
    await expect(this.dashboardMetricsA).toBeVisible();
    await expect(this.dashboardKpis).toBeVisible();
  }

  async expectDashboardCollapsed() {
    await expect(this.dashboardOverview).not.toBeVisible();
    await expect(this.dashboardMetricsA).not.toBeVisible();
    await expect(this.dashboardKpis).not.toBeVisible();
  }

  async expectThreatDetectionExpanded() {
    await expect(this.detectionCoverage).toBeVisible();
    await expect(this.detectionRulesToggle).toBeVisible();
    await expect(this.playbooks).toBeVisible();
    await expect(this.userBehavior).toBeVisible();
    await expect(this.endpointBehavior).toBeVisible();
    await expect(this.identityThreatToggle).toBeVisible();
    await expect(this.activeDefenseToggle).toBeVisible();
  }

  async expectThreatDetectionCollapsed() {
    await expect(this.detectionCoverage).not.toBeVisible();
    await expect(this.playbooks).not.toBeVisible();
  }

  async expectDetectionRulesExpanded() {
    await expect(this.detectionRulesTA0001).toBeVisible();
    await expect(this.detectionRulesTA0002).toBeVisible();
  }

  async expectDetectionRulesCollapsed() {
    await expect(this.detectionRulesTA0001).not.toBeVisible();
  }

  async expectIdentityThreatExpanded() {
    await expect(this.identityForest).toBeVisible();
    await expect(this.identityDomain).toBeVisible();
    await expect(this.identitySite).toBeVisible();
  }

  async expectActiveDefenseExpanded() {
    await expect(this.activeDefenseOverview).toBeVisible();
    await expect(this.adInstances).toBeVisible();
    await expect(this.beaconTrapsToggle).toBeVisible();
    await expect(this.activeDefenseLicense).toBeVisible();
  }

  async expectBeaconTrapsExpanded() {
    await expect(this.beaconPolicies).toBeVisible();
    await expect(this.beaconSchedules).toBeVisible();
  }

  async expectDashboardToggleVisible() {
    await expect(this.dashboardToggle).toBeVisible();
  }

  async expectThreatDetectionToggleVisible() {
    await expect(this.threatDetectionToggle).toBeVisible();
  }
}
