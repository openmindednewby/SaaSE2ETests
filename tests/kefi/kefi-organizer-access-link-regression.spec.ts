/**
 * Kefi ORGANIZER-SURFACE regression guard — "one access link killed the whole
 * dashboard".
 *
 * THE BUG THIS EXISTS FOR (fixed; must never return):
 *   The access-link list DTO returns `null` for fields that don't apply to a
 *   link's scope — a Door/Ledger link has no promoter, and the list response
 *   carries no `url` (the raw token is shown only once, at mint). A column render
 *   helper then called a string method on one of those nulls
 *   (`scope.toLowerCase()` / `url.trim()`), which throws during React render and
 *   drops the ENTIRE organizer dashboard into the error boundary.
 *
 *   The lethal part is the trigger: it needed no bad data and no unusual state —
 *   just the EXISTENCE of one access link. A tenant with zero links was fine; the
 *   moment an organizer minted their first door link, their P&L, attendees, costs
 *   and payouts all vanished behind an error screen. Every unit test still passed,
 *   because the null only appears on the wire.
 *
 * The guard is therefore shaped exactly like the bug: mint a Door link, THEN load
 * the organizer surface, and assert it renders — header present, error boundary
 * absent, and no uncaught page error. The fix normalizes null string fields
 * (`normalizeAccessLinkRows`), so a regression means a null slipping through
 * again, and only a load-with-a-link-present catches that.
 *
 * `@ui`. PROD-SAFE: the link it mints is revoked in `finally`; it creates no
 * attendee rows and mutates nothing else.
 */

import { test, expect } from '@playwright/test';

import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiOrganizerPage } from '../../pages/kefi/KefiOrganizerPage.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

test.describe('Kefi organizer surface survives an existing access link', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the organizer dashboard renders after a Door link exists (no error boundary, no page error)', async ({
    page,
  }) => {
    const ops = await openEventOps();

    // Capture anything thrown during render.
    //
    // BOTH listeners are needed. A React error boundary CATCHES the exception,
    // so in a production build `pageerror` frequently never fires — React
    // re-throws to `console.error` instead. Listening only for `pageerror`
    // would let the exact crash this spec guards against slip past silently,
    // which is how a "renders fine" assertion can pass over a dead dashboard.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Keep only real exceptions; a failed asset/401 probe is not a crash.
      if (text.includes('TypeError') || text.includes('ReferenceError')) {
        pageErrors.push(text.split('\n')[0]);
      }
    });

    try {
      // ── 1. Make the dangerous state exist ───────────────────────────────
      // A Door link is the exact shape that used to break the render: no
      // promoter (null) and no url on the list response (null).
      const doorLink = await ops.mintLink({
        recipientName: `${ops.marker} regression door`,
        scope: 'Door',
      });

      // ── 2. Load the organizer surface WITH that link present ────────────
      const login = new KefiLoginPage(page);
      await login.goto();
      await login.signIn({
        email: ops.tenant.organizerEmail,
        password: ops.tenant.organizerPassword,
      });

      const organizer = new KefiOrganizerPage(page);
      await organizer.gotoEvent(ops.tenant.eventExternalId);

      // ── 3. It renders ───────────────────────────────────────────────────
      // Assert "nothing threw" FIRST. If the dashboard crashed, the exception
      // text is the diagnosis; a bare "element not found" from expectRendered()
      // would report the symptom and hide the cause.
      await expect
        .poll(() => pageErrors, {
          message:
            'no uncaught exception while rendering the organizer surface ' +
            '(a null string field reaching a string method kills the WHOLE dashboard)',
          timeout: 20_000,
        })
        .toEqual([]);

      await organizer.expectRendered();

      // The sections that used to disappear behind the boundary are all here.
      await expect(
        organizer.accessLinksSection,
        'the access-links manager itself rendered',
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        organizer.attendeesSection,
        'the attendees section rendered — the crash took the WHOLE dashboard, not just the links card',
      ).toBeVisible();
      await expect(
        organizer.accessLinksLoadError,
        'the access-links list loaded without an error banner',
      ).toHaveCount(0);

      // The link we minted is actually listed, so the render really did walk the
      // row that carries the nulls — an empty list would pass vacuously.
      await expect(
        organizer.accessLinkRevoke(doorLink.externalId),
        'our minted link is rendered as a row (the null-bearing row WAS traversed)',
      ).toBeVisible({ timeout: 30_000 });

      // ── 4. Still nothing threw, after the whole surface settled ─────────
      expect(
        pageErrors,
        'no uncaught error was raised while rendering the organizer surface',
      ).toEqual([]);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'the link this test minted was revoked').toEqual([]);
    }
  });
});
