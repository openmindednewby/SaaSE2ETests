/**
 * DOM-parity spec — `kefi-landing-parity`.
 *
 * For each {tenant} × {viewport} the suite asserts that the kefi-managed
 * render matches the standalone reference along these axes:
 *   • Same section IDs in the same order
 *   • Per-section heights within tolerance (default 5%)
 *   • Same hero h1 typography (font-size + family + weight + color)
 *   • Same body background color
 *   • Nav height within 2px
 *   • Same nav-item text list (unless the tenant has `navItemsDiffer: true`)
 *
 * Known gaps declared in `parity-tenants.ts` are recorded as test
 * annotations rather than failing the run. Closing a gap means removing
 * its entry from the tenant config.
 *
 * Runs against the LIVE prod URLs — no local cluster required. Safe for
 * nightly cron; both sites are publicly accessible.
 */
import { expect, test } from '@playwright/test';
import {
  DEFAULT_PAGE_TOLERANCE,
  DEFAULT_SECTION_TOLERANCE,
  TENANTS,
  type KefiLandingTenant,
} from './parity-tenants.js';
import {
  extractParityManifest,
  gotoAndSettle,
  heightDriftRatio,
  type ParityManifest,
} from './parity-helpers.js';

/**
 * Breakpoints the suite measures. 1280px is the desktop primary; 768 +
 * 375 catch responsive-layout drift; 1920 catches large-screen
 * overflow.
 */
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
] as const satisfies ReadonlyArray<{
  name: 'mobile' | 'tablet' | 'desktop';
  width: number;
  height: number;
}>;

for (const tenant of TENANTS) {
  test.describe(`@kefi-landing-parity ${tenant.label}`, () => {
    for (const vp of VIEWPORTS) {
      test(`${tenant.label} dom-parity @ ${vp.name} ${vp.width}px`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();
        try {
          const standalone = await captureManifest(page, tenant.standaloneUrl);
          const kefi = await captureManifest(page, tenant.kefiUrl);
          assertParityForViewport(tenant, standalone, kefi, vp.name);
        } finally {
          await context.close();
        }
      });
    }
  });
}

async function captureManifest(page: import('@playwright/test').Page, url: string): Promise<ParityManifest> {
  await gotoAndSettle(page, url);
  return extractParityManifest(page);
}

/**
 * Apply the parity assertions for one (tenant, viewport) pair. Known
 * gaps are recorded via `test.info().annotations` so a "green" run is
 * legible — readers see exactly which gaps were tolerated.
 */
function assertParityForViewport(
  tenant: KefiLandingTenant,
  standalone: ParityManifest,
  kefi: ParityManifest,
  viewportName: 'mobile' | 'tablet' | 'desktop',
): void {
  recordKnownGapAnnotations(tenant);
  assertSectionStructure(standalone, kefi);
  assertSectionHeights(tenant, standalone, kefi);
  assertTypographyAndChrome(tenant, standalone, kefi, viewportName);
  assertNavItems(tenant, standalone, kefi);
  assertPageHeight(tenant, standalone, kefi);
}

function recordKnownGapAnnotations(tenant: KefiLandingTenant): void {
  const gaps = tenant.knownGaps;
  if (gaps.sectionHeightDrift?.length) {
    test.info().annotations.push({
      type: 'known-gap',
      description: `section height drift tolerated: ${gaps.sectionHeightDrift.join(', ')}`,
    });
  }
  if (gaps.navItemsDiffer) {
    test.info().annotations.push({
      type: 'known-gap',
      description: 'nav items differ from standalone',
    });
  }
  if (gaps.pageHeightDrift) {
    test.info().annotations.push({
      type: 'known-gap',
      description: 'page-total height drift tolerated',
    });
  }
}

function assertSectionStructure(standalone: ParityManifest, kefi: ParityManifest): void {
  const standaloneIds = standalone.sections.map((s) => s.id);
  const kefiIds = kefi.sections.map((s) => s.id);
  expect(kefiIds, 'same section IDs in same order').toEqual(standaloneIds);
}

function assertSectionHeights(
  tenant: KefiLandingTenant,
  standalone: ParityManifest,
  kefi: ParityManifest,
): void {
  const overrides = tenant.knownGaps.sectionToleranceOverrides ?? {};
  const tolerated = new Set(tenant.knownGaps.sectionHeightDrift ?? []);
  for (const stand of standalone.sections) {
    const kefiSec = kefi.sections.find((s) => s.id === stand.id);
    if (!kefiSec) continue;
    if (tolerated.has(stand.id)) continue;
    const tolerance = overrides[stand.id] ?? DEFAULT_SECTION_TOLERANCE;
    const drift = heightDriftRatio(stand.height, kefiSec.height);
    expect(
      drift,
      `section ${stand.id} height drift (std=${stand.height}, kefi=${kefiSec.height})`,
    ).toBeLessThan(tolerance);
  }
}

/** Default nav-height drift tolerance in pixels. Tightened by viewport overrides. */
const DEFAULT_NAV_HEIGHT_TOLERANCE_PX = 2;

function assertTypographyAndChrome(
  tenant: KefiLandingTenant,
  standalone: ParityManifest,
  kefi: ParityManifest,
  viewportName: 'mobile' | 'tablet' | 'desktop',
): void {
  expect(kefi.h1.fontSize, 'hero h1 font-size').toBe(standalone.h1.fontSize);
  expect(kefi.h1.fontFamily, 'hero h1 font-family').toBe(standalone.h1.fontFamily);
  expect(kefi.h1.fontWeight, 'hero h1 font-weight').toBe(standalone.h1.fontWeight);
  expect(kefi.h1.color, 'hero h1 color').toBe(standalone.h1.color);
  expect(kefi.bodyBg, 'body background').toBe(standalone.bodyBg);
  const navTolerance =
    tenant.knownGaps.navHeightToleranceByViewport?.[viewportName] ?? DEFAULT_NAV_HEIGHT_TOLERANCE_PX;
  expect(Math.abs(kefi.navHeight - standalone.navHeight), 'nav height (px drift)').toBeLessThanOrEqual(
    navTolerance,
  );
}

function assertNavItems(
  tenant: KefiLandingTenant,
  standalone: ParityManifest,
  kefi: ParityManifest,
): void {
  if (tenant.knownGaps.navItemsDiffer) return;
  expect(kefi.navItems, 'nav item list').toEqual(standalone.navItems);
}

function assertPageHeight(
  tenant: KefiLandingTenant,
  standalone: ParityManifest,
  kefi: ParityManifest,
): void {
  if (tenant.knownGaps.pageHeightDrift) return;
  const drift = heightDriftRatio(standalone.pageHeight, kefi.pageHeight);
  expect(drift, `page total height drift (std=${standalone.pageHeight}, kefi=${kefi.pageHeight})`).toBeLessThan(
    DEFAULT_PAGE_TOLERANCE,
  );
}
