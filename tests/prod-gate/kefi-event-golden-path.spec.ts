/**
 * Gate B golden path — Kefi (events): a visitor views a seeded published event.
 *
 * Gate B (`prod-login-gate.spec.ts`) only proves the ORGANIZER can log in and the
 * dashboard renders — not that the product's public promise (an attendee can view
 * an event) still works. This adds the kefi golden path so a broken public-event
 * view fails the gate loudly.
 *
 * It targets the always-published reference tenant KUCY (Kizomba Union CY) — the
 * same real seeded event the `kefi-landing-parity` suite already relies on being
 * live — so the gate needs NO signup / seeding of its own (a prod GATE must not
 * mint real tenants on every nightly run). Two tiers, per the two-tier-E2E standard:
 *
 *   @api @critical — anonymous GET {KEFI_API_URL}/api/v1/t/{slug} returns 200 with
 *     a rendered landing/event block (the public attendee data contract).
 *   @ui           — the public event landing (KEFI_KUCY_LANDING_URL) renders in a
 *     real browser: no error boundary, substantive content on screen.
 *
 * The tenant slug is the leftmost label of KEFI_KUCY_LANDING_URL (override with
 * KEFI_PUBLIC_EVENT_SLUG). Each tier self-skips when its env is unset for the target.
 *
 * Run: `E2E_TARGET=<target> npx playwright test --project=prod-gate`.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const HTTP_OK = 200;
const API_TIMEOUT = 30_000;
const RENDER_TIMEOUT = 30_000;
const MIN_BODY_TEXT_LEN = 100;
const ERROR_BOUNDARY = /something went wrong|unexpected error occurred/i;

const kefiApiUrl = process.env.KEFI_API_URL;
const kucyLandingUrl = process.env.KEFI_KUCY_LANDING_URL;

/** The published tenant slug — explicit override, else the KUCY landing subdomain. */
function resolvePublicEventSlug(): string | undefined {
  const explicit = process.env.KEFI_PUBLIC_EVENT_SLUG;
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  if (!kucyLandingUrl) return undefined;
  try {
    return new URL(kucyLandingUrl).host.split('.')[0];
  } catch {
    return undefined;
  }
}

test('prod-gate: kefi public event view returns a rendered landing for an anonymous visitor @api @critical', async () => {
  const slug = resolvePublicEventSlug();
  test.skip(
    !kefiApiUrl || !slug,
    'kefi event golden path needs KEFI_API_URL + a slug (KEFI_PUBLIC_EVENT_SLUG or KEFI_KUCY_LANDING_URL)',
  );

  const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true, timeout: API_TIMEOUT });
  try {
    const resp = await ctx.get(`${kefiApiUrl!.replace(/\/$/, '')}/api/v1/t/${slug!}`, { failOnStatusCode: false });
    const rawText = await resp.text().catch(() => '');
    expect(resp.status(), `anon GET /t/${slug!} status, body: ${rawText.slice(0, 300)}`).toBe(HTTP_OK);

    const body = JSON.parse(rawText) as {
      slug?: string;
      tenantName?: string;
      landing?: { branding?: { name?: string } } | null;
      event?: { name?: string } | null;
    };
    expect(body.slug, 'public view slug must match the requested tenant').toBe(slug);

    // The public event view must carry RENDERED event content, not an empty shell —
    // a landing block (current shape) or an event block (legacy shape).
    const landingBlock = body.landing ?? body.event;
    expect(landingBlock, `public event view returned no landing/event block: ${rawText.slice(0, 300)}`).toBeTruthy();

    const name = body.tenantName ?? body.landing?.branding?.name ?? body.event?.name;
    expect(typeof name === 'string' && name.length > 0, 'public event view must expose the event/tenant name').toBe(true);
  } finally {
    await ctx.dispose().catch(() => {});
  }
});

test('prod-gate: kefi public event landing renders in a real browser @ui', async ({ page }) => {
  test.skip(!kucyLandingUrl, 'KEFI_KUCY_LANDING_URL not set for this target');

  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(kucyLandingUrl!, { waitUntil: 'domcontentloaded' });

  // The public attendee view must render, not the error boundary, and must carry
  // substantive content (a hero heading + body copy), proving the event page — not
  // a blank shell — reached the visitor.
  await expect(page.locator('body')).not.toContainText(ERROR_BOUNDARY, { timeout: RENDER_TIMEOUT });
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: RENDER_TIMEOUT });
  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  expect(bodyText.length, 'public event landing rendered no substantive content').toBeGreaterThan(MIN_BODY_TEXT_LEN);

  // No real JS errors reaching the page (benign i18n/analytics 401/403 filtered,
  // matching the Gate B login-probe policy).
  const BENIGN = /locize\.com|i18next is maintained|Failed to load resource: the server responded with a status of 40[13]\b/i;
  const real = consoleErrors.filter((e) => !BENIGN.test(e));
  expect(real, `console errors on kefi event landing: ${real.join(' | ')}`).toEqual([]);
});
