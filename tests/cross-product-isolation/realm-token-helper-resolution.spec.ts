import { test, expect } from '@playwright/test';
import { resolveKeycloakBaseUrl } from '../../helpers/realm-token-helper.js';

/**
 * Unit-style assertions for `resolveKeycloakBaseUrl` — the Keycloak base URL
 * resolver in `helpers/realm-token-helper.ts`.
 *
 * Phase 1 first-live-run surfacing (a): when running `E2E_TARGET=staging`, the
 * old helper fell back to a hardcoded PROD KC URL (`https://identity.dloizides.com`)
 * because `.env.staging` has no `KEYCLOAK_URL` line. That silently minted
 * cross-product-isolation tokens against PROD Keycloak.
 *
 * The fix: derive the KC base from `KEYCLOAK_ISSUER` (which every `.env.<target>`
 * already sets), keep `KEYCLOAK_URL` as an optional explicit override, and
 * THROW — never fall back to prod — when neither is resolvable.
 *
 * These tests pass an explicit `env` object so they don't depend on the
 * ambient `process.env` of whatever target the suite is running against.
 */

test.describe('resolveKeycloakBaseUrl — Keycloak base URL resolution @cross-product-isolation', () => {
  test('derives the KC base from KEYCLOAK_ISSUER (staging issuer)', () => {
    const base = resolveKeycloakBaseUrl({
      KEYCLOAK_ISSUER: 'https://staging.identity.dloizides.com/realms/OnlineMenu',
    });
    expect(base).toBe('https://staging.identity.dloizides.com');
  });

  test('derives the KC base from KEYCLOAK_ISSUER (local issuer)', () => {
    const base = resolveKeycloakBaseUrl({
      KEYCLOAK_ISSUER: 'https://identity.dloizides.com/realms/OnlineMenu',
    });
    expect(base).toBe('https://identity.dloizides.com');
  });

  test('KEYCLOAK_URL takes precedence over KEYCLOAK_ISSUER when both are set', () => {
    const base = resolveKeycloakBaseUrl({
      KEYCLOAK_URL: 'https://explicit-override.example.com',
      KEYCLOAK_ISSUER: 'https://staging.identity.dloizides.com/realms/OnlineMenu',
    });
    expect(base).toBe('https://explicit-override.example.com');
  });

  test('strips a trailing slash from an explicit KEYCLOAK_URL', () => {
    const base = resolveKeycloakBaseUrl({
      KEYCLOAK_URL: 'https://staging.identity.dloizides.com/',
    });
    expect(base).toBe('https://staging.identity.dloizides.com');
  });

  test('THROWS when neither KEYCLOAK_URL nor KEYCLOAK_ISSUER is set (never falls back to prod)', () => {
    expect(() => resolveKeycloakBaseUrl({})).toThrow(/Cannot resolve the Keycloak base URL/);
    // Critically: it must NOT silently return the old hardcoded prod URL.
    expect(() => resolveKeycloakBaseUrl({})).not.toThrow(/identity\.dloizides\.com/);
  });

  test('THROWS when KEYCLOAK_ISSUER has no /realms/ segment', () => {
    expect(() =>
      resolveKeycloakBaseUrl({ KEYCLOAK_ISSUER: 'https://identity.dloizides.com' }),
    ).toThrow(/does not contain a '\/realms\/<realm>' segment/);
  });

  test('staging-target acceptance: with .env.staging-as-is, the resolved base is staging KC', () => {
    // .env.staging sets KEYCLOAK_ISSUER but deliberately has NO KEYCLOAK_URL line.
    // This proves the surfacing-(a) bug class is closed: the resolver lands on
    // the staging KC host, not PROD.
    const stagingEnvAsShipped = {
      KEYCLOAK_ISSUER: 'https://staging.identity.dloizides.com/realms/OnlineMenu',
      // KEYCLOAK_URL intentionally absent — mirrors E2ETests/.env.staging
    };
    const base = resolveKeycloakBaseUrl(stagingEnvAsShipped);
    expect(base).toBe('https://staging.identity.dloizides.com');
    expect(base).not.toContain('staging.identity.dloizides.com/realms');
    expect(base, 'must NOT resolve to PROD Keycloak').not.toBe('https://identity.dloizides.com');
  });
});
