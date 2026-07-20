/**
 * Kefi TIERED PRICING E2E — the shape of the price windows.
 *
 * UBB opens pre-sale against real buyers, so a price that is wrong by €5 is not
 * a cosmetic defect: it is either an undercharge the organizer eats on every
 * sale, or an overcharge a buyer never agreed to.
 *
 * This file asserts that the tiered-pricing CONFIGURATION is well-formed:
 *   - each tiered pass resolves a `currentPriceEur` from a `Window`, and says
 *     when that window lapses;
 *   - its three windows are contiguous — no GAP (a moment with no price at all,
 *     which leaves the register endpoint nothing to charge) and no OVERLAP (two
 *     prices valid at once, so the resolved price depends on iteration order);
 *   - the boundaries are Cyprus local midnight expressed in UTC;
 *   - prices ascend, so an early bird is genuinely cheaper than the door;
 *   - and PARTY — a pass with NO windows — still resolves from its flat price.
 *     That last one is the backward-compatibility control for every non-tiered
 *     pass in the fleet, including UBS and KUCY.
 *
 * ⚠️ Well-formed windows do NOT mean a buyer is quoted the right number. That is
 * a separate property, asserted in `kefi-ubb-price-parity.spec.ts` — which is
 * where the suite's central assertion (what the register form SHOWS equals what
 * the server RECORDS) lives.
 *
 * PROD-SAFE: every test here is a pure read and creates nothing at all.
 */

import { test, expect } from '@playwright/test';

import {
  KefiPassPricingClient,
  sortWindows,
  type OrganizerPass,
} from '../../helpers/kefi/kefiPassPricingClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
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

/** The tiered passes. PARTY is deliberately excluded — it is the flat control. */
const TIERED_CODES = ['FULL', 'CLASS'] as const;
/** The non-tiered pass — the backward-compatibility control for every legacy pass. */
const FLAT_CODE = 'PARTY';

/**
 * The configured window boundaries, in UTC.
 *
 * Both dates are CYPRUS LOCAL MIDNIGHT. Cyprus is UTC+3 (EEST) on both, so local
 * midnight is `21:00Z` on the PRECEDING day. Written out explicitly because the
 * off-by-one-day error this encodes is exactly the mistake a reader would make
 * "fixing" these constants to `00:00Z`.
 */
const EARLY_BIRD_ENDS_UTC = '2026-09-10T21:00:00Z';
const STANDARD_ENDS_UTC = '2026-10-02T21:00:00Z';

const EXPECTED_WINDOW_COUNT = 3;

test.describe('Kefi UBB tiered pricing', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the organizer pass list resolves a current price and its source', async () => {
    const ops = await openEventOps();
    const pricing = new KefiPassPricingClient();

    const resp = await pricing.getOrganizerPasses(ops.bearer, ops.tenant.eventExternalId);
    expect(resp.status, 'the organizer can read the pass list').toBe(HTTP_OK);
    const passes = resp.data as OrganizerPass[];
    expect(Array.isArray(passes), 'the pass list is an array').toBe(true);

    for (const code of TIERED_CODES) {
      const pass = passes.find((p) => p.code === code);
      expect(pass, `the ${code} pass exists`).toBeDefined();

      expect(
        pass!.currentPriceEur,
        `${code} exposes a positive resolved current price (the UI has a number to show)`,
      ).toBeGreaterThan(0);
      expect(
        pass!.currentPriceSource,
        `${code} is priced by a tiered WINDOW, not a flat price`,
      ).toBe('Window');
      expect(
        pass!.currentPriceHoldsUntilUtc,
        `${code} tells the buyer when the current price lapses`,
      ).not.toBeNull();
    }

    // The flat control: every non-tiered pass in the fleet (incl. UBS/KUCY)
    // must keep resolving without windows. This is the backward-compatibility
    // guarantee for the tiered-pricing feature.
    const flat = passes.find((p) => p.code === FLAT_CODE);
    expect(flat, `the ${FLAT_CODE} pass exists`).toBeDefined();
    expect(
      flat!.currentPriceSource,
      `${FLAT_CODE} resolves from its FLAT price — non-tiered passes still work`,
    ).toBe('FlatPrice');
    expect(
      flat!.priceWindows,
      `${FLAT_CODE} carries no windows at all`,
    ).toEqual([]);
    expect(
      flat!.currentPriceEur,
      `${FLAT_CODE}'s current price is simply its base price`,
    ).toBe(flat!.priceEur);
    expect(
      flat!.currentPriceHoldsUntilUtc,
      `a flat price never lapses, so it holds until null`,
    ).toBeNull();
  });

  test('@api the tiered windows are three, contiguous, with no gap or overlap', async () => {
    const ops = await openEventOps();
    const pricing = new KefiPassPricingClient();

    const resp = await pricing.getOrganizerPasses(ops.bearer, ops.tenant.eventExternalId);
    expect(resp.status, 'the organizer can read the pass list').toBe(HTTP_OK);
    const passes = resp.data as OrganizerPass[];

    for (const code of TIERED_CODES) {
      const pass = passes.find((p) => p.code === code)!;
      const windows = sortWindows(pass.priceWindows);

      expect(windows.length, `${code} has exactly three price windows`).toBe(
        EXPECTED_WINDOW_COUNT,
      );

      // ── Open at both ends ────────────────────────────────────────────────
      // A first window with a start bound would leave "before pre-sale" unpriced;
      // a last window with an end bound would leave the pass unsellable after it.
      expect(
        windows[0]!.effectiveFromUtc,
        `${code}'s first window is open at the start — no unpriced period before pre-sale`,
      ).toBeNull();
      expect(
        windows[EXPECTED_WINDOW_COUNT - 1]!.effectiveUntilUtc,
        `${code}'s last window is open-ended — the pass never becomes unsellable`,
      ).toBeNull();

      // ── Contiguity: each window starts exactly where the previous ended ──
      // `>` would be a gap (a moment with no price at all → the register endpoint
      // has nothing to charge); `<` would be an overlap (two prices valid at once
      // → the resolved price depends on iteration order).
      for (let i = 1; i < windows.length; i++) {
        expect(
          windows[i]!.effectiveFromUtc,
          `${code} window ${i + 1} begins exactly when window ${i} ends — no gap, no overlap`,
        ).toBe(windows[i - 1]!.effectiveUntilUtc);
      }

      // ── The boundaries are Cyprus local midnight expressed in UTC ────────
      expect(
        windows[0]!.effectiveUntilUtc,
        `${code}'s early-bird window ends at Cyprus local midnight (UTC+3 → 21:00Z the day before)`,
      ).toBe(EARLY_BIRD_ENDS_UTC);
      expect(
        windows[1]!.effectiveUntilUtc,
        `${code}'s standard window ends at Cyprus local midnight (UTC+3 → 21:00Z the day before)`,
      ).toBe(STANDARD_ENDS_UTC);

      // ── Prices ascend ────────────────────────────────────────────────────
      // Tiered pricing that does not increase is a mis-entry: an early bird must
      // be cheaper than the door price or the tier does nothing.
      for (let i = 1; i < windows.length; i++) {
        expect(
          windows[i]!.priceEur,
          `${code} window ${i + 1} costs more than window ${i} — later buyers pay more`,
        ).toBeGreaterThan(windows[i - 1]!.priceEur);
      }
    }
  });
});
