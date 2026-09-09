/**
 * InterviewPrep practice pages — prod RENDER gate (one page per track, 9 tracks).
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-06 every practice page (`/<track>/<module>/practice/`) on
 * interview-prep-hub.dloizides.com was frozen across all 9 tracks. A self-triggering MutationObserver in `practice-progress.js` wrote
 * into the `#topicList` subtree its own observer watched, so the microtask queue never
 * drained: no frame painted, no `load` event, and — critically — **no console output and
 * HTTP 200 throughout**.
 *
 * Nothing caught it. `static-smoke.mjs` and `product-smoke.mjs` are `fetch`-based, so they
 * are structurally incapable of observing a wedged renderer: the bytes are correct, the
 * headers are correct, the SEO tags are correct, and the page is dead. This spec is the
 * check that can actually observe the thing it guards.
 *
 * WHAT IT ASSERTS (and why each line is shaped the way it is)
 * ----------------------------------------------------------
 * 1. `waitUntil: 'commit'` — NOT the default `'load'`. A wedged renderer never fires
 *    `load`, so the default would fail as an opaque navigation timeout. `'commit'` gets us
 *    a response object, and then the assertions below produce a legible failure.
 * 2. `#cardQuestion` holds neither dead state: the static "Loading..." placeholder from
 *    `exercise-web-site/index.html:95`, nor the give-up message `script.js:281` writes when
 *    `waitForPracticeData` times out at 15s. A frozen page serves the first with a 200; a
 *    data-load failure serves the second. Locator queries run in the page's JS context, so
 *    a starved main thread cannot answer them and the expect times out — which is exactly
 *    the failure we want.
 * 5. `.ps-shortcuts-btn` exists. **The question text alone does NOT prove the practice
 *    bundle ran** — `script.js:391` renders it, and `script.js` is not part of the bundle.
 *    Verified empirically: aborting `practice-bundle.js` left every other assertion here
 *    green. This one element is appended to `document.body` unconditionally by
 *    `practice-shortcuts.js`, so it is present iff the bundle booted.
 * 3. The sidebar built at least one `.question-link`. Both observers that actually broke
 *    were rooted at `#topicList`; this asserts that subtree reached a settled state.
 * 4. No uncaught page error. API-driven E2E structurally cannot see a client-side
 *    ReferenceError (see `code-standards/evidence-and-gates.md`); this can.
 *
 * Skip-gated on INTERVIEW_PREP_URL (set in .env.prod + .env.staging — the hub is a
 * prod-only static site, so both point at the same origin). A skip is visible in the
 * report and never fakes a pass.
 *
 * Run: `E2E_TARGET=prod npx playwright test --project=prod-gate --grep @interview-prep-practice`
 */
import { expect, test } from '@playwright/test';

/** The live hub origin. Null → skip the whole tier rather than fake a pass. */
const BASE = process.env.INTERVIEW_PREP_URL?.trim().replace(/\/+$/, '') || null;

/** The static markup at exercise-web-site/index.html:95, replaced once JS renders a card. */
const PLACEHOLDER = 'Loading practice questions...';

/** What script.js:281 writes when waitForPracticeData gives up after 15s. */
const LOAD_FAILED = 'Practice questions could not be loaded.';

/**
 * A wedged renderer cannot answer a locator query, so every assertion below fails by
 * TIMEOUT rather than by mismatch — so this number is the freeze/slow boundary and must be
 * set from measurement, not taste. MEASURED time-to-content from a dev PC over the public
 * internet, 2026-09-06: backend/solid 1.9s, philosophy 2.9s, algorithms 2.9s, systemdesign
 * 2.9s, owasp 3.9s, platform 3.9s, devops 6.0s, frontend/javascript 16.0s. Variance is the
 * story, not the median. An earlier 20s ceiling produced two false reds. 30s is ~2x the
 * worst observed and still fails fast against a genuine wedge, which never completes.
 * The [render-time] log below keeps that distribution visible — if it creeps, re-measure
 * rather than raising this number again.
 */
const RENDER_TIMEOUT_MS = 30_000;

/**
 * One representative practice page per track. Hardcoded rather than derived, so that a
 * track being renamed or dropped fails this gate loudly instead of silently shrinking it.
 * Module slugs come from `InterviewPrep/sites/build-config.js`.
 */
const PRACTICE_PAGES: ReadonlyArray<readonly [track: string, module: string]> = [
  ['frontend', 'javascript'],
  ['backend', 'solid'],
  ['management', 'pal-i'],
  ['devops', 'kubernetes'],
  ['owasp', 'top-10'],
  ['systemdesign', 'fundamentals'],
  ['algorithms', 'algorithms'],
  ['platform', 'overview'],
  ['philosophy', 'stoicism'],
];

test.describe('InterviewPrep practice pages render @interview-prep-practice', () => {
  test.skip(BASE === null, 'INTERVIEW_PREP_URL unset — the hub is not targeted');

  // One retry, for TRANSPORT faults only. Observed 2026-09-06: a run died on
  // `page.goto: net::ERR_NETWORK_IO_SUSPENDED` — Chrome's error for the HOST's network I/O
  // being suspended, i.e. the machine running the test, not the site. A genuine freeze is
  // deterministic and fails both attempts, so this absorbs local transport noise without
  // hiding the defect the gate exists to catch. A retried pass still reports as flaky.
  test.describe.configure({ retries: 1 });

  for (const [track, moduleSlug] of PRACTICE_PAGES) {
    test(`${track}/${moduleSlug} practice page renders a real question`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const url = `${BASE}/${track}/${moduleSlug}/practice/`;

      // 'commit' not 'load': a frozen renderer never fires load (see header note).
      const res = await page.goto(url, { waitUntil: 'commit' });
      expect(res, `${url} must respond`).not.toBeNull();
      expect(res!.status(), `${url} must be 200`).toBe(200);

      const question = page.locator('#cardQuestion');

      // THE gate. A wedged page keeps the placeholder forever and times out here.
      await expect(
        question,
        `#cardQuestion still shows "${PLACEHOLDER}" — the practice bundle never rendered a card. ` +
          'A frozen renderer returns 200 with correct headers, so only this assertion sees it.',
      ).not.toHaveText(PLACEHOLDER, { timeout: RENDER_TIMEOUT_MS });

      await expect(
        question,
        `#cardQuestion shows "${LOAD_FAILED}" — waitForPracticeData hit its 15s give-up path`,
      ).not.toHaveText(LOAD_FAILED, { timeout: RENDER_TIMEOUT_MS });

      await expect(question, '#cardQuestion must hold real question text').not.toHaveText(/^\s*$/, {
        timeout: RENDER_TIMEOUT_MS,
      });

      // The sidebar is where both real self-trigger bugs lived; assert it settled.
      await expect(
        page.locator('#topicList .question-link').first(),
        '#topicList must have built at least one question link',
      ).toBeAttached({ timeout: RENDER_TIMEOUT_MS });

      // The question text is rendered by script.js, NOT by the bundle — so without this
      // the whole practice bundle could be 404ing and the gate would stay green.
      await expect(
        page.locator('.ps-shortcuts-btn'),
        'the practice bundle did not initialise (practice-shortcuts.js appends this unconditionally)',
      ).toBeAttached({ timeout: RENDER_TIMEOUT_MS });

      expect(pageErrors, `uncaught page error(s) on ${url}`).toEqual([]);
    });
  }
});
