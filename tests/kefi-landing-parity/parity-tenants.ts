/**
 * Tenant fixtures for the kefi-landing parity suite.
 *
 * Each tenant has a STANDALONE reference site (the 100%-sacred hand-crafted
 * page) and a KEFI-MANAGED render (kefi-landings + the tenant's
 * LandingConfigJson). The suite asserts the kefi render matches the
 * standalone within the configured tolerances.
 *
 * See `BaseClient/docs/Tasks/IN_PROGRESS/kefi-landing-parity-triage-2026-05-27.md`
 * for the rationale + initial gap list. Each `expectedDifferences` entry
 * here is a KNOWN gap with a planned fix — the harness records the gap
 * rather than silently passing.
 */
export interface KefiLandingTenant {
  /** Stable id for failure reports + screenshot file names. */
  id: 'kucy' | 'ubs';
  /** Human-readable label for test titles. */
  label: string;
  /** The canonical hand-crafted reference site. */
  standaloneUrl: string;
  /** The kefi-landings render of the same tenant. */
  kefiUrl: string;
  /**
   * Per-test known-gap overrides. The suite documents these via
   * `test.info().annotations` so a passing run is interpretable: "PASSED
   * with N known gaps". Closing a gap means removing its entry here.
   */
  knownGaps: {
    /** Section IDs where height drift is expected (state-dependent layout). */
    sectionHeightDrift?: string[];
    /** Whether the nav-item list is expected to differ from standalone. */
    navItemsDiffer?: boolean;
    /** Whether the page total height is expected to drift > 5%. */
    pageHeightDrift?: boolean;
    /** Per-section tolerance overrides (height delta percent). */
    sectionToleranceOverrides?: Record<string, number>;
    /**
     * Animation roles (from `parity-helpers.AnimationRole`) where the
     * standalone and kefi may legitimately differ today. The suite skips
     * the per-property equality check for these roles. Use sparingly —
     * each entry is a TODO to close.
     */
    skipAnimationRoles?: ReadonlyArray<'nav' | 'heroBadge' | 'registerCta'>;
    /**
     * Per-viewport-name nav height tolerance overrides (px). The default
     * is 2; entries here loosen it for breakpoints where the standalone
     * and kefi haven't converged yet.
     */
    navHeightToleranceByViewport?: Partial<Record<'mobile' | 'tablet' | 'desktop', number>>;
  };
}

/**
 * Default acceptable height drift for any section (5%). The harness fails
 * if a section drifts beyond this unless the tenant declares it as a
 * known gap.
 */
export const DEFAULT_SECTION_TOLERANCE = 0.05;

/**
 * Page-total-height drift tolerance. Larger than per-section because
 * state-dependent layout branches (e.g. register countdown vs closed)
 * can move the total by several hundred pixels legitimately.
 */
export const DEFAULT_PAGE_TOLERANCE = 0.08;

export const TENANTS: KefiLandingTenant[] = [
  {
    id: 'kucy',
    label: 'KUCY',
    standaloneUrl: 'https://kizombaunioncy.dloizides.com/',
    kefiUrl: 'https://kizomba-union-cy.kefi.dloizides.com/',
    knownGaps: {
      // GAPS (state-dependent layout branches — kefi correctly evaluates
      // "event date has passed" → closed; standalone is still showing the
      // open variant). Both are book/register section's open-state vs
      // closed-state content with different heights. Not template gaps;
      // cannot be closed without operator action (e.g. moving the
      // deadline to a future date).
      //   • register: open=countdown timer (1526px) vs closed=text (663px)
      //   • book: open=pay-reference block (770px wrap) vs closed=
      //     pay-closed block (830px wrap)
      sectionHeightDrift: ['register', 'book'],
    },
  },
  {
    id: 'ubs',
    label: 'UBS',
    standaloneUrl: 'https://unitedbysalsa.dloizides.com/',
    kefiUrl: 'https://united-by-salsa.kefi.dloizides.com/',
    // UBS is fully at-parity with the standalone — no known gaps.
    knownGaps: {},
  },
];
