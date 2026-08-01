/**
 * Kefi tenant-landing HEALTH smoke — `kefi-landing-health` project. `@api @smoke`
 *
 * WHY THIS EXISTS (a real prod incident, 2026-08-01)
 * --------------------------------------------------
 * A `manage.sh deploy kefi-landings` shipped a base nginx image that bakes ONLY
 * the statically-`getStaticPaths` tenants (KUCY / UBS). CONFIG-ONLY tenants (UBB,
 * #266) are served by the per-tenant PUBLISH flow and are NOT in that base image,
 * so the deploy WIPED UBB's site: `ubb.kefi.dloizides.com/` and
 * `app.kefi.dloizides.com/t/ubb/` both returned **403 Forbidden** (nginx has no
 * `index.html` → `/` 403s, `/index.html` 404s), while KUCY stayed 200. A real
 * customer's register page was down and NO test caught it. See memory
 * `reference_deploy_kefi_landings_wipes_config_only_tenants.md`.
 *
 * WHAT IT ASSERTS
 * ---------------
 * For every live Kefi tenant landing, BOTH URL forms it is reachable through:
 *   - the tenant subdomain root   `https://<slug>.kefi.dloizides.com/`
 *   - the app-host path form       `https://app.kefi.dloizides.com/t/<slug>/`
 * must return **200** with a REAL landing page body — explicitly FAILING on the
 * wiped-site signatures (403 / 404, or an nginx error page served with a 200).
 * `classifyLanding()` below is the matcher; it is deliberately self-tested (see
 * the "matcher is not vacuous" block) so it can actually go red.
 *
 * HOME / SHAPE
 * -----------
 * Standalone project (no `setup` dependency, no storageState, no baseURL) modelled
 * on `kefi-landing-parity`: it uses ABSOLUTE prod URLs because a tenant landing
 * only exists in prod (published to *.kefi.dloizides.com — there is no per-tenant
 * staging landing). `@api` — it uses only the `request` fixture, so no browser is
 * launched. Registered in playwright.projects.ts as `kefi-landing-health`, so the
 * nightly in-cluster CHUNKED run (which enumerates every project via
 * `playwright test --list`) runs it and a 403 pages via the canary summary.
 *
 * NOTE (separate finding, NOT this test's job): these tenant landings serve
 * `robots.txt` and `sitemap.xml` as 404, which is why they were NOT added to the
 * daily `static-landings` smoke — that audit's Web App Standards gate would go
 * permanently red on those and bury this 403 signal.
 */
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';

/** Base domain for the tenant landings. Overridable, but prod is the only place
 *  these are published (see header). */
const BASE_DOMAIN = process.env.KEFI_LANDING_BASE_DOMAIN ?? 'kefi.dloizides.com';
const APP_HOST = `https://app.${BASE_DOMAIN}`;

interface TenantLanding {
  /** The tenant slug — also the subdomain label AND the /t/<slug>/ path segment. */
  slug: string;
  /** Human-readable label for test titles + failure reports. */
  label: string;
}

/**
 * Every live Kefi tenant landing. UBB is the config-only tenant that broke;
 * KUCY + UBS are the statically-baked tenants; e2e is the dedicated fixture
 * tenant. All are read-only probes — nothing is created or mutated.
 */
const TENANTS: readonly TenantLanding[] = [
  { slug: 'ubb', label: 'UBB — config-only tenant (the one that 403d)' },
  { slug: 'kizomba-union-cy', label: 'KUCY' },
  { slug: 'ubs', label: 'UBS' },
  { slug: 'e2e', label: 'E2E fixture tenant' },
] as const;

/** A body must clear this to count as a real page and not a terse error page. */
const MIN_REAL_BODY_BYTES = 2000;

interface LandingVerdict {
  healthy: boolean;
  reason: string;
}

/**
 * The matcher. PURE (status + body in, verdict out) so it can be unit-asserted
 * against known-bad inputs — the guard against a vacuous "always green" test.
 *
 * Catches the exact failure mode: a non-200 (especially 403 = nginx has no
 * index.html for a wiped config-only tenant, or 404 = missing landing), OR a
 * 200 that is actually an nginx error page, OR a 200 with no landing markup.
 */
