// Per-realm test-user password resolution for the E2E suite.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────────────
//
// 🔴 Until 2026-07-19 the entire suite read ONE `TEST_USER_PASSWORD` and used it for every realm.
// The seeder did the same, so that single value authenticated ~15 seeded accounts across 9
// PRODUCTION realms — including `aml-admin` (PROOViD) and `zygos-admin` (the payments
// back-office). It had also been committed in plaintext to two PUBLIC GitHub repositories.
//
// The seeder now derives a DISTINCT password per realm from one shared high-entropy secret
// (scripts/keycloak-test-password.ps1). This module is the consuming half: it must produce
// byte-identical values, or every seeded login in the suite 401s.
//
// ── Why derivation instead of 11 env vars ─────────────────────────────────────────────────────
//
// The password has six consumers: the dev-PC .env.local, E2ETests/.env.*.secrets, the prod and
// staging playwright-e2e k8s Secrets, the SOPS-encrypted prod secrets, and a GitHub Actions
// secret. Distributing eleven independent passwords to six places is how per-realm passwords
// quietly collapse back into one shared value. Distributing ONE secret and deriving the rest
// keeps every consumer in agreement by construction.
//
// Drift between this and the PowerShell implementation fails CLOSED and LOUD — a wrong
// derivation yields a wrong password and Keycloak answers 401. It cannot fail silently-green.
import { createHmac } from 'node:crypto';

/**
 * Fold a realm name into the uppercase A-Z0-9_ form used in env-var names.
 *
 * NOTE: the realms `OnlineMenu` (legacy) and `onlinemenu` (Katalogos) are DIFFERENT realms that
 * fold to the SAME suffix. A per-realm pin therefore cannot distinguish them; the derivation
 * path can, because it hashes the raw realm name. Mirrors ConvertTo-RealmEnvSuffix.
 */
function realmEnvSuffix(realm: string): string {
  return realm.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
}

/**
 * HMAC-SHA256 derivation. Must stay byte-identical to Get-DerivedRealmPassword in
 * scripts/keycloak-test-password.ps1.
 *
 * The "Kc-" prefix and "-9!" suffix guarantee the result satisfies Keycloak's default password
 * policy (upper + lower + digit + special) whatever the base64url body contains.
 */
export function deriveRealmPassword(secret: string, realm: string): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(`kc-test-user:${realm}`, 'utf8'))
    .digest();
  const b64url = mac.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `Kc-${b64url.slice(0, 24)}-9!`;
}

/** Where a resolved password came from — surfaced so a failing test can say WHY it had that value. */
export interface ResolvedRealmPassword {
  password: string;
  source: string;
  /** True when this value is (or may be) shared with other realms — the legacy mode. */
  isShared: boolean;
}

/**
 * Resolve the seeded test-user password for one realm.
 *
 * Order (first match wins), mirroring Resolve-RealmTestPassword:
 *   1. TEST_USER_PASSWORD_<REALM>      — explicit per-realm pin
 *   2. derived from KEYCLOAK_TEST_USER_SECRET
 *   3. LEGACY TEST_USER_PASSWORD / KEYCLOAK_TEST_USER_PASSWORD — shared; flagged isShared
 */
export function resolveRealmPassword(realm: string, env: NodeJS.ProcessEnv = process.env): ResolvedRealmPassword {
  const pinVar = `TEST_USER_PASSWORD_${realmEnvSuffix(realm)}`;
  const pinned = env[pinVar]?.trim();
  if (pinned) return { password: pinned, source: `$${pinVar}`, isShared: false };

  const secret = env.KEYCLOAK_TEST_USER_SECRET?.trim();
  if (secret) {
    return {
      password: deriveRealmPassword(secret, realm),
      source: 'derived from $KEYCLOAK_TEST_USER_SECRET',
      isShared: false,
    };
  }

  for (const legacy of ['TEST_USER_PASSWORD', 'KEYCLOAK_TEST_USER_PASSWORD'] as const) {
    const v = env[legacy]?.trim();
    if (v) return { password: v, source: `LEGACY $${legacy} (shared across realms)`, isShared: true };
  }

  return { password: '', source: 'UNRESOLVED', isShared: false };
}
