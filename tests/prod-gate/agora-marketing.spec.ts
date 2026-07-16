/**
 * Agora marketing site — prod-gate smoke (the ONE Agora surface on PROD).
 *
 * `agora.dloizides.com` is a static Astro marketing site on the PROD node — the only
 * Agora surface there (app/api/storefront all run on staging via the proxy). This is
 * the automated coverage that a prod breakage would trip: a down pod, a 404, a broken
 * legal/pricing page, or a SEO regression. It runs in the `prod-gate` project, which
 * uses plain Desktop-Chrome (NOT ignoreHTTPSErrors), so a bad/expired cert also fails
 * the navigation here — complementing the Katastasi `HOST-AGORA` prod-health probe.
 *
 * Skip-gated: `test.skip`s (never fakes a pass) when `AGORA_MARKETING_URL` is unset.
 * The marketing site is prod-only, so that var points at `https://agora.dloizides.com`
 * regardless of `E2E_TARGET`.
 *
 * Run: `E2E_TARGET=prod AGORA_MARKETING_URL=https://agora.dloizides.com \
 *        npx playwright test --project=prod-gate --grep @agora-marketing-site`
 */
import { expect, test } from '@playwright/test';

/** The live marketing origin. Null → skip the whole tier. */
const BASE = process.env.AGORA_MARKETING_URL?.trim().replace(/\/+$/, '') || null;

/** The €2/mo positioning must be present on the home + pricing pages. */
const EUR2 = /€\s?2\b|2\s?(?:a|per|\/)\s?month/i;

test.describe('Agora marketing site — prod-gate @agora-marketing-site', () => {
  test.skip(BASE === null, 'AGORA_MARKETING_URL unset — marketing site not targeted');

  test('homepage is live: 200, the €2 hook, and a Start-trial CTA into the merchant app', async ({
    page,
  }) => {
    const res = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    expect(res, 'homepage must respond').not.toBeNull();
    expect(res!.status(), 'homepage must be 200').toBe(200);

    // The core positioning — a €2/mo shop — must be on the page.
    await expect(page.locator('body')).toContainText(EUR2);

    // A primary CTA that takes a stranger into signup/the merchant app (SIGNUP_URL = APP_URL).
    const cta = page.locator('a[href*="app.agora.dloizides.com"]').first();
    await expect(cta, 'a CTA linking into the merchant app must be present').toBeVisible();
  });

  test('the legal + pricing pages are live (Pricing/Terms/Privacy all resolve to 200)', async ({
    page,
  }) => {
    // page.goto follows the Astro trailing-slash 301 → asserts the FINAL 200.
    for (const path of ['pricing', 'terms', 'privacy']) {
      const res = await page.goto(`${BASE}/${path}`, { waitUntil: 'domcontentloaded' });
      expect(res, `/${path} must respond`).not.toBeNull();
      expect(res!.status(), `/${path} must resolve to 200`).toBe(200);
    }

    // Pricing states the €2 price; Terms carries the tax / merchant-of-record wording
    // (Agora is shop software, the merchant is the seller of record — the locked disclaimer).
    await page.goto(`${BASE}/pricing/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(EUR2);

    await page.goto(`${BASE}/terms/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/tax|merchant of record|responsib/i);
  });

  test('SEO baseline: robots.txt serves and points to a sitemap that resolves', async ({
    request,
  }) => {
    const robots = await request.get(`${BASE}/robots.txt`);
    expect(robots.status(), 'robots.txt must be 200').toBe(200);

    const body = await robots.text();
    const match = /Sitemap:\s*(\S+)/i.exec(body);
    expect(match, 'robots.txt must declare a Sitemap').not.toBeNull();

    // The declared sitemap (Astro emits sitemap-index.xml) must actually resolve.
    const sitemap = await request.get(match![1]);
    expect(sitemap.status(), 'the declared sitemap must resolve').toBe(200);
  });
});