export function classifyLanding(status: number, body: string): LandingVerdict {
  if (status === 403) {
    return {
      healthy: false,
      reason: '403 Forbidden — nginx has no index.html (wiped config-only tenant; the exact regression)',
    };
  }
  if (status === 404) {
    return { healthy: false, reason: '404 Not Found — landing page missing from the deployed image' };
  }
  if (status !== 200) {
    return { healthy: false, reason: `expected 200, got ${status}` };
  }
  // A 200 that is really an nginx default error page (some proxies rewrite the
  // status but keep the error body).
  if (/<title>\s*40\d[^<]*<\/title>/i.test(body) || /<hr>\s*<center>\s*nginx/i.test(body)) {
    return { healthy: false, reason: 'nginx error page served with a 200 status' };
  }
  const hasLandingMarker =
    /data-website-id/i.test(body) || /class="[^"]*hero/i.test(body) || /<html[^>]*\blang/i.test(body);
  if (!hasLandingMarker) {
    return {
      healthy: false,
      reason: 'no landing markup (hero / analytics snippet / <html lang>) — not a real landing page',
    };
  }
  if (body.length < MIN_REAL_BODY_BYTES) {
    return { healthy: false, reason: `body suspiciously small (${body.length} bytes) for a landing page` };
  }
  return { healthy: true, reason: `OK — 200, real landing (${body.length} bytes)` };
}

async function probeLanding(ctx: APIRequestContext, url: string): Promise<LandingVerdict & { status: number }> {
  const res = await ctx.get(url, { failOnStatusCode: false, maxRedirects: 5 });
  const body = await res.text();
  const verdict = classifyLanding(res.status(), body);
  return { ...verdict, status: res.status() };
}

test.describe('Kefi tenant-landing health @api @smoke', () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    // Own request context so the probes carry no project baseURL / auth state.
    ctx = await playwrightRequest.newContext();
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  for (const tenant of TENANTS) {
    const subdomainUrl = `https://${tenant.slug}.${BASE_DOMAIN}/`;
    const pathUrl = `${APP_HOST}/t/${tenant.slug}/`;

    test(`${tenant.label}: subdomain root returns a real landing (${subdomainUrl})`, async () => {
      const r = await probeLanding(ctx, subdomainUrl);
      expect(r.healthy, `${subdomainUrl} → HTTP ${r.status}: ${r.reason}`).toBe(true);
    });

    test(`${tenant.label}: /t/${tenant.slug}/ path form returns a real landing (${pathUrl})`, async () => {
      const r = await probeLanding(ctx, pathUrl);
      expect(r.healthy, `${pathUrl} → HTTP ${r.status}: ${r.reason}`).toBe(true);
    });
  }

  /**
   * NON-VACUITY GUARD. Two layers prove this suite can actually go red:
   *   1. classifyLanding() rejects the exact wiped-site inputs (403/404 + an
   *      nginx error body served with 200), and accepts a real body.
   *   2. A LIVE negative: a definitely-missing path on a real tenant host must
   *      NOT classify as healthy — proving the matcher fails against real infra,
   *      not just hand-crafted strings.
   */
  test('matcher is not vacuous: classifyLanding rejects the 403/404 wiped-site signatures', async () => {
    const nginx403 = '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx/1.25.3</center>\r\n</body>\r\n</html>\r\n';
    const realBody = `<!doctype html><html lang="en"><head><title>United By Bachata</title>${'x'.repeat(3000)}<section class="hero"></section><script data-website-id="abc"></script></head></html>`;

    expect(classifyLanding(403, nginx403).healthy, 'a 403 must be unhealthy').toBe(false);
    expect(classifyLanding(404, '').healthy, 'a 404 must be unhealthy').toBe(false);
    expect(classifyLanding(500, '').healthy, 'a 500 must be unhealthy').toBe(false);
    expect(classifyLanding(200, nginx403).healthy, 'an nginx error body served with 200 must be unhealthy').toBe(false);
    expect(classifyLanding(200, '<html><body>tiny</body></html>').healthy, 'a tiny no-marker 200 must be unhealthy').toBe(false);
    expect(classifyLanding(200, realBody).healthy, 'a real landing body must be healthy').toBe(true);
  });

  test('matcher is not vacuous: a live missing path is classified unhealthy', async () => {
    const missing = `https://${TENANTS[0].slug}.${BASE_DOMAIN}/this-path-does-not-exist-${Date.now()}`;
    const r = await probeLanding(ctx, missing);
    expect(r.healthy, `${missing} (HTTP ${r.status}) must NOT be considered a healthy landing`).toBe(false);
  });
});
