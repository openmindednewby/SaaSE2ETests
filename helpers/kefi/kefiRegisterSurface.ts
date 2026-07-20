/**
 * Resolves WHICH build of the tenant register page a mobile spec drives.
 *
 * The ambassador picker (#283) ships in `kefi-landings`, but a tenant's public
 * site only gains it once that tenant is REPUBLISHED — the pages are static
 * Astro routes baked per slug. At the time these specs were written UBB had not
 * been republished, so the picker existed in the repo and not on the live site.
 * A spec pinned to production would therefore have "passed" by testing a page
 * that does not contain the feature at all.
 *
 * So the surface is selectable, and the specs assert the SAME contract against
 * either one:
 *
 *   KEFI_LANDINGS_PREVIEW_URL=http://localhost:4598   → the local `dist` build
 *   (unset)                                           → the live tenant subdomain
 *
 * Build the local surface with the browser-facing API pointed somewhere
 * unreachable, which is what makes this prod-safe by construction:
 *
 *   cd kefi-landings
 *   KEFI_API_BASE_URL=https://v2-api.kizombaunioncy.dloizides.com \
 *   KEFI_PUBLIC_API_BASE_URL=http://127.0.0.1:4599 \
 *   npm run build && npx astro preview --port 4598
 *
 * `KEFI_API_BASE_URL` is the BUILD-time read (fetches the tenant's real passes
 * and prices over a plain GET — read-only). `KEFI_PUBLIC_API_BASE_URL` is what
 * the BROWSER calls at runtime; pointing it at a dead local port means an
 * un-intercepted register POST fails to connect instead of creating a real row
 * on the live UBB roster. The specs intercept it anyway — belt and braces.
 */

import { tenantSubdomainUrl } from './kefiUrls.js';

/** The resolved register surface. */
export interface KefiRegisterSurface {
  /** Site root for the tenant — the page object appends `/register`. */
  siteUrl: string;
  /** True when driving a locally built `dist` rather than the live site. */
  isLocalBuild: boolean;
  /** Human-readable environment name, for report/annotation text. */
  label: string;
}

/** The env var that switches the specs onto a locally built kefi-landings. */
export const PREVIEW_URL_VAR = 'KEFI_LANDINGS_PREVIEW_URL';

/**
 * Resolve the register surface for a tenant slug.
 *
 * The local build serves every tenant under `/t/{slug}/`, while the live site
 * serves ONE tenant at its own subdomain root (nginx uses the tenant dir as its
 * root). Both therefore expose `/register`, which is why one page object drives
 * both without a branch.
 */
export function resolveRegisterSurface(slug: string): KefiRegisterSurface {
  const preview = (process.env[PREVIEW_URL_VAR] ?? '').trim().replace(/\/+$/, '');

  if (preview !== '') {
    return {
      siteUrl: `${preview}/t/${slug}`,
      isLocalBuild: true,
      label: `local kefi-landings build at ${preview}`,
    };
  }

  const siteUrl = tenantSubdomainUrl(slug);
  return { siteUrl, isLocalBuild: false, label: `published site at ${siteUrl}` };
}
