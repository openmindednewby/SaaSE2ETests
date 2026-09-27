/**
 * KEFI-LANDING-NAV-1 "Landing editor menu item" + KEFI-LIVE-LINK-1 "View live site
 * after save" — the AUTHENTICATED SIGHTING, taken without a human signing in.
 *
 * Walks the DEPLOYED organizer surface on app.kefi.dloizides.com at two device
 * projects (360x640 Galaxy S5 descriptor + Desktop Chrome 1280x800):
 *   /organizer → Landing tab (via the ☰ `organizer-menu` when the strip is
 *   collapsed) → /organizer/landing with `landing-editor-open-live` visible and
 *   pointing at /t/{slug} → Back → /organizer.
 * Each step is screenshotted into the run's output dir; hit boxes are recorded
 * as annotations; horizontal overflow is asserted at every step.
 *
 * ── PROD SAFETY ─────────────────────────────────────────────────────────────
 * READ / NAVIGATE ONLY. Never presses Save, Publish, Edit or Remove. The only
 * click besides navigation is "Open live site", which opens the PUBLIC landing
 * in a new tab; the popup URL is read and the tab is closed.
 *
 * ── KNOWN FAILURE ───────────────────────────────────────────────────────────
 * `organizer-tab-landing` measures 40-42.4px tall (shared `@dloizides/ui-layout`
 * Tabs). Its ≥44 check is its own test, marked `test.fail` against
 * KEFI-HITBOX-1 "Header and pro-gate hit boxes". When the package fix lands the
 * test turns "unexpectedly passed" — remove the marker then.
 *
 * Run: `--project=kefi-landing-sighting-360` / `--project=kefi-landing-sighting-1280`.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { bffLogin, proofOrganizer } from '../../helpers/kefi/kefiBrowserLogin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MENU_TRIGGER = 'organizer-menu';
const LANDING_TAB = 'organizer-tab-landing';
const OPEN_LIVE = 'landing-editor-open-live';
const LIVE_URL_CAPTION = 'landing-editor-live-url';
const EVENT_HEADER = 'organizer-event-header';
const MIN_HIT_PX = 44;
/** Sub-pixel rounding allowance for document overflow. */
const SUBPIXEL = 1;
const NAV_TIMEOUT = 60_000;
const SHELL_TIMEOUT = 45_000;
const ONE_DECIMAL = 10;
const LIVE_PATH = /^\/t\/([a-z0-9-]+)\/?$/;

interface HitBox {
  testId: string;
  width: number;
  height: number;
}

function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

async function expectNoSidewaysScroll(page: Page, step: string): Promise<void> {
  const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note('overflow-px', `${step}: ${px}`);
  expect(px, `${step}: the page does not scroll sideways (scrollWidth - innerWidth = ${px}px)`).toBeLessThanOrEqual(SUBPIXEL);
}

