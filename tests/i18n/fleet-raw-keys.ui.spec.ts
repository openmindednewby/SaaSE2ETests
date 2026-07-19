/**
 * FLEET-WIDE i18n guard — no raw translation key may reach a user's screen, on ANY portal.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * `FM()` has NO fallback by design, so a key the host app is missing renders its own LITERAL
 * DOTTED NAME to the user — `common.selectPlaceholder` sitting in an empty dropdown,
 * `uiTables.filters.apply` across the filter bar. The shared `@dloizides/ui-*` kit resolves ITS
 * strings through the HOST app's `FM`, which means every kit upgrade can introduce user-visible
 * garbage into an app whose own source never changed. Nothing in lint, typecheck, unit tests or
 * the build says a word about it.
 *
 * The zygos console proved the class is real and the detector catches it. This spec is that
 * detector pointed at the REST of the fleet, because the shared-UI wave (ui-forms@1.6.0,
 * ui-layout@1.11.0 with its new `LAYOUT_I18N`, ui-tables@1.12.0) landed on five portals at once
 * and added ~192 keys across them — 26 on agora, of which 23 were LIVE and rendering as raw
 * dotted names to real users. That is the exact failure mode this catches, and it was caught by
 * reading the diff rather than by any test.
 *
 * ── Why the scan reads ATTRIBUTES, not just visible text ──────────────────────────────────────
 *
 * The original zygos defect (`quizTemplates.cancel`) lived in a `ModalShell` close button's
 * `aria-label`. It is invisible to a screenshot, invisible to a human reading the page, and
 * invisible to any scan that only walks text nodes — but a screen reader announces the raw key
 * verbatim. A text-only scan reports green on the very bug that motivated the wave. This matters
 * more after ui-layout@1.11.0, which turns `accessibilityHint` into a REAL `aria-describedby`:
 * more strings are now reachable only through a11y attributes.
 *
 * ── Readiness, not sleeps ─────────────────────────────────────────────────────────────────────
 *
 * Each screen is scanned only once its own readiness signal has fired. Scanning early scans a
 * loading skeleton — which has its own `aria-label` — and produces a hit that moves between
 * screens run to run: the same defect wearing a different scapegoat each time, i.e. precisely the
 * "flaky test that reads as a product bug" this repo has a documented history of.
 *
 * A portal whose base URL is not configured for the current target SKIPS rather than fails, and
 * the skip is loud in the report — a silent skip is how agora ended up with no production UI
 * coverage in the first place.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { collectDomStrings, describeRawKeys, findRawKeys } from '../../helpers/i18n-raw-key-scan.js';
import { retryWhileRateLimited } from '../../helpers/rate-limit.js';

interface PortalScreen {
  /** Human name used in the failure message. */
  readonly name: string;
  /** Path inside the SPA. */
  readonly path: string;
}

interface Portal {
  readonly label: string;
  /** SPA origin; empty/undefined => the portal is skipped for this target. */
  readonly baseUrl: string;
  /** Where the failure message tells the reader to add the missing keys. */
  readonly localeFile: string;
  readonly username: string;
  readonly password: string;
  readonly screens: readonly PortalScreen[];
}

const PORTALS: readonly Portal[] = [
  {
    label: 'agora-web',
    baseUrl: process.env.AGORA_WEB_URL ?? '',
    localeFile: 'agora-web/src/localization/locales/en.json',
    // Merchant identities live in the `agora` realm, not the shared test realm, so they use the
    // agora-specific credentials the rest of the agora suite already uses.
    username: process.env.AGORA_TEST_USERNAME ?? 'agora-merchant-a',
    password: process.env.AGORA_TEST_PASSWORD ?? '',
    // 🔴 The directory-backed routes are addressed WITH a trailing slash on purpose.
    // Without it, prod nginx 301s `/products` -> `http://agora-web/products/` (the
    // in-cluster Service name), and whether Chromium then errors or resolves it is a
    // coin flip — so this scan flapped between screens run to run and read as a network
    // flake. That redirect is a REAL product defect, but it belongs to the deterministic
    // HTTP assertion in `tests/agora/agora-redirect-host-leak.spec.ts`, which fails
    // reproducibly and names the nginx fix. Here we want the screen to actually LOAD so
    // its strings get scanned; this is separation of concerns, not a workaround for a
    // failing test.
    screens: [
      { name: 'dashboard', path: '/' },
      { name: 'products', path: '/products/' },
      { name: 'orders', path: '/orders/' },
      { name: 'categories', path: '/categories' },
      { name: 'settings', path: '/settings' },
      { name: 'billing', path: '/billing' },
    ],
  },
  {
    label: 'erevna-web',
    baseUrl: process.env.EREVNA_BASE_URL ?? '',
    localeFile: 'erevna-web/src/localization/locales/en.json',
    username: process.env.TEST_USER_USERNAME ?? '',
    password: process.env.TEST_USER_PASSWORD ?? '',
    screens: [
      { name: 'quiz templates', path: '/quiz-templates' },
      { name: 'quiz active', path: '/quiz-active' },
      { name: 'quiz answers', path: '/quiz-answers' },
      { name: 'settings', path: '/settings' },
    ],
  },
  {
    label: 'katalogos-web',
    baseUrl: process.env.KATALOGOS_BASE_URL ?? '',
    localeFile: 'katalogos-web/src/localization/locales/en.json',
    username: process.env.TEST_USER_USERNAME ?? '',
    password: process.env.TEST_USER_PASSWORD ?? '',
    screens: [
      { name: 'menus', path: '/menus' },
      { name: 'tenant themes', path: '/tenant-themes' },
      { name: 'settings', path: '/settings' },
    ],
  },
];

