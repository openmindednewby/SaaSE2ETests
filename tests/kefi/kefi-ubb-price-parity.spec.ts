/**
 * Kefi PRICE-PARITY E2E — the three-way agreement that protects the buyer.
 *
 * Its sibling `kefi-ubb-tiered-pricing.spec.ts` proves the price WINDOWS are
 * well-formed. This file proves something different and more important: that
 * every surface which QUOTES a price agrees with the surface that CHARGES one.
 *
 * A price has four independent representations, and a buyer is only treated
 * honestly when all four agree:
 *
 *   1. `GET /api/v1/organizer/events/{id}/passes` → `currentPriceEur`
 *        the organizer's authoritative resolved price.
 *   2. `GET /api/v1/t/{slug}/{eventSlug}` → `passes[].priceEur`
 *        the public API payload.
 *   3. `landing.passes[].price` — hand-authored marketing DISPLAY STRINGS
 *        (`"€30"`). A SEPARATE field that nothing keeps in sync with (1)/(2),
 *        and the one the static landing page actually renders.
 *   4. The register endpoint's recorded `priceEur` — what the buyer is BOOKED at.
 *
 * ⭐ THE CENTRAL ASSERTION of the whole UBB suite is the last test here:
 * `what the register FORM shows` === `what the server RECORDS`. Every other
 * assertion compares one server field to another server field and can be green
 * while a buyer is still misled — because both sides are internally consistent,
 * they just read different fields. Only a check that reads the RENDERED PAGE
 * and then books a real registration can catch that.
 *
 * PROD-SAFE: the one attendee registered here is deleted in `finally` and the
 * roster size is asserted back to baseline. The other tests are pure reads.
 */

import { test, expect } from '@playwright/test';

import {
  KefiPassPricingClient,
  parseDisplayPrice,
  sortWindows,
  type OrganizerPass,
} from '../../helpers/kefi/kefiPassPricingClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

// NOT serial: `workers: 1` already runs these sequentially (which the 5/60s
// per-IP register limit needs), while serial mode would additionally CASCADE-SKIP
// every test after the first failure — hiding exactly the assertions that matter
// most when something is already wrong.

const HTTP_OK = 200;

/**
 * The fixture EVENT's public URL slug — the `{eventSlug}` in
 * `GET /api/v1/t/{slug}/{eventSlug}`.
 *
 * Was hardcoded `'united-by-bachata'`, which pinned the spec to the UBB tenant
 * and made every assertion here 404 the moment the fixture moved. It is a
 * property of the fixture event, so it lives with the other fixture
 * coordinates in `.env.<target>`.
 */
const EVENT_SLUG = (process.env.KEFI_FIXTURE_EVENT_SLUG ?? '').trim();