async function measure(page: Page, testId: string): Promise<HitBox> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a measurable box`).not.toBeNull();
  const round = (n: number): number => Math.round(n * ONE_DECIMAL) / ONE_DECIMAL;
  const hit = { testId, width: round(box!.width), height: round(box!.height) };
  note('hit-box', `${testId}: ${hit.width}x${hit.height}`);
  return hit;
}

function expectMinHitBox(hit: HitBox): void {
  expect(
    Math.min(hit.width, hit.height),
    `${hit.testId} hit box ${hit.width}x${hit.height} is at least ${MIN_HIT_PX}x${MIN_HIT_PX}`,
  ).toBeGreaterThanOrEqual(MIN_HIT_PX);
}

async function shot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  note('screenshot', path);
}

test.describe('Kefi organizer landing editor sighting (read-only)', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');

  let context: BrowserContext;
  let page: Page;
  let webUrl: string;

  /** Terminal shell state: header up, no error boundary, strip OR ☰ trigger on screen. */
  async function openDashboard(): Promise<void> {
    await page.goto(`${webUrl}/organizer`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await expect(page.getByTestId(EVENT_HEADER), 'the organizer event header mounted').toBeVisible({ timeout: SHELL_TIMEOUT });
    await expect
      .poll(
        async () => (await page.getByTestId(LANDING_TAB).isVisible()) || (await isCollapsed()),
        { message: 'either the Landing tab (wide strip) or the ☰ section menu (collapsed) is on screen', timeout: SHELL_TIMEOUT },
      )
      .toBe(true);
    await expect(page.getByTestId('error-boundary-reload-button'), 'no app error boundary').toHaveCount(0);
  }

  function isCollapsed(): Promise<boolean> {
    return page.getByTestId(MENU_TRIGGER).isVisible();
  }

  /** Reveal the Landing tab: opens the ☰ menu first when the strip is collapsed. */
  async function revealLandingTab(): Promise<void> {
    if (await isCollapsed()) await page.getByTestId(MENU_TRIGGER).click();
    const tab = page.getByTestId(LANDING_TAB);
    await tab.scrollIntoViewIfNeeded();
    await expect(tab, 'the Landing tab is visible (in the strip or the opened ☰ menu)').toBeVisible();
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    const creds = proofOrganizer();
    expect(creds.username.length, 'a proof organizer credential is configured (KEFI_PROOF_ORG_* or KEFI_TEST_*)').toBeGreaterThan(0);
    webUrl = getKefiUrls().webUrl;
    // ONE context per project, built from the project's own device settings, and ONE
    // sign-in: repeat password grants against a live prod organizer risk a lockout.
    context = await browser.newContext({ ...testInfo.project.use, ignoreHTTPSErrors: true });
    // A hand-built context does not inherit the project's action/navigation timeouts.
    const { actionTimeout, navigationTimeout } = testInfo.project.use;
    if (actionTimeout) context.setDefaultTimeout(actionTimeout);
    if (navigationTimeout) context.setDefaultNavigationTimeout(navigationTimeout);
    page = await context.newPage();
    await page.goto(`${webUrl}/login`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await bffLogin(page, creds);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('@ui KEFI-LANDING-NAV-1 + KEFI-LIVE-LINK-1: Landing tab reaches /organizer/landing, Open live site targets /t/{slug}, Back returns to /organizer', async () => {
    const viewport = page.viewportSize();
    note('viewport', `${viewport?.width}x${viewport?.height}`);

    // 1. Dashboard
    await openDashboard();
    await expectNoSidewaysScroll(page, '01-organizer');
    await shot(page, '01-organizer');
    const collapsed = await isCollapsed();
    note('tab-layout', collapsed ? 'collapsed ☰ menu' : 'wide tab strip');
    if (collapsed) expectMinHitBox(await measure(page, MENU_TRIGGER));

    // 2. Landing tab revealed (☰ menu open on mobile). Its ≥44 check is the known-failure test.
    await revealLandingTab();
    await measure(page, LANDING_TAB);
    await shot(page, '02-landing-tab-revealed');

    // 3. Landing editor
    await page.getByTestId(LANDING_TAB).click();
    await expect(page, 'the Landing tab routes to /organizer/landing').toHaveURL(/\/organizer\/landing(?:[?#].*)?$/, { timeout: SHELL_TIMEOUT });
    const openLive = page.getByTestId(OPEN_LIVE);
    await expect(openLive, 'the "Open live site" button is visible in the landing editor').toBeVisible({ timeout: SHELL_TIMEOUT });
    await expectNoSidewaysScroll(page, '03-organizer-landing');
    expectMinHitBox(await measure(page, OPEN_LIVE));
    const href = await openLive.getAttribute('href');
    note('open-live-href', href ?? '(none: the button opens via Linking.openURL onPress)');
    const caption = ((await page.getByTestId(LIVE_URL_CAPTION).textContent()) ?? '').trim();
    note('live-url-caption', caption);
    expect(caption, 'the live URL caption points at /t/{slug}').toMatch(/\/t\/[a-z0-9-]+/);
    await shot(page, '03-organizer-landing');

    // The URL "Open live site" actually opens (read, then the public tab is closed).
    const [popup] = await Promise.all([context.waitForEvent('page'), openLive.click()]);
    await popup.waitForURL((u) => u.protocol.startsWith('http'), { timeout: NAV_TIMEOUT });
    const target = new URL(popup.url());
    await popup.close();
    note('open-live-target', target.href);
    const slug = LIVE_PATH.exec(target.pathname)?.[1];
    expect(slug, `"Open live site" opens {origin}/t/{slug} (got ${target.href})`).toBeTruthy();
    expect(target.origin, '"Open live site" stays on the kefi-web origin').toBe(new URL(webUrl).origin);
    expect(caption, 'the caption shows the same URL the button opens').toContain(`/t/${slug}`);
    if (href) expect(href, 'the DOM href matches the opened URL path').toContain(`/t/${slug}`);

    // 4. Back
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page, 'Back returns to /organizer').toHaveURL(/\/organizer\/?(?:[?#].*)?$/, { timeout: SHELL_TIMEOUT });
    await expect(page.getByTestId(EVENT_HEADER), 'the dashboard re-mounted after Back').toBeVisible({ timeout: SHELL_TIMEOUT });
    await expectNoSidewaysScroll(page, '04-back-to-organizer');
    await shot(page, '04-back-to-organizer');
  });

  test('@ui KEFI-LANDING-NAV-1: organizer-tab-landing hit box is at least 44x44', async () => {
    test.fail(true, 'KNOWN FAILURE: KEFI-HITBOX-1 "Header and pro-gate hit boxes" (shared @dloizides/ui-layout Tabs row is 40-42.4px)');
    await openDashboard();
    await revealLandingTab();
    expectMinHitBox(await measure(page, LANDING_TAB));
  });
});
