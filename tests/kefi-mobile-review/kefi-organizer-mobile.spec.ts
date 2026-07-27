/**
 * Kefi ORGANIZER dashboard at PHONE width — the collapsed-menu + card-stack
 * proof the wider suite could only INFER.
 *
 * Every other organizer `@ui` spec runs at desktop width, where the 8-section
 * tab bar is a horizontal pill strip and the DataTables are grids. On a phone
 * the shared `@dloizides/ui-layout` `Tabs` primitive collapses (below its 768dp
 * breakpoint) into a SINGLE `organizer-menu` trigger with a caret that opens a
 * vertical section list, and the shared `@dloizides/ui-tables` `DataTable`
 * card-stacks (below 640dp). Neither transform is visible to a desktop or a unit
 * test — only a real mobile viewport reproduces the visual-viewport semantics
 * that drive them.
 *
 * Drives the DEPLOYED organizer surface on app.kefi.dloizides.com at a real
 * 390×844 iPhone-13 device descriptor (isMobile + hasTouch + dpr, not a narrow
 * desktop window) and captures a screenshot per surface into
 * `qa-screenshots/organizer-mobile-proof/`.
 *
 * Consolidated into ONE comprehensive walk (like kefi-organizer-tabs) because the
 * `tests/kefi` batch sits at its CI size cap — and it is also the truest "human
 * scrolls the whole dashboard on a phone" verification.
 *
 * ── AUTH (no password ever typed into a form) ───────────────────────────────
 * The BFF session is established by a same-origin POST to `/bff/login` — the
 * exact call the SPA's password tab makes, minus the keystrokes. The browser
 * holds only the opaque `__Host-bff-kefi` cookie; no token is injected. Creds
 * come from KEFI_PROOF_ORG_USERNAME / KEFI_PROOF_ORG_PASSWORD, defaulting to the
 * suite's sanctioned prod test organizer (KEFI_TEST_USERNAME / KEFI_TEST_PASSWORD).
 *
 * ── PROD SAFETY ─────────────────────────────────────────────────────────────
 * STRICTLY READ-ONLY. Navigates, opens the section menu, switches sections and
 * measures/screenshots. Never registers, deletes, marks paid, mints a link,
 * checks anyone in, or submits any form — safe against any organizer account.
 *
 * Run: `--project=kefi-organizer-mobile` (workers:1, one shared sign-in).
 */

import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import {
  KefiOrganizerTabsPage,
  ORGANIZER_TAB_KEYS,
  type OrganizerTabKey,
} from '../../pages/kefi/KefiOrganizerTabsPage.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

/** iPhone 13 — a real 390×844 logical viewport with mobile visual-viewport semantics. */
const PHONE = devices['iPhone 13'];
/** Per-item proof screenshots land here (Playwright auto-creates the dir). */
const SHOT_DIR = 'qa-screenshots/organizer-mobile-proof';
/** The collapsed section-menu trigger testID (idPrefix `organizer` + `-menu`). */
const MENU_TRIGGER = 'organizer-menu';
/** Max px of horizontal document overflow a phone user could never trigger. */
const SUBPIXEL = 1;
/** Narrow-phone secondary viewport (item 6). */
const NARROW = { width: 360, height: 740 };

/** Resolve the proof organizer credentials (sanctioned test org by default). */
function proofOrganizer(): { username: string; password: string } {
  return {
    username: process.env.KEFI_PROOF_ORG_USERNAME ?? process.env.KEFI_TEST_USERNAME ?? '',
    password: process.env.KEFI_PROOF_ORG_PASSWORD ?? process.env.KEFI_TEST_PASSWORD ?? '',
  };
}

/**
 * Same-origin `/bff/login` POST — identical to what the SPA password tab sends,
 * with no form interaction. Sets the `__Host-bff-kefi` session cookie. Throws
 * with the status + body so a bad credential is unmistakable.
 */
async function bffLogin(page: Page, creds: { username: string; password: string }): Promise<void> {
  const result = await page.evaluate(async (c: { username: string; password: string }) => {
    const res = await fetch('/bff/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
      body: JSON.stringify({ username: c.username, password: c.password }),
    });
    let body = '';
    try {
      body = await res.text();
    } catch {
      // no body
    }
    return { status: res.status, body };
  }, creds);
  if (result.status !== 200) {
    throw new Error(
      `bffLogin: POST /bff/login → ${result.status} for '${creds.username}': ${result.body.slice(0, 200)}`,
    );
  }
}

