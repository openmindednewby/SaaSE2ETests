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
 * The designated fixture is **`e2e`** — a purpose-built, published prod tenant
 * that exists for nothing but this suite. It carries no customer data, so a row
 * this suite leaks costs a stray test row and nothing else.
 *
 * ⚠️ HISTORY — READ THIS BEFORE REPOINTING THE FIXTURE ⚠️
 * This file used to designate **UBB** ("United By Bachata") and described it as
 * "seeded with 159 ANONYMIZED demo rows … precisely so it is safe to write
 * against". That was TRUE when UBB was a throwaway clone and became FALSE when
 * UBB was handed to a real paying customer — the comment did not change, so the
 * suite kept writing attendee rows onto a live door list. Two such rows
 * (`e2eops-mrrpbovs-xj56pn-ui`, `e2eops-mrs3ntvj-pyzpgg-checkin`) were found on
 * the customer's roster on 2026-07-19.
 *
 * The lesson: "this tenant is safe to write to" is a fact about who OWNS the
 * tenant today, not a property of the slug — and a comment cannot enforce it.
 * That is why {@link assertNotCustomerTenant} now enforces it in code. If you
 * are tempted to point the fixture at a real tenant "just this once", the guard
 * will stop you, and it is right to.
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

/**
 * Prod tenant slugs that belong to REAL customers (or carry real migrated
 * attendee data). This suite creates and deletes attendee rows, mints access
 * links and marks payments — every one of those is a destructive write against
 * a live door list, so none of these may ever be the fixture tenant.
 *
 * Keep this list additive: a slug is added when a tenant gains a real customer
 * and is NEVER removed to make a test pass. If you need a tenant that is not
 * here, create a new one — that is cheap (see
 * `personalServerNotes/scripts/seed-demo-tenant.sh`).
 *
 * `demo` is deliberately included: it is not a customer, but it is the seeded
 * CEO/sales-demo tenant (productization standards, pillar 3). Filling it with
 * `E2E`/`@example.invalid` rows would wreck a live sales demo, which is a
 * different failure with the same cause — so the guard covers it too.
 */
export const PROTECTED_TENANT_SLUGS: readonly string[] = [
  'ubb',
  'ubs',
  'kucy',
  'kizomba-union-cy',
  'united-by-salsa',
  'unitedbybachata',
  'demo',
];

/**
 * Refuse to run against a customer tenant. Throws — deliberately NOT a skip.
 *
 * A skip is silent: the run goes green, nobody looks, and the misconfiguration
 * survives to the next night. A throw fails the run with the slug in the
 * message, which is the outcome we want when the alternative is writing to a
 * paying customer's roster.
 */
export function assertNotCustomerTenant(slug: string): void {
  const normalized = slug.trim().toLowerCase();
  if (!PROTECTED_TENANT_SLUGS.includes(normalized)) return;

  throw new Error(
    `[kefiFixtureTenant] REFUSING TO RUN: fixture tenant resolved to '${normalized}', ` +
      'which is a PROTECTED tenant (a real customer, or the sales-demo tenant). ' +
      'This suite creates and deletes attendee rows, mints access links and marks ' +
      'payments — running it here would write test data onto a live door list.\n' +
      `  Protected slugs: ${PROTECTED_TENANT_SLUGS.join(', ')}\n` +
      '  Fix: point KEFI_FIXTURE_TENANT_SLUG at the dedicated e2e tenant (see ' +
      '.env.prod), NOT at a customer tenant. Do not edit this guard to make a ' +
      'test pass — create a new tenant instead:\n' +
      '    DEMO_SLUG=<slug> personalServerNotes/scripts/seed-demo-tenant.sh kefi --target prod',
  );
}

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
  // Enforced HERE because this is the single chokepoint every write path goes
  // through: openEventOps() -> getKefiFixtureTenant(). A spec cannot obtain the
  // tenant coordinates without passing the guard first.
  assertNotCustomerTenant(slug);
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