/** Log in the way each SPA's own `BffAuthClient` does — same-origin, so CSRF/origin checks pass. */
async function bffLogin(page: Page, username: string, password: string): Promise<number> {
  const attempt = (): Promise<number> =>
    page.evaluate(async (creds: { username: string; password: string }): Promise<number> => {
      const res = await fetch('/bff/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
      });
      return res.status;
    }, { username, password });

  // Auth is rate limited (5/60s per IP). A 429 here is an environment artifact of a dense suite,
  // not a product fault — retry with backoff so it is never mis-reported as one.
  return retryWhileRateLimited('i18n scan /bff/login', attempt, (status: number) => status);
}

/**
 * The fewest visible strings a genuinely-rendered screen of these apps can carry. Real screens
 * yield dozens (nav, headings, table headers, buttons); an unrendered SPA shell yields ZERO.
 * The floor only has to separate "rendered" from "empty", so it is deliberately low.
 */
const MIN_STRINGS_ON_A_RENDERED_SCREEN = 5;

/**
 * Scan one rendered screen.
 *
 * 🔴 THIS FUNCTION EXISTS IN THIS SHAPE BECAUSE THE OBVIOUS VERSION WAS A HOLLOW TEST.
 *
 * The first draft navigated with `waitUntil: 'domcontentloaded'` and then asserted "no raw keys".
 * `domcontentloaded` fires before React has rendered anything, so the scan ran against an EMPTY
 * body: `collectDomStrings` returned **0 strings** on every agora screen and the spec reported a
 * confident green across the whole fleet while examining literally nothing. A probe printing the
 * collected-string count is the only reason that was caught — the suite itself was perfectly
 * happy. "No raw keys found" and "nothing was looked at" are indistinguishable outcomes unless
 * you assert against the second one.
 *
 * So readiness here is TWO things, both required:
 *
 *   1. the loading skeleton has cleared — it carries its own `aria-label`, and scanning through
 *      it attributes a hit to whichever screen happened to still be loading (the same defect
 *      wearing a different scapegoat each run);
 *   2. the screen actually produced strings. This is the anti-vacuity floor: a blank page, a
 *      crashed bundle, an auth bounce or a route that silently 404s now FAILS LOUDLY instead of
 *      passing for the worst possible reason.
 *
 * Both are polled readiness signals, not sleeps.
 */