test.describe('Kefi UBB price parity', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the public payload quotes the same resolved price as the organizer list', async () => {
    const ops = await openEventOps();
    const pricing = new KefiPassPricingClient();

    const organizer = await pricing.getOrganizerPasses(ops.bearer, ops.tenant.eventExternalId);
    expect(organizer.status, 'the organizer pass list reads').toBe(HTTP_OK);
    const authoritative = organizer.data as OrganizerPass[];

    const publicResp = await pricing.getPublicEvent(ops.tenant.slug, EVENT_SLUG);
    expect(publicResp.status, 'the public event payload reads anonymously').toBe(HTTP_OK);

    expect(
      publicResp.data.passes.length,
      'the public payload offers every pass the organizer configured',
    ).toBe(authoritative.length);

    for (const pass of authoritative) {
      const shown = publicResp.data.passes.find((p) => p.code === pass.code);
      expect(shown, `the public payload offers the ${pass.code} pass`).toBeDefined();
      expect(
        shown!.priceEur,
        `the public payload quotes ${pass.code} at the organizer's resolved current price`,
      ).toBe(pass.currentPriceEur);
      expect(
        shown!.priceHoldsUntilUtc,
        `the public payload carries ${pass.code}'s price-holds-until so the page can show urgency`,
      ).toBe(pass.currentPriceHoldsUntilUtc);
    }
  });

  test('@api the hand-authored marketing prices agree with the prices the server charges', async () => {
    // `landing.passes` is a separate, hand-authored array of DISPLAY STRINGS.
    // The static landing page renders THESE, while the register endpoint charges
    // `passes[].priceEur`. Nothing in the product keeps the two in sync, so this
    // asserts the invariant that makes the rendered page trustworthy.
    const ops = await openEventOps();
    const pricing = new KefiPassPricingClient();

    const publicResp = await pricing.getPublicEvent(ops.tenant.slug, EVENT_SLUG);
    expect(publicResp.status, 'the public event payload reads anonymously').toBe(HTTP_OK);
    const { passes, landingPasses } = publicResp.data;

    expect(
      landingPasses.length,
      'the marketing array describes some passes (else the page shows no prices)',
    ).toBeGreaterThan(0);

    for (const marketing of landingPasses) {
      // The marketing array keys on a lowercase id (`full`), the server on an
      // uppercase code (`FULL`).
      const serverPass = passes.find((p) => p.code.toLowerCase() === marketing.id.toLowerCase());
      expect(
        serverPass,
        `the marketing pass "${marketing.id}" maps to a real server pass`,
      ).toBeDefined();

      const quoted = parseDisplayPrice(marketing.price);
      expect(
        quoted,
        `the marketing price "${marketing.price}" for ${marketing.id} is a parseable amount`,
      ).not.toBeNull();

      expect(
        quoted,
        `the marketing copy for ${marketing.id} quotes the price the server actually charges ` +
          `(marketing says "${marketing.price}", the server charges €${serverPass!.priceEur})`,
      ).toBe(serverPass!.priceEur);
    }
  });

  test('@api no future price tier is scheduled to invalidate the hand-authored marketing price', async () => {
    // ⏳ THE DRIFT GUARD — the assertion the previous incident was missing.
    //
    // The €30-vs-€35 defect was fixed by CORRECTING THE DATA, not by making the
    // two fields impossible to disagree. The sibling test above compares them
    // *as of right now*, so it went green the moment the strings were retyped —
    // and it will stay green right up until the next tier boundary, at which
    // point `priceEur` rolls to the next window ON ITS OWN while the
    // hand-authored `landing.passes[].price` string stays frozen at whatever a
    // human last typed. That is the SAME defect on a timer.
    //
    // This test reads the future forward. For every marketing string it walks the
    // pass's not-yet-active price windows and fails if any of them charges an
    // amount the frozen string does not name.
    //
    // Note what satisfying this assertion requires: with tiered pricing, ONE
    // static string cannot be correct across three windows. So the only way to
    // make this green is to stop hand-authoring the display string and derive it
    // from the resolved `priceEur`. That is the actual guarantee we want, and the
    // failure below is the architecture telling us it cannot currently keep it.
    const ops = await openEventOps();
    const pricing = new KefiPassPricingClient();

    const organizer = await pricing.getOrganizerPasses(ops.bearer, ops.tenant.eventExternalId);
    expect(organizer.status, 'the organizer pass list reads').toBe(HTTP_OK);
    const authoritative = organizer.data as OrganizerPass[];

    const publicResp = await pricing.getPublicEvent(ops.tenant.slug, EVENT_SLUG);
    expect(publicResp.status, 'the public event payload reads anonymously').toBe(HTTP_OK);
    const { passes, landingPasses } = publicResp.data;

    const now = Date.now();
    const scheduledDrifts: string[] = [];

    for (const marketing of landingPasses) {
      const serverPass = passes.find((p) => p.code.toLowerCase() === marketing.id.toLowerCase());
      // An unmapped marketing entry is the sibling test's failure to report, not
      // this one's — skip rather than double-reporting the same defect.
      if (serverPass === undefined) continue;

      const organizerPass = authoritative.find((p) => p.code === serverPass.code);
      if (organizerPass === undefined) continue;

      const quoted = parseDisplayPrice(marketing.price);
      if (quoted === null) continue;

      for (const window of sortWindows(organizerPass.priceWindows)) {
        // Only windows that have not started yet. The active window is already
        // covered by the as-of-now comparison in the sibling test.
        const startsMs =
          window.effectiveFromUtc === null ? Number.NEGATIVE_INFINITY : Date.parse(window.effectiveFromUtc);
        if (startsMs <= now) continue;

        if (window.priceEur !== quoted) {
          scheduledDrifts.push(
            `${marketing.id}: the page is hard-coded to "${marketing.price}", but from ` +
              `${window.effectiveFromUtc} the server charges €${window.priceEur} — ` +
              `buyers after that instant read a price the server will not honour`,
          );
        }
      }
    }

    expect(
      scheduledDrifts,
      'no pass has a future price tier that the frozen marketing string fails to name. ' +
        'Each entry below is a DATED repeat of the €30-vs-€35 incident, already in the data:\n' +
        scheduledDrifts.map((d) => `  • ${d}`).join('\n'),
    ).toEqual([]);
  });

  test('@ui the price the register form shows is the price the server records', async ({
    page,
  }) => {
    // ⭐ THE CENTRAL ASSERTION. Everything above compares one server field to
    // another server field; this one compares what a HUMAN READS to what the
    // server WRITES. It is the only assertion here that can catch a rendered
    // page drifting from the booking logic, which is the defect that costs money.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();

    // Baseline the roster so we can prove we put it back exactly as we found it.
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      await page.goto(ops.tenant.siteUrl, { waitUntil: 'domcontentloaded' });

      // Read the price the register form shows against the FULL pass — the
      // option a buyer selects, not a decorative marketing card elsewhere on the
      // page. Scoping to the radio's own label is what makes this the number the
      // buyer is actually agreeing to.
      const fullOption = page
        .locator('label.reg-pass-option')
        .filter({ has: page.locator('input[name="passCode"][value="FULL"]') });
      await expect(
        fullOption,
        'the register form offers the FULL pass as a selectable option',
      ).toHaveCount(1);

      const priceText = (await fullOption.locator('.reg-pass-price').innerText()).trim();
      const quoted = parseDisplayPrice(priceText);
      expect(quoted, `the FULL option shows a parseable price (saw "${priceText}")`).not.toBeNull();

      // Now book that exact pass through the real public route and read back
      // what the server committed the buyer to.
      const attendee = await ops.registerAttendee('pricecheck', 'FULL');

      expect(
        attendee.priceEur,
        `the register form quotes €${quoted} for the FULL pass but the server booked the ` +
          `attendee at €${attendee.priceEur} — a buyer would be charged a price they never saw`,
      ).toBe(quoted);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });
});
