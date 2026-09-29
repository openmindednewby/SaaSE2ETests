// AGORA-LAUNCH-1 "Self-serve Agora signup" — the ONE @ui console-error smoke for the register
// screen (evidence-and-gates.md: the API tier hand-assembles its request, so this is what sees a
// client-side ReferenceError or a broken bundle on the UI path). It does NOT submit — the signup
// itself is covered by agora-signup.spec.ts and tenant-api register is rate-limited (5/min/IP).
//
// Phone device descriptor (mobile UA, touch, DPR, isMobile), never a bare viewport — CLAUDE.md
// mobile-first. Galaxy S8 = 360 px wide, the house floor. `defaultBrowserType` is dropped because
// the agora-ui project already pins Chromium and it cannot be overridden per file.
import { devices, expect, test } from '@playwright/test';

import { AGORA_WEB_URL } from './agora-helpers.js';

const { userAgent, viewport, deviceScaleFactor, isMobile, hasTouch } = devices['Galaxy S8'];
test.use({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch });

const RENDER_TIMEOUT = 45_000;
const SUBPIXEL = 1;
/**
 * The ONE expected resource error: signed out, the app's session bootstrap GETs /bff/me and the
 * BFF correctly answers 401 — Chrome logs every non-2xx fetch as a console error. Anything else
 * (another URL, another status, any pageerror) fails the smoke.
 */
function isAnonymousSessionProbe(text: string, url: string): boolean {
  return text.includes('status of 401') && url.endsWith('/bff/me');
}

/**
 * Staging only: Traefik serves its default self-signed cert (WireGuard-only, no LE cert), and
 * `ignoreHTTPSErrors` does not reach the service-worker script fetch. A real cert cannot raise it.
 */
function isSelfSignedServiceWorker(text: string): boolean {
  return text.includes('SSL certificate error occurred when fetching the script');
}

/** Compact RegisterForm testIds (@dloizides/auth-web RegisterTestIds, prefixed `agora-`). */
const FIELDS = [
  'agora-register-first-name-input',
  'agora-register-email-input',
  'agora-register-password-input',
  'agora-register-tenant-name-input',
  'agora-register-submit-button',
];

test('AL1-AC3 /register renders on a 360px phone with no console errors @ui @agora-signup', async ({ page }) => {
  test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL not set — bff-agora is not reachable for this target');

  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' || isAnonymousSessionProbe(msg.text(), msg.location().url) || isSelfSignedServiceWorker(msg.text())) return;
    errors.push(`console: ${msg.text()} @ ${msg.location().url}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // 'commit', not 'load': the ~2.5 MB bundle's load event on the staging HDD node is not what this
  // smoke is about — the web-first form assertion below is the readiness signal.
  await page.goto('/register', { waitUntil: 'commit' });
  await expect(page.getByTestId('agora-register-form')).toBeVisible({ timeout: RENDER_TIMEOUT });
  for (const id of FIELDS) await expect(page.getByTestId(id), `${id} must render`).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'no horizontal scroll at 360px').toBeLessThanOrEqual(SUBPIXEL);
  expect(errors, 'the register screen must load without console errors').toEqual([]);
});