async function expectNoRawKeys(page: Page, portal: Portal, screen: string): Promise<void> {
  await expect(page.locator('[data-testid="page-skeleton"]')).toHaveCount(0, { timeout: 30_000 });

  // Poll until the SPA has actually rendered. `expect.poll` retries on the live page, so this
  // waits for React rather than sleeping through it.
  await expect
    .poll(async () => (await collectDomStrings(page)).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(MIN_STRINGS_ON_A_RENDERED_SCREEN);

  const strings = await collectDomStrings(page);
  expect(
    strings.length,
    `[${portal.label} — ${screen}] the scan found only ${String(strings.length)} visible strings. ` +
      `This screen did not render, so "no raw keys" would be vacuously true. Check the route, the ` +
      `session, and the bundle before trusting any green from this spec.`,
  ).toBeGreaterThanOrEqual(MIN_STRINGS_ON_A_RENDERED_SCREEN);

  const hits = await findRawKeys(page);
  expect(hits, hits.length === 0 ? '' : describeRawKeys(`${portal.label} — ${screen}`, hits, portal.localeFile)).toEqual(
    [],
  );
}

/**
 * 🔴 SKIPPED IS NOT PASSED — and where full fleet coverage is CLAIMED, "not scanned" must FAIL.
 *
 * A portal whose base URL or password is unset `test.skip`s below. That is right on a dev PC,
 * where a portal may genuinely be unreachable. It is CATASTROPHIC in the nightly, because a
 * skipped test exits 0: the Job goes green, the summary email says PASS, and the Daily Report
 * agrees — while the portal was never looked at.
 *
 * That is not hypothetical. `AGORA_WEB_URL` was set in `.env.staging` and MISSING from
 * `.env.prod`, so `resolveAgoraWebUrl()` returned null and agora's ENTIRE @ui tier skipped on
 * production for its whole existence. It reported green by omission the entire time — and agora
 * is the portal that had 23 raw keys rendering to real users. Green-because-we-did-not-look is
 * the exact failure this suite exists to end; leaving it reachable here would be self-defeating.
 *
 * So the nightly sets I18N_REQUIRE_ALL_PORTALS=1 to assert the contract "this environment covers
 * every portal". Under it, an unconfigured portal raises a LOUD FAILURE naming the missing
 * variable instead of quietly vanishing from the run. Unset (dev PC), skipping still applies.
 */
const REQUIRE_ALL_PORTALS = process.env.I18N_REQUIRE_ALL_PORTALS === '1';

for (const portal of PORTALS) {
  test.describe(`i18n raw-key guard — ${portal.label} @i18n @ui`, () => {
    const missingSetting = portal.baseUrl.trim() === '' ? 'base URL' : 'password';
    const unconfigured = portal.baseUrl.trim() === '' || portal.password.trim() === '';

    if (unconfigured && REQUIRE_ALL_PORTALS) {
      test(`${portal.label}: MUST be configured — a skipped portal is not a scanned portal`, () => {
        throw new Error(
          `${portal.label} was NOT SCANNED: its ${missingSetting} is unset, and ` +
            `I18N_REQUIRE_ALL_PORTALS=1 declares that this environment covers the whole fleet.\n\n` +
            `This is a FAILURE and not a skip on purpose. Skipping here is how agora's entire UI ` +
            `tier went untested on production: AGORA_WEB_URL was set for staging and missing for ` +
            `prod, so the portal silently dropped out of every run and the suite reported green ` +
            `by omission for months.\n\n` +
            `Fix the ENVIRONMENT, not this test: set the portal's base URL in E2ETests/.env.<target> ` +
            `and its credentials in the job's secret (see the guards CronJob's envFrom). If a portal ` +
            `genuinely does not exist on this target, remove it from PORTALS with a comment saying ` +
            `why — an explicit deletion is reviewable; a silent skip is not.`,
        );
      });
      return;
    }

    // 🔴 ONE LOGIN PER PORTAL, NOT ONE PER SCREEN — and that is a correctness fix, not an
    // optimisation. Auth is rate limited to 5 logins / 60s per IP. A `beforeEach` login meant
    // agora's SIXTH screen tripped the limiter, the retry backoff then blew the 30s test
    // timeout, and the screen failed with a bare timeout that looks exactly like "the billing
    // page hangs". It passed in isolation and failed in the suite — a self-inflicted phantom
    // regression of precisely the kind this suite has a documented history of. The session is
    // a cookie on the context, so one login legitimately serves every screen.
    test.describe.configure({ mode: 'serial' });

    test.skip(
      unconfigured,
      `${portal.label}: base URL or credentials not configured for this E2E target — ` +
        `NOT a pass, this portal was not scanned. (Set I18N_REQUIRE_ALL_PORTALS=1 to make this ` +
        `a hard failure, as the nightly does.)`,
    );

    let context: BrowserContext;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      await page.goto(`${portal.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const status = await bffLogin(page, portal.username, portal.password);
      expect(status, `${portal.label}: setup login must succeed — got ${String(status)}`).toBe(200);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const screen of portal.screens) {
      test(`"${screen.name}" renders no raw translation keys (text or a11y attributes)`, async () => {
        await page.goto(`${portal.baseUrl}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await expectNoRawKeys(page, portal, screen.name);
      });
    }
  });
}

test('the detector rejects legitimate dotted text and catches real key shapes @i18n', async () => {
  // A self-test of the guard's own predicate, kept alongside the fleet spec so a future
  // "let us silence the false positives" edit cannot quietly neuter the detector for every
  // portal at once. Loosen it enough to ignore `common.selectPlaceholder` and this fails.
  const { isRawTranslationKey } = await import('../../helpers/i18n-raw-key-scan.js');

  // Real defects from the wave.
  expect(isRawTranslationKey('common.selectPlaceholder')).toBe(true);
  expect(isRawTranslationKey('uiTables.filters.apply')).toBe(true);
  expect(isRawTranslationKey('quizTemplates.cancel')).toBe(true);
  // ui-layout@1.11.0's new LAYOUT_I18N family — the shape this wave newly put at risk.
  expect(isRawTranslationKey('uiLayout.modalDropdown.close')).toBe(true);

  // Legitimate strings these apps genuinely display.
  expect(isRawTranslationKey('statement.pdf')).toBe(false);
  expect(isRawTranslationKey('app.agora.dloizides.com')).toBe(false);
  expect(isRawTranslationKey('v1.2.3')).toBe(false);
  expect(isRawTranslationKey('1.5')).toBe(false);
  expect(isRawTranslationKey('Choose a currency.')).toBe(false);
  expect(isRawTranslationKey('merchant-a@agora.test')).toBe(false);
  expect(isRawTranslationKey('EUR')).toBe(false);
});
