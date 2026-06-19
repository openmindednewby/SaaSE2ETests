/**
 * Accessibility (a11y) E2E spec — project `a11y-public`.
 *
 * Runs axe-core (via {@link scanA11y}) against the PUBLIC, no-auth surfaces of
 * the deployed products. These pages are reachable without login, so this spec
 * is a STANDALONE project: it uses absolute URLs (read from the per-target env,
 * defaulting to prod), takes no `setup` / `multi-tenant-setup` dependency, and
 * is safe to run against local / staging / prod — read-only navigation + an
 * axe scan never mutates state.
 *
 * Policy (see helpers/a11y.ts): FAIL on any critical/serious WCAG violation;
 * REPORT (don't fail) moderate/minor. Surfacing real issues here is a valid,
 * useful outcome — a red run lists the exact rule id + DOM node.
 *
 * The PUBLIC surfaces:
 *   • erevna   (surveys/forms) — public /login route
 *   • katalogos (online menus) — public /login route
 *   • kefi      (events)       — public marketing landing
 *
 * Authenticated-screen a11y scans are kept OPTIONAL/secondary — see the
 * `@a11y-auth` describe at the bottom. They are skipped unless a logged-in
 * storage state is available, since seeding auth needs a reachable
 * Keycloak/BFF (a running target), which is not guaranteed in every run.
 */
import { test } from '@playwright/test';
import { scanA11y } from '../../helpers/a11y.js';

/**
 * Public surfaces to scan. URLs come from the per-target env (loaded by
 * `loadE2EEnv()` in playwright.config.ts) and fall back to the prod hosts so
 * the spec works as a self-contained standalone project. The fallbacks match
 * `.env.prod` (EREVNA_BASE_URL / KATALOGOS_BASE_URL / KEFI_MARKETING_URL).
 */
interface PublicSurface {
  label: string;
  url: string;
}

const PUBLIC_SURFACES: readonly PublicSurface[] = [
  {
    label: 'erevna public login',
    url: `${process.env.EREVNA_BASE_URL ?? 'https://erevna.dloizides.com'}/login`,
  },
  {
    label: 'katalogos public login',
    url: `${
      process.env.KATALOGOS_BASE_URL ?? process.env.BASE_URL ?? 'https://katalogos.dloizides.com'
    }/login`,
  },
  {
    label: 'kefi marketing landing',
    url: process.env.KEFI_MARKETING_URL ?? 'https://kefi.dloizides.com',
  },
];

test.describe('@a11y public no-auth surfaces', () => {
  for (const surface of PUBLIC_SURFACES) {
    test(`${surface.label} has no critical/serious a11y violations`, async ({ page }) => {
      // Absolute URL — standalone project has no baseURL contract.
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' });
      // The Expo/React apps hydrate after the initial load; wait for rendered
      // content (the body has children) before scanning. axe re-reads the live
      // DOM, so this is enough to avoid scanning an empty shell.
      await page.locator('body > *').first().waitFor({ state: 'attached' });
      await scanA11y(page, { label: surface.label });
    });
  }
});

/**
 * OPTIONAL / secondary — authenticated-screen a11y.
 *
 * Scanning a logged-in screen needs a saved storage state, which in turn needs
 * a reachable Keycloak/BFF to mint. That is only guaranteed against a running
 * target (and the auth `setup` project, which this standalone project does not
 * depend on). Rather than couple this public-surface spec to the auth rig, the
 * authenticated scan is gated behind the presence of a storage-state file and
 * skipped cleanly otherwise. To exercise it, run with the saved auth state, e.g.
 *
 *   A11Y_AUTH_STATE=playwright/.auth/user.json \
 *     npx playwright test --project=a11y-public
 *
 * (or wire a dedicated authed project with `use.storageState`). When skipped it
 * prints the reason, so a run never silently omits coverage.
 */
test.describe('@a11y-auth authenticated surface (optional)', () => {
  const authState = process.env.A11Y_AUTH_STATE;

  test.skip(
    !authState,
    'Authenticated a11y scan needs a saved storage state (A11Y_AUTH_STATE) + a reachable target — set A11Y_AUTH_STATE to enable.',
  );

  test.use({ storageState: authState });

  test('katalogos authenticated home has no critical/serious a11y violations', async ({ page }) => {
    const base =
      process.env.KATALOGOS_BASE_URL ?? process.env.BASE_URL ?? 'https://katalogos.dloizides.com';
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('body > *').first().waitFor({ state: 'attached' });
    await scanA11y(page, { label: 'katalogos authenticated home' });
  });
});
