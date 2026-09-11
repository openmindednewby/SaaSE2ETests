// @aml-ui tier — AM-READY-5 §3.6. THE COMPANION to the API-driven specs in this directory, and the
// only check in this suite that observes what the BROWSER does.
//
// 🔴 WHY IT EXISTS (§3.0). Playwright drives the API here by owner decision, so every other aml spec
// hand-assembles its request. A client-side `ReferenceError` on load, a screen whose client throws
// before its first fetch, a write that leaves with no body — all of those keep the API tier fully
// green. This spec loads the real aml-v2 console in a real Chrome and fails on any console `error`
// and on any failed FIRST-PARTY network request.
//
// 🔴 NOTHING IS ALLOWLISTED. If a screen ever needs an exception, the reason goes inline next to it,
// named, dated and attributed — an unexplained allowlist entry turns this gate back into a green that
// observes nothing, which is the exact failure §3.0 is about.
//
// A5-30: "zero console errors" over "zero requests" is a FALSE green — a client that throws before
// its first fetch produces a silent, empty network log. So each screen also asserts it issued at
// least one first-party API request.
import { expect, test } from '@playwright/test';

/** The console is served per-path on the API host (personalServerNotes/k8s/aml/bff-aml.yml:63). */
const AML_WEB_URL = (process.env.AML_WEB_URL ?? 'https://aml-screening.dloizides.com/app').replace(/\/+$/, '');
const TESTER_EMAIL = process.env.AML_TESTER_EMAIL?.trim() || null;
const TESTER_PASSWORD = process.env.AML_TESTER_PASSWORD?.trim() || null;
const IDP_HOST = process.env.AML_IDP_HOST?.trim() || 'aml-identity.dloizides.com';

/** A5-28. `report view` has no standalone route (it is a download off a screening), so it is NOT
 *  covered here — recorded in AM-READY-5 NOT COVERED rather than silently dropped. */
const SCREENS = [
  { name: 'adverse-media index search', path: '/adverse-media' },
  { name: 'GDELT adverse-media status', path: '/gdelt' },
  { name: 'jobs status', path: '/jobs' },
  { name: 'screening + batch upload', path: '/screening' },
];

const SETTLE_MS = 4_000;
const LOAD_TIMEOUT_MS = 45_000;

