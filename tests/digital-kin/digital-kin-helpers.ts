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
