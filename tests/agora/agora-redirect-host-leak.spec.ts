/**
 * agora-web must never 301 a public route to a NON-PUBLIC host.
 *
 * ── The defect this pins (found 2026-07-18, prod) ─────────────────────────────
 *
 *   GET https://app.agora.dloizides.com/products
 *     -> 301  Location: http://agora-web/products/
 *
 * `agora-web` is the in-cluster Kubernetes Service name. A browser outside the
 * cluster cannot resolve it, so the route is simply DEAD on a server round trip:
 * a bookmark, a shared link, a hard refresh or any address-bar navigation to
 * /products, /orders or /coupons lands on ERR_NAME_NOT_RESOLVED. It also
 * downgrades https -> http, leaking the internal topology in a redirect that
 * reaches the public internet.
 *
 * ── Why it hid ────────────────────────────────────────────────────────────────
 *
 * Client-side SPA navigation never makes the round trip — clicking through the
 * app from `/` works perfectly, so every click-driven test and every manual
 * walkthrough passes. Only a DIRECT hit on the route touches nginx.
 *
 * ── Root cause ────────────────────────────────────────────────────────────────
 *
 * `agora-web/nginx.conf`: `try_files $uri $uri/ /index.html;`. Where the Expo
 * export emitted a real DIRECTORY (`products/`, `orders/`, `coupons/` — the
 * routes that have child routes), the `$uri/` term matches and nginx issues its
 * canonical "add the trailing slash" 301. With the default `absolute_redirect
 * on` and `server_name _`, nginx builds that Location from the POD's hostname
 * rather than the request's Host, producing `http://agora-web/...`.
 *
 * Fix is one directive in the `server` block:  `absolute_redirect off;`
 * (plus `port_in_redirect off;`), which makes nginx emit a RELATIVE Location
 * and keeps the browser on the public origin. erevna-web, katalogos-web and
 * kefi-web carry the identical `try_files` line and the identical omission —
 * they are not currently triggering it only because their export happens to
 * emit flat files for the routes checked. The hazard is fleet-wide; the
 * outage is agora's.
 *
 * ── Why this is an HTTP test and not a browser test ───────────────────────────
 *
 * Driving it through Chromium is NON-DETERMINISTIC: whether the run fails
 * depends on whether the browser's resolver happens to give up on `agora-web`
 * or resolve it through some search domain, so the same build flaps between
 * ERR_NAME_NOT_RESOLVED and green, on a different screen each time. That
 * flapping reads as a network flake and is exactly how a hard product defect
 * gets dismissed. Asserting the redirect at the HTTP layer is 100% reproducible.
 */
import { expect, test, request as playwrightRequest } from '@playwright/test';

const AGORA_WEB_URL = process.env.AGORA_WEB_URL ?? '';

/**
 * Every first-level route of the merchant admin SPA. The directory-backed ones
 * (`/products`, `/orders`, `/coupons`) are the ones that regressed, but the
 * whole set is checked because which routes the export emits as directories is
 * a build detail that can change under us.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/products',
  '/orders',
  '/coupons',
  '/categories',
  '/settings',
  '/billing',
  '/onboarding',
];

test.describe('agora-web — no public route redirects to an internal host @agora @security', () => {
  test.skip(AGORA_WEB_URL.trim() === '', 'AGORA_WEB_URL not configured for this E2E target');

  const publicHost = (() => {
    try {
      return new URL(AGORA_WEB_URL).host;
    } catch {
      return '';
    }
  })();

  for (const route of PUBLIC_ROUTES) {
    test(`GET ${route} does not 301 off the public origin`, async () => {
      // `maxRedirects: 0` so we inspect the Location header itself rather than
      // following it into a resolver failure.
      const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
      try {
        const res = await ctx.get(`${AGORA_WEB_URL}${route}`, {
          maxRedirects: 0,
          failOnStatusCode: false,
        });

        const location = res.headers()['location'] ?? '';

        // A relative Location keeps the browser on the public origin and is fine.
        if (location === '' || location.startsWith('/')) return;

        const target = new URL(location, AGORA_WEB_URL);

        expect(
          target.host,
          `🔴 ${route} responded ${String(res.status())} with Location: ${location}\n` +
            `That host is not the public origin (${publicHost}). If it is the in-cluster ` +
            `Service name, this route is DEAD for any direct navigation, bookmark or refresh — ` +
            `the browser cannot resolve it — and the redirect leaks internal topology over ` +
            `plaintext http. Fix: add "absolute_redirect off;" (and "port_in_redirect off;") ` +
            `to the server block in agora-web/nginx.conf so nginx emits a RELATIVE Location.`,
        ).toBe(publicHost);

        expect(
          target.protocol,
          `🔴 ${route} redirects to ${location} — an https request must never be downgraded to http.`,
        ).toBe('https:');
      } finally {
        await ctx.dispose();
      }
    });
  }
});
