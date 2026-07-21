// Digital Kin public site — @api tier (Plan 3 Task 15).
//
// The site is anonymous end to end: no login, no cookies, no sessions. This tier
// therefore needs no token and drives exactly what a stranger's browser (or a
// crawler) hits — the SEO surface and the publish-time purge receiver.
//
// 🔒 SKIP-GATED (house pattern, mirrors agora-storefront.spec.ts): the whole
// suite test.skips with a reason when DIGITALKIN_SITE_URL is unset or the site
// is unreachable. Plan 6 deploys it; until then this SKIPS rather than fails.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  DIGITALKIN_SITE_URL,
  DIGITALKIN_PURGE_SECRET,
  DK_ROUTES,
  DK_PURGE_HEADER,
  sitemapPaths,
} from './digital-kin-helpers.js';

const OK = 200;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const METHOD_NOT_ALLOWED = 405;
const UNAVAILABLE = 503;

test.describe('Digital Kin public site @digital-kin-api @digital-kin', () => {
  let ctx: APIRequestContext;
  let site = '';

  test.beforeAll(async ({ playwright }) => {
    if (DIGITALKIN_SITE_URL === null) {
      test.skip(true, 'DIGITALKIN_SITE_URL unset — the public site is not deployed until Plan 6.');
      return;
    }

    site = DIGITALKIN_SITE_URL;
    // Own context: staging has no LE cert (WireGuard-only), so Traefik serves a
    // self-signed one. The deliberate standing posture for this fleet.
    ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });

    try {
      const probe = await ctx.fetch(`${site}${DK_ROUTES.home}`, { timeout: 15_000 });
      if (!probe.ok()) {
        test.skip(true, `Digital Kin site at ${site} answered ${probe.status()} on /.`);
      }
    } catch {
      test.skip(true, `Digital Kin site not reachable at ${site}.`);
    }
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  // -------------------------------------------------------------------------
  // The pages themselves
  // -------------------------------------------------------------------------
  test('home is 200 HTML with a canonical link', async () => {
    const response = await ctx.fetch(`${site}${DK_ROUTES.home}`);

    expect(response.status()).toBe(OK);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).toContain('rel="canonical"');
  });

  test('an unknown guide slug is a real 404, not a soft 200', async () => {
    // A soft 404 (200 + "not found" prose) enrols junk URLs into the index. The
    // status is the part a crawler reads.
    const response = await ctx.fetch(`${site}/odigos/definitely-not-a-guide`);

    expect(response.status()).toBe(NOT_FOUND);
  });

  test('an unknown category slug is a real 404', async () => {
    const response = await ctx.fetch(`${site}/k/does-not-exist`);

    expect(response.status()).toBe(NOT_FOUND);
  });

  // -------------------------------------------------------------------------
  // robots.txt
  // -------------------------------------------------------------------------
  test('robots.txt is served at the site root as text/plain', async () => {
    const response = await ctx.fetch(`${site}/robots.txt`);

    expect(response.status()).toBe(OK);
    expect(response.headers()['content-type']).toContain('text/plain');
  });

  test('robots.txt points at an ABSOLUTE sitemap URL', async () => {
    // A relative `Sitemap:` line is ignored by the protocol, silently — Search
    // Console then reports no sitemap at all.
    const body = await (await ctx.fetch(`${site}/robots.txt`)).text();

    expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
  });

  // -------------------------------------------------------------------------
  // sitemap.xml — the URL SET, not the mount
  // -------------------------------------------------------------------------
  test('sitemap.xml is served at the site root as XML', async () => {
    const response = await ctx.fetch(`${site}/sitemap.xml`);

    // 503 is the DELIBERATE cold-cache-during-outage answer: an incomplete
    // sitemap is refused rather than published as a truncated URL set, because
    // "these are my URLs" with the guides missing tells Google they were
    // removed. Accepted here so an API blip does not red the suite, but the
    // content assertions below only run on a real 200.
    expect([OK, UNAVAILABLE]).toContain(response.status());

    if (response.status() === OK) {
      expect(response.headers()['content-type']).toContain('xml');
    }
  });

  test('sitemap.xml lists at least one guide and the GREEK static slugs', async () => {
    const response = await ctx.fetch(`${site}/sitemap.xml`);
    test.skip(response.status() === UNAVAILABLE, 'sitemap 503 — content API unavailable.');

    const paths = sitemapPaths(await response.text());

    expect(paths.some((path) => path.startsWith('/odigos/'))).toBe(true);
    // The four static routes the plan briefs got wrong four separate times.
    expect(paths).toContain(DK_ROUTES.search);
    expect(paths).toContain(DK_ROUTES.useful);
    expect(paths).toContain(DK_ROUTES.about);
    expect(paths).toContain(DK_ROUTES.help);
  });

  test('🔴 EVERY URL in the sitemap resolves to 200 on the deployed site', async () => {
    // The acceptance test for the whole SEO surface. A sitemap is nothing but a
    // list of URLs: it can be valid XML at 200 with the right Content-Type and
    // consist entirely of 404s, under a completely green build. Nothing but a
    // real fetch catches that.
    const response = await ctx.fetch(`${site}/sitemap.xml`);
    test.skip(response.status() === UNAVAILABLE, 'sitemap 503 — content API unavailable.');

    const paths = sitemapPaths(await response.text());
    expect(paths.length).toBeGreaterThan(0);

    const broken: { path: string; status: number }[] = [];
    for (const path of paths) {
      const page = await ctx.fetch(`${site}${path}`);
      if (page.status() !== OK) broken.push({ path, status: page.status() });
    }

    expect(broken).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The purge receiver — an endpoint that CHANGES SITE CONTENT
  // -------------------------------------------------------------------------
  test('🔴 an unauthenticated purge is REFUSED', async () => {
    // The security-relevant assertion. An open purge endpoint on a public host
    // is a free cache-flush DoS: every purge sends the whole site back to an
    // origin that lives across WireGuard on staging.
    const response = await ctx.fetch(`${site}/_cache/purge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: {},
    });

    // 403 when a secret IS configured; 503 when the pod has none (fail closed —
    // an unset secret refuses everything rather than accepting everything).
    // Never 200, and never 404.
    expect([FORBIDDEN, UNAVAILABLE]).toContain(response.status());
  });

  test('🔴 a WRONG purge secret is REFUSED', async () => {
    const response = await ctx.fetch(`${site}/_cache/purge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [DK_PURGE_HEADER]: 'not-the-secret' },
      data: {},
    });

    expect([FORBIDDEN, UNAVAILABLE]).toContain(response.status());
  });

  test('a GET on the purge route is 405, never 404', async () => {
    // A 404 here is indistinguishable from the route not existing at all —
    // which is the exact failure astro.config.mjs's injectRoute note describes:
    // `src/pages/_cache/purge.ts` would build green and emit NO route, Plan 4's
    // CachePurger would swallow the 404, and the site would serve stale forever.
    const response = await ctx.fetch(`${site}/_cache/purge`, { method: 'GET' });

    expect(response.status()).toBe(METHOD_NOT_ALLOWED);
  });

  test('a CORRECT purge secret is accepted', async () => {
    test.skip(
      DIGITALKIN_PURGE_SECRET === null,
      'DIGITALKIN_PURGE_SECRET unset — the accept case is opt-in so the suite ' +
        'cannot flush the production cache on every run.',
    );

    const response = await ctx.fetch(`${site}/_cache/purge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DK_PURGE_HEADER]: DIGITALKIN_PURGE_SECRET ?? '',
      },
      data: { slug: 'e2e-probe' },
    });

    expect(response.status()).toBe(OK);
    expect(await response.json()).toHaveProperty('purged');
  });
});