// NOT serial: each screen is an independent observation. Under `serial` the first red aborted the
// other three, so one stale route hid three screens' worth of evidence (measured 2026-09-11).
test.describe('AM-READY-5 §3.6 — console-error smoke over the REAL aml-v2 console', () => {
  test.skip(
    !TESTER_EMAIL || !TESTER_PASSWORD,
    'AML_TESTER_EMAIL / AML_TESTER_PASSWORD unset (PROOViD/AMLService/.env) — an anonymous load lands ' +
      'on the IdP, not on the screen, and would be a green that observed the wrong page.',
  );

  /**
   * Sign in for real. MEASURED 2026-09-11: visiting a screen while signed out does NOT bounce to the
   * IdP — the SPA stays put and its boot fetches just 401 (`/bff/me`, `/bff/api/aml/v1/me`,
   * `/v1/tenants/me/screening-capabilities`, …). So a smoke that only navigates observes a signed-out
   * shell and calls its 401 noise "console errors". The login entrypoint is a TOP-LEVEL navigation to
   * `/bff/passkey/login` (apps/aml-v2/src/auth/amlBffAuth.ts:30), which 302s to the aml-identity
   * OpenIddict page; that page is server-rendered C# with `input#email` / `input#password` /
   * `button[type=submit]` (verified against the live form, not guessed).
   */
  async function signIn(page: import('@playwright/test').Page, returnPath: string): Promise<void> {
    const origin = new URL(AML_WEB_URL).origin;
    await page.goto(`${origin}/bff/passkey/login?returnUrl=${encodeURIComponent(`/app${returnPath}`)}`, {
      waitUntil: 'domcontentloaded',
      timeout: LOAD_TIMEOUT_MS,
    });
    expect(page.url(), `login did not reach the IdP (${IDP_HOST})`).toContain(IDP_HOST);
    await page.locator('input#email, input[type="email"]').first().fill(TESTER_EMAIL!);
    await page.locator('input#password, input[type="password"]').first().fill(TESTER_PASSWORD!);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(url => url.host === new URL(AML_WEB_URL).host, { timeout: LOAD_TIMEOUT_MS });
    // A signed-in session is a PRECONDITION, not an assertion of this spec. If it failed, every
    // screen below would red with 401 noise and read as four product defects instead of one login.
    const me = await page.request.get(`${origin}/bff/me`);
    expect(me.status(), 'signed-in precondition failed: /bff/me did not return 200 after login').toBe(200);
  }

  for (const screen of SCREENS) {
    test(`AM-E2E-UI-1 ${screen.name} loads with ZERO console errors and ZERO failed requests`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      const apiRequests: string[] = [];

      // Listeners go on BEFORE signIn, gated to the first main-frame commit on the console host AFTER
      // the IdP. MEASURED 2026-09-11: signIn's returnUrl already lands on the screen, and a second
      // `goto` to the same URL aborted that page's own in-flight boot fetches (`/bff/me`,
      // `mentions?pageSize=50`, `index-state`, a font) — 4/4 reds that were the harness, not the
      // product. The login page's own console is still not this spec's subject, hence the gate.
      const amlHost = new URL(AML_WEB_URL).host;
      let seenIdp = false;
      let observing = false;
      page.on('framenavigated', frame => {
        if (frame !== page.mainFrame()) return;
        const host = new URL(frame.url()).host;
        if (host === IDP_HOST) seenIdp = true;
        else if (seenIdp && host === amlHost) observing = true;
      });
      page.on('console', message => {
        if (observing && message.type() === 'error')
          consoleErrors.push(`${message.text()} @ ${message.location().url}`);
      });
      // A `ReferenceError` at module scope surfaces as pageerror, NOT as a console message.
      page.on('pageerror', error => {
        if (observing) pageErrors.push(`${error.name}: ${error.message}`);
      });
      page.on('requestfailed', request => {
        if (observing && request.url().startsWith(new URL(AML_WEB_URL).origin))
          failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
      });
      // 4xx/5xx BODIES are captured, not just statuses. A bare "403" reads as an authz decision; the
      // body is what distinguishes a CSRF rejection from a missing tenant claim from a real denial,
      // and without it this smoke reports a symptom nobody can route.
      const rejectionBodies: Promise<string>[] = [];
      page.on('response', response => {
        const url = response.url();
        if (!observing || !url.startsWith(new URL(AML_WEB_URL).origin)) return;
        if (url.includes('/v1/') || url.includes('/bff/')) apiRequests.push(`${response.status()} ${url}`);
        if (response.status() >= 500) failedRequests.push(`${response.status()} ${url}`);
        if (response.status() >= 400 && response.status() < 500)
          rejectionBodies.push(
            response
              .text()
              .then(body => `${response.status()} ${url} :: ${body.slice(0, 200) || '(empty body)'}`)
              .catch(() => `${response.status()} ${url} :: (body unreadable)`),
          );
      });

      // signIn's returnUrl IS the screen, and its waitForURL waits for `load` there. No second goto.
      await signIn(page, screen.path);
      expect(observing, `never observed a main-frame commit on ${amlHost} after the IdP`).toBe(true);
      await page.waitForTimeout(SETTLE_MS); // settle window for lazy client fetches; no assertion waits on it

      // The landing URL and the page's own H1 go into EVERY failure message below. Without them a red
      // reads as "the screen is broken" when the actual cause is that the route does not exist on the
      // DEPLOYED image (task doc §6 row 2: the adverse-media build is not deployed yet).
      const landedOn = page.url();
      const heading = (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? '(no h1)';
      const meProbe = await page.request.get(`${new URL(AML_WEB_URL).origin}/bff/me`);
      const meBody = meProbe.ok() ? (await meProbe.text()).slice(0, 300) : `status ${meProbe.status()}`;
      const bodies = await Promise.all(rejectionBodies);
      const where =
        `[landed on ${landedOn} — h1: "${heading}" — /bff/me: ${meBody}` +
        (bodies.length ? ` — 4xx bodies: ${bodies.slice(0, 3).join(' | ')}` : '') +
        ']';

      // A5-30 FIRST: without this, the two absence assertions below are satisfiable by a dead page.
      expect(
        apiRequests.length,
        `${screen.name} issued NO first-party API request — "no errors" over "no requests" is a false green ${where}`,
      ).toBeGreaterThan(0);
      expect(heading, `${screen.name} rendered the router's Unmatched Route page ${where}`).not.toMatch(
        /unmatched route/i,
      );
      // A5-29 / A5-25: negative claims, so ABSENCE over the WHOLE buffer, not presence of something near it.
      expect(pageErrors, `${screen.name} threw uncaught page errors ${where}`).toEqual([]);
      expect(consoleErrors, `${screen.name} logged console errors ${where}`).toEqual([]);
      expect(failedRequests, `${screen.name} had failed first-party requests ${where}`).toEqual([]);
    });
  }
});
