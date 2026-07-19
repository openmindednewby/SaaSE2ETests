/**
 * Page Object for the kefi-web ORGANIZER surface (`/organizer`) — the only screen
 * that shows full attendee PII, all payouts and the server-computed P&L.
 *
 * Unlike the tenant landing pages this IS the RN-web SPA, so everything binds to
 * `testID`s. Two contracts matter here:
 *
 *  - `?event={externalId}` renders THAT event's dashboard; without it the most
 *    recent event is used. The specs always pass it explicitly so they never
 *    depend on which event happens to be newest.
 *  - The attendee table is a shared `DataTable` that renders EVERY row it is
 *    given (pagination is a separate `Pager` component this surface does not
 *    use), so a specific attendee's row controls are always present in the DOM
 *    even on a ~160-row event — no paging dance required, just a scroll.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

export class KefiOrganizerPage {
  readonly page: Page;
  /** Present as soon as the organizer dashboard mounts. */
  readonly eventHeader: Locator;
  /** The app error boundary's reload button — must NEVER be present. */
  readonly errorBoundaryReload: Locator;
  /** The boundary's visible button, matched by role — a testID-independent signal. */
  readonly errorBoundaryFallback: Locator;
  readonly attendeesSection: Locator;
  readonly accessLinksSection: Locator;
  readonly accessLinkNameInput: Locator;
  readonly accessLinkScopeSelect: Locator;
  readonly accessLinkSubmit: Locator;
  readonly mintedLinkNotice: Locator;
  readonly mintedLinkUrl: Locator;
  readonly accessLinksLoadError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.eventHeader = page.getByTestId('organizer-event-header');
    this.errorBoundaryReload = page.getByTestId('error-boundary-reload-button');
    this.errorBoundaryFallback = page.getByRole('button', { name: /^(Reload|Try Again)$/ });
    this.attendeesSection = page.getByTestId('organizer-attendees');
    this.accessLinksSection = page.getByTestId('organizer-access-links');
    this.accessLinkNameInput = page.getByTestId('organizer-access-link-name');
    this.accessLinkScopeSelect = page.getByTestId('organizer-access-link-scope');
    this.accessLinkSubmit = page.getByTestId('organizer-access-link-submit');
    this.mintedLinkNotice = page.getByTestId('organizer-access-link-minted');
    this.mintedLinkUrl = page.getByTestId('organizer-access-link-minted-url');
    this.accessLinksLoadError = page.getByTestId('organizer-access-links-load-error');
  }

  /** Open the organizer dashboard for a specific event. */
  async gotoEvent(eventExternalId: string): Promise<void> {
    const { webUrl } = getKefiUrls();
    await this.page.goto(`${webUrl}/organizer?event=${encodeURIComponent(eventExternalId)}`);
  }

  /**
   * Wait until the surface reaches a TERMINAL state — either it mounted, or the
   * app error boundary took over.
   *
   * Why this is separate from {@link expectRendered}: the dashboard mounts
   * before all of its queries resolve, so a crash caused by a late-arriving
   * response happens AFTER the header is already on screen. Asserting the header
   * alone can therefore pass against a surface that dies a moment later. Callers
   * settle here first, then assert what they actually care about.
   *
   * The boundary is matched by testID OR by its visible "Reload" button, so a
   * missing/renamed testID cannot silently turn a crash into a timeout.
   */
  async waitForTerminalState(): Promise<void> {
    await expect(
      this.eventHeader.or(this.errorBoundaryReload).or(this.errorBoundaryFallback).first(),
      'the organizer surface reached a terminal state (mounted, or crashed)',
    ).toBeVisible({ timeout: 45_000 });
  }

  /**
   * Assert the surface actually RENDERED — the header is visible AND the error
   * boundary is absent. Both halves matter: a crashed surface can still leave a
   * shell mounted, and an error boundary with no header check would miss a blank
   * render. This pairing is the regression assertion for the access-link crash.
   */
  async expectRendered(): Promise<void> {
    await expect(this.eventHeader, 'the organizer dashboard mounted').toBeVisible({
      timeout: 45_000,
    });
    await expect(
      this.errorBoundaryReload,
      'the organizer dashboard did not trip the app error boundary',
    ).toHaveCount(0);
  }

  /** The Paid/Unpaid status badge for one attendee. */
  paidBadge(attendeeExternalId: string): Locator {
    return this.page.getByTestId(`organizer-attendee-paid-${attendeeExternalId}`);
  }

  /** The Paid/Unpaid toggle button for one attendee. */
  paidToggle(attendeeExternalId: string): Locator {
    return this.page.getByTestId(`organizer-attendee-toggle-paid-${attendeeExternalId}`);
  }

  /**
   * Click the paid toggle and wait for the PATCH to resolve, so the assertion
   * that follows reads settled state rather than racing the mutation.
   */
  async togglePaidAndAwaitWrite(attendeeExternalId: string): Promise<number> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes(`/attendees/${attendeeExternalId}/payment`) &&
        response.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    const toggle = this.paidToggle(attendeeExternalId);
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    const response = await responsePromise;
    return response.status();
  }

  /** The revoke button for one access-link row. */
  accessLinkRevoke(linkExternalId: string): Locator {
    return this.page.getByTestId(`organizer-access-link-revoke-${linkExternalId}`);
  }
}
