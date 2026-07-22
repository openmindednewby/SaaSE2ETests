// Shared config for the Digital Kin public-site E2E tiers.
//
// ⚠️ THE SITE IS NOT DEPLOYED YET. Plan 6 creates the k8s manifest, ingress, DNS
// and TLS; Plan 3 (which these specs ship with) builds the app. Until then
// DIGITALKIN_SITE_URL is unset and BOTH tiers test.skip with a reason. That is
// the house pattern (see agora-storefront.spec.ts) and it never fakes a pass: if
// the surface is not there, the run SKIPS, loudly.
//
// To run against a local dev server:
//   DIGITALKIN_SITE_URL=http://localhost:4402 npm run test:digital-kin
// Against the deployed site once Plan 6 lands:
//   DIGITALKIN_SITE_URL=https://digitalkin.dloizides.com npm run test:digital-kin

/** The public site origin under test, or null when it is not configured. */
export const DIGITALKIN_SITE_URL: string | null =
  process.env.DIGITALKIN_SITE_URL?.trim().replace(/\/+$/, '') || null;

/**
 * The ADMIN CMS origin — the surface Sophia authors in.
 *
 * 🔴 THIS MUST BE THE INGRESS HOSTNAME, NOT A NODEPORT. The BFF enforces an
 * `Origin` allow-list (`Bff:Csrf:AllowedOrigins` in Bff.DigitalKin's
 * appsettings.json) on every state-changing request. It lists only
 * `https://admin.digitalkin.dloizides.com`,
 * `https://staging.admin.digitalkin.dloizides.com` and `http://localhost:8088`.
 *
 * Pointing this at the staging NodePort (`http://10.0.0.2:30358`) makes the SPA
 * load and the login form render — and then EVERY login returns
 * `403 {"error":"Anti-forgery validation failed."}`, because the NodePort origin
 * is not on the list. The bare SPA service (`:30359`) is worse: it has no BFF at
 * all, so `POST /bff/login` hits the static-file server and returns 405 while
 * `GET /bff/me` returns the SPA's own index.html with a 200. Both look like
 * "the CMS is up" from the outside. Verified live 2026-07-22.
 */
export const DIGITALKIN_ADMIN_URL: string | null =
  process.env.DIGITALKIN_ADMIN_URL?.trim().replace(/\/+$/, '') || null;

/** Master account — full access, including taxonomy writes. */
export const DIGITALKIN_MASTER_USER: string | null =
  process.env.DIGITALKIN_DEMO_MASTER_USER?.trim() || null;
export const DIGITALKIN_MASTER_PASSWORD: string | null =
  process.env.DIGITALKIN_DEMO_MASTER_PASSWORD?.trim() || null;

/** Admin account — guides/media only; must NOT reach taxonomy. */
export const DIGITALKIN_ADMIN_USER: string | null =
  process.env.DIGITALKIN_DEMO_ADMIN_USER?.trim() || null;
export const DIGITALKIN_ADMIN_PASSWORD: string | null =
  process.env.DIGITALKIN_DEMO_ADMIN_PASSWORD?.trim() || null;

/** True when the authoring tier has everything it needs to run for real. */
export function hasAdminCredentials(): boolean {
  return (
    DIGITALKIN_ADMIN_URL !== null &&
    DIGITALKIN_MASTER_USER !== null &&
    DIGITALKIN_MASTER_PASSWORD !== null
  );
}

/**
 * A run-unique prefix for content this suite creates on the REAL public site.
 * Deliberately greppable so `sitemap.xml | grep e2e-dk-` finds anything the
 * teardown missed.
 */
export function dkTag(): string {
  return `e2e-dk-${Date.now().toString().slice(-8)}`;
}

/**
 * The purge shared secret, if the runner has been given one.
 *
 * Only the REJECTION cases are asserted without it — proving an unauthenticated
 * caller is refused needs no secret, and that is the security-relevant half. The
 * accept case is asserted only when a secret is supplied, because a suite that
 * could flush the production cache on every run would be a self-inflicted
 * origin-load spike.
 */
export const DIGITALKIN_PURGE_SECRET: string | null =
  process.env.DIGITALKIN_PURGE_SECRET?.trim() || null;

/**
 * 🔴 GREEK SLUGS. These mirror `digital-kin-site/src/lib/routes.ts` and they are
 * the reason this constant exists instead of paths typed at each call site.
 *
 * Plan 3's task briefs specified the English forms — `/search`, `/useful`,
 * `/about`, `/help`, `/downloads` — FOUR separate times, because the plan was
 * drafted before Task 6 localised the slugs. Every one of those English paths
 * 404s. Nothing in either repo's toolchain resolves an Astro route, so the only
 * defences are deriving from the route table (which the site does) and pinning
 * the real paths in one place here.
 */
export const DK_ROUTES = {
  home: '/',
  search: '/psaxno',
  useful: '/yliko',
  about: '/poioi-eimaste',
  help: '/voithia',
  downloads: '/lipseis',
} as const;

/** The primary nav, in Figma order. `downloads` is footer-only, deliberately. */
export const DK_NAV_PATHS: readonly string[] = [
  DK_ROUTES.home,
  DK_ROUTES.search,
  DK_ROUTES.useful,
  DK_ROUTES.about,
  DK_ROUTES.help,
];

/** The header Plan 4's CachePurger must send. Mirrors `PURGE_HEADER` in lib/purge.ts. */
export const DK_PURGE_HEADER = 'x-digitalkin-purge-secret';

/** Minimum tap-target height for this audience (spec: >= 48px, not aspirational). */
export const MIN_TAP_TARGET_PX = 48;

/** Every `<loc>` in a sitemap document, as site-relative paths. */
export function sitemapPaths(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((match) => {
    const url = new URL((match[1] ?? '').replace(/&amp;/g, '&'));
    return `${url.pathname}${url.search}`;
  });
}
