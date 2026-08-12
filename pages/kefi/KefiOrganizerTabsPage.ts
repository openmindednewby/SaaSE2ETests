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
  // The Promoters tab now renders `CrewCommissionsSurface`; the standalone
  // promoters manager (`organizer-promoters-manager`) was deleted and promoters
  // live only in the crew Roster. `organizer-crew-roster` is the RosterSection
  // container that proves the panel painted its section.
  promoters: 'organizer-crew-roster',
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
  /**
   * The crew per-person detail modal (`organizer-crew-detail-modal`, which
   * REPLACED the deleted `organizer-promoter-action-modal`). A promoter's row
   * actions (Edit / Access-link / Retire / Guests-brought) now live INSIDE this
   * modal: it opens from a roster card's View action and shows that act's
   * detail. When nothing is open the modal renders nothing, so this resolves to
   * zero elements.
   */
  readonly promoterActionModal: Locator;
  /**
   * The per-person detail body inside {@link promoterActionModal}
   * (`organizer-crew-detail`). It carries the promoter's Edit / Access-link /
   * Retire actions. When a sub-panel (edit form / access-link panel) is open on
   * top of the detail, the detail body is UNMOUNTED and this resolves to zero;
   * closing the sub-panel re-mounts it.
   */
  readonly promoterDetail: Locator;

  constructor(page: Page) {
    this.page = page;
    this.eventHeader = page.getByTestId('organizer-event-header');
    this.tabsRoot = page.getByTestId('organizer-tabs');
    this.tabList = page.getByRole('tablist');
    this.anyPanel = page.locator('[id^="organizer-panel-"]');
    this.selectedTabs = page.locator('[role="tab"][aria-selected="true"]');
    this.errorBoundaryReload = page.getByTestId('error-boundary-reload-button');
    this.promoterActionModal = page.getByTestId('organizer-crew-detail-modal');
    this.promoterDetail = page.getByTestId('organizer-crew-detail');
  }

  /** The roster card's View action for one promoter-source act. */
  promoterRosterViewButton(promoterExternalId: string): Locator {
    return this.page.getByTestId(`organizer-crew-roster-view-promoter-${promoterExternalId}`);
  }

  /**
   * Open a promoter's per-person detail from the crew roster.
   *
   * The roster groups members into COLLAPSIBLE per-role cards; only the first
   * starts expanded and a collapsed card UNMOUNTS its body, so the target's View
   * action may not be in the DOM yet. This expands collapsed category cards until
   * the View action mounts (a card that is already expanded but does not hold the
   * target is harmlessly collapsed — its members are never the ones we are after,
   * or the View action would already be present), then clicks View and waits for
   * the crew detail modal to open.
   */
  async openPromoterDetail(promoterExternalId: string): Promise<void> {
    const view = this.promoterRosterViewButton(promoterExternalId);
    if ((await view.count()) === 0) {
      const cardToggles = this.page.locator(
        '[data-testid^="organizer-crew-roster-"][data-testid$="-toggle"]',
      );
      const toggleCount = await cardToggles.count();
      for (let index = 0; index < toggleCount; index += 1) {
        if ((await view.count()) > 0) break;
        await cardToggles.nth(index).click();
      }
    }
    await expect(
      view,
      'the promoter View action mounted in its (expanded) roster card',
    ).toBeVisible();
    await view.click();
    await expect(
      this.promoterActionModal,
      'clicking View opened the crew per-person detail modal',
    ).toBeVisible();
  }

  /**
   * Dismiss the sub-panel open on top of the crew detail (the edit form or the
   * access-link panel) via its own Close / Cancel control, returning to the
   * per-person detail beneath it.
   *
   * Unlike the old one-at-a-time row-action modal, closing a sub-panel does NOT
   * dismiss the whole modal — the detail is still selected, so control returns to
   * it (its body re-mounts). The close control differs per sub-panel, so the
   * caller passes the testID of the one the open sub-panel rendered:
   *   - access-link panel → `organizer-promoter-link-close`
   *   - edit form         → `organizer-promoter-cancel-edit`
   */
  async dismissPromoterSubPanel(closeControlTestId: string): Promise<void> {
    await this.page.getByTestId(closeControlTestId).click();
    await expect(
      this.promoterDetail,
      'closing the sub-panel returned to the promoter detail (the modal stays open)',
    ).toBeVisible();
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
