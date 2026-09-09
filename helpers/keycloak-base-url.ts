/**
 * Resolves the Keycloak base URL for realm-token acquisition. Split out of
 * `realm-token-helper.ts` to keep that file under the max-file-lines limit.
 */

/**
 * Resolves the Keycloak base URL (scheme + host, no trailing `/realms/...`).
 *
 * Resolution order:
 *  1. `KEYCLOAK_URL` — explicit override, used verbatim if set.
 *  2. `KEYCLOAK_ISSUER` — derived by stripping the `/realms/<realm>` suffix.
 *     This is the primary source: every `.env.<target>` file already sets
 *     `KEYCLOAK_ISSUER` (e.g. `https://staging.identity.dloizides.com/realms/OnlineMenu`),
 *     so the KC base falls out for free and there's no separate var to forget.
 *
 * If NEITHER is resolvable we THROW. Silently falling back to a hardcoded
 * prod URL (the previous behaviour) is the actual bug — when run with
 * `E2E_TARGET=staging` and no `KEYCLOAK_URL`, the helper would mint tokens
 * against PROD Keycloak. A missing config must fail loud, not leak to prod.
 *
 * Exported for unit assertions.
 */
export function resolveKeycloakBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.KEYCLOAK_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const issuer = env.KEYCLOAK_ISSUER?.trim();
  if (issuer) {
    // Strip a trailing `/realms/<realm>` (and anything after it) to get the
    // Keycloak base. `https://host/realms/OnlineMenu` -> `https://host`.
    const match = /^(.*?)\/realms\/[^/]+/.exec(issuer);
    if (match && match[1]) {
      return match[1].replace(/\/+$/, '');
    }
    throw new Error(
      `[realm-token-helper] KEYCLOAK_ISSUER="${issuer}" does not contain a ` +
        `'/realms/<realm>' segment — cannot derive the Keycloak base URL. ` +
        `Set KEYCLOAK_URL explicitly or fix KEYCLOAK_ISSUER.`,
    );
  }

  throw new Error(
    '[realm-token-helper] Cannot resolve the Keycloak base URL: neither ' +
      'KEYCLOAK_URL nor KEYCLOAK_ISSUER is set. Refusing to fall back to a ' +
      'hardcoded prod URL — that would mint tokens against PROD Keycloak. ' +
      'Set KEYCLOAK_ISSUER in the active .env.<target> file.',
  );
}
