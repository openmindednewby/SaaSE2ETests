/**
 * Per-target URL resolution for the Phase B Kefi tenant-lifecycle E2E. All
 * values come from the loaded `.env.<target>` file via
 * `fixtures/env-loader.ts`; this module is just a typed accessor + a clear
 * error path when a required env var is missing.
 *
 * Why a dedicated helper instead of inlining `process.env.KEFI_*` in the
 * spec: the env-loader runs at config-time, so `process.env.*` is populated
 * inside specs. But forgetting one var produces a `https://undefined/...`
 * URL that fails with a confusing TLS error — readers waste 15 min before
 * spotting it. This helper fails fast with the var name in the message.
 */

interface KefiUrls {
  marketingUrl: string;
  apiUrl: string;
  kcUrl: string;
  kcRealm: string;
  bffClientId: string;
  /** kefi-web SPA host (Phase C — /(auth)/login + organizer wizard). */
  webUrl: string;
  /**
   * KUCY hand-authored landing URL — the Phase C subdomain probe target. The
   * canary's publish job rebuilds the whole kefi-landings image; KUCY is the
   * only fully hand-authored, dynamically-overlaid tenant that proves the
   * rebuild succeeded end-to-end (canary slugs aren't enumerated by Astro's
   * getStaticPaths, so they never get a rendered page in the dist).
   */
  kucyLandingUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[kefiUrls] Required env var ${name} is unset. Add it to .env.<target> (urls) or .env.<target>.secrets (creds).`,
    );
  }
  return value;
}

export function getKefiUrls(): KefiUrls {
  return {
    marketingUrl: requireEnv('KEFI_MARKETING_URL'),
    apiUrl: requireEnv('KEFI_API_URL'),
    kcUrl: requireEnv('KEFI_KC_URL'),
    kcRealm: requireEnv('KEFI_KC_REALM'),
    bffClientId: requireEnv('KEFI_BFF_CLIENT_ID'),
    webUrl: requireEnv('KEFI_WEB_URL'),
    kucyLandingUrl: requireEnv('KEFI_KUCY_LANDING_URL'),
  };
}

/** Public landing host for `{slug}.kefi.dloizides.com` (Phase C use). */
export function tenantSubdomainUrl(slug: string): string {
  const { marketingUrl } = getKefiUrls();
  // KEFI_MARKETING_URL is e.g. https://kefi.dloizides.com — the per-tenant
  // host is the same suffix with the slug as the leftmost label.
  const url = new URL(marketingUrl);
  return `${url.protocol}//${slug}.${url.host}`;
}