/** Horizontal document overflow in px (positive ⇒ the page scrolls sideways). */
function overflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe('Kefi organizer dashboard at phone width', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');

  let context: BrowserContext;
  let page: Page;
  let organizer: KefiOrganizerTabsPage;
  let webUrl: string;

  /**
   * Phone-viewport shell wait. The shared `waitForShell()` asserts `role=tablist`,
   * which does NOT exist below the collapse breakpoint — the bar becomes the
   * `organizer-menu` trigger. Terminal mobile state: header up, trigger up, no
   * error boundary.
   */
  async function waitForMobileShell(): Promise<void> {
    await expect(
      page.getByTestId('organizer-event-header'),
      'the pinned organizer event header mounted',
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByTestId(MENU_TRIGGER),
      'the collapsed section-menu trigger mounted (the tab bar collapsed at phone width)',
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByTestId('error-boundary-reload-button'),
      'the organizer dashboard did not trip the app error boundary',
    ).toHaveCount(0);
  }

  /** Fresh dashboard, open the collapsed menu, choose a section (the phone path to a tab). */
  async function openSection(key: OrganizerTabKey): Promise<void> {
    await page.goto(`${webUrl}/organizer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForMobileShell();
    await page.getByTestId(MENU_TRIGGER).click();
    await page.getByTestId(`organizer-tab-${key}`).click();
    await expect(
      organizer.signature(key),
      `the ${key} section rendered its content after selection`,
    ).toBeVisible({ timeout: 15_000 });
  }

  function note(type: string, description: string): void {
    test.info().annotations.push({ type, description });
  }

  test.beforeAll(async ({ browser }) => {
    const creds = proofOrganizer();
    expect(
      creds.username.length,
      'a proof organizer credential is configured (KEFI_PROOF_ORG_* or KEFI_TEST_*)',
    ).toBeGreaterThan(0);

    webUrl = getKefiUrls().webUrl;
    // Explicit device context — guarantees 390×844 + mobile semantics regardless of
    // the project `use`, and lets the walk share ONE sign-in (a live prod surface;
    // repeat ROPC logins risk a self-inflicted Keycloak lockout).
    context = await browser.newContext({ ...PHONE, ignoreHTTPSErrors: true });
    page = await context.newPage();
    await page.goto(`${webUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await bffLogin(page, creds);
    organizer = new KefiOrganizerTabsPage(page);
    await page.goto(`${webUrl}/organizer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForMobileShell();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('@ui @mobile organizer dashboard at phone width: collapsed section menu, card-stacked tables, inline pricing, door export bar, consistent row actions', async () => {
    // ── 1. The section bar is a COLLAPSED menu (single caret trigger), not a strip ──
    await page.goto(`${webUrl}/organizer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForMobileShell();
    const trigger = page.getByTestId(MENU_TRIGGER);
    await expect(trigger, 'the collapsed section-menu trigger is present at phone width').toBeVisible();
    await expect(
      page.getByRole('tablist'),
      'the wide horizontal tab strip is NOT rendered at phone width (it collapsed to a menu)',
    ).toHaveCount(0);
    const tabIndex = await trigger.evaluate((el) => (el as HTMLElement).tabIndex);
    expect(tabIndex, 'the collapsed menu trigger is keyboard-focusable (tabindex ≠ -1)').not.toBe(-1);
    await page.screenshot({ path: `${SHOT_DIR}/01-collapsed-menu-closed.png` });

    await trigger.click();
    for (const key of ORGANIZER_TAB_KEYS) {
      await expect(
        page.getByTestId(`organizer-tab-${key}`),
        `the ${key} section is an option in the opened menu`,
      ).toBeVisible();
    }
    await page.screenshot({ path: `${SHOT_DIR}/02-collapsed-menu-open.png` });

    // ── 2. Passes + Attendees DataTables card-stack (no sideways scroll) ──────────
    await openSection('passes');
    await expect(page.getByTestId('ui-data-table-head').first(), 'the passes DataTable mounted').toBeAttached();
    expect(await overflowPx(page), 'the Passes tab does not scroll sideways on a phone').toBeLessThanOrEqual(SUBPIXEL);
    await page.screenshot({ path: `${SHOT_DIR}/03-passes-card-stack.png`, fullPage: true });

    await openSection('attendees');
    await expect(page.getByTestId('ui-data-table-head').first(), 'the attendees DataTable mounted').toBeAttached();
    expect(await overflowPx(page), 'the Attendees tab does not scroll sideways on a phone').toBeLessThanOrEqual(SUBPIXEL);
    await page.screenshot({ path: `${SHOT_DIR}/04-attendees-card-stack.png`, fullPage: true });

    // ── 3. Passes price cell: current price inline, scheduled-change line, NO modal ─
    await openSection('passes');
    await expect(
      page.locator('[data-testid^="organizer-pass-current-price-"]').first(),
      'the inline current price is shown in the table cell',
    ).toBeVisible();
    await expect(
      page.getByTestId('organizer-pass-pricing-resolved'),
      'the pricing modal is closed — the price is legible inline',
    ).toHaveCount(0);
    const scheduledCount = await page.locator('[data-testid^="organizer-pass-next-change-"]').count();
    note('scheduled-price-rows', `passes showing a "scheduled price" line: ${scheduledCount}`);
    await page.screenshot({ path: `${SHOT_DIR}/05-passes-inline-pricing.png`, fullPage: true });

    // ── 4. Door tab: report-scope checkboxes + door-code badges + Print / Export-CSV ─
    await openSection('door');
    await expect(page.getByTestId('organizer-door'), 'the Door section rendered').toBeVisible();

    // The export scope is now TWO checkboxes (was three icon buttons `organizer-door-mode-*`):
    // the attendee door list and the crew / DJ & media roster. "Attendee list" is the default,
    // ticked on load; the selector refuses to clear the LAST ticked box so Print / Export always
    // has a section. Toggling is pure local UI state (no server write), so it stays read-only.
    const includeAttendee = page.getByTestId('organizer-door-include-attendee');
    const includeCrew = page.getByTestId('organizer-door-include-crew');
    await expect(includeAttendee, 'the attendee-list scope checkbox is present').toBeVisible();
    await expect(includeCrew, 'the crew scope checkbox is present').toBeVisible();
    await expect(includeAttendee, 'the attendee-list scope is ticked by default').toBeChecked();
    await expect(includeCrew, 'the crew scope starts unticked (attendee list is the default)').not.toBeChecked();

    // Invariant: clicking the SOLE ticked box does NOT clear it — a report of nothing is never
    // offered. Crew starts unticked, so attendee is the only ticked box here.
    await includeAttendee.click();
    await expect(includeAttendee, 'the last ticked scope box stays ticked — a section is always included').toBeChecked();

    // Tick/untick both ways when the event has roster crew (else the crew box is disabled and the
    // invariant above already proved the at-least-one rule).
    const crewDisabled = (await includeCrew.getAttribute('aria-disabled')) === 'true';
    note('door-crew-scope', crewDisabled ? 'crew box disabled (no roster crew)' : 'crew box enabled');
    if (!crewDisabled) {
      await includeCrew.click();
      await expect(includeCrew, 'ticking crew adds the crew section to the report').toBeChecked();
      await includeAttendee.click();
      await expect(includeAttendee, 'attendee can be unticked now that crew keeps a section').not.toBeChecked();
      await expect(includeCrew, 'crew stays ticked as the remaining section').toBeChecked();
      await includeAttendee.click(); // restore the on-load scope (attendee-only)
      await includeCrew.click();
      await expect(includeAttendee, 'attendee scope restored to ticked').toBeChecked();
      await expect(includeCrew, 'crew scope restored to unticked').not.toBeChecked();
    }

    await expect(page.getByTestId('organizer-door-print'), 'the door Print action is present').toBeVisible();
    await expect(page.getByTestId('organizer-door-export-csv'), 'the door Export-CSV action is present').toBeVisible();
    const badgeCount = await page.locator('[data-testid^="organizer-door-code-"]').count();
    note('door-code-badges', `door-code badges rendered: ${badgeCount}`);
    await page.screenshot({ path: `${SHOT_DIR}/06-door-tab.png`, fullPage: true });

    // ── 5. Passes + Attendees row-action icon buttons are the SAME size ───────────
    await openSection('passes');
    const passEdit = page.locator('[data-testid^="organizer-pass-edit-"]').first();
    await expect(passEdit, 'a passes row-action button is present to measure').toBeVisible();
    const passBox = await passEdit.boundingBox();
    expect(passBox, 'the passes row-action button has a measurable box').not.toBeNull();

    await openSection('attendees');
    const attendeeDelete = page.locator('[data-testid^="organizer-attendee-delete-"]').first();
    await expect(attendeeDelete, 'an attendees row-action button is present to measure').toBeVisible();
    const attendeeBox = await attendeeDelete.boundingBox();
    expect(attendeeBox, 'the attendees row-action button has a measurable box').not.toBeNull();

    const passSize = Math.round(passBox!.height);
    const attendeeSize = Math.round(attendeeBox!.height);
    note('row-action-sizes', `passes ${passSize}px vs attendees ${attendeeSize}px`);
    expect(
      Math.abs(passSize - attendeeSize),
      `row-action buttons are the same size across tables (passes ${passSize}px, attendees ${attendeeSize}px)`,
    ).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `${SHOT_DIR}/07-row-action-consistency.png` });

    // ── 6. The collapse still holds at a narrower 360×740 phone ───────────────────
    await page.setViewportSize(NARROW);
    await page.goto(`${webUrl}/organizer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForMobileShell();
    await expect(
      page.getByTestId(MENU_TRIGGER),
      'the section bar is still a collapsed menu at 360px',
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/08-collapsed-menu-360.png` });
    await page.setViewportSize({ width: PHONE.viewport.width, height: PHONE.viewport.height });
  });
});
