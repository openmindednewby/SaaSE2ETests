/** Public, signed-out-reachable routes per portal. Keyed by the mobile project's portal slug. */
/**
 * Public, signed-out-reachable routes per portal, keyed by the mobile project's
 * portal slug.
 *
 * Every route below was RENDERED at 360x640 before being added, never curl'd:
 * all eight hosts are SPA fallbacks that answer HTTP 200 on `/nope-404`, so a
 * status code proves nothing here. The check was the rendered pathname plus the
 * body text. Dropped for that reason: katalogos `/menus`; kefi
 * `/organizer/landing`, `/organizer/pricing`, `/request-access`; poueni `/map`,
 * `/devices`, `/settings` - all redirect to `/login`, so they would have
 * measured the login screen under another route's name. Also dropped: ichnos
 * `/forgot-password`, which renders an error boundary.
 *
 * agora, zygos and poueni redirect `/` to `/login` and expose no other public
 * surface, so their portal total is honestly ONE screen; both entries are kept
 * so the redirect itself stays measured.
 */
export const PORTAL_ROUTES: Record<string, string[]> = {
  nextgame: ['/', '/age', '/privacy'],
  katalogos: ['/', '/pricing', '/public/privacy', '/public/terms'],
  erevna: ['/', '/pricing', '/public/privacy', '/public/terms'],
  kefi: ['/', '/privacy', '/login'],
  ichnos: ['/', '/login', '/register'],
  agora: ['/', '/login'],
  zygos: ['/', '/login'],
  poueni: ['/', '/login'],
  'digital-kin': ['/'],
};

/** `mobile-gates-<portal>-<device>` -> `<portal>`. */
export function portalFromProjectName(projectName: string): string {
  return projectName.replace(/^mobile-gates-/, '').replace(/-(floor|pixel5)$/, '');
}
