/**
 * Resolves the SHIPPED Kefi fixture tenant the event-ops E2E suite drives.
 *
 * Why a fixture tenant instead of the usual `provisionApiTenantWithEvent`
 * canary: the event-ops surfaces (public register form, door page, ledger page)
 * are STATIC Astro routes baked per tenant slug at publish time
 * (`kefi-landings/src/pages/t/[slug]/{register,door,ledger}.astro` +
 * `getStaticPaths`). A freshly-minted canary slug has no rendered page until a
 * kaniko publish job rebuilds the whole kefi-landings image (60-240s), so the
 * `@ui` tier CANNOT use a canary. It needs an already-published tenant.
 *
 * The designated fixture is **UBB** ("United By Bachata") — the prod tenant
 * seeded with 159 ANONYMIZED demo rows (`Guest 001…159` @example.invalid)
 * precisely so it is safe to write against. Its sibling UBS carries 159 REAL
 * migrated Bailemos attendees and is explicitly OFF-LIMITS to these specs.
 *
 * Configuration (per target):
 *   `.env.<target>`          KEFI_FIXTURE_TENANT_SLUG
 *                            KEFI_FIXTURE_EVENT_EXTERNAL_ID
 *                            KEFI_FIXTURE_ORGANIZER_USERNAME
 *   `.env.<target>.secrets`  KEFI_FIXTURE_ORGANIZER_PASSWORD
 *
 * Only `prod` currently carries a published fixture tenant, so every event-ops
 * spec guards with {@link fixtureTenantAvailable} and self-skips elsewhere
 * rather than failing. See `E2ETests/docs/kefi-event-ops-e2e.md`.
 */

import { tenantSubdomainUrl } from './kefiUrls.js';

/** The resolved fixture tenant coordinates. */
export interface KefiFixtureTenant {
  /** Public URL slug, e.g. `ubb`. */
  slug: string;
  /** External id of the event every event-ops spec operates on. */
  eventExternalId: string;
  /** Organizer / tenant-owner login used for the authed (admin) tier. */
  organizerEmail: string;
  organizerPassword: string;
  /** Public landing host for the tenant, e.g. `https://ubb.kefi.dloizides.com`. */
  siteUrl: string;
}

const REQUIRED_VARS = [
  'KEFI_FIXTURE_TENANT_SLUG',
  'KEFI_FIXTURE_EVENT_EXTERNAL_ID',
  'KEFI_FIXTURE_ORGANIZER_USERNAME',
  'KEFI_FIXTURE_ORGANIZER_PASSWORD',
] as const;

/**
 * True when this target configures a published fixture tenant. Specs guard with
 * this so a target without one skips loudly instead of failing on a missing var.
 */
export function fixtureTenantAvailable(): boolean {
  return REQUIRED_VARS.every((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

/** Human-readable skip reason for a target with no fixture tenant configured. */
export const FIXTURE_TENANT_SKIP_REASON =
  'No published Kefi fixture tenant configured for this target — set KEFI_FIXTURE_* ' +
  '(see E2ETests/docs/kefi-event-ops-e2e.md). Only prod carries one today.';

/** Resolve the fixture tenant. Throws (with the var name) when misconfigured. */
export function getKefiFixtureTenant(): KefiFixtureTenant {
  for (const name of REQUIRED_VARS) {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
      throw new Error(
        `[kefiFixtureTenant] Required env var ${name} is unset. Add it to ` +
          '.env.<target> (slug/event/username) or .env.<target>.secrets (password).',
      );
    }
  }

  const slug = process.env.KEFI_FIXTURE_TENANT_SLUG!.trim();
  return {
    slug,
    eventExternalId: process.env.KEFI_FIXTURE_EVENT_EXTERNAL_ID!.trim(),
    organizerEmail: process.env.KEFI_FIXTURE_ORGANIZER_USERNAME!.trim(),
    organizerPassword: process.env.KEFI_FIXTURE_ORGANIZER_PASSWORD!.trim(),
    siteUrl: tenantSubdomainUrl(slug),
  };
}

/**
 * A per-run marker used to name every row/link this suite creates, so a stray
 * artefact left by a killed run is unmistakably ours and never collides with a
 * concurrent run. Short enough to fit the 200-char name limits.
 */
export function newEventOpsMarker(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `e2eops-${Date.now().toString(36)}-${random}`;
}

/**
 * A deterministic, non-deliverable email for an attendee this suite registers.
 * `.invalid` is reserved by RFC 2606 and can never resolve, so no Kefi lifecycle
 * sweep can ever deliver mail to a row we create on a PRODUCTION tenant. This is
 * the single most important prod-safety property of the suite.
 */
export function fixtureAttendeeEmail(marker: string, discriminator: string): string {
  return `${marker}-${discriminator}@example.invalid`;
}
