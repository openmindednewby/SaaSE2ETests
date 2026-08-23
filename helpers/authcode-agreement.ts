/**
 * Shared plumbing for the AUTH-CODE front/back channel agreement suite.
 *
 * ── What this measures, and why nothing else does ─────────────────────────────
 *
 * A BFF talks to its identity provider over TWO channels:
 *
 *   FRONT  `Bff:AuthCode:PublicAuthority` — the origin the BROWSER is redirected
 *          to in order to authenticate. Only a top-level navigation touches it.
 *   BACK   `Bff:Keycloak:Authority`       — the origin the BFF itself calls to
 *          redeem the authorization code and read discovery.
 *
 * They are allowed to be different URLs (public hostname vs in-cluster service
 * name). They are NOT allowed to name different identity PROVIDERS. When they
 * do, an authorization code minted by provider A is presented to provider B and
 * every interactive login fails.
 *
 * `BffAuthorityAgreementGuard` (Bff.AspNetCore >= 1.14.0) refuses to start the
 * pod in that state — which is a good failure, but an INVISIBLE one: Kubernetes
 * keeps the previous pod serving 200 while the new one crash-loops. That is
 * exactly what happened to `bff-agora`, undetected for 22 days.
 *
 * ── Why every existing login test stayed green ────────────────────────────────
 *
 * Every portal login in this suite is ROPC or the published demo credential:
 * the SPA POSTs a username/password to `/bff/login` and the browser NEVER LEAVES
 * THE APP ORIGIN. The front channel is not exercised, so it can be pointed at a
 * dead host, at the wrong Keycloak, or at nothing at all, and the entire suite
 * still passes. See `reference_demo_ropc_masks_broken_authcode_login`.
 *
 * ── How this suite sees it from outside ───────────────────────────────────────
 *
 * BACK  channel: `GET /bff/config` publishes `issuer` + `issuerStatus` — what
 *       the BFF's own back channel RESOLVED at startup, read from the provider's
 *       discovery document rather than from config. (Public by construction: an
 *       issuer is the `iss` claim of every token and a field of a world-readable
 *       `.well-known` document.)
 * FRONT channel: `GET /bff/passkey/login` is an anonymous browser navigation
 *       that 302s to `{PublicAuthority}{AuthorizePath}`. Following one hop of
 *       that redirect and reading the discovery document at that origin yields
 *       the front channel's issuer.
 *
 * Comparing the two answers the question with no credentials, no pinned
 * per-environment expectation, and no assumption about which provider is
 * "right" — the two halves of one deployment must simply agree.
 */

/** A portal that fronts a BFF. An empty `baseUrl` means "not configured for this target". */
export interface AuthCodePortal {
  readonly label: string;
  readonly baseUrl: string;
}

/** Strips trailing slashes so `${base}${path}` never doubles up. */
export function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function portal(label: string, envVar: string): AuthCodePortal {
  return { label, baseUrl: trimTrailingSlash(process.env[envVar] ?? '') };
}

/**
 * Every portal that serves a BFF. Keep this in step with the fleet: a portal
 * missing from here is a portal with no guard, which is the hole this file
 * exists to close. A portal whose env var is unset SKIPS loudly — it never
 * silently reports success.
 */
export const AUTHCODE_PORTALS: readonly AuthCodePortal[] = [
  portal('erevna-web', 'EREVNA_BASE_URL'),
  portal('katalogos-web', 'KATALOGOS_BASE_URL'),
  portal('kefi-web', 'KEFI_WEB_URL'),
  portal('agora-web', 'AGORA_WEB_URL'),
  portal('zygos-web', 'ZYGOS_WEB_URL'),
  portal('ichnos-web', 'ICHNOS_WEB_URL'),
  portal('poueni-web', 'POUENI_WEB_URL'),
];

/** `BffIssuerStatusWire` — the exact strings `GET /bff/config` serialises. */
export const ISSUER_STATUS_RESOLVED = 'resolved';
export const ISSUER_STATUS_UNREACHABLE = 'unresolved-unreachable';
export const ISSUER_STATUS_NOT_APPLICABLE = 'unresolved-not-applicable';

/** The subset of `GET /bff/config` this suite reads. */
export interface BffIssuerConfig {
  readonly issuer?: string | null;
  readonly issuerStatus?: string;
  readonly methods?: readonly string[];
}

/** The passkey method is what makes the front channel probeable anonymously. */
export const PASSKEY_METHOD = 'passkey';

export const CONFIG_PATH = '/bff/config';
export const FRONT_CHANNEL_PATH = '/bff/passkey/login?returnUrl=%2F';

const KEYCLOAK_AUTHORIZE_SUFFIX = '/protocol/openid-connect/auth';
const OPENIDDICT_AUTHORIZE_SUFFIX = '/connect/authorize';
const DISCOVERY_SUFFIX = '/.well-known/openid-configuration';

/**
 * Issuers compare equal modulo a trailing slash. Providers are inconsistent
 * about it and a bare string compare would report a false MISMATCH — which is
 * how a gate gets switched off.
 */
export function normaliseIssuer(issuer: string): string {
  return trimTrailingSlash(issuer);
}

/**
 * Derives the discovery URL from the authorize URL the BFF redirected to.
 *
 * DERIVED, never assumed: the point is to read the issuer at whatever origin
 * the browser is ACTUALLY sent to. Pinning a per-environment expected issuer
 * instead would relocate the assumption rather than test it.
 *
 * Keycloak namespaces discovery per realm
 * (`/realms/{r}/protocol/openid-connect/auth` -> `/realms/{r}/.well-known/...`);
 * OpenIddict serves one document at the root (`/connect/authorize` -> `/.well-known/...`).
 * An unrecognised shape returns null — a caller must report "cannot check",
 * never guess a URL and read whatever answers.
 */
export function discoveryUrlFor(authorizeUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(authorizeUrl);
  } catch {
    return null;
  }

  const path = parsed.pathname;
  if (path.endsWith(KEYCLOAK_AUTHORIZE_SUFFIX)) {
    const realmPath = path.slice(0, -KEYCLOAK_AUTHORIZE_SUFFIX.length);
    return `${parsed.origin}${realmPath}${DISCOVERY_SUFFIX}`;
  }
  if (path.endsWith(OPENIDDICT_AUTHORIZE_SUFFIX)) {
    return `${parsed.origin}${DISCOVERY_SUFFIX}`;
  }
  return null;
}

/** True when the portal publishes the passkey method, i.e. the front-channel probe is available. */
export function publishesPasskey(config: BffIssuerConfig): boolean {
  return (config.methods ?? []).some((method) => method.toLowerCase() === PASSKEY_METHOD);
}

/**
 * Compares the two issuers and returns a human-readable failure, or null when
 * they agree. Returned rather than asserted so the negative-control suite can
 * drive the SAME code path against a deliberately-broken fixture — a comparison
 * that has never been watched to fail proves nothing.
 */
export function issuerDisagreement(
  label: string,
  frontIssuer: string,
  backIssuer: string,
): string | null {
  if (normaliseIssuer(frontIssuer) === normaliseIssuer(backIssuer)) {
    return null;
  }
  return (
    `${label}: FRONT and BACK channels name DIFFERENT identity providers. ` +
    `The browser is sent to '${frontIssuer}' to authenticate, but this BFF redeems ` +
    `the authorization code at '${backIssuer}'. Every interactive (non-ROPC) login ` +
    `fails, and BffAuthorityAgreementGuard will refuse to start the next pod — ` +
    `behind a healthy-looking old one. Bind both channels to the SAME config source.`
  );
}
