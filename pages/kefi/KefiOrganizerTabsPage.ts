/**
 * Page Object for the kefi-web ORGANIZER TAB SHELL (backlog C1, kefi-web 723eaa5).
 *
 * The organizer dashboard `/organizer` used to be one long scrolling page. It is
 * now a pinned event header + a tab bar of 8 sections
 * (Overview · Passes · Attendees · Promoters · Door · Ledger · Messaging · Settings),
 * built on the shared `@dloizides/ui-layout` `Tabs` primitive. This object drives
 * that shell; the section internals still bind to the same testIDs they always
 * did (see {@link KefiOrganizerPage}).
 *
 * DOM contract this relies on (asserted by the Tabs primitive's own unit tests):
 *  - each tab button:  `role="tab"`, `testID`/DOM-id `organizer-tab-<key>`,
 *    `aria-selected` true on the active one and false on the rest,
 *    `aria-controls="organizer-panel-<key>"`.
 *  - the active panel:  DOM-id `organizer-panel-<key>`, `aria-labelledby`
 *    pointing back at its tab. ONLY the active tab's panel is mounted — inactive
 *    panels render nothing — so "one visible panel at a time" is the strongest
 *    possible form here: the others are not in the DOM at all.
 *  - the active tab is a PATH SEGMENT — `/organizer/<key>` (deep-linkable and
 *    reload-surviving because a declared route param, unlike the old `?tab=`
 *    query key, is not stripped by kefi-web's `asyncRoutes.web=true` boot URL
 *    normalization). `?event=` still selects which event.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

/** The organizer tabs, in the exact display order the tab bar renders them. */
export const ORGANIZER_TAB_KEYS = [
  'overview',
  'passes',
  'attendees',
  'promoters',
  'door',
  'ledger',
  'messaging',
  'settings',
] as const;

export type OrganizerTabKey = (typeof ORGANIZER_TAB_KEYS)[number];

/**
 * A signature content testID unique to each tab's panel. Presence of the right
 * one proves the panel actually rendered its section, not just that the tab was
 * marked active — a tab that flips `aria-selected` but paints an empty panel
 * would pass a bare selection check and fail here.
 *
 * Mirrored from the shipped components rather than imported: E2E asserts the
 * deployed BEHAVIOUR, and importing the component's testID would let a rename
 * silently rewrite the expectation too.
 */
export const ORGANIZER_TAB_SIGNATURE: Record<OrganizerTabKey, string> = {
  overview: 'organizer-pnl',
  passes: 'organizer-passes',
  attendees: 'organizer-attendees',
  promoters: 'organizer-promoters-manager',
  door: 'organizer-door',
  ledger: 'organizer-ledger',
  messaging: 'organizer-messaging',
  settings: 'organizer-access-links',
};

export class KefiOrganizerTabsPage {
  readonly page: Page;
  /** The pinned event header — present as soon as the dashboard mounts. */
  readonly eventHeader: Locator;
  /** The Tabs primitive root container. */
  readonly tabsRoot: Locator;
  /** The tab strip (`role="tablist"`). */
  readonly tabList: Locator;
  /** Every currently-mounted tab panel. Resolves to exactly ONE at all times. */
  readonly anyPanel: Locator;
  /** Every tab reporting itself selected. Must always be exactly ONE. */
  readonly selectedTabs: Locator;
  /** The app error boundary's reload button — must NEVER appear. */
  readonly errorBoundaryReload: Locator;

  constructor(page: Page) {
    this.page = page;
    this.eventHeader = page.getByTestId('organizer-event-header');
    this.tabsRoot = page.getByTestId('organizer-tabs');
    this.tabList = page.getByRole('tablist');
    this.anyPanel = page.locator('[id^="organizer-panel-"]');
    this.selectedTabs = page.locator('[role="tab"][aria-selected="true"]');
    this.errorBoundaryReload = page.getByTestId('error-boundary-reload-button');
  }

  /** The tab button for one section. */
  tab(key: OrganizerTabKey): Locator {
    return this.page.getByTestId(`organizer-tab-${key}`);
  }

  /** The mounted panel for one section (only present when that tab is active). */
  panel(key: OrganizerTabKey): Locator {
    return this.page.locator(`#organizer-panel-${key}`);
  }

  /** The signature content element for one section's panel. */
  signature(key: OrganizerTabKey): Locator {
    return this.page.getByTestId(ORGANIZER_TAB_SIGNATURE[key]);
  }

  /**
   * Open the organizer dashboard for a specific event, optionally deep-linked to
   * a tab. The tab is a PATH segment (`/organizer/<tab>`) — the declared route
   * param survives the async-route boot that strips query keys; `?event=` stays
   * a query param and still selects which event.
   */
  async gotoEvent(eventExternalId: string, tab?: OrganizerTabKey): Promise<void> {
    const { webUrl } = getKefiUrls();
    const tabPath = tab ? `/${encodeURIComponent(tab)}` : '';
    await this.page.goto(
      `${webUrl}/organizer${tabPath}?event=${encodeURIComponent(eventExternalId)}`,
    );
  }

  /** Wait until the tab shell has mounted (header + tab bar on screen). */
  async waitForShell(): Promise<void> {
    await expect(
      this.eventHeader,
      'the pinned organizer event header mounted',
    ).toBeVisible({ timeout: 45_000 });
    await expect(this.tabList, 'the organizer tab bar mounted').toBeVisible({ timeout: 45_000 });
    await expect(
      this.errorBoundaryReload,
      'the organizer dashboard did not trip the app error boundary',
    ).toHaveCount(0);
  }

  /** Click a tab and wait for it to become the selected one. */
  async selectTab(key: OrganizerTabKey): Promise<void> {
    await this.tab(key).click();
    await expect(
      this.tab(key),
      `the ${key} tab reports aria-selected=true after being pressed`,
    ).toHaveAttribute('aria-selected', 'true');
  }

  /**
   * Assert `key` is the ONE active tab and its panel is the ONE mounted panel —
   * the a11y "single visible tabpanel" contract, plus the panel actually
   * rendered its section (signature element visible).
   */
  async expectActiveTab(key: OrganizerTabKey): Promise<void> {
    await expect(
      this.tab(key),
      `the ${key} tab is selected`,
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      this.panel(key),
      `the ${key} panel is the mounted panel`,
    ).toHaveCount(1);
    await expect(
      this.anyPanel,
      'exactly one organizer tab panel is mounted (one visible panel at a time)',
    ).toHaveCount(1);
    await expect(
      this.selectedTabs,
      'exactly one tab reports aria-selected=true',
    ).toHaveCount(1);
    await expect(
      this.signature(key),
      `the ${key} panel rendered its section content, not an empty panel`,
    ).toBeVisible({ timeout: 15_000 });
  }
}
